# Harness architecture: five capabilities on a thin runtime, aligned with Prime Agent and Continual Harness

Date: 2026-10-13. Status: implemented on the native ARC path, except §7 step 2's registry shared with the general
self-harness path and §4.1's host-served data (see the [change record](../reports/2026-10-13-harness-architecture-implementation.md)).
It replaces the ad-hoc type list of the native ARC path (observer, library, note, role, refiner) and the mechanisms added around them.
Sources:
- Prime Agent blog: `tmp/prime-agent.txt` in the main tree;
- Continual Harness ARC-AGI-3 write-up: `tmp/ARC-AGI-3-CH.md`;
- our audits: `docs/reports/2026-10-08-continual-harness-self-harness-analysis.md` and the gap analysis of 2026-10-13;
- the first real run of the activation branch (ls20, 25 actions, analysed 2026-10-13).

## 1. Their principles and mental models

Prime Agent:
- **P1 Programmatic control over fixed scaffolding.** One persistent kernel is the only tool; skills, tools and sub-agents are
  functions called from code. "Fixed tool-calling schemas and context compaction force the model to work around its own
  scaffolding."
- **P2 Context as a variable.** Data and history stay outside the model's context; the model reads what it prints and can query
  its full history programmatically. Tokens are saved "by programmatically running functions over data rather than spending
  tokens reading data using tools."
- **P3 One uniform surface for harness state.** Prompt notes, memory, skills and sub-agents share create/read/update/delete;
  every change is persisted.
- **P4 Refinement is a pipeline, not a component.** `/refine` reads the trajectory and applies the smallest relevant edit,
  recording its trigger and outcome. It plans in the background, applies at a turn boundary, can be rolled back by ID, and can be
  called by the agent. The base system prompt is immutable.

Continual Harness:
- **C1 The harness is an editable world model.** z_t = (p, G, K, M) is the agent's current understanding, and a_t ~ π(· | o_t, z_t).
- **C2 Four components with distinct roles.**
  - p is the current strategy: hypotheses, planned experiments, tool usage, failure modes.
  - M holds facts and candidate rules, each with a confidence of 1–5.
  - K are executable routines that act or return results.
  - G are sub-agents working in isolated contexts.
- **C3 Context is rebuilt at state changes.** The context is rebuilt only after a call that changes the game state. Analysis and
  edits are appended within the current decision. History is an overview within a fixed budget.
- **C4 Efficiency comes from executing saved knowledge.** 62% of actions came from saved skills.
- **C5 Reset-free refinement on events.** Level-up, game over, stagnation and every F steps trigger a reread of the raw trajectory
  that consolidates all components.

The shared mental model: **the harness is the agent's evolving understanding and capability; the runtime is a thin executor
offering few, uniform primitives.**

## 2. Guardrails for this design

- **G1 No category or pathway without a counterpart** in P1–P4 or C1–C5, unless our foundation forces one. Each deviation is
  listed in §6 with a one-line reason.
- **G2 One way to do each thing:** one creation surface, one execution contract, one trigger mechanism, one context build.
- **G3 Runtime machinery stays invisible to the agent**, except as data it can query.
- **G4 Delete before adding.** Every new piece names what it replaces.

## 3. Capabilities: five categories

The user's five categories. They are Continual Harness's four, plus Tool, which Pi already separates from Skill (§6).

| Category | Their counterpart | Role (one sentence) | Form | Used by | Shown in context as |
|---|---|---|---|---|---|
| Prompt | CH p; Prime prompt notes | How to decide now: rules, current strategy, next experiment, failure modes | `prompts/<name>.md`, `active: true\|false`; `prompts/strategy.md` is the strategy | Applied while active; base prompt immutable | Full text within a budget |
| Memory | CH M (confidence 1–5); Prime memory | What is known: facts, hypotheses, refutations | The memory store, mirrored to `data/memory.md` | Read by index; optional executable check per hypothesis (§6) | One line per entry |
| Tool | CH K (executable skills); Prime python functions | Code that computes or acts | `tools/<name>.py`: one contract, `run(args, env)` or a script with `args` and `env` | Called by name or from python; may act through `env.act` | One line per tool |
| Skill | Prime SKILL.md references | A procedure: how to investigate or test something, with which tools | `skills/<name>/SKILL.md` | Read on demand | One line per skill |
| Subagent | CH G (bounded, isolated) | A delegated question answered in its own context | `agents/<name>.md`: instructions plus readable inputs and usable tools | `consult(agent, question, refs)` | One line per agent |

What folds away:
- **observer:** a Tool with one optional attribute, `view: true`. It runs after each state change and its output is part of the
  context (deviation D3).
- **library:** a dependency of tools (`lib/`), importable but not a capability.
- **note:** scratch space. Its content is either Memory (facts) or Prompt (rules and plans) and is saved as such.
- **role:** renamed Subagent.
- **refiner:** not a component, a runtime pipeline (§4.4), as in both systems.

## 4. Runtime: a thin executor with five mechanisms

