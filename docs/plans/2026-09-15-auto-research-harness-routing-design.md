# Auto-Research → Task-local Self-Harness 路由协议

日期：2026-09-15  
状态：设计依据；可执行规则以版本化代码路由器为准。

## 1. 职责与设计依据

Auto-Research child 负责研究、验证以及 propose / inspect / approve / reject / defer。主 Agent 接收交付，按照本协议选择资源、创建或修改自己的 harness，并根据后续使用反馈继续演进。主 Agent 无需重复 child 的审批。

本文档记录设计依据，不充当可执行路由协议。运行时唯一的路由真值源是
`demo/pi_auto_research_harness_router.ts`：child 明确提交枚举属性和规范正文，
代码按版本化规则编译 native call；主 Agent 解析并执行，不能用自由文本改写目标。

方案选择：只提供自由文本建议的集成成本低，但无法明确交付是否已被处理；固定代码分类器容易一致执行，却难以处理同一内容的不同用途。本设计采用类型化交付 + 主 Agent 路由协议 + runtime 回执，把语义判断与可核实的应用状态连接起来。

历史依据：

- 任务“验证ARC自发生成与优化”，会话 `01a0993f-f66f-7ad0-9d2f-9477c2c4f356`，response ordinal 1228、1235：用户确认任务派生资源从零开始、低阶优先、组合独立验证、Auto-Research 贯穿组件验证与复杂路径探索。
- 同一会话 ordinal 19391、19398：用户确认资源索引和按需读取、tool 直接调用、subagent 通过 delegation；不增加统一 use 仪式。
- 任务“优化 auto-research 输出机制”，会话 `01a0a2ae-4c79-7ff1-ac20-5dbcaf83c778`，ordinal 2950：恢复 proposal、验证、应用和效果链路，以及 task-local prompt 区域的讨论。
- 本任务用户修正：child approve 属于 Auto-Research 验证；主 Agent 按路由协议修改 harness。此修正取代此前让主 Agent 再审批的建议。

适用原则：所有派生资源仅属于当前 task；同任务会话恢复可以继续使用，独立任务从零开始。研究产出不必立即改变下一动作。直接创建试用组件仍然允许，本协议约束的是研究交付的吸收路径，不为所有 self-harness 创建增加审批前置条件。

## 2. 路由的单位与四种独立状态

路由单位是一个 delivery item，不是整份研究报告。一个 item 表达一个可独立判断的事实、方法、计算、角色、计划或验证结果。包含多种内容的报告由 child 拆成多个 item，避免把一大段混合文本直接塞入 prompt。

| 状态轴 | 含义 | 拥有者 |
|---|---|---|
| review：pending / approved / rejected / deferred | child 对交付的审核结论 | Auto-Research |
| validation：supported_within_scope / inconclusive / contradicted | 哪个具体命题或组件在什么范围内得到何种证据 | Auto-Research；后续评估追加新记录 |
| routing：received / planned / applying / fulfilled / waiting / superseded / closed | 交付如何被处理 | 主 Agent 决定；runtime 记录实际写入 |
| effect：unobserved / supported / mixed / negative | 应用之后的任务证据是否支持预期效果 | 主 Agent 或受委派的 Auto-Research |

approved 表示该项交付可按声明的用途使用，不代表任意泛化、生成的新实现已通过测试，或后续任务收益已经得到证明。例如“某假设被反证”本身可以是 approved 的负面结论，同时其被检验假设的 validation 是 contradicted。

approved 的适用范围和用途必须包含其认识状态。child 可以认可“一项测试尚不能区分两个解释”这个研究结果；其中未决假设继续保持 inconclusive，不能被路由升级为已确认的操作事实。runtime 校验交付契约和来源，验证结论由 child 根据证据作出。

验证必须说明对象：claim / procedure / implementation / composition，以及对象的精确版本或内容哈希。验证过方向映射，不等于验证过主 Agent 随后编写的位移识别程序。

## 3. Child 交付契约

每个 delivery item 必须提供以下最小信息；完整内容与验证材料存于当前任务的外部存储，capsule 只携带索引。

