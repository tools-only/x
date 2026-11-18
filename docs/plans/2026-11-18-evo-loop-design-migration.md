# Codex 与 Claude Code 设计迁移开发方案

目标分支 `evo-loop-implementation`。基线为指定 worktree 当前代码，包括未提交改动。自进化与运行时方案均区分通用机制和任务扩展：机制定义不依赖 PPT、ARC 或其他单一领域；adapter 仅接入领域输入、工具和状态。PPT 可作为一个消费者验证，但不是机制的定义来源。历史 M9c/M10 用于追溯实验，不作为实现基线。

现有真实轨迹中，BoA 三场演化共 21 个 specialist 回合，13 个成功热修改，8 个 `execution_incomplete`。`figure_gate` 修改后被调用三次。JPM 输入见到修改版本，但运行被 provider 无事件超时打断。首要命题是创作指导能降低选错修改位置和执行未完成的成本，同时保持合理的 `no_change`。现有轨迹不能把八次未完成归因为 Prompt 质量。

## A. 自进化设计参考

### 文件与装配

直接扩充 `demo/self_root.ts` 中 `META_PASS_SPECIALISTS` 的七条 `description`。每条合并检查对象与创作方法。现有 `reviewStrategy()` 在当前方向附上 description、`WRITE INTERFACE`、本请求阶段和关闭协议。`ppt_demo_extension.ts` 已把它送入请求范围内的 `self-view` 尾消息。由此每轮只呈现当前方向的完整指令，无须增加文件、字段或加载路径。

第一轮、普通任务、其它 specialist 均看不到当前段落。当前方向的后续请求可重复看到同一段落。既有请求数、关闭和激活协议继续生效。七条合并文案已写入当前工作区。评估时可单独回退某条 description，与原文比较。

以下英文是设计方法的原始草稿。当前生效候选为 `META_PASS_SPECIALISTS.description` 中的合并文案，包含检查对象与方法。具体执行协议由 `META_PASS_STRATEGY`、`META_PASS_ROUND2_LINE`、请求阶段文案和 `WRITE INTERFACE` 共用，避免在每条 description 中重复。

### Prompt

```text
Inspect one failed decision and the instructions actually visible in its request. Identify the missing goal, constraint, or observable completion criterion, if any. Put the smallest useful correction in the narrowest prompt that applies to the affected decisions. Phrase completion in terms of a result the acting agent can check. Keep an instruction resident when it is needed in ordinary decisions across that scope. For a conditional procedure, check whether an existing skill already supplies it. If the instruction was visible and the tool did not supply the necessary evidence, record that distinction in the outcome for the relevant focus. Use an evidence-based no_change when no prompt defect is supported.
```

### Context

```text
Identify the next decision and the facts it depends on. Inspect the recorded request composition and locate the first point at which a necessary fact is missing: source availability, selection, assembly, or compaction. Keep current authoritative state, decisive counterevidence, and the open decision directly visible when needed. Keep large supporting material behind exact references the acting agent can resolve. Change policy.context only where a selection or presentation change can repair the gap. Judge the change by the next decision and the cost of recovering evidence.
```

### Skill

```text
Find a recurring procedure or a costly procedure that is needed only in a recognizable situation. Check existing skills for overlap. Write a description that identifies the trigger and distinguishes a plausible non-use case. Write the body as a procedure with inputs, ordered actions where order matters, observable outputs, and a recovery path for an ordinary failure. Put long examples and reference data behind links that can be read at the relevant step. Diagnose whether a failed attempt came from discovery, invocation, or execution before deciding which part to edit.
```

### Tool

```text
Locate the exact operation or query that existing tools could not express or reliably verify. Give the tool a narrow purpose, task-language inputs, and a result that separates execution from verification. Return the authoritative receipt or evidence reference and an actionable error when appropriate. Check whether a skill can already compose existing calls at acceptable cost. Keep runtime permission and validation boundaries in the host. Judge a change by a real caller obtaining a correct result and being able to act on it.
```

### Subagent

```text
Choose an independently answerable question whose result could change the parent's next decision. Define the necessary inputs and their exact references, the permitted work, and a stopping condition. Ask for the conclusion, supporting evidence, and the uncertainty the parent still needs to resolve. Keep detailed working evidence available by reference. Preserve the question and open work across separate executions when continuity matters. Compare delegation with solving the question directly using combined parent and child effort.
```

