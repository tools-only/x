# ARC 在线任务的 SelfRoot 上下文与能力累积方案

日期 2026-11-19。状态为设计定稿、分阶段实施中。本文承接 [ARC 迁移记录](2026-11-18-arc-selfroot-migration.md)，作为实施和验收记录。适用默认 native SelfRoot/CH 路径。

## 1. 目标、现状与判定依据

目标是让一次探索产生的认识在后续行动中及时可用，让固定 pass 对已有能力作增量修订，并在任务进展可比的条件下达到 Continual Harness（CH）的运行效率。

用户提供的三个运行合计 254 次请求、199 次 Python 探测、27 次 arc_action 调用、约 10.29M input tokens。约 38.1 万 input tokens/动作调用，分母尚需换成实际执行的环境动作。CH 历史参考为 53 个动作、0 个通关、3816 秒、约 30.5k tokens/动作。两组数据目前只用于定位量级和制定实验目标。

| 已有实现 | 后续要接通的环节 |
| --- | --- |
| ARC 动作回执、CH 差分与关键帧、hex 网格、Python session | 核对最终 provider 请求中同一观测的重复投递，确保 Python、单动作与批量入口使用同一动作序号 |
| native memory 支持事实、假设、支持与反驳证据、下一实验、策略和显式依赖 | 将可独立读取的记录引用交给 SelfRoot，保留动作发生时有效的版本和作用范围 |
| 工作区已有最近四步、紧凑任务记忆和 review 引用的投影 | 当前 taskMemory 是已拼好的字符串。需要让 SelfRoot 在渲染前选择具体条目，并让 pass 修改的选择在真实请求中生效 |
| SelfRoot 已有 ledger、反射事务、组件版本、激活边界、context policy 和 read_self | 将新事实、旧能力及其使用反馈送入现有 pass，并将修订送回后续普通轮 |
| 复用报告已按动作区间统计部分请求 | 对新运行直接记录请求发出时的动作计数，覆盖无 Python 的决策、失败和末尾无动作区间 |

核心命题：动作反馈和当前工作依赖可以自动到达下一适用请求，Agent 因而少做重复观察并能延续已形成的策略。若输入缩小却导致更多补读、重复推理或更差任务进展，则应修订投影。

## 2. 职责与数据流

1. ARC adapter 接收和执行具体动作，输出动作序号、环境状态、合法动作、前后差分、关键帧及读取原始证据所需的引用。一个真实回执推进一次环境状态。
2. ARC 原生 memory 保存 Agent 主动写下的任务认识。事实引用可以自动记录。支持、反驳、机制解释和策略价值来自 Agent 的判断。沿用已有写入入口和持久化，给 SelfRoot 提供只读条目投影。
3. SelfRoot 是运行视图的所有者。它根据自身 mode、active revision、已有作用范围、显式依赖与当前 policy 组装内容。通用部分只处理版本、范围、依赖、引用和展示，不理解游戏规则。
4. 固定 pass 继续沿既有触发、阶段、反射、退出、下一请求激活及恢复路径运行。已有 30 个实际动作无 pass 的兜底继续有效。早期与后期使用同一范式，输入材料随事实累积而变。

只维护一条真实环境轨迹。RESET、重复棋盘、失败、过关分别作为新事件记录。旧照片或旧回执可读取；恢复组件版本只作用于未来请求，历史动作及当时使用的版本永久保留。

## 3. 普通轮的内容选择

以两个相邻的已执行环境动作划分逻辑决策区间。区间内多次 Python 探测属于同一观测。模型一批选择多个动作时，逐步记录实际回执和停止原因，保留共同的批次来源，不虚构中间的模型判断。

| 材料 | 默认投递规则 | 更新与退出 |
| --- | --- | --- |
| 当前观测 | 完整保留 CH 当前状态、合法动作、动作后的变化、按现有规则选择的关键帧和对应图像 | 首次观测没有差分；动作执行、RESET、关卡变化后更新。同一轮追加工具结果时避免在消息串中再次插入观测副本 |
| 近期动作 | 建议起点为最近 4 个实际动作，每步一条回执。上一动作的详细反馈只在观测块展开一次 | 移出窗口后仍可用动作号读取。窗口仅控制展示，不限制行动或查询 |
| 工作记忆 | 优先当前策略、未完成实验、它们显式依赖的机制，以及这些机制已有的有效反例。首次探索时允许为空 | Agent 一次普通 memory 写入即可生效。较早反例只要仍有关联就不因年龄被挤出；过长时保留短要点和准确引用 |
| 可用能力 | 根据合同和当前模式提供合法的工具；对与当前任务直接相关的记忆组件交付所选内容。源代码、版本链、使用明细按需读 | 组件激活、撤下、依赖变化、模式切换应立即使相应视图失效并重建 |
| 同轮计算 | 当前工具调用与结果保持协议配对，保留新的语义输出。大型结果提供可恢复引用，跨动作默认退出 | 截断时标明实际投递长度与取回方式；已选择保留的发现通过 memory 延续 |

