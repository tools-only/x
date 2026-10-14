# Meta-harness 变更记录：python 会话改为常驻 kernel，减少运行时重建上下文

日期：2026-10-14（Asia/Shanghai）。状态：实现（功能与确定性接线已验证；真实模型 1 次 10 动作试跑，受时间截止限制，命题未检验）。
分支：`claude/kernel-20261014`，基于 `claude/objective-shaw-9d0ead`（52ef2f0a，cont-01/cont-01r 的默认配置），之后合入该分支的 8bdcacf0（去掉单因素对比开关，四项连续性改动保留为默认）；合并后重跑受影响的 8 个测试文件（仅基线已有的 1 项失败）与 activation/receipts 两项 smoke（`tmp/smoke-*-3`，均通过）。

## 问题与命题

- 真实失败/机会及材料：
  - 观察（cont-01，`runs/arc-continuity-claude-20261014/cont-01/arc-run/harness/`）：python 会话被实际使用（7 次提交，4→29 个名字），没有 over_capacity / not_saved / rolled_back；但决策 2 的调用在重建会话里已有的东西：列 `data`/`results`/... 目录、`json.load(open('data/current.json'))`（`grid`/`state` 已是名字）、逐行读 `data/trajectory.jsonl`（`history` 已是名字）。pilot-02 决策 1 打印整个状态，结果 188,009 字符。
  - 观察（同目录 `wasi_runs.jsonl`）：每次 python 调用约 2.2 s 宿主墙钟，其中 compile 1.3–1.5 s、guest 约 0.45 s；每次调用都重新编译解释器、还原整个命名空间。
  - 观察（代码）：`env.act` 靠重放实现，动作后从头重跑代码，要求代码确定（[arc_thin_components.ts](../../demo/arc_thin_components.ts) 旧的 `_NeedAct` 路径）；会话里有什么只出现在当次工具结果的 `(python session: +a)` 行里，历史截断或压缩后就看不到；压缩摘要不知道会话还在。
  - 对照（Prime Agent 7d442aaf，`tmp/loop-memory-audit-20261014/prime/`）：常驻 CPython REPL；`host_request` 让 cell 在调用处挂起等宿主回答；会话恢复时告诉模型恢复了哪些名字；压缩提示里写明 kernel 继续运行、请记下值得复用的名字。
  - 推测（未验证）：重建工作的根因是代理不知道会话里有什么，以及系统提示/历史行把同一事实指向 `data/` 文件。
- 窄命题：父代理的 python 会话放在一个常驻 kernel 中，并在每个决策的 working set 列出会话持有的名字（及类型/大小），压缩摘要被告知会话继续存在；在此条件下，决策 2 起的 python 调用改用已有名字，而不是重读 `data/` 文件或重新打印，使每个决策的工具结果字符数（运行时上下文增长）和 python 调用数下降，且任务进展不低于 cont-01/cont-01r。
- 减少的负担：重读与重算的调用、为了"看见"而整段打印、重放带来的确定性约束、每次调用的解释器编译与命名空间还原。
- 适用/不使用/推翻条件：只在代理确有可复用的名字时生效；首个决策无会话时 working set 不加行。推翻：同预算下决策 2+ 重读 `data/current.json`/`data/trajectory.jsonl` 的调用不减少，或每决策工具结果字符数不降，或 kernel 频繁终止/重启，或列表被忽略。
- 范围及非目标：只改父代理的 `python` 工具。保存的工具、view、consult 子代理仍是每次新沙箱（它们本就不共享会话）。不改 MAX_ACTS（24）、历史投影、memory、系统提示、action 边界。

## 设计与成本

- 选择与取舍：
  - 不换成本地 CPython（Windows 上无法恢复 WASI 的隔离），也不引入 Jupyter。沿用同一个固定版本的 python.wasm，只把实例的寿命从"一次调用"改为"一个会话"。
  - 宿主通道：guest 往 fd 1 写一帧（`\x1e` + JSON），wasmtime 的 stdout 回调在 guest 线程上同步执行，宿主在回调里等父进程回答，把回答写进一个只读预挂载目录 `/kernel/<n>.json` 再返回；guest 随即读取。这样 `env.act` 和按需读文件都在调用处等待，不重跑代码。验证脚本 `tmp/kernel_spike.py` 先证明了可行（`stdin_file` 追加不可行：guest 读到 EOF）。
  - 仍然每次调用后写检查点（原有的版本化、校验、回滚机制不变），用于 kernel 终止与运行重启后的恢复。检查点写不进去（超出 128k、不可 pickle）时，live kernel 中值仍然有效，只是重启会丢；回执相应改写，且同一提示只说一次（重复提示会挤占运行时上下文）。
  - 名字指向运行时对象（state/history/env）的，在每个 cell 开始时指向当前对象，与恢复检查点时的行为一致；工作区模块（`lib/`、`tools/`）每个 cell 重新导入，已绑定的名字保持原对象（IPython 语义）。
  - 最终表达式的值绑定为 `_`（不进检查点）；结果被回执截短时提示完整值在 `_`。
  - 单个 cell 返回给宿主的打印/值上限 240k 字符，超出的部分不返回但值仍在会话中，避免一个大结果把 kernel 打死。
