# 能力层运行视图设计稿：让"无摩擦的能力缺口"成为可见事实

日期：2026-11-15（Asia/Shanghai）。状态：**已定稿（用户，2026-11-15）**；实现与发射按 §5 的预算声明执行。阅读版：`docs/plans/2026-11-15-capability-view-design.html`。定稿后修订（2026-11-15，用户指示补进）：§4.6 问题式评审第二因子（EVO_ASK）、§7 内容层缺口候选；§4.2/§5 相应更新。同日第二次修订（用户指示补进）：§4.7 自进化机制骨架——闭合协议并入 EVO_ASK、活性监督器（完整性件）；节奏转正与闭合回流分期 B3 后。第三次修订（用户指示补进）：§4.8 对象建模债项与摘要分层（债1–债5）；§6 增两项悬决（digest 字段、rent 事实）。第四次修订（用户最小化指示，同意后收束）：监督器挂首实例移出本轮、EVO_ASK 单一落点、闭合协议取一个数组字段、A4 仅评审入口；§6.3 零常驻与 §6.5 rent 随 A4 落定。第五次修订（2026-11-16，用户指示：收纳 ChatGPT 四层方案，保持热修改范式、最小化实现）：§8 四层演化坐标系与 meta loop；§4.9 四层视图最小实现（EVO_L4）；§5 B3 升三因子集成并授权迭代实验循环；§6 增 6.6 用户决定。
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
- rent 后缀（§6.5 已定，用户同意 2026-11-15）：每类追加驻留租金"字符/请求"与总驻留一行——债4 价格事实的第一件，head 组装时数字现成，随 [inventory] 仅评审入口出现。

**`[recurrence]`——跨结果跨度的重复劳动（用户轴 3：任务轨迹）**

```
[recurrence] 10 个结果跨度; 共同调用: write 10/10 跨度 (计 86), edit 9/10 (41), office.render 10/10 (12);
  agent 组件在径: 0/10 跨度
```

- 机械聚合 A3 既有的 per-span 序列与 in_path：各 span 共同出现的调用名及总量、含任一 agent 创建组件的 span 数。无相似度判断、无任务词汇——纯计数。
- 这是把 B2 不可见的核心事实（"十次同样的手工，零次复用"）变成一行可引用的 ref。

### 4.2 真实计数与缺席可见

- 删除 selfCategories 的 `|| 1`（self_root.ts:1467）；reviewSelfView categories 只计 active 组件，候选占位条目保留但标 `candidate: true` 且不计入 categories（self_root.ts:1190）。系统提示 "zero-count categories" 的承诺由代码兑现。最小化修订：不加常驻枚举行——inventory/recurrence 的说明随评审入口走（§4.6 三问本身点名"库存事实/重复事实"，事实短语自描述）；目的句与三问的落点见 §4.6（仍不加义务句）。
- A4 不进非评审摘要行（observationHeads）——最小化修订，§6.3 据此落定为零常驻：评审入口已由机械节奏保证（每单元一次），创建时刻另有 reflect 回执与 mirror 即时反馈；常驻库存段是第二投递面，付每请求成本而无已证需求。head 的空节 `.filter(Boolean)` 保持（不往任务 head 塞空段；缺席事实住在 self 视图行里，一处即可）。

### 4.3 与既有机制的衔接（零新机制）

- 能力级变更声明效果时，M-C 的 agent 谓词可直接绑 A4 可比指标（如"后续跨度 write 调用数下降"、"组件在径跨度数上升"）——效果回流复用现有窗口/回执，无新通道。
- A4 的 ref 可进 evidence_refs；"修改是否引用观测"沿用 M-A 的既有记录。

### 4.4 每条新事实的闭环契约（no dangling artifacts）

| 产物 | 入环点（未经请求） | 替代的工作 | 下一步如何回馈 | 退役 |
| --- | --- | --- | --- | --- |
| [inventory] 行 | review_frame.observation、reviewSelfView.observation（仅评审入口） | agent 自翻 ledger/mirror 数库存与步执行 | 引用进 evidence_refs 被记录；创建后计数即变 | EVO_A4=0 |
| [recurrence] 行 | 同上（评审两处） | agent 回看全部 span 序列对比 | 组件入径后 "0/10" 即变；可作 M-C 谓词指标 | EVO_A4=0 |
| 真实零计数 | categories | 无（纠正既有事实的失真） | 创建即 0→1 | 随 A4 |

新常驻负担：**零**（A4 仅评审入口投递；§6.3 已定）。评审 observation 预算内 inventory+recurrence+rent 约 200–400 字符（2400 预算不变，挤占折叠规则沿用）。移除负担：无（本轮不移除；B2 已把常驻义务清干净）。

### 4.5 不做什么（负例设计）

- 不加评审触发器、创建配额、组件数奖励、"考虑创建 X"类文本；候选 define 示例维持现状。
- 不把组件计数当任务回报：诚实的 no-change 闭合（引用了 recurrence/inventory 后判定不值得）仍是合法闭合。
- 不做 [deposit]（工作区沉积未读事实）：ledger 今天不留读回执，机械推导不成立；列入开放项，避免本轮多因素。
- 不动 subagent 授权（§6）。

### 4.6 第二因子：问题式评审立场（EVO_ASK；定稿后修订，2026-11-15）

用户修正："我被问了问题，agent 只被给了事实"不是结构差异，是评审 md/系统提示的**设计内容**。原则真正禁止的只有三样：结论/建议（"你应该创建一个 skill"仍是禁句）、产出义务/门槛（B1 配额填充教训）、判断归属移位。**问题不在禁区**：问题引导注意力、不代替判断，"没有"仍是合法答案。开发循环的分析之所以准，一半在材料（§7），一半在分析者被问了问题、且被告知"进化"的定义——agent 两者皆无（现行提示从未说评审为了回答什么，也未载 §0 的进化定义）。

