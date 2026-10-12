# Falsifiable self-harness on a Pi-native, file-first foundation: integrated plan (2026-10-12)

Status: plan, plus slice 1 implementation in progress. This supersedes my SDK and workspace proposals of 2026-10-12. It merges:
- Codex's [integrated plan](../../../autoresearch_pi_incremental_20261012/worktree/docs/plans/2026-10-12-pi-native-self-harness-integrated-plan.md);
- Codex's [historical lessons](../../../autoresearch_pi_incremental_20261012/worktree/docs/reports/2026-10-12-workspace-harness-historical-lessons.md);
- the user's direction: the community's systematic design with Prime's flexibility, and our own contribution.

## 1. What is ours

Coding-agent harnesses (Prime, Claude Code, Codex, the Pi community) assume an inspectable, reversible world. ARC has hidden rules and irreversible, costly actions, and it is learned by experiment.

Our measured losses are failures to check beliefs against what the environment has already shown:
- 11 of 17 level/WIN predictions failed;
- level-1 assumptions were reused on level 2;
- counterexamples were lost in summaries;
- 20–45% of output went to memory upkeep;
- components ran smoothly but computed the wrong thing (B36 sampling, I40 window index).

**Thesis: claims checked against history.** A belief may carry a small executable check, `check(t)` over one transition. The runtime runs it over the recorded history when saved and on every new transition. It keeps the results as runtime-owned evidence: holds, fails with the action number, or not applicable. One mechanism then serves memory, the critic, level transitions, invalidation and guarded step execution.

The meaning stays with the agent: what the claim says, and whether a counterexample refutes it or narrows it.

## 2. Foundation (from Codex's plan, with corrections accepted)

**Pi.** Pi owns sessions, compaction and tool calls; continuity is native, with receipts plus exact retrieval for large results.

**File-first authoring.** The file is the component. Every save, first or later, rebinds at the next request boundary through one path. The receipt says saved / loaded / active / which version runs / where it failed. A failed revision is marked failed; any fallback to the older version is labelled.

**Execution.** Saved components run from their own version in a fresh context. The interactive namespace is for one-off code only. Observers are opt-out, run once per state, and are labelled with the state they describe.

**Records.** Runtime-owned and immutable: receipts, observations, execution records, check results, critic reports. Agent-revisable with history: beliefs, strategies, notes, replies to the critic. No write ends a decision. Refusal is only for integrity: permissions, budget, invented action numbers.

**Index and subagents.**
- A compact capability index each decision: name, one line, status, how to call it.
- Subagents: role file plus `consult(role, question, refs)`. The answer is returned as the tool result; the role never gets `arc_action`.

**Isolation.** Chosen by threat model and covering both the file tools and code execution. The architecture does not depend on Pyodide.

## 3. Slices

| Slice | Content | Status |
|---|---|---|
| 0 | One pinned Pi (0.87.0); session-continuity mode | done ([record](2026-10-12-pi-native-continuity.md)) |
| 1 | **Claims and one-off computation:** `check` on hypotheses (run at save and on new transitions; per-level results); `python` tool for one-off code with history, artifacts and saved skills callable; `observe` flag on skills; runner option to drop the forced review at level change | implemented; functional and scripted full-chain checks pass (§5) |
| 2 | Real comparison of slice 1 against the continuity build: ls20 and lp85, same budget | needs a budget |
| 3 | File-first components with the lifecycle rules in §2: tools from typed functions, SKILL.md packages on the native discovery path, prompt files, subagent role files | after 2 |
| 4 | Guarded step execution, using claims as guards | needs approval |
| 5 | Native compaction once the compaction probe passes; critic consuming failed and never-applicable claims | after 2 |

## 4. Slice 1 acceptance

**Functional** (unit tests and a real-sandbox extension test):
- a check runs over history at save, with holds/fails/n-a counts and failing action numbers;
- new transitions are checked incrementally;
- results are split by level;
- a broken check is reported and does not block the memory update;
- `python` returns stdout and the last expression's value without saving anything, and can call saved skills;
- `observe:false` stops automatic runs.

**Full chain:** a scripted smoke through the real bridge, Pi and sandbox.

**Real runs (slice 2), against the continuity build:**
- Primary measure: levels.
- Mechanism measures:
  - checks written, and consulted afterwards;
  - repeated tests of already-refuted claims;
  - actions taken on stale assumptions after a level change;
  - `python` calls and the share of reasoning spent on coordinates;
  - memory-upkeep share;
  - turns per action.