- 生命周期：kernel 由 `NativeRuntime` 在第一次父 python 调用时启动；每次调用一个 cell；kernel 进程结束（超时、中断、陷入）后下一次调用启动新 kernel 并从检查点恢复，回执告诉代理上一个为何结束、恢复到哪个版本。
- 首次获益路径：无新增模型决策。代理照常调用 `python`；列表出现在下一个决策的 working set。
- 新增与移除：
  - 新增常驻内容：working set 的 `PYTHON SESSION (...)` 一行（≤900 字符；只在当前 head 中，不随历史累积——activation smoke 第 10 个请求的 transcript 中只出现 1 次）；`python` 工具描述一句；压缩指令一句。
  - 移除：动作重放与确定性要求（kernel 路径）；每次调用的解释器编译与命名空间还原。
  - 无新工具、无新必填字段、无新门禁或 worker。
- 权限/版本/环境边界：解释器与运行时身份校验不变（`RUNTIME.identity`）；guest 只有 WASI 导入；唯一的预挂载目录是宿主私有临时目录且对 guest 只读；kernel 内存上限 256 MB；每个 cell 计算时间 20 s（等待宿主不计）；动作仍经 `actForCode`（via、MAX_ACTS、refusal 不变），伪造帧不能越过宿主检查；文件请求经 `workspace.path` 与快照校验。
- 放弃与恢复：`ARC_THIN_PYTHON_KERNEL=0` 回到每次新沙箱 + 检查点 + 重放；`ARC_THIN_SESSION_VIEW=0` 去掉列表。两项记入 `run-config.json`（`python_kernel`、`session_view`）。

## 运行前实验协议（未执行，待授权）

- 目标证据层级：自主采用与成本方向（探索性）。
- 主要变量与比较器：kernel+列表（本分支默认）对 cont-01/cont-01r（52ef2f0a 默认配置）。如需分离因素：再加 `ARC_THIN_SESSION_VIEW=0` 一格。
- 模型/provider/任务：yibu/qwen3.8-27b，thinking high，ls20，text+image，query 观测；与 cont-01 相同。
- 样本：每格 2 次顺序运行（cont-01 已有 2 次）；单次只作线索。
- 预算与停止：20 动作 / 600 s / token 上限（未缓存 input + output），与 cont-01r 相同。
- 主要指标：每决策工具结果字符数；决策 2+ 读 `data/current.json`、`data/trajectory.jsonl` 或列目录的 python 调用数；python 调用数；未缓存 input + output；动作数与完成决策数；kernel 重启次数；python 调用墙钟。
- 负例：代理不定义任何名字（列表为空，不应出现）；kernel 超时后恢复；超出检查点上限的会话。
- 遥测：`wasi_runs.jsonl`（mode=kernel，fresh、wall/wait/compute_ms、acts、files_fetched）、`python_session.jsonl`、`working_set.jsonl`（`python` 段长度）、`provider-inputs.jsonl`。

## 实现与验证

- 改动入口：
  - [demo/pi_task_python_kernel.py](../../demo/pi_task_python_kernel.py)：常驻 WASI 宿主（帧、回答目录、计算时间计时、终止原因）。
  - [demo/pi_task_python_kernel.ts](../../demo/pi_task_python_kernel.ts)：`PythonKernel`（启动、一次一个 cell、请求/回答、中断即终止、空闲时不占 Node 事件循环）。
  - [demo/arc_thin_components.ts](../../demo/arc_thin_components.ts)：guest 程序拆为 `_begin`/`_cell`；`_kernel['live']` 时 `env.act`/读文件走 `_rpc`；会话在 live kernel 中只恢复一次；`_brief` 与 `brief` 报告；结果上限；`nativeKernel()`。
  - [demo/arc_thin_skill_guest.ts](../../demo/arc_thin_skill_guest.ts)：会话执行时 `_` 绑定最终值。
  - [demo/arc_thin_python_session.ts](../../demo/arc_thin_python_session.ts)：`commit(report, live)` 的 live 回执、重复提示只说一次、`holding()`/`view()`、`kernelEnded()`。
  - [demo/arc_thin_native_runtime.ts](../../demo/arc_thin_native_runtime.ts)：`executeKernel`（动作与文件请求、MAX_ACTS、日志）；父会话走 kernel，其余不变；kernel 结束/重启回执；`sessionView()`。
  - [demo/arc_thin_extension.ts](../../demo/arc_thin_extension.ts)：开关、working set `python` 段、工具描述、压缩指令。
  - [src/autoresearch_pi/arc_thin_e2e.py](../../src/autoresearch_pi/arc_thin_e2e.py)：`run-config.json` 记录两项开关。