- **目的句与入口三问（单一落点；最小化修订 2026-11-15）**：目的句——你的 harness（五类组件与 orchestration）是你自己的，可扩展可改写；进化指创造新组件/orchestration 或优化既有的，不只是调参数（任务定义，非对某次运行的结论）——与三问合为**一个文本块**，随 FIXED_REVIEW_STRATEGY 的既有投递面走，不再单独常驻 self_root_system.md：一个因子一个落点，EVO_ASK=0 整块回退，少动一个文件。三问（~4 行）：① 哪些摩擦/损失的根因在能力层而非参数层？② 重复事实与库存事实合起来，你的能力覆盖是什么状况？③ 哪些能力存在却从未在径，为什么？同段写死："判定'无短板'与'不改'都是合法闭合。"
- **边界**（与 §4.5 一致）：不点名任何待创建组件（非"考虑创建 X"类文本）、不含对本次运行的因果断言、不挂退出门槛；全部开放式措辞（"是否存在"而非"找出"）。
- **顺从风险与缓冲**：问题可能诱导"为答题而造缺口"（B1 配额填充的镜像）。缓冲：开放式措辞；"无"合法性与三问同段；§5 证伪本来就抓悬空创建——被制造的创建若从未被行使，按失败计。
- **开关与归因**：`EVO_ASK`（=0 回 B2 评审文本），与 EVO_A4 独立。对"一个主因"纪律的偏离记录在案：B3 为 A4+ASK 双因子集成运行（v1.5 集成先例）；evidence_refs 可见引用了哪些 A4 事实，"因被问而动"只能靠 arm 分离。EVO_ASK 的投递自 §4.7 起为“入口提问 + 闭合作答”一体（闭合协议字段随开关一并回退）。

### 4.7 自进化的机制骨架（定稿后修订，2026-11-15）

用户决定：基于运行视图的自进化需要稳固的进化机制与策略引导；只靠 agent.md/系统提示的 agent-native 引导，很可能导致自进化的崩溃或遗漏。两个方向的失败都有档案实证：修复 B1 六项缺陷的全部是机制（编译、触发解耦、交付期抑制、范围回滚、义务收口），零项靠提示词；B2 的 15 个评审入口 10 个来自机械节奏（冻结 contract:unit_completed），agent 自请评审全程 1 次——没有机械节奏，审视可能根本不发生；guidance-only 的 PPT 运行与 E1 的 hook 调用点（8 轮 0 用）是提示词/纯 pull 引导的既往失败记录。反向同样在案：B1 的退出义务是 host 代码做判断层的事，制造配额填充——机制越界同样崩溃。

分界线（Erlang 监督树/behaviour 的分工）：**机制保证“审视发生、被记录、可恢复”；agent 决定“审视出什么”**。引导的合法形态是结构化注意力与节奏，不是内容建议；三禁区（§4.6）不动。机制永不做：缺口结论、点名创建、变更配额、退出/交付质量门（用户已否决）、自动创建组件、host 代写语义摘要。

骨架四件（感知、执行、行使跟踪、效果归账已是机制，见 §2.3 与 §4.1-4.3；此处补齐裸奔环节）：

1. **闭合协议（并入 EVO_ASK，本轮实现；最小形）**：入口三问从提示文本升为 close 调用的**一个数组字段**（三元，每问一条回应）——**“无”是合法值，无任何门槛挂在内容上**；EVO_ASK=1 时由既有 validator 要求字段在场，“必须回答”由既有校验兑现，无新代码路径。是“必须回答”，不是“必须改”（与 B1 义务教训的区别：义务挡退出，协议只结构化既有的闭合理由）。复用既有 close 调用，成本约几十字符/次闭合、零常驻；§5 对三问回应的读取由定性变为结构化。EVO_ASK 因子自此定义为“入口提问 + 闭合作答”一体，仍非第三因子；EVO_ASK=0 时字段随问题一并回退。顺从风险（例行填“无”）本身是可读信号。
2. **活性监督器（watchdog；挂首个观测实例，本轮不实现）**：设计保留——只看活性信号（连续 schema 拒绝、解析失败、零进展请求），**永不看内容**，触发时恢复至最近已知良好的 self revision、记 supervision 事实、任务产物不回滚；阈值在 host 侧、以边界事实短语进 mirror。但按最小化审查（用户指示 2026-11-15）移出本轮，挂首个观测实例再实现：① 动作与唯一已见实例失配——网关对逐字重复调用的拒绝打转发生时 self 并未变化，"恢复良好版本"是空操作；对打转有效的是尾部新事实（copy-attractor 证据：只有尾部变化能破循环），即监督该给**事实**而非回滚。需要版本恢复的自毒型（改坏自身 prompt/orchestration 致判断链失效）在 evo 运行中 0 例：B1 的 7 次 schema 拒绝分散且自愈，B2 全程 0 拒绝。② 阈值无数据可定，猜的阈值在 B3 内是归因隐患——误触发回滚的恰是 B3 要测的变量（agent 的合法自改）。③ 可恢复性已有三层在位：validator 逐调用拒绝、reflect 失败即 abortTransaction（范围回滚，v1.5）、FLOOR caps 兜底整场；live-self.json 每事务落盘，事后可恢复任意 revision。B3 改从账本导出**活性串峰值**（§5），首个 >0 实例即监督器的授权证据与阈值数据，届时按实例形态配动作（打转→尾部事实；自毒→版本恢复）。边界对照不变：decide_validation 九连重复那类判断层循环归 agent。
3. **节奏转正（B3 之后）**：评审入口节奏目前是继承的 v1.4 冻结契约（B2 残余摩擦 2），不是设计决定。B3 保持冻结以保比较器一致；其后按本节分界线转正为设计件，候选方向：节奏参数入 policy，使评审节奏本身成为可进化对象。
4. **闭合回流（B3 之后）**：跨评审连续性目前靠模型上下文记忆（B2 的 13 次闭合互不可见）；机械补法为入口携带近几次闭合 ref（§7-4），按 §7 判据排期。

