"""Check evidence that a PPT task agent changed and then used a live component."""
from __future__ import annotations

import json
import sys
from pathlib import Path


def rows(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def check(root: Path) -> dict:
    lifecycle = rows(root / "harness/lifecycle.jsonl")
    calls = rows(root / "harness/component_runs.jsonl")
    consults = rows(root / "harness/consult_runs.jsonl")
    changes = [row for row in lifecycle if row.get("event") == "reflective_change" and row.get("op") == "redefine"]
    consumed = [row for row in lifecycle if row.get("event") == "component_consumed"]
    consumed.extend({**row, "kind": "tool"} for row in calls if row.get("kind") == "program_result" and row.get("ok") is True)
    consumed.extend({**row, "kind": "subagent", "name": row.get("role")} for row in consults if row.get("role"))
    kinds = ("prompt", "skill", "tool", "subagent", "memory")
    per_kind = {}
    for kind in kinds:
        matched = []
        for change in changes:
            if change.get("kind") != kind:
                continue
            use = next((row for row in consumed if row.get("kind") == kind and row.get("name") == change.get("name")
                        and row.get("version") == change.get("version") and row.get("session_id") == change.get("session_id")
                        and row.get("time", "") >= change.get("time", "")), None)
            if use:
                matched.append({"name": change.get("name"), "version": change.get("version"), "boundary": use.get("boundary", use.get("kind"))})
        per_kind[kind] = {"pass": bool(matched), "consumed": matched}
    passed = all(status["pass"] for status in per_kind.values())
    result = {"pass": passed, "per_kind": per_kind, "reflective_redefinitions": len(changes),
              "reason": "all five redefined versions were consumed" if passed else "each kind requires redefine followed by same-session consumption at that version"}
    print(json.dumps(result, indent=2))
    return result


if __name__ == "__main__":
    raise SystemExit(0 if check(Path(sys.argv[1]))["pass"] else 1)