跨轮压缩使用已有结构化记忆和引用。runtime 可以折叠重复结果、退役旧图、更新索引；不从自然语言自动生成机制结论。对旧记录缺失的版本、范围和依赖标记未知。对已经明确关联的预测，动作前固定其版本，反馈到达后并排展示预期和回执；没有关联时照常执行，不追填为事前预测。

默认投影只在有内容时出现。优先复用现有 memory 展示预算，并同时记录被省略的数量和取回入口。对互相冲突的材料，应让主要结论和反证各保留一个短引用，避免预算只够展示结论。固定字段、空模板、要求模型说明所处探索阶段的文字均不进入普通 query。

## 4. 不同进展下的实际效果

早期只有动作和观测，首屏自然集中于差分和合法操作。Agent 如在第 3 步记下一个暂定机制，第 4 步就能看到它；无需等待 pass 或先制作工具。

随后 Agent 若建立依赖该机制的策略，首屏增加当前子目标、适用前提和相关反证。一次尝试已经达到子目标但没有通关时，系统保留“达到子目标”和“随后环境没有报告过关”两项事实。Agent 可以保留已经奏效的子策略，并重新判断对通关条件的解释。无需重播整关或重新识别局部结构。

后期遇到新机制或新关卡，完整差分始终可用。已有能力按作用范围恢复；未经跨关验证的结论保留来源与适用范围。整个过程由当前材料及显式关系驱动，不需要游戏阶段分类器、强制探测次数或额外的总结请求。

## 5. 固定 pass 的输入、产出与回流

**入口。** 固定本次 pass 的 revision 和证据截止点。首先显示触发事件、挂起的步骤或策略、上次 pass 结束至本次入口之间的动作范围。首次 pass 从当前运行起点计算。然后投递该范围内新增、修订或被反驳的任务记忆、受影响的能力版本、仍未解决的实验。旧能力依然生效时，即使窗口内没有变更，也列出与本次材料直接相关的依赖。明细通过现有 ledger、pin、组件版本接口展开。

**期间。** 保留同一次 pass 的基线，追加 Agent 主动读取的页和反射回执。若既有 pass 包含多个焦点，各焦点读取同一窗口，按当前对象选择材料。高成本区间仅给事实和一个样本引用，例如多少请求、耗时、哪些探测重复读取已展示的观测。没有可归属数据时显示未知。

**产出。** Agent 可以保持原方案、修改任务认识、用 reflect_component 定义或修订组件，或用 reflect_orchestration 修改已有 context policy。固化后的组件记录来源引用、版本及 Agent 指定的适用范围。草稿和组件同时存在时，同一内容在请求里只展开一次；新反例通过来源关系抵达下一次适用的 pass。通用引擎不自动发布或晋升组件。

**恢复。** 复用现有请求边界激活和权限校验。以激活后的 revision 重建后续普通视图，恢复挂起任务并交付适用的组件内容。依赖失效时显式标出，避免用新版正文解释发生在旧版下的动作。关闭 pass 而没有修改也是有效结果。

## 6. 实施顺序和完成条件

