# Auto-Research / Pi self-harness 优化记录

- 日期：2026-09-07
- Track：`task-local-evidence-connection-v1`，仅为文档标记，不是 runtime revision。
- 状态：模型可见的 observation→finding→apply/keep decision→Pi-native exposure→bounded effect assessment 闭环与离线集成已实现；本轮之后的真实模型自主研究与优化收益尚未验证。
- 架构依据：[任务内架构](../plans/2026-09-06-autoresearch-pi-task-local-architecture.md)、[原语设计约束](../harness-primitive-design-notes.md)及用户本轮授权。
- 原始 `/mnt/data/pi_kernel_minimal_mutation_design_constitution.md` 在当前 Windows 工作区不可见。本记录不声称已核对该文件全文；延续已明确的 Pi-native、外层精简、任务间同基线约束。

## 1. 本次修正的问题

此前 `officebench-e2e` 的提示提前推荐固定的 `source_and_date`，runner 又把该 mutation 及其快照作为任务通过的必要条件。后续工具只读取变量并追加状态字符串。这能展示 Pi extension 内状态可变，但无法说明 agent 根据探索证据选择了调整，也没有实际改变模型后续收到的指导。

本次没有增加研究调度器。连接仍发生在同一个 Pi task agent 内：它可以参考稳定方法、记录当前任务资源，按需要调用已有调整工具，再观察后续执行。是否研究、嵌套、迭代、调整或结束仍由 agent 决定。

## 2. 已实现

本轮补充实现了原先缺失的“研究资源 → 后续执行条件”连接。连接仍是条件式的：agent 可以不记录研究、不调整工具；runner 不代替 agent 做这些决定。

### 2.1 方法与具体任务能力分开

- 新增 `demo/auto_research_method.md`，只提供通用研究启发和边界，不包含 OfficeBench、具体工具名或原语实现。
- Pi extension 通过公开 `before_agent_start` hook 加入该方法资源；任务工具的用途、范围、生效时间仍由原生工具描述暴露。
- 明确允许直接执行、不开展研究、不调整 harness。未实现固定研究阶段、必填表单或自动递归。
- 这是本地方法文档接入，不是已经接入外部 Auto-Research 包或独立 Meta runtime。

### 2.2 可选的当前任务工作资源

- `task_notes` 是本 demo 的普通 Pi 注册工具：`text: ""` 时读取，提供自由文本时追加到 `task-notes.md`。参数保持必填，以兼容当前 yibu OpenAI-compatible gateway 对函数 schema 的校验。
- Agent 可以记录问题、证据引用、探索结论、调整依据、预期和后续观察；没有强制格式或阶段顺序。
- 内容通过工具结果供后续 Pi execution 使用，并进入任务交接文档；独立任务不会自动加载前一任务笔记。
- 笔记明确标为 agent 自述，不能因写了“研究”就自动判定存在真实研究闭环。
- 这不是定案后的 memory/harness 原语接口，也不是独立 harness trace memory。

新增 `research_resource` Pi 原生注册工具。`question/uncertainty/evidence/decision` 是记录粒度而非流程阶段；`evidence_refs` 必须引用本任务先前 action 的 Pi tool call ID，另记录 `expected_recurrence` 与 `remaining_uses`，用于让后续执行判断调整收益。有效资源获得稳定的 `finding-N`，写入 `research-resources.jsonl`，并以最多 5 条的有界摘要进入后续模型上下文。Agent 仍可不调用该工具。

### 2.3 已有调整工具产生真实上下文作用

- 保留已有 demo 级 `set_evidence_policy(value)`，未增加统一 mutation API。
- 实现是 extension-local 状态加 Pi 官方 `context` hook；Pi 没有名为 `evidence_policy` 的内置能力，不应把这个示例名称当成 Pi 官方原语。
- `summary_only` 提供简洁证据摘要指导；`source_and_date` 提供保留来源、时间和标注歧义的指导。
- 每次模型调用前注入当前指导，下一次模型请求即可观察，包括同一次 prompt 的工具后续调用；不重启 Pi、不重启 prompt、不修改 Pi 源码。
- 上下文转换不累积旧指导消息；改回 `summary_only` 是同一 setter 的正常调用，不是 rollback 机制。
- 工具结果记录 `previous/value/changed`、原生 tool call ID 和下一次模型请求的生效边界；重复设置不算实际变化。
- 移除 OfficeBench 输出尾部的“policy observed”字符串。操作后 `observed.json` 表示后续 context hook 读取了该设置，而不是模型遵从或任务收益。
- 状态只存在于本任务的 Pi 进程；没有源码热替换、通用组件注册表或 Kernel harness 适配层。

新增 `decide_execution_surface` 作为本 demo 的具体 Pi-native capability decision。它支持 `apply` 与 `keep`：两者都要求非空 `basis_resource_ids` 引用本任务已有 finding；只有 apply 调用 `pi.setActiveTools()`，在下一次模型请求前切换 `general` 与 `calendar_focused`。后者移除宽泛 `officebench_action`，保留直接 `calendar_action`、资源工具和控制工具。Keep 会留下明确的不调整判断，避免把“判断无收益”和“没有理解 capability”混为一谈。未知 finding 在调用处被拒绝；没有 finding 时仍可直接完成任务。

后续 `context` observation 以同一次 `decide_execution_surface` call id 关联依据、实际调用的 `pi.setActiveTools()` 和当时可见的 active tools，并把这三个事实返回模型上下文。`evidence_policy` 与 execution surface 使用独立 call id，证据指导变化不会伪造工具范围已被观察的记录。

有效调整获得稳定的 `decision-N` 并写入 `harness-decisions.jsonl`。第一次后续模型请求把原生 active tools 观察写入 `harness-observations.jsonl`，同时返回任务上下文；同一次调整只写一条 effect observation。

### 2.3.1 真实模型可见连接与短窗口反馈

- 本地 runner 修正从 JIT 导入的过期“只有两个工具”文本，不修改 `D:/JIT`；任务提示和 extension system context 都说明当前 Pi tool schema 才是权威能力表。
- OfficeBench bridge 把 backend 字符串分类为 `success` 或 `semantic_error`，覆盖真实日志出现过的 unknown action、`Failed to ...`、shell unknown option、找不到路径；transport failure 单独记录。
- 每个 task action 的模型可见正文末尾附一条紧凑 `EXECUTION_OBSERVATION` card，直接给出 `observation_id/outcome/error_kind/relevant_capability`。Canonical 完整记录只写一次 `execution-observations.jsonl`。
- Apply decision 必须声明 `effect_metric` 和 1–8 次 `observation_horizon`。后续 task action 形成有界窗口；完成时写入 `effect-assessments.jsonl` 并在下一次模型上下文返回一次。任务提前结束则落盘 `inconclusive`。
- 当前支持 `semantic_error_rate`、`focused_tool_use_rate` 与 `calendar_batch_utilization`。任务内 verdict 为 `supported/contradicted/inconclusive`，仅表示观察是否符合本次 decision 的预期，不是跨运行因果改善。
- Python runner 不直接信任 assessment 的 verdict：它重新读取 finding evidence、execution observations、Pi exposure observation 和 decision，独立重算 baseline/window counts 与 verdict；引用、计数、metric、exposure 或 improvement 声明不一致时报告 `invalid_link`。

新增 `calendar_action` 仅是 OfficeBench extension 的任务工具，以便上述官方工具范围切换具有实际行为效果；这不是 Kernel 适配层，也不是通用 mutation protocol。`pi.setActiveTools` 只影响后续模型调用，不改变已发出的请求或 JIT 后端语义。

真实运行进一步表明，只隐藏宽泛工具没有足够调整收益，而且模型可在同一次响应中并列发出 12 个 direct create，事后 decision support 已经来不及改变该批执行。为此新增一个明确有行为收益、但初始不在 active surface 中的 `calendar_batch_action`：它通过一个 Pi tool call 和一个 Python bridge 进程执行 2–16 个真实 JIT calendar create，逐项返回非原子结果。只有 finding-backed `calendar_batch` 决策才会用官方 `pi.setActiveTools()` 使它在下一模型请求可见。

`research_resource.continue_with` 是可选的具体连接点：agent 可在同一次工具调用中先落盘 finding，再记录与该 `finding-N` 关联的 apply/keep decision，从而减少原先两次额外模型决策的成本。省略该字段时只创建研究资源，harness 完全不变；原有独立 `decide_execution_surface` 仍用于推迟决定。该接口限定在本 demo 的 execution surface 能力，不是通用 mutation API，也没有 kernel 调度。

### 2.4 取消假阳性通过标准

- 不再要求产生 mutation，也不再要求固定的 before/after/observed 值才能评测任务。
- `passed` 仍为 Pi 正常完成且 JIT evaluator 通过。`aborted/length/toolUse/error` 的最终消息不作为完成答案。
- Summary 的 `outcomes` 分开记录 task execution、evaluator signal、未独立验证的 task correctness、harness adjustment 和 harness improvement；保留旧顶层字段供兼容读取。
- Runner 在 agent 前后只对 evaluator 实际指向的任务内文件或目录保存目标级 SHA-256 指纹，不复制文件内容。`task_correctness` 额外报告 `required_paths`、`changed_required_paths` 与 `artifact_change_status`，因此能暴露“关键词 evaluator 通过但目标文件完全没变”的弱反馈；该变化信号仍不等价于语义正确。
- `loop_integrity` 独立解析四类任务资源，报告 `not_attempted / invalid_basis / applied_unobserved / linked_effect_observed`。这只验证引用链和后续调用可见性，不推断收益。
- Hook 观察要求匹配对应 capability 的 tool call ID、设置值、active tools 和实际观察入口，不能把旧快照或另一种调整当作最后一次变化的生效证据。
- `harness_improvement` 明确保持 `not_established`；工具数、Pi turn 数、笔记和 evaluator pass 均不自动证明研究或提升。
- 交接文档引用实际笔记及 RPC 事件，不再把工具序列包装成研究闭环。
- Handoff 只保留资源路径、计数、ID 和状态，不再复制 `task-notes.md` 或 JSONL 正文；canonical facts 各写一次，减少重复落盘和后续分析成本。

### 2.5 部分执行证据及时保留

- `PiKernel` 只增加通用事件接收回调，不理解研究或 harness 语义。
- E2E runner 收到每条已解码事件即写入并 flush `pi-events.jsonl`，不再等任务结束才落盘。
- `pi-events.jsonl` 使用 `compact-jsonl-v1`：工具、turn、agent、retry 和 settled 等语义事件完整保存；高频 `message_update` 只保存增量事件，删除重复的顶层累计 `message` 和 `assistantMessageEvent.partial`。超时前的文字、thinking 和 tool-call delta 仍可重建。
- `pi-runtime-status.json` 写明 `trace_format` 与 `message_updates` 语义，分析程序无需猜测日志是否为原始逐帧镜像。
- `pi-runtime-status.json` 区分 `running/settled/interrupted`，异常时保留部分 trace，并标记 `trace_complete: false`。
- 修正 `agent_settled` 早于 RPC response 到达时的等待行为。
- 单 case 和 batch 均要求空输出目录，避免旧快照、旧笔记或旧任务产物污染新结果；不删除或覆盖已有运行目录。

## 3. 实际 Pi capability 与证据

- 实际安装：`@earendil-works/pi-coding-agent` **0.80.6**。
- 使用官方公开 API：`registerTool`、`before_agent_start`、`context`；测试另用官方 `registerProvider/streamSimple` 注入无网络的脚本模型。
- 已核对安装包 `docs/extensions.md` 的 `context` 生效时机，以及 `docs/custom-provider.md` 的 provider 接口。
- 离线集成测试启动真实 Pi CLI 和原生 agent loop，加载本次生产路径使用的 OfficeBench extension；脚本模型发出工具调用，不直接调用 extension 内部函数。
- 一次 prompt、同一 PID 的六次 provider 请求实测指导为：

  `summary_only → summary_only → source_and_date → source_and_date → summary_only → summary_only`

- 真实 Pi 执行了笔记追加、设置变化、后续读取；provider 入口的上下文记录证明收到更新。另起一个独立进程，只收到 `summary_only`，没有上一任务笔记或 mutation 快照。
- 该测试没有调用 OfficeBench action backend、JIT evaluator 或远程模型；不是 OfficeBench E2E 成绩，也不是真实模型自主研究的证据。

## 3.1 真实模型批量运行中的 schema 修复

2026-09-07 的 `pi-officebench-e2e-5-1` 运行 5 个 case 全部在首个模型请求失败，错误完全一致：`Invalid schema for function 'task_notes': null is not of type "array"`。原因是可选/空参数在该网关的函数 schema 转换中变成了 `null`。已将 `task_notes` 改为必填 `text: string`，空字符串表示读取，并通过真实 Pi 离线集成和 21 个相关测试验证。该旧目录保留为失败证据，不覆盖重跑。

## 3.2 `pi-officebench-e2e-5-4` 对连接缺口的复现

该批次发生在本节“模型可见 observation/apply-keep/effect window”优化之前。5 个真实任务均产生 execution observations，但 finding、decision、effect assessment 全为 0。`1-2-1` 连续出现 shell/path/command 失败，最终以 `length` 结束、evaluator 目标不变，但 legacy evaluator 仍给 1.0；`1-2-4` 也出现两次 unknown calendar action。它证明旧实现只是让协议可调用，真实模型没有获得足够清晰的连接与反馈。

本轮正针对该证据修改：错误不再仅记为 completed；observation ID 进入模型正文；过期“两工具”提示被移除；apply/keep 与 effect window 被明确披露。后续真实模型复跑与持续 research lifecycle 验证见 3.4–3.9；单次成功仍不能声称一般化 harness improvement。

## 4. 测试结果

versioned lifecycle、batch capability、可审计 summary projection、明确 email action 契约和独立效果重算落地后的最终全量回归：**74 passed**，含真实安装 Pi CLI/agent-loop 的离线集成测试。

```powershell
D:/conda/python.exe -m pytest -q
```

该命令是本次已执行记录。再次运行时请为 `--basetemp` 指定新的专用测试目录，因为 pytest 会清理指定目录；不要指定项目、runs 总目录或需要保留的结果目录。

覆盖：无 mutation 正常通过；有设置但没有后续 hook 观察不阻塞任务评分；笔记按自述报告；agent 失败与 evaluator pass 分离；非正常最终消息；旧结果保护；设置重复/失败统计；hook 与原生调用 ID 对应；部分事件在超时前已可读取；runner 异常状态；真实 Pi 上下文变更和任务隔离。

本轮新增覆盖：真实 backend 语义错误分类；模型可见 observation card；过期 capability 提示修正；action observation 的稳定证据 ID；finding 引用检查及后续有界摘要；高收益 apply 与低收益 keep；finding-backed `pi.setActiveTools()` exposure；focused 与 batch 的 `supported` assessment 及一次性上下文返回；初始隐藏、finding-backed 才启用的 batch surface；单 Pi/bridge 调用的多工作单元计数；未知 finding 拒绝；evaluator 目标 SHA-256 对照；闭环完整性与 task-local effect 分离。不同 capability 的 observation 不串线，仍不要求研究或 mutation 才能完成任务。

在 JIT conda 环境完成 `2-13-0` 真实复跑后又增加：calendar observation 的显式 `decision_support`；finding 返回值中的 `EXECUTION_DECISION_POINT`；`candidate_seen_no_finding`、`finding_recorded_no_decision`、`keep_recorded`、`apply_effect_observed` 等连接阶段评价；calendar direct tool 的完整参数契约；shell 当前工作目录与复合命令限制；错误文本必须以明确输出行出现，避免读取源码时误命中，同时识别 `python -c` 参数错误和 traceback。

落盘压缩回归覆盖正常完成与超时两条 runner 路径。对旧运行 `pi-officebench-e2e-5-3/1-2-1` 的 861,040,757-byte 原始 trace 做只读重编码测算，`compact-jsonl-v1` 为 5,821,307 bytes，减少 99.32%（约 147.9 倍）；原文件未覆盖或删除。

测试产物：`runs/pytest-opt-full-20260907/test_installed_pi_context_muta0/` 下的 `mutate/` 和 `baseline/`，包含 `provider-contexts.jsonl`、`pi-events.jsonl`、原生快照及可选任务笔记。

首次默认临时目录运行遇到 Windows `WinError 5`；改用项目内独立 pytest 临时目录后完成验证。未改变系统目录权限。

## 5. 未实现 / 仍有限制

