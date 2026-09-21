# 证据驱动的 self-harness 与持续 Auto-Research

日期：2026-09-18。
状态：设计建议；第一波实现已落地，完整真实 ARC 闭环仍待专门验收。
范围：父 agent 独占环境动作；允许未验证的假设进入 harness；研究提供证据，self-harness 管理生效、修订与退出。

## 1. 核心决策

采用“多入口提出和试用，共享生命周期控制，研究持续补充证据”。

- 固定步长/关键节点回顾可以提出局部假设、直接调整 harness，也可以发起或续接研究；不要求每个窗口生成通用能力。
- Auto-Research 的单位是可检验的问题，child 进程只是一次有界计算。研究可跨阶段持续，但 child 不执行环境动作。
- blocking/non_blocking 只决定父调用是否等待当前计算轮次，不决定研究是否允许等待未来证据。
- 创建不需要先获支持性证据。运行状态与证据状态独立；得到支持的内容保留，反例导致收窄、修改、暂停或退役。
- 父 agent 协调实验成本与任务目标；无需逐条重复审批研究交付。runtime 做确定性控制，不充当自然语言真伪裁判。
- 不建立新的“研究 agent 管理 agent”；复用现有 session、finding、report、effect assessment 和五类 harness 资源。

备选方案：严格验证后安装会抑制在线试错；所有判断交给父模型会增加负担且削弱研究自治；自由写入但仅靠提示词维护则无法保证退出和恢复。选择共享控制接口，保留宽松语义决策。

## 2. 当前基础与缺口

依据当前工作树，而非把既有设计文档视为已验收事实：

| 已有基础 | 本次需要补齐 |
|---|---|
| 父直接写入与研究 route 共用 native executor；研究结果可自动应用 | 统一运行/证据状态、控制回执与调用时检查 |
| memory/skill/system_prompt 精确版本、显式替换、依赖抑制 | tools/subagents 覆盖；有效性与可用性分离 |
| non_blocking checkpoint/pending/自动恢复 | blocking 同样有界 yield；精准事件唤醒，防止自唤醒 |
| experiment_request 的预测、成本、停止条件 | 请求、父决定、真实动作与回执的持久关联 |
| 跨阶段研究指导、报告状态与 effect assessment | 逐项区分解释、方法正确性和收益 |

当前 blocking pause 被 child 明确拒绝，不是已经确认存在无防护死锁；父端已存在 paused → pending 返回分支。修改必须同时改变 child 限制、恢复模式和提示词，不能只解除 pause 限制。

主要源码：`demo/pi_task_local_subagents.ts`、`demo/pi_task_validation_child.ts`、`demo/pi_auto_research_evidence.ts`、`demo/pi_auto_research_output.ts`、`demo/pi_task_local_self_harness.ts`、`demo/pi_task_harness_route_runtime.ts`、`demo/pi_task_knowledge_lifecycle.ts`。

关联 deferred B/C/D：跨阶段假设检验、父子在线实验通信、压缩后的研究连续性。本设计不将这些待办标记为完成。

## 3. 研究闭环：计算结束，研究可以继续

### 3.1 状态与身份

复用 research_session 的 active/pending/completed/failed/cancelled：

```text
start / 合格的 resume → active
active → completed                    当前问题已有结论，允许 inconclusive
active → pending(wait_spec)            保存检查点并结束当前 child
pending + 匹配事件 → active            后台启动下一轮
pending + 拒绝/到期/任务结束 → 有限收尾或 completed(unresolved)
active/pending → cancelled
active → failed                       运行错误，不代表科学假设被否定
```

pending 无运行进程、不占执行并发槽、不阻挡父行动。允许同问题跨多个窗口保持 pending；completed session 仍不原地复活，后续问题引用前序报告启动有界 follow-up。

周期回顾显式关联已有 session，追加可访问的历史引用。语义上是否同问题由父或研究判断，runtime 不通过文本相似度自动合并。没有可研究问题时记录线索或 defer，不强制启动。

