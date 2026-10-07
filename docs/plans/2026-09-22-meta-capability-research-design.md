# Meta capability development: minimal completion design

Date: 2026-09-22. Design review only; no implementation or acceptance claim.

## Judgment and evidence

The current capability followup queue plus `capability_extraction_process.md` is a sound process skeleton. It separates facts from executable methods, permits a single-situation Skill, requires the matching creator, and connects authoring to assembly and exercise. More obligatory stages or a component quota would not repair the observed failure. It is not yet evidence that a real provider follows this process or that useful computation is expressible in the available Tool substrate.

Evidence inspected in `arc-skill-semantic-real-provider-20260922-171012/run`:

- The first committed review explicitly identifies parsing, localization and planning as a capability opportunity. Its submitted component is memory; the other dispositions are `runtime_default`, explicitly not a model judgment. This establishes an opportunity-to-authoring gap, not that every named operation was correct or implementable.
- `summary.json` reports seven memory versions and zero Skill, Tool, Subagent and system-prompt versions, with 13 actions and zero completed levels. These are descriptive observations; the run does not isolate the cause of its outcome.
- `task-operation-failures.jsonl` includes a missing memory key and a later `No eligible candidate exists` review error. Repair overhead exists. The evidence does not establish that this overhead alone explains the missing components.
- `auto-research-sessions.jsonl` records an active research session. The directory listing has no completed report artifact. The existing followup design reports a timeout/absent structured return. A started session must not be counted as delivered research; the exact provider/broker failure requires separate diagnosis.
- Current source projects the full meta process only for a pending periodic review or capability queue. Direct authoring is allowed, but a main that notices an opportunity before either trigger does not receive this full process there.
- Current Tool implementation is a finite declarative interpreter (`adapter_call`, selection, filtering, grouping, comparison and related operations), not arbitrary TypeScript or shell execution. A named computation in a review is not thereby executable. In particular, no claim is made here that the reported parsing/planning proposal fits these primitives.

Hypotheses to test: memory is an easier completion path; creator/contract/context load discourages authoring; the available execution surface cannot express some useful proposals; research delivery failure removes a useful source of analysis. The existing run cannot distinguish these explanations.

## Fixed boundaries

Main chooses methods, reads creators, authors complete components, selects versions, and decides each environment action after receiving the previous result. Research children return research, candidate methods, evidence and experiment requests; they do not author or mutate the harness. Runtime validates, stores, joins references, projects and executes explicit instructions without semantic classification or adoption. Tools are Pi tools. No game algorithm, representation, search method or task-specific heuristic is inserted into fixed guidance.

A Skill must teach a method rather than preserve a trajectory. It need not generalize across situations, contain comparative evidence, or pass a benefit test before being tried. Metadata and exact references support execution/audit; they must not turn broad generality into an admission requirement. Empty evidence sets and explicit uncertainty remain valid where the contract permits them.

## Minimal implementation scope for SOL

1. **Finish the carrier guidance, not another workflow.** Retain the existing six-step process. Add system-prompt as persistent behavioral guidance whose scope justifies continuing exposure; distinguish it from a Skill loaded for a specific procedure and from memory storing facts/hypotheses. A Subagent configuration is appropriate when a prepared or separate context has a concrete next question; no obligation to create one merely because research was launched. State explicitly that relative balance means fitting responsibilities, never equal counts.

2. **Make the process discoverable before a review.** Put a short, task-independent pointer/summary in the baseline index so direct main-authored work is possible at first useful opportunity. Keep the full process available through inspect/current context at existing followup boundaries. Avoid injecting the whole six-step text and full creator bodies on every turn. Reuse exact creator reads. No new action gate or mandatory review call.

3. **Close the implementation feasibility branch.** Tool creator must make main check the disclosed implementation surface before promising a Tool. When an operation is unsupported, main can write an agent-executed Skill for the supported reasoning/procedure, decompose into supported computations, or explicitly defer the Tool with the missing primitive. A Skill must not falsely claim an unavailable executable. No runtime translation of prose into a program; no task-specific primitive added merely to satisfy this run. A generic execution-substrate expansion is a separate decision, with sandbox and budget design, if real runs repeatedly identify useful unsupported operations.

