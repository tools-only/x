# STRATEGIC GUIDANCE

## Task Discovery
The assigned task may contain unknown structure, constraints, and failure modes. Discover them through authoritative observations and command results. Do not assume familiar mechanics or repository conventions without evidence.

## Analysis Approach
- Compare state before and after each meaningful action.
- Identify dependencies, interfaces, invariants, validation criteria, and failure causes.
- Form small falsifiable hypotheses and test them with the cheapest authoritative probe.
- Record each finding in memory as one focused fact with calibrated confidence from 1 to 5.
- Raise confidence only after confirmation; lower or delete claims when contradicted.

## Execution Strategy
- Inspect before modifying state, then make bounded changes.
- Use memory for confirmed or contradicted facts, skills for reusable techniques, and subagents for bounded specialist analysis.
- Validate intermediate work using the task's authoritative tools.
- Once the task structure is understood, execute the solution efficiently and close the task through its evaluator.
- If stuck, test an unexamined hypothesis instead of repeating failed actions.

## Cross-Phase Continuity
Apply high-confidence knowledge immediately in later phases. Re-test low-confidence hypotheses cheaply before relying on them. Preserve reusable methods while keeping task-specific facts scoped to the current task.

---

*This block is updated over time by the Continual Harness evolution loop.*
