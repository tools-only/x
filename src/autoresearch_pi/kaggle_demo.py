"""One agent-owned Kaggle competition run with repeated submission feedback."""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

from .pi_kernel import PiKernel
from .project import load_project_dotenv

PROJECT = Path(__file__).resolve().parents[2]
HELPER = Path(__file__).with_name("kaggle_api.py")

TARGET = {
    "slug": "playground-series-s6e11",
    "title": "Predicting Credit Card Fraud",
    "url": "https://www.kaggle.com/competitions/playground-series-s6e11",
    "metric": "ROC AUC",
    "higher_is_better": True,
    "deadline": "2026-11-30T23:59:00Z",
    "target_top": 10,
    "max_daily_submissions": 10,
    "team_count": 813,
    "notes": "Kaggle Playground Series Season 6 Episode 11. Tabular binary classification; public and private leaderboard.",
}

INSTRUCTIONS = """# Kaggle competition task

Competition: {title} (`{slug}`)
URL: {url}
Metric: {metric} ({direction})
Deadline: {deadline}
Target: top {target_top} on the leaderboard.

The machine-readable facts are in `data/competition.json`. Competition data is under
`data/raw/`; it is read-only. The rules on the competition page are binding.

Build the strongest solution you can. Establish a reproducible validation split, submit a
credible baseline early, then use the leaderboard feedback to improve both the solution and
the method that produces it. Record local validation and leaderboard evidence; keep the best
submission. You may use many submission rounds within Kaggle's allowance. Do not fabricate
scores, and do not spend submissions on near-identical candidates. Provider spend is tracked;
USD 12 is a reporting threshold, not a stop boundary. Continue beyond it while the configured
runtime and competition deadline permit.

Deliver the best submission CSV under `submissions/`, reusable methods under `methods/`, and a
short account of the evidence in `notes/`. Keep improving the solution and harness while the
run budget and competition deadline permit. Use `finish` only after a fresh full leaderboard
check verifies the top-{target_top} target; do not stop early because a candidate failed, the
next experiment is uncertain, or the current result seems close to a ceiling. The runner ends
the task when its configured time, spend budget, or competition deadline is exhausted.
"""

ENVIRONMENT = """# Kaggle task environment

The workspace is `{workspace}`.

- `data/raw/` holds the competition files and is read-only.
- `data/competition.json` holds the metric, deadline, columns and other facts.
- `work/` is for scripts, features, models, out-of-fold predictions and experiment output.
- `submissions/` is for CSV files that may be submitted.
- `methods/` is managed by `save_method`, `edit_method`, `run_method` and `list_methods`.
- `notes/` is for durable observations and the experiment ledger.
- `results/` holds runtime receipts and saved long outputs.

`run_python` runs host Python with pandas, NumPy, scikit-learn, LightGBM, XGBoost, CatBoost,
Optuna and Polars. There is no GPU. It receives these environment variables:

- `KAGGLE_DATA_DIR`, `KAGGLE_WORK_DIR`, `KAGGLE_SUBMISSIONS_DIR`, `KAGGLE_RESULTS_DIR`
- `KAGGLE_COMPETITION`

Arguments are passed as `argv[1]` JSON. Keep long-running outputs bounded and save models and
out-of-fold predictions under `work/`. `data/` and `results/` should not be modified.

`kaggle_submit` validates a CSV against `sample_submission.csv`, checks the live allowance,
uploads it and returns the public score. `dry_run=true` validates without spending a submission.
`kaggle_status` returns the best score, recent submissions, top leaderboard entries and, with
`full=true`, the exact rank and total teams.

The host Python process runs with your operating-system permissions but without Kaggle or model
provider credentials. Treat code you run as trusted local code.
"""


def _sample_metadata(data_dir: Path) -> dict:
    sample = next(iter(sorted(data_dir.rglob("sample_submission.csv"))), None)
    if sample is None:
        sample = next((path for path in sorted(data_dir.rglob("*.csv")) if "sample" in path.name.lower()), None)
    if sample is None:
        return {}
    with sample.open("r", encoding="utf-8-sig", newline="") as stream:
        reader = csv.reader(stream)
        header = next(reader, [])
        rows = sum(1 for _ in reader)
    return {"sample_submission": str(sample.relative_to(data_dir)).replace("\\", "/"),
            "submission_columns": header, "id_column": header[0] if header else None,
            "prediction_columns": header[1:], "expected_rows": rows}