4. **Preserve an operation-specific next use.** Existing followup records should retain opportunity, exact basis, chosen carrier or explicit decline, and next use/reconsideration condition. Reuse existing change/assembly/use/assessment records instead of introducing a second semantic truth store. If queued work is deferred, do not silently reactivate from free text. Main can reconsider on new evidence. Runtime-default omissions remain unresolved; explicit reasoned deferral remains valid. Avoid prompting a response for every empty component category when one operation-level judgment suffices.

5. **Make assessment honest.** Creation, selection, provider exposure, Skill read, executable invocation, main-declared method application and task result remain distinct. A later action can cite the exact Skill and relevant input/output through existing decision/effect fields where supported. Label this declared application, not machine proof that the model followed the method. Do not promote exposure/read or output inequality to correctness or usefulness. Audit should expose missing joins rather than fabricate them.

6. **Keep load visible and bounded.** Audit full creator/read/context tokens, authoring repair calls, elapsed time, pending research, and subsequent actions, using existing telemetry. Keep queue projections bounded and reference full records. A main decision to skip development because no useful next use fits the remaining budget is legitimate. Do not prescribe a universal token threshold or force development before an action. Baseline versus treatment must use comparable action/time/provider limits and report the time consumed before the next environment step.

7. **Separate research delivery from direct authoring.** Audit session start, child process/broker terminal state, structured report persistence, parent delivery and parent adoption as separate joins. Failure at any stage is not a completed research contribution. Successful delivery offers an optional question/candidate/evidence handoff; main still reads the appropriate creator and authors. A timeout must not erase capability followups or block direct creation. Investigate actual timeout cause before changing timeouts or broadening permissions.

8. **Remove conflicting parent guidance in place.** `arc_decision_cycle.md` currently says omitted components are deferred and requires starting or explicitly deferring a generated research handoff before the next action. Clarify omission as unresolved when a capability opportunity exists; replace the research-first sequence with the main-owned choice among direct method development, a grounded research question, or an explicit operation-specific deferral. Research remains optional and does not own the capability-development path. Keep 5/20 reviews advisory. Review the actual composed provider input for redundant/conflicting imperatives, not only the newly added prompt in isolation. The statement that Skills must never copy facts should allow scoped examples and required task parameters: the boundary is method versus trajectory recap, not a ban on task-specific content.

Primary edit targets: `demo/prompts/capability_extraction_process.md`, `demo/prompts/arc_decision_cycle.md`, the baseline/index guidance and narrowly scoped context projection in `demo/pi_task_local_self_harness.ts`, relevant creator adaptation text, and the artifact audit. Preserve the existing dirty tree. Do not expand the interpreter, add research scheduling, or change ARC action ownership in this iteration.

## Acceptance matrix

| Concern | Diagnostic evidence | Real-provider ARC evidence required |
|---|---|---|
| Opportunity to creator | Default omissions survive restart; exact creator call discoverable; explicit decline accepted | Main notices a task-derived operation, reads corresponding creator, then authors or gives a concrete operation-specific reason to defer |
| Direct creation | No research session/review prerequisite | Main-authored useful method is reachable even with research deferred/failed |
| Skill semantics | Valid single-situation method accepted; trajectory-only example rejected or flagged without demanding cross-context reuse | Readable procedure identifies inputs, decisions, output and limits; later use can be traced to current evidence rather than only its original story |
| Pi Tool feasibility | Supported program produces asserted semantic output; unsupported implementation rejected; no hidden ARC action | Main checks surface, implements and invokes a supported computation when justified, or reports the precise implementation gap without fictitious completion |
| Assembly/application | Exact-version selection, read/invocation and invalidation joins | A subsequent real parent turn receives the selected version; observable action/computation follows its intended contract; uncertainty is retained |
| Other carriers | System-prompt exposure and Subagent invocation measured separately | Creation or reasoned non-use follows scope/context needs; no quota; no credit merely for exposure |
| Research | Start/broker/report/delivery/adoption are independent states; failed return leaves followup intact | Delivered structured research actually informs a main-authored choice, or its non-use/failure is explicitly visible; correlation alone is not causal benefit |
| Budget/load | Bounded queue/context projection and telemetry accounting | Development and research overhead, repairs, actions, elapsed time and outcome reported under comparable budgets |

