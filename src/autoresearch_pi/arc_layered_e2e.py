"""One ARC game with the layered profile: one Pi session, one python tool, decisions opened by this runner.

The extension (demo/arc_layered_extension.ts) ends a decision after a Python call executes actions; the runner opens
the next one in the same Pi session. Design: docs/plans/2026-11-23-arc-layered-duck-aligned-dev-plan.md sections 5 and 8.
"""

from __future__ import annotations

import argparse
import ast
import hashlib
import json
import subprocess
import time
from collections import Counter
from pathlib import Path
from typing import Any

from .arc_agi_3_adapter import resolve_model_settings
from .arc_layered_support import (PROJECT_ROOT, PERSISTED_EVENTS, _append_events, _arc_terminal_or_budget_exhausted,
                                  _bridge_state, _budget_tokens, _pi_cli_version, _post_json, _provider_admission_stop,
                                  _read_jsonl, _reported_tokens, _request_accounting, _resolve_pi_cli, _start_bridge,
                                  _stop_bridge, _wait_for_bridge, _write_models_json)
from .pi_kernel import PiKernel
from .project import load_project_dotenv

EXTENSION = PROJECT_ROOT / "demo" / "arc_layered_extension.ts"
CONFIGS = ("kaggle-local", "api-research")
PROFILES = ("qwen27b", "qwen27b-harness")
MAX_PROVIDER_ERRORS = 3
MAX_IDLE_SEGMENTS = 4
MAX_PROVIDER_STALLS = 3


def _scan_work(root: Path, harness: Path, segment: int, seen: dict[str, str]) -> tuple[int, list[str]]:
    """Record model-authored work/ file changes at a segment boundary; report files that do not parse."""
    work, changes, errors = root / "work", 0, []
    for path in sorted(work.rglob("*.py")) if work.is_dir() else []:
        rel = path.relative_to(root).as_posix()
        text = path.read_text(encoding="utf-8")
        digest = hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]
        if seen.get(rel) == digest:
            continue
        seen[rel] = digest
        try:
            ast.parse(text)
            status = "ok"
        except SyntaxError as exc:
            status = f"syntax error line {exc.lineno}: {exc.msg}"
            errors.append(f"{rel}: {status}")
        changes += 1
        with (harness / "evolution.jsonl").open("a", encoding="utf-8") as sink:
            sink.write(json.dumps({"t": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "segment": segment,
                                   "path": rel, "hash": digest, "status": status}) + "\n")
    return changes, errors


def _git_snapshot(root: Path) -> str | None:
    """Version the model's work/ directory at run end; None when there is nothing to snapshot or git is unavailable."""
    work = root / "work"
    if not work.is_dir() or not any(work.rglob("*.py")):
        return None
    base = ["git", "-c", "user.email=arc@local", "-c", "user.name=arc-layered"]
    try:
        subprocess.run([*base, "init", "-q"], cwd=work, check=False, capture_output=True, timeout=30)
        subprocess.run([*base, "add", "-A"], cwd=work, check=False, capture_output=True, timeout=30)
        subprocess.run([*base, "commit", "-q", "-m", "run snapshot"], cwd=work, check=False, capture_output=True, timeout=30)
        head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=work, check=False, capture_output=True, text=True, timeout=10)
        return head.stdout.strip() or None
    except OSError:
        return None


def _layered_evidence(root: Path) -> dict[str, Any]:
    decisions = _read_jsonl(root / "harness" / "decisions.jsonl")
    replays = sorted((root / "work" / "replay").glob("level_*.md")) if (root / "work" / "replay").is_dir() else []
    return {
        "decisions": len(decisions),
        "repeated": sum(1 for row in decisions if row.get("same")),
        "deaths": sum(1 for row in decisions if row.get("death")),
        "level_ups": sum(1 for row in decisions if row.get("level_up")),
        "prediction_off": sum(1 for row in decisions if row.get("predict_off")),
        "claim_failures": sum(len(row.get("claims_failed") or []) for row in decisions),
        "claim_holds": sum(len(row.get("claims_held") or []) for row in decisions),
        "program_actions": sum(1 for row in decisions if row.get("source")),
        "replays": [path.relative_to(root).as_posix() for path in replays],
    }


