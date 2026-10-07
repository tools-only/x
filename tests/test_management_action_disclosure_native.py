"""Actual provider schemas keep advanced actions and their fields together."""
import json
from pathlib import Path

import pytest

from test_pi_external_benchmark_native import _run_fixture
from test_task_research_context import records, results


def actions(schema):
    value = schema['properties']['action']
    return set(value.get('enum', [])) | {item['const'] for item in value.get('anyOf', [])}


def schemas(context):
    return {tool['name']: tool['parameters'] for tool in context['tools']}


def test_core_creation_and_typed_advanced_actions_survive_disclosure_reset_and_restart(tmp_path):
    project = Path(__file__).resolve().parents[1]
    events = _run_fixture(tmp_path, 'treatment', arc_compact=True, steps=[
        {'name': 'task_harness_create', 'arguments': {'candidate': {
            'name': 'core-value', 'description': 'Return the bounded integer 2.',
            'program': {'format': 'task-pure-python-v1', 'source': '2'}}, 'assembly': True}},
        {'name': 'task_harness', 'arguments': {'action': 'contract', 'schema_action': 'review'}},
        {'name': 'task_harness', 'arguments': {'action': 'contract', 'schema_action': 'core'}},
        {'name': 'auto_research', 'arguments': {'action': 'contract', 'schema_action': 'enqueue'}},
        {'name': 'auto_research', 'arguments': {'action': 'contract', 'schema_action': 'core'}},
        {'name': 'task_tool_core-value_v1', 'arguments': {'parameters': {}, 'bindings': []}},
    ], extra_extensions=[project / 'tests/pi_task_tool_fixture.ts', project / 'tests/pi_non_arc_task_subagents.ts'])
    assert not any(event.get('isError') for event in events if event.get('type') == 'tool_execution_end')
    contexts = [row['context'] for row in records(tmp_path, 'provider-contexts.jsonl')]
    core = schemas(contexts[0])
    review_actions = {'review', 'capability_review', 'defer_review'}
    plan_actions = {'enqueue', 'inspect_plan', 'release'}
    assert not (actions(core['task_harness']) & (review_actions | {'level_review', 'report_level_reset'}))
    assert not (actions(core['auto_research']) & plan_actions)
    assert {'change', 'assemble', 'contract', 'read_method', 'focus'} <= actions(core['task_harness'])
    assert {'start', 'assign', 'inspect', 'cancel', 'resume', 'skip'} <= actions(core['auto_research'])
    assert not {'plan', 'plan_ref', 'node_id'} & core['auto_research']['properties'].keys()
    assert review_actions <= actions(schemas(contexts[2])['task_harness'])
    assert 'review' in schemas(contexts[2])['task_harness']['properties']
    assert schemas(contexts[3])['task_harness'] == core['task_harness']
    assert plan_actions <= actions(schemas(contexts[4])['auto_research'])
    assert {'plan', 'plan_ref', 'node_id'} <= schemas(contexts[4])['auto_research']['properties'].keys()
    assert schemas(contexts[5])['auto_research'] == core['auto_research']
    for context in contexts[1:]:
        assert 'task_tool_core-value_v1' in schemas(context)
    value = results(events, 'task_tool_core-value_v1')[-1]
    assert json.loads(value['result']['content'][0]['text']) == 2
    _run_fixture(tmp_path, 'treatment', arc_compact=True, steps=[], extra_extensions=[
        project / 'tests/pi_task_tool_fixture.ts', project / 'tests/pi_non_arc_task_subagents.ts'])
    resumed = schemas(records(tmp_path, 'provider-contexts.jsonl')[-1]['context'])
    assert resumed['task_harness'] == core['task_harness']
    assert resumed['auto_research'] == core['auto_research']
    assert 'task_tool_core-value_v1' in resumed


