# JOB: Implement P1–P6 Self-Harness full solution (2026-10-31)

## Goal
Implement the complete P1–P6 solution so Agent Self-Harness沉淀/使用 burden drops. Main loop unchanged:
**Daemon sensing → Self produce Binder-ready tool → next Task turn named call → Daemon Successes feedback**.
Hard gate: `component_runs.jsonl` with `ok=true`. Created/Shown alone do not count.

Agent only decides: **save or not**, **which name to call**. Paths, schema shells, assembly, directories, cursors stay off the decision surface.

## Non-goals
- No auto-promote (candidates may be auto-generated; uploading requires explicit Agent `promote`/`save_tool`).
- Do not make thin ledger / critic / AR / full Meta governance part of L0/L1 acceptance.
- Do not delete workspace as a filesystem product; remove Agent obligation to understand it (P1).
- Do not add more nudge prompt arms races; fix contracts instead.

## Worktree
Repo root: this `autoresearch_pi_project` directory (branch `codex/self-harness-minimal-path`).
Key areas (investigate; do not assume line numbers):
- `demo/arc_thin_binder.ts`, `demo/arc_thin_extension.ts`, `demo/arc_thin_native_runtime.ts`, workspace helpers
- Daemon modules under `demo/` / `src/` (`daemon_service`, `arc_thin_daemon`, equivalents)
- Hook: `SELF_HARNESS_HOOK` / HOOK-SKIP window in extension/native loop
- `AGENTS.md` Self conversion contract; CONVERT guidance / `notes/convert.md`
- Ledgers: `components.jsonl`, `component_runs.jsonl`, thin ledger modules

Prefer extending existing mechanisms over parallel new engines. Keep Meta ≠ Self.

---

## P1 — Logical-name contract (workspace private to Runtime)

**Problem:** Charter says workspace imperceptible; impl forces relative root / tools paths / CWD≠file root → path exploration burns budget.

**Implement:**
1. Agent-facing harness verbs accept logical names only (`name`, optional `kind` default `tool`).
2. Primary save path: `save_tool(name, body)` and `promote(name?)` — Runtime maps name→path→Binder→tool table→Created.
3. Generic read/write/edit MUST NOT be the harness save path. If they target harness dirs, Runtime rejects and returns redirect to `save_tool`/`promote` with suggested name — no path tutorial in the error.
4. Binder failures return field-level errors (missing run signature, docstring), never "wrong path".
5. Working set / Hook index show: `name | kind | last_status | via` — zero paths.
6. Strip path teaching from AGENTS.md, Hook copy, CONVERT scaffolding, error strings. Keep `tools/` etc. on disk as Runtime private storage.

**Accept:** Injected bad path → recover via logical-name tools with zero `os.walk` / workspace-root listing in successful-save traces.

---

## P2 — Daemon = sensing/feedback service (no identity lock)

**Problem:** Self/Meta locked into DAEMON RESPONSE; stripped tools; Task history peeled; Maintenance as only publish theater.

**Implement:**
1. Daemon services (deterministic scanner):
   - Repeat work without Component → Failures (suggested name + one-line reason + promote available)
   - Same-name call fail ≥2 → Failures
   - `component_runs ok=true` → Successes
   - CONVERT/candidate Shown for N turns without Called → Failures escalate (first hard-coded watch)
2. Materials written every turn to always-readable slots (working-set fixed region and/or process Failures|Successes). Readable from Task, Hook, any Decide.
3. Optional urgent short prefix on hard failure only — must not change tool table, peel Task history, or force Maintenance.
4. Abolish contract/narrative that only DAEMON RESPONSE may legally Self-publish. `daemon_reply` one-shot publish = compat fast path only, not main path.
5. Maintenance dir if kept = Runtime scratch only, not "only legal Self desk".

**Accept:** With DAEMON RESPONSE fast path disabled, Created→Called still achievable via resident Failures + Hook/short entry. Successes require real `component_runs`.

---

## P3 — Hook short-window contract

**Problem:** Full game diary, category walks, path probing, Skip spam; conflicts with caps / banned arc_action.

**Implement:**
1. Trigger after action receipt / batch end; separate goal from Task (no dual goals same turn).
2. Runtime-built window (hard cap), lower bound = last successful save cursor (else level start). Only three payload classes:
   - promote candidates (logical name + one-line fingerprint)
   - mounted-but-unCalled names (Shown not Called)
   - Daemon Failures/Successes ≤3 each
