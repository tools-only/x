# Review follow-up audit: generated tables

Written by tools/arc_review_followup_audit.py; the reading is in docs/reports/2026-10-26-review-followup-audit.md.

Runs with review turns: 28 (20 forks). Unique review turns: 74 (stall 49, level 25); copies of fork prefixes counted once.
By model: qwen3.8-27b 66, nvidia/nemotron-3.5-super-vl:free 4, gpt-6.1-sol 4.

## 1. Did the turn produce its review file?

| outcome | stall | level |
|---|---|---|
| file written | 41 | 17 |
| consult-first refusal | 6 | 2 |
| tool-call limit | 0 | 1 |
| no write of the file | 2 | 2 |
| no tool call in the turn | 0 | 3 |

## 2. Loop-level costs named (labelled by the reviewing agent)

Reviews with a file: 58; labelled: 58; naming at least one loop-level cost: 46 (stall 39 of 41, level 7 of 17).
By category (a review can name several): repeat 32, belief 18, monitoring 18, perception 17, unfocused 4, stale_component 2, overhead 2, analysis 2.
A named category named again by the same run's next review: 58 of 70 (review files mostly carry their previous 'Wasted' lines forward, so this shows costs left unresolved, not new occurrences).
Reviews naming repeats, with work-memory novelty data: 22. Actions that replayed a known result: 135/436 (31%) in the 20 actions before the review, 107/301 (36%) in the 20 after; the share did not fall in 14 of 22.

## 3. What followed a named cost (agent-authored, in the turn or the window after it)

| follow-up | reviews |
|---|---|
| component | 0 |
| prose | 9 |
| none | 37 |

Every agent-authored executable component in a review turn or window (whatever the review named):

| review | path | how | when | use |
|---|---|---|---|---|
| arc-goal-admission-p0-su15-20261021/ga-p0-shadow-1#d101 | agents/analyst.md | write | turn | called/scored: {'kind': 'subagent', 'consulted': 1, 'consult_errors': 3} |
| arc-goal-admission-p0-su15-20261021/ga-p0-shadow-1#d101 | agents/analyst.md | write | turn | called/scored: {'kind': 'subagent', 'consulted': 1, 'consult_errors': 3} |
| arc-goal-admission-p0-su15-20261021/ga-p0-shadow-1#d123 | agents/analyst.md | write | turn | not used: {'kind': 'subagent', 'consult_errors': 1} |
| arc-goal-admission-p0-su15-20261021/ga-p0-shadow-1#d123 | agents/quick.md | write | turn | called/scored: {'kind': 'subagent', 'consulted': 2} |
| arc-r04-eff-su15-20261021/codex-eff-su15#d33 | agents/reviewer.md | write | turn | not used: {'kind': 'subagent', 'consult_errors': 22} |
| arc-goal-admission-r2h-20261022/R2-A#d28 | tools/row63_progress.py | write | after | shown: {'kind': 'tool', 'view': True, 'view_states_shown': 74, 'view_nonempty': 74, 'view_distinct_outputs': 28} |
| arc-lb-20261020/su15-lb-cb-q38-2#d21 | agents/reviewer.md | write | turn | called/scored: {'kind': 'subagent', 'consulted': 1, 'consult_errors': 1} |
| arc-lb-20261020/su15-lb-cb-q38#d21 | agents/reviewer.md | write | turn | not used: {'kind': 'subagent', 'consult_errors': 1} |

Agent requests for a component through refine(focus) in a review turn or window:

