# Self 转化基线：先闭合最短路径，再逐层加回机制

日期：2026-10-28（Asia/Shanghai）。起点：`codex/meta-daemon-response-20261028` / `3ac02314`。实施分支：`codex/self-harness-minimal-path`。状态：基线、CONVERT 加层和五类组件入口已实现；真实模型行为及净收益未验证。遵循 [开发流程](../development-workflow.md)。

## 问题与可证伪命题

[E0 真实运行审计](../reports/2026-10-26-review-followup-audit.md)涵盖 28 个 su15 run 的 74 次 review：58 次写入 review，46 次指出循环成本，随后 0 次针对该成本的 Agent 可执行组件；8 次 consult-first 门槛阻止写入且咨询失败。这是已观察到的“识别 → 候选”断点，样本以 Qwen 为主、含 fork，不代表所有游戏或模型。现有 [CONVERT](2026-10-28-self-convert-guide.md) 已有本地功能证据，但自主创建与使用未验证。

本轮窄命题：在 native thin 的普通 Task 决策中，Agent 能用最少的创作手续完成 `python(code, save=name)` 的**写入并立即执行 → 读取语义结果 → 下一决策调用已保存工具 → 继续环境行动**；单独加入 CONVERT 后该路径仍可达，且不引入管理决策。若 Binder 只记录保存而不能马上运行、下轮不能调用，或 CONVERT 使保存必须先完成 Meta 合同，则命题失败。

减少的负担是写 frontmatter、mount、EXPECT/trial/DECISION 和咨询才能创作普通 Self 工具，以及等待下一轮才知道代码是否可执行。一次性计算、没有后续复用或预算不足时可不保存。权限、资源、版本、原子写入和环境动作边界继续由现有 runtime/Binder 负责。

## 设计与成本

新增显式 `--self-baseline` 配置，从最新 native treatment 复用 Pi session kernel、WASI Python、Binder、已保存工具调用、ARC bridge 和真实任务决策。它用短系统提示说明可运行的保存入口；关掉 ledger/critic、daemon/process、review/consolidation、refine/consult、work-memory 和常驻 loop/trial 提示。它不自动为 Agent 写文件，不增加新 worker、schema、动作 gate 或管理轮。默认 thin treatment 不变。

首次获益的最短路径：Agent 在任务决策 1 中识别复用价值并调用 `python(code, save=name)`；现有 Python 会话立即运行，Binder 校验并版本化保存，结果回到本决策；Agent 可同轮修改/重跑并采取环境动作。决策 2 的 Binder 索引使工具可调用，调用的实际结果进入任务决策，再继续动作。保存即首次运行，但保存、装配或自动 view 都不等于**后续语义使用**。失败回执在原决策可见，Agent 可修订或放弃；环境历史不回滚。

首个加层由 `--self-convert` 单独启用，沿用现有 repeatedWork→CONVERT 材料与 `data/convert.md`/`convert.jsonl`，只提示重复 Python 的样本、目标路径和可改骨架；Agent 决定是否采用。它不启用 process、daemon、trial 或复盘。单次输入成本是每次出现重复工作时的 CONVERT 文本；具体 token 和收益未测。基线和加层的配置写入 `run-config.json`，可作可复现比较。

| 转移 | 推进者与证据 | 等待、失败、放弃 |
| --- | --- | --- |
| 机会→识别→投入 | Agent 看当前任务及可选 CONVERT；`convert.jsonl` 只记送达 | 不适用或预算不足可跳过；送达不算采用 |
| 候选→执行→装配 | Agent 调 `python(save)`；Binder 记录 `components.jsonl`，Python 返回实际输出/错误 | 校验/运行失败原轮可修；保留版本边界 |
| 后轮语义使用→任务反馈 | Agent 调保存工具、读实际结果、据此行动；`component_runs.jsonl` 与轨迹可核 | 有调用不等于有行动贡献，需审查具体输出与后续选择 |
| 保留/修订/撤下 | Agent 决定；沿用 Binder 写入、删除、恢复 | 无价值可放弃；环境动作不可回滚 |

## 有界评价协议

