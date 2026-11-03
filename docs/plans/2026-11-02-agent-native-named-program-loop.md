# Agent native 具名程序最小闭环：方案与计划

日期：2026-11-02。状态：待实现的补充方案；不替代既有历史计划，不代表功能或收益已验证。

## 问题与命题

当前 TASK 默认在持久 Python session 中逐格探索，之后才尝试把函数提升为 Tool。旧状态的坐标等数据与可复用方法混在同一 namespace；Workspace、Binder、Skill 还有另一套创作与装配入口。TypeScript 阶段循环虽可调度 TASK→ADAPT，ADAPT 仍拿不到 TASK 的图片、动作 note 和程序调用历史，旧 Refiner 还可自行激活组件。当前“最小 loop”因而没有隔离旧栈，也没有完成 Agent 自主的程序创作、跨状态使用和修订。

Continual Harness 的公开 ARC 实现允许 Agent 直接创建、编辑具名可执行 skill，再在当前状态按名运行；其临时 run_code 入口已关闭。参考其程序创作和运行的一致性，不照搬 Refiner 自动写入的权限。来源：[公开报告](https://continual-harness.github.io/)与[ARC 实现](https://github.com/feng-rrRay/Continual-Harness-ARC-AGI-3/blob/main/agents/templates/continual_harness_agent.py)。

本阶段的窄命题：TASK／ADAPT Agent 无须先写持久 Python cell，就能直接创建具名程序；程序在新 ARC 状态独立运行，结果参与 TASK 的选择；真实反馈出现后，Agent 能修订同一名字的版本并再次使用。若仍主要重敲 cell、程序依赖旧 namespace、只有保存没有新状态语义使用，命题不成立。单个可执行能力的闭环不能代表五类组件都已闭环。

## Agent 面前的程序接口

- 创建或更新：Agent 提交逻辑名、用途、完整 Python 代码与可选的预期旧版本。Runtime 处理路径、封装、验证与绑定；失败保留前一有效版本。Agent 不需要编写文件格式或从 session 提取函数。
- 运行：Agent 按名字和参数调用。每次使用当前权威状态，返回结果、所执行动作及反馈、实际源码版本与错误。第一次试运行与后续运行使用同一代码和沙箱合同。
- 程序只能依赖这次注入的 state、args 和受限环境接口；不能读取 TASK Python session 的活变量。它可以计算、观察、规划或在现有动作边界内执行有界动作。默认按名调用；自动 view 等装配方式须明确选择，不能由“没有参数”推断。
- 首版复用现有 Workspace、Binder、Python 沙箱和动作边界作为内部实现；具名程序是 Agent 直接创作和修订的入口。旧 promote 只作为兼容迁移入口，不计入本命题的成功。
- ADAPT 能创建、修订或拒绝候选，不能在其中执行真实环境动作。Refiner 草案在 Agent 接受前不得进入活跃版本。

## 最小运行切片

真实 TASK 观察 → Agent 创建具名程序 → Runtime 验证并绑定版本 → TASK 在状态 A 调用 → ARC 动作产生状态 B → TASK 再次按名调用并使用结果 → 真实反证进入 ADAPT → Agent 修订原名字 → 下一 TASK 在状态 C 调用新版。

为让 ADAPT 真能判断，仅补这条链必需的交接：当前观察及图片、最近 TASK 的 action note、程序版本、调用结果、对应动作反馈及原始证据引用。隐藏思考不能假装已经传入；缺少 Agent 明确留下的判断时标为未知，不由 Daemon 编造。

## 实施阶段

| 阶段 | 主要工作 | 通过条件 |
| --- | --- | --- |
| A0 隔离 | 在 opt-in 最小 loop 配置中关闭旧 Refiner 自动写入、强制 refine point、daemon response 轮、常驻 process evidence 和 meta-trial 文本、WINDOW CHECK 劝导、cell(k) 与 PYTHON SESSION 名称复用提示。保留动作安全、版本和原始日志。复验现有 phase-owner 错误恢复边界。 | TASK→ADAPT→TASK 真实 runner 接线不受旧语义修改者干扰；恢复不重复动作。 |
| A1 具名程序 | 提供直接创建／同名更新／按名运行；同一代码在新状态独立执行，源码和版本可读，失败保留旧版。 | 对真实留存 ARC 状态和后续状态都能运行；对 session 活变量的依赖有明确失败回执。 |
| A2 Agent 直接闭环 | 把程序版本、输出、action note、当前图片与反证交给 ADAPT，下一 TASK 见到修订版。 | 脚本 provider 经生产 bridge、Pi、ARC 证明接线；普通真实 provider 自主创建、在新状态语义使用、依据反馈同名修订并再次使用。若未出现，报告具体断点。 |
| A3 Refiner 辅助 | A2 成立后，Refiner 从 Daemon 原始资源提炼一项带依据的候选，经 ADAPT 由 Agent 接受、改写或跳过。拆开 Refiner、Critic、LEVEL REVIEW 开关。 | 候选不自行激活；Agent 选择、发布版本和后续 TASK 使用可追溯。与 Agent 独立创作分别统计。 |

A0–A2 是优先工作。A3 不能用来掩盖 Agent 不创作、不调用或 TASK／ADAPT 无法交接的断点。真实前缀快照和脚本 provider 用于快速诊断；真实模型行为必须用普通真实 provider 运行核查。运行前固定模型、思考模式、前缀、预算和停止条件。

## 验证和停止条件

功能正确、生产链路可达、自主采用、净收益分别报告。最小闭环需有完整证据链：Agent 创建 → 新状态按名调用 → 输出参与后续判断或动作 → 反证后 Agent 修订 → 下一 TASK 使用修订版。程序数量、保存回执、执行 ok=true 或 ADAPT 被触发都不能代替这些证据。计入创作、修订、额外模型轮次、Python 往返、父加 Refiner token、墙钟及任务进展。

A1 失败时查程序合同与沙箱；A2 没有自然创作时查机会识别和入口摩擦；保存后没调用时查可见性与适用性；ADAPT 无法修订时先查 TASK 材料交接。每次处理一个断点，不新增提示或后台服务来掩盖失败。

## 闭环后再审视的模块

闭环验收后，再依据实际断点制定逐步修正：Python session 是否降为单状态临时探查；Workspace 如何呈现源码、草案、已发布能力和只读证据；Binder 如何管理显式执行方式、版本及跨关 scope；thin ARC 如何收敛为观察、图片、动作与回执适配器；Daemon 如何只承担资源采集、状态监控和轨迹收纳；Refiner 如何仅生成候选并走 ADAPT；Ledger/Critic、process evidence、meta-trial、WINDOW CHECK 如何按证据保留、合并或移除。这些是后续决策问题，不在最小 loop 实现前预定全面重构。

相关延后事项 B/C/D 的自主复用、父子总成本和跨压缩认知连续性仍分别验证。开发证据按 [development-workflow.md](../development-workflow.md) 分层记录。

## 实施与诊断补充（2026-11-02）

已增量实现 opt-in profile 的旧服务隔离、`save_program`/`run_program`、显式程序执行方式、同名版本修订与失败保留旧版，以及 ADAPT 的图片、action note 和程序回执交接。定向 runtime 检查通过；`runs/agent-native-program-smoke-20261102-v8/summary.json` 的 10 项接线诊断通过（实际 Pi/bridge，mock ARC SDK，脚本 provider）。不代表普通模型自主采用或收益。

用户随后授权 50 个动作、无整场时间/决策/token 上限的真实运行。`runs/agent-native-program-loop-real3-20261102/` 使用 OpenRouter 路由、yibu 标签、qwen3.8-27b low。启动前一次 402 被误解释为上下文容量；实际为请求额度不足，单请求输出调整为 4,000 后运行。该参数与真实 endpoint 差异必须披露。

运行中发现 phase RESUME 未被上下文投影识别、未完成 thinking 丢失、规范观测重复投递、smoke 与真实 context profile 不同等问题。故 A0/A1 的功能与窄接线有证据，A2 的认识连续性/自主闭环仍未通过，净收益未验证。证据与修正顺序见 [上下文效率诊断补充](../reports/2026-11-02-agent-native-context-efficiency-diagnosis.md)。活动 run 不在诊断中改配置。

## 具名程序发现与选择补充（2026-11-03）

实际机会：程序已有源码和 Binder 版本，但 Agent 常驻目录只有名称、tool 类别、状态和调用数；目录过长时只剩名称。保存后有能力，Agent 仍难以判断该选哪个、何时修订。窄命题：给程序独立的用途描述与标签，并在目录和按需检索中展示版本，能让 TASK／ADAPT 取得选择所需信息；是否因此自主采用或改善任务另行验证。

本次在 `save_program` 增加必填描述和可选标签，把元数据随 Python 源码版本保存；Binder 将具名程序标示为 executable skill，短目录展示名称、版本、描述、标签，长目录提示 `list_programs(query)` 按需检索。`read_component(name)` 继续返回完整源码并显示当前版本；执行仍走 `run_program(name, args)` 和现有沙箱。程序在内部仍是 `tools/<name>.py` 的 tool 执行适配器，没有把整个五类组件模型迁移到新类型。代价是保存调用增加一条短描述；检索只在 Agent 需要时增加一次工具往返。

诊断：定向程序测试通过。`runs/agent-program-catalog-smoke-20261103-v4/summary.json` 的 11 项检查通过：脚本 provider 经实际 Pi／bridge 调用 `list_programs` 得到 v1 描述和标签、用 `read_component` 取得源码及版本，下一 TASK head 显示修订后的 v2；ARC SDK 为 mock。功能与接线可达，普通 provider 的自主选择、真实 ARC 中的跨状态／跨关卡复用和净收益仍未验证。本补充没有改变旧的 50 动作运行配置。

## 下一阶段：普通 AZ Qwen 采用诊断（2026-11-03）

用户统一指定本阶段及后续相关 ARC 测试：AZ Qwen（沿用 `qwen3.8-27b`、`thinking=low` 配置），最多 15 个 actions、最多 1 小时，不设 token 上限；先到任一上限即结束。记录实际 provider 用量；缺失的用量继续记 unknown。

先做一条普通 TASK 运行，不在任务里要求 Agent 必须创建、搜索或调用程序。观察 Agent 是否在真实机会出现时使用目录/检索理解程序用途和版本，是否查看源码、在新状态执行，并把输出用于后续判断或行动。继续观察 ADAPT 收到的状态、动作反馈和程序调用事实，是否据此修订、保留或跳过；若发布新版，检查后续 TASK 是否看到并语义使用新版。把适用机会、合理不使用、每个生命周期转移及其断点都记下来。没有出现可复用机会时，结果记为 inconclusive，不把漏用率解释成程序机制失败。

这次运行回答自主识别、选择和局部复用是否可达，不验证统计意义的净收益。即使出现创建和调用，也要分别检查语义输出是否影响决策/动作，以及 TASK→ADAPT 的证据是否完整；不得以保存成功、目录可见或 `ok=true` 代替。按实际断点决定是否需要继续改程序目录、Python session/Workspace/Binder 或 ADAPT；不要预先进入全面架构重构。净收益需在机会确认后另做相近预算对照。该运行已于 2026-11-03 启动；最终状态和轨迹完成后补记。

