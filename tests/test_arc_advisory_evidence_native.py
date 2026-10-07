"""Real Pi entry diagnostics; action counter is a fixture, not SDK acceptance."""
import json
from pathlib import Path

from test_pi_external_benchmark_native import _run_fixture


def test_advisory_periodic_window_is_evidence_without_repeated_development_obligation(tmp_path):
    project = Path(__file__).resolve().parents[1]
    events = _run_fixture(tmp_path, "treatment", arc_compact=True,
        extra_extensions=[project / "tests/pi_periodic_review_fixture.ts"],
        steps=[{"name": "arc_action", "arguments": {}} for _ in range(6)])
    actions = [e for e in events if e.get("type") == "tool_execution_end" and e.get("toolName") == "arc_action"]
    assert len(actions) == 6 and not any(e.get("isError") for e in actions)
    contexts = [json.loads(line)["context"] for line in
                (tmp_path / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()]
    after_five = contexts[5]
    texts = [p["text"] for m in after_five["messages"] for p in m.get("content", []) if p.get("type") == "text"]
    cue = next(t for t in texts if t.startswith("Periodic evidence available:"))
    card, _ = json.JSONDecoder().raw_decode(cue.split(": ", 1)[1])
    assert card["window_id"] == "arc-pattern-5" and len(card["evidence_refs"]) == 5
    assert "batch" not in card and len(cue) < 1600
    assert "Continue task work" in cue and "no review" in cue
    assert not any(t.startswith("Periodic pattern extraction due:") for t in texts)
    assert not any(t.startswith("Capability workflow reference:") for t in texts)
    assert "infrastructure blocker" not in json.dumps(contexts)
    opportunities = [json.loads(line) for line in
                     (tmp_path / "task-harness-opportunities.jsonl").read_text(encoding="utf-8").splitlines()]
    window = next(r["window"] for r in opportunities if r.get("window", {}).get("window_id") == card["window_id"])
    assert window["evidence_refs"] == card["evidence_refs"]
    assert not (tmp_path / "task-harness-reviews.jsonl").exists()


def test_required_mode_keeps_explicit_decision_and_full_evidence_batch(tmp_path):
    project = Path(__file__).resolve().parents[1]
    events = _run_fixture(tmp_path, "treatment", arc_compact=True,
        extra_env={"PI_HARNESS_REVIEW_DECISION_REQUIRED": "enabled"},
        extra_extensions=[project / "tests/pi_periodic_review_fixture.ts"],
        steps=[*[ {"name": "arc_action", "arguments": {}} for _ in range(6)],
               {"name": "task_harness", "arguments": {"action": "defer_review",
                "review_reason": "Obtain a contrasting observation.", "resume_condition": {"kind": "manual"}}},
               {"name": "arc_action", "arguments": {}}])
    actions = [e for e in events if e.get("type") == "tool_execution_end" and e.get("toolName") == "arc_action"]
    assert sum(bool(e.get("isError")) for e in actions) == 1
    contexts = [json.loads(line)["context"] for line in
                (tmp_path / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()]
    texts = [p["text"] for m in contexts[5]["messages"] for p in m.get("content", []) if p.get("type") == "text"]
    cue = next(t for t in texts if t.startswith("Periodic pattern extraction due:"))
    card, _ = json.JSONDecoder().raw_decode(cue.split(": ", 1)[1])
    assert "batch" in card and "before the next environment action" in cue
    receipt = [json.loads(line) for line in (tmp_path / "task-harness-review-events.jsonl").read_text(encoding="utf-8").splitlines()][-1]
    assert receipt["status"] == "deferred" and receipt["resume_condition"] == {"kind": "manual"}
