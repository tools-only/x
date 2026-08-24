# Meta Hypothesis、Task Harness 与 Kernel Runtime 契约

## 1. 文档目的

本文定义 Meta Agent、Kernel 和 Task Agent 之间的职责边界，以及一个高层方法论假设如何成为可执行、可评测、可追溯的完整 Runtime 闭环。

本文解决的核心问题是：

> Meta 不应该直接编辑具体 Task Harness 的 policy、skill、tools、loop 或 memory；但如果 Meta 只给出完全抽象的自然语言假设，Task Agent 又可以自由理解和实现，那么最终运行结果可能验证的只是 Task Agent 对假设的某一种解释，而不是 Meta 提出的假设本身。

因此，目标不是让 Meta 和 Task 完全割裂，也不是让 Meta 直接控制具体实现，而是建立一种：

> **语义连续、实现解耦、可验证、可追溯的中间契约。**

## 2. 核心设计结论

系统应当由三个相互隔离的层组成：

```text
Meta Agent
  提出高层 HypothesisSpec
  规定研究对象、预期、可观察行为、变量边界和证据要求
          |
          | 受限 Kernel CLI / control plane
          v
Task Agent
  读取 HypothesisSpec
  解释并 operationalize hypothesis
  派生具体 HarnessInstance
  在实际任务环境中执行
          |
          | Kernel Runtime
          v
Kernel
  持久化对象、锁定实例、隔离进程、调度环境
  收集原始运行证据，调用权威 evaluator/verifier
          |
          v
EvaluationReport
  实际执行与评测结果
          |
          | 受限 evidence observation
          v
Meta Agent
  判断 hypothesis 被支持、证伪、无法判断或需要修正
  形成下一轮 HypothesisSpec 或结束研究
```

三个角色的核心职责如下：

| 角色 | 负责什么 | 不负责什么 |
| --- | --- | --- |
| Meta Agent | 提出高层方法论假设、定义预期、规定检验方式、分析证据、决定下一轮研究 | 不直接写 Task policy/skill，不直接指定 tools/loop/memory 的具体内容，不直接操作环境 |
| Task Agent | 将 HypothesisSpec 落地为具体 HarnessInstance，选择和配置具体工程实现，执行任务 | 不改变 hypothesis 的语义，不伪造验证结果，不绕过 Kernel 的能力和预算约束 |
| Kernel | 持久化、对象解析、能力隔离、运行调度、环境交互、权威证据收集、评测调用、谱系记录 | 不选择研究策略，不替 Meta 判断 hypothesis，不理解具体任务方法论 |

## 3. 两个错误的极端

### 3.1 Meta 直接写具体 Harness 配置

当前不应采用以下结构：

```text
Meta 写具体 agent/environment 配置
  -> Kernel 直接编译 Harness
  -> Kernel 直接运行
```

这种结构的问题是，Meta 的输出已经不是高层研究假设，而是 Task Agent 的工程配置。Meta 会被迫决定：

- policy 的具体文本；
- skill 的具体内容；
- tools 的选择和调用方式；
- loop 的阶段与控制逻辑；
- memory 的结构和读写规则；
- subagent 的具体角色和预算；
- 具体环境适配器的配置。

这会造成三个后果：

1. Meta 与 Task Agent 耦合，Meta 不能只研究方法论。
2. Kernel 变成 Meta 到具体 Harness 的编译器，承担了本不属于它的语义解释。
3. Meta 的实验变量变成配置字段，而不是可被 Task Agent 实现和验证的方法论假设。

### 3.2 Meta 只给出完全抽象的自然语言

另一种极端也不正确：

```text
Meta: “规划能力会提升任务完成率”
  -> Task Agent 自由理解和实现
  -> Kernel 运行
  -> 得到分数
```

此时无法判断：

- Task Agent 是否真的实现了“规划能力”；
- 它是否只是修改了 prompt；
- 它是否换用了不同模型或更高预算；
- 它是否改变了任务选择、环境版本或评测方式；
- 最终分数变化是否可以归因于该 hypothesis。

这种结果只能说明：

> Task Agent 对该抽象 hypothesis 的某一种工程解释是否有效。

它不能直接证明 Meta hypothesis 本身成立或失败。

## 4. 中间层：Operationalization Contract

正确的方案是在 MetaSpec 中加入 **Operationalization Contract**，也可以称为假设落地契约。

它不是具体 Harness 配置，也不是可执行代码，而是把高层 hypothesis 转换为可检查的语义约束：

