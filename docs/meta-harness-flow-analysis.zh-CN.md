# Meta Harness、Meta Agent 与 Task Agent：实际闭环分析

本文以当前代码实现为准，说明 Meta 提出的 Harness Spec 如何变为可运行的 Task Harness、Meta 到 Task 的完整反馈闭环，以及当前系统中“学习”的真实含义与边界。

## 1. 核心结论

当前系统已经形成了可追溯的研究执行链：

```text
研究假设
  -> 完整 Harness Spec
  -> 确定性编译为不可变 Harness
  -> Task HarnessRun / Task AgentRun / EpisodeRun
  -> authoritative metrics
  -> Meta 通过 run_observe 获得证据
  -> LLM 决定下一轮 Spec 或停止
```

其中，Task Harness 的 authoritative score 是 Meta 研究的外部结果信号。Meta Harness 本身通常不直接执行 Episode，因此其自身指标通常为 `score=0`、`episode_runs=0`；评价 Meta 方法的真正证据位于其启动的子 Task HarnessRun 中。

当前实现是“LLM 以任务结果为证据的自主实验循环”，而不是一个由 Kernel 显式计算 reward、自动更新 Meta policy 的强化学习系统。

## 2. 三个角色及边界

### 2.1 Kernel / Meta Harness

Kernel 管理对象持久化、Harness 图解析、子进程隔离、Host Protocol、环境交互、Episode 记录及权威计分。Meta Harness 是承载 Meta Agent 的外层 HarnessRun，也是子 Task HarnessRun 的父级容器。

Meta Harness 不决定具体实验内容；它只为 Meta Agent 提供受控的研究能力：

- `knowledge_search`
- `spec_publish`
- `harness_instantiate`
- `harness_start`
- `run_observe`

### 2.2 Meta Agent

Meta Agent 的职责是研究“怎样的 Task Harness 更可能解决当前任务”。它拥有实验方法的决策权：选择假设、干预维度、对照条件、实验次数、是否重复、何时停止。

Meta Agent 不能直接调用环境，也不能改写 evaluator、历史 Run、已发布对象、Host Protocol 或环境规则。

### 2.3 Task Agent

Task Agent 在一个 `role=task` 的 Harness 中执行具体任务。它拥有环境工具：

- `env_open`
- `env_observe`
- `env_step`
- `env_reset`
- `env_close`
- `experience_submit`

`env_close` 返回的分数由环境和 Kernel 记录，构成权威任务结果；Agent 自述、日志文字或推断都不能代替该结果。

## 3. Harness Spec：不是纯 high-level 文档

`Harness Spec` 同时包含两类语义：

1. **研究声明层**：本次实验为何成立、改什么、如何判定。
2. **构造输入层**：待实例化 Task Harness 的 Agent、组件与环境描述。

典型结构如下：

```json
{
  "kind": "harness-spec",
  "name": "...",
  "role": "task",
  "base_harness": "sha256:... or ref:...",
  "hypothesis": {
    "claim": "改变 X 会改善 Y",
    "mechanism": "X 如何影响 Task Agent 行为",
    "prediction": "预期观察",
    "falsifier": "否定条件",
    "metric": "authoritative score",
    "controls": ["same case", "same seed"],
    "expected_delta": "> 0"
  },
  "method": {
    "intervention": "主要干预",
    "procedure": ["instantiate", "run", "observe"],
    "budget": {"max_agent_runs": 4, "max_episodes": 2}
  },
  "agent": {
    "name": "...",
    "driver": "llm",
    "provider": "task",
    "max_turns": 12,
    "max_tokens": 2048,
    "policy": "...",
    "skills": [{"name": "strategy", "content": "..."}],
    "memory": {},
    "tools": [],
    "loop": {}
  },
  "environment": {"name": "arc3-local", "adapter": "arc3-local"},
  "evaluator": "authoritative-score",
  "ruleset": "default",
  "validation": {"same_case": true}
}
```

### 3.1 Meta 可研究的维度

| 维度 | Spec 字段 | 当前是否影响运行 |
| --- | --- | --- |
| Agent 策略与提示 | `agent.policy`、`agent.skills` | 是 |
| 模型和推理限额 | `provider`、`max_turns`、`max_tokens` | 是 |
| Loop 结构 | `agent.loop` | 仅持久化，未驱动 LLM loop |
| Memory 结构 | `agent.memory` | 仅持久化，未接入 LLM context |
| 工具集合 | `agent.tools` | 仅持久化，实际工具由 role 固定 |
| 子 Agent | `agent.subagents` | 当前 Spec 编译未支持 |
| 环境适配器 | `environment.adapter` | 是 |
| evaluator / ruleset | `evaluator`、`ruleset` | 主要为元数据，未改变评分 |
| 假设、控制、验证、预算 | `hypothesis`、`method`、`validation` | 主要用于溯源和提示，未全面强制 |

