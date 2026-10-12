# Resident context and real-run stability

Date: 2026-10-11 Asia/Shanghai. Status: implementing; user prioritizes stable execution.

## Problem and falsifiable claim

P065 (official ARC ls20, yibu/qwen3.8-27b) completed 5 actions in 601.6s,
with 7 primary length stops and 3 failed recoveries. Its first working set
contains 3,480 state characters and 456 other characters; the last contains
3,460 state and 4,264 other characters. Completed requests consume roughly
7–8k input tokens, and most truncated outputs are entirely reasoning.
Thus history growth alone cannot explain the initial failure.

Hypotheses ranked before changes: duplicated resident system/tool guidance;
growing working-set records; nominal thinking=off not reaching the gateway.
The installed Pi transport and current runner already support an explicit
thinking format, but P065 did not declare one. This is a separate factor.

First claim: remove repeated procedural examples and obligations from the
system prompt while retaining callable schemas, full current grid/image,
all durable memory, conditional counterexamples, and history access. This
should reduce resident system text by at least 45% without a new read turn.
Input reduction alone does not establish fewer length stops.

## Design and cost

Reuse existing tool documentation rather than add a manual/read tool or worker.
Runtime continues assembly, scoring and persistence; Agent owns hypotheses,
component investment, use, revision and retirement. No new mandatory fields,
semantic gates or management calls. Preserve permissions, budgets, atomic
updates and source/version integrity. Keep old text outside the repository
under local/resident-context-before for comparison/rollback of future input.
Add developer-only context size accounting; characters are not token counts.
No truncation of memory, counterexamples or pixels in this first factor.

## Pre-run protocol

P066: official ARC ls20, real yibu/qwen3.8-27b, treatment, ledger and critic on,
text modality, nominal thinking off, no explicit thinking format, output 2048,
8 actions / 500,000 aggregate reported tokens / 600 seconds, consolidation
every 2 actions, idle timeout 120s. Same bounds as P065; only resident system
guidance changes. Current pre-existing code differs from P065 (standing Skill
perception wording and latest-only MISS exposure), so this is a diagnostic,
not a clean causal performance comparison. Freeze sources for the run.

If length persists and logs confirm reasoning dominates, next experiment
changes only the already-supported thinking format to qwen. Do not change
prompt, output budget, or consolidation cadence simultaneously. A later
confirmation can expand actions/time after recording that protocol change.

Stability criterion: finish the 8-action diagnostic without idle/provider
errors or failed length recovery, matching canonical bridge actions, followed
by a >=25-action confirmation with a bounded longer window. Skill counts and
prediction hits on NOT_FINISHED are not rewards. Compare actions, elapsed,
input/cache/output/reasoning, length events, failed recoveries, tool errors,
critic outcomes and levels. Zero levels leaves game benefit unverified.
Stop and retain all failures at the declared bounds; missing usage is unknown.

## Implementation and verification

Local first factor: 41 Node tests and 5 Python tests passed; real Pi/mock ARC
self-harness smoke passed. System body 5,730 -> 2,741 chars; with ledger/critic
the real system is 3,147 chars. Initial real input P065 7,265 -> P066 6,439
reported tokens (-11.4%, single first-request comparison). P066 already shows
reasoning-only length stops, so prompt reduction alone does not stabilize it.

Second factor prepared: infer `thinkingFormat=qwen` only for explicitly
requested thinking on the known yibu/qwen3.8-27b OpenAI-Completions route.
Explicit CLI/environment dialect wins; other routes and unspecified thinking
remain unchanged. Installed Pi encodes off as enable_thinking=false. A
provider_policy.jsonl audit records only outgoing policy fields, no credentials
or request content. This is experimental until the provider response verifies
the policy. P067 repeats P066 bounds on the next frozen snapshot; no other
behavioral variable changes. Parent, analyst and critic share model compat.

P066 terminal: 3 canonical/bridge actions, 0/7 levels, 602.4s,
146,180 reported tokens; 7 primary length stops, 7 recoveries, 3 failed
recoveries, no idle timeout and no tool errors. Deadline stop. This fails the
stability claim despite the measured input reduction. P067 started from frozen
resident-context-v2; the first actual requests log enable_thinking=false and
completed messages report reasoning=0. Await the terminal window before judging.

Pending: context regression, real Pi mock-environment smoke, real ARC run.
Negative cases include model ignoring off, lost counterexamples, stale grids,
component disappearance, malformed output, and short responses harming play.

| Layer | Status | Evidence boundary |
|---|---|---|
| Functional correctness | Pending | Local extension and input assembly tests |
| Full-chain reachability | Unverified | No five-component closure claimed |
| Autonomous adoption | Unverified | Inspect actual subsequent tool/action use |
| Net benefit | Unverified | Diagnostic sample is not repeated matched evidence |

