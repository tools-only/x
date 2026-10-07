"""Diagnostic Pi input/reload checks; scripted fixtures do not prove adoption."""
import hashlib
import json
import threading
import pytest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from test_arc_capability_surface_native import _run_arc_parent


@pytest.mark.parametrize('kind,frames', [
    ('offset', [[[0, 2, 2, 0, 0]], [[0, 0, 2, 2, 0]], [[0, 2, 2, 0, 0]]]),
    ('pattern', [[[2, 2, 2], [2, 0, 0], [2, 0, 0]], [[2, 2, 2], [0, 0, 2], [0, 0, 2]], [[2, 2, 2], [2, 0, 0], [2, 0, 0]]]),
    ('stationary', [[[0, 2, 2, 2, 2, 2, 0, 0, 0]], [[0, 0, 2, 2, 2, 2, 2, 0, 0]], [[0, 0, 2, 2, 2, 2, 2, 0, 3]]]),
])
def test_canonical_witnesses_reach_later_pi_input_despite_knowledge_replacement(tmp_path, kind, frames):
    fingerprint = hashlib.sha256(str(tmp_path.resolve()).encode()).hexdigest()[:16]
    scope = {"task_id": f"root-{fingerprint}", "task_root_fingerprint": fingerprint}
    state = {"frames": [frames[-1]], "state": "NOT_FINISHED", "levels_completed": 0,
             "available_actions": ["ACTION1", "ACTION2"], "action_budget": {"total_used": 2}}
    preactions, events = [], []
    for i, action in enumerate(["ACTION1", "ACTION2"], 1):
        ref = f"pre_action_state:fixture-{i}@v1"
        preactions.append({"state_id": f"fixture-{i}", "version": 1,
                           "public_state": {**state, "frames": [frames[i - 1]]}, **scope})
        events.append({"event": "action", "index": i, "action": action,
                       "pre_action_state": {"resource_ref": ref},
                       "frame": {**state, "frames": [frames[i]], "public_transition": {"level_changed": False}}})
    for name, rows in [("pre-action-states.jsonl", preactions), ("bridge-events.jsonl", events)]:
        (tmp_path / name).write_text("".join(json.dumps(x) + "\n" for x in rows), encoding="utf-8")

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args): pass
        def do_GET(self):
            value = state if self.path == "/state" else {"next": 0, "events": []}
            body = json.dumps(value).encode()
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    env = {"PI_ARC_BRIDGE_URL": f"http://127.0.0.1:{server.server_port}",
           "PI_AUTORESEARCH_CONTEXT_MAX_CHARS": "8000"}
    try:
        results = _run_arc_parent(tmp_path, [
            {"name": "task_checkpoint", "arguments": {"action": "update",
                "decision_state": {"known_effects": ["Only the latest local observation"]}}},
            {"name": "task_checkpoint", "arguments": {"action": "update", "next_step": "Check retained offsets"}},
        ], extra_env=env)
        assert not [x for x in results if x.get("isError")]
        _run_arc_parent(tmp_path, [], extra_env=env)  # New Pi process: canonical reconstruction.
    finally:
        server.shutdown()
        server.server_close()
    contexts = [json.loads(x)["context"] for x in (tmp_path / "provider-contexts.jsonl").read_text().splitlines()]
    assert len(contexts) == 4
    for context in contexts:
        current = [p["text"] for m in context["messages"] for p in m.get("content", [])
                   if p.get("type") == "text" and p["text"].startswith("CURRENT PUBLIC ARC OBSERVATION")]
        assert len(current) == 1
        assert current[0].count("CURRENT SMALL COLOR REGIONS") == 1
        assert '"omitted":0' in current[0]
        if kind == 'offset':
            assert current[0].count("PUBLIC OFFSET WITNESSES") == 1
            assert '"offset":[1,0]' in current[0] and '"offset":[-1,0]' in current[0]
            assert current[0].count('"entered_colors":[[0,1]]') == 2
        elif kind == 'pattern':
            assert current[0].count("PUBLIC ANCHORED PATTERN CHANGES") == 1
            assert '"before":["###","#..","#.."]' in current[0]
            assert '"after":["###","..#","..#"]' in current[0]
        else:
            assert current[0].count("PUBLIC UNCHANGED PLACEMENT WITNESSES") == 1
            assert '"anchor":[2,0],"mask":["#####"],"action":"ACTION2","observations":1' in current[0]
            assert current[0].count("CURRENT MATCHES OF PREVIOUSLY TRANSLATED PATTERNS") == 1
            assert '"mask":["#####"],"matches":1,"anchor":[2,0]' in current[0]
            assert 'state=observation_snapshot:' in current[0]
        assert all(x in current[0] for x in ["fixture-1@v1", "fixture-2@v1"])
        assert '\n'.join(''.join(format(c,'x') for c in row) for row in frames[-1]) in current[0]
    checkpoint = json.loads((tmp_path / "task-checkpoint.json").read_text())
    assert checkpoint["decision_state"]["known_effects"] == ["Only the latest local observation"]
    facts=json.loads((tmp_path/'arc-geometry-facts.json').read_text(encoding='utf-8'))
    assert facts['level']==0
    if kind=='offset': assert facts['facts']==[]
    else:
        assert len(facts['facts'])==(2 if kind=='pattern' else 1)
        assert json.loads(facts['facts'][0])[0]==kind
        from autoresearch_pi.reasoning_policy import evidence_reasoning_opportunity
        cp={'recent_actions':[{'action':'ACTION2','changed_cells':2,'level_after':0,'observation_id':'fixture'}]}
        assert evidence_reasoning_opportunity(cp,{'geometry_evidence':facts})[1]=='new_exact_geometry_evidence'


