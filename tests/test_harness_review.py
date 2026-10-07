"""Review integration diagnostics, not real-provider ARC acceptance."""
import json
import subprocess
from pathlib import Path

from test_pi_external_benchmark_native import _pi_cli, _run_fixture


def helper(expression):
    node, _ = _pi_cli()
    module = Path(__file__).resolve().parents[1] / "demo/pi_harness_review.ts"
    result = subprocess.run([node, "--experimental-strip-types", "--input-type=module", "-e",
        f'import * as h from {json.dumps(module.as_uri())}; console.log(JSON.stringify({expression}));'],
        capture_output=True, text=True, check=True)
    return json.loads(result.stdout)


def handoff_helper(expression):
    node, _ = _pi_cli()
    module = Path(__file__).resolve().parents[1] / "demo/pi_auto_research_handoff.ts"
    result = subprocess.run([node, "--experimental-strip-types", "--input-type=module", "-e",
        f'import * as h from {json.dumps(module.as_uri())}; console.log(JSON.stringify({expression}));'],
        capture_output=True, text=True, check=True)
    return json.loads(result.stdout)


def test_review_rejects_incomplete_and_unusable_candidates():
    assert helper("""(() => {
      const entries = h.REVIEW_COMPONENTS.map(component => ({component, disposition:'defer', reason:'Need observations'}));
      const failures = [];
      for (const value of [entries.slice(1), entries.map(e => ({...e, disposition:'create'})),
          entries.map(e => ({...e, resource_refs:['memory:missing@v1']}))]) {
        try { h.validateHarnessReview(value, new Set()); failures.push(false); }
        catch { failures.push(true); }
      }
      return failures;
    })()""") == [True, True, True]


def test_periodic_windows_count_only_successful_actions_and_replace_twentieth():
    result = helper("""(() => {
      const observations = [{tool_name:'arc_state', observation_id:'baseline'}];
      for (let i=1; i<=40; i++) {
        observations.push({tool_name:'arc_state', observation_id:'read-'+i});
        observations.push({tool_name:'arc_action', observation_id:'failed-'+i, is_error:true});
        observations.push({tool_name:'arc_action', observation_id:'action-'+i, toolCallId:'call-'+i});
      }
      observations.push(observations.at(-1));
      return h.periodicReviewWindows(observations);
    })()""")
    assert [w["end_step"] for w in result] == list(range(5, 41, 5))
    assert [w["start_step"] for w in result] == [1, 6, 11, 1, 21, 26, 31, 21]
    assert [w["end_step"] for w in result if w["mode"] == "consolidation"] == [20, 40]
    assert result[3]["action_refs"] == [f"action-{i}" for i in range(1, 21)]
    assert result[4]["baseline_ref"] == "action-20"


def test_periodic_windows_count_native_receipts_across_batches_and_child_calls():
    result = helper("""(() => {
      const observations = [];
      for (let i=1; i<=60; i++) observations.push({tool_name:'arc_action',
        observation_id:'action-'+i, toolCallId:'batch-'+Math.floor((i-1)/8),
        actor:i>40?'child':'parent', arc_outcome:{action_budget:{total_used:i}}});
      observations.push({...observations[3], observation_id:'reloaded-action-4'});
      observations.push({tool_name:'arc_action',observation_id:'not-executed',is_error:true});
      return h.periodicReviewWindows(observations);
    })()""")
    assert [w["end_step"] for w in result] == list(range(5, 61, 5))
    assert result[-1]["action_refs"] == [f"action-{i}" for i in range(41, 61)]


def test_periodic_queue_exposes_latest_evidence_and_resumes_parent_deferral():
    result = helper("""(() => {
      const observations = Array.from({length:15},(_,i)=>({tool_name:'arc_action',observation_id:'a'+i}));
      const events = [{window_id:'arc-pattern-10',status:'deferred',parent_reason:'need a contrast',resume_after_action_count:15}];
      return [h.periodicReviewQueue(observations.slice(0,10),[],[]),
        h.periodicReviewQueue(observations.slice(0,10),[],events),
        h.periodicReviewQueue(observations,[{window_id:'arc-pattern-15'}],events)];
    })()""")
    assert result[0]["current"]["window_id"] == "arc-pattern-10"
    assert [w["window_id"] for w in result[0]["due"]] == ["arc-pattern-5", "arc-pattern-10"]
    assert result[1]["current"]["window_id"] == "arc-pattern-5"
    assert result[1]["deferred"][0]["parent_reason"] == "need a contrast"
    assert result[2]["current"]["window_id"] == "arc-pattern-10"
    assert result[2]["current"]["resumed_from"]["status"] == "deferred"


