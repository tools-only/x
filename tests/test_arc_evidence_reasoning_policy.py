import pytest
from autoresearch_pi.reasoning_policy import select_reasoning_level, validate_reasoning_options

def test_geometry_batch_consumes_each_fact_without_reopening_old_facts():
    from autoresearch_pi.reasoning_policy import evidence_reasoning_opportunity, consumed_opportunity_keys
    cp = {'recent_actions': [{'action':'ACTION1','changed_cells':2,'observation_id':'a','level_after':0}]}
    consumed = {'first-effect:level-0:a'}
    state = {'geometry_evidence': {'level':0, 'facts':['stationary-a','pattern-b']}}
    key, reason = evidence_reasoning_opportunity(cp, state, consumed)
    assert reason == 'new_exact_geometry_evidence'
    consumed.update(consumed_opportunity_keys(key))
    assert evidence_reasoning_opportunity(cp, state, consumed)[0] is None
    state['geometry_evidence']['facts'].reverse()
    assert evidence_reasoning_opportunity(cp, state, consumed)[0] is None
    cp['recent_actions'].append({'action':'RESET','changed_cells':20,'level_after':0})
    assert evidence_reasoning_opportunity(cp, state, consumed)[0] is None
    state['geometry_evidence']['facts'].append('stationary-new-anchor')
    new, _ = evidence_reasoning_opportunity(cp, state, consumed)
    assert new != key
    consumed.update(consumed_opportunity_keys(new))
    # Retiring bounded witnesses cannot reopen the remaining consumed facts.
    state['geometry_evidence']['facts'] = ['pattern-b']
    assert evidence_reasoning_opportunity(cp, state, consumed)[0] is None
    state['geometry_evidence']['level'] = 1  # stale cross-level metadata
    assert evidence_reasoning_opportunity(cp, state, consumed)[0] is None
    cp['recent_actions'][-1]['level_after'] = 1
    assert evidence_reasoning_opportunity(cp, state, consumed)[1] == 'new_exact_geometry_evidence'

def test_geometry_metadata_does_not_change_other_policies_or_empty_initial():
    from autoresearch_pi.reasoning_policy import evidence_reasoning_opportunity
    assert evidence_reasoning_opportunity({}, {'geometry_evidence':{'level':0,'facts':[]}})[1] == 'initial_discovery'
    cp={'recent_actions':[{'action':'ACTION1','changed_cells':2,'observation_id':'a','level_after':0}]}
    state={'geometry_evidence':{'level':0,'facts':['a','b']}}
    assert select_reasoning_level(cp,state,'adaptive-binary',('off','medium'),{'first-effect:initial:a'})[0]=='off'

def test_low_followthrough_requires_no_active_plan_and_preserves_open_goal():
    levels=("low","medium")
    checkpoint={"decision_state":{"knowledge_gaps":[{"kind":"goal_rule","question":"Unknown target"}]}}
    assert select_reasoning_level(checkpoint,{},"adaptive-evidence",levels)==("medium","initial_discovery")
    assert select_reasoning_level(checkpoint,{},"adaptive-evidence",levels,{"initial-discovery"})==("low","bounded_followthrough")
    assert checkpoint["decision_state"]["knowledge_gaps"][0]["question"]=="Unknown target"

def test_reset_does_not_forget_an_already_observed_effect_and_reinvest_in_it():
    levels=("low","medium")
    actions=[{"action":"ACTION6","changed_cells":38,"observation_id":"a","level_after":0}]
    first=select_reasoning_level({"recent_actions":actions},{},"adaptive-evidence",levels)
    assert first==("medium","first_persistent_visual_effect_planning")
    consumed={"first-effect:level-0:a"}
    actions += [{"action":"RESET","changed_cells":38,"observation_id":"r","level_after":0},
                {"action":"ACTION6","changed_cells":38,"observation_id":"b","level_after":0}]
    assert select_reasoning_level({"recent_actions":actions},{},"adaptive-evidence",levels,consumed)==("low","bounded_followthrough")

def test_explicit_capability_is_required():
    validate_reasoning_options("adaptive-evidence",("low","medium"),65536)
    with pytest.raises(ValueError): validate_reasoning_options("adaptive-evidence",("medium",),65536)


