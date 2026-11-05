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

PROJECT = Path(__file__).resolve().parents[2]

ENVIRONMENT = """# Presentation environment
Prefer HTML at artifacts/presentation.html. Use one [data-slide] element per page and size each to 16:9 with CSS. Keep local CSS, images and other assets under artifacts/ and reference them relatively. Microsoft Edge captures each element; PowerPoint packages each capture as a full-slide image. The HTML and all artifacts are included as editable source in delivery. JavaScript and external HTTP(S) requests are disabled during rendering, so use HTML/CSS and local files.

JSON is a fallback at artifacts/deck.json: width=13.333333, height=7.5 (inches), optional font and slides list. Each slide has background, elements and optional notes. Element kinds are text, rect, line, shape, chart, table and image; coordinates and dimensions are inches, font sizes are points. Images reference files inside data/. The PPTX produced from JSON retains native editable objects.

An optional image-creation role is available at agents/visual_asset.md. Its generate_image tool saves local assets under artifacts/visuals/. The image API can use the task provider by default or an independently configured PPT_DEMO_IMAGE_API_BASE, PPT_DEMO_IMAGE_API_KEY and PPT_DEMO_IMAGE_MODEL.

Use only supplied facts and preserve their values, units, periods, labels and citations. Render the canonical source or a candidate under artifacts/ with office(op='render',source_path=...). HTML is canonical whenever artifacts/presentation.html exists; otherwise JSON is canonical. Each render creates an immutable revision. Receipts and page PNGs are readable under results/renders/vNNN/; office(op='look',revision=N,pages=[...]) displays selected pages. Delivery checks that the canonical source is unchanged since render and that its slide count matches the brief.

Programs run fresh in WASI with state, args, env and confined workspace file access. Use Python stdlib and workspace files; host packages and arbitrary host file access are unavailable. Programs can write HTML/CSS or JSON under artifacts/ and can call env.agent(...) and env.render(). Direct file editing, programs and task-local agents are available. Programs in tools/ are managed by save_program. Source data/ and runtime results/ are read-only. Workflow, checks and review choices belong to you; the runtime does not require a particular sequence.
"""


