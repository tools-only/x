# Context layout: a run-long system prompt, standing documents first, the agent's own record last (2026-10-21)

Date: 2026-10-21 (Asia/Shanghai). Status: implementation; functional checks only, no run. Record format:
`docs/templates/meta-harness-change.md`.

## Problem and claim

### Request

The user proposed partitioning the context into a cache region (long-lived, stable content, for the provider's KV cache)
and a volatile region whose order is managed, so that corrective signals are not drowned by tool messages. The
assessment the user accepted ("agree, implement"):
- With prefix caching, regions are an ordering constraint: anything that changes in front of stable content invalidates
  everything after it. Today the most mutable text, the prompt files that refinements and reviews rewrite, is in the
  system prompt, in front of everything.
- Inside the volatile region, order matters less than the kind of text. Standing documents (strategy, rules, review,
  lessons) belong at the start of the decision; the slot right before the response belongs to a short fact about the
  agent's own act, in the genre of a result; prose corrections (refinement notices) stay where they are.

### Failures on record (su15-chm-q38-1, qwen3.8-27b, thinking off, r04 `305ca1b0`)

**Cache.** Pi's `openai-completions` route (yibu) collapses every system-message section patch into the leading system
message (`supportsMidConvoSystemMessages` defaults to false; the run's `models.json` does not override it), so a patched
prompt section rewrites byte 0 of the request.
- Seven patches changed prompt sections only. They came before decisions 10, 11, 18, 41, 52, 60 and 77 (`session.jsonl`
  system messages; `harness/refiner.jsonl` `told` rows). The first request of each of those decisions read 0 cached
  tokens. With the second requests of decisions 18 and 60, which missed too, that is 9 requests and 603,590 uncached
  input tokens, 19% of the run's 3.13M budget tokens.
- The request before each patch hit the cache: decision 40's last request read 73,984 cached tokens, 51's 76,544,
  76's 107,264.
- Four more patches (before decisions 14, 15, 21 and 54) came with a change of the tool set (a review turn or a
  consolidation). Those miss regardless of where the prompts are.

**Order.** In the first request of a decision, the response follows the end of the head. In that run the head ended
with the capability index and the board image. The refinement notices and the review sat earlier, and six refinement
edits left the agent's output unchanged byte for byte (679, 921 and 910 output tokens per copied decision). Work memory
(`9a5e0536`, after that run) adds the agent's own record: NO NEW INFORMATION opens the head, and THIS BOARD follows the
state, both still before the capability index and the images.

### Claims

1. **Cache.** With the prompt files in the head instead of the system prompt, an edit to a prompt file leaves the system
   prompt unchanged. The next ordinary decision's first request then reads the shared prefix from the cache, as any
   other decision's does.
2. **Order.** The agent's own record on this board (NO NEW INFORMATION, THIS BOARD) is the last part of the decision
   message, after the observation and its images, so the response starts from it. Prediction: fewer consecutive
   decisions that only replay known results than with the record at the top of the head.

**Burden removed:**
- re-reading the whole context after each edit of a prompt file (cost, latency);
- finding the record of one's own replays between standing text and the observation (attention).

**Falsifiers:**
1. In a run with this layout, a decision that follows an edit of prompt sections only has a first request with
   `cache_read` 0, although the tool set is the same, the request comes within 60 s of the previous one, and the
   previous decision's first request hit.
2. In matched forks (this layout against `ARC_THIN_CONTEXT_LAYOUT=0`) from a snapshot that reaches a spin, the longest
   spin streak and the longest run of identical decisions are not shorter with this layout.
3. Pinned experiments are played less often (played / pinned) than with the prompts in the system prompt. Standing
   documents in a user message would then carry less weight than in the system prompt.

**Reasonable non-use:**
- a decision on a board not seen before, with no spin, has no record to put last;
- review turns show no record (as before).

**Scope:**
- In scope: the native foundation's treatment variant, namely the extension's system-prompt sections, the head's
  assembly, one runner config field, tests.
- Not in scope:
  - the tool-set change at review turns (another source of cache misses);
  - the gateway's cache lifetime;
  - refusals (`claude/action-admission-20261021`, not merged);
  - the refinement notices' text and place;
  - the legacy foundation and the control variant.

## Design and cost

### Layout

| Part of the request | Before | Now (default) |
| --- | --- | --- |
| System prompt | the native template, then every active prompt as a `prompt_<name>` section | the native template only, fixed for the run |
| Earlier decisions | transcript (`freezeHistory`) | unchanged |
| Head, start | the runner's prompt; call points; NO NEW INFORMATION | the runner's prompt; call points; the active prompts as `<prompt_<name>>` blocks (the text the sections held) |
| Head, middle | memory, rule checks, python session, history/recent, refinement notices, resources, the observation, THIS BOARD, the capability index and views | the same, without THIS BOARD |
| Head, end | the images | the images, then the agent's own record (NO NEW INFORMATION, THIS BOARD) as the last text part, when there is one |

`ARC_THIN_CONTEXT_LAYOUT=0` restores the earlier placement in full. Separating the two parts would need a second
switch. It is not built: the first comparison is old layout against new.

### Reuse and responsibilities

- **Reuse:**
  - `promptSections()`, so the prompt blocks are byte for byte the text the system sections held;
  - the head's `headKey`, so the head is built once per decision and prompts still apply from the next decision, as
    the write receipt says;
  - work memory's `spinText` and `boardText`, text unchanged.
- **Who does what:** the runtime places text, mechanically. No agent decision, call, field, gate or worker is added.

### Cost and integrity

- **Added and removed:**
  - no new resident text;
  - the prompt bodies move from the system prompt into the head (same size);
  - the agent's record moves to the end of the head.
- **Config:**
  - `ARC_THIN_CONTEXT_LAYOUT=0` restores the earlier placement;
  - `run-config.json` records `context_layout` (`head` or `system`).
- **Expected saving:** at most the uncached share of first requests after a prompt edit. In su15-chm-q38-1 that was
  0.60M; the head itself stays uncached (about 9-16k tokens per first request on the decisions that hit).
- **Integrity:** budgets, refusals, gates and call points are unchanged.
- **Responses route:** the instructions are unchanged, and continuation deltas are unaffected (the head already changes
  per decision).
- **Forks:** the first decision of a fork from an older run patches the inherited prompt sections to null, which is one
  miss.

## Experiment protocol (needs the user's budget; not run)

| Item | Setting |
| --- | --- |
| Layers | (1) cost, full chain: any real r04 run with this layout, judged per request; (2) adoption and benefit: matched forks |
| (1) Run | one qwen3.8-27b su15 run, thinking off, images, `ARC_THIN_OBSERVATION=ch`, work memory on, 6M budget-token cap; compared with su15-chm-q38-1 |
| (1) Primary | `cache_read` of the first request after each edit of prompt sections only, against the previous decision's first request (falsifier 1) |
| (2) Forks | 2 per arm from a level-1 snapshot that reaches a spin, `ARC_THIN_CONTEXT_LAYOUT=0` against the default; 1.5M budget tokens per fork, 6M in total |
| (2) Primary | longest spin streak; longest run of identical decisions (falsifier 2) |
| (2) Secondary | pinned experiments played / pinned (falsifier 3); budget tokens per action; levels |
| Negative cases | a first request more than 60 s after the previous one (gateway lifetime); a tool-set change (review turns); a fork's first decision (inherited sections removed) |
| Measures | `harness/usage.jsonl` (cache_read per request), `session.jsonl` system messages (section patches, tool changes), `harness/refiner.jsonl` and `.harness/components.jsonl` (prompt versions), `harness/working_set.jsonl` (sections: `prompts`, `spin`, `board`) |

## Implementation and checks

### What changed

On by default in native treatment runs, as the user asked; `ARC_THIN_CONTEXT_LAYOUT=0` turns it off.

| File | Change |
| --- | --- |
| `demo/arc_thin_extension.ts` | `contextLayout` (native, not control, unless `ARC_THIN_CONTEXT_LAYOUT=0`) |
| | `before_agent_start`: no `prompt_*` sections in the system prompt |
| | `context_with_system`: wants none, so sections a resumed or forked session carries are patched to null once |
| | `buildWorkingSet`: a `prompts` section first (after the call points), with the blocks `promptSections()` renders; NO NEW INFORMATION and THIS BOARD go into `tail` instead of the head's top and the state's end; `working_set.jsonl` logs `spin`, `board` and the `tail` |
| | the head: `[text, ...images, tail]` |
| `demo/arc_thin_binder.ts` | comment only (where a prompt is shown; it still applies from the next decision) |
| `src/autoresearch_pi/arc_thin_e2e.py` | `run-config.json` `context_layout` |
| `docs/plans/2026-10-20-work-memory.md` | a pointer to the new placement |

### Checks

Local Windows, no provider, stand-in HTTP bridges; Node 25.5.0 with `--experimental-transform-types`, Python
`D:/conda/python.exe` with `PYTHONPATH=src`.

- `tests/arc_thin_work_memory_loop.test.ts`, 3/3:
  - after a spin, NO NEW INFORMATION then THIS BOARD are the head's last text part, and appear nowhere before it;
  - with `ARC_THIN_CONTEXT_LAYOUT=0`, NO NEW INFORMATION opens the head and the head has one text part, as before;
  - with work memory off, unchanged.
- `tests/arc_thin_ch_observation.test.ts`, 8/8. The changed test: after a stall review writes `prompts/review.md`, the
  next head
  - opens with `<prompt_review>`;
  - keeps it out of the observation blocks;
  - leaves the system prompt string identical to the one before the write;
  - adds no system-prompt section;
  - ends with THIS BOARD, after the image.

  A new test: with `ARC_THIN_CONTEXT_LAYOUT=0`, the prompt is a system-prompt section and is not in the head.
- `tests/arc_thin_level_review.test.ts`, 5/5: `prompts/lessons.md` opens the next heads and is not a system-prompt
  section.
- Full `tests/arc_thin_*.test.ts`, one parallel run: 249 of 257 passed. The 8 failures:
  - five that the work-memory record lists as failing at its base: activation 1, components 1, receipts 3. Activation
    and components exercise the python runtime, where another session has uncommitted edits;
  - `arc_thin_action_surface`: the installed Pi's start timed out at 20 s, recorded there as intermittent;
  - `arc_thin_refine_ledger` (a 10 s wait for the second refinement) and `arc_thin_compaction` (the probe's 120 s
    limit) timed out under the parallel load. Run alone they pass: 21/21, and 1/1 in 23 s.
- pytest on the runner, review, recovery, accounting, loop-bound and work-memory files: 38/38.
- Not run:
  - `arc-harness-smoke`, and any run through Pi and a provider (no smokes for minor changes, per the user's
    directive, and no budget);
  - the provider-facing order (text, images, then text) is read from Pi 0.87's `openai-completions` conversion, which
    maps user content parts in order. It is not observed on the wire.

### Evidence layers

| Evidence layer | Status | Provider / environment | Artifacts and limits |
| --- | --- | --- | --- |
| Functional | passed (the failures above aside) | local, no provider | the tests above |
| Full-chain reachability | unverified | — | needs a real run: the system prompt's bytes across a prompt edit, and the order of the request's content |
| Autonomous adoption | claim 1: not applicable (mechanical); claim 2: unverified | — | whether responses after a spin engage with the record more often than with it at the top |
| Net benefit | unverified | — | `cache_read` after prompt edits (claim 1); spin streaks in matched forks (claim 2) |

## Decision

- **Supported:** the layout is built and on by default. Prompt files no longer touch the system prompt. The agent's
  own record is the head's last part. The earlier layout is one switch away.
- **Not supported yet:**
  - the cache saving (needs a real run);
  - any change in behaviour (needs matched forks).
- **Next falsifiable checks:**
  - Claim 1 costs nothing extra: judge it on the next authorized r04 run of any kind, by the `cache_read` of the
    first request after each edit of prompt sections only.
  - Claim 2 needs the fork pair in the protocol, with the user's budget.
- **Backlog:** deferred item D (context and observation token cost); a dated note was added there, and no item changes
  status.
