# Hypothesis Reference

This document is a semantic reference for Meta. It defines the information
boundary between a research hypothesis, a Kernel-managed runtime request, its
runtime evidence, and the next Meta decision.

It is not a research policy, an experiment scheduler, a prompt, or a source of
candidate hypotheses. Meta retains control of the research question, the
hypothesis content, the intervention, the controls, the repetitions, the
resource budget, the evidence threshold, the interpretation, and the decision
to continue, revise, promote, or stop. The concrete task runtime is outside
Meta's semantic model; Meta interacts with it through Kernel interfaces and
the evidence those interfaces return.

## Meta and Kernel Boundary

Meta owns the meaning and decision-making of the research loop:

| Boundary | Meta owns | Kernel provides |
| --- | --- | --- |
| Research semantics | Hypothesis meaning, research design, comparison, interpretation, and successor decision | Persistence and lineage for Meta-authored research objects |
| Runtime request | The semantic intervention, required evidence, acceptance contract, and declared limits | A concrete Harness and isolated execution under the declared contract |
| Observation | The interpretation of evidence and the scope of any conclusion | Runtime state, traces, resource usage, and authoritative evaluator results |
| Safety and integrity | The conditions under which evidence is meaningful | Object locking, capabilities, budgets, environment access, and evaluator authority |

The task runtime is a Kernel-provided execution service, not a separate research
role that Meta needs to model. Meta does not control or interpret its internal
policy, loop, tools, memory, or implementation. Meta only specifies what the
runtime request is intended to test and assesses the returned evidence.

The loop is represented as a lineage of immutable or append-only records:

```text
Meta decision
  -> HypothesisSpec / Kernel request
  -> Kernel-managed HarnessInstance
  -> RuntimeRun / EpisodeRun
  -> Kernel evidence
  -> RealizationAssessment + OutcomeAssessment
  -> MetaAssessment
  -> successor decision
```

Every transition keeps references to the parent artifact, content digest,
runtime/environment/evaluator versions, and the evidence used for the
transition. A conclusion without this lineage is a statement, not a usable
research result.

## Methodology Evolution and Independent Evaluation Boundary

The long-running objective is to evolve a reusable Meta Harness methodology
through a lineage of falsifiable hypotheses and validated rounds. Improvement
on an individual task is evidence within that process, not the complete
objective. A methodology state is useful only to the scope supported by its
recorded evidence and remains open to revision by later Meta-designed rounds.

The experimental context contains two distinct evidence planes:

| Plane | Purpose | Information available to Meta | Permitted persistence |
| --- | --- | --- | --- |
| Meta research plane | Let Meta formulate hypotheses, construct experiments through Kernel tools, assess returned runtime evidence, and evolve the selected Harness and methodology | Training task context, prior Meta-authored lineage, task-runtime evidence, and persisted methodology records | Hypotheses, Specs, Harness lineage, runtime records, Meta assessments, methodology state, and task-general experiences |
| Independent evaluation plane | Measure longitudinal generalization of immutable selected Harness versions on a fixed held-out context | No held-out task identity, case content, runtime trace, score, aggregate, or comparison is returned to Meta | Observer-facing evaluation sessions, checkpoint records, verifier evidence, and isolation policy only |

The independent plane may measure a baseline Harness and later selected Harness
digests under the same held-out suite, environment, evaluator, and declared
budget. A checkpoint is created only for a distinct selected Harness digest.
This surrounding measurement does not design Meta's experiment, select a
hypothesis, promote or roll back a Harness, or determine a Meta verdict.

Information flow across these planes is one-way. A selected immutable Harness
may be submitted for independent evaluation, but held-out task information and
evaluation outcomes do not enter a Meta job, a Task memory, the experience
library, an evolution round, or a later hypothesis record. Evaluation runs are
read-only with respect to shared knowledge. Their results are evidence for an
external assessment of the Meta Harness system, not evidence available to Meta
for its own hypothesis assessment.

