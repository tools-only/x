# Align the native observation and action adapter with Continual Harness (2026-10-20)

**Status, later on 2026-10-20:** rolled back at the user's request (`fac1e771`; see [Rollback](#rollback-2026-10-20)),
then reimplemented with only CH's game observation and ARC action tool (see
[Narrowed reimplementation](#narrowed-reimplementation-2026-10-20)). The sections from "Request and claim" to
"Evidence" describe the rolled-back version (`e79898f9`).

## Request and claim

User, 2026-10-20: "Practically speaking, CH's observation and adapter design perform better. Therefore, please first
align our observation and adapter settings with CH. align with every detail."

Claim: what the native agent sees each decision, and how its actions reach the environment, follow Continual Harness
(CH). The reference is `D:/arc-agi-benchmark/Continual-Harness-ARC-AGI-3`, read 2026-10-20:
`agents/templates/continual_harness_agent.py`, `continual_harness/{context,helpers,trajectory,tools,models,
action_descriptions,sandbox}.py`, `utils/vlm_backend.py` (the OpenAI chat route its `.env` selects) and
`prompts/harness_system.md`. Our harness components stay as they are: memory and hypotheses with checks, rules and
strategy prompts, the refiner and ledger, python with its live session, views, and binder-versioned files.

The switch is `ARC_THIN_CH` (native only). It is on by default; `ARC_THIN_CH=0` restores the earlier observation and
action path. The runner records `observation_delivery: "ch"` in run-config.json, and pins `ARC_THIN_CH=0` for the
scripted smoke provider, whose steps call the earlier arc_action.

Burden addressed: the agent re-derives per-move changes by hand (25–30 python cells per qwen run), never learns action
meanings (the C+B run confirmed that ACTION7 is undo only at #184), RESETs at will (30 RESETs in a row ended
su15-q38-1 of 2026-10-20), and pays for a growing transcript (105k–156k tokens; 75% of budget tokens went to provider
cache misses on it).

## What changes (CH detail → ours)

| CH | Ours with `ARC_THIN_CH` |
|---|---|
| Each decision is a fresh conversation: the working prompt (plus images), then that decision's tool rounds. Earlier decisions are not re-sent. | Native context sends no earlier-decision transcript. The head is the CH working prompt; the decision's own rounds follow. |
| Working prompt: base policy, overviews, `## RECENT HISTORY`, `# Step: n`, `## OBSERVATIONS SINCE LAST QUERY`, `## TOOL RESULTS FROM PREVIOUS TURN`, `## PREVIOUS CONVERSATION STOPPED WITHOUT ACTION`, `## CURRENT STATE`, `## TURN`, joined by blank lines | Same order. The active prompts (strategy, rules: our evolving policy) open it and leave the system prompt, as CH's base policy sits in the working prompt. Then our overviews: memory and rivals, rule checks, python session, refiner notices, capability index and view outputs. The runner's plain "Decide the next action." is dropped. Reviews keep the earlier working set and leave pending observations to the next decision. |
| `# Step: n`, n = actions so far including the starting RESET | Same number: the next action's `#n`. The bridge's own first RESET is CH's step 0 (shown once in OBSERVATIONS, kept in RECENT HISTORY). |
| RECENT HISTORY (`render_recent_history`, 12,000 characters) | Ported line for line. Sources: `arc_action`, `python`, `tool: <name>`, and `auto_reset` shown as `reset`. |
| OBSERVATIONS SINCE LAST QUERY: RESULT line, animation summary, key frames by priority (at most 4) as hex | Ported. Covers every action since the previous decision's prompt: arc_action steps, env.act steps, the automatic RESET. |
| CURRENT STATE: state, score, available actions with meanings (RESET never listed), current grid as hex | Ported (`ACTION_DESCRIPTIONS` verbatim). The action budget is not shown there. |
| A PNG of each rendered grid, in prompt order, 1 px per cell, ARC-AGI-3 palette | Ported; attached when the model takes images. Since the user's "accept images and make it default" (2026-10-20) the thin runner declares text and image input unless told otherwise (`--input-modalities text` or `ARC_INPUT_MODALITIES=text` for a text-only model). A probe that day: qwen3.8-27b on yibu described a 64×64 PNG correctly (66 image tokens). |
| TOOL RESULTS FROM PREVIOUS TURN: the decision's non-action results (last 16); newest 2 in full, older ones recapped, repeats pointed at the first; Python `json.dumps` text | Ported, including Python's separators and `ensure_ascii`. A text result is the record's `stdout`, an error its `error`, the actions code played `actions_taken_inline`. Calls in the acting response are carried too. |
| Within a decision a tool's answer is `format_tool_record_md(record)` | Same: each result is replaced by its record at message end. |
| PREVIOUS CONVERSATION STOPPED WITHOUT ACTION with the reason | Same reasons: `max_conversation_turns: hit MAX_CONVERSATION_TURNS=24 without an action`, `vlm_error: …`, `model response contained no function calls`, `conversation ended without an action`; ours adds the loop guard's. Not after WIN/GAME_OVER, and a review does not replace the decision before it. |
| At most 24 turns per decision | Same (24 assistant messages); the old 16-call cap is not used. |
| take_actions(reasoning, actions[{name, x, y}]); name a plain string; list checked once and truncated at the first bad entry; each step rechecked; stops at WIN, GAME_OVER or a level change; no length cap; several take_actions in one response all run; 0 executed returns CH's record and the decision goes on | `arc_action` with the same schema, description and semantics (names repaired as CH's OpenAI backend repairs them; coordinates clamped as CH clamps them). Optional `predict` per action and `idea` remain (scored predictions, ledger); no stop on a missed prediction, no no-effect refusal. |
| Calls after a terminal state in the same response are not dispatched | Refused and not carried. |
| RESET is not an agent action; the harness RESETs at NOT_PLAYED and after GAME_OVER (after evolving), and drops the carried tool results | RESET removed from what arc_action and env.act accept. At the next decision after GAME_OVER the extension plays RESET (`auto_reset`) and drops the carried results; the runner's review of a GAME_OVER comes first, like CH's evolution. |
| Step records keep `grid_change` and `grid_delta` (≤ 50 cells), source and batch fields | Trajectory rows add `grid_change`, `grid_delta`, `source`, `batch_id/position/total`, `batch_rejected`, `state_before`, `levels_before`; the list's reasoning is its first step's `note`. |
| Skills act with `tools.take_actions(actions=[...])` → `{executed_count, last_frame, terminal, level_changed, state, score, available_actions}`; refused only after a terminal state | `env.act([...])` plays a list the same way and returns the same fields; single `env.act` stays. Code may act on after a level change, as in CH. |
| Sandbox state: `observations` (each action since the query, whole animation), `recent_trajectory` (last 80 records), `available_actions` without RESET | Python state adds `observations` and `recent_trajectory`; `available_actions` without RESET. |
| System instruction: INPUT FORMAT, COORDINATE SYSTEM, action key, short lists, GAME SETTING, soft guideline | `prompts/arc_thin_native_ch_system.md`: CH's sections, our capability text, worded for our tools. |

