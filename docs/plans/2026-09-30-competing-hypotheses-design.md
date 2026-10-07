# 竞争猜想、有限实验与策略转向设计

日期：2026-09-30。状态：核心机制已落盘；组件和原生 Pi 集成诊断已执行，真实 ARC 行为与成绩仍待验收。实现边界见第 11 节。

目标：让 Agent 在有限预算内维护竞争解释，用有区分力的实验更新路线，并在压缩后保留失败记录与未完成承诺。运行成绩变化说明需要行为验收，不能单凭两次结果判定某个压缩实现的因果影响。

## 1. 当前证据与边界

- `demo/pi_task_validation.ts` 维护假设账本，行动声明只有稳定 hypothesis_id 才进入账本；当前重复匹配只查 open 记录。
- `src/autoresearch_pi/arc_agi_3_e2e.py` 独立维护 research validation window；到期状态是 awaiting_assessment，不代表假设已经被否定，也未统一驱动正式账本和计划。
- `demo/pi_external_benchmark_research.ts` 已校验结构化计划步骤；不能执行过期或待协调的计划步骤，但可以显式提交探索动作。
- 同文件的 action probe memory 投影仅处理数组形式的 changed_cells，数值型变化量可能丢失；摘要主要来自父 Agent 假设，需要改为预测与实际结果并列。
- `demo/pi_auto_research_output.ts` 已限制 confidence_update 的理由及引用关联，但声明 new_environment_evidence 或 completed_discriminating_experiment 本身不能证明证据新颖性或实验区分力。
- 原始 ARC frame 和逐步动作记录继续作为环境事实来源。猜想、报告、memory 均有来源，重复引用不产生新的环境样本。

遵守单次生命设计：main 独占环境动作；child 研究和提出实验；runtime 管理状态、核对明确条件，不推断游戏语义。策略回退是撤回判断、暂停计划并从当前状态重新规划，不恢复旧环境，也不自动 RESET。

## 2. 方案选择

推荐复用现有 checkpoint、validation、plan、Auto-Research 接口，增加一个统一的实验状态 reducer 与派生决策卡。

仅加强 prompt 无法可靠保留实验终点及失败依赖；全面引入搜索树、概率信念更新或自动换路控制器则需要当前不存在的状态模型和语义判断，还会增加上下文与管理成本。两者均不作为本次主方案。

普通执行不必维护多个猜想；只有关键不确定性影响行动、预测被反驳或出现持续无区分结果时，进入竞争判断。已有充分依据的计划可以直接推进。

## 3. 谁做什么

| 主体 | 责任 |
|---|---|
| 父 Agent | 定义问题、提出或采纳候选、声明预测、选择实验、解释结果、选择继续/修改/暂停/转向 |
| Auto-Research | 分析证据、搜索反例和替代解释、检查区分力、建议实验与计划调整；报告不自动采纳 |
| Runtime | 版本与证据截止点、实验计数、明确谓词核对、状态更新、依赖标记、短投影和重复证据检测 |
| ARC bridge | 接收具体动作、返回公开结果，不感知研究主题或竞争策略 |

不要求每个问题固定两个答案。父 Agent 可以声明“尚未找到具体竞争解释”，同时给出覆盖不足和下一步探索方向；不能为满足格式编造竞争猜想。

## 4. 最小状态与单一权威来源

复用现有任务资源持久化机制，不增加另一套账本或通用管理工具。

1. 问题/候选：稳定 question_id；候选 id/version、简短主张、作用域、来源、支持与反证 refs、最后评估。活动工作集默认最多 3 个候选，其余归档可读。
2. 实验：test_id、关联候选精确版本、声明时 evidence cutoff、适用状态、动作上限、各候选对结果的预测、结束条件及结果 refs。实验契约在首次动作前固定。
3. 路线决策：checkpoint/plan 保存当前选择和精确依赖；候选正文与实验结果由 validation 资源提供，checkpoint 只保存引用与派生短卡。

