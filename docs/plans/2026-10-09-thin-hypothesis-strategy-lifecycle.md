# Meta-harness change record: competing hypotheses and the strategies that depend on them, as one maintained set

Date: 2026-10-09 (Asia/Shanghai). Status: **implemented; real-provider evaluation not run** (a paid run needs a budget from the user).
Follows [development-workflow.md](../development-workflow.md) and the [change template](../templates/meta-harness-change.md). Builds on [thin hypothesis memory](2026-10-09-thin-hypothesis-memory.md) (same tool, same store) on the thin path ([design](2026-10-08-thin-arc-self-harness-extension.md)).

## Problem and claim

- **Gap (user, 2026-10-09).** The thin path stores competing hypotheses but does not maintain them as an evolving set or connect evidence to strategy. Five missing mechanisms:
  1. generating alternatives at consequential decisions;
  2. relations between rivals, their evidence, distinguishing tests, Harness components and resources;
  3. reassessing the affected alternatives together when evidence changes;
  4. connecting hypothesis status to the operational strategy;
  5. checking whether later behaviour follows a revision.
  Semantic judgements stay with the Agent: refuting one hypothesis does not prove another.
- **Real material.** The seven 2026-10-09 thin-hyp runs `runs/thin-hyp-{ls20-A,B,C,C2,ft09-A,B,C}-*-20261009` (yibu / qwen3.8-27b, 236 actions in total). Audit script: [tmp/hyp_lifecycle_audit.mjs](../../tmp/hyp_lifecycle_audit.mjs), output [tmp/hyp_lifecycle_audit.json](../../tmp/hyp_lifecycle_audit.json) (UTF-16, written by PowerShell).
  - Observed, all runs: **19 of 24 hypothesis deletions had no recorded refutation**; 13 had no evidence at all.
  - Observed, ls20 A, #5 ([memory.jsonl](../../runs/thin-hyp-ls20-A-baseline-20261009/harness/memory.jsonl) rows 11–19): one call marked `hyp.progressive` ("every action clears a bar column") supported and deleted `hyp.move`, `hyp.paint`, `hyp.toggle` and `hyp.cyclic`. These were hypotheses about the controls, not rivals of a bar hypothesis. `hyp.move` was correct. The same call wrote the plan "Just keep calling ACTION1 until all 11s are gone".
  - Observed, ls20 A, #11: ACTION1 changed 0 cells (the player hit a wall). The agent recorded a refutation of `hyp.progressive`, but no movement explanation was left, and the plan was rewritten within the bar frame ("10×A1, then 10×A2…").
  - Observed: `plan` / `strategy` facts were rewritten 50× (ls20 A, 74 actions) and 37× (C2, 58 actions), mostly as counters ("Remaining 11s: c23-54 = 32 columns"). Hypothesis claims were rewritten 35 of 55 writes in ls20 A, also as counters.
  - Observed: plans named no hypotheses, so no refutation could reach them mechanically.
  - Observed but rare: a refutation recorded without a status change (1 of 10 refutations).
  - Not established: whether qwen would have reconsidered movement at #11 had `hyp.move` still been visible.
- **Narrow claim.** In an ordinary qwen3.8-27b ls20 run, these four changes reduce removals of untested alternatives and make a refuted premise change what the agent does next:
  - questions scope rivalry, and each strategy names its premises;
  - deleting an untested rival leaves a one-line note;
  - a rejected or deleted premise suspends the active strategy that depends on it;
  - a REVISIONS line shows the action mix and the linked components after the change.
  The measured effects are (a), (b) and (c) in the protocol below. No harm to task progress is part of the claim.
- **Burden removed.**
  - Rival bookkeeping is structural, not re-derived from free text each decision.
  - One `tests` item records a test against all its rivals, instead of N per-hypothesis evidence entries.
  - Suspending the dependent strategy and listing what it used costs no extra call.
  - The agent no longer has to remember what it changed and whether it acted on it.
