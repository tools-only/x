"""Real one-case OfficeBench run driven by Pi's native agent loop."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Sequence

from .pi_kernel import PiKernel
from .project import ProjectPaths


@dataclass(frozen=True)
class PiOfficeBenchRun:
    pi_version: str
    model: str
    answer: str
    agent_succeeded: bool
    agent_error: str
    events: tuple[dict[str, Any], ...]
    before: dict[str, Any]
    after: dict[str, Any]
    observed: dict[str, Any]
    surface_before: dict[str, Any] = field(default_factory=dict)
    surface_after: dict[str, Any] = field(default_factory=dict)
    surface_observed: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class OfficeBenchE2EResult:
    root: Path
    case_id: str
    score: float
    passed: bool
    summary: Path
    auto_research_handoff: Path
    self_harness_handoff: Path
    round_hierarchy: Path


@dataclass(frozen=True)
class OfficeBenchE2EBatchResult:
    root: Path
    total_cases: int
    passed_cases: int
    failed_cases: int
    summary: Path


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _officebench_artifact_contract() -> dict[str, Any]:
    """Load the shared backend contract disclosed to the runner and Pi extension."""
    path = Path(__file__).resolve().parents[2] / "demo" / "officebench_artifact_contract.json"
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("OfficeBench artifact contract must be a JSON object")
    return value


def _build_task_resource_catalog(
    testbed: Path,
    task: str,
    artifact_contract: dict[str, Any],
    *,
    max_entries: int = 200,
) -> dict[str, Any]:
    """Build the bounded resource/action disclosure consumed by one Pi task."""
    entries: list[dict[str, Any]] = []
    if testbed.is_dir():
        candidates = sorted(
            (path for path in testbed.rglob("*") if not path.is_symlink()),
            key=lambda path: path.relative_to(testbed).as_posix(),
        )
        for path in candidates[:max_entries]:
            relative_path = path.relative_to(testbed).as_posix()
            if path.is_dir():
                entries.append({"path": f"{relative_path}/", "kind": "directory"})
            elif path.is_file():
                entries.append({"path": relative_path, "kind": "file", "size": path.stat().st_size})

    searchable = f"{task}\n" + "\n".join(entry["path"] for entry in entries)
    lowered = searchable.lower()
    app_markers = {
        "calendar": ("calendar", ".ics", " event", "schedule"),
        "email": ("email", "e-mail", ".eml", " mail"),
        "excel": ("excel", ".xlsx", ".xls", "spreadsheet", "workbook"),
        "word": ("word document", ".docx"),
        "pdf": ("pdf", ".pdf"),
        "ocr": ("ocr", ".png", ".jpg", ".jpeg", "image"),
    }
    relevant_apps = sorted(
        app for app, markers in app_markers.items() if any(marker in lowered for marker in markers)
    )
    actions = artifact_contract.get("actions") or {}
    selected_actions: set[str] = set()
    if "calendar" in relevant_apps:
        selected_actions.update({"calendar.list_events", "calendar.create_event"})
        if any(marker in task.lower() for marker in ("delete", "remove", "cancel")):
            selected_actions.add("calendar.delete_event")
    if "email" in relevant_apps:
        selected_actions.update({"email.send_email", "email.list_emails", "email.read_email"})
    if "excel" in relevant_apps:
        selected_actions.add("excel.read_file")
        if any(marker in task.lower() for marker in ("cell", "update", "edit", "write", "delete", "create")):
            selected_actions.update({"excel.set_cell", "excel.delete_cell", "excel.create_new_file"})
    if "word" in relevant_apps:
        selected_actions.add("word.read_file")
        if any(marker in task.lower() for marker in ("create", "write", "append", "edit")):
            selected_actions.update({"word.create_new_file", "word.write_to_file"})
    if "pdf" in relevant_apps:
        selected_actions.add("pdf.read_file")
    if "ocr" in relevant_apps:
        selected_actions.add("ocr.recognize_file")
    action_contracts = {
        name: value
        for name, value in actions.items()
        if name in selected_actions
    }
    return {
        "format": "officebench-task-resource-catalog-v1",
        "scope": artifact_contract.get("scope", {}).get("task_workspace", "current_case_testbed_only"),
        "inventory": {
            "root": ".",
            "entries": entries,
            "truncated": testbed.is_dir() and len(candidates) > max_entries,
        },
        "relevant_apps": relevant_apps,
        "action_contracts": action_contracts,
        "task_language_conventions": artifact_contract.get("task_language_conventions", {}),
        "canonical_contract": {
            "path": "artifact-contract.json",
            "format": artifact_contract.get("format"),
            "coverage": "complete_backend_contract_audit_artifact",
        },
        "disclosure": {
            "timing": "initial_model_request",
            "dynamic_contract_lookup_needed": False,
            "resource_boundary": "current_case_testbed_only",
        },
    }


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _normalise_testbed_target(testbed: Path, raw_path: object) -> str | None:
    if not isinstance(raw_path, str) or not raw_path.strip():
        return None
    candidate = Path(raw_path)
    if not candidate.is_absolute():
        candidate = testbed / candidate
    try:
        return candidate.resolve().relative_to(testbed.resolve()).as_posix()
    except ValueError:
        return None


def _evaluator_required_paths(item: dict[str, Any], testbed: Path) -> list[str]:
    targets: set[str] = set()
    for evaluation_item in item.get("evaluation", []) or []:
        function = evaluation_item.get("function")
        args = evaluation_item.get("args") or {}
        for key in ("file", "output_file", "result_file"):
            target = _normalise_testbed_target(testbed, args.get(key))
            if target:
                targets.add(target)
        username = args.get("username")
        if function == "evaluate_calendar_no_overlap" and isinstance(username, str) and username:
            targets.add(f"calendar/{username}.ics")
        if function in {"evaluate_contain", "evaluate_not_contain"} and args.get("doc_type") == "email":
            if isinstance(username, str) and username:
                # The evaluator accepts exact, lower-case, or fuzzy account-directory matches.
                targets.add("emails")
    return sorted(targets)


def _target_fingerprint(testbed: Path, relative_path: str) -> dict[str, Any]:
    target = testbed / Path(relative_path)
    if target.is_file():
        return {"kind": "file", "sha256": _sha256(target), "size": target.stat().st_size}
    if target.is_dir():
        digest = hashlib.sha256()
        files = sorted(path for path in target.rglob("*") if path.is_file())
        for path in files:
            relative_child = path.relative_to(target).as_posix()
            digest.update(relative_child.encode("utf-8"))
            digest.update(b"\0")
            digest.update(_sha256(path).encode("ascii"))
            digest.update(b"\0")
        return {"kind": "directory", "sha256": digest.hexdigest(), "file_count": len(files)}
    return {"kind": "missing"}


def _target_manifest(testbed: Path, required_paths: Sequence[str]) -> dict[str, Any]:
    return {
        "format": "evaluator-target-sha256-v1",
        "algorithm": "sha256",
        "targets": {path: _target_fingerprint(testbed, path) for path in required_paths},
    }


def _task_correctness_assessment(
    required_paths: Sequence[str], before: dict[str, Any], after: dict[str, Any],
) -> dict[str, Any]:
    before_targets = before.get("targets", {})
    after_targets = after.get("targets", {})
    changed = [path for path in required_paths if before_targets.get(path) != after_targets.get(path)]
    if not required_paths:
        change_status = "no_required_paths_identified"
    elif not changed:
        change_status = "required_paths_unchanged"
    elif len(changed) == len(required_paths):
        change_status = "all_required_paths_changed"
    else:
        change_status = "some_required_paths_changed"
    return {
        "status": "not_independently_verified",
        "evaluator_is_only_a_signal": True,
        "artifact_change_status": change_status,
        "required_paths": list(required_paths),
        "changed_required_paths": changed,
        "all_required_paths_changed": bool(required_paths) and len(changed) == len(required_paths),
        "manifest_format": "evaluator-target-sha256-v1",
    }


def _read_jsonl(path: Path) -> tuple[list[dict[str, Any]], list[str]]:
    if not path.is_file():
        return [], []
    records: list[dict[str, Any]] = []
    issues: list[str] = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            issues.append(f"{path.name}:{line_number}:invalid_json")
            continue
        if not isinstance(value, dict):
            issues.append(f"{path.name}:{line_number}:not_an_object")
            continue
        records.append(value)
    return records, issues


def _research_versions(
    records: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], dict[str, list[dict[str, Any]]], list[str]]:
    """Normalize legacy findings and select the latest append-only version per stable ID."""
    histories: dict[str, list[dict[str, Any]]] = {}
    issues: list[str] = []
    event_ids: set[str] = set()
    for index, raw in enumerate(records, 1):
        finding_id = raw.get("finding_id")
        if not isinstance(finding_id, str) or not finding_id:
            issues.append(f"research-resources.jsonl:{index}:missing_finding_id")
            continue
        record = dict(raw)
        version = record.get("version", 1)
        if not isinstance(version, int) or isinstance(version, bool) or version < 1:
            issues.append(f"{finding_id}:invalid_version")
            continue
        record["version"] = version
        record.setdefault("action", "record")
        record.setdefault("status", "active")
        record.setdefault("goal_id", f"goal-for-{finding_id}")
        record.setdefault("scope", "current task execution decision")
        record.setdefault("evidence_plan", [])
        record.setdefault("assessment_refs", [])
        event_id = record.get("research_event_id")
        if event_id is None:
            event_id = f"legacy-{finding_id}-v{version}"
            record["research_event_id"] = event_id
        if not isinstance(event_id, str) or not event_id or event_id in event_ids:
            issues.append(f"{finding_id}:missing_or_duplicate_research_event_id")
            continue
        event_ids.add(event_id)
        histories.setdefault(finding_id, []).append(record)

    latest: list[dict[str, Any]] = []
    for finding_id, history in histories.items():
        versions = [record["version"] for record in history]
        if versions != list(range(1, len(history) + 1)):
            issues.append(f"{finding_id}:non_contiguous_or_out_of_order_versions")
        goal_ids = {record.get("goal_id") for record in history}
        if len(goal_ids) != 1 or not all(isinstance(value, str) and value for value in goal_ids):
            issues.append(f"{finding_id}:unstable_or_missing_goal_id")
        for previous, current in zip(history, history[1:]):
            if current.get("supersedes_event_id") != previous.get("research_event_id"):
                issues.append(f"{finding_id}:broken_supersedes_link")
        latest.append(history[-1])
    return latest, histories, issues


def _research_lifecycle(root: Path) -> dict[str, Any]:
    records, issues = _read_jsonl(root / "research-resources.jsonl")
    assessments, assessment_issues = _read_jsonl(root / "effect-assessments.jsonl")
    latest, histories, version_issues = _research_versions(records)
    issues.extend(assessment_issues + version_issues)
    assessment_ids = {
        record.get("effect_assessment_id") for record in assessments
        if isinstance(record.get("effect_assessment_id"), str)
    }
    absorbed_ids: set[str] = set()
    for record in records:
        refs = record.get("assessment_refs", [])
        if not isinstance(refs, list):
            issues.append(f"{record.get('finding_id', 'unknown')}:invalid_assessment_refs")
            continue
        unknown = [reference for reference in refs if reference not in assessment_ids]
        if unknown:
            issues.append(f"{record.get('finding_id', 'unknown')}:unknown_assessment_ref")
        absorbed_ids.update(reference for reference in refs if isinstance(reference, str))
    pending_ids = sorted(assessment_ids - absorbed_ids)
    latest_statuses = {record.get("status") for record in latest}
    if issues:
        status = "invalid"
    elif not records:
        status = "not_attempted"
    elif pending_ids:
        status = "effect_pending_absorption"
    elif latest and latest_statuses == {"resolved"}:
        status = "closed"
    elif "open" in latest_statuses:
        status = "open"
    else:
        status = "active"
    return {
        "status": status,
        "goal_count": len(histories),
        "event_count": len(records),
        "latest": [{
            "goal_id": record.get("goal_id"),
            "finding_id": record.get("finding_id"),
            "version": record.get("version"),
            "status": record.get("status"),
            "resolution": record.get("resolution"),
            "research_event_id": record.get("research_event_id"),
        } for record in latest],
        "absorbed_effect_assessment_ids": sorted(absorbed_ids),
        "pending_effect_assessment_ids": pending_ids,
        "issues": issues,
        "source_ref": "research-resources.jsonl",
    }


def _task_resource_boundary_assessment(root: Path) -> dict[str, Any]:
    observations, issues = _read_jsonl(root / "execution-observations.jsonl")
    violations = [
        record for record in observations
        if record.get("error_kind") == "task_resource_boundary_violation"
    ]
    shell_attempts = [
        record for record in observations
        if record.get("operation") == "shell.command"
    ]
    workspace_reads = [
        record for record in observations
        if record.get("tool") == "workspace_file_action"
    ]
    contract_reads = [
        record for record in observations
        if record.get("tool") == "task_artifact_contract"
    ]
    return {
        "status": "enforced_rejected_attempts" if violations else "enforced_no_violation",
        "scope": "current_case_testbed_only",
        "enforcement": {
            "path_arguments": "bridge_validated_before_backend_action",
            "broad_shell": "rejected",
            "safe_file_access": "workspace_file_action",
        },
        "workspace_file_action_calls": len(workspace_reads),
        "artifact_contract_reads": len(contract_reads),
        "shell_attempt_count": len(shell_attempts),
        "rejected_external_resource_attempt_count": len(violations),
        "rejected_observation_ids": [record.get("event_id") for record in violations],
        "record_issues": issues,
        "source_ref": "execution-observations.jsonl",
    }


def _execution_efficiency(root: Path, native: PiOfficeBenchRun) -> dict[str, Any]:
    """Summarize model/resource/backend work without treating score as causal evidence."""
    observations, issues = _read_jsonl(root / "execution-observations.jsonl")
    task_actions = [record for record in observations if record.get("category") == "task_action"]
    resources = [record for record in observations if record.get("category") == "resource"]
    research_events, research_issues = _read_jsonl(root / "research-resources.jsonl")
    issues.extend(research_issues)
    research_tool_results = [
        event for event in native.events
        if event.get("type") == "tool_execution_end" and event.get("toolName") == "research_resource"
    ]
    tool_execution_errors = [
        event for event in native.events
        if event.get("type") == "tool_execution_end" and event.get("isError") is True
    ]
    attempted_work_units = sum(int(record.get("attempted_work_units", 1)) for record in task_actions)
    completed_work_units = sum(
        int(record.get("completed_work_units", 1 if record.get("outcome") == "success" else 0))
        for record in task_actions
    )
    backend_bridge_processes = len(task_actions)
    catalog_path = root / "task-resource-catalog.json"
    inventory_entries = 0
    if catalog_path.is_file():
        try:
            catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
            entries = (catalog.get("inventory") or {}).get("entries", []) if isinstance(catalog, dict) else []
            inventory_entries = len(entries) if isinstance(entries, list) else 0
        except json.JSONDecodeError:
            issues.append("task-resource-catalog.json:invalid_json")
    return {
        "model_turns": sum(event.get("type") == "turn_end" for event in native.events),
        "task_action_calls": len(task_actions),
        "resource_calls": len(resources),
        "research_resource_calls": len(research_tool_results),
        "research_resource_successful_events": len(research_events),
        "research_resource_errors": sum(event.get("isError") is True for event in research_tool_results),
        "tool_execution_errors": len(tool_execution_errors),
        "semantic_errors": sum(record.get("outcome") == "semantic_error" for record in observations),
        "backend_bridge_processes": backend_bridge_processes,
        "attempted_work_units": attempted_work_units,
        "completed_work_units": completed_work_units,
        "work_units_per_bridge_process": (
            round(completed_work_units / backend_bridge_processes, 3) if backend_bridge_processes else 0
        ),
        "artifact_contract_tool_reads": sum(
            record.get("tool") == "task_artifact_contract" for record in observations
        ),
        "workspace_file_action_calls": sum(
            record.get("tool") == "workspace_file_action" for record in observations
        ),
        "catalog_initial_disclosures": int(catalog_path.is_file()),
        "inventory_entries_disclosed": inventory_entries,
        "record_issues": issues,
        "source_refs": ["pi-events.jsonl", "execution-observations.jsonl", "task-resource-catalog.json"],
    }


def _loop_integrity(root: Path) -> dict[str, Any]:
    observations, issues = _read_jsonl(root / "execution-observations.jsonl")
    finding_events, finding_issues = _read_jsonl(root / "research-resources.jsonl")
    decisions, decision_issues = _read_jsonl(root / "harness-decisions.jsonl")
    effects, effect_issues = _read_jsonl(root / "harness-observations.jsonl")
    assessments, assessment_issues = _read_jsonl(root / "effect-assessments.jsonl")
    findings, histories, version_issues = _research_versions(finding_events)
    issues.extend(
        finding_issues + decision_issues + effect_issues + assessment_issues + version_issues
    )

    execution_ids = {value.get("event_id") for value in observations if value.get("event_id")}
    assessment_ids = {
        value.get("effect_assessment_id") for value in assessments
        if value.get("effect_assessment_id")
    }
    finding_ids: set[str] = set()
    for finding in findings:
        finding_id = finding.get("finding_id")
        evidence_refs = finding.get("evidence_refs")
        assessment_refs = finding.get("assessment_refs", [])
        if not isinstance(finding_id, str) or not finding_id:
            issues.append("finding_missing_id")
            continue
        finding_ids.add(finding_id)
        if not isinstance(evidence_refs, list):
            issues.append(f"{finding_id}:missing_evidence_refs")
        elif any(reference not in execution_ids for reference in evidence_refs):
            issues.append(f"{finding_id}:unknown_evidence_ref")
        if not isinstance(assessment_refs, list):
            issues.append(f"{finding_id}:invalid_assessment_refs")
        elif any(reference not in assessment_ids for reference in assessment_refs):
            issues.append(f"{finding_id}:unknown_assessment_ref")
        if finding.get("status") != "open" and not evidence_refs and not assessment_refs:
            issues.append(f"{finding_id}:active_or_resolved_without_evidence")
        if finding.get("status") == "resolved" and finding.get("resolution") not in {
            "supported", "contradicted", "inconclusive", "no_longer_relevant",
        }:
            issues.append(f"{finding_id}:resolved_without_resolution")

    decisions_by_id: dict[str, dict[str, Any]] = {}
    for decision in decisions:
        decision_id = decision.get("decision_id")
        basis = decision.get("basis_resource_ids")
        if not isinstance(decision_id, str) or not decision_id or decision_id in decisions_by_id:
            issues.append("decision_missing_or_duplicate_id")
            continue
        decisions_by_id[decision_id] = decision
        if decision.get("capability_id") != "execution_tool_surface":
            issues.append(f"{decision_id}:unsupported_capability")
        if not isinstance(basis, list) or not basis:
            issues.append(f"{decision_id}:missing_basis")
        elif any(reference not in finding_ids for reference in basis):
            issues.append(f"{decision_id}:unknown_basis")
        basis_snapshots = decision.get("basis_snapshots")
        if basis_snapshots is not None:
            if not isinstance(basis_snapshots, list) or len(basis_snapshots) != len(basis or []):
                issues.append(f"{decision_id}:invalid_basis_snapshots")
            else:
                for snapshot in basis_snapshots:
                    history = histories.get(snapshot.get("finding_id"), []) if isinstance(snapshot, dict) else []
                    if not any(
                        event.get("version") == snapshot.get("version")
                        and event.get("research_event_id") == snapshot.get("research_event_id")
                        and event.get("evidence_refs") == snapshot.get("evidence_refs")
                        for event in history
                    ):
                        issues.append(f"{decision_id}:unknown_basis_snapshot")

    applied_decision_ids = {
        decision_id for decision_id, decision in decisions_by_id.items()
        if decision.get("applied", True) is True
    }
    kept_decision_ids = set(decisions_by_id) - applied_decision_ids
    linked_decisions: set[str] = set()
    for effect in effects:
        decision_id = effect.get("decision_id")
        decision = decisions_by_id.get(decision_id)
        if decision is None:
            issues.append("observation_unknown_decision")
            continue
        if decision_id not in applied_decision_ids:
            issues.append(f"{decision_id}:observation_for_unapplied_decision")
            continue
        if effect.get("toolCallId") != decision.get("toolCallId"):
            issues.append(f"{decision_id}:observation_tool_call_mismatch")
            continue
        if effect.get("basis_resource_ids") != decision.get("basis_resource_ids"):
            issues.append(f"{decision_id}:observation_basis_mismatch")
            continue
        operation = effect.get("operation") or {}
        if operation.get("capability") != "pi.setActiveTools":
            issues.append(f"{decision_id}:observation_capability_mismatch")
            continue
        if effect.get("effect_observed") is True:
            linked_decisions.add(decision_id)

    if issues:
        status = "invalid_basis"
    elif not decisions:
        status = "not_attempted"
    elif not applied_decision_ids:
        status = "kept_unchanged"
    elif linked_decisions == applied_decision_ids:
        status = "linked_effect_observed"
    else:
        status = "applied_unobserved"
    return {
        "status": status,
        "execution_observation_count": len(observations),
        "finding_count": len(findings),
        "finding_event_count": len(finding_events),
        "decision_count": len(decisions),
        "effect_observation_count": len(effects),
        "linked_decision_ids": sorted(linked_decisions),
        "unobserved_decision_ids": sorted(applied_decision_ids - linked_decisions),
        "kept_decision_ids": sorted(kept_decision_ids),
        "issues": issues,
    }


def _research_connection(root: Path) -> dict[str, Any]:
    """Report which optional observation-to-capability connection stage was reached."""
    observations, issues = _read_jsonl(root / "execution-observations.jsonl")
    finding_events, finding_issues = _read_jsonl(root / "research-resources.jsonl")
    decisions, decision_issues = _read_jsonl(root / "harness-decisions.jsonl")
    effects, effect_issues = _read_jsonl(root / "harness-observations.jsonl")
    findings, _histories, version_issues = _research_versions(finding_events)
    issues.extend(finding_issues + decision_issues + effect_issues + version_issues)

    candidates: list[tuple[int, dict[str, Any]]] = []
    for index, observation in enumerate(observations):
        support = observation.get("decision_support")
        if (
            isinstance(support, dict)
            and support.get("capability_id") == "execution_tool_surface"
            and isinstance(observation.get("event_id"), str)
        ):
            candidates.append((index, observation))
    candidate_ids = {observation["event_id"] for _, observation in candidates}
    execution_ids = {
        observation.get("event_id") for observation in observations
        if isinstance(observation.get("event_id"), str)
    }

    candidates_with_later_work: list[str] = []
    for index, observation in candidates:
        mode = (observation.get("decision_support") or {}).get("candidate_mode")
        later_relevant = any(
            later.get("category") == "task_action"
            and (
                mode not in {"calendar_focused", "calendar_batch", "email_batch"}
                or mode in {"calendar_focused", "calendar_batch"}
                and later.get("tool") in {"calendar_action", "calendar_batch_action"}
                or mode == "email_batch" and later.get("tool") in {"email_action", "email_batch_action"}
            )
            for later in observations[index + 1:]
        )
        if later_relevant:
            candidates_with_later_work.append(observation["event_id"])

    evidence_linked_findings: dict[str, dict[str, Any]] = {}
    candidate_linked_findings: dict[str, dict[str, Any]] = {}
    for finding in findings:
        finding_id = finding.get("finding_id")
        evidence_refs = finding.get("evidence_refs")
        if not isinstance(finding_id, str) or not finding_id:
            issues.append("connection_finding_missing_id")
            continue
        if finding.get("status") == "open":
            continue
        if not isinstance(evidence_refs, list) or not evidence_refs:
            issues.append(f"{finding_id}:connection_missing_evidence")
            continue
        if any(reference not in execution_ids for reference in evidence_refs):
            issues.append(f"{finding_id}:connection_unknown_evidence")
            continue
        evidence_linked_findings[finding_id] = finding
        if any(reference in candidate_ids for reference in evidence_refs):
            candidate_linked_findings[finding_id] = finding

    evidence_linked_decisions: dict[str, dict[str, Any]] = {}
    candidate_linked_decisions: dict[str, dict[str, Any]] = {}
    for decision in decisions:
        decision_id = decision.get("decision_id")
        basis = decision.get("basis_resource_ids")
        if (
            isinstance(decision_id, str)
            and isinstance(basis, list)
            and any(finding_id in evidence_linked_findings for finding_id in basis)
        ):
            evidence_linked_decisions[decision_id] = decision
            if any(finding_id in candidate_linked_findings for finding_id in basis):
                candidate_linked_decisions[decision_id] = decision

    applied = {
        decision_id: decision for decision_id, decision in evidence_linked_decisions.items()
        if decision.get("applied", True) is True
    }
    observed_applied = {
        effect.get("decision_id") for effect in effects
        if effect.get("decision_id") in applied
        and effect.get("effect_observed") is True
        and effect.get("toolCallId") == applied[effect["decision_id"]].get("toolCallId")
        and effect.get("basis_resource_ids") == applied[effect["decision_id"]].get("basis_resource_ids")
    }

    if issues:
        status = "invalid_connection"
    elif evidence_linked_decisions:
        if not applied:
            status = "keep_recorded"
        elif observed_applied == set(applied):
            status = "apply_effect_observed"
        else:
            status = "apply_unobserved"
    elif evidence_linked_findings:
        status = "finding_recorded_no_decision"
    elif candidates:
        status = "candidate_seen_no_finding"
    else:
        status = "no_candidate"
    if candidate_linked_decisions:
        connection_origin = "decision_support"
    elif evidence_linked_decisions or evidence_linked_findings:
        connection_origin = "direct_execution_observation"
    elif candidates:
        connection_origin = "decision_support"
    else:
        connection_origin = "none"
    return {
        "status": status,
        "connection_origin": connection_origin,
        "candidate_observation_ids": [observation["event_id"] for _, observation in candidates],
        "candidates_with_later_relevant_work": candidates_with_later_work,
        "evidence_linked_finding_ids": sorted(evidence_linked_findings),
        "evidence_linked_decision_ids": sorted(evidence_linked_decisions),
        "candidate_linked_finding_ids": sorted(candidate_linked_findings),
        "candidate_linked_decision_ids": sorted(candidate_linked_decisions),
        "observed_applied_decision_ids": sorted(observed_applied),
        "issues": issues,
    }


def _execution_condition_effect(root: Path) -> dict[str, Any]:
    observations, issues = _read_jsonl(root / "execution-observations.jsonl")
    finding_events, finding_issues = _read_jsonl(root / "research-resources.jsonl")
    decisions, decision_issues = _read_jsonl(root / "harness-decisions.jsonl")
    exposures, exposure_issues = _read_jsonl(root / "harness-observations.jsonl")
    assessments, assessment_issues = _read_jsonl(root / "effect-assessments.jsonl")
    findings, _histories, version_issues = _research_versions(finding_events)
    issues.extend(
        finding_issues + decision_issues + exposure_issues + assessment_issues + version_issues
    )
    observations_by_id = {
        observation.get("event_id"): observation
        for observation in observations
        if isinstance(observation.get("event_id"), str)
    }
    findings_by_id = {
        finding.get("finding_id"): finding
        for finding in findings
        if isinstance(finding.get("finding_id"), str)
    }
    decisions_by_id = {
        decision.get("decision_id"): decision
        for decision in decisions
        if isinstance(decision.get("decision_id"), str)
    }
    applied = {
        decision_id: decision for decision_id, decision in decisions_by_id.items()
        if decision.get("applied", True) is True
    }
    valid: list[dict[str, Any]] = []
    assessed_decision_ids: set[str] = set()
    for assessment in assessments:
        decision_id = assessment.get("decision_id")
        decision = applied.get(decision_id)
        if decision is None:
            issues.append("effect_unknown_or_unapplied_decision")
            continue
        if decision_id in assessed_decision_ids:
            issues.append(f"{decision_id}:duplicate_effect_assessment")
            continue
        if assessment.get("toolCallId") != decision.get("toolCallId"):
            issues.append(f"{decision_id}:effect_tool_call_mismatch")
            continue
        if assessment.get("basis_resource_ids") != decision.get("basis_resource_ids"):
            issues.append(f"{decision_id}:effect_basis_mismatch")
            continue
        if (
            assessment.get("basis_snapshots") is not None
            and assessment.get("basis_snapshots") != decision.get("basis_snapshots")
        ):
            issues.append(f"{decision_id}:effect_basis_snapshot_mismatch")
            continue
        if assessment.get("effect_metric") != decision.get("effect_metric"):
            issues.append(f"{decision_id}:effect_metric_mismatch")
            continue
        if assessment.get("expected_effect") != decision.get("expected_effect"):
            issues.append(f"{decision_id}:effect_expectation_mismatch")
            continue
        if assessment.get("verdict") not in {"supported", "contradicted", "inconclusive"}:
            issues.append(f"{decision_id}:invalid_effect_verdict")
            continue
        if assessment.get("improvement") != "not_established":
            issues.append(f"{decision_id}:unsupported_improvement_claim")
            continue

        basis_observation_ids: list[str] = []
        basis_valid = True
        basis_snapshots = decision.get("basis_snapshots")
        if isinstance(basis_snapshots, list):
            for snapshot in basis_snapshots:
                if not isinstance(snapshot, dict) or not isinstance(snapshot.get("evidence_refs"), list):
                    basis_valid = False
                    break
                basis_observation_ids.extend(snapshot["evidence_refs"])
        else:
            for finding_id in decision.get("basis_resource_ids") or []:
                finding = findings_by_id.get(finding_id)
                if finding is None or not isinstance(finding.get("evidence_refs"), list):
                    basis_valid = False
                    break
                basis_observation_ids.extend(finding["evidence_refs"])
        baseline_observations = [observations_by_id.get(event_id) for event_id in basis_observation_ids]
        if not basis_valid or any(observation is None for observation in baseline_observations):
            issues.append(f"{decision_id}:effect_baseline_unverifiable")
            continue
        baseline_calls = len(baseline_observations)
        baseline_errors = sum(
            observation.get("outcome") != "success"
            for observation in baseline_observations
            if observation is not None
        )
        expected_baseline = {"evidence_calls": baseline_calls, "semantic_errors": baseline_errors}
        if assessment.get("baseline") != expected_baseline:
            issues.append(f"{decision_id}:effect_baseline_mismatch")
            continue

        window = assessment.get("window")
        if not isinstance(window, dict) or not isinstance(window.get("observation_ids"), list):
            issues.append(f"{decision_id}:effect_window_invalid")
            continue
        observation_ids = window["observation_ids"]
        if len(observation_ids) != len(set(observation_ids)):
            issues.append(f"{decision_id}:effect_window_duplicate_observation")
            continue
        window_observations = [observations_by_id.get(event_id) for event_id in observation_ids]
        if any(
            observation is None or observation.get("category") != "task_action"
            for observation in window_observations
        ):
            issues.append(f"{decision_id}:effect_window_unknown_observation")
            continue
        horizon = decision.get("observation_horizon")
        completion_reason = window.get("completion_reason")
        if window.get("horizon") != horizon or completion_reason not in {
            "horizon_reached", "task_settled", "superseded",
        }:
            issues.append(f"{decision_id}:effect_window_boundary_mismatch")
            continue
        if completion_reason == "horizon_reached" and len(observation_ids) != horizon:
            issues.append(f"{decision_id}:effect_window_horizon_mismatch")
            continue
        actual_window = {
            "relevant_calls": len(window_observations),
            "semantic_errors": sum(
                observation.get("outcome") != "success"
                for observation in window_observations
                if observation is not None
            ),
        }
        if decision.get("effect_metric") == "focused_tool_use_rate":
            actual_window["focused_tool_calls"] = sum(
                observation.get("tool") == "calendar_action"
                for observation in window_observations
                if observation is not None
            )
        if decision.get("effect_metric") in {"calendar_batch_utilization", "email_batch_utilization"}:
            expected_batch_tool = (
                "calendar_batch_action"
                if decision.get("effect_metric") == "calendar_batch_utilization"
                else "email_batch_action"
            )
            batch_observations = [
                observation for observation in window_observations
                if observation is not None and observation.get("tool") == expected_batch_tool
            ]
            work_unit_values = [
                (observation.get("attempted_work_units"), observation.get("completed_work_units"))
                for observation in batch_observations
            ]
            if any(
                not isinstance(attempted, int) or isinstance(attempted, bool) or attempted < 0
                or not isinstance(completed, int) or isinstance(completed, bool) or completed < 0
                or completed > attempted
                for attempted, completed in work_unit_values
            ):
                issues.append(f"{decision_id}:effect_work_units_invalid")
                continue
            batch_tool_calls = len(batch_observations)
            attempted_work_units = sum(attempted for attempted, _ in work_unit_values)
            completed_work_units = sum(completed for _, completed in work_unit_values)
            actual_window.update({
                "batch_tool_calls": batch_tool_calls,
                "attempted_work_units": attempted_work_units,
                "completed_work_units": completed_work_units,
                "tool_call_compression": (
                    completed_work_units / batch_tool_calls if batch_tool_calls else 0
                ),
            })
        if any(window.get(key) != value for key, value in actual_window.items()):
            issues.append(f"{decision_id}:effect_window_count_mismatch")
            continue

        exposure_observed = any(
            exposure.get("decision_id") == decision_id
            and exposure.get("toolCallId") == decision.get("toolCallId")
            and exposure.get("basis_resource_ids") == decision.get("basis_resource_ids")
            and exposure.get("effect_observed") is True
            and (exposure.get("operation") or {}).get("capability") == "pi.setActiveTools"
            for exposure in exposures
        )
        if assessment.get("exposure_observed") is not exposure_observed:
            issues.append(f"{decision_id}:effect_exposure_mismatch")
            continue

        recomputed_verdict = "inconclusive"
        if completion_reason == "horizon_reached" and exposure_observed and window_observations:
            if decision.get("effect_metric") in {"calendar_batch_utilization", "email_batch_utilization"}:
                expected_batch_mode = (
                    "calendar_batch"
                    if decision.get("effect_metric") == "calendar_batch_utilization"
                    else "email_batch"
                )
                if (
                    decision.get("value") == expected_batch_mode
                    and actual_window["batch_tool_calls"] > 0
                    and actual_window["completed_work_units"] >= 2
                    and actual_window["completed_work_units"] == actual_window["attempted_work_units"]
                    and actual_window["relevant_calls"] < actual_window["completed_work_units"]
                ):
                    recomputed_verdict = "supported"
                elif (
                    actual_window["batch_tool_calls"] == 0
                    or actual_window["completed_work_units"] < actual_window["attempted_work_units"]
                ):
                    recomputed_verdict = "contradicted"
            elif decision.get("effect_metric") == "focused_tool_use_rate":
                if (
                    decision.get("value") == "calendar_focused"
                    and actual_window["focused_tool_calls"] == actual_window["relevant_calls"]
                ):
                    recomputed_verdict = "supported"
                elif actual_window["focused_tool_calls"] == 0:
                    recomputed_verdict = "contradicted"
            elif baseline_calls:
                baseline_rate = baseline_errors / baseline_calls
                observed_rate = actual_window["semantic_errors"] / actual_window["relevant_calls"]
                if observed_rate < baseline_rate:
                    recomputed_verdict = "supported"
                elif observed_rate > baseline_rate:
                    recomputed_verdict = "contradicted"
        if assessment.get("verdict") != recomputed_verdict:
            issues.append(f"{decision_id}:effect_verdict_mismatch")
            continue
        valid.append(assessment)
        assessed_decision_ids.add(decision_id)

    if issues:
        status = "invalid_link"
    elif not applied:
        status = "not_attempted"
    elif assessed_decision_ids != set(applied):
        status = "pending"
    else:
        verdicts = {assessment["verdict"] for assessment in valid}
        status = next(iter(verdicts)) if len(verdicts) == 1 else "mixed"
    return {
        "status": status,
        "applied_decision_count": len(applied),
        "assessment_count": len(assessments),
        "valid_assessment_ids": [
            assessment.get("effect_assessment_id") for assessment in valid
            if assessment.get("effect_assessment_id")
        ],
        "issues": issues,
        "harness_improvement": "not_established",
    }


_TRACE_METADATA = {
    "trace_format": "compact-jsonl-v1",
    "message_updates": "delta_without_cumulative_snapshots",
}


def _compact_trace_event(event: dict[str, Any]) -> dict[str, Any]:
    """Remove cumulative snapshots from high-frequency streaming updates."""
    if event.get("type") != "message_update":
        return event
    compact = dict(event)
    compact.pop("message", None)
    update = compact.get("assistantMessageEvent")
    if isinstance(update, dict):
        compact["assistantMessageEvent"] = {
            key: value for key, value in update.items() if key != "partial"
        }
    return compact


def _load_dotenv(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key, value = key.strip(), value.strip()
        if value[:1] == value[-1:] and value[:1] in {"'", '"'}:
            value = value[1:-1]
        values[key] = value
    return values


def _resolve_pi_cli() -> tuple[str, str]:
    node = shutil.which("node")
    if not node:
        raise RuntimeError("Pi runtime unsupported: node executable was not found")
    cli = Path(node).resolve().parent / "node_modules" / "@earendil-works" / "pi-coding-agent" / "dist" / "cli.js"
    if not cli.is_file():
        raise RuntimeError(f"Pi runtime unsupported: installed CLI was not found at {cli}")
    return node, str(cli)


def _extract_agent_outcome(events: Sequence[dict[str, Any]]) -> tuple[str, bool, str]:
    for event in reversed(events):
        if event.get("type") != "agent_end":
            continue
        assistants = [message for message in event.get("messages") or [] if message.get("role") == "assistant"]
        if not assistants:
            return "", False, "agent_end contained no assistant message"
        message = assistants[-1]
        if message.get("stopReason") in {"error", "aborted", "length", "toolUse"} or message.get("errorMessage"):
            return "", False, str(message.get("errorMessage") or f"Pi model ended with {message.get('stopReason')}")
        parts = message.get("content")
        if isinstance(parts, str):
            text = parts.strip()
        elif isinstance(parts, list):
            text = "".join(
                str(part.get("text", ""))
                for part in parts
                if isinstance(part, dict) and part.get("type") == "text"
            ).strip()
        else:
            text = ""
        return text, bool(text), "" if text else "Pi completed without a final natural-language answer"
    return "", False, "Pi emitted no agent_end event"


def _extract_answer(events: Sequence[dict[str, Any]]) -> str:
    """Compatibility helper used by focused event-shape tests."""
    return _extract_agent_outcome(events)[0]


def run_pi_officebench_task(root: Path, workspace: Path, task: str, paths: ProjectPaths, *, timeout: float = 900.0) -> PiOfficeBenchRun:
    env = os.environ.copy()
    env.update(_load_dotenv(paths.jit_root / ".env"))
    model = env.get("EXEC_MODEL", "a:deepseek-v4-flash")
    base_url = env.get("OPENAI_API_BASE", "")
    if not base_url or not env.get("OPENAI_API_KEY"):
        raise RuntimeError("D:\\JIT\\.env must define OPENAI_API_BASE and OPENAI_API_KEY")

    agent_dir = root / ".pi-agent"
    agent_dir.mkdir(parents=True, exist_ok=True)
    _write_json(agent_dir / "models.json", {
        "providers": {
            "yibu": {
                "baseUrl": base_url,
                "api": "openai-completions",
                "apiKey": "$OPENAI_API_KEY",
                "authHeader": True,
                "compat": {"supportsDeveloperRole": False, "supportsReasoningEffort": False},
                "models": [{
                    "id": model,
                    "name": model,
                    "reasoning": False,
                    "contextWindow": 128000,
                    "maxTokens": 8192,
                }],
            }
        }
    })

    node, cli = _resolve_pi_cli()
    extension = paths.root / "demo" / "pi_officebench_e2e_extension.ts"
    command = (
        node, cli,
        "--mode", "rpc",
        "--provider", "yibu",
        "--model", model,
        "--no-session",
        "--no-extensions",
        "--no-skills",
        "--no-prompt-templates",
        "--no-context-files",
        "--no-builtin-tools",
        "--extension", str(extension),
    )
    python_path = str(paths.root / "src")
    if env.get("PYTHONPATH"):
        python_path += os.pathsep + env["PYTHONPATH"]
    env.update({
        "PI_CODING_AGENT_DIR": str(agent_dir),
        "PI_OFFICEBENCH_E2E_ROOT": str(root),
        "PI_OFFICEBENCH_WORKSPACE": str(workspace),
        "JIT_ROOT": str(paths.jit_root),
        "JIT_PYTHON": os.getenv("JIT_PYTHON", r"D:\anaconda\envs\jit\python.exe"),
        "PYTHONPATH": python_path,
    })

    trace = root / "pi-events.jsonl"
    with trace.open("x", encoding="utf-8") as stream:
        def persist(event: dict[str, Any]) -> None:
            stream.write(json.dumps(_compact_trace_event(event), ensure_ascii=False) + "\n")
            stream.flush()

        _write_json(root / "pi-runtime-status.json", {
            "status": "running", "trace_complete": False, **_TRACE_METADATA,
        })
        try:
            with PiKernel(command, cwd=str(root), env=env, timeout=timeout, event_sink=persist) as kernel:
                response = kernel.prompt(task)
                if response.get("success") is False:
                    raise RuntimeError(f"Pi rejected the OfficeBench prompt: {response}")
                events = tuple(kernel.wait_for_agent_events(timeout=timeout))
        except Exception as exc:
            _write_json(root / "pi-runtime-status.json", {
                "status": "interrupted", "trace_complete": False,
                "error_type": type(exc).__name__, "error": str(exc),
                **_TRACE_METADATA,
            })
            raise
        _write_json(root / "pi-runtime-status.json", {
            "status": "settled", "trace_complete": True, **_TRACE_METADATA,
        })
    answer, agent_succeeded, agent_error = _extract_agent_outcome(events)

    native_root = root / "pi-native"
    snapshots = []
    for name in ("before", "after", "observed"):
        path = native_root / f"{name}.json"
        snapshots.append(json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {})
    surfaces = []
    for name in ("before", "after", "observed"):
        path = native_root / f"surface-{name}.json"
        surfaces.append(json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {})
    version = subprocess.run((node, cli, "--version"), text=True, capture_output=True, check=False).stdout.strip()
    return PiOfficeBenchRun(version or "unknown", model, answer, agent_succeeded, agent_error, events, *snapshots, *surfaces)


def _prepare_real_case(paths: ProjectPaths, root: Path, case_id: str | None):
    sys.path.insert(0, str(paths.jit_root))
    try:
        from benchmark.adapter.officebench import OfficeBenchAdapter
    finally:
        sys.path.pop(0)
    adapter = OfficeBenchAdapter(workspace_base=str(root / "workspace"))
    dataset = adapter.load_dataset(str(paths.jit_root / "dataset" / "officebench"))
    item = next(
        (candidate for candidate in dataset if not case_id or candidate.get("question_id") == case_id),
        None,
    )
    if item is None:
        raise ValueError(f"OfficeBench case not found: {case_id}")
    task = _replace_stale_runtime_capability_disclosure(adapter.get_runtime_task(item))
    return adapter, item, task


def _replace_stale_runtime_capability_disclosure(task: str) -> str:
    """Align the imported OfficeBench prompt with tools registered by this Pi extension."""
    task = task.replace(
        "You only have two exposed tools in this environment: `officebench_action` and `final_answer`.",
        "The initial Pi task tools are `officebench_action`, `calendar_action`, `email_action`, "
        "`workspace_file_action`, `task_notes`, "
        "`research_resource`, `decide_execution_surface`, and `set_evidence_policy`. The live Pi tool "
        "schema is authoritative because an optional execution-surface decision can change later requests.",
    )
    task = task.replace(
        "Every OfficeBench action must be called through `officebench_action` using JSON of the form ",
        "Use `calendar_action` directly for calendar operations and `email_action` directly for email operations "
        "when they are active; use `officebench_action` "
        "for other OfficeBench actions, using JSON of the form ",
    )
    task = task.replace(
        "Important: OfficeBench tasks are primarily evaluated by checking the final state of files and other artifacts inside the testbed, not by judging the text of your final_answer.\n"
        "This means your answer should usually be carried out by creating or modifying files, spreadsheets, documents, emails, calendars, or other task artifacts in the testbed.",
        "OfficeBench task completion is represented by concrete files, emails, calendars, or other artifacts inside the current testbed, so perform the requested artifact changes before answering.",
    )
    task = task.replace(
        "Before using final_answer, you should try to complete the task through concrete changes in the testbed whenever the task allows it.",
        "Before finishing, complete concrete changes in the testbed whenever the task allows it.",
    )
    task = task.replace("then call `final_answer`.", "then provide the final natural-language answer.")
    task = task.replace(
        "Use final_answer only after you have finished the necessary modifications or creations in the testbed.",
        "Finish with a natural-language answer only after the necessary testbed changes are complete.",
    )
    stale_line_prefixes = (
        'Example: `{"app": "shell"',
        "Your per-task workspace is:",
        "Task testbed root is:",
        "You can find files for your task in `data/`",
        "When you use shell commands,",
        "Do not assume `/testbed/",
    )
    task = "\n".join(
        line for line in task.splitlines()
        if not line.startswith(stale_line_prefixes)
    )
    return task + (
        "\nThe current case testbed is the only task workspace. Use relative data/, calendar/, and emails/ "
        "paths. Use workspace_file_action for bounded file listing or text reads. Broad shell execution is "
        "unavailable because it cannot reliably enforce this task-resource boundary. The injected artifact "
        "contract is the authoritative backend contract; sibling runs, benchmark sources, scoring sources, "
        "and project implementation files are not task resources and are unnecessary. "
        "Optional Pi-native calendar_batch and email_batch actions are initially inactive and can only be enabled "
        "for a later model request through a finding-backed execution-surface decision; no research or surface "
        "change is required."
    )


def _render_handoffs(
    root: Path,
    native: PiOfficeBenchRun,
    item: dict[str, Any],
    evaluation: dict[str, Any],
    outcomes: dict[str, Any],
) -> tuple[Path, Path, Path]:
    tool_names = [event.get("toolName", "") for event in native.events if event.get("type") == "tool_execution_start"]
    turns = sum(event.get("type") == "turn_end" for event in native.events)
    notes_path = root / "task-notes.md"
    resources_path = root / "research-resources.jsonl"
    resources, _ = _read_jsonl(resources_path)
    latest_resources, histories, _ = _research_versions(resources)
    finding_ids = [record.get("finding_id") for record in latest_resources if record.get("finding_id")]
    if notes_path.is_file():
        notes_summary = f"Task notes: `{notes_path.name}` ({notes_path.stat().st_size} bytes; source is not duplicated here).\n"
    else:
        notes_summary = "No agent-authored research notes were recorded; research design is unestablished.\n"
    if resources_path.is_file():
        resources_summary = (
            f"Structured findings: `{resources_path.name}`; `{len(histories)}` stable IDs, "
            f"`{len(resources)}` version events; "
            f"IDs `{', '.join(finding_ids) or 'none'}` (source records are not duplicated here).\n"
        )
    else:
        resources_summary = "No structured research findings were recorded.\n"
    loop = outcomes["loop_integrity"]
    connection = outcomes["research_connection"]
    effect = outcomes["execution_condition_effect"]
    lifecycle = outcomes["research_lifecycle"]
    mutation = _mutation_evidence(native)
    surface = mutation["execution_surface"]
    auto = root / "auto-research-handoff.md"
    auto.write_text(
        "# Auto-Research Handoff\n\n"
        "This task-local resource records observed execution, not a fixed research workflow.\n\n"
        f"- Case: `{item.get('question_id')}`\n"
        f"- Task: {item.get('question')}\n"
        f"- Pi model turns observed: `{turns}`\n"
        f"- Pi agent completed successfully: `{native.agent_succeeded}`\n"
        f"- Pi agent error: `{native.agent_error or 'none'}`\n"
        f"- Tool sequence: `{', '.join(tool_names)}`\n"
        f"- JIT evaluator score: `{evaluation.get('score', 0.0)}`\n"
        f"- JIT evaluator pass: `{evaluation.get('is_pass', False)}`\n\n"
        "Tool counts do not establish agent-designed research. No iteration or nesting structure is inferred.\n\n"
        "## Agent-authored task resources (claims, not verified conclusions)\n\n"
        + notes_summary
        + resources_summary
        + f"Research-to-execution connection: `{connection['status']}` "
        + f"({len(connection['candidate_observation_ids'])} visible candidates).\n"
        + f"Loop-integrity status: `{loop['status']}`.\n"
        + f"Research lifecycle: `{lifecycle['status']}`; pending effect assessments: "
        + f"`{len(lifecycle['pending_effect_assessment_ids'])}`.\n"
        + f"Execution-condition effect: `{effect['status']}`; harness improvement remains `not_established`.\n",
        encoding="utf-8",
    )
    harness = root / "self-harness-handoff.md"
    harness.write_text(
        "# Self-Harness Handoff\n\n"
        "This is task-local evidence and is not inherited by an independent task.\n\n"
        f"- Pi version: `{native.pi_version}`\n"
        "- Logical primitive: `evidence_policy`\n"
        "- Pi-native realization: registered tool updates extension-local guidance; public context hook inserts it before the next model request\n"
        f"- Before: `{native.before.get('value')}`\n"
        f"- After mutation: `{native.after.get('value')}`\n"
        f"- Later context hook observed: `{mutation['context_hook_observed']}`\n"
        "- Pi-native behavior capability: `pi.setActiveTools`\n"
        f"- Adjustment basis: {native.surface_after.get('basis') or 'not recorded'}\n"
        f"- Operation: `{json.dumps(native.surface_after.get('operation') or {}, ensure_ascii=False)}`\n"
        f"- Consequence: `{json.dumps(native.surface_observed.get('consequence') or {}, ensure_ascii=False)}`\n"
        f"- Later model request observed tool change: `{surface['observed_next_request']}`\n"
        f"- Linked-loop integrity: `{loop['status']}` ({loop['finding_count']} findings, "
        f"{loop['decision_count']} decisions, {loop['effect_observation_count']} effect observations)\n"
        f"- Bounded execution-condition effect: `{effect['status']}` ({effect['assessment_count']} assessments)\n"
        "- Canonical linked records: `research-resources.jsonl`, `harness-decisions.jsonl`, `harness-observations.jsonl`, and `effect-assessments.jsonl`; their contents are not copied into this handoff\n"
        f"- Execution surface before/after/observed: `{native.surface_before.get('value')}` / `{native.surface_after.get('value')}` / `{native.surface_observed.get('value')}`\n"
        f"- Last observed value: `{native.observed.get('value')}`\n"
        "- Scope: one Pi task process; no mutation is a valid outcome\n"
        "- Evidence: pi-events.jsonl contains tool call IDs, arguments, results and ordering; task-notes.md contains optional agent-authored reasons/observations\n"
        "- A context-hook snapshot is not proof of model compliance or performance improvement\n"
        "- Harness improvement: not established\n",
        encoding="utf-8",
    )
    hierarchy = root / "round-hierarchy.md"
    hierarchy.write_text(
        "# Round Hierarchy\n\n"
        "| Level | Observed unit | Count |\n|---|---|---:|\n"
        f"| Task | OfficeBench case `{item.get('question_id')}` | 1 |\n"
        f"| Pi runtime | model turn (`turn_end`) | {turns} |\n"
        f"| Pi runtime | tool execution | {len(tool_names)} |\n"
        "| JIT | deterministic evaluator pass | 1 |\n\n"
        "Pi model turns and tool steps are runtime events; they are not automatically Auto-Research iterations or nested research nodes.\n",
        encoding="utf-8",
    )
    return auto, harness, hierarchy


def _mutation_evidence(native: PiOfficeBenchRun) -> dict[str, Any]:
    operations = [
        event for event in native.events
        if event.get("type") == "tool_execution_end"
        and event.get("toolName") == "set_evidence_policy" and not event.get("isError")
    ]
    surface_operations = [
        event for event in native.events
        if event.get("type") == "tool_execution_end"
        and (
            event.get("toolName") in {"set_execution_surface", "decide_execution_surface"}
            or (
                event.get("toolName") == "research_resource"
                and isinstance(event.get("result", {}).get("details", {}).get("surface_decision"), dict)
            )
        )
        and not event.get("isError")
    ]
    def surface_operation_details(event: dict[str, Any]) -> dict[str, Any]:
        details = event.get("result", {}).get("details", {})
        return details.get("surface_decision", details)
    surface_observed = bool(
        native.surface_after.get("toolCallId")
        and native.surface_after.get("toolCallId") == native.surface_observed.get("toolCallId")
        and native.surface_after.get("value") == native.surface_observed.get("value")
        and native.surface_after.get("activeTools") == native.surface_observed.get("activeTools")
        and native.surface_observed.get("observedBy") == "context_hook_before_model_request"
    )
    return {
        "capability_initialized": bool(native.before),
        "before": native.before.get("value"),
        "after": native.after.get("value"),
        "observed": native.observed.get("value"),
        "successful_operations": len(operations),
        "actual_changes": sum(event.get("result", {}).get("details", {}).get("changed") is True for event in operations),
        "context_hook_observed": bool(
            native.after.get("toolCallId")
            and native.after.get("toolCallId") == native.observed.get("toolCallId")
            and native.after.get("value") == native.observed.get("value")
            and native.observed.get("observedBy") == "context_hook_before_model_request"
        ),
        "effect": "guidance_in_next_model_context_not_backend_enforcement",
        "execution_surface": {
            "before": native.surface_before.get("value"),
            "after": native.surface_after.get("value"),
            "observed": native.surface_observed.get("value"),
            "active_tools_after": native.surface_after.get("activeTools", []),
            "active_tools_observed": native.surface_observed.get("activeTools", []),
            "successful_operations": len(surface_operations),
            "actual_changes": sum(
                surface_operation_details(event).get("changed") is True
                for event in surface_operations
            ),
            "changed": native.surface_after.get("value") not in (None, native.surface_before.get("value")),
            "observed_next_request": surface_observed,
            "effect": "active_tool_set_for_next_model_request",
        },
    }


def _closed_loop_evidence(
    root: Path,
    native: PiOfficeBenchRun,
    research_connection: dict[str, Any],
    loop_integrity: dict[str, Any],
    execution_condition_effect: dict[str, Any],
) -> dict[str, Any]:
    """Project canonical task-local records into one compact, auditable evidence view."""
    observations, observation_issues = _read_jsonl(root / "execution-observations.jsonl")
    finding_events, finding_issues = _read_jsonl(root / "research-resources.jsonl")
    decisions, decision_issues = _read_jsonl(root / "harness-decisions.jsonl")
    exposures, exposure_issues = _read_jsonl(root / "harness-observations.jsonl")
    assessments, assessment_issues = _read_jsonl(root / "effect-assessments.jsonl")
    findings, histories, version_issues = _research_versions(finding_events)
    lifecycle = _research_lifecycle(root)
    record_issues = (
        observation_issues + finding_issues + decision_issues + exposure_issues
        + assessment_issues + version_issues
    )
    observations_by_id = {
        observation.get("event_id"): observation
        for observation in observations
        if isinstance(observation.get("event_id"), str)
    }
    findings_by_id = {
        finding.get("finding_id"): finding
        for finding in findings
        if isinstance(finding.get("finding_id"), str)
    }

    catalog_path = root / "capability-catalog.json"
    capability_catalog: dict[str, Any]
    if catalog_path.is_file():
        try:
            loaded_catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
            capability_catalog = loaded_catalog if isinstance(loaded_catalog, dict) else {}
            if not isinstance(loaded_catalog, dict):
                record_issues.append("capability-catalog.json:not_an_object")
        except json.JSONDecodeError:
            capability_catalog = {}
            record_issues.append("capability-catalog.json:invalid_json")
    else:
        capability_catalog = {
            "format": "surface-snapshot-fallback-v1",
            "scope": native.surface_before.get("scope", "one_pi_agent_process"),
            "effect_timing": "next_model_request",
            "initial_surface": native.surface_before.get("value"),
            "active_tools": native.surface_before.get("activeTools", []),
            "available_inactive": [],
            "coverage": "active_surface_only_catalog_missing",
        }

    task_catalog_path = root / "task-resource-catalog.json"
    task_resource_catalog: dict[str, Any] = {}
    if task_catalog_path.is_file():
        try:
            loaded_task_catalog = json.loads(task_catalog_path.read_text(encoding="utf-8"))
            if isinstance(loaded_task_catalog, dict):
                task_resource_catalog = loaded_task_catalog
            else:
                record_issues.append("task-resource-catalog.json:not_an_object")
        except json.JSONDecodeError:
            record_issues.append("task-resource-catalog.json:invalid_json")
    else:
        record_issues.append("task-resource-catalog.json:missing")

    contract_path = root / "artifact-contract.json"
    artifact_contract: dict[str, Any] = {}
    if contract_path.is_file():
        try:
            loaded_contract = json.loads(contract_path.read_text(encoding="utf-8"))
            if isinstance(loaded_contract, dict):
                artifact_contract = loaded_contract
            else:
                record_issues.append("artifact-contract.json:not_an_object")
        except json.JSONDecodeError:
            record_issues.append("artifact-contract.json:invalid_json")
    else:
        record_issues.append("artifact-contract.json:missing")
    available_resources = dict(capability_catalog)
    available_resources["task_resource_catalog"] = {
        **task_resource_catalog,
        "source_ref": "task-resource-catalog.json",
    }
    available_resources["canonical_artifact_contract"] = {
        "format": artifact_contract.get("format"),
        "scope": artifact_contract.get("scope"),
        "coverage": "complete_backend_contract_audit_artifact",
        "initial_model_surface": False,
        "source_ref": "artifact-contract.json",
    }

    goals: list[dict[str, Any]] = []
    goal_ids_by_finding: dict[str, str] = {}
    for index, finding in enumerate(findings, 1):
        finding_id = str(finding.get("finding_id") or f"unidentified-finding-{index}")
        goal_id = str(finding.get("goal_id") or f"goal-for-{finding_id}")
        goal_ids_by_finding[finding_id] = goal_id
        evidence_observations = []
        for observation_id in finding.get("evidence_refs") or []:
            observation = observations_by_id.get(observation_id)
            evidence_observations.append({
                "observation_id": observation_id,
                "tool": observation.get("tool") if observation else None,
                "operation": observation.get("operation") if observation else None,
                "outcome": observation.get("outcome") if observation else None,
                "summary": observation.get("result_summary") if observation else None,
                "source_ref": f"execution-observations.jsonl#{observation_id}",
            })
        goals.append({
            "goal_id": goal_id,
            "statement": finding.get("question"),
            "scope": finding.get("scope"),
            "uncertainty": finding.get("uncertainty"),
            "evidence_plan": list(finding.get("evidence_plan") or []),
            "status": finding.get("status", "active"),
            "finding_id": finding_id,
            "version": finding.get("version", 1),
            "research_event_id": finding.get("research_event_id"),
            "version_history": [{
                "version": event.get("version", 1),
                "action": event.get("action", "record"),
                "status": event.get("status", "active"),
                "research_event_id": event.get("research_event_id"),
            } for event in histories.get(finding_id, [])],
            "finding": finding.get("evidence"),
            "decision": finding.get("decision"),
            "resolution": finding.get("resolution"),
            "expected_recurrence": finding.get("expected_recurrence"),
            "remaining_uses": finding.get("remaining_uses"),
            "evidence_refs": list(finding.get("evidence_refs") or []),
            "assessment_refs": list(finding.get("assessment_refs") or []),
            "evidence_observations": evidence_observations,
            "source_ref": f"research-resources.jsonl#{finding.get('research_event_id') or finding_id}",
        })

    changes: list[dict[str, Any]] = []
    chains: list[dict[str, Any]] = []
    for decision in decisions:
        decision_id = decision.get("decision_id")
        basis_finding_ids = list(decision.get("basis_resource_ids") or [])
        basis_goal_ids = [
            goal_ids_by_finding[finding_id]
            for finding_id in basis_finding_ids
            if finding_id in goal_ids_by_finding
        ]
        exposure = next(
            (record for record in exposures if record.get("decision_id") == decision_id), None,
        )
        assessment = next(
            (record for record in assessments if record.get("decision_id") == decision_id), None,
        )
        previous_surface = decision.get("previous")
        next_surface = decision.get("value")
        surface_modes = capability_catalog.get("surface_modes") or {}
        before_tools = surface_modes.get(previous_surface)
        if before_tools is None and native.surface_before.get("value") == previous_surface:
            before_tools = native.surface_before.get("activeTools", [])
        after_tools = (exposure or {}).get("consequence", {}).get("activeTools")
        if after_tools is None:
            after_tools = surface_modes.get(next_surface)
        effect_projection = None
        if assessment:
            effect_projection = {
                "assessment_id": assessment.get("effect_assessment_id"),
                "metric": assessment.get("effect_metric"),
                "expected_effect": assessment.get("expected_effect"),
                "exposure_observed": assessment.get("exposure_observed"),
                "window": assessment.get("window"),
                "verdict": assessment.get("verdict"),
                "improvement": assessment.get("improvement"),
                "source_ref": (
                    f"effect-assessments.jsonl#{assessment.get('effect_assessment_id')}"
                ),
            }
        operation = (exposure or {}).get("operation")
        if operation is None and decision.get("applied") is True:
            operation = {
                "capability": "pi.setActiveTools",
                "previous": previous_surface,
                "value": next_surface,
            }
        change = {
            "decision_id": decision_id,
            "decision_path": decision.get("decision_path"),
            "choice": decision.get("choice"),
            "applied": decision.get("applied"),
            "basis_finding_ids": basis_finding_ids,
            "basis_goal_ids": basis_goal_ids,
            "basis_snapshots": list(decision.get("basis_snapshots") or []),
            "expected_effect": decision.get("expected_effect"),
            "reconsider_when": decision.get("reconsider_when"),
            "pi_native_operation": operation,
            "before": {"surface": previous_surface, "active_tools": before_tools or []},
            "after": {"surface": next_surface, "active_tools": after_tools or []},
            "observed_by_next_request": bool(exposure and exposure.get("effect_observed") is True),
            "observation_id": (exposure or {}).get("observation_id"),
            "effect": effect_projection,
            "source_ref": f"harness-decisions.jsonl#{decision_id}",
        }
        changes.append(change)
        record_ids = basis_goal_ids + basis_finding_ids + [decision_id]
        if change["observation_id"]:
            record_ids.append(change["observation_id"])
        if assessment and assessment.get("effect_assessment_id"):
            record_ids.append(assessment["effect_assessment_id"])
        latest_basis = [findings_by_id.get(finding_id, {}) for finding_id in basis_finding_ids]
        assessment_id = assessment.get("effect_assessment_id") if assessment else None
        assessment_absorbed = bool(assessment_id) and any(
            assessment_id in (finding.get("assessment_refs") or []) for finding in latest_basis
        )
        research_resolved = bool(latest_basis) and all(
            finding.get("status") == "resolved" for finding in latest_basis
        )
        chains.append({
            "decision_id": decision_id,
            "record_ids": record_ids,
            "effect_assessment_absorbed": assessment_absorbed,
            "research_resolved": research_resolved,
            "status": (
                "research_resolved" if change["observed_by_next_request"] and assessment
                and assessment_absorbed and research_resolved
                else "effect_observed_pending_research_update" if change["observed_by_next_request"] and assessment
                else "surface_observed" if change["observed_by_next_request"]
                else "decision_recorded"
            ),
        })

    if record_issues:
        status = "invalid_records"
    elif (
        research_connection.get("status") == "apply_effect_observed"
        and loop_integrity.get("status") == "linked_effect_observed"
        and execution_condition_effect.get("status") == "supported"
    ):
        status = "research_lifecycle_closed" if lifecycle.get("status") == "closed" else "behavioral_loop_established"
    elif not goals and not decisions:
        status = "not_attempted"
    elif decisions and all(decision.get("applied") is not True for decision in decisions):
        status = "kept_unchanged"
    else:
        status = "partial"

    return {
        "status": status,
        "research": {
            "goal_coverage": "agent_declared_structured_goals",
            "coverage_note": (
                "Unrecorded internal exploration is not inferred; only latest versioned research_resource state is projected, with compact history references."
            ),
            "lifecycle": lifecycle,
            "goals": goals,
        },
        "available_resources": available_resources,
        "self_harness_changes": changes,
        "chains": chains,
        "independent_assessments": {
            "research_connection": research_connection,
            "loop_integrity": loop_integrity,
            "execution_condition_effect": execution_condition_effect,
            "harness_improvement": "not_established",
        },
        "canonical_sources": {
            "capability_catalog": "capability-catalog.json",
            "task_resource_catalog": "task-resource-catalog.json",
            "artifact_contract": "artifact-contract.json",
            "execution_observations": "execution-observations.jsonl",
            "research_goals_and_findings": "research-resources.jsonl (append-only versioned snapshots)",
            "harness_decisions": "harness-decisions.jsonl",
            "harness_observations": "harness-observations.jsonl",
            "effect_assessments": "effect-assessments.jsonl",
        },
        "record_issues": record_issues,
        "deduplication": "compact_projection_only; canonical records and full trace are not duplicated",
    }


def _separate_outcomes(
    native: PiOfficeBenchRun,
    evaluation: dict[str, Any],
    task_correctness: dict[str, Any],
    loop_integrity: dict[str, Any],
    research_connection: dict[str, Any],
    execution_condition_effect: dict[str, Any],
    research_lifecycle: dict[str, Any],
) -> dict[str, Any]:
    mutation = _mutation_evidence(native)
    surface = mutation["execution_surface"]
    actual_changes = mutation["actual_changes"] + surface["actual_changes"]
    later_observed = mutation["context_hook_observed"] or surface["observed_next_request"]
    if actual_changes == 0:
        adjustment_status = "not_changed"
    elif later_observed:
        adjustment_status = "changed_and_later_observed"
    else:
        adjustment_status = "changed_not_yet_observed"
    return {
        "task_execution": {
            "status": "succeeded" if native.agent_succeeded else "failed",
            "agent_error": native.agent_error or None,
        },
        "evaluator": {
            "score": float(evaluation.get("score", 0.0)),
            "passed": bool(evaluation.get("is_pass", False)),
        },
        "task_correctness": task_correctness,
        "research_connection": research_connection,
        "research_lifecycle": research_lifecycle,
        "loop_integrity": loop_integrity,
        "execution_condition_effect": execution_condition_effect,
        "harness_adjustment": {
            "status": adjustment_status,
            "actual_changes": actual_changes,
            "later_execution_observed_change": later_observed,
        },
        "harness_improvement": {"status": "not_established"},
    }


def run_officebench_e2e(
    root: Path,
    *,
    case_id: str | None = "1-2-0",
    paths: ProjectPaths | None = None,
    pi_runner: Callable[[Path, Path, str, ProjectPaths], PiOfficeBenchRun] = run_pi_officebench_task,
) -> OfficeBenchE2EResult:
    paths = paths or ProjectPaths.from_environment()
    paths.assert_isolated()
    root = root.resolve()
    runs = paths.runs_dir.resolve()
    if runs != root and runs not in root.parents:
        raise ValueError("end-to-end output must stay inside the project runs directory")
    if root.exists() and any(root.iterdir()):
        raise ValueError("end-to-end output must be an empty directory; use a new run root")
    root.mkdir(parents=True, exist_ok=True)

    adapter, item, task = _prepare_real_case(paths, root, case_id)
    workspace = Path(item["_workspace"])
    testbed = Path(item.get("_testbed_dir") or workspace / "testbed")
    artifact_contract = _officebench_artifact_contract()
    _write_json(root / "artifact-contract.json", artifact_contract)
    task_resource_catalog = _build_task_resource_catalog(
        testbed, str(item.get("question") or task), artifact_contract,
    )
    _write_json(root / "task-resource-catalog.json", task_resource_catalog)
    required_paths = _evaluator_required_paths(item, testbed)
    targets_before = _target_manifest(testbed, required_paths)
    _write_json(root / "evaluator-targets-before.json", targets_before)
    native = pi_runner(root, workspace, task, paths)
    targets_after = _target_manifest(testbed, required_paths)
    _write_json(root / "evaluator-targets-after.json", targets_after)

    evaluation = adapter.evaluate(native.answer, item.get("answer", ""), item=item)
    _write_json(root / "jit-evaluation.json", evaluation)
    _write_json(root / "task-result.json", {"answer": native.answer, "model": native.model})
    score = float(evaluation.get("score", 0.0))
    evaluator_passed = bool(evaluation.get("is_pass", False))
    passed = evaluator_passed and native.agent_succeeded
    task_correctness = _task_correctness_assessment(required_paths, targets_before, targets_after)
    loop_integrity = _loop_integrity(root)
    research_connection = _research_connection(root)
    execution_condition_effect = _execution_condition_effect(root)
    research_lifecycle = _research_lifecycle(root)
    task_resource_boundary = _task_resource_boundary_assessment(root)
    outcomes = _separate_outcomes(
        native, evaluation, task_correctness, loop_integrity, research_connection,
        execution_condition_effect, research_lifecycle,
    )
    closed_loop_evidence = _closed_loop_evidence(
        root, native, research_connection, loop_integrity, execution_condition_effect,
    )
    execution_efficiency = _execution_efficiency(root, native)
    auto, harness, hierarchy = _render_handoffs(root, native, item, evaluation, outcomes)
    tool_names = [event.get("toolName", "") for event in native.events if event.get("type") == "tool_execution_start"]
    summary = root / "summary.json"
    _write_json(summary, {
        "status": "passed" if passed else "failed",
        "pipeline": "pi-native-officebench-e2e",
        "case_id": item.get("question_id"),
        "question": item.get("question"),
        "execution_model": native.model,
        "pi_version": native.pi_version,
        "pi_native_mutation": _mutation_evidence(native),
        "outcomes": outcomes,
        "closed_loop_evidence": closed_loop_evidence,
        "task_resource_boundary": task_resource_boundary,
        "execution_efficiency": execution_efficiency,
        "artifact_contract": {
            "format": artifact_contract.get("format"),
            "path": str(root / "artifact-contract.json"),
            "task_workspace": artifact_contract.get("scope", {}).get("task_workspace"),
            "initial_disclosure": "task-resource-catalog.json",
            "on_demand_resource": None,
            "task_resource_catalog": str(root / "task-resource-catalog.json"),
            "action_count": len(artifact_contract.get("actions", {})),
        },
        "research_notes": {
            "status": "agent_authored_unverified" if (root / "task-notes.md").is_file() else "not_recorded",
            "path": str(root / "task-notes.md") if (root / "task-notes.md").is_file() else None,
        },
        "research_resources": {
            "status": "agent_authored_unverified" if (root / "research-resources.jsonl").is_file() else "not_recorded",
            "path": str(root / "research-resources.jsonl") if (root / "research-resources.jsonl").is_file() else None,
        },
        "research_loop": loop_integrity,
        "research_lifecycle": research_lifecycle,
        "research_connection": research_connection,
        "execution_condition_effect": execution_condition_effect,
        "harness_improvement": "not_established",
        "tool_sequence": tool_names,
        "pi_agent_succeeded": native.agent_succeeded,
        "pi_agent_error": native.agent_error,
        "evaluator": "D:\\JIT OfficeBench deterministic evaluator",
        "score": score,
        "evaluator_passed": evaluator_passed,
        "passed": passed,
        "output_testbed_dir": evaluation.get("output_testbed_dir", ""),
        "handoffs": [str(auto), str(harness)],
        "round_hierarchy": str(hierarchy),
        "limitations": [
            "This is one OfficeBench case, not a full benchmark run.",
            "Direct JIT OfficeBench tools invoke one backend action per Pi call; optional non-atomic calendar and templated-email batch tools can invoke multiple writes and preserve per-item results.",
            "One successful model choice does not establish a generally improving self-harness policy.",
            "Agent notes are claims, not proof of a research loop or causal improvement.",
            "Evaluator pass is the JIT check result, not independent semantic verification of every answer.",
            "The mutation is task-local and is not persisted into another independent task.",
        ],
    })
    return OfficeBenchE2EResult(root, str(item.get("question_id")), score, passed, summary, auto, harness, hierarchy)


def _officebench_case_ids(paths: ProjectPaths, max_samples: int) -> list[str]:
    if max_samples < 1:
        raise ValueError("max_samples must be at least 1")
    dataset = paths.jit_root / "dataset" / "officebench" / "data.jsonl"
    case_ids: list[str] = []
    with dataset.open(encoding="utf-8") as stream:
        for line in stream:
            if len(case_ids) >= max_samples:
                break
            item = json.loads(line)
            case_id = str(item.get("question_id", "")).strip()
            if case_id:
                case_ids.append(case_id)
    if not case_ids:
        raise RuntimeError(f"no OfficeBench cases found in {dataset}")
    return case_ids


def run_officebench_e2e_batch(
    root: Path,
    *,
    max_samples: int,
    paths: ProjectPaths | None = None,
    case_runner: Callable[..., OfficeBenchE2EResult] = run_officebench_e2e,
) -> OfficeBenchE2EBatchResult:
    """Run independent Pi tasks over the first N real OfficeBench cases."""
    paths = paths or ProjectPaths.from_environment()
    paths.assert_isolated()
    root = root.resolve()
    runs = paths.runs_dir.resolve()
    if runs != root and runs not in root.parents:
        raise ValueError("end-to-end output must stay inside the project runs directory")
    if root.exists() and any(root.iterdir()):
        raise ValueError("batch output must be an empty directory; use a new run root")
    root.mkdir(parents=True, exist_ok=True)

    case_ids = _officebench_case_ids(paths, max_samples)
    records: list[dict[str, Any]] = []
    for case_id in case_ids:
        case_root = root / case_id
        try:
            result = case_runner(case_root, case_id=case_id, paths=paths)
            case_summary = json.loads(result.summary.read_text(encoding="utf-8"))
            records.append({
                "case_id": case_id,
                "status": case_summary.get("status", "passed" if result.passed else "failed"),
                "score": float(result.score),
                "passed": bool(result.passed),
                "pi_agent_succeeded": case_summary.get("pi_agent_succeeded"),
                "evaluator_passed": case_summary.get("evaluator_passed"),
                "summary": str(result.summary),
            })
        except Exception as exc:  # keep the remaining independent cases runnable
            error_path = case_root / "runner-error.json"
            _write_json(error_path, {
                "case_id": case_id,
                "error_type": type(exc).__name__,
                "error": str(exc),
            })
            records.append({
                "case_id": case_id,
                "status": "error",
                "score": 0.0,
                "passed": False,
                "error": str(exc),
                "summary": str(error_path),
            })

    passed_cases = sum(bool(record["passed"]) for record in records)
    failed_cases = len(records) - passed_cases
    summary = root / "summary.json"
    _write_json(summary, {
        "status": "passed" if failed_cases == 0 else "failed",
        "pipeline": "pi-native-officebench-e2e-batch",
        "requested_max_samples": max_samples,
        "total_cases": len(records),
        "passed_cases": passed_cases,
        "failed_cases": failed_cases,
        "average_score": sum(float(record["score"]) for record in records) / len(records),
        "cases": records,
        "isolation": "each case used a separate Pi process and fresh OfficeBench workspace",
    })
    return OfficeBenchE2EBatchResult(root, len(records), passed_cases, failed_cases, summary)
