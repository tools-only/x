# Task-local self-harness 入口与多层 Auto-Research 设计

日期：2026-09-13。状态：第一阶段入口与披露已实施；第二阶段自主计算工具执行器尚未实施。

修订：只读检查 D:/terminal-bench/continual-harness-runtime 的源码后，改为首轮直接披露核心组件操作，取消 bootstrap 作为创建前置条件。第 10 节记录来源、可借鉴机制和差异。第一阶段已落地到共享 Pi extension 与 ARC adapter；本文件中的第二、三阶段仍是后续边界。

## 1. 目标与边界

让 agent 从空的 task-local 资源开始，能够发现、创建、使用、验证、组合和修订自己的 memory、system-prompt overlays、skills、tools、subagents 及活跃 context。Auto-Research 同时服务任务推进、探索方法与执行能力改进。

“从零”指派生内容为空：没有预写策略、技能正文、工具程序、agent 角色、任务记忆或研究结论。固定研究方法、接口契约、创建入口、受限执行器、公开任务数据和 benchmark adapter 可以预加载。每个独立 run 独立初始化；同一个 run 内换关、reset、研究分支和委派不清空任务知识。

不加载宿主 skills，也不通过 Pi native skill loader 发现或加载 task skills。SKILL.md 可作为 task-local 文件格式，但其读取、生效和选择均由任务资源机制管理。Pi 仍承载模型/工具循环；Python runner 负责启动、传输、边界和评测。没有外层模型代替 task agent 选择研究、能力或变更。

## 2. 当前实现的证据与限制

| 检查点 | 当前证据 | 含义 |
|---|---|---|
| 初始工具 | ARC 由共享 extension 首次初始化激活 arc_state、arc_action、inspect_arc_trajectory、research_resource 与 task-local 管理入口 | 具体创建操作首轮可见；没有预置 task-local 资源 |
| Bootstrap | harness_bootstrap(component, reason) 只激活组件操作，返回 active_tools | Agent 必须预先知道某组件的价值，才能主动跨过一次激活调用 |
| 披露不对称 | ARC system prompt 解释 research 使用场景、重复探测情境和最短调用示例；bootstrap 只有抽象描述 | 发现成本与行为引导明显偏向记录 finding |
| 方法资源 | 共享 research extension 在 treatment 首次请求读取并追加 auto_research_method.md | 方法进入 ARC 模型请求；哈希和初始资源计数写入 task-harness-entry.jsonl |
| 实际运行 | 旧的 arc-ls20-treatment-20260913 保持不变：43 次 arc_action、2 次 arc_state、1 次 research_resource；新机制通过离线 Pi 回归覆盖直接创建/投影/恢复 | 旧 ARC 样本不能证明新入口的自主使用；需用新的 ARC run 单独评测 |
| 请求审计 | 首请求工具数量为 5，但 tool_definition_names=[]；telemetry 只解析顶层 name，没有解析 completions 的 function.name | 当前日志无法逐名证实最终发给 provider 的完整工具表；应补齐观测 |
| Tool 创造力 | ARC task_tool 只接受 arc.public_state 与 arc.action_sequence | 可包装既有实现，但不能编写自己的对象提取、验证或组合计算 |
| 研究关系 | parent_goal_id、depends_on 已有；depends_on 仅认识 finding 版本，component_refs 主要保存字符串 | 研究树可用，但尚无完整、可验证的能力组合依赖 |
| Skills | runner 使用 --no-skills，task-local skill 路径不再注册到 resources_discover；skill 内容仅由 extension context/read 管理 | 符合不走 native skill loader 的边界 |
| Context | 活跃 skill/subagent 正文及部分待评估状态可全量进入每轮 context | 创建越多不一定越有效，需让 agent 选择活跃工作集 |

结论：第一阶段已形成“首轮可见入口→直接创建/更新→下一请求投影→研究反馈关联”的可检验闭环；自主使用率、持续优化收益和自由计算工具仍需新的真实 ARC run 与后续执行器阶段验证。

## 3. 入口选择

三种可选方式：

- 初始公开全部管理工具：调用直接，但初始 schema 多，难以突出用途，context 成本高。
- 保持逐组件 bootstrap，仅改文案：改动小，但 agent 仍需在不了解组件前决定激活它。
- 常驻 task_harness 入口 + 紧凑方法说明 + 按需开放具体操作：便于发现，但额外激活步骤仍增加调用成本。

