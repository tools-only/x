# Pi 社区 memory / subagent / 会话投影机制：公开联网调研

调研日期：2026-10-07（Asia/Shanghai）。范围：Pi 公开社区项目本身；不使用本地工程实现来推断其能力。通过公开 GitHub Search API 实际搜索 `pi-memory coding agent`、`pi-mem coding agent`、`pi-memento` 等查询，再读取固定 commit 的 README、package.json 和关键源码。下文以源码优先；README 与源码不同处单列。只读调研，没有安装、运行这些扩展或做 provider 性能实验。

本文将“优秀”界定为解决明确上下文问题、具有具体实现和可解释取舍的设计，不将 star、作者描述或存在测试等同于效果证明。维护状态只表示公开默认分支最后提交日期，不保证维护承诺。固定 SHA 的内容才是本次机制结论的版本边界。

## 一、先区分五种机制

1. **持久记忆**：把可跨会话复用的事实写入文件，后续选择性注入或检索；文件存在不等于模型已经读取。
2. **工作进度记忆**：恢复“正在做什么、证据是什么、下一步是什么”，与长期事实分开；不能让多个 session 互相覆盖。
3. **有界常驻记忆**：将少量重要内容保留在每次模型请求中；付出重复输入及修改 prompt 前缀的成本。
4. **会话投影**：保留完整审计历史，但给模型另一种较小视图；区别于删除历史或回滚外部世界。
5. **subagent 上下文边界**：按角色选择 fresh/fork、skills、指令、tools、长期记忆，并控制返回主 agent 的文本量。子 agent 独立上下文不等于全系统成本下降。

## 二、案例 1：nicobailon/pi-memory-workbench——会话所有权 + 分层持久记忆

**定位与状态。** 真正 Pi extension。固定 SHA `92b4c9c3ad07841418d77118bf8bd02ad204f7c4`，最后提交 `2026-07-25T20:02:30Z`；package version `0.1.0`、`private: true`。README 明确尚无 npm release，可 GitHub 安装。公开测试是文件系统/模拟 Pi 边界检查，README 仍要求 live Pi interactive smoke，不能声称生产验证完成。

**它解决的具体问题。** 原始“所有 session 写同一个 progress.md”的做法会将并行 session 的续接状态覆盖；压缩以后，native summary 也可能缺少当下任务的恢复位置。该项目将 source of truth 按 session 隔离：

```text
~/.pi/agent/memory/<project>/
  sessions/<session-id>/progress.md  # 本会话恢复点
  sessions/<session-id>/todo.md      # 本会话任务状态
  progress.md                       # 生成 dashboard，非权威
  events/*.md                       # 不可变事件审计
  event-digests/*.md                 # 增量摘要，不删除 raw event
  memory.md                         # 精炼的长期项目事实
  dreams/*.md                       # 精炼操作审计
```

**注入—检索—写回链。** `before_agent_start` 返回隐藏 custom message（`display:false`），内容为 memory packet 和所有权提醒，**并非直接扩展 systemPrompt**。注入是有条件的：project/session 变化、有 todo，或 dream 非 fresh 时注入；不是无条件逐请求全部文件常驻。packet 包含 session resume（900 字符 clip）、最多五条待做/阻塞 todo、最近五个 event 简述；长期 memory 每个 active section 默认只取最近两条，条目文本 clip 180 字符。更深信息由 `memory_recall` 按需取回。

`memory_recall` 是有界、带来源路径的 Markdown 词项匹配/排序检索；不是向量检索。默认 8 hits，上限 20，query 上限 256 字符，单 snippet 上限约 1200 字符，精确 path expand 上限 30000 字符；可筛选 scope、kind、sessionId。多词查询要求至少两项命中，降低常见词误匹配。命中后模型通过返回的 path 扩展权威来源，构成“hot view → bounded recall → exact source”。

