# ARC 真实运行观测预期

状态：当前实现的运行观测规范

日期：2026-09-21

适用范围：`arc-agi-3-e2e` treatment 模式、真实模型 provider、官方 ARC 在线环境

## 1. 目的

本文规定当前 Self-Harness 方案在一次真实 ARC 运行中应当留下什么可核验的行为和证据。它用于：

- 区分“组件已创建”“组件已组装”“组件已进入 provider 输入”“组件被实际使用”“组件改善了 ARC 表现”；
- 检查主 Agent、Auto-Research child、Harness runtime 与 ARC adapter 是否遵守各自边界；
- 给真实运行的现场观察、事后审计和验收报告提供统一模板；
- 防止仅凭 pytest、脚本化 provider、某个 JSONL 文件存在或 `status=completed` 就声称真实闭环成立。

本文描述的是按当前代码应当出现的观测，不是理想化的未来设计。一次自然运行可以合理地不调用 Auto-Research、不创建组件或不修改 assembly；这本身不是失败。若目标是验证完整 Self-Harness 能力，应通过多场景验收矩阵覆盖五类组件，而不是强迫每局游戏做无意义的修改。

## 2. 运行定义与前提

本文所称“真实 ARC 运行”同时满足：

1. 使用 `arc-agi-3-e2e` runner；
2. 使用本地 ARC-AGI-3 checkout 中的官方 Python SDK；
3. 使用官方在线 ARC 环境和有效 `ARC_API_KEY`；
4. 主 Agent 与可选 child 均调用真实 provider，而不是测试 double 或手写事件；
5. 使用新的空输出目录，保留完整运行产物；
6. treatment 模式启用，Self-Harness 组件池从空开始。

典型启动命令以项目 README 为准：

```bash
export PYTHONPATH='D:/autoresearch_pi_project/src'
'D:/conda/python.exe' -m autoresearch_pi.cli arc-agi-3-e2e \
  --game 'ls20-9607627b' \
  --root 'D:/autoresearch_pi_project/runs/arc-ls20-treatment'
```

`arc-harness-smoke` 不属于本文定义的真实 provider / 真实在线环境运行。它可以证明真实 runner 内的桥接和生命周期链路可达，但不能证明模型策略质量或 ARC 游戏表现。

## 3. 固定边界与术语

### 3.1 Harness 的四个边界

| 边界 | 承载者 | 职责 | 不负责 |
| --- | --- | --- | --- |
| 组件创建/修改 | 主 Agent 发起，`task_harness(action=change)` 统一入口，native executor 落盘 | 根据当前证据创建、更新或退役组件，生成版本与回执 | 不自动选入本轮 assembly |
| 版本化组件池 | task-local 持久资源文件 | 保存五类不可变精确版本及其状态、依据和依赖 | 不等于 provider 已看到或模型已使用 |
| Harness 组装 | 主 Agent 发起，`task_harness(action=assemble)` | 按当前情境选定精确组件版本和 `task_prompt` contributions，并记录理由、预期、独立 CAS revision | runtime 不替主 Agent做语义选择 |
| Harness runtime | Pi extension、native executor、provider/ARC 边界 | 校验、投影、暴露、门禁、执行、持久化回执与恢复 | 不判断哪个方法在语义上更好，不自动采用研究结论 |

### 3.2 五类持久组件

持久 Harness 组件只有：

- `memory`
- `system_prompt`
- `skill`
- `tool`
- `subagent`

`task_prompt` 不是第六类组件。它是来源无关的 assembly 输出通道，可以引用精确版本的 memory、skill/method、finding、validation/hypothesis、research plan/report 或其他 task-local source。研究产物只有在主 Agent 明确采用或组装后，才会成为后续 provider 输入中的指导。

### 3.3 选择语义

- `active` / `eligible` 只表示组件可被选择，不表示已经选择。
- 第一次显式 assembly 之前，为兼容旧行为，所有 eligible active 组件均可被投影。
- 第一次显式 assembly 之后，以 assembly 中的精确引用为准：system prompt、memory/context、skill、dynamic tool 与 saved subagent 都受选择门禁。
- 未选择组件仍保留在 pool 中；不应被删除、偷偷降级到旧版本或通过历史 transcript 重新激活。
- ephemeral subagent 不是 saved Harness 组件，仍可由主 Agent按现有能力临时启动。

