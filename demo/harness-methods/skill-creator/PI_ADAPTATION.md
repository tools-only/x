# Pi runtime adaptation

The accompanying SKILL.md is the unmodified Anthropic skill-creator, pinned in
SOURCES.json. Use its intent → draft → realistic tests/baseline → review → revise
workflow. This adapter maps execution mechanics, not the method's meaning.

- Author a task-local method, not a recap. Its description identifies the problem
  and triggering conditions. Its body teaches inputs, procedure/decisions, output,
  uncertainty, stopping conditions and failure handling. Put observations in
  evidence/examples or scoped memory; do not turn a single example into a rule.
- Main may do the work itself or use a clean-context delegate. A child returns a
  candidate; only main chooses adoption and assembly. A candidate may be useful
  before repeated use but is not validated merely because it was created.
- Read task_harness(action="inspect") for the actual mutation contract and tools.
  Use task_harness(change/review) for publication; native task_skill has the same
  authoring contract. Supply `method` when publishing a skill. Keep the readable
  instructions as canonical text; structured specifications are separate metadata.
- Creation, read, assembly and actual use are distinct. Compare realistic new
  cases and counterexamples; do not reuse construction cases as held-out proof.
- On ARC there is one irreversible history. No reset, replay or extra environment
  action for A/B testing without main's explicit task-scoped decision. Offline
  snapshot comparisons are diagnostic only. Request missing observations via the
  research report; never invent a result or claim a test was executed.
- Claude CLI, Bash, native .claude directories, browser UI and scripts mentioned
  upstream are not automatically available in Pi. Bundled scripts are development
  resources, not auto-executed tools. Use authorized Pi calls and report unavailable
  validation honestly. Human evaluation/iteration happens outside the game loop;
  absence of human feedback never implies approval.
- Upstream references to checking MCPs describe Claude's optional research surface;
  they do not define this project's tool component. Here, tools are Pi task-local
  `pi.registerTool` capabilities governed by the declarative/adapter substrate.
- Read supporting files with task_harness(action="read_method",
  method_name="skill-creator", method_resource="references/schemas.md") (or the
  corresponding resource path). No dynamic assembly selection is required.

Method specification: problem; inputs[]; invariants[]; parameters[]; steps[];
decision_points[]; stop_conditions[]; failure_modes[]; construction_evidence_refs[];
contrast_evidence_refs[]; next_use; predicted_semantic_result; falsifier.
Evidence arrays may be empty for an untested candidate; make uncertainty explicit.
An explanatory paragraph labelled `skill` is not a substitute for a method.
