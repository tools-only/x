"""The evolution pass in the runner (docs/plans/2026-11-17-arc-evolution-pass.md): the stagnation trigger counts
actions since the later of the last self change and the last pass, a pass prompt recovers as a pass, and the summary
reports each pass's turn from rows the extension already wrote."""
import json

from autoresearch_pi import arc_thin_e2e as runner


def test_the_stagnation_trigger_counts_from_the_later_of_last_change_and_last_pass(tmp_path):
    assert runner.EVO_STAGNATION_AFTER == 30
    assert runner._evo_stagnation(tmp_path, 100, 0, 0) == 0, '0 turns the trigger off'
    assert runner._evo_stagnation(tmp_path, 29, 0, 30) == 0
    assert runner._evo_stagnation(tmp_path, 30, 0, 30) == 30
    (tmp_path / 'harness_changes.jsonl').write_text(json.dumps({'at': 10}) + '\n', encoding='utf-8')
    assert runner._evo_stagnation(tmp_path, 39, 0, 30) == 0, 'a self change restarts the count'
    assert runner._evo_stagnation(tmp_path, 40, 0, 30) == 30
    assert runner._evo_stagnation(tmp_path, 49, 20, 30) == 0, 'a pass after the change restarts it too'
    assert runner._evo_stagnation(tmp_path, 55, 20, 30) == 35
    (tmp_path / 'harness_changes.jsonl').write_text(
        json.dumps({'at': 10}) + '\n' + json.dumps({'at': 45, 'by': 'runtime'}) + '\n', encoding='utf-8')
    assert runner._evo_stagnation(tmp_path, 70, 20, 30) == 50, "a runtime receipt (a pin, a restore) does not restart it"


def test_a_pass_prompt_states_the_focus_trigger_and_recovers_the_same_specialist():
    prompt = runner.EVO_PASS_PROMPT.format(why='Level 1 is settled and reviewed', focus='Memory', index=5)
    assert prompt.startswith('EVOLUTION PASS [Memory 5/7]. Level 1 is settled and reviewed; this turn takes no action: the game is paused')
    assert 'NO HARNESS CHANGE: <reason>' in prompt, 'no change is a stated, valid closure'
    assert 'The host presents facts without ranking, diagnosis, recommendation or order.' in prompt
    recovery = runner._review_recovery(prompt)
    assert recovery == runner.EVO_PASS_RECOVERY_PROMPT.format(focus='Memory', index=5)
    assert runner._review_recovery(recovery) == recovery
    assert runner._review_recovery('STALL REVIEW. x') == runner.STALL_REVIEW_RECOVERY_PROMPT, 'the other reviews keep their own'


def test_the_summary_reports_each_pass_turn_with_its_changes_no_change_reason_and_carried_tails(tmp_path):
    lines = lambda items: ''.join(json.dumps(row) + '\n' for row in items)
    assert runner._evo_pass_stats(tmp_path) is None, 'no pass rows, no entry'
    (tmp_path / 'working_set.jsonl').write_text(lines([
        dict(decision=3, consolidating=True, evo_pass=True, actions=2),
        dict(decision=5, consolidating=True, evo_pass=True, actions=3),
        dict(decision=4, consolidating=False, actions=3),
    ]), encoding='utf-8')
    (tmp_path / 'usage.jsonl').write_text(lines([
        dict(decision=3, kind='agent', input=500, output=100),
        dict(decision=3, kind='agent', input=200, output=50),
        dict(decision=3, kind='refiner', input=999, output=999),
        dict(decision=4, kind='agent', input=999, output=999),
        dict(decision=5, kind='agent', input=400, output=80),
    ]), encoding='utf-8')
    (tmp_path / 'harness_changes.jsonl').write_text(lines([
        dict(decision=3, at=2, path='prompts/rules.md', version=2),
        dict(decision=3, at=2, path='prompts/strategy.md', version=1, by='runtime'),
        dict(decision=4, at=3, path='tools/scan.py', version=1),
    ]), encoding='utf-8')
    (tmp_path / 'harness_decisions.jsonl').write_text(lines([
        dict(kind='review_start', decision=3, type='evo', at=2, focus='Prompt', index=1),
        dict(kind='pass_focus_close', decision=3, at=2, focus='Prompt', index=1, carry='tail of the reply'),
        dict(kind='review_start', decision=5, type='evo', at=3, focus='Skill', index=2),
        dict(kind='no_change', decision=5, type='evo', at=3, reason='nothing repeats'),
        dict(kind='no_change', decision=9, type='stall', at=9, reason='another review kind'),
        dict(kind='pass_focus_close', decision=5, at=3, focus='Skill', index=2),
        dict(kind='budget_skip', at=3, not_executed=['Tool', 'Subagent', 'Memory', 'Context', 'Loop']),
    ]), encoding='utf-8')
    assert runner._evo_pass_stats(tmp_path) == {
        'turns': [
            {'decision': 3, 'focus': 'Prompt', 'index': 1, 'requests': 2, 'budget_tokens': 850,
             'changes': [{'path': 'prompts/rules.md', 'version': 2}], 'no_change': None},
            {'decision': 5, 'focus': 'Skill', 'index': 2, 'requests': 1, 'budget_tokens': 480, 'changes': [], 'no_change': 'nothing repeats'},
        ],
        'carried': 1, 'not_executed': ['Tool', 'Subagent', 'Memory', 'Context', 'Loop'],
    }


def test_an_interrupted_batch_resumes_at_the_next_unfinished_focus(tmp_path):
    (tmp_path / 'harness_decisions.jsonl').write_text(''.join(json.dumps(row) + '\n' for row in [
        {'kind': 'pass_close', 'at': 8},
        {'kind': 'review_start', 'type': 'evo', 'decision': 12, 'focus': 'Memory', 'index': 5, 'reason': 'level settled'},
        {'kind': 'pass_focus_close', 'decision': 12, 'focus': 'Memory', 'index': 5},
    ]), encoding='utf-8')
    assert runner._evo_pass_resume(tmp_path) == (5, 'level settled')


def test_a_budget_skip_resumes_after_the_last_completed_focus_even_before_extension_close(tmp_path):
    (tmp_path / 'harness_decisions.jsonl').write_text(''.join(json.dumps(row) + '\n' for row in [
        {'kind': 'review_start', 'type': 'evo', 'decision': 4, 'focus': 'Tool', 'index': 3,
         'reason': 'one action without a self change'},
        {'kind': 'budget_skip', 'reason': 'token_cap', 'completed': ['Prompt', 'Skill', 'Tool'],
         'not_executed': ['Subagent', 'Memory', 'Context', 'Loop']},
    ]), encoding='utf-8')
    assert runner._evo_pass_resume(tmp_path) == (3, 'one action without a self change')
