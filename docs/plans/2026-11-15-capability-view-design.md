# 能力层运行视图设计稿：让"无摩擦的能力缺口"成为可见事实

日期：2026-11-15（Asia/Shanghai）。状态：**已定稿（用户，2026-11-15）**；实现与发射按 §5 的预算声明执行。阅读版：`docs/plans/2026-11-15-capability-view-design.html`。定稿后修订（2026-11-15，用户指示补进）：§4.6 问题式评审第二因子（EVO_ASK）、§7 内容层缺口候选；§4.2/§5 相应更新。同日第二次修订（用户指示补进）：§4.7 自进化机制骨架——闭合协议并入 EVO_ASK、活性监督器（完整性件）；节奏转正与闭合回流分期 B3 后。
分支：`evo-loop-implementation`（worktree `D:\agent\.codex\worktrees\evo-loop-impl\autoresearch_pi_project`），基线 f1efed79（v1.5 M-A/M-B/M-C + 义务收口）。
失败材料：B2 运行（`runs/evo-daemon-b2-glm53f-v15-mabc-20261115`，分析见 `docs/plans/2026-11-15-evo-mechanisms-implementation.md` "B2 运行结果"）。

## 0. 用户重定义（2026-11-15，逐字要点）

8192→32768 只是参数调整，不是进化。要求的自进化范式：agent 在执行任务过程中，根据自身**运行视图**（agent 自身 harness 视图=已加载 components 与 orchestration、运行状态、任务轨迹、harness 产物/中间交付件——用户给的参考轴），审视自身 harness 短板（orchestration 与五类组件：prompt、skill、tools、memory、subagent），经反射接口做 Erlang 式热修改自我进化，方向有二：**产生新的组件/orchestration** 与 **优化已有的组件/orchestration**。本稿任务：分析当前视图设计，给出能表达 harness 能力的视图设计。

## 1. 失败材料：B2 为何只产出参数级变更

- B2 全程唯一自改 = policy.request.maxOutputTokens（参数）。组件清单从头到尾只有 1 个 prompt（`ppt_baseline_guidance@v1`，host 播种），`harness/live_agent_self.jsonl` 13 条事件的 components 字段恒为该一项；skill/tool/memory/subagent 创建数 = 0，orchestration steps/decisions 结构变更 = 0。
- 10 个同构 unit（同一财报、同一产出形态）全部由裸 write/edit/office 徒手完成，每 unit ≈4–6 请求重复相似的 HTML 生产动作；没有任何一次把重复动作沉淀为可复用组件。
- 13 次 no-change 闭合的理由是**对的推理**：如 `.harness/live-self.json:41446`——"Remaining candidates are unexposed/untried with no recorded friction, so no evidence-backed change is warranted."（其余候选未曝光/未尝试且无记录摩擦，没有证据支持变更。）agent 看到了候选占位（见 §2.2），用"曝光/使用/摩擦"词汇审它们，结论必然是"无证据"。
- 结论：这不是判断失败，是**输入失败**——视图没有任何一条事实把"10 个跨度的徒手重复劳动"与"组件库为空"连起来。

## 2. 当前视图盘点（代码核实，f1efed79）

### 2.1 agent 每请求实际看到什么

| 面 | 何时 | 内容 | 代码 |
| --- | --- | --- | --- |
| 非评审 self 视图（volatile 尾） | 每个非评审请求 | `{root_id, revision, mode, step, in_review, pending, resources, observation 摘要一行, read_self 指针}`——**无任何组件清单** | ppt_demo_extension.ts:695-698；observationHeads（self_observation.ts:249-256）只有请求数/重复/拒绝/最近结果 |
| 任务状态尾 | 每请求 | statusFacts：源文件事实、预算、谱系 | ppt_demo_extension.ts:574 |
| 评审 self 视图 | 评审期每请求 | reviewSelfView + projection（JSON 全量） | ppt_demo_extension.ts:693-694；self_root.ts:1162-1199 |
| review_frame 事实 | 评审入口一次 | in_review、due_windows、object_state、observation（≤2400 字符） | self_root.ts:1156-1160 |
| observation 渲染 | 评审帧/评审视图/read_self | `[requests]/[repeat]/[reject]/[loss]/[idle]/[trace]/[outcome]` 事实行 | self_observation.ts:217-246 |

### 2.2 能力信息现状：有什么、缺什么

