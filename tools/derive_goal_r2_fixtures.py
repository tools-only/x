"""Derive R2 consult replay rows from immutable P0 session and call-point logs."""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
RUNS = Path("D:/autoresearch_pi_project/runs/arc-goal-admission-p0-su15-20261021")
FIXTURES = REPO / "demo/fixtures/goal-r1"
OUT = REPO / "demo/fixtures/goal-r2/consult"


def rows(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def stamp(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def main() -> None:
    for arm in ("ga-p0-on-1", "ga-p0-shadow-1"):
        source = RUNS / arm / "arc-run"
        points = [row for row in rows(source / "harness/call_points.jsonl") if row.get("kind") == "consult_point"]
        point_times = [(stamp(str(row["t"])), row) for row in points]
        trajectory = rows(source / "harness/trajectory.jsonl")
        results = {id(row): [] for row in points}
        pending: dict[str, datetime] = {}
        for event in rows(source / "session.jsonl"):
            message = event.get("message") or {}
            event_time = stamp(str(event["timestamp"]))
            if message.get("role") == "assistant":
                for block in message.get("content") or []:
                    if isinstance(block, dict) and block.get("type") == "toolCall" and block.get("name") == "consult":
                        pending[str(block.get("id"))] = event_time
                continue
            if message.get("role") != "toolResult":
                continue
            owner = None
            for point in points:
                point_time = stamp(str(point["t"]))
                next_points = [stamp(str(item["t"])) for item in points if stamp(str(item["t"])) > point_time]
                next_actions = [stamp(str(row["t"])) for row in trajectory if int(row.get("n", 0)) > int(point.get("at", 0))]
                ends = next_points + next_actions
                end_time = min(ends) if ends else None
                if event_time >= point_time and (end_time is None or event_time < end_time):
                    owner = point
                    break
            if owner is None:
                continue
            if message.get("toolName") == "consult":
                call_id = str(message.get("toolCallId"))
                if call_id not in pending:
                    continue
                pending.pop(call_id)
            text = "".join(str(block.get("text", "")) for block in message.get("content") or [] if isinstance(block, dict))
            results[id(owner)].append({"t": event_time, "tool": str(message.get("toolName") or "unknown"),
                                       "isError": bool(message.get("isError")), "text": text[:120]})
        for point in points:
            results[id(point)].sort(key=lambda item: item["t"])
        output = [{"at": point.get("at"), "decision": point.get("decision"),
                   "results": [{key: value for key, value in item.items() if key != "t"} for item in results[id(point)]]}
                  for point in points]
        target = OUT / (("on" if arm == "ga-p0-on-1" else "shadow") + ".jsonl")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in output), encoding="utf-8")
        total = sum(len(row["results"]) for row in output)
        print(f"{target.relative_to(REPO)}: {len(output)} consult points, {total} results")


if __name__ == "__main__":
    main()
