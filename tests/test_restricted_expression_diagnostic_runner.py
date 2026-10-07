import json
import time
from pathlib import Path

import pytest

from tools.restricted_expression_diagnostic import (
    BOOTSTRAP,
    DiagnosticConfig,
    DiagnosticReadiness,
    DiagnosticReadinessBlocked,
    build_pi_command,
    build_provider_prompt,
    diagnostic_cli_summary,
    prepare_diagnostic_resources,
    run_diagnostic,
    _diagnostic_cli_parser,
    _prepare_run_local_provider_registry,
)


PROJECT = Path(__file__).resolve().parents[1]
FIXTURES = PROJECT / "tests" / "fixtures" / "restricted_expression_diagnostic"


class EventStreamKernel:
    instances = []

    def __init__(self, *_args, event_sink=None, event_projector=None, **_kwargs):
        self.event_sink = event_sink
        self.event_projector = event_projector
        self.aborted = False
        self.events = []
        type(self).instances.append(self)

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def prompt(self, _prompt):
        return {"type": "response", "command": "prompt"}

    def wait_for_agent_events(self, **_kwargs):
        projected = []
        for event in self.events:
            if self.event_sink:
                self.event_sink(event)
            value = self.event_projector(event) if self.event_projector else event
            if value is not None:
                projected.append(value)
            time.sleep(0.03)
            if self.aborted:
                break
        return projected

    def abort(self):
        self.aborted = True