参考 Continual Harness 后采用第一种方式的精简版本：**常用组件的具体操作初始直接可见，task_harness 提供总览和 context 选择**。按当前 adapter 的实际能力生成表面；不必初始展示所有高级配置。工具 schema 成本通过测量和参数精简控制，不以隐藏主要创建入口解决。

保留 research_resource 为初始工具。任务研究可以在不建设 harness 的情况下发生。旧 harness_bootstrap 只做兼容路径，不作为新 agent 使用任何核心组件的前置条件。

初始表面：benchmark 任务工具、允许的轨迹读取、research_resource、task_harness、task_memory、task_system_prompt、task_skill、受限 read、task_tool（adapter 支持时）、task_subagent/delegate_task（adapter 支持时）、assess_harness_effect。工具可见不表示已有技能、工具程序、角色或记忆内容。

task_harness 负责发现、开启能力以及选择 context；不接受自然语言“优化全部 harness”，也不自行产生角色或技能。

建议操作契约：

```text
task_harness(action="start")

返回当前 task-local 资源计数、支持的直接创建调用、最小组件配方和“新版本在下一 provider context 生效”的生命周期说明；只启动入口，不自动创建资源。

task_harness(action="inspect")
  -> 当前 task 的空/非空资源统计、可创建类型、支持边界、成本与详情引用

task_harness(action="enable", enabled_tools=[...])
  -> 仅用于可选高级配置或重新开放被 agent 隐藏的管理工具
  -> 不是创建 memory/skill/tool/subagent 的必经步骤

task_harness(action="focus", resource_refs=[...])
  -> 选择在后续模型请求中使用的具体任务资源版本；支持空集合
```

`focus` 是该入口唯一的资源投影操作，只管理活跃工作集，不改变组件正文或研究结论。创建、更新、测试、委派继续使用 task_skill、task_tool、task_memory、task_system_prompt、task_subagent、delegate_task 和 assess_harness_effect 等具体入口。返回成功前验证 adapter 支持整个请求；部分不可用时不静默开启其余组件。

每个初始管理工具直接披露创建所需字段、最短示例和使用方式。task_harness.inspect 提供更完整的 schema、成本和限制；读取总览也是可选的。开启组件不计为创建组件。task_harness 的可达性不能被 agent 自己的工具策略关闭。

## 4. 首次与持续披露

首次 treatment 模型请求明确注入下述通用契约；由共享 extension 加载普通只读方法资源，不能经 native skills 注入：

> 你同时负责完成任务和维护本任务的工作方法。当前 task-local memory、skills、tools、subagents 为空。你可以直接调用已披露的组件工具，根据需要创建它们；task_harness 提供能力总览和 context 选择。遇到反复推理、可复用步骤、关键知识容易遗失、竞争解释、复杂子问题或现有方法失效时，考虑建立或修订合适的任务资源。可以在尚无证据时提出假设并创建试用能力。通过任务观察或测试验证预期效果，按证据保留、组合、修改或停用。Auto-Research 可以研究任务路径、单个能力、能力组合及研究方法本身。选择投入是否值得，服务当前任务目标。

这是行为权限和方法指导，不是预置解题策略。没有规定必须产生多少 skill、必须委派、必须先研究，或每隔几步变更。

后续请求保持短小的入口与工作状态投影，即使组件集合为空也不消失。示例结构：

```text
Task workspace: skills=0, tools=0, memory=0, agents=0
Available: task_skill.create, task_memory.upsert, task_subagent.create, ...
Review: research_resource.open / inspect; task_harness.inspect / focus
Current focus: agent-selected task question and exact resource versions
Relevant feedback: component use/test outcome, changed dependency, context omission
Details: bounded resource/evidence references
```

事实反馈来自现有事件，agent 决定解释和行动。重复失败、依赖变化、上下文压力可作为观察信号；它们不自动生成研究问题或执行变更。提示按状态变化去重。默认正文投影设可配置字符预算，记录省略数及读取入口；不要把所有技能正文和所有子 agent 指令持续追加。

研究方法的内容、版本与哈希，初始资源零状态，最终工具名/schema 哈希，进入每次 run 的审计。记录 final provider payload 中的工具表，兼容 responses/completions 两种形状。仅检查 getActiveTools() 不足以证明 provider 接收了接口。

## 5. 多层研究与组合

这里的层次是研究对象的抽象程度，与 ARC 游戏 level 分开，不要求逐级通关，也不限制嵌套深度。