维护记录只是前提。候选必须连同可以用于比较的证据进入实际模型请求；仅在资源目录列出候选名称、状态或 ref，不算完成竞争机制。候选的解释可信度与对应行动的探索/执行价值分别判断，不能把“目前最可信”直接当成“下一步最值得执行”。

验证账本成为实验生命周期唯一写入权威。Python runner 原有 window 逻辑迁移为消费同一状态/事件的投影，不再独立计数并产生另一份状态。兼容旧日志的归一化只导入已记录事实；没有事前契约的历史动作不能冒称前瞻验证。

内容版本、实验状态、Agent 判断分别存储：条件未满足不自动等于整个猜想为假；条件满足也不自动等于猜想成立。

## 5. 从实验到转向

1. 父 Agent 选择一个当前问题及工作路线。对有争议的关键判断记录竞争解释，不重复填写完整规则集。
2. 优先选各候选预测不同的实验。若结果相同或预测没有结构化到可比较，分别标记 shared_prediction 或 unknown_discrimination，不能自动推定信息增益。
3. 声明有限实验：动作额度和可失败的终点。可复用旧自然语言预测；简单条件逐步采用可计算谓词，如 changed_cells >= 1、level_changed = true、指定目标像素变值。明确 any/each/final 语义，不能把“最后一步应变化”误判成“中间曾变化就成功”。
4. 每个成功动作回执按唯一 observation ref 入账一次。工具失败、缺失 frame、未知字段不能算零变化；不完整证据到期返回 unknown。同一 frame 在不同动作后仍是不同实验样本。
5. 条件满足或额度耗尽后结束实验，保存 outcome=met/not_met/unknown；没有可计算谓词的实验返回 needs_assessment。候选真假由父 Agent 评估，完整实验状态不会继续停留在 open。
6. 到期或明确预测不满足时，将依赖该实验的当前计划标记 needs_reconciliation，在下一次正常父 Agent 请求投影一张决策卡。复用现有计划执行检查，防止旧计划以“已确认有效”状态继续推进。
7. 父 Agent 在同一轮选择：继续另一有效路线、修改猜想、换区分实验、暂停研究或保留不确定性继续探索。可在现有 checkpoint/arc_action decision 中带上精确版本和理由，不增加强制的独立复盘轮次。

重复 test_id 幂等；同一候选版本可有多个不同实验，但结束的实验不能通过重复提交额度重开。新实验必须记录相对前一实验改变了什么（证据/前提/干预/预测）及额度。代码检查字段、引用和版本差异，不声称能识别所有同义改写。重复重试仍按问题与路线累计成本，并在短卡呈现。

RESET、换关或目标状态变化要检查实验作用域：不再适用的实验标记 interrupted/stale，不能自动宣告失败，也不能抹去此前成本与结果。只暂停显式依赖失败或过期条件的计划部分，不级联否定无关能力。

原生环境动作继续可用。若父 Agent 不采用竞争流程，runtime 记录未评估的继续投入并持续保留当前决策卡；不通过无限工具拒绝或自动替换动作强迫语义选择。此方案提高可见性和执行一致性，不能绝对保证模型总作出正确转向。

## 6. 零变化案例的预期行为

候选 H1：点击累积隐藏标记；候选 H2：目标区域不可交互。二者对当前点击都预测零变化，这次结果记为未区分，而不是 H1 获得支持。

父 Agent 可以选择另一视觉区域作为低成本对照，也可以为 H1 设计有终点的有限序列。若事前声明“5 步后出现可见变化”，runtime 按声明的 final/any 语义核对。终点仍无变化时，实验条件记为未满足；父 Agent 应降低该具体版本的适用性并考虑 H2 或新解释。

仍想重试时，应说明干预或前提的变化及新增投入。单纯把“5 步”改成“再 5 步”不能清除前一次失败。允许有依据的延迟回报实验，不能把所有零变化或 RESET 自动当成错误。

## 7. Auto-Research 的输入与返回