**Kill criteria:** no checks written, or written and never consulted; or more turns per action without progress.

## 5. Slice 1: what was built and checked (2026-10-12)

| Part | Files | Behaviour |
|---|---|---|
| Claim engine | `demo/arc_thin_claims.ts` (new), `demo/arc_thin_skill_guest.ts` (`claims` mode), extension | **Inputs:** grids for the transitions to check, sent as segments (the grid before, then cell changes; a whole grid after a shape change), in batches sized for the sandbox. **The check:** `t` carries the action report plus `before`/`after` as read-only tuples. `check(t)` returns True/False/None; anything else, or an exception, is an error for that transition. **Storage:** results go to `claim_checks.jsonl` per hypothesis key and source hash. A check that does not compile is recorded once and not run again. Transitions without grids are skipped, not retried. **When it runs:** over the whole history when a check is added or changed (the result is in the memory receipt), then on each new transition at the start of every decision. |
| Memory | `demo/arc_thin_memory.ts`, `demo/arc_thin_boundary.ts`, extension schema | Hypotheses take an optional `check` (`""` removes it). It is never clipped and is unescaped when it arrives on one line. The receipt notes "new, with check" or "check updated". The hypothesis view shows one line: "check on N recorded move(s): holds a · fails b (#…) · n/a c · errors d", plus "on level k: …" once there are results on more than one level, and "never applied" when nothing applied. A broken check never blocks the memory update. |
| One-off computation | guest `exec` mode, `python` tool in the decision and review tool sets | Runs code once; nothing is saved. Available: `state`, `history`, `grid`, `prev_grid`, `artifacts`, `skill(name, **args)`. Returns what was printed and the value of a final expression; output is cut at 2,400 chars. Errors come back with the failing line. Logged in `python_runs.jsonl`. |
| Observers opt-out | `skill` tool | `observe:false` on a save, or `skill(op="set", name, observe=false)` with no source, stops automatic runs. The flag carries over to new versions, the SKILLS list says "[not run automatically]", and earlier outputs are no longer shown. |
| Level-change review | runner, CLI `--no-level-change-review` | Off: no forced review after a level change; the 25-action and GAME_OVER reviews remain. Recorded as `review_at_level_change` in `run-config.json`. The default is unchanged (on). |
| Prompt | `demo/prompts/arc_thin_system.md` | The paragraph on predictor models, never adopted in real runs, is replaced by two sentences on `python` and checks. The system prompt stays under 3,000 chars without the ledger board. |

**Checks** (Windows, Node 25.5, Python 3.12, Pi 0.87.0; scripted provider):
- **Node:** 90 tests in total.
  - Full parallel run: 87 pass. Two failures were tool lists updated for `python`; the third was a timing failure of the installed-Pi action-surface test under parallel load.
  - Those three files, re-run one at a time: 11/11 pass.
  - New: `tests/arc_thin_claims.test.ts` (segments, summary, rendering, versions). New in `tests/arc_thin_self_harness.test.ts`: real-sandbox checks at save and on a later move, a check that raises, `python` with output, a value and a saved skill, a `python` error, and `observe` off.
  - Note: under parallel load, sandbox and Pi timeouts in other tests fail intermittently (the first run had 5 such failures). `tmp/run_checks.mjs` now runs with concurrency 2.
- **pytest:** 8/8.
- **Scripted full-chain smokes:** claims (new) 8/8, continuity 10/10, self-harness 21/21, ledger 14/14, environment 5/5. The claims smoke: `runs/arc-thin-claims-smoke-20261012093406`.
  - **At save:** the right check holds at #1, the wrong one fails at #1, and a non-compiling check is reported while the update still commits.
  - **One-off code:** `python` returns "nine at 3 → 4" and saves nothing.
  - **On the next move:** the next decision shows "check on 2 recorded move(s): holds 1 · fails 0 · n/a 1".
  - **Evidence:** the results are stored in `claim_checks.jsonl`.

| Evidence layer | Status | Limits |
|---|---|---|
| Functional | pass | Unit and real-sandbox extension tests |
| Full chain | pass (scripted) | No real model; the mock game has no level change, so the per-level split is unit-tested only |
| Autonomous adoption | unverified | Needs slice 2 real runs |
| Net benefit | unverified | Needs slice 2 real runs |
