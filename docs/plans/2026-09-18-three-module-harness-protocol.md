# 三模块责任与无环协议收敛

日期：2026-09-18。
状态：详细设计稿；尚未接入运行时。本文中的工具签名和分类约束是目标契约，不是当前实现的说明。此次仅设计三个模块及其交接，不增加新的主要模块。

## 1. 目标和边界

保留三个主要模块：主 agent、Self-Harness、Auto-Research。主 agent 是主流程，由 LLM 决策和 Pi runtime 执行组成；Self-Harness 是非 LLM 的能力变更与装配模块；Auto-Research 是具有自主研究循环的 LLM agent 模块。

统一入口属于主 agent 的 runtime，不等于 Self-Harness 拥有研究编排职责。主 agent 显式选择 research 或 change，runtime 根据该选择调用对应模块，并在研究返回后将候选交给唯一的 Self-Harness 写入路径。这只是主流程里的薄函数，不是第四个主要模块或另一个调度 agent。

这次收敛不增加评估 agent、能力市场、独立调度器、环境控制租约或新的工作流引擎。复用 Pi loop、现有研究 session/broker、task scope、资源版本、route receipt 和上下文 hook。

| 模块 | 拥有的责任 | 不拥有的责任 |
|---|---|---|
| 主 agent | LLM 选择任务动作或能力改进；runtime 调用研究、接收结果、调用 Self-Harness；判断收益 | 绕过协议直接写组件 |
| Self-Harness（非 LLM） | 校验与分类候选、版本化应用、装配、返回回执 | 决定或发起研究、解释研究目标、判定自然语言结论真实、执行实验动作 |
| Auto-Research（LLM agent） | 在委托内自主分解能力问题、选择研究方法、构建/评估/修订候选；返回证据与候选 | 写主 harness、调用 Self-Harness、真实环境交互、递归发起顶层能力改进 |

能力指在给定条件下产生某类有用结果的方法；组件是能力的实现载体。能力和组件可多对多，但一次候选只表达一种主要语义；组合交付使用多个候选及已有精确版本依赖，不引入第六种持久组件。

## 2. 调用图和无环条件

```text
主 agent LLM：选择环境交互 / research / change
    ↓
主 agent runtime：执行显式选择，保留原请求
    ├─ 环境交互 ───────────────────────→ 环境 adapter
    ├─ research ──────────────────────→ Auto-Research agent
    │     原请求接收结果/等待证据 ←────────────┘
    │     有可应用候选 ─────────┐
    └─ change ────────────────┴→ Self-Harness（非 LLM）
                                  校验 → 分类 → Pi 应用/装配
```

无环指调用权和模块依赖无环，不禁止主 agent 在新证据到达后发起下一次改进。

- Auto-Research 返回结果不是调用主流程入口或 Self-Harness；它不持有 controller、router、applier 的可执行引用。
- worker 需要真实动作时返回结构化请求；主 agent 在正常 loop 决定并执行。worker 不同步回调等待父模型，也不持有环境动作权限。
- 后台完成、恢复、provider length continuation 都继续原请求；不调用模型可见的顶层入口制造新请求。
- 普通 delegate_task 保留为使用已有 subagent 的操作；不能借此向普通 child 授予 harness 写入口或顶层研究派发权。
- 依赖方向：主 agent runtime → research runner、Self-Harness；Self-Harness → protocol/router、Pi backend；research runner → shared protocol/只读材料/session/broker；router → shared data types。Auto-Research 与 Self-Harness 不互相调用或导入。shared protocol 不导入 Pi 或模块实现。

## 3. 主 agent 的入口

目标保留一个主流程能力请求入口。第一版复用 task_harness 的工具名作为迁移外观，但它的 research/change 分派属于主 agent runtime；名字不表示 Self-Harness 内部可以发起研究。不再叠加 harness_change、自定义 dispatcher 和 auto_research 三个顶层工具。

新增两种语义操作；状态读取、取消、继续研究沿用现有 session 控制语义，并从该入口暴露：

```ts
type DecisionBasis = {
  basis_refs: string[];
  reason: string;       // 简短判断摘要，不是内部思维链
  expected: string;     // 预期及可观察的检查方式
};

type CapabilityGoal = {
  purpose: "identify_gap" | "construct" | "compose_adapt" | "evaluate" | "revise";
  question: string;
  use_when: string;
  check: string;
  context_refs: string[];
};

// Candidate、预算、资源引用沿用并收敛现有数据契约。
// request_id/task_id/发起主体由 runtime 生成或认证，不接受模型伪造来源。
type CapabilityRequest =
  | { action: "research"; goal: CapabilityGoal; decision: DecisionBasis }
  | { action: "change"; changes: HarnessChange[]; decision: DecisionBasis };

type HarnessChange =
  | { operation: "create" | "update"; candidate: Candidate }
  | { operation: "retire" | "reuse"; target_ref: string }
  | { operation: "configure"; target_ref: string; config: {
        enabled?: boolean;
        visibility?: "on_demand" | "always";
      } };
```

