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
