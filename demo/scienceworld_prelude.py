"""Text-domain session prelude for ScienceWorld.

One native CPython kernel per run.  The guest exposes a small, text-first
surface to the model: current/previous observations, an action list, and
``submit_actions`` which asks the host (the TypeScript layered adapter) to call
the ScienceWorld bridge.  The same ``@tool`` publishing and ``Memory.verify``
contract used by the ARC prelude is kept, but without any grid/colour/mouse
machinery.
"""

import ast
import builtins
import contextlib
import hashlib
import io
import os
import re
import sys
import traceback
import types

_H, _T, _S = [], [], {"ns": None, "tries": {}, "seen": set(), "deaths": []}


def _obs_text(entry):
    return "\n".join((
        "TASK: " + str(entry.get("task_description") or ""),
        "OBS: " + str(entry.get("observation") or ""),
        "LOOK: " + str(entry.get("look") or ""),
        "INV: " + str(entry.get("inventory") or ""),
        "SCORE: " + str(entry.get("score") or 0),
    ))


def _obs_hash(entry):
    return hashlib.sha256(_obs_text(entry).encode("utf-8")).hexdigest()[:16]


class Obs:
    """One text observation; the model-facing 'frame'."""

    def __init__(self, entry):
        self.text = _obs_text(entry)
        self.observation = entry.get("observation", "")
        self.look = entry.get("look", "")
        self.inventory = entry.get("inventory", "")
        self.task_description = entry.get("task_description", "")
        self.score = entry.get("score", 0)
        self.level = entry.get("level", 1)
        self.step = entry.get("step", 0)
        self.state = entry.get("state", "NOT_FINISHED")
        self.levels_completed = entry.get("levels_completed", 0)

    def __repr__(self):
        return "Obs(level=%s, step=%s, state=%s, score=%s, text=%d chars)" % (
            self.level, self.step, self.state, self.score, len(self.text))


class HistoryEntry:
    def __init__(self, action, obs, changed, hash):
        self.action, self.obs, self.changed, self.hash = action, obs, changed, hash

    def __repr__(self):
        return "HistoryEntry(action=%r, changed=%r)" % (self.action, self.changed)


class Transition:
    def __init__(self, action, before, after, result):
        self.action, self.before_obs, self.after_obs, self.frame, self.result = action, before, after, after, result

    def __repr__(self):
        return "Transition(action=%r, after=%r)" % (self.action, self.after_obs)


class _CallableToolModule(types.ModuleType):
    def __init__(self, name, entry_name):
        super().__init__(name)
        self._entry_name = entry_name

    def __call__(self, *args, **kwargs):
        entry = self.__dict__.get(self._entry_name) or self.__dict__.get("run")
        if callable(entry):
            return entry(*args, **kwargs)
        raise TypeError("'%s' module is not callable" % self.__name__)


_LIVE_KEYS = ("current_obs", "previous_obs", "history", "transitions", "last_transition",
              "last_action", "last_action_result", "valid_actions", "harness_state")


def _live_globals():
    ns = _S.get("ns") or {}
    return {k: ns[k] for k in _LIVE_KEYS if k in ns}


def _wrap_lib_module(lib_name, module):
    path = "work/lib/%s.py" % lib_name
    for attr, obj in list(module.__dict__.items()):
        if attr.startswith("_") or not isinstance(obj, types.FunctionType):
            continue
        if getattr(getattr(obj, "__code__", None), "co_filename", None) != path:
            continue
        def _make_wrapper(fn, name):
            def _wrapped(*args, **kwargs):
                _S["called_lib"] = name
                _S.setdefault("used_libs", set()).add(name)
                return fn(*args, **kwargs)
            _wrapped.__name__ = fn.__name__
            _wrapped.__doc__ = fn.__doc__
            _wrapped.__module__ = fn.__module__
            return _wrapped
        module.__dict__[attr] = _make_wrapper(obj, lib_name)
    return module