| 顺序 | 代码入口及工作 | 交付判据 |
| --- | --- | --- |
| 1. 打通在线证据和计量 | ARC extension 的 provider 发出点记录动作计数、批次、模式、request id；复用报告与 settlement、Python 及真实回执关联 | 第一次动作前、两动作间、末段无动作、批量中断和零动作失败都可报告。旧 runs 的不明确关联保留未归因 |
| 2. 让普通记忆可单独选择 | 从 arc_thin_memory 的已有记录生成带 key、版本或来源行、范围和正文引用的条目。self_root_arc 提供 ARC 投影；SelfRoot.executionView 选择后再渲染 | 新写入的记忆在下一适用请求可见，移出四步窗口的反证仍能随其依赖出现，重启后引用可恢复 |
| 3. 接通固定 pass 增量输入 | 复用 SelfRoot 的 ledger 游标、segment、review ticket、suspended 与 version lineage。按能力引用归集任务记忆变化和已记录的展示、调用、失败反馈 | 连续两次 pass 的材料边界可核对。第二次能在旧版本基础上修订一个受影响对象；崩溃或未正常关闭的 pass 不吞掉待处理证据 |
| 4. 落实选择与激活 | 检查 planContext 在最终 ARC 消息组装点的接线及其对 history 以外条目的保护规则。先复用已有 policy；仅在表达不了条目选择时扩展最小可版本化策略。在最终 payload 记录实际投递的 ref/version | 通过反射调整一次选择后，下一适用请求的实际内容随之改变。原始观测、工具调用配对、权限和证据恢复继续正确 |
| 5. 测量探测的剩余原因 | 以实际请求为单位计算重复观测、工具调用与输出长度、已归档结果的补读和真实进展。先修观测或读取缺口；有可复用计算需求时由 Agent 决定是否制作工具 | 能区分重算已显示事实、因截断重跑、验证新假设以及真正必要的串行判断。只调整出现断点的一项机制 |

尽量分提交交付，按版本回退投影或策略；原始轨迹和组件历史始终可读。以上各步沿现有请求、工具和 pass 执行，不新增后台模型、并行研究员或每动作强制 memory 写入。

### 当前实现状态（2026-11-19）

