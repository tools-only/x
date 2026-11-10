"""Round 3 only: approved aggregate, same task, no retry or substitution."""
import json
import time
from datetime import datetime, timezone
from pathlib import Path

from autoresearch_pi import evo_ppt as e

root = e.PROJECT / 'runs/evo-v3-real-20261111'
caps = {'requests':600,'tokens':600000,'seconds':14400,'usd':15,'storage_bytes':2147483648}
authority = ('user_contract: Round v3 final round request 2026-11-11; explicitly authorized real A/B1/B2, '
             'same 10 units, az/qwen3.8-27b; aggregate max 600 requests, 600000 tokens, 4h, USD15, 2GB; '
             'failures/preflights/pending counted conservatively; no extra permission needed; never raise caps')
plan = {'total_caps':caps, 'calibration_caps':{**caps,'requests':60,'seconds':1800},
        'b_caps':caps,'shared_remaining':True,'classification':'exploratory A/B1/B2; no automatic retry; engineering round 3/3'}
registration = Path(json.loads((e.PROJECT / 'runs/evo-v2-real-20261111/sample-B1/manifest.json').read_text(encoding='utf-8'))['settings']['registration'])
started = time.time()
e.write(Path(__file__).with_name('round-plan.json'),{**plan,'authority':authority,'started_utc':datetime.now(timezone.utc).isoformat()})
results = e.run_round(root,e.PROJECT / 'demo/ppt-cases/bank-of-america-3q21/assets',registration,plan,authority)
accounting = {'resources':{**{k:sum(r.get('resources',{}).get(k,0) for r in results) for k in ['requests','tokens','usd']},
              'seconds':time.time()-started,'storage_bytes':sum(p.stat().st_size for p in root.rglob('*') if p.is_file())},
              'caps':caps,'started_epoch':started,'ended_epoch':time.time(),
              'billing':'known usage plus unresolved permits at input20/output80 USD/M; actual invoice unknown',
              'phases':[r['phase'] for r in results]}
e.write(root / 'final-accounting.json',accounting)
print(json.dumps({'results':[{'arm':r['phase'],'stop':r['stop'],'resources':r.get('resources')} for r in results],
                  'accounting':accounting},ensure_ascii=False),flush=True)
