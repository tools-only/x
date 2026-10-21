# Components as the default of problem-solving: CH's strengths in canonical forms (analysis and plan, 2026-10-21)

Date: 2026-10-21 (Asia/Shanghai). Status: design (2026-10-21, the user: "don't implement, analyze and give me a final plan"); S0–S3
implemented behind default-off flags on branch `claude/r04-components-20261021` the same day, functional checks only — see
"Implementation and verification". The design sections below are the 2026-10-21 text, kept as written; deviations are listed
at the end of "Implementation and verification".
Record format: `docs/templates/meta-harness-change.md`. No stage has been run against a model: every adoption and benefit
level below is unverified. Prior art, never implemented: the 2026-10-07 skills-spec tickets and the 2026-10-08
five-kind "nature" rewrite (`docs/deferred-research-todos.md`, 2026-10-07/08 entries).

## Problem and claim

### The question: r04 never creates skills — is the one-line `{{skill}}` definition the reason?

Observed (records, not inference):

- Every run under `runs/` with an `arc-run/.harness/components.jsonl` (arc-models-20261019: g61-1/2, g56-1/2,
  q38-1/2/3; arc-su15-20261020; arc-lessons-20261020 ×4; arc-ch/chm-20261020; arc-lb-20261020 ×3) has **zero
  `skills/`** entries and zero `lib/`. `agents/` appears only as `agents/reviewer.md` in the two lb-cb runs (the A5
  call point "every review starts by consulting a subagent"). What the runs do create: `tools/<name>.py` (1–2 per run,
  arg-less snapshots), `prompts/strategy.md` (up to 18 versions in g61-1) and `prompts/rules.md`. Both models
  (gpt-6.1-sol, qwen3.8-27b) show the same shape, so it is not model-specific.
- The system prompt (`demo/prompts/arc_thin_native_system.md:13`, rendered by `demo/arc_thin_extension.ts:3964`)
  gives Skill one clause — "skills/<name>/SKILL.md (name, description), a procedure read on demand" — and it is the
  only kind with **no creation path** (Tool: `python(code, save=)`; Memory: the memory tool; Prompt: the files;
  Subagent: `agents/<name>.md` + `consult`), **no trigger** and **no consumer** other than the agent's own later
  `read`, which the record shows the agent almost never does (r03b: write/edit/consult/refine unused).
- The runtime's event→kind map never targets a skill (`demo/arc_thin_extension.ts:2011` `refinerTriggers`):
  repeated work → "saved code that takes no args is a view" (a tool), level reached → rules/lessons, no goal test →
  strategy, coordinate-heavy reasoning → a view tool, promotion events → rules. The level review writes
  `prompts/lessons.md`, the stall review `prompts/review.md`: the procedural knowledge that would be a skill is
  pre-routed into prompt files by the runtime itself.
- The tool default absorbs the codify impulse: every saved cell is a tool, and arg-less code is a pushed view
  (`demo/arc_thin_components.ts:63-67`). By CH's definition (a "skill" is executable Python called by name) r04 *does*
  create skills — they are its tools. What r04 never creates is the Pi/Agent-Skills kind: a textual procedure with
  scripts, routed by description.

Conclusion: the thin definition is a contributing cause, not the cause. A kind with no creation path, no trigger and
no consumer is a dangling artifact by design, so even a complete definition is predicted to yield zero or decorative
skills. Skills appear only when (a) something mechanical produces them from events, (b) something consumes them at a
call point, and (c) their boundary against tools/scripts is stated. Stage 1 below tests the text-only hypothesis
directly and cheaply before the mechanism stages.

### CH's strengths (the user's audit of `Continual-Harness-ARC-AGI-3/logs`, `logs1`) against r04

| CH strength | r04 already has | r04 lacks | Plan item |
| --- | --- | --- | --- |
| 1. First implementation is the persisted component (`create_skill` is the way to write analysis; in-place update by name) | `python(code, save=)` in one call; live kernel namespace; cell addresses `cell(k, a, b)` (work memory 9a5e0536); versioned overwrite | Persistence is opt-in (`save=`) and competes with the namespace, whose names saved components cannot see ("Saved tools run without this namespace"); promotion is a later refiner step | Stage 2: defs persist by default as importable scripts; one interface (the cell) for creation and reuse |
| 2. Findings feed the next working state (compact memory, refiner updates in place) | memory index each decision (`renderDecisionMemory`), facts `key/text/confidence`, hypotheses with `check(t)`, refiner MEMORY/HYPOTHESIS with `replaces`, EXPECT ledger | The refiner's one-edit-per-event never yields a procedure; reviews yield prose prompt files that re-enter the system prompt (and zero the yibu cache at byte 0 on every edit) | Stage 3: event→kind rule includes skill; reviews emit skill (procedure) + memory (facts); skills are files with an event trigger, not system-prompt sections |
| 3. Reuse with task utility (`tools.take_actions()` from saved code) | `env.act` from cells and from `run(args, env)` tools; action lists with prediction stop | Usage: tools are a second interface (args dict, no namespace) and are not called; CH shows the same (639 failed `run_skill` calls) | Stage 2 makes the cell the single reuse path (import a persisted name); no new execution interface |
| 5. Components resident in the rebuilt decision context and rediscoverable | HARNESS index + memory index per decision | Index drops to names-only above 1200 chars (`demo/arc_thin_binder.ts:162`), removing the routing descriptions | Stage 3(d): descriptions stay resident |

Not ported from CH, with the audit's own evidence: parallel four-kind synthesis per failure (duplication, count
inflation, no independent gain); a separate `run_skill` call interface (where CH's 639 failures and r04's uncalled
tools both live); success flags without semantic checks.

### Narrow claims (one per stage; each falsifiable on a fork pair)

- S1 (text only): a canonical definition of the kinds alone does **not** produce skills (prediction: still 0 skills
  created, 0 read). If ≥1 skill is created and read per run after S1 alone, the loop-level causes above are weaker
  than claimed and S3 shrinks to its consumer part.
- S2 (persistence by default): with top-level defs persisted as importable scripts, a function is re-defined at most
  once per level (baseline: g61-2 retyped the per-move diff in 26 of 46 cells; ls20-r03b `find_block` 14×) and
  persisted names are imported or called in later cells (baseline: 5 component calls across all su15 runs).
- S3 (skills with a consumer): at level-change and stall events where the refiner or review judges a procedure
  applies, a skill directory is written and is shown or read at its trigger in the next level; prompt-file edits per
  level fall, and with them the uncached-prefix share of the budget (chm: ~65% uncached after prompt edits).
- Benefit (reported separately, never implied by adoption): level-2+ completion and total cost on the same model
  against the previous pair (lessons.md forks: qwen 0/3, gpt-6.1-sol 4 levels).

### Burden removed

- The save decision and the "promotion later" decision (S2): writing the analysis is persisting it.
- The hidden rule "saved tools run without the namespace" (S2): components import the same scripts cells use.
- The parent's authoring of procedures (S3): reviews and the refiner produce them from events, on the agent's own
  model; the parent judges applicability when the skill is shown.
- Prompt-file churn in the system prompt (S3): procedures leave the cached head.

### Applicability, justified non-use, refutation