| 字段 | 必须表达什么 |
|---|---|
| item_id、version、task_id | 稳定身份及任务边界 |
| approval_ref、source_report_ref | 精确审批版本和来源报告 |
| content_ref、content_hash | 可完整读取的规范内容；摘要不代替正文 |
| semantic_kind | fact / procedure / computation / role / plan / assessment / evidence |
| subject_ref 或 subject_key | 讨论或修改的是哪个知识主题、方法或已有组件 |
| validation | 对象、对象版本/哈希、结论、依据、适用范围、限制与反例 |
| applicability | 何时可用、何时不可用，以及依赖的环境/资源条件 |
| intended_use | 希望后续哪个推理、操作或研究使用它；允许是未来组合 |
| reconsider_when | 什么变化需要重新检查 |

按类型补充：procedure 提供触发条件、步骤、输入输出和失败分支；computation 提供输入输出契约、计算规则、执行能力需求和已做过的测试；role 提供子问题边界、上下文需求、允许工具和返回契约；plan 提供子目标、依赖、分支及终止条件。

用于路由的属性由 child 填写有依据的描述或枚举：

- relevance：current_step / recurring_condition / task_wide。
- stability：transient / conditional / stable_in_scope。
- reasoning：none / bounded_judgment / open_ended。
- execution：text / pure_computation / adapter_operation / model_delegation。
- reuse：one_off / expected_reuse，附原因；不要求固定重复次数。
- context_need：on_demand / always_needed，附原因。
- dependencies：精确版本引用；可为空。

route_hint 可以建议目标，但主 Agent 根据交付属性、当前 portfolio 和实际能力确定路由。不用单一 confidence 分数替代证据，也不采用“出现 N 次就晋升”的阈值。

审批绑定 item 的 content_hash、validation 和 applicability。正文或语义范围改变须产生新交付版本及相应审批；不得以同一个 approval 批准后来被改写的内容。

## 4. 路由顺序

主 Agent 对每个新交付依次执行以下判断。顺序保证先确定内容是什么，再决定如何执行与放入上下文。

### R0：接收与状态分流

- approved：进入 R1。
- deferred / pending：保留研究待办及恢复条件；需要新环境观察时，由主 Agent在任务内安排实验，再 resume 同一研究 session。不能把未验证的命题当作已验证规则注入。
- rejected：保留理由和证据索引；若拒绝依据形成有价值的负面知识，由 child 单独交付一项 approved assessment。
- 中断、报告失败、引用不全：记录 waiting 和缺少的信息。若运行中已经有独立完整、已审核的 item，只接收该 item；不得把不完整报告整体视为 approved。

### R1：检查交付是否仍可用

runtime 检查 task、精确引用、哈希、当前授权能力及版本一致性；主 Agent 判断适用范围是否仍覆盖当前用途。这是应用条件检查。

若已出现新的直接反证或条件变化，记录 waiting(reason=needs_revalidation)，将新证据交回 Auto-Research。旧 approval 保留为历史判断，不由主 Agent改写为 rejected。

### R2：选择基础载体

| 判定条件 | 基础路由 | 载体最少内容 |
|---|---|---|
| fact：陈述已知事实、映射、状态或结论，主要用于查阅 | memory | 内容、范围、依据、重新检查条件 |
| plan：决定当前子目标、顺序、分支或策略 | memory（默认，按需或动态 task/user projection）；显式 system prompt 仅用于基础稳定协议 | 条件计划、依赖、成功/停止条件；短期计划不物化为常驻 host prompt |
| procedure：可复用步骤，执行中仍需 Agent 判断 | skill | 触发条件、输入输出、步骤、异常分支 |
| computation：输入输出明确，步骤可在现有授权执行能力中表达 | tool | schema、实现、依赖、错误契约、测试状态 |
| role：开放式子问题可独立委派，并需要独立上下文或专门工具组合 | subagent 或一次性 delegation | 问题边界、角色指令、工具集合、输入/输出契约 |
| assessment：对已有组件或假设的验证、反证、局限 | research_resource / validation | 被评估的精确版本、结论、证据和后续处理建议 |
| evidence：原始材料、完整数据、大型报告 | external_resource | 内容引用、来源、版本、摘要与读取方式 |

