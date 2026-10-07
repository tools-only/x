"""Read-only prompt inventory and existing context telemetry summary.

Word/character counts are diagnostics, not tokenizer measurements. This command
never truncates instructions or starts an agent/provider run.
"""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-root", type=Path, help="Existing run directory to inspect")
    args = parser.parse_args()
    prompts = []
    for path in sorted((ROOT / "demo/prompts").rglob("*.md")):
        if path.name == "README.md":
            continue
        content = path.read_text(encoding="utf-8")
        words = len(content.split())
        prompts.append({
            "path": path.relative_to(ROOT).as_posix(),
            "words": words,
            "chars": len(content),
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "review_flag": "above_documented_300_word_target"
            if path.name == "arc_decision_cycle.md" and words > 300
            else "long_file_check_loading_path" if words > 500 else None,
        })
    telemetry = []
    if args.run_root is not None:
        run_root = args.run_root.resolve(strict=True)
        if not run_root.is_dir():
            parser.error("--run-root must be a directory")
        for path in sorted(run_root.rglob("*context-token-debug.jsonl")):
            rows = []
            for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
                if not line.strip():
                    continue
                try:
                    row = json.loads(line)
                except json.JSONDecodeError as error:
                    raise ValueError(f"{path}:{line_number}: invalid JSON") from error
                if row.get("event") == "provider_request_context":
                    rows.append(row)
            if not rows:
                continue
            modules = Counter()
            for row in rows:
                for name, values in row.get("modules", {}).items():
                    modules[name] += values.get("json_chars", 0)
            telemetry.append({
                "path": path.relative_to(run_root).as_posix(),
                "requests": len(rows),
                "measurement_bases": dict(Counter(row.get("measurement_basis", "unknown") for row in rows)),
                "first_request_json_chars": rows[0].get("context_json_chars"),
                "first_request_modules": rows[0].get("modules", {}),
                "max_request_json_chars": max(row.get("context_json_chars", 0) for row in rows),
                "cumulative_module_json_chars": dict(modules.most_common()),
            })
    print(json.dumps({
        "format": "prompt-context-audit-v1",
        "notes": [
            "Static file sizes do not establish runtime loading or frequency.",
            "500 words is an audit flag, not a truncation limit or an agent rule.",
            "Telemetry is historical and may precede current source changes.",
            "Cumulative character counts include repeated context; they are not billed tokens.",
            "Context-hook fallback measurements are not exact provider payload measurements.",
        ],
        "run_root": str(args.run_root.resolve()) if args.run_root is not None else None,
        "prompts": sorted(prompts, key=lambda row: row["words"], reverse=True),
        "telemetry": telemetry,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