本轮只运行免费诊断和脚本 provider 的真实 runner 接线验收，预算为 2 Task 决策、2 ARC 动作、600 秒；使用 mock ARC SDK、实际 thin runner/ARC bridge/Pi/Binder/工具执行。比较基线与仅加 CONVERT 两组，另跑默认 thin smoke 排查回归。断言保存返回 42、下一决策显式调用同一工具返回 42、两次真实 bridge 动作顺序正确，管理轮为 0，且配置和工具暴露符合预期。负例由现有 Binder/level review 回归检查覆盖；本轮未新增真实 provider、官方 ARC 或付费运行。父子 token、任务质量和自主识别不能从脚本探针推断。

真实行为试验的下一门槛：先确定 provider 配额与预算，再冻结同模型、推理、任务初态、动作/墙钟/父子 token 上限和独立样本；逐机会记录识别、投入、合法候选、首次运行、下一轮实际使用、动作贡献、合理不使用与失败。比较默认版、最短基线、基线+一个机制，不能把组件数当奖励。初拟探索上限为每组 12 Task 决策、8 动作、15 分钟、100k reported 父子 tokens；正式运行前需按实际 provider 额度和样本数定稿。`length`、取消、pending 与未知费用不记零。

## 实现与验证

入口：`src/autoresearch_pi/cli.py` 的 `arc-thin-e2e/arc-thin-smoke --self-baseline [--self-convert]`；`src/autoresearch_pi/arc_thin_e2e.py` 的 profile/验收；`demo/arc_thin_extension.ts` 与 `demo/prompts/arc_thin_self_baseline.md` 的决策装配；`tools/arc_thin_smoke_provider.ts` 的探针。默认配置保持原行为。

已运行：Python 编译、TypeScript 语法、`git diff --check`；`tests/arc_thin_level_review.test.ts` 8/8（包括 CONVERT 加层的保存/调用检查）；最终代码的 `arc-thin-smoke --self-baseline` 与 `--self-baseline --self-convert` 均 7/7 检查，2 决策、2 动作、0 review/daemon、`tools/answer.py` 由 Agent 保存并在后轮显式调用，两次实际输出均为 42；默认 `arc-thin-smoke` 通过，4 决策/4 动作/1 consolidation。最终接线产物分别在 `runs/self-baseline-final-20261028/`、`runs/self-baseline-convert-final-20261028/`、`runs/self-baseline-default-regression-20261028/`。

| 层级 | 状态 | Provider / environment | 结论边界 |
| --- | --- | --- | --- |
| 功能正确 | 通过 | 本地 Node/Python、定向 fixture | CONVERT 不阻止 `python(save)` 与后续工具调用 |
| 全链路可达 | 通过 | scripted provider、mock ARC SDK；实际 runner/bridge/Pi/Binder/WASI | 指定调用顺序可达，语义输出 42、环境动作 2 次；不证明自主行为 |
| 自主采用 | 未验证 | 无真实 provider 普通运行 | 不知道 Agent 是否自主识别/投入/复用，合理不使用也未评估 |
| 净收益 | 未验证 | 无匹配预算独立对照 | 不知道任务进展或父子总成本是否改善 |

## 下一层的进入条件与决定

### 五类组件入口扩展（2026-10-28，实施前）

新的机会：最短基线只把 Tool 的 `python(save)` 说明与接线验收完整覆盖；Memory 虽有专用工具，Prompt、Skill 和 Subagent 仍要由 Agent 重建目录与 frontmatter，Subagent 在基线中无法调用。CH 的普通决策提供 `process_memory/process_skill/process_subagent` 与 `run_skill/run_subagent`，而其策略 Prompt 由独立 Refiner 修改。借鉴其按组件类型管理和即时调用的入口，不复制其自动代替 Agent 编辑的权限。

窄命题：一个按类型的 `self_component` 保存入口复用现有 Binder、memory store、Python 与 consult，使普通 Task 可直接创建或修改 Tool、Memory、Prompt、Skill、Subagent；Tool 当次执行，Memory 当次回执，Prompt 下一决策生效，Skill 可按需读取，Subagent 可由 Agent 调用。省去手写路径、frontmatter 和额外管理轮。仅送达/保存/调用不证明实际语义利用。

该工具只在 `--self-baseline` 暴露，字段为 kind、name、content 及按需 description/allowed_tools；同名保存即修改。runtime 生成规范文件并继续执行 Binder 的权限、版本和校验，Memory 复用原 commit，Subagent 保持只读/计算的工具授权。Agent 仍判断创作价值和后续采用；Prompt 不在当前决策中偷偷改写缓存的 head。若某类保存成功却无法在其既定消费边界进入下一真实父轮，或新入口阻断原 Tool 路径，命题失败。

