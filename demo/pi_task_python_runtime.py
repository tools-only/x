"""Trusted CPython/WASI host. Authored source runs only inside WebAssembly."""
from __future__ import annotations

import hashlib
import importlib.metadata
import json
from pathlib import Path
import sys
import threading
import time

WASM_SHA256 = "e5dc5a398b07b54ea8fdb503bf68fb583d533f10ec3f930963e02b9505f7a763"
WASMTIME_VERSION = "49.0.0"

# This wrapper is evaluated by guest CPython, never by the host interpreter.
# Capturing the last expression is the tool's return convention, not a dialect.
GUEST = r'''
import ast, contextlib, json, sys

class DiscardText:
    def write(self, text): return len(text)
    def flush(self): pass

request = json.loads(sys.argv[1])
namespace = {"input": request["input"], "__name__": "__main__"}
tree = ast.parse(request["source"], filename="<task-tool>")
if tree.body and isinstance(tree.body[-1], ast.Expr):
    tree.body[-1] = ast.copy_location(ast.Assign(
        targets=[ast.Name(id="__task_tool_result__", ctx=ast.Store())],
        value=tree.body[-1].value), tree.body[-1])
    ast.fix_missing_locations(tree)
    result_name = "__task_tool_result__"
else:
    result_name = "result"

try:
    with contextlib.redirect_stdout(DiscardText()), contextlib.redirect_stderr(DiscardText()):
        exec(compile(tree, "<task-tool>", "exec"), namespace)
    if result_name not in namespace:
        raise ValueError("Finish with a JSON result expression or assign result")
    text = json.dumps(namespace[result_name], ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    if len(text.encode("utf-8")) > request["output_bytes"]:
        raise ValueError("JSON output exceeds output_bytes")
    sys.stdout.write(text)
except BaseException as error:
    # A real error, including SystemExit, must not look like a successful tool.
    sys.stderr.write(type(error).__name__ + ": " + str(error)[:1200])
    sys.exit(1)
'''


def identity(module_path: Path) -> dict:
    if importlib.metadata.version("wasmtime") != WASMTIME_VERSION:
        raise RuntimeError(f"Task Python needs wasmtime=={WASMTIME_VERSION}")
    if hashlib.sha256(module_path.read_bytes()).hexdigest() != WASM_SHA256:
        raise RuntimeError("Task Python WASM does not match the pinned interpreter")
    return {"python_version": "3.12.0", "wasmtime_version": WASMTIME_VERSION,
            "module_sha256": WASM_SHA256,
            "runner_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}


def execute(module_path: Path, request: dict) -> dict:
    import wasmtime

    runtime = identity(module_path)
    if request.get("runtime") != runtime:
        raise RuntimeError("Saved Python runtime changed; publish a new tool version")
    limits = request["limits"]
    config = wasmtime.Config()
    config.consume_fuel = True
    config.epoch_interruption = True
    engine = wasmtime.Engine(config)
    compile_started = time.monotonic()
    module = wasmtime.Module.from_file(engine, str(module_path))
    compile_ms = round((time.monotonic() - compile_started) * 1000)
    # Only WASI capabilities. No Python/JS host bridge, HTTP, or arbitrary imports.
    if any(item.module != "wasi_snapshot_preview1" for item in module.imports):
        raise RuntimeError("Unexpected host imports in the Python interpreter")
    store = wasmtime.Store(engine)
    store.set_limits(memory_size=limits["memory_bytes"], instances=1, memories=1, tables=1)
    store.set_fuel(limits["fuel"])
    store.set_epoch_deadline(1)
    wasi = wasmtime.WasiConfig()
    payload = json.dumps({"source": request["source"], "input": request["input"],
                          "output_bytes": limits["output_bytes"]}, ensure_ascii=True)
    wasi.argv = ["python", "-I", "-S", "-B", "-X", "utf8", "-c", GUEST, payload]
    wasi.env = []
    # The library filesystem is embedded in the pinned WASM. No host directories
    # are preopened, including the project, temp directory or user's home.
    output = bytearray()
    diagnostic = bytearray()
    overflow = [False]

    def write_output(data: bytes) -> int:
        if len(output) + len(data) > limits["output_bytes"]:
            overflow[0] = True
            engine.increment_epoch()
            return -1
        output.extend(data)
        return len(data)

    def write_error(data: bytes) -> int:
        diagnostic.extend(data[:max(0, 2048 - len(diagnostic))])
        return len(data)

    wasi.stdout_custom = write_output
    wasi.stderr_custom = write_error
    store.set_wasi(wasi)
    linker = wasmtime.Linker(engine)
    linker.define_wasi()
    started = time.monotonic()
    timer = threading.Timer(limits["timeout_ms"] / 1000, engine.increment_epoch)
    timer.daemon = True
    timer.start()
    error = None
    instantiate_ms = guest_ms = None
    guest_started = None
    try:
        instance = linker.instantiate(store, module)
        instantiate_ms = round((time.monotonic() - started) * 1000)
        guest_started = time.monotonic()
        instance.exports(store)["_start"](store)
    except wasmtime.ExitTrap as trap:
        if trap.code != 0:
            error = diagnostic.decode("utf-8", "replace") or f"Python exited with code {trap.code}"
    except (wasmtime.Trap, wasmtime.WasmtimeError) as trap:
        error = str(trap)[:1200]
    finally:
        timer.cancel()
        if guest_started is not None:
            guest_ms = round((time.monotonic() - guest_started) * 1000)
    consumed = {"fuel": limits["fuel"] - store.get_fuel(),
                "input_bytes": len(json.dumps(request["input"], ensure_ascii=False, separators=(",", ":")).encode("utf-8")),
                "output_bytes": len(output), "execution_ms": round((time.monotonic() - started) * 1000),
                "compile_ms": compile_ms, "instantiate_ms": instantiate_ms, "guest_ms": guest_ms}
    if overflow[0]:
        error = "Python output exceeds output_bytes"
    if error:
        return {"ok": False, "error": error, "runtime": runtime, "consumed": consumed}
    # Strict JSON parsing/shape validation also occurs at the trusted Pi boundary.
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
    try:
        module_path = Path(sys.argv[2])
        if sys.argv[1] == "--check":
            print(json.dumps({"ok": True, "runtime": identity(module_path)}))
        elif sys.argv[1] == "--run":
            request = json.loads(sys.stdin.buffer.read(1024 * 1024 + 1))
            print(json.dumps(execute(module_path, request), ensure_ascii=True, allow_nan=False))
        else:
            raise ValueError("Unknown trusted runner mode")
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)[:1200]}))
        sys.exit(1)


if __name__ == "__main__":
    main()
