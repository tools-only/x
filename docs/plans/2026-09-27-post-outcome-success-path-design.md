# 完成后提炼成功路径：设计与实施契约

日期：2026-09-27  
状态：核心机制已实施并通过针对性测试；真实 provider 的方法质量与收益尚未验收。

已实施范围：成功后由主 Agent 提交有证据的 `success_path` 候选，失败/RESET 后可提交按需读取的 `failure_modes`；Runtime 生成调用成本索引、核验精确引用、持久化报告并投影简短成功路径。待复盘窗口只投影成本摘要和可分页读取的索引 ref，不把完整调用清单重复塞入主 Agent 上下文。最近一次失败复盘不会覆盖较早的成功路径卡。成功路径进入能力机会列表，但不会自动生成或装配 Harness 组件。审计报告区分观测成本、省略提议和未经测量的节省。当前成本索引只给 parent 工具调用与窗口级 provider usage；child 成本、工具参数安全摘要及跨任务推广尚未实现。若边界不明确，增量成本明确记为 `null`，不把累计值误当增量值。

## 目标和现有边界

用户要把一次任务中自由探索得到的结果，事后整理成下次可执行的方法，并审查调用成本。例如 189 次工具调用里，哪些为发现规则提供了证据，哪些在规则已知后仍需重复，哪些可以提出省略假设。一次成功不能证明省略这些调用后仍会成功，因此本机制保存证据、主 Agent 的判断和后续试用结果，不生成因果证明或模型训练奖励。

现有 `demo/pi_level_retrospective.ts` 根据 `execution-observations.jsonl` 打开关卡成功、RESET、GAME_OVER 和预算耗尽窗口，验证精确证据引用；`task_harness(action='level_review')` 将主 Agent 的报告写入 `task-level-reviews.jsonl`，`task_resource` 可按版本读取。`pi-events.jsonl` 有工具开始/结束及 `toolCallId`；`provider-telemetry.jsonl` 有请求级耗时和用量。当前没有成功路径结构、逐窗口工具调用索引或“发现成本/复用成本”的归因。ARC runner 目前禁用 `bash/ls` 等通用工具；这些示例只能在实际暴露该工具的任务中统计。

设计保持五类原生 Harness 组件：`system_prompt`、`skill`、`memory`、`tool`、`subagent`。复盘和调用索引是任务证据资源，不是第六类组件。遵守单条不可回退 ARC 历史：主 Agent 独占真实环境动作，child 只有隔离的只读研究和实验请求权，Self-Harness 只执行确定性记录、校验、索引和投影。

## 方案选择：ADR

| 方案 | 代价和问题 | 结论 |
|---|---|---|
| 只靠主 Agent 自述复盘 | 改动少，但无法核对工具次数、调用身份及遗漏的探索 | 不采用 |
| Runtime 按调用数自动剪枝并写新方法 | 数字直观，却会把产生关键信息的 probe 误判为冗余；代码无法判断任务语义 | 不采用 |
| **日志统计 + 主 Agent 后验提炼** | 增加只读索引及有界复盘；判断可追溯，后续仍需试用 | 采用 |

决策 1：扩展现有 `level_review`，维持 `task-level-reviews.jsonl` 为唯一语义报告来源。成功路径不会由 Runtime 自动升格为 Harness。历史 v1 报告照旧可读；新报告使用 v2 契约。同一 `window_id` 的提交保持幂等，不能因恢复而产生不同版本的“成功事实”。既有报告不原地回填。

决策 2：失败后也可提炼失败模式，但只作按需检索的证据。失败模式描述触发条件和恢复或检验动作；不把整段错误清单持续注入探索上下文。普通安全、权限和预算门禁不受此投影策略影响。

决策 3：调用总数是观测事实；“可省略”是主 Agent 提出的反事实假设；节省多少成本及是否保持成功率，只有后续可比任务的实际执行才能评价。报告要明确这三个层次。

## 事件窗口与工具成本索引

沿用 `levelReviewWindows()` 的 `window_id`、`boundary_ref`、`evidence_refs`、`reasons` 和 `boundary_source`。`level_success` 必须由公开环境状态确认：`WIN` 或 level index 上升。`agent_reported_reset_requires_verification` 只能支持标为未验证的 reset 经验，不能作为环境确认的成功或失败证明。

从工具开始/结束事件配对得到 `call_ref`，建议稳定地址为 `tool_call:<run-local event ordinal>:<toolCallId>`，不要只用 `toolCallId`，因为恢复或重新启动可能重复 ID。`execution-observations.jsonl` 已保存 `toolCallId`；通过该字段将调用和 observation 精确关联。`pi-events.jsonl` 的行序号可作为旧日志的稳定顺序；新日志由 runner `persist()` 给每条事件写入 `recordedAt`。时间缺失时延迟记为 `unknown`，不可由行数推算。

