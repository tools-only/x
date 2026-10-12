# Pi 0.87.0 compaction for the thin ARC harness: final plan (2026-10-12)

Status: design-only consolidation of two drafts. No code written. Author: Claude as design lead; integrating Codex's draft. Verified against Pi `@earendil-works/pi-coding-agent` **0.87.0** installed under `node_modules/`.

Scope: this plan is the single approved target for implementation. It supersedes both input drafts:
- `docs/plans/2026-10-12-pi-compaction-plan-claude.md`
- `docs/plans/2026-10-12-pi-compaction-plan-codex.md`

Short diffs vs each draft are at the end (§11).

---

## 1. Decision summary

**We will do:**
1. Build a **native-compaction probe** in a scripted, offline-friendly harness. It drives real Pi 0.87.0 via RPC with the smoke provider and records every artifact at every boundary (raw branch, canonical projection, serialized summarizer request, stored entry, extension `context` output, **actual next ordinary provider transcript**, and the follow-on ARC action).
2. Classify the result by boundary: (a) native is sufficient, (b) summary stored but invisible to the next ARC request, (c) critical evidence lost in the summary input, or (d) legitimate non-use.
3. Apply the **minimum** adaptation that repairs the observed break, behind the `--continuity session` flag. Keep `rebuild` as the comparator.
4. Add a scripted compaction smoke that gates on **semantic next-request contents and the next ARC action**, not just RPC `status=completed`.
5. Final gate: a **real ARC run with no time cap and no token cap**, chosen tasks frozen with the user. Adapter-native cancellation / permission / environment-integrity safety stays; no invented caps.

**We will NOT do:**
- Start with a ledger-driven custom summarizer. Codex's objection stands and Claude concurs.
- Flip `set_auto_compaction` on without the probe. The default serializer keeps `[Assistant thinking]` and clips tool results at 2,000 chars; on ARC that is the worst combination.
- Add fields to `arc_action`, change the memory schema, enable session-file persistence, or touch the forced-review policy. Those are tracked separately (memory review M1–M6; `AGENTS.md` closure matrix; `docs/deferred-research-todos.md`).
- Edit installed `node_modules`. If a Pi-side fix is required, treat it as a version/patch decision requiring separate approval.
- Honor the continuity doc's "1-hour comparison" budget as the final gate. The user mandate overrides it.

**Falsifiable claim driving the probe.** For a long `--continuity session` chain, native Pi 0.87.0 compaction can turn relevant session evidence into a checkpoint that reaches a later ordinary ARC parent request, with the current complete observation intact, without another parent memory-maintenance step. The claim is refuted by any of: a stored summary invisible to the next request; a refuted hypothesis retained as true; loss of a decisive failure near the end of a long receipt; or net extra management/cost without task progress. First diagnose reachability; only then change the broken boundary.

---

## 2. Why probe first, not summarizer first

Reasons from the installed source and the two input drafts:
1. **Loss-of-evidence is the dominant uncertainty.** `dist/core/compaction/utils.js:74-131` still truncates every tool-result body at ~2,000 JS chars and still emits `[Assistant thinking]` verbatim. ARC receipts routinely exceed 2,000 chars and the decisive counterexample often sits near the end.
2. **0.87.0 removed several of Codex's earlier blockers.** `context_edit`, `agent_before_settle`, `context_with_system`, canonical session projection, `compaction.modelOverrides`, and `appendCompaction(summary, null, tokensBefore)` all exist (CHANGELOG 0.81–0.87; `dist/core/session-manager.js:184-279,961-989`; `dist/core/compaction/compaction.js:627-665`; `dist/core/extensions/types.d.ts:442-475`). We must measure if those are enough before writing more code.
3. **ARC `historyMessages()` has no case for `compactionSummary`.** The thin extension (`demo/arc_thin_extension.ts:1486-1530`) walks earlier user/assistant/tool-result entries. Pi's canonical projection represents a stored summary as a `compactionSummary` custom message (`dist/core/session-manager.js:184-201`). If native compaction succeeds, the summary can still be dropped on the next request. Codex flagged this; it is now a central probe check.
4. **The probe is cheap.** Scripted provider, no paid tokens, deterministic. Running it first is strictly dominant.

---

## 3. 0.87.0 interface map used by this plan

Only the pieces this plan actually relies on. Confirmed by inspection of installed 0.87.0:

| API | Where | Why we need it |
| --- | --- | --- |
| `pi.on("session_before_compact", (event, ctx) => preparation \| { cancel: true } \| { compaction })` | `dist/core/extensions/types.d.ts:442-475`; `examples/extensions/custom-compaction.ts` | Observe `preparation` read-only in Phase 1; replace input or synthesize summary conditionally in Phase 3. |
| `pi.on("session_compact_failed", …)` | same | Pair with failures: `aborted`, `errorMessage`, `reason ∈ {manual,threshold,overflow}`, `willRetry`. |
| `ctx.compact({ customInstructions?, onComplete?, onError? })` | `examples/extensions/trigger-compact.ts` | Alternative trigger. Phase 1 may use `send(prompt="/compact")` instead; both go through the same path. |
| `convertToLlm`, `serializeConversation` | exported from `@earendil-works/pi-coding-agent` | Reproduce the exact text Pi hands the summarizer, for comparison in the probe. |
| `sessionManager.appendCompaction(summary, firstKeptEntryId \| null, tokensBefore)` | `dist/core/session-manager.js` | Store the summary. `null` encodes retain-none. |
| `sessionManager.appendContextEdit(entryId, null \| replacement)` | `dist/core/session-manager.js:961-989` | Persistent hide/replace for raw entries. **Available, but a clean extension-level route is TBD** (Codex). Do not depend on it in Phase 3 unless the probe shows no cheaper fix. |
| `compaction.enabled`, `reserveTokens`, `keepRecentTokens`, `modelOverrides["provider/modelId"]` | `docs/compaction.md`; settings resolved into `preparation.settings` | Required for yibu qwen3.8-27b because defaults (16k reserve, 20k kept) are tuned for 200k-context frontier models. |
| RPC `set_auto_compaction`, `prompt /compact [instructions]`, `new_session`, `abort`, `steer`, `follow_up` | `dist/modes/rpc/rpc-mode.js:419-425`; `docs/rpc.md:397-446` | Already used by the harness (`arc_thin_e2e.py:686`); manual compact works even with auto off. |

