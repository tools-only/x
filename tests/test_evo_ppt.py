"""Runner boundaries: never send an inference to compensate for invalid inputs."""
import json
from pathlib import Path

import pytest

from autoresearch_pi import evo_ppt


def test_exact_local_registration_without_provider_or_model_fallback(tmp_path):
    path=tmp_path/'models.json'
    path.write_text(json.dumps({'providers':{'old-handle':{'baseUrl':evo_ppt.BASE,'api':'openai-completions','models':[
        {'id':evo_ppt.MODEL,'contextWindow':1048576,'maxTokens':131072}]}}}),encoding='utf-8')
    settings=evo_ppt.local_settings(path)
    assert settings['provider']=='az' and settings['model']['id']=='glm-5.3-flash'
    assert settings['request_reserve']['tokens']==1179648
    assert settings['request_reserve']['usd']==pytest.approx(0.2228224)
    agent=settings['agent_settings']
    assert 0 < agent['httpIdleTimeoutMs'] < 300_000
    assert agent['retry']['enabled'] and agent['retry']['maxRetries']==6
    assert agent['retry']['baseDelayMs']>=5000 and agent['retry']['maxAgentDelayMs']>=60_000
    assert agent['retry']['provider']['maxRetries']==0
    path.write_text(json.dumps({'providers':{}}),encoding='utf-8')
    with pytest.raises(ValueError,match='no substitution'):evo_ppt.local_settings(path)


def test_real_content_units_exclude_bare_page_numbers_from_numeric_probes():
    source=evo_ppt.PROJECT/'demo/ppt-cases/bank-of-america-3q21/assets/material.txt'
    units=evo_ppt.content_units(source.read_text(encoding='utf-8'))
    assert len(units)==10 and len({u['source_page'] for u in units})==10
    assert units[0]['required']==['$7.7','$0.85','$3.0']
    assert all('$' in number or '%' in number for u in units for number in u['required'])


@pytest.mark.parametrize('caps',[{}, {'requests':True}, {'requests':float('inf')}])
def test_missing_or_invalid_numeric_authorization_refused_before_prepare(tmp_path,monkeypatch,caps):
    monkeypatch.setattr(evo_ppt,'PROJECT',tmp_path)
    with pytest.raises(ValueError,match='numeric cap'):
        evo_ppt.freeze(tmp_path/'run',Path('unused'),Path('unused'),caps,'test')
    assert not (tmp_path/'run').exists()


def test_round_cannot_expand_the_authorized_aggregate(tmp_path):
    caps={'requests':1,'tokens':1,'seconds':1,'usd':1,'storage_bytes':1}
    with pytest.raises(ValueError,match='total requests'):
        evo_ppt.run_round(tmp_path/'round',Path('unused'),Path('unused'),{'total_caps':caps,'calibration_caps':caps,'b_caps':caps},'test')
    assert not (tmp_path/'round').exists()


def test_changed_contract_stops_before_provider_access(tmp_path,monkeypatch):
    manifest={'provider':'az','model':evo_ppt.MODEL,'seed_hashes':{},'sources':{},'contract':{'content_hash':'invalid'}}
    (tmp_path/'manifest.json').write_text(json.dumps(manifest),encoding='utf-8')
    monkeypatch.setattr(evo_ppt,'model_preflight',lambda *_a,**_kw:pytest.fail('unexpected provider call'))
    with pytest.raises(ValueError,match='contract changed'):
        evo_ppt.run(tmp_path)


def test_unsettled_request_retains_its_own_liability(tmp_path):
    (tmp_path/'harness').mkdir()
    (tmp_path/'harness/provider-requests.jsonl').write_text(json.dumps({'request':1,'permit':{'tokens':1234,'usd':.5}})+'\n',encoding='utf-8')
    usage=evo_ppt.resource_usage(tmp_path,{'tokens':240536,'usd':8.74})
    assert usage['tokens']==1234 and usage['usd']==.5
    assert usage['requests_with_missing_usage']==1


