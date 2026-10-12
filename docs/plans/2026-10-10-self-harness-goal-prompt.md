# Self-harness 12-hour goal prompt

Copy the execution prompt below into a new goal request. Editing this document does not start a goal or launch experiments.

## Execution prompt

You are executing a time-bounded engineering and empirical improvement goal in `D:\autoresearch_pi_project`.

Your job is to improve the current self-harness implementation through evidence-driven iteration: analyze real ARC behavior, diagnose failures, repair bugs, improve the responsible mechanisms, and repeat implementation–run–review–adjust cycles until the acceptance contract is satisfied or the 12-hour deadline is reached.

This is an instruction to perform the work, not merely propose a plan. Start by establishing the deadline, isolation, and authoritative instructions. Proceed autonomously within the permissions below. Preserve progress across context compaction and recoverable interruptions.

### 1. Binding objective and precedence

Read before designing or changing runtime behavior:

- `D:\autoresearch_pi_project\AGENTS.md` and applicable instructions in the actual worktree.
- `D:\autoresearch_pi_project\docs\development-workflow.md`.
- `D:\autoresearch_pi_project\docs\arc-optimization-runbook.md` for diagnosis, iteration methods, evaluation design, and acceptance metrics.
- `D:\autoresearch_pi_project\docs\templates\meta-harness-change.md` for the evidence structure.
- `D:\autoresearch_pi_project\docs\deferred-research-todos.md` when handling adapter boundaries, research communication, context continuity, or roadmap decisions.
- When changing research workers or Auto-Research, also read `docs/plans/2026-10-01-auto-research-mechanism-and-workers.md` and `docs/auto-research-workers-implementation-2026-10-01.md`.

Start from the current code, effective configuration, and available real-run evidence. Consult existing optimization plans only for relevant design context and prior evidence; they do not impose a preliminary implementation checklist. This prompt defines the execution and acceptance contract, subject to later explicit user amendments and higher-priority instructions.

**Method integration.** Use `docs/arc-optimization-runbook.md` as the operating method for this goal. Read it at startup; during each iteration consult the relevant diagnostic, evaluation, and decision sections rather than copying the whole manual into the record. The development workflow remains the evidence authority; this goal contract defines its specific deliverables, budget, mandatory Astra review, sample counts, and Gates A–D. The manual's metric menu and repeat-run guidance do not add component quotas, mandatory ablations, or extra final runs. Apply later explicit user amendments when present and record the effective contract. Method integration alone neither starts a goal nor resets an existing deadline. Keep the manual and review procedures entirely on the development side.

**Direct entry into iteration.** Preserve the current baseline source, dependencies, and configuration, inspect existing evidence and production paths, and enter Section 7. Choose a targeted diagnostic, repair, or real experiment based on the earliest supported bottleneck. Before each experiment, complete the checks relevant to that experiment and freeze its code/configuration. There is no separate initial implementation phase or requirement to finish a module inventory before real ARC work.

Use real-chain diagnostics, compatible fresh baselines, ordinary candidate runs, and final comparisons to close Gates A–D. Every real ARC run receives the mandatory Astra review. Changes and checks proceed within the same 12-hour deadline; an implementation milestone does not reset or extend it.

In particular:

- Complete all five component capabilities and their applicable lifecycle operations. Do not remove one of the five required capabilities merely because a particular game does not need it.
- You may reorder implementation, merge modules, simplify interfaces, replace candidate designs, and retire ineffective optimizations. Explain substantial decisions using observed evidence.
- Final comparison requires one baseline run and one final-candidate run per game, not three repeats or eighteen runs per module.
- Ablation experiments are not required in this goal. Use logs, targeted diagnostics, comparable baselines, and final whole-system outcomes. Do not independently claim that a component caused a score gain without supporting causal evidence.
- There is no additional user-set monetary or aggregate token ceiling. The 12-hour wall-clock limit, per-run declared budgets, concurrency limit, authorization boundaries, and efficient experiment selection remain binding.
- Do not copy development instructions, this goal prompt, review rubrics, or repository AGENTS.md into the gameplay Agent's context.

### 2. Definition of success: all gates must pass

The self-harness is a required means of improvement. ARC task progress is a required evaluation outcome. Neither can substitute for the other.

#### Gate A — trustworthy execution and evidence

For every run used as acceptance evidence:

1. Confirm the official ARC environment and a real provider were used through the intended production runtime.
2. Record the actual code revision and source hashes, environment identity/version, model/provider, reasoning configuration, input modalities, component versions, and all stopping conditions.
3. Reconcile canonical environment actions with the bridge and trajectory logs. Detect missing records, duplicated submissions, and ambiguous action completion.
4. Record tool refusals, environment failures, timeouts, cancellations, and incomplete requests separately.
5. Preserve completed usage and unknown usage honestly. Missing usage is not zero.
6. Keep the running implementation frozen. Changes for the next run must not mutate code or configuration used by a currently executing acceptance run.
7. Preserve both favorable and unfavorable results. An aborted or failed run remains part of the experiment history.

