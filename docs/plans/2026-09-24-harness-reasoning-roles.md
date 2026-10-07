# Harness roles and continuous hypothesis research

Status: initial implementation; real-provider observation ongoing, interim Gmail report sent.

## Context

The user's object/control -> goals/constraints -> plan example is a dependency
structure, not a fixed sequence or a ladder of certainty. A wrong object identity
can undermine a control hypothesis and every dependent plan. Research must track
these assumptions across revisions, not just extract low-level movement records.

## Responsibilities and conversion

| Carrier | Owns | Example conversion |
|---|---|---|
| system_prompt | scoped persistent behavioral instructions, not facts | parent-authored rule for handling uncertainty across decisions |
| Skill | agent-executed procedure, including local and untested procedures | how to identify controllable entities or test a goal hypothesis |
| Pi Tool | executable computation with actual inputs/outputs | a parent-implemented state comparison or route calculation |
| Subagent | independent/prepared reasoning context and allowed tools | an independently scoped review of alternative goal explanations |
| Memory | scoped observations, tentative claims and their provenance | current control hypothesis or level-specific map, with appropriate lifetime |
| task_prompt | selected guidance assembled from exact resource versions | current plan and relevant constraints; not a sixth persistent component |
| Auto-Research | continuing inquiry into claims, alternatives and evidence | revise mechanisms, goals and plans as new results support or contradict them |

The same experience can yield several carriers. A stored control hypothesis is
not the procedure for discovering controls. A plan is not automatically a system
instruction; planning can be a Skill, a computation a Tool, and the current plan
selected task guidance. None must wait for broad generality or a complete method
dossier. Creator authoring, runtime persistence and parent selection remain separate.

## Initial changes

Remove wall-clock expiration of periodic reviews: slow model thinking is not a
semantic reason to discard an opportunity. Retain existing call/failure handling
for now; no new limit is introduced. Correct review guidance that incorrectly
requires full method metadata. Add task-independent parent guidance to continue
research across dependent hypotheses using existing report/session fields.

## Alternatives and limitations

Do not force one component per reasoning stage or require a new claim graph at
admission. This avoids more schema repair and preserves direct authoring. Textual
dependency tracking is less machine-auditable; whether existing research agenda
restoration retains multiple unresolved claims needs actual-run verification.
Do not infer confirmed causal dependencies from trajectory co-occurrence.

## Required next evidence

1. Verify the parent receives and can use this guidance; focused tests are diagnostic.
2. Real ARC/Pi/broker smoke verifies wiring, not autonomous research quality.
3. Real-provider unlimited ARC run must expose actual parent decisions, created
   and selected versions, action-linked use, research starts/returns and hypothesis
   revisions (or accurately report missing behavior and its cause).
4. Fix or account for duplicate bridge event counting before quoting action totals.
5. Email the actual process, component contents and unresolved gaps to
   595819371@qq.com through Gmail. Do not label intended behavior as observed.

Deferred research backlog B/C/D remains relevant: active evidence exchange and
cross-compaction continuity are not proved by this initial guidance change.

## Execution checkpoint

- Prior turn made concrete code/document/test changes; this turn launched the
  current real-provider experiment after confirming no existing e2e process.
- Real run: `runs/arc-hypothesis-roles-unlimited-20260924/run`, PID 38596,
  ls20 treatment, context compaction, no Jev, max-actions=0, no experiment timeout.
- Four real actions and zero environment errors at the first reporting checkpoint;
  mechanism hypotheses and predictions were visible, no components/research yet.
- `runs/arc-hypothesis-roles-smoke-20260924/arc-self-harness-smoke-summary.json`:
  15/15 passed with actual ARC environment and deterministic provider.
- Gmail interim report sent to 595819371@qq.com, message ID
  `1a0d38336c21e00f`, SENT. Includes component roles, exact initial modifications,
  historical Skill content/use, duplicate action-count caveat, and outstanding
  real-provider evidence. It is not the final experiment result or goal completion.
- Next: revalidate PID and artifacts; inspect actual component conversion/use and
  research starts/returns/dependent hypothesis revisions. Do not restart merely
  for slow/no-output observation. Final result mail and completion audit remain.

### Next continuation checkpoint: event accounting repair

PID 38596 revalidated live; four successful observations, last at
2026-09-24T13:00:06Z. Latest provider response headers were HTTP 200 at
13:00:09Z, but no completed assistant turn/new action was yet recorded. This is
a verified wait, not evidence of terminal failure; do not restart on this alone.

Found and repaired duplicate event persistence: bridge and runner both appended
the same events. Runner now explicitly launches its bridge with
ARC_BRIDGE_EVENT_WRITER=parent; standalone bridge behavior is unchanged. Two
regressions passed. `runs/arc-event-writer-smoke-20260924/` memory case passed
through the real ARC bridge/Pi/broker and recorded three action rows for three
unique indices. This scoped recheck is not a new full five-component acceptance.
The already-running model experiment retains its loaded code; count its actions
using execution observations/unique indices. It was not restarted for accounting.
No additional email sent while research/component evidence remained unchanged.

### Confirmed termination and recovered-provider-error fix

The run subsequently terminated (summary runner_failed and all scoped processes
gone), after five actions and five Memory components. Main did request research
on object roles, hazards, goal conditions and a discriminating experiment. The
first call returned research-orchestration plus retry, started=false; no child
was launched. This is meaningful research intent, not a completed research result.

Event evidence showed error/terminated followed by successful toolUse responses,
Memory creation and a committed ARC action, then runner-boundary abort. The
runner's error scanner incorrectly found the old recovered error and exited.
It now stops scanning at a later successful stop/toolUse/length response, while
still reporting a genuinely latest error. Five targeted regressions passed,
including no-reprompt behavior for unrecovered errors. No quota/network errors
are hidden by this change, and there is no new retry or admission limit.

Replacement real run: `runs/arc-hypothesis-roles-recovery-20260924/run`, same
unlimited steps/no Jev/no experimental timeout configuration. Old logs retained;
restart followed confirmed terminal state, not slow observation. It also loads
the single-event-writer fix. Verify actual process ID from launch output and
inspect its evidence before claiming restored research/component outcomes.

### Real conversion observed in replacement run

