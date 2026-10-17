"""Post-run analyst (r04 development loop): one call to a stronger model over a finished run's record.

It answers the development template (what happened per level, the failures, the broken transition, the refiner's part,
one general candidate change, what the record cannot tell) for the developers to review. A stronger model is used here
because this is analysis between runs, not a component of a run (agent-native, 2026-10-17); nothing goes back into the
run or the harness. Its proposals are candidates: each needs its own change record and test.

Usage: python -I tools/arc_post_run_analyst.py <run dir (.../arc-run)> [--model gpt-6.1-sol] [--max-chars 160000]
       [--out <file>] [--digest-only]
Writes <run dir>/analysis/post-run-<model>.md and .json (usage, the digest's size); --digest-only writes the digest
and makes no call.
"""
import json
import sys
import time
import urllib.request
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from autoresearch_pi.arc_agi_3_adapter import resolve_model_settings  # noqa: E402
from autoresearch_pi.project import load_project_dotenv  # noqa: E402

SYSTEM = (
    "You analyze one run of an ARC-AGI-3 agent harness for its developers. The agent (qwen3.8-27b) plays a game whose "
    "rules and goal it must discover. It acts through arc_action (with optional planned 'then' steps) or Python code, "
    "writes memory and hypotheses with checks the runtime runs on every move, and saves tools. A refiner, on the same "
    "model, edits the agent's strategy, rules and memory every few actions and may state what an edit should change "
    "(EXPECT); later refinements are shown whether those expectations were met. Using only the record below, answer in "
    "Markdown, citing action numbers (#n):\n"
    "1. What happened, per level: what the agent learned, what completed the level or failed to, and where its actions "
    "went.\n"
    "2. The failures: the moments the run lost actions or a level, and what the agent believed at those moments.\n"
    "3. The broken transition in this chain: an opportunity in the game, the agent recognizing it, investing actions or "
    "code in it, a candidate (belief, tool, plan), using it, feedback from the result, and keeping, revising or retiring "
    "it. Say where the chain broke and on what evidence.\n"
    "4. The refiner: whether its edits named the belief that failed, whether their expectations were met, and whether "
    "the agent used them.\n"
    "5. One general change to the harness that would have helped. It must not name this game's objects, colours, "
    "layout or goal, must work for an unknown game, and must not replace the agent's model. State its falsifiable "
    "claim and the measure that would show it in the next runs.\n"
    "6. What this record cannot tell.\n"
    "Do not invent observations; say where the record is silent."
)


def read(path):
    if not path.exists():
        return []
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            rows.append(json.loads(line))
        except ValueError:
            pass
    return rows


def text_of(path, limit):
    return path.read_text(encoding="utf-8")[:limit] if path.exists() else "(none)"


def label(row):
    return f"{row['action']}({row['x']},{row['y']})" if row.get("x") is not None and row.get("y") is not None else row["action"]


def digest(run):
    harness, workspace = run / "harness", run / "workspace"
    config = json.loads((run / "run-config.json").read_text(encoding="utf-8")) if (run / "run-config.json").exists() else {}
    summary = json.loads((run / "summary.json").read_text(encoding="utf-8")) if (run / "summary.json").exists() else {}
    rows = read(harness / "trajectory.jsonl")
    usage = read(harness / "usage.jsonl")
    tokens = Counter()
    for row in usage:
        tokens[row.get("kind", "?")] += int(row.get("input") or 0) + int(row.get("output") or 0)
    parts = [
        "RUN: " + json.dumps({key: config.get(key) for key in ("game", "model", "foundation", "thinking", "max_actions", "token_cap")
                              if key in config}),
        "SUMMARY: " + json.dumps({key: summary.get(key) for key in ("stop_reason", "actions", "levels_completed", "provider_errors")
                                  if key in summary}) + f"; budget tokens by kind: {dict(tokens)}",
    ]
    lines, level = [], 1
    for row in rows:
        note = " ".join(str(row.get("note") or "").split())[:160]
        predict = " ".join(str((row.get("predict") or {}).get("text") or "").split())[:100]
        marks = (" LEVEL" if row.get("level_changed") else "") + (f" {row['state']}" if row.get("state") in ("GAME_OVER", "WIN") else "")
        lines.append(f"#{row['n']} d{row.get('decision')} L{level} {label(row)} changed={row.get('changed_cells')}{marks}"
                     + (f" | {note}" if note else "") + (f" | predicts: {predict}" if predict else ""))
        if row.get("level_changed"):
            level += 1
    parts.append("ACTIONS (n, decision, level, action, cells changed, note, prediction):\n" + "\n".join(lines))
    refiner = read(harness / "refiner.jsonl")
    told = {row.get("id"): row.get("at") for row in refiner if row.get("kind") == "told"}
    edits = []
    for row in refiner:
        if row.get("kind") in ("start", "told", "suppressed", "queued", "over_budget"):
            continue
        expect = (row.get("expect") or {}).get("claim")
        edits.append(f"after #{row.get('at')} [{row.get('kind')}] {row.get('path') or ''} trigger: {(row.get('triggers') or [''])[0][:120]}"
                     f" | why: {str(row.get('why') or '')[:200]}" + (f" | expects: {expect[:160]}" if expect else "")
                     + (f" | shown to the agent at #{told[row.get('id')]}" if row.get("id") in told else ""))
    parts.append("REFINEMENTS:\n" + ("\n".join(edits) or "(none)"))
    inputs = read(harness / "refiner_inputs.jsonl")
    last_ledger = next((part for row in reversed(inputs) for part in row.get("input", "").split("\n\n")
                        if part.startswith("YOUR EARLIER EDITS")), "")
    if last_ledger:
        parts.append("THE LAST REFINEMENT'S LEDGER:\n" + last_ledger)
    checks = Counter()
    for row in read(harness / "claim_checks.jsonl"):
        if "result" in row and not row.get("control"):
            checks[(row["key"], {True: "holds", False: "fails", None: "n/a"}.get(row["result"], "error"))] += 1
    keys = sorted({key for key, _ in checks})
    parts.append("HYPOTHESIS CHECKS (all versions):\n" + ("\n".join(
        f"{key}: " + ", ".join(f"{kind} {checks[(key, kind)]}" for kind in ("holds", "fails", "n/a", "error") if checks[(key, kind)])
        for key in keys) or "(none)"))
    parts.append("FINAL MEMORY (data/memory.md):\n" + text_of(workspace / "data" / "memory.md", 6000))
    parts.append("FINAL prompts/strategy.md:\n" + text_of(workspace / "prompts" / "strategy.md", 3000))
    parts.append("FINAL prompts/rules.md:\n" + text_of(workspace / "prompts" / "rules.md", 3000))
    tools = sorted(p.name for p in (workspace / "tools").glob("*.py")) if (workspace / "tools").exists() else []
    parts.append("SAVED TOOLS: " + (", ".join(tools) or "(none)"))
    return "\n\n".join(parts)