def test_advanced_review_keeps_repair_contract_then_releases_it_after_semantic_commit(tmp_path):
    (tmp_path / 'task-harness-opportunities.jsonl').write_text(
        json.dumps({'opportunity_id': 'typed-review'}) + '\n', encoding='utf-8')
    candidate = {'component': 'skill', 'name': 'reviewed-procedure',
                 'description': 'Compare a public prediction.',
                 'instructions': 'State a prediction, compare evidence, and preserve uncertainty.'}

    def review(body):
        return {'name': 'task_harness', 'arguments': {'action': 'review', 'opportunity_id': 'typed-review',
            'review': [{'component': 'skill', 'disposition': 'create', 'reason': 'Save a bounded comparison procedure.',
                'next_use': 'Compare the next public observation.', 'validation': 'Check a counterexample.',
                'candidate': body}]}}

    events = _run_fixture(tmp_path, 'treatment', arc_compact=True, steps=[
        {'name': 'task_harness', 'arguments': {'action': 'contract', 'schema_action': 'review'}},
        review({**candidate, 'instructions': ''}), review(candidate),
        {'name': 'task_harness', 'arguments': {'action': 'assemble', 'expected_assembly_revision': 0,
            'selected_resource_refs': ['skill:reviewed-procedure@v1'],
            'decision': {'basis_refs': [], 'reason': 'Select the authored comparison procedure.',
                         'expected': 'Its exact body is available for a bounded check.'}}},
        {'name': 'read', 'arguments': {'path': str(tmp_path / 'task-harness/skills/reviewed-procedure/SKILL.md')}},
    ])
    outputs = results(events, 'task_harness')
    assert [output.get('isError') for output in outputs] == [False, True, False, False], outputs
    assert len(records(tmp_path, 'task-skills.jsonl')) == 1
    assert candidate['instructions'] in results(events, 'read')[-1]['result']['content'][0]['text']
    contexts = [row['context'] for row in records(tmp_path, 'provider-contexts.jsonl')]
    assert 'review' in actions(schemas(contexts[2])['task_harness'])
    assert 'review' not in actions(schemas(contexts[3])['task_harness'])
    assert schemas(contexts[3])['task_harness'] == schemas(contexts[0])['task_harness']


@pytest.mark.parametrize('bad', [
    {'action': 'summary', 'level_review': {'summary': 'incomplete'}},
    {'action': 'summary', 'schema_action': 'review'},
])
def test_full_contract_rejection_before_handler_has_no_unknown_side_effect_or_disclosure_debt(tmp_path, bad):
    events = _run_fixture(tmp_path, 'treatment', arc_compact=True, steps=[
        {'name': 'task_harness', 'arguments': bad},
        {'name': 'task_harness', 'arguments': {'action': 'summary'}},
    ])
    outputs = results(events, 'task_harness')
    assert [output.get('isError') for output in outputs] == [True, False]
    failed = records(tmp_path, 'task-operation-failures.jsonl')[0]
    assert failed['applied'] is False
    assert not failed.get('required_next_call')
    contexts = [row['context'] for row in records(tmp_path, 'provider-contexts.jsonl')]
    assert schemas(contexts[0])['task_harness'] == schemas(contexts[-1])['task_harness']


def test_terminal_plans_release_typed_fields_only_after_last_live_plan_and_survive_restart(tmp_path):
    from test_task_research_context import _run_fixture as run_research
    extension = Path(__file__).with_name('pi_non_arc_task_subagents.ts')
    plan = {'goal': 'Bounded optional check',
            'complexity_assessment': {'level': 'simple', 'rationale': 'One optional question'},
            'nodes': [{'node_id': 'optional', 'question': 'Check only if useful',
                       'completion_contract': 'Evidence or explicit non-use'}]}
    events = run_research(tmp_path, 'treatment', arc_compact=True, extra_extensions=[extension], steps=[
        {'name': 'auto_research', 'arguments': {'action': 'contract', 'schema_action': 'enqueue'}},
        {'name': 'auto_research', 'arguments': {'action': 'enqueue', 'plan': plan}},
        {'name': 'auto_research', 'arguments': {'action': 'enqueue', 'plan': plan}},
        {'name': 'auto_research', 'arguments': {'action': 'skip',
            'plan_ref': 'research_plan:research-plan-1@v1', 'node_id': 'optional'}},
        {'name': 'auto_research', 'arguments': {'action': 'skip',
            'plan_ref': 'research_plan:research-plan-2@v1', 'node_id': 'optional'}},
    ])
    assert not any(row.get('isError') for row in results(events, 'auto_research'))
    contexts = [row['context'] for row in records(tmp_path, 'provider-contexts.jsonl')]
    assert 'plan' in schemas(contexts[-2])['auto_research']['properties']
    assert 'plan' not in schemas(contexts[-1])['auto_research']['properties']
    assert len(records(tmp_path, 'auto-research-plans.jsonl')) == 4
    assert not records(tmp_path, 'subagent-invocations.jsonl')
    _run_fixture(tmp_path, 'treatment', arc_compact=True, steps=[], extra_extensions=[extension])
    restored = records(tmp_path, 'provider-contexts.jsonl')[-1]['context']
    assert 'plan' not in schemas(restored)['auto_research']['properties']


