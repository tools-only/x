# 业界 Agent 上下文管理机制调研（2026-09-29）

范围：Codex/OpenAI 与 Claude/Anthropic 的官方资料；关注长任务 Agent 的信息选择、压缩、恢复、工具回执和成本。下文区分产品已公开的行为与本工程可借鉴的设计，不把 API 功能直接当成 Codex 或 Claude Code 的内部实现。

## Codex 与 OpenAI

| 层面 | 官方机制 | 对本工程的启示 |
|---|---|---|
| 指令发现 | Codex 按全局到当前目录发现并拼接 `AGENTS.md`，默认合并上限 32 KiB。越接近工作目录的文件越靠后。[^codex-agents] | 长规则应分层放在实际作用范围；入口仅保留任务必须知道的约束。目录分层仍会占请求上下文，不能当作免费存储。 |
| 能力发现 | Skills 先提供名称、描述和路径；选用后才读取完整 `SKILL.md`。初始技能目录预算为窗口的 2%，窗口未知时为 8,000 字符。[^codex-skills] | 用短目录作选择入口，方法正文按需加载；方法文件仍要能被精确引用和复用。 |
| 历史压缩 | Codex CLI 的 `/compact` 汇总当前对话；`/status` 可查看上下文使用量。配置提供自动压缩阈值和单条工具输出的历史 token 上限。另有默认关闭的实验模式，使用笔记与可搜索历史替代不断重压同一摘要。[^codex-commands][^codex-config] | 成本可见、显式压缩、可找回历史是不同能力；单条输出上限可能损失证据，不能无条件用于 ARC 观测。实验模式的质量没有由配置文档证明。 |
| 子 Agent | Codex 建议把探索、日志分析等有边界的工作交给独立子 Agent，再收集结论，以减少主对话噪声；官方同时指出子 Agent 会增加总 token 消耗。[^codex-subagents] | 将工作隔离是主上下文优化，不一定是总成本优化；回传要含结论、分歧、证据引用和必要的下一步，而非整段轨迹。 |
| 跨会话 Memory | 本地 Codex Memories 可选且默认关闭；启用后从已空闲的合格聊天后台提取有用内容，并作全局整合，供未来聊天使用。可分别控制是否生成及是否使用。[^codex-memories][^codex-config] | 这是跨任务召回层，不等于当前 ARC 决策状态。任务内规则/反证仍应进入当前 checkpoint 或有证据的 task-local Memory，不能寄望异步跨会话提取。 |
| API 压缩 | Responses API 支持阈值触发的服务端压缩，也支持显式 `/responses/compact`。返回的加密 compaction item 不可人工解释；显式端点返回的完整窗口应原样传给后续请求。[^openai-compaction] | 这解决窗口延续，但不提供可审计的语义连续性证明。本工程仍需要 Agent 可见的假设、反证、计划和精确证据引用。 |
| 缓存与工具 | OpenAI prompt cache 复用相同前缀，降低重复输入的计算、费用和延迟；改变较早前缀、重写历史或改变工具定义可降低命中。官方建议稳定工具定义、用 `allowed_tools` 限制可调用集合，并可延迟加载工具。[^openai-cache] | 减少请求长度与降低账单不是同一指标。本工程频繁调整 active tool schema 时，应比较真实 `cached_tokens`、总费用和延迟。 |

Responses API 的 `previous_response_id` 或持久 Conversation 可以管理状态，但先前链路输入仍计入后续请求的输入 token；“服务端保存历史”不等于“免费上下文”。无状态链路要保留完整输出项，以免丢失 reasoning item 等状态。[^openai-state]

## Claude 与 Anthropic

Claude Code 的做法可概括为：**按需诊断、延迟加载、独立会话、定向压缩、稳定前缀缓存**。它同样保留自动压缩作为窗口将满时的兜底；这并不保证历史理解无损。更完整的逐项资料见[Claude Code 专题报告](claude-context-management-2026-09-29.md)。