- **Falsified if** (bounded protocol below):
  - no `question` or `strategies` written in 150 actions;
  - deletions without refutation stay ≥ 70% (baseline 79%);
  - after a premise rejection or suspension, the next 8 actions use the same action set as the 8 before as often as without the change;
  - memory refusals rise by more than 3 per 100 actions;
  - reported tokens per decision rise by more than 25% with none of the above improving.
- **Scope.** Thin path only: `demo/arc_thin_memory.ts`, the memory tool and working set in `demo/arc_thin_extension.ts`, `demo/prompts/arc_thin_system.md`, and the consolidation prompt and stats in `src/autoresearch_pi/arc_thin_e2e.py`. No new tool, worker, model call, action gate or reminder turn. Ledger, critic, board and legacy extension unchanged.

## Design and cost

**Choice.** Extend the existing `memory` tool and `memory.jsonl` store rather than add a hypothesis tool, a reviewer, or an automatic reassessment call. A runtime-initiated reassessment call (critic-style) was considered and rejected. In the ls20 C2 run ([critic.jsonl](../../runs/thin-hyp-ls20-C2-critic-20261009/harness/critic.jsonl)) the critic spoke at #14 and #55 and the parent kept its plan. It would also add a model call per evidence change. The mechanism stays data plus receipts.

### Mapping to the five gaps

| Gap | Mechanism | Who advances it | Runtime does (mechanical) | Agent decides (semantic) |
| --- | --- | --- | --- | --- |
| 1 Alternatives at commitment | `strategies=[{key:"strat.<name>", plan, depends_on, uses, status}]`; activating one returns each premise with its rivals or "no recorded rival". Marking a hypothesis supported lists the rivals still open. Rejecting one lists who remains, "does not confirm them", or "no live hypothesis left for Q: propose the next alternatives". | Agent commits; runtime answers in the same receipt | List rivals by `question`; never infer rivalry from text | Whether to add a rival; what it is |
| 2 Relations and resources | `question` on hypotheses (same question = rivals). Strategy `depends_on` (validated hypothesis keys) and `uses` ("skill:<name>", "memory:<key>", "prompt"; unknown refs ignored and reported, not refused). Per strategy: actions while active (`since`, `spent`). SKILLS shows `[used by strat.x (status)]`. | Agent declares; runtime keeps and computes | Validate keys, count actions, keep links across deletes ("(deleted)") | Which premises and components are relevant |
| 3 Coordinated reassessment | `tests=[{action, condition, observed, verdicts:{hyp: verdict}}]` appends one result to each named rival. Rivals of the same question not given a verdict are reported (receipt) and shown ("not assessed by the rival test #n"). A refutation the agent did not act on in the same call sets status `contested` (with `contested_at`). A deleted hypothesis without a refutation stays as a one-line note under "dropped without a recorded refutation" until re-created: every note from the last 3 deleting actions, at most `MAX_HYPOTHESES` (8) lines (see Review fixes). | Agent records; runtime marks and reports | Group by question and action; set `contested`; keep notes | Verdicts; narrowing, rejecting, or restating status |
| 4 Status → strategy and Harness | Rejecting or deleting a premise suspends the active strategy that depends on it, unless the same call explicitly re-activates it. The receipt names the suspended strategy's components: "revise or delete whatever encoded the dropped premise". Activating a strategy suspends the previously active one (one active at a time). | Runtime, authorised by the agent's own `depends_on` declaration | Status change and receipt only; never edits skills, memory or prompt | Which component to revise and how; what to pursue next |
| 5 Did behaviour follow | Each call that changes course writes one revision row: causes, active before/after, and a snapshot of linked components (skill version, memory/overlay text hash). REVISIONS (last 2 within 24 actions) shows the action mix of up to 8 actions after vs. the same number before, the active strategy now, and which linked components changed since. `summary.json` `harness.lifecycle` repeats it per revision for evaluation (`same_action_set`, `new_strategy_at`). | Runtime | Counts and comparisons only | Whether the later actions were right |

