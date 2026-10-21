=== arc-lessons-20261020/su15-lr-g61 prompts/lessons.md v1 (level 2)
1. Win found on action 22 (after one reset): repeated ACTION6 clicks six cells up-right moved the 3×3 color-15 player; click (46,17) entered the orange disk and transitioned.
2. Literal (level 1 only): move from (4,59) via (10,53),(16,47),(22,41),(28,35),(34,29),(40,23) to (46,17), near disk center (48,15). Pattern candidate: navigate a locally movable piece into an orange destination, not the top color swatch.
3. Progress came from reachable clicks. Distant clicks failed; six-cell diagonal jumps worked. Vacated dots restored to color 3. ACTION7 reversed earlier moves, plausibly undo, not advance. Bottom bar shrank on clicks.
4. Wasted: repeated ACTION7/no-ops, unsupported directional guesses, clicking the top swatch, and not chaining the first successful movement sooner. Inspect exact differences rather than guessing centers.
5. Level 2 candidates: (a) route a spawned player into orange disk—first click a color-10 dot and inspect; (b) connect scattered dots in local hops—click a neighboring dot after selection; (c) choose a piece/color using top-left swatches—click color-15 swatch (9,1) and inspect for selection/spawn, then a dot. Treat level-1 navigation as a candidate, not a rule.