- 已完成：请求发出时记录动作计数；报告按动作区间统计 Python 调用、可唯一归属的 Provider 请求和已报告 token，并将无法归属的请求单列。对应提交 `878cbba0`、`fdf74ef8`。
- 已完成：普通 ARC SelfRoot/CH 工作视图使用当前 CH 观测、紧凑最近动作与条目化 task memory；旧的整段 memory 文本不再与 SelfRoot task memory 重复投影。task memory 仍由 Agent 写，SelfRoot 按当前 memory strategy 选择，完整证据保留来源引用。对应提交 `8a9805e3`、`bd4a94f0`。
- 已完成：SelfRoot execution view 为 pass 提供 ledger 窗口、挂起位置、组件激活版本和读取/投递/执行回执引用。对应提交 `e6c3c5aa`。
- 本轮修复：移除 SelfRoot 自身的 request/token/storage 与 request cadence 强制门槛；修正 META round 的入口问题、episode close 丢失触发、NativeRuntime 未接 Binder、缺少 `settleMetaTrial` 和 loop mount 常量，以及无 token cap 时 runner 图片预留值未初始化和 smoke provider 重复标识符。
- 上下文精简：将 ARC SelfRoot/CH system instructions 从重复描述改为观测契约、能力定位和按需取回说明；移除系统要求的逐 action 推理/预测流程指导。脚本 smoke 的 `context_budget.jsonl` 中 `system_chars` 从同类先前 run 的 4,760 降为 1,949（约 -59%）。这是字符数与 scripted provider 证据，不等同真实模型 token 或质量收益。
- 功能验证：定向 Node 测试共 94 项通过，包含 SelfRoot、30-action pass、无 SelfRoot quota、task memory、CH observation renderer、request telemetry 和 native context；Python runner/request-accounting/CLI 测试 16 项通过。新增 `--max-no-action-decisions 0` 可关闭 runner 的连续无 action 停止条件，未设置时仍保持原有默认行为。`git diff --check` 通过。
- 全链路验证：`python tools/run_foundation_smoke.py runs/arc-selfroot-foundation-20261119h foundation uncapped` 通过；Pi 0.87、生产 bridge、mock ARC SDK、scripted provider 完成 3 个 action、8 个 provider 请求，无 provider error。该 smoke 只证明接线和低成本功能，不证明真实模型自主采用或关卡收益。
- 留存的边界：`tests/arc_thin_coverage_events.test.ts` 属于旧 harness 接口检查；目前它仍使用与现行 action-list schema 不一致的 scalar action fixture，未纳入上述当前 SelfRoot 定向验收。此兼容测试问题单独记录，不能将它算作通过。
- 尚未完成：真实 provider payload 是否减少了重复观测、真实任务中的 Python 探测频次是否下降、Agent 是否自主利用记忆/自进化修订、相对 CH 的效率和任务净收益。不得从投影大小或脚本 smoke 推断这些效果。
- 真实运行诊断（`runs/su15-selfroot-optimized-20261119-completions`）：AZ `qwen3.8-27b`，native SelfRoot，61 个 bridge 动作、0 个已完成关卡；session 记录 219 次 provider 请求、约 3.45M input / 483k output tokens。SelfRoot ledger 记录两次已关闭 evolution review，最近一次关闭后又有 21 个动作。运行在第 61 个动作后被开发 Agent 手动中断；`summary.json` 是中断前快照，不能作为自然终态或任务效果证据。中断缘由是误读了旧 self-loop 的 `evo_pass=false` 统计字段；随后核查确认它不代表 SelfRoot review 关闭。
- 这次核查修复了 SelfRoot interval fallback 的生命周期边界：闭合的旧 review 不应永久阻止后续 30-action review。`queueActionIntervalReview` 现在从最近一次已关闭 pass 之后计数；活动 review 或未关闭的 pass 仍阻止重复入队。`tests/self_root_arc.test.ts` 覆盖跨请求恢复、pass 后重新计数。真实 run 在手动中断时尚未到最近一次 pass 后 30 个动作，因此没有观察到该 fallback 的真实触发；该行为仍需新 run 验证。
- 修复后验证：`node --experimental-transform-types --test --test-concurrency=1 tests/self_root_arc.test.ts` 通过（2 项）；`git diff --check` 通过；新目录 `runs/arc-selfroot-foundation-20261119j` 的生产 Pi/bridge/mock ARC SDK/scripted provider smoke 通过（3 动作、8 provider 请求、0 provider error）。Smoke 未触达 30-action fallback，也不证明真实模型行为或 ARC 关卡效果。
- 第二次真实样本（`runs/su15-selfroot-optimized-20261119-restart1`）：native SelfRoot/CH 观测，5 个 bridge 动作、0 关；session 中 32 次 provider 请求（约 428k input / 84k output tokens）、23 次 Python 调用，按决策为 3/2/11/7，23 段 Python 源码互不重复。调用均扫描当前网格或比较相邻状态，且主要发生在两个没有环境动作的决策轮中；观测本身已带 CH 网格、动作差分和图像。该样本由开发 Agent 在第 5 个动作后中断，属于效率诊断，不是自然终态，也没有证明这些分析无价值。由于 ARC 不可回退，下一次新 run 只作为另一个在线样本，不能声称严格 A/B 因果对照。
- 针对可从原始棋盘直接确定、又在本样本中反复逐格扫描的事实，增加一个短动态 `GRID FACTS` 面板：按颜色给出格数与坐标范围，并明确范围可能覆盖断开的格子；不识别对象、不推断运动或目标。它只补充观测事实，不添加 Agent 行为指示。连通块、shape signature、运动卡片等仍属于 Agent 自己构造的派生能力，遵循待办 A 的 adapter 边界。下一真实样本检查这些基础查询是否减少，同时审计 Python 总开销、动作进展和关卡结果；若面板只增加 token 而未替代探测，应撤回。
- 面板验证：`node --experimental-transform-types --test --test-concurrency=1 tests/arc_thin_ch_view.test.ts tests/arc_thin_ch_observation.test.ts` 通过（14 项）；生产 Pi/bridge/mock ARC SDK/scripted provider smoke `runs/arc-selfroot-foundation-20261119k` 通过（3 动作、3 决策、0 provider error）。Smoke 未验证真实模型是否利用面板、Python 是否下降或关卡收益。
- 第三次真实运行（`runs/su15-selfroot-optimized-20261119-restart2`）：AZ `qwen3.8-27b`、`openai-completions`、native SelfRoot，未设置动作、决策、token 或时间上限；source HEAD `52edafec`。runner 已完成并验证 bridge close，30 个实际动作、0 个通关、约 4,491 秒（75 分钟）；147 次 provider 请求，其中 4 次失败；100 次 Python、约 1.848M input tokens（reported 总量约 2.877M）。平均约 4.9 次请求、3.3 次 Python 和 61.6k input tokens/实际动作。工作集均值 9,895 字符。相较用户提供的旧 ARC 运行量级（约 34–60 万 input tokens/动作、6–10 次 Python/动作），该样本显示上下文与探测开销处于较低量级；由于不是同一状态的可回退对照，且任务和运行版本不同，只能作为方向性证据，不能归因于单一改动或宣称已达到 CH 效率。
- 本次全链路证据：SelfRoot ledger 在 30 个动作边界进入 `reflect`，创建 `action-interval:30` review；run summary 记录 3 个 evolution pass。memory 有 16 次写入，最终 4 条；skill 有 2 个版本且运行 2 次。与此同时 Python 仍累计 100 次，报告的 `repeats=0`、`answered_from_same_state=0`，history 技能读取为 0，说明已有资源确实运行或写入，但“探索结果变成可持续复用能力并减少探测”的自主采用和净收益仍未证明。summary 的决策级工作集统计为均值 9,895 字符（state 8,654、board 292、python 710、resources 215、spin 24），比用户描述的旧版约 80K 字符明显小；这证明本次上下文投影较紧凑，不证明任务效率已经齐平或通关策略有效。
- 运行以 `provider_error` 终止，0 关卡不是自然完成或模型失败判定。最后 provider 错误为 HTTP 400 `Arrearage`（账户状态拒绝）；共 4 次失败请求。关闭记录显示 ARC bridge 正常关闭、scorecard verified、0 个 forced action，任务仍为 `NOT_FINISHED`。本机仅找到一个 AZ endpoint 凭据来源；该 endpoint 的账户拒绝请求。桌面 Provider Session 的 AZ 路由使用不同默认模型，不符合本轮明确的 Qwen 配置，因此没有擅自改模型重跑。该环境故障需要 AZ 账户恢复可用后才能继续验证 4-level 目标。
- 验收结论按四类分开：功能和全链路方面，动作区间 30 的 reflect 触发与 bridge close 已有真实运行证据；自主采用方面，memory/skill 有写入和运行记录，但复用效果不足以确认；净收益方面，工作集和每动作 Python/request 数比旧报告低，但仍为 75 分钟 30 动作、0 通关，且跨 run 不可作因果比较；Provider 行为方面，Qwen 在运行末遭遇账户 `Arrearage`，因此 4-level 目标尚未验证。恢复 AZ 账户后，应从新的 ARC run root 以相同 AZ/Qwen/无上限配置重启，保留当前失败 run 作为在线轨迹，不覆盖或伪造续跑。
- 账户状态复核与重试（`runs/su15-selfroot-optimized-20261119-restart3`）：新 run root 使用更新后的 HEAD `afdbc2d8`，明确配置仍为 AZ `qwen3.8-27b`，`max_actions=0`、决策/token/time/idle 上限均为 null。首轮 provider 请求仍返回同一 HTTP 400 `Arrearage`；runner 完成错误处理后以 `provider_error` 结束，bridge close 正常，1 个实际动作、0 关、5 次 provider 请求（1 次成功、4 次失败），约 183 秒。该重试验证账户尚未恢复；不能作为模型能力或 ARC 解题失败证据。恢复 AZ 账户状态是继续 4-level 真实运行的必要外部条件。
- 间歇恢复复测（`runs/su15-selfroot-optimized-20261119-restart4`）：source HEAD `5edd4846`、clean；仍为 AZ `qwen3.8-27b`、medium/Qwen、无动作/决策/token/时间/连续无动作上限。一次极小 completions 预检返回 HTTP 200，但正式 run 随后在 9 次 provider 请求中仅 6 次成功、3 次返回相同 `Arrearage`，最终 `provider_error`；483 秒、3 个决策、0 个 ARC action、0 关。成功返回的 6 次都用于 Python 探测，累计 6 次调用；没有 task memory/skill 创建。实际动作是否合适、Agent 是否漏掉机会无法从本次提前终止的轨迹判定，因此 L0–L3 component adoption、后续 TASK、30-action pass、通关和净收益均未验证。请求报告成本为 partial（135,871 reported tokens，3 个失败请求成本未知）。结论：预检单次 200 不足以证明 endpoint 稳定；正式 run 仍受间歇账户拒绝影响。下一步需 AZ 账户/路由稳定后从新 root 重启，不应把此 run 的零动作解释为任务 Agent 拒绝行动或 harness 解题失败。