- **单个真实 OfficeBench case 的任务内闭环已验证，但不代表普遍策略。** `2-13-0` 的真实模型自主创建了 evidence-backed finding、选择 batch surface、触发 `pi.setActiveTools()`、在下一请求调用 batch，并由独立评估器确认 12/12 work units 与 call compression；低收益任务仍可能合理地不研究或不修改。
- **调整改善一般任务表现仍未验证。** 本次证明的是该 case 的任务内行为效果（一个 Pi/bridge call 完成 12 个 create）和正确产物，不是跨 seed、跨任务或对照实验上的稳定收益。
- **单次 linked effect 不是改善证据。** `linked_effect_observed` 只证明 finding、decision、原生调用与下一次模型请求的引用一致；没有同任务可比基线、收益指标或因果归因，因此 `harness_improvement` 固定为 `not_established`。
- **外部 Auto-Research / Meta 包的集成：未实现。** 本次使用同一 agent 内的稳定方法文档和任务资源，无独立 Meta 调度或同步协议。
- **具体 harness 原语命名、接口与粒度：继续搁置。** 开始这项设计前必须提醒用户重新对齐；本例不是统一接口基线。
- **独立 harness trace memory、版本查询、跨进程恢复：未实现。** 沿用已有任务 RPC trace 和最新快照；快照不是完整变更历史，历史操作需查看 RPC 事件。
- **重启后恢复 extension 状态：当前实现不支持。** 使用 `--no-session` 和进程局部状态；不能把单进程任务隔离描述为已支持长程恢复。
- **中途替换正在执行的模型请求/工具执行：本实现不支持。** 官方 `context` hook 是下一次模型调用前生效，不是修改已发出的请求。
- **任意 extension 源码热替换、任意工具实现热插拔：本次未验证，不宣称 Pi 支持。** 也未用 watcher、私有协议或 monkey patch 仿造。
- **来源/日期的强制验证或证据格式化：未实现。** 当前改变的是模型指导，不是工具后端语义，模型可能不遵从。
- **研究因果的自动判定：未实现。** 笔记与按序工具调用便于人工核查，但时序相关不等于研究驱动或因果收益。
- **无限长任务的笔记压缩、检索、分页：未实现。** 当前自由文本笔记适用于最小验证，完整读取可能增加上下文成本。
- **日志耐久性：有限。** flush 保留进程已收到的事件，不保证硬断电持久化，不包含全部 stderr，也不能保留尚未到达的事件。日志可能包含任务数据，应按本地任务产物管理。
- **跨任务学习：不实现。** 不同独立任务保持相同初始状态，旧产物仅供人查看，不自动纳入新任务。
- **旧 demo 未重构。** `meta-harness-demo`、`officebench-smoke` 不作为本次真实研究或正式 OfficeBench 成绩的验证依据。

## 6. 本轮最小实现与真实消融（2026-09-09）

### 6.1 合宪实现

新增 `run_shopping_e2e_experiment` 与 `shopping-experiment` CLI。该 runner
只创建独立 control/treatment Pi 进程、交错执行顺序、隔离 cart，并聚合每个
运行已经落盘的任务正确性、研究、Pi exposure 和 effect 字段；它不创建 finding、
不调度研究、不调用 `pi.setActiveTools`，因此没有形成第二层 harness。

同时修正 Shopping extension 的三个证据缺口：

- `get_product_details` 成功观察也可展示候选决策点；此前只有第一次加购后才提示，
  与长任务逐项验证方式不匹配。
- bridge 返回结构化 `error` 时记为 `semantic_error`，不再把“工具调用成功但业务失败”
  计作成功信号。
- effect window 只在 Pi 原生 surface 已被后续请求观察后开始，区分普通 direct add 与
  `shopping_batch_action`；assessment 记录真实 Pi tool call 数，并在下一次 context
  暴露给 agent，agent 可用 `assessment_refs` 吸收结果。

### 6.2 测试

离线回归：

```text
D:/conda/python.exe -m pytest tests/test_pi_shopping_native.py tests/test_shopping_e2e.py tests/test_cli.py -q
14 passed
```

新增覆盖：配对 runner 的 counterbalancing、control/treatment mediator 分离、空 case
和非空输出目录保护、CLI case 解析。

### 6.3 JIT 真实结果

运行：

```text
D:/anaconda/envs/jit/python.exe -m autoresearch_pi.cli shopping-e2e --level 2 --case 2 --timeout 180 --variant treatment
D:/anaconda/envs/jit/python.exe -m autoresearch_pi.cli shopping-experiment --cases 2:2,3:2 --repeats 1 --timeout 90
```

Level‑2 case‑2 treatment：17 次观察后超时，cart 为空，finding/decision/effect 均为 0。
观察中出现 `candidate_details_observed` 决策卡，但 agent 没有进入研究或加购闭环。

本轮还修正了超时证据持久化：Shopping runner 现在对每条收到的 Pi RPC 事件立即
flush 到 `pi-events.jsonl`，并写入 `pi-runtime-status.json`。短时真实 smoke
`shopping-level2-case2-partial-1` 在超时后保留 8 条 execution observation，状态为
`interrupted`、`trace_complete=false`；因此后续分析不再依赖进程是否正常结束。

随后在 `shopping-level3-case2-partial-2` 的 25 秒真实 smoke 中，保留了 1,939 条 Pi
事件并正确标记 interrupted。原始累计 message 快照约 8 MB，故同一 runner 现使用
`compact-jsonl-v1`（去除高频 message_update 的累计 partial/message，仅保留增量）;
canonical `execution-observations.jsonl` 不做压缩。该优化只降低落盘和分析成本，不改变
agent 可见上下文或研究触发条件。

配对结果目录：`runs/shopping-paired-2-2-3-2-real-1`。

| case | control | treatment | finding | applied | supported effect | 结论 |
|---|---:|---:|---:|---:|---:|---|
| level2/case2 | fail, score 0 | fail, score 0 | 0 / 0 | 0 / 0 | 0 / 0 | tie |
| level3/case2 | fail, score 0.1667 | fail, score 0.1667 | 0 / 0 | 0 / 0 | 0 / 0 | tie |

该实验是有效的消融失败证据：新增资源没有自动制造 finding，也没有把失败伪装成
效果；但不能证明 treatment 有收益。当前 `harness_improvement` 仍必须为
`not_established`。

### 6.4 当前阻塞与下一步

主要阻塞仍是 Shopping agent 的检索循环和长度耗尽，而不是缺少更多归因字段。下一轮
应优先增加一组短、可完成且收益结构明确的 level‑2/level‑3 case（高收益重复、低收益
单次、部分失败、需求反转），使用相同 paired runner 做多次 repeat。只有在 treatment
正确性不下降且 correctness-gated effect 稳定领先 control 时，才可声称 harness improvement。

不要因为本轮出现 `candidate_details_observed` 就自动生成 finding；不要为解决长程循环
增加 scheduler、强制研究步骤或第二层 memory/harness。

### 6.5 OfficeBench 高收益配对复验

为避免 Shopping 检索循环单独决定结论，使用同一 JIT 环境重新运行了已有高收益日历
任务 `2-13-0`：

```text
D:/anaconda/envs/jit/python.exe -m autoresearch_pi.cli officebench-e2e \
  --case 2-13-0 --root runs/officebench-2-13-0-current-treatment
D:/anaconda/envs/jit/python.exe -m autoresearch_pi.cli officebench-experiment \
  --case 2-13-0 --repeats 1 --root runs/officebench-paired-2-13-0-current-1
```

结果：control 与 treatment 均 evaluator 通过、所有 6 个目标日历文件均发生变化；
treatment 真实创建了 finding、调用 `pi.setActiveTools(calendar_batch)`，后续请求观察到
新 surface，完成 12/12 work units，effect 为 `supported`。在这一次 paired run 中：

| 指标 | control | treatment | delta (treatment-control) |
|---|---:|---:|---:|
| task/evaluator pass | 1 / 1 | 1 / 1 | 0 |
| model turns | 11 | 6 | -5 |
| backend bridge processes | 25 | 15 | -10 |
| finding→effect link | 0 | 1 | +1 |

这证明当前机制能够在真实 OfficeBench case 中同时保持任务正确性并减少执行开销，
但只有一个 case、一个 repeat，`harness_improvement` 仍为 `not_established`。需要
高收益、低收益、部分失败和需求反转任务的多次 paired repeat，才能排除任务/模型偶然性。

## 7. 下一阶段目标

1. 使用新的运行目录扩展到分层 OfficeBench 小批：保留 `2-13-0` 高收益 case，并加入低收益 no-change 与跨工具反转 case；不复用旧结果目录。
2. 人工核对典型任务中的完整证据链：agent 是否提出具体不确定性，实际观察是否支持其结论，为什么选择普通行动/进一步研究/调整/不调整，后续模型行为是否与调整预期一致。没有研究或没有修改也可以是合理结果。
3. 对有实际调整的 case 分开检查“上下文已应用”“模型行为发生变化”“任务结果或执行成本改善”。需要比较时仅作为离线评估，不把对照实验固化进 agent 运行流程。
4. 对文本答案补充独立语义核查，再决定是否需要最小评测改进；不把 JIT 的弱关键词规则当作正确性的充分证明。
5. 只有真实任务暴露现有能力不足后，再与用户对齐具体原语边界或长程资源需求；不要先建设通用接口、独立 trace 系统或 Meta 控制层。

建议手工复跑时同时覆盖三类任务，而不是只取数据集前 N 条：

- 高潜在收益：`2-13-0`，先读 Excel，随后为多名参与者反复创建日历事件；若前置执行暴露可复发问题，后续有足够 action window。
- 低收益对照：`1-2-3`，主要是一次判断与答案写入，合理结果可能是直接完成或 keep。
- 跨工具反转：`2-15-0`，需要 calendar→Excel，过早保持 calendar-focused 应被避免或按 `reconsider_when` 恢复。

三类任务应使用独立新目录逐个 `--case` 运行；不要把是否 mutation 当作通过条件。

## 7. 本次改动文件

- `demo/auto_research_method.md`
- `demo/pi_officebench_e2e_extension.ts`
- `src/autoresearch_pi/pi_kernel.py`
- `src/autoresearch_pi/officebench_e2e.py`
- `tests/test_pi_kernel.py`
- `tests/test_officebench_e2e.py`
- `tests/pi_offline_context_provider.ts`
- `tests/test_pi_officebench_native.py`
- `demo/README.md`
- `handoff.md`
- 本记录文件

原有未提交改动均保留；没有修改 `D:/JIT`、安装的 Pi 源码或模型凭据，没有新建 Git commit/tag。

### 3.3 schema 修复后的早期真实模型复跑

修复后使用新目录 `runs/pi-officebench-e2e-schema-fixed-1-2-0` 实跑同一 yibu 模型：Pi `0.80.6`、`pi_agent_succeeded=true`、JIT evaluator `score=1.0/is_pass=true`、命令返回 0。该模型选择了不调整 `evidence_policy`，只执行 OfficeBench actions 并读取任务笔记；这正是 mutation 可选的成功路径，不证明 harness 有改进，也不证明该 agent 构建了完整 Auto-Research 闭环。

### 3.4 JIT conda 环境真实复跑与连接阶段优化

使用 `D:/anaconda/envs/jit/python.exe` 作为外层 runner，并由 Pi extension 使用相同 JIT Python 后端，在新目录 `runs/effect-high-2-13-0-real-3-jit-env` 运行 `2-13-0`。Pi `0.80.6`、模型 `a:deepseek-v4-flash`，约 59 秒内完成 23 次工具执行，为 Excel 中 12 名参与者创建了与各自时间段一致的日历事件；JIT evaluator 为 1.0，人工读取 12 个 `.ics` 也确认均含正确 `VEVENT`。

该运行有一个 direct calendar 成功后仍剩 12 次 `create_event` 的明确候选窗口，但 agent 没有记录 finding、decision 或 effect。说明任务并非没有重复工作；问题之一是成功的低风险路径没有被显式标为可引用证据，且无闭环时 evaluator 只能报告 `not_attempted`。同时发现 calendar direct tool 描述没有独立列出参数、shell 工作目录边界不够醒目，以及源码正文包含错误短语会造成分类假阳性。

后续实现保持 mutation 可选：候选 calendar observation 会显示并持久化 `decision_support`；`research_resource` 成功后返回引用稳定 `finding_id` 的 decision point；Python runner 独立报告连接停止阶段。没有自动 finding、自动 decision、kernel 调度器或通用 mutation API。

### 3.5 首个真实 Auto-Research → Self-Harness 任务内闭环

使用 `D:/anaconda/envs/jit/python.exe` 在新目录 `runs/effect-high-2-13-0-real-8-closed-loop-summary` 运行真实 `2-13-0`。Pi `0.80.6`、模型 `a:deepseek-v4-flash`，任务和 JIT evaluator 均通过；12 名参与者的 `.ics` 文件均实际生成。

该 run 的 canonical 链路为：Excel 读取 observation 与 Alice 日历探针 → agent 自主写入 `finding-1`（`remaining_uses=12`）→ 同一 `research_resource.continue_with` 明确选择 apply → `decision-1` 调用 `pi.setActiveTools()` 切换到 `calendar_batch` → 下一模型请求的 `harness-observation-1` 看见 batch 工具 → 一个 `calendar_batch_action` 在一个 bridge 进程内完成 12/12 create → `effect-assessment-1` 记录 `tool_call_compression=12`、verdict `supported`。生成时 summary 直接报告：

- `research_connection = apply_effect_observed`
- `loop_integrity = linked_effect_observed`
- `execution_condition_effect = supported`
- `harness_adjustment = changed_and_later_observed`
- `harness_improvement = not_established`

最后一项刻意不升级：一个 case 足以证明任务内闭环和具体行为效果，不足以证明一般化 self-harness 改善。

### 3.6 Level 3 `3-6-0`：可审计 no-change 路径与 email 契约

首次运行 `runs/level3-3-6-0-auditable-summary-1` 以 `length` 失败、score 0。69 条 execution observations 中没有 structured research goal 或 harness decision；模型反复通过 shell 和 sibling runs 猜测 email 接口。该 run 的 `closed_loop_evidence` 仍完整列出当时 capability catalog、空 goals 和空 changes，证明 summary 不再用聚合成功状态掩盖未发生的闭环。

根因是 OfficeBench extension 覆盖了 JIT 原工具描述，只明确披露 calendar/shell，没有披露 JIT 已支持的 `email.send_email/list_emails/read_email` 参数；而旧 `calendar_batch` surface 还会隐藏唯一的 broad email 入口。修复注册了明确的 `email_action`，并在 general、calendar_focused、calendar_batch 三种 surface 中保留它，避免日历优化移除后续邮件能力。

新目录 `runs/level3-3-6-0-auditable-summary-2-email-contract` 重跑后 Pi 正常完成、JIT evaluator score 1.0。实际生成一个 `calendar/Alice.ics` 和 14 个 `.eml` 文件；日历包含 `DTSTART:20200508T090000`。该 agent 没有调用 `research_resource` 或修改 harness，因此 summary 如实报告 `goals=[]`、`self_harness_changes=[]` 和完整可用资源目录。这是合法 no-change 成功路径，不是第二个闭环样本；运行中仍存在较多 evaluator/sibling 探索，后续可继续收紧任务资源边界。

### 3.7 正式 artifact contract 与任务资源边界

新增单一来源 `demo/officebench_artifact_contract.json`。Runner 在模型启动前将其写为每个 run 的 `artifact-contract.json`；Pi 首轮上下文只注入 `model_disclosure` 紧凑投影，详细 action 可通过只读 `task_artifact_contract` 按需查询。Contract 披露 backend 路径、参数、覆盖语义、官方验证 action，以及 `next week`、单数当前用户日历、源数据成员、行级 section/time、名称大小写等任务语言映射；不包含 task answer 或评分条件。`summary.json.closed_loop_evidence.available_resources.artifact_contract` 仅保留 scope、通用语义、model disclosure、action index 和 canonical source，避免复制完整 contract。

Bridge 在调用 JIT backend 前检查所有 path-like 参数和 calendar/email 路径组件。绝对外部路径、`..` 越界和不安全标识符返回 `semantic_error/task_resource_boundary_violation`。任意 shell 无法靠字符串解析形成可靠隔离，因此 broad `shell.command` 被拒绝；新 `workspace_file_action` 只允许当前 testbed 内最多 200 项的非 symlink 列举和 256 KiB UTF-8 文本读取。导入的旧 JIT prompt 中 shell 示例、shell 建议和绝对 workspace/testbed 路径也被移除。Summary 新增 `task_resource_boundary` 审计投影，区分合法 workspace/contract 读取、shell 尝试和被拒绝的外部资源请求。

迭代 run 暴露并修复了三类遗漏：完整 contract 注入仍留下任务语言歧义导致 `length`；未披露标识符大小写导致 `calendar/alice.ics`；未说明行级 time 映射使模型在 Alice 的 9–11 与全日 9–16 之间反复推理。最终 `runs/level3-3-6-0-resource-boundary-6` 使用 JIT conda 环境通过：Pi succeeded、JIT score 1.0、`calendar/Alice.ics` 与 12 个 `training.eml` 实际生成，0 shell calls、0 boundary violations。相对旧成功 run 的 78 observations / 49 turns，新 run 为 27 / 9。Agent 没有 research goal 或 harness change；这仍是合理 no-change 路径，资源边界优化本身不伪造 Auto-Research 闭环。

