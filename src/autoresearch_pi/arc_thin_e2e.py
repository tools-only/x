"""Thin ARC-AGI-3 self-harness runner.

One Pi RPC process with ``demo/arc_thin_extension.ts`` plays one game. Each
decision is one ``prompt``; the extension rebuilds the model context from its
own stores and ends the run with one ``arc_action``. The runner only decides
when to prompt, when to consolidate and when to stop. Design:
docs/plans/2026-10-08-thin-arc-self-harness-extension.md
"""

from __future__ import annotations

import hashlib
import json
import os
import secrets
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from .arc_agi_3_adapter import OFFICIAL_MAX_RUNTIME_SECONDS, resolve_input_modalities, resolve_model_settings
from .arc_agi_3_e2e import (
    _append_bridge_event_batch,
    _arc_terminal_or_budget_exhausted,
    _get_json,
    _post_json,
    _read_jsonl,
    _resolve_pi_cli,
    _sync_bridge_events,
    _wait_for_bridge,
)
from .pi_kernel import PiKernel
from .project import load_project_dotenv

PROJECT_ROOT = Path(__file__).resolve().parents[2]
EXTENSION = PROJECT_ROOT / "demo" / "arc_thin_extension.ts"
SMOKE_PROVIDER = PROJECT_ROOT / "tools" / "arc_thin_smoke_provider.ts"

DECIDE_PROMPT = "Decide the next action."
NO_ACTION_PROMPT = (
    "Decide the next action. Your previous decision ended without arc_action; "
    "end this one with exactly one arc_action."
)
CONSOLIDATE_PROMPT = (
    "CONSOLIDATE: no action this turn. Review RECENT ACTIONS, HYPOTHESES, STRATEGY and MEMORY. In one memory "
    "call: record each test you have not recorded, with the condition it was tested under and a verdict for "
    "every rival it bears on; settle contested hypotheses; keep 2-4 competing hypotheses per open question "
    "with a next_test that tells them apart; make the active strategy name the hypotheses it depends on; "
    "and delete per-step and obsolete entries. If you repeated a calculation by hand, write it as a skill. Then stop."
)
# Streaming deltas repeat the whole partial message per token; keep lifecycle only.
PERSISTED_EVENTS = frozenset({
    "response", "turn_start", "turn_end", "agent_start", "agent_end", "agent_settled",
    "message_start", "message_end", "tool_execution_start", "tool_execution_end", "extension_error",
})
NORMAL_STOPS = frozenset({"win", "budget_exhausted", "max_decisions", "token_cap", "deadline"})


def _bridge_state(bridge_url: str, attempts: int = 3) -> dict[str, Any] | None:
    for attempt in range(attempts):
        try:
            return _get_json(bridge_url + "/state", timeout=10.0)
        except (OSError, ValueError):
            if attempt + 1 < attempts:
                time.sleep(2 ** attempt)
    return None


def _reported_tokens(harness: Path) -> int:
    total = 0
    for row in _read_jsonl(harness / "usage.jsonl"):
        reported = int(row.get("total") or 0)
        total += reported or int(row.get("input") or 0) + int(row.get("output") or 0)
    return total


def _fatal_errors(harness: Path) -> int:
    return sum(1 for row in _read_jsonl(harness / "errors.jsonl") if row.get("fatal"))


def _environment_errors(harness: Path) -> int:
    """arc_action calls the extension ended because the environment failed (timeout, 5xx)."""
    return sum(1 for row in _read_jsonl(harness / "errors.jsonl") if row.get("environment"))


def _tool_errors(events: Path) -> dict[str, int]:
    """Error results per tool (refusals and argument validation failures included)."""
    counts: dict[str, int] = {}
    if not events.exists():
        return counts
    with events.open(encoding="utf-8", errors="replace") as handle:
        for line in handle:
            if '"tool_execution_end"' not in line or '"isError":true' not in line:
                continue
            try:
                name = str(json.loads(line).get("toolName"))
            except ValueError:
                continue
            counts[name] = counts.get(name, 0) + 1
    return counts


def _harness_stats(harness: Path) -> dict[str, Any]:
    memory: dict[str, Any] = {}
    memory_rows = _read_jsonl(harness / "memory.jsonl")
    for row in memory_rows:
        if row.get("rev"):
            continue
        if row.get("deleted"):
            memory.pop(row.get("key"), None)
        else:
            memory[row.get("key")] = row
    hypotheses = {key: row["hyp"] for key, row in memory.items() if isinstance(row.get("hyp"), dict)}
    strategies = {key: row["strat"] for key, row in memory.items() if isinstance(row.get("strat"), dict)}
    evidence = [item for hyp in hypotheses.values() for item in hyp.get("evidence") or []]
    skills: dict[str, Any] = {}
    skill_rows = _read_jsonl(harness / "skills.jsonl")
    for row in skill_rows:
        if row.get("deleted"):
            skills.pop(row.get("name"), None)
        else:
            skills[row.get("name")] = row
    runs = _read_jsonl(harness / "skill_runs.jsonl")
    usage = _read_jsonl(harness / "usage.jsonl")
    prompts = _read_jsonl(harness / "prompt.jsonl")
    errors = _read_jsonl(harness / "errors.jsonl")
    return {
        "memory_entries": len(memory) - len(hypotheses) - len(strategies),
        "memory_writes": len(memory_rows),
        "memory_deletes": sum(1 for row in memory_rows if row.get("deleted")),
        "hypotheses": {
            "final": {key: hyp.get("status") for key, hyp in hypotheses.items()},
            "writes": sum(1 for row in memory_rows if isinstance(row.get("hyp"), dict)),
            "evidence": len(evidence),
            "refutations": sum(1 for item in evidence if item.get("verdict") == "refutes"),
            "questions": sorted({str(hyp.get("question")) for hyp in hypotheses.values() if hyp.get("question")}),
        },
        "lifecycle": _lifecycle_stats(memory_rows, _read_jsonl(harness / "trajectory.jsonl"), strategies),
        "tool_errors": _tool_errors(harness.parent / "pi-events.jsonl"),
        "skills": sorted(f"{name} v{row.get('version')}" for name, row in skills.items()),
        "skill_versions_saved": sum(1 for row in skill_rows if not row.get("deleted")),
        "skill_runs": len(runs),
        "skill_run_errors": sum(1 for row in runs if not row.get("ok")),
        "prompt_overlay_chars": len(str(prompts[-1].get("text") or "")) if prompts else 0,
        "prompt_writes": len(prompts),
        "analyst_calls": sum(1 for row in usage if row.get("kind") == "analyst"),
        "errors": len(errors),
        "fatal_errors": sum(1 for row in errors if row.get("fatal")),
        "environment_errors": sum(1 for row in errors if row.get("environment")),
        "decision_loop": _decision_loop_stats(usage, _read_jsonl(harness / "trajectory.jsonl"),
                                              _read_jsonl(harness / "batch_results.jsonl")),
        "ledger": _ledger_stats(harness),
    }