def test_shared_round_uses_actual_remaining_without_starving_independent_arms(tmp_path,monkeypatch):
    total={'requests':600,'tokens':600000,'seconds':14400,'usd':15,'storage_bytes':2147483648}
    a={**total,'requests':60,'seconds':1800}
    allocated=[]
    monkeypatch.setattr(evo_ppt,'freeze',lambda _r,_s,_m,c,_auth,arm:allocated.append((arm,c)))
    monkeypatch.setattr(evo_ppt,'run',lambda _r,**_kw:{'stop':'runtime_or_provider_error','resources':{'requests':1,'tokens':100,'usd':.25,'seconds':1}})
    results=evo_ppt.run_round(tmp_path/'round',Path('unused'),Path('unused'),{'total_caps':total,'calibration_caps':a,'b_caps':total,'shared_remaining':True},'test')
    assert len(results)==3
    assert [arm for arm,_ in allocated]==['A','B','B']
    assert allocated[1][1]['usd']==14.75 and allocated[2][1]['usd']==14.5
    assert allocated[2][1]['tokens']==599800


def test_verification_b_first_ceilings_and_a_actual_remainder(tmp_path,monkeypatch):
    total={'requests':600,'tokens':600000,'seconds':14400,'usd':15,'storage_bytes':2147483648}
    b={'requests':270,'tokens':270000,'seconds':6480,'usd':6.75,'storage_bytes':966367641}
    phases=[{'name':name,'arm':arm,'caps':caps} for name,arm,caps in
            [('sample-B1','B',b),('sample-B2','B',b),('calibration-A','A',total)]]
    plan={'total_caps':total,'shared_remaining':True,'phases':phases}
    allocated=[]
    clock=[1000.0]
    monkeypatch.setattr(evo_ppt.time,'time',lambda:clock[0])
    monkeypatch.setattr(evo_ppt.time,'monotonic',lambda:clock[0])
    storage_before_a=[]
    def freeze(root,_s,_m,c,_auth,arm):
        if arm=='A':
            storage_before_a.append(sum(p.stat().st_size for p in root.parent.rglob('*') if p.is_file()))
        root.mkdir()
        (root/'renderer.txt').write_bytes(b'x'*10)
        allocated.append((root.name,arm,c.copy()))
        clock[0]+=3
    deadlines=[]
    def run(_root,**kwargs):
        deadlines.append(kwargs['round_deadline'])
        clock[0]+=100
        return {'stop':'budget_or_integrity_stop','resources':{'requests':10,'tokens':100000,'usd':3}}
    monkeypatch.setattr(evo_ppt,'freeze',freeze)
    monkeypatch.setattr(evo_ppt,'run',run)
    results=evo_ppt.run_round(tmp_path/'round',Path('unused'),Path('unused'),plan,'test')
    assert [r['phase'] for r in results]==['sample-B1','sample-B2','calibration-A']
    assert allocated[0][2]==b and allocated[1][2]==b
    assert allocated[2][2]=={**total,'requests':580,'tokens':400000,'usd':9,'seconds':14194,
                            'storage_bytes':total['storage_bytes']-storage_before_a[0]}
    assert deadlines==[7480,7583,15400]  # Renderer time consumes the arm and total clocks.
    for key in total:
        invalid=[{**p,'caps':dict(p['caps'])} for p in phases]
        invalid[0]['caps'][key]=total[key]
        with pytest.raises(ValueError,match='45%'):
            evo_ppt.run_round(tmp_path/f'invalid-{key}',Path('unused'),Path('unused'),{**plan,'phases':invalid},'test')
        assert not (tmp_path/f'invalid-{key}').exists()