- **词汇表全部是摩擦/资源/轨迹**：A1 重复·成本·拒绝·损失·停止，A2 模式连程·调用·工件写入，A3 结果谱系（in_path / available_not_in_path）。能力缺口若不产生摩擦（任务靠徒手照样成功），在这套词汇里**结构性不可见**。
- **候选占位存在但词汇错位**：reviewSelfView 对空类补 `${kind}_candidate` 条目（self_root.ts:1181-1185），带 define 示例——创建的**操作入口**一直在。但条目事实是回溯式使用谱系（exposure/use/effect/untried，self_root.ts:1173-1179）；对不存在的组件，这些事实恒为 false/空，于是"无证据"永远成立。缺的是**工作侧**事实（重复劳动量、零组件在径的跨度数），不是候选侧入口。
- **计数造假（padding）**：selfCategories 的 `.size || 1`（self_root.ts:1467）与 reviewSelfView categories 把候选占位计入（self_root.ts:1190），**空类永远显示 1，从不显示 0**。而系统提示承诺的是 "including zero-count categories"（self_root_system.md:13）——代码没有兑现承诺。
- **空节从 head 消失**：context 组装 `.filter(Boolean)`（ppt_demo_extension.ts:705）使空的 memory/skills 节整段消失；B2 的 agent 从未见过一行 "memory: (无)"。`[idle]` 行只列已存在 tool 组件的零调用（self_observation.ts:227）——零个 tool 组件时整行不出现。缺席不是可见事实。
- **orchestration 无执行谱系**：当前步定义与 bindings 进 head（ppt_demo_extension.ts:703-704），reviewSelfView 有完整定义与改写示例，但**没有每步执行计数**——"某步从未走过/一切都挤在一个步里"不可见，"优化已有 orchestration"缺证据基础。
- **非评审期能力信息为零**：组件清单只在评审 JSON 深处；任务进行中（恰是重复劳动发生时）agent 看不到自己库存。

### 2.3 五类组件 + orchestration 的运行时消费路径（核实过，不是悬空物）

| 类 | 写入口 | 消费路径（已核实） |
| --- | --- | --- |
| prompt | reflect_component | 所有 active prompt 全文进每个 head（ppt_demo_extension.ts:681） |
| memory | reflect_component（append/patch 可用） | policy 过滤后全文进每个 head（:682；self_root.ts:1455-1462） |
| skill | reflect_component | 索引行进 head + read_self_component 拉取正文（:683） |
| tool | reflect_component（`# program: on`） | 反射即注册为 Pi 工具 + schema 进请求（:253-268, :662-676）——可直接调用 |
| subagent | schema 接受，但 **experimentLimits 下拒绝**："experiment authorizes one agent; no task subagents"（:326；self_root.ts:676；mirror.unsupported） |（无执行路径；见 §6 开放决定） |
| orchestration | reflect_orchestration（M-B 编译） | 当前步定义+bindings 进 head；surface() 按步控制工具面（:662-665, :703-704） |

即：**前四类组件一旦创建就有完整闭环消费路径**（创建≠悬空物）；问题只在"创建的理由"从未成为可见事实。

## 3. 断裂过渡诊断（一个主因）

断裂过渡：**评审入口的事实词汇 → agent 判断**。词汇只有摩擦/资源/轨迹，能力缺口无摩擦 ⇒ 永不可见 ⇒ "no evidence-backed change" 的闭合既诚实又必然 ⇒ 进化停在参数层（唯一产生过摩擦事实的对象恰是 policy.request）。

只改这一个主因：**给观测服务加一个能力高度（A4），并让库存计数真实**。不动触发器、不动判断归属、不加义务/配额/推荐——B2 已证明判断链路本身工作正常（引用事实→定向修改→声明效果→效果回流）。

## 4. 设计：能力事实（A4）与真实库存

原则不变：服务只供事实（发生了什么、花了什么、路径里有什么/缺什么），不供原因、结论、建议；"你应该创建一个 skill"是禁句。判断与创建都归 agent。

### 4.1 新增事实行（self_observation.ts，A4；与 A1-A3 同渲染管道）

**`[inventory]`——harness 库存与消费绑定（用户轴 1：自身 harness 视图）**

```
[inventory] prompt 1 (head 每请求; in_path 0/10 跨度) | skill 0 | tool 0 | memory 0 |
  subagent 0 (写入口拒绝: experiment authorizes one agent) |
  orchestration 3 步: build 执行 52, review_gate 9, deliver 1
```

- 每类**真实计数**（0 就是 0）+ 该类消费绑定的事实短语（进 head / 可调用 / 索引+拉取 / 拒绝——运行时属性，非建议）+ 跨结果跨度的 in_path 使用计数与最近使用请求号。
- orchestration：步数 + **每步执行计数**（从 ledger 请求 pin 的 step 聚合）——"优化已有"方向的证据基础。

