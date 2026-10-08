"""Direct use via installed Pi and localhost scripted HTTP; no benchmark benefit claim."""
import json
import pytest
from contextlib import contextmanager
from pathlib import Path

from autoresearch_pi.subagent_broker import SubagentBroker
from test_pi_external_benchmark_native import _pi_cli

from test_harness_argument_integrity_native import run, tool_payloads
from test_task_research_context import records, results

ENV = {'PI_ARGUMENT_DIRECT_USE': '1'}


def capture(identifier, text, *, select=None, key='note', scope='task'):
    args = {'action': 'capture', 'capture_id': identifier, 'items': [{'key': key, 'content': text, 'scope': scope}]}
    if select is not None:
        args['select'] = select
    return {'name': 'task_memory_pool', 'arguments': args}


def current_text(request):
    return '\n'.join(str(m['content']) for m in request['messages'] if m['role'] == 'user'
                     and ('Active task-' in str(m['content']) or 'Active dynamic task/' in str(m['content'])))


def test_memory_pool_contract_routes_to_current_save_and_select_instructions(tmp_path):
    events, _ = run(tmp_path / 'task', [[{'name': 'task_harness', 'arguments': {
        'action': 'contract', 'topic': 'memory_pool', 'schema_action': 'core'}}]], ENV)
    result = results(events, 'task_harness')[0]
    assert not result.get('isError'), result
    body = result['result']['details']
    assert body['topic'] == 'memory' and body['read_only'] is True
    assert 'select=true' in body['instructions']
    assert 'archive only' in body['instructions'] and 'enabled_tools=["task_memory_pool"]' in body['instructions']
    assert not records(tmp_path / 'task', 'task-memory.jsonl')


def test_memory_capture_select_exposes_full_text_preserves_other_selection_and_retries(tmp_path):
    root = tmp_path / 'task'
    text = 'DIRECT_MEMORY ' + 'evidence ' * 80 + 'END_OF_MEMORY'
    first = capture('first', text, select=True)
    events, requests = run(root, [[capture('other', 'OTHER_SELECTED', select=True, key='other')],
                                 [first], [first], [capture('archive', 'ARCHIVE_ONLY', key='archived')]], ENV)
    attempts = results(events, 'task_memory_pool')
    assert all(not e.get('isError') for e in attempts), attempts
    assert text in current_text(requests[2]) and 'OTHER_SELECTED' in current_text(requests[2])
    assert attempts[2]['result']['details']['selection']['idempotent'] is True
    assert len(records(root, 'task-harness-assemblies.jsonl')) == 2
    assert len(records(root, 'task-memory.jsonl')) == 3
    assert 'ARCHIVE_ONLY' not in current_text(requests[-1])
    assert 'selection' not in attempts[-1]['result']['details']
    assert not records(root, 'task-baseline-method-reads.jsonl')


def test_memory_selection_tracks_updates_expiry_and_rejects_old_retry(tmp_path):
    root = tmp_path / 'task'
    first = capture('first', 'OLD_NOTE', select=True, scope='level')
    events, requests = run(root, [[first], [capture('second', 'NEW_NOTE', select=True, scope='level')],
                                 [first], [{'name': 'advance_test_level', 'arguments': {}}]], ENV)
    attempts = results(events, 'task_memory_pool')
    assert all(not e.get('isError') for e in attempts), attempts
    assert 'NEW_NOTE' in current_text(requests[2]) and 'OLD_NOTE' not in current_text(requests[2])
    assert attempts[2]['result']['details']['selection']['applied'] is False
    assert 'NEW_NOTE' in current_text(requests[3])
    assert 'NEW_NOTE' not in current_text(requests[4])
    assert len(records(root, 'task-memory.jsonl')) == 2


def test_memory_invalid_select_rejects_before_capture_and_false_remains_archive(tmp_path):
    root = tmp_path / 'task'
    calls = [capture(str(i), 'NO_WRITE', select=value) for i, value in enumerate(('true', 1, {}, []))]
    null = capture('null', 'NO_WRITE'); null['arguments']['select'] = None; calls.append(null)
    events, requests = run(root, [[c] for c in calls] + [[capture('archive', 'ARCHIVE_ONLY', select=False)]], ENV)
    attempts = results(events, 'task_memory_pool')
    assert all(e.get('isError') for e in attempts[:-1])
    assert not attempts[-1].get('isError')
    assert len(records(root, 'task-memory.jsonl')) == 1
    assert not records(root, 'task-harness-assemblies.jsonl')
    assert 'ARCHIVE_ONLY' not in current_text(requests[-1])


