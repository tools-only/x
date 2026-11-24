"""Recompute official ARC-AGI-3 scores from saved scorecard JSON files.

Per level: min((baseline_actions / agent_actions)^2 * 100, 115) when the level was completed, else 0.
Levels are weighted by their 1-based index; the game score is the weighted mean, capped at the share of weight
carried by completed levels (the SDK's own rule). The script also prints the
scorecard's own score so a formula drift is visible instead of silent.

Usage: python tools/arc_layered_score.py RUN_DIR_OR_SCORECARD [...]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path


def level_score(baseline: int, actions: int, completed: bool) -> float:
    if not completed or actions <= 0:
        return 0.0
    return min((baseline / actions) ** 2 * 100, 115.0)


def game_score(baselines: list[int], actions: list[int], levels_completed: int) -> float:
    weights = range(1, len(baselines) + 1)
    scores = [level_score(baseline, act, index < levels_completed)
              for index, (baseline, act) in enumerate(zip(baselines, actions))]
    total = sum(weights)
    capped = sum(weight for weight, score in zip(weights, scores) if score > 0) / total * 100 if total else 0.0
    return min(sum(weight * score for weight, score in zip(weights, scores)) / total, capped)


def scorecards(argument: Path):
    if argument.is_file():
        yield argument
        return
    yield from sorted(argument.rglob("arc-scorecard.json"))


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    print(f"{'game':<16}{'levels':<9}{'actions':<9}{'recomputed':<12}{'scorecard':<11}note")
    for argument in sys.argv[1:]:
        for path in scorecards(Path(argument)):
            card = json.loads(path.read_text(encoding="utf-8"))
            for environment in card.get("environments", []):
                for run in environment.get("runs", []):
                    baselines = run.get("level_baseline_actions") or card.get("baseline_actions") or []
                    level_actions = run.get("level_actions") or []
                    done = run.get("levels_completed", 0)
                    mine = game_score(baselines, level_actions, done) if baselines and level_actions else None
                    theirs = run.get("score")
                    note = "" if mine is None or theirs is None or abs(mine - theirs) < 0.005 else "MISMATCH: check the formula"
                    print(f"{environment.get('id', '?'):<16}{done}/{len(baselines):<7}{sum(level_actions):<9}"
                          f"{'-' if mine is None else f'{mine:.3f}':<12}{'-' if theirs is None else f'{theirs:.3f}':<11}{note}")


if __name__ == "__main__":
    main()