**`[recurrence]`——跨结果跨度的重复劳动（用户轴 3：任务轨迹）**

```
[recurrence] 10 个结果跨度; 共同调用: write 10/10 跨度 (计 86), edit 9/10 (41), office.render 10/10 (12);
  agent 组件在径: 0/10 跨度
```

- 机械聚合 A3 既有的 per-span 序列与 in_path：各 span 共同出现的调用名及总量、含任一 agent 创建组件的 span 数。无相似度判断、无任务词汇——纯计数。
- 这是把 B2 不可见的核心事实（"十次同样的手工，零次复用"）变成一行可引用的 ref。

### 4.2 真实计数与缺席可见

- 删除 selfCategories 的 `|| 1`（self_root.ts:1467）；reviewSelfView categories 只计 active 组件，候选占位条目保留但标 `candidate: true` 且不计入 categories（self_root.ts:1190）。系统提示 "zero-count categories" 的承诺由代码兑现；提示把 observation 节的枚举词补上 inventory/recurrence，并按 §4.6 加入目的句与入口三问（仍不加义务句）。
- 非评审摘要行（observationHeads）追加库存段：`components prompt 1/skill 0/tool 0/memory 0/subagent 0`（≈45 字符/请求）——任务进行中即可见，不等评审。head 的空节 `.filter(Boolean)` 保持（不往任务 head 塞空段；缺席事实住在 self 视图行里，一处即可）。

### 4.3 与既有机制的衔接（零新机制）

- 能力级变更声明效果时，M-C 的 agent 谓词可直接绑 A4 可比指标（如"后续跨度 write 调用数下降"、"组件在径跨度数上升"）——效果回流复用现有窗口/回执，无新通道。
- A4 的 ref 可进 evidence_refs；"修改是否引用观测"沿用 M-A 的既有记录。

### 4.4 每条新事实的闭环契约（no dangling artifacts）

| 产物 | 入环点（未经请求） | 替代的工作 | 下一步如何回馈 | 退役 |
| --- | --- | --- | --- | --- |
| [inventory] 行 | review_frame.observation、reviewSelfView.observation、非评审摘要行 | agent 自翻 ledger/mirror 数库存与步执行 | 引用进 evidence_refs 被记录；创建后计数即变 | EVO_A4=0 |
| [recurrence] 行 | 同上（评审两处；摘要行在跨度≥3 时带一段） | agent 回看全部 span 序列对比 | 组件入径后 "0/10" 即变；可作 M-C 谓词指标 | EVO_A4=0 |
| 真实零计数 | categories/摘要行 | 无（纠正既有事实的失真） | 创建即 0→1 | 随 A4 |

新常驻负担：摘要行 +≈45–90 字符/请求；评审 observation 预算内 inventory+recurrence 约 200–400 字符（2400 预算不变，挤占折叠规则沿用）。移除负担：无（本轮不移除；B2 已把常驻义务清干净）。

### 4.5 不做什么（负例设计）

- 不加评审触发器、创建配额、组件数奖励、"考虑创建 X"类文本；候选 define 示例维持现状。
- 不把组件计数当任务回报：诚实的 no-change 闭合（引用了 recurrence/inventory 后判定不值得）仍是合法闭合。
- 不做 [deposit]（工作区沉积未读事实）：ledger 今天不留读回执，机械推导不成立；列入开放项，避免本轮多因素。
- 不动 subagent 授权（§6）。

### 4.6 第二因子：问题式评审立场（EVO_ASK；定稿后修订，2026-11-15）

用户修正："我被问了问题，agent 只被给了事实"不是结构差异，是评审 md/系统提示的**设计内容**。原则真正禁止的只有三样：结论/建议（"你应该创建一个 skill"仍是禁句）、产出义务/门槛（B1 配额填充教训）、判断归属移位。**问题不在禁区**：问题引导注意力、不代替判断，"没有"仍是合法答案。开发循环的分析之所以准，一半在材料（§7），一半在分析者被问了问题、且被告知"进化"的定义——agent 两者皆无（现行提示从未说评审为了回答什么，也未载 §0 的进化定义）。