def _flush_final_level_replay(root: Path, state: dict[str, Any], rows: list[dict[str, Any]],
                              comp_stats: dict[str, Any]) -> Path | None:
    """Ensure the final active level's work/replay/level_<N>.md is flushed after PiKernel.close()."""
    harness = root / "harness"
    decisions = _read_jsonl(harness / "decisions.jsonl")
    if not decisions:
        return None
    win_levels = state.get("win_levels")
    completed = state.get("levels_completed")
    if isinstance(win_levels, int) and win_levels > 0 and isinstance(completed, int):
        target_level = min(completed + 1, win_levels)
    else:
        target_level = int(decisions[-1].get("level") or 1)
    level_decisions = [d for d in decisions if int(d.get("level") or 0) == target_level]
    if not level_decisions:
        target_level = int(decisions[-1].get("level") or 1)
        level_decisions = [d for d in decisions if int(d.get("level") or 0) == target_level]
    if not level_decisions:
        return None
    same_count = sum(1 for d in level_decisions if d.get("same"))
    no_new = sum(1 for d in level_decisions if not d.get("new"))
    unchanged = sum(1 for d in level_decisions if not d.get("changed"))
    deaths = sum(1 for d in level_decisions if d.get("death"))
    tail_lines = [
        f"s{d.get('step')} {d.get('action')} try{d.get('tries', 0)}"
        + (" same" if d.get("same") else "")
        + (" DEATH" if d.get("death") else "")
        + (" LEVEL_UP" if d.get("level_up") else "")
        + (" frame-change" if d.get("changed") else "")
        + (" new-interior" if d.get("new") else "")
        + (f" via {d['source']}" if d.get("source") else "")
        + (f" verify_failed:{'/'.join(d['verify_failed'])}" if d.get("verify_failed") else "")
        for d in level_decisions[-6:]
    ]
    head_path = harness / "components" / "HEAD.json"
    heads: dict[str, int] = json.loads(head_path.read_text(encoding="utf-8")) if head_path.is_file() else {}
    verify_stats: dict[str, dict[str, Any]] = {}
    for row in rows:
        if row.get("kind") == "memory_verify_sync" and isinstance(row.get("stats"), dict):
            for cid, st in row["stats"].items():
                if isinstance(st, dict):
                    verify_stats[cid] = st
    comp_lines: list[str] = []
    for kind in ("memory", "prompt", "skill", "tool", "subagent"):
        matched = sorted((k.split("/", 1)[1], v) for k, v in heads.items() if k.startswith(f"{kind}/"))
        if not matched:
            comp_lines.append(f"- {kind}: none")
            continue
        for name, ver in matched:
            cpath = harness / "components" / kind / name / f"v{ver}.json"
            cobj = json.loads(cpath.read_text(encoding="utf-8")) if cpath.is_file() else {}
            st = comp_stats.get(f"{kind}/{name}") or {}
            cur = (st.get("by_level") or {}).get(str(target_level)) or {}
            tot = st.get("total") or {}
            if kind == "memory":
                vmap = cobj.get("verify") or {}
                vparts = []
                for rule in sorted(vmap):
                    vst = verify_stats.get(f"{name}/{rule}")
                    if not vst:
                        vparts.append(f"{rule}: pending")
                    elif vst.get("error"):
                        vparts.append(f"{rule}: err({str(vst['error'])[:60]})")
                    elif not vst.get("checked"):
                        vparts.append(f"{rule}: 0 checked")
                    else:
                        failed = vst.get("counter", 0)
                        wit = f" ({vst['witness']})" if failed and vst.get("witness") else ""
                        vparts.append(f"{rule}: {vst.get('support', 0)}/{vst['checked']} held" + (f", {failed} failed{wit}" if failed else ""))
                vsuf = f" [verify: {'; '.join(vparts)}]" if vparts else ""
                comp_lines.append(f"- memory/{name} v{ver}{vsuf}")
            elif kind == "skill":
                comp_lines.append(f"- skill/{name} v{ver}: L{target_level} reads={cur.get('reads', 0)}, total={tot.get('reads', 0)}")
            elif kind in ("tool", "subagent"):
                comp_lines.append(f"- {kind}/{name} v{ver}: L{target_level} {cur.get('ok', 0)}/{cur.get('invocations', 0)} ok, total {tot.get('ok', 0)}/{tot.get('invocations', 0)} ok")
            else:
                comp_lines.append(f"- prompt/{name} v{ver}")
    py_level = [r for r in rows if r.get("kind") == "python" and int(r.get("level") or 0) == target_level]
    obs_level = sum(1 for r in rows if r.get("kind") == "observe_limit" and int(r.get("level") or 0) == target_level)
    consult_level = sum(1 for r in rows if r.get("kind") == "consult" and r.get("attempted") is True and int(r.get("level") or 0) == target_level)
    recent_errs = [str(r["error"]).splitlines()[-1][:120] for r in py_level if r.get("error")][-2:]
    budget = state.get("action_budget") or {}
    body = "\n".join([
        f"# Level {target_level} review", "",
        f"Outcome: {state.get('state', 'UNKNOWN')}; actions used {budget.get('total_used', len(decisions))}; completed {state.get('levels_completed', 0)}/{state.get('win_levels', 0)}.",
        "", "## Layer 1: Task facts", "",
        f"steps {len(level_decisions)}; same-result {same_count}; no-new-interior-state {no_new}; unchanged-frame {unchanged}; deaths {deaths}",
        *tail_lines,
        "", "## Layer 2: Active capabilities & execution", "",
        *comp_lines,
        f"- consults on L{target_level}: {consult_level}",
        f"- python: calls={len(py_level)}, errors={sum(1 for r in py_level if r.get('error'))}, truncated={sum(1 for r in py_level if r.get('truncated'))}, observe_limits={obs_level}"
        + (f"; recent errors: {' | '.join(recent_errs)}" if recent_errs else ""),
        "", "## Editable capability space", "",
        "Editable capability space: memory (with optional verify), prompt, skills (reusable workflows/methods), tools (@tool or work/lib/), subagents (consult).", "",
    ])
    replay_dir = root / "work" / "replay"
    replay_dir.mkdir(parents=True, exist_ok=True)
    target = replay_dir / f"level_{target_level}.md"
    target.write_text(body[:4000], encoding="utf-8")
    return target


