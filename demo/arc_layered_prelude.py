import ast, builtins, contextlib, io, json, traceback

CHARS = "WwgGcBMPRbSYOrNp"
_H, _T, _S = [], [], {"ns": None}


class Frame:
    def __init__(self, raw, numeric):
        self._grid, self.frames, self._numeric = raw["frames"][-1], raw["frames"], numeric
        self.level, self.step, self.state = raw["level"], raw["step"], raw["state"]
        self.levels_completed, self._seg = raw["levels_completed"], None

    @property
    def grid(self):
        if not self._numeric:
            raise AttributeError("the numeric grid is disabled; use .segmentation or .ascii")
        return self._grid

    @property
    def shape(self):
        return (len(self._grid), len(self._grid[0]) if self._grid else 0)

    @property
    def ascii(self):
        return ascii(self._grid)

    @property
    def segmentation(self):
        if self._seg is None:
            self._seg = segment(self._grid)
        return self._seg

    def __repr__(self):
        return "Frame(level=%s, step=%s, state=%s, shape=%dx%d)" % ((self.level, self.step, self.state) + self.shape)


class HistoryEntry:
    def __init__(self, action, frame):
        self.action, self.frame = action, frame

    def __repr__(self):
        return "HistoryEntry(action=%r, frame=%r)" % (self.action, self.frame)


class Transition:
    def __init__(self, action, before, after, result):
        self.action, self.before_frame, self.after_frame, self.frame, self.result = action, before, after, after, result

    def __repr__(self):
        return "Transition(action=%r, after=%r)" % (self.action, self.after_frame)


def _cells(value):
    return value._grid if isinstance(value, Frame) else value


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
            stack = [(y, x) for y in range(h) for x in (0, w - 1)] + [(y, x) for x in range(w) for y in (0, h - 1)]
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
    return [Frame(dict(entry["raw"], frames=[grid]), entry["frame"]._numeric) for grid in entry["raw"]["frames"]]


def _append(raw, numeric, result=None):
    entry = {"raw": raw, "action": raw["action"], "frame": Frame(raw, numeric)}
    if raw["action"] and _H:
        _T.append(Transition(raw["action"], _H[-1]["frame"], entry["frame"], result or {}))
    _H.append(entry)


def _bind():
    ns = _S["ns"]
    last = _T[-1] if _T else None
    ns.update(current_frame=_H[-1]["frame"], previous_frame=last.before_frame if last else None,
              history=[HistoryEntry(e["action"], e["frame"]) for e in _H], transitions=list(_T), last_transition=last,
              last_action=last.action if last else None, last_action_result=dict(_S["last_result"]),
              valid_actions=list(_S["valid"]), valid_actions_raw=list(_S["valid_raw"]))


def submit_actions(actions, stop_on=None, expect=None, reasoning=None, confirm_full_reset=False):
    items = [actions] if isinstance(actions, (str, dict)) else list(actions)
    lines, executed, reason = [], 0, None
    for item in items:
        call = {"action": item} if isinstance(item, str) else dict(item)
        call["action"] = str(call["action"]).upper()
        if "row" in call:
            call["y"] = call.pop("row")
        if "col" in call:
            call["x"] = call.pop("col")
        if reasoning:
            call["reasoning"] = str(reasoning)
        before = _H[-1]["frame"]
        reply = _rpc({"t": "act", "call": call, "confirm_full_reset": bool(confirm_full_reset), "expect": repr(expect) if expect is not None else None})
        if "stopped" in reply:
            reason = reply["stopped"]
            break
        _S["valid"], _S["valid_raw"], _S["last_result"] = reply["valid_actions"], reply["valid_actions_raw"], reply["result"]
        _append(reply["entry"], _S["numeric"], reply["result"])
        _bind()
        executed += 1
        lines.append(reply["line"])
        if reply.get("halt"):
            reason = reply["halt"]
            break
        after = _H[-1]["frame"]
        if stop_on == "change" and diff(before, after)["count"] or stop_on == "no_change" and not diff(before, after)["count"] \
                or callable(stop_on) and stop_on(before, after):
            reason = "stop_on"
            break
    return {"executed_count": executed, "requested": len(items), "stopped_early": reason is not None, "stop_reason": reason, "lines": lines}


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
    _S.update(valid=req["valid_actions"], valid_raw=req["valid_actions_raw"], last_result=req["last_action_result"], numeric=req["numeric_grid"])
    if req["reset_history"]:
        _H.clear()
        _T.clear()
    for raw in req["new_history"]:
        _append(raw, req["numeric_grid"])
    if _S["ns"] is None or req["reset_namespace"]:
        names = dict(vars(builtins), open=_open)
        _S["ns"] = {"__builtins__": names, "__name__": "__main__", "submit_actions": submit_actions, "segment": segment,
                    "diff": diff, "ascii": ascii, "frames_of": frames_of}
    _bind()
    out, value, error = io.StringIO(), None, None
    try:
        tree = ast.parse(req["code"], "<python>")
        last = tree.body.pop() if tree.body and isinstance(tree.body[-1], ast.Expr) else None
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
            exec(compile(tree, "<python>", "exec"), _S["ns"])
            if last is not None:
                value = eval(compile(ast.Expression(last.value), "<python>", "eval"), _S["ns"])
    except BaseException as problem:
        frames = [f for f in traceback.extract_tb(problem.__traceback__) if f.filename == "<python>"]
        error = "".join(traceback.format_list(frames)) + "%s: %s" % (type(problem).__name__, problem)
    text = out.getvalue()
    if value is not None:
        text += repr(value)
    return {"text": text[:200000], "error": error}


_req = input
while _req is not None:
    _req = _rpc({"t": "done", "result": _cell(_req)})
