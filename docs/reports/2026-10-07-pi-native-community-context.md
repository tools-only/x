# Pi 原生与社区上下文管理

联网研究日期：2026-10-07（Asia/Shanghai）。官方基线为 Pi **v1.0.4**；社区项目按本次取得的具体版本或 commit 分别注明。

## 1. 先看全景：哪些机制真正值得借鉴

Pi 生态最有价值的上下文思想，是把**持久历史、当前模型工作集、可检索记忆、程序知识和独立研究会话**分开。长期任务不能只靠扩大窗口，也不能只靠不断把旧对话总结成更短的段落；必须回答信息存在哪里、什么时候进入请求、如何失效、需要时如何找回。

这里的“优秀”指机制定位明确、可解释、具有恢复路径、能控制常驻成本，并有公开实现供核查。它不等于所有项目已经在同样任务和预算下证明优于原生 Pi。星数、下载量、作者宣称的压缩比例，不直接代表长期任务成功率。

<div class="architecture">
<div><b>原始历史</b><span>JSONL session tree、分支、原始工具返回</span></div>
<div><b>当前工作集</b><span>近期尾部、压缩摘要、system/tool状态</span></div>
<div><b>长期记忆</b><span>Memory blocks、文件日志、检索、来源与更新</span></div>
<div><b>按需能力</b><span>Skill目录、tool search、codemode、MCP gateway</span></div>
<div><b>独立会话</b><span>Fresh/fork subagent、角色记忆、有限交接</span></div>
</div>

| 目标 | 优先考察的机制 | 代表实现 |
|---|---|---|
| 长会话不丢关键状态 | 原生compaction与system/tool checkpoint；结构压缩+原文召回 | Pi、pi-vcc、pi-smart-compact |
| 跨会话记住事实与偏好 | 人可编辑外部记忆、作用域、按需查找与写回 | pi-memory-workbench、pi-mem、memory blocks |
| 让几十/几百工具不占满窗口 | 索引→搜索→完整契约；在代码里处理大数据 | 原生tool_search/codemode/MCP、pi-mcp-adapter |
| 清除重复/过时工具结果 | provider投影剪枝、事务配对、精确原文恢复 | context_edit、pi-context-prune、pi-condense、DCP |
| 隔离大量探索过程 | 子会话、可控继承、短回交与角色记忆 | 官方subagent示例、pi-subagents、Pi Durable |
| 减少额外摘要调用 | 确定性提取与有界检索 | pi-vcc、DavidEasden/pi-compact |
| 在压缩前持续提炼认识 | Observer/Reflector/Dropper与来源ledger | pi-blackhole及observational-memory路线 |

三个最重要的区分：**原文可恢复不等于当前摘要语义无损；检索工具存在不等于模型会主动正确检索；压缩步骤不收费不等于整个记忆系统免费。**

## 2. 版本基线：Pi 1.0 已有新的原生上下文能力

