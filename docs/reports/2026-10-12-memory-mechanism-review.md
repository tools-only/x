# Memory in the thin ARC harness: cost, comparison with other agents, and proposals (2026-10-12)

**Data.** Ten real runs: tu93 round 5, plus overnight b1, b2, b3, i13, i16, i21, i24, i28 and i39. Script `tmp/memory_cost.mjs`; output `tmp/memory-cost.txt`.

## 1. How memory works today

**No transcript between decisions.** Every decision is a fresh Pi run. Earlier conversation and reasoning are dropped; only what the agent wrote with `memory` and the runtime's own records (actions, scored predictions, skill outputs) reach the next decision.

**One `memory` tool, structured, atomic and validated.** It holds four kinds of entry:

| Entry | Fields |
| --- | --- |
| Facts | key, text, confidence, `replaces` |
| Hypotheses | `question`, `claim`, `predicts`, `status`, `next_test`, `evidence{action, condition, observed, verdict}` |
| Tests | a verdict per hypothesis |
| Strategies | `plan`, `depends_on`, `uses`, `status`, `steps` |

An invalid batch is refused as a whole. The runtime derives further views from these entries: rivals per question, contested, dropped, revisions, and steps progress.

**Reviews forced by the runner.** At every level change, at GAME_OVER and every 25 actions, the runner starts a CONSOLIDATE turn with no action allowed, to update the records.

**Read cost.** Memory takes 3–7k characters of every decision's input.

## 2. What memory governance costs

| Run | Memory calls per action | Arguments (tokens) | Refused calls | Review output (% of agent output) | Reasoning about records* |
| --- | --- | --- | --- | --- | --- |
| tu93 r5 | 1.4 | 9.6k | 2 | 10.5% | 14.7% |
| b1 ls20 | 1.1 | 4.1k | 1 | 0% (no review) | 7.7% |
| b2 lp85 | 1.8 | 3.9k | 3 | 19.2% | 9.1% |
| b3 vc33 | 1.9 | 5.3k | 4 | 9.5% | 12.1% |
| i13 lp85 | 1.3 | 6.1k | 4 | 14.2% | 14.3% |
| i16 ls20 | 1.1 | 4.6k | 2 | 15.6% | 12.6% |
| i21 lp85 | 2.0 | 4.4k | 1 | 31.3% | 15.4% |
| i24 ls20 | 0.8 | 3.9k | 1 | 34.0% | 13.3% |
| i28 lp85 | 1.4 | 3.8k | 1 | 17.4% | 9.2% |
| i39 lp85 | 1.3 | 4.6k | 2 | 18.0% | 15.9% |

\* A broad lexical match: sentences that mention hypotheses, evidence, verdicts, keys, strategy or memory. It also counts real scientific thinking, so treat it as an upper bound for bookkeeping.

**Where the cost is:**

1. **Review turns are the largest item.** They take 10–34% of the agent's output, about 6–20 minutes of a 60-minute run, often right after level 1. Part of that is planning for the new level, but the turn exists for the records.
2. **Reasoning about what and how to record.** Up to 8–16% of reasoning (upper bound).
3. **Refused writes.** 1–4 per run. Each forces another message that re-reads the context and reasons again. The causes are all schema friction:
   - `steps` written as prose ("must be action names");
   - "a new hypothesis needs claim";
   - `depends_on` naming a key that doesn't exist;
   - the old cap of 8 hypotheses;
   - a call truncated by the output limit.
4. **Writing the arguments.** About 4–10k tokens per run; small, though memory calls are 57–75% of all tool-argument text.

Taken together, memory governance is roughly 20–45% of the agent's output, or 10–25 minutes of an hour. The direct write cost is small. The cost is the structure, the validation and the forced reviews.

## 3. How other agents handle memory (from published behaviour)

| Product | Working memory (within a task) | Long-term memory | Who writes it, when | Structure and validation |
| --- | --- | --- | --- | --- |
| Claude Code | The conversation itself; auto-compaction summarises it when the window fills; TodoWrite checklist | CLAUDE.md files (user/project/local); auto-memory: one Markdown file per fact plus a MEMORY.md index | The model, with ordinary file Write/Edit, rarely (durable facts, user preferences) | Free text with light frontmatter; no schema gate |
| Codex CLI | The conversation plus compaction; `update_plan` checklist (step, status) | AGENTS.md hierarchy; newer releases add generated memories from past sessions (feature details not re-checked here) | Instructions by people; any generated memory outside the task loop | Free text |
| ChatGPT | The chat | Saved memories (a free-text bio tool), plus automatic reference to past chats | The model by tool call; history reference is automatic | Free text |
| Letta / MemGPT | Core memory blocks always in context, edited with append/replace string operations | Archival store (vector search) and recall of past messages | The agent self-edits; "sleep-time" agents consolidate memory in the background, off the main agent's path | String blocks with size limits |
| Mem0 / Zep | The application's context | An extracted fact store | A pipeline, after each exchange, decides ADD/UPDATE/DELETE/NOOP; the main agent spends nothing | Facts, deduplicated automatically |
| Cursor / Windsurf | The chat plus rules | Memories generated from chats; the user can approve or edit them | Background generation | Free text |

