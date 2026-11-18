# ARC SelfRoot Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the shared SelfRoot core into native ARC runs with ARC facts and persistence under `self_root/`, preserving ARC task behavior and a legacy fallback.

**Architecture:** `demo/self_root.ts` owns generic reflection, lifecycle, evidence ledger, and the single live runtime-view object. `demo/self_root_arc.ts` supplies ARC contract, task facts, receipts, metrics, and schemas. The extension feeds task facts to that view and owns environment execution and raw logs; it does not independently emit a parallel ARC state/history view.

**Tech Stack:** TypeScript, Pi extension API, Node filesystem APIs, existing ARC bridge and Python task pool.

**Spec:** `docs/superpowers/specs/2026-11-18-arc-selfroot-migration-design.md`

## Global Constraints

- Generic SelfRoot code and contracts contain no game identity, board interpretation, coordinates, or strategy.
- Keep `arc_action`, Python/WASI, `env.act`, ARC bridge, native runtime, action budgets, and image delivery operational.
- Move current ARC state and action history into the SelfRoot mirror; omit duplicate state/recent/self text from the Agent-facing working set.
- SelfRoot is default-on for native non-control runs; `ARC_THIN_SELFROOT=0` disables it; legacy selfloop only runs when SelfRoot is disabled and `ARC_THIN_SELFLOOP=1`.
- SelfRoot writes use request-boundary activation and persist to `<ARC_RUN_ROOT>/self_root/`.
- User authorized targeted checks and one real ARC run capped at 3 decisions, 5 actions, and 120k reported tokens. The requested provider is `az` with `qwen3.8-27B`; do not substitute another provider.

## Review Focus

- Existing state with a different contract hash must fail clearly rather than reset: pin via static inspection of contract loader branch.
- SelfRoot and legacy loop must not both write: pin via static inspection of switch derivation.
- Python `env.act` must generate the same task action receipt path as `arc_action`: pin via static inspection of shared `submitAction` call sites.
- Reset/level/session boundaries must not advance before the environment confirms state: pin via static inspection of existing receipt and boundary order.
- Provider schema and dispatch must derive from the same core operation descriptors: pin via static inspection of generated schemas and normalized dispatch.

## File Map

- Create `demo/self_root_arc.ts`: ARC contract, evidence/position/metrics resolvers, protocol schemas and action vocabulary.
- Modify `demo/arc_thin_extension.ts`: persistence, default switch, SelfRoot tool/context/lifecycle wiring, facts and boundaries.
- Create `docs/plans/2026-11-18-arc-selfroot-migration.md` as the substantive change/evidence record (this plan also carries its required sections).

### Task 1: Add ARC adapter for shared SelfRoot

**Files:** Create `demo/self_root_arc.ts`.

**Interfaces:** Consumes `SelfRoot`, `SelfContract`, `providerOperationSchema`, `operationContract`, and ARC run getters. Produces `ARC_SELF_ROOT_OPTIONS`, `arcSelfRootPaths`, `loadOrCreateArcContract`, `selfRootToolSchema`, and ARC fact/metric helpers.

- [x] Declare adapter options for ARC tools, checkpoints, receipt types, and generic context section names.
- [x] Create a game-agnostic contract whose hash is computed over its body and whose boundaries are the shared reset/unit/session floor.
- [x] Load or atomically create that contract; reject an existing hash/content mismatch.
- [x] Resolve bounded ARC ledger facts by ref; unresolved refs return `missing`.
- [x] Define tool schemas from the shared operation descriptors and expose only protocol tools valid for the current review/window state.
- [x] Define action facts and metrics without strategy interpretations or game labels.

### Task 2: Wire SelfRoot lifecycle and ARC actions

**Files:** Modify `demo/arc_thin_extension.ts`.

**Interfaces:** Initialize after ARC root, workspace, run state, and tool registry are available. Use existing `submitAction` as the canonical environment-action boundary.

- [x] Derive `selfRootEnabled` and legacy fallback flags so both reflective loops cannot be active together.
- [x] Load/create `<ARC_RUN_ROOT>/self_root/contract.json`; load and atomically persist `state.json`.
- [x] Register the SelfRoot protocol tools using shared descriptors/normalization.
- [x] Put ARC run position, observation and action history in the SelfRoot runtime view; preserve images and Pi transcript as separate inputs and remove duplicate state/recent text.
- [x] Record provider request facts and actual usage/cost into SelfRoot at existing request/message boundaries.
- [x] After successful `submitAction`, record action receipt/facts; check the SelfRoot grant before the environment action.
- [x] Route reset, level-complete/terminal, and session-end events through the declared SelfRoot boundaries.
- [x] Apply pending SelfRoot changes only at the response boundary, after request work is settled.
- [x] Keep Python pool/kernel and `env.act` registration untouched; Python actions still use `submitAction`.

### Task 3: Record evidence and perform static checks

**Files:** Update this plan/change record and related comments.

- [x] Record implemented entry points, boundaries, fallbacks, and outstanding deferred ARC adapter item A.
- [x] Run `git diff --check`, targeted pytest/Node checks, and inspect real-run artifacts.
- [x] Report functional correctness, full-chain reachability, autonomous adoption, and net benefit separately. The AZ real-provider run remains pending because no Pi endpoint/key is configured in the available local route files or environment.

## Self-Review

- Spec coverage: goals and non-goals map to Tasks 1–3; Python/WASI preservation and boundary ordering are explicit review focus items.
- Step clarity: files, exact exports, switches, and lifecycle APIs are specified; behavior is not scripted beyond the contract.
- Type consistency: adapter returns a `SelfContract`; the extension passes an exported state and adapter options to `SelfRoot`.
- Review focus: contract drift, dual writers, action receipts, boundary ordering, and schema/dispatch agreement are represented.
- Proportion: three tasks cover one shared-core adapter integration and its evidence record.
