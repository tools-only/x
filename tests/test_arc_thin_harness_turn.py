"""The harness turn in the runner (ARC_THIN_HARNESS_TURN, docs/plans/2026-10-26-e1-harness-turn-protocol.md): off by
default; on, the level and stall reviews ask for one harness change or a stated reason, and resume as such."""
from types import SimpleNamespace

from autoresearch_pi import arc_thin_e2e as runner
from autoresearch_pi.pi_kernel import PiTurnIdleTimeout


def rows(*changed_at, count):
    return [dict(n=n, action='ACTION1', level_changed=n in changed_at) for n in range(1, count + 1)]


def test_the_harness_turn_is_off_unless_set_in_a_native_treatment_run():
    on = {'ARC_THIN_HARNESS_TURN': '1'}
    assert runner._harness_contract('native', 'treatment', {}) is None
    assert runner._harness_contract('native', 'treatment', {'ARC_THIN_HARNESS_TURN': '0'}) is None
    assert runner._harness_contract('native', 'control', on) is None
    assert runner._harness_contract('legacy', 'treatment', on) is None
    assert runner._level_review_prompt(2, None) == runner._level_review_prompt(2)


def test_on_the_reviews_ask_for_one_harness_change_and_the_guard_place_only_with_guards():
    contract = runner._harness_contract('native', 'treatment', {'ARC_THIN_HARNESS_TURN': '1'})
    level = runner._level_review_prompt(2, contract)
    assert level.startswith('LEVEL REVIEW. Level 2 is complete; this turn takes no action.\nMake the one harness change')
    assert 'revise or retire one that did not help' in level and 'NO HARNESS CHANGE: <reason>' in level
    assert 'Available places are prompt, view, predictor and callable tool;' in level
    assert '<!-- HARNESS EXPECT' in level and 'def check(t):' in level
    assert 'prompts/lessons.md' not in level and '- test: <move>' not in level
    stall = runner._stall_review_prompt(rows(30, count=70), 0, 1, None, contract)
    assert stall.startswith('STALL REVIEW. Level 2 is still open after 40 actions (since it began at action 31); '
                            'this turn takes no action.\nMake the one harness change')
    assert 'prompts/review.md' not in stall
    guarded = runner._harness_contract('native', 'treatment', {'ARC_THIN_HARNESS_TURN': '1', 'ARC_THIN_GUARDS': '1'})
    assert 'Available places are prompt, view, predictor, guard and callable tool;' in guarded
    assert '{places}' not in guarded
    hooked = runner._harness_contract('native', 'treatment', {'ARC_THIN_HARNESS_TURN': '1', 'ARC_THIN_GUARDS': '1', 'ARC_THIN_HOOKS': '1'})
    assert 'Available places are prompt, view, predictor, guard, hook and callable tool;' in hooked
    assert '(in a .py file, as # comment lines)' in hooked and 'authoritative' not in hooked


def test_a_harness_turn_resumes_as_a_harness_turn():
    contract = runner._harness_contract('native', 'treatment', {'ARC_THIN_HARNESS_TURN': '1'})
    review = runner._level_review_prompt(1, contract)
    assert runner._review_recovery(review, contract) == runner.HARNESS_LEVEL_REVIEW_RECOVERY_PROMPT + contract
    assert runner._review_recovery(review) == runner.LEVEL_REVIEW_RECOVERY_PROMPT
    stall = runner._stall_review_prompt(rows(count=40), 0, 0, None, contract)
    assert runner._review_recovery(stall, contract) == runner.HARNESS_STALL_REVIEW_RECOVERY_PROMPT + contract
    stats = dict(idle_timeouts=0, idle_recoveries=0, idle_recovery_failures=0)
    kernel = SimpleNamespace(abort=lambda: None, wait_for_agent_events=lambda **kw: [{'type': 'agent_settled'}])
    messages = []

    def turn(message):
        messages.append(message)
        if len(messages) == 1:
            raise PiTurnIdleTimeout('silent stream', events=[], idle_seconds=180)
        return [{'type': 'agent_settled'}]
    runner._recover_native_turn(turn, review, kernel, stats, lambda: False, contract=contract)
    assert messages[1] == runner.HARNESS_LEVEL_REVIEW_RECOVERY_PROMPT + contract