| 层面 | Claude Code 的公开行为 | 对本工程的启示 |
|---|---|---|
| 占用诊断 | `/context` 展示当前上下文按类别的占用与优化建议；`/usage` 和状态栏展示用量。[^claude-context] | 父 Agent 与 child 应按需查看成本卡，识别主要来源及操作后的变化，避免每轮注入完整报表。 |
| 项目知识与技能 | 根级 `CLAUDE.md` 常驻；子目录规则随相关文件加载。技能描述先可见，调用时载入正文；正文进入会话历史后继续占用上下文。自动记忆仅载入入口索引，主题文件按需读。[^claude-memory][^claude-skills] | 常驻入口应短，详细方法与证据存入可定位资源。技能的“首次延迟加载”不等于后续免费。 |
| 工具发现 | MCP tool search 可先只给工具名称和服务器说明，查找后才加载完整定义；不支持所需 `tool_reference` 的代理或网关可能回退预加载。[^claude-mcp] | 工具渐进加载应先核实 Pi/provider 的协议能力及真实缓存收益；不能把动态工具定义视为必然省钱。 |
| 子代理隔离 | 普通子代理使用独立上下文，不继承父对话和已读文件，可恢复其历史；fork 方式则继承父历史。子代理仍可能加载项目指令，有启动成本。[^claude-subagents] | Auto-Research topic 适合独立、可恢复的上下文；父 Agent 只收结构化结论、反证与精确引用，委托时提供必要背景。 |
| 压缩与恢复 | 可主动 `/compact` 并指定重点；窗口接近限制时自动压缩。部分文件、项目指令和技能按规则重新载入，普通历史由摘要替代；`/rewind` 可选择历史节点及摘要。[^claude-context] | 在压缩前明确保留规则假设、反证、竞争策略、未完成实验及证据入口；压缩后通过后续决策检验连续性。 |
| 提示缓存 | 精确前缀匹配复用稳定的 system、项目上下文和历史；变更较早前缀、工具定义或压缩会影响相应缓存层。[^claude-cache] | 同时比较请求长度、缓存读写、延迟、费用和任务质量。稳定前缀与按需加载需要一起设计。 |

Anthropic 的工程建议是：复杂轨迹压缩先确保相关信息被**保留和可找回**，再逐步去除冗余；过早追求短摘要可能丢失后来才有价值的观察。清理较旧工具结果是一种较轻的压缩，但 ARC 的未判明现象和规则反例不能仅因出现得早就被删除。[^anthropic-engineering]

## 上一轮未展开的机制：Memory、工具回执与压缩后恢复

| 产品/层级 | 官方公开行为 | 准确边界与项目启示 |
|---|---|---|
| Codex 本地 Memories | 可选且默认关闭；后台从足够空闲的合格聊天提取记忆，保存摘要、持久条目、最近输入及支持证据，并可用独立模型/配置做全局整合。`/memories` 控制当前聊天是否使用旧记忆、是否贡献未来记忆。[^codex-memories][^codex-config] | **跨聊天知识整理**，不是对当前上下文实时压缩；团队必需规则仍要放 `AGENTS.md` 或受控文档。可借鉴“提取→整合→未来按需使用”，但当前 ARC 的未决假设不可等后台作业。 |
| Claude Code Auto Memory | Claude 选择值得跨会话保留的用户、反馈、项目和引用笔记；`MEMORY.md` 只作索引，启动时最多加载前 200 行或 25 KB，详情在 topic 文件按需读取。临近上限会提醒缩短索引，超过上限会要求重写。[^claude-memory] | 这是一种**索引压缩 + 主题细节延迟读取**。它跳过可从代码或 `CLAUDE.md` 推导的重复内容；不能理解为自动压缩当前所有工具回执。 |
| Codex 工具历史 | `tool_output_token_limit` 配置单个工具/函数结果在历史中保存的 token 预算。[^codex-config] | 文档只证明有历史预算，不证明超限部分总能从 Codex 的内部记录精确恢复。本工程需要自己的原文 ref 与分页读取。 |
| Claude Code MCP 回执 | 单个 MCP 输出超过 10,000 tokens 时警告；默认最大 25,000 tokens。超限的纯文本结果写入会话 `tool-results` 文件，聊天中用路径替换；可调总上限或按工具声明文本大小上限。[^claude-mcp] | 这是**落盘加路径引用**，不是模型生成的语义摘要。尤其适合无界目录、搜索、日志与 child 报告；ARC 最新动作结果仍需保留决策关键字段。 |
| Anthropic Messages API context editing | 可按输入阈值清除最旧工具结果，默认留最近 3 次工具使用；可设 `exclude_tools`、最少清理量及是否一并清除工具调用参数。API 对被清结果留占位，客户端历史保持原样；清除会使相应缓存前缀失效。另可配置旧 thinking block 清理。[^anthropic-context-editing] | **这是 Anthropic API 能力，不可直接称为 Claude Code 的内部机制。** 对本工程可借鉴“旧结果按来源和年龄选择、保留最近、保护关键工具、计算缓存代价”，但语义价值仍由 Agent 判断。 |
| 压缩后重注入与可搜索历史 | Claude Code 压缩后重载根项目指令、Auto Memory、磁盘 plan，并按预算重读最近修改文件和已调用技能；普通历史由摘要替代。Codex 有默认关闭的实验性“笔记 + 可搜索历史”模式。[^claude-context][^codex-config] | 恢复应区分**当前认知卡**与**精确历史检索**。重载文件或资源只能保证访问路径，不能证明 Agent 继续记得旧反证。 |

