# KernelBench 四题评测接口适配

日期：2026-11-26（Asia/Shanghai）。状态：实验接口已实现，真实 GPU 与 Agent 闭环待验证。遵循 [开发流程](../development-workflow.md)。

## 问题与命题

- 机会：当前 `origin/codex/arc-evo-middle-layer` 有 ARC、PPT、Terminal-Bench 入口，但没有 KernelBench 任务或评测接口。Dream-RSI 公布四题和独立 GPU evaluator；开始实施时本地没有 Dream-RSI/KernelBench checkout。尚无本项目在这些题上的真实轨迹。
- 窄命题：在四道固定题中，准备工作区并调用同一 GPU server 协议，可以将 Agent 写的完整候选程序对应到可追溯的正确性和性能反馈，不要求 Agent 自行拼接评测协议。
- 减少负担：Agent 从题面到首次评测仅需写 `candidate.py` 并调用一次评测入口；协议参数、候选快照、反馈记录由客户端承担。
- 推翻条件：任一题映射错误、候选程序与发送源不一致、0 分与连接故障混淆，或真实 server 不接受该协议。
- 范围：本次是四题的任务与评测接口，尚不声明 Pi/SelfRoot 自主改进、性能收益或完整 Dream-RSI 搜索复现。

## 设计与成本

- 复用 Dream-RSI 的题面、参考实现和 GPU server；客户端用标准库 HTTP，避免引入运行时依赖。参考实现只用于 Agent 阅读，正确性由 server 的正式 reference 判定。
- 生命周期：开发者准备 run 目录；Agent 读取题面和参考、写候选并调用 CLI；CLI 快照候选、提交 server、将完整结果打印为工具输出并写入 `evaluation.json`/`evaluations.jsonl`；Agent 可据此修订候选。连接失败留下独立状态，后续可重试。没有自动晋升或强制重试。
- 每次调用新增一次 CLI/HTTP 往返和一份源快照。无常驻 prompt、schema、worker 或 review gate。无 GPU 调用时没有 GPU 费用。服务只执行评测；候选选择、何时试验、何时停止均属 Agent。
- 环境边界：server 执行收到的代码，应在可信网络的 GPU 主机启动；本地 adapter 不导入或执行候选。run 目录和 benchmark 源分离。任务来源以 prompt/reference SHA-256 记录，server 实际 reference 版本仍需运行时核对。默认 `cuda` backend 与论文相符，可显式选 `triton` 方便单文件候选；backend 进入每次结果，不能混合比较。
- 恢复与退出：每次候选快照可重用，JSONL 保留包括失败在内的所有尝试；预算和收益判断由上层 Agent/实验约束负责。

## 运行前实验协议

- 本轮目标：功能正确。以四题目录映射、HTTP 请求体、0 分与连接故障的分离为判定。对照为手工调用 Dream-RSI evaluator 的字段和默认值。
- 模型/provider：本轮不运行模型。环境：合成 Dream-RSI 文件与本地 HTTP 假 server；GPU server 未运行。
- 后续全链路检查：在真实 Dream-RSI checkout + CUDA GPU server 上，先测 LayerNorm 一个参考样本和一个候选，核对 server 版本、score、latency、程序快照与 CLI 输出。付费 GPU/模型运行需先确定预算。
- 后续自主采用/净收益：同一四题、同一 provider、GPU 类型和时间/模型调用预算下，比较原始 Agent 与接入自进化机制的独立重复运行。主要指标：正确候选比例、`1/latency_ms`、达成首次正确候选的墙钟与父子总调用成本；失败及未完成样本计入。单次尝试不证明收益。
- 负例：空候选、非空 run 目录、无法连接 server、server 返回无 `result`、kernel 正确性失败且分数为 0。当前测试覆盖前三项及 0 分；其余待补充分层验证。

## 实现与验证

- `kernelbench-prepare` 准备四题之一；`kernelbench-eval` 发出 Dream-RSI `/evaluate` 请求，打印原始反馈并保存快照和尝试日志。README 给出步骤和 GPU 前提。
- `python -m pytest tests/test_kernelbench_adapter.py -q`：4 passed，本地合成文件和假 HTTP server，覆盖四题映射、两种 backend、0 分/连接失败和参考文件被修改的拒绝。
- 从 Dream-RSI commit `8ec35bd2538220517ce1bfca4282db21b8c518db` 做 sparse checkout，实际对四题逐一执行 `kernelbench-prepare`，均退出 0，题面和参考文件已写入各自 `runs/kb-prepare-*`。此检查不调用 CUDA server。
- GPU 本地探测 `nvidia-smi` 因权限不足失败；没有据此判定 GPU 不存在或评测可用。真实 GPU/server 仍未验证。
- 将实际 Dream-RSI server `EvalReq` 字段与请求体逐项核对；静态协议相符，仍不能代替在线 server 响应。
- 机会漏斗、语义使用和成本：没有真实 Agent run，均未测量。CLI stdout 是后续 Agent 工具调用的即时反馈；存盘日志用于追踪和恢复，并非已证明被 Agent 使用。

