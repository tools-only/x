# ARC 运行中的 Memory 转化与管理设计

日期：2026-09-27。状态：实施设计，供 Luna 实现与验收。

## 目标和证据

Memory 应在任务过程中持续进入宽松的候选池。主体是局部观察、尝试结果、局部假设和阶段状态；一部分是跨关卡仍适用的接口或规律；完整轨迹复盘只占少量。Harness 在每次需要形成执行上下文时，从池中选择当下有关的精确 Memory 版本。记录数量、装配数量、实际使用和收益分别统计，不能以写入量直接代表质量。

`arc-ft09-manual-20260927-new` 中，`task-memory.jsonl` 只有 4 条历史版本、3 个 key、最新版本中 2 个 active；最终 assembly revision 5 选择了这 2 条。写入集中在开头约八分钟，之后两关成功和第三关探索没有产生相应的 Memory。`action6-probe-series@v1` 无 `basis_refs`、scope 为 task，且“所有探测区域无效”容易越界。当前 `demo/pi_task_local_self_harness.ts` 的原生 `task_memory` 已有 JSONL、CAS、retire、scope、证据引用和精确装配；生产侧 `hideNativeMutationTools()` 让模型经 `task_harness(action=change)` 写入。该入口要求 decision、完整候选、稳定 key、atom、显式 validity，并进入 capability conversion intent/review 流程。这个成本适合能力创作，但不适合作为高频 Memory 捕获的唯一入口。

### 边界

- main agent 对 Memory 的语义内容负责，可写观察、解释、反例、待验证猜想和短期计划；child 的原始报告继续留在 research pool，只有 parent 显式摘录/改写时才进入 Memory。runtime 不从帧、动作或任意对话文本推断事实，也不从 report prose 自动生成 Memory。
- Agent runtime 执行格式、任务身份、精确引用、版本、作用域绑定、失效和投影。ARC adapter 只返回 canonical 环境状态并执行动作；不识别 Memory 或 Harness 选择。
- pool 收录与 assembly 选择分开。存在于池中不使 Memory 进入 prompt；旧版本与过期版本仍可读，不能进入当前选择。
- 不设数量目标、每步写入义务、语义评分准入、逐条审批或额外模型后台进程。按需批量捕获可以发生在任意探索节点，包括一次行动后的数条局部结论。

## 决策：动作决策自动留存，加上 parent 的轻量批量捕获

只提供可选 `capture` 入口和一句提示，不足以修复本次“163 次行动、4 条 Memory”的缺口。对 ft09 的 `execution-observations.jsonl` 实查：163 次成功 `arc_action` 均带有 parent 撰写的 `decision.hypothesis` 与 `decision.prediction`。这些内容已由 parent 写出，且每次行动已有公开动作回执；应在 Agent runtime 增设一条窄的确定性留存通道，作为第一批必做项。

每个成功 `arc_action` 的 execution observation 落盘后，runtime 对带有非空 `decision.hypothesis` 或 `decision.prediction` 的记录创建一条 `claim_kind:"probe_record"` Memory 候选。正文只复制 parent 的 hypothesis、prediction、falsifier、subgoal、next_step 中实际存在的字段；另把 action 名称/参数、公开 `state`、`level_before/after`、`level_changed`、可用的 `changed_cells` 等回执字段放在独立的 `observed_outcome` 结构里。`basis_refs` 包含精确 `execution-observation-N` 和可用的 `pre_action_state` ref。不得将 parent 的预测改写成已观察到的事实，也不得自动给 supported/falsified verdict；缺少 delta 时标为 unavailable。原始 execution observation 仍是证据真值源，这条 Memory 是便于检索和选择的结构化索引候选。