## 7. 实验协议与交付边界

- 功能：用合成回执验证首次观测、无变化、跨四步、RESET、过关、批量中断、版本失效、显式反证、未知用量、恢复与空记忆。检查完整当前网格与图像、引用可达和最大常驻文本来源。
- 全链路：经生产 ARC runner/bridge/Pi 和脚本 provider，检查普通写入、下轮投递、原有 pass、反射激活、恢复后的首次动作。以最终 provider 消息和实际工具 schema 核对，不能只比较 executionView 的 JSON。
- 自主采用：使用 az / qwen3.8-27B 普通运行，记录是否自发留下认识，能否跨动作使用，pass 是否修订已有对象，后续真实行动是否体现修订。记录合理不写、合理不改和作用不明的样本。展示、调用、语义采用分别报告。
- 净收益：预算获授权后，在运行前固定任务集（含留出任务）、模型、thinking、并发、动作与时间预算、独立重复数和停止规则。先用当前版本作基线，再逐步启用上述改动。与 CH 比较使用独立在线运行，各自经历一条不可回退的轨迹。
- 效率判据：同计量口径的每个实际环境动作总 token 与整场墙钟时间/动作均不高于 CH，并同时检查固定时间及动作预算下的关卡进展、重复无效动作、失败和补读。计入父子、复盘、失败请求和末段，缓存和未知用量单列。零动作运行单报总成本和失败原因。只取得历史参考时，只报告相对于约 30.5k tokens/动作、72 秒/动作的结果。若双方均零关，吞吐达标可以报告，通关能力改善仍未知。
- 当前证据：本文件交付设计。已有紧凑投影的局部检查记录在迁移记录中。完整的功能、全链路、自主采用、CH 效率齐平均待按上述协议验证。[延后事项 A 和 D](../deferred-research-todos.md) 的 adapter 职责和跨压缩认知连续性继续开放。

