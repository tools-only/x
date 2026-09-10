# Agent-selected Shopping detail surface

Status: **rejected after autonomous JIT validation; removed from the runtime**.

## Original decision and evidence

Five existing Shopping arms produced 42,574–139,693 characters from
`get_product_details`; the latest Level-1 case 22 treatments returned 85,040 and
92,877 total model-visible observation characters and both selected only 5/6
required products. The current `shopping_batch` capability acts after candidate
selection and cannot address this bottleneck.

Three approaches were considered. Runner-controlled field projection is rejected
because it lets the experiment coordinator decide what the Agent sees. Generic
semantic deduplication is rejected because it requires an outer relevance model and
no exact-repeat opportunity was observed. The selected approach is one
capability-specific Pi tool, `shopping_selective_details`: the Agent supplies product
IDs and explicit dot-path fields, and the tool returns only those fields while the
canonical task observation retains the complete backend result.

## Runtime boundary

The tool starts inactive and is disclosed as one bounded capability fact. A current-
task finding must cite a prior full `get_product_details` observation; the Agent may
then apply, keep, or ignore the capability. Apply calls Pi's public
`setActiveTools()` and takes effect on the next model request. The runtime does not
infer candidate products, fields, thresholds, or when research is worthwhile.

One applied decision records an immutable finding snapshot and a bounded
`selective_detail_compression` prediction. The post-exposure window measures literal
result characters per returned product against cited full-detail observations. The
Python runner independently recomputes linkage and the metric. This behavioral
effect remains separate from evaluator correctness and from general harness
improvement.

## Autonomous validation

The mechanical chain was implemented and passed installed-Pi and independent runner
link audits. Two high-opportunity canonical Level-1 runs then exposed the inactive
capability to the real Agent:

- `runs/shopping-selective-details-l1-22-r1`: 52 observations, 140,674
  model-visible characters, 5/6 evaluator matches, and no finding, decision,
  exposure, selective call, or effect;
- `runs/shopping-selective-details-l1-46-r1`: 33 observations, 162,152
  model-visible characters, 6/6 evaluator matches, and again no finding,
  decision, exposure, selective call, or effect.

The second trace explicitly considered the capability and chose direct full-detail
work. The first failure was a semantic shortcut around the quoted product phrase,
not a missing-field or result-size failure that the new surface demonstrably fixed.
Method integration alone also left Level-1 case 22 at 5/6 with no finding.

## Final decision

The runtime capability, audit branch, scripted fixture, and dedicated tests are
removed. Keeping them would permanently enlarge the tool schema, context,
capability catalog, state, and summary surface despite repeated autonomous
non-uptake and no correctness-gated positive effect. Strengthening task-specific
prompts or having the runner infer when to recommend selective fields would violate
Agent ownership and risk creating a second harness.

The canonical task contract, equal control/treatment character accounting,
complete observations, Shopping Auto-Research method integration, and the existing
finding-backed `shopping_batch` Pi surface remain. A future detail representation
capability requires new real traces showing a repeated material bottleneck and a
bounded Pi-native operation whose autonomous uptake improves correctness-gated
cost.

## Minimality rule retained

No generic observation policy, resource scheduler, candidate registry, causal span,
rollback manager, or cross-task memory was added. Mechanical success was treated as
necessary but insufficient; the repeated autonomous non-uptake activated the
predeclared removal rule. The capability was removed rather than made mandatory or
supported by task-specific recommendations.

## Reconsideration result

A later Level-2 case with six requested products supplied the missing repeated
material-bottleneck evidence. Its paired baseline failed before cart writes after
44–50 observations, so the selective surface was reimplemented as the same bounded,
Agent-selected Pi surface and mechanically verified with a complete
finding/apply/exposure/effect/resolve lifecycle.

The real treatment smoke still produced no uptake. The Agent explicitly referenced
the disclosed selective tool limit and anticipated that full details would be large,
but issued 17 full-detail calls totaling 166,366 canonical result characters. It
timed out with an empty cart and no finding, decision, exposure, or effect. Because
this was the third autonomous non-uptake after the Agent had seen the capability,
the temporary implementation and its positive scripted fixture were removed again.
The run remains at
`runs/shopping-selective-details-l2-11-smoke-1`; it is evidence against retaining the
capability, not evidence that a mechanical scripted chain improves a task.
