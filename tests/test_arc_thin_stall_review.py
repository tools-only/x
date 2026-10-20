"""The stall review in the runner (docs/plans/2026-10-20-stall-review.md): default, when it is due, prompt, recovery, stats."""
import json

import pytest

from autoresearch_pi import arc_thin_e2e as runner


def rows(*changed_at, count):
    return [dict(n=n, action='ACTION1', level_changed=n in changed_at) for n in range(1, count + 1)]


def test_the_stall_review_is_on_by_default_in_native_runs():
    assert runner._stall_review_after('native', None, {}) == runner.STALL_REVIEW_AFTER == 40
    assert runner._stall_review_after('native', None, {'ARC_THIN_STALL_REVIEW': '0'}) == 0
    assert runner._stall_review_after('native', None, {'ARC_THIN_STALL_REVIEW': '25'}) == 25
    assert runner._stall_review_after('native', 10, {'ARC_THIN_STALL_REVIEW': '25'}) == 10
    assert runner._stall_review_after('legacy', None, {}) == 0
    with pytest.raises(ValueError):
        runner._stall_review_after('native', -1, {})


def test_a_stall_review_is_due_after_that_many_actions_on_the_level_or_since_the_last_one():
    assert not runner._stall_review_due(rows(count=39), 0, 40)
    assert runner._stall_review_due(rows(count=40), 0, 40)
    assert not runner._stall_review_due(rows(30, count=60), 0, 40), 'the level began at action 31'
    assert runner._stall_review_due(rows(30, count=70), 0, 40)
    assert not runner._stall_review_due(rows(30, count=100), 70, 40), 'reviewed at action 70'
    assert runner._stall_review_due(rows(30, count=110), 70, 40)
    assert not runner._stall_review_due(rows(count=100), 0, 0), '0 turns it off'


def test_the_prompt_names_the_level_and_what_the_count_runs_from_and_resumes_as_a_stall_review():
    prompt = runner._stall_review_prompt(rows(30, count=70), 0, 1)
    assert prompt.startswith('STALL REVIEW. Level 2 is still open after 40 actions (since it began at action 31); '
                             'this turn takes no action.')
    assert 'rewrite prompts/review.md whole, in one write call' in prompt and '\n---\nactive: true\n---\n' in prompt
    assert '4. 2-4 directions not tested yet, each with the move that would show it.' in prompt
    again = runner._stall_review_prompt(rows(count=80), 40, 0)
    assert again.startswith('STALL REVIEW. Level 1 is still open after 40 actions (since your last stall review, at action 40);')
    assert runner._review_recovery(prompt) == runner.STALL_REVIEW_RECOVERY_PROMPT
    assert runner._review_recovery(runner.STALL_REVIEW_RECOVERY_PROMPT) == runner.STALL_REVIEW_RECOVERY_PROMPT


def test_the_summary_reports_each_stall_review_and_the_review_file(tmp_path):
    harness = tmp_path / 'harness'
    harness.mkdir()
    (tmp_path / 'workspace' / 'prompts').mkdir(parents=True)
    lines = lambda items: ''.join(json.dumps(r) + '\n' for r in items)
    (harness / 'working_set.jsonl').write_text(lines([dict(decision=9, consolidating=True, stall_review=True, actions=40)]),
                                               encoding='utf-8')
    (harness / 'usage.jsonl').write_text(lines([dict(decision=9, kind='agent', input=500, output=100)]), encoding='utf-8')
    (tmp_path / 'workspace' / 'prompts' / 'review.md').write_text('---\nactive: true\n---\nx\n', encoding='utf-8')
    assert runner._review_stats(harness, 'stall_review', 'review') == {
        'turns': [{'decision': 9, 'requests': 1, 'budget_tokens': 600}],
        'review_versions': 0, 'review_failed': 0, 'review_chars': 23}
    assert runner._level_review_stats(harness) is None
