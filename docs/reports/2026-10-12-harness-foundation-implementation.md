# Harness foundation implementation record

Date: 2026-10-12 (Asia/Shanghai). Status: R0–R6 implemented; scripted acceptance passed. Retained as an experimental foundation; autonomous adoption and net benefit unverified.

## Problem and claim

The final [plan](../plans/2026-10-12-harness-foundation-refactor-plan.md) responds to lost conversation continuity, rejected memory batches and separate skill creation/use procedures observed in the overnight and uncapped runs linked there. Narrow claim: an authorized workspace write produces a versioned, explicit activation receipt and makes a valid component callable in the next real Pi request, while invalid edits retain a visibly labelled working version. This removes publish/revise decisions and hand-maintained capability lists. Autonomous recognition and task improvement require separate real-provider evidence.

Scope: R0–R6 foundation; no paid game comparison. The latest user instruction deprecates Auto-Research in favor of ledger + critic and pauses its work and acceptance runs. The native surface has no Auto-Research tool; explicit bounded `consult` remains. The claims engine remains. Ordinary notes need no ledger upkeep. Reasonable non-use: a one-off computation or an irrelevant component. Falsification: silent fallback, missing next-request activation, context loss, escape or secret exposure.

## Design and cost

Pi retains the authoritative session, tool protocol and prompt sections. Runtime binds files, versions content, advances assembly and delivers receipts; the agent recognizes opportunities, chooses investment, writes candidates, uses results and judges retention/revision/retirement. Writing in observers is explicit opt-in; no extra approval or publish gate. Deletion or `_off` retires a binding; failure retains labelled last-good source. Runtime rebuilds the index rather than asking the parent to maintain it. Resident limits and execution versions are measured in context/execution logs. Permission, budget and ARC history integrity remain enforced.

Recommended D1–D5 accepted by “开始实现”: observers on, level-change review off in native, reasoning replay off, auto-compaction conditional on probe, isolated branch. Base HEAD was `8d832386f8bd2f47860da1de045f59118cb7cf31`; existing dirty source/docs/tests were copied into the isolated worktree and committed as frozen base `737e07e903bcdc5a09a2e08d8cfbd447ea464ecf`. Original checkout left intact. Branch: `codex/harness-foundation-20261012`; worktree: `D:/autoresearch_pi_foundation_20261012`.

## Pre-run protocol

Target evidence: functional correctness and explicitly bounded wiring. Pi pinned to 0.87.0; Node 25.5.0, Python 3.12.7, Windows; scripted provider, zero paid tokens. Test at plan-authorized seams: real RPC input/output, workspace file tool receipts, sandbox semantic results, runner bridge and subsequent parent input. R0 investigates six contracts; later steps add failing behavioral checks before implementation, then focused regression and scripted runner smokes. Each scripted run is bounded by RPC deadlines, runner action/decision limits and process cleanup. Negative cases: abort/unpaired calls, syntax/signature failure, restart, stale level, disabling/deleting components, absolute/traversal/junction escape, protected directories, middle-of-output evidence and denied consult action access. No fixture or script establishes autonomous behavior. Shared-budget provider comparison on ls20/lp85 awaits separate budget authorization.

## Implementation and verification

The installed-Pi probes exposed three assumptions needing adaptation: forced `systemPrompt` omits Pi's skill listing; grep still spawns host ripgrep despite custom operations; raw compaction includes reasoning and loses the middle counterexample. The implementation uses structured prompt sections, confined search with Pi's schema, and a compaction-input projection with exact result references. Auto-compaction remains explicit opt-in.

| Step | Implementation | Scripted evidence |
| --- | --- | --- |
| R0 (`aed7e26e`) | Six installed-Pi RPC contracts, limitations and chosen workarounds | [probe summary](../../runs/foundation-r0-20261012/summary.json); raw compaction 12,990 chars / 1,679 ms, reasoning present, middle evidence missing |
| R1 (`3541a110`) | Per-run canonical session, full retained history, thinking excluded by default; newest grid injected only at projection | [native continuity](../../runs/foundation-r1-native/summary.json), plus final actual compact/restart below |
| R2 (`8477794f`) | Workspace-only Pi file operations, confined grep; protected data/results; public frames and trajectory | [final defaults smoke](../../runs/foundation-final-defaults/summary.json): reads/edits, escape/protected-write refusals, sandbox secret absence, later ARC actions |
| R3 (`c896b8cd`) | Content-hash versions, serialized validation, last-good bindings, activation receipts, next-request index | Binder create/fail/fix/off/delete/restart and overlapping-write tests; final lifecycle smoke |
| R4 (`f078ce86`) | Typed native tools, observers, Agent Skills frontmatter and scripts, prompt sections, roles and bounded consult | [final lifecycle](../../runs/foundation-final-components-lazy/summary.json): 42 → labelled failed fallback → 43 → 53; five types revised/withdrawn, denied child action, observer state/version semantics |
| R5 (`7d43f407`) | Full long outputs saved, concise references, exact ranged reads; adapted compaction input and usage accounting | [real Pi compact/restart/readback](../../runs/foundation-final-receipts/summary.json), [compact RPC](../../runs/foundation-final-receipts/native-compaction-rpc.json), [actual summarizer input](../../runs/foundation-final-receipts/native-summary-input.jsonl) |
| R6 | Partial memory ledger, ordinary notes, idempotent old-store migration, native defaults, explicit legacy comparator | [migration through production extension](../../runs/foundation-final-migration-r2/summary.json): old alias 42, producer artifact update, later reader 52, overlay/note recovery and provenance; partial memory/fabricated-action cases in lifecycle smoke |

Native defaults are the accepted observer/review/reasoning settings. Default ledger + critic resident system prompt measured 2,928 chars, index bounded to 1,200 chars, observer text to 2,400 chars. Active prompts warn above 1,500 chars; derived individual tool schema is limited to 400 chars. [Actual request budgets](../../runs/foundation-final-defaults/harness/context_budget.jsonl) include schemas and retained history. These are characters, not model input-token savings.

Workspace growth initially made unrelated Python calls exceed the existing 384 KiB WASI allowance. A failing 500,000-character unrelated-result test drove on-demand snapshot reads: only referenced bodies enter each guest input; dynamic opens request an exact confined snapshot file and rerun in fresh WASI, with staged writes committed only after success. A call keeps the 20-second deadline and at most 32 read retries. Existing WASI fuel/input/output/memory bounds remain. A deliberately large set of files actually used in one call can still hit those bounds; file `read` with offset/limit remains the exact retrieval path. This avoids increasing sandbox permissions or quotas, but retry latency and full-workspace snapshot cost need real-run measurement.

