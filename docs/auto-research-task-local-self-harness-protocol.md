# Auto-Research → Task-local Self-Harness 机制说明

状态：当前实现说明（as implemented）  
协议版本：`auto-research-report-v1` / `auto-research-harness-delivery-v1` / `harness-router-v1`  
适用范围：当前 task 内的 `system prompt`、`skills`、`memory`、`tools`、`subagents`

本文说明当前代码中从 Auto-Research child 产出到 parent Agent 修改自身 task-local harness 的完整协议、数据结构、责任边界、确定性路由规则和持久化状态。本文是实现说明；运行时路由的唯一可执行真值源仍是 `demo/pi_auto_research_harness_router.ts`。

## 1. 设计目标与不变量

完整目标链路是：

```text
真实任务 observation / task-local resource
    ↓ parent 显式选择 evidence/resource/context
isolated Auto-Research child
    ↓ 研究、验证、形成 findings
structured report + harness deliveries
    ↓ child-side propose / approve | reject | defer
hash-bound approval ledger
    ↓ parent parse + deterministic code router
versioned route plan
    ↓ parent runtime 自动调用 native route applier
Pi extension 注册的 task_* 原生执行入口
    ↓
task-local system prompt / skill / memory / tool / subagent
    ↓
下一轮 Pi provider context 或 tool surface 生效
```

必须始终满足以下不变量：

1. 只有五类 harness 组件：`system_prompt`、`skill`、`memory`、`tool`、`subagent`。不存在 `guidance` 或第六类组件。
   `task_prompt` 不是第六类组件，而是 `task_memory` 通过 Pi `context` hook 产生的动态 user/task context 投影；`task-checkpoint` 也只是 runtime 状态记录。
2. `finding` 是研究结论，不是 harness mutation 命令；finding 本身不会自动进入 memory。
3. 只有 child 明确构造并完成审批的 `HarnessDelivery` 才进入代码路由器。
4. 审批属于 child。parent 不暴露 `research_approval`，也不进行第二次审批。
5. child approval 只批准和绑定交付内容，不修改 parent harness。
6. parent 只执行代码编译出的 route，不从自由文本重新猜测目标组件。
7. 每个 approval 绑定完整 canonical delivery 的 SHA-256；报告摘要不能替代正文。
8. findings、proposals、report body 和 delivery body 不设本地固定数量或字符上限。
9. provider context/token 边界、分页和归档可以存在，但 canonical artifact 必须可恢复，且边界必须对 Agent 可见。
10. 所有派生资源都是 task-local；新任务从空资源开始，同任务恢复通过版本引用继续。
11. `fulfilled` 只表示 mutation 已落实；它不等于组件已经被使用、产生正向效果或提高 benchmark 得分。

### 1.1 Native capability availability

`task_skill`、`task_memory`、`task_system_prompt`、`task_subagent` 以及（当
adapter 提供 task-tool 实现时）`task_tool`，由 Pi extension 在 Agent 回合
开始前注册。Agent 不需要额外执行一个“注册该工具”的仪式：
`task_harness(action=start)` 暴露精确的创建入口，下一轮 provider context 会
包含其 live descriptor。若 host 没有注册某个 native entrypoint，parent 无法
仅凭 route 或 delivery 正文凭空制造 Pi registration；route 必须诚实地进入
`partial`/`unsupported` 并携带恢复引用。`task_tool` 在 adapter 提供 factory
时可执行纯声明式 program；需要不存在的 adapter authority 的操作属于
capability gap，不能伪造成功或静默扩大 host 权限。

## 2. 三类对象必须严格区分

### 2.1 Finding：研究结论

Finding 表达 child 对问题、证据、结论和不确定性的研究结果。它可以是正面、负面、不确定或未解决结果。

Finding 的用途包括：

- 保留研究结论；
- 解释为什么应当或不应当产生一个 harness delivery；
- 为 delivery 的 `basis_refs` 提供依据；
- 指定后续验证计划。

Finding 不会被 router 直接读取，也不会自动转成 memory。

### 2.2 HarnessDelivery：可路由的 harness 交付

Delivery 是 child 根据一个或多个 findings/evidence 提炼出来的、具有明确用途和运行属性的 mutation 候选。它必须回答：

- 内容是什么；
- 语义类别是什么；
- 是创建、更新、复用还是退役；
- 在什么范围和条件下有效；
- 如何执行；
- 是否需要常驻上下文；
- 依据是什么；
- 何时重新检查。

路由单位是单个 delivery，不是整份 report，也不是单个 finding。

### 2.3 Route：parent 可执行的确定性计划

Route 是代码路由器对一个已审批 delivery 的编译结果。它包含精确 native tool call、依赖顺序、delivery hash、approval ref 和状态。`auto_research` 返回前，parent runtime 自动执行所有 `ready` route；`task_harness(action="apply_route")` 仅用于显式恢复或幂等重放。

### 2.4 Runtime 状态与 research-only 不是 harness 组件

`task-checkpoint.json`/`task_checkpoint` 保存当前 task 的 subgoal、工作摘要、pending operation、最近环境和可供 activation 求值的状态。它属于 Pi extension 的恢复与 provenance 层，不能作为 `HarnessDelivery.target`，也不会被 router 当成第六种 harness。

`research_only` 是 route 的 disposition，表示 finding/report 只保留在 canonical research report、approval ledger 和 provenance 中，不产生任何 native mutation step。它不是一个可注册、可读取或可执行的组件。

## 3. Parent 与 Child 的责任域

| 能力/责任 | Parent Agent | Auto-Research child |
|---|---|---|
| 选择研究问题 | 是 | 接收并研究 |
| 选择传入的 evidence/resource/context | 是 | 只能读取显式授权范围 |
| 读取 parent 完整 transcript | 否；只传选择后的窗口 | 否 |
| 执行环境 action | 是 | 否 |
| 修改 parent harness | 是，runtime 自动执行 route（可用 route replay 恢复） | 否 |
| 创建 finding | 可在主研究资源中创建 | 在 structured report 中交付 findings |
| 创建 HarnessDelivery | 不从自由文本补造 | 是 |
| propose/inspect/approve/reject/defer | 不拥有该工具 | 是 |
| 绑定 delivery hash | 校验 | 是，approval ledger 生成 |
| 编译 route | 触发 parent runtime 的代码 router | 否 |
| 决定实际 apply 时机 | 是 | 否 |
| 执行 `task_*` native mutation | 是 | 否 |
| 处理 CAS/部分失败/重试 | 是 | 可在后续研究中建议修订 |
| 判断后续效果 | 是，也可再次委托研究 | 可在新 child run 中评估 |
| 宣称 benchmark 改善 | 只能基于独立对照证据 | 不能仅凭 report 宣称 |

### 3.1 Parent 的输入授权边界

parent 调用 `auto_research` 时显式指定：

- `evidence_refs`：允许 child 使用的 observation；
- `resource_refs`：允许 child 读取的精确 task-local 资源版本；
- `inherit_harness_refs`：允许 child 检查的既有 harness 版本；
- `context_window`：允许 child 看到的 checkpoint、近期 observation/action 和上下文引用。

child 不能自行扩大权限，不能递归启动 Auto-Research，不能调用环境 mutation 工具。

### 3.2 Child 的审批责任

child 对每个 delivery 执行：

```text
research_approval(propose, delivery)
    → pending approval + canonical delivery hash

research_approval(approve | reject | defer,
                  approval_id,
                  target_version,
                  decision_note)
    → versioned decision
```

`approved` 表示 child 认为该完整 delivery 可在其声明范围和用途内被 parent 路由；不表示 mutation 已发生，也不表示预期效果已经得到后验验证。

为避免大型 delivery 正文在每个 provider turn 中重复回显，`research_approval`
的模型可见返回是审批索引（`approval_id`、当前 `version`、`status`、
`delivery_hash` 及摘要字段）；完整 canonical delivery 仍原样写入
`task-harness-proposals.jsonl`，并可用 child-only `research_approval(action=inspect)`
按精确 ID 读取。该索引是无损 transport projection，不是正文截断，也不构成
findings/proposals/report 的数量或长度限制。

## 4. 端到端状态机

### 4.1 Child research session

