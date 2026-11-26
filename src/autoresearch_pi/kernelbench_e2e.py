"""One serial Pi session for a prepared KernelBench task."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any

from .arc_agi_3_adapter import resolve_model_settings
from .pi_kernel import PiKernel
from .project import load_project_dotenv


PROJECT_ROOT = Path(__file__).resolve().parents[2]
EXTENSION = PROJECT_ROOT / "demo" / "kernelbench_extension.ts"


def _pi_cli() -> tuple[str, str]:
    node = shutil.which("node")
    if not node:
        raise RuntimeError("node executable was not found")
    override = os.environ.get("PI_AUTORESEARCH_PI_CLI")
    candidates = [Path(override)] if override else []
    candidates.append(PROJECT_ROOT / "node_modules" / "@earendil-works" / "pi-coding-agent" / "dist" / "cli.js")
    candidates.append(Path(node).resolve().parent / "node_modules" / "@earendil-works" / "pi-coding-agent" / "dist" / "cli.js")
    for cli in candidates:
        if cli.is_file():
            return node, str(cli)
    raise RuntimeError("Pi CLI was not found. Install the pinned project dependencies or set PI_AUTORESEARCH_PI_CLI")


def run_kernelbench_e2e(
    root: Path, *, provider: str, model: str, server_url: str,
    wall_seconds: float = 7200.0, turn_seconds: float = 3600.0,
) -> Path:
    root = root.resolve()
    manifest_path = root / "task.json"
    if not manifest_path.is_file():
        raise FileNotFoundError(f"prepared KernelBench task missing: {manifest_path}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not (root / "task.triton").is_file() or not (root / "reference.py").is_file():
        raise FileNotFoundError("prepared task must contain task.triton and reference.py")
    env = load_project_dotenv(PROJECT_ROOT)
    settings = resolve_model_settings(env)
    selected_model = model or settings["model"]
    selected_provider = provider or "openai"
    node, cli = _pi_cli()
    agent_dir = root / ".pi-agent"
    agent_dir.mkdir(exist_ok=True)
    (agent_dir / "settings.json").write_text(json.dumps({"compaction": {"enabled": False}}) + "\n", encoding="utf-8")
    if settings.get("base_url") and settings.get("api_key"):
        settings_path = agent_dir / "models.json"
        settings_path.write_text(json.dumps({"providers": {selected_provider: {
            "baseUrl": settings["base_url"], "apiKey": settings["api_key"], "api": settings["pi_api"],
            "models": [{"id": selected_model, "name": selected_model, "reasoning": True, "input": ["text"], "contextWindow": settings["context_window"]}],
        }}}, indent=2) + "\n", encoding="utf-8")
    env.update({"PI_CODING_AGENT_DIR": str(agent_dir), "KERNELBENCH_RUN_ROOT": str(root),
                "KERNELBENCH_SERVER_URL": server_url.rstrip("/"),
                "KERNELBENCH_BACKEND": os.environ.get("KERNELBENCH_BACKEND", "cuda")})
    command = [node, cli, "--mode", "rpc", "--provider", selected_provider, "--model", selected_model,
               "--session", str(root / "session.jsonl"), "--no-extensions", "--no-skills",
               "--no-prompt-templates", "--no-context-files", "--no-builtin-tools", "--extension", str(EXTENSION)]
    deadline = time.monotonic() + wall_seconds
    events_path = root / "pi-events.jsonl"
    summary: dict[str, Any] = {"task": manifest["task"], "provider": selected_provider, "model": selected_model,
                              "server_url": server_url, "status": "running", "pi_events": str(events_path)}
    with events_path.open("a", encoding="utf-8") as events_file:
        def record(event: dict[str, Any]) -> None:
            if event.get("type") in {"message_end", "tool_execution_start", "tool_execution_end", "agent_end", "agent_settled"}:
                events_file.write(json.dumps(event, ensure_ascii=False) + "\n")
                events_file.flush()

        kernel = PiKernel(command, cwd=str(root), env=env, timeout=turn_seconds, deadline=deadline,
                          event_sink=record, event_projector=lambda event: None if event.get("type") == "message_update" else event)
        started = time.monotonic()
        try:
            kernel.start()
            state = kernel.send("get_state").get("data", {})
            summary["pi"] = {"context_window": (state.get("model") or {}).get("contextWindow")}
            kernel.prompt("Optimize this KernelBench task. Read task.triton and reference.py, then work only in work/candidate.py. Use kernel_eval check before benchmark when useful. Continue until the task budget is nearly exhausted or you have a strong correct candidate, then report the best candidate hash and measured result.")
            while time.monotonic() < deadline:
                remaining = deadline - time.monotonic()
                kernel.wait_for_agent_events(timeout=min(turn_seconds, remaining))
                if kernel.process and kernel.process.poll() is not None:
                    break
                if any(event.payload.get("type") == "agent_settled" for event in kernel.events[-8:]):
                    # A settled turn is the completion boundary for this single-session baseline.
                    break
            summary["status"] = "complete"
        except TimeoutError as error:
            summary["status"] = "timeout"
            summary["error"] = str(error)
        except Exception as error:
            summary["status"] = "failed"
            summary["error"] = str(error)
            summary["stderr_tail"] = kernel.stderr_tail
        finally:
            summary["wall_seconds"] = round(time.monotonic() - started, 3)
            summary["candidate"] = str(root / "workspace" / "work" / "candidate.py")
            kernel.close()
    output = root / "pi-summary.json"
    output.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return output
