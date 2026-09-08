import json
import pytest
import sys
from pathlib import Path
from types import SimpleNamespace

import autoresearch_pi.officebench_e2e as officebench_e2e
from autoresearch_pi.officebench_e2e import (
    PiOfficeBenchRun,
    _officebench_artifact_contract,
    _closed_loop_evidence,
    _extract_agent_outcome,
    _extract_answer,
    _execution_condition_effect,
    _mutation_evidence,
    _research_connection,
    _replace_stale_runtime_capability_disclosure,
    _task_resource_boundary_assessment,
    run_pi_officebench_task,
    run_officebench_e2e,
    run_officebench_e2e_batch,
)
from autoresearch_pi.officebench_tool_bridge import (
    apply_task_resource_boundary,
    classify_officebench_result,
)
from autoresearch_pi.project import ProjectPaths


def test_extract_answer_from_pi_agent_end():
    events = ({
        "type": "agent_end",
        "messages": [{"role": "assistant", "content": [{"type": "text", "text": "done"}]}],
    },)
    assert _extract_answer(events) == "done"


@pytest.mark.parametrize(
    "text,expected",
    [
        ("OBSERVATION: Successfully list events for Bob.", ("success", None)),
        ("Error: unknown OfficeBench action 'calendar.calendar_action'.", ("semantic_error", "unknown_action")),
        ("Failed to execute command: directory not found: /bad", ("semantic_error", "action_failed")),
        ("cat: unknown option -- -", ("semantic_error", "shell_command_error")),
        ("系统找不到指定的路径。", ("semantic_error", "shell_command_error")),
        (
            'if "the system cannot find the path specified" in lowered:',
            ("success", None),
        ),
        (
            "Directory listing succeeded\nThe system cannot find the path specified.",
            ("semantic_error", "shell_command_error"),
        ),
        (
            "Argument expected for the -c option\nusage: python [option]",
            ("semantic_error", "shell_command_error"),
        ),
        (
            'Traceback (most recent call last):\nUnicodeEncodeError: codec failed',
            ("semantic_error", "shell_command_error"),
        ),
        (
            "'ls' is not recognized as an internal or external command, operable program or batch file.",
            ("semantic_error", "shell_command_error"),
        ),
        (
            "Error executing 'calendar.list_events': 'username'",
            ("semantic_error", "action_error"),
        ),
    ],
)
def test_officebench_bridge_classifies_model_relevant_outcomes(text, expected):
    assert classify_officebench_result(text) == expected


def test_runtime_task_discloses_actual_initial_capabilities_without_two_tool_conflict():
    stale = (
        "Task instructions.\n"
        "You only have two exposed tools in this environment: `officebench_action` and `final_answer`.\n"
        "Every OfficeBench action must be called through `officebench_action` using JSON.\n"
        'Example: `{"app": "shell", "action": "command", "args": {"command": "ls data"}}`.\n'
        "Your per-task workspace is: D:\\runs\\sibling\n"
        "Task testbed root is: D:\\runs\\sibling\\testbed\n"
        "When you use shell commands, prefer relative paths."
    )

    updated = _replace_stale_runtime_capability_disclosure(stale)

    assert "only have two exposed tools" not in updated
    assert "calendar_action" in updated
    assert "email_action" in updated
    assert "research_resource" in updated
    assert "decide_execution_surface" in updated
    assert "optional" in updated.lower()
    assert "current case testbed is the only task workspace" in updated
    assert "workspace_file_action" in updated
    assert "task-resource boundary" in updated
    assert "D:\\runs\\sibling" not in updated
    assert '"app": "shell"' not in updated


def test_artifact_contract_discloses_backend_outputs_without_evaluator_answers():
    contract = _officebench_artifact_contract()

    assert contract["format"] == "officebench-task-artifact-contract-v1"
    assert contract["scope"]["task_workspace"] == "current_case_testbed_only"
    assert contract["scope"]["allowed_relative_roots"] == ["data", "calendar", "emails"]
    assert contract["actions"]["calendar.create_event"]["artifacts"] == [
        {"path": "calendar/{user}.ics", "effect": "create_or_update_named_user_calendar"},
    ]
    assert contract["actions"]["calendar.create_event"]["verify_with"] == "calendar.list_events"
    assert contract["actions"]["email.send_email"]["artifacts"] == [
        {"path": "emails/{sender}/{subject}.eml", "effect": "sender_copy"},
        {"path": "emails/{recipient}/{subject}.eml", "effect": "recipient_copy"},
    ]
    assert contract["actions"]["email.send_email"]["semantics"]["recipients_per_call"] == 1
    assert "exactly seven" in contract["task_language_conventions"]["relative_time"]
    assert "current user's calendar" in contract["task_language_conventions"]["singular_calendar_event"]
    assert "case-sensitive" in contract["task_language_conventions"]["artifact_identifier_case"]
    assert "current user's exact row time" in contract["task_language_conventions"]["row_scoped_schedule"]
    assert "file_path" in contract["model_disclosure"]["safe_inspection"]
    assert contract["actions"]["email.send_email"]["semantics"]["existing_same_subject_copy"] == "overwritten"
    assert contract["model_disclosure"]["format"] == contract["format"]
    serialized = json.dumps(contract).lower()
    assert "evaluator" not in serialized
    assert "ground_truth" not in serialized
    assert "expected answer" not in serialized