def _kaggle_download(python: str, slug: str, destination: Path) -> dict:
    result = subprocess.run([python, str(HELPER), "download", "--competition", slug, "--dest", str(destination)],
                            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=1800)
    lines = [line for line in (result.stdout or "").strip().splitlines() if line.strip()]
    if not lines:
        return {"ok": False, "error": (result.stderr or "Kaggle download produced no output.")[-2000:]}
    try:
        return json.loads(lines[-1])
    except json.JSONDecodeError:
        return {"ok": False, "error": (result.stderr or result.stdout)[-2000:]}


def _kaggle_info(python: str, slug: str) -> dict:
    result = subprocess.run([python, str(HELPER), "info", "--competition", slug],
                            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120)
    lines = [line for line in (result.stdout or "").strip().splitlines() if line.strip()]
    if not lines:
        return {}
    try:
        payload = json.loads(lines[-1])
    except json.JSONDecodeError:
        return {}
    return payload.get("competition") or {}


def prepare(root: Path, competition: str, python: str, download: bool = True, metadata: dict | None = None) -> dict:
    if root.exists() and any(root.iterdir()):
        raise ValueError("Use a new run directory")
    workspace = root / "workspace"
    for name in ("data/raw", "work/snippets", "submissions", "notes/memory", "prompts", "skills", "agents", "methods", "results", "config"):
        (workspace / name).mkdir(parents=True, exist_ok=True)
    remote = _kaggle_info(python, competition) if download else {}
    facts = {**TARGET, **remote, **(metadata or {}), "slug": competition}
    if remote.get("evaluation_metric"):
        facts["metric"] = remote["evaluation_metric"]
    if remote.get("deadline"):
        facts["deadline"] = remote["deadline"]
    if remote.get("max_daily_submissions"):
        facts["max_daily_submissions"] = remote["max_daily_submissions"]
    if remote.get("team_count"):
        facts["team_count"] = remote["team_count"]
    download_receipt = None
    if download:
        download_receipt = _kaggle_download(python, competition, workspace / "data" / "raw")
    (root / "task-provenance.json").write_text(json.dumps({"competition": competition, "prepared_at": time.time(),
                                                            "download": download_receipt}, indent=2), encoding="utf-8")
    facts.update(_sample_metadata(workspace / "data" / "raw"))
    (workspace / "data" / "competition.json").write_text(json.dumps(facts, indent=2, ensure_ascii=False), encoding="utf-8")
    (workspace / "data" / "instructions.md").write_text(INSTRUCTIONS.format(
        title=facts["title"], slug=facts["slug"], url=facts["url"], metric=facts["metric"],
        direction="higher is better" if facts.get("higher_is_better", True) else "lower is better",
        deadline=facts["deadline"], target_top=facts["target_top"]), encoding="utf-8")
    (workspace / "data" / "environment.md").write_text(ENVIRONMENT.format(workspace=workspace), encoding="utf-8")
    if not facts.get("sample_submission"):
        (workspace / "data" / "DATA_PENDING.md").write_text(
            "# Competition data is not available yet\n\n"
            "Kaggle credentials are not configured, or the competition rules have not been accepted.\n"
            "Set `KAGGLE_API_TOKEN` (or `~/.kaggle/kaggle.json`), accept the rules with the same account,\n"
            "then run the download helper:\n\n"
            f"```\npython {HELPER} download --competition {competition} --dest "
            f"{workspace / 'data' / 'raw'}\n```\n", encoding="utf-8")
    skill = workspace / "skills" / "self_evolution" / "SKILL.md"
    skill.parent.mkdir(parents=True, exist_ok=True)
    source_skill = PROJECT / "demo" / "harness-methods" / "kaggle_self_evolution" / "SKILL.md"
    skill.write_text(source_skill.read_text(encoding="utf-8"), encoding="utf-8")
    return {"prepared": str(root), "competition": facts, "download": download_receipt}


