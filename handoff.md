# Autoresearch Pi / Self-Harness Handoff

> 2026-09-08 真实闭环优化：[已实现、未实现、下一阶段目标](docs/tracks/2026-09-07-autoresearch-self-harness-optimization.md)。当前链路为 `model-visible EXECUTION_OBSERVATION → research-goal-N/finding-N → apply/keep decision-N → optional pi.setActiveTools() → exposure observation → bounded effect-assessment-N`。初始隐藏的 `calendar_batch_action` 只有在 finding-backed `calendar_batch` 决策后才进入下一模型请求；一个 Pi tool call/一个 Python bridge 进程可完成 2–16 个真实 create。可选 `research_resource.continue_with` 在同一 agent 决策中落 finding 与关联 decision，省略则不修改。`summary.json.closed_loop_evidence` 现在紧凑投影全部已声明 goals、决策时 capability catalog、证据摘要、Pi 原生修改前后与 effect，并引用 canonical 文件而不复制完整 trace。Runner 独立重算任务正确性信号、连接、loop integrity 和 task-local effect；`harness_improvement` 仍保持 `not_established`。全量测试 **64 passed**。

> Level 3 证据：`runs/level3-3-6-0-auditable-summary-1` 因 email 契约未披露而 length 失败；新增在所有 surface 中保持可用的 `email_action` 后，`runs/level3-3-6-0-auditable-summary-2-email-contract` 正常完成并得到 JIT score 1.0，生成 1 个日历文件与 14 个邮件副本。该模型选择 no-change，所以 summary 如实显示空 goals/changes 和完整可用资源；不要把它表述为新的 harness 闭环样本。

> 真实证据：`runs/effect-high-2-13-0-real-8-closed-loop-summary` 的 JIT case `2-13-0` 生成 12 个日历文件并 score 1.0；agent 自主用 Excel 读取与日历探针作为 `finding-1` 证据，apply `decision-1`，下一请求观察到 `calendar_batch`，batch 12/12 成功。Summary 在生成时报告 `research_connection=apply_effect_observed`、`loop_integrity=linked_effect_observed`、`execution_condition_effect=supported`，同时保留 `harness_improvement=not_established`。

> 事件落盘现使用 `compact-jsonl-v1`：保留语义事件和流式 delta，移除每个 `message_update` 中重复的累计 message/partial。对旧 `1-2-1` trace 的只读测算从 861,040,757 bytes 降至 5,821,307 bytes（-99.32%）；旧运行文件未改动。

> 新增落盘去重：`evaluator-targets-before/after.json` 只保存 evaluator 指向目标的类型、SHA-256 和大小/文件数；handoff 只索引 task notes、findings、decisions、exposure/effect observations，不复制 canonical JSONL 或笔记正文。

> 真实批次 `runs/pi-officebench-e2e-5-4` 是本轮可见连接优化前的失败证据：5/5 有 execution observations，0 finding/decision/effect；`1-2-1` agent length 失败且目标不变，但 legacy evaluator 仍为 1.0。不要用该批次验证新实现。新实现应在全新目录复跑。

> 2026-09-09 新增最小 task-local 资源恢复：OfficeBench 与 Shopping 的 Pi-native `research_resource(action="inspect")` 只读读取当前 run 的最新 finding、decision、Pi exposure 与 effect assessment；extension 启动时 hydration 这些 append-only JSONL，但始终从安全 general surface 开始，不自动恢复旧 harness 状态、不调度研究、不读取 sibling runs。离线原生测试覆盖重启后读取，以及第二个 Pi 进程基于 inspect 结果继续 apply；真实 `runs/officebench-2-13-0-rehydration-smoke-1` 复跑仍形成原有 12/12 calendar batch 闭环。全量测试 **101 passed**。具体记录见 track 3.17。

> 最新架构设计：[2026-09-06：Auto-Research 与 Pi 原生任务内 Self-Harness](docs/plans/2026-09-06-autoresearch-pi-task-local-architecture.md)。该文档明确方法保持稳定、研究由 agent 自主设计、执行后果只更新任务资源，以及不同独立任务从同一基线开始。下文保留历史实现与验证记录，不代表新增设计已经实现。

## 最新 meta-harness demo（2026-09-07）