这是接口设计示意，不是新增可执行源码。create/update 的 candidate 携带完整规范内容与必要目标版本；外层 operation 与候选 operation 必须一致。retire/reuse/configure 按精确 target_ref 解析已有组件，无需重新描述正文或重新猜测组件类型。configure 只接受该组件支持的配置键，至少有一个键，未知/不适用键报错；它不能借 visibility=always 绕过 system prompt 条件。

候选正文、适用条件、依赖、替换关系和 system prompt 投影的修改属于 update；configure 只处理已有资源的启停及可见性设置。没有另一个可以任意改 active tools 或写 prompt 的旁路。

主 agent 自主决定调用环境工具还是 task_harness。已有 harness 自动装配，资源读取和工具/角色调用不用经过变更路由。选择策略可以是任务内 skill，修订它仍经过相同变更入口。环境工具可附同一决策摘要，由 runtime 关联实际动作；不增加独立的“先提交决策”工具仪式。

显式创建、更新、退役、替换以及持久化启停/投影配置都必须经过 Self-Harness。运行时按已有条件计算可见性是装配，不是新的内容修改。

执行外观只需要按主 agent 已经选定的 action 分支：change 交给 Self-Harness；research 交给 Auto-Research。研究完成后只把报告和提案交还给主 agent，不能在同一返回路径中隐式调用 Self-Harness。主 agent 若采纳提案，必须在后续控制周期显式提交 change；这样所有写入都稳定地经过 `主 agent runtime → Self-Harness`，不会形成 `主 agent → Auto-Research → Self-Harness` 的隐藏入口。不能因分类错误自动启动研究，不能由 runtime 自行生成研究目标或反复委派。是否继续研究和是否采纳提案都由主 agent 决定。

## 4. Auto-Research 的输入与返回

goal 的对象是能力问题，不是目标组件。轨迹归因和具体任务分析只在服务能力假设、构建或检验时作为研究步骤。研究完成不要求一定形成可持久化组件。

主 agent 制定 goal、选定材料、已有资源引用和预算，其 runtime 负责传递；Auto-Research 在范围内自主选择子问题、方法、工具和局部验证步骤，而不是按固定代码步骤生成答案。它返回结论、证据、限制、可选候选。主 agent 无需再次抄写候选，也不为所有交付新增一轮父模型审批。现有 child review 作为研究结果的验证信息保留，不能被解释为 harness 写权限或收益证明。

```ts
type ResearchReturn =
  | { status: "completed"; report_ref: string; proposed_changes: HarnessChange[] }
  | { status: "awaiting_evidence"; action_request: {
        action: { name: string; arguments: Record<string, unknown> };
        purpose: string;
      } }
  | { status: "pending"; summary: string }
  | { status: "failed"; reason: string };
```

这是内部返回形状示意；`proposed_changes` 永远只是结构化提案，不是可调用命令，也不会触发写入。主 agent runtime 将其保存为原 research request 的结果，下一次由主 agent 选择是否提交一个新的、显式的 change request。传输时复用现有 session、报告和 checkpoint，不新增一套并行状态账本。父子请求关联 ID 由 runtime 附加。

动作请求只能引用当前环境允许的具体动作。parent 收到后接受或拒绝：接受返回实际执行动作与 canonical observation 引用；拒绝返回理由。执行不同动作必须如实记录，不能伪称原请求完成。child 恢复后自行判断证据是否满足需要，不将任意新观测等同于该实验已执行。

## 5. 薄的候选路由

路由单位仍为一个 Candidate。第一版沿用已有 delivery 的语义、执行、复用、范围、可见性、内容与证据字段，不同时引入另一套描述同一含义的 capability kind。

将分类写成纯代码函数，输入规范化候选，输出目标或带字段路径的错误；不调用模型，不读环境，不写文件，不发起研究。模型负责如实声明内容的语义，代码负责可判定的组合约束。代码不能证明自然语言声明真实或具备收益。

