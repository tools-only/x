from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from autoresearch_pi.arc_thin_e2e import PROJECT_ROOT, run_arc_thin_e2e


def _rows(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def _run_reflective_arc(root: Path, monkeypatch, *, level_at: int, budget: str = "100", decisions: int = 12) -> Path:
    monkeypatch.setenv("MOCK_ARC_LEVEL_AT", str(level_at))
    monkeypatch.setenv("ARC_PI_API", "openai-completions")
    monkeypatch.setenv("ARC_PI_THINKING_FORMAT", "qwen")
    monkeypatch.setenv("ARC_INPUT_MODALITIES", "text,image")
    monkeypatch.setenv("ARC_MODEL_MAX_OUTPUT_TOKENS", "12000")
    monkeypatch.setenv("PPT_DEMO_BUDGET_USD", budget)
    monkeypatch.setenv("PPT_DEMO_REQUEST_RESERVE_USD", "4.46")
    monkeypatch.setenv("PPT_DEMO_INPUT_USD_PER_MILLION", "20")
    monkeypatch.setenv("PPT_DEMO_OUTPUT_USD_PER_MILLION", "80")
    monkeypatch.setenv("PPT_DEMO_CACHE_READ_USD_PER_MILLION", "20")
    monkeypatch.setenv("PPT_DEMO_CACHE_WRITE_USD_PER_MILLION", "20")
    return run_arc_thin_e2e(
        root, arc_root=PROJECT_ROOT, game="fixture", variant="treatment", max_actions=None,
        max_decisions=decisions, experiment_timeout_seconds=600, decision_timeout_seconds=180,
        pi_provider="offline-arc-reflective-smoke", pi_model="scripted", pi_api="openai-completions",
        thinking="low", thinking_format="qwen", input_modalities="text,image", max_output_tokens=12000,
        pi_provider_extension=PROJECT_ROOT / "tools" / "arc_reflective_smoke_provider.ts",
        bridge_python=Path(sys.executable), bridge_module_paths=(PROJECT_ROOT / "tools" / "mock_arc_sdk",),
        ledger=False, critic=False, continuity="session", consolidate_after_actions=0,
        review_at_level_change=False, stall_review_after=0, spin_review_after=0,
        foundation="native", max_levels=1, extension_path=PROJECT_ROOT / "demo" / "arc_reflective_extension.ts",
    )


def test_reflective_arc_runner_uses_native_core_and_stops_after_level_one(tmp_path: Path, monkeypatch) -> None:
    root = tmp_path / "reflective-arc"
    monkeypatch.setenv("SMOKE_REJECT_FIRST_ACTION", "1")
    monkeypatch.setenv("SMOKE_QUEUE_ACTIONS", "1")
    monkeypatch.setenv("SMOKE_LENGTH_BEFORE_ACTION", "1")
    summary_path = _run_reflective_arc(root, monkeypatch, level_at=9)

    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    assert summary["passed"] is True
    assert summary["stop_reason"] == "max_levels"
    assert summary["actions"] == 9
    assert summary["length_stops"] == 1
    assert summary["length_recoveries"] == 1
    config = json.loads((root / "run-config.json").read_text(encoding="utf-8"))
    assert config["max_actions"] is None
    assert config["max_levels"] == 1
    assert config["pi_version"] == "0.87.0"

    lifecycle = _rows(root / "harness" / "lifecycle.jsonl")
    changes = [row for row in lifecycle if row.get("event") == "reflective_change" and row.get("ok")]
    for kind, name, *_ in (
        ("tool", "smoke_tool"), ("prompt", "smoke_prompt"), ("skill", "smoke-skill"),
        ("subagent", "smoke_agent"), ("memory", "smoke_memory"), ("process", "smoke_process"),
    ):
        rows = [row for row in changes if row.get("kind") == kind and row.get("name") == name]
        assert [row["op"] for row in rows] == ["define", "redefine", "restore"]
        assert [row["version"] for row in rows] == [1, 2, 3]

    uses = _rows(root / "harness" / "component_runs.jsonl")
    assert any(row.get("kind") == "tool" and row.get("name") == "smoke_tool" and row.get("version") == 2 and row.get("ok") for row in uses)
    children = _rows(root / "harness" / "consult_runs.jsonl")
    assert any(row.get("role") == "smoke_agent" and row.get("version") == 2 and row.get("ok") for row in children)
    assert any(row.get("event") == "native_read" and row.get("path") == "components/skill/smoke-skill/v2.source" for row in lifecycle)
    assert any(row.get("event") == "component_consumed" and row.get("kind") == "process"
               and row.get("name") == "smoke_process" and row.get("version") == 2 for row in lifecycle)
    for kind, name in (("tool", "smoke_tool"), ("prompt", "smoke_prompt"), ("skill", "smoke-skill"),
                       ("subagent", "smoke_agent"), ("memory", "smoke_memory"), ("process", "smoke_process")):
        assert any(row.get("event") == "native_read" and row.get("path") == f"components/{kind}/{name}/v1.source" for row in lifecycle)

    requests = _rows(root / "scripted-provider.jsonl")
    task_requests = [row for row in requests if "arc_action" in row.get("tools", [])]
    assert task_requests
    final = task_requests[-1]
    live = json.dumps({"system": final["system"], "messages": final["messages"]}, ensure_ascii=False)
    final_user_text = "\n".join(
        part.get("text", "")
        for message in final["messages"] if message.get("role") == "user"
        for part in (message.get("content") if isinstance(message.get("content"), list) else [{"text": message.get("content", "")}])
        if part.get("type", "text") == "text"
    )
    assert "Initial authored prompt text." in live
    assert "Counterevidence: none yet." in live
    assert "Fixture process text." in live
    assert "CURRENT CANONICAL ENVIRONMENT" in live
    assert '"grid":[' in final_user_text
    recent = final_user_text.split("RECENT COMPLETED ACTIONS (facts and exact refs)", 1)[-1].split("Authored memory/evidence refs:", 1)[0]
    assert len([line for line in recent.splitlines() if line.startswith("phase ")]) == 8
    assert any(part.get("type") == "image" for message in final["messages"] for part in message.get("content", []) if isinstance(message.get("content"), list))
    assert "AGENTS.md" not in live
    all_tools = {name for row in requests for name in row.get("tools", [])}
    assert "reflect_component" in all_tools
    assert not all_tools.intersection({"run_program", "consult", "read_component", "inspect", "context_manage", "self_component", "save_tool", "save_program", "promote"})

    actions = _rows(root / "harness" / "reflective-actions.jsonl")
    assert len(actions) == 9
    assert [row["environment_action_index"] for row in actions] == list(range(1, 10))
    assert all(row.get("observation_ref") and row.get("grid_ref") and row.get("image_ref") for row in actions)
    errors = _rows(root / "harness" / "errors.jsonl")
    assert [row["outcome"] for row in errors if row.get("outcome") == "rejected"] == ["rejected"]


def test_shared_guard_keeps_unknown_child_reservation_and_refuses_before_parent_dispatch(tmp_path: Path, monkeypatch) -> None:
    root = tmp_path / "unknown-child-usage"
    monkeypatch.setenv("SMOKE_UNKNOWN_CHILD_USAGE", "1")
    monkeypatch.setenv("SMOKE_CONCURRENT_CHILDREN", "1")
    summary_path = _run_reflective_arc(root, monkeypatch, level_at=3, budget="4.47", decisions=8)

    assert (root / "budget-stop.json").is_file()
    stop = json.loads((root / "budget-stop.json").read_text(encoding="utf-8"))
    assert stop["reason"] == "pre-dispatch cap"
    requests = _rows(root / "harness" / "provider-requests.jsonl")
    child = [row for row in requests if row.get("route") == "native-child"]
    assert len(child) == 1
    usage = _rows(root / "harness" / "model-usage.jsonl")
    assert any(row.get("route") == "native-child" and row.get("usage_status") == "unknown_reserved" for row in usage)
    trajectory = root / "harness" / "trajectory.jsonl"
    assert not trajectory.exists() or not _rows(trajectory)
    assert summary_path.is_file()


def test_missing_sdk_baseline_fails_protocol_preflight(tmp_path: Path, monkeypatch) -> None:
    root = tmp_path / "missing-baseline"
    monkeypatch.setenv("MOCK_ARC_NO_BASELINE", "1")
    summary_path = _run_reflective_arc(root, monkeypatch, level_at=0)

    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    assert summary["passed"] is False
    assert summary["stop_reason"] == "extension_error"
    assert "baseline_actions" in summary["error"]
    assert summary["actions_on_bridge"] == 0


def test_uncertain_action_is_not_replayed(tmp_path: Path, monkeypatch) -> None:
    root = tmp_path / "uncertain-action"
    monkeypatch.setenv("MOCK_ARC_FAIL_AFTER", "1")
    summary_path = _run_reflective_arc(root, monkeypatch, level_at=3, decisions=8)

    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    assert summary["actions"] == 1
    actions = _rows(root / "harness" / "reflective-actions.jsonl")
    assert len(actions) == 1
    errors = _rows(root / "harness" / "errors.jsonl")
    assert any(row.get("outcome") == "rejected_or_uncertain" and row.get("retry") is False for row in errors)


def test_reset_is_recorded_and_charged_before_level_stop(tmp_path: Path, monkeypatch) -> None:
    root = tmp_path / "reset-accounting"
    monkeypatch.setenv("MOCK_ARC_NOT_PLAYED", "1")
    summary_path = _run_reflective_arc(root, monkeypatch, level_at=3, decisions=8)

    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    bridge = json.loads((root / "bridge-result.json").read_text(encoding="utf-8"))
    actions = _rows(root / "harness" / "reflective-actions.jsonl")
    assert summary["stop_reason"] == "max_levels"
    assert summary["actions"] == 2
    assert bridge["actions"] == 3
    assert bridge["forced_actions"] == 1
    assert any(row.get("event") == "forced_action" and row.get("action") == "RESET"
               for row in _rows(root / "bridge-events.jsonl"))
    assert actions[0]["action_budget"]["total_used"] == 2
    assert actions[-1]["action_budget"]["total_used"] == 3


def test_win_stops_before_another_decision(tmp_path: Path, monkeypatch) -> None:
    root = tmp_path / "win-stop"
    monkeypatch.setenv("MOCK_ARC_WIN_AT", "1")
    summary_path = _run_reflective_arc(root, monkeypatch, level_at=0, decisions=10)

    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    assert summary["stop_reason"] == "win"
    assert summary["actions"] == 1


def test_aggregate_budget_is_derived_from_sdk_baseline(tmp_path: Path, monkeypatch) -> None:
    root = tmp_path / "aggregate-budget"
    monkeypatch.setenv("MOCK_ARC_BASELINE_ACTIONS", "1")
    summary_path = _run_reflective_arc(root, monkeypatch, level_at=0, decisions=10)

    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    bridge = json.loads((root / "bridge-result.json").read_text(encoding="utf-8"))
    assert summary["stop_reason"] == "budget_exhausted"
    assert summary["actions"] == 5
    assert bridge["baseline_actions"] == [1]
    assert bridge["action_budget"] == 5
