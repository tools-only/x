# Why `pi-arc-thin-critic-hypstrategy-ls20-real-20261011` cleared no level (2026-10-11)

Run: `runs/pi-arc-thin-critic-hypstrategy-ls20-real-20261011`, started 16:35 from the live tree (extension `cac66dcf`).
- Settings: `ls20`, qwen3.8-27b, **thinking off (sent as `enable_thinking: false`)**, review every 4 actions, ledger and critic on, 100 actions, 1.2M reported-token cap, 1,800 s.
- Ended by the token cap after 68 actions, 0 levels, 987 s.

Digest: [tmp/hs-story.txt](../../tmp/hs-story.txt) (made by `tmp/thin_run_story.mjs`), load profile [tmp/hs-load.txt](../../tmp/hs-load.txt).

## Where the 68 actions went

| Phase | Actions | What |
| --- | --- | --- |
| Learning the four controls | #1–#50 (74%) | 15 RESETs, single-action trials from a "clean baseline", the same trials repeated |
| Goal attempts | #51–#64 (16) | moving the block up into the two boxes at the top; no level change |
| Rethinking | #65–#68 | reset again; the token cap ends the run |

- **Level/WIN predictions: 0.** No goal was ever tested by a prediction the game could check.
- **RESETs: 15 of 68 actions.** Each one discards position and progress.

## Causes, most important first

1. **No reasoning, so no running model of the state.** With reasoning off, the agent cannot keep track of where things are across a sequence of moves. It compensates by resetting before every experiment and diffing against frame 0. A single fact therefore costs 2–3 actions, and earlier conclusions are tested again:
   - "A1 vertical" was tested at #23, #34, #40–#43, #51–#55 and #57–#62;
   - A3 alone was tested at #14–#15, #19–#20 and #29–#32.

   Reasoning-on runs learned the same controls in 3 actions (P048 #1–#3) and in 4 (round 4). This run is direct evidence for your point that switching reasoning off does not solve the problem.
2. **Perception errors at the pixel level, with no correction loop.**
   - A1 was read as "extends the pattern up" rather than moves it.
   - A2 was "minimal" because it is a no-op when the block is at the bottom; that took until #48 to work out.
   - The cells the RESET itself changed were read as A2's effect (#44, "58 cells", retracted at #45).
   - Blocked moves (#26/#27, #32, #38) became "axis dependence" and "boundaries" instead of "walls stop the block".

   The diff skill took five versions within the first four actions, and its pixel output still had to be interpreted by a model that was not reasoning.
3. **Goal never formed or tested.**
   - `hyp.goal_right` stayed a vague open claim for the whole run.
   - The only goal tests were "move the block into box A/B" (#51–#64), each a 5–9-action route with no level/WIN prediction.
   - After the miss at #64 the agent reset (#67) rather than recording a goal refutation.
4. **The critic spent its notes on a label.**
   - 15 notes, all shown, 133k tokens.
   - Seven of them (#24, #28, #33, #39, #44, #46, #48) repeat that the hypothesis name "toggle_regions" is misleading.
   - The one useful note (#22: "pivot to goal testing") was shown at decision 39. The agent kept mapping controls until #51.
5. **Tokens spent on management, not play.**
   - 102 decisions for 68 actions: 16 reviews (one every 4 actions) and 18 decisions without an action.
   - 96 memory writes, 77k characters of tool arguments (long hypothesis restatements), and a memory section of 5.1k characters at every decision.
   - About 15k input tokens per action. That is why the 1.2M cap ended the run at 68 of 100 actions.

## What this says about the next changes

- Keep reasoning on: cause 1 dominates and only reasoning fixes it.
- The goal problem (cause 3) is the same as round 4's: no level/WIN prediction for most of the run.
- The critic needs a rule against repeating a point it has already made (cause 4); it is cheap and general.
- A review every 4 actions costs a sixth of the decisions here. Round 4 (every 25) did not show the rewrite churn.
