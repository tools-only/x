"""Component/integration diagnostics only, not ARC self-harness closure acceptance."""
import json
from pathlib import Path
from test_pi_external_benchmark_native import _run_fixture
from test_task_research_context import records, results


def test_outcome_is_persisted_review_is_idempotent_and_lessons_are_exposed(tmp_path):
    report = dict(summary="Level completed", mechanisms="Fixture only", shortcomings="No causal evidence",
                  lessons="Verify on real environment", next_attempt="Test the rule again", credits=[],
                  success_path={"status":"insufficient_evidence", "scope":"fixture", "preconditions":[],
                      "steps":[], "success_check":"environment confirmed completion", "uncertainty":"No reusable rule",
                      "reuse_advice":"Do not reuse"})
    submit = {"name": "task_harness", "arguments": {"action": "level_review",
              "window_id": "level-outcome:execution-observation-1", "level_review": report}}
    outcome_cost_ref = "outcome_cost_index:level-outcome:execution-observation-1@v1"
    events = _run_fixture(tmp_path, "treatment", extra_env={"PI_HARNESS_PERIODIC_REVIEW": "disabled"},
        extra_extensions=[Path(__file__).parent / "pi_level_outcome_fixture.ts"],
        steps=[{"name":"arc_action","arguments":{}},
               {"name":"task_resource","arguments":{"action":"read","ref":outcome_cost_ref}}, submit, submit,
               {"name":"task_resource","arguments":{"action":"read","ref":"level_review:level-outcome:execution-observation-1@v1"}},
               {"name":"task_resource","arguments":{"action":"read","ref":outcome_cost_ref}}])
    observations = [json.loads(s) for s in (tmp_path / "execution-observations.jsonl").read_text().splitlines()]
    assert observations[0]["arc_outcome"]["levels_completed"] == 1
    rows = [json.loads(s) for s in (tmp_path / "task-level-reviews.jsonl").read_text().splitlines()]
    assert len(rows) == 1
    assert rows[0]["lessons"] == report["lessons"]
    returns = [e for e in events if e.get("type") == "tool_execution_end" and e.get("toolName") == "task_harness"]
    assert len(returns) == 2
    assert all(not e.get("isError") for e in returns)
    contexts = records(tmp_path, "provider-contexts.jsonl")
    projected_user_text = "\n".join(
        part.get("text", "")
        for row in contexts for message in row["context"]["messages"]
        if message.get("role") == "user"
        for part in message.get("content", []) if part.get("type") == "text"
    )
    assert "Pending whole-level windows" in projected_user_text
    assert "Previous level outcome index" in projected_user_text
    assert report["lessons"] in projected_user_text
    indexes = records(tmp_path, "task-outcome-cost-index.jsonl")
    assert len(indexes) == 1 and indexes[0]["window_id"] == rows[0]["window_id"]
    assert outcome_cost_ref in json.dumps(results(events, "task_resource"))
    pending_context = "\n".join(
        part.get("text", "") for row in contexts for message in row["context"]["messages"]
        if message.get("role") == "user"
        for part in message.get("content", []) if part.get("type") == "text"
    )
    assert '"outcome_cost_index_ref":"' + outcome_cost_ref + '"' in pending_context
    assert '"tool_call_count":' in pending_context
    assert '"tool_call_index":{' not in pending_context
    assert '"input_contract":' not in pending_context
    assert '"inspect_call":' in pending_context
    assert "FRESH LEVEL TRANSITION" in pending_context
    assert "current public observation" in pending_context
    assert "not an action gate" in pending_context


def test_level_review_full_contract_is_available_only_on_explicit_request(tmp_path):
    events = _run_fixture(tmp_path, "treatment", extra_env={"PI_HARNESS_PERIODIC_REVIEW": "disabled"},
        extra_extensions=[Path(__file__).parent / "pi_level_outcome_fixture.ts"],
        steps=[{"name": "arc_action", "arguments": {}},
               {"name": "task_harness", "arguments": {"action": "contract", "topic": "level_review",
                   "window_id": "level-outcome:execution-observation-1"}}])
    contract = json.loads(results(events, "task_harness")[0]["result"]["content"][0]["text"])
    assert contract["format"] == "arc-level-review-contract-v1"
    assert contract["input_contract"]["evidence_ref_candidates"] == ["execution-observation-1"]
    assert "success_path" in contract["guidance"]
    pending_cards = [part["text"] for row in records(tmp_path, "provider-contexts.jsonl")
                     for message in row["context"]["messages"]
                     for part in message.get("content", []) if part.get("type") == "text"
                     and part["text"].startswith("Pending whole-level windows")]
    assert pending_cards and all('"input_contract":' not in card for card in pending_cards)


