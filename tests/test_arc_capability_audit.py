import importlib.util
import json
from pathlib import Path


def audit(root):
    path = Path(__file__).resolve().parents[1] / "tools/arc_capability_audit.py"
    spec = importlib.util.spec_from_file_location("capability_audit", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.audit_run(root)


def write(root, filename, rows):
    (root / filename).write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")


def test_created_read_and_invoked_are_not_capability_acceptance(tmp_path):
    write(tmp_path, "task-skills.jsonl", [
        {"name": "procedure", "version": 1, "status": "active"},
        {"name": "procedure", "version": 2, "status": "active"},
    ])
    write(tmp_path, "task-skill-events.jsonl", [{"event": "read", "name": "procedure"}])
    write(tmp_path, "task-tool-events.jsonl", [
        {"event": "invoked", "name": "helper", "version": 1, "status": "completed",
         "input": {"x": 1}, "output_excerpt": "2", "semantic_effect_observed": True},
    ])
    report = audit(tmp_path)
    assert report["resources"]["skills"]["unique_names"] == 1
    assert report["tool_invocations"][0]["output_excerpt"] == "2"
    assert report["acceptance"] == "requires_semantic_review"
    assert report["verified_transfer_count"] is None


def test_action_count_uses_canonical_budget_not_duplicated_bridge_events(tmp_path):
    write(tmp_path, "bridge-events.jsonl", [{"event": "action", "index": 1}] * 2)
    write(tmp_path, "execution-observations.jsonl", [{"observation_id": "execution-observation-2",
        "tool_name": "arc_action", "is_error": False,
        "arc_outcome": {"levels_completed": 1, "action_budget": {"total_used": 1}}}])
    report = audit(tmp_path)
    assert report["arc"]["actions_used"] == 1
    assert report["arc"]["levels_completed"] == 1


def test_partial_jsonl_is_reported_and_not_promoted_to_evidence(tmp_path):
    (tmp_path / "auto-research-runs.jsonl").write_text('{"run_id":', encoding="utf-8")
    report = audit(tmp_path)
    assert report["research_runs"] == []
    assert report["parse_warnings"] == [{"artifact": "auto-research-runs.jsonl", "line": 1}]