def _decision_loop_stats(usage: list[dict[str, Any]], trajectory: list[dict[str, Any]],
                         batched: list[dict[str, Any]]) -> dict[str, Any]:
    """Model messages per action decision and what they cost (agent calls only, side calls excluded)."""
    acted = {row.get("decision") for row in trajectory}
    per_decision: dict[Any, list[dict[str, Any]]] = {}
    for row in usage:
        if row.get("kind") == "agent" and row.get("decision") in acted:
            per_decision.setdefault(row.get("decision"), []).append(row)
    messages = [len(rows) for rows in per_decision.values()]
    later = sum(int(row.get("input") or 0) + int(row.get("cache_read") or 0) + int(row.get("output") or 0)
                for rows in per_decision.values() for row in rows[1:])
    every = sum(int(row.get("input") or 0) + int(row.get("cache_read") or 0) + int(row.get("output") or 0)
                for rows in per_decision.values() for row in rows)
    return {
        "action_decisions": len(messages),
        "messages_per_action_decision": round(sum(messages) / len(messages), 2) if messages else None,
        "single_message_decisions": sum(1 for count in messages if count == 1),
        "tokens_after_first_message_pct": round(100 * later / every, 1) if every else None,
        "batched_tool_results": len(batched),
        "batched_tool_failures": sum(1 for row in batched if row.get("failed")),
    }


def _lifecycle_stats(memory_rows: list[dict[str, Any]], trajectory: list[dict[str, Any]],
                     strategies: dict[str, Any]) -> dict[str, Any]:
    """Hypothesis-strategy lifecycle counts and what followed each revision. Mechanical only:
    whether later actions served the revised conclusion is a judgement left to the audit."""
    labels = [str(row.get("action")) + (f"({row.get('x')},{row.get('y')})" if row.get("x") is not None
                                        and row.get("y") is not None else "") for row in trajectory]
    times = [str(row.get("t") or "") for row in trajectory]

    def action_at(row: dict[str, Any]) -> int:
        return sum(1 for t in times if t and t <= str(row.get("t") or ""))

    deleted = [row for row in memory_rows if row.get("deleted") and str(row.get("key", "")).startswith("hyp.")]
    revisions = []
    for index, row in enumerate(memory_rows):
        rev = row.get("rev")
        if not isinstance(rev, dict):
            continue
        at = int(rev.get("at") or 0)
        after = labels[at:at + 8]
        before = labels[max(0, at - max(len(after), 1)):at]
        before_key = rev.get("active_before")
        activated = rev.get("active_after") if rev.get("active_after") not in (None, before_key) else None
        new_strategy_at = at if activated else next(
            (action_at(later) for later in memory_rows[index + 1:] if isinstance(later.get("strat"), dict)
             and later["strat"].get("status") == "active" and later.get("key") != before_key), None)
        revisions.append({
            "at": at, "causes": rev.get("causes"), "active_before": before_key, "active_after": rev.get("active_after"),
            "next_actions": after, "previous_actions": before,
            "same_action_set": bool(after) and set(after) <= set(before),
            "new_strategy_at": new_strategy_at, "linked": sorted(rev.get("linked") or {}),
        })
    strategy_rows = [row for row in memory_rows if isinstance(row.get("strat"), dict)]
    return {
        "hypotheses_deleted": len(deleted),
        "deleted_without_refutation": sum(1 for row in deleted if row.get("dropped")),
        **_refutation_responses(memory_rows),
        "strategies": {
            "final": {key: strat.get("status") for key, strat in strategies.items()},
            "writes": len(strategy_rows),
            "with_premises": len({row.get("key") for row in strategy_rows if row["strat"].get("depends_on")}),
            "with_components": len({row.get("key") for row in strategy_rows if row["strat"].get("uses")}),
        },
        "revisions": revisions,
    }


def _refutation_responses(memory_rows: list[dict[str, Any]]) -> dict[str, Any]:
    """How hypotheses responded to refutations, from consecutive versions of each key.
    contested_outcomes: what a contested hypothesis became next (rejected, narrowed = claim
    rewritten, status_only = status restated with the same claim). restated_with_refutation:
    a refutation recorded in the same call that rewrote the claim, which never shows as
    contested; whether the rewrite was a fair narrowing is left to the audit."""
    previous: dict[str, dict[str, Any]] = {}
    outcomes = {"rejected": 0, "narrowed": 0, "status_only": 0}
    restated = 0

    def refutations(hyp: dict[str, Any]) -> int:
        return sum(1 for item in hyp.get("evidence") or [] if item.get("verdict") == "refutes")

    for row in memory_rows:
        key = row.get("key")
        if row.get("deleted"):
            previous.pop(key, None)
            continue
        hyp = row.get("hyp")
        if not isinstance(hyp, dict):
            continue
        before = previous.get(key)
        if before is not None:
            claim_changed = hyp.get("claim") != before.get("claim")
            if before.get("status") == "contested" and hyp.get("status") != "contested":
                outcome = "rejected" if hyp.get("status") == "rejected" else "narrowed" if claim_changed else "status_only"
                outcomes[outcome] += 1
            elif claim_changed and hyp.get("status") != "rejected" and refutations(hyp) > refutations(before):
                restated += 1
        previous[key] = hyp
    return {"contested_outcomes": outcomes, "restated_with_refutation": restated}


