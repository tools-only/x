# Goal-directed Self-Harness evolution

Status: core implementation landed; real-provider ARC remains running with
autonomous assembly/feedback acceptance incomplete. Final evidence and full-suite
failure inventory: `../reports/goal-evolution-verification-2026-09-26.md`.
Owner split: SOL
implements; Luna independently validates and runs ARC; root reviews design,
evidence and progress communication. Work stays on the current branch.

Detailed design and independent code review are by Astra, explicitly requested
by the user: `2026-09-25-astra-goal-evolution-design.md`. Its HTML with a Chinese
overview was emailed as message `1a0d91c11e293f1a`.

### 23:25 implementation checkpoint

SOL froze implementation for verification: cumulative task checkpoint fields and
active update tool, journal-aware parent/inspect/default-child projection,
per-operation development intents surviving unrelated carrier decisions and
failed/sparse retry, competing research agendas, optional component validity,
and repeated assessment selection. Astra's final bounded read-only review found
no remaining blocker in the inspected P0/agenda/compound paths. That is not
provider behavior acceptance.

Luna's assessment diagnostics pass; primary context/intent diagnostics are under
final fixture repair. Fresh full real-SDK smoke started under
`runs/arc-goal-evolution-smoke-20260925`; result pending. FT09 availability was
verified through the official SDK game listing. Real-provider run is planned
after smoke validation with no Jev/local action caps and ordinary task prompt.
The existing runner has a 12-hour PiKernel upper bound even when no experiment
timeout is supplied. Historical generic timeouts cannot be attributed to that
bound: their elapsed times were shorter; exact lower-level source is unproven.

### 23:30 verification checkpoint

Luna reports eight targeted P0 regressions passing: independent operation
intents, failed-draft retention, non-periodic review, assessment selection,
compound start without prior reports, and default child cumulative context.
The first new full real-SDK smoke at `arc-goal-evolution-smoke-20260925` passed
15/15. It remains a diagnostic because final Tool/Subagent use-boundary validity
checks landed while that matrix was running. SOL has frozen those final changes;
Luna will run a fresh final matrix before the real-provider FT09 launch.
No autonomous higher-order component trace is claimed yet.

### 23:34 final integration matrix

Root independently read
`runs/arc-goal-evolution-smoke-final-20260925/arc-self-harness-smoke-summary.json`:
passed=true, 15 scenarios, environment_mocked=false, provider_mocked=true.
This is the post-freeze matrix after invocation-scope checks. Luna has been
instructed to launch the authorized ordinary FT09 real-provider run next.
The matrix proves runtime wiring, not natural high-order method formation.

### 23:43 real-provider checkpoint

Luna launched the ordinary FT09 run at 23:37:23 +08:00, after the final matrix:
`runs/arc-goal-evolution-ft09-20260925`, game `ft09-0d8bbf25`, provider `yibu`,
model `a:deepseek-v4-flash`, no Jev and `--max-actions 0` (no local action cap).
Parent PID 56956 and bridge PID 44332 were independently confirmed alive.
The existing 12-hour PiKernel upper bound still applies.

By checkpoint revision 7, five real actions were recorded. The parent used the
newly exposed `task_checkpoint`, authored task goal/constraints/strategy and
began discriminating click behavior, then proposed a glyph/tile consistency
objective. These are parent interpretations, not established game semantics.
Memory candidates exist; no Skill/Tool/Subagent or higher-order method-use trace
has yet been verified. Provider telemetry confirms `task_checkpoint` in the
actual five-tool request surface, alongside `task_harness` and `auto_research`.

A real `level_review` call failed with `Harness use_stage required`; SOL is
checking the contract/guidance mismatch before any runtime change. Separately,
the new invocation-scope diagnostic currently fails because its restarted
fixture cannot find the already-expired Tool; Luna is checking a same-runtime
transition fixture rather than weakening the acceptance claim. Neither finding
justifies silently restarting the live environment.

The broader lifecycle diagnostic remains 10 passed / 8 failed. The failing test
names also occur in the prior baseline, but only one exact assertion was compared;
this is not a clean full-suite result or a complete diagnosis of those failures.