This separation preserves two different claims: Meta's training evidence can
support its next research decision, while held-out checkpoints can measure
whether the resulting methodology transfers beyond the evidence Meta observed.
Neither claim substitutes for the other.

## Semantic Objects

### Hypothesis

The hypothesis is the semantic research object. Its content belongs to Meta;
the following dimensions describe the record rather than prescribe its
substance:

| Dimension | Meaning |
| --- | --- |
| `claim` | The causal or comparative proposition under examination |
| `mechanism` | The proposed reason the intervention could change the outcome |
| `scope` | The cases, environments, states, or conditions to which the proposition applies |
| `preconditions` | Conditions under which the proposition is interpretable |
| `predictions` | Observable expected consequences, including any intermediate behavior Meta chooses to rely on |
| `falsifiers` | Observable outcomes or conditions that count against the proposition |
| `uncertainty` | Open alternatives, assumptions, limitations, and unresolved confounders |
| `prior_evidence` | References to relevant earlier runs, experience, or rejected interpretations |

`claim`, `mechanism`, `prediction`, and `falsifier` are distinct. A plausible
mechanism is not evidence of an outcome, and an intermediate trace is not an
authoritative task result.

### Operationalization Contract

The operationalization contract is the semantic bridge from the hypothesis to
a Kernel runtime request. It describes what the runtime must make observable
for the hypothesis to be tested while leaving concrete execution details inside
the Kernel-managed Harness.

| Dimension | Meaning |
| --- | --- |
| `required_behaviors` | Observable behavior or checkpoints that constitute the selected runtime realization |
| `required_evidence` | Evidence needed to establish that the declared runtime realization actually occurred |
| `controlled_dimensions` | Variables whose identity, version, value, or budget is held fixed or explicitly compared |
| `allowed_variation` | Implementation variation that does not change the semantic intervention |
| `forbidden_confounders` | Changes that would make attribution to the hypothesis invalid |
| `invalidation_conditions` | Conditions under which the realization or run cannot be used for hypothesis assessment |

The Kernel may use any internal policy, loop, tool binding, memory
representation, or implementation structure that is permitted by its runtime
contract. Those details are not part of Meta's semantic model. The Kernel is
responsible for exposing whether each declared semantic requirement was
instantiated and where the corresponding evidence came from. Internal runtime
implementation cannot redefine the hypothesis or change the meaning of a
requirement.

### Evaluation Contract

The evaluation contract identifies how the result is interpreted. The choices
remain Meta-owned and are part of the hypothesis lineage.

| Dimension | Meaning |
| --- | --- |
| `primary_metrics` | Metrics that determine the declared outcome |
| `diagnostic_metrics` | Signals useful for explanation, debugging, or later design, but not automatically outcome evidence |
| `acceptance_predicates` | Predicates, thresholds, directions, or qualitative conditions used for the declared acceptance judgment |
| `baseline` | The reference state against which the intervention is interpreted |
| `controls` | Comparisons that isolate the selected intervention from other changes |
| `replication` | The repetition, seed, case, or replay context relevant to the claim |
| `generalization` | The scope of any conclusion beyond the observed run |
| `cost_and_risk_limits` | Resource, safety, and side-effect constraints that qualify the result |
| `stopping_conditions` | Meta-declared conditions under which the round has enough evidence for assessment, cannot produce valid additional evidence, or must stop within its limits |

The evaluator result, environment result, and runtime report retain separate
provenance. A runtime-reported score cannot replace the authoritative evaluator
result.

## Round and Research Termination Contract

Termination is a Meta decision with a persisted rationale, not a Kernel verdict
and not an automatic consequence of one score. Meta owns the concrete evidence
thresholds, limits, and judgment of whether another experiment is warranted.
The record distinguishes closure of one hypothesis round from termination of a
long-running research session.

A round is semantically closed only when its available evidence has been
assessed and Meta records one of the following terminal bases:

| Terminal basis | Meaning |
| --- | --- |
| `assessment_reached` | Valid evidence is sufficient to apply the declared acceptance or falsification predicates within the stated scope |
| `not_evaluable` | Realization, execution, or evidence validity prevents an outcome judgment, and the reason is preserved rather than interpreted as refutation |
| `limit_reached` | A declared budget, deadline, safety, or cost boundary prevents further evidence collection in this round |
| `no_admissible_test` | Meta identifies no further experiment that is both permitted by the declared boundaries and capable of changing the current assessment |
| `deferred` | Meta intentionally leaves the hypothesis unresolved and records what evidence or condition would permit resumption |

Process termination alone does not close a round. A provider failure, external
kill, unavailable environment, or incomplete record leaves the round
`interrupted` or `incomplete` until Meta later assesses or explicitly defers it.
Likewise, `limit_reached` and `not_evaluable` describe why experimentation
stopped; they do not support or refute the hypothesis.

A long-running research session may terminate when Meta records a stop decision
grounded in at least one of these conditions:

| Stop condition | Required interpretation |
| --- | --- |
| `objective_resolved` | The declared research objective has an assessed methodology state for its stated scope, with remaining uncertainty and contradictions explicitly bounded |
| `research_limit_reached` | The session-level budget, deadline, safety, or cost boundary has been reached |
| `no_valid_successor` | No admissible successor hypothesis or discriminating experiment is currently available within the declared boundary |
| `blocked` | Required external capability, environment, evaluator, or evidence is unavailable and the dependency for resumption is recorded |
| `externally_stopped` | Execution was stopped outside Meta's research decision; the session is resumable and is not represented as convergence |

Every stop decision preserves the terminal condition, triggering evidence or
limit, final round and methodology references, selected Harness reference if
one exists, unresolved questions, and the point from which research may resume.
Promotion and termination are independent: Meta may promote and continue,
promote and stop, or stop without promotion. Stopping establishes neither a
universal optimum nor validity outside the recorded scope.

## Round Record

Each iteration may be represented by a round record with the following
semantic sections. The concrete values and the decision to include an item are
controlled by Meta.

```text
Round
  identity: round id, parent round, status, created by

  meta_decision
    research question
    selected hypothesis or successor relation
    reason for entering this round

  hypothesis
    claim
    mechanism
    scope
    preconditions
    predictions
    falsifiers
    uncertainty
    prior evidence

  operationalization
    required behaviors
    required evidence
    controlled dimensions
    allowed variation
    forbidden confounders
    invalidation conditions

  specification
    HypothesisSpec reference
    intervention
    procedure
    budget
    environment
    evaluator and ruleset
    validation context

  derivation
    Kernel runtime request reference
    declared semantic requirements and limits
    locked Kernel-managed runtime reference
    runtime-reported realization status
    known limitations

  run
    RuntimeRun / EpisodeRun references
    task, case, seed, and environment identity
    component and provider digests
    event, trace, recording, and artifact references
    resource usage and termination state

  evaluation
    realization assessment
    run validity
    authoritative metrics
    diagnostic observations
    baseline and comparison
    acceptance predicates and observed values
    confounders and deviations

  meta_assessment
    hypothesis verdict
    supported or contradicted aspects
    remaining uncertainty
    reusable methodology, if any
    rejected interpretations
    next decision

  termination
    round terminal basis
    triggering evidence or limit
    session stop condition, if any
    unresolved questions
    resumable successor or state reference
```

The round record is complete only when facts, interpretation, and decision are
distinguishable. Identifiers and evidence references should be retained even
when the result is negative, incomplete, or not evaluable.

## Persistence Contract

Persistence is what allows a later Meta run to continue the same research
process rather than reconstructing it from prompt context. It records the
objects and relations authored or selected by Meta and the execution facts
returned through Kernel tools. It does not transfer experiment design or
interpretive authority to the Kernel.

The following records should survive the Meta run that created them:

| Record | What must remain recoverable |
| --- | --- |
| Methodology state | The Meta-authored methodology version or snapshot used as the starting context, its parent version, its declared scope, and the evidence rounds on which it relies |
| Round intent | Round identity, parent round, research question or objective, selected hypothesis, and the reason Meta entered the round |
| Hypothesis record | The hypothesis as submitted by Meta, including its semantic content, prior evidence references, uncertainty, and relation to any predecessor hypothesis |
| Experiment contract | The operationalization and evaluation contracts selected by Meta, including intervention, controls, acceptance predicates, invalidation conditions, declared limits, and required evidence |
| Constructed experiment lineage | Immutable Spec and Harness references created through Kernel tools, their parent or base references when present, component and version digests, environment and evaluator identities, and the mapping from the submitted contract to the constructed artifacts |
| Runtime record | Every attempted RuntimeRun or EpisodeRun reference, its Harness, task/case/seed context, status, termination reason, resource usage, events, traces, recordings, artifacts, and authoritative results |
| Validation record | The evidence selected by Meta, realization and run-validity assessments, authoritative and diagnostic observations, comparison results, deviations, confounders, and the observed values of the acceptance predicates |
| Meta assessment | Meta's hypothesis verdict, rationale, supported and contradicted aspects, remaining uncertainty, rejected interpretations, and next decision |
| Methodology assessment | Any Meta-authored conclusion about its research method, the evidence supporting or contradicting that conclusion, its scope, and whether Meta carries it forward, revises it, rejects it, or leaves it unresolved |
| Successor relation | References from the completed round to any successor hypothesis, successor methodology state, selected current artifact, rollback point, or stop decision |
| Independent evaluation checkpoint | The held-out suite identity, evaluated Harness digest, checkpoint reason, execution isolation policy, per-task run and verifier references, evaluability state, authoritative outcomes, and aggregate summary; this record remains outside Meta-visible lineage and memory |

These are logical records, not a requirement for a database or a particular
directory layout. A lightweight implementation may store immutable objects,
append-only round records, and small current-state references. Large runtime
evidence should remain in its original run record; round and methodology
records should cite it by stable reference rather than duplicate it.

The persistence boundary follows these rules:

1. A hypothesis mentioned only in reasoning or prompt text is not a persisted
   hypothesis. It becomes part of the lineage when Meta submits it through a
   Kernel tool.
2. Runtime facts are persisted independently of Meta's interpretation. A run
   may therefore exist without a completed hypothesis or methodology
   assessment.
3. A Meta verdict or methodology conclusion becomes durable only when Meta
   submits it with its evidence references. The Kernel does not infer either
   conclusion from a score or trace.
4. Facts, Meta interpretations, and current-state pointers remain separate.
   Updating a current pointer never rewrites the Spec, run, evidence, decision,
   or methodology records that preceded it.
5. Failed, invalid, incomplete, inconclusive, deferred, and negative rounds are
   retained with the same lineage discipline as successful rounds.
6. A methodology successor identifies its parent and supporting evidence. It
   does not become established merely because a task run succeeded; its value
   remains subject to evidence from later Meta-designed rounds.
7. References needed to reproduce or audit a conclusion remain stable even if
   summaries, indexes, or current selections change.
8. The training and held-out contexts remain disjoint and their identities are
   versioned as part of the experiment record.
9. Independent evaluation records remain separate from Meta-authored rounds,
   evolution state, and shared experience records. Their existence does not
   imply a Meta verdict or methodology decision.
10. An independent evaluation run cannot write task experience or other shared
    knowledge, including when the evaluated runtime attempts such a write.

The Kernel provides storage, immutable identities, references, and runtime
facts. Meta decides what hypothesis, validation judgment, methodology lesson,
or successor state is authored and submitted. Persistence preserves that
decision; it does not make it on Meta's behalf.

## Runtime and Acceptance States

The lifecycle describes artifact state, not a prescribed research strategy:

```text
proposed -> specified -> instantiated -> running -> observed -> assessed -> archived
```

Assessment uses separate axes so that an implementation failure cannot be
mistaken for a hypothesis result.

### Realization Axis

