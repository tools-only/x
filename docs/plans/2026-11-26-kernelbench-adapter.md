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

- 保留为可调用的实验接口。下一可证伪检查是四题中至少一题的真实 server 评测，并核对实际参考版本与返回字段；之后才考虑 Pi/SelfRoot 接线。
- [适配器边界待办](../deferred-research-todos.md#a-arc-adapter-职责边界主要待办)仍开放；本接口仅返回评测事实，不承载搜索策略，不能据此关闭 ARC 待办。