| 语义和属性 | 路由结果 | 不满足条件时 |
|---|---|---|
| fact / plan，execution=text | memory | 返回属性冲突 |
| procedure，execution=text，reuse=expected_reuse，reasoning=none 或 bounded_judgment | skill | 返回缺失或冲突；不静默降为 memory |
| computation，execution=pure_computation 或 adapter_operation，提供有效 program 或获准 implementation_ref | tool | 返回不可执行/不支持的契约 |
| role，execution=model_delegation，提供职责和显式可用工具范围 | subagent | 返回委派契约问题 |
| assessment / evidence，execution=text | research_only | 保存报告，不生成组件 |

procedure 的 inputs、步骤/判断、outputs、停止条件由现有正文契约表达；不新增一个复杂的流程 DSL。research goal 类型、来源身份、置信度高低、调用次数均不决定组件类型。

分类核心可以保持如下规模；候选结构、程序和证据校验复用现有 validator：

```ts
function classify(c: Candidate): BaseTarget {
  switch (c.semantic_kind) {
    case "fact":
    case "plan":
      requireText(c);
      return "memory";
    case "procedure":
      requireText(c);
      requireReusableProcedure(c);
      return "skill";
    case "computation":
      requireExecutableProgram(c);
      return "tool";
    case "role":
      requireModelDelegation(c);
      return "subagent";
    case "assessment":
    case "evidence":
      requireText(c);
      return "research_only";
    default:
      throw invalidCandidate("semantic_kind", "unsupported semantic kind");
  }
}
```

上述是设计代码，不是已存在的函数定义。它不读取操作来源，因此相同候选从直接变更或研究完成进入时分类一致。

system_prompt 保留为显式的附加投影：只有 always + task_wide + stable_in_scope，且带明确任务契约或已验证环境不变量依据的候选可以请求；assessment/evidence 不得投影。动态计划默认 task prompt/memory；重要性不是提升依据。保留现有基础资源加 overlay 的语义，防止此次边界重构同时改变资源模型。

## 6. 应用、恢复和错误

- 主 agent runtime 在调用 Auto-Research 前记录请求及 decision；所有后续研究报告、route、receipt 关联该请求。
- Auto-Research 完成后只返回报告/候选；主 agent runtime 校验返回来源并交给主 agent。只有主 agent 在后续周期显式提交的 change 才能交给 Self-Harness，后者调用同一分类和编译函数，再进入 Pi backend。
- update/retire 必须绑定当前精确版本；版本过期返回冲突，不自动覆盖。跨类型修改使用显式替换。
- task scope 由 runtime 验证。child 不能自行标记为主 agent，伪造 request_id 不能获得修改权限。
- 重复完成和进程恢复沿用交付 hash、route receipt 幂等处理；主 agent runtime 在父进程安全边界调用 Self-Harness 应用，随后再组装下一次模型输入。
- 多组件采用现有逐步回执，允许 partial 并明确已应用部分，不宣称全事务回滚。
- 缺失属性、不支持的组件和版本冲突返回错误；router 不反向启动研究。是否修正/追加研究由主 agent 决定。
- 评估、失败或证据不足可以合法结束请求而没有组件变更。研究完成、组件应用、后续收益是不同结果。
- 决策反馈复用现有 evidence/assessment 记录。追加后续评估，不覆盖当时理由；关联选择策略的精确版本。

## 7. 当前代码与迁移顺序

当前证据：

- `demo/pi_task_local_self_harness.ts` 通过 `task_harness(action=change)` 提供 parent 统一写入边界；`registerRoutableTool` 注册的 component handlers 仅作为内部 native executor，并由 `apply_route` 复用。
- `demo/pi_task_local_subagents.ts` 同时负责 child 运行、compileHarnessRoute、nativeHarnessRouteApplier 以及后台完成后的应用 reconciliation。
- `demo/pi_auto_research_harness_router.ts` 已有可复用的候选规范化、代码分类映射、计划编译与 hash；共享 `pi_harness_protocol.ts` 负责 procedure/tool/subagent 语义分类以及 system-prompt overlay 资格校验。
- `demo/pi_task_harness_route_runtime.ts` 是按任务根隔离的进程内 handler registry，不必换成服务或 RPC。

建议按以下可验证顺序迁移：