def assemble(revision, refs, contributions=None):
    return {'name': 'task_harness', 'arguments': {'action': 'assemble', 'expected_assembly_revision': revision,
            'selected_resource_refs': refs, 'prompt_contributions': contributions or [],
            'decision': {'basis_refs': [], 'reason': 'Parent custom selection', 'expected': 'Only selected guidance remains active'}}}


def test_agent_can_replace_convenient_memory_selection_with_custom_subset(tmp_path):
    root = tmp_path / 'task'
    def custom(_request):
        assembly = records(root, 'task-harness-assemblies.jsonl')[-1]
        ref = next(c['source_ref'] for c in assembly['prompt_contributions'] if c['content'] == 'KEEP_ME')
        return [assemble(assembly['revision'], [ref], [{'contribution_id': 'custom-plan', 'source_ref': ref,
                         'layer': 'working_plan', 'content': 'CUSTOM_SELECTED_PLAN', 'priority': 10}])]
    events, requests = run(root, [[capture('first', 'KEEP_ME', select=True, key='keep')],
                                 [capture('second', 'REMOVE_ME', select=True, key='remove')], custom,
                                 [{'name': 'ingress_probe', 'arguments': {'marker': 'continue'}}]], ENV)
    assert all(not e.get('isError') for e in results(events, 'task_harness'))
    for request in requests[3:]:
        assert 'REMOVE_ME' not in current_text(request)
        assert 'CUSTOM_SELECTED_PLAN' in current_text(request)
    assert len(records(root, 'task-memory.jsonl')) == 2  # Deselection does not delete memory.
    assert len(records(root, 'task-harness-assemblies.jsonl')) == 3  # No automatic reselection.


def prompt_create(text, scope='task', assembly=True):
    return {'name': 'task_harness_create', 'arguments': {'candidate': {
        'component': 'system_prompt', 'name': 'direct-policy', 'content': text, 'scope': scope}, 'assembly': assembly}}


def test_descriptive_prompt_scope_is_not_an_automatic_expiry_condition(tmp_path):
    root = tmp_path / 'task'
    events, requests = run(root, [[prompt_create('DESCRIPTIVE_POLICY', scope='until the next level')],
        [{'name': 'advance_test_level', 'arguments': {}}]], ENV)
    assert not results(events, 'task_harness_create')[0].get('isError')
    assert 'DESCRIPTIVE_POLICY' in json.dumps(requests[-1])
    record = records(root, 'task-system-prompt.jsonl')[0]
    assert record['scope'] == 'until the next level'
    assert record.get('validity', {}).get('scope') != 'level'


def system_text(request):
    return '\n'.join(str(m['content']) for m in request['messages'] if m['role'] in ('system', 'developer'))


@pytest.mark.parametrize('resume', [False, True])
def test_prompt_updates_and_retires_on_next_http_request_preserving_host(tmp_path, resume):
    root = tmp_path / 'task'
    create = [prompt_create('OLD_DIRECT_POLICY')]
    if resume:
        run(root, [create], ENV)
    update = {'name': 'task_harness', 'arguments': {'action': 'change', 'changes': [{'operation': 'update',
              'candidate': {'component': 'system_prompt', 'name': 'direct-policy', 'target_version': 1,
                            'content': 'NEW_DIRECT_POLICY', 'scope': 'task'}}],
              'assembly': {'expected_assembly_revision': 1, 'selected_resource_refs': [], 'prompt_contributions': []}}}
    retire = {'name': 'task_harness', 'arguments': {'action': 'change', 'changes': [
              {'operation': 'retire', 'target_ref': 'system_prompt:direct-policy@v2'}]}}
    events, requests = run(root, ([] if resume else [create]) + [[update], [retire]], ENV, resume=resume)
    assert all(not e.get('isError') for name in ('task_harness_create', 'task_harness') for e in results(events, name)), events
    before, updated, retired = [system_text(r) for r in requests[-3:]]
    assert before.count('OLD_DIRECT_POLICY') == 1
    assert updated.count('NEW_DIRECT_POLICY') == 1 and 'OLD_DIRECT_POLICY' not in updated
    assert 'NEW_DIRECT_POLICY' not in retired and 'OLD_DIRECT_POLICY' not in retired
    # Pi may refresh its available-tools paragraph as management tools change.
    # The overlay transform must retain the fixed host instructions and cwd.
    for text in (before, updated, retired):
        assert text.startswith('You are an expert coding assistant')
        assert 'Current working directory:' in text and str(root).replace('\\', '/') in text


