# Independent R5 observation log

2026-10-11, Asia/Shanghai. Scope: read-only monitoring of the three original
R5 runs requested by the user. Do not modify frozen snapshots, interrupt the
experiments, replay uncertain actions, or launch replacement runs.

Live status and append-only minute snapshots are under
[`tmp/r5-monitor-20261011`](../../tmp/r5-monitor-20261011/).
The monitor writes its own artifacts only and stops after all three original
runners finish, or after its bounded 100-minute monitoring window.

## 21:27–21:31 inspection

- `thin-sh-r5-ls20-new-20261011` ended at approximately 21:12 with
  `bridge_unavailable`: five confirmed actions, 0/7 levels, 140,288 reported
  tokens, 1,431.3 seconds. The bridge log ends with the start of action 6,
  without its result. The harness records an environment timeout at 21:11:07;
  bridge close also timed out. Action 6 has an unknown outcome, not a confirmed
  failed move. This is an environment-failure sample, not evidence that the
  learning changes degraded game performance.
- Both `tu93` runners were alive. At 21:28 the new arm had seven confirmed
  actions and 181,834 completed reported tokens; the base arm had eleven and
  233,089 respectively. Both remained at level 0, with no RESET, length
  completion, critic note, or model-backtest record observed.
- The new arm authored `cellmap v1` (object-level map and current/previous
  sprite position) and `frames_traj v1` (animation-frame inspection).
  These are agent-authored interpretations, not built-in game solutions.
  At action 6 it marked `strat.map_controls` done and activated
  `strat.solve_path`, referencing `skill:cellmap` and durable path/control
  records. At actions 6 and 7 its twelve supplied cell predictions matched.
  This is a concrete recognition -> component -> semantic-use -> strategy
  transition, but not yet a correct full model or a completed level.
- No Skill was declared as a model yet. Backtest creation, counterexample
  feedback and model revision remain unobserved; non-use may be reasonable
  if the current candidate route succeeds without that investment.
- New-arm decisions 7 and 8 used 18,525 and 21,690 reasoning tokens. Low
  action throughput therefore cannot be equated with a hung runner. Current
  monitoring distinguishes active processes, completed usage, action progress,
  and an outstanding environment call.

## Comparison limits

- Both arms produce reasoning tokens, but new uses explicit `high`/Qwen format
  whereas base uses provider defaults and no declared thinking format. The
  claim that the wire-level settings are equivalent is not independently
  verified by these run-config files alone.
- The new snapshot includes multiple phases and contemporaneous tool changes;
  it is a bundle comparison, not a single-factor causal evaluation.
- The historical ls20 baseline differs in execution conditions, and its new
  arm ended through environment failure. No ls20 treatment effect can be
  inferred from this pair.
- For active runs, reported-token sums exclude unfinished provider responses.
  Partial summary files may be stale; confirmed bridge events and current
  harness records are the live source of progress.

## Deferred investigation after completion

1. Diagnose bridge action 6 without retrying it; correlate environment-call
   timing and shutdown before attributing the timeout to provider or harness.
2. Inspect semantic use of the authored map, correctness at path checkpoints,
   and the handling of the first contradictory observation.
3. Separate whether backtesting was exposed, recognized, adopted, useful, or
   reasonably not used. Do not optimize component counts as the task reward.
4. Review goal predictions, critic delivery, memory replacement and long
   reasoning against the final task outcome and total cost.

This report is separate from the other session's plan section 6 to avoid
concurrent edits. It does not change the experiment or claim net benefit.

## 21:40 user-directed changes

- `tu93-base` was stopped on request after 14 confirmed bridge actions.
  Runner PID 435496 and its exact descendant Pi/bridge processes all exited.
  [`user-stopped.json`](../../runs/thin-sh-r5-tu93-base-20261011/user-stopped.json)
  records the stop; its earlier partial summary is stale. This arm is censored,
  so it is not a full-budget comparison for `tu93-new`.
