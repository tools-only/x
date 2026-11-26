# Meta-harness 变更记录：ALE-Bench Lite 十题适配

日期：2026-11-26（Asia/Shanghai）。状态：实现，扩展为有限 Agent-owned 演化循环。

## 问题与命题

- 真实机会：仓库已有多个 benchmark runner，但没有 ALE-Bench 的公开迭代、终态私有评测和统一产物入口。上游 Session 同时持有私有 seeds、standings 和 rank map，误把 Session 传入 Agent 会泄露评测信息。
- 窄命题：一个薄 bridge 投影公开 Result 字段，允许 public/case 评测，并在终态最多调用一次 private_eval，可降低接入新 benchmark 的重复编排负担。
- 减少的负担：统一 CLI、artifact 和关闭逻辑，避免每个调用方自行筛选私有字段。
- 适用条件与推翻条件：上游 `ale_bench` 可导入且 Docker/Hugging Face 数据可用时适用。若真实 Session 要求未实现的交互工具或私有结果无法安全投影，则应停止并修订 bridge。

## 设计与成本

- 选择与取舍：复用上游 `start`, `public_eval`, `case_eval`, `private_eval`，新增两个薄 Python 模块。Lite 十题来自上游 `problem_ids_lite.txt`。`case_eval` 仅作为显式本地诊断入口，默认流程使用 public_eval。
- LayeredComponents 复用审计：`origin/codex/qwen27b-cognitive-harness` 的 `CognitiveComponents` 是 ARC 分支中的版本化 TS 存储，当前没有 ALE/Python 消费者。切片 1 直接复用 bridge 和上游 Session API，不复制 ARC action、grid/context 或组件运行时。后续若 coding runtime 形成明确组件消费者，再单独提取通用版本存储并验证。
- 权限/版本/环境边界：Lite 与 full 由 `lite_version` 传给上游。代码只读取公开 Result 属性及终态 rank/performance 标量，不读取 Session 私有字段。Pi gameplay context 不注入此文档或 AGENTS.md。
- 放弃与恢复：bridge 在成功或异常后关闭 Session。artifact 是单一 JSON，可保留公开回合与已脱敏终态摘要。

## 运行前实验协议

- 目标证据层级：功能正确与接线可达。真实 provider 采用和净收益未纳入本次预算。
- 主要变量与比较器：Lite/full 数据集开关、公开回合数、是否进行终态 private_eval。
- 主要指标：结果字段投影、私有字段不泄露、Session 关闭、artifact 可读。
- 负例：Lite 模式传入 full-only problem ID、零或负公开回合数、上游依赖缺失。

## 实现与验证

- 改动入口：`src/autoresearch_pi/ale_bench_bridge.py`、`src/autoresearch_pi/ale_bench_e2e.py`、`src/autoresearch_pi/ale_bench_evolution.py`、CLI `ale-bench-e2e`/`ale-bench-evolve`、对应测试，以及 `demo/cognitive_components.ts`。
- 上游事实：Lite 问题为 `ahc008`, `ahc011`, `ahc015`, `ahc016`, `ahc024`, `ahc025`, `ahc026`, `ahc027`, `ahc039`, `ahc046`。上游 Result 的 absolute score 只计 accepted cases，编译错误或内部错误为零，relative score 需所有 case 都有 relative 值。Lite 切换 seeds、standings 和 relative result 数据，不改变 Result 计算算法。
- 功能检查：`python -m pytest tests/test_ale_bench_bridge.py tests/test_ale_bench_e2e.py tests/test_ale_bench_evolution.py`。

| 证据层级 | 状态 | Provider / environment | 产物及结论边界 |
| --- | --- | --- | --- |
| 功能正确 | 通过（待本地命令确认） | Python test doubles | 覆盖投影、Lite 十题、artifact、关闭路径 |
| 全链路可达 | 未验证 | ALE-Bench Docker/HF environment | 需安装 ale-bench、CairoSVG、Docker 镜像后执行 CLI |
| 自主采用 | 未验证 | 未运行真实 Pi/provider | 本次无 Agent 自主选择证据 |
| 净收益 | 未验证 | 未运行对照实验 | 无成本或任务质量结论 |

## 交付决定

- 已支持：Lite 十题校验、公开评测、case_eval 诊断、单次终态私有评测、脱敏 artifact、CLI，以及 Agent 回调驱动的有限公共评测演化、attempt 谱系和最佳源码选择。`cognitive_components.ts` 提供从 Qwen harness 抽出的版本化组件存储核。
- 未支持：真实 Docker/HF 评测验证、Pi 原生 extension coding loop、上下文 evict/fold、consult、动态 `work/lib` 挂载、跨任务批处理和 leaderboard 访问。`ale-bench-evolve` 的候选文件模式是接线诊断，不是自主模型实验。
- 剩余验证：在具备上游 Docker 与数据缓存的环境运行一个 Lite problem 的 public_eval 和 private_eval，确认版本兼容与资源限制。A 的 adapter/runtime 边界和 D 的 public/private context 连续性仍属于开放待办，本次只落实字段隔离和单一 Session artifact。
