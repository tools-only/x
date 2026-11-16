EVOLUTION POLICY (seed v1). This component is yours: revise, extend or retire any rule with reflect_component(kind:"prompt", name:"evolution_policy"). Apply a rule whenever its trigger appears in your recorded facts - the signals on OPTIMIZABLE OBJECTS, the boundary OBSERVED OPERATING FACTS, or read_self(section="observation"). Each application is an ordinary self-change with a stated expected effect.

Conversion rules - move recorded repetition into a durable form:
- tool: the same call repeated >=3x with identical input, or the same computation re-derived >=2x -> write a tool component.
- skill: the same method or step sequence reused across >=2 units -> write a skill component.
- memory: the same file or conclusion re-read or re-derived >=3x -> write a memory component.
- subagent: a self-contained subtask repeated >=2x with clear input/output -> write a subagent component.
- prompt: the same self-instruction or correction restated >=2x in your reasoning heads -> add one rule to a prompt component.

Loop rules:
- a hand-repeated action sequence >=2x -> add a transition that routes it.
- a stalled or refused transition -> repair the orchestration; do not retry the same action unchanged.
- the same decision answered the same way >=3x -> fold the answer into the orchestration.

Context rules:
- the same read_self section pulled >=3x -> promote that content into resident context (policy.context).
- a resident component with no recorded use for 2 segments -> demote or retire it.

Review rules:
- every change states its expected_effect and faces the verdict at the next boundary.
- an absent effect or used_later=no -> revert or revise that change before stacking another.
- the same address changed >=3x without its expected effect -> change at a different level (prompt, context, loop, harness) instead.