**与压缩的关系。** `session_before_compact` 保存当前状态和 branch；`session_compact` 使用 native summary、notable tools/files、retained tail **额外调用模型生成 focused checkpoint**，更新本 session progress/todo、追加 event，dashboard 仅 best effort。模型不可用或结构错误时进入 deterministic fallback；abort 时不写 checkpoint。确认 owner session 才可写，subagent/未知身份 session 只读并将值得持久化的信息交给 owner。近期 boomerang branch collapse 另有跳过规则以避免重复 handoff。

**长期精炼。** dream 将 session progress/todo、近期 events、最多三份 digest 等材料提炼入稳定 schema 的 `memory.md`；owner compaction 后仅过期时触发，阈值 24 小时；也可手动。固定源码 `createDream` 调用 `extractMemoryCandidates` 与 `applyDreamMemoryCandidates`，本函数没有模型调用；不要把“dream”名称解释为自动再运行一轮LLM反思。带稳定 ID、source citation、superseded 元数据；高风险变更进入 Deferred，不自动编辑 AGENTS.md、global memory、源文件和 raw events。digest 是附加摘要而非改写历史，旧 event 可继续追查。

**重要源码纠错。** README 说 dream 在 auto-continue 之前完成，但固定 SHA 的 `index.ts:452-454` 顺序是先 `maybeAutoContinueAfterCompaction`，再 `createDreamIfStale`；不把 README 的顺序承诺当真实执行顺序。

**为何值得借鉴。** 同一系统同时明确“谁拥有可变续接状态”“什么是长期事实”“什么只是 dashboard”“如何追查原始证据”。内存增长时用小 hot view，而非把全量 memory 注入。

**取舍与未验证项。** 组件/命令不少，session checkpoint 额外模型调用与 dream 增加 latency；文件和事件会持续增长，检索依赖词项，对语义改写的召回有限；写回质量依赖 source 信号及 checkpoint/精炼判断。现有源码只能证明机制存在，不能证明长期记忆更准确、任务更快或更便宜。当前 Pi 1.x 的 live compatibility 本次未执行。

**一手来源：**

