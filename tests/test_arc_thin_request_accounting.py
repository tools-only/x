from autoresearch_pi.arc_thin_e2e import _provider_capacity_error, _provider_capacity_summary, _provider_context_accounting, _request_accounting


def test_provider_credit_and_max_output_errors_are_terminal_capacity_failures():
    error = ("This request requires more credits, or fewer max_tokens. You requested up to 65536 tokens, "
             "but can only afford 16000.")
    assert _provider_capacity_error(error)
    assert _provider_capacity_error("insufficient credits for requested max output tokens")
    assert not _provider_capacity_error("Connection error.")
    assert not _provider_capacity_error("rate limit exceeded")
    summary = _provider_capacity_summary(error + " See https://provider.example/keys/private-id")
    assert summary == "provider cannot afford requested max_tokens=65536; affordable max_tokens=16000"
    assert "private-id" not in summary


def test_completed_cancelled_and_unsettled_requests_are_distinct_and_not_zero_cost():
    rows=[]
    for n in range(90):
        rows.append(dict(stage='request_prepared',request_id=str(n),kind='parent'))
        if n < 87:
            rows.append(dict(stage='request_settlement',request_id=str(n),kind='parent',status='completed',cost_status='reported',total=10))
        elif n < 89:
            rows.append(dict(stage='request_settlement',request_id=str(n),kind='parent',status='aborted',cost_status='unknown',total=None))
    for n in range(2):
        rows.extend([dict(stage='request_prepared',request_id=f'c{n}',kind='critic'),
                     dict(stage='request_settlement',request_id=f'c{n}',kind='critic',status='completed',cost_status='reported',total=20)])
    out=_request_accounting(rows)
    assert out['attempts']==92 and out['known_tokens_lower_bound']==910
    assert out['unknown_cost_attempts']==3 and not out['complete_cost_known']
    assert out['by_kind']['parent']==dict(attempts=90,completed=87,aborted=2,unsettled=1,failed=0)


def test_provider_context_accounting_separates_exact_reuse_from_new_suffix():
    out = _provider_context_accounting([
        dict(message_chars=100, payload_chars=130, tool_schema_chars=30,
             repeated_message_chars=0, common_prefix_chars=0, nonidentical_suffix_chars=100),
        dict(message_chars=140, payload_chars=200, tool_schema_chars=60, repeated_message_chars=100, common_prefix_chars=100,
             nonidentical_suffix_chars=40, same_message_sequence=False),
        dict(message_chars=140, payload_chars=210, tool_schema_chars=70, repeated_message_chars=140, common_prefix_chars=140,
             nonidentical_suffix_chars=0, same_message_sequence=True),
    ])
    assert out['requests'] == 3
    assert out['serialized_payload_chars'] == 540 and out['tool_schema_chars'] == 160
    assert out['exact_repeated_message_chars'] == 240
    assert out['common_prefix_chars'] == 240
    assert out['nonidentical_suffix_chars'] == 140
    assert out['exact_sequence_repeats'] == 1
    assert 'not token or billing savings' in out['scope']


def test_runtime_issue_lifecycle_joins_observer_recovery_and_component_execution(tmp_path):
    import json
    from autoresearch_pi.arc_thin_reuse_report import _issue_lifecycle

    harness = tmp_path / "harness"
    harness.mkdir()
    def write(name, rows):
        (harness / name).write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
    write("task_runtime_fact_delivery.jsonl", [
        dict(kind="delivered", issue_ref="runtime:observer:observers/scan.py@2", n=2, decision=2),
        dict(kind="delivered", issue_ref="runtime:component:abc", key="task:component:tools/probe.py@1:2,3:1:2", n=2, decision=3),
        dict(kind="agent_referenced", issue_ref="runtime:observer:observers/scan.py@2", n=2, decision=3),
    ])
    write("observer_runs.jsonl", [dict(key="observers/scan.py@2@3", n=3, ok=True, value={"target": [1, 2]})])
    write("self_harness_task_facts.jsonl", [dict(kind="component_execution", path="tools/probe.py", version=1,
                                                     n=3, decision=4, outcome="success")])
    issues = {item["ref"]: item for item in _issue_lifecycle(harness)}
    assert issues["runtime:observer:observers/scan.py@2"]["status"] == "produced_output_after_delivery"
    assert issues["runtime:observer:observers/scan.py@2"]["agent_referenced"]
    assert issues["runtime:component:abc"]["status"] == "executed_after_delivery"