复用现有多 topic、独立 child session 和 experiment_request：每个研究任务带 question_id、evidence cutoff、当前实验短状态、未解决反证和访问许可。child 不继承全部父对话。

默认视图先呈现公开事实与精确 refs，再呈现有来源标签的父猜想。独立复核可选隐藏父结论，初始只授予相应事实资源；需检查工具授权和派生资源，避免从 checkpoint/memory 间接泄漏。盲审是按需模式，不要求每次研究增加揭盲轮次。

返回字段复用 confidence_update、findings、experiment_request：关联候选、证据是否新增、支持与反证、哪些解释仍无法区分、建议的实验及不同结果如何影响选择。父 Agent 决定采用和执行，过期的坐标/动作请求先重新绑定当前状态。

加强现有 confidence 校验：解析证据引用到实际来源及版本；“新增环境证据”须相对该候选上次评估截止点检查；“已完成区分实验”须引用具体实验结果及可比较预测；同一证据被 memory 或报告转述不变成新样本。旧证据的重新分析可以产生新解释，但必须标为 reinterpretation，并说明解决的反例或修正的推导，不能伪报新实验。

当结构化声明与来源不匹配，仅拒绝该置信度提升或标为待评估，保留报告及有效发现；不让整个 child 因一项分类错误无限重试。代码无法核对的语义区分力交由父 Agent 判断。

无新证据且无新分析目标的重复 topic 启动返回已有结果和缺口的短回执。允许显式请求独立复核或新方法，不因缺少新环境动作一律禁止研究。runtime 不自动拉起多个反驳者，避免研究放大成本。

## 8. 上下文与触发

默认只保留一张当前决策卡：当前路线、最多两个关键竞争解释、候选与证据的比较、最近实验结果/反证、未解决的转向事项和可选实验。常驻投影目标约 2000 字符；它是工作集目标，不能以满足长度为由隐藏关键反证或让竞争只剩名称和 ref。复杂争议转入一次按需加载的比较视图，完成判断后更新常驻卡；受实际上下文预算约束，不能无限扩大。

活动卡每次组装替换旧卡，不追加提醒历史；详细契约、其他候选与报告按 ref 加载。压缩和 session 恢复从权威记录重建卡，保留 completed/interrupted 状态、失败证据和剩余额度。

触发顺序：明确预测未满足/状态过期优先；实验到期其次；持续共同预测或零变化作为候选缺口信号。初始默认连续 3 次成功动作的零变化触发一次对照复核提示，阈值可配置；已有尚未到期的有限延迟实验只显示预算进展，不每步要求改路。RESET 不清空问题级历史，但必须区分前后状态作用域。

相同证据/问题版本的复核请求去重。研究调用只由父 Agent 决定；不固定每 N 步启动研究。设计阈值是待真实运行校准的起点，不是已证明最优参数。

### 8.1 实际呈现给 Agent 的竞争视图

围绕当前决策问题组织材料，不以候选创建时间或报告数量排序。每张卡包含：

- 决策问题、当前状态/证据截止点和剩余动作预算。
- 2–3 个活动候选的精确版本、主张和适用范围；没有有效竞争候选时明确缺口。
- 共享的关键轨迹事实：动作前条件 → 具体干预 → 实际结果。事实只展示一次，带 exact ref；例如只测试过中心区域两个颜色，不能摘要成“所有点击无效”。
- 每个候选对这些事实的解释、支持与冲突、尚未测试的前提；标明哪些关联是父/child 的评估，哪些是代码核对的预测结果，避免投影器替模型作语义判决。
- 当前值得比较的少量实验/执行路线：各自成本、已知风险、不同结果对应的候选预测、可能的任务收益及尚缺的知识。未知成本/风险明确未知，不虚构精确成功概率或信息增益分数。
- 上次选择及理由、新证据改变了什么、仍需父 Agent 作出的选择。

比较可以是局部的：候选部分重叠时，不强迫构造成互斥解释。观察到另一处可交互，只支持扩大交互区域模型，并不自动证明原处没有隐藏状态。关系强弱及下一步价值由 Agent 根据证据判断。

