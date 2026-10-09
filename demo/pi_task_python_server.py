"""Persistent trusted host for the harness evidence board.

Each request still runs the pinned guest wrapper in a fresh WASI instance with
its own store, fuel, memory and epoch deadline. Only the compiled interpreter
module is reused, so repeated board evaluations avoid recompiling python.wasm.
The pinned runner (pi_task_python_runtime.py) is imported, not modified, so
saved tool runtime identities are unchanged.
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
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


class Host:
    def __init__(self, module_path: Path):
        import wasmtime

        self.wasmtime = wasmtime
        self.identity = RUNTIME.identity(module_path)
        config = wasmtime.Config()
        config.consume_fuel = True
        config.epoch_interruption = True
        self.engine = wasmtime.Engine(config)
        self.module = wasmtime.Module.from_file(self.engine, str(module_path))
        if any(item.module != "wasi_snapshot_preview1" for item in self.module.imports):
            raise RuntimeError("Unexpected host imports in the Python interpreter")
        self.linker = wasmtime.Linker(self.engine)
        self.linker.define_wasi()

    def execute(self, request: dict) -> dict:
        wasmtime = self.wasmtime
        runtime = self.identity
        if request.get("runtime") != runtime:
            raise RuntimeError("Saved Python runtime changed; publish a new tool version")
        limits = request["limits"]
        store = wasmtime.Store(self.engine)
        store.set_limits(memory_size=limits["memory_bytes"], instances=1, memories=1, tables=1)
        store.set_fuel(limits["fuel"])
        store.set_epoch_deadline(1)
        wasi = wasmtime.WasiConfig()
        payload = json.dumps({"source": request["source"], "input": request["input"],
                              "output_bytes": limits["output_bytes"]}, ensure_ascii=True)
        wasi.argv = ["python", "-I", "-S", "-B", "-X", "utf8", "-c", RUNTIME.GUEST, payload]
        wasi.env = []
        output = bytearray()
        diagnostic = bytearray()
        overflow = [False]

        def write_output(data: bytes) -> int:
            if len(output) + len(data) > limits["output_bytes"]:
                overflow[0] = True
                self.engine.increment_epoch()
                return -1
            output.extend(data)
            return len(data)

        def write_error(data: bytes) -> int:
            diagnostic.extend(data[:max(0, 2048 - len(diagnostic))])
            return len(data)

        wasi.stdout_custom = write_output
        wasi.stderr_custom = write_error
        store.set_wasi(wasi)
        started = time.monotonic()
        timer = threading.Timer(limits["timeout_ms"] / 1000, self.engine.increment_epoch)
        timer.daemon = True
        timer.start()
        error = None
        try:
            instance = self.linker.instantiate(store, self.module)
            instance.exports(store)["_start"](store)
        except wasmtime.ExitTrap as trap:
            if trap.code != 0:
                error = diagnostic.decode("utf-8", "replace") or f"Python exited with code {trap.code}"
        except (wasmtime.Trap, wasmtime.WasmtimeError) as trap:
            error = str(trap)[:1200]
        finally:
            timer.cancel()
        consumed = {"fuel": limits["fuel"] - store.get_fuel(),
                    "input_bytes": len(json.dumps(request["input"], ensure_ascii=False, separators=(",", ":")).encode("utf-8")),
                    "output_bytes": len(output), "execution_ms": round((time.monotonic() - started) * 1000)}
        if overflow[0]:
            error = "Python output exceeds output_bytes"
        if error:
            return {"ok": False, "error": error, "runtime": runtime, "consumed": consumed}

        def exact_integer(text: str) -> int:
            value = int(text)
            if abs(value) > 2**53 - 1:
                raise ValueError("Result integer exceeds exact JSON transport range; convert it to a string")
            return value

        try:
            value = json.loads(output, parse_int=exact_integer,
                               parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))
        except (ValueError, UnicodeError) as error:
            return {"ok": False, "error": f"Python did not return JSON: {str(error)[:240]}",
                    "runtime": runtime, "consumed": consumed}
        return {"ok": True, "value": value, "runtime": runtime, "consumed": consumed}


def main() -> None:
    host = None
    try:
        host = Host(Path(sys.argv[1]))
        print(json.dumps({"id": None, "ready": True, "runtime": host.identity}), flush=True)
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
            result = host.execute(message["request"])
        except Exception as error:
            result = {"ok": False, "error": str(error)[:1200]}
        print(json.dumps({"id": request_id, "result": result}, ensure_ascii=True, allow_nan=False), flush=True)


if __name__ == "__main__":
    main()