### 3.2 一次完整交互

1. 回顾发现异常或缺少方法，父 agent 给出问题、已有材料、可用预算；允许已有候选先在运行中试用。
2. child 先读取问题相关的跨阶段轨迹，做历史对照、反例搜索、本地计算。历史足够时直接给出结论。
3. 需要新环境证据时，提交 experiment_request、wait_spec、检查点；持久化后结束当前计算轮次。
4. blocking 调用返回 pending 与实验请求；non_blocking 在父边界投递一次。两者都不等待未来环境事件。
5. 父 agent 决定 execute/defer/decline。执行前重查前置状态，协调动作预算、不可逆影响和当前任务目标；请求不是动作授权。
6. 父通过普通环境动作接口执行。runtime 记录 request_id 对应的 before/action/after 精确引用、实际成本与执行状态。
7. 匹配回执触发一次后台恢复。child 对照预先提出的预测，修订解释、方法或资源，或请求下一次有界实验。
8. self-harness 执行明确的资源变更，后续真实使用反馈继续回到研究。

自然发生的状态转移也能提供证据，不要求每次等待都执行额外实验。父可以把匹配观测显式关联给请求。

### 3.3 简单 wait_spec

首版只支持三种，不引入任意代码条件或复杂规则语言：

| 等待类型 | 唤醒依据 |
|---|---|
| experiment_receipt(request_id) | 已执行、拒绝、过期、失败等终态回执 |
| environment_event(after_cursor, event_kind?, scope?, max_parent_actions) | 既有规范环境事件，或父显式关联的关键转移 |
| manual_resume | 明确提供新材料，或说明运行故障恢复原因 |

runtime 只匹配已有可识别字段，不推断“这个状态是否证明某假设”。复杂关键条件由父识别并关联；无法精确匹配时可使用下一真实动作回执，但受研究总预算限制。

实验请求复用已有 objective/prerequisites/parent_action/predicted_outcomes/falsifier/action_cost/stop_condition 字段，补充 request_id、请求版本和状态引用。成本与风险由研究说明，父作决策；runtime 只强制实际配置的数值预算。

defer 保持等待并记录再考虑条件；decline/expired 等不能伪造实验结果。若预算允许，研究可用一轮解释性收尾；否则保存已有检查点并标 unresolved。

### 3.4 防止死锁、忙循环与漏事件

- blocking 只等待当前有界计算；yield 即返回，不轮询未来事件。
- 自动恢复总是 non_blocking，不继承最初的 blocking。before_agent_start 只派发后台工作。
- 环境等待只由环境事件/显式实验回执唤醒；report、harness 修改、checkpoint、读取记录不得冒充环境进展。
- 每个 session 的 wait_revision 与事件组合只 claim 一次；active session 不重复启动。claim 后启动失败必须可恢复，避免永久吞掉事件。
- 使用 child 实际已消费的环境 cursor，不能用暂停时的最新全局 cursor 覆盖。这样运行期间新到的父证据不会丢失。
- 无新材料的 resume 返回 still_pending，不调用 provider；明确的运行故障重试另行记录。
- pending 不能触发“研究未完成所以父不能行动”的 gate；周期 handoff 已处理即可继续。
- 计算次数、token/时间与等待动作数采用 session 累计预算，恢复不重置。到期、任务终止或无预算都有限收尾。
- provider length continuation 是同轮计算续写，不是等待实验，不消耗/推进环境事件游标。
- 崩溃发生在真实动作与回执关联之间时，先按 action ID 恢复；无法判明则记 unknown_execution，不能自动重放可能已执行的动作。

允许本轮有候选交付同时保持 pending：完整结构化交付照常校验、路由，检查点只负责续研。不得从 draft_findings 静默安装。报告“本轮交付”与 session“问题完成”分开，避免提交候选就强制 completed。