对 `autoresearch_pi_project`，当前 `task_memory_pool` 已有作用域、版本、证据引用、短目录、显式 assembly 和 retire；`child_context` 已有结果级压缩/恢复；ARC 历史 frame 也会投影为较小的模型视图。[^project-memory-pool][^project-child][^project-arc] 因此最值得补的不是再建一套通用 Memory，而是：**(1) Agent 主导的记忆去重/整合与失效检查，(2) 大回执落盘后返回短结构化索引及精确 ref，(3) 对自动历史归档后的假设、反证和计划作真实后续回合验收。**

## 两套机制的对应关系

| 问题 | Codex / OpenAI | Claude Code | 共同限制 |
|---|---|---|---|
| Agent 如何知道上下文成本？ | `/status`；本工程可另用 provider 遥测。 | `/context` 按类别诊断，另有 `/usage`。 | 估算 token、实际输入、缓存命中和任务质量是不同数据。 |
| 如何主动或自动腾出窗口？ | Codex `/compact`；可配置自动压缩阈值；OpenAI API 另有独立的压缩能力。 | 定向 `/compact` 与自动压缩兜底。 | 摘要可能遗漏后续决策需要的旧事实；压缩不是无损证明。 |
| 如何减少启动负担？ | Skills 元数据先行；`AGENTS.md` 按目录作用域发现。 | Skills、子目录规则、记忆主题与 MCP 工具定义按需加载。 | 一旦正文进入历史，后续仍可能持续占用；工具定义变化也可能影响缓存。 |
| 如何隔离大规模探索？ | Subagent 单独处理有界工作，返回结论。 | 独立且可恢复的普通子代理；fork 可继承父历史。 | 主上下文更短不代表总 token 更少；回传必须保留证据与不确定性。 |
| 如何降低重复处理成本？ | OpenAI API 精确前缀缓存。 | Claude Code 精确前缀缓存。 | 缓存不缩短逻辑上下文，不应把缓存读 token 当成已移除内容。 |

## 对 autoresearch_pi_project 的判断

现有工程已经有按需的父 Agent `task_harness(action="context")`、子 Agent `child_context`、分页 `task_resource`、任务 checkpoint、归档和 provider 请求遥测。[^project-context][^project-child][^project-resource][^project-telemetry] 因此，不宜再叠加一个自动替 Agent 判断哪些规则、反证或方案可以删除的压缩器。更有价值的是检验现有机制是否真正帮助 Agent 作出选择，并在后续回合恢复认识。

建议按以下顺序推进；均是待评估的设计方向，本次调研未实施：

