# Reflective core round 9

## Change and claim

Opportunity: the prior real tasks prescribed five redefinitions, so their successful historical check did not establish agent-chosen creation and same-session use. This implementation adds only a brief note to existing mutations, one-shot discovery after definition, and an evidence mode for genuinely new tool/skill/subagent creation. It leaves the component kinds, Binder, registration, consumers, and publication boundaries in place.

## Files

- `demo/ppt_demo_extension.ts`: rejects missing/blank notes before mutation; logs notes beside successful lifecycle changes and failed Binder publication; queues successful define entries for the next request context with purpose, version, and consumer endpoint; records the initial active registry once.
- `demo/prompts/ppt_demo_system.md`: adds the single approved base instruction.
- `tools/check_reflective_core_evidence.py`: preserves the prescribed-redefine mode (`--mode historical`) and adds `--mode new-creation`, initial registry comparison, definition/use evidence, all lifecycle changes, and claim statuses.
- `tests/ppt_demo.test.ts`, `tests/test_reflective_core_evidence.py`: cover missing-note rejection, production-path discovery and use, and checker positive and negative cases.
- `.scratch/reflective-core/d1-kickoff.txt`: actual full-deck task brief, with no component instructions or creation demand. It was not run.

No existing hot-swap, in-flight version, restore, failed-publication recovery, or confinement code was replaced. The lifecycle event is written by the same mutation call; successful define discovery is drained after its first presentation.

## Verification

- `PYTHONPATH=src python -m pytest tests/test_ppt_demo.py -q`: passed, 1 test.
- `node --experimental-transform-types --test --test-concurrency=1 tests/ppt_demo.test.ts`: passed, 6 tests, 0 failures.
- `PYTHONPATH=src python -m pytest tests/test_reflective_core_evidence.py -q`: passed, 3 tests.
- `git diff --check`: passed.
- Scripted offline production-path smoke: new tool, skill, and subagent were defined from an initially absent registry; the following system-context request showed each name, purpose, version, and use endpoint; the tool returned a successful result, the skill source was read, and the subagent returned through `consult`. All three notes and discovery rows appeared in the lifecycle log. This uses the in-process Pi extension harness and a local stub for consult; it is wiring evidence, not provider behavior.

Checker outcomes on existing traces:

| Run | Historical prescribed-redefine | New creation |
| --- | --- | --- |
| a10 | pass, all five versions consumed | fail; no new definitions, notes, or initial registry snapshot |
| q1 | pass, all five versions consumed | fail; only redefinitions, no notes or initial registry snapshot |

The new mode reports skill read-only evidence as uncertain because logs cannot show that the procedure was followed. Subagent parent use is inferred from later successful parent tool work and remains an imperfect proxy; semantic review is still needed. Failed/unused definitions remain listed with their note and use status. Source hash comparison catches same-kind seed copies even when renamed. Existing legacy rows do not gain missing notes retroactively.

## Evidence levels and limits

- Functional correctness: offline tests pass for validation, lifecycle recording, discovery, consumer reachability, and checker classifications.
- Full-chain reachability: demonstrated through the local scripted production path for all three target kinds, with consult stubbed.
- Autonomous adoption: unverified. No model/provider task was run.
- Task improvement and net benefit: unverified. The smoke has no deck-quality outcome or matched cost comparison.
- Provider/environment: local checkout and scripted in-process provider stub only. No real or paid provider task, az provider call, or model API call was made.

## Proposed bounded real-run protocol for George to authorize

Use `qwen3.8-27b` on the **az provider**, including any child consults, with the same pinned Pi and task-visible context. No run is authorized by this implementation. If authorized, compare two baseline and two treatment runs on the same full-deck brief, source materials, seed state, model settings, and per-run total budget; randomize run order. The treatment gets the new reflective path. The baseline retains the current prescribed/redefine path. Cap each run at 45 minutes and USD 12 total parent-plus-child spend (USD 48 maximum across four runs); stop on the first budget boundary, unknown-usage condition that would exceed the cap, or 45-minute timeout, and retain failed/pending work in the accounting. Freeze a delivery rubric before starting: required slide count/order and content constraints, factual traceability, render validity, and successful delivery. Report task outcomes, definition and actual-use evidence, total cost/tokens/latency/management turns, and failures separately. A creation-and-use trace establishes adoption only; claim net benefit only if replicated treatment quality is acceptable and aggregate cost/latency is favorable under the fixed comparison. Historical a10/q1 are not baseline observations.

Deferred backlog connection: B/C child-answer quality, parent use, and total cost; D continuity across context changes remain open. These checks do not resolve those items.

## Commit

Implementation and evidence report committed locally as `Implement reflective core creation evidence`; not pushed.