- 新增 `meta-harness-demo`：以确定性的 task-agent 决策 fixture 展示迭代、嵌套、返回、剪枝、原语调整和终止。Fixture 用于复现架构关系，不是实时模型自主性的证据。
- 实际安装的 Pi `0.80.6` 加载测试 extension，在同一进程中观察到 `evidence_policy: summary_only → source_and_date → source_and_date`。
- 输出有效 DOCX、`auto-research-handoff.md`、`self-harness-handoff.md`、`round-hierarchy.md`、决策 trace 和 summary。
- 本地 OfficeBench-style 检查 score `1.0`；项目测试 `8 passed`。
- 运行说明见 [demo/README.md](demo/README.md)。完整外部 OfficeBench evaluator 与实时模型自主决策仍未验证。

## 当前目标与架构

本项目把 autoresearch meta 与 Pi Agent 对接为薄的 task-facing client。Pi 原生 extension/session 持有 agent loop、工具和 harness 逻辑；`PiKernel` 只负责 RPC/session/event bridge，`PiTaskAgent` 只提交任务并收集结果。

```text
PiTaskAgent（薄 task-facing client）
  └─ PiKernel（单一 pi --mode rpc 进程）
       └─ Pi 原生 extension/session（agent loop、tools、harness primitives）
```

## 已完成

### 1. 移除旧宿主控制面（历史变更记录）

- 删除 `src/autoresearch_pi/supervisor.py`。
- 删除 `src/autoresearch_pi/checkpoint.py`。
- 删除旧的 `tests/test_supervisor.py`。
- `__init__.py` 不再导出 Supervisor、Checkpoint 或 checkpoint API。

旧的设计计划仍可在 [docs/plans/2026-09-04-autoresearch-pi-kernel.md](docs/plans/2026-09-04-autoresearch-pi-kernel.md) 查阅，但其中的 supervisor/checkpoint 描述已被当前实现取代；该文件已标记为 superseded。

### 2. Pi-native task-facing client

[src/autoresearch_pi/task_agent.py](src/autoresearch_pi/task_agent.py) 提供：

- `PiTaskAgent.run(task)`：提交一次 prompt，Pi 原生 agent loop 负责工具调用、上下文和后续 continuation。
- `RunResult`：返回 Pi agent 的最终回答和提交步数。
- task-facing client 不注册自定义 harness mutation protocol，也不执行 Python 侧 tool loop。

### 4. Pi RPC 异步事件桥

[src/autoresearch_pi/pi_kernel.py](src/autoresearch_pi/pi_kernel.py) 负责启动 `pi --mode rpc`，维护 request id，并区分：

- 带 request id 的 RPC response；
- 异步 `tool_call`、`message_update`、`agent_end`、`agent_settled` 等事件。

`wait_for_agent_events()` 会收集一个完整 agent turn，避免把普通 command response 误判成 agent 已完成。

### 5. OfficeBench 冒烟支持

项目有两条明确分开的路径：

1. `officebench-smoke`：Pi-native、无网络的兼容冒烟，使用项目自己的 tool protocol 写出本地 artifact 并返回 deterministic score。
2. `jit`：可选的外部 JIT benchmark adapter，仅以子进程方式调用 `D:\JIT`，不导入、不修改 JIT 源码，也不让核心 Pi runtime 依赖 JIT。

已验证命令：

```powershell
$env:PYTHONPATH = "D:\autoresearch_pi_project\src"
D:\conda\python.exe -m autoresearch_pi.cli officebench-smoke
```

结果：case `1-2-0`，score `1.0`，生成 `runs/pi-officebench-smoke*/officebench_case.docx`。

历史上外部 JIT OfficeBench case 也成功过一次（score `1.0`、passed `1`）；后续一次运行在 JIT 临时 workspace 创建处遇到 Windows `WinError 5`，这是 JIT 宿主权限问题，不是 Pi task loop 的失败。

## 尚未完成 / 当前限制

### Harness primitive design alignment (2026-09-05)

- Track marker: `harness-boundary-v1`; see [docs/tracks/2026-09-05-harness-boundary-track-v1.md](docs/tracks/2026-09-05-harness-boundary-track-v1.md). This is a design baseline only; optimization is deferred.

- Auto-research remains the process/methodology layer; each task agent designs the concrete research loop and recursive structure for its problem.
- Task agents should not directly rewrite an undifferentiated harness state/structure: that is non规范, difficult to trace, and difficult for auto-research to express. They may implement or update one primitive (including a 0→1 implementation), but the change must be represented and reported at primitive granularity.
- Harness exposes primitive resources, interfaces, and external conditions to the task agent; it does not dictate research goals or boundaries.
- Auto-research should read the task agent's currently available harness resources when designing a loop. At the end of each turn, the task agent should synchronize resource availability and changes (including scope/effect timing and whether later execution observed them).
- A future harness-change trace, independent of task memory, should record changes at primitive/resource granularity. It is explicitly deferred and not implemented.
- Primitive interface names and granularity (for example `memory.read`/`memory.write`) are intentionally undecided. Re-open this alignment before concrete interface design.
- Keep `PiKernel` thin: do not add a complex kernel-side harness interface layer. Auto-research should expose only capability range/description; task/harness owns concrete primitive implementations and updates.

