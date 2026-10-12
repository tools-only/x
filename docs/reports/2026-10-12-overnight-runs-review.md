# Review of the ARC runs since 2026-10-11 evening (2026-10-12)

**Scope.** Every thin ARC gameplay run after the tu93 round-5 review:
- Codex's `runs/thin-sh-r5-ls20-new-retry-20261011`, on the old code;
- the overnight campaign in `D:/autoresearch_pi_incremental_20261012/runs`:
  - baselines `b1` ls20, `b2` lp85 and `b3` vc33, on my 2026-10-12 version with the critic and analyst switched back to high reasoning (16k output, 180 s);
  - candidates `i1`, `i9`, `i13`, `i16`, `i21`, `i24`, `i28`, `i39` and `i40`, which add Codex's incremental repairs.

All runs use official ARC, yibu qwen3.8-27b with high reasoning, grid plus PNG input, ledger and critic on, a 100-action cap, and 3,600 s (`i1`: 1,800 s). The guided native Tool/Subagent diagnostics (`i12`–`i38`, 0–5 actions each) are counted only in §4.

**Method.** I re-read the raw logs rather than the campaign's own reviews. Scripts in `tmp/`:

| Script | Output |
| --- | --- |
| `profile_runs.mjs` | `tmp/overnight-profile.txt` |
| `run_details.mjs` | `tmp/overnight-details.txt` |
| `planned_steps_cost.mjs` | `tmp/overnight-steps.txt` |
| `thin_load_profile.mjs` | `tmp/overnight-load.txt` |
| `pi_timeline.mjs` | event timeline of one run |

## 1. Outcome

