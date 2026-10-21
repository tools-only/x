"""S0 baseline for docs/plans/2026-10-21-components-by-default-canonical-forms.md: what the agent's python, its saved
components, its reads and the refiner's edits looked like in existing runs, per run and per level. Read-only on the runs.

Sources under <run>/arc-run/: pi-events.jsonl (the parent conversation: python cells with their code, reads, writes, saved
tool calls, action receipts for the level), harness/python_calls.jsonl (work-memory runs: cells with addresses; used when
present), harness/component_runs.jsonl, harness/observer_runs.jsonl, harness/refiner.jsonl, harness/call_points.jsonl,
harness/trajectory.jsonl, harness/usage.jsonl and .harness/components.jsonl (every saved version of every file). A file
that is missing is reported as missing, not as zero.

Usage: python tools/components_baseline.py [--runs-root <dir>] [--json <file>] [--all | --prompts] [<batch>/<run> ...]
Default runs: the plan's comparators (su15-g61-1, the lessons forks, chm) and the other arc-models runs. --all scans every
run under the runs root (one line per run: how common top-level defs and retyping are across the corpus). --prompts prints
every saved version of prompts/lessons.md and prompts/review.md of the named runs and nothing else, for the S3(b)
decision (procedure vs facts). The default runs root is this checkout's runs/; a worktree has none: pass the project's.
"""
from __future__ import annotations

import argparse
import ast
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from autoresearch_pi.arc_thin_reuse_report import _families, _rows, _text, code_shape  # noqa: E402

DEFAULT_RUNS = ["arc-models-20261019/su15-g61-1", "arc-lessons-20261020/su15-lr-g61", "arc-lessons-20261020/su15-lr-1020-q38",
                "arc-lessons-20261020/su15-lr-cb-q38", "arc-lessons-20261020/su15-lr-p13-q38", "arc-chm-20261020/su15-chm-q38-1",
                # The other arc-models runs: the S2 retyping baseline the plan cites (g61-2) and the weak model's shape.
                "arc-models-20261019/su15-g61-2", "arc-models-20261019/su15-g56-1", "arc-models-20261019/su15-g56-2",
                "arc-models-20261019/su15-q38-1", "arc-models-20261019/su15-q38-2", "arc-models-20261019/su15-q38-3"]
BUILTIN_TOOLS = {"arc_action", "memory", "python", "read", "write", "edit", "ls", "grep", "consult", "refine", "run_skill", "skill", "prompt"}
COMPONENT_FILE = re.compile(r"^(tools|observers|lib|skills|prompts|agents|roles)/")
PROMPT_FILE = re.compile(r"^prompts/[^/]+\.md$")
ACTION_LINE = re.compile(r"^#(\d+) (?:ACTION\d|RESET)\b(.*)$", re.MULTILINE)
LEVELS = re.compile(r"\blevels=(\d+)")
IMPORTS = re.compile(r"\b(?:from|import)\s+(tools|lib)\.([A-Za-z_]\w*)")


def top_level_defs(code: str) -> list[str] | None:
    """Names of the top-level def statements of a cell; None when the cell does not parse."""
    try:
        tree = ast.parse(code)
    except SyntaxError:
        return None
    return [node.name for node in tree.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))]


def parent_conversation(root: Path) -> list[dict[str, Any]]:
    """The parent's messages in order, from pi-events.jsonl (message_end) or, failing that, session.jsonl."""
    events = _rows(root / "pi-events.jsonl")
    messages = [e["message"] for e in events if e.get("type") == "message_end" and isinstance(e.get("message"), dict)]
    if messages:
        return messages
    return [e["message"] for e in _rows(root / "session.jsonl") if e.get("type") == "message" and isinstance(e.get("message"), dict)]


