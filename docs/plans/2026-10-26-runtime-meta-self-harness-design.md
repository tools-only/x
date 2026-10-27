# 运行中的 meta 开发循环：最小闭环方案

日期：2026-10-26（Asia/Shanghai）。状态：已加最小通用 loop mount 实现；当前修改待功能/接线验证，未启动新的真实 ARC/provider 实验。

## 决定与边界

第一刀只建立一个在任务运行中发生的开发循环：**诊断 → 提出预期 → 修改 → 度量 → 决策**。Agent 分析自己的工作过程、选择改动并判断是否保留；runtime 像 CI 一样保存精确版本、运行已有消费者、机械收集结果，并把证据交回下一次既有复盘轮。一次循环允许判断 `no_change`，也允许撤下无益改动。

既有运行审计显示，复盘通常已指出 loop 成本，却没有产生针对该成本的可执行改动。仅复用 view、predictor、guard 等固定消费者又把可创作的流程形态限制为开发者预先命名的类型。因此本刀增加一条通用 loop mount：Agent 在 `tools/*.py` 的前 10 行写 `# mount: decision`、`# mount: action` 或两者，并定义 `on_event(state, event)`。组件内部可以自由实现信息表示、策略检查、预算提醒或其他任务流程逻辑；runtime 仅定义何时执行和允许的效果。固定控制核继续负责权限、版本、关卡作用域、执行时限、组件数量与环境动作边界；组件不能声明自己的权限或配额。`python_decision` 待决菜单不进入此循环，首版不做 bandit。

这项收窄不改变 meta 的目标。Agent 可以选择构建 level map、实验程序、策略约束，也可以选择更小的工具或 prompt 改动；开发者不预填这些答案。首轮先检验 Agent 是否能在运行中完成一次有证据的工作方式修改。

## 真实问题与可证伪命题

Claude 对既有日志完成了 E0 审计（[报告](../reports/2026-10-26-review-followup-audit.md)）：74 个 review turns、28 个 su15 runs，未启动新 run、未花 provider tokens。58/74 写了 review 文件；其中 46 次提到 loop 成本，但 0/46 随后有针对该成本的 Agent 可执行组件。22 个可测重复动作窗口中，review 前已知结果重放率为 31%，之后为 36%。这是单游戏、以 qwen 为主、人工语义标注且窗口可能重叠的诊断证据；它支持“诊断到可执行改动”是待测断点，不支持净收益结论。审计中的一个追踪案例显示 view 和 prose 规则仍未阻止后续动作，所以首个实验不以再加一个 state mount 作为主要因子。

**窄命题**：当既有复盘提供任务流程证据时，Agent 能否自主分析策略、信息表示、工具、规则和流程，选择一项最小改动并提出 EXPECT；runtime 能否追踪本轮改动的精确版本、由现有消费者自动交付并记录窗口内使用和任务事实，再由 Agent 决定保留、修订、撤下或 no_change。首轮检验完整转移是否可达，不以创建数、曝光数、调用数或 EXPECT 文字本身证明任务净收益。

目标负担是减少外部人员逐次分析日志和改 harness 源码、Agent 反复重读同一证据、复盘结论只留在文字里。反例包括：复盘没有识别流程问题、识别后不改、改动未被消费、消费后重复动作或总成本反而上升。合理 `no_change` 和放弃也记录。

## 一次运行内循环

| 步骤 | Agent 做什么 | Runtime 做什么 | 可见结果 |
| --- | --- | --- | --- |
| 诊断 | 在既有复盘里分析策略、信息表示、工具、规则、实验、检查和动作流程 | 推送通用 `LOOP AUDIT`：重复/无变化动作、预测命中/未中、组件运行与输出变化、坐标推理占比等 | Agent 自己指出机会、失败原因，或给出 `no_change` 理由 |
| 提出预期 | 说明要改什么及希望在多长窗口内看到什么变化 | 在单个待决 trial 中保存动作/关卡起点、复盘前后组件版本差异和 EXPECT | `EXPECT within N actions: ...` |
| 修改 | 用现有 `write/edit` 或 `python(save=)` 修改一个 Agent-owned 组件或 active rule/prompt；可写通用 `on_event` 回调 | 校验保存版本、level scope 和权限；按声明在决策或动作边界装配，不按症状映射预定组件类型 | 精确的组件路径/version 或明确记录纯策略变化 |
| 度量 | 根据后续动作及可用的环境反馈判断改动是否帮到任务 | 记录该版本被调用/展示、预测事实、动作结果及错误；下一次既有复盘推送窗口回执 | 有数据则给机械事实；样本不足或作用域结束则标 `unknown` |
| 决策 | 保留、修订、撤下，或说明尚需证据 | 执行已授权的保存/撤下，历史证据保留 | 下一次改动或结束本轮试用 |