def _start_thinking_proxy(upstream: str) -> tuple[str, subprocess.Popen]:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    python = os.environ.get("KAGGLE_DEMO_PYTHON", sys.executable)
    process = subprocess.Popen([python, str(Path(__file__).with_name("thinking_proxy.py")),
                                "--port", str(port), "--upstream", upstream],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        with socket.socket() as probe:
            if probe.connect_ex(("127.0.0.1", port)) == 0:
                return f"http://127.0.0.1:{port}", process
        time.sleep(0.2)
    process.terminate()
    raise RuntimeError("Thinking proxy did not start")


def _provider(official: bool, values: dict, root: Path, model_override: str | None) -> tuple[dict, dict]:
    agent = Path.home() / ".pi" / "agent" if official else root / ".pi-agent"
    agent.mkdir(parents=True, exist_ok=True)
    if official:
        provider_id, model_id = "openai-codex", model_override or "gpt-6-luna"
        model = {"id": model_id, "name": "GPT-6 Luna", "api": "openai-codex-responses", "provider": provider_id,
                 "baseUrl": "https://chatgpt.com/backend-api", "reasoning": True, "input": ["text", "image"],
                 "contextWindow": 272000, "maxTokens": 12000,
                 "cost": {"input": 0.1, "output": 0.5, "cacheRead": 0.01, "cacheWrite": 0.125},
                 "thinkingLevelMap": {"off": None, "minimal": "low", "low": "low", "medium": "medium",
                                      "high": "high", "xhigh": "xhigh", "max": "max"},
                 "compat": {"supportsOpenAIGrammarTools": True, "supportsAdditionalTools": True,
                            "supportsToolSearch": True, "supportsMidConvoSystemMessages": True}}
        models_path, settings_path = agent / "models.json", agent / "settings.json"
        original_models = models_path.read_bytes() if models_path.exists() else None
        original_settings = settings_path.read_bytes() if settings_path.exists() else None
        config = json.loads(original_models) if original_models else {}
        provider = config.setdefault("providers", {}).setdefault(provider_id, {})
        provider["models"] = [item for item in provider.get("models", []) if item.get("id") != model_id] + [model]
        models_path.write_text(json.dumps(config, indent=2), encoding="utf-8")
        settings = json.loads(original_settings) if original_settings else {}
        settings.setdefault("compaction", {})["enabled"] = True
        settings.setdefault("retry", {})["enabled"] = False
        settings_path.write_text(json.dumps(settings, indent=2), encoding="utf-8")
        return {"commands": ["--provider", provider_id, "--model", model_id], "agent": agent,
                "restore": (models_path, original_models, settings_path, original_settings)}, {
            "provider": "OpenAI Codex OAuth (official)", "model": model_id}
    provider_id, model_id = "az-kaggle", model_override or "qwen3.8-27b"
    base = values.get("OPENAI_API_BASE")
    key = values.get("OPENAI_API_KEY")
    if not base or not key:
        raise ValueError("AZ provider credentials are missing from D:/autoresearch_pi_project/.env")
    proxy = _start_thinking_proxy(base) if model_id.startswith("deepseek") else None
    if proxy:
        base = proxy[0]
    rates = ({"input": 0.30, "output": 1.20, "cacheRead": 0.30, "cacheWrite": 0.30}
             if model_id.startswith("deepseek")
             else {"input": 20, "output": 80, "cacheRead": 20, "cacheWrite": 20})
    model = {"id": model_id, "name": model_id, "reasoning": True, "input": ["text"],
             "contextWindow": 128000, "maxTokens": 12000, "cost": rates}
    (agent / "models.json").write_text(json.dumps({"providers": {provider_id: {
        "baseUrl": base, "api": "openai-completions", "apiKey": "$OPENAI_API_KEY", "authHeader": True,
        "compat": {"supportsDeveloperRole": False, "thinkingFormat": "deepseek",
                   "requiresReasoningContentOnAssistantMessages": True}, "models": [model]}}}), encoding="utf-8")
    (agent / "settings.json").write_text(json.dumps({
        "compaction": {"enabled": True}, "retry": {"enabled": False, "provider": {"maxRetries": 0}},
        "httpIdleTimeoutMs": 900000}), encoding="utf-8")
    return {"commands": ["--provider", provider_id, "--model", model_id], "agent": agent,
            "restore": None, "proxy": proxy[1] if proxy else None}, {
        "provider": f"AZ {values['OPENAI_API_BASE']}", "model": model_id}


def run(root: Path, seconds: int = 14400, resume: bool = False, official_openai: bool = False,
        continue_prompt: str | None = None, thinking: str = "high", unbounded: bool = False,
        model: str | None = None) -> dict:
    values = {} if official_openai else load_project_dotenv(Path("D:/autoresearch_pi_project"))
    previous_protocol = json.loads((root / "protocol.json").read_text(encoding="utf-8")) if resume else {}
    started = previous_protocol.get("started_at", time.time())
    remaining = float("inf") if unbounded else min(seconds, 14400) - max(0, time.time() - started)
    if not unbounded and remaining <= 0:
        # A resumed run whose window expired while the process was down gets a fresh window.
        started, remaining = time.time(), min(seconds, 14400)
    deadline = None if unbounded else time.monotonic() + remaining
    provider, identity = _provider(official_openai, values, root, model)
    if official_openai:
        reserve_usd, input_usd, output_usd = "0.10", "0.10", "0.50"
    elif identity["model"].startswith("deepseek"):
        reserve_usd, input_usd, output_usd = "0.02", "0.30", "1.20"
    else:
        reserve_usd, input_usd, output_usd = "3.52", "20", "80"
    env = {**{key: value for key, value in os.environ.items()
              if key not in {"OPENAI_API_KEY", "KAGGLE_USERNAME", "KAGGLE_KEY", "KAGGLE_API_TOKEN"}},
           "PI_CODING_AGENT_DIR": str(provider["agent"]),
           "KAGGLE_DEMO_ROOT": str(root), "KAGGLE_DEMO_PYTHON": os.environ.get("KAGGLE_DEMO_PYTHON", sys.executable),
           "KAGGLE_DEMO_THINKING": thinking,
           "KAGGLE_DEMO_DEADLINE": "Infinity" if unbounded else str(int((time.time() + remaining) * 1000)),
           "KAGGLE_DEMO_UNBOUNDED": "1" if unbounded else "0",
           "KAGGLE_DEMO_REQUEST_RESERVE_USD": reserve_usd,
           "KAGGLE_DEMO_BUDGET_USD": "Infinity",
           "KAGGLE_DEMO_SPEND_NOTICE_USD": "12",
           "KAGGLE_DEMO_INPUT_USD_PER_MILLION": input_usd,
           "KAGGLE_DEMO_OUTPUT_USD_PER_MILLION": output_usd,
           "KAGGLE_DEMO_CACHE_READ_USD_PER_MILLION": input_usd,
           "KAGGLE_DEMO_CACHE_WRITE_USD_PER_MILLION": input_usd}
    if not official_openai:
        env["OPENAI_API_KEY"] = values["OPENAI_API_KEY"]
    for key in ("KAGGLE_USERNAME", "KAGGLE_KEY", "KAGGLE_API_TOKEN"):
        if os.environ.get(key):
            env[key] = os.environ[key]
    command = ["node", str(PROJECT / "node_modules/@earendil-works/pi-coding-agent/dist/cli.js"),
               "--mode", "rpc", "--no-context-files", "--no-extensions", "--no-skills", "--no-prompt-templates",
               "--no-builtin-tools", "--extension", str(PROJECT / "demo/kaggle_extension.ts"),
               *provider["commands"], "--thinking", thinking, "--session", str(root / "session.jsonl")]
    protocol = {"started_at": started, "base_branch": "codex/kaggle-evo-loop",
                "competition": json.loads((root / "workspace/data/competition.json").read_text(encoding="utf-8"))["slug"],
                "provider": identity["provider"], "model": identity["model"], "thinking": thinking,
                "max_seconds": None if unbounded else min(seconds, 14400),
                "hard_spend_limit_usd": None, "spend_notice_usd": 12,
                "scope": "one agent-owned Kaggle run with real submission feedback",
                "command": command}
    protocol["source_hashes"] = {str(path.relative_to(PROJECT)): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in [PROJECT / "demo/kaggle_extension.ts", PROJECT / "demo/self_root.ts", PROJECT / "demo/kaggle_task_context.ts",
                     PROJECT / "demo/prompts/kaggle_evo_system.md", PROJECT / "demo/prompts/self_root_meta_fields.md",
                     PROJECT / "demo/prompts/kaggle_adapt_system.md",
                     PROJECT / "src/autoresearch_pi/kaggle_demo.py", PROJECT / "src/autoresearch_pi/kaggle_api.py"]}
    if resume:
        protocol["resumes"] = [*previous_protocol.get("resumes", []), {"at": time.time(), "remaining_seconds": remaining}]
        protocol["previous_provider"] = previous_protocol.get("provider")
        protocol["previous_model"] = previous_protocol.get("model")
    (root / "protocol.json").write_text(json.dumps(protocol, indent=2), encoding="utf-8")
    summary = {"complete": False, "stop": "running", "provider": protocol["provider"], "model": protocol["model"],
               "competition": protocol["competition"]}
    (root / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")

    def record(event):
        if event.get("type") != "message_update":
            with (root / "pi-events.jsonl").open("a", encoding="utf-8") as stream:
                stream.write(json.dumps(event, ensure_ascii=False) + "\n")

    try:
        with PiKernel(command, cwd=str(root / "workspace"), env=env, timeout=1800 if unbounded else 90,
                      deadline=deadline, event_sink=record) as kernel:
            transport = continue_prompt if resume and continue_prompt else "KAGGLE_RESUME" if resume else (
                "Start the Kaggle competition. Read data/competition.json, data/instructions.md, "
                "data/environment.md and inspect data/raw. Establish reproducible validation, submit a "
                "credible baseline, then improve the solution through repeated leaderboard feedback. After "
                "each scored submission, complete the live-Agent EVO induction and seven-focus harness sweep; "
                "apply justified changes directly through reflection tools in those turns so later task work "
                "uses them. Continue until the top-10 target is verified or the authorized runtime/competition "
                "boundary ends. You have the same model for task work and self-evolution.")
            while deadline is None or time.monotonic() < deadline:
                response = kernel.prompt(transport)
                if response.get("success") is False:
                    raise RuntimeError(f"Pi rejected prompt: {response}")
                events = kernel.wait_for_agent_events(
                    timeout=max(1, deadline - time.monotonic()) if deadline is not None else 3600,
                    idle_timeout=None if unbounded else 3600)
                messages = [event["message"] for event in events
                            if event.get("type") == "message_end" and event.get("message", {}).get("role") == "assistant"]
                latest = messages[-1] if messages else {}
                loop_path = root / ".harness" / "kaggle-loop.json"
                state = json.loads(loop_path.read_text(encoding="utf-8")) if loop_path.exists() else {"complete": False}
                summary["submissions"] = len(state.get("submissions", []))
                summary["best"] = state.get("best")
                if state.get("complete"):
                    summary.update(complete=True, stop="finished", finish=state.get("finish"))
                    break
                if latest.get("stopReason") in ("error", "aborted"):
                    raise RuntimeError(latest.get("errorMessage", latest.get("stopReason")))
                transport = (
                    "KAGGLE_RESUME\nThe previous response reached its output token limit. An incomplete "
                    "tool call was not executed. Continue from saved files and receipts, not intended "
                    "writes. Make the next step small enough to complete."
                    if latest.get("stopReason") == "length" else "KAGGLE_NEXT")
                (root / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
            else:
                summary["stop"] = "time_budget"
    except Exception as error:
        summary["stop"] = "budget" if (root / "budget-stop.json").exists() else "runtime_error"
        summary["error"] = str(error)
    finally:
        if provider.get("proxy"):
            provider["proxy"].terminate()
        if provider.get("restore"):
            models_path, original_models, settings_path, original_settings = provider["restore"]
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
    parser.add_argument("--competition", default=TARGET["slug"])
    parser.add_argument("--python", default=os.environ.get("KAGGLE_DEMO_PYTHON", sys.executable))
    parser.add_argument("--metadata", help="JSON file with competition metadata overrides")
    parser.add_argument("--prepare", action="store_true")
    parser.add_argument("--no-download", action="store_true")
    parser.add_argument("--run", action="store_true")
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--official-openai", action="store_true")
    parser.add_argument("--continue-prompt")
    parser.add_argument("--continue-prompt-file", type=Path)
    parser.add_argument("--thinking", choices=["low", "medium", "high", "xhigh", "max"], default="high")
    parser.add_argument("--unbounded", action="store_true")
    parser.add_argument("--model")
    args = parser.parse_args()
    root = args.root.resolve()
    if args.continue_prompt_file:
        args.continue_prompt = args.continue_prompt_file.read_text(encoding="utf-8")
    if args.prepare:
        metadata = json.loads(Path(args.metadata).read_text(encoding="utf-8")) if args.metadata else None
        print(json.dumps(prepare(root, args.competition, args.python, not args.no_download, metadata), ensure_ascii=False, indent=2))
    if args.run:
        print(json.dumps(run(root, resume=args.resume, official_openai=args.official_openai,
                             continue_prompt=args.continue_prompt, thinking=args.thinking,
                             unbounded=args.unbounded, model=args.model), ensure_ascii=False, indent=2))
