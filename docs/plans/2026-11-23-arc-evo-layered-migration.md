# ARC evo-middle-layer 迁移到三层设计，并在其上重建自进化

日期：2026-11-23（Asia/Shanghai）。状态：设计，未实现。
依据：[三层设计 v0.4](2026-11-23-arc-agi-3-layered-design-v0.4.md)（用户指定优先遵从，下称"设计文档"）。分支 `codex/arc-evo-middle-layer@833c59a` 及其工作树中未提交的改动。

> 对齐 Duck 后的接口、机制和开发阶段以 [对齐版开发方案](2026-11-23-arc-layered-duck-aligned-dev-plan.md) 为准；本文第 3–5 节的实现细节由它替代。

## 0. 结论

- **L1 基本可以直接复用。** bridge + 官方 SDK、WASI 持久 Python 内核、存储和遥测都已具备，而且 WASI 已满足设计文档对沙箱的要求。
- **问题集中在 L2 和 L3。** 当前任务轮注册了十几种工具；自进化在单独的 Meta 归纳和缺口窗口里进行；每个决策以一个动作结束，并且每轮重建上下文。结果是管理成本压过了任务本身。
- **迁移方式：** 不在 440 KB 的 `arc_thin_extension.ts` 里原地改。新建一个并行的 `layered` profile，复用 L1 和部分 L2，L3 重写。旧的 evo 路径冻结，作为对照组。
- **自进化重新定义：** 从"在 Meta 窗口里用 `reflect_*` 修改 SelfRoot 组件"，改为"Agent 在普通任务轮往内核工作区写文件，宿主在明确的边界激活它、记录版本和使用情况"。跨局保留什么由离线评测决定。不再有单独的进化回合。
- **分六个阶段推进**，每个阶段只改一个主要因素，各有一个可推翻的命题。

## 1. 问题与命题

### 真实材料

| 运行 | 结果 | 依据 |
|---|---|---|
| su15 / az Gemini 3.1 Pro（evo 默认） | 摘要快照：29 动作、1 关、约 297 万 reported token。另一份记录：到第 42 个动作时已有 226 次 `python` 调用，会话里累积 98 个函数定义，模型仍在重写 `find_6s` 一类函数 | `runs/arc-su15-evo-833c59a-az-gemini31pro-20261120`；[11-21 记录](2026-11-21-arc-python-observation-and-capability-design.md) |
| su15 / gpt-6-luna，两次 | 均为 10 动作、0 关；15.2 万和 21.8 万 reported token；20 和 26 次请求；8 和 10 次 `read_self` | `runs/arc-su15-openai-gpt6-luna-{short-answer,live-history}-20261123` |
| su15 / az qwen3.8-27b，多次 | 0 动作。调查阶段触发单轮超时或 token 上限，另有多次 provider 容量错误 | `runs/arc-su15-observer-az-qwen38-27b*-20261122` 等 |
| Evo Meta 七焦点 / 缺口路由 | 只有脚本 provider 的接线验证；真实模型的自主采用和收益都未验证 | [11-19 记录](2026-11-19-arc-evo-meta-core.md) |

对照设计文档的证据：Duck 和 Seal 都只给模型一个 Python 入口。同一模型在 Seal 的极简 harness 里得 66.7，在通用工具循环里只有 0.17；Duck 还观察到手写专用工具整体没有帮助。

### 窄命题

同一模型、相同预算下，按设计文档构造的 `layered` profile 相比当前 evo 默认路径，每 token 完成更多有效动作，关卡数不低于后者。具体做法是：只给一个 `python` 工具，`submit_actions` 可以批量执行动作，每回合给一张最新帧图像，一局保持一个连续会话。

- **推翻条件：** 相同预算下关卡数更少；或者每动作 token 不降；或者批量动作造成的浪费动作超过省下的模型请求。
- **减少的负担：** 工具 schema 和能力目录不再常驻；不再需要 `read_self` 回读；Meta 管理回合消失；每个动作不再需要一次模型请求；同一网格计算不再重复编写。

## 2. 现状按三层盘点

