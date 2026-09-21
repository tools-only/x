"""Behavioral diagnostics for deterministic control contracts and native Pi tools."""
import json
import subprocess
from pathlib import Path

from test_pi_external_benchmark_native import _pi_cli, _run_fixture
from test_harness_review import helper, handoff_helper
from test_task_research_context import records, results


def periodic_steps():
    return [*[{'name':'arc_action','arguments':{}} for _ in range(5)],
        {'name':'task_harness','arguments':{'action':'review','review':[], 'transition_analysis':{
            'observed_changes':'Fixture returned completion', 'predictive_rules':'Unknown',
            'limiting_uncertainty':'No state', 'next_experiment':'Read state',
            'capability_opportunities':'Unknown', 'evidence_refs':['execution-observation-1']}}}]


def control(expression):
    node, _ = _pi_cli()
    module = Path(__file__).resolve().parents[1] / "demo/pi_harness_control.ts"
    result = subprocess.run([node, "--experimental-strip-types", "--input-type=module", "-e",
        f'import * as h from {json.dumps(module.as_uri())}; console.log(JSON.stringify({expression}));'],
        capture_output=True, text=True, check=True)
    return json.loads(result.stdout)


def test_partial_review_retains_semantics_and_marks_runtime_defaults():
    value = helper("""h.normalizeHarnessReview([{component:'skill', disposition:'create', reason:'Repeated comparison',
      patterns:[{pattern:'compare', evidence_refs:['o1'], applicability:'same level', counterexamples:'unknown',
        candidate:'Compare before and after.', next_use:'Next action', validation:'Expected delta matches'}]}], new Set())""")
    assert len(value) == 6
    skill = next(e for e in value if e['component'] == 'skill')
    assert skill['next_use'] == 'Next action'
    assert skill['validation'] == 'Expected delta matches'
    assert all(e['disposition'] == 'defer' and e['source'] == 'runtime_default'
               for e in value if e['component'] != 'skill')
    assert helper("h.normalizeHarnessReview([{component:'memory', disposition:'keep', reason:'Still useful'}], new Set())[0].disposition") == 'reuse'


def test_review_component_is_inferred_from_complete_candidate():
    value = helper("""h.normalizeHarnessReview([
      {disposition:'update', reason:'State changed', next_use:'Plan next move', validation:'Check next delta',
       candidate:{semantic_kind:'task_state',name:'map',content:'Current map'}},
      {disposition:'create', reason:'Repeated procedure', next_use:'Route next move', validation:'Prediction matches',
       candidate:{type:'task_skill',name:'route',content:'Decode, plan, verify'}}], new Set())""")
    assert next(e for e in value if e['component'] == 'memory')['candidate']['name'] == 'map'
    assert next(e for e in value if e['component'] == 'skill')['candidate']['name'] == 'route'


def test_review_errors_are_aggregated_and_do_not_invent_semantic_content():
    value = helper("""(() => { try { h.normalizeHarnessReview([
      {component:'skill', disposition:'create', reason:''}, {component:'tool', disposition:'invent', reason:'x'}], new Set()); }
      catch(e) { return JSON.parse(e.message); } })()""")
    assert value['applied'] is False
    assert {'review[0].reason', 'review[0].next_use', 'review[0].validation', 'review[1].disposition'} <= {e['path'] for e in value['errors']}
    assert value['repair_template']['action'] == 'review'


def test_runtime_selection_never_guesses_between_candidates_or_rebinds_bad_id():
    value = control("""(() => {
      const rows=[{id:'a',version:1},{id:'b',version:2}];
      const errors=[];
      for(const id of [undefined,'missing']) { try { h.selectControlTarget(rows,'id',id); }
        catch(e) { errors.push(JSON.parse(e.message)); } }
      return {one:h.selectControlTarget(rows.slice(0,1),'id'),errors};
    })()""")
    assert value['one']['id'] == 'a'
    assert [e['code'] for e in value['errors']] == ['required_selection', 'unknown_reference']
    assert len(value['errors'][0]['candidates']) == 2