| review | when | repeats | request |
|---|---|---|---|
| arc-goal-admission-p0-su15-20261021/ga-p0-shadow-1#d18 | after (+10 actions) | 0 | Add a view that reports the current 3x3 color-15 block's center coordinate on the anti-diagonal (the lower one, not the top anchor at (31,5)) and its  |
| arc-goal-admission-p0-su15-20261021/ga-p0-shadow-1#d28 | after (+2 actions) | 0 | Add a view that reports the bounding box and cell count of each non-background color (6,9,10,11,15) on the current grid, plus the row-63 zero count, s |
| arc-goal-admission-p0-su15-20261021/ga-p0-shadow-1#d28 | after (+17 actions) | 0 | Add a view that reports each 2x2 c6 block's top-left corner and its Manhattan distance to the 9-diamond center (33,27), so the agent can see how many  |
| arc-goal-admission-p0-su15-20261021/ga-p0-shadow-1#d28 | after (+33 actions) | 0 | Fix the stale hyp.action6_mechanic check: it claims "exactly 2 row-63 cells changed" but fails on 52/96 moves because every ACTION6 ALSO carries objec |
| arc-goal-admission-r2h-20261022/R2-A#d28 | after (+2 actions) | 0 | Add a view that reports the current active sliding block (the lower color-6 or color-15 3x3/2x2 block, not the top-left seed blocks) center coordinate |
| arc-goal-admission-r2h-20261022/R2-A#d28 | after (+2 actions) | 0 | Add a view reporting the active sliding block's center and its anti-diagonal step-distance from the 9-diamond center, so slides remaining are visible  |
| arc-goal-admission-r2h-20261022/R2-A#d28 | after (+17 actions) | 0 | Fix tools/c6_progress.py: it currently picks up the top-left c6 seed block (y1-2) instead of the active sliding block. Filter to c6 cells with y>10 on |
| arc-goal-admission-r2h-20261022/R2-A#d28 | after (+32 actions) | 1 | Fix tools/c6_progress.py: filter to c6 cells with y>10 only (exclude top-left seed block at y1-2), report each active c6 block's center and its distan |
| arc-lb-20261020/su15-lb-cb-q38-2#d21 | after (+0 actions) | 0 | Add a check to hyp.reach_circle: after each ACTION6 on a dot, verify the blue square (color 11) moved exactly one step toward the red circle center (3 |

The same refine(focus) text sent again in a review window (repeats beyond the first):

| review | repeats | request |
|---|---|---|
| arc-goal-admission-p0-su15-20261021/ga-p0-shadow-1#d123 | 18 | Update prompts/rules.md: ACTION7's effect is NOT deterministic from board state alone — #129 note says "same board+actio |
| arc-goal-admission-p0-su15-20261021/ga-p0-shadow-1#d123 | 18 | Update prompts/rules.md: ACTION7 effect is NOT deterministic from board state alone (#129 note: same board+action at #11 |
| arc-goal-admission-p0-su15-20261021/ga-p0-shadow-1#d123 | 18 | Update rules.md: ACTION7 is NOT deterministic from board state (#129 note: same board+action at #114 gave different resu |
| arc-goal-admission-r2h-20261022/R2-A#d91 | 7 | Update strategy: STOP repeating known slides (c6 block at (32-33,28-29) is AT diamond center). Test NEW hypothesis: clic |
| arc-goal-admission-r2h-20261022/R2-A#d113 | 19 | Update strategy: STOP repeating known slides (c6 block at (40-41,34-35) is being slid DOWN-RIGHT AWAY from diamond cente |
| arc-su15-chm-6f0f-20261022/su15-chm#d28 | 3 | Rewrite prompts/strategy.md for L2: merge color-10 pairs into 2x2 color-6 blocks (#64-67), then slide each block toward  |
| arc-su15-chm-6f0f-20261022/su15-chm#d28 | 5 | Update strategy.md: L2 goal is NOT sliding blocks through the diamond (drained row63, no level change). After merging th |
| arc-su15-chm-6f0f-20261022/su15-chm#d51 | 59 | Update strategy.md: L2 goal is NOT sliding blocks through the diamond (drained row63, no level change in attempts 1-3).  |

## 4. The review's own tests

listed 144, pinned 26, skipped 14, met 15, expired 4, replaced 5, open 2.

## 5. Per review

