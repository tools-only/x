"""Actual Pi + production bridge/WASI; scripted abort-aware provider and mock ARC SDK. No paid calls."""
import json
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src'))
from autoresearch_pi.arc_thin_e2e import run_arc_thin_e2e, PROJECT_ROOT, SMOKE_PROVIDER
from autoresearch_pi import arc_thin_e2e
from autoresearch_pi.pi_kernel import PiKernel

root=Path(sys.argv[1])
mode = sys.argv[2] if len(sys.argv)>2 else 'idle'
dead = mode in {'dead','closedstdin'}
if dead or mode=='committedlength':
    class DeathProbeKernel(PiKernel):
        def prompt(self, message):
            marker=root/'death-injected.txt'
            if mode=='closedstdin' and not marker.exists() and (root/'harness/trajectory.jsonl').exists():
                marker.write_text('between turns before writing to closed stdin')
                self.process.kill();self.process.wait(timeout=5)
            return super().prompt(message)
        def wait_for_agent_events(self, *args, **kwargs):
            events = super().wait_for_agent_events(*args, **kwargs)
            marker = root/'death-injected.txt'
            if mode=='committedlength' and not marker.exists():
                marker.write_text('length event after committed action; no recovery model request')
                events.append({'type':'message_end','message':{'stopReason':'length'}})
            if mode=='dead' and not marker.exists() and (root/'harness/trajectory.jsonl').exists():
                marker.write_text('after one committed action; before caller receives settlement')
                self.process.kill(); self.process.wait(timeout=5)
                raise RuntimeError('Pi RPC process exited before responding')
            return events
    arc_thin_e2e.PiKernel=DeathProbeKernel
path=run_arc_thin_e2e(root,arc_root=PROJECT_ROOT,game='ls20',foundation='native',
    max_actions=4,max_decisions=4,experiment_timeout_seconds=120,decision_timeout_seconds=30,turn_idle_timeout_seconds=0.5,
    pi_provider='offline-arc-thin-smoke',pi_model='scripted',pi_provider_extension=SMOKE_PROVIDER,
    bridge_python=Path(sys.executable),bridge_module_paths=(PROJECT_ROOT/'tools/mock_arc_sdk',),
    ledger=False,critic=False,extension_env={'ARC_THIN_SMOKE_SCRIPT':'length' if mode=='length' else 'death' if dead or mode=='committedlength' else 'recovery','ARC_THIN_AUTO_COMPACTION':'1'})
summary=json.loads(path.read_text())
assert summary['passed'],summary
if dead:assert summary.get('pi_process_restarts',0)==1,summary
elif mode=='idle':assert summary['idle_recoveries']==3,summary
else:
    assert summary['length_stops']==1 and summary['length_recoveries']==int(mode=='length'),summary
    assert summary['decisions']==4,summary
assert summary['actions']==summary['actions_on_bridge']==4,summary
if mode=='idle':
    assert summary['request_accounting']['unknown_cost_attempts']==3,summary
    assert summary['request_accounting']['by_kind']['parent']['aborted']==3,summary
trajectory=[json.loads(line) for line in (root/'harness/trajectory.jsonl').read_text().splitlines()]
assert [row['n'] for row in trajectory]==[1,2,3,4]
assert json.loads((root/'run-config.json').read_text())['consolidate_after_actions']==0
report=json.loads((root/'reuse_report.json').read_text())
assert report['cost']['request_accounting']==summary['request_accounting']
assert report['cost']['complete_cost_known']==summary['request_accounting']['complete_cost_known']
assert report['cost']['total_reported']==summary['request_accounting']['known_tokens_lower_bound']
print(path)
