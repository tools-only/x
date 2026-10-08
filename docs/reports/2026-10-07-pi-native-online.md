# Pi 原生上下文管理：联网一手资料研究

研究日期：2026-10-07。范围：Pi 本身、官方示例和实验性 Pi Durable；不使用本工程实现作为证据。本研究实际调用联网搜索、打开官方站点，并通过 GitHub API 与 raw.githubusercontent.com 读取固定发布源码。功能依据文档和源码核查，未执行 Pi 运行测试，也不将机制存在等同于质量或成本改善的实验结论。

## 1. 版本与证据基线

当前官方仓库为 [earendil-works/pi](https://github.com/earendil-works/pi)，官方文档为 [pi.dev](https://pi.dev/docs/latest)。联网查询时最新发布为 [v1.0.4](https://github.com/earendil-works/pi/releases/tag/v1.0.4)，GitHub API 的 published_at 为 2026-10-05T22:03:50Z，即北京时间 2026-10-06 06:03:50。tag 指向 commit `7c10bd4337495ee613f2224843ecdf349b80d1df`；本报告所有默认值均以该发布源码为准。查询时 main 为 `2db5e359bf84c1c0be51d2c5c5c5c7cf27072c2b`，2026-10-07 提交，不以 main 的未来变动覆盖 release 基线。[发布 API](https://api.github.com/repos/earendil-works/pi/releases/latest)、[tag API](https://api.github.com/repos/earendil-works/pi/git/ref/tags/v1.0.4)、[main commit API](https://api.github.com/repos/earendil-works/pi/commits/main)。

2026-10-01 官方宣布 Pi 1.0，明确新增原生 MCP、Codemode、延迟工具加载、Anthropic 缓存保温以及会话中系统消息。因此“Pi 没有 MCP”“Pi 的 prompt 永远不能变化”等早期介绍不再适合描述当前发布；旧版工具链 `@mariozechner/*` 的说明需要按版本阅读。[Pi 1.0 发布说明](https://earendil.com/posts/pi-1-0/)。

## 2. 核心模型：保存的历史与下一次请求的上下文分离

Pi 保存的 session 是带 `id`、`parentId` 的 JSONL 事件树。下一次模型请求只投影当前活动分支：原始历史、分支投影、系统提示与工具状态、压缩结果、扩展变换，合起来产生模型真正看到的内容。历史文件可以很大，模型不需要看到所有分支和所有历史。这样的分离让审计、分支探索、压缩和局部修改相容。[运行原理](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/docs/how-pi-works.md)、[Session 格式](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/docs/session-format.md)。

可将一次请求的信息流概括为：用户输入进入活动分支 → 重放该分支的 system prompt/tool loadout → 应用 `context_edit` 和 compaction 得到历史投影 → 扩展做请求级上下文转换 → 适配 provider 的消息格式 → 调用模型。工具原始输出、扩展内部状态、其他分支和 UI 展示数据，并不因此自动全部成为 prompt。[Session 格式](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/docs/session-format.md)、[扩展契约](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/docs/extensions.md)。

**工程推论：** 优秀的上下文管理并非把所有内容压成一段，而是先决定数据归属、能否按需找回、是否应被模型看到，再决定摘要和删除策略。Pi 的设计给出了这些边界，但不会自动替开发者做所有语义判断。

## 3. Session tree、fork、clone：用拓扑隔离探索路径

| 操作 | v1.0.4 行为 | 上下文意义 |
|---|---|---|
| `/tree` | 在同一 session 文件内跳转到历史节点继续；保留离开的分支 | 不把互斥方案的全文混入一个线性 prompt |
| `/fork` | 从较早的用户消息创建新 session | 把一个探索路径变成独立工作 |
| `/clone` | 将当前活动分支复制为新 session | 以同一当前状态开始独立实验 |
| `/new` | 开新 session | 适用于目标或约束已发生大幅变化 |
| `--continue`、`--resume` | 恢复最近 session 或打开选择器 | 持久化历史连续性，而非依赖常驻模型进程 |

这些操作改变模型后续看到的历史路径，不等同于回滚工具已经修改的文件。跳转到较早节点后，实际文件系统仍需按当前状态理解。这一点是根据“session 保存与工具执行环境分离”的架构所作的使用判断。[Sessions 文档](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/docs/sessions.md)、[运行原理](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/docs/how-pi-works.md)。

优秀之处在于既保留所有尝试的可追溯性，又只向模型展示当前路径；失效边界在于分支之间的重要结果需要主动迁移，分支切换本身不会进行全局语义合并。

## 4. Compaction：结构化任务状态与最近原文并存

### 4.1 准确默认值

| 配置/处理 | v1.0.4 默认或规则 |
|---|---|
| `compaction.enabled` | `true` |
| `compaction.reserveTokens` | `16384` |
| `compaction.keepRecentTokens` | `20000` |
| 自动阈值 | `contextTokens > contextWindow - reserveTokens` |
| 手动入口 | `/compact [instructions]` |
| 模型专属覆盖 | `compaction.modelOverrides["provider/modelId"]`，两个 token 字段独立回退 |
| 摘要输入中的单个 tool result | 序列化时截到 `2000` 字符，并加截断提示 |

最后一项是**摘要生成输入**的额度，不能与普通 `read`、`bash` 的模型可见结果截断混为一谈。`reserveTokens` 还影响摘要输出上限，并受模型最大输出额度限制；它不是纯粹的触发百分比。官方不使用统一“95%窗口”作为此版本的精确阈值。[Compaction 文档](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/docs/compaction.md)、[Settings 文档](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/docs/settings.md)。

### 4.2 信息流

Pi 从最新消息向前估算累计 token，寻找满足最近保留预算的切点；收集需要摘要的较早消息与上一轮摘要；调用模型生成结构化摘要；追加 `CompactionEntry`，记录 `firstKeptEntryId`；下次请求使用摘要加保留原文。被摘要的原始 entry 不从 session 文件删除。`CompactionEntry` 还可保存完整 system/tool checkpoint，避免 prompt 与工具状态依赖已被摘要移出的 system delta。[Compaction](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/docs/compaction.md)、[CompactionEntry](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/docs/session-format.md#compactionentry)。

默认摘要围绕目标、约束与偏好、已完成/进行中/阻塞、关键决策、下一步、关键上下文组织，并累计记录读过和修改过的文件路径。重复压缩将旧摘要作为迭代输入，也把之前保留而本轮需要压缩的原文纳入，避免仅沿摘要不断更新而遗漏边界消息。它是任务状态记忆，而不是历史全文检索系统。[Compaction](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/docs/compaction.md)。

### 4.3 工具调用完整性与运行时机

切点允许在 user/assistant 等消息处，但不会直接从 tool result 切开，因为 tool result 必须与其调用相配。当单个用户消息跨度很长、无法整体保留时，会把该跨度前缀与更早历史分别摘要后合并。多轮执行期间，在工具结果追加后、下一轮 assistant 请求前检查阈值，避免只在用户下一次说话时才发现超窗。[Compaction](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/docs/compaction.md)。

当前版本也有 provider context-overflow 与部分 `length` 终止的恢复：将所选失败 attempt 从未来上下文省略，尝试压缩，再按生命周期启动新的重试。若压缩失败或取消，不追加压缩、不安排内部重试，原始 attempt 仍能在历史、导出和计费中查看。含工具调用的 `length` 回复走工具/队列调度，不应一概解释为立即结束整个任务。[恢复顺序](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/docs/compaction.md#overflow-and-length-recovery-ordering)。

**优势与边界：** 最近原文保留操作细节，摘要保留任务状态，原始历史保留审计线索。代价是摘要另一次模型请求，有延迟、费用和语义丢失；2000 字符的工具摘要输入可能丢掉后半段证据。文件列表只是路径，不能保证内容仍与读取时相同。大窗口模型也不意味着 should 等到极接近窗口才压缩；具体预算应结合输出空间、长工具结果和实际质量评估。

## 5. Branch summary：把离开分支的价值带走

`/tree` 离开当前分支时可选择摘要：找新旧位置的最深共同祖先，收集旧叶到共同祖先之间的条目，按预算优先纳入较新信息，生成摘要，再追加到目标分支。模型因此能利用被放弃路线的结论，而不必接收其全部试错日志。它与常规 compaction 的目的不同：前者跨探索路径转移成果，后者缩短同一路径历史。[Branch summarization](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/docs/compaction.md#branch-summarization)。

适合保留“方案 A 因约束 X 失败”“已验证接口 Y”“不要重复某项无效实验”等信息。失效边界是把已放弃的假设包装成当前真理，或摘要遗漏分支发生时的文件状态。扩展可通过 `session_before_tree` 定制或取消导航及摘要；默认与扩展生成的 file tracking 责任不同，自定义生成者需要管理自己的 `details`。[自定义分支摘要](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/docs/compaction.md#session_before_tree)。

## 6. Context edits：可审计地替换未来上下文

v1.0.4 提供 `ContextEditEntry`。它是持久化 session entry 类型，不是默认注册的两个模型工具或统一命令。其接口核心是 `type: "context_edit"`、`targetId`、`replacement`：`replacement: null` 从未来 model context 省略目标；非 null 值只替换目标 message 的 content。目标可以是 user、assistant、tool-result、custom-message；同一目标在当前路径有多次编辑时以最后一次为准；编辑是 branch-relative，跳回编辑之前可再次见到原文贡献。[ContextEditEntry](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/docs/session-format.md#contexteditentry)。

原始 entry、元数据、UI、export 和 session accounting 不被该编辑覆盖。因此“删上下文”与“删证据”分离，可用于去除错误 attempt、重复读取结果、过时检索证据或巨大日志。扩展的 `turn_end`、`agent_before_settle` 能提出 `context_edit` 等 entries 并请求一次继续；更精确 TypeScript 返回类型应以同 tag 的 `extensions/types.ts` 为准，本次没有运行这类扩展。[扩展契约](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/docs/extensions.md)。

**工程推论：** 确定重复或无用的内容宜省略；只有部分仍有用的大结果可替换为短摘录与可查回地址。不要只按年龄删除信息，也要保护仍支撑当前决策的证据及 tool call/result 关系。此功能给出机制，不保证任意选择删除后都语义正确。

## 7. Context files 与 memory：常驻规则、外部事实、会话状态分别处理

Pi 原生会话持久化、摘要、上下文文件与扩展状态已经支持多种“记忆”，但本次核对的 coding-agent v1.0.4 标准能力没有显示通用的自动跨会话语义记忆抽取/向量召回系统。不能把“有 session JSONL”说成“自动记住一切”，也不能把 Pi Durable 的 `MemoryStorage` 说成语义长期记忆。

Pi 在 agent 目录、cwd 及祖先目录加载上下文文件，同目录候选优先顺序是 `AGENTS.override.md`、`AGENTS.md`、`AGENTS.MD`、`CLAUDE.md`、`CLAUDE.MD`，每个目录取第一个存在且可读的文件。全局文件先加入，祖先文件按远到近加入；`AGENTS.override.md` 只替代同目录候选，不会压掉其他目录。源码的祖先 walk 直到文件系统根目录，因此不要与 `.agents/skills` 遇 Git repo root 截止的规则混淆。配置加载还处理嵌套 linked worktree 的重复上下文遮蔽。[配置](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/docs/configuration.md)、[resource-loader 源码](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/src/core/resource-loader.ts)。

上下文文件作为系统 prompt 的 `project_context` 段直接带入，不是一次 semantic retrieval。它适合短而稳定的规则、项目身份、真正跨任务适用的约束，不适合堆积每天变化的日志。`SYSTEM.md` 替代默认提示，`APPEND_SYSTEM.md` 添加提示；可信项目的同名文件优先于 agent 目录同名文件，不将两份同名内容自动拼接。[配置](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/docs/configuration.md)、[system-prompt 源码](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/src/core/system-prompt.ts)。

| 数据 | 官方给出的合适载体 | 自动进模型上下文吗 |
|---|---|---|
| 稳定指令 | context files / prompt sections | 会加载为 prompt |
| 当前任务进展 | 当前分支、compaction / branch summary | 作为投影的一部分 |
| 分支相关工具状态 | tool-result `details` | details 本身不作为工具正文发送 |
| 同 session 耐久元数据 | `pi.appendEntry()` / `custom` | 不进入模型上下文 |
| 希望模型阅读的自定义内容 | `pi.sendMessage()` / `custom_message` | 进入模型上下文 |
| 跨 session 事实与资料 | 外部存储 | 需工具、文件或扩展显式检索/注入 |

该表尤其提醒：在磁盘保存状态，不等于让模型知道；在 TUI 隐藏消息，也不等于不让模型知道。`custom_message.display=false` 可以不显示在 TUI，但正文仍参与模型上下文；其 `details` 不发送。[扩展 State](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/docs/extensions.md#state)、[CustomEntry / CustomMessageEntry](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/docs/session-format.md)。

## 8. Skills：描述常驻，正文按需加载

Pi 实现 Agent Skills 标准。启动时扫描 skill，将 name、description、path 加入 system prompt，不载入整个 SKILL.md。模型认为任务匹配后读取全文；`/skill:name` 可以显式触发，参数作为用户请求随技能进入；`disable-model-invocation: true` 从自动选用列表隐藏，保留显式命令用法。这是渐进披露：先让模型知道“有哪些能力”，再为所选能力支付详细上下文成本。[Skills](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/docs/skills.md)、[Agent Skills 标准](https://agentskills.io/)。

skill 可把脚本、参考文献、资源文件分开，使用相对路径继续按需读取。Pi 也支持 `~/.agents/skills/` 和项目 `.agents/skills/`，项目祖先搜索在存在 repository root 时停止。description 直接影响模型是否能正确路由，名字模糊或所有 skill 都宣称适用任何任务，会扩大常驻描述负担并降低选用可靠性。官方明确模型可能漏读相关 skill，此时显式命令更可靠。[Skills](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/docs/skills.md)。

其边界是“按需加载”并不意味着“执行完自动卸载”。读进来的 skill 正文已经成为历史，之后随普通历史保留或压缩；大量短任务连续启用许多 skill 仍可能积累上下文。该判断来自 skills 读取进入消息历史及 compaction 的机制，不是官方提供的自动卸载能力。

## 9. Tools：在源头控制结果体积，并留下查回路径

默认启动工具为 `read`、`bash`、`edit`、`write`，不是默认把所有内置搜索与第三方工具都宣告给模型。v1.0.4 可选内置还包括 powershell、grep、find、ls；codemode 与 tool_search 由内置扩展注册为初始 inactive，按配置或 MCP 接入需求激活。[Settings](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/docs/settings.md#tools)。

| 工具/阶段 | 固定发布行为 | 优秀之处与注意点 |
|---|---|---|
| read 文本 | 头部最多 2000 行或 50 KiB，先到者为准；offset/limit；输出下一读取位置 | 分页读取，按需追踪；别把头部当全文 |
| bash 模型正文 | 尾部最多 2000 行或 50 KiB；完整输出保存临时文件并返回路径 | 日志结尾常包含错误与结论；中间证据需再查 |
| grep | 默认 100 matches 或 50 KiB，单行最多 500 字符 | 搜索先定位，再 read 查看完整局部 |
| find | 默认 1000 results 或 50 KiB | 先找文件集合，避免全库正文入 prompt |
| ls | 默认 500 entries 或 50 KiB | 目录逐步探索 |
| 摘要序列化 | 单 tool result 2000 字符 | 限制摘要模型输入；需要提前摘录关键证据 |

这些不是统一的 token 截断额度；UTF-8 字节、行、字符各有用途。50 KiB 来自常量 `50 * 1024`。read 自动缩放图片默认开启，并优先采用当前模型图像 resize profile；小字/精细图像可能需要额外核验。本次不为所有 provider 宣称统一图像尺寸。[truncate.ts](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/src/core/tools/truncate.ts)、[read.ts](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/src/core/tools/read.ts)、[bash.ts](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/src/core/tools/bash.ts)、[grep.ts](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/src/core/tools/grep.ts)、[find.ts](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/src/core/tools/find.ts)、[ls.ts](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/src/core/tools/ls.ts)。

**使用建议（推论）：** 测试先返回失败摘要、文件位置、exit code；大型 JSON 先筛选字段、过滤条目或聚合；网页先定位相关片段；精确值、关键异常与查回地址应保留。所有结果都打到硬上限才截断，比源头按语义选出真正需要的内容效果弱。

## 10. Codemode、MCP、tool_search：限制工具声明与中间数据

### 10.1 工具描述的渐进发现

扩展工具有 direct（默认）、model-only、codemode、deferred、hidden exposure。active tools 是“向模型声明”的集合，并非一切已注册工具的集合。codemode/deferred 工具可通过脚本间接调用，deferred 不在 codemode description 展开，需 `searchTools()`、`describeTool()`、`describeNamespace()`、`ALL_TOOLS` 发现。`tool_search` 也可发现并激活它们，使其在后续模型请求直接可见。[Tool exposure](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/docs/extensions.md#tool-exposure)、[Codemode](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/docs/codemode.md)。

MCP server 默认 exposure 是 `codemode`：可由脚本调用，但既不直接向模型声明，也不把每个 tool 列入 codemode 描述。server 的 `deferred` 则强调 `tool_search` 加载后直接调用；`direct` 面向小而常用的集合；`hidden` 注册但不可到达。server 配置可逐工具覆盖 exposure。MCP 的 codemode/deferred server 在 system prompt 的 `mcp_servers` 段只显示服务器级简短说明和访问方式；连接变化时更新该段，不强制铺开所有工具 schema。[MCP](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/docs/mcp.md#control-tool-exposure)。

codemode 描述中列出的工具声明共享 `codemode.inlineBudget=3000` **估算 token（characters / 4）**，不是每个工具 3000 token，也不是按模型 tokenizer 精确计数。超预算不列出的工具仍能查找；0 仅列 namespaces。`codemode.mode=on` 为默认：当前已声明的工具继续声明；`only` 隐藏这些声明，让模型经脚本调用。[Settings](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/docs/settings.md#tools)、[Codemode](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/docs/codemode.md#call-tools)。

### 10.2 结果在脚本里加工，只有选定输出给模型

Codemode 在 QuickJS 沙箱运行 JavaScript，通过工具调用外部系统，批量/并行结果可以先筛选再 `text()`。只有脚本输出进入模型结果；每个 nested tool 的全文不会逐条新增 transcript entry。nested calls 仍留下受限的元数据，便于事件显示、文件操作追踪和成本归集。沙箱本身不提供 Node、文件系统或网络 API；真实工具仍使用其实际授权环境。[Codemode](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/docs/codemode.md)、[Nested tools](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/docs/extensions.md#tools)。

bash 的程序化 `structuredContent.output` 最多 1 MiB，长于此时保留首尾各 512 KiB 并给完整输出路径，明显高于直接给模型的 2000 行/50 KiB。这让脚本有更大数据加工空间，却仍可只返回一个很短的表格/摘要。工具定义有 `outputSchema` 时脚本取得 structuredContent；模型仍取得 content。不能拿 structuredContent 上限代替普通模型上下文上限。[Codemode](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/docs/codemode.md#call-tools)、[bash.ts](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/src/core/tools/bash.ts)。

默认脚本输出预算 `max_output_tokens=10000`，长输出保留头尾并写临时文件；脚本存储 `store/load` 是小 JSON 状态，可跨调用、resume 和 branch 恢复，成功脚本才提交 store 更改。其限制为单值 JSON 262144 字符、总计 1048576，适合 ID、cursor、短摘要，不是无限资料库。VM memory 为 256 MB。[Codemode](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/docs/codemode.md#store-values)。

**优势与边界：** 工具 schema 和中间数据都按需进入 prompt，适合大量 API、搜索、表格处理。风险是模型生成脚本的复杂度、遗漏错误、加工时丢掉关键字段、实际工具已有副作用而脚本后来失败。tool_search 加载后的声明保留在该分支，不能假定每次调用后自动卸载。选择最少而足够的工具仍需要语义判断。

## 11. Extensions 与 transformContext：请求局部变换和持久修改分开

agent-core 的消息流为 `AgentMessage[] → transformContext() → AgentMessage[] → convertToLlm() → Message[] → LLM`。前者适合剪枝、检索注入等 AgentMessage 层操作；后者负责 UI-only/custom 类型向 provider 消息格式转换。开发者可把外部 memory retrieval、精简观察或成本控制放在这里，但库接口不是内建的检索策略。[agent-core README](https://github.com/earendil-works/pi/blob/v1.0.4/packages/agent/README.md#message-flow)。

coding-agent extension 的 `context` 事件变换 conversation messages，排除 prompt/tool system messages，Pi 在后续恢复 system 状态；需要完整 transcript 的 request-local 改写时使用 `context_with_system`，并保留 index zero 的 system message。要持久影响未来分支与 compaction 的内容，应考虑 `context_edit` 或 compaction entry，而不把临时 request transform 与耐久编辑混称一种机制。[扩展](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/docs/extensions.md#events-and-concurrency)。

`session_before_compact` 可取消或生成自定义摘要（附 `firstKeptEntryId`、`tokensBefore`、`details` 与可选 usage）；`session_compact_failed` 有失败/中止终态；`session_before_tree` 可以处理跨分支总结；`tool_result` 可在入模型前改写结果，各 handler 按注册顺序组成。这些 hook 支持社区更复杂的 observation memory、检索或删除机制，同时也可能相互覆盖或累加内容。更新 content 的脱敏逻辑也需考虑 structuredContent 的契约，不应让程序化通道保留已脱敏的敏感原文。[扩展](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/docs/extensions.md)、[自定义摘要](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/docs/compaction.md#custom-summarization-via-extensions)。

## 12. 系统 prompt/tool delta 与缓存：让配置变化进入历史

v1.0.4 首个请求把 prompt sections 和工具声明保存为 system message，后续变化通过命名 sections patch 与 `toolsAdded/toolsRemoved` 追加；section 的 null 表示移除。重放可恢复模型在各历史点看到的配置。compaction 用完整 checkpoint 重建当前系统状态。dynamic tools 或技能目录变化不再只存在于进程内的一个不可审计可变字符串。[Session system messages](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/docs/session-format.md#sessionmessageentry)、[system-prompt.ts](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/src/core/system-prompt.ts)。

能表示中途 system/tool changes 的 provider 接收增量，利于保留已缓存前缀；不能表示的 provider 会拿到完整 transcript checkpoint，可能使缓存前缀失效。因此“追加 delta 必然不破缓存”是不准确的。`before_agent_start` 优先改变结构化 prompt sections、工具或 guidelines；强制整段 `systemPrompt` 是更强的行为替换，要理解 transcript 与 provider-facing 文本的关系。[扩展](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/docs/extensions.md)。

缓存保温默认 `cacheWarming="streaming"`，可选 off/idle。仅在模型声明 cache lifetime 且估计可避免 cache miss 成本至少 $0.05 时运行；refresh usage 计入 session totals，但不进入模型上下文。它是 provider 缓存策略，不扩大上下文窗口，也不是长期记忆。压缩摘要请求禁写 prompt cache，因为这类一次性提示复用概率低。[Settings](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/docs/settings.md#model-and-thinking)、[Compaction](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/docs/compaction.md)。

## 13. 官方 Subagent 示例：隔离阅读过程，只交付压缩成果

coding-agent 发布源码把 subagent 放在 `examples/extensions/subagent/`，需要安装或启用该 extension；不要把它写成默认启动就有的内置 `subagent` 工具。示例为每个 agent 启独立 pi process，以 `--mode json -p --no-session` 运行，附角色 system prompt、任务与工具/model 配置，不传整个 parent conversation。chain 用 `{previous}` 显式传递上一 child 的最后回复。[官方示例 README](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/examples/extensions/subagent/README.md)、[index.ts](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/examples/extensions/subagent/index.ts)。

示例有 single、parallel、chain 模式；parallel 最多 8 tasks、4 concurrent。模型可见 parallel 返回每个任务最终输出，单任务上限 50 KB，完整 child 结果保留在 tool details。single/chain 返回最终结果而不是其每次文件读取的全文。scout 的专门角色要求给文件路径与精确行范围、关键代码、结构关系、下一步先读哪里，使下一 worker 能按证据查回原文。[README](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/examples/extensions/subagent/README.md)、[scout prompt](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/examples/extensions/subagent/agents/scout.md)。

这个模式的优秀之处是“模型上下文隔离 + 结果接口”：让子 agent 吸收杂乱的搜索、试错与工具日志，父 agent 接受结论、来源和待办。它不保证总费用减少，子 agent 仍有自己的 prompt 和多轮调用；如果任务强依赖大量 parent 对话，任务 brief 不足会导致重新探查或偏离目标。`--no-session` 也意味着 child 默认不具备退出后继续同一 session 的历史连续性。

隔离 context 不等于文件系统隔离：示例子进程默认使用同一任务 cwd，agent tools 和 prompt 只是能力/角色配置，不是 OS sandbox。示例默认只发现 user-level agents，project agents 需 scope 启用，并有 project trust 相应确认机制。省上下文与权限安全应分别描述。[示例 README](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/examples/extensions/subagent/README.md#security-model)、[index.ts](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/examples/extensions/subagent/index.ts)。

## 14. Pi Durable：官方实验性的长生命周期路线

Pi Durable 与 Pi 1.0 同日在 2026-10-01 推出，是构建长期、多入口、多参与者 agent 应用的实验性 substrate；官方明确它不替代 terminal coding agent，README 提醒 API 可能在 release 间无预告变化。因此应列为官方实验路线，而不把其 API 写成 coding-agent 已自动具备的稳定默认能力。[官方说明](https://earendil.com/posts/pi-durable/)、[固定发布 README](https://github.com/earendil-works/pi/blob/v1.0.4/packages/durable/README.md)。

其上下文管理值得关注的机制有：immutable transcript 与旁边的 typed documents 分离；模型只见最新 reset 之后的 entries；每一步工作 checkpoint 后再展示，崩溃后从存储恢复；prompt sections 与 tool changes 在各位置记录，只发送变化；每个 conversation 选择 model、tools、extensions、cwd；持久 provider session identity 支持恢复与缓存亲和；child/fork 得到新 identity。[Pi Durable README](https://github.com/earendil-works/pi/blob/v1.0.4/packages/durable/README.md)。

SQLite 后端只在内存维持活动 transcript、live tasks 和 pending submissions，旧历史按需留在磁盘。配合 compaction，让很长的历史不会全部占 resident working set。它支持 MemoryStorage、SQLite、JSONL storage；这里的 MemoryStorage 是**进程内存存储后端**，不是抽取事实、embedding、vector retrieval 的长期知识记忆。[官方说明](https://earendil.com/posts/pi-durable/)、[README](https://github.com/earendil-works/pi/blob/v1.0.4/packages/durable/README.md)。

Subagent 没有规定唯一内建协议，而是一个 tool-owned conversation：工具创建/找回 owned child conversation，给它专门模型、指令和工具，等待结果。foreground ownership 决定 parent abort/settle 行为，background task 可在当前 conversation idle 后继续。崩溃恢复时工具只有声明 `replay:"safe"` 才重跑，不安全的被告知中断；这解决生命周期与回放安全，不是单靠更大窗口能解决的问题。[官方说明](https://earendil.com/posts/pi-durable/)、[README 的 Abort and Subagents](https://github.com/earendil-works/pi/blob/v1.0.4/packages/durable/README.md#abort-and-subagents)。

## 15. 机制选择与已验证边界

| 场景 | 首选原生机制 | 加强方向（分析建议） |
|---|---|---|
| 工具结果巨大 | 定位/分页/头尾截断、Codemode 聚合 | 保留来源、精确值、异常和完整输出路径 |
| 工具 schema 很多 | MCP codemode/deferred、tool_search、namespace | 控制动态激活集合与重复工具 |
| 长任务连续执行 | 结构化 compaction + 最近原文 | 核验目标/约束/未完工作是否持续保留 |
| 试错路线分叉 | tree/fork/clone + branch summary | 明确结论、失败条件与当前事实的区别 |
| 历史有重复/失败垃圾 | context_edit omit/replace | 保护引用关系与未失效证据 |
| 专门流程偶尔使用 | Skills 的描述/正文/参考分层 | skill 描述准确，正文短，细则按需 |
| 跨任务稳定规则 | 短 context files | 避免无限日志驻留 system prompt |
| 跨会话知识与偏好 | 外部文件/存储 + 检索/注入扩展 | 来源、时间、作用域、失效与删除规则 |
| 大量独立阅读 | 官方 scout/subagent pattern | 子任务 brief 与可查回证据，计 parent+child 总成本 |
| 跨进程长期执行 | Pi Durable 实验路线 | 版本锁定、回放策略、ownership 与恢复测试 |

本报告确定了 v1.0.4 的默认值、官方公开接口及信息流；没有对不同模型、不同任务执行对照实验，也没有测社区插件与 v1.0.4 的实际兼容性。“优秀”表示机制解决的边界清晰、适合相应场景，并不代表所有组合都有净收益。源码路径链接均为官方上游固定发布，后续可据此验证行为，而非靠历史博客或本地安装状态猜测。
