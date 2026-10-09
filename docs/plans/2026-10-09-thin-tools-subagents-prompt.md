# Meta-harness change record: thin harness gets custom tools, saved subagents, and a visible prompt slot

Date: 2026-10-09 (Asia/Shanghai). Status: **implementation in progress; real-provider evaluation not run** (a paid run needs a budget from the user).
Follows [development-workflow.md](../development-workflow.md) and the [change template](../templates/meta-harness-change.md). Runtime design of the thin path: [2026-10-08-thin-arc-self-harness-extension.md](2026-10-08-thin-arc-self-harness-extension.md) (its §4 "Why there is no subagent store" is superseded by this record).

## Problem and claim

The user's review of the thin self-harness (2026-10-09) named three gaps. Each is one component of the five-component matrix (system prompt, skills, memory, tools, subagents).

### Prompt: the persistent-instruction tool is almost never used

- **Material.** Four real thin runs, all yibu / qwen3.8-27b on ls20:

  | Run | Decisions | `prompt` attempts | Saved | Mentions in assistant thinking/text |
  | --- | --- | --- | --- | --- |
  | [p1-real-20261008](../../runs/pi-arc-thin-ls20-treatment-p1-real-20261008/summary.json) | 50 | 0 | 0 | 0 |
  | [board-real-20261009](../../runs/pi-arc-thin-ls20-board-real-20261009/summary.json) | 47 | 0 | 0 | 0 |
  | [p1-uncapped-real-20261009](../../runs/pi-arc-thin-ls20-treatment-p1-uncapped-real-20261009/summary.json) | 321 | 3 | 1 | (attempts only) |

  Mentions were counted with a regex over `pi-events.jsonl` (`standing instruction|prompt overlay|the prompt tool|` `` `prompt` ``|`prompt\(`).
- **Observed.** In the two shorter runs the tool never entered deliberation: there is no attempt and no mention. So nothing was "considered and declined". The opportunity → recognition transition failed.
- **Observed.** In the uncapped run, 2 of the 3 attempts were refused by the per-decision tool-call caps, not by the prompt tool: `pi-events.jsonl` lines 651 (consolidation cap 12) and 4554 (hard cap 16). The model wrote the overlay last, after many memory calls.
- **Observed (code asymmetry).** Every other component has a per-decision affordance in the working set; the prompt slot has none.
  - Skills show `SKILLS: none — write one with skill(op="set") …` when empty.
  - Memory and hypotheses always render.
  - The prompt slot shows nothing when empty, and when set it lives only in the system prompt.
  - The consolidation prompt names memory and skills but not prompt.
  - The system prompt routes the obvious "standing rule" use into memory ("Keep one `plan` fact").
- **Not established.** Why the model did not consider the tool. The asymmetry is a candidate cause. Functional overlap with memory (both are resident every decision) is another, and the logs cannot separate the two.

### Tool: no interface for standalone custom tools

- Six fixed tools. Programmable calculations exist only as Python skills, called indirectly through `run_skill(name, args)` with an untyped `args` dict. A saved calculation never becomes a first-class tool: no own name or schema in the tool list, no argument validation, and it cannot be handed to another agent as a tool.

### Subagent: no way to create, save, or configure subagents

- Only the predefined `ask_analyst`: one completion call to the same model with the question, the current grid, and optionally the previous grid and memory.
  - It has no tools and no history.
  - It cannot act in the game, modify components, or keep an ongoing responsibility.
  - Repeated calls start from zero, so continuity is lost and each call pays the full context again.
- Usage: 4, 3, and 9 calls in the runs above; tokens appear in `usage.jsonl` as `kind="analyst"`.
- The level-0 diagnosis of the uncapped run found that an analyst answer reused a counterexample whose condition was missing. A one-shot analyst cannot carry the earlier conversation in which that condition was established.

### Narrow claims (one per component)

1. **Prompt.** If the standing-instruction slot gets the same resident affordance skills already have, then in an ordinary run the agent will at least *consider* the slot. The affordance is a one-line state in the working set, a mention in the consolidation turn, and a one-line role split in the system prompt ("rules for how you decide; memory holds what you know"). "Consider" means an attempt, or a mention in thinking.
   - Falsified if a run of ≥ 50 decisions still shows 0 attempts and 0 mentions.
   - Usefulness is a separate, later question.
2. **Tool.** An agent (or subagent) can turn a calculation into a typed tool in **one call**. The tool appears in its tool list from the next step, is validated by Pi, survives a Pi restart, and can be granted to subagents.
3. **Subagent.** An agent can save a helper with its own instructions, a tool subset, and a conversation kept between calls. It can then ask the helper repeatedly, and the helper sees what happened since its last call. Optionally, the helper reports on its own every N actions, so an ongoing responsibility costs the parent no decision step.

### Burden removed

- **Tool:** the `run_skill` indirection and untyped args for frequent calculations.
- **Subagent:** re-explaining context to a fresh analyst on every call. The helper keeps the last exchanges and its notes and receives the action log since its last call mechanically.
- **Subagent:** a parent decision step per check for a standing watch (`every`).

### Scope and non-goals

- Thin path only. The legacy extension, the evidence board, the memory format, the tool-call caps and the `arc_action` boundary are unchanged.
- **Subagents do not take game actions.** This keeps the single-life model: one canonical history, and the parent owns every step ([2026-09-20 single-life model](2026-09-20-agent-native-single-life-harness.md)). A subagent can propose a test; the parent executes it.
- No permanent model process. Continuity is a persisted transcript plus notes ([Auto-Research ADR](2026-10-01-auto-research-mechanism-and-workers.md): "do not require a permanent model process to preserve a research topic").

## Design and cost