| 现有模块 | 归属 | 与设计文档的差距 | 迁移动作 |
|---|---|---|---|
| `src/autoresearch_pi/arc_agi_3_bridge.py`：SDK、`/state`、`/action`、`/action-lease`（单次最多 16 个动作）、按 5× 基线推导预算、NOT_PLAYED 时自动 RESET、replay / fork | L1 环境运行时 | 双 RESET 守卫未核实；动作没有自然名 | 保留。守卫加到动作网关 |
| WASI CPython 内核（`demo/pi_task_python_kernel*`，`@antonz/python-wasi`）；`ARC_THIN_PYTHON_SESSION=1` 时为持久会话 | L1 内核与沙箱 | 默认是一次性执行，持久会话只是兼容模式；没有 numpy | 保留 WASI；`layered` 默认持久。numpy 放到 P3 单独消融 |
| runner `arc_thin_e2e.py`：Pi RPC、模型配置、预算、恢复、摘要 | L1 进程 + L2 循环 | 每个决策一次 `kernel.prompt`，并以一个行动调用结束 | 复用启动、预算、恢复和摘要；新增"分段"循环模式 |
| `harness/*.jsonl`、`data/frames/`、`results/`、Pi session | L1 存储 | 无 | 保留 |
| CH 视图的 PNG 渲染 | L1 渲染 | 放大倍数没有按模型调整 | 参数化 |
| Python 命名空间 `state / grid / prev_grid / history / env`（`env.act`、`env.revision`） | I1 Python 接口 | 命名不同；存在两个行动入口（`arc_action` 工具和 `env.act`）；没有 `stop_on` 和 `confirm_full_reset` | 在内核里加一层按设计命名的薄适配，`submit_actions` 基于现有 `env.act` 和 lease 实现 |
| 任务轮工具：`arc_action`、`python`、`memory`、`save`、`promote_session_function`、`self_component`、`skill`、`run_skill`、`prompt`、`publish_observer`、`read_self`、`request_evolution`、`adapt_policy`、`ask_analyst`、`refine`、`daemon_reply`，以及文件和 git 工具（按开关挂载；evo 默认下任务轮 schema 约 8–9K 字符） | I1 工具协议 | 设计文档只要 `python`，`observe`、`notebook` 可选 | `layered` 只注册 `python` |
| CH 视图、差分、动画关键帧差分、observer 语义视图 | L2 观测管线 | 内容丰富；默认附带文本网格 | 差分复用为状态行和 `diff` helper；默认改为图像加状态行，文本网格按需读取 |
| `arc_thin_native_context.ts`：每决策重建、工具归档、短答案、历史投影 | L2 上下文管理 | 每决策重建相当于折叠，但丢掉了会话连续性；没有"淘汰 → 折叠 → 摘要"三级 | 一局一个连续会话；复用归档做折叠；按目标长度淘汰；摘要放到 P3 |
| `memory` 工具、task memory、SelfRoot 定义、observer state、ledger | L2 记忆 | 载体多且相互重叠 | 收敛为 `World model:` 标签、`harness/notes.md`、内核文件、bridge 历史 |
| runtime fact 投递、issue、WINDOW CHECK、level / stall / spin review 回合 | L2 回合注入 | 复盘是用模型回合实现的 | 改为事件消息 |
| bridge 预算、lease、request policy、token 预留 | L2 网关、守卫、预算 | 已经较完善 | 保留 |
| `request_evolution`、Meta passes、每 50 动作或 6 次请求的兜底触发 | L2 循环 + 进化 | 都是管理回合 | 不进入 `layered` |
| `ask_analyst`、refine / critic、daemon、子代理 | L2 子代理 | 设计文档的 MVP 不做 | 不进入 `layered` |
| request accounting、provider telemetry、`reuse_report`、summary | L2 遥测 | 已经较完善 | 复用 |
| `demo/prompts/arc_thin_native_*.md` | L3 Prompt | 缺计分与成本、方法、Duck 的提示；大部分篇幅在介绍 harness 能力 | 按设计文档附录 C 重写 |
| SelfRoot 组件（prompt / skill / tool / memory / subagent / observer）及策略 | L3 可进化组件 | 机制过重 | 见第 3 节 |

## 3. 自进化在三层架构上的位置

按 harness 设计原则（主线 `thin-arc-self-harness` 的 `docs/harness-design-principles.md`，本分支没有这个文件），自进化指 Agent 在任务中调整自身 harness，并且调整在后续真实工作中生效。在三层架构里，各层分工如下：

| 层 | 在自进化中的角色 | 任务内能否被 Agent 修改 |
|---|---|---|
| L3 内容 | 被进化的对象：prompt 叠加、skill、helper / 工具、observer、memory、世界模型；subagent 后置 | 能 |
| L2 参数 | 上下文 K 值、各种阈值 | MVP 不开放；P3 以后视消融结果再定 |
| L2 机制 | 进化服务：激活、版本、使用记录、回执 | 不能 |
| L1 | 存储与沙箱执行；环境、计分、预算、守卫的完整性 | 不能 |
| 贯穿 | 评测决定跨局保留哪些内容 | 由离线循环或开发者决定 |

