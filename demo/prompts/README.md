# Runtime prompts

These files are the human-readable prompt contracts used by the Pi extensions and ARC runner.

- `auto_research_main_contract.md`: compact parent-Agent usage and adoption guide;
  it is loaded only when the adapter has registered `auto_research`.
- `auto_research_operations.md`: planning/session/adoption reference, returned only
  by `auto_research(action="contract")`; reading it does not start a child.
- `auto_research_child_contract.md`: common isolated-child task, material, and
  delivery instructions.
- `auto_research_delivery_guide.md`: harness-delivery classification and review
  rules, loaded on demand through `research_approval(action="contract")`.
- `research_profiles/*.md`: one research-method focus selected by the parent
  `scope`; general and hypothesis research load no profile.
- `auto_research_arc_contract.md`: ARC-only environment-action and harness boundary.
- `auto_research_method.md`: compact non-ARC task-local self-harness guidance for
  legacy integrations that explicitly load it; it is not the child protocol.
- `self_harness_opportunity.md`: portfolio disclosure without a recommended resource type.
- `self_harness_index.md`: compact resource index and available access interfaces.
- `arc_system_prompt.md`: official ARC agent contract.
- `arc_decision_cycle.md`: normal ARC planning/action cycle.
- `state_transition_induction.md`: generic before/action/after comparison and
  mechanism induction guidance, loaded by periodic extraction and returned in
  method-research contracts; it assumes no game-specific action semantics.
- `arc_harness_validation.md`: explicit ARC self-harness closure probe.
- `arc_*_recovery.md`: bounded runtime recovery prompts.
- `arc_readonly_subagent.md`: read-only ARC subagent contract.
- `task_validation_child.md`: generic clean-context research/validation contract.
- `terminal_bench.md`: Terminal-Bench container contract.

Dynamic values such as the game name, action budget, latest evidence, and allowed subagent tools are filled in by the runtime. Generated task-local `SKILL.md` and subagent `.md` files remain under each task's `task-harness/` directory and are not preloaded here.

The parent receives only the compact usage guide and, for ARC, its action boundary.
The child receives the common child instructions plus at most one selected research
profile. Delivery classification is not permanently placed in the child system
prompt: a child that has evidence for a harness proposal requests it through the
approval tool. Research profiles affect how the question is investigated; they do
not grant permissions, select a harness destination, or alter the report schema.

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
evaluation (observable success/failure, executor, cost and stop bound). The compact
parent guide owns readiness and adoption decisions; the operations reference gives
field mapping and an example; the child owns candidate construction and honest
evaluation. Periodic handoffs and method contracts use the same positioning.
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
