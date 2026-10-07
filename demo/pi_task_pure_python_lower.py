"""Lower a bounded Python expression syntax subset to existing pure JSON IR.

No source is executed. This is a syntax frontend, not Python evaluation:
boolean operators, indexing, arithmetic, range and filtered maps retain native
task-pure-expression-v1 semantics. Native validation and runtime limits remain
required after lowering. CLI input is raw UTF-8 source on stdin; stdout is one
JSON envelope, including on failure.
"""
from __future__ import annotations

import ast
import hashlib
import json
import math
import sys
from typing import Any

FORMAT = "task-pure-python-lower-v1"
IR_FORMAT = "task-pure-expression-v1"
MAX_SOURCE_BYTES = 16 * 1024
MAX_PYTHON_AST_NODES = 4096
MAX_PYTHON_AST_DEPTH = 64
MAX_IR_AST_NODES = 8192
MAX_IR_AST_DEPTH = 64
MAX_IR_JSON_DEPTH = 64
MAX_IR_PROGRAM_BYTES = 256 * 1024
MAX_STRING_CODE_UNITS = 4096
MAX_SAFE_INTEGER = 2**53 - 1
MAX_DIAGNOSTICS = 8
FORBIDDEN_NAMES = frozenset(("__proto__", "prototype", "constructor"))
RESERVED_NAMES = frozenset(("input", "len", "range"))
HARD_LIMITS = {
    "source_bytes": MAX_SOURCE_BYTES,
    "python_ast_nodes": MAX_PYTHON_AST_NODES,
    "python_ast_depth": MAX_PYTHON_AST_DEPTH,
    "ir_ast_nodes": MAX_IR_AST_NODES,
    "ir_ast_depth": MAX_IR_AST_DEPTH,
    "ir_json_depth": MAX_IR_JSON_DEPTH,
    "ir_program_bytes": MAX_IR_PROGRAM_BYTES,
    "string_code_units": MAX_STRING_CODE_UNITS,
    "safe_integer_magnitude": MAX_SAFE_INTEGER,
}


class LoweringError(ValueError):
    def __init__(self, code: str, message: str, node: ast.AST | None = None):
        super().__init__(message)
        self.code = code
        self.message = message[:240]
        self.line = getattr(node, "lineno", None)
        offset = getattr(node, "col_offset", None)
        self.column = offset + 1 if offset is not None else None
        self.diagnostics: list[dict[str, Any]] | None = None
        self.omitted_diagnostics = 0

    def envelope(self) -> dict[str, Any]:
        error = {"code": self.code, "message": self.message}
        if self.line is not None:
            error.update(line=self.line, column=self.column)
        result = {"format": FORMAT, "ok": False, "error": error}
        if self.diagnostics is not None:
            result.update(errors=self.diagnostics, omitted_errors=self.omitted_diagnostics)
        return result


def _fail(code: str, message: str, node: ast.AST | None = None) -> None:
    raise LoweringError(code, message, node)


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def _string(value: str, node: ast.AST) -> str:
    try:
        value.encode("utf-8")
    except UnicodeEncodeError:
        _fail("invalid_literal", "strings must contain Unicode scalar values", node)
    if len(value.encode("utf-16-le")) // 2 > MAX_STRING_CODE_UNITS:
        _fail("limit_exceeded", "string code-unit limit exceeded", node)
    return value


def _name(value: str, node: ast.AST, *, binding: bool = False) -> str:
    _string(value, node)
    if not value or value in FORBIDDEN_NAMES:
        _fail("invalid_name", "forbidden lexical name", node)
    if binding and value in RESERVED_NAMES:
        _fail("invalid_name", "input, len and range cannot be locally bound", node)
    return value


def _literal(value: Any, node: ast.AST) -> dict[str, Any]:
    if value is None or type(value) is bool:
        pass
    elif type(value) is int:
        if abs(value) > MAX_SAFE_INTEGER:
            _fail("invalid_literal", "integer is outside the JavaScript safe range", node)
    elif type(value) is float:
        if not math.isfinite(value):
            _fail("invalid_literal", "numbers must be finite", node)
    elif type(value) is str:
        _string(value, node)
    else:
        _fail("invalid_literal", "only JSON scalar constants are supported", node)
    return {"op": "literal", "value": value}


def _python_usage(tree: ast.AST) -> tuple[int, int]:
    count = deepest = 0
    pending = [(tree, 1)]
    while pending:
        node, depth = pending.pop()
        count += 1
        deepest = max(deepest, depth)
        if count > MAX_PYTHON_AST_NODES or depth > MAX_PYTHON_AST_DEPTH:
            _fail("limit_exceeded", "Python AST node/depth limit exceeded", node)
        pending.extend((child, depth + 1) for child in ast.iter_child_nodes(node))
    return count, deepest


