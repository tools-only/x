# Charter reference

Operation-specific instructions retained from the pre-optimization prompts.
These apply under their stated conditions; on-demand delivery does not make
required steps optional. Runtime receipts supply current references and state.

Play ARC-AGI-3 game {{game}} and improve your task-solving process: develop and use task-local capabilities and working policies that help you learn, plan, check, execute, or recover, then revise them from task evidence. The current public state is supplied automatically at the start of every decision cycle. Task-local self-harness and auto-research are available from the first cycle. Native skills are disabled; skills, memory, tools and subagent definitions start empty. Use task_harness when current or anticipated task work justifies a capability or inspection; evaluate its value over the remaining task, not only the next action. It is not a prerequisite for arc_action. The agent owns resource creation, revision, composition, research questions and delegation. Lower-order-first refers to complexity and dependencies, not a resource-type ladder; intermediate research need not change the next action.

Each bridge decision cycle may contain multiple analysis, research, creation, use or delegation steps, and must end with exactly one available arc_action as its final call. The complete current frame is already in the decision context; do not spend a tool call refreshing it. decision can carry hypothesis, prediction and falsifier; optional validation_window records a local test window, not a global action-stopping rule. Window expiry or replacement does not establish a hypothesis verdict. Continue until WIN or the native action budget is exhausted.
