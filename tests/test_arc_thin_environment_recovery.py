from autoresearch_pi.arc_thin_e2e import _environment_failure_can_recover


def test_uncertain_environment_access_is_recoverable_but_unrelated_fatal_is_not():
    rows = [dict(environment=True, hook="arc_action:environment"),
            dict(fatal=True, hook="before_agent_start:/state", message="ARC environment access failed: missing frame")]
    assert _environment_failure_can_recover(rows, {"status": "uncertain"})
    assert not _environment_failure_can_recover(rows, {"status": "ready"})
    assert not _environment_failure_can_recover(rows, None)
    assert not _environment_failure_can_recover(rows + [dict(fatal=True, hook="context")], {"status": "uncertain"})
    assert not _environment_failure_can_recover(rows[1:], {"status": "uncertain"})