EXPECT 是 Agent 对后续工作的可证伪预期，不是组件的授权来源。首版不增加通用 `check(t)` DSL；runtime 记录版本差异、现有消费者的调用/展示/预测结果和动作窗口事实，下一 review 交 Agent 判断语义。view/predictor/guard/tool 的实际语义仍由 Agent 编写；代码能运行或有预测命中不证明组件在全部状态上正确。没有适用样本或窗口被中断时记 `unknown`，不把无样本当成功或失败。

## 首阶段只需的改动

### E0：用既有运行做离线审计

**完成**：Claude 的审计报告已完成并直接作为基线证据引用；没有重复读取全部日志、没有 provider run 或 token 花费。报告明确了样本、窗口、口径与限制。它也指出 consult-first gate 造成 8 次 review 无法写文件、重复 `refine(focus)` 请求可能被重复发送；本刀不顺手修这两个相邻问题，避免混入第二因素。

E0 还核对实验基线和当前代码。E1 比较以 r04 `73cddb12` 为基线；r04-eff `00aad7cd` 含额外 action-efficiency 行为，作为独立参照，不混进 A/B。当前 meta-min-demo 的未提交 `python_decision` demo 不属于 E1 候选。

### M1：让 Agent 能在任务中改进自己的工作流程

1. **复盘出口**：既有 level/stall review 推送通用的流程证据；Agent 自行判断改进对象，也可合理 `no_change`。不新增 review 轮，不要求任务 Agent 阅读开发模板。
2. **通用挂载并兼容旧组件**：Agent 可写 `on_event` 选择决策/动作边界，也可修改现有工具/视图/预测器/guard/active prompt 与规则。Runtime 不替它推断语义或选组件类型；跨关组件降级为 stale/unconfirmed，动作准入仍只在环境调用前检查。
3. **单个候选闭环**：复盘前记录组件版本，复盘写入时关联本轮新增/改写/撤下的版本差异与 EXPECT。窗口内按精确路径/version 统计工具调用、view 交付、predictor 事实、guard 检查、mount 的决策交付及动作前检查，以及动作数/重复/无变化等事实。
4. **Agent 做决策**：下一次既有复盘展示版本、消费证据和窗口结果；Agent 通过 `DECISION: keep | revise | remove | no_change — <reason>` 收口。没有新改动时可直接记录 `no_change`。协议控制行从常驻 review prompt 中剥离。Runtime 不替 Agent 判 EXPECT 的语义真假，也不以“已创建/已调用”代替有效性。

首版只有一个 `on_event` 合同与两个既有运行边界，不建设六种组件分类、事件总线或调度器。`decision` 返回任意 JSON 可表示的值，runtime 在下一决策头自动展示（每组件 700 字符、总计 2400 字符）；`action` 返回 bool 或 `{allow, reason}`，拒绝时动作不进环境。一次至多运行按路径排序的前 4 个同阶段组件；动作阶段若超过上限则拒绝本次动作并报告超限，防止静默跳过检查。调用在只读 Python 隔离环境内执行，不能写文件或调用 `env.act`；单个回调最多等待 5 秒。版本在下一请求边界绑定；旧关卡组件不运行，索引标 stale。`action` 多组件以“任一拒绝即拒绝”组合，不由安装顺序决定准入。Agent 可以改写或移走文件来停用。一个 trial 同时只跟踪一个待决窗口。

这条接口允许自由编写组件内部逻辑与输出数据，但不允许组件改变 runtime 的执行边界、延长预算或自行代跑动作。发现必须改动新边界的真实需求时，再单独增加受授权效果；不能把“任意 Python 函数能运行”称为任意流程已开放。

### 文件落点与成本

