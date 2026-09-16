# Decision-linked Auto-Research implementation

Status: P0--P3 first vertical slice implemented for the shared external benchmark
extension used by ARC-AGI-3 and Terminal-Bench. OfficeBench and Shopping retain their
existing benchmark-specific research extensions until a separately tested migration.

## Invariants

- Pi remains the only model/tool agent loop.
- The Agent owns whether to research, accept a candidate, change a task-local harness
  component, act directly, revise a conclusion, or stop.
- Python runners persist and project artifacts; they do not schedule research.
- Automatic records classify observations and propose candidates. They never diagnose
  a root cause, create a finding, mutate a harness component, or claim improvement.
- All resources remain local to one benchmark run. Control mode installs none of the
  treatment research mechanisms.

## Implemented resource flow

```text
Pi task tool result
  -> execution-observations.jsonl       canonical result/provenance
  -> execution-signals.jsonl            cheap causal-neutral labels
  -> pattern-candidates.jsonl            sparse derived checkpoints

Agent inspect/test/accept/ignore
  -> research-resources.jsonl            versioned goal or finding
     - pattern_candidate_refs
     - used_in_observation_refs
     - reconsider_when
     - pinned
     - parent_goal_id / depends_on

Pi context hook
  -> bounded open goals, findings, and unaccepted pattern candidates
  -> research-exposures.jsonl            what was actually projected

Agent task action or component-specific Pi self-harness operation
  -> later observation / native component exposure / optional effect assessment
```

The graph is an on-demand projection over `research-resources.jsonl`; it is not another
database. Parent and dependency cycles are rejected. Dependencies name an immutable
finding version (`finding-N@vM`). When that finding advances, the graph reports a stale
dependency but does not propagate a conclusion or schedule work.

## P0: decision-linked resources

`research_resource.inspect` supports text, status, goal, attention, offset, and limit
filters. `pinned=true` makes an old resource compete with recent entries inside the
same context limit. It does not add another context budget.

An update may cite `used_in_observation_refs` plus a short `use_note`. This captures an
Agent-authored claim that a finding shaped a concrete later action. The referenced
observation must exist. It is provenance rather than causal evidence. Harness changes
continue to use their component-specific basis, Pi exposure, and effect records.

## P1: automatic execution signals

Every recorded task tool result gets a `tool_execution` signal. Reported errors can
receive multiple heuristic labels such as timeout and permission; unknown remains a
valid label. The signal records the classification method and always sets
`causal_interpretation=false`.

Adapters may additionally return explicit `autoresearch_signals` for public
`environment_state` and `task_progress` fields. ARC action results currently expose
visible frame change and public level progress as separate layers. Tool success,
visible state change, and task progress are therefore not conflated.

## P2: automatic pattern candidates

The derived index currently detects repeated error labels, mixed success/error outcomes
for the same tool, repeated task-progress outcomes under an adapter-declared local
pattern key, contrasting public outcomes, repeated no-progress input cycles of length
two to four, and repeated revision of one research resource. A generic successful tool
call is deliberately not treated as a useful standalone pattern; successes instead
provide counterexamples and contrasts unless an adapter exposes a more specific public
outcome. Revision churn is a prompt to inspect the evidence-reading or validation
method, not evidence that the finding is wrong. Input cycles require three consecutive
repetitions and preserve only a short stable hash plus canonical observation refs.
The index preserves support, counterexample, outcome, and total counts. To control write
and context cost, it checkpoints at first eligibility, when the first counterexample
appears, and at power-of-two evidence counts. Full observations remain authoritative.

At most two recent unaccepted candidates enter the context. Deep semantic explanation
is not run automatically. The Agent may inspect source observations and optionally cite
candidate IDs in a finding. A citation is the acceptance boundary.

## P3: multilevel research graph

Research resources may name `parent_goal_id` and versioned `depends_on` relationships.
`inspect(include_graph=true)` returns a focused connected projection, immutable-version
dependency edges, and changed dependency notices. Updating a parent does not close a
child; updating a dependency does not invalidate dependents automatically.

## Cost and evaluation

Signal classification is deterministic and linear in the new result text. Candidate
derivation currently scans task-local tool signals for the affected tool; checkpoint
writes are sparse. No extra model call occurs unless the Agent chooses semantic review
or a subagent. Context adds no signal log and at most two short candidate summaries.

Summaries expose signal and candidate counts separately from task score and
self-harness effects. A read-only application graph connects explicit research basis
refs to component decisions, Pi-native exposures, and Agent effect assessments; an
empty or invalid basis remains visibly unlinked. Evaluation must compare equivalent
model, adapter, permissions, and benchmark protocol, while counting all model calls and
actions. Finding counts, candidate counts, context exposure, or Agent-authored effect
claims are not rewards.

Task-local subagent stdout is consumed as an NDJSON stream. Large intermediate Pi tool
events are discarded after counting rather than accumulated in memory, while the final
assistant message remains bounded. The parent also receives a compact token/cache/cost
summary so it can decide whether another delegation is worthwhile.

## Remaining implementation work

- Measure candidate precision, context cost, and uptake on multiple real ARC tasks.
- Measure whether adapter pattern keys are sufficiently conditional; broad keys such as
  an action name alone can create low-value no-progress candidates during navigation.
- Add explicit candidate dismissal/snooze only if repeated irrelevant projection is
  observed; do not add lifecycle state speculatively.
- Replace per-tool in-memory scan with a small derived counter cache only if profiling
  shows material long-task overhead.
- Migrate OfficeBench and Shopping to the shared signal/pattern/graph primitives only
  after compatibility tests preserve their richer semantic outcome contracts.
- Add optional Agent-invoked semantic pattern review using the existing Pi subagent
  mechanism; do not add a background LLM scheduler.
