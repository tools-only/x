"""Trusted host for one live Python kernel: a single WASI instance that keeps its namespace between cells.

The guest is the pinned CPython/WASM interpreter, as for every task Python execution; nothing else is exposed to it.
The only additions are the channel back to the host and its lifetime:
  - The guest asks the host something by writing one frame line to stdout. The host's stdout callback runs on the
    guest's thread, so the guest is suspended there until the answer exists. The answer is written to a fresh file
    in a private, read-only preopened directory, which the guest reads when the write returns. This is how a cell
    waits for an action without being restarted and replayed.
  - The instance lives across cells. A cell's compute time is limited (the epoch deadline); time spent waiting for
    the host does not count. Exceeding it traps the instance: the kernel is gone and the next cell starts a new one,
    which restores the session's checkpoint.

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
import shutil
import sys
import tempfile
import threading
import time


def _load_runtime():
    path = Path(__file__).with_name("pi_task_python_runtime.py")
    spec = importlib.util.spec_from_file_location("pi_task_python_runtime", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


RUNTIME = _load_runtime()
FRAME = b"\x1e"
MAX_FRAME_BYTES = 8 * 1024 * 1024

# Runs in the guest before the program. _rpc is the program's only way out: write a frame, read the answer.
# io.open is kept here because the program replaces builtins.open with its workspace view.
KERNEL_GUEST = r'''
import io, json, os
_rpc_count = [0]
def _rpc(message, _open=io.open, _write=os.write):
    _rpc_count[0] += 1
    _write(1, b"\x1e" + json.dumps(message, ensure_ascii=True, allow_nan=False).encode("ascii") + b"\n")
    with _open("/kernel/%d.json" % _rpc_count[0], "rb") as stream:
        return json.loads(stream.read())
input = _rpc({"t": "ready"})
exec(compile(PROGRAM, "<kernel>", "exec"), globals())
'''


class Kernel:
    def __init__(self, module_path: Path, request: dict):
        import wasmtime

        self.wasmtime = wasmtime
        runtime = RUNTIME.identity(module_path)
        if request.get("runtime") != runtime:
            raise RuntimeError("Saved Python runtime changed; publish a new tool version")
        self.limits = request["limits"]
        config = wasmtime.Config()
        config.epoch_interruption = True
        self.engine = wasmtime.Engine(config)
        started = time.monotonic()
        module = wasmtime.Module.from_file(self.engine, str(module_path))
        self.compile_ms = round((time.monotonic() - started) * 1000)
        if any(item.module != "wasi_snapshot_preview1" for item in module.imports):
            raise RuntimeError("Unexpected host imports in the Python interpreter")
        linker = wasmtime.Linker(self.engine)
        linker.define_wasi()
        self.store = wasmtime.Store(self.engine)
        self.store.set_limits(memory_size=self.limits["memory_bytes"], instances=1, memories=1, tables=1)
        self.store.set_epoch_deadline(1)
        self.replies = tempfile.mkdtemp(prefix="pi-kernel-")
        wasi = wasmtime.WasiConfig()
        source = "PROGRAM = " + json.dumps(request["source"]) + "\n" + KERNEL_GUEST
        wasi.argv = ["python", "-I", "-S", "-B", "-X", "utf8", "-c", source]
        wasi.env = []
        # Read-only for the guest: only the host writes answers there.
        wasi.preopen_dir(self.replies, "/kernel", False)
        self.pending = bytearray()
        self.diagnostic = bytearray()
        wasi.stdout_custom = self.on_stdout
        wasi.stderr_custom = self.on_stderr
        self.store.set_wasi(wasi)
        self.instance = linker.instantiate(self.store, module)
        self.incoming: "queue.Queue[dict]" = queue.Queue()
        self.answered = 0
        self.timer: threading.Timer | None = None
        self.budget = self.limits["timeout_ms"] / 1000
        self.cell_started = None
        self.waited = 0.0
        self.compute_started = None
        self.reason = ""

    # Compute time is counted only while the guest runs, not while it waits for the host.
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
        self.stop("a cell exceeded its compute time of %d s" % (self.limits["timeout_ms"] // 1000))

    def answer(self, data: dict):
        self.answered += 1
        path = os.path.join(self.replies, "%d.json" % self.answered)
        with open(path, "wb") as stream:
            stream.write(json.dumps(data, ensure_ascii=True, allow_nan=False).encode("ascii"))
        stale = os.path.join(self.replies, "%d.json" % (self.answered - 1))
        if os.path.exists(stale):
            os.remove(stale)

    def emit(self, message: dict):
        sys.stdout.write(json.dumps(message, ensure_ascii=True, allow_nan=False) + "\n")
        sys.stdout.flush()

    def next_cell(self) -> dict | None:
        message = self.incoming.get()
        if message.get("type") == "cell":
            self.budget = self.limits["timeout_ms"] / 1000
            self.cell_started = time.monotonic()
            self.waited = 0.0
            return message["request"]
        return None

    def on_frame(self, frame: dict):
        kind = frame.get("t")
        self.pause()
        if kind == "ready":
            self.emit({"event": "ready", "compile_ms": self.compile_ms})
            self.answer(self.next_cell())
        elif kind == "done":
            now = time.monotonic()
            self.emit({"event": "done", "result": frame.get("result"),
                       "metrics": {"wall_ms": round((now - self.cell_started) * 1000),
                                   "wait_ms": round(self.waited * 1000),
                                   "compute_ms": round((self.limits["timeout_ms"] / 1000 - self.budget) * 1000)}})
            self.answer(self.next_cell())
        elif kind in ("act", "file"):
            waited = time.monotonic()
            self.emit({"event": "request", "data": frame})
            message = self.incoming.get()
            self.waited += time.monotonic() - waited
            self.answer(message.get("data") if message.get("type") == "reply" else {"error": "kernel shutting down"})
        else:
            raise ValueError("unknown kernel frame")
        self.resume()

    def stop(self, reason: str):
        self.reason = reason
        self.engine.increment_epoch()

    def on_stdout(self, data: bytes) -> int:
        self.pending.extend(data)
        if len(self.pending) > MAX_FRAME_BYTES:
            self.pending.clear()
            self.stop("a cell result exceeded %d MB" % (MAX_FRAME_BYTES // (1024 * 1024)))
            return -1
        while True:
            index = self.pending.find(b"\n")
            if index < 0:
                break
            line = bytes(self.pending[:index])
            del self.pending[:index + 1]
            # Bytes that are not a frame (a raw write to fd 1) are dropped rather than parsed as protocol.
            if not line.startswith(FRAME):
                continue
            try:
                frame = json.loads(line[1:])
            except ValueError:
                continue
            try:
                self.on_frame(frame)
            except Exception as problem:
                self.stop("kernel host failure: " + str(problem)[:600])
                return -1
        return len(data)

    def on_stderr(self, data: bytes) -> int:
        self.diagnostic.extend(data[:max(0, 4096 - len(self.diagnostic))])
        return len(data)

    def run(self):
        wasmtime = self.wasmtime
        error = None
        try:
            self.instance.exports(self.store)["_start"](self.store)
            error = "the kernel exited"
        except wasmtime.ExitTrap as trap:
            error = "the kernel exited" if trap.code == 0 else (self.diagnostic.decode("utf-8", "replace") or f"exit code {trap.code}")
        except (wasmtime.Trap, wasmtime.WasmtimeError) as trap:
            error = self.reason or str(trap)[:1200]
        except Exception as problem:  # A failure inside the callback surfaces here.
            error = "kernel host failure: " + str(problem)[:600]
        finally:
            self.pause()
        self.emit({"event": "dead", "error": error})
        shutil.rmtree(self.replies, ignore_errors=True)
        os._exit(0)


def main() -> None:
    kernel = None
    try:
        module_path = Path(sys.argv[1])
        start = json.loads(sys.stdin.buffer.readline())
        kernel = Kernel(module_path, start)
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
