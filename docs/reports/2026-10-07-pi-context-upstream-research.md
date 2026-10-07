# Pi 上游上下文管理：一手资料研究与版本边界

研究日期：2026-10-07（Asia/Shanghai）。本记录只研究、读取源码和保存资料，没有改动 runtime、安装组件、启动模型 benchmark 或发送邮件。作为最终 HTML 报告的上游事实依据；工程实现对比应以另行审阅的当前源码为准。

## 1. 核心结论与版本核实

Pi 值得借鉴的核心是把 **完整持久记录、当前分支、模型请求投影、按需资源、隔离研究会话** 分开管理，而不是把所有知识永久堆进 prompt。原生能力包括 JSONL session tree、compaction、branch summary、skill 渐进披露、内置工具截断及分页、扩展事件与 SDK 的 `transformContext`。长期知识选择、证据更新、精确恢复、子 Agent 编排则需要应用层或扩展提供。[P2–P11]

必须首先纠正版本假设：本工程当前 imports 使用 `@earendil-works`，不是旧称 `@mariozechner`。执行环境中实际可定位的 Pi CLI 为 `C:/nvm4w/nodejs/pi.ps1`；其 coding-agent 与嵌套 agent-core **均为 0.80.6**。根锁文件出现 coding-agent **0.87.0**，但项目根 `node_modules/@earendil-works` 只有 telemetry，未实际安装 coding-agent；也没有 `node_modules/@mariozechner`。因此根 lock 不能代替 runner 版本证据。[P1]

| 层次 | 2026-10-07 查到的事实 | 含义 |
|---|---|---|
| 根 `package.json` | 唯一直接 dependency 为 `pi-jev: 0.5.0` | 并未直接固定执行用 Pi CLI |
| 根 `package-lock.json` | coding-agent/ai/tui 为 `0.87.0`，coding-agent 依赖 core `^0.87.0` | 这是锁文件解析关系，不能声称实际已加载 |
| 根 `node_modules` | pi-jev `0.5.0`；coding-agent 两个 namespace 均缺失 | 不应用 `npm` 项目依赖位置推断运行版本 |
| PATH CLI 与 global 安装 | coding-agent/core `0.80.6` | 本报告默认阈值以该版本及已安装 dist 交叉核对 |
| 工程 runner | `arc_agi_3_e2e.py` 等从 node.exe 同目录的 `node_modules/@earendil-works/pi-coding-agent/dist/cli.js` 找入口 | 与以上 global 安装路径一致；特殊运行若覆盖配置仍需逐次记录 |
| 上游 tag | `v0.80.6` → commit `2b3fda9921b5590f285165287bd442a25817f17b` | 精确源码固定点，不依赖不断变化的 main |
| tag 日期与 npm 日期 | commit 2026-07-09 23:16:55 UTC；npm 2026-07-09 23:21:59 UTC | 官方 Git 数据与 registry 元数据，已读取 |

上游固定版本资料已保存于 `D:/autoresearch_pi_project/tmp/pi-context-upstream-v0.80.6/`。网络读取部分额外文档曾 TLS 超时或 `IncompleteRead`；报告只引用成功完整读取的 source/doc，或实际安装包自带文档，未用失败请求推断事实。0.87.0 的 npm 发布日期另核实为 2026-09-21 16:51:53 UTC，但没有把它的能力描述移植到实际 0.80.6 环境。

## 2. 建议采用的上下文分层

以下是基于 Pi 能力的**设计归纳，不是新的 Pi 内置 API**：

1. **稳定合同层**：权限、工具语义、预算、必要环境规则。短且稳定；每请求常驻有理由。
2. **任务工作集**：当前目标、最新 canonical observation、有效假设与反证、当前计划、必要失败、下一项可执行检查。随着任务推进更新。
3. **检索索引层**：skill/tool/subagent 名称、purpose、范围与精确定位。目录常驻必须有界。
4. **外部证据层**：完整工具返回、轨迹、source、研究线、候选与原始认识。保留在持久 store，通过精确 ref 或分页恢复。
5. **分支/研究会话层**：尝试与分析在独立上下文进行，以小结、结论与证据定位回交。

这五层回答不同问题：存盘解决可追溯，摘要解决当前容量，检索解决选择，隔离解决污染，反馈与证据管理解决过时知识。任何单一层都不能证明模型下一步已经理解或正确使用了知识。

## 3. Session tree：持久化完整历史，只发送当前分支

### 3.1 原生结构

Pi session 是 JSONL，每行一个 entry，通过 `id` 与 `parentId` 构成树。默认位置为 `~/.pi/agent/sessions/--<path>--/<timestamp>_<uuid>.jsonl`。同一文件可保存不同探索路径；模型上下文从当前 leaf 的 ancestor path 构建，不是将整个树展开给模型。[P2, P3]

