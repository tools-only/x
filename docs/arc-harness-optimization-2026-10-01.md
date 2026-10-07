# ARC Harness 优化实施与验收

日期：2026-10-01。依据根目录《优化方案.md》。先确认文件完整、稳定落盘，再实施；方案原始基线保留。

## 已实现的链路

1. **动作事实 → 周期判断。** 成功原生动作优先按 `action_budget.total_used` 去重，外层调用 ID 只关联批量/委托。批量每项进入同一 checkpoint、validation、strategy 与 memory 处理路径；有界普通 delegate 的动作回执也进入父处理路径。每 5 步增量、每 20 步整理，最新到期窗口优先，旧窗口保持可查。
2. **明确 review/defer。** ARC runner 默认开启有界周期决策边界。父 Agent 提交有证据的 review，或理由及 `after_actions` 恢复条件；runtime 的失败/耗尽回执不算父判断。组件创建没有配额，Auto-Research 保持只读。
3. **创建 → 装配 → 试用。** 新增独立 `task_harness_create`，复用 change 的语义分类、creator、预检、native executor 和回执。Skill/Tool/Subagent 作者必须实际读对应 creator；移除 ARC open-admission 的伪造 read 记录。新建不等于装配，读入不等于实际使用。父作者 memory 也进入待装配提示，自动 probe 不因此被逐条催促装配。
4. **跨阶段新证据 → 同研究线续研。** 保存每次 Auto-Research 启动的历史游标，包括显式问题。依据现有 agenda/session/report 与新动作、关卡边界、validation/effect assessment，生成最多 3 条、每条最多 8 个新证据引用的续研卡。保留旧报告及精确研究线；不自动启动 child，不推进读取游标，不合并多个主题，不把新证据视为旧结论的证明。已运行或 pending 的线交给现有恢复机制；drop 的议程不重开。方法实际使用/评估继续复用已有反馈 handoff。
5. **阶段切换 → 推理失效提示。** level/RESET 后将旧 goal/subgoal/strategy/hypothesis/next_step/summary 标为需要父更新；父当前卡与 child 选定 checkpoint 投影不把失效字段作为现行指导。父只清除实际更新的字段。
6. **压缩与最终输入。** 周期/续研卡进入各自稳定投影槽，保留最新完整文本；修复极小预算下头尾重叠重复及未记录 overflow。最终 provider 遥测关联 cue hash、窗口 ID/研究线与全文覆盖。

## 目标、规则、计划和竞争机制

| 环节 | 当前机制 | 证据边界 |
| --- | --- | --- |
| 目标/规则探索 | checkpoint 的 goal、success_conditions、hypothesis；goal/rule 类候选 | runtime 不编造游戏目标或规则；由 Agent 提交 |
| 规划 | structured plan、step 游标、观察检查与 reconciliation | 计划必须由父选择，批量不绕过 active plan/validation |
| 竞争猜想 | shared question_id、support/counter refs、预测/反证、CURRENT COMPETITION VIEW | 不把自由文本假设算作正式候选 ledger |
| 有界实验 | validation 唯一动作计数；失败结果回到候选/父轮和 child 比较材料 | 单次预测失败不等于整个假说被证明错误 |
| 方法演化 | report/method → parent authoring handoff → create/change → assembly → use/assessment → 同线 feedback | creation、exposure、completed 与已验证收益分开统计 |

主要实现：`demo/pi_harness_review.ts`、`demo/pi_task_local_self_harness.ts`、`demo/pi_external_benchmark_research.ts`、`demo/pi_task_local_subagents.ts`、`demo/pi_auto_research_agenda.ts`、`demo/pi_task_competition.ts`、`demo/pi_task_strategy_state.ts`。

## 项目 prompt 与工具入口