### Integrity and failure behaviour

- One call is still one atomic batch. New refusals:
  - a verdict for a hypothesis that does not exist;
  - `depends_on` naming a hypothesis that does not exist;
  - two strategies activated in one call;
  - more than 4 strategies.
- Unknown `uses` are dropped with a note, not refused. Real runs showed refusals are costly: 114 of 130 tool errors in the 319-action run were memory refusals.
- The runtime never rejects a hypothesis, never infers a refutation from the game state, and never treats a refutation as support for a rival. `contested` records that a refutation exists that the agent has not acted on; it is not a verdict.
- A hypothesis created already rejected (recording a dead alternative) does not start a revision.

### Added and removed resident cost

Measured from the smoke request log with [tmp/thin_resident_cost.mjs](../../tmp/thin_resident_cost.mjs):
- System prompt: 2,044 → 2,635 chars (+591). The "Hypotheses and memory" block became "Hypotheses, strategy and memory"; the `plan`-fact advice was removed.
- Memory tool: description ≈ 420 → 820 chars; schema +1,526 chars (`question`, `tests`, `strategies`). Total memory tool 4,295 chars.
- Working set: +1 line (`STRATEGY: none …`) when unused. In use: about 2 lines per strategy, 1 line per contested or unassessed hypothesis, up to 8 dropped lines, and up to 2 REVISIONS lines (~250 chars each).
- First decision head in the smoke: 1,423 chars (previous smoke 1,228; the scripts differ, so this is not a like-for-like comparison).
- Not measured: provider tokens on a real run.
- Removed: the instruction to keep and overwrite a `plan` fact, the source of the 50 counter rewrites. Not added: tool calls, model calls, management turns, gates.

### Other notes

- **First benefit path.** One memory call with `question` on the hypotheses and one `strategies` item; nothing else is required. Every new field is optional, and the legacy forms (`key+text`, per-hypothesis `evidence`) still work.
- **Abandon/restore.** Old `memory.jsonl` rows replay unchanged. If the code is reverted, the old replay ignores `strat` and `rev` rows and treats `deleted` rows as before. Facts and hypotheses stay intact; strategies, notes and revisions disappear from view.

## Pre-run experiment protocol (not executed)

- **Target layer:** autonomous adoption, plus an exploratory signal on task effect.
- **Variable and comparator:** this change vs. the [hypothesis memory](2026-10-09-thin-hypothesis-memory.md) version, everything else equal. Freeze one commit per arm and record `run-config.json` `source_sha256`; other sessions edit the same files. Do not compare against the existing thin-hyp runs as an arm: they ran with the GBK/UTF-8 host bug (B/C) and different prompts.
- **Model and task:** yibu / qwen3.8-27b, provider-default thinking, treatment variant, `--consolidate-after 25`, ledger and critic off. At least one held-out game decides (G5, see the review below). ls20, where the #5/#11 failure occurred, and ft09 are reported as in-sample only.
- **Budget:** 150 actions per arm (`--max-actions 150`), a reported-token cap set with the user, the experiment timeout. Exploratory: one run per arm per game. Confirmation: ≥3 per arm, rotated order.
- **Primary metrics:**
  - (a) Removal of untested alternatives: share of hypothesis deletions without a recorded refutation (baseline 19/24 = 79%), from `harness.lifecycle.deleted_without_refutation` / `hypotheses_deleted` and the audit script.
  - (b) Response to a refuted premise: for every revision with `next_actions` ≥ 5, whether `same_action_set` is false or `new_strategy_at` ≤ `at` + 5. Plus a hand audit, blind to arm, of whether the next actions served a remaining rival or a new test. Baseline: the same hand audit on comparable plan rewrites in arm A, because the old store has no revision rows.
  - (c) Use: the share of hypotheses with a `question`; the share of strategy writes with `depends_on`; `tests` with ≥2 verdicts; contested hypotheses settled within 10 actions.
  - (d) Levels and actions per level; reported tokens per decision; memory refusals by cause.
