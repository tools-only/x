# 本工程上下文组件审计：Memory、Skill、System Prompt、Tools 与通用生命周期

日期：2026-10-07（Asia/Shanghai）。审计对象是本地工作区实际源码，Git HEAD 为 `18460e0dc30756e1d428e333496cb03afd0b35ad`，工作区可能含未提交内容；本记录不把 HEAD 等同所有文件冻结版本。本次仅阅读代码与既有证据、形成报告，没有修改 runtime、启动 ARC 或付费 provider。

## 研究机会、命题与证据边界

用户需要了解 Pi 上的优秀上下文方案并与当前工程逐组件比较。现实机会是：工程已有很多恢复、作用域和压缩实现，但“落盘”“可恢复”“进入输入”“模型实际利用”“任务收益”容易混用。窄命题是：沿真实 ARC 安装路径，可以识别每类资源的创建、装配、投影、读取、使用和失效责任，而不会把存在一个模块误当默认生效。

移除的负担是后续读者逐文件追索与误判配置；本报告不增加父 Pi Agent 常驻提示、必填字段、worker 或流程。预算为只读源码和既有产物，不运行付费试验。可推翻条件是存在真实注册/配置路径与这里的启用描述矛盾。检查包含 control/treatment、缺失 assembly、失效作用域、依赖撤下、原生 compaction、恢复等负例。遵循 [开发标准](../development-workflow.md)，并咨询 [延期 B/C/D](../deferred-research-todos.md)：研究到行动、父子通信、跨压缩认知连续性与父子总成本仍开放，当前审计没有关闭这些问题。

## 1. 先看真实安装链：不能把通用 Pi 的默认机制套到本工程

ARC runner 的入口 `src/autoresearch_pi/arc_agi_3_e2e.py:2043` 设置 task ID、root、variant；`:2049` 设置 `PI_ARC_EXECUTION_GATE=enabled`，`:2054` 设置 scoped read。`:2121–2128` 以 `--mode rpc --no-session --no-extensions --no-skills --no-prompt-templates --no-context-files --no-builtin-tools` 启动 Pi，再显式装入 ARC extension。因此本工程 ARC 默认不会加载工作区 `AGENTS.md`、用户/项目 Pi skills 和一般文件工具；这里的开发 AGENTS 是开发 Agent 的规范，不是 gameplay context。

`demo/pi_arc_agi_3_extension.ts:102–104` 判定 treatment 和输入模态；`:201` 在两种 variant 都注册历史 ARC frame 投影。`:434–438` 安装轨迹资源、共享 research、自定义 ARC subagents。共享 `demo/pi_external_benchmark_research.ts:187–192` 先安装 reported budget；control 只安装 telemetry 后返回，treatment 才安装 task-resource reader、validation、自我 Harness 和通用 context lifecycle（`:194–195`、`:1485`、`:1700`）。完整长期工作集控制属于 treatment 扩展，不是所有 Pi 任务天然都有。

ARC 初始管理 schema 的实际代码是共享模块 `:235`：`task_harness`、`task_harness_create`、`task_checkpoint`、`auto_research`，加 ARC 环境工具等；资源目录和详细管理按需使能。不是所有已注册工具都进入每次请求的 active schema，也不是初始就创建五类资源。非 ARC 适配器在 `:236–260` 保留不同的直接管理入口；不能把 ARC 的最小表面描述泛化为 Terminal/Shopping/Office 默认。

此外 runner `arc_agi_3_e2e.py:2275` 对两组都调用 Pi 原生 `set_auto_compaction(enabled=True)`。`context_compaction=False`（函数默认 `:2592`）只控制 finding-backed 自选 observation compaction，不关闭 Pi 原生 compaction，也不关闭 treatment 的通用 lifecycle，更不关闭 ARC 历史 frame 投影。这是四个不同开关/层。

## 2. 总体模型：canonical store、版本组件池、assembly、热工作集四层