def _obs(entry):
    return Obs(entry)


def _append(raw, result=None):
    previous = _H[-1] if _H else None
    entry = {"raw": raw, "action": raw.get("action") or "",
             "observation": raw.get("observation") or "", "look": raw.get("look") or "",
             "inventory": raw.get("inventory") or "", "task_description": raw.get("task_description") or "",
             "score": raw.get("score") or 0, "level": raw.get("level", 1), "step": raw.get("step", 0),
             "state": raw.get("state", "NOT_FINISHED"), "levels_completed": raw.get("levels_completed", 0),
             "win_levels": raw.get("win_levels", 0)}
    entry["changed"] = bool(previous) and _obs_hash(entry) != _obs_hash(previous)
    entry["hash"] = _obs_hash(entry)
    if entry["action"] and previous is not None:
        _T.append({"action": entry["action"], "before": previous, "after": entry, "result": result or {}})
    _H.append(entry)


def _bind():
    ns = _S["ns"]
    history = [HistoryEntry(e["action"], _obs(e), e["changed"], e["hash"]) for e in _H]
    transitions = [Transition(t["action"], _obs(t["before"]), _obs(t["after"]), dict(t["result"])) for t in _T]
    last = transitions[-1] if transitions else None
    harness = dict(_S.get("harness") or {})
    live = dict(current_obs=_obs(_H[-1]), previous_obs=last.before_obs if last else None,
                history=history, transitions=transitions, last_transition=last,
                last_action=last.action if last else None, last_action_result=dict(_S["last_result"]),
                valid_actions=list(_S["valid"]), harness_state=harness)
    ns.update(live)
    for entry in (_S.get("lib") or {}).values():
        mod = entry.get("module")
        if mod is not None:
            mod.__dict__.update(live)


def filter_actions(substr=None):
    actions = list(_S["valid"])
    if substr is None:
        return actions
    needle = str(substr).lower()
    return [a for a in actions if needle in str(a).lower()]


def obs_diff(a=None, b=None):
    if b is None:
        b = _obs(_H[-1])
    if a is None:
        if len(_H) < 2:
            return {"changed": 0, "note": "no previous observation"}
        a = _obs(_H[-2])
    ta = a.text if isinstance(a, Obs) else str(a)
    tb = b.text if isinstance(b, Obs) else str(b)
    if ta == tb:
        return {"changed": 0}
    before_lines = ta.splitlines()
    after_lines = tb.splitlines()
    added = [line for line in after_lines if line not in before_lines]
    removed = [line for line in before_lines if line not in after_lines]
    return {"changed": 1, "added": added[:20], "removed": removed[:20],
            "added_count": len(added), "removed_count": len(removed)}


def submit_actions(actions, stop_on=None, reasoning=None, confirm_full_reset=False, force=False):
    if _S.get("forbid_actions"):
        raise PermissionError("submit_actions is disabled during evolution review; inspect state/transitions or define @tool helpers only")
    items = [actions] if isinstance(actions, (str, dict)) else list(actions)
    if items and _H and _H[-1]["raw"].get("state") == "GAME_OVER":
        first = items[0]
        first_name = str(first if isinstance(first, str) else dict(first).get("action", "")).upper()
        if first_name != "RESET":
            raise RuntimeError("the game is over: only RESET works now")
    lines, executed, reason, level_changed, reset = [], 0, None, False, False
    for item in items:
        call = {"action": item} if isinstance(item, str) else dict(item)
        call["action"] = str(call["action"])
        if reasoning:
            call["reasoning"] = str(reasoning)
        before = _H[-1]
        label = call["action"]
        reply = _rpc({"t": "act", "call": call, "confirm_full_reset": bool(confirm_full_reset)})
        if "stopped" in reply:
            reason = reply["stopped"]
            break
        _S["valid"], _S["last_result"] = reply["valid_actions"], reply["result"]
        _append(reply["entry"], reply["result"])
        _bind()
        executed += 1
        reset = reset or call["action"].upper() == "RESET"
        level_changed = level_changed or _H[-1]["raw"]["levels_completed"] != before["raw"]["levels_completed"]
        lines.append(reply["line"])
        fact = _observe(before, reply["result"])
        lines[-1] += _echo(fact)
        if reply.get("halt"):
            reason = reply["halt"]
            break
        after = _H[-1]
        if stop_on == "change" and after["changed"] or \
                stop_on == "no_change" and not after["changed"] or \
                callable(stop_on) and stop_on(_obs(before), _obs(after)):
            reason = "stop_on"
            break
        if not force and call["action"].upper() == "RESET":
            pass
    latest = _H[-1]["raw"]
    summary = {"executed_count": executed, "requested": len(items), "stopped_early": reason is not None,
               "stop_reason": reason, "level": latest["level"], "levels_completed": latest["levels_completed"],
               "win_levels": latest.get("win_levels", 0), "state": latest["state"], "level_changed": level_changed,
               "reset": reset, "valid_actions": list(_S["valid"]), "lines": lines}
    _S["last_result"] = summary
    _bind()
    return summary