1. **先建立同一条评价链。** 对每次真实 provider 请求同时记录实际输入、缓存读取/写入、延迟、费用，以及 ARC 的规则判断、策略更新和目标进度。`ceil(JSON 字符/4)` 只能作粗略诊断，不能代替 provider 用量。[^project-telemetry]
2. **验证压缩后的认知连续性。** 在 Agent 主动聚焦、压缩或恢复前后，检查它能否准确陈述仍成立的规则、竞争假设、反证、未完成实验、当前策略与下一验证步骤，并能定位原始证据。原文可分页恢复不等于这些认识自然留在模型输入中；这是延后待办 D，尚未完成真实任务质量验收。[^project-backlog]
3. **让 Agent 主导内容取舍。** Agent 决定当前哪些信息可省略或应恢复；runtime 提供成本、权限、存储、投影和精确读取。原始观测、研究报告、工具回执是证据；摘要保留解释与引用，不升级为证据。Auto-Research topic 保持独立、可恢复，只回传有行动价值的结论及依据。
4. **比较工具策略的真实收益。** 稳定工具定义有利于前缀缓存，动态激活可降低当轮 schema token；两者可能相互抵消。用实际 provider 缓存字段、成本和任务效果比较，而非只看最大请求长度。[^openai-cache][^claude-cache]

相关的未完成讨论还包括延后待办 C：child 按需请求证据或新观测时，如何把结果路由给 child、又让父 Agent 保持对环境动作的控制。本次上下文调研只指出其成本与连续性影响，并未改变现有父子交互边界。[^project-backlog]

### 来源

[^codex-agents]: [Codex: Custom instructions with AGENTS.md](https://developers.openai.com/codex/guides/agents-md)
[^codex-skills]: [Codex: Build skills](https://developers.openai.com/codex/skills)
[^codex-commands]: [Codex CLI slash commands](https://developers.openai.com/codex/cli/slash-commands)
[^codex-config]: [Codex configuration reference](https://developers.openai.com/codex/config-reference)
[^codex-subagents]: [Codex subagents](https://developers.openai.com/codex/subagents)
[^openai-compaction]: [OpenAI API: Compaction](https://developers.openai.com/api/docs/guides/compaction)
[^openai-cache]: [OpenAI API: Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)
[^openai-state]: [OpenAI API: Conversation state](https://developers.openai.com/api/docs/guides/conversation-state)
[^codex-memories]: [Codex local Memories](https://learn.chatgpt.com/docs/customization/memories.md)
[^claude-context]: [Claude Code: Explore the context window](https://code.claude.com/docs/en/context-window.md)
[^claude-memory]: [Claude Code: How Claude remembers your project](https://code.claude.com/docs/en/memory.md)
[^claude-skills]: [Claude Code: Extend Claude with skills](https://code.claude.com/docs/en/skills.md)
[^claude-mcp]: [Claude Code: Connect to tools via MCP](https://code.claude.com/docs/en/mcp.md)
[^claude-subagents]: [Claude Code: Create custom subagents](https://code.claude.com/docs/en/sub-agents.md)
[^claude-cache]: [Claude Code: Prompt caching](https://code.claude.com/docs/en/prompt-caching.md)
[^anthropic-engineering]: [Anthropic Engineering: Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
[^anthropic-context-editing]: [Anthropic API: Context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing.md)
[^project-context]: [父 Agent 上下文入口](../../demo/pi_task_local_self_harness.ts)
[^project-child]: [子 Agent 上下文控制](../../demo/pi_child_context_control.ts)
[^project-memory-pool]: [任务内 Memory pool](../../demo/pi_task_local_self_harness.ts)
[^project-arc]: [ARC 历史 frame 投影](../../demo/pi_arc_agi_3_extension.ts)
[^project-resource]: [任务资源分页读取](../../demo/pi_task_resource_store.ts)
[^project-telemetry]: [本工程 provider 遥测](../../demo/pi_provider_telemetry.ts)
[^project-backlog]: [本工程压缩后认知连续性待办](../deferred-research-todos.md)
