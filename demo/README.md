# Meta-harness OfficeBench smoke demo

This demo makes the current architecture inspectable without a remote model. A deterministic task-agent fixture supplies six decisions; the runner executes and records them but contains no rule that chooses iteration, nesting, pruning, harness adaptation, or termination.

The self-harness portion runs inside the actually installed Pi CLI. A test-only extension registers the LLM-facing `set_evidence_policy` tool and a `before_agent_start` hook. Three model-free Pi commands exercise the same extension state in one process: `summary_only → source_and_date → observed source_and_date`.

Prompt contracts are collected in [`prompts/`](prompts/README.md). The runtime loads them from there and fills only task-specific values such as the ARC game, current evidence, or allowed subagent tools.

Run from the repository root:

```powershell
$env:PYTHONPATH = "D:\autoresearch_pi_project\src"
D:\conda\python.exe -m autoresearch_pi.cli meta-harness-demo --root "D:\autoresearch_pi_project\runs\meta-harness-demo-latest"
```

Outputs:

- `artifact/officebench_case.docx`: valid DOCX with a reconciled finding and dated sources.
- `auto-research-handoff.md`: research iteration, child return, pruning, and root termination.
- `self-harness-handoff.md`: Pi version, primitive, native implementation, before/after/observation, and limitation.
- `round-hierarchy.md`: task turn, research node, local iteration, parent, decision, and evidence basis.
- `task-agent-decisions.json`: deterministic decision fixture used by the demo.
- `pi-native/*.json`: snapshots written by the Pi extension process.
- `summary.json`: smoke checks and explicit limitations.

The demo proves extension loading and state retention in Pi, artifact generation, handoff production, and hierarchy reporting. It does not prove that a live model autonomously selected the decisions, and its document checks are a local OfficeBench-style smoke rather than the external full OfficeBench evaluator.

## Real Pi → OfficeBench end-to-end run

The separate `officebench-e2e` command runs a live Pi task-agent turn. Its extension exposes task tools, optional versioned task-local research goals/findings, and a capability-specific apply/keep execution-surface decision through `pi.registerTool()`. Task-action results append only neutral model-visible `EXECUTION_OBSERVATION` provenance/outcome metadata. The runtime does not infer calendar/email candidates, inject recommendation cards, or prescribe break-even thresholds from named task actions. Research snapshots use stable goal/finding IDs and append-only `open`, `record`, `update`, `resolve`, or `reopen` events. An apply decision snapshots the exact finding version used, invokes Pi's native `setActiveTools()` before the next model request, and starts a bounded task-action effect window; a keep decision records a deliberate no-change outcome. A resulting effect assessment remains compact pending feedback until an agent-authored research update cites it. The real OfficeBench runtime does not expose the standalone demo's text-only `set_evidence_policy` primitive; only behavior-changing execution surfaces count as task harness mutation. No research or mutation is required to pass. JIT supplies case data, action implementation, and its deterministic evaluator; it is not the agent runtime.

The generic method lives in `auto_research_method.md`; task-specific capability contracts remain in the extension as static affordances, not runtime recommendations. `officebench_artifact_contract.json` is the canonical source for backend artifact paths, task-language mapping, verification actions, and current-testbed scope. Before Pi starts, the runner writes a bounded `task-resource-catalog.json` containing the initial relative-path inventory and only the action contracts relevant to the original task question. Pi injects that catalog once; the full contract remains an audit artifact and `task_artifact_contract` is not on the initial active tool surface. `workspace_file_action` remains available only when the catalog cannot replace bounded listing/text reads. Optional finding-backed calendar and templated-email batch surfaces use `pi.setActiveTools()` on the next request and record bounded utilization effects; the Agent decides their relevance from cited task-local observations. Optional `task_notes` records free-text task-local observations; neither notes nor tool counts alone establish a research loop or improvement. See the [optimization track](../docs/tracks/2026-09-07-autoresearch-self-harness-optimization.md) for implemented/deferred work and verification.

Git Bash:

```bash
export PYTHONPATH='D:/autoresearch_pi_project/src'
export JIT_ROOT='D:/JIT'
export JIT_PYTHON='D:/anaconda/envs/jit/python.exe'
'D:/anaconda/envs/jit/python.exe' -m autoresearch_pi.cli officebench-e2e \
  --root 'D:/autoresearch_pi_project/runs/pi-officebench-e2e-live' \
  --case '1-2-0'
```

The command loads model credentials from this repository's `.env` (or the current process) and requires a new or empty output directory, preserving existing results. It does not read the external JIT checkout's `.env`. It starts from a fresh task-local Pi config/workspace and writes `summary.json`, `artifact-contract.json`, `task-resource-catalog.json`, incremental `pi-events.jsonl`, `pi-runtime-status.json`, model-visible execution observations, append-only versioned research snapshots, optional decisions/effect assessments, target-only SHA-256 manifests, native baseline/optional mutation snapshots, the JIT evaluation, two handoffs, and the round hierarchy. Timeouts retain partial received events and an interrupted status. Child processes also emit the observation-only `subagent-progress.jsonl` probe incrementally, including provider-turn/tool stage, event counters, last child event time, liveness, and report-submission state; it never steers or caps research. Agent completion, evaluator signal, artifact change, execution efficiency, task-resource-boundary audit, loop integrity, research lifecycle state, task-local execution-condition effect, and unestablished harness improvement are reported separately. `behavioral_loop_established` means a finding-backed change had a bounded observed effect; only `research_lifecycle_closed` additionally means the agent absorbed that effect into a later research version and resolved the relevant goal.

## Shared external-benchmark lifecycle

`pi_external_benchmark_research.ts` supplies the same optional, task-local research/finding/evidence lifecycle plus memory, task-local system-prompt overlays, task-local SKILL.md resources, active-tool selection, context focus, and effect assessment to ARC-AGI-3 and Terminal-Bench. Its first treatment request reads the fixed Auto-Research method and exposes direct component creation operations with no bootstrap, repetition, finding, or validation prerequisite; it records a zero-resource `task-harness-entry.jsonl` audit and never invokes Pi's native skill loader. It also writes a causal-neutral `execution-signals.jsonl` index, derives bounded `pattern-candidates.jsonl` checkpoints from repeated or contrasting tool outcomes, and projects an on-demand multilevel research graph from parent/dependency fields already stored in versioned findings. Candidates never become findings or harness changes automatically. Auto-Research deliveries are reviewed inside the isolated child through `research_approval` (`inspect`, `approve`, `reject`, `defer`), which binds the complete structured delivery hash and only versions approval metadata in `task-harness-proposals.jsonl`. Parent-side code deterministically compiles reviewed deliveries into `auto-research-harness-routes.jsonl`; the parent has no approval adapter and executes each ready route through the concrete Pi `task_*` native call. Auto-Research itself never applies the route. `pi_arc_agi_3_extension.ts` adds the native state/action surface and optional task-local read-only Pi subagents; `pi_terminal_bench_extension.ts` retains Pi's native terminal tools. Environment adapters own transport and native evaluation, not research scheduling. Control mode registers none of the treatment capabilities. Treatment mode allows direct task completion with no research and no mutation.

Active research, memory, skill, tool, and subagent indexes are projected through Pi's `context` hook; canonical content remains in run-local JSONL or `SKILL.md`. The shared extension also installs an adapter-independent task-local context lifecycle: it deduplicates repeated projections, keeps the initial task prompt plus a recent valid suffix, archives older transcript messages behind recoverable markers, bounds oversized retained messages, and records metrics in `task-context-compactions.jsonl`. It is enabled by default for treatment and can be disabled only for an explicit ablation with `PI_AUTORESEARCH_CONTEXT_LIFECYCLE=disabled`; `PI_AUTORESEARCH_CONTEXT_COMPACTION` remains the separate Agent-selected observation-representation capability. A skill created during a run becomes usable after the Agent reads its projected path; `task_harness(action="focus", resource_refs=[...])` can narrow later context to exact task-local versions. `loaded_by_pi` is not used as a task lifecycle signal: the runner disables native skills and the extension does not register task-local skill paths with Pi's loader. ARC delegation starts an isolated Pi process with only the Agent-selected subset of `arc_state` and `inspect_arc_trajectory`; `arc_action` is never available to the child.