- `ls20-new` was restarted as a fresh independent run in
  [`thin-sh-r5-ls20-new-retry-20261011`](../../runs/thin-sh-r5-ls20-new-retry-20261011/).
  Frozen extension SHA-256 `cf56ce7909133485414fd49047bb2a632840867d4f1aab954011d9d45f79fb30`
  matches the original failed run. Config: yibu/qwen3.8-27b, `thinking=high`,
  `thinking_format=qwen`, text input, ledger and critic on, consolidation every
  25 actions, up to 150 actions, 3M reported tokens and 7,200 seconds. The
  runner launched as PID 440840. The original unknown sixth action was not
  retried on its old bridge or treated as a confirmed observation.
- The read-only monitor now tracks all four run directories and recognizes
  the requested `tu93-base` stop separately from a crash.

## 21:54 new result and review delivery failure

- `tu93-new` cleared level 0 at confirmed action 22. This is real task
  progress; the stopped `tu93-base` reached only action 14, so there is no
  same-budget result yet and no causal comparison from this pair.
- Its critic calls at decisions 22 and 24 each consumed the configured
  2,000 output tokens entirely as reasoning and stopped with `length`.
  `critic.jsonl` records two notes with empty `lines` and no `shown` row.
  The main Agent continued to act. Thus a triggered review produced no
  semantic feedback; this is a critic output-budget/delivery problem, not
  a main Agent length recovery failure. Do not change the frozen run midstream;
  after completion, inspect output budget, thinking policy and the parser.
- The independent `ls20` retry confirmed three actions and was still on
  level 0 at this checkpoint.

## 22:07 continuing watch

- `tu93-new` reached action 26 and remained at level 1. A third critic call
  produced an empty note after exhausting its 2,000 output tokens; the parent
  continued normally. The critic delivery failure is repeated and should be
  assessed separately from level progress.
- `ls20-new-retry` remained at action 4 for more than eleven minutes while
  decision 5 made several completed provider calls and authored additional
  observation Skills. Its latest completed usage was at about 22:03; no
  harness or environment error had been logged by 22:07. This is a stall
  alert, not yet proof of an idle timeout or unknown action. Keep the
  canonical run untouched and inspect its final stop condition.

## 22:17 status refinement

- The `ls20` retry's long decision did return normally: action 5 was
  confirmed at about 22:11 and action 6 at about 22:16, with no main Agent
  length or environment error. The action 4→5 interval cost substantial
  reasoning and multiple Skill/tool messages; investigate efficiency after
  the run, but do not classify that interval as a hang.
- `tu93-new` has stayed at confirmed action 26 and level 1 for over ten
  minutes. Completed usage rose to at least 635,508 reported tokens, and the
  runner remained alive. The latest visible provider calls include repeated
  messages within decision 31; there is no confirmed environment request in
  flight. This is a task-progress stall warning, not a diagnosed provider
  failure. Its three empty critic notes remain a separate issue.

## 22:32 critic delivery failure reproduced on ls20

- Both active new-code runs reproduced the same critic failure. On the ls20
  retry at action 11, the critic response consumed exactly 2,000 output tokens
  as reasoning, stopped with `length`, and produced `lines=[]`. It was not
  shown to the parent. On tu93, four reviews had the same empty-result
  signature by action 28. Main Agent requests continued normally.
- The broken transition is triggered review -> semantic critic text -> parent
  delivery. Code may invoke the critic on schedule, but the current provider
  configuration can spend its entire small output allotment on reasoning.
  Post-run fix should address this bounded output/continuation behavior and
  re-test meaningful review delivery without adding an action prescription.

## 22:49 tu93-new final result

