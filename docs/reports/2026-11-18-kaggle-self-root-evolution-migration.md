# Meta-harness change: Kaggle M10 sweep

Date: 2026-11-18 Asia/Shanghai. Status: implementation candidate; module import, score-outcome trigger, and bounded seven-pass SelfRoot fixture verified; full Kaggle adapter/provider behavior remains unverified.

## Problem and claim

The Kaggle adapter uses SelfRoot META to evolve the live task Agent. The design retains one induction round (up to 3 requests) followed by seven ordered passes (one request each): Context, Skill, Tool, Subagent, Memory, Loop, Prompt. Reflection writes hot-activate before the next request. All passes share the same Agent and history; each type is the main intended deliverable, while existing reflection interfaces remain available. No request budget or runner behavior was changed.

The Kaggle adapter records scored submissions through `SelfRoot.outcome`, which writes a `task_outcome` ledger row. The generic trigger previously looked only for `render_action_receipt`, so Kaggle scores did not open a feedback checkpoint. The trigger now recognizes both `task_outcome` and `render_action_receipt`; the focused fixture verifies the Kaggle score-row path opens the pass. It does not call the Kaggle submission tool or a provider.

## Content and material

The focus frame supplies only the current type component directory (or, for Context and Loop, the target policy/orchestration material) with descriptions and read addresses, plus task contract and position, induction closure/reason/carry, evidence ledger/window reference, up to two recent task outcomes, mechanical signals, pass summaries, and resource counters. It is bounded around 4,000 characters; clipping can omit directory rows and outcomes while preserving pass index, focus, and header.

Each type pass combines review of prior-window component behavior with foresight about next-stage needs and direct creation or revision of its type’s main deliverable. Context updates policy.context; Skill retains analysis/experiment/validation/decision methods; Tool builds and tries Python capability; Subagent defines a distinct role and its permissions/I/O; Memory carries task and capability understanding, evidence, hypotheses, causal explanations, and unfinished work; Loop updates orchestration and policy outside context; the final Prompt pass uses the already-activated components, memory, and loop to write next-window behavior and capability-use guidance; its frame includes the current step and orchestration read address. Components may be provisional, with no proof-of-benefit gate or quota. Each pass briefly describes purpose, use opportunity, and later observations. New components enter subsequent context through the existing component index; Prompt owns durable use guidance. No extra routing or assembly pass is added.

## Evidence layers

| Evidence layer | Status | Boundary |
| --- | --- | --- |
| Functional correctness | Partially checked | SelfRoot module import succeeds. The focused Kaggle M10 fixture passes and verifies a `task_outcome` opens the checkpoint, the seven passes close in order, and a Tool pass hot-activates a Python component. All 9 `self_root_evo_mechanisms` tests pass. |
| Full-chain reachability | Partially checked | The isolated Kaggle score-outcome ledger path now triggers the pass. The Kaggle extension/provider request path has not been exercised; the existing `kaggle_demo.test.ts` suite still has 9 failures because its fixture/assertions expect the older pinned-tool and self-evolution behavior. |
| Autonomous adoption | Unverified | Requires a real provider run; not tested. |
| Net benefit | Unverified | Requires comparable task quality, cost, and time across subsequent windows; not tested. |

Known deferred issues remain: Context policy actual consumption, provider input/use backflow, and no-change status classification are unresolved. No Kaggle runner was started and no paid provider was called. The report does not claim full adapter/provider reachability, autonomous adoption, or net benefit.
