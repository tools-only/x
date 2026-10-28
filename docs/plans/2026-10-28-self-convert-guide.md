# Agent-held Self conversion

Date: 2026-10-28 Asia/Shanghai. Status: implementation; behavior evaluation pending.
This supersedes the earlier same-day host-authored CONVERT guide and the host contract in the baseline plan. The user explicitly requested this ownership change. No historical logs were analyzed.


## Problem and claim
Replace host-selected conversion with agent-selected conversion on the native path. A narrow functional claim: repeated Python alone creates no CONVERT; an agent-authored note is delivered unchanged (bounded excerpt) when enabled, can be revised/cleared, and never gates actions or saves components. Python function guidance requires logic prototype before live binding. Autonomous accuracy and benefit remain hypotheses.

## Design and cost
Use existing write/edit/read on notes/convert.md. data/ is read-only, so do not loosen its boundary. Agent owns candidate, rationale, contract, adaptation and retirement. A note is optional: direct promote/self_component remains the shortest route. Host only reads up to 2000 characters into the ordinary decision with a full-file reference and records delivery. It neither generates candidates nor rewrites/clears the note. Agent clears completed/stale work, including after task/level changes. No worker, schema, mandatory report or new management turn.

Alternatives: retaining weak host hints still biases candidate selection; a new convert tool duplicates existing file tools. Reuse the writable note and existing assembly instead. Native treatment delivers authored notes; baseline only delivers them with --self-convert. All baseline runs get prototype-first guidance regardless of that flag.

First write a function with explicit arguments and explicit dependencies, check it on small inputs, then call it with workspace live values separately (same Python cell is allowed). If useful, promote_session_function extracts that named prototype; the agent adds a Self run(state,args) adapter and includes needed definitions/imports before self_component(kind=tool) or python(save). Neither export nor save captures session state; existing Binder validation/version/execution remains authoritative. Ordinary temporary Python is allowed.

## Migration and lifecycle
--self-convert now means delivery of the agent-owned note, not host suggestions. data/convert.md becomes a legacy artifact: neither read nor written; no implicit migration of host recommendations into agent intent. convert.jsonl keeps kind=shown but adds owner=agent, path, content hash and shown character count; old target/key/calls rows are historical host delivery, not comparable adoption. No file is created if the agent writes nothing. Repeated-work facts remain available to their existing consumers but no longer author CONVERT.

The next decision consumes the note unasked after the agent opts in by writing it; this replaces remembering unfinished conversion details. Saving/calling feeds back through existing Binder versions, component runs and subsequent task action evidence; the agent updates/clears its note or retires the component. A note hash identifies what was shown, not whether it changed an action. No semantic telemetry inference or new mandatory rationale field.

## Bounded evaluation
Zero paid/provider runs. Targeted Node extension/runtime/Binder tests, then two scripted-provider mock-ARC smokes (baseline and baseline+convert), each limited to two task decisions/two actions/600 seconds. Negative cases: repeated cells without note, flag disabled with note, legacy data file ignored, note replacement/clearing, missing function extraction without save, live binding separated from saved prototype. Validate explicit export/save/later call outputs with changed arguments. Preserve action availability. Stop and fix functional failures; do not expand into gameplay or log forensics.

Functional checks and scripted reachability cannot establish autonomous adoption, continuity after compaction, parent-plus-child cost savings or task benefit. Next falsifiable behavior check requires separately authorized same-model matched-budget ordinary runs comparing useful conversion decisions and later use, justified non-use, task progress, latency and total cost against the prior mechanism. No such budget is authorized here.

## Implementation and verification

Entry points: demo/arc_thin_extension.ts, both native/Self-baseline prompts, CLI help, scripted smoke provider and acceptance checks, and tests/arc_thin_level_review.test.ts. NativeRuntime, Python export and Binder semantics are reused unchanged. Implementation and test results are recorded in C:/Users/qi/tmp/r04/agent-held-convert-20261028/RESULT.md.

## Delivery decision

Retain as an opt-in baseline experiment and a replacement for native host suggestions. The functional claim is independent of the unverified claim that agent judgments improve conversion accuracy or reduce cost. No provider behavior or net benefit is claimed. Existing subagent/compaction backlog items are outside this slice and remain open.

## Verification results

- Functional correctness: passed. Windows, Node and D:/conda/python.exe hosting WASI; extension fixture uses a mock bridge/model. Final level-review suite 9/9 (level-review-final.txt); unchanged NativeRuntime 8/8 and Binder 4/4 in node-tests-final.txt. Across these suites 21 distinct tests pass after fixture corrections.
- Full-chain reachability: passed for the prescribed sequence only. Actual Pi/thin runner/bridge/Binder/WASI, scripted provider and mock ARC SDK; smoke-baseline-final/summary.json and smoke-convert-final/summary.json each pass 12/12. Two task decisions, two actions, no management round. Prototype is extracted, adapted source executes an explicit call on save, later saved-tool call takes new args, and the agent-authored note is delivered only with the baseline flag and then cleared.
- Autonomous adoption: unverified; no real provider run.
- Net benefit: unverified; no matched-budget comparison, task quality, parent-plus-child token cost or latency claim.
- Python compilation and git diff --check passed. No historical log forensics or game-source inspection.

Two initial fixture expectations were corrected: saving function definitions does not invoke run automatically, and the extension fixture must advance the Binder boundary before calling a saved tool (actual Pi supplies request boundaries). Initial test outputs remain in the job directory. The smoke assertion was narrowed to the self_component result so prototype output cannot count as save output. Final smokes were rerun after that correction.

Remaining risks: prototype-first is model guidance, not a semantic gate; Agent may still choose poor abstractions or leave a stale note. Notes persist until Agent clears them; at most 2000 trimmed characters are delivered per decision. Existing dependency diagnostics may conservatively flag a parameter name that also exists in the session; successful isolated tool calls, not that heuristic, establish execution. Export does not package transitive helper definitions automatically. No runtime/export redesign was needed for this slice.