有一个方法既包含计算又包含判断时，将计算部分路由为 tool，判断和调用顺序路由为 skill，skill 绑定 tool 精确版本。不要为一个混合 item 给出互相冲突的单标签。

role 的分流：可重复的稳定职责形成持久化 subagent；一次性问题记录 delegation 计划，由主 Agent在需要时发起。仅使用 Auto-Research 一次，不计作创建了持久化 subagent。

assessment 的分流：验证已有组件有效时，更新验证关联并复用该组件；发现明确修订方案时转 R4 更新组件；仅发现反证时关闭相关假设或标记受影响依赖待复核。不得为每份验证报告重复创建一个 skill。

### R3：选择上下文位置，判定是否进入 system prompt

system prompt 是高显著性的表达位置。事实的规范来源仍可保存为 memory，方法的规范来源仍可保存为 skill。

只有同时满足以下条件，才创建 task_system_prompt segment：

1. 内容是当前任务范围内有依据的基础操作规则或重要条件策略。
2. 在几乎所有相关后续决策前都需要知道，按需读取容易造成遗漏或反复推导。
3. 在声明范围内相对稳定；关键反例已经说明，没有未处理的直接冲突。
4. 能压缩为少量完整规则，同时保留前提和失效条件。不能依赖被截掉的正文才能正确理解。
5. 当前 prompt 没有等价条目；若存在，更新或复用原条目。

不满足常驻条件时，继续使用基础载体的摘要和按需读取。不能把“已 approve”“很重要”单独当作进入 system prompt 的充分条件。

task_system_prompt 内容带 source_resource_ref、scope 和 reconsider_when，表示 task 内可修订的学习结果。固定任务目标、runtime 契约和权限层保持原有优先级。实现应在模型请求构造时仅投影当前有效版本。

短暂坐标、长报告、未解决猜想、程序正文不适合常驻 prompt。带否定结论的规则可以进入，例如“当前状态下不再使用已被反证的位置推断”，但仍须满足上述全部条件。

### R4：确定 create / update / reuse / retire

先比较 subject、适用范围、功能和已有版本，再选择操作。名字相似只能用于检索。

- create：没有承担同一职责、同一范围的资源。
- update：已有对应资源，但内容被纠正、范围改变或方法改进；基于当前 target_version 写入新版本。
- reuse：已有版本已表达本次交付，或本次只是新增支持证据；记录交付与既有版本的关联，验证证据写入验证记录，不虚增组件版本。
- retire：child 的交付或新评估明确支持停止使用该版本；主 Agent执行停用并检查依赖。历史版本不删除。

低阶优先体现在选择最小、可独立检验的组件。组合可直接提出；其依赖精确绑定，端到端验证单独记录。低阶组件更新不会静默替换组合依赖。

### R5：物化、暴露、使用

主 Agent按计划调用具体 task_* 接口。每次调用带 routing_id、item_ref、source_approval_ref 和 basis_refs。写入成功返回 resource_ref、实际版本及生效方式，runtime 自动记录物化回执。

- memory：下一请求有索引，按需读取；需要 focus 时可投影正文。
- skill：索引与读取入口可见，Agent 读取后遵循；读取只证明内容进入上下文。
- tool：新版本注册为真实可调用工具，下一 provider request 的工具表记录实际暴露名；执行结果记录精确版本。
- subagent：定义可发现，delegate_task 才构成调用。
- system_prompt：下一 provider request 包含有效 segment 正文和版本标识；仅记录 hook 已运行不足以证明模型看到了内容。

approved 方法由主 Agent生成新程序时，程序可以作为 trial 创建，implementation_validation=untested。已有方法验证保留，新程序通过其输入输出测试后再声明实现已验证。若实现改变了已批准方法的含义或扩大适用范围，形成新的研究项。

## 5. 交付必须获得可见处置

“持续可见”由 inbox 提供，主 Agent按任务相关性选择处理时机。收到研究结果后或依赖该结果前，应记录一次路由处置。此义务写进主 Agent协议；runtime 不通过拒绝环境动作强迫它逐项处理。

