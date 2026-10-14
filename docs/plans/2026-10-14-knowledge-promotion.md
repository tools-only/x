# Meta-harness 变更记录：认识的分层存放与晋升/降级规则（长程任务）

日期：2026-10-14（Asia/Shanghai）。状态：第 1 轮实现（分支 `claude/promote-20261014`，基于 c82e3dd0 = kernel 分支 + tc-02 配置文档）；功能检查进行中，真实运行未做。
按 [开发流程](../development-workflow.md) 使用。分支 `claude/kernel-20261014`。关联：[token 开销循环](2026-10-14-token-cost-loop.md)（运行配置的前提）、[可证伪 self-harness 计划](2026-10-12-falsifiable-self-harness-plan.md)（`check(t)` 的来源）、[延后待办 D](../deferred-research-todos.md)（压缩后的认知连续性）。

## 问题与命题

### 真实失败（2026-10-14，ls20，yibu/qwen3.8-27b，thinking high）

- 认识只住在两处：每个决策 2–5 万字符的 reasoning（决策结束即丢弃），和一条被反复整体改写的 memory 事实。tc-01：`ls20-mechanics` 一个 key 写了 5 次；kernel-02：4 条事实。两次运行 hypotheses 写入 0、strategies 写入 0，尽管 `data/memory.md` 每个决策都显示 "HYPOTHESES: none — keep 2-4 competing ones per question"。
- 已被反复验证的规则没有被固定下来：tc-01 的 7 次 `arc_action` 预测（"A1 = 上移 5"等）全部命中，但这一认识只存在于改写中的文本里，下一个决策的 reasoning 仍在重述它。
- 目标从未以可检验的形式存在：tc-01 在"进入上方框"与"走到十字"之间来回切换，每次覆盖前一版文本，没有记录"十字是目标"与"十字改变某物"两个对立解释，也没有区分它们的检验。kernel-02 最后一步踩到十字，左下框的图形变成与上方框相同（帧 9→10 的 8 个 cell，`tmp/arc-kernel-20261014/kernel-02-frame-9-10.txt`），这一变化没有被任何载体捕获（动作额度已用完）。
- 唯一一次结构性沉淀来自 refiner：tc-01 中 41% 的 reasoning 句子在定位坐标，refiner 写了 view 工具 `tools/track.py`。说明"由 runtime 计数、由 refiner 写入"这条路径在真实运行中可达。
- 但持久化之后没有被有效调用：`track.py` 从决策 7 到 11 每次自动运行的输出都是 `null`（`runtime-audit/provider-inputs.jsonl` 第 13–23 个请求："track v1 state #6: null" … "#9: null"），没有任何环节发现它无输出。对照：kernel-02 中 agent 在决策 2–5 稳定复用 `PYTHON SESSION` 列表里的名字（`diff`、`g0`、`motif_pos`），却从未调用任何保存的组件。持久化与调用是两个独立的断点。

### 已有机制（复用，不重建）

| 机制 | 位置 | 现状 |
| --- | --- | --- |
| memory：facts / hypotheses（question、claim、predicts、status、evidence、可选 `check(t)`）/ strategies（depends_on） | `demo/arc_thin_memory.ts` | 有，agent 几乎不用结构化部分 |
| `check(t)` 在全部已记录转移和每个新转移上运行，结果按 key、版本、关卡存为 runtime 证据 | `demo/arc_thin_claims.ts`、`claim_checks.jsonl` | 有，`summarizeClaim` 已按关卡分计 |
| `arc_action` 的 `predict` 评分 | `scorePrediction` | 有，与 hypothesis 无关联（`arc_action` 保持干净，不加 memory 字段） |
| refiner：事件触发（关卡变化、重复计算、无目标检验、坐标推理占比、每 15 动作）、一次一个编辑、经 binder 版本化、下一请求生效 | `demo/arc_thin_refiner.ts`、`arc_thin_extension.ts` `refinerTriggers` | 有；`prompts/strategy.md` 的 Rules / Open questions / Next experiment / Failure modes 混在一个 1,500 字符文件中 |