def test_historical_evidence_is_classified_but_unknown_or_future_refs_rejected():
    value = helper("""(() => {
      const good={observed_changes:'moved',predictive_rules:'same as earlier',limiting_uncertainty:'why',
        next_experiment:'repeat',capability_opportunities:'compare',evidence_refs:['now','old']};
      const accepted=h.validateTransitionAnalysis(good,new Set(['now']),new Set(['old','now']));
      const errors=[];
      for(const refs of [['old'],['now','missing']]) {try {
        h.validateTransitionAnalysis({...good,evidence_refs:refs},new Set(['now']),new Set(['old','now']));
      } catch(e) {errors.push(String(e.message));}}
      return {accepted,errors};
    })()""")
    assert value['accepted']['window_evidence_refs'] == ['now']
    assert value['accepted']['historical_evidence_refs'] == ['old']
    assert len(value['errors']) == 2


def test_handoff_unique_binding_manual_reactivation_and_terminal_protection():
    value = handoff_helper("""(() => {
      const proposed={handoff_id:'h',version:1,status:'proposed'};
      const deferred=h.advanceResearchHandoff(proposed,{status:'deferred',resume_condition:{kind:'manual'}});
      const reopened=h.advanceResearchHandoff(deferred,{status:'proposed'});
      let rejected=false; try {h.advanceResearchHandoff({...proposed,status:'completed'},{status:'proposed'});}catch{rejected=true;}
      return {selected:h.resolveResearchHandoff([proposed]),deferred,reopened,rejected};
    })()""")
    assert value['selected']['handoff_id'] == 'h'
    assert value['deferred']['next_call']['research_decision'] == 'reactivate'
    assert value['reopened']['version'] == 3
    assert value['rejected'] is True


def test_failure_keys_separate_actions_targets_and_versions():
    value = control("""[
      h.controlOperationKey('task_harness',{action:'review',opportunity_id:'o1'},'task'),
      h.controlOperationKey('task_harness',{action:'decide_research',research_handoff_ref:'research_handoff:h@v1'},'task'),
      h.controlOperationKey('task_harness',{action:'decide_research',research_handoff_ref:'research_handoff:h@v2'},'task'),
      h.controlOperationKey('task_harness',{action:'review',opportunity_id:'o2'},'task')
    ]""")
    assert len(set(value)) == 4


def test_failure_binding_ignores_settled_windows_and_returns_ready_refs():
    value = control("""(() => {
      const files={'task-harness-opportunities.jsonl':[{opportunity_id:'old',window:{window_id:'w1'}},{opportunity_id:'new',window:{window_id:'w2'}}],
        'task-harness-review-events.jsonl':[{window_id:'w1',status:'failed'}]};
      const bound=h.bindOperationIdentity('task_harness',{action:'review'},file=>files[file]??[]);
      let error;try {h.selectControlTarget([{handoff_id:'a',version:2},{handoff_id:'b',version:3}],'handoff_id');}catch(e){error=JSON.parse(e.message);}
      return {bound,error};
    })()""")
    assert value['bound']['opportunity_id'] == 'new'
    assert [c['research_handoff_ref'] for c in value['error']['candidates']] == ['research_handoff:a@v2','research_handoff:b@v3']


def test_skip_binding_excludes_deferred_handoffs():
    value = control("""(() => {
      const files={'auto-research-handoffs.jsonl':[
        {handoff_id:'old-a',version:2,status:'deferred'},
        {handoff_id:'old-b',version:4,status:'deferred'},
        {handoff_id:'current',version:1,status:'proposed'}]};
      return h.bindOperationIdentity('task_harness',
        {action:'decide_research',research_decision:'skip'},file=>files[file]??[]);
    })()""")
    assert value['research_handoff_ref'] == 'research_handoff:current@v1'


def test_terminal_control_errors_are_not_retryable_pending_operations():
    value = control("h.failureClassification(JSON.stringify({format:'task-control-error-v1',code:'required_selection',candidates:[],retryable:true}))")
    assert value['retryable'] is False