- [固定 README](https://github.com/nicobailon/pi-memory-workbench/blob/92b4c9c3ad07841418d77118bf8bd02ad204f7c4/README.md)
- [事件/注入/压缩 index.ts](https://github.com/nicobailon/pi-memory-workbench/blob/92b4c9c3ad07841418d77118bf8bd02ad204f7c4/index.ts#L365)
- [packet 与 bounded hot view](https://github.com/nicobailon/pi-memory-workbench/blob/92b4c9c3ad07841418d77118bf8bd02ad204f7c4/memory.ts#L271)
- [Dream 实际调用链](https://github.com/nicobailon/pi-memory-workbench/blob/92b4c9c3ad07841418d77118bf8bd02ad204f7c4/memory.ts#L601)
- [检索 memory-recall.ts](https://github.com/nicobailon/pi-memory-workbench/blob/92b4c9c3ad07841418d77118bf8bd02ad204f7c4/memory-recall.ts#L46)
- [package 版本和 Pi peers](https://github.com/nicobailon/pi-memory-workbench/blob/92b4c9c3ad07841418d77118bf8bd02ad204f7c4/package.json)

## 三、案例 2：jo-inc/pi-mem——轻量 Markdown、近期日志、按需旧记忆

**定位与状态。** 真正 Pi extension，npm 身份 `@askjo/pi-mem`。固定 SHA `ffb706b8805d64e04919ceff4c82084a67504e5d`，最后提交 `2026-07-21T17:25:18Z`，package `1.2.0`。peer/import 仍为 `@mariozechner/pi-*`；当前 Pi 已迁移命名，不能仅凭 `*` peer range 宣称当前版本可用。

**布局和思路。** `MEMORY.md` 存精炼长期事实，`daily/YYYY-MM-DD.md` 存近期流水，`SCRATCHPAD.md` 是待办清单，`notes/*.md` 是按需参考。memory_write 可以 append/overwrite 长期、daily、note；memory_read、memory_search、scratchpad 负责查询和维护，写回主要靠 agent 选择调用，不是压缩自动写回完整摘要。

**实际注入。** 固定 SHA `index.ts:348-381` 在 `context` event 尾部增加一条 user message，封装为 `<pi-mem-injected>`。明确设计意图是保持稳定 system prompt，让可变 memory 放在 prompt 较后部分。每次请求重新构造 memory context，注入 configured context files、完整 MEMORY.md、今天及昨天 daily；notes 和更旧 daily 通过工具按需访问。`lib.ts` 还注入 catchup 日期目录的 INDEX.md：常态两天、低活动时扩展为七天，每天约 1024/2048 字符预算，总 catchup 8192 字符预算。变量叫 BYTES，但实际比较 JavaScript string.length，不能说严格 UTF-8 byte cap。

**必须纠正的三处宣传/文档差异。**

- GitHub repository description 提到 semantic search；README 的 tools 部分和源码 `index.ts` 明确是 case-insensitive substring；文件开头写 `No embeddings, no vector search`。本次将其描述为关键词/子串检索，不称语义向量检索。
- README 的 Context Injection 小节说 system prompt；源码已经改为 `context` 中的 trailing user message。
- README 说 open scratchpad 自动加载；源码注入提示明确 `Scratchpad is NOT auto-loaded`，`buildMemoryContext` 也没有 scratchpad 注入。scratchpad 须 memory_read 按需取。

**压缩前行为。** `session_before_compact` 只是 UI 提醒“consider persisting important context”；不负责强制保存、不生成强制 checkpoint。它能给有纪律的 agent 文件记忆工具，不能保证每次 compaction 前都将关键未保存事实提取。

**取舍。** 简单、可 git 追踪、零数据库、人工可编辑；把 volatile memory 放到尾部可避免修改较早 system prompt，但每次重复 MEMORY.md/daily 仍占 token，尾部时间戳/内容变化也不等于自动更高 cache hit。MEMORY 和 daily 主体在已读函数里无统一全局硬预算，长期增长会扩大常驻负担；多 session 共享文件的写冲突与事实污染也不应认为已解决。适合个人少量偏好和短近期记忆；大量历史须依赖清理与按需读取。

**一手来源：**

- [固定 README](https://github.com/jo-inc/pi-mem/blob/ffb706b8805d64e04919ceff4c82084a67504e5d/README.md)
- [真实 context 注入与 scratchpad 规则](https://github.com/jo-inc/pi-mem/blob/ffb706b8805d64e04919ceff4c82084a67504e5d/index.ts#L348)
- [实际 memoryContext 和 catchup 预算](https://github.com/jo-inc/pi-mem/blob/ffb706b8805d64e04919ceff4c82084a67504e5d/lib.ts#L411)
- [实际 substring search tool](https://github.com/jo-inc/pi-mem/blob/ffb706b8805d64e04919ceff4c82084a67504e5d/index.ts#L708)
- [package 身份/版本](https://github.com/jo-inc/pi-mem/blob/ffb706b8805d64e04919ceff4c82084a67504e5d/package.json)
- [作者原文](https://pradeep.md/2026/02/11/pi-mem.html)（本次仅确认 README 引用，未独立读取，机制不依赖该文）

## 四、案例 3：gordonbrander/pi-memory-blocks——Letta/MemGPT 式有限核心记忆

**定位与状态。** 真正 Pi extension，npm `@gordonb/pi-memory-blocks`，固定 SHA `cd3701ea6681d8d358c74565f2ca594a18050ad3`，最后提交 `2026-03-10T08:09:24Z`，package `0.3.0`。使用旧 `@mariozechner/pi-coding-agent` API 命名；未运行当前 Pi 兼容性测试。

**机制。** 每个块为 `<cwd>/.pi/memory-blocks/<key>.md`，frontmatter 有 description、limit。首次创建 user 与 agent 两块，各默认 2000 字符；自定义块由人创建。`before_agent_start` 读全部 blocks，追加到 systemPrompt。memory renderer 显示每块当前/上限字符数；`updateMemory(blockKey, oldText?, newText)` 提供精确文本替换或追加。只能更新已有 block，不能借 tool 任意创建新块。

**为什么有用。** 把“核心记忆一直可见”和“容量有限、要主动管理”合为一个清晰 API。agent 可替换过期事实而不是无限追加；用户偏好、角色定位、项目稳定约束适合这类小常驻层。它是 Letta 思路的 Pi 实现，**不是安装了完整 Letta 服务、也不含 Letta 全部 archival memory 能力**。

**关键限制。** 超额写入的行为是源码 `slice(0, limit)` 直接截掉尾部；有 truncated 回执，但没有自动事实级重排、摘要或“拒绝写入直到主动腾空间”。若只追加，很容易把最新信息截掉。每块限额不等于总 token 预算：人为无限新增 blocks 后，总注入量仍增长；字符也不等于 token。修改 blocks 每次改变 systemPrompt，可能损害前缀缓存，应结合任务/provider 测量。此项目不提供语义检索、冷记忆 paging、事件引用和并发 merge；别将它叙述为完整 memory 层级系统。

**一手来源：**

- [固定 README](https://github.com/gordonbrander/pi-memory-blocks/blob/cd3701ea6681d8d358c74565f2ca594a18050ad3/README.md)
- [注入与 updateMemory 源码](https://github.com/gordonbrander/pi-memory-blocks/blob/cd3701ea6681d8d358c74565f2ca594a18050ad3/src/index.ts#L175)
- [超限直接 truncate](https://github.com/gordonbrander/pi-memory-blocks/blob/cd3701ea6681d8d358c74565f2ca594a18050ad3/src/index.ts#L247)
- [package](https://github.com/gordonbrander/pi-memory-blocks/blob/cd3701ea6681d8d358c74565f2ca594a18050ad3/package.json)

## 五、案例 4：thebabush/pi-memento——在同一 agent 内按探索片段做上下文事务

**定位与状态。** Pi plugin/extension，实验性 v0.1，固定 SHA `1a879a3a5deb3e9c5437ed9251895856dc495d14`，最后提交 `2026-08-29T04:29:28Z`。明确 pin `@earendil-works/pi-coding-agent@0.84.3`；launcher 使用项目内独立 pin 的 Pi，不改变 global Pi。作者写明需要 contract tests 才能扩大兼容范围，因此不能把当前 1.x 当已支持。

**它的独特想法。** subagent 同时具有两种效果：分离 execution loop、隔离探索细节。memento 只取后者：当前 agent 在当前 loop 继续探索，事后决定该片段是否保留。这样对于“探索之后才知道是否有价值”的调研/调试，不必为了上下文效果额外启动一个执行进程。

**显式工具及四种关闭方式。**

| 工具/操作 | 模型以后看到什么 | 额外模型调用 |
|---|---|---|
| `transaction_begin({purpose?})` | 开始嵌套片段，LIFO | 否 |
| `transaction_end({disposition:'commit'})` | 完整保留片段 | 否 |
| `compact` | 扩展调用模型生成的摘要，可带 carryforward | 是 |
| `squash` | agent 自己写的 result，替换整段探索 | 否 |
| `revert` | 只留必填非空 carryforward 经验，移除探索本体 | 否 |
| `transaction_status()` | 当前 stack | 否 |

begin/end 必须为各自 assistant message 的唯一 tool call，防止边界夹杂并发调用；关闭的是最内层事务。无法在探索完成之后 retroactively 打开事务；要先 begin、之后按探索结果选 disposition。

**实现链。** begin/end 通过 `appendEntry` 追加 versioned metadata；`context` event 根据 canonical branch 与事务 replay 投影 model-visible messages；完整 JSONL 历史保留。`session_before_compact` 必須用相同投影压缩 durable prefix，调整 cut 避免切断事务，并把 open transactions 留在 retained tail。否则 native compactor 如果直接看 raw canonical history，会把已经 revert 的死路再次总结回来。边界不一致时 fail closed，取消压缩而不是 silently 回到 raw history。

**取舍。** 这是工作记忆管理，不是长期 MEMORY.md、跨会话知识库、检索或多 agent shared facts。revert **不撤销** 文件编辑、shell 命令、外部副作用；它不是沙箱。模型若选错 disposition 会失去还需要的细节；省 execution 不代表所有任务更快，begin/end 也新增工具调用与判断。不同投影/剪枝插件同时使用时必须检查 event 顺序和 native compaction 的一致性。本次未验证这些组合。

**一手来源：**

- [固定 README](https://github.com/thebabush/pi-memento/blob/1a879a3a5deb3e9c5437ed9251895856dc495d14/README.md)
- [工具实现和 metadata](https://github.com/thebabush/pi-memento/blob/1a879a3a5deb3e9c5437ed9251895856dc495d14/src/extension.ts)
- [model-visible projection](https://github.com/thebabush/pi-memento/blob/1a879a3a5deb3e9c5437ed9251895856dc495d14/src/project.ts)
- [transaction-aware Pi compaction](https://github.com/thebabush/pi-memento/blob/1a879a3a5deb3e9c5437ed9251895856dc495d14/src/pi-compaction.ts)
- [Pi contract、版本限制](https://github.com/thebabush/pi-memento/blob/1a879a3a5deb3e9c5437ed9251895856dc495d14/docs/pi-contract.md)
- [package pin](https://github.com/thebabush/pi-memento/blob/1a879a3a5deb3e9c5437ed9251895856dc495d14/package.json)

## 六、案例 5：nicobailon/pi-subagents——上下文不是一个 inherit 开关，而是一组独立边界

**定位与状态。** 真正 Pi subagent extension；固定 SHA `6a6675c971076ef3fc4a1ac443da938144f9a52b`，最后提交 `2026-10-07T01:56:54Z`，package `0.76.1`。README 安装身份 npm:pi-subagents；源包标 private 与 npm 交付流程并不应机械视为“无 release”。使用当前 `@earendil-works/pi-*` peers，pi-ai >=0.86.1。本次未跑其完整生命周期/当前 host 兼容实验，不承诺部署可直接成功。

### 6.1 角色 instructions、project/global context、skills、tools 各自可控

自定义 agent 默认 clean system prompt，不自动继承 Pi 完整 base prompt、repo/global instruction、discovered skills catalog。可显式设置：

| 控制项 | 含义 |
|---|---|
| `systemPromptMode: replace/append` | 专用角色 prompt，或追加 Pi base prompt |
| `inheritProjectContext` | 是否继承 AGENTS.md/CLAUDE.md 等 repo instructions |
| `inheritGlobalContext` | 是否继承用户 global context，默认 false |
| `inheritSkills` | 是否展示 Pi discovered skills catalog |
| `skills` / `skillPath` | 指定加载的 skills 与搜寻路径 |
| `tools` / `excludeTools` | 能力 allowlist 与排除项 |
| `extensions` / `subagentOnlyExtensions` | 为本角色加载工具 provider |
| `defaultReads` / `output` | 显式输入参考文件与输出文件 |

built-in agents 默认继承 repo instruction；global context 仍需 opt in。delegate 采用 append，worker 默认 fresh，oracle/advisor 默认 fork。角色 prompt 是选择信息与职责的边界，不等于更改 provider 的上下文窗口。

foreground child 是 parent 进程中的独立 Pi session，不加载 parent 的 ambient extensions，避免重复启动；background child 是 detached runner 内 session，可按配置加载 ambient extensions。因此同样 tools 名称必须有相应 provider 可达，allowlist 本身不安装 provider。当前版本还区分 built-in MCP 与 pi-mcp-adapter 的 direct MCP resolution；能力/环境继承应与文本继承分开评估。

### 6.2 fresh 与 fork

fresh 从新的会话开始，只拿角色、显式任务、输入文件、选择的 instructions/skills/tools/memory。优点是减少历史噪声和重复父上下文，适合窄任务、独立复核；风险是 parent 少给了关键约束。fork 则建立当前 parent leaf 的 branch session，适合第二意见与依赖历史讨论的任务；更大输入、旧假设和历史工具输出会跟着进入 child。

显式 fork 要求 persisted parent JSONL 与 current leaf，缺失时 fail；隐式默认 fork 只是 preference，parent 尚无可 branch 历史时直接 fresh。明确 fresh 始终优先。signed Anthropic thinking/redacted_thinking 从 fork 中剔除，因为签名属于原会话，child 按自己 thinking level 从新 turn 推理；不能把它解释为降低 thinking level。

### 6.3 可选 pruned fork：64 KiB 继承预算，有 sidecar 但尚无 child 回查 API

默认 fork mode full。`forkContext.mode:'pruned'` 在继承体超过源码拥有的 64 KiB session budget 后，用配置模型生成按 stable item id 索引的 JSON 摘要。优先 spill tool results，再老 assistant/tool context，必要时才 user text；预算内材料保留原样。正文只剩摘要和 `{batchId,itemId}` recovery ref；raw body、digest、source ids、size/tool metadata 留在 child session 旁 private 0600 sidecar。

**容易误写的边界：** docs 明确“此版本没有恢复命令，也不把 sidecar payload 暴露给 child 模型”。所以 ref 是可审计恢复标识，不等于已实现模型随时 paging 回原文。missing auth/model、摘要 JSON 不全、预算溢出、sidecar validation 失败时 launch 停止，不能默默 fallback full fork。64 KiB 是特定 serialized session budget，不是 64K token，也不能拿来与 provider 128K context window直接对比。

### 6.4 durable role memory

`memory:{scope:'project'|'user',path:'role-name'}` 与 parent/session memory 分开，namespace `agent-memory`。project 为 `<project>/.pi/agent-memory/<path>/MEMORY.md`，user 为 `~/.pi/agent/agent-memory/<path>/MEMORY.md`；标准 linked git worktree 指回 main checkout，让持续角色记忆免于 worktree 清理丢失。

docs 说每次 child run 注入前 200 行；源码还有 **16 KiB UTF-8 上限**。这是热 role memory，不是全历史检索。写工具可用的 role 被提示追加简短 dated reusable facts，禁止 full transcripts、one-off task details 和 secrets；只读 role 拿只读 block，不获得新增写能力。目录 lazy 创建、路径防 traversal/symlink escape；内容 delimitation 明确是参考数据而非可覆盖 prompt/task/developer constraints 的指令。

**注意：** 这只是安全路径和 bounded read/append 指令，不能据此宣称完整多 writer merge、冲突解决、事实验证和自动过期已具备。长文件只看前 200 行，尾部新信息可能需 role 主动整理。

### 6.5 回到 parent 的边界：artifact references，而不是只隐藏 UI

`outputMode:'file-only'` 保存结果，向 parent 返回路径、文件大小、行数，按需 read；failed/save-error 仍 inline 便于排错。`maxOutput:{bytes,lines}` 可设置 child final output cap；源码文档明确 child inline path **无默认 cap**。workflow Return/Emitted/Console 有默认 200KB/5000 行 cap，但别把这个当 child 的默认 cap。

workflow 可将中间结果保持为文件、JSON state 或结果对象，后续 child 只拿需要的信息；recurring child 可 persisted JSONL + resume，保持上下文连续性而无需永久 live process。retain/resume 保留 agent/model/tool contract，权限并不自动扩大。parent 仍要阅读核心结论、验证证据，large report 才外置。

FleetView、inlineToolDisplay、collapsed rich-result 等主要是 **TUI display**；docs 明确 `mainWindowRenderer` 不改 model-facing content。界面折叠不等于 token 压缩。此次当前固定版公开 tool-reference/schemas 未找到可证明的 output paging API，报告应讲 file-only +按需读取，不沿用未指定旧版本的分页说法。

### 6.6 schema 和指南可按需加载，也要顾及 provider 缓存

当模型支持中途添加工具时，新 parent 先暴露小 `subagents_enable` loader，下轮才加载完整 subagent schema；其他 provider/session 为缓存兼容可直接保持 full schema。agent definitions 默认不全量注入，使用 list/get/guide 获取局部知识；已装版本的 guide 读取自身 packaged docs。复杂度不自动授权 delegation；该规则与实际上下文机制都是此 extension 的当前版本设计，不必照搬所有调研场景。

**为何值得借鉴。** 把上下文来源、运行环境、能力、long-term role memory、parent 返回量拆成独立决策；针对不同职责保持不同历史，而非所有 workers 接收“父 prompt 全复制”。

**成本与边界。** fork 给每个 child 重复父输入；fresh 需要写好窄 task 与 handoff；pruned fork 额外模型调用并可能失真；role memory 常驻且需要整理；file-only 只是延迟读取，不是保证永远少读。只有比较 parent+child 总 cost、latency、cache read/write、结果正确性与管理轮次，才能判断净收益。

**一手来源：**

- [固定 README](https://github.com/nicobailon/pi-subagents/blob/6a6675c971076ef3fc4a1ac443da938144f9a52b/README.md)
- [prompt assembly、继承和 role memory](https://github.com/nicobailon/pi-subagents/blob/6a6675c971076ef3fc4a1ac443da938144f9a52b/docs/agents.md#prompt-assembly)
- [fresh/fork 与 file-only API](https://github.com/nicobailon/pi-subagents/blob/6a6675c971076ef3fc4a1ac443da938144f9a52b/docs/tool-reference.md#fork-context-details)
- [pruned fork 官方配置和恢复边界](https://github.com/nicobailon/pi-subagents/blob/6a6675c971076ef3fc4a1ac443da938144f9a52b/docs/configuration.md#forkcontext)
- [agent-memory 实际 200 行/16KiB 预算](https://github.com/nicobailon/pi-subagents/blob/6a6675c971076ef3fc4a1ac443da938144f9a52b/src/agents/agent-memory.ts#L21)
- [fork session creation 与 thinking sanitization](https://github.com/nicobailon/pi-subagents/blob/6a6675c971076ef3fc4a1ac443da938144f9a52b/src/shared/fork-context.ts#L164)
- [pruned-fork 源码](https://github.com/nicobailon/pi-subagents/blob/6a6675c971076ef3fc4a1ac443da938144f9a52b/src/shared/pruned-fork.ts)
- [child prompt runtime](https://github.com/nicobailon/pi-subagents/blob/6a6675c971076ef3fc4a1ac443da938144f9a52b/src/runs/shared/subagent-prompt-runtime.ts)
- [workflow 官方方案](https://github.com/nicobailon/pi-subagents/blob/6a6675c971076ef3fc4a1ac443da938144f9a52b/docs/workflows.md)
- [package](https://github.com/nicobailon/pi-subagents/blob/6a6675c971076ef3fc4a1ac443da938144f9a52b/package.json)

## 七、同名项目辨认：不要把不同 pi-memory 合成一个产品

| GitHub owner/repo | 实际包/身份 | 本次确认程度 |
|---|---|---|
| jo-inc/pi-mem | `@askjo/pi-mem`，Markdown long-term/daily/scratchpad，实际 substring search | README +关键源码已读 |
| tickernelz/pi-memory | `@zhafron/pi-memory`，IDENTITY.md/USER.md/MEMORY.md/daily，统一 memory tool | README +package已读，未核关键源码 |
| nicobailon/pi-memory-workbench | `pi-memory-workbench`，owner session/events/dream/hot view | README +关键源码已读 |
| gordonbrander/pi-memory-blocks | `@gordonb/pi-memory-blocks`，有限 user/agent blocks | README +关键源码已读 |
| thebabush/pi-memento | `pi-memento`，single-context nested transaction | README +关键源码已读 |
| waterdrop26651/pi-memento | 搜索结果为 research ledgers/controlled recall | 仅搜索发现，不纳入机制结论 |

tickernelz 固定 SHA `e3931a27bbd74ef144dcaa2810badffc3fc4a86c`，日期 `2026-02-18T15:03:56Z`，package `1.0.2`、dev Pi `^0.52.12`。README 声称 MEMORY/IDENTITY/USER 自动注入，daily 按需，通过 BOOTSTRAP 引导首次建立记忆；由于没有核其注入源码，**不能确定逐 session/逐 turn实际行为，也不能声称源码安全/兼容当前Pi**。附链接用于辨认，不列为同证据等级精选方案。

- [tickernelz 固定 README](https://github.com/tickernelz/pi-memory/blob/e3931a27bbd74ef144dcaa2810badffc3fc4a86c/README.md)
- [tickernelz package](https://github.com/tickernelz/pi-memory/blob/e3931a27bbd74ef144dcaa2810badffc3fc4a86c/package.json)

## 八、方案比较与可组合原则

| 机制 | 实际注入位置 | 主要预算 | 写回方式 | 冷信息取回 | 最适合 |
|---|---|---|---|---|---|
| pi-memory-workbench | 条件 before_agent_start hidden custom message | 分段 hot view、resume/todo/event clips | owner checkpoint +events +dream | bounded lexical recall →exact path | 多会话续接、可审计项目记忆 |
| jo-inc/pi-mem | context 尾部 user message | 近期窗口；catchup局部字符预算；MEMORY/daily无统一全局cap | agent memory_write/scratchpad | keyword search +read | 单用户轻量偏好、近期日志 |
| memory-blocks | before_agent_start systemPrompt | 每block默认2000字符，无总block cap | updateMemory精确替换/追加，超限截尾 | 无独立检索层 | 少量稳定核心记忆 |
| pi-memento | context 对话投影 | 事务片段；模型或agent决定保留表示 | metadata记录disposition，非长期事实存储 | 无检索；raw JSONL保留 | 死路较多的同agent探索 |
| pi-subagents role memory | child launch systemPrompt | 200行且16KiB | role agent已有编辑工具写入 | 无专用memory retrieval | recurring specialist累计经验 |
| pi-subagents fork | branch child session | full默认；pruned可选64KiB | child独立session | sidecar有审计ref但无child recovery API | 依赖父历史的第二意见 |
| pi-subagents file-only | parent tool result仅artifact reference | 可设置maxOutput，inline无默认cap | runtime输出artifact | parent/后续child按需read | 大报告、编排中间成果 |

可以把少量核心事实常驻、详细证据放外部文件、探索过程以投影清理、窄任务 fresh child、历史相关的专家 fork、parent 只接收结论+artifact references。这是从多个项目提炼的组合设计，**并非本次已经一起安装验证的发行套件**。同时安装多个 memory 扩展还可能重复 MEMORY.md 注入、碰撞 tool 名称、引入互相冲突的持久化策略；多个 context handlers 的顺序和压缩一致性也需实测。

## 九、后续评估应回答什么

若要评价某方案确实“优秀于默认配置”，应分别测量：关键事实 recall precision/recall、过时事实纠正、压缩后 task resume 成功率、来源可回查率、无关/恶意 memory 被错误提升为 instructions 的次数；再统计 parent+child 总 tokens、cache hit/read/write、额外 summarizer 调用、latency、额外管理 turns。负例至少包括：多会话并发写、全新或缺 session 的 fork、长memory超预算、新事实在文件尾部、摘要错误、缺API key、不同Pi版本，以及UI折叠但model context不变。现有调研支持机制设计比较，不支持“减少X%成本/提高Y%任务成功率”的数值结论。

## 附：本次公开原文快照

联网成功取得的源文本保存于 `_community_memory_evidence.json`（固定SHA、日期、README和file tree）与 `_community_memory_sources.json`（关键源码和docs）。它们只是公开上游数据缓存，不含本地工程实现或用户私有数据。最终给用户的HTML应保留上游永久URL和上述版本/未验证边界，不能将缓存位置当上游证据。