- ARC 基础 system prompt：`src/autoresearch_pi/arc_agi_3_adapter.py`；运行组合入口：`demo/pi_arc_agi_3_extension.ts` 的 `before_agent_start`，加入 public state 和 task-local runtime 提示。已选择的 system-prompt 组件作为显式 assembly overlay。
- 每个决策周期的 task prompt：`demo/prompts/arc_decision_cycle.md`，由 `src/autoresearch_pi/arc_agi_3_e2e.py` 加载。简短 Harness 入口：`demo/prompts/self_harness_index.md`；按需 review 合约：`demo/prompts/harness_review_operations.md`。
- `arc_action` 是单动作，`arc_actions` 是上层有界组合；adapter 仍执行具体动作。两者合理共存，批量每项必须独立计账。
- `task_harness_create` 用于新组件；`task_harness(action=change)` 更新、退役或成组变更；`assemble` 选择精确版本。对应 creator 通过 `read_method` 真读正文，不能只带 creator 名称作为已读取证明。

## 验收记录

局部与原生 Pi 测试仅为诊断，不是 ARC self-harness 闭环证明。

- 首轮相关回归：78 passed、2 failed；两处旧断言已核对修订。
- 扩展检查发现并修复人工 memory 未提示装配、极小预算重复提示两个真实缺口；其他失败来自旧提示/入口断言。
- 最新目标性检查：12 passed；上下文、规划竞争、cue 暴露及 smoke 配置检查：38 passed。最终四组相关回归：82 passed，115.56 秒；日志目录 `.tmp/optimization-complete-regression-20261001`。
- 真实 SDK 矩阵首轮：`runs/arc-harness-optimization-smoke-final-20261001`，16 场景中 7 通过。旧 smoke 读取废弃 validation 文件、要求短失效提示包含全部引用、未明确选择待研究 handoff、未在预期序列纳入周期延期；已更新为唯一 validation 事实、按需读取失效详情、选择 runtime 精确 handoff 与明确延期。修订后的完整矩阵：[汇总](../runs/arc-harness-optimization-accepted-20261001/arc-self-harness-smoke-summary.json)，**16/16 passed，environment_mocked=false，runtime_boundaries_mocked=false**。五类组件、独立 create、语义输出、Auto-Research/普通 delegate 的 length continuation、同线反馈与后续父轮均有断言。smoke 使用确定性 provider，不能证明游戏质量。
- 原生委托/批量共享记账：`runs/arc-harness-action-accounting-final-20261001/arc-self-harness-smoke-summary.json`，passed=true，environment_mocked=false，11 项检查通过，额外确认 checkpoint 与原生动作序号 1–4；包括 delegate 语义报告及后续真实父输入。
- 显式研究问题的续研游标追加检查：22 passed；一个实际 child 在 length 后完成无 agenda 的报告，后续动作卡仅包含新动作，并恢复精确旧报告引用。目录 `.tmp/optimization-line-cursor-final-20261001`。该补查也修正同步 session 不含 report_ref 时的报告引用解析；真实模型已启动的进程没有重新加载这一小修正，不能用该进程验收此特定补查。
- 创作后待装配/失败入口追踪补查：41 项通过，1 项原始 JSONL 转义断言失败；改为读取解析后的真实模型文本后，该项通过（`.tmp/optimization-followup-final-20261001`）。
- 周期控制预算补查：1 passed，两次拒绝后放行下一动作，记录 decided_by=runtime/status=failed，不产生父 review 或默认父 defer（`.tmp/optimization-decision-budget-final-20261001`）。
- 真实运行发现候选拒绝入口缺失：父向 `auto_research(skip)` 提供 research_candidate_ref/research_reason，却被路由到 plan node。现已支持精确候选版本拒绝、父理由落盘、CAS 和新 fingerprint 后重新开放；过滤误判为方法候选的 arc_state 读取。10 项相关检查通过（`.tmp/optimization-dynamic-decisions-final-20261001`）。最新完整 SDK 矩阵 [汇总](../runs/arc-harness-optimization-complete-20261001/arc-self-harness-smoke-summary.json) **16/16 场景、393 项检查全部通过**，包括五类组件与两类 length 续接；environment_mocked=false，runtime_boundaries_mocked=false。候选拒绝/新证据重开的专项证据仍来自原生 Pi 诊断，不夸大为自主模型行为。
- 最新代码的真实 provider 追加运行：`runs/arc-ft09-harness-latest-code-real-20261001`，已结束；同模型/游戏/模态，20 动作、1200 秒上限。1200 秒处超时，实际 3 步、0/6 关，正式 scorecard 关闭成功。未到周期触发点，也未使用修复后的 skip；无法由此声称新增补丁的自主行为已覆盖。它是有界机制检查，不能与 60 步基线直接比较游戏成绩。
- 核心优化版本真实 provider：`runs/arc-ft09-harness-evidence-real-final-20261001`，已结束；qwen3.8-27b/yibu，text,image，treatment，Jev 关闭，context compaction，60 动作上限、3600 秒实验上限。结果为超时，30 原生动作、2/6 关；正式评测关闭成功。自主研究、创作、装配与收益未获证明，详见下方最终证据。

