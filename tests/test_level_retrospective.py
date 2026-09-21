"""Component/integration diagnostics only, not ARC self-harness closure acceptance."""
import json
from pathlib import Path
from test_pi_external_benchmark_native import _run_fixture


def test_outcome_is_persisted_review_is_idempotent_and_lessons_are_exposed(tmp_path):
    report = dict(summary="Level completed", mechanisms="Fixture only", shortcomings="No causal evidence",
                  lessons="Verify on real environment", next_attempt="Test the rule again", credits=[])
    submit = {"name": "task_harness", "arguments": {"action": "level_review",
              "window_id": "level-outcome:execution-observation-1", "level_review": report}}
    events = _run_fixture(tmp_path, "treatment", extra_env={"PI_HARNESS_PERIODIC_REVIEW": "disabled"},
        extra_extensions=[Path(__file__).parent / "pi_level_outcome_fixture.ts"],
        steps=[{"name":"arc_action","arguments":{}}, submit, submit,
               {"name":"task_resource","arguments":{"action":"read","ref":"level_review:level-outcome:execution-observation-1@v1"}}])
    observations = [json.loads(s) for s in (tmp_path / "execution-observations.jsonl").read_text().splitlines()]
    assert observations[0]["arc_outcome"]["levels_completed"] == 1
    rows = [json.loads(s) for s in (tmp_path / "task-level-reviews.jsonl").read_text().splitlines()]
    assert len(rows) == 1
    assert rows[0]["lessons"] == report["lessons"]
    returns = [e for e in events if e.get("type") == "tool_execution_end" and e.get("toolName") == "task_harness"]
    assert len(returns) == 2
    assert all(not e.get("isError") for e in returns)
    contexts = (tmp_path / "provider-contexts.jsonl").read_text(encoding="utf-8")
    assert "Pending whole-level windows" in contexts
    assert "Previous level retrospective" in contexts


def test_level_review_accepts_parallel_points_as_string_arrays(tmp_path):
    report = dict(summary="Level completed", mechanisms=["Move", "Check"],
                  shortcomings=["One weak assumption"], lessons=["Retest"],
                  next_attempt=["Use the shorter route"], credits=[])
    events = _run_fixture(tmp_path, "treatment", extra_env={"PI_HARNESS_PERIODIC_REVIEW": "disabled"},
        extra_extensions=[Path(__file__).parent / "pi_level_outcome_fixture.ts"], steps=[
            {"name":"arc_action","arguments":{}},
            {"name":"task_harness","arguments":{"action":"level_review",
             "window_id":"level-outcome:execution-observation-1","level_review":report}}])
    assert not [e for e in events if e.get("type") == "tool_execution_end" and e.get("isError")]
    saved = json.loads((tmp_path / "task-level-reviews.jsonl").read_text().splitlines()[0])
    assert saved["mechanisms"] == "Move\nCheck"


def test_terminal_review_blocks_actions_but_allows_submission(tmp_path):
    from test_pi_external_benchmark_native import _pi_cli
    from autoresearch_pi.pi_kernel import PiKernel
    node, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    command = [node, cli, "--mode", "rpc", "--provider", "offline-external-test", "--model", "scripted",
               "--no-session", "--no-extensions", "--no-skills", "--no-context-files", "--no-builtin-tools"]
    for path in ["demo/pi_external_benchmark_research.ts", "tests/pi_external_benchmark_provider.ts", "tests/pi_level_outcome_fixture.ts"]:
        command.extend(["--extension", str(project / path)])
    report = dict(summary="Ended", mechanisms="Unknown", shortcomings="Unverified", lessons="Check evidence",
                  next_attempt="Re-evaluate", credits=[])
    steps = [{"name":"arc_action","arguments":{}}, None,
             {"name":"arc_action","arguments":{}},
             {"name":"task_memory","arguments":{"action":"upsert","key":"forbidden","content":"x"}},
             {"name":"task_harness","arguments":{"action":"level_review",
              "window_id":"level-outcome:execution-observation-1","level_review":report}}]
    env = {"PI_CODING_AGENT_DIR":str(tmp_path / ".pi"), "PI_AUTORESEARCH_E2E_ROOT":str(tmp_path),
           "PI_AUTORESEARCH_ROOT":str(project), "PI_AUTORESEARCH_VARIANT":"treatment",
           "PI_HARNESS_PERIODIC_REVIEW":"disabled", "PI_EXTERNAL_STEPS":json.dumps(steps)}
    with PiKernel(command, cwd=str(tmp_path), env=env, timeout=60) as kernel:
        kernel.prompt("Run first action")
        kernel.wait_for_agent_events(timeout=60)
        kernel.prompt("ARC_TERMINAL_LEVEL_REVIEW")
        events = kernel.wait_for_agent_events(timeout=60)
    outputs = [e for e in events if e.get("type") == "tool_execution_end"]
    blocked = [e for e in outputs if e.get("toolName") in {"arc_action","task_memory"}]
    assert len(blocked) == 2
    assert all("Terminal level review permits" in json.dumps(e) for e in blocked)
    assert not (tmp_path / "task-memory.jsonl").exists()
    assert len((tmp_path / "task-level-reviews.jsonl").read_text().splitlines()) == 1