PID 33472 confirmed live. Eight actions at 2026-09-24T13:24:57Z.
Main read Skill Creator and authored `skill:arc-5x5-token-navigate@v1`, then
selected it with `memory:ls20-token-control-map@v1` in assembly revision 1.
Actions 6/7/8 explicitly cite the Skill. Decision-2 effect assessment cites
observations 6/7 and supports tested left-movement branches; do not generalize
that judgment to all colors, object identities, or overall benchmark benefit.
The procedure covers run parsing, token localization, destination classification,
one-step subgoal navigation, unknown-frontier probes and result comparison.
Its color and fixed-delta assumptions remain hypotheses. A failed duplicate-entry
review did not prevent subsequent direct creation. No Tool/Subagent/System Prompt
or research child result yet; proposed handoff is not research completion.
Detailed Gmail conversion update sent to the requested address, explicitly
distinguishing actual use from correctness and unresolved research tracking.

### Goal/mechanism hypothesis evidence, action 12

PID 33472 confirmed live with 12 actions, zero environment errors and no completed
level. Action 11 probed whether entering the special 0/1 pattern was the goal;
it changed 58 cells without completing the level. Main then distinguished two
explanations for the lower display change: per-action animation versus a trigger
caused by entering the special object. Action 12 tested a further move; its delta
was 52 cells. This is real parent hypothesis refinement beyond direction mapping,
not proof of either explanation or an Auto-Research result.

Main explicitly reused the Skill, deferred Tool as not yet worth encoding, and
declined a Subagent because the questions require parent environment actions.
The last rationale is incomplete: action ownership does not rule out independent
hypothesis comparison or experiment design. Nevertheless there is no evidence of
a failed research invocation in this run; do not mislabel a policy choice as a
router failure. Research handoffs remain available; no research sessions/results
were present at this checkpoint. Persistent research adoption remains unverified.

### First level completed; conversion repair remains observable

At action 18 (2026-09-24T13:35:10Z), bridge reported levels_completed=1 and
NOT_FINISHED. Parent tested overlap with the glyph inside the upper box as a
candidate completion trigger; the resulting frame changed 1469 cells. This is
real task progress, not causal attribution to the Skill or full-game completion.

Before this, main tried to revise its floor-only traversal interpretation from
observations 11/17. The change failed with unsupported semantic_kind: undefined:
both authored candidates contained atom/name/validity but omitted component kind.
Do not count those proposed corrections as stored versions. Follow whether the
parent repairs them and revisits level-dependent assumptions. At the checkpoint
PID 33472 remains live, 18 actions, one Skill version, two Memory rows, two
operation failures, no research sessions/results. Do not restart merely because
the next parent response after the level change has not yet arrived.

### Live checkpoint: action 20 and recovery gaps

At approximately 21:45 Asia/Shanghai, PID 33472 remained live; the canonical
bridge recorded 20 actions, one completed level and no environment-error events.
Fourteen action decisions cited the navigation Skill. These are declared uses,
not independent correctness or causal-benefit measurements. Memory has four
distinct keys: control map, old goal geometry, destination acceptance and the
new level route. Old geometry was explicitly retired at v2; the other three
keys have active records. The level review initially omitted verdict fields,
then successfully resubmitted at 13:41:17Z.

New diagnostic evidence changes the next repair priorities:

- The malformed update (a literal `decision` string inside `changes`) was
  resubmitted, but the 13:44:59Z change receipt failed at the native Memory
  boundary: `atomic memory update cannot change subject or predicate; create a
  new atom key and supersede the old version`. Therefore the old selected
  floor-only control-map statement is not yet corrected by that attempt.
  Operation-failure rows alone undercount failures: inspect change receipts too.
- The successful retirement receipt offers a `selection_call` for the retired
  `memory:ls20-goal-region-geometry@v2`. Source inspection confirms
  `componentReadiness` checks conflicting selected versions but not retired
  status before constructing its call. This is misleading activation guidance,
  not evidence that an invalid assembly was actually accepted. Repair should
  align the suggested call with existing eligibility, not add a new gate.
- Parent capability decisions explicitly defer Tool and Subagent based on cost
  and perceived need. No research child invocation/result is evidenced yet.
  Do not infer a broker/router failure from this absence. The current research
  guide already permits hypothesis comparison and parent-mediated experiments;
  adoption and cross-stage research quality remain unverified.

Keep the live experiment intact while observing recovery. The first completed
level and Skill use do not complete the persistent research-tracking objective.

### Readiness guidance repair (live run not restarted)

Added a native Pi regression that creates and retires a Memory and inspects the
actual change receipts. It failed because the retired version still had a
selection call. `componentReadiness` now uses the pool's existing `eligible` and
`reasons` values: ineligible entries retain provenance but have null selection
and use suggestions. No eligibility policy or new admission gate was introduced.
All five tests in `test_harness_capability_followup.py` passed (13.41 seconds).
A full pytest run was started; its result is pending and an early failure was
already observed, so do not describe the suite as green. These native tests do
not replace real ARC smoke acceptance.

PID 33472 remains live, still on action 20 at the last check. Its 13:47:47Z
change receipt repeats the atomic subject/predicate update rejection. The
readiness fix is on disk only; the live process has not been restarted and must
not be described as exercising it. Next examine the repeated Memory recovery
failure and complete the test audit, while preserving the running experiment.

### Memory wording revisions: relax textual identity admission

Compared the failed real requests with stored atoms: both update the same
control-map key, but enrich the subject description and predicate wording while
correcting passability. Exact subject/predicate equality prevents this ordinary
parent-authored revision. Removed that equality rejection; the key and version
identify the record, while each authored atom remains in the append-only history.
No semantic equivalence guess, automatic rewrite or automatic assembly is added.
Version conflict checks remain unchanged. This deliberately relaxes the earlier
identity policy rather than adding another recovery-specific admission rule.

Changed the former identity-rejection test to assert successful refinement and
exact preservation of both old/new atoms. It failed before the change and passed
afterward; the separate unaffected-atom revision test also passed (2 total).
The full entry-file run is in progress. The earlier full suite is also still
running with multiple failures; do not use historical pytest cache entries as
the authoritative failure list for that current run. Live ARC PID 33472 still
exists and has not loaded these on-disk changes. Actual ARC smoke and subsequent
real-provider exercise of this revision remain required.

### Live parent recovered without a restart

