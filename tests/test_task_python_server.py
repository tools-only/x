"""Real persistent WASI host transport; no provider or ARC game calls."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys

import pytest


PROJECT = Path(__file__).resolve().parents[1]
SERVER = PROJECT / "demo/pi_task_python_server.py"
RUNNER = PROJECT / "demo/pi_task_python_runtime.py"
MODULE = PROJECT / "node_modules/@antonz/python-wasi/dist/python.wasm"


@pytest.mark.parametrize("legacy_stdio", [False, True], ids=["default", "gbk"])
def test_utf8_requests_survive_legacy_stdio_and_guest_failure(legacy_stdio):
    spec = importlib.util.spec_from_file_location("task_python_runner", RUNNER)
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
    runtime = runner.identity(MODULE)
    limits = {
        "input_bytes": 128 * 1024, "output_bytes": 64 * 1024,
        "memory_bytes": 128 * 1024 * 1024, "fuel": 1_000_000_000,
        "timeout_ms": 20_000,
    }
    notes = ["ASCII", "9\u219212; 12\u21948; \u4e2d\u6587; \U0001f9e9", "\u6062\u590d\u540e\u2192\u6b63\u5e38"]
    requests = []
    for index, note in enumerate(notes):
        requests.append({"id": len(requests) + 1, "request": {
            "source": 'result = {"\u5907\u6ce8": input["note"]}',
            "input": {"note": note}, "limits": limits, "runtime": runtime,
        }})
        if index == 1:
            requests.append({"id": len(requests) + 1, "request": {
                "source": "result = {(1, 2): 3}", "input": {},
                "limits": limits, "runtime": runtime,
            }})
    command = [sys.executable, "-I", str(SERVER), str(MODULE)]
    if legacy_stdio:
        # -I ignores PYTHONIOENCODING: force a legacy text decoder directly.
        bootstrap = (
            "import runpy,sys; "
            "sys.stdin.reconfigure(encoding='gbk',errors='surrogateescape'); "
            "sys.argv=sys.argv[1:]; runpy.run_path(sys.argv[0],run_name='__main__')"
        )
        command = [sys.executable, "-I", "-c", bootstrap, str(SERVER), str(MODULE)]
    payload = "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in requests)
    completed = subprocess.run(command, input=payload.encode("utf-8"),
                               capture_output=True, timeout=60)
    assert completed.returncode == 0, completed.stderr.decode("utf-8", "replace")
    messages = [json.loads(line) for line in completed.stdout.splitlines()]
    assert messages[0]["ready"] is True, messages[0]
    assert messages[0]["runtime"] == runtime
    replies = {row["id"]: row["result"] for row in messages[1:]}
    assert set(replies) == {1, 2, 3, 4}
    for request_id, note in zip([1, 2, 4], notes):
        result = replies[request_id]
        assert result["ok"] is True, result
        assert result["value"] == {"\u5907\u6ce8": note}
        assert result["runtime"] == runtime
        expected_bytes = len(json.dumps({"note": note}, ensure_ascii=False,
                                       separators=(",", ":")).encode("utf-8"))
        assert result["consumed"]["input_bytes"] == expected_bytes
    assert replies[3]["ok"] is False
    assert "tuple" in replies[3]["error"]
