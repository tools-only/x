# Harness Efficiency and Selection Implementation Plan

**Goal:** Reduce ARC management/context overhead while making research and Memory candidates easier for the parent to use.

**Architecture:** Keep the parent as the sole semantic author and assembler. The runtime projects bounded, actionable indexes backed by exact durable refs; complete evidence and contracts remain on-demand. Do not introduce an adapter, automatic conversion, or component quota.

**Tech Stack:** Pi TypeScript extension, Python pytest/Pi fixture, ARC harness smoke.

## Decision and trade-offs

- Prefer a short context card plus an exact inspect/read path over repeated full review windows. This saves recurring input but may require one explicit lookup when a review is submitted.
- Show research handoff's already-stored Creator call and method ref. This removes a discovery round but still requires parent authoring, exact change, assembly, use, and feedback.
- Show a bounded, eligibility-filtered Memory shortlist. Selection remains explicit; no implicit memory injection.
- Keep all component entrypoints visible. Trim repeated natural-language guidance and do not weaken version or semantic-output checks.
- Keep every typed tool parameter, enum, minimum and nesting intact. Only descriptions are shortened; the full `level_review` remains typed in the tool schema despite its on-demand evidence contract.

## Steps

1. Add regression tests for concise review cards, actionable research handoffs, and bounded eligible Memory suggestions; confirm they fail against the current projection.
2. Implement review-card projection and exact on-demand contract/read access without changing level-review validation.
3. Implement research Creator handoff and Memory shortlist projection, with deterministic order and exact refs.
4. Measure fixed context/schema size before/after, run targeted tests and full real-runner `arc-harness-smoke` matrix. Do not claim real-provider performance from deterministic smoke.

## Schema measurement (same fixture and tool set)

The typed schema before description editing measured 22,376 serialized JSON characters; after editing it measured 18,211 (−18.6%). A description-stripped structural hash test covers ten Harness/Research tools, so this reduction is not from deleting fields, actions, enum values, or constraints. The remaining description-stripped schema alone is 15,829 characters. Cross-run ARC totals have different tool/schema stages and are reported separately, not used as this paired comparison.

Current ARC smoke telemetry reports 19,681 first-request tool JSON characters. The earlier real-provider run reported 20,669, but it was a different tool/schema stage, so the 4.8% difference is only an operational observation, not a controlled compression estimate. The post-edit `arc-harness-smoke` passed 16/16 scenarios and 393/393 checks on the real ARC bridge/environment with a deterministic provider; this verifies wiring, not provider game quality or token savings.

## Failure modes

- A short card may omit a valid ref: `task_harness(action=inspect)` still exposes the full pending window; the outcome cost index stays readable.
- Stale or expired Memory may mislead: shortlist includes only currently eligible versions and exposes scope and exact ref.
- Research prompt may be read as automatic conversion: explicitly label candidates as unadopted and retain parent-owned Creator/change/assemble/trial boundaries.
- Reduced schema/prompt text may increase invalid calls: retain required field names and targeted contract tests.
