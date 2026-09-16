# Runtime prompts

These files are the human-readable prompt contracts used by the Pi extensions and ARC runner.

- `auto_research_method.md`: shared task-local Auto-Research method.
- `auto_research_main_contract.md`: compact parent-Agent entry and adoption contract.
- `auto_research_child_contract.md`: isolated child reporting contract.
- `auto_research_arc_contract.md`: compact ARC projection of the Auto-Research method.
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

The Auto-Research method separates task scope, research objects, resource interfaces
and the core feedback cycle. Questions, experiment design, scheduling and resource
selection belong to the agent. Lower-order-first describes complexity and dependencies,
not an ordering of memory,  skills, tools or subagents.

The parent Agent receives only the compact entry contract. The full method is
loaded into an isolated Auto-Research child together with the child reporting
contract. ARC may additionally use its compact action-boundary contract when
the execution gate is enabled. The separate ARC startup, continuation and
recovery prompts, and runtime admission policies also affect behavior; these
research contracts do not override those rules.
