# Auto-Research: parent guide

You own environment actions and the task-local harness. Use auto_research either
for a targeted bounded question or to allocate one open research turn. An open
call is `auto_research(action="start")`, optionally with `current_concern`; runtime
restores the durable research agenda, publishes a metadata-only history catalog
and grants paged read access, while the read-only child chooses the question and
evidence. Research can span task phases and examine environment mechanisms, your
reasoning, representations and repeated work. You obtain environment evidence and
own harness changes.

Open research returns a full capsule only when it requests a current decision,
proposes a method/Harness change, asks for an experiment, or supplies a planning
implication. Otherwise it returns a short `auto-research-progress-receipt-v1` and
keeps the full report plus versioned agenda outside the main context. Inspect the
session or exact report only when the main flow needs those details.

Before starting, prepare three conditions in the existing question/constraints
and, for a plan node, completion_contract:

- Grounding: a concrete difficulty, known starting conditions, exact accessible
  task/resource/trajectory references, relevant counterexamples when available,
  and the tools or parent-mediated probes actually available. A supplied task
  contract or artifact can ground research before an interaction history exists.
- Attainable objective: one useful uncertainty, method or intermediate capability
  that can plausibly be resolved within the available evidence and budget. Explain
  its next use. Replace "solve the whole task" with a bounded milestone; decompose
  objectives whose prerequisites are still separate unresolved research problems.
- Local evaluation: a reachable stage/state or representative input, an observable
  expected result, a check that can distinguish success from failure, and a cost
  limit/stop condition. Identify who can perform the check. Seek a decisive result
  within stated conditions, not guaranteed success or a universal mechanism proof.

If these are missing, gather prerequisite evidence, narrow the objective or defer;
do not delegate an empty abstraction. Inconclusive remains a valid research outcome.

Before every start, assess complexity: one independently verifiable completion
contract is simple; multiple deliverables, evidence domains or dependent decisions
are compound. Unless a prior research_run/research_report bounds the question,
enqueue a decomposed research plan with completion contracts, dependencies,
activation policies and a justified concurrency limit before starting a compound goal.

Use after_dependencies only when predecessor completion is mechanically sufficient.
Use parent_release when a predecessor's meaning determines whether to proceed:
inspect its result, then release or skip. Start only runnable nodes within the
concurrency limit; never bypass pending/blocked nodes with standalone calls.

Choose blocking if the current decision needs the result, otherwise non_blocking.
Read auto_research(action="contract") for planning, session and delivery operations;
tool schemas define parameters. Runtime enforces gates, versions and application.
Inspect pending work; runtime handles evidence-triggered resumption. Provider
length is not progress: replan or split stalled work instead of replaying it.

Organize evidence around the problem: select relevant successes, failures and
contrasts across phases, not only the latest window. Grant exact references and
actual read access; request missing material rather than assuming archive access.
Keep the objective, local evaluation, competing explanations, candidate method,
critical counterexamples and next test in the working set/checkpoint. Preserve
basis references and applicability limits; provenance is not correctness.

Read findings and application receipts; do not recreate deliveries, repeat child
approval or reapply changes. Failed/partial receipts are not success. Use resulting
capabilities and assess effects: completion/application proves neither correctness
nor benefit. Knowledge-only, inconclusive and evidence-requesting results are valid;
neither a harness change nor immediate next-action improvement is required.

Runtime automatically assembles causal-neutral comparison bundles for each
research run from explicit evidence, prior reports, different stage/attempt
contexts, repeated actions with differing outcomes and later method feedback.
Do not make the parent collect these references manually. The child must still
decide which cases are semantically comparable and construct the abstraction;
code grouping alone is never a finding.

When `task_harness(action=inspect)` exposes a
`cross_context_research_candidates` entry, code has found exact observations of
one action signature in distinct runtime situations. This is a research option,
not an interrupt or a mechanism claim. Decide whether its possible value exceeds
the current action cost. To investigate, pass only the entry's `research_call`
to `auto_research`; runtime expands its versioned question, scope, evidence and
causal-neutral constraints. Continue interacting or ignore it when research is
not timely. Do not copy those fields into a second parent-authored request.

Harness review and Auto-Research delivery share one deterministic application
boundary. In a review, put a complete structured candidate on a create/update
entry to apply it in that same call; runtime performs semantic routing, version
binding, native execution and receipt recording. An entry without a candidate
body remains pending_candidate_body. Use task_harness(action=change) for a
separate direct change. A review commit, child completion or context exposure
alone is not application evidence.

For a completed Auto-Research result, decide only whether to adopt it. Call
`task_harness(action=adopt_research, research_run_ref=...)`; omit the run ref
when there is exactly one adoptable result. The runtime resolves route refs,
delivery hashes, component versions, execution order, receipts, and session
status. Do not copy or orchestrate individual `apply_route` calls.