Run `arc-harness-smoke` for closure of wiring/lifecycle: real bridge, Pi parent, child process/broker, structured return, router, native mutation, action boundary and later parent turn, covering all five components and semantic Tool output plus provider-length continuation for Auto-Research and ordinary delegation. Pytest/fixtures do not replace this. Deterministic-provider smoke does not prove method quality or game performance.

For provider behavior, preserve a baseline snapshot and compare to treatment with the same model/settings and declared budget. Do not seed game-specific methods into either fixed prompt. Inspect both successful and failed opportunities, and record count of justified carriers rather than demand every category per run. One run can demonstrate occurrence and expose failures; it cannot establish a reliable performance gain. Any performance claim needs repeated comparable runs and uncertainty reporting. Single-life trajectories do not permit retrospective scoring of the branch not taken.

## Risks and deferred connections

Adding guidance can increase deliberation and reduce remaining actions; creator length and repair load may dominate. Rich metadata can become ceremony. The narrow interpreter can cap Tool coverage even when guidance works. Research delivery may fail independently. New summaries must not mislabel exposure as application or version linkage as causal credit.

Deferred items A/B/C/D remain relevant: agent/runtime responsibility, research questions and evidence, parent-child delivery, and continuity under context pressure. This iteration improves discoverability and auditability; it does not complete adapter separation, active experimental communication, cross-compaction cognitive quality, or causal research-benefit acceptance.

## Overall completion standard: capability breadth and workload allocation

A legitimate deferral is a valid result for one opportunity, not evidence that the overall capability-development objective is complete. All-defer, memory-only, read-only, or create-without-use experiment portfolios fail the overall objective even when their records are internally consistent. Distinguish three verdicts: protocol works; real-provider capability behavior demonstrated; performance/resource benefit supported. Passing an earlier verdict does not imply the later one.

### Minimum real-provider evidence across the experiment portfolio

Use naturally occurring, evidenced opportunities from real ARC play under declared budgets. Do not tell the model which game algorithm or specific component body to produce. Across the portfolio, the following coverage is necessary before declaring the requested breadth demonstrated:

- **Skill:** main derives and authors a method, reads the matching creator, commits and selects its exact version, loads it, and a later real parent turn applies it to an applicable task input. Inspect the procedure, subsequent decision/output and cited evidence together. A single-situation method qualifies. Application is an evidence-linked semantic audit, not an automatic inference from read events.
- **Pi Tool:** main authors an executable computation/operation against the available substrate, commits/selects it, and invokes it on an applicable task input. Verify the actual semantic result against the declared contract, including a meaningful contrast or failure input where feasible. A wrapper returning its input, a registration receipt, or a stated implementation gap does not meet this coverage.
- **Subagent configuration:** on an evidenced need for a separate/prepared context, main reads its creator, authors and selects a saved configuration, then actually invokes that exact version. The child produces a substantive bounded result; a later parent turn uses or evaluates that result. Merely launching ordinary Auto-Research does not establish creation/use of a Subagent harness component. Rejection of the child's conclusion may count as evaluated use, but not positive benefit.
- **System prompt:** on an evidenced need for continuing behavioral guidance, main authors and selects a scoped segment, and a later real provider request contains the exact version. Inspect subsequent relevant behavior and an assessment against the intended change. Exposure alone meets wiring coverage only; it does not demonstrate the intended behavioral application or benefit.

Memory remains useful supporting state/evidence. It is not a substitute for any of the above role coverage. These are existential coverage obligations across experiments, not quotas per run or equal component counts. If no legitimate opportunity for a carrier has occurred, report its coverage as **not demonstrated**, continue selecting representative ARC tasks/settings or leave the overall claim explicitly incomplete. Do not manufacture a pointless component to fill a checklist. Multiple carriers may cooperate in one meaningful workflow; their separate responsibilities and exact-version use must remain observable.

At least one portfolio case must demonstrate direct main creation without successful research as a prerequisite. At least one must demonstrate the optional research path through structured delivery, main judgment, creator-based authoring and later use. Otherwise report only the path actually established. For the research case, provenance proves contribution to the decision path; improved task outcome remains a separate causal claim requiring comparison.

### When the Pi execution substrate must be reconsidered

