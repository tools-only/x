"""Real Pi ordering and rejection lifecycle; HTTP is a diagnostic spy."""
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from test_arc_capability_surface_native import _run_arc_parent


def test_closed_action_boundary_rejection_ends_attempt_without_pending(tmp_path):
    calls=[]
    state={'frames':[[[0,9,0]]],'state':'NOT_FINISHED','levels_completed':0,
           'available_actions':['ACTION1'],'action_budget':{'total_used':0}}
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args): pass
        def reply(self,value):
            body=json.dumps(value).encode();self.send_response(200)
            self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
        def do_GET(self): self.reply(state if self.path=='/state' else {'next':0,'events':[]})
        def do_POST(self):
            calls.append(json.loads(self.rfile.read(int(self.headers['Content-Length']))))
            state['action_budget']['total_used']+=1
            self.reply({**state,'public_transition':{'level_changed':False},
                        'observation_delta':{'changed_cells':0,'frame_available':True}})
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    env={'PI_ARC_BRIDGE_URL':f'http://127.0.0.1:{server.server_port}'}
    try:
        events=_run_arc_parent(tmp_path,[[
            {'name':'arc_action','arguments':{'action':'ACTION1'}},
            {'name':'task_checkpoint','arguments':{'action':'update','current_subgoal':'NOT_APPLIED'}},
        ]],extra_env=env)
        ends=[e for e in events if e.get('type')=='tool_execution_end']
        assert [bool(e.get('isError')) for e in ends]==[False,True]
        assert len(calls)==1
        checkpoint=json.loads((tmp_path/'task-checkpoint.json').read_text(encoding='utf-8'))
        assert checkpoint.get('current_subgoal')!='NOT_APPLIED'
        assert not checkpoint.get('pending_operations')
        failures=[json.loads(l) for l in (tmp_path/'task-operation-failures.jsonl').read_text(encoding='utf-8').splitlines()]
        assert len(failures)==1
        assert failures[0]['applied'] is False and failures[0]['retryable'] is False
        assert not failures[0].get('required_next_call')
        events=_run_arc_parent(tmp_path,[[
            {'name':'task_checkpoint','arguments':{'action':'update','current_subgoal':'FRESH_VALID_UPDATE'}},
            {'name':'arc_action','arguments':{'action':'ACTION1'}},
        ]],extra_env=env)
        assert not [e for e in events if e.get('isError')]
        assert len(calls)==2
        checkpoint=json.loads((tmp_path/'task-checkpoint.json').read_text(encoding='utf-8'))
        assert checkpoint['current_subgoal']=='FRESH_VALID_UPDATE'
        assert not checkpoint.get('pending_operations')
    finally:
        server.shutdown();server.server_close()
