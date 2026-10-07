# Memory reference

Operation-specific instructions retained from the pre-optimization prompts.
These apply under their stated conditions; on-demand delivery does not make
required steps optional. Runtime receipts supply current references and state.

Memory can accumulate throughout exploration in lightweight batches. When several
useful local observations, competing hypotheses, attempted strategies or stage
retrospectives have emerged, call `task_memory_pool(action="capture", items=[...])`
with parent-authored content, a scope (`state`, `level`, `episode` or `task`), and
exact evidence refs when available. This is optional and may happen at any point;
missing evidence is labelled unverified, and cited evidence does not certify a
claim. Use `task_memory_pool(action="list")` to retrieve bounded candidates,
`task_resource(action="read", ref=...)` for full text, and explicitly assemble
eligible exact versions before they can enter later context. Pool capture does not
mean exposure, selection or use. Keep the original trace in its evidence resource.

Memory has two parent-facing paths. For routine in-progress capture, use `task_memory_pool(action='capture', items=[...])` to retain batches of local observations, partial hypotheses, plans or occasional retrospectives as free-form pool candidates. The pool writer handles versioning and scope binding; capture does not require conversion intent, a formal review, or prompt exposure. List and read exact entries when useful, then assemble only the eligible versions that matter for a later task turn. For deliberate reusable Harness components or revisions, use the higher-structure `task_harness(action='change', changes=[...], decision={reason,expected,basis_refs})` path. That formal change path routes candidates to persistent component kinds such as memory, system_prompt, skill, adapter-bounded tool or read-only subagent and validates them before application. `task_prompt` is not a persistent component; it is the current assembly's source-agnostic output channel. The native component writers, validation, resource index and ordinary delegation are runtime support operations, not first-line authoring choices. `task_checkpoint` is directly available for parent-authored goal and strategy state; open other support operations through `task_harness(action='activate')` when a concrete decision needs their exact output. Pi's native context keeps the active transcript; hypotheses remain separate from environment facts.

The structured one-atom rule applies to formal fact/plan Memory candidates authored through `task_harness(action='change')`: each needs a stable `key` (or `name`), `validity.scope=task|episode|level|state`, and exactly one `atom={subject,predicate,value}`. Keep the key when revising that same formal candidate. The atom is the smallest unit whose evidence, scope, invalidation or selection may change independently; split independently changing facts across formal changes rather than combining them into one reusable component. Routine `task_memory_pool` entries are different: they may preserve partial, local or multi-part notes and stage retrospectives verbatim, with scope, claim kind and evidence refs where available. They are candidates, not canonical facts, and are not automatically selected or exposed. Current position, frame and action budget come from runtime state and do not belong in Harness memory. Skills describe how to derive or use facts and may depend on exact memory refs. A scoped Skill may contain
required task parameters and worked examples—including for one situation—when
they make the procedure executable. It must remain a method rather than a recap
whose action log or incidental values are presented as universal rules.

For deliberate component authoring or revision, submit one `task_harness(action=change)` call. This remains the higher-structure path for reusable resources; routine Memory capture does not require conversion intent, a review, or an atom. For a review,
put a complete structured candidate directly in its create/update entry; runtime
uses the same change implementation in that call and returns application_receipt.
Formal Memory candidates sent through `task_harness(action=change)` contain a
stable `key` (or `name`), `validity.scope=task|episode|level|state`, and exactly
one `atom={subject,predicate,value}`; retain the key for revisions. The lighter
`task_memory_pool` capture path accepts free-form content and binds the selected
scope to the current public task state. Use an existing key plus its exact current
`target_version` to revise it; otherwise the runtime assigns a version-addressing
key without merging presumed duplicates. Retire a conclusion or capture an explicit
replacement when new evidence changes it. `claim_kind` records the parent's label,
not verified truth. Evidence refs improve traceability but do not prove meaning or
causality; absent refs remain allowed and are marked unverified. Local and partial
stage retrospectives may be retained alongside current state.
An entry without a complete candidate remains pending_candidate_body. Do not
count a review, handoff, exposure or projection as a converted capability.
