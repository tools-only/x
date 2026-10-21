---
active: true
---
## Lessons from Level 1 (su15)

**Win condition (literal, level 1 only):** Move the 3x3 15-block from center (4,59) to (44,19) along diagonal trail x+y=63, one adjacent step per ACTION6. Gap at (10,53) filled first (click adjacent 0-diamond). Completed at step 20 = (44,19), NOT at (46,17). 21 actions total (1 gap-fill + 20 steps). No ACTION7 needed.

**Pattern for later levels:** Token moves along path toward target structure. Each move costs timer cells (bottom row y63). Path may have gaps to fill. Win = token reaches target position. Lose = timer expires (GAME_OVER).

**Mechanics:**
- ACTION6 on allowed-color (3,5,9): moves token if on adjacent path point; else erodes 2 timer cells
- Colors 4, 15, 0 block clicks entirely
- One step per click (adjacent path points only)
- Level auto-completes at target (no submit)

**Level 2 observations:** No trail of 3s. Has: diamond of 9s (center ~33,27), 8 scattered 10-dots, top band with 2x2 blocks (colors 10/6/15/11) + 4x4 of 11, bottom row timer (64 zeros). Baseline 42 actions. Need to discover mechanic.