| Status | Meaning |
| --- | --- |
| `valid` | The Kernel-managed runtime and observed evidence satisfy the operationalization contract |
| `invalid` | The runtime violates a semantic requirement or a declared boundary |
| `incomplete` | Required runtime evidence is missing or ambiguous |
| `not_evaluable` | The run cannot establish runtime realization validity |

### Outcome Axis

| Status | Meaning |
| --- | --- |
| `supported` | Valid realization and valid evidence satisfy the evaluation contract for the claimed scope |
| `refuted` | Valid realization and valid evidence contradict the prediction or meet a declared falsifier |
| `inconclusive` | The evidence is valid but cannot distinguish the available interpretations |
| `not_evaluable` | The outcome cannot be assessed because a prerequisite contract is invalid or incomplete |

The outcome axis is meaningful only after the realization and run validity
checks pass. `invalid`, `incomplete`, and `not_evaluable` results are evidence
about the current operationalization or experiment, not automatic refutations
of the underlying hypothesis.

### Meta Decision Axis

The Meta assessment may record one of the runtime decision states:

```text
confirmed | rejected | revised | expanded | deferred
```

This state records Meta's interpretation and next action. It is not inferred
from a single score by the Kernel.

## Evidence Contract

Evidence is divided by authority and role:

| Evidence class | Typical source | Role |
| --- | --- | --- |
| Execution evidence | Kernel events, traces, recordings, artifacts, usage records | Establishes what happened |
| Realization evidence | Kernel runtime contract and independent runtime observations | Establishes whether the intended intervention was present |
| Outcome evidence | Authoritative evaluator and environment result | Establishes the declared task outcome |
| Diagnostic evidence | Intermediate runtime observations and experience records | Explains or narrows possibilities |
| Decision evidence | Meta assessment and references to the above artifacts | Records interpretation and future direction |

Evidence is usable for a conclusion only when its source, version, scope,
lineage, and relation to the acceptance predicate are recoverable. Diagnostic
evidence may motivate a new design, but it does not silently become outcome
evidence.

## Acceptance Invariants

The following invariants define the quality boundary of a closed round:

1. The hypothesis meaning is recoverable from the Meta-authored record.
2. The Spec expresses the selected intervention and evaluation contract without
   silently changing the claim or scope.
3. The Kernel runtime request maps semantic requirements to observable behavior.
4. The locked run records the environment, evaluator, components, budget, and
   capabilities used by the experiment.
5. The acceptance judgment cites authoritative observations and distinguishes
   them from diagnostics and interpretations.
6. A failed realization, invalid run, or missing evidence is not treated as a
   hypothesis refutation.
7. A supported result does not acquire a broader scope than the evidence
   permits.
8. Negative results, rejected candidates, and unresolved ambiguity remain
   addressable by the next Meta round.
9. A successor hypothesis or methodology claim points to the evidence and
   states the scope in which it is being carried forward.
10. A closed round or stopped research session records its termination basis,
    unresolved state, and resumable reference; runtime interruption alone is
    not represented as successful closure.

These invariants constrain the quality and traceability of the loop. They do
not select the research objective, prescribe a hypothesis-generation method,
choose an intervention, set a universal sample count, or decide when Meta has
enough evidence.

## Reference-to-Runtime Mapping

The current runtime expresses the same semantic boundary through these objects:

| Reference concept | Runtime object or field |
| --- | --- |
| hypothesis and evaluation design | `harness-spec.hypothesis`, `harness-spec.method`, `harness-spec.validation` |
| Kernel-managed runtime request | `harness-spec` and its declared intervention, validation, budget, and environment references |
| opaque runtime instance | locked Harness manifest and component map |
| execution evidence | Kernel run records, events, recordings, and artifacts |
| authoritative outcome | evaluator/environment score returned through the Kernel |
| Meta interpretation | research decision record and successor Spec lineage |

The mapping is an implementation boundary, not a second source of meaning. If
the runtime schema evolves, the semantic fields above remain the reference
against which the mapping is explained.
