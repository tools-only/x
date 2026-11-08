# Change record: design-11 tickets 1–4

Date: 2026-11-08
Branch: `codex/ppt-reflective-core-20261108`
Base: `0b6165451a6dedfc4ae39fb08dda96ef014f33b2`

## Failure or opportunity

The PPT extension mixed PPT source/delivery facts with reflective process execution, activation, prompt injection, and hook enforcement. The runner chose continuation prompts directly in the Pi loop, and the evidence checker owned both lifecycle joins and its CLI. This made the current boundaries hard to inspect and reuse, even though the design calls for a behavior-preserving peel.

## Claim and burden removed

Moving these existing responsibilities behind small local adapter/core/policy modules preserves observable PPT behavior while making ownership explicit. Developers can locate PPT facts and gates, fixed process machinery, runner policy, and evidence joins without copying or interpreting mixed host logic. No behavior or net-benefit claim is made.

## Scope and falsifier

Implemented Luna tickets 1–4 only. Existing `office` actions and result shapes, source precedence, render receipts, SHA-256 delivery gate, process activation and last-good behavior, hook coverage, prompt bytes, continuation defaults, timings, and budget settings remain compatibility inputs. Existing hook sites are named `before-action`, `before-submit/deliver`, and `settle`; `look` and after-action remain uncovered. Delivery remains the only completion signal; quality is reported separately as not evaluated.

Falsifiers were a changed prompt/default/decision/receipt/verdict, changed boundary ordering, a delivery gate bypass, or loss of last-good/incomplete state on a negative case. Offline acceptance was limited to the requested tests, scripted production-path doubles, and baseline/candidate comparisons. No provider launch was authorized or performed.

## File and layer map after peel

| File | Ownership |
| --- | --- |
| `demo/ppt_demo_adapter.ts` | PPT goal/action names and description; canonical source precedence; source/status facts; receipt integrity checks for canonical path, current hash, and current revision. |
| `demo/ppt_reflective_core.ts` | Hook sandbox/executor and validation; exact-reference activation; last-good restoration; process strategy/receipt context injection; before-action and settle execution/guards; local generic boundary names. |
| `demo/ppt_demo_extension.ts` | PPT render/look/deliver effects and native receipts/assets; office schemas/results; workspace/provider/budget integrity boundaries; registers the existing process and environment call sites. |
| `src/autoresearch_pi/ppt_demo_continuation.py` | Initial and next continuation intent; explicitly named legacy core fallback; translation from intent to Pi prompt transport strings. |
| `src/autoresearch_pi/ppt_demo.py` | Runner, PiKernel lifecycle, transport invocation, delivery/error precedence, and unchanged launch/budget configuration. |
| `tools/reflective_core_evidence_joins.py` | Historical, new-creation, and process evidence joins and existing verdict calculations. |
| `tools/check_reflective_core_evidence.py` | CLI/reporting wrapper; adds a separate PPT delivery/quality field when `summary.json` exists, without feeding it into core verdicts. |
| `tests/ppt_demo.test.ts`, `tests/test_ppt_demo.py`, `tests/test_reflective_core_evidence.py` | Offline production doubles, continuation cases, negative delivery/process recovery checks, and separate outcome reporting checks. |

## Bounded evaluation and results

Baseline (`0b616545`), before edits:

- `node --experimental-transform-types --test --test-concurrency=1 tests/ppt_demo.test.ts` — 7 passed, 0 failed.
- `python -m pytest tests/test_ppt_demo.py tests/test_reflective_core_evidence.py -q` — 6 passed.

Candidate, after edits:

- `node --experimental-transform-types --test --test-concurrency=1 tests/ppt_demo.test.ts` — 7 passed, 0 failed. The scripted Pi/renderer path exercised receipt creation, render/look/deliver, stale-source SHA rejection, and process activation/recovery. The denial case asserts no delivery, prior active version retained, and `complete=false`.
- `python -m pytest tests/test_ppt_demo.py tests/test_reflective_core_evidence.py -q` — 8 passed. Exact prompt strings and legacy length/fresh-batch defaults passed; delivery reporting remained separate from the core process verdict.
- Differential check loaded the original checker at the base commit and compared full result objects against the extracted joins for `historical`, `new-creation`, and `process` fixtures — exact equality in all three modes.
- `git diff --check` — passed. Prompt/seed files were not edited.

Parity review: process hook input/log ordering and `message_end` → `agent_end` settlement remain at their prior sites; activation stays at workflow/settle boundaries. Office schemas, results, renderer invocation and timeout, source precedence, receipt fields, copy behavior, SHA comparison, and completion assignment remain unchanged. Continuation intent maps to the same prompt bytes (`PPT_RESUME`, `PPT_NEXT`, or the supplied guidance); the fresh-batch length-limit exception is preserved. Checker verdict fields and full core results are unchanged. The only checker output addition is the separate `ppt_outcome` field when a run summary exists; it reports delivery and `quality: not_evaluated` and does not affect `pass`.

## Evidence level and limits

- Functional correctness: **passed for the offline tests and scripted doubles above**.
- Full-chain reachability: **unverified**; no real provider/model run was authorized or attempted. The scripted PiKernel/Pi and renderer doubles establish wiring only.
- Autonomous adoption: **unverified**; no in-run agent evaluated or chose these components.
- Net benefit: **unverified**; no provider task, matched run, latency/cost study, or task-quality comparison was performed.

No `az` provider, model API, secrets, push, or paid task was used. Budget defaults and timeouts were not changed. Remaining coupling includes PPT action execution, task brief/material, renderer subprocess, and artifact packaging in the extension/runner; Pi event registration and settlement remain coupled to the extension. Adapter boundary work in deferred checklist A and parent/child/context continuity items B–D remain open; this peel closes none of them.

## Commit

Local commit: `Peel PPT adapter and reflective core boundaries` (commit ID reported with delivery).

## Summary

The PPT adapter peel separates PPT facts and delivery integrity, process machinery, runner continuation policy, and checker joins while preserving the existing offline-observable behavior. Real-provider adoption and benefit remain unverified.
