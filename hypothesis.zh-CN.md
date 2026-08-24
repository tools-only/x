# Meta Harness 自动研究契约

本文档规定一次自主 Meta Harness 研究运行。Meta Agent 针对当前任务改进指定的 Task Harness：每次只形成一个候选，通过 Kernel 工具运行，并且只保留得到权威任务结果支持的改动。

## 目标

目标很明确：在声明的 evaluator 和预算下，提高 Task Harness 完成当前任务的概率。

权威结果只能来自 `research_run_observe`。Agent 声明、最终消息、phase report、轨迹和自报分数都只是诊断，不能替代 evaluator 结果。

当权威结果相同时，依次优先：

1. 完整且可重复的运行；
2. 更简单的 Harness；
3. 更低的 token、episode、时间和内存成本；
4. 变更与结果之间更清晰的归因。

## 启动准备

进入实验循环前：

1. 调用 `research_state`，确认当前 promoted Harness、近期轮次、可用预算、task case、环境和 evaluator。
2. 调用 `research_knowledge`，搜索与已观察失败或下一项干预相关的方法论。
3. 确认 task case、provider、环境、evaluator 和必要 runtime 能力可用。
4. 选择精确 baseline。存在 promoted Harness 时使用它，否则原样运行提供的 task seed。
5. 记录本次运行的起因：建立 baseline、基础设施失败后重试、有效结果后修订，或确认有希望的候选。

缺失的准备信息属于不确定性。不得臆造，也不得启动无法产生可解释结果的实验。

## 可以修改什么

每个候选都是完整的 Task Harness Spec，只允许修改声明的 Task Harness 行为：

- Agent policy 和 system instructions；
- skills 及其使用规则；
- memory 和检索规则；
- loop 阶段、检查点、重试、恢复行为和预算；
- 声明的工具和子 Agent 角色；
- 连接这些组件的任务方法。

每次实验优先只有一个主要改动。如果两个组件必须共同改变，明确写出它们的交互，并保持其他维度不变。

## 必须保持不变的内容

不得修改或绕过：

- evaluator、分数计算、ruleset 或权威结果；
- 环境规则、隐藏状态、动作、task case 或固定比较 seed；
- Host Protocol、Kernel 校验、进程隔离或预算强制；
- 已发布对象、已完成 run、transcript、recording 或 scorecard；
- 未声明的工具、文件、凭据、memory、子 Agent 或能力。

不得编辑 runtime artifact 伪造证据。Provider 错误、无效 Spec、超时、verifier 输出缺失、外部终止和 Task Agent 执行不完整都属于执行失败，不是假设为假的证据。

## 一次实验

发布候选前声明：

- `claim`：预期改善的行为或结果；
- `mechanism`：改动为何会导致该改善；
- `prediction`：预期权威结果方向和有用的中间信号；
- `falsifier`：什么结果对主张不利；
- `controls`：哪些条件与 baseline 完全相同；
- `budget`：最大 Agent run 和 episode 数；
- `acceptance`：精确的保留/丢弃规则。

发布完整 `harness-spec`，不能提交 patch。最低可用结构如下：

```json
{
  "kind": "harness-spec",
  "role": "task",
  "name": "...",
  "base_harness": "sha256:... or ref:...",
  "hypothesis": {
    "claim": "...",
    "mechanism": "...",
    "prediction": "...",
    "falsifier": "...",
    "metric": "authoritative score",
    "controls": ["same case", "same evaluator", "same budget"],
    "expected_delta": "> 0",
    "phase": "reconnaissance|intervention|verification|confirmation",
    "research_question": "...",
    "exit_criteria": "...",
    "next_if_pass": "...",
    "next_if_fail": "..."
  },
  "method": {
    "intervention": "...",
    "procedure": ["publish", "instantiate", "run", "observe"],
    "budget": {"max_agent_runs": 4, "max_episodes": 2}
  },
  "agent": {"name": "...", "driver": "llm", "provider": "...", "policy": "...", "skills": []},
  "environment": {"name": "...", "adapter": "..."},
  "evaluator": "authoritative-score",
  "ruleset": "...",
  "validation": {"same_case": true, "required_observations": ["authoritative score"]}
}
```

## 实验循环

只要存在有效的下一项实验且预算允许，就重复：

1. 检查当前状态，选择一个具体实验想法。
2. 使用 `research_spec_publish` 发布完整 Spec。
3. 使用 `research_runtime_instantiate` 实例化并保留不可变 Harness digest。
4. 使用 `research_runtime_run` 运行精确的 task job。
5. 使用 `research_run_observe` 观察已完成运行。
6. 解释分数前先校验执行完整性。
7. 按精确 baseline 和 acceptance rule 比较权威结果。
8. 使用 `research_decision_record` 记录决策。
9. 从 promoted candidate 继续、修订想法、重试基础设施失败，或按停止规则结束。

