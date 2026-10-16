# Meta-harness change record: matched-prefix evaluation (fork from a snapshot)

Date: 2026-10-14 (Asia/Shanghai). Status: implemented; real-provider use not yet run.
Follows the [development workflow](../development-workflow.md). Plan: step 1 of the
[agent-loop comparison](../reports/2026-10-14-agent-loop-comparison.md).

## Problem and claim

- **Real failure.** Pilots 01/02a/02b ([results](../reports/2026-10-14-pilots-02-continuity.md)) each had a different
  decision 1: 4 actions by python, 4 by `then`, and 1 by python. Everything after depended on it, so single runs per arm
  could not separate a variable from that variance.
- **Narrow claim.** If every arm continues from the same recorded state (same environment state, Pi session, harness
  stores, workspace and python session), differences after the fork are due to the arm's configuration plus
  sampling noise, not to a different opening.
- **Burden removed.** Developer-side only: one opening is paid once, instead of once per arm per repetition. No change
  to the agent's context.
- **Non-goals.** Not a replay of model behaviour, and it does not make the environment deterministic. If the
  environment does not repeat the recorded grids, the fork is refused.

## Design and cost

- `run_arc_thin_e2e(snapshot_after_decisions=(k, ...))` copies `session.jsonl`, `harness/`, `workspace/` and
  `.harness/` to `snapshots/after-decision-<k>/`, together with `snapshot.json` (decision, actions, reported tokens).
  The copy is taken between turns, while Pi is idle.
- `run_arc_thin_e2e(fork_from=<snapshot>)` copies the snapshot into a new root and writes `fork-replay.jsonl`: each
  action with the grid recorded after it. It then starts the bridge with `--replay-actions`, which plays the actions
  before reporting ready and stops at the first grid that differs (`ReplayMismatch` in `bridge-error.json`). The
  runner then checks the bridge's `total_used` against the snapshot, and Pi resumes the copied session.
- Only tokens reported after the fork count toward `max_reported_tokens`. `summary.json` and `run-config.json` carry
  `fork: {source, decision, actions, prefix_reported_tokens}`.
- **Integrity checks kept.** Actions still pass through the bridge, its budget and the action boundary. Replayed
  actions count toward the scorecard and budget, as in the source run.
- **Limits.**
  - A refinement still running when the snapshot is taken belongs to the source only.
  - Replaying online consumes real environment actions, and the bridge allows 5 s per action to reach ready.

## Protocol for use (before any comparison)

- For each game, one source run with `snapshot_after_decisions=(1,)` or a later decision. Then at least 3 forks per arm
  from the same snapshot, in alternating order.
- Metrics after the fork: reasoning tokens per request, generated tokens and wall time per action, actions and level
  progress within the time budget, cache share.
- **Negative case.** A snapshot whose grids the environment does not reproduce is refused, not run.

## Implementation and verification

- Entry points: `src/autoresearch_pi/arc_thin_e2e.py` (`_snapshot_run`, `_seed_fork`, fork wiring, token offset),
  `src/autoresearch_pi/arc_agi_3_bridge.py` (`ArcBridge.replay`, `--replay-actions`),
  `tools/arc_thin_smoke_provider.ts` (`FORK_SCRIPT`), `tools/run_fork_smoke.py`.
- `python tools/run_fork_smoke.py <dir>` (mock SDK, production bridge, actual Pi and WASI) exits 0 and checks:
  - the source run snapshots after decision 3 (5 actions);
  - the fork replays them (`fork_replayed`) and Pi continues the source session (RECENT HISTORY present);
  - `plus_one(kept_value)`, defined in the source's decision 3, returns 42 in the fork, and `len(history)` is 5;
  - the fork's first action is #6 with `total_used` 6;
  - a snapshot with one altered grid cell is refused with `ReplayMismatch`.

| Evidence layer | Status | Provider / environment | Artifacts and limits |
| --- | --- | --- | --- |
| Functional | Passed | offline scripted provider, mock ARC SDK | `runs/fork-smoke-*`; deterministic mock only |
| Full chain | Passed | production bridge, actual Pi 0.87.0, WASI; online ARC ls20 with yibu/qwen3.8-27b | `runs/arc-efficiency-claude-20261014/fork-src-01` and `fork-a-01`; one action replayed |
| Autonomous adoption | Not applicable | — | a developer tool |
| Net benefit | Unverified | — | needs paired forked runs |

### Online check (2026-10-14)

- Source `fork-src-01` (6bca2f6c, flags off) snapshotted after decision 1, which took 1 action (ACTION1 by python, 5,363
  tokens). Fork `fork-a-01` started from that snapshot while the source was still running.
- The bridge replayed the action and every grid matched (`fork_replayed`, no `bridge-error.json`). The Python session
  was restored with decision 1's names (`before`, `diffs`, `json`, `res`). Pi continued the copied session, and the
  fork's next action was #2.
- **Same prefix, different continuations (600 s each):**

  | | Source | Fork |
  |---|---:|---:|
  | Decision 2 requests | 6 | 8 |
  | Decision 2 tokens | 51.5k | 85.9k |
  | Decision 2 reasoning | 9.8k | 14.3k |
  | Decision 2 action | ACTION2 | RESET |
  | Total actions | 2 | 2 |
  | Reported tokens (whole run) | 67.9k | 108.4k (103.1k after the fork) |

  Both stopped at the deadline. Even from an identical state, one continuation spent 1.7× the tokens of the other, so
  a single paired run cannot show an effect of the size we are looking for.
- The token cap is checked between decisions, so the fork passed 100k post-fork during its last decision. Unchanged
  behaviour, noted for budgets.

## Decision

- Kept as a developer tool; changes nothing by default.
- The online environment repeated a recorded action from start (1 action). Longer prefixes are untested.
- **Next falsifiable check.** Each arm needs at least 3 forks, chosen from this noise level. Decide the arms (current
  defaults versus `ARC_REFINE_DIGEST=1`, and the Reasoning retention changes once committed) and budget about 100k
  tokens and 10 minutes per fork.

## Environment restart (2026-10-16, ported from `claude/r03b-simple-20261015`, af976326)

- **Failure.** A step of the online service that does not return within the bridge's step timeout leaves the bridge
  refusing all access (`uncertain`). The run then stopped as `environment_outcome_unknown`. This ended su15-s04, e1-A2, r9
  and f0 on 2026-10-15/16, f0 after 2 actions.
- **Change, in the runner only** (`max_environment_restarts`, default 3; 0 stops as before). Between decisions the runner
  replaces such an environment, or a bridge whose process ended, with a new game on the same port and action token. It
  replays the recorded actions with every grid checked, the replay a fork already uses. The bridge is unchanged and
  never replays or commits a step whose outcome is unknown.
  - The next decision's prompt says once that the environment was restarted and that the failed action was not applied.
  - `bridge-events.jsonl` gets one `environment_restarted` event and has each action once.
  - `summary.environment_restarts` records each restart.
  - A replay mismatch stops the run.
- **Evidence.** Mock: `run_fork_smoke.py` part 4, a step that hangs past the 90 s timeout once. Online on the branch
  (su15 fork test, 2026-10-16): two restarts after 300 s timeouts, each on the first attempt (82 s and 165 s to replay
  151 and 226 actions). Both runs continued, and one went on to complete level 2.
- Ported without the branch's agent changes; the step timeout stays 90 s here.
