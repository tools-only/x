# Online Harness Evolution and Meta Optimization Design

## 1. Summary

本设计将 Meta Harness 定义为“对在线 Harness 过程进行全局实验设计与方法论演化的系统”，而不是一个把静态 Spec 编译成 Harness 的配置生成器。

核心对象关系如下：

```text
Meta Research State
  -> Hypothesis
  -> Controlled Online Harness Process
  -> Harness Object
  -> Rollout(s)
  -> Evaluation
  -> Attribution
  -> Methodology Evidence
  -> Updated Meta Research State
```

其中：

- `Harness Process` 是 Agent 在线读取、修改、执行、观察和修订 Harness 的完整过程；
- `Harness Object` 是该过程产生的不可变候选快照；
- `Rollout` 是使用候选 Harness 在任务、case、seed 和环境上的实际运行；
- `Evaluation` 是对 rollout 的任务结果、效率、稳定性和成本进行测量；
- `Attribution` 判断结果是否能够归因于本次干预；
- `Methodology Evidence` 是跨多个过程和 rollout 提炼出的、带验证范围的方法论经验；
- `Meta Research State` 保存全局历史、候选谱系、比较结果和下一轮搜索空间。

当前 `Spec -> Harness` 机制保留为 Kernel 的低层实现能力，但不再作为 Meta 的主要思维模型。Meta 的主要职责是选择父 Harness、设计受控干预、触发在线过程、组织 rollout、分析历史并提出下一轮假设。

## 2. Problem Definition

### 2.1 当前模型的问题

把 Harness 表达为一个完整 JSON Spec，并把流程理解为：

```text
Meta 生成 Spec -> Kernel 编译 Harness -> 运行 Harness
```

会产生三个问题：

1. 在线 Agent 修改 Harness 的过程被隐藏在静态配置之后；
2. Meta 难以表达“从哪个版本出发、允许改哪些内容、改动幅度多大”；
3. 运行结果、版本差异、过程轨迹和方法论结论没有形成一等数据结构。

这会把真正的研究对象错误地缩减成一个配置文件。

### 2.2 正确的研究对象

Meta 实际优化的不是单个 Harness 文件，而是：

```text
如何触发更有效的在线 Harness 过程，
让过程产生更好的 Harness Object，
并从多次过程的结果中提炼可重复的方法论。
```

因此，Meta 的优化状态必须包含完整的候选历史和运行历史，而不能只保留一个 current Harness。

## 3. Design Principles

### 3.1 Process-first

在线 Harness 过程是实验单位。文件修改、工具调用、测试、失败恢复和最终提交都属于过程证据。

### 3.2 Object-after-process

Harness Object 是过程结束后捕获的不可变结果，不是过程本身。Object 必须记录其 parent、修改范围和生成过程。

### 3.3 Meta-global, Task-local

Task Agent 只负责当前任务过程中的局部决策；Meta Agent 面向全部 Harness Process、Object、Rollout 和 Evaluation 做全局比较。

```text
Task Agent: 当前状态 -> 下一步行动
Meta Agent: 历史谱系 -> 下一项实验
```

### 3.4 Controlled diversity

候选需要有差异，才能探索不同方向；差异又必须受控，才能比较和归因。系统通过 parent、变更范围、距离预算、固定条件和重复 rollout 同时满足这两个要求。

### 3.5 Evidence before methodology

一次运行只能提供局部证据。只有经过重复、对照和范围确认的结果，才能进入高层方法论库。

### 3.6 Immutable execution, mutable research

研究状态可以演化；已发布的 Harness Object、Rollout 和 Evaluation 不可修改。新的研究必须从已有 Object fork 或创建 successor。

## 4. Object Model

### 4.1 Harness Object

Harness Object 是可运行 Harness 的不可变快照，内容可以包括 policy、prompt、skills、memory、loop、tools、subagents 和 runtime 配置。

