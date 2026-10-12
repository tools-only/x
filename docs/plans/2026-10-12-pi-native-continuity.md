# Pi-native continuity for the thin ARC harness: change record (2026-10-12)

Status: implemented as an opt-in mode; functional and scripted full-chain checks pass. No real-provider run yet.

Background:
- [memory mechanism review](../reports/2026-10-12-memory-mechanism-review.md);
- [overnight runs review](../reports/2026-10-12-overnight-runs-review.md);
- the Codex (GPT-6) review of the Pi-foundation proposal, quoted in the session of 2026-10-12.

## Problem and claim

**Observed.**
- **Memory upkeep cost.** Memory upkeep took 20–45% of the agent's output in 10 real runs. Forced review turns alone took 10–34%.
- **Why.** The thin harness drops the transcript at every decision: the `context` hook shows only the rebuilt working set. So the agent must write down anything it wants to keep, then re-derive from those records what it concluded a decision earlier.
- **The kernel ran a different Pi than the tests.** Real runs used the global Pi 0.80.6 next to `node.exe`. The extension's Node tests and type imports resolved the project's `node_modules` Pi 0.87.0, which `pi-jev` pulled in as a peer dependency. The two versions differ in hooks (`context_edit`, `agent_before_settle`, `context_with_system`) and in how a request carries the prompt and tools.

**Claim.** If the agent's own recent decisions stay in view through Pi's session, it repeats less reasoning and needs fewer records to stay oriented. The tested scope is the agent's text, tool calls and receipts, without reasoning, for the last N decisions. Expected effects:
- fewer memory writes and reasoning tokens per action;
- more actions per hour;
- no loss of correctness from stale context.

**Disproved if**, against the rebuild mode at the same budget:
- input grows without a fall in reasoning per action; or
- the agent acts on outdated history, i.e. repeats a refuted test or follows a stale plan after a level change.

**Scope.** One main factor, continuity, behind a switch. Not in this step:
- Pi auto-compaction stays off. Codex found that its input does not use our projection: it includes reasoning and cuts tool results at 2,000 chars, so it must be inspected first.
- Forced reviews are unchanged.
- The memory schema is unchanged.

## Changes

| Area | Change |
| --- | --- |
| Pi version | `package.json` now pins `@earendil-works/pi-coding-agent` and `pi-ai` at **0.87.0**. `_resolve_pi_cli` order: `PI_AUTORESEARCH_PI_CLI`, then the project install, then the global install. `run-config.json` records `pi_cli` and `pi_version`. |
| 0.87 compatibility | **Side calls.** Critic and analyst now use `ctx.modelRegistry.streamSimple` through one `sideCall` helper. `pi-ai/compat completeSimple` cannot see extension-registered providers in 0.87, so the scripted critic failed with "Connection error". **Smoke provider.** It reads the prompt and tools from the leading system message 0.87 sends (`getCurrentSystemPrompt` / `getCurrentTools`). Its `message_count` excludes that message, so existing checks keep their meaning. |
| Continuity mode | `--continuity {rebuild,session}` (default `rebuild`) and `--continuity-decisions N` (default 8), passed through `ARC_THIN_CONTINUITY` / `ARC_THIN_CONTINUITY_DECISIONS`. In `session` mode the `context` hook puts the last N earlier decisions from Pi's session ahead of the working set. **Kept:** each decision's prompt, the assistant's text and tool calls, and the results clipped to 400 chars. **Changed:** a skill's source is replaced by `<N chars>`. **Dropped:** reasoning blocks; a call without a result, with its result paired the same way; a reply left with nothing. When decisions are dropped, the first kept prompt says how many. The grids and images were never stored in the session (the working set is added at projection time), so history carries no frames. The carried-results section is skipped in this mode because the history holds those results. |
| Prompt | One `{{continuity}}` slot: rebuild keeps the old sentence; session says the last N decisions stay in view without reasoning. |
| Recovery | In session mode, idle and length recoveries keep the session instead of calling `new_session`. The aborted reply holds no committed action, and its reasoning and unanswered calls are left out of the shown history. |
| Telemetry | `context_budget.jsonl` gains `history_messages` and `history_text_chars`. |

## Checks (2026-10-12; Node 25.5 with `--experimental-transform-types`, Python 3.12, Pi 0.87.0)

- **Node:** 83/83, including the new projection test. That test covers: no reasoning; skill source replaced; result clipped; an aborted reply with an unanswered call removed; the window of 1 with its note; rebuild unchanged; both prompt variants.
- **pytest:** 8/8.
- **Scripted full-chain smokes** (real bridge, mock ARC SDK, real Pi 0.87.0, scripted provider):

| Smoke | Run | Result |
| --- | --- | --- |
| continuity (new) | `runs/arc-thin-continuity-smoke-20261012035118` | 10/10 |
| self-harness | `runs/arc-thin-self-harness-smoke-20261012035118` | 21/21 |
| ledger | `runs/arc-thin-ledger-smoke-20261012035118` | 14/14 |
| environment | `runs/arc-thin-environment-smoke-20261012035118` | 5/5 |

- **The continuity smoke checks** that:
  - decision 2 receives decision 1's prompt, text, `skill`/`arc_action` calls and both receipts, ahead of the working set;
  - decision 3 receives only decision 2, with "1 earlier decision not shown".

**Not run:**
- The native ARC path (`arc_agi_3_e2e`) also resolves the CLI through `_resolve_pi_cli`, so it now launches 0.87.0; its own test suite was not rerun. Set `PI_AUTORESEARCH_PI_CLI` to the global CLI to keep it on 0.80.6.
- The other runners (`meta_harness_demo`, `officebench_e2e`, `shopping_e2e`) still use their own copies of the global lookup.

| Evidence layer | Status | Provider / environment | Limits |
| --- | --- | --- | --- |
| Functional | pass | unit tests | Projection rules only. |
| Full chain | pass (scripted) | mock ARC SDK, real bridge/Pi 0.87.0, scripted provider | No reasoning blocks, idle stall or length stop in a scripted session. |
| Autonomous adoption | unverified | — | — |
| Net benefit | unverified | — | — |

## Next steps

1. **Compaction inspection, no model cost.** Build a long scripted session, trigger `compact` over RPC, and record the summariser's input (size, reasoning, clipped results), latency and accounting. This decides whether native compaction can stand in for forced reviews.
2. **Real comparison.** Run `--continuity session` against `rebuild` on ls20 and lp85 in the same 1-hour budget, frozen tree, qwen high reasoning. Primary measures: levels and actions per hour. Also measure reasoning tokens per action, memory calls per action, input tokens per request, and repeated refuted tests. This needs a budget decision.
3. **Then, one at a time:** stop forcing reviews at level change; route critic delivery through `sendMessage(steer)` with a persisted note and evidence cutoff; add a notes block.
