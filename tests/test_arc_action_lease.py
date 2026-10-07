import threading

import pytest

from autoresearch_pi.arc_agi_3_bridge import ArcBridge, public_state_fingerprint


def _bridge():
    bridge = object.__new__(ArcBridge)
    bridge._lock = threading.RLock()
    bridge.action_token = "owner-secret"
    bridge._leases = {}
    frame = {"frames": [[[0]]], "state": "NOT_FINISHED", "levels_completed": 0,
             "win_levels": 1, "available_actions": ["ACTION1"],
             "agent_available_actions": ["ACTION1"], "full_reset": False}
    bridge._frame = lambda: frame.copy()
    calls = []

    def step(payload):
        calls.append(payload)
        frame["frames"] = [[[len(calls)]]]
        return frame.copy()

    bridge.step = step
    return bridge, frame, calls


def test_explicit_child_lease_is_bounded_and_blocks_owner():
    bridge, frame, calls = _bridge()
    fingerprint = public_state_fingerprint(frame)["fingerprint"]
    with pytest.raises(PermissionError):
        bridge.issue_action_lease(token="wrong", max_actions=2,
                                  expected_fingerprint=fingerprint)
    lease = bridge.issue_action_lease(token="owner-secret", max_actions=2,
                                      expected_fingerprint=fingerprint)
    with pytest.raises(PermissionError):
        bridge.authorized_step({"action": "ACTION1"}, token="owner-secret")
    with pytest.raises(PermissionError):
        bridge.authorized_step({"action": "ACTION1"}, token="wrong")
    bridge.authorized_step({"action": "ACTION1"}, token=lease["token"])
    bridge.authorized_step({"action": "ACTION1"}, token=lease["token"])
    with pytest.raises(PermissionError):
        bridge.authorized_step({"action": "ACTION1"}, token=lease["token"])
    assert len(calls) == 2
    bridge.revoke_action_lease(owner_token="owner-secret", lease_token=lease["token"])
    bridge.authorized_step({"action": "ACTION1"}, token="owner-secret")
    assert len(calls) == 3


def test_child_lease_rejects_stale_state_and_reserves_uncertain_failure():
    bridge, frame, calls = _bridge()
    fingerprint = public_state_fingerprint(frame)["fingerprint"]
    lease = bridge.issue_action_lease(token="owner-secret", max_actions=1,
                                      expected_fingerprint=fingerprint)
    frame["frames"] = [[[4]]]
    with pytest.raises(ValueError, match="stale"):
        bridge.authorized_step({"action": "ACTION1"}, token=lease["token"])
    assert calls == []
    bridge.revoke_action_lease(owner_token="owner-secret", lease_token=lease["token"])
    lease = bridge.issue_action_lease(token="owner-secret", max_actions=1,
                                      expected_fingerprint=public_state_fingerprint(frame)["fingerprint"])

    def uncertain(_payload):
        raise RuntimeError("SDK response unknown")

    bridge.step = uncertain
    with pytest.raises(RuntimeError, match="unknown"):
        bridge.authorized_step({"action": "ACTION1"}, token=lease["token"])
    with pytest.raises(PermissionError, match="exhausted"):
        bridge.authorized_step({"action": "ACTION1"}, token=lease["token"])