| 位置 | M1 最小变化 |
| --- | --- |
| `src/autoresearch_pi/arc_thin_e2e.py` | 既有 review 提供通用流程审计与 Agent 自选改动/EXPECT/DECISION 出口；结果回到下一 review |
| `demo/arc_thin_components.ts`、`demo/arc_thin_binder.ts` | 解析并校验 `# mount:` / `on_event(state, event)`；保留保存 level/version，拒绝组件自授权与旧关卡执行 |
| `demo/arc_thin_native_runtime.ts`、`demo/arc_thin_extension.ts`、`demo/arc_thin_meta_trial.ts` | 在决策及动作边界调用同一通用回调，自动交付结果，记录精确版本和动作回执；将单个 EXPECT trial 的消费/环境事实回投下一复盘 |

新增成本包括既有 review 中的流程分析、试用组件本身的消费开销和日志；不增加 review 轮。在线评估须纳入父子 token、耗时、管理轮和任务结果。保存版本、消费者、作用范围必须可追踪；权限、预算和环境动作边界仍由控制核执行。

## 首阶段不预建的机制

M1 只定义单条 loop mount，不定义六类公共组件、完整事件总线、manifest、bundle CAS、状态数据库、动作租约、统一动作协调器、`probe` 执行器、bandit 或可替换软策略 owner registry。这些不是当前闭环成立的前置条件。

后续若 Agent 自己提出有界实验代跑、state/probe 等需求，再从具体请求设计一个挂载契约并单独验证。task-specific 地图或策略仍由 Agent 创建；本刀不向代码、prompt 或测试写入游戏特定线索。

## 有界评价与停止条件

E1 的首个探索样本已按用户授权运行：g50t、native、yibu `qwen3.8-27b`、thinking low、500k reported-token cap、60 actions / 1,800 seconds。run 在 353.2 秒、19,705 reported tokens 后以 `no_action_streak` 停止；3 个 decision、0 个动作、3/5 provider attempts 标为 failed、3 次 usage 不完整。Pi 的 provider 错误明确表示请求 `max_tokens=65536`，但当时只 afford 16,000；这是本次命令采用过高输出上限的配置错误。runner 原先把 credits/max-token affordability failure 当普通 provider refusal，继续重复请求；数值化的 affordability 文本略有变化，又使 same-error stop 未触发。代码现改为首个明确容量错误即以 `provider_capacity` 停止，并在 summary 中保留 requested/affordable token 数而不复制 provider key URL。没有 review、guard 写入或 guard 调用，故原样本不能评估 guard 的自主采用或收益；已知 usage 是下界，不是完整账单。见 [summary](../../runs/meta-loop-guard-qwen-g50t-20261026/summary.json)、[run config](../../runs/meta-loop-guard-qwen-g50t-20261026/run-config.json) 与 [request accounting](../../runs/meta-loop-guard-qwen-g50t-20261026/harness/request-events.jsonl)。下一次 Qwen run 的单次输出上限应设低于已报告 afford 值；重跑另计预算，不能把缺失 usage 当零。

每个样本报告：机会与合理不使用、诊断、改动、装配、实际消费者交付、后续决策证据、EXPECT 结果、关卡/任务进展、无变化动作、决策与环境动作数、父子 token/墙钟和管理轮。provider 拒绝、length、取消、超时和未知 usage 留在分母。E1 的小样本只判断闭环是否到达和早期质量线索；净收益需要另定预算的独立重复对照，任务进展与父子总成本共同判断。

若复盘持续只写 prose、保存后没有实际消费、下次复盘没有结果，定位对应断点后只改一个主要因素。若 Agent 在有机会时反复选择有理由的 `no_change`，不能靠强制创建提高指标。若试用造成更差任务进展或更高总成本，应撤下或修订该候选。是否有效由 Agent 依据实际证据决定；runtime 只给机械回执。

