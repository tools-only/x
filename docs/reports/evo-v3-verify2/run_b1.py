"""One authorized B1 run with an independent budget. No retry or other arm."""
import json
import subprocess
import time
from pathlib import Path

from autoresearch_pi import evo_ppt as e

CAPS = {'requests': 600, 'tokens': None, 'seconds': 14400, 'usd': 30, 'storage_bytes': 2147483648}
AUTHORITY = ('user_contract: George t820u continue validating, run B first; t822u USD30; '
             't823u remove token cap; t824u USD30 EACH; t827u run B1 only. '
             'ONE B1, independent 600 requests/14400 seconds/USD30/2147483648 bytes, no token cap; '
             'all preflights/failures/pending counted; frozen v3 permits; no retry, no cap increase, no push')


def run_b1(root, source, registration):
    if root.exists():
        raise ValueError('one B1 requires a fresh root; no retry/resume')
    root.mkdir(parents=True)
    started = time.time()
    e.write(root / 'round-plan.json', {'phases': ['sample-B1'], 'independent_caps': CAPS, 'authority': AUTHORITY})
    manifest = e.freeze(root / 'sample-B1', source, registration, CAPS, AUTHORITY, 'B')
    previous = json.loads((e.PROJECT / 'docs/reports/evo-v3-verify/sample-B1/manifest.json').read_text(encoding='utf-8'))
    for key in ('sources', 'units', 'checker', 'settings'):
        if manifest[key] != previous[key]:
            raise ValueError(f'frozen v3-verify input changed: {key}')
    result = e.run(root / 'sample-B1', round_deadline=started + CAPS['seconds'])
    e.write(root / 'round-results.json', [{'phase': 'sample-B1', **result}])
    e.write(root / 'final-accounting.json', {
        'started_epoch': started, 'ended_epoch': time.time(), 'caps': CAPS,
        'resources': {**result.get('resources', {}), 'seconds': time.time() - started,
                      'storage_bytes': sum(p.stat().st_size for p in root.rglob('*') if p.is_file())},
        'phases': ['sample-B1'], 'billing': 'conservative 20/80 USD/M; actual invoice unknown'})
    return result


if __name__ == '__main__':
    root = e.PROJECT / 'runs/evo-v3-verify2-20261111'
    previous = json.loads((e.PROJECT / 'docs/reports/evo-v3-verify/sample-B1/manifest.json').read_text(encoding='utf-8'))
    for relative, expected in previous['seed_hashes'].items():
        if relative != 'src/autoresearch_pi/evo_ppt.py' and e.file_hash(e.PROJECT / relative) != expected:
            raise ValueError(f'frozen v3 non-runner source changed: {relative}')
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=e.PROJECT, text=True).strip()
    tag = subprocess.check_output(['git', 'rev-parse', 'v3-verify2^{}'], cwd=e.PROJECT, text=True).strip()
    if commit != tag or subprocess.check_output(['git', 'status', '--porcelain'], cwd=e.PROJECT, text=True).strip():
        raise ValueError('commit and tag runner/test/pre-registration before launch; clean worktree required')
    e.write(Path(__file__).with_name('launch.json'), {
        'started_epoch': time.time(), 'engineering_commit': commit, 'engineering_tag': 'v3-verify2',
        'v3_commit': subprocess.check_output(['git', 'rev-parse', 'v3^{}'], cwd=e.PROJECT, text=True).strip(),
        'preregistration_sha256': e.file_hash(Path(__file__).with_name('pre-registration.md')),
        'authority': AUTHORITY, 'caps': CAPS, 'phases': ['sample-B1']})
    result = run_b1(root, e.PROJECT / 'demo/ppt-cases/bank-of-america-3q21/assets', Path(previous['settings']['registration']))
    print(json.dumps(result, ensure_ascii=False), flush=True)