因此，Spec 不是完全 high-level 的抽象。它已经能具体定义 Task Agent 的 policy、skills、LLM provider、token/turn 上限和环境；但它承诺的可编辑面大于当前 runtime 已经执行的语义面。

## 4. Spec 如何关联到具体 Harness 实例

关联并不是运行时由 LLM 再解释一次，而是由 `instantiate_harness_spec` 进行确定性编译：

```text
HarnessSpec（不可变对象）
  |
  | instantiate_harness_spec(spec_ref)
  v
不可变组件对象
  - loop
  - policy
  - skill x N
  - memory
  - tool x N
  - agent
  - environment
  - evaluator
  - ruleset
  |
  v
Harness（不可变对象）
  - root_agent
  - environment / evaluator / ruleset
  - spec = 原始 Spec digest
  - compiler = hos.spec-compiler/v1
  - component_map = 语义路径 -> 组件 digest
```

例如，Spec 中：

```json
{
  "agent": {
    "policy": {"content": "先观察，再试探"},
    "skills": [{"name": "strategy", "content": "probe first"}]
  }
}
```

会产生独立的 Policy object 和 Skill object。随后它们被 Agent object 引用，Harness 再通过 `root_agent` 引用该 Agent。

Harness manifest 中的关联字段形如：

```json
{
  "spec": "sha256:<source-spec>",
  "compiler": {"name": "hos.spec-compiler", "version": "v1"},
  "component_map": {
    "agent": "sha256:...",
    "agent.policy": "sha256:...",
    "agent.skills.strategy": "sha256:...",
    "environment": "sha256:..."
  }
}
```

每次运行前，resolver 递归解析 Harness 引用图并写入 `harness.lock.json`。这使任意结果都可从 Run 回溯到：

```text
HarnessRun
  -> Harness digest
  -> source Spec digest
  -> hypothesis / intervention
  -> 实际使用的 policy、skill、agent、environment 等组件 digest
```

对象均为内容寻址的不可变对象；同一份 manifest 与 payload 得到同一 digest，内容变化则生成新 digest。

## 5. Meta 到 Task 的完整闭环

### 5.1 启动阶段

`hos demo` 会：

1. 确认 ARC case（`game_id` 与 `seed`）。
2. 持久化 Meta prompt。
3. 创建 Meta Agent 和 `role=meta` Harness。
4. 将其写入 `refs/harness/meta/current`。
5. 构造 `research_job`，其中包含 `task_spec` 种子及 `task_job`。
6. 启动 Meta HarnessRun。

这里的 `task_spec` 只是研究起点，不会被 Kernel 自动实例化或自动执行。Meta Agent 自己决定是否、何时以及如何使用它。

### 5.2 Meta 研究阶段

Meta LLM 得到 Meta prompt、研究 job、Task Spec seed，以及可选的经验库搜索结果。随后它自己执行：

```text
knowledge_search（可选）
  -> 形成可证伪假设
  -> spec_publish（发布完整 Task Spec）
  -> harness_instantiate（编译 Task Harness）
  -> harness_start（运行该 Task Harness）
  -> run_observe（读取子 Run 的权威结果）
  -> 判断 supported / refuted / inconclusive
  -> 修改假设并进入下一轮，或停止
```

### 5.3 子 Task Harness 执行阶段

当 Meta 调用 `harness_start` 后，Kernel 使用新的 `Supervisor` 启动子 Harness：

```text
Meta HarnessRun
└── Meta AgentRun
    ├── spec_publish
    ├── harness_instantiate
    ├── harness_start
    │   └── Task HarnessRun
    │       └── Task AgentRun
    │           ├── env_open(case)
    │           ├── env_observe / env_step / env_reset
    │           ├── env_close
    │           └── experience_submit（可选）
    └── run_observe(Task HarnessRun)
```

Task Agent 的 `env_close` 触发 Kernel 持久化 Episode score。Task HarnessRun 完成后，Kernel 生成：

```json
{
  "score": "所有关闭 Episode 分数的和",
  "episode_runs": "已完成 Episode 数"
}
```

Meta 再调用 `run_observe`，读取子 Task HarnessRun 的：

- `status.json`
- `result.json`
- `metrics.json`（authoritative metrics）
- `usage.json`

因此，完整因果路径为：

