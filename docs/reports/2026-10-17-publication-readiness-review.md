# Publication readiness review (2026-10-17)

Date: 2026-10-17 (Asia/Shanghai). The user's question, asked in the session "Agent-driven error correction in r03b":
"to converge toward a publishable outcome (e.g., running various benchmarks for a paper) … what do you see as the
most urgent issues in our current implementation?" That session's answer, recorded here when it was folded into the
r04 line, with each item's status after r04's E1. Data: the 56 real ARC runs since 2026-10-15; scripts and tables in
`C:/Users/qi/tmp/pub-20261017/` (`runs-aggregate*.json`, `survey.txt`).

The user's follow-up named hypothesis checks and the self-harness as the most important issues (5 and part of 4);
their plan is [2026-10-17-hypothesis-loop-and-self-harness.md](../plans/2026-10-17-hypothesis-loop-and-self-harness.md).

## The issues, by how badly they block a paper

| # | Issue | Evidence (2026-10-17) | Status after E1 |
|---|---|---|---|
| 1 | A tuning loop on one game, not a benchmark | 41 of 56 runs are su15; bp35 7 forks of ≤41 actions, ar25 3 short forks, ls20 5 runs (one full, 0 levels in 110 actions); no held-out game ran on the current line. Mechanisms were shaped by su15 failures (counter-row detector, click-distance counts and charter sentences) | open; E1 was su15 again. Fix: freeze a split (a few development games; the rest of the 25 API games only for frozen versions) |
| 2 | No baseline, no ablation | the runner's `control` variant (`arc_action` only, no services) has not run on current code; no reference harness (e.g. Continual Harness) on the same games and model; the only floor is the 2026-10-10 blind-policy runs (0 levels) | open |
| 3 | Keep/reject decisions within noise | one commit gave 2, 0, 3 levels (L0), then 1, 1, 1 (L1); pooled, level 2 in 2 of 6. A 3-run test passes "2 of 3" by chance about 26% of the time; R1's verdict rested on 1 of 3 against 3 of 3 | open. Fix: per-game variance from existing runs, then size the comparison (plausibly ≥5 runs per game on ≥10 games, paired by game, with intervals) |
| 4 | Numbers we would report are wrong or misleading | hypothesis checks read a key moves lacked (`changed_cells`), deciding promotions; refused streams are billed but not counted (about 12M in su15-r1-B2), and totals depend on cache-read billing (84M budget tokens against 430M reported); 75% of 2,470 scored prediction fields are trivial (`level_changed`, `state`); the per-level action budget (5× baseline) is our bridge's rule, not checked against the official protocol (deferred item A); official scorecards are not reported consistently | partly fixed: strict checks in r04 (`7d2533bc`), and a refused refinement memory edit no longer counts as applied (`6c513fd4`). Accounting, prediction scoring, the budget rule and scorecard reporting are open |
| 5 | The self-harness claim has no evidence | in 56 runs the agent wrote 0 tools, skills or libraries; saved tools were called in 1 run (3 calls); 0 of 467 refinements were requested by the agent; all adaptation came from the scheduled refiner, never measured against running with it off | planned: Part S of the hypothesis and self-harness plan |
| 6 | Cost and throughput at campaign scale | median 12.5k budget tokens per action (90th percentile 20.6k); an su15 run costs 2–6M and 12–70 s per action; 20 games × 5 runs × 2 arms ≈ 600M budget tokens before cache reads; decision starts dominate cost and the bounded-history experiment (R2) never ran; thinking setting differs across the history | open; E1 spent 10.6k per action |
| 7 | Runs not reliable enough for a batch campaign | of 56 runs: 4 ended on an environment step that never returned (before the restart existed), 1 on repeated provider errors, 8 partial from hand stops or reboots | open; E1 was stopped by a gateway outage (the runner's refusal stop also fires on transport errors). Needs a queue-based batch runner with resume, health checks and a written rule for which runs count |
| 8 | The code is not release-ready | about 80 worktrees; the shipping version lives on a `claude/...` branch; 5 unit tests known to fail; every native smoke stops at the stale `system_chars <= 3000` check; Claude and Codex sessions edit in parallel | open; on 2026-10-17 the two sessions' lines were folded into `claude/r04-20261017` |

## Order the review proposed for r04

1. Write the evaluation protocol: the claim, the official metric, the game split, baselines, seeds and a budget.
2. Land the correctness fixes: strict hypothesis checks, cost accounting, the budget-rule check, official scoring.
3. Run `control` against the current version on 3–5 development games, to measure variance and cost, then size the
   campaign.
4. Only then component tests (ledger, refiner on or off), on the benchmark rather than su15 alone.

Deferred items it touches (`docs/deferred-research-todos.md`): A (budget, RESET and frame rules: SDK semantics or our
policy) is on the critical path; D (continuity after compaction) connects to cost through the unrun history-window
experiment; B and C are not on the paper's critical path.