def test_task_resource_catalog_bounds_inventory_and_selects_relevant_contracts(tmp_path):
    assert hasattr(officebench_e2e, "_build_task_resource_catalog"), "task resource catalog builder is missing"
    testbed = tmp_path / "testbed"
    (testbed / "data").mkdir(parents=True)
    (testbed / "calendar").mkdir()
    (testbed / "data" / "team.xlsx").write_bytes(b"xlsx fixture")
    (testbed / "data" / "brief.txt").write_text("brief", encoding="utf-8")
    outside = tmp_path / "private.txt"
    outside.write_text("not a task resource", encoding="utf-8")

    catalog = officebench_e2e._build_task_resource_catalog(
        testbed,
        "Schedule a calendar event and send email to every member from an Excel file.",
        _officebench_artifact_contract(),
    )

    assert catalog["format"] == "officebench-task-resource-catalog-v1"
    assert catalog["inventory"] == {
        "root": ".",
        "entries": [
            {"path": "calendar/", "kind": "directory"},
            {"path": "data/", "kind": "directory"},
            {"path": "data/brief.txt", "kind": "file", "size": 5},
            {"path": "data/team.xlsx", "kind": "file", "size": 12},
        ],
        "truncated": False,
    }
    assert catalog["relevant_apps"] == ["calendar", "email", "excel"]
    assert catalog["action_contracts"]["excel.read_file"]["args"]["file_path"] == (
        "relative path under the current testbed"
    )
    assert list(catalog["action_contracts"]) == [
        "calendar.list_events", "calendar.create_event",
        "email.send_email", "email.list_emails", "email.read_email",
        "excel.read_file",
    ]
    assert len(json.dumps(catalog)) < 8_000
    assert catalog["canonical_contract"] == {
        "path": "artifact-contract.json",
        "format": "officebench-task-artifact-contract-v1",
        "coverage": "complete_backend_contract_audit_artifact",
    }
    serialized = json.dumps(catalog)
    assert str(tmp_path) not in serialized
    assert "private.txt" not in serialized
    assert "evaluator" not in serialized.lower()


def test_execution_efficiency_counts_bridge_processes_and_disclosure_reads(tmp_path):
    assert hasattr(officebench_e2e, "_execution_efficiency"), "execution efficiency projection is missing"
    root = tmp_path / "efficiency"
    root.mkdir()
    (root / "task-resource-catalog.json").write_text(json.dumps({
        "inventory": {"entries": [{"path": "data/team.xlsx"}]},
    }), encoding="utf-8")
    observations = [
        {"event_id": "read", "tool": "officebench_action", "category": "task_action", "outcome": "success"},
        {"event_id": "batch", "tool": "email_batch_action", "category": "task_action", "outcome": "success",
         "attempted_work_units": 12, "completed_work_units": 12},
        {"event_id": "files", "tool": "workspace_file_action", "category": "resource", "outcome": "success"},
        {"event_id": "contract", "tool": "task_artifact_contract", "category": "resource",
         "outcome": "semantic_error"},
    ]
    (root / "execution-observations.jsonl").write_text(
        "".join(json.dumps(record) + "\n" for record in observations), encoding="utf-8",
    )
    native = PiOfficeBenchRun(
        "0.80.6", "model", "done", True, "",
        ({"type": "turn_end"}, {"type": "turn_end"}), {}, {}, {}, {}, {}, {},
    )

    report = officebench_e2e._execution_efficiency(root, native)

    assert report["model_turns"] == 2
    assert report["task_action_calls"] == 2
    assert report["resource_calls"] == 2
    assert report["semantic_errors"] == 1
    assert report["backend_bridge_processes"] == 2
    assert report["attempted_work_units"] == 13
    assert report["completed_work_units"] == 13
    assert report["work_units_per_bridge_process"] == 6.5
    assert report["artifact_contract_tool_reads"] == 1
    assert report["workspace_file_action_calls"] == 1
    assert report["catalog_initial_disclosures"] == 1
    assert report["inventory_entries_disclosed"] == 1


def test_bridge_boundary_allows_testbed_paths_and_rejects_external_resources(tmp_path):
    workspace = tmp_path / "workspace"
    (workspace / "testbed" / "data").mkdir(parents=True)

    allowed, error = apply_task_resource_boundary(
        workspace,
        {"app": "excel", "action": "read_file", "args": {"file_path": "data/input.xlsx"}},
    )
    assert error is None
    assert allowed["args"]["file_path"] == "data/input.xlsx"

    _, error = apply_task_resource_boundary(
        workspace,
        {"app": "word", "action": "read_file", "args": {"file_path": "../../sibling/summary.json"}},
    )
    assert error["outcome"] == "semantic_error"
    assert error["error_kind"] == "task_resource_boundary_violation"

    _, error = apply_task_resource_boundary(
        workspace,
        {"app": "excel", "action": "read_file", "args": {"file_path": str(tmp_path / "evaluator.py")}},
    )
    assert error["error_kind"] == "task_resource_boundary_violation"

    _, error = apply_task_resource_boundary(
        workspace,
        {"app": "shell", "action": "command", "args": {"command": "dir data"}},
    )
    assert error["error_kind"] == "task_resource_boundary_violation"
    assert "workspace_file_action" in error["text"]


def test_resource_boundary_assessment_projects_rejected_attempts(tmp_path):
    root = tmp_path / "boundary-audit"
    root.mkdir()
    (root / "execution-observations.jsonl").write_text(
        "".join(json.dumps(record) + "\n" for record in [
            {"event_id": "files-1", "tool": "workspace_file_action", "operation": "list_files", "outcome": "success"},
            {"event_id": "contract-1", "tool": "task_artifact_contract", "operation": "scope", "outcome": "success"},
            {"event_id": "shell-1", "tool": "officebench_action", "operation": "shell.command",
             "outcome": "semantic_error", "error_kind": "task_resource_boundary_violation"},
        ]),
        encoding="utf-8",
    )

    audit = _task_resource_boundary_assessment(root)

    assert audit["status"] == "enforced_rejected_attempts"
    assert audit["workspace_file_action_calls"] == 1
    assert audit["artifact_contract_reads"] == 1
    assert audit["shell_attempt_count"] == 1
    assert audit["rejected_external_resource_attempt_count"] == 1
    assert audit["rejected_observation_ids"] == ["shell-1"]