父 Agent 需要作出的判断包括：哪种解释更符合已观测轨迹，哪种仍缺关键证据，哪个动作能低成本区分解释，哪个已足够可靠值得直接执行，以及哪条路线应暂停。允许理由为“可信度较低，但验证成本低且结果能改变后续选择”，也允许继续高价值计划而暂缓研究；不要求每步追求最大信息增益。

### 8.2 零变化案例的示意输入

以下仅演示输入结构，不把历史通关坐标或已知答案提供给运行中的 Agent：

```text
问题 Q：目前点击的区域是否可编辑？
事实 E1/E2：同一中心区域，两次点击；目标像素颜色不同；delta 都为 0。
覆盖限制：其他区域未测试；没有观测到隐藏状态。
H1@v1：中心点击积累隐藏标记。两次零变化与其相容；尚无区分性支持；终点未定义。
H2@v1：中心图案不可编辑，其他区域可能可交互。两次零变化与其相容；其他区域尚无证据。
P1：父 Agent 从当前 frame 选择另一类区域做一次对照。
  若变化：提供该区域可交互的证据，可研究是否形成求解路线；不直接排除 H1。
  若不变：扩大无效操作的已测范围；仍不能确认 H1。
P2：为 H1 定义有可见终点的有限序列；成本/终点尚缺，暂不作为可执行计划。
待决策：选择 P1、补全 P2，或提出不同解释/实验；说明关键依据和结果后的分支。
```

Agent 看到候选、证据和行动后果后再选择。runtime 不把 P1 排名为“正确答案”，也不声称条件尚未定义的 P2 已被否定。

### 8.3 暴露、选择与行动的连接

1. 在下一次父 Agent 请求组装时，由权威候选/实验记录和公开动作结果生成一个版本化 competition view；稳定槽位替换旧视图。
2. 关键新反证、实验到期、父 Agent 选中的竞争候选或新交付研究分歧，在下一次相关决策中默认呈现，不能只留下待发现的资源目录。普通 child 只获得授权范围内、与委托有关的同类视图。
3. 自己已有选择与主要挑战者并列呈现。候选超过工作集时给出遗漏数量及读取入口；新反证所针对的候选及其挑战者不能被简单 top-N/最近访问策略静默隐藏。必要时先展示争议摘要，由父 Agent选择扩展材料，不由 runtime 猜测最有价值的解释。
4. 复用 task_checkpoint 的策略更新或 arc_action.decision，记录 view_ref、选中的候选/实验版本、关键证据 refs、简短选择理由和结果分支。一次正常模型轮可同时完成比较与行动，不要求额外工具确认或长篇自述。
5. 新动作回执更新同一实验，下一张视图展示预测与实际的差异；转向后的旧解释与反证保留可恢复记录。报告晚于当前请求到达时，在下一请求重新检查状态绑定。
6. 当前视图包含重要争议但没有观察到选择依据时，记录 decision_unassessed，并在下一视图保留待决事项；不把“已注入提示”记作“Agent 已比较并采纳”。

记录实际 provider 请求中的 view 版本/hash及候选/证据覆盖清单，利用现有 payload telemetry核对上下文压缩后的最终输入；必要时对指定验证请求开启本地 prompt capture。没有实际 payload hook 时标记 intended exposure，不能声称已证明有效输入。

决策回执用于核对所选版本、证据和后续动作是否一致，不要求暴露模型内部推理，也不能仅凭填写理由判断比较质量。真实行为验收检查所引用证据是否支持选择、反证是否被处理以及后续是否遵循所声明的结果分支。

## 9. 实现顺序

