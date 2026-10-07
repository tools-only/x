# ADR：从轨迹归档提升到能力创作的 Self-Harness

日期：2026-09-21。
状态：Accepted / implementation in progress。本文记录不可违反的 ownership
边界；测试通过不自动等于真实 ARC 语义收益已验收。

## 所有权矩阵（规范性）

| 阶段 | 唯一责任主体 | 允许输出 | 禁止行为 |
| --- | --- | --- | --- |
| 研究 | Auto-Research child | findings、alternatives、方法候选、规划影响、实验请求 | 读取 creator、创作 SKILL/tool/subagent、提交可执行 mutation |
| 能力创作 | parent Agent | 读取对应 creator 后创作的完整候选正文与结构 | 把 child 报告或 runtime 模板冒充为已创作组件 |
| 组件池 | Self-Harness runtime | 校验通过的精确不可变版本、来源和状态 | 语义补写正文、从研究 prose 自动物化组件 |
| 装配 | parent Agent 决策；runtime 执行 | 精确版本选择与来源无关的 task_prompt contribution | pool 中存在即自动启用、runtime 猜测当下最优组合 |
| runtime 使用 | 确定性 runtime | 投影、权限、执行、回执、实际使用证据 | 把加载/阅读/装配当作使用收益 |
| 评估反馈 | parent 判断；runtime 记账；research 可复查 | 预测与真实输出比较、retain/revise/retire、同研究线反馈 | child 依据反馈直接改写组件 |

`parent-capability-authoring-handoff-v1` 是不可执行交接物：只包含精确
research/report/method 引用、建议组件类别、creator 读取调用、父 agent 必填
清单和不完整模板。它不得携带 runtime 自动生成的语义正文。父 agent 可以
不经 Auto-Research 直接读取 creator 并创建能力；研究只是可选来源。

## 背景与现状

用户指出实际 ARC 产物的语义偏差：skill 在记述观察而非传授方法，memory 混合不同有效期，Auto-Research 过度贴近局部轨迹复盘。序列化、版本化、路由成功不能证明这些产物符合模块目的。

当前源码提供了基础机制，但没有解决上述问题：

- `demo/pi_harness_protocol.ts` 将 skill 别名归一化为 procedure，并补 execution/reuse/reasoning 默认值；分类校验不证明正文是可迁移方法。
- `demo/prompts/auto_research_child_contract.md` 已要求方法的输入、步骤、反例和验证；因此不能把缺陷简单归因于“从未写过相关提示”。创作、研究选题、实际采用和反馈仍需联合改进。
- `demo/pi_task_knowledge_lifecycle.ts` 有 availability、evidence_status、依赖失效；这些与适用时间/场景是不同维度。
- `demo/pi_task_local_subagents.ts` 已支持临时 instructions 的 clean-context delegate；持久定义主要保存 instructions/tools，尚非完整的上下文配置模板，且拒绝空工具集合。
- `demo/pi_task_tool_contract.ts` 有受限声明式执行基元；创建 API 不等于 creator 方法论，更不等于可编译任意算法。
- 检查 demo/src/docs 未发现独立的 skill-creator、tool-creator、subagent-creator 方法模块。

## 决策提案

### 1. 各组件回答不同问题

| 对象 | 应回答的问题 | 不应被误认为 |
| --- | --- | --- |
| Memory | 在什么范围、依据什么证据，目前知道/猜测什么？ | 方法库或重复的实时状态源 |
| Skill | 遇到哪类问题，如何操作、判断和停止？ | 观察流水账、把单个成功案例写成通用规则 |
| Tool | 哪段操作能按明确输入输出可靠执行？ | 只有自然语言算法描述的未实现能力 |
| Subagent | 哪项工作需要独立或预配置上下文，如何交付？ | 只有反复委派后才允许出现的角色 |
| Auto-Research | 哪个问题值得持续研究，如何构造、比较、检验解释或方法？ | 定时总结最近若干步，或定时制造组件 |

“提升一层”指职责和抽象，不是禁止低层操作：像素处理 tool 可以低层，但必须封装可执行能力；game-specific skill 可以局部，但必须能指导新输入上的工作。Memory 中的解释仍须标记为假设，忠于证据不意味着禁止归纳。

task_prompt 继续是来源无关的装配输出通道；memory、研究结果、方法、当前计划或假设均可贡献内容，不强制先转存 memory。

### 2. 语义创作与确定性 runtime 分开

```text
任务需求 / 已有能力缺口 / 研究结果
    → 主 agent 按需加载 creator，直接创作或委派创作
    → 类型化候选（含适用范围、证据、下一次语义检查）
    → 确定性校验、版本预检、原生物化
    → 精确版本组件池
    → 主 agent 按情境装配
    → 实际使用、结果与成本反馈
    → 修订方法 / 修订研究议程 / 停用组件
```