def test_startup_retires_stale_pending_harness_operations(tmp_path):
    project = Path(__file__).resolve().parents[1]
    checkpoint = {
        'format': 'task-local-checkpoint-v1', 'revision': 1, 'patch_sequence': 0,
        'harness_started': True, 'recent_observations': [], 'decision_refs': [],
        'pending_operations': [
            {'resource_ref': 'failure:failure-2@v1', 'operation_key': '{"action":"upsert"}',
             'retryable': False, 'error': '{"format":"task-control-error-v1","code":"required_field"}'},
            {'resource_ref': 'failure:failure-3@v1', 'tool': 'task_harness', 'action': 'review',
             'operation_key': '{"action":"review","target":{"opportunity_id":"old"}}',
             'retryable': True},
            {'resource_ref': 'failure:failure-11@v1', 'tool': 'task_harness', 'action': 'decide_research',
             'operation_key': '{"action":"decide_research","target":{"research_decision":"skip"}}',
             'retryable': True},
        ],
        'recordedAt': '2026-09-18T00:00:00.000Z',
    }
    (tmp_path / 'task-checkpoint.json').write_text(json.dumps(checkpoint) + '\n', encoding='utf-8')
    (tmp_path / 'task-harness-opportunities.jsonl').write_text(
        json.dumps({'opportunity_id': 'old', 'window': {'window_id': 'w-old'}}) + '\n', encoding='utf-8')
    (tmp_path / 'task-harness-review-events.jsonl').write_text(
        json.dumps({'window_id': 'w-old', 'status': 'failed'}) + '\n', encoding='utf-8')
    (tmp_path / 'auto-research-handoffs.jsonl').write_text(
        json.dumps({'handoff_id': 'deferred', 'version': 2, 'status': 'deferred'}) + '\n', encoding='utf-8')

    _run_fixture(tmp_path, 'treatment', steps=[
        {'name': 'task_harness', 'arguments': {'action': 'inspect'}},
    ])

    repaired = json.loads((tmp_path / 'task-checkpoint.json').read_text(encoding='utf-8'))
    assert repaired['pending_operations'] == []
    resolutions = records(tmp_path, 'task-operation-resolutions.jsonl')
    assert [item['resolution_kind'] for item in resolutions] == ['retired', 'retired', 'retired']
    assert all(item['resolved_by'] == 'runtime_reconciliation' for item in resolutions)


def test_legacy_review_pattern_without_pattern_uses_candidate_text():
    value = helper("""h.normalizeHarnessReview([{component:'skill', disposition:'create', reason:'Reusable method',
      patterns:[{evidence_refs:['o1'], applicability:'same level', counterexamples:'none',
        candidate:'Predict the next delta.', next_use:'Before the next action', validation:'Compare observed cells'}]}], new Set())""")
    skill = next(entry for entry in value if entry['component'] == 'skill')
    assert skill['patterns'][0]['pattern'] == 'Predict the next delta.'


def test_review_candidate_kind_is_normalized_by_the_shared_router():
    project = Path(__file__).resolve().parents[1]
    module = project / "demo/pi_harness_protocol.ts"
    node, _ = _pi_cli()
    script = f'''import * as h from {json.dumps(module.as_uri())};
      console.log(JSON.stringify([
        h.normalizeSemanticCandidate({{kind:'skill',name:'probe',instructions:'Compare cases'}}),
        h.normalizeSemanticCandidate({{kind:'memory',layer:'task_policy',name:'plan',content:'Next step'}})
      ]));'''
    completed = subprocess.run([node, "--experimental-strip-types", "--input-type=module", "-e", script],
                               capture_output=True, text=True, check=True)
    skill, memory = json.loads(completed.stdout)
    assert skill["semantic_kind"] == "procedure"
    assert skill["execution"] == "text"
    assert memory["semantic_kind"] == "plan"
    assert memory["prompt_channel"] == "task_prompt"


def test_review_contract_describes_pattern_shape():
    value = helper("h.reviewInputContract()")
    assert 'pattern_template' in value
    assert 'pattern' in value['pattern_template']


def test_review_prompts_require_parent_application_and_version_verification():
    project = Path(__file__).resolve().parents[1]
    prompts = "\n".join((project / "demo" / "prompts" / name).read_text(encoding="utf-8")
                           for name in ("arc_decision_cycle.md", "auto_research_main_contract.md",
                                        "self_harness_opportunity.md", "self_harness_index.md"))
    assert prompts.count("component_application_plan") >= 4
    assert "task_harness(action=change)" in prompts
    assert "exact current target_version" in prompts
    assert "review commit" in prompts.lower()
    source = (project / "demo" / "pi_task_local_self_harness.ts").read_text(encoding="utf-8")
    assert 'next_tool: "task_harness"' in source
    assert "next provider context" in source


