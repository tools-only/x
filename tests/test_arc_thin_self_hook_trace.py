import json
from pathlib import Path

from autoresearch_pi.arc_thin_e2e import (
    SELF_HARNESS_HOOK_PROMPT,
    _assemble_self_hook_trace,
    _project_self_hook_trace,
    _self_hook_overflow,
)


def test_hook_prompt_skips_without_candidates_and_finishes_after_one_evidence_check() -> None:
    assert "Reusable action rule verifiable now? Save its first minimal `run(args, env)` with a conditional `env.act` path early; preserve that path when revising. Else read-only or Skip." in SELF_HARNESS_HOOK_PROMPT
    assert "Else read-only or Skip" in SELF_HARNESS_HOOK_PROMPT
    assert "Candidate fields are recorded facts" in SELF_HARNESS_HOOK_PROMPT
    assert "run(args, env)" in SELF_HARNESS_HOOK_PROMPT
    assert "Call `env.act(action)` with one positional argument; do not pass `reason` or other keyword arguments." in SELF_HARNESS_HOOK_PROMPT
    assert "save(kind, name, content|ref)" in SELF_HARNESS_HOOK_PROMPT
    assert "or Skip, then finish this hook" in SELF_HARNESS_HOOK_PROMPT
    assert "Skip is text, not a save call." in SELF_HARNESS_HOOK_PROMPT
    assert "direct_target" not in SELF_HARNESS_HOOK_PROMPT
    assert "workspace root" not in SELF_HARNESS_HOOK_PROMPT
    assert "promote_session_function" not in SELF_HARNESS_HOOK_PROMPT
    assert "Do not inspect unrelated evidence" in SELF_HARNESS_HOOK_PROMPT
    assert len(SELF_HARNESS_HOOK_PROMPT) < 700


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
    assert '"source":"Python session","function":"probe","coverage":[]' in projection["text"]
    assert "direct_target" not in projection["text"]
    assert "suggested_function" not in projection["text"]
    assert '"coverage":[]' in projection["text"]
    assert '"fact"' not in projection["text"]
    assert '"tools: empty"' not in projection["text"]
    assert '"RELATED=0 (index match only)"' not in projection["text"]


def test_project_ref_fact_requires_exact_callable_definition_and_successful_export(tmp_path: Path) -> None:
    root = tmp_path
    code = "def candidate(args, env): return {}"
    session_rows = [{"event": "committed", "defs": [["candidate", code]], "code": code, "decision": 1}]
    _write(root / "harness/python_session.jsonl", session_rows)
    components = [{"kind": "session_export", "function": "candidate", "parameters": ["args", "env"], "ok": True}]
    events = [{"source": "harness.python_session.jsonl", "event": row, "event_id": "python_session:1"} for row in session_rows]
    events += [{"source": "harness.component_runs.jsonl", "event": row, "event_id": f"component_runs:{i}"}
               for i, row in enumerate(components)]
    trace = {"events": events, "text": "", "char_count": 0, "boundaries": {}, "complete": True, "gaps": [], "event_count": len(events)}
    projected = json.loads(_project_self_hook_trace(root, trace, [1], "b", max_chars=100_000)["text"])
    candidate = next(row for row in projected["python_session_candidates"] if row.get("function") == "candidate")
    assert candidate["fact"] == 'save(kind="tool", name="candidate", ref="candidate")'

    no_export = {**trace, "events": events[:-1]}
    projected = json.loads(_project_self_hook_trace(root, no_export, [1], "b", max_chars=100_000)["text"])
    candidate = next(row for row in projected["python_session_candidates"] if row.get("function") == "candidate")
    assert "fact" not in candidate
    for parameters in (["args", "env", "extra"], ["state", "args"], None):
        export = {**events[1], "event": {**events[1]["event"], "parameters": parameters}}
        projected = json.loads(_project_self_hook_trace(root, {**trace, "events": [events[0], export]}, [1], "b", max_chars=100_000)["text"])
        assert not any("fact" in row for row in projected["python_session_candidates"])


