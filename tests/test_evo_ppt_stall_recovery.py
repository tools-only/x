"""Scripted Pi transport exercises the production retry settings and runner loop."""
import json
from pathlib import Path

import pytest

from autoresearch_pi import evo_ppt
from autoresearch_pi.pi_kernel import PiKernel


PROJECT = Path(__file__).resolve().parents[1]


@pytest.mark.parametrize('errors,expected', [
    (['fetch failed'], 'plain_text_end'),
    (['fetch failed'] * 3, 'provider_error'),
    (['400 invalid schema'], 'provider_error'),
])
def test_same_run_retries_only_transport_errors(tmp_path, monkeypatch, errors, expected):
    contract = {'source': 'user_contract', 'authority': 'scripted fixture', 'decisions': 'scripted',
                'readonly_reason': 'test user boundary', 'boundaries': ['before_active_reset',
                    'unit_completed', 'before_session_end'],
                'capabilities': ['read', 'write', 'edit', 'ls', 'grep', 'python', 'office.render', 'office.look',
                                 'office.deliver', 'acceptance', 'submit_unit', 'agent_tools'],
                'writable': ['components.tool', 'components.prompt', 'components.skill', 'components.memory', 'policy', 'orchestration'],
                'budget': {'requests': 20, 'tokens': 100000, 'seconds': 120, 'usd': 10, 'storage_bytes': 10000000},
                'acceptance': {'checker': 'fixture', 'expected_slides': 1}, 'inherit_defaults': False, 'heartbeat': False}
    contract['content_hash'] = evo_ppt.digest(contract)
    settings = {'api': 'openai-completions', 'compat': {}, 'model': {'id': evo_ppt.MODEL, 'contextWindow': 100000, 'maxTokens': 8192},
                'thinking': 'low',
                'request_reserve': {'usd': 1, 'tokens': 1000}}
    # This is the same per-run settings object freeze() writes from local_settings().
    registration = tmp_path / 'registration.json'
    evo_ppt.write(registration, {'providers': {'registered': {'baseUrl': evo_ppt.BASE, 'api': 'openai-completions',
        'models': [{'id': evo_ppt.MODEL, 'contextWindow': 100000, 'maxTokens': 8192}]}}})
    settings = evo_ppt.local_settings(registration)
    settings['request_output_tokens'] = 100
    manifest = {'provider': 'az', 'model': evo_ppt.MODEL, 'arm': 'B',
        'contract': contract, 'settings': settings, 'seed_hashes': {}, 'sources': {}, 'units': [],
        'checker': {'version': 'fixture', 'sha256': evo_ppt.file_hash(PROJECT / 'demo/self_root_ppt.ts')},
        'engineering_commit': 'scripted', 'renderer_preflight': {'status': 'passed'}}
    evo_ppt.write(tmp_path / 'manifest.json', manifest)
    (tmp_path / '.harness').mkdir()
    (tmp_path / 'workspace').mkdir()
    monkeypatch.setattr(evo_ppt, 'load_project_dotenv', lambda _p: {'OPENAI_API_KEY': 'scripted-key'})
    monkeypatch.setattr(evo_ppt, 'model_preflight', lambda *_a, **_kw: {
        'status': 'available', 'returned_model': evo_ppt.MODEL, 'elapsed_seconds': 0,
        'accounting': {'tokens': 1, 'usd': .001}})
    steps = [{'stop_reason': 'error', 'error_message': e} for e in errors]
    steps.append(None)
    actual_kernel = PiKernel

    class ScriptedKernel(actual_kernel):
        def __init__(self, command, **kwargs):
            command = [*command[:command.index('--extension') + 2], '--extension',
                str(PROJECT / 'tests/pi_external_benchmark_provider.ts'), '--provider', 'offline-external-test',
                '--model', 'scripted', '--session', str(tmp_path / 'session.jsonl')]
            kwargs['env'] = {**kwargs['env'], 'PI_AUTORESEARCH_E2E_ROOT': str(tmp_path),
                             'PI_EXTERNAL_STEPS': json.dumps(steps), 'PI_EXTERNAL_USAGE_TOKENS': '1',
                             'PPT_DEMO_CACHE_READ_USD_PER_MILLION': '0',
                             'PPT_DEMO_CACHE_WRITE_USD_PER_MILLION': '0'}
            super().__init__(command, **kwargs)

    monkeypatch.setattr(evo_ppt, 'PiKernel', ScriptedKernel)
    result = evo_ppt.run(tmp_path)
    assert result['stop'] == expected, result.get('error')
    requests = [json.loads(line) for line in (tmp_path / 'harness/provider-requests.jsonl').read_text(encoding='utf-8').splitlines()]
    assert len(requests) == (len(errors) + 1 if expected == 'plain_text_end' else len(errors))
    recovery = [json.loads(line) for line in (tmp_path / 'pi-events.jsonl').read_text(encoding='utf-8').splitlines()]
    starts = [e for e in recovery if e['type'] == 'auto_retry_start']
    assert len(starts) == (min(len(errors), 2) if errors[0] == 'fetch failed' else 0)
    assert all(e['delayMs'] <= 4000 for e in starts)
    assert len([e for e in recovery if e['type'] == 'auto_retry_end']) == (1 if starts else 0)
    assert (tmp_path / 'session.jsonl').exists()
    assert len({e['pid'] for e in recovery if e['type'] == 'rpc_control'}) == 1
    assert result['resources']['requests_with_missing_usage'] == 0