creator 负责语义判断与内容构造；runtime 负责格式、引用、版本、权限、生命周期条件、投影和执行。不能让确定性 router 靠关键词或填满字段来宣布“这是好方法”，也不在 router 内偷偷增加一个语义 agent。

直接创建、review 内联候选、研究候选采用应共享 authoring contract 与校验入口，不能绕过。结构完整是必要条件，不是语义质量证明；不合格方法应退回修订/保留为研究候选，而非悄悄升级或全部降级成 memory。

### 3. 预置 creator 方法，但不预置额外常驻 agent

建议 baseline 提供四个按需加载的 meta-skills：

| 方法 | 主要职责 | 交付 |
| --- | --- | --- |
| skill-creator | 从实例抽出问题类、适用条件、步骤/决策、停止与失败处理；分离例子与规则 | 可读 skill 正文、依赖和未用于构造的检验场景 |
| tool-creator | 判断可计算部分、定义契约、选择已有基元、实现及测试 | 实际 program/implementation_ref、语义样例、权限/错误边界 |
| subagent-creator | 设计隔离目的、上下文配方、输入输出、工具和预算 | 一次性委派配置或持久角色模板 |
| research-orchestration | 选择是否研究、研究对象、证据视图、时机、反馈和停止条件 | auto_research 调用及后续采用/反馈策略 |

baseline 的名称/description 从首轮可发现，正文按需加载。creator 的加载入口不能依赖尚未创建/选中的动态组件，避免自举死锁。固定资产记录来源和版本，与本次运行演化的组件分开统计；实验比较须记录 baseline 变更。

主 agent 可以加载 creator 后自行完成创作；复杂或需要独立视角时才委派。预置四项方法不等于每次增加四个模型调用。

同一组件小修可复用已经加载的 creator；不要靠反复读同一文件制造合规痕迹。保存 creator 版本与 authoring 来源用于审计，但不能把“读过 creator”当成质量证明。

### 4. Skill 的具体合格形态

例：`identify-controlled-object`，适用于尚未确定操控对象、切换场景后需要重新定位、存在多个移动候选时。

- 输入：带版本的帧、动作前后变化、近期动作与候选实体；必要时提出有界探测请求。
- 方法：分割候选实体 → 跨帧关联 → 区分 HUD/计数器与场景对象 → 比较运动与动作之间的对应关系 → 有歧义时设计重复/对照探测 → 保留或排除竞争候选。
- 决策：最大变化区域只能作候选线索，不是对象身份的充分条件；动画、敌人、相机运动、碰撞不动都可能构成反例。
- 输出：对象候选、位置、证据、置信状态；证据不足时明确返回不确定。
- 停止：信息足够，或达到成本/风险界限；实际环境探测仅由 main 执行。
- 失效/重新启动：场景切换、对象外观/控制模式变化、已有身份解释被反例推翻。

“本次观测中对象位于某处”写为有状态范围的结论或使用 runtime 当前状态；不能成为 skill 的主体。具体颜色/形状可作参数或带适用范围的先验，不应无依据泛化。无需等待多次失败才允许构造候选方法，但候选和已验证效用须分开。

### 5. Memory 将有效期、证据、保存和选择分开

建议增加明确的 scope binding / validity contract，使用 task、episode、level-instance、phase/state 等通用层级，具体事件由 adapter 提供、Agent runtime 解释，不让 ARC adapter 管 memory。

| 内容 | 默认有效范围 | 失效/刷新条件 |
| --- | --- | --- |
| 控制方向映射 | 当前 task/game 的控制模式 | 映射反例、控制模式改变、reset 后按环境语义复核 |
| 地图与固定布局 | 当前 level instance | 过关、重新生成、改变布局的事件 |
| 当前路线计划 | 当前起点、地图与目标版本 | 偏离、依赖变化、计划完成 |
| 当前位置、剩余行动预算 | runtime 最新状态 | 每个相关动作/状态更新；不复制成持久 memory 真值源 |
| 推断的临时机制/资源状态 | 指定状态范围 | 新证据、明确条件或版本变化 |
| 原始观察与历史结论 | 历史证据档案 | 可保留；不是始终参与当前 prompt 的有效知识 |

建议字段表达：scope kind + instance ref、valid_from、invalidated_by、source/dependency refs；必要时 expires_at_state。条件应引用明确事件或状态版本，不依赖从自由文本猜测失效。

long-term 默认是当前 task 内较长寿命，不自动意味着跨游戏、跨运行共享。跨任务转移需要独立的来源、适用性及评估设计。

过关时 runtime 在下一次装配/使用前抑制旧地图及其失效依赖，保留原记录供历史检索。作用域失效不表示原结论为假；高置信也不表示永不过期。生命周期门禁和 assembly 选择缺一不可。旧记录无明确有效期时须显式标记未知/待复核，不能默认为全任务有效。

### 6. Subagent 是上下文环境，不只是角色名称

