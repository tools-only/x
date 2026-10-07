# Real-provider meta-capability run comparison

Date: 2026-09-22

This report audits the two real-provider `ls20` runs completed on 2026-09-22.
It records component lifecycle, research lifecycle, semantic ARC evidence, and
runtime cost. It is not a paired benchmark result and does not make a causal
performance claim.

## Role and comparability

The run directories and the `experiment.json` files use the internal setting
`variant=treatment` for both runs. For the experiment's external comparison
role, `arc-capability-process-real-provider-20260922-185500` is the baseline
relative to the pre-freeze SOL code, while
`arc-capability-process-real-provider-20260922-221940` is the post-freeze
treatment. This distinction is necessary because the summary's internal
variant is not the comparison role.

Both runs used the same declared settings: `a:deepseek-v4-flash` through
`yibu`, game `ls20`, 20 configured actions, 1200 seconds, 65,536 maximum
output tokens, context compaction enabled, and real provider/environment
(`provider_mocked=false`, `environment_mocked=false`). The source snapshots
are independently hashed in each run's `experiment.json`; 15 listed source
files differ between the two snapshots. They can still be compared as
same-settings lifecycle observations, but the multi-file change means a single
component's causal effect or a performance gain cannot be isolated from these
two runs.

## Terminal and cost audit

| External role | Run | ARC result | Runtime | Main provider usage | Child/research usage |
| --- | --- | --- | --- | --- | --- |
| Baseline | `...185500` | score `0.0`, 0/7 levels, `NOT_FINISHED`, 10 actions | `timed_out`, Pi rc `124`; provider errors 0; environment errors 0 | 27 requests / 26 assistant messages; 765,283 input + 142,214 output tokens; assistant elapsed 681,820 ms; provider-reported usage cost `$8.092835` | 6 child requests; 42,102 input + 74,588 output tokens; child assistant elapsed 322,939 ms; provider-reported usage cost `$2.44815` |
| Treatment | `...221940` | score `0.0`, 0/7 levels, `NOT_FINISHED`, 11 actions | `timed_out`, Pi rc `124`; provider errors 0; environment errors 0 | 26 requests / 25 assistant messages; 712,623 input + 216,446 output tokens; assistant elapsed 1,010,001 ms; provider-reported usage cost `$10.056495` | no child requests; 0 child tokens / 0 ms; no child usage cost |

The configured action ceiling was not reached in either run. The scorecard is a
benchmark terminal result, not evidence that the provider or ARC bridge failed:
both runs have zero provider and environment errors. Token totals are the
actual usage fields recorded by provider telemetry. The dollar figures are
provider-reported usage-cost measurements from `pi-events.jsonl` (and the
baseline child `result_summary.usage.cost`), not an invoice or independently
verified billing statement. The measured combined baseline cost is `$10.540985`;
the treatment main-process cost is `$10.056495`, with no child process.

## Component and research lifecycle

### Baseline (`...185500`)

- Creation: four task-local memories and one parent-authored Skill,
  `skill:lattice-sprite-delta-reader@v1`, were materialized. No system-prompt,
  Tool, or Subagent component was created.
- Creator/provenance: Auto-Research child `auto-research-1` completed and
  produced a report with four findings and a research-only method candidate,
  `action-conditioned-region-triage`. The child method was not adopted as an
  exact Harness resource. The parent separately authored the lattice Skill;
  its lifecycle reached `validated_within_scope` as a bounded candidate, not
  cross-situation validation.
- Assembly: an active revision-1 assembly selected the Skill and four memories;
  an applied assembly receipt exists. Four context exposures recorded the
  selected Skill and memories. This is assembly/exposure evidence, not by
  itself semantic use.
- Declared application: actions 6–10 cite the exact Skill and memories in
  authored decision capsules with predictions and falsifiers. The corresponding
  trajectory evidence is in `execution-observations.jsonl`.
- Native selected-use status: the strict method lifecycle still reports
  `actual_arc_use=false` and `resource_access_count=0`: no exact resource-read
  event precedes a later accepted ARC action under the lifecycle contract.
  Thus the run has authored declared application plus assembly/exposure, but
  not closed native selected use. One effect assessment is supported and
  linked to runtime exposure, but it is not an independent provider-payload or
  artifact-integrity proof.
- Research status: one Auto-Research run completed, but no finding version was
  persisted into the task resource graph (`finding_versions=0`, latest resource
  count 0). The method chain is incomplete at adoption; no same-line feedback
  chain closes.

### Treatment (`...221940`)

- Creation: five task-local memories and one parent-authored Skill,
  `skill:grid-quantized-actor-navigation@v1`, were materialized. No
  system-prompt, Tool, or Subagent component was created.
- Creator/provenance: the Skill is a parent-authored structured method with
  applicability, abstention boundary, procedure, prediction/falsifier, and
  failure handling. Its lifecycle is `trial`; it is not independently
  validated across situations.