@pytest.mark.parametrize('outcome', ['completed', 'cancelled'])
def test_real_background_plan_terminal_transition_releases_schema_before_later_parent(tmp_path, outcome):
    from autoresearch_pi.subagent_broker import SubagentBroker
    from test_pi_external_benchmark_native import _pi_cli
    from test_task_research_context import _run_fixture as run_research, wait_for_broker_job
    project = Path(__file__).resolve().parents[1]
    _, cli = _pi_cli()
    report = {'format': 'auto-research-report-v1', 'status': 'supported_within_scope',
              'conclusion': 'Bounded comparison completed.', 'findings': [], 'evidence_refs': [],
              'alternatives': [], 'limitations': [], 'validation_plan': 'Review the result.', 'method_candidates': []}
    plan = {'goal': 'One bounded background question',
            'complexity_assessment': {'level': 'simple', 'rationale': 'One question'},
            'nodes': [{'node_id': 'a', 'question': 'Compare evidence', 'completion_contract': 'Evidence or gap'}]}
    extension = project / 'tests/pi_non_arc_task_subagents.ts'
    broker = SubagentBroker()
    broker.start()
    child_env = {'PI_AUTORESEARCH_PI_CLI': cli, 'PI_AUTORESEARCH_PROVIDER': 'offline-subagent-test',
                 'PI_AUTORESEARCH_MODEL': 'scripted',
                 'PI_AUTORESEARCH_SUBAGENT_PROVIDER_EXTENSION': str(project / 'tests/pi_subagent_provider.ts'),
                 'PI_AUTORESEARCH_SUBAGENT_BROKER_URL': broker.url,
                 'PI_SUBAGENT_FORCE_LENGTH': '1' if outcome == 'cancelled' else '0',
                 'PI_SUBAGENT_REPORT': json.dumps(report),
                 'PI_SUBAGENT_STEPS': json.dumps([{'name': 'submit_research_report', 'arguments': {'report': report}}])}
    steps = [
        {'name': 'auto_research', 'arguments': {'action': 'contract', 'schema_action': 'enqueue'}},
        {'name': 'auto_research', 'arguments': {'action': 'enqueue', 'plan': plan}},
        {'name': 'auto_research', 'arguments': {'action': 'start', 'plan_ref': 'research_plan:research-plan-1@v1',
            'node_id': 'a', 'interaction_mode': 'non_blocking'}},
    ]
    if outcome == 'cancelled':
        steps.append({'name': 'auto_research', 'arguments': {'action': 'cancel'}})
    try:
        events = run_research(tmp_path, 'treatment', arc_compact=True, extra_extensions=[extension],
                              extra_env=child_env, steps=steps)
        assert not any(row.get('isError') for row in results(events, 'auto_research'))
        if outcome == 'completed':
            wait_for_broker_job(tmp_path, 'auto-research-1')
        _run_fixture(tmp_path, 'treatment', arc_compact=True, extra_extensions=[extension],
                     extra_env=child_env, steps=[])
        context = records(tmp_path, 'provider-contexts.jsonl')[-1]['context']
        assert 'plan' not in schemas(context)['auto_research']['properties']
        node = records(tmp_path, 'auto-research-plans.jsonl')[-1]['nodes'][0]
        assert node['status'] == ('skipped' if outcome == 'cancelled' else 'completed')
        if outcome == 'completed':
            assert node['result_ref'] == 'research_run:auto-research-1@v1'
            assert records(tmp_path, 'auto-research-reports.jsonl')[-1]['summary'] == report['conclusion']
        else:
            assert node['wait_reason'] == 'cancelled'
            assert records(tmp_path, 'auto-research-sessions.jsonl')[-1]['status'] == 'cancelled'
    finally:
        broker.close()