- **Negative cases to audit:**
  - wrong `question` grouping (true rivals in different questions, or non-rivals together);
  - a premise rejected for a condition-scoped reason, where suspension was premature and the agent re-activated;
  - suspension that the agent ignores while repeating the old actions;
  - the dropped-note lines crowding the view;
  - `contested` treated by the agent as "rejected".

## Implementation and verification

**Entry points.**
- [demo/arc_thin_memory.ts](../../demo/arc_thin_memory.ts): `question`, `tests`, `strategies`, `contested`, dropped notes, revision rows, `renderStrategies`, `renderRevisions`, `renderMemory`, `resetMemory`.
- [demo/arc_thin_extension.ts](../../demo/arc_thin_extension.ts): memory schema and description, `components()` context for snapshots, working set via `renderMemory`, `[used by …]` on skills.
- [demo/prompts/arc_thin_system.md](../../demo/prompts/arc_thin_system.md).
- [src/autoresearch_pi/arc_thin_e2e.py](../../src/autoresearch_pi/arc_thin_e2e.py): consolidation prompt, `harness.lifecycle` in `summary.json`, 6 new smoke checks, smoke now 4 decisions.
- [tools/arc_thin_smoke_provider.ts](../../tools/arc_thin_smoke_provider.ts): scripted lifecycle calls.

**Functional checks.**
- `node --experimental-transform-types --test tests/arc_thin_memory.test.ts tests/arc_thin_feedback.test.ts tests/arc_thin_ledger.test.ts tests/pi_arc_frame_image.test.ts`: 25/25 pass. The 5 new memory tests cover:
  - the ls20 #5 sequence (untested control hypotheses survive as notes; re-creating one removes its note; replay reproduces the state);
  - a joint test with an unassessed rival, and an atomic refusal for an unknown verdict key;
  - `contested`, and the three ways it is settled;
  - strategy premises and rivals at commit, auto-suspension with a revision snapshot, REVISIONS action mix and linked-component changes, replacement, single-active refusal;
  - an explicit re-activation override, and deleting a premise.

**Real-chain smoke** (mock ARC SDK, real bridge, real Pi, real extension and Python sandbox, scripted provider): [arc-thin-hyp-strategy-lifecycle-smoke-20261009-b](../../runs/arc-thin-hyp-strategy-lifecycle-smoke-20261009-b/summary.json), 28/28 checks pass. The first attempt ([…-20261009](../../runs/arc-thin-hyp-strategy-lifecycle-smoke-20261009/summary.json)) failed only `behaviour_after_revision_shown`: the check expected `ACTION3` but the renderer prints `ACTION3×1`. The check string was corrected and the run was repeated. The new checks verify, from the provider-side request log:
- the commit receipt lists premise rivals and ignores an unknown component;
- one test reports the unassessed rival and the untested deletion;
- rejection suspends the dependent strategy, names its components and does not confirm the remaining rival;
- the next decision's provider input shows the suspended strategy, the revision, the unchanged linked components, the dropped note and `[used by …]`;
- the decision after that shows "Active now: strat.probe. next 1: ACTION3×1 | 1 before: ACTION4×1.";
- `summary.json` `lifecycle` has the revision with `next_actions` and `new_strategy_at`.

**Regressions.**
- Ledger/critic smoke [arc-thin-hyp-strategy-lifecycle-ledger-smoke-20261009](../../runs/arc-thin-hyp-strategy-lifecycle-ledger-smoke-20261009/summary.json): passed. The critic dossier now carries STRATEGY and REVISIONS through `memoryText`.
- `pytest tests/test_cli.py tests/test_external_benchmark_cli.py`: 13 passed.