@pytest.mark.parametrize(
    "findings,decisions,effects,expected_status",
    [
        ([], [], [], "candidate_seen_no_finding"),
        (
            [{"finding_id": "finding-1", "evidence_refs": ["calendar-1"]}],
            [],
            [],
            "finding_recorded_no_decision",
        ),
        (
            [{"finding_id": "finding-1", "evidence_refs": ["calendar-1"]}],
            [{
                "decision_id": "decision-1", "toolCallId": "decision-call", "applied": False,
                "basis_resource_ids": ["finding-1"],
            }],
            [],
            "keep_recorded",
        ),
        (
            [{"finding_id": "finding-1", "evidence_refs": ["calendar-1"]}],
            [{
                "decision_id": "decision-1", "toolCallId": "decision-call", "applied": True,
                "basis_resource_ids": ["finding-1"],
            }],
            [{
                "decision_id": "decision-1", "toolCallId": "decision-call",
                "basis_resource_ids": ["finding-1"], "effect_observed": True,
            }],
            "apply_effect_observed",
        ),
    ],
)
def test_research_connection_reports_where_a_candidate_stopped(
    tmp_path, findings, decisions, effects, expected_status,
):
    root = tmp_path / expected_status
    root.mkdir()
    observations = [
        {
            "event_id": "calendar-1", "tool": "calendar_action", "category": "task_action",
            "outcome": "success", "decision_support": {
                "capability_id": "execution_tool_surface", "candidate_mode": "calendar_focused",
            },
        },
        {"event_id": "calendar-2", "tool": "calendar_action", "category": "task_action", "outcome": "success"},
    ]
    for filename, records in (
        ("execution-observations.jsonl", observations),
        ("research-resources.jsonl", findings),
        ("harness-decisions.jsonl", decisions),
        ("harness-observations.jsonl", effects),
    ):
        if records:
            (root / filename).write_text(
                "".join(json.dumps(record) + "\n" for record in records), encoding="utf-8",
            )

    report = _research_connection(root)

    assert report["status"] == expected_status
    assert report["candidate_observation_ids"] == ["calendar-1"]
    assert report["candidates_with_later_relevant_work"] == ["calendar-1"]


def test_research_connection_accepts_direct_execution_evidence_without_prefabricated_candidate(tmp_path):
    root = tmp_path / "direct-evidence"
    root.mkdir()
    records = {
        "execution-observations.jsonl": [
            {"event_id": "sheet-read", "tool": "officebench_action", "category": "task_action", "outcome": "success"},
        ],
        "research-resources.jsonl": [
            {"finding_id": "finding-1", "evidence_refs": ["sheet-read"]},
        ],
        "harness-decisions.jsonl": [{
            "decision_id": "decision-1", "toolCallId": "research-call", "applied": True,
            "basis_resource_ids": ["finding-1"],
        }],
        "harness-observations.jsonl": [{
            "decision_id": "decision-1", "toolCallId": "research-call",
            "basis_resource_ids": ["finding-1"], "effect_observed": True,
        }],
    }
    for filename, values in records.items():
        (root / filename).write_text(
            "".join(json.dumps(value) + "\n" for value in values), encoding="utf-8",
        )

    report = _research_connection(root)

    assert report["status"] == "apply_effect_observed"
    assert report["candidate_observation_ids"] == []
    assert report["evidence_linked_finding_ids"] == ["finding-1"]
    assert report["evidence_linked_decision_ids"] == ["decision-1"]
    assert report["connection_origin"] == "direct_execution_observation"


def test_final_agent_error_is_not_reported_as_success():
    events = (
        {"type": "agent_end", "messages": [{"role": "assistant", "content": [{"type": "text", "text": "earlier"}]}]},
        {"type": "agent_end", "messages": [{"role": "assistant", "stopReason": "error", "errorMessage": "timeout", "content": []}]},
    )
    assert _extract_agent_outcome(events) == ("", False, "timeout")


def test_e2e_uses_real_evaluator_result_and_emits_handoffs(monkeypatch, tmp_path: Path):
    project = tmp_path / "project"
    paths = ProjectPaths(project, tmp_path / "jit", tmp_path / "meta")
    root = project / "runs" / "e2e"
    workspace = root / "workspace" / "1-2" / "0"
    item = {
        "question_id": "1-2-0",
        "question": "calendar task",
        "answer": "",
        "_workspace": str(workspace),
    }
    adapter = SimpleNamespace(evaluate=lambda answer, ground_truth, **kwargs: {
        "score": 1.0,
        "is_pass": True,
        "output_testbed_dir": str(root / "output" / "testbed"),
    })
    monkeypatch.setattr(
        "autoresearch_pi.officebench_e2e._prepare_real_case",
        lambda _paths, _root, _case: (
            adapter, item,
            "task prompt with generic runner notes about Word, PDF, OCR and Excel tools",
        ),
    )

    def fake_pi(_root, _workspace, task, _paths):
        assert task == "task prompt with generic runner notes about Word, PDF, OCR and Excel tools"
        contract = json.loads((_root / "artifact-contract.json").read_text(encoding="utf-8"))
        catalog = json.loads((_root / "task-resource-catalog.json").read_text(encoding="utf-8"))
        assert contract["scope"]["task_workspace"] == "current_case_testbed_only"
        assert contract["actions"]["email.send_email"]["verify_with"] == [
            "email.list_emails", "email.read_email",
        ]
        assert catalog["canonical_contract"]["path"] == "artifact-contract.json"
        assert catalog["scope"] == "current_case_testbed_only"
        assert catalog["relevant_apps"] == ["calendar"]
        return PiOfficeBenchRun(
            "0.80.6",
            "a:deepseek-v4-flash",
            "done",
            True,
            "",
            (
                {"type": "turn_end"},
                {"type": "tool_execution_start", "toolName": "set_evidence_policy"},
                {"type": "tool_execution_start", "toolName": "officebench_action"},
            ),
            {"value": "summary_only"},
            {"value": "source_and_date"},
            {"value": "source_and_date"},
            {"value": "general"},
            {
                "value": "calendar_focused",
                "toolCallId": "surface-call",
                "activeTools": ["calendar_action"],
                "basis": "calendar API succeeded while shell probe failed",
                "operation": {
                    "capability": "pi.setActiveTools",
                    "previous": "general",
                    "value": "calendar_focused",
                },
            },
            {
                "value": "calendar_focused",
                "toolCallId": "surface-call",
                "observedBy": "context_hook_before_model_request",
                "activeTools": ["calendar_action"],
                "consequence": {
                    "status": "observed_by_next_model_request",
                    "activeTools": ["calendar_action"],
                },
            },
        )

    result = run_officebench_e2e(root, paths=paths, pi_runner=fake_pi)
    summary = json.loads(result.summary.read_text(encoding="utf-8"))
    assert result.passed and result.score == 1.0
    assert summary["pipeline"] == "pi-native-officebench-e2e"
    assert summary["task_resource_boundary"]["status"] == "enforced_no_violation"
    assert summary["artifact_contract"]["initial_disclosure"] == "task-resource-catalog.json"
    assert summary["artifact_contract"]["on_demand_resource"] is None
    assert summary["closed_loop_evidence"]["available_resources"]["task_resource_catalog"]["format"] == (
        "officebench-task-resource-catalog-v1"
    )
    assert summary["closed_loop_evidence"]["available_resources"]["canonical_artifact_contract"]["format"] == (
        "officebench-task-artifact-contract-v1"
    )
    assert summary["closed_loop_evidence"]["canonical_sources"]["artifact_contract"] == (
        "artifact-contract.json"
    )
    assert summary["tool_sequence"] == ["set_evidence_policy", "officebench_action"]
    assert summary["execution_efficiency"]["catalog_initial_disclosures"] == 1
    assert result.auto_research_handoff.is_file()
    assert result.self_harness_handoff.is_file()
    harness_handoff = result.self_harness_handoff.read_text(encoding="utf-8")
    assert "Pi-native behavior capability: `pi.setActiveTools`" in harness_handoff
    assert "calendar API succeeded while shell probe failed" in harness_handoff
    assert "Later model request observed tool change: `True`" in harness_handoff
    assert result.round_hierarchy.is_file()