def test_native_due_window_requires_parent_review_or_bounded_deferral(tmp_path):
    project = Path(__file__).resolve().parents[1]
    events = _run_fixture(tmp_path, "treatment", extra_extensions=[project / "tests/pi_periodic_review_fixture.ts"],
        extra_env={"PI_HARNESS_REVIEW_DECISION_REQUIRED": "enabled"}, steps=[
            *[{"name": "arc_action", "arguments": {}} for _ in range(6)],
            {"name": "task_harness", "arguments": {"action": "defer_review", "review_reason": "Collect a contrasting action before extracting a rule",
                "resume_condition": {"kind": "after_actions", "actions": 5}}},
            {"name": "arc_action", "arguments": {}},
        ])
    outputs = [e for e in events if e.get("type") == "tool_execution_end" and e.get("toolName") == "arc_action"]
    assert sum(bool(e.get("isError")) for e in outputs) == 1
    observations = [json.loads(line) for line in (tmp_path / "execution-observations.jsonl").read_text(encoding="utf-8").splitlines()]
    assert sum(r["tool_name"] == "arc_action" and not r["is_error"] for r in observations) == 6
    decisions = [json.loads(line) for line in (tmp_path / "task-harness-review-events.jsonl").read_text(encoding="utf-8").splitlines()]
    assert decisions[-1]["status"] == "deferred" and decisions[-1]["decided_by"] == "parent"
    assert decisions[-1]["resume_after_action_count"] == 10


def test_native_missing_review_exhausts_bounded_action_deferrals_without_faking_parent_decision(tmp_path):
    project = Path(__file__).resolve().parents[1]
    events = _run_fixture(tmp_path, "treatment", extra_extensions=[project / "tests/pi_periodic_review_fixture.ts"],
                         extra_env={"PI_HARNESS_REVIEW_DECISION_REQUIRED": "enabled"},
                         steps=[{"name": "arc_action", "arguments": {}}] * 8)
    outputs = [e for e in events if e.get("type") == "tool_execution_end" and e.get("toolName") == "arc_action"]
    assert sum(bool(e.get("isError")) for e in outputs) == 2
    observations = [json.loads(line) for line in (tmp_path / "execution-observations.jsonl").read_text(encoding="utf-8").splitlines()]
    assert sum(row["tool_name"] == "arc_action" and not row["is_error"] for row in observations) == 6
    decisions = [json.loads(line) for line in (tmp_path / "task-harness-review-events.jsonl").read_text(encoding="utf-8").splitlines()]
    assert decisions[-1]["status"] == "failed" and decisions[-1]["decided_by"] == "runtime"
    assert decisions[-1]["reason"] == "parent_review_decision_not_recorded_within_control_budget"
    assert not (tmp_path / "task-harness-reviews.jsonl").exists()


def test_periodic_handoff_changes_lane_at_twenty_and_inherits_exact_window_material():
    result = handoff_helper("""(() => {
      const transition = {observed_changes:'sprite moved', predictive_rules:'action A may move it',
        limiting_uncertainty:'autonomous motion', next_experiment:'repeat A after waiting',
        capability_opportunities:'a conditional transition tester', evidence_refs:['obs-2']};
      const entries = [{component:'skill', disposition:'reuse', resource_refs:['skill:diff@v3']}];
      const incremental = h.buildPeriodicResearchHandoff('r5', {window_id:'arc-pattern-5', mode:'incremental',
        start_step:1, end_step:5, baseline_ref:'obs-0', evidence_refs:['obs-1','obs-2']}, transition, entries);
      const consolidation = h.buildPeriodicResearchHandoff('r20', {window_id:'arc-pattern-20', mode:'consolidation',
        start_step:1, end_step:20, baseline_ref:'obs-0', evidence_refs:['obs-1','obs-20']}, transition, entries);
      const blocking = incremental.ready_calls
        ? h.applyResearchHandoff(incremental.ready_calls.blocking, incremental) : null;
      const nonBlocking = consolidation.ready_calls
        ? h.applyResearchHandoff(consolidation.ready_calls.non_blocking, consolidation) : null;
      let missingMode = '';
      try { h.applyResearchHandoff(incremental.ready_call, incremental); }
      catch (error) { missingMode = String(error.message); }
      return {incremental, consolidation, blocking, nonBlocking, missingMode};
    })()""")
    incremental = result["incremental"]
    consolidation = result["consolidation"]
    assert incremental["interaction_mode_policy"] == "parent_choice_required"
    assert incremental["interaction_mode_options"] == ["blocking", "non_blocking"]
    assert set(incremental["ready_calls"]) == {"blocking", "non_blocking"}
    assert "interaction_mode" not in incremental["ready_call"]
    assert incremental["scope"] == "research_method"
    assert incremental["evidence_refs"] == ["obs-0", "obs-1", "obs-2"]
    assert incremental["resource_refs"] == ["skill:diff@v3"]
    assert incremental["hypothesis"]["claim"] == "action A may move it"
    assert consolidation["interaction_mode_policy"] == "parent_choice_required"
    assert consolidation["ready_calls"]["blocking"]["interaction_mode"] == "blocking"
    assert consolidation["ready_calls"]["non_blocking"]["interaction_mode"] == "non_blocking"
    assert consolidation["scope"] == "composition"
    assert consolidation["lane"] == "task_research_cross_stage_consolidation"
    assert consolidation["parent_transition_analysis"] == {
        "observed_changes": "sprite moved",
        "predictive_rules": "action A may move it",
        "limiting_uncertainty": "autonomous motion",
        "next_experiment": "repeat A after waiting",
        "capability_opportunities": "a conditional transition tester",
        "evidence_refs": ["obs-2"],
    }
    assert result["blocking"]["interaction_mode"] == "blocking"
    assert result["nonBlocking"]["interaction_mode"] == "non_blocking"
    assert result["blocking"]["question"] == incremental["question"]
    assert result["blocking"]["context_window"] == incremental["context_window"]
    assert "Completion contract:" in result["blocking"]["constraints"][-2]
    assert "explicitly choose interaction_mode" in result["missingMode"]