def test_no_def_grid_family_projects_named_candidate_only_for_successful_cross_decision_probes(tmp_path: Path) -> None:
    root = tmp_path
    _write(root / "session.jsonl", [
        {"type": "session", "id": "session", "timestamp": "2026-10-29T10:00:00Z"},
        _session_message("task", "2026-10-29T10:00:01Z", "user", "Decide."),
        _session_message("hook", "2026-10-29T10:00:20Z", "user", "SELF_HARNESS_HOOK batch_id=b action_ids=1."),
    ])
    _write(root / "harness/self_harness_hook.jsonl", [])
    _write(root / "harness/trajectory.jsonl", [])
    _write(root / "harness/working_set.jsonl", [])
    _write(root / "harness/python_session.jsonl", [])
    code = ('from collections import Counter\ng = state["grid"]\n'
            'counts = Counter(g[y][x] for y in range(len(g)) for x in range(len(g[0])))\n'
            'value = counts.most_common(1)[0][0]\ncells = []\n'
            'for y in range(len(g)):\n    for x in range(len(g[0])):\n'
            '        if g[y][x] == value:\n            cells.append((x, y))')
    rows = [
        {"t": "2026-10-29T10:00:02Z", "kind": "python", "ok": True, "decision": 2, "gist": "grid = state[\"grid\"]", "code_excerpt": code},
        {"t": "2026-10-29T10:00:03Z", "kind": "python", "ok": True, "decision": 5, "gist": "grid = state[\"grid\"]", "code_excerpt": code},
        {"t": "2026-10-29T10:00:04Z", "kind": "python", "ok": True, "decision": 6, "gist": "grid = state[\"grid\"]", "code_excerpt": 'grid = state["grid"]\nfor row in grid:\n    for value in row: print(value)'},
        {"t": "2026-10-29T10:00:05Z", "kind": "python", "ok": False, "decision": 7, "gist": "grid = state[\"grid\"]", "code_excerpt": code},
        {"t": "2026-10-29T10:00:06Z", "kind": "python", "ok": True, "decision": 8, "gist": "os.walk", "code_excerpt": "for root, dirs, files in os.walk('.'): pass"},
    ]
    _write(root / "harness/component_runs.jsonl", rows)
    trace = {"events": [{"source": "harness.component_runs.jsonl", "event_id": f"harness.component_runs.jsonl:{i+1}", "event": row}
                        for i, row in enumerate(rows)], "text": "", "char_count": 0,
             "boundaries": {}, "complete": True, "gaps": [], "event_count": len(rows)}
    projection = _project_self_hook_trace(root, trace, [1], "b", max_chars=100_000)
    payload = json.loads(projection["text"])
    candidates = payload["python_session_candidates"]
    gist = next(candidate for candidate in candidates if candidate.get("function") == "find_cells")
    assert gist["source"] == "Python probe family"
    assert gist["coverage"] == []
    assert len(gist["evidence"]) == 2
    assert [row["decision"] for row in gist["evidence"]] == [2, 5]
    assert all(row["event_id"].startswith("harness.component_runs.jsonl:") for row in gist["evidence"])
    assert "os_walk" not in json.dumps(candidates)