E1 第二次启动（2026-10-26）在 `max_output_tokens=15000` 下连到 yibu，但 3 个 parent 请求均因 proxy 不支持 `store: true` 被拒，0 环境动作、0 reported tokens、3 次 usage unknown。第三次在进程环境中显式设 `ARC_THIN_RESPONSES_CONTINUATION=0` 后仍失败；检查发现 runner 会按解析出的 `settings["pi_api"]` 覆盖这个变量，而干净 worktree 没有 `.env` 中的 `ARC_PI_API` 配置，`models.json` 实际使用 `openai-responses`。因此需在下次启动前显式令 runner 使用 `ARC_PI_API=openai-completions`（同时保留 `thinking-format=qwen`），让 runner 自己关闭 continuation；只直接覆写 continuation 变量无效。第二、三次启动各有 3 个 failed parent requests，usage 均未知，不能当作零或从 500k cap 中精确扣除；追加预算内已停止重试。证据：[second rerun summary](../../runs/meta-loop-guard-qwen-g50t-rerun-20261026b/summary.json)、[third rerun summary](../../runs/meta-loop-guard-qwen-g50t-rerun-20261026c/summary.json)、[third run model config](../../runs/meta-loop-guard-qwen-g50t-rerun-20261026c/.pi-agent/models.json)、[third request accounting](../../runs/meta-loop-guard-qwen-g50t-rerun-20261026c/harness/request-events.jsonl)。

第四次运行使用了正确的 `ARC_PI_API=openai-completions`，请求均正常返回并有用量记录；但 run cap 有执行边界缺陷：`max_reported_tokens` 只在决策开始时检查，一次决策内可以连续发出多个 provider 请求，越过 500k 后仍继续。中止前 `usage.jsonl` 的 20 个已结算请求累计 `input+output=542,971`，已超过授权 cap 42,971；另一个在途请求在中止时 usage 未结算，成本未知。运行中已有 4 个决策、6 个环境动作；因中止没有生成 summary/终局判定。bridge 已退出。证据：[fourth run config](../../runs/meta-loop-guard-qwen-g50t-rerun-20261026d/run-config.json)、[usage](../../runs/meta-loop-guard-qwen-g50t-rerun-20261026d/harness/usage.jsonl)、[request events](../../runs/meta-loop-guard-qwen-g50t-rerun-20261026d/harness/request-events.jsonl)、[session](../../runs/meta-loop-guard-qwen-g50t-rerun-20261026d/session.jsonl)。此 cap 执行问题需先修复并做无付费验证；在此之前不应继续真实 provider 运行。

从 **meta 闭环** 而非 ARC 解题效果看，这个样本的证据是：出现了“反复解析网格、一个方向动作未产生预期变化、继续重推导”的潜在机会；Agent 把它处理成任务内模型修正和临时 memory 写入，没有提出“需要一个可复用 map/验证组件”的 meta 诊断或预期，没有保存/装配该组件，也没有后续消费、度量与保留/撤回决策。`workspace` 只有 `data/`，没有 Agent 创建的 tools/skills；`memory.md` 显示 `STRATEGY: none`、`GOAL CHECKS: none`。不过本次动作仅 6 个，未触发设为 40 actions/level-change 的 stall/level review，因此它不能证明既定 review→候选→guard 的闭环在有效触发机会下失败；它能说明普通任务轮中没有观察到自发启动 high-level meta。一个 auto-refiner 以 `length` 结束且回复为空，不算 Agent 发起并完成的 meta change。预测账本只核对结构化 `level_changed`，没有核验文字中的位置/格数预期，因此也没有形成可信的改前/改后效果度量。该样本只覆盖“是否在普通轮自发进入 meta”这一点，完整 meta 闭环、装配后消费与收益仍未验证。

## 变更记录与证据状态

