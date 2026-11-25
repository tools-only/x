"""Persistent host for the harness evidence board.

Each request runs the shared native runner (pi_task_python_runtime.py) in a
fresh guest subprocess, so one wedged or crashed request cannot take the
board host or other requests with it. The runner is imported, not modified,
so saved tool runtime identities match the one-shot path exactly.
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import sys


def _load_runtime():
    path = Path(__file__).with_name("pi_task_python_runtime.py")
    spec = importlib.util.spec_from_file_location("pi_task_python_runtime", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


RUNTIME = _load_runtime()


def main() -> None:
    try:
        print(json.dumps({"id": None, "ready": True, "runtime": RUNTIME.identity()}), flush=True)
    except Exception as error:
        print(json.dumps({"id": None, "ready": False, "error": str(error)[:1200]}), flush=True)
        sys.exit(1)
    # Node sends UTF-8 bytes. Bypass locale-dependent text decoding, as the
    # one-shot runner does; a GBK decoder corrupts Unicode source and inputs.
    # One JSON request per line; requests are executed strictly in order.
    for line in sys.stdin.buffer:
        if not line.strip():
            continue
        request_id = None
        try:
            message = json.loads(line)
            request_id = message.get("id")
            result = RUNTIME.execute(message["request"])
        except Exception as error:
            result = {"ok": False, "error": str(error)[:1200]}
        print(json.dumps({"id": request_id, "result": result}, ensure_ascii=True, allow_nan=False), flush=True)


if __name__ == "__main__":
    main()