def test_goal_gap_prompt_requires_parent_declared_operation_not_missing_component_kind(tmp_path):
    no_gap = tmp_path / "no-gap"
    _run_fixture(no_gap, "treatment", extra_env={"PI_HARNESS_PERIODIC_REVIEW": "disabled"}, steps=[
        {"name": "task_checkpoint", "arguments": {"action": "update",
            "task_goal": "Complete the current visible target.",
            "current_strategy": "Test the best-supported candidate from the live frame."}},
        {"name": "task_harness", "arguments": {"action": "inspect"}},
    ])
    no_gap_text = json.dumps(records(no_gap, "provider-contexts.jsonl"), ensure_ascii=False)
    assert "GOAL-DIRECTED CAPABILITY GAP" not in no_gap_text
    assert "PARENT-DECLARED OPERATION GAP" not in no_gap_text

    explicit_gap = tmp_path / "explicit-gap"
    _run_fixture(explicit_gap, "treatment", extra_env={"PI_HARNESS_PERIODIC_REVIEW": "disabled"}, steps=[
        {"name": "task_checkpoint", "arguments": {"action": "update",
            "task_goal": "Complete the current visible target.",
            "current_strategy": "Test the best-supported candidate from the live frame.",
            "planning_gap": "Repeated manual tile comparison is error-prone."}},
        {"name": "task_harness", "arguments": {"action": "inspect"}},
    ])
    gap_text = json.dumps(records(explicit_gap, "provider-contexts.jsonl"), ensure_ascii=False)
    assert "PARENT-DECLARED OPERATION GAP" in gap_text
    assert "Repeated manual tile comparison is error-prone." in gap_text
    assert "missing_carriers" not in gap_text


def test_testable_goal_model_prompts_parent_phase_reassessment_before_level_success(tmp_path):
    run = tmp_path / "testable-goal"
    _run_fixture(run, "treatment", extra_env={"PI_HARNESS_PERIODIC_REVIEW": "disabled"}, steps=[
        {"name": "task_checkpoint", "arguments": {"action": "update",
            "task_goal": "Complete the current visible target pattern.",
            "success_conditions": ["Public level counter increases"],
            "task_constraints": ["Only current public frame is authoritative"],
            "strategy_alternatives": ["Test the left tile", "Test the right tile"],
            "current_strategy": "Compare alternatives using one observable probe."}},
        {"name": "task_harness", "arguments": {"action": "inspect"}},
    ])
    text = json.dumps(records(run, "provider-contexts.jsonl"), ensure_ascii=False)
    assert "TESTABLE GOAL MODEL" in text
    assert "Public level counter increases" in text
    assert "Component choice remains with the parent" in text
    assert "consider a scoped planning System Prompt" not in text
    assert "FRESH LEVEL TRANSITION" not in text


def test_arc_action_validation_is_explicit_and_sequential_assessment_can_omit_version(tmp_path):
    events = _run_fixture(tmp_path, "treatment", extra_env={"PI_HARNESS_PERIODIC_REVIEW": "disabled"},
        extra_extensions=[Path(__file__).parent / "pi_level_outcome_fixture.ts"], steps=[
            {"name": "arc_action", "arguments": {"decision": {
                "hypothesis": "A local relation may hold", "prediction": "The next frame will change"}}},
            {"name": "arc_action", "arguments": {"decision": {
                "hypothesis_id": "tracked-relation", "hypothesis": "A stable relation may hold",
                "prediction": "The next frame will change"}}},
            {"name": "task_validation", "arguments": {"action": "assess", "validation_id": "validation-1",
                "verdict": "inconclusive", "explanation": "The visible outcome does not isolate the cause.",
                "evidence_refs": ["observation:execution-observation-2@v1"]}},
            {"name": "task_validation", "arguments": {"action": "assess", "validation_id": "validation-1",
                "target_version": 1, "verdict": "supported", "explanation": "Stale update must fail.",
                "evidence_refs": ["observation:execution-observation-2@v1"]}},
        ])
    validations = records(tmp_path, "task-validations.jsonl")
    assert [(row["source_hypothesis_id"], row["version"]) for row in validations] == [
        ("tracked-relation", 1), ("tracked-relation", 2)]
    outputs = results(events, "task_validation")
    assert not outputs[0].get("isError")
    assert outputs[1].get("isError") or '"applied":false' in json.dumps(outputs[1])