def test_prompt_pool_only_custom_selection_and_level_scope(tmp_path):
    root = tmp_path / 'task'
    events, requests = run(root, [[prompt_create('LEVEL_ONLY_POLICY', 'level', assembly=False)],
                                 [assemble(0, ['system_prompt:direct-policy@v1'])],
                                 [{'name': 'advance_test_level', 'arguments': {}}]], ENV)
    assert all(not e.get('isError') for name in ('task_harness_create', 'task_harness') for e in results(events, name))
    assert 'LEVEL_ONLY_POLICY' not in system_text(requests[1])
    assert system_text(requests[2]).count('LEVEL_ONLY_POLICY') == 1
    assert 'LEVEL_ONLY_POLICY' not in system_text(requests[3])
    assert records(root, 'task-system-prompt.jsonl')[0]['validity']['scope'] == 'level'


def test_prompt_conflicting_scope_shorthand_writes_nothing(tmp_path):
    call = prompt_create('INVALID_POLICY', 'level')
    call['arguments']['candidate']['validity'] = {'scope': 'task'}
    root = tmp_path / 'task'
    events, _ = run(root, [[call]], ENV)
    assert results(events, 'task_harness_create')[0].get('isError')
    assert not records(root, 'task-system-prompt.jsonl')


def test_new_skill_can_be_applied_without_reread_and_retains_optional_loader(tmp_path):
    root = tmp_path / 'task'
    call = {'name': 'task_harness_create', 'arguments': {'candidate': {'component': 'skill', 'name': 'check-now',
            'description': 'A bounded diagnostic procedure', 'instructions': 'Report marker SKILL_APPLIED after checking the supplied evidence.'}}}
    events, requests = run(root, [[call], [{'name': 'ingress_probe', 'arguments': {'marker': 'SKILL_APPLIED'}}]], ENV)
    result = results(events, 'task_harness_create')[0]
    assert not result.get('isError'), result
    entry = result['result']['details']['assembly_receipt']['components'][0]['use']
    assert 'directly' in entry['effect']
    assert entry['load_if_needed']['tool'] in ('read', 'task_harness')
    assert results(events, 'ingress_probe')[0]['args']['marker'] == 'SKILL_APPLIED'
    assert not records(root, 'task-baseline-method-reads.jsonl')
    assert not results(events, 'read')
    assert any('SKILL_APPLIED' in json.dumps(m) for m in requests[1]['messages'])


def role_create(**options):
    return {'name': 'task_harness_create', 'arguments': {'candidate': {
        'component': 'subagent', 'name': 'direct-reader', 'description': 'Check public fixture state',
        'instructions': 'Read fixture_state and return its readiness with uncertainty.', 'tools': ['fixture_state']},
        **options}}


@contextmanager
def child_env(**overrides):
    _, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    broker = SubagentBroker(); broker.start()
    try:
        yield {**ENV, 'PI_ARGUMENT_RESEARCH_RUNTIME': '1', 'PI_AUTORESEARCH_ENABLED': 'disabled',
               'PI_AUTORESEARCH_PI_CLI': cli, 'PI_AUTORESEARCH_PROVIDER': 'offline-subagent-test',
               'PI_AUTORESEARCH_MODEL': 'scripted', 'PI_AUTORESEARCH_SUBAGENT_BROKER_URL': broker.url,
               'PI_AUTORESEARCH_PROVIDER_EXTENSION': str(project / 'tests/pi_subagent_provider.ts'),
               'PI_SUBAGENT_STEPS': json.dumps([{'name': 'fixture_state', 'arguments': {}}]),
               'PI_SUBAGENT_REPORT': json.dumps({'ready': True, 'conclusion': 'fixture-state:ready'}), **overrides}
    finally:
        broker.close()


