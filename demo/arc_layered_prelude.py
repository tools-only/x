import ast, builtins, contextlib, importlib.util, io, json, os, re, sys, traceback, types

CHARS = "WwgGcBMPRbSYOrNp"
MAX_IMAGES = 2
_H, _T, _S = [], [], {"ns": None, "tries": {}, "seen": set(), "deaths": [], "mouse_tries": {}}


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
    def shape(self):
        grid = self._grids[-1]
        return (len(grid), len(grid[0]) if grid else 0)

    @property
    def ascii(self):
        return _Ascii(self._grids[-1])

    @property
    def segmentation(self):
        if self._seg is None:
            self._seg = segment(self._grids[-1])
        return self._seg

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


class _CallableToolModule(types.ModuleType):
    def __init__(self, name, entry_name):
        super().__init__(name)
        self._entry_name = entry_name

    def __call__(self, *args, **kwargs):
        entry = self.__dict__.get(self._entry_name) or self.__dict__.get("run")
        if callable(entry):
            return entry(*args, **kwargs)
        raise TypeError("'%s' module is not callable" % self.__name__)


_LIVE_KEYS = ("current_frame", "previous_frame", "history", "transitions", "last_transition",
              "last_action", "last_action_result", "valid_actions", "harness_state")


def _live_globals():
    ns = _S.get("ns") or {}
    return {k: ns[k] for k in _LIVE_KEYS if k in ns}


def _branch_label(action):
    if isinstance(action, dict):
        name = str(action.get("action", "")).upper()
        if name == "MOUSE" and type(action.get("x")) is int and type(action.get("y")) is int:
            return "MOUSE(x=%s,y=%s)" % (action["x"], action["y"])
        return name if name != "MOUSE" else None
    if isinstance(action, str):
        match = re.fullmatch(r"MOUSE\(x\s*=\s*(\d+)\s*,\s*y\s*=\s*(\d+)\)", action, re.I)
        return "MOUSE(x=%s,y=%s)" % (int(match.group(1)), int(match.group(2))) if match else action
    return None


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
                if not _S.get("parent_readonly_tools"):
                    return fn(*args, **kwargs)
                previous = _S["forbid_actions"]
                _S["forbid_actions"] = True
                try:
                    value = fn(*args, **kwargs)
                    candidates = value.get("recommended_actions") if isinstance(value, dict) else None
                    if not isinstance(candidates, list) or not candidates:
                        candidates = [value.get("branch_action")] if isinstance(value, dict) else []
                    labels = [_branch_label(item) for item in candidates]
                    action = labels[0] if labels else None
                    if isinstance(action, str) and (action in _S["valid"] or
                            ("MOUSE" in _S["valid"] and re.fullmatch(r"MOUSE\(x=\d+,y=\d+\)", action))):
                        frame = _H[-1]
                        _S["branch_probe"] = (name, labels, 0, frame["raw"]["level"], frame["hash"], tuple(_S["valid"]))
                    return value
                finally:
                    _S["forbid_actions"] = previous
            _wrapped.__name__ = fn.__name__
            _wrapped.__doc__ = fn.__doc__
            _wrapped.__module__ = fn.__module__
            _wrapped.__wrapped__ = fn
            return _wrapped
        module.__dict__[attr] = _make_wrapper(obj, lib_name)
    return module


def _sync_work(req, rebuild=False):
    ns = _S["ns"]
    libs = _S.setdefault("lib", {})
    sources = {item["name"]: item["source"] for item in req.get("lib") or []}
    libs_changed = sources != {name: item["source"] for name, item in libs.items()}
    if libs_changed:
        for name, module in list(sys.modules.items()):
            if str(getattr(module, "__file__", "")).startswith("work/lib/"):
                sys.modules.pop(name)
        for name, item in libs.items():
            if ns.get(name) is item["module"]:
                ns.pop(name, None)
        libs.clear()
        for item in req.get("lib") or []:
            name = item["name"]
            entry = {"source": item["source"], "module": None, "error": None, "doc": ""}
            try:
                mod = _wrap_lib_module(name, _load("work/lib/%s.py" % name, item["source"]))
                entry["module"] = ns[name] = sys.modules[name] = mod
                entry["doc"] = _doc(mod.__doc__ or getattr(mod.__dict__.get(name), "__doc__", None))
                _note("loaded lib/%s as `%s`%s" % (name, name, ": " + entry["doc"] if entry["doc"] else ""))
            except BaseException as exc:
                entry["error"] = "%s: %s" % (type(exc).__name__, exc)
                _note("lib/%s failed to load: %s" % (name, entry["error"]))
            libs[name] = entry
    store = _S.setdefault("claims", {})
    for claim in req.get("claims") or []:
        cur = store.get(claim["name"])
        if cur is not None and cur["source"] == claim["source"] and not libs_changed:
            continue
        fresh_claim = cur is None or cur.get("source") != claim["source"] or libs_changed
        if cur is not None and fresh_claim:
            _S.setdefault("claim_reset", set()).add(claim["name"])
        name, entry = claim["name"], {"source": claim["source"], "fn": None, "error": None, "doc": ""}
        try:
            mod = _load("work/claims/%s.py" % name, claim["source"])
            if callable(getattr(mod, "check", None)):
                entry.update(fn=mod.check, doc=_doc(mod.__doc__ or mod.check.__doc__))
            else:
                entry["error"] = "defines no callable check(transition)"
        except BaseException as exc:
            entry["error"] = "%s: %s" % (type(exc).__name__, exc)
        store[name] = entry
        if entry["error"]:
            _note("claims/%s failed to load: %s" % (name, entry["error"]))
        elif fresh_claim:
            verdicts = [_judge_claim(name, entry, t) for t in _T]
            _note("loaded claims/%s (back-test on %d transitions: applied %d, held %d, failed %d)" % (
                name, len(verdicts), sum(v is not None for v in verdicts), verdicts.count(True), verdicts.count(False)))
    supplied = {claim["name"] for claim in req.get("claims") or []}
    for name in list(store):
        if name not in supplied:
            del store[name]
    model = _S.setdefault("model", {"source": None})
    model_source = req.get("model_source")
    if model_source != model["source"] or libs_changed:
        _S["model"] = model = {"source": model_source}
        rebuild = True
        if model_source:
            try:
                _S["model_module"] = mod = _load("work/model.py", model_source)
                model.update({name: getattr(mod, name) for name in ("state_key", "predict", "is_fatal")
                              if callable(getattr(mod, name, None))})
                tested = correct = 0
                by_level = {}
                if "predict" in model:
                    for transition in _T:
                        forecast = _forecast(transition["before"], transition["action"])
                        if "predict" not in forecast:
                            continue
                        off = _off(forecast["predict"], transition["after"]["grids"][-1], transition["before"]["grids"][-1])
                        if off is not None:
                            tested += 1
                            correct += off == 0
                            level = str(transition["before"]["raw"]["level"])
                            row = by_level.setdefault(level, {"tested": 0, "correct": 0})
                            row["tested"] += 1
                            row["correct"] += off == 0
                    model["tested"], model["correct"], model["by_level"] = tested, correct, by_level
                _note("loaded model.py (%s)%s" % (", ".join(name for name in ("state_key", "predict", "is_fatal") if name in model)
                     or "defines none of state_key, predict, is_fatal",
                     "; back-test on %d transitions: %d accurate" % (tested, correct) if "predict" in model else ""))
            except BaseException as exc:
                model["error"] = "%s: %s" % (type(exc).__name__, exc)
                _note("model.py failed to load: %s" % model["error"])
    if model.get("source") and not model.get("error"):
        ns["model"] = _S["model_module"]
    else:
        ns.pop("model", None)
    if rebuild:
        _rebuild()



