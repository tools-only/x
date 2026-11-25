import ast, builtins, contextlib, importlib.util, io, json, os, sys, traceback

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


def review(layer, diagnosis, evidence, change, test, place=None, artifact=None):
    """Name the failing layer with evidence; required to unfreeze submit_actions after the host froze it.
    A review whose change is not 'none' must also declare where the conclusion lands: place= one of
    memory/tool/prompt/loop/context/skill/subagent and artifact= the work/ file that will hold it."""
    if layer not in ("action", "rule", "goal", "representation"):
        raise ValueError("layer must be one of: action, rule, goal, representation")
    steps = list(evidence) if isinstance(evidence, (list, tuple)) else None
    if not steps or not all(isinstance(s, int) and not isinstance(s, bool) and 0 <= s < len(_H) for s in steps):
        raise ValueError("evidence must be a non-empty list of history step numbers (0..%d)" % (len(_H) - 1))
    for name, value in (("diagnosis", diagnosis), ("change", change)):
        if not isinstance(value, str) or not value.strip():
            raise ValueError("%s must be a non-empty string; change='none' is allowed, a missing test is not" % name)
    if not callable(test) and (not isinstance(test, str) or not test.strip()):
        raise ValueError("test must be a non-empty string or a callable (transition) -> bool|None")
    if change.strip().lower() in ("action", "rule", "goal", "representation"):
        raise ValueError("change must be the revised reading in your own words (or 'none'), not a layer name")
    if change.strip().lower() != "none" and (place is None or artifact is None):
        raise ValueError("a review whose change is not 'none' must declare place= (memory, tool, prompt, loop, "
                         "context, skill or subagent) and artifact= (the work/ file where the conclusion lands)")
    if place is not None and place not in ("memory", "tool", "prompt", "loop", "context", "skill", "subagent"):
        raise ValueError("place must be one of: memory, tool, prompt, loop, context, skill, subagent")
    if artifact is not None and (not isinstance(artifact, str)
                                 or not artifact.replace("\\", "/").lstrip("./").startswith("work/")):
        raise ValueError("artifact must be a path under work/")
    if callable(test):
        checks = _S.setdefault("review_checks", [])
        checks.append({"id": "r%d" % (len(checks) + 1), "fn": test, "ok": 0, "fail": 0})
        test_repr = "<callable %s, run after every later action>" % getattr(test, "__name__", "test")
    else:
        test_repr = test
    reply = _rpc({"t": "review", "review": {"layer": layer, "diagnosis": diagnosis, "evidence": steps,
                                            "change": change, "test": test_repr, "place": place, "artifact": artifact}})
    _S["review_required"] = reply.get("review_required")
    _S["review_test_pending"] = True
    unfrozen = not _S["review_required"]
    out = {"ok": True, "layer": layer, "unfrozen": unfrozen}
    if not unfrozen:
        out["next"] = "write %s to complete the review and unfreeze actions" % artifact
    return out


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
    harness = dict(_S.get("harness") or {})
    extra = {}
    if _S.get("last_review_test"):
        extra["last_review_test"] = _S["last_review_test"]
    checks = _S.get("review_checks") or []
    if checks:
        extra["review_checks"] = {c["id"]: "%d ok / %d fail" % (c["ok"], c["fail"]) for c in checks}
    if extra:
        harness["predictions"] = dict(harness.get("predictions") or {}, **extra)
    ns.update(current_frame=_frame(_H[-1]), previous_frame=last.before_frame if last else None,
              history=history, transitions=transitions, last_transition=last,
              last_action=last.action if last else None, last_action_result=dict(_S["last_result"]),
              valid_actions=list(_S["valid"]), harness_state=harness)