| review | model | kind | action | file | loop costs named | follow-up | tests listed/pinned/played |
|---|---|---|---|---|---|---|---|
| arc-chm-20261020/su15-chm-q38-1#d20 | qwen3.8-27b | stall | 40 | yes | repeat | none | 0/0/0 |
| arc-chm-20261020/su15-chm-q38-1#d53 | qwen3.8-27b | stall | 80 | yes | repeat | none | 0/0/0 |
| arc-goal-admission-p0-su15-20261021/ga-p0-on-1#d24 | qwen3.8-27b | stall | 50 | yes | perception | none | 4/1/1 |
| arc-goal-admission-p0-su15-20261021/ga-p0-on-1#d26 | qwen3.8-27b | level | 60 | yes | - |  | 0/0/0 |
| arc-goal-admission-p0-su15-20261021/ga-p0-on-1#d46 | qwen3.8-27b | stall | 106 | yes | perception | none | 5/1/0 |
| arc-goal-admission-p0-su15-20261021/ga-p0-on-1#d66 | qwen3.8-27b | stall | 152 | yes | belief, repeat | none | 5/1/0 |
| arc-goal-admission-p0-su15-20261021/ga-p0-on-1#d78 | qwen3.8-27b | stall | 192 | yes | repeat, belief, stale_component | prose | 4/0/0 |
| arc-goal-admission-p0-su15-20261021/ga-p0-on-1#d87 | qwen3.8-27b | stall | 206 | yes | repeat, belief, stale_component | prose | 4/0/0 |
| arc-goal-admission-p0-su15-20261021/ga-p0-on-1#d117 | qwen3.8-27b | stall | 246 | yes | - |  | 5/0/0 |
| arc-goal-admission-p0-su15-20261021/ga-p0-shadow-1#d18 | qwen3.8-27b | stall | 40 | consult-first refusal | ? |  | 0/0/0 |
| arc-goal-admission-p0-su15-20261021/ga-p0-shadow-1#d28 | qwen3.8-27b | level | 63 | consult-first refusal | ? |  | 0/0/0 |
| arc-goal-admission-p0-su15-20261021/ga-p0-shadow-1#d61 | qwen3.8-27b | stall | 103 | consult-first refusal | ? |  | 0/0/0 |
| arc-goal-admission-p0-su15-20261021/ga-p0-shadow-1#d101 | qwen3.8-27b | stall | 143 | yes | repeat, unfocused, monitoring | prose | 4/1/1 |
| arc-goal-admission-p0-su15-20261021/ga-p0-shadow-1#d123 | qwen3.8-27b | stall | 164 | yes | repeat, unfocused | none | 4/1/1 |
| arc-r04-eff-su15-20261021/codex-eff-su15#d33 | qwen3.8-27b | level | 38 | consult-first refusal | ? |  | 0/0/0 |
| arc-r04-eff-su15-20261021/codex-eff-su15#d60 | qwen3.8-27b | stall | 79 | consult-first refusal | ? |  | 0/0/0 |
| arc-r04-eff-su15-20261021/codex-eff-su15#d83 | qwen3.8-27b | stall | 119 | consult-first refusal | ? |  | 0/0/0 |
| arc-r04-eff-su15-20261021/codex-eff-su15#d99 | qwen3.8-27b | stall | 160 | consult-first refusal | ? |  | 0/0/0 |
| arc-r04-eff-su15-20261021/codex-eff-su15#d123 | qwen3.8-27b | stall | 203 | consult-first refusal | ? |  | 0/0/0 |
| arc-r3-falsification-20261022/pilot-openrouter-nemotron-zero-20261022#d17 | nvidia/nemotron-3.5-super-vl:free | stall | 16 | yes | repeat, belief | none | 3/1/1 |
| arc-r3-falsification-20261022/pilot-openrouter-nemotron-zero-20261022#d24 | nvidia/nemotron-3.5-super-vl:free | stall | 22 | yes | repeat, belief | none | 2/1/1 |
| arc-r3-falsification-20261022/pilot-openrouter-nemotron-zero-20261022#d1508 | nvidia/nemotron-3.5-super-vl:free | stall | 25 | yes | repeat, belief | none | 1/1/1 |
| arc-r3-falsification-20261022/pilot-openrouter-nemotron-zero-20261022#d1513 | nvidia/nemotron-3.5-super-vl:free | stall | 29 | yes | repeat, belief | none | 1/0/0 |
| arc-su15-chm-loop-20261023/su15-chm-loop-200#d20 | qwen3.8-27b | stall | 40 | yes | belief, repeat | none | 3/0/0 |
| arc-su15-chm-loop-20261023/su15-chm-loop-200#d44 | qwen3.8-27b | stall | 74 | yes | belief, repeat | none | 2/1/1 |
| arc-su15-chm-loop-20261023/su15-chm-loop-200#d48 | qwen3.8-27b | stall | 78 | yes | belief, repeat | none | 2/0/0 |
| arc-su15-chm-loop-20261023/su15-chm-loop-200#d52 | qwen3.8-27b | stall | 80 | no write of the file | ? |  | 0/0/0 |
| arc-su15-chm-loop-20261023/su15-chm-loop-200#d60 | qwen3.8-27b | stall | 85 | yes | belief, repeat | none | 2/0/0 |
| arc-su15-chm-loop-20261023/su15-chm-loop-200#d62 | qwen3.8-27b | stall | 85 | no write of the file | ? |  | 0/0/0 |
| arc-su15-chm-loop-20261023/su15-chm-loop-200#d69 | qwen3.8-27b | stall | 92 | yes | belief, repeat | none | 2/0/0 |
| arc-su15-chm-loop-20261023/su15-chm-loop-200#d71 | qwen3.8-27b | stall | 93 | yes | belief, repeat | none | 2/0/0 |
| runs/arc-su15-facts-on-az-qwen-high-20261023-run01#d10 | qwen3.8-27b | level | 20 | yes | - |  | 0/0/0 |
| runs/arc-su15-facts-on-az-qwen-high-20261023-run01#d43 | qwen3.8-27b | stall | 61 | yes | - |  | 4/1/1 |
| runs/arc-su15-facts-on-az-qwen-high-20261023-run01#d63 | qwen3.8-27b | stall | 101 | yes | perception, unfocused | none | 4/2/0 |
| runs/arc-su15-facts-on-az-qwen-high-20261023-run01#d72 | qwen3.8-27b | stall | 133 | yes | perception, unfocused, repeat | none | 4/1/0 |
| arc-goal-admission-baseline-6f0f-20261022/BL-A#d28 | qwen3.8-27b | level | 63 | no write of the file | ? |  | 0/0/0 |
| arc-goal-admission-baseline-6f0f-20261022/BL-B#d28 | qwen3.8-27b | level | 63 | no write of the file | ? |  | 0/0/0 |
| arc-goal-admission-r2-20261022/R2-A#d28 | qwen3.8-27b | level | 63 | no tool call in the turn | ? |  | 0/0/0 |
| arc-goal-admission-r2-20261022/R2-B#d28 | qwen3.8-27b | level | 63 | no tool call in the turn | ? |  | 0/0/0 |
| arc-goal-admission-r2h-20261022/R2-A#d28 | qwen3.8-27b | level | 63 | yes | - |  | 4/1/0 |
| arc-goal-admission-r2h-20261022/R2-A#d54 | qwen3.8-27b | stall | 100 | yes | repeat, monitoring | none | 4/1/0 |
| arc-goal-admission-r2h-20261022/R2-A#d57 | qwen3.8-27b | stall | 104 | yes | repeat, monitoring | none | 4/1/0 |
| arc-goal-admission-r2h-20261022/R2-A#d62 | qwen3.8-27b | stall | 114 | yes | repeat, monitoring | prose | 4/0/0 |
| arc-goal-admission-r2h-20261022/R2-A#d91 | qwen3.8-27b | stall | 144 | yes | repeat, monitoring, perception | prose | 3/0/0 |
| arc-goal-admission-r2h-20261022/R2-A#d101 | qwen3.8-27b | stall | 155 | yes | repeat, monitoring, perception | prose | 3/0/0 |
| arc-goal-admission-r2h-20261022/R2-A#d113 | qwen3.8-27b | stall | 166 | yes | repeat, monitoring, perception | prose | 3/0/0 |
| arc-goal-admission-r2h-20261022/R2-B#d28 | qwen3.8-27b | level | 63 | yes | - |  | 4/1/1 |
| arc-goal-admission-r2h-20261022/R2-B#d70 | qwen3.8-27b | stall | 103 | yes | monitoring | none | 4/1/0 |
| arc-goal-admission-r2h-20261022/R2-B#d72 | qwen3.8-27b | stall | 104 | yes | monitoring, belief | none | 4/1/0 |
| arc-goal-admission-r2h-20261022/R2-B#d75 | qwen3.8-27b | stall | 106 | yes | monitoring, belief | none | 4/0/0 |
| arc-goal-admission-r2h-20261022/R2-B#d103 | qwen3.8-27b | stall | 133 | yes | monitoring, perception | none | 4/1/1 |
| arc-goal-admission-r2h-20261022/R2-B#d107 | qwen3.8-27b | stall | 136 | yes | monitoring, perception | none | 4/1/1 |
| arc-goal-admission-r2h-20261022/R2-B#d115 | qwen3.8-27b | stall | 143 | yes | monitoring, perception | none | 4/1/1 |
| arc-goal-admission-r2h-20261022/R2-B#d122 | qwen3.8-27b | stall | 149 | yes | monitoring, perception | prose | 4/1/1 |
| arc-goal-admission-r2h-20261022/R2-B#d143 | qwen3.8-27b | stall | 169 | yes | monitoring, perception, repeat | none | 4/1/1 |
| arc-goal-admission-r2h-20261022/R2-B#d146 | qwen3.8-27b | stall | 171 | yes | monitoring, perception, repeat | none | 4/0/0 |
| arc-goal-admission-r2h-20261022/R2-B#d151 | qwen3.8-27b | stall | 175 | yes | monitoring, perception, repeat | none | 4/0/0 |
| arc-lb-20261020/su15-lb-cb-q38-2#d21 | qwen3.8-27b | level | 20 | yes | - |  | 4/1/1 |
| arc-lb-20261020/su15-lb-cb-q38#d21 | qwen3.8-27b | level | 20 | tool-call limit | ? |  | 0/0/0 |
| arc-lb-20261020/su15-lb0-cb-q38#d21 | qwen3.8-27b | level | 20 | yes | overhead | none | 0/0/0 |
| arc-lb-20261020/su15-lb0-cb-q38#d64 | qwen3.8-27b | stall | 60 | yes | repeat, analysis, belief | none | 0/0/0 |
| arc-lessons-20261020/su15-lr-1020-q38#d14 | qwen3.8-27b | level | 26 | yes | repeat | none | 0/0/0 |
| arc-lessons-20261020/su15-lr-cb-q38#d21 | qwen3.8-27b | level | 20 | yes | - |  | 0/0/0 |
| arc-lessons-20261020/su15-lr-g61#d19 | gpt-6.1-sol | level | 22 | yes | repeat, perception, overhead | none | 0/0/0 |
| arc-lessons-20261020/su15-lr-g61#d30 | gpt-6.1-sol | level | 34 | yes | repeat, analysis | none | 0/0/0 |
| arc-lessons-20261020/su15-lr-g61#d41 | gpt-6.1-sol | level | 54 | yes | perception | none | 0/0/0 |
| arc-lessons-20261020/su15-lr-g61#d145 | gpt-6.1-sol | level | 175 | yes | repeat, perception | none | 0/0/0 |
| arc-lessons-20261020/su15-lr-p13-q38#d37 | qwen3.8-27b | level | 57 | yes | belief | none | 0/0/0 |
| arc-r3-falsification-20261022/pilot-q38-fork63-a83#d28 | qwen3.8-27b | level | 63 | yes | - |  | 0/0/0 |
| arc-su15-chm-6f0f-20261022/su15-chm#d28 | qwen3.8-27b | level | 63 | yes | - |  | 0/0/0 |
| arc-su15-chm-6f0f-20261022/su15-chm#d51 | qwen3.8-27b | stall | 105 | yes | monitoring, belief | prose | 4/1/0 |
| arc-su15-chm-o2o6-20261022/su15-chm-o2o6#d28 | qwen3.8-27b | level | 63 | no tool call in the turn | ? |  | 0/0/0 |
| arc-su15-chm-r3-20261022/su15-chm-r3-paused-tdz-20261022-155829#d28 | qwen3.8-27b | level | 63 | yes | - |  | 0/0/0 |
| arc-su15-chm-r3-20261022/su15-chm-r3#d28 | qwen3.8-27b | level | 63 | yes | - |  | 0/0/0 |