基石升格：§3-§4 的论证核心是回执四边形（对象→视图→判断→对象'→行为，每边机械有据）；本节将其延长为**回执生命周期**——感知→审视（入口+协议）→决定→执行→行使→归账→保留/回滚（监督）/退役，每条边机械有据。agent 的判断是链上唯一不被机制填充、也唯一必须由 agent 填的格子。对 B3：骨架本轮实现仅闭合协议一件（并入 EVO_ASK 的一个字段）；监督器挂首个观测实例（§5 改记账本导出的活性串峰值，预期 0）；节奏与回流不动；骨架常驻成本新增为零。

### 4.8 对象建模的债项与摘要分层（定稿后修订，2026-11-15）

用户指示（同日）：把对象建模讨论的结论记录在案。背景原则：对象建模是热修改自进化的基石（§3-§4 的回执链），known-incomplete 之处必须有账。债 1–4 来自四线讨论（分型、边界、使用、经济学），债5 来自用户同日指示——对象建模沿用 agent 自身的上下文管理设计做摘要式渐进压缩，不得靠全文列举。各债记内容、本轮立场、勾连；本轮实现范围不因此扩大，唯二新悬决入 §6。

1. **债1 能力态/工作态分型**：视图对 5 类组件同构计数，不分跨单元复用的能力组件与单元内一次性工作态。候选落点：事件级标签（判据即 §5 已写的 kind+结构规则，纯记录零行为影响，最便宜）；组件级按 kind（memory=状态、其余=能力）近似但会漏——memory 里的 lessons 是能力性知识；agent 自声明域（this-run/task-family/general，判断归 agent，但主观且只在跨运行语境有意义）。立场：取事件级，评估侧按 §5 判据判读即可、本轮零新字段；agent 声明域随债4 一并处理。
2. **债2 可改边界可见化**：哪些对象 agent 可改、哪些 host 固定，目前靠拒绝才暴露（B1 的 12 地址恢复被拒）。取法：边界事实只随 mirror 标注视图已点名的对象，不另造边界清单（先例 mirror.unsupported；§4.7 监督器实现时其阈值短语“监督: host 固定, 阈值 N 次”为下一落点）。边界迁移不加申请机制：引用边界事实的闭合本就进账本，开发环读账本——隐式迁移通道已存在，是否移界是用户在开发环的决定。
3. **债3 曝光≠使用**：视图保证可见，不保证采纳；诚实不采纳是 §5 合法负例，不设采纳率指标（优化调用频次是被禁的任务奖励）。文本类组件使用归因的唯一诚实来源是 agent 自做实验：现有 deactivate/restore 关若干跨度 + M-C 窗口对比，今天即可走、零新机制；mirror 列“存在 deactivate 操作”是能力事实，不是建议。push/pull 分工：host 只推最小触发事实（A4），更深的自我分析（成本趋势、相似度等）归 agent 用 read_self 自建；components-push-not-pull 的证据定界——触发必须靠推，深挖才归自建，§7 候选照此挑选。
4. **债4 创建的经济学与跨运行迁移**：视图显示缺口但不标价。B2 粗算：32 个 execute 请求做 10 个同构 unit；一个模板化组件造价约 2–5 请求、每 unit 省 1–2 个，量级上运行内就可能回本——而 agent 没有任何数字能做这笔算术。缺的价格事实三件：每跨度成本（§7-2）、每组件驻留租金（债5 的 rent）、摊销年限（运行边界是最短年限；跨运行迁移本身未设计）。预登记 B3 解读分支：“引用了 A4、诚实判定不值得”不等于视图失败，而指向价格事实缺位——那时该上 §7-2 与 rent，不是推翻 A4（§7 挑选判据相应补记）。
5. **债5 规模债：摘要式渐进压缩（用户指示）**：现状盘点（ppt_demo_extension.ts）：压缩阶梯就是 kind 阶梯——skill 已是索引+拉取（`name@version: description; read_self_component`，:683，与 MEMORY.md 同构）、orchestration 只投当前步（:663-665、:704）、tool 按 surface() 逐步门控（:662）、历史经观测聚合+预算+折叠；裸露面是 prompt（active 全文每头注入 :681，无预算、无阶梯、无降档——10 个 1–2k 字符的 prompt 即每请求 10–20k 固定租金）、memory（policy 过滤决定哪些进，选进的仍是全文 :682；B1 长到 v75 的 memory 是活标本——v1.5 的 append/patch 解决了写成本，驻留成本原样）、reviewSelfView（线性枚举，:694 投递；n=30 时需定容：计数+top-k+read_self 指针）。补的件是 digest 层，分工定稿：**host 语义自动摘要是禁手**（判断移交服务、视图不再是纯函数→软性假收据）；digest 是组件自身的可选字段，agent 在 define/redefine 时自写、随对象版本化；host 兜底只给机械元数据（name/kind/size/version/last-used/首行）；digest_revision < body_revision 的陈旧性是机械事实。回执细化（用户此条要求唯一动到四边形处，机械可解）：component_addresses 记投递层级（full/digest），否则“X 在 head 里”变软回执、债3 的曝光≠使用再弱一级。降档归 agent：rent 事实进 [inventory]（每类后缀“字符/请求”，head 组装时现成）；**预算越界是事实，不是动作**——无自动压缩门；residency 规则入 policy（host 播种保守默认、agent 可改，与 memory_strategy 完全同构——既有“policy 参数化投递”的一个新维度，非新机制类）。缓存对齐：digest 只随事务边界变，不随请求变（逐请求重摘要会打碎前缀缓存）。规模判断：B2 全程组件数=1，n≤5 不承重；触发条件清晰——驻留事实越阈值，或首个大量写 memory 的运行形态。勾连：债1（长得快的是工作态，digest 层主要服务 memory 侧）；债4（运行边界把一整轮工作态压成携带摘要，即对话压缩在对象模型里的类比，属未来层）。

