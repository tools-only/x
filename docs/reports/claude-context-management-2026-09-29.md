# Claude Code 上下文管理机制调研

调研日期：2026-09-29。范围：Anthropic 的 Claude Code 官方文档；以下是产品实现行为，不应直接推断为 Claude 模型或 Messages API 的通用能力。官方文档会随版本更新，尤其是技能重注入、子代理恢复和缓存策略。

## 核心结论

Claude Code 组合了五种机制：**可观察的上下文成本、按需载入的知识与工具、隔离的子代理工作区、可定向的压缩及自动兜底、稳定前缀的提示缓存**。它并不以单一自动摘要器解决所有问题。对本项目最有价值的是让父 Agent 和 Auto-Research child 自己看到代价、选择保留重点、在独立会话中探索，并通过可定位的原始资料恢复证据；运行时只负责测量、执行和边界保护。

## 具体机制

| 机制 | Claude Code 的公开行为 | 对本项目的启示 |
| --- | --- | --- |
| 成本可视化 | `/context` 给出当前上下文按类别的实时占用与优化建议，包括加载的指令和记忆；`/usage` 与状态栏可显示用量。 | `task_harness(context)`、`child_context` 的成本卡应可按需读取，给出主要来源、当前策略及下一次请求的变化；不要每轮推送完整报表。 |
| 分层知识 | 根目录 `CLAUDE.md` 在会话开始加载；子目录文件与路径规则在触及对应文件时加载；技能描述起初可见，技能正文调用时载入；支持文件按需读取。自动记忆只在启动时加载 `MEMORY.md` 前 200 行或 25 KB，主题文件按需读取。 | 常驻内容只放稳定的规则、任务状态索引与资源入口。详细规则、证据、轨迹、反证保存在可精确读取的资源中。技能正文进入会话后会持续占成本，应保持短小。 |
| 工具渐进发现 | MCP tool search 默认推迟完整工具定义，启动时只加载工具名称与服务器说明；模型需要时再查找工具。代理/提供商不支持 `tool_reference` 时可能退回预加载。 | 保持少量稳定的工具入口，以查询发现细节；但须先确认当前 Pi/provider 能否支持相应工具发现协议。动态改写工具定义会改变缓存前缀。 |
| 独立子代理 | 普通子代理有自己的 system prompt、工具和上下文，不继承父对话、已读文件或已调用技能；父代理收到委托结果，冗长读取留在子代理。可恢复的子代理保留历史；fork 则继承父对话。子代理可有独立持久记忆，自动压缩与父会话分别进行。 | Auto-Research topic 用独立、可恢复的会话 ID 与自己的 context/memory；父代理接收结构化结论和资源引用。不要把整个父对话复制到每个研究 topic；委托消息须带必要任务背景。 |
| 压缩与恢复 | 长会话接近窗口限制时自动压缩；用户也可 `/compact` 指明保留主题，或用 `/rewind` 选择某段摘要。压缩后系统提示、根级项目指令、自动记忆、磁盘计划等重新载入；历史对话被摘要。最近已修改文件最多重读五个；已调用技能在额度内重注入。 | Agent 可以在自然阶段提出定向压缩，但应把核心规则、通关条件假设、反证、当前策略和下一验证步骤结构化保留。完整原文引用必须可找回。自动兜底不等于认知无损，需做真实任务连续性评估。 |
| 提示缓存 | 每轮请求会带上 system、项目上下文及对话历史；缓存匹配**精确前缀**，通常只需处理新增尾部。Claude Code 把稳定的 system、项目上下文放在对话前。换模型、变更工具定义、压缩等会造成相应层级的缓存失效；技能调用作为会话消息追加，不改前缀。普通子代理有独立缓存，fork 可复用父前缀。 | 上下文 token 数、实际计算/费用、缓存命中是不同指标。应同时记录请求长度与缓存 read/create；避免为省少量 token 每轮改 system prompt 或工具定义。Pi/provider 是否有等价缓存必须实测。 |