## Runs

| run | model | fork | actions | levels | reviews | agent tools/libs | refine component requests | refiner tool edits (asked/other) |
|---|---|---|---|---|---|---|---|---|
| arc-chm-20261020/su15-chm-q38-1 | qwen3.8-27b |  | 110 | 0 | 2 | 0 | 0 | 0/3 |
| arc-goal-admission-p0-su15-20261021/ga-p0-on-1 | qwen3.8-27b |  | 246 | 1 | 7 | 0 | 0 | 0/1 |
| arc-goal-admission-p0-su15-20261021/ga-p0-shadow-1 | qwen3.8-27b |  | 191 | 1 | 5 | 1 | 6 | 5/1 |
| arc-r04-eff-su15-20261021/codex-eff-su15 | qwen3.8-27b |  | 211 | 1 | 5 | 0 | 0 | 0/1 |
| arc-r3-falsification-20261022/pilot-openrouter-nemotron-zero-20261022 | nvidia/nemotron-3.5-super-vl:free |  | 29 | 0 | 4 | 0 | 1 | 0/0 |
| arc-r3-falsification-20261022/pilot-q38-fork63 | None |  | 63 | 1 | 1 | 1 | 3 | 3/0 |
| arc-su15-chm-loop-20261023/su15-chm-loop-200 | qwen3.8-27b |  | 94 | 0 | 8 | 0 | 0 | 0/0 |
| runs/arc-su15-facts-on-az-qwen-high-20261023-run01 | qwen3.8-27b |  | 133 | 1 | 4 | 0 | 0 | 0/0 |
| arc-goal-admission-baseline-6f0f-20261022/BL-A | qwen3.8-27b | yes | 63 | 1 | 2 | 1 | 3 | 3/0 |
| arc-goal-admission-baseline-6f0f-20261022/BL-B | qwen3.8-27b | yes | 63 | 1 | 2 | 1 | 3 | 3/0 |
| arc-goal-admission-r2-20261022/R2-A | qwen3.8-27b | yes | 63 | 1 | 2 | 1 | 3 | 3/0 |
| arc-goal-admission-r2-20261022/R2-B | qwen3.8-27b | yes | 63 | 1 | 2 | 1 | 3 | 3/0 |
| arc-goal-admission-r2h-20261022/R2-A | qwen3.8-27b | yes | 170 | 1 | 8 | 1 | 7 | 7/0 |
| arc-goal-admission-r2h-20261022/R2-B | qwen3.8-27b | yes | 175 | 1 | 12 | 1 | 3 | 3/0 |
| arc-lb-20261020/su15-lb-cb-q38-2 | qwen3.8-27b | yes | 49 | 1 | 1 | 0 | 1 | 0/0 |
| arc-lb-20261020/su15-lb-cb-q38 | qwen3.8-27b | yes | 30 | 1 | 1 | 0 | 0 | 0/0 |
| arc-lb-20261020/su15-lb0-cb-q38 | qwen3.8-27b | yes | 60 | 1 | 2 | 0 | 0 | 0/6 |
| arc-lessons-20261020/su15-lr-1020-q38 | qwen3.8-27b | yes | 236 | 1 | 1 | 0 | 0 | 0/0 |
| arc-lessons-20261020/su15-lr-cb-q38 | qwen3.8-27b | yes | 223 | 1 | 1 | 0 | 0 | 0/1 |
| arc-lessons-20261020/su15-lr-g61 | gpt-6.1-sol | yes | 266 | 4 | 4 | 1 | 0 | 0/0 |
| arc-lessons-20261020/su15-lr-p13-q38 | qwen3.8-27b | yes | 84 | 1 | 1 | 0 | 0 | 0/0 |
| arc-r3-falsification-20261022/pilot-q38-fork63-a83 | qwen3.8-27b | yes | 70 | 1 | 2 | 1 | 3 | 3/0 |
| arc-r3-falsification-20261022/pilot-q38-resume70-20261022 | qwen3.8-27b | yes | 71 | 1 | 2 | 1 | 3 | 3/0 |
| arc-r3-falsification-20261022/pilot-q38-resume70-uncapped-20261022 | qwen3.8-27b | yes | 71 | 1 | 2 | 1 | 3 | 3/0 |
| arc-su15-chm-6f0f-20261022/su15-chm | qwen3.8-27b | yes | 128 | 1 | 3 | 1 | 3 | 3/0 |
| arc-su15-chm-o2o6-20261022/su15-chm-o2o6 | qwen3.8-27b | yes | 86 | 1 | 2 | 1 | 3 | 3/0 |
| arc-su15-chm-r3-20261022/su15-chm-r3-paused-tdz-20261022-155829 | qwen3.8-27b | yes | 63 | 1 | 2 | 1 | 3 | 3/0 |
| arc-su15-chm-r3-20261022/su15-chm-r3 | qwen3.8-27b | yes | 99 | 1 | 2 | 1 | 3 | 3/0 |
