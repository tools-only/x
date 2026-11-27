"""Segment-boundary scan of model-authored work/ files and the run-end git snapshot."""
import json

from autoresearch_pi.arc_layered_e2e import _git_snapshot, _scan_work


def test_scan_reports_changes_once_and_syntax_errors(tmp_path):
    harness = tmp_path / "harness"
    harness.mkdir()
    work = tmp_path / "work"
    (work / "harness" / "lib").mkdir(parents=True)
    (work / "world_model.py").write_text("def predict(frame, action):\n    return frame\n", encoding="utf-8")
    (work / "harness" / "lib" / "broken.py").write_text("def oops(:\n", encoding="utf-8")
    seen: dict[str, str] = {}
    changes, errors = _scan_work(tmp_path, harness, 1, seen)
    assert changes == 2
    assert errors and errors[0].startswith("work/harness/lib/broken.py: syntax error line 1")
    again = _scan_work(tmp_path, harness, 2, seen)
    assert again == (0, [])
    (work / "world_model.py").write_text("def predict(frame, action):\n    return None\n", encoding="utf-8")
    changes, errors = _scan_work(tmp_path, harness, 3, seen)
    assert (changes, errors) == (1, [])
    rows = [json.loads(line) for line in (harness / "evolution.jsonl").read_text(encoding="utf-8").splitlines()]
    assert [(row["segment"], row["path"], row["status"] == "ok") for row in rows] == [
        (1, "work/harness/lib/broken.py", False), (1, "work/world_model.py", True), (3, "work/world_model.py", True)]


def test_git_snapshot_is_none_without_files_and_never_raises(tmp_path):
    assert _git_snapshot(tmp_path) is None
    work = tmp_path / "work"
    work.mkdir()
    assert _git_snapshot(tmp_path) is None
    (work / "notes.py").write_text("VALUE = 1\n", encoding="utf-8")
    snapshot = _git_snapshot(tmp_path)
    assert snapshot is None or (isinstance(snapshot, str) and len(snapshot) >= 7)


def test_classify_segment_activity_decouples_constructive_work_and_length():
    from autoresearch_pi.arc_layered_e2e import _classify_segment_activity

    assert _classify_segment_activity({"actions": 1, "reason": "action"}, [], 0, 0) == "acted"
    assert _classify_segment_activity({"actions": 0, "reason": "length"}, [], 0, 0) == "length"
    assert _classify_segment_activity({"actions": 0, "reason": "length_exhausted"}, [], 0, 0) == "length_exhausted"
    assert _classify_segment_activity({"actions": 0, "reason": "idle"}, [{"kind": "component_change"}], 0, 0) == "constructive"
    assert _classify_segment_activity({"actions": 0, "reason": "idle"}, [{"kind": "consult", "ok": True}], 0, 0) == "constructive"
    assert _classify_segment_activity({"actions": 0, "reason": "idle"}, [{"kind": "tool_published"}], 0, 0) == "constructive"
    assert _classify_segment_activity({"actions": 0, "reason": "idle"}, [{"kind": "tool_decorated"}], 0, 0) == "constructive"
    assert _classify_segment_activity({"actions": 0, "reason": "idle"}, [{"kind": "read_component"}], 0, 0) == "constructive"
    assert _classify_segment_activity({"actions": 0, "reason": "idle"}, [], 1, 0) == "constructive"
    assert _classify_segment_activity({"actions": 0, "reason": "idle"}, [{"kind": "observe_limit"}], 0, 0) == "observe_limit"
    assert _classify_segment_activity({"actions": 0, "reason": "idle"}, [], 0, 0) == "idle"


def test_flush_final_level_replay_clamps_win_level_and_renders_components(tmp_path):
    from autoresearch_pi.arc_layered_e2e import _flush_final_level_replay

    harness = tmp_path / "harness"
    comp_dir = harness / "components" / "memory" / "rules"
    comp_dir.mkdir(parents=True)
    (harness / "components" / "HEAD.json").write_text(json.dumps({"memory/rules": 1}), encoding="utf-8")
    (comp_dir / "v1.json").write_text(
        json.dumps({"kind": "memory", "name": "rules", "version": 1, "body": "Confirmed: A", "verify": {"up": "t.action == 'UP'"}}),
        encoding="utf-8",
    )
    (harness / "decisions.jsonl").write_text(
        "\n".join([
            json.dumps({"step": 1, "level": 1, "action": "UP", "tries": 0, "same": False, "new": True, "changed": True, "death": False, "level_up": True}),
            json.dumps({"step": 2, "level": 2, "action": "RIGHT", "tries": 0, "same": False, "new": True, "changed": True, "death": False, "level_up": True}),
        ]) + "\n",
        encoding="utf-8",
    )
    rows = [
        {"kind": "memory_verify_sync", "name": "rules", "version": 1, "stats": {"rules/up": {"support": 1, "counter": 0, "checked": 1, "witness": None, "error": None}}},
        {"kind": "python", "level": 2, "error": None, "truncated": False},
    ]
    state = {"state": "WIN", "levels_completed": 2, "win_levels": 2, "action_budget": {"total_used": 2}}
    out = _flush_final_level_replay(tmp_path, state, rows, {})
    assert out == tmp_path / "work" / "replay" / "level_2.md"
    text = out.read_text(encoding="utf-8")
    assert "# Level 2 review" in text
    assert "Outcome: WIN; actions used 2; completed 2/2." in text
    assert "memory/rules v1 [verify: up: 1/1 held]" in text
    assert "## Editable capability space" in text
