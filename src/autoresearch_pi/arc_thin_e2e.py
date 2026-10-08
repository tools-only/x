"""Thin ARC-AGI-3 self-harness runner.

One Pi RPC process with ``demo/arc_thin_extension.ts`` plays one game. Each
decision is one ``prompt``; the extension rebuilds the model context from its
own stores and ends the run with one ``arc_action``. The runner only decides
when to prompt, when to consolidate and when to stop. Design:
docs/plans/2026-10-08-thin-arc-self-harness-extension.md
"""

from __future__ import annotations

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
    "CONSOLIDATE: no action this turn. Review RECENT ACTIONS and MEMORY. Update memory "
    "(merge duplicates, raise/lower confidence, delete what the evidence refuted, record the "
    "current goal hypothesis and the next test). If you repeated a calculation by hand, write "
    "it as a skill. Then stop."
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


def _harness_stats(harness: Path) -> dict[str, Any]:
    memory: dict[str, Any] = {}
    for row in _read_jsonl(harness / "memory.jsonl"):
        if row.get("deleted"):
            memory.pop(row.get("key"), None)
        else:
            memory[row.get("key")] = row
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
        "memory_entries": len(memory),
        "memory_writes": len(_read_jsonl(harness / "memory.jsonl")),
        "skills": sorted(f"{name} v{row.get('version')}" for name, row in skills.items()),
        "skill_versions_saved": sum(1 for row in skill_rows if not row.get("deleted")),
        "skill_runs": len(runs),
        "skill_run_errors": sum(1 for row in runs if not row.get("ok")),
        "prompt_overlay_chars": len(str(prompts[-1].get("text") or "")) if prompts else 0,
        "prompt_writes": len(prompts),
        "analyst_calls": sum(1 for row in usage if row.get("kind") == "analyst"),
        "errors": len(errors),
        "fatal_errors": sum(1 for row in errors if row.get("fatal")),
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
    decision_timeout_seconds: float = 900.0,
    pi_provider: str = "yibu",
    pi_model: str | None = None,
    thinking: str | None = None,
    input_modalities: str | None = None,
    max_output_tokens: int | None = None,
    pi_provider_extension: Path | None = None,
    bridge_python: Path | None = None,
    bridge_module_paths: tuple[Path, ...] = (),
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
        command = [node, cli, "--mode", "rpc", "--provider", pi_provider, "--model", model,
                   "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates",
                   "--no-context-files", "--no-builtin-tools", "--extension", str(EXTENSION)]
        if pi_provider_extension is not None:
            command.extend(["--extension", str(pi_provider_extension.resolve())])
        (root / "run-config.json").write_text(json.dumps({
            **{key: summary[key] for key in ("format", "game", "variant", "provider", "model", "thinking")},
            "max_actions": max_actions, "max_decisions": max_decisions,
            "max_reported_tokens": max_reported_tokens, "experiment_timeout_seconds": experiment_timeout_seconds,
            "consolidate_after_actions": consolidate_after_actions, "input_modalities": settings["input_modalities"],
            "max_output_tokens": settings.get("max_tokens"), "command": command,
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


def _smoke_checks(root: Path, summary: dict[str, Any]) -> list[dict[str, Any]]:
    harness = root / "harness"
    requests = _read_jsonl(root / "smoke-requests.jsonl")
    agent = [row for row in requests if not row.get("analyst")]
    results = [result for row in requests for result in row.get("last_tool_results", [])]
    def result_text(tool: str) -> list[str]:
        return [str(result.get("text") or "") for result in results if result.get("tool") == tool]
    skill_rows = _read_jsonl(harness / "skills.jsonl")
    trajectory = _read_jsonl(harness / "trajectory.jsonl")
    decision_heads = [row for row in agent if not row.get("consolidating")]
    # The first request of decision 2 is the first agent request after the double arc_action.
    second_decision = next((row for row in decision_heads if row.get("message_count") == 1
                            and "count_color v1" in str(row.get("head"))), None)
    consolidation = [row for row in agent if row.get("consolidating")]
    memory_keys = {row.get("key") for row in _read_jsonl(harness / "memory.jsonl")}
    checks = [
        ("run_completed", summary.get("stop_reason") == "max_decisions", summary.get("stop_reason")),
        ("skill_syntax_error_reported", any("not saved" in text and "SyntaxError" in text for text in result_text("skill")),
         result_text("skill")[:2]),
        ("skill_saved_v1", [(row.get("name"), row.get("version")) for row in skill_rows] == [("count_color", 1)],
         [(row.get("name"), row.get("version")) for row in skill_rows]),
        ("run_skill_error_has_line", any("KeyError" in text and "line 3 in" in text for text in result_text("run_skill")),
         result_text("run_skill")[:1]),
        ("run_skill_ok", any('"count":' in text for text in result_text("run_skill")), result_text("run_skill")[-1:]),
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
        ("one_action_per_decision", [row.get("action") for row in trajectory] == ["ACTION1", "ACTION4", "ACTION3"],
         [row.get("action") for row in trajectory]),
        ("bridge_matches_trajectory", summary.get("actions_on_bridge") == len(trajectory),
         [summary.get("actions_on_bridge"), len(trajectory)]),
        ("consolidation_ran", bool(consolidation) and all("arc_action" not in row.get("tools", []) for row in consolidation)
         and "plan" in memory_keys and summary.get("consolidations") == 1, summary.get("consolidations")),
        ("no_harness_errors", not _read_jsonl(harness / "errors.jsonl"), _read_jsonl(harness / "errors.jsonl")[:3]),
    ]
    return [{"name": name, "ok": bool(ok), "detail": detail} for name, ok, detail in checks]


def run_arc_thin_smoke(root: Path) -> Path:
    """Offline end-to-end check: mock ARC SDK, real bridge, real Pi, scripted provider."""
    path = run_arc_thin_e2e(
        root, arc_root=PROJECT_ROOT, game="ls20", variant="treatment",
        max_decisions=3, consolidate_after_actions=2, experiment_timeout_seconds=600.0,
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