Do not close overall Tool coverage with `pending_implementation`. Escalate to a generic substrate design when an audited real-provider proposal has (1) a concrete task-relevant input/output contract and reachable next use, (2) computation that is deterministic or explicitly bounded and requires no hidden environment actions, (3) a confirmed expressiveness gap in the disclosed substrate, and (4) no adequate existing composition. Repeated independently observed gaps strengthen prioritization, but a single well-established gap blocking necessary Tool coverage can justify design; there is no repetition quota.

First distinguish missing discoverability, invalid syntax, incorrect assumptions, and authoring failure from actual expressiveness. A failed model attempt alone does not justify new execution power. Preserve the original program/contract and interpreter error or a minimal expressiveness analysis as evidence. Do not implement the particular game solution as a new named primitive.

The follow-on design, if triggered, should choose the smallest task-independent capability: for example safe parameter/data binding and generic structured iteration/expressions when that closes the gap; a restricted pure-program executor only when a small combinator extension cannot reasonably express it. The choice must follow observed contracts rather than preselecting a broad interpreter. Required contracts include input/output serialization, exact program versions, deterministic results where claimed, execution/step/memory/output/time bounds, structured errors, and provenance. No arbitrary filesystem, network, process spawning, package installation, live bridge access, or hidden action sequence. Main still owns every environment action. Skill text cannot claim executable code that the runtime cannot execute.

Validate the substrate with task-independent conformance and adversarial boundary tests, then repeat real-provider ARC authoring/invocation acceptance. Engineering implementation of a generic executor is infrastructure work; the main model must still supply the task-specific computation during the run. This document authorizes design direction only, not an unreviewed sandbox expansion.

### Relative workload balance: an opportunity and responsibility audit

Do not compare raw component counts or impose target token percentages. Audit each salient observed operation or capability opportunity as a row: purpose and evidence; chosen carrier(s); reason for direct execution/reuse/defer; supported execution surface; creator/change/assembly/use references; semantic output; downstream assessment; and action/token/time/repair cost. Include missed opportunities from transcript review, not only those the model chose to record. Keep this external audit out of runtime semantic decision-making.

Balance is demonstrated when the observed work is allocated coherently: memory preserves scoped facts/hypotheses; Skills carry procedures that main actually follows; Tools perform suitable implemented computations; Subagents perform justified bounded work in their configured contexts; system prompts carry justified persistent guidance. A few high-value Tools can do more work than many memories. Conversely, many unused components do not establish balance.

Look for displacement of the intended work: does main still repeatedly perform the same computation after creating a Tool; does it reread a Skill without applying it; does research consume the remaining horizon without deliverable use; does system-prompt content duplicate lengthy facts; does memory serve as an unexecuted procedure archive? Such evidence keeps workload-allocation acceptance open unless the concrete costs or changing applicability justify the choice. A deferred item recurring with the same unmet prerequisite is a visible unresolved gap, not progress.

Report costs by execution, capability development/maintenance, and research, preserving shared/unattributable costs instead of fabricating a split. Include provider reasoning/output tokens where available, wall-clock latency, context/creator load, failed repairs and how many later applicable uses amortize construction. Check that meaningful environment progress remains reachable within the same declared budget. Large research/management cost is not automatically wrong; it requires an evidenced role and delivered/evaluated output. An aborted or failed research branch retains its full cost.

The completion report must therefore state: carrier coverage achieved/missing; opportunities handled/missed/deferred; actual use and semantic results; role allocation and unresolved displacement; total and attributable costs; task outcomes; and limits of causal inference. If guidance works but infrastructure cost prevents useful application, report behavior demonstrated and resource goal unresolved. If breadth exists but no fair comparison supports efficiency gains, say so. Independently varying research/time budgets can diagnose load, but do not attribute that improvement to guidance when both changed together.

## Baseline contract-usability finding and minimal repair design

The fixed baseline `arc-capability-process-real-provider-20260922-185500` supplies new evidence. Its 13:51–13:52 failure records show a main-authored Skill with an ordered procedure, mismatch response, uncertainty and output. The failed publication is not evidence that main failed to formulate a method. The first creator reference is malformed; the next candidate provides method fields at the candidate top level instead of inside `method`; failure-4 has `method.decision_points` as a single string (verified from `attempted_input`, despite the generic error mentioning objects); the subsequent corrected publication encounters an expired review opportunity. The substantive method still contains unverified task hypotheses, so admit it as a candidate rather than certify its correctness.

Minimal deterministic contract improvements:

1. Return a compact complete create/change template with `read_method` or its contract reference: exact current `authoring_method_ref`, required candidate keys, the actual nested `method` shape and actual field types. Generate or validate the template against the same contract used for admission. Use task-neutral placeholders, never a game solution. Show exact valid scope choices rather than stale cross-context requirements.
2. When `candidate.method` is absent, collect explicitly supplied, recognized top-level method fields into that container without changing their values. If `method` exists, do not merge alternate semantics from top-level fields; reject conflicting duplicate values with exact paths. Canonical persistence has one method representation. Do not parse prose into missing metadata or fill missing judgments.
3. A scalar authored string can be normalized to a singleton string array where that field is an authored list; it preserves content and makes no decision about splitting or interpretation. Never split on semicolons or stringify objects. Objects require a precise path/type error and schema example. Aggregate independent structural errors before rejecting so one repair can address all of them.
4. Creator-ref mismatch should expose the current exact expected reference and whether a matching read is already recorded. Keep exact-version and read checks. If the correct creator was already read, do not prescribe another full-body read merely to repair a copied reference.
5. Expired review errors should expose the independent `change` recovery route with the submitted component body preserved as data. Main rechecks applicability and explicitly resubmits. Do not silently publish, auto-adopt a candidate, resurrect the review, or extend its deadline. An expired administrative window must not erase authored content or make direct publication inaccessible.

Prefer these bounded shape and disclosure repairs over a broad metadata redesign. The longer-term deduplication question is whether prose and structured method fields both need full duplicated steps; changing that requires tracing actual consumers. For this iteration, one canonical nested representation plus syntax normalization addresses the observed failure without inventing semantics. Diagnostics must verify content preservation, duplicate conflict rejection, no write on failure and review-independent change recovery. Real-provider acceptance must show the repair reaches creation/assembly/use rather than merely that schema fixtures now pass. Preserve the frozen baseline snapshot unchanged.

## Deferred: assessment dimensions and unresolved negative assessments

Status: verified design issue, **not implemented in this iteration**. This followup does not enlarge the frozen implementation or experiment scope. Passing current tests does not close it.

Source inspection found that the effect-assessment record constructed in `demo/pi_task_local_self_harness.ts` contains `verdict`, `consequence`, `remaining_uncertainty`, actual-use references and resource references, but no assessment dimension. In `demo/pi_research_method_runtime.ts`, `advanceMethodAssessment` maps any `unsupported` verdict with later actual use to `contradicted`. `methodUseRejection` also searches any historical assessment for `unsupported` plus actual-use references matching the resource. Thus an unsupported benefit claim can be treated as a correctness contradiction, and a historical negative record can continue to reject use even after a later favorable assessment. Tool and saved-Subagent invocation call this rejection function. This is a code-path finding, not proof that this failure occurred in the observed baseline.

The 2026-09-18 evidence-driven design already distinguishes explanation, method correctness and method utility. A minimal followup should preserve that distinction and existing protection:

- Add an explicit assessment dimension (`method_correctness`, `method_utility`, or legacy/unknown `unspecified`) and an explicit main-owned disposition using existing lifecycle operations, rather than interpreting free-text consequences.
- Technical invalidity, unavailable dependencies and withdrawn permissions remain hard admission failures. A favorable semantic assessment cannot restore missing authority or a broken dependency.
- A correctness counterexample tied to the exact version retains revise/suspend protection. Main must explicitly address the counterexample, revise scope or implementation, or resolve the suspension with evidence; an ordinary load or later successful example must not silently override it.
- Unsupported utility does not establish incorrect computation. Preserve correctness evidence separately, while requiring main's explicit revise/suspend response under the existing policy. Revision can concern applicability, selection conditions or cost justification rather than changing an otherwise correct algorithm.
- Legacy `unspecified` negative records retain current protection. Do not infer their dimension or silently unblock them during migration. Main must explicitly classify/reassess the evidence and resolve the recorded blocking reason through the existing lifecycle.
- Base rejection on the current unresolved blocking state and exact version, with an explicit resolution reference. Preserve historical negative evidence for audit. Do not use an eternal `any historical unsupported` predicate after the corresponding block has been explicitly resolved. Change maturity advancement and invocation rejection together so they cannot disagree.

