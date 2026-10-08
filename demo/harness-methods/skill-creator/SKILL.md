---
name: skill-creator
description: Author a task-local procedure for exploration, uncertain rules, objectives, planning or a bounded operation.
---
# Pi runtime adaptation: Skill creator

Main authors the complete procedure; research may supply evidence or suggestions. A local, provisional or first-use procedure is valid. This template is optional. If supplied, authoring_method_ref must match the current creator_ref; omit a stale citation when submitting complete content.

Fill the returned candidate with name, a description saying when to use it, and instructions teaching inputs, ordered steps, decision conditions, required output, uncertainty, stopping and failure handling. Put facts in scoped Memory; a trajectory recap is not a procedure. Optional method audit metadata is not required. Select a useful next application; do not wait for a fully known goal or a recurrence before trialing an evidence-based method.

Publish and install with the returned task_harness_create call. assembly=false stages only; task_harness(change) without assembly also stages only. An explicit assembly object selects exact versions using the current revision. Apply newly authored instructions already in context directly to the next task decision and cite their exact ref; no reread is required. For an existing Skill whose body is needed, use the receipt's load_if_needed entry. Keep other selected components or explicitly change the composition. Creation and reading alone prove no utility.

## Running and evaluating test cases
Check the procedure on task evidence and a counterexample; revise, retain or retire based on its actual prediction and subsequent result. Keep unknown rules and competing hypotheses explicit. No extra environment actions or resets without the parent's current authorization. Runtime preserves creator, version, scope and assembly checks.

Detailed authoring background is optional: read_method(method_name="skill-creator", method_resource="references/authoring-background.md"). PI_ADAPTATION.md describes optional method metadata. Neither is needed to publish a complete small Skill.
