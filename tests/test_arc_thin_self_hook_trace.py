import json
from pathlib import Path

from autoresearch_pi.arc_thin_e2e import (
    SELF_HARNESS_HOOK_PROMPT,
    _assemble_self_hook_trace,
    _project_self_hook_trace,
    _self_hook_overflow,
)


def test_hook_prompt_skips_without_candidates_and_finishes_after_one_evidence_check() -> None:
    assert "Local prints, hardcoded coordinates, one-off probes that cannot be parameterized" in SELF_HARNESS_HOOK_PROMPT
    assert "may be considered as candidates" in SELF_HARNESS_HOOK_PROMPT
    assert "never auto-generated and never required to save" in SELF_HARNESS_HOOK_PROMPT
    assert "read only one piece of key evidence" in SELF_HARNESS_HOOK_PROMPT
    assert "then save or Skip and finish this hook" in SELF_HARNESS_HOOK_PROMPT
    assert "no component is required" in SELF_HARNESS_HOOK_PROMPT
    assert "Do not reconstruct the game, inspect every candidate" in SELF_HARNESS_HOOK_PROMPT


def _write(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows), encoding="utf-8")


def _session_message(event_id: str, timestamp: str, role: str, content, **extra) -> dict:
    message = {"role": role, "content": content, **extra}
    return {"type": "message", "id": event_id, "parentId": None, "timestamp": timestamp, "message": message}


def test_first_hook_trace_remains_auditable_and_projection_uses_indexes_and_pointers(tmp_path: Path) -> None:
    root = tmp_path
    session = [
        {"type": "session", "id": "session", "timestamp": "2026-10-29T10:00:00Z"},
        _session_message("task", "2026-10-29T10:00:01Z", "user", [{"type": "text", "text": "Decide."}]),
        _session_message("analysis", "2026-10-29T10:00:02Z", "assistant", [{"type": "thinking", "thinking": "strategy analysis full"}]),
        _session_message("code", "2026-10-29T10:00:03Z", "assistant", [{"type": "toolCall", "id": "p1", "name": "python", "arguments": {"code": "def checked(x): return x + 1"}}]),
        _session_message("python-result", "2026-10-29T10:00:04Z", "toolResult", [{"type": "text", "text": "checked(2) -> 3"}], toolCallId="p1", toolName="python"),
        _session_message("action-call", "2026-10-29T10:00:05Z", "assistant", [{"type": "toolCall", "id": "a1", "name": "arc_action", "arguments": {"action": "ACTION1"}}]),
        _session_message("action-result", "2026-10-29T10:00:06Z", "toolResult", [{"type": "text", "text": "compact receipt"}], toolCallId="a1", toolName="arc_action"),
        _session_message("hook-user", "2026-10-29T10:00:07Z", "user", [{"type": "text", "text": "SELF_HARNESS_HOOK batch_id=b1 action_ids=1. trace"}]),
    ]
    _write(root / "session.jsonl", session)
    _write(root / "harness/self_harness_hook.jsonl", [])
    _write(root / "harness/trajectory.jsonl", [{"t": "2026-10-29T10:00:06.500Z", "n": 1, "action": "ACTION1", "feedback": "full receipt and delta"}])
    _write(root / "harness/working_set.jsonl", [{"t": "2026-10-29T10:00:01.500Z", "decision": 1,
        "text": "full prior context", "observation_text": "full ARC observation", "observation_images": [{"type": "image", "data": "full-image-bytes", "mimeType": "image/png"}]}])
    _write(root / "harness/python_session.jsonl", [{"t": "2026-10-29T10:00:04.500Z", "event": "committed", "version": 1}])
    _write(root / "harness/component_runs.jsonl", [])

    trace = _assemble_self_hook_trace(root, [1], "b1")
    assert trace["complete"] is True
    assert trace["boundaries"]["lower"] == "task start"
    assert "strategy analysis full" in trace["text"]
    assert '"code":"def checked(x): return x + 1"' in trace["text"]
    assert "checked(2) -> 3" in trace["text"]
    assert "full ARC observation" in trace["text"]
    assert "full-image-bytes" in trace["text"]
    assert "full receipt and delta" in trace["text"]
    assert "compact receipt" not in trace["text"], "expanded harness receipt replaces the duplicate compact action result"
    assert trace["text"].index("strategy analysis full") < trace["text"].index("checked(2) -> 3") < trace["text"].index("full receipt and delta")
    full_text = trace["text"]
    assert _self_hook_overflow(trace, 10), "a tiny context window detects overflow"
    assert trace["text"] == full_text, "overflow detection never clips the transcript"
    projection = _project_self_hook_trace(root, trace, [1], "b1", max_chars=5000)
    assert projection["char_count"] <= 5000
    assert '"n":1' in projection["text"] and "session.jsonl" in projection["text"]
    assert "full-image-bytes" not in projection["text"] and "strategy analysis full" not in projection["text"]
    assert "full receipt and delta" not in projection["text"]
    assert "ACTION1" in projection["text"]