def test_batch_runs_first_n_cases_independently_and_aggregates(tmp_path: Path):
    project = tmp_path / "project"
    dataset = tmp_path / "jit" / "dataset" / "officebench" / "data.jsonl"
    dataset.parent.mkdir(parents=True)
    dataset.write_text(
        "".join(json.dumps({"question_id": case_id}) + "\n" for case_id in ("c-1", "c-2", "c-3")),
        encoding="utf-8",
    )
    paths = ProjectPaths(project, tmp_path / "jit", tmp_path / "meta")
    calls = []

    def fake_case_runner(root, *, case_id, paths):
        del paths
        calls.append((root, case_id))
        root.mkdir(parents=True)
        passed = case_id == "c-1"
        summary = root / "summary.json"
        summary.write_text(json.dumps({
            "status": "passed" if passed else "failed",
            "pi_agent_succeeded": True,
            "evaluator_passed": passed,
        }), encoding="utf-8")
        return SimpleNamespace(summary=summary, score=1.0 if passed else 0.25, passed=passed)

    result = run_officebench_e2e_batch(
        project / "runs" / "batch",
        max_samples=2,
        paths=paths,
        case_runner=fake_case_runner,
    )
    aggregate = json.loads(result.summary.read_text(encoding="utf-8"))

    assert [case_id for _, case_id in calls] == ["c-1", "c-2"]
    assert calls[0][0] != calls[1][0]
    assert result.total_cases == 2
    assert result.passed_cases == 1
    assert result.failed_cases == 1
    assert aggregate["average_score"] == 0.625
    assert aggregate["cases"][0]["summary"].endswith("c-1\\summary.json")


def test_batch_continues_after_case_runner_error(tmp_path: Path):
    project = tmp_path / "project"
    dataset = tmp_path / "jit" / "dataset" / "officebench" / "data.jsonl"
    dataset.parent.mkdir(parents=True)
    dataset.write_text('{"question_id":"bad"}\n{"question_id":"good"}\n', encoding="utf-8")
    paths = ProjectPaths(project, tmp_path / "jit", tmp_path / "meta")
    seen = []

    def fake_case_runner(root, *, case_id, paths):
        del paths
        seen.append(case_id)
        if case_id == "bad":
            raise TimeoutError("model timeout")
        root.mkdir(parents=True)
        summary = root / "summary.json"
        summary.write_text('{"status":"passed"}', encoding="utf-8")
        return SimpleNamespace(summary=summary, score=1.0, passed=True)

    result = run_officebench_e2e_batch(
        project / "runs" / "batch",
        max_samples=2,
        paths=paths,
        case_runner=fake_case_runner,
    )

    assert seen == ["bad", "good"]
    assert result.passed_cases == 1 and result.failed_cases == 1
    error = json.loads((project / "runs" / "batch" / "bad" / "runner-error.json").read_text(encoding="utf-8"))
    assert error["error_type"] == "TimeoutError"


@pytest.mark.parametrize("after,observed", [({}, {}), ({"value": "source_and_date"}, {})])
def test_task_pass_does_not_require_mutation_or_observation(monkeypatch, tmp_path, after, observed):
    paths = ProjectPaths(tmp_path / "project", tmp_path / "jit", tmp_path / "meta")
    root = paths.root / "runs" / "optional"
    item = {"question_id": "test", "question": "task", "_workspace": str(root / "workspace")}
    adapter = SimpleNamespace(evaluate=lambda *args, **kwargs: {"score": 1, "is_pass": True})
    monkeypatch.setattr("autoresearch_pi.officebench_e2e._prepare_real_case", lambda *args: (adapter, item, "task"))
    native = PiOfficeBenchRun("test", "fixture", "done", True, "", (), {"value": "summary_only"}, after, observed)
    result = run_officebench_e2e(root, paths=paths, pi_runner=lambda *args: native)
    summary = json.loads(result.summary.read_text(encoding="utf-8"))
    assert result.passed
    assert summary["harness_improvement"] == "not_established"
    assert summary["research_notes"]["status"] == "not_recorded"
    assert summary["pi_native_mutation"]["context_hook_observed"] is False
    assert "No agent-authored research notes" in result.auto_research_handoff.read_text(encoding="utf-8")


def test_existing_run_is_not_overwritten(tmp_path):
    paths = ProjectPaths(tmp_path / "project", tmp_path / "jit", tmp_path / "meta")
    root = paths.root / "runs" / "old"
    root.mkdir(parents=True)
    trace = root / "pi-events.jsonl"
    trace.write_text("old evidence", encoding="utf-8")
    with pytest.raises(ValueError, match="empty"):
        run_officebench_e2e(root, paths=paths)
    assert trace.read_text(encoding="utf-8") == "old evidence"


@pytest.mark.parametrize("stop_reason", ["aborted", "length", "toolUse"])
def test_incomplete_final_message_is_not_success(stop_reason):
    assert _extract_agent_outcome([{"type": "agent_end", "messages": [{
        "role": "assistant", "content": "partial answer", "stopReason": stop_reason,
    }]}])[1] is False


