"""Native Pi integration diagnostics; these do not establish real ARC game quality."""
import json
from pathlib import Path
import pytest
from test_pi_external_benchmark_native import _run_fixture


def rows(root, filename):
    return [json.loads(line) for line in (root / filename).read_text(encoding="utf-8").splitlines() if line]


def test_plain_action_labels_preserve_evidence_without_impossible_candidate_selection(tmp_path):
    root = tmp_path / "evidence-only"
    decision = {"hypothesis_id": "local-navigation", "hypothesis": "The shape may move",
                "prediction": "A visible displacement", "next_step": "Compare the returned frame"}
    extension = Path(__file__).with_name("pi_competition_action_fixture.ts")
    events = _run_fixture(root, "treatment", extra_extensions=[extension], steps=[
        {"name": "arc_action", "arguments": {"action": "silent", "decision": decision}},
        {"name": "arc_action", "arguments": {"action": "visible", "decision": {
            **decision, "selection": {"candidate_id": "local-navigation", "candidate_version": 1,
                                      "rationale": "Test the direction"}}}},
        {"name": "task_checkpoint", "arguments": {"action": "inspect"}},
    ])
    assert not [event for event in events if event.get("isError") or event.get("type") == "error"]
    observations = rows(root, "execution-observations.jsonl")
    assert len(observations) == 2
    assert observations[-1]["input"]["decision"]["selection"]["candidate_id"] == "local-navigation"
    views = rows(root, "task-competition-views.jsonl")
    assert not [view for view in views if view.get("record_kind") == "choice"]
    for view in views:
        assert not view["candidates"]
        assert "decision_needed" not in view and "decision_review" not in view
    contexts = rows(root, "provider-contexts.jsonl")
    texts = [part.get("text", "") for item in contexts for message in item["context"].get("messages", [])
             for part in message.get("content", []) if isinstance(part, dict)]
    projections = [json.loads(text.split(": ", 1)[1]) for text in texts if text.startswith("CURRENT COMPETITION VIEW:")]
    assert projections and all("decision_needed" not in view and "decision_review" not in view for view in projections)
    assert projections[-1]["unstructured_claims"][0]["hypothesis"] == decision["hypothesis"]
    assert projections[-1]["facts"][-1]["changed_cells"] == 4
    assert rows(root, "task-validations.jsonl")[-1]["prediction"] == decision["prediction"]
    assert json.loads((root / "task-checkpoint.json").read_text(encoding="utf-8"))["hypothesis"] == decision["hypothesis"]

    # A fresh Pi process must not reconstruct an impossible selection obligation.
    _run_fixture(root, "treatment", extra_extensions=[extension], steps=[
        {"name": "arc_action", "arguments": {"action": "silent", "decision": decision}},
        {"name": "task_checkpoint", "arguments": {"action": "inspect"}},
    ])
    assert len(rows(root, "execution-observations.jsonl")) == 3
    assert not [view for view in rows(root, "task-competition-views.jsonl") if view.get("record_kind") == "choice"]


def test_research_line_new_action_evidence_is_visible_without_advancing_agenda(tmp_path):
    agenda = {"agenda_id": "line-a", "version": 1, "status": "continue",
              "research_line_ref": "research_line:line-a@v1", "question": "Which region responds?",
              "last_report_ref": "research_report:prior@v1", "history_cursor": {"observation": 0}}
    (tmp_path / "auto-research-agenda.jsonl").write_text(json.dumps(agenda) + "\n", encoding="utf-8")
    _run_fixture(tmp_path, "treatment", extra_extensions=[Path(__file__).with_name("pi_competition_action_fixture.ts")],
                 steps=[{"name": "arc_action", "arguments": {"action": "level"}},
                        {"name": "task_checkpoint", "arguments": {"action": "inspect"}}])
    texts = [part.get("text", "") for context in rows(tmp_path, "provider-contexts.jsonl")
             for message in context["context"].get("messages", [])
             for part in message.get("content", []) if isinstance(part, dict)]
    cue = next(text for text in texts if text.startswith("Auto-Research evidence update:"))
    cards, _ = json.JSONDecoder().raw_decode(cue.split(": ", 1)[1])
    assert cards[0]["research_line_ref"] == agenda["research_line_ref"]
    assert cards[0]["stage_boundary_refs"] == ["observation:execution-observation-1@v1"]
    assert cards[0]["ready_call"]["arguments"]["evidence_refs"] == ["observation:execution-observation-1@v1"]
    assert len(rows(tmp_path, "auto-research-agenda.jsonl")) == 1
    assert not (tmp_path / "auto-research-sessions.jsonl").exists()
    exposures = rows(tmp_path, "task-harness-context-exposures.jsonl")
    assert any(item.get("research_line_refs") == [agenda["research_line_ref"]]
               for exposure in exposures for item in exposure.get("guidance_exposures", []))