A compromised or unverifiable run is not passing evidence. Keep it as a diagnostic failure and investigate the integrity problem.

#### Gate B — five-component real lifecycle coverage

Cover all five categories:

| Category | Required substance |
|---|---|
| system_prompt | Agent-controlled persistent guidance, actual provider-input assembly, scope, revision, withdrawal, and appropriate restoration |
| skills | Agent-created reusable method or executable skill, exposure, meaningful use, validation, revision, withdrawal, and restoration |
| memory | Agent-controlled persistence and updating of useful information, actual later use, scope/evidence handling, correction, retirement, and safe recovery |
| tools | Agent-created or substantially revised callable tool with a real interface, registration, semantically meaningful invocation, version management, withdrawal, and recovery |
| subagents | Agent-created or substantially revised task-local specialist configuration, real execution, scoped permissions, meaningful return, parent use, update, cancellation/retirement, and continuity/recovery |

For each category, demonstrate applicable operations: create/configure → validate → assemble/expose → later actual use → feedback → revise → deactivate/retire → restore/rollback when appropriate.

Inspect actual downstream effects. A successful save, syntax check, catalog entry, `status=completed`, or tool name in `uses` is insufficient.

Type-specific semantics matter:

- Deactivating a prompt must remove it from subsequent actual provider inputs.
- Retiring a tool must remove or reject its old invocation path reliably.
- A failed candidate update must not silently overwrite the last valid version.
- Memory recovery must not erase real events or present obsolete state as current.
- Subagent recovery preserves legitimate task/research continuity without pretending previous calls or actions did not happen.
- Configuration rollback only affects future execution; ARC history is irreversible.

An operation may be marked not applicable only with a specific explanation and evidence of the equivalent safe behavior. Do not use broad N/A labels to avoid a difficult test.

Explicitly guided diagnostics may cover this gate, but they must use real ARC and a real model. Label them guided; they do not count as autonomous conversion.

Respect the repository's full-chain requirement: `arc-harness-smoke` must exercise real bridge, Pi parent loop, child broker/process, structured return, routing, native harness mutation, ARC action boundary, and a subsequent real parent turn. Cover the five-component matrix and provider `length` continuation for both Auto-Research and ordinary `delegate_task`. Use production entry points; a second implementation written only for a test does not prove the production path.

If real `length` is not encountered naturally, use a clearly labeled bounded real-provider diagnostic with an appropriate output limit. Scripted/deterministic provider tests can help debug but cannot replace the required real-provider result. Missing coverage remains missing.

#### Gate C — at least two distinct autonomous component conversions

Across the final ordinary acceptance run set, demonstrate at least two distinct categories from skills, memory, tools, prompt, and subagents. It is not necessary for every game to produce two categories or for any game to produce all five.

A counted conversion must satisfy all of these:

1. It arises from an actual need recognized by the gameplay Agent during ordinary execution, without an evaluator instructing it to create that specific component.
2. The Agent creates or substantially revises a component through the real interface.
3. The resulting version is assembled or exposed through the intended runtime.
4. It is meaningfully used in later work; the trace supports the use claim.
5. Its result or effect is processed, rather than merely written to a store or displayed.

Category-specific counting rules:

- Memory: useful information is saved and later visibly informs a decision or operation. Automatic logging and unconsumed memory writes do not qualify.
- Skill: a reusable method/calculation is created or substantially revised and subsequently used with a useful, validated result.
- Tool: a genuine created/revised callable interface is registered and subsequently invoked with semantically correct results.
- Prompt: the Agent modifies standing guidance, subsequent provider input contains it, and later behavior shows relevant use. Mere inclusion is exposure, not proof of use.
- Subagent: the Agent creates or substantially revises a task-local specialist, calls it, and uses a meaningful return. A single call to an unchanged built-in analyst is not sufficient.

Do not double-count one Python function invoked through `run_skill` as both a skill and a custom tool. Distinct claimed categories need distinct lifecycle evidence. Label ambiguous use as unverified, not successful.

Consolidation or a diagnostic instruction explicitly asking for component creation is guided evidence, not a way to manufacture Gate C. If an ordinary interface includes neutral capability documentation, preserve that condition in the baseline and record it. Inspect the actual trigger when judging autonomy.

#### Gate D — Qwen ARC task progress

The final ordinary evaluation uses `yibu/qwen3.8-27b` as the gameplay parent model.

Use three games:

- ls20;
- lp85;
- one available official game not used to tune this candidate's prompts or mechanisms, selected and recorded before examining its outcome.

For each game, compare one new baseline run against one final frozen-candidate run under matched conditions. Historical text-only results are diagnostic references, not substitutes for a new compatible baseline.

Required outcomes:

- ls20 candidate completes at least one more level than its baseline.
- lp85 candidate completes at least one more level than its baseline.
- The held-out game's completed-level count does not decrease; a baseline WIN must remain a candidate WIN.
- Runs remain within their declared budgets and satisfy Gate A.

If a baseline already achieves full WIN, pre-register an alternative before running the candidate: maintain full WIN and reduce either parent-plus-child reported total tokens or wall-clock time to WIN by at least 15%, with the other resource not increasing by more than 10%. Choose the primary resource in advance; use it only when measurement is sufficiently complete. Do not choose a favorable resource after seeing the candidate result.

Keep per-game action, wall-clock, token, output, model, modality, and concurrency conditions matched between baseline and candidate. If a condition must change, obtain a matching new baseline or explicitly leave that comparison unverified.

This is single-run matched engineering acceptance. It does not establish statistical significance, stable improvement across random seeds, or general superiority. Use exactly that limitation in the final report.

If held-out results inform another code or prompt adjustment, that game becomes development data. Select a genuinely new held-out game when possible. If none is available, disclose the coverage gap rather than calling the old game unseen.

Do not rerun an unchanged candidate repeatedly until a lucky result passes. A repeated run needs a recorded reason such as a changed candidate, a diagnosed infrastructure problem, or an explicitly labeled uncertainty check. Retain all attempts.

### 3. Time, money, concurrency, and stopping

At goal activation, record `started_at` and `deadline = started_at + 12 hours` using a reliable clock. Persist absolute UTC timestamps and display user-facing times in Asia/Shanghai. Do not substitute the document's creation date for the actual start time.

The 12 hours include repository inspection, implementation, local tests, provider setup checks, all ARC runs, mandatory Astra reviews, analysis, commits, and handoff. Context compaction, tool retries, or session restoration do not reset the clock.

There is no additional user-set monetary/token total cap. This authorizes real provider experiments within the other limits; it does not authorize account changes, purchasing credits, or uncontrolled request fan-out. Track all observable external costs and disclose estimates/unknowns.

Before every run, record explicit limits for actions, time, total parent-plus-child reported tokens, per-request output, and child work. Choose limits suited to the question and remaining time. Bound guided diagnostics tightly. Formal comparisons use identical per-game limits.

The previous 100-action / 3,600-second / 1.2-million-reported-token settings are a starting reference, not mandatory for every run. Do not spend the entire remaining time on one request or launch a test that cannot plausibly finish and receive Astra review before handoff.

Allow at most two ARC environment instances belonging to this goal to run concurrently, including diagnostic instances. Existing unrelated runs are not yours to stop. Within each run, bound child concurrency and total outstanding requests; two environment instances is not permission for unlimited child calls.

Use matched concurrency conditions for speed comparisons. When provider contention or throttling makes measurements unreliable, reduce concurrency and record the condition.

Use soft time checkpoints:

- Use the early portion of the time budget for evidence-driven diagnosis and targeted iterations, continuously checking whether the final gates are reachable.
- Around four hours before the deadline, prioritize final-candidate freezing and confirmation. Move this earlier if measured runtimes require more time.
- Reserve review time after every final run; mandatory Astra review is part of the budget.
- During the final thirty minutes, avoid new long runs and major unverified changes. Reconcile evidence, stop owned work safely, commit the verified state, and prepare handoff.

If all gates pass early, finalize and stop. If the deadline arrives before all gates pass, report partial completion honestly. Do not lower thresholds, omit failures, or extend the deadline.

Use bounded cancellation and cleanup. Once the deadline is reached, issue no new experimental/model work. Save existing logs and known process/cancellation status. If a call cannot be confirmed stopped, disclose it and the unknown cost; never claim successful cancellation without evidence.

### 4. Model policy and developer-side Astra review

Distinguish three roles:

1. **Main development Agent:** owns implementation, experiment selection, review decisions, and final accountability.
2. **Gameplay Agents:** the ARC parent and its task-local critic/subagents.
3. **Developer review subagent:** GPT-6 Astra reviewing completed ARC evidence; it is not a gameplay component.

Gameplay policy:

- Primary parent: `yibu/qwen3.8-27b`.
- Occasional diagnostic parent: `yibu/gpt-6-sol`, when a concrete uncertainty warrants it, such as distinguishing unavailable capability from Qwen's failure to adopt it.
- In each gameplay run, critic and task-local subagents must use the same model/provider as that run's parent. Do not silently give Qwen a stronger in-game helper.
- Advanced-model outcomes do not count toward Qwen Gate D or substitute for Qwen Gate C.
- Transfer general interface, lifecycle, or architecture findings from advanced-model diagnostics. Do not transfer its game-specific solutions, coordinates, action sequences, or task-local memories into ordinary Qwen evaluation.
- Start with one advanced-model diagnostic per unresolved issue. Repeating it requires a changed diagnostic question and a record of why it is worth the remaining time.

Default input policy:

- Supply the complete canonical grid and image when the actual provider/model path supports image input.
- Verify transmitted and accepted modalities, not merely the configuration label.
- If the actual model path lacks image support, record the evidence and use a consistent text-only fallback in both arms. Do not silently switch the primary model.
- Preserve complete required observations. Treat observation representation changes as explicit experimental variables.

**Mandatory Astra rule:** every real ARC run, whether successful, failed, aborted, timed out, guided, advanced-model diagnostic, baseline, or final candidate, must receive a GPT-6 Astra developer-side review after it ends.

- Invoke an on-demand subagent with model `gpt-6-astra` when the available collaboration tool supports that model. This model override is explicitly authorized by the user for post-run analysis.
- Do not prearrange a permanent multi-agent team, role chain, or fixed parallel workflow. The main Agent decides when other developer subagents are useful. The per-run Astra review is the required review responsibility, not a license to construct a multi-agent bureaucracy.
- Give Astra a self-contained task with the run's real artifacts and relevant code version. Use a fresh or bounded context as appropriate; do not assume the whole parent transcript is accurate evidence.
- Astra reviews completed runs and returns findings; the main Agent verifies and decides. Astra is not automatically authorized to modify shared code, start ARC runs, or steer gameplay.
- Two concurrent runs may complete close together. They may be reviewed in one Astra assignment only if each receives an individually identifiable review with evidence and disposition. No run may disappear into a batch summary.
- An independently planned frozen run already in flight may continue. Do not launch the next dependent iteration, accept a candidate, or mark a final run passed until its relevant Astra review has been read and adjudicated.
- If GPT-6 Astra cannot be invoked, record the actual failure and attempt bounded recovery. Do not substitute another model while claiming Astra reviewed the run. Treat mandatory review as blocked, continue only independent authorized work, and report the limitation before claiming completion.

If developer subagents other than Astra are useful for bounded implementation, verification, or facts, invoke them on demand. The main Agent remains responsible for integration and scope. Tool/model availability is an environment fact to inspect, not a reason to invent successful delegation.

### 5. Isolation and operating permissions

Inspect current repository state before mutation. Preserve unrelated work. Use a suitable isolated worktree or create one for this goal; use a `codex/` branch prefix unless existing applicable instructions require otherwise. Capture the baseline source before modifications.

Authorized:

- Implement and refactor within the isolated worktree.
- Modify runtime code, generic prompts, tests, dependency declarations, observation adapters, context assembly, scheduling, budgets, ledger, and critic where evidence supports the change.
- Install needed dependencies in a task-specific environment.
- Make local commits with coherent change boundaries.
- Run meaningful local diagnostics and real ARC experiments under this contract.
- Manage and stop only processes demonstrably owned by this goal.
- Use bounded developer subagents at the main Agent's discretion, with the mandatory Astra review above.

Not authorized by this goal:

- Pushing, merging, publishing, or changing the shared main checkout's unrelated work.
- Modifying credentials, account settings, billing settings, or official ARC rules/scoring.
- Stopping unrelated processes or deleting unrelated artifacts.
- Reading or using hidden game implementations, victory predicates, answer keys, or external walkthroughs to improve gameplay.
- Injecting discovered game-specific solutions into ordinary gameplay prompts or initial components.

Use public observations and actual interaction logs as gameplay evidence. Framework and adapter source inspection is allowed. Keep evaluation knowledge separate from what the ordinary gameplay Agent receives.

A major refactor is allowed when a documented mechanism problem cannot be addressed cleanly by a smaller change. Before doing it, record the failure, rejected smaller options, replacement boundary, migration/rollback behavior, and feasible verification within the remaining time. Avoid speculative infrastructure expansion.

### 6. Optimization priorities

Use the runbook's diagnostic branches to prioritize the current bottleneck. These are investigation directions, not an up-front implementation checklist:

- **Execution integrity and stability:** reconcile environment actions, actual provider requests, usable responses, recovery, and known/unknown costs. Repair blockers before broad performance comparisons.
- **Learning and correction:** preserve observations, conditions, counterexamples, competing explanations, and their effect on later strategy. Reduce the time and management work between evidence and an informative experiment.
- **Self-harness formation and use:** simplify authoring, trial, assembly, semantic use, revision, and retirement across the required five capabilities. Preserve selective use and justified non-use.
- **Context and interface burden:** separate durable knowledge from resident views, tool availability from schema exposure, and reasoning budget from report length. Reduce repeated work without removing useful capability or continuity.
- **Ledger and critic:** derive mechanical records from real events; verify effective review delivery and evidence-based judgments about hypotheses, strategies, and goals. Gameplay decisions remain with the gameplay Agent.
- **Evaluation:** collect the minimum instrumentation needed to test the current claim and acceptance gates. Choose metrics and comparison conditions before inspecting outcomes.

Reuse verified existing capabilities. Implement missing or defective behavior as justified by diagnosis or an open acceptance requirement, and validate the affected production path. Keep development procedures out of the gameplay context.

### 7. Required outer iteration loop

Enter this loop after restoring the current state and preserving the baseline. Execute it using runbook Sections 3–7 while the goal remains incomplete and time remains:

1. **Restore the checkpoint.** Verify the effective contract, deadline, stable/candidate identities, owned runs, pending reviews, and acceptance gaps. Reuse completed evidence and in-flight work.
2. **Reconstruct one concrete failure or opportunity.** Reconcile canonical events and what the Agent actually received. Separate observations, interpretations, unknown outcomes, and missing evidence.
3. **Locate the earliest supported break.** Trace cognition, capability formation/use, and feedback delivery using runbook Section 4. Compare competing causes, including restrictions imposed by the harness itself; choose the cheapest discriminating check if the cause is uncertain.
4. **Define one falsifiable change.** State the burden removed, expected downstream behavior, task metric, failure condition, and a relevant negative case. Prefer simplification/reuse to new prompts, mandatory fields, gates, or roles. Repair integrity or execution blockers before broad performance comparisons.
5. **Implement and check proportionately.** Protect other work. Use focused functional, replay, and recovery checks appropriate to the failure; these qualify the candidate for real evaluation, not real acceptance.
6. **Freeze and preregister the experiment.** Record source/configuration identity, actual provider reasoning and modalities, comparator, budget, stopping rules, the smallest relevant metric set, and acceptable regressions. Select the evaluation method under runbook Section 6.
7. **Run actual ARC and monitor.** Track task progress, semantic component use, belief revision, effective critic delivery, stability, and total cost. Record anomalies; let the frozen run finish unless a predefined stopping condition or user instruction applies. Prepare later candidates only in isolation.
8. **Reconcile the outcome.** Preserve raw events, public state, scorecard, failures, process status, and known/unknown usage. Include failed and truncated samples; distinguish an unfinished revision from refusal to revise.
9. **Obtain GPT-6 Astra review.** Supply the relevant runbook method and this run's evidence, predictions, and metrics under Section 8. Every real run retains its mandatory review.
10. **Adjudicate findings and assess evidence layers.** Verify citations and calculations. Report functional correctness, full-chain reachability, autonomous adoption, and net benefit separately; component counts, invocation success, or shorter context alone do not establish task improvement.
11. **Retain, revise, retire, or investigate.** Apply runbook Section 7.3 and Section 12 below against the preregistered criteria. If behavior misses the claim, revisit the broken transition rather than automatically increasing budgets or adding instructions.
12. **Persist and continue.** Update the existing change record and checkpoint with the result, rejected explanation, remaining budget, and next justified check. Continue authorized work; stop under this contract's goal and deadline conditions.

Diagnostic priority follows the observed bottleneck. Resolving stability or context failures can be a prerequisite for meaningful self-harness evaluation; the required capabilities and acceptance gates remain the final completion criteria.

### 8. Astra review: required inputs and output contract

Provide the reviewer:

- Run ID and absolute artifact paths.
- The exact frozen source location and relevant configuration.
- Run type: guided diagnostic, ordinary development, baseline, advanced-model diagnostic, or final acceptance.
- The change under test, pre-run hypothesis/prediction, selected metrics, acceptable regressions, and falsification condition.
- `docs/arc-optimization-runbook.md` from the working checkout: use Sections 4, 6, and 7 to review the earliest broken transition, mechanism-imposed burden, and evidence level. Treat it as a method, not a checklist requiring a finding in every category.
- Public observations, trajectory, component writes/versions, tool calls/results, provider-visible context where available, usage, errors, and final scorecard.
- Comparator information, previous relevant findings, and already-tested explanations.
- Remaining time and the questions the main Agent needs answered.

Tell Astra to inspect raw evidence rather than repeating the main Agent's interpretation. Request this structured report:

```text
RUN REVIEW
run_id:
source/config identity:
run validity and missing evidence:
task outcome and resource summary:
component conversion/lifecycle findings:

For each material finding:
  finding_id:
  observed symptom:
  precise event/action/time/file references:
  actual behavior:
  expected behavior and source of that expectation:
  classification:
    implementation bug | interface/workflow defect | mechanism gap |
    model capability/adoption limitation | infrastructure failure |
    measurement defect | insufficient evidence
  confidence: confirmed | supported hypothesis | unknown
  causal chain, if supported:
    observable input -> responsible mechanism/state -> output -> consequence
  competing explanations and disconfirming evidence:
  broken lifecycle transition or missing responsibility:
  smallest discriminating check:
  proposed correction:
  why the correction addresses the cited failure:
  general form independent of this game's identity/coordinates:
  affected files/contracts, if located:
  added cost and burden removed:
  predicted next-run observation:
  conditions that would falsify the proposed correction:
  negative case / possible regression:
  priority and whether it blocks an acceptance gate:

Recommended disposition:
  retain | bug repair | diagnostic probe | mechanism revision |
  simplify/retire | acceptance-ready | insufficient evidence
What should remain unchanged:
What cannot be concluded from this run:
```

Astra need not invent a problem for a successful run. It should report no material new issue where appropriate, while checking validity, acceptance, and remaining coverage.

Reject generic advice such as “reason more carefully,” “improve memory,” “add reflection,” “use more tools,” or “add a critic” unless the reviewer locates a concrete failure and explains the specific mechanism change and falsifiable prediction.

If a review is generic, lacks citations, or relies on a false premise, request one focused clarification using the missing evidence. Do not repeatedly regenerate reviews without progress. Record unresolved uncertainty and choose an inexpensive check or another independently justified task.

The main Agent must not blindly implement Astra's suggestions. Validate the high-impact claims, including mathematical claims, chronology, and whether a note was written before or after an action. An action's pre-action rationale is not proof that the Agent later believed the action succeeded.

### 9. From observed symptom to a general mechanism change

Apply runbook Sections 4–5 as the detailed diagnostic method; keep the result in the existing per-change record rather than producing another worksheet.

- Trace the cognition chain (observation -> representation -> interpretation -> hypothesis -> discriminating experiment -> feedback -> revision -> action), the capability lifecycle, and critic delivery. Locate the earliest supported break and verify its downstream consequence.
- Examine implementation bugs, interface burden, mechanism gaps, infrastructure failures, and competing explanations before assigning a model limitation. Audit hard limits, hidden tool access, forced management steps, and lost counterexamples as possible causes.
- Separate persistent knowledge from resident display, computation budget from final-answer length, and tool capability from per-request schema exposure. Preserve required reasoning and functional access while reducing repeated work.
- Encourage low-friction component production and revision while leaving assembly, use, and justified non-use to the Agent. A successful save or invocation does not establish semantic correctness or value.
- Keep generic runtime responsibilities separate from domain-adapter primitives and Agent-authored derived analysis. Changes must address reusable failures rather than encode a game's colors, coordinates, rules, or solution.
- Evaluate competing hypotheses by distinct predictions, informative experiments, and actual revision; evaluate the gameplay critic by evidence-based judgments about hypotheses, strategies, goals, and evidence. The gameplay Agent chooses concrete actions.
- State the prospective behavior and falsifier before implementation. A small existing-module repair is preferable when sufficient; additional roles, gates, or frameworks require evidence that simpler alternatives cannot resolve the cited failure.

### 10. Diagnostic routes by failure pattern

| Observed pattern | First investigation and likely route | Required next-run check |
|---|---|---|
| Required capability absent | Reuse/register the smallest missing capability | Real creation, exposure, semantic invocation, and later parent use |
| Capability exists but is not visible | Inspect actual tool schema/catalog/provider input | Correct version appears where the Agent can use it |
| Agent recognizes need but authoring stalls | Count management turns and inspect receipts | Fewer steps to a correct result without bypassing validation |
| Repeated format/capacity refusals | Repair unambiguous format and transaction recovery | Correct update succeeds; invalid semantic evidence is still rejected |
| Tool executes but result is wrong | Compare result to public input and test its scope | Correct outputs or explicit limited validity; preserve counterexample |
| Result correct but interpretation unsupported | Separate descriptive output from the claim it can support | Later use does not treat partial evidence as proof of an entire goal |
| Result delivered but not used | Inspect timing, context retention, relevance, and ownership | Observable later decision/use, or justified non-use |
| Old prompt/fact/version stays active | Scope and lifecycle invalidation | Actual next request/invocation no longer uses obsolete content |
| Refuted premise still funds same plan | Inspect invalidation and continuation/restoration | Original commitment pauses; independent checks remain possible |
| Long reasoning repeats calculable work | Evaluate programmatic checking and context overhead | Correct calculation reduces repeated work without losing task quality |
| Critic repeats parent bias | Inspect access to raw evidence and verification | Specific substantiated finding, or suppress/retire ineffective critic |
| Components run but task progress does not improve | Inspect which actual burden was removed and remaining bottleneck | A smaller focused change addresses the next evidence-backed bottleneck |
| Provider/bridge failure | Diagnose infrastructure, invocation identity, and retry safety | Recovered path without duplicate environment action |
| Usage or status inconsistent | Reconcile event/accounting contracts | Known/unknown cost and task state agree across artifacts |