def test_counter_text_and_placeholders_do_not_create_new_compute_identity():
    from copy import deepcopy
    from autoresearch_pi.reasoning_policy import evidence_reasoning_opportunity
    initial = {"decision_state": {"counterevidence": ["None yet."]}}
    assert evidence_reasoning_opportunity(initial, {}) == ("initial-discovery", "initial_discovery")
    checkpoint = {"recent_actions": [{"action": "ACTION1", "changed_cells": 2,
                   "observation_id": "first", "level_after": 0}],
                  "decision_state": {"counterevidence": ["This edit did not advance the level."]}}
    original = deepcopy(checkpoint)
    first, _ = evidence_reasoning_opportunity(checkpoint, {})
    for text in ["Still no advance.", "The goal is not solved.", "Counterexample: partial edits are insufficient."]:
        checkpoint['decision_state']['counterevidence'] = [text]
        assert evidence_reasoning_opportunity(checkpoint, {}, {first})[0] is None
        assert checkpoint['decision_state']['counterevidence'] == [text]
    assert original['decision_state']['counterevidence'] == ["This edit did not advance the level."]


def test_structured_failure_identity_ignores_prose_but_reopens_on_new_evidence():
    from autoresearch_pi.reasoning_policy import evidence_reasoning_opportunity
    checkpoint = {"recent_actions": [{"action": "ACTION1", "changed_cells": 0,
                                      "observation_id": "one", "level_after": 0}]}
    state = {"plan": {"plan_id": "p", "current_step": 1, "candidate_version": 2,
                       "needs_reconciliation": True, "updated_at": "old", "change_reason": "A wall",
                       "last_step_outcome": {"status": "mismatch", "observation_ref": "observation:one@v1",
                                             "details": "A mismatch"}}}
    first, _ = evidence_reasoning_opportunity(checkpoint, state)
    state['plan'].update(updated_at='new', change_reason='Rephrased wall', steps=[{'text': 'New prose'}])
    state['plan']['last_step_outcome']['details'] = 'Rephrased mismatch'
    assert evidence_reasoning_opportunity(checkpoint, state, {first})[0] is None
    state['plan']['last_step_outcome']['observation_ref'] = 'observation:two@v1'
    assert evidence_reasoning_opportunity(checkpoint, state, {first})[0] != first


def test_candidate_order_and_counter_prose_do_not_duplicate_a_failure():
    from autoresearch_pi.reasoning_policy import evidence_reasoning_opportunity
    checkpoint = {"decision_state": {"counterevidence": ["A failed guess"]}}
    state = {"candidates": [{'id': 'a', 'version': 1, 'status': 'challenged'},
                            {'id': 'b', 'version': 2, 'status': 'challenged'}]}
    first, _ = evidence_reasoning_opportunity(checkpoint, state)
    state['candidates'].reverse()
    checkpoint['decision_state']['counterevidence'] = ['The same failed guess reworded']
    assert evidence_reasoning_opportunity(checkpoint, state)[0] == first


def test_new_public_evidence_batch_still_reopens_compute_with_old_counter():
    from autoresearch_pi.reasoning_policy import evidence_reasoning_opportunity
    checkpoint = {'recent_actions': [], 'decision_state': {'counterevidence': ['No level yet']}}
    consumed = set()
    for i in range(1, 5):
        checkpoint['recent_actions'].append({'action':'ACTION1','changed_cells':2,
                                           'observation_id':str(i),'level_after':0})
        key, reason = evidence_reasoning_opportunity(checkpoint, {}, consumed)
        if key: consumed.add(key)
    assert key is not None and reason == 'visible_effects_without_level_transition'


def test_new_level_and_explicit_counterevidence_reopen_investment_once():
    from autoresearch_pi.reasoning_policy import evidence_reasoning_opportunity
    levels=("low","medium")
    checkpoint={"recent_actions":[
        {"action":"ACTION6","changed_cells":36,"observation_id":"old","level_after":0},
        {"action":"ACTION6","changed_cells":100,"observation_id":"transition",
         "level_changed":True,"level_after":1}]}
    key,reason=evidence_reasoning_opportunity(checkpoint,{})
    assert reason=="new_level"
    assert select_reasoning_level(checkpoint,{},"adaptive-evidence",levels,{key})==("low","bounded_followthrough")
    checkpoint["recent_actions"].append({"action":"ACTION6","changed_cells":36,
        "observation_id":"new","level_after":1})
    assert select_reasoning_level(checkpoint,{},"adaptive-evidence",levels,{key,"first-effect:level-0:old"}) == (
        "medium","first_persistent_visual_effect_planning")
    challenge={"candidates":[{"id":"goal","version":2,"status":"challenged"}]}
    challenge_key,reason=evidence_reasoning_opportunity(checkpoint,challenge)
    assert reason=="explicit_counterevidence_or_plan_failure"
    first_effect=evidence_reasoning_opportunity(checkpoint,{})[0]
    assert select_reasoning_level(checkpoint,challenge,"adaptive-evidence",levels,{challenge_key,first_effect,key}) == (
        "low","bounded_followthrough")
    challenge["candidates"][0]["version"]=3
    assert select_reasoning_level(checkpoint,challenge,"adaptive-evidence",levels,{challenge_key,first_effect,key})[0]=="medium"
