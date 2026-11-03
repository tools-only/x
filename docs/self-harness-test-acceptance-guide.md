# Self-Harness 测试验收分析指南

本指南用于分析 ARC Self-Harness 的 scripted smoke、真实 provider run 和对照实验。它回答四个问题：TASK 是否正常工作；ADAPT 是否正常工作；Agent 创建的 harness 组件是否形成并被使用；Agent 是否改善了更高层的 harness/engineering 流程。

先读 [development workflow](development-workflow.md) 和适用的 [设计原则](harness-design-principles.md)。本指南是运行后分析参考，不是 Pi gameplay prompt，不应注入任务 Agent 上下文。

## 1. 先固定运行事实

从产物读取事实，不凭对话摘要推断：

1. 确认 run root、代码 revision/dirty 状态、配置快照、runner/bridge/Pi 版本、游戏与初始状态。
2. 记录 provider、model、reasoning 设置、真实/模拟 ARC SDK、输入模态、动作/时间/token 上限及触发的停止条件。不得记录密钥。
3. 按环境分类：真实 provider + 真实 ARC；真实 Pi/bridge + scripted provider/mock SDK；fixture、离线重放或手写日志。三类证据不能互相替代。
4. 保留完整 run artifact 路径。报告 provider-reported token、缓存口径、父子调用数、取消/中断/未知用量和墙钟时间；未知成本不能记成零。
5. 把实际达到的阶段与未到达阶段分开。若运行在首个动作、ADAPT、子任务或后续 TASK 前停止，后续阶段标记“未验证”，不把没发生解释成 Agent 拒绝或机制失效。

## 2. 每个检查项的状态和证据

每个结论标为：**通过、失败、未验证、样本不足、不适用**。结论至少包含：观察到的事件、产物路径/日志字段、解释、替代解释、限制和下一项可证伪检查。

不要把创建、暴露、调用和覆盖合并成一个“使用”计数：

| 阶段 | 意义 | 可接受证据示例 |
| --- | --- | --- |
| Created | Agent 实际创建或修订带版本的组件 | 保存回执、作者、逻辑名、版本和内容 hash。runtime 自动生成/注入不算 Agent 自主创建 |
| Shown | 组件到达 Agent 可见位置 | 实际 provider request 的 system/context/tool schema 或 child request；磁盘存在、索引有条目不够 |
| Called | Agent 显式调用组件，或显式读取/运行内容 | provider tool call、具名读取/skill/subagent 执行及完整回执。仅仅 Shown 不算 Called |
| Covered | 组件实际影响任务或之后的 harness 决策 | 后续输入/推理/调用/动作与组件内容对应，有事件证据且时序成立 |

“Covered”仍可能只是关联。若声称组件导致决策改变，应检查前后差异、同一 Agent 的理由和合理替代解释；声称收益还需对照。真实组件的 `component_runs ok=true` 是成功执行的硬条件，但单独不证明 Covered 或收益。合理不使用也要记录适用机会及理由，不强迫创建或调用。

## 3. TASK 验收

检查以下事件链，而非只看 run 最终 `passed`：

- **启动与上下文：** Task Agent 收到目标、当前 observation、可用工具、动作/时间预算和有效 harness；确认没有把开发 AGENTS、验收规范或游戏源码泄漏进 gameplay context。
- **行动：** 决策是否到达真实行动入口；每个 ARC action 是否有有效结果/receipt；Python 代理行动需追溯到 `env.act` 或对应权威入口。
- **反馈：** Agent 是否读取最新 observation 和行动回执；预测、假设及反证是否与实际状态一致；是否出现重复分析、重复动作或对停滞信号的忽略。
- **进展：** 报告动作数、关卡/任务状态变化、关键实验结果、最后有效进展及停滞区间。单动作变化不等于任务成功；未通关也不自动表示 loop 错误。
- **终止与恢复：** 区分 Agent 主动停止、胜利/失败、预算停止、provider 错误、decision/idle timeout、recovery exhaustion、runner/环境故障。核对取消请求、重试和环境行动没有被重复提交。
- **成本：** 计算父 Agent、ADAPT、subagent、critic/refiner 等全部相关调用的总成本/延迟；说明哪些辅助机制实际运行，哪些只是挂载。