- **Choice.** Reuse what exists rather than adding a worker runtime:
  - Custom tools reuse the skill sandbox (the same `run(state, args)` contract, syntax check and WASI runner) and Pi's own dynamic `registerTool`.
  - Subagents reuse the `completeSimple` path of `ask_analyst`, with a short tool loop.
  - The one-off analyst is kept as `ask_subagent` without a name, so `ask_analyst` is folded rather than duplicated.
- **Interfaces** (one call each):
  - `tool(op="set", name, description, params={arg: {type, description?, optional?}}, source)` saves a typed tool and registers it natively. `op="get"|"delete"` also exist. Limits:
    - at most 12 custom tools and 8 params;
    - built-in names are reserved;
    - delete removes the tool from the active set (Pi has no unregister), and its execute refuses afterwards.
  - `subagent(op="set", name, role, tools=[…], include_memory?, every?)` saves or updates a subagent. An update keeps its conversation.
    - Grantable tools: `run_skill`, `skill`, `tool`, `memory`, and the agent's custom tools.
    - Never grantable: `arc_action`, `prompt`, `subagent`, `ask_subagent`.
  - `ask_subagent(name?, message, include_memory?, include_prev_grid?)`. Without a name it is the old one-off analyst.
- **Subagent call.**
  - System prompt: role plus a fixed frame. The frame says the subagent cannot act, sees notes, actions since its last call, and the grid, and should give conclusions first.
  - Messages: its last 4 exchanges (text only), then `YOUR NOTES`, `ACTIONS SINCE YOUR LAST CALL` (≤ 20 lines), the current grid (plus image if supported), optional memory, and the message.
  - Tool loop: at most 6 rounds. Each subagent also has a private `notes` tool.
  - Results are truncated at 4000 characters. Arguments are validated with pi-ai `validateToolArguments`.
  - Every model call is logged in `usage.jsonl` as `kind="subagent"` with the subagent's name. The receipt shows model calls and tokens.
  - Turns, notes and configs are stored in `subagents.jsonl`, and component writes are tagged `by: "subagent:<name>"`.
- **Scheduled reports.**
  - Before a normal decision (not during consolidation), at most one subagent with `every = N` is consulted, once N actions have passed since its last turn.
  - Its reply is shown once in the working set as `SUBAGENT REPORT <name> (scheduled, after action #k)`.
  - Failures are logged and never block the decision.
- **Working set.** The component directory becomes four lines when empty: SKILLS, TOOLS, SUBAGENTS, STANDING INSTRUCTIONS. Non-empty entries list their names. The overlay text itself stays in the system prompt.
- **Lifecycle.** Opportunity and recognition belong to the agent (no runtime suggestion). Investment is one call. Assembly is mechanical: a saved component is active, and Pi refreshes the tool list. Semantic use is the agent's tool call or ask. Feedback comes from receipts, failures with line numbers, and scheduled reports. Retire with `op="delete"`. Subagent-authored components are attributable through `by`.
- **Added resident cost** (per request):
  - three short directory lines (≈ 60 tokens);
  - two built-in tool schemas replace one (`tool`, `subagent` and `ask_subagent` replace `ask_analyst`);
  - each custom tool's schema;
  - about 15 system-prompt lines.
  - Subagent and scheduled-report tokens are new **child** cost, accounted in `usage.jsonl` and in the runner's token cap. Not measured yet.
- **Removed.** The `ask_analyst` schema, and re-sending full context to a fresh analyst for follow-up questions.
- **Integrity and permissions.**
  - Subagents cannot reach the bridge or `arc_action`.
  - Custom tools run in the same sandbox as skills: standard library only, no I/O, the same limits.
  - The decision gate and caps still apply to the parent's calls, including each `ask_subagent`. Subagent rounds are bounded separately (6).
- **Stop and recovery.** The agent deletes tools and subagents. Replay of `tools.jsonl` and `subagents.jsonl` restores them after a Pi restart, and custom tools are re-registered at load. A failed scheduled consult only writes `errors.jsonl`.

## Pre-run experiment protocol (not run; needs a budget)

- **Target level.** Functional + full-chain (scripted smoke) now. Autonomous adoption only with a real run.
- **Variable.** This change against the current thin treatment (same runner, board off).
- **Comparator.** The existing real baselines above for the prompt question. There is no baseline for custom tools or subagents (the capability did not exist), so their first real run is exploratory.
- **Setup.** yibu / qwen3.8-27b, `provider-default` thinking, ls20, official ARC SDK, 50 actions, ≤ 1.2 M reported tokens, 1800 s. One exploratory sample, then a decision.
- **Primary observations.**
  - Prompt: attempts and mentions per 50 decisions (claim 1).
  - Custom tools and subagents created; first semantic use (a tool result or subagent reply cited in a later `note` or memory write).
  - Subagent continuity: whether a later ask relies on an earlier exchange.
  - Child tokens as a share of the total.
  - Levels and actions as context only.
- **Negative cases.**
  - No custom tool is warranted: a game solved by inspection.
  - A subagent asked once and abandoned.
  - Scheduled reports ignored, at nonzero cost. This is a cost to report, not a success.
- **Falsification and retirement.**
  - The claim 1 condition above.
  - Child tokens > 30 % of total with no cited use → turn off `every`, or retire subagents from the default.
  - Any harness error from the new paths → fix before any further real run.

## Implementation and verification

Pending.

| Evidence level | Status | Provider / environment | Artifacts and limits |
| --- | --- | --- | --- |
| Functional correctness | not verified | — | — |
| Full-chain reachability | not verified | — | — |
| Autonomous adoption | not verified | — | needs a real run with a budget |
| Net benefit | not verified | — | needs paired runs |

## Delivery decision

Pending.