def submit_actions(actions, stop_on=None, expect=None, reasoning=None, confirm_full_reset=False,
                   skip_known_noops=False, force=False, stop_on_noop=True):
    if _S.get("review_required"):
        required = _S["review_required"]
        hint = ("write the declared artifact file to complete the review" if "write that file" in required
                else "fix the declared artifact file - the review is not complete"
                if "failed to load" in required or "copying the frame" in required
                else "call review(layer=..., diagnosis=..., evidence=[history steps], change=..., test=...) "
                     "first — see harness_state for evidence")
        raise RuntimeError("ReviewRequired: %s. Trigger: %s" % (hint, required))
    if expect is not None and not _S.get("expect_on"):
        raise ValueError("expect is disabled in this run; drop the expect argument")
    if expect is not None and not (callable(expect) or (isinstance(expect, int) and not isinstance(expect, bool))
                                   or (isinstance(expect, (tuple, list)) and len(expect) == 2)):
        raise ValueError("expect must be a (lo, hi) changed-cell range, an int levels_completed increase, "
                         "or a callable (before, after) -> bool")
    if isinstance(expect, (tuple, list)) and len(expect) == 2 and expect[1] - expect[0] > 16:
        raise ValueError("expect range (%s, %s) is too wide to mean anything; commit to a range no wider than 16 "
                         "changed cells, an int levels_completed increase, or a callable" % (expect[0], expect[1]))
    items = [actions] if isinstance(actions, (str, dict)) else list(actions)
    if items and _H and _H[-1]["raw"].get("state") == "GAME_OVER":
        first = items[0]
        first_name = str(first if isinstance(first, str) else dict(first).get("action", "")).upper()
        if first_name != "RESET":
            raise RuntimeError("the game is over: only RESET works now. Retrying other actions in a loop can never "
                               "succeed; submit_actions('RESET') first")
    lines, executed, reason, level_changed, reset = [], 0, None, False, False
    acted_real = False
    skipping = (skip_known_noops or _S.get("skip_noops")) and not force
    skipped, surprise = 0, False
    for item in items:
        call = {"action": item} if isinstance(item, str) else dict(item)
        call["action"] = str(call["action"]).upper()
        if reasoning:
            call["reasoning"] = str(reasoning)
        before = _H[-1]
        label = call["action"] if call["action"] != "MOUSE" else "MOUSE(x=%s,y=%s)" % (call.get("x"), call.get("y"))
        if skipping and _edges()[0].get(before["hash"], {}).get(label) == before["hash"]:
            lines.append("%s: skipped, a known no-op in this state (force=True to send)" % label)
            skipped += 1
            continue
        reply = _rpc({"t": "act", "call": call, "confirm_full_reset": bool(confirm_full_reset), "expect": repr(expect) if expect is not None else None})
        if "stopped" in reply:
            reason = reply["stopped"]
            break
        _S["valid"], _S["valid_raw"], _S["last_result"] = reply["valid_actions"], reply["valid_actions_raw"], reply["result"]
        _S["review_required"] = reply.get("review_required")
        _append(reply["entry"], _S["numeric"], reply["result"])
        _bind()
        executed += 1
        reset = reset or call["action"] == "RESET"
        acted_real = acted_real or call["action"] != "RESET"
        level_changed = level_changed or _H[-1]["raw"]["levels_completed"] != before["raw"]["levels_completed"]
        lines.append(reply["line"])
        grids = _H[-1]["grids"]
        if len(grids) > 2:
            transient = _transient(grids)
            if transient:
                lines[-1] += "  [animation: %d transient cells; inspect frames_of(%d)]" % (transient, len(_H) - 1)
        for check in _S.get("review_checks") or []:
            try:
                verdict = check["fn"](Transition(_T[-1]["action"], _frame(_T[-1]["before"]), _frame(_T[-1]["after"]),
                                                 dict(_T[-1]["result"]))) if _T else None
            except Exception:
                verdict = None
            if verdict is True:
                check["ok"] += 1
            elif verdict is False:
                check["fail"] += 1
                lines[-1] += "  <- review test %s failed" % check["id"]
        for claim_name, claim in sorted((_S.get("claims") or {}).items()):
            if claim.get("fn") and _T:
                _judge_claim(claim_name, claim, _T[-1])
        if expect is not None:
            hit = _expect_ok(expect, before, _H[-1], reply["result"])
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
        if stop_on == "change" and diff(before["grids"][-1], after["grids"][-1])["count"] or \
                stop_on == "no_change" and not diff(before["grids"][-1], after["grids"][-1])["count"] or \
                callable(stop_on) and stop_on(_frame(before), _frame(after)):
            reason = "stop_on"
            break
    latest = _H[-1]["raw"]
    log = _S.get("expect_log") or []
    review_test = None
    if executed and acted_real and _S.get("review_test_pending"):
        _S.pop("review_test_pending")
        review_test = "surprise" if surprise else ("hit" if expect is not None else "untested")
        _S["last_review_test"] = review_test
    summary = {"executed_count": executed, "requested": len(items), "stopped_early": reason is not None,
               "stop_reason": reason, "level": latest["level"], "levels_completed": latest["levels_completed"],
               "win_levels": latest.get("win_levels", 0), "state": latest["state"], "level_changed": level_changed,
               "reset": reset, "valid_actions": list(_S["valid"]), "lines": lines, "skipped_noops": skipped,
               "surprise": surprise, "expect_hits": "%d/%d" % (sum(log), len(log)) if log else None,
               "review_test": review_test}
    _S["last_result"] = summary
    _bind()
    return summary