## 4. 多入口统一生效控制

保留现有 task_memory/task_system_prompt/task_skill/task_tool/task_subagent 和研究 route，内部共享控制契约：

```text
change(operation_id, source, target_ref?, expected_control_revision?,
       operation, reason, evidence_refs?) → receipt
```

operation 覆盖 write、load、unload、suspend、retire、assess。创建时无 target_ref；修改绑定当前精确版本。运行中源码 API 命名可沿用现有工具，以上为内部契约而非要求新增万能 LLM 工具。

控制器负责幂等、版本竞争、合法状态、权限、依赖与生效边界；不判断语义真假。父或 child 提交有出处的判断及明确变更，研究 route 可以自动执行，无新增父审批。

创建默认允许“可用 + 未检验”。approval 表示交付可处理，不表示内容已获验证。缺少实验记录不是创建失败理由；不要求为五类组件逐一产出。

保留原内容版本语义，新增控制修订序号：纯 load/unload/证据记录不改内容 v，避免改变证据就级联作废依赖。已有 metadata 更新仍按旧 API 版本规则处理，首版不全面重定义历史版本。

后台结果针对 v3 而当前已是 v4：证据仍可保存为针对 v3 的历史评估，变更返回 conflict；不能自动卸载或覆盖 v4。同名并发修改检查版本，不同名的语义冲突由父/研究指出，runtime 不猜测。

多步骤 route 保留逐步回执与 partial 结果，不宣称全事务。重复投递按 operation_id 幂等，恢复仅处理未完成步骤。

## 5. 留存、停止加载、暂停和退役

### 5.1 两个维度

运行状态：

| 状态 | 含义与恢复 |
|---|---|
| loaded | 允许按适用条件投影/发现/调用，不代表每个上下文都全文注入 |
| unloaded | 暂不需要，保留内容和证据；可显式重新加载 |
| suspended | 可靠性或依赖需复核；显式解决原因后恢复，普通 load 不绕过 |
| retired | 当前版本退出；通过明确的新版本替代，不自动复活旧版本 |

证据状态按具体断言/方法维度记录：untested、supported、contested、refuted，均包含范围。没有结论时记录 inconclusive 研究结果，不自动认定反驳，也不强制卸载。

争议候选可以继续试用；“没有证据”不触发自动过期删除。明确被反驳的当前断言应修订或退出；若暂时没有替代，暂停该版本。判定来自父/研究，runtime 执行对应状态规则；双方冲突保留为 contested，避免最后一份报告无条件覆盖所有证据。

“得到支持”不保证永远加载：正确但昂贵或当前无用的方法可以 unloaded，知识仍保留。默认留存在本任务持久资源中，跨任务全局提升不在本次范围。

### 5.2 依赖与真实卸载

有效性与可用性分离：A 停止加载，不表示依赖其认识的 B 被证伪；A 被反驳/替换时，声明有效性依赖的 B 需复核。若工具 B 执行时必须调用 A，A 不可用会阻止执行，但不是对 B 科学正确性的反驳。

延伸现有精确依赖到 tools/subagents，不新增复杂依赖语言。已有 basis_refs 继续只是历史出处，不自动成为硬依赖。

- prompt/memory/skill：按各自支持的 provider 边界重新组装；receipt 明确 applied 与 effective_at。system overlay 当前外层 before_agent_start 边界必须如实保留，不能承诺同一模型请求内撤回。
- tool/subagent：新调用接纳时验证版本和运行状态。仅从列表移除不够，旧名称/已注册闭包也必须检查。
- 已开始的调用绑定旧版本完成，默认不强杀；回执标记当前资源状态，其结果不自动重新激活资源或给新版本记功。
- 动态工具执行策略、父直接调用与组合调用都遵守相同可用性检查。