At 13:54:25Z the still-running parent successfully created
`memory:ls20-token-movement-blocking@v1` as a new key replacing the old control
map. At 13:54:47Z assembly revision 2 selected that replacement and the navigation
Skill. Canonical actions subsequently reached 23 with one completed level.
Thus the original API has a working create/supersede recovery path, although
the parent needed repeated failed updates before using it. Do not attribute
this recovery to the on-disk relaxation: the process still uses its loaded code.
Do not restart this now-progressing experiment solely to load the repair.

All 37 tests in `test_pi_harness_entry.py` passed after the wording relaxation
(75.23 seconds). Complete real-environment `arc-harness-smoke` is running under
`runs/arc-memory-revision-smoke-20260924`, using the real bridge/Pi/child pipeline
with deterministic provider responses. Its final summary is pending. The broad
pytest run is also pending with failures; neither is presently a green claim.

### Post-recovery semantic consistency audit

Actions 24/25 cite both `memory:ls20-token-movement-blocking@v1` and
`skill:arc-5x5-token-navigate@v1`, predicting 54 changed cells in the new level.
The Skill's unchanged body still hardcodes accepted=52 and blocked=2. Thus the
parent is adapting its action reasoning, but has not synchronized the stored
procedure's state-dependent parameter. This is a content/lifecycle gap, not a
reason to forbid the Skill from entering the pool. A later revision should
separate the procedure from current HUD parameters; runtime must not invent it.
The validation log contains open/superseded records but does not yet demonstrate
a completed research-child assessment. No research session artifact has appeared
at this checkpoint. Component citation and parent hypothesis tracking must not
be described as autonomous Auto-Research use or full consistency closure.

### Post-repair real-runner acceptance result

`runs/arc-memory-revision-smoke-20260924/arc-self-harness-smoke-summary.json`
reports 15/15 passing scenarios, `environment_mocked=false`,
`runtime_boundaries_mocked=false`, and `provider_mocked=true`. This exercises
the real SDK bridge, Pi parent, broker/child, structured return and routing,
five native component kinds, explicit selection, semantic Tool/Subagent output,
later parent turns/actions, and research/ordinary-delegate length continuation.
It supports wiring/lifecycle reachability after the two repairs, not real-model
research adoption, correctness of the live navigation Skill, or benchmark benefit.
Broad pytest session remains unfinished with failures; final failure audit pending.

### Broad test result and targeted failure audit

The broad run completed: 612 passed, 54 failed in 712.72 seconds. It began before
the Memory policy/test edit and collected the old identity-rejection test; the
later 37-test entry run is the relevant clean result for that changed file.
Other failures are not thereby excused. The broad failures span ARC prompt
assertions, harness/research native fixtures, OfficeBench and Shopping.

Two current-scope failures were independently rechecked:
- `test_non_blocking_planned_node_completion_updates_the_durable_plan` passed
  alone; intermittent/shared-environment sensitivity is possible, not proven.
  JUnit: `runs/test-recovery-audit-20260924.xml`.
- `test_expired_review_returns_parent_authored_direct_change_fallback` still
  fails because the returned authored candidate also has `component: skill`
  (matching its semantic_kind), while the test expects the original dictionary
  without that routing field. Its instructions are preserved. Audit the
  normalization contract before changing either code or assertion.
  JUnit: `runs/test-expired-review-audit-20260924.xml`.

Live ARC reached 35 canonical actions (35 observation rows, 35 unique indices),
still one completed level and PID 33472 alive. Actions 33/34 changed 54 cells
without completing the next level; action 35 changed zero cells. This challenges
the presumed container-entry goal/route interpretation but does not identify the
cause. Watch for parent revision and research use rather than claiming the plan
worked merely because its route was traversable.

### Recovery-test contract audit

Confirmed the expired-review fallback adds the already parent-declared carrier
as `component: skill` without modifying the authored candidate. Updated its
expected payload accordingly and additionally assert no Skill log was created
automatically. No production behavior changed in this audit.
The complete control-repair file now reports 36 passed / 2 failed (46.81s):
`test_review_prompts_require_parent_application_and_version_verification` expects
the literal prompt phrase `authoring_method_ref INSIDE`; and
`test_handoff_runtime_failure_degrades_immediately_and_releases_arc` expects
automatic `deferred/runtime_failure` but receives `proposed`. The latter overlaps
the intentional removal of automatic research-handoff deferral; inspect its
remaining action-release assertions before updating the obsolete expectation.
JUnit: `runs/test-control-repair-audit-20260924.xml`.

### Research-object routing correction from live handoff 7

The live handoff's first line promoted `capability_opportunities` to its primary
research objective even when that text explicitly deferred a route planner and
said it could not explain the blocking no-op. The parent's actual uncertainty
listed competing goal/precondition/alignment explanations. Source inspection
confirmed unconditional capability-first selection and a default capability kind.

Changed the handoff builder to prioritize the supplied `limiting_uncertainty`,
falling back to capability opportunities only when it is empty. Capability text
is still included verbatim as context, not a required deliverable. An explicit
parent research_kind is preserved; absence is marked unspecified rather than
inventing a semantic classification. No new field requirement, admission gate,
automatic start, or component creation is introduced.
Two focused tests failed against the prior builder as expected; the full review
test file is running with a durable JUnit report. The current live parent has
not loaded this change. The earlier 15/15 smoke predates this routing correction,
so renewed wiring/provider verification is still required for this change.

### Follow-up verification and communication

The review-file run completed with 15 passed / 3 failed. Both new research-object
regressions passed. Remaining named failures are
`test_review_normalization_preserves_outer_component_and_aggregates_required_fields`,
`test_review_normalization_reports_candidate_conflicts_without_guessing`, and
`test_invalid_review_draft_patch_is_revisioned_and_lossless`. Inspection shows
normalization currently does not carry those outer fields into the candidate,
and `repairReviewDraft`/`createInvalidReviewDraft` are not exports of the tested
module. These are not proved to be regressions from the priority change; neither
should they be dismissed as merely cosmetic or resolved by deleting assertions.

Started renewed full real-SDK smoke at
`runs/arc-research-priority-smoke-20260924`; final result pending.
Real-provider PID 33472 remains alive. Action 36 repeated ACTION2 with zero
changed cells; action 37 ACTION1 changed 54 cells. The latter demonstrates the
environment still accepts movement, narrowing the no-op explanation but not
proving the goal condition. No research session file appeared at that checkpoint.

