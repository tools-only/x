# Shared request context projection

## Opportunity and claim

The Kaggle run's execution and evolution requests carried a median 67,721 and 79,418 input tokens respectively over inspected request samples. Its existing context hook shortened old tool output but kept every historical message. PPT already uses a batch boundary, yet long batches can accumulate the same history. The shared projector archives older dialogue before provider transmission, leaving 8–11 recent assistant/tool pairs, the initial task request, and the latest task-state message. It advances the archive every four assistant turns to limit repeated local writes. An archived reference remains available for inspection.

## Scope and integration

`demo/self_root_context.ts` is task-neutral. The PPT and Kaggle adapters call it at their existing context hooks. Kaggle retains its task-specific output and reasoning trimming before shared projection, removes a duplicate copy of competition instructions and skill index, and records provider payload composition. The projector does not change the durable Pi session or SelfRoot ledger. It keeps the latest user and custom state, and drops tool results whose calls were archived.

## Evaluation boundary

- Functional smoke: a synthetic twelve-call history projected to eight recent assistant messages, retained the latest custom state, archived the prefix once, and left zero orphan tool results. A 12/13/16-turn sequence retained 8/9/8 assistant messages with zero orphan results. A resumed history retained both its initial task request and latest continuation request.
- Full-chain reachability: module import and adapter hooks are wired. Actual Pi/provider continuation and transcript retrieval after projection remain unverified.
- Autonomous adoption and net benefit: unverified. Compare provider input, cache reads, archive writes, evidence-retrieval calls, task decisions and quality against the prior run. A reduction in request tokens alone does not establish benefit.

The primary failure case to inspect next is an agent that needs a dropped result but cannot find or read its saved reference. Preserve that outcome in the request audit rather than silently expanding the resident history.
