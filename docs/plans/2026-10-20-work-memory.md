# Work memory: idle spinning and rewritten code as one problem (2026-10-20)

Date: 2026-10-20 (Asia/Shanghai). Status: implementation; functional checks only, no run yet. Record format:
`docs/templates/meta-harness-change.md`.

The user, after su15-chm-q38-1: "Your solution is not fundamental enough. Idle spinning and repeatedly rewriting tools have
long-standing unresolved issues that were never fully fixed. I want you to deliver an ultimate solution that resolves these
two core problems in one shot."

## Problem and claim

### Both problems, measured on every recorded run

`C:/Users/qi/tmp/r04/spin/` (`spin-rewrite.mjs`, `py-kinds.mjs`, `rep-samples.mjs`) reads all 111 runs under `runs/`.
A known replay is an action played from the same exact board as an earlier action with the same label and the same
result (exact grids, so status bars hide most of them: an undercount).

| | qwen3.8-27b, thinking off (68 runs) | gpt-6.1-sol (3) | gpt-5.6-sol (3) |
| --- | --- | --- | --- |
| actions / decisions | 7,926 / 5,086 | 623 / 523 | 755 / 421 |
| known replays | 1,114 (14%) | 21 (3%) | 79 (10%) |
| decisions whose actions were all known replays | 466 | 12 | 28 |
| decisions identical to the one before (same calls, same arguments) | 220 | 0 | 0 |

The worst runs:
- **su15-lr-1020-q38:** 166 of 236 actions were known replays. Its longest run of them was 136 actions: RESET ×35 and
  ACTION6(33,27) ×98, three clicks then a RESET, over and over. Decisions that only replayed carried 70% of its budget
  tokens. The no-effect refusal was on: it moved the loop to "three clicks, RESET" instead of ending it.
- **su15-q38-1 of 10-20:** a 79-action run of known replays (RESET, then one fixed 4-click sequence, 14 times). 146 of its
  166 python cells repeated an earlier cell verbatim; one cell reading `data/trajectory.jsonl` ran 135 times.
- **su15-chm-q38-1:** 46 arc_action calls identical to the one before, 30 in a row. Two python cells ran 29 times each.
  Two stall reviews named the loop and the next decision resumed it.
- **The runner itself:** su15-r4 made 265 decisions for 48 actions and su15-r1-B2 337 for 38. The gateway refused every
  request whose history repeated an identical call, so decisions spun without acting.

Python, all runs: 3,319 cells that compute. Cells that only print text or only comment, and cells that act, are left out.
- 460 (14%) repeat an earlier cell verbatim;
- 60 repeat one with other numbers;
- 163 share most of their lines with one;
- repeated cells hold 14% of all python code characters, and up to 92% in one run;
- of 129 function redefinitions, 95 were identical to the definition they replaced.

Retyping inside new cells (`block-reps.mjs`, whitespace and comments ignored, 3,343 computing cells, 30,614 lines):
- 217 cells retype a run of five or more lines of an earlier cell among new lines: 1,977 lines (6.5%), against 4,597
  lines (15%) in whole repeated cells;
- su15-l0-3 typed one diff loop (`cur = grid`, a double loop collecting changed cells, the prints) in 24 cells, each time
  after a new `prev = history.grid(n)`.

Saved tools are rarely rewritten (34 paths, 46 versions in all runs). The rewriting is in python cells.

### What was tried, and why it did not hold

- **No-effect refusal** (the fourth click that changes at most 2 cells is refused): the loop moved around it (RESET every
  third click, su15-lr-1020-q38). The user judged it neither fundamental nor general.
- **Stall review after 40 actions:** accurate reviews, behaviour unchanged (su15-chm-q38-1). It comes 40 actions late,
  and it changes an active prompt, not what the decision copies.
- **REPEATED WORK text and the cover hint:** the cover hint fired 0 times in 8 runs; the text never changed a cell.
- **`collapseRepeatedCalls`:** merges consecutive identical rounds only. A decision of three different rounds repeated 29
  times stays 29 times in the transcript.
- **Views, pins, call points (`0ca16629`):** these push the agent's *saved* work. qwen saves almost nothing (34 tool
  paths in all runs), so there is little to push.

### One cause

The agent's own past work reaches it only as raw transcript text. Two things follow:
- copying is the cheapest thing a model can generate;
- nothing records that a piece of work was already done, or what came of it.

So every decision rebuilds:
- the same python cell (rewriting);
- the same decision (spinning): when an action changes nothing, the next context differs from the last only by one more
  copy of the same decision, and a model without reasoning repeats it.

