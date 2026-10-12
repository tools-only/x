# Harness 组件对照：Pi 2000 约束、tools / skills / subagents

日期：2026-10-12（Asia/Shanghai）。范围：**只读**对照报告；除本文件外未改代码。证据来自本仓库钉死的 Pi **0.87.0** 源码与文档、既有调研报告、thin 扩展源码，以及公开的 Prime Agent / Continual Harness / Pi 社区扩展材料（URL 见文末）。

---

## 1. Pi `TOOL_RESULT_MAX_CHARS ≈ 2000`：机制、作用面、动机、我们的绕过

### 1.1 机制（事实）

常量定义在 Pi coding-agent 压缩工具链里，不是 ARC 适配层写的：

- 源码：`node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/utils.js`（约 L75–L131）
  - `const TOOL_RESULT_MAX_CHARS = 2000;`
  - `serializeConversation()` 在把 `toolResult` 编成 summarizer 输入时调用 `truncateForSummary(content, TOOL_RESULT_MAX_CHARS)`；超出部分变成 `[... N more characters truncated]`。
- 文档：同包 `docs/compaction.md`「Message Serialization」一节写明：Tool results are truncated to **2000 characters** during serialization，动机是 *keep summarization requests within reasonable token budgets*；并注明 `read` / `bash` 类结果通常是上下文最大贡献者。
- **没有**对外 settings 开关可抬高或关闭该常量（与 `compaction.reserveTokens` / `keepRecentTokens` 不同）。要改只能改包源码或打补丁。

相关上游文档镜像：`docs/reports/pi-native-online-sources/packages__coding-agent__docs__compaction.md`；社区归纳见 `docs/reports/2026-10-07-pi-community-compaction-online.md`。

### 1.2 作用面：只打 summarizer 输入，不改写普通 turn 的会话投影

| 路径 | 是否受 Pi 2000 约束 | 说明 |
| --- | --- | --- |
| 普通模型请求（assistant 下一轮看到的 `toolResult`） | **否** | 2000 只发生在 `serializeConversation` → summarizer；会话 JSONL / 投影里的原文仍可完整存在 |
| `/compact`、阈值触发、overflow 恢复的摘要 LLM 输入 | **是** | 每条 tool result 在喂给摘要模型前被截到 2000 字符 |
| Branch summarization | **是**（同一 utils） | `docs/compaction.md`：compaction 与 branch summarization 共用序列化工具 |

因此：**打开 auto-compaction ≠ 日常工具结果被 Pi 截断**；只有压缩/分支摘要那次「旁路 LLM 调用」吃截断后的文本。

### 1.3 设计动机（Pi 文档原意）

1. 控制**摘要请求**的 token 预算（摘要本身也要进模型窗口）。
2. 假定「摘要不需要全文」——对 coding-agent 的 `read`/`bash` 大输出往往成立；对 ARC 里「决定性反证写在长回执尾部」**不成立**。

### 1.4 探针证据（本仓库）

`docs/reports/2026-10-12-pi-compaction-probe.md`（修前）：

- V2：故意把反证放在 10k 字符回执的 **第 2000 字符之后** → 该标记既不进 serialized summary input，也不进下一轮普通请求。
- V1/V2 各有 **18** 条 tool result 被 serializer 裁切。
- 修后（Phase 3c）：同探针 V1–V5 的 `clippedResults=0`，反证可进下一轮（在收据+artifact 路径下）。

终稿计划：`docs/plans/2026-10-12-pi-compaction-plan-final.md` §Phase 3c。

### 1.5 我们 thin 侧的多层「结果大小」治理（勿与 Pi 2000 混为一谈）

`demo/arc_thin_extension.ts`（当前工作区）：

