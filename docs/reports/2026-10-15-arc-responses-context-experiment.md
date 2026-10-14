# ARC Responses transport and real-provider context experiment

Date: 2026-10-15 (Asia/Shanghai). Status: implementation and validation.
Dedicated branch `codex/arc-responses-20261015`, base `b215905a` (read-only fork of
the current objective-shaw runtime; no edits/merge into its Claude worktree).

## Problem and falsifiable claim

Decision-local `reasoning=all` currently preserves and re-sends prior thinking.
The preceding HTTP probe established yibu/qwen Responses, SSE and stored tool
continuation support, but not encrypted reasoning replay. Switching the API name
alone is insufficient: Pi defaults to `store=false` and full history replay.
Claim: exact compatible within-decision prefixes can use a stored response ID
plus only new tool results, retaining local canonical reasoning without sending
that text again. Changed context, model/decision, incomplete output and absent
IDs must rebase. This is a transport claim, not a game-quality or hidden-state
reuse claim. No prompt reminder, required reasoning field, worker or gameplay
gate is added; model reasoning remains high.

## Design and lifecycle

The existing ARC provider hook advances request projection; Pi's completed
assistant event supplies the response ID and locally retained output. A pure
helper checks the complete prior input and previous output before omitting them.
No state is reused across decisions. Changes/compaction rebase, preserving the
existing content policy rather than silently deleting thought text. Per-request
audit separates local reasoning from transmitted reasoning and records fallback
causes. Responses output capacity uses `max_output_tokens` (the existing hook
previously assumed Chat Completions keys). The provider stores Responses for
continuation; credentials stay in the host environment. No paid retries on a
protocol error. Unknown/cancelled usage is not reported as zero.

## Pre-run experiment protocol

- Explicit authorization: user asked to switch protocol and run real ARC.
- Real official ARC bridge / Pi / yibu `qwen3.8-27b`, game `ls20`, ordinary gameplay,
  high reasoning, text observations, native foundation, unchanged `all` retention.
- Same frozen source/settings, variable: Chat Completions vs Responses with
  verified stored continuation. Sequential fresh independent runs (different
  trajectories, not a controlled game-quality comparison).
- Two arms; each at most 3 decisions, 8 actions, 100,000 reported tokens, 540s
  experiment timeout, 540s decision timeout, 180s no-event fault timeout,
  32,768 output-token capacity. Total nominal time <=1,080s + bounded cleanup;
  total reported-token boundary <=200,000, possible in-flight overshoot recorded.
- Existing ledger/critic/refiner settings retained identically. Parent and all
  side calls count toward the run usage. No long-running research worker added.
- Primary acceptance: real tool-only followup with response ID, new tool result,
  wire old-reasoning chars=0 while local prior reasoning remains, and a later
  committed official ARC action. Count/review every full replay fallback.
- Compare wire chars, provider-reported input/cache/output/reasoning, actions,
  levels, latency. A smaller HTTP body alone does not prove smaller model context,
  lower billing, causal reasoning reuse or game benefit. A run without a tool-only
  followup is inconclusive for the main claim.
- Stop on protocol/config/source/secret failure, preserve artifacts. Functional
  negative cases cover changed prefix/output, model/decision and missing IDs.
- Frozen source and SDK hashes checked before/after. SDK dependencies are read
  through the existing node_modules junction; they are never modified.

## Implementation and verification

Pending targeted Node checks, runner smoke and real arms. This scope tests the
protocol/request/action path, not five-component ARC self-harness closure.

| Layer | Status | Provider/environment | Boundary |
| --- | --- | --- | --- |
| Functional correctness | Pending | Pure Node diagnostics | Prefix/output verification and fallback |
| Full-chain reachability | Unverified | Pi/official ARC | Protocol/action path only; five-component matrix not claimed |
| Autonomous adoption | Unverified | yibu/qwen | Ordinary followups/action to be observed |
| Net benefit | Unverified | yibu/qwen | Two exploratory arms cannot establish causal game improvement |

## Delivery decision

Pending real artifacts. Related deferred items: cross-compaction cognitive
continuity and parent-plus-child net cost remain open. Protocol state retention
alone cannot close them. No default promotion across unrelated providers until
the observed reachability and limitations are recorded here.