### 3.4 唯一语义决策者与环境动作调用者

主 Agent 是唯一决定是否创建、采用、组装或修改 Harness 的语义决策者，也是唯一可调用 `arc_action` 的角色。Auto-Research child 只接收 parent 发布的固定只读 snapshot，可读取被授权的精确证据，不能连接 live ARC bridge，也不能执行 ARC 动作。

## 4. 预期时序

### 4.1 直接决策路径

```text
官方 ARC observation
  -> bridge 持久化 canonical state / transition
  -> main Agent provider request
  -> main 选择直接行动，或先 change 组件池
  -> main 可选地 assemble 精确组件/提示来源
  -> 下一次 provider request 才反映新 assembly
  -> main 读取 skill、调用 tool/subagent，或引用指导形成动作决策
  -> main 以 arc_action 结束当前 decision cycle
  -> 官方 ARC action result 持久化并进入后续 main 输入
  -> main 在后续 evidence window 中评估、修订、退役或保留该介入
```

新建或修改发生在某个 provider request 期间，因此不能倒推为它影响了这个已经开始的 request。通过 assembly 选择的组件应从后续 provider request 起可见。

### 4.2 Auto-Research 路径

```text
main Agent
  -> 发布固定 evidence/resource snapshot 并启动 child
  -> child 在隔离 Pi session 中研究、读取精确引用、提交结构化报告
  -> main 收到 capsule / report ref / proposal
  -> main 显式 adopt、拒绝、延后或忽略
  -> runtime 对整条 route 做版本预检
  -> native executor 以零部分写入语义应用 route
  -> main 可选地 assemble 新组件或研究来源
  -> 后续 provider request 暴露所选内容
  -> main 独立决定实际工具/子 Agent 使用与每一个 ARC action
```

Child 报告完成、proposal 获批、route 编译完成和 Harness 已修改是四个不同事件；均不能单独证明该结果后来被 main 使用。

## 5. 分阶段观测预期

### 5.1 启动、任务作用域与桥接

应观察到：

- 输出目录是新建或为空，运行不会覆盖既有结果；
- `.task-scope.json` 固定本次任务作用域；
- `bridge-ready.json` 表示 ARC bridge 已就绪；
- `task-harness-entry.jsonl` 记录 treatment 首次进入时的空组件状态；
- 主 Agent 的有效 system prompt 明确告知 Self-Harness 从首个 decision cycle 可用、应按当前成本收益决定是否 inspect/change/assemble，而不是要求每轮固定使用；
- `provider-telemetry.jsonl` 开始记录真实 provider request/response；
- `context-token-debug.jsonl` 按 provider turn 记录 size-only 上下文分解和 provider usage 链接；
- `pi-runtime-status.json`、`pi-events.jsonl` 持续反映 Pi session 与事件流，而不是仅在正常结束时一次性生成。

通过标准：scope、game/run identity、bridge 和 Pi session 彼此一致；provider 事件确实来自所选真实模型。

红旗：复用含旧资源的目录、只有离线拼装的 JSONL、bridge 未进入 ready、provider telemetry 没有真实请求、任务 scope 在运行中改变。

不可据此推断：bridge ready 不表示 Agent 能解题；provider request 成功不表示 Harness 已发生或产生收益。

### 5.2 Canonical ARC observation 与 action cycle

主要证据：

- `bridge-events.jsonl`
- `execution-observations.jsonl`
- `pre-action-states.jsonl`
- `execution-signals.jsonl`
- `task-checkpoint.json`
- `task-checkpoint-events.jsonl`

应观察到：