@pytest.mark.parametrize("interrupt", [False, True])
def test_real_runner_persists_trace_and_status_without_requiring_snapshots(monkeypatch, tmp_path, interrupt):
    script = tmp_path / "rpc_fixture.py"
    script.write_text("""import sys,json,time
if '--version' in sys.argv:
 print('fixture'); sys.exit(0)
p=json.loads(sys.stdin.readline())
print(json.dumps({'id':p['id'],'type':'response','success':True}), flush=True)
print(json.dumps({'type':'message_update','assistantMessageEvent':{
 'type':'text_delta','contentIndex':0,'delta':'piece','partial':{'content':['cumulative text']}
},'message':{'role':'assistant','content':['cumulative text']}}), flush=True)
print(json.dumps({'type':'tool_execution_end','toolName':'probe'}), flush=True)
""" + ("time.sleep(10)\n" if interrupt else """print(json.dumps({'type':'agent_end','messages':[{'role':'assistant','content':'done','stopReason':'stop'}]}), flush=True)
print(json.dumps({'type':'agent_settled'}), flush=True)
time.sleep(10)
"""), encoding="utf-8")
    monkeypatch.setattr("autoresearch_pi.officebench_e2e._resolve_pi_cli", lambda: (sys.executable, str(script)))
    monkeypatch.setattr("autoresearch_pi.officebench_e2e._load_dotenv", lambda path: {
        "OPENAI_API_BASE": "http://unused.invalid", "OPENAI_API_KEY": "offline-fixture", "EXEC_MODEL": "fixture",
    })
    paths = ProjectPaths(tmp_path / "project", tmp_path / "jit", tmp_path / "meta")
    root = paths.root / "runs" / "task"
    root.mkdir(parents=True)
    if interrupt:
        with pytest.raises(TimeoutError):
            run_pi_officebench_task(root, root, "test", paths, timeout=0.5)
    else:
        result = run_pi_officebench_task(root, root, "test", paths, timeout=2)
        assert result.agent_succeeded
        assert (result.before, result.after, result.observed) == ({}, {}, {})
    status = json.loads((root / "pi-runtime-status.json").read_text(encoding="utf-8"))
    assert status["trace_complete"] is not interrupt
    assert status["status"] == ("interrupted" if interrupt else "settled")
    assert status["trace_format"] == "compact-jsonl-v1"
    assert status["message_updates"] == "delta_without_cumulative_snapshots"
    events = [json.loads(line) for line in (root / "pi-events.jsonl").read_text(encoding="utf-8").splitlines()]
    update = next(event for event in events if event["type"] == "message_update")
    assert update == {
        "type": "message_update",
        "assistantMessageEvent": {"type": "text_delta", "contentIndex": 0, "delta": "piece"},
    }
    assert next(event for event in events if event.get("toolName") == "probe")["toolName"] == "probe"


def test_mutation_observation_requires_matching_call_and_hook():
    from dataclasses import replace
    native = PiOfficeBenchRun("fixture", "fixture", "done", True, "", (
        {"type": "tool_execution_end", "toolName": "set_evidence_policy", "result": {"details": {"changed": True}}},
        {"type": "tool_execution_end", "toolName": "set_evidence_policy", "result": {"details": {"changed": False}}},
        {"type": "tool_execution_end", "toolName": "set_evidence_policy", "isError": True},
    ), {"value": "summary_only"}, {"value": "source_and_date", "toolCallId": "second"}, {
        "value": "source_and_date", "toolCallId": "first", "observedBy": "context_hook_before_model_request",
    })
    assert _mutation_evidence(native)["context_hook_observed"] is False
    report = _mutation_evidence(replace(native, observed={**native.observed, "toolCallId": "second"}))
    assert report["context_hook_observed"] is True
    assert report["actual_changes"] == 1 and report["successful_operations"] == 2


def test_execution_surface_observation_requires_matching_surface_call():
    from dataclasses import replace

    native = PiOfficeBenchRun(
        "fixture",
        "fixture",
        "done",
        True,
        "",
        ({
            "type": "tool_execution_end",
            "toolName": "set_execution_surface",
            "toolCallId": "surface-call",
            "result": {"details": {"changed": True}},
        },),
        {},
        {},
        {},
        {"value": "general"},
        {
            "value": "calendar_focused",
            "toolCallId": "surface-call",
            "activeTools": ["calendar_action"],
        },
        {
            "value": "calendar_focused",
            "toolCallId": "evidence-call",
            "observedBy": "context_hook_before_model_request",
            "activeTools": ["calendar_action"],
        },
    )

    report = _mutation_evidence(native)["execution_surface"]
    assert report["actual_changes"] == 1
    assert report["observed_next_request"] is False

    matched = replace(native, surface_observed={**native.surface_observed, "toolCallId": "surface-call"})
    assert _mutation_evidence(matched)["execution_surface"]["observed_next_request"] is True


def test_notes_are_reported_as_claims_and_agent_failure_stays_separate(monkeypatch, tmp_path):
    paths = ProjectPaths(tmp_path / "project", tmp_path / "jit", tmp_path / "meta")
    root = paths.root / "runs" / "notes"
    item = {"question_id": "test", "question": "task", "_workspace": str(root)}
    adapter = SimpleNamespace(evaluate=lambda *args, **kwargs: {"score": 1, "is_pass": True})
    monkeypatch.setattr("autoresearch_pi.officebench_e2e._prepare_real_case", lambda *args: (adapter, item, "task"))
    def fake_pi(*args):
        (root / "task-notes.md").write_text("Uncertainty remains; adjustment was not tested.", encoding="utf-8")
        return PiOfficeBenchRun("fixture", "fixture", "", False, "interrupted", (), {}, {}, {})
    result = run_officebench_e2e(root, paths=paths, pi_runner=fake_pi)
    summary = json.loads(result.summary.read_text(encoding="utf-8"))
    assert not result.passed and summary["evaluator_passed"]
    assert summary["research_notes"]["status"] == "agent_authored_unverified"
    assert summary["harness_improvement"] == "not_established"
    handoff = result.auto_research_handoff.read_text(encoding="utf-8")
    assert "claims, not verified conclusions" in handoff
    assert "task-notes.md" in handoff and "source is not duplicated here" in handoff


