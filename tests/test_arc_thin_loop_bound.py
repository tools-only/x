"""The runner's account of the loop-bound artifacts (docs/plans/2026-10-20-loop-bound-artifacts.md)."""
import json

from autoresearch_pi import arc_thin_e2e as runner


def test_the_summary_counts_call_points_pinned_tests_and_predictions(tmp_path):
    harness = tmp_path / 'harness'
    harness.mkdir()
    lines = lambda rows: ''.join(json.dumps(r) + '\n' for r in rows)
    (harness / 'call_points.jsonl').write_text(lines([
        dict(kind='refine_point', at=15), dict(kind='refine', at=15, point=True), dict(kind='refine', at=20, point=False),
        dict(kind='consult_point', at=22), dict(kind='consult', at=22, review=True),
        dict(kind='consult_use', at=22, file_marks=2, memory_marks=1)]), encoding='utf-8')
    (harness / 'refiner.jsonl').write_text(lines([
        dict(kind='next', edit='test:prompts/lessons.md:9:1', test=dict(index=1, total=2)),
        dict(kind='next_done', edit='test:prompts/lessons.md:9:1', outcome='met'),
        dict(kind='next', edit='test:prompts/lessons.md:9:2', test=dict(index=2, total=2)),
        dict(kind='next_done', edit='test:prompts/lessons.md:9:2', outcome='expired'),
        dict(kind='next', edit='disagree:12', test=dict(index=1, total=1)), dict(kind='next', edit='e3', move={'action': 'ACTION1'})]), encoding='utf-8')
    (harness / 'trajectory.jsonl').write_text(lines([
        dict(n=1, predictors=[dict(path='tools/p.py', version=1, fields=[{'hit': True}], hits=1, misses=0),
                              dict(path='tools/q.py', version=1, error='raised')]),
        dict(n=2, diverges_from=1)]), encoding='utf-8')
    assert runner._loop_bound_stats(harness) == {
        'refine_points': 1, 'refine_calls': 2, 'refine_calls_at_points': 1, 'consult_points': 1, 'consults_in_reviews': 1,
        'consult_marks': 3, 'tests_pinned': 3, 'tests_by_outcome': {'met': 1, 'expired': 1, 'open': 1}, 'disagreement_pins': 1,
        'predictions': 2, 'predictions_right': 1, 'diverged_moves': 1}
