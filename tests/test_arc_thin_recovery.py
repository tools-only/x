from types import SimpleNamespace
import pytest
from autoresearch_pi import arc_thin_e2e as runner
from autoresearch_pi.pi_kernel import PiTurnIdleTimeout


def idle():
    return PiTurnIdleTimeout('silent stream', events=[], idle_seconds=180)


def test_three_isolated_faults_have_independent_recovery_allowances():
    stats = dict(idle_timeouts=0, idle_recoveries=0, idle_recovery_failures=0)
    aborts = []
    kernel = SimpleNamespace(abort=lambda: aborts.append(1),
        wait_for_agent_events=lambda **kw: [{'type':'agent_settled'}])
    for _ in range(3):
        calls = []
        def turn(message):
            calls.append(message)
            if len(calls) == 1: raise idle()
            return [{'type':'agent_settled'}]
        result = runner._recover_native_turn(turn, 'DECIDE', kernel, stats, lambda: False)
        assert result[-1]['type'] == 'agent_settled'
        assert len(calls) == 2
    assert len(aborts) == stats['idle_recoveries'] == 3


def test_decision_timeout_is_observable_and_recovers_after_settlement():
    stats = dict(idle_timeouts=0, idle_recoveries=0, idle_recovery_failures=0,
                 decision_timeouts=0, decision_recoveries=0)
    aborts = []
    kernel = SimpleNamespace(abort=lambda: aborts.append(1),
        wait_for_agent_events=lambda **kw: [{'type':'agent_settled'}])
    calls = []
    def turn(message):
        calls.append(message)
        if len(calls) == 1:
            raise runner.PiDecisionTimeout('timed out waiting for Pi agent turn')
        return [{'type':'agent_settled'}]

    result = runner._recover_native_turn(turn, 'DECIDE', kernel, stats, lambda: False)

    assert result == [{'type':'agent_settled'}]
    assert calls[1].startswith('RECOVER TURN.')
    assert aborts == [1]
    assert stats['decision_timeouts'] == stats['decision_recoveries'] == 1
    assert stats['idle_timeouts'] == stats['idle_recoveries'] == 0


def test_decision_timeout_with_committed_action_does_not_repeat_the_action():
    stats = dict(idle_timeouts=0, idle_recoveries=0, idle_recovery_failures=0,
                 decision_timeouts=0, decision_recoveries=0)
    kernel = SimpleNamespace(abort=lambda: None,
        wait_for_agent_events=lambda **kw: [{'type':'agent_settled'}])
    calls = []
    def turn(message):
        calls.append(message)
        raise runner.PiDecisionTimeout('timed out waiting for Pi agent turn')

    events = runner._recover_native_turn(turn, 'DECIDE', kernel, stats, lambda: True)

    assert len(calls) == 1
    assert events == [{'type':'agent_settled'}]
    assert stats['decision_timeouts'] == 1
    assert stats['decision_recoveries'] == 0


def test_experiment_deadline_timeout_is_not_reclassified_as_turn_recovery():
    stats = dict(idle_timeouts=0, idle_recoveries=0, idle_recovery_failures=0,
                 decision_timeouts=0, decision_recoveries=0)
    aborts = []
    kernel = SimpleNamespace(abort=lambda: aborts.append(1))
    def turn(message):
        raise TimeoutError('experiment deadline elapsed')

    with pytest.raises(TimeoutError, match='experiment deadline'):
        runner._recover_native_turn(turn, 'DECIDE', kernel, stats, lambda: False)

    assert aborts == []
    assert stats['decision_timeouts'] == stats['decision_recoveries'] == 0


def test_permanent_fault_is_finite_and_committed_action_needs_no_new_model_request():
    stats = dict(idle_timeouts=0, idle_recoveries=0, idle_recovery_failures=0)
    kernel = SimpleNamespace(abort=lambda: None,
        wait_for_agent_events=lambda **kw: [{'type':'agent_settled'}])
    calls = []
    def turn(message):
        calls.append(message); raise idle()
    with pytest.raises(RuntimeError, match='continuous'):
        runner._recover_native_turn(turn, 'DECIDE', kernel, stats, lambda: False)
    assert len(calls) == 3
    calls.clear()
    result = runner._recover_native_turn(turn, 'DECIDE', kernel, stats, lambda: True)
    assert len(calls) == 1
    assert result == [{'type':'agent_settled'}]


@pytest.mark.parametrize('health,total,trajectory', [
    ('busy', 3, 3), ('uncertain', 3, 3), ('ready', 4, 3), ('ready', 3, 4)])
def test_recovery_refuses_uncertain_or_conflicting_action_state(health,total,trajectory):
    with pytest.raises(RuntimeError, match='outcome'):
        runner._reconciled_action(3, {'status':health},
            {'action_budget':{'total_used':total}}, trajectory)


def test_recovery_reconciles_committed_action_or_unchanged_state():
    assert runner._reconciled_action(3, {'status':'ready'}, {'action_budget':{'total_used':4}}, 4)
    assert not runner._reconciled_action(3, {'status':'ready'}, {'action_budget':{'total_used':3}}, 3)


def test_native_default_consolidation_is_disabled_and_legacy_remains_frozen():
    assert runner._consolidation_interval('native', None) == 0
    assert runner._consolidation_interval('legacy', None) == 25
    assert runner._consolidation_interval('native', 25) == 25