1. 将通用候选类型、validator、分类/编译规则从 Auto-Research 命名空间抽出。旧格式与导入只作为兼容适配，不能形成第二套分类规则。补充属性冲突和同候选同分类检查。
2. 从 subagents 模块抽出 research worker：保留子进程、报告、session/continuation；去掉 route 编译、apply 和 reconciliation 的写权限。后台输出仍只生成研究结果。
3. 在主 agent runtime 中提取薄的请求处理函数，接管 research/change 显式分派、结果消费和后台完成处理；Self-Harness 只拥有候选校验、route 编译与应用。通过组装层注入 runner 和 Self-Harness 接口，避免两者互相导入。
4. 收拢 parent tool surface：task_harness 外观暴露 research/change；auto_research 不再是可绕过主流程请求记录的顶层入口。真实 provider surface 不暴露 task_* 写工具；它们只保留为 native executor 和诊断 fixture 兼容入口，新的 parent prompt、review 和 route 全部使用统一 facade。不能仅把名字从 active tools 隐藏就宣称没有旁路，必须验证 native receipt 和 exact resource version。
5. 更新 parent/child guidance、研究目标和真实 runner 场景。旧历史记录可读取，但恢复中的研究结果也必须回到原主流程请求，通过 Self-Harness 应用。

实施时保留当前工作区已有未提交改动；不回退现有知识生命周期、控制修复、效果 assessment 和 provider continuation 工作。

## 8. 验收

诊断检查：相同候选来源无关；属性冲突返回具体错误；child/普通 delegate 无 harness 写入口；旧工具不能旁路；Auto-Research 不依赖 router/applier，Self-Harness 不持有研究/模型调用接口；研究结果只能匹配原请求；重复和后台完成只应用一次；版本过期不覆盖；失败/无候选不伪报变更；main action 请求真实回执关联。

闭环验收必须使用 `arc-harness-smoke`：真实 ARC bridge、Pi parent loop、child broker/process、结构化返回、controller/router、native mutation、ARC action 边界、后续真实 parent turn。覆盖 system_prompt、skills、memory、tools、subagents，断言语义输出，并覆盖 Auto-Research 和普通 delegate_task 的 provider length continuation。增加直接 change 与 research 完成两种入口来源和后台恢复场景。

pytest、手工 JSONL、离线脚本 parent 和 mock environment 不单独证明真实 ARC 全链路闭合。确定性 provider 只能验证 wiring/lifecycle；provider 行为或 benchmark 收益仍需真实 provider 运行。

与 deferred-research-todos 的关系：本方案只收拢 A 的 Agent 侧边界及 C 的最小请求/返回契约；不据此宣称父子主动实验通信已实现、跨压缩语义质量已解决或真实研究收益已证明。

## 9. 三个模块的详细责任范围

### 9.1 主 agent：LLM 决策与 runtime 执行分开

主 agent LLM 持有任务目标和当前任务解释，决定下一步具体动作、是否研究、研究什么、是否直接改变 harness，以及如何响应研究动作请求。它可以多次读取/计算后再提交一次环境动作；不把每个模型 turn 强制限制成互斥的一类活动。ARC 的最终动作边界仍遵守当前任务契约。

主 agent runtime 是同一主流程的确定性执行部分。它负责工具注册、request/session 身份、预算执行、调用模块、接收结果、主进程内写入排序、回执关联和下一轮输入准备。它可以按照显式请求分派，不能根据“多次失败”等启发式规则自行创造研究目标、选择新策略或不断调用 Auto-Research。

主 agent 可以直接 change，也可以 research。它自行形成的候选和研究返回的候选进入同一 Self-Harness 接口；区别仅在来源和证据，不在分类规则。继续使用当前 harness 也是合法选择，不要求为了形成闭环而修改。

### 9.2 Auto-Research：在委托内自主，而不是固定流程脚本

可自主决定：分解子问题、提出/否定假设、选择已有只读工具和纯计算工具、构造方法、挑选局部验证案例、整理反例、决定在预算内继续或结束。可以研究能力组合、任务策略、选择策略和研究方法，但最终须回答委托中的能力问题。

| goal purpose | 应回答的问题 | 合法输出 |
|---|---|---|
| identify_gap | 当前缺失或不可靠的是哪种能力，是否值得改进 | 能力需求、优先依据、无需改进的结论 |
| construct | 怎样形成满足用途的方法 | 候选实现及局部验证；也可返回不可行/证据不足 |
| compose_adapt | 怎样组合或适配已有能力 | 有精确依赖的组合方法、配置建议、限制 |
| evaluate | 某能力在哪些条件下正确/有用，证据有多强 | 评估报告、反例、下一次检验需要；允许零变更 |
| revise | 怎样修复、替换或停止使用已有能力 | 更新、替换或退役提案及依据 |

这些 purpose 是目标描述，不是组件路由条件，也不强制执行五阶段工作流。主 agent 若只需要当前一步决策，可以直接处理或使用普通 delegate_task，不能把与能力无关的任意子任务都包装成 Auto-Research。

