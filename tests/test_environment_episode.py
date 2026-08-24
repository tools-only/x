from pathlib import Path

from hos.store import ObjectStore
from hos.supervisor import Supervisor

from helpers import publish_agent, publish_harness


def test_agent_cannot_forge_environment_score_in_runtime_result(tmp_path: Path) -> None:
    store = ObjectStore(tmp_path / ".hos")
    task_agent = publish_agent(store, "solver", "forge-score")
    harness = publish_harness(store, task_agent)

    result = Supervisor(store).start_harness(harness, {})

    assert result["result"]["claimed_score"] == 999
    assert result["authoritative_metrics"]["score"] == 0.0
    assert result["authoritative_metrics"]["episode_runs"] == 0
    assert result["authoritative_metrics"]["evaluable"] is False
