"""One bounded real-provider PPT demo using the agent-native-program-loop branch."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import time
from pathlib import Path

from .project import load_project_dotenv
from .pi_kernel import PiKernel
from .ppt_demo_continuation import initial_intent, legacy_core_next_intent, pi_prompt, process_next_intent

PROJECT = Path(__file__).resolve().parents[2]

ENVIRONMENT = """# HTML presentation environment
The deliverable is a presentation you author; the typical form is artifacts/presentation.html with each slide container marked class="slide". Inline CSS/SVG/JavaScript and embedded assets make it self-contained, and relative assets (images, css, js next to the source under artifacts/) resolve: the renderer screenshots a copy placed next to your source files. The renderer adds navigation, a slide counter, fullscreen and print-to-PDF; it creates one-slide browser previews. Receipts and page images are readable under results/renders/vNNN/.
The renderer also accepts scene JSON at artifacts/deck.json and converts it to standalone HTML. JSON scenes use width, height, slides; each slide has background and elements with kind,x,y,w,h. Element kinds include text, rect, line, shape, chart, table and image; an element may also carry raw HTML/SVG in an "html" field. Images reference any workspace path; their type is detected from content (png, jpeg, gif, webp, bmp). See the tool result for renderer facts and warnings.
Python and native named tools read and write workspace files as text or binary; you can create images and other binary assets yourself. Published skills appear in Pi's explicit workspace skill index and their SKILL.md files are available through the ordinary confined read tool. Ambient skills remain disabled. The task files are data/instructions.md and data/material.txt. Read and write paths are confined to the workspace. data/ and results/ are read-only. Browser output is written under exports/ and results/; delivery copies the rendered revision to delivery/.
"""


def prepare(root: Path, source: Path) -> None:
    if root.exists() and any(root.iterdir()):
        raise ValueError("Use a new run directory")
    data = root / "workspace" / "data"
    data.mkdir(parents=True)
    task_guidance = PROJECT / "demo/prompts/ppt_demo_agents.md"
    (root / "workspace" / "AGENTS.md").write_text(task_guidance.read_text(encoding="utf-8"), encoding="utf-8")
    shutil.copy2(source / "material.txt", data / "material.txt")
    shutil.copy2(source / "production_brief.md", data / "instructions.md")
    (data / "environment.md").write_text(ENVIRONMENT, encoding="utf-8")
    import winreg
    fonts = set()
    with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts") as key:
        for i in range(winreg.QueryInfoKey(key)[1]):
            name, _, _ = winreg.EnumValue(key, i)
            fonts.add(name.split(" (")[0])
    (data / "available-fonts.json").write_text(json.dumps(sorted(fonts), ensure_ascii=False, indent=2), encoding="utf-8")
    evaluation = root / "evaluation"
    evaluation.mkdir()
    for name, target in [("judge_prompt.json", "judge_prompt.json"), ("instructions.md", "presentbench_generation_instructions.md"),
                         ("statistics.yaml", "statistics.yaml")]:
        if (source / name).exists():
            shutil.copy2(source / name, evaluation / target)
    provenance = json.loads((source.parent / "case.json").read_text(encoding="utf-8"))
    (root / "task-provenance.json").write_text(json.dumps(provenance, indent=2), encoding="utf-8")


def run(root: Path, seconds: int = 7200, resume: bool = False, official_openai: bool = False,
        continue_prompt: str | None = None, kickoff_prompt: str | None = None,
        thinking: str = "low", fresh_batch: bool = False,
        batch_requests: int = 10, unbounded: bool = False, model_override: str | None = None) -> dict:
    if batch_requests < 0:
        raise ValueError("batch_requests must be zero (unlimited) or a positive integer")
    values = {} if official_openai else load_project_dotenv(Path("D:/autoresearch_pi_project"))
    if not official_openai and values.get("OPENAI_API_BASE", "").rstrip("/") != "https://az.gptplus5.com/v1":
        raise ValueError("This demo is authorized for the configured AZ route only")
    previous_protocol = json.loads((root / "protocol.json").read_text(encoding="utf-8")) if resume else {}
    started = previous_protocol.get("started_at", time.time())
    remaining = float("inf") if unbounded else min(seconds, 7200) - max(0, time.time()-started)
    if remaining <= 0:
        raise ValueError("Original two-hour deadline reached")
    (root / "budget-stop.json").unlink(missing_ok=True)
    deadline = None if unbounded else time.monotonic() + remaining
    agent = Path.home() / ".pi" / "agent" if official_openai else root / ".pi-agent"
    agent.mkdir(exist_ok=resume or official_openai)
    if resume and continue_prompt:
        loop_state = root / ".harness" / "ppt-loop.json"
        saved_state = json.loads(loop_state.read_text(encoding="utf-8"))
        saved_state["complete"] = False
        loop_state.write_text(json.dumps(saved_state, indent=2), encoding="utf-8")
    provider_id = "openai-codex" if official_openai else "az-demo"
    if official_openai:
        model_id = model_override or "gpt-6-luna"
        if model_id == "gpt-6-sol":
            model_name, context_window, max_tokens = "GPT-6 Sol", 1_050_000, 128_000
            model_cost = {"input": 2, "output": 10, "cacheRead": 0.2, "cacheWrite": 2.5}
        elif model_id == "gpt-6-luna":
            model_name, context_window, max_tokens = "GPT-6 Luna", 272_000, None
            model_cost = {"input": 0.1, "output": 0.5, "cacheRead": 0.01, "cacheWrite": 0.125}
        else:
            raise ValueError("Official OpenAI model must be gpt-6-luna or gpt-6-sol")
    else:
        if model_override and model_override.startswith("az/"):
            model_override = model_override.removeprefix("az/")
        model_id = model_override or "qwen3.8-27b"
    if official_openai:
        model = {"id": model_id, "name": model_name, "api": "openai-codex-responses", "provider": provider_id,
                 "baseUrl": "https://chatgpt.com/backend-api", "reasoning": True, "input": ["text", "image"],
                 "contextWindow": context_window, **({"maxTokens": max_tokens} if max_tokens else {}), "cost": model_cost,
                 "thinkingLevelMap": {"off": None, "minimal": "low", "low": "low", "medium": "medium", "high": "high", "xhigh": "xhigh", "max": "max"},
                 "compat": {"supportsOpenAIGrammarTools": True, "supportsAdditionalTools": True,
                            "supportsToolSearch": True, "supportsMidConvoSystemMessages": True}}
        models_path, settings_path = agent / "models.json", agent / "settings.json"
        original_models = models_path.read_bytes() if models_path.exists() else None
        original_settings = settings_path.read_bytes() if settings_path.exists() else None
        model_config = json.loads(original_models) if original_models else {}
        providers = model_config.setdefault("providers", {})
        codex_config = providers.setdefault(provider_id, {})
        current_models = codex_config.get("models", [])
        codex_config["models"] = [item for item in current_models if item.get("id") != model_id] + [model]
        models_path.write_text(json.dumps(model_config, indent=2), encoding="utf-8")
        settings_config = json.loads(original_settings) if original_settings else {}
        settings_path.write_text(json.dumps(settings_config, indent=2), encoding="utf-8")
    else:
        model = {"id": model_id, "name": model_id, "reasoning": True, "input": ["text", "image"],
                 "contextWindow": 128000, "cost": {"input": 20, "output": 80, "cacheRead": 20, "cacheWrite": 20}}
        (agent / "models.json").write_text(json.dumps({"providers": {provider_id: {"baseUrl": values["OPENAI_API_BASE"],
            "api": "openai-completions", "apiKey": "$OPENAI_API_KEY", "authHeader": True,
            "compat": {"supportsDeveloperRole": False, "thinkingFormat": "qwen"}, "models": [model]}}}), encoding="utf-8")
        (agent / "settings.json").write_text(json.dumps({}))
    env = {**{key: value for key, value in os.environ.items() if key != "OPENAI_API_KEY"},
           **({"OPENAI_API_KEY": values["OPENAI_API_KEY"]} if not official_openai else {}),
           "PI_CODING_AGENT_DIR": str(agent),
           "PPT_DEMO_ROOT": str(root), "PPT_DEMO_PYTHON": os.sys.executable,
           "PPT_DEMO_THINKING": thinking,
           "PPT_FRESH_BATCH": "1" if fresh_batch else "0", "PPT_BATCH_REQUESTS": str(batch_requests),
           "PPT_DEMO_DEADLINE": "Infinity" if unbounded else str(int((time.time()+remaining)*1000)),
           "PPT_DEMO_REQUEST_RESERVE_USD": "0" if unbounded else ("0.10" if official_openai else "3.52"),
           "PPT_DEMO_BUDGET_USD": "Infinity" if unbounded else "12", "PPT_DEMO_INPUT_USD_PER_MILLION": "0.10" if official_openai else "20",
           "PPT_DEMO_OUTPUT_USD_PER_MILLION": "0.50" if official_openai else "80",
           "PPT_DEMO_CACHE_READ_USD_PER_MILLION": "0.01" if official_openai else "20",
           "PPT_DEMO_CACHE_WRITE_USD_PER_MILLION": "0.125" if official_openai else "20"}
    command = ["node", str(PROJECT / "node_modules/@earendil-works/pi-coding-agent/dist/cli.js"),
        "--mode", "rpc", "--no-context-files", "--no-extensions", "--no-skills", "--no-prompt-templates",
        "--no-builtin-tools", "--extension", str(PROJECT / "demo/ppt_demo_extension.ts"),
        "--provider", provider_id, "--model", model_id, "--thinking", thinking, "--session", str(root / "session.jsonl")]
    protocol = {"started_at": started, "base_branch": "codex/agent-native-program-loop", "task": json.loads((root / "task-provenance.json").read_text(encoding="utf-8"))["case"],
        "provider": "OpenAI Codex OAuth (official)" if official_openai else "AZ https://az.gptplus5.com/v1",
        "model": model_id, "thinking": thinking, "max_seconds": None if unbounded else min(seconds,7200),
        "unbounded": unbounded,
        "fresh_batch": fresh_batch, "batch_requests": batch_requests,
        "token_limit": "none; provider/model native limits apply",
        "authorized_cny": None if unbounded else 100, "budget_guard": "none; user-authorized unbounded run" if unbounded else ("USD12 cumulative API-equivalent cap, USD0.10 reserve/request, 2-hour deadline" if official_openai else "USD12 conservative token estimate, reserve USD3.52 before each request, 2-hour deadline"),
        "rates": {"input_usd_per_million": model["cost"]["input"], "output_usd_per_million": model["cost"]["output"],
                  "cache_read_usd_per_million": model["cost"]["cacheRead"], "cache_write_usd_per_million": model["cost"]["cacheWrite"],
                  "source": f"OpenAI {model_name} published API rates; Codex OAuth usage is subscription quota, not API billing equivalent"} if official_openai else
                 {"input_usd_per_million": 20, "output_usd_per_million": 80, "source": "Conservative guard above AZ public /api/pricing: model_ratio=1.2, completion_ratio=4; not verified account billing"},
        "scope": "one exploratory HTML presentation production demo; no claim of causal net benefit", "guidance": "Generic harness-learning guidance; no preseeded task criteria, methods, or components",
        "command": command}
    protocol["source_hashes"] = {str(p.relative_to(PROJECT)): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in [PROJECT / "demo/ppt_demo_extension.ts", PROJECT / "demo/prompts/ppt_demo_system.md",
                  PROJECT / "demo/prompts/ppt_demo_agents.md",
                  PROJECT / "src/autoresearch_pi/ppt_demo.py", PROJECT / "src/autoresearch_pi/ppt_demo_html.py",
                  PROJECT / "demo/arc_thin_native_runtime.ts", PROJECT / "demo/arc_thin_components.ts", PROJECT / "demo/arc_thin_binder.ts",
                  PROJECT / "demo/arc_thin_workspace.ts",
                  PROJECT / "demo/ppt_trials.ts", PROJECT / "tools/reflective_core_evidence_joins.py"]}
    protocol["task_hashes"] = {str(p.relative_to(root)).replace("\\", "/"): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in [root / "workspace/AGENTS.md", root / "workspace/data/instructions.md", root / "workspace/data/material.txt", root / "workspace/data/environment.md"]}
    if resume:
        protocol["resumes"] = [*previous_protocol.get("resumes", []), {"at": time.time(), "remaining_seconds": remaining}]
        protocol["previous_provider"] = previous_protocol.get("provider")
        protocol["previous_model"] = previous_protocol.get("model")
        protocol["previous_source_hashes"] = previous_protocol.get("source_hashes", {})
    (root / "protocol.json").write_text(json.dumps(protocol, indent=2), encoding="utf-8")
    summary = {"complete": False, "stop": "running", "batches": 0, "provider": protocol["provider"], "model": protocol["model"]}
    def record(event):
        # Preserve complete semantic events without repeating streaming cumulative content.
        if event.get("type") != "message_update":
            with (root / "pi-events.jsonl").open("a", encoding="utf-8") as stream:
                stream.write(json.dumps(event, ensure_ascii=False)+"\n")
    try:
        with PiKernel(command, cwd=str(root / "workspace"), env=env, timeout=90, deadline=deadline, event_sink=record) as kernel:
            transport = pi_prompt(initial_intent(resume, continue_prompt, kickoff_prompt))
            while deadline is None or time.monotonic() < deadline:
                response = kernel.prompt(transport)
                if response.get("success") is False:
                    raise RuntimeError(f"Pi rejected prompt: {response}")
                events = kernel.wait_for_agent_events(
                    timeout=float("inf") if deadline is None else max(1, deadline-time.monotonic()),
                    idle_timeout=None if deadline is None else 900)
                messages = [e["message"] for e in events if e.get("type") == "message_end" and e.get("message", {}).get("role") == "assistant"]
                latest = messages[-1] if messages else {}
                state = json.loads((root / ".harness/ppt-loop.json").read_text(encoding="utf-8"))
                summary["batches"] = state["batch"]
                if state["complete"]:
                    summary.update(complete=True, stop="delivered", revision=state.get("deliveredRevision"))
                    break
                if latest.get("stopReason") in ("error", "aborted"):
                    raise RuntimeError(latest.get("errorMessage", latest.get("stopReason")))
                process_choice = state.get("process", {}).get("next")
                if process_choice and process_choice.get("decision") == "error":
                    summary.update(stop="process_hook_failed", process_error=process_choice.get("error"))
                    break
                if process_choice and process_choice.get("decision") == "stop":
                    summary.update(stop="process_stop", process_version=process_choice.get("version"))
                    break
                if process_choice:
                    state["process"]["next"] = None
                    (root / ".harness" / "ppt-loop.json").write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
                    transport = pi_prompt(process_next_intent(process_choice))
                else:
                    transport = pi_prompt(legacy_core_next_intent(state, latest, fresh_batch, batch_requests))
                (root / "summary.json").write_text(json.dumps(summary, indent=2))
            else:
                summary["stop"] = "time_budget"
    except Exception as error:
        summary["stop"] = "budget" if (root / "budget-stop.json").exists() else "runtime_error"
        summary["error"] = str(error)
    finally:
        if official_openai:
            if original_models is None:
                models_path.unlink(missing_ok=True)
            else:
                models_path.write_bytes(original_models)
            if original_settings is None:
                settings_path.unlink(missing_ok=True)
            else:
                settings_path.write_bytes(original_settings)
        (root / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument("--source", type=Path)
    parser.add_argument("--run", action="store_true")
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--official-openai", action="store_true", help="use the existing OpenAI Codex OAuth session; defaults to GPT-6 Luna")
    parser.add_argument("--model", help="select a model; AZ accepts its configured model id (for example az/deepseek-v4-flash)")
    parser.add_argument("--continue-prompt", help="continue an existing run with a concrete task update; keeps the original deadline and budget")
    parser.add_argument("--kickoff-prompt", help="give a fresh run a concrete task prompt")
    parser.add_argument("--thinking", choices=["low", "medium", "high", "xhigh", "max"], default="low")
    parser.add_argument("--fresh-batch", action="store_true", help="start each new batch with a fresh conversation and carry only workspace and harness")
    parser.add_argument("--batch-requests", type=int, default=10, help="maximum provider requests per fresh batch; use 0 for unlimited")
    parser.add_argument("--unbounded", action="store_true", help="disable runner-level cumulative spend and wall-clock limits")
    args = parser.parse_args()
    root = args.root.resolve()
    if args.source:
        prepare(root, args.source.resolve())
    print(json.dumps(run(root, resume=args.resume, official_openai=args.official_openai,
        continue_prompt=args.continue_prompt, kickoff_prompt=args.kickoff_prompt,
        thinking=args.thinking, fresh_batch=args.fresh_batch,
        batch_requests=args.batch_requests, unbounded=args.unbounded, model_override=args.model) if args.run else {"prepared": str(root)}, ensure_ascii=False))