### 4.9 四层视图最小实现（EVO_L4；第五次修订，2026-11-16）

范式锚（用户逐字要点）：整体方案依然是 **agent 针对自身运行视图进行热修改**——L4 只改"视图怎么组织、修改怎么归账"，判断与修改仍全部经既有反射接口由 agent 执行；用最小化方式实现，避免在自进化范式未打通前增加复杂厚重的上层机制导致断层。四件，全部仅评审入口、零常驻，`EVO_L4=0` 整体回退（与 EVO_A4 / EVO_ASK 独立）：

1. **层声明（evolution_layer）**：reflect define/redefine 的可选字段，值域 `prompt|context|loop|harness`；服务只记录与回显（账本事件、mirror 回执、评审视图），**永不推断、缺省合法**（显示"未声明"）。声明与实测消费路径（§2.3）分列，错位是可见事实，不是错误。归层语义见 §8.1。
2. **[layers] 分组块**：评审 self 视图将既有事实按四层重组一块——prompt（active prompt 数+版本+投递与租金）、context（memory/知识组件与 head 各节驻留字符，材料=rent）、loop（orchestration 步+每步执行计数+评审节奏事实，材料=A4）、harness（tool/subagent 计数与拒绝事实+inventory/recurrence 指针，材料=A4）。**纯重组，无新计数器**；并入评审 observation 既有 2400 字符预算。
3. **闭合回流（§7-4 的最小机械形，提前）**：review_frame 携带近 3 次 close 的 ref 与三问回应首行（账本既有，仅呈现）——跨评审连续性让"任务理解可修正"有材料（GPT 方案 current_state 的最小对应物）。更重的假设存储不建：agent 的 memory 组件就是其认知态的家。
4. **目的句一句扩展（EVO_ASK 块内）**：既有目的句后加一句四层坐标与各层修改入口的存在性陈述（"存在什么"词汇，非建议；三问与"无"合法不动）。

闭环契约（§4.4 样式）：

| 产物 | 入环点（未经请求） | 替代的工作 | 下一步如何回馈 | 退役 |
| --- | --- | --- | --- | --- |
| evolution_layer 字段 | 账本/mirror/评审视图 | 开发环事后人工归层 | 声明 vs 实测错位可引用；四级链按层归账（§8.4） | EVO_L4=0 |
| [layers] 块 | 评审 observation | agent 自拼四层图景 | 引用进 evidence_refs；层内变更后块内即变 | EVO_L4=0 |
| 闭合回流 ref | review_frame | agent 翻账本找旧闭合 | 回应引用旧闭合可见；理解修正有迹可查 | EVO_L4=0 |
| 目的句四层句 | EVO_ASK 块 | 无（坐标词汇供给） | 三问回应是否用层词汇，闭合文本可读出 | 随 EVO_ASK |

不做（§4.5 延伸）：不按四层重排 A1-A4 事实行本身；不加每层配额、覆盖度义务或"层平衡"类指标；不建 hypotheses/Evolution State 新存储（task_state=statusFacts、candidates=§7、evidence_ledger=账本，已分布式在位）；challenge 的子代理形态仍挂 §6.1。

## 5. 可证伪命题与有界评估（B3，定稿并授权预算后执行）

- **窄命题**：同任务同模型同 caps、A4 开启的运行中，agent 至少 1 次**能力级自改**——kind∈{prompt,skill,tool,memory} 的 define/redefine，或 orchestration steps/decisions/transitions 的结构变更（纯 policy 参数不计）——满足：自主发起、运行内被行使（新组件此后 in_path/被调用/入 head；orchestration 变更后该步实际执行）、evidence_refs 引用 A4 事实。
- **负例（不判机制失败）**：agent 引用 A4 后诚实判定 no-change（记录"视图可达、判断不同"，读闭合文本定性）；任务本身若无重复结构则 recurrence 自然空。
- **证伪条件**：全程 0 次引用 A4 事实（事实未进判断 ⇒ 视图设计失败）；或能力级变更出现但从未被行使（悬空创建 ⇒ 消费路径或事实设计失败）；或成本相对 B2 显著恶化而任务结果不升。
- **比较器**：B2（68+1 请求 / 1.75M tokens / 10/10 units）。开关 `EVO_A4` 与 `EVO_ASK`（各=0 回 B2 行为）预留逐因子 arm；B3 为双因子集成运行，偏离记录与归因安排见 §4.6。
- **预算**：发射前按惯例向用户声明（预计 B2 同量级：caps 镜像 600 请求 / 14400 s / 2 GiB；组件创建请求计入任务成本，不另设奖励）。
- **测量**（全部来自既有工件）：能力级变更数与种类、A4 引用数、新组件后续 in_path 跨度数/调用数、recurrence 行前后值、请求与 tokens、units/deliver、闭合协议字段对入口三问的回应（结构化，“无”合法；§4.7）、活性串峰值（最大连续 tool_failed/逐字重复调用串，账本导出，预期 0；>0 即 §4.7-2 监督器的授权证据与阈值数据）。
- **B3 修订（第五次修订，2026-11-16，用户 /loop 指令）**：升为三因子集成运行（EVO_A4+EVO_ASK+EVO_L4），偏离逐因子纪律记录在案——用户以"打通自进化范式"优先于逐因子归因，并授权实验循环：实现→运行→分析→修复→重跑，直到自进化结果与交付质量符合预期；交付质量标准=商业产品展示级（开发环评审交付物）。命题增补：能力级自改**带层声明**且按四级链（§8.4 可见→生效→行使→效果）可归账。测量增补：每层变更计数、闭合回流 ref 被引用次数、[layers]/evolution_layer 的 evidence_refs 引用数。预算：每次发射前单独声明 caps（预设镜像 B2：600 请求 / 14400 s / 2 GiB；glm-5.3-flash via az）；重跑计入同一授权。

