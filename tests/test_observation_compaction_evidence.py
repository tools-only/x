from autoresearch_pi.observation_compaction_evidence import audit_observation_compaction_effects


def _valid_records():
	marker = (
		"[Task-local observation shopping-observation-1 compacted by finding-1@v1; "
		"the complete result remains in execution-observations.jsonl and is recoverable by exact ID.]"
	)
	full_one = "A" * 300
	full_two = "B" * 250
	observations = [
		{"event_id": "shopping-observation-1", "result": "canonical one"},
		{"event_id": "shopping-observation-2", "result": "canonical two"},
	]
	findings = [{
		"finding_id": "finding-1", "goal_id": "research-goal-1", "version": 1,
		"research_event_id": "research-event-1", "evidence_refs": ["shopping-observation-1"],
	}]
	decisions = [{
		"decision_id": "decision-1", "toolCallId": "compact-call", "applied": True,
		"effect_metric": "model_visible_observation_chars_removed",
		"basis_resource_ids": ["finding-1"],
		"basis_snapshots": [{"finding_id": "finding-1", "version": 1}],
		"operation": {"capability": "pi.context", "observation_ids": ["shopping-observation-1"]},
	}]
	exposures = [{
		"decision_id": "decision-1", "toolCallId": "compact-call", "effect_observed": True,
		"basis_resource_ids": ["finding-1"],
		"operation": {"capability": "pi.context", "value": "exact_observation_reference", "observation_ids": ["shopping-observation-1"]},
	}]
	assessments = [{
		"effect_assessment_id": "effect-assessment-1", "decision_id": "decision-1",
		"toolCallId": "compact-call", "effect_metric": "model_visible_observation_chars_removed",
		"verdict": "supported", "window": {
			"observation_ids": ["shopping-observation-1"],
			"matched_observation_ids": ["shopping-observation-1"],
			"original_chars": 300, "replacement_chars": len(marker),
			"removed_chars": 300 - len(marker), "boundary": "next_model_request",
		},
	}]
	contexts = [
		{"request": 2, "context": {"messages": [
			{"role": "toolResult", "details": {"observation": {"event_id": "shopping-observation-1"}}, "content": [{"type": "text", "text": full_one}]},
			{"role": "toolResult", "details": {"observation": {"event_id": "shopping-observation-2"}}, "content": [{"type": "text", "text": full_two}]},
		]}},
		{"request": 4, "context": {"messages": [
			{"role": "toolResult", "details": {"observation": {"event_id": "shopping-observation-1"}}, "content": [{"type": "text", "text": marker}]},
			{"role": "toolResult", "details": {"observation": {"event_id": "shopping-observation-2"}}, "content": [{"type": "text", "text": full_two}]},
		]}},
	]
	return observations, findings, decisions, exposures, assessments, contexts


def test_compaction_audit_recomputes_exact_post_exposure_reduction():
	"""Catches a context effect being trusted without matching provider-request evidence."""
	records = _valid_records()

	supported, issues = audit_observation_compaction_effects(*records)

	assert [item["effect_assessment_id"] for item in supported] == ["effect-assessment-1"]
	assert issues == []


def test_compaction_audit_rejects_observation_not_cited_by_finding_snapshot():
	"""Catches a runtime-selected observation masquerading as an Agent-owned selection."""
	observations, findings, decisions, exposures, assessments, contexts = _valid_records()
	decisions[0]["operation"]["observation_ids"] = ["shopping-observation-2"]
	exposures[0]["operation"]["observation_ids"] = ["shopping-observation-2"]
	assessments[0]["window"]["observation_ids"] = ["shopping-observation-2"]

	supported, issues = audit_observation_compaction_effects(
		observations, findings, decisions, exposures, assessments, contexts,
	)

	assert supported == []
	assert "effect-assessment-1:observation_not_cited_by_finding" in issues


def test_compaction_audit_rejects_reported_character_count_mismatch():
	"""Catches a self-reported context reduction that differs from literal provider inputs."""
	observations, findings, decisions, exposures, assessments, contexts = _valid_records()
	assessments[0]["window"]["removed_chars"] += 1

	supported, issues = audit_observation_compaction_effects(
		observations, findings, decisions, exposures, assessments, contexts,
	)

	assert supported == []
	assert "effect-assessment-1:window_removed_chars_mismatch" in issues


def test_compaction_audit_recomputes_from_pi_events_when_provider_payload_is_not_logged():
	"""Catches real-run auditing depending on the offline provider fixture."""
	observations, findings, decisions, exposures, assessments, _ = _valid_records()
	pi_events = [{
		"type": "tool_execution_end",
		"toolCallId": "detail-call",
		"toolName": "get_product_details",
		"result": {
			"content": [{"type": "text", "text": "A" * 300}],
			"details": {"observation": {"event_id": "shopping-observation-1"}},
		},
	}]

	supported, issues = audit_observation_compaction_effects(
		observations, findings, decisions, exposures, assessments, [], pi_events=pi_events,
	)

	assert [item["effect_assessment_id"] for item in supported] == ["effect-assessment-1"]
	assert issues == []
