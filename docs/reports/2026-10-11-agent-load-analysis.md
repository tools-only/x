# Where the thin ARC agent's load comes from, and what can reduce it (2026-10-11)

Scope: the reference run that cleared a level (D3, `runs/thin-sh-d3-ls20-20261010`), round 3, the P048/P050/P051 real runs (`D:\autoresearch_pi_self_harness_evidence_20261010\real\`), and the first 12 actions of the running round-4 reasoning arm (`runs/thin-sh-r4-ls20-reason-20261011`). Scripts: [tmp/thin_load_profile.mjs](../../tmp/thin_load_profile.mjs), [tmp/thin_throughput.mjs](../../tmp/thin_throughput.mjs), [tmp/thin_decision_cost.mjs](../../tmp/thin_decision_cost.mjs). No model cost.

Reasoning stays on. The question is what the model has to reason about, and how much of that is work the harness could take off it.

## 1. Measured load

| Run | Levels | Reasoning tokens / action | Input tokens / action | Input spent re-reading within a decision | Heaviest fifth of decisions holds |
| --- | --- | --- | --- | --- | --- |
| D3 ls20 | 1 | 2,080 | 16,588 | 38% | 72% of reasoning |
| P048 | 0 | 9,649 | 27,240 | 57% | 46% |
| P050 | 0 | 6,617 | 16,369 | 32% | 46% |
| P051 | 0 | 9,752 | 22,284 | 53% | n/a (7 decisions) |
| Round 4 (running) | 0 so far | 3,588 | 16,863 | 48% | 57% |

What the reasoning is spent on. This is a lexical classification, one category per sentence, so treat it as approximate:

| Purpose | D3 | P048 | P050 | Round 4 |
| --- | --- | --- | --- | --- |
| Reading the grid, coordinate arithmetic | 40% | 36% | 31% | 31% |
| Rules, goals, choosing the action | 54% | 46% | 55% | 66% |
| Composing records (memory, strategy, prompt) | 2% | 12% | 7% | 0% |
| Composing predictions | 1% | 5% | 4% | 0% |
| Restating what it was given | 3% | 1% | 4% | 3% |
| *Overlapping:* re-checking / self-correction sentences | 12% | 10% | 14% | 10% |
| *Overlapping:* sentences repeating earlier ones in the same decision | 6% | 7% | 8% | 4% |

Reading the excerpts shows that the "rules" share also contains a lot of perception. For example, round-4 decision 9 spends about 100 lines turning its own diff output ("10 cells 3→12, 15 cells 3→9, 2 cells 11→3") into "a 5×5 block moved down 5 and the bottom bar advanced one column", then checks it again.

Working set per decision (mean chars):
- D3: memory 5,263, grid 4,002, recent actions 2,937.
- P048: memory 5,578, grid 3,487.
- Memory is the largest section in every run before round 4, larger than the grid itself. In P050, `hyp.a1_other` lists the same evidence (#1, #2) twice.

## 2. Sources of load

1. **Perception at the pixel level.**
   - The agent receives 4,096 cells as run-length text. Every tool it writes (all diff skills so far) also answers in pixels.
   - Objects, motion and layout are rebuilt in the reasoning at every decision that needs them. Misreadings follow: P048 #4 moved into a wall it had misread, and the re-check sentences come largely from this uncertainty.
   - This is the largest single source: 31–40% directly, plus much of the rules share.
2. **Re-deriving what was already known.** Each decision is a fresh model run. Conclusions survive only as memory text, and the agent often works them out again:
   - round-4 d9 recomputed the effect of all six earlier actions;
   - P048's review at d10 repeated d9's goal analysis (17k tokens).
3. **Re-reading the context inside a decision.** Every tool whose answer is needed before acting (`run_skill`, `skill get`, `ask_analyst`) costs another message that re-reads the whole context. That is 32–57% of input tokens.
4. **Tool friction.** Skill-authoring errors become get → set → run loops:
   - round-4 d9 needed 4 messages because a Counter with tuple keys could not be returned as JSON;
   - other errors: P064 history row shape, P052 grid index range, P070 a misremembered `history` attribute.
5. **Resident text.** Memory renders every evidence line of every hypothesis, duplicates included, and rejected ones too. The system prompt now carries three directive paragraphs on goal handling (§10.12–§10.15).
6. **Bookkeeping.** Up to 12% of reasoning (P048) goes on composing memory batches with conditions, verdicts and rivals, and it grows with the directive prompt text.
7. **Concentration.** The heaviest fifth of decisions holds 46–72% of the reasoning. They follow surprises: a prediction miss, a failed goal, a new mechanic. That load is legitimate, so the aim is to make it cheaper (better perception, no re-derivation), not to cap it.

## 3. Mechanisms, ranked by expected reduction

| # | Mechanism | Source addressed | Fits the principles? | Cost / risk |
| --- | --- | --- | --- | --- |
| A | ARC-specific, on-demand primitives for explicit coordinate data (bounding box, neighbor iteration, coordinate transform, connected components). The Agent still chooses inputs, cross-frame comparisons and interpretation in its own Skill. | 1 (and 4) | Do not add these to the generic harness. If implemented, keep them in the ARC adapter/observation layer; do not provide `find_shape`, object identity or movement conclusions. | Adapter API plus sandbox binding and tests; no automatic result in the working set |
| B | Saving a skill also runs it on the current state and returns the result; results are serialised tolerantly (tuple keys to strings, sets to lists). | 3, 4 | Yes: boundary repair, no analysis | Small |
| C | Compact memory view: show the last 2 evidence lines per hypothesis, collapse rejected or settled hypotheses to one line, remove duplicate evidence. | 5 (largest section) | Yes: rendering only; the stores are unchanged | Small; measurable offline on the logged memory |
| D | Test the existing carried-reasoning option (`--carry-reasoning`, C1): the end of the previous decision's reasoning is shown once. | 2 | Yes, already built | One paired run |
| E | Skills shown every decision (done 2026-10-11; first real use in round 4: the `skill_outputs` section, 848 chars per decision) | 1, 3 | Yes | Done |
| F | Remove or shorten the directive goal paragraphs added in §10.12–§10.15 and keep them as capability statements. | 5, 6 | Matches your earlier preference | Other session's change; confounds its ongoing tests |
| G | Multi-step commitment: `arc_action` takes a short sequence with a prediction per step; the runtime executes it and hands back on the first miss or level change. | wall time | Yes: general, no task content | Medium. Routine decisions are already cheap (D3 median ~1,000 tokens), so this saves time, not much reasoning |

Recommended order: B and C first (small, safe, measurable from logs), then a narrow A adapter design/diagnostic if the remaining pixel-level load justifies it, then D as a paired run. F must wait for the other session's prompt experiment to freeze. G is deferred because routine single-action decisions are already cheap and open-loop sequences risk losing feedback. B, C and A together target sources 1, 3, 4 and 5, which make up most of the measured load, while preserving Agent ownership of semantic interpretation.

## 4. How to tell whether it worked

Per run, against D3 and the same budget:
- reasoning tokens per action, overall and in the heaviest fifth of decisions;
- share of grid-arithmetic sentences;
- input re-read share;
- memory section size;
- the outcome: levels cleared and actions per level.

A lower load that does not change levels is an efficiency result only.
