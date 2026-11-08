import json
from pathlib import Path

from tools.check_reflective_core_evidence import check


def write_rows(root: Path, name: str, values: list[dict]) -> None:
    path = root / "harness" / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(v) + "\n" for v in values), encoding="utf-8")


def test_new_creation_requires_new_definition_note_and_same_session_use(tmp_path):
    write_rows(tmp_path, "lifecycle.jsonl", [
        {"event": "initial_registry", "components": [{"kind": "tool", "name": "seed", "hash": "seed-hash"}]},
        {"event": "reflective_change", "op": "define", "kind": "tool", "name": "new_tool", "version": 1, "hash": "new-hash", "note": "reduce repeated parsing", "session_id": "s", "time": "1"},
    ])
    write_rows(tmp_path, "component_runs.jsonl", [{"kind": "program_result", "name": "new_tool", "version": 1, "ok": True, "session_id": "s", "time": "2"}])
    assert check(tmp_path, "new-creation")["pass"]


def test_creation_mode_negative_cases(tmp_path):
    snapshot = {"event": "initial_registry", "components": [{"kind": "tool", "name": "seed", "hash": "seed-hash"}]}
    cases = [
        ([{"op": "redefine", "kind": "tool", "name": "seed", "version": 2, "hash": "new-hash", "note": "x"}], [], [], "fail"),
        ([{"op": "define", "kind": "tool", "name": "renamed", "version": 1, "hash": "seed-hash", "note": "x"}], [], [], "fail"),
        ([{"op": "define", "kind": "tool", "name": "unused", "version": 1, "hash": "h", "note": "x"}], [], [], "fail"),
        ([{"op": "define", "kind": "tool", "name": "failed", "version": 1, "hash": "h", "note": "x"}], [{"kind": "program_result", "name": "failed", "version": 1, "ok": False, "session_id": "s", "time": "2"}], [], "fail"),
        ([{"op": "define", "kind": "tool", "name": "wrong", "version": 1, "hash": "h", "note": "x"}], [{"kind": "program_result", "name": "wrong", "version": 1, "ok": True, "session_id": "other", "time": "2"}], [], "fail"),
        ([{"op": "define", "kind": "skill", "name": "read_only", "version": 1, "hash": "h", "note": "x"}], [], [{"event": "component_consumed", "kind": "skill", "name": "read_only", "version": 1, "boundary": "read_component", "session_id": "s", "time": "2"}], "uncertain"),
        ([{"op": "define", "kind": "subagent", "name": "consult_only", "version": 1, "hash": "h", "note": "x"}], [], [], "fail"),
        ([{"op": "define", "kind": "subagent", "name": "failed_consult", "version": 1, "hash": "h", "note": "x"}], [], [], "fail"),
        ([{"op": "define", "kind": "tool", "name": "no_note", "version": 1, "hash": "h"}], [], [], "fail"),
    ]
    for i, (changes, calls, extra_life, expected) in enumerate(cases):
        root = tmp_path / str(i)
        life = [snapshot] + [{"event": "reflective_change", "session_id": "s", "time": "1", **c} for c in changes] + extra_life
        write_rows(root, "lifecycle.jsonl", life)
        write_rows(root, "component_runs.jsonl", [{"session_id": "s", "time": "2", **c} for c in calls])
        consult_rows = ([{"role": "failed_consult", "version": 1, "ok": False, "session_id": "s", "time": "2"}]
                        if changes[0].get("name") == "failed_consult" else [])
        write_rows(root, "consult_runs.jsonl", consult_rows)
        result = check(root, "new-creation")
        if changes[0].get("kind") == "skill" and extra_life:
            assert result["creations"][0]["same_session_use"] == expected
        else:
            assert result["pass"] is False


def test_wrong_version_and_consult_without_parent_use_fail(tmp_path):
    write_rows(tmp_path, "lifecycle.jsonl", [
        {"event": "initial_registry", "components": []},
        {"event": "reflective_change", "op": "define", "kind": "tool", "name": "t", "version": 2, "hash": "h", "note": "x", "session_id": "s", "time": "1"},
        {"event": "reflective_change", "op": "define", "kind": "subagent", "name": "a", "version": 1, "hash": "a", "note": "x", "session_id": "s", "time": "1"},
    ])
    write_rows(tmp_path, "component_runs.jsonl", [{"kind": "program_result", "name": "t", "version": 1, "ok": True, "session_id": "s", "time": "2"}])
    write_rows(tmp_path, "consult_runs.jsonl", [{"role": "a", "version": 1, "ok": True, "session_id": "s", "time": "2"}])
    assert check(tmp_path, "new-creation")["pass"] is False