1. ARC observation 和 action result 先由 bridge / observation 日志持久化；派生的 shape、delta、pattern 或 signal 不能替代 canonical observation。
2. `arc_action` 每个 decision cycle 最多执行一个真实环境动作，并作为该 cycle 的最后调用结束当前 Pi turn。
3. action 的 `decision` 元数据不转发给官方 ARC action parser，只进入 task checkpoint / evidence 链。
4. 每个真实 action result 必须在下一次语义 action 决策前进入后续 main Agent 输入；不能由 runtime 静默消化后直接代 main 决策下一步。
5. 网络未知、响应丢失或结果歧义必须记录为需要 reconciliation 的未知状态，不能盲目重试可能已经执行的动作。

若声称某个 Harness 资源影响了动作，`arc_action.decision.basis_refs` 应包含实际采用的精确版本引用，并能向前连接到 assembly/provider exposure。没有该引用时，可以说资源先前被暴露或读取，不能说它影响了该动作。

### 5.3 组件创建/修改与版本化 pool

主要证据：

- `task-harness-change-requests.jsonl`
- `task-harness-change-receipts.jsonl`
- `task-memory.jsonl`
- `task-system-prompt.jsonl`
- `task-skills.jsonl` 及对应 `SKILL.md`
- `task-tools.jsonl`
- `task-subagents.jsonl`
- `harness-decisions.jsonl`

应观察到：

- 主 Agent 的 change 请求包含 component、operation/candidate、`decision.basis_refs`、reason 与 expected；
- executor 返回 native receipt，并在对应资源库中追加新版本；
- update 创建新版本，不覆写旧版本；retire/状态变化同样可审计；
- 精确依赖、来源和 decision id 能够向前追溯；
- 一个 change 请求的成功仅表示版本已提交到 pool。

创建后没有 assembly、provider exposure 或 actual-use 记录是允许的，说明 Agent 创建了候选但尚未采用。不能把它计为 Harness 使用成功。

### 5.4 Assembly 与下一 provider 输入

主要证据：

- `task-harness-assemblies.jsonl`
- `task-harness-assembly-receipts.jsonl`
- `task-prompt-assemblies.jsonl`
- `task-system-prompt-assemblies.jsonl`
- `task-harness-context-exposures.jsonl`
- `provider-telemetry.jsonl`
- `context-token-debug.jsonl`

应观察到：

- 每次显式 assembly 使用独立、单调递增的 CAS revision；
- component selection 使用精确版本引用，不使用含糊的“最新版”意图；
- assembly decision 记录 `basis_refs`、reason 和 expected；
- `task_prompt` 每个 contribution 记录 layer、source ref、内容 hash；selected 与 suppressed 分开；
- system overlay、context projection、skill index、dynamic tool surface 和 saved subagent surface 与当前 assembly 一致；
- `provider-telemetry.jsonl` 中 `measurement_basis=provider_payload` 的 assembly 记录包含实际 payload 的 resource refs 与 payload hash；
- `context-token-debug.jsonl` 只证明各层大小和 usage，不复制 prompt body，也不单独证明语义正确；
- 变更应出现在 assembly 之后的下一次 provider request，而不是已经发出的请求。

历史 transcript 中未选择组件的 payload 应被 redaction/omission marker 替代，旧文字不能绕过当前 assembly 继续作为 active guidance。

### 5.5 暴露、读取、实际使用和动作影响

四个层次必须分开：

| 层次 | 最低证据 | 可以声称 | 不能声称 |
| --- | --- | --- | --- |
| Pool committed | 组件文件 + change receipt | 精确版本存在且可选择 | provider 已看到 |
| Assembled/exposed | assembly receipt + provider-payload telemetry / context exposure | 精确版本进入有效输入或能力表面 | 模型采用了内容 |
| Actual use | 真实 tool/saved-subagent invocation，或动作明确引用 exact refs | 组件在具体决策流程中被调用/采用 | 使用产生正效果 |
| Observed effect | 后续 observation window + effect assessment | 在限定窗口中结果 supported/refuted/inconclusive | 对 ARC 总体得分有因果收益 |

各组件的 actual-use 口径：

