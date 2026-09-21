# Agent-native Self-Harness：单次生命在线自适应设计

日期：2026-09-20。

状态：最终建议设计和最小迁移规范；本文落盘不表示下列运行机制已实现或验收。本轮不启动真实 FT09。

本文固定模型前提，收拢 main agent、Auto-Research、Self-Harness 的责任，并定义工程贯通的最小范围。后续实现若违反下列不变量，应先明确修改模型假设，不能作为局部优化悄悄引入。

## 1. 模型定义

采用“单次生命、不可重置环境中的预算约束在线自适应决策，包含元推理和任务内 Harness 演化”。英文描述为 single-life online adaptive decision-making with budgeted metareasoning and task-local harness adaptation。这是本项目的组合性描述，不声称提出一个已有公认名称的算法。

环境状态可以部分不可观测。主 agent 根据可见历史和工作状态决策，不假设有限 checkpoint 已经是充分的 Markov state。只有一条真实环境历史，不存在免费分支、回滚或独立交互样本。

记 n 为主 agent 的决策序号，t 为环境动作序号。主 agent 的可用信息包括：

```
I_n = (可见历史/精确证据引用, 当前工作状态, Harness 库,
       本次实际组装, 剩余预算, 已交付的研究信息)
u_n = 环境动作 | 发起/继续研究 | 修改/选择 Harness | 其他原生计算
```

Harness 的读取和组装也影响上述所有选择，因此不把“利用 Harness”强制划为与交互、研究互斥的独立阶段。每次模型调用都在某个 Harness 实例下选择下一步。异步研究的完成是消息交付事件，不是另一条环境历史。

优化对象是同一预算内的任务表现和资源效率。具体任务确定成功、进度、动作预算、计算预算与期限的优先级；不把研究报告数、组件数、局部测试通过数设为任务奖励。若用数学目标描述，可采用期望任务效用最大化并受动作、计算、时间预算约束，无须在 runtime 中求解该目标。

这不是天然的 no-regret bandit。动作改变后续可达状态和证据分布，元决策还改变之后的策略。no-regret 是给定反馈、比较器和环境假设下的算法性质。不可逆陷阱下无法无条件保证。若以后定义策略 regret，比较器应在相同初态、信息与预算规则下产生自己的整条轨迹；不能把未执行策略放到已发生轨迹上评分，就当作它的任务收益。Harness 变化表示行为策略变化，不自动意味着环境转移规律非平稳。

理论定位参考：