### 3.1 任务内（在线）：写文件即进化

| 组件 | 文件约定 | 激活时机 | 失败处理 |
|---|---|---|---|
| tool / helper | `harness/lib/*.py` | 下一次 `python` 调用前自动加载进命名空间 | 保留上一版，在状态行报告错误 |
| 世界模型 | `harness/lib/world_model.py`，配 `test_world_model(history)` | 同上 | 同上 |
| observer | `harness/observers/*.py`，入口为 `process(obs, state) -> {facts, state}`，只读 | 下一次新观测时运行，facts 附在动作后的消息里，有长度上限 | 回退到原始观测 |
| memory | 回复中的 `World model:` 标签；`harness/notes.md` | 下一条消息自动携带 | 无 |
| skill | `harness/skills/*.md` | 每段开始时列出名称，正文按需读取 | 无 |
| prompt 叠加 | `harness/prompt.md` | 下一个分段点，作为系统提示末尾的独立段 | 超长时截断并报告 |

机制保持最小：
- Agent 用普通的 Python 文件读写完成修改，不需要 `save / promote / reflect_*` 这类工具。删除文件即撤下组件。
- 宿主在沙箱里做语法和 import 检查。版本用工作区里已有的 git 记录。每次变更向 `harness/evolution.jsonl` 写一行：路径、哈希、决策序号、动作序号。
- helper 的调用次数和 observer 的运行次数写进 jsonl，供离线分析，**不注入上下文**。
- 不设 Meta 窗口，也不设强制复盘。只在关卡完成时发一个事件，请模型写 2–3 行笔记（设计文档 4.5）。

与现状相比：`request_evolution`、`decide_exit`、gaps、`reflect_component / reflect_orchestration`、`save`、`promote_session_function`、`self_component`、`skill`、`run_skill`、`prompt`、`publish_observer`、`read_self` 都不再需要。原有五类组件中，除 subagent 后置外，其余能力都保留。

现有 evo 资产的去向：
- observer 改成文件约定，复用其沙箱执行和失败回退逻辑。
- 重复检测等 runtime fact 改为离线评测指标（`reuse_report`），以后需要时再考虑作为事件投递。
- SelfRoot 的版本管理由 git 代替，ledger 由 `evolution.jsonl` 代替。

### 3.2 跨局（离线）：评测决定晋升

- 每局结束时导出 `harness/` 快照和该局指标。候选的库条目可以由局后的一轮整理产生，也可以由离线分析产生。
- 只有在 held-out 游戏上经过多次重复运行、确认有增益后，才晋升（对应设计文档第 5 节和 priors.md 的规则）。
- 晋升后的库以只读方式预装到下一局的 `harness/lib/base/`，Agent 可以在自己的文件里覆盖它。

### 3.3 Harness 层：开发循环

设计文档第 5 节的配置档和单因素消融就是这一层的进化，以后可以由外层 Agent 提出 L3 配置改动并做重复评测。本方案不实现这一层。

## 4. 分阶段

| 阶段 | 内容 | 命题 / 验收 | 预计改动 |
|---|---|---|---|
| P0 L1 接口 | 内核薄适配层：`current_frame`、`previous_frame`、`history`、`transitions`、`last_action_result`、`valid_actions`（自然名加原始 id）、`submit_actions(actions, stop_on, expect, reasoning, confirm_full_reset)`。网关增加：双 RESET 确认（先核实 bridge 是否已有）、UNDO 开关、GAME_OVER 之后只允许 RESET | 功能正确：Node 定向测试；foundation smoke（生产 bridge 和 Pi、mock SDK、脚本 provider）跑通 `submit_actions` 的 `stop_on` | 200–300 行 |
| P1 `layered` 最小闭环 | 新增 `demo/arc_layered_extension.ts`：只有 `python`；按附录 C 写系统提示；每回合注入最新帧图像和状态消息；`World model:` 标签携带；复用归档做折叠，按目标长度淘汰；`agent_before_settle` 续航并带预算守卫；runner 新增模式：一局一个 Pi 会话，在关卡变化、每 N 个动作或 length 停止时分段；关闭 Pi 面向编码的自动 compaction | 见第 1 节的命题；对照组为当前 evo 默认 | 400–600 行（见第 7 节） |
| P2 任务内进化服务 | 实现第 3.1 节的文件约定、激活、git 版本、使用记录；observer 迁移到文件 | 在出现重复计算的运行里，相比 P1 每动作的重复网格扫描和 token 更少，关卡不退化。只改这一个因素 | 约 300 行 |
| P3 L2 升级 | 摘要式 compaction、状态图与 BFS、`expect` 校验与 SURPRISE 事件、卡死事件、带 numpy 的内核 | 每项单独消融，有正收益才保留 | 逐项估算 |
| P4 跨局进化 | 局末导出、held-out 晋升、库预装 | held-out 游戏上，预装库不差于空库 | 后续估算 |
| P5 Kaggle | 本地 vLLM；把 L2 移植到 Python | 9 小时内跑完 110 局 | 后续估算 |