不允许：直接真实交互、对父 harness 写入、改变任务目标、扩大证据访问范围/预算/工具权限、通过注册工具或普通 delegate 绕过限制、递归发起新的顶层能力请求。研究内部的分解与迭代不是新的顶层请求；已有 runner 支持的内部子任务必须继承并收紧原委托边界，不新增递归调度机制。

研究是 LLM 行为，其结论、语义标签和 review 都可能有误。报告必须保留不确定性；规范输出只能保证可解析，不保证结论真。

### 9.3 Self-Harness：非 LLM 的组件管理

内部三个职责是函数/代码单元，不是三个新的 agent：

1. 协议与路由：规范化输入、校验组合约束、确定目标，编译声明式变更计划。
2. 应用与生命周期：检查身份/任务/版本/依赖、写入、退役、替换、配置、回执、恢复。
3. 装配：依据有效资源和明确条件构建 prompt/context/tool surface，记录实际装配版本。

Self-Harness 不提供 research 方法，不持有 provider/模型调用接口，不解释研究目标。注册 subagent 定义不是运行 subagent；注册工具定义不是执行工具程序。实际 delegate_task 和工具调用由主 agent runtime 发起，受当次调用权限约束。

“非 LLM”意味着相同规范输入、相同资源版本和相同策略版本产生相同计划或错误；应用时仍需检查最新状态，因此并不承诺过期请求在不同时间得到相同成功结果。

## 10. 入口、来源与交接协议

### 10.1 一个主流程入口，两种内部调用

对模型的能力请求入口沿用 task_harness 名称，明确其为主 agent runtime 的外观。新增 research/change 语义；inspect/resume/cancel 只是该请求/session 的控制操作，不创建额外研究入口。原有 start/focus/review 等需要按功能归位：

- start 是任务运行初始化，不生成能力或要求 LLM 反复 kickoff。
- inspect/status 是只读状态和回执查询。
- focus 是当前上下文工作集选择，属于装配输入；不修改候选正文或语义有效性。
- review/assess_effect 是主 agent 的评估记录，不可伪装成应用；其候选若要生效仍须 change。
- 周期 review 可以提供中性的待办提示，不能硬编码“到某计数必须研究/生成某组件”。显式实验配置中的强制门槛需单独标注，不归为自主选择策略。

内部接口保持简单：researchRunner.start/resume 返回研究结果或暂停；selfHarness.apply 接收声明式变更和 runtime 提供的上下文。模型不可直接传 native_tool、execute 函数、宿主路径或任意 Pi API 调用来逃避协议。

### 10.2 身份和数据的唯一来源

| 数据 | 谁产生 | 谁使用/维护 |
|---|---|---|
| task_id、request_id、session_id、执行身份 | 主 agent runtime / 现有 runner | runtime 用于关联和权限核对 |
| goal、decision、材料选择、要求的预算 | 主 agent | runtime 按宿主上限执行，Auto-Research 在范围内研究 |
| report、提案、child review、局部检验记录 | Auto-Research | runtime 验证来源，Self-Harness 只接收合格声明 |
| 规范化候选 hash、分类计划、资源版本、应用回执 | Self-Harness | runtime 交付结果，后续读取/装配使用 |
| 实际动作及 observation | 环境 adapter，经父 runtime 记录 | parent/child 按授权读取，不能由研究者伪造 |
| 效果判断与修订理由 | 主 agent 或受委托研究者 | 追加关联记录，不覆盖原判断 |

ID、版本、来源绑定由代码维护，避免要求模型复制 hash 或假装自己拥有另一个主体身份。跨进程返回必须匹配当前 task/request/session，单独一个字符串 request_id 不构成授权。

### 10.3 一条进入 Self-Harness 的路径、一个研究交接点

直接变更：主 agent 提交 change 和 decision → runtime 记录请求 → Self-Harness 处理 → 同一次工具结果返回计划/回执/错误。

研究交接：主 agent 提交 research → runtime 保存 goal/decision 并启动 child → child 返回完整报告与提案 → runtime 将报告和提案交回主 agent。主 agent 如需采用，必须在后续周期以原提案引用提交显式 change → runtime 再调用 Self-Harness。研究请求本身不携带隐式“研究后自动应用”选项。

这样不需要额外的 adopt agent 或复杂审批状态机：主 agent 的 change 本身就是采纳和试用决定；研究只负责提供高层能力结论、证据和候选。pending/deferred/rejected 提案不能被 change 引用为已接受结果，单纯报告中的建议也不能自动变成变更。

