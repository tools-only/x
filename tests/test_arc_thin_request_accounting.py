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
