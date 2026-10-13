# Change record: harness activation (closing the five gaps with Prime Agent and Continual Harness)

Date: 2026-10-13. Status: implemented. Functional and scripted full-chain checks pass; real-provider behaviour is unverified.
Branch `claude/harness-activation-20261013`, based on `codex/native-compaction-fix-20261012` (afce4dca).
Analysis: [gap analysis](2026-10-13-prime-agent-continual-harness-gap-analysis.md) §3–§4 (in the main tree). The user
authorised an aggressive closure of the five gaps on 2026-10-13. That authorisation covers code-returned actions, which had
earlier been held back as "guarded step execution".

## Problem and claim

- Real failure: `foundation-native-ls20-real-20261012-02` (yibu/qwen3.8-27b, 37 actions, 0 levels):
  - 0 components saved;
  - 2.41 parent calls and 10.6k reasoning tokens per action;
  - 31.5k input tokens per call;
  - about 29% of reasoning sentences located coordinates.

  Both reference systems get heavy harness use from structure, not wording. For comparison, 62% of Continual Harness's actions
  came from saved skills.
- Claim, native mode:
  1. Saved code can act, so codifying removes decisions.
  2. Context is rebuilt from the harness (strategy note, memory index, components) plus a short history, so the harness is what
     carries understanding.
  3. Saving the code that just ran costs one argument.
  4. Distillation is done by an event-triggered refiner that writes, not by the acting agent's attention.
  5. The runtime's own analyses leave the resident context.
- Non-goals: no IPython kernel; no new store (everything is a workspace file through the binder); `arc_action` unchanged;
  reasoning stays on; nothing game-specific.

## Design (each item adapts an idea to the workspace foundation)

1. **Saved code acts.**
   - A saved tool, or `python(code, save=)`, may return `{"actions": [...]}`.
   - `playActions` sends the actions one by one through the same `submitAction` path as `arc_action`, so the bridge, budget
     and refusals stay the only way to act. Each step may carry a prediction.
   - It stops at the first missed prediction, level change, GAME_OVER/WIN/FINISHED, unavailable action or environment failure.
   - At most 24 actions per result; the decision ends once any action was played.
   - Trajectory rows record `via`. Unsaved python and read-only consult calls never act.
2. **Context = harness + now.** Each native decision shows:
   - `notes/strategy.md` (up to 1,500 characters);
   - a one-line-per-entry memory index (live hypotheses first, with check results; full text in `data/memory.md`);
   - recent actions not already in view;
   - a one-time harness-update notice;
   - resources;
   - the current state;
   - CAPABILITIES with observer outputs.

   History now keeps the 2 newest decisions complete and 4 condensed, within 12,000 characters (Continual Harness's history
   budget), with a note saying where older records live. Configured with `ARC_THIN_NATIVE_VERBATIM`,
   `ARC_THIN_NATIVE_CONDENSED` and `ARC_THIN_NATIVE_HISTORY_CHARS`; the values are recorded in `run-config.json`.
3. **Saving costs one argument.** `python(code, save="name")` stores the code as written in `tools/name.py`, a *script tool*:
   - it needs no signature; its inputs are the dict `args` and its final expression is the result;
   - it is validated by the binder and callable later as the tool `name(args={...})`;
   - hand-written typed `def run(...)` tools work as before.
4. **The refiner replaces the critic and the reuse-gap review.**
   - It is a role file, `roles/refiner.md`, seeded once. The agent can edit or delete it, and its body is added to the
     refiner's instructions.
   - Triggers: the critic's failure triggers, a level change, repeated python work (3 recurrences, or code retyped although a
     saved component covers it), and every `ARC_REFINE_EVERY` (15) actions.
   - Each call is one non-blocking side call that makes one edit: a note or a tools/observers/lib file. The edit goes through
     the binder (versioned, validated, rollback by version).
   - It is logged in `refiner.jsonl` with its trigger and evidence. The agent sees one line saying what changed.
5. **Subtraction.**
   - Out of the native resident context: EXPLORATION, PREDICTION CHALLENGE, ledger GOAL CHECKS/IDEAS, critic notes,
     REPEATED WORK, REUSE GAP and the coordinate-share line. The ledger is written to `data/ledger.md`.
   - The `ls` and `grep` schemas leave the native tool surface (python lists and searches files).
   - The ideas/critic board leaves the native prompt.
   - The native prompt was rewritten around these points; it keeps the reuse and amortisation principles.
- **Measurement.** `reuse_report.json` gains an `offload` section: actions from saved code and their share, replaying versus
  creating calls, refiner edits and how many loaded.

## Verification

- Unit tests: `tests/arc_thin_activation.test.ts` (new) covers:
  - `python(save=)` acts while unsaved code does not;
  - script-tool schema and args;
  - read-only calls never act;
  - refiner reply parsing;
  - the memory index;
  - the history budget.

  Existing native tests were updated for the new note text and the prompt.
- Foundation smokes (real runner, Pi 0.87.0, mock SDK, scripted provider), all passing. The new `activation` smoke covers:
  - the probe tool plays 2 actions twice; unsaved code plays none; a missed step prediction stops after 1;
  - the context holds no runtime analyses and offers no ls/grep;
  - `data/memory.md` and `data/ledger.md` exist;
  - with the critic on, the refiner fires on retyped saved code, a missed level prediction and repeated python, writes
    `notes/strategy.md` and `tools/cell_reader.py`, and the agent sees the update and the strategy;
  - the report counts 5 actions from saved code.

  Other foundation smokes (`foundation`, `budget`, `components`, `banded`, `receipts`, `migration`, `history`,
  `nativeclaims`, `reuse`) pass with assertions updated for the new defaults. Legacy smokes and the full node and pytest
  results are in the commit message.
- The scripted last parent request at decision 9 carried about 3.4k message characters plus a 5.2k tool schema, against about
  42.9k message characters per request in the real baseline at decision 24. That is a scripted run, not a comparison.

| Evidence layer | Status | Provider / environment | Limits |
| --- | --- | --- | --- |
| Functional | passed | node tests | listed above |
| Full chain | passed (scripted) | offline-arc-thin-smoke, Pi 0.87.0, mock ARC SDK | wiring only |
| Autonomous adoption | unverified | — | real run needed |
| Net benefit | unverified | — | real run needed |

## Risks and the next falsifiable check

- **Continuity (backlog D).** With the context rebuilt, what the agent does not save is gone. The refiner's strategy note is the
  mitigation. Check for re-derived facts and repeated experiments after history drops.
- **Code-driven play can spend actions fast.** It is bounded by the 24-step limit, the stop conditions and the bridge budget.
  Check for batches that stop at step 1 repeatedly.
- **Refiner quality depends on the model.** Every edit is logged and versioned. Check how many refiner edits the agent later
  uses or deletes.
- **Next check:** one real ls20 run (60 actions or 2 h, after your approval) compared with the baseline on:
  - the offload share (actions from saved code);
  - reasoning per action, parent calls per action, input per call;
  - levels and actions per hour;
  - refiner edits loaded and later used.