1. **Execution.** One contract for all tools: `args` (a dict) and `env`. There are no schemas derived from type hints; the
   docstring is the description. `env` provides:
   - `state` (including `state['frames']`), `grid` and `history` as call snapshots; `env.grid` is refreshed by `act()`;
   - `act(action, predict=None)`: through the same bridge, budget and refusals as `arc_action`; returns the new observation;
     the code decides whether to continue (C4, P1);
   - read access to memory and evidence.

   Inputs and evidence are served by the host on request, not shipped file by file (P2).
2. **Context assembly (C3).** Rebuilt at every state change, appended within a decision:
   - active prompts (strategy included);
   - the memory index;
   - the capability index (five sections, one line each);
   - outputs of tools marked as views;
   - a summarised history: action lines plus the latest two tool results in full, older results one line each, within a
     12,000-character budget;
   - current state metadata and exact observation references by default; raw grids and images are queried with python/read
     (`ARC_THIN_OBSERVATION=inline` retains the comparison mode).

   Pi's compaction stays as a fallback for long decisions. The agent can see how full its context is (P2, P4).
3. **Lifecycle (P3).** One surface: workspace files through the binder, plus the memory tool for structured memory.
   - Every write is validated and versioned; a failed version keeps the last good one; `restore` rolls back by version.
   - Creation, assembly, use and cost are recorded per category.
4. **Refinement pipeline (P4, C5).**
   - Triggers: level change, game over, stagnation, missed level/goal predictions, repeated work, every F actions, or the agent's
     `refine(focus)`.
   - It rereads the raw trajectory, proposes the smallest edit to any category (Prompt, Memory, Tool, Skill) with cited evidence,
     and applies it through the lifecycle with trigger and outcome recorded. It never blocks a decision; the agent is told once.
   - The agent shapes it with a prompt note (`prompts/refine.md`), not a special role file.
5. **Evidence and budgets (G3).** Trajectory, ledger, results, versions and usage are runtime data the agent can query, never
   shown as capabilities.
   - Budgets follow Continual Harness: a decision ends at a state change or at a hard cap of calls, and older non-action results
     are summarised.
   - The tool list never changes within a decision.

Agent-facing tools (fixed): `arc_action`, `python` (with `save`), `memory`, `read`, `write`/`edit`, `consult`, `refine`, plus
saved tools. That is 7 fixed, against Continual Harness's 6 and Prime's 1.

## 5. What this removes (G4)

| Removed | Replaced by |
|---|---|
| observer, library, note, role as types | Tool attribute `view`; tool dependency; Memory or Prompt; Subagent |
| refiner as a role file with triggers; critic's advisory notes; reuse-gap review; resident REPEATED WORK and coordinate lines | the refinement pipeline (§4.4) |
| `notes/strategy.md` as a resident note | `prompts/strategy.md` (CH's p) |
| split look/record budgets and removing tools mid-decision | CH-style decision end plus a hard cap; fixed tool list |
| history bands (verbatim/condensed/dropped by decision) | summarised history within a budget (§4.2) |
| actions returned as an upfront list played blind | `env.act` in a closed loop |
| two tool conventions (typed `run(...)` with derived schema vs script) | one contract: `args` + `env` |
| per-file fetch restarts in the sandbox | host-served `env` data |
| ledger text, exploration and prediction-challenge sections in context | evidence files the agent and the refiner can read |

## 6. Deliberate deviations (each forced or chosen for a stated reason)

- **D1 Workspace files, not a kernel**, as the store and creation surface. This is our foundation (versioned, confined,
  restart-safe). P2 is met through `env` and queryable evidence instead of kernel variables.
- **D2 Tool and Skill are separate categories.** Pi and the user's model separate callable code from procedural guidance.
  CH's "skill" maps to our Tool.
- **D3 `view: true` on tools.** Neither system runs tools automatically. The latest user instruction keeps raw grids/images
  outside context by default; an agent-chosen view may still expose its selected output. It is one attribute, not a type.
- **D4 Executable checks on Memory hypotheses.** A falsifiable belief, tested on every move, is our addition beyond CH's
  confidence field. It is the agent's own novelty and stays inside Memory.
- **D5 Subagents are bounded consults (CH style)**, not Prime's persistent sessions with messaging. ARC has one environment, and
  a daemon would add cost without a use.
- **D6 Per-category measurement** (created → assembled → used → helped → cost) in `reuse_report.json`, required by the
  development standard.

## 7. Migration and evaluation

1. Execution contract (`args` + `env`), a fixed tool list, CH-style decision end and summarised history. These fix the run's
   failed saves, stalls and dropped history.
2. Five-category registry shared with the general self-harness path (`pi_task_local_self_harness.ts`); fold the extra types;
   `prompts/strategy.md`; refinement pipeline with `refine(focus)` and `restore`.
3. Closed-loop `env.act` and host-served data. This changes the sandbox protocol, so it is agreed with Codex first.
4. One real comparison run against both earlier ls20 runs. Measures:
   - per-category funnel;
   - share of actions from tools;
   - reasoning per decision and per action;
   - coordinate share;
   - goal-test predictions per level;
   - parent and child tokens;
   - levels and actions per hour.

Evidence status: functional and scripted full-chain checks pass (change record); autonomous adoption and net benefit are
unverified.
