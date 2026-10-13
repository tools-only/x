# Meta-harness change record: foundation-native run fixes (bounded history, budgets, refs, components that help solve)

Date: 2026-10-12 (Asia/Shanghai). Status: implemented; functional and scripted full-chain checks pass; real-provider behaviour unverified.
Branch `claude/foundation-fixes-20261012` on top of `codex/harness-foundation-20261012` (a3a942cc).

## Problem and claim

- Real failure: `D:\autoresearch_pi_foundation_20261012\runs\foundation-native-ls20-real-20261012-02` (yibu / qwen3.8-27b, text input,
  foundation native, continuity session, no compaction). At the analysis point: 21 actions, 0 levels, ~18 actions/hour.
  Observed (from `harness/context_budget.jsonl`, `runtime-audit/provider-inputs.jsonl`, `pi-events.jsonl`):
  1. History grew without bound: every earlier decision verbatim, including full python output and whole-file reads
     (42.9k message characters per request at decision 24; 51.9k input tokens per action).
  2. RECENT ACTIONS repeated the arc_action receipts already present in the retained history.
  3. 64-hex result refs were mistyped twice (`read` → "workspace file does not exist").
  4. The shared limit of 6 tool calls ended two decisions mid-analysis; each cost a whole extra decision to restate it.
  5. The prompt said the newest message carries "the current grid and PNG", but input was text-only; the agent went looking for the PNG.
  6. No component was built. An empty `CAPABILITIES` header was shown every decision. The same frame diff was typed in three python
     calls (code identical but for numbers). `os.listdir('data')` failed in WASI, and the agent concluded data/ did not exist.
- Narrow claim: in native mode, (a) the request stays bounded as decisions accumulate while the newest decisions stay exact; (b) no
  decision ends on a tool limit while the agent is still analysing; (c) refs are typed correctly; (d) when the agent repeats a computation,
  it sees that fact next to what a tool or observer would give it for solving, so it can choose to build one.
- Burden removed: re-reading stale outputs every request; repeated restatement after limit-ended decisions; failed reads; hand-retyped analyses.
- Non-goals: no game-specific content, no built-in diff or analysis (the agent writes those), arc_action unchanged, reasoning left on.

## Design and cost

- History bands (`demo/arc_thin_native_context.ts`). The newest `verbatim` (4) decisions are kept. In earlier decisions of that band,
  results over 2000 characters keep only their head; those are whole-file reads, the only uncapped result kind. The next `condensed` (16)
  decisions keep their calls and results, with arguments over 200 characters shortened and results clipped to 300 characters. Older
  decisions are dropped, with a note naming where their record lives (memory, notes/, data/trajectory.jsonl, data/frames/). Band edges
  move in steps of `verbatim` decisions, so the shown prefix stays identical between steps and provider prompt caching still works.
  Pi's session file is untouched. Settings: `ARC_THIN_NATIVE_VERBATIM` (0 = everything verbatim, the previous behaviour) and
  `ARC_THIN_NATIVE_CONDENSED`, both recorded in `run-config.json` as `native_history`.
- RECENT ACTIONS (native) lists only actions whose receipts are not in the shown history; usually it is empty and omitted.
- Result refs: `results/r<n>.txt` (consult answers `results/c<n>.txt`). Identical bodies share one file, and numbering survives restarts.
- Budgets (native ordinary decisions): look-up/compute calls (python, read, ls, grep, consult, agent tools) have a budget of 10;
  record calls (memory, write, edit) have a budget of 6; the hard total is 18. The last allowed call's result says so. Over budget, the
  call is refused without ending the decision, and that kind of tool leaves the surface until the next decision. Consolidation and the
  scripted diagnostic budget keep their old rules.
