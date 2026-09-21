# Knowledge lifecycle and prompt assembly

Scope: implement the approved conflict/replacement and layered/event-selected
prompt mechanisms on the existing memory, skill and system_prompt resources.
Preserve the existing five-component router, current working-tree changes and
the running ARC process. No game-specific inference or automatic semantic judge.

## Decisions

- Memory content is authoritative. Changed summaries or custom projections on an
  existing memory require an explicit content write; a content write clears an
  omitted custom projection text so the new content supplies the projection.
  Metadata-only updates preserve the existing coherent representation.
- `depends_on_refs` declares exact-version prerequisites, distinct from historical
  `basis_refs`. `supersedes_refs` explicitly replaces exact resource versions.
  Invalid prerequisites suppress automatic projection transitively and surface
  review notices. Original records remain readable. No guessed semantic conflicts.
- Dynamic memory projections declare `layer=task_policy|task_state` (default
  task_state); existing activation predicates select them each context. Strategy
  precedes state; full evidence stays addressable through task_resource. Host
  system instructions remain fixed; native task system overlays retain their
  existing next-agent-turn application boundary.
- Assembly manifests identify selected versions, layer, exact projected text hash
  and suppressed resources. These are assembly receipts, not provider compliance
  or task-quality evidence. No new persistent harness component.

## Work and verification

1. Add regression cases for stale memory, replacement, dependency invalidation,
   recovery and conditional layer selection.
2. Add deterministic lifecycle/assembly helpers and integrate native tools,
   scoped skill reads, system overlay selection and code routing.
3. Document the contract and boundaries; run focused and related Pi regressions.
4. Run arc-harness-smoke through the real bridge/Pi/broker/native route/action and
   later parent turn, all five components and both length continuation paths.
   Deterministic smoke does not establish real-provider benefit or game quality.

Risks: dependencies can be overdeclared (unnecessary suspension), or omitted
(semantic contradiction remains undetected). Use exact refs only for genuine
validity dependencies; repair/revalidate explicitly. Historical transcript and
checkpoint text is not rewritten by this mechanism. Stable system overlays can
only be refreshed at Pi's next before_agent_start; dynamic policies belong in
task_policy. Existing unannotated records keep legacy eligibility until revised.

## Native API example

After `memory:world-model@v1` exists, a conditional policy can declare its exact
prerequisite (tool: `task_memory`):

```json
{
  "action": "upsert",
  "key": "probe-policy",
  "content": "Run a discriminating probe before committing to the route.",
  "depends_on_refs": ["memory:world-model@v1"],
  "projection": {
    "channel": "task_prompt",
    "layer": "task_policy",
    "activation": {"type": "state_match", "path": "assertions.probe", "value": true}
  }
}
```

Updating world-model to v2 suspends this policy until its author revalidates it
and updates `depends_on_refs` to v2 using the policy's current `target_version`.
Alternatively, a differently named replacement can declare
`supersedes_refs: ["memory:world-model@v1"]`. Replacement remains recorded even
after the replacement itself retires; old guidance is not silently resurrected.
All revisions, including metadata-only revisions, change the exact version and
therefore require dependent resources to be revalidated. Clearing dependencies
with `[]` is an explicit author decision, not runtime proof of validity.

The dependency graph covers memory, skills and task system overlays, not tools
or subagent definitions. Historical `basis_refs` remain evidence provenance.
The runtime validates reference/graph consistency, not semantic truth. Scoped
skill execution reads reject invalid guidance; historical task_resource reads
remain available. Historical transcripts and checkpoints are not rewritten.

Auto-Research fact/plan deliveries expose the same link fields plus
`prompt_layer`; procedure deliveries support the link fields. Current assembly
receipts are written to `task-prompt-assemblies.jsonl` and
`task-system-prompt-assemblies.jsonl`. Dynamic cards refresh per context, while
system overlays refresh at the next outer agent turn, not after each tool call.

## Verification, 2026-09-18

- Related Pi regression batch: 76 passed (before final additional edge tests).
- Final lifecycle/edge tests plus existing child smoke tests: 20 passed.
- Final expanded lifecycle suite, including policy/state/review survival after
  actual Pi context compaction: 16 passed (supersedes its earlier 15-test subset).
- Context lifecycle regression: 5 passed, 52 deselected.
- Real ARC runner smoke: 10/10 cases, 201/201 assertions passed at
  `runs/arc-harness-smoke-knowledge-20260918-retry/arc-self-harness-smoke-summary.json`.
  All five resources, semantic tool output, both research/delegate length
  continuations and later parent turns were exercised. The actual ARC SDK and
  runtime boundaries were used; only the model provider was deterministic.
- During acceptance, normal task prose mentioning the terminal-review marker
  falsely enabled read-only mode. Detection now requires the leading protocol
  marker; both the normal mention and actual terminal mode have regression tests.
- No real-model benefit claim. The existing DeepSeek run was not restarted or
  edited; loading these runtime changes requires a newly started Pi process.

This work used the Code verification workflow and architecture-designer's
separation of responsibilities: validity/assembly lives in the task runtime,
not in ARC environment interpretation.
