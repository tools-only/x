# 真实 ARC：非 Memory 转化与目标驱动闭环

状态：新真实运行验收中；未宣称两个行为目标已解决。

## 旧运行的实际结果

审计时间 2026-09-26 03:12（北京时间），目录
`runs/arc-goal-evolution-ft09-20260925/run`：52 动作、完成 2 关、NOT_FINISHED。

| 类型 | 身份数 | 版本数 | 实际情况 |
| --- | ---: | ---: | --- |
| Memory | 13 | 14 | 仍占绝大多数，包括局部几何、目标假设、计数器结论 |
| Skill | 1 | 1 | `ft09-glyph-panel-solve`，已显式装配、读取，有后续行动采用 |
| Pi Tool | 0 | 0 | 无转化/使用证据 |
| Subagent | 0 | 0 | 无转化/调用证据 |
| system_prompt | 0 | 0 | 只有空 overlay 组装日志，不是已创建组件 |

9 条 research handoff 都停留在 proposed，没有真实研究 start；handoff 数量
不能当作研究数量。没有 `task-capability-decisions.jsonl`。

Skill 确实描述可执行流程：识别 tile/glyph、构建 panel、推导目标、计算差异、
逐步点击与检验；不是纯轨迹复述。但局部效果得到支持，不等于其通关条件正确。
obs25、obs40 等已反驳部分目标解释，仍没有 Skill v2 或更高阶能力转化。
父 checkpoint 存在策略尝试，却同时保留旧 target、旧摘要和不同新假设；
summary_basis_refs 仍引用 obs12。因而是基础方法使用的局部闭环，尚不是
“规律→目标驱动策略/研究→真实试验→能力修订”的发展闭环。

23 个 provider length 边界显示推理成本高；20 个 aborted 不能全部算运行失败，
其中存在执行 ARC 动作后 runner 主动停止后续生成的正常边界。

## 本轮定位并修复

1. **机会被旧队列遮蔽**：真实上下文显示 8 条 pending，却只展开 op1/2/3；
   后续 op8 Skill 修订和 op9 新方法无法常驻显示。SOL 改为有限索引、最新两项
   详细内容加一项显式未完成意图，提供完整 inspect 入口；不引入语义打分。
2. **child 提交 schema 不匹配**：运行时解析器接受部分未验证方法，但原生
   child 工具要求完整字段。SOL 对齐 schema 与解析器。旧运行未启动研究，
   所以这是修复潜在断链，不能声称它造成了旧运行的全部现象。
3. **恢复中的旧判断无法显式清空**：增加 `task_checkpoint(update).clear_fields`，
   由父 agent 清除被替代的 goal/gap/strategy/hypothesis/next_step/summary。
   清除 summary 同步清除其旧 basis；初版拒绝同字段 update+clear，v2 已改为
   先清后赋值，允许父 agent 一次表达替换。
4. **已完成 review 幽灵失败**：仅凭精确 window_id 与已完成 level-review 记录
   收敛对应旧失败。无法确认身份的旧 change 失败不猜测删除。
5. **流程与恢复指导**：复用按具体操作覆盖判断；选定发展操作后推进真实
   creator/change/assembly/research 调用；假设变化后更新或清除旧 checkpoint；
   recovery 保留能力发展入口，child 不再被要求编造完整方法档案。

没有新增 Harness 类型、组件配额、强制研究、runtime 阶段判断或自动作者化。
没有嵌入具体游戏解法。改动均在原分支，未 commit/push。

## 本轮测试

- 原生及邻接针对性回归：32/32，通过记录 `runs/live-capability-repair-20260926.xml`。
- 恢复与 checkpoint 补充回归：4/4，记录 `runs/live-recovery-verified-20260926.xml`。
- SOL 单独队列/上下文回归 21/21，与上面的测试存在重叠，不能相加计数。
- 真实 SDK 冒烟 15/15 场景、363/363 检查：
  `runs/arc-live-capability-closure-smoke-20260926/arc-self-harness-smoke-summary.json`。
  真实环境与 runtime 边界，脚本 provider；覆盖五类组件、语义输出、两种
  length continuation。不是自主策略收益证明。