```text
active ──research_checkpoint(save)──> active
active ──research_checkpoint(pause)─> paused
paused ──auto_research(resume)──────> active
active ──submit_research_report─────> completed
active ──runtime/provider failure───> failed
```

### 4.2 Approval

```text
不存在 ──propose──> pending
pending ──approve──> approved   # 终态
pending ──reject───> rejected   # 终态
pending ──defer────> deferred   # 可在后续版本继续决定
deferred ──approve/reject/defer──> 新版本状态
```

所有状态变更使用 `target_version` 做 compare-and-swap。审批正文改变时必须创建新的 delivery/approval 身份，不能改写已批准正文。

### 4.3 Route

编译阶段产生：

```text
waiting     # approval pending/deferred
no_change   # rejected、reuse 或 research_only
ready       # 所有 native step 均可执行
partial     # 至少一个 native capability 不可用
```

应用阶段持久化扩展状态：

```text
ready → applying → fulfilled
ready → applying → partial
ready → applying → failed
fulfilled → fulfilled  # 幂等 replay，不重复写入
```

## 5. 数据结构总览

以下类型使用 TypeScript 风格表达；`?` 表示可选字段。task-local JSONL 写入时，runtime 还会追加：

```ts
type TaskScopeStamp = {
  task_id: string;               // 当前 benchmark/task 的稳定语义标识
  task_root_fingerprint: string; // run root 指纹，防止跨 task/root 复用
};
```

### 5.1 Parent → child：AutoResearchRequest

```ts
type AutoResearchRequest = {
  action?: "start" | "resume";
  // start 创建新 session；resume 续接已有 checkpoint。默认 start。

  question?: string;
  // 研究问题。start 必须提供；resume 可从 session 继承。

  session_ref?: string;
  // resume 时必填，格式 research_session:<id>@vN。

  scope?:
    | "hypothesis"
    | "harness_component"
    | "composition"
    | "task_decomposition"
    | "solution_path"
    | "research_method";
  // 研究对象类别；不参与最终 harness router 的组件映射。

  evidence_refs?: string[];
  // 精确 observation 引用。只授权读取，不等于结论成立。

  resource_refs?: string[];
  // child 可读取的 task-local 资源版本。

  inherit_harness_refs?: string[];
  // child 可检查的既有 memory/skill/tool/subagent 等版本。

  context_window?: AutoResearchContextWindow;
  // parent 选择的有限上下文投影；不是 parent transcript。

  constraints?: string[];
  // 本次研究的显式任务约束；不能扩大 child 权限。
};

type AutoResearchContextWindow = {
  include_checkpoint?: boolean;
  // 是否携带 parent 当前 checkpoint 的选择字段。

  recent_observations?: number;
  // 携带最近多少条 observation 投影；0 表示不携带。

  recent_actions?: number;
  // 携带 checkpoint 中最近多少条 action 投影。

  context_refs?: string[];
  // 额外授权的 task-local context 引用。

  max_chars?: number;
  // 声明的 context window 边界。当前 compactContextWindow 会记录该值，
  // 但不会用它静默截断 canonical selected content。
};
```

### 5.2 Child → parent：AutoResearchReport

```ts
type AutoResearchReport = {
  format: "auto-research-report-v1";

  status:
    | "provisional"
    | "supported_within_scope"
    | "inconclusive"
    | "contradicted"
    | "unresolved";
  // 对整份研究问题的认识状态，不是 approval 状态。

  conclusion: string;
  // 报告级结论。canonical report 中不做本地长度截断。

  findings: AutoResearchFinding[];
  // 全部研究发现。数量不设本地固定上限。

  evidence_refs: string[];
  // 报告整体引用的 evidence/resource identifiers。

  alternatives: string[];
  // 仍成立的竞争解释或替代方案。

  limitations: string[];
  // 证据范围、能力、数据或推断限制。

  validation_plan: string;
  // 下一步如何验证、证伪或缩小不确定性。

  evidence_audit?: ResearchEvidenceAudit;
  // child 提交 schema 允许携带；runtime 以独立 sidecar/record 为准，
  // 不把 machine audit 混入 model-authored normalized report。

  harness_proposals: HarnessProposal[];
  // 零个或多个可路由 delivery。没有 proposal 是合法研究结果。
};

type AutoResearchFinding = {
  subject_kind: string;
  // finding 讨论的对象类别；当前 report schema 接受字符串，router 不读取。

  question: string;
  // 该 finding 回答的具体问题。

  conclusion: string;
  // 研究结论，可为正面、负面或不确定结论。

  evidence_refs: string[];
  // 支撑该 finding 的精确证据引用。

  uncertainty: string;
  // 尚未解决的不确定性、适用范围或反例。
};

type HarnessProposal = {
  approval_id: string;
  // child approval ledger 中的稳定身份。

  delivery?: HarnessDelivery;
  // 完整 form 可直接携带；approval-only form 可省略。
  // submit handler 会从 child ledger 恢复 exact canonical delivery。

  // 以下字段由 submit handler 从 approval ledger 写入 normalized report，
  // child 无需伪造：
  approval_version?: number;
  approval_status?: "pending" | "approved" | "rejected" | "deferred";
  approval_tag?: "pending_review" | "approved" | "rejected" | "deferred";
};
```

### 5.2.1 Parent task 中的持久化 ResearchFinding

除 child report 的精简 `AutoResearchFinding` 外，parent task 还有可通过 `research_resource` 独立维护的版本化研究资源。两者不是同一记录类型；child report 不会自动写入该 ledger。

```ts
type ResearchFinding = {
  subject_kind?:
    | "task"
    | "component"
    | "composition"
    | "strategy"
    | "research_method";
  // 研究对象层级。

  hypothesis?: string;       // 当前可证伪假设
  falsifier?: string;        // 什么观察会反证该假设
  kind?: "research_goal" | "finding";
  // open 状态使用 research_goal；有 evidence/record 后使用 finding。

  goal_id: string;           // 跨版本保持稳定的研究目标身份
  finding_id: string;        // 跨版本保持稳定的 finding 身份
  version: number;
  research_event_id: string; // 本次 append event 身份

  evidence_refs: string[];   // 已知 canonical observation IDs
  assessment_refs: string[]; // 已存在的 effect assessment IDs
  status: "open" | "active" | "resolved";

  question: string;
  scope: string;
  uncertainty: string;
  evidence_to_seek?: string; // open goal 下一步需要什么 evidence
  evidence: string;          // Agent 对现有 evidence 的陈述
  decision: string;          // 当前研究决策，不自动成为 harness mutation

  expected_recurrence: "low" | "medium" | "high";
  // Agent 对可能复用频率的描述；不是自动晋升阈值。

  remaining_uses: number;
  // context projection 生命周期提示；不是 finding 数量限制。

  pinned?: boolean;          // projection 时优先保留
  reconsider_when?: string;
  used_in_observation_refs?: string[]; // Agent 声称后续使用过它的 observation
  use_note?: string;

  subject_refs?: string[];           // 被研究对象的精确 refs
  component_refs?: string[];         // 相关 harness component refs
  pattern_candidate_refs?: string[]; // 相关自动 pattern candidate refs
  parent_goal_id?: string;           // 研究层级父目标
  depends_on?: string[];             // finding/goal 依赖版本
  resolution?: string;               // resolve 时的关闭结论
  recordedAt: string;
};
```

该结构中的 `expected_recurrence`、`remaining_uses`、`subject_kind` 等字段不会被 `compileHarnessRoute` 自动读取。若它要推动 harness mutation，parent 或 child 必须把具体结论转成一个完整 `HarnessDelivery`，并在 `basis_refs` 中引用该 finding 的精确版本。

### 5.3 HarnessDelivery：完整字段