| Evidence layer | Status | Provider / environment | Artifacts and limits |
| --- | --- | --- | --- |
| Functional correctness | Pass | node unit tests; no provider | `tests/arc_thin_memory.test.ts`; pure logic, replay, rendering |
| Full-chain reachability | Pass (thin path) | Scripted provider, mock ARC SDK, real bridge / Pi / extension / sandbox | Smoke above. Not the five-component `arc-harness-smoke` closure matrix, which targets the legacy path. Proves wiring and delivery into later provider input, not use. |
| Autonomous adoption | Unverified | — | Needs the protocol above |
| Net benefit | Unverified | — | Needs paired, repeated runs |

## Review: would it have changed the motivating trajectory? (2026-10-09, same day)

This is a counterfactual reading of the stored trajectory, not an experiment.

**The motivating failure was perception, not bookkeeping.**
- ls20 A, `trajectory.jsonl` notes #1–#5: from #1 the agent described each action's effect as "swapped 9/12 colors with 3 in a region". The 52-cell change at #1 (bbox x34–38, y40–49) is consistent with a 5×5 block moving 5 rows. The feedback format gives regions over 16 cells only as a bbox and a colour histogram (`demo/arc_thin_feedback.ts`), so a translation reads as a recolouring.
- The agent therefore deleted `hyp.move` because it believed its observations had refuted it, not because it forgot an untested rival.
- Under this change, the likely call is a `tests` entry "refutes hyp.move: colours swapped, nothing moved". That makes `hyp.move` legitimately rejected and leaves no dropped note.
- At #11 the agent did record the refutation and set the status itself, so `contested` would not fire. It never rejected the premise of its grind plan, so no suspension would fire.
- Expected effect on this run: the same actions with more bookkeeping. The other ls20 runs share the misreading (see the run diagnosis: in all four ls20 arms the bar was taken as the goal and the block as a colour swap).

**ft09 was limited by time per decision** (2–9 min, 8–24k reasoning tokens). This change adds about 2.5k resident characters per request and more schema to reason over, so on ft09 the expected sign is slightly negative.

**No observed instance needs the new mechanisms.** Across the 7 thin-hyp runs and the 319-action run, I found no trajectory point where premise-driven suspension, rival grouping or REVISIONS would plausibly have changed the next action. The real failure in the 319-action run was lost conditions and revision friction, which the earlier [hypothesis memory](2026-10-09-thin-hypothesis-memory.md) already targets. The "19/24 deletions without refutation" statistic overstates the opportunity: at least the ls20 A cases were driven by misread evidence.

**Generality** (rubric in [ledger-critic-general-signals §0](2026-10-09-ledger-critic-general-signals.md)):
- G1: the schema example `hyp.bar`/`hyp.box` and the condition example "pattern did not match the target" were game-shaped. Both are now replaced with abstract examples in the schema and prompt. The unit-test fixtures reuse ls20 vocabulary (bar, box, life lost); they are test data, not runtime content, but are flagged.
- G5: the protocol above evaluates on ls20 and ft09, the motivating games, so it is in-sample. A claim of benefit needs held-out games; ls20 and ft09 results are to be reported as in-sample only.
- G6: the change adds fields and a view and removes one instruction (the `plan` fact). It is a net addition.

**Revised decision.**
- Keep the code, but do not spend the next paid run on it.
- The higher-leverage single factor is the observation representation: report a moved shape as a displacement rather than a colour histogram. That is deferred item A and the "object-motion description" deferred in the general-signals record, and it is allowed at the adapter level under G2.
- Run this change's adoption protocol, on held-out games, only after the agent's evidence readings are reliable enough for hypothesis bookkeeping to matter.
- If resident cost turns out to matter first, put `tests`/`strategies`/REVISIONS behind an opt-in flag like the ledger, rather than in the default treatment.

## Review fixes (2026-10-09, same day)

Defects found by replaying the ls20 A #1/#4/#5 memory calls through the module ([tmp/analysis/memory_counterfactual.ts](../../tmp/analysis/memory_counterfactual.ts)):
- **Dropped notes hid the motivating case.** Only the last 3 notes were shown. ls20 A #5 deleted `hyp.move`, `hyp.paint`, `hyp.toggle` and `hyp.cyclic` in that order, so `hyp.move` was the one cut. The unit test deleted only two, so it passed.
  - Now: every note from the last `DROPPED_CALLS = 3` deleting actions is shown, at most `MAX_HYPOTHESES` lines (`visibleDropped`). The replay now shows all four.
