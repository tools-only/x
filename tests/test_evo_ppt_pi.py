"""Actual pinned Pi and PPT extension; provider decisions are scripted, not autonomy."""
import hashlib
import json
import shutil
from pathlib import Path

import pytest

from autoresearch_pi.pi_kernel import PiKernel
from autoresearch_pi.evo_ppt import content_units

PROJECT = Path(__file__).resolve().parents[1]


def test_tagged_task_family_inventory_is_grounded_and_not_a_fixed_pair():
    cases = sorted((PROJECT / 'demo/ppt-cases').glob('*/assets/material.txt'))
    assert {p.parent.parent.name for p in cases} == {'bank-of-america-3q21', 'jpmorgan-chase-3q21'}
    tags = {p.parent.parent.name: ['earnings_presentation', 'validation_window_exercise'] for p in cases}
    assert all('validation_window_exercise' in value for value in tags.values())
    units = {p.parent.parent.name: content_units(p.read_text(encoding='utf-8')) for p in cases}
    assert all(len(value) == 10 for value in units.values())
    assert {u['citation'] for u in units['bank-of-america-3q21']}.isdisjoint(
        u['citation'] for u in units['jpmorgan-chase-3q21'])


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


def fixture_manifest():
    body = {
        "source": "user_contract", "authority": "Round v1 no-provider integration fixture", "decisions": "FINAL G1", "readonly_reason": "protected user boundary",
        "boundaries": ["before_active_reset", "unit_completed", "before_session_end"],
        "capabilities": ["read", "ls", "grep", "write", "edit", "python", "office.render", "office.look", "office.deliver", "acceptance", "submit_unit", "agent_tools"],
        "writable": ["components.tool", "components.prompt", "components.memory", "components.skill", "policy", "orchestration"],
        "budget": {"requests": 50, "tokens": 100000, "seconds": 600, "usd": 1, "storage_bytes": 200000000},
        "acceptance": {"checker": "literal-fixture", "expected_slides":1}, "inherit_defaults": False, "heartbeat": {"enabled": True, "every_settled_task_requests": 3},
    }
    return {"experiment_id": "scripted-stage0", "provider": "offline-external-test", "model": "scripted", "contract": {**body, "content_hash": digest(body)},
            "sources": {}, "units": [{"id": "one", "title": "fixture", "required": ["1"], "citation": "source"}],
            "checker": {"version": "v1", "sha256": hashlib.sha256((PROJECT / "demo/self_root_ppt.ts").read_bytes()).hexdigest()}, "settings": {}, "engineering_commit": "test"}