| 研究对象 | Agent 可以提出的问题 | 可能产物与检验 |
|---|---|---|
| 任务与路径 | 有哪些竞争解释？目标可拆为哪些子问题？先解决哪项依赖最有信息价值？ | 子问题、条件计划、候选路径；通过有区分力的任务观察选择或剪枝 |
| 基础能力 | 某个读取、提取、记忆或验证方法在什么条件下可靠？ | 基础 skill/tool/memory；测试、反例、适用条件和失败条件 |
| 组合能力 | 若组合 A、B、C，能否解决单独能力不能解决的子目标？ | 引用低阶具体版本的组合 skill；独立端到端验证接口衔接和顺序 |
| 策略与组织 | 何时切换策略？委派哪部分？什么 context 对下一步重要？ | system-prompt overlay、计划修订、subagent 定义与活跃工作集 |
| 研究方法 | 现在的实验能区分解释吗？为什么研究重复但没有进展？ | 改进实验、停止条件、证据提取或委派方法，并继续检验 |

同一 research_resource 承载这些对象，扩展可选字段，不创建独立中央研究调度器：

```text
subject_kind: task | component | composition | strategy | research_method
subject_refs: 精确的组件/研究版本
hypothesis, alternatives, expected_observation, falsifier
validation_refs, scope, reconsider_when
parent_goal_id, depends_on, next_action, stop_condition
```

短 finding 仍可只包含结论、证据和下一选择，完整字段用于确有需要的实验。将认知状态 `hypothesis / supported_in_scope / contradicted / unresolved` 与工作状态 `open / active / resolved` 分开；active 不代表已验证，resolved 可以表示问题已放弃。

复用现有组件存储，增加可选组合描述：具体版本 depends_on、输入/输出约定、前置条件、成功/失败条件及 validation_refs。依赖关系从这些权威记录派生，统一解析 finding、skill、tool、memory、system_prompt、agent 等类型引用。新创建的结构化引用必须真实存在；旧记录无法解析的引用显示为未核实，不提升为证据。

组合图禁止循环的执行依赖；研究可以通过同一问题的新版本反复迭代。低阶能力在各自测试中成立，不自动证明高阶组合成立。组合需要额外验证前置条件衔接、状态变化、调用顺序和累计成本。

组件改版后，高阶组合继续绑定原版本；显示旧依赖及新版本提示。若旧版本被明确撤回或不再允许执行，则阻止该组合执行并返回原因。Agent 决定重测、迁移或放弃；不静默替换依赖，也不因版本更新就宣称旧结论错误。

## 6. 复杂任务拆解、规划与探索

不把研究限制为“操作失败后的笔记”。Agent 可以在初始信息不足时打开主问题，建立有依赖的子问题，并比较解决路径。例如：先验证观测解释，或先获取更多变化样本；自行决定哪条路径更值得尝试。

计划作为 task-local system-prompt overlay 或 research artifact 中的可选结构维护：子目标、前置依赖、成功判据、当前分支和替代路径。研究问题解释计划中的不确定性；skill/tool 承担可复用方法；memory 保存事实与适用范围；subagent 承担 agent 明确委派的分析。

子 agent 的角色、问题、输入资源版本和输出要求都由主 agent 创建。返回至少可表达结论、观察引用、未解决不确定性以及建议的下一检验。父 agent 选择是否采纳，结果可引起计划、研究或组件修订。默认不继承父 agent 全部 context；明确传入所需版本及有来源的观察。

ARC 子 agent 保持只读，主 agent 掌握环境动作。模型模拟、轨迹回放分析和子 agent 同意都不计为真实环境验证。把额外模型/计算成本计入同一个 task。

## 7. 让 task tools 能表达 agent 的新方法

入口迭代与执行器扩展分阶段交付，并分别评测，避免把包装预置 adapter 实现称为自主编程。

第一阶段保留既有 adapter 实现，并准确披露“仅包装预置实现”。第二阶段提供受限的纯计算执行器：agent 可创建程序正文、JSON 输入/输出 schema 和测试用例；程序只处理显式提供的公开观察快照和任务资源。

执行器由 runner 预置，具体程序由 agent 创建。实现时选择经验证隔离的解释执行环境，施加运行步数/时间、内存和输出大小边界；不能把普通宿主 eval 或 Node vm 当作安全隔离。默认无文件系统、网络、凭据、宿主进程或 ARC 环境句柄。依赖通过显式任务资源引用提供；未具备可靠隔离时保持 unavailable 并准确披露。

由此 agent 可以编写对象提取、观察比较、假设检验和组合验证等计算工具，而无需预置这些解题程序。工具测试结果必须记录精确程序版本、输入来源、输出和错误。Agent 自己写的测试只能证明程序满足那些测试，还需真实任务观察检验其假设。

