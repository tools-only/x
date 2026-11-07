# Reflective core: first PPT self-surgery step

## Problem and claim

PPT agents can persist tools and prompts, but current authoring operations are file-shaped (`save_program` and `self_component`). A deck or artifact edit can therefore be mistaken for harness change. The narrow claim is that a running Pi session can inspect its live Binder components, redefine one through one reflective API, use that version at the next request boundary, and restore an earlier saved version through the same API.

The burden removed is choosing separate read, write, save, and reload operations to perform one component change. This is a mechanism test; no task-quality or net-benefit claim is made.

## Design

Use a small MOP surface: `reflect_component(op="inspect")` exposes live component objects; `redefine` and `rollback` intercede on their definitions. The component model remains heterogeneous: tools keep executable Python, prompts keep Markdown. Binder remains the version store and validator. The Pi host rebinds the component and updates the active tool set for the next request; `before_agent_start` composes active prompts and sets `forceSystemPrompt` for that request in the same session. The current call and transcript are not rewritten.

The API returns name, kind, active version, path, complete definition, and source-level `used_by` references. Redefine accepts a replacement source with a name and kind. Rollback accepts a saved version number. Both publish through the existing Workspace and Binder, then refresh live bindings and tool registration. Output paths such as `artifacts/deck.json` are outside the component namespace and cannot satisfy the reflective evidence check.

## Fixed boundary

The Pi kernel, the PPT host and its budget, deadline, path and provider guards, and the reflective API itself are not Binder components and cannot be changed through this operation. No loop, tower, canary, promotion flow, case record, or new worker is introduced.

## Evaluation and limits

Offline Node tests exercise the Pi extension tool surface with a local stub and real Binder/Workspace persistence. They establish function and same-extension-session wiring, not provider behavior or autonomous adoption. The prepared AZ DeepSeek validation asks the real task agent to inspect, redefine, and execute a tool and checks recorded reflective and component-run evidence. A deck-only write must fail that checker. No paid run is part of this change.

## Implementation and evidence

- `demo/ppt_demo_extension.ts`: reflective inspect/redefine/rollback API.
- `tests/ppt_demo.test.ts`: offline introspection, tool/prompt hot swap, rollback, and deck-edit negative case.
- `src/autoresearch_pi/ppt_demo.py`: allow selecting an AZ model for the prepared validation command.
- Results and exact validation command: `.scratch/reflective-core/result.md` and `.scratch/reflective-core/validation.md`.

| Evidence layer | Status | Environment | Result |
| --- | --- | --- | --- |
| Functional correctness | Passed | Local Node/Pi extension tests (local Pi API stub) | Introspection, tool/prompt redefine and rollback, and deck-only checker failure passed |
| Full-chain reachability | Unverified | Azure DeepSeek V4 Flash | Prepared only; not run |
| Autonomous adoption | Unverified | Azure DeepSeek V4 Flash | Prepared only; not run |
| Net benefit | Unverified | Not evaluated | No benefit claim |