- 未重跑全量套件；此前报告的 51 项历史失败仍未整体解决。

## 新真实 provider 验证

2026-09-26 03:23:29 启动，PID 100348，目录
`runs/arc-capability-closure-ft09-20260926-v1/run`。
游戏 `ft09-0d8bbf25`、provider `yibu`、模型 `a:deepseek-v4-flash`，
关闭 Jev、`--max-actions 0`，正常 gameplay prompt，没有覆盖配额或预写组件。
新进程载入此次 runtime 修复；child 方法字段指导在首次 child 启动前完成对齐。
旧运行与日志保留。

03:27：4 个动作，尚处于点击效果与目标含义的初期探索，没有组件，不能据此
判失败或成功。持续检查首个方法机会、作者化/装配/使用，以及目标反证后的
策略发展、研究比较、反馈与修订。后续结果在此追加，所有结论以真实事件为准。

03:33 快照：10 个动作，完成 1 关，3 条 Memory，其他四类组件仍为 0。
`auto-research-1` 已实际提交并交付（child 19:33:23Z 提交、19:33:43Z
交付），没有 schema rejection。报告比较多个目标解释，提出面板编码一致性
解码流程和有效动作计数鉴别流程；两者均保存为 method candidate，并形成
`awaiting_parent_authoring` handoff，尚不是已创建 Skill/Tool。

语义上，这份报告包含可执行方法、竞争解释与可证伪实验，超出了纯轨迹记录。
但 obs5–9 的父侧独立执行早于报告返回，obs9 已完成第一关，不能将通关归功于
研究。报告的五次点击计划基于 obs4，到达时已过期；后续须观察父是否基于当前
关卡重新应用方法，而非执行旧坐标。方法 quality_advisory 仍含
`promotable=false/missing_input`；路由没有据此拒绝，名称是否误导作者化待查。

父在首次 review 提出小型计算 Tool 后，以操作小且低频为由延期；随后的关卡
复盘却已承认 mismatch 手算错误。这是重新判断开发价值的真实机会，但截至此
快照没有 creator read/change/assembly/use。两项行为目标仍未验收通过。

03:46 快照：21 个动作，完成 2 关。Memory 为 5 个身份、8 个版本，其中旧
关卡的 3 个身份已退役，2 个任务级身份仍 active；不能将 8 行日志算成 8 个
有效 Memory。Skill/Tool/Subagent/system_prompt 仍为 0，研究仍为 1 次完成。
父已更新关卡 2 的目标、布局、调色假设和行动序列，但没有形成相应方法组件。

### v1 暴露的进一步断点（准备下一迭代验证）

- 研究作者化 handoff 只通过一次完成 inbox 交付；后续常驻 capability queue
  只读取 review/draft，不含研究 handoff。报告保存并可 inspect 不等于后续上下文
  仍能发现待发展方法。SOL 正在将其接入同一个有界目录与自主处置入口。
- 成功创建组件后，handoff 的 authored 结清错误地依赖可选的 `method` 元数据；
  最小合法组件即使引用精确来源也会留下假 pending。正在解耦两者。
- `quality_advisory.promotable` 改成 `documentation_complete/documentation_gaps`，
  不再用“不可转化”命名表达文档缺项；诊断验证缺项仍 eligible、仍有 handoff。
- 父提交完整 Memory atom 但漏写 semantic_kind，首次调用失败；随后显式补齐并
  改写部分内容后成功。新增无冲突完整 atom 的结构默认，避免多余标签门槛。
  原失败与成功正文并不完全相同，不能按相同目标集合擅自清掉历史失败。
- 本轮新增的 checkpoint 清除接口拒绝同调用 clear+replace，真实父恰好采用
  这种正常表达。下一版改为先清后显式赋值；替换摘要不携带旧摘要证据。