@pytest.mark.parametrize('terminal_review',[False,True])
def test_length_or_terminal_review_resumes_same_history_without_reopening_window(tmp_path,monkeypatch,terminal_review):
    contract={'budget':{'requests':10,'tokens':100000,'seconds':100,'usd':10,'storage_bytes':1000000}}
    contract['content_hash']=evo_ppt.digest(contract)
    settings={'api':'openai-completions','compat':{},'model':{'id':evo_ppt.MODEL},'thinking':'low',
              'agent_settings':{},'request_reserve':{'usd':1,'tokens':1000}}
    evo_ppt.write(tmp_path/'manifest.json',{'provider':'az','model':evo_ppt.MODEL,'arm':'B','contract':contract,
        'settings':settings,'seed_hashes':{},'sources':{},'units':[], 'engineering_commit':'test','renderer_preflight':{'status':'passed'}})
    (tmp_path/'.harness').mkdir()
    evo_ppt.write(tmp_path/'.harness/live-self.json',{'root':{'queue':[],'ledger':[]}})
    monkeypatch.setattr(evo_ppt,'load_project_dotenv',lambda _p:{'OPENAI_API_KEY':'test'})
    monkeypatch.setattr(evo_ppt,'model_preflight',lambda *_a,**_kw:{'status':'available','returned_model':evo_ppt.MODEL,
        'elapsed_seconds':0,'accounting':{'tokens':1,'usd':.001}})
    prompts=[]
    class Kernel:
        def __init__(self,*_a,**_kw): pass
        def __enter__(self): return self
        def __exit__(self,*_a): pass
        def prompt(self,message): prompts.append(message); return {'success':True}
        def wait_for_agent_events(self,**_kw):
            if terminal_review:
                evo_ppt.write(tmp_path/'.harness/ppt-loop.json',{'complete':True})
                evo_ppt.write(tmp_path/'.harness/live-self.json',{'root':{'queue':['terminal-window'] if len(prompts)==1 else [],'ledger':[]}})
            elif len(prompts)>=3:
                evo_ppt.write(tmp_path/'.harness/ppt-loop.json',{'complete':True})
            return [{'type':'message_end','message':{'role':'assistant','stopReason':'length' if len(prompts)==1 and not terminal_review else 'stop'}}]
    monkeypatch.setattr(evo_ppt,'PiKernel',Kernel)
    result=evo_ppt.run(tmp_path)
    assert result['stop']=='delivered'
    assert len(prompts)==(2 if terminal_review else 3)
    if not terminal_review:
        assert json.loads(prompts[1])['event']=='provider_response_incomplete'
        # A plain text end never ends the run: it is nudged back to execute mode.
        assert 'execute mode' in prompts[2] and result['empty_turns']==1
    else:
        assert 'queued boundary' in prompts[1]


def test_round_deadline_stops_before_any_charged_preflight(tmp_path,monkeypatch):
    contract={'budget':{'requests':10,'tokens':100000,'seconds':100,'usd':10,'storage_bytes':1000000}}
    contract['content_hash']=evo_ppt.digest(contract)
    evo_ppt.write(tmp_path/'manifest.json',{'provider':'az','model':evo_ppt.MODEL,'arm':'B','contract':contract,
        'settings':{},'seed_hashes':{},'sources':{},'units':[], 'renderer_preflight':{'status':'passed'}})
    monkeypatch.setattr(evo_ppt,'load_project_dotenv',lambda _p:{})
    monkeypatch.setattr(evo_ppt,'model_preflight',lambda *_a,**_kw:pytest.fail('preflight outside authorized wall clock'))
    result=evo_ppt.run(tmp_path,round_deadline=0)
    assert result['stop']=='round_wall_clock_before_preflight'
    assert result['resources']=={'requests':0,'tokens':0,'usd':0}


