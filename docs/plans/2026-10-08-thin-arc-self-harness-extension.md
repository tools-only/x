# Thin ARC self-harness extension — design

Date: 2026-10-08. Status: design draft, nothing implemented. Replaces the parent-side ARC path (`pi_arc_agi_3_extension.ts` + `pi_external_benchmark_research.ts` + their ~26k lines of imports) with one extension of roughly 1,200 lines that reuses the bridge, the official adapter renderer, and the WASI Python runner.

## 1. Goals and non-goals

Goals:

1. The agent can save and use five kinds of component — memory, skill (Python program), prompt overlay, and a one-shot analyst subagent — with **one tool call each**, no manuals, no versions, no assembly, no activation.
2. The agent has an **immediate, structural reason** to use them: the transcript is rebuilt from the stores at every decision, so anything not saved is gone.
3. A harness failure **never costs an ARC action** and always comes back with a copy-pasteable fix.
4. Every extension error is **visible in the run artifacts**.
5. The adapter is small enough to read in one sitting and has no behaviour flags beyond bridge URL/token and the run root.

Non-goals (deliberately dropped; see §12 for the mapping from the current design):

- Research children, workers, findings, routing, approvals, Jev.
- Compare-and-swap versions, assembly revisions, selection, `activate`/`focus`.
- Runtime-pushed review windows, conversion intents, pattern candidates, evidence indexes, effect assessments.
- Token admission estimation inside the extension (the runner enforces budget between decisions from Pi's reported usage).
- Multiple tool program formats. One format: ordinary Python.

## 2. File layout and line budget

| File | Role | Lines (target) |
|---|---|---|
| `demo/arc_thin_extension.ts` | tools, hooks, stores, context builder | ~750 |
| `demo/pi_arc_bridge_client.ts` | **reuse**; add a 10 s `AbortSignal.timeout` | 75 → ~85 |
| `demo/arc_agi_3_official_adapter.ts` | **reuse** `renderArcLatestFrameRuns` | 79 |
| `demo/pi_arc_frame_image.ts`, `pi_arc_observation_layout.ts` | **reuse** PNG + coarse layout | 141 |
| `demo/pi_task_python.ts`, `demo/pi_task_python_runtime.py` | **reuse** WASI CPython; return traceback tail on error | 139 + ~10 |
| `demo/prompts/arc_thin_system.md` | the whole system prompt | ~300 words |
| `src/autoresearch_pi/arc_thin_e2e.py` | new runner: bridge + Pi RPC loop + budget + consolidation turns | ~400 (vs 2,861) |

Total new TypeScript ≈ 1,200 lines including reuse. Everything else under `demo/` stays for the old path and is not loaded.

## 3. What the model sees

### 3.1 System prompt (forced, replaces Pi's coding-assistant preamble)

`before_agent_start` sets `event.systemPromptOptions.forceSystemPrompt` to the rendered `arc_thin_system.md` plus the current prompt overlay. Draft text:

```
You are playing ARC-AGI-3 game {{game}}. Objective: reach WIN, avoid GAME_OVER,
use as few actions as possible. A frame is a 64x64 grid of integers 0-15;
(x,y) addresses frame[y][x]. Only ACTION6 takes x,y.

How a decision works
- Each decision you receive: your saved memory, your skill directory, the last
  few actions with their effects, and the current grid. Nothing else from earlier
  decisions is shown again. If you want to remember a fact, rule, hypothesis or
  plan, save it with `memory`. Unsaved reasoning is lost.
- You may call `run_skill`, `memory`, `skill`, `prompt` and `ask_analyst` any
  number of times, then end the decision with exactly one `arc_action`.
- Learn the controls first (what each action changes), then the goal rule.
  Compare before/after; a local change proves control, not progress.

Skills
- A skill is a Python function `run(state, args)` that runs in a sandbox with
  the current grid, previous grid, recent actions and your memory in `state`.
  Write one when you find yourself counting, locating, comparing or searching
  by hand; after that it is one call. Fix it when it is wrong; delete it when
  it is useless.

Prompt overlay
- `prompt(set=...)` adds standing instructions to this message for every later
  decision (e.g. a decision checklist you keep forgetting). Keep it short.

{{overlay}}
```

### 3.2 Working set per provider request (built by the `context` hook)

```
[system]  (above)
[user]    TASK: <the runner's one-line prompt for this decision, e.g. "Decide the next action." or
          "CONSOLIDATE: ...">
[user]    MEMORY (12 entries):
            controls.action1: "ACTION1 moves the 3x3 blue block one cell up" (conf 5)
            goal.hyp2: "..." (conf 2)
          SKILLS (3): count_colors(grid)->{color:n}; find_blocks(color)->[bbox]; diff_cells()->[(x,y,old,new)]
          RECENT ACTIONS (last 8, newest last):
            #41 ACTION6 (38,38) changed=9 level=0 | #42 ACTION6 (38,46) changed=9 level=0 | ...
          CURRENT OBSERVATION: state=NOT_FINISHED levels=0 budget 42/80 actions=[ACTION1..ACTION6, RESET]
          <coarse layout + lossless row runs from renderArcLatestFrameRuns>
          [image: current frame PNG, if the model accepts images]
[assistant/tool pairs from THIS decision only]   (run_skill results, memory receipts, …)
```

Size: ~2–4k tokens of harness text + the grid (~6k for the lossless runs) + image. It does not grow with the number of decisions. Within a decision, tool results are kept verbatim up to 8,000 characters, then truncated with a marker.

## 4. Tools

Six tools, all registered at startup, all always active (no `setActiveTools` during play; the consolidation turn hides `arc_action`, see §9). Enums use `StringEnum` from `@earendil-works/pi-ai` for provider compatibility.

```ts
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";

// 1. Environment action — ends the decision.
pi.registerTool({
  name: "arc_action", label: "ARC action",
  description: "Submit one action and end this decision. Only ACTION6 uses x,y (0..63; (x,y)=frame[y][x]). " +
               "Put a one-line rationale in note; it is shown in RECENT ACTIONS on later decisions.",
  parameters: Type.Object({
    action: StringEnum(["ACTION1","ACTION2","ACTION3","ACTION4","ACTION5","ACTION6","RESET"] as const),
    x: Type.Optional(Type.Integer({ minimum: 0, maximum: 63 })),
    y: Type.Optional(Type.Integer({ minimum: 0, maximum: 63 })),
    note: Type.Optional(Type.String({ maxLength: 300 })),
  }),
  executionMode: "sequential",
  async execute(_id, p) { /* §6.1 */ return { terminate: true, content: [...], details: {...} }; },
});

// 2. Memory — upsert by key.
// Superseded 2026-10-09: memory is now an atomic batch (set / delete with "prefix*" / hypotheses with
// appended, condition-scoped evidence). See docs/plans/2026-10-09-thin-hypothesis-memory.md.
pi.registerTool({
  name: "memory", label: "Memory",
  description: "Save (upsert by key), delete or list short facts, rules, hypotheses and plans. " +
               "Saved entries are shown at every later decision. Use keys like controls.action1, goal.hyp1, plan.",
  parameters: Type.Object({
    op: StringEnum(["set","delete","list"] as const),
    key: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    text: Type.Optional(Type.String({ minLength: 1, maxLength: 600 })),
    confidence: Type.Optional(Type.Integer({ minimum: 1, maximum: 5, description: "1=guess, 5=verified" })),
  }),
});

// 3. Skill — upsert Python by name; syntax-checked on save; callable immediately.
pi.registerTool({
  name: "skill", label: "Skill",
  description: "Save (upsert by name), delete, or get the source of a Python skill. Source must define " +
               "run(state, args) and return JSON-serialisable data. state has grid, prev_grid, frames, " +
               "levels_completed, available_actions, recent_actions, memory. Standard library only; no I/O. " +
               "Call it with run_skill. Example: def run(state, args):\\n    g=state['grid']\\n    return {'count': sum(r.count(args['color']) for r in g)}",
  parameters: Type.Object({
    op: StringEnum(["set","delete","get"] as const),
    name: Type.String({ pattern: "^[a-z][a-z0-9_]{0,39}$" }),
    description: Type.Optional(Type.String({ maxLength: 200, description: "One line: what it returns; shown in the skill directory." })),
    source: Type.Optional(Type.String({ maxLength: 16384 })),
  }),
});

// 4. Run a skill.
pi.registerTool({
  name: "run_skill", label: "Run skill",
  description: "Run a saved skill on the current state. Returns its JSON result, or the Python error with the failing line.",
  parameters: Type.Object({
    name: Type.String(),
    args: Type.Optional(Type.Record(Type.String(), Type.Any())),
    include_frames: Type.Optional(Type.Boolean({ description: "Also pass all animation frames of the last action (bigger input)." })),
  }),
});

// 5. Prompt overlay — one text, replaced on set.
pi.registerTool({
  name: "prompt", label: "Prompt overlay",
  description: "Set or clear standing instructions appended to the system prompt for every later decision (max 1500 chars).",
  parameters: Type.Object({
    op: StringEnum(["set","clear","get"] as const),
    text: Type.Optional(Type.String({ maxLength: 1500 })),
  }),
});

// 6. One-shot analyst — nested model call, no tools, fresh context.
pi.registerTool({
  name: "ask_analyst", label: "Ask analyst",
  description: "Ask a fresh, tool-less copy of the model one question about the current grid (and optionally the previous grid and memory). " +
               "Use for a second opinion or a careful visual read you do not want to do inline. Costs one model call.",
  parameters: Type.Object({
    question: Type.String({ minLength: 1, maxLength: 2000 }),
    include_prev_grid: Type.Optional(Type.Boolean()),
    include_memory: Type.Optional(Type.Boolean()),
  }),
});
```

Receipts are one line each, e.g. `memory set controls.action1 (12 entries)`, `skill set find_blocks v3 (syntax ok)`, `prompt set (212 chars)`. No JSON `details` echo of the body — the body is already in the model's own tool call, and the next decision shows it in the directory.

Why there is no "subagent store": a saved subagent in the current design is a role description plus a tool subset plus a delegate runtime. `ask_analyst` with the question text in a memory entry or skill covers the ARC use-case (read-only analysis) at ~60 lines. If a persistent role is wanted later, add `role` to `ask_analyst` that prepends a saved memory entry — still no process orchestration.

## 5. Stores

All under `<run root>/harness/`. Append-only JSONL; the in-memory map is rebuilt at `session_start` by replaying the file (last write wins). Human-readable, diffable, and the audit record.

| File | Record |
|---|---|
| `memory.jsonl` | `{t, key, text, confidence, deleted?}`; since 2026-10-09 also `{t, key: "hyp.<name>", hyp: {claim, predicts?, status, next_test?, evidence[]}}` (full hypothesis per row, last write wins) |
| `skills.jsonl` | `{t, name, version, description, source, deleted?}` |
| `prompt.jsonl` | `{t, text}` (empty text = cleared) |
| `trajectory.jsonl` | `{t, n, action, x, y, note, changed_cells, level_changed, state, levels_completed, budget}` — one per `arc_action` |
| `skill_runs.jsonl` | `{t, name, version, args, ok, ms, error?, result_bytes}` |
| `errors.jsonl` | `{t, hook, message, stack}` — every caught extension error |
| `usage.jsonl` | `{t, decision, input, output, cache_read, reasoning}` — per provider response |

No `SKILL.md`, no per-kind directories, no Pi skill loader (`--no-skills` stays).

## 6. Hooks

Five hooks. Each handler body is wrapped in `guard(name, fn)`: catch → append to `errors.jsonl` → rethrow so Pi also reports it.

| Hook | Responsibility |
|---|---|
| `session_start` | Replay stores into memory; create `harness/`. |
| `before_agent_start` | (a) `GET /state` with 10 s timeout → cache `observation` (grid, prev grid from the previous cache, frames, PNG); on failure **throw** (the runner sees the error and retries the decision; never serve a stale grid). (b) `forceSystemPrompt = render(arc_thin_system.md, {game, overlay})`. (c) If the prompt starts with `CONSOLIDATE:` → `pi.setActiveTools(["memory","skill","run_skill","prompt","ask_analyst"])`, else restore all six. |
| `context` | Build the working set (§7). Pure function of (stores, observation, messages). |
| ~~`tool_call`~~ | **Dropped in implementation — see §6.0.** |
| `message_end` | If `role === "assistant"`, append usage to `usage.jsonl`; record whether the message contains an `arc_action` (marks the batch as decision-ending). |
| `tool_result` | Only flips `isError: true` on results marked `details.refused` (see §6.0). No content rewriting. |

Not used: `before_provider_request` (no payload surgery; the overlay goes through `forceSystemPrompt`), `turn_end`, `agent_end`, `session_before_compact` (auto-compaction is turned off by the runner because the context hook already bounds the request).

### 6.0 Decision boundary (implementation deviation)

Verified against Pi 0.80.6 `agent-loop.js`: a `tool_call` block becomes an immediate error result **without `terminate`**, and a batch only ends the run when *every* result has `terminate === true`. Blocking a second `arc_action` in `tool_call` therefore kept the run alive, and every later `arc_action` was blocked too. The first smoke run looped 4,582 provider requests until the decision timeout.

The implementation enforces the boundary inside each tool's `execute` instead. Every tool is wrapped by `guardTool(name, fn)`, which first asks `gate(name)`:

- a second `arc_action` in a decision or message, `arc_action` during consolidation, or the hard tool-call cap → **refused with `terminate: true`** (a text result marked `details.refused`, which the `tool_result` hook flips to `isError`);
- any other tool in a message that also contains `arc_action` → runs, but returns `terminate: true` so the batch can end (errors are converted to terminating refused results for the same reason);
- the soft tool-call cap in a normal decision → a non-terminating error ("call arc_action now").

Known gap: if a call in the same message as `arc_action` fails Pi's argument validation, Pi produces a non-terminating error before `execute` runs. The decision then lasts one more model turn, in which `gate` refuses everything.

### 6.1 `arc_action.execute`

```ts
const value = await bridge("/action", { action, ...(action === "ACTION6" ? { x, y } : {}) });
const prev = observation.grid;
observation = parseState(value);                       // same shape as GET /state
const changed = countChanged(prev, observation.grid);  // ~10 lines, no "structural regions"
const row = { n: ++actionCount, action, x, y, note, changed_cells: changed,
              level_changed: value.public_transition?.level_changed === true,
              state: value.state, levels_completed: value.levels_completed, budget: value.action_budget };
append("trajectory.jsonl", row); recent.push(row);
return { terminate: true,
  content: [{ type: "text", text: `#${row.n} ${action}${xy} → changed_cells=${changed} level_changed=${row.level_changed} state=${value.state} levels=${value.levels_completed} budget=${budgetText}` }],
  details: row };
