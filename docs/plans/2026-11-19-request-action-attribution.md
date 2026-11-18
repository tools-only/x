# ARC request-time action attribution

Date: 2026-11-19. Status: implementation; provider behavior and benefit unverified.

## Problem and claim

- Opportunity: `reuse_report.json` inferred a provider request's action interval from Python-call rows sharing its decision. That drops no-Python requests and cannot resolve decisions spanning multiple action counts.
- Claim: capturing the completed trajectory count at `request_prepared` gives every new provider attempt a direct action interval, independent of Python use or later settlement.
- Burden removed: post-run analysis no longer reconstructs request timing from unrelated Python rows.
- Scope: host-side request telemetry and report parser only. No prompt, gameplay, SelfRoot, extension behavior or provider request content changes.

## Design and cost

- The request tracer reads the count of rows in `harness/trajectory.jsonl` when preparing each request and writes `actions_completed_before_request` on its trace record. This also reflects completed members of an action batch before the next provider request.
- The report groups prepared attempts by this field. Failed and unsettled attempts remain attached to their interval. Historical events without the field remain explicitly unassigned.
- Cost: one small local trajectory read per provider request; no provider calls, additional prompt content, or model decisions.
- Permissions and environment boundaries are unchanged.

## Validation and evidence

- Functional checks: `node --experimental-transform-types --test --test-concurrency=1 tests/arc_thin_requests.test.ts` passed (4 tests); `PYTHONPATH=src python -m pytest tests/test_arc_thin_request_accounting.py -q` passed (6 tests); `python -m py_compile src/autoresearch_pi/arc_thin_reuse_report.py` and `git diff --check` passed.
- Request tracer captures changing counts; report groups requests directly and keeps failed, unsettled and legacy-unattributed attempts visible.
- Full chain: unverified until an ARC thin runner writes a real request trace and the report consumes it.
- Autonomous adoption: not applicable; this is telemetry.
- Net benefit: unverified; no run comparison performed.
- Provider/environment: none; no provider started.

## Decision

Keep as telemetry implementation. Real-run behavior and performance impact are unmeasured; this records measurement attribution and does not claim runtime efficiency gains.