- The real-provider `tu93-new` run ended at its 7,200-second deadline with
  31/31 actions confirmed by the bridge, 1/9 levels completed, 845,758
  reported tokens, no main Agent length stop, idle timeout or environment
  error. Its first level cleared at action 22 with a matching positive
  level-change prediction. It later entered the next level, encountered
  a collision, and used one RESET while retaining level 1.
- The parent autonomously authored `cellmap` and `frames_traj`, and used
  the map in a goal-directed path that cleared level 0. No Skill was declared
  as a model, and `model_checks.jsonl` stayed empty. Thus the backtest service
  was available but autonomous model authoring and replay were not observed.
- Critic: four calls/notes, zero lines kept, zero shown. All exhausted the
  2,000-token output allowance in reasoning, consuming 54,015 reported
  tokens in total. This is a real semantic delivery failure, even though
  the task made some progress without usable critic output.
- `tu93-base` was deliberately stopped after 14 actions, so the new result
  has no comparable full-duration baseline. It is evidence of task success
  and agent-authored Skill use on this run, not a causal improvement estimate.

## 22:59 ls20 retry second long decision

- The ls20 retry reached action 15, level 0, then spent more than ten minutes
  without a new confirmed environment action. Within decision 21 it made
  multiple provider requests and authored/invoked `audit_run` v1; two
  completed calls in that decision alone reported 30,511 and 37,556 tokens.
  `audit_run` recorded successful executions, but successful execution is not
  evidence that its interpretation or subsequent action is correct. No main
  Agent length or environment error had appeared by this checkpoint.
- This repeats the high-token, low-action-throughput pattern seen at actions
  4→5. The correct post-run question is which work was required to distinguish
  game hypotheses and which was repeated analysis of existing evidence.

## tu93-new completed-run diagnosis

Read-only analysis of the frozen real ARC / yibu qwen3.8-27b run; no runtime
changes or new experiments. Configuration says high; the recorded Qwen wire
policy sets `enable_thinking=true`, `reasoning_effort=null` (do not infer a
separately enforced high effort level). Sources are the run's `summary.json`
and `harness/{trajectory,memory,skills,observations,working_set,usage,critic}.jsonl`,
plus `pi-events.jsonl`.

### Task progress and evidence limits

- 31 confirmed actions, 1/9 levels, 845,758 reported tokens, 7,202.9 seconds.
  Deadline interrupted the next parent turn; its unfinished usage is unknown.
  The summary's Pi-turn timeout is not evidence of another bridge failure.
- First level: 6 control-learning actions followed by a 16-action route;
  cleared at action 22 versus this game's human baseline of 19 (15.8% more).
  The agent-created map was semantically used in solving that level.
- Final registry has three Skills, four saved versions: cellmap v1,
  frames_traj v1, enemy_hist v2. This supplements the earlier two-Skill
  description. Four explicit Skill runs and 125 observation evaluations are
  different counters; neither measures correctness or benefit by itself.
- No declared model Skill or model-check artifact. Historical reuse DID occur
  through enemy_hist; lack of predictive backtest adoption does not mean lack
  of a history API or lack of retrospective analysis.
- Baseline was user-stopped at 14 actions. Autonomous map/history Skill use and
  one-level success are observed; general net improvement and five-component
  lifecycle acceptance remain unverified.

### Confirmed weaknesses and broken transitions

1. **Novel-object reasoning narrowed too early.** Before action 23,
   hyp.l2_eight asserted the 8-block was passable/possibly collectible because
   it occupied the only route. Necessity of eventual crossing does not imply
   immediate safe crossing: moving hazards, timing, and conditional access
   remain alternatives. At action 26 the enemy moved onto the player's landing
   cell and caused GAME_OVER, before the planned action-27 object-contact test.
   Earlier pixel predictions mostly covered the player's own movement.