这适合编码任务中的多种方案：保留 A 的尝试与失败，回到公共 ancestor 尝试 B；之后仍能检视 A，而 B 的请求无需重复 A 的全部对话。`/tree` 在原文件内导航；`/fork` 从较早 user message 建新文件；`/clone` 将当前 active branch 建成新文件；两者没有默认 branch summary。`--no-session` 只禁用持久会话，不是“没有上下文”。[P2]

`SessionManager.buildSessionContext()` 将当前分支的消息、最新 compaction 的 summary 与保留区重建成模型消息；plain `custom` entries 是扩展状态，默认不进入模型上下文；`custom_message` 是模型可见消息，两者不可混用。[P3, P10]

### 3.2 对 memory 的启示

Session log 可视为 episodic 记录，但它不是自动长期语义记忆库。完整保存旧对话，不表示旧对话仍 resident，也不表示会自动检索到；树中有 evidence 不表示当前模型知道其存在。好的应用层接口应返回“核心结论 + 精确来源 + 需要时如何读”的小回执，避免每次恢复重播整个 session。

一个重要边界：**分支对话不是环境回滚**。回到旧 message 或 fork 不会撤销已经执行的文件写入、外部动作、游戏 RESET 或真实环境状态。ARC 上尤其不能把 session tree 当作可重新获得生命、免费试错的 simulator。此项是对 Pi session 语义及本工程不可回退 ARC 历史约束的设计解释。

## 4. Compaction：增量摘要、近期尾部与协议完整性

### 4.1 真实默认值

0.80.6 原生默认：[P4, P5]

```json
{
  "compaction": {
    "enabled": true,
    "reserveTokens": 16384,
    "keepRecentTokens": 20000
  }
}
```

自动阈值为 `contextTokens > contextWindow - reserveTokens`，严格大于。`reserveTokens` 为生成留空间，`keepRecentTokens` 为选择保留近期消息的估算目标；两者不是同一个预算，也不是工具输出限制。设置可来自 global 或项目 settings；实际有效设置还受 launcher/SDK overrides 影响。

token 估算优先采用最后一个有效 assistant usage；跳过 error、aborted 与全零 usage；然后加上之后新增消息的估算。没有 usage 时用文本字符数 `/4`；图片每块估 4800 字符，即约 1200 token。**这是 heuristic，不是中文/图片/provider 精确 tokenizer**，不应将它作为真实成本测量；native 源码自身的“conservative”注释也不能保证对所有语言与图像实际保守。[P5]

### 4.2 过程和 cut point

1. 从尾向前累计消息估算，找到接近 `keepRecentTokens` 的合法 cut point。
2. 将较早消息摘要；保留较新原文。
3. 若已有 summary，将 previous summary 一并交给模型进行增量更新。
4. append `CompactionEntry(summary, firstKeptEntryId, tokensBefore, details)`。
5. 重建成 summary + 从 `firstKeptEntryId` 开始的原始消息 + 后续消息。[P4, P5]

原始 entry 没有因 compaction 被删除。第二次摘要从上次 kept boundary 开始，避免把上次保留的消息永久跳过。文件操作信息通过 details 累积。[P4, P5]

**工具调用与返回不可拆散**：允许在 user、assistant 及某些 user-like/custom 消息处切分，不能从 toolResult 起头；在有 toolCall 的 assistant 处切分时，后随结果一起保留。若一个 turn 特别长，允许在 assistant 处 split turn；历史 summary 与当前 turn prefix summary 合并。完整历史与 prefix 都存在时最多需要两次顺序摘要模型请求，这种压缩有 input/output、latency 与潜在推理成本。[P5]

### 4.3 摘要内容与真实丢失点

原生 checkpoint 模板包含 Goal、Constraints & Preferences、Progress（Done/In Progress/Blocked）、Key Decisions（理由）、Next Steps、Critical Context，以及 read-files/modified-files。这比只写“做过什么”更有利于跨轮连续性，但它是摘要 prompt，不是保真证明。[P4, P5]

需要明确四个限制：

| 限制 | 一手依据 | 影响 |
|---|---|---|
| 每条 tool result 摘要序列化只保留前 2000 字符 | `TOOL_RESULT_MAX_CHARS=2000` | 关键结论若藏在大结果尾部，摘要模型看不到 |
| user/toolResult 的图片块不进入文本序列化 | 只 filter `type === "text"` | 图形关系若未转为文本或精确 ref，不能依赖原生摘要恢复 |
| file tracking 只识别名称 read/write/edit 且有 path 的 toolCall | `extractFileOpsFromMessage` 的 switch | bash 写文件、自定义工具或远程 mutation 不自动获得完整操作清单 |
| 摘要由模型输出 | summarization provider 调用 | 可能丢失反证、置信度、未完成实验、推断和观察区别 |

