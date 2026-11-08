# Reflective core result 12: bind agent processes at the next request

Date: 2026-11-08 (Asia/Shanghai). Branch: `codex/ppt-reflective-core-20261108`, starting HEAD `3222e5bc`. Status: implemented and offline checked.

## Problem and claim

- **Opportunity:** the static audit in [analysis-workflow-intent.md](analysis-workflow-intent.md) §4 found that `kind=process` required coupled `workflow` and `loop` sections, activated at action/settlement hooks, and the checker treated hook changes as process adoption evidence. The demo seed path also exposed a deck reviewer, presentation workflow memory, and a prebuilt deck summary tool. No real task trace established that these mechanisms were causing a task failure; this is an interface and evidence mismatch, not a diagnosed provider failure.
- **Narrow claim:** a single free-form `strategy` with exact component `refs` can activate at the next system-context/provider-request binding, remain captured for that request, and retain the last-good active version when a pending version cannot bind. The agent can carry out the process with existing tools. Offline evidence can verify this wiring and reject obvious evidence false positives; it cannot establish that an agent authored or followed a useful process.
- **Burden removed:** process authors no longer need to write two coupled strategy sections or implement a synchronous hook just to make task strategy available on a later request.
- **Falsifier:** a scripted binding does not expose the pending strategy and exact refs on the next request; a subsequent mutation changes a captured request; a stale reference replaces the last-good process; or empty notes/hook guidance are reported as semantic adoption.
- **Scope:** PPT demo process format, provider-request context binding, seed prompt/registry, evidence report, and offline tests. No Pi turn-loop rewrite, dispatcher, stage graph, DSL, model gateway, adapter expansion, budget change, or provider run.

## Design and lifecycle

- A single process is `{strategy: string, refs: [...]}`. Existing dual `{workflow, loop}` definitions remain a compatibility path and retain their old hooks; `loop` was not renamed into a new capability.
- Pending process activation occurs in `context_with_system`, before the provider request is assembled. The injected strategy shows its process name/version and exact component versions. A request already bound to a version keeps that prompt; a later mutation is pending for a later request. Reference activation failure clears the bad pending version and leaves the active last-good version available.
- Single-process definitions do not run synchronous action or settlement hooks. The agent chooses whether to call `run_program` or `consult`, and defines any evaluator itself.
- Base guidance now only says the agent may create/modify a task process when useful, direct task work is valid, and mutations need short notes. Initial demo seeding no longer creates `deck_reviewer`, `presentation_workflow`, or `deck_file_summary`. This is an explicit behavior change. Existing environment actions, facts, and delivery checks remain in the PPT adapter.
- Each process mutation still carries one short note. There is no diagnosis operation, scorecard, required reflection cadence, or automatic process execution.
- The process evidence report separates identify/create, process adoption, self-modification, task effect, and quality. Notes, injected prompts, and legacy hook changes do not pass semantic claims. Request bindings retain process name, version, session, and exact refs for review. Quality is `not_evaluated` unless an outcome summary supplies an evaluation.
- Runtime cost added: one short optional capability sentence and active process text/refs on requests while a process is active. No new worker or fixed management turn.

## Offline evaluation

- **Checks:**
  - `node --experimental-transform-types --test --test-concurrency=1 tests/ppt_demo.test.ts` — 8 passed, 0 failed. Scripted doubles covered legacy compatibility, single-part next-request activation, captured versions, exact refs, stale-ref last-good recovery, seed registry cleanup, existing component use, and PPT offline behavior.
  - `python -m pytest tests/test_reflective_core_evidence.py -q` — 6 passed. Cases reject note-only and hook-only adoption, and verify process/session/version association reporting.
  - `git diff --check` — clean for the implementation diff.
- No provider, Azure, Qwen, or paid run was started. No secrets were written. Offline checks use scripted Pi/provider doubles and only establish local behavior/wiring.
- The seed test checks that the initial registry excludes the strategic seeds and that optional process guidance remains. Environment and delivery facts remain in the existing adapter/runtime.

| Evidence layer | Status | Provider / environment | Limit |
| --- | --- | --- | --- |
| Functional correctness | Supported for tested cases | Local Node/Python; scripted doubles | Does not validate a real Pi/provider request lifecycle. |
| Full-chain reachability | Unverified | No real-provider run | Request-context hook and version transitions were exercised in unit tests only. |
| Autonomous adoption | Unverified | No real-provider run | No evidence that a model independently identifies, creates, or follows a process; reasonable non-use remains valid. |
| Net benefit | Unverified | No paired task run | No task quality, parent/child cost, latency, or benefit comparison. |

The checker reports task effect as a placeholder and quality as `not_evaluated` absent an outcome summary. Passing offline tests does not change autonomous-adoption or net-benefit status.

## Remaining validation and deferred work

The next falsifiable check is a separately budget-authorized paired real run after George sets the budget. It should observe process creation, actual evaluator use, follow-through, any self-modification, and reasonable non-use while separately measuring task quality and total parent/child cost. This change does not authorize that run.

Deferred checklist review: A's adapter/policy boundary remains open; B/C's evaluator evidence to parent action and parent/child cost remain open; D's cross-compaction process continuity remains open. This PPT change changes no ARC adapter and closes none of A–D.

## Commit

Implementation and tests are in local commit `3a70e77a` (`Add lightweight reflective process binding`). This record is committed in a following documentation commit on the same branch; the final commit identifier is reported in the delivery summary.
