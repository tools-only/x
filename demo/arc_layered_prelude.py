import ast, builtins, contextlib, importlib.util, io, json, sys, traceback

CHARS = "WwgGcBMPRbSYOrNp"
MAX_IMAGES = 2
_H, _T, _S = [], [], {"ns": None}


def _freeze(grid):
    return tuple(tuple(int(value) for value in row) for row in grid)


def _grid_hash(grid):
    value = 2166136261
    for row in grid:
        for cell in row:
            value = ((value ^ int(cell)) * 16777619) & 0xffffffff
    return "%08x" % value


class Frame:
    def __init__(self, raw, grids, numeric):
        self._grids, self._numeric = tuple(grids), numeric
        self.level, self.step, self.state = raw["level"], raw["step"], raw["state"]
        self.levels_completed, self._seg = raw["levels_completed"], None

    @property
    def grid(self):
        if not self._numeric:
            raise AttributeError("the numeric grid is disabled; use .segmentation or .ascii")
        return [list(row) for row in self._grids[-1]]

    @property
    def frames(self):
        return [[list(row) for row in grid] for grid in self._grids]

    @property
    def shape(self):
        grid = self._grids[-1]
        return (len(grid), len(grid[0]) if grid else 0)

    @property
    def ascii(self):
        return ascii(self._grids[-1])

    @property
    def segmentation(self):
        if self._seg is None:
            self._seg = segment(self._grids[-1])
        return self._seg

    @property
    def hash(self):
        return _grid_hash(self._grids[-1])

    def __repr__(self):
        return "Frame(level=%s, step=%s, state=%s, shape=%dx%d)" % ((self.level, self.step, self.state) + self.shape)


class HistoryEntry:
    def __init__(self, action, frame, changed, hash):
        self.action, self.frame, self.changed, self.hash = action, frame, changed, hash

    def __repr__(self):
        return "HistoryEntry(action=%r, changed=%r, frame=%r)" % (self.action, self.changed, self.frame)


class Transition:
    def __init__(self, action, before, after, result):
        self.action, self.before_frame, self.after_frame, self.frame, self.result = action, before, after, after, result

    def __repr__(self):
        return "Transition(action=%r, after=%r)" % (self.action, self.after_frame)


def _cells(value):
    return value._grids[-1] if isinstance(value, Frame) else value


def ascii(grid, region=None):
    rows = _cells(grid)
    if region:
        r0, c0, r1, c1 = region
        rows = [row[c0:c1] for row in rows[r0:r1]]
    return "\n".join("".join(CHARS[v] for v in row) for row in rows)


def diff(a, b):
    a, b = _cells(a), _cells(b)
    cells = [(r, c, a[r][c], b[r][c]) for r in range(len(b)) for c in range(len(b[r])) if a[r][c] != b[r][c]]
    if not cells:
        return {"count": 0}
    rows, cols = [x[0] for x in cells], [x[1] for x in cells]
    return {"count": len(cells), "bbox": (min(rows), min(cols), max(rows), max(cols)), "cells": cells[:64]}


