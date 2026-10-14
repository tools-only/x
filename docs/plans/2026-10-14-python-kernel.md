# Meta-harness 变更记录：python 会话改为常驻 kernel，减少运行时重建上下文

日期：2026-10-14（Asia/Shanghai）。状态：实现（功能与确定性接线已验证；真实模型未运行）。
分支：`claude/kernel-20261014`，基于 `claude/objective-shaw-9d0ead`（52ef2f0a，cont-01/cont-01r 的默认配置）。

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
- 机会漏斗、语义使用、成本与任务结果：未测（无真实模型运行）。
- 协议偏离：无（尚未运行实验）。

| 证据层级 | 状态 | Provider / environment | 产物及结论边界 |
| --- | --- | --- | --- |
| 功能正确 | 通过 | node:test + 真实 WASI kernel | `tests/arc_thin_kernel.test.ts` 等；不涉及模型行为 |
| 全链路可达 | 通过（确定性） | mock ARC SDK、真实 bridge/Pi、脚本化 provider | `tmp/smoke-activation-2`、`tmp/smoke-receipts-2`（worktree 内，未入库）；证明接线与生命周期，不证明模型会用列表 |
| 自主采用 | 未验证 | — | 需要真实 provider 运行 |
| 净收益 | 未验证 | — | 需要与 cont-01/cont-01r 的同预算对照 |

## 交付决定

- 已支持的声明：kernel 后端、动作不重放、按需读文件、检查点恢复、会话列表、压缩提示在单元测试与确定性全链路中正确。未支持：代理会使用列表、重建调用减少、运行时上下文或 token 下降、任务进展改善。
- 决定：保留为本分支默认（可用开关关闭），处于实验状态。
- 下一可证伪检查：按上方协议跑 2 次真实运行，与 cont-01/cont-01r 比较决策 2+ 的重读调用数和每决策工具结果字符数。若列表出现而重读不减，下一个单因素是从父代理的系统提示/历史行里去掉指向 `data/current.json`、`data/trajectory.jsonl` 的重复入口。
- 关联 backlog：[deferred-research-todos.md](../deferred-research-todos.md) D（压缩后的认知连续性）——本改动让会话中的计算状态跨压缩保留并在压缩提示中声明，但"关键假设是否跨压缩保留"仍未验证，状态不变。