以上均来自 [P6]，对 ARC、多模态与自定义工具特别相关。由此应将可验证关键状态、完整当前图像/网格、有效反证与精确证据引用作为独立恢复输入；不要把 native summary 当作唯一 canonical memory。

默认历史摘要 output ceiling 为 `min(floor(0.8 × reserveTokens), model.maxTokens)`；split prefix 为 `0.5 × reserveTokens` 再受模型 ceiling 限制。这不是固定“摘要 2000 token”：2000 是 tool result **字符**限制；branch summary 的 output cap 另为 2048 token。[P5, P7]

### 4.4 主动阈值与 overflow

Pi 将正常超过阈值后的 compaction 与 provider context overflow 区分。源码解释为：threshold 压缩不会自动重放已完成 turn；overflow 可删掉对应错误消息、压缩并重试，且 recovery 有一次 compact-and-retry 上限。`session_before_compact` 提供 reason 与 willRetry，使扩展可按差异行为处理。[P12]

不要将 **context overflow** 与 **provider output `length`** 混同。agent-core 遇到 `length` 的 message 所携带 toolCalls 时，默认让该批 calls 失败而不是执行可能截断的参数；没有完整 toolCall 的 output 截断也不保证自动继续文本。工程 child continuation 和验收因此需要自身真实路径验证。[P11]

## 5. Branch summary：交接被放弃分支的结论

切换 `/tree` 分支时，可选择不摘要、默认摘要、带自定义 focus 摘要。Pi 找 oldLeaf 与 target 的公共 ancestor，只收集离开的路径，按 tokenBudget 从最近内容优先纳入，调用模型生成 summary，附着在新的 navigation position，继续当前分支。[P2, P7]

这用于保留“方案 A 为何失败”“已排除哪个解释”，同时隔离 A 的长日志。默认 branch summarization input 预算为模型 contextWindow 减 reserveTokens（默认 16384），默认 maxTokens 为 2048；不是默认再 retain 20k 最近消息。[P7]

`branchWithSummary` 的实现先将 leaf 移到 branchFromId，再 append summary entry。某版 compaction.md 的 ASCII 图易让读者以为 summary 挂在 abandoned leaf，**应以 session-manager 实现与 sessions.md 的描述为准**，不要照图误解。[P3]

设计上应保留“被放弃”“被反驳”“暂未完成”状态，避免 summary 把一次失败的假设写成既定事实。分支 summary 本身不会产生独立实验，多个模型同意同一摘要也不构成环境证据。

## 6. Skills：常驻目录、按需正文、正文之外再按需引用

Pi 在启动时扫描 skill，提取 name/description/filePath，system prompt 以 `available_skills` XML 展示；模型通过 `read` 加载匹配的完整 `SKILL.md`，再通过相对路径读取 references/scripts/assets。这是原生 progressive disclosure。[P8]

收益主要来自：几十页手册只占目录几行，只有当前任务需要的 capability 正文 resident；详细 reference 甚至可以不与 SKILL 正文一起加载。`disable-model-invocation: true` 可将 skill 从自动目录排除，由用户 `/skill:name` 调用；没有 description 的 skill 不加载，同名碰撞保留先发现者并发 warning。[P8]

但应核查三个边界：

* **目录本身也有成本**：几百个 description 与路径仍每请求 resident；要减少不相关注册、过长 description 与重复用途。
* **模型不一定自主读取**：官方文档明确说明 models 不总这么做；“目录已暴露”不等于采用。
* **读过的正文进入工具返回历史**：progressive disclosure 不意味着读取后会自动卸载；后续移出 projection 或 compaction 仍有应用层策略。

Skill `allowed-tools` 的 experimental 元数据不应取代实际权限 allowlist 或子进程 capability ceiling。skill 是 workflow/procedural knowledge，memory 是任务认识/evidence；把创作手册存为长期任务记忆会制造不必要的 resident 程序负担。

适合本工程的归纳：creator 是按需 skill，组件目录只显示 purpose/location/version；task memory 存观察与认识；全文 creator、研究细节和旧 source 留在资源中，通过精确引用恢复。该段是建议，是否已经做到需当前工程 code audit。

## 7. Tools：同时控制 schema、调用结果和历史结果

工具造成三类不同成本：active 工具 schema 的每请求成本、刚返回的 payload、被反复带入的历史 payload。只压缩 output 不能解决巨大 schema，只隐藏 schema 不能解决旧结果。

### 7.1 原生 output limits