def _ledger(t):
    before, after = t["before"]["hash"], t["after"]["hash"]
    seen = _S["seen"]
    seen.add(before)
    prev = _S["tries"].setdefault((before, t["action"]), [])
    step = t["after"]["raw"]["step"]
    fact = {"step": step, "action": t["action"], "tries": len(prev),
            "same": bool(prev) and all(a == after for _, a in prev),
            "last_try": prev[-1][0] if prev else None, "new": after not in seen}
    prev.append((step, after))
    seen.add(after)
    fact["death"] = t["after"]["raw"]["state"] == "GAME_OVER" and t["before"]["raw"]["state"] != "GAME_OVER"
    if fact["death"]:
        mark = (before, t["action"])
        fact["same_death"] = next((s for m, s in _S["deaths"] if m == mark), None)
        _S["deaths"].append((mark, step))
    else:
        fact["same_death"] = None
    fact["level_up"] = t["after"]["raw"]["levels_completed"] != t["before"]["raw"]["levels_completed"]
    fact["changed"] = t["after"]["changed"]
    fact["level"] = t["after"]["raw"]["level"]
    fact["source"] = None
    return fact


def _observe(before, result):
    t = _T[-1]
    fact = _ledger(t)
    _S.setdefault("steps", []).append(fact)
    return fact


def _echo(fact):
    out = ""
    if fact["tries"]:
        out += "  [tried %d time%s before with same result]" % (fact["tries"], "s" if fact["tries"] > 1 else "")
    if fact["death"]:
        out += "  [death%s]" % ("; repeats the death at step %d" % fact["same_death"] if fact["same_death"] is not None else "")
    if fact["level_up"]:
        out += "  [level complete]"
    return out


def _note(text):
    notes = _S.setdefault("notes", [])
    if text not in notes:
        notes.append(text)


def _doc(text):
    return (text or "").strip().split("\n")[0][:120]


def _load(path, source):
    mod_name = path[5:-3].replace("/", ".")
    if path.startswith("work/lib/") and path.endswith(".py"):
        module = _CallableToolModule(mod_name, path[9:-3])
    else:
        module = types.ModuleType(mod_name)
    module.__file__ = path
    module.__dict__.update(_live_globals())
    exec(compile(source, path, "exec"), module.__dict__)
    return module


def _file(op, path, data=None):
    req = {"t": "file", "op": op, "path": str(path), "data": data}
    reply = _rpc(req)
    if "error" in reply:
        raise (FileNotFoundError if reply.get("missing") else PermissionError)(reply["error"])
    return reply.get("data")


class _WorkFile(io.StringIO):
    def __init__(self, path, initial):
        super().__init__()
        self._path = path
        self.write(initial)

    def close(self):
        if not self.closed:
            data = self.getvalue()
            super().close()
            _file("write", self._path, data)


