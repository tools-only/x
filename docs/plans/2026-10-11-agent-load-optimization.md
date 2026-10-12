# Meta-harness change record: ARC Agent load reduction without harness semantic regression

Date: 2026-10-11 Asia/Shanghai. Status: implementation in progress; the
authorized exploratory real ARC check is bounded below.

This plan consolidates the load analysis in
[`2026-10-11-agent-load-analysis.md`](../reports/2026-10-11-agent-load-analysis.md),
the resident-context work in
[`2026-10-11-resident-context-stability.md`](2026-10-11-resident-context-stability.md),
and the user's boundary that ARC perception tools are authored by the Agent.

## Problem and claim

Real runs show that the Agent spends substantial reasoning on four coupled
burdens: rebuilding objects from 4,096 pixel values, re-deriving earlier
transitions in each fresh decision, rereading the full context after a tool
call, and repairing Skill source/serialization errors. Memory rendering also
grows as evidence and rival hypotheses accumulate. The percentages in the
load report are a keyword classifier and are directional evidence, not causal
attribution.

The narrow claim for this work is: bounded result delivery and a lossless
compact display reduce repeated input and tool-repair work while preserving
the existing harness component contract and Agent-owned interpretation. A
later ARC-specific primitive layer may reduce pixel arithmetic, but only when
it remains an on-demand foundation that the Agent's Skill selects and
interprets.

The reduced burden is parent input, repeated provider turns, Skill repair
round trips, duplicated Memory prose, and avoidable host execution. The plan
does not claim that fewer tokens imply better ARC play; level progress and
net benefit require matched real-provider evidence.

## Non-negotiable compatibility constraints

Every existing component must retain its creation, revision, invocation,
persistence, result, and failure-repair semantics:

- Memory stores remain lossless. Compacting is display-only and must not hide
  unresolved claims, the latest refutation condition, or the next separating
  test. Omitted evidence must have an exact read path.
- A Skill save must remain valid even when immediate execution fails, needs
  unavailable arguments, or returns a value that cannot be represented as
  plain JSON. Errors are feedback, not silent success or save rejection.
- Prompt, Analyst, and Subagent/delegate paths remain semantically reachable;
  schema staging may change when a low-frequency surface is sent, but not the
  operation's arguments, persistence, authorization, or result meaning.
- ARC action scope, budget, environment failure, atomic Memory updates, Skill
  source/version checks, and provider length recovery remain unchanged.
- The project must not automatically infer object identity, goal semantics,
  motion, or a winning rule from raw frames.

No new child, worker, Auto-Research path, mandatory field, semantic gate, or
parent management turn is introduced by this plan.

## Proposed sequence

### B — immediate Skill result, with tolerant feedback

When `skill(op="set")` succeeds, the same tool response may run the saved
Skill once against the current canonical state with `args={}` and include a
bounded result preview. The runtime should reuse or deduplicate the existing
automatic observation for that exact Skill/version/state; it must not create a
second provider turn. Full output remains in the durable Skill-run log and is
available through the existing explicit result path.

If the Skill expects a proposed action, a required argument, or a history that
is not available at save time, the save still succeeds and the receipt says
that execution was deferred. Tuple-key, set, and other non-JSON values must be
converted with an explicit type-preserving warning or a bounded error; a
conversion warning must not masquerade as a correct semantic result. Guest
timeouts and runtime errors are recorded and repairable.

Owner: the runtime performs mechanical execution and persistence; the Agent
decides whether the result is useful and whether to revise the Skill. The
first benefit is one fewer get/fix/run cycle after a successful save.

### C — compact Memory projection, lossless store

Keep `memory.jsonl` and evidence records unchanged. Change only the parent
working-set renderer:

- show all active/open/contested hypotheses with their claim, status, latest
  refutation/support condition, and next test;
- show at most the last two evidence lines for a stable hypothesis, with an
  omitted-count and exact key/action pointer;
- collapse a settled or rejected hypothesis only when its verdict condition,
  latest evidence, and retrieval key remain visible;
- remove only structurally identical duplicate evidence rows;
- preserve rival-question membership, strategy dependencies, and component
  references.

The Agent can request the omitted record through the existing Memory read
surface. If that read surface cannot return an exact key-scoped record, C is
not ready. The negative case is a later decision that repeats a rejected goal
because the condition was hidden; such a trace rejects the compaction.

### A′ — ARC-specific primitive foundation, only if B/C leave a measured gap

