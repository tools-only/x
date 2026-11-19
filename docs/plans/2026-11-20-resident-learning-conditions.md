# Meta-harness 变更记录：常驻学习条件 —— 契约作为可重开、可回放的学习条件声明

日期：2026-11-20（Asia/Shanghai）。状态：设计（未实现、未运行、未获付费预算）。
按 [开发流程](../development-workflow.md) 使用。本记录只写设计与运行前协议；证据表四层全部未验证。

## 0. 用户方向与落点

用户 2026-11-19 的方向（针对 evo-loop-implementation 版本，HEAD `3cd49d7d`）：自进化目前只提供了能力提升的机制和可能性；工程应有一个机制，使 agent 在**任何任务环境**里都能快速构造出一套支撑自身自进化的系统。ARC 有固定流程、状态转移与反馈，自进化体现在探索、理解机制、形成通关策略；PPT 不存在真实反馈、没有明确交付目标，agent 应当在**审查任务与自身（即审查自进化条件、环境）时自己发现这一点**，并自己构造支撑系统。该能力可复用现有机制（例如 meta）。这个**审查、创造、修复学习条件的机制应当常驻**，运行过程中可评估以往与正在进行的自进化存在哪些问题。硬约束：**自进化完全 agent-only，没有其他读者和用户**。

| 方向 | 现状（HEAD 3cd49d7d） | 本记录的落点 |
| --- | --- | --- |
| 任何任务环境都能快速构造支撑系统 | T0 设计回合让 agent 自己写 `contract`：`task_goal` / `task_acceptance` / `loop_policy.look_when`（每条绑定一个宿主侧任务事件）。这已经是 agent 构造学习条件的入口 | 不新建入口；把这份声明从"一次性文本"变成常驻、可重开、在它自己绑定的事件处回放的对象 |
| 自己发现环境缺反馈、缺交付目标 | 板面每个请求回放 `TASK ACCEPTANCE` 原文，但旁边没有任何与之相关的事实；单元探针逐段记录，宿主明确不汇总（`demo/self_root.ts:1152`） | pass 入口推送与该契约相关的机械清点，让"声明"与"该声明相关的事实"第一次出现在同一处；判断仍全在 agent |
| 复用 meta，不另起机制 | 两轮 pass、七专家、`decide_exit`/`carry` 已在位 | 零新层、零新工具、零新必填字段；修复通道沿用已存在的 `reflect_orchestration` edit 模式（`demo/live_orchestration_core.ts:315` 接受 `contract`） |
| 机制常驻 | 常驻的是板面（目标/验收/可优化对象/自变更计数/窗口）；学习条件本身不常驻 | 任务阶段按"刚发生的任务事件"回放对应 look（agent 自己的文本）；pass 入口带清点段 |
| 评估以往与正在进行的自进化的问题 | `selfChangeDigest()` 已有 `requests_since_change`、`refused_self_operations`、`validation_windows`；`metaAcceptance()` 已有 changes/activated/exposed/successful_execution（semantic_use 恒为 unknown） | 在 pass 入口把这些既有计数与 agent 自己声明的条件绑在一起复述，不新增计算口径 |
| agent-only，无其他读者 | — | 本机制的全部输出只进入 agent 的下一个请求或下一次 pass 入口；不产生面向开发者的报告、不新增交付件、不新增人工评审位。开发侧读数只从运行日志事后取，不回灌运行 |

**作用域诚实说明**："以往的自进化"在本设计里只能读作**本次运行内更早的变更**：运行之间没有持久自我存储，跨运行历史在运行内不可见。跨运行的学习条件历史是一个未解问题，本记录不声称覆盖它（见 §5 剩余验证）。

## 1. 问题与命题

**真实失败与材料**（全部来自 `runs/evo-m15-host-assembly-20261119`，az / glm-5.3-flash，HEAD `3cd49d7d`，54 请求 / 2.17M tokens / $0.300 / 1286 s，交付 10/10）：