def test_reuse_report_preserves_partial_cost_and_cache_write_tokens(tmp_path):
    import json
    from autoresearch_pi.arc_thin_reuse_report import build_report

    (tmp_path / "harness").mkdir()
    (tmp_path / "harness" / "usage.jsonl").write_text(json.dumps(dict(
        kind="agent", input=10, cache_read=20, cache_write=30, output=40, reasoning=5, total=100)) + "\n", encoding="utf-8")
    accounting = _request_accounting([
        dict(stage="request_prepared", request_id="ok", kind="parent"),
        dict(stage="request_settlement", request_id="ok", status="completed", cost_status="reported", total=100),
        dict(stage="request_prepared", request_id="pending", kind="adoption"),
    ])
    (tmp_path / "summary.json").write_text(json.dumps(dict(request_accounting=accounting)), encoding="utf-8")
    cost = build_report(tmp_path)["cost"]
    assert cost["total_reported"] == 100
    assert cost["by_kind"]["agent"]["cache_write"] == 30
    assert cost["complete_cost_known"] is False
    assert cost["request_accounting"]["unknown_cost_attempts"] == 1
    assert cost["request_accounting"]["by_kind"]["adoption"]["unsettled"] == 1
    (tmp_path / "summary.json").unlink()
    legacy = build_report(tmp_path)["cost"]
    assert legacy["total_reported"] == 100 and legacy["complete_cost_known"] is None


def test_a_contest_by_a_check_is_not_counted_as_a_memory_write(tmp_path):
    """A row by "check" (the runtime marking a hypothesis contested) is neither the agent's write nor a refinement's."""
    import json
    from autoresearch_pi.arc_thin_e2e import _harness_stats
    from autoresearch_pi.arc_thin_reuse_report import build_report

    harness = tmp_path / "harness"
    harness.mkdir()
    hyp = dict(claim="c", status="open", evidence=[], check="def check(t):\n    return False\n")
    rows = [dict(key="hyp.a", hyp=hyp, at=3), dict(key="hyp.a", hyp={**hyp, "status": "contested", "contested_at": 5}, at=5, by="check")]
    (harness / "memory.jsonl").write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
    stats = _harness_stats(harness)
    assert (stats["memory_writes"], stats["hypotheses"]["writes"], stats["hypotheses"]["contested_by_check"]) == (1, 1, 1)
    assert stats["hypotheses"]["final"] == {"hyp.a": "contested"}
    memory = build_report(tmp_path)["categories"]["memory"]
    assert (memory["writes"], memory["by_check"]) == (1, 1)


def test_use_ledger_keeps_unrecoverable_history_unknown_and_counts_replayed_tool_calls(tmp_path):
    import json
    from autoresearch_pi.arc_thin_reuse_report import build_report

    harness = tmp_path / "harness"
    harness.mkdir()
    (harness / "component_runs.jsonl").write_text(json.dumps({"kind": "tool", "name": "large", "ok": False}) + "\n", encoding="utf-8")
    event = {"type": "message_end", "message": {"role": "assistant", "content": [
        {"type": "toolCall", "name": "large", "arguments": {"args": {"grid": [[1] * 30 for _ in range(30)]}}}]}}
    (tmp_path / "pi-events.jsonl").write_text(json.dumps(event) + "\n", encoding="utf-8")
    facts = [
        {"kind": "component_delivery", "components": [{"kind": "tool", "name": "large", "path": "tools/large.py", "version": 2}]},
        {"kind": "component_delivery", "components": [{"kind": "tool", "name": "large", "path": "tools/large.py", "version": 2}]},
        {"kind": "component_execution", "path": "tools/large.py", "version": 2, "decision": 3, "n": 1, "outcome": "success"},
    ]
    (harness / "self_harness_task_facts.jsonl").write_text("".join(json.dumps(row) + "\n" for row in facts), encoding="utf-8")
    (harness / "trajectory.jsonl").write_text("".join(json.dumps(row) + "\n" for row in [
        {"n": 2, "levels_completed": 0, "via": "tools/large.py"}, {"n": 3, "levels_completed": 1}]), encoding="utf-8")
    (harness / "memory.jsonl").write_text(json.dumps({"key": "strat.probe", "strat": {"status": "active", "uses": ["tool:large"]}}) + "\n", encoding="utf-8")
    ledger = build_report(tmp_path)["use_ledger"]
    assert ledger["tools_mounted"] == "unknown"
    assert "未持久化" in ledger["unknown_reasons"]["opportunity_windows"]
    assert ledger["kind_tool_attempts"] == ledger["uses"] == 1
    assert ledger["ok_true"] == 0 and ledger["ok_false"] == 1
    assert ledger["tool_call_args_classes"] == {"literal_big": 1}
    feedback = ledger["component_feedback"][0]
    assert feedback["path"] == "tools/large.py" and feedback["version"] == 2
    assert (feedback["active_requests"], feedback["executions"], feedback["successful_executions"]) == (2, 1, 1)
    assert feedback["environment_actions_after_latest_execution"] == 2
    assert feedback["actions_via_component"] == 1
    assert feedback["active_strategies_declaring_use"] == ["strat.probe"]
    assert "not causal impact" in feedback["interpretation"]

    (harness / "request-events.jsonl").write_text(json.dumps({"stage": "decide_callable_schema", "tools": [
        {"name": "large", "act_capable": True}], "act_capable_count": 1}) + "\n", encoding="utf-8")
    live = build_report(tmp_path)["use_ledger"]
    assert live["tools_mounted"] == live["act_capable_count"] == live["opportunity_windows"] == 1