这些是代码/指导的具体修复，不是已证明行为目标达成。v1 日志保持原样，
新进程会单独记录版本与结果；既有脚本 provider 冒烟也不替代真实模型验收。

## v2 验证

03:49:39 前停止本轮创建的 v1 进程树，保留全部文件。终止快照为 24 动作、
2 关、NOT_FINISHED；这是主动替换验证版本，不是 ARC 自然失败或完成。
更早的 `arc-goal-evolution-ft09-20260925` 进程未停止。

上述修复已实现。研究 handoff 以稳定来源进入既有 capability_followups，
不新增 Harness 类型；父可选另一载体，或用现有 capability_review 自主
延期/拒绝。明确延期后不常驻催促，inspect 保留完整可恢复目录。
成功最小作者化凭精确 method 来源结清，handoff version/resource_ref 同步。
新增原生诊断验证跨后续上下文/压缩的入口、最小组件、改选载体与 30 项完整
目录；这些测试不等同于真实模型自主采用。

另将 ARC 常驻指导中两处“仅当前决策值得时”改为按当前或预期任务工作、剩余
任务收益判断，与目标驱动能力发展流程一致；没有强制每步 review 或创建。
该指导和恢复相关的 3 个针对性检查通过（`runs/v2-horizon-20260926.xml`）。

03:51:23 启动 `runs/arc-capability-closure-ft09-20260926-v2/run`，PID 123172。
同游戏、同 provider/model，关闭 Jev、`--max-actions 0`。bridge 已 ready。
外层 `source-manifest.json` 保存当时 demo/src 的源码哈希（不包含凭据）。
新真实 provider 的行为验收正在进行；五类组件真实 SDK 冒烟另行运行。

v2 诊断回归：34/34，通过记录 `runs/v2-capability-root-20260926.xml`。
新真实 SDK 冒烟也完成 15/15 场景，覆盖五类组件的原生使用及两种 length
continuation，结果 `runs/arc-live-capability-closure-v2-smoke-20260926/arc-self-harness-smoke-summary.json`。
其 environment_mocked=false、runtime_boundaries_mocked=false，
provider_mocked=true；不能据此声称自主能力发展已经发生。

另查明旧周期提示膨胀：`compactText` 仅有一个参数并未截断，调用处传入的
180 被忽略；v1 的周期机会 op2 约 141431 字符，其中约 130k 来自历史观察
“摘录”。request59 已经压缩，不能声称该条原样进入该请求；但 request58
的 arc_observation 约 196346 字符，证明大观察确实曾进入模型输入。
此问题已局部修复及回归；不修改 canonical 证据，也不先验断言它是全部
行为缺口的唯一原因。原计划将所有改动用于下一次启动，但 child continuation
会重新加载源码：v2 后段实际混用了版本，见下文，不能视为冻结版本实验。

### v2 最终结果与可定位阻塞

04:16:37 停止本轮 v2 的已核实进程树，保留全部日志。最终为 31 动作、
完成 3 关、NOT_FINISHED；主动停止以替换修复，不是自然终止。
5 条 Memory 记录，Skill/Pi Tool/Subagent/system_prompt 均为 0，显式
assembly 为 0。曝光日志的 selected memory/skill/system_prompt 以及动态
task-prompt memory 版本均为空。不能把创建、引用不存在的组件或 review
记录当成真实装配和使用。

父已从第一关目标解码发展到重叠目标合并、第三关默认色/其他色解释与
14 次差异修改，但方法仍留在 checkpoint/review。游戏进展不能代替能力
发展验收；两个用户目标尚未满足。

- 第一项研究完成并在 20:02:06Z 交付，但没有 method_candidates，因此没有
  作者化 handoff 不是解析丢失。父的关键发现先于研究交付，不能归功于报告。
- 第二项研究提出了有顺序的成对坐标探测方法；20:13:33Z 因缺少顶层
  evidence_refs 被工具 schema 拒绝，20:13:51Z 又因可选 confidence_update
  是数值映射而非规范对象被拒绝。停止时尚未完成交付。这是实际提交阻塞。
