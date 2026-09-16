# 当前研究资源在 Agent 视角中的位置

## 结论

当前研究资源不是 `.md` 知识库或 Pi skill，也不直接改写稳定 system prompt；但活跃 research goal/finding 已由 Pi `context` hook 以短摘要投影到后续模型请求。

从 Agent 视角看，它主要是：

> 由 Pi tools 修改、以 JSONL 保存权威状态，并由 Pi context hook 投影活跃摘要的 task-local 研究资源。

因此，当前实现更准确地属于 **tool-mediated task-local research state**。它为未来的 self-harness 提供研究与状态基础，但本身还不是完整的 self-harness。

## “研究资源”实际包含什么

此前“研究资源”这个名称混合了两类不同对象。

### 1. 可查询的探索证据

这类资源来自任务执行过程，例如 ARC 的帧变化、动作、关卡推进和重复行为。

- 物理来源：`bridge-events.jsonl` 等执行日志。
- Agent 入口：Pi extension 注册的查询工具。
- ARC 示例：`inspect_arc_trajectory`。
- 模型可见时机：Agent 调用工具后，查询结果作为 tool result 进入当前对话上下文。

ARC 轨迹资源的实现位于 `demo/pi_arc_trajectory_resource.ts`。它只读 canonical bridge events，不推荐动作、不自动创建 finding，也不调度研究。

### 2. Agent 归纳形成的研究状态

这类资源由 Agent 在探索后主动创建或更新，包括 research goal、finding、harness decision 和 effect assessment。

| 资源 | 物理存储 | Agent 如何访问 |
|---|---|---|
| Research goal/finding | `research-resources.jsonl` | 通过研究资源工具创建、更新或读取；活跃摘要进入后续 context |
| Harness decision | `harness-decisions.jsonl` | 通过决策工具记录或读取 |
| Effect assessment | `effect-assessments.jsonl` | 通过效果评估工具记录或读取 |
| Final summary | `summary.json` | runner 收尾时生成，执行中的 Agent 通常不可见 |

JSONL 是落盘格式，不是模型直接使用的知识库界面。Agent 通常不会直接读取这些文件，而是通过 Pi tools 操作 task-local 状态。

## 完整的数据流

以 ARC treatment 为例，当前链路是：

```text
任务执行产生原始观察
        ↓
bridge-events.jsonl
        ↓
Agent 调用 inspect_arc_trajectory
        ↓
tool result 进入当前模型上下文
        ↓
Agent 自己解释和归纳
        ↓
Agent 调用 finding 写入或更新工具
        ↓
research-resources.jsonl
```

decision 和 effect assessment 使用同样的模式：Agent 调用工具，工具修改 task-local JSONL，调用结果返回当前对话。

## Finding 什么时候对模型可见

Finding 的完整记录不会每轮注入；当前活跃短摘要会进入后续模型上下文。它通过以下方式可见：

1. Agent 创建或更新 finding 时，工具结果进入当前 conversation。
2. `context` hook 投影最多三条近期活跃 finding 和最多三条开放问题，保留版本、依据引用、下一决策与不确定性等紧凑字段。
3. Agent 后续主动调用研究资源读取工具，按 ID 获取完整记录或证据。

因此，`research-resources.jsonl` 是权威状态，context 摘要是可重建视图。被 resolve、remaining_uses 为零或超出投影上限的资源不会持续占用上下文，仍可按需查询。

## 它不属于 Agent loop 的哪些部分

当前 research resources 不是：

- 自动加载的 Markdown 知识库；
- Pi skill；
- system prompt 的稳定组成部分；
- 跨任务长期记忆；
- tool policy；
- subagent topology；
- 自动改变 Agent 行为的 harness policy。

当前结构可以概括为：

```text
Pi tool schemas
  ├─ 查询任务轨迹
  ├─ 写入或更新 finding
  ├─ 记录 intervention decision
  └─ 记录 effect assessment
          ↓
task-local JSONL storage
          ↓
Pi context hook 投影活跃短摘要到后续请求
```

## 当前机制的准确边界

当前机制已经支持：

```text
探索证据
→ Agent 主动查询
→ Agent 归纳 finding
→ task-local 持久化
→ 后续短摘要自动可见、完整证据按需读取
```

新的 task-local Self-Harness 已增加可选的 memory、task-local system-prompt overlay、Pi-format skill、adapter-bounded task tool、active tool set 和 ARC read-only subagent。它们与 Auto-Research 并列，不要求 finding 作为所有修改的门票：

```text
research goal/finding 或其他 task-local 依据
→ Agent 自主选择普通行动或具体组件调整
→ Pi context / setActiveTools / skill resource / 独立 Pi subagent 改变后续执行条件
→ 原生 exposure 与后续任务观察分别落盘
→ Agent 可评估效果，并选择是否更新 finding
```

其中 task tool 不是任意代码插件：Agent 只能选择当前 benchmark adapter 声明的
implementation_ref；成功创建后由 `pi.registerTool()` 注册为当前 session 的版本化
Pi tool，更新会切换 active version，退休会移出 active set。ARC 当前只提供
`arc.public_state` 的公开状态投影，因此不会把隐藏评测状态或宿主 extension 暴露给 Agent。

后续 context 会以紧凑卡片显示 active component 的版本、依据引用和有限使用事实；
subagent 还显示累计调用数与成本。卡片是可见性和审计，不是自动推荐器或调度器。

所以当前研究资源的准确定位是：

> 研究资源是 Agent 编写、后续 Pi context 可见的 task-local 认识状态；它能为执行或 Self-Harness 提供依据，但自身不是执行策略，也不强制触发修改。

## 当前的轻量连接方式

当前没有把完整日志改造成 `.md` 并反复注入，而是让 Pi 原生上下文入口只投影短的活跃状态：

```text
Active research
- Goal: ...
- Latest supported findings: ...
- Open uncertainty: ...
- Active intervention and observed effect: ...
```

详细证据仍通过工具按需读取。这样可以实现“概要持续可见、证据按需展开”，同时避免完整研究日志占用上下文，也避免在 Pi 原生 harness 之上构建新的调度层。