资格核对与语义验证不同：runtime/Self-Harness 能检查来源、接受状态、hash、scope、版本和字段；不能由“格式正确”推出“方法正确”。本次不额外发明 adopt/review agent 或另一套审批状态机。

### 10.4 交接时保存什么、向模型显示什么

完整报告和候选正文各有一个规范来源，保留在现有研究/资源记录中。内部 ResearchReturn 可携带已解析的 proposed_changes；跨进程、后台通知和 parent context 使用这些记录的精确引用，不反复复制同一份正文。

parent 接收的简短结果至少包含 request_ref、研究状态与 report_ref（如有）、实际应用状态、资源版本引用、失败/冲突原因、下一次可见阶段。研究状态与应用状态分别保留：completed + partial 是合法组合，不能把它缩成一个笼统的成功。

Self-Harness 返回的回执不含下一步任务建议。runtime 可以提供合法操作或缺失字段，但不伪装成 LLM 的改进判断。需要修改正文时由主 agent 或新研究产出新候选；不存在 router 自动润色并重试的回路。

共享协议仅定义数据。Auto-Research 读取主 harness 时由 runner 提供授权快照或共享只读 reader；它不调用 Self-Harness 的修改/装配后端，也不持有可变资源对象引用。

## 11. 动作请求与研究恢复

模型面对的最小请求仍为 action + purpose。runtime 自动携带 request/session 关联和发起时最近的 observation 引用。每个研究 session 同时只保留一个待回应的动作请求；多步实验逐步请求，不把一个自由文本实验计划当成无限动作授权。

顺序如下：

1. child 在结构化返回中提交动作请求，保存研究 checkpoint，并 yield 为 pending、wait_reason=action_reply；不继续占用同步父调用等待 parent。
2. runtime 将简短请求交给主 agent，明确它是研究建议，不是已经发生的事实。
3. 主 agent 接受时使用现有环境工具并关联请求；拒绝时通过原 session 控制接口回应理由。无需新的动作工具或审批引擎。
4. runtime 记录实际执行动作、观测引用和状态序列，或者拒绝/执行失败结果。
5. 结果交付后，runtime 在预算允许时按既有 session 恢复规则继续原研究；这只是完成原委托，不是自主发起新研究。child 决定证据是否足够。

主 agent 不必立即执行请求。若环境在等待期间已变化，主 agent 应基于当前状态选择执行、拒绝或返回相关新证据；runtime 标记发起与执行观测版本不同，不把过期条件当作仍成立。环境不可回滚时不许声称复现了原实验条件。

拒绝不是系统失败；研究可以在现有材料上继续、修改结论，或以证据不足结束。父请求取消后不再恢复 child，也不应用迟到交付。已经执行的真实动作不能因取消而抹去或伪称回滚。

非阻塞只改变主 agent 是否继续任务，不改变 child 权限、目标或结果采用规则。需要动作时，阻塞研究也必须释放父流程，不能形成父等子、子等父的互等。

动作回应复用 task_harness(action=resume) 的 session 控制入口，增加一个 reply 数据字段即可，不新增工具：已执行/失败时只提交实际 tool receipt 引用，runtime 从回执取得真实动作和观测；拒绝时提交 reason。调用方不能自行填写 observation 并冒充环境回执。环境工具也可以关联当前请求，由 runtime 自动完成同样的交付，两种方式复用同一处理函数并去重。

研究恢复有两类：provider length 截断属于同次研究执行的传输续跑；等待证据属于保存 checkpoint 后的逻辑暂停。二者均保持原 goal、身份和累计预算，不能把截断当完成或把恢复当成预算重置。parent 可以通过原 session 控制明确调整剩余预算，仍受宿主限制。

预算沿用现有 runner 支持的成本/调用/时间字段，不在候选路由里新增预算策略。等待期间不进行模型轮询；任务结束或 session 取消后停止调度恢复。进程超时、provider 失败、预算耗尽返回可恢复状态或失败原因，不由 Self-Harness 自行重试研究。

## 12. 路由、正文校验与应用的范围

### 12.1 路由必须薄，不能变成自动规划器

代码路由只回答两个问题：该声明的属性是否一致；一致时应由哪类组件承载。它不优化正文、不补造证据、不替模型把混合文档切成不同语义、不自行决定要不要研究。

一份复杂结果可以显式包含多个候选。代码只遵守声明的依赖，并检查不存在循环；不会从自然语言自动发明组件图。候选之间若需引用新资源，使用同批候选 ID 的结构化依赖，成功应用后由 runtime 绑定精确资源版本，不能让模型猜测未来版本。

