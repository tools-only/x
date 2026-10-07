# Harness component recovery and assembly repair

## Status

Accepted direction; implementation and acceptance are in progress. This document
does not assert that all defects or real-model method-quality problems are solved.

## Priority revision: candidate pool first

The user approved implementation after the all-component audit. The first
acceptance boundary is now explicitly **public parent authoring -> native
persisted component version -> inspectable candidate pool -> selectable on a
later parent turn**. Drafts and research handoffs do not substitute for a
materialized, usable candidate. No additional quality-management system is a
prerequisite for this boundary.

Creation does not certify correctness or utility. Minimum component-specific
execution contracts, creator provenance, permission checks, exact references,
and explicit assembly remain required. Success history, counterexamples,
cross-situation evidence, and a complete universal method dossier must not be
creation prerequisites. Runtime must not invent missing semantic fields.

| Kind | Admission intent |
| --- | --- |
| memory | An identified, authored fact/hypothesis with explicit lifecycle scope; no claim of verified truth |
| skill | Main-authored executable procedure and use trigger, using skill-creator; single-situation and untested are valid, trajectory-only notes are not methods |
| tool | Main-authored Pi computation with supported executable program/input-output contract and permissions, using tool-creator; no proof of utility required |
| subagent | Main-authored role/instructions and authorized context/tool contract, using subagent-creator; clean-context reasoning with an empty tool set is valid |
| system_prompt | Independently authored prompt component with explicit scope, persisted before optional selection; creation must not require a second base component or a proven stable rule |

`task_prompt` remains the source-agnostic output of assembly, not a sixth native
component. Research produces evidence and method candidates for main to author;
incomplete quality metadata must not discard a valid report or prevent main
from completing the candidate. Research is not an authoring prerequisite.

The 2026-09-23 pre-change audit ran five focused suites: **88 passed, 4 failed**.
Failures cover assembly CAS omission, review metadata preservation, conflicting
review identities, and the absent revisioned draft repair API. Some historical
positive fixtures inject creator/method data or call internal mutation tools;
the new acceptance path must not rely on these conveniences to demonstrate
public-interface reachability.

Implementation owner: user-requested GPT-5.6 SOL. Verification controller:
user-requested Luna. Preserve the current dirty branch; no commit/push.
Full pytest and fresh real-SDK `arc-harness-smoke` remain required. Provider
mocking is allowed for this wiring acceptance; no paid provider run is claimed
or launched by this implementation stage.

The user's subsequent clarification makes ordering explicit: finish the five-kind
creation, pool, assembly, and runtime-use path before expanding draft recovery
or quality/lifecycle mechanisms. Full `method` metadata is optional. On the first
implementation checkpoint, the public five-kind admission test and malformed
optional-metadata test passed independently (2 passed). This proves admission
only; real-SDK runtime acceptance is still pending.

### Minimum-path runtime checkpoint

`runs/luna-minimal-five-real-20260923-a/arc-self-harness-smoke-summary.json`
records a fresh real-SDK `minimal-five-pool` run: 28 checks passed, provider
mocked, environment and runtime boundaries not mocked. Root inspected the
native Skill record (creator-authored, untested, no `method`), exact five-ref
assembly revision 1, Tool invocation with semantic result `2`, and later
provider-context markers. The run created all five candidates before selection
and completed two ARC actions after explicit assembly.

This is a minimum-path checkpoint, not full-suite or model-quality acceptance.
The Skill focus assertion is being strengthened to require delivered content,
not merely an attempted call. The complete baseline ARC matrix and full pytest
regression are running separately. Review-draft recovery remains deferred from
the minimum-path acceptance; its unfinished tests must be reported rather than
silently treated as passing.

Full regression audit command:
`D:/conda/python.exe -m pytest -q --tb=short --basetemp D:/autoresearch_pi_project/runs/pytest-root-pool-full-20260923-c`.
It finished with **596 passed, 58 failed in 895.83 seconds**. This audit overlapped
ongoing fixture/guidance edits, so its collected tests are not a frozen final
snapshot. It is not a green-suite claim. Failures include the unfinished review
draft API/normalization tests, legacy native lifecycle/projection assumptions,
missing creator-authored descriptions in fixtures, old prompt expectations,
and external Shopping Python initialization errors. Some related fixture failures
were subsequently fixed and need targeted rerun; failures outside the focused
repair remain unclassified as to regression origin, not automatically pre-existing.