## 仍需结果证明的事项

- 真实模型是否把竞争猜想正式化，是否自主 review/defer、续研、创作并实际试用，必须查最终运行证据。
- 真实研究/组件的质量和游戏收益、跨压缩认知质量、全面 ARC 职责拆分及更细在线父子通信，仍不能由接线测试证明。
- 历史 ft09 的 scorecard close HTTP 404 尚不能归因。此次 ls20 诊断已有有效原生 close 回执；不据此宣布历史故障已解决。真实 provider 结束时须分别报告动作轨迹和正式评测状态。
- 先前目录因错误脚本动作/新周期边界或代码更新而终止，只是诊断；不复用为最终验收。

## 真实模型阶段快照（非最终结论）

2026-10-01 14:36（UTC+8）：成功原生动作 3，level 0。父已更新 task goal、success conditions、hypothesis/falsifier 和 next_step；正式策略候选 ledger、周期 review/defer、Auto-Research、父组件创作与装配尚未出现。尚未到第 5 个成功动作，不能将此快照解释为决策边界失效。后续超时诊断确认长模型生成及请求取消；原快照将错配的响应 ID 解释为取消请求的迟到响应，现纠正：FIFO 遥测关联有缺陷，不能据此推断迟到。见 [超时分析](arc-timeout-analysis-2026-10-01.md)。

2026-10-01 14:43（UTC+8）：成功原生动作 6，levels_completed=1。父使用批量完成同一目的的后续点击。`arc-pattern-5` 到期 cue 已进入后续父轮；最终 payload 遥测 `full_text_present=true`，窗口 ID=`arc-pattern-5`，cue sha256=`ecd652b063acaeaaf2b67acb38199059f83c9206a90e06bf2aa9c3da7ba6ecf5`。父随后读取新关卡并更新 checkpoint；此时尚未提交 review/defer、研究或父组件创作。过关只是公开环境进展，仍待结束时的 scorecard 关闭回执。

2026-10-01 14:47（UTC+8）：成功动作 7，levels_completed=1。父明确 `defer_review`，理由为先收集 Level 1 数据，再复盘已理解的 Level 0 block-paint 方法；记录 decided_by=parent，恢复动作计数 11。之后动作放行。已证明真实 provider 收到 cue 并作出有理由的判断；仍没有 Auto-Research、父创作或 assembly，不把延期当作沉淀和使用已经完成。

## 核心优化版本真实运行最终证据

运行于 2026-10-01 14:17–15:17（UTC+8）。[原始汇总](../runs/arc-ft09-harness-evidence-real-final-20261001/summary.json)、[机制证据摘要](../runs/arc-ft09-harness-evidence-real-final-20261001/harness-optimization-evidence.json)。后补的 report-ref 恢复、候选 skip 与 arc_state 筛除修复未热加载进此进程，须分开解释。