| 证据层级 | 状态 | Provider / environment | 产物及结论边界 |
| --- | --- | --- | --- |
| 功能正确 | 通过 | 无 provider / 合成文件与假 HTTP server | `tests/test_kernelbench_adapter.py`；证明映射、协议、记录和失败区分 |
| 全链路可达 | 未验证 | Dream-RSI checkout / CUDA server 未运行 | 无真实评测产物 |
| 自主采用 | 未验证 | 真实 Pi provider 未运行 | 无 Agent 自主调用记录 |
| 净收益 | 未验证 | 无配对运行 | 无性能或成本结论 |

## 交付决定

- 保留为可调用的实验接口。下一步用 LayerNorm 验通真实 GPU server，核对参考版本和回执。随后补齐 Agent 所需的评测反馈，运行极薄 Pi 基线并采集轨迹。
- [适配器边界待办](../deferred-research-todos.md#a-arc-adapter-职责边界主要待办)仍开放；本接口仅返回评测事实，不承载搜索策略，不能据此关闭 ARC 待办。

## KernelBench 适配开发方案

实施顺序为真实 GPU 验通 → 补齐评测反馈 → 极薄 Pi 基线 → 基于真实轨迹设计 KernelBench 专属机制。当前只有接口测试。重复编译、数值误差定位和试验比较都是待观察的瓶颈。首轮设计决策以基线轨迹为依据。

### 1. 建立可对照的 Pi 基线

| 改动位置 | 交付与验收 |
| --- | --- |
| `kernelbench_adapter.py` | 保留现有 CLI 默认行为。新增 `check`（一次随机正确性检查，`measure_performance=False`）和 `benchmark`（5 次正确性、100 次 CUDA-event 测时、FP32、seed 42）。快速检查读取 `compiled`、`correctness`，上游在无计时时的零分或 failed 标签不参与判断。连接失败、明确的服务端超时和候选错误各自记录。 |
| 拟新增 `kernelbench_e2e.py` 与 `demo/kernelbench_extension.ts` | 新增 `kernelbench-e2e`，只复用 Pi RPC 和工作区文件工具。Agent 可读题、局部编辑和调用 `kernel_eval(mode)`。运行器固定 GPU endpoint 和题目输入，使用 `--no-context-files`，记录评测次数、模型用量和时限。GPU 等待单独计时，继续使用同一个 Pi session。 |
| 候选与结果 | 复用 `attempts/` 和 `evaluations.jsonl`。工具在提交时冻结源码和哈希，记录评测档与协议。按需读取原始诊断和快照，Agent 可恢复任一历史候选。当前已加入按 backend 分开的正式候选最佳延迟记录 `best.json`。Pi 入口仍待实现。 |

GPU 环境先使用可核对版本的 Dream-RSI server。将 GPU 型号、计算能力、显存和软件版本等已核实事实写入任务环境说明。每题在同一 GPU、精度和计时协议下测 PyTorch Eager reference，供本次运行复用。评测回执返回编译与正确性结果、首个有用的失败诊断和完整日志引用。正式结果另含候选延迟及 Eager speedup。单候选分数为 `1/latency_ms`，`fast_p` 用于题集汇总。仅正确且有有效正式测时的候选参与排行，同 GPU、backend、精度及协议下才比较。最终交付冻结候选哈希，对领先结果在相同 GPU 上串行复测，用测时离散度识别噪声。

先在 LayerNorm 跑通，检查正确候选、错误候选、GPU 服务故障和故障后的下一次评测。ConvDiv 用于寻找可重复的诊断负担，随后在 ConvMax、VGG16 检查接线和适用边界。任务合同明确允许的固定 shape 特化必须保持全部约定输入的数值语义，禁止结果缓存、读取或修改测时器、改容差，以及题面禁止的计算替代。快速校验与 Agent 工具产物只是诊断证据。正式评测和审阅独立于候选工作区执行，保留同版本复核材料。

### 2. 用基线轨迹决定是否引入自进化

极薄基线以单 Agent 串行运行，能力范围是文件编辑和评测。旧 ARC Layered 与 SelfRoot 的整套运行机制均排除在接入路径之外。用真实 provider 的普通运行核查 Agent 在哪里重复读日志、重复试错或遗失反证，关联候选变更、评测结果与模型/GPU 成本。如果瓶颈是评测缺少事实，先修评测反馈。如果已有工具足以完成任务，保留基线。如果存在反复发生、可被复用能力替代的工作，只选一个瓶颈做最小改动。

例如，轨迹证实 Agent 多次从长编译日志定位同类错误时，再试验 Agent 自创日志诊断工具。发布后，下一轮显示用途和版本，由 Agent 决定调用、改写或撤下。记录工具版本、输入尝试 ID、输出和后续改动，核查它是否替代了手工诊断。若轨迹反映的是上下文恢复后重复试错，则优先带回当前和最佳候选引用、关键反证、剩余预算与 Agent 已写的下一步，用下一次 provider 请求和实际决策验证恢复效果。两条路径各自做单因素验证。

关联 [待办 A–D](../deferred-research-todos.md) 仍开放。A 对应评测事实与 Agent 决策边界，D 对应恢复后的实际决策。B/C、跨题继承及 profiler 只有在轨迹暴露对应瓶颈时才进入后续实验。

### 3. 验收与运行协议

| 证据 | 验收与判定 |
| --- | --- |
| 功能 | 假 HTTP evaluator 检查快速校验与正式评分、候选哈希与回执一致、错误分类、预算拦截和快照恢复。 |
| 全链路 | LayerNorm 在真实 CUDA server 上核对正确/错误候选、延迟、版本和产物。极薄 Pi 用脚本 provider 验证局部编辑和评测响应回到下一轮，再用真实 provider 采集普通运行轨迹。 |
| 自主采用 | 若实际增加自创工具，观察 Agent 是否自主创建、调用并改变后续选择。记录适用机会、合理不使用、放弃及创建后未调用。脚本探针单独记录。 |
| 净收益 | 相同任务、初始候选、模型/provider/推理档、GPU、backend 与评测配置。对照组使用极薄基线，实验组只打开轨迹选出的一个改动。先做短探索固定超时、最多尝试数、墙钟和模型预算，再做顺序交替的独立配对。 |

主要指标是预算截止时经独立复测的最佳合规 speedup 和正确交付率，成本指标是首次正确所用时间、快速/正式评测次数、GPU 时间、总模型 token 和管理轮次。工具创建、维护、恢复和失败成本一并计算。若最终交付质量在测时波动范围内相当，预先约定的重复诊断成本应下降且总成本不升，才支持减负命题。若只增加工具调用、较少拿到正确交付、或优势小于计时波动，分别记为无收益、退化或不确定。模型、GPU、费用上限及实际截止条件在获授权运行前填入本记录。

### 4. 当前实现进度

- 已在 `kernelbench-eval` 增加 `check` 和 `benchmark` 模式。check 关闭正式测时，返回字段仍分别检查 compiled/correctness，避免把关闭测时产生的零分误读成 kernel 失败。benchmark 可显式请求 reference timing。
- 正式正确结果自动维护按 backend 区分的 `best.json`，记录候选哈希、快照、延迟和 evaluator 返回的 Eager speedup。不能从另一 backend 继承最佳值。
- 尚未加入 GPU 型号和计算能力观测。当前公开 evaluator 的普通响应不提供这些字段，待真实 server 确认后再决定采用启动配置还是小幅扩充服务端响应。
- 极薄 Pi runner 已实现雏形：`kernelbench-e2e` 启动一个 Pi session，使用 `--no-context-files` 和 `--no-builtin-tools`，只注册 confined workspace 文件工具与 `kernel_eval`。评测快照保存在 agent workspace，Pi 直接收到 evaluator 响应。尚未通过实际 Pi provider 和 GPU server 验收。
- 启动参数提供 wall/turn deadline。runner 当前没有拆分推理时长与评测等待时长的遥测，evaluator 超时由 server 请求 signal 和外层 turn deadline 约束。真实运行前需核查等待时间不会误触发 Pi turn idle timeout。
- 真实硬件事实仍缺 API 来源，reference Eager timing 可从既有 adapter 的 `--reference-timing` 获取，但 Pi 启动路径还未自动建立并注入一次性 baseline。作为下一项实现与 GPU smoke 验收内容。