```ts
type HarnessDelivery = {
  format: "auto-research-harness-delivery-v1";
  // 固定协议标识。

  delivery_id: string;
  // 当前 run 内的稳定交付标识；小写字母、数字、单连字符。

  semantic_kind:
    | "fact"
    | "plan"
    | "procedure"
    | "computation"
    | "role"
    | "assessment"
    | "evidence";
  // 基础路由的首要判据，详见第 7 节。

  operation: "create" | "update" | "reuse" | "retire";
  // 对基础组件的期望生命周期操作。

  name: string;
  // 目标资源的稳定逻辑名称；用于 create/update/reuse/retire 匹配。

  summary: string;
  // Agent 可见索引摘要；不能代替 content。

  content: string;
  // canonical 正文；memory 内容、skill 指令、role 指令或默认 prompt 正文。

  description?: string;
  // skill/tool/subagent 的简短说明；缺省时使用 summary。

  scope: {
    kind: "current_step" | "condition" | "task_wide";
    // current_step：仅当前决策/状态；
    // condition：某个可声明条件成立时；
    // task_wide：整个当前 task 范围。

    statement: string;
    // 对适用范围的可读描述，写入目标资源。
  };

  trigger: string;
  // 何时应读取、调用或遵循该交付。

  exclusions: string[];
  // 明确禁止泛化或不适用的条件。

  stability: "transient" | "conditional" | "stable_in_scope";
  // 内容在声明 scope 中的稳定程度。

  reuse: "one_off" | "expected_reuse";
  // 预期一次使用还是重复使用。注意：当前 router 不以重复次数设阈值。

  reasoning: "none" | "bounded_judgment" | "open_ended";
  // 使用该内容需要的判断强度。当前主要用于 delivery 语义表达，
  // 基础目标仍由 semantic_kind 决定。

  execution:
    | "text"
    | "pure_computation"
    | "adapter_operation"
    | "model_delegation";
  // 实际执行形态；用于 computation/role 的一致性校验。

  context_visibility: "on_demand" | "always";
  // on_demand：索引/按需读取；always：申请进入动态 task/user context
  // projection（默认）或显式 system prompt overlay。

  system_prompt_basis?: {
    source: "explicit_task_contract" | "validated_environment_invariant";
    evidence_refs: string[];
  };
  // 仅在请求 system_prompt 时出现。每个 evidence ref 必须同时进入
  // delivery.basis_refs，并在 report finding/top-level evidence 中出现。

  prompt_channel?: "system_prompt" | "task_prompt";
  // 可选通道声明。缺省且目标为 memory 时，always 使用 task_prompt；
  // system_prompt 必须显式声明，防止 task plan 随意改变 host authority。

  activation?: Record<string, unknown>;
  // task_prompt projection 的 Agent-authored 条件 AST。context hook 每轮
  // 针对 checkpoint/environment/assertions 求值；它不是 quota 或组件类型。

  prompt_text?: string;
  // prompt projection 正文；缺省使用 content。运行时不截断 canonical content。

  prompt_operation?: "create" | "update" | "reuse" | "retire";
  // 显式 system_prompt slot 的独立操作；只有 prompt_channel=system_prompt
  // 且满足 task_wide + stable_in_scope + always 时才必须提供。

  prompt_target_version?: number;
  // prompt_operation 为 update/retire 时的当前 prompt 版本 CAS 值。

  target_version?: number;
  // 基础组件 update/retire 时的当前版本 CAS 值；不是新版本号。

  input_schema?: Record<string, unknown>;
  // computation → task_tool 的 JSON input schema。

  implementation_ref?: string;
  // adapter 允许的已有实现引用。

  program?: Record<string, unknown>;
  // task-local declarative tool program；必须能形成非空 program.steps。

  tools?: string[];
  // role → task_subagent 可使用的显式工具集合；必须非空且属于 adapter allowlist。

  basis_refs: string[];
  // 支撑 delivery 的 finding/evidence/resource 精确引用。

  expected_effect: string;
  // 应用后预期观察到的行为变化；不等于已经发生。

  reconsider_when: string;
  // 哪些新证据、状态或失败要求重新评估/修订/退役。
};
```

### 5.4 ApprovalRecord

```ts
type ApprovalRecord = {
  format: "auto-research-approval-v1";
  approval_id: string;       // proposal 稳定身份
  version: number;           // append-only 决策版本
  run_id: string;            // 所属 auto-research run
  session_id?: string;       // 所属可恢复 research session

  proposal: {
    kind: string;            // delivery.semantic_kind 的索引副本
    operation: string;       // delivery.operation 的索引副本
    name: string;            // delivery.name 的索引副本
    summary: string;         // delivery.summary 的索引副本
    basis_refs: string[];    // delivery.basis_refs 的索引副本
    delivery: HarnessDelivery; // 完整 canonical delivery
    delivery_hash: string;   // stable-key JSON 的 SHA-256
  };

  status: "pending" | "approved" | "rejected" | "deferred";
  tag: "pending_review" | "approved" | "rejected" | "deferred";
  decision_note?: string;    // child 对决定、风险和边界的说明
  decided_by?: "auto-research-agent";
  recordedAt: string;        // ISO-8601 时间
};
```

审批记录写入 `task-harness-proposals.jsonl`。approval-only report submission 时，child runtime 以 `approval_id` 取回 `proposal.delivery`，重新计算 hash，并拒绝未知、pending 或 hash 不匹配的 proposal。

同一 child run 可以同时保有多个 pending proposal，也可以在等待决定时继续读取证据或提出其它 delivery；运行时不按 proposal 数量、正文长度或读取次数设置门槛。唯一提交条件是：报告中引用的每个 proposal 都必须在提交前完成 approve/reject/defer，且 delivery hash 与 ledger 一致。

### 5.5 ResearchEvidenceAudit 与 Checkpoint

```ts
type ResearchEvidenceAudit = {
  format: "research-evidence-audit-v1";
  status: "no_selected_refs" | "partial" | "complete";
  required_refs: string[];          // 明确授权且要求覆盖的 task resource refs
  complete_refs: string[];          // 已分页覆盖完整 canonical JSON 的 refs
  incomplete_refs: string[];        // 尚未完整覆盖的 refs
  read_count: number;               // child read tool 总次数，只是 provenance
  repeated_read_count: number;      // 相同 ref/signature 的额外读取次数
  review_checkpoint_count: number;  // 保存 review checkpoint 的次数
  threshold_reached: false;         // 当前实现固定 false；不存在读取配额阈值
};

type AutoResearchCheckpoint = {
  format: "auto-research-checkpoint-v1";
  session_id: string;
  status: "active" | "paused";
  cursor: string;                    // child 自定义恢复游标
  evidence_refs: string[];
  selected_resource_refs: string[];
  unresolved_questions: string[];
  draft_findings: unknown[];
  next_step: string;
  pause_reason: string | null;
  resume_condition: string;
  partial_output?: string;           // provider 在输出边界停止时保留的原始未完成文本
  evidence_read_count: number;
  evidence_audit: ResearchEvidenceAudit;
  recordedAt: string;
};
```

如果 child 的最终消息 `stop_reason` 为 `length`，runtime 不把它记为完成或普通
`invalid_report`。它会将未提交的原始文本写入 checkpoint，session 状态设为
`paused`，并返回 `session_ref`。parent 应使用同一 `session_ref` 调用
`auto_research(action="resume")`；这只是恢复研究游标，不会自动采用 partial
finding，也不会引入报告数量或正文长度限制。

### 5.6 Parent transport：AutoResearchCapsule

```ts
type AutoResearchCapsule = {
  format: "auto-research-capsule-v1";
  resource_ref: string; // research_run:<run-id>@v1
  detail_ref: string;   // research_report:<run-id>@v1，完整报告读取入口
  session_ref: string;  // research_session:<session-id>@vN
  run_id: string;
  status: string;
  scope: string;
  summary: string;      // report.conclusion

  key_findings: Array<{
    subject_kind: string;
    conclusion: string;
    evidence_refs: string[];
  }>;
  // context projection；完整 finding 保留在 detail_ref。

  evidence_refs: string[];
  next_test: string;    // report.validation_plan
  limitations: string[];

  proposal_index: Array<{
    proposal_id: string;       // parent transport 序号身份
    approval_id?: string;
    approval_version?: number;
    approval_status?: string;
    approval_tag?: string;
    delivery_id: string;
    semantic_kind: string;
    operation: string;
    name: string;
    summary: string;
    basis_refs: string[];
  }>;

  route_plan: HarnessRoutePlan[];

  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };

  adoption: string;
  // child 未执行 mutation；parent runtime 在返回 capsule 前执行 ready apply_call。
};
```

Capsule 是 provider-context transport projection，不是 canonical report 的替代物。

### 5.7 HarnessRoutePlan 与 HarnessRouteStep