- 什么方法论行为才算实现了该 hypothesis；
- 哪些中间行为必须可观察；
- 哪些变量必须保持不变；
- 哪些工程实现差异允许 Task Agent 自由选择；
- 哪些证据能够支持或反驳 hypothesis；
- 什么情况下运行结果不具备假设检验资格。

因此，Meta 控制的是：

```text
研究什么
  -> 预期发生什么
  -> 什么行为算实现
  -> 哪些条件必须固定
  -> 需要什么证据
  -> 如何判断支持、证伪或信息不足
```

Meta 不控制的是：

```text
具体 policy 文本
具体 skill 内容
具体 prompt 写法
具体 tool 调用顺序
具体 loop 实现
具体 memory 数据结构
具体工程代码
```

### 4.1 HypothesisSpec 示例

下面的结构表达的是高层方法论和验证约束，而不是具体 Task Harness 配置：

```json
{
  "kind": "hypothesis-spec",
  "schema_version": "hos.hypothesis-spec.v1",
  "name": "planning-before-irreversible-action",
  "hypothesis": {
    "claim": "在不可逆动作前进行显式状态建模和计划更新，会提高任务成功率。",
    "mechanism": "决策前的状态模型可以降低盲目尝试和错误动作。",
    "prediction": "在相同任务集合、环境版本和执行预算下，成功率提高。",
    "falsifier": "满足实现约束的重复运行未优于对照，或出现稳定回归。",
    "uncertainty": [
      "计划状态可能增加推理成本",
      "效果可能只在需要多步规划的任务上出现"
    ]
  },
  "operationalization": {
    "required_behaviors": [
      "不可逆动作前必须产生或更新显式计划状态",
      "计划必须基于当前环境观察，而不是静态预写答案",
      "计划更新必须能与后续动作和环境反馈关联"
    ],
    "required_evidence": [
      "plan checkpoint trace",
      "observation-to-plan trace",
      "action trace",
      "authoritative verifier result"
    ],
    "controlled_dimensions": [
      "task selector",
      "environment revision",
      "evaluator/verifier",
      "provider profile",
      "execution budget"
    ],
    "allowed_variation": [
      "计划的具体文本表达",
      "计划状态的内部数据结构",
      "Task Agent 选择的 loop 实现",
      "Task Agent 选择的 memory 表示"
    ],
    "forbidden_confounders": [
      "不得改变评测器实现或权威分数来源",
      "不得替换任务集合而不在 Spec 中声明",
      "不得使用未声明的额外工具或 subagent",
      "不得提高未声明的运行预算"
    ]
  },
  "evaluation": {
    "primary_metrics": [
      "verifier_reward",
      "completion_rate"
    ],
    "secondary_metrics": [
      "agent_runs",
      "episode_runs",
      "token_usage",
      "elapsed_seconds"
    ],
    "criterion": "在主要指标上优于对照，且没有超出成本和预算约束",
    "comparison": {
      "baseline": "same-task-cold-baseline",
      "same_task_set": true,
      "same_environment": true,
      "same_budget": true,
      "repetitions": 2
    }
  },
  "evidence_contract": {
    "required": [
      "hypothesis-spec",
      "harness-derivation",
      "runtime-run",
      "realization-report",
      "evaluation-report",
      "verifier-result"
    ]
  }
}
```

这个 Spec 没有告诉 Task Agent 应该写什么 prompt，也没有告诉它必须使用哪个 memory 文件格式；但它明确规定了：

- 什么行为必须出现；
- 什么证据必须被记录；
- 哪些条件必须保持一致；
- 哪些实现变化是允许的；
- 什么结果才有资格被用于检验 hypothesis。

## 5. Task Agent 的职责：解释、落地和声明映射

Task Agent 不是简单地“自由发挥”，也不是被 Meta 直接遥控。它的职责是：

1. 读取 Meta 提出的 HypothesisSpec。
2. 判断当前任务和自身能力是否可以实现该 Spec。
3. 设计具体 HarnessInstance。
4. 说明每一条 operationalization requirement 如何映射到 Harness 行为。
5. 通过 Kernel 创建不可变 HarnessInstance。
6. 在规定的环境、预算和 evaluator 下执行。
7. 提交运行和实现证据。

Task Agent 可以决定“如何实现”，但不能决定“是否仍然是在实现同一个 hypothesis”。

### 5.1 HarnessDerivation 示例

Task Agent 应产生独立的派生记录：

