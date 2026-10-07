"""Real Pi/broker/child diagnostic for action-card coverage vs complete scene access."""
import hashlib
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest
from autoresearch_pi.pi_kernel import PiKernel
from autoresearch_pi.subagent_broker import SubagentBroker
from test_pi_external_benchmark_native import _pi_cli


@pytest.mark.parametrize("delivery", ["on_demand", "published"])
def test_exact_action_cards_retain_fixed_scene_and_deliver_it_without_read_when_enabled(tmp_path, delivery):
    project=Path(__file__).resolve().parents[1]
    root=tmp_path/delivery
    root.mkdir()
    observations=[{"observation_id":f"execution-observation-{i}","version":1,"tool_name":"arc_action",
        "input":{"action":"ACTION6","x":0,"y":0},"is_error":False,
        "recordedAt":f"2026-10-02T00:00:0{i}Z","arc_outcome":{"state":"NOT_FINISHED",
        "observation_delta":{"changed_cells":i},"public_transition":{"level_changed":False}},
        "result_text":f"Action result {i}"} for i in (1,2)]
    (root/"execution-observations.jsonl").write_text("".join(json.dumps(x)+"\n" for x in observations),encoding="utf-8")
    method="baseline_method:research-orchestration@sha256:"+hashlib.sha256(
        (project/"demo/harness-methods/research-orchestration/SKILL.md").read_bytes()).hexdigest()
    report={"format":"auto-research-report-v1","status":"inconclusive","conclusion":"No semantic conclusion in this diagnostic.",
        "findings":[],"alternatives":[],"limitations":["Scripted provider"],"validation_plan":"Real provider required"}
    class PublicState(BaseHTTPRequestHandler):
        def do_GET(self):
            value={"events":[],"next":0} if self.path.startswith("/events") else {
                "frames":[[[9,0],[0,2]]],"state":"NOT_FINISHED","levels_completed":0,
                "available_actions":["ACTION6"],"action_budget":{"total_used":2}}
            body=json.dumps(value).encode()
            self.send_response(200);self.send_header("Content-Type","application/json");self.end_headers();self.wfile.write(body)
        def log_message(self,*_): pass
    server=ThreadingHTTPServer(("127.0.0.1",0),PublicState)
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    node,cli=_pi_cli()
    broker=SubagentBroker();broker.start()
    steps=[{"name":"task_harness","arguments":{"action":"read_method","method_name":"research-orchestration"}},
        {"name":"auto_research","arguments":{"action":"start","interaction_mode":"blocking",
        "authoring_method_ref":method,"question":"Compare all visible scene relationships, with these exact action observations.",
        "scope":"goal_pattern","research_kind":"solution","evidence_refs":[x["observation_id"] for x in observations]}}]
    env={"PI_AUTORESEARCH_E2E_ROOT":str(root),"PI_CODING_AGENT_DIR":str(root/".pi-agent"),
        "PI_AUTORESEARCH_VARIANT":"treatment","PI_ARC_BRIDGE_URL":f"http://127.0.0.1:{server.server_port}",
        "PI_ARC_INPUT_MODALITIES":"text,image","PI_ARC_CHILD_OBSERVATION":delivery,
        "PI_EXTERNAL_STEPS":json.dumps(steps),"PI_AUTORESEARCH_PI_CLI":cli,
        "PI_AUTORESEARCH_PROVIDER":"offline-subagent-test","PI_AUTORESEARCH_MODEL":"scripted",
        "PI_AUTORESEARCH_SUBAGENT_BROKER_URL":broker.url,
        "PI_AUTORESEARCH_SUBAGENT_PROVIDER_EXTENSION":str(project/"tests/pi_subagent_provider.ts"),
        "PI_SUBAGENT_STEPS":json.dumps([{"name":"submit_research_report","arguments":{"report":report}}])}
    try:
        with PiKernel([node,cli,"--mode","rpc","--provider","offline-external-test","--model","scripted",
            "--no-session","--no-extensions","--no-skills","--no-prompt-templates","--no-context-files","--no-builtin-tools",
            "--extension",str(project/"demo/pi_arc_agi_3_extension.ts"),
            "--extension",str(project/"tests/pi_external_benchmark_provider.ts")],cwd=str(root),env=env,timeout=60) as kernel:
            kernel.prompt("Exercise the scene-evidence delivery diagnostic without acting.")
            events=kernel.wait_for_agent_events(timeout=60)
    finally:
        broker.close();server.shutdown();server.server_close();thread.join(timeout=2)
    assert not next(e for e in events if e.get("type")=="tool_execution_end" and e.get("toolName")=="auto_research").get("isError")
    contexts=[json.loads(l)["context"] for l in (root/"subagent-provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()]
    assert contexts
    for context in contexts:
        names={t["name"] for t in context["tools"]}
        assert "arc_state" in names and "arc_action" not in names and "inspect_arc_trajectory" not in names
        slots=[p for m in context["messages"] for p in m.get("content",[]) if p.get("type")=="text"
            and p.get("text","").startswith("PARENT-PUBLISHED ARC OBSERVATION")]
        if delivery=="published":
            assert len(slots)==1 and "90\n02" in slots[0]["text"]
            assert sum(p.get("type")=="image" for m in context["messages"] for p in m.get("content",[]))==1
        else: assert not slots
    comparison=json.loads((root/"auto-research-comparison-bundles.jsonl").read_text(encoding="utf-8").splitlines()[-1])
    assert comparison["adapter_tools"]==["arc_state"]
    assert comparison["state_reader_retained_for_scene_evidence"] is True
    sessions=list((root/".task-child-sessions").glob("*.jsonl"))
    assert not any(part.get("type")=="toolCall" and part.get("name")=="arc_state"
        for p in sessions for line in p.read_text(encoding="utf-8").splitlines()
        for part in json.loads(line).get("message",{}).get("content",[]))