Functional checks: [thin Node regression log](../../runs/foundation-final-node-tests.log), 100/100 passing with sequential test-file scheduling; 23 focused Python checks passed (CLI routing/defaults, lifecycle statistics, bridge deadlines and blind policy). Individual new tests cover isolation, invalid Python/YAML, typed schema/semantic WASI results, native history pairing, concurrent version order, partial memory, migration and artifact globals. `git diff --check` passes.

After the final migration/provenance and ordinary-file versioning changes, five focused binder/migration/runtime checks passed and the 23 focused Python checks passed again. All agent-written files, including artifacts and skill scripts, are archived/versioned; ordinary files keep normal receipts and do not add capability-index entries. Actual execution logs include those file versions plus the active component versions. Final source ran all four native acceptance modes successfully: [default ledger + critic and isolation](../../runs/foundation-delivery-defaults/summary.json), [component lifecycle](../../runs/foundation-delivery-components/summary.json), [compaction/restart/exact receipt read](../../runs/foundation-delivery-receipts/summary.json), [old-store replay/migration/provenance](../../runs/foundation-delivery-migration/summary.json). All used installed Pi 0.87.0, production bridge and WASI with scripted provider/mock SDK; zero paid model cost.

All six existing thin legacy smokes passed: [base](../../runs/foundation-r6-legacy-default-final/summary.json), [claims](../../runs/foundation-legacy-run_arc_thin_claims_smoke/summary.json), [continuity](../../runs/foundation-legacy-run_arc_thin_continuity_smoke/summary.json), [environment](../../runs/foundation-legacy-run_arc_thin_environment_smoke/summary.json), [self-harness](../../runs/foundation-legacy-run_arc_thin_self_harness_smoke/summary.json), [ledger + critic](../../runs/foundation-legacy-run_arc_thin_ledger_smoke/summary.json). The legacy smoke wrappers select `legacy` explicitly. Ordinary legacy tool limits and behavior remain; the original checkout was not edited.

Protocol deviations and failures retained:

- The frozen original default thin smoke already failed 13 checks because its script exceeded the existing 6/8 tool-call budget before its first action ([original evidence](../../../autoresearch_pi_project/runs/frozen-original-default-smoke/summary.json)). Its wrapper now explicitly requests a diagnostic-only budget of 40, honored only for the expanded-tools scripted provider. This is not a gameplay limit change or evidence of runtime improvement.
- The broad parallel Node suite initially passed 97/98; action-surface Pi startup timed out. Its standalone real-Pi rerun and the sequential 100-test suite passed. The broad Python run passed 44/46; two subsecond process-start deadlines failed under load. A focused rerun passed 22/23 with the remaining 0.3-second startup timeout; the same test passed alone in the original checkout. PiKernel was unchanged. These timing-sensitive results are not erased or counted as complete broad-Python acceptance.
- Before the latest pause instruction, an extra general `arc-harness-smoke` Auto-Research matrix failed at its scripted provider's `(m.content ?? []).filter` on string content, before any action/research. The original checkout reproduced the same failure in the memory case. [Matrix artifact](../../runs/foundation-final-arc-matrix/arc-self-harness-smoke-summary.json). No general Auto-Research closure is claimed. Its further work is paused and is outside this foundation's ledger + critic acceptance.
- The first compact smoke had nothing eligible to summarize; isolated probe settings and three real checkpoint user turns made the target tool turn eligible. The resulting evidence establishes receipt continuity and exact readback, not semantic retention by a real model. The first migration probe inadvertently reseeded stores on each `start()` call; its setup was corrected to seed once, preserving subsequent artifact records.

Opportunity/recognition/investment were prescribed by the script, not autonomously observed. Candidate → assembly → semantic tool use → failed-edit feedback → revise/retire was exercised through actual Pi requests and later actions. The script includes intentional withdrawal and unsupported memory fields; it supplies no game-solving evidence. No opportunity denominator, autonomous abandonment rate, real provider cost/quality or benchmark improvement is established.

| Evidence | Status | Provider / environment | Artifacts and limit |
| --- | --- | --- | --- |
| Functional correctness | Passed within tested cases | installed Pi 0.87.0 / WASI / scripted provider | Node regression, focused Python checks and negative cases above; broad timing failures disclosed |
| Full-chain reachability | Passed for scoped foundation lifecycle | production ARC bridge + real Pi parent/consult + WASI; scripted provider/mock SDK | Workspace write → receipt → next request → semantic result → ARC action → later parent; compact/restart/readback and migration; no Auto-Research closure claim |
| Autonomous adoption | Unverified | no paid model run authorized | Explicit script only |
| Net benefit | Unverified | no legacy/native real comparison | Parent/child tokens, latency, repair turns and levels require budgeted comparison |

## Delivery decision

Retain the implemented foundation as experimental; native is the thin runner default after scripted acceptance, legacy remains an explicit comparator. Further Auto-Research work and its acceptance are paused by the user; no such jobs remain running from this implementation. The next authorized implementation check is ledger + critic/native regression, not research routing.

The next separate, budget-requiring experiment is the plan's frozen legacy/native comparison on ls20 and lp85: same provider/model/reasoning, one hour per arm/game, primary measure levels, plus parent + all child tokens, latency, repair turns, management turns, memory upkeep, repeated refuted tests and stale uses. Stop or revise on extra turns without progress, components never used, or lost counterevidence. Actual paid budget and runs remain unapproved/unstarted. Automatic compaction stays off unless separately selected after inspecting its actual adapted input. Full CLI resume of a nonempty run directory is not added; actual Pi process/session restart and store migration are tested through the runtime.

Relevant [deferred backlog](../deferred-research-todos.md): parent/child semantic delivery, compaction cognitive continuity and total-cost benefit remain open; storage, exact references and deterministic wiring do not close those quality questions.

## First ordinary real ARC observation — pre-run protocol

User authorization on 2026-10-12: “先在新方案实现上执行真实的ARC任务，检查运行情况是否符合预期”. This authorizes a bounded native observation run; it does not start the four-arm legacy/native comparison. One ordinary ls20 task uses the existing real yibu/qwen3.8-27b route, explicit high/qwen thinking, official ARC SDK 0.9.8, installed Pi 0.87.0 and WASI. Model input is text (full current grid); the existing route is configured without image input, so native PNG input is not being evaluated in this sample.

Budgets fixed before launch: 20 actions, 30 decisions, 1,800 seconds, 600,000 reported parent + critic + consult tokens, parent max output 16,384 tokens, each decision 600 seconds and idle timeout 180 seconds. The token cap is enforced between decisions and can overshoot within a turn; wall-clock/output limits also apply. Ledger/critic enabled, Auto-Research absent, level-change review/reasoning replay/auto-compaction off. Keep the ordinary gameplay instructions and empty component workspace; do not supply a solution, force component creation, tune critic triggers, or adjust prompts during the run. No paid retry after a runtime defect without a new recorded diagnostic decision.