```

The new grid is **not** returned in the tool result; the next decision's observation carries it (same as today, but without the 400-character "this is evidence not interpretation" boilerplate).

### 6.2 `run_skill.execute`

```ts
const skill = skills.get(name) ?? throwFix(`No skill '${name}'. Saved skills: ${[...skills.keys()].join(", ")}`);
const input = { state: buildState(include_frames), args: args ?? {} };
const program = wrap(skill.source);     // prepend `state=input["state"]; args=input["args"]`, append `result = run(state, args)`
try {
  const out = await evaluateTaskPython(program, input, signal);   // reuse pi_task_python.ts
  append("skill_runs.jsonl", {...ok:true});
  return { content: [{ type: "text", text: JSON.stringify(out.value).slice(0, 8000) }], details: out.value };
} catch (e) {
  append("skill_runs.jsonl", {...ok:false, error: e.message});
  throw new Error(`skill '${name}' v${skill.version} failed: ${e.message}\n` +
                  `Fix with skill(op="set", name="${name}", source=...). Source line numbers refer to your source as saved.`);
}
```

`buildState()` returns `{ grid, prev_grid, frames?, levels_completed, available_actions, action_budget, recent_actions: last 8 trajectory rows, memory: {key: {text, confidence}} }`. Default skill limits: `input_bytes: 384 KiB`, `timeout_ms: 20 000`, `output_bytes: 64 KiB` (within `pi_task_python.ts` hard ceilings). `pi_task_python_runtime.py` gets one change: on failure write `traceback.format_exc()[-800:]` to stderr instead of only `type: message`, so the model sees the failing line.

### 6.3 `skill.execute(op="set")`

Validation is exactly: name pattern (schema), `source` present, `def run(` present, and a syntax check by compiling in the WASI guest with `--check`-style evaluation of `compile(source)` (reuse the runner; ~5 lines). On syntax error: `throw new Error("SyntaxError line 7: ... \nResubmit the whole source with skill(op=\"set\", ...)")`. Version increments on every set. No naming rules beyond the schema, no description requirement, no citations.

### 6.4 `ask_analyst.execute`

```ts
// ModelRegistry has no streamSimple in Pi 0.80.6; use the same path as Pi's compaction side call.
const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
if (!auth.ok) throw new Error(`analyst call failed: ${auth.error}`);
const msg = await completeSimple(ctx.model, {          // from "@earendil-works/pi-ai/compat"
  systemPrompt: "You are a careful visual analyst for a 64x64 integer grid. Answer the question precisely; cite coordinates (x,y).",
  messages: [{ role: "user", content: [ { type: "text", text: `${question}\n\n${renderArcLatestFrameRuns(observation)}` + (memoryText) + (prevGridText) }, image? ] }],
}, { signal, apiKey: auth.apiKey, headers: auth.headers, env: auth.env,
     ...(ctx.model.reasoning && level !== "off" ? { reasoning: level } : {}) });
return { content: textOf(msg), usage: msg.usage, details: { question } };
```

Fresh context, no tools, one call. Its usage is attributed through `usage` and `usage.jsonl`, so the runner's budget sees it. Custom providers registered with `registerProvider({streamSimple})` go into pi-ai's shared API registry, so `completeSimple` also reaches the scripted smoke provider.

## 7. Context builder

```ts
pi.on("context", guard("context", (event) => {
  const msgs = event.messages;
  const firstUser = msgs.findIndex(m => m.role === "user");           // the runner's decision prompt
  // Keep only messages after the last arc_action tool result (this decision's tool traffic),
  // dropping any earlier observation/working-set messages we injected ourselves.
  const lastBoundary = findLastIndex(msgs, m => isToolResultOf(m, "arc_action"));
  const current = msgs.slice(Math.max(firstUser + 1, lastBoundary + 1))
                      .filter(m => !isInjected(m))
                      .map(truncateLongToolResults(8000));
  const workingSet: UserMessage = { role: "user", content: [
    { type: "text", text: [renderMemory(), renderSkillDirectory(), renderRecentActions(8), renderObservationText()].join("\n\n") },
    ...(observation.png && modelAcceptsImages ? [{ type: "image", data: observation.png, mimeType: "image/png" }] : []),
  ], customType: "arc-working-set" };
  return { messages: [msgs[firstUser], workingSet, ...current] };
}));
```

Properties:

- The returned list changes every request, so Pi replays the system prompt and tool declarations into the leading system message (documented behaviour). Cache hits on the grid are not expected anyway.
- Nothing is matched by text prefix; injected messages are identified by `customType`.
- Length is bounded by construction: memory ≤ 40 entries × 600 chars, skill directory ≤ 40 lines, recent actions 8 lines, one grid, plus this decision's tool traffic (each result ≤ 8 k chars). A decision that makes 20 tool calls can still be large; the runner's per-decision tool-call cap (default 12) bounds that.
- Hard-fail policy: if the builder throws, Pi logs it and sends the unmodified transcript. The error lands in `errors.jsonl` and the runner stops the run at the next decision boundary ("extension_error seen"), rather than silently continuing with the wrong context.

### 7.1 Renderers (all ≤ 20 lines each)

- `renderMemory()`: `MEMORY (n):` then `key: "text" (conf c)` sorted by key; if n = 0: `MEMORY: empty — save what you learn with memory(op="set").`
- `renderSkillDirectory()`: `SKILLS (n): name v3 — description` or `SKILLS: none — write one with skill(op="set") when you repeat a calculation.`
- `renderRecentActions(8)`: one line per trajectory row including `note`.
- `renderObservationText()`: `renderArcLatestFrameRuns(observation)` (reused, lossless runs + coarse layout) prefixed with state/levels/budget/available actions.

## 8. Error policy

| Situation | Behaviour |
|---|---|
| Tool argument fails schema | Pi's own validation error is returned to the model; the decision continues. |
| `skill set` syntax error | Tool error with line number and "resubmit whole source". No store write. |
| `run_skill` runtime error | Tool error with traceback tail; the failed run is logged; the decision continues. |
| Bridge `/action` transport failure | Tool error with the bridge-client diagnostic; the decision continues, the model may retry or choose differently. (Not retried automatically — the environment may have accepted it.) |
| Bridge `/state` failure in `before_agent_start` | Hook throws; runner retries the decision up to 3 times with backoff, then ends the run with reason `bridge_unavailable`. |
| Any hook exception | `errors.jsonl` + rethrow. Runner persists `extension_error` RPC events and stops at the next boundary. |
| Two `arc_action` calls in one message | Second is blocked with a reason; the first stands. |

No situation blocks the model's `arc_action` because of a harness failure, hides the model's own arguments, or leaves a "pending" item behind.

## 9. Runner (`arc_thin_e2e.py`)

Keep: bridge start (`arc_agi_3_bridge.py` unchanged), `PiKernel` RPC loop, `.env` credentials, scorecard close, `summary.json`.

Launch:

```
pi --mode rpc --provider <p> --model <m> --no-session --no-extensions --no-skills
   --no-prompt-templates --no-context-files --no-builtin-tools
   --extension demo/arc_thin_extension.ts [--extension <provider ext>]
```

Environment passed to the extension: `PI_ARC_BRIDGE_URL`, `PI_ARC_ACTION_TOKEN`, `ARC_RUN_ROOT`, `ARC_GAME`. Nothing else.

Loop:

```
kernel.send("set_auto_compaction", enabled=False)
prompt("Decide the next action.")                       # decision 1
while not terminal:
    events = kernel.wait_for_agent_events(stop_after_progress_tools=("arc_action",))
    persist(events)                                     # include "extension_error"
    if errors_seen(): stop("extension_error")
    if usage_total() > budget: stop("budget")
    if consolidation_due(): prompt("CONSOLIDATE: ...") ; wait ; continue   # no arc_action available
    prompt("Decide the next action.")
```

`consolidation_due()` is true on level change, on GAME_OVER (before RESET), and after `N=25` actions without a level change. The consolidation prompt:

```
CONSOLIDATE: no action this turn. Review RECENT ACTIONS and MEMORY. Update memory
(merge duplicates, raise/lower confidence, delete what the evidence refuted, record
the current goal hypothesis and the next test). If you repeated a calculation by
hand, write it as a skill. Then stop.
```

Budget: per-decision cap of 12 tool calls (kernel watchdog already exists), per-run reported-token cap from `usage.jsonl` checked between decisions, wall-clock deadline. No in-extension admission.

Removed from the runner: the 25 `PI_*` flags, reasoning-policy state machine, recovery phases, research notices, validation windows, level retrospectives, harness-validation prompts, per-event projection functions. The `summary.json` keeps: actions, levels, usage totals, stop reason, counts of memory/skill/prompt/analyst calls, skill success rate, and the `errors.jsonl` count.

## 10. Prompt and schema text budget

Resident harness text per request ≈ system prompt (300 words) + tool schemas (~900 tokens) + MEMORY/SKILLS/RECENT (~300–1,200 tokens). Compared with the captured b35 request 50 (≈23 k tokens, of which 60–70 % was harness status), the target is ≤ 10 k including the lossless grid, and flat over the run.

Rules for any text added later: no sentence of the form "X does not establish/prove Y"; every tool description contains exactly one "use it when…" clause; no on-demand manuals — if the model needs to read a document to use a tool, the tool is too complex.

## 11. Validation plan and success metrics

1. **Scripted smoke** (installed Pi, scripted provider, real bridge on `ls20`): each tool called once, a second `arc_action` blocked, a syntax error returned with a line number, a runtime error with traceback, `CONSOLIDATE` hides `arc_action`, `errors.jsonl` receives an injected hook failure and the runner stops. ≈ 10 checks, < 2 minutes.
2. **Mechanism validation with a strong model** (2 games × 50 actions, e.g. `claude-sonnet-5` or whichever strong model the gateway offers): the question is only "does a capable model use memory/skills unprompted, and do skills run?" — not score. Expected: ≥ 1 skill saved and run successfully per game, memory non-empty by action 10, 0 extension errors.
3. **Same protocol with `qwen3.8-27b`**: now a difference from step 2 is attributable to the model, not to the mechanism.
4. **Control**: same runner with `memory`/`skill`/`prompt`/`ask_analyst` unregistered, same model, same budget. Compare levels, actions, tokens per decision.

Report per run: actions, levels, tokens per decision (first/last/peak/mean), component calls (set/run/success), analyst calls and their usage, stop reason, `errors.jsonl` count.

## 12. Mapping from the current design

| Current (loaded on the parent path) | Thin design |
|---|---|
| `task_harness` (23 actions, ~25 params) + `task_harness_create` (untyped `candidate`) | `memory`, `skill`, `prompt`, `ask_analyst` with typed schemas |
| Pool → assembly (CAS revision) → active selection → activation | Saved = active. Delete to deactivate. |
| 4 tool program formats + restricted JSON-AST language | One: Python `run(state, args)` in the existing WASI sandbox |
| Creator manuals (`skill-creator`, `tool-creator`, `subagent-creator`) + `read_method` + hash citations | Removed; the schema description is the manual |
| Research children, workers, findings, routing, harness router (~7.7 k lines) | `ask_analyst` one-shot nested call |
| Periodic review windows, `defer_review`, level windows, conversion intents, pattern candidates, effect assessments, knowledge-requiring-review | Runner-triggered `CONSOLIDATE` turn (level change / GAME_OVER / 25-action stall) |
| 9 `context` hooks, prefix-based de-duplication, 24-message archive, `before_provider_request` string surgery | 1 `context` hook that rebuilds the working set; overlay via `forceSystemPrompt` |
| Decision card, decision capsule, `arc_action.decision` object (13 fields) | `arc_action.note` (≤ 300 chars) + `memory` |
| Admission at 1 token/byte, reported-token ledger hooks | Runner-side budget from Pi usage between decisions |
| ~85 `process.env` flags | 4 |
| Hidden hook errors | `errors.jsonl` + `extension_error` persisted + run stops |

## 13. Open questions

1. **Images.** Keep the PNG in the working set for image-capable models (current behaviour) — cost ≈ 1–1.5 k tokens per request. For text-only models the lossless runs are the only representation; that is the same trade-off as today.
2. **Consolidation on a 27B model.** If `CONSOLIDATE` turns produce low-quality memory edits, the alternative is to drop them entirely rather than add structure; the per-decision rebuild already forces saving.
3. **Where the old path lives.** Keep `pi_arc_agi_3_extension.ts` and the old runner untouched as the "legacy" arm for one paired comparison, then delete.