def test_action_intervals_use_request_time_counts_and_keep_failed_or_unsettled_attempts(tmp_path):
    import json
    from autoresearch_pi.arc_thin_reuse_report import _action_intervals

    harness = tmp_path / "harness"
    harness.mkdir()
    requests = [
        {"request_id": "before", "stage": "request_prepared", "kind": "parent", "decision": 1,
         "actions_completed_before_request": 0, "monotonic_ms": 10},
        {"request_id": "before", "stage": "request_settlement", "status": "failed", "monotonic_ms": 11},
        {"request_id": "after-batch", "stage": "request_prepared", "kind": "parent", "decision": 1,
         "actions_completed_before_request": 3, "monotonic_ms": 12},
        {"request_id": "legacy", "stage": "request_prepared", "kind": "consult", "decision": 1,
         "monotonic_ms": 13},
    ]
    (harness / "request-events.jsonl").write_text("".join(json.dumps(row) + "\n" for row in requests), encoding="utf-8")
    report = _action_intervals(tmp_path, [{"n": i} for i in range(3)],
                               [{"decision": 1, "n": 0}, {"decision": 1, "n": 3}], [])
    intervals = {row["actions_completed_before_interval"]: row for row in report["intervals"]}
    assert intervals[0]["provider_requests"] == 1
    assert intervals[0]["provider_requests_by_status"] == {"failed": 1}
    assert intervals[3]["provider_requests"] == 1
    assert intervals[3]["provider_requests_by_status"] == {"unsettled": 1}
    assert len(report["unassigned_provider_requests"]) == 1
    assert "without action-count telemetry" in report["unassigned_provider_requests"][0]["attribution"]


def test_use_ledger_keeps_unrecoverable_history_unknown_and_counts_replayed_tool_calls(tmp_path):
    import json
    from autoresearch_pi.arc_thin_reuse_report import build_report

    harness = tmp_path / "harness"
    harness.mkdir()
    (harness / "component_runs.jsonl").write_text(json.dumps({"kind": "tool", "name": "large", "ok": False}) + "\n", encoding="utf-8")
    event = {"type": "message_end", "message": {"role": "assistant", "content": [
        {"type": "toolCall", "name": "large", "arguments": {"args": {"grid": [[1] * 30 for _ in range(30)]}}}]}}
    (tmp_path / "pi-events.jsonl").write_text(json.dumps(event) + "\n", encoding="utf-8")
    ledger = build_report(tmp_path)["use_ledger"]
    assert ledger["tools_mounted"] == "unknown"
    assert "未持久化" in ledger["unknown_reasons"]["opportunity_windows"]
    assert ledger["kind_tool_attempts"] == ledger["uses"] == 1
    assert ledger["ok_true"] == 0 and ledger["ok_false"] == 1
    assert ledger["tool_call_args_classes"] == {"literal_big": 1}

    (harness / "request-events.jsonl").write_text(json.dumps({"stage": "decide_callable_schema", "tools": [
        {"name": "large", "act_capable": True}], "act_capable_count": 1}) + "\n", encoding="utf-8")
    live = build_report(tmp_path)["use_ledger"]
    assert live["tools_mounted"] == live["act_capable_count"] == live["opportunity_windows"] == 1