def walk(root: Path) -> dict[str, Any]:
    """Cells, reads, writes, saved-tool calls and saves from the parent conversation, each with the level it happened on."""
    actions, level = 0, 0
    cells: list[dict[str, Any]] = []
    reads: list[dict[str, Any]] = []
    writes: list[dict[str, Any]] = []
    tool_calls: list[dict[str, Any]] = []
    saves: list[dict[str, Any]] = []
    calls_by_id: dict[str, dict[str, Any]] = {}
    for message in parent_conversation(root):
        role = message.get("role")
        if role == "assistant":
            for block in [b for b in message.get("content") or [] if isinstance(b, dict) and b.get("type") == "toolCall"]:
                args = block.get("arguments") or {}
                name = block.get("name")
                calls_by_id[str(block.get("id"))] = {"name": name, "level": level}
                if name == "python" and isinstance(args.get("code"), str):
                    code = args["code"]
                    cells.append({"code": code, "level": level, "action": actions, "defs": top_level_defs(code),
                                  "imports": [f"{m.group(1)}/{m.group(2)}.py" for m in IMPORTS.finditer(code)], **code_shape(code)})
                    if args.get("save"):
                        saves.append({"path": f"tools/{args['save']}.py", "level": level, "via": "save"})
                elif name == "read" and isinstance(args.get("path"), str) and COMPONENT_FILE.match(args["path"]):
                    reads.append({"path": args["path"], "level": level})
                elif name in ("write", "edit") and isinstance(args.get("path"), str):
                    writes.append({"path": args["path"], "level": level, "tool": name})
                    if re.match(r"^(tools|observers|lib)/[^/]+\.py$", args["path"]):
                        saves.append({"path": args["path"], "level": level, "via": name})
                elif name and name not in BUILTIN_TOOLS:
                    tool_calls.append({"name": name, "level": level})
        elif role == "toolResult" and not message.get("isError"):
            for number, rest in ACTION_LINE.findall(_text(message)):
                actions = max(actions, int(number))
                found = LEVELS.search(rest)
                if found:
                    level = int(found.group(1))
    return {"cells": cells, "reads": reads, "writes": writes, "tool_calls": tool_calls, "saves": saves, "actions": actions, "level": level}


def cells_from_python_calls(root: Path, trajectory: list[dict[str, Any]]) -> list[dict[str, Any]] | None:
    """Work-memory runs keep every parent cell with its code in python_calls.jsonl; its level comes from the trajectory."""
    rows = _rows(root / "harness" / "python_calls.jsonl")
    if not rows:
        return None
    level_at = {0: 0}
    for row in trajectory:
        level_at[int(row.get("n") or 0)] = int(row.get("levels_completed") or 0)
    out = []
    for row in rows:
        code = row.get("code")
        if not isinstance(code, str):
            continue
        n = int(row.get("n") or 0)
        out.append({"code": code, "level": level_at.get(n, max((v for k, v in level_at.items() if k <= n), default=0)), "action": n,
                    "defs": top_level_defs(code), "imports": [f"{m.group(1)}/{m.group(2)}.py" for m in IMPORTS.finditer(code)],
                    "cached": bool(row.get("cached")), "same": row.get("same"), **code_shape(code)})
    return out


def per_level(cells: list[dict[str, Any]]) -> dict[int, dict[str, Any]]:
    out: dict[int, dict[str, Any]] = {}
    for level in sorted({c["level"] for c in cells}):
        on = [c for c in cells if c["level"] == level]
        names = Counter(name for c in on for name in (c["defs"] or []))
        families = [f for f in _families([c for c in on if not c.get("cached")]) if len(f["calls"]) > 1]
        out[level] = {"cells": len(on), "cells_with_defs": sum(1 for c in on if c["defs"]), "distinct_defs": len(names),
                      "redefinitions": sum(n - 1 for n in names.values()), "redefined_names": {k: v for k, v in names.items() if v > 1},
                      **{f"line_{k}": v for k, v in retyping(on).items()},
                      "families_2plus": len(families), "families_3plus": sum(1 for f in families if len(f["calls"]) >= 3),
                      "largest_family": max((len(f["calls"]) for f in families), default=0),
                      "largest_family_gist": max(families, key=lambda f: len(f["calls"]))["gist"] if families else "",
                      "unparsed_cells": sum(1 for c in on if c["defs"] is None)}
    return out


def versions(components: list[dict[str, Any]]) -> dict[str, Any]:
    """Saved versions per file from .harness/components.jsonl, by kind, with failed versions and the level of each."""
    by_path: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for entry in components:
        if entry.get("retired"):
            continue
        by_path[str(entry.get("path"))].append(entry)
    kinds = {"prompt": r"^prompts/[^/]+\.md$", "tool": r"^(tools|observers)/[^/]+\.py$", "lib": r"^lib/[^/]+\.py$",
             "skill": r"^skills/[^/]+/SKILL\.md$", "subagent": r"^(agents|roles)/[^/]+\.md$"}
    out: dict[str, Any] = {kind: {} for kind in kinds}
    for path, entries in by_path.items():
        for kind, pattern in kinds.items():
            if re.match(pattern, path):
                out[kind][path] = {"versions": len(entries), "failed": sum(1 for e in entries if e.get("error")),
                                   "levels": sorted(int(e.get("level") or 0) for e in entries)}
    return out


