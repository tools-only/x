import json,time,shutil
from pathlib import Path
from autoresearch_pi import evo_ppt as e
root=e.PROJECT/'runs/evo-v2-real-20261111'
original=json.loads((root/'final-accounting.json').read_text(encoding='utf-8'))
shutil.copy2(root/'final-accounting.json',root/'three-arm-accounting.json')
resume=json.loads((root/'resume-accounting.json').read_text(encoding='utf-8'))
plan=json.loads((root/'round-plan.json').read_text(encoding='utf-8'))
spent=original['resources'];remaining={k:plan['total_caps'][k]-spent[k] for k in ['requests','tokens','usd']}
remaining.update(seconds=resume['deadline_epoch']-time.time(),storage_bytes=plan['total_caps']['storage_bytes']-sum(p.stat().st_size for p in root.rglob('*') if p.is_file()))
e.write(root/'diagnostic-plan.json',{'classification':'independent interface diagnostic; not a replacement for A/B1/B2',
 'claim':'operation-specific exit schema can reach a valid same-Agent closure; no task-success or improvement claim',
 'caps':remaining,'prior_accounting':original,'original_deadline_epoch':resume['deadline_epoch'],
 'authority':plan['authority'],'no_retry':True,'task':'same ordinary brief, ten units, source and model; no extra tool-selection prompt'})
print(json.dumps({'diagnostic_caps':remaining}),flush=True)
a=json.loads((root/'calibration-A/manifest.json').read_text(encoding='utf-8'))
path=root/'diagnostic-exit-schema'
e.freeze(path,e.PROJECT/'demo/ppt-cases/bank-of-america-3q21/assets',Path(a['settings']['registration']),remaining,plan['authority'],'B')
result=e.run(path,round_deadline=resume['deadline_epoch'])
e.write(root/'diagnostic-result.json',result)
resources={k:spent[k]+result.get('resources',{}).get(k,0) for k in ['requests','tokens','usd']}
resources.update(seconds=time.time()-resume['original_start_epoch'],storage_bytes=sum(p.stat().st_size for p in root.rglob('*') if p.is_file()))
e.write(root/'final-accounting.json',{'resources':resources,'caps':plan['total_caps'],'billing':'conservative known plus unresolved permits; actual invoice unknown',
 'phases':original['phases']+['diagnostic-exit-schema'],'three_arm_accounting_ref':'three-arm-accounting.json','diagnostic_result_ref':'diagnostic-result.json'})
print(json.dumps({'diagnostic_stop':result['stop'],'resources':resources}),flush=True)
