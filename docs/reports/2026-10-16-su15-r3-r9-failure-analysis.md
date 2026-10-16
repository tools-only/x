# su15 r3–r9: failure pattern (2026-10-16)

Seven runs of su15 on `claude/r03b-simple-20261015`, yibu qwen3.8-27b, thinking off, no caps
(`D:/autoresearch_pi_project/runs/arc-loop-20261016/su15-r3` … `su15-r9`). su15-r9 was still running when this was
written (161 actions, 139 of level 2's 210). Numbers come from the runs' trajectories, states, memory and refiner logs
(`C:/Users/qi/tmp/r03b-simple/analyze-runs.ts`, `level-start.ts`, `memory-moves.mjs`, `refiner-aims.mjs`; output
`analysis-r3-r9.json`, `level2-start.txt`, `memory-moves.txt`, `refiner-aims.txt`). Click distance is counted from the
nearest cell that is neither background (the commonest colour) nor on the bottom bar, before the click.

## Runs

| Run | Code | Level 1 | Level 2 | Level 3 | Levels | Budget tokens (per action) | Decisions without an action |
|---|---|---|---|---|---|---|---|
| r3 | `b80023c7` | 40 actions | **done in 122** | 130, not done | 2 | 4.02M (13.8k) | 1 of 142 |
| r4 | `b80023c7` | 48, not done (killed) | — | — | 0 | 0.49M | 244 of 265 |
| r5 | `81e05c99` | 38 | 210, not done | — | 1 | 3.27M (13.2k) | 1 of 86 |
| r6 | `9bc507ef` | 66 | 210, not done | — | 1 | 2.43M (8.8k) | 1 of 85 |
| r7 | `16265c34` | 30 | 210, not done | — | 1 | 2.50M (10.4k) | 3 of 97 |
| r8b | `6e42c942` | 51 | 210, not done | — | 1 | 2.79M (10.7k) | 1 of 89 |
| r9 | `78a9069a` | **22** | running | — | ≥1 | 2.39M so far | 4 of 68 |

Human baselines (from the game): level 1 22, level 2 42, level 3 26 actions. Level budgets are five times those.

## Pattern 1 (the one that decides the run): the click's reach was never isolated

In su15 a click moves a piece to the clicked point when the point is within about 6–8 cells of it (r3 measured it on
level 1, r9 on level 2). r3 found this on level 1; r5–r8b never did, and r9 found it only after 114 actions of level 2.

**Level 1 is solvable without knowing it.** The trail's dots are spaced so that clicking the next dot (on an object,
distance 0) moves the piece along. Level-1 clicks by distance:

| Run | on an object | next to one | 2–3 away | 4–7 away | 8+ |
|---|---|---|---|---|---|
| r3 | 12 | 3 | 7 | 6 | 0 |
| r5 | 30 | 0 | 2 | 0 | 0 |
| r6 | 57 | 1 | 0 | 0 | 0 |
| r7 | 28 | 0 | 0 | 0 | 0 |
| r8b | 38 | 0 | 0 | 3 | 0 |
| r9 | 22 | 0 | 0 | 0 | 0 |