RUN_LINES = 5
# A single statement this long (after comments and spacing) is a computation, not a print: the per-move diff comprehension is one.
LONG_LINE = 40


def normal_lines(code: str) -> list[str]:
    """The code's lines without comments, blank lines and spacing differences (as code_shape reads them)."""
    return [re.sub(r"\s+", " ", line) for line in (re.sub(r"(^|\s)#.*$", "", raw).strip() for raw in code.splitlines()) if line]


def retyping(cells: list[dict[str, Any]]) -> dict[str, int]:
    """Per level: cells that repeat an earlier cell of the level exactly (`verbatim`), repeat one with other numbers only
    (`renumbered`: the same normalised shape), and cells that are neither but retype a run of RUN_LINES or more consecutive
    lines of an earlier cell (comments and spacing ignored; `retyped_cells`, and `retyped_lines` in those runs). This is the
    line-run measure of docs/plans/2026-10-20-work-memory.md, where the 'retyped per-move diff' figures come from."""
    out = {"verbatim": 0, "renumbered": 0, "retyped_cells": 0, "retyped_lines": 0, "retyped_long": 0, "lines": 0}
    for level in sorted({c["level"] for c in cells}):
        seen_cells: set[str] = set()
        seen_shapes: set[str] = set()
        seen_runs: set[tuple[str, ...]] = set()
        seen_long: set[str] = set()
        for cell in (c for c in cells if c["level"] == level):
            lines = normal_lines(cell["code"])
            text = "\n".join(lines)
            out["lines"] += len(lines)
            runs = [tuple(lines[i:i + RUN_LINES]) for i in range(len(lines) - RUN_LINES + 1)]
            long_lines = {re.sub(r"\b\d+(\.\d+)?\b", "0", line) for line in lines if len(line) >= LONG_LINE}
            if text and text in seen_cells:
                out["verbatim"] += 1
            elif text and cell["shape"] in seen_shapes:
                out["renumbered"] += 1
            else:
                covered = {j for i, run in enumerate(runs) if run in seen_runs for j in range(i, i + RUN_LINES)}
                if covered:
                    out["retyped_cells"] += 1
                    out["retyped_lines"] += len(covered)
                if long_lines & seen_long:
                    out["retyped_long"] += 1
            seen_cells.add(text)
            seen_shapes.add(cell["shape"])
            seen_runs.update(runs)
            seen_long |= long_lines
    return out


def tokens(usage: list[dict[str, Any]]) -> dict[str, Any]:
    """Token sums by kind. Pi's usage convention (arc_thin_extension.ts appendUsage): `input` is the uncached prompt, `cache_read`
    the cached part, so the uncached share of the agent's prompt tokens is input / (input + cache_read)."""
    out: dict[str, dict[str, int]] = {}
    for row in usage:
        kind = str(row.get("kind") or "?")
        bucket = out.setdefault(kind, {"calls": 0, "input": 0, "cache_read": 0, "output": 0, "reasoning": 0})
        bucket["calls"] += 1
        for key in ("input", "cache_read", "output", "reasoning"):
            bucket[key] += int(row.get(key) or 0)
    agent = out.get("agent", {"input": 0, "cache_read": 0})
    prompt = agent["input"] + agent["cache_read"]
    return {"by_kind": out, "input": sum(b["input"] for b in out.values()), "cache_read": sum(b["cache_read"] for b in out.values()),
            "output": sum(b["output"] for b in out.values()), "agent_uncached_share": round(agent["input"] / prompt, 2) if prompt else None}


