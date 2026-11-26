"""Run one ALE-Bench problem inside a real Pi RPC session."""

from __future__ import annotations

import json
import os
import secrets
import subprocess
import time
from pathlib import Path
from typing import Any

from .ale_bench_bridge_server import serve
from .arc_layered_support import _resolve_pi_cli, _write_models_json
from .arc_agi_3_adapter import resolve_model_settings
from .pi_kernel import PiKernel
from .project import load_project_dotenv


def run_ale_bench_pi_e2e(root: Path, *, problem_id: str, prompt: str, provider: str = "yibu",
                         model: str = "qwen3.8-27b", lite_version: bool = True,
                         max_public: int = 8, max_case: int = 32, max_output_tokens: int = 12000,
                         wall_seconds: float = 1800.0, harness_profile: str = "A") -> Path:
    root = root.resolve()
    if root.exists() and any(root.iterdir()):
        raise ValueError("ALE-Bench Pi run root must be empty")
    root.mkdir(parents=True, exist_ok=True)
    project_root = Path(__file__).resolve().parents[2]
    env_file = os.environ.get("ALE_ENV_FILE")
    if env_file:
        env_path = Path(env_file).expanduser().resolve()
        env = load_project_dotenv(env_path.parent)
    else:
        env_path = project_root / ".env"
        alternate = Path(r"D:\autoresearch_pi_project\.env")
        if alternate.is_file():
            env_path = alternate
        env = load_project_dotenv(env_path.parent)
    if env_path.is_file():
        for raw_line in env_path.read_text(encoding="utf-8-sig").splitlines():
            line = raw_line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                env[key.strip()] = value.strip().strip("\"'")
    bridge_command = [str(Path(os.sys.executable)), "-m", "autoresearch_pi.ale_bench_bridge_server", "--root", str(root), "--problem-id", problem_id, "--max-public", str(max_public), "--max-case", str(max_case)]
    if not lite_version:
        bridge_command.append("--full")
    bridge_env = {**env, "PYTHONPATH": str(Path(__file__).resolve().parents[1]), "PYTHONUTF8": "1"}
    bridge = subprocess.Popen(bridge_command, cwd=str(root), env=bridge_env, stdout=subprocess.DEVNULL, stderr=(root / "bridge-stderr.log").open("w", encoding="utf-8"), text=True)
    kernel: PiKernel | None = None
    try:
        ready_path = root / "bridge-ready.json"
        deadline = time.monotonic() + 300
        while not ready_path.is_file() and time.monotonic() < deadline:
            if bridge.poll() is not None: raise RuntimeError("ALE bridge exited before ready")
            time.sleep(0.1)
        ready = json.loads(ready_path.read_text(encoding="utf-8"))
        agent_dir = root / ".pi-agent"
        agent_dir.mkdir()
        settings = resolve_model_settings(env)
        if provider == "az":
            settings["base_url"] = env.get("OPENAI_API_BASE")
            settings["api_key"] = env.get("OPENAI_API_KEY")
            settings["pi_api"] = "openai-completions"
        _write_models_json(agent_dir, provider, model, {**settings, "input_modalities": ["text"]})
        node, cli = _resolve_pi_cli()
        pi_env = {**env, "PI_CODING_AGENT_DIR": str(agent_dir), "ALE_RUN_ROOT": str(root),
                  "ALE_BRIDGE_URL": f"http://127.0.0.1:{ready['port']}", "ALE_BRIDGE_TOKEN": ready["token"],
                  "ALE_PROBLEM_ID": problem_id, "ALE_MAX_OUTPUT_TOKENS": str(max_output_tokens), "ALE_HARNESS_PROFILE": harness_profile}
        extension = Path(__file__).resolve().parents[2] / "demo" / "ale_bench_pi_extension.ts"
        command = [node, cli, "--mode", "rpc", "--provider", provider, "--model", model,
                   "--thinking", "low",
                   "--session", str(root / "session.jsonl"), "--no-extensions", "--no-skills", "--no-prompt-templates",
                   "--no-context-files", "--no-builtin-tools", "--extension", str(extension)]
        kernel = PiKernel(command, cwd=str(root), env=pi_env, timeout=120.0, deadline=time.monotonic() + wall_seconds).start()
        kernel.prompt(prompt)
        kernel.wait_for_agent_events(timeout=wall_seconds, idle_timeout=300.0)
        status = json.loads(__import__("urllib.request").request.urlopen(__import__("urllib.request").request.Request(f"http://127.0.0.1:{ready['port']}/status", headers={"X-ALE-Token": ready["token"]})).read())
        (root / "pi-summary.json").write_text(json.dumps({"problem_id": problem_id, "status": status}, indent=2), encoding="utf-8")
        return root / "ale_bench.json"
    finally:
        if kernel is not None: kernel.close()
        bridge.terminate()
        bridge.wait(timeout=10)
