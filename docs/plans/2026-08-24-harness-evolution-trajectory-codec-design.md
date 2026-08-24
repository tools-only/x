---
discussion_id: DISC-DH-001
experiment_id: EXP-HTC-001
status: exploration
date: 2026-08-24
tags:
  - dynamic-harness
  - online-evolution
  - process-first
  - trajectory-codec
  - meta-methodology
---

# Harness 在线进化与轨迹转码实验设计

## 1. 被标记的核心讨论

本记录固定以下研究命题，供后续版本继续演进：

> Meta Harness 的优化对象不应仅是一个预先生成、随后固定执行的 Harness 候选，而应扩展为 Harness 在任务执行期间根据状态和反馈持续修改自身的在线进化过程。Meta 学习和提供的是进化方法论或适应策略；Task Agent 执行具体进化；Kernel 管理、约束、记录和评价完整的进化轨迹。

对论文 Meta-Harness 的客观区分是：论文中的 Harness 是可执行且有状态的程序，可以积累 memory、context 和跨样本经验；但在单个候选的评估期间，其实现本身按固定 Harness `H` 执行。新的 Harness 实现主要由外层 proposer 在评估之间产生。论文因此支持“运行状态动态”和“跨评估版本进化”，但没有明确把“单次任务执行期间修改 Harness 实现的策略”作为被优化对象。

本项目拟研究的进一步问题是：

```text
论文：选择 Harness 实现 H，再评价 H 的运行结果
本项目：选择适应策略 Pi，使 H 在运行中随状态和反馈持续演化
```

形式化表示为：

```text
H(t+1) = Pi(H(t), abstract_state(t), evidence(t), budget(t))
```

这里的研究对象是 `Pi` 及其产生的完整演化轨迹，而 `H(t)` 只是轨迹中的不可变 checkpoint。关于该方向的学术新颖性仍需与 self-modifying agents、test-time adaptation、continual learning、online program synthesis 和 reflective agents 等相邻工作进一步比较，当前不作超出论文对比范围的优先权声明。

## 2. 实验问题

`EXP-HTC-001` 研究以下问题：

> 是否存在一种任务无关、信息忠诚、可由 Agent 读写和翻译的 Harness 进化编码，使另一个 Agent 仅根据该编码，就能重建相近的 Harness 结构、行为和在线适应能力？

该问题不是静态地编码最终 Harness，而是编码如下闭环：

```text
轨迹积累
  -> 当前状态抽象
  -> 触发 Harness 修改
  -> 具体修改操作
  -> 修改后的执行和检验
  -> 对修改效果的归因
  -> 保留、回滚或继续演化
```

若实验成功，Meta 可以不直接依赖任务特定轨迹或具体文件内容，而通过可迁移的“Harness 进化程序”积累方法论。

## 3. 角色与信息边界

### 3.1 Task Agent A：源进化过程

Agent A 在真实任务中运行 Continual Harness，并可在受控边界内修改自己的 prompt、policy、skills、memory policy、tool policy、loop 或 delegation 组件。A 的每次修改必须保留触发状态、修改前版本、diff、局部检验、修改后表现及最终权威结果。

### 3.2 Oracle Agent O：进化转码器

O 读取 A 的完整 Harness 版本轨迹和执行证据，将其转成任务无关的进化编码 `C`。O 不负责判定任务是否成功，也不是权威 evaluator；“Oracle”仅表示它在实验中获得完整源轨迹。为避免概念混淆，后续实现可将其命名为 `Evolution Codec Agent`。

O 不应输出任务答案、最终文件全文或可直接复制的完整 diff。它应抽象“在什么状态下，基于什么证据，对 Harness 施加什么操作，以及产生了什么影响”。

### 3.3 Meta Agent M：重建设计器

M 只能看到：

- 初始 Harness 的公开接口和组件类型；
- O 产生的进化编码 `C`；
- 与 A 相同的能力、安全和资源边界。

M 不能看到 A 的原始任务轨迹、最终 Harness、原始 diff 或隐藏 evaluator 信息。M 根据 `C` 生成重建 Harness `H_M`，并在增强实验中生成可在线执行的适应策略 `Pi_M`。

### 3.4 Kernel K：实验裁判

Kernel 捕获不可变版本、事件、预算和权威结果，执行信息隔离，验证修改边界，并分别评价 A、O 和 M。Kernel 不替 O 做语义抽象，也不替 M 选择 Harness 内容。

## 4. 推荐的编码对象

仅用自然语言总结容易丢失顺序、前置条件和因果关系；仅用最终代码 diff 又无法表达修改为何发生。推荐把规范表示定义为一个 Agent 可编辑、机器可校验的“类型化状态转移程序”，并附带事件证据：

```text
EvolutionCode C = (Vocabulary, StateProjection, Rules, EvidenceLinks, Invariants)
```

每条进化规则采用如下结构：

