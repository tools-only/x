"""Project policy for Jev-backed Self-Harness component routing."""

from __future__ import annotations

from collections.abc import MutableMapping
from typing import Literal, cast


JEV_ROUTING_ENV = "PI_AUTORESEARCH_JEV_ROUTING"
JevRoutingMode = Literal["disabled", "shadow", "active"]
_ROUTING_MODES = frozenset({"disabled", "shadow", "active"})


def jev_routing_mode(environment: MutableMapping[str, str]) -> JevRoutingMode:
    """Return the project routing mode, defaulting to a no-call kill switch."""
    raw = str(environment.get(JEV_ROUTING_ENV, "disabled")).strip().lower()
    if raw in _ROUTING_MODES:
        return cast(JevRoutingMode, raw)
    raise ValueError(
        f"{JEV_ROUTING_ENV} must be disabled, shadow, or active; got {raw!r}"
    )


def apply_jev_routing_policy(environment: MutableMapping[str, str]) -> JevRoutingMode:
    """Canonicalize the project switch inherited by every Pi process.

    The project selector owns the one Self-Harness component pool. Stock
    pi-jev automatic tool/skill routing is kept off so it cannot create a
    competing selection surface when the package is also installed globally.
    """
    mode = jev_routing_mode(environment)
    environment[JEV_ROUTING_ENV] = mode
    environment["PI_JEV_AUTO"] = "0"
    return mode