- [Single-Life Reinforcement Learning](https://arxiv.org/abs/2210.08863)：单次 episode 内完成任务的设置；本项目不据此声称使用其学习算法。
- [Learning to select computations](https://arxiv.org/abs/1711.06892)：把计算选择纳入元决策。
- [From regret to policy regret](https://www.microsoft.com/en-us/research/publication/online-bandit-learning-adaptive-adversary-regret-policy-regret/)：依赖历史的反馈下需要审慎定义比较器。

## 2. 必须保持的不变量

1. main agent 是唯一真实环境动作的语义决策者和调用者。工具内部不得隐藏一串真实动作。
2. 一次动作的结果必须进入 main agent 的后续模型输入，才能决定下一次动作。工具串行执行不等于模型已逐步观察；同一模型输出的多次动作调用也不能直接全部执行。
3. child 的 budget 是请求主 agent 花费资源的上限，不是环境操作 lease。主 agent 可以拒绝、缩减、停止或因新状态修改后续计划。
4. 所有探测推进同一任务，计入真实动作预算。Harness 版本回退仅改变未来配置，不能撤销环境结果或主 agent 已获知的信息。
5. Auto-Research 只能写隔离的研究产物，不能改当前 Harness、激活组件、取得环境 action capability。
6. Self-Harness 不调用模型、不发起研究、不决定环境动作。它负责执行主 agent 的明确修改意图，以及自动记录、组装和证据归并。
7. 每次有效组装、原生调用和评测必须指向精确版本。早期 hook 的“计划暴露”不能冒充 provider 实际接收的内容。
8. 局部正确性、在线预测符合、被使用、任务成功和因果贡献分别记录。缺乏证据时保留 unknown/inconclusive。
9. 普通执行不强制 start/review/propose/approve/resolve 等手续。只有真实权限、预算、版本完整性和环境边界可以阻止对应操作。
10. 主 agent 的选择理由采用简短 reason/expected/basis_refs 和已有 checkpoint 引用。runtime 不补写心理解释，不要求私有思维链。

若环境还随墙钟自行变化，应同时记录 elapsed time，把研究延迟纳入状态变化和成本；不能依赖“计算期间环境暂停”。当前动作驱动配置也保留这一时间字段。

## 3. 三个模块的责任

| 模块 | 输入 | 输出 | 责任边界 |
|---|---|---|---|
| main agent / Pi 主循环 | 最新动作结果、工作状态、实际 Harness、研究交付摘要、预算 | 原生动作、研究调用、Harness 修改或选择 | 承担任务与语义判断，独占环境交互，决定是否采纳研究 |
| Auto-Research / Pi child | 决策相关问题、证据截止点及引用、目标方法/版本、计算预算、已有 session | 结论、可执行候选、局部检查回执、后续预测、可选实验请求 | 自主计算、建模、构造和检验；允许纯研究结果；不执行环境交互或 Harness 应用 |
| Self-Harness / 确定性 Pi extension | 主 agent 修改意图、资源引用、Pi 生命周期事件、执行与检查回执 | 原生组件版本、下次调用的组装、应用回执、证据与成本索引 | 路由、校验、持久化、投影、记录、关联；不判断研究结论是否值得采用 |

“轨迹/research → 组件”的语义转换由主 agent 或它委托的 research child 完成。child 生成的是隔离候选；主 agent 可以自行编写，也可以按候选引用采用，无需重写报告。Self-Harness 不能从内容中可靠推断科学含义，只能根据声明的类型、载荷和属性校验并路由。

每 turn 前具体选什么由主 agent 已建立的选择策略/显式选择负责；执行组装由 runtime 负责。初始调用使用版本化默认策略。主 agent 在本次调用中改变的策略从下一次模型调用生效，不能决定自己已经见过的本次输入。无变化时延续前次选择并标记 carry-over，不能虚构一次新的主 agent 决策。

选择策略可以是常驻的 Harness policy/prompt 组件，也可以包含声明式适用条件。主 agent 修改其内容，runtime 执行可计算条件；条件无法计算时保留为主 agent 判断，不能声称代码已经确认语义适用性。

调用依赖保持：main → Auto-Research；main → Self-Harness；main → 环境。child 的 report/request 回到 main；Self-Harness 不反向调用 child。跨阶段的 request/result/resume 是显式有界数据交接，不能禁止正常反馈循环，也不能形成 child 自动接管或递归调度。

## 4. 面向 agent 的最小接口

保留三个既有写/行动入口，不增加总控 agent：

```
auto_research(question / session_ref, evidence_refs, budget, ...)
task_harness(action="change", changes 或 candidate_ref, decision)
task_harness(action="adopt_research", research_run_ref?)
arc_action(action, decision)
```

其中 `change` 表示父 agent 提交一个语义 harness 改动；版本、组件路由、native 调用和回执由 runtime 完成。`adopt_research` 表示父 agent 采用一个已完成 research 的 harness 产物；仅当多个 run 同时待采用时才传 `research_run_ref`，route ref、hash、步骤依赖、receipt 和 session 状态由 runtime 处理。

资源读、普通 delegate 和工具计算继续使用现有 Pi 工具。status/inspect 可保留为只读发现入口。旧 apply_route/activate 等入口在兼容期转入同一实现，不再构成独立修改通路；`apply_route` 只用于恢复或幂等重放。效果评估在唯一 decision 时自动绑定 decision 与已有 exposure refs。取消普通执行中的强制 kickoff 和语义 review 阻塞。

Self-Harness 的 change 支持 create/update/select/deselect/retire；复用已有 create/update/reuse/retire 语义时可采用兼容映射，不必一次重命名全部 schema。create/update 默认安排下次调用生效；显式仅保存时不激活。一次调用返回精确版本、检查结果、待生效边界和可读差异，不要求 agent 再调用 resolve。

decision 复用 reason、expected、basis_refs；上下文已有明确 checkpoint 时允许引用，不重复填完整表格。对所有决策自动记录客观调用与成本；没有声明的理由记为未声明，不拦住任务。需要评价预测的修改才提交可检验预期，不能从普通文字硬造谓词。

主 agent 平时只得到短的变化摘要：新报告/请求、当前预算、适用版本、失败或待验证预期；完整记录按 ref 读取。无变化不反复注入生命周期说明。

## 5. 统一 Harness 路由

一个纯代码编译器处理主 agent 自写候选和 child 候选引用，复用现有 native executor registry。Auto-Research completion 只保存候选，不编译或应用路由。caller 身份来自 runtime，不接受模型自报 actor 绕过权限。

| 声明语义及载荷 | 原生目标 | 校验重点 |
|---|---|---|
| 事实、状态、计划、适用前提 | memory | 来源、作用域、时效、替代关系；允许标注 hypothesis |
| 可复用的文字程序/推理方法 | skill | 输入、步骤、适用条件、输出；任务内可复用即可 |
| 可执行程序/确定性变换 | tool | 程序 schema、输入输出、运行预算、依赖、实际权限 |
| 委托角色、模型级子过程 | subagent | 角色定义、工具白名单、预算；不得获得真实环境动作或父 Harness 写权限 |
| 稳定策略、选择规则、常驻约束/提示 | prompt/system_prompt overlay | 注入层、优先级、适用范围、版本；不能覆盖固定交互权限 |
| 结论、评测、证据 | research resource | 不要求强制沉淀组件 |

内容类别与暴露方式分离。memory/skill 可以按需读，也可以被选择为上下文内容；稳定策略可以有原生 prompt 版本。一个候选如同时生成基础组件和 prompt 投影，必须记录 source/dependency，避免两份独立真值。不要仅因为“希望一直看到”就把未验证猜想升格为稳定规则。

确定性 schema 校验只能证明结构和权限相容，不能证明作者声明的稳定性或算法正确性。检查结果作为证据附着；研究不确定但结构合法的版本允许主 agent 在预算内试用，必须保持 untested 标签。

## 6. 版本、组装与演化记录

采用现有任务级 JSONL、文件和资源索引，不引入图数据库或事件总线。Self-Harness runtime 维护记录，主 agent 不手写 ledger。

四类逻辑记录足够；可以扩展现有日志而非再复制四套真值：

1. **Decision/event**：run/decision/provider request、两种时钟、工具参数引用、已有工作状态/理由引用、当前组装、真实成本与结果。
2. **Artifact revision**：组件/候选内容哈希、精确父版本、来源 decision/report、依赖、作用域、声明适用条件。
3. **Assembly**：实际 provider request 对应的组件版本、选择策略版本、projection/compaction 版本、实际输入与工具 schema 的哈希及可恢复引用、被排除项及机器可核对原因。
4. **Evidence/experiment/check**：目标版本或选择规则、预测/检查定义、定义时的证据截止点、运行输入、结果、成本、适用性与关联的真实动作。

尽量记录原有 canonical 数据引用，避免重复保存整段 prompt 或轨迹；需要精确复现输入时保存脱敏后的有效投影或其可恢复组成，只有 hash 不能称可复现。若 provider 不支持最终 payload hook，标记 measurement_basis=context/intended，不冒充 effective。

**内容版本不可变，状态和证据可追加。** 区分三个维度：

- 存储状态：candidate → committed → retired。candidate 在研究区或 parent 提交载荷中；committed 表示进入组件库；retired 表示不再被新组装选择。
- 使用关系：在哪些 assembly 被 selected/exposed/invoked。一个版本可反复选用，不因一次未选中就失效；prompt 暴露不证明模型遵从，skill 可读不证明实际使用。
- 证据状态：structural/local/predictive/task-outcome 等具体结果，可冲突、过期、不可判定；没有单一“validated=true”取代这些关系。

更新 v2 不覆写 v1。停用不清除历史上下文；更正应附替代/失效提示并更新后续投影。恢复 v1 是在当前状态重新选它，重新检查依赖和适用性，不能继承“恢复到过去”的含义。

版本作用域默认当前任务；阶段性/状态性条件由版本声明。依赖使用精确版本；依赖缺失或不兼容时 runtime 抑制相应组装并返回原因。选择逻辑变化也版本化；版本本身包含选择动机来源，但每一次选择另记 decision/selection 关系，因为同一版本可在不同前提下重用。

**生效边界**：一次 provider 请求固定其组装和可调用版本。变更在当前调用中持久化，下一次 provider 请求才投影/绑定。旧模型输出不能意外执行新的同名工具实现。runtime 自动发出生效记录，agent 无需确认。

**失败与部分成功**：MVP 不宣称跨五类 native store 的分布式事务。每项有独立回执和幂等键；有依赖的后项只在前项成功后处理，失败时返回已提交、待生效、失败和未执行列表。下一次实际组装只包含成功且依赖完整的版本。注册失败沿用可用旧绑定或明确抑制该组件，并记录；不能宣称整批已激活。

## 7. Research 如何获得真实的自主研究能力

研究问题面向会影响后续决策的不确定性，而非指定“生成某个 skill”。类型包括机制、表示、能力、组合、探索、规划、求解和恢复。一次报告不必成功、不必有组件，也不要求所有问题都构造两个竞争算法。

最小的驱动机制是提供可执行反馈和可恢复的证据交接：

1. **固定输入边界**。child 得到 selected evidence refs、as_of_event 和目标精确版本；只读 arc_state 映射到这份父侧发布的快照，不能后台不断读取移动的 live state。继续研究时显式提供增量证据。
2. **局部计算工具**。从 executeTaskProgram 提取无环境能力的纯执行器，提供一个 child 可用的 research_check。它接收候选程序/引用、输入集、检查谓词和比较对象，返回具体差异、失败样例、成本、不可变 check_ref。运行次数/步数/输出有硬预算；禁止 adapter action/network 和任意父工作区写入。
3. **检查证据分级**。既有样例是拟合/回归证据；合成样例是模型内或属性证据；未观察的真实后续是在线预测证据。记录样例来源和首次暴露时间。child 自己提出的断言不是外部 oracle，测试通过不能升级为环境事实。
4. **后续可验证预期**。child 可以在报告中提交针对未来观测的判别条件/反例条件，或请求主 agent 采集证据。runtime 对可计算谓词产生 match/fail/inapplicable/inconclusive 记录；语义判断留给主 agent/后续 research，并标明 judgement，不能伪装为机器测量。
5. **带证据恢复**。child 在 awaiting_evidence 时释放进程；主 agent 用现有 auto_research resume/session 接口交付新证据。已完成研究的后续问题可另开 session 但继承 research_line_ref。line 只是关联键，不是新调度器。

去除 child 对自己 proposal 的 approve 仪式。submit_research_report 只验证资源存在、哈希、引用和结构；局部验证声明必须附真实 check_ref 才能被标成机器检查通过。没有 check 的规划推论依然允许提交为 conjecture/untested。

MVP 的纯程序执行器不能评价所有文字 skill、prompt 和 subagent 推理质量。它能检验相关表示/算法/输入输出条件；其余采用结构检查、真实使用记录、预先声明的在线预测，并诚实保留证据缺口。以后若增加任意代码或离线模型比较，必须另行提供隔离计算能力；不能把本地 mock 当真实环境。

这些 affordance 使 child 可以在工具反馈中修订程序、表示、规划和实验，而非只有报告文案。但无法用 schema 保证 LLM 一定进行高质量研究；真实 provider 验收必须检查它是否实际调用、修订，以及是否改善主 agent 决策。

## 8. Child 请求真实实验的最小交接

复用 experiment_request，增加机器字段；删去重复行政步骤。请求至少记录：

```
request_ref                       # runtime 分配
as_of_event, basis_refs
question, suggested_next_action   # 建议，不是待自动执行命令
requested_max_actions
applicability / stop_condition
prediction / distinguishing_outcomes
```

scope、耗时、期限等按任务需要选填，已有真实总预算始终优先。预算数是上限，不代表可达性或安全保证。机器可计算条件硬检验；其余明确留给主 agent 判断。

主 agent 接收请求后：

1. 在最新观察上判断是否仍适用，是否值得用任务动作换取信息。
2. 若采用，在第一次正常 arc_action.decision 中附 `research_request_ref`、`approved_max_actions` 和当前状态引用。无独立 approve 工具。
3. parent runtime 将授权上限绑定请求，按 request_ref 计数；每一步仍由 main agent 单独发出。后续请求标签不能自行扩大已授权预算。请求额度是任务总额度内的子额度。
4. 每次结果先送入下一次 main 模型输入；它决定继续、调整或停止。超过上限不能继续以该请求名义调用；无关的正常任务动作不因请求未 resolve 而阻塞。
5. 每个被标记的动作回执自动回填请求的 evidence_refs；即使已消耗额度，后续任务观察仍可作为标明来源的观察性证据。
6. 到达上限/期限/终止状态自动关闭采集窗口。证据不够则 inconclusive。主 agent 可以正常调用 resume 将这些引用交给 child；无需另行写实验总结或解除锁。

未采纳请求可以保持未执行直到过期，不强制逐条 reject。环境已变时不能重放旧建议；主 agent 可依据当前状态重新采纳并记录新前提。网络错误若无法确认真实动作是否执行，记 unknown 并先对账，禁止以通用工具重试造成二次动作。

child 禁止直连 live bridge；仅移除工具名或环境变量不能视作任意代码沙箱。MVP 使用 capability 受限纯执行器，进程仅获得研究资源和通信能力。未来开放任意 shell 时必须另行核实文件/网络隔离。

## 9. 评估与 credit assignment

先建设可归因的记录，再研究因果估计器。首版不把 task reward 任意分摊到所有组件。

记录链为：

```
main decision → research / change / direct action
research → candidate / prediction / decision implication
change + selection decision → artifact revision + assembly
assembly → provider decision / concrete invocation
action → observation → later check / task outcome
```

所有研究成本、失败变更成本、未使用产物都进入根决策记录。任务结果只记录一次；各节点保存关系和证据，不能沿链复制成多份奖励。

四层反馈必须独立：

| 层面 | 可回答 | 不能推出 |
|---|---|---|
| 局部检查 | 某版本在具体输入上满足特定约束/比另一计算少耗时 | 更容易完成整个任务 |
| 在线预测 | 事前预期在某适用条件下是否匹配后续观测 | 该组件造成了结果 |
| 实际使用 | 被暴露、读取、调用、引用，对应哪些行动 | 模型一定遵循或该使用有正收益 |
| 任务结果 | 同一运行整体取得了什么结果、付出多少成本 | 各组件独立的因果贡献 |

组件 credit 是“在什么前提、由何选择、如何使用、有哪些支持/反证”的有条件证据。选择策略也可以被研究，例如某类不确定性出现时是否值得先算/先研究。但未选分支通常没有真实结果，不能直接计算其后悔值。

Harness 持续变化带来的混杂通过精确 assembly、选择理由来源、时间和证据适用条件显式标出。局部检查固定输入/程序版本，所得结论限于那个计算问题；在线检查按后续真实策略产生的数据标注。新版本不继承旧版测试通过标记，除非明确重跑或证明被检查部分等价。模型和派生模拟器结果仍是模型内证据。

没有行为概率、覆盖与可比性条件时不做 IPS/DR 等 off-policy 数值估计。版本化提高可审查性，不解决不可识别性。如果多项同时变化，只能形成组合级证据或无法区分的记录，不强行分项。阶段性归并通过现有 research 提交问题完成，不额外增加评估 agent。

## 10. 当前工程的最小迁移

本节基于 2026-09-20 源码核对；路径均相对项目根。

| 顺序 | 当前断点 | 最小改动 |
|---|---|---|
| P0 | pi_arc_task_tools.ts 的 arc.action_sequence 直接循环 performAction；pi_arc_agi_3_extension.ts 向其注入 bridge /action | 删除 task tool 的 live action capability，序列只作为计划数据；arc_action 一次原生动作，禁止同一模型输出批量推进，动作结果后才允许下一次决策 |
| P0 | kickoff、level/periodic review、research handoff 可以阻塞 arc_action | runtime 自动初始化；普通执行改为不阻塞的摘要/索引，只保留真实预算/权限/终态检查；诊断场景要求与在线默认行为分离 |
| P1 | applyFacadeChanges 和 applyCompiledRoute 分别编译，child completion 还 compileHarnessRoute | pi_harness_protocol.ts 收敛单一分类器；两类候选统一编译为 native calls；pi_task_local_subagents.ts 仅保存候选；复用 pi_task_harness_route_runtime.ts executor registry |
| P1 | submit_research_report 强制引用 child approval_id | 候选采用不可变 hash/ref，移除 child 自我 approve 前置要求；parent candidate_ref 采用；旧 approval 仅兼容读取 |
| P1 | 组件版本和 exposure 日志存在，但并非每次实际 provider request 的组装 join | 扩展 pi_task_local_self_harness.ts、pi_provider_telemetry.ts 和 pi_task_resource_store.ts：统一 decision/request/assembly refs；最终 payload hook 优先，fallback 如实标记；下一请求生效并绑定精确实现 |
| P2 | experiment_request 主要是文字 action_cost/parent_action；child 只读 state 来自移动 live bridge | pi_task_validation_child.ts 与 pi_auto_research_output.ts 增加预算/请求/截止点；pi_arc_readonly_subagent_extension.ts 改读父发布快照；pi_arc_agi_3_extension.ts 原生 decision 附请求引用和首次授权；parent runtime 记录额度和回执 |
| P2 | child 缺少有真实执行反馈的纯计算检查 | 从 pi_task_local_tools.ts 提取纯 executeTaskProgram；child 注册 research_check；日志记录输入/候选/谓词版本和结果；禁用所有 live adapter capability |
| P2 | awaiting_evidence、增量结果和已有 session 的交接未贯通 | pi_task_local_subagents.ts、pi_auto_research_handoff.ts、pi_auto_research_output.ts 对齐 request_ref/research_line_ref/evidence refs；复用 broker 和 resume，异步结果在主模型调用边界交付 |
| P3 | validation window 只是证据窗口；output_not_input 被记为 semantic_effect_observed | 保持验证窗口与实验预算独立；pi_task_local_tools.ts、arc_agi_3_e2e.py 等报告拆分执行/变换证据、预测结果、任务结果；不输出未经识别的因果收益 |

新增代码最多为一个小型共享事件/引用 helper 和纯检查执行器；可从现有文件提取。没有新常驻服务、总控模型、研究调度器、因果打分器或全局数据库。迁移必须同步删改旧 prompt 中强制流程与自动应用说法，不能只把新 schema 叠到旧要求上。

## 11. 最小贯通场景与验收

一条真实 runner 路径验证以下链条：

1. main 在当前状态提出一个影响后续规划的问题，调用 Auto-Research。
2. child 读取绑定证据，构造表示/方法，实际执行纯检查并获得失败/差异反馈，修订或明确失败。
3. child 返回候选或规划结论及最多一个预算实验请求，处于 awaiting_evidence；不能取得 live action 权限。
4. main 在当前状态采纳请求，用正常 arc_action 执行；每次结果进入下一 main 模型输入，所有动作计入任务预算。
5. main resume 原 session，新证据有精确引用；child 据此修订结论，可返回空候选。
6. main 通过统一 change 采用候选或自行修改；下一真实模型调用的 effective assembly 能证明具体版本进入。
7. 后续真实调用/动作和检查回执回填目标版本；不适用、失败、未知结果均是合法闭环结果。

五类组件需分别覆盖 memory、skills、system_prompt、tools、subagents。子 agent 的研究参数化不等于在线控制权。工具输出验证语义内容，不能只检查 completed。length continuation 覆盖 Auto-Research 和普通 delegate_task。

还需覆盖：拒绝请求不阻塞动作；请求过期、额度耗尽、重复交付、部分成功、版本冲突、旧候选、异步报告迟到；同一模型输出的双动作被边界阻止；旧 action_sequence 无法暗中推进；provider fallback 不伪报实际输入；父上下文在 compaction 后仍知道当前未完成实验和已失效结论。

分层验收：单元/组件测试只是诊断；协议闭环必须运行 arc-harness-smoke，经真实 ARC bridge、Pi parent、child broker/process、structured return、代码路由、native mutation、ARC action 和后续真实 parent turn。确定性 provider 验证连线，不证明 agent 研究质量或任务收益。涉及 provider 行为和表现的结论必须另有真实 provider 运行；不以重启 FT09 作为本设计交付的一部分。

## 12. 取舍与暂不引入

ADR-1：主 agent 保持唯一语义控制。拒绝 child lease 和隐藏动作序列，代价是动作间模型调用开销，收益是不可回退轨迹的上下文连续性。

ADR-2：主 agent 保留语义自主，Self-Harness 提供一次修改和自动演化记录。拒绝多阶段 proposal/approval/resolve 状态机，代价是 runtime 需要准确处理生效/失败边界，收益是避免流程悬空和额外决策手续。

ADR-3：首版采用可检验局部反馈和事前预测关联。暂不引入在线因果打分器或 no-regret 承诺，代价是保留许多 unknown，收益是不会把版本记录和轨迹相关性误报成学习保证。

ADR-4：直接复用 Pi tool、context/provider hook、session、broker 和任务资源库。自定义协议只覆盖 Pi 原生没有的版本关联、实验额度和纯检查结果，不另包一个 agent loop。

后续扩展：任意代码研究沙箱、离线模型对比、统计因果估计、跨任务组件库可独立研究，均非首版贯通前提。不能为了这些扩展放松唯一环境入口。

与 docs/deferred-research-todos.md 的关系：本设计收敛 A 的边界、B 的可执行研究、C 的父子请求和 D 的证据连续性。旧候选中的 child 控制权交接、自动执行 lease 或不让 parent 模型看到中间结果，在当前范式下不采用；环境快照分支也不属于本设计。待实现和真实验收后再勾选 backlog。

## 13. 2026-09-20 最小实现：跨情境方法归纳与反馈

本轮实现了方法归纳所需的确定性外围机制，未增加主 agent 接口：

1. runtime 按 `research_line_ref`、阶段/尝试、动作签名和不同结果组织精确轨迹引用，写入 `auto-research-comparison-bundles.jsonl`。分组明确标记 `causal_interpretation=false`、`semantic_equivalence_claimed=false`；它只是 child 的比较材料，不是模式结论。
2. Auto-Research 的 procedure/computation/plan/role 交付可附 `method`：问题、输入、不变量、参数、步骤、判断点、停止条件、失败方式、构造与对照证据、下次使用、预测语义结果和反例条件。语义可比性与抽象仍由 child 判断；没有显式且有依据的抽象时只记为 `experience`。
3. `task-method-lifecycle.jsonl` 记录 `experience → candidate_method → trial → validated_within_scope/contradicted`。研究提交只产生候选；`adopt_research` 实际物化后进入 trial；只有绑定真实后续使用的 agent assessment 才可支持或反驳。
4. task tool 与 saved subagent 的完成调用有明确执行边界，可生成 `actual_use`。skill 的 context 暴露和文件读取只证明可见/访问，不证明 agent 按方法行动；memory/system prompt 的曝光同样不能升级方法。skill→action、memory/prompt→action 的精确使用绑定尚未实现，因此这些类型保持 trial，避免虚假 credit。
5. 实际使用 assessment 自动生成同一 research line 的 `method-feedback-*` handoff，包含方法版本、assessment、使用观测和原构造报告。是否运行该研究仍由主 agent 选择，runtime 不自动递归调度 child。
6. ARC child 由父 runtime 在启动前捕获一次公开状态快照并通过进程环境传递。child 不持有 live bridge；普通 delegate 与 Auto-Research 都读取固定快照。快照不进入 child prompt，避免重复旧 animation frame 或扩大上下文。

诊断覆盖了完整的非 ARC Pi 路径：研究报告产生 computation 方法候选、parent 采用、动态工具真实调用、agent effect assessment、生命周期升级和反馈 handoff。它证明机制接线和语义输出，不等于真实 ARC bridge 的五组件闭环，也不证明真实 provider 的研究质量或任务收益；这些仍按第 11 节验收。
