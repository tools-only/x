# Continual Harness 的 self-harness：接口简洁、上下文组织与本地证据

日期：2026-10-08（Asia/Shanghai）。范围：只读源码与历史日志分析，没有修改外部仓库，没有启动模型或 ARC 运行。

## 结论

Continual Harness 把能力修改作为解题过程中立即可用的操作：保存程序、运行程序、看真实结果、修订程序。主要优点是降低模型的接口负担、将环境状态和常用库直接交给程序、在环境行动之后重建工作上下文，以及由 runtime 触发有限的经验整理。

这些机制使 self-harness 更容易开始和延续，但本地历史记录不支持“已经证明计算成本低、可执行 skill 帮助通关”的结论。36 个 run 目录中 31 个有 trace；可见的 639 次 run_skill 全部返回 success=false / OSError10038。ft09 最多出现 4 个已完成 level，但没有成功 skill 执行可供归因，部分 run 从旧经验 bootstrap；主要样本已记录百万到千万 reported tokens。

## 检查材料与边界

- 对照目录：`D:/arc-agi-benchmark/Continual-Harness-ARC-AGI-3`。README、当前 orchestrator/context/stores/evolver/sandbox 和 logs、logs1 下已有 manifest、trace、trajectory、初始资源快照。
- 外部 checkout 的 orchestrator、context、sandbox、evolver、backend 等有既有未提交修改。本次读取的是当前源码；August 历史日志不能当作当前修改版复现。
- [全部历史 run 审计](../../tmp/continual-harness-code-and-local-log-audit-20261008.json)、[语义例证](../../tmp/continual-harness-semantic-examples-20261008.json)、[skill 返回与失败分类](../../tmp/continual-harness-skill-failure-audit-20261008.json)。分析脚本同目录，所有外部文件保持原状。
- reported tokens 是 trace 的已记录 usage.total 合计，包含 orchestrator/subagent/harness_evolution，未将缺失字段当零计费；不是美元费用、不是独立样本净收益。中断、错误和 bootstrap 混杂均保留。

## 为什么接口简洁

### 1. 能力以最短路径直接可用

`continual_harness_agent.py:2029` 每轮固定暴露 6 个主要工具：take_actions、process_memory、process_skill、run_skill、process_subagent、run_subagent。process_skill 的 add/edit/delete/search 操作直接修改 game-local store。保存成功后，即可按 id 或 name 调用 run_skill，运行时取当前版本。没有独立候选池、手册读取前置、装配选择或模型批准步骤。

`skills.py:157` 同名 add 是 upsert 并提升版本，减少模型新造 v2/v3 名字和重名报错后的往返。`continual_harness_agent.py:561` 对 id/name 兼容，并将执行源码回送以便改错。实际模型仍应检查输出；接口没有证明程序的语义正确性。

与本项目比较需要按当前源码：`demo/pi_task_local_self_harness.ts:2783` 已支持 task_harness_create 一次创建并安装，trial 可执行纯 Tool；`pi_harness_baseline_methods.ts:89` 的 creator citation 也是可选。不能把旧版的独立出版/装配/必读 creator 路径当作当前差距。剩余差异在组件语义、执行上下文及声明/有效性/依赖等模型需要理解的内容。

### 2. 它的 Skill 是程序，执行约定固定

这里的 Skill 是 Python source，接近本项目的计算 Tool；本项目的 Pi Skill 则承载操作程序与指引。四个 store 不等于少了一种能力：可执行工具已经被放进 skills store。

Skill 输入统一为 state、args，输出统一为 result；state 提供当前完整 hex grid、按动作的完整帧、近期轨迹、memory/skill store 和图片，numpy 等常用库预加载。模型可以把连通域、坐标、搜索等工作写成程序，后续用名字调用，避免反复在文本里计算。具有授权的程序也能通过 tools.take_actions 执行动作，从回执取得新观测。Skill 的初始 state 是快照，代码必须按回执刷新认识并检查终态/换关。

这降低的是编程和调用的衔接成本。Skill 有 sandbox、语法/能力约束、30 秒超时及输出上限，并非任意修改宿主。

### 3. 环境行动之后重建工作上下文

`continual_harness_agent.py:1511` 为每个决策建立新的 contents；在同一未行动的决策内，tool-only 轮追加到同一 conversation，使用已给出的观测；第一次执行环境行动后结束该决策，下一次根据新状态重新 build prompt。

下一决策保留的是：固定工具协议、可更新策略、memory/skill/subagent 目录、近期动作摘要、少量工具结果和当前完整观测。此前的完整 assistant/tool 对话不会逐轮累积到所有后续动作。

具体限制包括：history 的字符预算 12000；最多携带 16 条非行动工具结果，其中最新 2 条全文、较早条目摘要；stdout/stderr/result 分别有 5000 字符上限；策略 prompt 上限 12000 字符。Memory 目录还展示 body 第一行，不能理解为完全不展示认识正文。

