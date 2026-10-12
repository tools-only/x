# Harness foundation refactor: final plan (2026-10-12)

Status: plan for approval. No implementation yet.

Scope: the basic harness design discussed with Codex on 2026-10-12. Its main parts are:
- Pi-native continuity;
- a file-first workspace;
- one create–edit–use lifecycle for Prompt, Memory, Skill, Tool and Subagent;
- receipts and exact retrieval;
- consistent execution state.

The claims layer (slice 1 of the [falsifiable plan](2026-10-12-falsifiable-self-harness-plan.md)) is already built. It moves onto this foundation unchanged.

Inputs:
- Codex's [integrated plan](../../../autoresearch_pi_incremental_20261012/worktree/docs/plans/2026-10-12-pi-native-self-harness-integrated-plan.md) and [historical lessons](../../../autoresearch_pi_incremental_20261012/worktree/docs/reports/2026-10-12-workspace-harness-historical-lessons.md);
- my [memory review](../reports/2026-10-12-memory-mechanism-review.md) and [overnight review](../reports/2026-10-12-overnight-runs-review.md);
- the installed Pi 0.87.0 docs and `dist/`.

## 1. Goal and non-goals

**Goal.** The agent works the way a coding agent does:
- it computes when it needs to;
- it writes reusable things as ordinary files in standard formats;
- it sees what it wrote take effect, or the exact reason it didn't, in the same receipt;
- it keeps its line of thought through Pi's own session and compaction.

The runtime does the mechanical work: binding, versions, scheduling, receipts, records, confinement. The agent keeps the semantic work: what to compute, what to believe, what to reuse.

**Non-goals for this refactor:**
- no persistent Python kernel (stays deferred until runs show a need);
- no guarded step execution (separate, needs approval);
- no cross-run skill library (each run starts empty; a library raises held-out questions);
- no Auto-Research;
- no game content.

## 2. Target architecture

```
Pi 0.87.0 (pinned)   session file · tool protocol · compaction · system-prompt sections · steer messages
  │
  ├─ ARC adapter (runtime-owned)  bridge, arc_action, receipts, states, trajectory, budgets
  │
  ├─ Workspace  run/<id>/workspace/   ← the only thing the agent can see or write through file tools
  │     data/        read-only, runtime-written: current.json, trajectory.jsonl, frames/<n>.json
  │     notes/       free-text memory (*.md)
  │     prompts/     standing instructions (*.md, frontmatter active: true|false)
  │     lib/         shared Python modules (importable from tools, observers, scripts, python)
  │     tools/       <name>.py: one typed function → a callable Pi tool
  │     observers/   <name>.py: observe(state) → runs after each action, output shown
  │     skills/      <name>/SKILL.md (+ scripts/, references/): Agent Skills format
  │     roles/       <name>.md: subagent role (frontmatter: description, tools; body: instructions)
  │     artifacts/   results the agent or its code keep (json/txt)
  │     results/     runtime-written full outputs behind receipts (read-only)
  │
  ├─ Component binder (runtime)  indexes workspace files, versions them by content hash, activates at the next
  │     request boundary, writes the receipt; history in .harness/versions/ (append-only, not agent-visible)
  │
  ├─ Execution (runtime)  existing WASI CPython sandbox, one-shot per call; lib/ and tools/ sources injected so that
  │     `import lib.x` works; no host files or network; observers in their own worker pool
  │
  └─ Services (runtime-owned, advisory)  structured ledger (memory tool, hypotheses with checks), claim engine,
        critic (delivered by steer message), capability index
```

**Where each kind of data is authoritative:**

| Data | Authoritative source |
|---|---|
| Executed actions and observations | ARC receipt and states store |
| Conversation | Pi session file |
| Agent code and components | Workspace files plus version history |
| Hypotheses and checks | memory.jsonl |
| Check results, critic reports, execution records | Runtime stores (read-only to the agent) |
| Large outputs | `results/` |

The session holds references to these stores, not copies.

## 3. Agent-facing surface