Runtime only validates these explicit choices and maintains reference/state consistency; it does not decide whether a negative result was a correctness failure, insufficient benefit, or a reason to resume. No automatic recovery, evidence erasure, or weakening of creator/version/permission checks is proposed.

Followup diagnostics should cover a correct but costly method, a true counterexample, a technical/permission failure, legacy unknown negatives, unresolved versus explicitly resolved suspension, and contradictory later evidence that does not automatically clear a block. Real-provider ARC evidence must then establish that main can assess, explicitly revise/suspend or resolve, and use the appropriate exact version on a later parent turn. Component tests alone establish neither ARC closure nor the quality of that judgment; the existing full smoke and real-provider acceptance requirements continue to apply.

## Proposed restricted computation substrate — coordinator review required

Status: design only, not authorization to implement or change a frozen experiment. Source review established that the existing projection-only `map`, literal-only `filter`, object-only `pick` and adapter allowlist cannot compose variable-length nested expansion, dynamic rectangle extraction and input-parameter predicates. Main's failure to read the creator remains a separate behavioral finding.

### Choice

Prefer a small JSON expression AST evaluated by an explicitly bounded interpreter over arbitrary JavaScript/TypeScript or a general pure-program executor. General code needs a sandbox, language/runtime isolation and substantially larger resource-accounting surface. The required computations need only finite JSON transformations. Preserve existing programs; add one versioned pure-expression program form, mutually exclusive with adapter-call programs, rather than mixing new expressions with effectful calls. The pure evaluator receives only validated JSON input and its immutable AST. It has no adapter object, bridge handle, filesystem, network, process, package loader, clock, randomness, eval, or host-object access.

### Contract and minimal vocabulary

Illustrative publication shape (final names may follow existing schemas):

```json
{
  "program": {
    "format": "task-pure-expression-v1",
    "expression": {"op":"get", "value":{"op":"input"}, "key":"items"},
    "limits": {"steps":50000,"output_bytes":131072,"max_depth":32}
  },
  "input_schema": {"type":"object"},
  "output_schema": {"type":"array"}
}
```

These numeric limits are initial engineering candidates for review, not automatic configuration changes or required allowances. Runtime-owned ceilings always dominate requested budgets; caller cannot increase them. Specify AST-node, input-byte, collection-length and cumulative allocation ceilings as well; depth/steps/output alone do not bound temporary memory. Use safe finite JSON numbers and bounded integer indices/ranges.

Minimal operations:

- `input`, `literal`, `var` and lexical `let`: explicit binding of original input and intermediate values; no free variables or mutation.
- `get(value,key)` for own object properties and `index(array,index)` for arrays. Keys/indices may be expressions. Missing fields, wrong types and out-of-range access produce structured errors; an explicit optional/default form can be added only if authoring needs it. Reject prototype-related keys, reject non-JSON objects and never resolve methods or inherited properties.
- `object(fields)` and `array(items)` construct JSON outputs from expressions. Define field order deterministically and reject duplicate object keys.
- `add`, `subtract`, `multiply`, `eq`, `lt`, `lte`, `and`, `or`, `not`, and lazy `if`: strict types with no string/number coercion. Arithmetic overflow/non-finite results fail. Equality is structural JSON equality with its work charged to the same budget. Boolean operations short-circuit.
- `range(start,stop)` yields integer indices with exclusive stop and unit positive stride; zero length is valid, invalid order/type fails. Validate requested length before allocation and charge every emitted element.
- `map(array,as,body)`, `flat_map(array,as,body)`, `filter(array,as,predicate)` and `all(array,as,predicate)`: finite iteration, lexical item binding, stable order, no recursion or general loops. `flat_map` body must return an array. `all([])` is explicitly true; authors who require nonempty inputs must check length.
- `length(value)` for arrays/strings and `assert(condition,value,message)` for author-specified contract checks. String length semantics must be documented; string parsing/regex are out of this first extension. No generic function definition, invocation, recursion, sort comparator, reduce or dynamic code is needed for the evidenced structured-data operations.

The AST is authored by main through the existing Tool creator/change interface. It may express task-specific computations using generic operators; the runtime ships no RLE decoder, ARC geometry helper, traversability rule or task algorithm. This proposal assumes structured row/run input. If the only available material is raw text, record a distinct input-access/parsing gap rather than pretending this AST parses it. Structured observation access is a separate read-only contract decision; no live action capability follows from it.