```text
Meta intervention
  -> Task Spec 中的 agent/policy/skills/limits/environment
  -> 编译出的不可变 Task Harness 图
  -> Task Agent 的上下文和工具行为
  -> Episode trajectory
  -> authoritative score
  -> Meta 观察并选择下一轮 intervention
```

## 6. Meta 的学习信号来自哪里

Meta 不直接运行 Episode，因此它不应该把自身 Harness 的 `metrics.json` 当成 reward。正确的结果信号是子 Task Harness 的 authoritative metrics。

概念上的目标函数应为：

```text
J(meta intervention)
  = E[Task authoritative score | proposed Task Harness]
    - execution cost
    + repeatability / attribution / information-value terms
```

如果需要更明确的操作化形式，可以定义：

```text
meta_reward =
  task_score_delta
  - λ1 * token_cost
  - λ2 * episode_cost
  - λ3 * complexity
  + λ4 * replicated_improvement
```

其中 `task_score_delta` 应来自相同 case、seed、预算下的 baseline 与 candidate 比较。当前系统的 Meta prompt 要求这种研究纪律，但 Kernel 尚未计算或保存该显式 reward。

## 7. 当前“学习”的三种含义

### 7.1 同一次 Meta Run 内的在线研究

`run_observe` 的结果会作为 tool result 回到 Meta LLM 的会话中。模型据此改变下一轮 Spec。

```text
policy A -> score 0
  -> A 不受支持
  -> 仅改动 skill B
  -> 再运行并观察
```

这是当前最真实的学习闭环：LLM 在上下文内依据权威任务证据更新研究决策。

### 7.2 跨 Run 的经验复用

Task Agent 可提交抽象经验到 `knowledge/experiences.jsonl`：

```json
{
  "observation_pattern": "...",
  "action_rule": "...",
  "failure_mode": "...",
  "scope": "...",
  "confidence": 0.63,
  "evidence": ["episode-run-id"]
}
```

之后 Meta 通过 `knowledge_search` 检索这些记录，在新任务或新实验中作为可质疑证据使用。这是外部记忆，不是模型参数更新。

### 7.3 模型权重学习

当前没有实现。系统没有 meta-policy gradient、在线 RL、自动 finetune、实验数据集训练或参数更新流程。

## 8. 当前实现与设计契约的缺口

当前代码已经提供完整的谱系和执行骨架，但尚未把“研究协议”变成全面强制的运行时机制：

1. 没有显式 `meta_reward` 或结构化的 ExperimentRecord。
2. demo 不会自动运行 baseline/candidate 对照、统计比较或 promotion。
3. `method.budget.max_episodes` 当前未由 `Supervisor` 强制执行；真正强制的主要是 `max_agent_runs`。
4. `base_harness` 当前只做引用类型校验，compiler 不会从其继承或生成差分版本。
5. `validation`、`controls`、`expected_delta` 主要用于溯源和 prompt，不由 Kernel 自动验证。
6. `agent.loop`、`agent.memory`、`agent.tools` 等字段已被编译和锁定，但多数还没有改变 LLM runtime 行为。
7. Spec 编译时将 `subagents` 固定为空，Meta 无法通过 Spec 声明实验用子 Agent。
8. 经验库由 Task Agent 主动写入；Meta 的实验结论没有单独的持久化工具或统一结构。

## 9. 对架构能力的准确表述

当前不宜表述为“Meta 通过 reward 自动学习并优化自身”。更准确的说法是：

> Meta LLM 在不可变、可追溯的 Task Harness 实验空间中，根据子 Task Harness 的权威结果进行自主假设检验与迭代设计；Kernel 保证证据链和执行边界，但尚未提供显式 Meta reward、自动候选选择或 Meta policy 的参数化更新。

若要将其升级为真正的 auto-research learning system，下一步应将：

```text
Task result -> comparison -> Meta reward -> ExperimentRecord
            -> candidate selection -> persistent methodology memory
            -> optional Meta model training / policy update
```

落为 Kernel 管理的结构化数据流，而不是仅由 Meta prompt 约束的自然语言流程。

## 10. 相关实现位置

- Meta prompt、Spec 校验和经验库：`src/hos/meta.py`
- Spec 发布与确定性编译：`src/hos/specs.py`
- Harness 图解析与 lock：`src/hos/resolver.py`
- Harness / Agent / Episode 执行与权限边界：`src/hos/supervisor.py`
- Meta 和 Task LLM tool loop：`src/hos/llm_runtime.py`
- demo 入口和初始 research job：`src/hos/demo.py`
- 当前独立的 Task Gate：`src/hos/gate.py`
- Spec 谱系与 component map 测试：`tests/test_meta_protocol.py`