新计算工具输出动作建议，不直接持有 ARC 动作权限。动作由主 agent 通过已有 adapter 执行。当前 arc.action_sequence 的批量行为需作为单独协议条件审查：每步计数、完整结果与失败前部分轨迹落盘、状态/关卡变化处理必须明确；不默认将其作为新入口实验的收益来源。

## 8. Context 与持续 self-harness

Task-local skill 是 agent 写的可复用方法，能引用子 skill、计算工具和证据。通过任务资源读取后，agent 决定放入活跃 context；没有 resources_discover、原生 skill reload 或全局技能扫描。

组件状态至少区分 draft/active/retired，验证状态独立保存。默认创建为草稿；创建调用可明确请求试用激活，返回 `validation=untested`。纯计算测试可在草稿上运行；真实动作仍受 adapter 约束。

事件链分别记录：创建、暴露、读取、调用、任务结果、agent 评估、后续修订。Skill 进入 context 只能证明暴露；如果技能是自然语言方法，按其行动的使用关系属于 agent 声明，不能自动当作因果收益。

Agent 可从任意环节进入：先建方法再研究，先研究再建方法，使用后直接修订，或停用无价值资源。后续 context 提供当前选择和相关反馈，使持续迭代可见。效果评估要绑定精确决策/版本和之后发生的观察；不能用创建前证据证明变更后收益。

## 9. 实现落点与验收

按三个可检验增量推进；第一阶段已实施，后两阶段保持 deferred：

1. **入口与披露（已实施）**：pi_task_local_self_harness.ts 初始直接披露组件操作，新增总览/context focus 入口；共享 research extension 明确加载通用方法；ARC 初始化提供对等入口并移除对 research 单边过强的提示。取消 skillPaths 注册和原生加载声明。统一一次初始 active-tools 配置，确保后续接口不被旧授权快照或其他 hook 覆盖。补 provider 工具表与方法/零状态审计。
2. **研究与资源关联**：扩展 research、skill/tool/system-prompt 定义与图投影，支持精确组件依赖、组合描述、独立认知状态、计划及有界 context 选择。增强效果引用时序检查。
3. **自主工具实现**：实现并验证纯计算隔离执行器、版本化程序、显式输入快照与测试入口；接入已实现的任务工具生命周期和组合验证。

相关文件：demo/pi_task_local_self_harness.ts、demo/pi_external_benchmark_research.ts、demo/auto_research_method.md、demo/pi_task_local_tools.ts、demo/pi_task_local_subagents.ts、demo/pi_task_research_graph.ts、demo/pi_provider_telemetry.ts、demo/pi_arc_agi_3_extension.ts、src/autoresearch_pi/arc_agi_3_e2e.py，以及对应 tests。

机制测试必须覆盖最终 provider 工具表，空任务直接创建组件，无 finding 创建试用能力，创建后下一请求可用，版本更新和停用，依赖变化，缺失引用，作用范围，隔离，context 省略提示和全部子调用成本。固定决策 fixture 仅证明接口可用。

真实 ARC 分两个问题评测：

- 先对比“现有 bootstrap”和“新入口/方法披露”，其余模型、数据、动作协议和执行能力相同，使用独立新 run；测入口发现、创建、实际使用和修订。
- 再固定入口，对比能力组合/纯计算执行器增量，观察是否出现基础能力验证、组合假设、端到端检验、反证后修订，以及复杂任务的有效分支选择。

每组使用预先指定的相同游戏集合与重复次数，不按是否产生 skill 筛选或丢弃运行。记录任务得分、关卡、动作、全部 tokens、延迟和错误，区分任务效果与机制使用。运行中不给 agent 注入“现在创建 skill”等人工引导；若安排示范测试，单独标注为引导测试。

若没有创建，检查最终请求是否真的披露入口、agent 是否打开、schema 是否调用成功、资源是否生效、是否有实际价值，再判断瓶颈。若只创建未使用、只自评未验证、只组合未重测，应分别报告。自发使用不能靠硬性调用配额保证，单次使用也不能证明持续优化或任务收益。

当前在跑的 ls20 run 保留为旧机制观察样本，本设计不在其执行过程中热修改实现或补写 agent 产物。

## 10. Continual Harness 源码参考与设计修订

参考目录只读；本次未运行其训练、verifier 或演化流程。以下为源码及测试阅读结论，不能据此声称已测得真实模型的自主使用率或优化收益。