def test_native_partial_review_binds_pending_opportunity_and_handoff(tmp_path):
    project = Path(__file__).resolve().parents[1]
    events = _run_fixture(tmp_path, 'treatment',
        extra_extensions=[project / 'tests/pi_periodic_review_fixture.ts'],
        extra_env={'PI_HARNESS_PERIODIC_REVIEW':'enabled'}, steps=[
            *[{'name':'arc_action','arguments':{}} for _ in range(5)],
            {'name':'task_harness','arguments':{'action':'review','review':[], 'transition_analysis':{
                'observed_changes':'Fixture returned completion', 'predictive_rules':'Unknown',
                'limiting_uncertainty':'No state', 'next_experiment':'Read state',
                'capability_opportunities':'Unknown', 'evidence_refs':['execution-observation-1']}}},
            {'name':'task_harness','arguments':{'action':'decide_research','research_decision':'defer','research_reason':'Need state'}},
            {'name':'arc_action','arguments':{}}])
    results = [e for e in events if e.get('type') == 'tool_execution_end' and e.get('toolName') == 'task_harness']
    assert len(results) == 2
    assert all(not e.get('isError') for e in results), results
    reviews = [json.loads(s) for s in (tmp_path/'task-harness-reviews.jsonl').read_text().splitlines()]
    assert len(reviews[0]['entries']) == 6
    handoffs = [json.loads(s) for s in (tmp_path/'auto-research-handoffs.jsonl').read_text().splitlines()]
    assert handoffs[-1]['status'] == 'deferred'


def test_native_review_infers_components_and_materializes_complete_candidates(tmp_path):
    project = Path(__file__).resolve().parents[1]
    actions = [{'name':'arc_action','arguments':{}} for _ in range(5)]
    transition = {
        'observed_changes':'Ordinary moves and a blocked move have distinct deltas',
        'predictive_rules':'Decode the board, plan a route, then compare the next delta',
        'limiting_uncertainty':'Special cells remain untested',
        'next_experiment':'Apply the route method to the next fixture action',
        'capability_opportunities':'A reusable decode-plan-verify procedure',
        'evidence_refs':['execution-observation-1'],
    }
    review = [
        {'disposition':'create','reason':'Repeated route calculation','next_use':'Before the next action',
         'validation':'The predicted delta matches the next observation',
         'candidate':{'type':'task_skill','name':'decode-plan-verify','summary':'Decode, plan, verify',
                      'content':'Decode the board, plan a route, and compare the next delta.'}},
        {'disposition':'create','reason':'Keep current map facts','next_use':'Plan the next action',
         'validation':'The next observation is consistent with the map',
         'candidate':{'semantic_kind':'task_state','name':'current-map','summary':'Current map',
                      'content':'The current fixture map has two observed outcome classes.'}},
    ]
    events = _run_fixture(tmp_path,'treatment',extra_extensions=[project/'tests/pi_periodic_review_fixture.ts'],
        extra_env={'PI_HARNESS_PERIODIC_REVIEW':'enabled'},steps=actions+[
            {'name':'task_harness','arguments':{'action':'review','review':review,'transition_analysis':transition}}])
    result = results(events,'task_harness')[0]
    assert not result.get('isError'), result
    assert records(tmp_path,'task-skills.jsonl')[0]['name'] == 'decode-plan-verify'
    assert records(tmp_path,'task-memory.jsonl')[0]['key'] == 'current-map'
    receipt = records(tmp_path,'task-harness-change-receipts.jsonl')[-1]
    assert receipt['status'] == 'applied'
    assert {row['native_tool'] for row in receipt['results']} == {'task_skill','task_memory'}