本次联网核实，官方仓库为 [earendil-works/pi](https://github.com/earendil-works/pi)，最新release为 [v1.0.4](https://github.com/earendil-works/pi/releases/tag/v1.0.4)，发布时间为2026-10-05 22:03:50 UTC（北京时间2026-10-06 06:03:50）。研究期间main已有后续提交，因此本文优先用release固定资料说明原生行为，社区main快照另标。

旧教程经常基于 `mariozechner/pi-mono` 或旧npm命名。它们可以解释历史设计，但不能直接用来断言当前Pi没有MCP、没有tool search、没有持久context edit。**Pi 1.0 已有原生MCP、codemode、工具搜索以及append-only上下文编辑**。社区扩展的价值应与今天的原生机制比较。

另一方面，原生session、context files与skills不等于完整长期语义memory；官方subagent扩展示例也不等于每个默认会话都自动拥有多Agent编排。2026-10-01发布的Pi Durable是官方实验路线，需要单独理解，不能把它的任务/回放模型混作terminal Pi既有默认行为。

来源：[官方release](https://github.com/earendil-works/pi/releases/tag/v1.0.4)、[官方文档目录](https://github.com/earendil-works/pi/tree/v1.0.4/packages/coding-agent/docs)、[Pi Durable发布说明](https://earendil.com/posts/pi-durable/)。原生源码细节与具体API见附录A。

## 3. 原生Session Tree：保留历史，控制当前分支

Pi的会话是追加式JSONL树。条目的id和parentId表达路径，当前leaf决定哪条祖先链被投影为模型输入。它把“曾经发生什么”与“这次请求应该看什么”分离；失败探索可以留在树里，而新分支不用把所有旁支重新展开。

`/tree`用于在同一会话树内导航，`/fork`从既有位置创建新会话，`/clone`复制当前分支；branch summary可以携带离开分支的重要结论。普通扩展custom entry可以保存状态而不常驻模型输入，custom message则属于可见信息。这比把全部扩展ledger写成每轮user message更节制。

一个典型用法是：A方案试过并失败，将失败条件和已排除原因形成branch summary，再从公共祖先探索B。摘要应保留“放弃”“反驳”“待验证”的区别；方案太贵而放弃，并不等于证明方案错误。

需要注意：会话分支只改变对话路径，不会自动撤销文件写入、数据库修改或外部动作。独立branch也不自动产生独立环境实验。保存旧条目解决可追溯，是否能让模型精准找回仍取决于工具与策略。

来源：[sessions](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/docs/sessions.md)、[session格式](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/docs/session-format.md)、[session manager](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/src/core/session-manager.ts)。

## 4. 原生压缩与context_edit：一个做摘要，一个改投影

### 4.1 Compaction的价值与失真边界

原生compaction将较早历史变成摘要，保留较新的原文尾部，并追加新的compaction entry。原始session条目仍可留在磁盘。增量压缩会结合前次摘要，目标是延续任务目标、约束、进度、阻塞、决策理由和下一步。

v1.0.4默认启用自动压缩，`reserveTokens=16384`，`keepRecentTokens=20000`；阈值条件是`contextTokens > contextWindow - reserveTokens`。近期保留与输出预留是不同预算；触发阈值、cut point与token估算也不能混成一个“压缩到多少字符”的参数。当前Pi还会保留system/tool的checkpoint，避免动态loadout状态在重建上下文时无依据消失。摘要序列化中每个工具结果截到2000字符，这不是普通工具返回的全局额度。具体重建与v1.0.4源码证据列于附录A。

摘要有额外模型调用成本，也可能忽略关键反证或尾部细节。多模态内容尤其不能假定文本摘要完整理解原图。协议上tool call/result要保持有效配对，不能只为了更短把一个结果的调用身份剪没。

### 4.2 context_edit：追加编辑记录，原文仍在

当前Pi的context edit能够用追加式omit/replace记录改变未来模型工作投影。它与直接覆盖session文件不同：原始历史、UI/export与既有计费仍保留，未来请求才使用修改后的表示。适合把已经完成的大结果改成短定位、去掉重复内容或替换过时工作表示。

`context_edit`是持久session entry类型，不是默认提供给模型的两把omit/replace工具。`targetId`定位历史中产生上下文的条目，`replacement:null`表示省略，非null表示替换content；同一分支较新的编辑优先。扩展可以在`turn_end`、`agent_before_settle`等接口返回这些条目；`context`与`context_with_system`事件则主要用于当前请求的投影变换。持久编辑与request-local transform需要分别理解。

优秀之处是可审计，能够解释某段内容为何不再出现在请求里；边界是编辑后的短文本依然可能遗漏任务关键信息。context_edit也不会“退款”，更不会撤销先前根据旧信息执行的行动。上下文窗口回收和任务正确性需要分开评价。

### 4.3 自动压缩、主动压缩与滚动阈值

接近窗口上限才压缩，有利于少做摘要、稳定prefix；提前滚动压缩则降低长期工作集膨胀，代价是摘要次数更多、缓存失效和认识损耗可能更频繁。没有普适最优百分比。`pi-context-tools`让Agent先看context使用再主动compact；一些社区扩展把触发改为窗口比例或里程碑，但触发次数变多本身不是收益。

来源：[官方compaction](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/docs/compaction.md)、[扩展API](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/docs/extensions.md)、[theduke/pi-context-tools](https://github.com/theduke/pi-context-tools)。

## 5. Memory：常驻核心、续接状态与按需长期知识

### 5.1 文件日志：可读、可编辑、能携带来源

Markdown memory最容易理解：长期事实、按日日志、scratchpad分开；启动时只注入有界核心，细节用工具检索。优点是人能审阅和修正，没有黑箱索引依赖，适合偏好、决定、项目约定和跨会话待办。主要风险是写入重复、过时事实和无出处的推断；全文常驻也会重新制造上下文膨胀。

`jo-inc/pi-mem`是有代表性的例子，但需以当前源码为准：仓库description写semantic search，取得的固定快照实际搜索是大小写不敏感substring，明确没有embedding/vector search。README称system prompt注入，代码已使用context事件尾部user message以保住system prefix。这样的区别会影响召回质量和缓存行为，不能仅凭名称或简介归类。

它以MEMORY.md存长期事实、daily存近期日志、notes存参考、SCRATCHPAD存待办。实际每请求构造的注入包括完整MEMORY与今天/昨天daily；scratchpad没有自动加载，须按需读取。catchup目录有局部字符额度，MEMORY/daily主体却没有统一全局硬预算。压缩前只提醒保存重要内容，不自动生成可靠写回；轻量文件工具与自动记忆管理应分别看待。

### 5.2 Memory blocks：把核心记忆拆成有界槽位

`gordonbrander/pi-memory-blocks`借鉴Letta式blocks。相比一个无限增长文件，分块让偏好、身份、当前重点等有独立边界和更新接口，也便于区别常驻核心与按需外部记录。关键是block的大小、更新方法及出处，不是把所有资料改名为block就更高效。

模型自主编辑核心block会带来污染风险：临时推断可能被保存成长期事实，覆盖操作可能丢掉原有细节。选择时应关注它如何处理版本、冲突、容量与人类修正；源码核查与该项目实际能力列在附录B。

固定快照首次创建user与agent两块，各默认2000字符；所有blocks在before_agent_start追加systemPrompt。updateMemory对已有block精确替换或追加，超额直接slice截尾并报告truncated，没有自动事实精炼。每块有额度，不代表总block数量和总token有额度；也没有Letta完整的archival paging能力。

### 5.3 Session-safe memory：把可重复恢复作为设计目标

`nicobailon/pi-memory-workbench`值得研究之处是围绕durable Markdown与session生命周期设计记忆工作台，而不只增加一个记忆文本框。核心问题是并发会话、压缩和恢复时，谁更新什么、如何避免丢写与错用旧状态。它与角色专属subagent memory也有互补关系。

它用sessions/<id>/progress.md和todo.md作为各会话续接权威，项目progress.md只是生成dashboard；events不可变，digests与dream是追加精炼记录，memory.md存长期事实。条件满足时在before_agent_start发隐藏custom message，提供有界resume/todo/event及memory片段；隐藏只影响界面，正文仍进模型。memory_recall按词项检索，默认8 hits、上限20，路径展开最多30000字符，返回来源路径。

原生压缩后它额外调用模型生成focused checkpoint；owner身份校验控制写回，未知/子会话只读。Dream实际调用本地extract/apply helpers，没有额外LLM调用；不能因名称就宣称它自动执行模型反思。固定README与源码的dream/auto-continue顺序不同，报告以源码注明。设计清晰但复杂度与checkpoint费用更高，当前Pi1.x实测兼容仍未验证。具体信息流、commit和边界见附录B。

### 5.4 权威事件日志与模型provisional提议

`DavidEasden/pi-compact`将用户确认的memory与模型提议分开：追加事件日志生成最新状态，模型提议留provisional，按需search/read，不自动把全部pinned memory注入。它还区分原始history与compaction/branch summary等derived材料，支持精确raw分页。

这种设计适合必须可审计的重要长期事实；用户确认也有管理成本，不适合把每个临时认识都升级成手续。它的compaction checkpoint只是计数/hash指针，不承载完整科学认识，因此强依赖近期tail与主动召回。附录D有完整机制与来源。

### 5.5 真正的语义检索与“叫semantic”的区别

关键词、substring、BM25、embedding similarity、rerank与混合检索是不同机制。关键词恢复已知标识高效，语义检索适合“记得意思、不记得名字”，但会误召回相似而过时的事实。检索前最好限定project/task/role与来源范围，检索后应保留能回读原文的ID或路径。

只因为项目名字是pi-memory/pi-mem，不能把另一个同名项目的qmd或向量功能算给它。报告按**owner/repository/commit**识别项目，分别注明实际搜索方式。记忆正确性的关键是支持、反证、时间与作用域，不是使用了向量库这个标签。

| 方案 | 默认进入模型的层 | 更深信息如何取回 | 最显著取舍 |
|---|---|---|---|
| Pi原生 | 当前分支+摘要+context files | 会话导航/文件/扩展；非自动向量memory | 简单，但跨会话知识需显式组织 |
| pi-mem | 尾部user message中的MEMORY/近期daily | substring search、read | 易编辑；常驻主体可无限增长 |
| memory-blocks | system中的全部有界blocks | 无独立冷记忆检索 | 核心始终可见；超限截掉尾部 |
| memory-workbench | 条件有界packet | lexical recall→source path | owner与证据清楚；checkpoint额外费用 |
| DavidEasden/pi-compact | 不自动注入pinned memory | 按需search/read、原history分页 | 权威/提议分离；工作连续性依赖主动查找 |
| pi-subagents role memory | child启动时角色MEMORY前200行且16KiB | 普通文件工具，没有专用memory retrieval | 角色积累；旧头部可能挤掉最新尾部 |

来源：[pi-mem](https://github.com/jo-inc/pi-mem)、[memory blocks](https://github.com/gordonbrander/pi-memory-blocks)、[memory workbench](https://github.com/nicobailon/pi-memory-workbench)、[DavidEasden/pi-compact](https://github.com/DavidEasden/pi-compact)。

## 6. Skills与目录上下文：程序知识应渐进展开

Pi原生Skill采用目录与正文分离：先给name/description/path，需要时加载SKILL.md，再按需读取reference/scripts/assets。它让程序知识不必全部常驻。Skill回答“如何做”，memory回答“知道了什么、为何这样判断”，两者不宜随意混写。

目录也有成本：几十个描述通常便宜，几百个长描述则可能显著占用输入；用途重叠使选择困难。正文读入后成为工具历史，不会因“渐进披露”就自动卸载。可以结合context_edit、工具剪枝或压缩清退已用完的手册，但仍保留恢复路径。

AGENTS.md/CLAUDE.md等context files用于目录/项目规范。全量预载所有子系统规则通常太重，完全靠模型记得读局部规范也可能漏读。`@quartermaster-labs/pi-on-demand-context`公开描述根据cd或文件工具触及目录按需加载，并与原生loader去重；当前取得元数据，完整源码未取得，列为候选，不声称离开目录后会自动卸载。

建议把三类内容分开：稳定权限/工具规则、当前任务状态、可复用程序手册。每次改system最前面的prefix可能影响缓存，按需context信息也可能长期累积；“不放system”并不等于零token。

来源：[Pi skills](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/docs/skills.md)、[Pi resource loader](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/src/core/resource-loader.ts)、[on-demand-context目录](https://pi.dev/packages/%40quartermaster-labs/pi-on-demand-context)。

## 7. Tools：Schema、返回结果与历史是三种成本

### 7.1 当前原生路线：MCP + codemode + tool_search

大量工具最昂贵的部分常常不是一次执行，而是每轮重复携带的完整schema。当前Pi原生MCP默认codemode exposure，将工具发现与调用分开；tool_search可以动态获取所需工具契约；codemode让模型编写有界代码在工具侧筛选、聚合数据，只把需要的结果送回模型。

例如，一个服务有数十种查询能力：先搜索“查某类记录”的候选，再取所需签名；查询后用代码过滤大表，输出几个指标与原始定位，而非让模型读取所有行。这样同时减少schema与中间数据常驻。原生inline声明预算默认约3000估算token，具体策略与边界见附录A。

注意codemode解决数据进入语言模型的量，不保证调用次数或计算成本一定下降；输出太少也可能隐藏异常，仍应允许有界补取原始记录。工具目录搜索和代码执行都有契约与错误处理成本。

### 7.2 社区pi-mcp-adapter：gateway与缓存元数据

`nicobailon/pi-mcp-adapter`提供一个小mcp入口，先search/describe再调用，服务默认lazy连接，metadata cache允许无需实时连接就发现工具。也可选direct tools、控制注册集合；默认闲置10分钟关闭服务，需要有状态连续性时可keep-alive。它让几百schema不必全部一开始进入窗口。结果入口还有文本预览、临时文件offload与独立details额度；这些解决单次返回体积，不替代历史剪枝。

与当前原生MCP比较，应关注配置迁移、OAuth、resource、server lifecycle、gateway的权限可观察性、cache与热加载，而不是宣称“Pi不支持MCP所以必须装”。gateway把很多后端调用折叠进同一父工具，某些权限扩展若只按顶层工具名处理，观察粒度可能不同；原生独立调用的roots/权限整合也是重要差别。

### 7.3 Tool output：截断必须与恢复一起设计

原生read/bash等已有行数/字节限制和继续读取入口。自定义工具应返回最相关的结果、是否truncated、完整输出在哪里，以及怎么分页。头截断适合导览，尾截断适合错误日志；如果关键证据在中间，二者都可能失败。

完整数据不宜复制到content、details、summary和父回执多份。显示收起不等于provider输入缩短；UI展开按钮也不必然提供模型可调用的检索接口。还要区分一个大结果这次完整进入请求，与旧结果是否反复驻留。

来源：[原生MCP与工具文档目录](https://github.com/earendil-works/pi/tree/v1.0.4/packages/coding-agent/docs)、[MCP adapter](https://github.com/nicobailon/pi-mcp-adapter)、[原生截断源码](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/src/core/tools/truncate.ts)。

## 8. 工具历史剪枝与探索投影：五个社区思路

### 8.1 pi-context-prune：完成batch摘要，按ID找回原文

它将已经完成的tool-result batches转为短摘要，未来provider投影清退大输出，原始history保留；context_tree_query提供恢复入口。固定源码默认关闭，开启后的默认模式为agentic-auto：由模型通过context_prune决定时机。summary/index/frontier等会追加到session，但原消息不覆写。

取舍是它要调用摘要模型，summary仍可能失真；工具结果原文可回查但主模型需知道何时查询。当前query收ID列表，仍受行数/字节额度限制，没有offset/limit分页；pruner省略tool-result而保留assistant tool-call块，provider对缺失结果的处理需要实际验证。可按turn、checkpoint或最终回答等模式触发；设置越激进，输入越短，却可能摘要/缓存成本越大。准确默认、持久化与工具参数见附录C。

### 8.2 pi-condense：按工作段整理，兼顾缓存与恢复

cache-aware方法关注“缩短prompt”与“丢失缓存前缀”之间的交易。缓存热的时候改旧历史，未必比继续发送旧内容便宜。pi-condense默认关闭，开启后默认agent-message触发、turn batching；在完整工作段结束时集中整理有利于少改前缀。自动比例阈值autoBudgetThreshold默认null，不能声称默认80%触发。等待缓存自然冷却是可评估的经济策略，不作为本快照已实现自动冷缓存检测的结论。

它把已摘要结果换成带ref的stub，保留tool-call/result结构；默认保留最近3条闭合链，保护Skill等路径。恢复结果有3 turn宽限，避免刚读回即剪掉；超过65536字节的结果默认spill，预览2048字节，再用sidecar路径读取。query还能尝试恢复原图片块。它的经济目标是在合适时点替换，并提供原文入口。核心机制与源码见附录C，作者假说不能当普遍benchmark结果。

### 8.3 DCP：去重、旧版本替代与显式drop

dynamic context pruning通常先删除重复读、成功新读取代的旧内容、重复错误等可确定冗余，再按策略减少旧结果。它更接近provider projection管理，避免增加每次LLM摘要。

生态中有pi-vault/pi-dcp、PSU3D0/pi-dcp、complexthings/pi-dynamic-context-pruning等不同实现，不能只写一个“DCP”然后混合全部特性。保护规则、是否可精确restore、是否持久ledger、tool call配对与net-benefit计算分别核查，详见附录C的身份与实现表。

### 8.4 Agent主动管理：context-tools与checkpoint连续性

theduke/pi-context-tools给Agentcontext使用信息与compact工具，适合让Agent在自然任务边界选择；它不是自动长期memory。alpertarhan/pi-smart-compact强调continuity、checkpoint和recoverable cleanup，适合研究压缩前后如何保留关键工作状态。这里的“verified”首先是扩展检查，不能自动解释为所有真实模型都保住了认识。

这些路线互补但也可能hook冲突。一般先选一个主压缩器和一个有边界的剪枝器，核对顺序、fallback与恢复；同时安装多套接管session_before_compact，难以知道最终哪份摘要生效。

### 8.5 pi-memento：同一Agent内的上下文事务

thebabush/pi-memento将探索片段视作可嵌套LIFO事务：先transaction_begin，再继续当前Agent的探索，结束时选择commit（全文）、compact（额外模型摘要）、squash（Agent写结论）或revert（只留非空carryforward经验）。这给出了另一种隔离思路：探索完才决定热上下文保留多少，无需为每个岔路新开子执行循环。

metadata追加到session，context hook重放事务得到模型投影；session_before_compact必须用同一投影，避免已revert的死路再次从raw历史进入摘要。边界不一致时取消压缩。它不提供长期知识检索，revert不撤销文件和外部动作，begin/end也增加判断与工具往返。此项目实验性且明确pin Pi0.84.3；作为可借鉴设计，不能写成已兼容1.0.4。完整源码链见附录B。

来源：[context-prune](https://github.com/championswimmer/pi-context-prune)、[condense](https://github.com/jjuraszek/pi-condense)、[pi-vault DCP](https://github.com/pi-vault/pi-dcp)、[context-tools](https://github.com/theduke/pi-context-tools)、[smart-compact](https://github.com/alpertarhan/pi-smart-compact)。

## 9. 确定性压缩与观察式记忆

### 9.1 pi-vcc：不调用模型的结构提取

pi-vcc提取目标、文件变化、commit、未解决错误、用户偏好和短transcript，再合并前次section；vcc_recall按词、entry #N、范围或文件触及记录从session找回原文。它适合想减少摘要模型调用、又希望有较稳定结构的长工程会话。

确定性意味着相同输入产生相同表示，不意味着它理解了所有因果。结构提取无法保证保留图片关系、隐含反证或自定义工具语义。作者报告字符压缩/时间数据，本次未独立复现；不把97.6%等比例当作任务效果。它保留原文，但热上下文仍是有损摘取。

### 9.2 pi-blackhole：低成本结构摘要 + 计费的观察worker

blackhole把VCC式compile与观察记忆结合：Observer持续提取observations，Reflector综合reflections，Dropper减少低价值项；session ledger保留来源ID，压缩时注入核心记忆，recall可回到原entry。

这种分工针对“反复重写摘要磨掉理由与早期澄清”的问题，比仅在满窗口时一次总结更持续。当前公开配置observeAfterTokens=15000、reflectAfterTokens=25000；每worker可选模型fallback/cooldown，memory可独立关闭。

维护者明确提醒它experimental，结构压缩不调用模型，**观察worker仍是计费调用**；未调参或回退主模型时可能更贵。它不适合被包装成“零token长期记忆”。确切阈值、output预算和兼容边界见附录D。

来源：[pi-vcc固定快照](https://github.com/sting8k/pi-vcc/blob/4cfc6bfae5a1a943dd2b4e9cabc95101bb5811bb/README.md)、[blackhole固定快照](https://github.com/k0valik/pi-blackhole/blob/f86aa0d2edc53ea3b02fe3e9a0a130d81323178d/README.md)。

## 10. Subagent：上下文隔离、继承与交接

### 10.1 官方扩展示例：独立探索，核心结果返回

官方subagent示例展示single/parallel/chain等用法，用角色指令和允许工具创建新Pi执行上下文，再交回结果。优势是父不必持续携带子任务全部read/bash过程，多个独立问题可以分工。

新session或进程只保证特定程度的transcript隔离，不自动保证文件、AGENTS、Skill、扩展、网络与权限隔离。链式任务若把previous全文无界传下去，也会重新膨胀。最终output应该交可用结论、条件、证据位置和未解决项，完整trace留在artifact。

### 10.2 pi-subagents：fresh/fork与可控继承

nicobailon/pi-subagents提供更完整的角色与会话策略。fresh从最小独立任务出发，适合独立搜索或盲审；fork沿父分支开始，适合共享复杂背景，代价是复制父输入和偏见。custom角色可配置project/global/skills继承，默认策略不能推给所有builtin角色。

前台child可以是同进程独立session，后台runner另有生命周期；不是所有child都意味着独立OS进程。按需启用subagent schema和输出artifact模式，可以减少父的常驻tool和大回传成本。

### 10.3 角色memory与pruned fork的真实边界

该项目角色MEMORY.md提供有界常驻核心，读取限制为前200行且有16KiB硬上限。角色记忆应保存可复用认识，而非每次任务全部日志；用户/角色/项目作用域需要明确。

当前固定快照支持pruned fork：将继承背景压缩并保留private sidecar。但文档明确该版本尚无child恢复命令，因此不能把“侧文件保留”写成“模型随时可自动精确恢复”。输出策略也应按当前maxOutput/outputMode说明，而非套用旧版分页接口。完整核查见附录B。

### 10.4 何时委派是净收益

适合：大量独立检索、竞争解释、专项review、能交小结果的长期追踪。未必适合：父直接用一个确定性工具就能解决、子任务须不断读取变化中的状态、背景重建很大、结果到达时已过时。

成本至少包括父解释任务、child输入/输出/reasoning、启动/等待、结果理解、冲突修订与失败。只看到父输入变短，不能判定合计变便宜。fresh提高隔离但可能丢必要背景；fork延续背景但会复制无关历史，应该按任务选择。

来源：[官方示例](https://github.com/earendil-works/pi/tree/v1.0.4/packages/coding-agent/examples/extensions/subagent)、[pi-subagents](https://github.com/nicobailon/pi-subagents)、[角色文档固定快照](https://github.com/nicobailon/pi-subagents/blob/6a6675c971076ef3fc4a1ac443da938144f9a52b/docs/agents.md)。

## 11. Pi Durable：官方的任务所有权与可回放会话路线

Pi Durable把conversation的所有权交给task。task可以管理子会话、工作集与持久历史，checkpoint/replay使长任务在有边界的状态上续接。它强调运行职责与会话状态，而不是让每个Agent都长期背着所有对话。

system sections增量与后台task ownership有助于明确谁推进、谁暂停、谁恢复；working set与磁盘历史分离也适合长期多Agent运行。它于2026-10-01作为实验性官方项目介绍，不替代terminal Pi；应把它视作另一开发/部署模型。

重要术语区别：文档里memory storage backend指内存存储后端，不等于语义长期记忆。checkpoint/replay的运行恢复也不等于模型保持所有先前推理。具体公开接口与示例见附录A。

来源：[官方Pi Durable介绍](https://earendil.com/posts/pi-durable/)。

## 12. 按场景选择：轻量起步，保留恢复路径

| 使用场景 | 建议先研究的组合 | 主要理由 | 要观察的退化 |
|---|---|---|---|
| 普通短编码任务 | 原生session/Skill/compaction | 额外组件少，默认工作集已够 | 不为小任务增加长期记忆worker |
| 大量MCP与大表/日志 | 原生codemode/tool_search，必要时adapter | 工具发现和中间数据在请求外处理 | 搜索/描述往返、权限粒度、输出遗漏 |
| 长会话大量重复文件结果 | 一个DCP或context-prune/condense | 优先移除可确定冗余，保留原文入口 | 缓存重建、tool配对、关键旧证据被删 |
| 跨会话偏好/项目约定 | 文件memory或blocks/workbench | 人可审阅，核心有界，作用域清楚 | 过时条目、自动写回污染、检索不准 |
| 摘要调用贵/本地小模型 | pi-vcc等确定性路线 | 省掉摘要模型调用，保留entry召回 | 结构抽取漏隐含理由与图像关系 |
| 长任务规则/决定持续演化 | 调参后观察式memory | 持续观察与综合，不等满窗口才总结 | worker总费用、fallback主模型、冲突 |
| 多个独立子任务 | pi-subagents fresh+短回交 | 隔离工具过程，降低父常驻细节 | 背景不足、结果过时、子总成本 |
| 强审计/用户确认长期事实 | DavidEasden/pi-compact | authoritative/provisional分离，事件可追溯 | 确认负担、指针摘要缺工作语义 |
| 持久任务编排/恢复开发 | 评估Pi Durable | task拥有会话与有界工作集 | 实验状态、API变化、replay语义 |

组合原则：一套主压缩策略、一套明确的历史剪枝策略、一套有范围的memory就已足够形成可解释链路。先解决真正膨胀的层——system/Skill目录、active schema、旧result或child回传——再决定加什么。不要把所有插件都装上当作最佳方案。

## 13. 如何评价上下文方案是否真的优秀

### 13.1 容量、恢复与任务质量分开

应测量：请求实际input token、system/schema/history分别占用、图像计量、cache hit、output/reasoning、检索和摘要调用、父子总量、墙钟等待。JSON字符、UTF-8字节、base64体积与计费token不是同口径；缺失用量应保留未知。

恢复检验不能只检查文件存在：构造一个早期用户澄清、旧假说被反例推翻、尚未完成的检验，在压缩/恢复后看模型是否保持认识并做正确下一步。找回原文但重复已排除方案，说明问题在语义采用或工作集，而非存储。

### 13.2 缓存经济学

缩短旧prompt会改变prefix，可能损失缓存；发送更多cached token有时比发送较少uncached token便宜。反过来，持续保留巨量旧内容仍消耗窗口和注意力，不能只追cache hit。应以任务剩余轮次、预计复用量、摘要/剪枝成本和真实cache规则判断。

Pi1.0.4把prompt sections/tool loadout变化作为system-message deltas追加，compaction保存完整checkpoint。能够表示中途变化的provider可保留既有prefix；不能表示的provider会收到完整checkpoint，仍可能破坏缓存。tool_search激活的工具声明留在当前branch，不自动用完卸载。

原生cacheWarming默认streaming，仅在模型声明cache lifetime且预计能避免至少$0.05 cache miss成本时刷新；usage计入session，但刷新不进入模型历史。它是缓存保温，不是长期记忆或免费请求。摘要请求默认禁写prompt cache，避免低复用一次性内容增加cache-write费用。具体来源见附录A。

### 13.3 一组有用的负例

关键结论位于大tool result尾部；完成的写入使旧read过时；摘要把弃用与反驳混淆；图片关系没转文本；fresh child缺反例；fork child继承父错误；pruned sidecar没有调用入口；memory同名项目功能混写；两个扩展同时接管压缩；廉价worker失败回退主模型；强制记忆确认阻断普通任务。

这些案例更能揭示方案边界，而不是只问“能把token减少多少”。本次报告研究公开实现，不把文档、源码与作者测试视为已复现真实任务净收益。

## 14. 资料索引与完整联网研究附录

以下附录全部嵌入HTML；展开可读完整机制、默认值、固定commit与一手URL。只讨论Pi官方及社区，不包含任何本地工程的组件实现或对照。

- 附录A：Pi v1.0.4原生context、session、compaction、MCP/codemode/tool_search与Pi Durable。
- 附录B：社区长期memory、memory blocks/workbench、pi-memento与pi-subagents。
- 附录C：MCP adapter、可恢复tool剪枝、cache-aware condense、DCP、主动context管理与continuity。
- 附录D：pi-vcc、pi-blackhole、DavidEasden/pi-compact与目录按需加载候选。

检索方法：实际网络搜索发现项目，回到官方文档、仓库README、package和关键源码确认；优先固定release/commit。未下载成功的源码、未复现benchmark及版本兼容缺口逐项注明。项目“公开实现”与“作者声明”分开；同名仓库按owner识别。研究日之后的main变化不由本报告保证。