| Tool | Purpose | Notes |
|---|---|---|
| `arc_action` | The action, unchanged | Stays clean (no memory or plan fields) |
| `read`, `write`, `edit`, `ls`, `grep` | Pi's built-in tools with a confined file backend | Paths are resolved under `workspace/`; links and junctions are refused; `data/` and `results/` are read-only. A write or edit to a component file returns the **activation receipt** (§4) |
| `python` | One-off code, nothing saved | Existing tool; it gains `import lib.*`, `tools.*` and reads of workspace files through injected sources |
| `memory` | Structured beliefs: hypotheses with optional `check`, tests, strategies, facts | Change: accepts partial entries and reports what it could not apply, instead of rejecting the whole batch (integrity refusals remain) |
| `consult` | `consult(role, question, refs)`: one-shot subagent with that role's instructions, allowed tools and the referenced files or results | Its answer is the tool result and is also saved; it never gets `arc_action` |
| *agent-made tools* | Each enabled `tools/<name>.py` becomes a Pi tool named `<name>` | Registered with `pi.registerTool`; callable from the next request |

**Removed or replaced:**
- `skill`, `run_skill` and the custom skill store, migrated to `tools/` and `observers/` (§7);
- the single prompt overlay tool, replaced by `prompts/` files;
- the predictor-model convention and its backtest, never adopted (the backtest code stays callable for audits).

**Resident context per request:**
- the base system prompt;
- active prompt files, as Pi system-prompt sections (Pi diffs them and patches only what changed, which keeps the cache);
- the capability index (§4.4);
- the session history;
- the current observation;
- observer outputs;
- check lines on hypotheses.

There is a budget for each part (§9).

## 4. Component lifecycle

### 4.1 One path for create and edit
- The file is the component.
- Every write or edit of a component file goes through the binder, which:
  1. parses the file;
  2. validates it (syntax, function signature, frontmatter);
  3. records a version (content hash);
  4. activates it at the next request boundary.
- Creating and revising use the same path. There is no staging, publish step or separate revision interface (the B36 lesson).

### 4.2 Receipt
Every write or edit of a component file returns one line per affected component, for example:

```
tools/compare.py → tool compare v3: saved · loaded · active from your next request
tools/compare.py → tool compare v4: saved · NOT loaded (SyntaxError line 18: ...) · v3 still runs, its outputs are labelled "v3 (v4 failed)"
observers/pos.py → observer pos v2: saved · loaded · runs after each action (observe: on)
skills/route/SKILL.md → skill route: saved · listed (description shown in the index)
prompts/phase2.md → prompt phase2: saved · active: false (not in the system prompt)
```

- A non-component file (a note, an artifact) gets an ordinary write receipt.
- A file deleted, or moved to `*/_off/`, is retired. Its history stays.
- A failed new version never silently replaces or hides behind the old one: the fallback is labelled on every output, and one edit fixes or disables it.

### 4.3 Conventions (minimal; no SDK)

| Type | Convention |
|---|---|
| Tool | Module docstring (first line becomes the description). One public function `def run(...)` with typed parameters (int, float, str, bool, list, dict; defaults allowed). Its return value is the result. The schema comes from the annotations; unsupported annotations are reported in the receipt. |
| Observer | `def observe(state) -> value`. Runs after every new state; once per state; labelled with the state it describes. `# observe: off` in the header turns it off without deleting it. |
| Skill | Agent Skills SKILL.md (`name`, `description` frontmatter; body with instructions). Scripts under `scripts/` run with `python` (`import skills.<name>.scripts.x`). Only name and description appear in the index; the body is read on demand. |
| Prompt | Markdown with frontmatter `active: true|false` and an optional `phase` note. Active prompts become system-prompt sections in file-name order. |
| Role | Markdown with frontmatter `description`, `tools` (allowed: `read`, `python`, named agent tools; never `arc_action`) and optional `refs`. The body is the role's instructions. |
| Note | Any markdown in `notes/`. Not injected; listed by name and first line in the index; read on demand. |

### 4.4 Capability index
- **Generated** by the runtime each decision, never maintained by the agent.
- **Per component:** name, type, one line, status (active / off / failed / stale), version, and how to call or read it.
- **Stale:** a component is stale when a declared input or check it depends on failed, or when it was written on an earlier level. It is labelled, never deleted.
- **Size budget:** about 1.2k chars. Beyond that, components are grouped by type with counts, plus `ls` hints.