def _probe_artifact(path, data):
    name = str(path).replace("\\", "/")
    if name.startswith("work/"):
        name = name[5:]
    if name == "world_model.py":
        try:
            mod = {"__name__": "work.world_model"}
            exec(compile(data, "work/world_model.py", "exec"), mod)
            fn = mod.get("predict")
            if not callable(fn):
                return {"kind": "model", "error": "defines no callable predict(frame, action)"}
        except BaseException as exc:
            return {"kind": "model", "error": "%s: %s" % (type(exc).__name__, exc)}
        tested = correct = identity = 0
        err = None
        for t in _T[-24:]:
            before_grid = t["before"]["grids"][-1]
            after_grid = t["after"]["grids"][-1]
            try:
                predicted = fn(_frame(t["before"]), t["action"])
            except BaseException as exc:
                err = "%s: %s" % (type(exc).__name__, exc)
                continue
            tested += 1
            if _same_grid(predicted, after_grid):
                correct += 1
            if _same_grid(before_grid, after_grid):
                identity += 1
        out = {"kind": "model", "tested": tested, "correct": correct, "identity": identity}
        if err:
            out["error_sample"] = err
        return out
    if name.startswith("claims/") and name.endswith(".py"):
        try:
            mod = {"__name__": "work." + name[:-3].replace("/", ".")}
            exec(compile(data, "work/" + name, "exec"), mod)
            fn = mod.get("check")
            if not callable(fn):
                return {"kind": "claim", "error": "defines no callable check(transition)"}
        except BaseException as exc:
            return {"kind": "claim", "error": "%s: %s" % (type(exc).__name__, exc)}
        checked = support = counter = 0
        for t in _T:
            try:
                verdict = fn(Transition(t["action"], _frame(t["before"]), _frame(t["after"]), dict(t["result"])))
            except BaseException as exc:
                return {"kind": "claim", "error": "%s: %s" % (type(exc).__name__, exc)}
            checked += 1
            if verdict is True:
                support += 1
            elif verdict is False:
                counter += 1
        return {"kind": "claim", "checked": checked, "support": support, "counter": counter}
    return None


def _file(op, path, data=None):
    req = {"t": "file", "op": op, "path": str(path), "data": data}
    if op == "write":
        probe = _probe_artifact(path, data)
        if probe is not None:
            req["probe"] = probe
    reply = _rpc(req)
    if "error" in reply:
        raise (FileNotFoundError if reply.get("missing") else PermissionError)(reply["error"])
    if reply.get("review_cleared"):
        _S["review_required"] = None
    elif reply.get("review_required"):
        _S["review_required"] = reply["review_required"]
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


def _is_work_path(path):
    clean = str(path).replace("\\", "/").lstrip("./")
    return clean == "work" or clean.startswith("work/")


def _same_grid(predicted, actual):
    try:
        cells = _cells(predicted)
        if cells is None or len(cells) != len(actual):
            return False
        for row_p, row_a in zip(cells, actual):
            if len(row_p) != len(row_a):
                return False
            for a, b in zip(row_p, row_a):
                if a != b:
                    return False
        return True
    except BaseException:
        return False


def _judge_claim(claim_name, claim, t):
    try:
        verdict = claim["fn"](Transition(t["action"], _frame(t["before"]), _frame(t["after"]), dict(t["result"])))
    except BaseException as exc:
        claim["error"] = "%s: %s" % (type(exc).__name__, exc)
        return
    box = _S.setdefault("claim_outbox", {}).setdefault(claim_name, {"support": 0, "counter": 0, "checked": 0, "levels": []})
    box["checked"] += 1
    if verdict is True or verdict is False:
        box["support" if verdict else "counter"] += 1
        level = t["after"]["raw"]["level"]
        if verdict and level not in box["levels"]:
            box["levels"].append(level)


