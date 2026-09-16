from autoresearch_pi.research_evidence import project_research_evidence


def test_research_projection_reports_links_without_claiming_improvement():
    findings = [
        {
            "finding_id": "finding-1", "goal_id": "research-goal-1", "version": 1,
            "status": "active", "question": "parent",
        },
        {
            "finding_id": "finding-2", "goal_id": "research-goal-2", "version": 1,
            "status": "open", "question": "child", "parent_goal_id": "research-goal-1",
        },
        {
            "finding_id": "finding-2", "goal_id": "research-goal-2", "version": 2,
            "status": "active", "question": "child", "parent_goal_id": "research-goal-1",
            "depends_on": ["finding-1@v1"],
            "pattern_candidate_refs": ["pattern-candidate-1"],
            "used_in_observation_refs": ["execution-observation-4"],
        },
        {
            "finding_id": "finding-1", "goal_id": "research-goal-1", "version": 2,
            "status": "active", "question": "parent revised",
        },
    ]
    result = project_research_evidence(
        findings=findings,
        execution_signals=[{"signal_id": "execution-signal-1"}],
        pattern_candidates=[
            {"candidate_id": "pattern-candidate-1", "version": 1, "kind": "outcome_contrast"}
        ],
    )

    assert result["finding_versions"] == 4
    assert result["latest_resource_count"] == 2
    assert result["execution_use_link_count"] == 1
    assert result["pattern_candidate_acceptance_count"] == 1
    assert result["research_graph"] == {
        "node_count": 2,
        "parent_edge_count": 1,
        "dependency_edge_count": 1,
        "changed_dependencies": [{
            "dependent_finding_id": "finding-2",
            "dependency_ref": "finding-1@v1",
            "current_version": 2,
        }],
    }
    assert result["harness_improved"] is None


def test_research_projection_connects_research_basis_to_native_harness_effects():
    result = project_research_evidence(
        findings=[{
            "finding_id": "finding-1", "goal_id": "research-goal-1", "version": 2,
            "status": "active", "question": "Which method should change?",
        }],
        execution_signals=[],
        pattern_candidates=[],
        harness_decisions=[{
            "decision_id": "decision-1", "intervention": "task_system_prompt_context",
            "basis_resource_ids": ["finding-1@v2"],
        }, {
            "decision_id": "decision-2", "intervention": "active_tool_set",
            "basis_resource_ids": [],
        }],
        harness_observations=[{
            "observation_id": "system-prompt-exposure-decision-1",
            "decision_id": "decision-1", "effect_observed": True,
        }],
        effect_assessments=[{
            "effect_assessment_id": "effect-assessment-1",
            "decision_id": "decision-1", "verdict": "supported",
        }],
    )

    assert result["application_graph"] == {
        "decision_count": 2,
        "research_linked_decision_count": 1,
        "native_exposure_link_count": 1,
        "effect_assessment_link_count": 1,
        "paths": [{
            "decision_id": "decision-1",
            "intervention": "task_system_prompt_context",
            "research_basis_refs": ["finding-1@v2"],
            "native_observation_refs": ["system-prompt-exposure-decision-1"],
            "effect_assessment_refs": ["effect-assessment-1"],
            "latest_effect_assessment": {
                "effect_assessment_id": "effect-assessment-1",
                "verdict": "supported",
                "observation_refs": [],
            },
            "stage": "agent_assessed",
        }],
    }


def test_research_projection_separates_effect_history_from_latest_verdict():
    result = project_research_evidence(
        findings=[{
            "finding_id": "finding-1", "goal_id": "research-goal-1", "version": 1,
            "status": "active", "question": "Should the task system prompt change?",
        }],
        execution_signals=[],
        pattern_candidates=[],
        harness_decisions=[{
            "decision_id": "decision-1", "intervention": "task_system_prompt_context",
            "basis_resource_ids": ["finding-1@v1"],
        }],
        harness_observations=[{
            "observation_id": "system-prompt-exposure-decision-1",
            "decision_id": "decision-1", "effect_observed": True,
        }],
        effect_assessments=[{
            "effect_assessment_id": "effect-assessment-1",
            "decision_id": "decision-1", "verdict": "supported",
            "observation_refs": ["execution-observation-2"],
        }, {
            "effect_assessment_id": "effect-assessment-2",
            "decision_id": "decision-1", "verdict": "unsupported",
            "observation_refs": ["execution-observation-3"],
        }],
    )

    path = result["application_graph"]["paths"][0]
    assert path["effect_assessment_refs"] == [
        "effect-assessment-1", "effect-assessment-2",
    ]
    assert path["latest_effect_assessment"] == {
        "effect_assessment_id": "effect-assessment-2",
        "verdict": "unsupported",
        "observation_refs": ["execution-observation-3"],
    }


def test_versioned_pattern_candidate_can_be_a_snapshotted_decision_basis():
    result = project_research_evidence(
        findings=[],
        execution_signals=[],
        pattern_candidates=[{
            "candidate_id": "pattern-candidate-1", "version": 2,
            "kind": "outcome_contrast",
        }],
        harness_decisions=[{
            "decision_id": "decision-1", "intervention": "task_memory_context",
            "basis_resource_ids": ["pattern-candidate-1@v2"],
        }],
    )

    assert result["application_graph"]["research_linked_decision_count"] == 1
    assert result["application_graph"]["paths"][0]["research_basis_refs"] == [
        "pattern-candidate-1@v2",
    ]