### Memory

```text
Identify information that an agent will need again and how it would recognize the situation. Separate observed facts, inferences, and counterexamples. Record provenance, applicability, and a condition that would make the information stale. Keep unfinished task state in the continuation state. Revise existing memory when the evidence changes its scope or conclusion. Judge usefulness by a later applicable decision and check that a similar but out-of-scope task does not treat it as a fact.
```

### Loop

```text
Find a recorded transition that wasted effort, delayed an action, or ended work before the completion evidence was available. State the observable condition that should trigger a different next step. Define the action, where control returns, and when to stop. Reuse existing states and transitions where possible. Count additional requests, waits, and management turns. Apply the smallest orchestration change that addresses the observed transition.
```

设计来源为 [Codex Skill 评估](https://developers.openai.com/blog/eval-skills)、[Claude Code Skill 加载](https://code.claude.com/docs/en/skills)、[Claude Code 子 Agent](https://code.claude.com/docs/en/sub-agents)和[Claude Code Memory](https://code.claude.com/docs/en/memory)。这些段落是本项目拟采用的 Prompt，适配已有反射接口与请求边界。

## B. 运行时工程迁移

上游链接定位到公开实现模块或公开接口规格。表中标注迁移粒度。Claude Code 链接是可查的行为规格，本文未取得对应产品内部实现。Codex 使用 `main` 源码入口，实施前在变更记录固定实际采用的源码修订和许可证出处。现阶段按行为移植规格与回归用例，具体 Rust 函数是否复用取决于它能否脱离 Codex 的会话与 provider 类型。

| 小项 | 上游位置与取用内容 | 本分支具体改法与验收 |
|---|---|---|
| 压缩入口 | Codex [`tasks/compact.rs` 的 `CompactTask::run`](https://github.com/openai/codex/blob/main/codex-rs/core/src/tasks/compact.rs)，参考准备上下文、检查预算和错误归属。Claude Code [Hooks 的 PreCompact/PostCompact](https://code.claude.com/docs/en/hooks)供事件边界对照。 | 通用 Pi 生命周期接线位于 `demo/pi_compaction_adapter.ts`：分派压缩前策略、意外压缩处理和压缩后恢复事件。具体 summary 格式及记录由 task adapter 注入。PPT 是一个接入方，不是机制实现。 |
| 有效历史替换 | Codex [`compact.rs` 的 `build_compaction_replacement_history` 与 `CompactedHistoryMetadata`](https://github.com/openai/codex/blob/main/codex-rs/core/src/compact.rs)，取已保存历史与有效投影一致这一不变量。 | `demo/runtime_continuation_store.ts` 提供版本化 task-neutral 状态、精确版本读取与 evidence ref；`demo/pi_runtime_continuation.ts` 可在 `before_agent_start` 将所选 continuation 和可解析证据装入下一请求。`demo/pi_runtime_layer.ts` 提供统一安装入口。未验证生产 session 的压缩恢复连续性；注入内容会改变模型输入，但无需 Agent 发起管理调用。 |
| Memory 持久化 | Codex [`state/src/runtime/memories.rs` 的 `MemoryStore`](https://github.com/openai/codex/blob/main/codex-rs/state/src/runtime/memories.rs)及[读写分层说明](https://github.com/openai/codex/blob/main/codex-rs/memories/README.md)，取可追溯源版本与派生材料分离。 | `demo/runtime_memory_store.ts` 提供 task-neutral 版本、provenance、scope、乐观版本校验和归档；`demo/pi_runtime_memory.ts` 将操作日志写入 Pi custom session entries，宿主 API 可搜索/读取/写入。Custom entries 不进入模型上下文。当前仅在 Pi session 内持久，未接管 `SelfRoot` 成为唯一 Memory 真值，也不改变当前选中 Memory 的正文投递。 |
| Memory 查找 | Claude Code [Memory 入口文件与主题文件](https://code.claude.com/docs/en/memory)，取小索引与按需读取详情。 | Core 的 `search()` 仅返回精确 id/version、scope 和有界 preview；`read()` 才返回完整内容。SQLite 仍不引入，进程内实现不解决跨进程检索。 |
| 组件可见性 | Claude Code [Skill content lifecycle](https://code.claude.com/docs/en/skills)和 Codex [Skill 触发与执行评估](https://developers.openai.com/blog/eval-skills)，取描述发现与正文按需读取。 | 已有 `arc_thin_binder.ts` 的版本/装配/恢复，`pi_context_adapter.ts` 的请求上下文选择，`pi_task_harness_assembly.ts` 的 task-harness装配与生命周期记录；这些是现成机制但多为 ARC/task-local。暂不重复造通用 manager。仍缺跨任务的统一调用接口与消费语义证据；本文本不宣称已完成。 |
| 子会话与交付 | Codex [`agent/control/spawn.rs`](https://github.com/openai/codex/blob/main/codex-rs/core/src/agent/control/spawn.rs)定位独立子会话创建。Claude Code [Subagents](https://code.claude.com/docs/en/sub-agents)定位上下文隔离、返回及恢复行为。 | 现有 `pi_task_local_subagents.ts` 提供独立 Pi 子进程、context recipe、预算、structured report、evidence refs、length/恢复路径；它仍是 task-local adapter，不是通用迁移完成。下一步只抽取不含任务语义的 spawn/lease/report 协议，并复用现有进程生命周期。 |
| Loop 中断与恢复 | Codex [`core/src/tasks/mod.rs`](https://github.com/openai/codex/blob/main/codex-rs/core/src/tasks/mod.rs)定位任务生命周期和中断；[`session/handlers.rs` 的 `shutdown_session_runtime`](https://github.com/openai/codex/blob/main/codex-rs/core/src/session/handlers.rs)定位停止接纳与收尾顺序。 | `SelfRoot` 已有可导出/恢复状态、pending activation abort、reset interrupted receipts、task end 与 Pi shutdown hooks。尚无统一可持久化的 task-neutral loop transition store/idempotency contract；下一步在 session owner 复用这些边界，不另造研究调度器。 |

## 实施和验收

1. 冻结当前工作区快照与通用 fixture 输入，建立机制级可重复轨迹；随后分别接入不同 task extension 验证边界。收集实际请求组合、反射与激活回执、关闭原因和结果验证。
2. A 类先单独比较 Prompt 方向的合并文案与原文。正例给出缺少验收判据的已知失败，负例给出判据可见但证据来自错误工具的失败。对照同任务、同模型和相同上限。正例检查修订是否进入后续任务请求并被使用，负例检查是否合理 `no_change`。比较执行未完成、额外请求、任务结果和总成本。其余方向分别评估正负例。
3. B 类从通用 compaction lifecycle adapter 起步，检查策略分派、意外压缩拒绝和恢复事件；再用两个不同 task extension 检查 continuation 数据可达性、权威状态、反例保留及下一步决策。只实现证据支持的断点。随后按组件装配、Memory、子恢复与 Loop 的通用缺口排程。
4. 角色责任沿用现有流程。Agent 识别机会、判断投入、创作并决定是否继续使用。宿主负责 revision、装配、预算和事实记录。开发侧依据有无参考的对照决定保留或修订指南。合理不使用和有理由放弃作为实验结果记录。
5. 变更记录分别报告功能正确、真实链路可达、自主采用与净收益，并附 provider、运行环境和产物。Pi scripted runner 仅证明所接 adapter 的接线。自主采用和收益需要真实 provider 对照，事先固定预算并计入父子成本；不启动付费运行。涉及 ARC 全闭环主张时，按项目要求跑 `arc-harness-smoke` 的五组件语义使用、两类委派 `length` 续跑及动作后的父轮。

## 本次实现记录

本轮迁移状态快照（2026-11-18）：A 类七方向的创作指导与执行协议已写入现有 META pass 请求；B 类通用压缩事件 adapter、Memory Core、Continuation Core 与 exact-version prompt assembler 已实现为实验性原语。它们尚未进入统一 session owner，因此不计为已完成的 Runtime 底座迁移。已有 ARC/task-local 路径只作为边界和复用证据，不等同于新通用 Runtime Core。

- 真实机会：压缩 hook 与 continuation policy 混在 `ppt_demo_extension.ts` 中，事件接线无法复用；观察来自当前实现，不宣称已有跨任务故障样本。
- 窄命题：独立的 Pi lifecycle adapter 能在不知任务领域的条件下，将压缩前、意外压缩和恢复事件准确交给 policy，降低 task extension 与 Pi 生命周期绑定。
- 减少的负担：后续扩展无需复制生命周期事件注册；PPT 侧保留领域摘要和账本行为。
- 范围与非目标：仅抽取 Pi hook 生命周期分派并保留现有 task adapter policy；不把任何领域任务内容写入核心，不启动付费 provider。Memory、continuation、subagent 和 loop 的通用接线另按上表实施，不以本 adapter 测试冒充完成。
- 验收：`tests/pi_compaction_adapter.test.ts` 覆盖策略处理、意外压缩和恢复；随后对现有扩展执行 Node 测试检查。此处未证明 Pi 实际 provider 压缩行为、跨 extension 复用、模型自主采用或净收益。

本轮改动与上述窄命题一致；其它运行时迁移仍是设计方向，未实现。具体功能/接线检查结果见本次交付。

### Runtime Layer 增量：Pi session adapters

- 实现：`demo/pi_runtime_layer.ts` 统一安装通用 compaction lifecycle adapter 与 continuation adapter，并提供 Memory session API 和 Continuation `save()` 宿主入口；`demo/pi_runtime_memory.ts` 将 Memory 版本和归档操作追加至 Pi custom entries，读取时从 session 日志重建 store。
- Agent 可见性：没有注册模型工具、增加 Prompt 管理要求或更改现有工具 schema。Pi custom entries 不随请求发送；Memory API 由宿主扩展调用。Continuation 仅在存在保存记录时注入下一请求，因此会改变模型输入内容，但不增加 Agent 管理调用。
- 持久性边界：Pi session 日志仅覆盖该 session，不能跨 session 检索；Memory API 尚未接管 `SelfRoot` 写入，当前仍有既有 Memory 数据源。各任务扩展仍需显式安装通用 layer；本分支没有单一的 production session owner 可统一接线。
- 验证：本轮未运行测试或真实 provider。代码修改不能证明真实 Pi lifecycle 可达、continuation 语义连续或总负载下降。下一步需先确定共同 session owner 和唯一持久层，再接管现有 Memory writer，避免并存两份长期真值。

### Runtime Core 当前状态：continuation prompt assembly

- 机会：Continuation 记录已可版本化，但单有 snapshot/ref 不保证下一次模型输入能获得精确状态及引用证据。
- 窄命题：针对指定 run/version，Core 能以 task-neutral 结构返回 continuation state，并逐项解析 evidence refs；不能解析的引用标为 unavailable，不补造内容。
- 范围：`RuntimeContinuationStore.preparePrompt()` 已支持调用方明确选择版本并提供 evidence resolver。它仍未接入 Pi 消息、session owner 或 provider request，也不自动把历史/记忆注入提示；因此是待接线原语而非已迁移的底层机制。
- 验证：`tests/runtime_continuation_store.test.ts` 覆盖精确状态、可读/缺失证据、未知 run；功能正确通过。下一步真实接线需要由通用 session owner 持有 store 并在实际 provider request 前组装 payload，先确认 store 是否可绑定现有 Pi session lifecycle，避免为本 API 增加第二套持久层。
- 证据边界：只证明 payload 组装函数功能正确，未证明数据进入 provider、压缩恢复连续性、语义使用或净收益。

### Runtime Core 当前状态：Memory store

- 机会：当前通用 component history 保存组件源码版本，`SelfRoot` 已有 task-local memory 的版本、范围、选择和上下文投影；新增 store 不能成为第二份 Memory 真值源。
- 窄命题：一个不依赖任务 schema 的进程内 MemoryStore 可提供版本、来源、scope 与按需读取，使消费者能检索短引用而非默认展开正文。
- 范围：`demo/runtime_memory_store.ts` 与测试只验证版本化、来源和按需索引原语；当前不接入 SelfRoot、不改变 task prompt、不增加 SQLite 或自动索引/注入。下一步必须先把现有 SelfRoot/native memory writer 作为唯一持久化入口，再决定该原语合并、复用或撤下。
- 验证：`tests/runtime_memory_store.test.ts` 覆盖版本读取、版本冲突、scope、有限 preview、retire 和 snapshot/reload；与 compaction/context adapter 测试合跑。
- 证据边界：仅证明进程内 store 的功能正确。没有证明 Pi 路径可达、跨进程持久性、真实 Agent 检索/采用、跨压缩认知连续性或净收益。
