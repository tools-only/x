# ARC reflective-core adapter result

## Change record

- **Starting source:** committed `codex/ppt-reflective-core-20261108` HEAD `e0e02194f5d6bca21c8630bbe6c9637e45fc0107`; no uncommitted PPT worktree changes were inherited. The operator handoff authorized starting from this cleanup commit while PPT paid validation continued elsewhere.
- **Opportunity:** the thin ARC runner had no entry using the native reflective core. The new path needs to preserve canonical actions and observations while keeping current context bounded and allowing native resources to take effect on the next provider request.
- **Claim:** one persistent native Pi session can carry the last eight settled action receipts, authored evidence, current environment state, and native lifecycle evidence through real runner/bridge/Pi wiring; one synchronous pre-dispatch reservation ledger covers parent and native child requests.
- **Burden removed:** avoids a separate TASK/ADAPT scheduler, a second session per action, and repeat delivery of the entire action history. Runtime only records facts and applies existing action and resource boundaries.
- **Bounded evaluation:** mock ARC SDK plus scripted provider through the actual new CLI entry; existing PPT reflective-core checks; fresh `arc-thin-smoke`; static launch script syntax and diff checks. No live model/provider call or paid run.

## Implementation

- Added `arc-reflective-e2e` to the existing CLI and a selectable extension path to the existing thin runner. The new entry uses the thin ARC bridge, derives action limits from SDK `baseline_actions` at the existing 5× multiplier, omits `max_actions`, disables the wall deadline, and stops at WIN, first completed level, or action exhaustion.
- Added [arc_reflective_extension.ts](../../demo/arc_reflective_extension.ts) and [arc_reflective_task.md](../../demo/prompts/arc_reflective_task.md). The adapter registers only `reflect_component` for define/redefine/restore; native tool, skill, subagent, prompt, memory, and process resources use the existing binder and plain version files. Action receipts settle once. Rejected actions remain in phase; uncertain actions are blocked from replay. The context hook retains in-phase traffic and projects eight completed actions plus exact refs, authored memory/evidence, active-resource changes/use, and the full current grid/image.
- Parent provider requests use the existing pre-dispatch reservation pattern; native child requests reserve through the same synchronous ledger. The guard persists request and usage evidence, holds unknown usage across restart accounting, and refuses dispatch before the cap. Compaction and length/retry requests go through the parent provider hook. Model settings resolve offline to 175,000 context tokens and 12,000 output tokens, so `$4.46` covers the full context plus output at the configured rates.
- Added a generic scripted-provider/mock-SDK integration fixture and the operator launcher [run-arc-g50t-l1.sh](./run-arc-g50t-l1.sh). The launcher uses a fresh timestamped root, refuses an existing root, and runs the reflective evidence checker and ARC measures after the run. Checker failure is reported separately because no component use can be a valid outcome.

## Source files

- `demo/arc_reflective_extension.ts`
- `demo/prompts/arc_reflective_task.md`
- `demo/arc_thin_native_runtime.ts` (registers only active subagents after publication)
- `src/autoresearch_pi/arc_thin_e2e.py`
- `src/autoresearch_pi/cli.py`
- `tools/mock_arc_sdk/arc_agi.py`
- `tools/arc_reflective_smoke_provider.ts`
- `tests/test_arc_reflective_core.py`
- `.scratch/reflective-core/run-arc-g50t-l1.sh`
- `.scratch/reflective-core/arc-reflective-smoke-evidence.json`
- `.scratch/reflective-core/result-arc-1.md`

## Verification and artifacts