def _backtest_model(model):
    fn = model.get("fn")
    if not fn or not _T:
        return None
    tested = correct = 0
    err = model.get("error")
    for t in _T[-24:]:
        try:
            predicted = fn(_frame(t["before"]), t["action"])
        except BaseException as exc:
            err = "%s: %s" % (type(exc).__name__, exc)
            continue
        tested += 1
        if _same_grid(predicted, t["after"]["grids"][-1]):
            correct += 1
    model["tested_at"] = len(_T)
    out = {"tested": tested, "correct": correct}
    if err:
        out["error"] = err
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


def _cell(req):
    _S.update(valid=req["valid_actions"], valid_raw=req["valid_actions_raw"],
              last_result=req["last_action_result"], numeric=req["numeric_grid"], images=[],
              skip_noops=bool(req.get("skip_noops")), expect_on=bool(req.get("expect_enabled")),
              graph_on=bool(req.get("graph_enabled")), harness=req.get("harness_state") or {},
              review_on=bool(req.get("review_enabled")), review_required=req.get("review_required"))
    if req["reset_history"]:
        _H.clear()
        _T.clear()
    for raw in req["new_history"]:
        _append(raw, req["numeric_grid"])
    fresh = _S["ns"] is None or req["reset_namespace"]
    if fresh:
        names = dict(vars(builtins), open=_open)
        _S["ns"] = {"__builtins__": names, "__name__": "__main__", "submit_actions": submit_actions,
                    "diff": diff, "ascii": ascii, "frames_of": frames_of, "frame_diff": frame_diff}
        if _S["graph_on"]:
            _S["ns"].update(graph_summary=graph_summary, bfs_graph=bfs_graph, replay_to=replay_to)
        if _S["review_on"]:
            _S["ns"]["review"] = review
        if not any(isinstance(finder, _WorkFinder) for finder in sys.meta_path):
            sys.meta_path.append(_WorkFinder())
    _bind()
    ns = _S["ns"]
    if fresh and req.get("startup_source"):
        try:
            exec(compile(req["startup_source"], "work/startup.py", "exec"), ns)
        except BaseException as exc:
            _S["startup_error"] = "[startup] work/startup.py failed: %s: %s" % (type(exc).__name__, exc)
    store = _S.setdefault("claims", {})
    for claim in req.get("claims") or []:
        cur = store.get(claim["name"])
        if cur is not None and cur["source"] == claim["source"]:
            continue
        entry = {"source": claim["source"], "fn": None, "error": None}
        try:
            mod = {"__name__": "work.claims." + claim["name"]}
            exec(compile(claim["source"], "work/claims/%s.py" % claim["name"], "exec"), mod)
            if callable(mod.get("check")):
                entry["fn"] = mod["check"]
            else:
                entry["error"] = "defines no callable check(transition)"
        except BaseException as exc:
            entry["error"] = "%s: %s" % (type(exc).__name__, exc)
        store[claim["name"]] = entry
        if entry["fn"] and claim.get("fresh"):
            for t in _T:
                _judge_claim(claim["name"], entry, t)
    supplied = {claim["name"] for claim in req.get("claims") or []}
    for name in list(store):
        if name not in supplied:
            del store[name]
    model = _S.setdefault("model", {"source": None, "fn": None, "error": None, "tested_at": -1})
    model_source = req.get("model_source")
    if model_source != model["source"]:
        model.update(source=model_source, fn=None, error=None, tested_at=-1)
        if model_source:
            try:
                mod = {"__name__": "work.world_model"}
                exec(compile(model_source, "work/world_model.py", "exec"), mod)
                if callable(mod.get("predict")):
                    model["fn"] = mod["predict"]
                else:
                    model["error"] = "defines no callable predict(frame, action)"
            except BaseException as exc:
                model["error"] = "%s: %s" % (type(exc).__name__, exc)
    ns.pop("result", None)
    out, value, error = io.StringIO(), None, None
    startup_note = _S.pop("startup_error", None)
    if startup_note:
        out.write(startup_note + "\n")
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
    claim_errors = {name: c["error"] for name, c in (_S.get("claims") or {}).items() if c.get("error")}
    backtest = None
    if model.get("fn") and len(_T) != model.get("tested_at"):
        backtest = _backtest_model(model)
    elif model.get("error"):
        backtest = {"tested": 0, "correct": 0, "error": model["error"]}
    return {"text": text[:200000], "error": error, "images": _S["images"][:MAX_IMAGES],
            "last_result": dict(_S["last_result"]),
            "claims": {"counts": _S.pop("claim_outbox", {}), "errors": claim_errors},
            "model": backtest}


_req = input
while _req is not None:
    _req = _rpc({"t": "done", "result": _cell(_req)})