修订/反驳生成短纠正记录：旧 ref、替代 ref、理由与影响；进入后续上下文及压缩检查点。保留原始历史，不承诺消除模型已见文本或撤销已发生环境动作。未声明的隐含依赖由研究审计发现，不宣称自动全面清除。

## 6. 同时检验解释与方法

沿用 findings/report/effect assessment，在 findings 增加可选逐项 assessment，不设创建门槛：

```text
target_ref: 精确资源版本或已有研究候选引用
dimension: explanation | method_correctness | method_utility
verdict: supported | contradicted | inconclusive
scope: 结论覆盖的条件
evidence_kind: historical_observation | local_execution | new_environment_transition
```

证据引用与不确定性复用 finding 已有字段；预测/实际差异放既有内容或实验回执；method_utility 引用既有 effect assessment，不建立第二份收益真值源。

| 维度 | 检验内容 | 不能推出 |
|---|---|---|
| 解释 | 竞争解释对状态转移的不同预测 | 工具实现正确、任务收益必然增加 |
| 方法正确性 | 计算/判断符合声明的输入输出语义 | 环境因果解释已证明 |
| 方法收益 | 使用后决策质量、进展与成本 | 单条轨迹足以证明普遍因果收益 |

历史轨迹重算只能检验已经发生的数据，不能替代未执行动作的真实实验。构造用案例与保留案例尽量区分；无保留案例时明确局限。本地执行可支持方法正确性，不需伪装为新环境证据。研究级 confidence 只是摘要，不能把三个维度一起提高。

贯穿案例：父暂写入“条件 C 下避免 A”；研究发现多个阶段中 A 的效果不同，比较位置与阶段两种解释；先构造阶段识别方法 M 并在历史数据上测试，再请求父在满足条件时执行一次有区分力的动作。新证据反驳位置解释，修订旧规则为按阶段判断。若 M 输出正确但成本过高，可卸载 M 的当前实现，同时保留阶段解释和验证记录。

研究检查点保留问题、竞争解释、已排除项、候选方法、已消费证据游标、待实验请求和累计预算。原文可读不等于恢复后模型仍知道这些要点，必须验证实际恢复材料。

### 6.1 成功条件对照：成功也提供研究入口

通关、首次解锁、同类操作从失败变成功等关键节点，应提供一次有界的成功条件对照机会。研究问题是“哪些状态差异解释了结果变化”，而不只是“成功时依次做了什么”。成功序列可以保留为可试用方法，但不能自动提升为必要条件或通用机制。

对照材料优先包括：最近一次成功前后的规范观测、相关失败案例、关键操作前后的状态以及跨阶段反例。研究区分直接观察、对象命名和机制解释，提出能产生不同预测的竞争解释；历史不能区分时保持未知，按第 3 节请求父实验并返回 pending。

该机会复用关键节点回顾与已有研究 session，不强制每次成功新建 child，也不阻塞下一父动作。周期回顾与关键节点若指向同一问题，应追加证据并合并处理；预算不足可以延后。runtime 可以识别已存在的通关/阶段变化事件，但不负责推断因果条件。

### 6.2 反例触发问题重定义

当已有解释出现预测失败、无法解释的跨阶段差异或反复追加补丁时，研究应检查问题本身，而不只优化当前假设下的执行策略。无需固定失败次数，也不由 runtime 根据失败次数宣布假设错误。

研究应追问：哪些描述是真实观测，哪些只是父 agent 的解释？例如“踩过某格后面板改变”是可核对事件，“拿到钥匙”可能只是命名与假设。允许研究改写竞争解释、收窄适用范围，或提出不同的可检验问题；保留改写理由与旧问题引用，不能通过事后改写预测把失败包装成成功。

同一目标下的解释修订继续使用当前 session。目标发生实质变化时，以引用旧报告的有界 follow-up 承接，不能借重新命名重置预算并无限探索。

### 6.3 原始观测与表征可达性