def _cells(value):
    return value._grids[-1] if isinstance(value, Frame) else value


def ascii(grid, region=None):
    rows = _cells(grid)
    if region:
        r0, c0, r1, c1 = region
        rows = [row[c0:c1] for row in rows[r0:r1]]
    return "\n".join("".join(CHARS[v] for v in row) for row in rows)


class _Ascii(str):
    """The `.ascii` attribute is the full board string, and calling it crops: `.ascii(region=(r0, c0, r1, c1))`."""

    def __new__(cls, grid):
        value = str.__new__(cls, ascii(grid))
        value._grid = grid
        return value

    def __call__(self, region=None):
        return ascii(self._grid, region)


def diff(a, b):
    a, b = _cells(a), _cells(b)
    cells = [(r, c, a[r][c], b[r][c]) for r in range(len(b)) for c in range(len(b[r])) if a[r][c] != b[r][c]]
    if not cells:
        return {"count": 0}
    rows, cols = [x[0] for x in cells], [x[1] for x in cells]
    return {"count": len(cells), "bbox": (min(rows), min(cols), max(rows), max(cols)), "cells": cells[:64]}


def _interior(grid, border=4):
    h, w = len(grid), len(grid[0]) if grid else 0
    if h <= 2 * border or w <= 2 * border:
        return grid
    return [row[border:w - border] for row in grid[border:h - border]]


def gameplay_changed(a, b, border=4):
    """True when the interior board (excluding a `border`-cell frame, where HUDs and counters live) changed."""
    return diff(_interior(_cells(a), border), _interior(_cells(b), border))["count"] > 0


def _transient(grids):
    count = 0
    first, last = grids[0], grids[-1]
    for r in range(len(last)):
        for c in range(len(last[r])):
            if any(g[r][c] != first[r][c] and g[r][c] != last[r][c] for g in grids[1:-1]):
                count += 1
    return count


def anim_summary(step=-1):
    """Compact summary of an action's frame sequence: net diff, transient bbox, and peak frame-to-frame jumps."""
    entry = _H[step]
    grids = entry["grids"]
    n = len(grids)
    if n <= 1:
        return {"step": entry["raw"]["step"], "n_frames": n, "note": "single frame, no animation"}
    first, last = grids[0], grids[-1]
    net = diff(first, last)
    net_summary = {"count": net["count"], **({"bbox": net["bbox"]} if "bbox" in net else {})}
    color_deltas = {}
    for r in range(len(last)):
        for c in range(len(last[r])):
            if first[r][c] != last[r][c]:
                a_ch, b_ch = CHARS[first[r][c]], CHARS[last[r][c]]
                color_deltas[a_ch] = color_deltas.get(a_ch, 0) - 1
                color_deltas[b_ch] = color_deltas.get(b_ch, 0) + 1
    color_deltas = {k: v for k, v in color_deltas.items() if v != 0}
    tr_rows, tr_cols, tr_count = [], [], 0
    for r in range(len(last)):
        for c in range(len(last[r])):
            if any(g[r][c] != first[r][c] and g[r][c] != last[r][c] for g in grids[1:-1]):
                tr_count += 1
                tr_rows.append(r)
                tr_cols.append(c)
    deltas = []
    for i in range(n - 1):
        d = diff(grids[i], grids[i + 1])
        if d["count"] > 0:
            deltas.append({"from": i, "to": i + 1, "count": d["count"], "bbox": d["bbox"]})
    peaks = sorted(deltas, key=lambda x: x["count"], reverse=True)[:3]
    return {
        "step": entry["raw"]["step"],
        "n_frames": n,
        "net_diff": net_summary,
        "color_deltas": color_deltas,
        "transient_cells": tr_count,
        "transient_bbox": (min(tr_rows), min(tr_cols), max(tr_rows), max(tr_cols)) if tr_count else None,
        "nonzero_jumps": len(deltas),
        "peak_jumps": peaks,
    }


def frame_diff(a=None, b=None):
    """Object-level changes between two frames (default: previous_frame -> current_frame). Heuristic: touching
    objects merge into one component and similar objects can be matched ambiguously."""
    if b is None:
        b = _frame(_H[-1])
    if a is None:
        if len(_H) < 2:
            return {"changed_cells": 0, "note": "no previous frame"}
        a = _frame(_H[-2])
    ga, gb = _cells(a), _cells(b)

    def index(grid):
        table = {}
        for node in segment(grid)["nodes"]:
            anchor = tuple(node["boundary"][0]) if node["boundary"] else (0, 0)
            table.setdefault((node["color"], node["hash"]), []).append((anchor, node["pixels"]))
        return table

    ta, tb = index(ga), index(gb)
    moved, appeared, disappeared = [], [], []
    for key in set(ta) | set(tb):
        pa = sorted(ta.get(key, []))
        pb = sorted(tb.get(key, []))
        if pa == pb:
            continue
        gone = [item for item in pa if item not in pb]
        fresh = [item for item in pb if item not in pa]
        if len(gone) == 1 and len(fresh) == 1:
            moved.append({"color": key[0], "pixels": gone[0][1], "from": gone[0][0], "to": fresh[0][0]})
        else:
            disappeared.extend({"color": key[0], "pixels": item[1], "at": item[0]} for item in gone)
            appeared.extend({"color": key[0], "pixels": item[1], "at": item[0]} for item in fresh)
    return {"changed_cells": diff(ga, gb)["count"], "moved": moved[:16],
            "appeared": appeared[:16], "disappeared": disappeared[:16]}