def test_no_def_family_needs_two_successful_decisions_and_keeps_def_path(tmp_path: Path) -> None:
    root = tmp_path
    _write(root / "session.jsonl", [
        {"type": "session", "id": "session", "timestamp": "2026-10-29T10:00:00Z"},
        _session_message("task", "2026-10-29T10:00:01Z", "user", "Decide."),
        _session_message("hook", "2026-10-29T10:00:20Z", "user", "SELF_HARNESS_HOOK batch_id=b action_ids=1."),
    ])
    _write(root / "harness/self_harness_hook.jsonl", [])
    for name in ("trajectory.jsonl", "working_set.jsonl", "python_session.jsonl"):
        _write(root / "harness" / name, [])
    code = 'def inspect_grid(grid):\n    return len(grid)'
    _write(root / "session.jsonl", [
        {"type": "session", "id": "session", "timestamp": "2026-10-29T10:00:00Z"},
        _session_message("task", "2026-10-29T10:00:01Z", "user", "Decide."),
        _session_message("def-call", "2026-10-29T10:00:02Z", "assistant", [{"type": "toolCall", "id": "p", "name": "python", "arguments": {"code": code}}]),
        _session_message("def-result", "2026-10-29T10:00:03Z", "toolResult", "3", toolCallId="p", toolName="python"),
        _session_message("hook", "2026-10-29T10:00:20Z", "user", "SELF_HARNESS_HOOK batch_id=b action_ids=1."),
    ])
    _write(root / "harness/component_runs.jsonl", [
        {"t": "2026-10-29T10:00:04Z", "kind": "python", "ok": True, "decision": 1, "code_excerpt": code},
        {"t": "2026-10-29T10:00:05Z", "kind": "python", "ok": True, "decision": 1, "code_excerpt": code},
        {"t": "2026-10-29T10:00:06Z", "kind": "python", "ok": False, "decision": 2, "code_excerpt": code},
    ])
    trace = _assemble_self_hook_trace(root, [1], "b")
    candidates = json.loads(_project_self_hook_trace(root, trace, [1], "b", max_chars=100_000)["text"])["python_session_candidates"]
    assert any(row.get("function") == "inspect_grid" and row.get("coverage") == [] for row in candidates)
    assert not any(row.get("source") == "Python probe family" for row in candidates)


def test_weak_frequency_family_skips_truncated_same_decision_and_covered_probes(tmp_path: Path) -> None:
    root = tmp_path
    for name in ("trajectory.jsonl", "working_set.jsonl", "python_session.jsonl"):
        _write(root / "harness" / name, [])
    _write(root / "session.jsonl", [
        {"type": "session", "id": "session", "timestamp": "2026-10-29T10:00:00Z"},
        _session_message("task", "2026-10-29T10:00:01Z", "user", "Decide."),
        _session_message("hook", "2026-10-29T10:00:20Z", "user", "SELF_HARNESS_HOOK batch_id=b action_ids=1."),
    ])
    _write(root / "harness/self_harness_hook.jsonl", [])
    code = ('from collections import Counter\ng = state["grid"]\n'
            'counts = Counter(g[y][x] for y in range(len(g)) for x in range(len(g[0])))\n'
            'value = counts.most_common(1)[0][0]\ncells = []\n'
            'for y in range(len(g)):\n    for x in range(len(g[0])):\n'
            '        if g[y][x] == value:\n            cells.append((x, y))')
    rows = [
        {"kind": "python", "ok": True, "decision": 1, "code_excerpt": code},
        {"kind": "python", "ok": True, "decision": 1, "code_excerpt": code},
        {"kind": "python", "ok": True, "decision": 2, "truncated": True, "code_excerpt": code},
        {"kind": "python", "ok": False, "decision": 3, "code_excerpt": code},
    ]
    _write(root / "harness/component_runs.jsonl", rows)
    trace = {"events": [{"source": "harness.component_runs.jsonl", "event_id": f"event-{i}", "event": row}
                        for i, row in enumerate(rows)], "text": "", "char_count": 0,
             "boundaries": {}, "complete": True, "gaps": [], "event_count": len(rows)}
    candidates = json.loads(_project_self_hook_trace(root, trace, [1], "b", max_chars=100_000)["text"])["python_session_candidates"]
    assert not any(row.get("source") == "Python probe family" for row in candidates)

    rows[1] = {"kind": "python", "ok": True, "decision": 2, "code_excerpt": code}
    rows[0]["path"] = "tools/find_cells.py"
    _write(root / "harness/component_runs.jsonl", rows)
    trace["events"] = [{"source": "harness.component_runs.jsonl", "event_id": f"event-{i}", "event": row}
                        for i, row in enumerate(rows)]
    candidates = json.loads(_project_self_hook_trace(root, trace, [1], "b", max_chars=100_000)["text"])["python_session_candidates"]
    assert not any(row.get("source") == "Python probe family" for row in candidates)


