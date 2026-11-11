"""Seal local evidence costs; no task execution or provider access."""
import hashlib
import json
import time
from pathlib import Path

OUT = Path(__file__).parent
PROJECT = OUT.resolve().parents[2]
ROOT = PROJECT / 'runs/evo-v3-verify2-20261111'
REPORT = PROJECT / 'docs/reports/ROUND-v3-verify2.md'
EXTERNAL = Path('C:/Users/qi/tmp/r04/evo-design/ROUND-v3-verify2.md')
initial = json.loads((OUT / 'launch-accounting.json').read_text(encoding='utf-8'))
audit = json.loads((OUT / 'verification-audit.json').read_text(encoding='utf-8'))
assert REPORT.read_text(encoding='utf-8') == EXTERNAL.read_text(encoding='utf-8')
assert '\ufffd' not in REPORT.read_text(encoding='utf-8')
assert (OUT / 'pre-registration.md').read_bytes()
launch = json.loads((OUT / 'launch.json').read_text(encoding='utf-8'))
assert hashlib.sha256((OUT / 'pre-registration.md').read_bytes()).hexdigest() == launch['preregistration_sha256']
assert audit['engineering_commit'] == audit['tag_commit'] == launch['engineering_commit']
accounting = {**initial, 'experiment_end_epoch': initial['ended_epoch'], 'ended_epoch': time.time(),
    'execution_seconds': initial['resources']['seconds'],
    'resources': {**initial['resources'], 'seconds': time.time() - initial['started_epoch']},
    'unknown_liabilities': [{'arm': 'sample-B1', 'kind': 'inference preflight remote disconnect',
        'requests': 1, 'tokens_reserved_not_measured': 4290, 'conservative_usd_reserved': .08676,
        'registered_price_usd_reserved': .02185, 'reported_usage': None, 'invoice': 'unknown'}],
    'registered_price_usd': {'known_reported_requests': 0, 'unknown_reserved': .02185,
        'rates_per_million': {'input': 5, 'output': 30, 'cacheRead': 0, 'cacheWrite': 0}, 'invoice': 'unknown'},
    'stop': 'environment_failure_before_task_agent', 'task_requests': 0, 'posthoc_task_render_or_checker': False,
    'storage_scope': {'directories': [str(ROOT), str(OUT)], 'additional_files': [str(REPORT), str(EXTERNAL)],
        'measurement': 'logical file bytes, every copy counted including both final-accounting files; Git objects and caller Codex logs excluded'},
    'time_scope': 'launch through evidence export and Chinese report seal; execution end separately recorded; later Git bookkeeping is development work',
    'report_sha256': hashlib.sha256(REPORT.read_bytes()).hexdigest(),
    'external_report_sha256': hashlib.sha256(EXTERNAL.read_bytes()).hexdigest()}
for _ in range(5):
    for path in (ROOT / 'final-accounting.json', OUT / 'final-accounting.json'):
        path.write_text(json.dumps(accounting, ensure_ascii=False, indent=2), encoding='utf-8')
    storage = sum(p.stat().st_size for base in (ROOT, OUT) for p in base.rglob('*') if p.is_file()) + REPORT.stat().st_size + EXTERNAL.stat().st_size
    arm_storage = sum(p.stat().st_size for p in (ROOT / 'sample-B1').rglob('*') if p.is_file())
    if accounting['resources']['storage_bytes'] == storage and accounting.get('per_arm_final_original_storage_bytes') == {'sample-B1': arm_storage}:
        break
    accounting['resources']['storage_bytes'] = storage
    accounting['per_arm_final_original_storage_bytes'] = {'sample-B1': arm_storage}
else:
    raise AssertionError('accounting byte size did not settle')
assert accounting['resources']['requests'] == 1 <= accounting['caps']['requests']
assert accounting['resources']['usd'] < accounting['caps']['usd']
assert accounting['resources']['seconds'] < accounting['caps']['seconds']
assert accounting['resources']['storage_bytes'] < accounting['caps']['storage_bytes']
assert accounting['caps']['tokens'] is None
print(json.dumps({'resources': accounting['resources'], 'execution_seconds': accounting['execution_seconds'],
                  'per_arm_final_original_storage_bytes': accounting['per_arm_final_original_storage_bytes']}, ensure_ascii=False))