- Pi: `node_modules/@earendil-works/pi-coding-agent/dist/cli.js`, package version `0.87.0`; Node `v25.5.0`; Python `3.12.7`.
- `node --experimental-transform-types --test --test-concurrency=1 tests/ppt_demo.test.ts tests/ppt_trials.test.ts` — **13 passed**.
- `$env:PYTHONPATH = 'src'; python -m pytest tests/test_ppt_demo.py tests/test_reflective_core_evidence.py tests/test_arc_bridge_deadline.py tests/test_arc_bridge_readiness.py tests/test_arc_reflective_core.py` — **30 passed, 1 failed**. The unchanged `tests/test_arc_bridge_deadline.py::test_hanging_action_health_timeout_and_late_result_cannot_commit` expected `/health` status `busy`, got `uncertain`. No bridge code was modified. This failure is recorded; it is not waived.
- `$env:PYTHONPATH = 'src'; python -m autoresearch_pi.cli arc-thin-smoke --root runs/arc-reflective-offline-verify-20261109` — **passed**, mock SDK/scripted provider, 4 actions.
- `$env:PYTHONPATH = 'src'; python -m pytest -q tests/test_arc_reflective_core.py` — **7 passed** in the final full-suite run (included in the Python total above). Cases cover action-phase rollover, rejected/queued/uncertain actions, length recovery, all six resource kinds and restore/version behavior, missing baseline, unknown child usage and pre-dispatch refusal, RESET, WIN, and SDK-derived aggregate budget exhaustion.
- `python tools/check_reflective_core_evidence.py <scripted-run-root> --mode historical` — **pass** for same-version prompt, skill, tool, subagent, and memory consumption. Captured artifact: `.scratch/reflective-core/arc-reflective-smoke-evidence.json`. Process v2 injection is asserted by the integration test. The scripted provider forces publication and use; this is wiring evidence only.
- `bash -n .scratch/reflective-core/run-arc-g50t-l1.sh` and `git diff --check` — **passed**.
- Scripted ARC artifact root: `%TEMP%/pytest-of-qi/pytest-3540/test_reflective_arc_runner_use0/reflective-arc` (Windows temporary test output). The run completed the first fixture level after 9 actions, preserved only the last eight action blocks in the captured final request, carried authored counterevidence, included the current grid and PNG, and excluded repository `AGENTS.md` and removed interfaces.

## Evidence status

- **Functional correctness: passed for tested fixture cases.** This includes missing-baseline preflight, RESET accounting, level/WIN/aggregate stops, action rejection and uncertainty, no queued second action after settlement, and shared child/parent cap refusal before parent dispatch.
- **Full-chain reachability: passed with test doubles.** The new CLI ran the actual thin runner, Python bridge, mock SDK, Pi 0.87.0 native extension and scripted provider; the final captured provider payload and evidence checker were inspected.
- **Autonomous adoption: unverified.** The scripted provider deliberately calls reflection and native resources. No live provider was used.
- **Net benefit: unverified.** This single scripted run establishes no gameplay gain, cost reduction, or reasoning improvement. A matched-budget real-provider comparison is still required.
- The existing deadline test failure remains unresolved and should be reviewed before treating the paid launch as cleared. ARC-specific unknown-usage persistence is implemented through append-only request/usage rows; an ARC process-restart integration case was not directly exercised. Deferred items A, C, and D remain open.

## Operator launch configuration

After the offline gate failure above is reviewed, launch exactly once from this worktree with:

```bash
bash .scratch/reflective-core/run-arc-g50t-l1.sh
```

The script calls the new `arc-reflective-e2e` entry and `demo/arc_reflective_extension.ts`, with `--game g50t --provider az --model qwen3.8-27b --thinking low --thinking-format qwen --input-modalities text,image --max-output-tokens 12000`. It uses Completions/qwen/low, keeps the agent's context files disabled while supplying the explicit task resource, and uses a persistent native Pi session.

- **Scope:** one exploratory attempt, stop after level 1 completes or its SDK-derived per-level action budget is exhausted. The SDK metadata drives the existing 5× ceiling. Prior g50t metadata `[78,175,179,230,96,54,67]` implies level budgets `[390,875,895,1150,480,270,335]`; only `390` applies to this run, and none of these values is hard-coded in the adapter or fixtures. Missing baseline metadata stops preflight.
- **Spending:** USD `400` cumulative conservative hard cap; input USD `20/M`; output USD `80/M`; cache read/write charged at input rate; USD `4.46` per-request reserve for 175k input plus 12k output. Reservations cover parent requests (including compaction/retry/length dispatch) and native children. Unknown requests remain charged. No separate watchdog.
- **Time:** runner wall deadline disabled (`experiment_timeout_seconds=0`); per-decision RPC wait remains 900 seconds. Stop on WIN, level/action budget, dollar refusal, or existing integrity/provider/environment failure.
- **Artifacts:** fresh `runs/arc-reflective-g50t-l1-<UTC timestamp>/arc-run`; log and checker outputs under `.scratch/reflective-core/paid-logs/`. The script runs `tools/check_reflective_core_evidence.py` and `tools/arc_run_measures.mjs` after runner exit. It does not configure or inspect credentials.

No paid run, provider call, network probe, secret inspection, or game-source read was performed. No changes were made in the PPT worktree and nothing was pushed.
