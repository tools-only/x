---
active: true
---
# Level 2 Stall Review (#143)

## What I tried and what each showed
- **Transform c10 pairs → c6 blocks** (#66-#69, #103-#106): Clicking scattered c10 cells grows them into 2×2 c6 blocks and removes the paired c10 cell. All 4 pairs transformed. No level change.
- **Slide c6 blocks to 9-diamond** (#73-#97, #107-#112): Clicking ahead of a c6 block slides it one step toward the diamond center (33,27). One block reached TL(33,27) d9=0 at ~#90 — **NO level change**. "Slide all to diamond" is NOT sufficient with just one block.
- **ACTION7 spam** (#122-#141): Called ACTION7 ~12 times. Effects varied: 0-18 cells changed in the diamond core, c6↔c15 transformations, blocks moving around. **No level change ever.** The #129 note proved ACTION7 depends on hidden state or the number of c6 blocks adjacent to the diamond.
- **Click c11 block / seeds / row63** (#135-#143): All returned changed=0 or only row63 deletions. Inert.

## Bottleneck (from analyst)
The goal likely requires getting **every** c6 block onto the 9-diamond simultaneously, then using ACTION7 as a "commit" action to convert them to c15. The single-block test at #90 confirmed one block isn't sufficient. ACTION7's effect depends on how many c6 blocks are currently adjacent to the diamond when called, not a hidden counter. **Critical: attempt 2 has used ~38-39 ACTION6 calls out of a ~35 budget — one or two moves from GAME_OVER again.**

## What wasted actions
- **Spamming ACTION7 blindly** (#122-#141): 12 calls with no win. Should have stopped after 3-4 and tested a different approach.
- **Re-clicking the same cells** (#135-#143): ACTION6(34,5), ACTION6(32,5), ACTION6(12,63) each clicked twice with identical results. Wasted ~6 actions.
- **Long slides** (attempt 1, #73-#97): Sliding blocks long distances wasted lives. Should have kept row63 above ~10 zeros.

## Directions not tested yet (ranked by analyst)
- test: RESET, then play ONLY ACTION7 as move #1 (fresh board, no prior ACTION6) — if it changes 0 cells → ACTION7 needs c6 blocks pre-positioned; if it changes cells → ACTION7 has an independent effect
- test: After reset: use ≤5 ACTION6 moves to slide ONE c6 block fully onto the diamond center (33,27), then immediately call ACTION7 — if the block turns c15 and stays → ACTION7 is the "commit" step
- test: If #2 works for one block: repeat for a second c6 block (≤5 more ACTION6s), then ACTION7 again — tests whether "all" means every block must be committed
- test: ACTION6 clicked directly ON the 9-diamond cell itself (around (33,27) or (34,27)) — never tested; might grow/shrink the target or open a slot