结构 schema/validator 负责字段、枚举和执行载荷；分类函数负责语义/执行/复用属性的组合。现有的 evidence refs、expected_effect 等是溯源和效果描述，不是额外分类维度。不增加为每种 goal 单独定义的路由表。

### 12.2 工具、subagent 和 system prompt 的特殊边界

工具仅可采用已支持的声明式程序或允许的实现引用。分类为 tool 不授予任意代码执行、文件或环境权限。程序含 adapter_call 时必须如实声明 adapter_operation；child 的局部测试仍不能执行真实环境动作，包括通过包装工具间接执行。

subagent 保存的是角色指令、输入/输出契约和工具范围。apply 不会立即运行它。Auto-Research 是固定的研究机制，不因保存一个名为 auto-research 的角色而替换宿主研究入口；普通角色不能取得父任务写权限。

system prompt 是任务内 overlay，不是对宿主系统指令的重写。其资格依据由模型声明，代码验证依据种类、引用和稳定范围等结构条件；环境不变量是否真的成立仍是证据判断。不能把 validator 通过描述为客观认证。

### 12.3 写入、版本与失败

在写任何资源前，预检整批候选的结构、任务范围、依赖可解析性、已知版本和权限。应用期间仍逐项检查前置条件；合法计划可能因并发或进程中断部分完成，因此维持 applied/partial/failed 回执。

所有修改在父 runtime 的安全边界串行应用。后台研究不能直接注册工具、改变 parent 内存状态或写组件版本。多个研究修改相同资源时按当前版本检查，晚到的过期提案冲突返回；不采用 last-write-wins。

幂等身份采用 request + candidate/change ID + 规范内容 hash。资源写入必须携带 operation identity，恢复时核对资源记录与 route receipt，修补“资源已写但回执未写”的中断窗口；不能仅凭回执缺失重写一个版本。相同身份但不同内容拒绝。这里保证可恢复的组件修改，不宣称外部动作 exactly-once。

退役/替换影响依赖者的可用性，沿用已有精确版本依赖和失效传递机制。依赖停用不等于删历史，不自动对旧事实/计划作语义重写。重新验证及修订仍由主 agent 或研究者提出。

## 13. 装配与使用的范围

持久化、装配、实际使用、收益分别记录，不合并为一个 completed。

| 组件 | 持久化内容 | 装配/使用方式 | 不等同于 |
|---|---|---|---|
| memory | 有版本的事实、假设、状态或计划 | 索引/按需读；显式条件满足时投影 task context | 已验证真值或 system 指令 |
| skill | 可复用方法、适用条件、依赖 | 索引与按需读取；需要时投影方法 | 方法已被正确执行 |
| tool | schema 与受支持的执行实现 | 注册并按配置暴露；主 agent 实际调用 | 创建时已经执行程序 |
| subagent | 角色、工具范围、返回契约 | 可发现定义；runtime 通过 delegate_task 调用 | 创建时已经启动 child |
| system_prompt | 符合条件的稳定任务 overlay | Pi 支持的下一 before_agent_start 时生效 | 修改当前正在运行的模型请求 |

装配只使用当前合法、未退役、依赖有效且满足 activation 的版本。Self-Harness 不通过 LLM 判定“现在相关不相关”；若需要语义选择，由主 agent 选择工作集或提交明确配置。

上下文 hook 可以在下一模型请求重建 memory/skill 等投影；system overlay 若受 Pi 生命周期限制只能在下一 parent turn 生效，回执必须说明。已经在进行的模型请求和 child 使用的是各自已有快照，不热替换其语义前提。child 若需新资源版本，由 runtime 在恢复/新委托时显式提供。

registry 中存在、active tools 中可见和调用时允许三者不能混淆。已退役或失效的工具/角色即使出现在旧上下文中，执行时也要检查最新有效性。

## 14. 决策记录、验证与认知连续性

主 agent 对关键语义操作提供 basis_refs、reason、expected。runtime 追加 decision_id、实际操作、成本、使用的选择策略版本和结果引用。相关低层读取/计算共享该语义操作的关联，不要求每个步骤都重复写理由。

runtime 自动记录的是事实：执行状态、资源版本、观测和成本。验证判断由主 agent 或 Auto-Research 作出并追加到现有 assessment 记录，注明判断者、维度、范围和证据。维度至少区分解释支持、方法正确性、方法收益；局部运行通过不代表真实任务收益。

选择策略可作为可修改的 skill，内容为如何比较交互、研究、直接变更的价值；它不拥有执行权，也不能改写宿主权限和任务目标。其新版本仍走 Self-Harness，不给“元策略”专用旁路。

