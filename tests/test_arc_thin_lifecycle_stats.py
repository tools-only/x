"""Refutation-response and separating-test counts in the thin run summary; pure, no provider or game."""
import inspect
import json
import time

from autoresearch_pi import arc_thin_e2e

from autoresearch_pi.arc_thin_e2e import (
    _prediction_stats, _refutation_responses, _separating_tests, _write_summary, run_arc_thin_e2e,
)


def test_ledger_and_critic_are_on_by_default():
    parameters = inspect.signature(run_arc_thin_e2e).parameters
    assert parameters["ledger"].default is True and parameters["critic"].default is True
    assert parameters["carry_reasoning_chars"].default == 0


def test_known_qwen_route_encodes_requested_thinking_without_overriding_explicit_dialect(tmp_path):
    resolve = arc_thin_e2e._thinking_format_for_route
    base = {"pi_api": "openai-completions"}
    assert resolve(base, "yibu", "qwen3.8-27b", "off") == "qwen"
    assert resolve(base, "yibu", "qwen3.8-27b", "low") == "qwen"
    assert resolve(base, "yibu", "qwen3.8-27b", None) is None
    assert resolve(base, "other", "qwen3.8-27b", "off") is None
    assert resolve(base, "yibu", "other-model", "off") is None
    assert resolve({"pi_api": "openai-responses"}, "yibu", "qwen3.8-27b", "off") is None
    explicit = {**base, "thinking_format": "qwen-chat-template"}
    assert resolve(explicit, "yibu", "qwen3.8-27b", "off") == "qwen-chat-template"
    settings = {**base, "thinking_format": resolve(base, "yibu", "qwen3.8-27b", "off"),
                "input_modalities": ["text"], "context_window": 128000, "max_tokens": 2048,
                "base_url": "http://localhost/v1"}
    arc_thin_e2e._write_models_json(tmp_path, "yibu", "qwen3.8-27b", settings)
    config = json.loads((tmp_path / "models.json").read_text())
    provider = config["providers"]["yibu"]
    assert provider["compat"]["thinkingFormat"] == "qwen"
    assert provider["models"][0]["maxTokens"] == 2048


def test_partial_summary_is_marked_and_replaced_by_the_final_one(tmp_path):
    harness = tmp_path / "harness"
    harness.mkdir()
    (harness / "trajectory.jsonl").write_text('{"n": 1, "action": "ACTION1"}\n{"n": 2, "action": "ACTION2"}\n', encoding="utf-8")
    summary = {"game": "g", "stop_reason": None, "decisions": 2}
    state = {"state": "NOT_FINISHED", "levels_completed": 0, "action_budget": {"total_used": 2}}
    path = _write_summary(tmp_path, summary, state, time.monotonic(), partial=True)
    written = json.loads(path.read_text(encoding="utf-8"))
    assert written["partial"] is True and written["stop_reason"] == "running"
    assert written["actions"] == 2 and written["actions_on_bridge"] == 2 and "harness" in written
    assert summary == {"game": "g", "stop_reason": None, "decisions": 2}  # the runner's own record is untouched
    summary["stop_reason"] = "deadline"
    written = json.loads(_write_summary(tmp_path, summary, state, time.monotonic()).read_text(encoding="utf-8"))
    assert "partial" not in written and written["stop_reason"] == "deadline"
    assert not (tmp_path / "summary.json.tmp").exists()


def hyp(key, claim, status="open", refutes=0, question=None, evidence=None):
    evidence = evidence if evidence is not None else [{"condition": "c", "observed": "o", "verdict": "refutes"}] * refutes
    return {"key": key, "hyp": {"claim": claim, "status": status, "evidence": evidence, **({"question": question} if question else {})}}


def test_contested_outcomes_and_same_call_restatement():
    rows = [
        hyp("hyp.a", "rule a"), hyp("hyp.a", "rule a", "contested", 1), hyp("hyp.a", "rule a only when x", "open", 1),
        hyp("hyp.b", "rule b"), hyp("hyp.b", "rule b", "contested", 1), hyp("hyp.b", "rule b", "rejected", 1),
        hyp("hyp.c", "rule c"), hyp("hyp.c", "rule c", "contested", 1), hyp("hyp.c", "rule c", "supported", 1),
        # Refuted and rewritten in one call: never contested.
        hyp("hyp.d", "goal d"), hyp("hyp.d", "goal d, in two rounds", "open", 1),
        # A rewrite without a new refutation is not counted.
        hyp("hyp.e", "goal e"), hyp("hyp.e", "goal e, clearer"),
        # Deletion forgets the history: a re-created key starts fresh.
        {"key": "hyp.d", "deleted": True}, hyp("hyp.d", "goal d again", "open", 2),
    ]
    assert _refutation_responses(rows) == {
        "contested_outcomes": {"rejected": 1, "narrowed": 1, "status_only": 1},
        "restated_with_refutation": 1,
    }


def result(action, verdict):
    return {"action": action, "condition": "c", "observed": "o", "verdict": verdict}


def test_separating_tests_mirror_the_working_set_rule():
    rows = [
        hyp("hyp.a", "a", question="q"), hyp("hyp.b", "b", question="q"), hyp("hyp.c", "c", question="q"),
        hyp("hyp.lone", "alone", question="other"),
        # #2 gives a and b the same verdict; #3 gives them different ones.
        hyp("hyp.a", "a", "supported", question="q", evidence=[result(2, "supports")]),
        hyp("hyp.b", "b", question="q", evidence=[result(2, "supports")]),
        hyp("hyp.a", "a", "supported", question="q", evidence=[result(2, "supports"), result(3, "supports")]),
        hyp("hyp.b", "b", "rejected", question="q", evidence=[result(2, "supports"), result(3, "refutes")]),
        # c is deleted with no result; the lone hypothesis has no rival and is not counted.
        {"key": "hyp.c", "deleted": True, "dropped": {"key": "hyp.c"}},
        {"key": "hyp.lone", "deleted": True},
        {"key": "hyp.a", "deleted": True},
    ]
    # Settled: a (supported, first only by #2, which separated nothing) and b (rejected by #3, which did).
    assert _separating_tests(rows) == {
        "deleted_with_rivals": 2, "deleted_without_separating_test": 1,
        "settled_with_rivals": 2, "settled_without_separating_test": 1,
    }


def test_prediction_stats_count_fields_and_predictor_skills():
    trajectory = [
        {"prediction": {"fields": [{"field": "moved", "hit": True}, {"field": "cells", "hit": False}, {"field": "changed_cells", "hit": None}]}},
        {"skill_prediction": {"name": "step", "version": 1, "hits": 2, "misses": 1}},
        {"skill_prediction": {"name": "nope", "error": "no such skill"}},
        {},
    ]
    stats = _prediction_stats(trajectory)
    assert (stats["actions"], stats["actions_with_prediction"], stats["fields_scored"], stats["field_hits"]) == (4, 1, 2, 1)
    assert stats["by_field"] == {"cells": {"hits": 0, "scored": 1}, "moved": {"hits": 1, "scored": 1}}
    assert (stats["actions_with_skill_prediction"], stats["skill_prediction_failures"]) == (2, 1)
    assert stats["by_skill"] == {"step v1": {"hits": 2, "scored": 3}}
