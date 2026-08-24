from pathlib import Path
import json

import pytest

from hos.controllers.self_evolve.continual_harness.compatibility import ContinualHarnessCompatibility
from hos.controllers.self_evolve.continual_harness.stores import EvolutionStores


def test_external_profile_preserves_component_order() -> None:
    profile = ContinualHarnessCompatibility()
    assert profile.evolution_order == ("prompt", "skills", "subagents", "memory")
    assert profile.mutation_visibility == "staged"
    assert profile.commit_mode == "component-atomic"


def test_profile_rejects_incomplete_order() -> None:
    with pytest.raises(ValueError):
        ContinualHarnessCompatibility(evolution_order=("prompt",))


def test_stores_expose_working_components(tmp_path: Path) -> None:
    snapshot = EvolutionStores(tmp_path).snapshot()
    assert set(snapshot) == {"prompt", "skills", "subagents", "memory"}


def test_stores_migrate_legacy_string_prompt(tmp_path: Path) -> None:
    tmp_path.mkdir(parents=True, exist_ok=True)
    (tmp_path / "prompt.json").write_text(json.dumps("legacy policy"), encoding="utf-8")

    stores = EvolutionStores(tmp_path)

    assert stores.prompt.read() == {"content": "legacy policy"}