- Assembly: no successful task-local assembly exists. The attempted assembly
  failed as `failure-5` because `prompt_contributions.0.layer` was invalid.
  There is no task resource-access file, no assembly receipt, and provider
  context accounting keeps the `skills` module empty.
- Authored application: A11's `arc_action` decision capsule cites the exact
  Skill and memories, gives two alternatives, a prediction, falsifier, and
  validation window. The semantic ARC result is real: `ACTION2` moved the
  5x5 actor into rows 30–34, columns 19–23, overwriting the 0/1 blob with the
  actor's 12/9 pattern; the level remained `NOT_FINISHED`. This is an authored
  transcript declaration plus an observed semantic result.
- Native selected-use status: strict lifecycle remains
  `actual_arc_use=false`. The Skill was cited in the action capsule, but it was
  never successfully selected/exposed through a valid assembly and no exact
  resource read was recorded. The A11 result must not be called closed native
  Skill use.
- Research status: no child process, Auto-Research run, report, or continuation
  was created (`run_count=0`). The initial missing `authoring_method_ref` is a
  real maintenance failure; later research handoffs remained proposed and did
  not become reports. The run therefore supplies parent observation evidence,
  not independent child research.

## Semantic ARC evidence

The baseline trajectory established a 5-cell action lattice and used the
parent-authored Skill's move/blocked predictions for the route toward the
0/1 marker. It reached action 10 without level completion. The marker-cell
branch remained unresolved at the timeout.

The treatment trajectory independently established the same broad movement
pattern through actions 1–10. A11 then supplied the strongest late evidence:
the destination containing the 0/1 cells admitted the actor and was overwritten,
but no level transition occurred. This rejects “the destination is blocked” for
that action and does not establish that the marker is a goal. A11's validation
window was not assessed after the terminal timeout.

These observations are semantic tool results, not a game-quality win. Neither
run completed a level, and no claim is made that one run improved the model's
benchmark performance over the other.

## Failure and maintenance accounting

Failures are kept separate from ARC action cost and score.

Baseline recorded five one-off contract/repair failures:

1. Auto-Research start omitted `authoring_method_ref`.
2. The supplied authoring method reference did not match the current
   skill-creator baseline.
3. A Skill candidate lacked required structured method metadata.
4. Delivery used object-valued `decision_points` where authored strings were
   required.
5. Harness control required an explicit selection that was missing.

Treatment recorded five one-off contract/repair failures:

1. Auto-Research start omitted `authoring_method_ref`.
2. A memory candidate omitted a stable key/name.
3. A review contained duplicate/unsupported component entries.
4. A memory change used the wrong outer operation schema.
5. Skill assembly used invalid `prompt_contributions.0.layer`.

The treatment review's explicit deferral of Skill/Tool/Subagent alternatives is
not a component-quota failure; it was a review decision. The subsequent Skill
creation is therefore evidence of parent authoring, while the failed assembly
is evidence of a separate runtime contract problem.

## Unmet acceptance targets

Neither run closes the real ARC self-harness acceptance described by the
project. Specifically, neither has a valid route → exact resource mutation →
assembly → later parent exposure/use chain for all required component classes:

- `system_prompt`: no materialized or routed version;
- `skills`: baseline has assembly/exposure but strict native-use closure is
  false; treatment has no successful assembly;
- `memory`: memories were created, but neither run establishes the complete
  required route/use chain as a paired acceptance result;
- `tools`: no Tool version or invocation;
- `subagents`: no task-local Subagent component; baseline's Auto-Research child
  is research execution, not a closed task-local subagent capability.

Also still unmet are: a successful ARC level; real-provider game-quality
comparison; provider-length continuation evidence for both Auto-Research and
ordinary `delegate_task` in this experiment; independent artifact-integrity
verification of effect claims; cross-situation method validation; same-line
feedback research; and a paired benchmark comparison that could support a
performance or causal claim.

The deferred research backlog remains relevant and open: ARC adapter/runtime
boundary separation (A), research-purpose and parent–child evidence
communication (B/C), and semantic continuity across compaction/recovery (D).
This comparison audits those boundaries but does not implement or close them.

## Evidence index

For each run, the primary terminal record is:

- `D:\autoresearch_pi_project\runs\arc-capability-process-real-provider-20260922-185500\run\summary.json`
- `D:\autoresearch_pi_project\runs\arc-capability-process-real-provider-20260922-221940\run\summary.json`

Supporting records include each run's `experiment.json`,
`provider-telemetry.jsonl`, `context-token-debug.jsonl`,
`execution-observations.jsonl`, `bridge-events.jsonl`,
`task-memory.jsonl`, `task-skills.jsonl`, `task-method-lifecycle.jsonl`,
`task-harness-assemblies.jsonl` and
`task-harness-context-exposures.jsonl` when present,
`auto-research-runs.jsonl`, `auto-research-reports.jsonl`,
`subagent-progress.jsonl`, and `task-operation-failures.jsonl`.

The treatment directory intentionally has no successful assembly/resource-access
artifact; that absence is part of the result and should not be filled in by
inference.