Do not add a general-purpose grid library to the self-harness. If the real
load still justifies a foundation, place a small, versioned, pure API in the
ARC adapter/observation layer. It may operate only on explicit input supplied
by the Agent's Skill:

- bounding box of an explicitly supplied coordinate set;
- neighbor iteration under an explicitly selected connectivity rule;
- coordinate translation/normalization;
- connected-component labeling of an explicitly supplied coordinate set.

The adapter must not choose colors or background, identify a task object,
match an object across frames, calculate semantic movement, or answer what
the goal is. `find_shape`, object tracking, cross-frame diff, and “how far it
moved” remain Agent-authored Skills using the history/frame interface. No
primitive runs automatically and no derived answer is injected into the
working set. A Skill records the adapter API version it used so results remain
reproducible.

Implementation status: A′ is present in the ARC adapter as the opt-in `arc`
foundation object available only to ARC Skills. It provides explicit
coordinate-set `bbox`, `translate`, `normalize`, `neighbors`, and `components`
operations, with adapter version `arc-agi-3-foundation-v1`. It does not
receive a grid or choose colors, objects, frames, movement, or a goal. The
generic Skill guest does not expose this object. Cross-frame analysis remains
authored over `state["history"]`.

### D — carried reasoning, isolated paired experiment

The existing bounded tail of the previous decision's reasoning remains an
optional comparison variable. After the current reasoning arm is complete,
run matched `carry=0` and `carry=120–200` samples with the same provider,
game, prompt, action, and token budgets. Measure reasoning/input per action,
re-reading, hypothesis revision, prediction misses, repeated explanations,
levels, and first useful action latency. A lower token count with more stale
or uncorrected claims is a regression.

### F — prompt directive compaction

Only after the other session's prompt work is frozen, shorten repeated goal
directives into capability statements. Retain explicit requirements for
environment-confirmed WIN, rival hypotheses, condition-scoped refutation,
prediction checks, and independent mechanics/goal reasoning. This factor must
not be mixed with C or A′. Review traces for missing counterexamples and
goal-check omissions before measuring token reduction.

### G — multi-action commitment (deferred)

Do not implement in this cycle. If later revisited, limit the sequence length,
require a prediction per step, stop on the first miss, level change, state
change, budget boundary, or environment error, and preserve one canonical
action record per executed step. Its expected benefit is wall-clock reduction,
not reasoning reduction; routine single-action decisions are already cheap in
the successful reference run, while open-loop execution can worsen false
object/goal models.

## Lifecycle and first-benefit paths

### H — critic redirection at the hypothesis/strategy layer

The critic now evaluates hypothesis status, goal-model consistency, strategy
progress, and evidence quality. It identifies weakened, rejected, stalled, or
unresolved targets and competing explanations or strategy transitions, while
leaving concrete action and coordinate selection to the parent Agent. Legacy
suggestion parsing remains tolerant for old records, but new critic requests no
longer ask for action suggestions or judge whether a suggested action was taken.

The 100-action exploratory run exposed a remaining transition failure: the
critic correctly marked `strat.explore_controls` as stalled repeatedly and
identified the unresolved goal model, but the parent continued boundary
mapping and resets. One strategy revision retained the same strategy and
action set. Thus critic redirection is functionally reachable and semantically
used, but strategy adoption is incomplete; the next change must target the
parent's strategy-state update (for example, requiring an explicit strategy
status transition or a recorded reason for retaining a stalled strategy), not
add action-level prescriptions to the critic.

The opportunity is recognized by repeated tool repair, repeated Memory prose,
or measurable pixel arithmetic. Runtime mechanics advance result delivery,
projection and version checks. The Agent decides whether to invest in a Skill,
read omitted evidence, use an ARC primitive, revise a claim, or reasonably do
nothing. Feedback is the subsequent Skill result, Memory update, prediction,
and action outcome. Components are retained, revised, or retired by the
authorized Agent; failed execution does not silently retire a component.

B requires one Skill-save decision and no extra read turn. C requires no new
decision unless the Agent explicitly reads omitted evidence. A′ requires the
Agent to author/import a Skill and call it; no automatic analysis is added.
D/F are experiment configuration changes only. G, if ever authorized, adds no
new review or approval turn but changes the action boundary and therefore needs
a separate contract test.

## Verification protocol

Use one frozen source snapshot per factor. Diagnostics and real behavior are
reported separately.