def test_summary_keeps_execution_evaluation_correctness_and_harness_outcomes_separate(monkeypatch, tmp_path):
    paths = ProjectPaths(tmp_path / "project", tmp_path / "jit", tmp_path / "meta")
    root = paths.root / "runs" / "separate-outcomes"
    item = {"question_id": "1-2-4", "question": "calendar conclusion", "_workspace": str(root)}
    adapter = SimpleNamespace(evaluate=lambda *args, **kwargs: {"score": 1, "is_pass": True})
    monkeypatch.setattr("autoresearch_pi.officebench_e2e._prepare_real_case", lambda *args: (adapter, item, "task"))
    native = PiOfficeBenchRun("fixture", "fixture", "Tom", True, "", (), {}, {}, {})

    result = run_officebench_e2e(root, paths=paths, pi_runner=lambda *args: native)
    outcomes = json.loads(result.summary.read_text(encoding="utf-8"))["outcomes"]

    assert outcomes["task_execution"] == {"status": "succeeded", "agent_error": None}
    assert outcomes["evaluator"] == {"score": 1.0, "passed": True}
    assert outcomes["task_correctness"]["status"] == "not_independently_verified"
    assert outcomes["task_correctness"]["evaluator_is_only_a_signal"] is True
    assert outcomes["execution_condition_effect"]["status"] == "not_attempted"
    assert outcomes["harness_adjustment"]["status"] == "not_changed"
    assert outcomes["harness_improvement"]["status"] == "not_established"


def test_change_aware_correctness_exposes_legacy_pass_with_unchanged_target(monkeypatch, tmp_path):
    paths = ProjectPaths(tmp_path / "project", tmp_path / "jit", tmp_path / "meta")
    root = paths.root / "runs" / "unchanged-target"
    workspace = root / "workspace" / "1-2" / "4"
    testbed = workspace / "testbed"
    item = {
        "question_id": "1-2-4",
        "question": "who has more commitments?",
        "_workspace": str(workspace),
        "_testbed_dir": str(testbed),
        "evaluation": [{
            "function": "evaluate_contain",
            "args": {"doc_type": "ics", "file": "./data/answer.txt", "keywords": ["Tom"]},
        }],
    }
    adapter = SimpleNamespace(evaluate=lambda *args, **kwargs: {"score": 1, "is_pass": True})

    def prepare(*args):
        testbed.joinpath("data").mkdir(parents=True)
        testbed.joinpath("data", "answer.txt").write_text("Tom", encoding="utf-8")
        return adapter, item, "task"

    monkeypatch.setattr("autoresearch_pi.officebench_e2e._prepare_real_case", prepare)
    native = PiOfficeBenchRun("fixture", "fixture", "Tom", True, "", (), {}, {}, {})

    result = run_officebench_e2e(root, paths=paths, pi_runner=lambda *args: native)
    summary = json.loads(result.summary.read_text(encoding="utf-8"))
    correctness = summary["outcomes"]["task_correctness"]

    assert summary["evaluator_passed"] is True
    assert correctness["status"] == "not_independently_verified"
    assert correctness["required_paths"] == ["data/answer.txt"]
    assert correctness["changed_required_paths"] == []
    assert correctness["all_required_paths_changed"] is False
    assert correctness["artifact_change_status"] == "required_paths_unchanged"
    assert (root / "evaluator-targets-before.json").is_file()
    assert (root / "evaluator-targets-after.json").is_file()


def test_change_aware_correctness_detects_created_evaluator_target(monkeypatch, tmp_path):
    paths = ProjectPaths(tmp_path / "project", tmp_path / "jit", tmp_path / "meta")
    root = paths.root / "runs" / "created-target"
    workspace = root / "workspace"
    testbed = workspace / "testbed"
    item = {
        "question_id": "fixture",
        "question": "create result",
        "_workspace": str(workspace),
        "_testbed_dir": str(testbed),
        "evaluation": [{"function": "evaluate_file_exist", "args": {"file": "./data/result.txt"}}],
    }
    adapter = SimpleNamespace(evaluate=lambda *args, **kwargs: {"score": 1, "is_pass": True})

    def prepare(*args):
        testbed.joinpath("data").mkdir(parents=True)
        return adapter, item, "task"

    def fake_pi(*args):
        testbed.joinpath("data", "result.txt").write_text("created", encoding="utf-8")
        return PiOfficeBenchRun("fixture", "fixture", "done", True, "", (), {}, {}, {})

    monkeypatch.setattr("autoresearch_pi.officebench_e2e._prepare_real_case", prepare)
    result = run_officebench_e2e(root, paths=paths, pi_runner=fake_pi)
    correctness = json.loads(result.summary.read_text(encoding="utf-8"))["outcomes"]["task_correctness"]

    assert correctness["changed_required_paths"] == ["data/result.txt"]
    assert correctness["all_required_paths_changed"] is True
    assert correctness["artifact_change_status"] == "all_required_paths_changed"


@pytest.mark.parametrize(
    "resources,decisions,observations,expected_status",
    [
        ([], [], [], "not_attempted"),
        (
            [{"finding_id": "finding-1", "evidence_refs": ["tool-1"]}],
            [{
                "decision_id": "decision-1",
                "capability_id": "execution_tool_surface",
                "toolCallId": "surface-call",
                "basis_resource_ids": ["missing-finding"],
            }],
            [],
            "invalid_basis",
        ),
        (
            [{"finding_id": "finding-1", "evidence_refs": ["tool-1"]}],
            [{
                "decision_id": "decision-1",
                "capability_id": "execution_tool_surface",
                "toolCallId": "surface-call",
                "basis_resource_ids": ["finding-1"],
            }],
            [],
            "applied_unobserved",
        ),
        (
            [{"finding_id": "finding-1", "evidence_refs": ["tool-1"]}],
            [{
                "decision_id": "decision-1",
                "capability_id": "execution_tool_surface",
                "toolCallId": "surface-call",
                "basis_resource_ids": ["finding-1"],
            }],
            [{
                "observation_id": "harness-observation-1",
                "decision_id": "decision-1",
                "toolCallId": "surface-call",
                "basis_resource_ids": ["finding-1"],
                "effect_observed": True,
                "operation": {"capability": "pi.setActiveTools"},
            }],
            "linked_effect_observed",
        ),
    ],
)
def test_loop_integrity_is_separate_from_improvement(
    monkeypatch, tmp_path, resources, decisions, observations, expected_status,
):
    paths = ProjectPaths(tmp_path / "project", tmp_path / "jit", tmp_path / "meta")
    root = paths.root / "runs" / expected_status
    item = {"question_id": "fixture", "question": "task", "_workspace": str(root / "workspace")}
    adapter = SimpleNamespace(evaluate=lambda *args, **kwargs: {"score": 1, "is_pass": True})
    monkeypatch.setattr("autoresearch_pi.officebench_e2e._prepare_real_case", lambda *args: (adapter, item, "task"))

    def fake_pi(*args):
        if resources:
            (root / "execution-observations.jsonl").write_text(
                json.dumps({"event_id": "tool-1", "tool": "calendar_action"}) + "\n",
                encoding="utf-8",
            )
        for filename, records in (
            ("research-resources.jsonl", resources),
            ("harness-decisions.jsonl", decisions),
            ("harness-observations.jsonl", observations),
        ):
            if records:
                (root / filename).write_text(
                    "".join(json.dumps(record) + "\n" for record in records), encoding="utf-8",
                )
        return PiOfficeBenchRun("fixture", "fixture", "done", True, "", (), {}, {}, {})

    result = run_officebench_e2e(root, paths=paths, pi_runner=fake_pi)
    outcomes = json.loads(result.summary.read_text(encoding="utf-8"))["outcomes"]

    assert outcomes["loop_integrity"]["status"] == expected_status
    assert outcomes["harness_improvement"]["status"] == "not_established"