def _open(path, mode="r", *args, **kwargs):
    if "b" in mode:
        raise ValueError("work/ supports text files only")
    clean = str(path).replace("\\", "/").lstrip("./")
    if "r" in mode and "+" not in mode:
        return io.StringIO(_file("read", path))
    initial = ""
    if "a" in mode or "+" in mode:
        with contextlib.suppress(FileNotFoundError):
            initial = _file("read", path)
    return _WorkFile(path, initial)


def _extract_decorated_tools(tree, code):
    imports = []
    for stmt in tree.body:
        if isinstance(stmt, (ast.Import, ast.ImportFrom)):
            seg = ast.get_source_segment(code, stmt)
            if seg:
                imports.append(seg)
    header = ("\n".join(imports) + "\n\n") if imports else ""
    out = []
    for node in tree.body:
        if not isinstance(node, ast.FunctionDef):
            continue
        if not any(isinstance(d, ast.Name) and d.id == "tool" for d in node.decorator_list):
            continue
        if not re.match(r"^[a-z][a-z0-9_]{0,40}$", node.name):
            raise ValueError("@tool function name must be lowercase letters, digits or underscore: %r" % node.name)
        a = node.args
        if a.posonlyargs or a.vararg or a.kwonlyargs or a.kwarg or len(a.args) > 1:
            raise ValueError("@tool function '%s' must accept 0 or 1 argument" % node.name)
        seg = ast.get_source_segment(code, node)
        if not seg:
            raise ValueError("could not extract source for @tool function '%s'" % node.name)
        other_decs = []
        for d in node.decorator_list:
            if isinstance(d, ast.Name) and d.id == "tool":
                continue
            dseg = ast.get_source_segment(code, d)
            if dseg:
                other_decs.append("@" + dseg)
        prefix = header + ("\n".join(other_decs) + "\n" if other_decs else "")
        out.append((node.name, prefix + seg + "\n"))
    return out


def tool(fn):
    return fn


def _judge_memory(cid, entry, t):
    if entry.get("code") is None:
        return None
    tr = Transition(t["action"], _obs(t["before"]), _obs(t["after"]), dict(t["result"]))
    env = {"__builtins__": _S["ns"]["__builtins__"], "t": tr, "before": tr.before_obs,
           "after": tr.after_obs, "action": tr.action, "score": tr.result.get("score")}
    try:
        verdict = eval(entry["code"], env)
    except BaseException as exc:
        entry["stats"]["error"] = "%s: %s" % (type(exc).__name__, exc)
        return None
    if verdict is True or verdict is False:
        stats = entry["stats"]
        stats["checked"] += 1
        level = str(t["after"]["raw"]["level"])
        per_level = stats.setdefault("by_level", {}).setdefault(level, {"support": 0, "counter": 0, "checked": 0})
        per_level["checked"] += 1
        if verdict:
            stats["support"] += 1
            per_level["support"] += 1
        else:
            stats["counter"] += 1
            per_level["counter"] += 1
            stats["witness"] = "L%s s%s %s" % (level, t["after"]["raw"]["step"], t["action"])
        return bool(verdict)
    return None


def _sync_memory(checks, force_rebacktest=False):
    store = _S.setdefault("memory_checks", {})
    supplied = set()
    for item in checks or []:
        cid, expr = str(item["id"]), str(item["expr"])
        supplied.add(cid)
        cur = store.get(cid)
        if cur is not None and cur["expr"] == expr and not force_rebacktest:
            continue
        stats = {"support": 0, "counter": 0, "checked": 0, "by_level": {}, "witness": None, "error": None}
        try:
            compiled = compile(expr, "memory_verify/%s" % cid, "eval")
        except BaseException as exc:
            stats["error"] = "%s: %s" % (type(exc).__name__, exc)
            store[cid] = {"expr": expr, "code": None, "stats": stats}
            continue
        entry = {"expr": expr, "code": compiled, "stats": stats}
        for t in _T:
            _judge_memory(cid, entry, t)
        store[cid] = entry
    for cid in list(store):
        if cid not in supplied:
            del store[cid]


