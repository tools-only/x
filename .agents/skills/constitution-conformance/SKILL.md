---
name: constitution-conformance
description: Mandatory gate whenever you design, implement, review, or declare completion of any change to the self-evolving Agent (SelfRoot, Pi extensions, evo runners, prompts, schemas, runtime, daemon, conditions, task supply). Checks the design and the final implementation article by article against docs/SELF_EVOLVING_AGENT_CONSTITUTION.md and blocks real runs until it passes.
---

# Constitution conformance gate

The design constitution is `docs/SELF_EVOLVING_AGENT_CONSTITUTION.md`. It outranks plans, prompts, and earlier designs. Run this gate twice for every change: once on the design (before any code), and once on the final implementation (before declaring done, tagging, or starting a real-provider run). A design that passed does not exempt the implementation; check the code that actually runs.

## Procedure

1. Read the whole constitution and record its version line. Do not work from memory or summaries.
2. Build a conformance table with one row per article (序言 principles, arts. 1-11 including sub-articles such as 5-1 and 6.1-6.3) and one row per chapter-5 degradation form. Columns: article, what the change touches, evidence (design section, or `file:line` and test name for the implementation), verdict `conforms / violates / not applicable (reason)`.
3. Always check these explicitly, with evidence:
   - Same Agent is subject and object; no reviewer agent/subagent; modes are not separate roles; humans do not score.
   - The host does not diagnose, choose focus, force mutations, or decide adopt/restore for the Agent (arts. 5, 9).
   - Art. 5-1: list every field, value, rule, or obligation the Agent must produce or obey after the change (tool params, required schema fields, enums, exit rules, window fields, evidence refs, task switching, budget/recovery). For each, say why the host cannot produce it from run facts. Anything the host can produce must move to the host. Report added and removed Agent input obligations.
   - The provider-visible schema/prompt and the runtime checks come from one definition and cannot drift. At least one test builds calls only from the provider-visible schema, with no hidden arguments, and the runtime accepts them.
   - Incomplete or invalid Agent expression is completed visibly or closed mechanically; no unbounded rejection loop.
   - Evolution review treats artifacts as read-only evidence, assumes shortfalls remain, has no satisfaction-style keep, and adoption needs real change, later real use, a time-separated validation window, and objective metrics.
   - Model-specific schema adaptation stays in the adapter layer, not core.
   - Run burden of new mechanisms (context, calls, latency, false triggers, Agent-side obligations) per chapter 6.
4. Any `violates` row blocks the step: fix the design or code and rerun the gate. Do not downgrade a violation to a risk or a follow-up.
5. Put the table in the design document and in the implementation report under a heading `Constitution conformance`, stating the constitution version checked. Scripted tests prove wiring only; mark behavior that needs a real provider as unverified rather than conforming.

## Done means

Design gate passed and recorded; implementation gate passed and recorded against the actual diff; no `violates` rows; Agent input obligations listed. Only then tag the change or start a paid real-provider run.