缺的是：从"说过的认识"到"有检验的假设"的转换者；以检验计数为依据的晋升/降级；以及按寿命分开的存放位置。

### 窄命题

在 agent 不承担任何新义务（不加字段、不加必填步骤、不加提示门禁）的条件下，runtime 机械地统计 `check(t)` 结果并在事件处触发 refiner，refiner 把 agent 已陈述的认识写成带检验的假设、把检验通过的假设晋升为常驻规则、把失败的规则降级，则在 ≥ 30 动作的运行中：

1. 已确立的规则在其后的决策中以常驻文本出现，agent 的 reasoning 不再重述它们（重复推理下降）；
2. 目标以至少两个对立假设及其区分性检验存在，关卡变化或未变化会自动给它们计分；
3. 已保存的组件在适用时被调用（或自动运行且输出非空），覆盖下的重算次数下降；
4. 上述成立时，每决策输出 token 不升，refiner 成本 ≤ 父代理 token 的 10%。

- 减少的负担：跨决策重新推导已确立规则；在一条改写中的文本里维护全部认识；agent 自己做簿记（Prime 报告的"模型不擅长管理保留的信息"）。
- 推翻条件：规则常驻后 reasoning 中对同一规则的重述不降；或 refiner 写出的检验多数是空洞的（对任何转移都成立）或错误的；或 refiner 成本超过上限而重复推理不降；或 agent 的动作选择因错误晋升的规则而偏离且未被降级纠正。
- 范围及非目标：不改推理模式（thinking 级别与决策内 reasoning 保留）；不在 harness 中写任何游戏内容（规则文本由 refiner 依据本局证据写入工作区，属于任务局部产物）；不给 `arc_action` 加字段；不加新 worker 或常驻子代理；跨游戏的全局记忆（Prime 的 global scope）不在本次范围。

## 设计

### 1. 按寿命与形式分层存放

| 层 | 存什么 | 载体 | 作用域 | 寿命 | 谁写 |
| --- | --- | --- | --- | --- | --- |
| 规则（新） | 已由检验确立的机制与已确认的目标 | `prompts/rules.md`（active prompt，每决策常驻，≤ 1,500 字符，每条带出处） | 本局游戏 | 直到被反驳 | refiner（由晋升触发） |
| 开放问题 | 对立假设、预测、区分性检验、`check(t)` | memory hypotheses（已有） | 一个问题 | 直到判定 | agent 或 refiner |
| 关卡事实 | 布局、位置、障碍 | memory facts（已有），按写入时关卡标注 | 一个关卡 | 关卡变化后折叠显示 | agent 或 refiner |
| 程序 | 寻路、定位、区域比较 | tools / lib（代码），操作说明用 skill（已有） | 本局游戏 | 使用期间 | agent 或 refiner |
| 当前计划 | 下一实验、步骤 | `prompts/strategy.md` 只保留 Open questions / Next experiment / Failure modes（Rules 移到 rules.md） | 当前目标 | 短 | refiner 或 agent |
| 原始观测 | 帧、差分、轨迹 | `data/`、`history.grid(n)`（已有） | — | 不常驻 | runtime |

把 Rules 从 strategy.md 拆出：两者寿命不同（规则很少变，计划常变），合在一个文件里时每次改计划都重写规则，也让规则受计划的字符预算挤压。

### 2. 晋升与降级规则（runtime 计数，refiner 写入）