### 3.8 Task-local catalog 与 templated email batch 闭环

Runner 现在基于原始 question 和新建 testbed，在 Pi 启动前写 `task-resource-catalog.json`。Catalog 只含有界相对路径 inventory、相关 app、相关 action contract、通用任务语言规则，以及完整 `artifact-contract.json` 的 canonical 引用；不再把 runner 的通用工具说明误判为任务需求。`task_artifact_contract` 已退出初始 active surface。Catalog inventory 足够且只有二进制 Office 输入时，`workspace_file_action` 也不进入初始 surface，避免重复列举。

新增初始 inactive 的 `email_batch_action`，输入为共享 sender/subject/content template 与 2–16 个 recipient variable maps。真实执行仍逐项调用 JIT `email.send_email`，但只启动一个 Python bridge process，并保留非原子逐项结果。Excel 结构化读取或首次 direct email observation 最多披露一次决策支持，包含精确 input shape、direct/batch bridge 成本和 break-even；agent 可选择不研究、keep，或用 `research_resource.continue_with` 自主 apply。`email_batch_utilization` 的 effect window 只计 email 相关调用，因而 horizon 1 即可在 batch 后返回评估。

最终 JIT-conda run `runs/level3-3-6-0-resource-efficient-email-batch-4` 通过 Level 3 `3-6-0`：score 1.0，全部 evaluator target 发生变化，0 contract reads、0 workspace reads、0 semantic errors。Agent 引用真实 `excel.read_file` observation 创建 `research-goal-1/finding-1`，判断 12 次发送超过 break-even，自主选择 `general → email_batch`；下一模型请求观察到 `pi.setActiveTools()` 后的新工具，1 个 batch process 完成 12/12 邮件，独立复算得到 `tool_call_compression=12`、verdict `supported`。Summary 报告 `closed_loop_evidence.status=established`、5 turns、7 observations、6 bridge processes。该结果建立了一个任务内的真实闭环和具体行为效果，`harness_improvement` 仍保持 `not_established`，不外推为一般策略改善。

### 3.9 持续 research lifecycle：效果必须回写研究资源

此前的 established 只证明 `finding → decision → Pi exposure → bounded effect`，尚未证明 agent 会把效果重新吸收到研究资源。现在 `research-resources.jsonl` 使用稳定 `goal_id/finding_id` 与唯一 `research_event_id` 保存 append-only versioned snapshot，支持 `open/record/update/resolve/reopen`。Harness decision 保存不可变 `basis_snapshots`，固定当时使用的 finding version、event 和 evidence refs；后续 finding 更新不能追溯改写决策依据。系统 effect assessment 在被 agent 通过 `assessment_refs` 引用前持续以最多 5 条 compact pending feedback 披露；resolved goal 不再重复进入 active digest。

真实 JIT-conda run `runs/level3-3-6-0-sustained-research-lifecycle-2` 通过 Level 3 `3-6-0`，JIT score 1.0。链路为：agent `open` “12 封相似个性化邮件是否值得 batch” → 用 Excel roster observation 在 v2 `update`，通过 `continue_with` 应用 `general → email_batch` → `decision-1` 调用 `pi.setActiveTools()` → 后续模型请求观察到新 surface → 一个 batch bridge 完成 12/12 → `effect-assessment-1` 得到 `supported` 与 `tool_call_compression=12` → agent 在 v3 `resolve` 中引用并吸收 assessment。Summary 因而报告 `research_lifecycle.status=closed`、chain `research_resolved` 与 `closed_loop_evidence.status=research_lifecycle_closed`；`harness_improvement` 仍为 `not_established`。

对照 run `runs/level3-3-6-0-sustained-research-lifecycle-4` 同样 score 1.0，但 agent 选择 18 个 direct bridge process，未创建 research 或 mutation；summary 正确报告 `research_lifecycle=not_attempted` 和 `candidate_seen_no_finding`。这同时证明 no-change 合法，也暴露了剩余 gap：同一高收益 case 上自主选择不稳定，不能依靠单次轨迹判断机制质量。另一个 run `runs/level3-3-6-0-sustained-research-lifecycle-3` 在第二轮达到模型输出长度上限且没有 tool call；方法提示已收紧为已有证据时优先一次 `record + continue_with`，避免为形式先 open 或重复讨论 contract。

当前 summary 明确区分：`behavioral_loop_established` 只表示行为 effect 已观察；`effect_pending_absorption` 表示反馈尚未进入下一版研究；只有 agent 引用 assessment 并关闭相关 goal 才是 `research_lifecycle_closed`。完整历史只在 JSONL 保存，summary 仅投影最新状态、version history 引用和闭环关联，避免重复落盘。

长程任务风险与下一阶段机制边界见 [Auto-Research meta 架构的长程失败模式分析](../plans/2026-09-08-long-horizon-auto-research-meta-analysis.md)。

### 3.11 Control / treatment 配对实验与消融记录

为判断归因机制是否帮助任务完成，runner 增加了仅用于评估的
`officebench-experiment`。每个 repeat 在同一 case 上启动两个独立 Pi
进程和两个新 OfficeBench workspace，并交替 control/treatment 执行顺序。
Control 保留相同的直接任务工具与 evaluator，但不向 Agent 暴露
Auto-Research 方法、research/decision 工具、`EXECUTION_OBSERVATION`/
`decision_support` 或可选 batch surface。Treatment 使用当前完整的
task-local 机制。runner 只记录差异，不参与 Agent 研究或 mutation 决策。

这同时是当前最小消融：移除归因资源和 Pi-native execution-surface 入口，
其它任务输入、模型、评测和 workspace 初始状态保持一致。配对 summary
分别记录任务通过、evaluator score、length 失败、artifact 路径变化、模型
轮次、bridge process、research connection 和 observed execution effect；
finding 数量不是奖励，单个 pair 不自动产生因果结论。

真实 JIT 结果：

| Case | Control | Treatment | 观察到的差异 |
|---|---|---|---|
| `3-6-0` smoke 2（单次） | length，score 0 | 通过，score 1；`apply_effect_observed` | 曾观察到 treatment 完成优势，但单次结果不能代表一般性收益 |
| `3-6-0` smoke 1（单次） | 通过，score 1 | 通过，score 1；`apply_effect_observed` | 任务结果持平；treatment bridge processes 7，control 18 |
| `3-6-0` 正式 4 repeats | 通过 4/4 | 通过 3/4；3 次 `apply_effect_observed` | control 胜 1、treatment 胜 0、平局 3；treatment 通过运行的 bridge 成本较低，但第 3 次出现 length failure |
| `3-45-0` | 通过，score 1 | 通过，score 1；`candidate_seen_no_finding` | 两臂均直接完成；没有 harness effect |
| `3-52-0` | 失败，score 0 | 失败，score 0 | 两臂均未完成；treatment bridge processes 较少但没有任务收益 |

正式重跑目录：

- [`paired-3-6-0-smoke-2`](../../runs/paired-3-6-0-smoke-2/summary.json)：control 失败、treatment 通过；是目前唯一的正向任务完成 pair。
- [`paired-3-6-0-smoke-1`](../../runs/paired-3-6-0-smoke-1/summary.json)：两臂通过，treatment 仅表现出成本改善。
- [`paired-3-45-0-smoke-1`](../../runs/paired-3-45-0-smoke-1/summary.json)：两臂通过且不触发 mutation，说明 no-change 合法。
- [`paired-3-52-0-smoke-1`](../../runs/paired-3-52-0-smoke-1/summary.json)：两臂失败，说明 batch 能力不能解决该任务的长推理瓶颈。

因此当前证据支持“归因机制和 Pi batch surface 能在真实任务内被触发，
并可能降低执行成本”，也出现了一次 treatment 任务完成优势；尚不足以
支持一般化的任务成功因果结论。需要至少 4 个 repeat、多个任务家族和
隐藏的 held-out case 才能决定是否打 tag。Control 隔离还增加了离线 Pi
集成测试，确保 control 的持久化 observation 不含不可见的
`decision_support`，避免消融标签污染。

Shopping benchmark 的 `auto_research` seed harness 冒烟已启动，但在两个
样本上长时间没有写入 score，随后停止。该运行不属于当前 Pi task-local
机制的有效 treatment/control 证据；Shopping 使用 JIT 自己的 seed harness
和 `execute_code` 工具面，不能直接替代 OfficeBench 的 Pi-native 扩展验证。
后续若要纳入 Shopping，应先实现同一任务输入上的 Pi treatment/control
适配，再记录配对结果，不能把不同 harness 的 seed 对比当作本机制消融。

`3-6-0` 四次正式配对重跑（JIT，`paired-3-6-0-r4-1`）没有重复得到
treatment 的任务完成优势：control 通过 4/4（平均 score 1.00），treatment
通过 3/4（平均 score 0.75），完成胜负为 control 1、treatment 0、平局 3。
treatment 有 3 次 `apply_effect_observed`，且 bridge process 在通过的三次均
下降（分别为 -6、-11、-11）；但第 3 次 treatment 在 2 turns 后出现 length
失败，未创建 finding。该结果说明资源暴露和 batch surface 的行为链路真实可见，
也说明额外研究提示本身可能增加上下文/决策负担，不能把“闭环被记录”当成任务
收益。当前结论收缩为：机制可触发、可降低执行成本，但任务正确性效果不稳定，
尚未建立因果改善；后续应优先减少每轮注入文本和重复决策，而不是增加新的控制
层或强制 finding。

### 3.10 最小持续性修正：actionable connection 与 exposure gate

没有引入 `causal_span_id`、intervention ledger、多窗口 manager、capability registry 或新的 summary 层。现有 `decision_id` 已能连接 finding version、Pi exposure、effect assessment 和 research absorption；增加第二套关联抽象不能促使 agent 继续闭环，反而会增加协议与维护成本。

为降低高收益候选停在 `candidate_seen_no_finding` 的概率，现有一次性 `decision_support` 卡片新增 `one_step_if_worthwhile`：当 agent 判断 observation 已足够且 remaining work 达到明确 break-even（calendar 3、email 4）时，可用一次 `research_resource action=record + continue_with` 同时留下 finding 和 apply/keep decision；否则明确允许直接继续，不研究、不修改。系统提示同步使用卡片披露的 break-even，删除原先“至少两次”与成本模型不一致的表述。该改动只缩短 observation→finding 的推理距离，不自动创建 finding。

Effect collection 新增 exposure gate。`pi.setActiveTools()` 只影响下一模型请求，因此同一 assistant response 中与 decision 并列发出的旧 surface action 不再消耗 observation horizon；只有现有 context hook 已记录 `observedSurfaceCalls` 后的相关 task action 才进入 window。这避免 window 在真实调整尚未对模型可见时提前生成 `inconclusive`，直接保护后续 effect→research absorption 链路。离线真实 Pi provider 测试覆盖一个 response 内先 apply 再 action、下一 request 再 action的边界。

### 3.11 宪法合规审计与收缩边界

当前实现仍把 Pi 作为唯一 runtime：`pi.setActiveTools()` 和 context hook 是
唯一执行条件入口，runner 不替 Agent 调用 research、选择 apply/keep 或解释
效果。Auto-Research 只是一段可选方法提示；`research_resource` 的 open、record、
update、resolve、reopen 均由 task agent 发起，no-research/no-mutation 仍是合法
结果。`decision_support`、重复观察提示和 effect assessment 只把已发生的观察
投影为可引用资源，不创建 finding、不调度下一步，也不自动 mutation。

因此本轮不增加 `causal_span_id`、intervention ledger、scheduler、candidate
controller、rollback manager、跨任务 memory 或通用 mutation API。配对 runner、
summary 和 evaluator 只承担隔离、写盘、聚合与审计，不进入 Pi 控制面。若后续
为降低 treatment 的上下文负担而优化效率，优先压缩重复的资源投影（保留当前
finding、待吸收 assessment 和最近观察），不能改成由 runner 代替 Agent 关闭
研究或强制执行 harness。

### 3.12 P0 收缩实现：learning signal

为覆盖“从失败（也包括成功）信号中学习”，但不引入新的控制面，finding 现在
可以由 Agent 自愿附带一个 `learning_signal`。它把操作结果、认识结果和后续
决策分开记录，并带有粗粒度阶段、机制和证据可信度：

```json
{
  "phase": "retrieval",
  "mechanism": "missing_capability",
  "operational_outcome": "success",
  "epistemic_outcome": "narrowed",
  "decision_outcome": "switch",
  "confidence": "single_observation",
  "explanation": "..."
}
```

该字段只接受 Agent 在 `research_resource` 的 record/update/resolve 中提交的值；
runner 仅校验形状、保留 append-only 版本并在后续 context/summary 中投影。它
不会自动从失败分类、生成 candidate、批准 mutation 或改变工具面。若信号没有
改变后续决策，Agent 可以不创建 finding，保持 no-research/no-mutation。

离线 Pi 场景已验证信号写入当前 task-local finding，并随版本资源投影到后续
上下文；control 变体没有该工具或字段。它仍不是任务成功奖励，也不证明跨任务
泛化；真实 OfficeBench 的 4-repeat 结果仍显示任务收益不稳定。

提示收敛后的真实 JIT 冒烟：

- `3-6-0`：任务通过，`apply_effect_observed`、`supported`、lifecycle `closed`，
  但 Agent 未填写 `learning_signal`；说明提示仍不会强制记录经验。
- `3-45-0`：任务通过并完成 calendar batch，Agent 未填写信号；该低收益/直接
  可完成场景保留了 no-change/不记录路径的合法性。
- `2-13-0`：任务通过，`apply_effect_observed`、`supported`、lifecycle `closed`，
  finding 版本 1/2 均带有 `learning_signal`：`retrieval → missing_capability →
  success → narrowed → switch`，可信度为 `single_observation`；版本 2 吸收了
  `effect-assessment-1` 后完成解析。该运行证明信号可以进入真实的
  research→Pi-native surface→effect→research update 链，但仍是单任务单次证据，
  不能宣称一般性任务成功改善。

同一 `2-13-0` 的 2-repeat 配对消融（`paired-2-13-0-learning-signal-r2`）中，
control 与 treatment 均通过 2/2、平均 score 均为 1.0，完成胜负为 0-0-2 平局。
treatment 两次都观察到 Pi-native surface effect，分别记录 2/0 个
`learning_signal`；control 始终没有研究资源。treatment 的 bridge 成本一高一低
（5 vs 19、14 vs 26），方向不稳定。该结果支持“机制可触发且不损害该 case 的
完成率”，但不支持任务收益或稳定效率收益的因果结论。

这也暴露一个重要边界：`learning_signal` 的“可选”设计避免了把任务变成日志
流水线，但真实 Agent 是否填写仍取决于它是否认为经验会改变下一步。`3-6-0`、
`3-45-0` 均完成了研究和 mutation，却未填写信号；`2-13-0` 才在同一条
record/update 链中填写。后续评估应把“信号出现率”作为可观察行为指标，不能
把缺失信号自动判为失败，更不能用提示把它强制化。

`2-13-0` 四次配对重跑（`paired-2-13-0-learning-signal-r4`）进一步显示：
control 通过 4/4，treatment 也通过 4/4，完成胜负为 0-0-4 平局；treatment
三次触发并观察到 surface effect，其中两次出现 `learning_signal`。bridge
process 差异为 -20、+8、-3、-21，方向仍不稳定。一次 treatment 停在
`candidate_seen_no_finding` 但任务仍通过，说明 finding/signal 不是完成任务的
必要条件。该重复实验支持机制的可选性和可观察性，不支持稳定性能提升或因果
改善；当前不满足打 tag 条件。

为便于单独消融该注释，扩展新增环境开关
`PI_OFFICEBENCH_LEARNING_SIGNAL=disabled`。它不移除 research resource、
decision-support 或 Pi-native surface，只停止 signal 的披露/接收；因此不会
改变 Agent 的执行能力，也没有新增 runner 控制面。该开关已有文档说明，尚待
在真实 case 上进行成对运行。

已完成一次 annotation-only 消融：`2-13-0` treatment 设置
`PI_OFFICEBENCH_LEARNING_SIGNAL=disabled`（目录
`ablation-2-13-0-learning-signal-disabled`）。任务仍通过、score 1.0，但该次
Agent 未创建 finding，也没有 surface mutation/effect（`candidate_seen_no_finding`、
4 turns、16 bridge processes）。完整 treatment 的同类 smoke 会创建 finding、
应用 calendar batch 并完成 lifecycle。这个结果说明 signal 提示可能影响 Agent
是否进入研究分支，但没有证明它改善任务或成本；同时说明“关闭 annotation”会
改变模型上下文，不能把它解释成纯粹存储层消融。后续若要隔离存储影响，需要
保持同样的可见提示、仅禁止持久化字段，而不是删掉提示文本。