def test_native_handoff_start_reaches_child_without_model_copied_refs(tmp_path):
    from test_auto_research_self_harness_smoke import _child_env
    _, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    report = {'format':'auto-research-report-v1','status':'inconclusive','conclusion':'Need canonical state',
        'findings':[],'evidence_refs':[],'alternatives':[],'limitations':[],
        'validation_plan':'Read state','harness_proposals':[]}
    events = _run_fixture(tmp_path,'treatment',
        extra_extensions=[project/'tests/pi_periodic_review_fixture.ts',project/'tests/pi_non_arc_task_subagents.ts'],
        extra_env=_child_env(project,cli,report,[{'name':'submit_research_report','arguments':{'report':report}}]),
        steps=periodic_steps()+[
            {'name':'auto_research','arguments':{'action':'start','interaction_mode':'blocking'}},
            {'name':'task_harness','arguments':{'action':'inspect'}},
            {'name':'arc_action','arguments':{}}])
    result = results(events,'auto_research')[0]
    assert not result.get('isError'), result
    assert records(tmp_path,'auto-research-sessions.jsonl')[-1]['research_handoff_ref'].endswith('@v1')
    assert records(tmp_path,'auto-research-handoffs.jsonl')[-1]['status'] == 'completed'
    assert any(e['event'] == 'spawned' for e in records(tmp_path,'subagent-progress.jsonl'))


def test_review_failures_release_action_without_repeated_action_attempts(tmp_path):
    project = Path(__file__).resolve().parents[1]
    events = _run_fixture(tmp_path,'treatment',extra_extensions=[project/'tests/pi_periodic_review_fixture.ts'],steps=[
        *periodic_steps()[:5],
        *[{'name':'task_harness','arguments':{'action':'review','review':[{'component':'skill','disposition':'create','reason':'Need a method'}]}} for _ in range(3)],
        {'name':'arc_action','arguments':{}}])
    assert not results(events,'arc_action')[-1].get('isError')
    assert records(tmp_path,'task-harness-review-events.jsonl')[-1]['reason'] == 'failure_budget'


def test_unrelated_success_cannot_clear_pending_failure(tmp_path):
    _run_fixture(tmp_path,'treatment',steps=[
        {'name':'task_harness','arguments':{'action':'assess_effect','decision_id':'missing','observation_refs':['missing']}},
        {'name':'task_harness','arguments':{'action':'start'}},
        {'name':'task_checkpoint','arguments':{'action':'inspect'}}])
    failures = records(tmp_path,'task-operation-failures.jsonl')
    assert len(failures) == 1
    assert json.loads(failures[0]['operation_key'])['task']
    checkpoint = json.loads((tmp_path/'task-checkpoint.json').read_text())
    assert len(checkpoint['pending_operations']) == 1
    assert not records(tmp_path,'task-operation-resolutions.jsonl')


def test_review_commit_replays_missing_projection_without_duplicate_handoff(tmp_path):
    project = Path(__file__).resolve().parents[1]
    _run_fixture(tmp_path,'treatment',extra_extensions=[project/'tests/pi_periodic_review_fixture.ts'],steps=periodic_steps())
    # Simulate interruption after durable commit but before index projection.
    (tmp_path/'task-harness-reviews.jsonl').unlink()
    _run_fixture(tmp_path,'treatment',extra_extensions=[project/'tests/pi_periodic_review_fixture.ts'],steps=[
        {'name':'task_harness','arguments':{'action':'inspect'}}])
    assert len(records(tmp_path,'task-harness-reviews.jsonl')) == 1
    assert len(records(tmp_path,'auto-research-handoffs.jsonl')) == 1


def test_deferred_handoff_reactivates_only_after_requested_actions(tmp_path):
    project = Path(__file__).resolve().parents[1]
    _run_fixture(tmp_path,'treatment',extra_extensions=[project/'tests/pi_periodic_review_fixture.ts'],steps=periodic_steps()+[
        {'name':'task_harness','arguments':{'action':'decide_research','research_decision':'defer','research_reason':'Need two samples',
            'resume_condition':{'kind':'after_actions','actions':2}}},
        {'name':'arc_action','arguments':{}}, {'name':'task_harness','arguments':{'action':'inspect'}},
        {'name':'arc_action','arguments':{}}, {'name':'task_harness','arguments':{'action':'inspect'}}])
    handoffs = records(tmp_path,'auto-research-handoffs.jsonl')
    assert [row['status'] for row in handoffs] == ['proposed','deferred','proposed']
    assert handoffs[-1]['reactivated_by'] == 'runtime_action_count'