Treat this table as a guide, not a rule that each symptom requires the named implementation. Let the actual evidence decide.

### 11. Per-change experiment record

Before each substantive change, record:

```text
iteration_id:
problem and source run/event:
acceptance gate affected:
Astra finding(s) and main-Agent adjudication:
current explanation and confidence:
competing explanation(s):
one primary factor to change:
specific mechanism/responsibility:
why simpler alternatives are insufficient, if applicable:
what remains unchanged:
predicted observable behavior:
evaluation method and target evidence layer (runbook Sections 6–7):
primary task metric, relevant diagnostic metrics, denominators/unknowns:
acceptance threshold and allowable regression:
falsification/failure condition:
negative case:
added resident context, tool calls, model calls, and runtime cost:
burden removed:
local diagnostic checks:
real-run type, comparator, and fixed configuration:
per-run budgets and remaining deadline:
rollback/retirement plan:
```

Reuse the existing change record/template for these fields; do not duplicate data or require irrelevant metrics. Use runbook Section 7.1 for measurement definitions, including all-participant cost, incomplete-event accounting, semantic use, and counterexample-to-revision latency. The fixed acceptance contract takes precedence over optional metrics.

A single primary factor may span several files when they implement one necessary contract. Explain that coupling. Do not simultaneously change model, modality, output budget, observation encoding, and critic policy and then attribute the outcome to one of them.

If an urgent integrity bug invalidates earlier evidence, fix it and rerun the affected evidence. Do not preserve an invalid baseline merely to save time.

### 12. Post-review iteration decisions

Apply the following dispositions explicitly:

- **Predicted behavior and task progress improve:** retain the candidate, preserve the evidence, and move to the next unresolved gate or final confirmation.
- **Predicted mechanism behavior improves, task progress does not:** classify as mechanism success with unproven task value; inspect whether the solved burden mattered. Avoid overstating benefit.
- **Predicted behavior fails to appear:** first verify implementation activation and evidence delivery. If correctly active, revise or reject the causal hypothesis rather than simply increasing the budget.
- **Score improves but an integrity gate fails:** do not accept the candidate; fix integrity first.
- **Costs increase without relevant quality benefit:** simplify, narrow applicability, or retire the change.
- **No triggering event occurs:** mark untested coverage; choose a real guided diagnostic when appropriate. Absence of an event is not a pass.
- **Repeated failure of the same explanation:** reassess competing causes. Do not keep stacking reminders or changing arbitrary thresholds.
- **A component is correct but its current application is unhelpful:** change its use or relevance decision; do not automatically delete useful capability.
- **Remaining time cannot support implementation plus verification:** preserve the best verified state and address final evidence/handoff. Do not label untested last-minute code as the passing version.

You may leave an ineffective design and work on another higher-value bottleneck, retaining a clear open issue. Required five-category capabilities remain mandatory; a particular unsuccessful optimization does not.

### 13. Experiment discipline and final confirmation

Maintain separate labels for:

- local/offline diagnostics;
- real guided lifecycle tests;
- real ordinary development runs;
- advanced-model diagnostics;
- final baseline and candidate comparisons.

A guided real test is stronger than a scripted smoke for provider behavior, but it is still not autonomous adoption. An offline replay can verify arithmetic or an interface, but cannot prove that unexecuted game actions would have won.

For final confirmation:

1. Freeze the selected candidate before starting final ordinary runs.
2. Verify all lifecycle coverage against the final candidate or demonstrate that intervening changes cannot affect previously covered production paths; rerun affected coverage when uncertain.
3. Lock per-game comparison conditions before inspecting candidate results.
4. Run/reuse only a valid compatible new baseline whose code and settings are fully recorded. Never select the worst among several baselines after seeing the candidate.
5. Execute final Qwen runs and obtain Astra reviews for each.
6. Count distinct autonomous component categories only from qualifying ordinary final runs.
7. Apply Gates A–D separately, then together.

If a final failure motivates code changes, create a new candidate revision and reconfirm the affected comparisons. Evidence from incompatible candidate versions cannot be stitched together to claim one final build passed everything. Reuse unaffected results only with an explicit compatibility argument; if the result could be affected, rerun it or mark the gap.

Held-out gameplay results may be inspected for acceptance. Once used to choose a mechanism or prompt adjustment, that game is no longer held out.

