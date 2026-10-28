# Development workflow

- Before designing, implementing, reviewing, or declaring completion of changes to meta-harness, Auto-Research, prompts/tools, assembly, scheduling, or context management, read `docs/development-workflow.md`. It is the authoritative development and evidence standard; historical plans remain evidence of their own date.
- For substantive changes, maintain one change record using `docs/templates/meta-harness-change.md`, or the same sections in an existing plan/report. Start with a real failure/opportunity, a narrow falsifiable claim, the burden removed, and a bounded evaluation. Small documentation fixes and behavior-preserving maintenance use proportionate checks.
- Report functional correctness, full-chain reachability, autonomous adoption, and net benefit separately. Name the provider/environment and link artifacts. Mark untested layers unverified. pytest, fixtures, hand-written JSONL, scripted smokes and offline replays show function and wiring only; provider-behavior and level claims need real-provider ARC runs.
- Reduce parent decision steps and resident obligations. Before adding a reminder, mandatory field, review, action gate, or worker, compare simplification/reuse and account for its runtime cost. Keep procedural guidance on demand; preserve permission, budget, version, and environment integrity checks.
- No dangling artifacts (user, 2026-10-20): say where each mechanism's output enters the agent loop unasked, what work it replaces, how the next real move feeds back on it, and when it retires; measure use from run logs (shown, acted on, changed the action), including justified non-use. Unused capabilities get call points, not removal (`docs/plans/2026-10-20-loop-bound-artifacts.md`). Automate mechanical work; keep semantic judgments with authorized Agents.
- Evaluate task progress with parent-plus-child cost, latency, management turns, and cognitive continuity. Predefine budgets, negative cases, and comparison criteria; do not optimize component counts or invocation frequency as task rewards.
- When real behavior misses the claim, locate the broken transition and change one main factor. Continue only to the evidence level supported by the authorized scope; record missing experiments and the next falsifiable check instead of calling an unverified optimization effective. Paid runs need a user-authorized budget.
- These rules govern development Agents. Do not inject this workflow, its template, or repository AGENTS.md into the Pi task Agent's gameplay context (runners start Pi with `--no-context-files`; new runners must too). Runtime behavior changes require their own scoped implementation and acceptance.

# Design invariants

User decisions binding every harness change; the linked records give the reasons.

- General, not ARC-fitted: no game names, colours, coordinates, object roles or strategy hints in code, prompts, schemas or test expectations; the runtime reports facts, not interpretations; judge on held-out games with thresholds fixed in advance (`docs/plans/2026-10-09-ledger-critic-general-signals.md`, section 0). Never read a game's source or show it to a model.
- Agent-native: in-run agents (refiner, critic, consult, subagents) use the working agent's own model; no stronger outside model and no human in the run. Stronger models may analyze runs only in the development loop (`docs/plans/2026-10-17-r04-version-plan.md`).
- Services support, the agent decides: the runtime, refiner, ledger and critic provide interfaces, execution and material; only what the agent itself creates or calls counts as adoption (`docs/plans/2026-10-18-self-evolve-loop.md`, "Who holds which decision").
- Derived analyses are the agent's to build: frame diffs, region or motion tracking and the like go into skills the agent writes, and prompts say what exists, not what to build (`docs/plans/2026-10-10-self-harness-priority-plan.md`, 10.9). What the native view already shows (receipts' changed cells and box, the Continual Harness observation of 2026-10-20, the P1-P4 coverage lines) stays unless the user decides otherwise; ask before adding another built-in analysis. Services may compute their own.
- `arc_action` stays an action call: add no memory, plan or other side-channel fields to it (user, 2026-10-12); fix forgotten actions or lost progress outside the action.
- Mechanisms run in the online runtime and are judged in real runs or matched-prefix forks; offline rigs (local game judge, offline fits, replays) are development measurements only (`docs/plans/2026-10-20-loop-bound-artifacts.md`).

# Self conversion contract

- Self conversion lifts repeated transient Python or notes into Binder Components (tools, skills, prompts); it is not specific to Daemon responses.
- Host: detect repeatedWork and proactively deliver CONVERT in the ordinary Decide process/Self evidence, with target path templates, minimum legal skeletons and recent samples; mirror it in data/convert.md and record shown. This replaces reconstructing authoring conventions, not agent judgment.
- Agent: adapt and write a valid target through Binder, or explain reasonable non-use. Adoption means parent creation/calling; creation and delivery alone do not prove semantic use or benefit.
- The next real component save/call and task action provide feedback through component/version, run and working-set logs. Coverage removes a family from CONVERT and offers reuse instead; actual use/outcomes belong in Successes and retirement review. Candidates also expire with the existing repetition window, level and kit boundaries. Do not label coverage alone a success.
- Never auto-promote/save, put conversion procedure in control-core strategy, or substitute higher REVIEW frequency for conversion. Keep repository AGENTS.md out of gameplay.
- Implementation: demo/arc_thin_extension.ts (CONVERT delivery), demo/arc_thin_reuse.ts and arc_thin_native_runtime.ts repeatedWork (facts), demo/arc_thin_binder.ts (validation), demo/prompts/arc_thin_native_system.md (gameplay guidance).

# Current code (checked 2026-10-23)

- ARC work is on the thin/native path: `demo/arc_thin_extension.ts`, `demo/arc_thin_native_runtime.ts` and the other `demo/arc_thin_*.ts`, `demo/prompts/arc_thin_native_system.md`, runner `src/autoresearch_pi/arc_thin_e2e.py` (CLI `arc-thin-e2e`).
- Frozen: the original ARC path (`demo/pi_arc_agi_3_extension.ts`, `arc-agi-3-e2e`) is a comparison arm, and Auto-Research was deprecated for ARC on 2026-10-12 (the ledger + critic replaced it); their plans are history, not authorization. Only changes there run `arc-harness-smoke` (`docs/development-workflow.md`, section 3).
- Pi 0.87.0 is pinned in `package.json` and resolved from the checkout's `node_modules`; without one, runs quietly use the global Pi. Worktrees link it with a junction (`cmd /c mklink /J`); remove that with `cmd /c rmdir` before deleting the worktree, or the delete empties the shared `node_modules`.
- Fee-free checks (checkout root, `PYTHONPATH=src`): `node --experimental-transform-types --test --test-concurrency=1 tests/arc_thin_<name>.test.ts`, `python -m pytest tests/<file>.py`, and the smokes `python -m autoresearch_pi.cli arc-thin-smoke --root runs/<new>` and `python tools/run_foundation_smoke.py runs/<new> <script>` (mock ARC SDK, scripted provider). The foundation smoke's last assert (`system_chars <= 3000`) has failed since 2026-10-16; read the checks line printed before it.

# Project follow-ups

The user asked to preserve deferred discussion items and bring them up at a relevant future opportunity.

- When working on ARC adapter boundaries (A), sub-agent research or parent-child communication (B, C), context compaction and continuity (D), or roadmap reviews (all), consult the open checklists in sections `## A.` to `## D.` of `docs/deferred-research-todos.md`; the dated paragraphs around them are a status log.
- Briefly mention relevant unfinished items and their connection to the current task. Avoid repeated reminders during unrelated work.
- The backlog records deferred work and candidate designs, not authorization to implement every item. Follow the scope of the current user request and recheck current code before relying on historical observations.
