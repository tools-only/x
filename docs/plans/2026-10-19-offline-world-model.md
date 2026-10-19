# Offline world model ("dreaming") from recorded trajectories

Date: 2026-10-19 (Asia/Shanghai). Status: phase 0 failed; the tool is kept as an offline measurement; phases 1 and 2
not run.

Change record per [the development workflow](../development-workflow.md), with the sections of
[the template](../templates/meta-harness-change.md). Built on `claude/r04-dream-20261019` in the temporary worktree
`worktrees/r04-dream` (cut from r04 `7be18770`), then rebased and fast-forwarded into `claude/r04-20261017`; the
worktree was removed.
The plan was drafted in a side chat on 2026-10-19 and accepted by the user ("do this for me"): phase 0 and, if it
passes, phase 1 offline; phase 2 (in-run) only with the user's go-ahead.

## Problem and claim

- **Opportunity.** su15-g61-1 (gpt-6.1-sol, r04 `85280ac2`, `runs/arc-models-20261019`) passed four levels; the fourth
  took 138 actions (#56-#193) in seven attempts (six RESETs, one GAME_OVER at #175). The self-evolve loop's iteration 5
  found its losses came from beliefs (goal, timer, hazard), not computation. The agent wrote the mechanics down only in
  the review after GAME_OVER (#175: `hyp.hazard_chases_and_destroys`, `hyp.undo_last_effect`, `hyp.terminal_timer`,
  `hyp.disk_goal`), never as code. su15-g56-1 (gpt-5.6-sol) spent 210 actions in six attempts on its second level under
  a one-cell belief. The games are deterministic, and every transition is stored with both grids
  (`harness/trajectory.jsonl`, `harness/states.jsonl`): the data an offline world model needs.
- **Claim (phase 0).** From a level's recorded transitions, a model writes the rules as Python
  `step(grid, action, x, y, history)` that reproduces the moves it was shown and predicts the moves held out from it:
  the later moves of the same attempts, and a later attempt.
- **Burden it would remove**, if a later phase uses it: re-deriving mechanics from frames at each decision; testing
  routes with real actions (lives, the timer); mechanics left unwritten. Phase 0 itself removes nothing; it measures
  whether the precondition holds.
- **Falsifier.** Held-out agreement below the pass mark below: dreaming is not worth building on these models now.
  Then record which mechanics the code misses, and stop.
- **Scope and non-goals.** Phase 0 is offline: model calls only, no ARC action, no change to r04's runtime, prompts or
  agent tools. Phase 1 (planning inside the fitted model) only if phase 0 passes. Phase 2 needs the user's go-ahead.
  Not claimed at any phase here: adoption by the agent, or more levels.

## Design and cost

- `tools/arc_world_model.ts`:
  - `window <run> <from>-<to> <out>` splits the window's moves into attempts. A RESET starts an attempt; RESET and
    level-changing moves are not scored (their result is not a function of the grid). The last attempt is held out
    whole ("later"); every earlier attempt gives its first half (rounded up) to the fit set and holds out the rest
    ("half"). Busy lines are rows or columns with a changed cell on at least 80% of the fit moves (counters, timers;
    the ledger's ticker rule applied to lines, since a shrinking bar changes each cell only once). A held-out move is
    "seen" if its grid outside busy lines and its action with coordinates occur among the fit moves, otherwise
    "novel".
  - Two comparators from the record alone: no change (identity), and replay (a seen move gets the change recorded at
    its fit twin).
  - `score <out> <file.py>|--oracle` runs a source. The oracle looks up every recorded move by its full grid and
    action; it checks the scoring itself.
  - `fit <out> <model>` sends one prompt, then up to three repairs, and scores every round's code on all moves. The
    round best on the fit moves is the result; selection never sees held-out moves.
- **The prompt** (`recordPrompt`): the grid size, the action names as recorded, the start grid of each fit attempt in
  hex, and every fit move as the cells it changed, in runs per row ("y12 x3-5 4>9"). It names no game, object, colour
  role or rule. The repair shows only fit moves: totals, then up to eight moves with the most wrong cells, with the
  recorded change against the code's, and errors with their line.
- **Scoring** runs in the WASI CPython sandbox the hypothesis checks use (`demo/pi_task_python.ts`), with a constant
  guest program: the model's source is data, compiled as `<model>`, so error lines match it. One sandbox call per
  attempt, teacher-forced: each move starts from the recorded grid before it, with the attempt's earlier moves as
  `history`.
- **Cost.** Model calls only. Scoring takes 12-27 s per window on this machine.
- Nothing is added to or removed from the agent's runtime, prompts, fields or tools.

## Pre-run protocol (fixed before any model call)

- **Evidence level.** Functional (the scoring checks) and offline prediction. Not adoption, not task benefit.
- **Windows.**
  - W1: su15-g61-1, #56-#193 (its fourth level). Seven attempts; 58 fit moves; 73 held out, 68 of them novel.
  - W2: su15-g56-1, #72-#281 (its second level). Six attempts; 87 fit moves; 117 held out, 101 of them novel.
  - Busy lines: row 63 in both.
- **Models.**
  - gpt-6.1-sol with `reasoning_effort` medium, as in g61-1.
  - qwen3.8-27b with thinking off, as in the r04 qwen runs.
  - One fit per model and window: four fits.
  - Exploratory, labelled as such, only if budget remains: qwen with thinking on.
- **Budget.**
  - At most 1.0M budget tokens (uncached input plus output) for phase 0: 300k per GPT fit, 200k per qwen fit.
  - A fit starts no call once its share is spent.
  - No ARC action.
- **Pass mark**, for gpt-6.1-sol on W1:
  - P1: the cells outside busy lines are all right on at least 70% of the novel held-out moves.
  - P2: the busy-line cells are all right on at least 90% of the held-out moves (the counter or timer).
  - Both pass: go to phase 1. Otherwise record the mechanics the code misses, and stop.
  - The other three fits are reported against the same marks. They tell model and window effects apart; they do not
    gate.
- **Comparators.** Identity and replay, on every set (below).
- **Negative cases in the windows.** Moves that change nothing but the counter, GAME_OVER moves, ACTION7 (its result
  depends on earlier moves), and held-out moves never seen among the fit moves.
- **Functional checks before any model call.**
  - The identity source through the sandbox must give the identity baseline computed in TypeScript.
  - The oracle must be exact on every move, unless a grid and action recur with different results. Any such miss is
    reported as hidden state.

## Implementation and verification

### Functional checks (no model call, 2026-10-19)

| Window | Identity: sandbox = TypeScript | Oracle | Identity: P1 measure / P2 measure | Replay on seen held-out moves: outside busy / busy |
| --- | --- | --- | --- | --- |
| W1 | equal on every count | 131/131 exact | 4/68 / 6/73 | 5/5 / 3/5 |
| W2 | equal on every count | 204/204 exact | 6/101 / 5/117 | 16/16 / 12/16 |

- No grid and action recur with a different result in either window, so `step(grid, action, x, y)` can in principle
  be exact on these records. ACTION7's dependence on earlier moves shows only through `history`.
- Replay is exact outside busy lines on every seen move, but not always on the busy line: the counter's step is not
  a function of the masked grid and the action.
- Outputs: `runs/arc-dream-20261019/w1-g61-l4/`, `runs/arc-dream-20261019/w2-g56-l2/` (`window.json`, `prompt.txt`,
  `score-identity.json`, `score-oracle.json`, `oracle.py`).

### Fits under the fixed protocol (prompt v1, `6884412a`; `2720842c` before the rebase onto r04)

All four fits ran in parallel on 2026-10-19 and cost 321,071 budget tokens in total, by the corrected measure below
(316,600 as first recorded). Outputs are in `runs/arc-dream-20261019/<window>/<model>-<effort>/` (`fit.json`, and per
round `reply-k.md`, `code-k.py` and `score-k.json`).

| Fit | Rounds with code | Best round | P1: novel held-out, outside busy | P2: held-out, busy line | Budget tokens |
| --- | --- | --- | --- | --- | --- |
| W1 gpt-6.1-sol, medium | 2 of 4 | 3 | 35/68 (51%) | 45/73 (62%) | 77,287 |
| W2 gpt-6.1-sol, medium | 4 of 4 | 1 | 22/101 (22%) | 115/117 (98%) | 29,431 |
| W1 qwen3.8-27b, off | 2 of 4 | 2 | 0/68 | 49/73 (67%) | 121,862 |
| W2 qwen3.8-27b, off | 4 of 4 | 0 | 6/101 (6%) | 4/117 (3%) | 92,491 |
| identity, W1 / W2 | — | — | 4/68 / 6/101 | 6/73 / 5/117 | 0 |

- **Verdict: fail.** The gating fit, gpt-6.1-sol on W1, misses both marks.
- **The model did not invest.**
  - Round 0 on W1 returned the grid unchanged, "only a conservative fallback", after 1.6k reasoning tokens.
  - Round 1 wrote no code at all: "I can't give a complete predictive function that is justified by the evidence
    here."
  - Only the repair's "give the complete code" produced attempts (rounds 2 and 3).
  - Across its eight calls gpt-6.1-sol reported at most 2.6k reasoning tokens (none in two of them) and took
    11-104 s per call.
  - qwen (thinking off) wrote its analysis into the reply until the turn ended, without code, in rounds 0 and 1 on W1.
- **W1 round 3 is a lookup, not a model.**
  - It is a table of the 42 observed (hazard position, click) transitions, with a spatial fallback: two same-colour
    pieces near the click merge into the next size, the hazard steps up to 4 cells toward the nearest piece, ACTION7
    restores the last board-changing move but not the bottom row, and the bottom row follows a formula.
  - It is exact outside busy lines on 57 of the 58 fit moves (memorised), and on 35 of the 68 novel held-out moves.
- **W2.** gpt-6.1-sol got the counter row right on 115 of the 117 held-out moves, and the board on 22 of the 101
  novel ones.

### Deviation (decided after v1, before any further call)

- **What breaks.** Investment: the model writes a placeholder or declines, so v1 measures willingness more than
  ability. Per the protocol, v1's verdict stands: fail.
- **The one factor changed.** Prompt v2 adds one sentence: each rule captured makes more moves exact; write the most
  complete model the record supports, never a placeholder; where the record leaves a case open, choose the simplest
  rule consistent with it. `--prompt v1` reproduces v1. Pass marks unchanged.
- **Exploratory runs, labelled as such.**
  - gpt-6.1-sol, medium, v2: W1 (at most 150k) and W2 (at most 100k).
  - qwen3.8-27b with thinking on, v2: W2 only (at most 150k). This is the protocol's exploratory arm. It changes the
    prompt and the thinking together, so it does not separate the two.
  - Only if v2 fails on W1: one gpt-6.1-sol fit at `reasoning_effort` high on W1 (at most 150k).
  - With all of these, phase 0 stays within 0.87M of its 1.0M.
  - Not run: qwen with thinking off under v2, which would isolate the prompt's effect on qwen.
- **Phase 1 condition.** A v2 or high-effort pass on W1 is exploratory evidence: phase 1 may follow, labelled
  exploratory.

### Exploratory fits (prompt v2; one at high effort)

| Fit | Best round (on fit) | P1: novel held-out, outside busy | P2: held-out, busy line | Budget tokens |
| --- | --- | --- | --- | --- |
| W1 gpt-6.1-sol, medium, v2 | 2 | 9/68 (13%) | 6/73 (8%) | 110,796 |
| W2 gpt-6.1-sol, medium, v2 | 3 | 47/101 (47%) | 115/117 (98%) | 80,377 |
| W2 qwen3.8-27b, thinking on, v2 | 0 | 5/101 (5%) | 115/117 (98%) | 89,233 |
| W1 gpt-6.1-sol, high, v2 (stopped at its budget after round 2) | 2 | 9/68 (13%) | 54/73 (74%) | 153,941 + a cut call |

- **All four fail.** The best held-out result of any round was not a selected round: W2 v2 round 1, 67 of the 101 novel
  moves (66%) right outside the busy line.
- **Every gpt-6.1-sol fit on W1 converged on memorisation.**
  - v1 round 3: a table of the observed (hazard position, click) transitions.
  - The high-effort round 2 (after 16.4k reasoning tokens in round 1): it identifies which recorded attempt the click
    sequence follows and replays that attempt's recorded hazard route.
  - These fit the moves shown (57 and 27 of 58 exact) and miss the novel ones.
  - The first reply was a minimal local rule with a disclaimer under every prompt and effort: "the record does not
    establish a general rule".
- **W2's code learns the agent's habit.** v2 round 3 reproduces the one-cell up-left sweeps the agent repeated, with
  coordinate-specific conditions. It misses one-cell moves in other directions, merges into the next piece size, and
  the merged piece's moves.
- **The counter row is learnable.** Both models got it right on 115 of the 117 W2 held-out moves (qwen only with
  thinking on). On W1 the best was 54/73.
- **Gateway behaviour is uncontrolled.**
  - Latency ranged from 6 to 711 s per call.
  - Reported prompt tokens fell as the conversation grew (21,465 in round 0, 16,097 in round 1 of the same fit).
  - On some calls `completion_tokens` left the reasoning out: total = prompt + completion + reasoning. The tool now
    counts the larger of the two readings, and the budgets in these tables are recomputed that way.
  - One qwen stream ended without a finish reason.
  - The calls were probably served by more than one backend. The record cannot tell which.

### What the codes miss (held-out moves; `score --changes`, then a tally by colour transition)

- **W1** (v1 round 3, the best on W1; 50 held-out moves with wrong cells):
  - 340 cells: the switch of the disk and the top marker to colour 2, in four moves. The trigger was not modelled.
  - 265 cells: the largest piece's movement.
  - About 420 cells: the hazard's step. The code moves it up to 4 cells toward the nearest piece.
  - 25 moves: the counter's step, off by one cell. Three more are off by 4 to 7 cells: the counter's larger steps
    after clicks that change nothing.
  - Clicks that change nothing: the code predicts a move on them.
- **W2** (v2 round 3; 55 held-out moves with wrong cells): one-cell moves in the directions the agent rarely used
  (188 cells), merges into colour f and the merged piece's moves (98 cells).
- **A limit of the data, whatever the model.** A record holds only what the agent tried. g56-1 never clicked away
  from a block (iteration 3 of the self-evolve loop), and that is the mechanic that passes the level. No world model
  fitted to that record can contain it, so planning in it would only recombine observed effects.

### Total cost

- 755,418 budget tokens by the corrected measure, within phase 0's 1.0M. The cut call is not included; its usage was
  not reported.
- No ARC action was played.
- Outputs: `runs/arc-dream-20261019/`. The failure tallies were made with `C:/Users/qi/tmp/dream/misses.mjs`.

### Side findings, outside this change

- **The ledger's ticker rule misses a shrinking bar.** `maskedHashes` (`demo/arc_thin_ledger.ts`) masks cells that
  change on at least 80% of transitions. A bar changes each of its cells once, so the rule finds 0 ticker cells in
  su15-g61-1, -g56-1, -g61-2 and -q38-1.
  - The line rule used here finds row 63 in all four.
  - Repeats the ledger sees, against repeats outside the timer: 16 vs 23, 36 vs 66, 4 vs 19, 14 vs 21.
  - Script: `C:/Users/qi/tmp/dream/ticker-check.ts`.
  - This is a runtime change, so it is not made here. It is offered as a separate task.
- **The runs' usage logs** (`harness/usage.jsonl` of g61-1, g61-2, g56-1, g56-2 and q38-3) show no row with
  reasoning above output, nor a total above its parts.
  - So the gap above is not visible there, but their reasoning per request is small (48k-65k tokens per run).
  - Whether the 6M cap undercounted GPT runs remains unverified.

| Evidence level | Status | Provider / environment | Artifacts and limits |
| --- | --- | --- | --- |
| Functional | passed | local WASI sandbox, recorded runs | identity and oracle checks above |
| Offline prediction (the phase 0 claim) | failed | yibu: gpt-6.1-sol medium/high, qwen3.8-27b off/on | v1 fails the pre-registered mark; the v2 and high-effort variants also fail; two windows, one fit per arm |
| Full chain | not applicable | — | offline; no runner, Pi or ARC action involved |
| Autonomous adoption | not applicable | — | nothing reaches the agent |
| Net benefit | not tested | — | phase 1 not reached |

## Delivery decision

- **Supported claims.**
  - The tool scores a written step() on a recorded window exactly: the identity and oracle checks pass.
  - At the agent's settings and with up to three repairs, neither gpt-6.1-sol nor qwen3.8-27b writes a world model
    that predicts these levels' held-out moves. Best novel held-out moves right outside the busy line: W1 51%, W2 47%
    (66% in a round the fit moves did not select).
  - Both models learn the counter row.
- **Not supported.**
  - That more offline compute fixes this: high effort raised reasoning to 16k tokens and produced memorisation of the
    recorded routes, not rules.
  - Anything about planning or levels: phase 1 was not run.
- **Decision.** Phase 0 fails, so per the protocol phase 1 is not run, and phase 2 is not proposed.
  `tools/arc_world_model.ts` stays as an offline measurement. It changes nothing in the runtime.
- **The next falsifiable checks** (not run; each needs the user's budget):
  1. A test-driven fit. The model runs its own code on the fit moves and revises 10-20 times, as a coding agent
     would. The oracle shows that exact code exists for these records. Same windows, protocol and pass marks, at most
     0.5M per fit. Falsified if W1's novel held-out result stays below 70%.
  2. The off-policy scoring of refiner edits proposed in the same side chat: pure analysis of recorded runs, no model
     call needed.
  - Neither addresses the data limit: what a record never tried, offline reasoning cannot recover.
- **Related backlog.** [Deferred research todos](../deferred-research-todos.md) §C: "evaluate snapshot branching,
  replay and rollback experiments if the environment supports them" (若环境支持，再评估快照分支、回放及可回滚实验).
  A fitted simulator was the substitute for branching here, and at this fidelity it is not one. The item stays open.

## Round 2 (2026-10-19): fixing copying, effort and the data limit

The user asked to fix the three failures found in phase 0: copying instead of rules, little effort at the run's setting,
and a record that holds only what the agent tried. Built on `claude/r04-dream2-20261019` (temporary worktree
`worktrees/r04-dream2`, from r04 `5e998182`), to be folded back into r04 like round 1.

### One change per failure

- **Copying → validation the model never sees.** The last 30% (rounded down) of each attempt's fit moves become
  validation; the rest are shown. Validation moves never appear in the prompt or in what the python tool can read.
  `test` reports them by counts only. The final code is the version best on validation, ranked by exact moves, then
  moves right outside busy lines, then fewer wrong cells. A lookup of the shown moves gains nothing there, and test
  says so when the shown moves fit far better than validation. The system prompt states the same: rules over what a
  grid shows, no recognising recorded moves.
  - W1: 44 moves shown, 14 validation (all unlike any shown).
  - W2: 64 shown, 23 validation (all unlike any shown).
  - The final test is phase 0's held-out set, unchanged: W1 68 novel moves, W2 101.
- **Effort → a tool loop.** At most 14 replies:
  - `python` runs code on the record shown.
  - `test` scores a step(): every shown move it gets wrong, the five worst with the recorded change against the
    code's, and exactness by move kind.
  - `submit` ends the work.
  - A first submit with validation below 90% and at least 4 replies left is returned once.
  - History is folded into a log when more than 6 exchanges are kept: the oldest 4 go, and the best version's code
    stays in view.
- **The data limit → coverage, unknowns and an experiment.**
  - The prompt counts the moves shown by kind, using the coverage record's kinds
    (`docs/plans/2026-10-19-coverage-attempts-delivery.md`): a click by its Chebyshev distance from the area the
    previous move of its attempt changed (inside, touching, 2-6 cells, more than 6, before any change), another action
    by name. The counts include the colours of the clicked cells.
  - `submit` asks for up to three situations the record does not decide, each with the one move that would decide it.
  - `tools/arc_world_model_agent.ts experiment` then gives the finished fit the outcomes of 3 moves of a kind its
    record lacks and lets it continue for at most 5 replies. The outcomes come from another recording of the same
    level: su15's levels start from the same layout in every run (level 2's start grid hashes `bbe97b6e273a` in all
    seven arc-models-20261019 runs).
  - Both versions are then scored, by kind, on a third recording of that level.
  - The kind is the first rare kind the unknowns named, if the experiment recording has 3 moves of it. Otherwise it is
    the click kind the shown record has fewest of.
- **No change elsewhere.** The runtime and phase 0's scoring do not change: phase 0's scores reproduce exactly after
  the refactor (identity, and v1 round 3).

### Pre-run protocol (fixed before any model call of round 2)

- **Arms.**
  - A1 (gating): gpt-6.1-sol, reasoning medium, on W1, at most 450k budget tokens.
  - A2: gpt-6.1-sol, medium, on W2, at most 300k. Then the experiment step, at most 150k: experiments from
    su15-g61-1's level 2 (#23-#38), test recording su15-q38-1's level 2 (#41-#151).
  - A3: qwen3.8-27b, thinking off, on W2 (agent-native for qwen runs), at most 300k. Its experiment step runs only if
    budget remains, as exploratory.
  - Total at most 1.5M, the spare reserved for an arm that fails for transport reasons.
- **Gate (unchanged from phase 0).** P1 ≥ 70% and P2 ≥ 90% for A1. A pass permits phase 1 offline, labelled as following
  a protocol change.
- **Per failure, for gpt-6.1-sol.**
  - Copying is fixed if the final code's gap between shown and validation moves (right outside busy lines) is at most
    25 points, and P1 exceeds phase 0's best on that window by at least 15 points (W1: 51% → at least 66%; W2: 47% →
    at least 62%).
  - Effort is reported, not gated: replies, tests, output and reasoning tokens. The final code must not be a
    placeholder: P1 above identity's (W1 6%, W2 6%).
  - The data limit:
    - (3a) The submitted unknowns name at least one move of a kind holding at most 5% of the shown moves.
    - (3b) After the 3 outcomes, the exactness right outside busy lines on q38-1's level-2 clicks of the experiment kind
      rises by at least 25 points over the version before. Falsified below 10 points; inconclusive in between.
    - W2's P1 must not fall by more than 10 points.
    - Dry run, no model call, with the grid unchanged as the fit: kind 2-6 cells (fallback); experiments g61-1 #30,
      #32, #36; on q38-1's 41 such clicks, identity is right on 6.
- **Functional checks done.**
  - `check` on W1 and W2: the python tool reads 44 and 64 moves and reports errors with their line; test reports
    identity, oracle (44/44 + 14/14; 64/64 + 23/23) and a syntax error correctly; unknowns parse into moves and kinds.
  - Outputs: `C:/Users/qi/tmp/dream2/check-w1.txt`, `check-w2.txt`, `check-phase0.txt`, `dry-experiment.txt`.
