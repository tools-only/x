# Agent 反射修改自身的 Orchestration

设计与实现记录。以同一个 Pi Agent 生成并交付演示文稿为首个工程场景。原始实现只让 Orchestration 直接更新对象，Harness 组件仍经 Binder 保存和发布；本次改动修正这一断点。没有运行 demo。

## 1. 一个活跃对象，两种视角

`AgentSelf` 是完整 Agent 根对象。其 Architecture 包含 Pi、模型与能力、组件、权限、当前运行状态和 **`self.orchestration`**。Orchestration 是 Agent 实际用来组织工作的版本化对象，包含角色、状态交接和一组统一的推进关系。

| 概念 | 在工程中的落点 |
| --- | --- |
| **Orchestration** | `self.orchestration`。Agent 可以构建或修改它，通用执行器从活跃版本读取并落实它。 |
| **Workflow** | 从 Orchestration 观察工作如何展开。哪些工作可启动、由谁执行、依赖哪些状态、什么条件下能交付。 |
| **Loop** | 从同一个 Orchestration 观察反馈如何作用。哪条事件或决定回到哪里，重启哪些工作，哪些旧证据因此失效。 |
| **Architect** | 同一个 Agent 构建与修改自身工作组织时承担的职责。 |
| **Meta Harness** | Agent 观察自己的工作方式、提出替代、改变实际运行并用后续证据判断效果的能力。Mirror、反射和执行证据支持这一能力。 |

Workflow 和 Loop 由**同一组运行关系**表达。一条把某个判断结果送回先前工作的关系同时参与任务推进和反馈回流，只有一个对象标识、一份定义、一个生效版本。执行器是受保护的基础设施。角色、判断协议、推进条件和反馈路径由 Agent 在授权范围内创建和修改。

## 2. 首轮工程合同

```ts
type Orchestration = {
  revision: number
  roles: RoleSpec[]            // 角色、动作及决策权
  slots: StateSlot[]           // 输入输出、产物引用及读写归属
  steps: WorkStep[]            // 角色、可用动作和输入输出
  decisions: DecisionSpec[]    // Agent 自己定义的判断接口
  transitions: Transition[]   // 正向推进、分支与反馈回流
}

type DecisionSpec = {
  id: DecisionId
  judge: RoleId
  question: string              // 要判断什么、按什么标准
  evidence: ReceiptCondition[] // 引用类型、范围、来源和新鲜度
  output: Schema               // Agent 自定义的结构化结果，包括所需分支
}

type Transition = {
  id: string
  from: StepId
  on: EventSelector            // 选择动作回执或指定 DecisionSpec 的结果
  requires: ReceiptCondition[] // 匹配当前状态、产物及回执版本
  to: StepId | 'complete'      // complete 仅表示运行生命周期结束
}
```

运行游标、产物哈希和回执属于 `self.run`，由实际动作更新。首轮实现单活跃步骤和主 Agent 的逻辑角色，可由同一会话在不同阶段承担。后续有需要时扩展并行和受限子会话。

### 通用判断协议

运行时提供结构定义、引用检查、回执读取、判断提交和规则执行。领域适配器提供真实动作及其事实类型。例如 PPT 提供渲染、截图和稿件版本，动作执行后才生成相应回执。业务结果没有全局枚举，适配器也不提供默认问题分类或验收分支。

1. Agent 用同一次反射提交 `DecisionSpec`、使用它的步骤和消费它的转换关系。它决定要问什么、谁判断、需要哪些证据、结果如何表示、结果驱动什么工作。后续仍可通过反射修改这些定义。
2. 进入该步骤时，运行时按活跃定义把问题、可用证据和输出协议提供给指定角色。该角色通过通用调用 `decide({ref, evidenceRefs, result})` 提交语义判断。宿主校验当前步骤、角色授权、引用归属、版本、输出结构和回执条件，然后生成带版本的判断回执。
3. 执行器用当前关系匹配回执及结果并推进工作。首版支持字段相等和集合是否为空等有限谓词。没有唯一匹配时保留当前状态并报告原因。Agent 可以补充证据或修改协议。运行时的权限、预算和正式交付完整性仍独立校验，任务目标也由用户提供。

- **自动看见。** 复用 [live_self 原型](../../demo/live_self_extension.ts) 的 provider 请求投影。每轮自动提供 Agent 根对象的范围摘要、当前 Orchestration 版本、运行步骤和新事实。可写权限挂在对象操作上，非活跃组件与受保护底座在根视图中仍有位置。
- **由 Agent 决定。** 在正常任务轮次，Agent 从阶段和反馈判断应该直接修产物、保持现有做法，还是改变自己的工作方式。宿主提供事实。交付路径要求记录当前版本的自审结果，允许保持或延期。审阅允许覆盖整个自身，首轮新增的结构写操作集中在 Orchestration。
- **直接生效。** `reflect({ref, baseRevision, edits, resumeAt, carry})` 在动作边界更新活跃对象。校验权限、基准版本、关系引用、回执版本及必要交接；切换失败时原状态继续可用。首轮在无在途动作时切换。成功后下一次动作、反馈及交付检查消费新版本。
- **实际执行。** 在 [PPT 扩展](../../demo/ppt_demo_extension.ts) 的 `office(render/look/deliver)` 及稿件更新入口接入通用解释器。由适配器产生带稿件哈希和渲染版本的动作回执。实验入口的既有 process 不重复控制这些边界。终端交付及完成标记都经过同一检查。渲染、画面读取和编辑保持真实执行。

