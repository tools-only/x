# Pi 0.87.0 thin ARC compaction probe — 2026-10-12

**Classification: (b) delivery-only failure, as the first repair boundary.** The probe also exposes (c) input loss. Per the approved final plan, fix (b), re-probe, then treat (c) only if it remains. This is a scripted diagnostic, not autonomous ARC behavior or a net-benefit result.

## Problem and claim

The existing session-continuity `context` projection may discard Pi's `compactionSummary` even when native compaction succeeds. A 10,000-character ARC receipt may also lose a counterexample after character 2,000 in Pi's serializer. The narrow claim under test is that the native summary reaches the next ordinary provider request with decisive evidence and a current complete grid, without a parent maintenance turn. A stored summary alone does not support it.

## Protocol and artifacts

`PYTHONPATH=src python -m autoresearch_pi.cli arc-thin-compaction-probe --root runs/arc-thin-compaction-probe-20261012-codex` exited 0. The isolated run's `run-config.json` identifies project `node_modules/@earendil-works/pi-coding-agent/dist/cli.js`, Pi **0.87.0**, `offline-arc-thin-smoke/scripted`, and zero paid tokens. Eight independently seeded sessions use the real Pi RPC, native compaction, actual thin ARC extension and local fake bridge. Raw per-variant `compaction-probe.jsonl`, `probe-provider.jsonl`, `pi-events.jsonl`, `harness/context_budget.jsonl`, and aggregate `summary.json` are under that root. Local probe compaction settings are `reserveTokens=1200`, `keepRecentTokens=1600` (V3: 200), auto disabled; they are deliberately *not* recommended real-provider settings. Seeded assistant usage of 1+1 tokens makes `tokensBefore=530` synthetic rather than representative of provider billing.

| Variant | Serialized input / reasoning / tool-result chars | Clipped results | Summary calls | Result / next request / action |
| --- | ---: | ---: | ---: | --- |
| V1 reasoning | 45,786 / 6,287 / 36,971 | 18 | 1 | Stored; invisible; ACTION1 |
| V2 late counterexample | 45,786 / 6,287 / 36,971 | 18 | 1 | Late marker absent from summary input and next request |
| V3 split turn | 48,017 / 6,326 / 39,025 | 19 | 2 | `isSplitTurn=true`, prefix 1, combined usage stored; invisible |
| V4 eight decisions | 19,022 / 5,819 / 12,323 | 6 | 1 | Summary stored, next ordinary provider request excludes it; ACTION1 |
| V5 repeated | 45,786 / 6,287 / 36,971 | 18 | 2 | Second preparation receives 117-character prior summary; next-request visibility still fails |
| V6 abort | 45,786 / 6,287 / 36,971 | 18 | 1 interrupted | `aborted=true`, no stored entry; 163 ms |
| V7 length | 45,786 / 6,287 / 36,971 | 18 | 1 | Rejected incomplete summary, no stored entry |
| V8 non-use | no eligible input | 0 | 0 | `Nothing to compact (session too small)`, no forced model call |

Reasoning accounts for 13.7% of V1/V2 serialized characters and 30.6% of V4; tool-result evidence accounts for 80.7% and 64.8% respectively. Six V4 and eighteen V2 tool results are clipped by the 2,000-character serializer. The V2 counterexample after character 2,000 reaches neither serialized input nor the next ordinary request. The hypothesis's explicit refutation *does* reach summary input, but summary delivery fails independently. The current grid text reaches the V3–V5 next ordinary transcript. `firstKeptEntryId` names a retained user message in V1–V5; native `buildSessionProjection()` parses cleanly with a `compactionSummary` followed by retained user/assistant/tool-result triples. No orphan pair was observed in the projection; wire-level pairing after the repair remains a smoke gate. V4 records one context-budget row but no compaction-event column yet.

## Design and cost decision