def _ledger_stats(harness: Path) -> dict[str, Any] | None:
    """Counts from the ledger and critic stores; None when the ledger was off."""
    observations = _read_jsonl(harness / "observations.jsonl")
    states = _read_jsonl(harness / "states.jsonl")
    if not states and not observations:
        return None
    trajectory = _read_jsonl(harness / "trajectory.jsonl")
    critic = _read_jsonl(harness / "critic.jsonl")
    usage = _read_jsonl(harness / "usage.jsonl")
    notes = [row for row in critic if row.get("kind") == "note"]
    ideas = [str(row.get("idea") or "") for row in trajectory]
    longest = current = 0
    previous = None
    for idea in ideas:
        key = idea.lower() or None
        current = current + 1 if key is not None and key == previous else (1 if key is not None else 0)
        longest = max(longest, current)
        previous = key
    return {
        "actions_with_idea": sum(1 for idea in ideas if idea),
        "actions_with_expect": sum(1 for row in trajectory if row.get("expect")),
        "distinct_ideas": len({idea.lower() for idea in ideas if idea}),
        "longest_idea_run": longest,
        "states_recorded": len(states),
        "observations": {"ok": sum(1 for row in observations if row.get("ok")),
                         "error": sum(1 for row in observations if not row.get("ok"))},
        "observed_skills": sorted({f"{row.get('skill')} v{row.get('version')}" for row in observations if row.get("ok")}),
        "critic": {
            "notes": len(notes),
            "notes_shown": sum(1 for row in notes if row.get("lines") or row.get("suggest")),
            "lines_kept": sum(len(row.get("lines") or []) for row in notes),
            "lines_dropped": sum(len(row.get("dropped") or []) for row in notes),
            "suppressed": sum(1 for row in critic if row.get("kind") == "suppressed"),
            "failed": sum(1 for row in critic if row.get("kind") == "failed"),
            "tokens": sum(int(row.get("total") or 0) for row in usage if row.get("kind") == "critic"),
        } if critic else None,
    }


def _write_models_json(agent_dir: Path, provider: str, model: str, settings: dict[str, Any]) -> None:
    compat: dict[str, Any] = {"supportsDeveloperRole": False}
    if settings.get("thinking_format"):
        compat["thinkingFormat"] = settings["thinking_format"]
    entry: dict[str, Any] = {
        "id": model, "name": model, "reasoning": True, "input": list(settings["input_modalities"]),
        "contextWindow": settings["context_window"],
        "cost": {"input": 5, "output": 30, "cacheRead": 0, "cacheWrite": 0},
    }
    if settings.get("max_tokens"):
        entry["maxTokens"] = settings["max_tokens"]
    (agent_dir / "models.json").write_text(json.dumps({"providers": {provider: {
        "baseUrl": settings["base_url"], "api": settings["pi_api"], "apiKey": "$OPENAI_API_KEY",
        "compat": compat, "authHeader": True, "models": [entry],
    }}}, indent=2) + "\n", encoding="utf-8")