@pytest.mark.parametrize('length_once', [False, True])
def test_saved_role_first_run_returns_real_child_report_and_remains_independently_callable(tmp_path, length_once):
    root = tmp_path / 'task'
    with child_env(PI_SUBAGENT_FORCE_LENGTH_ONCE='1' if length_once else '0') as env:
        events, requests = run(root, [[role_create(run={'task': 'Read public fixture readiness.',
            'context_recipe': {'include_checkpoint': False, 'output_contract': 'Return ready and conclusion.'}})],
            [{'name': 'delegate_task', 'arguments': {'agent_name': 'direct-reader', 'task': 'Check again independently.'}}]], env)
    attempt = results(events, 'task_harness_create')[0]
    assert not attempt.get('isError'), attempt
    first = attempt['result']['details']['run']
    assert first['status'] == 'completed', first
    assert json.loads(first['result']['details']['result']['text']) == {'ready': True, 'conclusion': 'fixture-state:ready'}
    assert first['result']['details']['component_ref'] == 'subagent:direct-reader@v1'
    assert first['result']['details']['result']['usage']['output'] > 0
    assert not results(events, 'delegate_task')[0].get('isError')
    assert len(records(root, 'task-subagents.jsonl')) == 1
    assert len(records(root, 'subagent-invocations.jsonl')) == 2
    assert not records(root, 'auto-research-sessions.jsonl')
    assert any('fixture-state:ready' in json.dumps(p.get('run', {})) for p in tool_payloads(requests[1]))
    continuations = records(root, 'subagent-continuations.jsonl')
    assert any(r['stop_reason'] == 'length' for r in continuations) is length_once
    assert not records(root, 'task-baseline-method-reads.jsonl')


def test_failed_first_run_preserves_role_and_allows_parent_to_continue(tmp_path):
    root = tmp_path / 'task'
    with child_env(PI_AUTORESEARCH_DELEGATE_MAX_RUNTIME_MS='1') as env:
        events, _ = run(root, [[role_create(run={'task': 'Read readiness.'})],
                              [{'name': 'ingress_probe', 'arguments': {'marker': 'after-failure'}}]], env)
    attempt = results(events, 'task_harness_create')[0]
    assert not attempt.get('isError'), attempt
    first = attempt['result']['details']['run']
    assert first['status'] == 'failed' and 'runtime budget' in json.dumps(first)
    assert len(records(root, 'task-subagents.jsonl')) == 1
    assert len(records(root, 'task-harness-assemblies.jsonl')) == 1
    assert not results(events, 'ingress_probe')[0].get('isError')


def test_first_run_rejections_never_publish_or_start_children(tmp_path):
    calls = [role_create(assembly=False, run={'task': 'Read readiness.'}),
             role_create(run={'task': 'Read readiness.'}, trial={}),
             role_create(run={'task': 'Read readiness.', 'context_recipe': {'unknown_field': True}}),
             role_create(run={'task': 'Read readiness.', 'action_authorization': {'max_actions': 1}})]
    wrong = role_create(run={'task': 'Read readiness.'})
    wrong['arguments']['candidate'] = {'component': 'skill', 'name': 'wrong-carrier', 'description': 'Check', 'instructions': 'Check'}
    calls.append(wrong)
    root = tmp_path / 'task'
    with child_env() as env:
        events, _ = run(root, [[call] for call in calls], env)
    assert all(e.get('isError') for e in results(events, 'task_harness_create'))
    assert not records(root, 'task-subagents.jsonl') and not records(root, 'task-skills.jsonl')
    assert not records(root, 'task-harness-assemblies.jsonl')
    assert not records(root, 'subagent-invocations.jsonl')


def test_no_delegate_runtime_rejects_first_run_before_writes(tmp_path):
    root = tmp_path / 'task'
    events, _ = run(root, [[role_create(run={'task': 'Read readiness.'})]], ENV)
    assert results(events, 'task_harness_create')[0].get('isError')
    assert not records(root, 'task-subagents.jsonl')


def test_saved_role_can_stay_in_pool_until_custom_selection(tmp_path):
    root = tmp_path / 'task'
    with child_env() as env:
        events, requests = run(root, [[role_create(assembly=False)],
            [assemble(0, ['subagent:direct-reader@v1'])],
            [{'name': 'delegate_task', 'arguments': {'agent_name': 'direct-reader', 'task': 'Check only after selection.'}}]], env)
    attempt = results(events, 'task_harness_create')[0]
    assert not attempt.get('isError') and 'run' not in attempt['result']['details']
    assert len(records(root, 'subagent-invocations.jsonl')) == 1
    assert not results(events, 'delegate_task')[0].get('isError')
