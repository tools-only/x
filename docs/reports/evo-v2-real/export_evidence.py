import hashlib,json,shutil
from pathlib import Path
r=Path('runs/evo-v2-real-20261111')
out=Path('docs/reports/evo-v2-real')
out.mkdir(exist_ok=True)
previous=json.loads((out/('three-arm-results.json' if (out/'three-arm-results.json').exists() else 'results.json')).read_text(encoding='utf-8'))
prior={a['phase']:a for a in previous['arms']}
if not (out/'three-arm-results.json').exists(): shutil.copy2(out/'results.json',out/'three-arm-results.json')
evidence={'run_root':str(r),'engineering_versions':{'three_arms':'1935b112b515e03990fa7b50ece0f4b00f3ff694','interface_diagnostic':'a91b0a68a5bb774558b2e2295e9f5900b7af0e9b'},'arms':[],
 'tests':{'node':{'passed':20,'command':'node --experimental-transform-types --test --test-concurrency=1 tests/provider_permit.test.ts tests/self_root.test.ts'},
 'python':{'passed':16,'runs':'runner 10 passed; final Pi integration 6 passed in 31.69s','command':'PYTHONPATH=src python -m pytest tests/test_evo_ppt.py tests/test_evo_ppt_pi.py -q','environment':'actual Pi 0.87.0 and Edge, scripted provider; not real-provider adoption'}}}
for name in ['round-plan.json','resume-accounting.json','round-results.json','final-accounting.json','round-stop.json','three-arm-accounting.json','diagnostic-plan.json','diagnostic-result.json']:
 if (r/name).exists():shutil.copy2(r/name,out/name)
for arm in ['calibration-A','sample-B1','sample-B2','diagnostic-exit-schema']:
 a=r/arm
 if not a.exists():continue
 target=out/arm;target.mkdir(exist_ok=True)
 item={'phase':arm,'files':{},'usage':[],'requests':[],'decisions':[],'tool_calls':[],'protected_outcomes':[],'source_integrity':{}}
 for name in ['manifest.json','runtime-manifest.json','summary.json','inference-preflight.json','renderer-preflight.json','budget-stop.json']:
  if (a/name).exists():shutil.copy2(a/name,target/name)
 for p in a.rglob('*'):
  if not p.is_file() or '.pi-agent' in p.parts:continue
  item['files'][str(p.relative_to(a))]={'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size}
 p=a/'harness/provider-requests.jsonl'
 if p.exists():
  item['requests']=[{k:v for k,v in json.loads(x).items() if k!='payload'} for x in p.read_text(encoding='utf-8').splitlines()]
 p=a/'harness/model-usage.jsonl'
 if p.exists():item['usage']=list(map(json.loads,p.read_text(encoding='utf-8').splitlines()))
 p=a/'.harness/live-self.json'
 if p.exists():
  state=json.loads(p.read_text(encoding='utf-8'));q=state.get('root',{})
  item['runtime']={k:q.get(k) for k in ['root_id','serial','currentMode','request','windows','queue','tokens','usd']}
  item['decisions']=[x for x in q.get('ledger',[]) if x['type'] in ['mode_entered','review_closed','review_pending','review_activation_closed','reflection_pending','reflection_activated','validation_delivered','validation_interpreted','validation_enacted','coverage_gap','active_reset_completed','active_reset_failed','transaction_failed']]
  item['protected_outcomes']=[x for x in q.get('ledger',[]) if x['type']=='task_outcome']
 p=a/'pi-events.jsonl'
 if p.exists():
  for x in map(json.loads,p.read_text(encoding='utf-8').splitlines()):
   if x.get('type')!='message_end':continue
   m=x.get('message',{})
   if m.get('role')=='assistant':
    item['tool_calls'] += [{'id':c.get('id'),'name':c.get('name'),'arguments':c.get('arguments')} for c in m.get('content',[]) if c.get('type')=='toolCall']
   elif m.get('role')=='toolResult' and m.get('isError'):
    item.setdefault('tool_errors',[]).append({k:m.get(k) for k in ['toolCallId','toolName','content']})
 p=a/'manifest.json'
 if p.exists():
  manifest=json.loads(p.read_text(encoding='utf-8'))
  for f,h in manifest['seed_hashes'].items():item['source_integrity'][f]=hashlib.sha256(Path(f).read_bytes()).hexdigest()==h
 for name in ['artifacts/presentation.html','artifacts/deck.json']:
  p=a/'workspace'/name
  if p.exists():shutil.copy2(p,target/p.name)
 if (a/'exports').exists():
  renders=sorted((a/'exports').glob('v*/contact-sheet.png'))
  if renders:shutil.copy2(renders[-1],target/'contact-sheet.png')
 item['current_checkout_matches_frozen_source']=item.pop('source_integrity')
 if arm in prior:
  item['source_integrity_at_arm_end']=prior[arm]['source_integrity']
  item['integrity_note']='captured true at original three-arm end, before the interface fix; subsequent engineering differences are separate'
 else:
  item['source_integrity_at_arm_end']=item['current_checkout_matches_frozen_source']
 evidence['arms'].append(item)
(out/'results.json').write_text(json.dumps(evidence,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'arms':[x['phase'] for x in evidence['arms']],'artifact':str(out/'results.json')},ensure_ascii=False))