_SEG_CACHE = {}


def segment(grid):
    raw_cells = _cells(grid)
    key = tuple(tuple(int(v) for v in row) for row in raw_cells)
    cached = _SEG_CACHE.get(key)
    if cached is not None:
        return {"nodes": [dict(n) for n in cached["nodes"]],
                "adjacency_list": [list(p) for p in cached["adjacency_list"]]}
    grid = key
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
        ys, xs = [y for y, _ in cells], [x for _, x in cells]
        top, bottom, left, right = min(ys), max(ys), min(xs), max(xs)
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
        if bottom - top >= 2 and right - left >= 2:
            r0, r1 = max(0, top - 1), min(h - 1, bottom + 1)
            c0, c1 = max(0, left - 1), min(w - 1, right + 1)
            bh, bw = r1 - r0 + 1, c1 - c0 + 1
            seen = bytearray(bh * bw)
            stack = []
            for x in range(c0, c1 + 1):
                for y in (r0, r1):
                    if label[y][x] != i and not seen[(y - r0) * bw + (x - c0)]:
                        seen[(y - r0) * bw + (x - c0)] = 1
                        stack.append((y, x))
            for y in range(r0 + 1, r1):
                for x in (c0, c1):
                    if label[y][x] != i and not seen[(y - r0) * bw + (x - c0)]:
                        seen[(y - r0) * bw + (x - c0)] = 1
                        stack.append((y, x))
            while stack:
                y, x = stack.pop()
                for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                    if r0 <= ny <= r1 and c0 <= nx <= c1 and label[ny][nx] != i:
                        idx = (ny - r0) * bw + (nx - c0)
                        if not seen[idx]:
                            seen[idx] = 1
                            stack.append((ny, nx))
            inner = {label[y][x] for y in range(top, bottom + 1) for x in range(left, right + 1)
                     if label[y][x] != i and not seen[(y - r0) * bw + (x - c0)]}
            children = sorted(inner)
        shape = tuple(sorted((y - top, x - left) for y, x in cells))
        nodes.append({"id": i, "color": CHARS[color], "hash": "%08x" % (hash((color, shape)) & 0xffffffff),
                      "pixels": len(cells), "boundary": boundary, "children": children})
    res = {"nodes": nodes, "adjacency_list": [list(p) for p in sorted(adjacency)]}
    if len(_SEG_CACHE) >= 32:
        _SEG_CACHE.clear()
    _SEG_CACHE[key] = res
    return {"nodes": [dict(n) for n in nodes], "adjacency_list": [list(p) for p in res["adjacency_list"]]}


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


def _edges():
    edges, reps = {}, {}
    for t in _T:
        reps.setdefault(t["before"]["hash"], t["before"])
        reps.setdefault(t["after"]["hash"], t["after"])
        edges.setdefault(t["before"]["hash"], {})[t["action"]] = t["after"]["hash"]
    if _H:
        reps.setdefault(_H[-1]["hash"], _H[-1])
    return edges, reps


def _call_of(label):
    if label.startswith("MOUSE("):
        parts = dict(piece.split("=") for piece in label[6:-1].split(","))
        return {"action": "MOUSE", "x": int(parts["x"]), "y": int(parts["y"])}
    return label


def graph_summary():
    edges, reps = _edges()
    moves = [name for name in _S["valid"] if name != "RESET"]
    frontier = [h for h in reps if set(moves) - set(edges.get(h, {}))]
    return {"states": len(reps), "edges": sum(len(out) for out in edges.values()),
            "frontier_count": len(frontier), "frontier": frontier[:20], "current": _H[-1]["hash"]}


def _bfs(stop):
    edges, reps = _edges()
    start = _H[-1]["hash"]
    seen, queue = {start: []}, [start]
    while queue:
        here = queue.pop(0)
        if stop(here, reps):
            return [_call_of(label) for label in seen[here]]
        for label, there in edges.get(here, {}).items():
            if there not in seen:
                seen[there] = seen[here] + [label]
                queue.append(there)
    return None


def bfs_graph(goal):
    return _bfs(lambda h, reps: bool(goal(_frame(reps[h]))))


def replay_to(target_hash):
    return _bfs(lambda h, reps: h == target_hash)


def _expect_ok(expect, before, after, result):
    if callable(expect):
        try:
            return bool(expect(_frame(before), _frame(after)))
        except Exception:
            return False
    if isinstance(expect, int) and not isinstance(expect, bool):
        return after["raw"]["levels_completed"] - before["raw"]["levels_completed"] == expect
    lo, hi = expect
    return lo <= result.get("changed_cells", 0) <= hi


def _is_vacuous_expect(expect):
    return (isinstance(expect, (tuple, list)) and len(expect) == 2
            and isinstance(expect[0], (int, float)) and isinstance(expect[1], (int, float))
            and expect[0] <= 0 and expect[1] >= 50)


class _WorkLoader:
    def __init__(self, name, path, package):
        self.name, self.path, self.package = name, path, package

    def create_module(self, spec):
        return None

    def exec_module(self, module):
        module.__file__ = self.path
        if self.package:
            module.__path__ = ["work/" + self.name.replace(".", "/")]
        module.__dict__.update(_API)
        module.__dict__.update(_live_globals())
        exec(compile(_file("read", self.path), self.path, "exec"), module.__dict__)


class _WorkFinder:
    def find_spec(self, name, path=None, target=None):
        if name.startswith("_"):
            return None
        base = name.replace(".", "/")
        for candidate, package in (("work/" + base + ".py", False), ("work/" + base + "/__init__.py", True),
                                   ("work/lib/" + base + ".py", False), ("work/harness/lib/" + base + ".py", False)):
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
    harness = dict(_S.get("harness") or {})
    live = dict(current_frame=_frame(_H[-1]), previous_frame=last.before_frame if last else None,
                history=history, transitions=transitions, last_transition=last,
                last_action=last.action if last else None, last_action_result=dict(_S["last_result"]),
                valid_actions=list(_S["valid"]), harness_state=harness)
    ns.update(live)
    for entry in (_S.get("lib") or {}).values():
        mod = entry.get("module")
        if mod is not None:
            mod.__dict__.update(live)
    for mod in list(sys.modules.values()):
        if str(getattr(mod, "__file__", "")).startswith("work/lib/"):
            mod.__dict__.update(live)