The expressive sufficiency argument is structural: nested `map`/`flat_map` with input-dependent `range` can expand bounded encoded segments; `range` with `index` can extract input-specified row/column intervals; `all` with dynamic input lookup/comparisons can evaluate an authored predicate. The provider must author the actual algorithm and its assumptions. These examples belong in engineering diagnostics, not fixed ARC guidance.

### Resource and version semantics

Validate the entire AST structurally at publication: known format/operators, exact operands, bound variable names, maximum static depth/node count, unique bindings and supported schema subset. Validation does not prove semantic correctness or authorize execution before assembly selection. Keep exact Tool/program hashes and resource versions; program/schema/limits changes create a new immutable version. Preserve existing creator-read and assembly/version checks.

At invocation validate input, then evaluate under a single shared budget across every nested expression. Charge node visits, collection traversal, equality work and emitted/allocated elements; reserve capacity before allocation. Bound string/object copying and final serialization too. Observe cancellation at bounded intervals. Avoid native unmetered helpers on attacker-sized collections. Dynamic depth is bounded independently of AST depth; reject excessive nesting while validating input and output. Require deterministic output or deterministic structured failure for the same program/input/limits.

Validate output against the saved output schema before publishing success. Return stable error codes such as `invalid_input`, `invalid_program`, `type_error`, `missing_field`, `index_out_of_bounds`, `assertion_failed`, `budget_exhausted`, `output_too_large`, `invalid_output` or `cancelled`, with AST path and consumed limits. Errors do not return a partial result as success. Record exact version, input hash/evidence reference, output hash/result, effective limits and consumption. Do not label output inequality as semantic correctness or utility.

### Diagnostic and real-provider acceptance

1. Task-independent conformance covers lexical shadowing, dynamic fields/indices, nested variable-length transforms, empty collections, strict types, condition short-circuiting, structural equality and deterministic ordering. Use data such as nested invoices or grouped measurements rather than preinstalled ARC solutions.
2. Adversarial tests cover AST recursion attempts/unknown ops, unbound variables, prototype keys, overflow, huge ranges, repeated nested expansion, large intermediate objects with tiny final outputs, deep input/output, excessive equality work, malformed schemas, cancellation and final serialization limits. Verify all fail within limits with no filesystem/network/process/bridge access.
3. Version tests cover input/output schema failure, creator prerequisites, unselected/retired versions, mutation after publication and exact receipt attribution. Preserve existing ARC action and child permission boundaries.
4. An isolated short diagnostic may ask a real provider to author a generic bounded JSON transformation from the disclosed contract and exercise contrasting inputs. It tests learnability and repair cost, not ARC acceptance.
5. Real-provider ARC acceptance still requires main to identify useful work, read the creator, author its own AST, assemble/invoke the exact version, inspect semantic output and use/evaluate it on a later turn under comparable task budgets. Record how much work main did to prepare inputs; success cannot consist of main computing the answer and the Tool only counting or echoing it. Keep all four non-memory carrier goals, optional research-path coverage and full smoke requirements intact. No improvement claim follows from interpreter conformance alone.

The coordinator should review vocabulary, ceilings, structured-input availability and instrumentation before approving implementation. If this proposal grows into arbitrary text parsing or general code, stop and assess that additional requirement separately rather than quietly expanding the sandbox.

### Required companion: exact-resource input binding and current snapshots

Verified input evidence: in `arc-capability-process-real-provider-20260922-221940`, resource `pre_action_state:arc-pre-action-1@v1` contains `public_state.frames[0]` as a numeric 64-by-64 array; its full serialized record is approximately 9 KiB. `task_resource.read` already grants the parent task-scoped paged access to this JSON. The `row_runs` displayed in action text instead contain strings such as `34-38=12`; those strings are not the proposed AST's structured input. The historical pre-action resource must never be presented as the current post-action state.

Add a bounded host-side input preparation envelope to the existing dynamic Tool invocation, separate from the authored computation input schema. Illustrative shape:

```json
{
  "parameters": {"bounds":{"top":1,"left":2,"height":3,"width":4}},
  "bindings": [{
    "name":"grid",
    "ref":"observation_snapshot:parent-state-12@v1",
    "path":["public_state","frames",0]
  }]
}
```

