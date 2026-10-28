"""The level review in the runner (docs/plans/2026-10-20-level-review-lessons.md): default, prompt, recovery, forks."""
import json
from types import SimpleNamespace

from autoresearch_pi import arc_thin_e2e as runner
from autoresearch_pi.pi_kernel import PiTurnIdleTimeout


def test_review_after_a_level_change_is_on_unless_turned_off():
    assert runner._level_review_default(None, {}) is True
    assert runner._level_review_default(None, {'ARC_THIN_LEVEL_REVIEW': '0'}) is False
    assert runner._level_review_default(False, {}) is False
    assert runner._level_review_default(True, {'ARC_THIN_LEVEL_REVIEW': '0'}) is True


def test_level_review_prompt_names_the_level_and_the_next_one():
    prompt = runner._level_review_prompt(2)
    assert prompt.startswith('LEVEL REVIEW. Level 2 is complete; this turn takes no action. Rewrite prompts/lessons.md whole')
    assert '\n---\nactive: true\n---\n' in prompt
    assert '(level 2 only)' in prompt and '2. For level 3: 2-4 candidate win conditions' in prompt
    # The candidates are test lines the runtime pins (docs/plans/2026-10-20-loop-bound-artifacts.md A3).
    assert '\n- test: <move> — <the win condition it tests>\n' in prompt and 'pins them in this order' in prompt
    assert "Level 2's pattern is one candidate, not a rule." in prompt
    assert 'LOOP AUDIT' in prompt and 'strategy, information representations, tools' in prompt
    assert 'capability to Self' in prompt and 'prompts/process/<name>.md' in prompt
    assert 'EXPECT within <N> actions' in prompt
    assert 'DECISION: keep | revise | remove' in prompt and 'DECISION: no_change' in prompt


def test_a_review_resumes_as_the_same_kind_of_review():
    assert runner._review_recovery(runner._level_review_prompt(1)) == runner.LEVEL_REVIEW_RECOVERY_PROMPT
    assert runner._review_recovery(runner.LEVEL_REVIEW_RECOVERY_PROMPT) == runner.LEVEL_REVIEW_RECOVERY_PROMPT
    assert runner._review_recovery(runner.CONSOLIDATE_PROMPT) == runner.CONSOLIDATE_RECOVERY_PROMPT
    assert runner._review_recovery(runner.DECIDE_PROMPT) is None
    stats = dict(idle_timeouts=0, idle_recoveries=0, idle_recovery_failures=0)
    kernel = SimpleNamespace(abort=lambda: None, wait_for_agent_events=lambda **kw: [{'type': 'agent_settled'}])
    messages = []

    def turn(message):
        messages.append(message)
        if len(messages) == 1:
            raise PiTurnIdleTimeout('silent stream', events=[], idle_seconds=180)
        return [{'type': 'agent_settled'}]
    runner._recover_native_turn(turn, runner._level_review_prompt(1), kernel, stats, lambda: False)
    assert messages[1] == runner.LEVEL_REVIEW_RECOVERY_PROMPT


def test_the_summary_reports_each_review_turn_and_the_lessons_file(tmp_path):
    harness = tmp_path / 'harness'
    harness.mkdir()
    (tmp_path / '.harness').mkdir()
    (tmp_path / 'workspace' / 'prompts').mkdir(parents=True)
    assert runner._level_review_stats(harness) is None
    lines = lambda rows: ''.join(json.dumps(r) + '\n' for r in rows)
    (harness / 'working_set.jsonl').write_text(lines([dict(decision=5, consolidating=True, level_review=True),
                                                      dict(decision=6, consolidating=False)]), encoding='utf-8')
    (harness / 'usage.jsonl').write_text(lines([dict(decision=5, kind='agent', input=1000, output=200),
                                                dict(decision=5, kind='agent', input=None, output=50),
                                                dict(decision=5, kind='refiner', input=900, output=90),
                                                dict(decision=6, kind='agent', input=7, output=7)]), encoding='utf-8')
    (tmp_path / '.harness' / 'components.jsonl').write_text(lines([
        dict(path='prompts/lessons.md', version=1, error='markdown needs frontmatter'),
        dict(path='prompts/lessons.md', version=2), dict(path='prompts/strategy.md', version=1)]), encoding='utf-8')
    (tmp_path / 'workspace' / 'prompts' / 'lessons.md').write_text('---\nactive: true\n---\nx\n', encoding='utf-8')
    assert runner._level_review_stats(harness) == {
        'turns': [{'decision': 5, 'requests': 2, 'budget_tokens': 1250}],
        'lessons_versions': 2, 'lessons_failed': 1, 'lessons_chars': 23}


def test_a_fork_from_a_level_completing_decision_knows_its_review_is_due(tmp_path):
    snapshot = tmp_path / 'snapshot'
    (snapshot / 'harness').mkdir(parents=True)
    rows = [dict(n=1, action='ACTION6', x=1, y=1, level_changed=False, budget=dict(total_used=1)),
            dict(n=2, action='ACTION6', x=8, y=8, level_changed=True, budget=dict(total_used=2))]
    (snapshot / 'harness' / 'trajectory.jsonl').write_text(''.join(json.dumps(r) + '\n' for r in rows), encoding='utf-8')
    (snapshot / 'harness' / 'states.jsonl').write_text(''.join(json.dumps(dict(n=k, grid=[[k]])) + '\n' for k in range(3)), encoding='utf-8')
    (snapshot / 'snapshot.json').write_text(json.dumps(dict(format='arc-thin-snapshot-v1', game='g', decision=2, actions=2)), encoding='utf-8')
    root = tmp_path / 'fork'
    root.mkdir()
    assert runner._seed_fork(root, snapshot, 'g')['level_changed'] is True
    rows[-1]['level_changed'] = False
    (snapshot / 'harness' / 'trajectory.jsonl').write_text(''.join(json.dumps(r) + '\n' for r in rows), encoding='utf-8')
    other = tmp_path / 'fork2'
    other.mkdir()
    assert runner._seed_fork(other, snapshot, 'g')['level_changed'] is False
