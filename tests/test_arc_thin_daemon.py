import json

from autoresearch_pi.daemon_service import DaemonService
from autoresearch_pi.arc_thin_daemon import attach_arc_monitors


def test_success_material_does_not_interrupt_and_failure_is_visible(tmp_path):
    def append(path, row):
        target = tmp_path / path
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("a", encoding="utf-8") as out:
            out.write(json.dumps(row) + "\n")

    daemon = DaemonService(tmp_path)
    attach_arc_monitors(daemon)
    append(".harness/components.jsonl", {"path": "tools/reuse.py", "version": 1, "by": "agent"})
    append("harness/component_runs.jsonl", {"kind": "tool", "path": "tools/reuse.py", "version": 1, "ok": True})
    append("harness/working_set.jsonl", {"decision": 2, "active_prompt_versions": {"prompts/process/reuse.md": 1}})
    assert daemon.refresh() is None
    append("harness/errors.jsonl", {"hook": "python", "message": "fixture failure"})
    assert daemon.refresh() is None
    material = (tmp_path / "harness/process.md").read_text(encoding="utf-8")
    assert "## Failures\n- python: fixture failure" in material
    assert "## Successes\n- shown prompts/process/reuse.md v1" in material
    assert "called tools/reuse.py v1 successfully" in material
    append("harness/errors.jsonl", {"hook": "python", "message": "fixture failure"})
    assert daemon.refresh() is not None
    restarted = DaemonService(tmp_path)
    attach_arc_monitors(restarted)
    restarted.refresh()
    assert "called tools/reuse.py" in (tmp_path / "harness/process.md").read_text(encoding="utf-8")


def test_success_signal_and_checkpoint_use_existing_mounts(tmp_path):
    daemon = DaemonService(tmp_path)
    attach_arc_monitors(daemon)
    signals = tmp_path / "harness/daemon_signals.jsonl"
    signals.write_text(json.dumps({"key": "reuse-positive", "outcome": "success", "reason": "reuse observed"}) + "\n", encoding="utf-8")
    assert daemon.refresh() is None
    assert "reuse observed" in (tmp_path / "harness/process.md").read_text(encoding="utf-8")
    checkpoint = tmp_path / "harness/python_session.jsonl"
    checkpoint.write_text(json.dumps({"event": "not_saved"}) + "\n", encoding="utf-8")
    assert daemon.refresh() is None
    assert "checkpoint: not_saved" in (tmp_path / "harness/process.md").read_text(encoding="utf-8")
    # A partial line is not a committed event; restart must not count it again.
    with checkpoint.open("a", encoding="utf-8") as out:
        out.write('{"event":')
    assert daemon.refresh() is None
    restarted = DaemonService(tmp_path)
    attach_arc_monitors(restarted)
    assert restarted.refresh() is None
