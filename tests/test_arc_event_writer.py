import json
import threading

from autoresearch_pi.arc_agi_3_bridge import ArcBridge
from autoresearch_pi import arc_agi_3_e2e as runner


def test_parent_writer_persists_each_canonical_event_once(tmp_path, monkeypatch):
    bridge = object.__new__(ArcBridge)
    bridge.root = tmp_path
    bridge._events = []
    bridge._events_lock = threading.Lock()
    bridge._disk_events_available = False
    bridge._append({"event": "action", "index": 1})
    assert not (tmp_path / "bridge-events.jsonl").exists()
    monkeypatch.setattr(runner, "_get_json", lambda url: {
        "events": bridge._events[int(url.split("after=")[1]):], "next": len(bridge._events)})
    cursor = runner._sync_bridge_events(tmp_path, "http://fixture", 0)
    assert cursor == 1
    bridge._append({"event": "action", "index": 2})
    cursor = runner._sync_bridge_events(tmp_path, "http://fixture", cursor)
    runner._sync_bridge_events(tmp_path, "http://fixture", cursor)
    runner._append_bridge_event_batch(tmp_path, bridge._events)
    persisted = [json.loads(line) for line in (tmp_path / "bridge-events.jsonl").read_text().splitlines()]
    assert persisted == bridge._events
    assert [row["index"] for row in persisted] == [1, 2]


def test_standalone_bridge_still_writes_events(tmp_path):
    bridge = object.__new__(ArcBridge)
    bridge.root = tmp_path
    bridge._events = []
    bridge._events_lock = threading.Lock()
    bridge._disk_events_available = True
    bridge._append({"event": "action", "index": 1})
    assert json.loads((tmp_path / "bridge-events.jsonl").read_text()) == bridge._events[0]
