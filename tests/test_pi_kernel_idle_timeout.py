import pytest

from autoresearch_pi.pi_kernel import PiKernel, PiTurnIdleTimeout


def test_wait_for_agent_events_reports_idle_turn_without_waiting_for_full_timeout(monkeypatch):
    kernel = PiKernel(timeout=1)
    monkeypatch.setattr(kernel, "_receive_event", lambda _timeout: None)

    with pytest.raises(PiTurnIdleTimeout) as caught:
        kernel.wait_for_agent_events(timeout=0.5, idle_timeout=0.01)

    assert caught.value.idle_seconds >= 0.01
    assert caught.value.events == []


def test_a_streaming_turn_is_not_idle_when_the_projector_drops_its_deltas():
    """Pi keeps writing message_update lines while the model streams; a caller that projects them away
    must not see the turn as silent (a long reasoning response used to be aborted after the idle interval)."""
    import json
    import time

    kernel = PiKernel(timeout=1, event_projector=lambda event: None if event.get("type") == "message_update" else event)
    started = time.monotonic()

    def feed():
        # Deltas for 0.3 s, five times the idle interval, then the turn settles.
        for _ in range(30):
            kernel._queue.put(json.dumps({"type": "message_update"}))
            time.sleep(0.01)
        kernel._queue.put(json.dumps({"type": "agent_settled"}))

    import threading
    threading.Thread(target=feed, daemon=True).start()
    events = kernel.wait_for_agent_events(timeout=5, idle_timeout=0.06)
    assert [event.get("type") for event in events] == ["agent_settled"]
    assert time.monotonic() - started >= 0.25