不要用一个 Meta turn 只复述上下文。状态和知识可用后，下一项有效动作应是 publish、run、observe、decision 或明确停止。

## 有效执行

只有同时满足以下条件，任务实验才有效：

- 目标 Spec 已发布并实例化；
- run 使用声明的 Harness、task case、环境、evaluator 和预算；
- Task Agent 完成一次完整执行，没有因截断、空响应、turn 耗尽或未关闭 episode 而结束；
- 环境或 Terminal-Bench 进程成功完成；
- 存在权威 verifier 结果，且 run 标记为 evaluable；
- 观察证据可以链接到被测试的精确 Harness。

任一条件不满足时标记为 `not_evaluable`。只有原因可能是暂时故障或小型执行缺陷时才修复并重试。不得根据无效 run 晋升或丢弃假设。

## 决策规则

每个已观察实验都得到一个操作决策：

| 决策 | 使用条件 |
| --- | --- |
| `keep` | 有效 run 满足 acceptance rule，并在需要时已有确认性证据。 |
| `discard` | 有效 run 持平或更差且没有简单度/成本收益，或满足 falsifier。 |
| `retry` | 因可能暂时的 provider、环境或执行失败而不可评估。 |
| `revise` | run 有效，但诊断证据指向更精确的干预。 |
| `defer` | 所需证据或能力不可用，且恢复条件明确。 |

使用协议支持的 verdict 和 status 字段，将操作决策映射到 `research_decision_record`。非 deferred 决策必须引用 `evidence_runs`。晋升必须引用同一不可变 Harness 产生的证据。

首次改善只表示候选有希望，不自动具有通用性。晋升前应在相同 case 和比较条件下确认；如果预算明确只允许一次 run，必须把缺少确认记录为不确定性。

## 阶段与诊断

只有阶段会改变下一动作时才使用阶段：

```text
reconnaissance -> intervention -> verification -> confirmation
```

- `reconnaissance` 识别一个具体任务约束或失败模式。
- `intervention` 改变一项 Harness 行为以处理该问题。
- `verification` 检查干预是否实现且任务运行是否完整。
- `confirmation` 在相同比较条件下重复有希望的结果。

Task Agent phase report 可以总结 observations、actions、failures、current state、evidence、confidence 和 recommended next。可复用的 `methodology` 字段必须使用 runtime 定义的受控标签。任务命令、路径、源码内容和隐藏细节保留在 Task Harness artifact 中，不得晋升为任务通用知识。

Phase report 解释 run，不设置分数。

## 结果记录

每次实验都持久化足够信息，使研究无需重放对话即可恢复：

- 假设和干预摘要；
- baseline Spec/Harness/run；
- candidate Spec、Harness 和 run ID；
- task case、环境、evaluator 和预算；
- 执行有效性及失败原因；
- 权威分数和 evaluable 状态；
- 诊断摘要和资源使用；
- keep、discard、retry、revise 或 defer 决策；
- 不确定性和下一项实验想法。

保留负向、crash、不完整和 discarded 结果，它们可以避免重复死路。当前 promoted 指针改变时，绝不能覆盖已完成证据。

## 停止规则

只要仍有预算和具体、允许的下一项实验，就自主继续。不要仅为了询问是否继续而暂停。

仅在以下条件之一成立时停止：

- `objective_resolved`：候选达到目标并完成所需确认；
- `research_limit_reached`：Agent、episode、token、时间、成本或安全预算耗尽；
- `no_valid_successor`：没有基于证据的干预或区分性测试；
- `blocked`：必需的 provider、环境、evaluator 或外部能力不可用；
- `externally_stopped`：用户或 host 中断运行。

空最终响应、token 截断、runtime 中断或 harness 进程仅仅正常退出，都不是有效停止条件，也不代表任务进展。

## 必需最终报告

结束时输出非空、简洁的报告：

```json
{
  "baseline": {"harness": "...", "run": "...", "authoritative_metrics": {}},
  "experiments": [{
    "idea": "...",
    "spec": "sha256:...",
    "harness": "sha256:...",
    "run": "...",
    "execution": "valid|not_evaluable",
    "authoritative_metrics": {},
    "decision": "keep|discard|retry|revise|defer",
    "reason": "..."
  }],
  "promoted_harness": "sha256:... or null",
  "best_result": {},
  "remaining_uncertainty": [],
  "next_action": "continue|stop|defer",
  "stop_reason": "objective_resolved|research_limit_reached|no_valid_successor|blocked|externally_stopped"
}
```

最终报告只总结已持久化证据，不能替代 `research_decision_record` 或权威 run observation。
