import json, time
from datetime import datetime, timezone
from pathlib import Path
from autoresearch_pi import evo_ppt as e

root=e.PROJECT/'runs/evo-v2-real-20261111'
plan=json.loads((root/'round-plan.json').read_text(encoding='utf-8'))
a=root/'calibration-A'
m=json.loads((a/'manifest.json').read_text(encoding='utf-8'))
start=(root/'round-plan.json').stat().st_ctime
# Existing trace also bounds the original start; use the earlier timestamp.
first=json.loads((a/'harness/provider-requests.jsonl').read_text(encoding='utf-8').splitlines()[0])['time']
start=min(start,datetime.fromisoformat(first.replace('Z','+00:00')).timestamp())
deadline=start+plan['total_caps']['seconds']
probe=json.loads((a/'inference-preflight.json').read_text(encoding='utf-8'))
usage=e.resource_usage(a,m['settings']['request_reserve'])
usage.update(requests=usage['requests']+1,tokens=usage['tokens']+probe['accounting']['tokens'],usd=usage['usd']+probe['accounting']['usd'])
result={'phase':'calibration-A','stop':'external_codex_usage_interruption','provider':'az','model':e.MODEL,'arm':'A','resources':usage,
 'engineering_commit':m['engineering_commit'],'runtime_duration':'unknown; no final callback; full interruption charged to aggregate wall clock',
 'units':[{'id':u['id'],'status':'not_delivered'} for u in m['units']],
 'evidence':'session.jsonl, pi-events.jsonl, provider-requests.jsonl and model-usage.jsonl preserved; unreported request keeps original permit'}
e.write(a/'summary.json',result)
results=[result]
e.write(root/'round-results.json',results)
e.write(root/'resume-accounting.json',{'original_start_epoch':start,'original_start_utc':datetime.fromtimestamp(start,timezone.utc).isoformat(),
 'deadline_epoch':deadline,'resumed_epoch':time.time(),'authority':plan['authority'],'no_session_retry':True,
 'note':'A externally interrupted; do not rerun. Only unstarted B arms. All elapsed interruption time remains charged to original 4h cap.'})
source=e.PROJECT/'demo/ppt-cases/bank-of-america-3q21/assets'
for name in ['sample-B1','sample-B2']:
 spent={k:sum(r.get('resources',{}).get(k,0) for r in results) for k in ['requests','tokens','usd']}
 spent['seconds']=time.time()-start
 spent['storage_bytes']=sum(p.stat().st_size for p in root.rglob('*') if p.is_file())
 caps={k:min(plan['b_caps'][k],plan['total_caps'][k]-spent[k]) for k in plan['total_caps']}
 if any(v<=0 for v in caps.values()):
  e.write(root/'round-stop.json',{'reason':'aggregate cap exhausted','spent':spent});break
 print(json.dumps({'starting':name,'remaining':caps}),flush=True)
 e.freeze(root/name,source,Path(m['settings']['registration']),caps,plan['authority'],'B')
 out=e.run(root/name,round_deadline=deadline)
 results.append({'phase':name,**out});e.write(root/'round-results.json',results)
 print(json.dumps({'finished':name,'stop':out['stop'],'resources':out.get('resources')}),flush=True)
e.write(root/'final-accounting.json',{'resources':{**{k:sum(r.get('resources',{}).get(k,0) for r in results) for k in ['requests','tokens','usd']},
 'seconds':time.time()-start,'storage_bytes':sum(p.stat().st_size for p in root.rglob('*') if p.is_file())},'caps':plan['total_caps'],
 'billing':'conservative known plus unresolved permits; invoice unknown','phases':[r['phase'] for r in results]})
