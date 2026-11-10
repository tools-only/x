"""Inspect retained drafts with the same real renderer/checker, no provider."""
import json
import shutil
import subprocess
import time
from pathlib import Path
from autoresearch_pi import evo_ppt as e

root=e.PROJECT/'runs/evo-v3-real-20261111'
accounting=json.loads((root/'final-accounting.json').read_text(encoding='utf-8'))
deadline=accounting['started_epoch']+accounting['caps']['seconds']
results=[]
for arm in ['calibration-A','sample-B1','sample-B2']:
    current=root/arm
    draft=current/'workspace/artifacts/presentation.html'
    if not draft.exists() or (current/'delivery/presentation.html').exists(): continue
    if time.time() >= deadline or sum(p.stat().st_size for p in root.rglob('*') if p.is_file()) >= accounting['caps']['storage_bytes']:
        results.append({'arm':arm,'status':'not_measured_cap'}); break
    posthoc=root/'posthoc'/arm
    shutil.copytree(current/'workspace',posthoc/'workspace')
    source=posthoc/'workspace/artifacts/presentation.html'
    began=time.time()
    # The exact existing renderer runs in a separate bounded process.
    helper=e.PROJECT/'src/autoresearch_pi/ppt_demo_html.py'
    rendered=subprocess.run([e.os.sys.executable,str(helper),str(posthoc),str(source),'1'],capture_output=True,text=True,
                            encoding='utf-8',timeout=min(300,deadline-time.time()))
    if rendered.returncode:
        results.append({'arm':arm,'status':'render_failed','stderr':rendered.stderr,'seconds':time.time()-began}); continue
    checked=subprocess.run([shutil.which('node'),'--experimental-transform-types',str(Path(__file__).with_name('posthoc_check.ts')),
                            str(posthoc),str(current/'manifest.json')],capture_output=True,text=True,encoding='utf-8',timeout=min(30,deadline-time.time()))
    facts=json.loads((posthoc/'acceptance.json').read_text(encoding='utf-8')) if checked.returncode==0 else None
    results.append({'arm':arm,'status':'measured' if facts else 'checker_failed','acceptance':facts,
                    'stderr':checked.stderr if checked.returncode else None,'seconds':time.time()-began})
e.write(root/'posthoc-results.json',results)
accounting['experiment_end_epoch']=accounting['ended_epoch']
accounting['ended_epoch']=time.time()
accounting['resources'].update(seconds=time.time()-accounting['started_epoch'],storage_bytes=sum(p.stat().st_size for p in root.rglob('*') if p.is_file()))
accounting['posthoc']='real local renderer/checker; no provider; never in-run feedback or delivery'
e.write(root/'final-accounting.json',accounting)
print(json.dumps([{'arm':r['arm'],'status':r['status'],'slides':r.get('acceptance',{}).get('slide_count')} for r in results],ensure_ascii=False))