def test_committed_native_action_persists_fact_before_later_parent_view(tmp_path):
    fingerprint=hashlib.sha256(str(tmp_path.resolve()).encode()).hexdigest()[:16]
    a=[[0,2,2,2,2,2,0,0]]; b=[[0,0,2,2,2,2,2,0]]
    state={'frames':[b],'state':'NOT_FINISHED','levels_completed':0,
           'available_actions':['ACTION2'],'action_budget':{'total_used':1}}
    scope={'task_id':f'root-{fingerprint}','task_root_fingerprint':fingerprint}
    refs=[{'state_id':'move','version':1,'public_state':{**state,'frames':[a]},**scope},
          {'state_id':'blocked','version':1,'public_state':state,**scope}]
    (tmp_path/'pre-action-states.jsonl').write_text(''.join(json.dumps(r)+'\n' for r in refs),encoding='utf-8')
    history={'event':'action','index':1,'action':'ACTION1',
             'pre_action_state':{'resource_ref':'pre_action_state:move@v1'},
             'frame':{**state,'public_transition':{'level_changed':False}}}
    (tmp_path/'bridge-events.jsonl').write_text(json.dumps(history)+'\n',encoding='utf-8')
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args): pass
        def reply(self,value):
            body=json.dumps(value).encode();self.send_response(200)
            self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
        def do_GET(self): self.reply(state if self.path=='/state' else {'next':0,'events':[]})
        def do_POST(self):
            self.rfile.read(int(self.headers['Content-Length']))
            assert json.loads((tmp_path/'arc-geometry-facts.json').read_text())['facts']==[]
            self.reply({**state,'pre_action_state':{'resource_ref':'pre_action_state:blocked@v1'},
                        'observation_delta':{'changed_cells':0},'public_transition':{'level_changed':False}})
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    try:
        events=_run_arc_parent(tmp_path,[{'name':'arc_action','arguments':{'action':'ACTION2'}}],
                               extra_env={'PI_ARC_BRIDGE_URL':f'http://127.0.0.1:{server.server_port}'})
        assert not [e for e in events if e.get('isError')]
        facts=json.loads((tmp_path/'arc-geometry-facts.json').read_text())
        assert len(facts['facts'])==1 and json.loads(facts['facts'][0])[0]=='stationary'
        # No extra parent turn or before_agent_start is needed to make this readable.
        from autoresearch_pi.reasoning_policy import select_reasoning_level
        cp={'recent_actions':[{'action':'ACTION2','changed_cells':0,'level_after':0}]}
        assert select_reasoning_level(cp,{'geometry_evidence':facts},'adaptive-evidence',('low','medium'))==( 
            'medium','new_exact_geometry_evidence')
    finally: server.shutdown();server.server_close()