| 工具或阶段 | 已核实默认边界 | 恢复/缩小方式 |
|---|---|---|
| text `read` | 前 2000 行或 50 × 1024 bytes，先触发者 | `offset`（1-indexed）与 `limit`；返回 next offset |
| `bash` | 尾部 2000 行或 50 KiB | 大结果完整保存于 file，返回 fullOutputPath，再 read |
| `grep` | 100 matches 或 50 KiB；长 match line 到 500 chars | 缩小 pattern/path/context，增加有界 limit；读源文件 |
| custom tools | 官方要求开发者自己截断 | 使用 exported truncateHead/truncateTail；完整内容外存 |
| compaction tool serialization | 每条 result 前 2000 chars | 在原始回执前置结论/精确 ref；不是上述 read/bash 的 limit |
| official example parallel child return | 每 task 50 KiB | full results 保留 tool details；详情并非自动给模型检索接口 |

来源：[P6, P9, P10, P13]。这里的 50KB 官方描述实为 50 KiB；bytes/characters/lines/tokens 不可互换。第一行超过 `read` byte ceiling 时，read 不返回半行，给 fallback 提示；bash tail 有超长末行边界处理，不能笼统声称工具都不会部分截行。[P9]

### 7.2 动态 schema 与功能目录

`registerTool` 注册能力，`setActiveTools` 控制现在给模型哪些 tools；注册可以动态发生，同 session 不需要 reload。工具 snippet/guidelines 也只在 active 时参与 system prompt。[P10]

这支持 **小入口 → 查合同/启用 → 完整 schema**。有价值的应用设计是将多动作管理工具的复杂部分按需展现，而不是把一切字段一次性塞进 schema。但动态启用有额外一次模型决策/工具往返，还可能改变 provider prompt cache；不能因为 schema 字符减少就宣布总成本降低。`setActiveTools` 不是独立 security sandbox，实际执行校验仍须保持权限、参数、版本与预算完整性。

工具返回宜形成“小型有语义回执”：做了什么、核心结果、数据/版本范围、关键失败、是否 truncated、精确 artifact ref、读取方法。这比无标签的前 N 个字符更能帮助模型判断还需不需要付费读页。

## 8. Memory：Pi 原生边界与三种可实现方案

### 8.1 原生提供什么、不应代称什么

在已审阅 0.80.6 文档与 APIs 中，Pi 原生提供：session persistence、compaction/branch summary、context file（global、ancestor、cwd 的 AGENTS.md 或 CLAUDE.md 全文拼接）、custom entry 持久状态和 extension hooks。没有在这些一手资料中发现默认自动写入的 task memory store、向量检索式长期 memory 或自动抽取/遗忘/事实验证 pipeline。[P2, P3, P10, P14]

AGENTS.md 可承载人维护的稳定说明，但它始终拼入 prompt，不能当作免成本长记忆。`appendEntry` 是隐藏持久状态；`sendMessage` 是模型可见消息；前者不会自动让 Agent 知道，后者会消耗上下文。应用要明确“保存 → 索引 → 选择 → 暴露 → 使用 → 更新/撤销”。

### 8.2 Memory 方案 A：简短文件索引 + 按需正文（推荐先复用）

在 task-local 范围保存主题化 note，仅给模型简短目录与当前任务高相关条目；完整内容通过 ref/read 恢复。每个条目可以带来源范围、版本、事实/假设区别、反证与 replacement ref，但不要为了规范增加无必要管理字段。

适用于中小知识量、已有精确 resource store 的项目。优点是可审计、不需 embedding 服务、能针对性读取；成本是检索决策与读页；负例是索引无限增长、同义重复、旧 memory 未失效。与当前工程的版本池/装配/focus 接口应先考虑复用，而不是另建 memory worker。

### 8.3 Memory 方案 B：scope/version-aware 检索（候选，不是原生）

为大量研究轨迹建立全文或语义检索，先做 task/worker/permission/environment/version 过滤，再做 lexical/semantic 排序，返回有限 evidence snippets 与 exact refs。检索以可能帮助当前决策的证据为目标，不以“多找几个相关段落”为目标。

它有 embedding/index/update 成本，也有错检与沉默漏检；semantic similarity 不证明证据有效、事实未过时、权限允许或解决当前任务。对代码路径/错误文字/精确 observation，lexical lookup 常更确定，宜先评估已有 ref/全文接口能否满足。没有证据表明当前工程已具备这种自动 RAG，本项仅为未来候选。

### 8.4 Memory 方案 C：角色私有长期记忆（community 已有实现描述）

社区 `nicobailon/pi-subagents` docs 提供 `memory: { scope: project, path: ... }`。每次 child run 读取其 `MEMORY.md` 前 **200 行**，注入该 child system prompt；项目 scope 位于 `<project>/.pi/agent-memory/<path>`，用户 scope 位于 `~/.pi/agent/agent-memory/<path>`。拥有 write/edit/bash 的角色可追加有日期笔记，readonly 角色仅得到 readonly memory block；目录不是预先建好，而是首次写入产生。[C1]

