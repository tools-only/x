"""A parent-selected observation window grants its bodies, not the whole archive."""
import json
from pathlib import Path

from test_auto_research_self_harness_smoke import _child_env
from test_pi_external_benchmark_native import _pi_cli, _run_fixture
from test_task_research_context import records, results


def test_selected_recent_observation_can_be_paged_but_unselected_resources_cannot(tmp_path):
    _, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    report = {"format": "auto-research-report-v1", "status": "inconclusive",
              "conclusion": "Check selected observation access, not game quality.",
              "findings": [], "evidence_refs": [], "alternatives": [], "limitations": [],
              "validation_plan": "No semantic capability claim.", "harness_proposals": []}
    events = _run_fixture(tmp_path, "treatment",
        extra_extensions=[project / "tests/pi_non_arc_task_subagents.ts"],
        extra_env=_child_env(project, cli, report, [
            {"name": "task_resource", "arguments": {"action": "read", "ref": ref, "limit": 20000}}
            for ref in ["observation:execution-observation-2@v1", "observation:execution-observation-1@v1", "memory:private@v1"]
        ] + [{"name": "submit_research_report", "arguments": {"report": report}}]),
        steps=[
            {"name": "task_memory", "arguments": {"action": "upsert", "key": "private", "content": "UNSELECTED_MEMORY_BODY"}},
            {"name": "benchmark_probe", "arguments": {}},
            {"name": "benchmark_probe", "arguments": {}},
            {"name": "auto_research", "arguments": {"question": "Inspect selected latest evidence.",
                "interaction_mode": "blocking", "context_window": {"recent_observations": 1, "max_chars": 1200}}},
        ])
    assert not results(events, "auto_research")[-1].get("isError")
    reads = [row["resource_ref"] for row in records(tmp_path, "task-resource-access.jsonl")
             if row.get("reader") == "subagent" and row.get("operation") == "paged_read"]
    assert "observation:execution-observation-2@v1" in reads
    assert "observation:execution-observation-1@v1" not in reads
    assert "memory:private@v1" not in reads
    contexts = json.dumps(records(tmp_path, "subagent-provider-contexts.jsonl"))
    assert "resource was not granted" in contexts
    assert "UNSELECTED_MEMORY_BODY" not in contexts
