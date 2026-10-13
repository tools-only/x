/** Sandbox guest shared by thin-harness skills and the evidence board. */
import { TASK_PYTHON_FORMAT, taskPythonLimits, taskPythonRuntimeIdentity, type ValidatedTaskPythonProgram } from "./pi_task_python.ts";
import { ARC_SKILL_FOUNDATION_PYTHON, ARC_SKILL_FOUNDATION_VERSION } from "./arc_agi_3_official_adapter.ts";

/**
 * Constant guest program. The skill source travels as input data and is
 * compiled as "<skill>", so reported line numbers match the source as saved.
 * The shared task-python runtime is not modified.
 */
export const SKILL_GUEST = String.raw`import json

_req = input
_ns = {"__name__": "skill"}

_foundation = _req.get("_foundation")
if _foundation == "${ARC_SKILL_FOUNDATION_VERSION}":
    exec(_req.get("_foundation_source") or "", _ns)


def _where(error, source):
    lines = source.splitlines()
    if isinstance(error, SyntaxError):
        return "line %s: %s" % (error.lineno, (error.text or "").rstrip())
    found = []
    tb = error.__traceback__
    while tb is not None:
        code = tb.tb_frame.f_code
        if code.co_filename == "<skill>":
            number = tb.tb_lineno
            text = lines[number - 1].strip() if 0 < number <= len(lines) else ""
            found.append("line %s in %s: %s" % (number, code.co_name, text))
        tb = tb.tb_next
    return "\n".join(found[-4:])


class _History:
    """Earlier transitions of this run. Action numbers start at 1; grid(n) is the grid after action n, grid(0) before the first."""

    def __init__(self, raw):
        self._rows = [_Transition(t) if isinstance(t, dict) else t for t in (raw.get("transitions") or [])]
        self.base_n = raw.get("base_n")
        self._base = raw.get("base_grid")
        self._deltas = raw.get("deltas") or {}

    def __len__(self):
        return len(self._rows)

    def __iter__(self):
        return iter(self._rows)

    def transitions(self, action=None, since=None, until=None):
        # Rows support both t['action'] (the documented form) and t.action,
        # so a small syntax mismatch does not consume a whole Skill revision.
        return [t for t in self._rows if (action is None or t["action"] == action)
                and (since is None or t["n"] >= since) and (until is None or t["n"] <= until)]

    def find(self, test):
        return [t for t in self._rows if test(t)]

    def grid(self, n):
        if self._base is None or n < self.base_n or n > len(self._rows):
            raise ValueError("history.grid(%s): grids are available for %s..%s" % (
                n, "none" if self._base is None else self.base_n, len(self._rows)))
        grid = [row[:] for row in self._base]
        for step in range(self.base_n + 1, n + 1):
            for x, y, _before, after in self._deltas[str(step)]:
                grid[y][x] = after
        return grid

    def upto(self, n):
        """The history as it stood after action n: later transitions and grids are not in the copy."""
        view = _History({})
        view._rows = [t for t in self._rows if t["n"] <= n]
        view.base_n = self.base_n
        view._base = self._base if self.base_n is not None and self.base_n <= n else None
        view._deltas = {k: v for k, v in self._deltas.items() if int(k) <= n}
        return view


class _Transition(dict):
    """A transition keeps the documented mapping API and tolerates attr-style reads."""

    def __getattr__(self, name):
        try:
            return self[name]
        except KeyError:
            raise AttributeError(name)


def _jsonable(value, depth=0):
    # A result that Python can build but JSON cannot carry (tuple keys, sets, tuples) is converted, not refused:
    # in a real run a Counter keyed by (x, y) cost the agent a whole get/set/run loop to repair.
    if depth > 40:
        return str(value)
    if isinstance(value, dict):
        converted = {}
        for k, v in value.items():
            if not isinstance(k, str):
                _warnings.append("non-string dict keys were converted to JSON strings")
                k = json.dumps(_jsonable(k, depth + 1))
            converted[k] = _jsonable(v, depth + 1)
        return converted
    if isinstance(value, (list, tuple, set, frozenset)):
        if isinstance(value, (tuple, set, frozenset)):
            _warnings.append("tuple/set result values were converted to JSON arrays")
        items = sorted(value, key=repr) if isinstance(value, (set, frozenset)) else value
        return [_jsonable(v, depth + 1) for v in items]
    if isinstance(value, float) and value != value:
        return None
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


_warnings = []


def _frozen(grid):
    return tuple(tuple(row) for row in grid) if grid is not None else None


def _claims(req):
    """Run each claim's check(t) on the transitions given. t holds what the environment reported for one action and
    the grids before and after it (read-only tuples). A check returns True (holds), False (fails) or None (does not
    apply); anything else, or an exception, is an error for that transition. Nothing else is interpreted."""
    checks = []
    for claim in req.get("claims") or []:
        ns = {"__name__": "claim"}
        if _foundation == "${ARC_SKILL_FOUNDATION_VERSION}":
            exec(_req.get("_foundation_source") or "", ns)
        try:
            exec(compile(claim["source"], "<skill>", "exec"), ns)
            if not callable(ns.get("check")):
                raise ValueError("a check must define check(t)")
            checks.append((claim, ns["check"], None))
        except BaseException as error:
            checks.append((claim, None, (type(error).__name__ + ": " + str(error))[:300] + " " + _where(error, claim["source"])))
    meta = req.get("transitions") or {}
    out = {claim["key"]: {"results": [], "error": error} for claim, _fn, error in checks}
    for segment in req.get("segments") or []:
        prev = segment["grid"]
        for step in segment["steps"]:
            if step.get("grid") is not None:
                cur = step["grid"]
            else:
                cur = [row[:] for row in prev]
                for x, y, _before, after in step.get("delta") or []:
                    cur[y][x] = after
            t = _Transition(dict(meta.get(str(step["n"])) or {}, n=step["n"], before=_frozen(prev), after=_frozen(cur)))
            for claim, fn, _error in checks:
                if fn is None:
                    continue
                try:
                    value = fn(t)
                    if value is True or value is False or value is None:
                        out[claim["key"]]["results"].append([step["n"], value])
                    else:
                        out[claim["key"]]["results"].append([step["n"], "error", "check returned %s, not True/False/None" % type(value).__name__])
                except BaseException as error:
                    out[claim["key"]]["results"].append([step["n"], "error", ((type(error).__name__ + ": " + str(error))[:160] + " " + _where(error, claim["source"])).strip()])
            prev = cur
    return out


def _exec(req):
    """One-off code: runs once and is not saved. Available names: state, history, grid, prev_grid, artifacts and
    skill(name, **args) for saved skills. Returns what was printed and the value of a final expression."""
    import ast, io, contextlib
    state = req.get("state") or {}
    if isinstance(state.get("history"), dict):
        state["history"] = _History(state["history"])
    sources = req.get("skills") or {}
    loaded = {}

    def skill(name, **args):
        if name not in sources:
            raise KeyError("no saved skill %r; saved: %s" % (name, ", ".join(sorted(sources)) or "none"))
        if name not in loaded:
            ns = {"__name__": "skill_" + name}
            if _foundation == "${ARC_SKILL_FOUNDATION_VERSION}":
                exec(_req.get("_foundation_source") or "", ns)
            exec(compile(sources[name], "<saved skill %s>" % name, "exec"), ns)
            loaded[name] = ns["run"]
        return loaded[name](state, args)

    # The native python session runs code in the shared namespace itself, so what it defines can be checkpointed.
    ns = _ns if req.get("session_ns") else dict(_ns)
    ns.update({"state": state, "history": state.get("history"), "grid": state.get("grid"), "prev_grid": state.get("prev_grid"),
               "artifacts": state.get("artifacts") or {}, "skill": skill})
    if req.get('native_env'):
        ns['env']._namespace = ns
    tree = ast.parse(req["code"], "<skill>", "exec")
    last = tree.body.pop() if tree.body and isinstance(tree.body[-1], ast.Expr) else None
    buffer = io.StringIO()
    value = None
    with contextlib.redirect_stdout(buffer):
        exec(compile(tree, "<skill>", "exec"), ns)
        if last is not None:
            value = eval(compile(ast.Expression(last.value), "<skill>", "eval"), ns)
    return {"stdout": buffer.getvalue(), "value": _jsonable(value), "has_value": last is not None}


_src = _req.get("source") or _req.get("code") or ""
try:
    if _req["mode"] == "claims":
        result = {"ok": True, "value": _claims(_req)}
    elif _req["mode"] == "exec":
        result = {"ok": True, "value": _exec(_req)}
        if _warnings:
            result["warnings"] = list(dict.fromkeys(_warnings))
    else:
        _code = compile(_req["source"], "<skill>", "exec")
        exec(_code, _ns)
        if not callable(_ns.get("run")):
            raise ValueError("source must define run(state, args)")
    if _req["mode"] in ("claims", "exec"):
        pass
    elif _req["mode"] == "check":
        result = {"ok": True}
    elif _req["mode"] == "backtest":
        # Replay a model skill on recorded transitions. Each case sees only what existed before its action:
        # the grids up to n-1, the history up to n-1 and the action itself, never the outcome or later moves.
        # The agent's memory is not passed: today's memory may already contain the answer.
        _full = _History(_req["history"])
        # Artifacts as they stood before each case's action: the latest value that took effect at state n-1 or earlier.
        _art_history = _req.get("artifact_history") or {}
        _out = []
        for _case in _req["cases"]:
            _n = _case["n"]
            try:
                _view = _full.upto(_n - 1)
                _arts = {}
                for _name, _values in _art_history.items():
                    _known = [_v for _k, _v in _values if _k <= _n - 1]
                    if _known:
                        _arts[_name] = _known[-1]
                _state = {
                    "grid": _view.grid(_n - 1),
                    "prev_grid": _view.grid(_n - 2) if _n >= 2 and _full.base_n is not None and _n - 2 >= _full.base_n else None,
                    "history": _view, "proposed_action": _case["proposed_action"],
                    "recent_actions": _case.get("recent_actions") or [], "available_actions": _case.get("available_actions") or [],
                    "state": _case.get("state"), "levels_completed": _case.get("levels_completed"),
                    "memory": {}, "hypotheses": {}, "strategies": {}, "artifacts": _arts, "artifact_info": {},
                }
                _value = _jsonable(_ns["run"](_state, {}))
                _text = json.dumps(_value, allow_nan=False)
                _out.append({"n": _n, "ok": True, "value": _value} if len(_text) <= 4000
                            else {"n": _n, "ok": False, "error": "prediction larger than 4000 characters"})
            except BaseException as _case_error:
                _out.append({"n": _n, "ok": False, "error": (type(_case_error).__name__ + ": " + str(_case_error))[:200],
                             "where": _where(_case_error, _req["source"])})
        result = {"ok": True, "value": _out}
    else:
        _state = _req["state"]
        if isinstance(_state, dict) and isinstance(_state.get("history"), dict):
            _state["history"] = _History(_state["history"])
        _value = _jsonable(_ns["run"](_state, _req["args"]))
        json.dumps(_value, allow_nan=False)
        result = {"ok": True, "value": _value}
        if _warnings:
            result["warnings"] = list(dict.fromkeys(_warnings))
except BaseException as _error:
    result = {"ok": False, "error": (type(_error).__name__ + ": " + str(_error))[:600], "where": _where(_error, _src)}
`;