- child 的 inspect_arc_trajectory 暴露却依赖已被隔离的 live bridge URL。
  新方案由 parent 发布精确版本的只读轨迹快照，不赋予 child 行动权限。
- 一个 change 批次因第二项省略 operation 整批失败。修复仅对无目标引用、
  无更新意图的对象候选默认 create；不猜测更新，也不覆盖重名旧版本。
- 候选 pool 中的 Memory 未显式选择；新的有界选择提示覆盖五类组件，给出
  分类计数、最近精确引用与完整 inspect 入口，不自动替父组装。
- 常驻指导改为对缺失操作/重复推导按剩余任务收益判断是否开发，而不是
  仅按当前动作成本判断；允许首次使用前开发，仍由父自主选择载体与直接行动。

**版本限制：**第二 child 在 20:11:32Z 的错误已从缺少 bridge URL 变成
缺少 parent-published snapshot，说明源码修改影响了续跑进程。未改写 v2
日志不等于运行未受影响；v2 后段只能用于故障定位，不能归因给单一源码版本。
v3 将在相关修改冻结后启动，验证期间不再修改运行所依赖的源码/提示。

## v3 冻结与启动

2026-09-26 04:31:18（北京时间）启动，父 PID 178492，目录
`runs/arc-capability-closure-ft09-20260926-v3/run`。沿用 ft09、真实 provider/model、
无 Jev、`--max-actions 0`；146 个 demo/src 文件哈希保存于外层
`source-manifest.json`。所有 SOL runtime/prompt 修改已冻结；不能以启动成功
宣布自主能力发展验收通过。

- root 相关回归 42/42：`runs/v3-capability-root-20260926.xml`。
- SOL 报告元数据及相关回归 43/43、最终针对性 3/3（有重叠，不相加）。
- 新的合法 assembly → Pi parent/broker/child → 轨迹读取与精确分页原生
  诊断 1/1；验证坐标、变化数量、父仅一次 bridge 请求，不是只看 completed。
- 独立真实 SDK subagents 冒烟 22/22 检查通过；完整矩阵另行运行。
- 首次完整冒烟误传 ft09，脚本 ACTION1 不可用，已停止并保留其失败日志。
  正确重跑使用默认适配的 ls20，目录
  `runs/arc-live-capability-closure-v3-ls20-smoke-20260926`。

以上本地/脚本 provider 检查均不替代 v3 的真实模型行为证据。

04:34：v3 正确配置的真实 SDK 冒烟 15/15 场景、363/363 检查通过，
environment_mocked=false、runtime_boundaries_mocked=false、provider_mocked=true。
覆盖五类组件的原生装配/后续使用、Tool/Subagent 语义输出和研究/普通代理的
length continuation；没有失败检查。真实 provider ft09 仍处早期探索，
不能据此将两个行为目标标为完成。

### v3 真实运行结果与下一迭代依据

04:48:31 主动停止本轮 v3 已核实进程树，保留日志；最终 15 动作、完成
1 关、NOT_FINISHED。2 个 Memory 身份，其余四类组件为 0，研究 start=0，
显式装配=0。`final-audit.json` 为停止后的审计。停止前核对 146 个冻结
源码文件均未变化，因此没有 v2 后段的源码混用问题。

父在 obs5 复盘识别出能减少重复画面解析/误读的计算工具机会，却写下
“Not yet needed for the next single action”。这不是正式接受的延期决定：
该 review 因两条 memory/reuse 而整份无效，且没有 development_intent。
两条 Memory 的 ID 别名均可解析，不能归因于引用不匹配。

04:35:48 的 checkpoint clear_fields 包含 success_conditions，因 schema
只列 7 个标量、未列 5 个父可编辑数组而被整份拒绝；后续父通过直接更新
success_conditions 恢复。04:37:41 的 review 拒绝则令完整 transition_analysis
及其中的 Tool 机会只留在 invalid draft，没有正常 review/handoff。
待修复兼容的重复纯 reuse，以及所有父可编辑字段的显式 clear/replace。

