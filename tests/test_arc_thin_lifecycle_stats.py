"""Refutation-response counts in the thin run summary; pure, no provider or game."""
from autoresearch_pi.arc_thin_e2e import _refutation_responses


def hyp(key, claim, status="open", refutes=0):
    evidence = [{"condition": "c", "observed": "o", "verdict": "refutes"}] * refutes
    return {"key": key, "hyp": {"claim": claim, "status": status, "evidence": evidence}}


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