2. **Skill validity was recognized but not repaired.** After the level change,
   cellmap's fixed origin (15,15), 11x11 bounds missed sprite/goal; the new map
   used (12,21), 13x5. frames_traj used the old coordinate origin too.
   fact.skill_l2 explicitly recognized both failures and chose raw-grid reading,
   postponing revision. Both v1 Skills continued automatic output through the
   run. This is recognition -> revision/retirement failure, not evidence the
   parent blindly trusted the stale map. All frames_traj observations had empty
   `traj`; its actual output covered current/previous grids, not animation.
3. **Critic semantic delivery failed completely.** Four calls, all length,
   2,000 reasoning tokens and no final text each; 54,015 total reported tokens,
   zero shown lines. Triggers included level transition and GAME_OVER, so
   adding more triggers cannot repair the first broken transition. Main Agent
   length=0 does not mean system-wide length is solved. Summary failed=0 masks
   these unusable reviews.
4. **Bookkeeping limits obstructed counterexample handling.** At the first
   death, one atomic memory write tried to reject old beliefs and add enemy
   rivals; it was wholly refused because it would hold 11 hypotheses (max 8).
   The retry combined timer/chase rivals into one hypothesis. There were also
   two Skill source errors from literal backslash-n line separators and one
   `Tool memory not found` during recovery. The frozen runner can expose only
   arc_action after a tool-only decision; this failure needs a scoped surface
   audit before assigning all delay to the model. Three actual memory calls
   used `replaces`; stale-belief retirement was not entirely absent.
5. **Competition eventually produced an informative test, too slowly.** Death
   at 22:06:35 -> RESET at 22:24:11 (17m36s); action 31 at 22:46:00 moved into
   a safe pocket on the fourth post-reset turn. Enemy remained stationary,
   contradicting the specific position-independent fourth-turn timer model.
   This does not prove chase as the only rule. The final parent turn was cut
   off; no completed memory update after this counterexample is recorded.
   Keep that incompleteness separate from refusal to revise a belief.
6. **Manual perception/prediction and resident memory remain costly.** The
   parent completed 101 memory writes and 13 deletes. Memory averaged 7,007
   chars, 46.1% of measured working-set section characters, peaking at 10,810;
   this percentage excludes tool schemas/system text and is not token share.
   Movement rules and routes remained prose plus manually authored pixel
   predictions rather than executable predictive Skills. Errors include old
   background color, marker coordinates, FINISHED versus level transition,
   and RESET incorrectly predicting level_changed=true. The latter is counted
   as a goal-check miss despite not being a win attempt.

Completed parent request totals by pre-action phase: control learning 149,382;
first-level route 266,827; second-level pre-death 118,792; death-to-RESET 135,547;
post-RESET 121,195. Critic adds 54,015. These sum to 845,758 and include reported
cache accounting; reasoning is included in output, not added again. Recovery
cost cannot all be attributed to tool errors: it includes useful history
analysis, rival formulation, and the RESET decision. Nevertheless only 31/150
actions were used before the wall-clock limit, with substantial token budget
remaining. Throughput and timely rule acquisition are the binding bottlenecks.

### Priorities for a subsequent authorized optimization

- Repair bounded Critic output/continuation and surface empty reviews as
  incomplete; retain reasoning and strategy/hypothesis review scope.
- Separate durable hypothesis storage from compact resident views so capacity
  management does not reject counterexample transactions. Audit forced-action
  tool hiding and source-encoding repair without removing integrity checks.
- Make revising or deselecting an existing observation Skill a short path;
  retain agent ownership of geometry, object interpretation, and predictive
  rules. No project-authored enemy detector or game-specific hint is proposed.
- Reuse the existing Skill creation path for optional executable predictions
  and historical checks. Measure time to a discriminating test and subsequent
  progress, not number of models or components. A simple first-level route may
  justify no backtest; uncertain enemy dynamics is a stronger opportunity.
- Relevant deferred work is semantic component use and cognitive continuity
  across task/level changes. It remains open; adding registry entries or
  preserving data alone does not close it. These are proposals, not changes
  applied to either frozen run.