def test_same_root_pi_schema_mode_memory_tool_activation_and_failure(tmp_path):
    manifest = fixture_manifest()
    path = tmp_path / "manifest.json"
    path.write_text(json.dumps(manifest), encoding="utf-8")
    caps = manifest["contract"]["capabilities"]
    exit_schema = {"type": "object", "properties": {"reason": {"type": "string"}}, "required": ["reason"]}
    policy = {"modes": {name: {"tools": tools, "instruction": name, "exitSchema": exit_schema} for name, tools in [
        ("execute", caps), ("reflect", ["read", "ls", "grep", "office.look", "acceptance"]), ("consolidate", ["read", "ls", "grep", "acceptance"])]},
        "routes": [], "methods": {}, "memory": {"names": ["m2"], "order": "name", "write": "replace"},
        "context": {"order": ["memory"], "instruction": "context-policy-v2", "reasoning":"latest"}}
    policy['methods']={'project':'{"marker":"METHOD-V2","facts":len(input["evidence_index"])}','watch':'False'}
    policy['modes']['execute']['projection']='project'
    policy['routes']=[{'id':'agent-watch','event':'tool_succeeded','predicate':'watch','mode':'reflect','priority':0,'conclusion_sink':'ledger'}]
    steps = [
        {"name": "read_self", "arguments": {"section": "policy"}},
        {"name": "python", "arguments": {"code": "print('ILLEGAL-REFLECT-ACTION')"}},
        {"name": "decide", "arguments": {"op": "exit", "status": "deferred", "subtype": "keep", "result": {"reason": "fixture keep"}}},
        {"name": "reflect_orchestration", "arguments": {"baseRevision": 1, "policy": policy, "components": [
            {"op": "define", "kind": "memory", "name": "m1", "source": "OMIT-MEMORY-ONE"},
            {"op": "define", "kind": "memory", "name": "m2", "source": "INCLUDE-MEMORY-TWO"},
            {"op": "define", "kind": "tool", "name": "evo_probe", "source": "# program: on\n# description: actual tool v1\ndef main(args):\n    return 'probe-v1'"}]}},
        {"name": "evo_probe", "arguments": {"args": {}}},
        {"name": "decide", "arguments": {"op": "enter_mode", "mode": "consolidate"}},
        {"name": "python", "arguments": {"code": "print('ILLEGAL-CONSOLIDATE-ACTION')"}},
        {"name": "decide", "arguments": {"op": "exit", "status": "deferred", "subtype": "keep", "result": {"reason": "fixture consolidate"}}},
        [{"name": "reflect_component", "arguments": {"baseRevision": 2, "op": "redefine", "kind": "memory", "name": "m2", "source": "MUST-NOT-ACTIVATE"}},
         {"name": "reflect_component", "arguments": {"baseRevision": 2, "op": "redefine", "kind": "invalid", "name": "m2", "source": "schema rejection must abort the chain"}}],
        {"name": "read_self_component", "arguments": {"kind": "memory", "name": "m2"}},
        {"name": "python", "arguments": {"code": "open('tools/sneak.py','w').write('# program: on\\ndef main(args): return 1')"}},
    ]
    command = [shutil.which("node"), str(PROJECT / "node_modules/@earendil-works/pi-coding-agent/dist/cli.js"), "--mode", "rpc",
               "--no-context-files", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-builtin-tools",
               "--extension", str(PROJECT / "demo/ppt_demo_extension.ts"), "--extension", str(PROJECT / "tests/pi_external_benchmark_provider.ts"),
               "--provider", "offline-external-test", "--model", "scripted", "--session", str(tmp_path / "session.jsonl")]
    env = {"PI_CODING_AGENT_DIR": str(tmp_path / ".pi-agent"), "PI_AUTORESEARCH_E2E_ROOT": str(tmp_path), "PPT_DEMO_ROOT": str(tmp_path),
           "EVO_MANIFEST": str(path), "PPT_DEMO_DEADLINE": "4102444800000", "PPT_DEMO_BUDGET_USD": "1", "PPT_DEMO_REQUEST_RESERVE_USD": "0.001",
           "PPT_DEMO_INPUT_USD_PER_MILLION": "0", "PPT_DEMO_OUTPUT_USD_PER_MILLION": "0", "PPT_DEMO_CACHE_READ_USD_PER_MILLION": "0", "PPT_DEMO_CACHE_WRITE_USD_PER_MILLION": "0",
           "PI_EXTERNAL_STEPS": json.dumps(steps), "PI_EXTERNAL_USAGE_TOKENS": "1", "PI_EXTERNAL_THINKING_CHARS":"1200"}
    def record(event):
        with (tmp_path / 'events.jsonl').open('a',encoding='utf-8') as f:
            f.write(json.dumps(event,ensure_ascii=False)+'\n')
    with PiKernel(command, cwd=str(tmp_path), env=env, timeout=90,event_sink=record) as kernel:
        response = kernel.prompt("Run the explicitly scripted stage-0 mechanism fixture.")
        assert response.get('success') is not False, response
        kernel.wait_for_agent_events(timeout=180)
    contexts = [json.loads(line)["context"] for line in (tmp_path / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()]
    toolnames = lambda c: {t["name"] for t in c["messages"][0]["toolsAdded"]}
    system = lambda c: c["messages"][0]["content"]
    # The staircase starts in task work. The first evolution review is queued
    # only after a settlement, so task tools are visible at the first request.
    assert "python" in toolnames(contexts[0])
    decision_schema=next(t for t in contexts[0]['messages'][0]['toolsAdded'] if t['name']=='decide')['parameters']
    assert 'allOf' not in decision_schema
    assert 'op' in decision_schema['required']
    assert 'result' in decision_schema['properties']
    assert next(t for t in contexts[3]['messages'][0]['toolsAdded'] if t['name']=='decide')['parameters']['type'] == 'object'
    for context in contexts[2:]:
        assistants=[m for m in context['messages'] if m['role']=='assistant']
        assert not any(p['type']=='thinking' for m in assistants[:-1] for p in m['content'])
        assert any(p['type']=='thinking' for p in assistants[-1]['content'])
    assert "python" in toolnames(contexts[3])
    assert "evo_probe" in toolnames(contexts[4])
    assert "probe-v1" in json.dumps(contexts[5])
    assert "INCLUDE-MEMORY-TWO" in system(contexts[4])
    assert "OMIT-MEMORY-ONE" not in system(contexts[4]).split('SELF ROOT:')[0]
    assert "context-policy-v2" in system(contexts[4])
    assert 'METHOD-V2' in system(contexts[4])
    assert "python" not in toolnames(contexts[6])
    assert "INCLUDE-MEMORY-TWO" in system(contexts[10])
    assert not (tmp_path/'workspace/tools/sneak.py').exists()
    assert 'Generic component-storage writes are refused' in json.dumps(contexts[-1])
    saved = json.loads((tmp_path / ".harness/live-self.json").read_text(encoding="utf-8"))
    assert saved["root"]["serial"] == 2
    assert saved["root"]["currentMode"] == "execute"
    assert any(r["type"] == "transaction_failed" for r in saved["root"]["ledger"])
    assert any(r['kind']=='fact' and r['type']=='capsule' and r['value']['dependencies']['metadata'].get('route')=='agent-watch' for r in saved['root']['ledger'])
    costs = [r for r in saved["root"]["ledger"] if r["type"] == "request_cost"]
    assert len({r["request"] for r in costs}) == len(costs)
    assert any(r['type']=='assistant_reasoning' and r['value']['blocks'] for r in saved['root']['ledger'])


def test_real_renderer_acceptance_and_merged_delivery_review(tmp_path):
    manifest = fixture_manifest()
    path = tmp_path / 'manifest.json'
    path.write_text(json.dumps(manifest),encoding='utf-8')
    keep = {"name":"decide","arguments":{"op":"exit","status":"deferred","subtype":"keep","result":{"reason":"stage0 fixture preserves method"}}}
    steps = [keep,
             {"name":"write","arguments":{"path":"artifacts/presentation.html","content":"<!doctype html><html><body><section class='slide'><h1>1 source</h1></section></body></html>"}},
             {"name":"office","arguments":{"op":"render"}},
             {"name":"acceptance","arguments":{"unit":"one"}},
             {"name":"submit_unit","arguments":{"unit":"one"}},keep,
             {"name":"submit_unit","arguments":{"unit":"one"}},
             {"name":"office","arguments":{"op":"deliver"}},
             {"name":"reflect_component","arguments":{"baseRevision":1,"op":"define","kind":"memory","name":"delivery_note","source":"fixture final review change"}},
             {"name":"decide","arguments":{"op":"exit","status":"changed","result":{"reason":"activated memory receipt"}}},
             {"name":"office","arguments":{"op":"deliver"}},
             {"name":"decide","arguments":{"op":"validation","window":"window:0","decision":"defer","result":{"reason":"no post-change task result; do not claim validated adoption"}}},keep,
             {"name":"office","arguments":{"op":"deliver"}}]
    command = [shutil.which('node'),str(PROJECT/'node_modules/@earendil-works/pi-coding-agent/dist/cli.js'),'--mode','rpc',
               '--no-context-files','--no-extensions','--no-skills','--no-prompt-templates','--no-builtin-tools',
               '--extension',str(PROJECT/'demo/ppt_demo_extension.ts'),'--extension',str(PROJECT/'tests/pi_external_benchmark_provider.ts'),
               '--provider','offline-external-test','--model','scripted','--session',str(tmp_path/'session.jsonl')]
    env = {'PI_CODING_AGENT_DIR':str(tmp_path/'.pi-agent'),'PI_AUTORESEARCH_E2E_ROOT':str(tmp_path),'PPT_DEMO_ROOT':str(tmp_path),
           'PPT_DEMO_PYTHON':__import__('sys').executable,'EVO_MANIFEST':str(path),'PPT_DEMO_DEADLINE':'4102444800000',
           'PPT_DEMO_BUDGET_USD':'1','PPT_DEMO_REQUEST_RESERVE_USD':'0.001','PPT_DEMO_INPUT_USD_PER_MILLION':'0','PPT_DEMO_OUTPUT_USD_PER_MILLION':'0',
           'PI_EXTERNAL_STEPS':json.dumps(steps),'PI_EXTERNAL_USAGE_TOKENS':'1'}
    def record(event):
        if event.get('type') != 'message_update':
            with (tmp_path/'events.jsonl').open('a',encoding='utf-8') as f:f.write(json.dumps(event,ensure_ascii=False)+'\n')
    with PiKernel(command,cwd=str(tmp_path),env=env,timeout=90,event_sink=record) as kernel:
        assert kernel.prompt('Execute the explicitly scripted renderer wiring fixture.').get('success') is not False
        kernel.wait_for_agent_events(timeout=180)
    saved = json.loads((tmp_path/'.harness/live-self.json').read_text(encoding='utf-8'))
    ledger = saved['root']['ledger']
    assert (tmp_path/'delivery/presentation.html').exists()
    outcomes = [r['value'] for r in ledger if r['type']=='task_outcome']
    assert len(outcomes) >= 4
    assert all(r['source']=='protected_acceptance' and r['renderer']['exit']==0 for r in outcomes)
    assert all(r['slide_count']['matches'] and r['rendered_source_matches_current'] for r in outcomes)
    contexts=[json.loads(line)['context'] for line in (tmp_path/'provider-contexts.jsonl').read_text(encoding='utf-8').splitlines()]
    # Render feedback enters the immediate next decision, before explicit acceptance.
    assert 'protected_acceptance' in json.dumps(contexts[3])
    assert 'normalized' in json.dumps(contexts[3])
    assert any(r['value']['unit']=='one' for r in ledger if r['type']=='unit_delivered')
    tickets = [r['value'] for r in ledger if r['type']=='mode_entered']
    assert any({t['id'] for t in r['triggers']} >= {'contract:before_delivery','contract:before_session_end'} for r in tickets)
    events = [r for r in ledger if r['type']=='event' and r['value']['type']=='before_delivery']
    assert len(events) == 2  # unit and whole deck; repeat delivery does not add a review
    whole = next(r for r in events if r['value']['boundary'].startswith('delivery:'))
    facts = whole['value']['facts']
    assert facts['artifact']['revision'] == 1 and facts['artifact']['current']
    assert facts['artifact']['slides'] == 1 and facts['artifact']['warnings'] == []
    assert facts['checker']['version'] == 'v1' and facts['checker']['unit_count'] == 1
    assert facts['checker']['flags'] == {'true': 4, 'false': 0, 'unknown': 0}
    assert facts['render_action']['ref'].startswith('action-')
    assert facts['render_action']['transition'] in ('stalled', 'advanced', 'complete')
    assert facts['self_revision'] == 1 and facts['orchestration_revision'] == 1
    assert facts['candidate_validation_window'] is False
    assert all(any(row['ref'] == ref and row['kind'] == 'fact' for row in ledger) for ref in facts['evidenceRefs'])
    assert not any(key in json.dumps(facts) for key in ('quality_verdict', 'proposed_change', 'cause_tag'))
    assert any('review_evidence' in c['messages'][0]['content'] and facts['artifact']['sha256'] in c['messages'][0]['content']
               for c in contexts)
    assert any(r['type']=='validation_delivered' and 'task_outcomes' in r['value']['missing'] for r in ledger) or not any(r['type']=='validation_delivered' for r in ledger)
    assert not any(r['type']=='validation_interpreted' and r['value']['decision']=='adopt' for r in ledger)


def test_tool_contract_replacement_and_same_agent_reset(tmp_path):
    manifest = fixture_manifest()
    path = tmp_path / 'manifest.json'
    path.write_text(json.dumps(manifest),encoding='utf-8')
    keep = {'name':'decide','arguments':{'op':'exit','status':'deferred','subtype':'keep','result':{'reason':'preserve original evidence'}}}
    schema = {'type':'object','properties':{'args':{'type':'object','properties':{'value':{'type':'integer'}},'required':['value'],'additionalProperties':False}},'required':['args'],'additionalProperties':False}
    summary = 'ORIGINAL_COUNTEREVIDENCE: fixture was not a real model. Resume work; recover complete evidence via read_self ledger and continuity.'
    reset = {'name':'decide','arguments':{'op':'reset','result':{'summary':summary}}}
    steps = [keep,
             {'name':'reflect_component','arguments':{'baseRevision':1,'kind':'tool','name':'contract_probe','op':'define','source':'# program: on\n# description: first contract\ndef main(args):\n return "first"'}},
             {'name':'contract_probe','arguments':{'args':{}}},
             {'name':'reflect_component','arguments':{'baseRevision':2,'kind':'tool','name':'contract_probe','op':'redefine','source':'# program: on\n# description: second contract\n# parameters: '+json.dumps(schema)+'\ndef main(args):\n return "second"'}},
             {'name':'contract_probe','arguments':{'args':{'value':'invalid'}}},
             {'name':'contract_probe','arguments':{'args':{'value':7}}},
             reset,keep,reset]
    command = [shutil.which('node'),str(PROJECT/'node_modules/@earendil-works/pi-coding-agent/dist/cli.js'),'--mode','rpc',
               '--no-context-files','--no-extensions','--no-skills','--no-prompt-templates','--no-builtin-tools',
               '--extension',str(PROJECT/'demo/ppt_demo_extension.ts'),'--extension',str(PROJECT/'tests/pi_external_benchmark_provider.ts'),
               '--provider','offline-external-test','--model','scripted','--session',str(tmp_path/'session.jsonl')]
    env = {'PI_CODING_AGENT_DIR':str(tmp_path/'.pi-agent'),'PI_AUTORESEARCH_E2E_ROOT':str(tmp_path),'PPT_DEMO_ROOT':str(tmp_path),
           'EVO_MANIFEST':str(path),'PPT_DEMO_DEADLINE':'4102444800000','PPT_DEMO_BUDGET_USD':'1','PPT_DEMO_REQUEST_RESERVE_USD':'0.001',
           'PPT_DEMO_INPUT_USD_PER_MILLION':'0','PPT_DEMO_OUTPUT_USD_PER_MILLION':'0','PI_EXTERNAL_STEPS':json.dumps(steps),'PI_EXTERNAL_USAGE_TOKENS':'1'}
    (tmp_path/'.pi-agent').mkdir()
    (tmp_path/'.pi-agent/settings.json').write_text(json.dumps({'compaction':{'enabled':False,'keepRecentTokens':100,'reserveTokens':256}}),encoding='utf-8')
    def record(event):
        if event.get('type') != 'message_update':
            with (tmp_path/'events.jsonl').open('a',encoding='utf-8') as f:f.write(json.dumps(event,ensure_ascii=False)+'\n')
    with PiKernel(command,cwd=str(tmp_path),env=env,timeout=90,event_sink=record) as kernel:
        assert kernel.prompt('Execute the explicitly scripted contract and reset mechanism fixture.').get('success') is not False
        kernel.wait_for_agent_events(timeout=180)
        # compact() is an asynchronous Pi operation; wait for its native callback.
        import time
        deadline=time.monotonic()+5
        while time.monotonic()<deadline:
            kernel.send('get_state')
            saved=json.loads((tmp_path/'.harness/live-self.json').read_text(encoding='utf-8'))
            if any(r['type'] in ('active_reset_completed','active_reset_failed') for r in saved['root']['ledger']): break
            time.sleep(.05)
        (tmp_path/'kernel-state.json').write_text(json.dumps({'state':kernel.send('get_state'),'stderr':kernel.stderr_tail}),encoding='utf-8')
        if any(r['type']=='active_reset_completed' for r in saved['root']['ledger']):
            assert kernel.prompt('Continue this same serial root after its requested reset.').get('success') is not False
            kernel.wait_for_agent_events(timeout=180)
    contexts=[json.loads(line)['context'] for line in (tmp_path/'provider-contexts.jsonl').read_text(encoding='utf-8').splitlines()]
    tools=contexts[4]['messages'][0]['toolsAdded']
    assert next(t['parameters'] for t in tools if t['name']=='contract_probe')==schema
    assert 'second' in json.dumps(contexts[6])
    assert 'not found' not in json.dumps(contexts[6])
    ledger=saved['root']['ledger']
    assert saved['root']['serial']==3
    assert any(r['type']=='active_reset_completed' for r in ledger), ledger[-6:]
    assert any(r['type']=='mode_entered' and any(t['id']=='contract:before_active_reset' for t in r['value']['triggers']) for r in ledger)
    session=(tmp_path/'session.jsonl').read_text(encoding='utf-8')
    assert summary in session
    assert summary in json.dumps(contexts[-1])
    assert len(contexts)==10  # no additional summarizer provider request


def test_actual_legacy_arm_still_renders_and_delivers(tmp_path):
    path=tmp_path/'limits.json'
    path.write_text(json.dumps(fixture_manifest()),encoding='utf-8')
    steps=[{'name':'write','arguments':{'path':'artifacts/presentation.html','content':'<html><body><section class="slide">Legacy baseline fixture</section></body></html>'}},
           {'name':'office','arguments':{'op':'render'}},
           {'name':'office','arguments':{'op':'deliver','self_review':{'disposition':'keep','rationale':'scripted legacy wiring fixture'}}}]
    command=[shutil.which('node'),str(PROJECT/'node_modules/@earendil-works/pi-coding-agent/dist/cli.js'),'--mode','rpc','--no-context-files','--no-extensions','--no-skills',
             '--no-prompt-templates','--no-builtin-tools','--extension',str(PROJECT/'demo/ppt_demo_extension.ts'),'--extension',str(PROJECT/'tests/pi_external_benchmark_provider.ts'),
             '--provider','offline-external-test','--model','scripted','--session',str(tmp_path/'session.jsonl')]
    env={'PI_CODING_AGENT_DIR':str(tmp_path/'.pi-agent'),'PI_AUTORESEARCH_E2E_ROOT':str(tmp_path),'PPT_DEMO_ROOT':str(tmp_path),'PPT_DEMO_PYTHON':__import__('sys').executable,
         'PPT_EXPERIMENT_LIMITS':str(path),'PPT_DEMO_DEADLINE':'4102444800000','PPT_DEMO_BUDGET_USD':'1','PPT_DEMO_REQUEST_RESERVE_USD':'0.001',
         'PPT_DEMO_INPUT_USD_PER_MILLION':'0','PPT_DEMO_OUTPUT_USD_PER_MILLION':'0','PI_EXTERNAL_STEPS':json.dumps(steps),'PI_EXTERNAL_USAGE_TOKENS':'1'}
    with PiKernel(command,cwd=str(tmp_path),env=env,timeout=90) as kernel:
        assert kernel.prompt('Execute this explicit legacy-arm wiring fixture.').get('success') is not False
        kernel.wait_for_agent_events(timeout=180)
    assert (tmp_path/'delivery/presentation.html').exists()
    assert 'root' not in json.loads((tmp_path/'.harness/live-self.json').read_text(encoding='utf-8'))
    contexts=[json.loads(l)['context'] for l in (tmp_path/'provider-contexts.jsonl').read_text(encoding='utf-8').splitlines()]
    assert 'read_self' not in {t['name'] for t in contexts[0]['messages'][0]['toolsAdded']}


@pytest.mark.parametrize('requests,tokens,reason,dispatched',[(1,100000,'hard budget',1),(30,10000,'authorized budget boundary',0)])
def test_budget_stop_closes_active_review_without_an_agent_decision(tmp_path,requests,tokens,reason,dispatched):
    manifest=fixture_manifest()
    manifest['contract']['budget'].update(requests=requests,tokens=tokens)
    manifest['contract']['content_hash']=digest({k:v for k,v in manifest['contract'].items() if k!='content_hash'})
    path=tmp_path/'manifest.json'
    path.write_text(json.dumps(manifest),encoding='utf-8')
    command=[shutil.which('node'),str(PROJECT/'node_modules/@earendil-works/pi-coding-agent/dist/cli.js'),'--mode','rpc',
             '--no-context-files','--no-extensions','--no-skills','--no-prompt-templates','--no-builtin-tools',
             '--extension',str(PROJECT/'demo/ppt_demo_extension.ts'),'--extension',str(PROJECT/'tests/pi_external_benchmark_provider.ts'),
             '--provider','offline-external-test','--model','scripted','--session',str(tmp_path/'session.jsonl')]
    env={'PI_CODING_AGENT_DIR':str(tmp_path/'.pi-agent'),'PI_AUTORESEARCH_E2E_ROOT':str(tmp_path),'PPT_DEMO_ROOT':str(tmp_path),
         'EVO_MANIFEST':str(path),'PPT_DEMO_DEADLINE':'4102444800000','PPT_DEMO_BUDGET_USD':'1','PPT_DEMO_REQUEST_RESERVE_USD':'0.001',
         'PPT_DEMO_INPUT_USD_PER_MILLION':'0','PPT_DEMO_OUTPUT_USD_PER_MILLION':'0',
         'PI_EXTERNAL_STEPS':json.dumps([{'name':'read_self','arguments':{'section':'policy'}}]),'PI_EXTERNAL_USAGE_TOKENS':'1'}
    with PiKernel(command,cwd=str(tmp_path),env=env,timeout=90) as kernel:
        assert kernel.prompt('Execute the explicitly scripted budget boundary fixture.').get('success') is not False
        with pytest.raises(RuntimeError,match='Pi RPC process exited'):
            kernel.wait_for_agent_events(timeout=60)
    root=json.loads((tmp_path/'.harness/live-self.json').read_text(encoding='utf-8'))['root']
    assert root.get('review') is None
    closures=[r['value'] for r in root['ledger'] if r['type']=='review_closed']
    assert all(c.get('agent_decision') != 'present' for c in closures)
    trace=tmp_path/'harness/provider-requests.jsonl'
    assert (len(trace.read_text(encoding='utf-8').splitlines()) if trace.exists() else 0)==dispatched