- Applies to levels after the first and to runs long enough to repeat work (≥ ~40 actions). On a run where no
  function is defined twice (qwen's comment-only python), S2 has nothing to persist: justified non-use, measured as
  defs per run, not a refutation.
- Refuted if: retyping does not fall with persisted scripts available (S2); skills are created but never shown/read
  at their trigger (S3, a dangling artifact — the trigger mapping failed); or scripts/skills inflate (CH's risk) past
  the cap without reuse.

### Scope and non-goals

- In scope: prompt text and the refiner's kind definitions (S1); default persistence of cell defs (S2); skill
  creation by the refiner and reviews with an event trigger, lenient binder, resident descriptions (S3); optional
  consumption through Pi's resource loader (S5).
- Not in scope: new subagent roles, a new execution interface, CH's parallel synthesis, renaming `prompts/`,
  changes to arc_action, offline evaluation routes. Game-specific content stays in the run's workspace; the framework
  gains no ARC knowledge.

## Design and cost

### The taxonomy the prompt and the refiner would state (S1 text, S2/S3 mechanisms)

- **Prompts (rules)**: `prompts/<name>.md`, `active: true|false`; standing instructions and the plan, applied every
  decision from the next one. Placement: how you work, not what you found.
- **Memory**: what you have found to be true of this game and how sure — facts (key, text, confidence) and hypotheses
  with `check(t)`; shown every decision; write what a later decision would otherwise lose.
- **Scripts** (S2): functions you define in python persist as `lib/<name>.py` (description from the docstring) and
  are importable in later cells and in any component; nothing to save.
- **Skills** (S3): `skills/<name>/SKILL.md` (frontmatter `name`, `description` saying what it does and when it
  applies, optional `metadata.trigger`) with its scripts beside it: a procedure with judgment steps — which scripts to
  run, what to check, what the result decides. Shown at its trigger event; otherwise its description is resident and
  the body is read when a step matches.
- **Hooks**: code the runtime runs for you — a view after each new state (output shown), `predict(state, action)`
  before each action (scored), `check(t)` on each transition (with its hypothesis). Said once, identically to the
  agent and to the refiner (today the agent is told "no args ⇒ view" and the refiner "`# view: on`").
- **Subagents**: `agents/<name>.md` (description, tools) answering `consult(agent, question, refs)` in its own
  context; never acts. Limits (rounds, time, output tokens) stated in the consult tool description.
- **Tools**: only a callable with arguments that you will call by name (`def run(args, env)`); rare. Contract text
  lives in the python tool description (it already does: `demo/arc_thin_extension.ts:3521`), not in the system prompt.

### Stages (one main factor each)

- **S0 — baseline from existing runs (no runtime change).** Per run and level: python cells; cells with top-level
  defs; distinct def names and re-definitions; repeated families (`repeatedWork`); saves; tool calls; views shown;
  file reads of components; refiner edits by kind; prompt-file versions; levels; parent+child tokens; uncached share.
  Sources: `python_calls.jsonl`, `component_runs.jsonl`, `.harness/components.jsonl`, `refiner.jsonl`,
  `call_points.jsonl`, `trajectory.jsonl`. Comparator runs: su15-g61-1 (historical best), the lessons forks, chm.
- **S1 — canonical kind definitions (text).** Rewrite the five bullets as the taxonomy above (without S2/S3
  mechanisms the agent cannot yet use), align `REFINER_SYSTEM`'s kind text, drop line 12's duplicated contracts.
  Resident size: no increase over the current 3903 chars. Expected result: no skills (the test of the user's
  hypothesis).
- **S2 — persistence by default.** A cell's top-level `def`s are written as `lib/<name>.py` by the runtime after the
  cell runs (mechanical; dependencies resolved through lib imports; a later def of the same name is a new version);
  the HARNESS index lists scripts compactly (name + docstring line) or the session view does; `save=` stays for an
  explicit view/predictor/tool. Retirement: a script unused since a level change is `stale`; the refiner may retire
  it at the next level change (existing status and edit path). Cap: scripts above N (to set from S0) are listed by
  name only.
- **S3 — skills with a consumer.** (a) Refiner: the event→kind rule is explicit and includes skill when the edit is
  a procedure; one edit per event stays, but a skill edit may carry `SKILL.md` plus its scripts (multi-FILE reply in
  one skill directory). (b) Reviews: the level review and stall review emit the procedure as a skill with
  `metadata.trigger: level_start` / `stall` and the facts as memory; `lessons.md`/`review.md` keep only what is not a
  procedure or are retired (decide from S0: what in them was procedural). (c) Consumer: at the first decision after
  a trigger event the runtime shows the matching skill's body once (push); otherwise its description is resident
  (pull). (d) Binder: Pi-style leniency (warn and load with defaults; refuse only an empty body); the index keeps
  descriptions resident when over budget, dropping usage text first. (e) Canonical authoring rules from
  skill-creator (description = what and when; imperative body; scripts for deterministic work; keep lean) go into
  the refiner's and reviews' instructions, not into the resident prompt.
- **S5 — consumption through Pi (optional, after S3 shows skills exist).** Register the workspace `skills/` as a Pi
  skill path and `reload()` after a skill save so Pi advertises name/description/path natively; verify first against
  the pinned 0.87.0 extension API (`ResourceExtensionPaths.skillPaths`, `ResourceLoader.reload`). If mid-session
  reload is unavailable, keep the binder index.

### Lifecycle (who advances each transition)

opportunity (a repeated computation; a level change; a stall) → recognition: runtime, mechanical (`repeatedWork`,
events) → investment: S2 none (persist on run); S3 the refiner or review on the agent's model → candidate: `lib/<name>.py`;
`skills/<name>/` → assembly: binder, mechanical → semantic use: the agent (imports a script in a cell; follows a shown
skill; reads one whose description matches) → feedback: `component_runs.jsonl` (imports/calls), `call_points.jsonl`
(skill shown/read), usage counts in the index → retain/revise/retire: refiner at level change by usage (stale status),
agent at any time (delete or `_off/`). Justified non-use: no repeated work on a level; a skill whose trigger never
fires again.

### First-benefit path

S2: define a function once (decision n) → next decision's cell imports it (one less re-derivation); no parent decision
added. S3: level change → review writes the skill (existing review turn, output form changed) → first decision of the
next level sees the procedure once → the agent follows or discards it; the only parent decision is the one it already
makes at level start.

### Added and removed

- Added: S2 one runtime write per cell with defs and index lines; S3 one push of a skill body per trigger event,
  `metadata.trigger`, multi-FILE refiner reply, lenient binder. No new resident obligation, field on arc_action,
  gate, worker or management turn.
- Removed: the `save=` decision for reuse; the namespace/saved-component split; prose procedures from the system
  prompt (and their cache invalidation); the duplicated tool contract in the system prompt.

### Permission, version, environment boundaries

Unchanged: `data/` and `results/` read-only; every write versioned; `env.restore`; subagents cannot act or write;
arc_action untouched; budget and refusal handling as today. S2's runtime writes go through the same binder save path.

### Abandonment and recovery

Each stage is a flag, default off until its pair shows the claim; a stage that fails its refutation condition is
turned off and recorded here. Scripts and skills are files: retiring them is deleting or moving under `_off/`.
Environment history is not recoverable; forks start from the saved snapshot as before.

## Pre-run experiment protocol

- Evidence level targeted: adoption (S2, S3) and cost; benefit reported separately and not claimed from adoption.
- Main variable and comparator: one stage per pair, same model, same game (su15), fork from the same snapshot where
  the stage's event can fire (a level-2 start for S3); comparator: the current r04 default. Other differences: none
  intended; record any.
- Models: gpt-6.1-sol (the harness-carrying model; su15-g61-1 as the historical best) and qwen3.8-27b (the weak
  model; separates model limits from mechanism). Reasoning as in the comparator run. Provider: yibu.
- Samples: 2 pairs per model per stage (exploration), a third only if the two disagree. Order: S1 (cheap) → S2 → S3.
- Budget and stop: the user sets the per-run token budget (previous pairs ~3M per run); the ARC cap as today; a
  yibu repeated-call refusal or length loop aborts the run and is recorded, not counted.
- Metrics: adoption — re-definitions per level, imports/calls of persisted names per decision, skills created and
  shown/read at trigger, prompt-file versions per level; cost — parent+child tokens, uncached share, decisions per
  level, latency; task — levels completed. Accepted degradation: +10% tokens for S2 if retyping halves; none for S1.
- Negatives: a run with no repeated work (S2 nothing to persist); a level without a stall or review event (S3
  nothing to produce); a skill shown but discarded by the agent with a stated reason (justified non-use); inflation
  past the cap; a stale skill from level 1 shown at level 2 and harmful (record and retire).
- Telemetry present: `python_calls.jsonl`, `component_runs.jsonl`, `components.jsonl`, `refiner.jsonl`,
  `call_points.jsonl`, `trajectory.jsonl`, usage. Missing: import/call attribution to persisted names (S2 adds it);
  skill shown/read events (S3 adds a `call_points` kind).

## Implementation and verification

Built 2026-10-21 on `claude/r04-components-20261021` (from `claude/r04-20261017` at `9a5e0536`), one commit per stage,
no run of any kind (no model request, no ARC run, no fork). Every stage is behind its own flag, **default off**
(`ARC_THIN_KINDS=canonical` for S1, `ARC_THIN_PERSIST_DEFS=1` for S2, `ARC_THIN_SKILLS=1` for S3); with all flags off the
runtime is unchanged and the existing suite gives the base commit's result. This file is untracked in the r04 worktree;
the copy this branch started from is byte-identical to it at the time (SHA-256 `082E4495…E03B`), so the r04 session can
drop its untracked copy before merging.

### Commands and environment

- Suite: `node --experimental-transform-types --test --test-concurrency=1 tests/arc_thin_*.test.ts` (every
  earlier report in this repository uses `--experimental-transform-types`; the brief's `--experimental-strip-types` stops
  every file at `demo/arc_thin_binder.ts:51` with "TypeScript parameter property is not supported in strip-only mode" on
  this machine's Node 25.5.0). Runner side: `python -m pytest tests/test_components_baseline.py tests/test_arc_thin_skills_reviews.py
  tests/test_arc_thin_level_review.py tests/test_arc_thin_stall_review.py tests/test_arc_thin_work_memory.py
  tests/test_arc_thin_lifecycle_stats.py tests/test_arc_thin_loop_bound.py tests/test_arc_thin_recovery.py
  tests/test_arc_thin_request_accounting.py` (44 pass at the S3 commit; the two review files and the work-memory file are
  the ones that call the functions S3 changed).
- **Base result on this machine, before any change** (pristine checkout of `9a5e0536`, Node 25.5.0, 691 s): 255 tests,
  250 pass, 5 fail — `arc_thin_activation.test.ts:41` ("saved code acts in a closed loop"), `arc_thin_components.test.ts:181`
  ("python session never stores runtime objects…") and `arc_thin_receipts.test.ts:8`, `:28`, `:44`. They fail the same
  way at the work-memory record's base (`docs/plans/2026-10-20-work-memory.md`, "five fail the same way at the base:
  activation 1, components 1, receipts 3"). I did not cause them and did not touch what they test.
- **The full suite after each stage** (sequential; the same five failures every time, none new):

  | after | tests | pass | fail | seconds |
  | --- | --- | --- | --- | --- |
  | base `9a5e0536` | 255 | 250 | 5 | 691 |
  | S1 (`46dcbb24`, with the merged `3ff04b13`: +2 tests) | 261 | 256 | 5 | 701 |
  | S2 (`393ab527`) | 268 | 263 | 5 | 756 |
  | S3 (the tree that became the S3 commit) | 277 | 272 | 5 | 723 |

  The S1 row was run in this worktree before S2 was started, the S2 row in a spare detached checkout at the commit (so that
  edits in progress could not race the run), the S3 row in this worktree with the code files unchanged during the run (only
  the plan record was written). Outputs are under `tmp/test-*-full.txt` (untracked).
- Tests of each stage are listed under its heading below.

### S0 — baseline from existing runs (done; no runtime change)

Entry point: `tools/components_baseline.py` (read-only on `runs/`; `--runs-root D:\autoresearch_pi_project\runs` from a
worktree; `--all` scans every run; `--prompts` prints the saved versions of the review files; `--out` writes UTF-8).
Sources per run: `pi-events.jsonl` (the parent's python cells and reads, action receipts for the level),
`harness/{python_calls,component_runs,observer_runs,refiner,call_points,trajectory,usage}.jsonl`,
`.harness/components.jsonl`; a missing file is listed as missing, not counted as zero (the lessons and earlier runs have
no `python_calls.jsonl` or `call_points.jsonl`: their cells come from `pi-events.jsonl`). Test: `tests/test_components_baseline.py`
(2 pass). Artifacts: [per run and level](../reports/2026-10-21-components-baseline-s0.md),
[all 105 runs](../reports/2026-10-21-components-baseline-s0-corpus.md),
[the review files' saved versions](../reports/2026-10-21-components-baseline-s0-reviews.md).

Per run (the plan's comparators: `su15-g61-1`, the four lessons forks, `chm`; and the other arc-models runs).
Retyping = cells per level that repeat an earlier cell exactly / repeat it with other numbers / retype a run of five or
more of its lines / reuse a statement of 40+ characters, numbers ignored. Saved = tools/lib/skills/agents. Uncached =
input ÷ (input + cache_read) of the agent's requests.

| run | model | actions | levels | cells | with defs | re-defs | retyping | families 2+/3+ | saved | saved-tool calls | view runs | reads of components | refiner edits | prompt versions | uncached |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| arc-models/su15-g61-1 | gpt-6.1-sol | 206 | 4 | 17 | 0 | 0 | 0/0/0/0 | 0/0 | 2/0/0/0 | 0 | 0 | 0 | memory 4, prompt 17 | strategy 18 | 0.85 |
| arc-lessons/su15-lr-g61 | gpt-6.1-sol | 266 | 4 | 5 | 0 | 0 | 0/0/0/0 | 0/0 | 1/0/0/0 | 0 | 0 | 0 | memory 4, prompt 18 | lessons 6, strategy 24 | 0.71 |
| arc-lessons/su15-lr-1020-q38 | qwen3.8-27b | 236 | 1 | 24 | 1 | 0 | 10/2/4/5 | 3/3 | 0/0/0/0 | 0 | 0 | 0 | prompt 28, memory 1 | strategy 17, rules 12, lessons 3 | 0.24 |
| arc-lessons/su15-lr-cb-q38 | qwen3.8-27b | 223 | 1 | 46 | 1 | 0 | 17/0/4/7 | 2/2 | 1/0/0/0 | 0 | 157 | 0 | prompt 21, memory 5, tool 1 | rules 15, strategy 22, lessons 10 | 0.28 |
| arc-lessons/su15-lr-p13-q38 | qwen3.8-27b | 84 | 1 | 47 | 1 | 0 | 23/0/8/11 | 2/2 | 0/0/0/0 | 0 | 0 | 0 | prompt 31, memory 3 | rules 25, strategy 4, lessons 3 | 0.39 |
| arc-chm/su15-chm-q38-1 | qwen3.8-27b | 110 | 0 | 128 | 0 | 0 | 70/15/3/9 | 5/3 | 1/0/0/0 | 0 | 68 | 0 | memory 3, prompt 8, tool 3 | strategy 10, rules 3, review 6 | 0.18 |
| arc-models/su15-g61-2 | gpt-6.1-sol | 151 | 2 | 59 | 0 | 0 | 0/3/0/5 | 3/1 | 1/0/0/0 | 2 | 0 | 2 | memory 6, prompt 15 | rules 2, strategy 15 | 0.83 |
| arc-models/su15-g56-1 | gpt-5.6-sol | 281 | 1 | 12 | 0 | 0 | 0/0/0/0 | 0/0 | 1/0/0/0 | 0 | 81 | 0 | prompt 16, memory 1, tool 1 | strategy 16 | 0.89 |
| arc-models/su15-g56-2 | gpt-5.6-sol | 238 | 1 | 11 | 0 | 0 | 0/0/0/1 | 0/0 | 2/0/0/0 | 0 | 0 | 1 | prompt 18, memory 6 | strategy 21 | 0.90 |
| arc-models/su15-q38-1 | qwen3.8-27b | 267 | 2 | 173 | 0 | 0 | 0/4/10/15 | 6/5 | 1/0/0/0 | 0 | 0 | 0 | prompt 25, memory 3, tool 1 | strategy 28, rules 2 | 0.23 |
| arc-models/su15-q38-2 | qwen3.8-27b | 231 | 1 | 149 | 0 | 0 | 11/4/1/12 | 8/6 | 1/0/0/0 | 0 | 218 | 0 | memory 4, prompt 19, tool 2 | rules 3, strategy 13 | 0.27 |
| arc-models/su15-q38-3 | qwen3.8-27b | 110 | 0 | 84 | 0 | 0 | 0/1/3/12 | 1/1 | 1/0/0/0 | 0 | 106 | 0 | tool 1, prompt 12, memory 1 | strategy 9, rules 3 | 0.31 |

What the table and the all-runs scan show (measurements; the per-level table with prompt versions per level, levels
counted from 1, is in the first artifact):

1. **No skill, no `lib/` script and no import of a saved component in any of the 105 runs on record** (12 comparators
   above; across all 105: 0 skills, 0 lib scripts, 0 `import tools.x`/`lib.x` in a cell, 33 saved tools, 5 calls of a
   saved tool by name, 5 `read` calls of a component file, 2 runs with an `agents/` file — the `reviewer.md` of the A5
   call point). The refiner's edits are memory, prompt and tool only; prompt edits dominate (8–31 per run; `strategy.md`
   up to 28 versions, 13 of them on one level of `su15-g61-1`).
2. **Top-level `def` statements are rare in the current harness generation and absent for GPT.** All 105 runs: 5,675
   python cells, 294 (5.2%) with a top-level def, 160 re-definitions of an earlier name. Batches from 2026-10-19 on
   (20 runs): 1,482 cells, **16 (1.1%)** with a def, 7 re-definitions in 2 runs. Earlier batches (85 runs, all qwen3.8-27b):
   4,193 cells, 278 (6.6%), 153 re-definitions in 21 runs; the most re-defined names are `snap` (39), `load_grid` (29),
   `diff` (17). **The six GPT runs (gpt-6.1-sol ×3, gpt-5.6-sol ×3, 115 cells) define no function at all.**
3. **Retyping in the comparators is mostly whole cells and inline statements, not functions**: `chm` repeats an
   earlier cell exactly 70 times and with other numbers 15 times in 128 cells; `su15-lr-p13-q38` level 2 repeats 23 of
   44 cells exactly; the per-move difference loop appears as a single comprehension statement (`su15-q38-2` level 2:
   family of 8, `diff=[(x,y,prev_grid[y][x],grid[y][x]) for y in range(64) …`). **The plan's baseline "g61-2 retyped the
   per-move diff in 26 of 46 cells" (from `docs/plans/2026-10-20-loop-bound-artifacts.md`) is not reproduced**: on the
   same run S0 finds 59 cells, 3 repeated with other numbers, 5 reusing a long statement, 0 exact repeats, 0 five-line
   runs, one family of 3 (`a=history.grid(68); b=history.grid(69); d=[(x,y,a[y][x],b[y]…`). The earlier figure comes
   from an analysis whose cell selection and criterion are not in the repository; the S2 pair has to use this script's
   measures, not that figure.
4. The work-memory runtime (`9a5e0536`: cell addresses, `cell(k)`, the same-state cache) post-dates every run in the
   table, so exact repeats may fall without S2; they are the largest retyping category above.
5. The plan's "chm: ~65% uncached after prompt edits" is not reproduced here and not contradicted: S0 reports the run's
   share of agent prompt tokens that were uncached (chm 0.18, qwen runs 0.18–0.39, GPT runs 0.71–0.90 by the usage
   convention of `appendUsage`); attributing uncached tokens to the decisions that follow a prompt-file edit needs a
   per-decision alignment S0 did not do.

**Consequence for S2 (a finding, not a decision):** S2 as specified persists top-level defs. In the runs it would be
tried on, defs are ~1% of cells and zero for GPT, so most of the retyping above would not be touched by it. Whether the
canonical text of S1/S2 raises the rate of defs is itself the first thing the S2 pair has to show ("defs per run" is the
leading indicator; no defs is justified non-use, as the plan's applicability section says). Extending S2 to repeated
inline statements is outside the plan and not done.

**S3(b) decision — what in the review files was procedure and what was facts** (a reading of the 28 saved versions of
five runs in the third artifact — a judgment, not a measurement). Every `lessons.md`/`review.md` is made of four kinds of
lines: (i) *findings* — what won, what moved progress, mechanics, what was tried and shown, rejected win conditions
(facts and hypotheses with a status; most of every file); (ii) one *pattern* sentence per file that is a procedure
("merge matching pieces into the required colour, then deliver it to a mark", "click the dots in order from the movable
end to the target"); (iii) *wasted/pitfalls*, negative procedure ("do not re-test known objects"); (iv) *candidates for
the next level*, a plan. Only (iv) has a runtime consumer (the `- test:` lines are pinned as the next experiment), and
the line form it needs is in 1 of the 8 final review files of the whole corpus and in none of the five comparator
files; the other kinds are resident in every decision as active prompts, and each rewrite is a system-prompt edit.
Decision: with `ARC_THIN_SKILLS=1` a level or stall review writes the procedure (ii + iii) as a skill, the findings (i)
as memory, and `prompts/lessons.md` / `prompts/review.md` keep only the `- test:` lines (iv). A level won without a
repeatable procedure produces no skill (justified non-use).

Evidence level reached by S0: reads existing runs; it establishes baselines and removes none of the unverified layers.

### S1 — canonical kind definitions (flag `ARC_THIN_KINDS=canonical`, default off)

Entry points and actual behavior:

- `demo/prompts/arc_thin_native_kinds.md` (new) and `demo/arc_thin_kinds.ts` (new). With the flag, the five-bullet block
  of the native system prompt (Prompt, Memory, Tool, Skill, Subagent) is replaced, inside the unchanged template
  (`canonicalSystemTemplate` swaps only the block, so nothing outside it can drift), by seven bullets in the plan's order:
  Prompts, Memory, Scripts, Skills, Hooks, Subagents, Tools. Line 12's tool contract is gone from the prompt: the python
  tool description already carries save / view / predict / called-by-name / names persist / saved tools run without the
  namespace (`demo/arc_thin_extension.ts`, the `python` tool); what it did not carry moved to where it belongs — `'# view:
  off'` and predict's return shape to Hooks, "who can act" to Tools, `check(t)`'s True/False/None stays in the memory
  tool's `check` description. Dropped on purpose: the "rewritten at each level change" / "written when it has gone long"
  clauses on lessons.md and review.md (the review prompts say it when they ask) and the Tool bullet's namespace sentence.
- `demo/arc_thin_kinds.ts` `canonicalRefinerSystem`: `REFINER_SYSTEM`'s kind list and its paragraph on views are
  replaced by the same statements. The agent and the refiner now use one sentence for views (`VIEW_RULE`: saved code
  with no args that does not act, or `# view: on`, `# view: off` keeps a tool, run after each new state, output shown at
  each decision) and one for predictors (`PREDICT_RULE`); before, the agent was told "no args ⇒ view" and the refiner
  "`# view: on`". The rest of the charter (reply formats, check fields, ledger) is the legacy text.
- `demo/arc_thin_refiner.ts`: `REFINER_HEAD`, the side-call classifier's anchor (it compared against the whole legacy
  charter, which the canonical one no longer starts with in full). `demo/prompt_loader.ts`: `renderPrompt(name, values,
  template?)`; two-argument calls are unchanged.
- `demo/arc_thin_native_runtime.ts`: `CONSULT_ROUNDS` / `CONSULT_TOKENS` / `CONSULT_MS` replace the literals 6, 1024 and
  120000 of `consult()` (same values), and with the flag the consult tool's description states them ("It answers within 6
  model rounds of at most 1024 output tokens each and 120 s.") — the plan's "limits stated in the consult tool description".
- `src/autoresearch_pi/arc_thin_e2e.py`: `canonical_kinds` in `run-config.json`.
- Mechanisms are named only when their stage is on: this commit passes `persist: false, skills: false`, so the Scripts
  and Skills bullets describe what exists today (`lib/<name>.py` written by hand and imported; a skill listed under
  HARNESS and read). S2 and S3 switch their own sentences on in their commits.

Size (the constraint: the native system prompt must not grow). The brief's 3,903 characters is the 2026-10-16 figure; this
tree renders more, so the comparison is against today's render of the same fixture
(`tests/arc_thin_kinds.test.ts`, `ARC_THIN_OBSERVATION=query`, LF line ends):

| configuration | flags off | `ARC_THIN_KINDS=canonical` |
| --- | --- | --- |
| whole system prompt | 4,355 | 4,265 (−90) |
| whole system prompt, `ARC_THIN_LEAN=1` | 4,029 | 3,956 (−73) |
| capability block, S1 only | 1,545 | 1,455 (−90) |
| capability block, S1 + S2 text | 1,545 | 1,449 (−96) |
| capability block, S1 + S3 text | 1,545 | 1,527 (−18) |
| capability block, S1 + S2 + S3 text | 1,545 | 1,521 (−24) |
| same four, lean (no Subagents bullet) | 1,358 | 1,285 / 1,279 / 1,357 / 1,351 (−73 … −1) |

The first draft was 70–106 characters over in every configuration with S3 text; the Skills sentence was cut back to
what/when plus trigger (authoring rules belong to the refiner and review instructions, S3(e)), and the S2 sentence to one
clause. Skill-authoring text is not in the resident prompt.

Checks: `tests/arc_thin_kinds.test.ts` — 4 tests, all pass: (1) the block names the seven kinds in order and everything
outside it is the legacy template (with and without the Subagents bullet); (2) through the real extension: the rendered
system prompt has the canonical block, no `save="name"` sentence, nothing about S2/S3 mechanisms, is no longer than the
legacy render, the consult description carries the limits only with the flag, and the refiner's model call (triggered
by the `refine` tool, read and never answered) receives the legacy charter without the flag and the canonical one with it;
(3) the canonical block is no longer than the legacy block for every combination of consult / S2 text / S3 text, and
persistence / trigger sentences appear only with their flag; (4) the agent's Hooks line and the refiner's charter contain
`VIEW_RULE` word for word, and the legacy charter is untouched. `tests/arc_thin_coverage_events.test.ts` (the legacy
five-kind and lean assertions) passes unchanged, 3/3.

Flags off = unchanged, measured rather than argued: the same rendering script run in a pristine checkout of `9a5e0536`
and on this branch gives identical SHA-256 (first 16 hex digits) for the system prompt `63392d9274de6377`, the consult
description `8120321034dcf591`, the active-tool set, the prompt sections `44136fa355b3678a` and the full list of tool
names and descriptions `6fc1973bb8b63722` (lean: `cba329a21d7d665e` / `ef59cf581effd3bb`), and for `REFINER_SYSTEM`
(4,598 characters, `a1ad10938337cf3d`) and `REFINER_LEDGER_SYSTEM` (673, `462d238427415f7a`). With the flag only the system
prompt, the consult description and the refiner's charter differ. Full suite after S1 (`--experimental-transform-types`,
sequential, 701 s): 261 tests (255 at the base + the 4 new + the 2 that came with the merged `3ff04b13`), 256 pass, 5 fail,
the same five as the base (activation:41, components:181, receipts:8/28/44). Runner side
(`tests/test_components_baseline.py`, `test_arc_thin_{work_memory,stall_review,level_review,loop_bound}.py`): 16 pass.

Evidence level reached by S1: functional correctness only. Reachability is shown to the extension's own prompt and
refiner call under a stubbed provider (a test double), not through `arc-harness-smoke`; no model has read this text.

### S2 — persistence by default (flag `ARC_THIN_PERSIST_DEFS=1`, default off)

Entry points and actual behavior:

- **Detection, in the sandbox** (`demo/arc_thin_components.ts`, the python session dump). The host is TypeScript and cannot
  read Python, so the guest, which already knows which functions a cell defined or redefined (the object's identity
  changed), reports each *direct top-level* `def` (`cell_defs`): source, parameters, one description line (docstring, else
  the comment above it or its first comment), and for every name the function reads that nothing inside it binds — built-ins
  and the five names a module is given (state, grid, history, prev_grid, artifacts) aside — where it comes from, found in
  the live session: a module (`import math`), an imported object (`from collections import deque`, `from lib.x import x`),
  another function of the session (a dependency), or only the session (a value such as `OFFSET`, `env`, `show`). Only with the
  request key `persist_defs`: flag off, nothing is computed and the report has no new field.
- **Planning, pure** (`demo/arc_thin_scripts.ts`, new): a function becomes a script when everything it uses is built in, an
  import, or a script (an earlier one, or one of this cell's that is, in dependency order); otherwise it stays in the session
  and the cell's result says why, once (`it uses OFFSET, defined outside it (define it inside, or pass it in)`, `it calls x,
  which is not saved as a script`, decorated / async / assigns a global / name not lowercase snake_case). The module is a
  description line, the runtime's mark `# saved by the runtime from your python cell`, the import lines (the cell's own
  imports the function needs, `from lib.<dep> import <dep>`), then the source. Rules: the last definition of a name in a
  cell stands; an identical file is left alone (the work-memory record counted 95 of 129 re-definitions identical to the one
  they replaced; those give the same file unless the names the function reads changed); a `lib/<name>.py` without the mark is the agent's own and is never replaced; a script that would import one
  that already imports it is refused (a cycle at import time); at most 40 scripts a run.
- **Writing** (`demo/arc_thin_native_runtime.ts`): `workspace.mutate` + `binder.save`, i.e. the binder's own save path with kind
  `library` (validated, versioned, restorable with `env.restore`); `save` rows as for any file; one `persist` row per cell
  (`defined`, `saved`, `unchanged`, `skipped`); one line in the cell's result per change (`(saved as scripts: lib/hyp.py v1,
  lib/norm.py v1; import lib.<name> in a later cell or in saved code)`). It runs before the call record is stored, so the
  work-memory same-state cache of the very call stays valid. `save=` is untouched.
- **Adoption** (`import` rows in `component_runs.jsonl`: `imported` = by statement, `named` = by the name the session
  already held, only for scripts that existed before the cell): a cell that defines and calls a function in one breath is not
  adoption. The extension turns the rows into the index's usage text (`used in N cell(s) since saved at #n`), into the
  "ran without helping" line of a refine point (a script unused for `REFINE_EVERY` actions), and into the level's `used`
  set. `run-config.json` records `persist_defs`.
- **Listing** (`demo/arc_thin_binder.ts`, option `scripts`): HARNESS gains `script hyp(a, b) v1 active: length of the
  hypotenuse · import lib.hyp · used …` lines (header "your prompts, tools, scripts, skills and subagents"), the first 8 in full
  and the rest by name on one line. `stale` is the existing status (saved on an earlier level), except that a script imported
  or used on the current level is `active`. Without the option libraries stay out of the index, as before. The session view
  (`PYTHON SESSION …`) is unchanged: it lists what is live, the index what is saved. Retiring is the agent's, as for any file
  (delete it or move it under `_off/`); the refiner's FILE replies cannot delete, and I added no path for that.
- **Text**: with both `ARC_THIN_KINDS=canonical` and this flag the Scripts bullet says "functions you define in python persist
  as lib/<name>.py (import lib.<name>)"; without this flag it describes hand-written scripts.

Checks (`tests/arc_thin_scripts.test.ts`, 7 tests, all pass; the sandbox tests drive the real guest through `NativeRuntime`):
(1) the planner on the cases above, pure; (2) `scriptsUsed`; (3) a cell with `hyp`, `norm` (calls `hyp`) and `shifted`
(reads `OFFSET`) writes `lib/hyp.py` v1 and `lib/norm.py` v1 with the exact module text, leaves `shifted` in the session
with the reason, uses the docstring as the binder's description, logs two `save` rows and one `persist` row, and says
nothing the second time the same functions are defined in a cell that runs; (4) a later cell importing `norm` and calling
`hyp` by name prints 2.5 and 10.0 (the saved module imports `hyp` from its own) and logs one `import` row
(`imported: [norm]`, `named: [hyp]`), while a cell that defines and calls `twice` logs none; (5) the same name with other code
is v2, the same code again is not a new version, and a hand-written `lib/mine.py` is not replaced; (6) flag off: no files,
no note, no `persist`/`import`/`save` row; (7) the index lines, the cap, the stale rule. A first draft of (3) and (5) passed
vacuously, because an identical cell is answered from the same-state cache without running; the cells now differ by a
print so the definition really runs again.

What S2 does not do (limits, not defects found): (a) free names are found by walking the function's AST, not by
`symtable`: a name bound only inside a nested scope but read outside it counts as bound, so such a script would fail at
its first call with a NameError (visible; fixable by the agent). (b) Values are not captured: a function reading a
module-level constant is skipped, not rewritten. (c) Only the parent's own cells are scanned; a consult's python and the
bodies of saved tools are not. (d) Calls of a script from a saved tool or view are not counted as use. (e) The S0 corpus
says the input is small (1.1% of cells define a function in the 2026-10-19+ batches, none for GPT): a run in which no
function is defined has nothing to save, which the plan counts as justified non-use.

Evidence level reached by S2: functional correctness only, on the real sandbox but with no model, and not through
`arc-harness-smoke`. Whether a model defines functions more often once the text says they persist (the leading indicator in
the plan's protocol: defs per run, then imports per decision) is unverified.

### S3 — skills with a consumer (flag `ARC_THIN_SKILLS=1`, default off)

Entry points and actual behavior:

- **Consumer, push** (`demo/arc_thin_skills.ts`, new; wiring in `demo/arc_thin_extension.ts`). A skill whose frontmatter says
  `metadata: {trigger: level_start}` or `{trigger: stall}` is shown in the head of the first decision after its event: the
  first decision of each level (event `level:<levels completed>`), or the first after a stall review (`stall:<actions>`).
  Active skills with a trigger whose last shown event is not this one are *due*; newest version first, at most 2
  (`SKILL_PUSH_MAX`); the head carries `SKILL <path> v<n>, shown once for level <n+1> | after the stall review just made (read
  <path> again when a step matches; whether it applies now is yours to judge): <description>` and the body clipped to 1,500
  characters. Position: with the context layout (the default since `3ff04b13`) it closes the head, in the last text block, just
  before the agent's own board record, because in the copy-attractor runs (`chm`, memory note of 2026-10-21) text that opens or
  fills the head changed nothing and only tail text changed behaviour; a "does the agent follow a pushed skill" pair should not
  be decided by where the push sat. With `ARC_THIN_CONTEXT_LAYOUT=0` it follows the prompt files. A review (level, stall,
  consolidate) shows none.
  A push counts as *shown* only when the model answered the decision (a non-error assistant `message_end`): the `skill_shown`
  row (`call_points.jsonl`: path, version, trigger, event, decision) is written at the next decision's start or at shutdown,
  so a decision the provider never answered leaves the skill due. The stall review's own start is a `stall_review` row (its
  action count is the event's id). State is read back from those two kinds of row at start, so a restart or a fork neither
  repeats a push nor loses one. Because "due" means "not shown for this event", a skill written by a review after the level
  change is shown at the next decision, which is the first of the new level; a `level_start` skill the agent writes in
  mid-level is shown once right after it.
- **Consumer, pull.** Every skill's description stays in the HARNESS index (clipped at 200 characters, 120 for other kinds);
  a `read` of `skills/<name>/…` is logged as `skill_read` (path, version, whether in a review, whether it had been shown), and the
  index line carries the counts (`shown N×, read N×`). The counts are the only feedback the runtime has for a skill: a pushed
  body is already in front of the agent, so "read 0×" is not idleness, and no "ran without helping" line is made for skills.
- **Binder** (`demo/arc_thin_binder.ts`, option `skills`): a SKILL.md is read as Pi reads one, "most invalid fields produce
  warnings" — no frontmatter, invalid YAML, no description, a name that is not the directory's, a trigger the runtime does not
  know, a description over 200 characters each load with defaults (the directory's name; the first body line; no trigger; the
  first 200 characters) and the write receipt says so (`(warning: …)`); only an empty body is refused. With the flag
  off the strict reading is unchanged (`description is required`, `skill name must match its directory`). The index
  (1,200-character budget) gives up detail in steps when it is over — usage text, then script lines, then prompt and tool lines
  to names, then the descriptions that remain are clipped (80, 50, 30) — and falls back to names only last; a skill line shows its
  trigger (`skill edge v1 active [level_start]: … · read skills/edge/SKILL.md`). Without the flag it is names only, as before.
- **Refinement** (`demo/arc_thin_refiner.ts`, `runRefiner`). The charter gains `refinerSkills()` (when a skill is the right
  edit, the reply format, rewrite a REFINED skill instead of adding a second, never replace the agent's) and the authoring rules;
  the input gains `THE KIND OF EDIT THE EVENT SUGGESTS (yours to decide)`, one line for each event class it recognises
  (`eventKinds`: a level reached → a skill for a procedure that would repeat, a rule for a confirmed goal, memory for a finding;
  python redone → a view, a function, or a skill; no goal test → the strategy; cells located by hand → a view; a stall → the
  strategy or a skill), and `SAVED SKILLS`. `NONE` remains an answer. A reply with several `FILE` blocks is one *skill
  directory* (`parseRefinerReply(text, {skills: true})`: `skills/<name>/SKILL.md` and up to four text, python or json files
  beside it, all under that directory; anything else is invalid; without the flag a second `FILE` is ignored as before). Before
  it is applied the reply goes back once, with the reason, through the existing returned-once mechanism, if the files are all
  the current ones, if a lone file beside a skill has no `SKILL.md`, or if the `SKILL.md` header would load without what it
  was written for (invalid YAML, no description, an unknown trigger, no frontmatter). Application is one edit: ownership is
  checked for every file (nothing is written if one would replace the agent's), the files beside the skill are written first,
  then `SKILL.md`; staleness is checked over all of them; `refiner.jsonl` has one `edit` row with `files`, and the agent's
  notice names the scripts added.
- **Reviews** (`src/autoresearch_pi/arc_thin_e2e.py`). With the flag the runner's two review prompts become the S3(b)
  decision: (1) a skill, with `metadata: {trigger: …}`, if the level (or the stall) shows a procedure that would repeat, else none;
  (2) the findings as memory; (3) `prompts/lessons.md` / `prompts/review.md` of at most 400 characters (was 1,200) holding
  only the `- test:` lines the runtime pins. The recovery prompts follow (`_review_recovery` picks them by content). The
  authoring rules (`demo/prompts/arc_thin_skill_authoring.md`, one paragraph: description = what it does and when it
  applies, quoted if it contains a colon; optional trigger; imperative body; deterministic work in a script beside it; one
  procedure per skill; findings are memory) are one file read by the runner and the refinement charter and by nothing
  resident. The reviews come only from the runner, as all review prompts do; the extension adds no review text.
- **Text and logs**: with S1 on, the Skills bullet states `metadata.trigger` and "shown once at its trigger, else read when a
  step matches" (sizes in the S1 section). `run-config.json` records `skills`. `tools/components_baseline.py` prints a
  "Scripts and skills" table (scripts saved, cells using one, skills shown, skill reads) for runs that have the S2/S3 rows
  and nothing for the rest, so the S0 report is unchanged.

Checks (all pass): `tests/arc_thin_skills.test.ts` — 9 tests: (1) weak headers load with defaults and a warning, a known trigger
is kept, only an empty body is refused, the strict reading with the flag off; (2) the index over its budget keeps clipped
descriptions with the flag and falls back to names without it; (3) the multi-`FILE` reply is one skill directory, six kinds of
reply are invalid, a lone file beside a skill needs the flag; (4) `dueSkills` and `eventKinds`, pure (an event is due once;
the next level, a stall, a disabled skill, a skill without a trigger); (5) through the real extension with a stand-in model
(a level is completed on a toy board, the refinement is settled with a skill-directory reply): the refinement's input has the
suggested kinds and `SAVED SKILLS`, the files are written, the edit row names them, the next head has the notice, the index
line with its description and trigger, and the push, the push is logged only after the decision is answered and not
repeated, a `read` of the skill is logged as read after it was shown, level 2 shows it again once and the refinement then sees
the skill listed; (6) a skill the agent writes in a stall review is shown once after it, and again after the next stall
review; (7) a header that would lose its trigger (an unquoted colon in the description) goes back to the refinement once and
the second reply is applied; (8) a restart does not repeat a push that was answered and does repeat one that was not, and a
stall review's skill written before a restart is shown once after it; (9) flag off: no push, no `skill_*` row, no skill
sections in the refinement's input, a skill-directory reply is read as the one `FILE` it always was.
`tests/test_arc_thin_skills_reviews.py` — 3 tests (the prompts, their recovery prompts, the flag's reading, the legacy prompts
unchanged). `tests/test_components_baseline.py` — one more (the adoption counts).
Flags-off identity, by hash (LF-normalised) in a pristine checkout of the base `9a5e0536` against this tree, same fixture:
the rendered system prompt, the consult description and the tool list are equal with all flags off, with S2 alone and with S3
alone; the refinement's charter is equal with all flags off and with S2 alone (S3 adds its paragraph only with the flag, 5,271
→ 6,582 characters of a side call's instruction); the system prompt with S1 + S3 is 4,337 characters and with S1 + S2 + S3 4,331,
against 4,355 flags off. The HARNESS index of a fixed set of components (prompts, tools, views, a failing tool, 2/8/14
scripts, skills, a subagent; four level / usage / used combinations each) is identical to the base's with no option and to the
S2 commit's with the S2 option, in all 12 cases each. Reading the diff of the unified index before that comparison had found two
differences from the earlier code (the "N more scripts" line sat after the last script instead of at the end, and a failed
tool's name came from a different field); they were fixed first, and the comparison then showed no difference.

What S3 does not do (limits, not defects found): (a) a colon inside an unquoted `description:` is not YAML; the lenient
reading loads the skill with the first body line and no trigger, and says so in the receipt (a refinement is sent back once for
it; an agent-written file is not repaired). (b) Only the `read` tool counts as a read of a skill; opening it from python is not
logged (no read telemetry exists for python at all). (c) The index's `stale` (saved on an earlier level) is the old status
word and also labels a skill at the level it is pushed. (d) Pi itself would not load a skill without a description; this binder
does, on purpose, and says so. (e) Pi-native consumption (S5) is not built: see the finding below. (f) The reviews' skill
instructions exist only in the runner's prompts. (g) The size of a push (two skills, 1,500 characters each) and its position
were chosen, not varied.

Evidence level reached by S3: functional correctness only, through the real extension and a stand-in provider, not through
`arc-harness-smoke` and not with a model. Whether a refinement or a review writes a skill, whether the agent follows one, and
whether any of it helps are unverified; this build removes the structural reason the old skills were never written for (no
event led to one, no consumer showed one), nothing more.

**S5 finding (not built; types and docs of the pinned Pi 0.87.0 only, nothing run):** an extension can contribute skill
paths: the `resources_discover` event fires after `session_start`, at startup and at reload, and its result may carry
`skillPaths` (`docs/extensions.md`, "Resource Events"); `ResourceLoader` has `extendResources({skillPaths})` and `reload()`
(`dist/core/resource-loader.d.ts`); `--skill <path>` loads even with `--no-skills`, which the runner passes in the launch
command (`src/autoresearch_pi/arc_thin_e2e.py`, next to `--no-extensions` and `--no-prompt-templates`). `reload()` for an
extension is `ctx.reload()` of the *command* context only (`ExtensionCommandContext`, a slash command's handler): it runs the
`/reload` flow, emits `session_shutdown` for the extension runtime and a new `session_start` and `resources_discover`
(`reason: "reload"`), and the docs say old in-memory extension state must not be assumed afterwards. This extension keeps its
run state in the factory's closure and the python kernel in a child process, so whether a reload from a tool or event handler
(which have no `reload`) could preserve a run is unverified, as is whether a running Pi re-reads a skill directory without
one. What the types support today is registration at startup (`resources_discover` or `--skill`), which would show skills
that exist before a run begins (forks) and not the ones made during it. This binder's index stays the consumer for those.

### Deviations from the design text above

1. **Test command**: `--experimental-transform-types`, not `--experimental-strip-types` (Node 25.5.0 here stops at a TypeScript
   parameter property in the binder under strip-only mode; the base fails the same way).
2. **System prompt size**: the brief's 3,903 characters is a 2026-10-16 figure; the tree renders 4,355 for the test fixture,
   so "no growth" is checked against that (S1 section). Every configuration with the flags is shorter.
3. **S2 retirement**: the plan has the refiner retire an unused script at a level change "through the existing edit path".
   The refiner's `FILE` replies cannot delete, and I added no path for it: a script unused for `REFINE_EVERY` actions is
   reported to the refinement as "ran without helping" and to the agent in the index; deleting or moving it is the agent's.
   Stale is the existing status (saved on an earlier level), except that a script used on this level is active.
4. **S2 scope**: only direct top-level functions of the parent's own cells, with everything they use built in, imported or
   already a script; a function that reads a session value stays in the session and the cell's result says why. 40 scripts a
   run, 8 listed in full (the plan said the cap was "to set from S0").
5. **S3(a)**: the event→kind rule is a *suggestion* in the refinement's input, one line for each event class, and `NONE`
   stays an answer, not a rule the refinement must follow. A skill reply is up to five files; two new checks send a reply back
   once (a lone file beside a skill with no `SKILL.md`, a header that would lose its trigger) and the existing "same file
   again" check covers every file of the directory. The plan lists none of these; they stop a dangling file and a skill the
   push could never show.
6. **S3(b)**: the review prompt files are not retired; they keep only the `- test:` lines (400 characters instead of 1,200),
   because those are the only part of them with a runtime consumer. The review instructions exist in the runner's prompts only.
7. **S3(c)**: at most two skills are pushed to a decision and a body is clipped at 1,500 characters; a push counts as shown
   when the model answered the decision, not when it was composed; and it sits at the end of the head (the tail block), not
   among the sections, a choice the plan leaves open and that the copy-attractor evidence argues for.
8. **S5**: not built; the finding is above.
9. **Added, not in the plan**: the "Scripts and skills" table in `tools/components_baseline.py` (the reader for the S2 and S3
   logs, which the pairs need), and tests beyond the plan's list for restart, header repair and the stall event.

| Evidence level | Status | Provider / environment | Artifacts and conclusion boundary |
| --- | --- | --- | --- |
| Functional correctness | S0 script (3 tests), S1 text (4), S2 persistence (7) and S3 skills (9 + 3 Python) pass; the full `tests/arc_thin_*.test.ts` suite equals the base result with every flag off (numbers below) | none: recorded runs (S0), a stubbed provider, a toy board and the real sandbox (S1–S3) | `tools/components_baseline.py`, `tests/arc_thin_kinds.test.ts`, `tests/arc_thin_scripts.test.ts`, `tests/arc_thin_skills.test.ts`, `tests/test_arc_thin_skills_reviews.py`, `tests/test_components_baseline.py` |
| Full-chain reachability | unverified. Each stage's text and mechanism is reached through the real extension and, for S2, the real sandbox, but with a stub in place of the model; `arc-harness-smoke` through the ARC bridge, a Pi parent loop and a real parent turn was not run (the standing acceptance rule for self-harness closure) | — | — |
| Autonomous adoption | unverified. Baseline only: 0 skills, 0 lib scripts, 0 component imports in 105 runs, 1.1% of python cells define a function (none for GPT) | — | `docs/reports/2026-10-21-components-baseline-s0*.md`; the leading indicators for the pairs are named in the protocol and in `tools/components_baseline.py`'s "Scripts and skills" table |
| Net benefit | unverified. No run, no cost or latency measure. What it adds, measured or by construction: nothing to the system prompt (S1, S2 and S3 text together are shorter than the legacy block); the refinement charter +1,311 characters and its input one line per recognised event and the skill list, per refinement call; each skills review prompt carries the authoring paragraph (about 650 characters), per review turn; a file write per cell with a function (S2) and one pushed skill body per event (S3) | — | — |

## Delivery decision

- Supported now: the analysis of why r04 creates no skills (records above); S0's baselines; and that S1, S2 and S3 each build
  and behave as specified under a stub provider, with every flag off equal to the base commit (hashes of the system prompt,
  consult description, tool list, refinement charter and HARNESS index; the existing suite's result). Not supported: that a
  model writes a skill, defines a function more often, imports a script or follows a pushed skill, and any benefit.
- Decision: the code is on the side branch `claude/r04-components-20261021`, four commits (S0, S1, S2, S3) and a merge of
  `3ff04b13` (the context layout), **every flag default off**; nothing is enabled in any run by this change. Whether to merge it
  into `claude/r04-20261017`, and which flags to turn on for which pair, is the owner's. Recommended order for the pairs:
  S1 → S2 → S3, the plan's.
- Next falsifiable checks (owner-run; each a fork pair, the stage's flag against the current default, the same model and
  game, forked from a snapshot where the stage's event can fire; the budget is the owner's):
  1. **S1** (`ARC_THIN_KINDS=canonical`), prediction from the plan: text alone does not make an agent write a skill. Refuted if
     a skill appears in either model's run; read `components.jsonl` for `skills/…` and `tools/components_baseline.py`.
  2. **S2** (`ARC_THIN_KINDS=canonical ARC_THIN_PERSIST_DEFS=1`): `persist` rows (scripts saved) and `import` rows (cells that
     used one), and re-definitions per level against the S0 baseline for the same model. Refuted if functions are defined as
     rarely as in S0 (no function to persist) or are saved and never used (the leading indicator is imports per decision).
  3. **S3** (`ARC_THIN_SKILLS=1`, with S1 and S2 on): the S3 pair needs a level-2 start or a stall review to fire the event.
     `skill_shown`, `skill_read`, the refinement's skill edits and the review's skill; refuted if no skill is written, if one
     is written and never shown, or if shown skills are never read or followed (read the next decisions).
  Each pair reports cost (parent plus child tokens, uncached share, latency) next to adoption, as the plan's protocol sets,
  and compares levels only as exploration, not as a result.
- Backlog: `docs/deferred-research-todos.md` 2026-10-07 (skills spec tickets) and 2026-10-08 (five-kind nature and
  direct entries) — superseded by this record if S1–S3 proceed; status unchanged until the owner decides.
- Merge notes for the r04 session. (1) This file is added by the S0 commit; the copy in `worktrees/r04` is untracked and the
  first version here is byte-identical to it, so move it away before merging or git will refuse to overwrite it. (2) The
  stages touch `demo/arc_thin_extension.ts` (the flag block next to the Binder construction, `buildWorkingSet`'s tail,
  `runRefiner`, `artifactUsage`, the workspace file-tool wrapper, `before_agent_start`, `session_shutdown`),
  `demo/arc_thin_native_runtime.ts` (the consult constants, a `persistDefs` host option, `runPython` and three new methods
  beside `noteSave`; the uncommitted edits in `callEach` that another session holds are elsewhere in that file),
  `demo/arc_thin_binder.ts`, `demo/arc_thin_refiner.ts`, `demo/arc_thin_components.ts` (the sandbox guest's `cell_defs`),
  `demo/prompt_loader.ts` and `src/autoresearch_pi/arc_thin_e2e.py`; new files are `demo/arc_thin_kinds.ts`,
  `demo/arc_thin_scripts.ts`, `demo/arc_thin_skills.ts`, `demo/prompts/arc_thin_native_kinds.md`,
  `demo/prompts/arc_thin_skill_authoring.md`, `tools/components_baseline.py` and their tests. (3) The branch already contains
  the merge of `3ff04b13` (the context layout), so it needs nothing from that branch again. (4) `run-config.json` gains
  `canonical_kinds`, `persist_defs` and `skills`, and `source_sha256` covers the new `arc_thin_*` files by the runner's own glob.
  (5) The five failing tests above fail at the base too.
