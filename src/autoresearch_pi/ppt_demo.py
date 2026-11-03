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

ENVIRONMENT = """# Editable PPT environment
The native scene is JSON at artifacts/deck.json, with width=13.333333, height=7.5 (inches), font optional, slides list. Each slide has background (6-digit RGB), elements list, optional notes. All positions are in inches, font sizes in points. Every element has kind,x,y,w,h. No layout/template is imposed. Element order is z-order.
- text: text (newline paragraphs), size (default20), font, color, bold, align left/center/right, valign top/middle/bottom, margin (inches default .03), space_after (pt default5).
- rect or line: fill RGB. line is a thin rectangle; set suitable w,h.
- chart: type column/bar/line/pie, categories list, series [{name,values}], unit (value axis title), colors RGB list optional, labels boolean. These are native editable charts with embedded data, not raster charts.
- table: rows (rectangular list including header), size optional, header_fill RGB optional. Native editable cells.
- image: path inside data/, e.g. data/source-page-01.png. Original source pages are available as images for faithful excerpts. Supply x,y,w,h.
Use RGB strings without #. Use only the supplied source for facts. The renderer does no financial interpretation or narrative evaluation. It reports native PowerPoint text-height overflow and outside-canvas geometry. Some intended overlap and non-overflow legibility remain your judgment. office(render) creates immutable exports/vNNN/deck.pptx, deck.pdf, slide PNGs, source snapshot, contact sheet and receipt. office(look,pages=[...],revision=N) shows up to four full-size pages. office(deliver) checks the export is current and 15–20 pages, then packages current components and final files.
Programs run fresh in WASI, using stdlib, json, state,args,env. Python open handles confined workspace text reads/writes, e.g. json.load(open('artifacts/deck.json')) or json.dump(deck,open('artifacts/deck.json','w')). They cannot import pptx/PIL or use arbitrary host files. They can transform document content, calculate, build editable scene JSON, or check evidence. state includes current deck, last_feedback, memory, revision and batch. Keep data as arguments or workspace content; reusable logic belongs in programs. Ordinary artifacts belong under artifacts/ or notes/. Prefix tools/ is managed by save_program. Source input data/ and runtime results/ are read-only.
"""


def prepare(root: Path, source: Path) -> None:
    if root.exists() and any(root.iterdir()):
        raise ValueError("Use a new run directory")
    data = root / "workspace" / "data"
    data.mkdir(parents=True)
    for name in ("material.pdf", "material.txt", "instructions.md", "statistics.yaml"):
        shutil.copy2(source / name, data / name)
    (data / "environment.md").write_text(ENVIRONMENT, encoding="utf-8")
    evaluation = root / "evaluation"
    evaluation.mkdir()
    shutil.copy2(source / "judge_prompt.json", evaluation / "judge_prompt.json")
    import fitz
    doc = fitz.open(data / "material.pdf")
    for n, page in enumerate(doc, 1):
        page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5)).save(data / f"source-page-{n:02d}.png")
    revision = "3c6e01f563165d3a364a459f9777cd7286f42cd8"
    base = f"https://huggingface.co/datasets/PresentBench/PresentBench/resolve/{revision}/"
    provenance = {"dataset": "PresentBench/PresentBench", "revision": revision,
                  "case": "economics/JPMorgan_Chase/Earning3",
                  "material": base + "economics/JPMorgan_Chase/Earning3/material.pdf",
                  "instructions": base + "economics/JPMorgan_Chase/Earning3/generation_task/instructions.md"}
    (root / "task-provenance.json").write_text(json.dumps(provenance, indent=2), encoding="utf-8")


