# Pi native compaction for the thin ARC harness: plan (2026-10-12)

Status: proposal, no code written yet. Analysis + sequenced plan for Codex. Author: Claude. Verified against Pi `@earendil-works/pi-coding-agent` **0.87.0** installed in `node_modules/`.

## 1. Problem

The thin harness runs with `--no-session` and immediately disables auto-compaction (`arc_thin_e2e.py:651` and `:686`). The 2026-10-12 continuity work added an **in-process** session-reuse mode (`--continuity session`, up to N earlier decisions re-shown through the `context` hook) but **key compaction is not wired**:

- Pi's auto-threshold compaction is off, so an ARC run cannot survive context overflow by summarizing older turns.
- There is no mapping between our *rebuilt* `context` projection and the *raw* branch Pi would feed to the summarizer, so if we simply flipped `set_auto_compaction` on, Pi would summarize things we were hiding (old grids, dropped reasoning) and skip the working set we build.
- Review turns on the critical path (10–34% of output, up to 19 min per level change — see `docs/reports/2026-10-12-overnight-runs-review.md` §2.2) still exist because we had no cheaper summarizer to lean on.

The question this plan answers: **is Pi 0.87.0's native compaction good enough to replace forced reviews, with minimum adaptation?** The first move must be a cheap probe, not a custom summarizer.

## 2. Evidence consulted

- `docs/plans/2026-10-12-pi-native-continuity.md` — the continuity change record and next-step 1 ("Compaction inspection, no model cost").
- `docs/reports/2026-10-12-memory-mechanism-review.md` — governance cost breakdown; M5 (background consolidation) is deferred until M1–M4.
- `docs/reports/2026-10-12-overnight-runs-review.md` — review-turn length, three reviews hit the 32k output cap (D5), and the per-action-time ceiling.
- `.scratch/codex-pi-foundation-review-L38205.md` — Codex's compaction-input warning (thinking kept, tool results truncated to 2000 chars, no image input, two-stage split-turn summaries), reviewed against 0.80.6.
- `node_modules/@earendil-works/pi-coding-agent/docs/compaction.md`, `dist/core/compaction/*.js`, `examples/extensions/custom-compaction.ts`, `examples/extensions/trigger-compact.ts`, `CHANGELOG.md` 0.80.x → 0.87.0.
- Code: `demo/arc_thin_extension.ts` (`historyMessages` 1486–1530, `context` hook 1532–1546), `src/autoresearch_pi/arc_thin_e2e.py` 630–730, `src/autoresearch_pi/cli.py` 200–204, `src/autoresearch_pi/pi_kernel.py` 177 `send`, 466 `new_session`.
- `tools/arc_thin_smoke_provider.ts` — reads prompt/tools from the leading system message using `getCurrentSystemPrompt`/`getCurrentTools`, so an identical probe is cheap.

The incremental-worktree memo (`D:\autoresearch_pi_incremental_20261012\checks\pi-memory-baseline-research.md`) is outside the session's allowed roots; mark as unread.

## 3. 0.87.0 vs 0.80.6 — differences that matter for compaction

Codex's review was against 0.80.6; several interfaces it flagged as missing exist in 0.87.0. Record them so the plan does not re-litigate what shipped.

