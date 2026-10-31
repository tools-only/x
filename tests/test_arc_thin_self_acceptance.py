from autoresearch_pi.arc_thin_self_acceptance import self_acceptance


def test_hard_gates_use_versioned_successful_tool_calls_only():
    created = [{"kind": "tool", "path": "tools/helper.py", "version": 1, "by": "agent"}]
    assert not self_acceptance(created, [])['L0']
    call = {"kind": "tool", "path": "tools/helper.py", "version": 1, "ok": True}
    for bad in ({**call, "ok": False}, {**call, "readonly": True}, {**call, "version": 2}, {**call, "kind": "save"}):
        assert not self_acceptance(created, [bad])['L0']
    assert self_acceptance(created, [call])['L0']
    assert not self_acceptance(created, [call])['L1']
    assert self_acceptance(created, [call, call])['L1']
    assert 'unverified' in self_acceptance(created, [call, call])['L2']
