# r04: the next version from the su15 loop and the online-correction work (plan, 2026-10-17)

Status: plan, nothing built. Base for the build: `claude/r03b-repeat-20261016` at `2b9cc6ac` (r03b + the su15 loop's
fixes). Follows [the development workflow](../development-workflow.md). Inputs: [the su15 level-2 loop](2026-10-17-su15-level2-loop.md),
the online-correction session's records (`docs/plans/2026-10-16-refinement-ledger.md` on `claude/refiner-ledger-20261016`,
`docs/plans/2026-10-17-refinement-package-loop-candidate.md` on `claude/refine-model-r03b-20261017`), and the branch
inventory below.

## Decisions this plan rests on

- **Agent-native (user, 2026-10-17).** Every component that runs inside a run uses the agent's model, qwen3.8-27b. A
  stronger model may analyze inside our development loop, between runs.
  - L2 as proposed (refinements on gpt-6.1-sol) is withdrawn as a change to the version. `ARC_REFINE_MODEL` stays on
    its branch, for offline replays only.
- **Base.** The integration line stays r03b. R1 (2026-10-16) put the r03b-simple line below it on su15, so that
  line's r2–r10 changes are not brought in.
- **Baseline.** Six full su15 runs of the unchanged agent (L0 and L1; L1 acted on 11 plays): level 1 in 5 of 6,
  level 2 in 2 of 6, level 3 in 1 of 6.
- **One factor per paid test.** Fixes that make the record correct are accepted offline. A change to what the agent
  or its refiner is shown is tested in runs.

## Jev (question of 2026-10-17)

- **What it is.** `pi-jev` 0.5.0 (in `package.json`) calls TypeSafe's hosted judge `jev-latest` (`/v1/systemone`).
  It returns typed answers to questions it is given: a category (`choice`), the probability of a yes/no statement
  (`noul`), or a score. See `docs/pi-jev-core-features-analysis-2026-10-09.md`.
  - Our only adapter, `demo/pi_jev_harness_routing.ts` (`PI_AUTORESEARCH_JEV_ROUTING`), selects Self-Harness
    components and was never switched on.
  - No TypeSafe key is configured on this machine.
- **Agent-native?** No. `jev-latest` is a third model, so inside a run it has gpt-6.1-sol's problem.
- **Would it fix what failed?** No. A judge ranks statements; it does not write them.
  - The failure is that no one proposed the missing test: the qwen refiner did in 0 of 48 replayed refinements.
  - In su15-l1-1 the qwen refiner went the other way and wrote a check for the agent's one-cell move model (#67).
  - A judge choosing among qwen's proposals chooses from a pool that lacks the test.