### 已实现的具体机制

| 机制 | 源码位置（相对参考目录） | 本项目的采用方式 |
|---|---|---|
| 首轮直接披露 process_memory、process_skill、process_subagent、run_skill、run_subagent、harness_checkpoint | src/continual_harness_runtime/harbor_agent.py 的 _TOOLS 与 run（约 36、240 行） | 初始公开对应核心任务操作；没有内容不意味着隐藏创建接口 |
| Agent 直接 add/edit/delete 组件并提交 working generation | harbor_agent.py 430 行附近 | 保留已有具体组件 CRUD、独立版本和 append-only 记录；用 retired 代替删除历史 |
| 每轮工具完成后重建 system message，包含新 skills/memory/subagents | harbor_agent.py:296、610 | 借鉴下一请求立即可见；采用低于固定契约的 task context 投影，并限制工作集大小 |
| run_skill 返回指定技能与输入 | harbor_agent.py:449 | 借鉴显式读取入口；不把返回文本声称为程序执行，不需要 Pi native skill loader |
| run_subagent 以角色指令和指定输入发起额外模型调用 | harbor_agent.py:457 | 借鉴 definition/use 分离；继续使用本项目独立 Pi 子循环及 adapter 允许的只读工具 |
| harness_checkpoint(progress/stagnation) 主动调用 EvolutionEngine | harbor_agent.py:406 | 借鉴有意义反馈时点的复盘入口；研究对象、深度和组件选择由 task agent 决定 |
| 固定 prompt→skills→subagents→memory 四轮演化，合法提案应用到 snapshot | evolution.py:30、45、89 | 不继承固定四轮调度；提案合法与效果已验证分开记录 |
| 不可变 generation、trial working ref、CAS | state.py:98、122 | 借鉴历史保留、版本冲突检测和明确生效边界；沿用本项目组件版本，不引入全局 HarnessState |
| verifier 后演化并提升 current，下一 trial 从 current 开始 | finalizer.py:15；state.py:103 | 不采用跨任务继承；每个独立任务仍从空的派生资源开始 |

### 两条优化路径及其归因

该 runtime 确实实现了组件创建与修订，有两条来源不同的路径：

1. 主 task agent 自己调用 process_*，决定并写入具体内容。
2. 主 agent 调用 checkpoint 后，外部 EvolutionEngine 固定执行四次组件审阅；以及 verifier 后由插件调用同一演化引擎。

因此“产生了新 skill/subagent”还需要区分是主 agent 主动创造、checkpoint 委派产生，还是任务结束后的固定演化产生。第二、三种路径的存在不能单独证明同一任务中主 agent 自发开展多层 Auto-Research。

在线 checkpoint 目前只把 boundary/event 作为 evidence 传给演化引擎，没有自动汇集先前 harness_observe、phase_report 或完整终端轨迹。演化 accepted 表示输出格式/长度通过接收条件；没有对每个新组件做环境测试。run_subagent 为一次 LLM-only 调用，不包含独立工具循环。源码中也未见通用 task-tool 程序创建与技能组合验证接口。

这些差异不影响其作为入口和资源生命周期参考的价值，但决定了本项目仍需实现证据引用、组合验证、实际使用追踪与 agent 自主研究。

### 将 checkpoint 思想接入 Auto-Research

在有意义的反馈时点，agent 既可以直接修订组件，也可以使用现有 research_resource 打开一次有明确对象的复盘：

```text
research_resource.open(
  subject_kind="component|composition|strategy|research_method|task",
  subject_refs=[具体组件版本，可为空],
  question=agent 选择的疑问,
  evidence_refs=[本任务已发生的观察],
  evidence_to_seek=能区分解释的检验
)
```

这个入口把复盘纳入已有研究状态；运行时返回规范化证据、当前对象和读取引用，不自行启动四次模型调用。Agent 选择继续主循环研究，或通过自己定义的 subagent 委派一个具体子问题。子 agent 提供结论/候选修订，由主 agent 用组件工具采纳、验证或拒绝。

第一阶段无需再增加同义的 harness_checkpoint 工具；首轮方法说明和 research_resource 描述应明确它也能承担这种复盘。必要时以后加薄别名，但必须共享研究权威记录和执行语义。

由此保留 Continual Harness 的三项直接收益：入口初始可见、修改马上参与后续执行、反馈时点有明确的修订路径；同时保留本项目 task-local 从零、不加载 native skills、研究对象和深度由 agent 决定的要求。