这比把 reviewer/scout 各自所有经验交给父更合理，但 200 行不是 token cap，超长行仍可能膨胀；固定前缀注入也会携带无关或过时知识。父 memory、role memory、task memory、global memory 的 scope 应明确，持续研究主题不能靠永不退出的模型进程保存。

社区 README 自称其 namespace 独立于 Pi 自身 memory 系统，这个措辞不应倒推实际 0.80.6 存在新的原生 memory 产品。社区 main 与实际 Pi 环境版本不同，需兼容性验证。

## 9. Extensions/SDK：非破坏投影与“存盘不等于可见”

### 9.1 官方扩展点

| 扩展点 | 能力 | 适合解决的问题 | 主要代价/风险 |
|---|---|---|---|
| `before_agent_start` | 改当轮 system prompt，inject message | 短任务工作集/overlay | 每轮重建成本，重复提示，provider cache 变化 |
| `context` | 每次 LLM call 前得到 messages 深拷贝，非破坏性修改 | 旧 observation 替换、去重、恢复 refs | hook 顺序与 lease，删除 protocol pairs 的风险 |
| SDK `transformContext` | AgentMessage[] 先变换，再 convertToLlm | 编程式投影/过滤 | app 必须保证 custom 类型与协议有效 |
| `before_provider_request` | provider payload 完成后检查/替换 | 最终请求预算/诊断 | getSystemPrompt 不等于最终 payload，provider-specific 差异 |
| `session_before_compact` | cancel 或自定义 summary/details | 有结构的认识保存与必要 artifact 恢复 | 新摘要模型成本、摘要错误 |
| `session_before_tree` | cancel 导航/自定义 branch summary | 探索交接 | 把失败当成功的 summary 风险 |
| `appendEntry` + `session_start` | 持久扩展状态并重建 | schema state、receipt、index | 数据不会自动出现在 LLM context |

来源：[P10, P11]。

### 9.2 一个可靠的应用模式

`canonical store → 提取当前合法工作集 → 注入当前请求 → 记录最终 provider payload → 下一轮验证决策`。

例如最新 ARC grid/PNG 与 canonical frame 存在环境记录；历史大型工具结果保存在资源；当前请求只恢复当前完整 observation、有效决策和仍有租期的 evidence pages。这种模式可以避免“摘要失去图像后反复读当前图”“已读页下一工具轮就被删”等问题。但存档存在、读页成功、ref 有效只是 data reachability；后续模型有没有保留假设、反证、未完实验与决策理由，仍要检查真实 provider 输入与行动。

非破坏投影尤其值得借鉴：history/store 留存，projection 可以变小；不能为了较小请求删掉唯一证据或把模型 reasoning/signature 任意改写。permission/budget/version/environment 检查仍需保留。本文没有运行 provider 实验验证这些方案净收益。

## 10. Subagents：隔离探索，只回交高价值结论

### 10.1 官方示例是扩展，不是默认核心功能

0.80.6 README 明确默认不含 sub-agents；官方 `examples/extensions/subagent` 是可安装示例。每次 invocation 启新 Pi process，传 task、可选 model/tools/system prompt，以 JSON mode 收集消息；没有把父会话 transcript 自动复制给 child。[P13, P14]

示例支持 single、parallel（最多 8 tasks、4 并发）和 chain（`{previous}` 接前步骤 final output）。scout 模板要求精确文件行范围、关键代码、架构、Start Here，服务于“接收者没看过原文件”的交接。父得到 final output，而非每条 child tool log 全文；parallel per-task output 有 50 KiB cap，details 留完整结果。[P13]

**隔离边界要精确**：新进程隔离模型 transcript，不自动隔离共享文件、环境变量、网络、host 权限或全局资源。示例启动参数是 `--mode json -p --no-session` 加 model/tools/append-system-prompt，并没有默认 `--no-skills`、`--no-context-files`、`--no-extensions`。若工程必须避免 gameplay child 收到开发 AGENTS.md，需要 scoped launcher/resource 配置，而不能说“新进程所以已解决”。

工具 allowlist 未包含 bash/write 也不自动代表整个扩展进程 sandbox；官方安全描述同样指出 extension 有 host full system permission。实际只读研究应由 adapter/broker/工具执行边界保证。

### 10.2 社区更细粒度上下文策略

社区 `pi-subagents` 的当前文档提供：[C1, C2]