r3 clicked empty cells near the piece at #5, #11, #16–#18 ("Testing hypothesis: ACTION6 moves nearest 15-block to click
position"; "Range tests so far: Euclidean 8.49/Manhattan 12 = YES, Euclidean 10/Manhattan 10 = NO") and wrote at #13:
"ACTION6(x,y): moves nearest 15-block (3x3) to center at (x,y) if within ~10-15px range". The other runs clicked dots
and wrote rules tied to them, two of them with a negative drawn from clicks that were simply too far:
- r6 (#50): "ACTION6 on a trail cell adjacent to the 3x3 block moves the block ONE STEP along the trail".
- r7 (#66): "Clicking a 3 ADJACENT to the 15-rect moves the rect (+2,-2) along the diagonal".
- r8b (#35): "…JUMP to that cell's position… Clicking background/other non-dot cells: only removes 2 border cells (no
  block movement)".
- r9 (#59): "Click the NEXT trail dot… Clicking non-adjacent dots only fills row-63 without moving block".
- r5 measured the reach in its reasoning (#30–#34: "can move up to 3 trail dots per click (dist ~8.5)"), but the rule
  kept at the level change was "Traversing the diagonal trail… completes the level".

The fastest level 1 (r9, 22 actions, the human baseline) learned the least: one dot after another.

**Level 2 has no dots.** Blocks appear where dots are clicked and must be brought together. Clicking a block, or the cell
next to it, moves it one cell; clicks 8+ cells away do nothing. Every run but r3 took the first for the rule and the
second as confirmation that "background clicks do nothing":
- r5 (#53): "ALL blocks move (-1,-1) when clicked! Up and left by 1 pixel per click".
- r6 (#179): "Click adjacent empty cell → moves existing block 1 step toward click".
- r7 (#187): "click adjacent cell → that cell becomes new BR… Only adjacent cells work (not far cells)".
- r8b (#104): "ACTION6 on existing color-6 block cell → pushes entire block 1 cell diagonally".
- r9 (#129): "Clicking ANY 9-cell in the cluster teleports the NEAREST 6-block… Background (color 5) clicks only fill row 63".

Level-2 clicks by distance, and the cost of walking:

| Run | on an object | next to one | 2–3 away | 4–7 away | 8+ | walk steps (longest) | resets | GAME_OVER |
|---|---|---|---|---|---|---|---|---|
| r3 | 41 | 12 | 30 | 21 | 5 | 1 (2) | 8 | 0 |
| r5 | 129 | 41 | 16 | 1 | 1 | 81 (14) | 8 | 1 |
| r6 | 126 | 60 | 2 | 0 | 1 | 113 (26) | 12 | 0 |
| r7 | 188 | 4 | 0 | 0 | 2 | 132 (32) | 11 | 2 |
| r8b | 128 | 56 | 3 | 0 | 0 | 112 (16) | 9 | 1 |
| r9 (so far) | 107 | 5 | 10 | 7 | 2 | 21 (16) | 4 | 3 |

(A walk step is a click within one cell of the previous click.) One-cell walks cannot fit the level: the bottom bar
allows 32 clicks per attempt, and moving one block across the board takes 20–30 of them. The plans ran out of bar
(GAME_OVER) or were reset, and the goal tests built on them (push a block into the diamond, ACTION7, clear the dots,
fill the wall slot, surround the cluster) all missed: r5 8, r6 3, r7 0, r8b 7 goal tests on level 2, no hit.

**How r9 found it.** At #123–#128 it clicked cells of the large shape several cells from a block and saw the block jump
there ("teleports the nearest 6-block"). After a GAME_OVER (#129) and a reset it tested empty cells at growing distance
from a block, #132–#136: 1, 2, 3 and 6 cells moved it, 10 did not ("the range for MOVING a block is between 6 and 8",
#404), and quoted the new click counts while doing it. From #141 it moves blocks 5–6 cells per click. Whether it finds
level 2's goal with the 70 actions left is open.

**What the harness did not change.**
- Refinements: 98 across r3–r9; one why-line proposed a distance test (r7 at #18, level 1: "test a non-adjacent 3
  next"), none on level 2. They argued between goal ideas, the bar and stale strategies.
- Prompt sentences (r6 refiner charter; r7, r8 agent prompt): in r7 and r8b the agent did not vary click distance on
  level 2; r7's agent varied near against far and concluded "only adjacent cells work". r9 ran with r8's sentence and
  did vary distance, after the teleport observation; one run cannot say which of the three led to it.
- Replaying r8b's level-2 refinement with thinking on (two samples, 500–540 s and ~25k reasoning tokens each): more
  careful, but neither named a click a few cells from a block.
- r9's click counts: shown from the start of level 2; the first 4–7-cell click came at the 114th level-2 action, after
  the teleport observation, so the line's part in it is unclear.

## Pattern 2: the goal is slow to find even with the right mechanics

r3 knew the reach and still needed 122 actions for level 2 (baseline 42) and 16 goal tests (1 hit). It won once it read
the top-left legend as a size order (10 → 6 → 15 → 11: two blocks of one size merge into the next) and merged two 3×3
blocks (#162, predicted `level_changed=true`). On level 3 it spent all 130 actions, 21 goal tests, 0 hits, one GAME_OVER
(moving a 3×3 block into a 4×4 one), with clicks spread over every distance. With movement solved, goal inference is the
next wall, and nothing on this branch addresses it beyond the refiner's charter.

## Pattern 3: the attempt budget is spent before the hypothesis is tested

The bar (64 cells, 2 per click) ends an attempt after 32 clicks; GAME_OVER on level 2: r5 1, r7 2, r8b 1, r9 3; resets
8–12 per run. Walks of 14–32 clicks were planned in single batches; the batch stop does not fire on them because each
click moves something. Running out of bar is itself a test some refinements proposed (r5 #93, #120) before r6.

## Pattern 4: harness and control failures (fixed)

| Failure | Run | Evidence | Fix | Since |
|---|---|---|---|---|
| Decisions ending without an action, the same read repeated | r4 | 244 of 265 decisions | refuse the repeated call; only arc_action after two empty decisions (`81e05c99`) | r5–r9: ≤4 per run |
| One click repeated until the bar ran out | r6 | #1–#32, GAME_OVER | a single repeated action that changes only a line is a meter line (`16265c34`) | not seen since (r6 recomputed: line found at #4) |
| Batch stops bypassed in python | E1-B1, E1-B2 | 28 of 31 and 15 of 15 python actions without progress | python calls stop after 3 actions without progress (`51b1ae6b`) | bounded per call since; r7 still emptied the bar at #61–#66 with two such calls in a row |
| Environment step timeout | s04, E1-A2 | 90 s | 300 s (`51b1ae6b`) | none since |

## What this says about the next change

- The broken transition is in **mechanic learning on level 1**: a rule that is true only for the arguments tried (dots
  at distance 0; far clicks) is kept as the rule, and a "does nothing" from clicks beyond the reach is kept as "this kind
  of click does nothing". Level 2 is then explored from a wrong prior. Goal search (Pattern 2) is the second wall and
  matters only once this one is passed.
- Evidence for the reach being decisive: the only runs that moved blocks several cells per click (r3 from level 2's
  start, r9 from #141) are the only ones whose level-2 play looks like r3's; all others stayed in one-cell walks.
- Run-to-run spread is large (level 1 in 22–66 actions; r3 and r4 on one commit: 2 and 0 levels). A single run cannot
  show a gain; a fork of the level-2 start (several forks per arm) would measure "reach found by level-2 action N" and
  "level 2 completed" directly.
- Thinking off is the user's run setting; the one offline check (two samples) did not show the refiner finding the
  reach with thinking on. Whether the agent itself would, with thinking on, is untested.