```yaml
rule_id: recover-after-repeated-invalid-action
when:
  state_pattern:
    failure_class: invalid_action
    repeated_count: ">= 2"
  required_evidence:
    - same_error_signature
infer:
  diagnosis: action policy ignores latest environment constraint
mutate:
  operator: insert_validation_checkpoint
  target_role: control_loop
  preserve:
    - task_objective
    - evaluator
    - tool_capabilities
validate:
  probes:
    - replay_failing_prefix
  expected_effect:
    invalid_action_rate: decrease
on_result:
  improved: keep
  unchanged: revise
  regressed: rollback
```

这不是描述完整 Harness 内容的 Spec，而是描述 Harness 如何随状态转换的程序。具体 prompt、代码和文件仍由执行该规则的 Agent 根据当前上下文生成。自然语言 rationale 可以保留为辅助信息，但不作为唯一规范表示。

完整编码还需要保留事件顺序和因果依赖：

```text
e(t) = (
  projected_state,
  trigger,
  diagnosis,
  mutation_operator,
  target_role,
  invariants,
  validation,
  observed_delta,
  decision
)
```

其中 `target_role` 表达被修改组件承担的功能，而不是任务特定文件名；`observed_delta` 同时包含任务效果、效率、稳定性和修改成本；`EvidenceLinks` 使任何抽象结论都能回溯到源事件。

## 5. 两级重建任务

实验必须区分两个难度不同的目标。

### 5.1 终态重建

O 编码 A 的完整进化轨迹，M 根据编码生成静态 `H_M`，再与 A 最终得到的 `H_A` 比较。这能检验编码是否保留了最终结构和行为，但不能证明它编码了在线进化能力。

### 5.2 过程重建（主要目标）

M 根据编码生成适应策略 `Pi_M`，从相同或等价的初始 Harness 出发，在新的执行轨迹中自行决定何时、为何以及如何修改 Harness。比较对象是：

```text
A 的进化策略和轨迹  vs.  M 重建的进化策略和轨迹
```

过程重建必须作为主实验。否则 O 可能只是把最终答案压缩进编码，实验无法区分“结果复制”和“进化规律学习”。

## 6. 实验流程

### Phase 1：捕获源进化轨迹

在多个 task、case 和 seed 上运行 A，记录每个 Harness checkpoint、状态摘要、修改事件、验证事件、回滚、资源消耗和权威结果。必须同时保留成功、失败和无效修改。

### Phase 2：轨迹转码

O 在固定编码预算下，将一条或多条源轨迹转成 `EvolutionCode`。Kernel 检查任务标识、答案、文件全文和直接 diff 泄漏，并验证每条规则的证据链接。

### Phase 3：盲重建

M 在信息隔离环境中读取编码，完成终态重建或生成 `Pi_M`。M 的输出必须通过与 A 相同的 Harness 接口、预算和安全校验。

### Phase 4：同分布复现

在匹配 task family、case 隔离、相同预算条件下运行 `H_A`、`H_M`，以及 A、`Pi_M` 对应的在线过程，测量结构、行为、进化决策和任务结果的一致性。

### Phase 5：跨任务迁移

在 O 和 M 都未看到的新 task family 上执行 `Pi_M`。此阶段检验编码是否保存了任务无关的方法论，而不是源任务的压缩答案。

### Phase 6：反事实与消融

删除或打乱编码中的 trigger、顺序、validation、observed effect、rollback 等字段，观察重建效果下降。若删除这些过程信息不影响结果，则当前编码可能没有真正利用进化过程。

## 7. 对照组

至少设置以下对照，并在相同 token/字节预算下比较：

| 对照 | M 可见信息 | 用途 |
| --- | --- | --- |
| Raw Trace Upper Bound | 完整脱敏轨迹 | 估计可达到的重建上限 |
| Final Harness / Diff | 仅最终结构或差异 | 检验静态结果复制能力 |
| Natural-language Summary | O 的普通摘要 | 比较结构化编码的必要性 |
| Static Component Spec | 最终组件声明 | 比较过程信息的增益 |
| Shuffled EvolutionCode | 打乱事件顺序 | 检验时序信息 |
| No-effect EvolutionCode | 删除修改后表现 | 检验效果反馈和归因信息 |
| No-code Baseline | 只有初始 Harness | 测量 M 自身先验能力 |

## 8. 评价维度

### 8.1 信息忠诚度

- **状态忠诚度**：编码是否保留触发修改所需的状态差异；
- **操作忠诚度**：重建过程选择的 mutation operator、target role 和作用范围是否一致；
- **时序忠诚度**：修改、验证、回滚和保留的顺序是否一致；
- **因果忠诚度**：编码声称的效果能否由对应干预复现，而非仅与结果相关；
- **边界忠诚度**：目标、能力、安全约束和不可变条件是否被保留。

### 8.2 可翻译性