def test_find_cells_and_check_region_extract_operations_from_long_scripts(tmp_path: Path) -> None:
    root = tmp_path
    _write(root / "session.jsonl", [
        {"type": "session", "id": "session", "timestamp": "2026-10-29T10:00:00Z"},
        _session_message("task", "2026-10-29T10:00:01Z", "user", "Decide."),
        _session_message("hook", "2026-10-29T10:00:20Z", "user", "SELF_HARNESS_HOOK batch_id=b action_ids=1."),
    ])
    _write(root / "harness/self_harness_hook.jsonl", [])
    for name in ("trajectory.jsonl", "working_set.jsonl", "python_session.jsonl"):
        _write(root / "harness" / name, [])
    find_a = 'cells = [(x,y) for y in range(64) for x in range(64) if grid[y][x] in (0,1)]'
    find_b = 'cells = [(x,y) for y in range(64) for x in range(64) if grid[y][x] == 9]'
    region_a = 'cells = [(x,y,v) for y in range(40,46) for x in range(30,42) if grid[y][x] not in (3,4)]'
    region_b = 'cells = [(x,y,v) for y in range(25,30) for x in range(18,41) if grid[y][x] not in (3,4)]'
    py_codes = [
        ('grid = state["grid"]\n' + find_a + '\nprint(cells)', 3, "find-a"),
        ('grid = state["grid"]\n' + find_b + '\nprint(cells)', 5, "find-b"),
        ('grid = state["grid"]\n' + region_a + '\nprint(cells)', 9, "region-a"),
        ('grid = state["grid"]\n' + region_b + '\nprint(cells)', 13, "region-b"),
    ]
    messages = [
        {"type": "session", "id": "session", "timestamp": "2026-10-29T10:00:00Z"},
        _session_message("task", "2026-10-29T10:00:01Z", "user", "Decide."),
    ]
    rows = []
    for index, (code, decision, event_id) in enumerate(py_codes):
        call_id = f"p{index}"
        timestamp = f"2026-10-29T10:00:{2 + index:02d}Z"
        messages.append(_session_message(f"call{index}", timestamp, "assistant", [{"type": "toolCall", "id": call_id, "name": "python", "arguments": {"code": code}}]))
        messages.append(_session_message(f"result{index}", f"2026-10-29T10:00:{2 + index:02d}.500Z", "toolResult", "ok", toolCallId=call_id, toolName="python"))
        rows.append({"t": f"2026-10-29T10:00:{2 + index:02d}.400Z", "kind": "python", "ok": True, "decision": decision, "event_id": event_id, "gist": "grid = state[\"grid\"]", "code_excerpt": code})
    messages.append(_session_message("hook", "2026-10-29T10:00:20Z", "user", "SELF_HARNESS_HOOK batch_id=b action_ids=1."))
    _write(root / "session.jsonl", messages)
    rows.append(
        {"kind": "python", "ok": True, "decision": 13, "event_id": "walk", "gist": "os.walk", "code_excerpt": "import os\nfor p in os.walk('.'): print(p)"},
    )
    _write(root / "harness/component_runs.jsonl", rows)
    trace = {"events": [{"source": "harness.component_runs.jsonl", "event_id": f"harness.component_runs.jsonl:{i+1}", "event": row}
                        for i, row in enumerate(rows)], "text": "", "char_count": 0,
             "boundaries": {}, "complete": True, "gaps": [], "event_count": len(rows)}
    candidates = json.loads(_project_self_hook_trace(root, trace, [1], "b", max_chars=100_000)["text"])["python_session_candidates"]
    for name, ids, decisions in (("find_cells", {"1", "2"}, [3, 5]), ("check_region", {"3", "4"}, [9, 13])):
        candidate = next(row for row in candidates if row.get("function") == name)
        assert candidate["coverage"] == []
        assert {row["event_id"].rsplit(":", 1)[-1] for row in candidate["evidence"]} == ids
        assert [row["decision"] for row in candidate["evidence"]] == decisions
    assert not any("walk" in json.dumps(row) for row in candidates)