旧 evo 路径：P1 评测之后，如果 `layered` 不差于 evo，就把 evo Meta 路径标为退役（代码保留、冻结）；否则定位断在哪个转移，再改一个因素。

## 5. 运行前实验协议（P1）

- **目标证据层级：** 全链路可达，然后是净收益。
- **比较对象：** `layered` 对比 evo 默认（`833c59a` 加当前未提交改动的冻结快照）。其余差异（提示、工具面、循环方式）是一组整体改动，P1 不拆分，P2 起单因素推进。
- **模型与任务：** 建议 gpt-6-luna（OpenAI，近期可用）；如 provider 稳定，加 az qwen3.8-27b。游戏 su15、ls20、ft09。思考设置两组保持一致。**待用户确认。**
- **样本：** 每组每个游戏至少 3 次独立运行，报告均值和离散程度。探索样本与确认样本分开。
- **预算：** 每次运行固定 reported token（例如 30 万）和墙钟（例如 60 分钟）；动作上限沿用 bridge 的 5× 基线。provider 失败的样本单列，不归因给 harness。**付费预算需要用户授权。**
- **指标：** 关卡数、每关动作数、每动作 token（父子合计）、请求数、首次有效动作延迟、批量动作中被 `stop_on` 截停的比例、`python` 调用次数和重复率。
- **负例：** provider 失败；`length` 停止；GAME_OVER 后的恢复；批量动作走错；会话超出窗口后的淘汰；模型提前结束 run。

## 6. 与现有规则的冲突与处理

- **ARC self-harness 验收规则**（根 AGENTS.md）要求五类组件矩阵和 `arc-harness-smoke`。[开发流程](../development-workflow.md) 第 3 节说明这只适用于冻结的旧路径。`layered` 用 foundation smoke 和真实运行验收。
- **"观测表示遵循用户最新约定"：** 设计文档是最新约定，即每回合给图像，文本网格按需读取，`current_frame.grid` 始终可取。
- **五类组件：** MVP 没有 subagent。harness 设计原则不要求每次改动覆盖五类，符合原则。
- **"不预置固定阶段顺序"：** 设计文档的方法只写在提示里作为建议，harness 只强制预算、守卫和事件，两者一致。
- **延后事项**（[deferred-research-todos](../deferred-research-todos.md)）：A（adapter 边界）正是三层划分要解决的；C（父子总成本）对应每动作 token 指标；D（跨压缩连续性）对应淘汰和折叠加 `World model:` 标签。拿到证据之前不改变这些事项的状态。

## 7. 成本与风险

- **P1 超过 300 行的原因：** 它要替代的是 13 个以上的工具和每决策重建这一整条路径，同时不新增任何常驻机制。旧扩展保持不动，所以会有部分代码重复，这是可以接受的。
- **Pi 自动 compaction** 默认产出面向编码的摘要，必须关闭或改为自定义（设计文档 3.2）。
- **批量动作走错**会浪费动作，用 `stop_on` 和关卡变化时停止来限制。
- **WASI 没有 numpy**，纯 Python 处理 64×64 网格可以接受。持久内核单次调用的中位延迟此前测得约 129 ms。
- **az 的容量错误**会混淆结论，优先使用当前可用的 provider，并单列失败样本。
- 工作树里还有另一个会话未提交的 24 个文件。P0 动内核之前要先确认它们的归属，避免混在一起。

## 8. 证据层级

| 证据层级 | 状态 | Provider / environment | 产物及结论边界 |
|---|---|---|---|
| 功能正确 | 未验证 | 尚未实现 | 本文只是设计 |
| 全链路可达 | 未验证 | 尚未实现 | 无 |
| 自主采用 | 未验证 | 无真实运行 | 无 |
| 净收益 | 未验证 | 无对照 | 无 |

## 9. 交付决定

- 当前只完成迁移设计，没有改动 runtime。
- 下一步是 P0：L1 接口适配，可逆，不需要付费。P1 的真实对照需要用户确认模型、游戏和预算。
