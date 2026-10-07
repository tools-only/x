# Development workflow

- Before designing, implementing, reviewing, or declaring completion of changes to meta-harness, Auto-Research, prompts/tools, assembly, scheduling, or context management, read `docs/development-workflow.md`. It is the authoritative development and evidence standard; historical plans remain evidence of their own date.
- For substantive changes, maintain one change record using `docs/templates/meta-harness-change.md`, or the same sections in an existing plan/report. Start with a real failure/opportunity, a narrow falsifiable claim, the burden removed, and a bounded evaluation. Small documentation fixes and behavior-preserving maintenance use proportionate checks.
- Report functional correctness, full-chain reachability, autonomous adoption, and net benefit separately. Name the provider/environment and link artifacts. Mark untested layers unverified; passing fixtures or deterministic smoke does not establish autonomous behavior or improvement.
- Reduce parent decision steps and resident obligations. Before adding a reminder, mandatory field, review, action gate, or worker, compare simplification/reuse and account for its runtime cost. Keep procedural guidance on demand; preserve permission, budget, version, and environment integrity checks.
- Track opportunity -> recognition -> investment -> candidate -> assembly -> semantic use -> feedback -> retain/revise/retire, including justified non-use and abandonment. Declare who advances each transition; automate mechanical work within existing authorization and keep semantic judgments with authorized Agents.
- Evaluate task progress with parent-plus-child cost, latency, management turns, and cognitive continuity. Predefine budgets, negative cases, and comparison criteria; do not optimize component counts or invocation frequency as task rewards.
- When real behavior misses the claim, locate the broken transition and change one main factor. Continue only to the evidence level supported by the authorized scope; record missing experiments and the next falsifiable check instead of calling an unverified optimization effective.
- These rules govern development Agents. Do not inject this workflow, its template, or repository AGENTS.md into the Pi task Agent's gameplay context. Runtime behavior changes require their own scoped implementation and acceptance.

# Project follow-ups

The user asked to preserve deferred discussion items and bring them up at a relevant future opportunity.

- When working on ARC adapter boundaries, Auto-Research/sub-agent interaction, observation/context compaction, or project roadmap reviews, consult `docs/deferred-research-todos.md`.
- Briefly mention relevant unfinished items and their connection to the current task. Avoid repeated reminders during unrelated work.
- The backlog records deferred work and candidate designs, not authorization to implement every item. Follow the scope of the current user request and recheck current code before relying on historical observations.

# ARC self-harness acceptance

- Do not claim that Auto-Research -> parsing/routing -> task-local self-harness is closed from pytest, an offline scripted parent, hand-written JSONL, or component-level fixtures. Those are diagnostic checks only.
- Closure acceptance must run `arc-harness-smoke` through the real ARC bridge, Pi parent loop, child broker/process, structured child return, code router, native harness mutation, ARC action boundary, and a later real parent turn.
- The acceptance matrix must cover `system_prompt`, `skills`, `memory`, `tools`, and `subagents`. It must assert semantic tool output, not only `status=completed`, and must exercise provider `length` continuation for both Auto-Research and ordinary `delegate_task`.
- A real-provider ARC run is still required when the claim concerns provider behavior or benchmark performance. The deterministic real-runner smoke proves wiring and lifecycle reachability, not game quality.

# Auto-Research architecture

- Auto-Research is a mechanism for organizing research, evidence updates, scheduling, delivery, and feedback. Multiple sub-agents may carry its concrete research and tracking responsibilities.
- Deliver immediate, core conclusions to the parent; keep ongoing analysis and tracking with the assigned research workers and durable research lines. A window is an evidence batch, not a mandatory new worker.
- Distinguish research-line continuity, worker responsibilities, and bounded session/run execution. Do not require a permanent model process to preserve a research topic.
- Consult `docs/plans/2026-10-01-auto-research-mechanism-and-workers.md` when changing this architecture. Durable assignments, bounded scheduling and incremental delivery are implemented; consult `docs/auto-research-workers-implementation-2026-10-01.md` for runtime acceptance and the still-unverified real-provider cost/quality claims.