- T0（请求 4，`.harness/live-self.json` 的 `ledger:28` `meta_t0_design`）写下契约：`task_goal` 一句、`task_acceptance` 六项、`look_when` 四条，分别绑定 `segment_boundary` / `failure` / `repetition` / `self_change`。
- 这份契约文本**从请求 4 到运行结束逐字未变**：收尾快照（同文件 51434、51962 行）与 `ledger:28` 完全一致。期间 54 个请求、5 次 meta pass、5 个 self revision、4 次 `reflect_orchestration`，没有任何一次重写 `contract`。
- 验收第 (3) 项"所有引用数字可追溯到 material.txt、数据页带出处标注"与**同一运行自己记录的探针事实相反**：首渲回执（`harness/tools.jsonl` 第 2 行）里 unit-02 literal 1/3、unit-03 至 unit-06 全 0/3，unit-02 / 09 / 10 `citation_found: false`；终局探针同形。事实在工具回执里出现过，验收句在板面上每个请求都出现，两者从未在同一处相遇，也没有任何环节对这个矛盾有发言权。
- 板面只回放 `on === 'segment_boundary'` 的 look（过滤 `demo/self_root.ts:1130`，渲染 `:1153`）。agent 自己为 `failure` / `repetition` / `self_change` 写的三条 look 在 T0 之后**没有任何呈现点**：四条自定学习条件里三条按项目自己的判据就是悬挂产物。
- 拉取侧很弱：整个运行 `read_self` 实际被调用 **1 次**（`session.jsonl` 第 56 行，`section:"self"`），`read_self_component` 0 次。板面自己就把这件事当作 context 信号渲染着（`:1123` 的 `self_reads`）。
- 并行 WIP（另一 agent，工作树内未提交，记录见 `docs/plans/2026-11-19-learning-environment.md`）加的是 `read_self(section="learning_environment", ref?)` 只读查询 + 一行常驻指针 + 一段 META 系统提示职责。材料侧（环境→宿主动作→观测→资源→上下文→反馈→复用）补得很完整，但消费侧落在上面那条被证明很少被拉的通道上。

观察与推测分开：以上计数与文本同一性是**观察**；"agent 若看到自己声明的条件与该条件相关的机械事实并列，会重写契约"是**推测**，未验证。

**窄命题**：在 EVO_META 的冻结 PPT 任务族一次获授权运行里，当 (a) 契约的每条 look 在它自己绑定的任务事件刚发生的那个请求被回放，(b) pass 入口带上该契约的机械清点行（各触发器发生次数与回放次数、上次自变更以来的反馈 ref 数、声明了 `expected_effect` 而其后无成功执行 ref 或无窗口的变更数），则 agent 会在 T0 之后**至少重写一次** `orchestration.contract`（改验收句，或增删改一条 look），且被改写的条件在后续请求里于它绑定的事件处可见，并被它所命名的任务动作跟随。

**减少的负担**：agent 不必再从账本重建"我当初声明过在什么时候看什么"；pass 轮 1 不必再从原始窗口事实里推断自己学习条件的状态。父决策步数不变：不新增工具、不新增 pass、不新增必填字段、不新增管理往返。

**适用条件 / 合理不使用 / 推翻条件**：适用于环境反馈与 agent 自己声明的验收不同构的任务（PPT 即此形）。合理不使用 = 环境反馈已足以判别声明（ARC 的同帧动作回执形态），此时零重写是**合法负例**；按用户 2026-11-16 的决定，合法负例不得改读为收益。推翻条件 = 回放与清点都在位，运行结束仍零重写，或只有措辞级重写。

**范围及非目标**：本次只产出设计记录，不改代码、不跑付费运行。非目标：不新增层（遵守"最小环证实前不加新层"）；不预置工作流（workflow 仍由 agent 在运行内自己设计，用户 2026-11-04 决定）；不给交付加 gate；不动 `arc_thin_*` 路径；不改权限/预算/版本/环境检查；不编辑另一 agent 未提交的 WIP 文件。

## 2. 设计与成本

**选择与取舍**。三个候选：