key 使用 `action-decision:<execution-observation-id>`，写入前检查同 key/来源是否已存在；恢复和事件重放只会得到同一条，且不吞掉显式捕获的其他 Memory。默认 `level` scope 绑定到动作**之前**的 level instance；RESET、过关动作也属于原来的 level，写入后可能马上失去当前装配资格，但仍可历史检索。不能用动作后的 `currentValidityContext()` 绑定这些条目。该 lane 只消费 Agent runtime 已记录的 public observation 和 parent decision capsule，不改 `arc_action` 参数、ARC bridge 或 adapter。它不额外要求 parent 在每一步做工具调用；没有 parent 语义文字的动作也不生成“解释”。

这会产生较多细粒度候选，恰好为 pool 提供底稿，但仍不保证长期规律或高质量复盘。后两者由 parent 用下面的显式 `capture` 修订/提炼；Harness 负责选择相关版本。动作记录不自动 assembly，不进 prompt 全文，只进入有界目录。为避免在旧任务恢复时突然回填所有历史动作，首次启用记录 ingestion 起点，后续只处理新 observation；需要历史迁移时使用单独显式操作。

提供 `task_memory_pool(action="capture", items=[...])`，与现有 `task_harness(action="change")` 并行。它只接受当前 parent 的显式工具调用。一个 item 的最小形态为 `{content, scope:"state"|"level"|"episode"|"task"}`；可选 `key`、`basis_refs`、`summary`、`claim_kind`（observation|hypothesis|plan|retrospective）、`target_version`、`supersedes_refs`。scope 的当前 `task_ref`/`instance_ref` 由 runtime 从公开边界填入；caller 不能绑定任意旧实例。缺失证据的内容仍允许入池，但标为 `unverified_hypothesis`。`claim_kind` 是作者标注和检索维度，不构成真值认证。

无 key 时，runtime 分配只用于版本寻址的不可变 key，例如 `capture-<toolCallId>-<index>`；它不猜哪些条目同义。针对同一事实修订时 parent 提供已有 key 和精确 `target_version`，形成下一版；反证可以用 `target_version` 修订内容或 `retire` 旧结论，也可创建新条目并显式 `supersedes_refs`。原子三元组可选，连续捕获不要求每条写成 subject/predicate/value。长文可被保存在 pool 中，但每次捕获的正文需有合理字节上限以阻止误贴整段 trace；超限返回可恢复错误，原始 trace 留在 evidence store。

最小实现优先采用独立的薄 facade，在 `demo/pi_task_local_self_harness.ts` 内预检整批、调用已有原生 `task_memory` executor，并为每条返回精确版本 ref。动作留存和显式 capture 应共用一个底层版本写入服务，复用当前 native writer 的版本、JSONL、scope、依据和知识失效逻辑；只放宽候选格式，不另建第二份 Memory 真值源。动作留存需要受控的“由 observation 前缀绑定原 level”的内部参数，不能开放给模型伪造旧作用域。native writer 的 `decision_id` 和 `harness-decisions.jsonl` 若必须保留，应标明 `decision_path:"memory_capture"` 或 `"action_decision_capture"` 与 `expected_effect:"available_for_selection"`；capture receipt 不能被解释为已装配、已曝光或已使用。`source_approval_ref` 不应用来伪称经历了 capability review。

一个批次预检所有 item 的类型、作用域、引用、重复 key 和 CAS；单批内同一 key 只能出现一次。使用 `toolCallId`/显式 `capture_id` 做幂等重试，避免 provider length continuation 或工具重试写出重复记录。JSONL 追加过程中遇到 I/O 失败时返回逐项 `applied` 精确 ref 与 `not_applied`，重试只补未提交项；如果没有可靠批量事务，不能宣称整批原子。所有 ref 都须先按当前 task scope 解析，保留授权边界。

不把新捕获字段加进 `arc_action`：现有 decision capsule 已有足够的 parent 文本，独立工具则允许在比较多次行动后一次提交多条结论。两条 lane 都由 Agent runtime 捕获，不由 adapter 提炼。

### 例子