## 8. 普通决策提示减负（2026-11-19）

- **真实机会与窄命题。** AZ/Qwen 的 su15 `restart2` 在 30 个动作间调用 Python 100 次；逐段代码显示大量历史帧和网格取证。当前生效的 Python 工具描述要求“每个 cell 检查一个动作决策及可预见分支”，runner 每轮又要求回看变化、未知和已保存工具。这些文字给每次决策增加了程序性任务。移除指令后，Agent 仍能访问相同观测和工具，但不再由常驻提示要求逐项核查；是否减少 Python 往返、总 token 和动作间耗时，需要真实模型验证。若探测频率不变或任务进展退化，则该命题不成立。
- **范围与成本。** Python schema 只保留会话名称、返回值、保存和调用语义，删掉逐格决策核查、回报决策证据及 Python 数据保存建议。runner 和 TypeScript phase loop 的普通 Task 提示统一为 `Decide the next action.`；恢复提示、pass turn 和实际工具权限不变。Native system 保留一处历史/原始帧按需入口，CH 合同不重复路径；将“中间帧有区别便包含”改成当前渲染器确实保证的“可能包含”。没有新增常驻字段、门禁或管理轮。Agent 仍通过既有观测、回执与按需读取获得证据，后续真实动作的反馈仍进入既有工作视图。
- **有界评估。** 本轮只做免费验证；不因 prompt 改字而启动新的付费 ARC run。下一次稳定的 AZ/Qwen 普通运行，在既有 Su15 配置和相同计量口径下，比对每动作 Python/Provider 次数、input/output/cache、墙钟、有效动作及关卡进展，并审阅有价值的 Python 使用与漏用。在线 ARC 不可回退；跨 run 仅作方向性比较，净收益需独立重复及预定预算/停止规则。AZ `Arrearage` 间歇故障仍会使样本无法判定模型行为。
- **功能正确：通过。** `tests/arc_thin_native_context.test.ts` 10 项、`tests/test_arc_thin_decide_prompt.py` 1 项通过；TypeScript 语法和 Python 编译通过。检查了 CH 合同与 Native system 装配后历史路径只出现一次，普通提示为单句。
- **全链路可达：通过，限脚本环境。** `runs/arc-prompt-trim-20261119/summary.json`：生产 Pi/bridge、mock ARC SDK、scripted provider，3 个动作、0 provider error、正常 bridge close。首个真实组装请求的 `current` 以单句决策提示开头，Python schema 不含逐格核查要求，system 中 `data/trajectory.jsonl` 只出现一次。此 smoke 未启用 CH 合同，CH 装配只由定向测试覆盖。
- **自主采用：未验证。净收益：未验证。** 脚本 provider 不反映真实 Qwen 的探测选择；本次不能声称 Python 使用量已经下降、CH 观测缺口已经解决，或 ARC 通关改善。延后事项 A 的 adapter 职责边界、D 的跨轮认知质量保持开放。

## 9. ARC 观测证据交付修复（2026-11-19）

