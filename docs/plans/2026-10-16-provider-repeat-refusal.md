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
| Rounds in a row with identical tool calls (names, and arguments compared with keys sorted) in finished decisions render as the first round. Its result is the last round's result, with a note: "(This call was made N times in a row; every result was the same:)", or, when results differed, how many are not shown and the action receipts (`#n ACTION…` lines) they held. A user message, an assistant message without calls, or a different call ends a run. | `collapseRepeatedCalls` in `demo/arc_thin_native_context.ts`, applied in `freezeHistory` | on | `ARC_THIN_COLLAPSE_REPEATS=0` |
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

| Evidence layer | Status | Provider / environment | Artifacts and limits |
|---|---|---|---|
| Functional | passed | test fixtures | `tests/arc_thin_native_context.test.ts` |
| Full chain | passed | scripted provider imitating the gateway; mock SDK; production bridge; real Pi 0.87 | `tools/run_repeat_refusal_smoke.py`; the real gateway's rule is not known exactly |
| Autonomous adoption | not applicable | — | nothing for the agent to adopt |
| Net benefit | unverified | — | needs the replay below or a real refusal |

## Delivery decision

- Supported: the collapse and the stop rule work as designed, offline and through the real runner, bridge and Pi
  against an imitation of the gateway.
- Not supported: that the real gateway accepts the collapsed history (its rule is inferred from two runs), and any
  effect on task results.
- Decision: kept on `claude/r03b-repeat-20261016`, not merged into `r03b`. The collapse changes what the agent sees after
  a repetition, so by the integration rule it waits for real evidence.
- Next falsifiable check: the replay above, with su15-r1-B2's decision-27 request sent to yibu with every copy and
  collapsed (a few requests, well under 1M tokens; needs a budget). Then preventing the repetition (identical
  successful calls in `NativeLoopGuard`), as its own change.
