# Foundation fixes merged into native compaction

Date: 2026-10-13 (Asia/Shanghai). Status: implemented; functional and scoped scripted lifecycle validation passed; autonomous adoption and net benefit unverified.

## Problem and claim

The source branch `claude/foundation-fixes-20261012` at `8bfbd17a` contains fixes from the real ls20 failure (mistyped result refs, repeated computation, WASI directory lookup failures, interrupted investigation) plus latest reuse diagnosis/reporting. The destination `codex/native-compaction-fix-20261012` at `32d1989a` contains native compaction, safe recovery, request reconciliation and uncapped-turn fixes. Their shared base is `a3a942cc`; neither head contains the other.

Claim: a merged implementation exposes source workspace/reuse functionality without regressing destination compaction, recovery or uncapped defaults. Falsifiers: dropped canonical history under defaults, reintroduced per-turn quotas/deadlines, lost semantic results/references, or failing lifecycle/recovery checks. Reduced burden: failed reads, repeated calculations, duplicate action receipts and manual diagnosis/accounting. This is a compatibility integration, not an isolated performance experiment or a game-benefit claim. User authorizes implementation and merge; no paid ARC run is started.

## Design and cost

- Preserve Pi-native automatic compaction and canonical retained history as default. Import source history bands as explicit opt-in: `ARC_THIN_NATIVE_VERBATIM>0` (normally source 4), `ARC_THIN_NATIVE_CONDENSED` (16). Default verbatim is 0, disabling bands. Pi session storage is untouched; summarizer input remains canonical.
- Preserve unlimited native investigation call counts and the destination no-progress guard as default. Source split quotas are opt-in via `ARC_THIN_NATIVE_SPLIT_BUDGET=1` (10 compute/lookups, 6 record, total 18). Legacy behavior remains its own comparator. Effective flags appear in run-config.
- Keep destination immutable short result index, ranged head/tail receipts, recovery, batch memory deletion, request settlement/unknown usage, WASI metrics and lazy snapshot transfer. Import source WASI directory lookup support and omit empty capability headers; suppress recent action receipts already in shown history.
- Import source recurring-code families, saved-component coverage, once-per-family adoption-gap investigation, coordinate-sentence heuristic and offline reuse report. Existing critic flag controls the independent advisory review; it can cost one bounded model call per diagnosed family and up to the existing critic wait per decision. No permanent worker, mandatory author field or creation quota. Pending review cannot spawn an overlapping review. Structural matching and coordinate sentence share are heuristics, not semantic proof or token allocation.
- Runtime advances logging, binding, exact-version activation, coverage hints and advisory delivery. Authorized Agent decides opportunity value, investment, semantic use, revision/retirement and justified non-use. File writes/edits publish candidates at the next request; failed versions retain working bindings. Existing isolation, read-only evidence, version and ARC action boundaries remain.

## Bounded evaluation protocol

Local Node/WASI regressions, focused pytest and deterministic real Pi/bridge smokes (mock ARC SDK, offline scripted provider) only. Stop/fix on integrity, semantic-result or lifecycle failure; preserve failed artifacts. Modes: native defaults/components, receipts automatic and split-turn/restart, optional bands/budget, reuse with/without critic, migration, no-progress/recovery and legacy comparators. Per smoke existing 240-second experiment bounds; no paid provider invocation. Require actual later-parent transcripts to show native summary, matching receipt refs and reusable tool semantic result. Optional settings must not leak into defaults. Compare source/destination intended behavior, not component counts as rewards.

## Implementation and verification

- Node: `node --experimental-transform-types --test --test-concurrency=1 tests/arc_thin_*.test.ts`: **119/119 passed**, `tmp/merge-all-node.log`. Focused subset: 23/23, `tmp/merge-focused-node-r2.log`.
- Python: foundation configuration, recovery, request accounting, ARC bridge deadline and task Python server: **23/23 passed**, `tmp/merge-focused-python.log`. Added partial-cost/cache-write report regression: **2/2 passed**, `tmp/merge-accounting.log` (includes the preexisting accounting test).
- 11 native real-Pi/scripted-provider smoke modes all passed: defaults-r2, reuse, reuse-critic, components (including consult length continuation and later semantic output), banded, budget, auto compaction, split-turn compaction/restart, migration, uncapped and native claims. Every corresponding `tmp/merge-<mode>.log` has exit 0 and `runs/merge-20261013-<mode>/summary.json` passed. Defaults confirm canonical retained history/no quota; banded and budget confirm explicit opt-in behavior. Summary requirements reached actual summarizer input; checkpoint reached a later parent.
- Five real-Pi recovery modes passed: idle, dead process, closed stdin, provider length, committed action followed by length; each preserved four exact bridge actions without replay. Artifacts: `runs/merge-20261013-recovery-<mode>/summary.json`. Recovery report matches summary request accounting; the idle case preserves three unknown-cost cancelled attempts and `complete_cost_known=false`.
- Legacy base/self-harness/continuity smokes all passed, `tmp/merge-legacy.log` and their `runs/merge-20261013-legacy*` summaries. No general Auto-Research matrix or closure claimed.
- Integration also preserves unknown/partial request costs in `reuse_report.json`, records adoption under its own traced kind, includes cache-write tokens and labels sentence/structure attribution as heuristic. Cached totals are lower bounds where usage is missing; component counts are not rewards.
- Preserved failed attempts: the first Node invocation lacked required TypeScript transform mode; one imported receipt test expected the source's short-name formatting. Corrected command and destination index expectations passed. The first defaults smoke completed gameplay but wrapper failed its 3000-char resident prompt check (3012); removed duplicate check documentation, then fresh defaults passed. No failure was hidden or attributed to real game quality.

Artifacts under `tmp/merge-*.log` and `runs/merge-20261013-*` in this worktree. No autonomous opportunity denominator or independently controlled performance sample is available. No Auto-Research closure claim; its development remains paused.

| Evidence layer | Status | Environment | Limit |
| --- | --- | --- | --- |
| Functional correctness | passed in tested cases | local Node/WASI/Python | logs and negative cases above |
| Scoped lifecycle reachability | passed (scripted) | real Pi 0.87.0, production bridge, mock SDK, offline-arc-thin-smoke/scripted | 11 native, 5 recovery, 3 legacy smokes; not general Auto-Research closure |
| Autonomous adoption | unverified | no new paid provider run | advisory exposure is not adoption |
| Net benefit | unverified | no matched independent runs | character/repetition metrics are not net savings |

## Delivery decision

Retain merged source functionality with destination defaults and integrity fixes; finish a local merge commit. No paid provider ARC run was launched. No performance or ordinary autonomous adoption conclusion is established. Relevant deferred B/C/D: evidence-to-use, parent/child total cost and cognitive continuity after compaction remain open. Next falsifiable quality check requires a separately budgeted ordinary provider comparison after operational acceptance; integration alone does not close these items.