待验证预期只在相关情境/结果出现时投影给主 agent；完整历史可检索。原文落盘、context 压缩和语义保留是不同事项。本次保留现有 checkpoint/lifecycle，但不增加自动语义 consolidation，也不因有记录就宣称跨压缩认知质量已闭合。

反馈可以让主 agent 发起下一次请求，关联前次 request/report；这属于任务时间上的学习循环。它不允许 router 自动调用研究者、研究者自动写资源、失败回调不断重启顶层请求等控制依赖环路。

## 15. 各机制的归属和限制总表

| 机制 | 所属模块/部分 | 允许 | 限制 |
|---|---|---|---|
| 下一步选择 | 主 agent LLM | 交互、research、change、继续使用 | 不要求固定能力改进顺序 |
| 请求分派与关联 | 主 agent runtime | 根据显式 action 调用模块 | 不生成目标、不做语义规划 |
| 研究规划与方法选择 | Auto-Research | 委托内自主分解、试验、修订 | 不扩大目标/权限/预算 |
| 真实动作与实验请求 | 主 agent + 环境 adapter | 接受/拒绝 child 建议，执行具体动作 | child 不能直接或间接控制环境 |
| 研究预算/续跑 | 现有 runner/broker，由主 runtime 使用 | 延续原 session、记录消耗 | length continuation 不是新研究；不重置总预算 |
| 候选 review | Auto-Research；直接 change 由 parent 提交 | 表达接受、拒绝、推迟及不确定性 | 不等于写权限或客观认证 |
| 分类路由 | Self-Harness 纯代码 | 校验属性，生成固定目标计划 | 不调用 LLM、不补语义、不触发研究 |
| 应用与恢复 | Self-Harness + 父 runtime 安全边界 | 版本检查、写入、回执、幂等恢复 | 不执行工具正文或自动 delegate |
| 条件装配 | Self-Harness/Pi hook | 投影合法资源、配置工具可见性 | 不热改正在进行的请求 |
| 工具/角色使用 | 主 agent runtime | 调用当前授权且有效的资源 | 注册成功不赋予额外权限 |
| 决策与效果反馈 | 主 agent/Auto-Research + 现有记录 | 可追溯判断、后续修订 | runtime 不伪造理由或因果结论 |
| context 压缩/恢复 | Pi 与现有 lifecycle | 归档、检查点、按需读取 | 非此次新增语义记忆模块 |
| 跨任务迁移/共享能力库 | 本次不包含 | 保留未来接口可能性 | 当前资源严格 task-local |

## 16. 场景走查与验收补充

### 16.1 直接保存方法

parent 已形成方法 → change(create procedure) → runtime 记录理由 → Self-Harness 校验复用/执行属性并写 skill → 回执包含实际版本与预计可见阶段 → 下一次按需读取使用。整个过程不调用 Auto-Research。

### 16.2 研究并应用

parent 请求构建摘要能力 → runner 启动自主 child → child 用授权历史材料和纯计算检查候选 → 返回报告及已接受的提案 → runtime 校验原请求与返回来源 → Self-Harness 生成工具/方法计划并应用 → parent 获得结论与回执。child 不知道也不能直接调用父端 handler。

### 16.3 需要真实证据

child 无法用历史材料区分两个能力假设 → 返回一个具体动作请求并 yield → parent 正常选择是否执行 → 实际回执交回同一 session → child 恢复并修订结论。若 parent 拒绝或动作失败，报告如实保留限制，不伪造支持证据。

### 16.4 纯评估与失败

evaluate 返回能力在部分场景不可靠，但没有明确提案 → 仅交付报告，零 mutation。已接受提案如果 schema 错误或版本过期 → 记录未应用原因并交给 parent，不由 Self-Harness 再调用研究。

### 16.5 后台、取消和并发

parent 在 child 运行时继续任务；返回时先校验 session 仍有效和资源版本。取消后的迟到返回保留为审计材料，不应用。不在后台进程修改 parent registry。两个候选修改同一版本时只允许符合当前版本的写入，另一份返回冲突。

在第 8 节验收矩阵外，补充：阻塞研究请求动作必须 yield 无互等；Auto-Research 使用包装工具也不能真实交互；创建 tool/subagent 不隐式执行；动作拒绝/状态过期/实际动作不同要如实回传；取消迟到交付不应用；写入与回执之间中断可恢复；同请求 length 续跑不重复写入或重置预算；策略 skill 变更不能改变宿主边界。

本次交付是设计文档，不是实现或运行验收。实施仍应按第 7 节顺序收口现有代码，再执行真实 runner 验收，不以该文档代替运行证据。