3. Forbidden in Hook payload: full game trajectory, grids, absolute paths, category encyclopedia, long save-nudge prose.
4. Hook tools only: `promote` / `save_tool` / `read_component(name)` / `skip(reason_code)`.
   Ban `arc_action`, path write, puzzle-solving in Hook.
5. Skip legal with enum reasons: `no_reusable_logic` | `already_covered` | `need_more_task_signal`. No long Skip/Save persuasion copy.
6. Clear Hook budget (independent small budget or explicit carve-out from Task cap).

**Accept:** Hook traces have zero path exploration; non-empty candidates raise Save/Promote vs diary-Hook baseline; Skip reason_code distribution measurable.

---

## P4 — One primary entry + Runtime-filled conversion

**Problem:** Heavy `self_component`; light memory path wins; CONVERT shown≠called.

**Implement:**
1. Primary: `promote(name?)` — no arg = top Daemon/Hook candidate; with arg = that logical name. Runtime extracts from session/python → minimal Binder shell → disk → tool table. Agent does not paste full text or pick five kinds.
2. `save_tool(name, body)` for rare full-body cases; shorter schema than current `self_component`.
3. Demote or remove kind-picking `self_component` as main path. memory/skill/etc. are not L0/L1 acceptance.
4. CONVERT: Runtime/Daemon produce one-click promote candidates (suggested name + draft body on Runtime side). Agent sees candidate row + `promote` only. Stop requiring agent-authored `notes/convert.md` as the main path.
5. Shown = candidate enters Hook/working set; Called = promote success or Task invokes that name; Covered after Called via Daemon.

**Accept:** L0 only counts tool-kind Created→Called. promote call count up; hand-written convert.md count → ~0.

---

## P5 — Self four-state ledger only on Self surfaces

**Problem:** Self loop ledger / thin hypothesis ledger / token ledger name-collision; agents treat experiment tags as harness work.

**Implement:**
1. Self ledger (only one on Hook/Failures/Successes/agent narrative): `Created | Shown | Called | Covered` + failure reason codes. Sources: components.jsonl + component_runs.jsonl + Daemon summary.
2. Rename/isolate thin hypothesis/stall ledger as experiment-diagnostics ledger — default not injected into Self/Hook.
3. Token/admission = budget gate in runner only — never a harness work item for the agent.
4. Do not let agents hand-write ledger rows to fake沉淀. Optional `harness_status` or working-set fixed region only.

**Accept:** Hook/Task prompts contain zero hypothesis/stall wording; Self docs 台账 means four-state only.

---

## P6 — Single acceptance ladder

Implement in docs + any run acceptance helpers:

| Level | Must prove | Not main acceptance until passed |
|-------|------------|----------------------------------|
| L0 | ≥1 tool Created→component_runs ok | AR full chain, Meta process governance, ROI |
| L1 | Same component called again with via++ / level progress | Declarative platform-wide watch, similar-code search platform |
| L2 | Failures/Successes change next-turn save/call behavior | Critic auto-rewriting plans, parallel REVIEW as subjects |
| L3 | Meta process-rule change with observable improvement | — |

Critic/Refiner/LEVEL REVIEW remain kill-switchable; opening them must not replace L0/L1 hard gates.
Update AGENTS.md / relevant JOB docs to cite this ladder.

---

## Implementation order (one Codex session)
1. P1 + P4 (logical names + promote one-hop).
2. P3 Hook contract + tool surface.
3. P2 Daemon resident materials + unlock RESPONSE identity.
4. P5 naming/isolation in prompts and injection paths.
5. P6 acceptance ladder in docs + acceptance scripts.

## Tests
- Unit/smoke for: logical-name save/promote mapping; harness path write redirect; Hook payload builder; Daemon Failures/Successes resident slots; promote without convert.md; four-state vs thin-ledger injection off.
- Prefer existing test runners. If full ARC e2e needs keys/long time, document and run focused unit/smoke instead.
- Write RESULT to `docs/jobs/2026-10-31-P1-P6-RESULT.md`: changes, verify steps, gaps, commit hash.

## Git
- Commit on current branch with clear message(s). Do not force-push. Push if remote tracking exists and push is safe; else leave local and note in RESULT.
- Do not auto-promote components in product code.

## Done means
P1–P6 contracts exist in code + AGENTS/docs; unit/smoke green for new contracts; RESULT.md written; Created→Called path is shorter for the agent (logical name + promote) than before.