def _classify_segment_activity(end: dict[str, Any], segment_rows: list[dict[str, Any]],
                               work_changed: int, work_errors: int) -> str:
    """Distinguish productive cognitive/component progress from genuinely idle segments."""
    if end.get("actions"):
        return "acted"
    if end.get("reason") in ("length", "length_exhausted"):
        return str(end.get("reason"))
    constructive_kinds = {"component_change", "tool_published", "tool_decorated", "read_component"}
    has_constructive = (work_changed > 0 and not work_errors) or any(
        row.get("kind") in constructive_kinds
        or (row.get("kind") == "consult" and row.get("ok") is True)
        for row in segment_rows
    )
    if has_constructive:
        return "constructive"
    if any(row.get("kind") == "observe_limit" for row in segment_rows):
        return "observe_limit"
    return "idle"


def run_arc_layered_e2e(root: Path, *, game: str, arc_root: Path, pi_provider: str, pi_model: str, config: str = "api-research",
                        profile: str = "qwen27b",
                        provider_extension: Path | None = None, agent_dir: Path | None = None, thinking: str | None = None,
                        max_actions: int | None = None, max_reported_tokens: int | None = None, wall_seconds: float = 3600.0,
                        segment_seconds: float = 1_000_000.0, segment_tokens: int = 100_000_000, idle_continuations: int = 3,
                        idle_timeout: float = 300.0, max_output_tokens: int | None = None, count_cache: bool = False, dotenv_root: Path = PROJECT_ROOT, extension_env: dict[str, str] | None = None,
                        fresh_level_session: bool = False, kernel_class: type[PiKernel] = PiKernel,
                        bridge_python: Path | None = None, bridge_module_paths: tuple[Path, ...] = (),
                        benchmark_only: bool = False) -> Path:
    if config not in CONFIGS:
        raise ValueError(f"config must be one of {CONFIGS}")
    if profile not in PROFILES:
        raise ValueError(f"profile must be one of {PROFILES}")
    if max_output_tokens is None:
        max_output_tokens = 4096 if profile == "qwen27b" else 12000
    root = root.resolve()
    harness = root / "harness"
    harness.mkdir(parents=True, exist_ok=True)
    env = load_project_dotenv(dotenv_root)
    used_tokens = _reported_tokens if count_cache else _budget_tokens
    started = time.monotonic()
    deadline = float("inf") if benchmark_only else started + wall_seconds
    if benchmark_only:
        max_actions = max_reported_tokens = idle_timeout = None
        segment_seconds = segment_tokens = idle_continuations = float("inf")
    summary: dict[str, Any] = {"format": "arc-layered-run-v1", "game": game, "config": config, "profile": profile, "provider": pi_provider,
                               "model": pi_model, "thinking": thinking or "provider-default", "stop_reason": None,
                               "segments": 0, "segment_reasons": [], "provider_errors": 0}
    bridge, bridge_stderr, launch_id, action_token = _start_bridge(
        root, arc_root=arc_root, game=game, max_actions=max_actions, env=env, bridge_python=bridge_python,
        bridge_module_paths=bridge_module_paths)
    kernel: PiKernel | None = None
    closed = False
    state: dict[str, Any] = {}
    work_hashes: dict[str, str] = {}
    evolution_changes, evolution_errors = 0, 0
    trace = (root / "pi-events.jsonl").open("a", encoding="utf-8")
    try:
        ready = _wait_for_bridge(root, bridge, timeout=60.0, launch_id=launch_id)
        bridge_url = f"http://127.0.0.1:{int(ready['port'])}"
        node, cli = _resolve_pi_cli()
        pi_env = dict(env)
        if benchmark_only:
            for key in ("PI_PROVIDER_MAX_REPORTED_TOKENS", "PI_PROVIDER_CONTEXT_ADMISSION", "PI_PROVIDER_REPORTED_ADMISSION"):
                pi_env.pop(key, None)
        if agent_dir is None:
            agent_dir = root / ".pi-agent"
            agent_dir.mkdir(exist_ok=True)
            (agent_dir / "settings.json").write_text(json.dumps({"compaction": {"enabled": False}}) + "\n", encoding="utf-8")
            if provider_extension is None:
                settings = resolve_model_settings(env)
                pi_env["OPENAI_API_BASE"], pi_env["OPENAI_API_KEY"] = str(settings["base_url"]), str(settings["api_key"])
                _write_models_json(agent_dir, pi_provider, pi_model, {**settings, "input_modalities": ["text", "image"]})
        if max_reported_tokens is not None:
            pi_env.update(PI_PROVIDER_MAX_REPORTED_TOKENS=str(max_reported_tokens), PI_PROVIDER_CONTEXT_ADMISSION="enabled",
                          PI_PROVIDER_REPORTED_ADMISSION="enabled", PI_PROVIDER_TOKEN_BUDGET_ROOT=str(harness))
        pi_env.setdefault("PI_PROVIDER_IMAGE_TOKEN_RESERVE", "4096")
        # The admission reserve of one token per serialized byte is ~3-4x the real cost and starves long layered runs;
        # 3 bytes per token keeps the estimate conservative while leaving usable budget.
        pi_env.setdefault("PI_PROVIDER_TEXT_BYTES_PER_TOKEN", "3")
        pi_env.update({"PI_CODING_AGENT_DIR": str(agent_dir), "PI_ARC_BRIDGE_URL": bridge_url, "PI_ARC_ACTION_TOKEN": action_token,
                       "ARC_RUN_ROOT": str(root), "ARC_GAME": game, "ARC_LAYERED_CONFIG": config, "ARC_LAYERED_PROFILE": profile,
                       "ARC_LAYERED_COUNT_CACHE": str(int(count_cache)), "ARC_LAYERED_OUTPUT_TOKENS": str(max_output_tokens),
                       "ARC_LAYERED_SEGMENT_SECONDS": "Infinity" if benchmark_only else str(segment_seconds),
                       "ARC_LAYERED_SEGMENT_TOKENS": "Infinity" if benchmark_only else str(segment_tokens),
                       "ARC_LAYERED_IDLE_CONTINUATIONS": "Infinity" if benchmark_only else str(idle_continuations),
                       **(extension_env or {})})
        command = [node, cli, "--mode", "rpc", "--provider", pi_provider, "--model", pi_model, "--session", str(root / "session.jsonl"),
                   "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-builtin-tools",
                   *(["--thinking", thinking] if thinking else []), "--extension", str(EXTENSION)]
        if provider_extension is not None:
            command.extend(["--extension", str(provider_extension.resolve())])
        if max_reported_tokens is not None:
            command.extend(["--extension", str(PROJECT_ROOT / "demo" / "pi_final_provider_payload.ts")])
        (root / "run-config.json").write_text(json.dumps({
            **{key: summary[key] for key in ("format", "game", "config", "profile", "provider", "model", "thinking")},
            "max_actions": max_actions, "max_reported_tokens": max_reported_tokens, "token_cap_measure": "total_with_cache" if count_cache else "uncached_input+output",
            "wall_seconds": None if benchmark_only else wall_seconds, "segment_seconds": None if benchmark_only else segment_seconds,
            "segment_tokens": None if benchmark_only else segment_tokens, "benchmark_only": benchmark_only,
            "idle_continuations": None if benchmark_only else idle_continuations, "max_output_tokens": max_output_tokens, "extension_env": extension_env or {},
            "consult_enabled": profile == "qwen27b-harness" and pi_env.get("ARC_LAYERED_CONSULT") != "0",
            "evolution_enabled": profile == "qwen27b-harness" and pi_env.get("ARC_LAYERED_EVOLUTION") != "0",
            "board_inventory_enabled": profile == "qwen27b-harness" and pi_env.get("ARC_LAYERED_BOARD_INVENTORY") != "0",
            "no_image": pi_env.get("ARC_LAYERED_NO_IMAGE") == "1",
            "fresh_level_session": fresh_level_session, "command": command,
            "pi_version": _pi_cli_version(Path(cli)),
        }, indent=2) + "\n", encoding="utf-8")

        def persist(event: dict[str, Any]) -> None:
            if event.get("type") in PERSISTED_EVENTS:
                trace.write(json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n")
                trace.flush()

        session_index = 0

        def start_kernel() -> PiKernel:
            nonlocal session_index
            session_index += 1
            cmd = list(command)
            cmd[cmd.index("--session") + 1] = str(root / ("session.jsonl" if session_index == 1 else f"session-{session_index}.jsonl"))
            return kernel_class(cmd, cwd=str(root), env=pi_env, timeout=120.0, deadline=deadline, event_sink=persist,
                                event_projector=lambda event: None if event.get("type") == "message_update" else event).start()

        kernel = start_kernel()
        # RPC set_auto_compaction writes the agent dir's settings.json, which may be the user's own profile. The extension
        # cancels every compaction instead.
        pi_state = kernel.send("get_state").get("data", {})
        summary["pi"] = {"auto_compaction_setting": pi_state.get("autoCompactionEnabled"), "thinking": pi_state.get("thinkingLevel"),
                         "context_window": (pi_state.get("model") or {}).get("contextWindow")}

        prompt, overflow_retried, idle_segments, stalls = "Play the game.", False, 0, 0
        consecutive_constructive, consecutive_length, layered_cursor = 0, 0, 0
        max_length_recoveries = int(pi_env.get("ARC_LAYERED_MAX_LENGTH_RECOVERIES", "2"))
        # Pi acknowledges prompt after before_agent_start, which may run the full boundary Audit.
        audit_seconds = (float(pi_env.get("ARC_LAYERED_EVOLUTION_TIMEOUT_MS", "120000")) / 1000
                         if profile == "qwen27b-harness" and pi_env.get("ARC_LAYERED_EVOLUTION") != "0" else 0)
        while True:
            if time.monotonic() >= deadline:
                summary["stop_reason"] = "deadline"
                break
            if max_reported_tokens is not None and used_tokens(harness) >= max_reported_tokens:
                summary["stop_reason"] = "token_cap"
                break
            kernel.prompt(prompt, response_timeout=120.0 + audit_seconds)
            try:
                while True:
                    try:
                        kernel.wait_for_agent_events(timeout=max(1.0, deadline - time.monotonic()), idle_timeout=idle_timeout)
                        break
                    except TimeoutError:
                        # A long python cell emits no Pi events; bridge actions keep harness/heartbeat fresh.
                        beat = harness / "heartbeat"
                        if time.monotonic() >= deadline or not beat.exists() \
                                or time.time() - beat.stat().st_mtime >= idle_timeout:
                            raise
            except TimeoutError as exc:
                kernel.deadline = None
                kernel.abort()
                kernel.wait_for_agent_events(timeout=120.0)
                if time.monotonic() >= deadline:
                    summary["stop_reason"] = "deadline"
                    summary["timeout"] = str(exc)
                    break
                stalls += 1
                summary["provider_stalls"] = stalls
                if stalls >= MAX_PROVIDER_STALLS:
                    summary["stop_reason"] = "idle_timeout"
                    summary["timeout"] = str(exc)
                    break
                prompt = "Continue playing."
                continue
            summary["segments"] += 1
            all_layered = _read_jsonl(harness / "layered.jsonl")
            segment_rows = all_layered[layered_cursor:]
            layered_cursor = len(all_layered)
            end = ([row for row in all_layered if row.get("kind") == "segment_end"] or [{}])[-1]
            reason = end.get("reason")
            summary["segment_reasons"].append(reason)
            state = _bridge_state(bridge_url) or state
            if state.get("state") == "WIN":
                summary["stop_reason"] = "win"
                break
            if _arc_terminal_or_budget_exhausted(state):
                summary["stop_reason"] = "budget_exhausted"
                break
            if max_reported_tokens is not None and used_tokens(harness) >= max_reported_tokens:
                summary["stop_reason"] = "token_cap"
                break
            if reason == "context_overflow" and not overflow_retried:
                overflow_retried = True
            elif reason in ("error", "context_overflow"):
                summary["provider_errors"] += 1
                if summary["provider_errors"] >= MAX_PROVIDER_ERRORS:
                    summary["stop_reason"] = "provider_errors"
                    break
            elif reason == "aborted":
                summary["stop_reason"] = (_provider_admission_stop(harness) or {}).get("stop_reason", "aborted")
                break
            elif reason == "length_exhausted":
                summary["stop_reason"] = "length_truncation"
                break
            changed, parse_errors = _scan_work(root, harness, summary["segments"], work_hashes)
            evolution_changes += changed
            evolution_errors += len(parse_errors)
            activity = _classify_segment_activity(end, segment_rows, changed, len(parse_errors))
            if activity == "acted":
                idle_segments = 0
                consecutive_constructive = 0
                consecutive_length = 0
            elif activity == "length":
                consecutive_length += 1
                if consecutive_length >= max_length_recoveries:
                    summary["stop_reason"] = "length_truncation"
                    break
            elif activity == "constructive" and consecutive_constructive < 2:
                consecutive_constructive += 1
                consecutive_length = 0
            else:
                consecutive_length = 0
                idle_segments += 1
            if not benchmark_only and idle_segments >= MAX_IDLE_SEGMENTS:
                summary["stop_reason"] = "idle"
                break
            prompt = ("Your previous reply hit max output tokens before acting. Call python concisely now."
                      if activity == "length" else "Continue playing.")
            if not benchmark_only and activity != "length" and idle_segments == MAX_IDLE_SEGMENTS - 1:
                prompt += "\nThis is the last idle segment before the run stops. Take an environment action if one is warranted."
            if parse_errors:
                prompt += "\nThese files under work/ do not parse:\n" + "\n".join(parse_errors)
            if (fresh_level_session and reason == "level_change") or end.get("session_oversized"):
                kernel.close()
                kernel = start_kernel()
        state = _bridge_state(bridge_url, attempts=1) or state
        reply = _post_json(bridge_url + "/close", {}, timeout=60.0, action_token=action_token)
        _append_events(root, reply.pop("events", []))
        summary["bridge_close"] = reply
        closed = True
    except Exception as exc:  # noqa: BLE001 - the summary records every runner failure
        summary["stop_reason"] = summary["stop_reason"] or "runner_error"
        summary["error"] = f"{type(exc).__name__}: {exc}"
    finally:
        if kernel is not None:
            summary["pi_stderr_tail"] = kernel.stderr_tail[-2000:]
            kernel.close()
        trace.close()
        _stop_bridge(bridge, bridge_stderr, closed)

    rows = _read_jsonl(harness / "layered.jsonl")
    calls = [row for row in rows if row.get("kind") == "python"]
    evictions = [row for row in rows if row.get("kind") == "evict"]
    changed, parse_errors = _scan_work(root, harness, summary.get("segments", 0), work_hashes)
    budget = state.get("action_budget") or {}
    requests = _request_accounting(_read_jsonl(harness / "request-events.jsonl"))
    usage_rows = _read_jsonl(harness / "usage.jsonl")
    cache_rows = [row for row in usage_rows if row.get("cache_read") is not None and row.get("input") is not None]
    cache_read = sum(int(row["cache_read"]) for row in cache_rows)
    cache_input = sum(int(row["input"]) + int(row["cache_read"]) + int(row.get("cache_write") or 0) for row in cache_rows)
    child_usage = [row for row in usage_rows if row.get("kind") == "subagent"]
    evo_usage = [row for row in usage_rows if row.get("kind") == "evolution"]
    child_known = sum(int(row.get("total") or (int(row.get("input") or 0) + int(row.get("output") or 0))) for row in child_usage)
    evo_known = sum(int(row.get("total") or (int(row.get("input") or 0) + int(row.get("output") or 0))) for row in evo_usage)
    for kind_label, subset, known_tokens in (("subagent", child_usage, child_known), ("evolution", evo_usage, evo_known)):
        if subset:
            requests["by_kind"][kind_label] = {
                "attempts": len(subset), "completed": sum(row.get("cost_status") == "reported" for row in subset),
                "unknown_cost_attempts": sum(row.get("cost_status") != "reported" for row in subset),
            }
            requests["attempts"] += len(subset)
            requests["known_tokens_lower_bound"] += known_tokens
            requests["unknown_cost_attempts"] += sum(row.get("cost_status") != "reported" for row in subset)
            requests["complete_cost_known"] = requests["unknown_cost_attempts"] == 0
    comp_stats_path = harness / "components" / "stats.json"
    comp_stats = json.loads(comp_stats_path.read_text(encoding="utf-8")) if comp_stats_path.is_file() else {}
    if profile == "qwen27b-harness":
        _flush_final_level_replay(root, state, rows, comp_stats)
    def _audits_followed_by_evolution(events: list[dict[str, Any]]) -> int:
        converted = 0
        pending_audit = False
        evo_kinds = {"component_change", "tool_published", "tool_decorated"}
        for ev in events:
            k = ev.get("kind")
            if k == "dual_audit_shown":
                pending_audit = True
            elif pending_audit and (k in evo_kinds or (k == "consult" and ev.get("ok") is True)):
                converted += 1
                pending_audit = False
        return converted

    evo_rounds = [r for r in rows if r.get("kind") == "evolution_round"]
    branch_handoffs = [r for r in rows if r.get("kind") == "branch_handoff"]
    summary.update({
        "actions": budget.get("total_used"), "levels_completed": state.get("levels_completed"), "win_levels": state.get("win_levels"),
        "final_state": state.get("state"), "wall_seconds": round(time.monotonic() - started, 1),
        "reported_tokens": _reported_tokens(harness), "budget_tokens": _budget_tokens(harness),
        "requests": requests["attempts"], "request_accounting": requests,
        "python": {"calls": len(calls), "acting_calls": sum(1 for row in calls if row["acted"]),
                   "actions": sum(row["actions"] for row in calls), "truncated": sum(1 for row in calls if row["truncated"]),
                   "errors": sum(1 for row in calls if row["error"]), "kernel_restarts": sum(1 for row in calls if row["kernel_restarted"]),
                   "stop_reasons": dict(Counter(row["stop_reason"] for row in calls if row["stop_reason"])),
                   "mean_ms": round(sum(row["ms"] for row in calls) / len(calls)) if calls else None},
        "components": {
            "changes": sum(1 for r in rows if r.get("kind") == "component_change"),
            "reads": sum(1 for r in rows if r.get("kind") == "read_component"),
            "tools_published": sum(1 for r in rows if r.get("kind") == "tool_published"),
            "tool_publish_failed": sum(1 for r in rows if r.get("kind") == "tool_publish_failed"),
            "bound_invocations": sum(1 for r in rows if r.get("kind") == "bound_invocation"),
            "bound_ok": sum(1 for r in rows if r.get("kind") == "bound_invocation" and r.get("ok") is True),
            "lib_invocations": sum(1 for r in rows if r.get("kind") == "lib_invocation"),
            "lib_ok": sum(1 for r in rows if r.get("kind") == "lib_invocation" and r.get("ok") is True),
            "live_injected": sum(1 for r in rows if r.get("kind") == "live_injected"),
            "memory_verify_syncs": sum(1 for r in rows if r.get("kind") == "memory_verify_sync"),
            "memory_verify_failures": sum(1 for r in rows if r.get("kind") == "memory_verify_failure"),
            "at_tool_published": sum(1 for r in rows if r.get("kind") == "tool_decorated"),
            "dual_audits_shown": sum(1 for r in rows if r.get("kind") == "dual_audit_shown"),
            "dual_audits_by_boundary": dict(Counter(r.get("boundary") for r in rows if r.get("kind") == "dual_audit_shown" and r.get("boundary"))),
            "audits_followed_by_evolution": _audits_followed_by_evolution(rows),
            "stats": comp_stats,
        },
        "evolution_rounds": {
            "count": len(evo_rounds),
            "ok": sum(1 for r in evo_rounds if r.get("ok") is True),
            "failed": sum(1 for r in evo_rounds if r.get("ok") is False),
            "evolved": sum(1 for r in evo_rounds if r.get("ok") is True and (r.get("decision") == "evolved" or bool(r.get("mutations")))),
            "no_change": sum(1 for r in evo_rounds if r.get("ok") is True and r.get("decision") == "no_change" and not r.get("mutations")),
            "incomplete": sum(1 for r in evo_rounds if r.get("ok") is True and r.get("decision") == "incomplete" and not r.get("mutations")),
            "by_exit_reason": dict(Counter(r.get("exit_reason") for r in evo_rounds if r.get("exit_reason"))),
            "by_boundary": dict(Counter(r.get("boundary") for r in evo_rounds if r.get("boundary"))),
            "tokens_lower_bound": evo_known,
            "ms_total": sum(int(r.get("ms") or 0) for r in evo_rounds),
        },
        "subagents": {"consult_ok": sum(1 for r in rows if r.get("kind") == "consult" and r.get("ok") is True),
                      "consult_failed": sum(1 for r in rows if r.get("kind") == "consult" and r.get("ok") is False),
                      "child_tokens_lower_bound": child_known},
        "length_truncations": sum(1 for r in rows if r.get("kind") == "length_truncation"),
        "cache_read_rate": cache_read / cache_input if cache_input else None,
        "branch_handoffs": {
            "autonomous_fetch_followed_by_action": len(branch_handoffs),
            "branch_consistent_action": sum(row["aligned"] for row in branch_handoffs),
            "upward_writeback": sum(row["aligned"] and row["upward_writeback"] for row in branch_handoffs),
            "repeat_mismatch_candidates": sum(row["repeat_mismatch"] for row in branch_handoffs),
            "opportunities": None,  # Requires review of applicable states, including missed calls.
        },
        "evictions": {"count": len(evictions), "tokens_removed": sum(row["tokens_removed"] for row in evictions)},
        "folds": sum(row["parts"] for row in rows if row.get("kind") == "fold"),
        "compactions": sum(1 for row in rows if row.get("kind") == "compact"),
        "evolution": {"changes": evolution_changes + changed, "syntax_errors": evolution_errors + len(parse_errors)},
        "work_snapshot": _git_snapshot(root),
        "sessions": max(1, sum(1 for _ in root.glob("session*.jsonl"))),
        "context_overflows": sum(1 for row in rows if row.get("kind") == "context_overflow"),
        "evidence": _layered_evidence(root),
    })
    path = root / "summary.json"
    path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("root", type=Path)
    parser.add_argument("--game", required=True)
    parser.add_argument("--config", choices=CONFIGS, default="api-research")
    parser.add_argument("--profile", choices=PROFILES, default="qwen27b")
    parser.add_argument("--arc-root", type=Path, default=Path("D:/arc-agi-benchmark/arc-agi-3-benchmarking"))
    parser.add_argument("--provider", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--provider-extension", type=Path)
    parser.add_argument("--agent-dir", type=Path)
    parser.add_argument("--thinking")
    parser.add_argument("--max-output-tokens", type=int)
    parser.add_argument("--max-actions", type=int)
    parser.add_argument("--max-reported-tokens", type=int)
    parser.add_argument("--wall-seconds", type=float, default=3600.0)
    parser.add_argument("--segment-seconds", type=float, default=1200.0)
    parser.add_argument("--no-image", action="store_true")
    parser.add_argument("--fresh-level-session", action="store_true")
    parser.add_argument("--dotenv-root", type=Path, default=PROJECT_ROOT)
    args = parser.parse_args()
    extension_env = {"ARC_LAYERED_NO_IMAGE": "1"} if args.no_image else None
    path = run_arc_layered_e2e(args.root, game=args.game, arc_root=args.arc_root, pi_provider=args.provider, pi_model=args.model,
                               config=args.config, profile=args.profile, provider_extension=args.provider_extension, agent_dir=args.agent_dir,
                               thinking=args.thinking, max_actions=args.max_actions, max_reported_tokens=args.max_reported_tokens,
                               wall_seconds=args.wall_seconds, segment_seconds=args.segment_seconds, extension_env=extension_env,
                               fresh_level_session=args.fresh_level_session, dotenv_root=args.dotenv_root,
                               max_output_tokens=args.max_output_tokens)
    summary = json.loads(path.read_text(encoding="utf-8"))
    print(json.dumps({key: summary.get(key) for key in ("stop_reason", "segments", "actions", "levels_completed", "requests",
                                                         "reported_tokens", "evolution", "sessions", "error")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
