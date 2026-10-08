"""Real Pi/broker diagnostics; scripted provider, no ARC/paid quality claim."""
import json
from pathlib import Path

import pytest

from test_task_research_context import _pi_cli, _run_fixture, records, results, wait_for_broker_job
from autoresearch_pi.subagent_broker import SubagentBroker


@pytest.mark.parametrize("mode", ["distill", "pending", "saved-pending", "non-blocking"])
def test_research_read_batch_compacts_or_returns_pending_through_native_pi(tmp_path, mode):
    _, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    distill = mode == "distill"
    root = tmp_path / mode
    ref = "memory:chosen@v1"
    summary = "Hypothesis provisional; observed counterevidence rules out universal no-op; next experiment is not executed."
    report = {"format": "auto-research-report-v1", "status": "inconclusive",
              "conclusion": summary, "findings": [], "evidence_refs": [ref],
              "alternatives": ["An untested target may behave differently."],
              "limitations": ["Raw pages alone do not resolve the mechanism."],
              "validation_plan": "Request a bounded new environment test.", "method_candidates": []}
    child_steps = [
        {"name": "task_resource", "arguments": {"action": "read", "ref": ref, "offset": 0, "limit": 4000}},
        {"name": "task_resource", "arguments": {"action": "read", "ref": ref, "offset": 4000, "limit": 4000}},
    ]
    if distill:
        child_steps += [
            {"name": "child_context", "arguments": {"action": "compact",
                "refs": ["child_result:subagent-fixture-1", "child_result:subagent-fixture-2"], "summary": summary}},
            {"name": "task_resource", "arguments": {"action": "read", "ref": ref, "offset": 0, "limit": 4000}},
            {"name": "submit_research_report", "arguments": {"report": report}},
        ]
    else:
        child_steps += [{"name": "task_resource", "arguments": {
            "action": "read", "ref": ref, "offset": 8000, "limit": 4000}}]
    if mode == "saved-pending":
        child_steps.insert(0, {"name": "research_checkpoint", "arguments": {"action": "save",
            "draft_findings": [{"conclusion": summary}], "unresolved_questions": ["Which target distinguishes the alternatives?"],
            "next_step": "Request the unexecuted target B test.", "evidence_refs": [ref]}})
    child_env = {
        "PI_AUTORESEARCH_PI_CLI": cli, "PI_AUTORESEARCH_PROVIDER": "offline-subagent-test",
        "PI_AUTORESEARCH_MODEL": "scripted",
        "PI_AUTORESEARCH_SUBAGENT_PROVIDER_EXTENSION": str(project / "tests/pi_subagent_provider.ts"),
        "PI_AUTORESEARCH_CHILD_READ_BATCH_MAX_BYTES": "6000",
        "PI_SUBAGENT_STEPS": json.dumps(child_steps), "PI_SUBAGENT_REPORT": json.dumps(report),
        "PI_AUTORESEARCH_PROVIDER_PROMPT_CAPTURE": "all",
    }
    parent_steps = [
        {"name": "task_memory", "arguments": {"action": "upsert", "key": "chosen",
            "content": "RAW_COUNTEREVIDENCE_GRID_" * 900}},
        {"name": "auto_research", "arguments": {"question": "Compare evidence while preserving counterexamples.",
            "scope": "hypothesis", "inherit_harness_refs": [ref]}},
    ]
    broker = SubagentBroker() if mode == "non-blocking" else None
    if broker:
        broker.start()
        child_env["PI_AUTORESEARCH_SUBAGENT_BROKER_URL"] = broker.url
        parent_steps[-1]["arguments"]["interaction_mode"] = "non_blocking"
    try:
        events = _run_fixture(root, "treatment", extra_extensions=[project / "tests/pi_non_arc_task_subagents.ts"],
                              extra_env=child_env, steps=parent_steps)
        if broker:
            wait_for_broker_job(root, "auto-research-1")
            _run_fixture(root, "treatment", extra_extensions=[project / "tests/pi_non_arc_task_subagents.ts"],
                         extra_env=child_env, steps=[{"name": "auto_research", "arguments": {
                             "action": "inspect", "session_ref": "research_session:research-session-1@v1"}}])
    finally:
        if broker:
            broker.close()
    returned = results(events, "auto_research")[0]
    assert not returned.get("isError")
    contexts = records(root, "subagent-provider-contexts.jsonl")
    final_payloads = sorted((json.loads(p.read_text(encoding="utf-8")) for p in root.glob("provider-prompt-*.json")),
                            key=lambda p: p["request_index"])
    final_payloads = [p["payload"] for p in final_payloads if p["scope"] == "task-child"]
    assert len(final_payloads) == len(contexts)
    capacity_turn = 3 if mode == "saved-pending" else 2
    assert "Research read batch capacity:" in json.dumps(contexts[capacity_turn])
    accesses = [r for r in records(root, "task-resource-access.jsonl") if r.get("resource_ref") == ref]
    checkpoint_path = root / "task-context-cache/auto-research-checkpoints/research-session-1.json"
    checkpoint = json.loads(checkpoint_path.read_text(encoding="utf-8"))
    if distill:
        assert len(contexts) == 5
        after = json.dumps(contexts[3]["context"]["messages"])
        assert summary in after
        assert "RAW_COUNTEREVIDENCE_GRID_" not in after
        assert summary in json.dumps(final_payloads[3]["messages"])
        assert "RAW_COUNTEREVIDENCE_GRID_" not in json.dumps(final_payloads[3]["messages"])
        assert "RAW_COUNTEREVIDENCE_GRID_" in json.dumps(contexts[4])
        assert len(accesses) == 3
        first, restored = accesses[0], accesses[-1]
        assert first["page_sha256"] == restored["page_sha256"]
        assert records(root, "auto-research-runs.jsonl")[-1]["status"] == "completed"
        assert records(root, "auto-research-reports.jsonl")[-1]["report"]["conclusion"] == summary
    else:
        assert len(contexts) == capacity_turn + 1, "ignored pressure must not trigger another model request"
        assert len(accesses) == 2, "blocked retrieval must not access canonical evidence"
        assert checkpoint["status"] == "pending"
        assert checkpoint["pause_reason"] == "research_read_batch_capacity"
        assert checkpoint["wait_for"] == "manual_resume"
        assert checkpoint["read_batch_boundary"]["resident_read_bytes"] >= 6000
        if mode == "saved-pending":
            assert checkpoint["draft_findings"] == [{"conclusion": summary}]
            assert checkpoint["next_step"] == "Request the unexecuted target B test."
            assert checkpoint["unresolved_questions"] == ["Which target distinguishes the alternatives?"]
        else:
            assert checkpoint["draft_findings"] == [], "runtime must not invent semantic progress"
        assert records(root, "auto-research-sessions.jsonl")[-1]["status"] == "pending"
        assert not records(root, "auto-research-reports.jsonl")
