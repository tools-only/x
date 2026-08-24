from __future__ import annotations

from .self_evolve.continual_harness.controller import ContinualHarnessController


def controller_names() -> tuple[str, ...]:
    return ("continual-harness",)


def create_controller(name: str, **kwargs):
    if name == "continual-harness":
        return ContinualHarnessController(**kwargs)
    raise ValueError(f"unknown controller: {name}")