def _ir_children(node: dict[str, Any]) -> list[dict[str, Any]]:
    op = node["op"]
    if op in ("input", "literal", "var"):
        return []
    if op == "object":
        return [field["value"] for field in node["fields"]]
    if op == "array":
        return node["items"]
    keys = {
        "let": ("value", "body"), "get": ("value", "key"),
        "index": ("array", "index"), "not": ("value",),
        "length": ("value",), "if": ("condition", "then", "else"),
        "range": ("start", "stop"), "map": ("array", "body"),
        "filter": ("array", "predicate"),
    }.get(op, ("left", "right"))
    return [node[key] for key in keys]


def _free_ir_variables(expression: dict[str, Any]) -> set[str]:
    """Find outer lexical reads, avoiding capture by sequential native lets."""
    free: set[str] = set()
    pending = [(expression, frozenset())]
    while pending:
        node, bound = pending.pop()
        op = node["op"]
        if op == "var":
            if node["name"] not in bound:
                free.add(node["name"])
        elif op == "let":
            pending.append((node["value"], bound))
            pending.append((node["body"], bound | {node["name"]}))
        elif op in ("map", "filter"):
            pending.append((node["array"], bound))
            pending.append((node["body" if op == "map" else "predicate"], bound | {node["as"]}))
        else:
            pending.extend((child, bound) for child in _ir_children(node))
    return free


def _ir_usage(expression: dict[str, Any]) -> tuple[int, int]:
    count = deepest = 0
    pending = [(expression, 1)]
    while pending:
        node, depth = pending.pop()
        count += 1
        deepest = max(deepest, depth)
        if count > MAX_IR_AST_NODES or depth > MAX_IR_AST_DEPTH:
            _fail("limit_exceeded", "lowered IR node/depth limit exceeded")
        pending.extend((child, depth + 1) for child in _ir_children(node))
    return count, deepest


def _json_depth(value: Any) -> int:
    deepest = 0
    pending = [(value, 1)]
    while pending:
        item, depth = pending.pop()
        deepest = max(deepest, depth)
        if depth > MAX_IR_JSON_DEPTH:
            _fail("limit_exceeded", "lowered IR JSON depth limit exceeded")
        children = item.values() if isinstance(item, dict) else item if isinstance(item, list) else ()
        pending.extend((child, depth + 1) for child in children)
    return deepest


