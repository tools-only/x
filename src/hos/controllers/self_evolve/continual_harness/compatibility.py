from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ContinualHarnessCompatibility:
    """Compatibility contract for reproducing the external algorithm semantics."""

    name: str = "external-v1"
    evolution_order: tuple[str, ...] = ("prompt", "skills", "subagents", "memory")
    mutation_visibility: str = "staged"
    commit_mode: str = "component-atomic"
    trigger_semantics: str = "external-v1"

    def __post_init__(self) -> None:
        if self.mutation_visibility != "staged":
            raise ValueError("external-v1 requires staged mutation visibility")
        if self.commit_mode not in {"component-atomic", "generation-atomic"}:
            raise ValueError("unsupported Continual Harness commit mode")
        if set(self.evolution_order) != {"prompt", "skills", "subagents", "memory"}:
            raise ValueError("evolution_order must contain the four Harness components")