1. 新增一个"学习条件评审 pass"。否：新增层与新增常驻义务，违反 §5 常驻成本比较与"最小环证实前不加新层"。
2. 只加拉取面（= 并行 WIP 的现状）。材料正确，但消费侧被 m15 的 1 次 `read_self` 否掉（components-push-not-pull）。
3. 给 agent **已有的声明**加呼叫点（本记录）。修复通道本来就存在——`reflect_orchestration({orchestration:{mode:"edit",contract:{...}}})` 已被接受（`demo/live_orchestration_core.ts:315`），只是 T0 之后无人提起它；呼叫点加在 agent 自己的文本上，是最便宜的一种常驻。

选 3。它复用 meta，零新层、零新工具，并且把"构造学习条件"这件事留在 agent 手里：宿主只渲染已记录文本与机械计数，不判断条件好坏，不提出修复方案。

**无悬挂产物表**（AGENTS.md 首条判据）：

| 机制 | 输出在哪里不请自来地进入 agent 循环 | 替代了什么工作 | 下一步真实动作如何反馈到它 | 何时退休 |
| --- | --- | --- | --- | --- |
| 条件回放 | 任务阶段：绑定事件刚发生的那个请求，`metaBoard()` 的 flow 行旁回放对应 look（agent 自己的文本，≤2 行） | agent 自行回忆或 `read_self` 取回自己的运行计划 | 该事件的下一次任务动作是否与被回放条件一致，记在同一账本里 | **自带退休**：agent 删掉那条 look，呼叫点随之消失；若两次获授权运行都显示"回放出现、其后动作无关"，整块撤下 |
| pass 入口清点段 | pass 入口块（随 pass 请求出场），WINDOW 与 TRAJECTORY 之间，≤600 字符 | pass 轮 1 从原始窗口事实推断学习条件状态 | 下一次 pass 入口里同一触发器的发生/回放数字变化，以及是否出现契约重写 | 两次获授权运行里清点段之后都零契约重写 → 撤下清点段，保留回放 |
| 宿主事实 `look_echoed` | **不进 agent 上下文**（纯度量钩子） | 手工从转录里数"哪条条件被展示过" | — | 两块机制都撤下时一并删除 |

**生命周期**。机会 = 任务事件发生（`segment_boundary` / `failure` / `repetition` / `self_change`，全为宿主已记录事实）。识别 = 回放把 agent 自己的条件文本放在事件旁。投入 = agent 在当次请求或下一次 pass 里决定改不改。候选 = 一次 `reflect_orchestration` edit。装配 = 既有校验与激活路径，`contractProblems()` 形状校验不变。语义使用 = 被改写的条件在它绑定的下一次事件处可见，且其后的任务动作与它命名的检查一致。反馈 = 下一次 pass 入口里该触发器的数字。不适用的转移：没有"宿主批准"这一步，宿主从不判断条件质量。

**首次获益路径**。必经的父模型决策只有一个：agent 读到回放后决定重写契约（1 次 `reflect_orchestration`，计入同一预算）。合并掉的步骤：pass 轮 1 不再需要自行从账本推断学习条件状态。

**新增与移除**。

- 常驻提示：板面**不新增常驻行**。任务阶段只在绑定事件刚发生的那次请求回放对应 look；pass 入口新增一段 ≤600 字符，入口块总上限 8000 不变。若并行 WIP 的 `LEARNING ENVIRONMENT` 指针行同期落地，建议把它**并入同一块**，使同一主题的常驻成本保持一行一块，而不是两处各说一次。
- 字段 / 门禁 / schema / worker / 管理轮：零新增。`contract` 的 provider schema 不变；T0 门禁不变（仍一次开闸）。
- 新增一个宿主侧事实 `look_echoed`，只用于度量"shown / acted on"，不进 agent 上下文。

**权限 / 版本 / 环境边界**。保留 reflect_* 通道内的结构校验、权限、预算、版本与环境检查；回放只渲染已记录文本，不执行任何东西；实际生效入口 = `metaBoard()` 的任务阶段分支与 `passEntry()`。

**放弃与恢复**。预算未获授权 → 不启动，设计保留。两次获授权运行里清点段之后都零契约重写 → 撤下清点段。回放只增字符不改动作 → 一并撤下。已记录的事实不回写、不改写。