## 6. 开放决定（请用户定夺）

1. **subagent**：视图将如实显示 "0（写入口拒绝）"。是否解除 `experimentLimits` 的 subagent 拒绝并给它执行路径（run_agent 式，`自然语言执行器`提案待决）是**独立授权**，本稿不包含；不解除则五类中四类可进化，subagent 保持可见的拒绝事实。
2. **[deposit]（写后未读的工作区沉积）**：需要新增读回执才能机械成立；是否列入下一轮。
3. **摘要行常驻成本**：已定（最小化修订，2026-11-15）——取零常驻：A4 仅评审入口投递，不加 observationHeads 库存段；原 +≈45–90 字符/请求选项废弃（§4.2/§4.4 已同步）。
4. **digest 字段算不算越出“零新机制”（债5）**：分析立场为不算——组件 schema 一个可选字段 + 一条投递规则，无新通道；若接受，digest 随债5 触发条件实现，本轮不动。
5. **rent 事实是否这轮就随 A4 带（债4/债5）**：已定（用户同意，2026-11-15）——本轮随 A4 带上：[inventory] 每类后缀“字符/请求”+总驻留一行，head 组装时数字现成、近零成本，服务债4 的价格事实；仅评审入口随行（§4.1）。
6. **用户决定（2026-11-16，/loop 指令）**：收纳 ChatGPT 四层方案为 §8/§4.9，保持"agent 针对自身运行视图热修改"范式与最小化实现；授权 §5 的迭代实验循环与质量标准；§6.1 subagent 悬决不变（challenge 子代理形态继续挂此）。

## 7. 内容层缺口（下一因子候选，B3 结果后挑选；定稿后修订，2026-11-15）

对照开发循环分析与运行内视图的材料差：事后分析的决定性证据约一半是事件计数（已入视图/A4 后更全），另一半是**读内容**——视图今天是纯事件计数器，从不看任何东西的内容。四条候选，均有纯机械、无语义判断的事实化路径，本轮不实现（守因子纪律）：

1. **产物/载荷内容形状**：跨跨度产物字节相似度（如 "unit-03 与 unit-02 字节 78% 相同"）、同地址修订 diff 占比（B1 的 74 次全文重写会显示为 diff≈100% ×74）。B1/B2 的决定性发现均来自此类证据；§4.1 为守一因子明确排除过相似度——下一因子第一候选。
2. **每跨度成本与趋势**：A3 跨度补请求/token 总量 + 跨度成本序列（"6,5,5,5,5,…"——学习曲线没弯，即"无沉淀"的无评论表达）。
3. **自身历史比较器**：首跨度 vs 最新跨度自比——运行内唯一诚实的比较器；条 2 的趋势行是其最小形式。
4. **agent 语言回流**：评审入口带近几次闭合的 ref（账本已有，仅不呈现——最小机械形式）；thinking 记录为可审对象需新回执，与 §6.2 [deposit] 同族（新机制，另议）。

挑选判据：若 B3 证伪形态为"引用了 A4 仍零能力级变更"，优先 1/2；若为"创建了但未被行使"，优先 3；若闭合显示"看见了但材料不足"，读闭合文本定哪条。若闭合给出经济性理由（判定不值得造），按 §4.8 债4 的预登记分支解读：指向价格事实缺位，优先 2 并连带 rent 事实（§6.5），不判视图失败。

## 8. 四层演化坐标系与 meta loop（第五次修订，2026-11-16：ChatGPT 方案收纳）

来源：用户与 ChatGPT 的讨论《自进化Agent四层设计》（转录：r04 工作树 `tmp/chatgpt_transcript.md`，未入库；方案经用户 16 轮纠正定形），用户指示"尽量遵循 gpt 的方案"收纳。范式锚不变：**视图与接口归服务，判断与热修改归 agent**；四层是视图与修改对象的坐标系，不是新增判断者。

### 8.1 坐标系与归层

- 四层 = agent 可进化对象的坐标系：**Prompt**（决策与行为指令：系统/评审提示、决策规则类组件）、**Context**（进入输入的知识与状态：memory、知识型 skill、投递/驻留策略）、**Loop**（流程与节奏：orchestration、评审节奏、流程型策略）、**Harness**（执行面：tool、subagent、反射/绑定、权限与版本机制）。
- 归层按**运行时职责**，不按 kind：同 kind 可异层（skill 按用途——推理方法→Prompt、任务知识→Context、流程策略→Loop、可执行→Harness）；混合职责对象应拆分后各自声明。
- kind 与 layer 是两个维度（kind=是什么，layer=在演化坐标系中为什么在）；`evolution_layer` 由 agent 声明（§4.9-1），服务记录声明与实测消费两列，永不推断。
- 这补上两处在案缺口：决策规则/thinking 类变更的归属地（2026-11-03 kind 转换缺口——它们是 Prompt 层对象）；五类组件+orchestration 与四层映射不清（讨论中用户提出，按职责归层是其解）。

### 8.2 四层运行视图

self 视图 = 任务锚（statusFacts，既有）+ 四层子视图（§4.9-2 [layers] 块）+ agent 认知连续性材料（§4.9-3 闭合回流）。原则沿用本稿：unknown ≠ 0、缺席可见、runtime 事实与 agent 判断严格分离；视图是热修改的**对象清单与证据源**，不是判断者。A4 的 [inventory]/[recurrence] 自此定位为 Harness 子视图，rent 服务 Context 子视图。