def main():
    args = sys.argv[1:]
    run = Path(args[0])
    value = lambda flag, default=None: args[args.index(flag) + 1] if flag in args else default
    model, max_chars = value("--model", "gpt-6.1-sol"), int(value("--max-chars", 160_000))
    out = Path(value("--out", str(run / "analysis" / f"post-run-{model}.md")))
    out.parent.mkdir(parents=True, exist_ok=True)
    text = digest(run)
    if len(text) > max_chars:
        # The action list is the long part; its middle goes first.
        head, tail = text[: max_chars // 2], text[-max_chars // 2:]
        text = head + f"\n… ({len(text) - max_chars} characters of the record left out here) …\n" + tail
    if "--digest-only" in args:
        out.with_suffix(".digest.txt").write_text(text, encoding="utf-8")
        print(json.dumps({"digest": str(out.with_suffix(".digest.txt")), "chars": len(text)}))
        return
    settings = resolve_model_settings(load_project_dotenv(ROOT if (ROOT / ".env").exists() else Path(r"D:\autoresearch_pi_project")))
    body = {"model": model, "max_tokens": 8000, "stream": True, "stream_options": {"include_usage": True},
            "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": text}]}
    started, content, usage, finish, attempts = time.monotonic(), [], None, None, []
    # A reply usually streams within a minute; a stream that sends nothing for 5 minutes is tried once more.
    for attempt in range(2):
        content, usage, finish = [], None, None
        request = urllib.request.Request(settings["base_url"].rstrip("/") + "/chat/completions", data=json.dumps(body).encode(),
                                         headers={"content-type": "application/json", "authorization": f"Bearer {settings['api_key']}"})
        try:
            with urllib.request.urlopen(request, timeout=300) as response:
                for raw in response:
                    line = raw.decode("utf-8", "replace").strip()
                    if not line.startswith("data:") or line[5:].strip() == "[DONE]":
                        continue
                    chunk = json.loads(line[5:].strip())
                    usage = chunk.get("usage") or usage
                    for choice in chunk.get("choices") or []:
                        if (choice.get("delta") or {}).get("content"):
                            content.append(choice["delta"]["content"])
                        finish = choice.get("finish_reason") or finish
            break
        except (TimeoutError, OSError) as error:
            attempts.append(f"attempt {attempt + 1}: {type(error).__name__}: {str(error)[:200]}")
    if not content:
        raise SystemExit(json.dumps({"error": "no reply", "attempts": attempts}))
    out.write_text(f"<!-- post-run analysis of {run}, model {model}, {time.strftime('%Y-%m-%d %H:%M')} -->\n\n" + "".join(content), encoding="utf-8")
    meta = {"model": model, "digest_chars": len(text), "seconds": round(time.monotonic() - started, 1), "finish_reason": finish,
            "usage": usage, "retries": attempts}
    out.with_suffix(".json").write_text(json.dumps(meta, indent=1), encoding="utf-8")
    print(json.dumps({"analysis": str(out), **meta}))


if __name__ == "__main__":
    main()