def segment(grid):
    grid = _cells(grid)
    h, w = len(grid), len(grid[0]) if grid else 0
    label, comps = [[-1] * w for _ in range(h)], []
    for r in range(h):
        for c in range(w):
            if label[r][c] >= 0:
                continue
            color, stack, cells = grid[r][c], [(r, c)], []
            label[r][c] = len(comps)
            while stack:
                y, x = stack.pop()
                cells.append((y, x))
                for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                    if 0 <= ny < h and 0 <= nx < w and label[ny][nx] < 0 and grid[ny][nx] == color:
                        label[ny][nx] = len(comps)
                        stack.append((ny, nx))
            comps.append((color, cells))
    nodes, adjacency = [], set()
    for r in range(h):
        for c in range(w):
            for ny, nx in ((r + 1, c), (r, c + 1)):
                if ny < h and nx < w and label[ny][nx] != label[r][c]:
                    adjacency.add(tuple(sorted((label[r][c], label[ny][nx]))))
    for i, (color, cells) in enumerate(comps):
        own = set(cells)
        top, left = min(y for y, _ in cells), min(x for _, x in cells)
        edges = {}
        for y, x in cells:
            for inside, a, b in (((y - 1, x) in own, (y, x), (y, x + 1)), ((y, x + 1) in own, (y, x + 1), (y + 1, x + 1)),
                                 ((y + 1, x) in own, (y + 1, x + 1), (y + 1, x)), ((y, x - 1) in own, (y + 1, x), (y, x))):
                if not inside:
                    edges.setdefault(a, []).append(b)
        start = min(edges)
        path, point = [start], edges[start].pop()
        while point != start:
            path.append(point)
            point = edges[point].pop()
        boundary = [list(p) for k, p in enumerate(path)
                    if (p[0] - path[k - 1][0], p[1] - path[k - 1][1]) != (path[(k + 1) % len(path)][0] - p[0], path[(k + 1) % len(path)][1] - p[1])]
        children = []
        ys, xs = [y for y, _ in cells], [x for _, x in cells]
        if max(ys) - top >= 2 and max(xs) - left >= 2:
            seen = [[False] * w for _ in range(h)]
            stack = [(y, x) for y in (h - 1, 0) for x in range(w)] + [(y, x) for x in (w - 1, 0) for y in range(h)]
            while stack:
                y, x = stack.pop()
                if 0 <= y < h and 0 <= x < w and not seen[y][x] and (y, x) not in own:
                    seen[y][x] = True
                    stack.extend(((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)))
            inner = {label[y][x] for y in range(h) for x in range(w) if not seen[y][x] and (y, x) not in own}
            children = sorted(inner)
        shape = tuple(sorted((y - top, x - left) for y, x in cells))
        nodes.append({"id": i, "color": CHARS[color], "hash": "%08x" % (hash((color, shape)) & 0xffffffff),
                      "pixels": len(cells), "boundary": boundary, "children": children})
    return {"nodes": nodes, "adjacency_list": [list(p) for p in sorted(adjacency)]}


def frames_of(step):
    entry = _H[step]
    return [Frame(entry["raw"], [grid], entry["numeric"]) for grid in entry["grids"]]


def show(value=None, region=None, scale=None):
    grid = _cells(value) if value is not None else _H[-1]["grids"][-1]
    if region:
        r0, c0, r1, c1 = region
        grid = [row[c0:c1] for row in grid[r0:r1]]
    if len(_S["images"]) >= MAX_IMAGES:
        raise RuntimeError("show() queues at most %d images per call" % MAX_IMAGES)
    _S["images"].append({"grid": [list(row) for row in grid], "scale": scale})
    return "show: image queued"


class _WorkLoader:
    def __init__(self, name, path, package):
        self.name, self.path, self.package = name, path, package

    def create_module(self, spec):
        return None

    def exec_module(self, module):
        module.__file__ = self.path
        if self.package:
            module.__path__ = ["work/" + self.name.replace(".", "/")]
        exec(compile(_file("read", self.path), self.path, "exec"), module.__dict__)


class _WorkFinder:
    def find_spec(self, name, path=None, target=None):
        if name.startswith("_"):
            return None
        base = name.replace(".", "/")
        for candidate, package in (("work/" + base + ".py", False), ("work/" + base + "/__init__.py", True),
                                   ("work/harness/lib/" + base + ".py", False)):
            try:
                _file("read", candidate)
            except (FileNotFoundError, PermissionError):
                continue
            spec = importlib.util.spec_from_loader(name, _WorkLoader(name, candidate, package), is_package=package)
            if package:
                spec.submodule_search_locations = ["work/" + base]
            return spec
        return None


def _append(raw, numeric, result=None):
    grids = [_freeze(frame) for frame in raw["frames"]]
    previous = _H[-1] if _H else None
    entry = {"raw": raw, "action": raw["action"], "grids": grids, "numeric": numeric,
             "changed": bool(previous) and diff(previous["grids"][-1], grids[-1])["count"] > 0,
             "hash": _grid_hash(grids[-1])}
    if raw["action"] and previous is not None:
        _T.append({"action": raw["action"], "before": previous, "after": entry, "result": result or {}})
    _H.append(entry)


def _frame(entry):
    return Frame(entry["raw"], entry["grids"], entry["numeric"])