| 处置 | 必须留下的证据 |
|---|---|
| materialize | 路由计划、目标操作；完成时有实际写入回执 |
| reuse | 既有精确版本及语义匹配理由 |
| research_only | 具体研究/验证引用和保留用途；适用于 assessment、负结果或未形成具体能力的交付 |
| waiting | 缺少的证据/能力/当前适用条件，以及明确恢复条件 |
| closed | duplicate / obsolete / task_ended 等具体理由和关联引用 |

research_only 不得用来静默跳过已具备条件的计算或方法交付；若不建设组件，必须说明为什么不存在有效复用需求，或使用 waiting 记录实际障碍。原始报告落盘不能计为 skill/tool 吸收。

inbox 只投影未处置、状态发生变化或恢复条件满足的条目，包含 item_ref、review、summary、路由状态、详情入口。正文按需读取；按版本去重并支持分页和显式省略计数。被摘要挤出不等于已处理。

等待不会占用主循环，也不新增研究次数、证据读取次数或任务动作次数限制。任务结束时把未完成路由封存并报告，不能标为 fulfilled。

路由状态转换规则：

```text
received → planned → applying → fulfilled
received → fulfilled                 # 已记录精确 reuse 或 research_only 关联
received/planned/applying → waiting  # 缺少输入、能力、适用条件或写入冲突
waiting → planned                   # 恢复条件满足，由主 Agent继续
received/planned/waiting → closed    # 有理由的无后续处理结果
任一旧路由 → superseded             # 后续交付替代，保留原资源与历史链接
```

materialize 路由只有全部必要 slot 成功后才 fulfilled。planned 仅表示计划，applying 表示尚有写入未完成。fulfilled 表示处置已落实，实际 exposure/use/effect 仍独立记录。waiting 的恢复条件可由 runtime 提示满足，但重新安排研究或写入由主 Agent执行。

## 6. 元数据与调用面

保留 child 的 research_approval。主 Agent 继续使用现有组件接口；新增的处置元数据能力可作为 task_harness 的 route 操作，读操作复用 inspect/task_resource。route 只记录 Agent 的路由计划或非写入处置，不生成正文、不执行多组件改写。

以下为拟议调用，尚非现有 API：

```text
task_harness(action="route", item_ref, disposition, reason,
             targets=[{slot, kind, operation, target_ref?, depends_on_slots?}])
  -> routing_id, route_version

task_memory(action="upsert", key, content, target_version?,
            routing_id, route_slot, item_ref, source_approval_ref, basis_refs)
  -> resource_ref, mutation_receipt

task_system_prompt(action="apply|update|retire|inspect", ...)
  -> segment_ref, effective_from="next_provider_request"
```

组件写入沿用具体接口；创建路由无需再调用 approve。非写入处置也用 route 记录。若不先调用 route，具体组件接口可从相同 routing 元数据建立单目标记录，减少额外调用；多目标依赖由主 Agent显式规划。

存储分工：

- task-harness-proposals.jsonl：child 审批事实及精确交付绑定。
- auto-research-deliveries.jsonl：版本化交付 manifest，正文通过 task-local 引用读取。
- task-harness-routing.jsonl：主 Agent计划、非写入处置、runtime 写入回执及后续暴露关联。
- 现有各组件 JSONL / SKILL.md：资源的规范版本。
- 现有 validation、harness observation/effect 记录：验证和后验评估。

主 Agent 的物化状态写入 routing ledger，不修改 child 的审批对象。所谓 inbox 是这些记录的投影，不再保存一份可独立变化的状态。

## 7. 完整示例：方向映射如何进入 harness

假设 child 已用不同真实观察确认方向映射，并明确“移动未受阻、对象识别成立、当前 level”的适用条件。示例中的引用仅用于说明结构，不能当作现有运行证据。