| 规则 | 条件（机械，可在 `claim_checks.jsonl` 上计算） | 结果 |
| --- | --- | --- |
| R1 陈述 → 假设 | 一条 memory 事实被同一 key 改写 ≥ 3 次，或已执行 ≥ 8 个动作而没有任何带 `check` 的假设 | 触发 refiner："把 agent 已陈述的认识写成带 `check(t)` 的假设"（每次一条，优先最常被重述的） |
| R2 假设 → 规则 | 当前版本的 check：holds ≥ 4、fails 0、覆盖 ≥ 2 个决策，且通过空洞性检验（R7） | 触发 refiner 把它写成 `rules.md` 的一行，引用假设 key 与计数；假设标为 supported |
| R3 关卡作用域 | 规则在 ≥ 2 个关卡上 holds 且 fails 0 | 规则行标为"跨关卡"；只在一个关卡成立的规则在关卡变化时标为"仅第 N 关" |
| R4 目标 | 目标假设以"level_changed 为真当且仅当 X"的 check 表达；`level_changed` 发生时 check 为真 → 晋升为目标规则；check 为真而关卡未变 → 记为反例 | 已有的"无目标检验"触发保留；新增：关卡变化后由 refiner 把命中的目标假设写入 rules.md |
| R5 规则 → 争议 | 已晋升规则的 check 在新转移上返回 False | 下一请求起 runtime 在该规则行后机械追加"contested at #n"（不删）；触发 refiner 修订；依赖它的 strategy 按已有逻辑挂起 |
| R6 容量 | rules.md 超过 1,500 字符，或 hypotheses 达到 `MAX_HYPOTHESES`（8） | 触发 refiner 合并，而不是截断 |
| R7 空洞性检验 | 把 check 运行在错配的转移上（某一转移的前一帧配另一转移的后一帧、或替换动作名）；若全部仍为 True，则该 check 不区分任何东西 | 不晋升；在假设下显示"check holds on unrelated moves" |

R7 是通用的反证手段，不依赖游戏内容：一条真实的转移规则应在错配的数据上至少失败一次。

### 3. 时机与成本（Prime 的回合边界 + Continual Harness 的事件触发）

- 只在事件处触发（R1、R2、R4、R5、R6 和已有事件），不新增固定时钟（与 2026-10-14 的决定一致）。
- 每个决策最多一个 refiner 调用（已有的 in-flight 限制）；同一触发去重；refiner 总 token 超过父代理 token 的 10% 时，只保留 R5（反驳）与关卡变化两类触发。
- 编辑经 binder 版本化，在下一个请求生效，agent 被告知一次（已有）。
- agent 仍可随时 `refine(focus)`。

### 4. agent 侧不变

- 不加字段、不加必填步骤、不要求先写假设再行动（开发流程第 6 节："不设强制成本表或固定晋升流程"——晋升流程放在 runtime 与 refiner，不放进 agent 的义务）。
- system prompt 只在能力说明中加一句 `prompts/rules.md` 的含义（约 120 字符）；`memory.md` 中"HYPOTHESES: none — keep 2-4…"的催促句删除（它出现在每个决策且两次运行都未产生效果，由 R1 的 refiner 转换取代）。

### 5. 持久化之后的调用

按调用成本把载体分两类，分别处理：

| 类 | 载体 | 被用到的方式 | 主要风险 |
| --- | --- | --- | --- |
| 无需调用 | rules.md（常驻）、view（每个新状态自动运行）、`check(t)`（每次转移自动评估） | 输出直接出现在下一请求 | 输出坏了没人发现（tc-01 的 `track.py` 连续 9 次 `null`） |
| 需要调用 | tools、skills、subagents、lib 函数 | agent 决定调用 | 存在但不被调用，agent 继续重算 |

机制：

- **I1 装配前试运行（R8）**：新建或更新的 view/tool 在装配时由 runtime 在当前状态上运行一次；输出为空、`null` 或报错时不激活，把输出与错误作为下一次 refiner 调用的触发与输入。view 激活后连续 3 个状态输出为空，同样回到 refiner。机械判定，不判断语义对错。
- **I2 在 agent 已在用的通道里出现**：kernel-02 证明 agent 会用 `PYTHON SESSION` 列表里的名字。把已保存的 tools/lib 函数和已晋升规则的 check 作为可调用名字放进 python 会话（Prime：skill 即 REPL 中可 import 的代码），并在同一列表中各占一行（名字、一句用途、版本）。调用它们就是写一行代码，不需要新的工具调用往返。
- **I3 需要时提示一次**：runtime 已能识别"重算一个已有组件覆盖的计算"（`repeatedWork` 的 covered 分支，目前只触发 refiner）。改为在那次 python 结果末尾追加一行"`tools/x.py` 计算这个：`x(...)`"，每个组件每关最多一次；不另花模型调用（Prime：变化在下一个工具结果中到达）。仍未改用时才触发 refiner。
- **I4 动作时的规则反馈**：动作回执已有预测评分；追加一行"rules: 已晋升规则在本次转移上 held N / failed M"（只在有规则时）。规则在每一步都被看到并被核对，失败立即可见（与 R5 衔接）。
- **I5 调用账本与退役**：每个组件记录：装配、展示次数、调用次数、非空输出次数、覆盖下的重算次数（miss）、首次调用距装配的动作数。有 ≥ 3 次适用机会（miss 计数）而 0 次调用，或输出持续为空的组件，触发 refiner 修复或移到 `_off/`，让常驻列表保持短。

