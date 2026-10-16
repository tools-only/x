# Meta-harness change record: a provider refusal for repeated calls no longer ends the run

Date: 2026-10-16 (Asia/Shanghai). Status: implementation; offline checks. Branch `claude/r03b-repeat-20261016` from
`r03b` (`cf419ec3`). Follows [the development workflow](../development-workflow.md).

## Problem and claim

- **Failure.** In su15-r1-B2 (R1, `runs/arc-r1-20261016`, branch `claude/r03b-simple-20261015`) the agent made one
  python call 20 times in a row in decision 26. The call read `data/observations/0.json` and got the same result each
  time.
  - The yibu gateway then refused the next request with stop=error: "Repetitive tool calls detected in the conversation
    history. The same tool call with identical name and arguments has been repeated across multiple consecutive
    rounds."
  - Native decisions keep the earlier decisions as a transcript (`freezeHistory`), so every later request carried the
    20 copies and was refused too: 307 refused rounds and about 290 decisions without an action.
  - The refusals reported no usage, so the 350k token cap never fired; the fork was stopped by hand.
  - su15-r4 (2026-10-16, 708 refusals in its events) failed the same way; it had been read as our own loop guard.
  - Measured with `C:/Users/qi/tmp/r03b-simple/repeat-runs.mjs`. In decision 24 the same call ran in rounds of 4, 4 and
    5 without a refusal, so the gateway's threshold lies between 6 and 20 consecutive rounds (not known exactly).
- **Claim.** If the transcript of earlier decisions shows a run of rounds with identical calls once, with its count, a
  run whose request was refused for repeated calls acts again in the next decision.
- **Negative case.** The refusal persists (the gateway counts something else). Then the run stops after 3 turns in a
  row ended by the same provider error, instead of sending refused requests until its deadline.
- **Burden removed.** No dead run: no refused requests without usage and no hand stop. The agent also sees its
  repetition as one round that says how often it ran, instead of every copy.
- **Overturned by.** A real refusal for repeated calls after which the next decision is refused again with the
  collapse on.
- **Scope.** The transcript of finished decisions, and a runner stop. Out of scope:
  - the current decision's rounds, which stay append-only for the prefix cache;
  - preventing the repetition itself. `NativeLoopGuard` ends a decision after three identical failed calls or
    `read`/`ls`/`grep` calls, but successful identical python calls never count. Ending those is its own change and its
    own agent-visible factor.

## Design and cost

| Item | Where | Default | Earlier behaviour |
|---|---|---|---|
| Rounds in a row with identical tool calls (names, and arguments compared with keys sorted) and the same outcome in finished decisions render as the first round. Its result is the last round's result, with a note: "(This call was made N times in a row; every result was the same:)", or, when results differed, how many are not shown and the action receipts (`#n ACTION…` lines) they held. A refused call is not a repeat of one that ran: in su15-r1-B2 calls 17–20 were refused by the decision's call cap, and showing only that refusal would have hidden what the 16 before it returned. A user message, an assistant message without calls, or a different call ends a run. | `collapseRepeatedCalls` in `demo/arc_thin_native_context.ts`, applied in `freezeHistory` | on | `ARC_THIN_COLLAPSE_REPEATS=0` |
| A run stops as `provider_error` when 3 turns in a row end with the same provider error and no action. `summary.provider_errors` counts refused turns. | `MAX_PROVIDER_ERRORS`, `_provider_error` in `src/autoresearch_pi/arc_thin_e2e.py` | 3 | `max_provider_errors=0` |
| `canonical` (argument key sorting) is shared by the loop guard and the collapse. | `demo/arc_thin_native_loop.ts` | — | — |

- A finished decision still renders to the same bytes on every request, so the provider's prefix cache is kept. Runs
  never cross a decision boundary.
- No new prompt text, field or tool. The note appears only in a collapsed result.
- Information kept: the first round's text and call, the last result, and every action receipt. Lost: the text the
  agent wrote in the repeated rounds, and the earlier results when they differed (their receipts aside).
- The stop rule is general: any provider error that repeats identically for 3 turns ends the run. A transient outage
  returning one identical error 3 times in a row would stop a run too. That is a cost accepted against a run that
  spins without usage.

## Protocol before any real run

- Evidence targets now: functional and full-chain, offline, with a scripted provider that imitates the gateway.
- Real-provider check (needs its own budget; not run): the refusal is rare (2 of about 30 su15 runs on 2026-10-16), so
  waiting for it in ordinary runs is slow. A replay is cheaper: send the request su15-r1-B2 made at decision 27, built
  once with every copy and once collapsed. Claim: the collapsed request is accepted and the uncollapsed one refused. A
  few requests, well under 1M tokens.
- Negative case to watch in later runs: any `provider_error` stop. Its error text and the history it carried say whether
  the collapse missed a repetition.

## Implementation and verification

