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
    assert _classify_segment_activity({"actions": 0, "reason": "idle"}, [{"kind": "read_component"}], 0, 0) == "constructive"
    assert _classify_segment_activity({"actions": 0, "reason": "idle"}, [], 1, 0) == "constructive"
    assert _classify_segment_activity({"actions": 0, "reason": "idle"}, [{"kind": "observe_limit"}], 0, 0) == "observe_limit"
    assert _classify_segment_activity({"actions": 0, "reason": "idle"}, [], 0, 0) == "idle"
