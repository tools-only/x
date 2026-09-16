import json
import sys
import time
import pytest
from pathlib import Path

from autoresearch_pi.pi_kernel import AgentLoopWatchdog, AgentLoopWatchdogState, PiKernel, _watchdog_signature


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


def test_kernel_watchdog_steers_a_read_loop_inside_an_active_turn(tmp_path: Path):
    script = tmp_path / "watchdog.py"
    script.write_text("""import sys,json
for line in sys.stdin:
 p=json.loads(line)
 print(json.dumps({'id':p['id'],'type':'response','command':p['type']}), flush=True)
 if p['type'] == 'prompt':
  for _ in range(10): print(json.dumps({'type':'tool_execution_end','toolName':'read_state'}), flush=True)
 elif p['type'] == 'steer':
  print(json.dumps({'type':'agent_settled'}), flush=True)
""", encoding="utf-8")
    with PiKernel((sys.executable, str(script))) as kernel:
        kernel.prompt("start")
        events = kernel.wait_for_agent_events(
            timeout=2,
            watchdog=AgentLoopWatchdog(
                read_only_tools=frozenset({"read_state"}),
                max_read_only_calls_without_progress=3,
                max_interventions=2,
            ),
        )

    assert any(event.get("type") == "agent_progress_watchdog" for event in events)
    assert any(event.get("type") == "agent_settled" for event in events)


def test_kernel_stops_after_configured_progress_tool(tmp_path: Path):
    script = tmp_path / "progress_boundary.py"
    script.write_text("""import sys,json
for line in sys.stdin:
 p=json.loads(line)
 print(json.dumps({'id':p['id'],'type':'response','command':p['type']}), flush=True)
 if p['type'] == 'prompt':
  print(json.dumps({'type':'tool_execution_end','toolName':'arc_action'}), flush=True)
  print(json.dumps({'type':'tool_execution_start','toolName':'arc_state'}), flush=True)
""", encoding="utf-8")
    with PiKernel((sys.executable, str(script))) as kernel:
        kernel.prompt("start")
        events = kernel.wait_for_agent_events(
            timeout=2,
            stop_after_progress_tools=("arc_action",),
        )
    assert any(event.get("toolName") == "arc_action" for event in events)
    assert not any(event.get("toolName") == "arc_state" for event in events)


def test_kernel_waits_for_settled_after_progress_boundary_abort(tmp_path: Path):
    script = tmp_path / "progress_boundary_settled.py"
    script.write_text("""import sys,json
for line in sys.stdin:
 p=json.loads(line)
 print(json.dumps({'id':p['id'],'type':'response','command':p['type']}), flush=True)
 if p['type'] == 'prompt':
  print(json.dumps({'type':'tool_execution_end','toolName':'arc_action'}), flush=True)
 elif p['type'] == 'abort':
  print(json.dumps({'type':'agent_settled'}), flush=True)
""", encoding="utf-8")
    with PiKernel((sys.executable, str(script))) as kernel:
        kernel.prompt("start")
        events = kernel.wait_for_agent_events(timeout=2, stop_after_progress_tools=("arc_action",))
    assert any(event.get("type") == "agent_settled" for event in events)


def test_kernel_does_not_abort_native_terminated_progress_boundary(tmp_path: Path):
    script = tmp_path / "progress_boundary_native.py"
    script.write_text("""import sys,json
for line in sys.stdin:
 p=json.loads(line)
 print(json.dumps({'id':p['id'],'type':'response','command':p['type']}), flush=True)
 if p['type'] == 'prompt':
  print(json.dumps({'type':'tool_execution_end','toolName':'arc_action','evidence':{'arc_action_boundary':True}}), flush=True)
  print(json.dumps({'type':'agent_settled'}), flush=True)
 elif p['type'] == 'abort':
  print(json.dumps({'type':'unexpected_abort'}), flush=True)
""", encoding="utf-8")
    with PiKernel((sys.executable, str(script))) as kernel:
        kernel.prompt("start")
        events = kernel.wait_for_agent_events(timeout=2, stop_after_progress_tools=("arc_action",))
    assert any(event.get("type") == "agent_settled" for event in events)
    assert not any(event.get("type") == "unexpected_abort" for event in events)


def test_kernel_watchdog_carries_repeated_evidence_across_turns(tmp_path: Path):
    script = tmp_path / "cross_turn_watchdog.py"
    script.write_text("""import sys,json
for line in sys.stdin:
 p=json.loads(line)
 print(json.dumps({'id':p['id'],'type':'response','command':p['type']}), flush=True)
 if p['type'] == 'prompt':
  print(json.dumps({'type':'tool_execution_start','toolCallId':'read-1','toolName':'read_state','args':{'request':'same'}}), flush=True)
  print(json.dumps({'type':'tool_execution_end','toolCallId':'read-1','toolName':'read_state','result':{'details':{'state':'unchanged'}}}), flush=True)
  print(json.dumps({'type':'agent_settled'}), flush=True)
 elif p['type'] == 'steer':
  print(json.dumps({'type':'agent_settled'}), flush=True)
""", encoding="utf-8")
    watchdog = AgentLoopWatchdog(
        read_only_tools=frozenset({'read_state'}),
        max_read_only_calls_without_progress=2,
    )
    state = AgentLoopWatchdogState()
    with PiKernel((sys.executable, str(script))) as kernel:
        for _ in range(3):
            kernel.prompt('continue')
            events = kernel.wait_for_agent_events(timeout=2, watchdog=watchdog, watchdog_state=state)

    assert any(event.get('type') == 'agent_progress_watchdog' for event in events)
    assert state.interventions == 1


