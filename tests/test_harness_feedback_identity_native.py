"""Feedback addresses the same exact native versions as assembly and use."""
import copy
import json
from pathlib import Path

from test_harness_batch_preflight import run_changes, stage45
from test_pi_external_benchmark_native import _pi_cli, _run_fixture
from test_task_research_context import records, results


def test_public_lifecycle_uses_canonical_selected_refs_and_does_not_infer_utility(tmp_path):
    changes = copy.deepcopy(stage45('last'))
    changes[1]['candidate']['scope'] = 'public evidence checks within this task'
    events = run_changes(tmp_path, changes, assembly={'expected_assembly_revision': 0, 'selected_resource_refs': []}, more=[
        {'name': 'task_tool_read-cell-color_v1', 'arguments': {
            'parameters': {'grid': [[4]], 'row': 0, 'col': 0}, 'bindings': []}},
        {'name': 'task_harness', 'arguments': {'action': 'inspect'}},
    ])
    calls = results(events, 'task_harness')
    assert not any(call.get('isError') for call in calls), calls
    publication = calls[-2]['result']['details']
    selected = set(publication['assembly_receipt']['current_assembly']['selected_resource_refs'])
    state = json.loads(calls[-1]['result']['content'][0]['text'])
    lifecycle = state['lifecycle']
    assert {row['resource_ref'] for row in lifecycle} == selected
    tool = next(row for row in lifecycle if row['component'] == 'tool')
    assert tool['uses'][0]['status'] == 'completed'
    assert tool['uses'][0]['assembly_ref'] == publication['assembly_receipt']['assembly_ref']
    assert json.loads(tool['uses'][0]['output_excerpt']) == {'color': 4}
    assert tool['semantic_success'] == 'not_inferred_from_completion'
    assert tool['agent_effect_assessments'] == []


def test_saved_subagent_lifecycle_exposes_result_and_exact_recovery_without_claiming_utility(tmp_path):
    _, cli = _pi_cli()
    report = {'abstained': True, 'reason': 'No scene reference supplied'}
    changes = copy.deepcopy(stage45('last'))
    changes[1]['candidate']['scope'] = 'public evidence checks within this task'
    events = run_changes(tmp_path, changes, assembly={'expected_assembly_revision': 0, 'selected_resource_refs': []},
        more=[{'name': 'delegate_task', 'arguments': {'agent_name': 'independent-cell-reviewer',
              'task': 'Report uncertainty if no public scene is supplied.'}},
              {'name': 'task_harness', 'arguments': {'action': 'inspect'}},
              {'name': 'task_resource', 'arguments': {'action': 'read', 'ref': 'delegation:subagent-invocation-1@v1'}}],
        extra_env={'PI_AUTORESEARCH_PI_CLI': cli, 'PI_AUTORESEARCH_PROVIDER': 'offline-subagent-test',
            'PI_AUTORESEARCH_MODEL': 'scripted', 'PI_SUBAGENT_REPORT': json.dumps(report),
            'PI_AUTORESEARCH_SUBAGENT_PROVIDER_EXTENSION': str(Path(__file__).resolve().parent / 'pi_subagent_provider.ts')})
    invocation = results(events, 'delegate_task')[-1]
    assert not invocation.get('isError'), invocation
    lifecycle = json.loads(results(events, 'task_harness')[-1]['result']['content'][0]['text'])['lifecycle']
    component = next(row for row in lifecycle if row['component'] == 'subagent')
    assert component['resource_ref'] == 'subagent:independent-cell-reviewer@v1'
    use = component['uses'][0]
    assert use['status'] == 'completed'
    assert use['assembly_ref'] == results(events, 'task_harness')[-2]['result']['details']['assembly_receipt']['assembly_ref']
    assert json.loads(use['output_excerpt']) == report
    assert use['result_ref'] == 'delegation:subagent-invocation-1@v1'
    assert not results(events, 'task_resource')[-1].get('isError')
    assert component['semantic_success'] == 'not_inferred_from_completion'
    assert component['agent_effect_assessments'] == []


def test_action_basis_citation_is_linked_without_inventing_tool_use_or_causal_benefit(tmp_path):
    changes = copy.deepcopy(stage45('last'))
    changes[1]['candidate']['scope'] = 'public evidence checks within this task'
    project = Path(__file__).resolve().parents[1]
    steps = [{'name': 'task_harness', 'arguments': {'action': 'read_method', 'method_name': kind + '-creator'}}
             for kind in ['skill', 'tool', 'subagent']]
    steps += [{'name': 'task_harness', 'arguments': {'action': 'change', 'changes': changes,
        'assembly': {'expected_assembly_revision': 0, 'selected_resource_refs': []}}},
        {'name': 'arc_action', 'arguments': {'action': 'noop', 'decision': {
            'basis_refs': ['tool:read-cell-color@v1'], 'reason': 'A citation alone is not an invocation.'}}},
        {'name': 'task_harness', 'arguments': {'action': 'inspect'}},
    ]
    events = _run_fixture(tmp_path, 'treatment', steps=steps, extra_extensions=[
        project / 'tests/pi_task_tool_fixture.ts', project / 'tests/pi_non_arc_task_subagents.ts',
        project / 'tests/pi_competition_action_fixture.ts'])
    action = results(events, 'arc_action')[-1]
    assert not action.get('isError'), action
    state = json.loads(results(events, 'task_harness')[-1]['result']['content'][0]['text'])
    tool = next(row for row in state['lifecycle'] if row['resource_ref'] == 'tool:read-cell-color@v1')
    observed = next(row for row in records(tmp_path, 'execution-observations.jsonl') if row['tool_name'] == 'arc_action')
    assert tool['action_citations'] == [{'observation_ref': f"observation:{observed['observation_id']}@v1",
        'evidence_kind': 'agent_basis_ref', 'is_error': False}]
    assert tool['uses'] == []
    assert tool['semantic_success'] == 'not_inferred_from_completion'
    assert tool['agent_effect_assessments'] == []