def test_runs_declare_image_input_unless_told_otherwise():
    # Image input is declared by default (the user's request, 2026-10-20); a text-only model is declared text.
    assert runner._input_modalities(None, {}) == ['text', 'image']
    assert runner._input_modalities(None, {'ARC_INPUT_MODALITIES': 'text'}) == ['text']
    assert runner._input_modalities('text', {'ARC_INPUT_MODALITIES': 'text,image'}) == ['text']


def test_recovery_keeps_consolidation_non_action_and_restarts_only_dead_pi():
    stats = dict(idle_timeouts=0, idle_recoveries=0, idle_recovery_failures=0)
    messages = []
    kernel = SimpleNamespace(abort=lambda: None,
        wait_for_agent_events=lambda **kw: [{'type':'agent_settled'}])
    def turn(message):
        messages.append(message)
        if len(messages) == 1: raise idle()
        return [{'type':'agent_settled'}]
    runner._recover_native_turn(turn, runner.CONSOLIDATE_PROMPT, kernel, stats, lambda: False)
    assert messages[1] == runner.CONSOLIDATE_RECOVERY_PROMPT

    kernel.process = SimpleNamespace(poll=lambda: 1)
    messages.clear(); restarted = []
    def dead_turn(message):
        messages.append(message)
        if len(messages) == 1: raise RuntimeError('Pi RPC process exited before responding')
        return [{'type':'agent_settled'}]
    runner._recover_native_turn(dead_turn, 'DECIDE', kernel, stats, lambda: False,
                                restart=lambda: restarted.append(1))
    assert len(messages) == 2 and restarted == [1]
    assert stats['pi_process_restarts'] == 1
    messages.clear(); restarted.clear()
    result = runner._recover_native_turn(dead_turn, 'DECIDE', kernel, stats, lambda: True,
                                restart=lambda: restarted.append(1))
    assert len(messages) == 1 and restarted == [1]
    assert result == [{'type':'agent_settled', 'recovery':'committed_action'}]
    kernel.process = SimpleNamespace(poll=lambda: None)
    messages.clear(); restarted.clear()
    with pytest.raises(RuntimeError, match='process exited'):
        runner._recover_native_turn(dead_turn, 'DECIDE', kernel, stats, lambda: False,
                                    restart=lambda: restarted.append(1))
    assert restarted == []


def test_dead_pi_closed_stdin_error_recovers_but_live_io_error_does_not():
    stats=dict(idle_timeouts=0,idle_recoveries=0,idle_recovery_failures=0)
    kernel=SimpleNamespace(process=SimpleNamespace(poll=lambda:1))
    calls=[]; restarts=[]
    def turn(message):
        calls.append(message)
        if len(calls)==1: raise OSError(22,'Invalid argument')
        return [{'type':'agent_settled'}]
    runner._recover_native_turn(turn,'DECIDE',kernel,stats,lambda:False,restart=lambda:restarts.append(1))
    assert len(calls)==2 and restarts==[1]
    calls.clear();restarts.clear();kernel.process=SimpleNamespace(poll=lambda:None)
    with pytest.raises(OSError):
        runner._recover_native_turn(turn,'DECIDE',kernel,stats,lambda:False,restart=lambda:restarts.append(1))
    assert restarts==[]


def test_abort_without_settlement_refuses_new_requests():
    stats=dict(idle_timeouts=0,idle_recoveries=0,idle_recovery_failures=0)
    calls=[]
    kernel=SimpleNamespace(abort=lambda:None,wait_for_agent_events=lambda **kw:[])
    def turn(message):calls.append(message);raise idle()
    with pytest.raises(RuntimeError,match='did not settle'):
        runner._recover_native_turn(turn,'DECIDE',kernel,stats,lambda:False)
    assert len(calls)==1 and stats['idle_recovery_failures']==1


def test_real_protocol_has_no_active_decision_deadline(tmp_path,monkeypatch):
    import importlib.util,json
    from pathlib import Path
    spec=importlib.util.spec_from_file_location('real_protocol',runner.PROJECT_ROOT/'tools/run_foundation_real.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    monkeypatch.setattr(module,'load_project_dotenv',lambda _: {})
    monkeypatch.setattr(module,'source_hashes',lambda: {})
    root=tmp_path/'ordinary'
    monkeypatch.setattr(module.sys,'argv',['run_foundation_real.py',str(root)])
    seen={}
    def run(path,**kwargs):
        seen.update(kwargs);path.mkdir();summary=path/'summary.json'
        summary.write_text(json.dumps(dict(passed=True,stop_reason='budget_exhausted')))
        return summary
    monkeypatch.setattr(module.runner,'run_arc_thin_e2e',run)
    monkeypatch.setattr(module.runner,'PiKernel',runner.PiKernel)
    module.main()
    protocol=json.loads((root/'real-observation-protocol.json').read_text())
    assert seen['decision_timeout_seconds']==protocol['decision_timeout_seconds']==0
    assert seen['experiment_timeout_seconds']==0
    assert seen['max_decisions'] is None and seen['max_reported_tokens'] is None
    assert seen['max_actions']==100 and seen['turn_idle_timeout_seconds']==180