| 项目 | 最终观察 |
| --- | --- |
| 运行状态 | `timed_out=true`、`pi_returncode=124`、`run_complete=false`；60 步是预算，实际只执行 30 步 |
| 环境进展 | 完成 2/6 关，原生动作编号 1–30，无环境执行错误，未强制动作 |
| 正式评测 | `evaluation_complete=true`；scorecard close 成功，返回 score=14.285714285714285；任务未完成，整体 passed=false |
| 周期 cue | 最终 provider payload 边界的 14 条周期 cue 核查均 `full_text_present=true`，覆盖窗口 5/10/15/20/30；窗口 25 没有后续父决策输入，不能声称曝光 |
| 父判断 | 7 次成功 `defer_review`，均保留父理由、精确窗口与恢复动作计数；没有正式 review |
| 自动记忆 | 6 个 action-decision probe memory 版本；不能算作父语义整理或实际装配 |
| 自主研究与创作 | Auto-Research run/report、父组件创作、显式 assembly、工具/保存子 Agent 的实际调用和 effect assessment 均为 0 |
| 目标/规则/规划/竞争 | 12 次 checkpoint 更新，父提交目标、success conditions、预测/反证和下一步；未建立正式 strategy candidate ledger 或 structured plan，未在此运行使用正式竞争机制 |
| 候选拒绝 | 父尝试 4 次 auto_research(skip)，旧代码误入 plan 路由；最新代码已修复，诊断通过，此旧进程不能验收补丁 |

延期理由包括先完成当前关卡、机械规则已掌握，以及先诊断批量点击问题。由此能确认提示到达、父明确判断、延期恢复和动作放行。不能推断真实模型已完成研究→创建→装配→使用，更不能推断组件提高游戏表现。后续 [超时分析](arc-timeout-analysis-2026-10-01.md) 确认长模型生成是主要耗时，旧周期门禁进一步增加往返；provider_response 的 FIFO 关联失真，不用其原始 latency 判断排队或迟到。实验未执行满动作预算，也不构成与旧 60 步基线的有效成绩对照。

### 此次仍悬空的结果与设计风险

1. **自主沉淀的行为证据为空。** 入口、版本、装配、语义试用及同线反馈已经接通；本次真实模型持续选择延期。不得用组件配额或 runtime 自动升级证据补造闭环。
2. **续研尚无真实自主样本。** 本次没有研究 session，因此不能验收新证据卡对实际研究线的跨阶段认知质量；同线接线证据来自完整 SDK matrix 和原生诊断。
3. **延期队列的管理成本。** 最新窗口优先后，其他旧窗口仍可能分别要求延期；本次出现连续处理多个旧窗口的管理轮。如何由父明确选择一组窗口共同延期，属于后续可核验优化点，不能假定最新窗口的理由自动代表旧窗口。
4. **正式规划和竞争入口尚未被模型使用。** 自由文本计划和假设能帮助行动，但不能替代 ledger、竞争选择与有界实验的实际使用证据。
5. **评测故障仅能报告本次状态。** 此次真实 ft09 和 SDK smoke 的 close 成功，不能据此确定历史 HTTP 404 的根因；跨压缩认知质量、真实收益、更细在线通信与全面职责拆分也仍未验收。

## 最新代码追加真实运行最终证据

运行于 2026-10-01 15:04–15:24（UTC+8）。[原始汇总](../runs/arc-ft09-harness-latest-code-real-20261001/summary.json)、[机制证据摘要](../runs/arc-ft09-harness-latest-code-real-20261001/harness-optimization-evidence.json)。最终补丁在此进程启动前已加载。

- `timed_out=true`、`pi_returncode=124`、`run_complete=false`；20 步是预算，实际 3 步、0/6 关。
- `evaluation_complete=true`，scorecard close 成功，score=0；整体 passed=false，没有环境执行错误。
- 2 次 checkpoint 更新、3 个自动 probe memory；父创作、显式装配、研究 run/report、formal review、正式策略候选/结构化计划及效果评估均为 0。
- 未达到第 5 个原生成功动作，因此没有周期 cue；也没有 auto_research(skip) 调用。此运行既不能验收周期触发，也不能证明候选拒绝修复的真实自主使用；相关功能仍以完整 SDK 接线验收和原生诊断作为证据。

**本轮结论：** 优化实现、局部回归和真实 ARC SDK 接线验收已完成；两次真实 provider 运行均已收尾、保留轨迹并取得正式关闭回执。核心运行证实周期提示全文到达和父延期/恢复控制；真实模型自主研究→组件创建/优化→装配→实际使用→同线证据反馈的全过程仍未证明，不能称为自主闭环或性能提升。
