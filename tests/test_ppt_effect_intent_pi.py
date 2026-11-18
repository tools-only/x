"""Real Pi/extension wiring; scripted provider does not establish autonomy."""
import json
import shutil
import pytest

from autoresearch_pi.pi_kernel import PiKernel
from test_evo_ppt_pi import PROJECT, fixture_manifest


@pytest.mark.parametrize('meta', [False, True])
def test_qualitative_effect_activates_without_numeric_window(tmp_path, meta):
    manifest = fixture_manifest()
    path = tmp_path / 'manifest.json'
    path.write_text(json.dumps(manifest), encoding='utf-8')
    steps = [
        {'name': 'python', 'arguments': {'code': 'def draft_probe(args, env):\n    with open("data/session_probe.txt") as source:\n        return source.read().strip() + args["suffix"]'}},
        {'name': 'python', 'arguments': {'code': 'draft_probe({"suffix": "-draft"}, None)'}},
        {'name': 'reflect_component', 'arguments': {
            'op': 'define', 'kind': 'tool', 'name': 'session_probe',
            'session_ref': 'draft_probe', 'description': 'Read the workspace probe and append a suffix.'}},
        {'name': 'session_probe', 'arguments': {'args': {'suffix': '-native'}}},
        {'name': 'read', 'arguments': {'path': 'data/instructions.md'}},
        {'name': 'reflect_component', 'arguments': {
            'op': 'define', 'kind': 'memory', 'name': 'layout_feedback',
            'source': 'Check chart labels against rendered pages before delivery.',
            'expected_effect': 'Make chart labels easier to read.'}},
        {'name': 'reflect_component', 'arguments': {
            'op': 'define', 'kind': 'memory', 'name': 'hidden_feedback',
            'source': 'HIDDEN-MEMORY-MUST-NOT-REACH-THE-PROVIDER.'}},
        {'name': 'reflect_orchestration', 'arguments': {
            'policy': {'memory': {'names': ['layout_feedback'], 'order': 'name', 'write': 'replace'}}}},
        {'name': 'reflect_component', 'arguments': {
            'op': 'define', 'kind': 'tool', 'name': 'evo_probe',
            'source': '# program: on\n# description: probe component v1\ndef main(args):\n    return "probe-v1"'}},
        {'name': 'reflect_component', 'arguments': {
            'op': 'redefine', 'kind': 'tool', 'name': 'evo_probe',
            'source': '# program: on\n# description: probe component v2\n# parameters: {"type":"object","properties":{"value":{"type":"string"}},"required":["value"]}\ndef main(args):\n    return "probe-v2"'}},
        {'name': 'evo_probe', 'arguments': {'value': 'x'}},
        {'name': 'reflect_component', 'arguments': {
            'op': 'define', 'kind': 'tool', 'name': 'evo_fail',
            'source': '# program: on\n# description: deliberate failure fixture\ndef main(args):\n    raise Exception("expected fixture failure")'}},
        {'name': 'evo_fail', 'arguments': {}},
        {'name': 'reflect_component', 'arguments': {
            'op': 'define', 'kind': 'skill', 'name': 'layout_check',
            'source': 'Compare chart labels against the rendered slide.'}},
        {'name': 'read_self_component', 'arguments': {'kind': 'skill', 'name': 'layout_check'}},
        {'name': 'read_self_component', 'arguments': {'kind': 'memory', 'name': 'layout_feedback'}},
        {'name': 'read_self', 'arguments': {'section': 'windows'}},
    ]
    data = tmp_path / 'workspace/data'
    data.mkdir(parents=True)
    brief = (PROJECT / 'demo/ppt-cases/bank-of-america-3q21/assets/production_brief.md').read_text(encoding='utf-8')
    (data / 'instructions.md').write_text(brief, encoding='utf-8')
    (data / 'session_probe.txt').write_text('probe-input', encoding='utf-8')
    if meta:
        orchestration = {'mode': 'replace', 'roles': [{'id': 'agent'}], 'slots': [],
                         'steps': [{'id': 'work', 'role': 'agent'}], 'decisions': [], 'transitions': [],
                         'contract': {'task_goal': 'Develop the slides and reusable harness required by the brief.',
                                      'task_acceptance': 'Inspect visual quality, substantive harness trials and known limitations.',
                                      'loop_policy': {'look_when': [{'on': 'segment_boundary', 'look': 'Review candidate output and revise work when needed.'}]}}}
        # The script sends the nested object JSON-encoded once to exercise the dispatch boundary.
        steps.insert(0, {'name': 'reflect_orchestration', 'arguments': {'orchestration': json.dumps(orchestration)}})
        steps.append({'name': 'reflect_orchestration', 'arguments': {'orchestration': {
            'mode': 'edit', 'transitions_by_id': {'bad_transition': {
                'from': 'work', 'to': 'missing_step', 'on': {'type': 'action', 'action': 'office.render'},
                'requires': [{'type': 'office.render'}]}}}}})
        steps.append({'name': 'reflect_orchestration', 'arguments': {
            'orchestration': {'mode': 'edit', 'steps_by_id': {'reinspect': {'role': 'agent'}},
                              'transitions_by_id': {'work_to_reinspect': {
                                  'from': 'work', 'to': 'reinspect', 'on': {'type': 'action', 'action': 'office.render'},
                                  'requires': [{'type': 'office.render'}]}}}}})
    command = [shutil.which('node'), str(PROJECT / 'node_modules/@earendil-works/pi-coding-agent/dist/cli.js'),
               '--mode', 'rpc', '--no-context-files', '--no-extensions', '--no-skills',
               '--no-prompt-templates', '--no-builtin-tools',
               '--extension', str(PROJECT / 'demo/ppt_demo_extension.ts'),
               '--extension', str(PROJECT / 'tests/pi_external_benchmark_provider.ts'),
               '--provider', 'offline-external-test', '--model', 'scripted',
               '--session', str(tmp_path / 'session.jsonl')]
    env = {'PI_CODING_AGENT_DIR': str(tmp_path / '.pi-agent'),
           'PI_AUTORESEARCH_E2E_ROOT': str(tmp_path), 'PPT_DEMO_ROOT': str(tmp_path),
           'EVO_MANIFEST': str(path), 'EVO_META': '1' if meta else '0',
           'PPT_DEMO_DEADLINE': '4102444800000', 'PPT_DEMO_BUDGET_USD': '1',
           'PPT_DEMO_REQUEST_RESERVE_USD': '0.001',
           'PI_EXTERNAL_STEPS': json.dumps(steps), 'PI_EXTERNAL_USAGE_TOKENS': '1'}
    with PiKernel(command, cwd=str(tmp_path), env=env, timeout=90) as kernel:
        assert kernel.prompt('Run the scripted qualitative effect wiring check.').get('success') is not False
        events = kernel.wait_for_agent_events(timeout=120)
    results = [e for e in events if e.get('type') == 'tool_execution_end']
    assert any(e.get('toolName') == 'python' and 'probe-input-draft' in json.dumps(e.get('result')) for e in results)
    assert any(e.get('toolName') == 'session_probe' and 'probe-input-native' in json.dumps(e.get('result')) for e in results)
    read = next(e for e in results if e.get('toolName') == 'read_self_component' and 'layout_feedback' in json.dumps(e.get('result')))
    assert 'Check chart labels against rendered pages' in json.dumps(read['result'])
    saved = json.loads((tmp_path / '.harness/live-self.json').read_text(encoding='utf-8'))
    ledger = saved['root']['ledger']
    deliveries = [component for row in ledger if row['type'] == 'provider_input'
                  for component in row['value'].get('component_delivery', [])]
    memory_delivery = next(component for component in deliveries if component['kind'] == 'memory' and component['name'] == 'layout_feedback')
    assert memory_delivery['surface'] == 'memory_text' and memory_delivery['version'] == 1
    policy_activation = next(row for row in ledger if row['type'] == 'reflection_activated' and row.get('value', {}).get('parent') is not None
                             and 'policy.memory' in row['value'].get('addresses', []))
    filtered_rows = [row for row in ledger if row['type'] == 'provider_input' and row['value']['pin']['revision'] >= policy_activation['value']['revision']]
    assert filtered_rows and not any(component['kind'] == 'memory' and component['name'] == 'hidden_feedback'
                                     for row in filtered_rows for component in row['value'].get('component_delivery', []))
    tool_delivery = next(component for component in deliveries if component['kind'] == 'tool' and component['name'] == 'evo_probe' and component['version'] == 2)
    execution = next(row['value'] for row in ledger if row['type'] == 'component_execution' and row['value']['name'] == 'evo_probe')
    assert execution == {key: tool_delivery[key] for key in ('kind', 'name', 'version', 'hash')} | {'outcome': 'success'}
    failed_execution = next(row['value'] for row in ledger if row['type'] == 'component_execution' and row['value']['name'] == 'evo_fail')
    assert failed_execution['outcome'] == 'failure'
    skill_delivery = next(component for component in deliveries if component['kind'] == 'skill' and component['name'] == 'layout_check')
    assert skill_delivery['surface'] == 'skill_index'
    skill_read = next(row['value'] for row in ledger if row['type'] == 'component_body_read' and row['value']['name'] == 'layout_check')
    assert skill_read['version'] == skill_delivery['version'] and skill_read['outcome'] == 'success'
    assert not saved['root']['windows']
    assert any('Make chart labels easier to read.' in json.dumps(row) for row in saved['root']['ledger'])
    contexts = [json.loads(line)['context'] for line in (tmp_path / 'provider-contexts.jsonl').read_text(encoding='utf-8').splitlines()]
    assert any('Check chart labels against rendered pages before delivery.' in json.dumps(context) for context in contexts[1:])
    assert any('session_ref' in tool['parameters']['properties']
               for context in contexts for tool in context['messages'][0]['toolsAdded']
               if tool['name'] == 'reflect_component')
    probe_schema = next(tool for context in contexts for tool in context['messages'][0]['toolsAdded'] if tool['name'] == 'evo_probe' and 'probe component v2' in tool['description'])
    assert f"evo_probe@v{tool_delivery['version']} {tool_delivery['hash']}" in probe_schema['description']
    assert probe_schema['parameters']['properties']['value']['type'] == 'string'
    provider_rows = [row for row in ledger if row['type'] == 'provider_input']
    assert all('HIDDEN-MEMORY-MUST-NOT-REACH-THE-PROVIDER' not in json.dumps(context['messages'][0])
               for row, context in zip(provider_rows, contexts)
               if row['value']['pin']['revision'] >= policy_activation['value']['revision'])
    schema = next(t['parameters'] for t in contexts[0]['messages'][0]['toolsAdded'] if t['name'] == 'reflect_component')
    assert schema['properties']['success_predicate']['required'] == ['metric', 'direction', 'segment']
    assert 'Does not open a numeric validation window' in schema['properties']['expected_effect']['description']
    instruction_result = next(e for e in results if e.get('toolName') == 'read')
    assert '广告级别的极高质量slides' in json.dumps(instruction_result['result'], ensure_ascii=False)
    if meta:
        delivered_context = json.dumps(contexts, ensure_ascii=False)
        assert "You own the task's time horizon" in delivered_context
        assert 'commercial product quality' in delivered_context
        assert 'retiring components' in delivered_context
        assert [s['id'] for s in saved['snapshot']['orchestration']['steps']] == ['work', 'reinspect']
        assert saved['snapshot']['orchestration']['transitions'] == [{
            'id': 'work_to_reinspect', 'from': 'work', 'to': 'reinspect',
            'on': {'type': 'action', 'action': 'office.render'}, 'requires': [{'type': 'office.render'}]}]
        assert not saved['snapshot']['complete']
        session_rows = [json.loads(line) for line in (tmp_path / 'session.jsonl').read_text(encoding='utf-8').splitlines()]
        rejected = next(row['message'] for row in session_rows if row.get('type') == 'message' and row.get('message', {}).get('role') == 'toolResult'
                        and row['message'].get('toolName') == 'reflect_orchestration' and 'missing_step' in json.dumps(row['message'], ensure_ascii=False))
        rejected_result = json.dumps(rejected.get('content'), ensure_ascii=False)
        assert 'valid_step_ids' in rejected_result and 'work' in rejected_result and 'missing_step' in rejected_result
        assert 'rejected_not_activated' in rejected_result and 'correction' in rejected_result
        schema = next(t['parameters'] for t in contexts[0]['messages'][0]['toolsAdded'] if t['name'] == 'reflect_orchestration')
        assert schema['properties']['orchestration']['required'] == ['mode']
        assert 'orchestration_patch' not in schema['properties']
        assert 'steps_by_id' in schema['properties']['orchestration']['properties']
        assert 'omitted' in schema['properties']['orchestration']['description']