Sent detailed Gmail update to the authorized recipient, message
`1a0d3c0a5001649e`, covering component contents, recovery, parameter inconsistency,
research-object routing, 15/15 prior smoke boundaries, broad-suite failures and
unproven real research adoption. Explicitly distinguished on-disk fixes from the
older code loaded by the live run. This is not a completion report.

### Research-priority smoke completed; real parent prepares but does not start child

The renewed summary at
`runs/arc-research-priority-smoke-20260924/arc-self-harness-smoke-summary.json`
passes all 15 scenarios with real SDK/environment and runtime boundaries,
deterministic parent/child providers. This verifies wiring after the priority
change; real-provider adoption remains separate.

PID 33472 is still alive. At 14:09:49Z the parent explicitly read the current
research-orchestration creator. The next observed action request instead sets
up a probe of the color-11 ring, contrasting blocking, ordinary translation and
non-translation effects. Its rationale rejects the prior descend-into-container
plan after two no-ops and a successful upward liveness probe. No auto_research
child/session is yet evidenced. Creator read is preparation, not launch; direct
parent experimentation is legitimate but does not satisfy research adoption.

### Action 40: discriminating evidence beyond the proposed outcomes

PID 33472 revalidated alive. At action 40 the token entered the color-11 ring
region and the canonical frame changed 126 cells without advancing the level.
The decision offered level advance, ordinary ~54-cell translation, or zero-cell
blocking, so none describes the complete observation.

A read-only comparison of canonical frames 39/40 attributes 50 changes to rows
15-24 cols14-18 (old/new token regions), and 76 changes to rows61-62 cols13-50.
All 76 lower-bar changes are color 3 -> 11. This is not an ordinary four-cell
bar increment. It motivates revising the counter-only interpretation and testing
whether the ring changes a resource/state, but does not itself prove a key,
teleport, resource meter or win condition. This evidence is available to parent
and eligible research readers; Codex did not inject an interpretation or action.
No child session is yet evidenced. The critical next observation is how parent
revises dependent claims and whether it uses its prepared research capability.

### Post-ring parent decision and budget interpretation gap

At approximately 22:17 Asia/Shanghai, PID 33472 remained live and the next
successful tool call was ACTION4, beginning a route to a second color-11 ring.
The parent conjectured that this second ring is the goal and the earlier box
cannot host the token because of surrounding geometry. This is a changed goal
interpretation, not established mechanics. No new successful review or child
session was visible; the 126-cell ring effect was not yet converted into a
research-backed explanation.

The action rationale says: `Action budget is unlimited, so exploration cost is
not a constraint.` This overgeneralizes the runner's disabled local action cap.
Unlimited runner steps do not establish unlimited in-game resources, harmless
actions, or zero latency/cost. Preserve `max_actions=0` semantics but inspect
parent-facing budget guidance for this distinction; do not add a cap or claim
that the lower bar is definitely an energy meter based on the current evidence.

### Budget-scope guidance clarification

Added a short budget-scope paragraph to `demo/prompts/arc_decision_cycle.md`:
runner action limits and in-game resource/cost hypotheses are distinct; unlimited
maximum removes only the local cap, and observed mechanism changes should cause
reconsideration of dependent routes. This is parent guidance, not adapter policy,
and does not name any specific game mechanic as fact or add an action limit.
The production prompt loader rendered it successfully with the game placeholder
resolved. That loading check does not prove model compliance. The latest 15/15
smoke predates this wording-only clarification. Live PID 33472 has not been
restarted; it reached action 41 at this checkpoint. Behavioral verification of
the new guidance remains pending, as does actual research-child adoption.

### Second real Skill authored after the ring probe

At 14:23:50Z the live parent successfully created `skill:slot-route-planner@v1`
and `memory:ls20-fuel-bar@v1`, following its 14:19:19Z skill-creator read.
This is a new procedure, not a revision of the earlier navigation Skill:
expand runs, localize the token, derive a slot lattice, classify destinations,
breadth-first search, compare route length against the hypothesized bar model,
emit actions/signatures and stop or reparse on unexpected effects. It carries
observations 21-40 as provenance and a labeled single-situation worked example.

Quality is mixed, not automatically validated: its input paragraph says to
treat non-blocking colors as accepted until disproved, while step 4 correctly
calls unseen colors unknown; these instructions conflict. Its bar-as-fuel and
refill interpretations remain agent hypotheses. Its worked route goes from
(15,19) via the upper band and right corridor to (50,39), but claims a pickup
at (15,14) lies on the way, although that written route never visits it.
Thus this satisfies actual method conversion but not demonstrated path accuracy
or robust consistency. Do not silently repair the live authored artifact.
At this checkpoint assembly revision 3 still selects the old navigation Skill
and earlier memories; new Skill pool creation is not yet selection or use.

At 14:26:01Z the parent committed assembly revision 4, selecting the new
`skill:slot-route-planner@v1` and `memory:ls20-fuel-bar@v1` alongside the old
navigation Skill and corrected movement Memory. A subsequent skill-context-index
observation confirms exposure. The latest action was still 41, whose decision
predates the new selection; do not count that action or index projection as
actual use of the planner. The planner-content caveats above remain unresolved.
Detailed second-Skill email was sent as message `1a0d3ceb23c45db0`.

Actions 42 and 43 subsequently cite `skill:slot-route-planner@v1` together with
the fuel Memory, movement Memory and earlier navigation Skill. Both predict
54 changed cells and the canonical bridge reports 54. A direct signature scan
of the canonical frames locates the unique 12-over-9 5x5 token at top-left
(10,19) after action 42 and (10,24) after action 43, matching the stated positions.
This proves action-linked declared use plus two correct local predictions; it
does not prove BFS was actually executed, full-route correctness, refueling
semantics, independent research validation or causal performance benefit.
PID 33472 remains live with one completed level and no research session artifact
at this checkpoint.

### Action 45: count matches but predicted position is stale

Do not extend the prior correct-prediction claim blindly. Action 45 again predicts
columns24-28 -> 29-33, duplicating action44. Canonical signature scans show
action44 at top-left (10,29), then action45 at (10,34). Both have 54 changed cells,
so count-only assessment would falsely endorse the stale position prediction.
The pre-action snapshot `parent-state-45` records total_used=44 and the current
frame, not a reused action43 state. This narrows the issue toward consumption/
reasoning or prompt projection, but snapshot correctness alone does not prove
the exact provider-visible rendering. Inspect that path before changing it.
PID 33472 is still live; no forced restart or live artifact correction performed.