def test_periodic_handoff_makes_task_research_problem_primary_and_carries_prior_research_line():
    result = handoff_helper("""(() => {
      const transition = {observed_changes:'five manual coordinate calculations',
        predictive_rules:'tile deltas are parameterized by row, column and meter rate',
        limiting_uncertainty:'whether the procedure transfers after a level change',
        next_experiment:'predict one held-out transition before acting',
        capability_opportunities:'construct and test a parameterized expected-delta calculator',
        evidence_refs:['obs-5']};
      const prior = [
        {status:'completed', report_ref:'research_report:auto-research-1@v1', research_line_ref:'research_line:line-1@v1',
         research_run_ref:'research_run:auto-research-1@v1', result_summary:'calculator candidate was untested'},
        {status:'active', session_ref:'research_session:research-session-2@v1',
         result_summary:'related transfer check is still active'},
      ];
      return h.buildPeriodicResearchHandoff('r10', {window_id:'arc-pattern-10', mode:'incremental',
        start_step:6, end_step:10, evidence_refs:['obs-5']}, transition, [], prior);
    })()""")
    assert result["research_problem"] == {
        "kind": "unspecified",
        "status": "unresolved",
        "statement": "whether the procedure transfers after a level change",
        "evidence_entry_window": "arc-pattern-10",
        "prior_research_refs": ["research_report:auto-research-1@v1", "research_run:auto-research-1@v1",
                                "research_session:research-session-2@v1"],
    }
    assert result["scope"] == "research_method"
    assert "research_report:auto-research-1@v1" in result["resource_refs"]
    assert result["completion_contract_kind"] == "task_research_evaluation"
    assert result["research_line_ref"] == "research_line:line-1@v1"
    assert result["output_channels"] == ["research_conclusion", "planning_implication",
                                           "experiment_request", "optional_method_candidate"]
    assert result["continuity_policy"] == "continue_or_distinguish_before_starting_new_work"


def test_handoff_does_not_promote_deferred_capability_over_blocking_uncertainty():
    result = handoff_helper("""h.buildPeriodicResearchHandoff('blocked',
      {window_id:'w35',mode:'incremental',start_step:31,end_step:35,evidence_refs:['obs-35']},
      {observed_changes:'Entering the presumed goal produced no change',
       predictive_rules:'Previous level accepted entry',
       limiting_uncertainty:'Does entry require a key, different alignment, or another goal?',
       next_experiment:'Compare another direction before repeating entry',
       capability_opportunities:'Defer route planner: path search does not explain the no-op'}, [])""")
    assert result['research_problem']['statement'] == 'Does entry require a key, different alignment, or another goal?'
    assert result['research_problem']['kind'] == 'unspecified'
    assert 'Defer route planner: path search does not explain the no-op' in result['question']
    assert result['parent_transition_analysis']['next_experiment'] == 'Compare another direction before repeating entry'


def test_periodic_handoff_can_route_planning_research_without_requiring_harness_output():
    result = handoff_helper("""(() => h.buildPeriodicResearchHandoff('planning',
      {window_id:'arc-pattern-15', mode:'incremental', start_step:11, end_step:15, evidence_refs:['obs-15']},
      {research_kind:'planning', observed_changes:'two local skills work separately',
       predictive_rules:'their order may depend on phase state', limiting_uncertainty:'which phase transition selects the order',
       next_experiment:'compare both orders at the same reachable phase',
       capability_opportunities:'choose and validate a phase-conditioned composition plan', evidence_refs:['obs-15']},
      [], []))()""")
    assert result["research_problem"]["kind"] == "planning"
    assert result["candidate_components"] == []
    assert "research-only conclusion" in result["question"]
    assert "Method candidates are allowed" in result["completion_contract"]
    assert "child-authored Harness components are forbidden" in result["completion_contract"]


def test_handoff_reconciliation_tracks_background_session_and_keeps_exact_versions():
    result = handoff_helper("""(() => {
      const base = h.buildPeriodicResearchHandoff('r5', {window_id:'arc-pattern-5', mode:'incremental',
        start_step:1, end_step:5, baseline_ref:'obs-0', evidence_refs:['obs-1']},
        {observed_changes:'change', predictive_rules:'claim', limiting_uncertainty:'u',
         next_experiment:'probe', evidence_refs:['obs-1']}, []);
      const sessions = [
        {session_id:'s1', version:1, status:'active', run_id:'run-1', research_handoff_ref:base.ready_call.research_handoff_ref},
        {session_id:'s1', version:2, status:'completed', run_id:'run-1', research_handoff_ref:base.ready_call.research_handoff_ref,
         research_run_ref:'research_run:run-1@v1', report_status:'supported_within_scope'}];
      const reports = [{run_id:'run-1', version:1, report:{
        experiment_request:{parent_action:'apply A once'},
        confidence_update:{disposition:'increase',basis:'completed_discriminating_experiment',evidence_refs:['obs-1']}}}];
      const completed = h.reconcileResearchHandoffs([base], sessions, reports)[0];
      let stale = '';
      try { h.resolveResearchHandoff([base, completed], base.ready_call.research_handoff_ref); }
      catch (error) { stale = String(error.message); }
      const resolved = h.resolveResearchHandoff([base, completed], h.researchHandoffReference(completed));
      return {completed, stale, resolvedVersion:resolved.version,
        duplicateCount:h.reconcileResearchHandoffs([base, completed], sessions, reports).length};
    })()""")
    assert result["completed"]["status"] == "completed"
    assert result["completed"]["session_ref"] == "research_session:s1@v2"
    assert result["completed"]["research_run_ref"] == "research_run:run-1@v1"
    assert result["completed"]["confidence_state"] == "proposed_evidence_linked_update_pending_parent_adoption"
    assert result["completed"]["experiment_request"]["parent_action"] == "apply A once"
    assert result["completed"]["next_call"] == {"action": "inspect", "session_ref": "research_session:s1@v2"}
    assert "version conflict" in result["stale"]
    assert result["resolvedVersion"] == 2
    assert result["duplicateCount"] == 0