child 必须能按引用读取研究所需的原始图像或保留相关空间/图案信息的规范观测，而不仅是父 agent 已解释过的摘要。环境交互权限保持只读；材料可由既有轨迹读取接口提供，不增加 child 动作权限。

原始证据与父解释分开传递。观测引用必须具有实际可读权限；仅在提示词列出路径不算提供材料。若裁剪、压缩或派生表征丢失了关键面板，研究应报告访问/表征缺口并请求补充，不能把未见到的变化当作不存在。检查点保留关键对照引用，恢复后验证其仍可读取。

### 6.4 DeepSeek v4 历史轨迹案例

案例来源：用户对 `runs/arc-live-20260917-224141-deepseek` 的历史分析，指出首次通关后的记忆偏向“先拿钥匙再进出口”，后续从两个单独尝试失败推向“必须拿齐两把钥匙”，未提炼两幅面板图案匹配的条件。用户提供的定位为 `task-memory.jsonl` 第 20、215 行；本次纳入设计未重新核验原始轨迹，构建实验前需核实对应动作、帧与状态。

期望研究过程：

1. 首次通关后对照此前出口失败与此次成功的完整可见状态；把成功路径与成功条件分开。
2. 检查特殊格前后两幅面板的变化，提出有证据依据的竞争解释，而非直接把特殊格命名为钥匙并固化。
3. “只踩 KEY1 失败、只踩 KEY2 失败”只能限制解释，不能单独证明“必须同时拿齐”。该假设仍可试用，但保留未决问题与反证条件。
4. 历史足够则先做对照检验；不足则请求父 agent 执行能区分解释的实验，按 pending/回执协议继续。
5. 新证据支持图案匹配等替代解释时，修订旧规则及声明依赖它的方法；在后续阶段检验预测，避免只在构造案例上自证。

“图案匹配”是本案例待独立核验的目标机制，不写入通用研究提示词或调度规则。机制能提供发现与纠错通道，不保证真实模型必然提出正确解释。

## 7. 任务分工与实施顺序

本轮已分发并完成的设计任务：

| 设计任务 | 负责人 | 结果 |
|---|---|---|
| D1 持续研究与防循环，对应用户第 1 项 | research_loop_design | 核查两种启动模式、pending、证据恢复，提出统一 yield 协议 |
| D2 统一控制与卸载，对应第 2、3 项 | lifecycle_design | 核查原生 route、依赖和调用边界，提出双维生命周期 |
| D3 解释与方法检验，对应第 4 项 | hypothesis_method_design | 核查报告与 prompts，提出可选逐项评估与语义案例 |
| D4 集成协议与实施拆分 | 主 agent | 本设计与验收矩阵 |

后续实施工作包（本轮仅拆分，没有声称已实施）：

| 工作包 | 范围/主要模块 | 依赖 | 完成标准 |
|---|---|---|---|
| T1 持续研究调度 | validation_child、local_subagents、evidence | 先定 wait/receipt 契约 | blocking yield、后台恢复、单次 claim、无漏事件/自唤醒 |
| T2 实验回执与回顾衔接 | output、handoff、harness_review、关键节点回顾、父提示词 | T1 契约 | 同问题跨窗口；成功条件对照入口；回顾去重；请求到真实回执可追踪；父能拒绝/延后 |
| T3 统一生命周期控制 | native route runtime、knowledge lifecycle、五类 native handlers | 控制事件契约 | 多入口同规则；load/unload/suspend/retire；冲突和幂等 |
| T4 解释/方法评估 | output/schema、child/main/delivery prompts、effect assessment | 与 T3 对齐 target_ref | 允许 provisional；三个维度独立；成功序列不等于机制；反例可触发问题重定义；本地证据不冒充环境证据 |
| T5 真实卸载与恢复 | tools/subagents guards、prompt assembly、context lifecycle、轨迹读取接口 | T3/T4 | 旧工具不可调用；依赖区分；原始图案证据可读；压缩/恢复保留纠正与关键对照引用 |
| T6 集成与真实链路验收 | arc_harness_smoke、确定性 provider 场景、DeepSeek 历史案例与真实模型对照 | T1–T5 | 完整闭环与五组件矩阵；成功条件研究与规则修订；不以单元测试代替 |

