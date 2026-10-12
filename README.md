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

首次阅读代码可先看[完整代码导读](docs/codebase-guide-zh.md)，了解 Python runner、Pi 扩展、ARC/Auto-Research 数据流及验收边界。

设计、实现、评审和完成声明遵循 [开发流程与证据标准](docs/development-workflow.md)，
由仓库 [AGENTS.md](AGENTS.md) 约束后续开发 Agent。涉及机制或运行行为的实质变更，
使用 [变更验收模板](docs/templates/meta-harness-change.md)，也可在已有计划/报告中保留相同栏目；
小型文档修正和保持行为的维护只做与改动相称的检查。

1. 从真实失败/机会及当前代码出发，定义一个可证伪命题、减负目标和有界评估。
2. 优先简化现有流程，明确生命周期责任、正常执行成本和放弃条件；一次改变一个主要因素。
3. 按改动范围验证功能和接线，再用真实模型验证自主采用，用独立对照运行验证净收益。
4. 分别报告四层证据；没有运行的层级保留“未验证”，失败或无收益进入同一记录继续诊断。

首份 [流程采用记录](docs/reports/2026-10-02-development-workflow-adoption.md) 已说明当前证据边界和下一轮最小实验。

## 当前 thin ARC foundation

`arc-thin-e2e` 默认使用 `--foundation native`：每次运行一个 Pi session 文件，完整保留历史，通过 workspace 文件创建、编辑和使用组件。文件工具只访问 workspace；`data/`、`results/` 只读。写入组件的回执报告版本、下一请求激活或失败后的工作版本。普通笔记写入 `notes/`；长输出保存完整结果并提供精确读取引用。

当前方案使用台账 + critic；Auto-Research 已弃用并暂停其开发、验收。`consult` 是显式请求的有界角色咨询。native 默认不回放 reasoning、不强制关卡切换复盘，启用 Pi 原生自动压缩；`--no-auto-compaction` 可关闭，`--replay-reasoning`、`--level-change-review` 可用于比较。`--foundation legacy` 保留旧默认行为（自动压缩关闭）；显式 `--auto-compaction` 可开启。真实 ls20/lp85 对照尚未启动，采用和收益未验证；详见[最终方案](docs/plans/2026-10-12-harness-foundation-refactor-plan.md)及[实现验收记录](docs/reports/2026-10-12-harness-foundation-implementation.md)。

零模型费用的 native 验收入口：

```powershell
python tools/run_foundation_smoke.py runs/foundation-workspace foundation defaults
python tools/run_foundation_smoke.py runs/foundation-components components
python tools/run_foundation_smoke.py runs/foundation-receipts receipts
python tools/run_foundation_smoke.py runs/foundation-migration migration
```

这些检查使用生产 bridge、实际 Pi 和 WASI，ARC SDK 与 provider 为脚本替身；每次使用新输出目录。它们验证功能和接线，不证明模型会自主采用或改善关卡表现。

诊断高 token、推理延迟、重复取证或研究／组件未推进任务时，按需查阅 [优化经验手册](docs/optimization-handbook.md)。

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

### Auto-Research 调试开关

ARC 新运行可以显式启用或关闭研究，省略参数时保持当前默认关闭：

```powershell
python -m autoresearch_pi.cli arc-agi-3-e2e --game ls20 --no-auto-research
python -m autoresearch_pi.cli arc-agi-3-e2e --game ls20 --auto-research
```

这是启动配置，对当前已运行的进程不生效。关闭时不注册 `auto_research`，不启动研究 worker、自动续跑或投射研究交付提示；普通 `delegate_task`、作者 Subagent、Self-Harness 与已保存研究产物保留。

也可在项目 `.env` 或进程环境中设置 `PI_AUTORESEARCH_ENABLED=enabled|disabled`，作用于实际安装研究能力的 adapter；不能为未提供研究入口的 adapter 添加能力。PowerShell 临时关闭及恢复环境默认值：

```powershell
$env:PI_AUTORESEARCH_ENABLED = 'disabled'
# 启动需要调试的新运行
Remove-Item Env:PI_AUTORESEARCH_ENABLED
```

