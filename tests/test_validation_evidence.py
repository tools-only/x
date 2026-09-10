from __future__ import annotations

import copy
import json

import pytest

from autoresearch_pi.validation_evidence import (
    aggregate_validation_evidence,
    load_validation_manifest,
    project_pair_evidence,
    validation_manifest_fingerprint,
)


def _pair(treatment: dict, control: dict, **delta: int | float) -> dict:
    return {
        "variants": {"treatment": treatment, "control": control},
        "observed_delta": delta,
    }


def test_future_work_projection_requires_correctness_gated_mediator_chain():
    """Catches treating an apply call or evaluator pass alone as positive harness evidence."""
    pair = _pair(
        {
            "passed": True,
            "finding_count": 1,
            "decision_count": 1,
            "applied_decision_count": 1,
            "correctness_gated_effect": "supported",
            "research_lifecycle": "closed",
        },
        {"passed": True},
        model_turns=1,
        backend_bridge_processes=-11,
    )
    original = copy.deepcopy(pair)

    evidence = project_pair_evidence(
        {
            "stratum": "future_independent_work",
            "hypothesis": "apply_if_supported",
        },
        pair,
    )

    assert evidence == {
        "stratum": "future_independent_work",
        "hypothesis": "apply_if_supported",
        "correctness_gate": {
            "status": "both_passed",
            "control_passed": True,
            "treatment_passed": True,
        },
        "agent_posture": "apply",
        "mediator_chain": "research_lifecycle_closed",
        "effect": "supported",
        "paired_cost_delta": {
            "model_turns": 1,
            "backend_bridge_processes": -11,
        },
        "hypothesis_consistency": "supported",
        "harness_improvement": "not_established",
        "causal_claim": "not_automatically_established",
    }
    assert pair == original


@pytest.mark.parametrize("stratum", ["low_next_request_benefit", "feedback_dependent"])
def test_correct_no_change_is_visible_without_manufacturing_research_failure(stratum):
    """Catches scoring a valid no-research/no-mutation outcome as failed uptake."""
    evidence = project_pair_evidence(
        {"stratum": stratum, "hypothesis": "no_change_is_valid"},
        _pair(
            {
                "passed": True,
                "finding_count": 0,
                "decision_count": 0,
                "applied_decision_count": 0,
                "correctness_gated_effect": "not_attempted",
            },
            {"passed": True},
            model_turns=0,
            backend_bridge_processes=0,
        ),
    )

    assert evidence["correctness_gate"]["status"] == "both_passed"
    assert evidence["agent_posture"] == "no_change"
    assert evidence["mediator_chain"] == "not_attempted"
    assert evidence["effect"] == "not_attempted"
    assert evidence["hypothesis_consistency"] == "supported"


def test_projection_separates_finding_keep_apply_and_failed_correctness():
    """Catches collapsing distinct Agent decisions into a single research-used boolean."""
    finding_only = project_pair_evidence(
        {"stratum": "future_independent_work", "hypothesis": "apply_if_supported"},
        _pair(
            {"passed": True, "finding_count": 1, "decision_count": 0, "applied_decision_count": 0},
            {"passed": True},
        ),
    )
    kept = project_pair_evidence(
        {"stratum": "low_next_request_benefit", "hypothesis": "no_change_is_valid"},
        _pair(
            {"passed": True, "finding_count": 1, "decision_count": 1, "applied_decision_count": 0},
            {"passed": True},
        ),
    )
    correctness_failed = project_pair_evidence(
        {"stratum": "future_independent_work", "hypothesis": "apply_if_supported"},
        _pair(
            {
                "passed": False,
                "finding_count": 1,
                "decision_count": 1,
                "applied_decision_count": 1,
                "correctness_gated_effect": "observed_but_correctness_failed",
            },
            {"passed": True},
        ),
    )

    assert (finding_only["agent_posture"], finding_only["mediator_chain"]) == (
        "finding_only", "finding_without_decision",
    )
    assert (kept["agent_posture"], kept["mediator_chain"]) == (
        "keep", "decision_without_apply",
    )
    assert kept["hypothesis_consistency"] == "supported"
    assert correctness_failed["correctness_gate"]["status"] == "treatment_failed"
    assert correctness_failed["hypothesis_consistency"] == "contradicted"


