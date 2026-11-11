"""One authorized v3 validation; experiment scheduling only, no retries."""
import math
import time
from pathlib import Path

from autoresearch_pi import evo_ppt as e

root = e.PROJECT / 'runs/evo-v3-verify-20261111'
caps = {'requests':600,'tokens':600000,'seconds':14400,'usd':15,'storage_bytes':2147483648}
b_caps = {k:math.floor(v*.45) if k in ('requests','tokens','storage_bytes') else v*.45 for k,v in caps.items()}
authority = ('user_contract: George t820u continue validating, run B first; ONE v3 validation, '
             'B1 -> B2 -> A, each B <=45% of every total cap, A actual remainder; '
             '600 requests/600000 tokens/14400 seconds/USD15/2147483648 bytes total; '
             'preflights/failures/pending counted, unchanged v3 permits, no retry/no cap increases/no push')
plan = {'total_caps':caps,'shared_remaining':True,'phases':[
    {'name':'sample-B1','arm':'B','caps':b_caps},
    {'name':'sample-B2','arm':'B','caps':b_caps},
    {'name':'calibration-A','arm':'A','caps':caps}],
    'classification':'single validation of v3; B-first schedule only; no new design round',
    'preregistration':'docs/reports/evo-v3-verify/pre-registration.md'}

if __name__ == '__main__':
    import json
    import subprocess
    previous = json.loads((e.PROJECT/'docs/reports/evo-v3-real/sample-B1/manifest.json').read_text(encoding='utf-8'))
    registration = Path(previous['settings']['registration'])
    # Check all protected/non-runner seeds before any paid call.
    for relative, expected in previous['seed_hashes'].items():
        if relative != 'src/autoresearch_pi/evo_ppt.py' and e.file_hash(e.PROJECT/relative) != expected:
            raise ValueError(f'v3 non-runner source changed: {relative}')
    if subprocess.check_output(['git','status','--porcelain'],cwd=e.PROJECT,text=True).strip():
        raise ValueError('commit experiment schedule and pre-registration before launch')
    started = time.time()
    e.write(Path(__file__).with_name('launch.json'),{
        'started_epoch':started,'engineering_commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=e.PROJECT,text=True).strip(),
        'v3_commit':subprocess.check_output(['git','rev-parse','v3^{}'],cwd=e.PROJECT,text=True).strip(),
        'preregistration_sha256':e.file_hash(Path(__file__).with_name('pre-registration.md')),
        'authority':authority,'plan':plan})
    results = e.run_round(root,e.PROJECT/'demo/ppt-cases/bank-of-america-3q21/assets',registration,plan,authority)
    accounting = {'resources':{**{k:sum(r.get('resources',{}).get(k,0) for r in results) for k in ('requests','tokens','usd')},
                  'seconds':time.time()-started,'storage_bytes':sum(p.stat().st_size for p in root.rglob('*') if p.is_file())},
                  'caps':caps,'started_epoch':started,'ended_epoch':time.time(),'phases':[r['phase'] for r in results],
                  'billing':'reported usage plus unresolved v3 permits; conservative input/cache20 output80 USD/M; invoice unknown'}
    e.write(root/'final-accounting.json',accounting)
    print(json.dumps({'results':[{'arm':r['phase'],'stop':r['stop'],'resources':r.get('resources')} for r in results],
                      'accounting':accounting},ensure_ascii=False),flush=True)