### 8.3 meta loop：评审入口即元控制回合

- 持续过程而非一次性 plan-and-execute（用户定形）：每个评审入口，agent 读任务状态+四层视图+近闭合，在既有动作全集中选——**查**（read_self / read_self_component）、**改=热修改**（reflect_component / reflect_orchestration / policy，四层对象各有入口，§2.3）、**试**（deactivate/restore + M-C 窗口对照，债3）、**记**（close 三问数组，§4.7-1）、**不改**（合法闭合）。无新动作机制；动作全集的存在性进目的句（§4.9-4）。
- 可选操作（理论机制的收敛形，证据触发、非常驻、"无需挑战"合法）：**challenge**——对自身任务理解或层配置找反证，以自身推理或 deactivate 对照实现，子代理形态挂 §6.1；**disambiguate**——竞争解释共存时做最小区分试验。
- runtime 只保节奏与活性（§4.7：机械评审节奏、监督器挂首实例），永不做语义判断、缺口结论、点名创建（三禁区不动）。

### 8.4 证据链四级

**可见**（事实进视图/被引用）→ **生效**（变更入 active 配置，reflect 回执）→ **行使**（新对象 in_path/被调用/步被执行）→ **效果**（M-C 窗口、交付指标变化），四级不可互替，对应 AGENTS.md 的四分报告（functional correctness / full-chain reachability / autonomous adoption / net benefit）。每次自改按 层+四级 归账（evidence_refs 与既有回执覆盖，无新字段）；效果分组件/过程/任务三层，任务层以交付质量为准。

### 8.5 收纳边界（GPT 方案中不引入的，及为何）

- **运行时统计/监控子系统**：用户设计期纪律——优化发生在设计阶段，设计定稿后是固定工程；"loop 可塑"的含义是 agent 经反射改自己的 loop 配置（§4.7-3 方向），不是加元元监控。
- **常驻 Evolution State 大对象**：task_state/self_view/candidates/evidence_ledger 已由 statusFacts/评审视图/§7/账本分布式实现；hypotheses 的家是 agent 自己的 memory 组件+闭合回流（§4.9-3），不建新存储。
- **预定义挑战者/评审者角色**（agent-native：运行中创建、同模型）与**固定 plan-and-execute 流程**（用户两次否决）。
- 已知缺口记录在案、不由本修订解决：可见≠采用（梯度来自任务结构与价格事实，债4 与 2026-11-04 结论）；跨运行沉淀（债4 迁移项）。

## 9. 实现与离线验证记录（2026-11-16，本提交）

- 落点：`demo/self_observation.ts`（A4 计数与 [inventory]/[recurrence] 渲染）、`demo/self_root.ts`（评审入口 A4/ASK 块、exit 三答闭合、L4 声明记录/回显/[layers]/闭合回流）、`demo/self_root_ppt.ts` 与 `demo/ppt_demo_extension.ts`（surface 接线；Typebox 的 `evolution_layer` 字段仅在 l4 开启时注入，关端字节级回到 B2 契约）、新测试 `tests/self_root_evo_capability.test.ts`。全部挂 `EVO_A4`/`EVO_ASK`/`EVO_L4` 三开关，默认关。
- 功能正确性（离线，mock provider，fee-free）：`node --experimental-transform-types --test --test-concurrency=1 --test-force-exit` 跑 8 文件共 58 测试：48 过 / 10 败。其中能力视图 6/6、机制回归 8/8、`self_root.test.ts` 26/26、`self_root_v141` 2/2、`provider_permit` 2/2 全过。
- 10 个失败全部在 `ppt_demo.test.ts`(8)/`ppt_demo_live_orchestration`(1)/`ppt_trials`(1)：将 4 个 demo 文件检出到基线 8f425f23 后重跑同 3 文件，失败集逐名一致（14 测试 4 过 10 败）——均为既有失败，断言的是 self-entity 收敛前的旧架构（process kind、工作区文件持久化、写路径门禁、Pi XML 技能索引、rootObject 投影键、trial 已存组件），与本修订无关，不在本次范围修复。
- 层级声明：以上仅为功能正确性与接线证据；full-chain reachability、autonomous adoption、net benefit 未验证，待 B3 真跑（§5）按 可见→生效→行使→效果 归账。

### 9.1 B3-1 运行记录（2026-11-16，runs/evo-b3-glm53f-capview-20261116）

- 条件：三因子 EVO_A4/ASK/L4=1（launcher 回显验证），提交 69b0176c，caps 镜像 B2（600 请求 / 14400 s / 2 GiB，token/USD 无上限），发射前已声明。
- 终止：provider_error——az 共享网关 429（RPM 限流）间歇爆发：30 个计费请求中 10 个失败，末段三连发跨 35 秒耗尽 Pi 重试（maxRetries 2，退避 2–4 s）。非预算、非上下文问题：input 峰值 ~60K，上报实耗 ~724K tokens / ≈$0.09（低于 B2 的 1.75M / $0.26）；summary 的 8.6M / $1.33 中 ~7.9M 为失败请求按 contextWindow+maxOutputTokens 的保守预留入账（usage_status=unknown_reserved），是会计上限而非实际消耗——预留计费在高失败率下严重失真，列为已知局限。
- 机制证据（三项全部行使）：三次进化评审闭合均带 3 条实质 entry_question_responses，且引用 A4 事实原文（如 "ppt_baseline_guidance (prompt, 5312 chars/request, exposure=false in 0/3 spans)"）；两次参数级自改带层声明（policy.request.maxOutputTokens=16384→harness、policy.context tool_results.max_chars=60000→context），激活后在轨迹中被行使且有效（26,046 字符写入与 54,719 字符读取完成，截断不再复现）；能力级自改 0——三问下引用 A4 的诚实负答，属 §5 认可的合法负例。闭合回流与 [layers] 的消费证据待 B3-2 轨迹核对。
- 任务侧：终止前已达 render v2、15/15 slides、0 warnings、unit-01 accepted；仅 1/10 单元走完提交协议 → 交付不成立，归因外生 429 而非方案缺陷。
- 修复（本提交）：retry maxRetries 2→6、baseDelayMs 2000→5000、maxAgentDelayMs 4000→60000（服务侧节奏/存活参数，判断权不动；tests/test_evo_ppt.py 同步）。另修一个陈旧测试：`plain_text_end` 出口在 nudge 机制引入后已不存在（纯文本收尾一律被推回 execute，直到 delivered 或预算收束），测试断言更新为现行契约，与 429 修复无关。B3-2 以新根重跑，caps 同预设，重跑计入同一授权。