def run(root: Path, seconds: int = 7200, resume: bool = False) -> dict:
    values = load_project_dotenv(Path("D:/autoresearch_pi_project"))
    # The user authorized AZ, not the separate ARC-scoped OpenRouter route.
    if values.get("OPENAI_API_BASE", "").rstrip("/") != "https://az.gptplus5.com/v1":
        raise ValueError("This demo is authorized for the configured AZ route only")
    previous_protocol = json.loads((root / "protocol.json").read_text()) if resume else {}
    started = previous_protocol.get("started_at", time.time())
    remaining = min(seconds, 7200) - max(0, time.time()-started)
    if remaining <= 0:
        raise ValueError("Original two-hour deadline reached")
    deadline = time.monotonic() + remaining
    agent = root / ".pi-agent"
    agent.mkdir(exist_ok=resume)
    model = {"id": "qwen3.8-27b", "name": "qwen3.8-27b", "reasoning": True, "input": ["text", "image"],
             "contextWindow": 128000, "maxTokens": 12000, "cost": {"input": 20, "output": 80, "cacheRead": 20, "cacheWrite": 20}}
    (agent / "models.json").write_text(json.dumps({"providers": {"az-demo": {"baseUrl": values["OPENAI_API_BASE"],
        "api": "openai-completions", "apiKey": "$OPENAI_API_KEY", "authHeader": True,
        "compat": {"supportsDeveloperRole": False, "thinkingFormat": "qwen"}, "models": [model]}}}), encoding="utf-8")
    (agent / "settings.json").write_text(json.dumps({"compaction": {"enabled": False}, "retry": {"enabled": False}}))
    env = {**os.environ, "OPENAI_API_KEY": values["OPENAI_API_KEY"], "PI_CODING_AGENT_DIR": str(agent),
           "PPT_DEMO_ROOT": str(root), "PPT_DEMO_PYTHON": os.sys.executable,
           "PPT_DEMO_DEADLINE": str(int((time.time()+remaining)*1000))}
    command = ["node", str(PROJECT / "node_modules/@earendil-works/pi-coding-agent/dist/cli.js"),
        "--mode", "rpc", "--no-context-files", "--no-extensions", "--no-skills", "--no-prompt-templates",
        "--no-builtin-tools", "--extension", str(PROJECT / "demo/ppt_demo_extension.ts"),
        "--provider", "az-demo", "--model", "qwen3.8-27b", "--thinking", "low", "--session", str(root / "session.jsonl")]
    protocol = {"started_at": started, "base_branch": "codex/agent-native-program-loop", "task": "PresentBench/economics/JPMorgan_Chase/Earning3",
        "provider": "AZ https://az.gptplus5.com/v1", "model": "qwen3.8-27b", "thinking": "low", "max_seconds": min(seconds,7200),
        "authorized_cny": 100, "budget_guard": "USD12 conservative token estimate, reserve USD3.52 before each request; 50 requests maximum",
        "rates": {"input_usd_per_million": 20, "output_usd_per_million": 80, "source": "Conservative guard above AZ public /api/pricing: model_ratio=1.2, completion_ratio=4; not verified account billing"},
        "scope": "one exploratory production demo; no claim of causal net benefit", "guidance": "Explicit dual artifact+harness goal; no required program count, no forced revision, no critic worker",
        "command": command}
    protocol["source_hashes"] = {str(p.relative_to(PROJECT)): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in [PROJECT / "demo/ppt_demo_extension.ts", PROJECT / "demo/prompts/ppt_demo_system.md",
                  PROJECT / "src/autoresearch_pi/ppt_demo.py", PROJECT / "src/autoresearch_pi/ppt_demo_artifact.py",
                  PROJECT / "demo/arc_thin_native_runtime.ts", PROJECT / "demo/arc_thin_components.ts", PROJECT / "demo/arc_thin_binder.ts"]}
    if resume:
        protocol["resumes"] = [*previous_protocol.get("resumes", []), {"at": time.time(), "remaining_seconds": remaining}]
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
            transport = "PPT_RESUME" if resume else "Create the complete requested deck. Start by reading data/instructions.md, data/environment.md and data/material.txt. You have the same model for all task and method-design work. Runtime exports your evolved harness with the deck."
            while time.monotonic() < deadline:
                response = kernel.prompt(transport)
                if response.get("success") is False:
                    raise RuntimeError(f"Pi rejected prompt: {response}")
                events = kernel.wait_for_agent_events(timeout=max(1, deadline-time.monotonic()), idle_timeout=300)
                messages = [e["message"] for e in events if e.get("type") == "message_end" and e.get("message", {}).get("role") == "assistant"]
                latest = messages[-1] if messages else {}
                state = json.loads((root / ".harness/ppt-loop.json").read_text())
                summary["batches"] = state["batch"]
                if state["complete"]:
                    summary.update(complete=True, stop="delivered", revision=state.get("deliveredRevision"))
                    break
                if latest.get("stopReason") in ("error", "aborted"):
                    raise RuntimeError(latest.get("errorMessage", latest.get("stopReason")))
                transport = "PPT_RESUME" if latest.get("stopReason") == "length" else "PPT_NEXT"
                (root / "summary.json").write_text(json.dumps(summary, indent=2))
            else:
                summary["stop"] = "time_budget"
    except Exception as error:
        summary["stop"] = "budget" if (root / "budget-stop.json").exists() else "runtime_error"
        summary["error"] = str(error)
    finally:
        (root / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument("--source", type=Path)
    parser.add_argument("--run", action="store_true")
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args()
    root = args.root.resolve()
    if args.source:
        prepare(root, args.source.resolve())
    print(json.dumps(run(root, resume=args.resume) if args.run else {"prepared": str(root)}, ensure_ascii=False))
