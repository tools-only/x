"""Build a read-only evidence index without inferring semantic capability success."""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Any


def audit_run(root: Path) -> dict[str, Any]:
    warnings: list[dict[str, Any]] = []

    def read(name: str) -> list[dict[str, Any]]:
        path = root / name
        rows: list[dict[str, Any]] = []
        if path.exists():
            with path.open(encoding="utf-8") as source:
                for number, line in enumerate(source, 1):
                    if not line.strip():
                        continue
                    try:
                        row = json.loads(line)
                        if not isinstance(row, dict):
                            raise ValueError("not an object")
                    except (json.JSONDecodeError, ValueError):
                        warnings.append({"artifact": name, "line": number})
                        continue
                    rows.append({**row, "_source": {"artifact": name, "line": number}})
        return rows

    def read_object(path: Path) -> dict[str, Any] | None:
        try:
            row = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(row, dict):
                raise ValueError("not an object")
        except (OSError, json.JSONDecodeError, ValueError):
            warnings.append({"artifact": path.relative_to(root).as_posix(), "line": 1})
            return None
        return {**row, "_source": {"artifact": path.relative_to(root).as_posix(), "line": 1}}

    def latest_by(rows: list[dict[str, Any]], key: str, version: str = "version") -> dict[str, dict[str, Any]]:
        latest: dict[str, dict[str, Any]] = {}
        for row in rows:
            identity = row.get(key)
            if identity is None:
                source = row["_source"]
                identity = f"<missing:{source['artifact']}:{source['line']}>"
            identity = str(identity)
            row_version = int(row.get(version, 0) or 0)
            prior_version = int(latest.get(identity, {}).get(version, -1) or -1)
            if row_version >= prior_version:
                latest[identity] = row
        return latest

    def version_summary(rows: list[dict[str, Any]], key: str, version: str = "version") -> dict[str, Any]:
        current = latest_by(rows, key, version)
        return {
            "raw_record_count": len(rows),
            "unique_identity_count": len(current),
            "current_version_count": len(current),
            "current_status_counts": dict(Counter(str(row.get("status", "unspecified")) for row in current.values())),
            "current": list(current.values()),
        }

    def phase(name: str, records: list[dict[str, Any]], identities: set[str], basis: str) -> dict[str, Any]:
        return {"name": name, "unique_count": len(identities), "identities": sorted(identities),
                "evidence_records": records, "basis": basis}

    observations = read("execution-observations.jsonl")
    actions = [row for row in observations if row.get("tool_name") == "arc_action" and not row.get("is_error")]
    outcome = actions[-1].get("arc_outcome", {}) if actions else {}
    outcome_cost_indexes = read("task-outcome-cost-index.jsonl")
    level_reviews = read("task-level-reviews.jsonl")

    resource_specs = [
        ("memory", "task-memory.jsonl", "key"),
        ("skills", "task-skills.jsonl", "name"),
        ("tools", "task-tools.jsonl", "name"),
        # Pool records are singular; task-system-prompt-assemblies.jsonl is a
        # projection log and is summarized with the other assembly evidence.
        ("system_prompt", "task-system-prompt.jsonl", "name"),
        ("subagents", "task-subagents.jsonl", "name"),
    ]
    resources: dict[str, Any] = {}
    for kind, filename, key in resource_specs:
        rows = read(filename)
        summary = version_summary(rows, key)
        # Keep the v1 aliases for downstream readers while making their basis explicit.
        summary["records"] = summary["raw_record_count"]
        summary["unique_names"] = summary["unique_identity_count"]
        summary["latest"] = summary["current"]
        resources[kind] = summary

    session_rows = read("auto-research-sessions.jsonl")
    run_rows = read("auto-research-runs.jsonl")
    report_rows = read("auto-research-reports.jsonl")
    handoff_rows = read("auto-research-handoffs.jsonl")
    adoption_rows = read("auto-research-adoption-events.jsonl")
    current_sessions = latest_by(session_rows, "session_id")
    current_runs = latest_by(run_rows, "run_id")

    broker_records: list[dict[str, Any]] = []
    broker_root = root / "task-context-cache" / "auto-research-broker"
    if broker_root.exists():
        for path in sorted(broker_root.glob("*.json")):
            record = read_object(path)
            if record is not None:
                if not record.get("run_id"):
                    record["run_id"] = path.stem
                broker_records.append(record)

    started_records = list(current_sessions.values()) + list(current_runs.values()) + broker_records
    started_ids = {str(row.get("run_id")) for row in started_records if row.get("run_id")}
    completed_records = [row for row in [*current_sessions.values(), *current_runs.values()]
                         if str(row.get("status", "")).lower() == "completed"]
    completed_ids = {str(row.get("run_id")) for row in completed_records if row.get("run_id")}
    delivered_records = [row for row in current_sessions.values()
                         if row.get("completion_delivery_status") == "delivered"]
    delivered_ids = {str(row.get("run_id")) for row in delivered_records if row.get("run_id")}
    adopted_session_records = [row for row in current_sessions.values()
                               if row.get("reconciliation_status") in {"adopted", "partial_adoption"}]
    adopted_event_records = [row for row in adoption_rows
                             if row.get("status") in {"adopted", "partial"} or row.get("applied") is True]
    adopted_records = adopted_session_records + adopted_event_records
    adopted_ids = {
        str(row.get("run_id") or str(row.get("research_run_ref", "")).split(":")[-1].split("@")[0])
        for row in adopted_records if row.get("run_id") or row.get("research_run_ref")
    }

    assessments = read("effect-assessments.jsonl")
    harness_observations = read("harness-observations.jsonl")
    assessment_uses = [row for row in assessments if row.get("actual_use_refs")]
    native_uses = [row for row in harness_observations if row.get("actual_use") is True]
    used_resource_refs = {str(ref) for row in assessment_uses for ref in row.get("resource_refs", []) if ref}
    for row in native_uses:
        used_resource_refs.update(str(ref) for ref in row.get("resource_refs", []) if ref)
    method_lifecycle = read("task-method-lifecycle.jsonl")
    research_linked_resource_refs = {
        str(row.get("source_component_ref")) for row in method_lifecycle
        if row.get("source_component_ref") and (row.get("source_report_ref") or row.get("source_run_ref"))
    }
    for row in adoption_rows:
        research_linked_resource_refs.update(
            str(ref) for ref in (row.get("activation") or {}).get("created_resource_refs", []) if ref
        )
        for route in row.get("routes", []) or []:
            research_linked_resource_refs.update(
                str(step.get("resource_ref")) for step in route.get("steps", []) or [] if step.get("resource_ref")
            )
    research_use_records = []
    for row in assessment_uses + native_uses:
        linked = sorted({str(ref) for ref in row.get("resource_refs", []) if str(ref) in research_linked_resource_refs})
        if linked:
            research_use_records.append({**row, "_research_linked_resource_refs": linked})
    research_used_refs = {ref for row in research_use_records for ref in row["_research_linked_resource_refs"]}

    assembly_rows = read("task-harness-assemblies.jsonl")
    assembly_receipts = read("task-harness-assembly-receipts.jsonl")
    system_prompt_assemblies = read("task-system-prompt-assemblies.jsonl")
    prompt_assemblies = read("task-prompt-assemblies.jsonl")
    assemblies = version_summary(assembly_rows, "assembly_id", "revision")
    assemblies.update({
        "applied_receipt_count": sum(row.get("applied") is True for row in assembly_receipts),
        "receipts": assembly_receipts,
        "system_prompt_projection_record_count": len(system_prompt_assemblies),
        "system_prompt_projections": system_prompt_assemblies,
        "task_prompt_projection_record_count": len(prompt_assemblies),
        "task_prompt_projections": prompt_assemblies,
        "unique_selected_resource_refs": sorted({str(ref) for row in assembly_rows
                                                 for ref in row.get("selected_resource_refs", []) if ref}),
    })
    creator_reads = read("task-baseline-method-reads.jsonl")

    def token_stream(filename: str, actor: str) -> dict[str, Any]:
        rows = read(filename)
        response_rows = [row for row in rows if row.get("event") == "provider_response_usage"]
        if response_rows:
            usage_rows = [{"request_id": row.get("request_id"),
                           "input_tokens": int(row.get("actual_input_tokens", 0) or 0),
                           "output_tokens": int(row.get("actual_output_tokens", 0) or 0),
                           "cache_read_tokens": int(row.get("cache_read_tokens", 0) or 0),
                           "cache_write_tokens": int(row.get("cache_write_tokens", 0) or 0),
                           "total_tokens": int(row.get("total_tokens", 0) or 0), "_source": row["_source"]}
                          for row in response_rows]
            usage_basis = "provider_response_usage actual_* fields"
        else:
            message_rows = [row for row in rows
                            if row.get("event") == "assistant_message" and isinstance(row.get("usage"), dict)]
            usage_rows = [{"request_id": row.get("request_id"),
                           "input_tokens": int(row["usage"].get("input", 0) or 0),
                           "output_tokens": int(row["usage"].get("output", 0) or 0),
                           "cache_read_tokens": int(row["usage"].get("cache_read", 0) or 0),
                           "cache_write_tokens": int(row["usage"].get("cache_write", 0) or 0),
                           "total_tokens": int(row["usage"].get("total_tokens", 0) or 0), "_source": row["_source"]}
                          for row in message_rows]
            usage_basis = "assistant_message usage fields"
        context_rows = [row for row in rows
                        if row.get("event") == "harness_assembly" and isinstance(row.get("context_stats"), dict)]
        return {
            "actor": actor, "artifact": filename, "usage_record_count": len(usage_rows),
            "request_count": len({row.get("request_id") for row in usage_rows if row.get("request_id")}),
            "totals": {field: sum(row[field] for row in usage_rows) for field in
                       ("input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "total_tokens")},
            "context_request_count": len(context_rows),
            "estimated_context_input_tokens": sum(
                int(row["context_stats"].get("estimated_input_tokens", 0) or 0) for row in context_rows),
            "measurement_basis_counts": dict(Counter(str(row.get("measurement_basis", "unspecified"))
                                                     for row in context_rows)),
            "scope_counts": dict(Counter(str(row.get("scope", "unspecified")) for row in rows)),
            "usage_basis": usage_basis,
        }

    parent_tokens = token_stream("provider-telemetry.jsonl", "parent")
    child_tokens = token_stream("subagent-provider-telemetry.jsonl", "child_unattributed")
    token_fields = ("input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "total_tokens")
    token_costs = {
        "streams": [parent_tokens, child_tokens],
        "combined_totals": {field: parent_tokens["totals"][field] + child_tokens["totals"][field]
                            for field in token_fields},
        "caution": "Token totals are workload/cost evidence, not capability quality or component balance. Child telemetry is unattributed unless the artifact itself provides a research/delegation join.",
    }

    invocations = [row for row in read("task-tool-events.jsonl") if row.get("event") == "invoked"]
    telemetry = read("provider-telemetry.jsonl")
    failures = read("task-operation-failures.jsonl")
    # Engine lookup errors and negative facade receipts need not enter the
    # native operation-failure journal. Join actual returns, not attempted calls.
    pending_calls: dict[str, dict[str, Any]] = {}
    tool_outcomes: list[dict[str, Any]] = []
    for event in read("pi-events.jsonl"):
        call_id = event.get("toolCallId")
        if event.get("type") == "tool_execution_start" and call_id:
            pending_calls[str(call_id)] = event
        elif event.get("type") == "tool_execution_end":
            start = pending_calls.pop(str(call_id), {})
            result = event.get("result") or {}
            texts = [part.get("text", "") for part in result.get("content", [])
                     if part.get("type") == "text"]
            rejected = False
            for text in texts:
                try:
                    body = json.loads(text)
                except (json.JSONDecodeError, TypeError):
                    continue
                rejected |= isinstance(body, dict) and body.get("format") == "task-local-harness-rejection-v1"
            tool_outcome = ("engine_error" if event.get("isError") or result.get("isError") else
                       "structured_rejection" if rejected else "unflagged_return")
            arguments = start.get("args") or {}
            tool_outcomes.append({"toolCallId": call_id,
                "tool_name": start.get("toolName") or event.get("toolName"),
                "action": arguments.get("action"), "ref": arguments.get("ref"),
                "resource_refs": arguments.get("resource_refs"), "outcome": tool_outcome,
                "result_excerpt": "\n".join(texts)[:320], "_source": event["_source"]})
    research = {
        "sessions": version_summary(session_rows, "session_id"),
        "runs": version_summary(run_rows, "run_id"),
        "reports": version_summary(report_rows, "run_id"),
        "handoffs": version_summary(handoff_rows, "handoff_id"),
        "broker_attempts": {"raw_record_count": len(broker_records),
                            "status_counts": dict(Counter(str(row.get("status", "unspecified"))
                                                          for row in broker_records)),
                            "records": broker_records},
        "phases": {
            "started": phase("started", started_records, started_ids,
                             "Current session/run records or a durable broker state exists for the run id."),
            "completed": phase("completed", completed_records, completed_ids,
                               "Current session or run status is explicitly completed."),
            "delivered": phase("delivered", delivered_records, delivered_ids,
                               "Current session has completion_delivery_status=delivered; report persistence alone is not delivery."),
            "adopted": phase("adopted", adopted_records, adopted_ids,
                             "Explicit adoption event or current session reconciliation_status adopted/partial_adoption."),
            "used": phase("used", research_use_records, research_used_refs,
                          "Exact component refs have actual-use evidence and an explicit research report/run/adoption provenance join. Direct or unattributed component use is excluded."),
        },
    }

    def add_counts(target: Counter[str], values: Any) -> None:
        if not isinstance(values, dict):
            return
        for name, count in values.items():
            try:
                target[str(name)] += max(0, int(count))
            except (TypeError, ValueError):
                continue

    current_cost_indexes = latest_by(outcome_cost_indexes, "window_id")
    reviews_by_window = latest_by(level_reviews, "window_id")
    review_order = {str(row.get("window_id")): index for index, row in enumerate(level_reviews)}
    cost_rows = sorted(current_cost_indexes.values(), key=lambda row: review_order.get(str(row.get("window_id")), 10**12))
    prior_call_refs_by_level: dict[str, set[str]] = {}
    incremental_tool_totals: Counter[str] = Counter()
    incremental_result_totals: Counter[str] = Counter()
    incremental_arc_actions = 0
    incremental_count_unknown_windows = 0
    incremental_call_detail_unknown_windows = 0
    window_audits: list[dict[str, Any]] = []
    whole_level_latest: dict[str, dict[str, Any]] = {}
    omission_records: list[dict[str, Any]] = []
    for index in cost_rows:
        window_id = str(index.get("window_id", ""))
        review = reviews_by_window.get(window_id, {})
        level_key = str(review.get("level", "unknown"))
        calls = index.get("calls") if isinstance(index.get("calls"), list) else []
        call_refs = {str(call.get("call_ref")) for call in calls if isinstance(call, dict) and call.get("call_ref")}
        has_prior_index = level_key in prior_call_refs_by_level
        previous_refs = prior_call_refs_by_level.get(level_key, set())
        incremental_calls = [call for call in calls if isinstance(call, dict)
                             and str(call.get("call_ref", "")) not in previous_refs]
        prior_call_refs_by_level[level_key] = call_refs
        whole_results = Counter(str(call.get("result", "unknown")) for call in calls if isinstance(call, dict))
        since_boundary = index.get("since_previous_boundary")
        incremental_counts = since_boundary.get("tool_counts") if isinstance(since_boundary, dict) else None
        whole_section = index.get("whole_level") if isinstance(index.get("whole_level"), dict) else {}
        whole_counts = whole_section.get("tool_counts", {})
        incremental_counts_known = isinstance(incremental_counts, dict) and all(
            isinstance(value, (int, float)) and value >= 0 for value in incremental_counts.values())
        arc_actions_value = since_boundary.get("arc_actions") if isinstance(since_boundary, dict) else None
        incremental_arc_actions_known = isinstance(arc_actions_value, (int, float)) and arc_actions_value >= 0
        call_delta_known = incremental_counts_known and (has_prior_index or incremental_counts == whole_counts)
        incremental_results = Counter(str(call.get("result", "unknown")) for call in incremental_calls) if call_delta_known else Counter()
        if not incremental_counts_known:
            incremental_count_unknown_windows += 1
        if not call_delta_known:
            incremental_call_detail_unknown_windows += 1
        incremental_tool_counts: Counter[str] = Counter()
        if incremental_counts_known:
            add_counts(incremental_tool_counts, incremental_counts)
            add_counts(incremental_tool_totals, incremental_tool_counts)
        add_counts(incremental_result_totals, incremental_results)
        if incremental_counts_known and incremental_arc_actions_known:
            try:
                incremental_arc_actions += max(0, int(arc_actions_value))
            except (TypeError, ValueError):
                incremental_arc_actions_known = False
        elif incremental_counts_known and not incremental_arc_actions_known:
            incremental_count_unknown_windows += 1

        path = review.get("success_path") if isinstance(review.get("success_path"), dict) else {}
        proposals = path.get("proposed_omissions", []) if isinstance(path, dict) else []
        if not isinstance(proposals, list):
            proposals = []
        for proposal in proposals:
            if isinstance(proposal, dict):
                omission_records.append({"window_id": window_id, "level": review.get("level"),
                    "call_refs": proposal.get("call_refs", []), "rationale": proposal.get("rationale"),
                    "risk": proposal.get("risk"), "confidence": proposal.get("confidence"),
                    "_source": review.get("_source")})
        whole = index.get("whole_level") if isinstance(index.get("whole_level"), dict) else {}
        window_audits.append({
            "window_id": window_id, "level": review.get("level"),
            "reasons": review.get("reasons", []), "coverage": index.get("coverage", "unknown"),
            "gaps": index.get("gaps", []),
            "whole_level": {"tool_counts": whole.get("tool_counts", {}),
                "arc_actions": whole.get("arc_actions", 0), "call_count": len(calls),
                "result_counts": dict(whole_results),
                "failure_or_error_count": whole_results.get("error", 0) + whole_results.get("rejected", 0),
                "incomplete_count": whole_results.get("incomplete", 0)},
            "since_previous_boundary": {"tool_counts": dict(incremental_tool_counts) if incremental_counts_known else None,
                "arc_actions": arc_actions_value if incremental_arc_actions_known else None,
                "count_attribution": "exact_from_index" if incremental_counts_known and incremental_arc_actions_known else "unknown_boundary_attribution",
                "call_count": len(incremental_calls) if call_delta_known else None,
                "result_counts": dict(incremental_results) if call_delta_known else None,
                "failure_or_error_count": incremental_results.get("error", 0) + incremental_results.get("rejected", 0)
                    if call_delta_known else None,
                "incomplete_count": incremental_results.get("incomplete", 0) if call_delta_known else None,
                "call_detail_attribution": "unknown_boundary_attribution"
                    if not incremental_counts_known or not incremental_arc_actions_known else
                    "exact_by_call_ref_delta" if has_prior_index else
                    "exact_whole_window" if call_delta_known else "unknown_prior_window_index_missing"},
            "provider_cost": index.get("provider_cost", {"attribution": "unknown"}),
            "proposed_omission_count": len(proposals),
            "proposed_omissions": proposals,
            "verified_savings": {"count": 0, "status": "not_measured",
                "basis": "No post-trial omission verification record is present in the current artifact contract."},
            "index_source": index.get("_source"), "review_source": review.get("_source"),
        })
        whole_level_latest[level_key] = {"level": review.get("level"), "window_id": window_id,
            "coverage": index.get("coverage", "unknown"), "tool_counts": whole.get("tool_counts", {}),
            "arc_actions": whole.get("arc_actions", 0), "result_counts": dict(whole_results)}

    outcome_cost_audit = {
        "format": "arc-outcome-cost-audit-v1",
        "window_count": len(window_audits),
        "coverage_counts": dict(Counter(str(row["coverage"]) for row in window_audits)),
        "windows": window_audits,
        "latest_whole_level_by_level": list(whole_level_latest.values()),
        "incremental_totals": {"tool_counts": dict(incremental_tool_totals) if incremental_count_unknown_windows == 0 else None,
            "known_tool_counts": dict(incremental_tool_totals),
            "arc_actions": incremental_arc_actions if incremental_count_unknown_windows == 0 else None,
            "known_arc_actions": incremental_arc_actions,
            "result_counts": dict(incremental_result_totals) if incremental_call_detail_unknown_windows == 0 else None,
            "known_result_counts": dict(incremental_result_totals),
            "failure_or_error_count": incremental_result_totals.get("error", 0) + incremental_result_totals.get("rejected", 0)
                if incremental_call_detail_unknown_windows == 0 else None,
            "incomplete_count": incremental_result_totals.get("incomplete", 0)
                if incremental_call_detail_unknown_windows == 0 else None,
            "count_unknown_window_count": incremental_count_unknown_windows,
            "call_detail_unknown_window_count": incremental_call_detail_unknown_windows},
        "proposed_omissions": {"count": len(omission_records), "records": omission_records,
            "basis": "Agent-authored hypotheses; not measured savings."},
        "verified_savings": {"count": 0, "records": [], "status": "not_measured",
            "basis": "A lower call count or an omission proposal alone is not a verified saving; no comparable post-trial verification field is currently persisted."},
    }

    return {
        "format": "arc-capability-evidence-index-v2", "run_root": str(root.resolve()),
        "audited_at": datetime.now(timezone.utc).isoformat(),
        "acceptance": "requires_semantic_review", "verified_transfer_count": None,
        "statistics_basis": [
            "raw_record_count counts parseable JSONL lines; it is not a count of unique objects or successful operations.",
            "unique_identity_count/current_version_count selects the greatest version (or revision) for each durable identity.",
            "started, completed, delivered, adopted, and used are independent evidence stages and must not be collapsed.",
            "Creator reads, context projections, invocations, actual use, and supported utility are distinct events.",
            "No component count, output count, or token count is interpreted as semantic balance or quality.",
            "Omission proposals are agent hypotheses. Verified savings require later comparable execution evidence and are not inferred from proposal text or aggregate call counts.",
        ],
        "arc": {"actions_used": outcome.get("action_budget", {}).get("total_used", 0),
                "levels_completed": outcome.get("levels_completed", 0), "state": outcome.get("state"),
                "summary_exists": (root / "summary.json").exists()},
        "resources": resources, "component_assemblies": assemblies,
        "creator_reads": {
            "raw_record_count": len(creator_reads),
            "unique_method_refs": sorted({str(row.get("method_ref")) for row in creator_reads if row.get("method_ref")}),
            "records": creator_reads,
            "caution": "A creator read proves provenance availability, not component creation, selection, use, or utility.",
        },
        "research": research,
        # Compatibility views retained for existing consumers.
        "research_runs": run_rows,
        "reports": [{"run_id": row.get("run_id"), "status": row.get("status"),
                     "report": row.get("report"), "_source": row["_source"]} for row in report_rows],
        "tool_invocations": invocations, "skill_events": read("task-skill-events.jsonl"),
        "actual_uses": {
            "unique_resource_refs": sorted(used_resource_refs), "effect_assessments": assessment_uses,
            "native_observations": native_uses,
            "research_linked_resource_refs": sorted(research_used_refs),
            "direct_or_unattributed_resource_refs": sorted(used_resource_refs - research_used_refs),
            "caution": "Actual use is not a supported semantic-effect verdict; inspect the assessment verdict and output evidence.",
        },
        "token_costs": token_costs,
        "outcome_cost_audit": outcome_cost_audit,
        "parent_research_calls": [{"observation_id": row.get("observation_id"), "input": row.get("input"),
                                   "is_error": row.get("is_error"), "_source": row["_source"]}
                                  for row in observations if row.get("tool_name") == "auto_research"],
        "operation_failures": failures,
        "parent_tool_outcomes": {
            "counts": dict(Counter(row["outcome"] for row in tool_outcomes)),
            "records": tool_outcomes,
            "caution": "Joined parent call/return events. Unflagged return is not semantic success or component use. Native operation_failures may overlap these records; do not sum the counts.",
        },
        "provider_event_counts": dict(Counter(row.get("event") for row in telemetry)),
        "parse_warnings": warnings,
        "review_required": [
            "Is the research question an unresolved capability problem with an attainable test?",
            "Does the authored operation fit its declared scope, including a legitimate single-situation scope?",
            "Trace report -> parent creator read/authoring -> exact native version -> assembly -> actual parent use.",
            "Skill read/exposure does not prove application; inspect later decisions and actions.",
            "Tool invocation/output does not prove correctness; compare semantic expected/actual output.",
            "Check whether the declared next use and falsifier were exercised; do not require a component quota.",
            "Trace new canonical evidence into a resumed or linked successor investigation.",
            "Report parent and research-child token costs separately from native game progress.",
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run", type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    report = audit_run(args.run)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "arc": report["arc"],
        "resources": {key: value["unique_identity_count"] for key, value in report["resources"].items()},
        "research_phases": {key: value["unique_count"] for key, value in report["research"]["phases"].items()},
        "operation_failures": len(report["operation_failures"]),
        "parent_tool_outcomes": report["parent_tool_outcomes"]["counts"],
        "outcome_cost_windows": report["outcome_cost_audit"]["window_count"],
        "omission_proposals": report["outcome_cost_audit"]["proposed_omissions"]["count"],
        "verified_savings": report["outcome_cost_audit"]["verified_savings"]["status"],
        "token_totals": report["token_costs"]["combined_totals"],
        "acceptance": report["acceptance"], "parse_warnings": report["parse_warnings"],
    }, ensure_ascii=True))


if __name__ == "__main__":
    main()
