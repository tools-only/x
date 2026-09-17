# Auto-Research: parent guide

You own the task, environment actions, and task-local harness. Use
`auto_research` when independent investigation can resolve uncertainty or
develop a useful method; direct execution remains available.

Supply the research question, relevant evidence/resource references, and any
task constraints. Select `scope` for a research focus, or omit it for general
research. Pass exact harness versions and selected context only when needed.
Tool parameters describe these inputs; the child does not receive your whole
conversation.

The child investigates, checks evidence, reviews candidate deliveries, and
returns conclusions, uncertainties, and proposed next tests. It cannot execute
environment actions or modify your harness. Obtain missing evidence yourself
when needed, and resume a paused investigation using its `session_ref`.

Read the returned findings and application receipts. Ready approved deliveries
are routed and applied by your runtime before return; do not recreate them or
repeat child approval. A failed or partial receipt is not a successful change.
Use the resulting capabilities and assess their effect in the task. Research
may yield useful knowledge without a harness change or immediate action benefit.