def test_check_path_projects_only_repeated_parameterizable_walkability_checks(tmp_path: Path) -> None:
    root = tmp_path
    _write(root / "session.jsonl", [
        {"type": "session", "id": "session", "timestamp": "2026-10-29T10:00:00Z"},
        _session_message("task", "2026-10-29T10:00:01Z", "user", "Decide."),
        _session_message("hook", "2026-10-29T10:00:20Z", "user", "SELF_HARNESS_HOOK batch_id=b action_ids=1."),
    ])
    _write(root / "harness/self_harness_hook.jsonl", [])
    for name in ("trajectory.jsonl", "working_set.jsonl", "python_session.jsonl"):
        _write(root / "harness" / name, [])
    code = (
        'grid = state["grid"]\nunit_bbox = (left, top, right, bottom)\n'
        'walkable = set(values)\n'
        'can_move = all(grid[top + step][x] in walkable for step in range(max_steps) for x in range(left, right + 1))\n'
        'max_steps = distance\n'
    )
    rows = [
        {"kind": "python", "ok": True, "decision": 4, "event_id": "path-a", "gist": "bounded path scan", "code_excerpt": code},
        {"kind": "python", "ok": True, "decision": 8, "event_id": "path-b", "gist": "bounded path scan", "code_excerpt": code},
        {"kind": "python", "ok": True, "decision": 8, "event_id": "display", "gist": "row display", "code_excerpt": 'grid = state["grid"]\nfor y in range(10):\n print([grid[y][x] for x in range(10)])'},
        {"kind": "python", "ok": False, "decision": 9, "event_id": "failed", "gist": "failed path", "code_excerpt": code},
    ]
    _write(root / "harness/component_runs.jsonl", rows)
    trace = {"events": [{"source": "harness.component_runs.jsonl", "event_id": f"component_runs:{i}", "event": row}
                        for i, row in enumerate(rows)], "text": "", "char_count": 0,
             "boundaries": {}, "complete": True, "gaps": [], "event_count": len(rows)}
    candidates = json.loads(_project_self_hook_trace(root, trace, [1], "b", max_chars=100_000)["text"])["python_session_candidates"]
    candidate = next(row for row in candidates if row.get("function") == "check_path")
    assert candidate["coverage"] == []
    assert [row["event_id"] for row in candidate["evidence"]] == ["component_runs:0", "component_runs:1"]
    assert [row["decision"] for row in candidate["evidence"]] == [4, 8]
    assert set(candidate) == {"source", "function", "evidence", "coverage"}
    assert "display" not in json.dumps(candidate)


def test_check_path_requires_directional_axis_signal(tmp_path: Path) -> None:
    root = tmp_path
    _write(root / "session.jsonl", [
        {"type": "session", "id": "session", "timestamp": "2026-10-29T10:00:00Z"},
        _session_message("task", "2026-10-29T10:00:01Z", "user", "Decide."),
        _session_message("hook", "2026-10-29T10:00:20Z", "user", "SELF_HARNESS_HOOK batch_id=b action_ids=1."),
    ])
    for name in ("harness/self_harness_hook.jsonl", "harness/trajectory.jsonl",
                 "harness/working_set.jsonl", "harness/python_session.jsonl"):
        _write(root / name, [])
    code = ('grid = state["grid"]\nunit_bbox = (left, top, right, bottom)\nwalkable = set(values)\n'
            'can_move = all(grid[y][x] in walkable for y in range(top, bottom) for x in range(left, right))')
    rows = [{"kind": "python", "ok": True, "decision": n, "event_id": str(n), "code_excerpt": code}
            for n in (1, 2)]
    _write(root / "harness/component_runs.jsonl", rows)
    trace = {"events": [{"source": "harness.component_runs.jsonl", "event_id": str(i), "event": row}
                        for i, row in enumerate(rows)], "text": "", "char_count": 0,
             "boundaries": {}, "complete": True, "gaps": [], "event_count": len(rows)}
    candidates = json.loads(_project_self_hook_trace(root, trace, [1], "b", max_chars=100_000)["text"])["python_session_candidates"]
    assert not any(row.get("function") == "check_path" for row in candidates)


