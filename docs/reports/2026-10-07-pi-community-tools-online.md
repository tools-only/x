# Pi 社区：工具定义、工具结果与会话连续性的上下文管理

研究日期：2026-10-07（Asia/Shanghai）。范围是公开 Pi 本身及其社区扩展；本文不评价本地工程。已实际执行联网搜索，并读取 GitHub 第一方 README、架构文档和以下固定提交的关键源码。未安装扩展，未执行真实模型任务；源码可解释机制，不能证明模型会正确采用、供应商兼容性或净成本收益。

## 1. 值得区分的五种问题

工具 schema 是“尚未做事就支付”的上下文成本；工具结果是“做完事以后反复携带”的上下文成本；摘要调用又会产生新的输入、输出、时延和缓存失效成本。优秀方案不是统一地删消息，而是分别治理这些成本。

1. **工具能力延迟披露**：先暴露小型入口，按需搜索、读取定义，再调用具体能力。
2. **可恢复的结果剪枝**：原始证据保留，工作上下文只携带摘要或引用。
3. **围绕 prompt cache 安排剪枝**：让前缀在工作段内稳定，在合理边界集中更换。
4. **由 Agent 决定何时整理**：让模型看到使用量，并能在任务阶段边界请求压缩。
5. **压缩前后校验连续性**：不仅检查变短，还检查目标、约束、决策、未完成事项和检索路径是否仍成立。

这些机制是不同维度；大量安装同类扩展，可能使多个 `context` hook 反复改写同一消息，或发生工具名称、状态与压缩生命周期冲突。这里的“优秀”指可取的机制设计，并非社区排行榜或已证明的最优组合。

## 2. 已核查的项目与版本身份