1. 修复数值 delta、目标像素和状态引用投影；probe memory 摘要并列“父预测/实际结果”，保持原始证据可读。
2. 抽取统一实验 reducer 接入 task_validation 和动作结果；处理幂等、版本、到期、中断、未知结果和恢复，迁移 Python 重复计时状态。
3. 复用 checkpoint 的候选与 plan 结构，接入精确实验依赖、needs_reconciliation、带证据的竞争视图和选择回执；在实际 provider 请求边界核对暴露，不以目录或存储记录代替输入验收。
4. Auto-Research 接入同一事实快照与短状态，增强来源/新颖性核对和重复研究回执；再加入可选独立复核。
5. 联合核查 context lifecycle、ARC 观测投影、Pi compaction 和 session rotation 的实际 provider 输入，替换重复摘要，验证父/child 边界。

主要入口：`demo/pi_task_validation.ts`、`demo/pi_external_benchmark_research.ts`、`demo/pi_task_local_subagents.ts`、`demo/pi_auto_research_output.ts`、`demo/pi_task_local_context_lifecycle.ts`、`demo/pi_arc_agi_3_extension.ts` 和 `src/autoresearch_pi/arc_agi_3_e2e.py`。实际编码前复核当前工作区，保留已有未提交变更。

## 10. 验收

机制回归：零值不丢失；未知不冒充零；any/each/final 正确；重复回执不重复计数；自然语言实验到期也结束；旧 id/版本不能重开已完成实验；RESET/换关中断保留记录；失败条件只影响显式依赖计划；过期 child 回执不能直接更新当前选择；同源转述不算新证据；重新解释有独立标记。

行为场景：共同预测零变化不提高 H1 相对可信度；有限隐藏过程到期后发生评估与不同干预；合法延迟奖励不被机械中断；表面变化也不自动等于任务进展；压缩/恢复后仍知道排除过什么、还有哪个实验未完成。记录从触发到评估/不同干预的动作数和 tokens、重复无区分投入、管理调用占比及决策卡实际大小。

竞争暴露验收：实际 provider payload 同时包含当前候选、有效挑战者、关键支持/反证、证据覆盖限制和可选行动的结果分支；压缩后仍可比较，而不是只剩 refs。构造“旧主张被新证据挑战”“可信度低但便宜且有区分力的实验”“高可信路线值得直接执行”“现有证据仍不能区分”场景，检查 Agent 能否根据证据和成本选择不同策略，是否处理主要反证。候选数、视图曝光次数及决策字段填写率不单独作为机制成功指标。

真实 ARC：同游戏、初态、模型/provider 配置、60 动作上限与研究预算，保留有效动作和真实关卡成绩。修复前后用保存的版本/config 做多次对照，不以单次首击或两个成绩证明因果。消融分别比较“证据投影修复”与“加统一实验/竞争决策”，避免混入输出预算更改；此前 8k 全推理截断实验不作为默认配置。

如果宣称 Auto-Research 到五类 self-harness 闭环，另按 AGENTS.md 运行真实 runner 的 arc-harness-smoke，覆盖五组件、语义输出、父/child 生命周期及 Auto-Research/普通 delegate 的 provider length continuation。组件检查或离线重放只证明局部机制；真实 provider 表现另行评价。

与 `docs/deferred-research-todos.md` 的 B（独立研究与观测条件）、C（父子实验反馈）及 D（压缩后的认知连续性）相关。本设计不勾选这些待办完成，不授权全面重构或改变环境权限。

## 11. 实现记录与使用入口

2026-09-30 核心实现：

