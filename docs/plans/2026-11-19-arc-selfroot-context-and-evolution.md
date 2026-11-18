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

## 7. 实验协议与交付边界

- 功能：用合成回执验证首次观测、无变化、跨四步、RESET、过关、批量中断、版本失效、显式反证、未知用量、恢复与空记忆。检查完整当前网格与图像、引用可达和最大常驻文本来源。
- 全链路：经生产 ARC runner/bridge/Pi 和脚本 provider，检查普通写入、下轮投递、原有 pass、反射激活、恢复后的首次动作。以最终 provider 消息和实际工具 schema 核对，不能只比较 executionView 的 JSON。
- 自主采用：使用 az / qwen3.8-27B 普通运行，记录是否自发留下认识，能否跨动作使用，pass 是否修订已有对象，后续真实行动是否体现修订。记录合理不写、合理不改和作用不明的样本。展示、调用、语义采用分别报告。
- 净收益：预算获授权后，在运行前固定任务集（含留出任务）、模型、thinking、并发、动作与时间预算、独立重复数和停止规则。先用当前版本作基线，再逐步启用上述改动。与 CH 比较使用独立在线运行，各自经历一条不可回退的轨迹。
- 效率判据：同计量口径的每个实际环境动作总 token 与整场墙钟时间/动作均不高于 CH，并同时检查固定时间及动作预算下的关卡进展、重复无效动作、失败和补读。计入父子、复盘、失败请求和末段，缓存和未知用量单列。零动作运行单报总成本和失败原因。只取得历史参考时，只报告相对于约 30.5k tokens/动作、72 秒/动作的结果。若双方均零关，吞吐达标可以报告，通关能力改善仍未知。
- 当前证据：本文件交付设计。已有紧凑投影的局部检查记录在迁移记录中。完整的功能、全链路、自主采用、CH 效率齐平均待按上述协议验证。[延后事项 A 和 D](../deferred-research-todos.md) 的 adapter 职责和跨压缩认知连续性继续开放。
