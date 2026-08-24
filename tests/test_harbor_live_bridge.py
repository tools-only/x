import pytest

pytest.importorskip("harbor")

from pathlib import Path

from hos.harbor_bridge import _LiveBridge
from hos.store import ObjectStore


def test_live_bridge_uses_object_store_filesystem_root(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(
        "hos.harbor_bridge.ContinualHarnessController",
        lambda *, root, provider: {"root": root, "provider": provider},
    )

    bridge = _LiveBridge(
        {
            "live_evolution": True,
            "root": str(tmp_path),
            "harness_ref": "sha256:" + "a" * 64,
            "commit_ref": "ref:harness/task/live/test",
            "live_state_path": str(tmp_path / "live-state.json"),
        },
        "task",
    )

    assert isinstance(bridge.root, ObjectStore)
    assert bridge.controller == {"root": tmp_path.resolve(), "provider": "task"}