- **Where the typed-judgment pattern could help, run on qwen.** Narrow yes/no questions that code cannot settle:
  - did the agent play what a refinement proposed (adoption);
  - does an edit repeat a line whose expectation already failed (l0-1's refiner rewrote one goal line seven times).
  - These go to the ledger below, and would be tested by replay before being built. Not in r04.

## What the online-correction session established

- **The carrier.** The scheduled refiner, with two additions built and tested on the r03b-simple line:
  - **EXPECT:** an edit may state what the next moves should show, as a `check(t)`;
  - **the ledger:** each refinement opens with its last edits and what followed (met, contradicted or not seen;
    rewritten or deleted; tool calls; GAME_OVERs).
  - Commits `fe9dccd6` and `009b670c`, the latter making expectation checks strict about missing keys.
- **Real play on qwen** (the F2 source runs): the refiner wrote an EXPECT with every edit (9 of 9). One refinement
  rewrote a strategy because its earlier edit was not followed (src2 #77). No ledger-off comparison exists.
- **Replay.** A measurement step did not help qwen. Only gpt-6.1-sol proposed the missing test, which is now outside
  the version.
- **Open bug, also on the r03b line.** Hypothesis checks run on transitions carrying `action`, `x`, `y`,
  `level_changed`, `state`, `levels_completed` and the grids (`refreshClaimChecks`), not `changed_cells`.
  - A check written as `t.get('changed_cells', 0)` silently reads 0.
  - 6 of the 14 hypotheses refinements wrote in su15 r2–r9 read that key. In su15-r2 one recorded 206 fails and 5
    holds on that default.
  - Those counts decide which rules are promoted or disputed.
- **Merge check.** `claude/merge-20261017` shows the lines merge as code. Its base is the weaker line.
- The r03b line does not log refiner inputs or replies, so L0's and L1's refinements cannot be replayed.

## Branch inventory (2026-10-17)

| Line | Commits that matter | Where |
|---|---|---|
| r03b | `cf419ec3` environment restart on `deecdde6` | `worktrees/r03b-restart` |
| su15 loop | `f581f918`, `5751333a` collapse and `provider_error` stop; `95a3803f` loop guard counts repeats that succeeded; `33f4c5bf` snapshot and stop at a level; `f3d1d2b1` L1 guards | `worktrees/r03b-repeat` |
| online correction | `fe9dccd6` ledger, EXPECT, `ARC_REFINE_MODEL`, refiner logs; `009b670c` strict expectation checks (on r03b-simple `1d60dcf1`) | `worktrees/refiner-ledger-20261016` |
| loop port | `8686067f` `ARC_REFINE_MODEL`, discriminating charter, refiner logs (on `33f4c5bf`) | `worktrees/refine-model-r03b-20261017` |
| r03b-simple | r2–r10 (facts in the head, meter lines, click-distance facts, rivals) | `worktrees/r03b` |

## r04 composition

| # | Component | From | In r04 | Evidence | Off switch |
|---|---|---|---|---|---|
| 1 | Environment restart | `cf419ec3` | yes | real runs: two restarts recovered | — |
| 2 | Collapse of repeated calls (across prompts), `provider_error` stop, loop guard on repeats that succeeded | `f581f918`, `5751333a`, `95a3803f`, `f3d1d2b1` | yes | gateway replay 2/2; L0 recovery; no provider stop in L1 | `ARC_THIN_COLLAPSE_REPEATS=0`, `ARC_THIN_LOOP_RESULTS=0` |
| 3 | Repeat-without-effect refusal; unavailable action refused with what is available | `f3d1d2b1` | yes, as a guard | L1: claims held, 11 plays affected | `ARC_THIN_NO_EFFECT_REPEATS=0` |
| 4 | Snapshot and stop at a level | `33f4c5bf` | yes (tooling) | fork smoke | — |
| 5 | Hypothesis checks: transitions carry `changed_cells`; a missing key is a check error shown on the hypothesis, not a default | new; expectation side as `009b670c` | yes, as a correctness fix | to build; acceptance below | one variable for the earlier rule |
| 6 | Refinement ledger and EXPECT, with strict expectation checks | `fe9dccd6`, `009b670c`, ported | yes: **the factor r04 tests** | F2 sources: EXPECT 9/9, one edit acted on | `ARC_REFINE_LEDGER=0` |
| 7 | Refiner input and reply logs; model on usage rows | `fe9dccd6` / `8686067f` | yes (measurement) | — | always on |

**Not in r04:**
- `ARC_REFINE_MODEL`: the agent-native decision.
- The discriminating charter: qwen proposed the missing test in 0 of 48 with it. It would come back only if a replay
  shows it helps qwen.
- r03b-simple's r2–r10: R1, and several are shaped by su15 (r9's click-distance facts, r7/r8's meter lines).
- r10 rivals: no gain in its fork test.
- `env.ask`: runs not authorized.
- Jev.

## Build order (no paid runs)

1. **Branch.** `claude/r04-20261017` from `2b9cc6ac`, worktree `worktrees/r04` with the `node_modules` junction.
   Items 1–4 come with it.
2. **Item 5, then its acceptance.**
   - Unit tests.
   - Re-run the hypotheses refinements wrote in su15 r2–r9 (their sources are in those runs' memory logs) over their
     recorded transitions, with the earlier and the strict rule. List every verdict that changes.
3. **Items 6–7.**
   - Port the ledger and EXPECT onto r04, reusing `8686067f`'s port of the logging without `ARC_REFINE_MODEL`.
   - The ledger tests (8/8 on the source branch), the `schedule` and `promotion` smokes, and the full arc_thin TS suite
     against `2b9cc6ac`.
4. **Development-loop tools,** outside runs; a stronger model is allowed here.
   - The measures move into `tools/` (`l1-measures.mjs`, `level-spend.mjs`, the repeat counter).
   - The refinement replay (`replay_diag.py`), with blind grading.
   - A post-run analyst: one call per finished run to a stronger model, over those measures, the refiner's edits and
     the trajectory. It answers our template (failures, the broken transition, a general candidate change) for us to
     review; nothing returns into the run.

## Evaluation (each step needs its own budget)

- **E1: one shakedown run.** One full su15 run on r04, at most 6M budget tokens.
  - Checks: the ledger and EXPECT work on the r03b line in real play; strict checks raise no flood of errors; the
    refiner's inputs are logged.
  - It stops the plan if any of these fails.
- **E2: the ledger test.** Three full su15 runs on r04 against the pooled six, at most 18M (E1 counts as one of the
  three if it ran to the end with the same settings).
  - **Claim:** with its own edits' outcomes in view, the refiner changes line after an unmet expectation, and
    levels per run are no worse than the pooled base (1.33).
  - **Mechanism measures:** EXPECT met, contradicted and not seen; rewrites of a line after its expectation failed
    (l0-1 rewrote one seven times); the agent playing a refinement's proposed test within 10 actions.
  - **Outcome measure:** level 2 completed (base 2 of 6). Three runs separate only a large effect; 2 of 3 at a base of
    1 in 3 happens by chance about 26% of the time.
- **E3: replays between runs.** With item 7, every r04 run logs its refinements, so qwen refiner variants (a typed
  question, a charter) can be replayed on them and graded offline before any is built.

## Deferred items this touches

`docs/deferred-research-todos.md`:
- **B,** a double-check role: the ledger is the refiner reviewing its own edits.
- **C,** hypothesis → experiment → evidence → revised conclusion: EXPECT tracks that chain for refinements, and item 5
  makes the hypothesis side honest.
- **D,** continuity: the collapse rewrites history after repeats.

None of them closes with r04.
