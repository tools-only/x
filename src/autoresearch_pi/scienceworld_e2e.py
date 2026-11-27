"""One ScienceWorld run with the layered text profile: one Pi session, one python tool, decisions opened by this runner.

The extension (demo/scienceworld_layered_extension.ts) ends a decision after a Python call executes actions; the runner
opens the next one in the same Pi session. The ScienceWorld bridge keeps a single JVM process alive for the whole run.
"""

from __future__ import annotations

import argparse
import json
import os
import secrets
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from .arc_agi_3_adapter import resolve_model_settings
from .arc_layered_support import (PROJECT_ROOT, _read_jsonl, _resolve_pi_cli, _write_models_json)
from .pi_kernel import PiKernel
from .project import load_project_dotenv

EXTENSION = PROJECT_ROOT / "demo" / "scienceworld_layered_extension.ts"
PROFILES = ("layered", "harness")
MAX_PROVIDER_ERRORS = 3
MAX_IDLE_SEGMENTS = 4


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _start_bridge(root: Path, *, env: dict[str, str], task: str, variations: list[int], max_steps: int,
                  port: int, bridge_python: Path, scienceworld_path: Path, jre_home: Path
                  ) -> tuple[subprocess.Popen[str], Any, str]:
    if not bridge_python.is_file():
        raise FileNotFoundError(f"ScienceWorld interpreter was not found: {bridge_python}")
    if not (scienceworld_path / "scienceworld").is_dir():
        raise FileNotFoundError(f"scienceworld package directory was not found: {scienceworld_path}")
    java_bin = jre_home / "bin"
    if not (java_bin / ("java.exe" if os.name == "nt" else "java")).exists():
        raise FileNotFoundError(f"JRE bin directory was not found: {java_bin}")
    action_token = secrets.token_urlsafe(32)
    bridge_env = dict(env)
    bridge_env["PYTHONPATH"] = os.pathsep.join([str(Path(__file__).resolve().parent.parent), str(scienceworld_path),
                                                env.get("PYTHONPATH", "")])
    bridge_env["JAVA_HOME"] = str(jre_home)
    bridge_env["PATH"] = str(java_bin) + os.pathsep + bridge_env.get("PATH", "")
    command = [str(bridge_python), "-m", "autoresearch_pi.scienceworld_bridge", "--task", task,
               "--variations", ",".join(str(v) for v in variations), "--max-steps", str(max_steps),
               "--port", str(port), "--token", action_token]
    bridge_stderr = (root / "bridge-stderr.log").open("w", encoding="utf-8")
    try:
        bridge = subprocess.Popen(command, cwd=str(root), text=True, stdout=subprocess.PIPE, stderr=bridge_stderr,
                                  env=bridge_env)
    except OSError:
        bridge_stderr.close()
        raise
    return bridge, bridge_stderr, action_token


def _wait_for_bridge(url: str, process: subprocess.Popen[str], timeout: float = 90.0) -> None:
    deadline = time.monotonic() + timeout
    import urllib.request

    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"ScienceWorld bridge exited before ready (returncode={process.returncode})")
        try:
            with urllib.request.urlopen(url + "/state", timeout=2.0) as response:
                json.loads(response.read())
                return
        except Exception:
            time.sleep(0.25)
    raise TimeoutError("timed out waiting for the ScienceWorld bridge; see bridge-stderr.log")


def _get_json(url: str, timeout: float = 10.0) -> dict[str, Any] | None:
    import urllib.error
    import urllib.request

    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            value = json.loads(response.read())
        return value if isinstance(value, dict) else None
    except (OSError, urllib.error.URLError, ValueError):
        return None


def _stop_bridge(bridge: subprocess.Popen[str], bridge_stderr: Any) -> None:
    if bridge.poll() is None:
        bridge.terminate()
        try:
            bridge.wait(timeout=10)
        except subprocess.TimeoutExpired:
            bridge.kill()
            bridge.wait(timeout=10)
    bridge_stderr.close()


def _terminal_or_budget(state: dict[str, Any]) -> bool:
    if str(state.get("state", "")) == "WIN":
        return True
    if str(state.get("state", "")) == "GAME_OVER":
        return True
    return int(state.get("budget_left") or 0) <= 0 or int(state.get("level_budget_left") or 0) <= 0


def _cost_usd(harness: Path, in_rate: float, out_rate: float, cache_rate: float) -> tuple[float, int]:
    """Estimate spent dollars from provider-reported tokens; count requests with unknown usage."""
    spent = 0.0
    unknown = 0
    for row in _read_jsonl(harness / "usage.jsonl"):
        total = row.get("total")
        if total is None:
            total = int(row.get("input") or 0) + int(row.get("output") or 0)
        if not isinstance(total, (int, float)) or total <= 0:
            unknown += 1
            continue
        spent += (int(row.get("input") or 0) * in_rate
                  + int(row.get("output") or 0) * out_rate
                  + int(row.get("cache_read") or 0) * cache_rate) / 1_000_000
    return spent, unknown