**What these share, and how we differ:**

1. **Working memory is the transcript, with compaction when needed, not a store the agent has to curate.** We drop the transcript at every decision, so all continuity has to be written by the agent on the critical path. This is the root of our cost.
2. **Long-term memory is free text with simple edit operations.** It is written rarely, and a write is never refused for its shape. Ours is a typed scientific ledger with atomic validation.
3. **Plans are flat checklists** (TodoWrite, `update_plan`). Ours are strategies with premises, components and steps.
4. **Consolidation happens off the critical path** (compaction, Letta's sleep-time agents, Mem0 extraction) or not at all. Ours is a turn the runner forces on the main agent at the moment a level changes.
5. **Evidence bookkeeping is not delegated to the model.** Where those systems track anything automatically, the system does it. Our runtime already scores every prediction, but the agent still copies observations into `evidence`/`tests` by hand.

The comparison has a limit. Those products serve long coding sessions where a transcript is cheap to keep. An ARC decision carries a 64×64 grid and an image, which is why the thin harness rebuilds context instead of keeping it. But the rebuild does not require that every piece of working state go through a validated ledger.

## 4. Proposals, in order of expected saving per unit of change

None of these adds a field to `arc_action`. Each removes an obligation; none adds one.

**M1. No forced reviews; the agent reviews when it chooses.**
- The runner stops sending CONSOLIDATE at level change and every 25 actions.
- The working set states one fact: "N actions since your last review (#a–#b)".
- The agent can start a review with an action-free turn, or update memory alongside any action, as it already does.
- **Saves:** the 10–34% of output measured above, at the moment of level change.
- **Risk:** records drift without a prompt. Mitigated by M2 and M4. Measure records written per action and drift before and after.

**M2. A working-notes block instead of working state in the ledger** (Letta core block / TodoWrite style).
- One free-text block the agent replaces or edits, up to about 1.5k characters, always shown and never validated.
- It holds what this run is doing now: the current position of thinking, what to try next, what is pending.
- **Saves:** per-step facts, prose that would fail the `steps` schema, and much of the "what should I record" reasoning.
- The ledger keeps durable conclusions only.

**M3. Make the ledger forgiving and optional.**
- Accept partial entries: a hypothesis with only a key and text, a `depends_on` naming a missing key (kept as a dangling reference, shown as such), a prose step (kept as text and not tracked).
- Report what was not understood instead of refusing the batch.
- Keep refusal only for real integrity: a cited action that does not exist, which is the one hard check today worth keeping.
- **Saves:** 1–4 retry messages per run.

**M4. Let the runtime record evidence it already has.**
- Each scored prediction is already an observed test.
- Show it under the hypothesis the agent associates it with: the agent writes the hypothesis key in `predict.text` or `note`, and the runtime matches the key mechanically.
- The agent then no longer copies "#12 observed X, verdict refutes" into `evidence`/`tests`; it only states verdicts when it wants to.
- **Saves:** most of the `tests`/`evidence` arguments and the reasoning that composes them.

**M5 (later, only if M1–M4 leave records thin). Consolidation in the background** (Letta sleep-time / Mem0 pattern).
- A side model call runs between decisions, while the agent plays. It reads the trajectory and scores and proposes ledger updates, which are shown as proposals the agent can accept with one call.
- This adds model cost and a worker. By the development workflow, simplification (M1–M4) comes first.

**M6. Cheaper reading.**
- Render memory in two parts: the notebook and active plan in full, the rest as keys with one-line summaries, retrievable through `memory(op="list", key=…)`.
- This is how CLAUDE.md works with its imported files and how MEMORY.md works with its fact files. Today's 3–7k characters per decision would drop to about 2k.

## 5. Evaluation (to be registered before a run)

- **Primary measures:** actions per hour and levels within the same 1 h budget, against i24 (ls20) and i28/i39 (lp85).
- **Memory-cost measures:** memory-call output tokens, refused calls, review output share, and the reasoning share about records (`tmp/memory_cost.mjs`).
- **Negative check:** does continuity suffer? Look for repeated failed tests of a hypothesis already refuted, and for knowledge lost after a level change, read from the hypotheses and actions.
- **Order:** M1 and M3 first (simplifications); then M2 and M4; M5 only if needed.
