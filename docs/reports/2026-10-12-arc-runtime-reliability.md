# ARC runtime reliability repair

Date: 2026-10-12. Status: implementation and bounded validation.

## Problem and falsifiable claims

The real yibu/qwen3.8-27b high/session run `runs/pi-arc-thin-ls20-session-compaction-uncapped-20261012-144352` stopped after six confirmed actions. Its seventh SDK action never returned; state and close waited behind the action lock. Separately, diff_report v4 evaluated state 5 but was recorded as state 6 after a concurrent action, contradicting the raw grid. The SDK's internal blocking location is unknown.

Two independent integrity claims: (1) asynchronous skill outputs retain the input state's identity even when an action completes concurrently; (2) an SDK call exceeding its total deadline leaves inspectable health/error evidence and stops further actions without replay or late commits. These are reliability claims, not claims of improved game reasoning.

## Design and cost

Bind skill input and metadata before evaluation; preserve batching and save-and-run. Add a bounded SDK worker with an independent health view, nonblocking state access, and an uncertain-outcome terminal boundary. The worker cannot commit action counts or ledger evidence. A timeout cannot cancel an already accepted remote action, so the old environment is abandoned. Normal close also has a deadline. No agent prompts, memory fields, reviews, or model workers are added. Cost: one short-lived local thread per SDK call and a compact health record.

The runtime advances execution, evidence association and failure containment. Agent recognition, component investment/assembly and semantic judgments remain unchanged. No extra parent decisions are required. Existing authorization, action budgets and version checks remain enforced.

## Pre-run evaluation protocol

Use deterministic regressions for concurrent state changes, hanging/None/exception SDK calls, late completion, refusal of subsequent actions, responsive health, and bounded close; preserve normal action behavior and leases. Compare these specific invariants against the old implementation. Then restart one fresh real ls20 environment with yibu/qwen3.8-27b, thinking high, treatment, session continuity, ledger and critic enabled, using the prior runner settings. No old action is replayed. Prior defaults have no explicit token/time/decision cap; adapter-derived action budgets still apply (not an unlimited action override). Stop on uncertain environment outcome or existing runner stop rules. Verify bridge readiness and a confirmed real action; leave the requested run running.

Primary measures are state provenance, responsiveness, duplicate/late commits (must be zero), error diagnostics, and confirmed startup/action. This is an exploratory restart, not a performance comparison. Levels, actions, latency and token costs are tracked by existing run artifacts. No net-benefit claim is justified by a single restart.

## Implementation and validation

Pending. Negative cases and results will be recorded here.

| Evidence layer | Status | Provider/environment | Boundary |
| --- | --- | --- | --- |
| Functional correctness | Unverified | Deterministic fixtures | Targeted reliability invariants |
| Full harness lifecycle | Unverified | Not in this scope | No Auto-Research closure claim |
| Autonomous behavior | Unverified | Real restart pending | Existing task behavior unchanged |
| Net benefit | Unverified | No paired runs | No benchmark improvement claim |

## Delivery decision

Keep only if the reliability checks pass. Underlying SDK/network cause remains unresolved until a captured timeout stack identifies it. Deferred ARC boundary/continuity work in `docs/deferred-research-todos.md` remains open; this repair only preserves observation provenance and environment integrity.