## 3. 一次 PPT 任务中的修改

用户给资料、演示目标和预算。首轮用现有 HTML 演示渲染与交付路径。

| 时点 | 实际运行 |
| --- | --- |
| **v1 初稿** | 初始组织让 Agent 可编辑、渲染和交付。首轮渲染生成稿件 `h1` 的回执 `r1` 和总览。下一轮自动得到 Mirror 与回执。 |
| **Agent 审阅自身** | 示意运行中，Agent 发现总览不足以核对关键页面，决定改变自己的取证和推进规则。此诊断只用于解释机制，普通任务不提供诊断和候选结构。 |
| **原子切换 v2** | Agent 可以定义一个返回 `{pagesToChange: number[]}` 的判断协议，声明哪些截图是必要证据，并给空列表和有待处理页面分别定义后续工作。它通过一次反射让判断、核验步骤和转换直接生效，并显式交接 `h1/r1`。字段和分支由这次运行中的 Agent 构建。 |
| **新版真实执行** | 运行时按 Agent 的定义交给核验角色问题和证据。Agent 提交带实际 `office(look)` 回执的结果。若返回待处理页面，定义的关系使运行回到编辑。新稿重新渲染后，旧证据无法满足当前约束。若当前结果满足 Agent 的交付前置条件，再执行真实交付。 |

同一次反射同时改变了 Workflow 和 Loop。Workflow 多了真实核验阶段和交付前置条件；Loop 多了核验决定驱动的返工路径。二者由同一个 `self.orchestration` 生效。

## 4. 验收范围

| 要证明什么 | 可核验结果 |
| --- | --- |
| **通用协议确实控制执行** | 用两种形状不同、运行前未注册的判断结构通过同一个入口，并验证字段变化、证据条件和分支实际改变执行。拒绝伪造或过期证据、越权判断与旧版本结果。定向 PPT 接线需观察真实截图回执、反馈回流、新稿核验与正式交付。 |
| **Agent 自主构建并优化** | 在普通 PPT 请求中只给目标、资料和预算。观察 Agent 是否依据自身运行事实创建判断接口及反馈关系。若它进一步根据结果修订接口、证据要求或反馈去向，需验证修订后的版本被实际消费。有根据的保持也单独记录。定向轨迹只证明接线。 |
| **收益证据** | 后续用等预算对照和独立成品评价检验。首轮交付结论限定在活跃结构及其反馈关系是否真正可反射。 |

首轮聚焦同会话的单次结构切换、一次真实返工及交付。候选架构沙箱、进化方法自改和并行子会话作为后续里程碑。文档只描述工程设计。

### 真实模型探索协议

- 用项目自带 JPMorgan Chase 2021 Q3 的 15 页演示文稿任务，使用 AZ `qwen3.8-27b`、low thinking。保留现有累计预算保护，单次最多 20 分钟。普通启动只给 brief 和材料，不指定组件或编排结构。这是单样本探索。
- Harness 组件分别记录创建、修订与对应版本的真实消费。原有 PPT 组件沿现有发布路径运行，不能用发布回执或进入能力目录作为使用证据。
- Orchestration 分别记录由 Agent 自行提交的协议与关系、实际匹配的转换、后续修订和新版消费。交付及质量另记。定向脚本用于确认接线，真实模型轨迹用于观察自主行为。

### 首轮实现与证据

- PPT 运行路径使用 `LiveAgentSelf` 作为完整活跃对象，组件与 `self.orchestration` 共用同一根修订号和运行时快照。`reflect_component`、`reflect_orchestration` 都在验证后直接替换对象字段；组件源码不再经 workspace 文件、Binder 或发布副本。NativeRuntime 从该对象读取当前定义，工具注册和 provider context 从对象刷新。技能通过对象读取接口访问，不再落盘供 Pi skill loader 装配。
- 对象快照写入宿主的 `.harness/live-self.json` 用于恢复运行状态；这是运行时持久化，不是 Agent 先修改组件文件再由 Binder 装配。普通工作区仍保存任务资料与产物。导出交付时可将当前对象版本序列化为交付证据。
- 目前代码实现范围覆盖 PPT live runtime；ARC 的旧路径仍使用 Binder，未迁移。这个限制不改变 PPT Agent 的修改链路，但意味着不能据此声称整个仓库已全局移除 Binder。
- 本次没有运行 demo、测试或真实模型任务。因此功能正确、全链路可达、自主采用和净收益均未验证。之前定向脚本证据仅代表此前代码版本，不作为本次修改的验收证据。
- AZ 实验曾在模型请求前停止；当时环境未挂载项目 `.env`，也未注入 `OPENAI_API_KEY`。15 页任务已准备。后续确认实验可从 checkout 根目录运行下面命令；无需 `PPT_LIVE_ORCHESTRATION` 开关。使用非默认位置的 `.env` 时增加 `--dotenv <path>`。

```sh
PYTHONPATH=src python -m autoresearch_pi.ppt_demo \
  --root runs/ppt-live-orchestration-az-qwen38-jpmorgan \
  --run --model az/qwen3.8-27b --thinking low --seconds 1200
```

保留此容器的 `PPT_DEMO_BROWSER` 无头 Chrome 设置。运行后检查 `harness/live_agent_self.jsonl`、`harness/lifecycle.jsonl`、`harness/component_runs.jsonl` 和 `session.jsonl`。