这些都不新增 agent 义务；I3、I4 每次最多一行常驻文本。

## 生命周期与责任

| 转移 | 推进者 | 可观察输入 | 完成证据 | 失败/停止 |
| --- | --- | --- | --- | --- |
| 机会 → 识别 | runtime | memory 改写次数、claim 计数、关卡变化 | `refiner.jsonl` 的触发行 | 预算上限时只保留 R5/关卡 |
| 识别 → 候选 | refiner | 触发、memory、轨迹样本、已有 checks | 新假设（含 check）或 rules.md 新版本 | NONE 回复记录理由；无效回复不应用 |
| 候选 → 装配 | binder + runtime | 版本、编译（check 编译失败已有处理）、I1 试运行 | 下一请求的 working set 或 python 会话列表含新条目，且试运行输出非空 | 编译失败或输出为空不激活，回到 refiner |
| 装配 → 语义使用 | agent（I2、I3、I4 降低调用成本） | 常驻规则、会话列表中的组件名、重算时的一行提示、动作回执中的规则计分 | 组件被调用且输出被后续 reasoning/动作使用；reasoning 不再重述规则 | I5：机会 ≥ 3 而 0 调用 → refiner 修复或退役 |
| 使用 → 反馈 | runtime | 每个新转移上的 check | `claim_checks.jsonl` | — |
| 反馈 → 保留/修订/撤下 | runtime 标注 + refiner 修订 | R5、R6 | rules.md 新版本或 contested 标注 | 错误晋升未被纠正即推翻条件 |

首次获益路径：0 个额外 agent 决策。refiner 调用是额外成本，按上限计。

## 新增与移除

- 新增：`prompts/rules.md`（refiner 所有，常驻 ≤ 1,500 字符）；runtime 的晋升/降级计数与 4 个新触发（R1、R2、R5、R6）；R7 空洞性检验（在已有 claims 沙箱中多跑一批错配转移）；rules 行的 contested 标注。
- 移除：strategy.md 的 Rules 部分；`memory.md` 中关于写假设的常驻催促句。
- 不变：`arc_action` schema、memory schema、推理配置、权限与版本检查。

## 运行前实验协议

- 目标证据层级：功能正确 → 全链路可达（确定性 smoke）→ 自主采用（这里指 refiner 与 agent 在普通运行中走完路径）→ 净收益（仅探索性）。
- 阶段 0（离线、免费）：在 tc-01、kernel-02 的已记录轨迹上回放：用测试夹具中的 check（不进入 harness）验证 R2 计数、R3 关卡分计、R5 争议标注、R7 对 `return True` 的检出；refiner 回复解析与 rules.md 生成用脚本化 provider。另加 smoke 场景覆盖 R1→R2→R5 全链路。
- 阶段 1（真实、探索）：比较器为同一分支关闭本机制（refiner 与已有触发照常）。游戏 ls20 与一个未用于设计的游戏（ft09），每臂每游戏 1 次，30–40 动作（10 动作的上限会主导计划，见 tc-01），yibu/qwen3.8-27b、thinking high、其余同 token 循环最终配置。
- 预算估计：按 tc-01 约 3.3 万预算 token/动作，40 动作约 130 万/次，阶段 1 四次约 500 万预算 token；运行前请用户确认预算。provider 或 ARC 环境故障的运行作废重跑，不计入。
- 主要指标：
  - 漏斗：被陈述的认识（外部审阅转录计数）→ 带 check 的假设 → 晋升 → 被使用（后续 reasoning/动作）→ 被反驳；空洞 check 数；错误晋升数（外部审阅）。
  - 调用：每个组件的装配→展示→调用→非空输出→输出被使用；覆盖下的重算次数（miss）；首次调用延迟（动作数）；空输出的 view 被发现所需的状态数（tc-01 为"未发现"）。
  - 重复推理：reasoning 中重述已晋升规则的句子比例（按规则关键词与坐标模式统计，另做人工抽查）；每决策 reasoning/输出 token。
  - 成本：refiner token 占比（上限 10%）；每请求非 reasoning 输入（rules.md 常驻增加约 400–500 token）。
  - 任务：关卡数、目标假设是否成对存在并被检验。