```json
{
  "kind": "harness-object",
  "object_id": "sha256:...",
  "parent": "sha256:...",
  "family": "harness-family:task-agent",
  "source": {
    "workspace": "sha256:...",
    "process": "process-..."
  },
  "components": {
    "agent.policy": "sha256:...",
    "agent.loop": "sha256:...",
    "agent.skills.strategy": "sha256:...",
    "environment": "sha256:...",
    "evaluator": "sha256:..."
  },
  "invariants": {
    "same_environment": true,
    "same_evaluator": true,
    "same_budget": true
  },
  "created_by_process": "process-..."
}
```

它回答：

> 这个候选 Harness 到底是什么、从哪个版本来、包含哪些组件、是否满足运行边界？

### 4.2 Harness Process

Harness Process 是 Agent 在线操作 Harness 的完整轨迹。

```json
{
  "kind": "harness-process",
  "process_id": "process-...",
  "parent_harness": "sha256:...",
  "objective": "Improve recovery after failed tool actions.",
  "allowed_scope": {
    "paths": ["agent/skills/recovery.md", "agent/loop.md"],
    "max_changed_files": 2,
    "max_diff_lines": 120,
    "forbidden": ["evaluator", "environment", "score"],
    "max_tool_calls": 40
  },
  "events": "runs/process-.../events.jsonl",
  "diff": "runs/process-.../diff.patch",
  "status": "completed",
  "result_harness": "sha256:..."
}
```

Process 记录：

- Agent 看到了哪些历史和文件；
- Agent 做了哪些修改；
- 修改顺序和工具调用；
- 中间测试和失败；
- 是否达到过程完成条件；
- 最终产生哪个 Harness Object。

### 4.3 Rollout

Rollout 是 Harness Object 在固定实验条件下的一次实际执行。

```json
{
  "kind": "harness-rollout",
  "rollout_id": "rollout-...",
  "harness": "sha256:...",
  "case": "build-pmars",
  "seed": 0,
  "environment": "sha256:...",
  "evaluator": "sha256:...",
  "budget": {
    "max_turns": 24,
    "max_tokens": 2048,
    "max_time_seconds": 3600
  },
  "execution": {
    "status": "completed",
    "evaluable": true,
    "completion_valid": true
  },
  "metrics": {
    "authoritative_score": 0.75,
    "task_completed": true,
    "tool_calls": 18,
    "tokens": 16320,
    "elapsed_seconds": 421.3
  },
  "artifacts": {
    "transcript": "runs/.../transcript.jsonl",
    "events": "runs/.../events.jsonl",
    "verifier": "runs/.../verifier.json"
  }
}
```

Rollout 只记录“在什么 Harness 上、什么条件下、得到什么结果”，不承担 Meta 的解释工作。

### 4.4 Evaluation

Evaluation 对一个或多个 Rollout 做比较和聚合。

```json
{
  "kind": "harness-evaluation",
  "evaluation_id": "evaluation-...",
  "candidates": ["sha256:base", "sha256:candidate"],
  "comparison": {
    "same_case": true,
    "same_seed": true,
    "same_budget": true,
    "replications": 3
  },
  "primary": {
    "metric": "authoritative_score",
    "baseline_mean": 0.20,
    "candidate_mean": 0.75,
    "delta": 0.55
  },
  "secondary": {
    "completion_rate": {"baseline": 0.33, "candidate": 1.0},
    "tokens_per_success": {"baseline": 22000, "candidate": 16320},
    "elapsed_seconds": {"baseline": 580, "candidate": 421}
  },
  "attribution": {
    "status": "supported",
    "confidence": 0.78,
    "confounders": []
  }
}
```

### 4.5 Methodology Evidence

Methodology Evidence 不是一个普通经验字符串，而是带证据和适用范围的结论。

```json
{
  "kind": "methodology-evidence",
  "method_id": "method-...",
  "claim": "Failure-specific recovery guidance improves completion after tool errors.",
  "intervention_pattern": {
    "target": "agent/skills/recovery",
    "change": "classify failure before retrying",
    "scope": ["tool-error", "sparse-reward tasks"]
  },
  "evidence": [
    {"evaluation": "evaluation-1", "status": "supported"},
    {"evaluation": "evaluation-2", "status": "supported"}
  ],
  "confidence": 0.78,
  "limits": ["not tested on long-horizon planning"],
  "next_tests": ["test with recovery budget unchanged"]
}
```

