# ARC 冒烟：ADR 是否作用于运行 Agent

日期：2026-10-01（Asia/Shanghai）。

## ADR 是什么

ADR 是 Architecture Decision Record，即架构决策记录。它保存设计决定、原因、职责边界、取舍及状态。ADR 影响后续实现工作；Agent 在运行时的行为取决于已接入的代码、prompt、权限与配置。一个 ADR 文件被保存，不表示其设计已经执行。

本次检查的是 [Auto-Research 机制与多个研究子 Agent ADR](plans/2026-10-01-auto-research-mechanism-and-workers.md)。它明确标记：核心定位已确认，持续调度和阶段性增量交付尚未实现。

## 已执行的真实 ARC SDK 冒烟

执行入口 `arc-harness-smoke`，ARC checkout 为 `D:\arc-agi-benchmark\arc-agi-3-benchmarking`，游戏为 ls20，结果目录 `runs/arc-adr-runtime-smoke-20261001`。

- **16/16 场景、393 项检查通过**；运行 exit code=0，没有失败场景。
- `environment_mocked=false`、`runtime_boundaries_mocked=false`。
- `provider_mocked=true`：父/child provider 为确定性脚本，不是 qwen 自主模型行为测试。
- 覆盖真实 ARC bridge、Pi 父循环、child broker/process、结构化研究返回、router/native mutation、五类 Harness 组件、creator 读取、精确装配、语义 tool/subagent 输出、ARC 动作边界及后续父轮。
- 覆盖 Auto-Research 与普通 delegate_task 的 provider length 续接，及实际使用/评估/同线反馈等既有场景。

完整 [冒烟汇总](../runs/arc-adr-runtime-smoke-20261001/arc-self-harness-smoke-summary.json) 与 [ADR 运行接入审计](../runs/arc-adr-runtime-smoke-20261001/adr-runtime-effectiveness-audit.json)。集成检查后记录的四个核心源码 hash 到矩阵结束未变化。

## ADR 生效判断

| 检查对象 | 结论 | 依据 |
| --- | --- | --- |
| 工程设计/开发约束 | 已落盘 | ADR 和仓库 AGENTS.md 已记录新定位 |
| ARC 父 Agent 自动加载仓库 AGENTS.md | 关闭 | `_run_pi` 启动参数包含 `--no-context-files` |
| 新 ADR 作为运行 prompt 的来源 | 未接入 | demo/src/tools/tests 中未找到该 ADR 的引用；当前扩展使用既有专用 prompt/合约 |
| 既有研究、组件、装配、反馈链 | 接线验收通过 | 此次真实 SDK 冒烟 16 场景/393 检查通过 |
| 已授权职责持续承载并路由新窗口 | 尚未实现/验收 | 当前续研卡是父提示；ADR 所述持续 worker 分配与自动证据路由没有对应验收场景 |
| 研究 active 时即时交付核心结论 | 尚未闭合/验收 | 现有按相关性短交付主要处理完成报告；阶段性交付需新增协议与运行路径 |
| 多 worker 跨阶段持续追踪、减少父推理 | 未证明 | 本矩阵没有该新增机制或自主模型的对照场景 |

因此：**既有 ARC self-harness 链路此次通过；新 ADR 对 ARC 运行 Agent 尚未接入并执行。** 不能将这个矩阵的通过报告成新 ADR 的生效或自主研究收益。

下一步实施需要将已确认职责接到父授权、研究线/worker 分配、增量证据、阶段结论交付与预算/停止机制，再补对应真实 ARC 验收及真实 provider 对照。仅让 Agent 读取 ADR 也不能实现这些生命周期接口。