工程最值得保留的是：模型 transcript 是投影，不是完整任务数据库。canonical 事实在 execution-observations/bridge-events/snapshots；Agent-authored memory/skill/prompt/tool 则在各 JSONL 与文件中。`task_resource` 提供精确 `kind:name@vN` 的分页恢复。组件池里“存在”不等于“指导已生效”。

`demo/pi_task_harness_assembly.ts:14–22` 定义五类组件和独立 task-prompt layers（task_policy、method、working_plan、hypothesis、task_state、research_inbox）。`:335–380` 创建 assembly 时验证 CAS revision、当前 eligible exact refs、来源与依赖；不默默改版本、不把研究文本自行归类为指导。`:462–467` 明确没有 assembly 时返回 false。`:431–459` 按来源/依赖可用性与 activation 筛选 prompt contribution，再按 layer、priority 排序；失效原因保留。

`demo/pi_task_local_self_harness.ts:1544–1550` 把 assembled 与 focused 分开；focus 是 assembled 内的上下文工作集过滤。`:1551–1575` 使能已选动态工具 schema、需要的 skill reader/delegate。父 `task_harness(assemble)` 是通常推进者。要补一条条件例外：可选 Jev routing `demo/pi_jev_harness_routing.ts:82–85` 默认 disabled；shadow 只记录，active 可以在 `pi_task_local_self_harness.ts:1464–1535` 创建 `selection_mode=jev` 的 CAS assembly。它使用候选每项最多 900 chars、当前 request 末 12000 chars、最近 6 观测各最多 500 chars；不是默认自动装配，也不应隐藏额外路由成本。

全生命周期可概括为：父/获授权研究 worker 识别机会 → 获授权 child 研究或父直接创作 → 父把结论改写为候选 → 确定性 runtime 校验/版本发布 → 父（或显式启用 Jev）选择 assembly → runtime 投影/注册 → 父调用或以精确 ref 指导真实行动 → 保存真实输出/反馈 → 父作 retain/revise/retire 语义判断。runtime 负责机械完整性，资源数量与调用次数本身不是任务收益。

## 3. Memory：作用域与证据约束很强，语义蒸馏仍由 Agent 负责

### 实际实现

`task-memory.jsonl` 是任务内版本日志，并非跨项目的向量记忆。`task_memory` 原生操作（`pi_task_local_self_harness.ts:3610–3720`）按 key/version 更新，原文替换与 append 二选一，atom memory 不能随意 append；canonical content 与 summary/prompt_text 通过 `demo/pi_task_knowledge_lifecycle.ts:179` 一致性检查。`task_memory_pool(capture/list/retire)`（`:3724–3737`）批量录入 observation/hypothesis/plan/retrospective，只是将版本放入池，后续仍需装配。

`demo/pi_memory_validity.ts:5–22` 从真实 observation_id、RESET、public level_changed 推导 task/episode/level/state 实例；不从自然语言推断 TTL。`:24–33` 允许主 runtime 省略精确 task_ref/instance_ref 时机械绑定，离开 runtime 要显式 exact IDs。`:36–45` 将缺失 validity、scope_expired、task_mismatch 等列为 review reason。Memory 必须适用当前 public-boundary scope；skill/tool/subagent/system_prompt 可选使用同一 validity 字段。RESET/过关将特定实例过时，但不会抹去历史证据。

知识可用性/证据状态分离：`pi_task_knowledge_lifecycle.ts:28–67` 支持 loaded/unloaded/suspended/retired 与 untested/supported/contested/refuted，control revision 独立于内容 version。`:95–127` 传递阻断失效依赖、被 supersede/replace 的旧版本、refuted 项和 dependency cycle。失效资源仍可按 exact ref 读取，但不会继续当 current guidance。

### 进入输入与恢复