未参与前述配对的 Level-2 held-out case `2-14-0`（
`learning-signal-smoke-2-14-0`）出现 length failure（2 turns、2 bridge
processes），`candidate_seen_no_finding`、无 mutation、无 learning signal，
evaluator score 为 0。该结果提醒我们：增加可选资源不会自动修复长程收敛问题，
也不能把“候选已看见”解释为研究闭环；需要后续用不同任务族和更稳定的模型预算
评估，当前不宣称泛化收益。

### 3.13 分层 OfficeBench cohort runner 与第二轮结果

新增 `officebench-cohort` 仅用于把多个现有 paired experiment 放入独立目录并聚合；
它不进入 Pi 控制面，也不改变 Agent 的研究/mutation 选择。命令示例：

```powershell
$env:PYTHONPATH = "$PWD\src"
D:\anaconda\envs\jit\python.exe -m autoresearch_pi.cli officebench-cohort `
  --cases "2-13-0,3-45-0,3-52-0" --repeats 2 `
  --root "D:\autoresearch_pi_project\runs\officebench-cohort-stratified-r2"
```

验证集按实际任务结构而不是固定标签解释：`2-13-0` 有重复日历写入，`3-45-0` 的
剩余工作量可能仍足以让 Agent 选择 batch，`3-52-0` 是跨工具长程失败压力。真实
`officebench-cohort-stratified-r2` 共 6 对运行：control 通过 4/6，treatment 通过
4/6；两组平均 task score 均为 0.667，完成胜负 0-0-6 平局。treatment 观察到 2 次
完整 execution-condition effect，control 为 0；其中 `2-13-0`、`3-45-0` 各一次，
第二次 repeat 均选择不创建 finding。`3-52-0` 两臂均失败，treatment 的
`candidate_seen_no_finding` 没有改善跨工具长程收敛。

这轮结果支持三点：

1. 机制在真实任务中仍可选、可重复触发，且 no-research/no-mutation 路径保持合法；
2. 任务正确性没有优于 control，闭环触发率和调用成本也受模型轨迹影响；
3. 不能把“有 2 次 supported effect”升级为 harness improvement，也不能把 case 名称
   当作收益标签。下一步需在隐藏任务族和更多 repeat 上做 correctness-gated 效率分析，
   并优先降低长任务的检索循环，而不是增加新的控制层。

### 3.14 跨工具反转配对：不要把单次失败归因给 harness

新增 cohort 后单独运行了 `2-15-0`（calendar → Excel 的跨工具反转任务）：

```text
runs/officebench-paired-reversal-2-15-0-r1
```

control 在 49 turns / 147 bridge processes 后通过；treatment 在 8 turns 后以
`length` 失败，score 0。treatment 的前置 calendar observation 确实出现了
`decision_support`，但 agent 没有创建 finding 或 mutation，随后反复尝试未支持的
`excel.*` action 名称（31 个 semantic errors）。

这个结果不能证明 attribution 机制导致失败：两臂模型轨迹本身高度不同，且 treatment
没有进入研究或 Pi surface 改变。它反而暴露了一个需要单独验证的任务资源/工具契约
问题：`excel.read_file` 等 exact action 已在 catalog 中，但模型仍可能退回 broad
`officebench_action` 并猜测 action 名称。按照宪法，本轮不自动替 agent 修正，也不把
失败转换成 finding；下一步应先用相同 task 输入做工具契约可见性 smoke，再决定是否有
必要增加一个 Pi-native、任务相关的直接 Excel tool surface。

### 3.15 Excel direct contract 修复复验

为验证上述基础契约问题而新增的 `excel_action` 是 control/treatment 对称可见的
Pi 原生任务工具，不属于 self-harness mutation。它只允许明确的
`read_file`、`set_cell`、`delete_cell`、`create_new_file`，拒绝猜测其它 action。
离线 native 回归通过后，重新运行 `2-15-0` 配对：

```text
runs/officebench-paired-reversal-2-15-0-r2
```

结果：control 与 treatment 均通过、score 1.0、所有目标文件均变化；两臂均为 0
semantic errors。control 用 5 turns / 25 bridge processes，treatment 用 25 turns /
25 bridge processes；treatment 没有 finding 或 mutation，仅报告
`candidate_seen_no_finding`。相比 r1 treatment 的 31 次未知 Excel action 与 length
failure，direct contract 消除了工具猜测错误，但增加的 treatment 资源披露没有带来
研究闭环或效率优势。这说明“工具契约可见性修复”和“Auto-Research + self-harness
收益”必须分开评估，不能将前者误记为后者。

### 3.16 Excel 修复后的分层 cohort 复验

在 `excel_action` 对称加入 control/treatment 后，重新运行了三类验证 case 的
`officebench-cohort`（目录 `runs/officebench-cohort-stratified-r3`，每 case 一对）。
结果仍为 control 2/3、treatment 2/3 通过，平均 score 均为 0.667，三对完成结果
全部平局。`2-13-0` treatment 触发一次完整 finding→Pi exposure→batch effect；
`3-45-0` 也有一次完整 effect；`3-52-0` 两臂都失败，treatment 仅达到
`candidate_seen_no_finding`。treatment 共观察 2 次 supported effect，control 为 0，
但没有任务正确性优势；聚合的平均 treatment-minus-control bridge process delta
为 -8.67，model-turn delta 为 +0.33，方向不能视为稳定收益。

该结果同时确认：修复 direct Excel contract 后，跨工具任务的 semantic error 可以
归零，但 treatment 的额外资源披露仍可能增加模型轮次；工具契约修复、研究闭环和
harness improvement 必须继续分层报告。当前不满足打 tag 条件。
### 3.17 最小 task-local 资源恢复与只读检查

长任务的另一个实际缺口是：`research-resources.jsonl`、`harness-decisions.jsonl`、
`harness-observations.jsonl` 和 `effect-assessments.jsonl` 虽然持续写盘，但 Pi
extension 进程重启后只剩新的内存 Map，agent 无法主动读取已经落盘的当前任务经验。
这会把“事实已持久化”误认为“agent 能继续使用事实”。

本轮只增加一个轻量的 Pi 原生资源入口：

```text
research_resource(action="inspect", finding_id?)
```

它在 extension 启动时从当前 `PI_*_E2E_ROOT` 重建最新 finding、执行 observation、
effect assessment 和计数器；调用时返回有界的只读快照，包含当前 task-local finding
的最新版本、最近的 harness decision 与 Pi exposure observation、尚未被 finding
吸收的 effect assessment，以及 `read_only=true`、`scope=current task only`。

恢复逻辑只读取当前任务目录的 append-only JSONL，不扫描 sibling run、项目源代码或
benchmark 数据，也不把旧的 `pi.setActiveTools` 状态静默恢复为当前执行面。重启后
仍从安全的 `general` surface 开始，由 agent 读取 inspect 结果并自主决定是否再次
使用已有 finding-backed Pi-native 能力。这样避免把 runner 变成状态恢复/rollback
控制器，同时保留“先前观察可被后续研究引用”的能力。

离线 Pi 原生回归新增三条可观察保证：OfficeBench 预写入 version 2 finding 和已
支持 effect 后，重启 extension 的 `inspect` 返回最新版本及 resolved effect 且不生成
decision；Shopping 同样返回 finding、decision、exposure 和 effect，`read_only` 为
true，且不会自动打开 `shopping_batch`；另一个两进程 fixture 由第一个 Pi 进程写入
finding，第二个进程先 inspect 再基于 `finding-1` 自主 apply `calendar_focused`，
下一请求写入 exposure。三条测试均通过；全量回归为 **101 passed**。

随后在 JIT 环境真实复跑 `2-13-0`（目录
`runs/officebench-2-13-0-rehydration-smoke-1`）：任务通过、JIT score 1.0、6 个
所需日历文件均变化，agent 自主创建 finding、apply `calendar_batch`，下一模型请求
观察到新 surface，12/12 写入成功并由 effect assessment 标记 `supported`。该真实
运行没有调用 `inspect`（没有发生重启），因此它验证恢复功能未破坏原闭环；离线测试
验证重启后的资源可读性。

这项改动不是跨任务 memory，也不是新的 attribution/candidate 层：它不创建 goal、
不生成 finding、不调度下一步、不批准 mutation、不自动恢复 harness。它只把已经写盘
的 task-local 事实重新提供给同一个 agent，并把查询成本限制为一次有界读取。Shopping
长检索任务仍可能超时，`harness_improvement` 仍保持 `not_established`，不能把资源
恢复能力表述为性能提升或解决 credit assignment。

为避免恢复资源本身成为长任务上下文负担，`inspect` 返回的是摘要投影：finding 的
question/scope/uncertainty/evidence/decision 每项最多 240 个字符，保留版本、状态、
evidence/assessment 引用；decision、exposure 和 effect 只保留后续判断所需字段。完整
正文仍只在 canonical JSONL 中落盘。这样资源可读性和落盘审计保持完整，但 agent 不会
因一次恢复查询重新注入整段历史。
### 3.18 资源恢复改动后的 JIT 配对复验

为检查恢复提示是否改变正常的 control/treatment 语义，使用 JIT conda 对
`2-13-0`（重复日历写入）和 `2-15-0`（跨工具 Excel/日历）各运行一对：

```text
runs/officebench-cohort-rehydration-r1
```

两类 case 的 control、treatment 均通过，平均 score 均为 1.0，完成结果都是平局。
本轮两个 treatment 都没有发生 finding/decision/effect，因为任务在首次执行中没有
发生重启，也没有产生可恢复资源；因此 `inspect` 不会被自动调用。平均
treatment-minus-control 的 model-turn delta 为 -0.5，bridge-process delta 为 +3.0，
单次 cohort 的成本方向不能解释为稳定收益。该结果只说明新增恢复提示没有损害这两类
短任务的正确性；它没有证明恢复机制本身改善了 harness，也不能替代真实的“进程 A
写入 → 进程 B inspect → agent 继续决策”测试。

### 3.19 continuation 观测字段修正与宪法复核

continuation runner 的首个真实复验中，stage 2 的 `pi-events.jsonl` 明确记录了
`research_resource(action="inspect")`，但旧统计读取了不存在的顶层 `arguments` 字段，
导致 `summary.json` 错报 `inspect_calls=0`。统计现在读取 Pi 执行事件的官方 `args`，
并兼容消息事件中的 `toolCall.arguments`；因此该字段只反映真实发生的 agent 工具调用，
不会改变运行时行为。共享 JSONL 的 finding/decision/exposure/effect 数量明确命名为
`*_cumulative`，避免把任务累计资源误读为某阶段新增量。

同时收缩 continuation 的 stage 1 提示为原始任务本身。进程切分仍由 runner 作为外部
实验条件提供，但 runner 不再要求“准备阶段”、不引导 agent 留下未完成产物，也不规定
研究顺序或停止点。stage 2 只获得同任务恢复事实和“可选择 inspect”的能力；研究、
finding、apply/keep、继续执行和结束仍完全由 Pi agent 决定。该调整保持 no-research、
no-mutation、keep、inconclusive 合法，并避免把 continuation evaluator 演变成第二层
harness 或 research scheduler。

### 3.20 对“Failure Interpretation + Task-local Challenger”方案的边界审计

外部方案中值得保留的目标是：从成功或失败观察中提炼认识价值，并让后续 Pi
决策能够引用这条经验；不应保留其控制面。具体裁决如下：

| 提议元素 | 裁决 | 原因/替代 |
|---|---|---|
| 细粒度 phase/mechanism/outcome/confidence | 保留为可选 `learning_signal` 字段 | 它是 agent 对已有观察的紧凑解释，不调度、不打分、不触发 mutation |
| `research-attempts` 生命周期（planned/trialing/absorbed） | 不新增 | 会把可选研究变成 runner 可追踪的固定流程；现有 versioned finding 的 question/evidence/decision/status 已足够 |
| `harness-candidates` registry 与 candidate 状态机 | 不新增 | Pi 原生能力的可用范围已在 capability catalog 和 observation card 中披露；候选生成、批准和过期不能由外围控制器接管 |
| `causal_span_id` / intervention ledger / 因果切片 | 不新增 | `decision_id` 已连接 finding snapshot、Pi exposure 和 effect assessment；第二套关联 ID 只增加日志协议，不能让 agent 更可能继续研究 |
| checkpoint fork、回放、rollback manager | 不进入 runtime | 对照/回放属于 runner 的离线评估，不得成为任务内第二层 harness 或自动恢复机制 |
| candidate 保护不变量、修改预算、冷却、自动拒绝 | 仅保留 Pi 原生契约校验 | 工具参数、证据引用、作用域和 next-request 生效时机由原生工具/extension 校验；不增加 supervisor 策略 |
| 跨任务 Lesson Promotion | 暂缓 | task-local JSONL 在任务结束即失效，避免 shortcut learning 和灾难性遗忘；晋升需要独立 cohort 与用户明确的新阶段设计 |

因此当前最小闭环仍是：Pi agent 看到原始 execution observation →（可选）写入带
`learning_signal` 的 finding → agent 自主 `continue_with` apply/keep 或不改变 →
Pi 原生 surface 在下一模型请求生效 → hook/runner 记录后续 effect → agent 自主
update/resolve finding。失败但不改变后续决策时不必创建 finding；成功同样可以记录，
但不能被当作任务 reward。runner 只做事件写盘、边界隔离、评估和摘要投影。

这条收缩规则覆盖“从失败/成功学习”，同时避免把经验提升、归纳归类包装成新的
流水线：学习内容仍是 agent 自主写入的 task-local finding，解释字段是可选元数据，
不存在外围的 attempt scheduler、candidate controller、trial manager 或 promotion
逻辑。

### 3.21 Shopping 观察投影的第一轮性能切片

真实 JIT Shopping 配对暴露了一个具体的非控制面瓶颈：`get_product_details` 的完整
商品数组同时出现在工具结果和 `EXECUTION_OBSERVATION` 中，且每次候选详情调用都会
重复投影同一 `decision_support` 卡片。Level-2 case `2` 的 treatment 在旧实现中
产生约 55k Pi 事件后超时（score 0.2，未进入 research/harness）；control score
为 0.6。该结果不能归因于机制本身，因为 treatment 上下文已经被重复观测文本污染。

本轮只做一个模块化的 Pi extension 内投影修正：

1. 完整工具结果仍由 Pi trace 保存；注入模型的 `EXECUTION_OBSERVATION` 不再重复
   `result_summary` 与 `args_summary`，只保留事件 ID、结果类别、工作量和可选的
   decision-support 摘要。
2. 商品详情 observation 在模型可见的 execution resource 中只保留有限字段和最多
   16 个商品；完整候选数据仍由工具返回，任务资源目录和 evaluator 不变。
3. `shopping_batch` candidate card 每个 task 最多展示一次；这不是自动决策或冷却，
   只是避免同一观察资源在每轮重复注入。Agent 仍可忽略、记录 finding、keep 或 apply。

离线 Pi 原生测试新增 projection/card 断言，Shopping native tests 为 3 passed；当时完整
回归为 107 passed。加入 correctness-gated effect projection 后，当前完整回归为
108 passed。JIT Level‑3 case `2` treatment 复跑目录为
`runs/shopping-level3-case2-projection-1`：

- 真实 finding 4 个版本、1 次 `research_resource.continue_with(apply)`；
- 下一模型请求观察到 `shopping_batch`，1 个 batch call 完成 3/3 work units；
- effect assessment=`supported`，research connection=`apply_effect_observed`；
- cart 中 4 个目标商品均已写入；但 evaluator 仍为 score 0.1667，原因是该 case
  还要求 2 个 coupon，Agent 未完成 coupon 条件，且存在额外商品；因此不能声称任务
  正确性改善。

这次结果证明该轻量投影修正使真实 Agent 有机会完成
“finding → Pi-native batch surface → observed effect → finding update”闭环，且
batch 的 3 个后续工作单元在一个 Pi tool call 中完成；它没有证明 Shopping 的最终
正确率或一般 harness improvement。后续消融必须同时报告 context/event 成本、购物
匹配率、coupon 完成率和闭环 mediator，不能只看 `supported`。

同一 Level‑3 case `2` 的一对新消融（目录
`runs/shopping-projection-ablation-3-2-r1`）中，control/treatment 均未通过，
score 均为 0.1667，完成结果平局；本次 treatment 未触发 finding 或 batch，说明
投影修正不是强制闭环，Agent 仍可选择直接执行。与前一轮同 case 的 treatment
触发闭环但漏掉 coupon 的结果相比，触发率具有明显轨迹方差；因此该切片支持“减少
重复上下文、不破坏 no-change 自主权”，但不支持“投影必然提高闭环触发率或任务分数”。
后续需要多 repeat、固定模型/数据和更细 evaluator 分项，才能判断它是否改善长任务
的有效执行成本。

最后，once-per-task card 标志现在也从已有 `execution-observations.jsonl` 恢复，
因此支持的 extension 重启不会再次注入同一候选卡。恢复的仍只是已落盘的观察事实；
Pi active tools、finding decision 和 mutation 不会被静默恢复。