### 4.5 Consistent state
- Every saved component runs from the exact source of its active version in a fresh sandbox context. The interactive `python` namespace is per call, so a saved component cannot depend on hidden variables.
- Tools, observers and `python` all resolve `lib/` modules at the same version: the latest active one. Each execution record notes the versions it used.
- Observers run in their own pool and never alter foreground state.

### 4.6 Restart and loss
- **Recovered on restart:**
  - the session (session file);
  - the files and their versions;
  - the runtime stores;
  - the bindings, rebuilt from the files.
- **Not recovered:** anything never written to a file. There is no persistent namespace to lose, so this is explicit.

## 5. Continuity, compaction and receipts

**Session.**
- `--session <run>/session.jsonl` replaces `--no-session`.
- Each decision appends its prompt, the agent's text and tool calls, and the tool results.

**Projection** (the `context` hook):
- the full retained history from Pi's canonical projection, after the latest compaction summary. This replaces the N-decision window;
- reasoning blocks dropped from replay (configurable, recorded in `run-config.json`);
- the current observation (grid plus PNG) added to the newest user message only.

Old grids never enter the session, because observations are injected at projection time. Earlier states are reached with `read data/frames/<n>.json` or through `history` in `python`.

**Receipts and exact retrieval.**
- A tool result longer than about 1,500 chars is stored whole in `results/<id>.txt`.
- The result in the session becomes a receipt: status, the first lines, any lines the tool marks as key, and the reference.
- `read results/<id>.txt` (with offset and limit) returns the original.
- Results returned by `python` are kept the same way.

**Compaction.**
- Native auto-compaction is turned on behind a switch.
- Step R1 first inspects the real compaction input in a scripted session: size, whether reasoning is included, whether tool results are cut at 2,000 chars, and latency.
- Adaptation, only if the probe shows a need, through `session_before_compact`:
  - pass compaction the same projected messages as ordinary requests (receipts, no reasoning);
  - add an ARC-specific summary instruction: controls, hypotheses with their check records, refuted claims, open questions, active strategy and steps, what the last actions were testing.
- Usage of compaction calls is counted in the shared budget.

**Reviews.** The forced review at a level change is off by default in the new foundation (§10, decision D2). Reviews every 25 actions and at GAME_OVER remain, until compaction is shown to carry continuity.

## 6. Isolation

- **File tools:** Pi's built-in tools take a custom backend (the read, write, edit, list, grep and find backend interfaces; checked in 0.87.0 `dist/core/tools/*.d.ts`). Ours resolves the real path under `workspace/` and refuses anything else, including links and junctions. `data/` and `results/` are writable only by the runtime.
- **Code execution:** the existing WASI sandbox, which has no host files or network. Workspace sources reach it as input, never as a mounted directory.
- **Secrets:** the bridge token and API keys exist only in the host process that executes `arc_action`. The workspace and sandbox never see them.
- **Tests (§8, R2):** out-of-workspace paths, `..` and absolute paths, a junction inside the workspace pointing outside, writes to `data/`, and Python attempting `open()`.

## 7. Migration and compatibility

- **Skills:** existing `skills.jsonl` entries become `tools/<name>.py` (`run(state, args)` wrapped by an adapter) and `observers/<name>.py`, following their current observe flag. `run_skill` stays as an alias for one release and is logged when used.
- **Artifacts:** the artifact store maps to `artifacts/` (same provenance records). Skills that read `state["artifacts"]` keep working.
- **Memory:** the memory tool stays the structured ledger. Notes move to `notes/` files. Claims and checks are unchanged.
- **Prompt overlay:** the overlay becomes `prompts/overlay.md` (`active: true`).
- **Comparators:** `--foundation legacy` keeps today's path (rebuild or window continuity, custom stores) as a frozen comparator for real runs. `--foundation native` is the new default after acceptance.

## 8. Implementation steps

Each step has a failing check first, a minimal implementation, focused tests, the scripted end-to-end smoke, and its own commit.

