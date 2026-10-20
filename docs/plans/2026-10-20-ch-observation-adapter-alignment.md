# Align the native observation and action adapter with Continual Harness (2026-10-20)

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
| A PNG of each rendered grid, in prompt order, 1 px per cell, ARC-AGI-3 palette | Ported; attached when the model takes images. |
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
