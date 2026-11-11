"""Runner boundaries: never send an inference to compensate for invalid inputs."""
import json
from pathlib import Path

import pytest

from autoresearch_pi import evo_ppt


def test_exact_local_registration_without_provider_or_model_fallback(tmp_path):
    path=tmp_path/'models.json'
    path.write_text(json.dumps({'providers':{'old-handle':{'baseUrl':evo_ppt.BASE,'api':'openai-completions','models':[
        {'id':evo_ppt.MODEL,'contextWindow':175000,'maxTokens':65536}]}}}),encoding='utf-8')
    settings=evo_ppt.local_settings(path)
    assert settings['provider']=='az' and settings['model']['id']=='qwen3.8-27b'
    assert settings['request_reserve']['tokens']==240536
    assert settings['request_reserve']['usd']==pytest.approx(8.74288)
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
            return [{'type':'message_end','message':{'role':'assistant','stopReason':'length' if len(prompts)==1 and not terminal_review else 'stop'}}]
    monkeypatch.setattr(evo_ppt,'PiKernel',Kernel)
    result=evo_ppt.run(tmp_path)
    assert result['stop']==('delivered' if terminal_review else 'plain_text_end')
    assert len(prompts)==2
    if not terminal_review:
        assert json.loads(prompts[1])['event']=='provider_response_incomplete'
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
