from datetime import datetime
import inspect
import json
from pathlib import Path

import pytest

from autoresearch_pi.arc_thin_e2e import (
    NORMAL_STOPS,
    _idle_stall_due,
    _max_levels_reached,
    _recover_native_turn,
    run_arc_thin_e2e,
)
from autoresearch_pi.pi_kernel import PiTurnIdleTimeout


def test_idle_stop_fires_while_native_wait_is_blocked_and_action_resets_clock():
    class BlockedKernel:
        def abort(self):
            pytest.fail("idle stop must be decided before recovery abort")

    def blocked_wait(_message):
        raise PiTurnIdleTimeout("still waiting", events=[], idle_seconds=2700)

    with pytest.raises(TimeoutError, match="idle_stall"):
        _recover_native_turn(blocked_wait, "wait", BlockedKernel(), {}, lambda: False,
                             idle_stalled=lambda: _idle_stall_due(100, 2800, 45, 12, 12))

    assert _idle_stall_due(100, 2799, 45, 12, 12) is False
    assert _idle_stall_due(100, 2800, 45, 12, 13) is False
    assert _idle_stall_due(100, 2800, 45, 12, 12) is True
    assert _idle_stall_due(100, 10000, 0, 12, 12) is False
    assert "idle_stall" not in NORMAL_STOPS


def test_recorded_fixture_idle_windows_cross_45_minutes():
    root = Path(__file__).resolve().parents[1] / "demo" / "fixtures" / "goal-r1"
    gaps = {}
    for arm in ("ga-p0-on-1", "ga-p0-shadow-1"):
        rows = [json.loads(line) for line in (root / arm / "harness" / "trajectory.jsonl").read_text(encoding="utf-8").splitlines() if line]
        gaps[arm] = [(rows[i - 1]["n"], rows[i]["n"],
                      (datetime.fromisoformat(rows[i]["t"].replace("Z", "+00:00")) -
                       datetime.fromisoformat(rows[i - 1]["t"].replace("Z", "+00:00"))).total_seconds())
                     for i in range(1, len(rows))]
    assert max(gap[2] for gap in gaps["ga-p0-on-1"]) > 45 * 60
    # The shadow fixture ends at #125 (14:15Z); it contains no observed >45-minute gap.
    assert max(gap[2] for gap in gaps["ga-p0-shadow-1"]) < 45 * 60


def test_max_levels_two_stops_at_level_two_before_another_turn():
    assert _max_levels_reached(1, 2) is False
    assert _max_levels_reached(2, 2) is True
    assert _max_levels_reached(2, None) is False
    loop = inspect.getsource(run_arc_thin_e2e)
    cap = loop.index("if _max_levels_reached(int(state.get(\"levels_completed\") or 0), max_levels):")
    next_turn = loop.index("events = recover_length(prompt, safe_turn(prompt))", cap)
    assert cap < next_turn
