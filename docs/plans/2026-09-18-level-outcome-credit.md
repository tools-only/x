# Level outcome retrospectives

The Agent runtime opens a whole-level evidence window on level advancement/WIN,
explicit RESET, GAME_OVER, or action-budget exhaustion. A reset retains earlier
attempts in the same level. A successful level starts a fresh window. Duplicate
observation IDs and duplicate submissions are idempotent across session recovery.

The parent submits `task_harness(action='level_review', window_id=...,
level_review=...)`. Reports contain summary, mechanisms, shortcomings, lessons,
next_attempt, and credits. Credits target exact execution observations or versioned
harness resources and include evidence, alternatives/counterfactual uncertainty,
and next-use advice. Positive harness credit requires an application observation
after resource creation and before the boundary. Creation/exposure/reading alone
cannot receive positive outcome credit. Attribution remains an Agent assessment,
not experimentally established causality, benchmark score or model training reward.

Reports are appended to `task-level-reviews.jsonl`, readable through
`task_resource(kind='level_review')`; the latest report's lessons and credits enter
later parent contexts. Pending windows enter context with exact trajectory refs
and a resource-version catalog. Before another action the runtime requests review
at most twice, preserving evidence and pending status if the Agent fails to submit.

At a terminal runner boundary treatment receives one read-only analysis turn;
tool hooks block actions, research and harness mutations while permitting resource
reads, status and review submissions. The final wait is bounded to 120 seconds;
incomplete/failed analysis does not change the already committed game outcome.
Control runs do not receive this turn.

Automatic in-game resets without an explicit public reset signal cannot be
reliably inferred from delta cell counts. The Agent can open a clearly labelled
unverified reset review using `report_level_reset`, citing the triggering action
and evidence/alternatives. This does not change canonical environment state.

The brainstorming workflow informed the separation of observations, qualitative
credit and future reuse. This implements part of deferred item D (retaining
outcome lessons); it does not establish full cross-compaction cognitive continuity.

Verification: pure window/credit-validator tests and native Pi scripted integration
tests cover persistence, duplicate submission, context exposure and terminal tool
restrictions. These diagnostics are not ARC self-harness closure acceptance and
do not establish provider behavior or benchmark improvement. Existing live processes
must reload the extension to acquire this mechanism; this change does not restart them.