Stage update emailed to the authorized recipient as message
`1a0d93cda08b2591`. At 23:44 the real environment reported one completed level
after seven actions; the eighth action probed the next level. Review 1 identifies
a geometry-first click procedure but explicitly postpones a Skill until another
level. That postponement is a model judgment, not a runtime admission rule. Its
next-level follow-through remains to be observed.

### 23:56 diagnostic follow-through (not autonomous acceptance)

The same-runtime lifecycle diagnostic was repaired without changing production
behavior: before the level transition the selected Tool returns
`{"state":"current"}`; afterward its invocation reports scope expiration,
the saved level Subagent is blocked, and the task Skill remains eligible and
focusable. Root independently reran this diagnostic successfully and the whole
capability-followup file (8 passed).

SOL reproduced and fixed two level-review issues in the next-launch code:
uncertain/negative credit may omit an unknown use stage without claiming use;
positive attribution still needs actual application. Explicit `window_id` now
binds operation identity, so correcting credit content resolves the same window's
failure instead of leaving a ghost pending operation. Node tests: 6 passed;
focused Python regressions: 2 passed. Root independently reran the Node tests.
The live parent has not been restarted and does not retroactively receive this
patch. A separate malformed batch `change` call omitted `semantic_kind`; parent
corrected it successfully, but its changed-input failure remains pending under
the existing unbound operation identity. This residual is being diagnosed, not
treated as solved by the level-review patch.

A fresh full pytest run is in progress with XML destination
`runs/goal-evolution-full-20260925.xml`. Existing failures are visible; no clean
suite claim is made. Real-run review 2 now recognizes the procedure across the
second level but submitted only Memory; omitted Skill retains its unresolved
carrier status. Autonomous creation/selection/use remains an open acceptance item.

### 23:59 Astra behavioral audit

Creator access is not dangling: the real parent successfully read `skill-creator`
at 15:45:33Z and again at 15:56:29Z. Root independently found both calls and the
baseline-method-read record. Review 2's method remains in the parent followup;
no `development_intent` was explicitly submitted, so there is no evidence that
an authored intent was erased. The checkpoint now considers overlapping versus
stacked panels and a discriminating completion test. Correcting a misread factual
map is a reasonable immediate task priority.

Astra recommends observing the next substantive decision before changing
behavioral guidance. If postponement persists after the parent's own stated
reconsideration condition is met, a small process reminder can ask it to revisit
that decision, author a provisional method or explain an updated operation-specific
cost/gap. This must not become automatic runtime triggering, forced creation,
mandatory research or a component quota. No such extra prompt change has been
applied to the running experiment.

The batch-error pending-state residual is real: whole-input hashing cannot match
the corrected `change` call. Exact batch-target reconciliation requires additional
care when the original kind was omitted; no guessed semantic identity or manual
deletion of the failure log was introduced in this run.

### 00:04 real-provider method emergence

The real parent created `skill:ft09-glyph-panel-solve@v1` at 23:58:08 +08:00
through the recorded skill-creator method. Its eight-step body derives tile bands,
locates glyphs, constructs possibly overlapping panels, chooses this level's
palette, unions mismatch constraints, clicks and verifies, and branches when
completion fails. This is a goal-directed procedure rather than an observation
recap. Actions 13-15 cite its exact version; review 3 explicitly chooses reuse.

Important open boundary: the creation receipt says `current_assembly:null` and
supplies exact `assemble` then `focus` calls, but neither was found at this
checkpoint. Therefore this is creation into the candidate pool plus later cited
use, not completed native assembly/loading acceptance. Semantic claims in the
candidate (glyph centering, palette assumptions, 36-cell delta versus simultaneous
counter changes) remain provisional. There is no completed Auto-Research run yet.
The full Skill text and these limitations were emailed as message
`1a0d94de26dec3d9`.

After the level-review repair, a further isolated real-SDK smoke at
`runs/arc-goal-evolution-smoke-repair-20260926/arc-self-harness-smoke-summary.json`
passed all 15 scenarios. Root verified provider_mocked=true,
environment_mocked=false, runtime_boundaries_mocked=false. This does not upgrade
the ordinary live run's incomplete assembly/feedback evidence.