### 3.22 OfficeBench 多 repeat 对照：复杂跨工具任务

使用 JIT case `3-6-0` 做 2-repeat counterbalanced paired experiment：
`runs/officebench-ablation-3-6-0-r4`。control 与 treatment 均为同一模型、独立
Pi 进程和独立 workspace。

| 指标 | control | treatment |
|---|---:|---:|
| pass rate | 2/2 | 2/2 |
| average evaluator score | 1.0 | 1.0 |
| observed finding/effect connections | 0 | 2 |
| learning signals | 0 | 2 |
| 平均 model turns | 8.0 | 8.0 |
| 平均 bridge processes | 20.0 | 9.5 |

两次 treatment 都真实完成了 finding → Pi-native surface → supported effect →
finding update；control 没有研究资源或 surface effect。任务正确性双方平局，
因此结果支持“在复杂跨工具任务上闭环可重复触发，并且后端 bridge 调用量有下降
信号”，但不能把它解释为纯粹的 harness 因果收益：model turns 不下降，样本仅
2 对，且 treatment 使用了更高层的批量原生能力。summary 继续标记
`harness_improvement=not_established` 和 `causal_claim=not_automatically_established`。

### 3.23 Correctness-gated effect projection

Shopping 的真实 run 显示：batch 行为可以被系统判定为 `supported`，但任务仍可能
漏掉 coupon 或加入额外商品。为避免把这种行为成功误当作 harness 改善，OfficeBench
和 Shopping summary 现在都保留两个独立字段：

- `status`：声明的 Pi-native 行为是否实际发生；
- `correctness_gated_status`：该行为发生且 Agent 成功、evaluator 通过、必要目标
  满足时才为 `supported`，否则为 `observed_but_correctness_failed`。

配对实验的 `effect_supported` 改用 correctness-gated 字段；原始 supported 计数仍
保留，便于区分“机制触发”与“正确任务上的有效触发”。这只是 runner 的评估投影，
不向 Agent 注入 reward，也不影响 Pi 的工具或 context hook。相关离线测试验证了
Shopping 行为 supported 但 case_score=0 时 gated status 为
`observed_but_correctness_failed`。

为使这类效率比较可复核，Shopping extension 现在额外写入
`model-visible-observation-metrics.json`，记录模型实际收到的 observation 字符数和
decision-support 卡片数；该文件只做观测，不参与任何 Agent 决策。summary 通过
`model_visible_observation` 引用它，完整结果仍以 `pi-events.jsonl` 和
`execution-observations.jsonl` 为准。这样后续 treatment/control 消融可以区分：
上下文投影是否减少了模型输入、Agent 是否进入闭环、以及任务匹配率是否真的改善。

带新指标的第二次 JIT Level‑3 `2` treatment（`runs/shopping-level3-case2-projection-2`）
记录了 9,434 个 Pi 事件、28,354 个模型可见 observation 字符和 1 张 candidate 卡，
但 Agent 选择 no-research/no-mutation，score 仍为 0.1667。与前一次同 case 触发
batch 的轨迹并列看，投影确实控制了重复 card（一次），但没有消除 Agent 探索策略和
最终 coupon 遗漏的方差；因此当前机制的正面作用只能表述为“降低重复资源注入并使
闭环可触发”，不能表述为“提高任务完成率”。

正确性门控已同步接入两套 paired summary：原始 `supported` 继续表示行为发生，
`correctness_gated_status` 只有在任务正确时才为 `supported`，paired delta 的
`effect_supported` 使用门控值。这样“batch 成功但 coupon 漏项”的 run 不会被当作
正向 harness 证据；该字段同样只属于 evaluator projection，不会向 Agent 注入
奖励或控制信号。

### 3.24 Shopping observation projection 的隔离消融与负结果

为避免把完整 treatment/control 差异错误归因给 observation projection，新增
`shopping-projection-experiment`。两个 arm 都是 treatment，拥有完全相同的
Auto-Research 资源、finding 工具和 Pi-native `shopping_batch` 能力；唯一实验变量是
Pi extension 注入下一模型请求的 observation 是否去重/压缩。runner 只建立独立
workspace、交替运行顺序并聚合已经发生的事件，不创建 finding、不要求 apply，也不把
projection 当作 reward 或 mutation。

第一组 2-repeat Level-3 case `2` 位于
`runs/shopping-projection-isolated-3-2-r1`。projection-on 相对 off 的平均模型可见
observation 字符从 52,458.5 降至 25,448（约 -51.5%），平均 trace events 从
11,393.5 降至 6,376.5；但两臂均未通过，on/off 平均 score 分别为 0.25/0.1667，
且都没有稳定创建 finding 或形成 correctness-gated effect。该结果支持“减少重复资源
披露”，不支持“提高闭环触发率或任务正确性”。

随后发现 once-per-task capability card 原本会在第一次 `get_product_details` 后展示，
此时 Agent 通常还没有形成足够的重复工作证据。投影开启时现改为在第一次成功
`add_product_to_cart` 后展示一次；投影关闭的对照仍保留旧的重复展示。这个变化只调整
Pi context hook 的生效时机，不保存候选状态、不调度研究，也不触发 surface mutation。
Agent 可忽略该卡片，no-research/no-mutation 仍是合法结果。

调整后的 2-repeat Level-1 case `9` 位于
`runs/shopping-projection-actionable-1-9-r2`：on/off 都未通过，平均 score 均为
0.6667，均无 finding/effect；on 的平均 observation 字符为 23,085.5，off 为
30,377.5（约 -24%），card 从 5 次降至 1 次，但 on 的 trace event 数反而更高。
因此模型输入字符、事件数和任务正确性必须继续分开报告，不能从其中一个成本指标推导
harness improvement。

更长的 Level-1 case `1` 隔离复验位于
`runs/shopping-projection-actionable-1-1-r1`。repeat-001 两个 Pi task 都正常结束但
未通过：off 匹配 3/5（score 0.6，52,507 observation chars，8 cards），on 匹配
4/5（score 0.8，56,890 chars，1 card）；两臂都没有 finding、decision 或 effect。
repeat-002 的外层实验进程中断，只留下 projection-on 的实时 trace，未被纳入成对
聚合。该 partial run 保留用于超时/中断分析，不能补成成功样本，也不能据 repeat-001
的单次分数差声称 projection 有效。

综合这些结果，projection 模块当前只通过了“可开关、去除重复 card、完整 trace 仍
落盘”的机制测试；它尚未通过“多次复验中稳定帮助 Auto-Research + self-harness 闭环”
的有效性门槛。进一步调优不得通过强制 finding、自动 apply 或 runner 候选状态机来
追求触发率。当前更合理的研究方向是选择本身存在多个同类剩余操作、且 evaluator 能
独立验证每个工作单元的任务，继续测量卡片出现后的自主 uptake；在证据成立前不打 tag。

trace 还揭示了一个与 projection 不同的顺序偏置：旧 Shopping system context 要求
Agent 在验证一个商品后“立即加入购物车”，但 `shopping_batch` 的收益前提是同时存在
多个已验证、尚未写入的商品。该表述现已收缩为：保留已验证 ID，逐项立即写入或分组
写入都合法，时机由 Agent 决定；同时明确不得为了制造 batch 机会而延迟验证。离线 Pi
context 测试直接检查最终 system prompt，防止 runner 日后重新引入固定执行顺序。

使用新表述真实运行 6 个商品、无 coupon 的 Level-2 case `1`，目录为
`runs/shopping-level2-case1-neutral-sequencing-smoke-1`。Pi 在首次购物车写入前以
`stopReason=length` 中断，score 0、0/6、finding/card 均为 0。最后七次模型请求的
token 记录显示末轮 input=1,614、cacheRead=27,008、output=8,192；因此这是单轮输出
触及模型 `maxTokens=8192`，不是 128k input context 耗尽。此前一轮输出已达 4,634
token，主要用于反复推演歧义候选。`shopping_batch` 只改变写入成本，无法解决发生在
候选推理阶段的该失败；Pi 的 `setThinkingLevel` 对这个声明为 `reasoning=false` 的模型
也会被 clamp 为 off。基于该证据，本轮没有新增伪有效的 context-compaction 或
thinking-level mutation。

最后，`shopping-projection-experiment` 现在把根 `summary.json` 作为实验聚合检查点：
启动时写 `status=in_progress`，每个独立 arm 完成后原子更新 `completed_arms`，完整 pair
后更新差值，全部结束才改为 `completed`。模拟第二个 arm 抛出 `KeyboardInterrupt` 的
测试确认第一个 arm 仍可从根 summary 读取。它只保存已完成 arm 的 evaluator/成本摘要
和 canonical summary 路径；任务内原始事件仍由各 Pi run 的 JSONL 负责，不增加
intervention ledger、恢复控制器或研究工作日志。

### 3.25 宪法复核后的收缩：撤销 runner-controlled Shopping projection

对 3.21–3.24 的实现继续审计后，发现两项设计虽然便于做实验，却把外围判断带回了
Agent 执行条件：一是 extension 根据特定 `get_product_details`/购物车动作推断何时应该
展示 `shopping_batch` recommendation card；二是 runner 通过环境变量切换模型可见的
任务结果表示。前者编码了领域候选判断，后者让实验协调器控制 Agent 所见上下文；继续
沿这条路调阈值或展示时机会逐步形成隐式 candidate controller，与“runner 只负责
隔离、落盘、评估、聚合”冲突。

因此，3.21–3.24 中的 projection/card 实验只保留为已否决原型的历史证据，不再代表
当前 runtime：

- 删除 `shopping-projection-experiment` CLI、projection on/off runner、环境参数和对应
  聚合协议；不再为一个不合法变量维护消融入口。
- Shopping 工具的完整 backend result 继续返回模型并写入 canonical JSONL；相邻的
  `EXECUTION_OBSERVATION` 只补充中性的事件 ID、结果和工作量，不重复结果正文。
- extension 不再从特定 task action 推断 batch 候选，`decision_support_cards` 固定为
  0；即使外部设置旧 `PI_SHOPPING_OBSERVATION_PROJECTION`，两次 Pi 运行看到的结果一致。
- 不增加 observation-policy 工具。曾实现的 Agent-owned `deduplicate_exact` 原型虽然
  比 runner toggle 更合宪，但仍需新增工具、状态和两份 decision/exposure 文件；在本轮
  17/24 个 observation 的真实 smoke 及三条既有 Shopping trace 中，精确重复均为 0，
  且该原型尚无 effect assessment。收益机会不足以抵消机制成本，因此直接撤回，而不是
  放宽成会重新引入领域判断的语义去重。
- inactive `shopping_batch_action` 仍在静态 task capability catalog 中披露“能改变什么、
  何时生效、作用范围”。system context 只提示 Agent 可以基于自己的 task-local evidence
  创建 finding 并选择 apply/keep/ignore，不推荐哪个观察值得修改。

离线 Pi 测试验证了三条边界：完整商品结果仍包含 `material_composition` 与
`review_summary`；execution observations 不含 task-specific `decision_support`；旧 runner
toggle 不改变任一 `get_product_details` 结果，且初始工具/能力目录不包含被撤回的
observation policy。脚本化的 finding →
`pi.setActiveTools` → next-request exposure → batch effect 测试仍保留，用于证明 Pi-native
闭环能力本身可执行，但它不是自主 uptake 或 harness improvement 证据。

这一收缩也改变了 Shopping 负结果的解释：Agent 不创建 finding 不能再通过外围卡片
“优化触发率”。真实验证应让任务、原始观察和静态能力说明本身产生足够收益；若 Agent
合理判断写入 batch 对候选发现瓶颈没有帮助，no-research/no-mutation 就是正确结果。
Level-2 case `1` 的 8192-output-token failure 仍说明当前 Shopping 的主要阻塞是候选消歧
和长推理，而非 batch 能力不可见。当前不为该失败虚构 Pi mutation，也不打 tag。

原型中有价值但不涉及 Agent 控制面的“避免长实验浪费”被移到合法的
`shopping-experiment` paired runner：根 summary 在实验开始即标记 `in_progress`，每个
control/treatment variant 完成后原子更新 `completed_variants`，完整 pair 后更新 delta，
全部结束才标记 `completed`。模拟第二个 variant 外层中断的测试证明第一个 variant 的
summary 路径与聚合结果仍可读取。runner 不自动恢复或重跑，因此这仍只是隔离/落盘/
聚合，不是任务内 research scheduler 或 rollback manager。

最终收缩版使用 Level-1 case `9` 做真实 JIT smoke，目录为
`runs/shopping-level1-case9-constitutional-smoke-2`。能力目录只包含 task-local
`research_resource` 和 inactive `shopping_batch_action`，初始工具面不含 observation
policy；8 条 canonical execution observations 均无 `decision_support`。因此运行时边界
与离线测试一致。该任务仍在第四次模型响应以 output=8,192、`stopReason=length`
中断，0/3，finding/decision/effect 均为 0；前一请求 input=10,371、output=2,414，末轮
input=2,902、cacheRead=15,232，仍是单轮生成过长而非 128k input context 耗尽。
这次 smoke 只证明收缩后 Pi 工具链可运行且无外围候选注入，不证明 Shopping 完成率或
Auto-Research uptake。真实负结果继续阻止 tag/push。

### 3.26 任务语义归还 Agent：通用表示策略与 OfficeBench 候选卡撤除

对 3.25 再复核后，保留“删除 runner-controlled projection 与任务特定 card”的结论，
但修正了“因此不应提供任何 observation-policy 原语”的过度收缩。Runtime 可以提供
领域中性的表示操作，前提是选择权、证据和生效时序属于 Agent，且 canonical 数据不丢失。
因此 Shopping 恢复 `set_observation_policy(full | deduplicate_exact)`：默认 `full`；只有
active finding-backed 的 Agent apply/keep 决策可选择或恢复；下一模型请求生效；去重只认
byte-identical 的 tool + arguments + result，不识别商品字段、商品数量、benchmark 谓词或
语义相似度。`execution-observations.jsonl` 始终保存完整参数和结果，并分别记录 policy
decision/exposure。3.25 中“初始工具面不含 observation policy”的描述只适用于当时的
收缩 smoke，不再描述当前 runtime。

同一原则也应用到 OfficeBench。Extension 删除根据 `excel.read_file`、calendar/email
action 自动生成的 `decision_support`、固定 calendar=3/email=4 break-even、
`one_step_if_worthwhile` 和 finding 返回后的任务特定 decision point。执行结果只附
`observation_id/tool/operation/outcome/error_kind/work_units` 中性元数据。静态 capability
catalog 仍可描述 calendar/email batch 工具的真实接口、作用范围和 next-request 生效时序；
Agent 必须自行引用 execution observation 创建 finding，并自行决定 apply/keep/ignore。
Runner 的 research-connection summary 也只认这条 observation → Agent finding → decision
→ observed effect 链，不再把外围 candidate card 当作连接起点。

### 3.27 最小性复核与 Shopping effect-link 独立校验

3.26 的 observation-policy 原型再次经过收益审计后撤回。它虽然由 Agent 选择、不会
删除 canonical 数据，形式上没有让 runner 接管决策，但在最新 17/24 observation smoke
及既有 Shopping traces 中，byte-identical 重复均为 0。为一个没有真实收益机会、没有
effect assessment 的原型保留额外工具、状态、decision/exposure 文件和 context 分支，
违反本阶段“先证明必要性再扩展能力面”的最小性要求。将其扩展到 semantic deduplication
又会需要领域相关判断。因此当前 runtime 再次删除 `set_observation_policy`，3.26 只作为
被否决原型的历史记录；负向 Pi context 测试锁定工具和 capability catalog 均不包含它。

本轮真正保留的实现是已有 Shopping batch effect chain 的归因校正，而不是新控制面：

- Pi extension 在 assessment 中写入现有 `decision_id`、`toolCallId`、immutable finding
  snapshots、next-request exposure 后的 `observation_ids` 和可重算 work-unit metrics；
- 同一 assistant response 内、仍由旧 tool surface 选择的 task action 不进入 effect
  window；新的 installed-Pi fixture 用同响应 decision + direct action 复现并锁定边界；
- Python runner 只读 canonical JSONL，独立检查 finding snapshot、applied decision、
  `pi.setActiveTools` exposure、effect metric 和 window counts 是否一致；错连或伪造的
  supported assessment 报 `invalid_link`，不得投影成 `apply_effect_observed`；
- reported effect、validated effect、correctness-gated effect 和
  `harness_improvement=not_established` 继续分开。

定向验证使用 `D:\conda\python.exe`，四项 exposure/link/correctness 测试为 `4 passed`；
Shopping native、runner 与 CLI 回归为 `24 passed`。真实 benchmark 仍使用 JIT Python；
当前改动尚未以真实 autonomous Shopping pair 验证，因此不能据此打 tag 或声称 harness
improvement。

### 3.28 Shopping Level-3 配对负结果与静态能力披露修复