```ts
type HarnessRoutePlan = {
  format: "auto-research-harness-route-v1";
  route_id: string;       // <run-id>:route-<delivery-id>
  route_ref: string;      // harness_route:<route-id>@v1
  version: number;        // 编译时 1；apply 时 append 新版本
  run_id: string;
  delivery_id: string;
  delivery_hash: string;
  approval_ref: string;   // proposal:<approval-id>@v<approval-version>
  review_status: string;

  disposition:
    | "materialize"
    | "reuse"
    | "research_only"
    | "waiting"
    | "closed";

  route_status:
    | "ready"
    | "partial"
    | "no_change"
    | "waiting";
  // compiler 的处置/可执行状态。
  execution_status?: "fulfilled" | "partial" | "failed";
  execution_applied?: boolean;
  // parent runtime 执行后的结果；canonical route 记录会另 append applying/fulfilled/partial/failed 版本。

  base_target:
    | "memory"
    | "skill"
    | "tool"
    | "subagent"
    | "system_prompt"
    | "research_only";

  steps: HarnessRouteStep[];

  apply_call?: {
    name: "task_harness";
    arguments: {
      action: "apply_route";
      route_ref: string;
      expected_delivery_hash: string;
    };
  };
  // 仅 route_status=ready 时存在。

  router: {
    implementation: "code";
    policy_version: "harness-router-v1";
  };

  // apply runtime 追加字段：
  application_tool_call_id?: string;
  application_started_at?: string;
  application_completed_at?: string;
  applied_step_ids?: string[];
  step_results?: Array<Record<string, unknown>>;
};

type HarnessRouteStep = {
  step_id: string; // <route-id>:step-N
  order: number;
  target: "memory" | "skill" | "tool" | "subagent" | "system_prompt";
  native_tool:
    | "task_memory"
    | "task_skill"
    | "task_tool"
    | "task_subagent"
    | "task_system_prompt";

  native_call: {
    name: string;
    arguments: Record<string, unknown>;
  };

  depends_on: string[]; // 必须已 applied 的 step ids
  status: "ready" | "unsupported";
  reason?: string;
};
```

### 5.8 RouteReceipt 与 ApplyResult

```ts
type HarnessRouteReceipt = {
  format: "auto-research-harness-route-receipt-v1";
  receipt_id: string;          // route + step + toolCall 的唯一审计身份
  route_id: string;
  step_id: string;
  delivery_hash: string;
  native_tool: string;
  status: "applied" | "failed";
  applied: boolean;
  source_approval_ref: string;
  resource_ref?: string;       // 成功后的精确组件版本
  reason?: string;             // 结构/依赖/executor 不可用原因
  failure?: Record<string, unknown>; // native handler 的失败 details
  recordedAt: string;
};

type HarnessApplyResult = {
  format: "auto-research-harness-apply-result-v1";
  route_id: string;
  route_status: "fulfilled" | "partial" | "failed";
  idempotent: boolean;
  version: number;
  steps?: Array<{
    step_id: string;
    status: "applied" | "already_applied" | "failed";
    resource_ref?: string;
    reason?: string;
  }>;
};
```

### 5.9 Canonical run/report/session records

```ts
type AutoResearchRunRecord = {
  run_id: string;
  version: 1;
  session_id: string;
  status: "completed" | "invalid_report" | "paused" | "failed";
  question: string;
  scope: string;
  evidence_refs: string[];
  resource_refs: string[];
  inherited_harness_refs: string[];
  context_window?: Record<string, unknown>;
  report_ref?: string;
  finding_count?: number;
  proposal_count?: number;
  evidence_audit?: ResearchEvidenceAudit;
  result_summary?: {
    stop_reason: unknown;
    usage: Record<string, unknown>;
    provider: unknown;
    model: unknown;
    event_count: number;
    adapter_id: string;
  };
  checkpoint?: AutoResearchCheckpoint;
  toolCallId?: string;
  startedAt: string;
  completedAt: string;
  summary: string;
  error?: string;
};

type AutoResearchReportRecord = {
  run_id: string;
  version: 1;
  status: string;
  summary: string;
  report: AutoResearchReport;
  evidence_audit: ResearchEvidenceAudit;
  recordedAt: string;
};

type AutoResearchSessionRecord = {
  session_id: string;
  version: number;
  status: "active" | "paused" | "failed" | "completed";
  question: string;
  run_id: string;
  research_run_ref?: string;
  evidence_refs?: string[];
  resource_refs?: string[];
  scope?: string;
  checkpoint?: AutoResearchCheckpoint;
  cursor?: string | null;
  summary?: string;
  report_status?: string;
  recordedAt: string;
};

type AutoResearchContinuationReceipt = {
  format: "auto-research-continuation-v1";
  run_id: string;              // 同一 parent auto_research 调用内保持不变
  session_id: string;          // 跨 provider length 边界保持不变
  attempt: number;             // 可审计序号，不是次数上限
  stop_reason: string;         // length/checkpointed/submitted_report/paused/...
  checkpoint: AutoResearchCheckpoint | null;
  usage: Record<string, unknown>;
  cumulative_usage: Record<string, unknown>;
  progress_ref: string;
  progress_id: string;
  recordedAt: string;
};
```

`stop_reason=length` 和 active checkpoint 由 Auto-Research runtime 在同一
tool call 内确定性继续；不会生成 parent-visible paused session。只有 child
明确调用 `research_checkpoint(action="pause")` 时才写入 paused session 并交回
parent。runtime 不增加 continuation 数量、finding、report 或正文长度上限。

### 5.10 五类组件的 canonical records

所有 route-created resource 都带 `routing_id` 和 `source_approval_ref`，从而可以反向追踪 route 和 approval。

```ts
type MemoryRecord = {
  summary?: string;
  memory_id: string;
  key: string;
  version: number;
  status: "active" | "retired";
  content: string;
  scope: string;
  basis_refs: string[];
  pinned: boolean;
  decision_id?: string;
  expected_effect?: string;
  reconsider_when?: string;
  routing_id?: string;
  source_approval_ref?: string;
  recordedAt: string;
};

type SkillRecord = {
  skill_id: string;
  name: string;
  version: number;
  status: "active" | "retired";
  description: string;
  instructions: string;
  file: string;                 // task-local SKILL.md 路径
  basis_refs: string[];
  decision_id?: string;
  expected_effect?: string;
  reconsider_when?: string;
  routing_id?: string;
  source_approval_ref?: string;
  recordedAt: string;
};

type SystemPromptRecord = {
  segment_id: string;
  name: string;
  version: number;
  status: "active" | "retired";
  content: string;
  scope: string;
  basis_refs: string[];
  decision_id?: string;
  expected_effect: string;
  reconsider_when: string;
  routing_id?: string;
  source_approval_ref?: string;
  recordedAt: string;
};

type TaskToolRecord = {
  tool_id: string;
  name: string;
  version: number;
  status: "active" | "retired";
  description: string;
  input_schema: Record<string, unknown>;
  implementation_ref: string;
  program?: { steps: Array<Record<string, unknown>> };
  adapter_id: string;
  permission: string;
  exposed_name: string;          // task_tool_<name>_v<version>
  basis_refs: string[];
  decision_id: string;
  expected_effect: string;
  reconsider_when: string;
  routing_id?: string;
  source_approval_ref?: string;
  recordedAt: string;
};

type SubagentRecord = {
  adapter_id?: string;
  agent_id: string;
  name: string;
  version: number;
  status: "active" | "retired";
  description: string;
  instructions: string;
  tools: string[];
  file: string;                 // task-local subagent definition
  basis_refs: string[];
  decision_id?: string;
  expected_effect?: string;
  reconsider_when?: string;
  routing_id?: string;
  source_approval_ref?: string;
  recordedAt: string;
};
```

### 5.11 ResourceRef、ResourceMetadata 与分页 provenance

所有可读取 canonical resource 使用：

```text
<kind>:<name-or-id>@v<positive-integer>
```

当前相关 kind 包括：

```text
memory, skill, tool, subagent, finding, observation, validation,
delegation, context, proposal, system_prompt, harness_route,
route_receipt, failure, research_run, research_report, research_session
```

索引返回统一 metadata：

