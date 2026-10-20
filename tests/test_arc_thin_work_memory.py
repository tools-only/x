"""Work memory in the runner (docs/plans/2026-10-20-work-memory.md): the spin-triggered stall review and its accounting."""
import json

import pytest

from autoresearch_pi import arc_thin_e2e as runner


def row(n, decision, action='ACTION1', novelty='known', **extra):
    return {**dict(n=n, decision=decision, action=action, novelty=novelty, level_changed=False), **extra}


def test_the_spin_review_is_on_by_default_in_native_runs_and_off_without_work_memory():
    assert runner._spin_review_after('native', None, {}) == runner.SPIN_REVIEW_AFTER == 2
    assert runner._spin_review_after('native', None, {'ARC_THIN_SPIN_REVIEW': '0'}) == 0
    assert runner._spin_review_after('native', None, {'ARC_THIN_SPIN_REVIEW': '3'}) == 3
    assert runner._spin_review_after('native', 5, {'ARC_THIN_SPIN_REVIEW': '3'}) == 5
    assert runner._spin_review_after('native', None, {'ARC_THIN_WORK_MEMORY': '0'}) == 0
    assert runner._spin_review_after('legacy', None, {}) == 0
    with pytest.raises(ValueError):
        runner._spin_review_after('native', -1, {})


def test_the_spin_streak_counts_decisions_that_only_replayed_known_results():
    rows = [row(1, 1, novelty='new'), row(2, 2), row(3, 3, action='RESET'), row(4, 4, action='ACTION6', x=31, y=5), row(5, 4)]
    assert runner._spin_streak(rows) == (2, ['ACTION6(31,5)', 'ACTION1'])
    assert runner._spin_streak(rows + [row(6, 5, novelty='new')]) == (0, [])
    assert runner._spin_streak(rows + [row(6, 5, novelty='diverged')]) == (0, [])
    assert runner._spin_streak(rows + [row(6, 5, level_changed=True)])[0] == 0
    assert runner._spin_streak([dict(n=1, decision=1, action='ACTION1')]) == (0, []), 'rows without novelty never spin'


def test_a_spin_review_says_why_it_came_and_keeps_the_stall_review_s_form():
    trajectory = [row(n, n) for n in range(1, 51)]
    prompt = runner._stall_review_prompt(trajectory, 0, 0, (2, ['ACTION6(31,5)']))
    assert prompt.startswith('STALL REVIEW. Your last 2 decisions only played moves whose results this board had already shown '
                             '(ACTION6(31,5)); level 1 has been open for 50 actions (since it began at action 1); '
                             'this turn takes no action.')
    assert '- test: <move> — <what it would show>\n' in prompt
    assert runner._review_recovery(prompt) == runner.STALL_REVIEW_RECOVERY_PROMPT
    assert runner._stall_review_prompt(trajectory, 0, 0).startswith('STALL REVIEW. Level 1 is still open after 50 actions')


def test_the_summary_reports_work_memory(tmp_path):
    harness = tmp_path / 'harness'
    harness.mkdir()
    lines = lambda items: ''.join(json.dumps(r) + '\n' for r in items)
    (harness / 'python_calls.jsonl').write_text(lines([dict(id=1, code='x'), dict(id=2, same=1, cached=True, code='x'),
                                                       dict(id=3, cells=[1], code='cell(1)'),
                                                       dict(id=4, blocks=[{'from': 2, 'to': 5, 'id': 1, 'a': 1, 'b': 4}], code='y')]),
                                                encoding='utf-8')
    (harness / 'trajectory.jsonl').write_text(lines([row(1, 1, novelty='new'), row(2, 2), row(3, 3), row(4, 4, novelty='new'),
                                                     row(5, 5)]), encoding='utf-8')
    (harness / 'work_memory.jsonl').write_text(lines([dict(kind='novelty_pin', move='ACTION6(3,3)')]), encoding='utf-8')
    assert runner._work_memory_stats(harness) == {
        'python_calls': 4, 'repeats': 1, 'answered_from_same_state': 1, 'retyped_lines': 1, 'cell_calls': 1,
        'actions_by_novelty': {'new': 2, 'known': 3, 'diverged': 0},
        'spin_decisions': 3, 'longest_spin_streak': 2, 'novelty_pins': 1}
    empty = tmp_path / 'empty'
    empty.mkdir()
    assert runner._work_memory_stats(empty) is None