Falsifiable expectation: real action → immutable evidence → ledger/current grid → later real model request works without missing tools or native context loss; any voluntarily written valid component has a version receipt and becomes usable at the next request, and failed edits label the working version. Conditional checks include actual semantic use, observer state/version, critic trigger/delivery/revision, partial memory, and long-result retrieval. Absence of component investment or a critic trigger is documented as unexercised, not a functional failure or success. A read-only developer audit extension captures actual HTTP payloads outside the workspace and redacts any secret matches; it returns no content/tools/context modifications. Source hashes before/after detect drift. Stop and preserve evidence on runtime/secret/integrity failure. Primary output is operational evidence and the broken transition if any, with actions/levels/parent-plus-child cost and latency; one uncontrolled sample cannot establish net benefit or compaction cognitive continuity.

Entry: `tools/run_foundation_real.py`; runtime base `d0a76641`, audit/launcher hashes and actual HEAD included in the separate pre-launch protocol. Expected output directory: `runs/foundation-native-ls20-real-20261012-01`. Results pending at this pre-run checkpoint.

### User budget revision before the first action

The user then requested “修改为100个动作；不设时间和token上限”. The old-limit Pi process was stopped deliberately and the runner closed the official bridge normally: zero ARC actions, zero completed decisions, one in-flight model request with unmeasured usage. Its `pi_failed` summary is a user reconfiguration interruption, not a native runtime defect. [Preserved first attempt](../../runs/foundation-native-ls20-real-20261012-01/summary.json); source remained unchanged during that attempt. Do not treat its missing reported usage as zero cost.

Revised protocol: one new ordinary official ls20 run, native, maximum 100 total actions; no experiment time, total reported-token, or decision-count cap. Provider output capacity (configured 65,536), tool/WASI bounds, 900-second per-decision fault timeout, 180-second idle timeout and environment rules remain. Ledger/critic/reasoning/compaction settings and ordinary guidance stay as above. New directory: `runs/foundation-native-ls20-real-20261012-02`.

The runner previously treated timeout `0` as the default 12-hour experiment deadline. A failing real-Pi/scripted-provider check demonstrated a remaining-time line in the actual parent input. Explicit zero now disables the run deadline, omits the runtime deadline environment variable and gives PiKernel no session deadline; unspecified/default or positive timeouts preserve previous behavior. [Red](../../runs/foundation-no-deadline-red/summary.json) / [green](../../runs/foundation-no-deadline-green/summary.json) artifacts; CLI/config regression 10/10 passed. This single-factor configuration change is required to implement the user's revised authorization, not a gameplay optimization. The run-config records timeout `0` as disabled; the separate protocol states the effective experiment cap as null.

### Compaction correction and ordinary adoption diagnosis (side conversation, 2026-10-12)

Real failure: the observation launcher explicitly disabled automatic compaction, and the native hook returned `customInstructions` although installed Pi 0.87.0's `SessionBeforeCompactResult` accepts only `cancel` or `compaction`. Its actual scripted summarizer input lacked the ARC requirements. The previous completion statement established receipt projection/readback, not correct summary instruction delivery or automatic compaction lifecycle.

Claim: native manual and automatic compaction will use Pi's exported summary engine with ARC requirements, projected reasoning-free history and exact result refs; Pi retains threshold/overflow scheduling, session checkpoint saving and subsequent history projection. Native defaults enable this feature, with an explicit off switch; legacy defaults stay unchanged. This removes the user's need to manually manage growing history. No adoption prompt/gate or worker is added.

Work is isolated in `codex/native-compaction-fix-20261012`, worktree `D:/autoresearch_pi_compaction_fix_20261012`, from frozen `a3a942cc`. The live 100-action run's sources/configuration are not changed. Existing plan-authorized seams: installed Pi RPC, actual provider input, session summary and later exact file read. Tests first reproduce missing instructions, then verify manual and automatic threshold compaction, restart/readback, usage and the explicit-off negative case. Mock ARC SDK and scripted provider only; no additional paid experiment. Functional/wiring evidence cannot establish real summary cognition or net benefit.

The user's request also authorizes read-only diagnosis of ordinary component creation/use and explanation of memory ownership. Record observations separately from causal hypotheses; no forced creation or gameplay intervention is authorized by a request to analyze.

Correction implemented: the hook returns `{compaction}` generated by Pi's exported `compact()` with registry-resolved credentials/transport, current thinking level and native abort signal. Pi retains threshold/overflow scheduling, checkpoint format, persistence and projection. Pi's separate split-turn prefix generator has no custom-instruction argument, so requirements enter its summary-only input, never the gameplay session. Native runner/CLI and future observation launches enable automatic compaction; `--no-auto-compaction` or environment `ARC_THIN_AUTO_COMPACTION=0` disables it. Unspecified CLI values preserve native/legacy defaults. No dependency patch is used. The public engine/registry path does not access or claim equivalence to private AgentSession retry callbacks.

Test-first: [missing instructions](../../runs/compaction-instructions-red/native-summary-input.jsonl), [automatic default off](../../runs/compaction-auto-default-red/summary.json), and CLI routing checks failed before correction. Final installed Pi/production bridge/WASI runs pass: [manual/off-switch](../../runs/compaction-final-manual/summary.json), [automatic threshold](../../runs/compaction-final-auto/summary.json) and [native threshold event](../../runs/compaction-final-auto/native-auto-compaction-event.json), [split turn](../../runs/compaction-final-split/summary.json), [component lifecycle](../../runs/compaction-final-components/summary.json), [default ledger/critic](../../runs/compaction-final-defaults/summary.json), [migration](../../runs/compaction-final-migration/summary.json), [legacy continuity](../../runs/compaction-final-legacy-continuity/summary.json). Every actual summarizer input includes ARC requirements; checkpoints reach later parent requests; a middle counterexample is read exactly after restart; usage is recorded. The automatic case uses explicitly synthetic reported usage to cross Pi's threshold, with no manual compact command. Summarizer replies and ARC SDK are mocked. [Node regression](../../runs/compaction-fix-node-tests.log) passes 101/101; CLI/config/lifecycle Python checks pass 16/16; whitespace checks pass.

Diagnostic failures retained: a first correction used nonexistent `ctx.getThinkingLevel`, fixed to `pi.getThinkingLevel`; a first automatic test awaited an already-consumed event although Pi had saved its checkpoint; the collector now retains/inspects compaction events. An assertion treated transcript arrays as strings and was corrected. These failures are not acceptance. No paid model call or live-run reconfiguration was performed.

| Layer | Status / environment | Limit |
| --- | --- | --- |
| Functional correctness | Passed: requirements/refs, on/off defaults, manual/automatic/split checkpoints, readback | Scripted summaries do not prove semantic retention |
| Full-chain reachability | Passed: Pi engine → checkpoint → restart → parent/read/action; production bridge/Pi/WASI | Mock SDK; no Auto-Research claim |
| Autonomous adoption | Unverified for real automatic compaction; ordinary creation diagnosis below | Active real sample remains on frozen old configuration |
| Net benefit | Unverified | No matched real-provider comparison |

