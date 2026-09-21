# Autoresearch Pi Project

独立的 autoresearch-meta + Pi Agent 实验工程。

## 隔离边界

- 本工程是独立 Python 项目，源码位于 `src/autoresearch_pi/`。
- `D:\JIT` 只作为外部 JIT 测试宿主的只读路径；本工程不修改其源码、配置或运行产物。
- `D:\guan-meta-loop-v2\autoresearch-meta-demo` 作为 autoresearch 参考实现的只读路径。
- Shopping/OfficeBench 通过显式 JIT adapter 启动；ARC-AGI-3 通过官方 SDK bridge；Terminal-Bench 通过 Harbor/Docker。所有输出写入本工程的 `runs/`。

## 目标运行模型

```text
Auto-Research method resources
  -> Pi task agent autonomously designs research, task strategy, and task-local resources
  -> Pi extensions/tools/hooks carry task-local self-harness changes and next-request context
  -> PiKernel only transports RPC/session/events
```

逻辑 harness 原语用于描述可独立调整的执行条件，具体操作直接使用实际 Pi 原生入口。`steer` / `follow_up` 保持消息控制语义，不作为通用 mutation 接口。

## 开发

```bash
python -m pip install -e .
python -m pytest
```

`pytest` 只用于组件级诊断，不能作为 Auto-Research/self-harness 闭环完成的证据。ARC 闭环验收必须运行下文的真实 ARC runner smoke。

## Auto-Research 机制优化 TODO

Auto-Research 的定位是：围绕有材料支撑的不确定性或解题能力缺口，开展可跨阶段持续的有界研究。
主 agent 在发起前提供三个条件：具体前提与可访问材料/权限、当前阶段有望达成的中间目标、
可在局部状态或代表性输入上判别成败的评测预期（含执行者、成本和停止条件）。条件不足时先补材料、
缩小问题或延后，不能把“如何通关”直接作为没有前置支撑的研究目标。
研究可以利用已有方法知识构造候选，再以任务证据检验；后续实际使用结果回流到研究中。
这些是父子 guidance 的语义要求，不是新增的运行时硬门禁，也不保证每次研究得到确定结论。
使用方式、字段映射及例子见 [Auto-Research 定位与使用](docs/plans/2026-09-18-grounded-auto-research-guidance.md)。

第一阶段范围是“动态研究执行协议 + 统一上下文预算管理”。完整研究材料继续持久化到 task-local artifacts；provider 每轮只接收当前工作集。

- [x] 动态研究计划：parent 在下发前声明复杂度；没有前序研究结果支持的复合目标必须先拆成带完成条件的节点，不能整体直接交给一个 child。
- [x] 依赖与并发队列：计划使用 DAG、`concurrency_limit` 和 `after_dependencies` / `parent_release` 门控；未满足依赖的节点保持 pending，语义条件由 parent 显式释放。
- [x] 进展驱动恢复：blocking 和 non-blocking child 的 `length` 续跑比较持久化语义 checkpoint；连续无进展时停止重复续跑并返回 inconclusive/stalled 状态及诊断。
- [x] child 任务输入预算：研究目标、约束、当前节点、checkpoint 和精确引用属于必需层；观察正文和已完成节点详情属于按需层；生成的 child 任务 prompt 使用一个总字符预算并记录遥测。这不是 system、工具 schema、历史消息合计的 provider token 预算。
- [x] 第一阶段组件验收：覆盖复杂目标准入、DAG 阻塞/释放、并发槽、阶段结果引用、无进展截断和输入预算；真实 provider 行为仍需实际运行验证。
- [ ] 第二阶段：根据真实运行遥测校准 token 估算与模型专用 tokenizer，比较总 token、重复取证、延迟和研究质量。
- [ ] 第二阶段：评估多个 child 的自动调度、公平性、取消传播、失败重试和资源冲突；在证据证明有收益前保持 parent 主导调度。
- [ ] 第二阶段：完成跨 parent compaction、session rotation 和 child 恢复的认知连续性实验，并验证关键反证与未完成实验不会丢失。

已进行保守的 prompt 分层优化：parent 保留复杂度、拆解、依赖语义和效果判断；
`auto_research(action="contract")` 按需提供操作说明，不启动研究。child 工作集显式保留
当前节点、总目标和前序结果引用，区分 parent checkpoint 与 research checkpoint；
选入的 parent 摘要同时携带依据、决策胶囊和待完成操作。调度门禁、权限和原生交付路由不变。
设计与验证边界见 [prompt 分层设计](docs/plans/2026-09-17-research-prompt-layering-design.md)
及 [运行时 prompt 说明](demo/prompts/README.md)。