```json
{
  "action": "capture",
  "items": [
    {"content": "ACTION6 在这一格点击后没有可见变化；只覆盖该坐标和当前局面。", "scope": "state", "basis_refs": ["execution-observation-3"], "claim_kind": "observation"},
    {"content": "本关答案面板可能按 6×6 块对应目标。待用下一次点击验证。", "scope": "level", "basis_refs": ["execution-observation-42"], "claim_kind": "hypothesis"},
    {"content": "ACTION6 需要整数 x,y 参数，范围 0..63。", "scope": "task", "basis_refs": ["execution-observation-1"], "claim_kind": "observation"}
  ]
}
```

## 池管理与按需装配

`task-memory.jsonl` 仍是版本事实源。scope 为 state、level、episode、task：从 `demo/pi_memory_validity.ts` 的公开 transition 和 observation id 绑定；关卡切换/RESET 后，旧局部记录仍在历史，但 `eligible=false`。这只是适用范围变化，不是把旧观察判错。跨关卡事实由 parent 明确选择 task scope；runtime 不因多次相似内容自动晋升。`basis_refs` 记录来源，`depends_on_refs` 记录有效性依赖，两者含义维持现有区分。

池变大时，当前 `task_harness(action=inspect)` 把 `component_pool` 展开为全量，`before_agent_start` 又提醒最近五个未装配项。增加 `task_memory_pool(action="list", scope?, claim_kind?, status?, after?, limit?)` 返回有界、稳定排序的目录页：ref、摘要/短摘录、scope instance、证据状态、当前 eligible、是否被当前 assembly 选中、更新时间及可读调用。`action="read"` 继续交给 `task_resource` 精确分页读取。`task_harness` 总览只放数量（历史版本、当前 key、eligible、selected、过期）和最近的少量摘要及 list 调用；装配前由 parent 检索相关候选。避免把“最近写入”当唯一召回策略；至少支持当前 level/state 和 task 范围过滤、文本查询可后续加，不做语义 embedding 自动排序。

现有 `task_harness(action="assemble")` 继续以 CAS revision 选择精确 `memory:key@vN`。装配时校验 current/eligible；旧版本、retired、过期或依赖失效不能选。当前 assembly 中已过期的记录在投影时被抑制并产生可见 notice；parent 可在下一次 assembly 切换选择。一次 selection 不修改池内容，也不自动选择新捕获的条目。装配记录需要保留选择理由和当前 task/level/state 绑定，状态变更后可审计“为何此前选择有效、现在不再有效”。

建议在 parent 行动循环提示中只加入一句非强制指导：重要局部结论可批量 capture，解决当前选择时查 pool、选精确版本；不要求每步整理，也不把 Memory 产量作为评分。`demo/prompts/arc_decision_cycle.md`、`self_harness_index.md`、相关 review 文字需同步，避免继续声称所有 Memory 必须经完整 `change`/atom。Auto-Research report 依旧是独立证据资源；parent 可以引用其精确 ref 捕获一条判断，但当前行动建议必须复核 scope。

## 文件级实施范围（Luna 第一批）

1. `demo/pi_task_local_self_harness.ts`：抽出 native Memory upsert 的共用执行函数或在同一模块内复用 executor；注册 parent 可见 `task_memory_pool`，实现 capture/list/retire、批次预检、幂等回执、计数与 bounded directory；接入已持久化 execution observation 的 action decision capture，支持 pre-action scope 绑定与按 observation id 去重；调整隐藏工具列表，仍隐藏底层 `task_memory` 的 mutation 接口。
2. `demo/pi_memory_validity.ts` 与 `demo/pi_task_knowledge_lifecycle.ts`：如当前类型不足，加入轻量 capture scope 绑定及当前可选性检查；不改变 transition 推断的语义。`demo/pi_task_resource_store.ts` 继续提供精确读取，可补目录元数据字段。
3. `demo/prompts/arc_decision_cycle.md`、`demo/prompts/self_harness_index.md`、`demo/pi_harness_review.ts`：将高频 Memory 捕获写成轻量可选动作，保留正式 capability change 入口及精确 assembly 的义务；不再将 atom 设为所有 Memory 的前置条件。
4. `tests/test_pi_harness_entry.py` / `tests/test_harness_knowledge_lifecycle.py` / `tests/test_pi_external_benchmark_native.py`：加行为测试，覆盖动作决策原样留存与 outcome 分离、无 decision 不生成、事件重放去重、过关/RESET 归属原 level、无 key 多条捕获、批次幂等、修订冲突、证据缺失标签、候选目录分页、未装配不泄漏到 prompt、选中后在下一轮投影，以及研究 child 无写权。测试只作组件诊断。
5. `src/autoresearch_pi/arc_harness_smoke.py`、`tests/test_arc_harness_smoke.py`：增加真实 runner 的 Memory capture→pool→assembly→后续 parent turn 路径，验证本功能通过真实 bridge、Pi parent、child broker/process、structured child return、router、native mutation 和 action boundary。仍覆盖五类组件、semantic tool output 与 Auto-Research/普通 delegate 的 provider length continuation。