Ordinary diagnosis snapshot: 2026-10-12 22:19:51 Asia/Shanghai, 22 actions, real yibu/qwen3.8-27b and official SDK. [Snapshot](../../runs/adoption-diagnosis.json) includes source integrity, actual guidance and call summaries; live source hashes still match the launch manifest. Tool calls: Python 18 including a refusal, read 7, memory 14, actions 22, ls 3. No write/edit/consult/named-tool call; one ordinary note version; no enabled tool/observer/skill/prompt/role or failed component candidate.

Opportunity → recognition → investment: paired-frame diff calls 6–8 and subsequent diffs, plus repeated room/path computation, are plausible reuse opportunities. The parent keeps one-off code and stores conclusions in memory. All five authoring conventions and the no-publish lifecycle are present in actual input. No recorded proposal/write advances a candidate: the observed missing transition precedes candidate formation, rather than failing validation/routing/activation. Runtime advances mechanical transitions only after the parent chooses and writes a candidate. No semantic use or retain/revise/retire decision is observed for these component types.

Causal explanation remains provisional. One-off calls avoid upfront authoring; saving a tool reduces code repetition but not necessarily invocation count, whereas an observer can remove later parent requests. The first turn shows uncertainty about Python workspace writes, repeated ASCII rendering/readbacks and the six-call soft limit: local friction, not proof of causation. The transcript has no explicit reuse-investment decision. Prompt/role/skill absence is not by itself a missed opportunity; no specialist need or standing-prompt correction is established. No forced creation is added. Next falsifiable check: vary one authoring affordance on a bounded repeated-method task and measure first semantic reuse, management turns and parent-plus-child cost; deferred, not launched.

Memory ownership: `memory.jsonl` independently owns facts, hypotheses/check definitions, tests, strategies and revisions; `trajectory.jsonl` owns actions and scored predictions. `buildLedger(trajectory, observations, grids)` derives experiment/repeat/goal-check views. Critic joins them; it neither owns nor copies memory into action entries. Free text belongs to notes, procedures to skills, standing instructions to prompts. At the snapshot, 22 memory events are 12 fact updates, 5 hypothesis updates, 3 deletions and 2 strategy updates, not 22 current beliefs. Knowledge persistence is happening while reusable method persistence is absent. “Memory on the ledger side” conflated structured-belief and action ledgers. Storage already separates their authorities; duplicating beliefs into notes would create competing truth sources.

## Ordinary ls20 failure and optimization backlog (2026-10-12)

日期：2026-10-12，Asia/Shanghai。状态：诊断与待优化记录；用户本轮授权记录，未授权本轮启动新实验。此节是本次失败及相关 Foundation 缺口的统一待办真值源，不复制为另一套实施计划。文档保存在独立 `codex/native-compaction-fix-20261012` 工作树；本轮只更新文档，不改变运行配置或实现。

### 问题、命题与范围

真实样本：yibu / qwen3.8-27b / thinking high，Pi 0.87.0，官方 ARC SDK，native foundation；总动作上限100，总 token/决策/实验时间无上限，仍保留180秒空闲超时。启动源保持冻结，自动 compaction 关闭；独立分支的 compaction 修复没有进入此样本。

- [最终 summary](D:/autoresearch_pi_foundation_20261012/runs/foundation-native-ls20-real-20261012-02/summary.json)：37动作、0/7关、NOT_FINISHED、8167.4秒、3,239,113 reported tokens，`stop_reason=pi_failed`。
- [实际 provider 输入](D:/autoresearch_pi_foundation_20261012/runs/foundation-native-ls20-real-20261012-02/runtime-audit/provider-inputs.jsonl)、[Pi 事件](D:/autoresearch_pi_foundation_20261012/runs/foundation-native-ls20-real-20261012-02/pi-events.jsonl)、[轨迹](D:/autoresearch_pi_foundation_20261012/runs/foundation-native-ls20-real-20261012-02/harness/trajectory.jsonl)、[usage](D:/autoresearch_pi_foundation_20261012/runs/foundation-native-ls20-real-20261012-02/harness/usage.jsonl)、[memory](D:/autoresearch_pi_foundation_20261012/runs/foundation-native-ls20-real-20261012-02/harness/memory.jsonl)、[critic](D:/autoresearch_pi_foundation_20261012/runs/foundation-native-ls20-real-20261012-02/harness/critic.jsonl)。

停止链：22:59:36第37动作正常返回；23:01:01 Python 正常返回，发起第90次父 provider 请求；之后180秒没有新 Pi 事件；23:04:03终态落盘。此前两次空闲恢复已消耗整个运行的恢复额度，第三次超时直接抛错，未执行第三次恢复。代码见 [safe_turn](D:/autoresearch_pi_foundation_20261012/src/autoresearch_pi/arc_thin_e2e.py:739)。`pi_failed` 是 runner 分类，不能据此断言 Pi 崩溃或 provider 宕机。ARC action 链路最后仍正常；scorecard close 的404发生在收尾。

统计口径修正：90条父请求记录对应87个正常 `toolUse` 回复、2个 aborted 回复、1个最终未完成请求；另有2个 critic 回复。此前把89条父 usage 行称为89次完成调用不够精确，36动作截面的87条也含2个 aborted。总量加和正确，但 aborted 的 provider usage 为零，不代表没有计算/计费；第一个 aborted 回复实际已有5461字符 thinking。最终未完成请求的用量未知。因此3,239,113是已报告量，不是已确认的完整成本。已报告分项：非缓存输入921,941，cache read 1,893,120，输出424,052，其中 reasoning393,699；reasoning已包含在输出内，不能再次相加。critic共8,488。

任务语义链：第12动作出现50个玩家区域变化和8个左下图案变化。父编写的分析按颜色9/12分类，把左下图案并入玩家；1807字符结果只展示400字符前缀，关键行进入精确引用；两次引用抄错读取失败；重算仍按颜色分类；进一步打印坐标触发6次工具软限并结束该决策。随后父把图案视为装饰，转向耗尽条。停止前最后一次 Python 才按玩家区域分离出8个左下变化。这里只证明一个线索未被及时推进，不证明图案的真实游戏规则或正确通关路线。

总命题：移除已观察到的恢复、定位和取证摩擦，能够减少非游戏管理往返，同时保持 canonical 动作与完整证据；是否改善规则修订、自主复用或通关，必须逐项另测。负例：更多重试但无进展、短 receipt 遗漏关键信息、强制记账或组件创作增加成本、压缩后回退到已排除解释。合理不使用：一次性计算、无适用职责的 role/prompt/skill、精确 refs 足以处理的历史。范围覆盖本次已观察问题、先前实现报告尚未验证的运行质量与成本；不扩展为全项目重构。

### P0：运行完整性和可诊断性

