"""Evidence gates for Self tools; this does not infer behavioral causality."""
from collections import Counter
from typing import Any


def self_acceptance(components: list[dict[str, Any]], runs: list[dict[str, Any]]) -> dict[str, Any]:
    created = {(row["path"], row["version"]) for row in components
               if row.get("kind") == "tool" and row.get("by") == "agent"
               and not row.get("error") and not row.get("retired")}
    calls = Counter((row.get("path"), row.get("version")) for row in runs
                    if row.get("kind") == "tool" and row.get("ok") is True
                    and not row.get("readonly") and (row.get("path"), row.get("version")) in created)
    return {"L0": bool(calls), "L1": any(count >= 2 for count in calls.values()),
            "L2": "unverified: next-turn behavior requires attributed run review",
            "L3": "unverified: process-rule improvement requires comparison",
            "successful_calls": [{"path": path, "version": version, "via": count}
                                 for (path, version), count in sorted(calls.items())]}
