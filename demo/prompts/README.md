# Runtime prompts

These files are the human-readable prompt contracts used by the Pi extensions and ARC runner.

Changes to these contracts follow the repository's
[development workflow](../../docs/development-workflow.md), including resident
obligations, full provider payload cost, and real-model behavior evaluation.
That workflow and its change-record template are development documents; do not
load them into the Pi task Agent's runtime context. Their adoption does not
itself change existing runtime rules.

The on-demand references preserve the original task/index rule blocks under their
stated conditions. The migration baseline in
`tests/fixtures/arc_prompt_migration_baseline.json` maps all 29 source units to
resident or callable destinations. One explicitly recorded wording replacement
updates the development manual's delivery location; semantic rules are retained.
Choosing when to retrieve instructions does not waive the rules for a chosen operation.

- `auto_research_main_contract.md`: extended parent-Agent policy reference. The
  initial runtime prelude is the compact `projectedMethod` string in
  `pi_external_benchmark_research.ts`, not this entire document.
- `auto_research_operations.md`: planning/session/adoption reference, returned only
  by `auto_research(action="contract")`; reading it does not start a child.
- `auto_research_child_contract.md`: common isolated-child task, material, and
  delivery instructions.
- `auto_research_delivery_guide.md`: retired harness-delivery compatibility guide;
  only explicit legacy fixtures can load it through the retired approval tool.
- `research_profiles/*.md`: one research-method focus selected by the parent
  `scope`; general and hypothesis research load no profile.
- `auto_research_arc_contract.md`: ARC-only environment-action and harness boundary.
- `auto_research_method.md`: compact non-ARC task-local self-harness guidance for
  legacy integrations that explicitly load it; it is not the child protocol.
- `self_harness_opportunity.md`: compact opportunity signal and read path.
  The complete original guidance is preserved in `harness_opportunity_reference.md`
  and returned by `task_harness(action="contract", topic="opportunity")`.
- `self_harness_index.md`: short resident resource index and access interfaces.
  `task_harness(action="summary")` returns a small status directory;
  `task_harness(action="inspect", section="...")` returns one exact section,
  while ARC `inspect` without a section returns the directory and `status` or
  `task_harness_status` retain the full status. Non-ARC `inspect` remains full.
  Historical tool results with JSON `details` identical to their text
  are projected with one copy in later model requests; original tool results
  remain complete.
  A creator read stays complete until an applied `task_harness(change)` uses its
  exact `authoring_method_ref`. Later model requests show a short historical
  receipt with the immutable method hash and exact `read_method` recovery call;
  the original read result and pre-application guidance remain complete.
- `harness_*_operations.md`: topic references returned only by
  `task_harness(action="contract", topic=...)`. Topics: charter, components,
  memory, assembly, review, opportunity, induction, assessment, development,
  research and experiments. `induction` returns the complete
  `state_transition_induction.md` method when a periodic review needs it.
  Omit topic for the directory. Reading a contract neither creates resources nor
  selects an assembly or starts research. The assembly topic also returns the
  current revision and selection template from runtime state.
- `arc_reasoning_reference.md`: ARC reasoning guidance returned on demand by
  `task_harness(action="contract", topic="arc_reasoning")`.
- `capability_extraction_process.md`: adaptive goal-driven capability development
  (historical filename retained). ARC discovery/followups project only its read
  entry; `task_harness(action="contract", topic="development")` returns the body
  together with the original chosen-development rules.
  Other adapters retain their existing projection. Induction is useful under
  uncertainty, not a fixed stage.
- `arc_system_prompt.md`: official ARC agent contract.
- `arc_decision_cycle.md`: short initial ARC task charter (target: at most 300
  whitespace-delimited words). Runtime owns action boundaries, reference binding,
  version checks and operation receipts; semantic choices remain with the Agent.
- `state_transition_induction.md`: generic before/action/after comparison and
  mechanism induction guidance, loaded by periodic opportunities and returned in
  method-research contracts; it assumes no game-specific action semantics.
- `arc_harness_validation.md`: explicit ARC self-harness closure probe.
- `arc_*_recovery.md`: bounded runtime recovery prompts.
- `arc_readonly_subagent.md`: read-only ARC subagent contract.
- `task_validation_child.md`: generic clean-context research/validation contract.
- `terminal_bench.md`: Terminal-Bench container contract.

Dynamic values such as the game name, action budget, latest evidence, and allowed subagent tools are filled in by the runtime. Generated task-local `SKILL.md` and subagent `.md` files remain under each task's `task-harness/` directory and are not preloaded here.

The parent receives only the compact usage guide and, for ARC, its action boundary.
The child receives the common child instructions plus at most one selected research
profile. It receives no component creator, component schema, implementation
allowlist, or harness-delivery contract. It may return findings, method candidates,
planning implications, and experiment requests; only the parent reads a creator
and authors a complete Harness component. Research profiles affect how the question
is investigated; they do not grant permissions, select a harness destination, or
alter the report schema.

The separate ARC startup, continuation and recovery prompts, runtime admission
policies, and native tool schemas still govern execution. Prompt text must not
advertise a capability that the current adapter did not register.

## Layering and continuity

The parent policy owns semantic decisions (complexity, dependencies, release,
evidence and effect judgments). The operations reference owns procedural detail;
runtime gates and native delivery routing are unchanged. ARC recovery follows the
same policy instead of demanding an immediate undecomposed child start.

Child working sets distinguish the current node, its global plan goal and
dependency result references, the selected parent checkpoint, and the child's
research checkpoint. Required state is not silently cut to fit optional evidence.
Selected parent summaries retain their basis references, decision capsule and
pending operations. Full evidence remains in the task store. These projections
do not establish correctness or grant access to otherwise unselected resources.

The child input character budget covers the generated task prompt, not the full
provider payload (system instructions, tool schemas and retained history). Lazy
instructions reduce eager content but still consume context after retrieval.
Static/fixture checks are diagnostic; ARC closure requires arc-harness-smoke and
provider-quality claims require a real-provider run.

Auto-Research is bounded investigation of a grounded uncertainty or missing solving
capability, potentially across phases. Parent and child guidance require starting
material/access, an attainable intermediate objective and a feasible local
evaluation (observable success/failure, executor, cost and stop bound). If a goal
or environment test is not yet defined, formulation, representation or test design
can be the research deliverable, checked for consistency and evidence gaps. The compact
parent guide owns readiness, creator selection, component authoring, and assembly;
the operations reference gives field mapping and an example; the child owns method
candidate construction and honest evaluation, not component construction. Periodic
handoffs and method contracts use the same positioning.
These are semantic guidance, not new schema fields or runtime admission gates.
Pending/failed sessions can resume; completed work continues through bounded
successors with exact prior research references. A passed local check is distinct
from transfer or task-level benefit. See
`docs/plans/2026-09-18-grounded-auto-research-guidance.md` for scope and validation.

Round 2 removes generated plan-goal/completion prose from new run constraints:
current_node is their sole projection. User constraints and existing stored sessions
are not rewritten. Parent/child guidance is consolidated; dynamic harness notices
carry state/access hints rather than repeated capability descriptions. Tool schemas
and availability are unchanged. See docs/plans/2026-09-17-research-prompt-dedup-design.md.