- **Prompt vs. cap.** The prompt asks for 2-4 rivals for each of "controls" and "goal" (up to 8), but the store refused more than 6 hypotheses. Memory refusals were 114 of 130 tool errors in the 319-action run.
  - Now: `MAX_HYPOTHESES = 8`, and the tool schema uses the constant.
- **Leak (G1).** The ledger's `arc_action.idea` example said "box is the goal" (part of ls20's solution). It is now "map the controls".
- **Restate path, measured rather than blocked.** A claim rewrite clears `contested` without a check; the grind framing survived its refutations this way. `summary.json` `harness.lifecycle` now reports:
  - `contested_outcomes` {rejected, narrowed, status_only};
  - `restated_with_refutation`: a refutation recorded in the same call that rewrote the claim, which never shows as contested.
  Whether a rewrite was a fair narrowing stays a blind-audit judgement.

Checks:
- `node --experimental-transform-types --test tests/arc_thin_memory.test.ts tests/arc_thin_feedback.test.ts tests/arc_thin_ledger.test.ts tests/pi_arc_frame_image.test.ts`: 27/27 pass. New tests cover a four-note batch staying whole, older batches giving way after three later deleting actions, and 4 + 4 rivals accepted with the 9th refused. The existing cap test now uses the constant.
- `pytest tests/test_arc_thin_lifecycle_stats.py tests/test_cli.py`: 10 passed. The new test covers the three contested outcomes, same-call restatement, rewrites without a refutation, and key re-creation after deletion.
- Real-chain smoke [arc-thin-hyp-lifecycle-fixes-smoke-20261009](../../runs/arc-thin-hyp-lifecycle-fixes-smoke-20261009/summary.json): all checks pass; the summary carries the new fields. The scripted provider and mock SDK make this wiring evidence only.
- Another session edited `demo/arc_thin_extension.ts` during this work. These edits are confined to the lines above.

Evidence layers are unchanged: functional and thin-path wiring pass; adoption and benefit are unverified. These fixes make the mechanism do what the record claims. They do not change the review's conclusion above that the motivating failure was a misreading of evidence.

## Delivery decision

- **Supported:**
  - the data model;
  - the mechanical transitions (rival grouping, joint tests, `contested`, dropped notes, premise-driven suspension, revision snapshots);
  - their delivery into the next decision's provider input;
  - the summary fields needed to evaluate them.
- **Not supported:**
  - that qwen3.8-27b will set `question`, write strategies with premises, or record joint tests;
  - that suspension or REVISIONS will change its next actions;
  - any task benefit.
- **Attribution limit.** This change adds five linked mechanisms at once, as requested, so a positive result attributes to the bundle. If (b) fails, ablate in this order: REVISIONS line, then auto-suspension, then dropped notes. The data model is shared and stays.
- **Decision:** keep as experimental on the thin path, as revised in the review above. This change is not the subject of the next paid run.
  - Its metrics (`harness.lifecycle`, including the review-fix fields) are recorded passively in every thin run, so any run also yields adoption data for it.
  - Its own paired protocol runs only after the agent reads its evidence reliably, and on a held-out game.
  - The order of the next runs is set in one place: the [decision-loop record](2026-10-09-thin-decision-loop-efficiency.md) "Next candidates".
- **Backlog:** [deferred-research-todos.md](../deferred-research-todos.md) §C (hypothesis → requested test → new evidence → revised conclusion) and §D (keeping key hypotheses, excluded explanations and unfinished experiments across context rebuilds). This provides carriers for both: rivals, dropped alternatives, contested status, revisions. It is not evidence of continuity or of better experiment selection; their status is unchanged.