```json
{
  "item_id": "movement-map",
  "version": 1,
  "approval_ref": "proposal:research-4:movement-map@v2",
  "semantic_kind": "fact",
  "subject_key": "movement.direction_mapping",
  "content_ref": "delivery_content:movement-map@v1",
  "validation": {
    "subject_type": "claim",
    "verdict": "supported_within_scope",
    "basis_refs": ["observation:move-a@v1", "observation:move-b@v1"],
    "scope": "current level under verified object identification"
  },
  "traits": {
    "relevance": "task_wide",
    "stability": "stable_in_scope",
    "reasoning": "none",
    "execution": "text",
    "reuse": "expected_reuse",
    "context_need": "always_needed"
  },
  "reconsider_when": ["level changes", "new observation contradicts mapping"]
}
```

上例省略 task_id、content_hash、source_report_ref 和若干解释字段以便阅读；生产提交必须按第 3 节校验。

主 Agent先查 portfolio。如果当前 memory 只有方向猜想，更新为有范围的映射；若已有等价映射，复用并增加验证关联。随后判定映射对每次动作选择都必要，创建引用该 memory 版本的 prompt segment：

> 当前 level 中，在已确认对象身份且移动未受阻时，ACTION1/2/3/4 分别对应上/下/左/右。进入新 level 或出现冲突观察后重新检查。依据：memory:movement-map@v2。

新 level 到来后，segment 的显式 scope 不再匹配，应停止将其投影为当前有效规则；规范 memory 保留，并向主 Agent投影复核状态。主 Agent把新观察交给 Auto-Research；新交付支持扩展范围后再更新 memory/segment。

上述自动停止投影仅适用于 Agent 声明且 runtime 可确定检查的 scope 条件，如 adapter 提供的 level/version 标识。自然语言条件如“出现方向反证”由主 Agent或 Auto-Research解释并记录争议，runtime 不从变化像素自行推断矛盾。

这次路由无需创建 skill、tool 或 subagent。后续若交付“从两帧计算对象位移”的确定性方法，才产生 tool；若交付“识别对象→比较位移→区分阻挡和身份错误”的判断流程，才产生 skill。

## 8. 其他典型路由与边界案例

| 交付 | 路由结果 | 为什么 |
|---|---|---|
| 当前玩家坐标 | memory，按状态版本失效 | transient；不满足 prompt 常驻条件 |
| 已重复验证的方向映射 | memory；满足 R3 时加 prompt segment | 规范知识与高显著性投影分别承担职责 |
| 帧差分与位移计算算法 | tool；依实现验证状态 trial/validated | I/O 和计算明确，可真实执行 |
| 判断阻挡、遮挡、对象认错的检查流程 | skill，可依赖差分 tool | 需要条件判断和多个证据步骤 |
| 用独立上下文反复审查观测解释 | subagent | 重复角色、可界定输入与返回 |
| 只研究一次某条路线 | research_resource + 一次性 subagent definition，再按需 delegate_task 调用 | 无稳定重复角色需求 |
| 三条候选路径及依赖 | research_resource；稳定 task-wide 规则才进入 system prompt | 属于任务规划 |
| 验证 skill v2 有效 | reuse skill v2 + validation 关联 | 无新增能力正文，不重复创建 |
| 某路线假设被反证 | approved assessment → research_resource；修订受影响计划 | 负面知识可被吸收 |
| skill A + tool B 的组合方案 | 组合 skill，绑定 A/B 精确版本，独立验证 | 部件有效不代表组合有效 |
| 完整大轨迹 | external_resource + 索引 | 大数据按需读取 |
| 建议读取不可见底层图层 | waiting(capability_unavailable) | 现有权限/数据无法完成；不能假装已创建该能力 |

## 9. 失败、冲突与修订

幂等键为 task_id + item_ref + route_slot + operation_revision。同一调用重试只返回原回执；有意改版使用新的 operation_revision。runtime 需按现有资源中的 routing 元数据恢复回执，处理“资源写入成功，但回执未落盘”的中断窗口。

CAS 冲突不计作 fulfilled。主 Agent读取最新版本，重新判断 update 或 reuse；不能盲目覆盖。正文等价而仅格式变化可保留原知识验证，但新的可执行实现仍单独记录测试状态。

多目标路由先写基础资源，再写依赖该版本的 overlay/skill。第二步失败时记录部分成功和未完成 slot，只重试失败部分。外层不会通过回滚 harness 文件撤销已经发生的环境动作。