使用 JIT Python 和 `a:deepseek-v4-flash` 在
`runs/shopping-effect-link-audit-l3-12-r1` 对 Level-3 case `12` 运行一次
counterbalanced treatment/control pair。任务要求选择三件商品：Linen 名称及评分阈值、
Off The Wall 名称及销量/差评阈值、以及 size 39 且评分计数精确匹配的商品。结果：

- treatment 在 300 秒超时，43 条 task observations（30 search、11 details、1 size
  filter、1 user info），cart 为空，finding/decision/effect 均为 0；
- control 在单轮 output=8192 时 `stopReason=length`，14 条 task observations（6 search、
  7 details、1 user info），cart 为空，finding/decision/effect 均为 0；
- 两臂 score/case score 均为 0，差值为 0，`harness_improvement=not_established`。

Trace 表明 agent 已找到后两个要求的唯一候选，但在两个同时满足 Linen 阈值的商品之间
长时间反复推演，没有进入 cart write。这里的阻塞发生在候选语义消歧阶段；batch write
能力没有收益窗口，no-research/no-mutation 不能被视为机制错误，也不能用自动 finding
或推荐卡提高触发率。

审计同时发现一个独立、可修复的连接缺口：Shopping 写出了
`capability-catalog.json`，但 treatment system context 只声称 catalog 存在，没有实际
提供内容，也没有读取该文件的 task tool。现在 extension 将同一个有界静态对象既写盘
又一次性注入 treatment 初始 context；其中只说明 `research_resource`、inactive
`shopping_batch_action`、scope 和 `next_model_request` 生效时机，不包含任务动作阈值、
候选建议或 preferred choice。Control 不接收这段披露。installed-Pi 负向/披露测试先红后
绿；包含 exposure gate 与 Shopping runner 的定向回归为 `17 passed`。

这项修改加强“任务资源 → Agent 执行条件决策”的可见连接，但尚未有新的 autonomous
paired result 支持 uptake 或性能收益；下一次真实 run 必须继续把不触发视为合法结果。

### 3.29 恢复 JIT Shopping 正式任务契约并重跑 Level-3 case 15

复核 JIT 的 canonical adapter 后发现，先前 Shopping runner 只把 dataset 中的用户
query 提交给 Pi，遗漏了 `benchmark/adapter/deepplanning.py` 中按 Level 区分的正式
system prompt。尤其 Level 3 的 coupon 检查、coupon 入购物车和最低最终价格语义完全
没有进入 Agent 上下文；因此 3.28 及更早 Shopping run 不能作为公平的机制收益证据。

本轮没有复制或改写任务规则，也没有把 evaluator/ground truth 暴露给 Agent。runner
只读解析 JIT adapter 顶层的 `SHOPPING_SYSTEM_PROMPT_L1/L2/L3` 字符串，将对应 level
contract 与原始 query 合并后同时提交给 control/treatment。每个 run 另写一份小型
`task-contract.json`，只含 canonical source、level 及 system/task prompt SHA-256；paired
summary 独立检查两臂 digest。digest 不参与 Agent 决策，缺失时实验标为 `unverified`，
不同时标为 `invalid_task_contract`。

同时修正 `model-visible-observation-metrics.json`：旧 control 分支在返回原始 tool result
前直接退出，导致字符数恒为 0。现在两臂都按实际返回模型的 tool text 计数；treatment
仍会多出中性的 observation provenance，canonical observation 保持完整。没有恢复
projection、candidate card 或 observation-policy 原型。

TDD 证据：canonical loader 与真实 prompt 提交测试先因 API/行为缺失失败；双臂字符测试
先以 control `0 != 5930` 失败；pair digest 审计先因字段缺失失败。实现后 Shopping runner、
native Pi 与 CLI 定向回归为 **31 passed**，最终全量回归为 **119 passed**；
`git diff --check` 通过。对真实 `D:\JIT` 的只读检查得到 L1/L2/L3 contract 字符数分别为
2802/3809/6772，coupon 语义只在 Level 3 出现。

新的真实 paired run 位于：

```text
runs/shopping-canonical-contract-l3-15-r1
```

使用 JIT Python、`a:deepseek-v4-flash`、Level-3 case `15`、单臂 300 秒上限。两臂
`task_prompt_sha256` 均为
`77907b635172364be2046373a56048a4be4d5f31a4e21b4133e907fd1eda8176`，实验有效性为
`valid`。结果：

- treatment/control 均正常结束，三个商品和一个 cross-store coupon 全部匹配，score 与
  case score 均为 1.0；此前 coupon 漏失由任务契约修复消除；
- treatment 有 20 条 execution observations，control 有 19 条；二者都在一个 assistant
  response 中并列发出三次 `add_product_to_cart`，随后尝试 coupon 并最终得到正确购物车；
- treatment/control 的模型可见 tool-result 字符数为 62,278/46,692，trace events 为
  10,439/10,455；新增 attribution context 在本次 no-change run 中产生了输入开销，未带来
  正确性优势；
- treatment 没有创建 finding、decision、Pi exposure 或 effect assessment；
  `research_connection=not_attempted`，`harness_improvement=not_established`。

因此该 pair 证明正式 benchmark 语义和双臂成本统计已恢复，但没有证明 Shopping batch
机制有效。三个 cart write 的理论节省只有两个 Pi tool calls，而进入 finding/decision
还会增加一次研究工具调用和至少一次后续模型请求；Agent 的 no-change 可能是合理的收益
判断，不能用外围推荐或自动 finding 强制触发。下一轮应选择本来就包含更多同类剩余写入、
且候选发现不占主导的验证 case；在此之前不扩大 capability surface，也不打 tag/push。

### 3.30 Selective-details 自主门槛失败与能力撤除

为处理 Shopping 详情结果过大的真实瓶颈，曾模块化实现 inactive
`shopping_selective_details`：Agent 必须先引用完整 `get_product_details` 观察创建 finding，
再自主 apply `selective_details` surface；Pi 的 `setActiveTools` 在下一模型请求生效，runner
可独立重算每个商品的字符压缩。脚本化 installed-Pi 测试证明机械链路可执行，但这不代表
真实 Agent 会采用或任务会改善。

两次正式任务使用相同的静态能力披露，结果如下：

| run | correctness | observations / visible chars | finding / decision / effect |
|---|---:|---:|---:|
| `shopping-selective-details-l1-22-r1` | 5/6，score 0.8333 | 52 / 140,674 | 0 / 0 / 0 |
| `shopping-selective-details-l1-46-r1` | 6/6，score 1.0 | 33 / 162,152 | 0 / 0 / 0 |

第二条 trace 明确注意到该能力需要 finding，随后选择继续读取完整详情；第一条失败来自对
引号中商品短语的语义捷径，把包含额外单词的廉价商品当成等价匹配，而不是缺字段或详情
压缩问题。Level-1 case 22 在补齐 Shopping Auto-Research 方法前后也都保持 5/6、无
finding，说明继续强化方法文字没有改变这个局部决策。

根据预先约定的最小性门槛，runtime 现已撤除 selective tool、surface、effect audit、
脚本 fixture 和专用测试。保留 canonical task contract、双臂可见字符统计、完整 canonical
observations、Shopping Auto-Research 方法注入及已有 `shopping_batch` 闭环。负向
installed-Pi 断言锁定 tool context 与 capability catalog 均不再包含 selective surface。

这次撤除不是 runner 在任务中替 Agent 选择能力；它是任务外的实验淘汰。真实执行仍允许
Agent 对现有 batch 能力创建 finding、apply/keep 或完全 no-change。若未来重新考虑详情
表示能力，必须先有新的跨任务真实 trace 证明持续瓶颈，并重新经过自主 uptake 与
correctness-gated benefit 门槛；不得用推荐卡、自动 finding 或语义投影绕过该门槛。

撤除后验证：

```text
D:/conda/python.exe -m pytest -q tests/test_pi_shopping_native.py tests/test_shopping_e2e.py tests/test_cli.py
32 passed

D:/conda/python.exe -m pytest -q
120 passed

git diff --check
passed（仅现有 LF/CRLF warning）
```

### 3.31 收缩后 OfficeBench 分层 cohort

撤除 Shopping selective 原型后，用 JIT Python 在全新目录运行一个不带任务特定推荐的
OfficeBench cohort：

```text
PYTHONPATH="$PWD/src" D:/anaconda/envs/jit/python.exe -m autoresearch_pi.cli \
  officebench-cohort --cases "2-13-0,3-45-0,2-15-0" --repeats 1 \
  --root runs/officebench-constitutional-cohort-20260909-r1
```

三类任务分别覆盖重复日历写入、同类日历任务的 no-change/长度风险，以及 calendar→Excel
跨工具反转。结果：

| case / arm | passed / score | turns | task actions / bridges | research / decision / effect |
|---|---:|---:|---:|---:|
| `2-13-0` control | yes / 1.0 | 4 | 25 / 25 | 0 / 0 / 0 |
| `2-13-0` treatment | yes / 1.0 | 4 | 17 / 17 | 0 / 0 / 0 |
| `3-45-0` control | no（length）/ 1.0 | 3 | 7 / 7 | 0 / 0 / 0 |
| `3-45-0` treatment | yes / 1.0 | 4 | 13 / 13 | 0 / 0 / 0 |
| `2-15-0` control | yes / 1.0 | 5 | 25 / 25 | 0 / 0 / 0 |
| `2-15-0` treatment | yes / 1.0 | 5 | 25 / 25 | 0 / 0 / 0 |

`2-13-0` 两臂均直接完成 12 次 create；差异来自 control 做了 12 次 list、treatment 只做
4 次，不存在 finding 或 Pi surface change，因此不能把 8 个 bridge 的减少计入 harness
effect。`2-15-0` 两臂工具序列完全同构（1 次 calendar list、1 次建表、2 次读表、21 次
set cell），是符合预期的跨工具 no-change。

`3-45-0` 暴露 evaluator 稀疏性：control 在只完成 Excel read 和 6 次 calendar list 后以
模型输出长度终止，JIT score 仍为 1.0；根 summary 正确以 `pi_agent_succeeded=false` 将其
记为 failed，而 treatment 完成 6 次 create 后通过。这是单次普通轨迹差异，因 treatment
没有 research/mutation，不能作为 Auto-Research+self-harness 收益。

该 cohort 的 treatment 为 3/3 passed、control 为 2/3，但两者所有 mediator 均为 0；
因此 `harness_improvement=not_established` 保持正确。它进一步说明当前主要问题不是能力
不可见，而是 Agent 在有收益窗口时是否会稳定形成 evidence-backed finding 的策略方差。
不能用自动 finding、推荐卡或 mutation scheduler 消除这类方差；下一步仍需重复配对，
并把任务完成、无 mutation 的普通成本差异和真正 post-exposure effect 分开。

### 3.32 无候选卡的 `3-6-0` 重复基线

`runs/officebench-current-no-card-3-6-0-r2` 对同一 Level-3 case 做了两组 counterbalanced
pair。Control 与 treatment 都是 2/2 通过；treatment 的 bridge 数分别为 18、21，control
均为 19。两次 treatment 都没有 finding、decision 或 effect。这个结果确认：删除任务特定
candidate card 后，即使任务包含 12 封个性化邮件，Agent 也不稳定进入研究链路；普通执行
成本的 `-1/+2` 波动不能归因于 self-harness。

### 3.33 静态能力披露与一次真实闭环

审计发现 OfficeBench 虽写出 `capability-catalog.json`，但 treatment 没有把其中 bounded、
静态的 inactive capability 事实真正放入模型上下文。Extension 现在从同一个 canonical
catalog 生成一次性紧凑披露，仅包含 scope、next-request timing、Agent ownership、初始
surface 以及 calendar/email batch 的真实行为；不包含动态候选、任务阈值或 preferred
choice，control 完全不接收该披露。

真实 JIT run `runs/officebench-compact-disclosure-cost-tradeoff-3-6-0-smoke-1` 随后产生了一次
完整链路：Excel roster observation → Agent `finding-1`（是否把 12 封个性化邮件合并）→
`decision-1` apply `email_batch` → Pi `setActiveTools()` → 下一模型请求观察新 surface →
一个 `email_batch_action` 完成 12/12 → `effect-assessment-1` 得到
`tool_call_compression=12, verdict=supported` → Agent 引用 assessment 并把 finding v2
resolve 为 supported。任务、JIT evaluator 和 required artifact checks 全部通过；研究生命周期
为 `closed`，但 `harness_improvement` 仍为 `not_established`。

这次 smoke 中第一次 `research_resource(record)` 漏传 `evidence_refs`，runtime 正确拒绝，
Agent 随后引用真实 observation 重试成功。这个错误不是应通过放松 provenance 解决的 API
缺陷：接受无引用 finding 会破坏“真实观察先于调整”的约束；当前一次清晰错误反馈已经能恢复。

### 3.34 闭环可触发但尚不稳定

`runs/officebench-compact-disclosure-cost-tradeoff-3-6-0-r2` 的两组新 pair 没有复现上述闭环。
Control 2/2 通过；treatment 1/2 通过，其中一次 `stopReason=length`，另一次与 control 同为
18 个 bridge。两个 treatment 的 finding/decision/effect 都为 0。因此静态披露证明了
mechanism 可被真实 Agent 使用，但 1 次独立成功加 2 次 paired non-uptake 不足以证明稳定
benefit，也不允许 tag/push。

### 3.35 Calendar 披露完整性与“局部收益不足”证据

`runs/officebench-compact-disclosure-calendar-2-13-0-r1` 在 calendar 写入任务上得到两臂均
通过、0 finding/decision/effect；treatment 直接执行并验证 12 个事件，使用 25 个 bridge，
control 为 19。Trace 显示 Agent 在一次 Excel read 后可以在同一 assistant response 并列
发出 12 个 direct create。对 Agent 而言，这比先记录 finding、等待下一模型请求再调用 batch
更直接；runner 看到的 bridge 节省并不是足以驱动 Agent 的局部收益。

该 trace 同时暴露静态 catalog 对 `email_batch` 提供 input shape、对 `calendar_batch` 却遗漏
input shape。通过 installed-Pi TDD 补为
`events: 2-16 items with user, summary, time_start, and time_end`。这是能力事实完整性修复，
不包含任务候选或阈值。修复后的 `runs/officebench-calendar-input-disclosure-2-13-0-r2` 仍然
两臂通过、各 26 bridge、0 finding/decision/effect，证明补齐契约本身没有提高 uptake；因此
不继续扩写提示。

另修正 runner 的陈旧硬编码工具列表：它曾声称 `workspace_file_action` 总在初始 surface，
但 extension 会在完整 binary-only inventory 中将其移除。任务提示现在只声明 live Pi schema
与 model-visible catalog 为准，并把 workspace tool 说明改成“when active”。这只消除资源披露
矛盾，不改变 Agent 决策或自动创建研究状态。

### 3.36 一次性 post-observation reminder 实验与撤回

`runs/officebench-live-schema-disclosure-3-6-0-r3` 在移除 runner 假工具列表后仍得到
control/treatment 均通过，但 treatment 为 12 turns、17 bridges、0 finding/decision/effect；
Agent 把“batch”理解为多轮分组调用 direct `email_action`，没有使用 inactive Pi capability。
这说明初始 system disclosure 即使完整，在 roster observation 后的继续执行决策中仍可能
不显著。

为验证纯“可见时机”假设，短暂实现了一个可消融的、一次性 static decision bridge：只在
首个 task-action observation 后通过 Pi context hook 重放相同的 bounded capability 摘要；
不根据 action 选择 capability，不生成候选/finding/decision，不改变工具面，并明确 no-change
合法。Installed-Pi 测试证明它只出现一次且可关闭。

两个真实 JIT 验证都没有产生自主 uptake：

| run | task result | turns / bridges | finding / decision / effect |
|---|---:|---:|---:|
| `runs/officebench-static-decision-bridge-2-13-0-smoke-1` treatment | pass / 1.0 | 4 / 16 | 0 / 0 / 0 |
| `runs/officebench-static-decision-bridge-3-6-0-smoke-1` treatment | pass / 1.0 | 5 / 18 | 0 / 0 / 0 |

两次 run 的 `pi-native/capability-reminder.json` 都证明摘要已在首个 task observation 后送达，
但 Agent 仍直接执行。`2-13-0` 的 control/treatment bridge 差为 30/16，来自普通轨迹和验证
数量差异，没有 mediator，不能算 self-harness 效果。`3-6-0` 同样直接完成 12 次 email send。

因此该模块已从 production extension 和测试面撤回。保留 run 作为否定证据；不保留环境
开关、额外 context 文本或审计文件生成逻辑。这个结果进一步表明当前阻塞不是再多一次静态
提醒，而是 benchmark 动作可以在同一 response 并列发出，使 next-request mutation 的局部
收益经常低于额外研究轮次。后续验证应寻找天然跨轮、受反馈约束的重复阶段，而不是继续增加
提示强度或外围调度。

