"""Small end-to-end smoke checks for the parent/child self-harness loop.

These deliberately use the offline scripted providers.  They still launch a
real Pi parent and a real Pi child through the loopback broker, so failures in
child transport, report parsing, route application, or the next-turn context
surface are observable without depending on a remote model.
"""

import json
import os
from urllib.request import Request, urlopen
from pathlib import Path

from test_pi_external_benchmark_native import _pi_cli, _run_fixture
from test_task_research_context import harness_delivery, records, results, run_router_helper, wait_for_broker_job
from autoresearch_pi.subagent_broker import SubagentBroker


def _child_env(project: Path, cli: str, report: dict, steps: list[dict]) -> dict[str, str]:
    return {
        "PI_AUTORESEARCH_PI_CLI": cli,
        "PI_AUTORESEARCH_PROVIDER": "offline-subagent-test",
        "PI_AUTORESEARCH_MODEL": "scripted",
        "PI_AUTORESEARCH_SUBAGENT_PROVIDER_EXTENSION": str(project / "tests" / "pi_subagent_provider.ts"),
        "PI_SUBAGENT_REPORT": json.dumps(report),
        "PI_SUBAGENT_STEPS": json.dumps(steps),
    }


def test_smoke_parent_auto_research_starts_real_child(tmp_path):
    """The first parent tool call can actually start and complete a child."""
    _, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    root = tmp_path / "parent-starts-child"
    report = {
        "format": "auto-research-report-v1",
        "status": "inconclusive",
        "conclusion": "The fixture requires another observation.",
        "findings": [], "evidence_refs": [], "alternatives": [],
        "limitations": [], "validation_plan": "Collect the next observation.",
        "harness_proposals": [],
    }
    events = _run_fixture(
        root, "treatment",
        extra_extensions=[project / "tests" / "pi_non_arc_task_subagents.ts"],
        extra_env=_child_env(project, cli, report, [
            {"name": "submit_research_report", "arguments": {"report": report}},
        ]),
        steps=[{"name": "auto_research", "arguments": {
            "question": "Start Auto-Research before taking any parent action.",
            "scope": "harness_component",
        }}],
    )
    auto = results(events, "auto_research")[0]
    assert not auto.get("isError"), auto
    progress = records(root, "subagent-progress.jsonl")
    assert progress[0]["event"] == "spawned"
    assert progress[-1]["event"] == "process_closed"
    assert progress[-1]["phase"] == "completed"
    assert "spawn EPERM" not in json.dumps(progress)
    assert records(root, "auto-research-runs.jsonl")[0]["status"] == "completed"