Serializer specifics still true in 0.87.0 (Codex's warning stands): tool-result bodies clipped at ~2,000 chars; `[Assistant thinking]` preserved; **no image bytes to the summarizer**; split-turn runs two sequential summary calls (`dist/core/compaction/compaction.js:518-559,706-763`); `stopReason:length` is rejected rather than saved as a partial summary.

---

## 4. Explicit note: `compactionSummary` / `historyMessages` visibility

This is the single risk Claude's prior draft understated and Codex sharpened.

**Observation (source-level, pre-probe).** Pi's canonical projection represents a stored compaction summary as a custom `compactionSummary` entry (`dist/core/session-manager.js:184-201`). `demo/arc_thin_extension.ts` under `--continuity session`:
- `historyMessages()` (around lines 1486–1530) only matches `user`/`assistant`/`tool-result` entry kinds and uses an earlier user message as its decision boundary.
- The `context` hook (around 1532–1546) drops the trailing user message, prepends `historyMessages` output, then appends the current working set.
- There is **no branch for `compactionSummary`** and no branch for other custom/branch messages.

**Predicted failure mode.** A successful native compaction can leave `sessionManager` holding a valid summary while every subsequent ARC request is still constructed from `historyMessages` + working set, with the summary absent. The RPC call returns `status=completed`; the model never sees the summary. This matches Codex's boundary (b).

**Probe must assert.** The actual next ordinary provider transcript contains the summary text (whether via a dedicated `compactionSummary` branch in `historyMessages`, or by composition into the working set). An extension-side array check is not sufficient.

**Conditional fix (only if the probe hits this).** Add exactly one branch to `historyMessages()`: when a `compactionSummary` entry sits between the kept decisions and the latest user message, emit it once in a dedicated slot ahead of the retained decision suffix, preserving its text and the current working set at the end. Do not synthesize summary content from the ledger. See §7 Phase 3b.

---

## 5. Probe design

**Objective.** Resolve the §1 falsifiable claim per boundary (a/b/c/d). Produce numbers, not adjectives.

**Harness.**
- Launcher: new `tools/arc_thin_compaction_probe.ts`, scripted-only. Reuses `tools/arc_thin_smoke_provider.ts` for parent requests and routes summary calls through the same provider so the summary text is deterministic. New Python entry on `cli.py` (e.g. `python -m autoresearch_pi arc-thin smoke --compaction-probe`), isolated run directory `runs/arc-thin-compaction-probe-<ts>/`. **Do not** edit `demo/arc_thin_extension.ts` or `src/autoresearch_pi/arc_thin_e2e.py` in Phase 1.
- Pi: real 0.87.0 via `_resolve_pi_cli`; `run-config.json` records `pi_cli` and `pi_version`. Reject mixed-version evidence (`PI_AUTORESEARCH_PI_CLI` must not point at 0.80.6).

**Session seed.** Build a representative long chain *at the raw-branch level*:
- 20 synthetic decisions × ~2k-char fake receipts to cross `keepRecentTokens` (default 20k).
- Within the chain: one **explicit hypothesis followed by its refutation**; one receipt longer than 2,000 chars with the **decisive counterexample placed after char 2,000**; one assistant turn with a long distinctive `[Assistant thinking]` marker (~5k chars); the current grid/image in the latest turn.

**Trigger.** After settlement, drive `send("prompt", body="/compact")` (or `ctx.compact({ onComplete })` from the extension — both land in `prepareCompaction`). Record `reason ∈ {manual, threshold, overflow}`. For threshold/overflow, drive the chain across the model-override threshold rather than issue `/compact`.

**Variants.**
| V | Shape | Measures |
| --- | --- | --- |
| V1 | Long `[Assistant thinking]` across turns | How much of the summary input is reasoning char-share vs tool-result char-share. |
| V2 | 10k-char receipt with counterexample after char 2,000 | Does the counterexample reach the summary? Reach the next ordinary request? |
| V3 | One turn exceeds `keepRecentTokens` (split-turn) | Two sequential summary calls land; `turnPrefixMessages` populated; combined `usage` recorded. |
| V4 | `--continuity session` on, N=8 decisions, then compact | **compactionSummary visibility**: does the summary appear in the next ordinary provider transcript? Does ARC's `historyMessages` drop it? |
| V5 | Second compaction after V4 updates the prior summary | Does prior summary roll into the new one, or does information disappear? |
| V6 | Mid-compaction abort via `signal` | `session_compact_failed` fires with `aborted=true`, no partial summary stored. |
| V7 | Length-stop during summary | Rejected per source (`compaction.js:475-559,752-755`); confirm no partial summary is persisted. |
| V8 | Nothing eligible to compact | Legitimate non-use — no forced compaction, no invocation-count inflation. |

**Capture per event (`compaction-probe.jsonl`).**
- RPC request/response, including `status`, `errorMessage`, `reason`, `willRetry`, `estimatedTokensAfter`.
- `preparation`: `messagesToSummarize.length`, `turnPrefixMessages.length`, `previousSummary?.length`, `tokensBefore`, `firstKeptEntryId`, `settings`, serialized conversation text via `serializeConversation(convertToLlm(…))`, serialized summary input char histogram (reasoning vs tool-result vs other), marker excerpts/hashes/lengths (no credentials, no image bytes).
- Raw branch IDs and types vs `buildSessionProjection(pathEntries)` output.
- Stored `CompactionEntry`: id, `firstKeptEntryId`, `usage` (input/output/reasoning/cache/cost when returned), wall time.
- Extension `context` hook output on the request immediately after compaction: full array shape, whether a `compactionSummary` fell on the floor, final `historyMessages` list.
- **Actual next ordinary provider request transcript**: assistant-visible text, marker assertions (did the refutation/counterexample reach the model?).
- Follow-on scripted ARC action: does the agent act consistently with the retained evidence?
- Delta in `context_budget.jsonl` and all `pi-events.jsonl` lines.

**What the probe does *not* do.** Change the extension. Flip `set_auto_compaction`. Issue custom summaries. Edit `node_modules`. Use the real yibu provider.

---

## 6. Probe interpretation → classification

After the probe, write a one-page memo at `docs/reports/2026-10-12-pi-compaction-probe.md` answering, per variant, the four questions below *and* classifying the overall result into exactly one of (a)-(d).

**Questions, each answered with a number from the artifacts:**
1. Is the summary input dominated by reasoning or by evidence? (char share of `[Assistant thinking]` vs tool-result bodies, per V1–V4.)
2. How many grid/receipt tool-results were clipped at 2,000 chars, and did the counterexample placed after char 2,000 reach (i) the summary, (ii) the next ordinary request? (V2.)
3. Did `firstKeptEntryId` land at a sensible user/assistant boundary, and did the rebuilt projection parse cleanly? (All variants.)
4. Did `compactionSummary` reach the next ordinary provider request under `--continuity session`? (V4, V5.)

**Classification.**
- **(a) Pass:** summary reaches the next request; counterexample survives either in the summary or in the kept window; no orphan tool-call/result pairs; `usage` populated; split-turn and abort behave per source.
- **(b) Delivery-only failure:** summary stored but not visible to the next request. ARC `historyMessages` needs a `compactionSummary` branch. Minimal fix in Phase 3b.
- **(c) Input-only failure:** summary generated, but it loses the decisive counterexample because of 2,000-char clipping or reasoning-dominated input. Minimal fix in Phase 3c.
- **(d) Legitimate non-use:** nothing eligible or evidence cannot be preserved safely; keep auto-compaction off; close out with a report, no code change.

Length/error cases from V6/V7 do not count as success and never become durable summaries.

---

## 7. Implementation phases (ordered, with done criteria)

Each phase gates on the preceding one. Phase 3 is a branch on §6 classification.

| # | Phase | Files touched | Done criteria |
| --- | --- | --- | --- |
| 0 | Confirm version identity | none (procedure) | `run-config.json` of a scripted run under the project install reports Pi `0.87.0` for `pi_cli` and `pi_version`; `PI_AUTORESEARCH_PI_CLI` not pointing at 0.80.6. |
| 1 | Build probe harness | New: `tools/arc_thin_compaction_probe.ts`; new sub-command in `src/autoresearch_pi/cli.py` (and a thin dispatcher in `arc_thin_e2e.py` only if required to reuse `_resolve_pi_cli`); reuse `tools/arc_thin_smoke_provider.ts`. **No edits** to `demo/arc_thin_extension.ts` or the main `arc_thin_e2e.py` runner. | Offline command runs all V1–V8 variants, writes `runs/arc-thin-compaction-probe-<ts>/compaction-probe.jsonl` with every capture field from §5, no paid tokens spent. |
| 2 | Interpret probe | New: `docs/reports/2026-10-12-pi-compaction-probe.md`; optional analysis script `tmp/compaction_probe_analysis.mjs`. | Memo answers §6 questions with numbers from the probe output and assigns a single classification (a/b/c/d). |
| 3a | **If (a):** minimal enable | `src/autoresearch_pi/arc_thin_e2e.py:686` (behind an env-var flag `ARC_THIN_AUTO_COMPACTION`, default `enabled` once Phase 4 is green); project `.pi/settings.json` adding `compaction.modelOverrides["yibu/qwen3.8-27b"] = { reserveTokens: <probe-derived>, keepRecentTokens: <probe-derived> }`; `demo/arc_thin_extension.ts` registers `session_before_compact` **tagging-only** (`details` with run id/game/level/`tokensBefore`) and `session_compact_failed` for telemetry. No summary override. | Scripted compaction smoke green; `context_budget.jsonl` records a `compaction_event` row; all four existing smokes stay green. |
| 3b | **If (b):** compactionSummary delivery fix | `demo/arc_thin_extension.ts` only — one new branch in `historyMessages()` that emits a dedicated `compactionSummary` slot ahead of the retained decision suffix, preserving its text and ordering (current working set remains last). Add a projection unit test for the new case; keep rebuild mode unchanged. Then as in 3a. | Scripted smoke asserts the summary text in the **actual next provider transcript**, not just the extension array. Rebuild path identical to before. |
| 3c | **If (c):** input-only adaptation | `demo/arc_thin_extension.ts` registers `session_before_compact` that rewrites `preparation.messagesToSummarize` tool-result bodies to a short truthful "receipt header + artifact reference" string **at the point of serialization only** before returning; preserve pairing, status, scope/coverage, and the exact artifact path. **Do not** issue a custom summary synthesized from the ledger. **Do not** edit `node_modules`. If no truthful under-2,000-char receipt is possible for a category of results, document the gap and escalate rather than fabricate. Then as in 3a. | Probe re-run shows the counterexample reaching both the summary and the next ordinary request. No orphan tool calls. No regression in the rebuild comparator. |
| 3d | **If (d):** no adaptation | Memo only. Keep auto-compaction off. | Phase 4 confirms rebuild and session baselines unaffected; final gate skipped or run only as the comparator. |
| 4 | Offline + scripted smokes | New compaction smoke under `tools/` or `tests/` that drives the real Pi 0.87.0 with the scripted provider and asserts (i) summary visible in next provider request, (ii) scripted follow-on ARC action is consistent with the retained evidence, (iii) `pi-events.jsonl` + `context_budget.jsonl` reflect the compaction. Rerun: `node --experimental-transform-types --test` (expect 83/83 + new tests), `pytest` (expect 8/8), existing `continuity`, `self-harness`, `ledger`, `environment` scripted smokes. | Pre-existing counts unchanged on their respective suites; the new compaction smoke green; split-turn and abort covered; rebuild comparator unchanged. |
| 5 | Final verification: real ARC, uncapped | Invocation only: `--provider yibu`, qwen3.8-27b high reasoning, `--continuity session`, auto-compaction on, Pi 0.87.0. **No invented time cap, no invented token cap, no invented action/decision cap.** Keep adapter-native cancellation / permission / environment-integrity safety. Tasks and comparator (`rebuild`) frozen with the user before launch. Record `pi_cli`/`pi_version`, provider identity, environment, all costs including unknown. | Run terminates on the adapter / game, not on a cap introduced here. Compaction events appear in `pi-events.jsonl` with `usage`. No `pi_failed` traced to a missing summary or dropped tool-call pair. The §1 falsifiable claim is confirmed or refuted with artifacts, not adjectives. |

Notes:
- Phase 3 branches are mutually exclusive at first iteration. If the probe shows (b) *and* (c), fix (b) first (one-line projection branch), rerun the probe, then address (c) if still present. "Change one main factor and re-probe" (Codex) is explicit.
- Keep `set_auto_compaction(enabled=…)` behind the env-var flag so a bad surprise is a flag flip, not a code change.

---

## 8. Offline / smoke gates before the real run

Minimum required state before Phase 5 starts:

1. Phase 2 memo exists at `docs/reports/2026-10-12-pi-compaction-probe.md` with a single classification.
2. Phase 3 adaptation (if any) is behind `--continuity session`; `rebuild` is unchanged and still passes its scripted smoke.
3. `node --experimental-transform-types --test` passes; `pytest` passes.
4. Scripted smokes: `continuity`, `self-harness`, `ledger`, `environment` all green.
5. New compaction smoke green and asserts semantic next-request content and the follow-on scripted ARC action, not just `status=completed`.
6. `run-config.json` from the smokes shows Pi 0.87.0 (`pi_cli`, `pi_version`).
7. `context_budget.jsonl` includes a `compaction_event` column with `tokensBefore`, `summary_chars`, `usage.input_tokens`, `usage.output_tokens`, wall time.
8. Rollback: `ARC_THIN_AUTO_COMPACTION=0` disables Phase 3a's enable without touching code.

If any of the above fails, do not start Phase 5. Fix in place, re-probe only the factor that changed.

---

## 9. Final verification: real ARC task, no time limit, no token limit

User mandate (hard): after Codex implements, run real ARC tasks with **no time cap and no token cap**. The continuity doc's "1-hour comparison" budget is explicitly dropped for this gate. Do not invent replacement caps.

What is kept (adapter-native safety only):
- Pi's own cancellation plumbing (`abort`, `signal`), permission handling, provider admission, environment-integrity checks (`run-config.json`, version pinning, no mixed Pi versions).
- The ARC SDK / bridge / game natural termination (GAME_OVER, WIN, SDK deadline if any).
- Logging and accounting pipelines (`pi-events.jsonl`, `context_budget.jsonl`).

What is removed from the harness-invented defaults for this run:
- `experiment_timeout_seconds`: do not use the current short value; either unset or route to the adapter's own native deadline, with the choice recorded in `run-config.json`.
- `max_actions` / decision-count ceiling: not invented here; rely on the adapter's native limits.
- Any token-budget harness check that would terminate a run before provider refusal.

Chosen tasks, comparator (`rebuild`), model and thinking settings, and the exact uncapped invocation are frozen with the user before launch and recorded in `runs/<ts>/run-config.json`. All outputs — levels, actions-per-hour, compaction event count/latency, summary visibility rate, management-turn count, repeated-refuted-test count, parent+summary+child token totals, and unknown provider cost — are recorded verbatim. Nothing in this plan is a proof of game quality; Phase 5 is the only gate for that.

---

## 10. Open risks and what to escalate to George

Risks that remain even after the probe is clean:
- **Model-override calibration.** Default `reserveTokens=16384` / `keepRecentTokens=20000` are frontier-tuned. The probe produces concrete numbers for yibu qwen3.8-27b, but field conditions may differ; keep the override in `.pi/settings.json` where it can be tuned without redeploy.
- **Compaction + recovery interaction.** Under `--continuity session`, idle/length recovery keeps the Pi session (`arc_thin_e2e.py:706-760`). A compaction fired just before a `new_session`-based recovery would be thrown away. Phase 3 must not add `new_session` calls to the session-mode recovery path.
- **Image-to-text duality.** The summarizer never sees image bytes. ARC's working set already contains a text rendering of the current grid; confirm during the probe that the text copy is in the kept window after compaction. If not, keep the current working-set composition policy for the kept side.
- **`usage` reporting on yibu.** If the real provider does not return a `usage` block on summary calls, telemetry falls back to char counts + wall time only. Record this in Phase 5's `run-config.json`.
- **Codex-vs-reality drift.** Codex originally reviewed 0.80.6. If a Codex patch at implementation time still targets 0.80.6 APIs (e.g. uses `getBranch` paths that 0.87 replaced with `buildSessionProjection`), stop and reconcile before merging.

Escalate to George before starting Phase 5:
- The frozen task list and the comparator run (`rebuild`).
- The exact uncapped invocation string.
- Confirmation that provider cost may run unbounded for the test window, and the artifact-retention plan if the run is interrupted.

Escalate to George before merging if the probe hits (c) and no truthful under-2,000-char receipt exists for a category of ARC results. Options then are a version-controlled Pi dependency change (not editing `node_modules`), a documented limitation, or a bounded extension-side rewrite path through `appendContextEdit` once a clean route is confirmed.

---

## 11. Diffs vs the two input drafts

### 11a. vs `docs/plans/2026-10-12-pi-compaction-plan-claude.md`

**Kept from Claude:**
- The 0.87.0 interface mapping and the appendix of APIs used (§3).
- Phase sequencing with explicit files, flags, and done criteria (§7).
- Concrete probe sizing (20 synthetic decisions × ~2k chars; variants V1–V3; model-override settings).
- `ARC_THIN_AUTO_COMPACTION` flag so enabling is reversible without code change.

**Changed or sharpened from Claude:**
- The `compactionSummary` / `historyMessages` visibility risk is **promoted from a Phase-5 open question (`"V4"` + a §12 bullet) to a central probe check and its own section (§4)**. Codex is right that this is a predictable source-level break.
- Final gate: Claude's "adapter-native 12 h default + `--max-actions` native ceiling" is replaced by "no invented time cap, no invented token cap; adapter-native safety only" per the user mandate.
- Added two probe variants (V5 repeated-compaction, V8 non-use) that Claude's draft merged implicitly.
- Phase 3b now specifies a one-branch addition to `historyMessages()` for `compactionSummary` delivery rather than attempting a broader rewrite in `session_before_compact`.
- `appendContextEdit` is downgraded from "core enabler" to "available-but-extension-route-TBD"; it is not depended upon in Phase 3 unless the probe forces it.

### 11b. vs `docs/plans/2026-10-12-pi-compaction-plan-codex.md`

**Kept from Codex:**
- The sharper falsifiable claim and its explicit refutation conditions (§1).
- Boundary-based classification (a/b/c/d) replacing a flat pass/fail (§6).
- The 2,000-char-with-counterexample-at-end probe case (V2).
- The hard rule that "actual next ordinary provider transcript" is the gate, not an extension-side array check.
- The caution that temporary `context` rewrites cannot fix compaction input; input fixes must happen in `session_before_compact`.
- "Change one main factor and re-probe" between adaptations.
- Explicit non-use case (V8) so compaction is not forced to inflate invocation counts.

**Changed or sharpened from Codex:**
- Where Codex marked file paths and commands "TBD at implementation", this plan commits to concrete locations (new `tools/arc_thin_compaction_probe.ts`, new `cli.py` sub-command, no edits to the main runner or extension in Phase 1).
- Model-override settings for yibu qwen3.8-27b are included explicitly (Codex omitted this).
- The split-turn, abort, and length-stop cases become named variants V3/V6/V7 with capture requirements, not a prose paragraph.
- The final gate is phrased identically to the user mandate; Codex already pointed away from the 1-h budget, this plan removes any remaining ambiguity.
- The `compactionSummary` fix is specified as a single new branch in `historyMessages()`, not an open design question.