### 3.37 非 Agent 可见的重复动作时序画像

为避免把“任务有很多 backend calls”等同于“Agent 有可获益的 next-request 调整窗口”，
runner 的既有 `execution_efficiency` 增加 `response_profile`。它只从 canonical
`pi-events.jsonl`、`execution-observations.jsonl` 和 `harness-decisions.jsonl` 复算：

- 每个重复 `tool + operation` 的调用数与 work units；
- 分布在多少个 assistant responses、单 response 最大并列数；
- 是否全部在一个 response 发出；
- 若存在 applied decision，多少调用位于 decision response 之前、同一 response、之后。

该 projection 标记 `agent_visible=false`、`candidate_inference=none`，不计算 break-even、
不推荐 capability，也不参与 task runtime。Paired summary 只复制 group 数、跨 response group
数与单 response 最大重复数，避免聚合文件膨胀。Installed/unit fixture 验证同一 decision
response 内的 direct action 不会被错误计为后续动作。

对既有真实 trace 的离线复算给出关键区分：

- `officebench-static-decision-bridge-2-13-0-smoke-1` treatment 的 12 个
  `calendar_action.create_event` 全部来自一个 assistant response；
- `officebench-static-decision-bridge-3-6-0-smoke-1` 的 12 个 email sends 分布在两个
  responses，但其中 11 个集中在一个 response；
- 成功闭环 `officebench-compact-disclosure-cost-tradeoff-3-6-0-smoke-1` 的 first applied
  decision 位于第 4 个 response，后续 direct email 调用只用于验证，批量写入由 effect
  assessment 单独覆盖。

新的 Level-3 no-change 验证 `runs/officebench-response-profile-3-52-0-r1` 两臂都在 Excel read
和 calendar list 后以 `stopReason=length` 失败，score 0、0 finding/decision/effect，尚未产生
重复写入，因此 profile 正确报告 0 repeated groups。这个 case 不能检验 batch calibration，
但证明稀疏 evaluator 输出之外还能看见失败发生在重复动作阶段之前，避免把失败误归因给
self-harness 或 no-change 决策。

### 3.38 受限文本输出能力补齐，不计作 self-harness

Level-3 case `3-53-0` 要求读取班级名单、为学生创建日历事件，并按班级创建目录及写入
`[NAME].txt`。首次 treatment smoke
`runs/officebench-longer-workflow-3-53-0-treatment-smoke-1` 暴露了 baseline capability 缺口：
extension 因输入 inventory 只有二进制 Office 文件而移除了 `workspace_file_action`，导致 Agent
没有可在 testbed 边界内创建目录和纯文本文件的工具。该 run 在 4 turns、6 task actions 后
以 `length` 结束，score 0，finding/decision/effect 均为 0。

因此为既有 `workspace_file_action` 增加 `make_directory` 与 `write_text`。两者仅接受当前
testbed 内的相对路径，拒绝绝对路径、`..` 与 symlink 穿越；文本限制为 262,144 UTF-8 bytes，
且写文件前父目录必须存在。这个改动是完成任务所需的 baseline action，不是由 task-local
finding 选择的 Pi surface mutation，不能记作 self-harness improvement。binary-only inventory
也不再成为移除该工具的理由。

第二次 treatment smoke
`runs/officebench-longer-workflow-3-53-0-treatment-smoke-2` 已能看见并调用该工具，但 Agent 只做了
一次 workspace listing 和一次 Excel read，2 turns 后再次以 `length` 结束；required outputs
均未改变，finding/decision/effect 仍为 0。它证明机械能力缺口已消除，但不是闭环收益证据。

随后 canonical artifact contract 与 initial task-resource catalog 同步：只有任务文本明确要求
创建目录或写出 `.txt` 时，才披露对应动作；输入 inventory 中仅出现文本文件不会触发写能力。
这保持了静态、按需的能力事实披露，不推断研究候选、不推荐 mutation、不替 Agent 创建
finding，也不改变 no-research/no-change 的合法性。

第一次同步验证 `runs/officebench-longer-workflow-3-53-0-treatment-smoke-3` 又暴露了一个纯静态
选择缺陷：任务原文为 `create different folders`，过窄的短语匹配只选入 `write_text`，遗漏
`make_directory`；同时输入 `.xlsx` 与通用动词 `create` 的组合误选了三个 Excel 写契约。
选择逻辑随后收紧为：目录创建允许 create/make 与 folder/directory 之间存在少量修饰词；
Excel/Word 写契约则必须由任务文本明确提及对应应用，不能只由输入 inventory 加通用写动词
触发。针对本 case 的 action catalog 因而从 7 项收缩为 5 项：calendar list/create、Excel read
以及 workspace make-directory/write-text。

最终验证 `runs/officebench-longer-workflow-3-53-0-treatment-smoke-4` 确认两项 workspace 输出
契约均在 initial catalog 中，且无关 Excel 写契约已消失；Agent 仍只执行 workspace listing 与
Excel read，2 turns 后以 `length` 结束。score 0、required artifacts 未变化，research
goal/finding、decision、effect 全为 0。失败发生在任何重复 calendar/text 写入之前，因此不能
评价 Auto-Research+self-harness，按预定门槛将 `3-53-0` 退役为当前模型/预算下不合适的闭环
验证 case；不再增加 reminder、scheduler、自动 finding 或其他外围控制。

### 3.39 用真实 trace 做收益窗口筛选

为了避免只根据任务文字中的 “all/each” 猜测 mutation 是否有价值，新增实验前先用实际执行
时序判断任务是否到达可受下一模型请求影响的重复阶段。OfficeBench `3-49-0` 看似适合：先从
成绩表配对学生，再为多人创建 calendar event 和 email。配对 run
`runs/officebench-eligibility-3-49-0-r1` 中 control/treatment 却都只完成一次 backend read，
分别在 3/2 turns 后以 `length` 结束；score 均为 0，repeated action group 与
finding/decision/effect 全为 0。它没有真实 mutation window，因而与 `3-53-0` 一并从当前闭环
验证集排除。

Shopping Level-2 case 11 有 6 个目标商品，理论上适合 `shopping_batch`，但 paired baseline
`runs/shopping-batch-eligibility-l2-11-r1` 显示两臂均在 candidate discovery 阶段失败：
treatment 300 秒超时前产生 50 条 observation，control 在 44 条 observation 后以 `length`
结束，购物车都为空，finding/decision/effect 均为 0。任务尚未进入 cart writes，因此它同样
不能检验 batch。该 run 同时确认真正的前置瓶颈是大量完整商品详情，而不是后续写入调用数。

### 3.40 Selective-details 重议、机械闭环与再次撤除

上述 Shopping trace 与此前两个 140k/162k 字符 run 一起满足了“多条真实 trace 证明详情
瓶颈”这一重议门槛。因此曾以独立模块短暂恢复 `shopping_selective_details`：它初始 inactive；
Agent 必须引用先前 full-detail observation 创建 finding，并通过现有
`research_resource.continue_with` 自主 apply；Pi `setActiveTools` 在下一请求暴露工具。Agent
显式传入 1–12 个 dot-path fields，模型只收到这些字段，完整 backend result 仍写入 canonical
observation；单次调用的 full/visible chars 可由 runner 独立复算。没有自动字段选择、候选
推断、提醒器、组合 surface 或第二 effect manager。

Installed-Pi TDD 先以“surface/tool 与 audit metric 不存在”正确失败；最小实现后，两条测试
证明了完整机械链路和 runner 重算：full observation → finding/apply → 下一请求 exposure →
selective call → compression assessment → finding resolve。随后真实 smoke
`runs/shopping-selective-details-l2-11-smoke-1` 给出决定性负向结果：Agent 在思考中明确引用了
selective capability 的 `1-16 IDs` 契约，并明确预见 full result 会很大，但仍选择直接分块调用
full details。最终 300 秒超时、购物车为空，共 74 条 observations，其中 37 search、17
full-detail、19 transport-time、1 user-info；17 条详情正文累计 166,366 字符，仍为 0
finding/decision/exposure/effect。

这已是该 capability 在此前两次 autonomous non-uptake 后的第三次真实失败。问题不是静态
能力不可见，也不能通过再加 reminder、自动 finding 或降低 evidence provenance 解决。根据
最小性门槛，selective runtime、metric 分支、脚本 fixture 和正向机械测试再次全部撤除；真实
run 保留为否定证据，负向测试继续锁定当前 runtime 不暴露该工具。撤除后 Shopping 定向回归
为 32 passed。后续不再新增同类详情 surface；优化方向收缩到降低现有 Agent-authored
finding/decision 接口本身的摩擦，并继续用 trace eligibility 选择验证任务。

### 3.41 Shopping finding 接口对齐与 Level-3 eligibility smoke

方法资源已经明确：当 `continue_with` 完整表达执行决定时，不应在独立 `decision` 字段重复
同一文本。OfficeBench 的 `research_resource(record)` 已遵守该契约，但 Shopping 仍在执行前
无条件抛出 `record requires decision`。这是一项现有 Agent-owned 接口摩擦，不是缺少新的
research controller。

本轮通过 installed-Pi RED/GREEN 对齐 Shopping：`record` 继续要求非空 `evidence` 和至少一个
真实 `evidence_refs`；只有 `decision` 或 `continue_with` 二者至少一个即可。省略 `decision`
时，finding 保存 `${choice} ${mode}: ${expected_effect}`，随后仍由同一次 Agent tool call 的
`continue_with` 自主 apply/keep。没有自动 finding、默认 apply、候选推断、新字段、环境开关或
第二套 mutation API。脚本模型的真实 Pi agent-loop 测试先因旧实现没有产生
`research-resources.jsonl` 而失败；最小修复后产生 finding、finding-backed decision、下一请求
Pi surface exposure、batch action 和 supported assessment。Shopping 定向回归为 33 passed，
全量回归为 123 passed。

真实 JIT treatment smoke `runs/shopping-contract-friction-l3-3-smoke-1` 使用 Level-3 case 3。
任务正确完成：4/4 商品、3/3 coupon、无额外商品，score 1.0；但 finding、decision、effect 均
为 0。Pi trace 显示四次 `add_product_to_cart` 全部在第 7 个 assistant response 并列发出，
因此 next-request 生效的 `shopping_batch` 在该批之后已经没有收益窗口。这不是接口修复失败，
也不是 self-harness 正向证据；它是一条合宪的 no-research/no-mutation 结果，并将该 case 从
“紧凑 record 接口的正向 autonomous uptake 验证”中排除。

离线检查既有 Shopping trace 找到了 cart writes 跨多个 response 的样本，但高复杂度 case 常在
检索或长度预算阶段失败。下一次真实选择必须同时满足：candidate discovery 可完成、至少两个
相似写入尚未发生且位于未来模型请求、任务正确性可独立检查。若多次符合条件的 trace 中仍无
finding，记录 autonomous non-uptake；不得增加 reminder、自动 finding 或 runner 推荐。该接口
修复本身保持启用，因为它消除了与方法资源的矛盾且没有增加常驻协议面；但在 paired、
correctness-gated 结果出现前，不声称它改善真实任务表现。

### 3.42 Shopping batch 行为真实性与低成本 eligibility 投影

继续核对实现时发现，Shopping capability catalog 和 effect 文本一直声称 batch 通过“一次
Pi tool call 和一次 bridge process”完成，但旧 TypeScript handler 在 `for` 循环中为每个
item 分别调用 `runBridge()`；唯一的 `spawnSync` 正位于该函数内。因此旧实现实际只压缩 Pi
tool calls，并没有压缩 Python bridge processes，runner 又只重算 `tool_call_compression`，会把
这项不完整行为误判为 supported。

本轮用真实 JIT bridge 的 RED/GREEN 修正该缺口：Python `shopping_tool_bridge` 新增受限的
`shopping_batch_action` bridge action，在一个进程和一个 JIT tool-set 生命周期内依次执行
2–16 个 `add_product_to_cart`。它逐项保留 success/semantic/transport outcome，整体仍明确为
non-atomic；Pi extension 现在只调用一次 `runBridge()`。这没有把 batch 加入初始 active
surface：Agent 仍需先引用当前任务 observation 创建 finding，再自主 apply，Pi
`setActiveTools()` 仍只在下一模型请求生效。

Effect window 新增实际 `bridge_processes` 与 `work_units_per_bridge_process`，Python runner 从
canonical observations 独立重算。一个故意报告 2 个 bridge processes、却把 window 写成 1
的 fixture 现在被标记为 `window_bridge_processes_mismatch`，不能进入 supported 集合。
installed-Pi agent-loop fixture 实际写出 2 work units / 1 Pi call / 1 bridge process，且 compact
`record + continue_with`、next-request exposure 与 supported assessment 全部贯通。

为避免以后再次手工扫描万级 Pi events，Shopping summary 复用了一个非 Agent 可见的
response profile。Canonical observation 保存原生 `toolCallId`，但模型可见
`EXECUTION_OBSERVATION` card 不重复披露该 ID；runner 只按真实 assistant `message_end` 计算
重复动作分布、单 response 最大并列数及 applied decision 前/同 response/后计数。投影明确
`agent_visible=false`、`candidate_inference=none`，不推荐 capability、不生成 finding、不参与
任务执行。Paired aggregate 只增加 model turns、bridge processes 和跨 response 重复组等紧凑
指标，用于筛选验证集并减少无收益盲跑。

当前代码真实验证如下：

- `runs/officebench-current-contract-paired-3-6-0-r1`：两臂均正确通过，5 turns；treatment
  0 finding/decision/effect，bridge 18→17 只是普通轨迹差异。11 次 email send 集中在一个
  response，不能归因于 self-harness。
- `runs/shopping-single-bridge-l3-2-smoke-1`：Level-3 case 2 treatment 正确通过，4/4 商品、
  2/2 coupon、score 1.0；0 finding/decision/effect。新 profile 显示 4 次 cart write 全在一个
  response；coupon 写入跨 3 个 response，但当前 batch capability 不覆盖 coupon；17 次 search
  与 7 次详情读取才是多轮成本主体。
- Shopping 定向回归为 36 passed；加入单进程 bridge、独立真实性 gate 和 response profile 后
  全量回归为 126 passed。

因此这轮建立的是“capability 的声称行为终于真实成立”和“可低成本判断任务是否存在
next-request 收益窗口”，不是新的 autonomous harness improvement。不得因为 Shopping case 2
和 case 3 都正确完成就强制它们创建 research finding；它们的 cart writes 已在一个 response
发完。也不据 coupon 跨轮现象立即新增 coupon batch：其中包含 semantic failure 和反馈依赖，
还没有证据表明批量化有正确性收益。只有新的真实 trace 同时出现尚未执行的同质 cart writes、
跨未来模型请求的窗口以及自主 finding/apply，才用 paired correctness-gated run 验证单进程
收益。在此之前不打 tag、不 push，也不增加 scheduler、reminder 或自动 finding。

### 3.43 Cart-plan 反证实验与合宪撤除

为直接检验 coupon 跨 response 是否足以形成更大的收益窗口，曾把现有、初始 inactive 的
`shopping_batch_action` 临时扩展成一个 cart plan：Agent 已经选定商品和 coupon 后，可在一次
Pi call 和一个 bridge process 中先写入 2–16 个商品、再写入 0–8 个 coupon。它没有新增 mode、
controller、推荐或自动触发；仍要求真实 observation-backed finding、Agent 自主 apply，以及
下一请求的 `pi.setActiveTools` exposure。Installed-Pi 测试还专门检查模型看到的 tool schema，
排除了“底层接受 coupon、但 Agent 看不到参数”的假绿灯。

两个新的真实 JIT Level-3 treatment smoke 都正确完成，却一致给出 autonomous non-uptake：

- `runs/shopping-cart-plan-l3-3-smoke-1`：4/4 商品、3/3 coupon、score 1.0；11 turns、22 个 task
  action。4 次商品写入仍集中在一个 assistant response；4 次 coupon 写入跨 4 个 response，
  其中一次因门槛不足产生 semantic error，Agent 随后直接修正。finding、decision、exposure、
  effect 均为 0。
- `runs/shopping-cart-plan-l3-2-smoke-1`：4/4 商品、2/2 coupon、score 1.0；17 turns、51 个 task
  action，其中 26 次 search、14 次 details 才是主成本。4 次商品写入集中在一个 response；
  coupon 写入包含 semantic error 和后续删除/重选。finding、decision、exposure、effect 同样为 0。

这两条 trace 说明完整 schema 披露仍未使能力成为 Agent 自然执行策略：商品 batch 对下一请求
生效太晚，而 coupon 组合依赖每次写入后的购物车反馈，不是已验证的同质写入。继续增加
“看到重复就研究/应用”的提示，会把 Agent-owned 判断变成隐藏 scheduler；把失败后续操作自动
合并，则会牺牲正确性边界。因此临时 coupon 扩展、对应脚本 fixture 和机械正向测试已全部
撤除，保留真实 runs 作为否定证据。现有 product-only batch 与通用 finding/decision 接口不因
此扩大；后续只在 trace 先证明“未来请求仍有多个已验证、无反馈依赖的 work units”时重议新
能力。正确完成任务仍只证明 task correctness，不证明 harness improvement。

