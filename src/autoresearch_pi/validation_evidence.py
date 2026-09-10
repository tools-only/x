"""Offline-only evidence projection for completed benchmark pairs."""

from __future__ import annotations

from collections import Counter
from collections.abc import Sequence
import hashlib
import json
from pathlib import Path
from typing import Any


_STRATA = {
    "future_independent_work",
    "low_next_request_benefit",
    "feedback_dependent",
}
_HYPOTHESES = {"apply_if_supported", "no_change_is_valid"}


def load_validation_manifest(path: Path) -> dict[str, dict[str, str]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or set(payload) != {"format", "cases"}:
        raise ValueError("validation manifest must contain only format and cases")
    if payload.get("format") != "constitutional-validation-v1":
        raise ValueError("unsupported validation manifest format")
    cases = payload.get("cases")
    if not isinstance(cases, dict) or not cases:
        raise ValueError("validation manifest cases must be a non-empty object")
    validated: dict[str, dict[str, str]] = {}
    for case_key, labels in cases.items():
        if not isinstance(case_key, str) or not case_key.startswith(("officebench:", "shopping:")):
            raise ValueError("validation case keys must identify officebench or shopping")
        if not isinstance(labels, dict) or set(labels) != {"stratum", "hypothesis"}:
            raise ValueError("validation labels must contain exactly stratum and hypothesis")
        stratum = str(labels.get("stratum", ""))
        hypothesis = str(labels.get("hypothesis", ""))
        if stratum not in _STRATA:
            raise ValueError(f"unsupported validation stratum: {stratum or '<missing>'}")
        if hypothesis not in _HYPOTHESES:
            raise ValueError(f"unsupported validation hypothesis: {hypothesis or '<missing>'}")
        validated[case_key] = {"stratum": stratum, "hypothesis": hypothesis}
    return validated


def validation_manifest_fingerprint(manifest: dict[str, dict[str, str]]) -> str:
    canonical = json.dumps(manifest, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _count(record: dict[str, Any], key: str) -> int:
    value = record.get(key, 0)
    return int(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else 0


def _agent_posture(treatment: dict[str, Any]) -> str:
    applied = _count(treatment, "applied_decision_count")
    decisions = _count(treatment, "decision_count")
    findings = _count(treatment, "finding_count")
    if applied:
        return "apply"
    if decisions:
        return "keep"
    if findings:
        return "finding_only"
    return "no_change"


def _mediator_chain(treatment: dict[str, Any], posture: str, effect: str) -> str:
    if posture == "apply":
        lifecycle = str(treatment.get("research_lifecycle", ""))
        if effect == "supported" and lifecycle in {"closed", "research_lifecycle_closed"}:
            return "research_lifecycle_closed"
        if effect == "supported":
            return "effect_supported_pending_research_update"
        if effect == "contradicted":
            return "applied_effect_contradicted"
        return "applied_without_supported_effect"
    if posture == "keep":
        return "decision_without_apply"
    if posture == "finding_only":
        return "finding_without_decision"
    return "not_attempted"


def _hypothesis_consistency(
    hypothesis: str,
    *,
    treatment_passed: bool,
    posture: str,
    effect: str,
) -> str:
    if not treatment_passed:
        return "contradicted"
    if hypothesis == "apply_if_supported":
        if posture == "apply" and effect == "supported":
            return "supported"
        if posture == "apply" and effect in {"contradicted", "observed_but_correctness_failed"}:
            return "contradicted"
        return "not_observed"
    if posture in {"no_change", "keep"}:
        return "supported"
    if posture == "apply" and effect == "contradicted":
        return "contradicted"
    return "inconclusive"


def project_pair_evidence(
    stratum: dict[str, str], pair: dict[str, Any],
) -> dict[str, Any]:
    stratum_name = str(stratum.get("stratum", ""))
    hypothesis = str(stratum.get("hypothesis", ""))
    if stratum_name not in _STRATA:
        raise ValueError(f"unsupported validation stratum: {stratum_name or '<missing>'}")
    if hypothesis not in _HYPOTHESES:
        raise ValueError(f"unsupported validation hypothesis: {hypothesis or '<missing>'}")
    variants = pair.get("variants")
    if not isinstance(variants, dict):
        raise ValueError("pair variants are required")
    treatment = variants.get("treatment")
    control = variants.get("control")
    if not isinstance(treatment, dict) or not isinstance(control, dict):
        raise ValueError("pair must contain control and treatment variants")
    treatment_passed = bool(treatment.get("passed"))
    control_passed = bool(control.get("passed"))
    correctness_status = (
        "both_passed" if treatment_passed and control_passed
        else "treatment_failed" if control_passed
        else "control_failed" if treatment_passed
        else "both_failed"
    )
    posture = _agent_posture(treatment)
    effect = str(treatment.get("correctness_gated_effect", "not_attempted"))
    delta = pair.get("observed_delta")
    delta = delta if isinstance(delta, dict) else {}
    costs = {
        key: value if isinstance(value, (int, float)) and not isinstance(value, bool) else None
        for key in ("model_turns", "backend_bridge_processes")
        for value in [delta.get(key)]
    }
    return {
        "stratum": stratum_name,
        "hypothesis": hypothesis,
        "correctness_gate": {
            "status": correctness_status,
            "control_passed": control_passed,
            "treatment_passed": treatment_passed,
        },
        "agent_posture": posture,
        "mediator_chain": _mediator_chain(treatment, posture, effect),
        "effect": effect,
        "paired_cost_delta": costs,
        "hypothesis_consistency": _hypothesis_consistency(
            hypothesis,
            treatment_passed=treatment_passed,
            posture=posture,
            effect=effect,
        ),
        "harness_improvement": "not_established",
        "causal_claim": "not_automatically_established",
    }


def aggregate_validation_evidence(
    records: Sequence[dict[str, Any]],
) -> dict[str, Any]:
    posture_counts = Counter(str(record.get("agent_posture", "unavailable")) for record in records)
    consistency_counts = Counter(
        str(record.get("hypothesis_consistency", "unavailable")) for record in records
    )

    def average_delta(key: str) -> float | None:
        values = [
            record.get("paired_cost_delta", {}).get(key)
            for record in records
            if isinstance(record.get("paired_cost_delta"), dict)
        ]
        numeric = [
            float(value) for value in values
            if isinstance(value, (int, float)) and not isinstance(value, bool)
        ]
        return sum(numeric) / len(numeric) if numeric else None

    return {
        "pair_count": len(records),
        "both_passed_pairs": sum(
            record.get("correctness_gate", {}).get("status") == "both_passed"
            for record in records
            if isinstance(record.get("correctness_gate"), dict)
        ),
        "agent_postures": dict(posture_counts),
        "hypothesis_consistency": dict(consistency_counts),
        "average_paired_cost_delta": {
            "model_turns": average_delta("model_turns"),
            "backend_bridge_processes": average_delta("backend_bridge_processes"),
        },
        "harness_improvement": "not_established",
        "causal_claim": "not_automatically_established",
    }
