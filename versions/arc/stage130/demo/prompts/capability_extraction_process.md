# Develop capabilities for the task

Main owns the choice of learning, planning and execution, as well as component
authoring and assembly. Use current evidence and the task's actual uncertainty;
do not follow a fixed progression or wait for a category quota.

1. Choose the next useful work from what is currently understood.
   When the environment or completion condition is unclear, use experience
   induction: observe transitions, compare explanations, try informative probes
   and preserve scoped facts and provisional methods. Discovering what the task
   requires is legitimate progress; do not invent a complete objective first.
   When a working objective and constraints become clearer, compare existing
   capabilities with the work needed to reach it: representation, planning,
   strategy comparison, consistency checking, execution or recovery. A reliable
   observation procedure need not solve these other operations. Exploration and
   planning may coexist; counterevidence may make renewed exploration useful.
   Do not reject a Tool merely because it cannot retain hidden state across ARC
   actions: a bounded per-frame computation, selector, validator, or comparison
   is already a valid first-use Tool when its input/output contract is executable.
   Use a Skill or Memory for cross-action state and bind the current frame
   explicitly on each Tool call.
   Record only useful current judgments in the existing checkpoint, including
   unknowns, task_goal, success_conditions, constraints, alternatives and next trial. Runtime does not decide
   that a phase is complete or infer a semantic stage from an action count.

   Revisit the capability gap at consequential events: a stable causal relation,
   repeated manual work or error, a falsified strategy, a changed task goal,
   a level transition, or an explicit parent-authored planning_gap. This is
   not a mandatory analysis before every ARC action. A single settled local
   effect can still be enough to open a parent-owned conversion intent;
   periodic review is a consolidation aid, not an admission trigger. The
   absence of a Tool, Subagent or System Prompt is not by itself a gap.

2. Identify the operation worth improving, not just the latest fact to save.
   Separate instance values and observations from how to discover, transform,
   compare or act on them. The operation may be new, small or situation-specific.
   Compare expected task progress, error risk, repeated reasoning and latency with
   development cost and the current solution route. Being able to do it manually, having only one current use, or
   having a small immediate action cost is not by itself a reason to reject a
   capability. For a worthwhile operation, author the smallest executable candidate
   and trial it. Reassess the remaining investment when evidence, goals or priorities
   change; preparation does not commit the task to an obsolete or low-value route.
   Narrow or defer the same operation with a reason and resumption condition, or
   drop it with a reason when further investment is not justified. Preserve the
   same operation_id across repairs; Memory does not finish an unimplemented method.
   Keep operation_id, purpose and the chosen completion criterion together in
   the existing development intent so a retry resumes the same work.
   For deferral, record reason and reconsider_when with status:"deferred";
   revisit the same intent when that condition changes. Use status:"dropped"
   when abandoning it, without claiming completion or semantic use.
   Compare reuse against the specific operation: a working observation procedure
   may remain useful while leaving a planning or evaluation gap open. Retain the
   covered steps and develop only the missing work; an existing Skill name is not
   evidence that the new operation is covered.

3. Choose a carrier or investigation by its job.
   - Skill: an agent-executed discovery, decision, planning, testing or recovery
     procedure, including a one-situation trial with uncertain branches.
   - Pi Tool: an executable computation/check or authorized operation, including
     small or first-use work whose precision, consistency or cost merits it.
   - Subagent: an independent or prepared context, including a different strategy
     or blind review of the same evidence. When an independent-context operation is
     chosen for reusable development, create the selectable task-local Subagent even
     if an ephemeral delegation already succeeded; ephemeral execution is trial
     evidence, not a saved component. Ordinary delegation remains available in
     addition to (not instead of) the saved role.
     If a child times out, preserve what was learned and compare a smaller bounded
     question with the cost of retrying. Continue, defer or drop the same operation
     according to task value; a Memory note does not count as Subagent use.
   - System-prompt segment: a scoped working policy across applicable decisions.
     As goals become clearer, main can use it to reorganize planning, strategy
     comparison, experiment choice or recovery. It may be provisional or level/
     phase-specific; it need not be a permanent task-wide rule. Keep factual state
     separate and preserve platform constraints and permissions.
   - Memory: scoped facts, hypotheses and concrete conclusions. It can accompany
     any of the above but does not execute a method or reconfigure behavior.
   Auto-Research can develop a representation, test design or competing solution
   approach, not only validate an existing local rule. Ground its bounded question
   in what is known; unknown objectives or evaluation designs may be the research
   object. Preserve distinct alternatives and return parent-owned trial evidence.
   Research is not a prerequisite for authoring, and no carrier is compulsory.

4. Construct the smallest executable trial that serves the selected operation.
   State useful inputs, steps/decisions, expected output and how to notice a failure
   or reconsider the method. Uncertainty can be a test/stop branch rather than an
   admission failure. A complete dossier, repeat occurrence or prior positive
   evaluation is not required. For a Pi Tool inspect the real substrate; if an
   operation cannot run, name the missing primitive and use an honest Skill or
   decomposition instead of pretending unavailable code executed.
   Main reads the matching creator for Skill/Tool/Subagent, authors the body and
   publishes through task_harness(change/review). A system_prompt uses the public
   content/scope contract without an invented creator requirement. A strategy
   policy can state the working approach and when to revisit it without claiming
   its assumptions are established facts. Main may author a selected operation
   directly without a review; review is evidence and feedback, not an additional
   admission layer.
   Once main chooses development, its completion criterion is an authored change
   with a checked receipt, an explicit exact-version assembly and a semantic trial
   at the next reachable use. If a candidate is incomplete, the runtime preserves
   the conversion intent before reporting the repair error; resubmit the same
   operation after reading the creator or fixing the missing primitive if the work
   still merits its remaining cost. A deferred development_intent retains a reason
   and actionable retry condition; a dropped intent is abandoned, not completed.
   Memory may preserve related facts but does
   not finish the chosen operation.

5. Select and exercise, not merely cite the candidate.
   Check the native receipt, explicitly assemble applicable exact versions while
   preserving other needed components, then read the selected Skill or invoke the
   Tool/Subagent. A selected system_prompt is delivered on the next parent request.
   Use the result in the next appropriate decision. Version citations alone do not
   select resources. A review, creator read or published body is not actual use.
   Inspect existing capabilities for reuse, revision or composition; development
   can improve a selected version instead of producing an additional component.

6. Evaluate the right claim and adapt the work.
   Distinguish local prediction accuracy, progress toward the working objective,
   and the method's cost/reliability. Correct local effects do not validate the
   proposed success condition or strategy. When the predicted target fails to
   finish the task, or repeated reasoning/errors add cost without progress,
   reconsider the representation, objective or strategy rather than repeatedly
   crediting the observation procedure. Retain the useful part and choose whether
   to revise a method, author a different working policy, use computation or an
   independent context, or investigate competing approaches. Return actual trial
   evidence to relevant research. Revert to evidence gathering when assumptions
   fail; do not manufacture a higher-order plan to satisfy a stage label.
   Reconcile the checkpoint after changing your interpretation: update affected
   task_goal, success_conditions, current_strategy, hypothesis, next_step and working_summary with their current
   evidence, or explicitly remove obsolete fields with task_checkpoint(update,
   clear_fields=[...]). A carried-over plan is a prior judgment, not new evidence.

Use existing checkpoint, review, component and assessment records for these
decisions. No mandatory stage reports, component quotas, research calls or action
gates are introduced. Unknowns and negative results stay visible; quality and scope
are improved through use, not inferred from creation or a successful local step.
