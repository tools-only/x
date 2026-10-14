# Continual-Harness / Prime context optimization on the ARC Responses route

Date: 2026-10-15 (Asia/Shanghai). Status: implementation and functional validation.
Branch `claude/ch-responses-20261015`, base `b70ff75e` (kernel), with Codex's transport
commit `30aedfaf` cherry-picked. No merge into `claude/kernel-20261014` from here.

## Problem

A decision is a multi-query loop: the model reasons, calls a tool, reads the result,
reasons again. With `ARC_THIN_REASONING_MODE=all` (the default since 2026-10-14) every
request of that loop re-sent every earlier round's full reasoning text, because dropping
it made each round re-derive what the previous one had already settled (pilot-01). So the
within-decision context grew by the size of the deliberation, not by the size of what the
deliberation concluded.

Codex's transport commit removed that text from the wire when the provider can continue a
stored response, and left four things open: a required short reasoning field, prompt
reminders for it, shrinking the locally projected reasoning, and any game-level claim.
This change does the first three. It makes no game-level claim.

## What Continual Harness and Prime actually do, and what is adopted

- CH keeps the *conclusions* of a reasoning chain across state changes, not the chain.
  Adopted as the `<carry>` block: premises, eliminated, probe, open — written by the model.
- Prime keeps a stable, cacheable prefix and appends to it. Adopted unchanged: the
  decision head stays byte-identical, and no earlier turn is rewritten or collapsed.
- Neither replays hidden provider state. Not adopted, not claimed: no encrypted-reasoning
  replay, no cross-decision reuse of a response ID.

## Design

**The protocol.** `_resolve_pi_api` makes a native run take `openai-responses` whatever the
project `.env` says; `run_arc_thin_e2e(pi_api=...)` selects the route for an A/B arm or a
gateway without Responses. A declared chat-template thinking dialect exists only on
Completions, so it keeps that route instead of being dropped unnoticed. The runner then
sets `ARC_THIN_RESPONSES_CONTINUATION=1` and `ARC_THIN_REASONING_MODE=fields` on Responses,
and `0`/`all` on Completions; `extension_env` still overrides both, which is how a third arm
separates the protocol change from the carry-forward change. `run-config.json` records
`pi_api`, `responses_continuation` and `decision_reasoning_mode`.

**The carry.** `ARC_THIN_REASONING_MODE=fields` projects a decision's own rounds without
their reasoning prose and with the short block the model wrote itself. The block is taken
verbatim from the model's text. A message that wrote it inside its thinking instead has it
lifted onto the result of the call it made — that assistant message is already final when
its result first appears, so every earlier round still renders to the same bytes on every
later request. Nothing is summarised, no turn is collapsed, no tool call or result is
dropped, and the lift is clipped (`ARC_THIN_CARRY_FIELD_CHARS`, default 700) rather than
rewritten. The system prompt states the requirement and states the cost of ignoring it;
`context_budget.jsonl` counts `carry_blocks` and `carry_missing` per request, so
non-compliance shows up in the artifacts instead of being patched behind the model's back.

**Where the reasoning then lives.** On the Responses route the stored response holds it, and
the next query of the decision continues from `previous_response_id`. Verification is
Codex's and unchanged in substance: exact prefix, exact instructions, same decision and
model, and every item of the previous output still matching. One case is added — a reasoning
item the projection deliberately did not replay is *absent*, not altered, and the stored
response is the only copy of it, so it may be skipped. An altered reasoning item matches
nothing and still rebases, as does any altered or missing tool call or text, and at least one
item must match. `unreplayed_reasoning_blocks` in `responses_transport.jsonl` records how
many blocks only the stored response holds.

On a rebase (prefix change, new decision, missing or incomplete response ID) the local
projection is what is sent, and in `fields` mode that projection is the short fields plus
every tool call and result — smaller than the full prose, and the reason the fields exist
rather than being an optimization on top of them.

## Files

| File | Change |
| --- | --- |
| `demo/arc_thin_native_context.ts` | `carryText`, `carryFields`, `reasoning: 'fields'` |
| `demo/arc_thin_extension.ts` | mode wiring, prompt variable, carry audit |
| `demo/prompts/arc_thin_native_system.md` | `{{carry}}` replaces the fixed retention sentence |
| `demo/arc_responses_continuation.ts` | skip an unreplayed reasoning block; audit field |
| `src/autoresearch_pi/arc_thin_e2e.py` | `pi_api`, `_resolve_pi_api`, route-keyed defaults, run-config |
| `tools/run_arc_responses_experiment.py` | Responses default arm, `--reasoning` for a third arm |
| `tests/arc_responses_continuation.test.ts`, `tests/arc_thin_efficiency.test.ts`, `tests/test_arc_thin_lifecycle_stats.py` | below |

## Verification

| Layer | Status | How |
| --- | --- | --- |
| Carry retention vs reasoning omission | Verified | `arc_thin_efficiency.test.ts`: prose absent, both fields present, calls/results and the model's own text intact, lift clipped not rewritten |
| Append-only under `fields` | Verified | same file: five rounds, each request's projection starts with the previous one byte for byte |
| Continuation with an unreplayed reasoning block | Verified | `arc_responses_continuation.test.ts`: `previous_response_id` set, wire input is the new result only, `unreplayed_reasoning_blocks=1` |
| Codex's rebase semantics | Verified | same file: altered reasoning, altered arguments, changed prefix/decision, missing ID, and an altered call with reasoning omitted all rebase |
| Route resolution | Verified | `test_arc_thin_lifecycle_stats.py`: native default, legacy untouched, arm override, dialect keeps Completions, bad values raise |
| Extension and runner load | Verified | module import under `--experimental-transform-types`; `py_compile`; offline legacy smoke reached `max_decisions` with the new run-config fields |
| Real Responses + `fields` run | **Unverified** | no real-provider arm was run for this change |
| Net game benefit | **Unverified** | not measured, not claimed |
| Model compliance with `<carry>` | **Unverified** | qwen3.8-27b has not been observed writing the block; `carry_missing` exists to measure it |

Node: 14/14 in the two TS files. Python: 21/21 in the two touched suites. No offline native
smoke exists in this repo, so the native projection is covered by unit tests only.

## What is not claimed

- That a smaller request is a smaller model context, a lower bill, or a better game outcome.
- That the model's hidden reasoning is reused. Only that the server keeps it and the wire
  does not carry it again.
- That the short fields are as good as the prose. If the model writes nothing, the decision
  loses the conclusions a `reasoning=all` run would have kept; the first real arm must read
  `carry_missing` before reading anything else.
- The Responses-default and the carry-forward change land together, so a two-arm comparison
  confounds them. `--reasoning all` on the Responses route separates them.

## Next

A bounded real arm (`tools/run_arc_responses_experiment.py --root ...`, 3 decisions / 8
actions / 100,000 reported tokens) with `carry_missing`, `unreplayed_reasoning_blocks` and
the provider's cache counters read together. Until that exists, this is a transport and
projection change with unit-level evidence, and the deferred items of
`2026-10-15-arc-responses-context-experiment.md` — cross-compaction continuity and
parent-plus-child cost — remain open.
