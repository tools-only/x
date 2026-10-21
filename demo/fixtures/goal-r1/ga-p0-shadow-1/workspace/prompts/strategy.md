---
active: true
---
# Open questions
- What is the ACTUAL level-2 win? "Slide all c6 blocks to 9-diamond" REJECTED (one block reached center d9=0 at #90, no level change).
- Other transformable objects? (c15 9,1; c10 seed 1,1; diagonal 3s; 0-diamond — untested)
- Does ACTION7 ever act? (no-op #4,#39,#71)

# Key findings (level 2 attempt 1, died #98)
- Row 63 = lives bar. Every ACTION6 deletes exactly 2 trailing zeros. Empty => GAME_OVER (#33 L1, #98 L2). ~30 clicks headroom from full. COUNT EVERY ACTION6.
- Transform (#66-#69): click scattered c10 cell => grows 2x2 c6 block AND removes its paired c10 cell (slope±1 pair). All 4 pairs transformed.
- Slide (#73-#97): click cell between c6 block and 9-diamond => slides it one step toward diamond. One block reached TL(33,27) d9=0 at #90 — NO level change. Sliding to diamond is NOT the win.
- Top-left seeds (c10 x1-2, c6 x5-6, c15 x9-10, y1-2) inert when clicked (#64,#72). 9-diamond does NOT transform (#65).

# Next experiment (after RESET)
1. Do NOT slide long paths. Keep row63 above ~10 zeros.
2. Re-probe untouched objects ONE click each, watch for NON-row63 delta (transform): c15 block (9,1), c10 seed (1,1), a diagonal 3-cell, small 0-diamond if present.
3. If a single-cell transform appears, that's likely the real goal mechanic — pursue WITHOUT long slides.
4. Only after finding the transform, test whether goal = transform ALL such objects (not slide them).

# Failure modes
- Never empty row 63 (GAME_OVER). Budget is NOT the constraint — the lives