TASK “正常运行”表示其 loop 能依预期完成若干 Task 决策、消费反馈并按有效停止条件结束；任务目标是否达成另行报告。若 run 在超时恢复耗尽时中断，记录 loop 完整性失败，即使之前动作有效。

## 4. ADAPT 验收

逐次重建调度，不以 prompt 中写“可请求 adapt”证明功能可达：

1. **触发源：** 区分 `request_adapt`、配置规则、检查点、`after_batch`、显式人工探针和 runner 强制调度。记录原始事件及当前配置快照。
2. **请求与合并：** 若 Agent 请求，记录调用参数、边界回执、请求 ID、合并/去重、待处理状态。无行动 TASK 请求也要单独检查。
3. **调度边界：** 检查是否在下一已结算安全边界进入 ADAPT；terminal、动作/时间预算、失败和恢复时应按配置跳过或结算，不得悄悄丢失或重复执行。
4. **ADAPT 工作：** 确认独立调整轮真实发给同一授权模型；它看到了触发原因、当前任务相关 evidence 和当前组件状态；它可以不修改。记录 save/skip、失败及实际改动版本。
5. **返回 TASK：** 确认 ADAPT 结束后 Task 恢复，读取新版本/反馈，并继续行动或给出有依据的等待/停止。
6. **成本与价值：** 统计每个 trigger 的 ADAPT 请求/调用/时长/token 与其覆盖的 Task 进展；不得用 ADAPT 次数、调用率或保存组件数作为奖励。

无调用有多种解释：没有可见机会、合理判断无需调整、工具没有暴露、模型漏看信号、请求前发生超时、运行提前终止。报告只有日志能排除的解释；机会未出现时自主触发结论为未验证。

## 5. 五类 harness 组件验收

对 prompt、memory、skill、tool、subagent 逐个版本建立生命周期记录。不要只列组件总数。

| 类别 | Created 核对 | Shown / Called 核对 | Covered 核对 |
| --- | --- | --- | --- |
| Prompt | 作者、版本、hash、适用范围；区分用户/Agent/runtime 写入 | 实际 TASK 或 ADAPT request 是否含该版本；若无显式调用接口，Called 标为不适用 | 下一轮决策/动作是否体现新增或修订内容；只看到 prompt 不算使用 |
| Memory | 写入/更新/删除回执、键、版本和证据来源 | 后续上下文是否包含正确版本；若通过显式 read 工具，记录读取调用 | 是否用记忆更新假设、避免已知失败或改变下一行动；陈旧/冲突记忆单独记录 |
| Skill | Agent 创建的具名 skill 及版本 | 索引可见与正文装载分别记录；skill 执行需记录输入、输出与 `ok` | 成功输出是否进入 Task 判断/动作；仅创建或挂载不算使用 |
| Tool | Agent 创建/发布的逻辑名、schema、版本与权限 | provider 工具 schema 可见；记录调用参数、工具结果、成功/失败和结果读取 | 工具输出是否影响下一决策/动作。L0 要求至少一个 Agent-created tool 有一次成功记录调用 |
| Subagent | 角色、任务边界、授权和 Agent 是否创建/修订 | 真实调用、子请求模型、传入上下文、返回状态与语义结果；服从同模型/权限约束 | 父 Agent 是否消费结果并据此行动；计入父子合并 token、延迟和管理成本 |

每类均可有合理的“未创建/未使用”结果。区分**机会存在**、Agent 是否识别、是否投入、是否保存、是否装配、是否语义使用、后续反馈/修订/退休。组件失败、旧版本、重复覆盖和任务结束前未验证均保留在台账；明确组件何时进入后续 loop、替代了什么工作、反馈如何回来、何时停用。

## 6. 更高层 harness / engineering 流程验收

“Engineering”在此指 Agent 对自身 harness 构建/改进过程、loop 调度、context 装配、工具/组件生命周期、验证/反馈流程等元层规则的修改。普通 ARC 策略、一次性 Python、Task prompt 或 runtime 自动日志本身不算 engineering 优化。

对每项元层变更记录：

