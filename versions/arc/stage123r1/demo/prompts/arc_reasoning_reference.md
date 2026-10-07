# Arc Reasoning reference

Optional finite tests: arc_action.decision accepts hypothesis_id/version and
validation_window={test_id,actions,mode,predicate}. mode=any|each|final (default
final); predicate={field,op,value}, field=changed_cells|target_before|target_after|
level_changed|level_after|state, op=eq|gte|lte. A test contract stays fixed; a new
test for the same hypothesis requires retry_reason. Missing observations stay
unknown. Expiry evaluates the prediction, not the whole hypothesis. hypothesis_id
labels an action/test; it does not create a strategy candidate. Ordinary actions
can carry hypothesis/prediction/next_step without formal selection. For candidates
explicitly registered through task_checkpoint, selection optionally records the
comparison against CURRENT COMPETITION VIEW. No candidate means no selection.

Learn from before-state/action/after-state transitions: distinguish changes and
invariants from hypotheses about their causes. Compare different actions in
comparable states and the same action under different conditions; consider elapsed
time, autonomous dynamics and hidden conditions. Prioritize experiments that
distinguish competing explanations of decision-relevant uncertainty. Build local
predictive rules before relying on their composition into higher-level behaviors;
record unresolved dependencies and revise them on counterexamples. Do not assume
action meanings, require exhaustive exploration, or postpone all planning until
certainty. Turn repeated computation into tools and reusable observation/testing
procedures into skills; saving facts alone is not capability development.
When the image contains repeated panels or an editable grid, consider a whole-state
configuration goal alongside a single-target goal. Use the live pixels to identify
candidate reference and editable regions, represent their cells symbolically, and
compare complete candidate target states before spending a sequence of actions.
State which observation would distinguish competing transformations or region roles.
After a reversible action, track the current configuration and its mismatch set;
do not equate an individual visible change with progress toward completion. If a
complete predicted configuration does not advance the level, falsify or narrow the
goal rule before toggling more cells. These are general analysis choices, not a
fixed game rule: derive regions, transformations and targets afresh from each frame.

Adapt the work to what is understood. If environment mechanics or the objective
are unclear, begin with experience induction: gather discriminating observations,
preserve hypotheses and develop useful local methods. Do not invent a complete
goal, wait for certainty, or force early planning. As a working objective and
constraints become clearer, ask what work is missing between current capabilities
and success. Develop representations, strategies, comparisons or recovery methods
as appropriate. Learning and planning can coexist, and counterevidence can send
you back to exploration. Keep useful judgments in task_checkpoint; no runtime
phase label or fixed action count decides that transition.
When an interpretation changes, reconcile affected checkpoint fields with current
evidence: task_goal and success_conditions when the working objective changes,
plus current_strategy, hypothesis, next_step and working_summary. Explicitly clear obsolete
fields through task_checkpoint(update, clear_fields=[...]); their survival across
session recovery is not evidence that they are still applicable.

Keep the current solution attempt in the foreground. Before choosing an ARC
action, use the live observation to state the working goal, the best-supported
candidate route, the visible prediction of the next action, and what would make
you revise that route. If a candidate can be completed from current evidence,
try and evaluate it before expanding the search merely because more hypotheses
are possible. If it fails, preserve the counterevidence and choose a genuinely
discriminating next test; do not repeat a failed candidate or RESET without a
new prediction. Evaluate action cost against remaining task progress, not just
the next call. Store less relevant alternatives and failed paths in scoped
Memory/evidence, keeping the currently actionable route in task_checkpoint.
Treat visible change, a monotonic counter, and level progress as different
observations. If an action can reverse a changed state while an indicator keeps
moving, compare whether the indicator measures action count or goal progress
before spending a sequence to fill it. A complete candidate configuration that
remains NOT_FINISHED is counterevidence to that candidate, not a reason to
repeat it from memory; rebind to the live frame and seek a test that separates
the remaining goal explanations.

After trials distinguish predicted local effects, progress toward the working
objective, and method cost. A correct action-effect model does not prove the goal
interpretation or solution strategy. If predicted target states do not finish the
level or manual errors recur, reconsider the strategy/representation and whether
computation, independent analysis or competing research would help. Do not merely
reaffirm the same observation Skill. Research and direct authoring are both options;
neither is a required stage or a component quota.
When a selected Skill, Tool, Subagent or System Prompt depends on an assumption
that new evidence challenges, revisit that exact version: correct and reassemble
it, or stop using it while uncertain. Updating a checkpoint alone does not
repair a selected component. This is a parent decision, not a runtime gate.

When a method or coordinate rule controls a click, define its logical row/column
origin, pixel-to-block mapping and one landmark check in the live frame. A
formula copied from a prior level remains a hypothesis until the current
observation supports its convention. For independent audit, delegate one
candidate, one region or one statistic first; expand only if that answer
changes a decision.

Budget scope: the bridge's action_budget describes runner action limits.
An unlimited maximum removes that local cap only. Infer in-game resources,
hazards, timers and action costs from public evidence, keeping uncertain meanings
as hypotheses. When an observed effect changes a resource interpretation,
reconsider the dependent route and its assumptions; choose probes by their
information value and possible consequences even without a runner step cap.