def submit_actions(actions, stop_on=None, expect=None, reasoning=None, confirm_full_reset=False,
                   skip_known_noops=False, force=False, stop_on_noop=True):
    if _S.get("forbid_actions"):
        raise PermissionError("submit_actions is disabled during evolution review; inspect state/transitions or define @tool helpers only")
    if expect is not None and not _S.get("expect_on"):
        raise ValueError("expect is disabled in this run; drop the expect argument")
    if expect is not None and not (callable(expect) or (isinstance(expect, int) and not isinstance(expect, bool))
                                   or (isinstance(expect, (tuple, list)) and len(expect) == 2)):
        raise ValueError("expect must be a (lo, hi) changed-cell range, an int levels_completed increase, "
                         "or a callable (before, after) -> bool")
    items = [actions] if isinstance(actions, (str, dict)) else list(actions)
    if items and _H and _H[-1]["raw"].get("state") == "GAME_OVER":
        first = items[0]
        first_name = str(first if isinstance(first, str) else dict(first).get("action", "")).upper()
        if first_name != "RESET":
            raise RuntimeError("the game is over: only RESET works now. Retrying other actions in a loop can never "
                               "succeed; submit_actions('RESET') first")
    source = next(("direct_lib/" + f.filename[9:-3] for f in traceback.extract_stack()
                   if f.filename.startswith("work/lib/")), None)
    if source is None and _S.get("called_lib"):
        source = "assisted_lib/" + _S["called_lib"]
    _S["called_lib"] = None
    lines, executed, reason, level_changed, reset = [], 0, None, False, False
    skipping = (skip_known_noops or _S.get("skip_noops")) and not force
    skipped, surprise = 0, False
    consec_same_label, consec_same_no_new = None, 0
    for item in items:
        call = {"action": item} if isinstance(item, str) else dict(item)
        call["action"] = str(call["action"]).upper()
        if reasoning:
            call["reasoning"] = str(reasoning)
        before = _H[-1]
        prior_valid = tuple(_S["valid"]) if _S.get("branch_probe") else ()
        label = call["action"] if call["action"] != "MOUSE" else "MOUSE(x=%s,y=%s)" % (call.get("x"), call.get("y"))
        if skipping and _edges()[0].get(before["hash"], {}).get(label) == before["hash"]:
            lines.append("%s: skipped, a known no-op in this state (force=True to send)" % label)
            skipped += 1
            continue
        forecast = _forecast(before, label)
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
        grids = _H[-1]["grids"]
        if len(grids) > 2:
            transient = _transient(grids)
            if transient:
                lines[-1] += "  [animation: %d transient cells across %d frames; call anim_summary(%d) once instead of dumping frames_of(%d)]" % (
                    transient, len(grids), len(_H) - 1, len(_H) - 1)
        fact = _observe(before, forecast, source)
        probe = _S.pop("branch_probe", None)
        if probe is not None:
            name, plan, plan_index, level, board_hash, valid = probe
            suggested = plan[plan_index]
            comparable = (level == before["raw"]["level"] and board_hash == before["hash"]
                          and valid == prior_valid)
            fact["branch_handoff"] = {
                "tool": name, "suggested": suggested, "actual": label, "comparable": comparable,
                "plan_index": plan_index, "plan_length": len(plan),
                "matched": comparable and suggested == label,
                "aligned": comparable and suggested == label and expect is not None and not _is_vacuous_expect(expect),
                "repeat_mismatch": comparable and suggested != label and bool(fact.get("same")),
            }
            if comparable and suggested == label and plan_index + 1 < len(plan) and not level_changed:
                _S["branch_probe"] = (name, plan, plan_index + 1, _H[-1]["raw"]["level"], _H[-1]["hash"], tuple(_S["valid"]))
        lines[-1] += _echo(fact)
        vacuous_expect = expect is not None and _is_vacuous_expect(expect)
        if expect is not None:
            hit = _expect_ok(expect, before, _H[-1], reply["result"])
            if vacuous_expect:
                if executed == 1:
                    lines[-1] += "  [vacuous expect=%r: covers both 0-change noop and large changes; use a non-zero range or lambda(before, after) to test a specific hypothesis]" % (expect,)
            else:
                log = _S.setdefault("expect_log", [])
                log.append(bool(hit))
                del log[:-10]
            if not hit:
                surprise = True
                reason = "surprise"
                lines[-1] += "  <- SURPRISE: did not match expect"
                break
        if reply.get("halt"):
            reason = reply["halt"]
            break
        after = _H[-1]
        if stop_on_noop and not force and call["action"] != "RESET" \
                and not gameplay_changed(before["grids"][-1], after["grids"][-1]):
            lines[-1] += "  <- no interior change; batch stopped (stop_on_noop=False to continue)"
            reason = "noop"
            break
        if label == consec_same_label and not fact["changed"]:
            consec_same_no_new += 1
        else:
            consec_same_label = label
            consec_same_no_new = 0 if fact["changed"] else 1
        if not force and (expect is None or vacuous_expect) and call["action"] != "RESET" and consec_same_no_new >= 4:
            inv = _action_invariant_summary()
            inv_note = (" | " + inv) if inv else ""
            lines[-1] += "  <- %d identical actions without interior change or expect=; batch stopped (pass expect=... or force=True to override%s)" % (
                consec_same_no_new, inv_note)
            reason = "unchecked_repeat"
            break
        if stop_on == "change" and diff(before["grids"][-1], after["grids"][-1])["count"] or \
                stop_on == "no_change" and not diff(before["grids"][-1], after["grids"][-1])["count"] or \
                callable(stop_on) and stop_on(_frame(before), _frame(after)):
            reason = "stop_on"
            break
    latest = _H[-1]["raw"]
    log = _S.get("expect_log") or []
    summary = {"executed_count": executed, "requested": len(items), "stopped_early": reason is not None,
               "stop_reason": reason, "level": latest["level"], "levels_completed": latest["levels_completed"],
               "win_levels": latest.get("win_levels", 0), "state": latest["state"], "level_changed": level_changed,
               "reset": reset, "valid_actions": list(_S["valid"]), "lines": lines, "skipped_noops": skipped,
               "surprise": surprise, "expect_hits": "%d/%d" % (sum(log), len(log)) if log else None}
    _S["last_result"] = summary
    _bind()
    return summary


def _note(text):
    notes = _S.setdefault("notes", [])
    if text not in notes:
        notes.append(text)


def _doc(text):
    return (text or "").strip().split("\n")[0][:120]