| Step | Work | Main files | Accept when |
|---|---|---|---|
| **R0 Spike** (no model cost) | Confirm in the installed Pi 0.87.0 over RPC: session file continuity and restart; system-prompt `sections` patching; `registerTool` mid-session; whether a forced `systemPrompt` drops Pi's skills list; built-in tools with a custom backend; compaction input contents (§5) | `tools/pi_foundation_spike.ts` (new) | Each item passes, or is recorded with the exact limitation and the workaround adopted |
| **R1 Native session** | Session file; canonical projection instead of the N-window; reasoning dropped from replay; observation injected only into the newest message; recoveries keep the session; compaction switch with input inspection | extension `context` hook, `arc_thin_e2e.py`, `pi_kernel.py` | Continuity smoke: decision k sees decisions < k; a restart from the session file resumes; no grid in the session; tool calls still paired after an aborted reply; compaction probe report written |
| **R2 Workspace and confined file tools** | Workspace layout; runtime-written `data/`; confined file tools; secrets kept out | `demo/arc_thin_workspace.ts` (new), extension, runner | Escape tests (§6) refused; reads of `data/` and `results/` work; writes there refused |
| **R3 Binder and receipts** | File index, content-hash versions, activation at the request boundary, the receipt (§4.2), failed-version labelling, retirement; capability index | `demo/arc_thin_binder.ts` (new), extension | Lifecycle tests: create, edit, failed edit, fix, disable, delete, restart; the receipt states which version runs |
| **R4 Component types** | Tools from typed functions (schema from annotations); observers; SKILL.md listing plus on-demand read; prompt files as sections; roles plus `consult`; `python` imports `lib`/`tools`/skill scripts | `demo/arc_thin_components.ts` (new), guest, extension | For each type: discoverable in the same session, used by a later request, revised, withdrawn; `consult` returns a result in the requester's context, with no `arc_action` grant |
| **R5 Receipts and retrieval** | Large results to `results/`, receipt with reference, ranged `read` | extension, workspace | A counterexample in the middle of a long output is still reachable by its reference after compaction |
| **R6 Memory and migration** | Partial-acceptance ledger; notes to files; skills, overlay and artifact migration; `--foundation legacy\|native`; prompt rewritten for the new surface | memory, extension, prompt, runner, CLI | Old runs replay; the legacy comparator unchanged; all existing smokes pass under legacy; new smokes pass under native |

**Smokes under `native`** (real bridge, Pi and sandbox; scripted provider):
- **continuity-native:** decisions, restart, compaction.
- **lifecycle:** create, edit, failed edit, disable and delete for each component type, with the receipts asserted.
- **isolation:** escape attempts refused.
- **consult:** a role answer reaches the requester.
- **receipts:** the long-output reference reads back exactly.

## 9. Resident-cost budget (checked in R3/R4 tests)

| Part | Budget (chars) |
|---|---|
| System prompt without the index | ≤ 3,000 |
| Capability index | ≤ 1,200 |
| Observer outputs | ≤ 2,400 (existing) |
| Active prompt files | ≤ 1,500 total (beyond that, the receipt warns) |
| Tool schemas | Measured per request and reported in `context_budget.jsonl`; no fixed cap, but each agent tool's schema is ≤ 400 chars from annotations |

## 10. Decisions needed from you

| # | Decision | My recommendation |
|---|---|---|
| D1 | Observers on by default when written to `observers/`? | Yes: writing into `observers/` is the opt-in. Turn off with the header flag. |
| D2 | Forced review at a level change in the native foundation? | Off by default (the claims re-check on new moves and continuity cover it); kept as a flag. |
| D3 | Reasoning replay in the session history? | Dropped (it inflated input overnight); a flag for comparison. |
| D4 | Native compaction on in the first real runs? | Only if the R1 probe shows the input is acceptable; otherwise keep the large-context window. |
| D5 | Working tree | Implement on a branch with a frozen base, merging Codex's concurrent edits at each step, because Codex edits the same files. Which branch name and base? |

## 11. After the refactor

Real comparison, which needs your budget:
- **Arms:** `--foundation legacy` (today's path) against `native`.
- **Games and budget:** ls20 and lp85, 1 h each, same model and reasoning, frozen tree.
- **Primary measure:** levels.
- **Mechanism measures:**
  - turns and tokens to a first useful computation;
  - repair turns;
  - component reuse;
  - memory-upkeep share;
  - actions per hour;
  - repeated refuted tests;
  - stale-input uses after a level change;
  - compaction pauses.
- **Kill criteria:** more turns per action without progress; components created and never used; lost counterevidence after compaction.