Follow-up projection audit: the 14:30:57 provider-payload telemetry records an ARC
observation module and an estimated 66,481 total input tokens (estimate, not billed
usage). It retains about 74,808 assistant string characters. The ARC start hook
renders currentFrame from the same currentState used for the immutable snapshot.
However telemetry saves size statistics, not complete provider-wire text, so
these observations cannot conclusively distinguish prompt projection error from
stale reasoning under context load. Do not claim a proven compaction root cause
or change compression policy solely from this correlation. Deferred backlog D
remains relevant and unfulfilled.

### Delayed review rejects real newer evidence

At 14:47:03Z review of harness-opportunity-10 (actions46-50, baseline45) failed
transition evidence validation. Window refs46-50 are valid; the additional refs
40/41/44/45/52 also exist, but observation52 postdates the original window.
Source inspection finds the facade builds historical refs only from observations
up through the last window ref (`slice(0,end+1)`). Thus an asynchronous/delayed
review cannot incorporate evidence already acquired after its window, although
that evidence is real at submission time. This is not a fabricated-reference
failure. Next fix should retain window membership and permit other already
recorded observations as contextual evidence, without permitting nonexistent
future refs or inventing semantic conclusions. Live run stays intact.

Implemented the delayed-review repair: the facade now builds contextual evidence
refs from all observations recorded at submission, while the original window's
allowed refs remain unchanged. Added native regressions for seven recorded
actions followed by review of the five-action window: observation7 is accepted
and classified outside the window; nonexistent observation99 is still rejected.
The acceptance case failed before the repair; both cases plus five capability
follow-up tests passed afterward (7 total, 16.98s). JUnit:
`runs/test-late-evidence-green-20260924.xml`.
Started complete real-SDK smoke at `runs/arc-late-evidence-smoke-20260924`;
result pending. Live PID33472 reached action54, one completed level, no child
session artifact. It still runs its originally loaded code and was not restarted.

### Action 55: marker probe changes a second region

Live PID33472 reached action55 without another level completion. Parent predicted
54 changes when entering the 0/1 glyph slot, with a falsifier for other changed
regions. Actual delta is 62: 50 cells in rows40-49 cols49-53 (token translation),
4 bar cells at rows61-62 cols41-42 (11->3), and 8 additional cells at rows55/56/59/60
cols5-6. Those eight toggle between colors5 and9. This explicitly falls outside
the proposed movement/bar-only model. It does not by itself prove pickup,
rotation, a goal-state switch or another particular interpretation. Main's
dependent state/goal model needs reconsideration; preserve this as a falsifying
observation, not a positive skill score because the token moved successfully.
The latest delayed-review smoke is still running; no research session artifact
appeared in the live run at this check.

### 22:58–23:02 local follow-up: use versus research adoption

The delayed-review smoke has now completed: summary reports `passed=true`,
`environment_mocked=false`, `provider_mocked=true`. This is deterministic-provider
wiring evidence, not autonomous research quality or game-performance acceptance.
Live PID33472 remains present. Canonical action56 records NOT_FINISHED and one
completed level. Its decision explicitly cites slot-route-planner@v1 and two
Memories, predicts a downward move, and proposes two left moves to test the ring.
Both authored Skills remain version1 and assembly revision4 selects both.

All eleven recorded research handoffs remain proposed v1 with no session_ref.
Searching Pi events for auto_research text also matches tool descriptions nested
inside task_harness inspect results; those matches are not research executions.
The operation-failure ledger contains six task_harness failures, not evidence of
an Auto-Research launch being rejected. Thus current evidence supports a gap
before child launch, not a demonstrated child/provider failure. Creator reading
alone does not prove a start attempt. Preserve the live run; do not restart or
introduce compulsory research gates based on this absence. The current on-disk
handoff priority repair still needs a new real-provider run to assess adoption.

### Action57: procedural citation does not establish constraint compliance

At 15:01:20Z action57 cites slot-route-planner@v1 and both selected Memories.
The parent proposes a new `level1-key-unlocks-plate` hypothesis: the glyph at
action55 unlocked the plate; the ring refills a 42-column bar consumed at two
columns per action. It plans a 23-step route after refilling (right2, up8, left7,
down5, then entry). Under its own capacity hypothesis, a full bar permits only
21 accepted actions. The plan does not name an intermediate refill or explain
this mismatch. Neither the key-unlock interpretation nor capacity is established
environment truth. This is an internal conditional planning contradiction, not
proof the game makes the route impossible.

The selected Skill explicitly compares path length with remaining columns/2
(step5) and reports infeasibility when budget is below remaining length (step7).
Thus a matching basis_ref demonstrates attribution but not procedural compliance.
Next evidence should check whether ring entry causes the parent to recompute
the dependent route and revise unsupported goal/key claims. Do not add a runtime
semantic gate, rewrite live authored components, or award positive method credit
solely because action57 moved successfully (54 changed cells, still one level).
PID33472 was revalidated alive after a 45-second wait; action58 had not arrived.

Gmail update on conversion/use and unresolved research adoption was sent to the
authorized recipient at 23:00 local; message id `1a0d3ef927bb846e`. This predates
the action57 planning contradiction; reserve another email for a substantive
experiment result rather than duplicate unchanged progress notifications.

Action58 arrived by 23:05 local: 118 changed cells, still NOT_FINISHED with one
level complete. Canonical delta has 50 translation-region cells (rows50-54,
cols39-48) and 68 bar cells (rows61-62, cols13-46) becoming color11. This matches
the parent's predicted refill-like change and no level advance; it supports that
local prediction, not the untested plate-goal/key-unlock interpretation or the
terminal consequence of exhausting the bar. The planned return still describes
the long outer route and provides no explicit intermediate refill. Check the
following real parent turn for a revised resource-feasible plan.

### Research entry visibility audit

