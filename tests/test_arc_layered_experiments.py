import hashlib
import json

import pytest

from autoresearch_pi.arc_layered_experiments import export_transfer, seed_transfer, snapshot_prefix, seed_prefix


def test_transfer_resets_target_evidence_and_excludes_local_history(tmp_path):
    source = tmp_path / "source"
    folder = source / "harness" / "components" / "memory" / "rule"
    folder.mkdir(parents=True)
    item = dict(kind="memory", name="rule", version=4, body="prior", summary="", scope="game", status="confirmed",
                hash=hashlib.sha256(b"prior").hexdigest())
    (folder / "v4.json").write_text(json.dumps(item))
    (folder.parent.parent / "HEAD.json").write_text(json.dumps({"memory/rule": 4}))
    (source / "run-config.json").write_text(json.dumps({"game": "source-task"}))
    (source / ".env").write_text("SECRET=must-not-transfer")
    manifest = tmp_path / "transfer.json"
    exported = export_transfer(source, manifest)
    assert len(exported["items"]) == 1
    target = tmp_path / "target"
    receipt = seed_transfer(manifest, target, "other-task")
    imported = json.loads((target / "harness/components/memory/rule/v1.json").read_text())
    assert imported["status"] == "provisional"
    assert imported["version"] == 1
    assert imported["source_version"] == 4
    assert receipt["source_game"] == "source-task"
    assert not (target / ".env").exists()
    assert not (target / "harness/components/stats.json").exists()
    with pytest.raises(ValueError, match="different source"):
        seed_transfer(manifest, tmp_path / "same", "source-task")
    with pytest.raises(ValueError, match="fresh"):
        seed_transfer(manifest, target, "other-task")


def test_transfer_corruption_fails_before_target_writes(tmp_path):
    manifest = tmp_path / "bad.json"
    manifest.write_text(json.dumps({"format": "arc-layered-transfer-v1", "source_game": "a", "items": [
        dict(kind="tool", name="probe", body="modified", hash="0" * 64, version=1, scope="game", status="confirmed")
    ]}))
    target = tmp_path / "target"
    with pytest.raises(ValueError, match="integrity"):
        seed_transfer(manifest, target, "b")
    assert not target.exists()


def test_matched_prefix_is_identical_and_corruption_is_rejected(tmp_path):
    source = tmp_path / "source"
    source.mkdir()
    session = source / "session.jsonl"
    session.write_text('{"type":"session"}\n')
    (source / "work").mkdir()
    (source / "work" / "notes.md").write_text("hypothesis")
    events = [{"event": "action", "index": 1, "action": "ACTION1", "coordinates": {},
               "frame": {"frames": [[[0, 1]]]}}]
    snapshot = tmp_path / "snapshot"
    snapshot_prefix(source, snapshot, "task", events, session)
    left, right = tmp_path / "left", tmp_path / "right"
    a = seed_prefix(snapshot, left, "task")
    b = seed_prefix(snapshot, right, "task")
    assert a["prefix_digest"] == b["prefix_digest"]
    assert a["continuation_mode"] == "matched-cold-runtime"
    assert (left / "session.jsonl").read_bytes() == (right / "session.jsonl").read_bytes()
    assert json.loads((left / "fork-replay.jsonl").read_text())["grid"] == [[0, 1]]
    (snapshot / "work" / "notes.md").write_text("tampered")
    with pytest.raises(ValueError, match="integrity"):
        seed_prefix(snapshot, tmp_path / "bad", "task")
    with pytest.raises(ValueError, match="uncertain"):
        snapshot_prefix(source, tmp_path / "uncertain", "task", [{"event": "environment_error"}], session)


def test_compare_pair_supports_custom_switch(tmp_path):
    from autoresearch_pi.arc_layered_experiments import compare_pair
    left, right = tmp_path / "a", tmp_path / "b"
    for root, evo in ((left, "0"), (right, "1")):
        root.mkdir()
        (root / "fork.json").write_text(json.dumps({"prefix_digest": "abc"}))
        (root / "run-config.json").write_text(json.dumps({
            "game": "su15", "model": "qwen", "provider": "az", "thinking": "medium", "profile": "qwen27b-harness",
            "config": "api-research", "extension_env": {"ARC_LAYERED_EVOLUTION": evo},
        }))
        (root / "summary.json").write_text(json.dumps({"stop_reason": "win", "levels_completed": 2}))
    pair = compare_pair(left, right, switch="ARC_LAYERED_EVOLUTION")
    assert pair["switch"] == "ARC_LAYERED_EVOLUTION"
    assert [arm["switch_enabled"] for arm in pair["arms"]] == [False, True]
