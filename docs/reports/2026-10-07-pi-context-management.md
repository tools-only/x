# Pi Agent 上下文管理：机制、组件与本工程对照

研究日期：2026-10-07，Asia/Shanghai。对象：`D:\autoresearch_pi_project` 当前工作区；实际 ARC CLI / agent-core：`@earendil-works` **0.80.6**。本报告同时覆盖 Pi 原生机制、官方扩展示例、社区候选和本工程实现；所有候选改进均为研究建议。

## 1. 核心判断：把任务数据库与模型工作集分开

基于 Pi 构建长期 Agent，值得采用的上下文机制可以归纳为：**完整证据外存、当前状态有界、知识按需展开、研究会话隔离、失效依据明确、恢复路径精确**。压缩只是其中一个环节。优秀机制应让模型更容易取得下一步所需的信息，并降低父子总负担；它不以摘要更短、组件更多或工具调用更频繁作为成功标准。

本工程已经实现了相当完整的基础：任务内版本化资源、组件池与显式 assembly、Memory 的阶段有效性、Skill 索引、动态工具选择、工具结果冷存储、读取页 lease、ARC 历史差分、独立 child session、持续研究职责和短增量交付。当前主要问题更接近**这些能力是否被及时发现、正确使用，以及是否保住关键认识**，而非缺少另一套存储系统。

需要特别区分四件事：

| 问题 | 对应机制 | 机制成功后仍不能推出什么 |
|---|---|---|
| 数据是否还在？ | canonical JSONL、文件、session tree、资源版本 | 模型现在看见了它 |
| 数据是否进入本次请求？ | context projection、active schema、payload coverage | 模型理解或使用了它 |
| 是否能按需恢复？ | exact ref、分页、restore/pin、checkpoint | 模型会在需要时主动恢复 |
| 是否改善任务？ | 后续真实行动、语义正确性、独立对照、父子成本 | 任意模型与环境都受益 |

### 1.1 推荐的五层结构

<div class="architecture" aria-label="上下文五层结构">
<div><b>稳定合同</b><span>权限 · 预算 · 工具语义 · 宿主规则</span></div>
<div><b>当前工作集</b><span>当前观测 · 有效假设与反证 · 计划 · 下一步</span></div>
<div><b>可发现索引</b><span>Skill / Tool / Subagent 的 purpose、范围与版本</span></div>
<div><b>完整证据库</b><span>轨迹 · 原始返回 · 研究线 · 历史候选 · 精确引用</span></div>
<div><b>独立研究会话</b><span>有界分析 · 固定证据截止点 · 短增量交接</span></div>
</div>

稳定合同宜短且稳定；工作集宜及时更新；索引要足以识别能力，但不能展开所有手册；证据库保留可追溯事实；child 承担适合隔离的研究。任何一层都不应默默把 Agent 的猜测提升为环境事实。

### 1.2 版本与启用路径：本报告的解释前提

根 `package.json` 仅直接依赖 `pi-jev@0.5.0`，锁文件解析 coding-agent **0.87.0**。但当前 runner 从 `node.exe` 所在目录寻找 CLI，实际定位到 `C:/nvm4w/nodejs/node_modules/@earendil-works/pi-coding-agent/dist/cli.js`，安装版本为 **0.80.6**。上游对应 tag 的 commit 为 `2b3fda9921b5590f285165287bd442a25817f17b`。因此下面的原生默认值以 0.80.6 为准，不能用锁文件版本代替运行证据。

ARC 启动时使用 `--no-session --no-extensions --no-skills --no-context-files --no-builtin-tools`，再显式加载工程 extension。**通用 Pi 的自动 AGENTS / Skill 发现不是本工程 ARC 的默认来源**。根 AGENTS.md 是开发规范，不能注入游戏 Agent。`--no-session` 表示不持久化该原生父会话，并不表示没有内存中的对话上下文。

| 层 | 本工程实际范围 | 易混淆项 |
|---|---|---|
| Pi 原生 auto-compaction | ARC control 与 treatment 都显式启用 | 与 finding-backed observation compaction 不同 |
| ARC 历史帧投影 | 两组都有 | 不等于启用了所有 self-harness |
| 通用 task-local lifecycle | 共享 treatment 默认启用，可显式关闭做消融 | 不是所有 Pi 任务自动具有 |
| 自选 observation compaction | 受 `PI_AUTORESEARCH_CONTEXT_COMPACTION` 控制，默认未启用 | `context_compaction=False` 不关闭前三项 |
| Final provider admission | `PI_PROVIDER_CONTEXT_ADMISSION=enabled` 才安装 | 不是默认精确 tokenizer |
| Jev 条件路由 | 默认 disabled；shadow/active 另有语义 | active 可作为条件 assembly 推进者，需计成本 |

源码定位：`src/autoresearch_pi/arc_agi_3_e2e.py:1556, 2121, 2275`；`demo/pi_external_benchmark_research.ts:187, 1700`。附录 A/B 给出逐项引用及实际源码位置。

