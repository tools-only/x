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
    changes = [row for row in lifecycle if row.get("event") == "reflective_change" and row.get("op") == "redefine"]
    used = [row for row in calls if row.get("kind") == "program_result" and row.get("ok") is True
            and any(row.get("name") == change.get("name") and row.get("version") == change.get("version") for change in changes)]
    passed = bool(changes and used)
    result = {"pass": passed, "reflective_redefinitions": len(changes), "redefined_component_calls": len(used),
              "deck_edits_count": 0, "reason": "redefined component executed" if passed else "requires reflective redefine followed by successful call of that version"}
    print(json.dumps(result, indent=2))
    return result


if __name__ == "__main__":
    raise SystemExit(0 if check(Path(sys.argv[1]))["pass"] else 1)