```json
{
  "kind": "harness-derivation",
  "schema_version": "hos.harness-derivation.v1",
  "hypothesis_spec": "sha256:...",
  "task_agent_run": "agent-...",
  "derivation": {
    "implementation_claims": [
      {
        "requirement": "不可逆动作前必须产生或更新显式计划状态",
        "harness_realization": [
          "pre-action planning checkpoint",
          "structured plan state",
          "plan revision after observation"
        ],
        "evidence_source": [
          "runtime event plan.updated",
          "runtime event action.selected"
        ]
      },
      {
        "requirement": "计划必须基于当前环境观察",
        "harness_realization": [
          "observation is recorded before each plan revision",
          "plan revision references observation digest"
        ],
        "evidence_source": [
          "observation-to-plan trace"
        ]
      }
    ],
    "controlled_dimensions": {
      "task_selector": "unchanged",
      "environment_revision": "sha256:...",
      "provider_snapshot": "sha256:...",
      "execution_budget": "sha256:...",
      "evaluator": "sha256:..."
    },
    "declared_variations": [
      "plan state represented as structured JSON",
      "planning checkpoint implemented in the task loop"
    ],
    "known_limitations": [
      "the plan trace does not prove plan quality"
    ]
  },
  "harness_instance": "sha256:..."
}
```

这份记录解决了语义断层问题：Meta 不需要知道具体 prompt 或代码，但可以检查 Task Agent 是否声称实现了每项要求，以及运行结果中是否真的存在对应证据。

## 6. 两层验证：实现有效性与假设结果

不能把“是否正确实现 hypothesis”和“最终得分是否提升”混成一个判断。完整闭环至少需要两个独立判断层。

### 6.1 实现有效性：Realization Validity

问题是：

> 这个 HarnessInstance 是否满足 MetaSpec 的 operationalization contract？

这层检查包括：

- 必需行为是否声明了具体实现映射；
- 必需事件或 trace 是否实际产生；
- controlled dimensions 是否与对照一致；
- 是否使用了未声明能力；
- 是否超出预算；
- evaluator/verifier 是否仍是指定版本；
- 任务选择是否符合 Spec。

如果不满足，结果应标记为：

```text
inadmissible
realization_failed
contract_violation
```

这类结果不能直接用来证伪 Meta hypothesis，因为它没有真正完成该 hypothesis 的有效实现。

### 6.2 实验结果：Hypothesis Evidence

只有当实现有效且实验条件成立时，权威 evaluator 的结果才能进入 hypothesis 判断：

- `supported`：结果符合预测，并满足证据和比较契约；
- `refuted`：实现有效，但结果稳定违背预测；
- `inconclusive`：实现有效，但样本、重复性或指标不足；
- `realization_failed`：具体工程实现未满足契约；
- `invalidated`：运行条件或证据链被破坏，结果不可用。

例如：

```text
Task Agent 没有生成计划检查点
  -> realization_failed
  -> 不能说明“规划方法无效”

Task Agent 满足计划检查点，预算和对照条件一致
  -> Harbor verifier reward 未提升
  -> 才构成“该 operationalization 下不支持 hypothesis”的证据
```

即使某个具体实现失败，Meta 仍可以区分：

- hypothesis 被反驳；
- 当前 operationalization 不充分；
- Task Agent 的实现失败；
- 证据不足，需要重复运行；
- hypothesis 应修正为新的研究问题。

这些是 Meta 的研究判断，不能由 Kernel 预先固化为单一规则。

## 7. Kernel 的定位：隔离层，而不是研究者

Kernel 应当是 Meta 和 Task Agent 之间的隔离层，向上和向下都提供稳定、任务无关的能力接口。

### 7.1 Kernel 提供的底层能力

Kernel 负责：

- 内容寻址对象的发布和读取；
- HypothesisSpec、HarnessDerivation、HarnessInstance、RuntimeRun、EvaluationReport 的持久化；
- 对象图解析和不可变 lock；
- AgentRun、HarnessRun、EpisodeRun 的创建；
- 进程隔离和 Host Protocol；
- capability grant 和调用权限校验；
- 运行预算、超时和资源使用记录；
- 环境 adapter 的调度；
- 原始运行 trace 和 artifact 的收集；
- evaluator/verifier 的调用；
- provider、环境、数据集和 verifier 版本快照；
- 运行谱系和 evidence reference；
- 运行失败、超时、权限拒绝和契约违规的记录。

### 7.2 Kernel 不提供研究策略