只有 `Evaluation` 反复支持、范围清楚且没有明显替代解释时，才能生成高置信度 Methodology Evidence。

### 4.6 Hypothesis

Hypothesis 是下一次在线 Harness Process 的实验设计，不是完整 Harness 内容。

```json
{
  "kind": "harness-hypothesis",
  "hypothesis_id": "hypothesis-...",
  "parent_harness": "sha256:...",
  "question": "Can failure classification reduce repeated invalid actions?",
  "claim": "...",
  "mechanism": "...",
  "prediction": "...",
  "falsifier": "...",
  "intervention": {
    "target": "agent/loop",
    "operator": "insert_checkpoint",
    "scope": "after_tool_error"
  },
  "rollout_plan": {
    "cases": ["..."],
    "seeds": [0, 1],
    "replications": 2
  },
  "acceptance": {
    "primary": "authoritative_score",
    "expected_delta": "> 0",
    "confirmation_required": true
  }
}
```

## 5. Meta Global State

Meta 不应只读取 `current Harness`。它需要一个全局研究视图：

```text
meta-state/
├── current.json
├── harnesses.jsonl
├── processes.jsonl
├── rollouts.jsonl
├── evaluations.jsonl
├── hypotheses.jsonl
├── methodology.jsonl
├── frontier.json
└── decisions.jsonl
```

### 5.1 Global view

Meta 每轮至少需要看到：

- Harness 版本图和 parent-child 关系；
- 每个 Harness 的组件变化和 diff 距离；
- 每次 Harness Process 的执行状态、耗时和修改结果；
- 每个 Rollout 的权威结果、可评估状态、成本和失败分类；
- 同一父版本下不同干预的横向比较；
- 已确认、已拒绝、待确认和不可评估的假设；
- 方法论证据的置信度、适用范围和反例；
- 当前 frontier：效果、成本、稳定性和复杂度之间的候选集合。

### 5.2 Local view

Task Agent 只需要看到当前 Harness Process 所需的局部信息：

- 当前父 Harness 的文件和接口；
- 当前任务和环境；
- 本次干预目标；
- 允许修改的路径和预算；
- 当前过程中的观察、测试和失败。

Meta 不能把全局历史原样塞给 Task Agent；Task Agent 也不能直接修改全局研究状态。

## 6. Meta Control Loop

### Step 1: Reconstruct global state

Meta 读取最近的 Harness lineage、Rollout、Evaluation 和 Methodology Evidence，先回答：

- 当前最佳 Harness 是什么；
- 当前最大失败模式是什么；
- 哪些改动已经测试过；
- 哪些结论只出现过一次；
- 哪些结果其实不可评估；
- 还剩哪些可区分的干预空间。

### Step 2: Select a parent and neighborhood

Meta 不一定总从 current Harness 出发。它可以选择：

- 当前最佳 Harness；
- 某个失败但诊断价值高的 Harness；
- 某个已验证方法论对应的 Harness；
- 某个用于探索的分支 Harness。

每次选择都必须记录 parent 以及选择理由。

### Step 3: Form one controlled hypothesis

Meta 从全局信息提出一个主要假设，明确：

- 修改目标；
- 修改机制；
- 允许的过程范围；
- 预期的任务结果；
- 预期的效率或稳定性变化；
- 固定的控制条件；
- falsifier；
- 终止和晋升条件。

### Step 4: Trigger an online Harness Process

Meta 触发 Task Agent 在指定父 Harness 上进行在线工作。Task Agent 可以：

- 阅读当前 Harness 文件和组件说明；
- 修改允许范围内的内容；
- 运行局部测试或探针；
- 根据反馈继续修订；
- 提交最终候选或报告过程失败。

Meta 不预先生成完整 Harness 内容，只提供：

- parent Harness；
- hypothesis；
- allowed mutation scope；
- process budget；
- required completion report。

### Step 5: Capture the Harness Object

在线过程完成后，Kernel 捕获候选 Harness Object，并记录：

- 完整内容 digest；
- parent digest；
- changed files/components；
- diff size 和 semantic distance；
- 过程轨迹和完成状态。