优先级：显式 CLI 参数（Python API 为 `auto_research_enabled=True|False`）> `PI_AUTORESEARCH_ENABLED` > ARC 兼容变量 `PI_ARC_AUTO_RESEARCH` > adapter 默认。环境变量只接受 `enabled` / `disabled`；非法有效值在启动时报错。`control` variant 保持研究关闭。`--auto-research-validation` 和跨情境研究验证探针在无配置时启用研究；显式关闭与这些探针冲突时报错。`arc-harness-smoke` 的确定性矩阵显式启用所验收的研究能力。

ARC 将实际值及来源写入运行目录的 `arc-runtime-config.json`（`auto_research_enabled`、`auto_research_configuration_source`），summary 中的 `runtime.review_configuration` 也保留这份配置。诊断与声明边界见 [开关变更记录](docs/plans/2026-10-08-auto-research-switch.md)。

环境变量：

- `JIT_ROOT`：JIT 测试宿主路径，默认 `D:\JIT`
- `AUTORESEARCH_META_ROOT`：autoresearch-meta 参考实现路径
- `PI_COMMAND`：Pi CLI，默认 `pi`
- `ARC_AGI_3_ROOT`：ARC-AGI-3 本地 checkout，默认 `D:\arc-agi-benchmark\arc-agi-3-benchmarking`
- `TERMINAL_BENCH_DATASET`：本地 Terminal-Bench 任务集，默认 `D:\terminal-bench-2-1`

项目锁定 `pi-jev@0.5.0`。由于该版本尚未公开通用 component source API，第一阶段的
薄 adapter 直接使用同一 TypeSafe System One/Noul 协议选择唯一的 Self-Harness
component pool，避免再建立一套 tool/skill registry。项目级变量
`PI_AUTORESEARCH_JEV_ROUTING` 有三个值：

- `disabled`（默认）：不调用 Jev，保留当前 assembly；
- `shadow`：让 Jev 评估所有当前合法的 memory、system prompt、skill、tool 和
  subagent，只记录 `task-harness-jev-routing.jsonl`，不改变 Pi surface；
- `active`：把 Jev 选择的精确组件版本写入现有 assembly，由原有 Pi runtime
  投影 context、system prompt、tools 和 subagents。

`TYPESAFE_API_KEY` 可从环境变量或 `~/.pi/agent/secrets/typesafe_api_key` 读取。
项目会强制 `PI_JEV_AUTO=0`，避免 stock pi-jev 另行路由 registered tools/skills。
组件创建、版本、有效性、依赖、权限和效果证据仍由现有 Self-Harness 管理。

可在一次命令上显式开关（全局参数放在子命令之前）：

```powershell
# 一键关闭；不会发出 Jev 请求
python -m autoresearch_pi.cli --no-jev-routing arc-agi-3-e2e --game ls20

# 先观察 Jev 决策，再打开实际路由
python -m autoresearch_pi.cli --jev-routing shadow arc-agi-3-e2e --game ls20
python -m autoresearch_pi.cli --jev-routing active arc-agi-3-e2e --game ls20
```

## ARC-AGI-3 与 Terminal-Bench

这两个环境复用同一组通用机制：真实工具 observation、开放 research goal 与 evidence-backed finding、task-local system-prompt overlay、skills、memory、tools、subagents、精确 evidence refs、通用 task-local context lifecycle、后续 exposure 和 effect assessment。lifecycle 默认自动去重 projection、限制 provider transcript、归档旧消息并保留可恢复引用；可用 `PI_AUTORESEARCH_CONTEXT_LIFECYCLE=disabled` 做显式 ablation。treatment 的首轮请求直接披露 `task_harness` 的发现、creator 读取、parent authoring、版本池、assembly、focus 与 assessment 入口；资源内容仍从空开始，并由 extension 的 `context` hook 投影到后续请求。Auto-Research child 是只读研究者，只能返回 findings、方法候选、规划影响或实验请求；它不读取 creator、不生成 Harness 组件正文，也不能调用 mutation。主 Agent 按需读取 `skill-creator` / `tool-creator` / `subagent-creator`，完整创作候选并显式选择精确版本；runtime 只校验、版本化、装配、执行和记录证据。ARC treatment 另提供由主 Agent 创作和调用的只读 Pi 子 Agent；子 Agent 没有环境动作权限。具体任务工具与 correctness evaluator 属于独立 adapter，不属于通用 self-harness。Agent-owned observation representation 仍由 `PI_AUTORESEARCH_CONTEXT_COMPACTION` 单独控制，默认不要求发生研究、委派或修改。

