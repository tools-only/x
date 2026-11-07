# Reflective core: first PPT self-surgery step

## Problem and claim

PPT agents can persist tools and prompts, but current authoring operations are file-shaped (`save_program` and `self_component`). A deck or artifact edit can therefore be mistaken for harness change. The narrow claim is that a running Pi session can inspect its live Binder components, redefine one through one reflective API, use that version at the next request boundary, and restore an earlier saved version through the same API.

The burden removed is choosing separate read, write, save, and reload operations to perform one component change. A real-task failure exposed a lifecycle flaw: prompt and memory changes only entered at a new-task boundary, so a long-running task could not observe a hot swap. The narrow correction is to intercede on each provider request in the same Pi session. The kickoff also gives a short order of operations to reduce broad exploration and make immediate use of each redefinition observable. This remains a mechanism test; no task-quality or net-benefit claim is made.

## Design

Use a small MOP surface: `reflect_component(op="inspect")` exposes live component objects; `redefine` and `rollback` intercede on their definitions. The component model remains heterogeneous: tools keep executable Python, prompts keep Markdown. Binder remains the version store and validator. The Pi host rebinds the component and updates the active tool set for the next request. `context_with_system` adds active prompt and memory definitions to each outgoing request and records exact version/session consumption; `before_agent_start` still prepares task-start context. The current call and transcript are not rewritten.

The API returns name, kind, active version, path, complete definition, and source-level `used_by` references. Redefine accepts a replacement source with a name and kind. Rollback accepts a saved version number. Both publish through the existing Workspace and Binder, then refresh live bindings and tool registration. Output paths such as `artifacts/deck.json` are outside the component namespace and cannot satisfy the reflective evidence check.

## Fixed boundary

The Pi kernel, the PPT host and its budget, deadline, path and provider guards, and the reflective API itself are not Binder components and cannot be changed through this operation. No loop, tower, canary, promotion flow, case record, or new worker is introduced.

## Evaluation and limits

Offline Node tests exercise the Pi extension tool surface with a local stub and real Binder/Workspace persistence. They establish function and same-extension-session wiring, not provider behavior or autonomous adoption. The authorized AZ DeepSeek validation asks the real task agent to inspect, redefine, and consume all five component kinds in the same session, with each change serving the presentation task. The checker requires a redefine followed by a same-version consumption receipt for prompt, skill, tool, subagent, and memory; deck-only writes fail. Offline tests exercise redefine, next use, and rollback for each kind. The bounded real-task attempts and their outcomes are recorded below and in `.scratch/reflective-core/real-task-result.md`.

## Implementation and evidence

- `demo/ppt_demo_extension.ts`: reflective inspect/redefine/rollback API and versioned same-request prompt/memory consumption receipts.
- `tests/ppt_demo.test.ts`: offline introspection and redefine/use/rollback coverage for all five kinds, including request consumption without a new task, checker positive case, and deck-edit negative case.
- `src/autoresearch_pi/ppt_demo.py`: allow selecting an AZ model for the prepared validation command.
- Results and exact validation command: `.scratch/reflective-core/result.md` and `.scratch/reflective-core/validation.md`.

| Evidence layer | Status | Environment | Result |
| --- | --- | --- | --- |
| Functional correctness | Passed | Local Node/Pi extension tests (local Pi API stub; subagent model stub) | All five kinds were redefined, consumed at the new version, rolled back to v1, and consumed again; checker positive and deck-only negative cases passed |
| Full-chain reachability | Failed | Azure DeepSeek V4 Flash (`deepseek-v4-flash`, high) | Attempts `a2` through `a5` reached the provider but stopped at the authorized $12 run guard before delivery. a4 drafted an HTML artifact; a5 did too. Neither was delivered. Evidence is in `.scratch/reflective-core/real-task-result.md`. |
| Autonomous adoption | Failed in observed attempts | Azure DeepSeek V4 Flash (`deepseek-v4-flash`, high) | a4 made no reflective redefinitions. a5 consumed prompt, memory, and skill v2, but did not run the redefined tool or consult the redefined subagent. |
| Net benefit | Unverified | Not evaluated | No benefit claim |
