"""Trusted native CPython runner. Authored source runs in a fresh guest subprocess with the host's full
library ecosystem (site-packages included); boundaries are a compute timeout and the JSON output budget."""
from __future__ import annotations

import hashlib
import json
import platform
from pathlib import Path
import subprocess
import sys
import time

# No -S: the guest keeps site-packages, so numpy and friends work when installed in the host environment.
GUEST_FLAGS = ["-I", "-B", "-X", "utf8"]

# This wrapper is evaluated by the guest subprocess, never by the host interpreter.
# Capturing the last expression is the tool's return convention, not a dialect.
GUEST = r'''
import ast, contextlib, json, sys

class DiscardText:
    def write(self, text): return len(text)
    def flush(self): pass

request = json.loads(sys.stdin.buffer.read())
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


def identity(module_path: Path | None = None) -> dict:
    # Field names are kept for saved-tool compatibility; "native" marks the non-WASM runtime.
    return {"python_version": platform.python_version(), "wasmtime_version": "native",
            "module_sha256": "native",
            "runner_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}


def execute(module_path: Path | None, request: dict) -> dict:
    runtime = identity(module_path)
    if request.get("runtime") != runtime:
        raise RuntimeError("Saved Python runtime changed; publish a new tool version")
    limits = request["limits"]
    payload = json.dumps({"source": request["source"], "input": request["input"],
                          "output_bytes": limits["output_bytes"]}, ensure_ascii=True).encode("ascii")
    started = time.monotonic()
    error = None
    output = b""
    try:
        completed = subprocess.run([sys.executable, *GUEST_FLAGS, "-c", GUEST], input=payload,
                                   capture_output=True, timeout=limits["timeout_ms"] / 1000)
        output = completed.stdout
        if completed.returncode != 0:
            error = (completed.stderr.decode("utf-8", "replace")[:1200]
                     or f"Python exited with code {completed.returncode}")
    except subprocess.TimeoutExpired:
        error = "Python calculation exceeded timeout_ms"
    guest_ms = round((time.monotonic() - started) * 1000)
    consumed = {"fuel": 0,
                "input_bytes": len(json.dumps(request["input"], ensure_ascii=False, separators=(",", ":")).encode("utf-8")),
                "output_bytes": len(output), "execution_ms": guest_ms,
                "compile_ms": 0, "instantiate_ms": 0, "guest_ms": guest_ms}
    if error is None and len(output) > limits["output_bytes"]:
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
        module_path = Path(sys.argv[2]) if len(sys.argv) > 2 else None
        if sys.argv[1] == "--check":
            print(json.dumps({"ok": True, "runtime": identity(module_path)}))
        elif sys.argv[1] == "--run":
            # The request carries the guest source plus its input (input_bytes up to 512K, binaries as base64),
            # so the transport cap sits above the guest's own input ceiling, not below it.
            request = json.loads(sys.stdin.buffer.read(8 * 1024 * 1024 + 1))
            print(json.dumps(execute(module_path, request), ensure_ascii=True, allow_nan=False))
        else:
            raise ValueError("Unknown trusted runner mode")
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)[:1200]}))
        sys.exit(1)


if __name__ == "__main__":
    main()