ARC 中的纯计算 Tool 可以直接创建、安装并试用，无需预先读取 creator 或复制网格。例如调用 `task_harness_create`：

```json
{
  "candidate": {
    "name": "grid-height",
    "description": "计算当前已观察网格的行数",
    "program": {"format": "task-pure-python-v1", "source": "{'height': len(input['grid'])}"}
  },
  "trial": {"current_grid": true}
}
```

之后向回执中的 Tool 传 `{"current_grid":true}`，每次会使用最新已捕获观测的最后一帧，注入 `input.grid`。其他输入放入 `parameters`；历史比较仍用 `bindings` 的精确引用。省略或关闭 `current_grid` 不注入网格；它不读取实时环境、不执行动作，也不覆盖显式 `grid`。首次计算失败会保留已安装版本，回执单独标记 trial 失败。功能及证据边界见[变更记录](docs/plans/2026-10-08-self-harness-current-grid.md)。

ARC-AGI-3 使用本地 checkout 内的官方 Python SDK，但正式游戏和 scorecard 仍由官方在线环境提供，因此需要 `ARC_API_KEY`：

```bash
export PYTHONPATH='D:/autoresearch_pi_project/src'
'D:/conda/python.exe' -m autoresearch_pi.cli arc-agi-3-e2e \
  --game 'ls20-9607627b' \
  --root 'D:/autoresearch_pi_project/runs/arc-ls20-treatment'
```

Memory、Prompt、Skill、Subagent 也有直接使用入口，同时保留 Agent 自定义组合：

| 组件 | 便捷入口 | 自定义选用 |
| --- | --- | --- |
| Memory | `task_memory_pool({action:"capture",items:[{key:"rule",content:"…",scope:"task"}],select:true})` 保存并将精确版本正文选入后续上下文 | 省略 `select` 或设为 `false` 只归档；`list` 获取引用，再由 `task_harness(action:"assemble")` 选择子集及 `prompt_contributions` |
| Prompt | `task_harness_create` 创建并安装 `component:"system_prompt"`，下次 provider 请求刷新；更新、撤下或失效会移除旧 overlay | `assembly:false` 仅入池；显式装配控制选中版本。`scope:"task"/"episode"/"level"/"state"` 绑定有效期，其他 scope 文字仍是说明 |
| Skill | 新写正文已在上下文中时可直接执行，不强制重复读取 creator 或 Skill | 可以仅入池、选择组合、按需通过回执的 `load_if_needed` 恢复正文 |
| Subagent | 临时分析优先 `delegate_task({task:"…",output_contract:"…",stop_when:"…",budget:{max_runtime_ms:60000,max_tool_calls:2,max_reported_tokens:40000}})`，无需保存角色；未披露时通过已有 `task_harness(action:"activate",enabled_tools:["delegate_task"])` 加载 | 需要复用职责时再保存；可仅入池、装配后独立调用，或用 create 的 `run` 首次执行；自定义 `context_recipe` 保留 |

便捷入口写入同一组件池和 assembly。Agent 后续可以按当前 assembly revision 提交完整 `selected_resource_refs` 与 `prompt_contributions`，只选择所需 Memory，或清空选择；runtime 不自动恢复已取消的选择。取消选择保留库中内容，之后仍可重新选择。Memory 批量写入只有全部成功后才尝试选择；选择冲突保留已存内容。Subagent 首次执行失败也保留已发布角色，不自动重跑。保存、装配和上下文暴露均不等于实际利用。接口、失败恢复及当前证据边界见[变更记录](docs/plans/2026-10-08-self-harness-direct-use.md)。

