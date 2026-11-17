---
name: self_evolution
description: Primary loop for evolving reusable Kaggle-solving harness capabilities and validating their downstream results.
---

# Evolving the problem-solving process through Kaggle work

Solve the competition through a self-harness that you continuously inspect and improve during the work. Its methods, prompts, memory, skills, tools and subagent roles are the working parts of that harness. Create Python tool components with `self_component(kind="tool")`; define `run(args)` and exercise a chosen version with `run_harness_tool`. As you develop useful procedures, decision rules, checks and coordination patterns, actively capture them in new or improved components. Treat model, CV and public-score feedback as evidence about both the candidate and your own problem-solving process. A reflection about which features or parameters worked is useful task analysis, but it is not enough: diagnose what your planning, experiment selection, validation, tool use, context handling or use of existing methods needs to improve.

## Required feedback loop

After every scored submission:

1. Compare the scored result with the previous candidate and record what the score does and does not tell you.
2. Review your own work in that submission window: which planning, experiment, validation, tool, context or harness-use decisions helped; what process capability or strategy was missing or underused; and why.
3. State a specific change to your approach and a next experiment that will test it. Separate this diagnosis from model-level observations.
4. Distill the window's process reflections and conclusions into prompt, memory, skill, tool or subagent components with `self_component`, creating or revising components and supplying concise descriptions of their functions. Capture hypotheses as they emerge without waiting for proof.
5. Record the checkpoint with `harness_reflect`. Before another real Kaggle submission, run an experiment that applies the stated strategy change and inspect the outcome.
6. Judge components downstream by actual use and evidence. Keep, revise, combine or retire them based on later work, retaining neutral and negative results.

Do not gate component capture on a prior judgment that it will be reused or proven effective. A component can be provisional; later experiments determine whether it helps and should remain active. Saving a component alone is not evidence of improvement: the goal is to develop the harness during the task, use it to solve the competition, and assess its effects with real work.

The system prompt indexes active components by kind, name, version and functional description. Review this index in the next window, use `read_component` for details, and select components for the next experiment. Record what actually happened and update the components as the evidence develops.

## Establish the evidence base

- Read the metric, deadline, submission format, row count and rules. Reproduce the row count and id set of `sample_submission.csv`.
- Build a deterministic split that matches the competition's structure. For i.i.d. rows, start with stratified K-fold for classification or K-fold for regression. For grouped or temporal structure, use GroupKFold or a time-ordered split; a random split that leaks groups inflates CV and misleads selection.
- Fix the split once, save its indices under `work/`, and reuse it across candidates. If you change the split, version it as a method change and re-score the champion.
- Score the competition metric, not a convenient proxy. Report mean and fold standard deviation. Keep out-of-fold predictions: they are the raw material for blending, stacking and error analysis.

## Calibrate local validation against the leaderboard

- Submit one credible baseline early, with `cv_score` recorded, to learn the CV–LB offset and noise scale.
- After each submission, compare the CV delta with the LB delta. A candidate that gains CV but loses LB is evidence about the validation method or about public-LB noise; investigate before dismissing either.
- Keep a ledger of candidate, CV, LB, method version and decision. The ledger is evidence for the next choice, not a scoreboard to optimize.
- Do not chase the public leaderboard with many near-identical submissions. The private result decides the ranking, and the daily allowance is finite.

## The producing side

Continuously develop producing-side harness methods for:

- **Representation**: domain transforms, count/frequency encodings, interactions, aggregates, missingness indicators, target encoding fitted inside folds. Verify each feature's CV contribution on the fixed split, not on a single fold.
- **Model**: LightGBM, XGBoost and CatBoost are the CPU workhorses. Tune a small number of high-impact parameters with early stopping; use multiple seeds when the variance matters. For linear or distance-based models, scale and encode deliberately.
- **Training recipe**: class weights, sampling, monotonic constraints, categorical handling, fold-safe preprocessing, deterministic seeds.
- **Ensemble**: rank-average or weighted blend OOF predictions; fit blend weights inside a held-out fold or with non-negative least squares; test whether the blend beats the best single model on the same split.

Save each reusable piece as a method:

```
save_method(name="features_v2", description="fold-safe frequency and amount features", source_path="work/features_v2.py")
run_method(name="features_v2", args={"train": "data/raw/train.csv", "out": "work/features_v2"})
```

Use `edit_method` for a bounded revision and `run_method(version=...)` to rerun an earlier version. A method that is never used in a later candidate is a note, not a capability.

## The assessing side

Continuously develop assessing-side harness methods for:

- **Discrimination tests**: construct cases the validator should pass and cases it should reject (shuffled labels, a deliberately leaked feature, a candidate with a different row order, a constant prediction). A validator that cannot reject a bad candidate is not protecting the submission budget.
- **Error analysis**: inspect false positives/negatives by segment, time, amount, missingness and feature range. Turn a repeated error pattern into a producing-side change, then test it.
- **Adversarial validation**: if train and test differ, measure it and decide whether reweighting or dropping unstable features is justified.
- **Selection rule**: define in advance how much CV gain is credible given fold variance, and what LB evidence would overturn it. Revise the rule when the ledger shows it is wrong.

## The co-evolution loop

For each substantive iteration, distinguish:

1. Candidate-level findings, such as useful features, model behavior or CV–LB movement.
2. Process-level findings about your strategy, tool use, validation or context handling.
3. The next action that applies the process improvement and how its effect will be judged.
4. Harness components created or revised, their versions and intended use, including provisional components not yet tested.
5. What remains uncertain after comparing CV, fold spread, public score and errors, and how later use will resolve it.

Cross-test the sides. A new feature set should be judged by the current assessor; a stricter assessor should be tested on old candidates it would now reject. When the producer changes, check whether the assessor's old criteria still see the new failure modes. When the assessor changes, run it against the current champion and at least one deliberately weak candidate.

## Failure modes

- CV–LB divergence after a promising local gain: suspect leakage, distribution shift, or public-LB noise. Recheck the split before adding complexity.
- Many submissions with tiny deltas: stop, improve the assessor, and preserve allowance for a genuinely different candidate.
- A method that only works on one fold or one seed: treat it as unstable until repeated.
- Format or id errors: validate with `dry_run=true` and compare against `sample_submission.csv` before spending a submission.
- A leaderboard score with no local explanation: record it, but do not build the next method on an unexplained jump.

## Budget

Provider time, Python runtime and submission allowance are finite. Prefer a strong baseline, one well-tested representation change, a tuned GBDT, and a blend over a broad random search. Stop when the next experiment cannot plausibly change the ranking, and preserve the best submission.