- **真实失败与可证伪命题。** Su15 `restart2` 的第 8、13 步各返回 5 帧，普通决策视图只选末帧，且末帧与当前棋盘相同；第 13 步已算出的 23 格颜色转移只存于 trajectory，SelfRoot 超过四步后用 `actionLine` 丢掉详细差分。Agent 因而分别用 Python 读原始帧、重算转移。命题是把已有的客观变化交付到下一决策，会减少为取回同一证据而发出的 Python/Provider 往返，同时保留原本的最终帧、当前完整棋盘及原始动画。若后续普通运行的重复取证未降，或额外输入成本抵消收益，则命题不成立。
- **范围与成本。** 选帧器仍按原有规则选基础帧；当被选中的末帧与当前棋盘重复，且存在同时不同于动作前及末帧的中间状态时，再从该动作挑一张帧间变化最大的中间帧。一次决策最多补一张，原末帧、当前网格/PNG 和原始 `data/observations` 均保留；即使基础四格预算已满，补帧也不挤走已有帧。SelfRoot 最近四步继续只列四步，但每步复用已计算的 CH 颜色转移；不增加对象识别或运动推断。将易误读的 `transient_animation` 改为事实含义明确的 `intermediate_frames_changed`。Python schema 只补充现有 `state["observations"][i]["frame"]` 及 `recent_trajectory` 的短入口，不加行为指令。
- **输入代价实测。** 对 `restart2` 保存的公开观测离线渲染，第 8、13 步都保留 frame 4，并分别新增 frame 1；若该步单独进入下一决策，渲染结果为中间帧、末帧、当前帧共三张 PNG。对应 observation 文本从旧视图的 4,772/4,771 字符变成 8,979 字符，增加约 4,207/4,208 字符和一张 PNG。字符及图像数不是 token 或成本报价；是否值得由真实运行中替代的探测和任务进展判断。
- **边界发现。** 模拟 bridge 的集成测试显示，刷新当前状态后 `state["frames"]` 只有当前状态响应的一帧，而 `state["observations"][0]["frame"]` 保留该动作全部三帧。故工具说明明确指向后者；没有声称 `state.frames` 是完整动作动画。
- **完成口径追补。** 首次修复只将已计算的颜色转移送入 SelfRoot 最近四步，并未把逐格 `grid_delta` 交付普通视图。复核后，SelfRoot 在最新动作的观测块末尾直接投递已保存的完整终态差分 `[x,y,old,new]`，仅当其条数等于已计算的终态变化总数时这样标记；超过现有 50 格存储上限时只给精确历史状态入口。该行同时给出 `data/observations/<step>.json#frames`，使完整动画的文件结构在相关动作旁可发现。它不展开旧动作的全部逐格差分，旧状态仍通过 `history.grid(n)` 按需恢复。生产 extension + mock HTTP bridge 的 SelfRoot 集成测试覆盖五步后颜色转移、最新动作的逐格差分、三 PNG 保留及 Python 中完整动画的读取；真实 Provider 行为仍未验证。
- **功能正确：通过。** 定向 Node 测试 27 项通过，覆盖原有 CH 观测基线、追加帧且不替换末帧、零/一格预算、无有效中间帧、批次最多一张补帧、SelfRoot 超过四步后仍见颜色转移、实际模型消息同时含三张 PNG，以及 Python 中完整动画入口。TypeScript 语法检查和 `git diff --check` 通过。
- **全链路可达：部分通过。** 逐格差分追补后的 `runs/arc-observation-evidence-20261119d/summary.json` 经生产 Pi/bridge + mock ARC SDK + scripted provider smoke 完成 3 动作、0 provider error、正常关闭，但该脚本场景无多帧动画。三 PNG、SelfRoot 最新动作的逐格差分和 Python 动画入口由生产 extension + mock HTTP bridge 的集成测试验证；实际 Pi 请求中的三 PNG 尚未单独验收。
- **自主采用：未验证。净收益：未验证。** 未启动新付费 Provider 运行，不能推断 Python 调用会减少或 Su15 关卡效果改善。下一次 AZ/Qwen 稳定运行须同时核对展示的帧是否被 Agent 用于下一动作、历史差分是否替代补读、每动作总 input/output/cache、图像与墙钟以及通关进展；保留合理的精确计算调用。延后事项 A 的 adapter/runtime 边界与 D 的跨轮认知连续性仍开放。