## Delivery decision

### Third observed transition: successful consolidation did not settle

P067's first 21 completed messages have zero reasoning/length, but only four
actions. Fourteen memory calls occur, with no tool errors. The runner asks for
exactly one memory call on a review, yet the extension returns terminate=false
unless the same assistant message also contains arc_action (which is prohibited
during review). Successful reviews therefore continue reading the entire
context and receipts until the model stops or the 12-call guard fires.

Narrow next factor: after a valid atomic memory call in a consolidation, mark
that message's batch terminal just as an action batch already is. Same-message
independent updates still execute; invalid memory leaves the repair path open.
Ordinary gameplay memory calls still permit a later action. This automates the
runner's existing completion instruction, with no new model obligation.

P068 will repeat P067's 8-action/600s/500k bounds with only this settlement fix.
Success: at most one successful memory request per review, later ARC action,
no length/idle failure, canonical actions reconciled. If passed, P069 uses the
same frozen code for 25 actions/900s/600k; this expanded confirmation is not a
matched latency comparison. Goal semantics/level benefit remain unverified.

Pending real results. Related deferred work: cross-compaction cognitive
continuity and total parent/worker cost remain open; smaller input is not proof
that the Agent uses retained evidence.

### Resident context projection (P069 candidate)

P067 exposed the full context composition: at six actions the parent-facing
working set contained 6,511 memory characters, 1,040 repeated Skill-output
characters, 3,460 current-state characters, 661 ledger characters and a
3,532-character system prompt; active tool schemas added 8,680 JSON characters.
Durable logs are useful, but sending every old fact and unchanged result on
every parent turn is a separate source of parent cost.

The projection keeps memory.jsonl, Skill results and history lossless. It
abbreviates old fact prose while retaining every key and current
hypothesis/strategy; unchanged automatic Skill output becomes a short marker
with an explicit `run_skill` escape hatch. Tool descriptions and field prose
are shortened because the system prompt already documents the contract. No
tool is removed, no grid row is dropped, and no semantic decision is automated.

Local smoke reports 2,741 system chars and 4,630–5,567 active tool-schema
chars, versus P067's 3,532 and 7,329–8,680. This is character accounting, not
a token guarantee. P069 uses the integrated current candidate (projection plus
the prepared consolidation settlement) under P067's bounds; its result is
diagnostic rather than a clean single-factor comparison because P068 was
interrupted before a terminal summary.

### Fourth observed transition: resident context is bounded, but tool turns are not

P069 isolates a different context failure from the resident sections themselves.
The first request of each action was about 5,655–8,341 reported input tokens with
zero reasoning, while one ordinary decision (decision 8) emitted 13 successive
`run_skill` calls, including repeated `diff_frames(a=0,b=1)` calls. The working
set grew from 7,684 to 10,708 characters inside that one decision and the
provider received a new request after each tool result. The existing soft limit
of 12 returned a non-terminating refusal, so it added another parent request
instead of ending the decision. A successful ordinary `memory` call likewise
returned `terminate=false`; only consolidation had been settled mechanically.
These are observed facts from `pi-events.jsonl`, `context_budget.jsonl`, and
`usage.jsonl`, not an inference from component tests.

The next narrow claim is: when one decision has a bounded number of semantic
tool calls, repeated skill signatures are short-circuited, and one valid ordinary
memory update settles the batch, the parent will reach an action or a fresh
bounded decision without a long tool-only chain. The burden removed is repeated
provider input, repeated sandbox work, and the chance that the provider reaches
`length` before producing the required `arc_action`. The negative case is a
legitimate distinct sequence of up to four skill measurements followed by an
action; it must remain callable. An invalid memory update must remain repairable,
and a memory call batched with an `arc_action` must still allow the action.

Implementation is limited to the extension's existing decision gate and result
projection: cap explicit `run_skill` calls at four per decision, end the current
batch on the next non-action call after that cap, return a short duplicate receipt
for repeated skill arguments, and settle a successful ordinary memory call when
it is not part of an action message. Full skill output remains in
`skill_runs.jsonl`; the parent-facing default is bounded with an explicit
full-result escape hatch. No new worker, mandatory field, semantic action gate,
or automatic interpretation of skill output is added.

The diagnostic comparison keeps the P069 provider, game, prompt projection,
thinking wire, output and action/token/time budgets fixed and changes only this
decision-level factor. Primary measures are actions reached, parent/child input
and output, tool-only messages per decision, repeated calls, length stops and
failed recoveries. Level completion and self-harness net benefit remain
unverified unless a matched real-provider run demonstrates them.

### Fifth factor: phase-specific tool schemas