`pi_task_local_self_harness.ts:4496–4518` 只投影 eligible、assembled、focused Memory；通常包含 metadata、summary、scope、basis_refs 等，只有 **显式 focus** 时才增加完整 content。`pinned` 在这里控制排序，不等于“跳过 assembly/validity”或“永远驻留正文”。无 basis_refs 的记忆固定标注 `UNVERIFIED HYPOTHESIS`；有 refs 仍是 Agent authored、未独立验证，不自动提升为事实。

Memory 若选择 `projection.channel=task_prompt`（`:4519–4550`），可将 prompt_text/content 放进 task_policy 或 task_state，并以机械 activation 条件选择。该通道与普通 Memory 索引不同；保留旧结论的 summary 必须与 canonical 更新一致。历史正文用 `task_resource(read, ref='memory:...@vN', offset, limit)` 恢复，或父再次 focus 当前合法版本。

### 与优秀方案比较

已具备“短期热记忆 + 外部精确版本冷存储 + 作用域失效 + 反证状态”的骨架，尤其优于不带出处的累积摘要。尚无本次代码证据证明默认的语义/embedding 检索、跨任务 consolidation、检索质量排序或自动冲突解释。最合适的后续是复用现有 checkpoint、Memory 和 findings，检验关键假设/反例/未完成实验是否进入短工作集，避免另建重复真值源。Memory 对事实/假设/计划的科学判断仍由 Agent 完成。

风险：scope 选得过宽会把局部认识带入新阶段；选得过窄会增加恢复/重写成本；索引足够短不代表关键 content 已被模型利用；Agent-authored basis 引用不自动证明内容正确。不能以 `memory_context_exposed` 作 actual-use 或收益证据。

## 4. Skills：按需展开已实现，读过不等于执行过

`task_skill`（`pi_task_local_self_harness.ts:4021–4094`）将可复用 procedure 存 `task-harness/skills/<name>/SKILL.md` 与版本记录，更新须 exact target_version，依赖/替换/可选 validity 与 Memory 共用。未结构化需要 review 的 skill 会在 `knowledgeState:104` 被抑制。

本工程 ARC 不依靠 Pi native skill discovery；唯一 projection 在 `pi_task_local_self_harness.ts:2074` 明示。自定义 `read`（`:2076–2113`）只读 run 内 skills/agents，拒绝失效或未装配 skill。`Active task-local skills`（`:4567–4593`）通常传名称、压缩 description、path、basis_refs、exact ref；ARC 只索引，显式 focus 才展开 instructions。非 ARC 在未读 skill 的初期可能投影 instructions，不能忽略适配器差异。

`read` 成功后 `:2121–2151` 将事件记作 `read_by_agent`，明确 `actual_use=false`、`semantic_effect_observed=false`；后续具体 decision/action cite skill exact version 才能进一步证明使用。这个认识界限是成熟机制的重要部分。

优秀方案通常把“可发现能力目录”与“现在执行需要的完整手册”分开。本工程已有此渐进披露和任务隔离；可改进的问题是触发描述是否足够清晰、选中 skill 到首次执行有多少父决策/往返、是否存在在索引上看见却未能识别机会的漏用。不能用强制每轮读取或复盘来掩盖问题；当直接行动更便宜时合理不使用应计入评估。

风险：focus 集合被重新 assembly 清空（`:1584`）；运行内 file 指向当前正文，历史 exact version 应用 task_resource 读取；完整 skill instructions 可能很长，默认 reader 没有在此 tool 上做分页，因此必要时精确资源分页更适合冷内容。

## 5. System Prompt / task_prompt：宿主约束与任务状态已经分层，overlay 未受 history 字符预算直接约束

`task_system_prompt`（`:3917–3978`）只创建 task-local overlay，不能修改固定宿主 instructions。`renderTaskSystemPromptOverlay`（`:260–275`）按最新版本、knowledge eligibility、assembly 精确选择，按 name 排序并保留 scope/reconsider 提示；`:3982–4017` 在 `before_agent_start` 追加 overlay，记录内容 hash/版本暴露回执，避免重复尾部追加。

