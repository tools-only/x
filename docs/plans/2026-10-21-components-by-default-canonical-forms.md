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
  this machine's Node 25.5.0). Runner-side check: `python -m pytest tests/test_components_baseline.py`.
- **Base result on this machine, before any change** (pristine checkout of `9a5e0536`, Node 25.5.0, 691 s): 255 tests,
  250 pass, 5 fail — `arc_thin_activation.test.ts:41` ("saved code acts in a closed loop"), `arc_thin_components.test.ts:181`
  ("python session never stores runtime objects…") and `arc_thin_receipts.test.ts:8`, `:28`, `:44`. They fail the same
  way at the work-memory record's base (`docs/plans/2026-10-20-work-memory.md`, "five fail the same way at the base:
  activation 1, components 1, receipts 3"). I did not cause them and did not touch what they test.
- Tests of each stage are listed under its heading below; the full suite is re-run after each stage and compared with
  this base result.

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

| Evidence level | Status | Provider / environment | Artifacts and conclusion boundary |
| --- | --- | --- | --- |
| Functional correctness | S0 only: the script's measures pass 2 unit tests; runtime stages not built yet | none (read-only analysis of recorded runs) | `tools/components_baseline.py`, `tests/test_components_baseline.py` |
| Full-chain reachability | unverified | — | — |
| Autonomous adoption | unverified | — | baseline only: 0 skills, 0 lib scripts, 0 component imports in 105 runs |
| Net benefit | unverified | — | — |

## Delivery decision

- Supported now: the analysis of why r04 creates no skills (records above) and the mapping of CH's strengths onto
  r04's existing mechanisms. Not supported: any adoption or benefit of the stages.
- Decision: design; await the user's choice of stage order and run budget. Recommended order S0 → S1 → S2 → S3; S5
  only after S3 shows skills exist.
- Next falsifiable check: S1 text-only pair (prediction: 0 skills), then S2 pair measuring re-definitions per level
  and imports of persisted names.
- Backlog: `docs/deferred-research-todos.md` 2026-10-07 (skills spec tickets) and 2026-10-08 (five-kind nature and
  direct entries) — superseded by this record if S1–S3 proceed; status unchanged until then.