* custom agent 默认 clean system prompt，显式选择 `inheritProjectContext`、`inheritGlobalContext`（默认 false）、`inheritSkills`、具体 skills/skillsPath；builtin agents 可能有自己的继承默认，不能套用 custom 默认。
* `defaultContext: fresh | fork`：独立工作集或父路径分支。显式 fork 需要真实 session/leaf；implicit fork 不可用时 fallback fresh。
* foreground child 是同进程独立 session；background child 在 detached runner 里运行。**不是所有 child 都开单独进程**；逻辑 session 隔离与 OS 隔离需区分。
* foreground 不重载 ambient parent extensions，background 根据配置继承；provider 可从父已注册配置继承；skills 与 private skillPath 可单独控制。
* parent 可先仅看到小 `subagents_enable` loader，再按授权启用完整 subagent schema；对不能中途加工具的模型保留初始 active schema 以避免 cache 失效。这个 provider-sensitive 取舍比“一律延迟披露”更实际。
* 角色专属 memory、run artifacts、session inspection 支持持续主题与 bounded execution 分离。

资料固定到读取时 main SHA `6a6675c971076ef3fc4a1ac443da938144f9a52b`；registry 在读取时的 latest 为 `0.76.1`。**未安装、未审阅完整源码、未测兼容 0.80.6**，不得描述为本工程现有能力或直接迁入的可用补丁。社区 doc 还有 Pi ≥0.99 功能，恰好说明跨版本推断不可行。

### 10.3 可借鉴的职责与交接设计

父承担当前行动选择；research worker 承担长文读取、证据跟踪、反例搜索和后台分析；child 回交立即有用的结论、置信度/条件、反证、精确证据 refs、仍需父决策的请求；长分析留在线/worker store。不要每收到 observation window 就必开新 worker；研究线连续性是持久 topic/assignment，不等于永久模型进程。

合理 launch recipe 包含 task purpose、授权 observation scope、需要的数据/反证、交付格式与预算。若独立复核价值重要，可不提供父先入结论；若 child 负责延续父计划，则传递决策理由与未完成实验。盲审/揭盲是研究方案，不是默认多 Agent 共识规则。

subagent 只能在减轻父负担或获得新的可用证据时有净收益：父启动/管理轮、child 启动与模型 input/output、重复读取、交接与修订都要计入。把父 history 整体 fork 到每 child 会复制 input；把所有 child transcript 复制回父会撤销隔离收益；只返回短结论但没有证据也会失去可验证性。

## 11. 本工程对比时必须保留的边界

| 要对比的对象 | Pi 上游原生或示例基线 | 工程应审阅的实际扩展入口 | 不能从上游推断的事项 |
|---|---|---|---|
| provider 历史 | native compaction + selected branch | `demo/pi_task_local_context_lifecycle.ts` | 工程字符阈值、租期与归档不是 native token阈值 |
| parent observation | 原生 read images/历史消息 | `demo/pi_arc_context_projection.ts`、parent context control | 每轮 canonical grid/PNG 是否恢复 |
| memory | session/context files/custom state | `demo/pi_task_local_self_harness.ts`、memory resource/version/focus | 工程 task-local memory 的真实性、失效规则、具体常驻 |
| skills | name/description/location → read | native skill exposure、creator、task-local skills | 创建/装配/暴露不等于后轮实际使用 |
| tools | active full schema + builtin truncation | management schema surface、task-local tools、resource store | dynamic schema 的实际 token、cache和管理轮净收益 |
| subagents | 官方 subprocess example | `demo/pi_task_local_subagents.ts`、`src/autoresearch_pi/subagent_broker.py` | readonly、action lease、ref权限、provider length continuation |
| Auto-Research | Pi 没有同名原生机制 | external benchmark research、durable assignment/scheduler | research line、window、worker、run 必须分别描述 |
| 恢复与验证 | store留存与summary | request admission、provider telemetry、native smoke | fixture或script不能证明ARC全链路或自主采用 |

仅因入口名称相似不能判断采用上游同一策略。本子报告只给源码研究入口，不作为工程完成或闭环结论。

## 12. 评估方案与未完成项

本工程 deferred-research-todos 中 B（离线研究可观测目的）、C（父子通信与在线实验）、D（压缩后认知连续性）直接关联本次研究；截至 2026-10-07 的记录仍开放。本报告不会将文献说明或 docs 对齐算作这些问题完成。[E1]

未来比较应以一次窄变量为主，如“相同 canonical observation、模型和预算下，核心结论+exact ref 的 child return 是否减少父重复取证且保持任务进展”。预定义负例：尾部关键证据、旧假设与新反证冲突、分页需跨工具轮、fork input 过大、child失败/length、版本/范围过时、合理不使用。

测量至少包括父+所有 child input/output/reasoning/cache/cost、启动与provider耗时、墙钟并发、管理轮、读取恢复轮、真实有效行动、失败/取消/未完成片段。system/schema/history/图像均应区分；JSON chars、base64 bytes 与 provider tokens 不能混算；provider未报告部分保持 unknown。