def test_handoff_runtime_failure_degrades_immediately_and_releases_arc(tmp_path):
    project = Path(__file__).resolve().parents[1]
    events = _run_fixture(tmp_path,'treatment',extra_extensions=[project/'tests/pi_periodic_review_fixture.ts'],
        extra_env={'PI_REVIEW_FIXTURE_RUNTIME_FAILURE':'1'},steps=periodic_steps()+[
            {'name':'auto_research','arguments':{'action':'start'}}, {'name':'arc_action','arguments':{}}])
    assert results(events,'auto_research')[0]['isError']
    assert not results(events,'arc_action')[-1].get('isError')
    latest = records(tmp_path,'auto-research-handoffs.jsonl')[-1]
    assert latest['status'] == 'deferred' and latest['parent_reason'] == 'runtime_failure'
    failure = records(tmp_path,'task-operation-failures.jsonl')[-1]
    assert failure['failure_class'] == 'runtime_failure' and failure['retryable'] is False


def test_review_error_lists_entry_and_transition_fields_together(tmp_path):
    project = Path(__file__).resolve().parents[1]
    events = _run_fixture(tmp_path,'treatment',extra_extensions=[project/'tests/pi_periodic_review_fixture.ts'],steps=[
        *periodic_steps()[:5],
        {'name':'task_harness','arguments':{'action':'review','review':[{'component':'skill','disposition':'create','reason':'Need method'}]}}])
    error = json.loads(results(events,'task_harness')[0]['result']['content'][0]['text'])
    paths = {e['path'] for e in error['errors']}
    assert {'review[0].next_use','review[0].validation','transition_analysis','review.skill.patterns'} <= paths


def test_same_bound_review_success_resolves_failure_with_audit_link(tmp_path):
    project = Path(__file__).resolve().parents[1]
    _run_fixture(tmp_path,'treatment',extra_extensions=[project/'tests/pi_periodic_review_fixture.ts'],steps=[
        *periodic_steps()[:5], {'name':'task_harness','arguments':{'action':'review','review':[]}}, periodic_steps()[-1]])
    failure = records(tmp_path,'task-operation-failures.jsonl')[0]
    resolution = records(tmp_path,'task-operation-resolutions.jsonl')[0]
    assert resolution['failure_ref'] == failure['resource_ref']
    assert resolution['operation_key'] == resolution['resolved_operation_key']
    assert json.loads((tmp_path/'task-checkpoint.json').read_text())['pending_operations'] == []


def test_explicit_stale_cancel_is_rejected_but_omitted_ref_binds_current(tmp_path):
    project = Path(__file__).resolve().parents[1]
    (tmp_path/'auto-research-sessions.jsonl').write_text(json.dumps({'session_id':'s','version':2,'status':'pending'})+'\n')
    events = _run_fixture(tmp_path,'treatment',extra_extensions=[project/'tests/pi_non_arc_task_subagents.ts'],steps=[
        {'name':'auto_research','arguments':{'action':'cancel','session_ref':'research_session:s@v1'}},
        {'name':'auto_research','arguments':{'action':'cancel'}}])
    output = results(events,'auto_research')
    assert output[0].get('isError')
    assert not output[1].get('isError'), output[1]
    sessions = records(tmp_path,'auto-research-sessions.jsonl')
    assert [s['version'] for s in sessions] == [2,3]


def test_review_escape_still_checks_pending_handoff(tmp_path):
    project = Path(__file__).resolve().parents[1]
    action = {'name':'arc_action','arguments':{}}
    events = _run_fixture(tmp_path,'treatment',extra_extensions=[project/'tests/pi_periodic_review_fixture.ts'],steps=[
        *periodic_steps(),
        {'name':'task_harness','arguments':{'action':'decide_research','research_decision':'defer','research_reason':'Collect second window'}},
        *[action for _ in range(5)],
        {'name':'task_harness','arguments':{'action':'decide_research','research_decision':'reactivate','research_reason':'Samples ready'}},
        *[action for _ in range(5)]])
    attempts = results(events,'arc_action')[-5:]
    assert [bool(result.get('isError')) for result in attempts] == [True,True,True,True,False]
    assert records(tmp_path,'auto-research-handoffs.jsonl')[-1]['parent_reason'] == 'action_delay_budget'