**focus 不负责过滤 system overlay**：这里使用 assembled+eligible，没有 resourceIsFocused。父要减少这部分常驻成本应调整 assembly/knowledge availability，而不是仅 focus 其它资源。自然语言 `scope` 是描述；真正机械过时需显式 validity 或依赖/availability，不能把“当前任务”文案当执行器理解的期限。

task_prompt 则是独立的 source-linked assembly contribution（`:4552–4565`），可以来源于 Memory/Skill/finding/validation/report/plan/hypothesis 等，投影为 user 工作层，不能把所有研究结论自动升格为 system 指令。source/dependency/activation 失效时 contribution 抑制。优秀模式是宿主契约短且稳定，任务认识在 task_state/hypothesis/working_plan 更新，程序手册在 Skill 冷存储；本工程大体有这个结构。

残余风险：通用 `context` lifecycle 只处理 messages，不能据其 maxChars 宣称 systemPrompt/schema/图片已被最终请求严格预算。overlay 可以累积全文；受保护当前 state/guidance 也可能超预算。该工程 telemetry 能分类测量，但本次没有观察到所有组件自动按最终 tokenizer 预算统一裁剪的默认保证。

## 6. Tools：schema、运行输入、历史输出是三种不同成本

动态 `task_tool` 仅在提供 adapter 时安装（`:1079–1085`）；ARC 提供其 adapter。`demo/pi_task_local_tools.ts:353–427` 以 `pi.registerTool`/native executor 注册确定性 computation 或 adapter operation。pure JSON tool 的 provider schema 是通用小 envelope， richer input/output schema 放在 description 并由 runtime 继续严格校验；省了 schema 形态兼容问题，但 description 仍有成本，不意味着实际契约是零 token。

选中动态工具的 active schema 由 assembly 更新（self_harness `:1553–1575`）。执行时 `pi_task_local_tools.ts:436–454` 重查最新 active/loaded、method rejection、可选 validity 和 exact assembly，避免模型用历史暴露名越过当前选择。后续 tool output 是真实计算值，才可用于任务；完成计数不是语义正确性。

精确数据 binding 是另一项优点：pure invocation `:457–464` 通过 parent-only resource binding 读取授权 exact ref/path，避免让父在 tool arguments 重抄完整 grid/JSON；binding 不增加权限。优秀设计应尽量让计算靠近 canonical 数据，在输出交付决策需要的少量值与可恢复 provenance。工程有此接口，但实际工具如何选 frame/path、是否基于正确数值网格，仍是语义验收内容。

### 工具输出寿命与分页

`demo/pi_parent_context_control.ts:77–90` 持久化成功且非 ARC action/state 工具结果，包含 SHA-256、tool_call ref；2,000 chars 以上的指定只读 read/status/inspect/method/静态 contract 视为 transient。`:109–112` 可将 4,000 chars 以上符合 typed result view 的成功 control receipt 投影，正文/重复字段留在 cold result；`PI_CONTEXT_TYPED_RESULTS=disabled` 可关闭。

历史 transient 结果不应一律解说成“第二轮都消失”：普通 transient 在后续 assistant 后过期；`task_resource` 受 **read_workset lease** 保护。`demo/pi_read_workset.ts:86–89` 要保留未 acknowledged 且未过时的页，或当前 active plan/candidate 精确依赖的页；同范围+hash新读取可 supersede 旧页（`:73–84`）。只有 failure diagnostic 在完成 response/action 后机械过期且无依赖（`:91–98`）。Agent 可以声明 covering resource 或 release reason（`:105–111`），但记录明确这种声明不证明理解。parent compact_results 可释放/短化；restore_results 会 pin exact 原结果（parent control `:155–176`）。