进一步核对：invalid draft 已是 capabilityReviewSources 的来源，缓存中 18 条
后续消息仍显示 harness-opportunity-1、上述 Tool 机会和 creator 调用入口。
因此“未形成正常 review/handoff”不等于机会完全丢失；该拒绝增加摩擦，却
不足以解释父持续未作者化。另一个独立缺口是 accepted whole-level review
不在该来源集合，方法性 lessons/next_attempt 尚未接入持续能力决策入口。

obs14 完成第一关。父明确否定“匹配外部示例板”，转而建立并验证嵌入目标
解码假设；level_review 写出目标读取、差异计算、最少修改及下一关重验流程，
并承认误读与重复计算成本。策略修订发生了，但方法仍停在复盘/checkpoint，
未形成已入池、选择、使用的非 Memory 能力。两项真实行为目标仍未通过。

v3 中候选选择提示确实出现在 Pi 的缓存上下文，含两个 Memory 的精确引用、
CAS revision=0 和完整 inspect 入口；相邻 provider 遥测确认 self_harness
上下文存在。没有完整 HTTP provider 请求正文，不声称逐字交付证明。

## v4 准备（尚未启动真实 provider）

已补齐所有父可编辑 checkpoint 字段的 clear/replace；兼容纯同类 reuse
条目，不合并相互冲突的写入。整关复盘以精确 level_review 来源进入既有
capability queue，保留父自行选载体/延期的权限。局部归纳提示改为任务目标
瓶颈与可达使用收益，替换仅“next decision”的视野。

相关 root 回归 37/37（`runs/v4-capability-root-20260926.xml`）。初次 v4
真实 SDK 冒烟 15/15 场景、363/363 检查通过，目录
`runs/arc-live-capability-closure-v4-ls20-smoke-20260926`；provider 仍为脚本。
随后 review 套件的 3 个既有失败被进一步分类：外层 creator 自动转发与
不存在的 draft patch API 属于过时测试预期；外/内 component 冲突可能
被内层覆盖是真实歧义，正在以原生回归修复。不能将该次初版冒烟视为后续
修改的最终验收。

下一版将正向声明能力发展是主任务的一部分，而不仅是机制可用；仍按任务
收益自主决定，无组件配额或强制研究。v3 支持该改动的动机（已识别方法却
未作者化），但不足以证明提示措辞是唯一原因。最终冻结后须重新冒烟与实测。

### v4 最终冻结与真实启动

review 歧义修复及真实 full retry 原生回归完成：冲突候选不会误写 Tool，
纠正后恰有一个预期 Skill，正文与 development_intent 保留。review 套件
21/21、capability-authoring 33/33 通过。旧草稿 patch 测试改为当前真实的
完整重交协议测试，未添加悬空修补接口。

05:09:44 启动 v4，PID 196180，目录
`runs/arc-capability-closure-ft09-20260926-v4/run`，146 个源码/提示文件哈希
保存在外层 source-manifest.json。仍是 ft09、原真实 provider/model、无 Jev、
`--max-actions 0`。最终源码已冻结；全矩阵真实 SDK 冒烟在
`runs/arc-live-capability-closure-v4-final-smoke-20260926` 并行运行。
该启动不是用户两个行为目标已完成的证据。

## v5：已选开发的最小试用路径

基于 v4 的实际断点，SOL 将 creator 返回的最小提交模板与
`prepared_not_published` 提示前置，完整 creator 内容仍保留，可选方法档案
不再抢占最小提交的首要位置。新增主 agent 显式 `development_intent` 操作，
不需要先生成 review/research；也可随 creator/研究方法读取提交。它是控制
记录，不是组件或能力的自动创建。新写入以同一操作 ID、有序日志合并状态，
Memory 写入、其他操作结清或相同毫秒的时间戳均不能误结清该工作。

提示词对已选择的开发给出完成条件：最小作者化、检查回执、精确选择、
下一适用场景的语义试用；或显式延期并保留恢复条件。目标解释变化时也明确
同步 `task_goal`/`success_conditions`，而非仅更新策略。没有动作门禁、
组件配额、强制研究或 runtime 语义作者化。