- 功能/回归检查（Windows，Node 25.5 `--experimental-transform-types`，Python 3.12 + wasmtime 49）：
  - 新增 [tests/arc_thin_kernel.test.ts](../../tests/arc_thin_kernel.test.ts) 4 项：不可 pickle 的值在 kernel 中可用且提示只说一次；动作前代码只运行一次（含随机数），两次动作在同一 cell 内完成；运行时拼出的文件路径在 cell 内按需读取；`_` 与截短提示；会话列表内容；中断 → kernel 终止 → 下一次从检查点恢复并说明；运行重启恢复；超出检查点上限时值仍在、提示一次、`del` 后恢复写入；`pythonKernel:false` 仍是重放路径。
  - 更新 [tests/arc_thin_activation.test.ts](../../tests/arc_thin_activation.test.ts)（超出上限的语义）和 [tests/arc_thin_native_runtime.test.ts](../../tests/arc_thin_native_runtime.test.ts)（kernel 的日志字段）。
  - 全部 32 个 `tests/arc_thin_*.test.ts`：150 项中 145 通过、5 项失败；5 项在基线（52ef2f0a 的独立 worktree，未改代码）上同样失败，与本改动无关，未修：`saved code acts in a closed loop ... unsaved code cannot act`（未保存代码现在可以行动）、`python session never stores runtime objects ...`（Writer 定义在恢复时被拒的期望已过时）、`arc_thin_receipts.test.ts` 的 3 项（回执长度/短 ID/部分单行标记）。
  - 确定性全链路（mock ARC SDK、真实 bridge、真实 Pi、native thin 扩展、WASI、脚本化 provider）：`python tools/run_foundation_smoke.py tmp/smoke-activation-1 activation` 通过，新增断言：一个 kernel 服务全部父 python 调用（`fresh` 仅 1 次）、`python save=` 的两次动作在 kernel 内完成、后续决策 head 含 `PYTHON SESSION (... plus_one() ... kept_value 41`；kernel cell 墙钟 0–250 ms（首个含启动 1.7 s），旧路径约 2.2 s/次。`receipts` 脚本通过：Pi 重启后第二个 kernel 从检查点恢复（`→ [[41,1],42]`），压缩指令进入两次实际 summarizer 输入，整个运行恰好 2 个新 kernel。最终代码上重跑两项（`tmp/smoke-activation-2`、`tmp/smoke-receipts-2`）均 `passed: true`。
- 真实运行 kernel-01（用户授权 10 个动作；c29a7f03 = 本分支合入 objective-shaw b215905a；ls20、yibu/qwen3.8-27b、thinking high、text+image、query 观测、100k 预算 token、600 s；产物 `tmp/arc-kernel-20261014/kernel-01/`，worktree 内未入库，启动脚本同目录 `pilot.py`）：
  - 结果：600 s 截止，1 个完整决策 + 第 2 个决策未完成，4 个动作，0 关；预算 token 55,854。cont-01r（同配置、20 动作上限）在 600 s 内 2 个决策、10 个动作。单次运行，且时间完全由模型生成决定，不能归因于 kernel。
  - 时间去向：5 个父请求，第 4 个请求 9,087 输出 token（推理 8,795）用时 3 分 23 秒，第 5 个请求到截止仍未完成。python 两次调用：kernel 启动 2.0 s（编译 1.27 s）+ cell 0.20 s，第二次 cell 0.06 s，`fresh` 只有第一次；未发生重启。
  - 语义使用：第二次 python 调用直接使用第一次留下的 `g2`/`g3`/`g4`（未重读帧），但重新定义了会话中已有的 `diff`。两次工具结果分别 1,343 和 684 字符，没有整段打印。
  - 未达到的环节：working set 的 `PYTHON SESSION` 行只在下一个决策出现，而第 3 个决策没有开始，所以会话列表与压缩提示在这次运行中都未被模型看到；"决策 2+ 不再重读 data/" 无法评估。