委派的输出要求也可写在 `context_recipe.output_contract`；同时指定时须一致。`stop_when` 是 child 应判断的语义停止条件，时间、工具调用、length 总尝试数和已报告 token 由 runtime 强制计入同一次 invocation。调用预算只可收紧操作环境上限；全局父子预算继续共同记账。`max_continuations` 包含首次尝试，默认最多 2 次；时间默认 120 秒、工具调用默认 24 次，跨续接不重新发放。已报告 token 阈值不涵盖尚未报告的在途成本，最后响应可能超额。

真实 ARC runner 内的确定性 self-harness smoke 默认只 mock parent/child provider，不 mock ARC SDK environment、ARC bridge、Pi parent/child、结构化返回解析、parent creator read、semantic change classifier、原生 mutation、assembly 或下一 turn（显式 `--mock-environment` 才替换 SDK environment）。当前矩阵覆盖五类组件、方法正反反馈、跨情境闭环，并强制覆盖 Auto-Research 与普通 delegate 的 `length` 续接：

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

2026-10-02 的推理/历史实验配置见 [设计与真实验收记录](docs/plans/2026-10-02-context-tool-reasoning-design.md#16-暂停后推理驻留与研究到行动修复)。默认保持 provider 原生设置，以下都是显式开关，不能凭开启推断游戏能力或成本已改善：

- `--reasoning-policy adaptive --reasoning-levels low,medium,high` 只选择操作者已核实的档位；未知能力保持 provider 默认。
- `--reasoning-policy adaptive-evidence --reasoning-levels low,medium` 在初始探索、首次操作效果、明确反证与稀疏停滞时选medium，其他周期选low，不要求先建立active plan；RESET不抹除同关操作的计算身份，length/拒绝续轮恢复不提前消费。默认策略不变，此分配不代表目标已解。
- `ARC_PI_THINKING_FORMAT=qwen` 或 `qwen-chat-template` 声明已验证的原生 on/off 语法，仅适用于 `openai-completions`。`--reasoning-policy adaptive-binary --reasoning-levels off,medium` 在新证据/反证等稀疏机会深入，其余周期关闭 thinking；length 和 action-boundary 恢复保留当前分配，完整模型消息后才消费机会。当前 Qwen 探索中固定 off 的任务质量失败，二元策略仍属实验。
- `PI_PROVIDER_REASONING_HISTORY_POLICY=summarize_openai_field` 与 `PI_PROVIDER_EDITABLE_REASONING_PROVIDERS=yibu` 仅整理已声明 provider 的旧完整工具事务中的普通 `reasoning_content`，保留近期交换、协议签名/opaque、异常续接及精确原文引用。默认 `preserve`。
- `PI_ARC_EXACT_REGION_TABLE=enabled` 附加当前公开像素的有界区域/坐标折叠表；完整当前网格/PNG保留，派生表不判断目标或编辑性，默认关闭。
- `PI_ARC_CONCISE_GUIDANCE=enabled` 用精简的目标优先正文启动普通ARC任务，详细程序按需查contract；不替换显式closure探针、不关闭原runtime完整性检查，默认关闭。此开关的真实目标检验/关卡收益仍按设计记录分层验收。
- `PI_ARC_TOOL_DISCLOSURE=on_demand` 发现研究机会时仅额外展示delegate/task_resource，其他注册能力经既有enable入口展示；权限、预算与版本校验保留，默认仍为原展示方式。
- `PI_ARC_CHILD_OBSERVATION=published` 对已获arc_state授权的只读child，在每个provider续轮直接送入父发布时的完整固定grid/PNG，省去首次取图决策；不授予live环境或动作权限，不适用于action lease。默认按需读图，真实收益见[第17节](docs/plans/2026-10-02-context-tool-reasoning-design.md#17-290989-token失败后的输入重放与目标推进优化)。

ARC动作证据卡覆盖所选动作时，仍保留child已授权的固定状态读取；动作卡完整不等于完整画面已提供。ARC当前完整观测现在经每次续轮的临时user槽提供；相同动作末帧与当前帧只发送一份像素，保留各自语义角色和不同动画帧。系统指导、必要状态、未完成推理事务及读页工作集保持可见；研究候选被显式关联行动执行后，旧建议转为previous_proposal并附后续真实回执，不再当作新next_step。这些功能修复不等于通关或净收益证明。

2026-10-03起，`task_harness`默认展示常用控制参数；`contract(topic=review|level_review)`加载对应typed复盘字段，level_review需当前window_id。`auto_research`的start/assign直接可用；`contract(schema_action=enqueue)`加载多节点plan。已加载schema跨轮/会话恢复保留，旧完整调用仍按完整schema校验；`contract(schema_action=core)`主动缩回常用展示，`PI_MANAGEMENT_SCHEMA=full`回退完整注册。真实ARC初始六工具定义字符减少29.54%，确定性真实SDK矩阵17/419通过；真实模型采用、token/耗时及任务收益未测，见[设计第19节](docs/plans/2026-10-02-context-tool-reasoning-design.md#19-2026-10-03-核心管理-schema-按需精简)。

ARC默认`task_harness(status|inspect)`保留可变任务状态、精确组件池/装配和待办；详细手册使用`section=<字段>`，完整状态使用`section=all`。三个creator默认返回完整短作者契约，支持资料按需读取；待创作正文跨轮/恢复保留，成功创建后收起。常用控制入口保持可用，选中Skill/Tool/Subagent才暴露对应使用入口；其他管理用`enable`发现，已有Memory或真实动作后可记录Memory。`--max-reported-tokens`是父子共享的已报告usage停止阈值，最后流及并发请求可能超额。最新SDK确定性矩阵17/425通过；真实qwen窄诊断创建并显式装配Skill、引用程序执行1动作，57356已报告tokens/0关。此前因预算取消的样本保留。五组件真实能力、普通采用及关卡收益仍未完成，见[设计第21节](docs/plans/2026-10-02-context-tool-reasoning-design.md#21-2026-10-03-面向关卡求解的创作与上下文整修)。

两个创建/装配入口复用Pi原生顺序批次；同响应创建失败后不继续依赖装配或ARC动作，下一父轮可根据回执恢复。ARC默认`contract(topic=development)`返回完整短契约，旧两篇全文用既有`section=all`读取，正文12434→2641字符。当前源码SDK确定性矩阵17/425通过。真实qwen的三次有界探索合计143832已报告tokens/0动作；low样本有Skill候选和装配，但后续纯reasoning截断、预算停止，未证明批次采用或效率收益。普通推理默认未更改，详见[设计第22–24节](docs/plans/2026-10-02-context-tool-reasoning-design.md#22-2026-10-03-复用原生顺序工具批次降低首次使用往返)。

五类组件的完整创作与精确装配仍保留；assembly回执提供短使用目录，选中Skill通过任务目录受限`read(path)`加载，保留共同装配Memory及后续System Prompt，重启后恢复使用接口。加强后的真实SDK确定性矩阵17/425通过（含Tool数值、Subagent语义返回和两类length）。真实qwen显式组合诊断未生成作者候选或assembly，不据此声称自主创作或游戏收益；成本、失败与恢复目标连续性缺口见[设计第20节](docs/plans/2026-10-02-context-tool-reasoning-design.md#20-2026-10-03-精简后的五类组件构造与组合使用验收)。

实验应使用全新 run 目录，并显式给出 `--max-actions 60 --experiment-timeout 1800 --max-output-tokens 65536 --input-modalities text,image --review-mode advisory`。1800秒是实验停止条件，不是官方时间限制；到期时未运行满60动作须按真实数量报告。`arc-runtime-config.json`记录实际配置，`provider-telemetry.jsonl`记录发出的参数、首个模型delta、完成时长和usage。output已含reasoning，不重复相加；失败/pending缺usage不代表免费。组件检查、真实接线、自主采用及净收益分开验收。
