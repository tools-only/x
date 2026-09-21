"""Read-only evidence index; never infer capability success from activity counters."""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import json
from pathlib import Path


def audit_run(root: Path) -> dict:
    warnings = []

    def read(name):
        path = root / name
        rows = []
        if path.exists():
            with path.open(encoding="utf-8") as source:
                for number, line in enumerate(source, 1):
                    if not line.strip():
                        continue
                    try:
                        row = json.loads(line)
                        if not isinstance(row, dict):
                            raise ValueError("not an object")
                    except ValueError:
                        warnings.append({"artifact": name, "line": number})
                        continue
                    rows.append({**row, "_source": {"artifact": name, "line": number}})
        return rows

    observations = read("execution-observations.jsonl")
    actions = [row for row in observations if row.get("tool_name") == "arc_action" and not row.get("is_error")]
    outcome = actions[-1].get("arc_outcome", {}) if actions else {}
    resources = {}
    for kind, name, key in [("memory", "task-memory.jsonl", "key"),
                            ("skills", "task-skills.jsonl", "name"),
                            ("tools", "task-tools.jsonl", "name"),
                            ("system_prompt", "task-system-prompts.jsonl", "name"),
                            ("subagents", "task-subagents.jsonl", "name")]:
        rows = read(name)
        latest = {}
        for row in rows:
            if row.get("version", 0) >= latest.get(row.get(key), {}).get("version", 0):
                latest[row.get(key)] = row
        resources[kind] = {"records": len(rows), "unique_names": len(latest),
            "latest": [{field: row[field] for field in (key, "version", "status", "description", "summary",
                        "routing_id", "source_approval_ref", "basis_refs", "expected_effect", "_source") if field in row}
                       for row in latest.values()]}
    invocations = [row for row in read("task-tool-events.jsonl") if row.get("event") == "invoked"]
    research = read("auto-research-runs.jsonl")
    reports = read("auto-research-reports.jsonl")
    telemetry = read("provider-telemetry.jsonl")
    return {
        "format": "arc-capability-evidence-index-v1", "run_root": str(root.resolve()),
        "audited_at": datetime.now(timezone.utc).isoformat(),
        "acceptance": "requires_semantic_review", "verified_transfer_count": None,
        "arc": {"actions_used": outcome.get("action_budget", {}).get("total_used", 0),
                "levels_completed": outcome.get("levels_completed", 0),
                "state": outcome.get("state"), "summary_exists": (root / "summary.json").exists()},
        "resources": resources,
        "research_runs": research,
        "reports": [{"run_id": row.get("run_id"), "status": row.get("status"),
                     "report": row.get("report"), "_source": row["_source"]} for row in reports],
        "tool_invocations": invocations,
        "skill_events": read("task-skill-events.jsonl"),
        "parent_research_calls": [{"observation_id": row.get("observation_id"),
                                   "input": row.get("input"), "is_error": row.get("is_error"),
                                   "_source": row["_source"]} for row in observations
                                  if row.get("tool_name") == "auto_research"],
        "operation_failures": read("task-operation-failures.jsonl"),
        "provider_event_counts": dict(Counter(row.get("event") for row in telemetry)),
        "parse_warnings": warnings,
        "review_required": [
            "Is the research question an unresolved capability problem with an attainable test?",
            "Does the method generalize over inputs instead of hard-coding a local answer?",
            "Trace report -> approval -> route -> exact native version -> actual parent use.",
            "Skill read/exposure does not prove application; inspect later decisions and actions.",
            "Tool output_not_input does not prove correctness; compare semantic expected/actual output.",
            "Validate two distinct later instances and construction/evaluation separation.",
            "Trace new canonical evidence into a resumed or linked successor investigation.",
            "Check independent confirmation and report costs separately from native game progress.",
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run", type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    report = audit_run(args.run)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    # Compact stdout; complete findings remain in the explicit output artifact.
    print(json.dumps({"arc": report["arc"], "resources": {key: value["unique_names"]
        for key, value in report["resources"].items()}, "research_runs": len(report["research_runs"]),
        "reports": len(report["reports"]), "tool_invocations": len(report["tool_invocations"]),
        "operation_failures": len(report["operation_failures"]),
        "acceptance": report["acceptance"], "parse_warnings": report["parse_warnings"]}, ensure_ascii=True))


if __name__ == "__main__":
    main()