```ts
type ResourceMetadata = {
  resource_ref: string;
  version: number;
  status?: string;
  summary: string;
  summary_kind: "agent_authored" | "extractive_excerpt";
  chars: number;             // 完整 serialized canonical record 字符数
  sha256: string;            // 完整 serialized record 哈希
  basis_refs: string[];
  epistemic_status: string;  // 说明 observation/Agent claim 的认识性质
  epistemic_label?: "UNVERIFIED HYPOTHESIS";

  read: {
    tool: "task_resource";
    action: "read";
    ref: string;
    offset: number;
    limit: number;
  };

  provenance: {
    format: "task-evidence-provenance-v1";
    source_ref: string;
    source_version: number;
    derived_ref: string;
    operation: string;
    transformations: string[];
    page: {
      offset: number;
      limit: number;
      total: number;
      truncated: boolean;
      next_offset: number | null;
    };
    checkpoint_ref?: string;
  };
};
```

默认 `limit=2000` 是首次读取的分页大小，不是 canonical resource 长度上限。Agent 可以继续使用 `next_offset` 读取后续页。

## 6. Finding 到 Delivery：真正的“路由前判断”

### 6.1 Finding 不直接决定组件

下面这些 `AutoResearchFinding` 字段不会直接进入 router：

| Finding 字段 | 用途 | 是否直接决定组件 |
|---|---|---|
| `subject_kind` | 说明研究对象 | 否 |
| `question` | 说明所回答的问题 | 否 |
| `conclusion` | 研究结论 | 否 |
| `evidence_refs` | 结论依据 | 否 |
| `uncertainty` | 认识边界 | 否 |

child 必须先判断 finding 是否足以支持一个独立、可执行、可复用或可退役的 harness 变更。若不足，应只保留 finding，不创建 proposal。

### 6.2 从 finding 产生 delivery 的条件

child 应依次回答：

1. **是否有可独立表达的内容？** 如果一段结论同时包含事实、算法和判断流程，应拆成多个 delivery。
2. **证据是否覆盖声明范围？** 静态单帧不能支持动态因果；一次失败不能自动支持 task-wide 规则。
3. **内容是否改变或新增执行条件？** 纯 assessment/evidence 通常保留为 research-only。
4. **是否能指定稳定名称与操作？** 不能确定 create/update/reuse/retire 时不应提交 mutation delivery。
5. **是否能给出失效条件？** `reconsider_when` 和 `exclusions` 必须明确。
6. **是否存在足够的执行定义？** computation 需要 program/implementation；role 需要工具集合；否则不能伪装成 tool/subagent。

### 6.3 semantic_kind 的判断依据

| `semantic_kind` | 判断问题 | 应选择该类型的条件 | 不应选择的情况 |
|---|---|---|---|
| `fact` | 内容主要用于“知道/查阅什么”？ | 已知状态、映射、约束、结论；执行时无需步骤化判断 | 算法、流程、开放式分析角色 |
| `plan` | 内容主要用于“接下来按什么目标/顺序/分支做”？ | 子目标、顺序、条件策略、停止条件 | 事实记录或可执行算法 |
| `procedure` | 内容主要用于“遇到条件时按哪些步骤判断”？ | 多步方法、异常分支、仍需 Agent 判断 | 纯机械变换或一次性结论 |
| `computation` | 内容能否由明确输入产生明确输出？ | I/O 清晰，可用 declarative program 或 adapter operation 执行 | 需要开放式模型推理、未定义执行实现 |
| `role` | 是否需要独立模型上下文解决开放式子问题？ | 可界定角色、工具集合、输入和返回契约 | 单次普通计算、仅保存文字 |
| `assessment` | 是否只是在评价已有命题/组件？ | supported/mixed/negative/inconclusive 验证结论 | 新增具体能力正文 |
| `evidence` | 是否主要是原始材料或大体量证据？ | observation、完整轨迹、报告、数据集合 | 已提炼且可直接使用的 harness 组件 |

判断依据必须来自 finding 的结论、evidence_refs、uncertainty 和当前已授权能力，不能仅凭关键词分类。

### 6.3.1 system_prompt_basis 的确定规则

不建立通用 authority taxonomy。只有 child 请求 `prompt_channel=system_prompt` 时才生成 `system_prompt_basis`：

| `source` | 明确条件 | 必须关联的证据 |
|---|---|---|
| `explicit_task_contract` | supplied task contract/题面直接声明规则、机制、胜负条件、目标或不可变约束 | 对应 contract/context 精确引用 |
| `validated_environment_invariant` | 没有直接契约，但 supplied observations/validation 支持同一 task-wide invariant，且没有未处理反例 | 对应 observation/validation 精确引用 |

每个 `system_prompt_basis.evidence_refs` 必须同时：

1. 出现在 `delivery.basis_refs`；
2. 出现在 report 顶层 `evidence_refs` 或至少一个 finding 的 `evidence_refs`；
3. 其适用范围与 `scope.kind=task_wide`、`stability=stable_in_scope` 不冲突。

router 校验第 1 项和结构组合，child report commit 校验第 2 项；第 3 项由 child 根据 evidence 和 uncertainty 作出声明。如果证据不足，内容只能留在 memory/task prompt 或 research report，不能由 parent 静默补成 system prompt。

### 6.4 其他路由属性的判断依据

一个 finding 与 delivery 不是一一对应关系：一个 finding 可以不足以产生任何 delivery，也可以拆出多个不同 kind 的 delivery；多个 findings 也可以共同支撑一个 delivery。child 必须按独立生命周期和独立验证边界拆分，而不是按 finding 数量机械映射。

| 属性 | 可选值 | 判断依据与条件 |
|---|---|---|
| `operation` | `create` | 当前 portfolio 中没有承担同一名称/职责/范围的资源；不得仅因措辞不同重复创建 |
|  | `update` | 已有资源承担相同职责，但 finding 支持纠错、扩展或改进；必须知道当前 `target_version` |
|  | `reuse` | 已有精确版本已完整表达 delivery；本次只增加证据或确认，无需新组件版本 |
|  | `retire` | evidence 支持停止使用当前版本；必须明确目标版本和退役原因 |
| `scope.kind` | `current_step` | 内容依赖当前 frame、当前页面、当前一次 action 或快速变化状态 |
|  | `condition` | 有明确适用谓词，例如“当前 level 0”“schema v3”“对象识别成立时” |
|  | `task_wide` | evidence 或任务契约支持它覆盖整个当前 task；“看起来重要”不是充分条件 |
| `stability` | `transient` | 下一状态变化即可使内容过期，例如当前位置、临时错误 |
|  | `conditional` | 在可说明条件下稳定，条件失效必须重新检查 |
|  | `stable_in_scope` | 在声明 scope 内没有未处理直接冲突，关键反例已被检查或明确排除 |
| `reuse` | `one_off` | 预计只服务一个独立决策/委派；不要求人为重复以“升级” |
|  | `expected_reuse` | 当前 task 后续多个决策预计会读取、调用或依赖；依据是任务结构，不是固定出现次数 |
| `reasoning` | `none` | 使用是直接查阅或机械应用，不需要模型判断 |
|  | `bounded_judgment` | 有有限分支、异常处理或证据选择，但边界可明确写出 |
|  | `open_ended` | 需要独立模型解释、反例搜索、综合或新推理 |
| `execution` | `text` | 内容通过 context 被阅读或遵循，不直接执行程序/adapter/模型委派 |
|  | `pure_computation` | 同一输入应产生确定输出，不需要环境副作用 |
|  | `adapter_operation` | 必须调用当前 benchmark adapter 的受权能力，并受 permission/allowlist 约束 |
|  | `model_delegation` | 需要新的模型上下文执行开放式子问题 |
| `context_visibility` | `on_demand` | 可通过索引和分页按需读取；大多数事实、方法和详细正文应选此值 |
|  | `always` | 几乎每个相关后续决策都必须知道，按需读取会造成系统性遗漏；还必须满足 prompt 的 scope/stability 条件 |
| `trigger` | 自由文本 | 必须说明哪个可观察事件或决策点需要使用该资源 |
| `exclusions` | 字符串数组 | 来自 uncertainty、反例、权限或 scope 边界；用于防止不当泛化 |
| `basis_refs` | 精确版本引用 | 应覆盖 delivery 中每个实质性 claim；摘要或未版本化名称不足以替代 canonical refs |
| `expected_effect` | 自由文本 | 必须是应用后可观察的行为差异，不应写成“已经提高效果”的无证据结论 |
| `reconsider_when` | 自由文本 | 应对应状态变化、反例、版本变化、失败或未达预期效果等可检查条件 |
| `target_version` | 正整数 | update/retire 时读取目标 current version 得到；用于 CAS，不能填写预期新版本 |
| `prompt_operation` | create/update/reuse/retire | 只有明确申请 always-visible overlay 时填写；应独立比较现有 prompt segment |
| `prompt_target_version` | 正整数 | prompt update/retire 的 current version CAS 值 |