- Unit (`tests/arc_thin_native_context.test.ts`): five identical rounds show as one with the note, and the result
  answers the kept call. Acting calls with differing results keep their receipts. Key order is ignored. A decision
  boundary, a text-only message or a different call ends a run, and single rounds are untouched. `collapseRepeats:
  false` keeps every copy, and a finished decision keeps its bytes.
- Full chain, offline (`tools/run_repeat_refusal_smoke.py`: mock SDK, production bridge, real Pi, the scripted provider
  refusing 5 identical rounds in a row): (1) collapse on: one refusal in decision 2, then the next decision's request
  shows the five rounds once and acts; (2) `ARC_THIN_COLLAPSE_REPEATS=0`: every later request refused, the run stops
  after 3 refused turns as `provider_error`.
- Results: see §Checks.

### Checks (2026-10-16, `C:/Users/qi/tmp/r03b-simple/checks-repeat`)

- TS: native context (with the new test), promotion, native loop and efficiency suites, 25/25. pytest 29/29 (recovery,
  request accounting, lifecycle stats, foundation config, bridge deadline).
- `run_repeat_refusal_smoke.py`:
  - Collapse on: 1 refusal, in decision 2. The next request showed the five rounds as one with the note, and the
    decision acted (ACTION4). The run had 4 actions in 5 decisions and stopped at `max_decisions`.
  - Every copy kept: 3 refusals, 1 action, stopped as `provider_error`, `provider_errors` 3.
- `run_fork_smoke.py` parts 1–4 pass, including a forked parent that sees the source's earlier decisions. The
  environment smoke passes.