def test_level_review_accepts_parallel_points_as_string_arrays(tmp_path):
    report = dict(summary="Level completed", mechanisms=["Move", "Check"],
                  shortcomings=["One weak assumption"], lessons=["Retest"],
                  next_attempt=["Use the shorter route"], credits=[],
                  success_path={"status":"insufficient_evidence", "scope":"fixture", "preconditions":[],
                      "steps":[], "success_check":"environment confirmed completion", "uncertainty":"No reusable rule",
                      "reuse_advice":"Do not reuse"})
    events = _run_fixture(tmp_path, "treatment", extra_env={"PI_HARNESS_PERIODIC_REVIEW": "disabled"},
        extra_extensions=[Path(__file__).parent / "pi_level_outcome_fixture.ts"], steps=[
            {"name":"arc_action","arguments":{}},
            {"name":"task_harness","arguments":{"action":"level_review",
             "window_id":"level-outcome:execution-observation-1","level_review":report}}])
    assert not [e for e in events if e.get("type") == "tool_execution_end" and e.get("isError")]
    saved = json.loads((tmp_path / "task-level-reviews.jsonl").read_text().splitlines()[0])
    assert saved["mechanisms"] == "Move\nCheck"


def test_level_review_directly_drives_live_parent_authoring_without_trace_replay(tmp_path):
    report = dict(summary="Level completed", mechanisms="A visible rule predicted the outcome",
                  shortcomings="Manual comparison was repeated",
                  lessons="Compare the displayed target with current state before choosing an action",
                  next_attempt="Try the comparison again on a new layout", credits=[],
                  success_path={"status":"candidate", "scope":"rule shape, not board coordinates",
                      "preconditions":["Read the displayed target"],
                      "steps":[{"operation":"compare target with current state", "input_or_condition":"target is visible at (39,39)",
                          "output_or_check":"matching rule identified", "evidence_refs":["execution-observation-1"],
                          "role":"discovery"}], "success_check":"environment reports level completion",
                      "uncertainty":"Needs a second layout", "reuse_advice":"Test on a new layout before promotion"})
    first = _run_fixture(tmp_path, "treatment", extra_env={"PI_HARNESS_PERIODIC_REVIEW": "disabled"},
        extra_extensions=[Path(__file__).parent / "pi_level_outcome_fixture.ts"], steps=[
            {"name": "arc_action", "arguments": {}},
            {"name": "task_harness", "arguments": {"action": "level_review",
             "window_id": "level-outcome:execution-observation-1", "level_review": report}},
            {"name": "task_resource", "arguments": {"action": "read", "ref": "level_review:level-outcome:execution-observation-1@v1"}},
            {"name": "task_harness", "arguments": {"action": "read_method", "method_name": "skill-creator"}},
            {"name": "task_harness", "arguments": {"action": "change", "changes": [
                {"operation": "create", "candidate": {
                    "semantic_kind": "procedure", "execution": "text", "reuse": "expected_reuse",
                    "reasoning": "bounded_judgment", "name": "observation-bound-comparison",
                    "summary": "Compare current visible targets with current state and verify one predicted change.",
                    "content": "At each use, read the current observation and identify the currently visible target and state. "
                               "Derive the candidate comparison from those values; do not reuse past coordinates or identities. "
                               "Choose one bounded action, compare its predicted public result with the next observation, "
                               "and stop or revise the rule if the result differs.",
                    "scope": {"kind": "task_wide", "statement": "ARC reasoning for this live task"},
                    "context_visibility": "on_demand", "stability": "stable_in_scope",
                    "basis_refs": ["level_review:level-outcome:execution-observation-1@v1"],
                }},
                {"operation": "create", "candidate": {
                    "semantic_kind": "system_prompt", "name": "goal-directed-planning-policy",
                    "prompt_text": "The task goal and success conditions are becoming testable. Maintain an explicit working goal, "
                                   "constraints, candidate strategies and next falsifiable observation. Compare options using the current "
                                   "observation, update the plan when evidence changes, and continue one justified online action at a time.",
                    "scope": "Current ARC task planning phase",
                    "basis_refs": ["level_review:level-outcome:execution-observation-1@v1"],
                }},
            ], "decision": {"basis_refs": ["level_review:level-outcome:execution-observation-1@v1"],
                "reason": "Turn the review into a prospective method and task-level planning policy.",
                "expected": "Both use the live observation and the current goal model."}}},
            {"name": "task_harness", "arguments": {"action": "assemble", "expected_assembly_revision": 0,
                "selected_resource_refs": ["skill:observation-bound-comparison@v1",
                                           "system_prompt:goal-directed-planning-policy@v1"],
                "prompt_contributions": [],
                "decision": {"basis_refs": ["level_review:level-outcome:execution-observation-1@v1"],
                    "reason": "Select the exact review-derived method and planning policy.",
                    "expected": "The next online parent turn receives both selected versions."}}},
            {"name": "arc_action", "arguments": {}},
        ])
    assert not any(item.get("isError") for item in results(first, "task_harness"))
    assert not any(item.get("isError") for item in results(first, "task_resource"))
    level_ref = "level_review:level-outcome:execution-observation-1@v1"

    resumed = _run_fixture(tmp_path, "treatment", extra_env={"PI_HARNESS_PERIODIC_REVIEW": "disabled"},
        extra_extensions=[Path(__file__).parent / "pi_level_outcome_fixture.ts"], steps=[
            {"name": "task_resource", "arguments": {"action": "read", "ref": level_ref}},
            {"name": "task_harness", "arguments": {"action": "inspect"}},
            {"name": "arc_action", "arguments": {"decision": {
                "basis_refs": ["skill:observation-bound-comparison@v1",
                               "system_prompt:goal-directed-planning-policy@v1"],
                "hypothesis": "The current visible target is related to the current state by a rule that can be tested.",
                "prediction": "One bounded action will produce a public change consistent with the rule.",
                "falsifier": "The next observation does not show the predicted relation."}}},
        ])
    assert not any(item.get("isError") for item in results(resumed, "task_resource") + results(resumed, "task_harness"))
    assert report["lessons"] in json.dumps(results(resumed, "task_resource"))
    previous_context = "\n".join(
        part.get("text", "") for message in records(tmp_path, "provider-contexts.jsonl")[-1]["context"]["messages"]
        if message.get("role") == "user"
        for part in message.get("content", []) if part.get("type") == "text"
    )
    assert '"steps":[{"operation"' not in previous_context
    assert report["lessons"] in previous_context
    assert level_ref in previous_context
    assert "NOT executable instructions" in previous_context
    assert "rebind every state-dependent field from the current observation" in previous_context
    assert "(39,39)" not in previous_context
    inspected = json.loads(results(resumed, "task_harness")[-1]["result"]["content"][0]["text"])
    assert not any(item.get("opportunity_id", "").startswith("level-review:")
                   for item in inspected["capability_followups"])
    context = records(tmp_path, "provider-contexts.jsonl")[-1]["context"]
    assert "At each use, read the current observation" in json.dumps(context)
    assert "goal-directed-planning-policy" in json.dumps(context)
    assert "explicit working goal" in context["systemPrompt"]
    assert "(39,39)" not in json.dumps(inspected["latest_level_review"])
    archived_text = json.dumps(results(resumed, "task_resource"))
    assert "target is visible at (39,39)" in archived_text
    assert records(tmp_path, "task-skills.jsonl")[0]["basis_refs"] == [level_ref]
    assert records(tmp_path, "task-system-prompt.jsonl")[0]["basis_refs"] == [level_ref]
    assert records(tmp_path, "task-harness-assemblies.jsonl")[0]["selected_resource_refs"] == [
        "skill:observation-bound-comparison@v1", "system_prompt:goal-directed-planning-policy@v1"]
    assert records(tmp_path, "task-harness-change-receipts.jsonl")[-1]["status"] == "applied"
    action_observations = records(tmp_path, "execution-observations.jsonl")
    assert action_observations[-1]["input"]["decision"]["basis_refs"] == [
        "skill:observation-bound-comparison@v1", "system_prompt:goal-directed-planning-policy@v1"]
    assert action_observations[-1]["input"]["decision"]["prediction"]

    # A newer failed review must not erase the last evidenced successful method
    # from the short parent projection.
    with (tmp_path / "task-level-reviews.jsonl").open("a", encoding="utf-8") as stream:
        stream.write(json.dumps({"window_id": "level-outcome:later-reset", "failure_modes": [
            {"symptom": "a different board stalled"}], "outcome_cost_index_ref": None}) + "\n")
    _run_fixture(tmp_path, "treatment", extra_env={"PI_HARNESS_PERIODIC_REVIEW": "disabled"},
        extra_extensions=[Path(__file__).parent / "pi_level_outcome_fixture.ts"], steps=[
            {"name": "task_harness", "arguments": {"action": "inspect"}}])
    later_context = "\n".join(
        part.get("text", "") for message in records(tmp_path, "provider-contexts.jsonl")[-1]["context"]["messages"]
        if message.get("role") == "user"
        for part in message.get("content", []) if part.get("type") == "text"
    )
    assert '"window_id":"level-outcome:later-reset"' in later_context
    assert f'"prior_successful_review_ref":"{level_ref}"' in later_context
    assert '"failure_modes":{"count":1' in later_context


