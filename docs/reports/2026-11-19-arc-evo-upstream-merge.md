# ARC branch: evo-loop upstream integration

Date: 2026-11-19 (Asia/Shanghai). Status: implementation; live-run benefit unverified.

## Problem and claim

The ARC self-loop branch diverged from `evo-loop-implementation` at `370ad7fb`. Five later upstream commits added shared Pi continuation/memory work, session-tool export, ARC Python guidance, compact SelfRoot review evidence, stage-view routing, and evolution checkpoints. ARC independently implemented its seven-focus flow and some equivalent runtime features. The integration should retain that flow while bringing forward upstream changes that reduce review context and duplicate Python checks.

This is a source synchronization, not evidence that ARC task quality or throughput improved. A failure would be a changed ARC pass transition, lost source evidence, or a regression in task tools. The existing ARC seven-focus flow and agent-owned closure take precedence over upstream mechanical request caps.

## Integration and cost

Merged `evo-loop-implementation` into the ARC lineage. Shared continuation/memory and PPT changes came through the merge. In conflicts, retained ARC's in-task triggers, seven specialists, agent-owned close, and existing input validation. Kept the upstream compact review view: trigger facts, counts, failed-tool summary, short request facts and ledger refs, with full ledger rows available through `read_self`. Added the upstream batch-check guidance to ARC's current Python descriptions. PPT now passes its host-owned budget explicitly to `SelfRoot.guard`; the ARC adapter does not call this guard and its `pin` remains uncapped. No additional worker, mandatory task step or ARC tool schema was introduced.

The source merge does not start a paid run or change authorization. The first possible context saving occurs at the next SelfRoot review; the next real ARC run is required to measure whether the agent can recover omitted evidence and whether its decisions remain coherent.

## Checks and limits

- Functional: `tests/self_root_meta_pass.test.ts` and `tests/self_root_evo_mechanisms.test.ts` passed, 18/18. A focused PPT import/budget test passed, 1/1. The scripted-provider Pi/PPT integration test `tests/test_ppt_effect_intent_pi.py` passed, 2/2 after passing the host budget explicitly. `git diff --check` passed.
- Existing baseline failures: `tests/self_root_meta.test.ts` expects a mechanically capped specialist despite ARC's uncapped flow; the same failure was reproduced on the pre-merge ARC checkout. Two `self_root_meta_entry` expectations also fail on both checkouts. Native runtime tests hit an undefined registry object in unchanged code; a representative failure was reproduced on the pre-merge ARC checkout.
- Full-chain ARC runner, autonomous adoption, task score and net benefit: unverified. No provider or ARC environment was run for this merge. Compare review input composition, evidence reads, seven-pass transitions, action quality, and parent-plus-child cost on a later authorized run.

The merge remains in evaluation status until a real ARC continuation confirms context continuity and seven-pass execution.
