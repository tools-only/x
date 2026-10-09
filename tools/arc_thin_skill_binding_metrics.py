"""Skill call-binding metrics for one thin ARC run (diagnostic, read only).

Usage: python tools/arc_thin_skill_binding_metrics.py <run root> <out.json>
The run root is only read.
Change record: docs/plans/2026-10-09-thin-skill-call-binding.md
"""

from __future__ import annotations

import json
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any


def _rows(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    rows = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        if line.strip():
            try:
                rows.append(json.loads(line))
            except ValueError:
                pass
    return rows


def _ms(iso: str) -> float:
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp() * 1000


def _text(result: Any) -> str:
    content = (result or {}).get("content") or []
    return "\n".join(str(block.get("text") or "") for block in content if isinstance(block, dict))


def unknown_name_kind(tool: str, text: str) -> str | None:
    """Why a skill call named no saved skill: execute-time refusal, schema rejection, or tool not exposed."""
    if tool == "run_skill" and text.startswith("no skill '"):
        return "execute_refusal"
    if f'Validation failed for tool "{tool}"' in text and tool == "run_skill" and "name:" in text:
        return "schema_rejection"
    if text.startswith(f"Tool {tool} not found") and tool == "run_skill":
        return "not_exposed"
    return None


def metrics(root: Path) -> dict[str, Any]:
    harness = root / "harness"
    summary = json.loads((root / "summary.json").read_text(encoding="utf-8")) if (root / "summary.json").exists() else {}
    skill_rows = _rows(harness / "skills.jsonl")
    usage = [row for row in _rows(harness / "usage.jsonl") if row.get("kind") == "agent"]
    runs = _rows(harness / "skill_runs.jsonl")
    trajectory = _rows(harness / "trajectory.jsonl")
    surface = _rows(harness / "skill_surface.jsonl")

    def decision_at(t_ms: float) -> int | None:
        before = [row for row in usage if _ms(row["t"]) <= t_ms]
        return int(before[-1]["decision"]) if before else None

    saves = [{"name": row["name"], "version": row.get("version"), "t": row["t"], "decision": decision_at(_ms(row["t"])),
              "board_repair": str(row["name"]).startswith("board_")}
             for row in skill_rows if not row.get("deleted")]
    deletes = [{"name": row["name"], "t": row["t"], "decision": decision_at(_ms(row["t"]))}
               for row in skill_rows if row.get("deleted")]

    # Pi lifecycle: one agent run per prompt; turns are assistant messages.
    turns: list[dict[str, Any]] = []
    call_turn: dict[str, int] = {}
    run_index = 0
    run_kind = "decide"
    action_done_in_run = False
    for event in _rows(root / "pi-events.jsonl"):
        kind = event.get("type")
        if kind == "agent_start":
            run_index += 1
            action_done_in_run = False
        elif kind == "message_end":
            message = event.get("message") or {}
            if message.get("role") == "user":
                run_kind = "consolidate" if _text(message).lstrip().startswith("CONSOLIDATE:") else "decide"
            elif message.get("role") == "assistant":
                calls = [block for block in message.get("content") or [] if block.get("type") == "toolCall"]
                turns.append({"turn": len(turns) + 1, "run": run_index, "kind": run_kind, "t": message.get("timestamp"),
                              "after_action": action_done_in_run, "stop": message.get("stopReason"),
                              "calls": [{"id": c.get("id"), "name": c.get("name"), "args": c.get("arguments")} for c in calls],
                              "results": {}})
                for call in calls:
                    call_turn[str(call.get("id"))] = len(turns) - 1
        elif kind == "tool_execution_end":
            index = call_turn.get(str(event.get("toolCallId")))
            if index is None:
                continue
            text = _text(event.get("result"))
            turns[index]["results"][str(event.get("toolCallId"))] = {
                "tool": event.get("toolName"), "is_error": bool(event.get("isError")), "text": text[:400]}
            if event.get("toolName") == "arc_action" and not event.get("isError"):
                action_done_in_run = True

    unknown: list[dict[str, Any]] = []
    wasted_turns = 0
    for turn in turns:
        failures = 0
        for call in turn["calls"]:
            result = turn["results"].get(str(call["id"]))
            if result is None:
                continue
            why = unknown_name_kind(str(call["name"]), result["text"]) if result["is_error"] else None
            if why is None:
                continue
            failures += 1
            name = (call["args"] or {}).get("name")
            saved_before = [save for save in saves if save["name"] == name and turn["t"] is not None and _ms(save["t"]) <= turn["t"]]
            same_message_save = any(other["name"] == "skill" and (other["args"] or {}).get("name") == name
                                    and (other["args"] or {}).get("op") == "set" for other in turn["calls"])
            unknown.append({"turn": turn["turn"], "run": turn["run"], "kind": why, "name": name,
                            "ever_saved": any(save["name"] == name for save in saves),
                            "saved_before_call": bool(saved_before), "same_message_save": same_message_save,
                            "other_calls_in_message": [c["name"] for c in turn["calls"] if c is not call],
                            "text": result["text"][:200]})
        if failures and failures == len(turn["calls"]):
            wasted_turns += 1

    actions = len(trajectory)
    per10 = (lambda n: round(10 * n / actions, 2)) if actions else (lambda n: None)
    agent_saves = [save for save in saves if not save["board_repair"]]
    first_exposed = next((row for row in surface if "run_skill" in (row.get("active") or [])), None)
    return {
        "root": str(root),
        "provider": summary.get("provider"), "model": summary.get("model"),
        "stop_reason": summary.get("stop_reason"), "actions": actions, "levels_completed": summary.get("levels_completed"),
        "final_state": summary.get("final_state"), "reported_tokens": summary.get("reported_tokens"),
        "decisions": summary.get("decisions"), "consolidations": summary.get("consolidations"),
        "elapsed_seconds": summary.get("elapsed_seconds"),
        "agent_turns": len(turns),
        "turns_after_action_in_same_run": sum(1 for turn in turns if turn["after_action"]),
        "unknown_name_calls": len(unknown),
        "unknown_name_by_kind": {kind: sum(1 for row in unknown if row["kind"] == kind)
                                 for kind in ("execute_refusal", "schema_rejection", "not_exposed")},
        "unknown_name_never_saved": sum(1 for row in unknown if not row["ever_saved"]),
        "unknown_name_same_message_save": sum(1 for row in unknown if row["same_message_save"]),
        "turns_wasted_on_unknown_names": wasted_turns,
        "unknown_name_detail": unknown,
        "skill_saves": len(agent_saves), "board_repair_saves": len(saves) - len(agent_saves),
        "skill_deletes": len(deletes),
        "first_save": agent_saves[0] if agent_saves else None,
        "first_run_skill_exposure": first_exposed,
        "skill_calls": len(runs), "skill_calls_ok": sum(1 for row in runs if row.get("ok")),
        "per_10_actions": {"saves": per10(len(agent_saves)), "calls": per10(len(runs)),
                           "ok_calls": per10(sum(1 for row in runs if row.get("ok")))},
        "saves": saves, "deletes": deletes,
        "continuity_mentions": continuity_mentions(harness, {row["name"] for row in unknown if row["name"]},
                                                   {save["name"] for save in saves}),
    }


def continuity_mentions(harness: Path, attempted: set[str], saved: set[str]) -> list[dict[str, Any]]:
    """Memory/prompt text naming a skill-like identifier that was never saved (reported, not judged)."""
    found = []
    for file in ("memory.jsonl", "prompt.jsonl"):
        for row in _rows(harness / file):
            text = json.dumps({key: row.get(key) for key in ("text", "hyp") if key in row}, ensure_ascii=False)
            names = {name for name in attempted if name in text}
            names |= {match for match in re.findall(r"(?:run_skill|skill)[^a-z0-9_]{1,12}([a-z][a-z0-9_]{2,39})", text)
                      if match not in {"op", "set", "name", "get", "delete", "args"}}
            unsaved = sorted(name for name in names if name not in saved)
            if unsaved:
                found.append({"file": file, "t": row.get("t"), "key": row.get("key"), "unsaved_names": unsaved,
                              "text": text[:300]})
    return found


if __name__ == "__main__":
    run_root, out = Path(sys.argv[1]), Path(sys.argv[2])
    out.write_text(json.dumps(metrics(run_root), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
