# ARC Context Budget Implementation Plan

**Goal:** Reduce real-provider ARC decision-context size without changing Self-Harness component semantics, admission, assembly, research routing, action boundaries, or the lossless evidence store.

**Architecture:** Keep canonical bridge/action observations and task-local artifacts intact. Change only model-facing projections: summarize action-effect geometry instead of repeating per-pixel signatures, bound large delta text when a new complete frame is supplied next turn, and replace older action-result bodies with exact trace pointers. Preserve the latest action result and the current complete frame.

**Tech Stack:** Pi TypeScript extension, Python/pytest fixture tests, real ARC bridge/provider telemetry.

## Evidence and alternative approaches

The real run `runs/arc-controllability-sol-live-20260928-k` reached `levels_completed=1` in 9 actions, then repeated the same parent provider request with about 155,710 payload JSON characters / 38,885 heuristic input tokens. At that request, `arc_observation` accounted for 66,720 characters, Tool definitions 27,021, other messages 31,164, task prompt 3,229, and selected Memory 0. The level-transition `arc_action` text was 36,775 characters; its action-effect ledger was 30,197 and delta row-runs 4,450. Two provider streams ended with `terminated` after roughly 6–7 minutes without another ARC action.

1. Prompt-only trimming is low risk but can save at most the measured 3,229 task-prompt characters; it cannot explain the growth.
2. Replacing the current frame with a lossy summary could save tokens but risks game quality and weakens the action decision contract.
3. Recommended: shrink repeated historical/effect projections while preserving the current lossless frame and trace refs. This targets the measured dominant source and does not change component or environment behavior.

### Real-provider follow-up after the first projection

The first fresh FT09 provider run (`runs/arc-context-budget-live-20260929`) produced one ARC action before it was deliberately stopped for another context fix. Request 1 was 40,843 JSON characters (the old opening request was 42,022). Request 2 reached 145,472 characters, but its `assistant_messages` alone were 93,529; Memory remained 0 and the ARC observation category was only 1,538. This is a separate, larger source: Pi carried a completed assistant's long reasoning into the next provider request. The model-facing context hook now abbreviates only completed historical thinking to its final 1,200 characters. Tool calls, tool results, the latest unfinished assistant continuation and canonical ARC evidence remain untouched. A fresh provider request is needed to measure the saving; synthetic tests and the deterministic smoke alone cannot establish it.

The second fresh FT09 run (`runs/arc-context-budget-live-reasoning-20260929`) reached its first real ARC action and subsequent provider requests. Request 2 was 50,561 JSON characters with 3,732 assistant-message characters, and request 3 was 56,420 with 5,911 assistant-message characters; Memory remained 0. The corresponding early-stage peak in the prior attempt was 145,472 / 93,529. This is evidence that the assistant-history projection is active on the actual provider wire, but not yet evidence of lower end-to-end cost or better game quality.

Both new projection runs used the configured `deepseek-v4-flash` provider; the earlier 9-action FT09 run used `gpt-5.6-sol`, so benchmark progress across those runs is not a controlled comparison. The second run was stopped after one real ARC action: provider request 3 (56,420 characters) returned HTTP 200 but did not finish its streamed assistant message over the subsequent several minutes. Its first completed assistant message had 28,331 output tokens and took about 292 seconds. Output generation latency and game-solving quality remain separate, unverified issues; no claim of faster level completion follows from the input reduction.

## Tasks

### 1. Lock down the context regression

**Files:** `tests/test_arc_agi_3_e2e.py`, optionally a small pure TypeScript projection module under `demo/`.

Write tests using a large changed-component fixture and several historical ARC action messages. Assert that the model-facing ledger contains counts, boxes, classifications and action indices but no expanded `shape_signature.values`; only the latest action result body remains; the complete current frame is not replaced. Run the focused tests and confirm the old implementation fails.

### 2. Reduce action-result projection

**Files:** `demo/pi_arc_agi_3_extension.ts` and its pure projection helper.

Render a bounded geometric effect summary, leaving full internal effect records for classification. For a large delta/level transition, return changed-cell count, bbox and a trace recovery pointer instead of thousands of row-runs; keep precise row-runs for small deltas. Do not mutate the bridge result or persisted `execution-observations.jsonl`.

### 3. Fix historical result retention

**Files:** `demo/pi_arc_agi_3_extension.ts`, focused tests.

Correct the retention set so older ARC action-result bodies become exact artifact pointers while the most recent action result remains available. Maintain the existing current-frame and action-boundary flow.

### 4. Verify savings and semantics

Run focused pytest, the ARC self-harness real-runner smoke required by `AGENTS.md`, and a fresh real-provider ARC run capped at 30 actions. Compare `context-token-debug.jsonl` at matched decision stages, especially `arc_observation`, total context, action count, level progress, and provider errors. Do not claim game-quality improvement from a deterministic smoke or a non-comparable single run.

## Deferred boundary

The backlog's context-continuity item D remains open: a shorter prompt is not proof that hypotheses survive compression. This task leaves parent/child routing and adapter ownership (A/C) untouched and checks that exact historical observations remain retrievable.