### 3.44 Excel cell batch 候选的时序反证与撤除

`runs/officebench-email-read-eligibility-2-44-0-smoke-1` 曾给出一个表面上很强的候选窗口：
Agent 在 16 个 model turns 中把 10 次 `excel.set_cell` 分布到 10 个不同 assistant responses，
且任务通过、score 1.0。基于这条真实 trace，曾短暂加入初始 inactive 的
`excel_batch_action`：它接受 2–128 个 cell updates，通过一次 Pi tool call 和一个 Python
bridge process 执行；只有 Agent 引用当前任务 observation 创建 finding，并在同一次
`research_resource.continue_with` 中自主选择 `apply` 后，Pi `setActiveTools` 才在下一模型请求
暴露它。

Installed-Pi 机械测试证明完整链路在实现上真实成立：workbook creation observation →
finding/apply → next-request exposure → 4 个 cells 的单次 batch → read-back 正确 → supported
effect。该结果只证明原语和审计链可运行，不证明真实 Agent 会采用或能从中获益。

三次真实 autonomous smoke 均没有产生 uptake：

- `runs/officebench-excel-batch-2-44-0-smoke-1` 在 4 turns、4 个 task actions 后以
  `Pi model ended with length` 结束；只到达邮件读取，score 0，finding/decision/effect 为
  0/0/0。
- `runs/officebench-excel-batch-2-44-0-smoke-2` 在 3 turns、5 个 task actions 后同样以
  `length` 结束；仍只到达邮件读取，score 0，finding/decision/effect 为 0/0/0。
- `runs/officebench-excel-batch-2-49-0-smoke-1` 正确通过、score 1.0，但 8 次
  `excel.set_cell` 全部在同一个 assistant response 并列发出；finding/decision/effect 仍为
  0/0/0。即使能力已披露，下一请求才生效的 mutation 对该轨迹也已经太晚。

因此最初 `2-44-0` 的跨 response 写入模式不是稳定可复现的收益窗口；机械正向 fixture 也不能
替代 autonomous mediator。继续加入 reminder、自动 finding、默认 apply 或 runner 候选控制器
都会违反 Agent-owned research 和 Pi-only harness 边界。`excel_batch_action` 的 runtime、catalog、
bridge、fixture 与测试代码已全部撤除，只保留真实 runs 与本节作为反证。不再运行缺少
finding/apply mediator 的 paired ablation，因为两臂差异无法归因于 self-harness，只会增加
实验成本。

该实验进一步收紧后续 admission rule：新增 Pi-native capability 之前，必须先由多条真实 trace
证明存在稳定的、位于未来模型请求中的、无反馈依赖 work units；随后仍需观察真实 Agent 自主
形成 finding/apply，才进入 correctness-gated paired 验证。否则应接受 no-research/no-mutation，
而不是用外围机制制造闭环。

### 3.45 `learning_signal` 的隔离消融与撤除

现有完整 treatment/control 实验不能回答可选 `learning_signal` 注释本身是否有价值，因为
control 同时移除了 Auto-Research、finding/decision tools 与 Pi-native surface mutation。
为隔离该字段，曾短暂给离线 paired/cohort runner 增加 `learning_signal` comparison：两臂都
运行完整 treatment，只在进程启动前切换该字段是否出现在 `research_resource` schema；每个 arm
仍使用 fresh Pi process 和 fresh OfficeBench workspace，顺序按 repeat 交替。该开关不进入
Agent control plane，也不改变 task tools、finding、decision、exposure 或 effect assessment。

两个不同任务、共 8 个真实 JIT runs 给出一致反证：

- `runs/learning-signal-ablation-2-13-0-r1`：without/with 两臂均 2/2 正确、score 1.0，4 条
  轨迹中的 finding/decision/effect 与 `learning_signal` 均为 0。with arm 相对
  without arm 的 bridge deltas 为 -10、-8，但没有任何研究或 mutation mediator，不能归因于
  注释。
- `runs/learning-signal-ablation-3-6-0-r1`：without/with 两臂均 2/2 正确、score 1.0，4 条轨迹
  同样全部为 0 finding/decision/effect/`learning_signal`；bridge deltas 为 0、+1，没有一致
  性能方向。

合计 8 条独立真实轨迹中，注释 uptake 为 0。此前
`runs/paired-2-13-0-learning-signal-r4` 虽有 2/4 treatment 写过该字段，但 3/4 treatment 的
supported batch effect 并不依赖它，且没有 annotation-only 正向差异。因此该字段既未提高
research finding 的形成概率，也未为已经由 evidence refs、immutable finding version、
`decision_id`、Pi exposure 和 effect assessment 表达的因果链增加可验证行为价值。

按最小性与重复失败撤除门槛，`learning_signal` 已从 OfficeBench Agent instruction、TypeBox
schema、finding state、context digest、inspection projection、Python validation/summary 和
Shopping 聚合投影中删除。用于这次一次性检验的 comparison 参数与 CLI 开关也随之删除，避免
为已不存在的机制保留永久实验 API。真实 run 和本节保留为反证。Installed-Pi 负向测试直接
读取模型请求中的真实 `research_resource` schema，锁定该字段不再暴露；核心
observation → finding/version → Agent apply/keep → Pi-native exposure → bounded effect →
Agent absorption 链保持不变。

撤除后的真实 smoke `runs/post-learning-signal-removal-2-13-0-smoke-1` 正确通过、score 1.0，
6/6 required calendar artifacts 均发生变化；4 turns、25 bridge processes。12 次 calendar create
和 12 次 verify 分别集中在单个 assistant response，finding/decision/effect 仍为 0/0/0。该结果
证明 schema 收缩没有损害任务执行，同时再次确认这个轨迹的 direct parallel calls 对 Agent
已经足够便宜；不应把 no-finding 当成需要提示修复的失败。

### 3.46 真实 OfficeBench 撤除弱 evidence-policy primitive

独立 `meta-harness-demo` 中的 `set_evidence_policy` 仍可证明 extension-local 状态经过 Pi context
hook 被后续请求观察，但它只改变指导文本，不能承担真实 benchmark 的行为优化验证。真实
OfficeBench extension 已经停止注册该工具；本轮进一步删除 Python summary、outcome 和
self-harness handoff 中遗留的 evidence-policy 事件计数、before/after/observed 值与
`guidance_in_next_model_context_not_backend_enforcement` 声称。真实 runtime 现在只把
`execution_tool_surface` / `pi.setActiveTools()` 计作 Pi-native harness mutation。测试 provider 的
默认 OfficeBench fixture 也不再调用已删除工具；独立 demo 的 extension 与机械通路测试未改。

TDD 先把三条旧测试改成真实行为契约，当前代码因仍返回 evidence-policy 顶层字段而 3/3 失败；
最小删除后同三条 3/3 通过。随后 installed-Pi、OfficeBench runner 与独立 meta demo 定向回归
为 80 passed。完整实现加入下述离线评估模块后，全量回归为 141 passed；`git diff --check`
没有 whitespace error。`set_evidence_policy` 字符串只剩 README 对独立 demo 的明确说明，不再
出现在真实 OfficeBench extension 或 runner projection 中。

### 3.47 隐藏分层 validation evidence 与跨 benchmark 真实消融

为解决 sparse evaluator 不能区分“高收益任务没有触发”与“低收益任务正确 no-change”，新增
`src/autoresearch_pi/validation_evidence.py`。它是纯离线投影：只消费已结束 pair 的 control / treatment
summary 和 runner-only 预注册标签，分别输出 correctness gate、Agent posture、mediator chain、
correctness-gated effect 与 paired cost delta。它不读取任务 prompt、不扫描 run 推断候选、不创建
finding、不推荐或应用 capability，也不把结果写回 Pi。未知 stratum/hypothesis 和包含额外
`recommendation` 等字段的 manifest fail closed。`harness_improvement` 与 `causal_claim` 继续保持
`not_established` / `not_automatically_established`。

预注册集合保存在 `experiments/constitutional-validation-v1.json`，当前只包含三个描述性 strata：
`future_independent_work`、`low_next_request_benefit`、`feedback_dependent`；标签只在父级 runner
pair 完成后使用。OfficeBench cohort 与 Shopping experiment 均通过可选
`--validation-manifest` 启用，因此不带 manifest 的旧路径构成 evaluator-only ablation。纯投影
RED 先以 8 条 `NotImplementedError` 失败，最小实现后 8 passed；manifest、两类 runner 与两类
CLI 的独立 RED/GREEN 完成后，相关 Python 定向回归为 102 passed。两个新的 installed-Pi
长任务压力测试还预置 7 个超出 context digest 容量的 findings 和一个旧 applied decision：
OfficeBench、Shopping 均能由 Agent 显式按 `finding-1` inspect 最旧 canonical record，同时新
process 从 baseline surface 启动，2/2 passed。因此没有增加分页、自动 relevance ranking、
working-set controller 或跨任务 memory。

真实 JIT conda smoke 与 pair 使用 `D:/anaconda/envs/jit/python.exe`：

- `runs/constitutional-v1-office-3-6-smoke-1`：Level-3 `3-6-0` 正确通过、score 1.0；5 turns、
  20 bridge，0 finding/decision/effect。12 次 email send 分布在两个 response，其中 11 次集中在
  一个 response；只剩 1 个未来 send，不满足 next-request batch 资格。
- `runs/constitutional-v1-office-2-15-smoke-1`：`2-15-0` 正确通过、score 1.0；6 turns、25
  bridge，0 finding/decision/effect。21 次 Excel writes 全在一个 response，且当前保留 capability
  不覆盖 Excel；no-change 合法。
- `runs/constitutional-v1-shopping-3-2-smoke-1`：Shopping Level-3 case 2 正确通过，4/4 商品、
  2/2 coupon、无额外商品；11 turns、29 bridge、102155 model-visible observation chars，0
  finding/decision/effect。4 次商品写入同一 response，coupon 跨 response 但有反馈依赖。
- `runs/constitutional-v1-office-cohort-r1`：`3-6-0` 与 `2-15-0` 各一组 paired，control/treatment
  4/4 均正确。隐藏投影把 `3-6-0` 的 `apply_if_supported` 标为 `not_observed`，所以不能把
  treatment 的 -2 turns/-1 bridge 归因于 harness；把 `2-15-0` 的正确 no-change 标为
  `supported`。两 pair 平均 delta 为 -1.5 turns、-0.5 bridge，但仍无 mediator。
- `runs/constitutional-v1-shopping-cohort-r1`：Level-3 case 2 两臂均 score/case_score 1.0，task
  prompt hash 一致。treatment/control 为 16/14 turns、52/37 bridge、176670/104381 visible chars；
  两臂均 0 finding/decision/effect。投影把反馈依赖场景的 no-change 标为 `supported`，同时保留
  +2 turns/+15 bridge 成本，未将其解释为 self-harness 效果。

对已完成真实目录进行只读 post-hoc projection ablation：OfficeBench nested pair 的 91 个文件及
Shopping pair 的 23 个文件在启用/禁用投影前后 SHA-256 集合完全一致；在三个 task 子目录中
搜索 manifest stratum、hypothesis 和 fingerprint 均无命中。新增模块因此确实改善了失败/成功
信号的分类可见性，但没有改变 Agent 执行条件，符合 runner 仅隔离、评估、聚合的边界。

本轮没有建立新的 autonomous Auto-Research + self-harness 正向效果：三个 treatment smoke 和
三组新 pair 都没有 finding/apply mediator。尤其 `3-6-0` 的历史高收益闭环在当前模型轨迹中不再
稳定出现，而低收益/反馈依赖任务中的 no-change 是应保留的正确结果。根据 admission rule，当前
没有 case 同时满足“真实观察先发生、至少两个独立 future work units 尚未执行、现有 capability
覆盖、Agent 自主形成 finding/apply”，因此不追加重复 paired 消耗，不新增 reminder、自动 finding
或候选 controller，也不打 tag、不 push。Shopping 单 pair 中 treatment 的额外上下文/探索成本是
下一轮需要重复隔离验证的风险，单样本不能据此撤除整个研究 surface。

### 3.48 Agent-owned observation context compaction：机械闭环与真实 smoke 前置门槛

Shopping 的多条真实轨迹已显示 100k–176k model-visible observation chars；此前 Level-2 case 11
在超时前调用了 17 次 full `get_product_details`。这属于 `shopping_batch` 无法覆盖的历史 context
成本。为避免 runner 代替 Agent 判断 relevance，本轮没有恢复已撤除的 selective details、exact
dedup，也没有增加自动总结、语义排序或 working-set controller，而是增加一个默认关闭的独立
Pi extension 模块 `demo/pi_agent_owned_observation_compaction.ts`。

只有实验显式启用后，真实 Pi Agent 才能看到 `compact_observation_context`。该 tool 要求当前
active finding 的精确版本，并且每个 observation ID 必须已被该 finding 的 `evidence_refs` 引用；
runtime 不选 observation、不创建 finding、不总结正文。Agent apply 后，Pi 官方 `context` hook
只在下一 model request 把选中历史 tool-result 正文替换为 deterministic canonical reference；
`execution-observations.jsonl` 保持完整，未选 observation 保持原样，不跨任务恢复。暂定每个隔离
任务最多一个 selection，以免在没有真实需求前引入 overlapping-intervention manager。

Installed-Pi TDD 的 RED 证明旧 runtime 在 Agent 调用后仍把完整 `shopping-observation-1` 送入
下一 provider request。最小实现后的 GREEN 同时证明：只选中的 observation 被替换；另一条
observation 的 content byte-identical；canonical 两条结果都保留完整商品字段；并形成 finding v1
→ decision → `pi.context` exposure → `model_visible_observation_chars_removed` assessment → resolved
finding v2。新的纯离线 `observation_compaction_evidence.py` 从 provider context 或真实 run 已增量
落盘的 Pi tool-result event 重算字符差，拒绝 finding 未引用的 observation 和伪报的字符数。它不
进入 Agent context，也不写回 runtime。

CLI 新增单 run 开关 `shopping-e2e --context-compaction`；省略时 runner 明确传入 disabled，避免
继承环境污染。这提供了机制级消融边界：后续 paired 两臂都保留 Auto-Research、finding tools 与
`shopping_batch`，只改变 context compaction 是否可用。随后补齐了两个不可省略的事实边界：
Agent 可通过 `research_resource(action=inspect, observation_id=...)` 显式恢复完整 canonical
observation；同时运行中的 batch/context decisions 从各自 immutable `decision_id` 派生不同
assessment ID，不需要 intervention manager。Shopping summary 新增紧凑 closed-loop projection，
直接展示 finding basis、native operation、exposure、assessment 与 absorption，但大型 observation
正文只保留在 canonical JSONL。Runner 还独立聚合 provider-reported model input/output tokens 与
request count，供后续 paired 性能比较。加入专用 ablation runner 后，focused Shopping/CLI 回归
为 53 passed，全量为 153 passed（80.21 秒），`git diff --check` 无 whitespace error。

原计划运行 `runs/context-compaction-shopping-l2-11-smoke-1`，但进程创建前的外部授权审查服务
返回 HTTP 503，真实 benchmark 没有启动。因此目前只有机械闭环，没有 autonomous uptake、
correctness-gated 正向收益或 paired causal evidence；不打 tag、不 push。详细契约与撤除门槛见
`docs/plans/2026-09-09-agent-owned-observation-context-compaction.md`。

为防止后续用整套 treatment/control 差异冒充该机制的收益，又新增专用
`shopping-context-ablation` runner。两臂均固定为完整 Shopping treatment runtime，只分别关闭/
打开 `agent_owned_observation_compaction`；每臂使用 fresh Pi process 和 cart，按 case/repeat 交替
顺序并增量原子写父级 summary。独立 RED 先因 runner/CLI 不存在而 2/2 失败，GREEN 2/2 通过，
并验证两臂 task prompt hash 相同、Agent runtime variant 都是 treatment、唯一调用参数差异是
`context_compaction`、模型 input token delta 与 independently recomputed removed chars 分开记录。
父级继续固定 `harness_improvement=not_established`、
`causal_claim=not_automatically_established`。

真实验证集预先收敛为 Shopping Level-2 case 11（主要高 context opportunity）、Level-1 case 22
（semantic shortcut/correctness gate）、Level-3 case 2（feedback-dependent no-change calibration），
以及 OfficeBench `3-6-0`/`2-15-0` 的跨 benchmark leakage/no-change 回归。只有真实 Agent 在有
未来推理收益的时点自主形成 finding/apply 才进入重复 pair；三条 eligible trace 均无 uptake 时
撤除模块，不增加 reminder、task-specific recommendation 或自动 finding。