`task_resource`（`pi_task_resource_store.ts:288–340`）默认正文页 2000 JSON chars，max 65536；目录最多 20 项。精确 ref/version、offset/next_offset、page hash/provenance 可检查。重复读仍返回正文（`:307–310`），因为 read history 不能证明最终 payload coverage。`readWorkset.restore:116–134` 在 native compaction 去掉旧事务后把仍 required 的授权页重新作为 user evidence 注入，绝不凭空伪造 tool_call。`:136–154` 通过实际 provider payload hash/range 检查 body 覆盖，区分 resident/distilled/cold，`verified=false` 保留语义判断边界。

### 创作中间材料的特殊寿命

`pi_harness_method_history_projection.ts:3–24` 把大 creator 手册分页，默认 8192 chars、最高 65536，给 heading offsets、hash 和 continue call。`:39–80` **只有被已应用变更引用**的早期 creator read 才改成短回执，状态明确 `used_in_applied_change_not_utility_evidence`。不是“读过手册就自动删”，也不代表工具有用。

`pi_harness_candidate_history_projection.ts:24–67` 只处理 no-component-written 的 preflight failure；后来成功发布 candidate 必须在 semantic_kind、authoring_method_ref、program/input/output schema 上同一 key，才用后继 exact resource_ref 替代历史 candidate 大体，保留调用与失败拓扑。不能把任意失败/部分已提交变化都同样裁剪。实际应用位置 self_harness `:1674–1697` 和其后 provider-history projection。

风险：schema 省下的 token 可能转移到 description/creator/control turns；restore pin/未确认页可长期驻留并迫使 protected overflow；错误回显、pending 和成功回执重复也是成本来源；不能只计算最后一次请求，需包含父+child、失败/取消片段和管理轮。

## 7. 通用 transcript 生命周期：结构安全、原文恢复与软预算

`demo/pi_task_local_context_lifecycle.ts:490–499` 默认启用，除非 `PI_AUTORESEARCH_CONTEXT_LIFECYCLE=disabled` 或显式 options。默认上限 400,000 JSON chars、最近 24 messages、头部 1 message、单消息 80,000 chars（`:37–40`）。有模型 contextWindow/outputReserve 时使用 `(context-output)*4` 的**字符估算**并取 operator limit 与 transport limit 的最小值（`:507–519`），工作目标为上限 80%（`:530–534`）。不是 tokenizer 或硬模型 token 保证。

投影步骤 `:369–488`：按类别保留最新 Memory/Skill/当前状态等重复卡；保护 task_state/recovery/task_policy/dynamic_task_state/knowledge_review、部分 guidance 与 read_workset 页；保留初始用户目的；旧中间 history 归档；suffix 必须是完整 tool call/result 事务，最新 transaction/result 不能孤立消失。超大普通非 assistant 文本用 60% head + 40% tail 加恢复 marker；保护块和 assistant arguments 不做通用字符串裁剪。迫不得已进入 forceFit 后仍不能容纳则记录 `budget_degraded/protected_overflow`，不假装满足硬界限。

`install` 的 `context` handler `:556–585` 在降低投影前将精确 source transcript 与每条 message 以 SHA-256 落入 `task-context-cache/messages.jsonl`，形成 `context:<hash>@v1` 与 `context:msg-<hash>@v1`，主 reader/子 reader 自有授权可分页恢复。canonical cache 不因 session rotation 清空。归档 marker 给 exact ref，不要求默认重放 archive。日志 `task-context-compactions.jsonl` 包含 before/after、保留事务、reasoning policy、overflow、恢复 ref 等。

高水位 `:587–599` 为 120000 chars 或 transport allowance 的 55%（取较小）以上每 50000 chars bucket 产生短 notice，同时须有空间。这是估算提醒，不是有效收益证明。protected 内容/图片可以超软目标；短 marker 本身不总结科学认识，所以若先前没有 Agent-authored checkpoint/memory，原文虽可恢复，认知可能仍断。

### Reasoning history 是 provider-specific 条件机制