回归中发现并修复了意图公开投影混入日志审计字段的兼容性问题。
最终相关组 71/71，review/ARC 组 95/95；后组一条历史断言从旧“route receipt”
更新为当前父 creator 与“change receipt and exact pool version”，未删去
后续父轮使用或证据约束。完整仓库套件未执行，不宣称全仓通过。

06:00:38 启动冻结 v5，PID 223552，目录
`runs/arc-capability-closure-ft09-20260926-v5/run`。同一真实 provider/model、ft09、
关闭 Jev、`--max-actions 0`；168 个源码/提示/JSON 文件哈希已保存。
06:01 仍处初始父轮，尚无动作；不能据启动成功声称两个目标已经满足。

冻结版本 direct-development-intent 的独立真实 SDK 检查 15/15 通过，
`runs/arc-live-capability-closure-v5-direct-smoke-20260926/arc-self-harness-smoke-summary.json`。
覆盖无 review 前置、Memory 创建/修改后意图保留、候选未自动选中、父精确装配、
Tool 实际语义结果为 2、后续父轮仍可见意图及父显式结清。provider 为脚本，
环境/runtime 非 mock；它不代替真实模型自主使用验收。完整 15 场景矩阵另跑。

06:03：冻结版完整矩阵 15/15 场景、363/363 检查通过，目录
`runs/arc-live-capability-closure-v5-final-smoke-20260926`；环境和 runtime 非 mock，
provider 为脚本，含五类组件、语义 Tool/Subagent 输出和两类 length continuation。
此时真实 provider v5 已执行 2 次动作，仍在首关探索，尚无组件；行为验收未完成。

### v5 已发生的转化与未闭合的反例修订

第一关 5 动作完成后，父更新了 `task_goal`、`success_conditions` 和逐关
解码策略，提出两种目标解释并决定作者化 Skill。22:10:24Z 入池
`skill:ft09-decode-boards-fill@v1`；22:10:37Z 显式 assembly revision 1 选择该
Skill 与两条 Memory。随后 `execution-observation-6` 的真实动作按该方法选择
新关 tile(0,0)，其 basis_refs 含精确 Skill 与 assembly 引用。

Skill 正文含格网识别、图案读取、重叠一致性、目标规则、点击列表与失败分支，
是有条件的方法，不是单纯轨迹摘要；但它沿用旧关颜色 8，新关实际 tile 像素
为 12（parent-state-7，frames[0][16][22]）。因此只能确认作者化、选择和
方法采用，不能将 38-cell 的空间吻合当作完整语义正确或收益证明。

必须更正：独立读取该 Skill 的早期 `task_resource(read)` 实际返回
`Tool task_resource not found`，不是成功加载。父虽保有自己写的正文，
仍不能据一次调用开始事件声称读取完成。之后回读历史证据时，4 次 focus
将 observation/validation 误当作组件；focus 仅检查五类组件，错误消息却称
引用在当前运行不存在。4 次 task_resource 读取还因未启用而失败，后来
启用后的资源 inspect 成功。混合启用 task_memory 的一次请求也被拒绝，
因为组件写入必须走 change，而不是启用内部 writer。

到 7 动作/1 关时仍只有 1 个 Skill、3 个 Memory 身份；Tool/Subagent/
system_prompt 与 Auto-Research 为零。一个普通 delegate_task 为独立像素核对
在 300000ms 后超时，没有语义返回，不能记作验证或持久 Subagent 组件。

审计脚本现将 pi-events 的实际 call/return 配对，并单列 engine_error、
structured_rejection 和 unflagged_return；原生 operation_failures 不是全部
错误，且与这些类别可能重叠，不相加。新增诊断 8/8 通过。该修改仅涉及离线
审计工具/测试，未改变正在运行的 v5 runtime、prompt 或 provider 代码。