一次性隔离工作直接用 ephemeral delegate；要复用的是角色和上下文配方时才持久化模板。配方包括：目标、必须/允许输入、应排除的父结论、来源选择规则、工具权限、输出契约、预算与停止条件。调用时绑定当前精确版本，而不是在模板中固化旧轨迹。

例如独立对象识别者读取原始帧与动作，排除父 agent 的对象猜测；规划者读取已验证地图和目标；反例审查者读取候选方法和对照证据。无需为每次需求都生成持久组件。

支持显式空工具集合以表达纯推理上下文，与“未指定所以采用默认工具”区分。保留现有 child 只读、main 独占环境行动与 harness 写入边界。

### 7. Auto-Research 研究对象先于轨迹窗口

研究议程应维护问题对象、候选解释/方法、评价标准、现有证据、未决实验与下一里程碑。轨迹窗口是样本批次，不是自动定义研究问题的边界。

例：研究“在动作、HUD 和动画共同变化时如何可靠识别受控实体”，比较多个识别方法；当前帧用于构造或检验方法。研究也可针对状态表示、探索/规划策略、工具算法、上下文配方与组件组合。游戏机制假说仍是合法研究对象，不能为追求高层抽象而禁止必要的机制调查。

有边界的局部实验用于检验更持续的问题，而不是把所有研究都缩成下一步行动建议。结果允许是反例、无效方法、未决问题或更好的表示，不要求每轮产生 harness 组件。

建议将触发与调度策略写成 research-orchestration skill，但会话、broker、长度续跑、预算、结果入箱等仍由 runtime 承载。定时窗口可提醒检查，不能强制重复研究。策略评估信息/能力收益与研究成本，选择新建/继续/暂缓研究，以及 blocking/non-blocking；检查已有议程，避免重复。

实验请求始终回到 main，由 main 决定并逐步执行。报告返回后须检查其引用状态与当前适用性；迟到报告可能仍有方法价值，但不能直接作为当前行动指令。反馈应记录真实使用输入/输出、反例与成本，而不是仅记录已读/已装配。

## 实施与验收顺序（待实现）

1. 先统一 authoring contract、预置 creator 发现/加载路径、所有创建入口及序列化保真；旧组件不因迁移自动升级证据状态。
2. 加入 memory 有效期及 level/reset/state 边界失效，覆盖依赖传递与迟到研究结果。
3. 完善 subagent 上下文配方与纯推理角色；在现有工具基元范围内接入 tool-creator。
4. 调整研究议程与触发策略，记录持续问题、候选比较、使用反馈和停止原因。
5. 分层验收：结构/生命周期诊断 → real-runner wiring → 真实 provider 语义与收益评估。

语义检查至少覆盖：相同任务的新场景能否正确使用 skill；HUD 比对象更大等反例下是否避免错误规则；旧地图退出而仍有效控制映射保留；tool 输出真实可用；subagent 得到指定材料且排除未授权/被遮蔽内容；研究确实修订方法或问题，而非只增加报告数量。

全链路声明须运行 `arc-harness-smoke`，覆盖真实 ARC bridge、Pi parent loop、child broker/process、结构化返回、router、native mutation、ARC action boundary 和后续真实父轮；覆盖 system_prompt、skills、memory、tools、subagents 及 Auto-Research/普通 delegate 的 provider length continuation。pytest、离线脚本父模型和手写 JSONL 只能作诊断。确定性 real-runner smoke 不证明真实 provider 行为或游戏收益；后两者须真实 provider ARC 对照评估。

## 权衡、失败模式与替代方案

- creator 按需加载和语义检验增加 token/延迟；用渐进披露、复用已加载指导和按风险验证控制成本，不设组件数量指标。
- 结构化字段过多会诱发填表式伪方法；保持最小契约，按真实新输入上的行为检验，不按字段数量评分。
- 只改 router 或追加“方法不是轨迹”提示不足：已有该提示而产物仍偏离。优先修正创作职责与反馈闭环。
- 给每项 creator 强制配一个常驻 agent 增加编排成本，暂不采用；creator 本质是方法，可由 main 执行。
- 全局自动过期 TTL 简单但不匹配游戏状态；优先事件/版本有效期，时间 TTL 仅用于适用情形。
- 权限由 runtime 执行，不因 creator、research 或新角色的自然语言指令而扩大。缺少执行基元的 tool 保留为 pending implementation，不假装已具备能力。
- baseline creator 引入会改变实验条件；记录配置及版本，不能与旧运行直接归因比较。

## 关联

- `docs/deferred-research-todos.md`：B 研究目的与视图、C 父子证据反馈、D 认知连续性仍未完成；本提案不勾选完成。
- `docs/plans/2026-09-20-agent-native-single-life-harness.md`：沿用 main 独占不可回退环境历史、self-harness 非 LLM runtime 的边界。

本提案借鉴 skill-creator 的精确触发、按需加载、例子与规则分离、行为验证原则；不将 Codex 本机 skill 的安装目录或工具名称直接当作 Pi 项目运行时接口。
