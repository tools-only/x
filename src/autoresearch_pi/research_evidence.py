"""Read-only summary projection for task-local research mechanism evidence."""

from __future__ import annotations

import re
from typing import Any, Iterable


_FINDING_REF = re.compile(r"^(finding-\d+)@v(\d+)$")


def _latest(records: Iterable[dict[str, Any]], key: str) -> list[dict[str, Any]]:
    latest: dict[str, dict[str, Any]] = {}
    order: list[str] = []
    for record in records:
        identity = str(record.get(key) or "")
        if not identity:
            continue
        prior = latest.get(identity)
        if prior is None:
            order.append(identity)
        try:
            version = int(record.get("version", 0) or 0)
            prior_version = int((prior or {}).get("version", 0) or 0)
        except (TypeError, ValueError):
            version = prior_version = 0
        if prior is None or version >= prior_version:
            latest[identity] = record
    return [latest[identity] for identity in order]


def project_research_evidence(
    *,
    findings: list[dict[str, Any]],
    execution_signals: list[dict[str, Any]],
    pattern_candidates: list[dict[str, Any]],
    harness_decisions: list[dict[str, Any]] | None = None,
    harness_observations: list[dict[str, Any]] | None = None,
    effect_assessments: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Project auditable links without interpreting them as task improvement."""
    latest_findings = _latest(findings, "finding_id")
    latest_candidates = _latest(pattern_candidates, "candidate_id")
    harness_decisions = harness_decisions or []
    harness_observations = harness_observations or []
    effect_assessments = effect_assessments or []
    current_versions = {
        str(item.get("finding_id")): int(item.get("version", 0) or 0)
        for item in latest_findings
        if item.get("finding_id")
    }
    changed_dependencies: list[dict[str, Any]] = []
    parent_edges = dependency_edges = 0
    accepted_candidates: set[str] = set()
    execution_use_links: set[tuple[str, str]] = set()
    for finding in latest_findings:
        finding_id = str(finding.get("finding_id") or "")
        if finding.get("parent_goal_id"):
            parent_edges += 1
        for candidate_id in finding.get("pattern_candidate_refs") or []:
            accepted_candidates.add(str(candidate_id))
        for observation_id in finding.get("used_in_observation_refs") or []:
            execution_use_links.add((finding_id, str(observation_id)))
        for reference in finding.get("depends_on") or []:
            match = _FINDING_REF.match(str(reference))
            if not match:
                continue
            dependency_edges += 1
            target_id, target_version_text = match.groups()
            target_version = int(target_version_text)
            current_version = current_versions.get(target_id)
            if current_version != target_version:
                changed_dependencies.append({
                    "dependent_finding_id": finding_id,
                    "dependency_ref": str(reference),
                    "current_version": current_version,
                })
    known_research_refs = {
        str(item.get("finding_id"))
        for item in findings
        if item.get("finding_id")
    } | {
        f"{item.get('finding_id')}@v{int(item.get('version', 0) or 0)}"
        for item in findings
        if item.get("finding_id") and item.get("version")
    } | {
        str(item.get("candidate_id"))
        for item in pattern_candidates
        if item.get("candidate_id")
    } | {
        f"{item.get('candidate_id')}@v{int(item.get('version', 0) or 0)}"
        for item in pattern_candidates
        if item.get("candidate_id") and item.get("version")
    }
    exposures_by_decision: dict[str, list[str]] = {}
    for observation in harness_observations:
        decision_id = str(observation.get("decision_id") or "")
        observation_id = str(observation.get("observation_id") or "")
        if decision_id and observation_id and observation.get("effect_observed") is True:
            exposures_by_decision.setdefault(decision_id, []).append(observation_id)
    assessments_by_decision: dict[str, list[dict[str, Any]]] = {}
    for assessment in effect_assessments:
        decision_id = str(assessment.get("decision_id") or "")
        assessment_id = str(assessment.get("effect_assessment_id") or "")
        if decision_id and assessment_id:
            assessments_by_decision.setdefault(decision_id, []).append(assessment)
    application_paths: list[dict[str, Any]] = []
    for decision in harness_decisions:
        decision_id = str(decision.get("decision_id") or "")
        research_basis_refs = [
            str(reference)
            for reference in decision.get("basis_resource_ids") or []
            if str(reference) in known_research_refs
        ]
        if not decision_id or not research_basis_refs:
            continue
        native_refs = exposures_by_decision.get(decision_id, [])
        assessment_records = assessments_by_decision.get(decision_id, [])
        assessment_refs = [
            str(item.get("effect_assessment_id")) for item in assessment_records
        ]
        stage = "agent_assessed" if assessment_refs else "native_exposed" if native_refs else "decision_recorded"
        path = {
            "decision_id": decision_id,
            "intervention": decision.get("intervention"),
            "research_basis_refs": research_basis_refs,
            "native_observation_refs": native_refs,
            "effect_assessment_refs": assessment_refs,
            "stage": stage,
        }
        if assessment_records:
            latest_assessment = assessment_records[-1]
            path["latest_effect_assessment"] = {
                "effect_assessment_id": latest_assessment.get("effect_assessment_id"),
                "verdict": latest_assessment.get("verdict"),
                "observation_refs": latest_assessment.get("observation_refs") or [],
            }
        application_paths.append(path)
    return {
        "finding_versions": len(findings),
        "latest_resource_count": len(latest_findings),
        "open_goal_versions": sum(item.get("status") == "open" for item in findings),
        "open_goal_count": sum(item.get("status") == "open" for item in latest_findings),
        "active_finding_count": sum(item.get("status") == "active" for item in latest_findings),
        "resolved_resource_count": sum(item.get("status") == "resolved" for item in latest_findings),
        "latest_findings": latest_findings,
        "execution_signal_count": len(execution_signals),
        "pattern_candidate_versions": len(pattern_candidates),
        "latest_pattern_candidates": latest_candidates,
        "execution_use_link_count": len(execution_use_links),
        "pattern_candidate_acceptance_count": len(accepted_candidates),
        "research_graph": {
            "node_count": len(latest_findings),
            "parent_edge_count": parent_edges,
            "dependency_edge_count": dependency_edges,
            "changed_dependencies": changed_dependencies,
        },
        "application_graph": {
            "decision_count": len(harness_decisions),
            "research_linked_decision_count": len(application_paths),
            "native_exposure_link_count": sum(len(item["native_observation_refs"]) for item in application_paths),
            "effect_assessment_link_count": sum(len(item["effect_assessment_refs"]) for item in application_paths),
            "paths": application_paths,
        },
        "harness_improved": None,
        "interpretation": (
            "Signals, candidates, usage links, and graph edges are mechanism evidence; "
            "they do not establish task or harness improvement."
        ),
    }