- 判定：阶段 1 只作探索。若晋升路径走通且重述比例下降、成本在上限内，再做每臂 ≥ 3 次的确认对照；若 refiner 写出的 check 多数空洞或错误，先修订 R1 的转换提示，不扩展机制。
- 负例：没有可检验规则的早期决策（不应触发晋升）；规则在新关卡失效（应降级而非删除）；agent 自己写了假设（refiner 不重复转换）；预算接近上限（只保留反驳与关卡触发）。

## 实现顺序（确认后）

1. runtime：claim 计数的晋升/降级判定与 R7 错配检验（纯函数 + 单测）；I1 试运行与 I5 调用账本。
2. refiner：新触发与 rules.md 的写入格式；strategy.md 去掉 Rules 部分；`memory.md` 去掉催促句；system prompt 一句。
3. 调用通道：I2 把已保存组件与规则 check 放入 python 会话及其列表；I3 重算时的一行提示；I4 动作回执中的规则计分。
4. smoke：新增场景覆盖 R1→R2→R5、R7、I1（空输出 view 不激活）与 I3（重算后提示出现）。
5. 阶段 0 回放，然后按预算进入阶段 1。

## 实现（第 1 轮，2026-10-14）

用户要求：持久化尽量经由 harness 组件实现，避免独立的临时存储。据此：

| 设计项 | 实现 | 持久化载体 |
| --- | --- | --- |
| R1 陈述 → 假设 | `promotionEvents`（`arc_thin_extension.ts`）：事实 key 被写 ≥ 3 次（`ARC_REFINE_BELIEF_REWRITES`）且无带 check 的假设，或 ≥ 8 动作无带 check 的假设（`ARC_REFINE_UNCHECKED_AFTER`）→ refiner；refiner 新增 `HYPOTHESIS` 回复形式（`arc_thin_refiner.ts`），经 `planNativeMemoryUpdate` 写入 | memory 组件（hypothesis + check） |
| R2 假设 → 规则 | `promotionView`（`arc_thin_claims.ts`）：当前版本 check holds ≥ 4、fails 0、无 error、非 rejected、通过 R7 → refiner 写 `prompts/rules.md` | prompt 组件（binder 版本化，active 时进入 system） |
| R3 作用域 | 只在触发文本中报告跨几个关卡成立；未做关卡标签 | — |
| R4 目标 | 未单独实现：目标假设用同一 check 机制（`t['level_changed']`）；refiner 提示要求目标规则只在关卡变化确认后写入 | — |
| R5 规则 → 争议 | 被 rules.md 引用的 key 的 check 出现 False → refiner 修订；不由 runtime 改状态或改文件（"判断归 agent/refiner"） | prompt 组件新版本 |
| R6 容量 | rules.md > 1,500 字符 → refiner 合并 | prompt 组件 |
| R7 空洞性 | `controlSegments`：把一次移动前的网格与另一次（结果不同的）移动后的网格配对、沿用前者的动作，最多 6 对；在已有 claims 沙箱中运行；没有任何一对返回 False 的 check 不晋升。结果作为 `claim_checks.jsonl` 中 `control: true` 的行保存 | 已有的 claims 证据存储 |
| I1 空输出 view | `NativeRuntime.emptyViews()`：view 连续 ≥ 2 个状态输出为空（None、空串/容器、无输出脚本）或报错 → refiner 修复或退役。偏离设计：不在装配时拒绝激活（需要改 binder 状态机），改为尽早触发修复 | tool 组件新版本 |
| I2 组件进入 python 会话 | 未实现（改变 kernel 命名空间，需与 checkpoint 恢复一起验证），留待下一轮 | — |
| I3 重算提示 | `coveringComponent`（`arc_thin_reuse.ts`）：本次 python 调用所属计算已出现 ≥ 2 次且有组件覆盖 → 在这次结果末尾加一行，每组件每关一次；记录 `component_runs.jsonl` 的 `cover_hint` | 无新存储 |
| I4 规则反馈 | working set 新增 `rules` 段："RULE CHECKS (prompts/rules.md) on #n: N held, failed: …"（只在 rules.md 引用了 key 时出现）；放在 working set 而不是 system，避免每步改写 system 前缀 | — |
| I5 调用账本 | 未单独实现；`cover_hint`、`observer_runs.jsonl` 与已有 `component_runs.jsonl` 提供原始计数，汇总留待报告脚本 | — |

