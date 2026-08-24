from pathlib import Path

from hos.projections import harness_version_projection, meta_evidence_projection
from hos.store import ObjectStore
from helpers import publish_agent, publish_harness


def test_meta_projection_excludes_raw_task_result(tmp_path: Path) -> None:
    projection = meta_evidence_projection({
        "run_id": "run-1",
        "result": {"secret_command": "cat answer"},
        "authoritative_metrics": {"score": 1, "evaluable": True},
    })
    assert "secret_command" not in str(projection)
    assert projection["projection"]["raw_task_evidence_included"] is False


def test_meta_version_projection_exposes_lineage_only(tmp_path: Path) -> None:
    store = ObjectStore(tmp_path)
    harness = publish_harness(store, publish_agent(store, "solver", "echo"))
    projection = harness_version_projection(store, harness)
    assert projection["harness"] == harness
    assert projection["projection"]["raw_task_evidence_included"] is False