def test_adjacent_hook_uses_latest_completed_hook_or_later_save_boundary(tmp_path: Path) -> None:
    root = tmp_path
    session = [
        {"type": "session", "id": "session", "timestamp": "2026-10-29T10:00:00Z"},
        _session_message("old", "2026-10-29T10:00:01Z", "assistant", [{"type": "thinking", "thinking": "OLD WINDOW"}]),
        _session_message("hook-end", "2026-10-29T10:00:02Z", "assistant", [{"type": "text", "text": "first hook complete"}]),
        _session_message("post-hook", "2026-10-29T10:00:03Z", "assistant", [{"type": "thinking", "thinking": "POST HOOK WORK"}]),
        _session_message("save-call", "2026-10-29T10:00:03.800Z", "assistant", [{"type": "toolCall", "id": "s1", "name": "self_component", "arguments": {"kind": "tool", "name": "checked", "content": "def run(state,args): return 1"}}]),
        _session_message("save", "2026-10-29T10:00:04Z", "toolResult", [{"type": "text", "text": "saved tools/checked.py v2"}], toolCallId="s1", toolName="self_component"),
        _session_message("strategy-save-call", "2026-10-29T10:00:04.500Z", "assistant", [{"type": "toolCall", "id": "s2", "name": "self_component", "arguments": {"kind": "prompt", "name": "strategy", "content": "A tested strategy."}}]),
        _session_message("strategy-save", "2026-10-29T10:00:04.700Z", "toolResult", [{"type": "text", "text": "prompts/strategy.md v1 saved"}], toolCallId="s2", toolName="self_component"),
        _session_message("after-save", "2026-10-29T10:00:05Z", "assistant", [{"type": "thinking", "thinking": "AFTER SAVE WORK"}]),
        _session_message("hook-user", "2026-10-29T10:00:06Z", "user", [{"type": "text", "text": "SELF_HARNESS_HOOK batch_id=b2 action_ids=2. trace"}]),
    ]
    _write(root / "session.jsonl", session)
    _write(root / "harness/self_harness_hook.jsonl", [{"event": "turn_complete", "outcome": "completed",
        "session_end_event_id": "hook-end", "t": "2026-10-29T10:00:02.500Z"}])
    _write(root / "harness/trajectory.jsonl", [])
    _write(root / "harness/working_set.jsonl", [])
    _write(root / "harness/python_session.jsonl", [])
    _write(root / "harness/component_runs.jsonl", [{"t": "2026-10-29T10:00:03.900Z", "kind": "save", "by": "agent",
        "path": "tools/checked.py", "version": 2}])

    trace = _assemble_self_hook_trace(root, [2], "b2")
    assert trace["complete"] is True
    assert trace["boundaries"]["lower"] == "after last agent save"
    assert trace["boundaries"]["save_event_id"] == "strategy-save", "the later prompt save advances the lower bound"
    assert "OLD WINDOW" not in trace["text"]
    assert "POST HOOK WORK" not in trace["text"]
    assert "AFTER SAVE WORK" in trace["text"]


def test_no_save_crosses_completed_hooks_and_indexes_repeated_python(tmp_path: Path) -> None:
    root = tmp_path
    _write(root / "session.jsonl", [
        {"type": "session", "id": "session", "timestamp": "2026-10-29T10:00:00Z"},
        _session_message("task", "2026-10-29T10:00:01Z", "user", "Decide."),
        _session_message("py1", "2026-10-29T10:00:02Z", "assistant", [{"type": "toolCall", "id": "p1", "name": "python", "arguments": {"code": "def probe(state): return state['player']"}}]),
        _session_message("py1r", "2026-10-29T10:00:02.500Z", "toolResult", "player=(2,3)", toolCallId="p1", toolName="python"),
        _session_message("action", "2026-10-29T10:00:03Z", "assistant", [{"type": "text", "text": "move"}]),
        _session_message("hook-user", "2026-10-29T10:00:04Z", "user", "SELF_HARNESS_HOOK batch_id=b action_ids=1."),
    ])
    _write(root / "harness/self_harness_hook.jsonl", [{"event": "turn_complete", "outcome": "completed",
        "session_end_event_id": "old-hook", "t": "2026-10-29T09:59:59Z"}])
    _write(root / "harness/python_session.jsonl", [{"t": "2026-10-29T10:00:02.4Z", "event": "committed", "code": "def probe(state): return state['player']", "decision": 1}])
    for name in ("trajectory.jsonl", "working_set.jsonl", "memory.jsonl", "component_runs.jsonl"):
        _write(root / "harness" / name, [])
    trace = _assemble_self_hook_trace(root, [1], "b")
    assert trace["boundaries"]["lower"] == "task start"
    assert "def probe(state)" in trace["text"]
    projection = _project_self_hook_trace(root, trace, [1], "b")
    assert '"python_reuse_index"' in projection["text"]
    assert '"count":2' in projection["text"]


def test_missing_boundary_is_reported_and_never_called_complete(tmp_path: Path) -> None:
    root = tmp_path
    _write(root / "session.jsonl", [
        {"type": "session", "id": "session", "timestamp": "2026-10-29T10:00:00Z"},
        _session_message("hook-user", "2026-10-29T10:00:01Z", "user", [{"type": "text", "text": "SELF_HARNESS_HOOK batch_id=b3 action_ids=3. trace"}]),
    ])
    _write(root / "harness/self_harness_hook.jsonl", [{"event": "turn_complete", "outcome": "completed",
        "session_end_event_id": "missing-event", "t": "2026-10-29T09:59:59Z"}])
    for name in ("trajectory.jsonl", "working_set.jsonl", "python_session.jsonl", "component_runs.jsonl"):
        _write(root / "harness" / name, [])

    trace = _assemble_self_hook_trace(root, [3], "b3")
    assert trace["complete"] is False
    assert any("absent from session.jsonl" in gap for gap in trace["gaps"])