def test_terminal_review_blocks_actions_but_allows_submission(tmp_path):
    from test_pi_external_benchmark_native import _pi_cli
    from autoresearch_pi.pi_kernel import PiKernel
    node, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    command = [node, cli, "--mode", "rpc", "--provider", "offline-external-test", "--model", "scripted",
               "--no-session", "--no-extensions", "--no-skills", "--no-context-files", "--no-builtin-tools"]
    for path in ["demo/pi_external_benchmark_research.ts", "tests/pi_external_benchmark_provider.ts", "tests/pi_level_outcome_fixture.ts"]:
        command.extend(["--extension", str(project / path)])
    report = dict(summary="Ended", mechanisms="Unknown", shortcomings="Unverified", lessons="Check evidence",
                  next_attempt="Re-evaluate", credits=[], success_path={"status":"insufficient_evidence",
                      "scope":"terminal fixture", "preconditions":[], "steps":[],
                      "success_check":"environment reports WIN", "uncertainty":"No method established",
                      "reuse_advice":"Do not reuse"})
    steps = [{"name":"arc_action","arguments":{}}, None,
             {"name":"arc_action","arguments":{}},
             {"name":"task_memory","arguments":{"action":"upsert","key":"forbidden","content":"x"}},
             {"name":"task_harness","arguments":{"action":"level_review",
              "window_id":"level-outcome:execution-observation-1","level_review":report}}]
    env = {"PI_CODING_AGENT_DIR":str(tmp_path / ".pi"), "PI_AUTORESEARCH_E2E_ROOT":str(tmp_path),
           "PI_AUTORESEARCH_ROOT":str(project), "PI_AUTORESEARCH_VARIANT":"treatment",
           "PI_HARNESS_PERIODIC_REVIEW":"disabled", "PI_EXTERNAL_STEPS":json.dumps(steps)}
    with PiKernel(command, cwd=str(tmp_path), env=env, timeout=60) as kernel:
        kernel.prompt("Run first action")
        kernel.wait_for_agent_events(timeout=60)
        kernel.prompt("ARC_TERMINAL_LEVEL_REVIEW")
        events = kernel.wait_for_agent_events(timeout=60)
    outputs = [e for e in events if e.get("type") == "tool_execution_end"]
    blocked = [e for e in outputs if e.get("toolName") in {"arc_action","task_memory"}]
    assert len(blocked) == 2
    assert all("Terminal level review permits" in json.dumps(e) for e in blocked)
    assert not (tmp_path / "task-memory.jsonl").exists()
    assert len((tmp_path / "task-level-reviews.jsonl").read_text().splitlines()) == 1
