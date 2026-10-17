"""Replays logged refinement inputs of finished runs under a variant, offline (r04 development loop, E3).

Adapted from the 2026-10-16 refinement replay (C:/Users/qi/tmp/refiner-ledger/replay_diag.py; record
docs/plans/2026-10-16-refinement-ledger.md on claude/refiner-ledger-20261016). Every r04 run logs each refinement's
whole input (harness/refiner_inputs.jsonl), so a change to the refinement role can be tried on real inputs before it is
built. A variant is a model with an optional text appended to the logged system prompt; the agent's own model is the
default, since the in-run refiner must stay on it (agent-native, 2026-10-17). Each selected input is sent --samples
times; the reply, the edit as the runtime would parse it, and the usage go to <out>/results.jsonl, in shuffled order, so
that grading can be done blind afterwards.

Usage: python -I tools/arc_refine_replay.py <out dir> --input <harness dir>:<row>[,<row>...] [--input ...]
       [--variant <name>=<model>[+<file appended to the system prompt>]] [--samples 2] [--budget 300000]
       [--workers 4] [--thinking off|on]
Rows are 0-based line numbers of refiner_inputs.jsonl. Without --variant: base=qwen3.8-27b.
"""
import json
import random
import re
import sys
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from autoresearch_pi.arc_agi_3_adapter import resolve_model_settings  # noqa: E402
from autoresearch_pi.project import load_project_dotenv  # noqa: E402

lock = threading.Lock()
spent = {"tokens": 0, "calls": 0}


def budget_tokens(usage):
    if not usage:
        return 0
    cached = (usage.get("prompt_tokens_details") or {}).get("cached_tokens") or 0
    return max(0, (usage.get("prompt_tokens") or 0) - cached) + (usage.get("completion_tokens") or 0)


def call(settings, model, messages, extra, max_tokens):
    body = {"model": model, "messages": messages, "max_tokens": max_tokens, "stream": True,
            "stream_options": {"include_usage": True}, **extra}
    request = urllib.request.Request(settings["base_url"].rstrip("/") + "/chat/completions", data=json.dumps(body).encode(),
                                     headers={"content-type": "application/json", "authorization": f"Bearer {settings['api_key']}"})
    started = time.monotonic()
    content, finish, usage = [], None, None
    with urllib.request.urlopen(request, timeout=600) as response:
        for raw in response:
            line = raw.decode("utf-8", "replace").strip()
            if not line.startswith("data:"):
                continue
            data = line[5:].strip()
            if data == "[DONE]":
                break
            chunk = json.loads(data)
            usage = chunk.get("usage") or usage
            for choice in chunk.get("choices") or []:
                delta = choice.get("delta") or {}
                if delta.get("content"):
                    content.append(delta["content"])
                finish = choice.get("finish_reason") or finish
    return {"seconds": round(time.monotonic() - started, 1), "finish_reason": finish, "text": "".join(content), "usage": usage}


def edit_block(text):
    """The edit as the runtime would parse it (arc_thin_refiner.ts parseRefinerReply): its kind, block and WHY line."""
    none = re.search(r"^\s*NONE\b[:\s]*(.*)$", text, re.M)
    file = re.search(r"^\s*FILE\s+(\S+)\s*\r?\n([\s\S]*?)\r?\n\s*END\s*$", text, re.M)
    memory = re.search(r"^\s*MEMORY\s+(\S+)\s+([1-5])(?:[ \t]+\[?replaces[ \t]+([^\r\n\]]+)\]?)?\s*\r?\n([\s\S]*?)\r?\n\s*END\s*$", text, re.M)
    hypothesis = re.search(r"^\s*HYPOTHESIS\s+(\S+)\s*\r?\n([\s\S]*?)\r?\n\s*END\s*$", text, re.M)
    block = file or memory or hypothesis
    if not block:
        return ("none", "NONE " + none.group(1).strip()) if none else ("invalid", text[-3000:])
    why = re.search(r"^\s*WHY\b[:\s]*(.*)$", text[block.end():], re.M)
    kind = "file" if block is file else "memory" if block is memory else "hypothesis"
    return kind, block.group(0).strip() + "\nWHY " + (why.group(1).strip() if why else "")


def main():
    args = sys.argv[1:]
    out = Path(args[0])
    out.mkdir(parents=True, exist_ok=True)
    value = lambda flag, default=None: args[args.index(flag) + 1] if flag in args else default
    inputs = [args[i + 1] for i, arg in enumerate(args) if arg == "--input"]
    variants = [args[i + 1] for i, arg in enumerate(args) if arg == "--variant"] or ["base=qwen3.8-27b"]
    samples, budget, workers = int(value("--samples", 2)), int(value("--budget", 300_000)), int(value("--workers", 4))
    thinking = value("--thinking", "off") == "on"
    settings = resolve_model_settings(load_project_dotenv(ROOT if (ROOT / ".env").exists() else Path(r"D:\autoresearch_pi_project")))
    rows = []
    for spec in inputs:
        harness, picks = spec.rsplit(":", 1)
        logged = [json.loads(line) for line in (Path(harness) / "refiner_inputs.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
        rows += [(harness, int(i), logged[int(i)]) for i in picks.split(",")]
    jobs = []
    for spec in variants:
        name, rest = spec.split("=", 1)
        model, _, append = rest.partition("+")
        extra_text = Path(append).read_text(encoding="utf-8") if append else ""
        for harness, index, row in rows:
            for sample in range(samples):
                jobs.append({"id": f"{name}-{Path(harness).parent.parent.name}-{index}-{sample}", "variant": name, "model": model,
                             "append": extra_text, "harness": harness, "index": index, "at": row.get("at"), "sample": sample, "row": row})
    random.Random(len(jobs)).shuffle(jobs)
    results = out / "results.jsonl"
    done = {json.loads(line)["id"] for line in results.read_text(encoding="utf-8").splitlines() if line.strip()} if results.exists() else set()

    def work(job):
        if job["id"] in done:
            return
        with lock:
            if spent["tokens"] >= budget:
                return
        # Qwen's dialect carries the thinking switch; other models get the gateway's default.
        extra = {"enable_thinking": thinking} if job["model"].startswith("qwen") else {}
        messages = [{"role": "system", "content": job["row"]["system"] + job["append"]}, {"role": "user", "content": job["row"]["input"]}]
        record = {key: job[key] for key in ("id", "variant", "model", "harness", "index", "at", "sample")}
        try:
            result = call(settings, job["model"], messages, extra, 6000)
            record.update(text=result["text"], finish_reason=result["finish_reason"], seconds=result["seconds"], usage=result["usage"],
                          budget_tokens=budget_tokens(result["usage"]), expect=bool(re.search(r"^\s*EXPECT\b", result["text"], re.M)))
            record["edit_kind"], record["edit"] = edit_block(result["text"])
        except Exception as error:  # noqa: BLE001 - recorded, not retried
            record["error"] = str(error)[:500]
        with lock:
            spent["tokens"] += record.get("budget_tokens", 0)
            spent["calls"] += 1
            with results.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(record, ensure_ascii=False) + "\n")

    with ThreadPoolExecutor(max_workers=workers) as pool:
        list(pool.map(work, jobs))
    print(json.dumps({"jobs": len(jobs), "calls": spent["calls"], "budget_tokens": spent["tokens"], "results": str(results)}))


if __name__ == "__main__":
    main()