这些判断由 child 根据 evidence 明确声明并审批；router 只做结构校验和确定性映射，不重新阅读 `content` 推翻枚举值。若 parent 发现枚举与内容明显矛盾，应拒绝执行/保持 waiting，并启动新的研究修订，而不是在 parent 中静默改写 delivery。

### 6.5 路由字段的闭环要求

每个能改变 route 的字段都必须有 producer、evidence link、validator 和 consumer；缺少任一环就不能成为可执行 route：

此外，每个 proposal 的 `delivery.basis_refs` 都必须出现在相关 finding 的 `evidence_refs` 或 report-level `evidence_refs` 中；child report commit 对五类目标统一执行这一校验。它不证明结论为真，但保证 parent 不会收到与研究记录脱节的 provenance。

| 字段 | child 如何产生 | evidence 关联 | 代码校验 | 消费者 |
|---|---|---|---|---|
| `semantic_kind=procedure` | finding 结论描述可复用多步方法/分支 | `delivery.basis_refs` 指向相关 observation/finding/validation | enum 与 delivery 结构校验 | router → `task_skill` |
| `semantic_kind=computation` | finding 结论给出明确 I/O 和机械变换 | `basis_refs`；program/implementation 是可执行定义 | program step 合同、execution、一致性和 adapter allowlist | router → `task_tool` → `pi.registerTool` |
| `prompt_channel=system_prompt` | finding 支持 task-wide 稳定契约/invariant | `system_prompt_basis.evidence_refs` 同时关联 delivery 和 report evidence | router + report commit 双重校验 | router → `task_system_prompt` |
| `activation` | finding 给出可观察的适用条件 | memory basis refs 与当前 checkpoint/environment/assertions | context hook 的确定性 predicate evaluator | memory → task/user context projection |

Auto-Research task text同时暴露 task-tool creation contract，包括 declarative step kinds、允许的 adapter implementation refs 和 unlisted policy。child 不得为 contract 外的能力生成 computation delivery，只能报告 capability gap。这样“tool”不只是一个标签，而是能被当前 parent runtime 实际注册和调用的定义。

## 7. Delivery 属性如何决定路由

### 7.1 当前代码真正读取的路由属性

| 属性 | 当前代码用途 | 决策效果 |
|---|---|---|
| `approval_status` | R0 审批分流 | waiting / closed / 继续路由 |
| `semantic_kind` | 基础目标选择 | memory/skill/tool/subagent/research_only；`plan` 默认进入 memory |
| `operation` | 生命周期分流 | reuse → no_change；其他生成 native action |
| `scope.kind` | system prompt 资格 | 必须为 `task_wide` |
| `stability` | system prompt 资格 | 必须为 `stable_in_scope` |
| `context_visibility` | system prompt 资格 | 必须为 `always` |
| `prompt_operation` | overlay 操作 | create/update/retire/reuse；reuse 不新增 step |
| `target_version` | 基础组件 CAS | update/retire 必须提供 |
| `prompt_target_version` | prompt CAS | prompt update/retire 必须提供 |
| `system_prompt_basis` | system prompt 证据来源校验 | 仅显式 task contract 或已验证环境 invariant；refs 必须关联 delivery/report evidence |
| `execution` | 类型一致性校验 | computation/role 不匹配则拒绝 delivery |
| `program` / `implementation_ref` | tool 可执行性校验 | computation 至少提供一个 |
| `tools` | subagent 权限定义 | role 必须提供非空集合 |
| runtime `capabilities` | step 可用性 | 缺少 native tool → unsupported/partial |

### 7.2 当前只携带语义、但不直接改变基础路由的属性

| 属性 | 当前作用 | 当前是否直接选择目标 |
|---|---|---|
| `summary` | capsule/index/目标 description fallback | 否 |
| `content` | 目标组件 canonical 正文 | 否 |
| `description` | skill/tool/subagent 描述 | 否 |
| `scope.statement` | 写入目标的范围说明 | 否 |
| `trigger` | 告诉 Agent 何时使用 | 否 |
| `exclusions` | 防止泛化 | 否 |
| `reuse` | 表达预期复用性质 | 否；不要与 `operation="reuse"` 混淆 |
| `reasoning` | 表达所需判断强度 | 否；当前不会覆盖 semantic_kind |
| `prompt_channel` | 选择动态 task/user prompt 或显式 system prompt 投影 | 否；默认 task_prompt，system_prompt 必须显式声明并满足资格 |
| `activation` | 动态 task/user prompt 的条件 AST | 否；由 context hook 每轮对当前 checkpoint/environment/assertions 求值 |
| `prompt_text` | prompt 投影正文 | 否；task_prompt 时作为 memory projection 文本，system_prompt 时仅在 overlay 已符合资格后使用 |
| `input_schema` | tool schema | 否 |
| `basis_refs` | provenance | 否 |
| `expected_effect` | 后验评估目标 | 否 |
| `reconsider_when` | 后续修订触发条件 | 否 |

这一区分非常重要：当前 router 是枚举属性驱动，而不是对 content 做第二次语义分类。

### 7.3 基础映射

```text
semantic_kind=fact        → base_target=memory    → task_memory
semantic_kind=plan        → base_target=memory    → task_memory
semantic_kind=procedure   → base_target=skill     → task_skill
semantic_kind=computation → base_target=tool      → task_tool
semantic_kind=role        → base_target=subagent  → task_subagent
semantic_kind=assessment  → research_only
semantic_kind=evidence    → research_only
```

`plan` 不再因为“目标/顺序/分支”语义而修改 host system prompt。它是 task knowledge：canonical 正文写入 `task_memory`。当 `context_visibility=always` 且未显式指定其它通道时，router 在同一个 memory native call 中附加：

```json
{
  "projection": {
    "channel": "task_prompt",
    "prompt_text": "可选的动态任务提示正文",
    "activation": "可选的 Agent-authored 条件 AST"
  }
}
```

Pi extension 的 `context` hook 每轮读取 active memory、当前 `task-checkpoint.json` 的最新状态以及 `activation`，将满足条件的 projection 作为 user/task context message 注入下一次 provider request。投影同时携带 scope、basis_refs、reconsider_when 和 epistemic status，不能提升为 host authority。这里没有新增持久化 harness 类型；`task_prompt` 是现有 memory 的 context 投影通道。

### 7.4 审批分流

```text
pending/deferred → disposition=waiting, route_status=waiting, steps=[]
rejected         → disposition=closed, route_status=no_change, steps=[]
approved         → 继续检查 operation 和 semantic_kind
未知状态         → compiler error
```

### 7.5 operation 分流

- `reuse`：`disposition=reuse`、`route_status=no_change`，不创建新版本。
- `create`：目标 native tool 执行 create/upsert。
- `update`：必须携带目标当前 `target_version`，由 native tool 做 CAS。
- `retire`：必须携带目标当前 `target_version`，产生 retired 新版本，不删除历史。

memory 的 native action 使用 `upsert`/`retire`；其余四类使用 `create`/`update`/`retire`。

### 7.6 system prompt 与动态 task/user prompt

只有 child 明确把 `prompt_channel` 设为 `system_prompt`，并且同时满足：

```text
system_prompt_basis.source ∈ {
  "explicit_task_contract",
  "validated_environment_invariant"
}
system_prompt_basis.evidence_refs 非空并关联 delivery/report evidence
```

这里没有由 parent 根据关键词猜测的“权威分类”。child 必须指出契约来源或被验证的 invariant，并给出精确 evidence refs。

```text
scope.kind == "task_wide"
stability == "stable_in_scope"
context_visibility == "always"
```