如果没有形成可运行候选，过程结果是 `not_evaluable`，不能直接判定 hypothesis 失败。

### Step 6: Run controlled rollouts

Meta 触发一个或多个 Rollout。比较时优先保持：

- case 相同；
- seed 相同；
- environment 相同；
- evaluator 相同；
- task budget 相同。

需要多样化时，先扩展 case/seed/repetition，再改变多个干预因素。

### Step 7: Evaluate and attribute

系统先做机械校验：

- Harness 是否正确实例化；
- Task Agent 是否完整执行；
- verifier 是否返回；
- Rollout 是否 evaluable；
- 结果是否链接到精确 Harness。

然后做比较和归因：

- primary task outcome 是否改善；
- 改善是否来自目标干预；
- 是否伴随成本或稳定性退化；
- 是否存在 provider、环境、seed 或预算混淆；
- 结果是否需要更多重复验证。

### Step 8: Update methodology evidence

Meta 将结果分类为：

```text
execution_invalid
not_evaluable
valid_negative
valid_inconclusive
valid_positive
confirmed_method
```

只有 `valid_positive` 或重复的 `valid_negative` 才能强烈影响下一轮方法论。`not_evaluable` 主要用于修复执行链，不能用来反驳 Harness 设计。

### Step 9: Decide next action

Meta 的操作决策：

| 决策 | 含义 |
| --- | --- |
| `keep` | 候选有效且满足当前接受条件，作为后续候选父版本。 |
| `confirm` | 候选有希望，需要在相同条件下重复。 |
| `revise` | 结果有效但干预需要更精确。 |
| `retry` | provider、环境或执行问题导致不可评估。 |
| `discard` | 有效运行没有改善或满足 falsifier。 |
| `defer` | 当前缺少能力或证据，记录恢复条件。 |
| `stop` | 达到目标、预算或没有有效后继。 |

## 7. Controlled Diversity and Comparability

### 7.1 Mutation operators

Meta 不应每次让 Agent“自由发挥”。应提供受控 mutation operator：

- `modify_prompt`：只修改指定 prompt 文件；
- `modify_skill`：新增或修改一个 skill；
- `modify_loop`：插入 checkpoint、retry 或 recovery 阶段；
- `modify_memory_policy`：修改 memory 读写规则；
- `modify_tool_policy`：调整工具可用条件，不改变工具实现；
- `modify_delegation`：调整 subagent 角色和调用条件；
- `compose`：组合已经分别验证过的两个变更。

Mutation operator 产生的是过程约束，不是自动生成最终内容。

### 7.2 Distance budget

每次干预记录并限制：

```json
{
  "max_changed_files": 2,
  "max_diff_lines": 120,
  "allowed_components": ["agent.loop", "agent.skills.recovery"],
  "forbidden_components": ["environment", "evaluator"],
  "max_new_tools": 0,
  "max_budget_delta": 0
}
```

距离可以包括：

- 文件级距离；
- manifest/component 距离；
- prompt token 距离；
- 工具集合距离；
- budget 距离；
- 行为事件分布距离。

### 7.3 Comparison neighborhoods

Meta 维护候选邻域，而不是只维护单一 current：

```text
base-Harness
├── prompt-variant-a
├── prompt-variant-b
├── recovery-variant-a
└── memory-variant-a
```

同一父版本下的候选优先进行横向比较。这样可以区分“哪个方向有效”，而不是只知道“最新版本是否变好”。

## 8. Metrics

### 8.1 Primary metrics

Primary metric 由 evaluator 提供，通常是：

- authoritative score；
- task completion rate；
- verifier reward。

### 8.2 Execution validity metrics

这些指标决定结果是否可解释：

- process completion；
- task-agent completion；
- evaluator availability；
- verifier availability；
- evaluable rate；
- provider failure rate；
- timeout rate。

### 8.3 Efficiency metrics

- wall-clock time；
- model tokens；
- tool calls；
- episode count；
- subagent calls；
- cost；
- peak memory；
- successful result per unit cost。

### 8.4 Behavioral diagnostics

