"""Read-only, credential-free progress and conservative usage view."""
import json
import time
from pathlib import Path
from autoresearch_pi import evo_ppt as e

root=e.PROJECT/'runs/evo-v3-real-20261111'
out=[]
for arm in ['calibration-A','sample-B1','sample-B2']:
    p=root/arm
    if not p.exists():
        continue
    read=lambda path,default: json.loads(path.read_text(encoding='utf-8')) if path.exists() else default
    manifest=read(p/'manifest.json',{})
    state=read(p/'.harness/ppt-loop.json',{})
    saved=read(p/'.harness/live-self.json',{}).get('root',{})
    ledger=saved.get('ledger',[])
    requests=[json.loads(s) for s in (p/'harness/provider-requests.jsonl').read_text(encoding='utf-8').splitlines()] if (p/'harness/provider-requests.jsonl').exists() else []
    usage=e.resource_usage(p,manifest.get('settings',{}).get('request_reserve',{}))
    probe=read(p/'inference-preflight.json',{})
    for k in ['requests','tokens','usd']:
        usage[k]+=probe.get('accounting',{}).get(k,0)
    summary=read(p/'summary.json',{})
    events=[json.loads(s) for s in (p/'pi-events.jsonl').read_text(encoding='utf-8').splitlines()] if (p/'pi-events.jsonl').exists() else []
    messages=[r['message'] for r in events if r.get('type')=='message_end' and r.get('message',{}).get('role')=='assistant']
    out.append({'arm':arm,'stop':summary.get('stop','running'),'probe':probe.get('status'),
                'resources':usage,'mode':saved.get('currentMode'),'self_revision':saved.get('serial'),
                'last_request_time':requests[-1].get('time') if requests else None,
                'latest_response':{'stopReason':messages[-1].get('stopReason'),'content_types':[c['type'] for c in messages[-1].get('content',[])],
                    'calls':[{'name':c['name'],'path':c.get('arguments',{}).get('path'),'op':c.get('arguments',{}).get('op')} for c in messages[-1].get('content',[]) if c.get('type')=='toolCall']} if messages else None,
                'last_tools':[r['value'].get('tool') for r in ledger if r['type']=='tool_result'][-6:],
                'review_closures':[{'status':r['value']['status'],'subtype':r['value'].get('subtype'),'agent':r['value'].get('agent_decision')} for r in ledger if r['type']=='review_closed'],
                'render':state.get('lastFeedback'),'complete':state.get('complete'),
                'artifacts':[{'path':str(f.relative_to(p)),'bytes':f.stat().st_size} for f in (p/'workspace/artifacts').glob('*') if f.is_file()]})
print(json.dumps(out,ensure_ascii=False))