- **目的句**（self_root_system.md，常驻 ~2 行）：你的 harness——五类组件与 orchestration——是你自己的，可扩展可改写；进化指创造新组件/orchestration 或优化既有的，不只是调参数。（任务定义，非对某次运行的结论。）
- **入口三问**（FIXED_REVIEW_STRATEGY，每评审入口随事实出现 ~4 行）：① 哪些摩擦/损失的根因在能力层而非参数层？② 重复事实与库存事实合起来，你的能力覆盖是什么状况？③ 哪些能力存在却从未在径，为什么？同段写死："判定'无短板'与'不改'都是合法闭合。"
- **边界**（与 §4.5 一致）：不点名任何待创建组件（非"考虑创建 X"类文本）、不含对本次运行的因果断言、不挂退出门槛；全部开放式措辞（"是否存在"而非"找出"）。
- **顺从风险与缓冲**：问题可能诱导"为答题而造缺口"（B1 配额填充的镜像）。缓冲：开放式措辞；"无"合法性与三问同段；§5 证伪本来就抓悬空创建——被制造的创建若从未被行使，按失败计。
- **开关与归因**：`EVO_ASK`（=0 回 B2 评审文本），与 EVO_A4 独立。对"一个主因"纪律的偏离记录在案：B3 为 A4+ASK 双因子集成运行（v1.5 集成先例）；evidence_refs 可见引用了哪些 A4 事实，"因被问而动"只能靠 arm 分离。EVO_ASK 的投递自 §4.7 起为“入口提问 + 闭合作答”一体（闭合协议字段随开关一并回退）。

### 4.7 自进化的机制骨架（定稿后修订，2026-11-15）

用户决定：基于运行视图的自进化需要稳固的进化机制与策略引导；只靠 agent.md/系统提示的 agent-native 引导，很可能导致自进化的崩溃或遗漏。两个方向的失败都有档案实证：修复 B1 六项缺陷的全部是机制（编译、触发解耦、交付期抑制、范围回滚、义务收口），零项靠提示词；B2 的 15 个评审入口 10 个来自机械节奏（冻结 contract:unit_completed），agent 自请评审全程 1 次——没有机械节奏，审视可能根本不发生；guidance-only 的 PPT 运行与 E1 的 hook 调用点（8 轮 0 用）是提示词/纯 pull 引导的既往失败记录。反向同样在案：B1 的退出义务是 host 代码做判断层的事，制造配额填充——机制越界同样崩溃。

分界线（Erlang 监督树/behaviour 的分工）：**机制保证“审视发生、被记录、可恢复”；agent 决定“审视出什么”**。引导的合法形态是结构化注意力与节奏，不是内容建议；三禁区（§4.6）不动。机制永不做：缺口结论、点名创建、变更配额、退出/交付质量门（用户已否决）、自动创建组件、host 代写语义摘要。

骨架四件（感知、执行、行使跟踪、效果归账已是机制，见 §2.3 与 §4.1-4.3；此处补齐裸奔环节）：

1. **闭合协议（并入 EVO_ASK，本轮实现）**：入口三问从提示文本升为 close 调用的结构字段——每次评审闭合对三问各携带一条回应，**“无”是合法值，无任何门槛挂在字段上**。是“必须回答”，不是“必须改”（与 B1 义务教训的区别：义务挡退出，协议只结构化既有的闭合理由）。复用既有 close 调用，成本约几十字符/次闭合、零常驻；§5 对三问回应的读取由定性变为结构化。EVO_ASK 因子自此定义为“入口提问 + 闭合作答”一体，仍非第三因子；EVO_ASK=0 时字段随问题一并回退。顺从风险（例行填“无”）本身是可读信号。
2. **活性监督器（watchdog；完整性件，本轮实现）**：只看活性信号——连续 schema 拒绝、解析失败、零进展请求（网关对逐字重复调用的拒绝打转为已见实例）——**永不看内容**。触发时恢复至最近已知良好的 self revision，记 supervision 事实（agent 下一请求可见），任务产物不回滚。边界对照：B2 的 decide_validation 九连重复由观测事实 + agent 自停解决——判断层的循环归 agent；监督器只管判断链路本身失效、事实已到不了 agent 的情形。归类与 FLOOR/validator 同列（保留的完整性检查），不入因子归因、无独立开关；不触发时对运行无行为影响，触发即记录。阈值参数在 host 侧，以边界事实短语进 mirror（如“监督: host 固定, 阈值 N 次”；先例：mirror.unsupported 的 subagent 拒绝事实）——边界可见而非可改。
3. **节奏转正（B3 之后）**：评审入口节奏目前是继承的 v1.4 冻结契约（B2 残余摩擦 2），不是设计决定。B3 保持冻结以保比较器一致；其后按本节分界线转正为设计件，候选方向：节奏参数入 policy，使评审节奏本身成为可进化对象。
4. **闭合回流（B3 之后）**：跨评审连续性目前靠模型上下文记忆（B2 的 13 次闭合互不可见）；机械补法为入口携带近几次闭合 ref（§7-4），按 §7 判据排期。

