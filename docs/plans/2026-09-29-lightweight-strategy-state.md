# Lightweight ARC strategy state

Status: implemented at the task runtime boundary; real-provider behavior not yet evaluated.

## Purpose

The parent Agent may explore mechanics while maintaining several competing game rules, goal conditions and solution strategies. A candidate is an agent or research judgment, never an environment fact. A locally successful action does not prove a goal condition. Planning may begin with provisional candidates and remains revisable.

## Data flow

1. The parent writes `candidate_updates` through `task_checkpoint(update)`. Auto-Research may include the same updates in `submit_research_report`; the parent runtime validates and saves them with the report reference. Both paths update `task-strategy-state.json` in the run directory. Each candidate has a stable `id`, `kind`, `claim`, `status`, optional prediction/falsifier/next test, and evidence refs. A non-provisional status requires evidence refs. Research never selects a candidate or changes an active plan.
2. The parent selects a candidate and may create a short ordered `plan_update` through `task_checkpoint(update)`. Plan changes keep a reason and evidence refs. Replacing or abandoning an active plan requires a reason; advancing its step requires evidence refs. These checks apply to bookkeeping, not ARC action admission.
3. An `arc_action.decision` can cite `plan_id` and zero-based `plan_step`. The runtime records the action reference and marks the step for semantic assessment. An action outside the active plan marks it for reconciliation. The runtime does not infer step success from pixel changes or block a parent action.
4. Later parent turns receive at most three candidate summaries plus current plan step and assessment flags. The full state is available only through `task_checkpoint(action='inspect', detail='strategy')`, or one candidate through `candidate_id`. Auto-Research receives the same short index in its bounded workset and can open exact research reports through existing resource grants. Report capsules show at most three candidate update summaries and link to the full report.

## Boundaries

This adds no Harness component, ARC adapter rule, fixed research stage, automatic hypothesis verdict or long prompt. Older checkpoint fields remain available. The candidate registry is run-local and starts empty; historical prose is not silently promoted into candidate status. A deterministic smoke can establish protocol reachability, but real-provider ARC runs are needed to assess whether the parent actually compares candidates and follows plans. Deferred research modes, online child action requests and cross-compaction semantic quality remain separate items in `docs/deferred-research-todos.md`.