实现时 T1 与 T3 可并行；T4 先定契约与提示词；T2/T5 接入后再进行 T6。local_subagents、self_harness 等共享文件指定单一集成人，避免并行改同一区域。先完成最小闭环，再扩展自然事件筛选，不先开发通用调度系统。

## 8. 验收与收益评估

### 8.0 第一波实现记录

已实现并通过诊断回归：

- blocking child 可 yield 为 pending，父继续行动；自动恢复强制 non-blocking，并按 parent evidence cursor 唤醒。
- findings 支持 explanation/method_correctness/method_utility 的独立 assessment；utility 复用既有 effect assessment。
- provisional 候选、成功条件对照、反例触发问题重定义和原始观测可达性已写入研究协议。
- knowledge control 提供 availability/evidence 的独立纯状态转换；task tool 与 saved subagent 在真实调用时检查当前版本和可用性。

这波诊断包括评估、知识生命周期、研究上下文、harness smoke/native 回归。它没有完成 AGENTS.md 要求的 `arc-harness-smoke` 全链路重新验收，也没有证明真实 provider 的跨阶段研究质量或 DeepSeek 独立发现面板匹配机制。C 的父子在线实验通信和 D 的跨压缩语义连续性仍是 deferred research todos。

必须覆盖：

1. blocking yield → 父返回 → 真环境动作 → 后台研究恢复 → 结构化结论 → 原生变更 → 后续父轮实际使用。
2. non_blocking 同链路；pending 不占槽，父无需等研究结束。
3. report/资源/读取不唤醒环境等待；同事件只恢复一次；运行期间到达的观测不丢失。
4. 拒绝、延期到期、任务终止、重复投递、重启与启动失败都有限收尾；不自动重复环境动作。
5. 历史足够则不消耗额外环境动作；跨窗口恢复保留竞争解释和下一检验。
6. 无支持证据的候选可用；contested 可继续试用；反驳导致修订/暂停/退役；有用知识不会因当前卸载丢失。
7. 旧研究不能覆盖新版本；unload 不传播科学反驳；旧注册工具入口不能绕过状态；运行中回执不复活资源。
8. 解释受支持但方法失败；方法正确但无收益；反例收窄适用条件；证据不足不冒充通过。
9. memory、skills、system_prompt、tools、subagents 全覆盖，断言语义输出，不只 completed。
10. Auto-Research 与普通 delegate_task 的 provider length continuation 均保持可用。
11. 成功节点产生对照研究机会，与周期回顾去重；允许追加已有 session 或延后，不要求每次成功新建 child。
12. child 能实际读取失败/成功与关键操作前后的原始面板信息；仅有“拿到钥匙”摘要或不可读引用不能通过材料可达性检查。
13. DeepSeek 案例中检查成功序列与机制是否分开、竞争解释是否有区分性预测、反例是否能触发问题重定义，以及资源修订是否进入后续父轮。
14. 真实模型实验将后续阶段作为检验材料，记录是否独立发现图案匹配及其证据；不得将目标规则预先放入研究提示词后声称模型自行发现。离线历史案例仅用于研究质量诊断，不能代替真实在线闭环验收。

单元测试与离线 fixtures 用于诊断。闭环验收必须通过 arc-harness-smoke 的真实 bridge、Pi 父循环、broker/child、结构化返回、router、原生 mutation、ARC action 和后续父轮。

确定性 provider 的真实 runner 只能证明布线与生命周期可达。真实模型的跨阶段研究质量与收益另做预算匹配对照，观察任务进展/完成率、真实动作与 token 成本、无效唤醒次数、候选使用后的修订情况；不能把资源数量或研究完成率当收益。