## 运行

先执行环境诊断：

```powershell
$env:PYTHONPATH = "$(Get-Location)\src"
python -m autoresearch_pi.cli doctor
```

无网络的 autoresearch-meta 回归：

```powershell
python -m autoresearch_pi.cli meta-synthetic
```

通过只读 adapter 启动一个 JIT OfficeBench case（需要 JIT 的 Python 依赖和模型 API）：

```powershell
python -m autoresearch_pi.cli jit --bench officebench --harness auto_research --max-samples 1
```

运行 Pi-native、无网络的 OfficeBench 兼容冒烟：

```powershell
python -m autoresearch_pi.cli officebench-smoke
```

运行带 Auto-Research 与 self-harness handoff 的独立架构 demo：

```powershell
python -m autoresearch_pi.cli meta-harness-demo --root runs/meta-harness-demo-latest
```

该 demo 使用确定性的 task-agent 决策 fixture，并在实际安装的 Pi 进程中验证原生扩展状态变更；详见 [demo 说明](demo/README.md)。

使用真实模型、Pi 原生 agent loop、JIT OfficeBench actions 和 JIT 原 evaluator 跑一个端到端 case：

```bash
export PYTHONPATH='D:/autoresearch_pi_project/src'
export JIT_ROOT='D:/JIT'
export JIT_PYTHON='D:/anaconda/envs/jit/python.exe'
'D:/anaconda/envs/jit/python.exe' -m autoresearch_pi.cli officebench-e2e \
  --root 'D:/autoresearch_pi_project/runs/pi-officebench-e2e-live' \
  --case '1-2-0'
```

模型配置只从当前进程或本仓库根目录的 `.env` 读取；不会读取 `D:\JIT\.env`，也不会把 key 写入命令或 summary。先复制 `.env.example` 为 `.env` 并填写 endpoint/key。

顺序运行前 10 个独立 case，并在根目录生成聚合 summary：

```bash
'D:/anaconda/envs/jit/python.exe' -m autoresearch_pi.cli officebench-e2e \
  --max-samples 10 \
  --root 'D:/autoresearch_pi_project/runs/pi-officebench-e2e-10'
```

Pi RPC bridge 只负责 session、RPC 和事件传输；harness 应由 Pi 原生 extension 承载。外部 `JIT_ROOT` checkout 不会被修改；端到端命令只读取其 dataset/action/evaluator，并把 workspace 与结果写入本项目 `runs/`。

运行事件使用 `compact-jsonl-v1` 写入：普通语义事件完整保留，流式 `message_update` 仅保留 delta 并移除重复累计快照。具体格式由同目录 `pi-runtime-status.json` 的 `trace_format` 和 `message_updates` 字段声明。

Auto-Research 不再由本地代码人为设置 output-token 上限；父 Agent 仍仅接收有界 `auto-research-capsule-v1`。运行元数据写入 `auto-research-runs.jsonl`，规范化报告只写一次到 `auto-research-reports.jsonl`，并通过 `research_report:<run-id>@v1` 按页读取。provider 请求、输入/输出 token、payload 大小与 `length`/错误会持续写入遥测。provider `length` 由 Auto-Research runtime 在同一 run 和同一个 Pi 原生持久 session 内连续运行，并逐次写入 `auto-research-continuations.jsonl`；普通 `delegate_task` 也以同一 invocation/native session 写入 `subagent-continuations.jsonl`。只有 child 显式 pause、取消、官方 deadline 或硬失败才返回 parent。该机制不限制 continuation、研究调用或证据读取次数。

环境变量：

- `JIT_ROOT`：JIT 测试宿主路径，默认 `D:\JIT`
- `AUTORESEARCH_META_ROOT`：autoresearch-meta 参考实现路径
- `PI_COMMAND`：Pi CLI，默认 `pi`
- `ARC_AGI_3_ROOT`：ARC-AGI-3 本地 checkout，默认 `D:\arc-agi-benchmark\arc-agi-3-benchmarking`
- `TERMINAL_BENCH_DATASET`：本地 Terminal-Bench 任务集，默认 `D:\terminal-bench-2-1`

## ARC-AGI-3 与 Terminal-Bench