Kernel 不应该决定：

- Meta 下一步研究什么；
- hypothesis 是确认还是修正；
- 是否需要增加实验次数；
- 某个失败是证伪还是实现失败；
- 哪个 Harness 应该 promotion；
- 哪个方法论更有价值。

Kernel 可以根据已经锁定的 contract 判断“证据是否完整”“是否超预算”“是否违反能力边界”，但不能据此替 Meta 作研究结论。

## 8. Kernel 面向 Agent 暴露的接口

Kernel 内部实现可以很复杂，但 Agent 只能使用受限 control plane。

### 8.1 Meta Agent 接口

Meta 可以获得任务无关的研究接口：

```text
knowledge.search
hypothesis.publish
runtime.observe
evidence.query
assessment.record
```

必要时可以提供：

```text
runtime.request
```

但这个接口的语义应是“请求一个符合 HypothesisSpec 的实验”，而不是让 Meta 直接传入具体 Task Harness 配置。

Meta 不应直接调用：

```text
env.open
env.step
terminal.exec
component.load
object.write
filesystem.write
```

这些属于 Task Runtime 或 Kernel 内部能力。

### 8.2 Task Agent 接口

Task Agent 可以获得：

```text
hypothesis.read
harness.derive
harness.lock
runtime.start
environment.open
environment.observe
environment.step
environment.reset
environment.close
evidence.submit
```

具体环境能力由 HarnessInstance 的 capability grant 决定：

- ARC-AGI 可以提供受限环境操作接口；
- Terminal-Bench 可以提供 sandbox 内的 terminal execution；
- verifier 结果只能由 Kernel/环境返回，不能由 Agent 自己写入；
- 未声明的工具、文件、subagent 和外部资源访问必须被拒绝。

### 8.3 Agent 身份不应成为 Kernel 分支的主要依据

Kernel 可以记录 `meta`、`task` 等审计标签，但不应通过大量代码分支判断角色：

```python
if role == "meta":
    ...
elif role == "task":
    ...
```

更稳定的方式是向通用 Agent Runtime 传递显式的：

```text
CapabilityManifest
ExecutionContract
ArtifactScope
ParentLineage
```

Meta 和 Task 都是 Kernel 上的客户端，只是获得的能力集合不同。

## 9. 完整对象模型

持久化对象应明确区分以下层次：

```text
HypothesisSpec
  Meta authored
  高层方法论、预期、Operationalization Contract、Evaluation Contract

HarnessDerivation
  Task Agent authored
  HypothesisSpec 到具体 HarnessInstance 的映射、实现理由和约束声明

HarnessInstance
  Kernel locked
  具体 Agent、runtime、environment、evaluator 和 capability 配置

RuntimeRun
  Kernel executed
  隔离执行过程、输入、输出、trace、资源和错误

RealizationReport
  Kernel 根据 contract 和运行证据生成
  判断具体 Harness 是否有效实现 HypothesisSpec

EvaluationReport
  Kernel/verifier produced
  权威 verifier 原始证据、归一化指标、评测条件和 evidence references

HypothesisAssessment
  Meta authored
  对一个或多个 RuntimeRun 的研究判断和下一步决定
```

推荐的谱系关系为：

```text
HypothesisSpec
  -> HarnessDerivation
  -> HarnessInstance
  -> RuntimeRun
  -> RealizationReport
  -> EvaluationReport
  -> HypothesisAssessment
  -> successor HypothesisSpec
```

这样可以回答完整的审计问题：

1. Meta 提出了什么方法论？
2. 它要求观察什么行为？
3. Task Agent 如何将它落地？
4. 哪些具体配置发生了变化？
5. 哪些条件保持不变？
6. Runtime 实际执行了什么？
7. Verifier 和 evaluator 产生了什么权威证据？
8. Meta 为什么确认、证伪、修正或停止？

## 10. 完整生命周期

### 10.1 Meta 提出假设

Meta 通过受限 CLI 发布 HypothesisSpec：

```text
Meta -> hypothesis.publish(HypothesisSpec)
Kernel -> 校验 schema、持久化 Spec、返回 digest
```

Kernel 只验证结构完整性和能力边界，不判断 hypothesis 是否聪明或正确。

### 10.2 Task Agent 进行派生

Task Agent 读取 Spec，根据任务和自身 Harness 能力设计具体实现：

```text
Task Agent -> hypothesis.read(spec)
Task Agent -> harness.derive(spec, derivation)
Kernel -> 校验 derivation 与 contract 的一致性
Kernel -> 创建 HarnessInstance lock
```