def test_watchdog_does_not_treat_harness_operations_as_primary_progress(tmp_path: Path):
    script = tmp_path / "harness_loop.py"
    script.write_text("""import sys,json
for line in sys.stdin:
 p=json.loads(line)
 print(json.dumps({'id':p['id'],'type':'response','command':p['type']}), flush=True)
 if p['type'] == 'prompt':
  for i in range(12):
   print(json.dumps({'type':'tool_execution_end','toolName':'arc_state','result':{'details':{'state':'same'}}}), flush=True)
   print(json.dumps({'type':'tool_execution_end','toolName':'task_tool','result':{'details':{'version':i}}}), flush=True)
 elif p['type'] == 'steer':
  print(json.dumps({'type':'agent_settled'}), flush=True)
""", encoding="utf-8")
    watchdog = AgentLoopWatchdog(
        read_only_tools=frozenset({'arc_state'}),
        progress_tools=frozenset({'arc_action'}),
        task_progress_tools=frozenset(),
        auxiliary_progress_tools=frozenset({'task_tool'}),
        max_read_only_calls_without_progress=3,
    )
    with PiKernel((sys.executable, str(script))) as kernel:
        kernel.prompt('start')
        events = kernel.wait_for_agent_events(timeout=2, watchdog=watchdog)

    assert any(event.get('type') == 'agent_progress_watchdog' for event in events)


def test_task_resource_watchdog_distinguishes_pages_but_matches_exact_rereads():
    first = {"toolName": "task_resource", "args": {
        "action": "read", "ref": "memory:model@v2", "offset": 0, "limit": 2000,
    }}
    repeated = json.loads(json.dumps(first))
    next_page = {"toolName": "task_resource", "args": {
        "action": "read", "ref": "memory:model@v2", "offset": 2000, "limit": 2000,
    }}
    newer_version = {"toolName": "task_resource", "args": {
        "action": "read", "ref": "memory:model@v3", "offset": 0, "limit": 2000,
    }}

    assert _watchdog_signature(first) == _watchdog_signature(repeated)
    assert _watchdog_signature(first) != _watchdog_signature(next_page)
    assert _watchdog_signature(first) != _watchdog_signature(newer_version)



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


def test_kernel_session_deadline_caps_later_event_waits(tmp_path):
    script = tmp_path / "deadline.py"
    script.write_text("""import sys,json,time
p=json.loads(sys.stdin.readline())
print(json.dumps({'type':'response','id':p['id']}), flush=True)
time.sleep(10)
""", encoding="utf-8")

    started = time.monotonic()
    with PiKernel(
        (sys.executable, str(script)), timeout=10, deadline=time.monotonic() + 0.25,
    ) as kernel:
        kernel.prompt("test")
        with pytest.raises(TimeoutError, match="deadline|agent turn"):
            kernel.wait_for_agent_events(timeout=10)

    assert time.monotonic() - started < 2


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


def test_event_projector_bounds_in_memory_events_without_changing_sink(tmp_path):
    script = tmp_path / "large_stream.py"
    script.write_text("""import sys,json
p=json.loads(sys.stdin.readline())
print(json.dumps({'id':p['id'],'type':'response'}), flush=True)
print(json.dumps({'type':'text_delta','partial':{'content':'x'*1000000}}), flush=True)
print(json.dumps({'type':'tool_execution_end','toolName':'probe','result':{'body':'y'*1000000}}), flush=True)
print(json.dumps({'type':'agent_settled'}), flush=True)
""", encoding="utf-8")
    sunk = []

    def project(event):
        if event.get("type") == "text_delta":
            return None
        if event.get("type") == "tool_execution_end":
            return {"type": "tool_execution_end", "toolName": event.get("toolName")}
        return event

    with PiKernel(
        (sys.executable, str(script)), event_sink=sunk.append, event_projector=project,
    ) as kernel:
        kernel.prompt("test")
        events = kernel.wait_for_agent_events(timeout=2)

    assert [event["type"] for event in events if event["type"] != "response"] == [
        "tool_execution_end", "agent_settled",
    ]
    assert events[-2] == {"type": "tool_execution_end", "toolName": "probe"}
    assert any(event.get("type") == "text_delta" for event in sunk)
    raw_tool = next(event for event in sunk if event.get("type") == "tool_execution_end")
    assert len(raw_tool["result"]["body"]) == 1_000_000


def test_kernel_drains_large_child_stderr_without_deadlocking_rpc(tmp_path):
    script = tmp_path / "large_stderr.py"
    script.write_text("""import sys,json
p=json.loads(sys.stdin.readline())
sys.stderr.write('diagnostic-' + 'x'*1000000)
sys.stderr.flush()
print(json.dumps({'id':p['id'],'type':'response','ok':True}), flush=True)
""", encoding="utf-8")

    with PiKernel((sys.executable, str(script)), timeout=2) as kernel:
        response = kernel.prompt("test")
        assert response["ok"] is True
        assert kernel.stderr_tail.endswith("x" * 100)
        assert len(kernel.stderr_tail) <= 65_536