def analyse(root: Path) -> dict[str, Any]:
    harness = root / "harness"
    present = {name: (harness / name).is_file() for name in ("python_calls.jsonl", "component_runs.jsonl", "observer_runs.jsonl",
                                                             "refiner.jsonl", "call_points.jsonl", "trajectory.jsonl", "usage.jsonl")}
    present["components.jsonl"] = (root / ".harness" / "components.jsonl").is_file()
    present["pi-events.jsonl"] = (root / "pi-events.jsonl").is_file()
    trajectory = _rows(harness / "trajectory.jsonl")
    walked = walk(root)
    cells = cells_from_python_calls(root, trajectory) or walked["cells"]
    source = "python_calls.jsonl" if present["python_calls.jsonl"] else "pi-events.jsonl"
    components = _rows(root / ".harness" / "components.jsonl")
    refiner = _rows(harness / "refiner.jsonl")
    observer = _rows(harness / "observer_runs.jsonl")
    runs = _rows(harness / "component_runs.jsonl")
    call_points = _rows(harness / "call_points.jsonl")
    levels_done = int(trajectory[-1].get("levels_completed") or 0) if trajectory else walked["level"]
    saved = versions(components)
    by_level = per_level(cells)
    edits = Counter(str(r.get("category") or "?") for r in refiner if r.get("kind") == "edit")
    edits_by_level: dict[int, Counter] = defaultdict(Counter)
    for r in refiner:
        if r.get("kind") == "edit":
            edits_by_level[int(r.get("evidence_level") or 0)][str(r.get("category") or "?")] += 1
    outcomes = Counter(str(r.get("kind")) for r in refiner if r.get("kind") in ("edit", "refused", "invalid", "none", "stale", "unchanged", "returned", "failed"))
    views_shown = [r for r in observer if r.get("ok") and r.get("value") not in (None, "", [], {})]
    reads_by_kind = Counter(re.match(r"^([a-z]+)/", r["path"]).group(1) for r in walked["reads"])
    persisted = {p for p in saved["tool"]} | {p for p in saved["lib"]}
    imports = [i for c in cells for i in c["imports"]]
    tool_runs = [r for r in runs if r.get("kind") == "tool" and not r.get("readonly")]
    return {
        "run": root.parent.name, "batch": root.parent.parent.name, "present": present, "cells_source": source,
        "actions": len(trajectory) or walked["actions"], "levels": levels_done, "decisions": int(trajectory[-1].get("decision") or 0) if trajectory else None,
        "cells": len(cells), "cells_with_defs": sum(1 for c in cells if c["defs"]), "unparsed_cells": sum(1 for c in cells if c["defs"] is None),
        "cached_repeats": sum(1 for c in cells if c.get("cached")), **{f"line_{k}": v for k, v in retyping(cells).items()},
        "distinct_defs": len({n for c in cells for n in (c["defs"] or [])}),
        "redefinitions": sum(n - 1 for n in Counter(n for c in cells for n in (c["defs"] or [])).values()),
        "redefined_names": {k: v for k, v in Counter(n for c in cells for n in (c["defs"] or [])).items() if v > 1},
        "families_2plus": sum(v["families_2plus"] for v in by_level.values()), "families_3plus": sum(v["families_3plus"] for v in by_level.values()),
        "saves": len(walked["saves"]), "saved_paths": sorted({s["path"] for s in walked["saves"]}),
        "tools_saved": len(saved["tool"]), "libs_saved": len(saved["lib"]), "skills_saved": len(saved["skill"]), "subagents_saved": len(saved["subagent"]),
        "tool_calls": len(walked["tool_calls"]), "tool_runs_logged": len(tool_runs), "imports_of_components": len(imports), "imports": imports,
        "views_shown": len(views_shown), "views": sorted({str(r.get("name")) for r in views_shown}), "view_runs": len(observer),
        "component_reads": len(walked["reads"]), "reads_by_kind": dict(reads_by_kind), "read_paths": Counter(r["path"] for r in walked["reads"]).most_common(8),
        "refiner_edits": dict(edits), "refiner_outcomes": dict(outcomes), "refiner_edits_by_level": {k: dict(v) for k, v in sorted(edits_by_level.items())},
        "prompt_versions": saved["prompt"], "prompt_versions_total": sum(v["versions"] for v in saved["prompt"].values()),
        "call_points": dict(Counter(str(r.get("kind")) for r in call_points)) if present["call_points.jsonl"] else None,
        "tokens": tokens(_rows(harness / "usage.jsonl")) if present["usage.jsonl"] else None,
        "by_level": by_level, "persisted": sorted(persisted),
    }


def prompt_versions(root: Path) -> list[dict[str, Any]]:
    """Every saved version of the review prompts, with its level and body (the binder keeps a prompt's body in its entry)."""
    out = []
    for entry in _rows(root / ".harness" / "components.jsonl"):
        path = str(entry.get("path"))
        if path in ("prompts/lessons.md", "prompts/review.md") and not entry.get("retired"):
            good = entry.get("good") or {}
            out.append({"path": path, "version": entry.get("version"), "level": entry.get("level"), "error": entry.get("error"),
                        "body": good.get("body") or ""})
    return out