def _key(entry):
    if "key" not in entry:
        value, fn = None, (_S.get("model") or {}).get("state_key")
        if fn:
            try:
                value = "k:" + repr(fn(_frame(entry)))
            except BaseException as exc:
                _note("model.state_key raised %s: %s" % (type(exc).__name__, exc))
        entry["key"] = value or _grid_hash(_interior(entry["grids"][-1]))
    return entry["key"]


def _ledger(t):
    before, after = _key(t["before"]), _key(t["after"])
    seen = _S["seen"]
    seen.add(before)
    prev = _S["tries"].setdefault((before, t["action"]), [])
    step = t["after"]["raw"]["step"]
    fact = {"step": step, "action": t["action"], "tries": len(prev), "same": bool(prev) and all(a == after for _, a in prev),
            "last_try": prev[-1][0] if prev else None, "new": after not in seen}
    prev.append((step, after))
    seen.add(after)
    if t["after"]["raw"]["state"] == "GAME_OVER" and t["before"]["raw"]["state"] != "GAME_OVER":
        mark = (before, t["action"])
        fact["same_death"] = next((s for m, s in _S["deaths"] if m == mark), None)
        _S["deaths"].append((mark, step))
    return fact


def _rebuild():
    _S.update(tries={}, seen=set(), deaths=[], mouse_tries={})
    for entry in _H:
        entry.pop("key", None)
    if _H:
        _S["seen"].add(_key(_H[0]))
    for t in _T:
        _ledger(t)


def _forecast(entry, label):
    model, out = _S.get("model") or {}, {}
    for name in ("predict", "is_fatal"):
        if model.get(name):
            try:
                out[name] = model[name](_frame(entry), label)
            except BaseException as exc:
                _note("model.%s raised %s: %s" % (name, type(exc).__name__, exc))
    return out


def _off(predicted, actual, before=None):
    try:
        if isinstance(predicted, dict):
            if before is None:
                raise ValueError("sparse prediction needs previous frame")
            changed = {(r, c) for r, row in enumerate(actual) for c, value in enumerate(row) if value != before[r][c]}
            for (r, c), value in predicted.items():
                if not (0 <= r < len(actual) and 0 <= c < len(actual[r]) and isinstance(value, int)):
                    raise ValueError("invalid sparse prediction cell")
            return sum(actual[r][c] != predicted[r, c] for r, c in predicted) + len(changed - predicted.keys())
        cells = _cells(predicted)
        return sum(1 for r, row in enumerate(actual) for c, value in enumerate(row) if cells[r][c] != -1 and cells[r][c] != value)
    except BaseException:
        _note("model.predict must return a grid or sparse changed-cell dict; got %s" % type(predicted).__name__)
        return None