def _cell(req):
    _S.update(valid=list(req.get("valid_actions") or []), last_result=req.get("last_action_result") or {},
              forbid_actions=bool(req.get("forbid_actions")), harness=req.get("harness_state") or {})
    if req.get("reset_history"):
        _H.clear()
        _T.clear()
    results = list(req.get("transition_results") or [])
    action_entries = sum(1 for raw in req.get("new_history") or [] if raw.get("action"))
    result_idx = max(0, len(results) - action_entries)
    for raw in req.get("new_history") or []:
        res = None
        if raw.get("action") and result_idx < len(results):
            res = results[result_idx]
            result_idx += 1
        _append(raw, res)
    fresh = _S["ns"] is None
    if fresh:
        names = dict(vars(builtins), open=_open)
        _S["ns"] = {"__builtins__": names, "__name__": "__main__", "submit_actions": submit_actions,
                    "filter_actions": filter_actions, "obs_diff": obs_diff, "tool": tool}
    _bind()
    ns = _S["ns"]
    if "memory_checks" in req:
        _sync_memory(req.get("memory_checks") or [], force_rebacktest=bool(req.get("reset_history")))
    if req.get("sync_only"):
        return {"text": "", "error": None, "last_result": dict(_S["last_result"]), "steps": [],
                "notes": _S.pop("notes", []),
                "memory_checks": {cid: dict(item["stats"]) for cid, item in (_S.get("memory_checks") or {}).items()},
                "decorated_tools": []}
    ns.pop("result", None)
    out, value, error = io.StringIO(), None, None
    _S["called_lib"] = None
    _S["used_libs"] = set()
    decorated, mounted_decorated = [], []
    try:
        tree = ast.parse(req["code"], "<python>")
        decorated = _extract_decorated_tools(tree, req["code"])
        last = tree.body.pop() if tree.body and isinstance(tree.body[-1], ast.Expr) else None
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
            exec(compile(tree, "<python>", "exec"), ns)
            for name, source in decorated:
                _file("write", "work/lib/%s.py" % name, source)
                mod = _wrap_lib_module(name, _load("work/lib/%s.py" % name, source))
                _S.setdefault("lib", {})[name] = {"source": source, "module": mod, "error": None,
                                                   "doc": _doc(mod.__doc__ or getattr(mod.__dict__.get(name), "__doc__", None))}
                ns[name] = sys.modules[name] = mod
                mounted_decorated.append(name)
                _note("@tool mounted: %s" % name)
            if last is not None:
                value = eval(compile(ast.Expression(last.value), "<python>", "eval"), ns)
            if ns.get("result") is not None:
                value = ns["result"]
    except BaseException as problem:
        frames = [f for f in traceback.extract_tb(problem.__traceback__) if f.filename == "<python>"]
        error = "".join(traceback.format_list(frames)) + "%s: %s" % (type(problem).__name__, problem)
    text = out.getvalue()
    if value is not None:
        shown = value if isinstance(value, str) else repr(value)
        text += ("" if not text or text.endswith("\n") else "\n") + shown
    text = text + ("\n" + "\n".join(_S.get("notes") or []) if _S.get("notes") else "")
    return {"text": text[:200000], "error": error, "last_result": dict(_S["last_result"]),
            "steps": _S.pop("steps", []), "notes": _S.pop("notes", []),
            "memory_checks": {cid: dict(item["stats"]) for cid, item in (_S.get("memory_checks") or {}).items()},
            "decorated_tools": mounted_decorated,
            "used_libs": sorted(_S.pop("used_libs", set())),
            "lib": {name: {"doc": e["doc"], "error": e["error"]} for name, e in (_S.get("lib") or {}).items()}}


_req = input
while _req is not None:
    _req = _rpc({"t": "done", "result": _cell(_req)})