有界免费验收：本地工具契约检查与 scripted provider/mock ARC SDK 的真实 thin runner/bridge/Pi smoke，最多两 Task 决策、两环境动作；核对五类各自的有效回执、Tool 输出、Memory 下一轮读回、Prompt 下一轮投递、Skill 正文可读、Subagent 的实际语义回答，以及后续真实动作。另跑既有最短基线 smoke 防回归。真实 provider 自主采用与净收益仍待另行预定预算。

实施与结果：`demo/arc_thin_extension.ts` 仅在基线激活单个 `self_component(kind,name,content)` 工具，按类型调用现有 Memory commit、NativeRuntime Python 或 Binder；同名可改，`op="retire"` 可停用。Prompt 使用 active overlay 并在下一决策送达，固定控制核系统提示不由这个入口改写。Subagent 仅在已有有效定义后向父决策暴露 `consult`；基线允许同一决策内保存后发起咨询，子 Agent 仍不能执行环境动作。`demo/arc_thin_components.ts` 保留新工具名，防止同名 Python 组件覆盖入口。常驻新增一个工具 schema；实测 token 代价尚未知。

最终 scripted/mock smoke 在 `runs/self-components-accepted-20261028/summary.json`：15/15 检查通过，2 个父 Task 决策、2 个真实 bridge 动作、13 次 scripted parent 请求、1 次同模型 consult 请求、0 个管理轮/报错。Tool 同决策保存并显式调用，结果均为 42；Memory 后轮读回，Prompt 后轮实际进入父输入，Skill 后轮正文可读且使用后停用，Subagent 同决策返回语义文本。一次非法 Subagent 授权被 Binder 拒绝，原有效 v1 留存。最短 Tool 与 CONVERT 两组回归均通过（`runs/self-baseline-five-entry-regression-20261028/`、`runs/self-convert-five-entry-regression-20261028/`）；相关 Binder/NativeRuntime/决策装配 Node 检查 20/20，Python 编译、TS 语法和 diff 检查通过。脚本指定了全部调用顺序，因此 Prompt/Skill/Memory 的送达或读取不代表 Agent 据此改变行动。

| 五类入口的证据层级 | 状态 | Provider / environment | 边界 |
| --- | --- | --- | --- |
| 功能正确 | 通过 | 本地 Node/Python、Binder 校验、拒绝后保留旧版本 | 五类可提交，非法子 Agent 工具授权不替换有效版本 |
| 全链路可达 | 通过（指定路径） | scripted provider、mock ARC SDK；实际 runner/bridge/Pi/Binder/WASI | 五类保存/回执/既定消费边界可达，Subagent 有实际语义答复、父继续动作 |
| 自主采用 | 未验证 | 无真实 provider 普通 ARC 运行 | 不知 Agent 是否会选择合适类型、合理跳过或真正使用 Prompt/Skill/Memory |
| 净收益 | 未验证 | 无匹配预算独立对照 | 未知任务进展、父加子总成本及延迟影响 |

保留 opt-in 基线和 CONVERT 加层，作为以后每层的回归锚。先观察真实普通运行的主要损耗转移，再**一次只加入一个因素**：

1. **入口与证据**：若 Agent 仍只写 prose，先核对它是否收到具体样本、可运行路径和失败回执；必要时改善 CONVERT/事件包。不得用强制 trial 替代价值判断。
2. **事件 Refiner**：仅在实际轨迹证明需要服务诊断时，实验过关/GAME_OVER/停滞的事件触发与原始轨迹包。提案仍按当前权限边界由 Agent 决定是否采用；先量化原始回复→解析→Binder→消费的损耗，再简化格式。Refiner 的服务编辑单独记账，不冒充 Agent 自主创作。
3. **Meta process、台账、daemon**：分别证明它们提供基线无法提供的跨轮规则、反馈归因或维护服务；逐层加入并在每层重复最短保存/运行/后轮调用/动作探针。若阻断或拖慢基线，撤下该层，保留原始证据。
4. **真实对照**：只有自主采用有证据后，比较任务进展、首次有效行动延迟、父子总成本与合理放弃；不能凭触发率、组件数或调用次数宣布收益。

这不是宣布所有机制已迁移。[延后事项](../deferred-research-todos.md) 中的证据→行动、父子总成本和跨压缩认知连续性仍开放；此次没有修改 Auto-Research/子 Agent 边界，也没有向 Pi 注入开发规范。