def test_ppt_delivery_is_reported_separately_from_core_process_verdict(tmp_path):
    write_rows(tmp_path, "lifecycle.jsonl", [
        {"event": "initial_registry", "components": []},
        {"event": "reflective_change", "op": "define", "kind": "process", "name": "p", "version": 1, "note": "first", "strategy_present": True, "ok": True, "time": "1"},
        {"event": "reflective_change", "op": "redefine", "kind": "process", "name": "p", "version": 2, "note": "revise", "strategy_present": True, "ok": True, "time": "2"},
    ])
    write_rows(tmp_path, "process_boundaries.jsonl", [{"part": "loop", "name": "p", "process_version": 2, "changed_action": True, "time": "3"}])
    (tmp_path / "summary.json").write_text(json.dumps({"complete": True, "stop": "delivered", "revision": 4}), encoding="utf-8")
    result = check(tmp_path, "process")
    assert result["pass"] is False
    assert result["claims"] == {"identify_create": "not_evaluated", "process_adoption": "not_evaluated",
                                "self_modify": "not_evaluated", "task_effect": "not_evaluated", "quality": "not_evaluated"}
    assert result["ppt_outcome"] == {"delivered": True, "revision": 4, "quality": "not_evaluated"}

    (tmp_path / "harness" / "process_boundaries.jsonl").write_text("", encoding="utf-8")
    result = check(tmp_path, "process")
    assert result["pass"] is False
    assert result["ppt_outcome"]["delivered"] is True


def test_process_checker_rejects_note_only_and_hook_only_false_positives(tmp_path):
    write_rows(tmp_path, "lifecycle.jsonl", [
        {"event": "initial_registry", "components": []},
        {"event": "reflective_change", "op": "define", "kind": "process", "name": "p", "version": 1, "note": "first", "strategy_present": True, "ok": True, "time": "1", "session_id": "s"},
    ])
    write_rows(tmp_path, "process_boundaries.jsonl", [{"part": "loop", "name": "p", "process_version": 1, "outcome": {"guidance": "do a review"}, "changed_action": True, "time": "3", "session_id": "s"}])
    result = check(tmp_path, "process")
    assert result["pass"] is False
    assert result["claims"]["process_adoption"] == "not_evaluated"
    assert result["recorded_evidence"]["process_context_bindings"] == []


def test_process_checker_requires_same_session_exact_version_for_context_binding(tmp_path):
    write_rows(tmp_path, "lifecycle.jsonl", [
        {"event": "initial_registry", "components": []},
        {"event": "reflective_change", "op": "define", "kind": "process", "name": "p", "version": 2,
         "note": "not semantic evidence", "strategy_present": True, "ok": True, "session_id": "s1", "time": "1"},
        {"event": "reflective_change", "op": "redefine", "kind": "prompt", "name": "guidance", "version": 2,
         "note": "empty guidance only", "ok": True, "session_id": "s1", "time": "1.5"},
        {"event": "process_context_injected", "name": "p", "version": 2, "session_id": "s2", "binding": "provider_request", "time": "2"},
        {"event": "process_context_injected", "name": "p", "version": 1, "session_id": "s1", "binding": "provider_request", "time": "3"},
        {"event": "process_context_injected", "name": "p", "version": 2, "session_id": "s1", "binding": "provider_request", "time": "4"},
    ])
    result = check(tmp_path, "process")
    assert result["recorded_evidence"]["process_context_bindings"] == [
        {"name": "p", "version": 2, "session_id": "s2", "definition_associated": False, "references": []},
        {"name": "p", "version": 1, "session_id": "s1", "definition_associated": False, "references": []},
        {"name": "p", "version": 2, "session_id": "s1", "definition_associated": True, "references": []},
    ]
    assert result["claims"]["process_adoption"] == "not_evaluated"


def test_semantic_adoption_review_cannot_pass_without_associated_request_version(tmp_path):
    write_rows(tmp_path, "lifecycle.jsonl", [
        {"event": "initial_registry", "components": []},
        {"event": "reflective_change", "op": "define", "kind": "process", "name": "p", "version": 2,
         "note": "nonempty note alone is not evidence", "strategy_present": True, "ok": True, "session_id": "s1", "time": "1"},
        {"event": "process_context_injected", "name": "p", "version": 2, "session_id": "s2", "binding": "provider_request"},
    ])
    write_rows(tmp_path, "process_semantic_reviews.jsonl", [{"claim": "process_adoption", "verdict": "pass"}])
    result = check(tmp_path, "process")
    assert result["claims"]["process_adoption"] == "fail"


def test_identify_create_review_requires_seed_free_initial_registry(tmp_path):
    write_rows(tmp_path, "lifecycle.jsonl", [
        {"event": "initial_registry", "components": [{"kind": "subagent", "name": "deck_reviewer"}]},
        {"event": "reflective_change", "op": "define", "kind": "process", "name": "p", "version": 1,
         "strategy_present": True, "ok": True, "session_id": "s", "time": "1"},
    ])
    write_rows(tmp_path, "process_semantic_reviews.jsonl", [{"claim": "identify_create", "verdict": "pass"}])
    result = check(tmp_path, "process")
    assert result["claims"]["identify_create"] == "fail"
    assert result["recorded_evidence"]["strategic_seed_names"] == ["deck_reviewer"]
