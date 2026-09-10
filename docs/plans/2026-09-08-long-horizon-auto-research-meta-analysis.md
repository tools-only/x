# Auto-Research Meta Architecture: Long-Horizon Failure Modes

## Scope

This analysis covers the current task-local architecture after the sustained
research lifecycle change. It does not assume model-weight updates, a kernel
research scheduler, a generic mutation API, or cross-task memory. Research and
self-harness changes remain optional.

The target causal chain is:

```text
agent-declared goal and scope
→ task-local exploration observations
→ versioned finding update
→ explicit apply/keep decision using a fixed finding version
→ Pi-native execution-surface change on a later model request
→ bounded system-computed effect assessment
→ agent-authored absorption and resolution/reopen
```

## Gaps that previously stopped the loop

The main blocker was not simply that OfficeBench tasks were too easy. Some
Level 2/3 cases contain 12 repeated writes and therefore a real adjustment
opportunity. The blockers were architectural:

1. Research existed as method text or a one-shot finding, not as state that
   could be revised after an intervention.
2. Decision records referred to a mutable finding ID rather than the exact
   evidence-bearing version used at decision time.
3. Effect feedback was transient and could disappear before the agent used it.
4. Summary generation treated exposure/effect as the end of the chain, so it
   could not distinguish a behavioral loop from a research lifecycle closure.
5. Fixed evaluator scores were too sparse to attribute an execution-condition
   effect, and a task pass could be mistaken for harness improvement.
6. The model could spend more turns describing the protocol than acting, while
   direct execution remained a locally attractive shortcut.

The implemented lifecycle addresses 1–5 inside one uninterrupted task process:
append-only versions, immutable decision bases, pending assessment feedback,
explicit absorption, independent effect recomputation, and separate task,
evaluator, effect, and improvement outcomes. Compact digests and the combined
`research_resource.continue_with` path reduce the overhead in 6 but do not make
the agent's decision policy stable.

## Credit assignment failure

### Naturally mitigated now

- Every applied decision names the intervention, expected effect, metric,
  observation horizon, and reconsider condition before the effect occurs.
- `basis_snapshots` fix the exact goal/finding version and evidence references;
  later research updates cannot rewrite the historical basis.
- Harness exposure is separately observed on the next model request.
- Effect windows count only capability-relevant task actions and the Python
  runner independently recomputes their counts and verdict.
- Assessment IDs are written back to the same research lineage, making delayed
  feedback traceable rather than free-floating.
- Correctness, efficiency, effect, and general improvement are separate fields.

These mechanisms solve provenance and bounded temporal attribution. They do
not establish causality.

### Remaining gap

The assessment explicitly records `confounders_controlled=false`. There is no
counterfactual direct run, only one in-flight effect window, and no model for
overlapping or interacting changes. Delayed effects beyond the declared
horizon, phase changes, partial batch failure, and task difficulty can all be
misattributed. A supported single-case effect cannot establish a generally
better harness policy.

### Minimal next mechanism

Do not add a causal-span manager or intervention ledger. The existing
`decision_id` already connects the immutable finding basis, native Pi exposure,
effect assessment, and later research absorption. A second identifier and
runtime manager would improve trace vocabulary without making the research
lifecycle more likely to continue, and would risk becoming another harness
above Pi.

The one required temporal correction is an exposure gate: task actions emitted
in the same assistant response as `pi.setActiveTools()` were selected from the
old tool surface and must not consume the bounded effect horizon. Effect
collection therefore starts only after the existing Pi context hook observes
the changed surface on a later model request. Matched direct-vs-adjusted replay
remains an offline evaluation concern. Correctness, robustness, latency/cost,
and work compression remain separate scores.

## Shortcut learning

### Naturally mitigated now

- Ground truth, evaluator code, keywords, sibling runs, and project source are
  outside the task resource boundary.
- A finding must cite actual current-task observations before it can change the
  tool surface.
- The prediction and metric are fixed before the bounded effect is measured.
- The runtime's verdict is independently recomputed rather than accepted as
  agent-authored truth.