基石升格：§3-§4 的论证核心是回执四边形（对象→视图→判断→对象'→行为，每边机械有据）；本节将其延长为**回执生命周期**——感知→审视（入口+协议）→决定→执行→行使→归账→保留/回滚（监督）/退役，每条边机械有据。agent 的判断是链上唯一不被机制填充、也唯一必须由 agent 填的格子。对 B3：监督器为安全件不参与归因（supervision 事件数入 §5 测量，预期 0）；闭合协议并入 EVO_ASK；节奏与回流本轮不动；常驻成本新增为零。

## 5. 可证伪命题与有界评估（B3，定稿并授权预算后执行）

- **窄命题**：同任务同模型同 caps、A4 开启的运行中，agent 至少 1 次**能力级自改**——kind∈{prompt,skill,tool,memory} 的 define/redefine，或 orchestration steps/decisions/transitions 的结构变更（纯 policy 参数不计）——满足：自主发起、运行内被行使（新组件此后 in_path/被调用/入 head；orchestration 变更后该步实际执行）、evidence_refs 引用 A4 事实。
- **负例（不判机制失败）**：agent 引用 A4 后诚实判定 no-change（记录"视图可达、判断不同"，读闭合文本定性）；任务本身若无重复结构则 recurrence 自然空。
- **证伪条件**：全程 0 次引用 A4 事实（事实未进判断 ⇒ 视图设计失败）；或能力级变更出现但从未被行使（悬空创建 ⇒ 消费路径或事实设计失败）；或成本相对 B2 显著恶化而任务结果不升。
- **比较器**：B2（68+1 请求 / 1.75M tokens / 10/10 units）。开关 `EVO_A4` 与 `EVO_ASK`（各=0 回 B2 行为）预留逐因子 arm；B3 为双因子集成运行，偏离记录与归因安排见 §4.6。
- **预算**：发射前按惯例向用户声明（预计 B2 同量级：caps 镜像 600 请求 / 14400 s / 2 GiB；组件创建请求计入任务成本，不另设奖励）。
- **测量**（全部来自既有工件）：能力级变更数与种类、A4 引用数、新组件后续 in_path 跨度数/调用数、recurrence 行前后值、请求与 tokens、units/deliver、闭合协议字段对入口三问的回应（结构化，“无”合法；§4.7）、supervision 事件数（完整性件触发，预期 0）。

## 6. 开放决定（请用户定夺）

1. **subagent**：视图将如实显示 "0（写入口拒绝）"。是否解除 `experimentLimits` 的 subagent 拒绝并给它执行路径（run_agent 式，`自然语言执行器`提案待决）是**独立授权**，本稿不包含；不解除则五类中四类可进化，subagent 保持可见的拒绝事实。
2. **[deposit]（写后未读的工作区沉积）**：需要新增读回执才能机械成立；是否列入下一轮。
3. **摘要行常驻成本**：+≈45–90 字符/请求是否接受（或仅评审期显示库存，非评审只在计数变化时显示）。

## 7. 内容层缺口（下一因子候选，B3 结果后挑选；定稿后修订，2026-11-15）

对照开发循环分析与运行内视图的材料差：事后分析的决定性证据约一半是事件计数（已入视图/A4 后更全），另一半是**读内容**——视图今天是纯事件计数器，从不看任何东西的内容。四条候选，均有纯机械、无语义判断的事实化路径，本轮不实现（守因子纪律）：

1. **产物/载荷内容形状**：跨跨度产物字节相似度（如 "unit-03 与 unit-02 字节 78% 相同"）、同地址修订 diff 占比（B1 的 74 次全文重写会显示为 diff≈100% ×74）。B1/B2 的决定性发现均来自此类证据；§4.1 为守一因子明确排除过相似度——下一因子第一候选。
2. **每跨度成本与趋势**：A3 跨度补请求/token 总量 + 跨度成本序列（"6,5,5,5,5,…"——学习曲线没弯，即"无沉淀"的无评论表达）。
3. **自身历史比较器**：首跨度 vs 最新跨度自比——运行内唯一诚实的比较器；条 2 的趋势行是其最小形式。
4. **agent 语言回流**：评审入口带近几次闭合的 ref（账本已有，仅不呈现——最小机械形式）；thinking 记录为可审对象需新回执，与 §6.2 [deposit] 同族（新机制，另议）。

挑选判据：若 B3 证伪形态为"引用了 A4 仍零能力级变更"，优先 1/2；若为"创建了但未被行使"，优先 3；若闭合显示"看见了但材料不足"，读闭合文本定哪条。