其他偏离与更正：
- 设计中说 `memory.md` 的"HYPOTHESES: none — keep 2-4…"出现在每个决策——更正：native 模式的 working set 用 `renderDecisionMemory`，不含这句；它只在 `data/memory.md` 文件与 refiner 输入中。因此未删除。
- R2 的"覆盖 ≥ 2 个决策"条件未实现：新写的 check 会立即在全部已记录转移上运行，历史转移本身就是真实证据。
- 一次 refinement 只做一个编辑，因此每次只提出一个晋升事件（顺序：争议、候选、陈述→假设、空 view、容量），已提出的不再重复；其余在后续 refinement 中提出。
- system prompt：Prompt 能力说明中 strategy 改为"open questions, next experiment, failure modes"，并加一句 rules.md 的含义；refiner 提示中 strategy 去掉 Rules 部分。
- 测试：[tests/arc_thin_promotion.test.ts](../../tests/arc_thin_promotion.test.ts)（晋升判定、负例、争议、容量、控制对、HYPOTHESIS 解析、空输出判定、覆盖提示）；确定性 smoke `promotion` 场景（`tools/arc_thin_smoke_provider.ts`、`tools/run_foundation_smoke.py`）在 mock 游戏上走 R1→R2→R5 与 I3。
- 成本上限：refinement 的预算 token（未缓存输入 + 输出）超过父代理的 10%（`ARC_REFINE_MAX_SHARE`）且超过 20,000（`ARC_REFINE_MIN_TOKENS`，运行早期一次调用就占很大比例）后，只有关卡变化与"规则争议"还会启动 refinement，其余触发记为 `refiner.jsonl` 的 `over_budget` 行；agent 自己的 `refine(focus)` 不受影响。
- I3 之后，被组件覆盖的计算不再在第 2 次重打时触发 refinement（`repeatedWork` 只保留"重做 ≥ 3 次"）：第 2 次先在结果中提示，仍重打时才请 refinement，避免为同一件事既提示又花一次模型调用。
- `activation` smoke 设置 `ARC_REFINE_UNCHECKED_AFTER=1000`：该场景检查其他 refinement 事件，"无带 check 的假设"事件由 `promotion` 场景检查。

验证（mock ARC SDK、真实 bridge、真实 Pi、WASI、脚本化 provider）：
- `tests/arc_thin_*.test.ts`：161 项中 155 通过；6 项失败中 5 项是基线既有失败（与 kernel 记录相同），另 1 项 `installed Pi sends current action enums…` 在全量运行中 20 s 超时、单独运行通过（与 kernel 分支上的现象相同）。
- smoke `promotion`（`tmp/smoke-promotion-7`，成本上限加入后重跑）通过：`refiner.jsonl` 依次为 "memory belief.move was rewritten 3 times…" → `memory:hyp.right`；"hyp.right held on 4 recorded moves… candidate rule" → `prompts/rules.md` v1；`#8` 处 check 失败 → "the rule is in dispute" → `prompts/rules.md` v2。控制对 4 个全部 False（check 有区分力）；规则行进入之后的 system prompt；working set 出现 `RULE CHECKS`；第 2 次重打 `grid[3].index(9)` 的结果含 "tools/nine.py already computes this"。
- 回归 smoke：`activation`、`activation defaults`（成本上限加入后重跑：`tmp/smoke-promote-activation-defaults4`；第一版上限在脚本化 provider 的极小 token 数上误触发，因而加了 20,000 的下限）、`foundation`、`foundation defaults`、`receipts` 均通过。

