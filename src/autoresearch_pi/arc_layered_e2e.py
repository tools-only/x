"""One ARC game with the layered profile: one Pi session, one python tool, segments opened by this runner.

A segment is one prompt. The extension (demo/arc_layered_extension.ts) keeps the model playing inside a segment and
ends it at a level change, a win, a length stop, repeated idle replies or a soft limit; the runner opens the next one
in the same session. Design: docs/plans/2026-11-23-arc-layered-duck-aligned-dev-plan.md sections 5 and 8.
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
from .arc_agi_3_e2e import _arc_terminal_or_budget_exhausted, _pi_cli_version, _post_json, _read_jsonl, _resolve_pi_cli, _wait_for_bridge
from .arc_thin_e2e import (PROJECT_ROOT, PERSISTED_EVENTS, _append_events, _bridge_state, _budget_tokens, _provider_admission_stop, _reported_tokens,
                           _request_accounting, _start_bridge, _stop_bridge, _write_models_json)
from .pi_kernel import PiKernel
from .project import load_project_dotenv

EXTENSION = PROJECT_ROOT / "demo" / "arc_layered_extension.ts"
CONFIGS = ("kaggle-local", "api-research")
MAX_PROVIDER_ERRORS = 3
MAX_IDLE_SEGMENTS = 2


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


def run_arc_layered_e2e(root: Path, *, game: str, arc_root: Path, pi_provider: str, pi_model: str, config: str = "api-research",
                        provider_extension: Path | None = None, agent_dir: Path | None = None, thinking: str | None = None,
                        max_actions: int | None = None, max_reported_tokens: int | None = None, wall_seconds: float = 3600.0,
                        segment_seconds: float = 1200.0, segment_tokens: int = 200_000, idle_continuations: int = 3,
                        idle_timeout: float = 300.0, max_output_tokens: int = 12000, count_cache: bool = False, dotenv_root: Path = PROJECT_ROOT, extension_env: dict[str, str] | None = None,
                        fresh_level_session: bool = False, kernel_class: type[PiKernel] = PiKernel) -> Path:
    if config not in CONFIGS:
        raise ValueError(f"config must be one of {CONFIGS}")
    root = root.resolve()
    harness = root / "harness"
    harness.mkdir(parents=True, exist_ok=True)
    env = load_project_dotenv(dotenv_root)
    used_tokens = _reported_tokens if count_cache else _budget_tokens
    started = time.monotonic()
    deadline = started + wall_seconds
    summary: dict[str, Any] = {"format": "arc-layered-run-v1", "game": game, "config": config, "provider": pi_provider,
                               "model": pi_model, "thinking": thinking or "provider-default", "stop_reason": None,
                               "segments": 0, "segment_reasons": [], "provider_errors": 0}
    bridge, bridge_stderr, launch_id, action_token = _start_bridge(
        root, arc_root=arc_root, game=game, max_actions=max_actions, env=env, bridge_python=None, bridge_module_paths=())
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
                       "ARC_RUN_ROOT": str(root), "ARC_GAME": game, "ARC_LAYERED_CONFIG": config, "ARC_LAYERED_COUNT_CACHE": str(int(count_cache)), "ARC_LAYERED_OUTPUT_TOKENS": str(max_output_tokens),
                       "ARC_LAYERED_SEGMENT_SECONDS": str(segment_seconds), "ARC_LAYERED_SEGMENT_TOKENS": str(segment_tokens),
                       "ARC_LAYERED_IDLE_CONTINUATIONS": str(idle_continuations), **(extension_env or {})})
        command = [node, cli, "--mode", "rpc", "--provider", pi_provider, "--model", pi_model, "--session", str(root / "session.jsonl"),
                   "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-builtin-tools",
                   *(["--thinking", thinking] if thinking else []), "--extension", str(EXTENSION)]
        if provider_extension is not None:
            command.extend(["--extension", str(provider_extension.resolve())])
        if max_reported_tokens is not None:
            command.extend(["--extension", str(PROJECT_ROOT / "demo" / "pi_final_provider_payload.ts")])
        (root / "run-config.json").write_text(json.dumps({
            **{key: summary[key] for key in ("format", "game", "config", "provider", "model", "thinking")},
            "max_actions": max_actions, "max_reported_tokens": max_reported_tokens, "token_cap_measure": "total_with_cache" if count_cache else "uncached_input+output",
            "wall_seconds": wall_seconds, "segment_seconds": segment_seconds, "segment_tokens": segment_tokens,
            "idle_continuations": idle_continuations, "max_output_tokens": max_output_tokens, "extension_env": extension_env or {},
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

        prompt, overflow_retried, idle_segments = "Play the game.", False, 0
        while True:
            if time.monotonic() >= deadline:
                summary["stop_reason"] = "deadline"
                break
            if max_reported_tokens is not None and used_tokens(harness) >= max_reported_tokens:
                summary["stop_reason"] = "token_cap"
                break
            kernel.prompt(prompt)
            try:
                kernel.wait_for_agent_events(timeout=max(1.0, deadline - time.monotonic()), idle_timeout=idle_timeout)
            except TimeoutError as exc:
                kernel.deadline = None
                kernel.abort()
                kernel.wait_for_agent_events(timeout=120.0)
                summary["stop_reason"] = "deadline" if time.monotonic() >= deadline else "idle_timeout"
                summary["timeout"] = str(exc)
                break
            summary["segments"] += 1
            end = ([row for row in _read_jsonl(harness / "layered.jsonl") if row.get("kind") == "segment_end"] or [{}])[-1]
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
            idle_segments = idle_segments + 1 if not end.get("actions") else 0
            if idle_segments >= MAX_IDLE_SEGMENTS:
                summary["stop_reason"] = "idle"
                break
            changed, parse_errors = _scan_work(root, harness, summary["segments"], work_hashes)
            evolution_changes += changed
            evolution_errors += len(parse_errors)
            prompt = "Continue playing."
            if parse_errors:
                prompt += "\nThese files under work/ do not parse:\n" + "\n".join(parse_errors)
            if fresh_level_session and reason == "level_change":
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
        "evictions": {"count": len(evictions), "tokens_removed": sum(row["tokens_removed"] for row in evictions)},
        "folds": sum(row["parts"] for row in rows if row.get("kind") == "fold"),
        "compactions": sum(1 for row in rows if row.get("kind") == "compact"),
        "evolution": {"changes": evolution_changes + changed, "syntax_errors": evolution_errors + len(parse_errors)},
        "work_snapshot": _git_snapshot(root),
        "sessions": max(1, sum(1 for _ in root.glob("session*.jsonl"))),
        "context_overflows": sum(1 for row in rows if row.get("kind") == "context_overflow"),
    })
    path = root / "summary.json"
    path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("root", type=Path)
    parser.add_argument("--game", required=True)
    parser.add_argument("--config", choices=CONFIGS, default="api-research")
    parser.add_argument("--arc-root", type=Path, default=Path("D:/arc-agi-benchmark/arc-agi-3-benchmarking"))
    parser.add_argument("--provider", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--provider-extension", type=Path)
    parser.add_argument("--agent-dir", type=Path)
    parser.add_argument("--thinking")
    parser.add_argument("--max-actions", type=int)
    parser.add_argument("--max-reported-tokens", type=int)
    parser.add_argument("--wall-seconds", type=float, default=3600.0)
    parser.add_argument("--segment-seconds", type=float, default=1200.0)
    parser.add_argument("--fresh-level-session", action="store_true")
    parser.add_argument("--dotenv-root", type=Path, default=PROJECT_ROOT)
    args = parser.parse_args()
    path = run_arc_layered_e2e(args.root, game=args.game, arc_root=args.arc_root, pi_provider=args.provider, pi_model=args.model,
                               config=args.config, provider_extension=args.provider_extension, agent_dir=args.agent_dir,
                               thinking=args.thinking, max_actions=args.max_actions, max_reported_tokens=args.max_reported_tokens,
                               wall_seconds=args.wall_seconds, segment_seconds=args.segment_seconds,
                               fresh_level_session=args.fresh_level_session, dotenv_root=args.dotenv_root)
    summary = json.loads(path.read_text(encoding="utf-8"))
    print(json.dumps({key: summary.get(key) for key in ("stop_reason", "segments", "actions", "levels_completed", "requests",
                                                         "reported_tokens", "evolution", "sessions", "error")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