- 真实运行 kernel-02（用户要求取消全部阈值重跑：无 token 上限、无时间截止，仍为 10 动作；其余同 kernel-01；`python -u tmp/arc-kernel-20261014/pilot.py kernel-02 10 0 0`；产物 `tmp/arc-kernel-20261014/kernel-02/`，转录摘录 `kernel-02-session.txt`）：
  - 结果：`budget_exhausted`（10 动作用完），5 个决策，0 关，1,275.7 s；17 个父请求全部完成，预算 token 326,286，报告 token 499,086；无 length/idle 中断，无整理（consolidation 0）。
  - 时间去向：仍由模型生成决定。决策 4 的两个请求分别输出 12,624 与 16,916 token（推理 12,357 / 16,576），约 4.5 分钟和 5.5 分钟；决策 2 的一个请求输出 7,183 token。kernel：只有 1 个新 kernel（启动 3.4 s，编译 2.1 s），其余 13 个 cell 计算 31–312 ms；行动 cell 1.25–3.7 s，几乎全是等待动作返回；14 次调用中 6 次在 cell 内行动（1/1/2/4/2 个动作），无重放、无重启、无 unsupported。
  - 会话增长：`python_session.jsonl` 13 次提交，名字 5 → 23，函数 1 → 5（`diff`、`bbox_of_color`、`render`、`motif_pos`、`ones`）。
  - 会话列表到达模型：决策 2–5 的 working set 都有 `PYTHON SESSION` 行（python 段 238/296/311/490 字符，均值 267，占 working set 均值 3,197 字符的 8%）。
  - 语义使用：决策 2–5 都直接使用会话中的 `diff()`、`g0`、`grid`、`prev`；决策 3 一个 cell 内 2 个动作，决策 4 定义 `motif_pos` 等后一个 cell 内 4 个动作，决策 5 复用 `motif_pos`/`diff` 后 2 个动作。没有重新定义 `diff`（kernel-01 中重定义过）。
  - 重建调用：只出现在决策 2 —— 读 `results/r000001.txt`（18,281 字符）、`data/ledger.md`、`data/memory.md`，遍历目录，`json.load(data/current.json)`，读 `data/trajectory.jsonl`。决策 3–5 没有 `read` 调用，也没有读取 `data/` 文件。
  - 每决策工具结果字符：986 / 23,905 / 2,172 / 6,277 / 561。决策 2 的 18,281 来自决策 1 整段 `print(fb)` 产生的回执（56,198 字符截为回执，提示可用 `_`），模型没有用 `_`，而是读回了 results 文件；这是本次运行最大的单项上下文开销，不是 kernel 本身造成，但 kernel 也没有消除它。
  - 对照：没有同阈值的匹配运行（cont-01/cont-01r 有 600 s 截止）。决策 2 的重建与决策 3–5 不重建同时可以由"决策 2 前会话只有决策 1 的少量名字"解释，单次运行不能区分是列表起作用还是模型偶然行为。
- 机会漏斗、语义使用、成本与任务结果：kernel-01、kernel-02 两次（见上）；kernel-02 达到了命题所需的决策数，但没有匹配对照。
- 协议偏离：无（尚未运行实验）。

| 证据层级 | 状态 | Provider / environment | 产物及结论边界 |
| --- | --- | --- | --- |
| 功能正确 | 通过 | node:test + 真实 WASI kernel | `tests/arc_thin_kernel.test.ts` 等；不涉及模型行为 |
| 全链路可达 | 通过（确定性） | mock ARC SDK、真实 bridge/Pi、脚本化 provider | `tmp/smoke-activation-2`、`tmp/smoke-receipts-2`（worktree 内，未入库）；证明接线与生命周期，不证明模型会用列表 |
| 自主采用 | 观察到（2 次，无对照） | yibu/qwen3.8-27b，ls20 | kernel-02：会话列表进入决策 2–5，模型跨决策复用 `diff`/`g0`/`motif_pos` 并在 cell 内连续行动；决策 2 仍重建（读 results 回执与 data/），决策 3–5 未读 data/ |
| 净收益 | 未验证 | — | kernel-01 受截止限制；kernel-02 无阈值但无匹配对照，0 关、时间由模型推理长度主导；需要 fork 的 kernel 开/关对照 |

## 交付决定

- 已支持的声明：kernel 后端、动作不重放、按需读文件、检查点恢复、会话列表、压缩提示在单元测试与确定性全链路中正确。未支持：代理会使用列表、重建调用减少、运行时上下文或 token 下降、任务进展改善。
- 决定：保留为本分支默认（可用开关关闭），处于实验状态。
- 下一可证伪检查：从同一前缀 fork 出 kernel 开/关两臂（`ARC_THIN_PYTHON_KERNEL`），同阈值，比较决策 2+ 的重读调用数和每决策工具结果字符数。若列表出现而重读不减，下一个单因素是从父代理的系统提示/历史行里去掉指向 `data/current.json`、`data/trajectory.jsonl` 的重复入口。kernel-02 另暴露一个独立机会：大输出截为回执后，模型读回整个 results 文件而不是用 `_`（18k 字符）；是否处理（例如回执里给出结构摘要）是单独的改动，不并入本记录。
- 关联 backlog：[deferred-research-todos.md](../deferred-research-todos.md) D（压缩后的认知连续性）——本改动让会话中的计算状态跨压缩保留并在压缩提示中声明，但"关键假设是否跨压缩保留"仍未验证，状态不变。