## 3. 运行前实验协议

- **目标证据层级**：本记录到"设计"。实现后的免费检查只能给功能正确与接线；自主采用与净收益需要一次获授权的真实运行。
- **主要变量与比较器**：vs m15（同任务族、同 provider、同 arm）单因素 = "契约条件的呼叫点 + pass 入口清点段"。其余差异必须为零；若并行 WIP 的 `learning_environment` 查询同期落地，则**不再是单因素**——两者要么分两次运行，要么按上面的并入方案作为一个因素一起评估并在记录里写明。
- **模型 / provider / 任务 / 初态**：az / glm-5.3-flash（与 M11–M15 一致）；冻结 PPT 任务族；`EVO_META=1`；初态 = 干净 HEAD 加本改动。
- **独立样本与运行顺序**：1 次确认样本（预算所限），不做盲重跑。网关静默或 429 按 M9b / M13 的探针规则先 ping，探针计入系列。
- **总预算与停止规则**：**待用户声明**。按 2026-11-16 的系列授权（600 请求 / 14400 s / 2 GiB）划拨，启动前把本次 cap 写进可见文本（`runs/<root>-caps.json` 与 launch 文本），重启计入同一 cap，单次超限即停。量级参考：m15 实耗 54 请求 / 2.17M tokens / $0.300 / 1286 s。
- **主要指标与判定标准**：主指标 = T0 之后 `contract` 重写次数 ≥1，且其中至少一条改动在它绑定的事件处被回放后被任务动作跟随。保底 = 交付不退（单元交付数与 literal 分布不低于 m15）、零 schema 拒绝、pass 请求不超预算。成本按父 + 子同口径。可接受的退化：多约 1 次请求与 pass 入口约 600 字符。
- **负例（预登记）**：(a) 零重写 → 推送仍不敌惰性，断点维持；(b) 只改措辞、无新条件 → 装饰性采用，命题不成立；(c) 重写后该条件在它的事件处未被回放 → 装配断点；(d) 回放出现、其后任务动作与条件无关 → 消费断点；(e) 环境反馈已足以判别声明 → 合法不使用，不得改读为收益；(f) 预算不足未启动 → 无结论。
- **遥测及材料**：现有 `.harness/live-self.json` 账本（`meta_t0_design`、`reflect_orchestration` 的 `tool_result`、`meta_pass_opened` / `meta_pass_entry`、四类任务事件事实）、`session.jsonl`、`harness/tools.jsonl`、`harness/provider-requests.jsonl`。唯一缺失的读数是"某条 look 被回放过"，由宿主事实 `look_echoed` 补齐；不新增任何 agent 可见字段。

## 4. 实现与验证

- **改动入口（实现时）**：`demo/self_root.ts` —— 任务阶段的 flow 分支按"自上次请求以来最近发生的任务事件"选择要回放的 look（把 `:1130` 的 `segment_boundary` 过滤改为按事件选择，渲染点在 `:1157` 的 MECHANISM 行旁）；`passEntry()` 在 WINDOW 与 TRAJECTORY 之间插入 LEARNING CONDITIONS 段（机械计数，600 字符上限）；`metaBoard()` 的常驻行不增加。无 runner 改动、无新工具、无 schema 改动。
- **功能 / 回归检查（实现时必须实跑，现在不得预断）**：`node --experimental-transform-types --test --test-concurrency=1 tests/self_root_meta*.test.ts`、`tests/self_root*.test.ts`、`python -m pytest tests/test_evo_ppt_pi.py`。负例覆盖：无契约、无 look、事件未发生、事件发生但无对应 look、两个事件落在同一请求、契约被重写后旧 look 不再回放。
- **机会漏斗与断点**：未实现，未测量。
- **语义与连续性**：未实现，未测量。
- **成本与任务结果**：未实现，未测量。
- **协议偏离**：无（尚未执行）。