def test_aggregate_counts_evidence_without_promoting_harness_improvement():
    """Catches aggregate success silently becoming a general improvement claim."""
    records = [
        project_pair_evidence(
            {"stratum": "future_independent_work", "hypothesis": "apply_if_supported"},
            _pair(
                {
                    "passed": True,
                    "finding_count": 1,
                    "decision_count": 1,
                    "applied_decision_count": 1,
                    "correctness_gated_effect": "supported",
                },
                {"passed": True},
                model_turns=1,
                backend_bridge_processes=-5,
            ),
        ),
        project_pair_evidence(
            {"stratum": "feedback_dependent", "hypothesis": "no_change_is_valid"},
            _pair(
                {"passed": True, "finding_count": 0, "decision_count": 0, "applied_decision_count": 0},
                {"passed": True},
                model_turns=-1,
                backend_bridge_processes=0,
            ),
        ),
    ]

    aggregate = aggregate_validation_evidence(records)

    assert aggregate["pair_count"] == 2
    assert aggregate["both_passed_pairs"] == 2
    assert aggregate["agent_postures"] == {"apply": 1, "no_change": 1}
    assert aggregate["hypothesis_consistency"] == {"supported": 2}
    assert aggregate["average_paired_cost_delta"] == {
        "model_turns": 0.0,
        "backend_bridge_processes": -2.5,
    }
    assert aggregate["harness_improvement"] == "not_established"
    assert aggregate["causal_claim"] == "not_automatically_established"


@pytest.mark.parametrize(
    "stratum",
    [
        {"stratum": "unknown", "hypothesis": "apply_if_supported"},
        {"stratum": "future_independent_work", "hypothesis": "always_apply"},
    ],
)
def test_projection_rejects_unknown_runner_only_labels(stratum):
    """Catches silently accepting labels that could encode a hidden controller policy."""
    with pytest.raises(ValueError):
        project_pair_evidence(stratum, _pair({"passed": True}, {"passed": True}))


def test_projection_contains_no_control_plane_fields():
    """Catches evaluator output growing into an Agent instruction or mutation request."""
    evidence = project_pair_evidence(
        {"stratum": "low_next_request_benefit", "hypothesis": "no_change_is_valid"},
        _pair({"passed": True}, {"passed": True}),
    )
    serialized_keys = set(evidence)
    assert serialized_keys.isdisjoint({"recommendation", "next_action", "apply", "rollback", "schedule"})


def test_hidden_manifest_loader_accepts_only_bounded_runner_labels(tmp_path):
    """Catches arbitrary manifest data becoming a task-specific controller channel."""
    path = tmp_path / "validation.json"
    path.write_text(json.dumps({
        "format": "constitutional-validation-v1",
        "cases": {
            "officebench:2-13-0": {
                "stratum": "low_next_request_benefit",
                "hypothesis": "no_change_is_valid",
            },
            "shopping:3:2": {
                "stratum": "feedback_dependent",
                "hypothesis": "no_change_is_valid",
            },
        },
    }), encoding="utf-8")

    manifest = load_validation_manifest(path)

    assert manifest == {
        "officebench:2-13-0": {
            "stratum": "low_next_request_benefit",
            "hypothesis": "no_change_is_valid",
        },
        "shopping:3:2": {
            "stratum": "feedback_dependent",
            "hypothesis": "no_change_is_valid",
        },
    }
    assert len(validation_manifest_fingerprint(manifest)) == 64

    path.write_text(json.dumps({
        "format": "constitutional-validation-v1",
        "cases": {"officebench:2-13-0": {
            "stratum": "low_next_request_benefit",
            "hypothesis": "no_change_is_valid",
            "recommendation": "apply calendar_batch",
        }},
    }), encoding="utf-8")
    with pytest.raises(ValueError, match="exactly stratum and hypothesis"):
        load_validation_manifest(path)