delivery 才具备 prompt eligibility，并且必须显式提供 `prompt_operation`。

具体行为：

1. 未设置 `prompt_channel` 时，`always` delivery 默认使用动态 `task_prompt` 投影；不会写 `task_system_prompt`。
2. 设置 `prompt_channel=task_prompt` 时，delivery 必须以支持 projection 的 memory 为基础；context hook 每轮根据 activation 决定是否注入。
3. 设置 `prompt_channel=system_prompt` 时，必须满足上面的三项资格并提供 `prompt_operation`；router 先写基础组件，再按 `depends_on` 写 system prompt overlay。
4. `prompt_operation=reuse`：不生成 overlay mutation step。
5. assessment/evidence 始终 research-only，不因 `always` 升级为 prompt。

因此 `task_prompt` 只能与 `fact`/`plan`（两者的基础目标都是 memory）和
`context_visibility=always` 组合；`assessment`/`evidence` 不能声明任何 prompt
mutation。其余组合由 normalizer 直接拒绝，而不是静默降级。

因此，带前置条件的 plan 不需要 parent 动态删除 system prompt 内容：它从来不进入 system prompt，而是保留在 task-local memory 中，由 activation 谓词在每轮 context 投影时自然出现或消失。基础 host protocol、权限和不应轻易改变的约束才适合显式 system prompt。

`activation` 当前支持的确定性形态是：

| `type` | 字段 | 语义 |
|---|---|---|
| `always`（缺省） | 无 | 始终投影 |
| `state_match` | `path`, `operator`, `value` | 对 context state 的 dotted path 做 `eq`/`neq`/`in`/`exists` 判断 |
| `all` | `conditions[]` | 所有子谓词成立 |
| `any` | `conditions[]` | 任一子谓词成立 |
| `not` | `condition` | 子谓词取反 |
| `agent_asserted` | `assertion_ref`, 可选 `value` | 匹配当前 state.assertions 中 Agent 已声明的值 |

未知或结构不完整的谓词返回 false；这只是避免误投影的语义校验，不是对报告、finding 或正文的数量/长度限制。

因此，一个已批准 fact 可以形成：

```text
step 1: task_memory(create/update)
step 2: task_system_prompt(create/update)，depends_on step 1
```

但只有 child 明确声明全部 prompt 属性并通过审批时才会发生。

### 7.7 computation 校验

`semantic_kind=computation` 必须满足：

```text
execution ∈ {pure_computation, adapter_operation}
program 或 implementation_ref 至少存在一个
```

随后 `task_tool` 还会校验：

- `input_schema` 是 JSON object；
- declarative `program.steps` 非空；
- `implementation_ref` 在 adapter allowlist 内，除非 adapter 明确允许 unlisted implementation；
- 任意 adapter call 继续受 adapter permission 约束；
- 不加载任意 host code/extension。

Auto-Research child 的 task text 会收到同一份可执行 capability contract：支持的 declarative step kinds、adapter implementation refs 和是否允许 unlisted refs。child 只能在该 contract 内生成 computation delivery；超出 contract 的需要记录为 capability gap，而不是生成一个注定失败的 tool route。router 与 `task_tool` 使用同一组 declarative step 名称校验，避免 prompt 声明与执行器漂移。

“tool component 已开启”表示 Agent 可以创建新的 Pi tool definition，并不意味着获得新的 host 权限。纯计算可以由声明式 program 创建；环境副作用只能组合 adapter 已授权操作。若目标能力两者都无法表达，当前 task 内确实不能物化该 tool，需要 host 提供新的 sandbox/runtime 或 adapter capability。这是实际能力边界，不是 finding/proposal 数量或长度配额。

### 7.8 role 校验

`semantic_kind=role` 必须满足：

```text
execution == "model_delegation"
tools.length > 0
```

`task_subagent` 还会校验 `tools` 是当前 adapter allowed tools 的非空子集。创建 definition 不等于执行；只有后续调用 `delegate_task` 才产生 subagent invocation。

当前实现即使 `reuse=one_off`，`operation=create` 的 role 仍会创建 task-local subagent definition；是否调用由 parent 决定。

## 8. 确定性路由伪代码

```ts
function route(approval, delivery, capabilities) {
  validateAndNormalize(delivery);
  assert(hash(delivery) === approval.delivery_hash);

  if (approval.status === "pending" || approval.status === "deferred")
    return waiting();

  if (approval.status === "rejected")
    return closedNoChange();

  if (approval.status !== "approved")
    throw new Error("unknown approval status");

  if (delivery.operation === "reuse")
    return reuseNoChange();

  const target = BASE_ROUTE[delivery.semantic_kind];

  if (target === "research_only")
    return researchOnlyNoChange();

  const promptEligible =
    delivery.prompt_channel === "system_prompt" &&
    delivery.system_prompt_basis?.evidence_refs.length > 0 &&
    delivery.scope.kind === "task_wide" &&
    delivery.stability === "stable_in_scope" &&
    delivery.context_visibility === "always";

  const steps = [compileNativeStep(target, delivery)];

  if (promptEligible && target !== "system_prompt" &&
      delivery.prompt_operation !== "reuse") {
    steps.push(compilePromptStep({ dependsOn: steps[0] }));
  }

  markUnsupportedStepsFrom(capabilities);
  return allStepsReady ? readyWithApplyCall() : partialWithoutApplyCall();
}
```

## 9. Native call 参数映射

所有 materialize call 共同携带：

```ts
{
  action: string,
  target_version?: number,
  basis_refs: [...delivery.basis_refs, approval_ref],
  expected_effect: delivery.expected_effect,
  reconsider_when: delivery.reconsider_when,
  routing_id: route_id,
  source_approval_ref: approval_ref
}
```

目标特有字段：

| Target | Native tool | 额外参数 |
|---|---|---|
| memory | `task_memory` | `key=name`, `content`, `summary`, `scope=scope.statement`; `context_visibility=always` 默认附加 `projection.channel=task_prompt`，可带 `prompt_text`/`activation` |
| skill | `task_skill` | `name`, `description`, `instructions=content` |
| tool | `task_tool` | `name`, `description`, `input_schema`, `implementation_ref?`, `program?` |
| subagent | `task_subagent` | `name`, `description`, `instructions=content`, `tools` |
| system_prompt | `task_system_prompt` | 仅 `prompt_channel=system_prompt` 且满足资格时；`name`, `content=prompt_text ?? content`, `scope`, `prompt_target_version?` |

## 10. apply_route 的完整性与恢复

parent 调用：

```json
{
  "action": "apply_route",
  "route_ref": "harness_route:<route-id>@v1",
  "expected_delivery_hash": "<sha256>"
}
```

runtime 依次检查：

1. route ref 能解析为当前 task 的 `auto-research-harness-route-v1`；
2. route 的 `delivery_hash` 等于 caller 提供的 expected hash；
3. 最新 route version 与原 route 身份/hash 一致；
4. disposition 是 `materialize` 且 steps 非空；
5. step dependency 已 applied；
6. native executor 已注册；
7. `native_call.name == native_tool`；
8. native arguments 中 `routing_id` 和 `source_approval_ref` 与 route 一致。

每个成功 step 立即写 receipt。进程中断后重放 route 时，runtime 从 receipt ledger 恢复 `appliedSteps`，只执行未完成步骤。若 route 已 fulfilled，直接返回 `idempotent=true`。

多 step route 不做破坏性回滚：第一步成功、第二步失败时保留已写资源，将 route 标为 `partial`，后续只重试失败步骤。

## 11. 下一轮如何真实生效

| 组件 | 写入后生效方式 | “已生效”的最低证据 |
|---|---|---|
| memory | active index 投影到后续 Pi context；全文按 `task_resource` 分页读取/focus | 后续 provider context 有该版本索引或正文 projection |
| dynamic task/user prompt | 现有 `task_memory` 的 `projection.channel=task_prompt`；`context` hook 每轮按 activation 对当前 checkpoint/environment/assertions 求值后注入 user message | 后续 provider payload 出现满足条件的 projection；条件不满足时不注入，但 canonical memory 仍可按需读取 |
| skill | 写 task-local `SKILL.md`，active index 进入后续 context；Agent 显式读取后使用 | file written + context exposure；读取事件只证明进入上下文 |
| tool | `pi.registerTool` 注册版本化 `exposed_name`，更新 active tools | 下一 provider request 的 tool table 出现实际 tool name |
| subagent | 写 definition；`delegate_task` 启动独立 Pi child process | definition 可见；只有 invocation 才证明实际使用 |
| system prompt | `before_agent_start` 将 active segment 追加到后续 system prompt | 后续 provider payload 中存在对应 segment/version |

