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

## Follow-up hot-swap validation (a4/a5)

The lifecycle defect was fixed before these attempts. Prompt and memory definitions are now injected by Pi's `context_with_system` hook on each outgoing provider request, with a `component_consumed` receipt containing the runtime session id, component name, exact version, and request boundary. This lets a redefine take effect on the next model request in the same Pi session, without waiting for another task start. The existing `before_agent_start` hook still initializes task context. Offline coverage exercises the request hook after redefine and rollback without another `before_agent_start` call.

| Root | Result | Provider use | Deck delivered |
| --- | --- | ---: | --- |
| `runs/ppt-reflective-core-az-v4-a4` | Budget stop. The agent created prompt, memory, skill, and reviewer components but made no `reflect_component(op="redefine")` calls. It drafted `workspace/artifacts/presentation.html`; evidence checker failed all kinds. | 10 requests; 308,454 reported tokens; estimated spend $8.7522. | No; artifact was not delivered. |
| `runs/ppt-reflective-core-az-v4-a5` | Budget stop. All five kinds were redefined. Prompt, memory, and skill were consumed at v2 in-session; tool and subagent were not consumed before stop. `workspace/artifacts/presentation.html` exists. | 14 requests; 244,545 reported tokens; estimated spend $9.81454. | No; artifact was not delivered. |

### a4 per-kind evidence and checker output

| Kind | Evidence |
| --- | --- |
| Prompt | A v1 prompt was created; no reflective redefine and no valid checker consumption. |
| Memory | A v1 memory entry was created; no reflective redefine and no valid checker consumption. |
| Skill | A v1 skill was created; no reflective redefine and no valid checker consumption. |
| Tool | No recorded successful program use; no valid redefine/use pair. |
| Subagent | A reviewer component was created; no reflective redefine/consult pair. |

```json
{"pass":false,"per_kind":{"prompt":{"pass":false,"consumed":[]},"skill":{"pass":false,"consumed":[]},"tool":{"pass":false,"consumed":[]},"subagent":{"pass":false,"consumed":[]},"memory":{"pass":false,"consumed":[]}},"reflective_redefinitions":0,"reason":"each kind requires redefine followed by same-session consumption at that version"}
```

### a5 per-kind evidence and checker output

| Kind | Evidence |
| --- | --- |
| Prompt | `evidence_source_rule` v2 redefined and consumed at `context_with_system provider request`, same session. PASS. |
| Memory | `verified_facts` v2 redefined and consumed at `context_with_system provider request`, same session. PASS. |
| Skill | `slide_checklist` v2 redefined and consumed via `read_component`, same session. PASS. |
| Tool | `numeric_source_validator` v2 redefined; no successful `run_program` receipt. FAIL. |
| Subagent | `financial_accuracy_reviewer` v2 redefined; no `consult` receipt. FAIL. |

```json
{"pass":false,"per_kind":{"prompt":{"pass":true,"consumed":[{"name":"evidence_source_rule","version":2,"boundary":"context_with_system provider request"}]},"skill":{"pass":true,"consumed":[{"name":"slide_checklist","version":2,"boundary":"read_component"}]},"tool":{"pass":false,"consumed":[]},"subagent":{"pass":false,"consumed":[]},"memory":{"pass":true,"consumed":[{"name":"verified_facts","version":2,"boundary":"context_with_system provider request"}]},"reflective_redefinitions":5,"reason":"each kind requires redefine followed by same-session consumption at that version"}
```

The five-kind acceptance check did not pass in either run, and neither deck was delivered. The hot-swap defect is functionally covered offline and observed working in a5. Full-chain delivery and autonomous use of the redefined tool and reviewer remain failed in these bounded attempts; net benefit remains unverified. The two authorized follow-up attempts are exhausted; no B1/B2 benchmarks or further paid attempts were run.

## a5 free diagnosis and a6 follow-up

The full free diagnosis is in [a5-diagnosis.md](a5-diagnosis.md). In a5, neither `run_program` nor `consult` was attempted after the v2 definitions: no tool-call events or component run receipts exist. The evidence supports an adoption/sequence failure, not a runtime, argument, validation, definition, or timeout failure. The model continued inspecting files, then spent its largest response producing a 15-slide HTML deck (11,715 output tokens, $1.6259). a5's initial inspect returned `[]`; later inspect/redefine output sizes were avoidable but not the main cost driver. Per-request exact system-prompt chars were not recorded. The a5 run reached $9.81454 across 14 requests and stopped at the $12 guard.

Changes for a6: `reflect_component(op="inspect")` now returns component metadata and a detail-read pointer instead of full source; redefine receipts give the next exact action for the new version and direct source inspection to `read_component`/`read`. The a6 kickoff asks for the five redefine/use steps first, in the requested order (tool/run, subagent/consult, skill/read, prompt, memory), then a 3–5 slide deck, validation, render, and delivery. Offline PPT extension tests passed 4/4 before the provider attempt.

| Run | Result | Provider/model | Spend and requests | Delivered |
| --- | --- | --- | ---: | --- |
| `runs/ppt-reflective-core-az-v4-a6` | Provider requests timed out through Pi's three-attempt retry cycle before an assistant response. Budget reservation stopped the run. | AZ `az/deepseek-v4-flash`, thinking high | $10.56 conservative reserved; 3 requests, 36,000 reserved tokens. No provider usage was reported, so actual spend is unknown. | No deck created or delivered. |

### a6 per-kind evidence and checker

No assistant response or component lifecycle action occurred before the provider timeout. All five kinds remain unconsumed and have zero reflective redefinitions; this run provides no new autonomy evidence.

```json
{"pass":false,"per_kind":{"prompt":{"pass":false,"consumed":[]},"skill":{"pass":false,"consumed":[]},"tool":{"pass":false,"consumed":[]},"subagent":{"pass":false,"consumed":[]},"memory":{"pass":false,"consumed":[]}},"reflective_redefinitions":0,"reason":"each kind requires redefine followed by same-session consumption at that version"}
```

Functional correctness: the offline extension tests pass 4/4, including concise inspect and explicit tool-use receipt coverage. Full-chain reachability for a6: unverified because no model turn completed. Autonomous adoption: unverified in a6; a5 had prompt, skill, and memory consumption only. Net benefit: unverified; there is no delivered deck or matched-budget comparison. No further paid attempts or B1/B2 runs were made.