## Deviations kept on purpose (open to the user)

- **Tool names** stay ours (`arc_action`, `python`, `memory`; CH: `take_actions`, `run_skill`, `process_memory`).
- **Python grids stay ints**, not hex strings: checks, views and the python session use ints. The system prompt says a
  hex digit is `int(ch, 16)`; `observations` frames arrive as hex and are ints in python.
- **No PIL images in python** (`state.images`); the sandbox has none.
- **ACTION6 without x and y is refused**; CH clicks at (0,0).
- **A list with several ACTION6 entries clicks each entry's coordinates.** CH validates the whole list first and sets the
  data on the shared `GameAction.ACTION6` member, so every click in such a list uses the last entry's coordinates; that
  defect is not reproduced.
- **In-decision results are the record text.** CH's OpenAI chat route sends it JSON-escaped inside `{"output": ...}`.
- **Reasoning within a decision is kept** (our context management). CH's chat route keeps only an assistant message's
  text and tool calls between rounds.
- **Context guard:** Pi's own context management stays; CH's guard at 80% of the window is not ported.
- **The loop guard stays** (three identical results end the decision): the yibu gateway refuses requests that repeat a
  call.
- **At most 24 env.act calls per python call** (MAX_ACTS); CH bounds a skill by 30 s of wall clock.
- **One extra turn remains possible**: Pi ends a run only when every result of a response ends it, so a response like
  [memory, python that acts] (memory finishing first, without arc_action) gets one more turn whose calls are refused and
  not carried. CH ends after the response.

## Evidence

- Functional (this machine, node 22, 2026-10-20):
  - `tests/arc_thin_ch_view.test.ts` compares the port with CH's own renderers. Goldens in
    `tests/fixtures/ch_golden.json` were produced by CH's code from the same inputs (`tools/ch_golden.py`, run in CH's
    venv). Covered: the observation section under a 4-grid and a 1-grid budget, recent history (elision included), tool
    results (recap, repeat pointer, lifted code, Python JSON), the state block, `grid_change`/`grid_delta`, PNG pixels,
    and the action-list check.
  - `tests/arc_thin_ch_mode.test.ts` runs the extension in CH mode against an HTTP stand-in: the working prompt and
    system prompt, list play and truncation, a level change, a list that plays nothing, the automatic RESET after
    GAME_OVER, and the 24-turn cap.
  - `tests/arc_thin_components.test.ts`: env.act with a list.
  - Tests of the earlier path pin `ARC_THIN_CH=0`.