默认 policy 为 preserve（runner runtime config `arc_agi_3_e2e.py:2113`），不能写“已经默认删除思考”。OpenAI completions 的 `summarize_openai_field` / `summarize_completed_openai_field` 只有指定 editable provider 时生效（lifecycle `:243–259`）；保护真实签名、encrypted/redacted、length/error/aborted，检查 tool receipts；latest completed policy 额外要求 public decision capsule、所有 native tool 回执、stopReason toolUse。thinking >3000 chars 才改为末2500 chars+exact message ref，这属于**尾部摘录**，不是模型生成语义摘要。completed-tool unsigned discard 还需 options.compactCompletedToolReasoning=true；本共享默认安装未传这个 option。

ARC 另有 `PI_CONTEXT_REASONING_HISTORY=discard_unsigned_thinking`（`pi_arc_context_projection.ts:249–259`），只对已完成历史 unsigned >1800 chars 保留末1200 chars；也非默认。不能改 provider signed/encrypted reasoning 来省字符。现有 code 的特殊 field marker `thinkingSignature=reasoning_content` 与真正 signature 是不同概念，但必须在允许编辑 provider 的条件下操作。

## 8. ARC 观测：最新完整帧与历史精确 delta 分离

`compactHistoricalArcFrames`（`pi_arc_context_projection.ts:217–269`）精确去重重复 decision-cycle contract，保留最新 action result，把历史 ARC action/frame 正文替换为 canonical marker；已被较后 assistant 消费的 frame 可退场，后续 decision cycle 自动提供最新完整 public frame。它改变表示，不创建 Harness 资源。

`arcHasExactSmallTransition:162–168` 仅把 changed_cells 0–128、cells 完整且合法的 small delta 视为可替代历史 final grid；`renderArcDecisionDelta:170–181` 将其写为 before>after row runs，大/partial transition 回到 canonical 全量并等待下一当前完整帧。geometry matching 是公开确定性几何比较，不应偷渡“角色/因果机制”解释。ARC observation window 的 animation spans 等另有模块；本报告不以这一文件覆盖全部 grid/PNG 表示。当前图像/网格模态仍应遵循 runner 配置，不因历史压缩删应提供的完整当前 frame。

ARC 与 generic lifecycle 作用域不同：前者知道哪些图是历史公开观测，后者只知道消息/事务与恢复。注册历史 frame hook 在 ARC extension `:201`，共享 lifecycle 在 external research `:1700`；还同时存在原生 Pi compaction。不能仅拿 generic after_chars 判断最终所有 provider 输入。

## 9. 原生 compaction、session recovery 与连续性

原生 Pi auto-compaction 可能调用模型摘要，与确定性投影不是同一成本。runner 对两组启用（`:2275`），部分 no-level shared provider budget 配置有 `decline_unmeasured` 特例（`:2106`），需看具体 runtime config，不应一概断言全部真实运行会付出摘要请求。

parent stopReason length 的恢复 `arc_agi_3_e2e.py:2485–2510` 只 new_session，不 RESET bridge；checkpoint、task resources、child reports 保留；恢复当前 public state、budget、latest action evidence，`:2205–2209` 只在恢复时补原 authored purpose。可选 reasoning_length_recovery 在连续 length streak 中只允许一次 off retry，否则按既有 deadline 有界。这样的恢复确保环境不可回退与任务数据未丢；并不能单凭文件仍在宣称模型旧解释/排除项完整延续。

## 10. 对照矩阵：可直接用于 HTML