The provider telemetry extension also writes `context-token-debug.jsonl`. It records one
size-only context snapshot per provider turn, including estimated tokens for the system
prompt, task prompt, checkpoint, self-harness, memory, skills, tools,
subagents, research, ARC observations, tool results, and remaining messages. The
estimate is `ceil(JSON characters / 4)` and is explicitly marked as heuristic; when a
provider returns usage, a linked record contains the actual input/output token fields.
Custom providers that skip `before_provider_request` use the final Pi `context` hook as
a fallback and mark the measurement basis accordingly. Prompt/resource bodies are not
copied into this debug log. Read-only ARC subagents write the same schema to
`subagent-context-token-debug.jsonl` so their turns remain separate from the parent.

ARC uses the independent `arc_agi_3_adapter.py` / `arc_agi_3_official_adapter.ts`
contract for both arms. It mirrors the official ARC `BenchmarkingAgent` system
prompt, seven-frame interpolation, RESET visibility rule, 0--63 coordinate
validation, and `ceil(baseline_actions * 5)` per-level budgets. The bridge only
transports SDK frames/actions and owns the native scorecard. Set
`ARC_OPENAI_API_BASE`, `ARC_OPENAI_API_KEY`, and `ARC_MODEL` in this repository's
`.env` for ARC-specific credentials; they override generic model variables only
for ARC. The default Pi API is `openai-responses` to match the official model
configuration (`ARC_PI_API=openai-completions` is an explicit gateway fallback).
The treatment-only research extension is mounted after this adapter and does
not alter the ARC frame or action contract.

For a real technical closure probe, add `--harness-validation` to the ARC command.
The probe asks the Agent to create, use, and revise one instance of every basic
task-local resource (memory, skill, tool, and read-only subagent) before
gameplay. This is intentionally separate from an ordinary treatment run, which
measures autonomous trigger behavior. Native skill loading remains disabled in both.

When continuing the same task after a supported Pi extension restart, the optional
`research_resource(action="inspect")` call reads a bounded, read-only snapshot of
the current task's latest findings, prior Pi-native decisions/exposure observations,
and effect assessments from the run-local JSONL files. It does not restore the old
tool surface, create a finding, schedule research, or inspect sibling runs. The
extension starts from its safe baseline; the agent decides whether any restored fact
is relevant and whether to make a new Pi-native decision.
The projection truncates long finding prose while retaining versions, references,
status, and effect fields; canonical JSONL remains the complete record. `inspect`
supports bounded search by text, status, goal, and attention state. Pinned resources
replace recent entries within the existing projection limit. A finding update can cite
the later task observation in which it was used and its reconsider condition. These
links expose a research-to-task chain but do not establish task improvement.

Shopping keeps the complete backend tool result model-visible and appends only
neutral execution provenance/outcome metadata. It does not infer a capability
candidate from a task action or inject a batch recommendation card. The static
task capability catalog discloses the inactive Pi-native batch tool, its scope,
and effect timing; the agent alone decides whether task-local evidence warrants
a finding and an apply/keep decision. Canonical observations remain complete;
the runner does not select product fields or alter model-visible task results.
The bounded catalog is persisted once and included once in the treatment system
context; control tasks do not receive it.
Shopping effect summaries independently verify that a supported assessment names
the same immutable finding basis, Pi tool call, next-request exposure, and bounded
post-exposure observations before reporting a connected effect.

