---
name: skill-creator
description: Author a task-local procedure for exploration, uncertain rules, objectives, planning or a bounded operation.
---
# Pi runtime adaptation: Skill creator

Main authors the complete procedure; research may supply evidence or suggestions. A local, provisional or first-use procedure is valid. Reuse this creator_ref for repairs.

Fill the returned candidate with name, a description saying when to use it, and instructions teaching inputs, ordered steps, decision conditions, required output, uncertainty, stopping and failure handling. Put facts in scoped Memory; a trajectory recap is not a procedure. Optional method audit metadata is not required. Select a useful next application; do not wait for a fully known goal or a recurrence before trialing an evidence-based method.

Publish with the returned task_harness(change) change_call or task_harness_create. Its optional assembly selects this call's new versions plus the listed existing refs using the current revision; omit it for pool-only creation, then assemble separately. Follow the receipt's read(path) entry to load the Skill while retaining other selected components. Apply its procedure to the next task decision and cite its exact ref. Creation and reading alone prove no utility.

## Running and evaluating test cases
Check the procedure on task evidence and a counterexample; revise, retain or retire based on its actual prediction and subsequent result. Keep unknown rules and competing hypotheses explicit. No extra environment actions or resets without the parent's current authorization. Runtime preserves creator, version, scope and assembly checks.

Detailed authoring background is optional: read_method(method_name="skill-creator", method_resource="references/authoring-background.md"). PI_ADAPTATION.md describes optional method metadata. Neither is needed to publish a complete small Skill.