| 组件/层 | 优秀方案原则 | 当前实现与默认范围 | 按需展开/恢复 | 主要缺口/风险 |
|---|---|---|---|---|
| Memory | 热工作记忆与冷事实分离；精确来源、反证、阶段有效性 | treatment task JSONL、scope IDs、knowledge invalidation；池零初始资源、assembly 选择 | metadata 默认；focus content；task_resource exact page；task_prompt 条件正文 | 不是默认跨任务/RAG记忆；真实语义 consolidation 与利用未证实 |
| Skill | 能力目录短；完整 procedure 按需 | ARC 禁 native skills，task-local skill index 与 scoped reader；assembly/validity约束 | read exact path、focus instructions、历史 resource page | 读过≠实际执行；长手册 reader 可昂贵；机会识别与往返成本需测 |
| System Prompt | 宿主规则稳定，任务状态分层，指导有时效 | immutable host + versioned selected task overlay；task_prompt source-linked 分层 | assembly/availability/validity变更；exact ref恢复 | focus 不裁 overlay；没有基于 history maxChars 的最终 system/token硬保证 |
| Tool schema | active capability 最小集，注册与授权分离 | ARC薄管理 facade、selected dynamic工具；non-ARC入口不同 | task_harness enable/assembly，runtime再查 exact version | description/管理轮可能转移成本；没理由应避免使能更多工具 |
| Tool input | 数据近计算；exact授权binding代替复制 | pure JSON/adapter，parent-only binding | canonical ref+path；runtime权限/预算/schema校验 | frame/path语义需验，binding不扩权限 |
| Tool output | 当前结果完整；旧正文冷存；必要页lease | parent result store、typed receipt projection、transient和read_workset | default2000 chars分页、restore pin、required页重注入 | 不是所有读取第二轮消失；未ack/pin可能长期驻留 |
| Creator/history | 手册和失败candidate只在安全阶段退场 | creator引用已应用后短化、精确同candidate成功后替代大体 | hash/version/ref与继续分页 | 成功创建≠工具有用；不能裁partial-write失败 |
| Transcript | 结构安全suffix、当前state保护、exact archive | treatment默认generic400k/24/80k；模型配置缩窄 | hash message archive分页；受保护页恢复 | soft字符预算；保护块可超；archive≠认知连续 |
| ARC observation | 完整current+可逆history差分；事实不暗含因果 | 两组历史frame投影，small delta≤128，公开geometry | canonical bridge/observation snapshots，当前frame刷新 | 大/partial/animation与模态要专项；geometry≠科学规则 |
| Reasoning | provider协议完整，已完成可编辑字段按需退场 | preserve默认；provider allowlist及独立 opt-in policy | 2500或1200尾excerpt与exact ref | 摘录非语义摘要；新reasoning生成成本未因历史短化自动消失 |
| Session | 状态外置，换会话不换环境；只恢复必要证据 | 原生auto-compaction两组启用；length new_session只换Pi | 原始purpose、checkpoint、latest evidence、current状态 | 关键旧认识仍须真实后轮验证，不能把数据持久化等于认知延续 |

## 11. 四层证据分别陈述

| 层 | 本次结果 | 已有可引用证据 | 限制 |
|---|---|---|---|
| 功能正确 | 源码核对完成；本次未执行测试 | tests/pi_read_workset.test.ts、pi_latest_reasoning_projection.test.ts、test_context_continuity.py、test_harness_knowledge_lifecycle.py、test_pi_harness_entry.py等存在相关负例；stage142既有功能报告 | 测试文件存在≠本次运行通过；历史通过只能归属其freeze/config |
| 全链路可达 | 本次未重新运行 | [worker实现验收](../auto-research-workers-implementation-2026-10-01.md)链接 [真实SDK/Pi确定性provider矩阵](../../runs/arc-workers-accepted-matrix-20261001/arc-self-harness-smoke-summary.json) 17/419，五组件/两length/后轮；backlog stage142记录425跨两次执行覆盖 | deterministic provider证明接线/生命周期，不能声称当前checkout已重新完整验证；stage142首次失败和重测要保留 |
| 自主采用 | 未验证为普遍有效 | [延期记录](../deferred-research-todos.md) 保存普通真实 yibu/gpt-6.1-sol、Qwen样本，多次0 research/作者/assembly；显式guided工具正确值属于诊断 | 不把forced/guided call顺序、读页、暴露或fixture算自主采用 |
| 净收益 | 未验证 | backlog保留reported父子已知与取消未知、普通负结果、表示压缩实测 | 字符降低、准确恢复、一次过关或调用次数不构成相同预算独立对照 |