First repair exactly the `historyMessages()` delivery boundary in `demo/arc_thin_extension.ts`, scoped to `--continuity session`; do not replace Pi's summary or add a ledger-driven summarizer. Then re-run the same provider-transcript/action probe. Only if the late counterexample still fails, adapt the serialization-time receipt within the native `session_before_compact` preparation. Preserve `rebuild`, permissions, version integrity and current observation. This adds no worker, parent action gate or resident prompt. V8 justifies non-use. Rollback for later enable is `ARC_THIN_AUTO_COMPACTION=0`.

The funnel is: synthetic opportunity (V1–V5) → Pi recognizes compaction → native summary candidate stored → canonical projection assembles it → thin extension drops it → no semantic next-request use → scripted ACTION1 instead of the evidence-consistent ACTION4. V6–V8 stop without a durable candidate. The repair removes a missing transition, not an agent decision. The local probe takes approximately 25–55 ms per successful compaction, 163 ms for the abort; totals exclude process startup and are not real-provider latency. Parent/child model cost and real task progress remain unknown.

## Evidence boundary and next check

| Layer | Status | Provider/environment | Artifact / limit |
| --- | --- | --- | --- |
| Functional diagnosis | Supported | Pi 0.87.0, scripted offline | `summary.json`, per-variant hook and provider transcripts; (b) plus latent (c) |
| Full-chain reachability | Unverified | Real ARC bridge/Pi parent not run here | Scripted local bridge is not `arc-harness-smoke` acceptance |
| Autonomous adoption | Unverified | Real yibu provider not run | Script chooses compaction and actions |
| Net benefit | Unverified | Real ARC tasks not run | Synthetic usage and zero-cost scripted provider cannot estimate it |

Phase 3 changes one factor then re-probes. Phase 4 must verify semantic next-request text, action, telemetry, baseline smokes and tests. **Uncapped real ARC was deferred until after Phase 3/4 freeze; see Phase 3 repair section below.** The deferred context-compaction continuity and parent-plus-child cost questions in `docs/deferred-research-todos.md` remain open; this diagnostic does not authorize unrelated backlog work.

---

## Phase 3 repair and re-probe (post-fix)

**Resume point:** Codex handoff was interrupted mid-apply_patch while appending this report; product diffs for Phase 3b+3c were already in the working tree. Orphan  PID 877620 was killed; desktop app-server PID 220564 left running.

### Classification after repair

Initial probe classified **(b) delivery failure** with latent **(c) input loss**. Per final-plan mutual exclusion, (b) was fixed first; (c) was also present in the same interrupted Codex batch via  truthful receipt rewriting. Re-probe confirms both boundaries are repaired.

### Product changes

- **3b delivery:**   now projects the latest  ahead of the retained decision suffix under . Rebuild path unchanged.
- **3c input:**  rewrites oversized tool-result bodies to short truthful receipts (header + sha256 artifact path + excerpt) before native serialization; artifacts under .
- **3a enable/telemetry:**  only when continuity is  (default still off).  /  rows land in .
- Probe harness: , CLI , smoke-provider probe path, , projection unit test.

### Re-probe evidence

Final offline probe:  (also confirmed via ).

| Variant | compact | nextRequestHasSummary | counterexampleInNext | clippedResults | action |
| --- | --- | --- | --- | ---: | --- |
| V1–V5 | success | true | true | 0 | ACTION4 |
| V6 | aborted | false | false | 0 | (none) |
| V7 | length fail | false | false | 0 | (none) |
| V8 | session too small | false | false | — | (none) |

Compared with the pre-fix diagnostic (18 clipped results on V1/V2; summary stored but invisible; ACTION1), the next ordinary provider transcript now sees the native checkpoint and the decisive counterexample, and the scripted follow-on action is ACTION4.

### Phase 4 focused gates (parent diagnostic)

- thin Node tests 85/85
- focused pytest 25/25
- scripted smokes: continuity / self-harness / ledger / environment green
- Broad historical `versions/arc/stage*` suites not treated as blockers

### Phase 5

Uncapped real ARC is authorized after this freeze (George). Exact launch commands are recorded in `.scratch/codex-compaction-impl-brief.md` and the Phase 5 `run-config.json`.