完整正文缺失、hash 不符或摘要截断了重要适用条件时，不能依靠摘要猜出“已批准的内容”。请求补充交付或记录 waiting。缺少执行能力时，若方法可忠实表达为 skill，可改路由为 skill 并说明执行差异；否则保留 capability gap，不能把描述文件计为可运行 tool。

组件依赖新版本只产生变化提示；原组合继续绑定原版本。旧版本被撤回或明确 scope 失效时，对相关激活/调用返回不可用状态，主 Agent决定迁移、重测或退役。

新证据引发的研究修订使用 supersedes/revises 链接。当前 approval 实现把 approved/rejected 视为终态且按 run_id 限制操作，后续实现需支持同 task 的后续研究对旧交付创建关联修订，不静默编辑历史审批。

## 10. 持续反馈与验收

必须分别统计：approved items、已路由项、实际创建/更新/复用的资源、模型可见版本、读取/调用、后续修订、效果证据。不能把 read/exposure 数量当作策略执行或任务收益。

后验验证使用应用之后的 observation；child 先前验证是建设依据。自然语言 skill 是否影响决策，需要 Agent 的 decision link 与行动证据；runtime 只见读取不能推断因果。Auto-Research 可以根据效果再次批准修订交付，主 Agent沿同一路由协议更新资源。

实现验收采用少量基础检查和真实任务观察：

1. child approve 后主 Agent没有第二次 approve，直接完成路由及具体资源写入。
2. approved 事实、计算、流程和角色分别路由到正确载体；一次性问题不增加持久化 subagent 计数。
3. deferred 等待新观察并续接；approved 负结果能够更新知识和计划。
4. 已有等价组件得到 reuse；同主题修正产生新版本，CAS 和重试不会重复创建。
5. prompt 的实际下一 provider request 有新 segment；范围失效后不再作为当前有效规则出现。
6. tool 真正出现在 provider 工具表并执行；批准方法与验证实现能够区分。
7. 多目标部分失败、会话恢复、审批版本修订后，inbox 和真实组件记录一致。
8. 真实 ARC 从空派生资源启动；分别报告自主路由、使用、修订以及原生得分。不得用人工强制创建的夹具证明自发 self-harness 或收益。

## 11. 当前代码与实施落点

当前实现：

- `pi_auto_research_harness_schema.ts` 定义 child/provider 边界的完整 delivery schema；approval 绑定规范 delivery SHA-256，报告缺失、pending 或 hash 不匹配时拒绝提交。
- `pi_auto_research_harness_router.ts` 是确定性的代码路由器。它输出带 `policy_version` 的 route plan，并将 fact/plan/procedure/computation/role 映射到五类原生 harness 部件 `task_memory`/`task_skill`/`task_tool`/`task_subagent`；`plan` 默认写入 memory 并可投影到动态 task/user context，只有 delivery 显式声明 `prompt_channel=system_prompt` 且满足稳定 task-wide always 条件时才附加 `task_system_prompt` overlay；一次性 role 仍以 `task_subagent` 作为部件载体，后续是否调用由 `delegate_task` 执行；assessment/evidence 明确为 `research_only`，不是第六类部件。
- `pi_task_local_subagents.ts` 在 parent 边界编译并持久化 `auto-research-harness-routes.jsonl`，capsule 返回精确 `native_call`。Auto-Research 本身不执行 route step。
- `pi_task_local_self_harness.ts` 通过 `task_system_prompt` 提供 task-local prompt overlay；后者通过 Pi `before_agent_start` 在后续 Agent turn 注入。固定 system instruction 和权限不在可变范围内。
- memory/skill/tool/subagent/system_prompt 写入均记录 `routing_id` 与 `source_approval_ref`；`auto-research-harness-route-receipts.jsonl` 捕获 native tool 的 applied/failed 回执及实际 `resource_ref`，形成 route → write → exposure/effect 的可审计关联。
- external_resource 仍表示 run 内可寻址的大内容，当前代码路由明确返回 `research_only`，不会把一个缺失的 writer 伪装成成功物化。