| 证据层级 | 状态 | Provider / environment | 产物及结论边界 |
| --- | --- | --- | --- |
| 功能正确 | 未验证 | 待填写（本地 node/pytest） | 未实现 |
| 全链路可达 | 未验证 | 待填写（本地 Pi + scripted provider） | 未实现 |
| 自主采用 | 未验证 | 待填写（az / glm-5.3-flash 真实运行） | 需用户授权预算 |
| 净收益 | 未验证 | 待填写 | 需与 m15 同口径比较 |

## 5. 交付决定

- **已支持的声明**：m15 运行自己的记录支持四件事——契约 54 个请求逐字未变；`read_self` 全程 1 次；四条自定学习条件只有一条有呈现点；验收第 (3) 项与同一运行的探针事实互斥。
- **未支持的声明**：加了回放与清点之后 agent 会重写契约（未实现、未运行）；本机制在 ARC 形态环境同样适用（接口是任务无关的——`TASK_EVENTS` 与契约文本都不含任务词——但 `arc_thin_*` 路径今天不跑 EVO_META，所以这只是设计论证，需要一次获授权的 ARC 运行才能判定）。
- **决定**：设计保留，等用户给预算。实现前先与并行 WIP 协调常驻行归并，避免同一主题两行常驻外加一条少被拉的通道。
- **剩余验证与下一可证伪检查**：一次获授权的 PPT 运行按 §3 主指标判。若负例 (a) 成立，下一个因素换到**回报侧**（让条件改写在同一运行内有可观察后果），而不是继续加呈现面。跨运行的学习条件历史（用户方向里的"以往的自进化"的完整读法）在运行内无持久存储，仍是未解问题，不在本因素范围内。
- **关联 backlog**：`docs/plans/2026-11-19-learning-environment.md`（并行 WIP，材料侧，状态未变）；`docs/plans/2026-11-16-self-evolution-space.md` §6（M 系列预算与两轮 pass 结构）；`docs/plans/2026-11-16-general-meta-loop.md` §15（固定字段与 T0 门禁的用户定稿）。三项状态均无新证据支持的变化。

## 6. 运行验证（2026-11-20，evo-m20）

HEAD `0939c8e3`（含常驻学习条件审查、`read_self(section="learning_environment")`、render 回执 `visual_metrics`、checker `literal-normalized-render-v3`）。root `runs/evo-m20-visual-metrics-20261120`，az / glm-5.3-flash，arm B，caps requests=3000 / seconds=2592000 / tokens+usd 无上限，brief 追加“专业视觉传达设计师…商用广告级”。实耗 95 请求 / 3.19M tokens / $0.437 / 1661 s，10/10 unit delivered，0 告警。

**结果**

- 交付：30/30 required literals + 10/10 citations 全部 found（m15 为 unit-02…10 多处 missing）。`visual_metrics` 已随每次 render 下发：deck coverage 0.223 / distinct_colors 44.6 / contrast 0.670。
- 常驻审查（目标 1）：9 次 induction review。agent 用 `read_self(section="learning_environment")` + `decide(op="assessment")` 诊断出两个真实学习条件缺口并修复——(a) `submit_unit` ENOENT（`<root>/exports` 不存在，write 无法创建 `../exports`）；(b) `study` step 的 decisions/transitions 在交付前不闭合——经 `reflect_orchestration` 修到 rev 8（增加 `study --office.deliver--> deliver` 与 `study_deliver_complete`）。`orchestration.contract` 由 T0 富化改写为 ad-grade 目标 + 6 项验收 + 3 条 `look_when`。
- 能力级自进化（目标 2）：**未达成**。`snapshot.components` 仅 `ppt_baseline_guidance`（seed prompt，v1 未变，8 次曝光 0 语义使用）。唯一一次 `reflect_component(kind="tool")` 被拒：`session_ref 'exports_bootstrap' unavailable`。

**能力级未达成的断点定位**

