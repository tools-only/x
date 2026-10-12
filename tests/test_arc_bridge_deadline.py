"""SDK boundary diagnostics: fake SDK, real bridge concurrency and HTTP."""
import json
import threading
import time
from http.server import ThreadingHTTPServer
from types import SimpleNamespace
from urllib.request import urlopen

import pytest

from autoresearch_pi.arc_agi_3_bridge import ArcBridge, ArcEnvironmentError, _make_handler
from autoresearch_pi.arc_thin_e2e import _bridge_state


def make_bridge(tmp_path, step):
    bridge = object.__new__(ArcBridge)
    bridge.root = tmp_path
    bridge.closed = False
    bridge.actions = bridge.forced_actions = 0
    bridge.max_actions = 10
    bridge.level_action_counts = [0]
    bridge.baseline_actions = []
    bridge.action_budget_multiplier = 5
    bridge.action_token = "owner"
    bridge._leases = {}
    action = SimpleNamespace(name="ACTION1", action_data=SimpleNamespace(model_dump=lambda: {}), is_complex=lambda: False)
    bridge.game_action = SimpleNamespace(from_name=lambda _: action)
    bridge.environment = SimpleNamespace(step=step)
    bridge.adapter = SimpleNamespace(record_action=lambda _: None)
    bridge._lock = threading.RLock()
    bridge._events = []
    bridge._events_lock = threading.Lock()
    bridge._disk_events_available = True
    bridge.sdk_timeout_seconds = 0.15
    bridge.close_timeout_seconds = 0.05
    bridge._frame = lambda: {"state": "NOT_FINISHED", "levels_completed": 0, "frames": [[[bridge.actions]]],
                             "agent_available_actions": ["ACTION1"]}
    bridge.card_id = "fixture"
    bridge._close_result = None
    bridge.arcade = SimpleNamespace(close_scorecard=lambda _: None)
    return bridge


def test_hanging_action_health_timeout_and_late_result_cannot_commit(tmp_path):
    entered, release, returned = threading.Event(), threading.Event(), threading.Event()
    calls, errors = [], []

    def hanging(*args, **kwargs):
        calls.append(1)
        entered.set()
        release.wait(5)
        returned.set()
        return object()

    bridge = make_bridge(tmp_path, hanging)
    server = ThreadingHTTPServer(("127.0.0.1", 0), _make_handler(bridge))
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    base = f"http://127.0.0.1:{server.server_port}"

    def act():
        try:
            bridge.authorized_step({"action": "ACTION1"}, token="owner")
        except ArcEnvironmentError as exc:
            errors.append(exc)

    actor = threading.Thread(target=act)
    actor.start()
    try:
        assert entered.wait(1)
        with urlopen(base + "/health", timeout=1) as response:
            assert json.load(response)["status"] == "busy"
        assert _bridge_state(base) is None
        for method in (bridge.state, bridge.close):
            with pytest.raises(ArcEnvironmentError):
                method()
        actor.join(1)
        assert not actor.is_alive()
        assert errors[0].details["type"] == "EnvironmentCallTimeout"
        assert "hanging" in errors[0].details["traceback"]
        assert bridge.health()["status"] == "uncertain"
        with pytest.raises(ArcEnvironmentError):
            bridge.authorized_step({"action": "ACTION1"}, token="owner")
        release.set()
        assert returned.wait(1)
        assert bridge.actions == 0
        assert len(calls) == 1
        assert [e["event"] for e in bridge.events()["events"]] == ["environment_call_started", "environment_error"]
        with pytest.raises(ArcEnvironmentError):
            bridge.state()
    finally:
        release.set()
        actor.join(1)
        server.shutdown()
        server.server_close()
        server_thread.join(1)


@pytest.mark.parametrize("failure", [None, OSError("remote outcome unavailable")])
def test_uncertain_sdk_result_never_retries(tmp_path, failure):
    calls = []
    def step(*args, **kwargs):
        calls.append(1)
        if isinstance(failure, Exception):
            raise failure
        return failure
    bridge = make_bridge(tmp_path, step)
    for _ in range(2):
        with pytest.raises(ArcEnvironmentError):
            bridge.authorized_step({"action": "ACTION1"}, token="owner")
    assert bridge.actions == 0 and len(calls) == 1
    assert bridge.health()["status"] == "uncertain"


def test_normal_action_and_idempotent_close(tmp_path):
    bridge = make_bridge(tmp_path, lambda *args, **kwargs: object())
    result = bridge.authorized_step({"action": "ACTION1"}, token="owner")
    assert result["action_budget"]["total_used"] == 1
    assert bridge.health()["status"] == "ready"
    first = bridge.close()
    assert bridge.close() == first
    assert bridge.health()["status"] == "closed"


def test_close_sdk_hang_has_total_deadline(tmp_path):
    release = threading.Event()
    bridge = make_bridge(tmp_path, lambda *args, **kwargs: object())
    bridge.arcade.close_scorecard = lambda _: release.wait(5)
    started = time.monotonic()
    try:
        with pytest.raises(ArcEnvironmentError, match="exceeded"):
            bridge.close()
        assert time.monotonic() - started < 1
        assert bridge.health()["status"] == "uncertain"
        assert not bridge.closed
    finally:
        release.set()


def test_close_404_is_explicit_unknown_and_is_not_replayed_on_shutdown(tmp_path):
    calls=[]
    class NotFound(OSError):
        response=SimpleNamespace(status_code=404)
    def close(_):
        calls.append('close'); raise NotFound('scorecard missing')
    bridge=make_bridge(tmp_path, lambda *a, **kw: object())
    bridge.arcade.close_scorecard=close
    bridge.arcade.get_scorecard=lambda card: None
    result=bridge.close()
    assert result['close_status']=='failed'
    assert result['scorecard_verified'] is False
    assert result['close_http_status']==404
    assert bridge.closed is False
    assert bridge.close()==result
    assert calls==['close']


def test_close_network_failure_has_a_finite_retry_and_a_verified_result(tmp_path):
    calls=[]
    def close(_):
        calls.append(1)
        if len(calls)==1: raise OSError('temporary connection failure')
        return SimpleNamespace(model_dump=lambda **kw: {'score':1})
    bridge=make_bridge(tmp_path, lambda *a, **kw: object())
    bridge.arcade.close_scorecard=close
    result=bridge.close()
    assert len(calls)==2 and result['close_status']=='closed' and result['scorecard_verified']