def test_periodic_review_is_advisory_and_does_not_interrupt_parent_actions(tmp_path):
    project = Path(__file__).resolve().parents[1]
    entries = [{"component": c, "disposition": "defer", "reason": "No reusable pattern supported yet"}
               for c in ["memory", "task_prompt", "system_prompt", "skill", "tool", "subagent"]]
    action = {"name": "arc_action", "arguments": {}}
    events = _run_fixture(tmp_path, "treatment",
        extra_extensions=[project / "tests/pi_periodic_review_fixture.ts"],
        steps=[action] * 6 + [{"name": "task_harness", "arguments": {
            "action": "review", "opportunity_id": "harness-opportunity-1", "review": entries,
            "transition_analysis": {
                "observed_changes": "Fixture reports completion but supplies no state differences",
                "predictive_rules": "No environmental rule is supported",
                "limiting_uncertainty": "Before and after states are unavailable",
                "next_experiment": "Obtain state observations before proposing a distinguishing intervention",
                "capability_opportunities": "Defer capabilities pending observable effects",
                "evidence_refs": ["execution-observation-1"],
            }}}, action,
            {"name": "task_harness", "arguments": {
                "action": "decide_research",
                "research_handoff_ref": "research_handoff:research-handoff-harness-review-1@v1",
                "research_decision": "defer",
                "research_reason": "The fixture has no before/after state needed for a useful child validation.",
            }}, action])
    opportunities = [json.loads(line) for line in (tmp_path / "task-harness-opportunities.jsonl").read_text().splitlines()]
    assert len(opportunities) == 1
    assert opportunities[0]["window"]["end_step"] == 5
    reviews = [json.loads(line) for line in (tmp_path / "task-harness-reviews.jsonl").read_text().splitlines()]
    assert reviews[0]["window_id"] == "arc-pattern-5"
    assert reviews[0]["transition_analysis"]["predictive_rules"] == "No environmental rule is supported"
    assert "Temporal succession" in reviews[0]["method_research_contract"]["induction_guidance"]
    assert set(reviews[0]["method_research_contract"]["ready_auto_research_calls"]) == {
        "blocking", "non_blocking",
    }
    contexts = (tmp_path / "provider-contexts.jsonl").read_text(encoding="utf-8")
    assert "Learn mechanisms from interaction" in contexts
    assert "limiting_uncertainty" in contexts
    records = [json.loads(line) for line in (tmp_path / "execution-observations.jsonl").read_text().splitlines()]
    assert len([r for r in records if r["tool_name"] == "arc_action" and not r["is_error"]]) == 8
    handoffs = [json.loads(line) for line in (tmp_path / "auto-research-handoffs.jsonl").read_text().splitlines()]
    assert [(item["version"], item["status"]) for item in handoffs] == [(1, "proposed"), (2, "deferred")]
    assert handoffs[0]["parent_transition_analysis"] == reviews[0]["transition_analysis"]
    assert set(handoffs[0]["ready_calls"]) == {"blocking", "non_blocking"}
    assert not (tmp_path / "auto-research-sessions.jsonl").exists()
    resumed = _run_fixture(tmp_path, "treatment",
        extra_extensions=[project / "tests/pi_periodic_review_fixture.ts"],
        steps=[{"name": "task_harness_status", "arguments": {"request": "current"}}])
    status = next(e for e in resumed if e.get("type") == "tool_execution_end" and e.get("toolName") == "task_harness_status")
    assert json.loads(status["result"]["content"][0]["text"])["pending_pattern_extraction"] is None
    assert len((tmp_path / "task-harness-opportunities.jsonl").read_text().splitlines()) == 1


