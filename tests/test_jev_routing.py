from __future__ import annotations

import pytest

from autoresearch_pi.jev_routing import (
    JEV_ROUTING_ENV,
    apply_jev_routing_policy,
)


@pytest.mark.parametrize("mode", ["disabled", "shadow", "active"])
def test_jev_routing_accepts_the_three_project_modes(mode: str) -> None:
    env = {JEV_ROUTING_ENV: mode, "PI_JEV_AUTO": "1"}

    assert apply_jev_routing_policy(env) == mode
    assert env[JEV_ROUTING_ENV] == mode
    assert env["PI_JEV_AUTO"] == "0"


def test_jev_routing_defaults_to_disabled() -> None:
    env = {"PI_JEV_AUTO": "1"}

    assert apply_jev_routing_policy(env) == "disabled"
    assert env[JEV_ROUTING_ENV] == "disabled"
    assert env["PI_JEV_AUTO"] == "0"


def test_jev_routing_rejects_ambiguous_values() -> None:
    with pytest.raises(ValueError, match=JEV_ROUTING_ENV):
        apply_jev_routing_policy({JEV_ROUTING_ENV: "enabled"})
