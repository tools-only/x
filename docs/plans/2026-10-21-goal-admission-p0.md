# Goal admission P0 change record

Date: 2026-10-21. Status: implemented and unit-verified; experimental, default off.

## 问题与命题

The r04 root-cause report (§1, §3.1, H1/H2, §6; C:/Users/qi/tmp/r04/meta-harness-rootcause-REPORT.md) records untested goals entering strategy and terminal feedback being dropped by refiner cost filtering. Narrow claim: with goalAdmission=on, protected writes require a structured rival/discriminator/observable kill condition; Route requires runtime-supported evidence; environment falsification changes claim state synchronously without refiner scheduling. A unit counterexample to any of these refutes functional correctness. This removes repeated parent adjudication of malformed admissions and routing of obvious counterevidence. It does not establish better goal discovery or game performance.

Scope: pure state machine, write seams, Route gate, direct outcome edge, unit/fixture tests. No ARC games, providers, critic, experiment queue, observation receipts, consult/frontmatter/focus changes, or ActionAdmission merge.

## 设计与成本

Reuse Workspace's shared write backend and the existing Refusal mechanism instead of separate checks in every author/tool, a new worker, or prose-only rules. Metadata is a fenced `goal-claim` JSON object embedded in the protected document. Runtime owns support, scope, counterevidence and durable events; author-supplied state cannot certify support. Observables use a finite JSON vocabulary, not Python check(t). One claim per protected document in P0; rules goal lines explicitly cite it. Agent judges claim/rival semantics; runtime checks differing, incompatible observable predictions, action bounds, known status overlap, risk and evidence.

Lifecycle: Agent recognizes an opportunity and proposes claim/rivals plus a bounded discriminating test; pre-write runtime validates investment/candidate; existing binder assembles; action runtime observes semantic outcomes, supports/contests/retires and logs; Agent revises or abandons. Removed claims are no longer active; retired identities cannot silently be resurrected. Scope and evidence survive extension restart. New goals require one authored metadata block, no new worker/tool/mandatory model turn. Off adds no resident contract. Shadow logs without refusing or changing projected control. On introduces the requested semantic gate; recovery removes Route/goal text or proposes a revised claim. Permission, workspace confinement, binder versions and environment budgets remain intact; disabling the flag withdraws the experiment without rolling back game history.

## 运行前实验协议

Evidence target: functional correctness only. Compare unset/off, shadow and on using new local unit/fixture tests, synthetic grids and an in-process HTTP bridge double. Provider/model: none. No child runs, paid calls, game engines, or environment actions outside synthetic fixtures. Budget: focused implementation session and bounded unit tests (individual fixtures under 15 seconds); stop on failures, fix only P0. Required negatives: no rival; identical/nonseparating predictions; action bound/risk; busy-line overlap; self-certified support; Route before evidence/after falsification; GAME_OVER, predicted level-change miss and observable kill; stale level; corrections/removal; off/shadow noninterference. No component count or invocation reward. Logs are runtime goal_admission.jsonl plus unit TAP output. Real latency/tokens, cognitive continuity, autonomous adoption and net benefit remain unmeasured.

## 实现与验证

Implemented demo/arc_thin_goal_admission.ts, shared Workspace.beforeWrite in arc_thin_workspace.ts, and extension admission/assembly/Route/direct-outcome wiring. ARC_THIN_GOAL_ADMISSION=off|shadow|on maps to goalAdmission; default off. Shadow computes/logs without refusing or hiding control. Runtime-owned claim state and counterevidence persist in harness/goal_admission.jsonl and workspace/data/goal_claims.json. Status masking is isolated per attempt and cached per action count.

2026-10-21 final: node --experimental-transform-types --test tests/arc_thin_goal_admission.test.ts: 21/21, exit 0, 11049.2852 ms; git diff --check passed. Log: C:/Users/qi/tmp/r04/goal-admission-P0-unit.log. In-memory fetch/side-model doubles only, Node v25.5.0 on Windows/Git Bash; zero real providers, ARC engines or child tasks. No configured standalone typecheck; tests are execution diagnostics. Parent write/edit, refiner FILE and shared guest/restore/move mutation seam covered; actual guest/Pi chain unverified. Counterevidence bypasses exhausted refiner cost cap and large minGap in the extension fixture. Off and shadow behavior, stale Route projection, RESET recovery, level scope, risk/k/busy-line negatives and extension reconstruction tested.

One GoalClaim per protected document. Runtime support means its separating observable prediction was seen, not proof of natural-language goal truth. Rules goals additionally need level-change evidence. TODO: status overlap is checked for declared goal_region/predicted cells only; no reliable prose-to-coordinate extraction. Goal-rule recognition uses generic goal/win/objective/complete/victory/finish/Level N forms; arbitrary semantic paraphrases are not guaranteed. Terminal risk uses declared numbers, without adding meter/receipt machinery. No queue binding/critic/P1-P4 work.

On adds metadata and a contract description, existing author decisions plus mechanical feedback, no worker/model adjudicator/mandatory consult. CPU/I/O and durable snapshot growth are real but unmeasured; no parent+child cost, task-result or cognitive-continuity gain is claimed. Tests prove seams under doubles, never real ARC closure. No change to the ARC acceptance matrix.

| Evidence | Status | Provider/environment | Artifact/boundary |
| --- | --- | --- | --- |
| Functional correctness | Passed, scoped | Node v25.5.0, local unit/fixture doubles | 21/21 tests/arc_thin_goal_admission.test.ts; external unit log |
| Full chain | Unverified | No real ARC run authorized | Requires separately authorized smoke matrix |
| Autonomous adoption | Unverified | No provider | Not inferred from fixtures |
| Net benefit | Unverified | No comparison runs | Parent+child cost/latency/management turns unmeasured |

## 交付决定

Keep experimental/default off: the 21 focused tests passed; real behavior remains unverified. Next falsifiable check outside this authorization: separately approved deterministic real-runner wiring matrix, followed by bounded real-provider comparisons if desired. Deferred goal recognition/feedback and cognitive continuity in docs/deferred-research-todos.md stay open; P0 tests do not close them. Final implementation details and unit evidence are recorded here and in C:/Users/qi/tmp/r04/goal-admission-P0-RESULT.md.