与当前问题直接相关的既有线索：stage118r1真实 Qwen ordinary 2 actions/0 levels、82187 known reported另有取消未知，历史reasoning缩短后新reasoning仍占98.58%输出；这说明“减少历史输入”和“减少现在推理”是两个因素。stage101普通43 actions/0 levels、404637 reported，几何证据可达但目标语义未改善；不能把缺乏行动收益全部归因于丢原文。stage89真实官方SDK/yibu/gpt-6.1-sol曾有归档后解释回退及child超时；仅存档/ref不能关闭连续性问题。这些来自现有延期记录与链接产物，本次未逐请求复核全部raw logs。

## 12. 有界下一检查，而非新一轮大规模实现授权

优先复用现有资源、短checkpoint和read_workset：选一个真实任务已出现的反例，固定 provider/model/预算、预注册比较器，检查压缩前后 **实际 provider payload** 是否包含当前假设、排除解释、反证、未完成实验和决策理由；缺失时测试 exact recovery 是否被自主选择并纠正后续行动。测父+所有child input/output/reasoning/cache、失败/取消未知、等待/首次有效行动延迟、管理轮、任务有效进展。负例包括无关冷资源、已过关Memory、重复失败页、签名reasoning、没有可复用机会时合理不创作。

先改变一个因素（例如复用checkpoint的关键反证内容，而不是同时增加worker、强制review、向量库和提示）。若证据仍可达但决策错误，应定位到 semantic use/解释而不是继续强迫重读；若恢复成本高但很少需要，就比较更小工作集；若tool/child总成本超过任务价值，应允许合理非使用、abandon/retire。延期B/C/D保持开放。

## 源码引用索引

- `demo/pi_task_local_context_lifecycle.ts:37`、`:95`、`:243`、`:369`、`:490`、`:556`、`:587`：通用生命周期、reasoning、archive与软预算。
- `demo/pi_memory_validity.ts:5`、`:24`、`:36`：公开边界scope和exact绑定。
- `demo/pi_task_knowledge_lifecycle.ts:28`、`:39`、`:78`、`:179`：availability/evidence与依赖/一致性。
- `demo/pi_task_harness_assembly.ts:335`、`:403`、`:431`、`:462`：CAS、条件与explicit selection。
- `demo/pi_task_local_self_harness.ts:461`、`:1079`、`:1464`、`:1544`、`:1674`、`:2074`、`:3610`、`:3917`、`:3982`、`:4021`、`:4496`、`:4567`、`:4603`：注册与组件投影。
- `demo/pi_parent_context_control.ts:13`、`:77`、`:92`、`:155`；`demo/pi_read_workset.ts:73`、`:86`、`:116`、`:136`：结果寿命、lease、pin与payload coverage。
- `demo/pi_task_resource_store.ts:251`、`:288`；`demo/pi_task_local_tools.ts:353`、`:402`、`:436`：exact reader权限与dynamic tool。
- `demo/pi_harness_method_history_projection.ts:3`、`:39`；`demo/pi_harness_candidate_history_projection.ts:24`：创作材料寿命。
- `demo/pi_arc_context_projection.ts:162`、`:217`；`demo/pi_arc_agi_3_extension.ts:201`：ARC表示与历史退场。
- `demo/pi_external_benchmark_research.ts:181`、`:235`、`:1473`、`:1485`、`:1700`：共享runtime真实路径。
- `src/autoresearch_pi/arc_agi_3_e2e.py:2043`、`:2121`、`:2205`、`:2275`、`:2485`：runner默认配置、native compaction与session恢复。
- `demo/pi_provider_telemetry.ts:177`、`:196`、`:209`：system/schema/image分离计量；图片token未知不能当0。