class ContinuationKernel(EventStreamKernel):
    batches = []

    def __init__(self, *args, event_projector=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.event_projector = event_projector
        self.prompts = []
        self.pending_batches = [list(batch) for batch in type(self).batches]

    def prompt(self, prompt):
        self.prompts.append(prompt)
        return {"type": "response", "command": "prompt", "success": True}

    def wait_for_agent_events(self, **_kwargs):
        raw_batch = self.pending_batches.pop(0)
        projected = []
        for event in raw_batch:
            if self.event_sink:
                self.event_sink(event)
            value = self.event_projector(event) if self.event_projector else event
            if value is not None:
                projected.append(value)
        return projected


def test_provider_phase_is_blocked_before_pi_kernel_when_readiness_is_incomplete(tmp_path, monkeypatch):
    def fail_if_started(*_args, **_kwargs):
        raise AssertionError("Pi must not start before readiness is green")

    monkeypatch.setattr("tools.restricted_expression_diagnostic.PiKernel", fail_if_started)
    config = DiagnosticConfig(root=tmp_path, provider="unused", model="unused")
    with pytest.raises(DiagnosticReadinessBlocked, match="provider phase blocked"):
        run_diagnostic(config, DiagnosticReadiness())


def test_readiness_marks_unimplemented_execution_and_repair_limits_as_blocking():
    readiness = DiagnosticReadiness(
        pure_expression_conformance=True,
        native_task_tool_integration=True,
        resource_binding_provenance=True,
    )

    assert readiness.ready is False
    assert "total-turn/output-token/wall-deadline controls are not enforced" in readiness.blocking_reasons
    assert "repair/replacement-version controls are not enforced" in readiness.blocking_reasons


def _green_readiness():
    return DiagnosticReadiness(
        pure_expression_conformance=True,
        native_task_tool_integration=True,
        resource_binding_provenance=True,
        execution_limits_enforced=True,
        repair_and_version_limits_enforced=True,
    )


def test_event_stream_aborts_after_turn_limit_and_reports_output_usage(tmp_path, monkeypatch):
    EventStreamKernel.instances.clear()
    monkeypatch.setattr("tools.restricted_expression_diagnostic.PiKernel", EventStreamKernel)
    config = DiagnosticConfig(root=tmp_path, provider="deterministic", model="scripted", max_turns=1)
    kernel = EventStreamKernel.instances
    # The fake receives the stream through a class-level setup hook below.
    original_init = EventStreamKernel.__init__

    def init_with_events(self, *args, **kwargs):
        original_init(self, *args, **kwargs)
        self.events = [
            {"type": "message_end", "message": {"role": "assistant", "usage": {"output": 4}}},
            {"type": "message_end", "message": {"role": "assistant", "usage": {"output": 4}}},
        ]

    monkeypatch.setattr(EventStreamKernel, "__init__", init_with_events)
    report = run_diagnostic(config, _green_readiness())

    assert report["aborted"] is True
    assert report["budget"]["stop_reason"] == "max_turns_exceeded"
    assert report["budget"]["turns"] == 1
    assert report["budget"]["output_tokens"] == 4
    assert EventStreamKernel.instances[0].aborted is True


def test_event_stream_aborts_after_output_token_limit(tmp_path, monkeypatch):
    EventStreamKernel.instances.clear()
    monkeypatch.setattr("tools.restricted_expression_diagnostic.PiKernel", EventStreamKernel)
    original_init = EventStreamKernel.__init__

    def init_with_events(self, *args, **kwargs):
        original_init(self, *args, **kwargs)
        self.events = [{"type": "message_end", "message": {"role": "assistant", "usage": {"output": 11}}}]

    monkeypatch.setattr(EventStreamKernel, "__init__", init_with_events)
    config = DiagnosticConfig(root=tmp_path, provider="deterministic", model="scripted", max_output_tokens=10)
    report = run_diagnostic(config, _green_readiness())

    assert report["budget"]["stop_reason"] == "max_output_tokens_exceeded"
    assert report["budget"]["output_tokens"] == 11
    assert EventStreamKernel.instances[0].aborted is True


def test_length_stop_continues_in_same_pi_session_with_only_generic_instruction(tmp_path, monkeypatch):
    EventStreamKernel.instances.clear()
    ContinuationKernel.batches = [
        [
            {"type": "message_end", "message": {"role": "assistant", "stopReason": "length",
                                                   "usage": {"output": 3}, "content": "partial private work"}},
            {"type": "agent_end", "messages": []},
            {"type": "agent_settled"},
        ],
        [
            {"type": "message_end", "message": {"role": "assistant", "stopReason": "stop",
                                                   "usage": {"output": 2}, "content": "done"}},
            {"type": "agent_end", "messages": []},
            {"type": "agent_settled"},
        ],
    ]
    monkeypatch.setattr("tools.restricted_expression_diagnostic.PiKernel", ContinuationKernel)
    config = DiagnosticConfig(root=tmp_path, provider="deterministic", model="scripted",
                              max_turns=3, max_output_tokens=10)

    report = run_diagnostic(config, _green_readiness(), prompt="original diagnostic contract")

    kernel = EventStreamKernel.instances[0]
    assert kernel.prompts[0] == "original diagnostic contract"
    assert len(kernel.prompts) == 2
    continuation = kernel.prompts[1]
    assert "same Pi session" in continuation
    assert "unfinished diagnostic" in continuation
    assert '"op"' not in continuation and "expected" not in continuation.lower()
    assert report["continuation"]["attempts"] == 1
    assert report["continuation"]["final_stop_reason"] == "stop"
    assert report["budget"]["turns"] == 2
    assert report["budget"]["output_tokens"] == 5
    assert len(EventStreamKernel.instances) == 1


def test_length_stop_does_not_continue_after_turn_budget_is_consumed(tmp_path, monkeypatch):
    EventStreamKernel.instances.clear()
    ContinuationKernel.batches = [[
        {"type": "message_end", "message": {"role": "assistant", "stopReason": "length",
                                               "usage": {"output": 3}}},
        {"type": "agent_settled"},
    ]]
    monkeypatch.setattr("tools.restricted_expression_diagnostic.PiKernel", ContinuationKernel)
    config = DiagnosticConfig(root=tmp_path, provider="deterministic", model="scripted",
                              max_turns=1, max_output_tokens=10)

    report = run_diagnostic(config, _green_readiness())

    kernel = EventStreamKernel.instances[0]
    assert len(kernel.prompts) == 1
    assert report["budget"]["stop_reason"] == "max_turns_exceeded"
    assert report["continuation"]["attempts"] == 0
    assert report["continuation"]["final_stop_reason"] == "length"


def test_event_journal_and_cli_summary_are_bounded_but_keep_terminal_evidence(tmp_path, monkeypatch):
    EventStreamKernel.instances.clear()
    monkeypatch.setattr("tools.restricted_expression_diagnostic.PiKernel", EventStreamKernel)
    original_init = EventStreamKernel.__init__

    def init_with_events(self, *args, **kwargs):
        original_init(self, *args, **kwargs)
        self.events = [
            *[{"type": "message_update", "delta": "x" * 100_000} for _ in range(200)],
            {"type": "tool_execution_end", "toolName": "task_harness", "toolCallId": "creator",
             "result": {"details": {"creator_ref": "baseline_method:tool-creator@sha256:abc"}}},
            {"type": "message_end", "message": {"role": "assistant", "stopReason": "stop",
                                                   "usage": {"output": 1}, "content": "complete"}},
            {"type": "agent_settled"},
        ]

    monkeypatch.setattr(EventStreamKernel, "__init__", init_with_events)
    report = run_diagnostic(DiagnosticConfig(root=tmp_path, provider="deterministic", model="scripted"),
                            _green_readiness())

    event_path = tmp_path / "diagnostic-events.jsonl"
    assert event_path.stat().st_size < 200_000
    assert not any(event["type"] == "message_update" for event in report["events"])
    assert any(event["type"] == "tool_execution_end" for event in report["events"])
    assert any(event["type"] == "message_end" and event["message"]["stopReason"] == "stop"
               for event in report["events"])
    assert report["event_journal"]["raw_event_counts"]["message_update"] == 200
    assert report["event_journal"]["dropped_event_counts"]["message_update"] == 200
    summary = diagnostic_cli_summary(report)
    assert "events" not in summary and "settled" not in summary
    assert summary["event_journal"]["persisted_bytes"] == event_path.stat().st_size
    assert len(json.dumps(summary)) < 20_000


def test_unexpected_wait_failure_persists_bounded_journal_before_reraising(tmp_path, monkeypatch):
    class FailingKernel(EventStreamKernel):
        def wait_for_agent_events(self, **_kwargs):
            event = {"type": "message_end", "message": {"role": "assistant", "stopReason": "error",
                                                           "content": "provider transport failed"}}
            if self.event_sink:
                self.event_sink(event)
            raise TimeoutError("fixture wait timeout")

    monkeypatch.setattr("tools.restricted_expression_diagnostic.PiKernel", FailingKernel)
    config = DiagnosticConfig(root=tmp_path, provider="deterministic", model="scripted")

    with pytest.raises(TimeoutError, match="fixture wait timeout"):
        run_diagnostic(config, _green_readiness())

    events = [json.loads(line) for line in (tmp_path / "diagnostic-events.jsonl").read_text(encoding="utf-8").splitlines()]
    assert events[-1]["type"] == "message_end"
    summary = json.loads((tmp_path / "diagnostic-run-summary.json").read_text(encoding="utf-8"))
    assert summary["status"] == "error"
    assert summary["error"] == "fixture wait timeout"


def test_event_stream_counts_repairs_and_replacement_versions(tmp_path, monkeypatch):
    EventStreamKernel.instances.clear()
    monkeypatch.setattr("tools.restricted_expression_diagnostic.PiKernel", EventStreamKernel)
    original_init = EventStreamKernel.__init__

    def init_with_events(self, *args, **kwargs):
        original_init(self, *args, **kwargs)
        self.events = [
            {"type": "tool_execution_start", "toolName": "task_tool", "toolCallId": "a", "args": {"action": "create", "name": "x"}},
            {"type": "tool_execution_end", "toolName": "task_tool", "toolCallId": "a", "isError": True},
            {"type": "tool_execution_start", "toolName": "task_tool", "toolCallId": "b", "args": {"action": "create", "name": "x"}},
            {"type": "tool_execution_end", "toolName": "task_tool", "toolCallId": "b", "isError": True},
            {"type": "tool_execution_start", "toolName": "task_tool", "toolCallId": "c", "args": {"action": "create", "name": "x"}},
            {"type": "tool_execution_end", "toolName": "task_tool", "toolCallId": "c", "details": {"name": "x", "version": 1}},
            {"type": "tool_execution_start", "toolName": "task_tool", "toolCallId": "d", "args": {"action": "update", "name": "x"}},
            {"type": "tool_execution_end", "toolName": "task_tool", "toolCallId": "d", "details": {"name": "x", "version": 2}},
        ]

    monkeypatch.setattr(EventStreamKernel, "__init__", init_with_events)
    config = DiagnosticConfig(root=tmp_path, provider="deterministic", model="scripted", max_replacement_versions=0)
    report = run_diagnostic(config, _green_readiness())

    assert report["budget"]["repairs"] == 2
    assert report["budget"]["initial_failures"] == 1
    assert report["budget"]["failed_calls"] == 2
    assert report["budget"]["replacement_versions"] == 1
    assert report["budget"]["stop_reason"] == "max_replacement_versions_exceeded"
    assert EventStreamKernel.instances[0].aborted is True


def test_event_stream_counts_facade_versions_and_only_expected_invalid_input_as_exempt(tmp_path, monkeypatch):
    EventStreamKernel.instances.clear()
    monkeypatch.setattr("tools.restricted_expression_diagnostic.PiKernel", EventStreamKernel)
    original_init = EventStreamKernel.__init__

    def init_with_events(self, *args, **kwargs):
        original_init(self, *args, **kwargs)
        self.events = [
            {"type": "tool_execution_start", "toolName": "task_harness", "toolCallId": "invalid",
             "args": {"action": "change", "bindings": [{"ref": "observation:groups-invalid@v1"}],
             "changes": [{"candidate": {"name": "invalid"}}]}},
            {"type": "tool_execution_end", "toolName": "task_harness", "toolCallId": "invalid",
             "isError": True, "details": {"format": "task-pure-expression-error-v1", "code": "invalid_input"}},
            {"type": "tool_execution_start", "toolName": "task_harness", "toolCallId": "bad",
             "args": {"action": "change", "bindings": [{"ref": "observation:groups-invalid@v1"}],
             "changes": [{"candidate": {"name": "invalid"}}]}},
            {"type": "tool_execution_end", "toolName": "task_harness", "toolCallId": "bad",
             "isError": True, "details": {"error": "unrelated failure"}},
            {"type": "tool_execution_start", "toolName": "task_harness", "toolCallId": "create",
             "args": {"action": "change", "changes": [{"operation": "create", "candidate": {"name": "x"}}]}},
            {"type": "tool_execution_end", "toolName": "task_harness", "toolCallId": "create",
             "details": {"results": [{"resource": {"resource_ref": "tool:x@v1"}}]}},
            {"type": "tool_execution_start", "toolName": "task_harness", "toolCallId": "update",
             "args": {"action": "change", "changes": [{"operation": "update", "candidate": {"name": "x"}}]}},
            {"type": "tool_execution_end", "toolName": "task_harness", "toolCallId": "update",
             "details": {"results": [{"resource": {"resource_ref": "tool:x@v2"}}]}},
        ]

    monkeypatch.setattr(EventStreamKernel, "__init__", init_with_events)
    config = DiagnosticConfig(root=tmp_path, provider="deterministic", model="scripted", max_replacement_versions=0)
    report = run_diagnostic(config, _green_readiness())

    assert report["budget"]["initial_failures"] == 1
    assert report["budget"]["failed_calls"] == 1
    assert report["budget"]["repairs"] == 0
    assert report["budget"]["replacement_versions"] == 1
    assert report["budget"]["stop_reason"] == "max_replacement_versions_exceeded"


def test_prepare_resources_uses_exact_task_observation_refs_and_is_idempotent(tmp_path):
    first = prepare_diagnostic_resources(tmp_path, FIXTURES)
    second = prepare_diagnostic_resources(tmp_path, FIXTURES)

    assert first == second
    assert [item["ref"] for item in first] == [
        "observation:groups-normal@v1",
        "observation:groups-contrast@v1",
        "observation:groups-invalid@v1",
    ]
    rows = [json.loads(line) for line in (tmp_path / "execution-observations.jsonl").read_text().splitlines()]
    assert len(rows) == 3
    assert all(row["format"] == "task-diagnostic-resource-v1" for row in rows)
    assert all(row["task_id"] for row in rows)
    assert all(row["task_root_fingerprint"] for row in rows)
    assert all(row["result"]["groups"] for row in rows)


def test_conflicting_existing_resource_is_not_overwritten(tmp_path):
    prepare_diagnostic_resources(tmp_path, FIXTURES)
    path = tmp_path / "execution-observations.jsonl"
    rows = [json.loads(line) for line in path.read_text().splitlines()]
    rows[0]["result"]["groups"][0]["rule"]["minimum"] = 999
    path.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")

    with pytest.raises(ValueError, match="conflicting existing diagnostic resource"):
        prepare_diagnostic_resources(tmp_path, FIXTURES)


def test_provider_prompt_contains_contract_and_refs_but_no_oracle_or_authored_ast(tmp_path):
    resources = prepare_diagnostic_resources(tmp_path, FIXTURES)
    prompt = build_provider_prompt(resources)

    assert "observation:groups-normal@v1" in prompt
    assert "parameters/bindings" in prompt
    assert "Input schema:" in prompt and "Output schema:" in prompt
    assert "expected_output" not in prompt
    assert "oracle" not in prompt.lower()
    assert '"op"' not in prompt
    assert "filesystem" in prompt and "bridge" in prompt


def test_pi_command_is_non_arc_and_uses_only_diagnostic_bootstrap():
    command = build_pi_command(DiagnosticConfig(root=Path("run"), provider="p", model="m"))

    assert "--mode" in command and "rpc" in command
    assert "--extension" in command
    assert str(BOOTSTRAP.resolve()) in command
    assert "arc_action" not in command
    assert "arc-capability" not in " ".join(command)


def test_run_local_provider_registry_uses_absolute_agent_dir_for_relative_root(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(
        "tools.restricted_expression_diagnostic.load_project_dotenv",
        lambda _root: {"OPENAI_API_BASE": "https://provider.invalid/v1", "OPENAI_API_KEY": "secret"},
    )
    env = {}
    config = DiagnosticConfig(root=Path("relative-run"), provider="yibu", model="diagnostic-model")

    _prepare_run_local_provider_registry(config, env)

    assert Path(env["PI_CODING_AGENT_DIR"]).is_absolute()
    assert Path(env["PI_CODING_AGENT_DIR"]) == (tmp_path / "relative-run" / ".pi-agent").resolve()
    assert (Path(env["PI_CODING_AGENT_DIR"]) / "models.json").is_file()


def test_diagnostic_cli_keeps_pi_flags_opaque_and_model_exact():
    args = _diagnostic_cli_parser().parse_args([
        "--root", "run", "--provider", "yibu", "--model", "a:deepseek-v4-flash",
        "--run-provider", "--pi-command", "node", "pi.js", "--mode", "rpc",
    ])
    assert args.model == "a:deepseek-v4-flash"
    assert args.pi_command == ["node", "pi.js", "--mode", "rpc"]


def test_bootstrap_only_installs_native_surfaces_and_denies_adapter_calls():
    source = BOOTSTRAP.read_text(encoding="utf-8")

    assert "installTaskResourceReader" in source
    assert "installTaskLocalSelfHarness" in source
    assert "allowedImplementations: []" in source
    assert "evaluateTaskPureExpression" not in source
    assert "preparePureExpressionInput" not in source
    assert "arc_action" not in source
