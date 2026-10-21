Per run (levels = levels completed; defs = top-level def statements in the parent's python cells; re-def = a name defined again in a later cell; retyping, per cell and level: verbatim = repeats an earlier cell exactly, renumbered = the same shape with other numbers, 5-line run = retypes five or more consecutive lines of an earlier cell, long statement = reuses a 40+ character statement (numbers ignored); families = python redone with the same shape or mostly the same lines on one level, 2+/3+ calls; reads = read calls on component files; refiner edits by category).

| run | model | actions | levels | cells | cells w/ defs | distinct defs / re-defs | verbatim / renumbered / 5-line run / long statement | families 2+/3+ | saves | tools/lib/skills/agents saved | saved-tool calls | component imports | views shown (views) | component reads | refiner edits | prompt versions | tokens in/cached/out (k) | agent uncached share |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| arc-models-20261019/su15-g61-1 | gpt-6.1-sol | 206 | 4 | 17 | 0 | 0 / 0 | 0 / 0 / 0 / 0 | 0/0 | 2 | 2/0/0/0 | 0 | 0 | 0 (none) | 0 | memory 4, prompt 17 | strategy.md v18 | 5980/1055/97 | 0.85 |
| arc-lessons-20261020/su15-lr-g61 | gpt-6.1-sol | 266 | 4 | 5 | 0 | 0 / 0 | 0 / 0 / 0 / 0 | 0/0 | 0 | 1/0/0/0 | 0 | 0 | 0 (none) | 0 | memory 4, prompt 18 | lessons.md v6, strategy.md v24 | 5972/2388/75 | 0.71 |
| arc-lessons-20261020/su15-lr-1020-q38 | qwen3.8-27b | 236 | 1 | 24 | 1 | 1 / 0 | 10 / 2 / 4 / 5 | 3/3 | 0 | 0/0/0/0 | 0 | 0 | 0 (none) | 0 | prompt 28, memory 1 | strategy.md v17, rules.md v12, lessons.md v3 | 4517/14118/96 | 0.24 |
| arc-lessons-20261020/su15-lr-cb-q38 | qwen3.8-27b | 223 | 1 | 46 | 1 | 1 / 0 | 17 / 0 / 4 / 7 | 2/2 | 0 | 1/0/0/0 | 0 | 0 | 157 (state) | 0 | prompt 21, memory 5, tool 1 | rules.md v15, strategy.md v22, lessons.md v10 | 4062/9862/98 | 0.28 |
| arc-lessons-20261020/su15-lr-p13-q38 | qwen3.8-27b | 84 | 1 | 47 | 1 | 1 / 0 | 23 / 0 / 8 / 11 | 2/2 | 0 | 0/0/0/0 | 0 | 0 | 0 (none) | 0 | prompt 31, memory 3 | rules.md v25, strategy.md v4, lessons.md v3 | 2607/3731/71 | 0.39 |
| arc-chm-20261020/su15-chm-q38-1 | qwen3.8-27b | 110 | 0 | 128 | 0 | 0 / 0 | 70 / 15 / 3 / 9 | 5/3 | 0 | 1/0/0/0 | 0 | 0 | 68 (state_view) | 0 | memory 3, prompt 8, tool 3 | strategy.md v10, rules.md v3, review.md v6 | 3040/13297/85 | 0.18 |
| arc-models-20261019/su15-g61-2 | gpt-6.1-sol | 151 | 2 | 59 | 0 | 0 / 0 | 0 / 3 / 0 / 5 | 3/1 | 1 | 1/0/0/0 | 2 | 0 | 0 (none) | 2 | memory 6, prompt 15 | rules.md v2, strategy.md v15 | 1960/384/98 | 0.83 |
| arc-models-20261019/su15-g56-1 | gpt-5.6-sol | 281 | 1 | 12 | 0 | 0 / 0 | 0 / 0 / 0 / 0 | 0/0 | 0 | 1/0/0/0 | 0 | 0 | 81 (piece_view) | 0 | prompt 16, memory 1, tool 1 | strategy.md v16 | 4449/559/96 | 0.89 |
| arc-models-20261019/su15-g56-2 | gpt-5.6-sol | 238 | 1 | 11 | 0 | 0 / 0 | 0 / 0 / 0 / 1 | 0/0 | 2 | 2/0/0/0 | 0 | 0 | 0 (none) | 1 | prompt 18, memory 6 | strategy.md v21 | 4491/457/108 | 0.90 |
| arc-models-20261019/su15-q38-1 | qwen3.8-27b | 267 | 2 | 173 | 0 | 0 / 0 | 0 / 4 / 10 / 15 | 6/5 | 0 | 1/0/0/0 | 0 | 0 | 0 (none) | 0 | prompt 25, memory 3, tool 1 | strategy.md v28, rules.md v2 | 5839/18810/205 | 0.23 |
| arc-models-20261019/su15-q38-2 | qwen3.8-27b | 231 | 1 | 149 | 0 | 0 / 0 | 11 / 4 / 1 / 12 | 8/6 | 0 | 1/0/0/0 | 0 | 0 | 218 (boxpos) | 0 | memory 4, prompt 19, tool 2 | rules.md v3, strategy.md v13 | 4812/12299/144 | 0.27 |
| arc-models-20261019/su15-q38-3 | qwen3.8-27b | 110 | 0 | 84 | 0 | 0 / 0 | 0 / 1 / 3 / 12 | 1/1 | 0 | 1/0/0/0 | 0 | 0 | 106 (diff) | 0 | tool 1, prompt 12, memory 1 | strategy.md v9, rules.md v3 | 1808/3932/62 | 0.31 |

Per level (the level the cell ran on, counted from 1):

| run | level | cells | cells w/ defs | distinct defs | re-defs (names) | verbatim / renumbered / 5-line run / long statement | families 2+/3+ (largest) | refiner edits | prompt versions saved on the level |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| su15-g61-1 | 1 | 5 | 0 | 0 | 0 | 0 / 0 / 0 / 0 | 0/0 | memory 2 | none |
| su15-g61-1 | 2 | 1 | 0 | 0 | 0 | 0 / 0 / 0 / 0 | 0/0 | prompt 2 | strategy.md×2 |
| su15-g61-1 | 3 | 1 | 0 | 0 | 0 | 0 / 0 / 0 / 0 | 0/0 | prompt 1 | strategy.md×1 |
| su15-g61-1 | 4 | 9 | 0 | 0 | 0 | 0 / 0 / 0 / 0 | 0/0 | prompt 12, memory 2 | strategy.md×13 |
| su15-g61-1 | 5 | 1 | 0 | 0 | 0 | 0 / 0 / 0 / 0 | 0/0 | prompt 2 | strategy.md×2 |
| su15-lr-g61 | 2 | 1 | 0 | 0 | 0 | 0 / 0 / 0 / 0 | 0/0 | prompt 1 | lessons.md×1, strategy.md×1 |
| su15-lr-g61 | 4 | 2 | 0 | 0 | 0 | 0 / 0 / 0 / 0 | 0/0 | prompt 9, memory 1 | lessons.md×2, strategy.md×11 |
| su15-lr-g61 | 5 | 2 | 0 | 0 | 0 | 0 / 0 / 0 / 0 | 0/0 | prompt 7, memory 1 | lessons.md×2, strategy.md×11 |
| su15-lr-1020-q38 | 1 | 3 | 0 | 0 | 0 | 0 / 0 / 0 / 1 | 0/0 | prompt 2 | strategy.md×1, rules.md×1 |
| su15-lr-1020-q38 | 2 | 21 | 1 | 1 | 0 | 10 / 2 / 4 / 4 | 3/3 (7: `g = grid`) | prompt 26, memory 1 | strategy.md×16, rules.md×11, lessons.md×3 |
| su15-lr-cb-q38 | 1 | 4 | 1 | 1 | 0 | 0 / 0 / 0 / 0 | 0/0 | prompt 2 | rules.md×1, strategy.md×1 |
| su15-lr-cb-q38 | 2 | 42 | 0 | 0 | 0 | 17 / 0 / 4 / 7 | 2/2 (15: `purple = [(x,y) for y in range(64) for x in range(64) if gr…`) | prompt 19, memory 5, tool 1 | rules.md×14, strategy.md×21, lessons.md×10 |
| su15-lr-p13-q38 | 1 | 3 | 0 | 0 | 0 | 0 / 0 / 0 / 0 | 0/0 | prompt 10, memory 1 | rules.md×5, strategy.md×3 |
| su15-lr-p13-q38 | 2 | 44 | 1 | 1 | 0 | 23 / 0 / 8 / 11 | 2/2 (15: `g = grid`) | prompt 21, memory 2 | rules.md×20, strategy.md×1, lessons.md×3 |
| su15-chm-q38-1 | 1 | 128 | 0 | 0 | 0 | 70 / 15 / 3 / 9 | 5/3 (49: `g = grid`) | memory 3, prompt 8, tool 3 | strategy.md×10, rules.md×3, review.md×6 |
| su15-g61-2 | 1 | 25 | 0 | 0 | 0 | 0 / 0 / 0 / 3 | 0/0 | memory 5, prompt 4 | rules.md×2, strategy.md×3 |
| su15-g61-2 | 2 | 13 | 0 | 0 | 0 | 0 / 2 / 0 / 1 | 1/1 (3: `a=history.grid(68); b=history.grid(69); d=[(x,y,a[y][x],b[y…`) | prompt 5 | strategy.md×5 |
| su15-g61-2 | 3 | 21 | 0 | 0 | 0 | 0 / 1 / 0 / 1 | 2/0 (2: `a=history.grid(96); b=history.grid(97); print([(x,y,a[y][x]…`) | prompt 6, memory 1 | strategy.md×7 |
| su15-g56-1 | 1 | 4 | 0 | 0 | 0 | 0 / 0 / 0 / 0 | 0/0 | 0 | none |
| su15-g56-1 | 2 | 8 | 0 | 0 | 0 | 0 / 0 / 0 / 0 | 0/0 | prompt 16, memory 1, tool 1 | strategy.md×16 |
| su15-g56-2 | 1 | 6 | 0 | 0 | 0 | 0 / 0 / 0 / 1 | 0/0 | prompt 2, memory 2 | strategy.md×2 |
| su15-g56-2 | 2 | 5 | 0 | 0 | 0 | 0 / 0 / 0 / 0 | 0/0 | prompt 16, memory 4 | strategy.md×19 |
| su15-q38-1 | 1 | 67 | 0 | 0 | 0 | 0 / 1 / 7 / 11 | 3/2 (33: ``) | prompt 6, memory 1 | strategy.md×3, rules.md×2 |
| su15-q38-1 | 2 | 64 | 0 | 0 | 0 | 0 / 3 / 3 / 4 | 2/2 (47: ``) | prompt 9, tool 1, memory 2 | strategy.md×12 |
| su15-q38-1 | 3 | 42 | 0 | 0 | 0 | 0 / 0 / 0 / 0 | 1/1 (39: ``) | prompt 10 | strategy.md×13 |
| su15-q38-2 | 1 | 44 | 0 | 0 | 0 | 1 / 4 / 0 / 4 | 3/2 (3: `print("Trying ACTION6(20,30)...")`) | memory 1, prompt 5, tool 1 | rules.md×1 |
| su15-q38-2 | 2 | 105 | 0 | 0 | 0 | 10 / 0 / 1 / 8 | 5/4 (8: `diff=[(x,y,prev_grid[y][x],grid[y][x]) for y in range(64) f…`) | prompt 14, tool 1, memory 3 | rules.md×2, strategy.md×13 |
| su15-q38-3 | 1 | 84 | 0 | 0 | 0 | 0 / 1 / 3 / 12 | 1/1 (5: `prev = history.grid(0)`) | tool 1, prompt 12, memory 1 | strategy.md×9, rules.md×3 |

Missing sources (reported, not counted as zero):
- su15-g61-1: python_calls.jsonl, observer_runs.jsonl, call_points.jsonl; cells from pi-events.jsonl
- su15-lr-g61: python_calls.jsonl, observer_runs.jsonl, call_points.jsonl; cells from pi-events.jsonl
- su15-lr-1020-q38: python_calls.jsonl, observer_runs.jsonl, call_points.jsonl; cells from pi-events.jsonl
- su15-lr-cb-q38: python_calls.jsonl, call_points.jsonl; cells from pi-events.jsonl
- su15-lr-p13-q38: python_calls.jsonl, observer_runs.jsonl, call_points.jsonl; cells from pi-events.jsonl
- su15-chm-q38-1: python_calls.jsonl, call_points.jsonl; cells from pi-events.jsonl
- su15-g61-2: python_calls.jsonl, observer_runs.jsonl, call_points.jsonl; cells from pi-events.jsonl
- su15-g56-1: python_calls.jsonl, call_points.jsonl; cells from pi-events.jsonl
- su15-g56-2: python_calls.jsonl, observer_runs.jsonl, call_points.jsonl; cells from pi-events.jsonl
- su15-q38-1: python_calls.jsonl, observer_runs.jsonl, call_points.jsonl; cells from pi-events.jsonl
- su15-q38-2: python_calls.jsonl, call_points.jsonl; cells from pi-events.jsonl
- su15-q38-3: python_calls.jsonl, call_points.jsonl; cells from pi-events.jsonl