def prepare(root: Path, source: Path) -> None:
    if root.exists() and any(root.iterdir()):
        raise ValueError("Use a new run directory")
    data = root / "workspace" / "data"
    data.mkdir(parents=True)
    shutil.copy2(source / "material.txt", data / "material.txt")
    shutil.copy2(source / "production_brief.md", data / "instructions.md")
    (data / "environment.md").write_text(ENVIRONMENT, encoding="utf-8")
    agents = root / "workspace" / "agents"
    agents.mkdir(parents=True)
    shutil.copy2(PROJECT / "demo" / "ppt-roles" / "visual_asset.md", agents / "visual_asset.md")
    skill = root / "workspace" / "skills" / "self_evolution" / "SKILL.md"
    skill.parent.mkdir(parents=True, exist_ok=True)
    source_skill = PROJECT / "demo" / "harness-methods" / "self_evolution" / "SKILL.md"
    if not skill.exists():
        shutil.copy2(source_skill, skill)
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
        continue_prompt: str | None = None, thinking: str = "low", unbounded: bool = False,
        html_first: bool = False) -> dict:
    values = {} if official_openai else load_project_dotenv(Path("D:/autoresearch_pi_project"))
    if not official_openai and values.get("OPENAI_API_BASE", "").rstrip("/") != "https://az.gptplus5.com/v1":
        raise ValueError("This demo is authorized for the configured AZ route only")
    previous_protocol = json.loads((root / "protocol.json").read_text()) if resume else {}
    started = previous_protocol.get("started_at", time.time())
    remaining = float("inf") if unbounded else min(seconds, 7200) - max(0, time.time()-started)
    if not unbounded and remaining <= 0:
        raise ValueError("Original two-hour deadline reached")
    deadline = None if unbounded else time.monotonic() + remaining
    agent = Path.home() / ".pi" / "agent" if official_openai else root / ".pi-agent"
    agent.mkdir(exist_ok=resume or official_openai)
    if resume and continue_prompt:
        loop_state = root / ".harness" / "ppt-loop.json"
        saved_state = json.loads(loop_state.read_text())
        saved_state["complete"] = False
        loop_state.write_text(json.dumps(saved_state, indent=2), encoding="utf-8")
    provider_id = "openai-codex" if official_openai else "az-demo"
    model_id = "gpt-6-luna" if official_openai else "qwen3.8-27b"
    if official_openai:
        model = {"id": model_id, "name": "GPT-6 Luna", "api": "openai-codex-responses", "provider": provider_id,
                 "baseUrl": "https://chatgpt.com/backend-api", "reasoning": True, "input": ["text", "image"],
                 "contextWindow": 272000, "maxTokens": 12000,
                 "cost": {"input": 0.1, "output": 0.5, "cacheRead": 0.01, "cacheWrite": 0.125},
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
        settings_config.setdefault("compaction", {})["enabled"] = False
        settings_config.setdefault("retry", {})["enabled"] = False
        settings_path.write_text(json.dumps(settings_config, indent=2), encoding="utf-8")
    else:
        model = {"id": model_id, "name": model_id, "reasoning": True, "input": ["text", "image"],
                 "contextWindow": 128000, "maxTokens": 12000, "cost": {"input": 20, "output": 80, "cacheRead": 20, "cacheWrite": 20}}
        (agent / "models.json").write_text(json.dumps({"providers": {provider_id: {"baseUrl": values["OPENAI_API_BASE"],
            "api": "openai-completions", "apiKey": "$OPENAI_API_KEY", "authHeader": True,
            "compat": {"supportsDeveloperRole": False, "thinkingFormat": "qwen"}, "models": [model]}}}), encoding="utf-8")
        (agent / "settings.json").write_text(json.dumps({"compaction": {"enabled": False}, "retry": {"enabled": False}}))
    env = {**{key: value for key, value in os.environ.items() if key != "OPENAI_API_KEY"},
           **({"OPENAI_API_KEY": values["OPENAI_API_KEY"]} if not official_openai else {}),
           "PI_CODING_AGENT_DIR": str(agent),
           "PPT_DEMO_ROOT": str(root), "PPT_DEMO_PYTHON": os.sys.executable,
           "PPT_DEMO_THINKING": thinking,
           "PPT_DEMO_DEADLINE": "Infinity" if unbounded else str(int((time.time()+remaining)*1000)),
           "PPT_DEMO_UNBOUNDED": "1" if unbounded else "0",
           "PPT_DEMO_REQUEST_RESERVE_USD": "0.10" if official_openai else "3.52",
           "PPT_DEMO_BUDGET_USD": "Infinity" if unbounded else "12", "PPT_DEMO_INPUT_USD_PER_MILLION": "0.10" if official_openai else "20",
           "PPT_DEMO_OUTPUT_USD_PER_MILLION": "0.50" if official_openai else "80",
           "PPT_DEMO_CACHE_READ_USD_PER_MILLION": "0.01" if official_openai else "20",
           "PPT_DEMO_CACHE_WRITE_USD_PER_MILLION": "0.125" if official_openai else "20"}
    if not official_openai:
        for name in ("PPT_DEMO_IMAGE_API_BASE", "PPT_DEMO_IMAGE_API_KEY", "PPT_DEMO_IMAGE_MODEL", "PPT_DEMO_IMAGE_FORMAT",
                     "PPT_DEMO_IMAGE_SIZE", "PPT_DEMO_IMAGE_QUALITY", "PPT_DEMO_IMAGE_RESERVE_USD"):
            if values.get(name):
                env[name] = values[name]
    command = ["node", str(PROJECT / "node_modules/@earendil-works/pi-coding-agent/dist/cli.js"),
        "--mode", "rpc", "--no-context-files", "--no-extensions", "--no-skills", "--no-prompt-templates",
        "--no-builtin-tools", "--extension", str(PROJECT / "demo/ppt_demo_extension.ts"),
        "--provider", provider_id, "--model", model_id, "--thinking", thinking, "--session", str(root / "session.jsonl")]
    protocol = {"started_at": started, "base_branch": "codex/agent-native-program-loop", "task": json.loads((root / "task-provenance.json").read_text())["case"],
        "provider": "OpenAI Codex OAuth (official)" if official_openai else "AZ https://az.gptplus5.com/v1",
        "model": model_id, "thinking": thinking, "max_seconds": None if unbounded else min(seconds,7200),
        "authoring_format": "HTML (required)" if html_first else "agent choice, HTML preferred",
        "authorized_cny": None if unbounded else 100,
        "budget_guard": "No cumulative spend cap or total runtime deadline; task ends on delivery or runtime/provider failure" if unbounded else ("USD12 cumulative API-equivalent cap, USD0.10 reserve/request, 2-hour deadline" if official_openai else "USD12 conservative token estimate, reserve USD3.52 before each request, 2-hour deadline"),
        "rates": {"input_usd_per_million": 0.10, "output_usd_per_million": 0.50, "cache_read_usd_per_million": 0.01,
                  "cache_write_usd_per_million": 0.125, "source": "OpenAI GPT-6 Luna published API rates; Codex OAuth usage is subscription quota, not API billing equivalent"} if official_openai else
                 {"input_usd_per_million": 20, "output_usd_per_million": 80, "source": "Conservative guard above AZ public /api/pricing: model_ratio=1.2, completion_ratio=4; not verified account billing"},
        "scope": "one exploratory production demo; no claim of causal net benefit", "guidance": "Explicit dual artifact+harness goal; no required program count, no forced revision, no critic worker",
        "command": command}
    protocol["source_hashes"] = {str(p.relative_to(PROJECT)): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in [PROJECT / "demo/ppt_demo_extension.ts", PROJECT / "demo/prompts/ppt_demo_system.md",
                  PROJECT / "demo/prompts/ppt_adapt_system.md", PROJECT / "demo/harness-methods/self_evolution/SKILL.md",
                  PROJECT / "src/autoresearch_pi/ppt_demo.py", PROJECT / "src/autoresearch_pi/ppt_demo_artifact.py",
                  PROJECT / "demo/arc_thin_native_runtime.ts", PROJECT / "demo/arc_thin_components.ts", PROJECT / "demo/arc_thin_binder.ts",
                  PROJECT / "demo/arc_thin_workspace.ts", PROJECT / "demo/ppt-roles/visual_asset.md"]}
    protocol["task_hashes"] = {str(p.relative_to(root)).replace("\\", "/"): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in [root / "workspace/data/instructions.md", root / "workspace/data/material.txt", root / "workspace/data/environment.md"]}
    if resume:
        protocol["resumes"] = [*previous_protocol.get("resumes", []), {"at": time.time(), "remaining_seconds": remaining}]
        protocol["previous_provider"] = previous_protocol.get("provider")
        protocol["previous_model"] = previous_protocol.get("model")
        protocol["previous_source_hashes"] = previous_protocol.get("source_hashes", {})
    (root / "protocol.json").write_text(json.dumps(protocol, indent=2), encoding="utf-8")
    summary = {"complete": False, "stop": "running", "batches": 0, "provider": protocol["provider"], "model": protocol["model"]}
    (root / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    def record(event):
        # Preserve complete semantic events without repeating streaming cumulative content.
        if event.get("type") != "message_update":
            with (root / "pi-events.jsonl").open("a", encoding="utf-8") as stream:
                stream.write(json.dumps(event, ensure_ascii=False)+"\n")
    try:
        with PiKernel(command, cwd=str(root / "workspace"), env=env, timeout=300 if unbounded else 90, deadline=deadline, event_sink=record) as kernel:
            transport = continue_prompt if resume and continue_prompt else "PPT_RESUME" if resume else (
                "Create the presentation described in data/instructions.md. Use artifacts/presentation.html as the required canonical authoring source, with exactly one data-slide element per slide and 16:9 sizing. Use only the supplied facts and preserve their figures, units, periods, accounting labels, caveats and slide-level source citations. The deliverable includes the HTML source, its local assets, and a PowerPoint export. You choose how to organize, explore, assess and revise the work. Start by reading data/instructions.md, data/environment.md and data/material.txt. You have the same model for all task and method-design work. Runtime exports your evolved harness with the deck."
                if html_first else
                "Create the complete requested deck. Start by reading data/instructions.md, data/environment.md and data/material.txt. You have the same model for all task and method-design work. Runtime exports your evolved harness with the deck."
            )
            while deadline is None or time.monotonic() < deadline:
                response = kernel.prompt(transport)
                if response.get("success") is False:
                    raise RuntimeError(f"Pi rejected prompt: {response}")
                events = kernel.wait_for_agent_events(timeout=max(1, deadline-time.monotonic()) if deadline is not None else 3600,
                    idle_timeout=None if unbounded else 300)
                messages = [e["message"] for e in events if e.get("type") == "message_end" and e.get("message", {}).get("role") == "assistant"]
                latest = messages[-1] if messages else {}
                state = json.loads((root / ".harness/ppt-loop.json").read_text())
                summary["batches"] = state.get("batch", summary["batches"] + 1)
                if state["complete"]:
                    summary.update(complete=True, stop="delivered", revision=state.get("deliveredRevision"))
                    break
                if latest.get("stopReason") in ("error", "aborted"):
                    raise RuntimeError(latest.get("errorMessage", latest.get("stopReason")))
                transport = (
                    "PPT_RESUME\nThe previous response reached its output token limit. "
                    "An incomplete tool call was not executed. Continue from actual saved files and tool receipts, "
                    "not from intended writes. Make the next step small enough to complete: "
                    "write or edit a bounded piece, or publish an already written program by source_path. "
                    "Do not regenerate the whole presentation or repeat a long plan."
                    if latest.get("stopReason") == "length" else "PPT_NEXT"
                )
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
    parser.add_argument("--official-openai", action="store_true", help="resume with the existing OpenAI Codex OAuth session and GPT-6 Luna")
    parser.add_argument("--continue-prompt", help="continue an existing run with a concrete task update; keeps the original deadline and budget")
    parser.add_argument("--thinking", choices=["low", "medium", "high", "xhigh", "max"], default="low")
    parser.add_argument("--unbounded", action="store_true", help="disable cumulative spend and total runtime limits")
    parser.add_argument("--html-first", action="store_true", help="require the canonical presentation source to be HTML")
    args = parser.parse_args()
    root = args.root.resolve()
    if args.source:
        prepare(root, args.source.resolve())
    print(json.dumps(run(root, resume=args.resume, official_openai=args.official_openai,
        continue_prompt=args.continue_prompt, thinking=args.thinking, unbounded=args.unbounded,
        html_first=args.html_first) if args.run else {"prepared": str(root)}, ensure_ascii=False))