- **机会与负担**：74 review-turn audit found 46 loop-cost diagnoses and 0 matching executable components; no new runs or provider tokens. Limits: one game, mostly one model, semantic labels, overlapping windows.
- **窄命题**：既有复盘能否让 Agent 自行分析策略/机制/流程、改变一种既有组件或规则，并走通版本化消费、度量和 Agent 决定。
- **选择与取舍**：开放一条通用 `on_event` loop mount，Agent 自选决策或动作边界和内部逻辑；只跟踪一个待决 EXPECT trial。不新增六类 mount 清单、probe 执行器、bandit 或独立 `check(t)` DSL。
- **权限与失败**：复用各组件既有权限与 level scope；guard 只能返回允许/拒绝，不能执行动作或改配额。错误沿组件当前失败合同返回，版本和历史保留。
- **比较与预算**：审计为离线既有日志；E1 需单独预算授权，本轮未跑 provider、未花 token。
- **四层证据**：本轮将 trial 扩展为通用组件/流程证据后尚未运行测试；真实 ARC/Pi 全链路可达、真实 provider 自主采用、净收益均**未验证**。离线审计或 deterministic smoke 不提升后两层；若声称 Auto-Research → task-local self-harness 闭环，还须通过仓库规定的 `arc-harness-smoke` 五类组件及两类 `length` continuation。
- **本轮结果**：E0 审计已归档。本轮把复盘诊断从 guard 单项扩展到策略、表示、工具、规则、实验、资源使用与动作流程；EXPECT trial 绑定复盘期间组件版本差异。新增一条可写入 `tools/*.py` 的通用 loop mount，决策结果自动进入后续头部、动作检查进入原动作准入边界、精确版本消费进入下一复盘。当前尚未运行本次修改的功能检查、smoke 或真实 provider；全链路、自主采用和净收益均未验证。先前 g50t Qwen run 的证据和 cap 问题见上方运行记录，不能据它声称新 mount 被采用。整个 components 测试文件另有一个非本改动失败：session restore 用例实际报告 `Writer` 与 `Bad` 两个拒绝定义，而断言只预期 `Bad`；本次改动没有触及该代码路径。

关联 [deferred-research-todos](../deferred-research-todos.md) 中的研究到行动、父子总成本和跨阶段认知连续性，均保持开放。本文档是开发记录，不进入 Pi 任务 Agent 的游戏上下文。

## M2：两个 self-harness 共用的在线试用闭环（2026-10-26）

**真实断点**：M1 的 `on_event` 能在决策和动作边界运行，但普通任务轮保存的组件不会进入 EXPECT trial；只读回调无法随动作维护组件自己的状态；`measured` 只代表窗口有动作，`DECISION` 仅写日志。这些断点使任务内知识组件与 high-level 流程组件都无法在普通运行中完成可信的“修改→反馈→决定”。原始 74-review 审计的 0/46 可执行后续仍是机会基线；新挂载路径尚无真实 provider 采用证据。

**窄命题**：若 Agent 在普通任务或复盘中，自主保存一个带可证伪 EXPECT 的版本化 Python 组件，runtime 能以同一合同自动打开唯一试用、在决策/动作/动作后消费该精确版本、保持有界组件局部状态、用环境实际回执核对 Agent 指定的具体字段，并把消费与反证送回下一正常决策；Agent 的 keep/revise/remove 只在文件版本与选择一致时结案。组件可以沉淀任务内理解，也可以改变工作流程，runtime 不替 Agent 选类别或价值判断。

**减负与首次获益**：Agent 一次 `python(save=)` 或 `write` 可同时创建组件并写 `# EXPECT within N actions: ...`；无需先等 40 动作复盘或另开工单。runtime 自动执行、记账和回投。下一次正常决策可用同一 Python cell 做改动及决定，不增加专门复盘轮。必要的权限、精确版本、关卡与环境边界不省略。

**最小效果合同**：`# mount: decision, action, feedback` 可按需声明；`on_event(state,event)` 获得 `event.local`（该路径/版本/关卡的私有 JSON 状态）。`decision` 可返回自由 JSON 上下文；`decision`/`feedback` 可返回 `next_local` 供 runtime 持久化；`action` 仍返回 `allow`，可选 `expect_next: [{path, equals}]`，runtime 在桥接动作实际返回后对规范化观测做精确字段比对。字段比对只是独立矛盾信号，不证明组件语义或任务收益。配额、只读执行、最多四个挂载组件及动作边界继续由控制核负责。

**负例与停止**：没有 EXPECT 的普通组件照常可用但不自动称为试用；没有组件消费或真实动作时结论 `unknown`；字段不存在、版本变化、关卡变化、回调错误、配额超限或环境失败均留原始回执；多组件没有隐式胜者。`remove` 未真正撤下、`revise` 未出现新版本、`keep` 不在候选版本时不结案。若普通任务仍无 Agent 自发候选，结论是识别/采用断点，不用提示词制造成功。无付费功能与接线检查只证明代码路径；真实 provider 自主采用与净收益需另定用户授权预算。