=== arc-lessons-20261020/su15-lr-g61 prompts/lessons.md v2 (level 3)
1. Win found on level action 12 (#34), with no reset: after fusing four color-10 dots into two color-6 pieces, moving/fusing them into color-15 pieces, then color-11, ACTION6(33,31) entered the orange destination and transitioned.
2. Literal (level 2 only): combine pairs of color-10 dots into color-6, combine the color-6 pieces into color-15, combine those into color-11, then move the 4×4 color-11 piece to (33,31), the lower edge of the orange target. Pattern candidate: progressively merge matching pieces and deliver the resulting piece to orange.
3. Progress came from clicking visible colored pieces and nearby reachable positions. ACTION6 supports local six-cell moves and automatic same-color fusion; the color sequence 10→6→15→11 was decisive. Predict level change only on the final target entry.
4. Wasted: no major waste this level. Earlier waste was ACTION7/no-op testing, distant clicks, swatch clicks, and repeated reads; do not assume level-1 routing or ACTION7 applies.
5. For level 3 candidates: (a) merge matching colored pieces through a color sequence, then enter orange—click one visible colored dot and inspect fusion; (b) route a single movable piece through marked dots to orange—click the nearest colored piece and a reachable waypoint; (c) select a top-left swatch to spawn/activate a piece—click one swatch, then inspect the board; (d) connect or cover the orange/9 target with a shaped piece—move the nearest colored object into its edge. Level 2’s merge chain is only a candidate, not a rule.

=== arc-lessons-20261020/su15-lr-g61 prompts/lessons.md v3 (level 4)
1. Win found on level action 20 (#54), no reset: fused/positioned two resulting pieces, then ACTION6(9,47) delivered the second into the left orange disk while the first occupied the right.
2. Literal (level 3 only): merge color-10 dots into color-6, merge into color-15 and then color-11; place color-11 in the right orange disk and color-15 in the left disk. Pattern candidate: complete multiple marked destinations with progressively merged pieces.
3. Progress came from ACTION6 local moves and automatic same-color fusion. Building pieces first, then routing them around each other to the two disks worked. A final target entry caused transition; predict it explicitly.
4. Wasted: one misplanned route click at (28,41), which stopped a then-chain; speculative assumptions about exact piece centers and fusion timing. No reset or repeated reads this level. ACTION7 was not tested and remains unproven.
5. For level 4 candidates: (a) repeat merge-and-deliver to orange—click a visible color-10 dot and inspect; (b) route separate existing pieces to marked destinations—move the nearest colored piece toward a disk; (c) activate a top-strip swatch to spawn/select—click one swatch and inspect; (d) use ACTION7 as undo/reversal—try only after a deliberate ACTION6 move and compare the piece position. Level 3’s merge chain is only a candidate, not a rule.

=== arc-lessons-20261020/su15-lr-g61 prompts/lessons.md v4 (level 4)
1. Win found on level action 20 (#54), no reset: after building two pieces, ACTION6(9,47) delivered the second into the left orange disk while the first occupied the right.
2. Literal (level 3 only): merge 10→6→15→11; place 11 in the right orange disk and 15 in the left. Pattern candidate: merge pieces, then fill multiple marked destinations.
3. ACTION6 local moves and same-color fusion drove progress; route pieces around each other and predict the final target entry.
4. Wasted: one bad route click stopped a then-chain; guesses about centers. No reset/read waste. ACTION7 remains unproven.
5. Level 4 candidates: (a) merge then deliver to orange—click a visible 10 dot; (b) route separate pieces to disks—move a nearby piece toward one; (c) click a top swatch to spawn/select, then inspect; (d) test ACTION7 as undo only after an ACTION6 move. Level 3’s chain is not a rule.

=== arc-lessons-20261020/su15-lr-g61 prompts/lessons.md v5 (level 5)
1. Win found on level action 121 (#175), after 5 attempts and 4 resets: built color-11 from four color-10 pairs (10→6→15→11), routed it down-left, then ACTION6(5,57) entered the marked orange disk.
2. Literal (level 4 only): place the fused color-11 piece in the lower-left orange disk at (5,57). Pattern candidate: merge matching pieces into a required final color, then deliver to a marked destination.
3. Progress came from rapid local ACTION6 fusion and steering: central/left pairs became 6, two 6s became 15, two 15s became 11, then the 11 followed six-cell routes to the disk. ACTION7 undid broad damage and enabled recovery, but was not progress itself. The moving color-7 hazard required evacuation and exact current footprints.
4. Wasted: four resets after hazard collisions; repeated attempts to fuse or route while leaving pieces in the hazard path; guesses about obsolete coordinates; testing a color-6 in the red disk and remote clicks. Repeated reads and ACTION7 loops delayed the successful fast build.
5. For level 5 candidates: (a) merge matching pieces then deliver final color to an orange mark—click the nearest pair; (b) route an existing piece to a marked destination—move the nearest colored piece one local step; (c) avoid/redirect a moving hazard—click background only after noting its motion; (d) test ACTION7 as undo after one purposeful move. Level 4’s chain is only a candidate, not a rule.

=== arc-lessons-20261020/su15-lr-g61 prompts/lessons.md v6 (level 5)
1. Win found on level action 121 (#175), after 5 attempts/4 resets: built 11 from 10→6→15→11, routed it down-left, then ACTION6(5,57) entered the orange disk.
2. Literal (level 4 only): place fused 11 in lower-left orange disk (5,57). Pattern candidate: merge matching pieces to a required final color, then deliver it to a mark.
3. Rapid local ACTION6 fusion and steering progressed: 10→6→15→11, then six-cell routes to the disk. ACTION7 undid broad damage but was not progress. The moving 7 required evacuation and fresh footprints.
4. Wasted: four resets after hazard collisions; routing/fusing while pieces stayed in its path; obsolete coordinates; testing color-6 in red disk and remote clicks. ACTION7 loops delayed the fast build.
5. Level 5 candidates: (a) merge then deliver final color—click nearest pair; (b) route an existing piece to a mark—move nearest piece locally; (c) avoid/redirect a moving hazard—click background only after noting motion; (d) test ACTION7 as undo after one purposeful move. Level 4’s chain is not a rule.

=== arc-lessons-20261020/su15-lr-1020-q38 prompts/lessons.md v1 (level 2)
# Level 1 lesson (completed by #26)

## How win was found
Walked the 3x3 blue square (15) up the green(3) diagonal trail one cell per ACTION6 click, from endpoint (10,53) to (44,19). At #26 clicking (44,19) — the last trail cell adjacent to the red blob's green core — changed 293 cells = level cleared. Took 26 actions (first ~8 were probing).

## Win condition
- Literal (level 1 only): move the lone movable blue square along the connected dotted trail until it reaches the trail end that touches the red blob; the final placement onto the blob-adjacent trail cell completes the level.
- Pattern: a single piece must be carried along a marked path to its terminal node next to a target object; reaching the terminus triggers the clear.

## What moved progress
Only ACTION6 clicks ON trail cells (color 3) advanced the square. Each valid step changed exactly 18 cells (square leaves old 3x3, lands on new 3x3). Clicking non-trail cells (blob, empty, other square) did nothing or only filled the bar.

## Wasted actions
- #1,#7 clicked the red blob (bar-only, no info).
- #3,#8 clicked the second blue square twice (changed=0, repeated).
- #4,#5 probed ACTION7 before knowing it was undo.
- Predicted the win too late: only the very last then-step guessed level_changed; should have flagged "reaching blob core" as the trigger earlier.

## Level 2 candidates (test first)
1. Same pattern: carry a square along the white-dot(10) path to the red blob. Move: ACTION6 on a dot near the blob; if square moves, walk it to the blob edge.
2. Top squares (6=purple@5-6,1-2; 15=blue@9-10,1-2; 11=green@13-14,1-2 & 30-33,3-6) are pieces to place onto specific slots. Move: ACTION6 on each, see which relocates.
3. Dots (10) form a path: connect them by placing pieces so they line up. Move: ACTION6 on a dot, observe square movement.
4. Red blob (9) center (33,27) is the goal target; bring a piece there. Move: ACTION6 on blob, watch for change.

=== arc-lessons-20261020/su15-lr-1020-q38 prompts/lessons.md v2 (level 2)
# Level 1 lesson (cleared by #26)

## Win found
Walked the lone 3x3 blue square (15) up the green(3) diagonal trail, one ACTION6 click per cell, from endpoint (10,53) to (44,19). Clicking (44,19) — last trail cell touching the red blob's core — changed 293 cells = clear. 26 actions (~8 were probing).

## Win condition
- Literal (L1 only): carry the movable square along the dotted trail to the terminus adjacent to the red blob; final placement clears.
- Pattern: one piece carried along a marked path to its terminal node next to a target object.

## What moved progress
Only ACTION6 clicks ON trail cells (color 3) advanced the square; each valid step changed exactly 18 cells. Non-trail clicks (blob/empty/other square) did nothing or only filled the bar.

## Wasted
#1,#7 clicked blob (bar-only); #3,#8 clicked 2nd square twice (changed=0); #4,#5 probed ACTION7 before knowing it was undo; flagged the win trigger too late.

## L2 candidates (test first)
1. Same pattern: carry a square along white-dot(10) path to red blob. Move: ACTION6 on a dot near blob; if square moves, walk to blob edge.
2. Top squares are pieces to place in slots: purple(6)@5-6,1-2; blue(15)@9-10,1-2; green(11)@13-14,1-2 & 30-33,3-6. Move: ACTION6 on each, see which relocates.
3. Dots(10) form a path to connect. Move: ACTION6 on a dot, watch for movement.
4. Red blob(9) center ~(33,27) is goal; bring a piece there. Move: ACTION6 on blob, watch change.

=== arc-lessons-20261020/su15-lr-1020-q38 prompts/lessons.md v3 (level 2)
# Level 1 lesson (cleared by #26)

## Win found
Walked the lone 3x3 blue square (15) up the green(3) diagonal trail, one ACTION6 click per cell, from endpoint (10,53) to (44,19). Clicking (44,19) — last trail cell touching the red blob's core — changed 293 cells = clear. 26 actions (~8 probing).

## Win condition
- Literal (L1 only): carry the movable square along the dotted trail to the terminus adjacent to the red blob; final placement clears.
- Pattern: one piece carried along a marked path to its terminal node next to a target object.

## What moved progress
Only ACTION6 clicks ON trail cells (color 3) advanced the square; each valid step changed exactly 18 cells. Non-trail clicks did nothing or only filled the bar.

## Wasted
#1,#7 clicked blob (bar-only); #3,#8 clicked 2nd square twice (changed=0); #4,#5 probed ACTION7 before knowing it was undo; flagged win trigger too late.

## L2 candidates (test first)
1. Same pattern: carry a square along white-dot(10) path to red blob. Move: ACTION6 on a dot near blob; if square moves, walk to blob edge.
2. Top squares are pieces to place in slots: purple(6)@5-6,1-2; blue(15)@9-10,1-2; green(11)@13-14,1-2 & 30-33,3-6. Move: ACTION6 on each, see which relocates.
3. Dots(10) form a path to connect. Move: ACTION6 on a dot, watch for movement.
4. Red blob(9) center ~(33,27) is goal; bring a piece there. Move: ACTION6 on blob, watch change.

=== arc-lessons-20261020/su15-lr-cb-q38 prompts/lessons.md v1 (level 2)
# Lessons

## Level 1 (completed, action 20)
**Win found:** Clicked green dots along the diagonal in order from bottom-left to top-right. The level completed when the blue square reached the red circle region — specifically at dot (44,19), which was the last dot before the circle.

**Win condition (literal, level 1):** Blue 3×3 square must reach the red circle (color 9) at top-right of the diagonal. Each ACTION6 on a dot moves the square one (+2,-2) step; the level completes when the square overlaps or reaches the circle.

**Win condition (pattern):** A "travel along a path" puzzle: click successive waypoints to move an object toward a target; the level completes when the object reaches the target. The path is defined by colored dots/markers.

**What moved progress:** Identifying the diagonal dot sequence and clicking them in order. The first two actions (clicking the circle itself, then ACTION7) were exploratory but confirmed the mechanics.

**What wasted actions:** 
- #1 clicked the red circle directly (off-line) — only eroded bar, no movement.
- #2 ACTION7 with coords — no effect (ACTION7 takes no coordinates).
- Could have started clicking dots immediately after seeing the structure.

**Level 2 candidates:**
1. Same pattern: travel along a path of dots to a target. Test: find dots, click first one, see if an object moves.
2. Different mechanic: maybe ACTION7 now matters, or multiple objects move.
3. The bar erosion might be the actual goal (deplete it completely).
4. New color/object interactions not seen in level 1.

=== arc-lessons-20261020/su15-lr-cb-q38 prompts/lessons.md v2 (level 2)
# Lessons

## Level 1 (completed, action 20)
**Win:** Clicked green dots along diagonal bottom-left→top-right. Level completed when blue square reached red circle at dot (44,19).

**Pattern:** Travel-along-path: click successive waypoints to move object toward target; completes on arrival.

**Wasted:** #1 clicked circle directly (off-line, no movement); #2 ACTION7 with coords (no effect). Could have started clicking dots immediately.

**Level 2 candidates:**
1. Same travel pattern — find dots, click first, watch for movement.
2. ACTION7 may matter now or multiple objects move.
3. Bar erosion could be the goal (deplete it).
4. New mechanics not seen in level 1.

=== arc-lessons-20261020/su15-lr-cb-q38 prompts/lessons.md v3 (level 2)
# Lessons

## Level 1 (completed, action 20)
**Win:** Clicked green dots along diagonal bottom-left→top-right. Level completed when blue square reached red circle at dot (44,19).

**Pattern:** Travel-along-path: click successive waypoints to move object toward target; completes on arrival.

**Wasted:** #1 clicked circle directly (off-line, no movement); #2 ACTION7 with coords (no effect). Could have started clicking dots immediately.

## Level 2 (GAME_OVER at action 52)
**Mechanic:** White dots → purple blocks (click dot = convert + remove nearest dot). Purple blocks move (-1,-1) per click toward red circle. Bar erodes 2 cells/click.

**Why it failed:** Moved one block all the way across (15 clicks!) instead of prioritizing closest blocks. Bar ran out before all blocks reached circle. Total needed ~62 clicks but bar only allows 32.

**Key insight:** May need a different strategy — perhaps not ALL blocks need to reach circle, or ACTION7 has a useful function in L2, or there's a shortcut mechanic.

**Level 3 candidates:**
1. Same travel pattern with tighter budget awareness.
2. ACTION7 may be critical (test early).
3. Fewer objects / shorter paths.
4. Different win condition entirely.

=== arc-lessons-20261020/su15-lr-cb-q38 prompts/lessons.md v4 (level 2)
# Lessons

## Level 1 (completed, action 20)
**Win:** Clicked green dots along diagonal. Blue square reached red circle at dot (44,19).

**Pattern:** Travel-along-path: click waypoints to move object to target; completes on arrival.

**Wasted:** #1 clicked circle directly; #2 ACTION7 with coords. Both no-ops.

## Level 2 (GAME_OVER at action 52)
**Mechanic:** White dots → purple blocks (click = convert + remove nearest dot). Purple blocks move (-1,-1)/click toward red circle. Bar erodes 2/click.

**Why failed:** Moved one block 15 clicks across the grid instead of prioritizing closest. Bar ran out (~32 max clicks) before all blocks reached circle (~62 needed).

**Insight:** May not need ALL blocks in circle, or ACTION7 has a function, or different mechanic applies.

**L3 candidates:** Same travel pattern w/ budget awareness; test ACTION7 early; fewer objects; different win condition.

=== arc-lessons-20261020/su15-lr-cb-q38 prompts/lessons.md v5 (level 2)
# Lessons

## Level 1 (completed, action 20)
**Win:** Clicked green dots along diagonal. Blue square reached red circle at dot (44,19).

**Pattern:** Travel-along-path: click waypoints to move object to target; completes on arrival.

**Wasted:** #1 clicked circle directly; #2 ACTION7 with coords. Both no-ops.

## Level 2 (GAME_OVER at action 52 AND 86)
**Mechanic:** White dots → purple blocks (click = convert + remove nearest dot). Purple blocks move (-1,-1)/click ALWAYS (not toward circle — just up-left). Bar erodes 2/click.

**Why failed (both attempts):**
- Attempt 1 (#21-52): Converted all 8 dots, moved block from (18,37) which moves AWAY from circle. Wasted 15 clicks.
- Attempt 2 (#53-86): Same mistake — converted (18,37) first, moved it 15 clicks away. Then converted (41,37) and (49,54) but ran out of bar.

**KEY INSIGHT:** Blocks move (-1,-1) unconditionally. Only dots to the LOWER-RIGHT of circle (x>37,y>31) create blocks that approach it. Dots at (18,37),(14,55),(16,57) create blocks that move AWAY. NEVER convert those.

**L3 candidates:** Same travel pattern w/ budget awareness; test ACTION7 early; fewer objects; different win condition.

=== arc-lessons-20261020/su15-lr-cb-q38 prompts/lessons.md v6 (level 2)
# Lessons

## Level 1 (completed, action 20)
**Win:** Clicked green dots along diagonal. Blue square reached red circle at dot (44,19).

**Pattern:** Travel-along-path: click waypoints to move object to target; completes on arrival.

**Wasted:** #1 clicked circle directly; #2 ACTION7 with coords. Both no-ops.

## Level 2 (GAME_OVER at actions 52, 86, 119)
**REVISED MECHANIC (#110):** White dots→purple blocks (click=convert+remove nearest dot). Purple blocks move (-1,-1)/click. When a block reaches the red circle, it's ABSORBED (turns red) and a BLUE 3×3 SQUARE spawns below the circle. The blue square then moves (-1,-1)/click toward a target (likely top-left marker at (9-10,1-2)).

**Why failed (all 3 attempts):**
- Attempt 1 (#21-52): Converted all 8 dots, moved wrong blocks. Bar ran out.
- Attempt 2 (#53-86): Same mistake — converted (18,37) first (moves away). Bar ran out.
- Attempt 3 (#87-119): Correctly converted (41,37) and (49,54), got blue square spawned, but bar ran out before blue square reached top-left. Total needed ≈43 clicks > 32 max.

**KEY INSIGHT:** Brute force is UNWINNABLE. Need ACTION7 (untested) or a different mechanic. Maybe bar depletion IS the win (not game over) when blue square is in play.

**L3 candidates:** Test ACTION7 early; look for shortcuts; consider that bar depletion might be the goal.

=== arc-lessons-20261020/su15-lr-cb-q38 prompts/lessons.md v7 (level 2)
# Lessons

## Level 1 (completed, action 20)
**Win:** Clicked green dots along diagonal. Blue square reached red circle at dot (44,19).

**Pattern:** Travel-along-path: click waypoints to move object to target; completes on arrival.

**Wasted:** #1 clicked circle directly; #2 ACTION7 with coords. Both no-ops.

## Level 2 (GAME_OVER at actions 52, 86, 119, 153 — STUCK after 4 attempts)
**CONFIRMED MECHANIC (#144):** White dots→purple blocks (click=convert+remove nearest dot). Purple blocks move (-1,-1)/click. When a block reaches the red circle, it's ABSORBED (turns red) and a BLUE 3×3 SQUARE spawns below the circle. The blue square then moves (-1,-1)/click.

**REJECTED win conditions:**
- All blocks in circle → NO WIN (#94,#110)
- Blue square reaches circle → NO WIN (#150-#152)
- Bar depletion → GAME_OVER (all 4 attempts)

**ONLY remaining hypothesis:** Blue square must reach top-left marker (9-10,1-2) or dot cluster (1-2,1-2). Needs ~37 clicks from spawn, but bar only allows 32 total → UNWINNABLE by brute force.

**KEY INSIGHT:** May be a hidden mechanic (ACTION7=no-op, but untested: clicking top-left marker/dot cluster/bar). If truly stuck, document findings and consider moving on — don't burn all 1805 total actions on one level.

**L3 candidates:** Test hidden mechanics early; look for shortcuts; accept some levels may be unwinnable with current knowledge.

=== arc-lessons-20261020/su15-lr-cb-q38 prompts/lessons.md v8 (level 2)
# Lessons

## Level 1 (completed, action 20)
**Win:** Clicked green dots along diagonal. Blue square reached red circle at dot (44,19).

**Pattern:** Travel-along-path: click waypoints to move object to target; completes on arrival.

**Wasted:** #1 clicked circle directly; #2 ACTION7 with coords. Both no-ops.

## Level 2 (GAME_OVER at actions 52, 86, 119, 153, 189 — STUCK after 5 attempts)
**CORRECTED MECHANIC (#144,#110 vs #154-#189):** White dots→purple blocks (click=convert+remove nearest dot). Purple blocks move (-1,-1)/click. When a block has BOTH coords INSIDE the red circle (x29-37,y23-31), it's ABSORBED (turns red) and BLUE 3×3 SQUARE spawns below circle. KEY INSIGHT: blocks that only OVERLAP the circle's edge are NOT absorbed — they pass over. Must move block FULLY INTO circle.

**REJECTED win conditions:**
- All blocks in circle → NO WIN
- Blue square reaches circle → NO WIN
- Bar depletion → GAME_OVER (all 5 attempts)

**ONLY remaining hypotheses:**
1. Win = "get one block fully into circle" (untested — previous attempts stopped at edge).
2. Blue square reaches top-left (~37 clicks > 32 max = UNWINNABLE by brute force).

**KEY INSIGHT:** May be a hidden mechanic or simpler win condition than assumed. If truly stuck, document findings and consider moving on — don't burn all 1805 total actions on one level.

**L3 candidates:** Test if "block fully in circle" wins immediately; look for shortcuts; accept some levels may be unwinnable with current knowledge.

=== arc-lessons-20261020/su15-lr-cb-q38 prompts/lessons.md v9 (level 2)
# Lessons

## Level 1 (completed, action 20)
**Win:** Clicked green dots along diagonal. Blue square reached red circle at dot (44,19).

**Pattern:** Travel-along-path: click waypoints to move object to target; completes on arrival.

**Wasted:** #1 clicked circle directly; #2 ACTION7 with coords. Both no-ops.

## Level 2 (GAME_OVER at actions 52, 86, 119, 153, 189, 222 — CONCLUDED UNWINNABLE after 6 attempts)
**FINAL MECHANIC (#144,#110):** White dots→purple blocks (click=convert+remove nearest dot). Purple blocks move (-1,-1)/click. When TWO blocks are simultaneously inside the red circle (x29-37,y23-31), one is ABSORBED (turns red) and BLUE 3×3 SQUARE spawns below circle. Blue square moves (-1,-1)/click toward top-left.

**REJECTED win conditions (all tested):**
- All blocks in circle → NO WIN
- Blue square reaches circle → NO WIN (#150-#152)
- ONE block fully in circle → NO WIN (#197: block at (34,30), both coords inside, no level change)
- Bar depletion → GAME_OVER (all 6 attempts)

**ONLY remaining hypothesis:** Blue square must reach top-left marker (9-10,1-2) or dot cluster (1-2,1-2). Needs ~37 clicks from spawn, but bar allows max 32 total → PROVABLY UNWINNABLE by brute force.

**KEY INSIGHT:** Level likely requires a hidden mechanic (teleport/shortcut) not yet discovered, OR is intentionally unwinnable within budget to test if agent recognizes dead-end and moves on. Do NOT continue brute-forcing block movements — that strategy has failed 6 times. If truly stuck, document findings and consider moving on — don't burn all 1805 total actions on one level.

**L3 candidates:** Test hidden mechanics early (specific cell clicks, secret sequences); look for shortcuts; accept some levels may be unwinnable with current knowledge.

=== arc-lessons-20261020/su15-lr-cb-q38 prompts/lessons.md v10 (level 2)
# Lessons

## Level 1 (completed, action 20)
**Win:** Clicked green dots along diagonal. Blue square reached red circle at dot (44,19).

**Pattern:** Travel-along-path: click waypoints to move object to target; completes on arrival.

**Wasted:** #1 clicked circle directly; #2 ACTION7 with coords. Both no-ops.

## Level 2 (GAME_OVER at actions 52, 86, 119, 153, 189, 222 — CONCLUDED UNWINNABLE after 6 attempts)
**FINAL MECHANIC (#144,#110):** White dots→purple blocks (click=convert+remove nearest dot). Purple blocks move (-1,-1)/click. When TWO blocks are simultaneously inside the red circle (x29-37,y23-31), one is ABSORBED (turns red) and BLUE 3×3 SQUARE spawns below circle. Blue square moves (-1,-1)/click toward top-left.

**REJECTED win conditions (all tested):**
- All blocks in circle → NO WIN
- Blue square reaches circle → NO WIN (#150-#152)
- ONE block fully in circle → NO WIN (#197: block at (34,30), both coords inside, no level change)
- Bar depletion → GAME_OVER (all 6 attempts)

**ONLY remaining hypothesis:** Blue square must reach top-left marker (9-10,1-2) or dot cluster (1-2,1-2). Needs ~37 clicks from spawn, but bar allows max 32 total → PROVABLY UNWINNABLE by brute force.

**KEY INSIGHT:** Level likely requires a hidden mechanic (teleport/shortcut) not yet discovered, OR is intentionally unwinnable within budget to test if agent recognizes dead-end and moves on. Do NOT continue brute-forcing block movements — that strategy has failed 6 times. If truly stuck, document findings and consider moving on — don't burn all 1805 total actions on one level.

**CURRENT STATE:** Fresh reset (#223), bar=64, NO ACTIONS AVAILABLE (transitional state). May need to wait for system to re-enable actions, or this is an intentional dead-end signaling the level is complete/unwinnable.

**L3 candidates:** Test hidden mechanics early (specific cell clicks, secret sequences); look for shortcuts; accept some levels may be unwinnable with current knowledge.

=== arc-lessons-20261020/su15-lr-p13-q38 prompts/lessons.md v1 (level 2)
# Level 1 lessons

## How the win was found
After GAME_OVER at #35 (filled entire bottom row y63 → all 5, levels=0), I RESET and re-ran the dot-click chain. The win fired at #57 ACTION6(44,19): changed=291 (whole grid), level_changed=true, levels=1. That was action 57 of the level (21 moves in attempt 2 after reset). The key difference from attempt 1: I clicked dots in SEQUENCE along the diagonal from the blue-square end toward the red-circle end, so the 15-square migrated step-by-step INTO the 9-diamond.

## Win condition
- Literal (level 1): Click 3-dots in order from the square-end of the anti-diagonal x+y=63 toward the circle-end; each click fills 2 bottom-row cells AND migrates the 15-square one step (+2x,-2y) along the line. When the 15-square reaches/overlaps the 9-diamond (red circle), the level completes (changed≈291, level_changed=true).
- Pattern: A "traveler" (15-square) must be guided along a path (the diagonal) to a "target" (9-diamond). Progress = sequential clicks that both fill a progress bar (bottom row) and advance the traveler. Win = traveler arrives at target, NOT progress bar full.

## What moved progress
Clicking 3-dots in the correct spatial order (square-end → circle-end). Each merge moved the square +2x,-2y.

## What wasted actions
- Attempt 1 (#1–#35): filled the bottom row by clicking dots in arbitrary order → GAME_OVER. Wasted ~35 actions learning that full-fill ≠ win.
- Repeated single-dot probes before committing to the sequence.
- Belief "fill the row wins" kept too long (until #35 proved it false).

## Level 2 candidates
1. Same pattern: guide a traveler (15-square at x9-10,y1-2?) along a path to a target (9-diamond at x29-37,y23-31). Test: click a dot near the square-end, see if square migrates toward diamond.
2. Bottom row fill is still a progress bar but not the goal. Test: ignore it, focus on moving the square.
3. New elements (11-block x30-33,y3-6, 10-dots scattered) may be obstacles or waypoints. Test: click a 10-dot, observe.
4. The 15-square might need to reach a different target than the 9-diamond. Test: track where it stops migrating.

=== arc-lessons-20261020/su15-lr-p13-q38 prompts/lessons.md v2 (level 2)
# Level 1 lessons

## Win found
GAME_OVER at #35 (filled entire bottom row y63→all 5, levels=0). RESET, re-ran dot chain in SEQUENCE from square-end toward circle-end of diagonal x+y=63. Win at #57 ACTION6(44,19): changed=291, level_changed=true, levels=1.

## Win condition
- Literal (L1): Click 3-dots in order from square-end to circle-end; each fills 2 bottom-row cells AND migrates the 15-square +2x,-2y along the line. When the square reaches/overlaps the 9-diamond (red circle), level completes.
- Pattern: Guide a "traveler" (15-square) along a path (diagonal) to a "target" (9-diamond). Progress bar (bottom row) fills as side-effect; win = traveler arrives, NOT bar full.

## What moved progress
Clicking dots in correct spatial order (square-end → circle-end). Each merge moved square +2x,-2y.

## Wasted actions
Attempt 1 (#1–#35): arbitrary-order clicks filled row → GAME_OVER. ~35 actions lost. Belief "fill row wins" kept too long.

## L2 candidates
1. Same pattern: guide 15-square (x9-10,y1-2?) along path to 9-diamond (x29-37,y23-31). Test: click dot near square-end, watch square migrate.
2. Bottom row = progress bar, not goal. Ignore it, focus on square movement.
3. New elements (11-block, 10-dots) may be waypoints/obstacles. Test: click a 10-dot.
4. Square may target something other than 9-diamond. Track where migration stops.

=== arc-lessons-20261020/su15-lr-p13-q38 prompts/lessons.md v3 (level 2)
# Level 1 lessons

## Win found
GAME_OVER at #35 (filled entire bottom row y63→all 5, levels=0). RESET, re-ran dot chain in SEQUENCE from square-end toward circle-end of diagonal x+y=63. Win at #57 ACTION6(44,19): changed=291, level_changed=true, levels=1.

## Win condition
- Literal (L1): Click 3-dots in order from square-end to circle-end; each fills 2 bottom-row cells AND migrates the 15-square +2x,-2y along the line. When the square reaches/overlaps the 9-diamond (red circle), level completes.
- Pattern: Guide a "traveler" (15-square) along a path (diagonal) to a "target" (9-diamond). Progress bar (bottom row) fills as side-effect; win = traveler arrives, NOT bar full.

## What moved progress
Clicking dots in correct spatial order (square-end → circle-end). Each merge moved square +2x,-2y.

## Wasted actions
Attempt 1 (#1–#35): arbitrary-order clicks filled row → GAME_OVER. ~35 actions lost. Belief "fill row wins" kept too long.

## L2 candidates
1. Same pattern: guide 15-square along path to 9-diamond. Test: click dot near square-end, watch square migrate.
2. Bottom row = progress bar, not goal. Ignore it, focus on square movement.
3. New elements (11-block, 10-dots) may be waypoints/obstacles. Test: click a 10-dot.
4. Square may target something other than 9-diamond. Track where migration stops.

=== arc-chm-20261020/su15-chm-q38-1 prompts/review.md v1 (level 1)

# Level 1 Review (40 actions, 2 attempts)

## What I tried & what it showed
- #1–34 (attempt 1): clicked blue circle, purple square (top), diagonal dot, then 29× background. Every main-area click = +2 bar cells; top region = no-op; ACTION7 = no-op. Filled bar to 64/64 → **GAME_OVER**. Learned the bar is a danger meter.
- #36: RESET. #37: clicked white diamond (10,53) → **20-cell change**: bottom purple square (3-5,58-60) MOVED to diamond position (9-11,52-54). This is the only non-trivial effect found.
- #38–40: re-clicked blue circle and moved purple square → only +2 bar each. No further movement.

## Bottleneck
I don't know the WIN condition. The socket move at #37 is real but I haven't found what follows it. I've been re-testing known objects (blue circle ×3, moved square) instead of exploring untested ones. The top purple square (31,5) is in the "dead" top region — clicks there do nothing, so it's likely decorative or a display.

## Wasted actions
- #6–34: 29 identical background clicks just to fill the bar (learned the loss condition but burned 29 actions).
- #38, #40: re-clicking blue circle after already knowing it only pulses + fills bar.
- #39: clicking the moved purple square — expected behavior was obvious (+2 bar).

## Untested directions
1. **Click a diagonal dot AFTER the socket move** — maybe the path activates now. Test: click (46,17), the dot nearest the blue circle. If the dot changes color/disappears or something moves along the line, that's the next step.
2. **Click the top purple square (31,5) after the socket move** — previously tested pre-move and got nothing, but state-dependent behavior is possible. If still no-op, confirm it's decorative.
3. **Click the blue circle's green center specifically (48,15 vs 47,14)** — the green 3×3 core might be a distinct target from the blue ring. Test: click (48,15) vs (46,14) (blue ring edge) and compare effects.
4. **Look for a second socket** — scan the grid for other diamond-shaped or hollow objects I may have missed. If none exist, the win may require a specific SEQUENCE: socket move → then something else.

=== arc-chm-20261020/su15-chm-q38-1 prompts/review.md v2 (level 1)

# Level 1 Review (40 actions)

## Tried & shown
- #1–34: every main-area click = +2 bar; top region no-op; ACTION7 no-op. Bar full → GAME_OVER.
- #37: clicked white diamond (10,53) → bottom purple square MOVED to diamond pos. Only non-trivial effect found.
- #38–40: re-clicked blue circle / moved square → only +2 bar. No further movement.

## Bottleneck
Unknown WIN condition. Socket move at #37 is real but I haven't found what follows. Been re-testing known objects instead of exploring untested ones. Top purple square (31,5) in dead top region — likely decorative.

## Wasted
- #6–34: 29 identical background clicks filling the bar.
- #38,40: re-clicking blue circle (known: pulse + bar).
- #39: clicking moved square (obvious +2 bar).

## Untested directions
1. **Diagonal dot AFTER socket move** — path may activate now. Test: click (46,17), nearest dot to blue circle. Watch for color change/movement along line.
2. **Top purple square (31,5) post-move** — state-dependent behavior possible. If still no-op, confirm decorative.
3. **Green center vs blue ring** — click (48,15) core vs (46,14) ring edge; compare effects.
4. **Second socket** — scan for other diamond/hollow objects. If none, win needs a SEQUENCE starting with the socket move.

=== arc-chm-20261020/su15-chm-q38-1 prompts/review.md v3 (level 1)

# Level 1 Review (40 actions)

## Tried & shown
- #1–34: main-area click = +2 bar; top region no-op; ACTION7 no-op. Bar full → GAME_OVER.
- #37: clicked white diamond (10,53) → bottom purple square MOVED to diamond pos. Only non-trivial effect.
- #38–40: re-clicked blue circle / moved square → only +2 bar.

## Bottleneck
Unknown WIN condition. Socket move at #37 is real but I haven't found what follows. Been re-testing known objects instead of exploring untested ones.

## Wasted
- #6–34: 29 identical background clicks filling the bar.
- #38,40: re-clicking blue circle (known: pulse + bar).
- #39: clicking moved square (obvious +2 bar).

## Untested directions
1. **Diagonal dot AFTER socket move** — path may activate now. Test: click (46,17), nearest dot to blue circle. Watch for color change/movement along line.
2. **Top purple square (31,5) post-move** — state-dependent behavior possible. If still no-op, confirm decorative.
3. **Green center vs blue ring** — click (48,15) core vs (46,14) ring edge; compare effects.
4. **Second socket** — scan for other diamond/hollow objects. If none, win needs a SEQUENCE starting with socket move.

=== arc-chm-20261020/su15-chm-q38-1 prompts/review.md v4 (level 1)

# Level 1 Review (80 actions, 2 attempts)

## Tried & shown
- #1–34: every main-area click = +2 bar; top region no-op; ACTION7 no-op. Bar full → GAME_OVER.
- #37: clicked white diamond (10,53) → bottom purple square MOVED to diamond pos. Only non-trivial effect found in 80 actions.
- #38–80: re-clicked blue circle (×8), diagonal dot (46,17) (×6), top purple square (31,5) (×9), moved square, background — ALL just +2 bar or no-op. Nothing new.

## Bottleneck
I don't know the WIN condition. The socket move at #37 is real but I haven't found what follows it. I've been REPEATING known objects instead of exploring untested ones. The top purple square (31,5) is confirmed dead (9 clicks, 0 change). The blue circle and diagonal dots are confirmed +2-bar-only.

## Wasted
- #6–34: 29 identical background clicks filling the bar (attempt 1).
- #44–52: 9 clicks on top purple square (all no-op).
- #56–80: repeated cycles of (46,17)+(48,15) and (31,5) — same results every time.
- Python code re-run 19× with `g = grid` — should have saved state once.

## Untested directions
1. **RESET then click diamond FIRST** (before any other click). Maybe the socket only works as the first action, and my prior clicks "locked" it. Test: RESET → click (10,53) → watch for different effect than #37.
2. **Click the blue circle's green center (48,15) vs blue ring edge (45,15)** — the 3×3 green core might be a distinct target from the ring. Compare effects.
3. **Click diagonal dots IN SEQUENCE from circle outward**: (46,17)→(44,19)→(42,21)→… one per action. Maybe completing the path triggers WIN.
4. **Click the moved purple square (10,53) then immediately click blue circle (48,15)** — two-step sequence: "select" then "activate".

=== arc-chm-20261020/su15-chm-q38-1 prompts/review.md v5 (level 1)

# Level 1 Review (80 actions)

## Tried & shown
- #1–34: main-area click = +2 bar; top region no-op; ACTION7 no-op. Bar full → GAME_OVER.
- #37: clicked white diamond (10,53) → bottom purple square MOVED to diamond pos. Only non-trivial effect in 80 actions.
- #38–80: re-clicked blue circle (×8), dot (46,17) (×6), top square (31,5) (×9), background — ALL just +2 bar or no-op. Nothing new.

## Bottleneck
Unknown WIN condition. Socket move at #37 is real but I haven't found what follows. Been REPEATING known objects instead of exploring untested ones. Top square confirmed dead (9 clicks, 0 change). Blue circle and dots confirmed +2-bar-only.

## Wasted
- #6–34: 29 identical background clicks (attempt 1).
- #44–52: 9 clicks on top square (all no-op).
- #56–80: repeated cycles of (46,17)+(48,15) and (31,5) — same results every time.

## Untested directions
1. **RESET then click diamond FIRST** — socket may only work as first action. Test: RESET → (10,53) → watch for different effect.
2. **Green center (48,15) vs blue ring edge (45,15)** — core may be distinct target from ring.
3. **Diagonal dots IN SEQUENCE**: (46,17)→(44,19)→(42,21)→… one per action. Completing path may trigger WIN.
4. **Moved square (10,53) then blue circle (48,15)** — two-step "select then activate" sequence.

=== arc-chm-20261020/su15-chm-q38-1 prompts/review.md v6 (level 1)

# Level 1 Review (80 actions)

## Tried & shown
- #1–34: main-area click = +2 bar; top region no-op; ACTION7 no-op. Bar full → GAME_OVER.
- #37: clicked white diamond (10,53) → bottom purple square MOVED to diamond pos. Only non-trivial effect in 80 actions.
- #38–80: re-clicked blue circle (×8), dot (46,17) (×6), top square (31,5) (×9), background — ALL just +2 bar or no-op.

## Bottleneck
Unknown WIN condition. Socket move at #37 is real but I haven't found what follows. Been REPEATING known objects instead of exploring untested ones. Top square confirmed dead (9 clicks, 0 change).

## Wasted
- #6–34: 29 identical background clicks (attempt 1).
- #44–52: 9 clicks on top square (all no-op).
- #56–80: repeated cycles of (46,17)+(48,15) and (31,5) — same results every time.

## Untested directions
1. **RESET then click diamond FIRST** — socket may only work as first action. Test: RESET → (10,53).
2. **Green center (48,15) vs blue ring edge (45,15)** — core may be distinct target from ring.
3. **Diagonal dots IN SEQUENCE**: (46,17)→(44,19)→(42,21)→… one per action.
4. **Moved square (10,53) then blue circle (48,15)** — two-step "select then activate".
