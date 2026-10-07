# Auto-Research topics and short-lived child sessions

Status: runtime integration implemented; real-provider ARC behavior not yet evaluated.

## Identity and control

Auto-Research is a parent-invoked research mechanism. `research_line_ref` is the durable topic identity, while `research_session` and the native child process are bounded execution instances. A completed topic may be investigated again by starting a new session with the same line ref. `resume` continues only a pending or failed session; it does not define the topic lifetime. The parent may keep multiple topics and launch multiple non-blocking sessions. Existing research plans still provide optional node dependencies and concurrency limits within a plan.

An unscoped `auto_research(start)` creates a new topic unless an exact prior report/run reference identifies an existing line. Passing `research_line_ref` explicitly continues or creates that topic. A periodic handoff is selected with its exact `research_handoff_ref`; an open call does not silently consume one. This removes the old implicit global open agenda. Existing agenda records and research-line references remain valid.

## Progressive context

`auto_research(topics)` returns a paged, compact topic index. `auto_research(topic, research_line_ref=...)` returns one topic's agenda and a bounded session index. A new open child receives the selected topic's full agenda, at most three summaries of other topics, and the existing paged history catalog. Exact agenda/report resources remain available through the existing read-only resource path. Each parent turn receives at most one asynchronous completion or resume notice; remaining completed sessions are delivered on later turns.

Child reports may update the topic agenda and task strategy candidates. The child cannot act in ARC, select the parent's strategy, or create Harness components. Parent decisions and runtime storage remain separate. The runtime does not assert game truth from a completed report or a topic status.

## Limits

Multiple topics and non-blocking sessions are protocol capabilities, not proof that a real provider will choose useful topics or successfully manage concurrency. A real ARC run is required to evaluate that behavior. Deferred questions about child-requested environment experiments and cross-compaction semantic quality remain in `docs/deferred-research-todos.md`.
