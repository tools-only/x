# Pi runtime adaptation

The accompanying SKILL.md is the compact Pi entry adapted from the Anthropic
skill-creator pinned in SOURCES.json. The earlier full workflow is retained in
references/authoring-background.md. This optional file expands Pi mechanics and
audit metadata; neither adaptation authorizes runtime semantic choices.

- Author a task-local method, not a recap. Its description identifies the problem
  and triggering conditions. Its body teaches inputs, procedure/decisions, output,
  uncertainty, stopping conditions and failure handling. Put observations in
  evidence/examples or scoped memory; do not turn a single example into a rule.
- Main authors the complete Skill. A research child may return evidence, a method
  candidate or an authoring handoff, never the final component body or mutation.
  Main independently chooses the content, creation and assembly. A candidate may be useful
  before repeated use but is not validated merely because it was created.
- Procedures may discover an unknown objective, construct or compare strategies,
  plan, test assumptions or recover from a failed approach; they are not limited
  to perception and observation. One situation and a provisional premise are valid
  scopes. Do not wait for another level solely to establish that a method recurs.
  Keep uncertain steps explicit and revise from outcomes rather than requiring
  complete knowledge before a first trial.
- Read task_harness(action="inspect") for the actual mutation contract and tools.
  Use task_harness(change/review) for publication; native task_skill has the same
  authoring contract. Publish a use-trigger description plus the readable
  creator-authored instructions as canonical text. Structured `method` metadata
  is optional quality/audit metadata; when supplied, preserve only authored
  fields and do not invent a complete dossier.
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

Optional method specification: problem; inputs[]; invariants[]; parameters[]; steps[];
decision_points[]; stop_conditions[]; failure_modes[]; construction_evidence_refs[];
contrast_evidence_refs[]; next_use; predicted_semantic_result; falsifier.
Any subset may be supplied for an untested candidate, but supplied list fields
must be arrays of strings. The loadable body itself must still teach an executable
procedure; a trajectory recap or paragraph merely labelled `skill` is not one.