def _action_invariant_summary(limit=36):
    if not _T or not _H:
        return ""
    level = _H[-1]["raw"]["level"]
    by_kind, by_label = {}, {}
    total = 0
    for t in _T[-limit:]:
        if t["action"] == "RESET" or t["before"]["raw"]["level"] != level:
            continue
        before, after = t["before"]["grids"][-1], t["after"]["grids"][-1]
        tiles = {(r // 4, c // 4) for r in range(len(after)) for c in range(len(after[r])) if before[r][c] != after[r][c]}
        if not tiles:
            continue
        kind = t["action"].split("(")[0]
        for store, key in ((by_kind, kind), (by_label, t["action"])):
            store.setdefault(key, set()).update(tiles)
        total += 1
    groups = by_kind if len(by_kind) >= 2 else by_label
    if len(groups) < 2 or total < 3:
        return ""
    shared = sorted(set.intersection(*groups.values()))
    if not shared or len(shared) > 8:
        return ""
    boxes = ["(%d..%d,%d..%d)" % (tr * 4, tr * 4 + 3, tc * 4, tc * 4 + 3) for tr, tc in shared[:4]]
    more = " (+%d)" % (len(shared) - 4) if len(shared) > 4 else ""
    return "action-invariant regions [%s]%s changed across %d distinct actions" % (
        ", ".join(boxes), more, len(groups))


def _causal_briefing(limit=36):
    if not _T or not _H:
        return ""
    level = _H[-1]["raw"]["level"]
    stats = {}
    for t in _T[-limit:]:
        if t["action"] == "RESET" or t["before"]["raw"]["level"] != level:
            continue
        before, after = t["before"]["grids"][-1], t["after"]["grids"][-1]
        d = diff(before, after)
        entry = stats.setdefault(t["action"], {"n": 0, "min_c": d["count"], "max_c": d["count"], "new": 0, "bboxes": set()})
        entry["n"] += 1
        entry["min_c"] = min(entry["min_c"], d["count"])
        entry["max_c"] = max(entry["max_c"], d["count"])
        if gameplay_changed(before, after):
            entry["new"] += 1
        if "bbox" in d and len(entry["bboxes"]) < 3:
            entry["bboxes"].add(str(d["bbox"]))
    lines = []
    for action, e in list(stats.items())[-8:]:
        span = "%d" % e["min_c"] if e["min_c"] == e["max_c"] else "%d-%d" % (e["min_c"], e["max_c"])
        lines.append("%s x%d: %s cells, interior_changed=%d, bbox=%s" % (
            action, e["n"], span, e["new"], ",".join(sorted(e["bboxes"])) or "none"))
    inv = _action_invariant_summary(limit)
    if inv:
        lines.append("Invariant: " + inv)
    return "\n".join(lines)[:900]


def _observe(before, forecast, source):
    t, after = _T[-1], _H[-1]
    fact = _ledger(t)
    d = diff(before["grids"][-1], after["grids"][-1])
    changed_syms = sorted({v for _, _, a_v, b_v in d.get("cells", []) for v in (a_v, b_v)})
    fact.update(level=before["raw"]["level"], changed=gameplay_changed(before["grids"][-1], after["grids"][-1]),
                changed_cells=d["count"], change_box=list(d["bbox"]) if "bbox" in d else None,
                changed_symbols=changed_syms,
                death=after["raw"]["state"] == "GAME_OVER" and before["raw"]["state"] != "GAME_OVER",
                level_up=after["raw"]["levels_completed"] != before["raw"]["levels_completed"], source=source,
                fatal=bool(forecast.get("is_fatal")), claims_failed=[], claims_held=[], verify_failed=[],
                predict_off=_off(forecast["predict"], after["grids"][-1], before["grids"][-1]) if "predict" in forecast else None)
    if t["action"] == "RESET" or fact["level_up"]:
        _S.setdefault("mouse_tries", {}).clear()
    elif t["action"].startswith("MOUSE(x="):
        match = re.match(r"MOUSE\(x=(\d+),y=(\d+)\)", t["action"])
        if match:
            x, y = map(int, match.groups())
            grid = before["grids"][-1]
            if 0 <= y < len(grid) and 0 <= x < len(grid[y]):
                color, todo, cells = grid[y][x], [(y, x)], {(y, x)}
                while todo:
                    cy, cx = todo.pop()
                    for ny, nx in ((cy - 1, cx), (cy + 1, cx), (cy, cx - 1), (cy, cx + 1)):
                        if 0 <= ny < len(grid) and 0 <= nx < len(grid[ny]) and (ny, nx) not in cells and grid[ny][nx] == color:
                            cells.add((ny, nx))
                            todo.append((ny, nx))
                region = (color, tuple(sorted(cells))) if len(cells) <= 256 else ("block", x // 4, y // 4)
                board = _key(before)
                key = (board, region)
                tries = _S.setdefault("mouse_tries", {})
                if fact["changed"] or fact["new"]:
                    tries.pop(key, None)
                    fact["region_tries"] = 0
                else:
                    fact["region_tries"] = tries.get(key, 0) + 1
                    tries[key] = fact["region_tries"]
                fact["ineffective_regions"] = len({r for b, r in tries if b == board})
    if fact["predict_off"] is not None:
        model = _S["model"]
        model["tested"] = model.get("tested", 0) + 1
        model["correct"] = model.get("correct", 0) + (fact["predict_off"] == 0)
        row = model.setdefault("by_level", {}).setdefault(str(fact["level"]), {"tested": 0, "correct": 0})
        row["tested"] += 1
        row["correct"] += fact["predict_off"] == 0
    for name, claim in sorted((_S.get("claims") or {}).items()):
        if claim.get("fn"):
            verdict = _judge_claim(name, claim, t)
            if verdict is not None:
                fact["claims_held" if verdict else "claims_failed"].append(name)
    for cid, entry in sorted((_S.get("memory_checks") or {}).items()):
        if entry.get("code") is not None and not entry.get("stats", {}).get("unscoped"):
            verdict = _judge_memory(cid, entry, t)
            if verdict is False:
                fact["verify_failed"].append(cid)
    _S.setdefault("steps", []).append(fact)
    return fact


def _echo(fact):
    out = ""
    if fact["tries"]:
        out += "  [tried %d time%s before from this board%s]" % (
            fact["tries"], "s" if fact["tries"] > 1 else "", ", same result each time" if fact["same"] else "")
    if fact.get("region_tries", 0) >= 2:
        out += "  [ineffective clicks in this region: %d; ineffective regions on this board: %d]" % (
            fact["region_tries"], fact.get("ineffective_regions", 1))
    if fact["tries"] >= 2 and fact["same"]:
        board = _key(_T[-1]["before"])
        tried = sorted({action for key, action in _S["tries"] if key == board})
        untried = sorted(action for action in _S["valid"] if action not in tried and action != "MOUSE")
        out += "  [from this board: tried=%s; untried valid=%s]" % (tried, untried)
    if fact["predict_off"]:
        out += "  [predict: %d cells off]" % fact["predict_off"]
    if fact["death"]:
        out += "  [death%s%s]" % (
            "; repeats the death at step %d (same board, same action)" % fact["same_death"]
            if fact.get("same_death") is not None else "", "; is_fatal had flagged it" if fact["fatal"] else "")
    elif fact["fatal"]:
        out += "  [is_fatal flagged this action; it was not fatal]"
    for name in fact["claims_failed"]:
        witness = (_S.get("claim_outbox") or {}).get(name, {}).get("witness")
        out += "  [claims/%s failed%s]" % (name, ": " + witness if witness else "")
    for cid in fact.get("verify_failed") or []:
        witness = (_S.get("memory_checks") or {}).get(cid, {}).get("stats", {}).get("witness")
        out += "  [verify/%s failed%s]" % (cid, ": " + witness if witness else "")
    return out


def _load(path, source):
    mod_name = path[5:-3].replace("/", ".")
    if path.startswith("work/lib/") and path.endswith(".py"):
        module = _CallableToolModule(mod_name, path[9:-3])
    else:
        module = types.ModuleType(mod_name)
    module.__file__ = path
    module.__dict__.update(_API)
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
            updated = _file("write", self._path, data)
            if updated is not None:
                _sync_work(updated)


def _open(path, mode="r", *args, **kwargs):
    if "b" in mode:
        raise ValueError("work/ supports text files only")
    clean = str(path).replace("\\", "/").lstrip("./")
    if "components/" in clean or clean.endswith("/components") or clean == "components":
        import posixpath
        norm = posixpath.normpath(clean)
        if not (norm == "work" or norm.startswith("work/")) or "harness/components" in norm:
            raise PermissionError("direct writes to component storage are blocked (%s); use reflect_component(op, kind, name, ...)" % path)
    if "r" in mode and "+" not in mode:
        return io.StringIO(_file("read", path))
    initial = ""
    if "a" in mode or "+" in mode:
        with contextlib.suppress(FileNotFoundError):
            initial = _file("read", path)
    return _WorkFile(path, initial)


def _is_work_path(path):
    clean = str(path).replace("\\", "/").lstrip("./")
    return clean == "work" or clean.startswith("work/")


def _judge_claim(claim_name, claim, t):
    try:
        verdict = claim["fn"](Transition(t["action"], _frame(t["before"]), _frame(t["after"]), dict(t["result"])))
    except BaseException as exc:
        claim["error"] = "%s: %s" % (type(exc).__name__, exc)
        _note("claims/%s raised %s" % (claim_name, claim["error"]))
        return None
    box = _S.setdefault("claim_outbox", {}).setdefault(claim_name, {"support": 0, "counter": 0, "checked": 0,
                                                                     "levels": [], "last_fail": None})
    box["checked"] += 1
    level = t["before"]["raw"]["level"]
    per_level = box.setdefault("by_level", {}).setdefault(str(level), {"support": 0, "counter": 0, "checked": 0})
    per_level["checked"] += 1
    if verdict is True or verdict is False:
        box["support" if verdict else "counter"] += 1
        per_level["support" if verdict else "counter"] += 1
        if verdict and level not in box["levels"]:
            box["levels"].append(level)
        if not verdict:
            box["last_fail"] = t["after"]["raw"]["step"]
            box["witness"] = "L%s step %s %s, %s cells changed" % (level, t["after"]["raw"]["step"],
                t["action"], t["result"].get("changed_cells", "?"))
        return bool(verdict)
    return None


def _judge_memory(cid, entry, t):
    if entry.get("code") is None or entry.get("stats", {}).get("unscoped"):
        return None
    tr = Transition(t["action"], _frame(t["before"]), _frame(t["after"]), dict(t["result"]))
    env = {"__builtins__": _S["ns"]["__builtins__"], **_API, "t": tr,
           "before": tr.before_frame, "after": tr.after_frame, "action": tr.action}
    try:
        verdict = eval(entry["code"], env)
    except BaseException as exc:
        entry["stats"]["error"] = "%s: %s" % (type(exc).__name__, exc)
        return None
    if verdict is True or verdict is False:
        stats = entry["stats"]
        stats["checked"] += 1
        level = str(t["before"]["raw"]["level"])
        per_level = stats.setdefault("by_level", {}).setdefault(level, {"support": 0, "counter": 0, "checked": 0})
        per_level["checked"] += 1
        if verdict:
            stats["support"] += 1
            per_level["support"] += 1
        else:
            stats["counter"] += 1
            per_level["counter"] += 1
            stats["witness"] = "L%s s%s %s (%s cells)" % (
                level, t["after"]["raw"]["step"], t["action"], t["result"].get("changed_cells", "?"))
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
        stats = {"support": 0, "counter": 0, "checked": 0, "by_level": {}, "witness": None, "error": None, "unscoped": False}
        try:
            compiled = compile(expr, "memory_verify/%s" % cid, "eval")
        except BaseException as exc:
            stats["error"] = "%s: %s" % (type(exc).__name__, exc)
            store[cid] = {"expr": expr, "code": None, "stats": stats}
            continue
        entry = {"expr": expr, "code": compiled, "stats": stats}
        for t in _T:
            _judge_memory(cid, entry, t)
        if len(_T) >= 3 and stats["checked"] == len(_T) and stats["support"] == 0 and stats["counter"] == len(_T):
            stats["unscoped"] = True
        store[cid] = entry
    for cid in list(store):
        if cid not in supplied:
            del store[cid]


def tool(fn):
    if _S.get("parent_readonly_tools"):
        raise PermissionError("Only boundary evolution can publish @tool")
    return fn


_TRIAL_SAFE_MODULES = frozenset({
    "collections", "math", "re", "heapq", "itertools", "functools",
    "statistics", "json", "copy", "operator", "bisect", "string",
    "typing", "dataclasses", "enum", "fractions", "decimal",
})


def _trial_import(name, globals=None, locals=None, fromlist=(), level=0):
    if level != 0 or name.split(".")[0] not in _TRIAL_SAFE_MODULES:
        raise ImportError("module %r is not allowed in trial_at" % (name,))
    return builtins.__import__(name, globals, locals, fromlist, level)


def trial_at(k, fn):
    """Run a self-contained observation function at the prefix before transition k."""
    if not _S.get("forbid_actions"):
        raise PermissionError("trial_at is available during boundary evolution")
    if type(k) is not int or not 0 <= k < len(_H):
        raise IndexError("trial index outside recorded history")
    if isinstance(fn, _CallableToolModule):
        fn = fn.__dict__.get(fn._entry_name) or fn.__dict__.get("run")
    fn = getattr(fn, "__wrapped__", fn)
    if not isinstance(fn, types.FunctionType):
        raise TypeError("pass a function, for example trial_at(k, my_tool_fn)")
    if fn.__closure__ or fn.__defaults__ or fn.__kwdefaults__:
        raise ValueError("trial function must not capture live values")
    history = [HistoryEntry(e["action"], _frame(e), e["changed"], e["hash"]) for e in _H[:k + 1]]
    transitions = [Transition(t["action"], _frame(t["before"]), _frame(t["after"]), dict(t["result"])) for t in _T[:k]]
    last = transitions[-1] if transitions else None
    safe_builtins = {name: getattr(builtins, name) for name in
                     ("abs", "all", "any", "bool", "chr", "dict", "divmod", "enumerate",
                      "filter", "float", "frozenset", "getattr", "hasattr", "hash", "int",
                      "isinstance", "issubclass", "iter", "len", "list", "map", "max", "min",
                      "next", "ord", "pow", "print", "range", "repr", "reversed", "round",
                      "set", "slice", "sorted", "str", "sum", "tuple", "type", "zip",
                      "Exception", "ValueError", "KeyError", "IndexError", "TypeError",
                      "ZeroDivisionError", "StopIteration", "AttributeError", "RuntimeError")}
    safe_builtins["__import__"] = _trial_import
    names = dict(__builtins__=safe_builtins,
                 history=history, transitions=transitions, current_frame=history[-1].frame,
                 previous_frame=last.before_frame if last else None, last_transition=last,
                 last_action=last.action if last else None, last_action_result=last.result if last else {},
                 diff=diff, ascii=ascii, gameplay_changed=gameplay_changed, segment=segment)
    for gname, gval in (getattr(fn, "__globals__", None) or {}).items():
        if gname in names or gname == "__builtins__" or gname in _LIVE_KEYS:
            continue
        if isinstance(gval, types.ModuleType) and getattr(gval, "__name__", "").split(".")[0] in _TRIAL_SAFE_MODULES:
            names[gname] = gval
        elif (isinstance(gval, type) or callable(gval)) and (getattr(gval, "__module__", "") or "").split(".")[0] in _TRIAL_SAFE_MODULES:
            names[gname] = gval
    def trial_frame_diff(a=None, b=None):
        a = a if a is not None else names["previous_frame"]
        return frame_diff(a, names["current_frame"] if b is None else b) if a is not None else {
            "changed_cells": 0, "note": "no previous frame"}
    names["frame_diff"] = trial_frame_diff
    return type(fn)(fn.__code__, names)()


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


def _makedirs(path, *args, **kwargs):
    if _is_work_path(path):
        return None
    return _os_makedirs(path, *args, **kwargs)


def _mkdir(path, *args, **kwargs):
    if _is_work_path(path):
        return None
    return _os_mkdir(path, *args, **kwargs)


_os_makedirs, _os_mkdir = os.makedirs, os.mkdir
os.makedirs, os.mkdir = _makedirs, _mkdir
_API = dict(open=_open, submit_actions=submit_actions, diff=diff, ascii=ascii, frames_of=frames_of,
            anim_summary=anim_summary, frame_diff=frame_diff, segment=segment, gameplay_changed=gameplay_changed,
            tool=tool)


def _cell(req):
    _S.update(valid=req["valid_actions"], valid_raw=req["valid_actions_raw"],
              last_result=req["last_action_result"], numeric=req["numeric_grid"], images=[],
              skip_noops=bool(req.get("skip_noops")), expect_on=bool(req.get("expect_enabled")),
              graph_on=bool(req.get("graph_enabled")), harness=req.get("harness_state") or {},
              forbid_actions=bool(req.get("forbid_actions")),
              parent_readonly_tools=bool(req.get("parent_readonly_tools")))
    if req["reset_history"]:
        _H.clear()
        _T.clear()
    results = list(req.get("transition_results") or [])
    action_entries = sum(1 for raw in req["new_history"] if raw.get("action"))
    result_idx = max(0, len(results) - action_entries)
    for raw in req["new_history"]:
        res = None
        if raw.get("action") and result_idx < len(results):
            res = results[result_idx]
            result_idx += 1
        _append(raw, req["numeric_grid"], res)
    fresh = _S["ns"] is None
    if fresh:
        names = dict(vars(builtins), open=_open)
        _S["ns"] = {"__builtins__": names, "__name__": "__main__", "submit_actions": submit_actions,
                    "diff": diff, "ascii": ascii, "frames_of": frames_of, "anim_summary": anim_summary,
                    "frame_diff": frame_diff, "tool": tool, "trial_at": trial_at}
        if _S["graph_on"]:
            _S["ns"].update(graph_summary=graph_summary, bfs_graph=bfs_graph, replay_to=replay_to)
        if not any(isinstance(finder, _WorkFinder) for finder in sys.meta_path):
            sys.meta_path.append(_WorkFinder())
    _bind()
    ns = _S["ns"]
    if fresh and req.get("startup_source"):
        try:
            exec(compile(req["startup_source"], "work/startup.py", "exec"), ns)
        except BaseException as exc:
            _S["startup_error"] = "[startup] work/startup.py failed: %s: %s" % (type(exc).__name__, exc)
    _sync_work(req, bool(req["new_history"]))
    _bind()
    if req.get("validate_memory_checks") is not None:
        previous_checks = _S.get("memory_checks", {})
        try:
            _S["memory_checks"] = {}
            _sync_memory(req["validate_memory_checks"], force_rebacktest=True)
            checked = {cid: dict(item["stats"]) for cid, item in _S["memory_checks"].items()}
        finally:
            _S["memory_checks"] = previous_checks
        return {"text": "", "error": None, "images": [], "steps": [], "notes": [], "memory_checks": checked, "decorated_tools": []}
    if "memory_checks" in req:
        _sync_memory(req.get("memory_checks") or [], force_rebacktest=bool(req["reset_history"]))
    if req.get("sync_only"):
        return {"text": "", "error": None, "images": [], "last_result": dict(_S["last_result"]),
                "steps": [], "notes": _S.pop("notes", []),
                "memory_checks": {cid: dict(item["stats"]) for cid, item in (_S.get("memory_checks") or {}).items()},
                "decorated_tools": []}
    ns.pop("result", None)
    out, value, error = io.StringIO(), None, None
    startup_note = _S.pop("startup_error", None)
    if startup_note:
        out.write(startup_note + "\n")
    _S["called_lib"] = None
    _S["used_libs"] = set()
    decorated = []
    mounted_decorated = []
    prior_names = {}
    prior_modules = {}
    staged = []
    try:
        tree = ast.parse(req["code"], "<python>")
        decorated = _extract_decorated_tools(tree, req["code"])
        prior_names = {name: (name in ns, ns.get(name)) for name, _ in decorated}
        prior_modules = {name: (name in sys.modules, sys.modules.get(name)) for name, _ in decorated}
        last = tree.body.pop() if tree.body and isinstance(tree.body[-1], ast.Expr) else None
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
            exec(compile(tree, "<python>", "exec"), ns)
            for name, source in decorated:
                mod = _wrap_lib_module(name, _load("work/lib/%s.py" % name, source))
                ns[name] = sys.modules[name] = mod
                staged.append((name, source, mod))
            if last is not None:
                value = eval(compile(ast.Expression(last.value), "<python>", "eval"), ns)
            if ns.get("result") is not None:
                value = ns["result"]
            for name, source, mod in staged:
                _file("write", "work/lib/%s.py" % name, source)
                _S.setdefault("lib", {})[name] = {
                    "source": source, "module": mod, "error": None,
                    "doc": _doc(mod.__doc__ or getattr(mod.__dict__.get(name), "__doc__", None)),
                }
                mounted_decorated.append(name)
                _note("@tool prepared: %s" % name)
    except BaseException as problem:
        for name, (existed, old) in prior_names.items():
            if existed: ns[name] = old
            else: ns.pop(name, None)
        for name, (existed, old) in prior_modules.items():
            if existed: sys.modules[name] = old
            else: sys.modules.pop(name, None)
        frames = [f for f in traceback.extract_tb(problem.__traceback__) if f.filename == "<python>"]
        error = "".join(traceback.format_list(frames)) + "%s: %s" % (type(problem).__name__, problem)
    text = out.getvalue()
    if value is not None:
        shown = value if isinstance(value, str) else repr(value)
        text += ("" if not text or text.endswith("\n") else "\n") + shown
    model, libs = _S["model"], _S["lib"]
    claim_errors = {name: c["error"] for name, c in (_S.get("claims") or {}).items() if c.get("error")}
    text = text + ("\n" + "\n".join(_S.get("notes") or []) if _S.get("notes") else "")
    return {"text": text[:200000], "error": error, "images": _S["images"][:MAX_IMAGES],
            "last_result": dict(_S["last_result"]), "steps": _S.pop("steps", []), "notes": _S.pop("notes", []),
            "memory_checks": {cid: dict(item["stats"]) for cid, item in (_S.get("memory_checks") or {}).items()},
            "decorated_tools": mounted_decorated,
            "used_libs": sorted(_S.pop("used_libs", set())),
            "claims": {"counts": _S.pop("claim_outbox", {}), "reset": sorted(_S.pop("claim_reset", set())), "errors": claim_errors,
                       "docs": {name: c["doc"] for name, c in (_S.get("claims") or {}).items()}},
            "model": {"funcs": [name for name in ("state_key", "predict", "is_fatal") if name in model],
                      "tested": model.get("tested"), "correct": model.get("correct"),
                      "by_level": model.get("by_level", {}),
                      "error": model.get("error")} if model.get("source") else None,
            "lib": {name: {"doc": e["doc"], "error": e["error"]} for name, e in libs.items()},
            "action_invariant": _action_invariant_summary(),
            "causal_briefing": _causal_briefing()}


_req = input
while _req is not None:
    _req = _rpc({"t": "done", "result": _cell(_req)})