The first fresh 15-case real-SDK matrix at
`runs/luna-baseline14-minimal-real-20260923-a` passed 11 cases. Four Memory cases
failed because their auxiliary `smoke-dependent` Skill omitted its description;
the creation batch failed, so subsequent policy assembly and lifecycle assertions
cascaded. This is being corrected in the authored fixture without relaxing the
lifecycle assertions or production admission contract.

## Evidence and scope

The real ARC run `arc-meta-process-real-provider-round2-20260923-124242`
delivered the capability process to actual provider requests. The parent named
procedural opportunities, but malformed review entries exhausted the review
failure budget. Recovery copied a memory candidate without the outer component
type; subsequent calls failed on missing type and identity. No successful review
meant no capability follow-up, despite the parent-authored method opportunity.

The requested repair covers conversion, error recovery, immutable component
application, exact-version assembly, and native use. Preserve current branch and
unrelated changes. Do not modify historical run snapshots.

## Decision

1. Normalize explicitly supplied component metadata consistently across review,
   recovery, and change. Reject conflicting identities; do not infer a method or
   component kind from narrative content.
2. Preserve parent-authored failed submissions as recoverable drafts with exact
   revisions. A parent can repair named fields without regenerating correct
   content. Draft storage never publishes or executes a component.
3. Return independently detectable contract defects together. Keep schema,
   disclosed contracts, and runtime validation consistent.
4. A retry budget closes a synchronous review attempt, not the unresolved
   parent-authored capability intent. Keep explicit deferral possible and avoid
   component quotas or new environment-action gates.
5. Distinguish review recording from component application. Report partial
   application honestly and never replay already-successful mutations when
   recovering remaining work. Do not advertise unsupported batch atomicity.
6. Require explicit assembly CAS and exact eligible references. Preserve the
   parent's choices and prompt contributions during repair. Distinguish durable
   selection from a failed update to the executable tool surface.

Main owns creator reading, semantic authoring, selection, ARC actions, and effect
judgment. Research remains optional; runtime performs deterministic bookkeeping,
validation, projection, and execution only.

## Alternatives not selected

- More prose alone: does not repair the evidenced contract/state failures.
- Automatic component generation or automatic carrier selection: crosses the
  main/runtime responsibility boundary.
- Unlimited review retries: hides recovery deficiencies and can stall the game.
- Treating a mock provider's scripted success as real-model quality: conflates
  wiring with behavior and usefulness.

## Verification matrix

| Boundary | Required evidence |
| --- | --- |
| Canonical contract | Missing type/identity and conflicting metadata regressions; no invented semantic fields |
| Repair | Original content preserved, exact-revision field repair, stale repair rejected |
| Opportunity lifecycle | Failed/expired review preserves authored opportunity across inspection/restart; explicit defer remains valid |
| Component application | Failure is visible; partial results attributable; successful versions not duplicated on retry |
| Assembly | Required CAS, stale refs/dependencies rejected, rejected selection does not replace prior assembly |
| Native Skill path | Mock provider calls creator, submits full procedural body, assembles/focuses exact version, uses it in ARC, assesses later |
| Existing paths | Five component types, semantic Tool output, Auto-Research and delegate length continuation retained |
| Regression | Full project pytest plus real SDK `arc-harness-smoke`; record all failures |

Mocking the provider is authorized for deterministic regression. The bridge,
Pi parent loop, broker/child path, router, mutations, ARC boundary, and later
parent turn remain real for ARC wiring acceptance. Real-provider output quality
and benchmark benefit require separate evidence and are not inferred here.

## Risks

Drafts add lifecycle state and need stale-revision handling. Stricter contracts
can expose old callers that omitted required metadata. Partial application needs
precise receipts, not a misleading all-or-nothing claim. Persistent opportunities
must not reinterpret rejected submissions as valid skills or force adoption.