def test_arc_periodic_review_defaults_to_short_receipt_with_exact_full_reads(tmp_path):
    project = Path(__file__).resolve().parents[1]
    transition = {
        "observed_changes": "Five action outcomes were recorded",
        "predictive_rules": "The current evidence does not establish a causal rule",
        "limiting_uncertainty": "Which action changes the public state",
        "next_experiment": "Compare one bounded alternative",
        "capability_opportunities": "unknown",
        "evidence_refs": ["execution-observation-1"],
    }
    steps = ([{"name": "arc_action", "arguments": {}}] * 5 + [
        {"name": "task_harness", "arguments": {
            "action": "review", "review": [], "transition_analysis": transition}},
        {"name": "task_harness", "arguments": {"action": "summary"}},
        {"name": "task_harness", "arguments": {"action": "inspect", "section": "review_contract"}},
        {"name": "task_harness", "arguments": {"action": "status", "section": "all"}},
        {"name": "task_resource", "arguments": {"action": "read", "ref": "harness_review:harness-review-1@v1", "limit": 50000}},
        {"name": "task_resource", "arguments": {"action": "read", "ref": "research_handoff:research-handoff-harness-review-1@v1", "limit": 50000}},
    ])
    events = _run_fixture(tmp_path, "treatment", arc_compact=True,
                          extra_extensions=[project / "tests/pi_periodic_review_fixture.ts"], steps=steps)
    results = [event for event in events if event.get("type") == "tool_execution_end"]
    assert not any(event.get("isError") for event in results), [
        (event.get("toolName"), event.get("args"), event.get("result", {}).get("content"))
        for event in results if event.get("isError")]
    harness = [json.loads(event["result"]["content"][0]["text"])
               for event in results if event.get("toolName") == "task_harness"]
    receipt, summary, section, full = harness
    assert receipt["format"] == "task-harness-review-receipt-v1"
    assert receipt["review_ref"] == "harness_review:harness-review-1@v1"
    assert receipt["research_handoff_ref"] == "research_handoff:research-handoff-harness-review-1@v1"
    assert "method_research_contract" not in receipt and "handoff" not in receipt
    assert set(receipt["ready_auto_research_calls"]) == {"blocking", "non_blocking"}
    assert summary["format"] == "task-harness-status-summary-v1"
    assert summary["full_status_call"]["arguments"] == {"action": "status", "section": "all"}
    assert section["section"] == "review_contract"
    assert full["format"] == "task-local-harness-status-v1"
    reads = [json.loads(event["result"]["content"][0]["text"])
             for event in results if event.get("toolName") == "task_resource"]
    assert len(reads) == 2 and all(row["complete"] for row in reads)
    stored_review = json.loads(reads[0]["text"])
    stored_handoff = json.loads(reads[1]["text"])
    assert all(stored_review["transition_analysis"][key] == value
               for key, value in transition.items())
    assert "induction_guidance" in stored_review["method_research_contract"]
    assert stored_handoff["research_problem"]["statement"] == transition["limiting_uncertainty"]


def test_periodic_review_merges_two_pure_memory_reuses_and_keeps_transition(tmp_path):
    project = Path(__file__).resolve().parents[1]
    memories = [{"memory_id": f"memory-{index}", "key": name, "version": 1,
                 "status": "active", "content": reason}
                for index, name, reason in ((1, "click-toggle", "Bottom tiles toggle"),
                                            (2, "board-geometry", "Grid uses an eight-pixel pitch"))]
    (tmp_path / "task-memory.jsonl").write_text(
        "".join(json.dumps(row) + "\n" for row in memories), encoding="utf-8")
    transition = {"observed_changes": "Five clicks distinguished bottom tiles from top labels",
                  "predictive_rules": "Bottom tiles toggle; top labels are static",
                  "limiting_uncertainty": "The win condition is still unknown",
                  "next_experiment": "Match the lower board to a top pattern",
                  "capability_opportunities": "A board-state reader could reduce manual pixel parsing",
                  "evidence_refs": [f"execution-observation-{index}" for index in range(1, 6)]}
    entries = [
        {"component": "memory", "disposition": "reuse", "reason": "Toggle rule repeated in later clicks",
         "next_use": "Predict the next bottom-tile click", "resource_refs": ["memory:memory-1@v1"]},
        {"component": "memory", "disposition": "reuse", "reason": "Geometry still maps clicks to cells",
         "next_use": "Choose coordinates for the next cell", "resource_refs": ["memory:memory-2@v1"]},
    ]
    events = _run_fixture(tmp_path, "treatment",
        extra_extensions=[project / "tests/pi_periodic_review_fixture.ts"],
        steps=[{"name": "arc_action", "arguments": {}}] * 5 + [
            {"name": "task_harness", "arguments": {"action": "review", "review": entries,
                                                   "transition_analysis": transition}}])
    review_call = next(event for event in events if event.get("type") == "tool_execution_end"
                       and event.get("toolName") == "task_harness")
    assert not review_call.get("isError"), review_call
    review = json.loads((tmp_path / "task-harness-reviews.jsonl").read_text(encoding="utf-8").splitlines()[0])
    merged = next(entry for entry in review["entries"] if entry["component"] == "memory")
    assert merged["disposition"] == "reuse"
    assert merged["resource_refs"] == ["memory:memory-1@v1", "memory:memory-2@v1"]
    assert "Toggle rule repeated" in merged["reason"] and "Geometry still maps" in merged["reason"]
    assert "Predict the next" in merged["next_use"] and "Choose coordinates" in merged["next_use"]
    assert all(review["transition_analysis"][key] == value for key, value in transition.items())
    assert review["transition_analysis"]["capability_opportunities"] == "A board-state reader could reduce manual pixel parsing"


def test_review_still_rejects_mixed_or_write_bearing_same_kind_entries():
    value = helper("""(() => { try { h.normalizeHarnessReview([
      {component:'memory',disposition:'reuse',reason:'keep',resource_refs:['memory:m1@v1']},
      {component:'memory',disposition:'defer',reason:'wait for more evidence',resource_refs:['memory:m2@v1']}],
      new Set(['memory:m1@v1','memory:m2@v1'])); return null; }
      catch(e) { return e.message; } })()""")
    assert "Duplicate component" in value
    write_bearing = helper("""(() => { try { h.normalizeHarnessReview([
      {component:'memory',disposition:'reuse',reason:'keep',resource_refs:['memory:m1@v1']},
      {component:'memory',disposition:'reuse',reason:'keep too',resource_refs:['memory:m2@v1'],
       candidate:{name:'ambiguous-write'}}],
      new Set(['memory:m1@v1','memory:m2@v1'])); return null; }
      catch(e) { return e.message; } })()""")
    assert "Duplicate component" in write_bearing