### 任务代码直接进入 Self（2026-10-28）

新的机会来自用户报告的 ARC 行为：Agent 在 3 个环境动作中主动写了 18 次原生 Python，产出多类任务观察/分析代码，却把它们全部归为临时分析，没有保存 Self 组件。运行轨迹不在本地；本记录以用户提供的观察为证据，不把它表述为本地复核。关键断点是入口语义：原提示仅在“代码以后会有用”时才建议 `save`，而 CONVERT 还要求显式启用并等待重复代码信号。Agent 因而可以把已投入创作的任务代码合理地排除在 Self 之外。

窄命题：在 `--self-baseline` 普通任务决策中，明确将 Agent 为派生任务证据而编写的 Python 代码视作 Self 候选，并默认使用现有 `python(code, save=name)` 同步运行、保存为 view/tool；无需等待重复检测或启用独立 CONVERT 层。Agent 仍决定代码怎么封装、何时调用，以及后续是否修订/退役。只做真正短暂的算术或调试时，可用不保存的 `python(code)`。推翻条件：真实普通运行仍持续把面向任务证据的已写代码留作临时分析，或保存入口增加的执行/上下文成本抵消后续复用。

该提示假设被后续检查推翻：`python(save)` 原样保存提交代码，不能提升读取 session 活变量的函数。只更新提示并默认 `save` 会把 session 依赖直接送入 Binder，因此不作为有效转化实现。

### Session 函数辅助提升（2026-10-28，已授权实施）

**目标：** 减少将 session 工作记忆提升为 Self 时重复抄写/重建代码的成本，同时不把绑定当前 session 值的函数误发布为跨状态组件。

**方案：** 在 opt-in Self-baseline 提供 `promote_session_function(function)` 入口。Runtime 从当前 Python session 取回 Agent 命名函数的原始定义，并在只读检查步骤中列出其引用的 session 符号和动态运行时输入。该入口返回源码和依赖诊断，不自动保存；Agent 将适用输入改成显式参数/由当前 state 重算后，继续用既有 Self/Binder 保存及校验。Session 内的原函数不改动。用“纯函数显式输入”提示减少未来提升所需修改。技术栈仅复用现有 TypeScript NativeRuntime、WASI Python guest、PythonSession 与 Binder，不增加依赖、worker 或管理轮。

**不做：** 自动捕获/序列化当前数据、猜测 session 值应如何重新计算、自动改写闭包语义、改变默认 runtime 或重复工作阈值。上述行为会把状态快照伪装成可复用算法，或把语义决定交给 runtime。

**实现步骤：** (1) 在 NativeRuntime 序列化调用边界内增加 session 函数检查；WASI guest 仅恢复 namespace、提取精确函数定义并报告 AST 可见的外部名称；不执行被检查函数、不提交新 session 内容。 (2) 仅在 Self-baseline 暴露 `promote_session_function` 工具，返回原始源码、session 依赖和 runtime 输入类别；无 session、缺失函数、非函数和提取失败均返回明确回执，不更改 Binder。 (3) 修正已推送的默认保存提示，说明 session 与 Self 的边界、鼓励用显式输入编写可提升函数，并让 Agent 通过新入口取源码后再决定适配/保存。 (4) 更新本变更记录；保持 Binder 校验、五类组件入口、工具执行和动作边界不变。

**评审重点：** 检查点恢复后的函数源码与依赖是否一致；无 session/未知符号不会产生写入；session 变量与 `state/grid/history` 等 runtime 输入不会混为一类；被检查函数不会被调用；提取不改变工作内存、Binder 版本或任务动作。此回合只实施，不运行或新增测试；功能、全链路、自主采用、净收益均保留未验证，真实 provider ARC 运行用于后续采用与收益判断。

**实施结果：** `demo/arc_thin_native_runtime.ts` 增加串行 session 检查入口；`demo/arc_thin_components.ts` 通过现有 WASI guest 恢复函数定义并返回源码、参数、session依赖、runtime输入、其他全局名与未解析名；`demo/arc_thin_extension.ts` 仅在 Self-baseline 暴露 `promote_session_function`。新提示移除“默认保存”建议，明确 `save` 是原样发布，并描述显式参数/提升入口。未执行测试或真实 provider 运行；因此只记录为代码实现，功能正确、接线、自主采用和净收益均未验证。