P0表示优先处理，不表示每项已证明是本次停止的原因。

| ID | 证据与当前状态 | 待修正/窄命题、成本及下一验收 |
| --- | --- | --- |
| O01 | **已确认停止原因**：`safe_turn`以全运行累计2次恢复作为终止条件；取消总时间上限未取消此条件。 | 明确分离用户总预算、单请求无进展检测、连续故障恢复与不可恢复错误。优先复用原生 abort/settlement，比较按连续失败而非终生额度计数；不把无上限解释成无条件立即无限重试。诊断用三次彼此隔开的故障、连续永久故障、用户取消和动作已提交场景；成功标准是可恢复故障后正确继续、无重复动作、无失控重试/新增模型管理轮。先诊断再实施，预算完整性必须保留。 |
| O02 | **诊断缺口**：最后只记录到 `before_provider_request`，没有 HTTP 响应头、首流片段、最后流片段、错误和重试阶段；无法区分 provider/网络/Pi 等待。 | 增加开发侧 request ID 和阶段时间，关联父/critic/compaction/consult、事件、usage及取消。优先现有 hooks/transport，秘密不入日志，任何代理不得成为 agent 新权限。测无响应头、首 token 慢、流中停顿、正常长流；日志写入开销单独量化。现有 kernel 会用被投影丢弃的 raw delta 重置空闲计时，不应再次把长流误判为空闲。 |
| O03 | **恢复验收缺口**：已有 abort 后 settlement 路径，本次两次恢复可达；native session、真实动作提交和重启组合仍需更强故障验收。 | 验证持久 session、workspace版本、memory和bridge动作一致；围绕动作提交前/后断流、abort未结算、重启测试精确下一动作，既不重放已提交动作也不丢孤立结果。优先复用现有 canonical 轨迹和提交编号，不新增父确认步骤；重复动作或错版本即失败。 |
| O04 | **修复已有、运行集成未验**：独立分支已启用 native默认自动压缩并把ARC要求交给实际 Pi compact；本次冻结样本未使用。 | 在下一次明确采用修复源的运行核对最终 CLI/env、实际 summarizer input、checkpoint和后续 provider input。175k配置下约65k输入不能证明达到阈值；不得声称启用后立刻降成本。安装版本与公共 compact 路径保持，审计自定义调用对原生认证、取消、错误/重试行为的覆盖，不能冒称私有 retry callbacks 等价。已有脚本通过不替代真实模型留存验收。 |
| O05 | **报告口径问题**：summary decisions40与扩展decision44语义不同；失败/取消 usage为0、最终请求无usage，当前报告容易把缺失当零或完成。 | 明确请求尝试、完成、aborted、未完成、父决策、恢复/合并轮及canonical动作的计数；分列缓存/输出/reasoning/critic/未知成本。定期和终态summary注明更新时间及结算状态。以本次90父请求/87正常/2取消/1未完成、37双侧确认动作作对账负例；未知成本不估零、reasoning不重复加。不增加gameplay字段。 |
| O06 | **独立收尾故障**：`/scorecard/close`返回404，不能当成主要退出原因；最终官方scorecard未确认。 | 核查当前SDK/API关闭路径、scorecard生命周期和已有关闭状态，分别记录主故障与收尾状态；可恢复关闭采用幂等路径，不重启游戏或覆盖原始故障。先用保存的响应诊断，再验证正常/已关闭/失效scorecard。不将缺少scorecard当游戏胜利或零分的完整证明。 |

### P1：父决策负担、证据利用和方法复用

以下候选需要一次只改变一个主要因素。禁止把此表、开发流程或解题结论注入游戏system prompt。

| ID | 证据与当前状态 | 待优化/窄命题、成本及下一验收 |
| --- | --- | --- |
| O07 | **实际引用摩擦**：长哈希文件名两次抄错，父转而重复计算。 | 比较保留hash真值但提供短、稳定、可精确读取的workspace引用；优先机械alias/现有read协议，不做模糊匹配或静默选错结果。核查创建/重启/同内容去重/过期/失效/路径隔离，测首次精确读取与管理往返。不得牺牲字节完整性或版本标识。 |
| O08 | **预览遗漏关键行**：1807字符全结果被收据化，400字符前缀在第12行截断；储存完整不等于父识别重要性。 | 比较小结果直接展开、按行截断与原阈值，或由作者明确输出简短摘要＋完整结果；runtime不得推断哪项游戏证据重要。保持整结果精确refs，统计resident输入与额外read成本。用中间/尾部反例、完整长结果、无重要变化负例验证；先诊断结果读回，再评估真实父利用。 |
| O09 | **取证被程序门槛截断**：两次read失败和重算消耗同一6次工具额度，打印异常坐标被拒绝；下一决策带“此前无动作”要求。 | 审计现有6/8软硬工具限、原生续轮和动作结束边界是否仍符合native设计。比较去掉过时流程约束、区分修复读取与无效循环等简化方案；不要先加“必须调查完”新门禁。保存本次序列验证证据读回可达、仍一决策至多一真实动作、重复调用能够止损。对正常短决策测无新增轮次，针对永久错误/无限read保留负例。 |
| O10 | **父分析代码的分类错误，非runtime丢像素**：共享颜色9把HUD变化并入玩家，`block occupies: 7 23 30 58`已暗示区域异常却未推进。 | 在重复差分机会中比较完整坐标/区域分类与单纯颜色分类的使用；先保证现有公开delta/区域证据进入父输入，避免再建冗余常驻工具。游戏规则推断交父，不把本次答案写进通用观察器。诊断要求能发现移动区域外的变化、追溯具体动作；真实验收看父是否自主检验关系。不能据8个变化直接宣称通关规则已知。 |
| O11 | **台账未形成语义证据链**：7次hypothesis写入、0记录evidence/0refutations，4个假设删除时无结构化反驳；删除信息仍有提示，不能说全部遗失。 | 比较复用已有真实动作引用、partial memory批处理和条件化结果表达，降低“事实→测试→修订”的记录成本；不增加强制字段或必须复盘。测试同一条件成立/不成立、替代解释、跨关失效、删除/重建/错误字段。真实验收看后续行动是否保留反例和改变预测，记账次数不作奖励。 |
| O12 | **动态状态与稳定知识混合**：最新memory仍写第25步bar=19，运行到37已是7；父多轮重述/reconcile。 | 审计现有at/证据来源投影，区分稳定控制规则和某动作时刻状态；当前观测仍为状态真值，历史认识不能伪装成当前。优先去重/按条件失效，保留可追溯全文；不要求父每动作更新同一事实。核查恢复/跨关后反例与策略适用性，测重复协调推理、当前错误状态引用和常驻字符。 |
| O13 | **critic可交付但语义帮助不足**：第12/21步反馈后父放弃原目标；之后像素预测大多命中，仍重复耗尽条，未围绕HUD变化验证。 | 分别评估触发覆盖、反馈质量和后续采用；比较现有台账证据复用能否捕捉条件过度否定/遗漏非玩家变化，而非只看预测MISS。保留支持“暂不调用”的负例；不添加固定频率worker或强制review。逐条审查反馈引用、是否推翻正确范围、是否陈述已验证，测父子成本和有效实验而非note数。 |
| O14 | **推理与往返成本高**：累计393,699 reasoning、约92.8%输出；多段“马上执行/重新考虑”重复，尚无复用组件减少决策。 | 单独比较同模型推理设置/请求形态或方法复用，保持其它因素不变，测完成实验、关卡进展、父子总token、延迟和管理轮。用户无总token/时间上限仍保持；不擅自降thinking、截reasoning或新增总预算。收益条件必须同时约束任务退化，token减少本身不等于改善。 |
| O15 | **自主复用断点**：重复diff/路径计算，却未写可复用tool/observer；五类创作规则实际可见，无候选验证失败。 | 优先诊断“识别→投入→候选”，先比较一个创作入口因素对重复方法首次获益的影响。Tool需write→装配→调用；observer可在后续轮机械执行，区别调用次数和省下的父决策。分别追踪tools/observers/skills/prompts/roles的适用机会、合理非用、放弃和语义使用；prompt/role/skill没有明确机会时不得要求创作。不以五类齐全/调用次数为任务奖励，不恢复Auto-Research。 |
| O16 | **运行设计仍有旧常驻义务**：native虽关闭跨关forced review，本次仍保留25动作consolidation，发生1次；效益没有单独验证。 | 审计固定合并轮、force-action/recovery prompt与native retained history/partial memory是否重叠。先比较移除重复机械步骤，保留必要动作/版本/环境边界；每次只消融一项。核查合并是否丢证据/错写状态及移除后自主维护成本，不能把本次取消全部归因于consolidation。 |