| 层 | 常量 / 行为 | 作用面 |
| --- | --- | --- |
| 决策内投影 | `TOOL_RESULT_CHARS = 4000`（`truncateToolResult`） | `context` hook 投影**当前决策内** toolResult 时截断 |
| Session continuity 历史 | `HISTORY_RESULT_CHARS = 400` | 保留的前几决策里，旧 toolResult 只留收据式短文 |
| Skill 运行展示 | `SKILL_RESULT_CHARS` 预览截断 | `run_skill` 回给模型的展示长度 |
| **Phase 3c 收据**（仅 `--continuity session`） | `session_before_compact`：原文 >1800 则写 `harness/compaction-receipts/<sha256>.txt`，把 summarizer 可见正文换成「header + sha256 + artifact 路径 + 节选」 | **专打 Pi 2000**：在原生序列化前改写 `messagesToSummarize` 的 toolResult 正文；原文落盘可回查 |
| 遥测 | `harness/compaction_receipts.jsonl` | 记录 original_chars / replacement_chars / coverage |

**结论：** 当前策略是「维持 Pi 硬编码 2000，靠收据+artifact 绕过证据丢失」——与会话中确认的「先维持现状，靠收据绕过」一致。这**不**取消 2000，也不改 `node_modules`。

---

## 2. Tools 形态对照

