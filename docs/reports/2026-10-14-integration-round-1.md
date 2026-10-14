# Integration round 1: objective-shaw base against two candidates on forked ls20 runs (2026-10-14)

Follows the [development workflow](../development-workflow.md). User decision (2026-10-14): the objective-shaw design is
the integration base; every other change is tested on its own candidate branch and merged only after forked ARC runs
show a gain.

## Setup

- **Base:** `claude/arc-integration-20261014`.
  - 348ee6ee: objective-shaw 52ef2f0a plus snapshot/fork infrastructure.
  - 834210a8: a retry for bridge starts that the online ARC service timed out.

  Neither changes agent behaviour.
- **Candidates**, each the base plus one opt-in feature, merged with 834210a8:
  - `claude/arc-cand-digest-20261014` (42c294f1), run with `ARC_REFINE_DIGEST=1`: the
    [findings carrier](../plans/2026-10-14-decision-findings-carrier.md);
  - `claude/arc-cand-compute-20261014` (72c08016), run with `ARC_THIN_OBSERVATION_COMPUTE=1`:
    [observation by computation](../plans/2026-10-14-observation-by-computation.md).
- **Common prefix:** source run `int-src-02` on the base, stopped after decision 1 (1 action, 34.6k reported tokens).
  Every run forks from its snapshot `after-decision-1`.
- **Each run:** official ls20, yibu/qwen3.8-27b, high reasoning, query observations, text+image, ledger and refiner on,
  600 s, 100k budget tokens (uncached input + output, after the fork), 20 actions in total.
- **Schedule:** 3 rounds; each round runs one fork per arm at the same time, so arms share provider load.
  - r1-digest failed to spawn (Windows `mklink` exit 0xC0000142 while three launches started at once) and was rerun
    as r1-digest-b about 5 minutes later.
  - Later rounds were launched 20 s apart.
- **Artifacts:** `runs/arc-efficiency-claude-20261014/{int-src-02,r1-*,r2-*,r3-*}`. Table from `tmp/compare_arms.mjs`.

## Results (after the fork only)

| Arm | Run | Stop | Actions | Levels | Budget tokens | Reasoning | Agent requests | Refiner requests (tokens) | Memory writes (agent/refiner) | Budget per action |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| base | r1-base | deadline | 4 | 0 | 55,455 | 11,940 | 8 | 0 | 2/0 | 13,864 |
| base | r2-base | deadline | 10 | 0 | 69,447 | 13,305 | 7 | 0 | 6/0 | 6,945 |
| base | r3-base | deadline | 5 | 0 | 66,648 | 9,465 | 10 | 0 | 2/0 | 13,330 |
| digest | r1-digest-b | deadline | 2 | 0 | 109,053 | 19,246 | 7 | 0 | 3/0 | 54,527 |
| digest | r2-digest | deadline | 1 | 0 | 85,286 | 17,001 | 8 | 0 | 3/0 | 85,286 |
| digest | r3-digest | deadline | 2 | 0 | 82,892 | 18,795 | 5 | 2 (9,287) | 0/0 | 41,446 |
| compute | r1-compute | deadline | 2 | 0 | 68,430 | 15,497 | 8 | 0 | 0/0 | 34,215 |
| compute | r2-compute | deadline | 2 | 0 | 85,493 | 19,040 | 6 | 0 | 0/0 | 42,747 |
| compute | r3-compute | token cap | 3 | 0 | 116,027 | 18,326 | 8 | 0 | 4/0 | 38,676 |

| Arm | Median actions | Median budget tokens | Median reasoning | Budget per action (pooled) | Reasoning per action (pooled) | Levels |
|---|---:|---:|---:|---:|---:|---:|
| base | 5 | 66,648 | 11,940 | 10,082 | 1,827 | 0/0/0 |
| digest | 2 | 85,286 | 18,795 | 55,446 | 11,008 | 0/0/0 |
| compute | 2 | 85,493 | 18,326 | 38,564 | 7,552 | 0/0/0 |

## Readings

- **Base vs candidates.** The base played more actions than both candidates in each of the three rounds, at a fifth to
  a quarter of their budget per action. No arm completed a level.
- **The digest mechanism barely ran.** Under the base's prompt the agent writes memory itself (3 of 3 base runs, 2 of 3
  digest runs), so a "decision ended with results the agent did not record" event fired in one run (r3-digest:
  2 refinements, 9.3k tokens).
  - In r1 and r2 the digest arm differed from the base only in the refinement line of the system prompt.
  - Its lower action counts there are as large as the gap that run-to-run variance produced from an identical state
    earlier today (51.5k vs 85.9k tokens). These runs therefore do not show that the digest harms; they show no gain.
  - This is justified non-use: the agent recorded on its own.
- **Compute ran and did not help.** The changed-region view reached the model (5 and 2 provider requests in r1 and r2).
  Reasoning per action was 4× the base's, and every compute run played fewer actions than its round's base run.
  Whether the region view made the agent reconstruct the board, or the change is neutral and these runs are noise, is
  not separated by three samples.
- **Limits.**
  - Three samples per arm.
  - One game.
  - One snapshot.
  - Concurrent load from three or four runs on one provider.
  - r1-digest-b started about 5 minutes after its round.

  Ranking all three base runs above all three candidate runs has a 1-in-8 chance under exchangeable runs for each
  candidate. That is not strong evidence of harm, and no evidence of gain.

## Decision

- **Not merged:** neither candidate showed a gain, so by the agreed rule both stay on their branches.
- **Integration branch:** stays at the base (objective-shaw + forks + retry).
- **Digest:** if a later base stops the agent from recording on its own, it becomes relevant again. It is cheap to keep
  as an opt-in on its branch.
- **Compute:** needs a mechanism-level look (what the agent did with the region view) before any rerun.

| Evidence layer | Status | Provider / environment | Artifacts and limits |
|---|---|---|---|
| Functional | Passed (both candidates) | offline smokes | candidate branches |
| Full chain | Passed | real bridge, Pi, yibu/qwen3.8-27b, online ls20 | runs above |
| Autonomous adoption | digest: fired in 1 of 3 runs (agent recorded itself otherwise); compute: view delivered | same | — |
| Net benefit | Not shown for either; base better on every pairing | same | 3 samples per arm, one game |
