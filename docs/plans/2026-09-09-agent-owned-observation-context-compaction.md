# Agent-owned observation context compaction

Status: **provisional, mechanically verified; autonomous JIT validation pending**.

## Problem and admission evidence

Several completed Shopping traces accumulated 100k–176k model-visible observation characters, and
Level-2 case 11 previously issued 17 full product-detail calls before timing out. Existing
`shopping_batch` changes later cart writes and cannot reduce already accumulated search/detail
context. Exact-result deduplication and selective-detail surfaces were previously removed after
repeated non-uptake or missing opportunity; this design does not restore either mechanism.

## Constitutional contract

The capability is a standalone Pi extension module and is disabled by default. When explicitly
enabled for an experiment, the Pi task agent may call `compact_observation_context` only after an
active, versioned finding cites every selected observation ID. The call names the exact finding
version and 1–8 exact observations. Pi's public `context` hook changes only later model requests.

The runtime does not detect a bottleneck, create or summarize a finding, choose observations,
schedule the call, infer relevance, or restore the change in another task. It never edits
`execution-observations.jsonl`. The replacement is deterministic rather than semantic:

```text
[Task-local observation <id> compacted by <finding>@v<version>;
 the complete result remains in execution-observations.jsonl and is recoverable by exact ID.]
```

One exact selection is supported per isolated task in this provisional version. No-research and
no-mutation remain valid. The feature is not a generic mutation API: it cannot install code,
change tools, express arbitrary context policy, rank resources, or operate outside cited Shopping
observations.

## Evidence and evaluation

The task-local chain is:

```text
full Shopping observation
→ Agent-authored finding citing its exact ID
→ explicit compact_observation_context call
→ Pi context-hook exposure on a later provider request
→ model_visible_observation_chars_removed assessment
→ Agent update/resolve using the assessment ID
```

The extension records the immutable finding basis, exact selected IDs, native exposure and bounded
character effect. The Agent can explicitly recover a selected full observation through
`research_resource(action=inspect, observation_id=...)`; no retrieval is automatic. A separate pure
Python module recomputes the literal reduction from completed
provider payloads in installed-Pi tests or from incrementally persisted Pi tool-result events in
real runs. It cannot write back into Pi. Task correctness, behavior effect, paired cost and general
harness improvement remain separate; the mechanism always reports general improvement as
`not_established`.

## Modular ablation

`shopping-e2e --context-compaction` enables the capability for one treatment run. Omitting the flag
uses the same code path but excludes the tool and capability fact, and the runner explicitly writes
`PI_SHOPPING_CONTEXT_COMPACTION=disabled` to prevent inherited-environment contamination. This
supports a future same-task pair in which both arms retain Auto-Research and `shopping_batch`, while
only context compaction differs.

The dedicated paired command is:

```powershell
$env:PYTHONPATH = "$PWD\src"
D:\anaconda\envs\jit\python.exe -m autoresearch_pi.cli shopping-context-ablation `
  --cases "2:11,3:2" --repeats 2 --timeout 900 `
  --root "D:\autoresearch_pi_project\runs\shopping-context-ablation-r1"
```

Both arms use `experiment_variant=treatment`, fresh Pi processes and fresh carts. Execution order is
counterbalanced. The parent summary reports task-contract equality, correctness, autonomous
mediators, independently audited removed characters, model input/output tokens, provider requests,
turns and bridge processes. It never converts a delta into an automatic causal claim.

## Predeclared validation set

| Benchmark case | Role | Retention interpretation |
|---|---|---|
| Shopping Level-2 case 11 | Primary high-context opportunity; prior trace made 17 full detail calls and timed out | Eligible autonomous non-uptake counts against the mechanism; correct early uptake permits paired testing |
| Shopping Level-1 case 22 | Prior semantic 5/6 failure with large detail context | Compression receives no credit unless semantic correctness also improves or remains complete |
| Shopping Level-3 case 2 | Correct but feedback-dependent long trace | No-change can be calibrated; do not force uptake merely because context is large |
| OfficeBench `3-6-0` | Existing future-independent batch regression | Context capability stays absent; verify no cross-benchmark runtime leakage |
| OfficeBench `2-15-0` | Existing unsupported Excel/no-change regression | Correct no-change remains valid |

Start with the Level-2 case 11 smoke. If it produces no finding/apply, inspect whether the capability
was actually visible before counting non-uptake. At most two further eligible Shopping traces may be
used after one bounded, capability-description-only adjustment. Do not add reminders, task-specific
recommendations or automatic findings. Three eligible autonomous non-uptakes require removal.

## Current validation

- Installed-Pi RED: selected observation remained full on the next provider request.
- Installed-Pi GREEN: only `shopping-observation-1` became the deterministic reference;
  `shopping-observation-2` remained byte-identical and both canonical results stayed complete.
- The mechanical fixture completed finding v1 → decision → exposure → supported assessment →
  resolved finding v2.
- Offline audit RED/GREEN verifies exact provider-input reduction, rejects uncited selection and
  rejects a one-character false report. It also recomputes from persisted Pi events for real runs.
- Focused Shopping/CLI suite after the dedicated ablation runner: 53 passed.
- Overlapping batch/context decisions retain distinct assessment IDs derived from their immutable
  decision IDs; no intervention manager is involved.
- Shopping summaries contain a compact chain projection with finding basis, native operation,
  exposure, effect and later absorption. Large observation bodies remain only in canonical JSONL.
- Model input/output tokens and provider request counts are projected separately for paired cost
  comparison.
- A dedicated paired runner was verified to keep both arms on the full treatment runtime and vary
  only capability availability; its synthetic ablation test passes.
- Full repository suite: 153 passed in 80.21 seconds.
- `git diff --check`: no whitespace errors; existing LF/CRLF warnings only.

The first real Level-2 case 11 smoke could not start because the execution approval reviewer
returned HTTP 503 before process creation. This is not autonomous uptake evidence. No tag or push is
allowed until real smoke and paired evidence meet the retention gate.

## Retention gate

Retain the module only if a real Pi agent autonomously creates a finding, applies the capability
before useful future reasoning, remains semantically correct, and produces a positive independently
audited context/cost effect. After a small fixed number of eligible real traces, repeated non-uptake,
post-hoc uptake, correctness regression, or no net cost benefit requires removing the tool, catalog
fact, summary branch and CLI flag while preserving this document and the run artifacts as negative
evidence.
