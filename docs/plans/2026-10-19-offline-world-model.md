# Offline world model ("dreaming") from recorded trajectories

Date: 2026-10-19 (Asia/Shanghai). Status: phase 0, evaluation.

Change record per [the development workflow](../development-workflow.md), with the sections of
[the template](../templates/meta-harness-change.md). Work on `claude/r04-dream-20261019` in the temporary worktree
`worktrees/r04-dream` (cut from r04 `7be18770`); it is folded back into `claude/r04-20261017` and removed when done.
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

### Fits under the fixed protocol (prompt v1, `2720842c`)

All four fits ran in parallel on 2026-10-19 and cost 316,600 budget tokens in total. Outputs are in
`runs/arc-dream-20261019/<window>/<model>-<effort>/` (`fit.json`, and per round `reply-k.md`, `code-k.py` and
`score-k.json`).

| Fit | Rounds with code | Best round | P1: novel held-out, outside busy | P2: held-out, busy line | Budget tokens |
| --- | --- | --- | --- | --- | --- |
| W1 gpt-6.1-sol, medium | 2 of 4 | 3 | 35/68 (51%) | 45/73 (62%) | 72,816 |
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

| Evidence level | Status | Provider / environment | Artifacts and limits |
| --- | --- | --- | --- |
| Functional | passed | local sandbox, recorded runs | identity and oracle checks above |
| Full chain | not applicable | — | offline; no runner, Pi or ARC action involved |
| Autonomous adoption | not applicable | — | nothing reaches the agent in phase 0 |
| Net benefit | unverified | — | phase 0 measures prediction only |

## Delivery decision

(to be filled in after the fits)