`observation_snapshot` is a proposed resource kind, not an existing callable reference. Runtime supplies actual references; main must not invent them. The host prepares `{bounds:..., grid:<resolved JSON array>}` and validates that object against the Tool's input schema. `parameters` must be a JSON object; each binding adds one top-level field. Reject duplicate binding names and any collision with an explicit parameter, rather than silently overriding either. The path is a bounded sequence of own-property string keys or nonnegative integer array indices, not an expression, wildcard, pointer to a file, or latest-version selector. Missing paths, forbidden keys, type mismatches and out-of-range indices fail before evaluation. Exact resource versions are mandatory. No string interpolation, recursive binding expansion or semantic transformation occurs.

Reuse `resolveTaskResource` and the task-scope checks in `demo/pi_task_resource_store.ts`. Centralize/refactor its existing parent/child read authorization so bindings cannot bypass the `allowedRefs` grants currently enforced by `installTaskResourceReader`; calling the bare resolver is insufficient for a child. Parent bindings access only indexed resources in the same task. If this computation surface is later offered to a child, bindings require that child's exact grants and fixed evidence cutoff; they do not grant new access or live state. The first parent implementation need not expose dynamic Tool invocation to children.

Resolve, validate and copy bounded JSON on the trusted host before entering the interpreter. Count resolution/input bytes and preparation cost in invocation limits and telemetry. Resolve each requested version once for that invocation; never refetch current state while evaluating. The AST receives only the prepared JSON value, with no resolver, root path, file handles, resource lookup callback or adapter object. Saving a Tool stores its program/schema, not a permanent grant to every resource main might name later.

For **current** data, use the existing parent state read in `demo/pi_arc_agi_3_extension.ts` (the decision-cycle `/state` read), and register its canonical public data as an immutable task resource through the existing store. Keep public-field selection explicit; exclude evaluator/private/backend fields. This is an agent-runtime snapshot of an already-authorized read, not a new bridge action, extra environment interaction, or derived game representation. Do not add another provider/service. Prefer a small resource-store registration helper plus a new file-kind mapping; do not overload a historical `pre_action_state` record with different semantics.

The record minimally contains snapshot ID/version, task scope, canonical `public_state`, source digest, capture timestamp, parent decision-cycle identity, and the latest observed successful action/event boundary. Subsequent changes create a new immutable reference. Reusing an identical prior snapshot is permissible only if the returned receipt still records the new observation boundary explicitly; initially, one distinct record per existing state read is simpler and avoids ambiguous timing. Announce the exact snapshot reference alongside the already-rendered state without duplicating the full grid in provider text.

Invocation provenance records each binding's exact resource ref, path, record/content hash, resolved-value hash, captured state boundary and current observed boundary at call time, plus explicit-parameter hash and final prepared-input hash. After a later action, old snapshots remain readable historical evidence. Mark boundary mismatch as historical/stale; do not silently rebind to a new snapshot or automatically forbid intentional historical analysis. In environments that change with wall time, equal action boundaries do not prove freshness: expose capture time and claim only 'as observed at capture'. No snapshot grants reset, replay, hidden state or action authority.

Suggested initial engineering defaults / hard ceilings: AST nodes 2,048 / 8,192; AST and JSON depth 32 / 64; input bytes 128 / 512 KiB; charged steps 250,000 / 1,000,000; elements in one collection 8,192 / 32,768; cumulative constructed elements 100,000 / 500,000; cumulative logical allocation 8 / 32 MiB; output bytes 64 / 256 KiB. Reserve before allocation and charge traversal, comparison, copies and serialization. Check cancellation at most every 256 charged steps; use a 250 ms / 1,000 ms watchdog as a separate nondeterministic infrastructure limit, not a semantic outcome. These are candidate operating limits to benchmark, not game rules or claims of proven sufficiency. A 64-by-64 numeric grid is small enough to plausibly fit several ordinary transformations, but actual metering must verify that expectation.

Before implementation acceptance, diagnostics must demonstrate same-task binding, child-grant denial, parameter collisions, missing/invalid paths, immutable historical reads, stale-boundary reporting, input-size and allocation rejection, and exact input/output provenance. A provider must then author and use a Tool whose substantial input arrives by reference, with a new current snapshot after an action and an intentional historical comparison. This closes input reachability; it does not itself establish useful task performance. Coordinator review governs implementation; frozen runs remain unchanged.