1. PPT `python` 工具只接受 `{code}`（`demo/ppt_demo_extension.ts:388`），把 `NativeRuntime.python(code, signal, readonly, save?)` 的 `save` 参数丢弃；`reflect_component(kind="tool", session_ref=…)` 依赖已保存会话函数，故 tool 组件（PPT 最需要的能力载体）永远无法挂载。
2. `submit_unit` 在 `demo/self_root_ppt.ts:247` `readdirSync(join(root,'exports'))`，首次 render 前 `exports/` 不存在即 ENOENT，且 write 工具不能写 `../exports`——host 前置条件缺口。
3. prompt/skill/memory/subagent 路径（只需 `source`）可用，但 agent 未用其创建新组件；seed prompt 8 次曝光 0 语义使用。

| 证据层级 | 状态 | Provider / environment | 产物及结论边界 |
| --- | --- | --- | --- |
| 功能正确 | 已验证 | worktree venv + node v25.5.0 | `visual_metrics` 下发、checker v3、常驻审查入口接线（提交 `e3430d8c`、`0939c8e3`） |
| 全链路可达 | 已验证 | az / glm-5.3-flash，evo-m20 | render→视觉指标→acceptance→审查→orchestration 修复，10/10 闭环 |
| 自主采用 | 已验证 | az / glm-5.3-flash，evo-m20 | 9 次 induction 审查、contract 富化改写、学习条件缺口诊断+修复 |
| 净收益 | 部分验证 | 对比 m15 | 交付 literal/citation 由缺到全；但能力级 harness 组件未产出，净收益未闭合 |

**下一因素（单因素）**：给 PPT `python` 工具补齐会话函数保存通道（`save` 参数或 `promote_session_function` 等价），使 `reflect_component(kind="tool", session_ref=…)` 可解析；并让 `submit_unit` 在首次 render 前不 ENOENT（host 预建 `exports/` 或优雅返回“需先 render”）。之后同配置再跑一次确认，观察是否出现 `tools/*.py` 组件及后续语义使用。

## 7. 运行验证二（2026-11-20，evo-m21，save 修复后）

HEAD `c22aecec`（PPT `python` 工具增加 `save` 参数，镜像 ARC native runtime 的 `python(code, save=)` 通道）。root `runs/evo-m21-tool-save-20261120`，配置与 m20 相同（无上限 + 视觉 brief）。运行到 revision 30 后人工停止（原因见下），未产生终局 `summary.json`。

**结果**

- 能力级自进化首次出现非 seed 组件：agent 创建并 4 次修订 `deck_fix_loop` memory（`notes/memory/deck_fix_loop.md`，v1→v4）。内容为可复用的 render→look→fix→deliver 工作流，含带账本引用的具体规则（`found:false` 作工作队列；编辑批前 grep oldText；render 每周期一次；deliver 走 review decision；decision 需 wiring 且 evidence 需新鲜 receipt；literal 覆盖不等于语义正确）。`reflection_activated` 地址为 `components.memory.deck_fix_loop`，证明组件被激活。
- 归属诚实说明：本次 memory 组件走的是 `reflect_component(kind="memory", source=…)`，该路径在 m20 已可用；`save` 参数本次未被使用（无 `python(save=…)` 调用、无 `tools/*.py`）。因此 memory 组件的出现来自 agent 自身行为/常驻审查，而非 `save` 修复的直接因果。
- 交付未完成：revision 22→30 的 `source_hash` 与 `visual_metrics` 逐帧相同（`86755539…`），agent 反复 render 同一份未变 HTML。这是 deliver-gate 摩擦：`office.deliver`→complete 的 decision 要求 render/look receipt 在同一 request turn 且为当前 artifact，agent 为刷新 receipt 陷入重复 render 循环，最终未完成交付。
- 新发现的校验摩擦：`reflect_component` 对 memory 组件带 `description` 字段时报 `reflect_component: description requires a tool source or session_ref`（`harness/lifecycle.jsonl`，self_revision 2），agent 去字段重试后成功。错误信息只针对 tool，对非 tool 组件有误导性。

**证据层级更新（m21）**

| 证据层级 | 状态 | Provider / environment | 产物及结论边界 |
| --- | --- | --- | --- |
| 自主采用 | 已验证（能力级） | az / glm-5.3-flash，evo-m21 | 非 seed 组件 `deck_fix_loop` memory 创建+激活+4 次修订，含账本引用 |
| 净收益 | 部分验证 | 对比 m20 | 能力级组件从无到有；但交付未完成、save 未使用，净收益未闭合 |

