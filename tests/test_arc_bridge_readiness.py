"""Child-owned ephemeral sockets avoid probe/close/rebind races on Windows."""
import io
import json
from types import SimpleNamespace
from autoresearch_pi.arc_agi_3_e2e import _wait_for_bridge

def test_stdout_receipt_supports_child_selected_port_without_http_probe(tmp_path, monkeypatch):
    from autoresearch_pi import arc_agi_3_e2e as runner
    monkeypatch.setattr(runner, "_get_json", lambda *a, **kw: (_ for _ in ()).throw(AssertionError("do not query an unowned port")))
    ready = {"status": "ready", "host": "127.0.0.1", "port": 16000, "pid": 7, "game": "fixture"}
    child = SimpleNamespace(stdout=io.StringIO("SDK startup log\n" + json.dumps(ready) + "\n"), pid=7, poll=lambda: None)
    assert _wait_for_bridge(tmp_path, child, timeout=0.5) == ready

def test_partial_file_and_foreign_stdout_pid_do_not_count_as_ready(tmp_path):
    (tmp_path / "bridge-ready.json").write_text('{"status":', encoding="utf-8")
    foreign = {"status": "ready", "host": "127.0.0.1", "port": 16000, "pid": 8}
    real = {**foreign, "pid": 7}
    child = SimpleNamespace(stdout=io.StringIO(json.dumps(foreign) + "\n" + json.dumps(real) + "\n"), pid=7, poll=lambda: None)
    assert _wait_for_bridge(tmp_path, child, timeout=0.5) == real

def test_wrapped_python_pid_is_valid_only_for_the_exact_launch_identity(tmp_path):
    foreign = {"status": "ready", "host": "127.0.0.1", "port": 16000, "pid": 77, "launch_id": "unrelated"}
    real = {**foreign, "launch_id": "owned-launch"}
    child = SimpleNamespace(stdout=io.StringIO(json.dumps(foreign) + "\n" + json.dumps(real) + "\n"), pid=7, poll=lambda: None)
    assert _wait_for_bridge(tmp_path, child, timeout=0.5, launch_id="owned-launch") == real
