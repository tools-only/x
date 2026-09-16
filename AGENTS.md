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