- `memory` / `system_prompt`：投影只算 exposure。若声称影响动作，需要该动作或后续决策显式引用精确版本，并有相应 evidence 链。
- `skill`：context index 和 `read(SKILL.md)` 都不自动等于 task use。方法被用于具体 plan/action 时，应由 exact ref 连接到该决策。
- `tool`：`task-tool-events.jsonl` 中成功的 `invoked`/`completed`，以及 `harness-observations.jsonl` 中对应执行记录，才是 actual invocation。
- saved `subagent`：`subagent-invocations.jsonl` 中匹配 agent id/version 的真实 invocation 才算使用；仅投影名称不算。
- `task_prompt` contribution：它不是组件；应以 contribution 的 source ref/hash、provider exposure 和后续决策引用判断采用情况。

`harness-observations.jsonl` 的 exposure 记录证明 runtime 边界生效，但 `effect_observed=true` 在这些记录中通常表示“暴露动作已发生”，不是“任务质量已经改善”。

### 5.6 Auto-Research 与 parent adoption

主要证据按实际发生的功能包括：

- `auto-research-sessions.jsonl`
- `auto-research-runs.jsonl`
- `auto-research-reports.jsonl`
- `auto-research-plans.jsonl`
- `auto-research-agenda.jsonl`
- `auto-research-comparison-bundles.jsonl`
- `auto-research-continuations.jsonl`
- `auto-research-harness-routes.jsonl`
- `auto-research-harness-route-receipts.jsonl`
- `auto-research-adoption-events.jsonl`
- `subagent-progress.jsonl`
- `subagent-provider-telemetry.jsonl`
- `subagent-context-token-debug.jsonl`

应观察到：

1. Parent 启动 child 时发布固定、只读、带 exact refs 的 evidence/resource snapshot。
2. Child 可以分页读取被授权材料，但不能读 live bridge，也没有 `arc_action`。
3. Child report、method abstraction、Harness candidate、hypothesis、plan 或 experiment request 均是研究产物，不会直接修改 Harness。
4. Parent 对当前行动价值和采用方式作显式决定；采用事件与 route receipt 可追溯到研究 run/report/proposal。
5. Route 在任何 native 写入前预检全部显式版本。任一步版本过期，整条 route 失败且没有部分组件写入。
6. 研究方法或计划要成为下一轮指导，必须被 parent 明确组装为 component 或 `task_prompt` contribution。
7. Child 请求 ARC experiment 时，每一个真实动作仍由 main Agent在动作预算内逐个批准并发出；不存在 child 动作 lease 或自动接管。

以下链路才足以声称“研究结果后来影响了真实动作”：

```text
research report exact ref
  -> parent adoption decision
  -> successful route/native change receipt（若需组件化）
  -> explicit assembly
  -> provider-payload exposure
  -> concrete use or arc_action basis_refs
  -> later ARC observation/effect assessment
```

其中任一段缺失，都应把结论降级到已完成的那一层。

### 5.7 Provider `length` continuation 与 context compaction

主要证据：

- `auto-research-continuations.jsonl`
- `subagent-continuations.jsonl`
- `provider-telemetry.jsonl`
- `subagent-provider-telemetry.jsonl`
- `task-context-compactions.jsonl`
- `task-checkpoint.json`
- `task-checkpoint-events.jsonl`

Provider 返回 `length` 时，应观察到：

- Auto-Research 在同一 research run、同一 Pi native persistent session 中继续；
- ordinary `delegate_task` 在同一 invocation/native session 中继续；
- continuation 记录前后 checkpoint/progress，而不是另起一个无上下文 child；
- main 的 task checkpoint、exact refs、未完成 validation window 和 evidence progress 在恢复后仍可读取；
- compaction 仅把旧大对象替换为可恢复 marker，不改变 canonical 文件；
- 后续 provider request 仍遵守当前 assembly，未选择的旧组件不会因 transcript 残留而复活。

这只能证明机械持续性和可恢复性。原文仍在磁盘、checkpoint 可加载、session id 未变，都不能证明模型在语义上保留了所有关键假设、反证和计划。

### 5.8 结束、回顾与官方结果

主要证据：