def cell_text(value: Any) -> str:
    if value is None:
        return "—"
    if isinstance(value, float):
        return f"{value:.2f}"
    if isinstance(value, dict):
        return ", ".join(f"{k} {v}" for k, v in value.items()) or "0"
    return str(value)


RETYPE_HEAD = "verbatim / renumbered / 5-line run / long statement"


def retype_text(row: dict[str, Any], prefix: str = "line_") -> str:
    """The four retyping counts of one run or one level, in RETYPE_HEAD's order (levels use the same keys as runs: line_<name>)."""
    return " / ".join(str(row[f"{prefix}{key}"]) for key in ("verbatim", "renumbered", "retyped_cells", "retyped_long"))


def render(reports: list[dict[str, Any]]) -> str:
    lines = ["Per run (levels = levels completed; defs = top-level def statements in the parent's python cells; re-def = a name defined "
             "again in a later cell; retyping, per cell and level: verbatim = repeats an earlier cell exactly, renumbered = the same "
             "shape with other numbers, 5-line run = retypes five or more consecutive lines of an earlier cell, long statement = reuses a "
             "40+ character statement (numbers ignored); families = python redone with the same shape or mostly the same lines on "
             "one level, 2+/3+ calls; reads = read calls on component files; refiner edits by category).", ""]
    head = ["run", "model", "actions", "levels", "cells", "cells w/ defs", "distinct defs / re-defs", RETYPE_HEAD, "families 2+/3+", "saves",
            "tools/lib/skills/agents saved", "saved-tool calls", "component imports", "views shown (views)", "component reads", "refiner edits",
            "prompt versions", "tokens in/cached/out (k)", "agent uncached share"]
    lines.append("| " + " | ".join(head) + " |")
    lines.append("| " + " | ".join("---" for _ in head) + " |")
    for r in reports:
        t = r["tokens"] or {}
        lines.append("| " + " | ".join(cell_text(v) for v in [
            f"{r['batch']}/{r['run']}", r.get("model") or "", r["actions"], r["levels"], r["cells"], r["cells_with_defs"],
            f"{r['distinct_defs']} / {r['redefinitions']}", retype_text(r),
            f"{r['families_2plus']}/{r['families_3plus']}", r["saves"], f"{r['tools_saved']}/{r['libs_saved']}/{r['skills_saved']}/{r['subagents_saved']}",
            r["tool_calls"], r["imports_of_components"], f"{r['views_shown']} ({', '.join(r['views']) or 'none'})", r["component_reads"],
            r["refiner_edits"], ", ".join(f"{p.split('/')[-1]} v{v['versions']}" for p, v in r["prompt_versions"].items()) or "none",
            f"{t.get('input', 0) // 1000}/{t.get('cache_read', 0) // 1000}/{t.get('output', 0) // 1000}" if t else None, t.get("agent_uncached_share")]) + " |")
    lines += ["", "Per level (the level the cell ran on, counted from 1):", ""]
    head2 = ["run", "level", "cells", "cells w/ defs", "distinct defs", "re-defs (names)", RETYPE_HEAD, "families 2+/3+ (largest)", "refiner edits",
             "prompt versions saved on the level"]
    lines.append("| " + " | ".join(head2) + " |")
    lines.append("| " + " | ".join("---" for _ in head2) + " |")
    for r in reports:
        for level, v in sorted(r["by_level"].items()):
            prompts = ", ".join(f"{p.split('/')[-1]}×{pv['levels'].count(level)}" for p, pv in r["prompt_versions"].items() if level in pv["levels"])
            lines.append("| " + " | ".join(cell_text(x) for x in [
                r["run"], level + 1, v["cells"], v["cells_with_defs"], v["distinct_defs"],
                f"{v['redefinitions']}" + (f" ({', '.join(f'{k}×{n}' for k, n in v['redefined_names'].items())})" if v["redefined_names"] else ""),
                retype_text(v, "line_"),
                f"{v['families_2plus']}/{v['families_3plus']}" + (f" ({v['largest_family']}: `{v['largest_family_gist']}`)" if v["largest_family"] else ""),
                r["refiner_edits_by_level"].get(level, {}), prompts or "none"]) + " |")
    lines += ["", "Missing sources (reported, not counted as zero):"]
    for r in reports:
        missing = [name for name, ok in r["present"].items() if not ok]
        lines.append(f"- {r['run']}: {', '.join(missing) if missing else 'none'}; cells from {r['cells_source']}")
    return "\n".join(lines)