- The `activation` smoke fails at its check of reasoning kept within a decision. Unchanged `r03b` fails it the same way
  (base's smoke runner does not set `ARC_THIN_REASONING_MODE=all`), so this change did not cause it.
- Rerun after a refused call stopped counting as a repeat of one that ran (`checks-repeat2`): TS 25/25, with the B2 case
  (5 calls that ran and 2 refused show as two rounds); the refusal smoke gives the same results.

### Replay against the real gateway (2026-10-16, user-approved; `C:/Users/qi/tmp/r03b-simple/replay-refusal.py`)

- Request: su15-r1-B2's first request after the refusal (`runtime-audit/provider-inputs.jsonl` row 77, the exact
  payload Pi sent: 214 messages, decision 26's 20 identical rounds before the new head). Variants: as logged, and with
  the collapse applied to the payload (160 messages, longest run 2: the 16 calls that ran and the 4 the call cap
  refused). Two samples each, alternating, streamed as Pi sends them; yibu / qwen3.8-27b, thinking off.

| Variant | Longest run | Outcome (2 samples each) | Usage per request |
|---|---|---|---|
| As logged | 20 | refused both times: `invalid_parameter_error`, "Repetitive tool calls detected…" | 39,277 prompt + 90 completion |
| Collapsed | 2 | accepted both times: finish `tool_calls` | 34,875 prompt + 197 completion |

- **The claim holds at the gateway:** the collapsed history is accepted, and the history as logged is refused.
- **What triggers the refusal:** in every sample the model wrote the same sentence ("I've been stuck in a loop… Let me
  examine what row 63 correlates with…") and then emitted the same python call again. With 20 copies in the history the
  gateway cut the stream at that call; with the collapsed history it let it through. So the note did not stop the
  agent from repeating its call.
- **Refused requests are billed:** the refused stream reports its usage (39k prompt tokens), but Pi records no usage for
  a stream that ends in an error. su15-r1-B2's 308 refusals therefore cost about 12M prompt tokens that its token cap
  never saw. The stop after 3 refusals bounds this.
- Cost of the replay: about 149k tokens.

| Evidence layer | Status | Provider / environment | Artifacts and limits |
|---|---|---|---|
| Functional | passed | test fixtures | `tests/arc_thin_native_context.test.ts` |
| Full chain | passed | scripted provider imitating the gateway; mock SDK; production bridge; real Pi 0.87 | `tools/run_repeat_refusal_smoke.py` |
| Real gateway | passed for one request | yibu / qwen3.8-27b | replay above: collapsed 2/2 accepted, as logged 0/2; one request, two samples each |
| Autonomous adoption | not applicable | — | nothing for the agent to adopt |
| Net benefit | unverified | — | the agent repeated its call again after the collapse; no run measured |

## Delivery decision

- Supported: the collapse and the stop rule work offline and through the real runner, bridge and Pi against an
  imitation of the gateway. The real gateway accepts the collapsed version of the request su15-r1-B2 was refused on.
- Not supported: that a run recovers into useful play. In the replay the model repeated its call. Task effect is
  untested.
- Decision: kept on `claude/r03b-repeat-20261016`, not merged into `r03b`. It changes what the agent sees after a
  repetition, so by the integration rule it waits for run evidence.
- Next falsifiable check: prevention, as its own change. `NativeLoopGuard` would end a decision after 3 identical
  successful calls with identical results and an unchanged state, as it already does for failed calls and file reads.
  The replay shows the repetition persists even when the history says how often the call ran. A further gap: refused
  requests' usage is invisible to the token cap (Pi drops it on error).

## Prevention: a call that succeeded can be a repeat (2026-10-17, user: "go")

- **Failure.** The collapse recovers a refused run, but in the replay the model made the same python call again in both
  samples, though its history said the call had run 16 times. In su15-r1-B2 our loop guard never saw the 20 calls.
  `NativeLoopGuard` counted only failed calls and reads (`read`, `ls`, `grep`); a call of any other tool that succeeded
  reset it.
- **Claim.** If a call that succeeded counts as a repeat when its result is the same and the state is unchanged
  (decision, actions, saved components, memory: the existing epoch), a decision that repeats such a call ends at the
  third. B2's decision 26 would have ended after 3 calls, not 20, before the gateway refused anything.
- **Negative cases.**
  - A legitimate repeat is cut: the same code printing the same output three times while something outside the epoch
    changed, such as a session variable it does not print. The decision ends with the existing message ("Three identical
    observations/errors without a state or workspace change…") and the next decision goes on.
  - The agent opens the next decision with the same call. Base has no refusal of the call that ended a decision (the
    branch's r5 added one), so it can repeat 3 calls per decision. Each finished decision then collapses to one round.
- **Design.** `NativeLoopGuard.record(name, args, epoch, failed, result)`: reads and failed calls count by their
  arguments, as before. Any other call that succeeded counts with its result text in the signature.
  `ARC_THIN_LOOP_RESULTS=0` restores the earlier rule. No new prompt text: the message is the guard's existing one.
- **Checks** (`C:/Users/qi/tmp/r03b-simple/checks-repeat3`, this branch against unchanged `r03b`):
  - Unit: `tests/arc_thin_native_loop.test.ts` covers the same result repeating, a result that changes, a state
    change, reads by their arguments, and the earlier rule.
  - Full arc_thin TS suite: 163/169 here, 162/167 on `r03b`. This branch has the two new tests. The five failures on
    `r03b` (activation, components, receipts ×3) fail here too.
  - One more failure here, the action-surface suite, was a 20 s Pi start timeout right after a machine reboot. Run
    alone it passes 2/2.
  - Native foundation smokes (foundation, nativeclaims, migration, receipts, promotion, history, budget, activation,
    reuse, components, query): the same outcome on both trees. Each stops at its known check on `r03b` (nine at the
    shared `system_chars` check, activation at its reasoning-mode check, components at its skill description).
  - Refusal smoke:
    - Part 1, recovery: one refusal, then the next decision acts.
    - Part 2, every copy kept: 3 refusals, then a `provider_error` stop.
    - Part 3, defaults: the third identical call ends decision 2, no request is refused, and the next decision acts.
- **Layers.** Functional and full chain: passed offline (scripted provider, mock SDK, production bridge, real Pi).
  Real gateway: not tested for prevention. Adoption: not applicable. Net benefit: unverified.

## In real runs (L0 of the su15 level-2 loop, 2026-10-17)

- **Recovery worked once.** In su15-l0-1 the gateway refused a run of 20 identical calls within one decision: RESET while
  RESET was not available, each rejected by schema validation. The next decision went through.
- **Prevention missed two kinds of repeat.**
  - Calls that failed schema validation never reach the tool, so the loop guard does not see them.
  - Real actions that change nothing move the epoch on (the action count), so they never repeat in the guard's terms.
- **The collapse's model of the gateway was wrong.** The gateway counts identical calls across decision prompts. After
  su15-l0-1 played `ACTION6(31,15)` once per decision 20 times, its history showed 20 identical calls separated only by
  prompts. The collapse keeps runs within a decision, and so does this record's smoke imitation, so the gateway refused 3
  turns in a row and the stop rule ended the run (`provider_error`).
- Follow-up: iteration L1 of [the level-2 loop](2026-10-17-su15-level2-loop.md).

## Across decision prompts (L1, 2026-10-17)

- **Collapse.** A run of rounds with identical calls and the same outcome now goes on across decision prompts and
  assistant messages without calls; those stay in place, and of the run's rounds only the last remains, with the note
  ("This call was made 20 times in a row, in 20 decisions; …"). Keeping the last round means a run that goes on in the
  next decision changes the transcript only from the decision where it ended before, so the prefix cache before that
  point is kept. A finished decision is therefore no longer byte-stable when a run it ends with continues.
- **Imitation.** The smoke provider's gateway counts identical calls across every message without calls (prompts,
  results, text-only messages); only a different call ends a run. That is stricter than what su15-l0-1 showed (prompts
  only), so a collapse that passes it also passes the real gateway's count as far as it is known.
- The other two parts of L1 (refusing an action repeated without effect, and an unavailable action refused by the tool
  with what is available) and the checks are in [the level-2 loop](2026-10-17-su15-level2-loop.md).