### P2：质量与净收益验收缺口

| ID | 当前状态 | 下一检查和判定标准 |
| --- | --- | --- |
| O17 | **真实压缩后的认知连续性未验证**：脚本证明actual input/checkpoint/readback，未证明真实Qwen保留中间反例或能恢复并利用。 | 在另行明确启动的运行保留压缩前后实际请求与行为，核查控制、反例条件、开放实验、当前策略、版本/refs；必要时精确读回。若回到已否定解释或refs存在但未利用，认知声明失败。分别测压缩调用成本与之后resident变化，不能预设净节省。 |
| O18 | **WASI按需读取/快照成本待测**：既有修复避免无关workspace增长耗尽输入配额，但至多32重启读取的真实延迟与大型workspace快照成本未量化。 | 用实际相关/无关文件集合分别测快照字节、rerun次数、CPU/墙钟与输入/fuel失败；保持现有权限/燃料/时间界限。观察到瓶颈再优化，不先提高限额或引入host执行。 |
| O19 | **legacy/native及ls20/lp85净收益未建立**：本次单轨迹失败且未用新压缩修复，不能归因于整个foundation或compaction。 | 对照须记录实际源hash、版本、provider/model/thinking、初态、完整轨迹、动作预算及stop原因；按最新授权准备协议，不自动启动付费。分别报告功能、全链路、自主采用、净收益；重复独立样本比较关卡/有效实验、已知和未知父子成本、延迟与管理轮，不事后挑指标。历史不同轨迹只作诊断。 |
| O20 | **原生特性与组件生命周期运行验收待巩固**：已有五类脚本装配/失败回退/语义结果、workspace隔离/秘密分离和迁移证据；普通模型没有组件候选，不能据此声明组件实现坏了或普遍收益。 | 在改O01/O04/O07/O09前后保留file confinement（links包括）、API key/bridge token隔离、typed tool与observer版本标签、skill/prompt/role启停、consult动作权限、partial memory、迁移和legacy冻结回归。真实自主使用另验，特别检查下一请求激活和失败版本仍明确标记。保持一条create-edit-use路径，不新增SDK/publish/revise手续。 |

### 选择、生命周期与预定验证

优先顺序：O01–O03恢复与定位 → O04生效配置 → O05–O06完整结算 → O07–O10读回/取证 → O11–O16逐因素语义与减负实验；O17–O20按关联改动安排验收。O04的代码已修复，后续重点是集成与真实证据；其余为待办/候选，不声称已实施或有效。

开发Agent推进诊断、测试、候选实现及已有授权内机械验收；runtime推进版本、装配、调用结果/refs和执行归位；游戏父Agent识别机会、选择投资、判断解释/保留/修订；critic只承担既定证据审查。机会→识别→投入→候选→装配→语义使用→反馈→保留/修订/退役均保留证据，并计合理非用和放弃。发现并不自动授权新worker、游戏动作或付费实验。

每个候选实施前补充具体协议：一个主要变量、可推翻命题、负例、对照、样本数和证据层级。先用保存实录和确定性故障做功能/接线诊断；真实模型实验须明确启动授权，沿用用户100动作、无总token/时间上限偏好，局部工具/网络限制与故障停止政策明确展示。不凭本表新增总资源上限。模型费用含父/critic/consult/compaction及未知失败流，耗时区分并发墙钟与调用负担。

本轮验证仅为文档核对：配置、终态、事件/usage数量、关键工具参数/结果与当前源码相符，检查本次Markdown链接及diff。没有新的功能修复、smoke或真实provider运行。判断无进展或增加负担时退回原行为/修订候选；canonical ARC历史不回滚。

| 证据层 | 本次结论 |
| --- | --- |
| 功能正确 | 既有Foundation/compaction脚本证据见前文；本次确认超时/引用/配额行为，不宣称待办修复通过。 |
| 全链路可达 | 普通官方ARC/Pi/WASI完成37动作；真实模型使用压缩修复、故障后第3次恢复及新引用方案未验。 |
| 自主采用 | memory与普通笔记有记录；无五类可复用候选；方法复用和条件化反证采用未支持。 |
| 净收益 | 未验证。单次0关、链路提前停止且失败成本未知，无法建立对照净收益。 |

关联 [B/C/D延后事项](D:/autoresearch_pi_compaction_fix_20261012/docs/deferred-research-todos.md) 的证据→行动、父子总成本和跨压缩认知连续性仍开放。Memory已独立保存，不迁入action ledger、不重复复制为notes；Auto-Research继续弃用。优先验证具体断点，避免用更多常驻提醒、字段或组件计数掩盖它。

### 最终优化路线：方案交付，未实施

用户要求结合O01–O20及推理减负建议制定完整最终方案。已保存[最终优化实施方案](../plans/2026-10-12-harness-foundation-final-optimization-plan.md)：A恢复/诊断/对账 → B精确读回/原生压缩/旧手续减负 → C条件化知识修订 → D自主复用/WASI实测 → E真实连续性与独立收益对照。此节继续作为状态与验收产物的唯一记录；方案只规定执行顺序，不复制待办状态或启动实验。

