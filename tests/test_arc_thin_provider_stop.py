import json
from pathlib import Path

from autoresearch_pi.arc_thin_e2e import (
    _provider_error,
    _provider_error_message,
    _provider_error_stops,
)


def _events(path: Path):
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def test_three_identical_recorded_refusals_stop_as_provider_error():
    path = Path("D:/autoresearch_pi_project/runs/arc-r1-20261016/su15-r1-B2/arc-run/pi-events.jsonl")
    errors = []
    refusals = []
    for event in _events(path):
        message = event.get("message") or {}
        if event.get("type") == "message_end" and message.get("role") == "assistant" and message.get("stopReason") == "error":
            refusal = _provider_error([event])
            if refusal:
                refusals.append(refusal)
    run = []
    stop_reasons = []
    for refusal in refusals:
        run, stopped = _provider_error_stops(run, refusal, 3)
        stop_reasons.append("provider_error" if stopped else None)
        if stopped:
            break
    assert len(refusals) >= 3
    assert refusals[0] == refusals[1] == refusals[2]
    assert stop_reasons[:3] == [None, None, "provider_error"]


def test_p0_outage_turns_are_not_provider_refusals_or_stop_counters():
    root = Path("D:/autoresearch_pi_project/runs/arc-goal-admission-p0-su15-20261021")
    observed_timeouts = []
    for arm, low, high in [
        ("ga-p0-on-1", 1792599600000, 1792599960000),
        ("ga-p0-shadow-1", 1792600200000, 1792600560000),
    ]:
        events = _events(root / arm / "arc-run/pi-events.jsonl")
        transport = [event for event in events
                     if event.get("type") == "message_end"
                     and (event.get("message") or {}).get("role") == "assistant"
                     and low <= int((event.get("message") or {}).get("timestamp") or 0) <= high
                     and _provider_error_message([event])]
        observed_timeouts.append(transport)
        for event in transport:
            assert _provider_error([event]) is None
            assert _provider_error_stops([], _provider_error([event]), 3) == ([], False)
    assert observed_timeouts[0]  # on #106->#107 records a timed-out transport attempt
    assert observed_timeouts[1] == []  # shadow #125->#126 has no provider reply during the outage window


def test_empty_transport_turn_does_not_increment_or_stop_provider_error():
    assert _provider_error([]) is None
    assert _provider_error_stops([], None, 3) == ([], False)
    assert _provider_error_stops(["same refusal"], None, 3) == ([], False)
