# Autonomous Auto-Research agenda

## Objective

Keep the main agent responsible for the current online decision while allowing a
read-only Auto-Research child to maintain cross-stage research without requiring
the main agent to replay history, author every research question, or manually
assemble evidence references.

## Entry

`auto_research(action="start")` allocates one open research turn when no explicit
question, plan, candidate, session, or uniquely eligible handoff determines the
work. `current_concern` is optional context. Targeted calls keep their existing
contract.

## Runtime responsibilities

The deterministic runtime restores the latest research agenda, builds a catalog
of task-local resource kinds and incremental cursors, grants read-only discovery
and exact paged reads, and records the child report. It never decides semantic
similarity, the research question, or the conclusion.

Each open report includes `research_progress`. The runtime versions it in
`auto-research-agenda.jsonl` with the evidence cursor and exact run/report refs.
This agenda is continuity state, not a Harness component and not permission to
interact with the environment.

## Child responsibilities

The child chooses one bounded question from prior agenda and available history.
It may study recurring or similar patterns, form a falsifiable hypothesis, derive
a reusable method, assess an existing method, or identify a discriminating parent
experiment. It reads only evidence needed for that question and preserves exact
references and alternatives.

## Parent delivery

Methods, Harness candidates, planning implications, experiment requests, and
results marked relevant now return as a normal full capsule. Other progress is
persisted and returns only a short receipt. The main agent may explicitly inspect
the report later, but routine research continuity does not occupy its active
decision context.

## Boundaries

The main agent remains the only environment actor. Open research does not create
a second provider configuration, direct child interaction, automatic Harness
adoption, or a new module. Offline deterministic tests verify routing and durable
state; research quality and ARC task benefit still require a real provider run.
