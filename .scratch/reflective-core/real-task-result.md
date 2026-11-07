# Reflective core real-task validation result

Date: 2026-11-08 (Asia/Shanghai)
Branch: `codex/ppt-reflective-core-20261108`, starting at `3b3d5571`
Provider/model: Azure `az/deepseek-v4-flash` (`deepseek-v4-flash`), thinking `high`
Task: JPMorgan Chase 3Q21 presentation, source `demo/ppt-cases/jpmorgan-chase-3q21/assets`
Per-run guard: $12 estimated API-equivalent, two-hour deadline. No B1/B2 benchmarks were run.

## Attempts

| Root | Result | Provider use | Deck delivered |
| --- | --- | ---: | --- |
| `runs/ppt-reflective-core-az-v4-a1` | Runtime startup failed before an agent response. The Pi CLI could not start because this worktree lacked the expected `node_modules` junction. Added the junction to the existing shared 0.87.0 install for later attempts. | No provider requests; no usage reported. | No |
| `runs/ppt-reflective-core-az-v4-a2` | Reached the task and redefined five components, but the model continued drafting and reviewing a three-slide prototype without consuming four kinds. The run stopped at the budget guard. | 13 requests; 230,026 tokens; estimated spend $8.7069. | No; `artifacts/prototype.html` was an undelivered three-slide prototype. |
| `runs/ppt-reflective-core-az-v4-a3` | With fresh context every four requests, the model repeatedly explored workspace files and drafted only `_part1.html`. It made no reflective changes before the budget guard. | 33 requests; 251,623 tokens; estimated spend $10.12068. | No |

`a2` and `a3` summaries say `stop: budget`; their `budget-stop.json` files record `reason: authorized budget boundary`. Attempt `a1` returned `stop: runtime_error` with `Pi RPC process exited before responding`. The offline-discovered runner defects were fixed: added fresh-run kickoff prompt support and removed a duplicate AZ agent-directory `mkdir`.

## Per-kind evidence

The checker requires a reflective redefine followed by same-session consumption at that exact version.

| Kind | `a2` evidence | `a3` evidence | Outcome and deck relevance |
| --- | --- | --- | --- |
| Prompt | `evidence-first-presentation` v2 was redefined with numeric source-line, caveat, non-GAAP, and plain-language rules. No matching consumption event. | No redefine. | FAIL. The rule was intended to improve accuracy and explainability, but it was not observed at a later task boundary. |
| Skill | `slide-quality-checklist` v2 was redefined with headline, hierarchy, sourcing, caveat, readability, layout, and coherence checks. `component_consumed` recorded `read_component`, version 2, same session. | No redefine. | PASS in `a2`; the checklist was read for the presentation work. It was not enough to get the agent through delivery. |
| Tool | `deck_validator` v2 was redefined to check slide count, headlines, source lines, number traceability, layout bounds, density, and required facts. No successful `run_program` receipt. | No redefine. | FAIL. The validator would have checked factual traceability and layout in the JPMorgan deck, but was not run. |
| Subagent | `deck-reviewer` v2 was redefined for financial accuracy, comparison basis, source lines, and non-specialist narrative. No `consult` receipt. | No redefine. | FAIL. The reviewer would have checked figures and narrative, but was not consulted. |
| Memory | `jpm-3q21-facts` v2 was redefined with key figures and source material. No matching next-task-boundary consumption event. | No redefine. | FAIL. The facts were intended to support accurate numeric claims, but the run did not cross a new task boundary after redefine. |

The `a2` transcript shows the agent created v1 components first because those names were not live at initial inspection, then redefined each to v2. It loaded the v2 skill, built a validator, and made a three-slide prototype. It did not call the validator or reviewer, and the run ended before prompt and memory were injected at a subsequent task boundary. These are observed agent follow-through failures; the checker behavior matches its lifecycle requirements. In `a3`, repeated reads and listings consumed budget before component work began.

## Checker output

`python tools/check_reflective_core_evidence.py runs/ppt-reflective-core-az-v4-a1`

```json
{"pass":false,"per_kind":{"prompt":{"pass":false,"consumed":[]},"skill":{"pass":false,"consumed":[]},"tool":{"pass":false,"consumed":[]},"subagent":{"pass":false,"consumed":[]},"memory":{"pass":false,"consumed":[]}},"reflective_redefinitions":0,"reason":"each kind requires redefine followed by same-session consumption at that version"}
```

`python tools/check_reflective_core_evidence.py runs/ppt-reflective-core-az-v4-a2`

```json
{"pass":false,"per_kind":{"prompt":{"pass":false,"consumed":[]},"skill":{"pass":true,"consumed":[{"name":"slide-quality-checklist","version":2,"boundary":"read_component"}]},"tool":{"pass":false,"consumed":[]},"subagent":{"pass":false,"consumed":[]},"memory":{"pass":false,"consumed":[]}},"reflective_redefinitions":5,"reason":"each kind requires redefine followed by same-session consumption at that version"}
```

`python tools/check_reflective_core_evidence.py runs/ppt-reflective-core-az-v4-a3`

```json
{"pass":false,"per_kind":{"prompt":{"pass":false,"consumed":[]},"skill":{"pass":false,"consumed":[]},"tool":{"pass":false,"consumed":[]},"subagent":{"pass":false,"consumed":[]},"memory":{"pass":false,"consumed":[]}},"reflective_redefinitions":0,"reason":"each kind requires redefine followed by same-session consumption at that version"}
```

## Verification and remaining gaps

- Passed offline: `PYTHONPATH=src python -m pytest tests/test_ppt_demo.py -q` (1 passed).
- Passed offline: `node --experimental-transform-types --test --test-concurrency=1 tests/ppt_demo.test.ts` (all four tests passed).
- Real-provider full-chain reachability: failed; two attempts reached the provider but neither delivered.
- Autonomous adoption: incomplete; only skill v2 had checker-valid consumption in `a2`.
- Net benefit: unverified. There is no delivered deck or matched comparison.
- Remaining work: reduce task-agent exploration overhead and ensure it calls the redefined validator and reviewer, then crosses a task boundary to consume prompt and memory before rendering and delivery. No additional attempt was authorized or run.
