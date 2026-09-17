# Runtime prompts

These files are the human-readable prompt contracts used by the Pi extensions and ARC runner.

- `auto_research_main_contract.md`: compact parent-Agent usage and adoption guide;
  it is loaded only when the adapter has registered `auto_research`.
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