O11补充已确认实现缺陷：native `memory(op='delete', delete=[...])`成功删除后额外报告空单条删除未应用。源分支仍有该条件，见[最小native/legacy复现](D:/autoresearch_pi_foundation_20261012/runs/foundation-native-ls20-real-20261012-02/diagnostics/memory-critic-reproduction.json)。先修回执，再评估语义采用。现有check保存即回放已接线，compaction已在`f843cddd`修复；两者优先兑现现有能力，不重建入口。三个隔离故障恢复、动作提交前后对账、unknown成本、短ref、被阻挡前提的None与critic引用范围分别验收。

方案保留reasoning high、最新完整grid、workspace/WASI和单步ARC边界、台账+critic及合理非用。primary observer隐藏grid、guarded plan自动动作作为独立后续实验；不引入强制晋升、按推理词面自动触发或按未使用次数自动退休。新真实运行沿用100动作、无整场时间/token/decision上限偏好，但本轮仅设计，未授权/启动额外样本；单请求fault policy和样本数需在启动协议明示。

本次检查是当前源码/既有证据核对、O01–O20覆盖、引用及文档差异检查；没有新runtime实现、测试通过声明或模型调用。功能、接线、自主采用、净收益仍按前述证据状态分别报告。方案完成不表示O项已关闭。

2026-10-13用户补充：推理成本、效率和offload是self-harness核心目标；Agent应优先复用适用组件，将预期重复的基础方法沉淀，减少重新推导流程的token负担。已据此更新同一最终方案的Goal、核心决策原则、D1和验收：O14/O15贯穿B/C/D，首个候选是现有native提示中的简短复用优先级，详细说明按需；不同时改变接口或加入强制晋升。当前native提示只说明能力接口，尚未明确此偏好。后续需验证实际流程替代、首次投入与摊销、输出/维护成本、状态适用性和总任务收益；组件数量不能证明offload。一次性或不可摊销工作保留直接推理。此次仅修订设计，生产prompt/runtime未变，功能、接线、自主采用和净收益不新增通过声明。

## Optimization implementation and restart (2026-10-13)

状态：用户后续明确授权“更新完整方案并实现，然后重新开启ARC实验，并打开compaction开关”；此前“仅文档/未实施”保留为历史阶段。本节是这次变更记录，统一维护O01–O20的最新状态。工作树 `D:/autoresearch_pi_compaction_fix_20261012`，分支 `codex/native-compaction-fix-20261012`，底座 `f843cddd`；原 checkout、旧普通样本及冻结 `a3a942cc` 源保持不变。Auto-Research继续关闭，采用台账+critic。

### 问题、命题和减负

问题与原始证据沿用上节37动作/0关的普通样本。窄工程命题：隔离故障不再共享终生两次额度；确认已提交的动作不会因恢复重发；完整结果能以短精确引用恢复；调查不再被native六次统一配额截断。反例是第三组独立故障失败、重复动作、错误引用或结果/状态冒充。语义命题另验：历史来源和有条件check/critic材料是否帮助修订；self-harness是否实际承担后续重复流程而减少父重新推导。一次性、变动快或无法摊销的工作允许不创作组件。

首次获益仍为同一次write/edit→binder回执→下一请求装配→真实语义调用；没有publish/revise、ROI必填字段或新worker。父推进识别/投资/语义使用/修订，runtime推进版本、机械读回与执行归位，critic提供建议。取消native固定25动作合并轮及统一6/8调用配额，保留单步动作、权限/版本、局部执行界限和连续无进展保护。新增常驻提示只有简短推理成本/优先复用原则及来源/check解释；实际默认输入仍满足3000字符工程基线。没有将开发流程写进游戏上下文。

### 实现入口与O项状态

| 范围 | 已实现行为 | 声明边界 |
| --- | --- | --- |
| A1 / O11 | native批量delete仅报告实际删除结果；partial memory保留有效项，动作证据完整性拒绝仍原子 | 回执正确不等于父解释正确 |
| A2 / O02/O05 | request-events区分parent/critic/consult/compaction、attempt及结算；Pi公开响应事件记录status/time，侧调用也接入onResponse；RPC发送/确认/settlement另记 | 不写headers/auth/delta正文；真实HTTP发送和原始chunk仍未暴露，message_start不当首token；全零usage占位为unknown，非零失败为partial，下界不是账单 |
| A3 / O01/O03 | 每组最多2次连续恢复，累计只统计；abort→settle→bridge/state/trajectory核对；提交完成不再调用恢复模型；死进程重开原session，Windows闭管道错误可恢复 | busy/uncertain、计数冲突、未结算或连续耗尽停止；bridge提交但未写trajectory不猜测重建、不重发 |
| A4 / O06 | 正常/重复close保存结果；不可重试4xx独立标failed，404不能当已关闭；网络/5xx仅一次有限关闭重试；已确认动作/关卡保留 | SDK查询仅用安装0.9.8已有get_scorecard方法；真实官方404/网络收尾待新样本验证 |
| B1 / O04/O17 | 实际源沿用原生compact修复；默认脚本不再显式关闭；启动读取Pi get_state确认effective开关；审计实际compaction policy | ON不表示普通真实运行已触发；O17认知连续性仍开放 |
| B2/B3 / O07–O09 | 全文不可变短ref如results/r000001.txt；SHA/长度保留；宿主index不暴露；旧哈希ref可读；带行号整行首尾预览和遗漏/partial标记 | 默认inline1500保持；3000仅可配置候选，未宣称收益；跨宿主并发去重未建立 |
| B4/B5 / O10/O16 | native不再通用6/8调用截断；相同无进展读取/失败连续3次有界停止，状态/参数改变可继续；native周期合并默认0，legacy25保持 | 合理调查可超过6次；无限不同调用仍受单请求fault policy/局部执行边界，不冒称全局无限循环已解决 |
| C1 / O12 | fact来源action号live/replay一致，native投影标历史记录及当前适用性；当前canonical观测仍为状态真值 | 不自动把自然语言归类/过期，不证明消除错误状态引用 |
| C2/C3 / O11/O13 | 兑现已有check保存即回放/后续增量；True/False/None/error分开；native critic补条件范围和实际变化/精确帧引用，40项以上明确partial | 不强制check；critic触发政策保持，覆盖/语义质量/父采用分别待测 |
| D1 / O14/O15 | native实际生产输入表达：推理token是任务资源、先复用适用组件、可摊销方法一次沉淀、把推理用于解释与新实验 | high-qwen保持；没有按调用/组件数奖励，未证明真实模型会offload |
| D2 / O18 | 宿主日志计快照扫描/读取字节/时间、guest输入、queue/start/compile/instantiate/guest/host、lazy-read次数；pool取消listener清理 | 公共工具返回协议不变；fresh host启动无法独立计量时null；阶段可能重叠，不能相加当墙钟；先测，不引入未经证明缓存 |
| E / O19/O20 | 当前Pi/bridge/WASI接线与legacy检查；一次普通真实运行协议；比较设计保留 | 12次独立比较未授权、不启动；primary observer隐藏grid和自动计划动作仍为独立后续实验 |