- `task-level-reviews.jsonl`
- `effect-assessments.jsonl`
- `task-method-lifecycle.jsonl`
- `method-evolution-audit.json`
- `harness-observations.jsonl`
- `arc-scorecard.json`
- runner `summary.json`

应观察到：

- effect assessment 使用介入之后的 observation window，结论允许为 `supported`、`refuted` 或 `inconclusive`；
- review 区分方法正确性、方法实际使用和方法收益；
- 没有 actual-use evidence 的资源不能获得正向 use credit；
- 官方 scorecard 与 Harness 自评分别报告；
- 单局的 positive effect assessment 不应直接被解释为总体 ARC 性能提升；
- “Harness 改善任务表现”需要有效的 paired benchmark comparison，而不仅是 treatment 单跑。

## 6. 证据矩阵

| 阶段 | 关键产物 | 最低通过证据 | 典型红旗 |
| --- | --- | --- | --- |
| 启动 | `.task-scope.json`, `bridge-ready.json`, `pi-runtime-status.json` | scope、bridge、session、game 一致 | 复用旧目录或 scope 漂移 |
| Provider 边界 | `provider-telemetry.jsonl`, `context-token-debug.jsonl` | 真实 request/response；payload basis 与 usage 可连接 | 只有脚本事件或 fallback size snapshot |
| ARC 状态/动作 | `bridge-events.jsonl`, `execution-observations.jsonl`, `pre-action-states.jsonl` | 每个 action 有前态、结果和后续 parent 可见性 | action result 未回到 main；未知结果被重试 |
| Pool mutation | change request/receipt + 五类资源文件 | 精确新版本与 decision/basis refs 对齐 | 覆写旧版本、无回执、部分写入 |
| Assembly | assembly/receipt + prompt/system assemblies | revision、exact refs、selected/suppressed 对齐 | active 被误当 selected；旧 transcript 绕过门禁 |
| Provider exposure | telemetry harness assembly + context exposure | 下一实际 payload 包含所选 refs/能力 | 只看组件文件就声称已暴露 |
| Actual use | tool/subagent events 或 action exact refs | 具体调用/决策引用精确版本 | 把 skill read、memory projection 当 actual use |
| Research adoption | report -> adoption -> route receipt -> assembly | 链路完整且 parent 明确决策 | child report 自动改 Harness |
| Continuation | continuation logs + same run/invocation/session | `length` 后从 checkpoint 继续 | 新建无关 session 或重复整个任务 |
| Outcome | effect assessments + scorecard + paired comparison | 时间顺序正确、窗口明确、官方结果独立 | 用自评替代 scorecard；单跑声称因果收益 |

## 7. 失败与负向预期

负向场景也是必须可观察的正确行为。

### 7.1 Stale assembly revision

预期：返回结构化 revision conflict；不追加新的成功 assembly；当前 assembly 与动态能力表面保持不变。

失败表现：last-write-wins、生成跳号的成功 revision、部分切换 tool/system/context。

### 7.2 Stale route component version

预期：route receipt 标记 `component_version_conflict` 或等价结构化冲突；状态停在 preflight failure；五类组件文件均无本 route 的部分 mutation。

失败表现：前几个组件已写入、后一个才失败；runtime 自动改用最新版继续执行。

### 7.3 未选择的 skill/tool/saved subagent

预期：在实际使用边界 unavailable/blocked；pool 记录保持完整；不产生成功 actual-use 记录。历史 transcript 或旧 tool schema 不得绕过门禁。

### 7.4 缺失或失效的 prompt source/dependency

预期：该 contribution 被 suppressed 并记录原因；provider 输入不含其正文；不存在静默 fallback 到相似名称、旧版本或无版本来源。

### 7.5 Provider `length`

预期：写 continuation；保持同一 logical run/invocation 和 native session；加载 runtime checkpoint/evidence progress；最终报告只规范化落盘一次。

失败表现：把 `length` 当成功结束、重复提交两个 final reports、另起 child 丢失精确引用。

### 7.6 ARC action 结果未知