@pytest.mark.parametrize(
    "assessment_patch,expected_status",
    [
        ({}, "supported"),
        ({"decision_id": "missing-decision"}, "invalid_link"),
        ({"toolCallId": "different-call"}, "invalid_link"),
        ({"basis_resource_ids": ["different-finding"]}, "invalid_link"),
        ({"window": {
            "horizon": 2, "completion_reason": "horizon_reached",
            "relevant_calls": 2, "focused_tool_calls": 1, "semantic_errors": 0,
            "observation_ids": ["post-1", "post-2"],
        }}, "invalid_link"),
    ],
)
def test_execution_condition_effect_requires_a_valid_decision_link(tmp_path, assessment_patch, expected_status):
    root = tmp_path / "effect"
    root.mkdir()
    decision = {
        "decision_id": "decision-1",
        "capability_id": "execution_tool_surface",
        "toolCallId": "surface-call",
        "choice": "apply",
        "applied": True,
        "basis_resource_ids": ["finding-1"],
        "value": "calendar_focused",
        "expected_effect": "use focused calendar actions",
        "effect_metric": "focused_tool_use_rate",
        "observation_horizon": 2,
    }
    assessment = {
        "effect_assessment_id": "effect-assessment-1",
        "decision_id": "decision-1",
        "toolCallId": "surface-call",
        "basis_resource_ids": ["finding-1"],
        "effect_metric": "focused_tool_use_rate",
        "expected_effect": "use focused calendar actions",
        "exposure_observed": True,
        "baseline": {"evidence_calls": 1, "semantic_errors": 1},
        "window": {
            "horizon": 2, "completion_reason": "horizon_reached",
            "relevant_calls": 2, "focused_tool_calls": 2, "semantic_errors": 0,
            "observation_ids": ["post-1", "post-2"],
        },
        "verdict": "supported",
        "improvement": "not_established",
        **assessment_patch,
    }
    observations = [
        {"event_id": "before-1", "tool": "officebench_action", "category": "task_action", "outcome": "semantic_error"},
        {"event_id": "post-1", "tool": "calendar_action", "category": "task_action", "outcome": "success"},
        {"event_id": "post-2", "tool": "calendar_action", "category": "task_action", "outcome": "success"},
    ]
    finding = {"finding_id": "finding-1", "evidence_refs": ["before-1"]}
    exposure = {
        "decision_id": "decision-1", "toolCallId": "surface-call",
        "basis_resource_ids": ["finding-1"], "effect_observed": True,
        "operation": {"capability": "pi.setActiveTools"},
    }
    (root / "execution-observations.jsonl").write_text(
        "".join(json.dumps(record) + "\n" for record in observations), encoding="utf-8",
    )
    (root / "research-resources.jsonl").write_text(json.dumps(finding) + "\n", encoding="utf-8")
    (root / "harness-decisions.jsonl").write_text(json.dumps(decision) + "\n", encoding="utf-8")
    (root / "harness-observations.jsonl").write_text(json.dumps(exposure) + "\n", encoding="utf-8")
    (root / "effect-assessments.jsonl").write_text(json.dumps(assessment) + "\n", encoding="utf-8")

    report = _execution_condition_effect(root)

    assert report["status"] == expected_status
    assert report["harness_improvement"] == "not_established"


def test_execution_condition_effect_independently_validates_calendar_batch_utilization(tmp_path):
    root = tmp_path / "batch-effect"
    root.mkdir()
    records = {
        "execution-observations.jsonl": [
            {"event_id": "probe-1", "tool": "calendar_action", "category": "task_action", "outcome": "success"},
            {"event_id": "batch-1", "tool": "calendar_batch_action", "category": "task_action", "outcome": "success",
             "attempted_work_units": 3, "completed_work_units": 3},
            {"event_id": "verify-1", "tool": "calendar_action", "category": "task_action", "outcome": "success"},
        ],
        "research-resources.jsonl": [{"finding_id": "finding-1", "evidence_refs": ["probe-1"]}],
        "harness-decisions.jsonl": [{
            "decision_id": "decision-1", "capability_id": "execution_tool_surface", "toolCallId": "surface-call",
            "choice": "apply", "applied": True, "basis_resource_ids": ["finding-1"], "value": "calendar_batch",
            "expected_effect": "complete three writes through one Pi call", "effect_metric": "calendar_batch_utilization",
            "observation_horizon": 2,
        }],
        "harness-observations.jsonl": [{
            "decision_id": "decision-1", "toolCallId": "surface-call", "basis_resource_ids": ["finding-1"],
            "effect_observed": True, "operation": {"capability": "pi.setActiveTools"},
        }],
        "effect-assessments.jsonl": [{
            "effect_assessment_id": "effect-assessment-1", "decision_id": "decision-1", "toolCallId": "surface-call",
            "basis_resource_ids": ["finding-1"], "effect_metric": "calendar_batch_utilization",
            "expected_effect": "complete three writes through one Pi call", "exposure_observed": True,
            "baseline": {"evidence_calls": 1, "semantic_errors": 0},
            "window": {"horizon": 2, "completion_reason": "horizon_reached", "relevant_calls": 2,
                       "semantic_errors": 0, "focused_tool_calls": 0, "batch_tool_calls": 1,
                       "attempted_work_units": 3, "completed_work_units": 3, "tool_call_compression": 3,
                       "observation_ids": ["batch-1", "verify-1"]},
            "verdict": "supported", "improvement": "not_established",
        }],
    }
    for filename, values in records.items():
        (root / filename).write_text("".join(json.dumps(value) + "\n" for value in values), encoding="utf-8")

    assert _execution_condition_effect(root)["status"] == "supported"

    assessment_path = root / "effect-assessments.jsonl"
    assessment = records["effect-assessments.jsonl"][0]
    assessment["window"]["completed_work_units"] = 2
    assessment_path.write_text(json.dumps(assessment) + "\n", encoding="utf-8")
    assert _execution_condition_effect(root)["status"] == "invalid_link"