- `demo/pi_task_experiment.ts` 归一化公开动作事实并推进有限实验；数值零保留、缺失值未知、any/each/final、错误不计成功样本、回执幂等和 RESET/换关中断。
- `demo/pi_task_validation.ts` 在 `arc_action` 的 tool_call 边界固定契约，之后由 observation 回执更新唯一实验状态。结束实验不重开；新 test_id 要有 retry_reason。纯自然语言实验到期为 needs_assessment，不机械否定猜想。
- `demo/pi_task_strategy_state.ts` 复用候选/计划；候选有精确版本资源、同内容更新幂等、支持与反证 refs、未测试前提和行动 options。显式依赖到期实验的计划进入 needs_reconciliation。child 同名建议保存为独立关联候选，不能覆盖父选择或计划。
- `demo/pi_task_competition.ts` 从上述权威记录派生不可变 competition_view：事实、覆盖限制、主张、预测、支持/反证、行动成本/风险/分支、实验进度和未评估的继续投入。常驻卡替换旧卡；省略的候选、事实、实验及额外反证有计数和精确读取入口。路线成本按 observation 去重，不把两个并行实验的同一次动作计两遍。
- `demo/pi_external_benchmark_research.ts` 将卡注入父输入并捕捉 selection；没有选择依据记 decision_unassessed。同文件修复数值 changed_cells 在 probe memory 中丢失的问题，摘要并列父预测和实际回执。
- `demo/pi_task_local_subagents.ts` 的统一 child 启动入口按 grants 投影同类卡；Auto-Research 可得到当前候选及相关实验，普通 delegate 只得到明确授权的候选/事实。length 续轮使用固定视图 ref，保留读取权限并复用原生 transcript。多 topic 不合并为一个固定 child。
- `demo/pi_task_local_context_lifecycle.ts` 对当前短卡去重且保留完整卡。原生诊断确实发现过卡尾的 not_met 被大消息压缩掉，随后修复；仅保存一份卡不算有效暴露。
- `demo/pi_provider_telemetry.ts` 在真实 payload hook 记录 competition 模块大小、视图 ref/hash、候选/事实覆盖，核对实际投影是否匹配 canonical view。绕过此 hook 的 fixture/provider 只能说明 native provider context 或 intended exposure。
- `demo/pi_research_confidence.ts` 核对精确目标、之前的证据截止点、新 ARC 回执及声明的实验结果。语义区分力仍需父判断；错误只移除置信度提升、保留其他报告内容。
- `demo/pi_research_request_identity.ts` 比较问题、公开证据、父前提和授权材料。相同的已完成 bounded research 返回短 report ref；review_reason 允许旧证据的新方法分析或独立复核。open allocation 和显式 plan 节点仍走原有议程/依赖流程。
- Python runner 消费 validation 精确版本生成旧窗口日志；live loop 不再独立开启/推进计时器。旧 Python 窗口 helper 仅保留历史 fixture 兼容。

父 Agent 使用现有 `task_checkpoint(update)` 提交 candidate_updates，候选字段为 id/kind/status/claim、共享 question_id、prediction/falsifier、support_refs/counter_refs、untested、next_test，以及最多三个 options={action,cost,risk,branches}。版本由代码维护，读回回执或视图后使用。

行动声明示意（坐标由 Agent 从当前 frame 选择）：

```json
{"decision":{"hypothesis_id":"H1","hypothesis_version":1,"hypothesis":"待检验解释","prediction":"终点出现可见变化","validation_window":{"test_id":"T1","question_id":"Q1","actions":3,"mode":"final","predicate":{"field":"changed_cells","op":"gte","value":1}},"selection":{"view_ref":"<当前 competition_view 精确引用>","candidate_id":"H1","candidate_version":1,"evidence_refs":["<相关精确证据>"],"rationale":"比较后选择这个有限实验的依据","branches":"若变化则检查其任务价值；否则停止延长并选择另一干预"}}}
```

`task_resource(read, ref=<view_ref>)` 渐进读取完整比较；`task_validation(inspect, validation_id=...)` 读取完整契约/样本；`task_checkpoint(inspect, detail='strategy')` 读取计划。这些入口均复用现有工具。

验证覆盖 `tests/pi_task_competition.test.ts` 的有限实验、恢复、实际序列化 payload 核对、授权范围、证据新颖性和 child 建议隔离，以及 `tests/test_task_competition.py` 的真实 Pi 父/child 进程、压缩后的比较材料、两类 length 续轮、重复研究与显式复核。另检查现有 workset/报告/续轮回归。