第一批不实现后台语义提取 agent、自动复盘、embedding 检索、跨任务共享、原始 frame 自动转 Memory、历史 Memory 批量迁移。旧记录按原语义保留。第二批可依据真实 provider 运行的检索漏召回、写入负担与行动质量再扩展。

## 验收与失败模式

- 真实 ARC run 中，每个带 parent hypothesis/prediction 的成功 action 都产生一条精确引用的局部候选；显式 capture 能再保存跨行动与长程结论，两关成功后仍持续入池。统计给出 eligible action decisions、成功写入/重复跳过/失败数、历史版本/当前 key/eligible/selected/实际使用，并按 claim_kind 与 scope 分布，不能只报“Memory 条数最多”。
- 一个 Level 0 假说不因切换到 Level 1 而投影；task 范围的 ACTION6 参数事实仍可由 parent 选择。`(0,0)` no-op 的精确范围不会被 runtime 放大为所有 ACTION6 无效。
- 未选中的池条目只出现在有界目录，不进入执行 prompt。选择/更新/退休的精确版本在后续父轮有可核对回执；失效依赖继续抑制投影。
- 捕获时未提供依据不会被拒绝，但所有读取和投影均带未验证标识；提供依据也只表明来源存在，不证明因果或语义正确。
- 批次的一项冲突不污染其他 item 的版本关系；重试不会重复写。全量 pool 导致 token 膨胀、重复低价值条目、过期条目误选和 child 越权均有对应测试。

分层验收：组件测试证明版本与范围；`arc-harness-smoke` 证明真实链路可达；真实 provider ARC 对照运行才评估 Memory 覆盖、装配质量、游戏表现与成本。确定性 smoke 不代表模型会主动写足够多或选择正确。记录每次捕获和装配的时点，以检查写入行为是否仍只集中在前期。

## ADR 与权衡

**决定**：把现有 parent action decision 与其公开回执确定性地留存为局部 Memory；用显式批量 capture 沉淀跨行动判断；沿用原有版本池与按需精确装配。理由：这次 163 个行动已有 parent 作者文本，自动留存能持续生成候选且不增加每步工具调用。代价：局部候选较多，需要有界目录和精确选择；长期规律仍依赖 parent 提炼，需真实 provider 测量。

**未选**：runtime 从原始 frame/trace 或 child report 推断新语义。这会产生未经 parent 作者确认的解释。**未选**：每条 Memory 都走 capability change/review。现有 ft09 记录显示该入口未持续产生 Memory，且多字段/意图队列会把局部记录变成正式能力开发任务。**未选**：把 Memory 直接自动投影。候选池会迅速膨胀，旧关卡和未经验证结论容易污染下一步决策。

`docs/deferred-research-todos.md` 的 D 项与本设计直接相关：压缩后的认知连续性仍需测试。这里改善可检索池与精确装配，不声称已经完成跨压缩语义恢复；B/C 的 child 研究与通信也保持原权限边界。
