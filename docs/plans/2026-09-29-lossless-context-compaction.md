# Lossless tool and capability-context compaction

Goal: reduce recurring input without removing callable operations, exact parameters, pending decisions or evidence.

## Implemented boundaries

- `compactToolSchema` encodes pure string-literal unions as string enums in task_harness, auto_research and task_checkpoint. It preserves constraints and TypeBox metadata, traverses schema locations only, and leaves annotated alternatives, mixed types and example/default data untouched.
- Capability queue details share only byte-identical repeated long instructions and carrier templates. References resolve within the same message, without a lookup round. Distinct decisions and evidence remain distinct; durable records are untouched.
- Creator-preparation prose is shorter while retaining change, assembly, semantic trial and explicit deferral paths.
- Telemetry records per-tool sizes alongside its existing measurement basis. A context-hook fallback is not an authoritative provider payload.
- Schema regression hashes normalize equivalent enum encodings; tests verify rejected unknown actions and reconstruct all shared queue content.

## Paired measurements

Same ARC smoke case, game, provider and active names before/after:

| Tool | Before | After |
| --- | ---: | ---: |
| task_harness | 9,632 | 8,063 |
| auto_research | 4,924 | 3,822 |
| task_checkpoint | 1,605 | 1,271 |
| arc_action | 1,510 | 1,510 |
| Total | 17,671 | 14,666 |

This is a 17.0% reduction in serialized tool-definition characters, not measured billed tokens. Source: `runs/arc-tool-schema-full-smoke-20260929/memory/arc-smoke-provider-contexts.jsonl` and `runs/arc-equivalent-context-smoke-20260929/memory/arc-smoke-provider-contexts.jsonl`. The broader identical-tool fixture reduced from 25,053 to 22,048 characters.

## Intentionally preserved

Historical evidence, unselected component boundaries, all operations/aliases, lifecycle checks and creator/assembly/use decisions remain available. No automatic adoption or semantic merging was added. Provider-specific caching and $ref factoring require separate compatibility evidence; they are not claimed here. Deferred research item D (cross-compaction cognitive continuity) remains unverified by this encoding optimization.

## Verification

- Focused initial checks: 16 passed. Broader regression batch: 64 passed and one stale tool-policy expectation failed; that expectation was corrected to retain the already-protected `task_memory_pool`, and its targeted rerun passed (1 passed, 40 deselected). No runtime tool-policy change was made for that assertion.
- Full `arc-harness-smoke`: passed all 16 scenarios using the real ARC environment, bridge, Pi loop and child process boundaries. Results: `runs/arc-equivalent-context-smoke-20260929/arc-self-harness-smoke-summary.json`.
- The matrix includes all five component kinds, later parent use, semantic tool outputs, and Auto-Research/ordinary delegation length continuation. Providers were deterministic test doubles: this verifies wiring and interface compatibility, not real-model comprehension of shared references, game performance, billed tokens or latency.
