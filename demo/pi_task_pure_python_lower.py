"""Compatibility filename: validate ordinary CPython syntax, without lowering."""
from __future__ import annotations
import ast
import json
import sys


def main() -> None:
    try:
        source = sys.stdin.buffer.read(16 * 1024 + 1).decode("utf-8")
        if len(source.encode("utf-8")) > 16 * 1024:
            raise ValueError("source exceeds 16KiB")
        # Parsing/compilation never executes the authored source. No node allowlist.
        tree = ast.parse(source, filename="<task-tool>", feature_version=(3, 12))
        compile(tree, "<task-tool>", "exec")
        result = {"ok": True, "source_info": {"python_version": sys.version.split()[0]}}
    except SyntaxError as error:
        result = {"ok": False, "errors": [{"message": error.msg,
            "line": error.lineno, "column": error.offset}]}
    except (ValueError, UnicodeError, RecursionError, MemoryError) as error:
        result = {"ok": False, "errors": [{"message": str(error)[:240]}]}
    print(json.dumps(result, ensure_ascii=True))
    if not result["ok"]: sys.exit(1)


if __name__ == "__main__":
    main()