### 9.2 B3-2 运行记录（2026-11-16，runs/evo-b3r2-glm53f-capview-20261116）

- 条件：同 B3-1 三因子（launcher 回显 EVO_A4=1 EVO_ASK=1 EVO_L4=1），提交 eb804196（含 429 重试修复），新根，caps 同 B2 预设；重跑计入同一授权，发射前已声明。
- 结果：stop=delivered，10/10 单元交付。56 计费请求 + 1 预检 / 2,162,079 tokens 全部实报（requests_with_missing_usage=0，保守=实报）/ $0.3236 / 1132 s；全程零 429——重试修复在 manifest 中生效但未被触发，骑过能力仍属未实战验证的保险。对比 B2（69 req / 1.75M / $0.26 / 1271 s）：tokens +23%、请求 −19%、墙钟 −11%——三因子常驻 + 15 次评审入口的代价约两成 token 开销，无交付损失；证伪条件"成本显著劣于 B2 且无任务收益"未触发。
- 能力视图证据（三项全部行使，证据强于 B3-1）：
  - A4 [inventory]/[recurrence]：15 个评审入口全部闭合（14 次 + 终评审在第 56 请求内走完交付），每次闭合 3 条 entry_question_responses 逐字引用 A4 事实（"ppt_baseline_guidance (prompt, 5312 chars/request, exposure:false, use:false, in path 0/15 spans)"；复发计数 decide_exit x15、submit_unit x10、office.render x5 等）——证伪条件"全程 0 引用"未触发。
  - EVO_ASK：入口来源含 unit_completed 共振、booked_facts，及第 55 请求处 agent 自发的 requested_review 终评审；无机械闭合。
  - EVO_L4：1 次激活（revision 2）单补丁合并两地址——policy.request.maxOutputTokens 8192→32768、policy.context.tool_results.max_chars 4000→提高，declared_layers 两处均 "loop"；evidence_refs.retained=["ledger:30"]（B3-1 为空，闭合回流引用本次出现）。
  - 四级链（参数级）全链闭合：可见（ledger:30 截断事实）→ 生效（revision 2 激活）→ 行使（used=true）→ 效果（后续 50+ 请求零复发，agent 在闭合中自行跟踪）。能力级自改 0——各闭合给出引用 A4 的诚实负答（"组件零曝光、无缺口"），为 §5 合法负例；按 §7 挑选判据与 §4.8 债 4 的预登记解读：指向价格事实缺位（§7-2 每跨度成本 + §6.5 rent），而非视图失败。
- 任务侧：render v5、15/15 slides、0 warnings；终检 30/30 literals + 10/10 citations 命中；agent 曾就 unit-08 "$1,621" 探针异常对照源材料核验后判为检查器归一化误报（忠实性行为良好）。人工抽查（contact sheet + slide-03/06/15 全尺寸）：品牌统一（BofA 藏青/红）、统计卡/表格/条图排版干净、口径注释与引用齐全，内容与版式达到对外展示主体水准；残留瑕疵：内容普遍顶置、信息量小的页（03、06）下半页留白偏大，页脚恒显 "1 / 15 · Title"（未随页变化的标签缺陷），slide-06 参考线标注 "Reg. minimum 9." 轻微裁切。判定：交付质量达标，瑕疵为打磨级非结构级。
- 本质不足（跨 B3-1/B3-2，下一轮候选）：
  1. 能力级变更的经济学输入缺位（债 4）：视图给出缺口与复发计数，但无价格事实，agent 的"不值得造"无从被挑战——下一个可证伪检查 = §7-2 价格事实 + §6.5 rent（新范围，待预算）。
  2. L4 层声明分类学漂移：同类地址 B3-1 声明 harness/context，B3-2 声明 loop/loop——声明被行使但跨运行不可比；候选修法：把层定义作为事实并入 A4 清单（仍是事实供给，判断权不动）。
  3. 评审节奏开销：交付尾段每单元 ~2 请求为评审共振，是 +23% token 的主因；入口合并/降频属机制侧参数，留待下一轮设计权衡。
  4. 验证窗协议缺省：window:0 全程 provisional predicate、due_unverified——agent 拒绝编造谓词（符合协议），但效果结算从未升级为可判定；需要谓词来源设计（激活时要求一条可机检谓词或显式 declined）。
- 判定：§5 窄声明的正例（能力级自改）未出现，三条证伪均未触发，预登记负例分支成立；参数级四级链完整闭合。B3 系列（含 429 重跑）以交付成功收束，能力级停在"诚实判定不值得"，与价格事实缺位一致。

## 10. 能力级自进化为 0 的成因分析（2026-11-16，用户指令："能力级自进化才是我的核心目标，分析当前自进化为 0 的原因"）

### 10.1 证据基：三次运行中 agent 实际用的决策程序

B2（13 次闭合）、B3-1（3 次）、B3-2（15 次）全部闭合原文呈现同一个三准则程序，B3-2 原文（summary.json evolution_reviews）逐字：