## 2. Pi 原生机制：适合复用什么、边界在哪里

### 2.1 Session tree：保留完整历史，选择当前分支

Pi 将 session 保存为 JSONL，用 `id / parentId` 组织树；请求上下文取当前 leaf 的祖先路径。失败尝试可留在树里，新分支不必背负失败分支的完整日志。`/tree` 导航原文件，`/fork` 和 `/clone` 创建新的会话文件，普通 custom entry 可存扩展状态而不进入模型，custom message 则可见。

这是一种优秀的 episodic history 基础，但不是自动语义记忆：没有额外索引与检索策略，模型并不会主动知道树中的全部旧证据。编码任务中的分支也不会撤销已经写入的文件；ARC 中更不会回滚环境动作或免费恢复生命。[Pi sessions，固定版本](https://github.com/earendil-works/pi/blob/v0.80.6/packages/coding-agent/docs/sessions.md)。

### 2.2 Compaction：旧历史摘要 + 近期原文 + 持久原始条目

0.80.6 默认 `reserveTokens=16384`、`keepRecentTokens=20000`；当估算上下文严格大于 `contextWindow-reserveTokens` 时触发。前者给输出留空间，后者是保留近期消息的估算目标。摘要模板保留目标、约束、进展、阻塞、决策理由、下一步、关键上下文与文件操作，比单纯流水账更适合续做任务。

摘要存为新的 CompactionEntry，原条目仍在持久 session。再次压缩携带 previous summary，形成增量更新。切分点必须满足消息协议；不能从孤立 tool result 开始。长 turn 的前缀可能额外做一次摘要，带来一至两次摘要模型请求及延迟。原生估算并非精确 tokenizer，中文、图片和特定 provider 均需单独看实际 usage。[Pi compaction 文档](https://github.com/earendil-works/pi/blob/v0.80.6/packages/coding-agent/docs/compaction.md)、[实现](https://github.com/earendil-works/pi/blob/v0.80.6/packages/coding-agent/src/core/compaction/compaction.ts)。

**不能只依靠原生摘要保存 ARC 认识**：摘要序列化每条 tool result 仅取前 2000 字符，图片不进入文本序列化；文件跟踪只识别 `read/write/edit` 的 path，不能自动涵盖 bash 写文件和自定义环境工具。尾部反证、图形关系及自定义 action 语义可能没有进入摘要模型。完整当前 grid/PNG、有效反证和 exact evidence 应由应用层独立恢复。[摘要序列化源码](https://github.com/earendil-works/pi/blob/v0.80.6/packages/coding-agent/src/core/compaction/utils.ts)。

### 2.3 Branch summary：移交离开分支的理由

离开探索分支时，Pi 可以只摘要共同祖先之后的那条路径，将结论带到新导航位置。它尤其适合保留“为何放弃 A”“什么反例已排除 B”，同时隔离冗长探索。默认 branch summary 输出上限为 2048 token，与 compaction 的近期保留预算不同。建议在摘要中区分 refuted、abandoned、pending：放弃一个低收益试验不等于它的假说已被推翻。[Branch summary 源码](https://github.com/earendil-works/pi/blob/v0.80.6/packages/coding-agent/src/core/compaction/branch-summarization.ts)。

### 2.4 Extension / transformContext：存储与请求投影分离

Pi agent-core 的 `transformContext`、coding-agent 的 `context` 事件可在请求前调整工作投影；`before_agent_start` 可调整该运行的 system prompt；`session_before_compact` 可接管摘要策略；active tool 选择控制实际 schema。扩展状态可以存为不进入请求的 custom entries。这些接口让应用在保留原始证据的同时缩小输入。

优秀用法是确定性去重、生命周期管理、精确引用和授权恢复；需要语义判断时由 Agent 创建认识，不让字符串删减器擅自“总结科学结论”。多个 hook 的顺序也属于实际行为：最后注入的完整当前观测可能不在较早 lifecycle 的 after_chars 中，最终请求仍要独立测量。[Pi extensions](https://github.com/earendil-works/pi/blob/v0.80.6/packages/coding-agent/docs/extensions.md)、[agent-core](https://github.com/earendil-works/pi/blob/v0.80.6/packages/agent/src/agent.ts)。

## 3. Memory：从“保存内容”走向“有出处、有时效的认识”

### 3.1 值得采用的机制

Memory 至少包含三种职责：episodic 原始经历、working 当前认识、procedural 可复用方法。Pi 原生 session 解决第一种的一部分；应用层 checkpoint / memory 解决第二种；Skill 更适合第三种。不要把所有类型混写到一个不断增长的 NOTES.md，再每轮全量注入。

推荐把认识按条目保存：结论、事实或假设类型、适用任务/阶段、支持与反证引用、版本、待做检验、取代关系。**这些是设计语义，不是建议把所有字段变成每次调用的必填表单。**能从现有 observation、version、report 或 scope 机械取得的内容应复用。只在当前决策需要时把少量相关条目送入热工作集。

外部存储检索宜先做 task/scope/version/validity 过滤，再做语义相关性排序。向量相似度有利于模糊问题检索，但 exact ref 更适合已知证据恢复，两者并用更可靠。对于阶段变化很快的 ARC，先失效旧假说、保留反证，比引入更大向量库更紧迫。跨任务长期记忆还要考虑来源许可、环境变化与能力迁移，不应把一局中的局部规律推广到所有游戏。

### 3.2 本工程已经怎样做

`task-memory.jsonl` 是任务内版本日志；`task_memory` 更新内容，`task_memory_pool` 捕获 observation/hypothesis/plan/retrospective，但进入池不代表进入输入。有效性根据 task、episode、level、state 的公开边界计算，RESET 或过关可使局部条目过时。knowledge lifecycle 将 loaded/unloaded/suspended/retired 与 untested/supported/contested/refuted 分开，能传递依赖失效、取代和循环阻断。

常规 Memory 投影主要展示 metadata、summary、scope 和 basis_refs；**显式 focus 才加入完整 content**。pinned 影响排序，不能绕过 assembly 和 validity。没有 basis 的内容标注未验证假设；有 basis 也仍需核查推论是否成立。Memory 另可进入 `task_prompt` 的 task_state/task_policy，但应保持来源和条件，不自动改写固定宿主规则。

这里已具备优良骨架。未发现默认跨任务 embedding retrieval、自动语义 consolidation 或检索质量已验证的证据。下一步宜检查有效假设、关键反证、未完成实验和下一判别动作是否保存在现有 checkpoint / memory，并在压缩后仍影响选择。相关位置：`demo/pi_memory_validity.ts:5`、`demo/pi_task_knowledge_lifecycle.ts:28`、`demo/pi_task_local_self_harness.ts:3610, 4496`。

### 3.3 一个具体例子

假设父 Agent 认为“黑色区域不可穿越”，后来真实动作显示某一区域可穿越。好的 memory 更新是：将旧命题标 contested/refuted，记录精确 action/observation、适用阶段，并保留尚未排除的差异条件。压缩后的工作集应带上这条反证及下一检验；旧原图留在 cold store。单纯写“继续探索黑色区域”会失去为何探索的理由；单纯保留一条 ref 则可能无法让模型知道应该恢复什么。

## 4. Skills 与 System Prompt：程序知识按需，当前认识可更新

### 4.1 Skill 的三层披露

优秀 Skill 结构是：名称与触发描述 → `SKILL.md` 核心程序 → references / scripts / assets。Pi 原生支持这种渐进披露；目录仍有常驻成本，模型也不一定自主读取。读过的正文会成为工具历史，渐进加载不自动等于加载后卸载。[Pi skills](https://github.com/earendil-works/pi/blob/v0.80.6/packages/coding-agent/docs/skills.md)。

工程 ARC 禁用原生扫描，改用任务内 Skill 索引、受限 reader 和 assembly。通常只送名称、短描述、path、exact ref；显式 focus 展开 instructions。读取成功记录为 `read_by_agent`，明确 actual_use=false，后续 decision/action 的语义证据才可能支持使用。历史版本应用 exact resource 读取，而非默认读取指向当前内容的文件路径。

creator 手册也属于冷程序知识。本工程 `read_method` 默认 8192 字符分页，最大 65536，返回 heading offsets、hash 和继续调用；作者成功应用后可以把先前手册历史替换成精确来源回执。这样减少长篇创作程序持续占据父输入。它仍有一次阅读成本，也不证明模型识别机会或创作质量已经改善。

### 4.2 Prompt 的职责边界

system prompt 适合稳定身份、权限和宿主契约。任务假说、计划和研究 inbox 宜放入来源明确的工作层；否则旧结论可能因指令权重长期压制新观测。工程已有 immutable host + versioned task overlay，并用 task_prompt 的 task_policy / method / working_plan / hypothesis / task_state / research_inbox 分层装配。

一个重要实现细节：**focus 不过滤 system overlay**。system overlay 按 assembly + eligibility 选取；要减少其常驻成本需调整 assembly 或 availability / validity。自然语言“仅当前阶段”不是机械期限，需要已有 scope/依赖支撑。generic history 的字符预算也不能直接约束最终 system prompt。

可考虑的改进是减少重复规则与大段 overlay，复用现有 creator/contract 引用，保留触发入口。增加常驻“必须复盘、必须调用、必须产组件”会提高管理成本，并可能造成沉没成本；只有真实失败定位到必要提醒缺失时才值得试验。代码详见附录 B 的 Skill、System Prompt 小节。

## 5. Tools：分别管理 schema、参数数据与返回历史

### 5.1 Schema 是每轮付出的能力目录成本

工具多并不自动更强。应有足够短的发现表面、按当前需要使能的 active schema，以及真正执行时的权限/version 校验。Pi 可用 active tools 选择；社区 loader 可以按需展开复杂工具，但是否省成本要同时看发现/加载往返，以及 schema 变化是否破坏 provider cache。

工程 ARC 已使用较薄管理 facade，选中动态 Tool 后才进入 active schema；非 ARC adapter 的表面不同。动态 pure JSON tool 使用小 envelope，richer schema 仍在 description 并由 runtime 校验，**成本只是改变位置，不能按“schema 很小”计算为零**。执行边界会重查 loaded、validity 与 exact assembly，避免历史工具名越过当前选择。

### 5.2 数据靠近计算，避免重复抄写完整网格

适合确定性计算的内容，最好通过 exact resource binding 交给工具：正确的 numeric grid、授权 ref、path、所需输出。父只选择问题与精确输入，不重抄上千个格值。输出交付当前决策需要的指标、失败条件与来源；完整中间数组留在资源里。工程已经有 parent-only binding、pure executor 与 adapter operation，绑定并不扩大权限。

正确绑定还包含语义责任：选错 frame、把展示字符串当 numeric grid、历史状态未标截止点，都可能使一个运行成功的工具返回无关结果。验收应看实际语义值和后续 action，不能只看 status=completed。

### 5.3 输出截断、分页与读取页寿命

| 策略 | Pi 原生 0.80.6 | 当前工程 | 需要注意 |
|---|---|---|---|
| 文件 read | 头部 2000 行或 50 KiB，offset/limit | ARC 禁通用文件工具，使用 scoped reader / task_resource | 行、字节、JSON 字符不是同口径 |
| bash 大输出 | 尾部 2000 行或 50 KiB，完整结果写临时文件 | ARC gameplay 默认禁 bash | 自定义工具需自己做完整冷存储 |
| 精确资源页 | 需扩展实现 | task_resource 默认 2000 JSON 字符，max 65536；索引最多20项 | ref/version/range/hash 支持精确恢复 |
| 旧大只读回执 | 可由 compaction/context hook 处理 | 指定 ≥2000 字符 transient；旧正文替换为 exact ref | 普通 transient 与任务资源 lease 不同 |
| 必要读取页 | 原生无本工程语义 lease | 未确认页或当前 plan 依赖页仍 required，压缩后重注入 | 不可把“读取过”当“理解了” |
| 显式恢复 | 原生 session/文件读取 | restore_results / child_context restore 会 pin | pin 太多会长期占用输入 |

本工程当前 `task_resource` 页不适用简单的“第一次续轮后全部过期”解释。读页、最终输入 coverage、Agent acknowledgment 分别记录。相同范围/hash 的新页可取代旧页；无依赖 failure diagnostic 在完成 response/action 后机械过期。若 native compaction 删掉原事务，required 页以已授权 user evidence 恢复，避免伪造 tool call。

可以优先修复的成本是重复错误回显、重复 details/content、已经成功取代的失败 candidate 大体和过长 creator 正文。工程已有条件投影，不应泛化为删除所有失败：partial-write、未解决错误与关键反证仍须保留。详见 `pi_parent_context_control.ts`、`pi_read_workset.ts` 和附录 B。

## 6. Subagent 与 Auto-Research：隔离上下文，也隔离责任和证据

### 6.1 Pi 官方例子与社区候选

Pi 官方 subagent 是扩展示例，并非默认内置编排。它启动独立 Pi 进程，用角色、任务和允许工具形成新 transcript，再向父返回结果。示例的新进程不会自动隔离 AGENTS、skills、extensions、文件和环境：**上下文隔离与权限隔离是两项工作**。[官方 subagent example](https://github.com/earendil-works/pi/tree/v0.80.6/packages/coding-agent/examples/extensions/subagent)。

社区 `nicobailon/pi-subagents` 提供更多可参考设计：fresh/fork、clean prompt、显式继承 project/global/skills、角色 MEMORY.md、按需 subagents_enable、前台 session 与后台 runner 区别。它的角色记忆前 200 行注入属于有界文件记忆，而非 embedding 检索。本工程没有安装或测试此候选；当前文档/包与 Pi 0.80.6 的兼容性未验证，不能直接替换现有 broker。[社区项目](https://github.com/nicobailon/pi-subagents)，附录 A 保留读取 commit 与版本边界。

fresh 适合独立搜索、盲审、验证另一个假说；fork 适合同一代码状态下继续复杂子任务。fork 减少重建背景的成本，却可能带入父偏见与大量无关历史。固定证据 + fresh 更利于比较竞争解释，但如果缺少真实任务目标、反例和授权范围，独立 child 也可能回答错误的问题。

### 6.2 本工程的显式 context_recipe

普通 delegate 使用 `context_recipe` 明确选择 `include_checkpoint`、`recent_observations`、`recent_actions`、`inherit_harness_refs`、`output_contract`、`max_chars`。默认不带 checkpoint，recent observation/action 为 0，继承 refs 为空；recipe 默认 12000 字符、最多80000。它限制的是选择窗口，不是整个后续 provider request。

child 的启动 prompt 另受 `PI_AUTORESEARCH_CHILD_INPUT_MAX_CHARS` 等控制，默认80000，包含 workset 与 bounded state；这仍是字符信封，不包含每轮全部 system/schema/image 的精确 token。角色、工具、证据不同，provider/model 通常继承父运行设置，不能假设 child 一定使用更便宜模型。

工程将 child 放入独立原生 session，禁用自动 context files / skills / writable host tools，只授 exact evidence/resource。ARC 只读研究通常读取父发布的固定 snapshot，而非 live bridge。若显式选择完整 scene ref，可以每轮交付该不可变完整 text/PNG；它可能是历史帧，不应误认为最新环境。ordinary delegate 的有界 action lease 属于独立显式授权，Auto-Research 不继承它。

### 6.3 Child 也需要工作集寿命与连续性

`child_context` 可 inspect/compact/read/restore/tools；选择 schema 只能从已授权工具集合中取，不能扩大权限。显式 compact 需要 child 自写 continuity summary；短卡最多呈现2000字符，标注 Agent interpretation，而非 runtime fact。完整摘要和原结果仍可读。child 的共享 lifecycle 最近消息默认12条，父默认24条。

provider output `length` 应续接同一 child native session，而非要求父重新描述任务。工程保存 partial output / durable checkpoint，broker/runtime 处理 Auto-Research 与普通 delegate 两条 continuation。它不能重建未保存的私有 reasoning；status pending 也不等于已有可用结论。父 `length` 的 session rotation 只换 Pi 会话，不 RESET ARC；恢复原始 purpose、当前观测、budget 和必要证据。

### 6.4 研究线持续，模型进程可以有界结束

本工程 Auto-Research 是授权、证据组织、调度、交付和反馈机制。`research_line_ref` 标识持续问题，worker 标识职责，session/run 标识一次有界执行；窗口只是证据批次。没有必要每个窗口新建 worker，也不要求一条研究线对应永久模型进程。

父通过 assign 授权问题、职责、证据种类、有限 run/output budget 与停止条件。runtime 在后续父请求边界 route/refresh/schedule；默认最多2个worker并发，可配置1–4；每片段最多32个 offered refs。active snapshot 固定，新材料排队；只有 consumed_evidence_refs 的显式分析确认推进消费；completed 后新 session 可续同线，保留前序报告和反例。

当前/紧急结论以短增量交付，未来相关结论只送索引。每次最多2条，总4000 JSON字符；单条超过3600退成详情入口。未放入本次 inbox 的尾部不误标已交付。版本修订、撤回和独立分歧保留；runtime 不作多数表决。父仍负责科学采纳与组件创作/装配，use/assessment 回流研究线。位置：`pi_auto_research_worker_runtime.ts:26, 128`；机制 ADR 与2026-10-01实施记录见附录。

### 6.5 子 Agent 什么时候值得用

值得委派：独立大量检索、可平行的竞争解释、需要独立视角的反例检查、需要持续追踪而不应常驻父输入的研究线。宜直接行动：答案只需一个已注册确定性工具、历史结果已经足够、任务即将结束、结果到达时可能过时、需要频繁共享动态状态。没有足够证据时应允许不使用、暂停、放弃和 retire。

child summary 不是免费减负：父还要解释任务、等待、读回结果、处理冲突；child 自己有 system/schema/历史、input/output/reasoning和失败成本。必须对照父+所有child总成本、首次有效行动延迟、管理轮和任务进展，不能只以父 token 下降认定收益。

## 7. Observation、Reasoning 与预算：防止“看起来更短”的假改进

### 7.1 当前完整观测 + 历史可逆表示

ARC 应保留当前 canonical observation 的完整 grid，以及配置要求的 PNG。历史小变化可以用 before→after 的可逆稀疏 delta 表示；本工程仅在 changed_cells 0–128 且 cells 完整合法时使用小变化路径。大变化、partial transition 和动画不能无条件用同一差分代替全量。

公开几何匹配属于确定性事实；把某个 changed pattern 命名为“动画”“UI”“角色”则是科学解释。工程已有相关修复，报告不把几何出现次数当因果验证。检验历史压缩也必须审阅实际后续 provider payload，而不只看缓存存在或字符串变短。

### 7.2 历史 reasoning 与新 reasoning 是两种成本

默认 reasoning history policy 为 preserve。工程有 provider allowlist / opt-in 的 completed editable field 短化；某路径保留末2500字符，另一 ARC 路径保留末1200字符。它们是尾部摘录，不是保真语义摘要。signed/encrypted/redacted reasoning 与尚未完成的工具交换不应被通用文本截断器改写。

短化旧 thinking 可以减小以后输入，却不自动减少当前输出推理。已有真实 Qwen 轨迹显示历史被短化后新 reasoning 仍占很高比例；这只是定位因素的线索。若目标是父推理负担，应分别检验确定性工具、研究职责、计划执行和模型/推理设置，避免把多因素改变归因给一次历史压缩。

### 7.3 统一计量表

| 口径 | 能回答什么 | 不能当作什么 |
|---|---|---|
| JSON字符 / UTF-8字节 | 传输/序列化体积与组件相对占用 | tokenizer精确token或计费金额 |
| history maxChars | 一层messages的软投影预算 | 最终system+schema+image硬容量保证 |
| provider native input/output/cache | provider已报告用量 | 缺失usage时的零成本 |
| reasoning | 生成中的推理负担，按provider口径 | 已包含于output后再加一次 |
| 墙钟时间 | 父真正等待与完成任务的延迟 | 并发child时长的简单总和 |
| 父子调用时长之和 | 总计算负担 | 用户感知墙钟时间 |

generic lifecycle 的400000 JSON字符、80% working target、24条近期消息、单消息80000字符，是默认工作投影参数；有模型窗口与输出预留时会缩窄。必要 protected state、read lease 和最新事务可以使软预算 overflow，日志应明示 degraded，不能为满足长度删掉协议完整性。

opt-in final provider admission 会在最终 payload 上计算：文本/schema UTF-8字节按1字节预留1token + 每图显式预留 + output reserve + margin。默认 margin 为 max(1024, 容量5%)。这是保守预留策略，不是实际 tokenizer；容量/输出/图像预留未知可拒绝请求。共享 reported-token budget 另管实际已报告消耗，未计量的摘要与取消片段不能按零处理。相关代码：`pi_provider_request_admission.ts:12`、`pi_reported_token_budget.ts:69`。

<div id="cost-demo" class="calculator"><h3>上下文委派成本示例</h3><p>调整假设，观察“父输入减少”与“合计输入减少”之间的差别。此计算不含输出推理、缓存价格与等待，不能替代实测。</p><label>父每轮减少的输入 token <input id="parent-saved" type="range" min="0" max="10000" step="500" value="4000"><output id="parent-saved-value">4000</output></label><label>后续父轮数 <input id="parent-turns" type="range" min="1" max="20" value="5"><output id="parent-turns-value">5</output></label><label>所有 child 合计输入 token <input id="child-input" type="range" min="0" max="100000" step="1000" value="30000"><output id="child-input-value">30000</output></label><p id="cost-result">父累计减少20000；child新增30000；合计输入反而增加10000 token。</p><small>静态示例：4000×5−30000=−10000。完整净收益仍取决于任务质量、输出/推理和延迟。</small></div>

## 8. 逐组件总对照：保留优势，明确缺口

| 组件 | 优秀方案 | 本工程对应方式 | 主要差距或风险 | 建议优先级 |
|---|---|---|---|---|
| Memory | 热工作集+证据冷存；出处、反证、有效期 | task-local版本池，scope/knowledge，assembly，focus | 非默认跨任务RAG；关键认识语义保留未证实 | 先验关键反证连续性 |
| Skills | 目录→正文→references | scoped reader，task index，creator分页 | 读到≠用到；发现至使用仍有往返 | 优化purpose/读取摩擦 |
| System Prompt | 稳定合同；任务状态独立 | immutable host+selected overlay+分层task_prompt | overlay全文可常驻；focus不裁它 | 清重复与过时指导 |
| Tool schema | 小发现入口，按需active | 薄facade+动态assembly+执行时重查 | description与发现轮可能转移成本 | 按实际schema热点处理 |
| Tool输入 | canonical binding，数据近计算 | exact parent-only ref/path binding | frame/path语义错误仍可能发生 | 验真实语义值到行动 |
| Tool输出 | 当前完整、历史短回执、必要页lease | result store、分页、read_workset、restore/pin | 未ack/pin可能增长；回复≠理解 | 排查真实重复/失效页 |
| Subagent | 隔离目标/上下文/权限；核心结果回交 | context_recipe、固定snapshot、native session、broker | 切换背景成本、过时、长输出与超时 | 窄职责有界对照 |
| Auto-Research | 持续研究线，增量证据与修订 | assign/worker/queue/consume/short delivery/feedback | 有接线证据，真实普通采用和总收益未证实 | 先测即时结论到行动 |
| Observation | 完整current+安全history delta | ARC frame投影、small delta、canonical轨迹 | 图像成本未知，动画/partial要专项 | 保持当前模态完整 |
| Transcript | 协议完整、semantic capsule+exact archive | generic soft lifecycle+hash恢复+native compaction | 归档不是科学摘要；多层指标可能漏算 | 测最终payload与后轮决策 |
| Reasoning | provider协议保留，可编辑历史有条件退场 | preserve默认，allowlist opt-in excerpt | 尾摘录丢认识；新生成成本未下降 | 独立计量新reasoning |
| 缓存/预算 | 稳定prefix、真实usage与最终窗口校验 | telemetry、opt-in final admission/shared ledger | 动态schema可能影响cache；字符非token | 依据真实瓶颈采用 |

## 9. 推荐实施方向：先复用，逐项证伪

这些建议不构成运行改动或启动付费实验的授权。排序按当前代码优势与已有真实失败决定，而非组件流行程度。

### 9.1 首选：复用现有 checkpoint 的认知工作集

**机会**：归档、ref 和读页都能存在，但父在后轮仍可能回到已被反驳的解释。**窄命题**：在有明确反证的长任务里，将反证、当前假设、未完成检验与下一判别动作保留在现有短checkpoint，比仅有最近状态/摘要更能减少重复取证，且不增加总体成本。

先核对现有字段和失效行为，再改变一个主因素。无需增加必读提醒、第二份状态库或新的管理worker。首次获益路径应是既有决策更新 → runtime投影 → 后续行动；权限、版本和环境检查保持。若此前材料已完整进入payload但选择仍错，应改 semantic use/解释环节，而非扩大恢复量。

### 9.2 次选：按用途控制研究交付和竞争视图

规则归纳、盲审反例、方法设计和计划跟踪需要不同上下文。复用现有profile、exact grants、competition view与fixed cutoff，避免研究者自动继承父完整解释。短卡带核心修订、证据截止点、当前影响和ref；完整研究状态继续由研究线承载。不能通过隐去反证让“盲审”变成无信息猜测，也不能把不同worker同意当验证。

对明确缺失证据，可以复用现有 experiment_request 或规划请求，请父在环境边界取得材料；不要让runtime从自然语言猜研究目标或额外扩权限。父子主动通信的质量仍是延期事项 C。

### 9.3 第三步：沿成功应用清退重复中间正文

优先比较现有typed receipts、creator分页和candidate后继引用能否覆盖真实增长点。已经成功出版的同一candidate、已应用creator读页、重复静态contract，比未解决错误或关键假设更适合退场。负例要包含partial写入、版本变化、长失败尾部与需要重试的条件；出错时用exact raw恢复。

### 9.4 低优先级候选：向量记忆、额外curator、永久worker

当 exact refs 和 task/scope过滤不足以找到未知相关知识时，才考虑语义检索。其收益应覆盖索引、查询、误召回和失效成本。额外curator需要证明现有父/研究职责无法承担局部更新，不能为“管理上下文”另建持续常驻的解释层。永久worker也可能比有界session更贵；连续性应靠研究线状态和交接合同，而非进程一直活着。

相关研究提供启发：MemGPT强调分层外部记忆；ACE强调条目级更新，避免反复整体摘要造成知识侵蚀。这些论文不等于本项目已有对应实现，更不能用论文基准分数证明本项目ARC收益。[MemGPT](https://arxiv.org/abs/2310.08560)、[ACE](https://arxiv.org/abs/2510.04618)。Anthropic的一手工程文建议按需检索、结构化笔记和隔离子任务，并提醒过度压缩可能丢掉后来才显重要的细节；这里只借鉴原则，不移植其产品行为。[上下文工程](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)。

## 10. 生命周期责任与成本

| 转移 | 谁推进 | 可观察完成条件 | 放弃/失败处理 |
|---|---|---|---|
| 机会→识别 | 父或获授权研究Agent | 重复计算/漏反证/过时知识的真实证据 | 无价值时合理不使用 |
| 识别→投入 | 父授权；runtime调度机械部分 | 目标、scope、精确证据和预算已在现有协议中确定 | 剩余预算不足不启动 |
| 投入→候选 | 研究worker交结论；父决定是否创作 | findings/反证/方法/请求有来源 | 研究可只产结论、不产组件 |
| 候选→装配 | 父选择；runtime校验，Jev仅显式active例外 | exact version、依赖、validity、CAS通过 | 过时或失败不使能 |
| 装配→语义使用 | 父/获授权delegate | 真实tool值、真实decision/action影响 | 暴露/读取不算使用 |
| 使用→反馈 | runtime记事实；Agent评价 | output/use/assessment与同线反馈可追溯 | 失败和未知成本保留 |
| 反馈→保留/修订/撤下 | 获授权Agent | 按预定质量+总成本判断 | retire不撤销真实环境历史 |

这个机制应减少父决策和常驻义务：机械队列、版本、预算、恢复由runtime完成；结论、假说和价值判断由Agent负责。评估还需计算父授权、找creator、创作、装配、首次调用、读取结果和处理反馈的全部管理往返。阶段结果没用时允许停止，不能要求为已投入研究“必须完成组件”。

## 11. 证据与下一次有界检查

### 11.1 四层状态分别报告

| 层级 | 本次报告状态 | 既有材料与provider/environment | 结论边界 |
|---|---|---|---|
| 功能正确 | 源码研究与报告检查完成；未重新跑runtime测试 | 附录列出当前注册/函数/阈值；历史功能检查属于各自freeze | 代码存在不等于本次已执行通过 |
| 全链路可达 | 本次未重跑 | 2026-10-01 workers矩阵17/419，真实ARC SDK/Pi，确定性provider；stage142的425门槛跨首次与重试覆盖 | 历史接线证据，非当前checkout重新全绿 |
| 自主采用 | 通用有效性未验证 | 延期记录含yibu/gpt-6.1-sol、Qwen普通样本和显式guided样本，成功与负结果并存 | forced fixture/显式必须调用不能证明普通自主识别 |
| 净收益 | 未验证 | 字符缩减、exact恢复、部分真实action均已有线索 | 未做相同预算独立重复对照，不能认定能力提升 |

2026-09-29 的历史投影对照在205个matched父请求中降低重复JSON字符累计1671711，最大请求248843→209315；另一个creator对照最大请求122461→91305。它们使用确定性provider和mock游戏，真实bridge/Pi/child/router路径，测量为context_hook_fallback JSON字符，**不是实测计费token或普通模型净收益**。

2026-10-01 workers验收17/419使用真实SDK与确定性provider，覆盖五类组件、两类length、后续父轮和真实工具数值。stage142首次16场景398检查，periodic-memory在Pi前TLS失败，单独重试27/27，不能写成一次完整425全绿。本次没有为提高证据层级启动新的ARC、安装社区包或调用付费provider。

### 11.2 建议下一实验协议

| 要素 | 预定义建议 |
|---|---|
| 主变量 | 仅改变现有checkpoint中关键反证/未完成检验的工作投影 |
| 比较器 | 当前实现对照单因素candidate；相同provider/model/reasoning/预算 |
| 诊断样本 | 一条已知会经历压缩且含跨阶段反证的精确轨迹；查看最终payload与后轮选择 |
| 确认样本 | 后续获授权才执行；至少3对独立普通运行作探索性比较，运行顺序交错；不足以作统计泛化 |
| 预算 | 事前写定每次最大时间、动作、父子reported预算及取消未知处理；数值由具体任务授权决定 |
| 主要指标 | 错误假说重复、有效判别行动、任务进展；父+全部child input/output/reasoning/cache与首次有效行动延迟 |
| 管理成本 | 授权/查找/读取/创建/装配/反馈管理轮及恢复次数 |
| 负例 | 无关冷资源、过期Memory、重复失败页、未ack依赖页、签名reasoning、child过时、无可复用机会 |
| 停止/推翻 | 任务质量退化、预算超限、新增管理成本抵消收益；实际payload已含关键认识但错误仍重复则改定位 |
| ARC接线门槛 | 如改到运行链路，必须arc-harness-smoke五类+两length+语义tool输出+后续父轮；pytest只作诊断 |

成本计算包含pending、失败、取消和未完成流；reasoning若已计入output不重复相加。并发墙钟按区间计算，子调用时长之和另报。恢复成功也要检查关键假设、已排除解释、反证、未完成实验和行动理由，不能只检查ref存在。

### 11.3 研究记录与交付决定

**问题与命题**：当前机制复杂，读者容易混淆存储、投影、使用与收益；本次命题是沿实际runner和组件注册路径可以形成可核查的逐组件对照。减少未来逐文件追索与误判配置的负担。若任一启用描述与实际注册/配置矛盾，须修订该结论。

**设计与成本**：复用现有docs/reports，静态HTML内嵌全部研究依据；不向Pi gameplay加入任何提示、字段、门禁或worker。开发研究使用两个后台资料Agent，成本不是运行机制效果证据；本次Codex父子研究费用未提供精确usage，未测量。权限、预算、版本和环境边界保持。

**运行前协议与验证**：范围为一手资料、当前源码、历史证据及HTML文件检查；不启动真实模型实验。报告检查版本/URL/矩阵边界、章节与锚点、离线资源、自包含附件、视觉显示；runtime四层状态按上表保留。已读源码hash与文档hash在附录C，便于识别后续变化。

**交付决定**：保留本报告作为研究产物；候选改进保持设计状态。延期B（研究目的/视图）、C（父子证据通信）、D（认知连续性）继续开放，不因文档或历史smoke勾选完成。下一次优先做关键反证到真实后轮决策的窄检验，而非同时扩建memory、worker和提示。

## 12. 一手依据与完整审计附录

以下附录已经全部嵌入同一个HTML，展开即可阅读，不需要访问工程目录才能看到内容。上游链接可联网打开；工程文件路径/行号与hash用于回到本地核查。附录中的相对Markdown链接会显示为可读来源定位，离线邮件附件不依赖这些链接才能理解报告。

附录A详细解释session tree、compaction、branch summary、skills、tools、extension hooks、官方subagent和社区候选，附固定版本资料。附录B逐组件核查本工程真实路径、默认与条件启用、精确阈值、恢复及失效。附录C提供本次源码和文档指纹。