The live run's task-harness-entry receipt at 13:12:49.29Z explicitly lists
`task_harness`, `auto_research`, and `arc_action` as active tools with zero initial
resources. This rules out absence of the research entry at initialization.
Current source's compact ARC initialization includes auto_research directly;
the arc_action-only hook is control-variant-only. Do not mistake that hook for
treatment suppression. Later provider telemetry at 15:03:48.729Z reports four
tool definitions and a research module (two items, estimated 2,911 tokens), but
does not retain the exact tool names/payload. It is not proof of every later
provider-visible schema. The same request retains approximately 101,383 assistant
string characters; context load may matter, but is not a demonstrated cause of
research non-adoption. No new admission condition or automatic child launch was
introduced by this audit.

### Provider length recovery at 23:08–23:09 local

New authoritative telemetry records treatment-provider-99 ending with `length`
at 15:08:11.525Z, output usage65536. Runner emits normal -> compact_recovery,
creates a fresh in-memory Pi session (not a new ARC game), and the entry receipt
at 15:08:11.713Z again lists task_harness/auto_research/arc_action, restoring two
Skills and ten Memory ledger records (not ten distinct active Memories).
The next provider response ends toolUse; action59 executes ACTION4,54 changes,
NOT_FINISHED,one completed level. Recovery then returns to normal with arc_action
true and auto_research false. This is real-provider parent recovery evidence;
it is not child length-continuation acceptance. The long provider elapsed-time
field spans other observed actions and must not be treated as isolated time
since action58 without auditing instrumentation.

Action59 cites both Skills and both selected Memories, interprets action58 as
refill, and still proposes right2/up8/left7/down6 (23 steps from the ring).
It does not reconcile the previously stated21-step capacity. The initial exit
may be locally reasonable, but it does not validate the complete plan. This
narrows the remaining issue to procedural adherence/dependent planning, despite
successful persistence and session recovery. No external live-resource edit,
forced research invocation, ARC restart or new admission gate was performed.

### Action60: resource failure becomes an explicit experimental alternative

At 15:11:04Z action60 succeeds (54 changed cells, one completed level). Its
validation_window now explicitly allows either reaching the plate or the bar
emptying first, described as discriminating the fuel-as-life hypothesis. Revise
the earlier critique accordingly: the latest decision does not wholly ignore
exhaustion, but reframes the long route as a probe. It still does not explain why
this probe's cost/consequences are preferable or revise the selected Skill.

A read-only BFS over the public action60 frame independently finds shortest
distance21 from token top-left(50,49) to hypothesized plate slot(40,14), assuming
5-cell cardinal movement and any 5x5 destination without color4 is traversable.
It reaches56 candidate slots. This supports the parent's geometric route length
(up8,left7,down6) under that model; it does not prove passability, unlocking, goal
identity or dynamic feasibility. The parent's reported38 remaining columns at
2/action imply19 actions, still two short under the resource hypothesis. Treat
this as a conditional planning/evaluation case, not proof that a shorter valid
route exists or that the run must fail. No private game implementation was read,
and this independent calculation was not injected into the live parent context.

### Second length stop and repeated glyph transition

At 15:15:43.406Z treatment-provider-3 ends length with output65536 after action60.
The runner again performs compact recovery, not a game reset. Action61 then
executes ACTION1 with62 changed cells and no additional level completion;
recovery returns normal with auto_research=false. Parent explicitly reads38 bar
columns as19 actions and says the climb must be checked; it still describes the
full21-step route and speculates the glyph may change fuel or unlock the plate.
It narrows/replaces the validation window to eight ascent actions (hypothesis v2).
That is not an assessment of the previous resource-exhaustion hypothesis.

Action61's additional eight changes are rows57-58 cols3-4 becoming9 and cols7-8
becoming5, outside the glyph region named in its prediction. Recontact therefore
provides new evidence relevant to a reusable interaction/state-change model,
without establishing pickup, rotation or unlock semantics. Compare to action55's
distinct eight-cell panel change before endorsing a one-time key explanation.

The event compactor intentionally removes assistant content and retains role,
stopReason/errorMessage/usage/provider/model/api/timestamp. Telemetry also records
sizes rather than the completed full output. Hence repeated length stops are
proven, but their internal semantic cause (planning loops versus component
authoring/repair) is not recoverable from those records alone. Do not invent that
cause or add admission gates as a supposed fix. Both recovery actions demonstrate
liveness, not research adoption or coherent higher-level hypothesis revision.

### Action62: explicit deficit, new refill dependency, superseded tests

At 15:18:51Z action62 advances normally (54 changed cells, still one level).
Parent now explicitly calculates20 remaining steps versus18 estimated actions
and proposes that the corridor ring consumed at observation40 might respawn on
the descent. This is a meaningful revision of the prior omission: do not continue
to claim the arithmetic deficit is unnoticed. Public frame62 rows15-19 cols14-18
are all color3, so there is no visible ring there currently. Future respawn remains
an untested dependency, not an established refueling plan.

The durable validation ledger shows plate-route v1 superseded after action60,
v2 superseded after action61, and v3 open at action62. Supersession preserves
history but is not a verdict on either exhaustion or glyph/goal semantics.
Version3's19-action window also accompanies text claiming20 further actions;
that mismatch deserves interpretation at expiry, not a new admission rejection.
The method/constraint investigation should distinguish mechanical continuity
(working) from explicit evaluation of displaced claims (not evidenced). No new
Skill version or child-research artifact was present at this checkpoint.

### Action63: parent rejects respawn reliance and resets the attempt

Action63 is RESET chosen by the real parent, not an operator/process restart.
Its rationale now notes that no ring has respawned, compares19 route actions to
17 estimated remaining, and proposes a fresh17-action direct route. Canonical
result has98 changed cells, NOT_FINISHED, levels_completed1, full_reset=false;
token signature scan gives top-left(40,29) and every bar cell on row61 cols13-54
is color11. This supports local attempt/resource restoration while preserving
completed-level progress. It does not prove RESET universally safe or confirm
the asserted glyph-refuel mechanism (the earlier glyph observations did not
show a refill). The shorter fresh route and plate-goal interpretation remain
prospective. Review the prior critique fairly: the parent has now adapted its
resource-dependent plan without researcher involvement. Persistent Skill
revision, semantic hypothesis assessment and Auto-Research adoption remain absent
at this checkpoint. Preserve this same live game history and process.

### Action64: revised multi-stage plan includes an intermediate refill

