# Meta-harness OfficeBench smoke demo

This demo makes the current architecture inspectable without a remote model. A deterministic task-agent fixture supplies six decisions; the runner executes and records them but contains no rule that chooses iteration, nesting, pruning, harness adaptation, or termination.

The self-harness portion runs inside the actually installed Pi CLI. A test-only extension registers the LLM-facing `set_evidence_policy` tool and a `before_agent_start` hook. Three model-free Pi commands exercise the same extension state in one process: `summary_only → source_and_date → observed source_and_date`.

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

The separate `officebench-e2e` command runs a live Pi task-agent turn. Its extension exposes task tools, optional versioned task-local research goals/findings, and a capability-specific apply/keep execution-surface decision through `pi.registerTool()`. Task-action results include compact model-visible `EXECUTION_OBSERVATION` cards. Research snapshots use stable goal/finding IDs and append-only `open`, `record`, `update`, `resolve`, or `reopen` events. An apply decision snapshots the exact finding version used, invokes Pi's native `setActiveTools()` before the next model request, and starts a bounded task-action effect window; a keep decision records a deliberate no-change outcome. A resulting effect assessment remains compact pending feedback until an agent-authored research update cites it. No research or mutation is required to pass. JIT supplies case data, action implementation, and its deterministic evaluator; it is not the agent runtime.

The generic method lives in `auto_research_method.md`; task-specific capability descriptions remain in the extension. `officebench_artifact_contract.json` is the canonical source for backend artifact paths, task-language mapping, verification actions, and current-testbed scope. Before Pi starts, the runner writes a bounded `task-resource-catalog.json` containing the initial relative-path inventory and only the action contracts relevant to the original task question. Pi injects that catalog once; the full contract remains an audit artifact and `task_artifact_contract` is not on the initial active tool surface. `workspace_file_action` remains available only when the catalog cannot replace bounded listing/text reads. Optional finding-backed calendar and templated-email batch surfaces use `pi.setActiveTools()` on the next request and record bounded utilization effects. Optional `task_notes` records free-text task-local observations; neither notes nor tool counts alone establish a research loop or improvement. See the [optimization track](../docs/tracks/2026-09-07-autoresearch-self-harness-optimization.md) for implemented/deferred work and verification.

Git Bash:

```bash
export PYTHONPATH='D:/autoresearch_pi_project/src'
export JIT_ROOT='D:/JIT'
export JIT_PYTHON='D:/anaconda/envs/jit/python.exe'
'D:/anaconda/envs/jit/python.exe' -m autoresearch_pi.cli officebench-e2e \
  --root 'D:/autoresearch_pi_project/runs/pi-officebench-e2e-live' \
  --case '1-2-0'
```

The command loads `D:\JIT\.env` and requires a new or empty output directory, preserving existing results. It starts from a fresh task-local Pi config/workspace and writes `summary.json`, `artifact-contract.json`, `task-resource-catalog.json`, incremental `pi-events.jsonl`, `pi-runtime-status.json`, model-visible execution observations, append-only versioned research snapshots, optional decisions/effect assessments, target-only SHA-256 manifests, native baseline/optional mutation snapshots, the JIT evaluation, two handoffs, and the round hierarchy. Timeouts retain partial received events and an interrupted status. Agent completion, evaluator signal, artifact change, execution efficiency, task-resource-boundary audit, loop integrity, research lifecycle state, task-local execution-condition effect, and unestablished harness improvement are reported separately. `behavioral_loop_established` means a finding-backed change had a bounded observed effect; only `research_lifecycle_closed` additionally means the agent absorbed that effect into a later research version and resolved the relevant goal.

For a sequential batch with independent Pi processes and workspaces:

```bash
'D:/anaconda/envs/jit/python.exe' -m autoresearch_pi.cli officebench-e2e \
  --max-samples 10 \
  --root 'D:/autoresearch_pi_project/runs/pi-officebench-e2e-10'
```

Each case writes to `<root>/<case-id>/`; `<root>/summary.json` contains aggregate counts and average score.

For the next manual validation, prefer separate fresh roots for a small decision-quality cohort instead of treating the first N cases as equivalent:

```powershell
$env:PYTHONPATH = "$PWD\src"
D:\conda\python.exe -m autoresearch_pi.cli officebench-e2e --case "2-13-0" --root "D:\autoresearch_pi_project\runs\effect-high-2-13-0"
D:\conda\python.exe -m autoresearch_pi.cli officebench-e2e --case "1-2-3" --root "D:\autoresearch_pi_project\runs\effect-low-1-2-3"
D:\conda\python.exe -m autoresearch_pi.cli officebench-e2e --case "2-15-0" --root "D:\autoresearch_pi_project\runs\effect-reversal-2-15-0"
```

These respectively probe repeated downstream calendar work, a low-benefit direct task, and a calendar-to-Excel tool transition. A valid no-change result is expected in some cases. A task-local `supported` assessment means observed behavior matched the declared expectation; it does not establish causal harness improvement without repeated external comparison.