| 证据层 | 本报告状态 | 能声明的范围 |
|---|---|---|
| 功能正确 | 文档/源码核对；本次未执行组件功能测试 | 精确版本下已核实的代码与API定义，不是完整正确性验收 |
| 全链路可达 | 未验证 | 没有新跑 ARC bridge/Pi/child/router/native mutation/action/后续父轮 |
| 自主采用 | 未验证 | 没有真实 provider 普通任务采用实验 |
| 净收益 | 未验证 | 没有父子总成本与任务质量的独立重复对照 |

建议先审阅已有真实故障定位到 recognition/selection/assembly/use/feedback 哪个 transition，优先复用 store、schema disclosure、worker assignment 和 existing hooks；新增提醒/必读字段/worker 之前比较删重与简化。这保持 `docs/development-workflow.md` 的 evidence standard，不引入 Pi gameplay context。

## 13. 一手引用索引（版本与本地定位）

本地 `upstream` 前缀均指 `D:/autoresearch_pi_project/tmp/pi-context-upstream-v0.80.6/`；`installed` 前缀指 `C:/nvm4w/nodejs/node_modules/@earendil-works/pi-coding-agent/`。成功获取的 raw source 为固定 `v0.80.6`，可在下方官方 GitHub URL 按行核对。

* **P1 环境版本**：`D:/autoresearch_pi_project/package.json:5`；`package-lock.json:408`；`installed/package.json:3`；`installed/node_modules/@earendil-works/pi-agent-core/package.json:3`；`src/autoresearch_pi/arc_agi_3_e2e.py:1560`。官方 tag [Git ref](https://api.github.com/repos/earendil-works/pi/git/ref/tags/v0.80.6)、[commit](https://api.github.com/repos/earendil-works/pi/git/commits/2b3fda9921b5590f285165287bd442a25817f17b)、[npm metadata](https://registry.npmjs.org/@earendil-works/pi-coding-agent)。读取日期 2026-10-07。
* **P2 sessions**：[sessions.md v0.80.6](https://github.com/earendil-works/pi/blob/v0.80.6/packages/coding-agent/docs/sessions.md)。本地 `installed/docs/sessions.md:7`（存储）、`:73`（树）、`:123`（tree/fork/clone）、`:133`（summary）。
* **P3 tree/context构建**：[session-manager.ts](https://github.com/earendil-works/pi/blob/v0.80.6/packages/coding-agent/src/core/session-manager.ts#L377)。本地 `upstream/packages/coding-agent/src/core/session-manager.ts:377`（entry→context）、`:411`（compaction重建）、`:457`（buildSessionContext）、`:1189`（getBranch）、`:1310`（branchWithSummary）；`installed/docs/session-format.md:3`（JSONL树）。
* **P4 compaction官方说明**：[compaction.md](https://github.com/earendil-works/pi/blob/v0.80.6/packages/coding-agent/docs/compaction.md#L27)。本地 `upstream/packages/coding-agent/docs/compaction.md:27`（trigger）、`:79`（迭代）、`:109`（cut）、`:215`（模板）。
* **P5 compaction实现**：[compaction.ts](https://github.com/earendil-works/pi/blob/v0.80.6/packages/coding-agent/src/core/compaction/compaction.ts#L106)。本地 `upstream/packages/coding-agent/src/core/compaction/compaction.ts:106`（默认）、`:176`（估算）、`:209`（阈值）、`:219`（图片heuristic）、`:325`（cut pair）、`:376`（findCutPoint）、`:654`（上次boundary）、`:549`（summarycap）、`:767`（split两调用）。已安装 `dist/core/compaction/compaction.js:137`、`:142` 及 `dist/core/settings-manager.js:521`/`:524` 交叉核对。
* **P6 序列化与file tracking**：[utils.ts](https://github.com/earendil-works/pi/blob/v0.80.6/packages/coding-agent/src/core/compaction/utils.ts#L29)。本地 `upstream/packages/coding-agent/src/core/compaction/utils.ts:29`（操作识别）、`:89`（2000 chars）、`:109`（text serialization）；已安装 `dist/core/compaction/utils.js:74` 同为2000。
* **P7 branch summary实现**：[branch-summarization.ts](https://github.com/earendil-works/pi/blob/v0.80.6/packages/coding-agent/src/core/compaction/branch-summarization.ts#L93)。本地 `upstream/packages/coding-agent/src/core/compaction/branch-summarization.ts:93`（commonancestor）、`:189`（预算选择）、`:299`（reserve）、`:305`（inputbudget）、`:341`（2048输出）。
* **P8 skill**：[skills.md](https://github.com/earendil-works/pi/blob/v0.80.6/packages/coding-agent/docs/skills.md#L64)、[skills.ts](https://github.com/earendil-works/pi/blob/v0.80.6/packages/coding-agent/src/core/skills.ts#L335)。本地 `upstream/packages/coding-agent/docs/skills.md:64`（progressive）、`:149`（隐藏）；`src/core/skills.ts:335`（目录XML）。
* **P9 tool limits**：[truncate.ts](https://github.com/earendil-works/pi/blob/v0.80.6/packages/coding-agent/src/core/tools/truncate.ts#L12)、[read.ts](https://github.com/earendil-works/pi/blob/v0.80.6/packages/coding-agent/src/core/tools/read.ts#L212)、[bash.ts](https://github.com/earendil-works/pi/blob/v0.80.6/packages/coding-agent/src/core/tools/bash.ts)、[grep.ts](https://github.com/earendil-works/pi/blob/v0.80.6/packages/coding-agent/src/core/tools/grep.ts)。本地 `upstream/packages/coding-agent/src/core/tools/truncate.ts:12`；`read.ts:212`/`:270`；已安装 `dist/core/tools/grep.js:20`/`:77`；`dist/core/tools/bash.js:274`。
* **P10 extensions**：[extensions.md](https://github.com/earendil-works/pi/blob/v0.80.6/packages/coding-agent/docs/extensions.md#L513)。本地 `upstream/packages/coding-agent/docs/extensions.md:513`（prompt）、`:645`（context copy）、`:670`（providerpayload）、`:1327`（register）、`:1378`（sendMessage）、`:1429`（appendEntry）、`:1614`（active）、`:2039`（custom truncation责任）。
* **P11 agent-core**：[agent-loop.ts](https://github.com/earendil-works/pi/blob/v0.80.6/packages/agent/src/agent-loop.ts#L207)。本地 `upstream/packages/agent/src/agent-loop.ts:207`（length fail toolCalls）、`:289`（transform then convert）；已安装 core `dist/agent-loop.js:180`（同一transform顺序）。
* **P12 overflow/threshold**：[agent-session.ts](https://github.com/earendil-works/pi/blob/v0.80.6/packages/coding-agent/src/core/agent-session.ts#L1894)。本地 `upstream/packages/coding-agent/src/core/agent-session.ts:1894`/`:1937`/`:1986`。
* **P13 官方subagent扩展示例**：[README](https://github.com/earendil-works/pi/blob/v0.80.6/packages/coding-agent/examples/extensions/subagent/README.md)、[index.ts](https://github.com/earendil-works/pi/blob/v0.80.6/packages/coding-agent/examples/extensions/subagent/index.ts#L294)、[scout.md](https://github.com/earendil-works/pi/blob/v0.80.6/packages/coding-agent/examples/extensions/subagent/agents/scout.md)。本地 `upstream/packages/coding-agent/examples/extensions/subagent/index.ts:33`（8/4）、`:192`（cap）、`:294`（启动args）、`:532`（chain）；`agents/scout.md:9`（未见原文件的交接）。
* **P14 默认能力/contextfiles**：[README v0.80.6](https://github.com/earendil-works/pi/blob/v0.80.6/packages/coding-agent/README.md#L316)、[resource-loader.ts](https://github.com/earendil-works/pi/blob/v0.80.6/packages/coding-agent/src/core/resource-loader.ts#L85)。本地 `installed/README.md:316`（AGENTS拼接）、`:493`（no subagents）；`upstream/packages/coding-agent/src/core/resource-loader.ts:85`（global+ancestor读取）。
* **C1 社区上下文/私有memory**：[pi-subagents agents.md 读取时commit](https://github.com/nicobailon/pi-subagents/blob/6a6675c971076ef3fc4a1ac443da938144f9a52b/docs/agents.md#L337)。本地 `upstream/community/docs/agents.md:337`（promptassembly）、`:448`（memory）、`:462`（200行）、`:511`（foreground/background）。读取2026-10-07，社区main快照，不声称与npm release逐文件一致。
* **C2 社区概览与延迟tool loader**：[README 读取时commit](https://github.com/nicobailon/pi-subagents/blob/6a6675c971076ef3fc4a1ac443da938144f9a52b/README.md#L38)、[npm latest元数据](https://registry.npmjs.org/pi-subagents/latest)。本地 `upstream/community-pi-subagents-README.md:38`；元数据 `upstream/subagents-metadata.json`。未安装、未运行。
* **E1 工程证据约束**：[development-workflow.md](../development-workflow.md)、[deferred-research-todos.md](../deferred-research-todos.md)。这是工程流程与未完成问题记录，不是 Pi 原生能力证据；不得注入 gameplay context。