def test_research_continuation_keeps_lines_separate_and_stops_without_new_evidence():
    from test_harness_capability_authoring import module_eval
    value = module_eval("pi_auto_research_agenda.ts", """(() => {
      const agenda = {agenda_id:'a',version:2,status:'continue',research_line_ref:'research_line:a@v1'};
      const input = {agenda,catalog:{new_resource_refs:[]},newActionRefs:['observation:new@v1'],stageBoundaryRefs:[],active:false};
      return [m.researchContinuationCard(input),m.researchContinuationCard({...input,active:true}) ?? null,
        m.researchContinuationCard({...input,newActionRefs:[]}) ?? null,
        m.researchContinuationCard({...input,agenda:{...agenda,status:'drop'}}) ?? null];
    })()""")
    assert value[0]["ready_call"]["arguments"]["research_line_ref"] == "research_line:a@v1"
    assert value[1:] == [None, None, None]


def test_native_pi_batch_actions_advance_each_decision_state(tmp_path):
    root = tmp_path / "batch"
    _run_fixture(root, "treatment", extra_extensions=[Path(__file__).with_name("pi_competition_action_fixture.ts")],
                 steps=[{"name": "arc_actions", "arguments": {"actions": [
                     {"action": "silent"}, {"action": "visible"}]}}])
    observations = rows(root, "execution-observations.jsonl")
    actions = [row for row in observations if row["tool_name"] == "arc_action"]
    assert len(actions) == 2
    assert [row["batch_index"] for row in actions] == [0, 1]
    checkpoint = json.loads((root / "task-checkpoint.json").read_text(encoding="utf-8"))
    assert checkpoint["latest_environment"]["action_budget"]["total_used"] == 2
    assert [row["action"] for row in checkpoint["recent_actions"]] == ["silent", "visible"]


def test_parent_can_skip_exact_research_candidate_without_starting_child(tmp_path):
    from test_task_research_context import _run_fixture as run_research_fixture, results
    candidate = {"candidate_id": "bounded-topic", "version": 1, "status": "available", "fingerprint": "original-material",
                 "reason": "A bounded comparison", "research_call": {"action": "start"}, "evidence_refs": []}
    (tmp_path / "auto-research-opportunities.jsonl").write_text(json.dumps(candidate) + "\n", encoding="utf-8")
    events = run_research_fixture(tmp_path, "treatment", extra_extensions=[Path(__file__).with_name("pi_non_arc_task_subagents.ts")],
        steps=[{"name": "auto_research", "arguments": {"action": "skip", "research_candidate_ref": "research_candidate:bounded-topic@v1",
                                                        "research_reason": "Current evidence already answers this question."}},
               {"name": "task_harness", "arguments": {"action": "status"}},
               {"name": "auto_research", "arguments": {"action": "skip", "research_candidate_ref": "research_candidate:bounded-topic@v1",
                                                        "research_reason": "Stale retry must not decide a new version."}}])
    outputs = results(events, "auto_research")
    assert not outputs[0].get("isError")
    assert outputs[1].get("isError")
    decisions = rows(tmp_path, "auto-research-opportunities.jsonl")
    assert [(row["version"], row["status"]) for row in decisions] == [(1, "available"), (2, "skipped")]
    assert decisions[-1]["fingerprint"] == "original-material"
    assert decisions[-1]["decided_by"] == "parent"
    status = results(events, "task_harness")[-1]["result"]["details"]
    assert not status["cross_context_research_candidates"]
    assert not (tmp_path / "auto-research-runs.jsonl").exists()