def _bind():
    ns = _S["ns"]
    history = [HistoryEntry(e["action"], _frame(e), e["changed"], e["hash"]) for e in _H]
    transitions = [Transition(t["action"], _frame(t["before"]), _frame(t["after"]), dict(t["result"])) for t in _T]
    last = transitions[-1] if transitions else None
    ns.update(current_frame=_frame(_H[-1]), previous_frame=last.before_frame if last else None,
              history=history, transitions=transitions, last_transition=last,
              last_action=last.action if last else None, last_action_result=dict(_S["last_result"]),
              valid_actions=list(_S["valid"]), valid_actions_raw=list(_S["valid_raw"]))


def submit_actions(actions, stop_on=None, expect=None, reasoning=None, confirm_full_reset=False):
    items = [actions] if isinstance(actions, (str, dict)) else list(actions)
    lines, executed, reason, level_changed, reset = [], 0, None, False, False
    for item in items:
        call = {"action": item} if isinstance(item, str) else dict(item)
        call["action"] = str(call["action"]).upper()
        if "row" in call:
            call["y"] = call.pop("row")
        if "col" in call:
            call["x"] = call.pop("col")
        if reasoning:
            call["reasoning"] = str(reasoning)
        before = _H[-1]
        reply = _rpc({"t": "act", "call": call, "confirm_full_reset": bool(confirm_full_reset), "expect": repr(expect) if expect is not None else None})
        if "stopped" in reply:
            reason = reply["stopped"]
            break
        _S["valid"], _S["valid_raw"], _S["last_result"] = reply["valid_actions"], reply["valid_actions_raw"], reply["result"]
        _append(reply["entry"], _S["numeric"], reply["result"])
        _bind()
        executed += 1
        reset = reset or call["action"] == "RESET"
        level_changed = level_changed or _H[-1]["raw"]["levels_completed"] != before["raw"]["levels_completed"]
        lines.append(reply["line"])
        if reply.get("halt"):
            reason = reply["halt"]
            break
        after = _H[-1]
        if stop_on == "change" and diff(before["grids"][-1], after["grids"][-1])["count"] or \
                stop_on == "no_change" and not diff(before["grids"][-1], after["grids"][-1])["count"] or \
                callable(stop_on) and stop_on(_frame(before), _frame(after)):
            reason = "stop_on"
            break
    latest = _H[-1]["raw"]
    summary = {"executed_count": executed, "requested": len(items), "stopped_early": reason is not None,
               "stop_reason": reason, "level": latest["level"], "levels_completed": latest["levels_completed"],
               "win_levels": latest.get("win_levels", 0), "state": latest["state"], "level_changed": level_changed,
               "reset": reset, "valid_actions": list(_S["valid"]), "lines": lines}
    _S["last_result"] = summary
    _bind()
    return summary


def _file(op, path, data=None):
    reply = _rpc({"t": "file", "op": op, "path": str(path), "data": data})
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
    if "r" in mode and "+" not in mode:
        return io.StringIO(_file("read", path))
    initial = ""
    if "a" in mode or "+" in mode:
        with contextlib.suppress(FileNotFoundError):
            initial = _file("read", path)
    return _WorkFile(path, initial)


def _cell(req):
    _S.update(valid=req["valid_actions"], valid_raw=req["valid_actions_raw"],
              last_result=req["last_action_result"], numeric=req["numeric_grid"], images=[])
    if req["reset_history"]:
        _H.clear()
        _T.clear()
    for raw in req["new_history"]:
        _append(raw, req["numeric_grid"])
    if _S["ns"] is None or req["reset_namespace"]:
        names = dict(vars(builtins), open=_open)
        _S["ns"] = {"__builtins__": names, "__name__": "__main__", "submit_actions": submit_actions, "segment": segment,
                    "diff": diff, "ascii": ascii, "show": show, "frames_of": frames_of}
        if not any(isinstance(finder, _WorkFinder) for finder in sys.meta_path):
            sys.meta_path.append(_WorkFinder())
    _bind()
    ns = _S["ns"]
    ns.pop("result", None)
    out, value, error = io.StringIO(), None, None
    try:
        tree = ast.parse(req["code"], "<python>")
        last = tree.body.pop() if tree.body and isinstance(tree.body[-1], ast.Expr) else None
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
            exec(compile(tree, "<python>", "exec"), ns)
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
    return {"text": text[:200000], "error": error, "images": _S["images"][:MAX_IMAGES],
            "last_result": dict(_S["last_result"])}


_req = input
while _req is not None:
    _req = _rpc({"t": "done", "result": _cell(_req)})