- No-change remains valid, and task pass does not imply research or harness
  improvement.

This blocks several obvious benchmark and logging shortcuts.

### Remaining gap

The model can still learn proxy rules such as “12 is larger than the disclosed
break-even, therefore always batch.” `tool_call_compression` can become a proxy
objective that ignores semantic correctness or partial failures. An agent can
also create a formally complete lifecycle after the useful decision without
the research having changed its behavior. A homogeneous OfficeBench
distribution makes these shortcuts hard to detect. The no-change real run on
the same high-recurrence case shows that the policy is also unstable rather
than reliably calibrated.

### Minimal next mechanism

Use an evaluation cohort rather than stronger prompting:

- include high-benefit, low-benefit, partial-failure, and mid-task requirement
  reversal cases;
- require effect predictions to be timestamped before exposure and report
  whether the decision preceded the affected action;
- gate efficiency credit on semantic correctness and penalize partial batch
  failure;
- keep direct-vs-adjusted comparisons offline and hidden from the task agent;
- evaluate calibration on held-out task families;
- report information gain and decision timing so a post-hoc formal lifecycle
  is distinguishable from research that influenced execution.

## Catastrophic forgetting

### What the current architecture avoids

The current system does not update model weights, so classic parameter-level
catastrophic forgetting is not present. Task-local state also prevents a bad
finding from one task overwriting another task's policy. Append-only versions,
resolve/reopen semantics, and immutable decision snapshots preserve history
within the run.

### Remaining long-task forgetting

There is still working-memory forgetting:

- OfficeBench/Shopping extensions now hydrate their task-local JSONL state after a
  supported same-task restart, but the generic `PiTaskAgent` runtime has no
  cross-extension recovery protocol;
- only five latest unresolved findings are placed in repeated context;
- resolved findings leave the active digest and there is no read-only catalog
  or relevance query for recalling them;
- free-form task notes are append-only and may retain superseded claims;
- fixed recency selection is insufficient when many concurrent goals exist.

The architecture therefore preserves facts on disk but does not yet guarantee
that the agent can retrieve the right fact later. It prevents destructive
forgetting better than it prevents inaccessible memory.

### Minimal next mechanism

Keep the task-local retrieval layer minimal and extension-owned, without automatic
research scheduling:

- the OfficeBench/Shopping `research_resource(action="inspect")` path already
  replays append-only logs on extension startup and reconstructs the latest
  finding/effect state;
- it exposes a bounded read-only snapshot, while the agent still decides whether
  to use the restored fact or re-apply a capability;
- do not add a generic kernel-side catalog/query or cross-extension recovery
  protocol until a real task demonstrates that the extension-local path is
  insufficient;
- keep only the current deterministic bounded digest; do not add automatic
  relevance ranking or a runtime-selected working set;
- when more history is needed, the Agent explicitly calls the existing
  read-only `research_resource(action="inspect")` path and selects the finding
  itself;
- retain explicit resolve/reopen tombstones so old conclusions are not silently
  revived.

If cross-task policy learning is later introduced, it needs a separate layer:
versioned policies, episodic replay, held-out regression tasks, and rollback.
Weight-level techniques such as adapters or EWC are relevant only then and
should not be added to the current task-local kernel prematurely.

## Priority

1. Run a stratified hidden cohort and compare decision calibration and
   correctness-gated effect, not merely evaluator pass rate.
2. Keep the single capability-specific effect window, gated by native Pi
   exposure; add multi-window analysis only after real overlapping changes make
   the current representation insufficient.
3. Keep extension-owned log hydration and validate Agent-invoked read-only
   inspection on process restart or many-goal tasks; do not add automatic
   retrieval policy without a demonstrated failure.
4. Consider cross-task learning only after the first three produce stable,
   replayable evidence.

The current architecture now establishes a real task-local Auto-Research plus
self-harness lifecycle in at least one real run. It is a provenance-preserving
experimental substrate, not yet a general long-horizon optimizer.