def test_changed_material_reopens_skipped_candidate_but_state_reads_do_not_create_method_candidates(tmp_path):
    from test_harness_capability_authoring import module_eval
    from test_task_research_context import _run_fixture as run_research_fixture, results
    observations = [{"observation_id": f"action-{i}", "tool_name": "arc_action", "input": {"action": "ACTION1"},
                     "arc_outcome": {"pre_action_state": {"fingerprint": f"state-{i}"}, "levels_completed": 0}} for i in range(2)]
    draft = module_eval("pi_research_method_runtime.ts", f"m.buildCrossContextResearchCandidates({{observations:{json.dumps(observations)}}})[0]")
    candidate_ref = f"research_candidate:{draft['candidate_id']}@v1"
    (tmp_path / "execution-observations.jsonl").write_text("".join(json.dumps(row) + "\n" for row in observations), encoding="utf-8")
    (tmp_path / "auto-research-opportunities.jsonl").write_text(json.dumps(draft) + "\n", encoding="utf-8")
    run_research_fixture(tmp_path, "treatment", extra_extensions=[Path(__file__).with_name("pi_non_arc_task_subagents.ts")],
                         steps=[{"name": "auto_research", "arguments": {"action": "skip", "research_candidate_ref": candidate_ref,
                                                                         "research_reason": "Evidence is sufficient for current decisions."}}])
    with (tmp_path / "execution-observations.jsonl").open("a", encoding="utf-8") as stream:
        stream.write(json.dumps({**observations[-1], "observation_id": "action-new", "arc_outcome": {"pre_action_state": {"fingerprint": "new-state"}, "levels_completed": 0}}) + "\n")
    events = run_research_fixture(tmp_path, "treatment", extra_extensions=[Path(__file__).with_name("pi_non_arc_task_subagents.ts")],
                                 steps=[{"name": "task_harness", "arguments": {"action": "status"}}])
    entries = rows(tmp_path, "auto-research-opportunities.jsonl")
    assert [(entry["version"], entry["status"]) for entry in entries] == [(1, "available"), (2, "skipped"), (3, "available")]
    assert entries[-1]["fingerprint"] != entries[1]["fingerprint"]
    assert "action-new" in entries[-1]["evidence_refs"]
    assert results(events, "task_harness")[-1]["result"]["details"]["cross_context_research_candidates"][0]["candidate_ref"].endswith("@v3")
    state_reads = [{**row, "tool_name": "arc_state", "input": {"request": "full"}} for row in observations]
    assert module_eval("pi_research_method_runtime.ts", f"m.buildCrossContextResearchCandidates({{observations:{json.dumps(state_reads)}}})") == []


def test_native_level_change_marks_prior_reasoning_stale_until_parent_updates(tmp_path):
    root = tmp_path / "level_change"
    _run_fixture(root, "treatment", extra_extensions=[Path(__file__).with_name("pi_competition_action_fixture.ts")], steps=[
        {"name": "task_checkpoint", "arguments": {"action": "update", "task_goal": "Solve level zero",
            "current_strategy": "Old level rule", "next_step": "OLD-NEXT-STEP"}},
        {"name": "arc_action", "arguments": {"action": "level"}},
        {"name": "task_checkpoint", "arguments": {"action": "inspect"}},
        {"name": "task_checkpoint", "arguments": {"action": "update", "task_goal": "Explore level one", "next_step": "NEW-NEXT-STEP"}},
        {"name": "task_checkpoint", "arguments": {"action": "inspect"}},
    ])
    cards = []
    for context in rows(root, "provider-contexts.jsonl"):
        for message in context["context"].get("messages", []):
            for part in message.get("content", []) if isinstance(message.get("content"), list) else []:
                if part.get("text", "").startswith("CURRENT TASK STATE "):
                    cards.append(json.loads(part["text"].split(": ", 1)[1]))
    stale = next(card for card in cards if card.get("reasoning_state_update", {}).get("reason") == "level_changed")
    assert "next_step" not in stale
    assert "next_step" in stale["reasoning_state_update"]["stale_fields"]
    # The current V2 card omits stale prose; the exact checkpoint remains recoverable.
    historical = rows(root, "task-checkpoint-resources.jsonl")
    stale_resource = next(row for row in historical if row["version"] == int(stale["checkpoint_ref"].split("@v")[1]))
    assert stale_resource["state"]["next_step"] == "OLD-NEXT-STEP"
    assert cards[-1]["next_step"] == "NEW-NEXT-STEP"
    assert "current_strategy" not in cards[-1]