| 维度 | Prime Agent（Prime Intellect） | Continual Harness（本地对照仓） | 其他 Pi-based（社区） | 我们 thin ARC |
| --- | --- | --- | --- | --- |
| **工具注册 / 调用面** | **单一持久 IPython REPL** 为默认动作面；工具/技能以 **Python 模块 import**；`await rlm(...)` 做子代理；强调 programmatic tool-calling，反对固定巨型 tool schema 常驻 | 每轮固定暴露约 **6** 个主工具：`take_actions`、`process_memory`、`process_skill`、`run_skill`、`process_subagent`、`run_subagent`（见本地 continual 分析报告） | Pi 原生：`pi.registerTool` + MCP；社区如 [pi-mcp-adapter](https://github.com/nicobailon/pi-mcp-adapter) 用小型 proxy 按需 search/describe；pi-jev 用 `jev_find_tools` 延迟激活 | `pi.registerTool` 显式 schema：`arc_action` / `memory` / `skill` / `run_skill` / `prompt` / `ask_analyst`（treatment）；**独立 typed `tool` 组件尚未接线**（`arc_thin_subagents.ts` 已预留 grant） |
| **结果大小策略** | 大中间值留在 **REPL 变量 / 磁盘**，按需序列化进 L1；compaction 清会话前缀但原文可 REPL 检索（论文 §2.2–2.3） | stdout/stderr/result **各约 5000 字符**上限；决策 history **约 12000 字符**；最多携带 **16** 条非行动工具结果（最新 2 条全文、更早摘要） | mcp-adapter：行/字节截断 + 临时文件 offload + 预览；pi-condense：>65536 字节 spill、预览 2048；pi-blackhole：历史 tool output 默认约 **20000 估算 token** 预算；pi-context-prune：摘要 stub + `context_tree_query` | 决策内 4000；continuity 历史 400；**压缩前** Phase 3c 收据；Pi summarizer 仍 2000 |
| **是否进入 history / 下一请求** | 会话 JSONL 全量保留；compaction 替换 L1 前缀；L3 历史可程序化取回 | **每个决策重建** contents；环境行动后结束该决策；旧完整 assistant/tool 对话不逐轮累积 | 多数扩展在 `context` hook 改投影、**不删**原始 JSONL；恢复靠 query/path | rebuild：每决策丢弃旧对话，只放工作集；`--continuity session`：保留最近 N 决策的短收据 + 可选 `compactionSummary` |
| **可否动态创建** | 是：`rlm.harness.create_*` CRUD；`/refine` / `refine.run()` 轨迹驱动 | 是：`process_*` 直接改 game-local store；Refiner 四 pass 机械触发 | Pi 扩展可 `registerTool`；pi-jev 发现后**追加激活**（无自动淘汰） | Skill/memory/prompt：**一次调用保存即装**；typed tool / 可保存 subagent：**模块在、扩展未 import**（`docs/current-architecture-2026-10-09-zh.md` §9） |

### 2.1 差异要点（tools）

1. **Prime** 把「工具」主要变成 **代码与持久内核状态**，大输出默认不挤进 token 上下文 → **绕开**「摘要输入必须装下全文」的压力；即便 fork 仍带 Pi compact，也可用 REPL 检索抵消信息损失。
2. **Continual Harness** 用固定短工具表 + **硬字符帽**管理结果；不依赖 Pi summarizer 的 2000，因为上下文策略是 **重建工作集** 而非长会话压缩。
3. **Pi 社区**普遍采用「**原文可寻址 + 工作集只留 stub/预览**」（prune/condense/mcp offload/VCC recall），与我们 Phase 3c 收据同族，但他们多做成常驻扩展/独立记忆系统。
4. **我们 thin** 仍是 **typed tool schema 常驻**（小集合），大结果靠 **多层截断 + 压缩时收据**；可编程计算当前落在 **skill/`run_skill`**，不是独立 tool 类型。

---

## 3. Skills / Memory / Subagents / Prompt overlays 等组件机制对照

| 组件 | Prime Agent | Continual Harness | Pi 社区代表 | 我们 thin |
| --- | --- | --- | --- | --- |
| **Prompt / 策略** | Prompt **notes**（supplemental）；**base system prompt 不可变**；`/refine` 只改 harness 层；turn boundary 应用 | 三层：固定 constitution + 可变 policy + 每轮 observation；Refiner **prompt pass** 重写策略层 | pi-on-demand-context：按目录加载 CLAUDE.md/AGENTS.md；pi-jev 不主打 prompt CRUD | `prompt` overlay ≤1500 字，**下一次决策**并入 system；无独立 Refiner pass |
| **Memory** | 结构化 memory CRUD；local/global；refine 可写入 | 短原子事实+confidence 1–5；edit/delete；目录展示正文首行 | pi-compact（DavidEasden）：权威 **memory.jsonl** 事件日志 + 模型查询工具；blackhole：Observer/Reflector/Dropper | `memory` 原子批次：facts + **competing hypotheses**（claim/predicts/status/evidence）；每决策渲染到工作集 |
| **Skills** | 可 import 的 **Python 包/调用**；`create_skill` + reference；与 REPL 一体 | Python `run(state, args)→result`；sandbox；可经 RPC `take_actions`；upsert 升版本 | Pi 原生 Skills = SKILL.md 指引（与我们「可执行 skill」不同语义） | WASI CPython `run(state, args)`；保存前语法检查；`run_skill` **仅当已有 skill 时注册**；artifacts 可跨 skill 保留 |
| **Subagents** | **完整 Prime 会话**（自有模型/REPL/历史）；`rlm` 异步 admission；**A2A** `agent_message`；可持久、可再附着 | 有界：默认 max_turns≈25（硬 50）；每 outer step ≤1；allowed tools 默认可空；可授予 `take_actions` | Pi 官方 examples/subagent；pi-jev 固定 scout/worker/reviewer 模板 | **`ask_analyst`**：一次性、无工具、新上下文；**可保存 subagent**（role/tools/notes/`every`）在 `arc_thin_subagents.ts`，**尚未接入 extension** |
| **Tools（作为组件类型）** | 与 skill/REPL 合流；不强调第五类「typed tool 商店」 | 执行能力主要在 skills store | 动态 register / MCP / jev 发现 | 架构声明五类；thin **暂无独立 typed tool store**（架构文档 §6/§9） |
| **整理 / 演化触发** | `/refine` 或 `refine.run()`；计划后台、应用在 turn boundary | Runtime Refiner：换关 / GAME_OVER / 停滞（默认 75 动作）；**四串行 meta pass** | VCC/blackhole：接管 `session_before_compact`；pi-context-tools：模型调 `compact_context` | Runner **consolidate** prompt（treatment）；ledger/critic 可选；Pi auto-compaction 仅 continuity+开关 |

来源摘要：

- Prime：[arXiv:2608.23552](https://arxiv.org/html/2608.23552)、[博客](https://www.primeintellect.ai/blog/prime-agent)、[GitHub](https://github.com/PrimeIntellect-ai/prime-agent)；本地综述 `docs/reports/2026-10-10-related-work-survey-self-harness.md` §5.2。
- Continual：`docs/reports/2026-10-08-continual-harness-self-harness-analysis.md`；吸纳草案 `docs/plans/2026-09-11-continual-harness-absorption.md`；对照目录 `D:/arc-agi-benchmark/Continual-Harness-ARC-AGI-3`。
- Pi 社区：`docs/reports/2026-10-07-pi-community-tools-online.md`、`docs/reports/2026-10-07-pi-community-compaction-online.md`；pi-jev：`docs/pi-jev-core-features-analysis-2026-10-09.md`。
- Thin：`docs/current-architecture-2026-10-09-zh.md`；`demo/arc_thin_extension.ts`、`demo/arc_thin_subagents.ts`。

---

## 4. 差异带来的后果

### 4.1 对 compaction / 长程连续性

| 架构 | 与「长 tool 结果 × 摘要」的关系 |
| --- | --- |
| Prime | 大状态优先在 **L2 REPL / L3 磁盘**；compaction 清 L1，但可用代码再查 → **对 Pi 式 2000 截断不敏感**（信息不必挤进摘要正文） |
| Continual | **几乎不用**跨决策长会话压缩；靠重建 + 字符帽 → **不触发** Pi 2000 问题 |
| Pi 社区 prune/condense/VCC | 主动把大 toolResult 变成 stub + 原文索引 → 与 summarizer 截断**解耦** |
| 我们 thin + session continuity | 一旦启用原生 compact，就**直接撞上** 2000；Phase 3c 收据是最小适配。**未触发 compact 的真跑**（如 ls20 峰值远低于阈值）则 2000 **从未生效**——见 `docs/reports/2026-10-12-ls20-session-compaction-uncapped-run.md` |

### 4.2 对自主采用（self-harness adoption）

- Prime 与我们同源观察：模型 **under-use** CRUD/组件（Prime 论文结论；我们本地「零自主采用」记录见 related-work §5.2）。
- Continual 的「短路径 + 保存即调用」历史上有**自主创建 skill** 的例子，但本地审计 **639/639 `run_skill` 宿主失败**，不能证明技能闭环有效（`docs/reports/2026-10-08-continual-harness-self-harness-analysis.md`）。
- 我们把 skill 做成「有才暴露 `run_skill`」，降低空目录噪声，但也减少「先看见再创造」的提示面。
- typed tool / 持久 subagent **未接线** → meta-harness「五类组件动态创建」在 thin 上目前主要是 **prompt / memory / skill / 一次性 analyst**。

### 4.3 对 meta-harness「动态创建并真实推进」目标

1. **证据保真：** 若依赖 Pi 原生摘要承载 ARC 反证，必须 **收据或抬高 2000**；否则长回执尾部证据在压缩时系统性丢失（探针 V2）。
2. **工作集 vs 程序化记忆：** Prime/PRO-LONG 偏向「完整日志 + 代码查询」；我们偏向「agent 手写 memory + 短工作集」。后者管理税高（历史 memory 拒绝占比），前者缺 queryable transition log（related-work §2.5 已点名缺口）。
3. **Subagent 语义鸿沟：** Prime = 完整并发会话；Continual = 有界单决策调用；我们 = analyst 旁路 + 未接线的可保存 subagent。动态「分工」能力目前最弱的一环在 thin。
4. **Tool 作为一等公民：** Continual/Prime 把可执行能力放进 skills/REPL；我们仍缺独立 tool store，动态「造工具」路径不完整。

---

## 5. 可选演进路径（**不实现**，仅选项）

按侵入性大致从低到高：

1. **维持现状（当前默认意向）**  
   - 保留 Pi 2000；依赖 Phase 3c 收据 + artifact；真跑需先把上下文推过阈值才能验证摘要质量。  
   - 代价：摘要模型仍看不到全文，只看收据节选；模型须学会按路径回查（尚未验证自主回查）。

2. **加强收据契约（仍不改 Pi）**  
   - 保证 ARC 关键标记（反证、hypothesis id、action n）进入收据 header；提供 `read_compaction_artifact(sha)` 类薄工具。  
   - 对齐社区 prune/condense 的 stub+query，而非抬常量。

3. **对齐 Continual 的结果帽，弱化对 native compact 的依赖**  
   - 更短 skill/tool 回执、决策重建为主；auto-compaction 仅作安全网。  
   - 与「session continuity 保留多决策」目标需权衡。

4. **对齐 Prime：程序化上下文**  
   - 暴露可查询 trajectory/transition log 给 `run_skill` / 持久 Python host（PRO-LONG 方向）；大网格/长日志默认不进摘要。  
   - 工作量大，但从根上降低对 summarizer 全文的需求。

5. **抬高或去掉 2000**  
   - fork/patch `@earendil-works/pi-coding-agent` 并钉版本；或上游 PR。  
   - 直接消除 serializer 裁切，但增大摘要调用成本，且需回归 Pi compact 全路径。

6. **接线 typed tool + 可保存 subagent**  
   - 完成 `docs/plans/2026-10-09-thin-tools-subagents-prompt.md` 未完成接线，使五类组件与 Continual/Prime 的类型边界对齐。  
   - **不**自动解决 2000；只补齐 meta-harness 表面。

7. **接管 `session_before_compact` 做自定义摘要（VCC/blackhole 路线）**  
   - 用结构化提取或观察式记忆替代自由摘要；风险：与原生/多扩展 hook 冲突、额外 worker 成本（blackhole 文档已警告）。

---

## 6. 证据边界

| 层 | 本报告状态 |
| --- | --- |
| 功能/机制（源码与文档） | 已核对 Pi 0.87.0 utils、thin 扩展、既有调研与公开 Prime/社区材料 |
| 全链路真跑下「收据被模型回查」 | **未验证** |
| 自主采用 | **未验证**（引用既有负例与 Prime 自述 under-use） |
| 净收益（通关/成本） | **未验证**；ls20 uncapped 局未触发 compact，不能评价 3c |

---

## 来源

**本地**

- `node_modules/@earendil-works/pi-coding-agent/dist/core/compaction/utils.js`
- `node_modules/@earendil-works/pi-coding-agent/docs/compaction.md`
- `demo/arc_thin_extension.ts`、`demo/arc_thin_subagents.ts`
- `docs/current-architecture-2026-10-09-zh.md`
- `docs/plans/2026-10-12-pi-compaction-plan-final.md`
- `docs/reports/2026-10-12-pi-compaction-probe.md`
- `docs/reports/2026-10-12-ls20-session-compaction-uncapped-run.md`
- `docs/reports/2026-10-07-pi-community-compaction-online.md`
- `docs/reports/2026-10-07-pi-community-tools-online.md`
- `docs/reports/2026-10-08-continual-harness-self-harness-analysis.md`
- `docs/reports/2026-10-10-related-work-survey-self-harness.md`
- `docs/plans/2026-09-11-continual-harness-absorption.md`
- `docs/pi-jev-core-features-analysis-2026-10-09.md`
- `docs/reports/2026-09-29-tool-receipt-optimization.md`

**外部 URL**

- Pi compaction 源：https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/compaction/utils.ts
- Prime Agent 论文：https://arxiv.org/abs/2608.23552 · HTML：https://arxiv.org/html/2608.23552
- Prime 博客：https://www.primeintellect.ai/blog/prime-agent
- Prime 代码：https://github.com/PrimeIntellect-ai/prime-agent
- Continual Harness 论文引用（Prime 文内）：https://arxiv.org/abs/2605.09998
- 社区：pi-vcc / pi-blackhole / pi-compact / pi-mcp-adapter / pi-context-prune / pi-condense（固定 commit 见 `2026-10-07-pi-community-*-online.md`）
