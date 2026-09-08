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

## 6. 下一阶段目标

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

### 3.10 最小持续性修正：actionable connection 与 exposure gate

没有引入 `causal_span_id`、intervention ledger、多窗口 manager、capability registry 或新的 summary 层。现有 `decision_id` 已能连接 finding version、Pi exposure、effect assessment 和 research absorption；增加第二套关联抽象不能促使 agent 继续闭环，反而会增加协议与维护成本。

为降低高收益候选停在 `candidate_seen_no_finding` 的概率，现有一次性 `decision_support` 卡片新增 `one_step_if_worthwhile`：当 agent 判断 observation 已足够且 remaining work 达到明确 break-even（calendar 3、email 4）时，可用一次 `research_resource action=record + continue_with` 同时留下 finding 和 apply/keep decision；否则明确允许直接继续，不研究、不修改。系统提示同步使用卡片披露的 break-even，删除原先“至少两次”与成本模型不一致的表述。该改动只缩短 observation→finding 的推理距离，不自动创建 finding。

Effect collection 新增 exposure gate。`pi.setActiveTools()` 只影响下一模型请求，因此同一 assistant response 中与 decision 并列发出的旧 surface action 不再消耗 observation horizon；只有现有 context hook 已记录 `observedSurfaceCalls` 后的相关 task action 才进入 window。这避免 window 在真实调整尚未对模型可见时提前生成 `inconclusive`，直接保护后续 effect→research absorption 链路。离线真实 Pi provider 测试覆盖一个 response 内先 apply 再 action、下一 request 再 action的边界。