窗口归属以成功边界的 ARC `toolCallId` 及其事件位置为终点，起点取前一关成功边界之后。这样能覆盖首次环境观察之前的准备调用。RESET 后现有关卡窗口继续包含较早尝试，因此索引同时报告 `whole_level`（本关累计）和 `since_previous_boundary`（新增片段）；汇总多窗口成本时只对新增片段求和。无精确边界或跨进程并发的调用标为 `unattributed`，不能按墙钟猜测归属。原始环境 action 结果仍以 canonical observation/bridge 事件为准，索引不替代它们。

建议将索引存为可重建的 `task-outcome-cost-index.jsonl`，通过 `task_resource(kind='outcome_cost_index')` 分页读取；这是派生证据资源。索引中的一条调用至少包含：

```ts
type IndexedCall = {
  call_ref: string; tool_call_id: string; source_event_start: number;
  source_event_end?: number; tool_name: string; actor: 'parent' | 'child' | 'unknown';
  args_shape_or_safe_summary?: string; args_sha256?: string;
  observation_refs: string[]; result: 'success' | 'error' | 'rejected' | 'incomplete';
  elapsed_ms?: number; measurement_basis: 'event_time' | 'unknown';
};
type OutcomeCostIndex = {
  format: 'task-outcome-cost-index-v1'; window_id: string;
  boundary_ref: string; boundary_call_ref?: string; source_cutoff_event: number;
  source_hashes: Record<string, string>; coverage: 'complete' | 'partial';
  gaps: string[]; calls: IndexedCall[];
  whole_level: { tool_counts: Record<string, number>; arc_actions: number };
  since_previous_boundary: { tool_counts: Record<string, number>; arc_actions: number };
  provider_cost: { request_count?: number; input_tokens?: number;
    output_tokens?: number; elapsed_ms?: number; attribution: 'exact' | 'window_only' | 'unknown' };
};
```

工具参数仅存安全摘要和 hash，原始输入以原始事件为准。工具拒绝与引擎错误分开统计，未配对的调用仍计入 attempted。Provider 用量是请求级成本：只有有稳定 request/turn join 才标为 `exact`；否则只给窗口范围或 `unknown`，不摊派到单个工具。child 用量另列，只有 child invocation/ref 能精确关联时才并入对应窗口。索引幂等由 `window_id + source_cutoff_event + source_hashes` 确定；若新证据晚到，应生成新派生版本并保留旧版本，不能悄悄改已提交的语义报告。

## 复盘数据契约

`level_review` 原有 `summary/mechanisms/shortcomings/lessons/next_attempt/credits` 保留以兼容旧消费者。新报告增加两个字段：

```ts
type SuccessPath = {
  status: 'candidate' | 'insufficient_evidence';
  scope: string;                 // 关卡、任务和适用阶段；不得把本关坐标泛化为规则
  preconditions: string[];       // 下次开始前应检查什么
  steps: Array<{
    operation: string; input_or_condition: string; output_or_check: string;
    evidence_refs: string[]; call_refs?: string[];
    role: 'discovery' | 'repeat_execution' | 'validation' | 'uncertain';
  }>;
  success_check: string; uncertainty: string; reuse_advice: string;
  proposed_omissions?: Array<{
    call_refs: string[]; rationale: string; risk: string;
    confidence: 'low' | 'medium' | 'high';
  }>;
};
type FailureMode = {
  symptom: string; trigger: string; falsified_hypothesis?: string;
  evidence_refs: string[]; recovery_or_next_test: string;
  applicability: string; confidence: 'low' | 'medium' | 'high';
  evidence_status: 'environment_confirmed' | 'agent_reported_unverified';
};
```

新成功窗口的提交须包含 `success_path`，但允许 `status='insufficient_evidence'`，避免鼓励编造路线。`candidate` 至少有一个步骤、一个精确窗口证据、非空检查条件和适用范围；每步的 `evidence_refs` 必须在本窗口，`call_refs` 必须在该窗口索引。`proposed_omissions` 是建议，不能写入 Runtime 的计数事实。失败窗口不得提交 `status='candidate'` 的成功路径。`failure_modes` 可为空；只有具体的失败、RESET 或成功窗口内被证伪的假设才提交。其所有 observation 引用均须属于本窗口，RESET 来源若未获环境确认则固定为 `agent_reported_unverified`。现有 credit 规则继续要求成功 Harness 贡献有实际应用 observation，创建、暴露或读取仍不能获得正向贡献。