def test_native_pi_exposes_failed_experiment_and_competitor_on_later_request(tmp_path):
    root = tmp_path / "competition"
    decision = {"hypothesis_id": "hidden", "hypothesis_version": 1,
                "hypothesis": "Clicks accumulate hidden marks", "prediction": "two actions cause visible change",
                "validation_window": {"test_id": "hidden-two", "actions": 2, "mode": "final",
                                      "predicate": {"field": "changed_cells", "op": "gte", "value": 1}}}
    _run_fixture(root, "treatment", extra_extensions=[Path(__file__).with_name("pi_competition_action_fixture.ts")], steps=[
        {"name": "task_checkpoint", "arguments": {"action": "update", "candidate_updates": [
            {"id": "hidden", "kind": "rule", "status": "proposed", "question_id": "interactivity",
             "claim": "Clicks accumulate hidden marks", "prediction": "two actions cause visible change",
             "next_test": "a finite two-action test"},
            {"id": "other-region", "kind": "rule", "status": "proposed", "question_id": "interactivity",
             "claim": "This region is inert; other regions may be interactive", "prediction": "a contrasting region changes",
             "options": [{"action": "sample another region", "cost": "1 action", "risk": "unknown",
                          "branches": "change: inspect the region; no change: widen tested coverage"}]},
        ], "selected_candidate_id": "hidden"}},
        {"name": "arc_action", "arguments": {"action": "silent", "decision": decision}},
        {"name": "arc_action", "arguments": {"action": "silent", "decision": decision}},
        {"name": "task_checkpoint", "arguments": {"action": "inspect"}},
    ], context_max_chars=12000)
    latest = rows(root, "task-validations.jsonl")[-1]
    assert latest["experiment"]["outcome"] == "not_met"
    assert latest["experiment"]["actions_used"] == 2
    contexts = rows(root, "provider-contexts.jsonl")
    text = json.dumps(contexts[-1]["context"], ensure_ascii=False)
    assert "not_met" in text
    assert "other regions may be interactive" in text
    assert "change: inspect the region" in text
    assert "changed_cells" in text
    assert text.count("CURRENT COMPETITION VIEW:") == 1
    captures = rows(root, "task-memory.jsonl")
    assert any(row.get("probe_record", {}).get("observed_outcome", {}).get("changed_cells") == 0 for row in captures)