这两个环境复用同一组通用机制：真实工具 observation、开放 research goal 与 evidence-backed finding、task-local system-prompt overlay、skills、memory、tools、subagents、精确 evidence refs、通用 task-local context lifecycle、后续 exposure 和 effect assessment。lifecycle 默认自动去重 projection、限制 provider transcript、归档旧消息并保留可恢复引用；可用 `PI_AUTORESEARCH_CONTEXT_LIFECYCLE=disabled` 做显式 ablation。treatment 的首轮请求直接披露具体 task-local 创建操作与 `task_harness` start/inspect/enable/focus 入口；资源内容仍从空开始，并由 extension 的 `context` hook 投影到后续请求。Auto-Research child 使用 `research_approval` 绑定结构化 proposal；parent runtime 解析 report、用代码编译 route，并通过原生 task-local harness executor 应用所有 ready route。主 Agent 不暴露 child 审批工具，但会真实修改 system prompt、skills、memory、tools 或 subagents。ARC treatment 另提供 Agent 自主定义和调用的只读 Pi 子 Agent；子 Agent 没有环境动作权限。具体任务工具与 correctness evaluator 属于独立 adapter，不属于通用 self-harness。Agent-owned observation representation 仍由 `PI_AUTORESEARCH_CONTEXT_COMPACTION` 单独控制，默认不要求发生研究、委派或修改。

ARC-AGI-3 使用本地 checkout 内的官方 Python SDK，但正式游戏和 scorecard 仍由官方在线环境提供，因此需要 `ARC_API_KEY`：

```bash
export PYTHONPATH='D:/autoresearch_pi_project/src'
'D:/conda/python.exe' -m autoresearch_pi.cli arc-agi-3-e2e \
  --game 'ls20-9607627b' \
  --root 'D:/autoresearch_pi_project/runs/arc-ls20-treatment'
```

真实 ARC runner 内的确定性 self-harness smoke 只 mock provider，不 mock ARC bridge、Pi parent/child、parser/router、原生 mutation 或下一 turn。它运行五个独立场景，并强制覆盖 Auto-Research 与普通 delegate 的 `length` 续接：

```bash
export PYTHONPATH='D:/autoresearch_pi_project/src'
python -m autoresearch_pi.cli arc-harness-smoke \
  --arc-root 'D:/arc-agi-benchmark/arc-agi-3-benchmarking' \
  --game 'ls20' \
  --root 'D:/autoresearch_pi_project/runs/arc-harness-smoke-manual'
```

ARC provider input capabilities are configurable per run. The default is
`text`; pass `--input-modalities text,image` (or set
`ARC_INPUT_MODALITIES=text,image`) when the selected provider/model accepts
image inputs. This changes the Pi model capability declaration; the current
ARC frame adapter still renders the canonical frame as text coordinate runs.

只有聚合文件 `arc-self-harness-smoke-summary.json` 的 `passed=true` 才能证明路由/装载链路可达；它不证明真实 provider 的策略质量或 ARC 游戏表现。

真实 provider + 官方 ARC 在线环境运行时的分阶段证据、失败预期和允许结论见 [ARC 真实运行观测预期](docs/arc-real-run-observation-expectations.md)。

Terminal-Bench 完整运行在本地 Harbor + Docker 中，native verifier reward 与 self-harness evidence 分开记录：

```bash
export PYTHONPATH='D:/autoresearch_pi_project/src'
'D:/conda/python.exe' -m autoresearch_pi.cli terminal-bench-e2e \
  --dataset 'D:/terminal-bench-2-1' \
  --task 'chess-best-move' \
  --root 'D:/autoresearch_pi_project/runs/terminal-chess-treatment'
```

两条命令都可使用 `--variant control` 隐藏 Agent-visible research/mutation surface；`--context-compaction` 仅在 treatment 中暴露可选能力。单次 `summary.json` 中的 `benchmark_evaluation` 表示任务结果，`self_harness_evaluation` 表示闭环中间证据；单次 supported effect 不等于 harness improvement，仍需同任务、同模型的成对重复实验。

要验证 task-local self-harness 的基础闭环，可在 treatment ARC 运行中加
`--harness-validation`。该模式仍使用真实 ARC 环境、资源仍从 0 开始，但会要求
Agent 先对 system prompt、memory、skill、tool、subagent 完成 create/use/revise 探针；
它是技术闭环验证，不代表普通 treatment 中的自主触发率。普通运行不加该参数，
用于观察 Agent 是否会根据任务收益自发创建和优化资源。
