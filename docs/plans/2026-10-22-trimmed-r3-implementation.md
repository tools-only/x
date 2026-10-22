# Trimmed R3 implementation record

Date: 2026-10-22 (Asia/Shanghai). Status: implementation; single-run evaluation launched asynchronously.

## Problem and claim

- Evidence: `R3-GAP-PLAN.md` documents R2h/CHM loops, unchecked false wins, inert/replay actions, and the REFINE_FIRST/Pi validation failure mode. `R3-O2O6-OVERLAP.md` confirms the action-path gaps remained at 83e6a09e while O4b consult deletion, O5 novelty-pin deletion, and O4a focus limit removal were already complete.
- Claim: when enabled, R3 derives effect receipts and result-backed admission checks to record progress, falsification, and repeated inert/cycle evidence; procedural clipping and bounded release reduce avoidable refusal loops. Focused checks can falsify the pure helper behaviors; they do not establish model adoption or task improvement.
- Burden removed: repeated manual interpretation of action outcomes and avoidable schema/refine refusal rounds. Parent still chooses actions and semantic hypotheses.
- Scope: trimmed S0′–S6′ from the prompt; MAXLEVEL 2 only. No rework of completed O2/O4a/O4b/O5 items; retained E1 and O3 viewScope. No `predict.effect`, su15 constants in runtime core, or gameplay process text.

## Design and cost

- Reused statusMask, trajectory, goal-check, memory, action, and carry paths. New gates are reversible off|shadow|on; receipts remain internal, with only bounded evidence and alternatives on refusal. No workers or agent tools added.
- Runtime derives effects and gate evidence per action. Existing memory checks supply false-win evidence; the model keeps semantic judgment and action selection. JSONL reports support owner review. Missing grids/provisional masks remain nonblocking.
- Added work is bounded pure processing per action plus optional JSONL writes; refusals may add a provider turn. No new resident prompt text.
- Permission, action budget, environment bridge, version, and level limits remain unchanged. No answer peeking or multi-submit.

## Experiment protocol

- Authorized evidence: focused local unit/import checks and one CHM-default su15 run: MAXLEVEL=2, 3M token budget, Qwen 3.8 27B thinking off, fixed `after-decision-25` fork, R3 on and WIN_LOCK shadow. No L3+.
- Comparator: CHM-o2o6 at 83e6a09e. Single-run result is exploratory, not causal. Review actions, gate verdicts, refusal recovery, errors, and available parent/child cost separately.
- Negative cases covered by focused helpers include inert actions, progress predictions, false claims, new classes, masked candidates, and mode precedence. No autonomous behavior was scripted in the live run.
- Stop after asynchronous launch. Do not wait for completion. Missing provider artifacts remain unverified.

## Implementation and verification

- Slices landed from base 83e6a09e through the R3 S6 report/template, with an additional S2 follow-up to restore persisted goal falsifications and format bounded refusal receipts.
- Focused checks: `tests/arc_thin_r3_effects.test.ts`, `tests/arc_thin_r3_win.test.ts`, `tests/arc_thin_r3_gates.test.ts`, extension import, `tests/arc_thin_level_carry.test.ts`, and `/d/conda/python.exe -m py_compile tools/arc_r3_report.py`.
- No full pytest, large smoke, held-out replay farm, or mid-implementation ARC run.

## Evidence layers

| Layer | Status | Provider/environment | Boundary |
|---|---|---|---|
| Functional correctness | passed for focused helpers | local Node and pinned Windows Python | Does not prove action/game quality |
| Full-chain reachability | unverified at report time | ARC bridge / Pi / child | New CHM run launched asynchronously; no completion artifacts reviewed |
| Autonomous adoption | unverified | Qwen 3.8 27B, thinking off | One ordinary run, no scripted adoption evidence |
| Net benefit | unverified | same run | No matched repetitions or full parent-plus-child cost comparison |

## Decision

Keep the gates opt-in and experimental. Next falsifiable check: review the completed CHM run for Level 2 actions, per-gate verdicts, refusal/recovery, provider errors, semantic action outcomes, and parent-plus-child cost against the fixed 83e6a09e comparator; retain or revise only within MAXLEVEL=2. Related deferred work on ARC parent/child communication and context continuity remains open; this implementation does not change its status.