| 证据层级 | 状态 | Provider / environment | 产物及结论边界 |
| --- | --- | --- | --- |
| 功能正确 | 通过 | node:test + WASI claims 沙箱 | `tests/arc_thin_promotion.test.ts`；不涉及模型行为 |
| 全链路可达 | 通过（确定性） | mock ARC SDK、真实 bridge/Pi/WASI、脚本化 provider | `tmp/smoke-promotion-7`（kernel worktree 的 tmp，未入库）；证明接线与生命周期，不证明真实 refiner 会写出有效 check，也不证明 agent 会用规则 |
| 自主采用 | 未验证 | — | — |
| 净收益 | 未验证 | — | — |

### 真实运行 pr-01（2026-10-14 23:23–23:42，4d7df791）

- 配置：ls20、yibu/qwen3.8-27b、thinking high、10 动作、无 token 上限与截止、`ARC_THIN_NATIVE_HISTORY_CHARS=12000`（tc-02 设置）；`tmp/arc-kernel-20261014/pr-01/`（kernel worktree，未入库）。
- 结果：10 动作、2 个决策、0 关，1,154.6 s；预算 token 258,070（kernel-02 326,286，tc-01 330,472）；8 个父请求中 1 个 provider 失败；无 ARC 环境故障。
- 晋升路径没有被触发：refiner 一次也没有启动（无 `refiner.jsonl`）。agent 在决策 1 用一个 python cell 做了 4 个动作，在决策 2 用 python 循环做了 6 个；触发只在决策开始时评估，决策 2 开始时只有 4 个动作（R1 的 8 动作阈值未到）、4 条 memory 各写一次（没有 key 被改写 3 次），之后运行在动作上限处结束，没有第 3 个决策。
- 然而本次正是 R1 要处理的情形：memory `goal_l0` 写着 "Unknown. H: (a) patch must reach creature window …; (b) specific window/tour; (c) progress track fills to 42"——三个竞争的目标假设被写成一条事实，没有检验；`actions_l0` 写着四个方向已全部验证——一个现成的可检验规则。
- 断点：触发时机。10 动作上限下，agent 在 cell 内连续行动时决策很少，决策边界太稀；这不是机制失败，而是本次运行没有给机制出现的机会（设计中阶段 1 本来就要求 30–40 动作）。不改阈值来迁就 10 动作上限。
- 成本观察（供 token 循环）：每请求非 reasoning 输入 9,467（kernel-02 16,994，tc-01 11,764，目标 8,500），最大工具结果 2,325 字符；69% 的输入是决策内重发的 reasoning——决策 2 的第一个请求输出 35,512 token（推理 33,601，11 分钟），随后 4 个请求各重发约 3.4 万 token。

## 交付决定

- 已实现并通过功能与确定性全链路检查：晋升/降级计数、R7 控制对、refiner 的 HYPOTHESIS 形式、rules.md 提示组件、RULE CHECKS 行、空 view 触发、重算提示、refiner 成本上限。未验证：真实 refiner 是否写出有区分力的 check，agent 是否在规则常驻后减少重述，成本与任务效果。
- 已按设计默认值实现的选择（用户以"实现晋升"确认）：(a) Rules 拆为 rules.md；(b) holds ≥ 4（"≥ 2 个决策"条件未实现，见上）；(c) 成本上限 10%；(e) 不删除催促句（更正后不需要）；(g) 每组件每关提示一次。未实现：(f) I2、I5。待定：(d) 阶段 1 的预算与动作数。
- 关联 backlog D：本设计让已确立的认识以常驻文本跨压缩保留；"关键假设与反证是否跨压缩保留"仍需在阶段 1 中检查实际 provider 输入，状态不变。
