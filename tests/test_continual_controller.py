from pathlib import Path

from hos.controllers.self_evolve.continual_harness.controller import ContinualHarnessController


def test_non_evaluable_task_run_does_not_trigger_evolution(tmp_path: Path, monkeypatch) -> None:
    controller = object.__new__(ContinualHarnessController)
    from hos.controllers.self_evolve.continual_harness.stores import EvolutionStores

    controller.stores = EvolutionStores(tmp_path)
    controller.stagnation_runs = 1

    result = controller.record_task_run(
        {
            "status": "failed",
            "authoritative_metrics": {"score": 0, "episode_runs": 0, "evaluable": False},
        },
        harness=None,
    )

    assert result == {
        "trigger": "not_evaluable",
        "skipped": True,
        "reason": "task run did not produce authoritative evaluable evidence",
    }
    assert controller.stores.generations.read() == []
