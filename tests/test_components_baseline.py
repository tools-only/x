import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("components_baseline", Path(__file__).resolve().parents[1] / "tools/components_baseline.py")
baseline = importlib.util.module_from_spec(spec)
spec.loader.exec_module(baseline)


def cell(code, level=0):
    return {"code": code, "level": level, "defs": baseline.top_level_defs(code), **baseline.code_shape(code)}


def test_retyping_tells_verbatim_renumbered_and_retyped_runs_apart_per_level():
    loop = "cur = grid\nchanged = []\nfor y in range(64):\n    for x in range(64):\n        if cur[y][x] != prev[y][x]: changed.append((x, y))\n"
    cells = [cell("prev = history.grid(3)\n" + loop),
             cell("# again\n" + "prev = history.grid(3)\n" + loop),            # the same code, one comment more
             cell("prev = history.grid(9)\n" + loop),                          # the same shape, another number
             cell("print(len(changed))\n" + loop + "print(changed[:3])\n"),    # new lines around a retyped run of five
             cell("prev = history.grid(3)\n" + loop, level=1)]                 # a new level starts over
    seen = baseline.retyping(cells)
    assert (seen["verbatim"], seen["renumbered"], seen["retyped_cells"], seen["retyped_lines"]) == (1, 1, 1, 5)


def test_top_level_defs_are_found_per_cell_and_counted_again_when_redefined():
    cells = [cell("def snap(g):\n    return g\n\nx = snap(grid)"), cell("def snap(g):\n    return list(g)\ndef load(n):\n    return n"),
             cell("[f for f in range(3)]"), cell("def broken(:")]
    assert [c["defs"] for c in cells] == [["snap"], ["snap", "load"], [], None]
    report = baseline.per_level(cells)[0]
    assert (report["cells_with_defs"], report["distinct_defs"], report["redefinitions"], report["unparsed_cells"]) == (2, 2, 1, 1)