def test_registered_arc_tool_does_not_enable_periodic_policy_implicitly(tmp_path):
    project = Path(__file__).resolve().parents[1]
    events = _run_fixture(tmp_path,'treatment',extra_extensions=[project/'tests/pi_periodic_review_fixture.ts'],
        extra_env={'PI_HARNESS_PERIODIC_REVIEW':'disabled'},
        steps=[{'name':'arc_action','arguments':{}} for _ in range(8)])
    assert len(results(events,'arc_action')) == 8
    assert all(not r.get('isError') for r in results(events,'arc_action'))
    assert not records(tmp_path,'task-harness-review-events.jsonl')


def test_inspection_loop_exhausts_review_call_budget(tmp_path):
    project = Path(__file__).resolve().parents[1]
    events = _run_fixture(tmp_path,'treatment',extra_extensions=[project/'tests/pi_periodic_review_fixture.ts'],steps=[
        *periodic_steps()[:5],
        *[{'name':'task_harness','arguments':{'action':'inspect'}} for _ in range(12)],
        {'name':'arc_action','arguments':{}}])
    assert not results(events,'arc_action')[-1].get('isError')
    assert records(tmp_path,'task-harness-review-events.jsonl')[-1]['reason'] == 'call_budget'


def test_plan_and_node_refs_are_bound_for_unique_skip_target(tmp_path):
    project = Path(__file__).resolve().parents[1]
    events = _run_fixture(tmp_path,'treatment',extra_extensions=[project/'tests/pi_non_arc_task_subagents.ts'],steps=[
        {'name':'auto_research','arguments':{'action':'enqueue','plan':{'goal':'Check one hypothesis',
            'complexity_assessment':{'level':'simple','rationale':'One result'},
            'nodes':[{'node_id':'check','question':'Is it supported?','completion_contract':'Evidence or gap'}]}}},
        {'name':'auto_research','arguments':{'action':'skip'}}])
    assert all(not item.get('isError') for item in results(events,'auto_research'))
    plan = records(tmp_path,'auto-research-plans.jsonl')[-1]
    assert plan['version'] == 2 and plan['nodes'][0]['status'] == 'skipped'


def test_effect_assessment_binds_unique_decision_without_inventing_verdict(tmp_path):
    events = _run_fixture(tmp_path,'treatment',steps=[
        {'name':'task_memory','arguments':{'action':'upsert','key':'claim','content':'Unverified claim'}},
        {'name':'benchmark_probe','arguments':{}},
        {'name':'task_harness','arguments':{'action':'assess_effect','observation_refs':['execution-observation-1'],
            'verdict':'inconclusive','consequence':'The observation does not distinguish the claim'}}])
    assert not results(events,'task_harness')[0].get('isError')
    assessment = records(tmp_path,'effect-assessments.jsonl')[-1]
    assert assessment['decision_id'] == records(tmp_path,'harness-decisions.jsonl')[0]['decision_id']
    assert assessment['verdict'] == 'inconclusive'


def test_exhausting_one_handoff_does_not_bypass_another(tmp_path):
    project = Path(__file__).resolve().parents[1]
    (tmp_path/'auto-research-handoffs.jsonl').write_text(''.join(json.dumps({
        'handoff_id':name,'review_id':name,'version':1,'status':'proposed','recordedAt':'2026-09-17T00:00:00.000Z'
    })+'\n' for name in ['h1','h2']))
    events = _run_fixture(tmp_path,'treatment',extra_extensions=[project/'tests/pi_periodic_review_fixture.ts'],
        steps=[{'name':'arc_action','arguments':{}} for _ in range(5)])
    assert [bool(r.get('isError')) for r in results(events,'arc_action')] == [True,True,True,True,False]
    handoffs = records(tmp_path,'auto-research-handoffs.jsonl')
    assert [row['handoff_id'] for row in handoffs if row['status'] == 'deferred'] == ['h1','h2']