P071 still sent five ordinary-turn tool schemas (`arc_action`, `memory`,
`skill`, `prompt`, `ask_analyst`) at roughly 5.1k JSON characters, and saved
skills added `run_skill` to about 5.7k. The low-frequency prompt editor and
analyst are useful during review but compete with the action boundary on every
ordinary move. This is a separate resident-context burden from the bounded
Skill call loop.

The treatment now keeps registered tools available for lifecycle and replay,
but activates only `arc_action`, `memory`, `skill`, and (when a Skill exists)
`run_skill` on action turns. The existing consolidation turn activates
`prompt` and `ask_analyst` together with the review tools. No extra management
turn or new mandatory field is introduced; a review already occurs at the
runner's configured cadence. Deterministic smoke suites may request the old
expanded surface with `ARC_THIN_EXPANDED_TOOLS=enabled` so the low-frequency
tools remain covered semantically.

The falsifiable claim is that ordinary request schemas shrink while review
reachability and semantic tool behavior remain intact. The negative case is an
ordinary turn that needs an analyst or prompt edit; its expected path is the
next scheduled review, and this remains a usability risk to measure. A real
provider run must compare schema characters/tokens, first self-harness use,
action reach, no-action and length behavior, and level results. The staged
surface does not establish autonomous adoption or game benefit by itself.
### P070 diagnostic: bounded tool calls exposed a recovery-surface bug

The first real-provider check of the decision budget used the P069 bounds with
only this extension change. It produced 5 actions, 0/7 levels, 237,525 reported
tokens, 0 parent `length` stops, 0 idle timeouts, 1 duplicate short-circuit,
and 16 bounded Skill executions. The per-decision working set stayed below the
P069 peak, and no long tool chain exceeded the four-call Skill budget. However,
the runner recorded 8 no-action decisions and stopped on `no_action_streak`.
After a tool-only decision ended, the next recovery prompt still exposed
`run_skill`; the model kept taking one more measurement instead of obeying the
natural-language action request. This is a broken transition at tool-only
completion → forced action, not evidence that a four-call semantic budget is
wrong. P070 also showed one independent analyst request ending at its inherited
2,048-token envelope with `stopReason=length`; that auxiliary request needs its
own smaller output envelope.

The follow-up keeps the budget and duplicate behavior unchanged. It mechanically
hides non-action tools for the runner's `previous decision ended without
arc_action`/`RECOVER ACTION` turn and caps analyst output at 512 tokens. The
negative cases remain: a normal decision may still create/use a Skill and a
same-message memory plus action remains legal; a failed memory call must not
force an action until it can be repaired. P070 is a stability diagnostic only:
its level result and self-harness net benefit are unverified.

### P072 real diagnostic result (2026-10-11)

P072 used the same official `ls20`, yibu `qwen3.8-27b`, thinking off with
`qwen` wire format, ledger/critic, 8-action, 500k-reported-token and 600-second
bounds as P071. With the staged surface it reached all 8 bridge actions in
106.8 seconds, had 0 length stops, 0 idle timeouts, 0 harness errors and
102,533 reported tokens. Ordinary requests recorded 4,542–4,550 tool-schema
characters with `arc_action`/`memory`/`skill`; action-only recovery requests
were 963 characters. Review requests remained 4,182 characters with
`memory`/`skill`/`prompt`/`ask_analyst`. P071's ordinary five-tool requests were
5,136–5,144 characters, so the measured schema reduction was about 11.6% in
this snapshot. The first reported agent input fell from 5,655 (P071) to 5,505
tokens; this is one diagnostic pair, not a causal cost estimate.

P072 completed 0/7 levels and saved no Skill, prompt overlay or analyst call.
Therefore the run supports functional reachability and a stability observation,
while autonomous adoption and net game benefit remain unverified. Its 5
no-action decisions show that schema reduction did not remove the separate
tool-only-to-action friction entirely; the forced-action path still reached
the full action budget without length or idle failure. The next falsifiable
check is a matched run in which the provider actually creates/uses a Skill and
uses a review-only low-frequency tool, then compare those semantic outcomes
and parent input against the expanded surface.

### Compatibility constraint for subsequent optimizations

Context work may change when a schema is sent, how much unchanged text is
projected, and how a completed tool batch settles. It must preserve the
component contract: every registered component remains executable with the
same arguments, persistence and result semantics; the agent still has a
reachable path to create, revise, invoke and observe each component; and
invalid calls remain repairable. Any staged or compact surface therefore needs
paired semantic regressions for Memory, Skill/run_skill, Prompt, Analyst and
Subagent/delegate paths, plus the real ARC bridge path before it is used for a
provider comparison. A
lower token count alone is insufficient evidence for accepting a context
optimization.