def test_check_path_does_not_project_when_target_is_already_covered(tmp_path: Path) -> None:
    root = tmp_path
    for name in ("session.jsonl", "harness/self_harness_hook.jsonl", "harness/trajectory.jsonl",
                 "harness/working_set.jsonl", "harness/python_session.jsonl"):
        _write(root / name, [])
    code = ('grid = state["grid"]\nunit_bbox = (left, top, right, bottom)\n'
            'can_move = all(grid[top + step][x] in walkable for step in range(max_steps) for x in range(left, right))\n'
            'max_steps = distance')
    rows = [{"kind": "python", "ok": True, "decision": n, "event_id": str(n), "code_excerpt": code}
            for n in (1, 2)] + [{"kind": "save", "path": "tools/check_path.py", "name": "check_path"}]
    _write(root / "harness/component_runs.jsonl", rows)
    trace = {"events": [{"source": "harness.component_runs.jsonl", "event_id": str(i), "event": row}
                        for i, row in enumerate(rows)], "text": "", "char_count": 0,
             "boundaries": {}, "complete": True, "gaps": [], "event_count": len(rows)}
    candidates = json.loads(_project_self_hook_trace(root, trace, [1], "b", max_chars=100_000)["text"])["python_session_candidates"]
    assert not any(row.get("function") == "check_path" for row in candidates)


def test_no_def_operation_families_skip_same_decision_truncation_and_existing_component(tmp_path: Path) -> None:
    root = tmp_path
    _write(root / "session.jsonl", [
        {"type": "session", "id": "session", "timestamp": "2026-10-29T10:00:00Z"},
        _session_message("task", "2026-10-29T10:00:01Z", "user", "Decide."),
        _session_message("hook", "2026-10-29T10:00:20Z", "user", "SELF_HARNESS_HOOK batch_id=b action_ids=1."),
    ])
    _write(root / "harness/self_harness_hook.jsonl", [])
    for name in ("trajectory.jsonl", "working_set.jsonl", "python_session.jsonl"):
        _write(root / "harness" / name, [])
    code = 'grid = state["grid"]\ncells = [(x,y) for y in range(64) for x in range(64) if grid[y][x] == 9]'
    _write(root / "harness/component_runs.jsonl", [
        {"kind": "python", "ok": True, "decision": 2, "event_id": "a", "code_excerpt": code},
        {"kind": "python", "ok": True, "decision": 2, "event_id": "b", "code_excerpt": code},
        {"kind": "python", "ok": True, "decision": 3, "event_id": "c", "code_excerpt": code[:55]},
        {"kind": "python", "ok": False, "decision": 4, "event_id": "d", "code_excerpt": code},
        {"kind": "python", "ok": True, "decision": 5, "event_id": "e", "code_excerpt": 'def find_cells(grid):\n    return []'},
        {"kind": "save", "path": "tools/find_cells.py", "name": "find_cells"},
    ])
    trace = _assemble_self_hook_trace(root, [1], "b")
    candidates = json.loads(_project_self_hook_trace(root, trace, [1], "b", max_chars=100_000)["text"])["python_session_candidates"]
    assert not any(row.get("function") in {"find_cells", "check_region"} for row in candidates)


def test_hook_reuse_index_has_no_entry_limit_and_keeps_full_evidence_pointers(tmp_path: Path) -> None:
    root = tmp_path
    messages = [{"type": "session", "id": "session", "timestamp": "2026-10-29T10:00:00Z"},
        _session_message("task", "2026-10-29T10:00:01Z", "user", "Decide.")]
    for i in range(30):
        messages.append(_session_message(f"p{i}", f"2026-10-29T10:00:{i + 2:02d}Z", "assistant",
            [{"type": "toolCall", "id": f"c{i}", "name": "python", "arguments": {"code": f"x{i} = {i}"}}]))
    messages.append(_session_message("hook-user", "2026-10-29T10:01:00Z", "user", "SELF_HARNESS_HOOK batch_id=b action_ids=1."))
    _write(root / "session.jsonl", messages)
    _write(root / "harness/self_harness_hook.jsonl", [{"event": "turn_complete", "outcome": "completed",
        "session_end_event_id": "old-hook", "t": "2026-10-29T09:59:59Z"}])
    for name in ("trajectory.jsonl", "working_set.jsonl", "python_session.jsonl", "component_runs.jsonl"):
        _write(root / "harness" / name, [])
    trace = _assemble_self_hook_trace(root, [1], "b")
    projection = _project_self_hook_trace(root, trace, [1], "b", max_chars=100_000)
    assert projection["text"].count('"count":1') == 30
    assert "harness/component_runs.jsonl" in projection["text"]


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