如果无法实现，应明确返回：

```text
derivation_rejected
unsupported_requirement
missing_capability
```

不应静默忽略 Spec 中的要求。

### 10.3 Kernel 执行 Runtime

Kernel 根据 HarnessInstance：

- 创建隔离 RuntimeRun；
- 注入已授予的能力；
- 执行环境 adapter；
- 应用预算和超时；
- 保存 transcript、事件、环境输出和资源使用；
- 拒绝未声明调用。

### 10.4 生成评测报告

环境和 verifier 产生原始权威证据，Kernel 通过 evaluator 生成 EvaluationReport：

```json
{
  "kind": "evaluation-report",
  "runtime_run": "harness-run-...",
  "evaluator": "sha256:...",
  "verifier": "sha256:...",
  "metrics": {
    "verifier_reward": 1.0,
    "completion": 1.0,
    "elapsed_seconds": 421.2
  },
  "criteria": {
    "same_task_set": true,
    "same_budget": true,
    "required_evidence_present": true
  },
  "realization_status": "valid",
  "evaluation_status": "passed",
  "evidence_refs": [
    "sha256:..."
  ]
}
```

### 10.5 Meta 评估和迭代

Meta 读取报告并作出研究判断：

```text
Meta -> evidence.query(runtime/evaluation)
Meta -> assessment.record(HypothesisAssessment)
```

Meta 可以选择：

- `supported`：当前证据支持 hypothesis；
- `refuted`：有效实现下结果反驳 hypothesis；
- `inconclusive`：证据不足；
- `realization_failed`：实现没有满足契约；
- `revise`：修改 hypothesis 或 operationalization；
- `expand`：增加任务、重复或验证维度；
- `defer`：暂缓判断；
- `archive`：结束该研究分支。

Kernel 只保存该决定，并要求它引用相关 evidence。Kernel 不自动替 Meta 选择 successor Spec。

## 11. 当前工程应避免的具体错误

### 11.1 不应让 MetaSpec 直接包含具体 agent 配置

以下内容不应成为 Meta 直接编辑的核心字段：

```text
agent.policy
agent.skills[].content
agent.tools
agent.loop
agent.memory
agent.subagents
```

这些属于 Task Agent 的 HarnessDerivation 和 HarnessInstance。

Meta 可以声明：

```text
需要可观察的计划状态
需要支持恢复的执行行为
需要比较有无某种方法论机制
需要记录哪些中间证据
```

但不能直接写出这些机制的工程实现。

### 11.2 不应让 Kernel 直接编译 MetaSpec 为具体 Task Harness

Kernel 可以提供通用对象和锁定能力，但不应承担：

```text
“这个 hypothesis 应该映射成哪一段 policy”
“这个研究方法应该使用哪个 prompt”
“这个机制应该实现成哪个 loop”
```

这些属于 Task Agent 的工程推导职责。

### 11.3 不应静默忽略派生要求

如果 Task Agent 生成的 HarnessInstance 没有真正实现某项 requirement，Kernel 必须产生明确的 realization failure，而不是照常运行后把分数交给 Meta。

### 11.4 不应把单一 score 当作完整 hypothesis 结论

score 只是 EvaluationReport 中的一项指标。完整结果还应包括：

- realization validity；
- 任务和环境是否一致；
- 预算和 provider 是否一致；
- verifier 证据是否完整；
- 运行成本；
- 重复性；
- 失败类型；
- 证据引用。

## 12. 设计原则总结

最终的设计原则是：

1. **Meta 控制语义，不控制具体实现。**
2. **Task Agent 控制工程实现，但不能改变 hypothesis 的语义。**
3. **Kernel 控制边界、执行和证据，但不替任何 Agent 做研究判断。**
4. **HypothesisSpec 必须包含可操作化约束，不能只有自然语言主张。**
5. **HarnessDerivation 必须显式说明高层要求如何落地。**
6. **实现有效性与实验结果必须分层判断。**
7. **只有实现有效、条件受控、证据完整的运行，才能用于支持或证伪 hypothesis。**
8. **所有 Spec、派生、实例、运行、评测和决定都必须具备可验证谱系。**
9. **Meta 和 Task 都通过受限接口使用 Kernel，不应侵入 Kernel 内部。**
10. **Meta 的迭代对象是方法论 hypothesis，不是某个具体 skill 或 prompt 文件。**