- repeated invalid actions；
- observation-to-action delay；
- recovery success rate；
- tool error recovery rate；
- unnecessary reset rate；
- phase transition count；
- premature completion rate；
- unexplained termination rate。

### 8.5 Structural metrics

- changed file count；
- changed component count；
- diff size；
- new capability count；
- prompt size；
- tool surface size；
- memory surface size；
- parent-to-candidate distance。

Primary metric决定任务效果；其他指标用于归因、成本控制和候选排序，不能替代 primary metric。

## 9. Attribution Rules

归因分成四层：

### Layer 1: Realization

目标干预是否真的存在于候选 Harness 中？

### Layer 2: Execution

候选是否完成了完整在线过程和 rollout？

### Layer 3: Outcome

权威结果是否满足 acceptance predicate？

### Layer 4: Interpretation

结果是否足以支持该干预机制，而不是偶然性或混淆因素？

最终状态不能直接从分数推导：

```text
process success
  != object valid
  != rollout valid
  != evaluable result
  != supported hypothesis
```

归因最低要求：

1. parent 和 candidate 的组件差异可解析；
2. evaluator、环境、case、seed 和预算可比较；
3. 运行不是 provider、环境或 verifier 故障；
4. 权威指标来自候选 Harness 的真实 rollout；
5. 至少有一个 baseline 或匹配 control；
6. 结论范围不超过观测范围。

## 10. Persistence Layout

建议在现有 ObjectStore 和 runs 结构上增加研究对象目录：

```text
<root>/
├── objects/                         # 不可变 Harness/组件对象
├── refs/
│   ├── harness/family/current
│   └── research/frontier
├── runs/
│   ├── process-.../
│   ├── rollout-.../
│   └── agent-.../
└── research/
    └── <meta-run>/
        ├── state.json
        ├── hypotheses.jsonl
        ├── processes.jsonl
        ├── harnesses.jsonl
        ├── rollouts.jsonl
        ├── evaluations.jsonl
        ├── methodology.jsonl
        ├── decisions.jsonl
        └── frontier.json
```

ObjectStore 负责内容寻址和完整性；Research store 负责关系、聚合和当前研究状态。不要把聚合状态写回不可变对象。

## 11. Tooling Changes

当前 Meta 工具可以逐步演化为：

| 工具 | 作用 |
| --- | --- |
| `research_state` | 返回全局谱系、frontier、历史摘要和预算。 |
| `harness_inspect` | 返回指定 Harness 的组件摘要、diff 和可读上下文。 |
| `hypothesis_publish` | 发布下一次在线过程的实验假设和约束。 |
| `harness_process_start` | 从 parent Harness 启动受控在线 Harness Process。 |
| `harness_process_observe` | 读取过程状态、轨迹摘要、diff 和结果 Object。 |
| `rollout_start` | 在指定 case/seed/budget 上执行 Harness Object。 |
| `rollout_observe` | 获取执行健康、权威结果、成本和诊断指标。 |
| `evaluation_compare` | 对 baseline 与 candidate 做匹配比较和聚合。 |
| `methodology_record` | 记录有证据支持的方法论结论。 |
| `research_decision` | 记录 keep、confirm、revise、retry、discard、defer 或 stop。 |

现有 `research_spec_publish`、`research_runtime_instantiate`、`research_runtime_run` 和 `research_run_observe` 可以作为兼容层保留，但新的语义应逐渐从“发布完整 Harness 内容”转向“发布过程控制计划”。

## 12. Failure Handling

### Process failure

Agent 未能形成候选 Object，记录过程失败和原因。不能据此判定 hypothesis refuted。

### Rollout failure

Provider、环境、timeout 或 verifier 失败，标记 `not_evaluable`，只允许 retry 或 revise。

### Valid negative

候选正确实现、完整运行且权威结果更差或满足 falsifier，才是有效负向证据。

### Mixed outcome

任务结果改善但成本、稳定性或复杂度显著退化时，不自动 promotion。进入 frontier 比较，并记录 trade-off。

### Meta interruption

Meta 进程被截断、空响应或外部终止时，保存当前 state 和已完成对象；不能把进程成功退出当作研究完成。

## 13. Implementation Plan

