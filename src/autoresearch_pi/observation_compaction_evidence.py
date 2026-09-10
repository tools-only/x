"""Offline integrity audit for Agent-selected Pi context representation changes."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any


COMPACTION_METRIC = "model_visible_observation_chars_removed"


def _marker(observation_id: str, finding_id: str, version: int) -> str:
    return (
        f"[Task-local observation {observation_id} compacted by {finding_id}@v{version}; "
        "the complete result remains in execution-observations.jsonl and is recoverable by exact ID.]"
    )


def _message_text(message: dict[str, Any]) -> str | None:
    content = message.get("content")
    if not isinstance(content, list) or not content:
        return None
    texts = [
        item.get("text")
        for item in content
        if isinstance(item, dict) and item.get("type") == "text" and isinstance(item.get("text"), str)
    ]
    return "".join(texts) if texts else None


def _provider_observation_texts(
    provider_contexts: Sequence[dict[str, Any]],
) -> dict[str, list[tuple[int, str]]]:
    found: dict[str, list[tuple[int, str]]] = {}
    for fallback_index, record in enumerate(provider_contexts):
        request = record.get("request")
        request_index = request if isinstance(request, int) else fallback_index
        context = record.get("context")
        messages = context.get("messages") if isinstance(context, dict) else None
        if not isinstance(messages, list):
            continue
        for message in messages:
            if not isinstance(message, dict) or message.get("role") != "toolResult":
                continue
            details = message.get("details")
            observation = details.get("observation") if isinstance(details, dict) else None
            observation_id = observation.get("event_id") if isinstance(observation, dict) else None
            text = _message_text(message)
            if isinstance(observation_id, str) and text is not None:
                found.setdefault(observation_id, []).append((request_index, text))
    return found


def _event_observation_texts(
    pi_events: Sequence[dict[str, Any]],
) -> dict[str, list[tuple[int, str]]]:
    found: dict[str, list[tuple[int, str]]] = {}
    for index, event in enumerate(pi_events):
        if event.get("type") != "tool_execution_end":
            continue
        result = event.get("result")
        if not isinstance(result, dict):
            continue
        details = result.get("details")
        observation = details.get("observation") if isinstance(details, dict) else None
        observation_id = observation.get("event_id") if isinstance(observation, dict) else None
        text = _message_text(result)
        if isinstance(observation_id, str) and text is not None:
            found.setdefault(observation_id, []).append((index, text))
    return found


def audit_observation_compaction_effects(
    observations: Sequence[dict[str, Any]],
    findings: Sequence[dict[str, Any]],
    decisions: Sequence[dict[str, Any]],
    exposures: Sequence[dict[str, Any]],
    assessments: Sequence[dict[str, Any]],
    provider_contexts: Sequence[dict[str, Any]],
    *,
    pi_events: Sequence[dict[str, Any]] = (),
) -> tuple[list[dict[str, Any]], list[str]]:
    """Recompute supported context effects from completed, Agent-invisible records."""

    observations_by_id = {
        item.get("event_id"): item
        for item in observations
        if isinstance(item.get("event_id"), str)
    }
    findings_by_version = {
        (item.get("finding_id"), item.get("version")): item
        for item in findings
        if isinstance(item.get("finding_id"), str) and isinstance(item.get("version"), int)
    }
    decisions_by_id = {
        item.get("decision_id"): item
        for item in decisions
        if isinstance(item.get("decision_id"), str)
    }
    provider_texts = _provider_observation_texts(provider_contexts)
    texts_by_observation = _event_observation_texts(pi_events)
    for observation_id, occurrences in provider_texts.items():
        texts_by_observation.setdefault(observation_id, []).extend(occurrences)
    supported: list[dict[str, Any]] = []
    issues: list[str] = []

    for assessment in assessments:
        if assessment.get("effect_metric") != COMPACTION_METRIC or assessment.get("verdict") != "supported":
            continue
        assessment_id = str(assessment.get("effect_assessment_id") or "unknown-assessment")
        local: list[str] = []
        decision = decisions_by_id.get(assessment.get("decision_id"))
        if not decision or decision.get("applied") is not True:
            local.append("missing_applied_decision")
            decision = {}
        if decision.get("effect_metric") != COMPACTION_METRIC:
            local.append("decision_metric_mismatch")
        if assessment.get("toolCallId") != decision.get("toolCallId"):
            local.append("decision_tool_call_mismatch")

        operation = decision.get("operation")
        selected = operation.get("observation_ids") if isinstance(operation, dict) else None
        if not isinstance(operation, dict) or operation.get("capability") != "pi.context":
            local.append("missing_pi_context_operation")
        if not isinstance(selected, list) or not selected or not all(isinstance(item, str) for item in selected):
            local.append("missing_selected_observations")
            selected = []
        elif len(selected) != len(set(selected)):
            local.append("duplicate_selected_observation")

        basis_ids = decision.get("basis_resource_ids")
        snapshots = decision.get("basis_snapshots")
        canonical_findings: list[dict[str, Any]] = []
        basis_by_observation: dict[str, tuple[str, int]] = {}
        if not isinstance(basis_ids, list) or not basis_ids:
            local.append("missing_finding_basis")
        if not isinstance(snapshots, list) or not snapshots:
            local.append("missing_finding_snapshot")
        else:
            for snapshot in snapshots:
                canonical = findings_by_version.get((
                    snapshot.get("finding_id"), snapshot.get("version"),
                )) if isinstance(snapshot, dict) else None
                if canonical is None:
                    local.append("unknown_finding_snapshot")
                else:
                    canonical_findings.append(canonical)
                    finding_id = snapshot.get("finding_id")
                    version = snapshot.get("version")
                    if isinstance(finding_id, str) and isinstance(version, int):
                        for ref in canonical.get("evidence_refs", []):
                            if isinstance(ref, str):
                                basis_by_observation.setdefault(ref, (finding_id, version))
        cited = {
            ref
            for finding in canonical_findings
            for ref in finding.get("evidence_refs", [])
            if isinstance(ref, str)
        }
        if any(observation_id not in cited for observation_id in selected):
            local.append("observation_not_cited_by_finding")
        if any(observation_id not in observations_by_id for observation_id in selected):
            local.append("unknown_selected_observation")
        for observation_id in selected:
            canonical_result = observations_by_id.get(observation_id, {}).get("result")
            if not isinstance(canonical_result, str) or canonical_result.startswith("[Task-local observation "):
                local.append("canonical_observation_not_full")
                break

        exposure = next((item for item in exposures if (
            item.get("decision_id") == decision.get("decision_id")
            and item.get("toolCallId") == decision.get("toolCallId")
            and item.get("effect_observed") is True
            and isinstance(item.get("operation"), dict)
            and item["operation"].get("capability") == "pi.context"
        )), None)
        if exposure is None:
            local.append("missing_pi_context_exposure")
        else:
            if exposure.get("basis_resource_ids") != basis_ids:
                local.append("exposure_basis_mismatch")
            if exposure["operation"].get("observation_ids") != selected:
                local.append("exposure_observation_mismatch")

        window = assessment.get("window")
        if not isinstance(window, dict):
            local.append("missing_effect_window")
            window = {}
        if window.get("observation_ids") != selected:
            local.append("window_observation_mismatch")
        if window.get("matched_observation_ids") != selected:
            local.append("window_matched_observation_mismatch")
        if window.get("boundary") != "next_model_request":
            local.append("window_boundary_mismatch")

        original_chars = 0
        replacement_chars = 0
        for observation_id in selected:
            basis = basis_by_observation.get(observation_id)
            if basis is None:
                continue
            finding_id, version = basis
            expected_marker = _marker(observation_id, finding_id, version)
            occurrences = texts_by_observation.get(observation_id, [])
            full = [(request, text) for request, text in occurrences if text != expected_marker]
            compact = [(request, text) for request, text in occurrences if text == expected_marker]
            if not full:
                local.append("missing_full_provider_observation")
                continue
            if not compact and provider_texts:
                local.append("missing_compacted_provider_observation")
                continue
            if compact and min(request for request, _ in compact) <= min(request for request, _ in full):
                local.append("compaction_not_on_later_request")
            original_chars += max(len(text) for _, text in full)
            replacement_chars += len(expected_marker)

        removed_chars = max(0, original_chars - replacement_chars)
        expected_counts = {
            "original_chars": original_chars,
            "replacement_chars": replacement_chars,
            "removed_chars": removed_chars,
        }
        for key, expected in expected_counts.items():
            if window.get(key) != expected:
                local.append(f"window_{key}_mismatch")
        if removed_chars <= 0:
            local.append("non_positive_context_reduction")

        if local:
            issues.extend(f"{assessment_id}:{issue}" for issue in dict.fromkeys(local))
        else:
            supported.append(assessment)

    return supported, issues
