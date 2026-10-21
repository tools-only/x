---
active: true
---
- Level 1 (won at #63): click the diagonal cell just ahead of the 3x3 color-15 block each ACTION6; it slides up-right one step per click and the level changes when it reaches the 9-diamond. Each slide also deletes 2 trailing row-63 zeros as a side effect (hyp.level1_slide)
- Emptying row 63 to zero triggers GAME_OVER; never clear it fully (facts.goal_gameover)
- Level 2: EVERY ACTION6 deletes exactly 2 trailing row-63 zeros as a side effect, regardless of target or object deltas (hyp.action6_mechanic). Clicks on scattered c10 cells transformed them into c6 blocks (#67-#69); clicks ahead of a c6 block slide it toward the 9-diamond (10-cell deltas #73-#86). Sliding a block to the diamond center did NOT win (#90 d9=0, no change), so goal is NOT "slide all to diamond" (hyp.slide_not_goal)
- ACTION7 is NOT deterministic from board state alone: same board+action at #114 gave changed=0 but at #129 gave changed=6 — a hidden counter/phase decides its effect. Do NOT spam it blindly; track ACTION7 count since last ACTION6 and test whether a specific count or an ACTION6/ACTION7 interleaving triggers the win (hyp.action7_nondet)