def test_non_blocking_experiment_request_reaches_parent_inbox_and_status(tmp_path):
    """A child experiment request is durable and visible to the next parent turn."""
    _, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    root = tmp_path / "parent-receives-experiment"
    report = {
        "format": "auto-research-report-v1",
        "status": "supported_within_scope",
        "conclusion": "One parent probe can distinguish the two live explanations.",
        "findings": [], "evidence_refs": [], "alternatives": [], "limitations": [],
        "validation_plan": "Run the bounded parent probe and compare its transition.",
        "experiment_request": {
            "objective": "Distinguish direct control from autonomous motion.",
            "prerequisites": ["The object is visible"],
            "parent_action": "Apply ACTION1 once at the current state.",
            "suggested_next_action": "ACTION1",
            "requested_max_actions": 1,
            "predicted_outcomes": [{
                "condition": "direct control",
                "expected_observation": "The object changes immediately",
                "implication": "Retain the direct-control hypothesis",
            }],
            "falsifier": "The same change occurs without ACTION1.",
            "expected_information_gain": "Separates the two live explanations.",
            "action_cost": "One parent ARC action.",
            "stop_condition": "Stop after the first discriminating transition.",
            "evidence_refs": [],
        },
        "harness_proposals": [],
    }
    broker = SubagentBroker()
    broker.start()
    try:
        env = {
            **_child_env(project, cli, report, [{"name": "submit_research_report", "arguments": {"report": report}}]),
            "PI_AUTORESEARCH_SUBAGENT_BROKER_URL": broker.url,
        }
        first = _run_fixture(root, "treatment", extra_extensions=[project / "tests" / "pi_non_arc_task_subagents.ts"],
                             extra_env=env, steps=[{"name": "auto_research", "arguments": {
                                 "question": "Which parent probe best distinguishes the current explanations?",
                                 "interaction_mode": "non_blocking", "research_kind": "mechanism",
                             }}])
        accepted = json.loads(results(first, "auto_research")[0]["result"]["content"][0]["text"])
        wait_for_broker_job(root, "auto-research-1")
        second = _run_fixture(root, "treatment", extra_extensions=[project / "tests" / "pi_non_arc_task_subagents.ts"],
                              extra_env=env, steps=[{"name": "task_harness_status", "arguments": {"request": "current"}}])
        status = json.loads(results(second, "task_harness_status")[0]["result"]["content"][0]["text"])
        candidates = status["research_experiment_candidates"]
        assert candidates and candidates[0]["request"]["request_ref"].startswith("research-experiment:auto-research-1")
        assert candidates[0]["request"]["parent_action"] == report["experiment_request"]["parent_action"]
        context_text = json.dumps(records(root, "provider-contexts.jsonl")[-1])
        assert "AUTO-RESEARCH COMPLETION INBOX" in context_text
        assert report["experiment_request"]["objective"] in context_text
        assert accepted["accepted"] is True and accepted["status"] == "active"
        persisted = records(root, "auto-research-reports.jsonl")[-1]
        assert persisted["experiment_request"]["request_ref"].startswith("research-experiment:auto-research-1")
    finally:
        broker.close()


def test_smoke_next_turn_uses_skill_materialized_by_previous_route(tmp_path):
    """A route applied in turn one is loadable and usable in turn two."""
    _, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    root = tmp_path / "next-turn-skill"
    delivery = harness_delivery(
        "next-turn-review", "procedure", "next-turn-review",
        "Read fixture_state before choosing the next action.",
        summary="A reusable review procedure for the next parent turn.",
        expected_effect="make the next decision evidence-led",
    )
    report = {
        "format": "auto-research-report-v1", "status": "supported_within_scope",
        "conclusion": "The procedure is ready for the next turn.", "findings": [],
        "evidence_refs": [], "alternatives": [], "limitations": [],
        "validation_plan": "Use the procedure on the next fixture state.",
        "harness_proposals": [{"approval_id": "auto-research-1:proposal-1", "delivery": delivery}],
    }
    child_steps = [
        {"name": "research_approval", "arguments": {
            "action": "propose", "approval_id": "auto-research-1:proposal-1", "delivery": delivery,
        }},
        {"name": "research_approval", "arguments": {
            "action": "approve", "approval_id": "auto-research-1:proposal-1", "target_version": 1,
        }},
        {"name": "submit_research_report", "arguments": {"report": report}},
    ]
    route_hash = run_router_helper(
        "router.harnessDeliveryHash(JSON.parse(process.env.AUTORESEARCH_ROUTER_TEST_INPUT))",
        input_value=delivery,
    )
    first_events = _run_fixture(
        root, "treatment",
        extra_extensions=[project / "tests" / "pi_non_arc_task_subagents.ts"],
        extra_env=_child_env(project, cli, report, child_steps),
        steps=[
            {"name": "auto_research", "arguments": {
                "question": "Should the next turn use a reusable review procedure?",
                "scope": "harness_component",
            }},
                {"name": "task_harness", "arguments": {
                    "action": "apply_route",
                    "route_ref": "harness_route:auto-research-1:route-next-turn-review@v1",
                    "expected_delivery_hash": route_hash,
                }},
                {"name": "task_harness", "arguments": {
                    "action": "assemble", "expected_assembly_revision": 0,
                    "selected_resource_refs": ["skill:next-turn-review@v1"],
                    "prompt_contributions": [],
                    "decision": {"basis_refs": ["research_run:auto-research-1@v1"],
                                 "reason": "Select the adopted review procedure for the next turn.",
                                 "expected": "The next parent request can use the exact selected skill."},
                }},
        ],
    )
    assert not results(first_events, "auto_research")[0].get("isError")
    assert not results(first_events, "task_harness")[0].get("isError")
    assert records(root, "auto-research-harness-route-receipts.jsonl")[0]["status"] == "applied"
    assert records(root, "task-skills.jsonl")[0]["name"] == "next-turn-review"

    # A fresh parent process is the next Pi turn.  Its provider context must
    # expose the persisted skill, and the explicit inspect call must return the
    # exact instructions written by the native task_skill implementation.
    second_events = _run_fixture(
        root, "treatment",
        extra_extensions=[project / "tests" / "pi_non_arc_task_subagents.ts"],
        steps=[{"name": "task_skill", "arguments": {
            "action": "inspect", "name": "next-turn-review",
        }}],
    )
    inspected = results(second_events, "task_skill")[0]
    assert not inspected.get("isError"), inspected
    assert "Read fixture_state before choosing the next action." in json.dumps(inspected)
    contexts = records(root, "provider-contexts.jsonl")
    assert any("next-turn-review" in json.dumps(item) for item in contexts)
    assert any("Read fixture_state before choosing the next action." in json.dumps(item) for item in contexts)


