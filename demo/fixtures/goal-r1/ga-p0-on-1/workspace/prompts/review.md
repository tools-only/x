---
active: true
---
## Review: Level 2 (su15) — attempt 3, action #152

**What worked:**
- 4 dot-clicks → four 2x2 six-blocks. Confirmed 3×. (#61-64,#91-94,#124-127)
- Click adjacent/in block → moves it (clicked cell = BR). All directions. (#65-88,#97-105,#132-152)
- ACTION7 = UNDO last ACTION6 (free, no timer cost). (#121-122 moved block up; #128 restored dots)
- Diamond teleport at dist≤~6: clicking 9-cell moves nearest block there. (#89,#106)
- Top band (y0-9) completely blocked for all colors tested. (#96,#130,#131)

**Bottleneck:** WIN CONDITION UNKNOWN. Tested and FAILED:
- 1 block in diamond (#106) ✗
- 3/4 blocks at partner positions (#120) ✗  
- ALL 4 blocks at partner positions (#152) ✗ ← KILLS partner hypothesis
Timer: x0-11 (12 cells = 6 moves left this attempt).

**Wasted:** ~30 actions on wrong hypotheses (partner positions, diamond targeting). Repeated board states ×5.

**Test directions (next attempt after RESET):**
- test: ACTION6(33,27) with block within range — get 2nd block into diamond; if both inside triggers (level change), win = "all blocks in diamond"
- test: move one block to OVERLAP top band y9 boundary — tests if blocks can enter top band zone and what happens
- test: ACTION6(33,27) then ACTION6(33,27) again — two consecutive diamond clicks; tests if stacking blocks at same spot does something
- test: move all 4 blocks to 4 corners of diamond interior (30,24),(36,24),(30,30),(36,30) via teleport — tests specific-position win
