"""Reuse report for a thin ARC run: does the self-harness offload repeated work, and at what cost?

Three things are measured separately, as the acceptance standard asks (docs/development-workflow.md §6):

* ``repetition``: python work the agent redid (same code up to numbers, or mostly the same lines), with the share of
  the issuing messages' output (reasoning included) attributed to it, and a heuristic share of reasoning spent on
  coordinates.
* ``components``: for every saved tool/observer/library, the cost to create, validate (failed saves) and maintain
  (later versions) it; how often it was invoked and the output it produced; and whether the repeated calls it
  covers stopped after it was saved (the component replaced the workflow) or went on (it did not).
* ``cost`` and ``task``: all model calls by kind (parent, critic, consult, adoption review, compaction), and the
  game result.

Attribution of a message's output tokens to its tool calls is an equal split; it is an estimate and labelled so.
Usage: ``python -m autoresearch_pi.arc_thin_reuse_report <run root>`` writes ``reuse_report.json`` and prints a summary.
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

_KEYWORDS = set(("False None True and as assert async await break class continue def del elif else except finally for from global "
                 "if import in is lambda nonlocal not or pass raise return try while with yield").split())
_RECEIPT = re.compile(r"(\S+) → (tool|observer|library|skill|prompt|role|note) (\S+) v(\d+): saved · (NOT loaded|loaded|off)")
_LEVELS = re.compile(r"\blevels=(\d+)")
_COORD = re.compile(r"\(\s*\d+\s*,\s*\d+\s*\)|\b[xy]\s*=\s*\d+|\b[xy]\d+\s*[-–]\s*\d+|\brows?\s+\d+|\bcol(?:umn)?s?\s+\d+|\bc\d{2}-\d{2}|\br\d{2}\b",
                    re.IGNORECASE)


def _hash(text: str, n: int) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:n]


def _structure(line: str) -> str:
    line = re.sub(r"\b\d+(\.\d+)?\b", "_", line)
    line = re.sub(r"(?<![.\w'\"])([A-Za-z_]\w*)\b(?!\s*\()", lambda m: m.group(1) if m.group(1) in _KEYWORDS else "_", line)
    return re.sub(r"\s+", " ", line)


def code_shape(code: str) -> dict[str, Any]:
    """Mirror of demo/arc_thin_reuse.ts codeShape (shape, normalised lines, line structures, gist)."""
    raw = [l for l in (re.sub(r"(^|\s)#.*$", "", line).strip() for line in code.splitlines()) if l]
    norm = [re.sub(r"\s+", " ", re.sub(r"\b\d+(\.\d+)?\b", "0", line)) for line in raw]
    gist = next((l for l in raw if not re.match(r"(import|from)\s", l)), raw[0] if raw else "")
    return {"shape": _hash("\n".join(norm), 12), "lines": sorted({_hash(l, 8) for l in norm}),
            "struct": sorted({_hash(_structure(l), 8) for l in raw if not re.match(r'(import|from|def|return|""")', l)}),
            "gist": gist if len(gist) <= 60 else gist[:59] + "…"}