The provisional Agent-owned observation-context capability is disabled by default.
For one isolated Shopping smoke, add `--context-compaction`. The Agent must first
author a finding that cites every selected observation; Pi's native context hook then
replaces only those historical bodies on later model requests. Full observations stay
in canonical JSONL and remain explicitly retrievable with
`research_resource(action=inspect, observation_id=...)`. Omit the flag for the
mechanism-off arm; both paths otherwise retain the same treatment runtime.

For a sequential batch with independent Pi processes and workspaces:

```bash
'D:/anaconda/envs/jit/python.exe' -m autoresearch_pi.cli officebench-e2e \
  --max-samples 10 \
  --root 'D:/autoresearch_pi_project/runs/pi-officebench-e2e-10'
```

Each case writes to `<root>/<case-id>/`; `<root>/summary.json` contains aggregate counts and average score.

For a task-completion control/treatment comparison on the same case:

```powershell
$env:PYTHONPATH = "$PWD\src"
D:\anaconda\envs\jit\python.exe -m autoresearch_pi.cli officebench-experiment `
  --case "3-6-0" --repeats 2 `
  --root "D:\autoresearch_pi_project\runs\paired-3-6-0"
```

Each repeat uses fresh independent Pi processes and OfficeBench workspaces. Control keeps the same direct task tools and evaluator but hides Auto-Research method/context, research/decision tools, neutral observation metadata, and optional batch-surface changes. Treatment uses the current mechanism. Repeat order alternates to reduce order bias. The root `summary.json` reports completion, score, length failures, artifact-path change, model turns, bridge processes, mechanism uptake, and observed treatment-minus-control deltas separately; it never promotes a finding count or a single pair into an automatic causal claim.

For a small Shopping validation cohort with the same paired design:

```powershell
$env:PYTHONPATH = "$PWD\src"
D:\anaconda\envs\jit\python.exe -m autoresearch_pi.cli shopping-experiment `
  --dataset "D:\JIT\dataset\deepplanning_shopping" `
  --cases "2:2,3:2" --repeats 2 --timeout 300 `
  --root "D:\autoresearch_pi_project\runs\shopping-paired-cohort"
```

The root summary starts as `in_progress`, is atomically updated after each
completed control/treatment variant, and becomes `completed` only after every
planned pair. It preserves completed evaluation work after an outer interruption
without resuming, retrying, or changing any Pi task.

`--cases` is a comma-separated `LEVEL:CASE` list. Semantic correctness,
finding/decision uptake, native exposure, and bounded effect remain separate;
a treatment win or supported task-local effect is not automatically a
harness-improvement claim.

For a mechanism-level context compaction ablation, keep Auto-Research and the
Shopping batch surface in both arms:

```powershell
$env:PYTHONPATH = "$PWD\src"
D:\anaconda\envs\jit\python.exe -m autoresearch_pi.cli shopping-context-ablation `
  --cases "2:11,3:2" --repeats 2 --timeout 900 `
  --root "D:\autoresearch_pi_project\runs\shopping-context-ablation-r1"
```

This runner alternates `without_context_compaction` and
`with_context_compaction`; it never substitutes the broad no-research control
for the mechanism-off arm.

For the next manual validation, prefer separate fresh roots for a small decision-quality cohort instead of treating the first N cases as equivalent:

```powershell
$env:PYTHONPATH = "$PWD\src"
D:\conda\python.exe -m autoresearch_pi.cli officebench-e2e --case "2-13-0" --root "D:\autoresearch_pi_project\runs\effect-high-2-13-0"
D:\conda\python.exe -m autoresearch_pi.cli officebench-e2e --case "1-2-3" --root "D:\autoresearch_pi_project\runs\effect-low-1-2-3"
D:\conda\python.exe -m autoresearch_pi.cli officebench-e2e --case "2-15-0" --root "D:\autoresearch_pi_project\runs\effect-reversal-2-15-0"
```

These respectively probe repeated downstream calendar work, a low-benefit direct task, and a calendar-to-Excel tool transition. A valid no-change result is expected in some cases. A task-local `supported` assessment means observed behavior matched the declared expectation; it does not establish causal harness improvement without repeated external comparison.
