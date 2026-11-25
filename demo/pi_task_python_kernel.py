"""Trusted host for one live Python kernel: a native CPython process that keeps its namespace between cells.

The guest program (the session prelude) runs on a worker thread of this process with the host's full library
ecosystem available. The channel back to the parent and its lifetime are unchanged from the WASI version:
  - The guest asks the host something by calling `_rpc`, which writes one event line to the real stdout and
    blocks until the parent's answer arrives on stdin. This is how a cell waits for an action without being
    restarted and replayed.
  - The process lives across cells. A cell's compute time is limited by a watchdog; time spent waiting for
    the parent does not count. Exceeding it ends the kernel: the next cell starts a new one, which restores
    the session's checkpoint. File descriptor 1 is pointed at devnull so stray prints cannot corrupt the
    protocol; only the host's duplicated handle reaches the parent.

Protocol with the parent process (one JSON object per line):
  parent -> host: {"type": "cell", "request": {...}} after "ready" or "done"; {"type": "reply", "data": {...}} after a
                  "request" event; {"type": "shutdown"}.
  host -> parent: {"event": "ready"}; {"event": "request", "data": {...}}; {"event": "done", "result": {...},
                  "metrics": {...}}; {"event": "dead", "error": str} (then the host exits).
"""
from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import queue
import sys
import threading
import time


def _load_runtime():
    path = Path(__file__).with_name("pi_task_python_runtime.py")
    spec = importlib.util.spec_from_file_location("pi_task_python_runtime", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


RUNTIME = _load_runtime()


class Kernel:
    def __init__(self, request: dict):
        runtime = RUNTIME.identity(None)
        if request.get("runtime") != runtime:
            raise RuntimeError("Saved Python runtime changed; publish a new tool version")
        self.limits = request["limits"]
        self.source = request["source"]
        self.incoming: "queue.Queue[dict]" = queue.Queue()
        self.emit_lock = threading.Lock()
        # Keep the protocol channel private: the guest's fd 1 becomes devnull.
        self.parent = os.fdopen(os.dup(1), "w", buffering=1, encoding="utf-8", newline="\n")
        devnull = os.open(os.devnull, os.O_WRONLY)
        os.dup2(devnull, 1)
        os.close(devnull)
        self.timer: threading.Timer | None = None
        self.budget = self.limits["timeout_ms"] / 1000
        self.cell_started = None
        self.waited = 0.0
        self.compute_started = None

    # Compute time is counted only while the guest runs, not while it waits for the parent.
    def resume(self):
        self.compute_started = time.monotonic()
        self.timer = threading.Timer(max(0.0, self.budget), self.expire)
        self.timer.daemon = True
        self.timer.start()

    def pause(self):
        if self.timer:
            self.timer.cancel()
            self.timer = None
        if self.compute_started is not None:
            self.budget -= time.monotonic() - self.compute_started
            self.compute_started = None

    def expire(self):
        # A thread stuck in synchronous Python cannot be interrupted; the kernel ends and is replaced.
        self.die("a cell exceeded its compute time of %d s" % (self.limits["timeout_ms"] // 1000))

    def die(self, error: str):
        self.emit({"event": "dead", "error": error})
        os._exit(0)

    def emit(self, message: dict):
        with self.emit_lock:
            self.parent.write(json.dumps(message, ensure_ascii=True, allow_nan=False) + "\n")

    def next_cell(self):
        message = self.incoming.get()
        if message.get("type") == "cell":
            self.budget = self.limits["timeout_ms"] / 1000
            self.cell_started = time.monotonic()
            self.waited = 0.0
            return message["request"]
        return None

    def rpc(self, frame: dict):
        kind = frame.get("t")
        self.pause()
        if kind == "ready":
            self.emit({"event": "ready", "compile_ms": 0})
            reply = self.next_cell()
        elif kind == "done":
            now = time.monotonic()
            self.emit({"event": "done", "result": frame.get("result"),
                       "metrics": {"wall_ms": round((now - self.cell_started) * 1000),
                                   "wait_ms": round(self.waited * 1000),
                                   "compute_ms": round((self.limits["timeout_ms"] / 1000 - self.budget) * 1000)}})
            reply = self.next_cell()
        elif kind in ("act", "file", "review"):
            waited = time.monotonic()
            self.emit({"event": "request", "data": frame})
            message = self.incoming.get()
            self.waited += time.monotonic() - waited
            reply = message.get("data") if message.get("type") == "reply" else {"error": "kernel shutting down"}
        else:
            raise ValueError("unknown kernel frame")
        self.resume()
        return reply

    def run(self):
        error = None
        namespace = {"__name__": "__main__", "_rpc": self.rpc}
        try:
            namespace["input"] = self.rpc({"t": "ready"})
            exec(compile(self.source, "<kernel>", "exec"), namespace)
            error = "the kernel exited"
        except SystemExit as stop:
            error = "the kernel exited" if stop.code in (0, None) else "exit code %s" % stop.code
        except BaseException as problem:
            error = "%s: %s" % (type(problem).__name__, str(problem)[:1200])
        finally:
            self.pause()
        self.die(error)


def main() -> None:
    kernel = None
    try:
        start = json.loads(sys.stdin.buffer.readline())
        kernel = Kernel(start)
    except Exception as error:
        print(json.dumps({"event": "dead", "error": str(error)[:1200]}), flush=True)
        sys.exit(1)
    threading.Thread(target=kernel.run, daemon=True).start()
    # Node sends UTF-8 bytes; read them as bytes so a locale decoder cannot corrupt source or inputs.
    for line in sys.stdin.buffer:
        if not line.strip():
            continue
        message = json.loads(line)
        if message.get("type") == "shutdown":
            break
        kernel.incoming.put(message)
    kernel.incoming.put({"type": "shutdown"})
    os._exit(0)


if __name__ == "__main__":
    main()