固定 host system instructions、权限边界和环境 action authority 不在 task-local mutation 范围内。

## 12. 不限额与可见边界

当前协议不对以下内容施加本地固定数量或字符配额：

- findings 数量；
- harness proposals 数量；
- report conclusion/body；
- delivery content；
- evidence refs 数量；
- child evidence read 次数；
- Auto-Research 调用次数。

以下边界仍然存在，但不应造成 canonical 内容静默丢失：

- provider 自身 token/context/transport 上限；
- `task_resource` 的字符分页；
- provider context projection 和 transcript archive；
- task deadline/action budget；
- 名称格式、CAS、task scope、adapter allowlist 等安全/一致性校验。

Agent 可以根据可见边界自主选择分页、focus、checkpoint、pause、resume、提交 provisional/inconclusive report 或继续研究。

## 13. 当前实现约束与已知缺口

### 13.1 Proposal 生命周期不设串行调度门槛

当前 approval store 允许同一 run 同时存在多个 `pending` proposal；propose 不会收窄 child 的 active tools，也不会 steer child 立即停止读取。提交报告时，报告中引用的每个 proposal 仍必须完成 approve/reject/defer，且通过 delivery hash 校验。这是交付一致性条件，不是 proposal 数量、读取次数或正文长度限制。

### 13.2 Child 完成性尚未由事务协议保证

child 可能已经批准 delivery，却在 deadline/provider 终止前没有调用 `submit_research_report`。此时 approval ledger 有记录，但 parent 不会把它当成 committed report，也不会自动 route；只有完整 structured report 提交后才触发 deterministic apply。这保护了 child 最终交付语义，并保留 approval/session 供后续 resume。

### 13.3 五类组件的真实环境证据层级不同

- 五类 route/native mutation 已由集成测试执行。
- 真实 ARC 已自然触发并写入 memory 和 skill。
- tool/subagent/system_prompt 的真实 ARC 自然触发尚不能仅凭 fixture 宣称。

### 13.4 Task-local skill 的“原生”边界

skill 通过 Pi extension、Pi context hook 和 task-local `SKILL.md` 生效；当前运行显式关闭 Pi 启动时的全局 native skill discovery。它是真实 task-local harness mutation，但不是修改 Pi 安装目录中的全局 skill registry。

### 13.5 Router type 与 apply-time 状态

compiler 的静态 `HarnessRoutePlan` 类型原先只声明 `ready/partial/no_change/waiting`；apply runtime 还会持久化 `applying/fulfilled/failed`。本文按实际持久化状态列出完整集合，后续代码应统一静态类型。

## 14. 示例

### 14.1 Finding 只保留为研究结果

```json
{
  "subject_kind": "task",
  "question": "ACTION1 是否向上移动？",
  "conclusion": "单次观察无法区分移动受阻和方向映射错误。",
  "evidence_refs": ["observation:step-4@v1"],
  "uncertainty": "需要在可移动位置进行第二次对照。"
}
```

该 finding 不足以形成方向映射 fact，因此 `harness_proposals=[]`，不会修改 memory。

### 14.2 已验证事实 → memory

```json
{
  "format": "auto-research-harness-delivery-v1",
  "delivery_id": "level-zero-direction-map",
  "semantic_kind": "fact",
  "operation": "create",
  "name": "level-zero-direction-map",
  "summary": "已在两个非阻挡位置验证方向映射。",
  "content": "在 level 0，ACTION1/2/3/4 分别对应上/下/左/右。",
  "scope": {"kind": "condition", "statement": "仅限当前 level 0"},
  "trigger": "选择移动 action 前",
  "exclusions": ["进入新 level 后不可直接复用"],
  "stability": "stable_in_scope",
  "reuse": "expected_reuse",
  "reasoning": "none",
  "execution": "text",
  "context_visibility": "on_demand",
  "basis_refs": ["finding:direction-test@v2"],
  "expected_effect": "减少重复试探方向的 action",
  "reconsider_when": "level 改变或出现反例"
}
```

确定性结果：一个 `task_memory(upsert)` step，不产生 prompt overlay。

### 14.3 机械算法 → tool

若 finding 支持“输入两个同尺寸 grid，输出变化 bounding box”，且 child 提供明确 `input_schema` 和 declarative `program.steps`：

```text
semantic_kind=computation
execution=pure_computation
program present
→ task_tool
```

若只有算法描述、没有可执行 program/implementation，则 delivery 校验失败；不能把描述文件计作真实 tool。

### 14.4 判断流程 → skill

“读取前后帧、调用差分 tool、区分阻挡与身份错误、记录反例”仍需要条件判断，因此：

```text
semantic_kind=procedure
reasoning=bounded_judgment
→ task_skill
```

skill 可以在 instructions 中引用 tool 的精确版本，但 tool 与 skill 的验证必须分别记录。

### 14.5 稳定 task-wide 规则 → 基础组件 + prompt overlay

一个 direction fact 若被证明覆盖整个当前 task，并显式声明：

```json
{
  "scope": {"kind": "task_wide", "statement": "当前 ARC task"},
  "stability": "stable_in_scope",
  "context_visibility": "always",
  "prompt_channel": "system_prompt",
  "system_prompt_basis": {
    "source": "validated_environment_invariant",
    "evidence_refs": ["observation:direction-invariant@v2"]
  },
  "basis_refs": ["observation:direction-invariant@v2"],
  "prompt_operation": "create",
  "prompt_text": "ACTION1/2/3/4 分别对应上/下/左/右；出现反例后停止使用。"
}
```

同一 evidence ref 还必须出现在 report 顶层或 finding 的 `evidence_refs`。

route 生成：

```text
step 1 memory
step 2 system_prompt depends_on step 1
```

## 15. 持久化文件与真值源

| 文件 | 内容 |
|---|---|
| `task-harness-proposals.jsonl` | child approval ledger 与完整 delivery/hash |
| `auto-research-reports.jsonl` | normalized canonical report |
| `auto-research-runs.jsonl` | 每次 child run 的状态、计数、telemetry 摘要 |
| `auto-research-sessions.jsonl` | 可 pause/resume 的 research session |
| `auto-research-harness-routes.jsonl` | compiler route 及 apply-time 状态版本 |
| `auto-research-harness-route-receipts.jsonl` | 每个 native step 的 applied/failed receipt |
| `task-memory.jsonl` | memory versions |
| `task-skills.jsonl` + task-local `SKILL.md` | skill metadata 与正文 |
| `task-tools.jsonl` | task tool versions |
| `task-subagents.jsonl` | subagent definition versions |
| `task-system-prompt.jsonl` | system prompt overlay segments |
| `harness-decisions.jsonl` | 每次 native component mutation 的 decision audit |
| `harness-observations.jsonl` | 后续 context/tool exposure 观察 |

## 16. 代码索引

- Delivery schema：`demo/pi_auto_research_harness_schema.ts`
- Delivery normalize/hash/router：`demo/pi_auto_research_harness_router.ts`
- Child approval ledger/tool：`demo/pi_auto_research_approvals.ts`
- Child report/checkpoint/evidence audit：`demo/pi_task_validation_child.ts`
- Parent child-process、report parse、route compile、capsule：`demo/pi_task_local_subagents.ts`
- Report normalize/capsule：`demo/pi_auto_research_output.ts`
- Native executor registry：`demo/pi_task_harness_route_runtime.ts`
- apply_route、memory、skill、system prompt：`demo/pi_task_local_self_harness.ts`
- task tool：`demo/pi_task_local_tools.ts`
- task subagent：`demo/pi_task_local_subagents.ts`
- canonical resource reader/paging：`demo/pi_task_resource_store.ts`
- 研究资源 finding：`demo/pi_external_benchmark_research.ts`
- Lossless report ADR：`docs/adr/0003-bounded-auto-research-output.md`
