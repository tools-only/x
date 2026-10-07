"""Cancellation crosses the public facade into the held native mutation."""
import json
from pathlib import Path

import pytest

from autoresearch_pi.pi_kernel import PiKernel
from test_harness_sequential_batch_native import _create
from test_pi_external_benchmark_native import _pi_cli

PROJECT = Path(__file__).resolve().parents[1]


@pytest.mark.parametrize('entry', ['create', 'change'])
@pytest.mark.parametrize('after_write', [False, True], ids=['before-write', 'after-write'])
def test_cancelled_prepared_publication_preserves_commit_boundary_and_cannot_assemble(tmp_path, entry, after_write):
    node, cli = _pi_cli()
    create = _create('cancelled-publication')
    call = create if entry == 'create' else {'name': 'task_harness', 'arguments': {
        'action': 'change', 'changes': [{'operation': 'create', 'candidate': create['arguments']['candidate']}],
        'decision': create['arguments']['decision']}}
    call['arguments']['assembly'] = {'expected_assembly_revision': 0, 'selected_resource_refs': []}
    steps = [
        {'name': 'task_harness', 'arguments': {'action': 'read_method', 'method_name': 'skill-creator'}}, call]
    command = [node, cli, '--mode', 'rpc', '--provider', 'offline-external-test', '--model', 'scripted',
        '--no-session', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-context-files',
        '--no-builtin-tools', '--extension', str(PROJECT / 'demo/pi_external_benchmark_research.ts'),
        '--extension', str(PROJECT / 'tests/pi_external_benchmark_provider.ts'),
        '--extension', str(PROJECT / 'tests/pi_cancel_skill_mutation.ts')]
    with PiKernel(command, cwd=str(tmp_path), env={
        'PI_CODING_AGENT_DIR': str(tmp_path / '.pi-agent'), 'PI_AUTORESEARCH_E2E_ROOT': str(tmp_path),
        'PI_AUTORESEARCH_ROOT': str(PROJECT), 'PI_AUTORESEARCH_VARIANT': 'treatment',
        'PI_DIAGNOSTIC_CANCEL_AFTER_WRITE': '1' if after_write else '0',
        'PI_EXTERNAL_STEPS': json.dumps(steps)}, timeout=60) as kernel:
        kernel.prompt('Run one cancellation diagnostic.')
        while True:
            event = kernel.wait_for_event(['tool_execution_start', 'agent_end'], timeout=30)
            if event['type'] == 'agent_end':
                pytest.fail('Parent completed before cancellation reached the prepared publication')
            if event.get('toolName') == call['name'] and event.get('args', {}).get('action') != 'read_method':
                kernel.abort()
                break
        kernel.wait_for_agent_events(timeout=30)
    if after_write:
        versions = [json.loads(line) for line in (tmp_path / 'task-skills.jsonl').read_text(encoding='utf-8').splitlines()]
        assert [(row['name'], row['version']) for row in versions] == [('cancelled-publication', 1)]
        receipt = json.loads((tmp_path / 'task-harness-publication-receipts.jsonl').read_text(encoding='utf-8').splitlines()[-1])
        assert receipt['activation']['created_resource_refs'] == ['skill:cancelled-publication@v1']
        assert receipt['assembly_receipt']['applied'] is False
    else:
        assert not (tmp_path / 'task-skills.jsonl').exists()
    assert not (tmp_path / 'task-harness-assemblies.jsonl').exists()