def _rows(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return out


def _text(message: dict[str, Any]) -> str:
    content = message.get("content")
    if isinstance(content, str):
        return content
    return "\n".join(str(b.get("text", "")) for b in content or [] if isinstance(b, dict) and b.get("type") == "text")


def _families(calls: list[dict[str, Any]]) -> list[dict[str, Any]]:
    families: list[dict[str, Any]] = []
    for call in calls:
        lines = set(call["lines"])
        for family in families:
            shared = len(lines & family["lines"]) / max(1, len(lines | family["lines"]))
            if call["shape"] in family["shapes"] or shared >= 0.6:
                family["calls"].append(call)
                family["shapes"].add(call["shape"])
                break
        else:
            families.append({"gist": call["gist"], "calls": [call], "shapes": {call["shape"]}, "lines": lines, "struct": set(call["struct"])})
    return families


def _covers(component_struct: set[str], family: dict[str, Any]) -> bool:
    lines = family["struct"]
    if not lines:
        return False
    matched = len(lines & component_struct)
    return matched >= max(min(2, len(lines)), len(lines) / 2)


def build_report(root: Path) -> dict[str, Any]:
    root = Path(root)
    harness = root / "harness"
    events = _rows(root / "pi-events.jsonl")
    messages = [e["message"] for e in events if e.get("type") == "message_end" and isinstance(e.get("message"), dict)]

    # Walk the parent conversation in order: actions, levels, python calls, component receipts and invocations.
    actions, level, decision_calls = 0, 0, 0
    call_share: dict[str, dict[str, Any]] = {}
    python_calls: list[dict[str, Any]] = []
    saves: list[dict[str, Any]] = []
    invocations: list[dict[str, Any]] = []
    reasoning_sentences = coord_sentences = 0
    model_calls = 0
    for message in messages:
        role = message.get("role")
        if role == "assistant":
            model_calls += 1
            content = [b for b in message.get("content") or [] if isinstance(b, dict)]
            calls = [b for b in content if b.get("type") == "toolCall"]
            usage = message.get("usage") or {}
            output = int(usage.get("output") or 0)
            for block in content:
                if block.get("type") == "thinking":
                    sentences = [s for s in re.split(r"(?<=[.!?])\s+|\n+", str(block.get("thinking", ""))) if s.strip()]
                    reasoning_sentences += len(sentences)
                    coord_sentences += sum(1 for s in sentences if _COORD.search(s))
            for block in calls:
                share = output / len(calls)
                args = block.get("arguments") or {}
                entry = {"id": str(block.get("id")), "name": block.get("name"), "share": share, "action": actions, "level": level}
                call_share[entry["id"]] = entry
                if block.get("name") == "python" and isinstance(args.get("code"), str):
                    python_calls.append({**entry, **code_shape(args["code"]), "chars": len(args["code"])})
                    for m in re.finditer(r"\b(?:from|import)\s+(tools|lib)\.([A-Za-z_]\w*)", args["code"]):
                        invocations.append({"path": f"{m.group(1)}/{m.group(2)}.py", "action": actions, "share": share, "via": "import"})
                if block.get("name") in ("write", "edit") and isinstance(args.get("path"), str):
                    entry["path"] = args["path"]
        elif role == "toolResult":
            text = _text(message)
            entry = call_share.get(str(message.get("toolCallId")), {})
            entry["result_chars"] = len(text)
            if message.get("toolName") == "arc_action" and not message.get("isError") and re.match(r"#\d+ ", text):
                actions += 1
                found = _LEVELS.search(text)
                if found:
                    level = int(found.group(1))
            for m in _RECEIPT.finditer(text):
                saves.append({"path": m.group(1), "kind": m.group(2), "version": int(m.group(4)), "ok": m.group(5) != "NOT loaded",
                              "action": actions, "share": entry.get("share", 0.0), "tool": message.get("toolName")})
            name = message.get("toolName")
            if name and name not in ("arc_action", "memory", "python", "read", "write", "edit", "ls", "grep", "consult", "run_skill"):
                invocations.append({"name": name, "action": actions, "share": entry.get("share", 0.0), "result_chars": len(text), "via": "tool"})

    # Repetition.
    families = []
    for lvl in sorted({c["level"] for c in python_calls}):
        families.extend(_families([c for c in python_calls if c["level"] == lvl]))
    repeated_calls = [c for f in families for c in f["calls"][1:]]
    repetition = {
        "python_calls": len(python_calls),
        "repeated_calls": len(repeated_calls),
        "repeated_output_tokens_est": round(sum(c["share"] for c in repeated_calls)),
        "repeated_code_chars": sum(c["chars"] for c in repeated_calls),
        "repeated_result_chars": sum(c.get("result_chars", 0) for c in repeated_calls),
        "families": [{"gist": f["gist"], "calls": len(f["calls"]), "level": f["calls"][0]["level"],
                      "actions": [c["action"] for c in f["calls"]]} for f in families if len(f["calls"]) > 1],
        "reasoning_coordinate_share_est": round(coord_sentences / reasoning_sentences, 3) if reasoning_sentences else None,
    }

    # Components: sources from the binder's version store, by path.
    sources: dict[str, str] = {}
    for row in _rows(root / ".harness" / "components.jsonl"):
        good = row.get("good") or {}
        stored = root / ".harness" / "versions" / f"{good.get('hash')}.txt"
        if good.get("hash") and stored.is_file():
            sources[row["path"]] = stored.read_text(encoding="utf-8")
    observer_runs = _rows(harness / "observer_runs.jsonl")
    components = []
    for path in sorted({s["path"] for s in saves if s["kind"] in ("tool", "observer", "library")}):
        own = [s for s in saves if s["path"] == path]
        created = next((s for s in own if s["ok"]), None)
        name = Path(path).stem
        uses = [i for i in invocations if i.get("path") == path or (i.get("via") == "tool" and i.get("name") == name)]
        observed = [r for r in observer_runs if r.get("name") == name]
        struct = set(code_shape(sources.get(path, "")).get("struct", []))
        covered = [f for f in families if _covers(struct, f)] if created else []
        at = created["action"] if created else None
        before = sum(1 for f in covered for c in f["calls"] if at is not None and c["action"] < at)
        after = sum(1 for f in covered for c in f["calls"] if at is not None and c["action"] >= at)
        span_before = max(1, at or 0)
        span_after = max(1, actions - (at or actions))
        components.append({
            "path": path, "created_at_action": at, "versions": max((s["version"] for s in own), default=0),
            "failed_saves": sum(1 for s in own if not s["ok"]),
            "creation_output_tokens_est": round(sum(s["share"] for s in own[:own.index(created) + 1])) if created else round(sum(s["share"] for s in own)),
            "maintenance_output_tokens_est": round(sum(s["share"] for s in own[own.index(created) + 1:])) if created else 0,
            "invocations": len(uses) + len(observed),
            "invocation_output_tokens_est": round(sum(u.get("share", 0) for u in uses)),
            "output_chars": sum(u.get("result_chars", 0) for u in uses) + sum(len(json.dumps(r.get("value"))) for r in observed if "value" in r),
            "covered_families": [f["gist"] for f in covered],
            "covered_calls_before": before, "covered_calls_after": after,
            "covered_rate_before_per_action": round(before / span_before, 3), "covered_rate_after_per_action": round(after / span_after, 3),
            "replaced": bool(created and covered and (len(uses) + len(observed)) > 0 and after / span_after < before / span_before),
        })

    # Cost by kind, and the task.
    usage_rows = _rows(harness / "usage.jsonl")
    by_kind: dict[str, dict[str, int]] = {}
    for row in usage_rows:
        k = by_kind.setdefault(str(row.get("kind", "?")), {"calls": 0, "input": 0, "cache_read": 0, "cache_write": 0, "output": 0, "reasoning": 0})
        k["calls"] += 1
        for key in ("input", "cache_read", "cache_write", "output", "reasoning"):
            k[key] += int(row.get(key) or 0)
    agent = by_kind.get("agent", {})
    trajectory = _rows(harness / "trajectory.jsonl")
    times = [datetime.fromisoformat(str(r["t"]).replace("Z", "+00:00")) for r in trajectory if r.get("t")]
    hours = (times[-1] - times[0]).total_seconds() / 3600 if len(times) > 1 else 0.0
    summary = json.loads((root / "summary.json").read_text(encoding="utf-8")) if (root / "summary.json").is_file() else {}
    accounting = summary.get("request_accounting")
    total = accounting["known_tokens_lower_bound"] if accounting else sum(
        k["input"] + k["cache_read"] + k["cache_write"] + k["output"] for k in by_kind.values())
    report = {
        "format": "arc-thin-reuse-v1", "root": str(root),
        "task": {"actions": len(trajectory) or actions, "levels_completed": summary.get("levels_completed", max((int(r.get("levels_completed") or 0) for r in trajectory), default=0)),
                 "actions_per_hour": round(len(trajectory) / hours, 1) if hours else None, "parent_model_calls": model_calls},
        "cost": {"by_kind": by_kind, "total_reported": total,
                 "request_accounting": accounting,
                 "complete_cost_known": accounting.get("complete_cost_known") if accounting else None,
                 "cost_scope": "provider-reported lower bound; by_kind covers usage rows only, see request_accounting for failed/pending attempts",
                 "parent_calls_per_action": round(agent.get("calls", 0) / max(1, len(trajectory)), 2),
                 "parent_input_per_call": round((agent.get("input", 0) + agent.get("cache_read", 0)) / max(1, agent.get("calls", 0))),
                 "reasoning_per_action": round(agent.get("reasoning", 0) / max(1, len(trajectory)))},
        "repetition": repetition,
        "components": components,
        "notes": "output-token attribution splits each message's output equally among its tool calls; coordinate share counts sentences, not reasoning tokens; structural coverage is a heuristic. Missing usage remains unknown in request_accounting.",
    }
    return report


def render(report: dict[str, Any]) -> str:
    t, c, r = report["task"], report["cost"], report["repetition"]
    lines = [
        f"task: {t['actions']} actions, {t['levels_completed']} levels, {t['actions_per_hour']} actions/hour",
        f"cost: {c['total_reported']} reported tokens; {c['parent_calls_per_action']} parent calls/action; "
        f"{c['parent_input_per_call']} input/call; {c['reasoning_per_action']} reasoning/action; kinds {sorted(c['by_kind'])}",
        f"repetition: {r['repeated_calls']} of {r['python_calls']} python calls redone (~{r['repeated_output_tokens_est']} output tokens, "
        f"{r['repeated_code_chars']} code chars); coordinate reasoning share ~{r['reasoning_coordinate_share_est']}",
    ]
    for f in r["families"][:5]:
        lines.append(f"  family `{f['gist']}` ×{f['calls']} (level {f['level']}, at actions {f['actions'][:8]})")
    for comp in report["components"]:
        lines.append(f"component {comp['path']}: created #{comp['created_at_action']}, v{comp['versions']}, failed {comp['failed_saves']}, "
                     f"cost create~{comp['creation_output_tokens_est']} maintain~{comp['maintenance_output_tokens_est']} "
                     f"invoke~{comp['invocation_output_tokens_est']} ({comp['invocations']} uses), covered calls "
                     f"{comp['covered_calls_before']}→{comp['covered_calls_after']}, replaced={comp['replaced']}")
    if not report["components"]:
        lines.append("components: none saved")
    return "\n".join(lines)


def write_report(root: Path, out: Path | None = None) -> Path:
    report = build_report(root)
    path = Path(out) if out else Path(root) / "reuse_report.json"
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


if __name__ == "__main__":
    # Optional second argument: where to write the report (default <root>/reuse_report.json).
    out = write_report(Path(sys.argv[1]), Path(sys.argv[2]) if len(sys.argv) > 2 else None)
    print(render(json.loads(out.read_text(encoding="utf-8"))))