No ablation is mandatory. Final reporting should say the combined candidate met or failed the criteria, while distinguishing observed component use from unproven causal contribution.

### 14. Process management, checkpoints, and communication

At startup, inspect current processes and files sufficiently to avoid disturbing other work. Maintain an ownership manifest for processes you start: run ID, PID/parent tree, start time, executable, command identity, worktree, artifact root, and cancellation state. Verify identity before termination; do not rely on a recycled PID alone.

Maintain one durable goal checkpoint containing:

- absolute start/deadline and time remaining at last update;
- current iteration stage, the diagnosed bottleneck, and relevant implementation/validation status;
- active branch/worktree, baseline, current candidate, and best verified candidate;
- owned live runs and their budgets;
- pending Astra reviews and adjudication status;
- component lifecycle matrix and Gates A–D status;
- current hypothesis, last rejected explanations, next smallest check;
- runbook path and revision/hash used, the relevant diagnostic branch, and the selected evaluation metrics (by reference to the change record);
- local/real tests completed and unresolved failures;
- held-out contamination status;
- known/unknown cost and outstanding requests;
- next action after restoration.

Use a single index/summary as the authoritative state, with linked per-run artifacts rather than repeated conflicting summaries. Write atomically where practical. Store temporary scripts in an appropriate work/scratch location and real evidence in distinct run directories.

After compaction or restoration, read the checkpoint, inspect live process identities, reconcile completed runs, obtain missing Astra reviews, and continue. Do not restart baseline runs or reset the deadline without evidence they are needed.

For periodic monitoring, follow the current user-agreed cadence and the content categories in runbook Section 6.4; keep sampling separate from reporting and surface material failures promptly.

Keep the user informed at meaningful boundaries: implementation milestones, run completion, Astra's material finding, a causal hypothesis being rejected, entering final confirmation, and blockers. During active tool work, provide timely concise progress updates. Do not ask for confirmation for routine authorized edits or experiments.

Ask for help only when a required decision or external action truly cannot be inferred or performed within authorization. For example, unavailable mandatory Astra access, expired credentials, or an unavailable required official environment may be genuine blockers. Explain what failed and what independent work remains possible.

The host may not support unattended recovery after process/application exit. Persist enough state for restoration but do not promise an automation or wakeup that has not been configured. Do not create recurring automations unless separately requested.

### 15. Evidence outputs and final handoff

Keep raw run evidence under uniquely named experiment directories. Maintain a concise index linking each run to its config, frozen source, trajectory, component records, review, and outcome. Protect secrets in provider logs and scorecards.

For every real run, retain:

- purpose and experiment type;
- source/config/model/modality identity;
- budgets and actual task/resource outcomes;
- lifecycle and autonomy evidence;
- failures, unknowns, and any protocol deviations;
- Astra review artifact;
- main-Agent adjudication;
- resulting decision and next experiment, if any.

Final deliverables:

1. Runnable implementation in the isolated branch/worktree with local commits.
2. Exact final verified revision and reproducible commands/configuration.
3. Five-component lifecycle acceptance matrix, with artifact references for each applicable operation.
4. Ordinary autonomous-conversion matrix identifying at least two qualifying categories if achieved, with actual use evidence.
5. Per-game baseline/candidate comparison and the exact Gate D verdict.
6. Iteration history: observed symptom → Astra review → verified mechanism diagnosis → change → real result → retain/revise/retire.
7. Rejected approaches, unresolved defects, untested coverage, limitations, and known/unknown costs.
8. Owned process status and whether cancellation/cleanup is confirmed.
9. A concise next-step recommendation for any incomplete goal, without implying those steps were performed.

Mark the goal complete only when all binding acceptance gates are actually satisfied and no required work remains. A successful local test suite, five component stores existing on disk, or an improved score alone is not sufficient.

At deadline, give an explicit partial-completion report if necessary: which gates passed, which failed or were not covered, the best verified revision, and why the remaining work could not be completed. Do not use the approaching deadline as a reason to declare success prematurely.

### 16. Start now

Establish the absolute 12-hour deadline and persist it. Read the required instructions and the runbook, inspect the current repository/runtime state, create or select appropriate isolation, and preserve the baseline. Check the available Qwen/image/official ARC path and mandatory GPT-6 Astra review capability without exposing secrets.

Create or restore the acceptance matrix from existing evidence. Identify the earliest supported bottleneck or missing acceptance evidence, choose the smallest useful diagnostic or change, and enter Section 7 directly. Run real ARC diagnostics and matched comparisons when their relevant checks and frozen configuration are ready, and obtain GPT-6 Astra review after every run.

Use the runbook's diagnostic branches, evaluation methods, and metric definitions throughout. Continue autonomously within this contract until all gates pass or the original deadline requires an honest handoff.