| Area | 0.80.6 (Codex's reading) | 0.87.0 (installed) | Impact on this plan |
| --- | --- | --- | --- |
| Append-only context edits | not present | `sessionManager.appendContextEdit(entryId, null)` + `ContextEditEntry` in `SessionEntry` union | Lets us hide the raw entry Pi would otherwise feed the summarizer, without rewriting history. Core enabler. |
| `context_with_system` hook | not present | fires after `context`, sees system messages, result sent verbatim | A second place we can intercept the compaction *input* if `context` is insufficient. |
| `turn_end` / `agent_before_settle` actionable boundaries | partial | required boundary fields on `TurnEndEvent`; `AgentBeforeSettleEvent` can `return { entries, continue: true }` | We can decide between turns whether to force a compaction without racing the queue. |
| `ctx.compact({ customInstructions, onComplete, onError })` | present | present, with abort via `signal` | How we trigger a compaction from the extension (see `examples/extensions/trigger-compact.ts`). |
| `retain-none` compaction | not available | `appendCompaction(summary, null, tokensBefore)`; the entry's own ID becomes `firstKeptEntryId` | Lets the summary fully replace older turns — the shape Codex wanted "all" but could not configure. |
| Per-model budgets | present (0.86+) | `compaction.modelOverrides` keyed by `provider/modelId` | Needed because yibu qwen3.8-27b's effective context differs from the default 16k reserve. |
| Serializer behavior | truncates tool results at 2000 chars; keeps `[Assistant thinking]`; no image input to summarizer | **unchanged in 0.87.0** (`docs/compaction.md` §"Message Serialization") | Codex's loss-of-evidence warning stands. This is the main thing the probe must measure. |
| `context` handlers | can drop prompt/tools | 0.87 restores the prompt and built-in tool state *after* `context` runs (#9789, #9822) | Our rebuild projection is safe even if an extension-driven compaction fires. |
| Mid-run threshold compaction | silently skipped oversized trailing tool results | fixed (#9740) | A late ARC frame will no longer be dropped from the summarizer silently. |
| Length-stop recovery | retained aborted attempts | post-run `context_edit` omissions + optional compact-and-retry | Means D4 (900 s runaway) could use native recovery instead of our custom new_session dance. |

## 4. Reconciliation with Codex

| Codex position | Status after 0.87.0 inspection |
| --- | --- |
| "Reuse Pi session, persistence, compaction infrastructure" | Agreed. Keep this plan on that trajectory. |
| `context_edit` / `agent_before_settle` do not exist | Both exist in 0.87.0; use them. |
| Native compaction can preserve reasoning while truncating evidence | Confirmed by `dist/core/compaction/utils.js` — thinking kept, tool results clipped at 2000 chars. **This is the single biggest risk.** The probe exists primarily to measure it on ARC input shapes. |
| `steer` queues but does not interrupt an in-flight generation | Correct in 0.87.0 (`cli.py` already treats steer as queued). Not part of this plan. |
| Compaction accounting must flow through the same budget/diagnostics as the main agent | Agreed. `session_compact_failed` + `onComplete`/`onError` + the `usage` field on `CompactionEntry` give us the hooks. |
| Do not start with a custom summarizer that rebuilds everything from the ledger | Agreed. Probe first; adapt the native path minimally; only replace it if the probe shows unrecoverable loss. |
| Level transition should not auto-trigger a semantic review | Agreed. Compaction and the forced CONSOLIDATE turn are separate levers; this plan touches only the first. |

## 5. Current wiring (today, 2026-10-12 HEAD)

- `arc_thin_e2e.py:650` launches Pi `--no-session --no-extensions --no-skills --no-prompt-templates --no-context-files --no-builtin-tools --extension demo/arc_thin_extension.ts`.
- `arc_thin_e2e.py:686` immediately `kernel.send("set_auto_compaction", enabled=False)` after startup; no `/compact` or `ctx.compact(…)` call anywhere else.
- `demo/arc_thin_extension.ts:1532` registers one `context` hook that drops the trailing user message, prepends the working set (grid + image + ledger view + resources), and in `continuity === "session"` prepends up to N earlier decisions via `historyMessages` (reasoning dropped, tool results clipped to `HISTORY_RESULT_CHARS = 400`, skill source replaced).
- No `session_before_compact` or `session_compact_failed` listener is registered. No `context_with_system`. No `turn_end` / `agent_before_settle` return of `{ entries, continue: true }`.
- The raw Pi branch (what `SessionManager.getBranch()` sees) still contains every tool result in full, including the full grid dumps and the long assistant reasoning blocks — because our `context` hook only filters what each request sees, not the stored transcript.

What continuity covers that compaction must not duplicate: the last N decisions already appear in-view through the `context` projection. Compaction's job is older turns beyond that window.

What continuity does *not* cover: process restart (we are still `--no-session`), context overflow in a single long turn, and the forced reviews. Compaction can address overflow; forced reviews are a separate decision tracked under M1 in the memory review.

## 6. Recommended approach

**Minimum first move: a native-compaction probe.** Do not add a custom summarizer, do not touch the `context` hook, do not change the review policy. The probe determines whether native compaction is viable and, if not, pinpoints which adaptation is required.

Why probe first:
1. Codex's loss-of-evidence warning is the dominant uncertainty. Measure it before writing code that assumes native is fine *or* that we must replace it.
2. 0.87.0 removed several blockers Codex noted. The probe tells us if those additions are enough.
3. The probe is cheap: scripted provider, no yibu cost, offline-friendly.

If the probe passes, the only adaptation needed is a one-screen extension hook that filters the compaction *input* so grids and other large tool results are presented by reference rather than truncated at 2000 chars. If it fails on evidence, we fall back to a `session_before_compact` summary that composes {serialized recent turns} + {working-set snapshot} ourselves.

Explicitly rejected first moves:
- A ledger-driven custom summarizer. Codex's objection applies: it would make the ledger responsible for every piece of continuity, which is exactly the loop today's cost comes from.
- Flipping `set_auto_compaction` on without a probe. The default serializer will keep reasoning and clip grids — that is the worst combination for ARC.

## 7. Probe design (cheap, offline, deterministic)

Goal: construct a synthetic session whose raw branch is representative of an ARC run near the compaction threshold, trigger `/compact` through RPC, and record both the input Pi gave the summarizer and the output.

Shape:

1. **Launcher:** reuse `tools/arc_thin_smoke_provider.ts` for the main Pi provider so no real tokens are spent. Add a *probe mode* flag that, instead of streaming scripted assistant turns, replies with pre-canned content long enough to cross `keepRecentTokens`. 20 synthetic decisions × ~2k chars of fake tool results each should put us past the default 20k.
2. **Compaction extension:** register `session_before_compact` and `session_compact_failed` for *observation only* — do not return a custom summary. Write the full `preparation` struct to `runs/.../compaction-probe.jsonl`: `messagesToSummarize.length`, `turnPrefixMessages.length`, `previousSummary?.length`, `fileOps`, `tokensBefore`, `firstKeptEntryId`, `settings`, serialized conversation text (via `serializeConversation(convertToLlm(…))`), the generated summary, `usage`, and wall time.
3. **Trigger:** after seeding the session, issue `/compact` via the existing `kernel.send("prompt", message="/compact")` or (if available) a direct `ctx.compact({ onComplete })` from the extension. Record whether the trigger was `threshold`, `manual`, or `overflow`.
4. **Variants:**
   - V1: synthetic turns contain `[Assistant thinking]` of ~5k chars each → how much thinking survives the summary?
   - V2: tool results include 10k-char grid dumps → how much evidence is lost at the 2000-char serializer clip? Which 2000 chars survive — the ones that cite action receipts, or the ones that describe the grid layout?
   - V3: split-turn (one single turn exceeds `keepRecentTokens`) → verify the two sequential summary calls land and `turnPrefixMessages` is populated.
   - V4: continuity + compaction interaction. Run the probe with `--continuity session`; confirm that the `context`-projection view of the kept span is coherent with the summary attached before it (`context` fires on the rebuilt-with-summary projection; 0.87 guarantees prompt/tool restoration after `context`).
5. **Summarizer provider:** route the summary call through the smoke provider too, so the summary text is deterministic — we are measuring *what Pi asked for*, not what qwen replied.
6. **Accounting:** record `usage` from `CompactionEntry` and the delta in `context_budget.jsonl` across the compaction event. The probe must prove compaction appears in the same budget/telemetry pipeline Codex asked us to protect.

Deliverables of the probe: `runs/arc-thin-compaction-probe-<ts>/compaction-probe.jsonl` plus a 1-page summary with the four questions:

- Is the summary input dominated by reasoning or by evidence? (char share of `[Assistant thinking]` vs `[Tool result]`.)
- How many grid-bearing tool results were truncated to 2000 chars, and did any action receipt survive the clip?
- Did `firstKeptEntryId` land on a sensible boundary (user message or assistant boundary), and does the rebuilt projection parse correctly?
- Does `session_compact_failed` fire on cancellation, and is `usage` populated on success?

## 8. Implementation plan for Codex

Sequenced steps. Everything after step 2 is conditional on step 2's result.

| # | Step | Files / flags | Done when |
| --- | --- | --- | --- |
| 1 | Build the probe harness | New: `tools/arc_thin_compaction_probe.ts` (scripted session + instrumented `session_before_compact`). New Python entry on `arc_thin_smoke` or a separate `cli.py` sub-sub-command. Reuse `arc_thin_smoke_provider.ts`. No change to `demo/arc_thin_extension.ts`. | `python -m autoresearch_pi arc-thin smoke --compaction-probe` runs offline, emits `compaction-probe.jsonl` with all V1–V4 variants. |
| 2 | Interpret probe | Analysis script `tmp/compaction_probe_analysis.mjs`; one-page memo under `docs/reports/2026-10-12-pi-compaction-probe.md`. | The four questions in §7 answered with concrete numbers from the probe output. |
| 3a | **If probe passes** (evidence preserved, cut points sane): minimal adaptation. Register `session_before_compact` *only to tag* `details` with the ARC run id/game/level and `tokensBefore`; let Pi generate the summary. Then flip `kernel.send("set_auto_compaction", enabled=True)` in `arc_thin_e2e.py:686` and add `compaction.modelOverrides["yibu/qwen3.8-27b"] = { reserveTokens: <probe-derived>, keepRecentTokens: <probe-derived> }` in a project `.pi/settings.json`. | A full-chain scripted smoke equivalent to `runs/arc-thin-continuity-smoke-*` with auto-compaction on and `set_auto_compaction` default toggled on. |
| 3b | **If probe fails on evidence** (grids clipped, receipts lost): adapt the compaction *input* only. In `session_before_compact`, replace `preparation.messagesToSummarize` tool-result bodies with a short "receipt + reference to run artifacts" string before serialization. Compose the final summary string manually by appending the current working-set snapshot (what `buildWorkingSet` produces at the time of compaction) to Pi's summary text, then return `{ compaction: { summary, firstKeptEntryId, tokensBefore, usage } }`. | A probe re-run shows evidence preserved by reference; the summary includes a usable receipt table. |
| 3c | **If probe fails on cut-point / split-turn**: narrower adaptation. Return `{ cancel: true }` under conditions we cannot handle (unanswered tool call), log the reason, let the run continue uncompacted; the auto-compaction retry policy already handles this. Do not implement 3a or 3b until the cut-point case is addressed. | `session_compact_failed` fires with expected `reason`; the run does not crash. |
| 4 | Offline checks | `pytest`, `node --experimental-transform-types --test`, the existing `continuity` / `self-harness` / `ledger` / `environment` scripted smokes, plus a new `compaction` smoke. | 83/83 Node (plus the new compaction test), 8/8 pytest, and all four scripted smokes stay green. |
| 5 | Uncapped real ARC | `--continuity session`, `--provider yibu`, qwen3.8-27b high reasoning, auto-compaction on, **no time cap, no action cap, no decision cap**. Set `--experiment-timeout-seconds` to the adapter's default (12 h) and `--max-actions` to the adapter's native ceiling. Run against `ls20` and `lp85`. | Levels reached, actions per hour, compaction count/latency, and the four probe questions re-answered on real data all recorded in `runs/`. |

Step 5 will touch the already-pinned `pi_cli` resolver (`--provider yibu`, Pi 0.87.0). Do not change `_resolve_pi_cli` or `package.json` pins. Do not add fields to `arc_action`.

## 9. Acceptance criteria

**Probe (step 1–2):**
- `compaction-probe.jsonl` records at least four compaction events (V1–V4) with full `preparation` + `summary` + `usage`.
- `session_compact_failed` fires at least once when an abort signal is sent mid-summarization.
- The memo answers the four §7 questions with numbers, not adjectives.

**Minimal adaptation (step 3a or 3b):**
- Scripted compaction smoke: the agent sees a summary + a kept window; working-set grids are still correctly projected after compaction; no tool call appears without its result in the shown history.
- `context_budget.jsonl` gains a `compaction_event` column recording `tokensBefore`, `summary_chars`, `usage.input_tokens`, `usage.output_tokens`, and wall time.
- No regression in `continuity` / `self-harness` / `ledger` / `environment` smokes.
- `set_auto_compaction(enabled=True)` is kept in a flag, not hard-wired, so a bad surprise can be reverted without a code change (env var `ARC_THIN_AUTO_COMPACTION`, default `enabled` once step 2 is green).

**Uncapped real ARC (step 5):**
- The run terminates on its own (GAME_OVER, WIN, or adapter default deadline) — not on the harness's internal cap.
- Compaction appears in the same `pi-events.jsonl` and `context_budget.jsonl` as the main agent, and `pi-events` records at least one successful compaction on a run that would have hit overflow without it.
- No run ends on `pi_failed` where the root cause is a missing summary or a dropped tool-call pair.

## 10. Out of scope

- Changing M1 (level-change forced CONSOLIDATE) or any memory-ledger M2–M6 proposals.
- Enabling `--session` (session-file persistence across process restarts). Continuity is still process-local.
- Routing the critic through `sendMessage(…, deliverAs: "steer")`.
- Shortening or restructuring the ARC working-set projection.
- Adding fields to `arc_action` or changing the memory schema.
- Chasing D1 (`steps` ACTION6 shape), D2 (critic prefix), D3 (idle-stall policy), D4 (900 s runaway), D6/D7 (critic reasoning / miss trigger). These are tracked separately.
- Branch summarization (`/tree`). Not used by the thin harness.

## 11. Verification phases

| Phase | Provider | Cost | What it verifies |
| --- | --- | --- | --- |
| Probe (step 1–2) | scripted smoke provider; Pi 0.87.0 real | essentially free | input/output shape of native compaction, loss-of-evidence magnitude, trigger/abort/accounting plumbing |
| Minimal adaptation (step 3) | scripted smoke provider; Pi 0.87.0 real | free | the extension's `session_before_compact` returns a coherent summary; no cut-point regressions; smokes stay green |
| Offline checks (step 4) | scripted | free | pytest + Node tests + the four existing smokes; new compaction smoke |
| Uncapped real ARC (step 5) | yibu qwen3.8-27b high reasoning, Pi 0.87.0, real ARC SDK | paid | behavior on actual ARC input shapes with no time/token caps invented here; adapter-native deadlines only |

No invented caps anywhere. If the uncapped real run has to stop, it stops because the adapter or the game ended it.

## 12. Risks and open questions

- **Evidence loss.** `serializeConversation` clips every tool result at 2000 chars and preserves `[Assistant thinking]`. ARC grids are routinely larger than 2000 chars and the receipt header (action/level/score) usually sits at the top, so the receipt may survive while the grid state does not. The probe measures this; 3b exists to recover from it.
- **Image input to the summarizer.** The summarizer does not see images (`docs/compaction.md` §"Message Serialization"). Any state the agent inferred from a PNG must have been written to text in the kept window to survive compaction. Our working set already includes both; confirm the compaction input retains the text copy.
- **Cut-point stability under continuity.** With `--continuity session`, the kept window shown by `context` and the kept window chosen by compaction (`firstKeptEntryId`) are not the same object. If the summarizer cuts inside the continuity window, the next `context` call will re-expose text already in the summary. Not necessarily wrong, but worth measuring (V4).
- **Model-override calibration.** The probe produces concrete `reserveTokens`/`keepRecentTokens` for yibu qwen3.8-27b. Without override, defaults (16384 reserve, 20000 kept) are tuned for 200k-context frontier models; a smaller model will trigger much earlier or much too late.
- **Compaction and new_session interaction.** On idle-timeout recovery under `continuity=rebuild`, we call `kernel.new_session()` (`arc_thin_e2e.py:730`). Under `continuity=session` we deliberately do not. Compaction belongs to the Pi session, so a new session discards the summary; make sure 3a does not accidentally compact just before a recovery that would throw the result away.
- **Accounting gap.** `CompactionEntry.usage` only arrives when the summarizer returns a usage block. The smoke provider must stub `usage` for the probe, and we must verify yibu returns it in step 5. If it does not, we need a fallback in the extension that records latency + char counts.
- **Codex delta.** This plan assumes Codex implements against 0.87.0, not 0.80.6. If a Codex patch targets 0.80.6 APIs, flag it before merging (`_resolve_pi_cli` could still pick up a global 0.80.6 if `PI_AUTORESEARCH_PI_CLI` is set).

Open questions the probe answers, listed in priority order:

1. Does any ARC-shaped tool result survive the 2000-char clip in a form the agent can read?
2. Does `firstKeptEntryId` always land at a user/assistant boundary when continuity history is present?
3. On split-turn, are the two sequential summary calls priced acceptably on yibu, or do we need `retain-none` compaction + a single pass?
4. Is `onError`/`session_compact_failed` enough to recover without a `new_session`, or do we still need the current recovery path?

## 13. Appendix — APIs used (0.87.0)

- `pi.on("session_before_compact", (event, ctx) => CompactionPreparation | { cancel: true } | { compaction: { summary, firstKeptEntryId, tokensBefore, usage?, details? } })` — compaction override. See `docs/compaction.md` §"Custom Summarization via Extensions" and `examples/extensions/custom-compaction.ts`.
- `pi.on("session_compact_failed", (event, ctx) => void)` — telemetry pairing for aborts/failures. `event.reason ∈ {manual, threshold, overflow}`; `aborted`, `errorMessage`, `fromExtension`.
- `ctx.compact({ customInstructions?, onComplete?, onError? })` — trigger a compaction from an extension handler. See `examples/extensions/trigger-compact.ts`.
- `convertToLlm`, `serializeConversation` — exported from `@earendil-works/pi-coding-agent`; produce the exact text Pi hands the summarizer when no override is in play.
- `sessionManager.appendContextEdit(entryId, null | replacement)` — append-only hide/replace for raw entries, 0.87-only.
- `sessionManager.appendCompaction(summary, firstKeptEntryId | null, tokensBefore)` — `null` encodes retain-none.
- RPC `set_auto_compaction` (already used at `arc_thin_e2e.py:686`), `prompt` with body `/compact [instructions]`, `new_session`, `steer`, `follow_up`, `abort`.
- Settings: `compaction.enabled`, `compaction.reserveTokens`, `compaction.keepRecentTokens`, `compaction.modelOverrides` keyed by exact `provider/modelId`. Resolved values flow into `preparation.settings`.