上述行为分别见官方文档：[上下文窗口](https://code.claude.com/docs/en/context-window.md)、[记忆](https://code.claude.com/docs/en/memory.md)、[技能](https://code.claude.com/docs/en/skills.md)、[MCP 工具搜索](https://code.claude.com/docs/en/mcp.md)、[子代理](https://code.claude.com/docs/en/sub-agents.md)、[提示缓存](https://code.claude.com/docs/en/prompt-caching.md)。

## 容易误解的边界

1. **压缩不保证无损。** 官方表格列出哪些内容从磁盘重注入；普通历史、工具回执和先前 hook 上下文仍由摘要替代。把原始轨迹落盘与 Agent 保留关键认识是两个不同验收条件。[来源：上下文窗口](https://code.claude.com/docs/en/context-window.md#what-survives-compaction)
2. **缓存不缩短请求或上下文占用。** Claude Code 仍发送完整历史；缓存主要减少重复前缀的重新处理与计费。压缩会重建对话层缓存；工具定义或 system 层变化可能令后续前缀失效。[来源：提示缓存](https://code.claude.com/docs/en/prompt-caching.md#how-the-cache-is-organized)
3. **技能并非只付一次 token。** 调用后的正文留在对话历史，后续请求仍携带；同内容重复调用会得到已加载短提示，压缩后在预算内重新注入。详细参考资料应放支持文件，由 Agent 按需读。[来源：技能生命周期](https://code.claude.com/docs/en/skills.md#skill-content-lifecycle)
4. **普通子代理也可能有固定启动成本。** 自定义子代理默认会加载 `CLAUDE.md` 层级、项目规则和 Git 状态；可通过配置省略部分内容。Explore/Plan 有不同启动行为；fork 因继承父对话，不适合只想隔离高体量读取的场景。[来源：子代理启动上下文](https://code.claude.com/docs/en/sub-agents.md#what-loads-at-startup)
5. **用户/Agent 主导与自动兜底共存。** `/context`、定向 `/compact` 和 `/rewind` 提供决策入口，自动压缩仍会在窗口边界触发。窗口阈值和重注入细节有版本与模型差异。[来源：上下文窗口](https://code.claude.com/docs/en/context-window.md#when-your-context-fills-up)、[模型配置](https://code.claude.com/docs/en/model-config.md#context-window-and-auto-compaction)
6. **先保留信息，再追求精简。** Anthropic 工程团队建议在复杂 Agent 轨迹上先调高压缩的召回率，确保相关信息被保留，然后才逐步去掉冗余；它把较早的工具结果清理列为较轻的压缩形式，也明确警告过度压缩会丢掉后来才显出价值的细节。对 ARC，尚未判明的观察、规则反例和策略证据不应仅因年代较久就自动清除。[来源：Anthropic Engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
7. **MCP 大回执是落盘加引用，不是语义摘要。** Claude Code 在 MCP 输出超过 10,000 tokens 时警告；默认上限为 25,000 tokens。超限的纯文本结果写入会话 `tool-results` 目录，聊天中保留文件路径，可供之后读取。工具可声明自己的文本上限。[来源：MCP 输出限制](https://code.claude.com/docs/en/mcp.md#mcp-output-limits-and-warnings)
8. **Auto Memory 的索引也会收缩。** `MEMORY.md` 作为启动索引，详细内容放 topic 文件；接近 200 行/25 KB 的读取界限时，Claude Code 会提醒 Claude 合并或清除过时索引条目，超限写入会返回要求改写索引的错误。它是跨会话记忆管理，不是本轮工具输出自动压缩。[来源：Auto Memory](https://code.claude.com/docs/en/memory.md#auto-memory)
9. **Anthropic API 另有 context editing。** 可按阈值清理最旧工具结果，保留最近工具使用、排除指定工具，并设置最少清理量；API 清理会影响前缀缓存。另可配置旧 thinking block 清理。此处描述的是 Messages API，不能据此断言 Claude Code 使用了相同内部策略。[来源：Context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing.md)

## 面向 autoresearch-pi-project 的候选实践

这些是设计启示，并非 Claude Code 内部实现的断言，也不是本次调研授权的工程改动。

1. **建立 Agent 可调用的决策闭环。** 在父 Agent 与 child 的诊断入口呈现：当前请求来源、最大几个成本项、可逆操作、最近一次操作前后变化。Agent 选择 focus、精确读取、委托或定向压缩；运行时记录选择和效果，不替 Agent 猜测价值。
2. **让 Auto-Research topic 保持独立且可恢复。** 委托只传任务所需的状态与引用；每个 topic 可继续追踪竞争假设；向父 Agent 返回结论、证据引用、反证与待验证点。避免把完整 child 轨迹贴回父上下文。
3. **压缩前形成认知连续性清单。** 由 Agent 明确保存游戏规则假设、通关条件、竞争策略、反证、未完成实验和资源定位。压缩后让 Agent 用真实后续决策证明这些认识仍可用。`docs/deferred-research-todos.md` 的 D 项正涉及这项未完成验收。
4. **稳定前缀与按需内容并用。** 常用工具定义和极简任务规则保持稳定；大型工具说明、技能正文、历史证据按需加载。评估时同时看输入 token、缓存命中、正确率和目标进度，避免单纯追求短请求而损失能力。

## 官方来源

- [How Claude Code works](https://code.claude.com/docs/en/how-claude-code-works.md)
- [Explore the context window](https://code.claude.com/docs/en/context-window.md)
- [How Claude Code uses prompt caching](https://code.claude.com/docs/en/prompt-caching.md)
- [How Claude remembers your project](https://code.claude.com/docs/en/memory.md)
- [Extend Claude with skills](https://code.claude.com/docs/en/skills.md)
- [Create custom subagents](https://code.claude.com/docs/en/sub-agents.md)
- [Connect Claude Code to tools via MCP](https://code.claude.com/docs/en/mcp.md)
- [Manage costs effectively](https://code.claude.com/docs/en/costs.md)
- [Model configuration](https://code.claude.com/docs/en/model-config.md)
- [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