def test_broker_drops_repeated_streaming_fragments_but_keeps_terminal_events(tmp_path):
    """Transport coalescing must not hide tool/lifecycle events from the parent."""
    node, _ = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    broker = SubagentBroker()
    broker.start()
    try:
        payload = {
            "job_id": "stream-filter-smoke",
            "command": [node, str(project / "tests" / "pi_streaming_fragments_child.mjs")],
            "cwd": str(project),
            "env": {str(k): str(v) for k, v in os.environ.items()},
        }
        request = Request(
            f"{broker.url}/spawn",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urlopen(request, timeout=15) as response:
            envelopes = [json.loads(line) for line in response.read().decode("utf-8").splitlines()]
    finally:
        broker.close()

    stdout = [json.loads(item["data"]) for item in envelopes if item.get("event") == "stdout"]
    assert [item["type"] for item in stdout] == ["message_end"]
    assert any(item.get("event") == "started" for item in envelopes)
    assert any(item.get("event") == "exit" and item.get("code") == 0 for item in envelopes)


def test_child_context_projection_fits_requested_budget_and_keeps_page_reference(tmp_path):
    """Large observations are projected for the provider without mutating the source."""
    _, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    root = tmp_path / "context-projection"
    report = {
        "format": "auto-research-report-v1", "status": "inconclusive",
        "conclusion": "The selected observations require a follow-up probe.",
        "findings": [], "evidence_refs": [], "alternatives": [], "limitations": [],
        "validation_plan": "Collect one more observation.", "harness_proposals": [],
    }
    events = _run_fixture(
        root, "treatment",
        extra_extensions=[project / "tests" / "pi_non_arc_task_subagents.ts"],
        extra_env=_child_env(project, cli, report, [
            {"name": "submit_research_report", "arguments": {"report": report}},
        ]),
        steps=[
            {"name": "benchmark_probe", "arguments": {}},
            {"name": "benchmark_probe", "arguments": {}},
            {"name": "auto_research", "arguments": {
                "question": "Can the child inspect the selected observations?",
                "scope": "harness_component",
                "context_window": {
                    "recent_observations": 2,
                    "max_chars": 6000,
                },
            }},
        ],
    )
    assert not results(events, "auto_research")[0].get("isError")
    contexts = records(root, "subagent-provider-contexts.jsonl")
    prompt = next(
        part["text"]
        for item in contexts
        for message in item["context"].get("messages", [])
        if message.get("role") == "user"
        for part in message.get("content", [])
        if part.get("type") == "text" and "Parent-selected context window" in part.get("text", "")
    )
    marker = "Parent-selected context window (bounded state, not the parent transcript): "
    encoded = prompt.split(marker, 1)[1].split("\n\n# Available access", 1)[0]
    window = json.loads(encoded)
    assert len(json.dumps(window, ensure_ascii=False, separators=(",", ":"))) <= 6000
    assert window["projection"]["truncated"] is True
    assert window["projection"]["canonical_source"] == "execution-observations.jsonl"
    # The canonical source remains lossless and is still page-able by the child.
    observations = [json.loads(line) for line in (root / "execution-observations.jsonl").read_text(encoding="utf-8").splitlines()]
    assert sum(item.get("tool_name") == "benchmark_probe" for item in observations) == 2
    assert window["projection"]["page_with"]


def test_provider_length_boundary_is_resumed_inside_one_parent_tool_call(tmp_path):
	"""The runtime, not the parent model, owns provider-length continuation."""
	_, cli = _pi_cli()
	project = Path(__file__).resolve().parents[1]
	root = tmp_path / "length-resume"
	report = {
		"format": "auto-research-report-v1", "status": "inconclusive",
		"conclusion": "The internally resumed child completed the structured report.",
		"findings": [], "evidence_refs": [], "alternatives": [], "limitations": [],
		"validation_plan": "Collect a discriminating observation.", "harness_proposals": [],
	}
	events = _run_fixture(
		root, "treatment",
		extra_extensions=[project / "tests" / "pi_non_arc_task_subagents.ts"],
		extra_env={
            "PI_AUTORESEARCH_PI_CLI": cli,
            "PI_AUTORESEARCH_PROVIDER": "offline-subagent-test",
            "PI_AUTORESEARCH_MODEL": "scripted",
            "PI_AUTORESEARCH_SUBAGENT_PROVIDER_EXTENSION": str(project / "tests" / "pi_subagent_provider.ts"),
			"PI_SUBAGENT_FORCE_LENGTH_ONCE": "1",
			"PI_SUBAGENT_REPORT": json.dumps(report),
			"PI_SUBAGENT_STEPS": json.dumps([
				{"name": "submit_research_report", "arguments": {"report": report}},
			]),
		},
		steps=[{"name": "auto_research", "arguments": {
			"question": "Can the child finish this report?", "scope": "hypothesis",
		}}],
	)
	completed = results(events, "auto_research")[0]
	assert not completed.get("isError"), completed
	assert json.loads(completed["result"]["content"][0]["text"])["status"] == "completed"
	sessions = records(root, "auto-research-sessions.jsonl")
	assert [item["status"] for item in sessions] == ["active", "completed"]
	assert sessions[-1]["status"] == "completed"
	receipts = records(root, "auto-research-continuations.jsonl")
	assert [item["stop_reason"] for item in receipts] == ["length", "submitted_report"]
	assert receipts[0]["checkpoint"]["pause_reason"] == "provider_stop_reason_length"
	assert receipts[0]["checkpoint"]["partial_output"]
	assert receipts[1]["cumulative_usage"]["output"] == 10
	assert len({item["session_id"] for item in receipts}) == 1
	assert len({item["run_id"] for item in receipts}) == 1
	contexts = records(root, "subagent-provider-contexts.jsonl")
	assert len(contexts) == 2
	# Verify the actual continuation state, not its old prose heading.
	prompt = (root / ".task-child-prompts" / "auto-research-1_continuation-2.txt").read_text(encoding="utf-8")
	workset = json.loads(prompt.split("\n", 1)[1].split("\nParent-selected", 1)[0])
	assert receipts[0]["checkpoint"]["partial_output"]
	assert "partial_output" not in workset["research_checkpoint"]
	assert receipts[0]["checkpoint"]["partial_output"] not in prompt
	assert "Complete the existing research turn from the native session" in workset["goal"]
	assert workset["research_state"]["continuation_attempt"] == 2