def render_all(reports: list[dict[str, Any]]) -> str:
    """One line per run found, runs that define functions first: how common top-level defs are across the corpus."""
    lines = [f"| run | game | model | actions | levels | cells | cells w/ defs | distinct defs / re-defs | {RETYPE_HEAD} | saved tools/lib |", "|---|---|---|---|---|---|---|---|---|---|"]
    for r in sorted(reports, key=lambda r: (-r["cells_with_defs"], -r["cells"])):
        lines.append("| " + " | ".join(cell_text(v) for v in [f"{r['batch']}/{r['run']}", r.get("game") or "", r.get("model") or "", r["actions"], r["levels"],
                                                              r["cells"], r["cells_with_defs"], f"{r['distinct_defs']} / {r['redefinitions']}",
                                                              retype_text(r), f"{r['tools_saved']}/{r['libs_saved']}"]) + " |")
    total = {k: sum(r[k] for r in reports) for k in ("cells", "cells_with_defs", "redefinitions", "line_verbatim", "line_renumbered", "line_retyped_cells", "line_retyped_long")}
    lines += ["", f"{len(reports)} runs: {total['cells']} python cells, {total['cells_with_defs']} with a top-level def ({100 * total['cells_with_defs'] / max(1, total['cells']):.1f}%), "
              f"{total['redefinitions']} re-definitions; {total['line_verbatim']} verbatim repeats, {total['line_renumbered']} repeats with other numbers, "
              f"{total['line_retyped_cells']} cells retyping a five-line run, {total['line_retyped_long']} reusing a long statement."]
    return "\n".join(lines)


def attach_config(report: dict[str, Any], root: Path) -> None:
    config = root / "run-config.json"
    if config.is_file():
        try:
            data = json.loads(config.read_text(encoding="utf-8"))
            report["model"], report["game"] = data.get("model"), data.get("game")
        except (json.JSONDecodeError, OSError):
            pass


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("runs", nargs="*", default=DEFAULT_RUNS, help="<batch>/<run> under the runs root")
    parser.add_argument("--runs-root", default=str(Path(__file__).resolve().parents[1] / "runs"))
    parser.add_argument("--json", help="write the full per-run data here")
    parser.add_argument("--prompts", action="store_true", help="print every saved version of prompts/lessons.md and prompts/review.md, and nothing else")
    parser.add_argument("--all", action="store_true", help="scan every <batch>/<run>/arc-run under the runs root and print the one-line-per-run table")
    parser.add_argument("--out", help="write the text here (UTF-8, LF) instead of printing it")
    args = parser.parse_args(argv)
    runs_root = Path(args.runs_root)
    names = args.runs
    if args.all:
        names = sorted(f"{p.parent.parent.name}/{p.parent.name}" for p in runs_root.glob("*/*/arc-run") if (p / "pi-events.jsonl").is_file() or (p / "harness" / "python_calls.jsonl").is_file())

    def emit(text: str) -> None:
        if args.out:
            Path(args.out).write_text(text.rstrip("\n") + "\n", encoding="utf-8", newline="\n")
        else:
            sys.stdout.reconfigure(encoding="utf-8")
            print(text)

    if args.prompts:
        blocks = []
        for name in names:
            root = runs_root / name / "arc-run"
            for v in prompt_versions(root) if root.is_dir() else []:
                blocks.append(f"=== {name} {v['path']} v{v['version']} (level {int(v['level'] or 0) + 1}{', FAILED: ' + str(v['error']) if v['error'] else ''})\n{v['body'].rstrip()}\n")
        emit("\n".join(blocks))
        return 0
    reports = []
    for name in names:
        root = runs_root / name / "arc-run"
        if not root.is_dir():
            print(f"skipped {name}: no arc-run directory", file=sys.stderr)
            continue
        report = analyse(root)
        attach_config(report, root)
        reports.append(report)
    emit(render_all(reports) if args.all else render(reports))
    if args.json:
        Path(args.json).write_text(json.dumps(reports, indent=2, default=str), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