| Run | Game | Actions | Levels (at) | Stop | Actions/h | Reported tokens |
| --- | --- | --- | --- | --- | --- | --- |
| r5 retry | ls20 | 22 | 0 | 2 h deadline | 11 | 922k |
| b1 | ls20 | 19 | 0 | deadline | 19 | 432k |
| b2 | lp85 | 12 | 1 (#8) | deadline | 12 | 551k |
| b3 | vc33 | 15 | 1 (#15) | deadline | 15 | 538k |
| i1 | ls20 | 15 | 1 (#15) | 30 min deadline | 30 | 299k |
| i9 | ls20 | 18 | 0 | 900 s decision timeout | 22 | 449k |
| i13 | lp85 | 14 | 1 (#7) | deadline | 14 | 573k |
| i16 | ls20 | 19 | 1 (#17) | deadline | 19 | 536k |
| i21 | lp85 | 12 | 1 (#7) | deadline | 12 | 692k |
| i24 | ls20 | 19 | 1 (#19) | deadline | 19 | 555k |
| i28 | lp85 | 9 | 1 (#8) | deadline | 9 | 457k |
| i39 | lp85 | 12 | 1 (#12) | idle stall, 51 min | 14 | 374k |
| i40 | ls20 | 11 | 0 | idle stall, 33 min | 20 | 156k |

Every run ended on time, never on actions. Between 81 and 91 of the 100 budgeted actions were unused. Nine runs cleared level 1; none made progress on level 2.

Level 1 itself is not the weak part. ls20 took 15–19 actions (human baseline 22) and lp85 took 7–12 (baseline 17).

## 2. Main weakness: time per action caps every run at level 1

**Generation speed.** Output runs at about 57 tokens/s. Reasoning is 90–94% of output, at 10–21k tokens per action. A decision therefore takes 1.5–8 minutes; the median gap between actions is 80–270 s.

**What this rules out.** At this speed a one-hour run cannot reach level 2 even with perfect play:
- the level-2 baselines are 123 actions (ls20), 38 (lp85) and 18 (vc33);
- after level 1 the runs had 0–7 actions left (b2 4, i13 7, i16 2, i21 5, i24 0, i28 1, i39 0).

The 3,600 s limit is the experiment's choice; the adapter's official default is 12 h. Under any fixed wall-clock budget, though, actions per hour is the binding variable, and no change made overnight raised it.

**Where the time goes:**

1. **Executing steps the agent had already planned.**
   - 102 of 175 actions (58%) matched the next step of an active strategy's `steps`, written in an earlier decision.
   - Each of those still cost a full turn: 3.8–11.7k output tokens and 71–201 s on average (`overnight-steps.txt`).
   - New decisions cost 10–18k tokens and 150–460 s.
   - The plan cursor removed the progress-fact writes, as intended, but each planned move still costs a full model turn with re-verification. This alone is about a quarter of the playing time.
2. **Post-level review.**
   - Each level change forces a CONSOLIDATE turn: 7.7–19.2 min and 19–35k output tokens.

     | Run | Review time (min) |
     | --- | --- |
     | b2 | 11.5 |
     | i13 | 7.8 |
     | i16 | 8.6 |
     | i21 | 19.2 |
     | i24 | 17.0 |
     | i28 | 9.1 |
     | i39 | 7.7 |
   - Three reviews hit the 32,768 output limit (b2 d9, i21 d8, i24 d20/21). i24 d20 was mostly hand-parsing the new level's board.
   - The review lands right when level 2 starts and takes 15–30% of the time left. In the round-5 tu93 run the review was about 16k tokens. My change D (reviews continue after memory and may fix skills) probably lengthened it.
3. **Hand grid reading.**
   - Still 28–38% of reasoning, even though every run wrote a diff skill.
   - The skills report changes, not positions or layout, so locating objects stays manual.
   - Artifacts: 0 in every run. The agent noticed the key (e.g. i28 "should I delete the old blocks artifacts?") but never had two skills that needed to share data. This is non-use with a reason, not a defect.
4. **The RESOURCES line is read and understood, but the agent has no lever to act on it.**
   - i13 quotes it exactly: "the last 4 actions took 6m20s each, so about 5 more fit".
   - It then spends more reasoning re-planning around the time ("Let me reconsider the time budget more carefully…").
   - The only way to act faster is to think less per move.
   - Per-action reasoning was lower in the 30-minute i1 (5.9k) and the short i40 (5.4k) than in the 60-minute runs (10–21k). This is suggestive but rests on two runs.

## 3. Defects found

| # | Defect | Evidence | Origin |
| --- | --- | --- | --- |
| D1 | `steps` accepts bare `ACTION6`, which can never match `ACTION6(x,y)`. Tracking reports "no longer tracked" at the first click and the agent re-writes the plan. | i28 `strat.cycle_ccw` 18 steps, 0 followed (#4 `ACTION6(5,32)` vs `ACTION6`); i13 three plans; i21; b3 | mine (`normalizeSteps`) |
| D2 | The critic line shows "cheapest test: cheapest test: …" when the model repeats the field name. | i21 note #3 | mine (`parseCriticReply`) |
| D3 | After two failed idle recoveries the runner ends the run with `pi_failed`. A provider stall at about 00:52 UTC stopped both concurrent runs: 9 and 27 minutes of budget lost. | i39 abort 00:55:16; i40 aborts 00:55:56 and 01:02:05. The critic stream stopped at 00:59:05 after `thinking_end`, with no further event until the 360 s abort. Both runs stalled at the same moments. | runner policy, provider outage |
| D4 | The 900 s decision timeout ended i9 eleven minutes before its deadline. | i9 d19: 41k output over 2 messages, unfinished | runaway reasoning; limit not tied to time left |
| D5 | Review length: 3 of 9 post-level reviews hit the 32k output limit; the others took 8–19 min. | §2.2 | mine (change D) plus runner-forced review at level change |
| D6 | Critic with high reasoning: 7 of 15 notes empty (4 aborted at 180/360 s, 3 at the 16k length limit). | `overnight-details.txt` | Codex reverted the no-reasoning critic |
| D7 | Critic triggers on the first exploratory misses (#2, #3), when misses are expected. | i24 #2, i21 #3 | Codex's I21 (no start-up gap) plus my miss trigger |

**Not defects, but worth noting:**

- **Memory-only turns are gone.** The new runs have no decision without an action except the reviews. The old-code r5 retry had 9 such decisions out of 30, so the memory-continuation fix holds.
- **When the critic delivers, its notes are specific and grounded.** Examples: b1 #11, i9 #11, i13 #8, i16 #8, i21 #3/#12, i24 #2/#19, i39 #4. Each cites actions and names a separating observation.
  - Delivery happens 1–3 actions after the trigger.
  - Whether the agent acted on them is unverified.
- **Premature level/WIN predictions are common.** 11 of 17 failed: b1 #11, b3 #8, i1 #8, i9 #11/#17, i13 #12/#14, i16 #8, i21 #12, i24 #11, i40 #11. Goal models are often wrong the first time. The critic catches this; how fast the agent revises is not measured.

## 4. Weaknesses of the overnight campaign itself

- **Most effort went to capabilities ordinary play never used.** Native Tool/Subagent integration and lifecycle diagnostics accounted for about 11 runs of 0–5 actions plus many replays. The ordinary runs made 0 calls to `harness`, `delegate_task` or `task_resource` (3 `prompt` calls in i28).
- **Comparisons are single samples on moving candidates.** B1 ls20 scored 0 levels while candidates scored 1. But i1 (an earlier candidate, half the time) also scored 1 in 15 actions, so a level-1 completion is within run-to-run variation.
- **The critic was switched back to high reasoning (16k, 180–360 s).** That needed four replay diagnostics to get any output, and it still failed in about half the real calls.
- **Two concurrent ARC runs plus replays on one provider endpoint.** The 00:52 stall hit both final runs at once.

## 5. What would move the score (for decision; nothing implemented)

1. **Let a planned move run without a full model turn.** The agent's active strategy already holds the exact next moves. The runtime could submit them one by one while every outcome matches what the agent predicted, and return control on the first miss, level change, GAME_OVER or unexpected change.
   - This adds no field to `arc_action`; it would be a separate, agent-chosen operation (e.g. "run my steps").
   - It needs your decision: the runtime would be submitting actions the agent planned but did not confirm move by move.
   - Expected effect, from these logs: 58% of actions at about 100 s each become a few seconds each.
2. **Make the level-change review cheap and short.**
   - Option (a): don't force it at level change; let the agent review when it chooses.
   - Option (b): revert change D so the review is one memory call again, and let skill repair happen in ordinary turns.
3. **Fix D1–D3.**
   - D1: treat bare `ACTION6` as matching any click, or reject it with a message.
   - D2: strip a repeated field label.
   - D3: back off and retry on a provider stall instead of ending the run while time remains.
4. **Critic.** Return to bounded generation (no reasoning or a small reasoning budget), or accept fewer and later notes. Its useful notes are short, so the 16k-reasoning budget mostly buys aborts.
5. **For skills, the gap is positions, not changes.** Agents still locate objects by hand. A parsed layout is the natural artifact; whether to nudge the agent toward one is a prompt question, and we would keep it non-directive.