Copying needs a template in the context. The first Continual Harness version (no transcript of earlier decisions) had no
identical decision in 39. The old path with the no-effect refusal had none: a refusal changes what the next decision
reads. su15-chm-q38-1 had the transcript, no refusal, and clicks that changed nothing: 46.

### Claim

**Work memory.** Each piece of work exists once; a repeat becomes a reference to it, not new text. What the agent already
knows about the board it stands on is in front of it. A decision that learns nothing new changes the next turn instead of
being followed by the same one.

Concretely:
1. **Code.** Every python call has an address: its result starts with `[P12]`. A call that repeats an earlier one is
   told so: `[P15 = P12: same code]`. On an unchanged state it is not run again; the earlier result is returned. In the
   transcript, a repeat is shown as `cell(12)`, an executable call that runs P12's code on the current state. Lines a
   new call retypes from an earlier one (whole top-level statements, at least four lines) are named in its address,
   `[P15: lines 3-9 = P7 lines 2-8]`, and shown in the transcript as `cell(7, 2, 8)`, which runs them: the session is one
   namespace, so running those lines where they stood computes what the retyped text computed. Comments and spacing
   outside strings do not make code new. A function defined again with the same body is shown as a one-line stub. The
   python session view lists functions with their arguments. The template the transcript offers for "do that again" is
   a call, not a body.
2. **Decisions.** Consecutive decisions that made the same calls are shown once, with their count and their action
   receipts. An arc_action that repeats an earlier call's arguments keeps its actions, not its reasoning text.
3. **The board.** When the board (status cells masked, as the ledger masks them) was seen before, the head says what was
   played from it and what came of it, and which offered actions and object clicks were never tried from it. Each receipt
   says when its result was already known.