def test_periodic_provider_excerpts_bound_huge_deltas_but_exact_evidence_remains_readable(tmp_path):
    project = Path(__file__).resolve().parents[1]
    delta = "WIN_PIXEL_" + "Z" * 30000 + "_DELTA_END"
    observations = [{
        "observation_id": f"execution-observation-{index}", "tool_name": "arc_action",
        "toolCallId": f"seed-call-{index}", "is_error": False, "version": 1,
        "result_text": f"action {index}: {delta}",
    } for index in range(1, 6)]
    (tmp_path / "execution-observations.jsonl").write_text(
        "".join(json.dumps(row) + "\n" for row in observations), encoding="utf-8")
    ref = "observation:execution-observation-1@v1"
    events = _run_fixture(tmp_path, "treatment",
        extra_extensions=[project / "tests/pi_periodic_review_fixture.ts"],
        steps=[{"name": "task_resource", "arguments": {
            "action": "read", "ref": ref, "offset": 0, "limit": 50000}}])

    contexts = [json.loads(line)["context"] for line in
                (tmp_path / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()]
    periodic = next(part["text"] for message in contexts[0]["messages"]
                    for part in message.get("content", [])
                    if part.get("type") == "text" and part["text"].startswith(
                        "Periodic pattern extraction due:"))
    card, _ = json.JSONDecoder().raw_decode(periodic.split(": ", 1)[1])
    assert card["window_id"] == "arc-pattern-5"
    assert card["action_count"] == 5
    assert "execution-observation-1" in card["evidence_refs"]
    assert len(card["evidence_refs"]) <= 8
    assert "_DELTA_END" not in periodic
    assert len(periodic) < 15000
    read_event = next(event for event in events if event.get("type") == "tool_execution_end"
                      and event.get("toolName") == "task_resource")
    read = json.loads(read_event["result"]["content"][0]["text"])
    assert read["ref"] == ref
    assert delta in read["text"]
    assert [json.loads(line)["result_text"] for line in
            (tmp_path / "execution-observations.jsonl").read_text(encoding="utf-8").splitlines()[:5]] == [
                row["result_text"] for row in observations]


def test_parent_status_reconciles_a_linked_background_session_without_child_process(tmp_path):
    project = Path(__file__).resolve().parents[1]
    entries = [{"component": c, "disposition": "defer", "reason": "Need independent validation"}
               for c in ["memory", "task_prompt", "system_prompt", "skill", "tool", "subagent"]]
    action = {"name": "arc_action", "arguments": {}}
    _run_fixture(tmp_path, "treatment",
        extra_extensions=[project / "tests/pi_periodic_review_fixture.ts"],
        steps=[action] * 6 + [{"name": "task_harness", "arguments": {
            "action": "review", "opportunity_id": "harness-opportunity-1", "review": entries,
            "transition_analysis": {
                "observed_changes": "The fixture returned the same completion text",
                "predictive_rules": "The fixture action is observationally invariant",
                "limiting_uncertainty": "No real environment state is exposed",
                "next_experiment": "Compare a canonical state before and after one action",
                "capability_opportunities": "A transition comparator may become reusable",
                "evidence_refs": ["execution-observation-1"],
            }}}])
    session = {
        "session_id": "research-session-1", "version": 2, "status": "completed",
        "interaction_mode": "non_blocking", "run_id": "auto-research-1",
        "research_handoff_ref": "research_handoff:research-handoff-harness-review-1@v1",
        "research_run_ref": "research_run:auto-research-1@v1",
        "report_status": "inconclusive", "summary": "The fixture cannot test the mechanism.",
    }
    (tmp_path / "auto-research-sessions.jsonl").write_text(json.dumps(session) + "\n", encoding="utf-8")

    events = _run_fixture(tmp_path, "treatment",
        extra_extensions=[project / "tests/pi_periodic_review_fixture.ts"],
        steps=[{"name": "task_harness_status", "arguments": {"request": "current"}}, action])
    status_event = next(e for e in events if e.get("type") == "tool_execution_end"
                        and e.get("toolName") == "task_harness_status")
    status = json.loads(status_event["result"]["content"][0]["text"])
    assert status["research_handoffs"][0]["status"] == "completed"
    assert status["research_handoffs"][0]["handoff_ref"].endswith("@v2")
    assert status["research_handoffs"][0]["research_run_ref"] == "research_run:auto-research-1@v1"
    assert status["pending_research_handoff"] is None
    handoffs = [json.loads(line) for line in (tmp_path / "auto-research-handoffs.jsonl").read_text().splitlines()]
    assert [(item["version"], item["status"]) for item in handoffs] == [(1, "proposed"), (2, "completed")]
    observations = [json.loads(line) for line in (tmp_path / "execution-observations.jsonl").read_text().splitlines()]
    assert len([item for item in observations if item["tool_name"] == "arc_action" and not item["is_error"]]) == 7


def test_transition_analysis_requires_reasoning_and_window_evidence():
    assert helper("""(() => {
      const good = {observed_changes:'Observed delta, not a mechanism', predictive_rules:'Unknown',
        limiting_uncertainty:'Unobserved autonomous dynamics', next_experiment:'Compare alternative predictions',
        capability_opportunities:'Reusable comparison procedure', evidence_refs:['obs-1']};
      const rejected = [];
      for (const item of [undefined, {...good, predictive_rules:''}, {...good, evidence_refs:[]},
        {...good, evidence_refs:['outside-window']}]) {
        try { h.validateTransitionAnalysis(item, new Set(['obs-1'])); rejected.push(false); }
        catch { rejected.push(true); }
      }
      return {rejected, accepted:h.validateTransitionAnalysis(good, new Set(['obs-1']))};
    })()""")["rejected"] == [True, True, True, True]


def test_unhandled_periodic_review_remains_durable_without_blocking_actions(tmp_path):
    project = Path(__file__).resolve().parents[1]
    _run_fixture(tmp_path, "treatment",
        extra_extensions=[project / "tests/pi_periodic_review_fixture.ts"],
        steps=[{"name": "arc_action", "arguments": {}}] * 8)
    observations = [json.loads(line) for line in (tmp_path / "execution-observations.jsonl").read_text().splitlines()]
    assert len([item for item in observations if item["tool_name"] == "arc_action" and not item["is_error"]]) == 8
    opportunities = [json.loads(line) for line in (tmp_path / "task-harness-opportunities.jsonl").read_text().splitlines()]
    assert len(opportunities) == 1
    assert opportunities[0]["window"]["window_id"] == "arc-pattern-5"
    assert not (tmp_path / "task-harness-review-events.jsonl").exists()


def test_progress_review_cues_are_bounded_and_reset_on_advance():
    assert helper("""(() => {
      const stalled = Array.from({length:9}, (_, i) => ({signal_id:String(i), layer:'task_progress', outcome:'not_advanced'}));
      return [h.reviewProgress(stalled.slice(0,7)), h.reviewProgress(stalled.slice(0,8)),
        h.reviewProgress(stalled), h.reviewProgress([...stalled, {signal_id:'advance', layer:'task_progress', outcome:'advanced'}])];
    })()""") == [
        {"last_advance": None, "no_progress_bucket": 0},
        {"last_advance": None, "no_progress_bucket": 1},
        {"last_advance": None, "no_progress_bucket": 1},
        {"last_advance": "advance", "no_progress_bucket": 0},
    ]


def test_lifecycle_joins_exact_versions_and_keeps_semantic_uncertainty():
    result = helper("""h.harnessLifecycle(file => ({
      'task-memory.jsonl': [{memory_id:'m', version:1, decision_id:'d', projection:{channel:'task_prompt'}}],
      'task-tools.jsonl': [{tool_id:'t', version:2, decision_id:'t2'}],
      'task-tool-events.jsonl': [{event:'invoked', tool_id:'t', version:1, status:'completed'}],
      'harness-observations.jsonl': [{decision_id:'d', observation_id:'o', observation_kind:'pi_task_prompt_projection'}],
      'effect-assessments.jsonl': [{decision_id:'d', verdict:'inconclusive'}]
    }[file] ?? []))""")
    assert result[0]["task_prompt_exposed"] is True
    assert result[0]["exposure_refs"] == ["o"]
    assert result[0]["agent_effect_assessments"][0]["verdict"] == "inconclusive"
    assert result[1]["uses"] == []
    assert result[1]["semantic_success"] == "not_inferred_from_completion"


def test_review_persists_once_and_returns_method_contract(tmp_path):
    entries = [{"component": c, "disposition": "defer", "reason": "Need representative evidence"}
               for c in ["memory", "task_prompt", "system_prompt", "skill", "tool", "subagent"]]
    entries[3].update(disposition="create", next_use="Next window comparison",
                      validation="Compare procedure output with original frame pixels")
    review = {"name": "task_harness", "arguments": {
        "action": "review", "opportunity_id": "harness-opportunity-1", "review": entries}}
    events = _run_fixture(tmp_path, "treatment", steps=[review, review,
        {"name": "task_harness_status", "arguments": {"request": "current"}}])
    records = [json.loads(line) for line in (tmp_path / "task-harness-reviews.jsonl").read_text().splitlines()]
    assert len(records) == 1
    contract = records[0]["method_research_contract"]
    assert contract["candidates"][0]["component"] == "skill"
    assert contract["starts_research"] is False
    assert not (tmp_path / "auto-research-sessions.jsonl").exists()
    status = next(e for e in events if e.get("type") == "tool_execution_end" and e.get("toolName") == "task_harness_status")
    body = json.loads(status["result"]["content"][0]["text"])
    assert body["reviews"][0]["review_id"] == records[0]["review_id"]
    assert body["pending_research_handoff"] is None
    assert "lifecycle" in body
    opportunities = (tmp_path / "task-harness-opportunities.jsonl").read_text().splitlines()
    assert len(opportunities) == 1  # Review/status calls do not retrigger themselves.


def test_review_applies_complete_structured_candidate_in_same_call(tmp_path):
    from test_harness_capability_authoring import module_eval, procedure
    method_ref = module_eval("pi_harness_baseline_methods.ts", "m.baselineMethodCatalog().find(x=>x.name==='skill-creator').method_ref")
    entries = [{"component": "skill", "disposition": "create", "reason": "A repeatable check is ready.",
                "next_use": "Next fixture observation", "validation": "Compare stated result with fixture output",
                "candidate": {"component": "skill", "name": "review-fixture", "summary": "Review fixture state",
                              "instructions": "Inspect the fixture state and report uncertainty.",
                              "method": procedure(),
                              "basis_refs": [], "authoring_method_ref": method_ref}}]
    events = _run_fixture(tmp_path, "treatment", steps=[
        {"name": "task_harness", "arguments": {"action": "read_method", "method_name": "skill-creator"}},
        {"name": "task_harness", "arguments": {"action": "review", "review": entries}},
    ])
    result = next(e for e in events if e.get("type") == "tool_execution_end" and e.get("toolName") == "task_harness" and e.get("args", {}).get("action") == "review")
    assert result.get("isError") is not True
    body = json.loads(result["result"]["content"][0]["text"])
    assert body["application_receipt"]["status"] == "applied"
    skills = [json.loads(line) for line in (tmp_path / "task-skills.jsonl").read_text().splitlines()]
    assert skills[-1]["name"] == "review-fixture"


def test_review_normalization_keeps_nested_candidate_without_forwarding_outer_fields():
    result = helper("""(() => {
      const raw = [{component:'skill', disposition:'create', reason:'Ready to author',
        target_version:2, evidence_refs:['observation-1'], authoring_method_ref:'method:skill-creator@v1',
        candidate:{name:'bounded-check', instructions:'Check the bounded input.', untouched:{nested:true}}}];
      const errors = [];
      const entries = h.normalizeHarnessReview(raw, new Set(), errors);
      return {entry:entries.find(item => item.component === 'skill'), errors};
    })()""")
    assert result["entry"]["candidate"] == {
        "name": "bounded-check",
        "instructions": "Check the bounded input.",
        "untouched": {"nested": True},
    }
    assert result["entry"]["component"] == "skill"
    assert result["entry"]["target_version"] == 2
    assert result["entry"]["authoring_method_ref"] == "method:skill-creator@v1"
    assert [item["path"] for item in result["errors"]] == [
        "review[0].next_use", "review[0].validation",
    ]


def test_review_normalization_reports_candidate_conflicts_without_guessing():
    result = helper("""(() => {
      const errors = [];
      h.normalizeHarnessReview([{component:'skill', disposition:'create', reason:'conflict',
        target_version:2, candidate:{component:'tool', target_version:1}}], new Set(), errors);
      return errors;
    })()""")
    assert [item["path"] for item in result] == [
        "review[0].candidate.component",
        "review[0].candidate.target_version",
        "review[0].next_use",
        "review[0].validation",
    ]


def test_invalid_review_retry_uses_full_candidate_and_preserves_intent(tmp_path):
    from test_harness_capability_authoring import module_eval
    method_ref = module_eval("pi_harness_baseline_methods.ts",
        "m.baselineMethodCatalog().find(x=>x.name==='skill-creator').method_ref")
    authored = {"component": "skill", "name": "bounded-check", "description": "Check a bounded input",
                "instructions": "Inspect the input and report uncertainty.", "authoring_method_ref": method_ref,
                "untouched": {"nested": True}}
    intent = {"operation_id": "op-bounded-check", "purpose": "Preserve a reusable bounded check",
              "status": "open", "next_step": "Trial on another input"}
    review = {"component": "skill", "disposition": "create", "reason": "Repeated comparison is useful",
              "next_use": "Next bounded input", "validation": "Compare answer with source input"}
    events = _run_fixture(tmp_path, "treatment", steps=[
        {"name": "task_harness", "arguments": {"action": "read_method", "method_name": "skill-creator"}},
        {"name": "task_harness", "arguments": {"action": "review", "opportunity_id": "harness-opportunity-1", "review": [
            {**review, "candidate": {**authored, "component": "tool"}}],
            "development_intent": intent}},
        {"name": "task_harness", "arguments": {"action": "review", "opportunity_id": "harness-opportunity-1", "review": [
            {**review, "candidate": authored}], "development_intent": intent}},
    ])
    reviews = [event for event in events if event.get("type") == "tool_execution_end"
               and event.get("toolName") == "task_harness" and event.get("args", {}).get("action") == "review"]
    assert reviews[0].get("isError") and "review[0].candidate.component" in json.dumps(reviews[0])
    assert not reviews[1].get("isError"), reviews[1]
    drafts = [json.loads(line) for line in
              (tmp_path / "task-harness-review-drafts.jsonl").read_text(encoding="utf-8").splitlines()]
    assert drafts[0]["entries"][0]["candidate"]["untouched"] == {"nested": True}
    saved = [json.loads(line) for line in
             (tmp_path / "task-harness-reviews.jsonl").read_text(encoding="utf-8").splitlines()]
    assert saved[0]["entries"][3]["candidate"] == authored
    assert saved[0]["development_intents"] == [intent]
    assert not (tmp_path / "task-tools.jsonl").exists()
    skills = [json.loads(line) for line in
              (tmp_path / "task-skills.jsonl").read_text(encoding="utf-8").splitlines()]
    assert len(skills) == 1
    assert skills[0]["name"] == "bounded-check"
    assert skills[0]["instructions"] == authored["instructions"]