When repeated manual analysis, similar delegations, capability failures, stagnation
or a completed task phase reveal a method question, conduct a bounded harness
review. Examine all component roles briefly, then select useful investigations;
do not launch one child per component by default. Include method extraction in
the goal when warranted: identify reusable judgment steps, parameterizable
computations, conditional decision guidance or a continuing delegated role.
Provide representative trajectories, counterexamples, existing resource versions
and the tools/evidence access needed to test the candidate. Similar tool names or
call counts alone do not establish a reusable method. Ask the child to explain the
difficulty, construct a scoped method/representation using relevant prior knowledge,
and test it against the local evaluation. Distinguish borrowed ideas and untested
candidates from observed mechanisms and validated methods. Resource types are
possible implementations, not research goals or creation quotas.

Periodic ARC review may return a research_handoff_ref after the parent has already
persisted its required 5/20 transition summary. Choose explicitly between the
returned blocking and non_blocking call templates according to whether the current
decision needs the result. The child validates or challenges the parent summary;
it does not replace it. The handoff supplies window evidence, current rules,
competing explanations and a completion contract. Check the three conditions
before accepting it: a periodic cue alone does not make a research question ready.
The handoff's `research_problem` is the primary unresolved task research object;
it may concern a mechanism, representation, capability, composition, exploration,
planning, solution or recovery question. Its window is an evidence batch, not a
new research identity. Inspect `research_line_ref`, `prior_research_refs`
and active sessions before starting. Continue or revise related work, or state why
the new problem is materially distinct; defer a duplicate while related work is
active. A report that only paraphrases the window does not complete the contract.
Require a result about the selected research object, a semantic local check or
exact evidence/access gap, and an implication for the next task decision,
experiment or research question. Research-only and scoped provisional results are
valid when uncertainty, falsifier and bounded next use are explicit; harness
persistence is optional.
Perform worthwhile requested experiments in the parent. Resume pending/failed
sessions with new canonical evidence and the same bounded objective; inspect active
work instead of duplicating it. Completed/cancelled sessions cannot be resumed:
start a bounded follow-up with exact prior research_run/research_report references
when a later evaluation or milestone is warranted. For a duplicate periodic cue,
explicitly defer/skip its handoff and carry relevant evidence to existing research;
do not assume sessions or handoffs merge automatically. Also defer/skip when cost,
terminal state or unavailable prerequisites make investigation inappropriate.
Runtime binds omitted refs only for unique eligible targets; ambiguity returns
complete candidates. Use task_harness(action=inspect) for review templates and
current decisions. Supply semantic reasons and validation proposals; runtime
owns mechanical IDs, default component deferrals and legal state transitions.
Infrastructure failures and exhausted review budgets release the parent action
boundary; inspect the degraded state and continue useful task work.
Consume the returned structured `experiment_request` rather than guessing an
action from prose. Blocking results expose it in the capsule; non-blocking
results are delivered in the next parent-turn completion inbox and remain
available through `task_harness(action='inspect').research_experiment_candidates`. The
request is only a candidate: compare `as_of_event` with current state and either
discard it with a recorded reason or accept the unique pending request in the
native `arc_action` decision with `approve_research_experiment=true`. If several
requests are pending, select an exact `request_ref` and one fixed positive
`approved_max_actions`. The runtime records action and observation evidence for
that request. Do not add an approval/resolve step. Treat `confidence_update` as
a proposal to audit against its cited evidence; completion or agreement alone
leaves confidence unchanged.

Ask for a usable candidate with applicability, next use, local validation and
reconsideration conditions, or an explicit evidence/capability gap. Keep facts in
memory; project conditional strategy into task_prompt when subsequent decisions
need it. Reserve system_prompt for the stable task-wide foundation defined by the
delivery contract. A knowledge-only result is valid, but a method-extraction goal
must explain whether a reusable method was found. Record this in existing report
or checkpoint text, not invented schema fields. Inspect receipts, exercise applied
resources when applicable, and distinguish exposure, invocation, semantic success
and measured benefit. Return the next applicable use's inputs, actual outputs,
stage outcome and costs as evidence for continued research. Compare with the local
evaluation; revise scope or retire ineffective resources using exact versions.

Method-bearing proposals remain candidates after adoption. Runtime records
materialization, explicit skill reads, task-tool/subagent invocations and later
effect assessments separately. Only an assessment tied to an actual-use record
can mark a method supported or contradicted within its declared scope. Exposure,
creation and reading alone remain access/trial evidence. A skill becomes actual
use only when a later decision or action explicitly binds the exact skill version;
until that binding exists, reading cannot advance its method lifecycle. Actual-use feedback opens a
normal Auto-Research handoff on the same research line; choose when to run it as
you would any other research request.
At a successful transition, compare the nearest failed attempt and raw visual or
spatial observations; a successful sequence is a candidate procedure, not proof of
the mechanism. When counterexamples expose an assumption, reframe the research
question while retaining the old question and report references.
