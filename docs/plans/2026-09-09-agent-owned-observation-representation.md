# Agent-owned observation representation

Status: **rejected prototype; not part of the current runtime**.

## Decision

The runtime starts from complete results and persists complete canonical
observations. Runner-controlled projection, task-specific recommendation cards,
and the later Agent-owned exact-repeat policy prototype are all removed from the
current runtime. The first two violate the runner boundary; the last one is
directionally compatible with Agent ownership but failed the minimum-benefit gate.

## Current runtime contract

- Default model-visible representation is `full`.
- `EXECUTION_OBSERVATION` adds provenance and outcome metadata without copying the
  result body a second time.
- `execution-observations.jsonl` always stores complete arguments and results.
- No observation-representation mutation tool is exposed.

## Why the prototype was removed

An Agent-owned, finding-backed `full | deduplicate_exact` tool was implemented and
mechanically verified. However, the latest real Shopping traces contained no
byte-identical repeated observations. Keeping the tool would add an active tool,
state, decision log, exposure log, and context branch without a demonstrated task
opportunity or effect assessment. Broadening it to semantic deduplication would
reintroduce domain relevance judgment and risk creating a second harness layer.

## Verification

Native Pi fixtures verify full product fields, no task-specific decision card, an
ignored legacy runner projection toggle, and the absence of an observation-policy
tool or capability entry. This negative test protects the current minimal surface.

## Reconsideration condition

Reconsider a representation capability only after multiple real traces show a
material repeated-observation bottleneck and a Pi-native, Agent-selected operation
can be evaluated with a bounded post-exposure effect. Until then, the prototype is
historical evidence, not a supported capability.
