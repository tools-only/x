from autoresearch_pi.arc_thin_e2e import _request_accounting


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