@pytest.mark.parametrize('token_cap',[None,600000])
def test_explicit_no_token_cap_uses_nonbinding_runtime_value_and_keeps_metering(tmp_path,monkeypatch,token_cap):
    monkeypatch.setattr(evo_ppt,'PROJECT',tmp_path)
    monkeypatch.setattr(evo_ppt,'local_settings',lambda _p:{'request_reserve':{'tokens':240536}})
    def prepare(root,_source):
        (root/'workspace/data').mkdir(parents=True)
        for name in ('AGENTS.md','data/material.txt','data/instructions.md'):
            (root/'workspace'/name).write_text('fixture',encoding='utf-8')
    monkeypatch.setattr(evo_ppt,'prepare',prepare)
    monkeypatch.setattr(evo_ppt,'content_units',lambda _s:[])
    monkeypatch.setattr(evo_ppt,'file_hash',lambda _p:'fixture-hash')
    monkeypatch.setattr(evo_ppt.subprocess,'check_output',lambda *_a,**_kw:'fixture-commit')
    monkeypatch.setattr(evo_ppt,'renderer_preflight',lambda _r:{'status':'passed'})
    caps={'requests':600,'tokens':token_cap,'seconds':14400,'usd':30,'storage_bytes':2147483648}
    manifest=evo_ppt.freeze(tmp_path/'run',Path('source'),Path('registration'),caps,'explicit fixture authorization')
    assert caps['tokens'] is token_cap  # Caller authorization is not mutated.
    if token_cap is None:
        runtime_cap=manifest['contract']['budget']['tokens']
        assert runtime_cap==2**53-1
        assert manifest['token_budget']['authorized_cap'] is None
        # Even 600 maximum-context/output permits cannot make tokens bind.
        assert 600*240536 < runtime_cap
        (tmp_path/'run/harness').mkdir()
        (tmp_path/'run/harness/model-usage.jsonl').write_text(json.dumps({'request':1,'tokens_used':800001,'conservative_usd':1})+'\n',encoding='utf-8')
        (tmp_path/'run/harness/provider-requests.jsonl').write_text(json.dumps({'request':1})+'\n',encoding='utf-8')
        assert evo_ppt.resource_usage(tmp_path/'run',{})['tokens']==800001
    else:
        assert manifest['contract']['budget']['tokens']==token_cap
        assert 'token_budget' not in manifest


def test_verify2_only_b1_full_independent_budget_environment_failure_no_retry(tmp_path,monkeypatch):
    import runpy
    launch=runpy.run_path(str(evo_ppt.PROJECT/'docs/reports/evo-v3-verify2/run_b1.py'))
    previous=json.loads((evo_ppt.PROJECT/'docs/reports/evo-v3-verify/sample-B1/manifest.json').read_text(encoding='utf-8'))
    clock=[1000.0]
    calls=[]
    monkeypatch.setattr(evo_ppt.time,'time',lambda:clock[0])
    def freeze(root,_source,_registration,caps,_authority,arm):
        calls.append(('freeze',root.name,arm,caps.copy()))
        root.mkdir()
        clock[0]+=3  # Local renderer consumes this B1's clock.
        return previous
    def run(root,*,round_deadline):
        calls.append(('run',root.name,round_deadline,clock[0]))
        return {'stop':'az_inference_unavailable','resources':{'requests':1,'tokens':4290,'usd':.08676}}
    monkeypatch.setattr(evo_ppt,'freeze',freeze)
    monkeypatch.setattr(evo_ppt,'run',run)
    root=tmp_path/'one'
    result=launch['run_b1'](root,Path('source'),Path('registration'))
    assert result['stop']=='az_inference_unavailable'
    assert calls==[('freeze','sample-B1','B',{'requests':600,'tokens':None,'seconds':14400,'usd':30,'storage_bytes':2147483648}),
                   ('run','sample-B1',15400,1003)]
    with pytest.raises(ValueError,match='no retry'):
        launch['run_b1'](root,Path('source'),Path('registration'))
    assert len(calls)==2
    accounting=json.loads((root/'final-accounting.json').read_text(encoding='utf-8'))
    assert accounting['caps']['tokens'] is None and accounting['resources']['tokens']==4290
    assert accounting['phases']==['sample-B1'] and accounting['resources']['seconds']==3