### Phase 1: Correct the research model

不改变底层执行方式，先补充数据结构和关系：

- 为现有 Harness 增加 parent/family/process 来源字段；
- 把当前 Spec 明确解释为 Hypothesis/Experiment Plan；
- 将 HarnessRun 和 EpisodeRun 统一归入 Rollout 视图；
- 增加 `execution_validity`、`completion_valid`、`evaluable` 和 `failure_class`；
- 增加 candidate diff 和 changed component 记录。

验收：一次 Meta run 可以回答“从哪个 Harness、经过什么过程、生成了哪个候选、在哪些条件下得到什么结果”。

### Phase 2: Add controlled online process

- 增加 `harness_process_start`；
- 为过程提供 parent workspace 或 resolved object view；
- 限制可写路径、diff 大小、工具和预算；
- 捕获过程 transcript、events、diff 和最终 Object；
- 过程失败与 rollout 失败分开记录。

验收：Agent 可以在线修改 Harness 并形成新的 Harness Object，Meta 不需要生成完整 Harness 内容。

### Phase 3: Add global evaluation and attribution

- 增加跨 rollout 的 `evaluation_compare`；
- 实现同 case/seed/budget 的匹配比较；
- 汇总主指标、效率指标、行为诊断和结构距离；
- 对 invalid、not_evaluable、valid negative、valid positive 分层；
- 将 attribution 结果持久化。

验收：Meta 可以区分“改动有效”“运行失败”“结果不可评估”和“结果改善但归因不足”。

### Phase 4: Add methodology frontier

- 将经验记录升级为带证据链的 Methodology Evidence；
- 维护支持、反例、适用范围和置信度；
- 为 Meta 提供全局 frontier 和未覆盖的实验邻域；
- 支持从已验证经验生成新的可检验假设；
- 支持候选确认、promotion、rollback 和停止。

验收：Meta 不再只从最新版本继续，而是能基于全局历史选择更有价值的父版本和下一项实验。

## 14. Migration from Current System

当前系统的映射建议如下：

| 当前对象 | 新语义 |
| --- | --- |
| `harness-spec` | `harness-hypothesis` / `experiment-plan`，描述干预和 rollout 约束 |
| compiled `harness` | `harness-object` |
| `harness run` | `harness-rollout` |
| `episode run` | rollout 的 task execution evidence |
| `research_decision_record` | Meta decision |
| `experience_submit` | Task-local methodology observation |
| `knowledge library` | Methodology Evidence 的候选来源 |
| `harness.lock.json` | Object 的 immutable execution lock |

迁移时不需要删除旧 API。先让旧 Spec 产生新的过程、对象和 rollout 记录，再逐步加入在线过程和全局比较 API。

## 15. Success Criteria

该设计完成的最低标准：

1. Meta 可以从全局历史而不是只从 current Harness 选择下一项实验；
2. 一次在线 Harness Process 的轨迹、修改差异和候选 Object 可独立追踪；
3. 候选之间有 parent、组件差异和距离预算，能够控制 shift；
4. rollout 同时记录任务结果、运行效率、成本、稳定性和诊断指标；
5. 系统能区分执行失败、不可评估、有效负向和有效正向结果；
6. 方法论结论引用多个 Evaluation，并带有范围、置信度和反例；
7. Meta 能基于方法论证据提出新假设并触发下一次在线过程；
8. 所有 Object、Process、Rollout、Evaluation 和 Decision 都能回溯到同一研究谱系。

## 16. Final Position

本项目的中心模型应从：

```text
Spec -> Harness -> Run
```

调整为：

```text
Meta 全局研究状态
  -> 受控 Hypothesis
  -> 在线 Harness Process
  -> Harness Object
  -> Rollout 集合
  -> Evaluation 与 Attribution
  -> Methodology Evidence
  -> 下一轮 Meta 决策
```

Spec 仍然有用，但它是 Meta 对下一次过程的控制计划；Harness Object 才是被比较的候选；Harness Process 才是产生候选的在线实验；Rollout 和 Evaluation 才是结果证据；Methodology Evidence 才是 Meta 可以跨轮次积累的知识。