主 Agent 要把已证实的规则写成输入、判断、动作、结果核对的程序。示例中“识别图标与 tile 的对应关系，找出违规 tile，计算点击中心，行动后核对变化”可形成候选 Skill；固定 `(38,38)` 等坐标只是当前状态事实。索引给出 189 次调用和候选调用引用；主 Agent 可把某些 probe 标为 `discovery`，说明下次规则已知时可能无需重复，而不抹掉它在本次成功中的作用。

## 投影、作者权与终局

主 Agent 提交路径、失败模式、反事实省略理由及适用范围；必要时可主动委托 Auto-Research child 对证据或竞争方法做只读审查。child 只返回候选与引用，不启动研究调度、不执行 ARC action、不写 Harness。Runtime 冻结窗口，产生成本索引，验证引用与来源，持久化报告，并在后续上下文投影短索引；不得撰写步骤、判断冗余、创造工具或给出因果信用。

普通后续上下文仅展示最近的成功路径卡片：`level_review` 精确 ref、适用范围、前提、核心步骤和验证条件。完整报告及工具索引按 ref 读取。失败模式在默认上下文只出现计数/ref；当当前状态或主 Agent 明确请求时再读详情。现有 `pi_task_local_self_harness.ts` 会默认重复注入 `lastReview.lessons/next_attempt/credits`，且 `capabilityReviewSources()` 从这些文本生成能力机会；实施时需要改成成功路径优先的短投影，避免负面材料重新占据每轮上下文。兼容字段 `shortcomings` 可以简短填写已观察事实和不确定性；`next_attempt` 在成功后指向路径适用性验证，在失败后写恢复试验，不要求罗列错误。历史 v1 的投影也应限长并保持引用。

在关卡成功但游戏未结束时，主 Agent可在后续可写轮次决定是否通过 creator → `task_harness(change)` → 精确 `assemble` → 实际使用/评测，把路径转成五类组件之一。即使是胜利轨迹，组件仍标记为待试用；只有后续实际效果可提高可信度。终局 WIN 后 ARC runner 只给 120 秒只读复盘轮次，现有 gate 只允许 `task_resource` 和 `level_review/inspect/status`。此时只保存路径，不放开 `change`、研究或环境动作；如果没有后续关卡，任务内没有再试用的机会。跨任务复用需要未来明确的导入/推广工作流，不在本次实现中偷偷扩大 task-local 作用域。

## 实施顺序和验收

1. 在 `demo/pi_level_retrospective.ts` 添加 v2 类型、窗口分类和纯校验函数；保持 v1 可读及相同 `window_id` 幂等。先验证 success、WIN、RESET、GAME_OVER、预算耗尽、跨窗口引用、伪造 call ref、低证据成功的行为。
2. 增加纯只读调用索引模块，从 `pi-events.jsonl` 配对事件，用 `execution-observations.jsonl` 精确关联；在 `src/autoresearch_pi/arc_agi_3_e2e.py` 的持久化事件上增加 `recordedAt`。用旧日志无时间、重复 `toolCallId`、未配对调用、RESET 累积窗口、缺失 provider 用量、child 无 join 等用例验证 `partial/unknown` 降级。
3. 在 `demo/pi_task_local_self_harness.ts` 扩展 `level_review` schema、输入 contract、持久化、短投影和能力机会来源。`demo/pi_task_resource_store.ts` 仅增加派生 `outcome_cost_index` 资源读取；不增加 Harness 组件或新的自动语义作者。维持终局 gate。
4. 在 `tools/arc_capability_audit.py` 增加调用总数、按工具/主体/窗口、失败/拒绝、provider 请求成本、覆盖率，以及主 Agent 提议省略的数量；报告中明确“提议”和“实际验证”不同。
5. 运行 TypeScript 纯函数、Pi 原生集成和 Python 审计测试；再按仓库 `AGENTS.md` 运行 `arc-harness-smoke`，覆盖真实 ARC bridge、Pi parent、child broker/process、结构化返回、router、native mutation、ARC action、后续真实 parent turn，覆盖五类组件及 Auto-Research/普通 `delegate_task` 的 provider `length` continuation。该 deterministic smoke 证明链路可达，不能证明模型方法质量。涉及 provider 行为或 benchmark 收益时，再以真实 provider 和可比初态/预算对照，比较成功率、动作、调用、token、延迟与恢复能力。一次成功轨迹的计数下降不得单独宣称改进。

实施与 `docs/deferred-research-todos.md` 的 B/C/D 相关：B 的研究视角可用于独立审查路径，C 的父子实验通信仍未完成，D 的跨压缩认知连续性影响路径卡能否长期保留。这次只实现证据索引、复盘和有限投影，不据此勾选这些整体待办，也不声称 ARC adapter 全面拆分完成。