1. **问题与规则：** 真实失败/负担、旧流程具体断点、待改变的过程规则，以及其适用/不适用条件。
2. **作者与授权：** 是 Agent 自己提出并显式写入，还是开发者/runtime 修改；只有 Agent 创建或调用的内容可计入 Agent adoption。
3. **生效位置：** 新规则进入哪个后续 engineering/TASK/ADAPT 请求、调度点或工具入口；验证实际请求/schema/state，而非文件内容。
4. **执行与反馈：** Agent 是否按新流程完成下一次适用的 engineering 工作；其结果是否被评估、修订或退休。
5. **收益与风险：** 对任务质量/进展、父子总成本、延迟、管理往返、上下文占用和认知连续性的变化；检查是否引入更多常驻提醒、回顾义务或过度调整。

元层过程改变达到 **L3** 需要真实 Agent 对 process rule 的修改在适用后续流程中被执行，并有可归因的结果改善证据。仅写出 engineering prompt、改变配置、通过 fixture、少调用几次或产生更多组件，都不能判为流程优化。应预先固定比较条件和推翻阈值；需要独立真实 provider run 或 matched-prefix fork，控制游戏/初态、模型、预算和其他变更。一般性声明还需 held-out 游戏或任务验证，不得将 ARC 特定游戏线索硬编码为一般能力。

## 7. Self-Harness 验收阶梯与四层结论

报告两种互补结论，不互相替代：

| 阶梯 | 最低接受证据 |
| --- | --- |
| L0 | 至少一个 Agent-created tool 随后有成功的实际调用记录 |
| L1 | 同一工具版本再次成功调用（via++） |
| L2 | 常驻反馈改变下一轮的保存/调用选择；要证明因果，需看到该反馈及下一次选择的时序与内容 |
| L3 | Agent 修改的 Meta/process rule 被采用并 demonstrably 改善结果 |

AR、critic、runtime 自动优化或开发者直接修改不能替代 L0/L1 的 Agent-owned component use。报告达到的最高阶梯，并列出未达到的原因；本阶梯不是 ARC 通关指标。

再分别报告开发流程的四层证据：

| 层级 | 可以声称 | 不足以声称 |
| --- | --- | --- |
| 功能正确 | 对应组件/协议输入输出和失败路径符合实现约定 | 不证明生产 loop 接线或模型会使用 |
| 全链路可达 | runner→bridge→Pi→TASK/ADAPT→组件/工具→结果→后续 loop 的目标路径已执行 | scripted provider 不证明自主行为 |
| 自主采用 | 真实 provider 在普通、非强制提示运行中识别机会并自主完成适用的创建/请求/调用/反馈路径 | 单次通关、组件存在、脚本指定调用顺序不证明一般采用 |
| 净收益 | 预先定义、相近预算的对照显示任务进展/质量与父子总成本的净变化 | 单次运行、组件数量、token 下降或调用次数变化不证明收益 |

一项功能可以通过、全链路通过而自主采用未验证；一项组件可以被调用成功但没有覆盖任务；任务可以通关但不归因于 harness。避免用单一总分掩盖这些差异。

## 8. 每次运行后的报告格式

```markdown
### Run identity
- Artifact root / source revision / dirty state:
- Provider / model / environment / configuration:
- Authorized and actual action, time, token/cost bounds:
- Stop reason and unknown accounting:

### TASK
- Status and event evidence:
- Actions / task progress / terminal result:
- Errors, recovery, repeated or stalled behavior:

### ADAPT
- Trigger opportunities and trigger source:
- Request → schedule → ADAPT → TASK evidence:
- Changes or justified no-change; total cost:

### Components
| type/name/version | author | Created | Shown | Called/ok | Covered | next feedback/retirement | evidence |

### Engineering / meta-process
- Process problem and rule change:
- Agent ownership and real activation point:
- Subsequent execution and measured result:

### Acceptance
- L0–L3 highest supported level and gaps:
- Functional / reachability / autonomy / net benefit states:
- Claims supported, unknowns, and next falsifiable check:
```

每个结论附精确 artifact 路径及必要 event/request ID。保留负例和合理不使用。下一检查只针对一个主要断点；真实 provider 运行必须有新的明确预算授权。不要把本指南、AGENTS.md、游戏源码或验收要求放进游戏 Agent 的上下文。