06:32：真实 v5 已 14 动作、通过 2 关。父依据回读像素将 ON 颜色改为逐关
accent 色，修正目标格并执行了 7 格方案；checkpoint 含完整目标集、另一
解释的互补方案及失败后回退步骤。这是目标驱动规划的实际证据，但 Skill
仍为 v1，不能把父的修正方案过关算成旧正文的字面正确性。
22:29:43Z 首次显式使用新的独立意图 API：`ft09-frame-to-clicklist-tool`
保存了完整解码/点击列表计算操作、延期原因和“新关出现或当前方案失败”的
恢复条件。第三关已出现；尚需观察是否真正恢复并提交 Tool，不能把意图
记录算作 Tool 组件。

子任务超时的精确诊断：快照授权成功，已分三页读完 9,396 字符，又重复读
一页并列目录；4 个完成回合约 39k 输出 token，均停在 toolUse，没有最终
答案，第 5 次生成进行中时被 300015ms broker 预算终止。HTTP 响应首包仅
约 1.6–2.1 秒，不能误归为桥接/授权错误。会话文件留存，但普通重试新建
调用，不自动续接该失败会话。尚未改变预算或实现新的续接机制。

### v4 05:36 实际行为审计（仍未通过）

18 次成功动作、2 关完成、NOT_FINISHED；20 次 action 调用中的另外两次
在 SDK step 前被拒绝。Memory 7 条版本记录，Skill/Tool/Subagent/system_prompt
仍均为零，没有显式装配。不能将策略推理或 creator read 计为组件转化。

研究 1 在 21:15:18Z 完成并交付，已实际读取父发布的不可变轨迹快照。
两个方法候选为 `icon-miniature-target-decoding-v1`（目标图案解码计算）和
`off-diagonal-first-click-probe-v1`（区分坐标解释的非对角探测流程）。二者有
步骤、条件和反证方向，不是纯轨迹摘要；但仍有待环境验证的推断，不能将
报告完成当成方法有效。对应的两个父作者化 handoff 仍在等待处理。

父明确说逐关解码和点击列表计算值得做成可靠 Tool，随后在 21:18:44Z
读取 tool-creator，再于 21:19:33Z 读取 skill-creator。两次均成功；此后
转而写两条 Memory、继续动作，未出现非 Memory 提交或准入拒绝。
已选开发没有推进到最小试用，而不是提交被准入规则拦截。
两次读取附近均有上下文压缩，Skill 正文约 40,287 字符；但下一次推理仍
保有方法意图，因此只能把上下文成本列为可能影响，不能断言意图被压缩丢失。

已接受的整关复盘现在确实进入后续 capability queue，例如
`level-review:level-outcome:execution-observation-12`，可选 system_prompt/
Skill/Tool/Subagent；这证明入口可达，不证明父已采取后续行动。

另核实 checkpoint 策略差异是磁盘快照落后于 patch journal：focus 按 journal
恢复 revision 34 的 level-2 策略，磁盘仍为 revision 33；agent_end 写入
revision 35 后一致。不是丢写或冲突。父的 task_goal 仍带 level-0 旧措辞，
属于其未同步修订的内容，不能通过改写快照替父作语义判断。

05:40:17 为替换上述流程优化而停止本轮 v4 的已核实进程树，保留全部日志；
不是游戏自然结束。停止前 146 个冻结文件哈希全部一致。最终 18 动作、2 关，
Memory 5 个身份/7 条版本，另外四类为 0；研究 1 次启动/完成/交付，采用和
真实使用均无记录。最终审计在该运行外层 `final-audit.json`。
更早的历史进程不在此次停止范围内。

05:13：最终冻结版完整冒烟 15/15 场景、363/363 检查通过，真实 SDK/runtime、
脚本 provider。v4 真实研究已启动，问题为竞争目标解释及区分性实验（非轨迹
摘要）；当时尚未返回。一个 ARC400 是父把坐标嵌入 decision 而非顶层导致，
bridge 在 SDK step 前拒绝，没有消耗动作；父随后改用顶层坐标成功。
