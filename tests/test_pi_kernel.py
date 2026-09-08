import json
import sys
import pytest
from pathlib import Path

from autoresearch_pi.pi_kernel import PiKernel


def test_rpc_kernel_sends_ids_and_captures_events(tmp_path: Path):
    script = tmp_path / "fake_pi.py"
    script.write_text("""import sys,json\nfor line in sys.stdin:\n p=json.loads(line); print(json.dumps({'id':p['id'],'type':'response','echo':p.get('message',p['type'])}), flush=True)\n""", encoding="utf-8")
    with PiKernel((sys.executable, str(script))) as kernel:
        response = kernel.prompt("hello")
        assert response["id"] == 1 and response["echo"] == "hello"
        assert kernel.events[0].payload["type"] == "response"


def test_rpc_kernel_native_steer_and_follow_up(tmp_path: Path):
    script = tmp_path / "fake_pi_mutation.py"
    script.write_text("""import sys,json
for line in sys.stdin:
 p=json.loads(line); print(json.dumps({'id':p['id'],'type':'response','command':p['type'],'seen':p.get('message')}), flush=True)
""", encoding="utf-8")
    with PiKernel((sys.executable, str(script))) as kernel:
        assert kernel.steer("mutated")["seen"] == "mutated"
        assert kernel.follow_up("after")["seen"] == "after"


def test_rpc_kernel_pumps_async_events_after_prompt_response(tmp_path: Path):
    script = tmp_path / "fake_pi_events.py"
    script.write_text("""import sys,json
for line in sys.stdin:
 p=json.loads(line)
 print(json.dumps({'id':p['id'],'type':'response','command':p['type']}), flush=True)
 print(json.dumps({'type':'tool_execution_end','toolName':'probe'}), flush=True)
 print(json.dumps({'type':'agent_end','messages':[]}), flush=True)
 print(json.dumps({'type':'agent_settled'}), flush=True)
""", encoding="utf-8")
    with PiKernel((sys.executable, str(script))) as kernel:
        kernel.prompt("hello")
        events = kernel.wait_for_agent_events(timeout=2)

    assert [event["type"] for event in events if event["type"] != "response"] == [
        "tool_execution_end",
        "agent_end",
        "agent_settled",
    ]


def test_event_sink_persists_partial_trace_before_timeout(tmp_path):
    script = tmp_path / "partial.py"
    script.write_text("""import sys,json,time
p=json.loads(sys.stdin.readline())
print(json.dumps({'type':'response','id':p['id']}), flush=True)
print(json.dumps({'type':'tool_execution_end','toolName':'probe'}), flush=True)
time.sleep(10)
""", encoding="utf-8")
    trace = tmp_path / "events.jsonl"
    with trace.open("w", encoding="utf-8") as stream:
        def persist(event):
            stream.write(json.dumps(event) + "\n")
            stream.flush()
        with PiKernel((sys.executable, str(script)), event_sink=persist) as kernel:
            kernel.prompt("test")
            with pytest.raises(TimeoutError):
                kernel.wait_for_agent_events(timeout=0.5)
            # Already readable while both the process and trace stream are open.
            events = [json.loads(line) for line in trace.read_text(encoding="utf-8").splitlines()]
            assert [event["type"] for event in events] == ["response", "tool_execution_end"]


def test_settled_before_rpc_response_is_not_lost(tmp_path):
    script = tmp_path / "early.py"
    script.write_text("""import sys,json,time
p=json.loads(sys.stdin.readline())
print(json.dumps({'type':'agent_settled'}), flush=True)
print(json.dumps({'type':'response','id':p['id']}), flush=True)
time.sleep(10)
""", encoding="utf-8")
    with PiKernel((sys.executable, str(script))) as kernel:
        kernel.prompt("test")
        assert kernel.wait_for_agent_events(timeout=0.5)[0]["type"] == "agent_settled"