## User requirements

1. Persistent Harness categories are system_prompt, Skill, Pi Tool, Subagent and
   Memory. Review, assessment, research agenda, hypothesis tracking and operation
   follow-ups are runtime/research records, never additional Harness components.
   task_prompt is an assembly output channel.
2. Conversion must support task-solving progression: early control/observation
   methods, then composition with task goals, constraints, terrain and mechanisms
   into planning/strategy methods, then refinement from trials and competing
   research. These are reasoning opportunities, not compulsory sequential phases.
3. Scope follows authored content. A method locating objects from pixel deltas
   may live for the whole game task. A map or route dependent on level geometry
   expires with its level. The rule applies beyond Memory.
4. Preserve easy trial: no category quotas, cross-game generalization requirement,
   complete method dossier, mandatory prior research, or semantic confidence gate.
5. Parent authors via matching creators, selects exact versions and owns all ARC
   actions. Child research returns read-only evidence, alternatives and requests.
   Runtime persists/routes/projects/executes explicit declarations.
6. Use SOL for implementation, Luna for verification and real ARC. Email concrete
   stage results to 595819371@qq.com.

## Design

### Keep the target task visible during conversion

Use existing checkpoint, review and research records to expose parent-authored:
current task objective, candidate success conditions, constraints, tested local
rules, viable strategy alternatives, the current limiting uncertainty, and the
next operation worth developing. Do not create a new goal/strategy Harness kind.
Do not have code infer semantics from changed-cell counts or trajectory prose.

The development process asks which operation connects current knowledge to the
task objective. It supports composing existing components and evidence into a
planning, exploration, feasibility-checking or recovery method. Local factual
storage does not by itself resolve an explicitly selected development objective.
The parent can decline/defer with its reason; runtime never forces a resource
count or invents the deferred procedure.

An uncertain method can include probe, alternative, stop and revision branches.
It can be created before its premise is validated. Evaluations refine scope and
claims after use. A worked example or task parameter is allowed; a trajectory
recap by itself is not an executable Skill.

### Competing research

Research can investigate competing mechanisms or strategies at the same time or
in sequence under the existing compute budget. Questions must retain their own
line identity and prior evidence; one latest agenda summary must not silently
erase another live alternative. Parent selects the question and whether to use
its results. No automatic research start or environment action is introduced.

Inspect the current compound-research admission rule: a planning/solution
question labelled compound must not be rejected merely because no earlier
research result or mandatory decomposition exists. Decomposition is guidance
unless actually required by execution dependencies or resource limits.

### Scope by content

Reuse public task/episode/level/state instance binding. Add optional lifecycle
validity to non-Memory components through authoring, persistence, resource
metadata, pool eligibility, assembly, Skill load, Tool/Subagent invocation and
context projection. A missing new field on old components must not suddenly
reject them; retain compatible task-local behavior and disclose provenance.

Memory keeps its existing explicit scope contract. Text applicability and
mechanical lifetime remain distinct: runtime can enforce a declared level
instance, but cannot judge whether a general procedure remains semantically sound.
An expired level Skill remains readable as history; it is unavailable for current
execution until the parent produces a valid revision. A task Skill survives a
level change. Dependencies on expired level facts can still invalidate a broader
component; basis_refs alone are historical provenance and do not imply dependency.

### Repeated evaluation

Resolve assess_effect explicitly by decision_id when provided. Otherwise, if
observation_refs identify component use, consider matching decisions including
previously assessed decisions. Return ambiguity rather than selecting the wrong
component. Preserve multiple assessments and their exact scopes. Handle retirement
effects as absence/projection effects separately from positive component utility.

## Current evidence motivating changes

- demo/pi_task_knowledge_lifecycle.ts currently applies validity reasons only to
  memory, leaving general non-Memory task/level lifetime behavior incomplete.
- demo/pi_auto_research_agenda.ts writes a singleton agenda_id with a single topic
  and question; callers must be audited before concluding alternatives are lost.