class _Lowerer:
    def __init__(self, tree: ast.AST):
        self.names = {node.id for node in ast.walk(tree) if isinstance(node, ast.Name)}
        self.names.update(node.arg for node in ast.walk(tree) if isinstance(node, ast.arg))
        self.counter = 0

    def fresh_name(self) -> str:
        while True:
            self.counter += 1
            name = f"__pure_py_{self.counter}"
            if name not in self.names:
                self.names.add(name)
                return name

    @staticmethod
    def binary(op: str, values: list[dict[str, Any]]) -> dict[str, Any]:
        result = values[0]
        for right in values[1:]:
            result = {"op": op, "left": result, "right": right}
        return result

    def lower(self, node: ast.AST, environment: dict[str, str]) -> dict[str, Any]:
        if isinstance(node, ast.Expression):
            return self.lower(node.body, environment)
        if isinstance(node, ast.Constant):
            return _literal(node.value, node)
        if isinstance(node, ast.Name):
            name = _name(node.id, node)
            if name == "input":
                return {"op": "input"}
            if name not in environment:
                _fail("invalid_name", "undeclared lexical variable", node)
            return {"op": "var", "name": environment[name]}
        if isinstance(node, ast.List):
            return {"op": "array", "items": [self.lower(item, environment) for item in node.elts]}
        if isinstance(node, ast.Dict):
            fields = []
            keys: set[str] = set()
            for key, value in zip(node.keys, node.values):
                if not isinstance(key, ast.Constant) or type(key.value) is not str:
                    _fail("unsupported_syntax", "object keys must be literal strings; unpacking is unsupported", node)
                name = _string(key.value, key)
                if name in FORBIDDEN_NAMES or name in keys:
                    _fail("invalid_literal", "forbidden or duplicate object key", key)
                keys.add(name)
                fields.append({"key": name, "value": self.lower(value, environment)})
            return {"op": "object", "fields": fields}
        if isinstance(node, ast.Subscript):
            value = self.lower(node.value, environment)
            if isinstance(node.slice, ast.Constant) and type(node.slice.value) is str:
                if node.slice.value in FORBIDDEN_NAMES:
                    _fail("invalid_literal", "forbidden object access key", node.slice)
                return {"op": "get", "value": value, "key": _literal(node.slice.value, node.slice)}
            return {"op": "index", "array": value, "index": self.lower(node.slice, environment)}
        if isinstance(node, ast.BinOp):
            op = {ast.Add: "add", ast.Sub: "subtract", ast.Mult: "multiply"}.get(type(node.op))
            if op is not None:
                return {"op": op, "left": self.lower(node.left, environment), "right": self.lower(node.right, environment)}
        if isinstance(node, ast.UnaryOp):
            if isinstance(node.op, ast.Not):
                return {"op": "not", "value": self.lower(node.operand, environment)}
            if isinstance(node.op, (ast.UAdd, ast.USub)):
                if isinstance(node.operand, ast.Constant) and type(node.operand.value) in (int, float):
                    value = node.operand.value if isinstance(node.op, ast.UAdd) else -node.operand.value
                    return _literal(value, node)
                return {"op": "add" if isinstance(node.op, ast.UAdd) else "subtract",
                    "left": {"op": "literal", "value": 0}, "right": self.lower(node.operand, environment)}
        if isinstance(node, ast.Compare):
            if len(node.ops) != 1:
                _fail("unsupported_syntax", "chained comparisons are unsupported", node)
            op = {ast.Eq: "eq", ast.Lt: "lt", ast.LtE: "lte"}.get(type(node.ops[0]))
            if op is not None:
                return {"op": op, "left": self.lower(node.left, environment), "right": self.lower(node.comparators[0], environment)}
        if isinstance(node, ast.BoolOp):
            op = "and" if isinstance(node.op, ast.And) else "or" if isinstance(node.op, ast.Or) else None
            if op is not None:
                return self.binary(op, [self.lower(value, environment) for value in node.values])
        if isinstance(node, ast.IfExp):
            return {"op": "if", "condition": self.lower(node.test, environment),
                "then": self.lower(node.body, environment), "else": self.lower(node.orelse, environment)}
        if isinstance(node, ast.ListComp):
            if len(node.generators) != 1:
                _fail("unsupported_syntax", "only one comprehension generator is supported", node)
            generator = node.generators[0]
            if generator.is_async or not isinstance(generator.target, ast.Name):
                _fail("unsupported_syntax", "comprehensions require one simple synchronous lexical target", node)
            name = _name(generator.target.id, generator.target, binding=True)
            array = self.lower(generator.iter, environment)
            inner = {**environment, name: name}
            if generator.ifs:
                predicate = self.binary("and", [self.lower(condition, inner) for condition in generator.ifs])
                array = {"op": "filter", "array": array, "as": name, "predicate": predicate}
            return {"op": "map", "array": array, "as": name, "body": self.lower(node.elt, inner)}
        if isinstance(node, ast.Call):
            if node.keywords or any(isinstance(arg, ast.Starred) for arg in node.args):
                _fail("unsupported_syntax", "call keywords and starred arguments are unsupported", node)
            if isinstance(node.func, ast.Lambda):
                arguments = node.func.args
                if (arguments.posonlyargs or arguments.kwonlyargs or arguments.vararg or arguments.kwarg
                        or arguments.defaults or arguments.kw_defaults or len(arguments.args) != len(node.args)):
                    _fail("unsupported_syntax", "immediate lambdas require matching simple positional arguments", node)
                names = [_name(parameter.arg, parameter, binding=True) for parameter in arguments.args]
                if len(set(names)) != len(names):
                    _fail("invalid_name", "duplicate lambda parameter", node)
                values = [self.lower(argument, environment) for argument in node.args]
                free = [_free_ir_variables(value) for value in values]
                emitted = [self.fresh_name() if any(name in item for item in free[index + 1:]) else name
                    for index, name in enumerate(names)]
                body = self.lower(node.func.body, {**environment, **dict(zip(names, emitted))})
                for name, value in reversed(list(zip(emitted, values))):
                    body = {"op": "let", "name": name, "value": value, "body": body}
                return body
            if isinstance(node.func, ast.Name) and node.func.id in ("len", "range"):
                if node.func.id in environment:
                    _fail("invalid_name", "call whitelist cannot be locally overridden", node.func)
                if node.func.id == "len" and len(node.args) == 1:
                    return {"op": "length", "value": self.lower(node.args[0], environment)}
                if node.func.id == "range" and len(node.args) in (1, 2):
                    return {"op": "range",
                        "start": self.lower(node.args[0], environment) if len(node.args) == 2 else {"op": "literal", "value": 0},
                        "stop": self.lower(node.args[-1], environment)}
                _fail("unsupported_syntax", "len takes one argument; range takes one or two", node)
            _fail("unsupported_syntax", "only len, range and immediately applied lambdas may be called", node)
        _fail("unsupported_syntax", f"unsupported syntax: {type(node).__name__}", node)