| 项目 | 固定提交 | 核心机制 | 核查深度 |
|---|---|---|---|
| [nicobailon/pi-mcp-adapter](https://github.com/nicobailon/pi-mcp-adapter/tree/5d2b583f91dc9e52d2a7112bd5268202dbafa20e) | `5d2b583f91dc9e52d2a7112bd5268202dbafa20e` | 小型 MCP gateway、按需发现、输出 offload、懒进程 | README、proxy、output guard、lifecycle |
| [championswimmer/pi-context-prune](https://github.com/championswimmer/pi-context-prune/tree/7f27beea965438ba1e045ef962b78561577cd0be) | `7f27beea965438ba1e045ef962b78561577cd0be` | 批次摘要、会话索引、原文恢复 | README、types、pruner、query、summarizer |
| [jjuraszek/pi-condense](https://github.com/jjuraszek/pi-condense/tree/069628aaef5ef6879739102dd4f5db1a8f6c7470) | `069628aaef5ef6879739102dd4f5db1a8f6c7470` | 缓存友好批次、stub、链压缩、保护路径、恢复宽限 | README、PRUNING、types、pruner、query |
| [pi-vault/pi-dcp](https://github.com/pi-vault/pi-dcp/tree/ff8c6dddd3160a532e622cbc7d35e411afdea2df) | `ff8c6dddd3160a532e622cbc7d35e411afdea2df` | 规则去重、失败输入剪枝、模型主动压缩 | README、index、pipeline、config/schema |
| [theduke/pi-context-tools](https://github.com/theduke/pi-context-tools/tree/d565066e1b7ebe8556d23437abd4532bd5ae12bd) | `d565066e1b7ebe8556d23437abd4532bd5ae12bd` | Agent 自查上下文并调用 Pi 原生压缩 | README、全部 extension 源码 |
| [alpertarhan/pi-smart-compact / Pi Continuity](https://github.com/alpertarhan/pi-smart-compact/tree/cb3c143aa69290ff6f9df346c3461d75562d481c) | `cb3c143aa69290ff6f9df346c3461d75562d481c` | 压力优先清理、checkpoint/rewind、验证型压缩 | README、ARCHITECTURE、配置、constants、context operations、verify |
| [PSU3D0/pi-dcp](https://github.com/PSU3D0/pi-dcp/tree/8d15a3331c51f3551ccd20583ac0f5ba499a13c3) | `8d15a3331c51f3551ccd20583ac0f5ba499a13c3` | 保守窗口、替换大输出、规则剪枝 | README、index/config；transform 内部未完整核查 |
| [complexthings/pi-dynamic-context-pruning](https://github.com/complexthings/pi-dynamic-context-pruning/tree/75e04cb03fe7e7484ce61a3c684dda19b2bc41f7) | `75e04cb03fe7e7484ce61a3c684dda19b2bc41f7` | 去重与 compress 的另一实现 | README、index、config、pruner、compress-tool |

GitHub 公共 API 后来发生限流；剩余版本由 `git ls-remote` 获取 commit 后，使用固定 commit 的 `raw.githubusercontent.com` 下载。后续网络/工具不可用时停止补采。未取得或未完整读取的文件不作为实现结论依据。

特别注意：多个项目叫 `pi-dcp`，但作者、包名、默认行为、恢复语义并不一致；不能把某项目的配置阈值写成所有 DCP 的默认值。

## 3. pi-mcp-adapter：把工具 schema 从常驻目录改为按需获取

### 实际机制

默认入口是一个 `mcp` proxy。模型先检索工具，必要时读取具体定义，再以 server/tool/args 调用；所有 MCP 工具的大型 schema 不必一开始就常驻。`proxy-modes.ts` 实现 search、describe、调用匹配和参数校验，可按 server 消除同名工具歧义。schema 仍存在于扩展的元数据中，“不进入当前模型上下文”并不等于“服务器没有定义”。[固定源码：proxy-modes.ts](https://github.com/nicobailon/pi-mcp-adapter/blob/5d2b583f91dc9e52d2a7112bd5268202dbafa20e/proxy-modes.ts)

它也控制结果大小。`guardMcpOutput` 用 Pi 的行数/字节限制截取文本，将完整文本存入临时文件，向模型返回预览、截断通知和路径；图片仍按原生图片块传递。这里解决的是 tool result 的单次入口，而不是已经累积的会话历史。超大原始 MCP `details` 也被单独限制，默认上限为 16 KiB。若持久化失败，代码报告写入错误；因此不能无条件声称每次都能恢复全部原文。[固定源码：mcp-output-guard.ts](https://github.com/nicobailon/pi-mcp-adapter/blob/5d2b583f91dc9e52d2a7112bd5268202dbafa20e/mcp-output-guard.ts)

MCP 进程默认按需启动，闲置 10 分钟关闭。工具元数据可在进程关闭后继续检索，实际调用再启动；需要跨调用状态的服务器可采用 keep-alive 生命周期。这主要节省进程资源，不能直接计为模型 token 节省。[固定版本 README](https://github.com/nicobailon/pi-mcp-adapter/blob/5d2b583f91dc9e52d2a7112bd5268202dbafa20e/README.md)

### 与当前 Pi 原生 MCP 的关系

该 README 已明确 Pi 0.99 开始有原生 MCP，也避免把全部工具定义送入上下文；因此不能继续采用“Pi 无 MCP，所以 adapter 填补空白”的旧叙述。社区 adapter 提供的是不同交互策略：默认小 JSON proxy、脚本 opt-in、懒服务器生命周期、扩展搜索和界面支持。原生与 adapter 的具体差异应结合所用 Pi 版本复核；仓库对比明确以 Pi 0.99.2 为其快照，并非保证后来每个版本仍相同。维护者宣称的小型 lookup token 优势和大批量脚本优势有特定 workload，本文未复跑，不外推为通用任务质量或成本收益。

### 可取之处与代价

能力目录大、每任务使用工具少时，按需披露价值明显；但它多出搜索/describe 往返，模型可能选错工具。大量逐条调用时，小 proxy 不一定胜过脚本批处理。临时 offload 文件的寿命、范围和读取能力也需要纳入恢复设计。

## 4. pi-context-prune：证据留在 session，工作上下文只携带摘要

该扩展捕获完成的 tool-result 批次，调用摘要模型，写入摘要与索引；在 Pi 的 `context` 事件里移除已被接受摘要覆盖的原始 `toolResult`，不删除原始 session 消息。summary/index/frontier/stats 本身会追加到会话，因此正确表述是“保留原始日志，改变未来请求的投影”，而不是“会话文件完全未改动”。[README](https://github.com/championswimmer/pi-context-prune/blob/7f27beea965438ba1e045ef962b78561577cd0be/README.md)，[pruner.ts](https://github.com/championswimmer/pi-context-prune/blob/7f27beea965438ba1e045ef962b78561577cd0be/src/pruner.ts)

固定源码默认 `enabled=false`；启用后的默认策略为 `pruneOn=agentic-auto`，模型通过 `context_prune` 决定时机，并收到未剪枝数量提醒；默认 batch 是一个用户消息到最终 Agent 回答之间的跨度。其他模式包括每 turn、checkpoint/context tag、按需、最终 Agent 消息时触发。不要把“安装即自动每回合剪枝”当默认。[types.ts](https://github.com/championswimmer/pi-context-prune/blob/7f27beea965438ba1e045ef962b78561577cd0be/src/types.ts#L197)

摘要携带短 ref，模型可用 `context_tree_query` 找回原结果。恢复入口确实存在，但所核查 query 工具只收一组 ID，每条返回文本仍经过 Pi 默认行数/字节限制；没有 offset/limit 参数。所以“原文被保存”与“一个工具调用把任意大原文完整送回模型”应分开理解。索引 `details` 不是模型可读正文的替代。该简版 pruner 只删除 tool-result，保留 assistant tool-call 块；各 provider 如何规范化缺失结果需做运行验证。[query-tool.ts](https://github.com/championswimmer/pi-context-prune/blob/7f27beea965438ba1e045ef962b78561577cd0be/src/query-tool.ts)

值得借鉴的原则是：摘要是默认工作集，原始证据是可寻址的后备集。其不足是摘要调用要支付成本，ref 需要被模型保留和实际使用，恢复结果也可能再次膨胀。未知将来需要哪些细节时，“保留检索路径”比不可逆地截去旧证据更稳妥。

## 5. pi-condense：考虑缓存和收益门槛的可恢复剪枝

pi-condense 明确继承 pi-context-prune 的思路，但在固定源码上已经不是相同实现。默认仍关闭；开启后默认 `pruneOn=agent-message`、`batchingMode=turn`，在完整工作段收束时处理，而不是每个工具调用后改前缀。小于 1000 字符的批次默认跳过摘要；自动上下文比例阈值 `autoBudgetThreshold=null`，因此不能把 80% 描述为它的默认自动触发。[types.ts](https://github.com/jjuraszek/pi-condense/blob/069628aaef5ef6879739102dd4f5db1a8f6c7470/src/types.ts#L562)

它将已摘要结果替换为带 ref 的小 stub，保留工具调用/结果的结构。默认保持最近 3 条闭合链，旧链可做范围压缩；默认保护 skills Markdown 等路径，防止读入的程序指导被无差别摘要掉。结果恢复默认有 3 turn 宽限，避免刚取回证据立即被再次剪掉。结果索引采用 provider tool ID 与时间戳区分发生次数，减少重复 ID 错误覆盖的问题。[pruner.ts](https://github.com/jjuraszek/pi-condense/blob/069628aaef5ef6879739102dd4f5db1a8f6c7470/src/pruner.ts)

大于 65536 字节的输出默认 spill，预览 2048 字节；模型可读取 sidecar 文件，或用 `context_tree_query`。query 还尝试从当前分支恢复原始图片块；同一个原始 ID 被复用时返回不同 occurrence。普通 query 文本仍有限制，大文件深入读取依赖文件路径。原始 JSONL 消息保留，而索引与自定义记录会追加；README 中“session untouched”应按“不覆写/删除原始消息”理解。[query-tool.ts](https://github.com/jjuraszek/pi-condense/blob/069628aaef5ef6879739102dd4f5db1a8f6c7470/src/query-tool.ts)

它体现的是缓存权衡，不是绝对最小上下文：稳定一段前缀，尽量把重写集中到工作单元边界。已有 cached input 的价格可能远低于摘要生成及重新写入缓存的价格；若任务马上结束，摘要可能没有机会回本。保护路径和链滚动窗口也说明语义对象需要不同保留期。[PRUNING.md](https://github.com/jjuraszek/pi-condense/blob/069628aaef5ef6879739102dd4f5db1a8f6c7470/PRUNING.md)

## 6. pi-vault/pi-dcp：先机械去重，再把语义压缩交给 Agent

该实现默认开启。`context` hook 运行 pipeline：清理旧标记、重建稳定 refs 与工具缓存、机械策略、消息 ID、压缩提醒、最终 projection。剪枝标记/压缩状态可持久化，但原始消息不在该 hook 里直接删除。去重和过时错误处理是规则层；模型通过 `compress` 工具提供 range/message 级摘要，语义选择由模型承担。[index.ts](https://github.com/pi-vault/pi-dcp/blob/ff8c6dddd3160a532e622cbc7d35e411afdea2df/src/index.ts#L617)，[pipeline.ts](https://github.com/pi-vault/pi-dcp/blob/ff8c6dddd3160a532e622cbc7d35e411afdea2df/src/pipeline.ts)

默认 compress 权限是 allow、mode 是 range，提醒频率 5 个 turn，连续 assistant iteration 提醒阈值 15；过时失败输入门槛 4 个用户 turn。失败的诊断输出保留，清理的是历史参数。compress/write/edit/subagent 默认受到保护。提醒与保护计数采用用户消息 turn，不能误写为每个工具调用或 assistant step。[config-schema.ts](https://github.com/pi-vault/pi-dcp/blob/ff8c6dddd3160a532e622cbc7d35e411afdea2df/src/config-schema.ts)，[README](https://github.com/pi-vault/pi-dcp/blob/ff8c6dddd3160a532e622cbc7d35e411afdea2df/README.md)

配置展示有 legacy 80%/50% 阈值，但初始化同时设置 `maxContextLimit=200000`、`minContextLimit=100000`，且支持模型覆盖。不能仅截取 80% 并称当前所有模型固定在此自动压缩；需看实际生效 limits 和模型上下文窗口。`experimental.allowSubAgents=false` 默认关闭子会话应用。query 原文恢复不是所读公开 API 的主张；不要把它与 context_tree_query 系列视为同一种归档恢复能力。[config.ts](https://github.com/pi-vault/pi-dcp/blob/ff8c6dddd3160a532e622cbc7d35e411afdea2df/src/config.ts)

维护者公开了确定性 pipeline 基准，包含无可剪内容时标记增加 token 的负例。这比只报节省比例更有解释力；但其重复工具 fixture 的约 94.7% 估算下降不是实际 provider 账单、长任务成功率或缓存净收益。[README 基准说明](https://github.com/pi-vault/pi-dcp/blob/ff8c6dddd3160a532e622cbc7d35e411afdea2df/README.md#benchmarks)

## 7. pi-context-tools：最小的 Agent 自管接口

该扩展只有两个工具。`context_info` 通过 Pi `getContextUsage()` 返回 tokens、window 和 percent；`compact_context` 设置请求标志，在 `agent_end` 后异步调用原生 `ctx.compact()`。工具返回的是“已安排压缩”，并不表示压缩已完成。[完整源码](https://github.com/theduke/pi-context-tools/blob/d565066e1b7ebe8556d23437abd4532bd5ae12bd/extensions/index.ts)

它没有独立摘要算法、归档索引、固定触发比例或长期 memory store。它的优点是把现有原生能力以小工具交给模型，在阶段交接时主动使用；代价是模型需要知道该看什么、何时调用。源码明确处理 usage unavailable 与压缩后 tokens 暂未知的情况：数字要等下一次模型回复更新，不应把滞后使用量理解为“压缩失败”。[README](https://github.com/theduke/pi-context-tools/blob/d565066e1b7ebe8556d23437abd4532bd5ae12bd/README.md)

对协调多个子任务的父 Agent，这可以成为阶段边界操作：先归纳当前结论与待办，再请求压缩；但工具本身不会保证模型做这一步，也不等于默认自动管理。

## 8. Pi Continuity：让压缩、checkpoint 与恢复遵守连续性契约

### 压力优先与稳定工具前缀

固定源码默认 `contextPressureOnly=true`、`autoTrigger=true`、`autoTriggerStrategy=settled`、`minContextPercent=80`；默认需要批准应用，备份开启。工具默认 eager 暴露，减少中途新增 schema 改变 cached prefix；操作才受压力门槛控制。`artifactOffloadEnabled=false`，所以不能把它的早期 spill 当安装即启用。默认 memory backend 为 local；Hindsight/Mnemopi 为可选后端。[constants.ts](https://github.com/alpertarhan/pi-smart-compact/blob/cb3c143aa69290ff6f9df346c3461d75562d481c/src/constants.ts#L133)

### 检查点与可验证回退

checkpoint 保存 session/origin 标识与投影前缀 fingerprint。rewind 前核查 session/branch、checkpoint 后有无 compaction 或 branch navigation、有无新 user 指令、旧前缀的数量/hash 是否变化。新用户指令到达时拒绝使用旧 checkpoint，防止把新的目标丢掉。它可以结束一次研究绕行，把过程替换为报告并保留证据引用；这是上下文回退，不会回滚文件、进程或外部副作用。[context-operations.ts](https://github.com/alpertarhan/pi-smart-compact/blob/cb3c143aa69290ff6f9df346c3461d75562d481c/src/app/context-operations.ts#L115)

### 验证型压缩

EESV 将工作拆为 Extract → Explore → Synthesize → Verify。所读 verify 代码拿源消息、用户 steering、预算与 extraction 一起检查摘要，先确定性修补已知缺口；允许的模式才调用 LLM patch。检查对象包括事实、文件、约束、错误和 open loops，而不是单纯目标压缩率。该检查能发现已建模的遗漏，不能证明语义事实绝对正确或后续任务必然成功。[verify.ts](https://github.com/alpertarhan/pi-smart-compact/blob/cb3c143aa69290ff6f9df346c3461d75562d481c/src/app/steps/verify.ts)

架构文档区分原始归档、session 工作状态、备份和长期 project memory；归档检索具有分支范围、hash 和引用授权边界。清理保护近期工作、指令与错误；持久化应用等待相应宿主生命周期确认。与简单 summarize-all 相比，它的价值在于显式记录“哪些连续性对象必须保留”和“如何证明本次修改确实应用”。相应代价是更多配置、工具、文件和验证/摘要调用。[ARCHITECTURE.md](https://github.com/alpertarhan/pi-smart-compact/blob/cb3c143aa69290ff6f9df346c3461d75562d481c/ARCHITECTURE.md)

## 9. 同名 DCP 的关键区别

| 项目 | 当前默认策略或已核查行为 | 恢复语义与边界 |
|---|---|---|
| pi-vault/pi-dcp | 默认开启；规则去重与失败参数清理；compress 可用 | 原会话与状态保留；本文未核查到 context_tree_query 等价入口 |
| PSU3D0/pi-dcp | config：safe；保护 8 个用户 turn 与 2 step；nudge/autoPrune/forceCompact 比例为 .7/.8/.9；advanced autonomy 默认关闭 | README 大输出 placeholder 指导重跑工具；重跑读取现态，不保证恢复历史原文；具体 threshold 执行因 transform 文件未完整读而未确认 |
| complexthings/pi-dynamic-context-pruning | 独立的配置/pruner/compress-tool 实现；默认 compress/write/edit 保护，失败年龄 4 turn | 不可借用其他 DCP 的恢复入口、会话持久化或保护窗口结论 |

来源：[PSU config](https://github.com/PSU3D0/pi-dcp/blob/8d15a3331c51f3551ccd20583ac0f5ba499a13c3/config.ts)，[PSU README](https://github.com/PSU3D0/pi-dcp/blob/8d15a3331c51f3551ccd20583ac0f5ba499a13c3/README.md)，[complexthings config](https://github.com/complexthings/pi-dynamic-context-pruning/blob/75e04cb03fe7e7484ce61a3c684dda19b2bc41f7/config.ts)。配置值只证明配置存在；执行路径未读全时不能当功能验收。

## 10. 对 Pi 用户真正有用的选择原则

| 主要压力 | 优先研究的机制 | 关键代价 |
|---|---|---|
| 工具很多、每次只用少数 | 原生 tool search/codemode，或 adapter proxy 按需披露 | 发现与 schema 往返，批量操作策略 |
| 输出非常大 | 工具侧 offload + preview + 分段文件读取 | 档案寿命、写入失败、图片与结构化结果 |
| 长会话大量重复读/失败调用 | 机械去重、失败参数剪枝 | 是否仍需要历史版本与诊断 |
| 已完成工具段仍长期携带 | 可恢复摘要 + stub + 查询入口 | 摘要调用、缓存失效、恢复再膨胀 |
| 父 Agent 协调长任务 | context_info + 阶段边界主动 compact | 模型是否能判断时机、原生摘要是否漏待办 |
| 研究绕行与多次续接 | checkpoint/report/rewind、验证型 compaction | 额外状态和验证成本，不能回滚副作用 |

不要只计删去的输入 token。一个可解释评估应同时计入父/子 Agent 输入输出、缓存命中与写入、摘要/修补调用、模型请求数、端到端时延、恢复次数、错检/漏检、任务成功和人工管理。负例至少包括：短任务、无重复小输出、刚被恢复的证据、历史版本必须保留、新用户指令、切分支、被截断后无法重取、大批量 MCP 操作。本文没有执行这样的真实 provider 评估，所有净收益与兼容性均未验证。

## 11. 证据结论

功能设计层：上述机制与默认值有已读一手代码支持。完整链路层：没有在 Pi CLI 中安装并跑通，未验证。自主采用层：没有观测真实模型会主动搜索、恢复或合理压缩，未验证。净收益层：没有进行相同任务/模型/provider 的账单与质量对照，未验证。社区宣传数据只按其原始 workload 和证据范围介绍，不提升为通用结论。
