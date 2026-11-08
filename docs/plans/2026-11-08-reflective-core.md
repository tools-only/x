# Reflective core: first PPT self-surgery step

## Problem and claim

Real task a9 (`runs/ppt-reflective-core-az-v4-a9`, `session.jsonl`) made no reflective redefinitions. After inspection, the model fell back to `save_program` for a tool and `self_component` for other components, then consumed those. The narrow claim is that removing these legacy paths and refusing generic writes into component storage makes `reflect_component` the only route for agent component changes; the API can define, redefine, restore, bind, and expose only the live version for use.

The burden removed is choosing separate read, write, save, and reload operations to perform one component change. Prompt and memory changes intercede on each provider request in the same Pi session. This remains a mechanism test; no task-quality or net-benefit claim is made.

## Design

Use a single MOP surface: `reflect_component(op="inspect")` exposes live component objects; `define`, `redefine`, and `restore` manage their definitions. Tools keep executable Python, prompts keep Markdown. Binder remains the version store and validator. Generic file, Python, and trial-copy writes to component storage are refused. The Pi host rebinds the component and updates the active tool set for the next request. `context_with_system` adds active prompt and memory definitions to each outgoing request and records exact version/session consumption; `before_agent_start` still prepares task-start context. The current call and transcript are not rewritten.

The API returns name, kind, active version, path, complete definition, and source-level `used_by` references. Define accepts a new component source; redefine accepts replacement source; restore accepts a saved version number. Each publishes through Workspace and Binder, then refreshes live bindings and tool registration. Consumption reads the active image version only. Output paths such as `artifacts/deck.json` are outside the component namespace and cannot satisfy the reflective evidence check.

## Fixed boundary

The Pi kernel, the PPT host and its budget, deadline, path and provider guards, and the reflective API itself are not Binder components and cannot be changed through this operation. No loop, tower, canary, promotion flow, case record, or new worker is introduced.

## Evaluation and limits

Offline Node tests exercise the Pi extension tool surface with a local stub and real Binder/Workspace persistence. They establish function and same-extension-session wiring, not provider behavior or autonomous adoption. The authorized AZ DeepSeek validation asks the real task agent to inspect, redefine, and consume all five component kinds in the same session, with each change serving the presentation task. The checker requires a redefine followed by a same-version consumption receipt for prompt, skill, tool, subagent, and memory; deck-only writes fail. Offline tests cover legacy tool absence, generic file/Python write refusal, define/redefine/restore, and live-version consumption. Real-task outcomes are recorded below and in `.scratch/reflective-core/result-7.md`.

## Implementation and evidence

- `demo/ppt_demo_extension.ts`: reflective inspect/define/redefine/restore API; legacy save/edit/self tools removed; writes into component storage refused.
- `tests/ppt_demo.test.ts`: offline tool absence, bypass refusal, and define/redefine/use/restore coverage for all five kinds.
- `src/autoresearch_pi/ppt_demo.py`: allow selecting an AZ model for the prepared validation command.
- Results and exact validation command: `.scratch/reflective-core/result.md` and `.scratch/reflective-core/validation.md`.

| Evidence layer | Status | Environment | Result |
| --- | --- | --- | --- |
| Functional correctness | Passed | Local Node/Pi extension tests (local Pi API stub; subagent model stub) | All five kinds were redefined, consumed at the new version, rolled back to v1, and consumed again; checker positive and deck-only negative cases passed |
| Full-chain reachability | Failed | Azure DeepSeek V4 Flash (`deepseek-v4-flash`, high) | Attempts `a2` through `a5` reached the provider but stopped at the authorized $12 run guard before delivery. a4 drafted an HTML artifact; a5 did too. Neither was delivered. Evidence is in `.scratch/reflective-core/real-task-result.md`. |
| Autonomous adoption | Failed in observed attempts | Azure DeepSeek V4 Flash (`deepseek-v4-flash`, high) | a4 made no reflective redefinitions. a5 consumed prompt, memory, and skill v2, but did not run the redefined tool or consult the redefined subagent. |
| Net benefit | Unverified | Not evaluated | No benefit claim |