- Prompt: the PNG is mentioned only when the model declares image input. The component paragraph now says what each kind gives for
  solving: an observer is a standing view, a tool is an exact repeatable step, a check tests a belief on every move, a role gives a fresh
  second opinion. It closes with "When you compute the same thing again, make it one of these." System prompt with ledger and critic board: 2971 characters (budget 3000; the real run's was 2928).
- CAPABILITIES is omitted when nothing is saved. A `REPEATED WORK` line appears only when, on the current level and since the last change
  to saved tools/observers/libraries, recent python calls share a code shape (numbers, comments and blank lines normalised) or most of
  their lines. The line names the repeated computation and what a tool or observer would give. Shapes are logged in
  `component_runs.jsonl` and replayed after a restart.
- WASI python: `os.listdir`, `os.path.isdir/isfile/exists` answer from the workspace file names, without transferring contents.
- Resident cost: no new tool or field. The REPEATED WORK line (~300 characters) appears only with evidence; the empty CAPABILITIES header
  and the duplicated RECENT ACTIONS are removed.

## Evaluation protocol (before the next real run)

- Evidence targets: functional and full-chain now. Adoption and net benefit need a real run.
- Comparator: `foundation-native-ls20-real-20261012-02` (same game, provider, model and input modality), same seedless public start.
- Proposed budget (needs approval): one ls20 run, at most 60 actions or 2 h.
- Primary measures:
  - input tokens per action at actions 15–25 (claim: ≤ 50% of 51.9k);
  - decisions ended by a tool limit (claim: 0);
  - failed result reads (claim: 0);
  - whether REPEATED WORK, when shown, is followed by a saved tool/observer and its later use (adoption; may legitimately be 0);
  - levels and actions per hour.
- Negative cases: a REPEATED WORK line with no investment is not a failure by itself, but the claim is falsified if the agent re-derives
  dropped facts and loses progress after a band move (check for repeated hypotheses or experiments after decision ~8).

## Implementation and verification

- Entry points:
  - `demo/arc_thin_native_context.ts`, `demo/arc_thin_extension.ts` (context hook, gate, surface, RECENT, prompt slot)
  - `demo/arc_thin_workspace.ts`, `demo/arc_thin_native_runtime.ts`, `demo/arc_thin_binder.ts`, `demo/arc_thin_components.ts`
  - `demo/prompts/arc_thin_native_system.md`, `src/autoresearch_pi/arc_thin_e2e.py`
  - `tools/arc_thin_smoke_provider.ts` (BUDGET script, `current` field), `tools/run_foundation_smoke.py` (`budget`, `banded`)
- Checks:
  - `node --test` over `tests/arc_thin_*.test.ts`: 105/105. New: band projection and prefix stability, visible actions, code shape and
    repetition, short refs across restarts, WASI listing.
  - Foundation smokes (real runner, Pi 0.87.0, real bridge with mock SDK, scripted provider), all exit 0: foundation, foundation defaults,
    foundation uncapped, components, components banded (verbatim 2 / condensed 2: dropped and condensed notes asserted), receipts,
    migration, budget.
  - The budget smoke checks four things: the 11th same-shape python call is refused while the decision continues; the next request has no
    python but keeps memory and arc_action; the decision ends with an action; the next decision shows "REPEATED WORK: 9 of your last 10".
- Offline replay of the real session through the projection (`tmp/band_replay.mjs`): history characters (JSON) at decision starts.

  | decision | canonical | bands 4/16 | bands 4/8 |
  | --- | --- | --- | --- |
  | d24 | 57,332 | 43,917 | — |
  | d31 | 115,749 | 59,998 | — |
  | d44 | 137,369 | 43,881 | 27,641 |
  | sum over 44 starts | 3,071,849 | 1,585,094 (51.6%) | 1,187,174 (38.6%) |

  These are characters of the replayed history only (not tokens; no working set, system or tools); this is not a provider measurement.

| Evidence layer | Status | Provider / environment | Artifacts and limits |
| --- | --- | --- | --- |
| Functional | passed | node tests, local | tests listed above |
| Full chain | passed (scripted) | offline-arc-thin-smoke, Pi 0.87.0, mock ARC SDK | `runs/foundation-*-smoke-20261012151006` in the fix worktree |
| Autonomous adoption | unverified | — | needs a real run |
| Net benefit | unverified | — | replay shows bounded history only |

## Decision

- Supported: bounded native history with exact newest decisions; deduplicated RECENT ACTIONS; short refs; split budgets without
  decision-ending refusals; honest modality text; evidence-gated component framing; workspace listing in python.
- Not supported yet: any claim that the agent builds or uses components more, solves more levels, or costs less in a real run.
- Next falsifiable check: the run described in the protocol, which needs budget approval.
- Backlog: `docs/deferred-research-todos.md` D (cognitive continuity after compression). Bands are a form of compaction, so the next real
  run should check for re-derivation after band moves, as D asks.

## Addendum 2026-10-13: reasoning offload as the core objective

User decision: reasoning efficiency and offloading are the core decision objectives of the Self-Harness. The agent's default preferences
are reuse, codifying recurring methods, reasoning on what is new, and revising on feedback. They are stated as concise principles, with no
mandatory cost sheet or promotion procedure; one-off work is done directly. Persistent rebuilding of clearly reusable work triggers an
autonomous adoption-gap investigation. Acceptance reports repetition overhead, total cost and task performance separately, and checks that
components really replace repeated downstream work after their creation, validation, maintenance, invocation and output costs.

- Baseline from the same real run at 37 actions (`python -m autoresearch_pi.arc_thin_reuse_report <run>`):
  - 3.24M reported tokens; 2.41 parent calls per action; 31.5k input per call; 10.6k reasoning per action; 0 levels; 17.2 actions/hour.
  - Only 2 of 21 python calls redid an earlier computation (about 300 output tokens).
  - About 29% of reasoning sentences located cells or coordinates (text heuristic).
  - Conclusion: in this run, most re-derivation happened in reasoning, not in code.
- Runtime changes (native mode):
  - Prompt: the four principles replace the per-kind benefit text. System prompt with the board is 2966 characters.
  - `demo/arc_thin_reuse.ts` (new) does the code-shape grouping, coverage and gap detection:
    - A saved component covers a repeated computation when its source has the structure of at least half of the computation's lines,
      and at least two lines. Numbers and variable names are ignored, so a tool that turned the constants into parameters still matches.
    - REPEATED WORK then says "tools/x.py already covers it" (reuse), or invites saving it once (codify).
  - Adoption gap: rebuilding continues in at least 2 later decisions after REPEATED WORK named it. The runtime then locates the break once,
    as one of: nothing saved, a failed save, components saved since that do not contain the code, a covering component left unused, or a
    covering component used but the code still retyped. With the critic enabled, an independent side call (`ADOPTION_SYSTEM`) answers
    `cause | evidence | smallest change`, where cause is varies, missing, uncovered, friction, unnoticed or stale. Shown once and logged in
    `reuse_reviews.jsonl`; its usage is logged as kind `adoption`.
  - RESOURCES adds "about N% of it locating cells and coordinates" to the last turn's reasoning when the share is at least 20% and
    reasoning is at least 2k tokens. This makes the larger, reasoning-side repetition visible next to its cost.
  - Save receipts now come first in python results, so the 450-character head of a long result keeps them.
- Measurement: `src/autoresearch_pi/arc_thin_reuse_report.py` writes `reuse_report.json` at the end of each run. Its sections are task,
  cost by kind, repetition and per-component lifecycle costs. A component counts as having replaced its covered calls only if it was
  invoked and those calls became less frequent per action after it was saved.
- Checks:
  - New `reuse` foundation smoke, run with and without critic:
    - REPEATED WORK is shown, then the gap is located ("no component was saved…") and the review parsed (one junk line dropped).
    - A later tool is matched as "already covers it".
    - The report gives 6 python calls with 5 repeated, and tools/cell.py with covered calls 4→2, 0 invocations, replaced=false. This is
      the negative case of a component saved but not used.
  - All other foundation smokes pass. Node unit tests are listed in the commit.
- Evidence: functional and scripted full chain only. Whether the agent follows the principles, closes gaps or reasons less is unverified
  until a real run. The success criteria for that run:
  - lower coordinate-reasoning share and reasoning per action;
  - REPEATED WORK and gaps are followed by components that the report marks replaced=true;
  - parent calls and total tokens per action are reported next to levels and actions per hour.