@pytest.mark.parametrize("tool", ["auto_research", "delegate_task"])
def test_native_child_receives_authorized_comparison_through_length_continuation(tmp_path, tool):
    from test_pi_external_benchmark_native import _pi_cli
    from test_task_research_context import _run_fixture as run_research_fixture, results
    _, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    root = tmp_path / tool
    report = {"format": "auto-research-report-v1", "status": "inconclusive", "conclusion": "The zero-change sample cannot distinguish explanations.",
              "findings": [], "evidence_refs": ["observation:execution-observation-1@v1"], "alternatives": ["test another region"],
              "limitations": ["one tested region"], "validation_plan": "Request a contrast", "method_candidates": []}
    arguments = {"action": "start", "question": "Compare the explanations using the public action evidence.",
                 "evidence_refs": ["observation:execution-observation-1@v1"]} if tool == "auto_research" else {
                     "instructions": "Compare only the granted evidence", "task": "Return a bounded comparison", "tools": [],
                     "resource_refs": ["strategy_candidate:hidden@v1"], "evidence_refs": ["observation:execution-observation-1@v1"]}
    events = run_research_fixture(root, "treatment", extra_extensions=[
        project / "tests/pi_competition_action_fixture.ts", project / "tests/pi_non_arc_task_subagents.ts"],
        extra_env={"PI_AUTORESEARCH_PI_CLI": cli, "PI_AUTORESEARCH_PROVIDER": "offline-subagent-test", "PI_AUTORESEARCH_MODEL": "scripted",
                   "PI_AUTORESEARCH_SUBAGENT_PROVIDER_EXTENSION": str(project / "tests/pi_subagent_provider.ts"),
                   "PI_SUBAGENT_FORCE_LENGTH_ONCE": "1", "PI_SUBAGENT_REPORT": json.dumps(report),
                   "PI_SUBAGENT_STEPS": json.dumps([{"name": "submit_research_report", "arguments": {"report": report}}])},
        steps=[{"name": "arc_action", "arguments": {"action": "silent"}},
               {"name": "task_checkpoint", "arguments": {"action": "update", "candidate_updates": [
                   {"id": "hidden", "kind": "rule", "status": "proposed", "question_id": "q", "claim": "center may accumulate marks",
                    "prediction": "a bounded sequence will visibly change it", "support_refs": ["observation:execution-observation-1@v1"]},
                   {"id": "other", "kind": "rule", "status": "proposed", "question_id": "q", "claim": "PARENT-ONLY-CANDIDATE: another region may be interactive",
                    "prediction": "a contrasting region changes"}], "selected_candidate_id": "hidden"}},
               {"name": tool, "arguments": arguments},
               *([{"name": "arc_action", "arguments": {"action": "visible"}},
                  {"name": "task_checkpoint", "arguments": {"action": "inspect"}}] if tool == "auto_research" else [])])
    result = results(events, tool)[-1]
    assert not result.get("isError"), result
    payload = json.dumps(rows(root, "subagent-provider-contexts.jsonl"), ensure_ascii=False)
    assert "center may accumulate marks" in payload
    assert "bounded sequence will visibly change it" in payload
    assert "changed_cells" in payload
    assert ("PARENT-ONLY-CANDIDATE" in payload) == (tool == "auto_research")
    continuation_file = "auto-research-continuations.jsonl" if tool == "auto_research" else "subagent-continuations.jsonl"
    assert any(row.get("stop_reason") == "length" for row in rows(root, continuation_file))
    if tool == "auto_research":
        assert not (root / "auto-research-agenda.jsonl").exists()  # Explicit report without progress.
        sessions = rows(root, "auto-research-sessions.jsonl")
        assert sessions[-1]["history_cursor"]["observation"] == 1
        texts = [part.get("text", "") for context in rows(root, "provider-contexts.jsonl")
                 for message in context["context"].get("messages", []) for part in message.get("content", [])
                 if isinstance(part, dict)]
        cue = next(text for text in texts if text.startswith("Auto-Research evidence update:"))
        card = json.JSONDecoder().raw_decode(cue.split(": ", 1)[1])[0][0]
        assert card["evidence_refs"] == ["observation:execution-observation-2@v1"]
        assert card["last_report_ref"] == "research_report:auto-research-1@v1"
        assert card["ready_call"]["arguments"]["research_line_ref"] == sessions[-1]["research_line_ref"]
        assert len(rows(root, "auto-research-runs.jsonl")) == 1  # Rendering never starts a worker.


def test_identical_research_reuses_report_but_explicit_reinterpretation_starts_child(tmp_path):
    from test_pi_external_benchmark_native import _pi_cli
    from test_task_research_context import _run_fixture as run_research_fixture, results
    _, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    root = tmp_path / "reuse"
    report = {"format": "auto-research-report-v1", "status": "inconclusive", "conclusion": "An experiment is still needed.",
              "findings": [], "evidence_refs": [], "alternatives": [], "limitations": ["no environment test"],
              "validation_plan": "request a contrast", "method_candidates": []}
    request = {"action": "start", "question": "Which observable experiment can separate the explanations?", "scope": "rules"}
    events = run_research_fixture(root, "treatment", extra_extensions=[project / "tests/pi_non_arc_task_subagents.ts"],
        extra_env={"PI_AUTORESEARCH_PI_CLI": cli, "PI_AUTORESEARCH_PROVIDER": "offline-subagent-test", "PI_AUTORESEARCH_MODEL": "scripted",
                   "PI_AUTORESEARCH_SUBAGENT_PROVIDER_EXTENSION": str(project / "tests/pi_subagent_provider.ts"),
                   "PI_SUBAGENT_REPORT": json.dumps(report), "PI_SUBAGENT_STEPS": json.dumps([{"name": "submit_research_report", "arguments": {"report": report}}])},
        steps=[{"name": "auto_research", "arguments": request}, {"name": "auto_research", "arguments": request},
               {"name": "auto_research", "arguments": {**request, "review_reason": "independently reconsider the test assumptions"}}])
    outcomes = results(events, "auto_research")
    assert not any(r.get("isError") for r in outcomes)
    assert outcomes[1]["result"]["details"]["reused"] is True
    assert len(rows(root, "subagent-provider-contexts.jsonl")) == 2
    assert "independently reconsider" in json.dumps(rows(root, "subagent-provider-contexts.jsonl")[-1])