def test_find_player_requires_repeated_complete_group_size_operation_and_skips_coverage(tmp_path: Path) -> None:
    root = tmp_path
    _write(root / "session.jsonl", [
        {"type": "session", "id": "session", "timestamp": "2026-10-29T10:00:00Z"},
        _session_message("task", "2026-10-29T10:00:01Z", "user", "Decide."),
        _session_message("hook", "2026-10-29T10:00:20Z", "user", "SELF_HARNESS_HOOK batch_id=b action_ids=1."),
    ])
    for name in ("harness/self_harness_hook.jsonl", "harness/trajectory.jsonl",
                 "harness/working_set.jsonl", "harness/python_session.jsonl"):
        _write(root / name, [])
    code = '''g = state["grid"]
positions = {}
for y in range(height):
    for x in range(width):
        positions.setdefault(g[y][x], []).append((x, y))
candidates = [pos for pos in positions.values() if min_size <= len(pos) <= max_size]
bbox = calculate_bbox(candidates)
'''
    events = [
        {"kind": "python", "ok": True, "decision": 2, "event_id": "real-1", "gist": "group and size filter", "code_excerpt": code},
        {"kind": "python", "ok": True, "decision": 5, "event_id": "real-2", "gist": "group and size filter", "code_excerpt": code.replace("g[y][x]", "grid[y][x]").replace('g = state["grid"]', 'grid = state["grid"]')},
    ]
    _write(root / "harness/component_runs.jsonl", events)
    trace = {"events": [{"source": "harness.component_runs.jsonl", "event_id": f"harness.component_runs.jsonl:{i+1}", "event": row}
                        for i, row in enumerate(events)], "text": "", "char_count": 0,
             "boundaries": {}, "complete": True, "gaps": [], "event_count": len(events)}
    project = lambda: json.loads(_project_self_hook_trace(root, trace, [1], "b", max_chars=100_000)["text"])["python_session_candidates"]
    candidate = next(row for row in project() if row.get("function") == "find_player")
    assert candidate["coverage"] == []
    assert [row["decision"] for row in candidate["evidence"]] == [2, 5]
    assert set(candidate) == {"source", "function", "evidence", "coverage"}

    negatives = [
        {"kind": "python", "ok": True, "decision": 2, "event_id": "one", "code_excerpt": code},
        {"kind": "python", "ok": True, "decision": 3, "event_id": "truncated", "code_excerpt": code, "truncated": True},
        {"kind": "python", "ok": False, "decision": 4, "event_id": "failed", "code_excerpt": code},
        {"kind": "python", "ok": True, "decision": 5, "event_id": "display", "code_excerpt": 'g = state["grid"]\nfor y in range(height):\n for x in range(width): print(g[y][x])'},
    ]
    _write(root / "harness/component_runs.jsonl", negatives)
    trace["events"] = [{"source": "harness.component_runs.jsonl", "event_id": str(i), "event": row}
                       for i, row in enumerate(negatives)]
    assert not any(row.get("function") == "find_player" for row in project())
    _write(root / "harness/component_runs.jsonl", events + [{"kind": "save", "path": "tools/find_player.py", "name": "find_player"}])
    trace["events"] = [{"source": "harness.component_runs.jsonl", "event_id": str(i), "event": row}
                       for i, row in enumerate(events + [{"kind": "save", "path": "tools/find_player.py", "name": "find_player"}])]
    assert not any(row.get("function") == "find_player" for row in project())