- 不同模型或不同实现的 M 是否都能解释编码；
- 编码是否能生成可运行 Harness，而非只产生合理说明；
- 相同编码的多次重建是否收敛到行为等价的策略；
- 编码错误是否能在执行前被结构校验发现。

### 8.3 过程与结果等价性

- trigger agreement、operator agreement、修改时机和 rollback agreement；
- held-out task 上的 authoritative score、completion rate 和稳定性；
- adaptation regret：在线进化期间相对 A 的累计性能损失；
- adaptation cost：进化消耗的 token、工具调用、时间和版本数量；
- behavioral equivalence：面对相同抽象状态时是否选择功能等价的 Harness 修改。

### 8.4 任务无关性

- 从编码预测具体 task ID、答案或文件内容的能力应接近随机基线；
- 在新 task family 上仍应产生正向或至少方向一致的效果；
- 方法规则应引用组件角色和状态模式，而不是源任务专用名称；
- 直接答案泄漏探针必须失败，方法论迁移探针应成功。

### 8.5 压缩效率

在相同重建质量下测量编码长度；在相同编码预算下测量重建质量。目标不是最短编码，而是在可控复杂度下最大化忠诚度和迁移性。

## 9. 关键风险及处理

### 9.1 O 偷渡最终答案

O 可能通过变量名、常量、规则粒度或自然语言暗示编码任务答案。需要任务标识脱敏、词汇白名单、静态泄漏检查、对抗式解码探针和 held-out task 迁移共同控制。

### 9.2 M 依靠自身能力重新解决任务

高能力 M 可能忽略编码也能构造优秀 Harness。必须使用 no-code baseline，并比较编码带来的增量，而不是只看 `H_M` 的绝对分数。

### 9.3 只重建最终 Harness

最终结构相似不代表进化机制相似。必须在新轨迹中检验 `Pi_M` 的触发、修改、检验和回滚行为。

### 9.4 O 的事后归因失真

O 可能把偶然相关解释为因果规律。每条编码规则必须引用修改前后对照、局部 probe 或回滚证据；证据不足时标记 `correlational` 或 `uncertain`。

### 9.5 抽象过度或不足

过度抽象会失去可执行信息，抽象不足会保留任务细节。应通过多种编码粒度形成 Pareto frontier，而不是预先假设一个唯一粒度。

## 10. 成功、失败与停止条件

实验的最低成功标准：

1. 在相同信息预算下，`EvolutionCode` 的终态重建和过程重建均显著优于普通自然语言摘要、静态 Component Spec 和 no-code baseline；
2. `Pi_M` 在 held-out task 上能复现修改方向、触发条件和正向效果，而不只是复现源任务最终文件；
3. 删除时序、验证或效果字段会稳定降低重建质量，证明过程信息确实被使用；
4. 任务答案和具体 task ID 的泄漏探针不能显著解码，但方法论迁移仍有效；
5. 所有抽象规则可回溯到源轨迹证据，并能区分 supported、refuted 和 uncertain。

出现以下情况时应判定当前编码方案失败或停止扩展：

- 与等预算自然语言摘要相比没有稳定增益；
- M 的表现主要由自身先验解释，编码增量接近零；
- held-out task 上迁移消失；
- 编码可稳定泄漏任务答案；
- 只能重建终态，无法重建状态到修改行为的映射；
- 继续增加编码复杂度只提高源任务拟合，不提高忠诚度或迁移性。

## 11. 对项目对象模型的影响

如果实验支持核心假设，Kernel 的一等对象应从单一 `Harness Object` 扩展为：

```text
Harness Evolution Process
  = initial checkpoint
  + adaptation policy
  + typed revision events
  + evidence links
  + version checkpoints
  + budgets and invariants
  + authoritative outcomes
```

Kernel 继续以不可变对象保存每个 `H(t)`，但主要维护的是这些对象之间由状态、证据和修改规则连接而成的进化过程。Meta 的知识对象也不再只是“哪个 Harness 版本得分更高”，而是“哪类状态下，哪类修改策略经过哪些证据支持，并在什么范围内可迁移”。

## 12. 当前结论与后续演进点

该实验可以被理解为 Harness 进化过程的编码器/解码器检验：

```text
A 的在线进化轨迹
  -> O 编码为 EvolutionCode
  -> M 解码为 Harness / Adaptation Policy
  -> Kernel 在同分布与跨任务条件下检验
```

它比“把 Harness 写成 Spec”更接近目标，因为编码对象不是静态配置，而是状态、修改和效果之间的转移规律。最关键的实验判据不是 `H_M` 与 `H_A` 的文本相似度，而是 `Pi_M` 是否能在未见状态和未见任务上产生功能等价的进化行为。

后续应继续确定：状态投影的最小充分信息、mutation operator 的基础集合、O 的可见信息边界、任务泄漏测试，以及过程等价性的统计判据。
