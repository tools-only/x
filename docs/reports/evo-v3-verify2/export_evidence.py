"""Read-only run export/accounting; never imports or calls a provider/runner."""
import hashlib
import json
import shutil
import subprocess
from datetime import datetime, timezone, timedelta
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).parent
ROOT = PROJECT / 'runs/evo-v3-verify2-20261111'
ARM = ROOT / 'sample-B1'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')


manifest = read(ARM / 'manifest.json')
previous = read(PROJECT / 'docs/reports/evo-v3-verify/sample-B1/manifest.json')
summary = read(ARM / 'summary.json')
initial_accounting = OUT / 'launch-accounting.json'
if not initial_accounting.exists():
    shutil.copy2(ROOT / 'final-accounting.json', initial_accounting)
accounting = read(initial_accounting)
arm_out = OUT / 'sample-B1'
arm_out.mkdir(exist_ok=True)
for name in ('manifest.json', 'summary.json', 'renderer-preflight.json', 'inference-preflight.json', 'units.json', 'task-provenance.json'):
    shutil.copy2(ARM / name, arm_out / name)
for name in ('round-plan.json', 'round-results.json'):
    shutil.copy2(ROOT / name, OUT / name)
input_checks = {key: manifest[key] == previous[key] for key in ('sources', 'units', 'checker', 'settings')}
seed_checks = {relative: {'before': expected, 'at_freeze': manifest['seed_hashes'][relative],
                        'after': sha(PROJECT / relative), 'unchanged': expected == manifest['seed_hashes'][relative] == sha(PROJECT / relative)}
               for relative, expected in previous['seed_hashes'].items() if relative != 'src/autoresearch_pi/evo_ppt.py'}
assert all(input_checks.values()) and all(row['unchanged'] for row in seed_checks.values())
absent = {name: not (ARM / name).exists() for name in
          ('session.jsonl', 'pi-events.jsonl', 'runtime-manifest.json', '.pi-agent', '.harness/live-self.json',
           'harness/provider-requests.jsonl', 'harness/model-usage.jsonl', 'budget-stop.json', 'delivery/presentation.html')}
assert all(absent.values()) and summary['stop'] == 'az_inference_unavailable'
assert [p.name for p in ROOT.iterdir() if p.is_dir()] == ['sample-B1']
artifacts = [p for p in (ARM / 'workspace/artifacts').rglob('*') if p.is_file()]
evidence = {'classification': 'environment_failure_before_task_agent', 'raw_root': str(ROOT),
    'engineering_commit': manifest['engineering_commit'], 'tag_commit': subprocess.check_output(['git', 'rev-parse', 'v3-verify2^{}'], cwd=PROJECT, text=True).strip(),
    'input_checks_against_v3_verify_B1': input_checks, 'non_runner_seed_checks': seed_checks,
    'absence_checks': absent, 'task_artifact_files': [str(p.relative_to(ARM)) for p in artifacts],
    'token_budget': manifest['token_budget'], 'request_attempts': 1, 'task_requests': 0,
    'reviews_entered': [], 'reviews_closed': [], 'agent_runtime_revisions': [], 'verification_windows': [],
    'adopt': [], 'restore': [], 'render_look_checker_delivery_in_run': dict.fromkeys(('render', 'look', 'checker', 'delivery'), 0),
    'units': [{'id': u['id'], 'source_page': u['source_page'], 'status': 'not_run_environment',
               'literal_quality': None, 'normalized_quality': None, 'delivered': False} for u in manifest['units']],
    'pages_rendered_in_task': None, 'units_delivered': 0, 'pages_delivered': 0,
    'cost': {'reported_tokens': None, 'input': None, 'output': None, 'reasoning': None, 'cacheRead': None, 'cacheWrite': None,
             'unresolved_request_attempts': 1, 'unknown_reserved_tokens': 4290, 'unknown_reserved_usd_20_80': .08676,
             'unknown_reserved_usd_registered_5_30': .02185, 'invoice': 'unknown'},
    'run_seconds_including_freeze_and_preflights': accounting['resources']['seconds'],
    'started_local': datetime.fromtimestamp(accounting['started_epoch'], timezone(timedelta(hours=8))).isoformat(),
    'ended_local': datetime.fromtimestamp(accounting['ended_epoch'], timezone(timedelta(hours=8))).isoformat(),
    'raw_file_index': [{'path': str(p.relative_to(ROOT)), 'bytes': p.stat().st_size, 'sha256': sha(p)}
                       for p in ROOT.rglob('*') if p.is_file() and p.name != 'final-accounting.json']}
write(OUT / 'verification-audit.json', evidence)
print(json.dumps({key: evidence[key] for key in ('classification', 'task_artifact_files', 'started_local', 'ended_local', 'run_seconds_including_freeze_and_preflights')}, ensure_ascii=False))
