"""Fault boundaries using production executors; no ARC closure claim."""
from pathlib import Path

import pytest

from test_pi_external_benchmark_native import _run_fixture
from test_task_research_context import results


@pytest.mark.parametrize('phase', ['partial', 'cancel_before', 'cancel_after_write', 'cas',
                                  'run_before', 'run_after_publish', 'prompt_payload_failure'])
def test_direct_use_failure_boundaries(tmp_path, phase):
    events = _run_fixture(tmp_path, 'treatment',
        extra_extensions=[Path(__file__).parent / 'pi_harness_direct_use_fault_fixture.ts'],
        steps=[{'name': 'direct_use_fault', 'arguments': {'phase': phase}}])
    attempt = results(events, 'direct_use_fault')[-1]
    assert not attempt.get('isError'), attempt
    detail = attempt['result']['details']
    assert detail['child_calls'] == 0
    if phase.startswith('run_'):
        assert len(detail['roles']) == (1 if phase == 'run_after_publish' else 0), detail
        assert len(detail['assemblies']) == len(detail['roles'])
        if phase == 'run_after_publish':
            assert detail['result']['details']['run']['status'] == 'failed'
            assert 'cancelled' in str(detail['result']['details']['run'])
        else:
            assert 'cancelled' in detail['error']
    elif phase == 'prompt_payload_failure':
        assert 'Unsupported' in detail['error']
        assert not detail['prompt_projections']
        assert not any(r.get('observation_kind') == 'pi_system_prompt_overlay' for r in detail['observations'])
    else:
        assert len(detail['memory']) == {'partial': 1, 'cancel_before': 0, 'cancel_after_write': 1, 'cas': 2}[phase], detail
        assert len(detail['assemblies']) == (1 if phase == 'cas' else 0), detail
        if phase == 'cancel_before':
            assert 'cancelled' in detail['error']
        else:
            assert detail['result']['details']['selection']['applied'] is False, detail
        if phase == 'cas':
            assert detail['assemblies'][0]['selected_resource_refs'] == []