**评价**：首个功能检查覆盖普通轮开试用、恢复后局部状态、动作前预测与真实回执比对、无消费 unknown、决定核验和旧关卡失效；接线检查需生产 Pi/bridge 加脚本 provider。真实 provider 探索样本报告机会分母、创建、装配、决策中实际交付、后续动作改变、父子 token/耗时及任务结果；净收益另用匹配预算对照。四层证据在执行前仍均为未验证。

### M2 实施与验收（2026-10-26）

- **实现**：普通轮保存带 `# EXPECT` 的单个 `tools/*.py` 候选即开启试用；`decision/action/feedback` 共用 Agent 编写的 `on_event`，私有 `event.local` 按路径、版本、关卡持久化。`action` 的 `expect_next` 由 runtime 对桥接动作后的实际字段比对，匹配/缺失/冲突及精确版本进 `mount_checks.jsonl`。下一正常决策自动收到组件上下文和试用事实；`env.meta_decide` 在窗口结算前拒绝决定，结算后按当前文件版本核对 keep/revise/remove；若修订版仍带 EXPECT，`revise` 结案时立即以新版本开启下一轮。复盘出口继续存在，同一时间仅一项待决试用。
- **功能正确：通过所测路径**。`arc_thin_meta_trial` 与 `arc_thin_native_runtime` 定向测试合计 10/10；`arc_thin_components` 的通用挂载目标测试 1/1；level/stall review 提示测试 9/9。覆盖字段比对、版本选择、旧关卡过滤、局部状态恢复、只读挂载及 `meta_decide` 禁止在只读环境使用。整个 components 文件仍有先前记录的 session restore 断言失败（`Writer` 与 `Bad` 均被拒绝，旧断言只期待 `Bad`），与本轮挂载路径无关。
- **全链路可达：脚本化验收通过**。[本轮 summary](../../runs/meta-loop-online-smoke-20261026c/summary.json)、[trial ledger](../../runs/meta-loop-online-smoke-20261026c/harness/meta_trials.jsonl)、[独立字段比对](../../runs/meta-loop-online-smoke-20261026c/harness/mount_checks.jsonl)、[session](../../runs/meta-loop-online-smoke-20261026c/session.jsonl)。生产 runner/Pi/bridge/native mutation 接脚本 provider 与 mock ARC SDK：普通决策保存 v1；过早 `keep` 获明确拒绝；随后动作前检查、动作后 feedback 各运行一次；实际 `state=PLAYING` 与候选预测 `IMPOSSIBLE` 不符；下一决策收到挂载上下文与试用事实，Agent 脚本选择 `keep` 后通过版本核验。Trial 窗口为 1 动作，结算事实含 1 次 action mount、1 次 feedback 和 1 次字段冲突；run 共 2 个决策、2 个环境动作，第二动作是脚本结束后的 runner 后续动作，未计入 trial。`passed=true` 只表示此脚本化验收路径没有 harness 错误。
- **修订链路：脚本化验收通过**。[修订 summary](../../runs/meta-loop-revise-smoke-20261026/summary.json)、[版本 trial ledger](../../runs/meta-loop-revise-smoke-20261026/harness/meta_trials.jsonl)、[字段比对](../../runs/meta-loop-revise-smoke-20261026/harness/mount_checks.jsonl)：v1 的预测冲突后，脚本 Agent 将文件改为 v2 并选择 `revise`；旧 trial 结案，v2 的 EXPECT 不经额外保存即开启 m2；下一环境动作对 v2 给出一次字段匹配，m2 结算。脚本到预算末端，没有让 Agent 再决定 m2 去留，因此该运行只验收到修订版度量，完整关闭以上一条 keep 路径为准。
- **自主采用：未验证**。脚本 provider 明确选择创建、动作和保留，不代表真实 Agent 会识别 high-level 改进机会、创建 level map 或以证据合理修订。前述 Qwen 样本在 6 个动作内也未到复盘机会，不能代替此层。
- **净收益：未验证**。未做真实 provider 的匹配预算对照；挂载回调和试用上下文有执行、延迟和 token 成本，当前不能声称任务质量或效率提高。下一证伪检查需在新获授权预算内固定机会、模型、对照和父子总成本，观察普通任务中候选是否自主出现、是否实际影响后续决策及动作，并完整保留合理不使用和负例。