- Reachability, adoption and benefit: unverified until a real run.
- Proposed check: 1 qwen run (su15, 6M budget tokens) and 1 gpt-6.1-sol run, against su15-cb-q38-1 and su15-g61-1.
  Measure levels, budget tokens per action, uncached input per request, hand-written diff cells, list lengths and their
  truncations, ACTION7 use, and decisions ended by the 24-turn cap.

## Rollback (2026-10-20)

User, after the first run and a review of what this version contained: "My goal is only to keep r04's game observations
and ARC-related predefined tools/information consistent with CH. But r04 itself is an independent architecture. I do not
want extra mechanisms, constraints or limits leaking into r04." Then: "I prefer to first roll back the current
CH-aligned implementation, then reimplement only the aligned components."

What this version carried beyond that scope:

- CH's decision loop: a fresh conversation per decision (no transcript of earlier decisions; the active prompts moved
  out of the system prompt), TOOL RESULTS FROM PREVIOUS TURN, PREVIOUS CONVERSATION STOPPED WITHOUT ACTION, the TURN
  block, the 24-turn cap in place of the 16-call cap, the "at most 2 tool calls per response" guideline, CH's record
  format for every tool result, and the harness's RESET after GAME_OVER with RESET taken from the agent.
- CH's handling of malformed calls (no repair), copied as part of "every detail".
- r04 parts switched off or cut off: the no-effect refusal, the `then` list's stop at a missed prediction, the stop on
  code acting after a level change; RESOURCES (P2's attempts line), the remaining-action count, prediction scores and
  P1's overdue note no longer reached the agent; the runner's restart note was dropped with its "Decide the next
  action." prompt.

Evidence from the one real run, `runs/arc-ch-20261020/su15-ch-q38-1` (r04-ch `425536d1`, yibu qwen3.8-27b, thinking
off, text and image): 38 decisions and one GAME_OVER review, 53 actions, 0 levels; it stopped on environment timeouts
(`environment_outcome_unknown`) after 3,816 s. 1,617,746 budget tokens, 30.5k per action, against 15.0k in
su15-cb-q38-1 (1 level) and 22.6k, 21.5k, 17.0k in su15-q38-1..3 of arc-models-20261019 (2, 1, 0 levels), all qwen with
thinking off. 8 of 44 arc_action calls played nothing because `actions` arrived as malformed JSON text (brackets closed
out of order); every one was a list whose entries carried a nested `predict`. ACTION6(48,15) was played 25 times in a
row (#10-#34), 2 cells each, mostly in lists of 4, until GAME_OVER at #34; the no-effect refusal was off. No decision
reached the 24-turn cap; decisions 3-5 made 18, 23 and 17 calls. No level was completed, so the level review never ran
in this mode.

Layers for this version: functional, passed (its tests); full chain, reached in one real run; adoption, lists were used
(six lists of 4) and RESET was never sent (it could not be); net benefit, not shown, and the single run spent more per
action than the four earlier runs (one run with confounds, not a comparison).

The rollback reverts `e79898f9`: `demo/arc_thin_ch_view.ts`, `demo/prompts/arc_thin_native_ch_system.md`, the CH-mode
tests, the goldens and their generator, and the extension, component and runner changes. Kept: this record, the
image-input default (`425536d1`, the user's request), and the level review, which never depended on this mode. The
native path is again the one before `e79898f9`: query observation, arc_action `{action, x, y, then}`, RESET as the
agent's action, the transcript of earlier decisions, the 16-call cap and the no-effect refusal.

## Narrowed reimplementation (2026-10-20)

Claim: the native agent sees the game as CH shows it and acts through CH's action tool; everything else is this
harness's: the transcript of earlier decisions, active prompts in the system prompt, the runner's prompts (restart notes
included), the 16-call cap, the loop guard, the no-effect refusal, the stop at a missed prediction, RESOURCES, receipts,
reviews, and RESET as the agent's action. Burden addressed, as before: per-move changes re-derived by hand (21 hand diffs
of consecutive moves in su15-cb-q38-1, 0 in su15-ch-q38-1, where the agent quoted the rendered rows) and action lists
lost to call shape (8 of 44 in su15-ch-q38-1).

Switch: `ARC_THIN_OBSERVATION=ch`, the runner's native default; the runner passes the value to the extension, whose own
fallback stays `query` for tests that build it directly. `query` and `inline` remain; the scripted smoke provider runs
`query`. Source: `demo/arc_thin_ch_view.ts` (CH's renderers and action-list check only), `demo/arc_thin_extension.ts`,
`demo/arc_thin_boundary.ts` (repairActionList), `demo/arc_thin_components.ts` (env.act lists),
`demo/prompts/arc_thin_native_ch_arc.md` (ARC information), placeholders in `demo/prompts/arc_thin_native_system.md`.

| CH (kept) | Here |
|---|---|
| RECENT HISTORY, `# Step`, OBSERVATIONS SINCE LAST QUERY (key frames, at most 4), CURRENT STATE (action meanings, hex grid), a PNG per rendered grid | In place of this harness's recent-action list and current-state block, at the end of the decision's working set; memory, rule checks, the python session, refinement notices, RESOURCES and the capability index stay around it. A review shows CURRENT STATE beside its own material and leaves the observations to the next decision. The bridge's first RESET is step 0. Observations a decision showed but the model never answered are shown again. |
| `take_actions(reasoning, actions[{name, x, y}])`: checked once, cut at the first bad entry, each step rechecked, stopped at WIN, GAME_OVER or a level change | arc_action with that schema and description. This harness's `predict` per entry, `predict_skill` and `idea` stay; the list also stops at a missed prediction (the then list's rule) and plays at most 12 actions (THEN_STEPS + 1); one arc_action per decision; each step passes this harness's boundary (no-effect refusal, budget, environment errors); a list that plays nothing is refused with CH's message and the decision goes on. RESET is accepted when the environment offers it. |
| Skills' `tools.take_actions(actions=[...])` → `{executed_count, last_frame, terminal, level_changed, state, score, available_actions}` | `env.act([...])` plays one batch and returns those fields (int grids); `env.act({name, x, y})` plays one entry; `env.act(action, x, y, predict)` is unchanged. A list also stops at a missed prediction; code still may not act after a level change in the same call. |
| Sandbox state: `observations`, `recent_trajectory` | `state["observations"]` and `state["recent_trajectory"]` (80 step records); `available_actions` as offered, RESET included. |
| System instruction: INPUT FORMAT, COORDINATE SYSTEM, the action key, short lists, GAME SETTING | `prompts/arc_thin_native_ch_arc.md` closes the native system prompt, RESET in the action key. Not taken: the soft guideline, "RESET is not one of your actions". |

Argument repair (this harness's adapter, not CH's): a list sent as text is parsed with its closing brackets put in order
(the 8 malformed lists of su15-ch-q38-1 parse), one entry sent alone is a list of one, names may come as text
("ACTION6(12,30)"), a gateway's protocol text after a name is dropped (CH's own backend repair), coordinates are
clamped, and a malformed prediction is dropped rather than the action refused.

Not reimplemented (CH's loop): the fresh conversation, carried TOOL RESULTS, PREVIOUS CONVERSATION STOPPED, the TURN
block, the 24-turn cap, CH's record format for this harness's tools, the harness's RESET after GAME_OVER, and several
arc_action calls per response.

Evidence (this machine, node 22, 2026-10-20):

- Functional: `tests/arc_thin_ch_view.test.ts` against goldens regenerated with CH's own code (`tools/ch_golden.py` in
  CH's venv; tool-result cases dropped): the observation section under a 4-grid and a 1-grid budget, recent history,
  the state block (RESET added when offered), grid changes, PNG pixels, the list check. `tests/arc_thin_ch_observation.test.ts`
  against an HTTP stand-in: the head's order and contents, the system prompt, list play, cut and level-change stop, the
  missed-prediction stop, the no-effect refusal, an empty list refused, RESET as the agent's action with no automatic
  RESET, unanswered observations shown again, the earlier decision kept as transcript. `tests/arc_thin_boundary.test.ts`:
  the repair on the run's malformed lists. `tests/arc_thin_components.test.ts`: env.act with a list and with one entry.
- Full chain, adoption, net benefit: unverified; no real run of this version.
- Proposed check (needs a budget): one qwen3.8-27b su15 run at 6M budget tokens, thinking off, against su15-cb-q38-1,
  su15-q38-1..3 and su15-ch-q38-1. Measure action lists lost to call shape (expect 0), hand diffs of consecutive moves,
  budget tokens per action, decisions reaching the 16-call cap, and levels.