def test_closed_loop_evidence_is_a_compact_self_contained_projection(tmp_path):
    root = tmp_path / "auditable-summary"
    root.mkdir()
    records = {
        "execution-observations.jsonl": [{
            "event_id": "probe-1", "tool": "calendar_action", "operation": "list_events",
            "category": "task_action", "outcome": "success", "result_summary": "No events for Alice.",
        }],
        "research-resources.jsonl": [{
            "goal_id": "research-goal-1", "finding_id": "finding-1",
            "question": "Can repeated writes use batch?", "uncertainty": "Batch is unobserved.",
            "evidence": "A direct probe succeeded.", "decision": "Enable batch.",
            "evidence_refs": ["probe-1"], "expected_recurrence": "high", "remaining_uses": 12,
            "status": "active",
        }],
        "harness-decisions.jsonl": [{
            "decision_id": "decision-1", "toolCallId": "decision-call",
            "decision_path": "research_resource.continue_with", "choice": "apply", "applied": True,
            "basis_resource_ids": ["finding-1"], "previous": "general", "value": "calendar_batch",
            "expected_effect": "one call completes twelve writes", "effect_metric": "calendar_batch_utilization",
            "observation_horizon": 2, "reconsider_when": "batch fails",
        }],
        "harness-observations.jsonl": [{
            "observation_id": "harness-observation-1", "decision_id": "decision-1",
            "toolCallId": "decision-call", "basis_resource_ids": ["finding-1"], "effect_observed": True,
            "operation": {"capability": "pi.setActiveTools", "previous": "general", "value": "calendar_batch"},
            "consequence": {"status": "observed_by_next_model_request", "activeTools": ["calendar_batch_action"]},
        }],
        "effect-assessments.jsonl": [{
            "effect_assessment_id": "effect-assessment-1", "decision_id": "decision-1",
            "verdict": "supported", "effect_metric": "calendar_batch_utilization",
            "window": {"batch_tool_calls": 1, "attempted_work_units": 12,
                       "completed_work_units": 12, "tool_call_compression": 12},
            "improvement": "not_established",
        }],
    }
    for filename, values in records.items():
        (root / filename).write_text(
            "".join(json.dumps(value) + "\n" for value in values), encoding="utf-8",
        )
    (root / "capability-catalog.json").write_text(json.dumps({
        "scope": "one_pi_agent_process", "effect_timing": "next_model_request",
        "initial_surface": "general", "active_tools": ["calendar_action"],
        "available_inactive": [{"tool": "calendar_batch_action", "enabled_by": "pi.setActiveTools"}],
    }), encoding="utf-8")
    (root / "artifact-contract.json").write_text(json.dumps(
        _officebench_artifact_contract(),
    ), encoding="utf-8")
    (root / "task-resource-catalog.json").write_text(json.dumps({
        "format": "officebench-task-resource-catalog-v1",
        "scope": "current_case_testbed_only",
        "inventory": {"root": ".", "entries": [], "truncated": False},
        "relevant_apps": ["calendar"],
        "action_contracts": {
            "calendar.create_event": _officebench_artifact_contract()["actions"]["calendar.create_event"],
        },
        "task_language_conventions": {},
        "canonical_contract": {
            "path": "artifact-contract.json", "format": "officebench-task-artifact-contract-v1",
        },
    }), encoding="utf-8")
    native = PiOfficeBenchRun(
        "0.80.6", "model", "done", True, "", (), {}, {}, {},
        {"value": "general", "activeTools": ["calendar_action"]},
        {"value": "calendar_batch", "activeTools": ["calendar_action", "calendar_batch_action"]},
        {"value": "calendar_batch", "activeTools": ["calendar_action", "calendar_batch_action"]},
    )

    report = _closed_loop_evidence(
        root, native,
        {"status": "apply_effect_observed", "connection_origin": "decision_support"},
        {"status": "linked_effect_observed"},
        {"status": "supported"},
    )

    assert report["status"] == "behavioral_loop_established"
    assert report["research"]["lifecycle"]["status"] == "effect_pending_absorption"
    assert report["research"]["goal_coverage"] == "agent_declared_structured_goals"
    assert report["research"]["goals"][0]["goal_id"] == "research-goal-1"
    assert report["research"]["goals"][0]["evidence_observations"][0]["summary"] == "No events for Alice."
    assert report["available_resources"]["available_inactive"][0]["tool"] == "calendar_batch_action"
    task_catalog = report["available_resources"]["task_resource_catalog"]
    assert "calendar.create_event" in task_catalog["action_contracts"]
    assert task_catalog["source_ref"] == "task-resource-catalog.json"
    contract_projection = report["available_resources"]["canonical_artifact_contract"]
    assert contract_projection["source_ref"] == "artifact-contract.json"
    assert contract_projection["initial_model_surface"] is False
    change = report["self_harness_changes"][0]
    assert change["basis_goal_ids"] == ["research-goal-1"]
    assert change["pi_native_operation"]["capability"] == "pi.setActiveTools"
    assert change["before"]["surface"] == "general"
    assert change["after"]["surface"] == "calendar_batch"
    assert change["observed_by_next_request"] is True
    assert change["effect"]["window"]["completed_work_units"] == 12
    assert report["chains"][0]["record_ids"] == [
        "research-goal-1", "finding-1", "decision-1", "harness-observation-1", "effect-assessment-1",
    ]
    assert report["chains"][0]["status"] == "effect_observed_pending_research_update"
    assert report["canonical_sources"]["execution_observations"] == "execution-observations.jsonl"