本次执行结果：Node 6/6 通过；Python/Pi 7/7 通过（四项新增诊断实例及三项现有 workset、报告和续轮回归）。Python runner 的 AST 语法检查通过，`git diff --check` 通过。新增缺失观测回归确认：没有目标观测值时，计划请求 assessment，不把未知结果记录为 mismatch。

验收边界：这些是机制诊断，环境动作 fixture 和模型均为确定性替身，不证明游戏推理质量、60 步成绩或五组件 ARC harness 闭环。本次没有建立全自动盲审/揭盲协议；独立复核可由父用 review_reason 或限定普通委托材料发起，其观察独立性仍取决于实际授权资源。约 2000 字符是短卡工作目标，不是保证；重要争议和实验可使卡更长，真实请求成本由 telemetry 记录，原始细节保持可读。

## 12. 竞争材料对应到 Agent loop

用户追加要求：暴露猜想、plan、策略时，Agent 要在循环中评估当前阶段的决策，决定是否换解释、计划或方法。不是每轮重复全部复盘。

`decision_review` 从现有候选、实验、计划、动作回执和选择记录派生，没有单独的 controller、定时器或第二份评估账本：

- `choice_pending`：尚无有效选择回执；比较候选与下一步价值。
- `reconsideration_pending`：选中解释被挑战/出现反证、新版本竞争建议、非 met 实验结束仍待评估、计划需校核、同路线连续两次 frame-silent 操作。展示触发原因和精确引用。连续零变化不等于隐藏进展，也不自动否定合法延迟效果。
- `plan_update_pending`：触发已在选择中处理，但实际计划的 assessment/reconciliation 标记尚未解除；单写选择理由不能解除计划检查。
- `monitoring`：选择记录已完整、当前触发已处理；按选定分支执行，观察下次结果。新回执或候选版本可再次触发评估。

父 Agent 在既有 checkpoint 或 action.selection 中填写 `disposition=continue|revise|switch|test|uncertain`、`addressed_trigger_refs` 和 `next_check`，同时保留 view/candidate/evidence 引用、简短 rationale 与 branches。换解释或路线时仍用 candidate_updates/selected_candidate_id/plan_update 更新实际状态；selection 本身不自动改变计划。不要求输出内部推理链或长篇复盘。runtime 只核对回执完整性，不把格式正确记为语义比较成功，也不替模型决定最佳路线。

短卡中只展示最多四个待评估触发，更多触发给出数量和 view_ref；完整回执要处理全部触发时须渐进读取。省略争议的默认目录最多两项；完整候选、触发、实验和证据继续保存在精确资源中。Auto-Research 给出同类短建议与下一观测检查，父 Agent 负责采用及环境动作。

前一轮发现 `demo/pi_external_benchmark_research.ts` 写入后恢复旧内容，父侧接线一度缺失。后续检查未找到仍在改写文件的项目脚本，历史恢复来源未确认；本轮已应用局部恢复补丁，多次后续读取确认注入、prepareDecision、observeAction、selection 回执仍保留。计划动作先检查计划身份/步骤再固定实验，回执先推进计划再更新实验，避免后者标记被前者覆盖。正常 monitoring 动作省略 selection 时保留上次评估，同候选版本的有效回执累计已处理触发，避免旧争议反复要求复盘。

上下文约束：默认卡最多三个候选，每候选一个行动选项、两个重点实验、四个触发；文本有缩略标记，遗漏数量有显式说明。`competitionProjection` 的序列化 JSON 上限为 8000 字符（不是 token 上限），父与 child 共用该实现；超限先收缩说明并保留反证/失败终点，必要时返回明确的 details_required 展开请求，完整记录不删改。父输入替换旧竞争卡，task state 不再重复候选列表。checkpoint 的 changed_cells 数组仅投影数量，截断数组标明 returned_cell_count，不把局部数组长度当完整变化量。

之前 6 Node + 7 Python/Pi 的结果属于 §11 版本。本轮只读取代码和确认持久文件，未新增或运行测试，也未执行真实 ARC；不得用之前的结果声称本节的运行接线、8000 字符边界或真实决策质量已验收。