class _DiagnosticLowerer(_Lowerer):
    """Failure-only traversal with the real lexical rules; never emits usable IR."""
    def __init__(self, tree: ast.AST):
        super().__init__(tree)
        self.errors: list[dict[str, Any]] = []
        self.seen: set[tuple[str, str]] = set()
        self.omitted = 0

    def lower(self, node: ast.AST, environment: dict[str, str]) -> dict[str, Any]:
        try:
            return super().lower(node, environment)
        except LoweringError as failure:
            message = failure.message
            if isinstance(node, ast.Name) and message == "undeclared lexical variable":
                message = f"undeclared lexical variable: {node.id}"[:240]
            key = (failure.code, message)
            if key not in self.seen:
                self.seen.add(key)
                if len(self.errors) < MAX_DIAGNOSTICS:
                    item = failure.envelope()['error']
                    item['message'] = message
                    self.errors.append(item)
                else:
                    self.omitted += 1
            # Rejected containers/operators can hide independent errors. Check
            # only expressions whose lexical environment is unchanged here.
            children: list[ast.AST] = []
            if isinstance(node, (ast.Tuple, ast.Set)):
                children = list(node.elts)
            elif isinstance(node, ast.BinOp):
                children = [node.left, node.right]
            elif isinstance(node, ast.Compare):
                children = [node.left, *node.comparators]
            elif isinstance(node, ast.Call):
                children = list(node.args)
            for child in children:
                self.lower(child, environment)
            # This placeholder only permits further diagnostics. The strict
            # error is always raised; this tree is never returned or cached.
            return {"op": "literal", "value": None}


def lower_source(source: str) -> dict[str, Any]:
    """Return bounded IR plus static metadata, or raise LoweringError."""
    if not isinstance(source, str):
        _fail("invalid_source", "source must be a string")
    try:
        source_bytes = source.encode("utf-8")
    except UnicodeEncodeError:
        _fail("invalid_source", "source must be valid UTF-8")
    if not source_bytes or len(source_bytes) > MAX_SOURCE_BYTES:
        _fail("limit_exceeded", "source must contain 1..16384 UTF-8 bytes")
    try:
        tree = ast.parse(source, mode="eval")
    except (SyntaxError, ValueError) as error:
        failure = LoweringError("syntax_error", "source is not a valid expression")
        if isinstance(error, SyntaxError):
            failure.line, failure.column = error.lineno, error.offset
        raise failure from None
    except (MemoryError, RecursionError):
        _fail("limit_exceeded", "source parser resource limit exceeded")
    python_nodes, python_depth = _python_usage(tree)
    try:
        expression = _Lowerer(tree).lower(tree, {})
    except LoweringError as failure:
        diagnostic = _DiagnosticLowerer(tree)
        diagnostic.lower(tree, {})
        failure.diagnostics = diagnostic.errors
        failure.omitted_diagnostics = diagnostic.omitted
        raise
    ir_nodes, ir_depth = _ir_usage(expression)
    program = {"format": IR_FORMAT, "limits": {}, "expression": expression}
    json_depth = _json_depth(program)
    expression_bytes = len(_json(expression).encode("utf-8"))
    program_bytes = len(_json(program).encode("utf-8"))
    if program_bytes > MAX_IR_PROGRAM_BYTES:
        _fail("limit_exceeded", "lowered IR byte limit exceeded")
    return {
        "format": FORMAT, "ok": True, "expression": expression,
        "source_info": {"syntax": "python-expression-subset-v1", "python_version": ".".join(map(str, sys.version_info[:3])),
            "source_sha256": hashlib.sha256(source_bytes).hexdigest(),
            "source_bytes": len(source_bytes), "python_ast_nodes": python_nodes, "python_ast_depth": python_depth},
        "static_usage": {"ast_nodes": ir_nodes, "ast_depth": ir_depth,
            "expression_bytes": expression_bytes, "program_bytes": program_bytes, "json_depth": json_depth},
        "hard_limits": dict(HARD_LIMITS),
    }


def main() -> int:
    try:
        if len(sys.argv) != 1:
            _fail("invalid_source", "source must be supplied on stdin without arguments")
        data = sys.stdin.buffer.read(MAX_SOURCE_BYTES + 1)
        if len(data) > MAX_SOURCE_BYTES:
            _fail("limit_exceeded", "source byte limit exceeded")
        try:
            source = data.decode("utf-8")
        except UnicodeDecodeError:
            _fail("invalid_source", "source must be valid UTF-8")
        result = lower_source(source)
        exit_code = 0
    except LoweringError as error:
        result, exit_code = error.envelope(), 1
    except (MemoryError, RecursionError):
        result, exit_code = LoweringError("limit_exceeded", "lowerer resource limit exceeded").envelope(), 1
    except Exception:
        result, exit_code = LoweringError("lowering_failed", "expression lowering failed").envelope(), 1
    sys.stdout.buffer.write((_json(result) + "\n").encode("utf-8"))
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