def run_arc_thin_e2e(
    root: Path,
    *,
    arc_root: Path,
    game: str,
    variant: str = "treatment",
    max_actions: int | None = None,
    max_decisions: int | None = None,
    max_reported_tokens: int | None = None,
    experiment_timeout_seconds: float | None = None,
    consolidate_after_actions: int = 25,
    max_no_action_decisions: int = 3,
    max_environment_failures: int = 2,
    decision_timeout_seconds: float = 900.0,
    pi_provider: str = "yibu",
    pi_model: str | None = None,
    thinking: str | None = None,
    input_modalities: str | None = None,
    max_output_tokens: int | None = None,
    pi_provider_extension: Path | None = None,
    bridge_python: Path | None = None,
    bridge_module_paths: tuple[Path, ...] = (),
    ledger: bool = False,
    critic: bool = False,
    extension_env: dict[str, str] | None = None,
) -> Path:
    """Play one ARC game with the thin self-harness and write ``summary.json``."""
    if variant not in {"treatment", "control"}:
        raise ValueError("variant must be treatment or control")
    root = root.resolve()
    if root.exists() and any(root.iterdir()):
        raise ValueError(f"run root must be new or empty: {root}")
    root.mkdir(parents=True, exist_ok=True)
    harness = root / "harness"
    started = time.monotonic()
    deadline = started + (experiment_timeout_seconds or OFFICIAL_MAX_RUNTIME_SECONDS)

    env = load_project_dotenv(PROJECT_ROOT)
    env.pop("PI_AUTORESEARCH_OWNS_TASK", None)  # never let PiKernel.close seal a legacy task scope
    settings = resolve_model_settings(env)
    if max_output_tokens is not None:
        settings["max_tokens"] = max_output_tokens
    if input_modalities is not None:
        settings["input_modalities"] = list(resolve_input_modalities(input_modalities))
    model = str(pi_model or settings["model"])

    summary: dict[str, Any] = {
        "format": "arc-thin-run-v1", "game": game, "variant": variant,
        "provider": pi_provider, "model": model, "thinking": thinking or "provider-default",
        "passed": False, "stop_reason": None,
        "decisions": 0, "consolidations": 0, "no_action_decisions": 0,
    }
    stage = "bridge"
    arc_root = arc_root.resolve()
    arc_python = bridge_python or arc_root / ".venv" / "Scripts" / "python.exe"
    if not arc_python.is_file():
        raise FileNotFoundError(f"ARC SDK interpreter was not found: {arc_python}")
    src = str(Path(__file__).resolve().parent.parent)
    bridge_env = dict(env)
    bridge_env["PYTHONPATH"] = os.pathsep.join(
        [src, *(str(path.resolve()) for path in bridge_module_paths), env.get("PYTHONPATH", "")])
    launch_id = secrets.token_hex(16)
    action_token = secrets.token_urlsafe(32)
    bridge_command = [str(arc_python), "-m", "autoresearch_pi.arc_agi_3_bridge",
                      "--root", str(root), "--game", game, "--port", "0"]
    if max_actions is not None:
        bridge_command.extend(["--max-actions", str(max_actions)])
    # stderr goes to a file: an undrained pipe can block a long-running bridge.
    bridge_stderr = (root / "bridge-stderr.log").open("w", encoding="utf-8")
    try:
        bridge = subprocess.Popen(
            bridge_command, cwd=str(arc_root), text=True, stdout=subprocess.PIPE, stderr=bridge_stderr,
            env={**bridge_env, "ARC_BRIDGE_EVENT_WRITER": "parent",
                 "ARC_BRIDGE_ACTION_TOKEN": action_token, "ARC_BRIDGE_LAUNCH_ID": launch_id},
        )
    except OSError:
        bridge_stderr.close()
        raise
    bridge_closed = False
    kernel: PiKernel | None = None
    trace = None
    final_state: dict[str, Any] | None = None
    try:
        ready = _wait_for_bridge(root, bridge, launch_id=launch_id)
        bridge_url = f"http://127.0.0.1:{int(ready['port'])}"

        stage = "pi"
        node, cli = _resolve_pi_cli()
        agent_dir = root / ".pi-agent"
        agent_dir.mkdir(parents=True, exist_ok=True)
        pi_env = dict(env)
        if pi_provider_extension is None:
            if not settings["base_url"] or not settings["api_key"]:
                raise RuntimeError("define ARC_OPENAI_API_BASE/ARC_OPENAI_API_KEY or OPENAI_API_BASE/OPENAI_API_KEY")
            pi_env["OPENAI_API_BASE"] = str(settings["base_url"])
            pi_env["OPENAI_API_KEY"] = str(settings["api_key"])
            _write_models_json(agent_dir, pi_provider, model, settings)
        pi_env.update({
            "PI_CODING_AGENT_DIR": str(agent_dir),
            "PI_ARC_BRIDGE_URL": bridge_url,
            "PI_ARC_ACTION_TOKEN": action_token,
            "ARC_RUN_ROOT": str(root),
            "ARC_GAME": game,
            "ARC_THIN_VARIANT": variant,
        })
        ledger_enabled = (ledger or critic) and variant == "treatment"
        critic_enabled = critic and variant == "treatment"
        if ledger_enabled:
            pi_env["ARC_HARNESS_LEDGER"] = "enabled"
        if critic_enabled:
            pi_env["ARC_HARNESS_CRITIC"] = "enabled"
        pi_env.update(extension_env or {})
        command = [node, cli, "--mode", "rpc", "--provider", pi_provider, "--model", model,
                   "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates",
                   "--no-context-files", "--no-builtin-tools", "--extension", str(EXTENSION)]
        if pi_provider_extension is not None:
            command.extend(["--extension", str(pi_provider_extension.resolve())])
        sources = sorted(EXTENSION.parent.glob("arc_thin_*.ts")) + [EXTENSION.parent / "prompts" / "arc_thin_system.md"]
        (root / "run-config.json").write_text(json.dumps({
            **{key: summary[key] for key in ("format", "game", "variant", "provider", "model", "thinking")},
            "max_actions": max_actions, "max_decisions": max_decisions,
            "max_reported_tokens": max_reported_tokens, "experiment_timeout_seconds": experiment_timeout_seconds,
            "consolidate_after_actions": consolidate_after_actions, "input_modalities": settings["input_modalities"],
            "max_output_tokens": settings.get("max_tokens"), "command": command,
            "ledger": ledger_enabled, "critic": critic_enabled,
            "source_sha256": {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in sources if path.is_file()},
        }, indent=2) + "\n", encoding="utf-8")

        trace = (root / "pi-events.jsonl").open("a", encoding="utf-8")
        extension_errors: list[dict[str, Any]] = []

        def persist(event: dict[str, Any]) -> None:
            kind = event.get("type")
            if kind == "extension_error":
                extension_errors.append(event)
            if kind in PERSISTED_EVENTS:
                trace.write(json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n")
                trace.flush()

        kernel = PiKernel(
            command, cwd=str(root), env=pi_env, timeout=120.0, deadline=deadline, event_sink=persist,
            event_projector=lambda event: None if event.get("type") == "message_update" else event,
        ).start()
        kernel.send("set_auto_compaction", enabled=False)
        if thinking:
            kernel.send("set_thinking_level", level=thinking)

        stage = "loop"
        bridge_after = 0
        consolidated_at = 0
        level_changed_since_consolidation = False
        no_action_streak = 0
        environment_streak = 0

        def turn(message: str) -> None:
            response = kernel.prompt(message)
            if response.get("success") is False:
                raise RuntimeError(f"Pi rejected the prompt: {response.get('error')}")
            kernel.wait_for_agent_events(timeout=min(decision_timeout_seconds, max(1.0, deadline - time.monotonic())))

        while True:
            state = _bridge_state(bridge_url)
            if state is None:
                summary["stop_reason"] = "bridge_unavailable"
                break
            final_state = state
            if str(state.get("state")) == "WIN":
                summary["stop_reason"] = "win"
                break
            if _arc_terminal_or_budget_exhausted(state):
                summary["stop_reason"] = "budget_exhausted"
                break
            if max_decisions is not None and summary["decisions"] >= max_decisions:
                summary["stop_reason"] = "max_decisions"
                break
            if max_reported_tokens is not None and _reported_tokens(harness) >= max_reported_tokens:
                summary["stop_reason"] = "token_cap"
                break
            if time.monotonic() >= deadline - 5:
                summary["stop_reason"] = "deadline"
                break
            if no_action_streak >= max_no_action_decisions:
                summary["stop_reason"] = "no_action_streak"
                break

            action_count = len(_read_jsonl(harness / "trajectory.jsonl"))
            consolidate = variant == "treatment" and action_count > consolidated_at and (
                level_changed_since_consolidation
                or str(state.get("state")) == "GAME_OVER"
                or action_count - consolidated_at >= consolidate_after_actions
            )
            fatal_before = _fatal_errors(harness)
            environment_before = _environment_errors(harness)
            errors_before = len(extension_errors)
            try:
                if consolidate:
                    turn(CONSOLIDATE_PROMPT)
                    summary["consolidations"] += 1
                    consolidated_at = action_count
                    level_changed_since_consolidation = False
                else:
                    turn(NO_ACTION_PROMPT if no_action_streak else DECIDE_PROMPT)
                    summary["decisions"] += 1
                    new_rows = _read_jsonl(harness / "trajectory.jsonl")[action_count:]
                    if new_rows:
                        no_action_streak = 0
                        level_changed_since_consolidation |= any(row.get("level_changed") for row in new_rows)
                    else:
                        no_action_streak += 1
                        summary["no_action_decisions"] += 1
            except TimeoutError as exc:
                summary["stop_reason"] = "deadline" if time.monotonic() >= deadline - 5 else "decision_timeout"
                summary["error"] = str(exc)
                break
            except RuntimeError as exc:
                summary["stop_reason"] = "pi_failed"
                summary["error"] = str(exc)
                break
            finally:
                try:
                    bridge_after = _sync_bridge_events(root, bridge_url, bridge_after)
                except (OSError, ValueError):
                    pass
            if len(extension_errors) > errors_before:
                summary["stop_reason"] = "extension_error"
                summary["error"] = str(extension_errors[-1].get("error"))
                break
            if _fatal_errors(harness) > fatal_before:
                summary["stop_reason"] = "harness_fatal"
                break
            # The extension ends a decision when the environment fails; stop instead of
            # spending further model turns once it fails in consecutive decisions.
            if _environment_errors(harness) > environment_before and len(_read_jsonl(harness / "trajectory.jsonl")) == action_count:
                environment_streak += 1
                if environment_streak >= max_environment_failures:
                    summary["stop_reason"] = "environment_error"
                    summary["error"] = str((_read_jsonl(harness / "errors.jsonl") or [{}])[-1].get("message"))
                    break
            else:
                environment_streak = 0

        latest = _bridge_state(bridge_url, attempts=1)
        if latest is not None:
            final_state = latest
        stage = "close"
        try:
            closed = _post_json(bridge_url + "/close", {}, timeout=60.0, action_token=action_token)
            events = closed.pop("events", [])
            if isinstance(events, list):
                _append_bridge_event_batch(root, events)
            summary["bridge_close"] = closed
            bridge_closed = True
        except (OSError, RuntimeError, ValueError) as exc:
            summary["bridge_close_error"] = str(exc)
        summary["passed"] = summary["stop_reason"] in NORMAL_STOPS
    except Exception as exc:  # noqa: BLE001 - persist every runner failure
        summary["stop_reason"] = summary["stop_reason"] or f"runner_error:{stage}"
        summary["error"] = f"{type(exc).__name__}: {exc}"
        (root / "runner-error.json").write_text(json.dumps({"error": summary["error"], "stage": stage},
                                                           indent=2) + "\n", encoding="utf-8")
    finally:
        if kernel is not None:
            stderr_tail = kernel.stderr_tail
            try:
                kernel.close()
            except Exception:  # noqa: BLE001 - shutdown must not mask the summary
                pass
            (root / "pi-stderr.log").write_text(stderr_tail, encoding="utf-8")
        if trace is not None:
            trace.close()
        if bridge.poll() is None:
            try:
                bridge.wait(timeout=30 if bridge_closed else 0.1)
            except subprocess.TimeoutExpired:
                bridge.terminate()
                try:
                    bridge.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    bridge.kill()
        bridge_stderr.close()

    trajectory = _read_jsonl(harness / "trajectory.jsonl")
    budget = (final_state or {}).get("action_budget") or {}
    summary.update({
        "actions": len(trajectory),
        "actions_on_bridge": budget.get("total_used"),
        "final_state": (final_state or {}).get("state"),
        "levels_completed": (final_state or {}).get("levels_completed"),
        "win_levels": (final_state or {}).get("win_levels"),
        "reported_tokens": _reported_tokens(harness),
        "elapsed_seconds": round(time.monotonic() - started, 1),
        "harness": _harness_stats(harness),
    })
    path = root / "summary.json"
    path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def _tool_names(row: dict[str, Any]) -> list[str]:
    return [str(tool.get("name") if isinstance(tool, dict) else tool) for tool in row.get("tools", [])]


def _run_skill_names(row: dict[str, Any]) -> list[str] | None:
    """The name enum of run_skill in one recorded request, or None when run_skill was not offered."""
    for tool in row.get("tools", []):
        if isinstance(tool, dict) and tool.get("name") == "run_skill":
            return list(((tool.get("parameters") or {}).get("properties") or {}).get("name", {}).get("enum") or [])
    return None


def _smoke_checks(root: Path, summary: dict[str, Any]) -> list[dict[str, Any]]:
    harness = root / "harness"
    requests = _read_jsonl(root / "smoke-requests.jsonl")
    agent = [row for row in requests if not row.get("analyst")]
    results = [result for row in requests for result in row.get("last_tool_results", [])]
    def result_text(tool: str) -> list[str]:
        return [str(result.get("text") or "") for result in results if result.get("tool") == tool]
    def last_result(row: dict[str, Any]) -> str:
        return str((row.get("last_tool_results") or [{}])[-1].get("text") or "")
    skill_rows = _read_jsonl(harness / "skills.jsonl")
    trajectory = _read_jsonl(harness / "trajectory.jsonl")
    decision_heads = [row for row in agent if not row.get("consolidating")]
    # The first request of decision 2 is the first agent request after the double arc_action.
    second_decision = next((row for row in decision_heads if row.get("message_count") == 1
                            and "count_color v1" in str(row.get("head"))), None)
    consolidation = [row for row in agent if row.get("consolidating")]
    memory_keys = {row.get("key") for row in _read_jsonl(harness / "memory.jsonl")}
    memory_results = list(dict.fromkeys(result_text("memory")))
    # Decision 3 is the first decision after consolidation.
    after_consolidation = next((str(row.get("head")) for row in decision_heads
                                if row.get("message_count") == 1 and "hyp.static" in str(row.get("head"))), "")
    fourth_decision = next((row for row in decision_heads if row.get("message_count") == 1
                            and "strat.probe [active" in str(row.get("head"))), None)
    lifecycle = (summary.get("harness") or {}).get("lifecycle") or {}
    # Skill call binding: run_skill is offered only for saved names.
    first_save = next((index for index, row in enumerate(agent)
                       if last_result(row).startswith("skill set count_color v1")), None)
    unbound = next((row for row in agent if any(result.get("tool") == "run_skill" and result.get("is_error")
                                                and 'Validation failed for tool "run_skill"' in str(result.get("text"))
                                                for result in row.get("last_tool_results", [])[-1:])), None)
    widened = next((row for row in agent if last_result(row).startswith("skill set scratch v1")), None)
    narrowed = next((row for row in agent if last_result(row).startswith("skill deleted scratch")), None)
    checks = [
        ("run_completed", summary.get("stop_reason") == "max_decisions", summary.get("stop_reason")),
        ("skill_syntax_error_reported", any("not saved" in text and "SyntaxError" in text for text in result_text("skill")),
         result_text("skill")[:2]),
        ("skill_saved_v1", [(row.get("name"), row.get("version"), bool(row.get("deleted"))) for row in skill_rows]
         == [("count_color", 1, False), ("scratch", 1, False), ("scratch", 1, True)],
         [(row.get("name"), row.get("version"), bool(row.get("deleted"))) for row in skill_rows]),
        ("run_skill_hidden_before_save", first_save is not None and all(_run_skill_names(row) is None for row in agent[:first_save]),
         [_tool_names(row) for row in agent[:1]]),
        ("run_skill_bound_after_save", first_save is not None and _run_skill_names(agent[first_save]) == ["count_color"]
         and "run_skill(name=\"count_color\") is callable from your next step" in last_result(agent[first_save]),
         None if first_save is None else [_run_skill_names(agent[first_save]), last_result(agent[first_save])]),
        ("unregistered_name_schema_error", unbound is not None and unbound.get("message_count", 0) > 1
         and not unbound.get("consolidating") and bool((unbound.get("planned") or {}).get("calls"))
         and not any(row.get("name") == "bottom_row" for row in _read_jsonl(harness / "skill_runs.jsonl")),
         None if unbound is None else last_result(unbound)[:300]),
        ("delete_removes_name", widened is not None and _run_skill_names(widened) == ["count_color", "scratch"]
         and narrowed is not None and _run_skill_names(narrowed) == ["count_color"]
         and "run_skill(name=\"scratch\") is no longer callable" in last_result(narrowed),
         [None if widened is None else _run_skill_names(widened), None if narrowed is None else _run_skill_names(narrowed)]),
        ("run_skill_error_has_line", any("KeyError" in text and "line 3 in" in text for text in result_text("run_skill")),
         result_text("run_skill")[:1]),
        ("run_skill_ok", any('"count":' in text for text in result_text("run_skill")), result_text("run_skill")[1:2]),
        ("history_pruned_and_memory_shown", second_decision is not None and "controls.action1" in str(second_decision.get("head")),
         None if second_decision is None else str(second_decision.get("head"))[:400]),
        ("latest_pixel_changes_in_parent", second_decision is not None
         and "LATEST ACTION #1 ACTION1\nPIXEL CHANGES" in str(second_decision.get("head"))
         and '"bbox":[0,0,0,0]' in str(second_decision.get("head"))
         and '"colors":[[0,1,1]]' in str(second_decision.get("head")),
         None if second_decision is None else str(second_decision.get("head"))[-1600:]),
        ("older_pixel_summary_retired", any("LATEST ACTION #2 ACTION4\nPIXEL CHANGES" in str(row.get("head"))
         and "LATEST ACTION #1 ACTION1" not in str(row.get("head")) for row in consolidation), None),
        ("overlay_in_system_prompt", any("SMOKE-OVERLAY" in str(row.get("system_prompt")) for row in agent), None),
        ("analyst_answered", any(row.get("analyst") for row in requests)
         and any("ANALYST:" in text for text in result_text("ask_analyst")), result_text("ask_analyst")[:1]),
        ("one_action_per_decision", [row.get("action") for row in trajectory] == ["ACTION1", "ACTION4", "ACTION3", "ACTION2"],
         [row.get("action") for row in trajectory]),
        ("bridge_matches_trajectory", summary.get("actions_on_bridge") == len(trajectory),
         [summary.get("actions_on_bridge"), len(trajectory)]),
        ("consolidation_ran", bool(consolidation) and all("arc_action" not in _tool_names(row) for row in consolidation)
         and "plan" in memory_keys and summary.get("consolidations") == 1, summary.get("consolidations")),
        ("memory_batch_without_op", any("set state_1, state_2" in text and "hyp.counter (new)" in text
                                        for text in memory_results), memory_results),
        ("memory_batch_atomic_refusal", any("memory NOT changed" in text and 'verdict "refutes"' in text
                                            for text in memory_results) and "atomic_probe" not in memory_keys,
         sorted(key for key in memory_keys if key)),
        ("memory_prefix_delete_in_one_call", any("deleted 2 (state_1, state_2)" in text and "hyp.static (new +evidence #1 refutes)" in text
                                                 for text in memory_results), None),
        ("hypotheses_keep_scoped_evidence", all(part in after_consolidation for part in (
            "hyp.counter [open]", '#2 supports when "after ACTION1"', "hyp.static [rejected]",
            '#1 refutes when "first action of the game"', "last tested: #2 (0 actions ago) · next test: ACTION3"))
         and "state_1" not in after_consolidation, after_consolidation[:900]),
        # Hypothesis-strategy lifecycle (docs/plans/2026-10-09-thin-hypothesis-strategy-lifecycle.md).
        ("strategy_premise_rivals_on_commit", any("strat.track active; premises: hyp.mover [open] (rivals: hyp.counter [open], hyp.paint [open])"
                                                  in text and "skill:nope" in text for text in memory_results),
         [text for text in memory_results if "strat.track" in text][:1]),
        ("one_test_reports_unassessed_rival", any("tests #1 → hyp.counter supports" in text and "rivals not assessed by #1: hyp.mover" in text
                                                  and "no refutation was recorded: hyp.paint" in text for text in memory_results),
         [text for text in memory_results if "tests #1" in text][:1]),
        ("rejection_suspends_dependent_strategy", any("strat.track suspended; it uses skill:count_color, prompt" in text
                                                      and '"controls" still has hyp.counter [open] — rejecting hyp.mover does not confirm them' in text
                                                      for text in memory_results),
         [text for text in memory_results if "hyp.mover (" in text and "rejected" in text][:1]),
        ("revision_in_next_decision", all(part in after_consolidation for part in (
            "strat.track [suspended (hyp.mover rejected after #2), 2 actions spent]",
            "- after #2: hyp.mover rejected; strat.track suspended (hyp.mover rejected after #2). Active now: none. no action since.",
            "Linked, unchanged since: skill:count_color v1, prompt.",
            '- hyp.paint at #1 ("controls"), 0 result(s)', "[used by strat.track (suspended)]")), after_consolidation[:2400]),
        ("behaviour_after_revision_shown", fourth_decision is not None
         and "Active now: strat.probe. next 1: ACTION3×1 | 1 before: ACTION4×1." in str(fourth_decision.get("head")),
         None if fourth_decision is None else str(fourth_decision.get("head"))[:2400]),
        ("lifecycle_in_summary", (lifecycle.get("deleted_without_refutation") == 1
                                  and [(rev.get("at"), rev.get("next_actions"), rev.get("new_strategy_at")) for rev in lifecycle.get("revisions", [])]
                                  == [(2, ["ACTION3", "ACTION2"], 2)]), lifecycle),
        # Decision loop (docs/plans/2026-10-09-thin-decision-loop-efficiency.md): repaired arguments pass Pi's
        # schema, and results of tools batched with arc_action reach the next decision once.
        ("boundary_repairs_pass_schema", not any('Validation failed for tool "memory"' in text or 'Validation failed for tool "skill"' in text
                                                 for text in result_text("memory") + result_text("skill"))
         and any("+evidence #1 supports +evidence #1 supports" in text for text in memory_results),
         [text for text in memory_results if "tests #1" in text][:1]),
        ("batched_results_carried_once", fourth_decision is not None and all(part in str(fourth_decision.get("head")) for part in (
            "RESULTS OF THE TOOLS YOU CALLED TOGETHER WITH YOUR LAST ACTION:", "- memory: memory:", "strat.probe",
            "- memory FAILED: memory NOT changed", "hyp.nope does not exist", "hyp.probe2 [open] ACTION3 repeats"))
         and "RESULTS OF THE TOOLS" not in after_consolidation,
         None if fourth_decision is None else str(fourth_decision.get("head"))[:1800]),
        ("decision_loop_in_summary", ((summary.get("harness") or {}).get("decision_loop") or {}).get("batched_tool_results") == 3
         and ((summary.get("harness") or {}).get("decision_loop") or {}).get("batched_tool_failures") == 1,
         (summary.get("harness") or {}).get("decision_loop")),
        ("no_harness_errors", not _read_jsonl(harness / "errors.jsonl"), _read_jsonl(harness / "errors.jsonl")[:3]),
    ]
    return [{"name": name, "ok": bool(ok), "detail": detail} for name, ok, detail in checks]


def run_arc_thin_smoke(root: Path) -> Path:
    """Offline end-to-end check: mock ARC SDK, real bridge, real Pi, scripted provider."""
    path = run_arc_thin_e2e(
        root, arc_root=PROJECT_ROOT, game="ls20", variant="treatment",
        max_decisions=4, consolidate_after_actions=2, experiment_timeout_seconds=600.0,
        decision_timeout_seconds=180.0,
        pi_provider="offline-arc-thin-smoke", pi_model="scripted", pi_provider_extension=SMOKE_PROVIDER,
        bridge_python=Path(sys.executable), bridge_module_paths=(PROJECT_ROOT / "tools" / "mock_arc_sdk",),
    )
    summary = json.loads(path.read_text(encoding="utf-8"))
    checks = _smoke_checks(root.resolve(), summary)
    summary["checks"] = checks
    summary["passed"] = all(check["ok"] for check in checks)
    path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def _ledger_smoke_checks(root: Path, summary: dict[str, Any]) -> list[dict[str, Any]]:
    harness = root / "harness"
    requests = _read_jsonl(root / "smoke-requests.jsonl")
    agent = [row for row in requests if not row.get("analyst") and not row.get("critic")]
    heads = [str(row.get("head")) for row in agent if row.get("message_count") == 1]
    trajectory = _read_jsonl(harness / "trajectory.jsonl")
    observations = _read_jsonl(harness / "observations.jsonl")
    notes = [row for row in _read_jsonl(harness / "critic.jsonl") if row.get("kind") == "note"]
    shown = [head for head in heads if "CRITIC (independent review at #4" in head]
    checks = [
        ("run_completed", summary.get("stop_reason") == "max_decisions", summary.get("stop_reason")),
        ("ideas_recorded", [row.get("idea") for row in trajectory] == ["move right"] * 3 + ["move left"] * 2,
         [row.get("idea") for row in trajectory]),
        ("long_expect_clipped_not_rejected", len(str(trajectory[1].get("expect") if len(trajectory) > 1 else "")) == 300,
         len(str(trajectory[1].get("expect") if len(trajectory) > 1 else ""))),
        ("states_and_skill_observed", len(_read_jsonl(harness / "states.jsonl")) >= 5
         and sum(1 for row in observations if row.get("skill") == "pos" and row.get("ok")) >= 5,
         [len(_read_jsonl(harness / "states.jsonl")), len(observations)]),
        ("effort_line_shown", any("IDEAS: move right — 3 in a row (#1–#3)" in head for head in heads), None),
        ("expected_vs_observed_shown", any('LAST EXPERIMENT move right #1–#3: expected "the 9 moves right by one"' in head
                                           and "pos.value 2→5" in head for head in heads), None),
        ("critic_called_once", sum(1 for row in requests if row.get("critic")) == 1
         and any(row.get("kind") == "critic" for row in _read_jsonl(harness / "usage.jsonl")), None),
        ("critic_citations_filtered", len(notes) == 1 and len(notes[0].get("lines") or []) == 1
         and any("#99" in line for line in notes[0].get("dropped") or [])
         and (notes[0].get("suggest") or {}).get("action") == "ACTION2", notes[:1]),
        ("critic_shown_once", len(shown) == 1 and "#99" not in shown[0] and "suggest: ACTION2" in shown[0],
         [head[-700:] for head in shown]),
        ("actions_not_blocked", [row.get("action") for row in trajectory] == ["ACTION1", "ACTION4", "ACTION1", "ACTION3", "ACTION2"],
         [row.get("action") for row in trajectory]),
        ("no_harness_errors", not _read_jsonl(harness / "errors.jsonl"), _read_jsonl(harness / "errors.jsonl")[:3]),
    ]
    return [{"name": name, "ok": bool(ok), "detail": detail} for name, ok, detail in checks]


def run_arc_thin_ledger_smoke(root: Path) -> Path:
    """Offline ledger + critic wiring check: mock ARC SDK, real bridge, Pi, thin extension and WASI sandbox."""
    path = run_arc_thin_e2e(
        root, arc_root=PROJECT_ROOT, game="ls20", variant="treatment",
        max_decisions=5, consolidate_after_actions=100, experiment_timeout_seconds=900.0,
        decision_timeout_seconds=240.0,
        pi_provider="offline-arc-thin-smoke", pi_model="scripted", pi_provider_extension=SMOKE_PROVIDER,
        bridge_python=Path(sys.executable), bridge_module_paths=(PROJECT_ROOT / "tools" / "mock_arc_sdk",),
        ledger=True, critic=True,
        extension_env={"ARC_THIN_SMOKE_SCRIPT": "ledger", "ARC_CRITIC_EXPERIMENT_MIN": "3", "ARC_CRITIC_MIN_GAP": "1"},
    )
    summary = json.loads(path.read_text(encoding="utf-8"))
    checks = _ledger_smoke_checks(root.resolve(), summary)
    summary["checks"] = checks
    summary["passed"] = all(check["ok"] for check in checks)
    path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def _environment_smoke_checks(root: Path, summary: dict[str, Any]) -> list[dict[str, Any]]:
    harness = root / "harness"
    requests = [row for row in _read_jsonl(root / "smoke-requests.jsonl") if not row.get("analyst") and not row.get("critic")]
    planned_notes = [str(((row.get("planned") or {}).get("calls") or [[None, {}]])[-1][1].get("note")) for row in requests]
    environment = [row for row in _read_jsonl(harness / "errors.jsonl") if row.get("environment")]
    third = next((str(row.get("head")) for row in requests if "environment fails again" in str(row.get("planned"))), "")
    checks = [
        ("stopped_as_environment_error", summary.get("stop_reason") == "environment_error", summary.get("stop_reason")),
        ("only_the_working_action_recorded", [row.get("action") for row in _read_jsonl(harness / "trajectory.jsonl")] == ["ACTION1"]
         and summary.get("actions_on_bridge") == 1, summary.get("actions_on_bridge")),
        # A failed decision ends at once: one model request per decision, and the spare step is never reached.
        ("no_retry_inside_a_decision", len(requests) == 3 and all(row.get("message_count") == 1 for row in requests)
         and "must never be requested" not in planned_notes, [(row.get("message_count"), note) for row, note in zip(requests, planned_notes)]),
        ("environment_errors_logged", len(environment) == 2 and summary.get("harness", {}).get("environment_errors") == 2
         and all("EnvironmentReturnedNoFrame" in str(row.get("message")) for row in environment)
         and not any(row.get("fatal") for row in _read_jsonl(harness / "errors.jsonl")), environment[:2]),
        ("batched_update_survives_failed_action", "RESULTS OF THE TOOLS YOU CALLED TOGETHER WITH YOUR LAST ACTION:" in third
         and "- memory: memory: set plan" in third, third[:600]),
    ]
    return [{"name": name, "ok": bool(ok), "detail": detail} for name, ok, detail in checks]


def run_arc_thin_environment_smoke(root: Path) -> Path:
    """Offline check that an environment failure ends the decision and stops the run without model retries."""
    previous = os.environ.get("MOCK_ARC_FAIL_AFTER")
    os.environ["MOCK_ARC_FAIL_AFTER"] = "1"  # read by tools/mock_arc_sdk in the bridge process
    try:
        path = run_arc_thin_e2e(
            root, arc_root=PROJECT_ROOT, game="ls20", variant="treatment",
            max_decisions=6, consolidate_after_actions=100, experiment_timeout_seconds=600.0,
            decision_timeout_seconds=180.0,
            pi_provider="offline-arc-thin-smoke", pi_model="scripted", pi_provider_extension=SMOKE_PROVIDER,
            bridge_python=Path(sys.executable), bridge_module_paths=(PROJECT_ROOT / "tools" / "mock_arc_sdk",),
            extension_env={"ARC_THIN_SMOKE_SCRIPT": "environment"},
        )
    finally:
        if previous is None:
            os.environ.pop("MOCK_ARC_FAIL_AFTER", None)
        else:
            os.environ["MOCK_ARC_FAIL_AFTER"] = previous
    summary = json.loads(path.read_text(encoding="utf-8"))
    checks = _environment_smoke_checks(root.resolve(), summary)
    summary["checks"] = checks
    summary["passed"] = all(check["ok"] for check in checks)
    path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path