4. **Loop closure.** A decision whose actions all gave results already known from the same board learned nothing (a
   spin; a RESET is neutral).
   - After one spin, the next head opens with NO NEW INFORMATION: what was repeated and since when. The first untried
     candidate of this board is pinned as the next experiment, if nothing else is pinned.
   - After two in a row, the next turn is the stall review (the user's mechanism), with its tests pinned.
   - The next spin review needs twice as many spins, until a decision learns something new.
   - The 40-action stall review stays.

Nothing is refused: every action the agent sends is played.

**Burden removed:**
- re-typing code that already ran;
- copying the last decision;
- remembering what was already tried here;
- noticing a loop. The runtime counts, the agent decides.

**Falsifiers.** Run qwen3.8-27b (thinking off) on su15 with work memory:
- a run of more than 2 spin decisions occurs before an escalation;
- more than 2 identical decisions occur in a row;
- verbatim python repeats stay above 10% of computing cells;
- cells that retype lines of an earlier one stay at su15-chm-q38-1's rate (18 of 123 computing cells, by the replay below);
- `cell(k)` is never called while verbatim repeats persist;
- known replays stay at or above su15-chm-q38-1's share (41 of 110);
- cost per action rises more than 20% over su15-chm-q38-1 (28.4k) without fewer replays;
- or a spin review fires during a setup that leads to a new action in the following decision (a false positive; counted,
  not fatal).

**Reasonable non-use:**
- a level completed before any spin;
- a run whose actions are all new.

**Scope:**
- native foundation: extension, runtime, python guest, transcript projection, runner trigger, one system-prompt line;
- not in scope: refusing actions, the CH observation blocks, refinements.

## Design and cost

### Where each part lives

| Part | Where |
| --- | --- |
| Shared logic (code keys, top-level statements, retyped blocks, def blocks, transcript rendering, board facts, spin streak, object regions) | `demo/arc_thin_work_memory.ts` (new) |
| Python addresses, repeat and retyped-block detection, the same-state cache, `cells` for `cell(k)`, `harness/python_calls.jsonl` | `demo/arc_thin_native_runtime.ts` |
| `cell(k)` and `cell(k, a, b)` in the namespace (kept out of the checkpoint) | `demo/arc_thin_components.ts` |
| Signatures in the python session view | `demo/arc_thin_python_session.ts` |
| Repeats as references and repeated decisions collapsed, in the transcript of earlier decisions | `demo/arc_thin_native_context.ts` (`freezeHistory`) |
| Novelty per action (row fields `novelty`, `known_from`), THIS BOARD, NO NEW INFORMATION, the novelty pin | `demo/arc_thin_extension.ts` |
| The spin-triggered stall review and its doubling | `src/autoresearch_pi/arc_thin_e2e.py` (`--spin-review-after`, `ARC_THIN_SPIN_REVIEW`; 0 turns it off) |

### Lifecycle

| Step | Who advances it |
| --- | --- |
| Opportunity (a repeat) | the runtime, mechanically: same code key; same masked board, action and result |
| Recognition | the receipt (`[P15 = P12]`, `[P15: lines 3-9 = P7 lines 2-8]`, "known"), the transcript (`cell(12)`, `cell(7, 2, 8)`, the collapsed decisions), THIS BOARD |
| Investment | none: the address, the reference and the board facts cost the agent nothing |
| Semantic use | the agent: calls `cell(k)`, `cell(k, a, b)` or its functions, plays an untried move, writes the review |
| Feedback | the next action's novelty; the spin streak |
| Retire | references and facts are rebuilt from the record every request; the pin expires as pins do |

### Cost

- **Resident text:** the `[P#]` prefix (about 6 characters a call, about 25 more per retyped block named), THIS BOARD (at
  most about 450 characters, only on a board seen before), NO NEW INFORMATION (only after a spin), one system-prompt
  sentence.
- **Removed:** repeated code and repeated decisions from the transcript. In su15-chm-q38-1 that was about two thirds of a
  90k-token request near the end.
- **Reviews:** one more per spin escalation, about 100-170k budget tokens in su15-chm-q38-1, bounded by the doubling.
  A spin decision there cost 25-36k.
- **Cache:**
  - a reference is decided when its call is made, from the result's own `[P# = P#]`, so an earlier decision renders to
    the same bytes on every request;
  - a growing run of identical decisions changes the transcript from its first collapsed decision on, as
    `collapseRepeatedCalls` already does.

### Integrity

Kept as they are:
- the bridge, budgets, refusals and environment errors;
- the loop guard and the 16-call cap;
- consult/refine points.

The same-state cache returns a result only when all of these hold:
- the code is identical (comments, blank lines and spacing outside strings aside: the tokens are the same);
- the state, the session version and the workspace writes are unchanged since the earlier call;
- the earlier call succeeded, acted nothing and wrote nothing.

## Experiment protocol (needs the user's budget)

| Item | Setting |
| --- | --- |
| Layer | autonomous adoption and benefit in a real run |
| Run | one qwen3.8-27b su15 run, thinking off, images, `ARC_THIN_OBSERVATION=ch`, r04 with work memory; 6M budget-token cap, no time cap |
| Compared with | su15-chm-q38-1 (same settings without it), su15-cb-q38-1, su15-q38-1..3 of 10-19 |
| Primary | the falsifiers above |
| Secondary | levels, budget tokens per action, requests per action |
| Measures | all with `spin-rewrite.mjs` and `analyze.mjs`: known replays (exact and masked), spin decisions and longest spin streak, identical decisions, verbatim python repeats, retyped blocks, `cell(k)` and `cell(k, a, b)` calls, cache hits, novelty pins set and played, spin reviews, transcript characters per request |
| Negative cases | a setup replay legitimately followed by a new action (counted when a review interrupts it); a game whose status line is its goal (masked, so its progress reads as spin; counted) |

## Implementation and checks

Built on `claude/zen-dewdney-513a92` from r04 at `13290920`. `ARC_THIN_WORK_MEMORY=0` turns all of it off (addresses,
references, the decision collapse, novelty texts, the novelty pin, spin reviews). `ARC_THIN_SPIN_REVIEW=k` or
`--spin-review-after k` sets the spin review threshold (default 2; 0 turns only the spin review off).

### Functional checks (local; no provider)

- `tests/arc_thin_work_memory.test.ts` 12/12:
  - code keys (comments, spacing, strings);
  - top-level statements and retyped blocks;
  - addresses and their parsing;
  - the transcript's references: `cell(k)`, `cell(k, a, b)`, def stubs, a repeated arc_action without its reasoning;
  - the decision collapse;
  - novelty, board facts and text, the spin streak.
- `tests/arc_thin_work_memory_loop.test.ts` 2/2: the extension against an HTTP stand-in world shows the known receipt, NO
  NEW INFORMATION, THIS BOARD, the novelty pin and its TEST RESULT; with `ARC_THIN_WORK_MEMORY=0` none of them.
- `tests/arc_thin_native_runtime.test.ts` 2/2:
  - addresses and the same-state cache;
  - what invalidates the cache: a new state, a workspace write;
  - `cell(k)`, and retyped lines named and run with `cell(k, a, b)`;
  - the `python_calls.jsonl` log.
- `tests/test_arc_thin_work_memory.py` 4/4: the runner's spin streak, the spin review prompt, its threshold and doubling,
  and the off switches.
- Files next to the change, unchanged in result: native_context 9/9, history 3/3, native_repetition 5/5, python_session
  4/4, ch_observation 7/7; stall review pytest.
- Full suite: TypeScript 249 of 255 tests in 44 files, pytest 46 of 46 (the runner, review, recovery, accounting and
  config files). The failures:
  - five fail the same way at the base (`13290920`, the 10-20 run on record): activation 1, components 1, receipts 3;
  - `arc_thin_action_surface` (the installed global Pi 0.80.6 loading the extension) timed out after 20 s with no output
    on its first three runs after the change, then passed twice in 3-4 s. It had timed out the same way on
    `worktrees/r04-ch` before this change.

### Replay on recorded runs (diagnostic, not a run)

`C:/Users/qi/tmp/r04/spin/replay-wm.mjs` recomputes from each run's trajectory, states and session:
- the novelty each action would have got (masked hashes over the states up to it);
- the spin streak after each decision;
- THIS BOARD at the first spin;
- the transcript of earlier decisions at the end, with and without references. The python addresses are given as the
  runtime would have given them.

| Run | Actions (known) | Longest spin streak | Spin review due | Spin decisions after it | Transcript characters at the end | `cell(k)` / `cell(k, a, b)` shown |
| --- | --- | --- | --- | --- | --- | --- |
| su15-chm-q38-1 | 110 (70) | 29 | decision 8 (after #17) | 47 (59 actions) | 310,939 → 149,717 | 12 / 18 |
| su15-lr-1020-q38 | 236 (167) | 102 | decision 38 (after #53) | 158 (158 actions) | 242,748 → 208,919 | 6 / 8 |
| su15-q38-1 (10-20) | 180 (130) | 19 | decision 27 (after #46) | 34 (119 actions) | 192,633 → 150,668 | 37 / 5 |
| su15-ch-q38-1 | 53 (32) | 8 | decision 12 (after #14) | 11 (27 actions) | 389,650 → 384,354 | 0 / 3 |
| su15-cb-q38-1 | 230 (14) | 1 | none | 0 | 306,171 → 305,860 | 1 / 1 |
| su15-g61-1 (gpt-6.1-sol) | 206 (20) | 5 | decision 76 (after #110) | 6 (11 actions) | 157,237, unchanged | 0 / 0 |
| su15-l0-3 | 194 (20) | 8 | decision 143 (after #142) | 19 (19 actions) | 423,473 → 411,257 | 6 / 34 |
| su15-lr-p13-q38 | 84 (6) | 5 | decision 47 (after #67) | 3 (3 actions) | 166,668 → 134,266 | 22 / 6 |
| su15-r2 | 261 (55) | 20 | decision 22 (after #27) | 26 (34 actions) | 409,885 → 403,827 | 0 / 30 |

The replay shows where the mechanisms would have fired and what the transcript would have held. It cannot show what the
agent would then have done: every later decision in these runs was made without work memory.
- On the three loop runs, the first spin review would have come two spin decisions in, where the runs went on for 34 to
  158 more. Whether the agent leaves the loop after it is the open question: su15-chm-q38-1's 40-action reviews did not
  end its loop.
- The false-positive side: the best run, su15-g61-1, would have had one spin review, at decision 76; su15-cb-q38-1 none.
- Masking counts clicks that only fill a status bar as known (su15-chm-q38-1: ACTION6(30,30) ×9, only status cells
  changed). In a game whose goal shows in the status line this reads as a spin (a negative case of the protocol).

### Evidence layers

| Layer | Status | Provider / environment | Artifacts and limits |
| --- | --- | --- | --- |
| Functional | passed (the known base failures aside) | local Windows, no provider | the tests above |
| Full-chain reachability | unverified | — | needs a real ARC run; the loop test drives the extension against a stand-in HTTP world, a diagnostic check |
| Autonomous adoption | unverified | — | whether qwen calls `cell(k)` and `cell(k, a, b)`, plays the pinned untried moves and leaves a loop after a spin review |
| Net benefit | unverified | — | levels, budget tokens per action, spin decisions and retyped code against su15-chm-q38-1 |

Next falsifiable check: the protocol run above, one qwen3.8-27b su15 run with a 6M budget-token cap, judged on the
falsifiers.