- demo/pi_task_local_subagents.ts has a compound start rejection without a prior
  result and a protocol requiring multiple plan nodes for compound classification.
  The live run logged that exact rejection.
- assessHarnessEffect excludes already-assessed decisions from its implicit
  selection, causing a real direction-Memory re-evaluation to bind incorrectly.
- The latest previously inspected autonomous run did create grid-delta-probe and
  complete research reports. The issue is progression/quality and closed use,
  not a blanket claim that no conversion or research ever occurs.
- Final old-run summary records 351 agent actions, 352 environment calls, two
  levels, one Skill version and no Tool/Subagent definitions. It ended with
  TimeoutError; both previously live ARC processes are now absent.
- Reviews 66–68 still justify coverage by the 50-cell moving group and 4-cell bar
  classification. Review 68 says the procedure covered observations 343–347 and
  no new carrier is warranted by that window. This is direct evidence that the
  opportunity judgment remains local: existing observation coverage is being
  used to judge development while goal/constraint/strategy gaps remain outside
  that judgment. The improvement must expose cumulative task-solving context,
  rather than merely repeat permission to create more components.
- The completed old run has three research reports with method candidates:
  delta classification plus goal-slot reachability; panel change decomposition;
  and catastrophic-versus-local event classification. Planning implications
  discuss feasibility, state constraints, panel phase and route cost. Thus higher
  level reasoning exists in reports while the pool still has only the original
  probe Skill. The missing connection is method development and later use, not
  a universal absence of research or hypotheses.

## Primary semantic acceptance questions

For each real-provider stage, record the following from actual parent/research
output; missing fields remain unknown rather than code-authored explanations:

- Which task objective and constraint caused the parent to seek a method?
- Which operation does its earlier observation Skill cover, and which new work
  (planning, comparison, feasibility or recovery) remains uncovered?
- Did the parent preserve this operation through unrelated Memory writes and
  failed calls until it chose a concrete disposition?
- Does the resulting body describe executable steps with inputs and decisions,
  including a scoped hypothesis/test branch when uncertain?
- Does a later action or actual computation use the selected version for the
  declared operation? Mere repeated basis_refs are insufficient semantic proof.
- Which outcome challenges or supports its assumptions, and how does that change
  the strategy, research question or method revision?
- When a level changes, which concrete facts expire and which task methods remain
  applicable? Mechanical scope survival and semantic applicability are distinct.

These questions audit behavior after admission; they are not additional fields
that every candidate must fill before it may enter the pool.

## Acceptance evidence

Diagnostics must cover all five categories and demonstrate task Skill survival,
level Skill expiration, level Tool/Subagent invocation behavior, historical
readability, unchanged old definitions, component-vs-control classification and
repeated assessment selection. A compound planning question can start without
an artificial prior-result prerequisite. Competing lines preserve separate refs.

Required integration: arc-harness-smoke with real ARC SDK/bridge, Pi parent,
broker/child process, structured return, router, native mutation, assembly, ARC
action, later parent use; five kinds and both research/delegate length continuation.
Deterministic provider proves wiring only.

Required autonomous evidence: current-code real provider ARC, no Jev, no local
step cap. Inspect actual procedural bodies and research reports. Trace at least
an early method and a goal/constraint-driven planning/strategy method to creator,
pool, selection and later use. Demonstrate research alternatives and feedback,
and task-vs-level lifecycle at an actual level boundary. A lack of naturally
arising category output is not by itself a test failure or a quota requirement.
Do not claim game-quality improvement without matched evidence.

Preserve ongoing older runs unless a verified resource conflict requires a
decision. Fresh runs use current code and clearly separate evidence. Runtime
failure recovery must preserve the same environment history.

## Deferred work relationship

docs/deferred-research-todos.md B/C/D apply directly: question continuity,
parent-owned experiments and cognitive continuity. Complete only the portions
necessary here; full adapter refactoring, new stores and automatic scheduling
are outside this implementation. Existing JSONL/resources remain the evidence
sources rather than introducing a parallel semantic database.