See [docs/harness-primitive-design-notes.md](docs/harness-primitive-design-notes.md).

- 当前测试主要使用 fake/scripted kernel；尚未用真实模型完成一条长时间的 autoresearch meta 任务，也尚未加入真实 Pi extension smoke。
- `PiTaskAgent` 的 task memory 仍是轻量级的 prompt/tool-result 流；OfficeBench/Shopping extension 现在可在同一任务的受支持重启后通过只读 `research_resource.inspect` 重建 task-local JSONL 资源，但尚未提供通用跨进程 memory 协议或跨任务检索。
- 当前仓库不提供整体 harness source validation、revision 或 rollback；具体 primitive implementation 由 Pi extension/task 侧负责。
- Pi tool-call 事件协议在真实 Pi 版本上的字段兼容性仍需实机覆盖测试；目前兼容 `name/tool_name` 和 `arguments/input` 两种形态。
- OfficeBench-compatible smoke 验证的是 agent/tool/artifact/evaluator 链路，不等价于所有真实 OfficeBench 任务都已由 Pi agent 完成。
- CLI 中的 `jit` 命令仍然保留，作为隔离的 benchmark integration；它不是核心 agent runtime，也不应重新引入 JIT 的设计接口。

## 下一步方向

### 近期

1. 增加真实 Pi RPC fake server 测试：覆盖 response 与异步 event 交错、多个 tool call、agent_settled 和 abort。
2. 增加一个真实 Pi extension/session 的最小 smoke（可使用本地/测试模型），验证 Pi 原生 tool/context hook 在同一 session 中生效。
3. 建立 OfficeBench tool provider 接口，把文档创建、编辑、读取和评估能力包装成 Pi 原生 extension tool，保持与 JIT runtime 解耦。

### 中期

- 设计 Auto-Research 读取 Pi extension 暴露的 capability range，而不导入 task-specific primitive implementation。
- 设计独立于 task memory 的 primitive-level harness change trace（暂不实现）。
- 增加结构化 Pi event/observation 日志；不引入整体 harness revision 协议。

### 长期

- 在 Pi extension 层按逻辑 primitive 边界注册原生 tools/hooks；不新增 kernel-side harness adapter。
- 探索无需重启 turn 的持续 self-harness 行为：使用 Pi 原生 context/tool/agent lifecycle hooks。
- 建立真实 OfficeBench 全量/分层回归，并记录 Pi-native adapter 与外部 JIT baseline 的可比指标。

## 验证基线

当前项目测试：

```powershell
D:\conda\python.exe -m pytest -q
```

最近完整结果：`64 passed in 21.21s`。测试使用 `D:\conda\python.exe`，因为 JIT conda 环境没有安装 pytest；真实 OfficeBench runner 与 action backend 使用 `D:\anaconda\envs\jit\python.exe`。

最新真实运行：`runs/effect-high-2-13-0-real-8-closed-loop-summary` 的 case `2-13-0` 通过，12 个日历事件内容已核对；1 个 finding、1 个 apply decision、1 个 next-request surface observation、1 个 12/12 batch action 和 1 个 independently validated supported effect。该结果证明一个真实任务内闭环，不证明跨任务的一般 harness improvement。

诊断：

```powershell
$env:PYTHONPATH = "D:\autoresearch_pi_project\src"
D:\conda\python.exe -m autoresearch_pi.cli doctor
```

不要把外部 JIT 成功结果表述为 Pi runtime 已完成 OfficeBench；交接时应分别报告 Pi-native smoke 和 JIT benchmark smoke。

## Suggested skills

- `Code`：继续实现和验证 Python runtime。
- `tdd`：为每个 runtime 行为先写失败测试再实现。
- `debug-pro`：排查真实 Pi RPC、Windows workspace 和 OfficeBench 宿主问题。
- `architecture-designer`：评审 Pi-only task agent、self-harness 和 tool provider 边界。
- `test-runner`：运行分层测试及 OfficeBench 回归。