def run_scienceworld_e2e(root: Path, *, task: str, variations: list[int], max_steps: int, provider: str, model: str,
                         profile: str = "harness", thinking: str | None = None, max_output_tokens: int = 4096,
                         wall_seconds: float = 1800.0, budget_usd: float = 20.0, dotenv_root: Path = PROJECT_ROOT,
                         bridge_python: Path | None = None, scienceworld_path: Path | None = None,
                         jre_home: Path | None = None, agent_dir: Path | None = None) -> Path:
    if profile not in PROFILES:
        raise ValueError(f"profile must be one of {PROFILES}")
    root = root.resolve()
    harness = root / "harness"
    harness.mkdir(parents=True, exist_ok=True)
    env = load_project_dotenv(dotenv_root)
    settings = resolve_model_settings(env)
    bridge_python = (bridge_python or Path(sys.executable)).resolve()
    scienceworld_path = (scienceworld_path or Path(r"D:\agent\.cache\scienceworld\python")).resolve()
    jre_home = (jre_home or Path(r"D:\agent\.cache\scienceworld\jre17\jdk-17.0.21.1+2-jre")).resolve()
    in_rate = float(env.get("SCIENCEWORLD_USD_PER_MTOKEN_INPUT", "3.0"))
    out_rate = float(env.get("SCIENCEWORLD_USD_PER_MTOKEN_OUTPUT", "12.0"))
    cache_rate = float(env.get("SCIENCEWORLD_USD_PER_MTOKEN_CACHE_READ", "0.3"))
    started = time.monotonic()
    deadline = started + wall_seconds
    summary: dict[str, Any] = {"format": "scienceworld-layered-run-v1", "task": task, "variations": variations,
                               "profile": profile, "provider": provider, "model": model, "stop_reason": None,
                               "segments": 0, "segment_reasons": [], "provider_errors": 0, "budget_usd": budget_usd,
                               "usd_rates": {"input_per_mtok": in_rate, "output_per_mtok": out_rate, "cache_read_per_mtok": cache_rate}}
    port = _free_port()
    bridge, bridge_stderr, action_token = _start_bridge(root, env=env, task=task, variations=variations,
                                                        max_steps=max_steps, port=port, bridge_python=bridge_python,
                                                        scienceworld_path=scienceworld_path, jre_home=jre_home)
    bridge_url = f"http://127.0.0.1:{port}"
    kernel: PiKernel | None = None
    closed = False
    state: dict[str, Any] = {}
    trace = (root / "pi-events.jsonl").open("a", encoding="utf-8")
    try:
        _wait_for_bridge(bridge_url, bridge)
        node, cli = _resolve_pi_cli()
        pi_env = dict(env)
        if agent_dir is None:
            agent_dir = root / ".pi-agent"
            agent_dir.mkdir(exist_ok=True)
            (agent_dir / "settings.json").write_text(json.dumps({"compaction": {"enabled": False}}) + "\n", encoding="utf-8")
            text_settings = {**settings, "input_modalities": ["text"]}
            pi_env["OPENAI_API_BASE"], pi_env["OPENAI_API_KEY"] = str(text_settings["base_url"]), str(text_settings["api_key"])
            _write_models_json(agent_dir, provider, model, text_settings)
        pi_env.update({"PI_CODING_AGENT_DIR": str(agent_dir), "SCIENCEWORLD_BRIDGE_URL": bridge_url,
                       "SCIENCEWORLD_ACTION_TOKEN": action_token, "SCIENCEWORLD_RUN_ROOT": str(root),
                       "SCIENCEWORLD_PROFILE": profile, "SCIENCEWORLD_OUTPUT_TOKENS": str(max_output_tokens)})
        command = [node, cli, "--mode", "rpc", "--provider", provider, "--model", model, "--session", str(root / "session.jsonl"),
                   "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-builtin-tools",
                   *(["--thinking", thinking] if thinking else []), "--extension", str(EXTENSION)]
        (root / "run-config.json").write_text(json.dumps({
            **{key: summary[key] for key in ("format", "task", "variations", "profile", "provider", "model")},
            "thinking": thinking or "provider-default", "max_output_tokens": max_output_tokens, "max_steps": max_steps,
            "budget_usd": budget_usd, "usd_rates": summary["usd_rates"], "wall_seconds": wall_seconds,
            "command": command, "scienceworld_path": str(scienceworld_path), "jre_home": str(jre_home),
        }, indent=2) + "\n", encoding="utf-8")

        def persist(event: dict[str, Any]) -> None:
            if event.get("type") in ("response", "turn_start", "turn_end", "agent_start", "agent_end", "agent_settled",
                                     "message_start", "message_end", "tool_execution_start", "tool_execution_end", "extension_error"):
                trace.write(json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n")
                trace.flush()

        kernel = PiKernel(command, cwd=str(root), env=pi_env, timeout=120.0, deadline=deadline, event_sink=persist,
                          event_projector=lambda event: None if event.get("type") == "message_update" else event).start()
        prompt = "Play the science task."
        idle_segments = 0
        layered_cursor = 0
        while True:
            if time.monotonic() >= deadline:
                summary["stop_reason"] = "deadline"
                break
            spent_usd, unknown_usage = _cost_usd(harness, in_rate, out_rate, cache_rate)
            summary["spent_usd_estimate"] = round(spent_usd, 6)
            summary["unknown_usage_requests"] = unknown_usage
            if spent_usd >= budget_usd:
                summary["stop_reason"] = "cost_cap"
                break
            kernel.prompt(prompt)
            try:
                kernel.wait_for_agent_events(timeout=max(1.0, deadline - time.monotonic()), idle_timeout=300.0)
            except TimeoutError as exc:
                summary["stop_reason"] = "idle_timeout"
                summary["timeout"] = str(exc)
                break
            summary["segments"] += 1
            all_layered = _read_jsonl(harness / "layered.jsonl")
            segment_rows = all_layered[layered_cursor:]
            layered_cursor = len(all_layered)
            end = ([row for row in all_layered if row.get("kind") == "segment_end"] or [{}])[-1]
            reason = end.get("reason")
            segment_actions = int(end.get("actions") or 0)
            summary["segment_reasons"].append(reason)
            state = _get_json(bridge_url + "/state") or state
            if state.get("state") == "WIN":
                summary["stop_reason"] = "win"
                break
            if _terminal_or_budget(state):
                summary["stop_reason"] = "budget_exhausted"
                break
            if reason in ("error", "context_overflow"):
                summary["provider_errors"] += 1
                if summary["provider_errors"] >= MAX_PROVIDER_ERRORS:
                    summary["stop_reason"] = "provider_errors"
                    break
            elif reason in ("length_exhausted", "length"):
                summary["stop_reason"] = "length_truncation"
                break
            if segment_actions > 0:
                idle_segments = 0
            else:
                idle_segments += 1
            if idle_segments >= MAX_IDLE_SEGMENTS:
                summary["stop_reason"] = "idle"
                break
            prompt = "Continue playing."
    except Exception as exc:  # noqa: BLE001
        summary["stop_reason"] = summary["stop_reason"] or "runner_error"
        summary["error"] = f"{type(exc).__name__}: {exc}"
    finally:
        if kernel is not None:
            summary["pi_stderr_tail"] = kernel.stderr_tail[-2000:]
            kernel.close()
        trace.close()
        _stop_bridge(bridge, bridge_stderr)

    rows = _read_jsonl(harness / "layered.jsonl")
    calls = [row for row in rows if row.get("kind") == "python"]
    spent_usd, unknown_usage = _cost_usd(harness, in_rate, out_rate, cache_rate)
    summary.update({
        "actions": state.get("actions_used"), "levels_completed": state.get("levels_completed"),
        "win_levels": state.get("win_levels"), "final_state": state.get("state"),
        "wall_seconds": round(time.monotonic() - started, 1),
        "spent_usd_estimate": round(spent_usd, 6), "unknown_usage_requests": unknown_usage,
        "python": {"calls": len(calls), "acting_calls": sum(1 for row in calls if row.get("acted")),
                   "actions": sum(row.get("actions") or 0 for row in calls),
                   "truncated": sum(1 for row in calls if row.get("truncated")),
                   "errors": sum(1 for row in calls if row.get("error")),
                   "kernel_restarts": sum(1 for row in calls if row.get("kernel_restarted"))},
        "component_changes": sum(1 for row in rows if row.get("kind") == "component_change"),
        "reads": sum(1 for row in rows if row.get("kind") == "read_component"),
    })
    path = root / "summary.json"
    path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("root", type=Path)
    parser.add_argument("--task", required=True)
    parser.add_argument("--variations", required=True, help="comma-separated variation indices")
    parser.add_argument("--max-steps", type=int, default=100)
    parser.add_argument("--profile", choices=PROFILES, default="harness")
    parser.add_argument("--provider", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--thinking")
    parser.add_argument("--max-output-tokens", type=int, default=4096)
    parser.add_argument("--wall-seconds", type=float, default=1800.0)
    parser.add_argument("--budget-usd", type=float, default=20.0)
    parser.add_argument("--dotenv-root", type=Path, default=PROJECT_ROOT)
    parser.add_argument("--agent-dir", type=Path)
    parser.add_argument("--bridge-python", type=Path)
    parser.add_argument("--scienceworld-path", type=Path)
    parser.add_argument("--jre-home", type=Path)
    args = parser.parse_args()
    variations = [int(x) for x in args.variations.split(",") if x.strip()]
    path = run_scienceworld_e2e(args.root, task=args.task, variations=variations, max_steps=args.max_steps,
                                provider=args.provider, model=args.model, profile=args.profile, thinking=args.thinking,
                                max_output_tokens=args.max_output_tokens, wall_seconds=args.wall_seconds,
                                budget_usd=args.budget_usd, dotenv_root=args.dotenv_root, agent_dir=args.agent_dir,
                                bridge_python=args.bridge_python, scienceworld_path=args.scienceworld_path,
                                jre_home=args.jre_home)
    summary = json.loads(path.read_text(encoding="utf-8"))
    print(json.dumps({key: summary.get(key) for key in ("stop_reason", "segments", "actions", "levels_completed",
                                                         "final_state", "spent_usd_estimate", "error")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