- **摩擦准则**（问①）："the recorded output_cut (ledger:30) came from policy.request.maxOutputTokens=8192 … Both were tuned via a policy merge patch"——有摩擦事实→修参数；"the office 3x-identical-input repeat was a process slip — **corrected by behavior, no structural change needed**"——可用行为修正消化的，不做结构投资。
- **覆盖准则**（问②）："All recurring calls (decide_exit x15, submit_unit x10, office.render x5, read x13, plus write/python/edit/grep) **map to existing capabilities** … no recurring work lacks capability coverage."——检验"现有能力够不够做"，从不检验"这样做贵不贵"。
- **需要准则**（问③）："the deck was authored, verified, rendered and accepted entirely with native tools, **so these components were never needed**; they remain dormant with no recorded justification for activation."
- 结果模式：**历史上全部自改（B2 1 次、B3-1 2 次、B3-2 1 次）无一例外是摩擦响应**（output 被截、tool result 被截），**投资型自改为 0**。15 次闭合没有一次做过任何成本算术——没有一个数字出现在任何闭合理由里。

这个程序对本任务世界是**正确判断**：任务徒手必成、无摩擦，三准则全部满足于"不造"。问题不在判断，也已不在感知（B3 的 A4 引用证明事实到达了判断），而在**判断所处世界的价值结构**。

### 10.2 成因（按证据强度排序）

1. **任务无可感梯度（主因；用户 2026-11-04 既有诊断在 B3 复现）**：交付标准二值（accepted/否）、预算十倍富余（caps 600 请求，实际 56）、成本不是任务质量的一部分。徒手生产已证可靠，组件化的全部收益落在"省成本"上，而成本在这个世界里**没有价值**。省下的请求换不来任何东西。摩擦驱动的参数修复有梯度（任务被卡住），投资驱动的能力建造没有。
2. **组件没有未来（摊销地平线=运行边界，且 5 类中 4 类在单上下文内冗余）**：compaction 关闭、全量转写常驻——agent 的上下文本身就是它的 memory，memory 组件严格冗余；skill 是写给"未来的自己"的，而单上下文内未来的自己就是记得一切的现在的自己；subagent 写入口被拒。11-03 已立的律（deposition-follows-consumers）："**agent 只沉积循环会消费的东西**；一个上下文做一个任务时，prompt/skill/memory/subagent 没有读者。"唯一有运行内真实价值的是 tool（输出 token 转为宿主执行），恰是建造风险最高的一类。运行结束组件即死，跨运行迁移未设计（债4）。
3. **经济学不可见且即便可见也近乎平坦（债4 的修正表述）**：无每跨度成本、无建造成本、rent 仅字符——agent 想算也没数字。但补上数字后算术本身也不陡：建造 2–5 请求、每单元省 1–2 请求、10 单元内温和为正——在 600 请求的预算下，**正的节省乘以零的稀缺性仍是零效用**。真实的重复成本在输出 token（每单元重写相似 HTML；11-02 审计：重打的代价是往返与输出 token，不是代码文本），而输出 token 同样不对 agent 构成任何压力。价格事实是必要材料，不是充分条件。
4. **设计自缚：两种动机都被排空**。§4.5 正确地禁止"组件数作回报"（防 B1 配额病）——排除了"为进化而进化"的内在动机；而任务世界又没有给"为任务而进化"以经济条件——排除了工具性动机。两头皆空，0 是这个设计在这个世界里的必然输出，不是异常。目的句给的是**许可**，给不了**动机**；B1 证明动机不能靠义务注入，只能来自任务的真实经济学。
5. **次要助因**：问②的措辞（"能力覆盖是什么状况"）本身引向覆盖式回答，三问没有一问必须用算术才能作答；建造-试用回路跨 mode（评审帧内 task 工具被 surface 门控："requires a write tool unavailable in this review frame"），投资有在途风险而徒手已证；flash 档模型跟随给定梯度、不自发创造梯度（su15 证据：harness 携带强模型），agent-native 不变量下环境必须供给梯度。

### 10.3 综合与修复方向（排序，不在本节实现）

断裂点一句话：**可见已修好（A4 被引用），但"看见的浪费"在这个世界里不值钱**。四级链（可见→生效→行使→效果）预设了一个只在期望价值>0 时才会触发的"决定"；能力投资在当前世界的期望价值处处≤0（无成本压力 + 无未来 + 有风险），诚实的 agent 于是永远选择免费的行为修正而非付费的结构投资。修复必须改变价值结构，而不是继续加视图：

- **D2 第二消费者（最强杠杆；11-03 已有最小方案）**：一次运行做两副同族 deck，deck A 交付后清上下文、仅 harness 携带过界（约 60–80 行实现）。清上下文让"失忆后的自己"成为 prompt/skill/memory 的真实读者——直接解除成因 2；deck B 的存在让 deck A 内的沉积有真实回报——直接解除成因 1。预登记证伪（11-03 原文）：deck A 仍零能力沉积→下一因子是非 tool 类的接口与 push 对称性。
- **D3 价格事实（§7-2 [cost] + 既有 rent；近零成本，与 D2 配套）**：每跨度请求数/输出 token/趋势序列，评审入口随 A4——给判断以算术材料（解除成因 3 的"不可见"半边）。
- **D1 成本约束成为任务事实**：把预算作为任务事实告知（11-04 结论"make cost bind"），且 caps 收紧到真实约束量级——注意必须是真约束（真 caps），不是劝勉句；否则是制造出来的梯度（11-04：可被机械满足的制造梯度是形式，不是梯度）。
- **D4 跨运行持久化**：摊销地平线的质变（build once, use forever），但属新机制新范围（自我改进三层的第 2 层），用户 11-04 曾搁置——本轮不动，D2 是它的运行内最小对应物。
- **不做**：任何建造建议/配额/采纳率指标（三禁区不动）；"为答题而造"的 B1 镜像仍按 §5 悬空创建判失败。

