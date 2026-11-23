"""Render a game x attempt level heatmap from saved layered runs.

Scans the given directories for arc-scorecard.json (plus a sibling summary.json when present) and writes a single
self-contained diagnostics.html: one row per game, one cell per attempt, colour by fraction of levels completed.

Usage: python tools/arc_layered_diagnostics.py OUTPUT.html RUN_DIR [...]
"""
from __future__ import annotations

import html
import json
import sys
from collections import defaultdict
from pathlib import Path


def collect(roots: list[Path]):
    games: dict[str, list[dict]] = defaultdict(list)
    for root in roots:
        for path in sorted(root.rglob("arc-scorecard.json")):
            card = json.loads(path.read_text(encoding="utf-8"))
            summary_path = path.parent / "summary.json"
            summary = json.loads(summary_path.read_text(encoding="utf-8")) if summary_path.is_file() else {}
            for environment in card.get("environments", []):
                for run in environment.get("runs", []):
                    games[environment.get("id", "?")].append({
                        "run": path.parent.name if path.parent.name != "run1" else path.parent.parent.name,
                        "levels": run.get("levels_completed", 0),
                        "total": len(run.get("level_baseline_actions") or card.get("baseline_actions") or []) or None,
                        "actions": run.get("actions"), "score": run.get("score"),
                        "tokens": summary.get("reported_tokens"), "stop": summary.get("stop_reason")})
    return games


def cell(attempt: dict) -> str:
    total = attempt["total"] or max(attempt["levels"], 1)
    fraction = attempt["levels"] / total
    red, green = int(235 - 110 * fraction), int(120 + 115 * fraction)
    title = html.escape(json.dumps(attempt, ensure_ascii=False))
    score = "" if attempt["score"] is None else format(attempt["score"], ".2f")
    label = f"{attempt['levels']}/{total}<br><small>{score}</small>"
    return f'<td style="background:rgb({red},{green},120);text-align:center" title="{title}">{label}</td>'


def main() -> None:
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    output, roots = Path(sys.argv[1]), [Path(argument) for argument in sys.argv[2:]]
    games = collect(roots)
    width = max((len(attempts) for attempts in games.values()), default=0)
    rows = []
    for game in sorted(games):
        attempts = games[game]
        cells = "".join(cell(attempt) for attempt in attempts) + "<td></td>" * (width - len(attempts))
        rows.append(f"<tr><th style='text-align:left'>{html.escape(game)}</th>{cells}</tr>")
    head = "".join(f"<th>attempt {index + 1}</th>" for index in range(width))
    output.write_text("<!doctype html><meta charset='utf-8'><title>ARC layered diagnostics</title>"
                      "<style>table{border-collapse:collapse;font:14px sans-serif}td,th{border:1px solid #999;padding:4px 8px}</style>"
                      f"<h1>ARC layered diagnostics</h1><table><tr><th>game</th>{head}</tr>{''.join(rows)}</table>"
                      f"<p>{len(games)} games; hover a cell for the full record.</p>", encoding="utf-8")
    print(f"{output}: {len(games)} games, up to {width} attempts")


if __name__ == "__main__":
    main()