At 15:23:32Z parent chooses ACTION4 after RESET (54 changes, one level completed).
Contrary to its action63 prospective direct-to-plate plan, it now proposes17 moves
to the glyph/switch,3 to the right ring, then23 toward the plate with a restored
corridor-ring pickup on that return. This explicitly supplies the intermediate
refill missing in the earlier long-route plan. Under its movement/resource
assumptions, reaching the first refill in20 actions fits21; the return crosses
the corridor-ring slot before completing the23-action route. This is a better
conditional composition, not confirmation that the glyph unlocks the plate or
that pickups behave as assumed. First ACTION4 is common to both possible routes
and does not by itself discriminate them. The parent is adapting its plan;
do not claim it is permanently stuck on the earlier arithmetic contradiction.
Both Skills are still v1, and no child research or new persisted method was
recorded. The remaining question is whether these revisions become evaluated,
reusable procedures/research knowledge rather than only changing action prose.

### Missing persistence when a validation window is not redeclared

Action65 keeps the same hypothesis id but omits validation_window. Source audit
finds that the runner advances an existing window in memory on this path but
only writes an event if it expires. In contrast, repeated explicit declarations
write progress. Therefore an unchanged window file does not prove lack of
in-memory tracking, but its durable evidence is incomplete before expiry.

Added a diagnostic runner regression with mocked external kernel/bridge: action1
opens a five-action window, action2 omits its declaration, then the environment
ends. It failed because the last durable status stayed open instead of progress.
The minimal repair appends the same progress event used by the explicit-declaration
branch, preserving accumulated evidence and inventing no semantic verdict.
Four focused tests passed after repair. Full pytest started with JUnit target
`runs/test-window-progress-audit-20260924.xml`, session8152; pending and already
showing at least one failure. No whole-suite or real-ARC closure claim is made.
This is a persistence fix, not a research-adoption fix or new admission mechanism.
Live PID33472 reached67 actions, one completed level; it has not reloaded the
Python runner repair and was not restarted.

Follow-up verification: the full ARC runner test file completed68 passed/1 failed.
Failure is `test_real_arc_auto_research_validation_prompt_requires_evidence_backed_five_component_use`,
whose first assertion expects literal `route receipt` in the validation prompt.
Report: `runs/test-window-progress-focused-20260924.xml`. Do not rewrite the prompt
solely to satisfy this text assertion or call the file green. Broader pytest8152
is still running and has additional failures pending its final report.

### Review12 repeats the old research-object routing defect

The live parent submitted review12 at15:28:34Z for consolidation window41-60,
choosing reuse of slot-route-planner@v1 (other components are runtime placeholders,
not explicit parent rejections). Its limiting uncertainty is container-entry
refusal. Yet the generated handoff's research_problem.statement is the capability
remark `Covered: skill:slot-route-planner@v1 handles the route planning; no new
carrier needed from this window.` This is direct recurrence of the already-fixed
capability-first routing in the old loaded process; current source prioritizes
limiting_uncertainty and must be evaluated separately in a new real-provider run.
The handoff remains proposed with no session. Review text also overgeneralizes
accepted steps as54 changes while citing action55 (62); creation/reuse receipts
must not be mistaken for content validation. Action68 continues a newly revised
ring-then-box route, not the switch-first route proposed at64. Hypothesis selection
is changing, but persistent method revision and child research remain unobserved.

Started current-code real-SDK `arc-harness-smoke` (no mock-environment flag) at
`runs/arc-window-progress-smoke-20260924`, tool session86776. It is independent
of live game PID33472 and uses deterministic providers. Results pending; do not
infer the omitted-window regression is specifically exercised by its general
matrix. Full pytest8152 is also still running, past53% with failures; final JUnit
will be authoritative. Live game reached action70, one completed level. Parent
again chooses key/switch-then-box with two refill legs; this is changing planning
prose, not a new Skill version or a research result. Preserve both distinctions.

Current-code smoke86776 completed exit0 by23:37 local. Authoritative summary
`runs/arc-window-progress-smoke-20260924/arc-self-harness-smoke-summary.json`
reports passed=true,15 scenarios, environment_mocked=false,provider_mocked=true,
runtime_boundaries_mocked=false. This confirms general wiring/lifecycle regression
coverage on the current code, not autonomous provider research adoption or the
specific omitted-window branch (covered by the red/green runner regression).
Broad pytest8152 remains running beyond75%, with failures; not all-green.
Live PID33472 remains present at71 actions,one completed level.

### Review13: method opportunity recognized, deferred; new scoped Memory admitted

At15:38:19Z review13 identifies repeated refill-order and switch-entry mistakes,
proposes a pickup/switch-entry-count/refill-order post-pass for slot-route-planner,
but defers authoring until route predictions are checked. This is an explicit
parent timing choice, not evidence of a rejected Skill. A new Memory
`ls20-level1-door-switch-route@v1` actually commits active with validity.scope=level
and instance_ref ending `reset:execution-observation-63:level-initial`. Thus RESET
did advance the native memory lifecycle even though the bridge says full_reset=false.
Assembly remains revision4 and does not select the new Memory at this checkpoint.

Content quality is mixed: the Memory bundles exit identity, switch hypotheses,
refill size and route ordering in one atom; exit identity is stated as a fact
although unproven. Review says action61's panel change is identical to55, while
canonical changed positions differ; it describes12 logo cells by conflating the
eight panel cells with four bar cells. Skill update remains prospective, and the
research handoff remains proposed/no session. This demonstrates permissive
conversion, not validated content or actual research. Preserve trace and audit
these claims after use rather than adding admission restrictions.

Full pytest8152 completed:619 passed,51 failed,715.37s. Exact failure names and
message excerpts are recorded in `2026-09-24-window-progress-test-audit.md` beside
this file; authoritative JUnit is `runs/test-window-progress-audit-20260924.xml`.
The failures span old literal/contract expectations, lifecycle/projection and
normalization behavior, and Shopping interpreter startup errors. They are not all
diagnosed or excused as obsolete. Live PID33472 reached73 actions,one completed
level; assembly stays revision4 (new door-switch Memory still not selected).

### Current-code autonomous real-provider experiment

