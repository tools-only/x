"""Report core reflective evidence and, separately, PPT delivery status."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

if __package__:
    from tools.reflective_core_evidence_joins import check as check_joins
else:
    from reflective_core_evidence_joins import check as check_joins


def ppt_outcome(root: Path) -> dict | None:
    summary_path = root / "summary.json"
    if not summary_path.exists():
        return None
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    return {"delivered": summary.get("complete") is True and summary.get("stop") == "delivered",
            "revision": summary.get("revision"), "quality": "not_evaluated"}


def check(root: Path, mode: str = "historical") -> dict:
    result = check_joins(root, mode)
    outcome = ppt_outcome(root)
    if outcome is not None:
        result["ppt_outcome"] = outcome
    print(json.dumps(result, indent=2))
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=Path)
    parser.add_argument("--mode", choices=("historical", "new-creation", "process"), default="historical")
    args = parser.parse_args()
    raise SystemExit(0 if check(args.root, args.mode)["pass"] else 1)