WASI仍为CPython/WASM、Wasmtime49.0.0，WASM SHA不变。可信宿主runner为新增计量而改变，因此本次runner SHA/源码hash是新版本，不能声称与旧样本逐字相同。编译/启动/快照指标写宿主日志，不进入guest结果对象或agent工具回执。

### 功能、接线与负例验证

每项修改先有针对性失败再修复：批量删除虚假拒绝、无短ref/截断预览、统一quota、取消/未知用量、缺失WASI分项、pool listener泄漏、consolidation恢复错误请求动作；独立评审又发现completed全零usage误记known-zero、Windows死进程stdin及close flush错误，均补RED→GREEN。WASI metrics曾误入公共value导致两个Node回归失败，修为host回调后复查。

- [最终Node回归](../../runs/optimization-node-final-20261013.log)：112/112，含实际WASI、路径/links/版本、native history、Pi0.87六项基础probe。[最终针对性Python回归](../../runs/optimization-python-green-20261013.log)：64/64。
- 扩大检查出现旧generic `task_harness_create` 两项失败，在未修改冻结 `a3a942cc` 上复现同名断言；[冻结基线日志](../../runs/optimization-legacy-framework-baseline-20261013.log)。没有把这两个无关旧framework测试包装成已通过，亦未为强行变绿改写其行为。
- [有效开关与审计](../../runs/optimization-effective-audit-green-20261013/summary.json)：actual Pi/native默认ON；实际policy为reserve16384、keepRecent20000、context175000，实际provider input包含offload原则；scripted provider/mock SDK。
- [组件与consult长度续轮](../../runs/optimization-telemetry-consult-20261013/summary.json)：actual Pi+生产bridge+WASI、scripted provider/mock SDK；typed tool计算42→43→53、错误版本回退标签、prompt/skill/observer/role启停、partial memory和后续父轮通过；consult长度后取得语义结果且无动作权限，31attempt=25parent+6consult。
- [手动压缩/重启/精确读回](../../runs/optimization-receipts-green-20261013/summary.json)、[自动阈值压缩与统计](../../runs/optimization-telemetry-compaction-20261013/summary.json)、[split-turn](../../runs/optimization-split-compaction-20261013/summary.json)、[迁移](../../runs/optimization-migration-20261013/summary.json)通过；不是普通模型认知证据。自动fixture用诊断阈值及合成用量，真实运行不沿用低阈值或mock用量。
- [第三组隔离idle](../../runs/optimization-idle-control-20261013/summary.json)：4动作/3恢复、3取消用量unknown；[提交后进程死亡](../../runs/optimization-process-restart-20261013/summary.json)及[轮间关闭stdin](../../runs/optimization-closed-stdin-green-20261013/summary.json)：4动作/1restart；bridge与trajectory均1–4，无重复动作。旧组累计2次不会阻断第三组。
- [普通父length](../../runs/optimization-parent-length-20261013/summary.json)和[已提交后length事件](../../runs/optimization-committed-length-20261013/summary.json)：各4动作/4decision，后者恢复请求0。
- [native check回放/增量及8次不同读取](../../runs/optimization-native-claims-final-20261013/summary.json)：#1/#3正确check holds、错误check fails，#2非适用None；compile错误可见不撤销有效假设，后续实际父请求收到holds2/n/a1；不因超过6次读取截断。检查到的适用性不是自主科学解释能力。
- 六类legacy检查（[base](../../runs/optimization-legacy-base-20261013/summary.json)、[claims](../../runs/optimization-legacy-claims-20261013/summary.json)、[continuity](../../runs/optimization-legacy-continuity-20261013/summary.json)、[environment](../../runs/optimization-legacy-environment-20261013/summary.json)、[self-harness](../../runs/optimization-legacy-harness-20261013/summary.json)、[ledger](../../runs/optimization-legacy-ledger-20261013/summary.json)）通过。environment为预设未知结果安全停止，不是正常通关。Windows CLI须设置PYTHONPATH=src；首次缺失路径错误未调用模型。

独立whole-branch评审无Critical；三个Important（known-zero、死进程IO错误、公开HTTP响应阶段遗漏）已修复并验证。新增RPC control使一个既有event_sink精确列表测试失败，调整为分别断言原事件与control发送/确认。仍明确未验：actual Pi abort不能settle、真实中断compaction、bridge提交而trajectory尚未持久化的实故障、跨进程并发结果分配；已有负例诊断证明停止/unknown策略，不能升级为全部实故障覆盖。

### 运行前协议与交付决定

用户授权一次普通官方ls20，真实yibu/qwen3.8-27b/high-qwen，100动作上限，无整场时间/token/decision上限。台账/critic和native compaction开启；reasoning replay、跨关强制review、周期25动作合并关闭；最新完整text grid保留。局部fault policy180秒idle/900秒请求、每组2次恢复及工具隔离界限沿用并显式记入协议，不新增整场上限。不提供游戏规则、路线或必须创作组件的探针。

这是组合可靠性/使用情况的操作性观察，旧37动作仅诊断线索，不是因果比较器。任务指标为关卡/成功、有效区分实验和重复失败；成本包含父及critic/consult/compaction，unknown不能记零；认知核查包括条件化反例、未完成实验和压缩后的实际行动；追踪机会→投入→候选→装配→语义使用→反馈及合理非用/放弃。收益不能以组件数、调用数或输入字符下降替代。

源码/运行协议在正式启动时冻结并记录hash；真实模型采用、真实compact触发与质量在运行结果后判断。原SDK/bridge真实规则、未知环境结果停止、源版本/密钥隔离保持。完整比较和额外checkpoint付费探针需要之后的明确授权，当前不追加。

| 证据层 | 2026-10-13 本次状态 |
| --- | --- |
| 功能正确 | 上述针对性与回归已测路径通过；仍有明确实故障/并发覆盖缺口。 |
| 全链路可达 | actual Pi/生产bridge/WASI + scripted provider/mock SDK的native生命周期、压缩、读回、恢复、父/consult长度续轮通过；不声称已弃用Auto-Research旧链路闭合。 |
| 自主采用 | 未验证；正式普通真实运行将观察是否识别/沉淀/后续语义复用以及条件化修订，合理非用计入。 |
| 净收益 | 未验证；本次组合单样本不能归因，O14/O15/O17/O19和B/C/D保持开放。 |

### 正式启动记录

待最终回归退出和源冻结后，在本节记录真实PID、root、effective配置、首个provider响应/动作及运行中状态；启动成功不写成100动作完成。
