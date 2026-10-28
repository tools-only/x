# Agent-native Self/Meta P0 implementation record

Date: 2026-10-28 Asia/Shanghai. Scope: authorized worktree implementation, local tests only.

## Problem and falsifiable claim

With Daemon enabled, processEvidenceText and process prompt delivery were gated by daemonResponse; runner reviews also omitted process guidance. Claim: removing that identity gate lets an ordinary Task author a component, pass Binder and deliver it at the next boundary, while existing daemon mounts provide failures and successes without success-triggered interruption. Falsified if Task writes fail, later delivery is absent, ledger conflates creation with use, or success creates pending.

## Design and cost

Reuse Binder, repeatedWork and the two existing daemon mounts. No worker, process, model loop, watch registry, required Agent field or automatic promotion. Agent decides draft/write/save; Binder validates and retains versions; boundary exposes; working_set/component_runs record shown/called; subsequent results feed future process evidence. Candidate material replaces manual repeated-code discovery. Up to three current-level repeated families; daemon summaries retain eight success labels and eight failure lines, each at most 240 characters. Repeated candidates disappear when existing repetition windows expire; component retirement remains delete/_off, failures clear on acknowledged response; successes roll out of the bounded list. Parent may reasonably decline promotion when reuse cannot repay cost.

Lifecycle: transient work -> optional parent component write -> Binder validation/receipt -> boundary -> shown/called -> next refresh -> parent keep/revise/retire. No extra management turn. Existing budget, environment, permissions, maintenance staging, daemon_reply and refiner process-write prohibition stay in place. Semantic judgments remain with Agent.

## Bounded evaluation protocol

No paid provider or ARC completion run. Local Python daemon fixture plus actual extension event/tool harness with mock HTTP environment; existing Binder/review regressions. Acceptance: no-pending ordinary Task reads PROCESS EVIDENCE, creates active Self and Meta prompts with agent origin and inferred layers, next decision logs delivery. Fixture has both failure and success material; success alone creates no pending; repeated errors still do. Negative cases include Binder validation/fallback/collision and daemon restart. Compare previous gating behavior through code diff; no task-quality baseline or token-benefit claim.

## Implementation and verification

A: extension evidence/head/index/prompt delivery and runner review guidance ungated from response identity. B: native system lifecycle/promotion hint, existing repeatedWork candidates, Binder kind/layer metadata (by already existed). C: existing capability/runtime monitors feed harness/process.md; extension copies evidence into readable data/process.md and decision head. Response tool restrictions and publish paths remain.

Commands, results, file list and risks: C:/Users/qi/tmp/r04/agent-native-p0-20261028/RESULT.md.

| Evidence | Status | Environment | Limits |
| --- | --- | --- | --- |
| Functional correctness | Local tests recorded in RESULT | Windows, Node, Python, mock environment | Fixture/function and extension wiring |
| Full-chain reachability | Partial | Actual Pi/bridge, scripted provider, mock SDK | Baseline thin smoke passed; A/B/C assertions use extension event harness and daemon fixtures |
| Autonomous adoption | Unverified | No real provider | Explicit test authoring is not autonomous adoption |
| Net benefit | Unverified | No matched comparison | Parent/child cost, latency and continuity unmeasured |

## Decision and remaining checks

Keep as implementation with behavior/benefit unverified. Next falsifiable check needs separately authorized real-provider budget: ordinary Task notices repeated work, chooses promotion or justified non-use, and subsequent action logs show whether it replaces repeated work. Compare total parent-plus-child cost and progress under fixed budgets. Related deferred B/C/D evidence-to-use, total cost and cognitive continuity remain open (docs/deferred-research-todos.md); no backlog completion claim.