1. Functional: Node/Python tests for successful and failed Skill save, deferred
   execution, non-JSON result conversion, Memory projection/retrieval,
   unresolved/refuted rival visibility, review-only Prompt/Analyst use, and
   invalid-call repair.
2. Full chain: `arc-harness-smoke` through the real ARC bridge, Pi parent,
   broker/process, structured return, router, native mutation, action boundary,
   and later parent turn. Cover all five component types and provider `length`
   continuation for Auto-Research and ordinary delegation where applicable.
3. Autonomous adoption: ordinary real-provider runs; record opportunity,
   recognition, investment, candidate, assembly, semantic use, feedback,
   retention/revision/retirement, and justified non-use. Scripted providers do
   not establish this layer.
4. Net benefit: matched real-provider repetitions with parent and all worker
   input/output/reasoning, latency, management turns, action quality, levels,
   and environment failures. A level result without cost accounting is not a
   net-benefit claim.

Primary measurements are input tokens and schema characters, reasoning and
output tokens, repeated provider messages per decision, Skill repair loops,
Memory section size, omitted-evidence reads, first semantic use, no-action and
length events, actions, levels, and total parent/worker cost. Missing usage is
unknown, not zero.

## Current status and decision boundary

2026-10-11 user-requested configuration update: `arc-thin-e2e` CLI and
Python runner now default to `thinking="high"`. Explicit `--thinking off`
remains supported. The known yibu/Qwen route resolves to the Qwen thinking
wire format. This changes future default runs only; it does not rerun or
reinterpret the completed thinking-off experiment. Benchmark benefit remains
unverified.

P072 showed that phase-specific schemas reached 8/8 bridge actions with zero
length/idle failures and reduced ordinary schema characters, but it produced
no Skill, Prompt, or Analyst adoption and cleared 0/7 levels. That is stability
and functional evidence only. The current schema staging remains a
compatibility risk until ordinary-use and review-use semantics are both
observed.

The next check is a bounded real run of the implemented B/C/A′ snapshot. D
waits for the current reasoning arm; F waits for the other prompt change; G
remains deferred. No change is accepted because it lowers tokens alone.

## Evidence layers

| Layer | Status | Boundary |
|---|---|---|
| Functional correctness | passed for B/C/A′ | 49 thin Node tests, including negative cases and explicit-coordinate foundation tests |
| Full-chain reachability | passed | `arc-harness-smoke` deterministic real-runner matrix passed; environment and runtime boundaries unmocked |
| Autonomous adoption | partial | One real run created/revised/used a Skill; ARC foundation, Prompt and Analyst adoption remain unobserved |
| Net benefit | unverified | No matched B/C/A′ real-provider comparison |

## Authorized exploratory real check

The new run uses the official `ls20` bridge, `yibu/qwen3.8-27b`, treatment,
text input, `thinking=off` with the `qwen` wire format, ledger and critic on,
consolidation every four actions, at most 20 actions, 1,200,000 reported
tokens, and an 1,800-second wall-clock bound. It is an exploratory ordinary
run, with no required Skill or adapter call. The comparison reference is P072
(8 actions, 0/7 levels, 102,533 reported tokens, no authored Skill/Prompt/
Analyst). The run can establish provider behavior and adoption observations;
it cannot establish net benefit from one sample.

### Exploratory result (2026-10-11)

The run reached the official bridge and completed 20 actions: 0/7 levels,
271,253 reported tokens, 237.8 seconds, 0 length stops, 0 idle timeouts, and
no harness errors. The parent autonomously created `diff_frames` v1, revised
it to v2, and explicitly invoked it once; automatic save trials and ledger
observations were recorded without duplicate current-state execution. This is
functional and autonomous Skill adoption evidence, not a task-quality or
net-benefit result.

The Skill used `state["history"]` and performed its own cross-frame analysis;
it did not call the optional ARC `arc.*` foundation. No Prompt overlay or
Analyst call occurred. Memory retained two open hypotheses, two evidence
records, and an active strategy, but the parent spent most actions isolating
single-action effects and never tested the critic's final sequence suggestion
before the 20-action budget ended. The average working set was 8,133
characters (state 3,486; memory 1,418; recent actions 1,598); dynamic Skill
schemas were about 5,193 JSON characters. The run confirms the conversion path
and exposes a remaining working-set/perception burden; it does not support a
claim that B/C/A′ improved levels or total cost.

Related deferred work remains: ARC adapter boundary cleanup, parent/worker total
cost, and cross-compaction cognitive continuity. This plan does not close those
items.
