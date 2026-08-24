from __future__ import annotations

from typing import Any


PHASES = frozenset({"reconnaissance", "model_building", "intervention", "verification", "confirmation", "recovery"})
STATUSES = frozenset({"progressing", "blocked", "inconclusive", "completed"})
EXPLORATION_STRATEGIES = frozenset({"inspect", "reproduce", "probe", "diagnose", "implement", "verify", "recover"})
INFORMATION_STATES = frozenset({"task_structure", "interface", "dependency", "state", "failure_cause", "validation"})
OUTCOME_SIGNALS = frozenset({"command_succeeded", "command_failed", "test_passed", "test_failed", "environment_blocked", "partial_progress", "no_progress", "budget_limited"})
FAILURE_CLASSES = frozenset({"dependency", "configuration", "implementation", "test", "tool", "environment", "budget", "unknown"})
NEXT_STRATEGIES = frozenset({"inspect", "model", "intervene", "verify", "recover", "defer", "stop"})

PHASE_REPORT_PROPERTIES = {
    "phase": {"type": "string", "enum": sorted(PHASES)},
    "status": {"type": "string", "enum": sorted(STATUSES)},
    "observations": {"type": "array", "items": {"type": "string"}},
    "actions": {"type": "array", "items": {"type": "string"}},
    "failures": {"type": "array", "items": {"type": "string"}},
    "current_state": {"type": "string"},
    "evidence": {"type": "array", "items": {"type": "string"}},
    "recommended_next": {"type": "string"},
    "confidence": {"type": "number", "minimum": 0, "maximum": 1},
    "methodology": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "exploration_strategy": {"type": "string", "enum": sorted(EXPLORATION_STRATEGIES)},
            "information_states": {"type": "array", "items": {"type": "string", "enum": sorted(INFORMATION_STATES)}},
            "outcome_signals": {"type": "array", "items": {"type": "string", "enum": sorted(OUTCOME_SIGNALS)}},
            "failure_classes": {"type": "array", "items": {"type": "string", "enum": sorted(FAILURE_CLASSES)}},
            "next_strategy": {"type": "string", "enum": sorted(NEXT_STRATEGIES)},
        },
        "required": ["exploration_strategy", "information_states", "outcome_signals", "failure_classes", "next_strategy"],
    },
}
PHASE_REPORT_REQUIRED = list(PHASE_REPORT_PROPERTIES)


def validate_methodology(value: object, *, prefix: str = "methodology") -> None:
    if not isinstance(value, dict):
        raise ValueError(f"{prefix} must be an object")
    if value.get("exploration_strategy") not in EXPLORATION_STRATEGIES:
        raise ValueError(f"{prefix}.exploration_strategy is invalid")
    if value.get("next_strategy") not in NEXT_STRATEGIES:
        raise ValueError(f"{prefix}.next_strategy is invalid")
    for field, allowed in (
        ("information_states", INFORMATION_STATES),
        ("outcome_signals", OUTCOME_SIGNALS),
        ("failure_classes", FAILURE_CLASSES),
    ):
        entries = value.get(field)
        if not isinstance(entries, list) or not all(isinstance(item, str) and item in allowed for item in entries):
            raise ValueError(f"{prefix}.{field} is invalid")


def validate_phase_report(value: dict[str, Any]) -> None:
    required_strings = ("current_state", "recommended_next")
    required_lists = ("observations", "actions", "failures", "evidence")
    if value.get("phase") not in PHASES:
        raise ValueError("phase_report.phase must be a recognized phase")
    if value.get("status") not in STATUSES:
        raise ValueError("phase_report.status must be a recognized status")
    for field in required_strings:
        if not isinstance(value.get(field), str) or not value[field].strip():
            raise ValueError(f"phase_report.{field} must be a non-empty string")
    for field in required_lists:
        if not isinstance(value.get(field), list) or not all(isinstance(item, str) for item in value[field]):
            raise ValueError(f"phase_report.{field} must be a list of strings")
    confidence = value.get("confidence")
    if not isinstance(confidence, (int, float)) or not 0 <= confidence <= 1:
        raise ValueError("phase_report.confidence must be between 0 and 1")
    validate_methodology(value.get("methodology"), prefix="phase_report.methodology")


def meta_summary(report: dict[str, Any]) -> dict[str, Any]:
    """Expose task-agnostic methodology only; raw task evidence stays in artifacts."""
    methodology = report.get("methodology")
    if not isinstance(methodology, dict):
        return {"phase": "unknown", "status": "inconclusive", "methodology_available": False}
    return {
        "phase": report.get("phase"),
        "status": report.get("status"),
        "confidence": report.get("confidence"),
        "methodology": methodology,
        "observation_count": len(report.get("observations", [])),
        "action_count": len(report.get("actions", [])),
        "failure_count": len(report.get("failures", [])),
        "evidence_count": len(report.get("evidence", [])),
        "methodology_available": True,
    }