这些是分项限制，不是整个请求的严格 token 上限。最近全文结果会带程序源码，目录和多模态内容也仍占成本。认知连续性依赖模型及时保存认识和恰当的摘要；重建上下文本身不能证明旧反证未丢失。

### 4. 长期保存的是认识和能力

Memory 使用短原子事实/假设、confidence 1–5、edit/delete；策略 Refiner 被要求保留高置信规则和低置信开放问题。Skill 保存可复用计算；subagent 保存职责和静态指引。完整 trajectory/trace 另行落盘。这样长期语义状态可以跨决策延续，默认不需要每次重读全部旧观测。

Confidence 来自 Agent 声明，不是环境验证证明。源码没有保证每个重要推理都自动转换为 memory；长历史压缩和持续认识的质量仍需看实际后续决策。

### 5. 经验整理的机械调度由 runtime 负责

`harness_evolver.py:546` 在换关、GAME_OVER 和停滞时触发 Refiner。默认停滞间隔 75 个动作；0 关闭所有 evolution。它把轨迹/工具证据和当前状态直接组成输入，模型返回建议，runtime 校验并写入策略、skills、subagents、memory，随后正常父决策即可读取新状态。

父模型不用管理一条 durable research line、节点释放、研究恢复、交付认领或另一次安装决策。具体研究结论仍由模型作出。

代价也明确：一次 generation 默认有四个独立、串行 meta-model pass，当前轨迹和工具证据各可到 50000 字符；父游戏循环同步等待。它减少管理往返，但不保证总计算少。各 pass 单独应用，不是整个四-store 修改的原子事务；正常未来使用并不由 runtime 自动证明有效。

### 6. subagent 执行是当前决策中的有界调用

run_subagent 给当前观测、紧凑 history、目录和任务，然后返回。每 outer step 最多 1 个 subagent；默认 max_turns=25、硬上限50，one_step 可只跑1轮；允许工具默认空，仅分析后返回。拥有 take_actions 权限时能直接执行，但仍经同一环境动作路径和状态检查。

这缩短了独立分析到父使用的路径，也限制其取证方式；不会自动提供本项目持续研究职责、长历史按引用恢复、异步增量交付和精确权限版本等完整能力。适用范围更窄是接口简洁的重要原因。

## 本地日志支持什么

| 历史样本 | 初始经验 | 轨迹记录数（含 RESET / 异常事件） | 最高观测 level | 已记录 reported tokens |
| --- | --- | --- | --- | --- |
| logs/continualharness-ft09-20260816-004131 | 三个资源 store 均空 | 143 | 2 | 2,979,732 |
| logs/continualharness-ft09-20260816-104617 | bootstrap：9 memory / 4 skills / 3 subagents | 302 | 4 | 13,287,453 |
| logs/continualharness-ls20-20260819-054803 | bootstrap：12 memory / 2 skills / 2 subagents | 111 | 0 | 3,094,302 |

第一 ft09 run 在第1次模型调用自主创建 analyze_components，证明其直接作者入口确实被采用；其48次 run_skill 均宿主失败。第二 run 的255次 run_skill 同样失败。审计所有31个有trace的run，639/639次返回 success=false，错误均含 OSError10038。错误位于历史宿主执行，不能用它证明模型代码有缺陷，也不能断言当前修改过的 sandbox 仍有相同错误。

第一 run 的两个 level-up 都来自 vlm 提交的 ACTION6，而不是已成功执行的 skill。可能贡献包括 memory、策略整理、模型自身解题和跨运行继承，现有材料不能分离因果。第二 run 的总量中 orchestrator=12,287,887，subagent=306,661，Refiner=692,905；统计 child/refiner 后仍应看任务进展而非只看一个组件成本。

历史材料因此支持：直接能力作者和持续资源更新的自主行为存在；环境轨迹有实际 level 进展。未支持：成功技能执行到行动的闭环、某次 Refiner 的因果收益、比本项目更低的父子总成本或更高性价比。这里的 provider/model 日志为 OpenAI-compatible yibu / gpt-5.5，与本项目近期 Qwen 样本也不能直接对照。

## 对本项目的启示与下一检查

值得吸收的是模型接口的短路径、稳定 state/args/result 编程约定、按决策重建工作集、按任务问题保存小认识，以及仅在有证据需要时整理经验。当前本项目已经合并创建/安装，继续添加开关、手册或模型管理职责不是这种机制的核心。

下一项可证伪检查应先取得一条真实的“重复计算出现 → 自主作者 → 实际执行返回正确数值 → 后续行动使用 → 父子总成本/任务结果”轨迹。使用最小的同模型/同预算独立对照区分程序贡献、memory/策略贡献与模型自身解题；遇到宿主失败先中止重复使用并定位执行层。之后才决定是否引入 Refiner 或修改整个父上下文机制。

功能正确：当前源码只读检查，未复现当前实现。完整 ARC/Pi 链路：未运行。自主采用：历史直接作者有例证，技能有效使用未获证据。净收益：未验证。关联 B/C/D 的研究成本、父子通信和认知连续性继续开放。