At23:45:24 local launched a separate unlimited real-provider ARC run at
`runs/arc-hypothesis-current-20260924/run`, PID89352. Existing PID33472 is preserved;
this is not a restart caused by slowness. Rationale: the old loaded handoff router
cannot validate the corrected uncertainty-first selection or later persistence
repairs. New run uses ls20/treatment/context-compaction/max-actions0/no Jev,
ordinary autonomous prompt, no forced research/component creation, independent
bridge port62107 (bridge PID89916). Startup receipt confirms zero components and
active task_harness/auto_research/arc_action. First two actual actions complete,
NOT_FINISHED,zero levels; both action limits null. Do not mix histories or infer
performance causality from this unmatched pair.

Launch-time SHA256 snapshots:
- arc_agi_3_e2e.py: E783EBAC38D3E4DA7DFE3496D617D17F468DCAC726303C390C304DDAF0A09E66
- pi_auto_research_handoff.ts: AD4DAE0D4052DDB671EDE6C232CA59F39F948F8037BA6B257F3AD0F60C6FC001
- pi_task_local_self_harness.ts: F12A4F2DC261163E6ED719FC283D382C0D823B47DBA04D3509DE4CE378D18E3B

Next evidence: actual uncertainty-first handoff content, parent start/resume,
child results and subsequent parent decisions, component revision/use quality,
and durable window progress without repeated declarations. None is proven by
successful startup. Latest substantive Gmail report: `1a0d4152a99afe29`.

23:49 local checkpoint: new PID89352 reaches5 actions/zero levels and opens a
one-action ls20-walkable-regions window that records awaiting_assessment; no
research session or authored component yet. Old PID33472 reaches80 actions/one
level, entering the glyph slot again (62 changes). Its next_step returns via the
c49-53 shaft, which would cross the glyph slot again, despite the recent pooled
door-switch Memory advising single entry. That Memory was not selected at last
assembly check. This is a concrete adoption/plan-consistency question, not evidence
that component persistence failed; parity remains unproven. The same next_step
claims six upward moves from rows50-54 reach rows10-14 (eight would be needed),
so continue checking exact positions rather than accepting a route citation as
correct computation. Both process handles were verified live; histories separate.

### New run: uncertainty-first handoff observed with real provider

At15:50:29Z current-code run commits review1. Its capability_opportunities names
a delta-based controllable-object probe method and action-map fact; its distinct
limiting_uncertainty asks whether covering the0/1 marker completes the level and
whether marker cells block movement. Handoff1 actually selects the latter as
research_problem.statement with kind=unspecified, confirming the routing repair
on autonomous real-provider input. Status remains proposed/no child session;
do not inflate this into research-start or research-quality acceptance.

The initial review failed at15:50:11Z with `memory candidate requires a stable key
or name in addition to atom and validity`. Parent supplied a name on retry and
committed ls20_action_direction_map@v1,task-scoped, with ACTION1/up,2/down,3/left,
4/right and five-cell translation. This is a real recoverable authoring error,
not an admission rejection for weak evidence. No Skill yet despite the named
method opportunity. Live run reached10 actions/zero completed levels by this
inspection. Existing windows are often explicitly replaced, so the omitted-window
persistence fix has not yet been demonstrated by these particular live records.

### New run: explicit local-use assessment and changed goal hypothesis

At15:53:47Z parent calls task_harness assess_effect, producing effect-assessment-1
for decision-1 and memory:ls20_action_direction_map@v1 with actual_use_refs8-11.
It supports the observed up-translation rule, explicitly notes marker coverage
did not advance the level, and retains uncertainty about the top box/corridor
and the apparently capped bottom bar. Receipt scope is observed_use_only_not_general_truth.
This is actual parent-led evaluation of the Memory's cited use, not a child
research result or proof of explicit assembly (none recorded at this checkpoint).
Action12 then tests whether the panel changes again after leaving the marker,
contrasting positional versus one-shot interpretations. Parent assessment is now
observed; avoid the earlier blanket statement that no semantic evaluation occurs.
Research handoffs remain proposed, and no authored Skill or child session yet.

### 2026-09-25: event projection drops delta evidence

Current-code run's action15 bridge records52 changed cells, but the research
window records null. Raw Pi tool result details include observation_delta with
changed_cells52 and bbox; `_project_arc_kernel_event` discarded that whole field
before the runner's window consumer. Thus neither absence of a delta nor parent
failure to cite it explains the null. Added parameterized regressions for52 and0
changes, null/non-null bbox, and a large cells payload: both failed with missing
observation_delta before repair. The projection now retains only changed_cells,
bbox,frame_available, never the large cells array. Eight focused projection/window
tests pass after repair. This also repairs the source of missing changed-cell/bbox
evidence in compact recovery notices; no semantic verdict or admission rule added.

Full pytest started as tool session98162 with JUnit target
`runs/test-delta-projection-audit-20260925.xml`; pending, already showing a failure.
The prior15/15 smoke predates this latest patch, so it is not post-patch acceptance.
Live new PID89352 at15 actions/zero levels and old PID33472 at89/one level remain
running their loaded Python code; neither was restarted or has loaded this fix.

Smoke coverage audit: `arc_harness_smoke.py` currently does not assert research
validation-window changed_cells, and `tools/arc_harness_smoke_provider.ts` does
not declare validation_window. Thus the previous smoke could pass while compact
delta evidence was missing. Next acceptance improvement should declare a window
across real parent actions and compare its recorded delta count/bbox to canonical
bridge events, keeping existing component and length-continuation checks. This
is a test coverage gap, not evidence that current patch has already passed it.
Full pytest98162 remains live with failures; no completed post-patch suite yet.

### Delta continuity covered by real-SDK smoke

Added a three-action declared window to the base Skill smoke's first action;
the second real parent action deliberately omits validation_window. The validator
now requires a durable progress record with evidence indices1,2 and numeric
changed-cell counts equal to their canonical bridge actions. Old smoke artifacts
fail this new check. Current-code targeted `--case skills` at
`runs/arc-delta-evidence-smoke-20260925` completed exit0/passed=true, real SDK and
runtime boundaries, deterministic provider. The existing research child/return,
parent authoring/assembly/later-turn checks also pass in this case. A read-only
mutation of loaded window counts to null makes the new check fail, confirming it
detects the observed regression without modifying stored artifacts. This is one
post-patch scenario, not a fresh15-scenario matrix or autonomous adoption claim.
Full pytest98162 is still running. Real new PID89352 reached18 actions and one
completed level; old PID33472 reached92 actions,one level. No external restart.