export const SKILL_LIMITS = { input_bytes: 384 * 1024, output_bytes: 64 * 1024, fuel: 4_000_000_000, timeout_ms: 20_000 };

export type GuestResult = { ok: true; value?: unknown; warnings?: string[] } | { ok: false; error: string; where?: string };

export function skillGuestProgram(limits: Record<string, number> = SKILL_LIMITS): ValidatedTaskPythonProgram {
	return { format: TASK_PYTHON_FORMAT, source: SKILL_GUEST, limits, effective_limits: taskPythonLimits(limits),
		runtime: taskPythonRuntimeIdentity() };
}

/** ARC adapter variant: the Skill may opt into low-level explicit-coordinate
 * helpers through the `arc` object. Generic task Skills never receive it. */
export function arcSkillGuestProgram(limits: Record<string, number> = SKILL_LIMITS): ValidatedTaskPythonProgram {
	const source = SKILL_GUEST.replace(
		'_foundation_source = _req.get("_foundation_source")',
		`_foundation_source = ${JSON.stringify(ARC_SKILL_FOUNDATION_PYTHON)}`,
	);
	return { format: TASK_PYTHON_FORMAT, source, limits, effective_limits: taskPythonLimits(limits),
		runtime: taskPythonRuntimeIdentity() };
}

export const arcSkillFoundation = { version: ARC_SKILL_FOUNDATION_VERSION, source: ARC_SKILL_FOUNDATION_PYTHON };

export const guestFailure = (result: Extract<GuestResult, { ok: false }>) =>
	result.error + (result.where ? `\n${result.where}` : "");