预期：记录 transport/outcome ambiguity 和 reconciliation need；在确认官方状态前不重复提交相同动作。

失败表现：把 timeout 自动当作未执行并重试。

## 8. 验收层级与允许结论

| 层级 | 验证内容 | 允许结论 |
| --- | --- | --- |
| L0 | process、bridge、Pi parent/child 可达 | 运行链路启动并能交换事件 |
| L1 | pool、精确版本、CAS assembly、失败原子性 | 版本与组装机制正确 |
| L2 | provider input、selection gate、actual-use boundary | 所选内容进入真实输入，未选内容被阻止 |
| L3 | research -> parent adoption -> mutation -> assembly -> later use/action trace | Self-Harness 生命周期在真实 runner 中闭合 |
| L4 | 真实 provider 能自主作出合适的研究、组装和修订决策 | 当前模型在这些场景中表现出有效策略质量 |
| L5 | 官方 ARC 任务表现或相对 control 得到改善 | 在规定样本和对照下观察到任务收益 |

确定性 `arc-harness-smoke` 最多支持 L0-L3 的 wiring/lifecycle 结论。L4 必须使用真实 provider；L5 还必须结合官方 scorecard、足够样本和有效的 control/treatment 配对。

五类组件验收矩阵必须覆盖 `system_prompt`、`skill`、`memory`、`tool`、`subagent`，并验证语义 tool output，而不只是 `status=completed`。自然单局没有选择某类组件不算违规；验收 campaign 应使用独立场景覆盖。

## 9. 建议的现场报告模板

```markdown
# ARC real-run report

- run root:
- game / run id:
- started / ended:
- main provider/model:
- child provider/model:
- treatment/control:
- git commit + dirty state:
- ARC SDK checkout identity:

## Runtime result

- bridge ready:
- Pi session completed/interrupted:
- official scorecard:
- action count / budget:
- unresolved action ambiguity:

## Harness trace

- pool mutations: [component exact refs]
- assemblies: [assembly refs and revisions]
- actual provider-payload exposures: [request ids -> refs]
- actual uses: [event/action ids -> refs]
- suppressed/blocked refs and reasons:

## Auto-Research trace

- research run/report refs:
- child snapshot refs:
- parent adoption decision:
- route preflight/receipt:
- later assembly/use/action refs:
- continuation events:

## Outcome assessment

- claimed intervention:
- evidence window:
- verdict: supported/refuted/inconclusive
- official task outcome:
- paired control available: yes/no

## Acceptance verdict

- L0:
- L1:
- L2:
- L3:
- L4:
- L5:
- missing evidence / non-claims:
```

## 10. 当前已知缺口与禁止声称的结论

以下事项仍在 `docs/deferred-research-todos.md` 中未完成，真实运行报告必须明确保留：

- ARC adapter、Agent runtime、Agent policy/research 的模块职责仍未全面物理拆分；当前 extension 内仍有混合职责。
- Child 使用 parent 发布的固定只读 snapshot，没有 live bridge 访问；这保证动作边界，但尚未验证所有研究任务所需的信息新鲜度。
- Context compaction、checkpoint 和 exact refs 已提供机械恢复，但跨压缩认知连续性的语义质量尚未证明。
- 真实 provider 的自主选题、方法抽象、assembly 选择和修订质量尚需真实运行验证。
- Skill/memory/system prompt 到具体 ARC 动作的影响关系，只有在 exact refs 与后续 evidence 完整连接时才能声称；暴露或读取本身不够。
- 单次真实 treatment run 不能证明 Harness 对 ARC 表现有因果收益；需要官方结果、配对 control、足够样本与预先规定的比较口径。
- 主 Agent 仍是唯一语义决策者和真实环境动作调用者；任何观察都不应被解释为 runtime 或 child 已获得环境控制权。

因此，一份合格报告可以说“链路可达”“精确版本进入了真实 provider payload”“某工具被真实调用”或“某动作显式引用了某方法”；除非达到相应证据层级，不应写成“研究自动改进了 Agent”“模型保留了全部长期认识”或“Self-Harness 提升了 ARC 成绩”。