**下一因素（单因素）**：deliver-gate 的完成路径。当前 `office.deliver`→complete 使 agent 为刷新 receipt 反复 render 同一 artifact（m21 在 revision 30 被人工停止）。修复方向：让 host 对“同 artifact 的再次 deliver”直接给可判定的结果（幂等或明确拒绝），或放宽“receipt 必须同一 turn”的约束，使 agent 不必重复 render 就能完成交付。之后同配置再跑一次，确认能 clean 完成交付且能力组件被后续任务语义使用。

## 8. 修复（2026-11-20，deliver-gate 完成路径，evo-m22 已验证）

从 m21 `session.jsonl` 的拒绝回执与 `live_agent_self.jsonl` 的 orchestration 快照定位到两个真实断点（不是 agent 猜测的“same-turn 新鲜度”规则）：

1. **evo `decide` 工具丢弃 evidenceRefs**：`demo/self_root_ppt.ts` 的 `decideSchema` 没有 `evidenceRefs` 字段，且 handler 硬编码 `evo.decide({ ..., evidenceRefs: [] })`。因此任何要求 `office.render` / `office.look` 证据的 decision（m21 的 `deliver_review`）永远 `missing evidence office.render`，agent 反复 render 未变 HTML 也无法满足。
2. **decision 过渡缺 `on.equals` 永不匹配**：`LiveOrchestrationSession.advance()` 用 `same(pointer(result, on.path), on.equals)` 匹配 decision 过渡；agent 自写的 `refine_to_ship` 只写 `on:{type:"decision",id:"deliver_review"}`（无 path/equals），`same(result, undefined)` 恒 false，证据即使齐也不会推进到 `ship`。

**修复（单因素，host 承载拼接/匹配）**：

- `self_root_ppt.ts`：`decideSchema` 暴露 `evidenceRefs`（string 数组），handler 传 `a.evidenceRefs`；工具描述写明引用 `office.render`/`office.look` 返回的 `action-N` 回执。
- `live_orchestration_core.ts`：decision 过渡在未声明 `equals` 时视为“任意已校验结果即通过”，即 `on.equals === undefined ? true : same(pointer(result, on.path), on.equals)`。

**功能验证（免费，本地）**：`tests/live_orchestration_core.test.ts` 8/8、`tests/self_root.test.ts` 29/29、`tests/self_root_meta.test.ts` 21/21 通过；直接复现 `deliver_review`（无 path/equals 的 decision 过渡）经 `decide` + `advance` 推进到 `ship`。`tests/ppt_demo_live_orchestration.test.ts` 的 1 例失败为既有的旧 `reflect_orchestration`（缺 `mode`）schema 漂移，与本次改动无关。

**运行验证（付费，evo-m22，2026-11-20）**：同 m20/m21 配置冻结新 root `runs/evo-m22-deliver-gate-20261120`（az/glm-5.3-flash、`--arm B`、无请求/时间上限、brief addendum 含视觉传达目标）重跑，结果：

- `stop: delivered`，10/10 units `delivered`，30/30 `literal_matches` 命中且 `citation_found` 全真，`warnings: []`；73 请求 / 2.4M tokens / $0.32 / 1315s。
- 6 次 render（rev1–6）`source_hash` 均不同，无 m21 式同 hash 重复 render 循环；`deliver_review`→`ship`→`office.deliver` 全链路干净收尾（receipt `revision: 6`）。
- 常驻学习条件审查多轮触发：`summary.json` 的 `reviews` 含 8 次 `evolution_review` reflect 开关，`learning_assessment` claim 判定 `condition: usable`（ledger:233/390/436）。
- 自进化产出并交付能力组件 `ppt_baseline_guidance`（prompt v2）：`runtime_activations` 的 `reflection_activated` 绑定该组件且 hash 与 `delivery/harness.json` 一致（`857826f2…`）；后续 slide 修复遵循其 checker 字面量约定（`$1,389` 而非 `$1,389M` 等），语义使用成立。
