# Meta-harness 变更记录：pilot-01 后的决策内/跨决策连续性

日期：2026-10-14（Asia/Shanghai）。状态：实现完成，功能与接线检查通过；真实 provider pilot（02/03/04）未运行。
按 [开发流程](../development-workflow.md) 使用。前置分析：pilot-01 的 `working_set.jsonl`、`memory.md`、`refiner.jsonl`、`context_budget.jsonl`，与 Continual Harness（CH）/ Prime Agent 的逐项对照（本记录只保留结论）。

## 问题与命题

pilot-01 中决策 2 从零开始。四个原因，各自独立可修：

| # | 原因（观察） | 代码位置 | 修复 | 实验 |
| --- | --- | --- | --- | --- |
| A | 决策内 reasoning 被丢弃，请求 3–5 重推导前一请求已得结论 | `ARC_THIN_REASONING_MODE` 默认 `'none'`（[arc_thin_extension.ts:177](../../demo/arc_thin_extension.ts#L177)） | 默认 `'all'` | pilot-02 |
| 1 | 没人写下结论：`memory.md` 空，`refiner.jsonl` 0 条 | `{{refine}}` 句（[arc_thin_extension.ts:2194](../../demo/arc_thin_extension.ts#L2194)） | 恢复"agent 写、Refiner 合并"分工 | pilot-03 |
| 2 | 决策 1 关键结果（52 个 cell 的 diff）被截掉 | `summarizeHistory` 头部截断 2,000 字符（[arc_thin_native_context.ts:61,92](../../demo/arc_thin_native_context.ts#L92)） | 头尾截断 5,000 + 全文引用 | pilot-04（先离线回放） |
| 3 | 每个决策首请求 cache=0 | summary 拼在 head 文本里（[arc_thin_extension.ts:2292–2298](../../demo/arc_thin_extension.ts#L2292)），且 summary 本身每决策重写 | 历史改为冻结、只追加的块，置于 head 之前 | pilot-04 |

另有预算文本问题（`budget=1/110 (total 1/20)` 加"about 141 more fit"，三个数字说一件事），作为文本修正随 pilot-02。

- 窄命题：A+1+2+3 生效后，agent 在决策 2+ 不再重推导决策 1 已得的结论，决策 2+ 首请求有 cache 命中，每决策 output tokens 与耗时下降，任务进展不低于 pilot-01。
- 减少的负担：重复推理（决策内重算、跨决策重描述状态与重写 helper）、每决策全量 prefill。不新增 agent 义务。
- 推翻条件：见各修复的"判定"；总体上，pilot-04 决策 2 仍重新描述网格或重写已存在的 helper，或首请求 cache 仍 ≈0，或输入膨胀使每决策耗时上升而动作数不升。
- 范围及非目标：不限制 reasoning 长度、不改网格视图、不改 refiner 触发节奏、不做新的压缩机制（backlog D 的压缩部分保持开放）、不带 reasoning 尾部到下一决策（两个参考都不做；pilot-01 决策 1 尾部内容无用）。

## 设计

### A. 决策内保留 reasoning

- 改默认为 `'all'`：追加式，缓存前缀不变（`'recent'` 会重写早先消息，2026-10-14 pilots 命中率 1–2%）。改默认而非只设 env，使 `run-config.json` 记录真值、与 2308–2317 行注释一致；同步 `src/autoresearch_pi/arc_thin_e2e.py:792`。
- 判定：同一决策后续请求的 reasoning 不重复前一请求已得结论（人工审阅 + 请求级 output tokens）。

### 1. 没人写下结论

- 诊断：系统提示自相矛盾。[arc_thin_native_system.md:5](../../demo/prompts/arc_thin_native_system.md#L5) 说 "Write memory only for what a later decision would otherwise lose"；`{{refine}}` 句说 refinements "keep memory and strategy consolidated: leave that bookkeeping to them"。Qwen 遵从后者。refiner 触发条件（level 变化、缺目标测试、stall、重复工作、每 15 动作）在 4 动作内一个也到不了。CH 是 agent 写（约 35% 工具调用）、Refiner 合并；我们让 refiner 两样都管。
- 修复：`{{refine}}` 句改为 "...each makes one edit to a prompt, memory entry, tool or skill (prompts/refine.md guides them) and consolidates the memory and strategy you write."。删除一条禁令，不加"必须写"、不加门禁、不改 refiner 节奏。核对 `prompts/refine.md` 是否有"替 agent 记录"的措辞，有则改为合并/修订已有条目。
- 不采用：提前或在决策边界触发 refiner（每次增加一个模型调用与管理成本，且它的职责是合并）；每决策强制写 memory（新义务）。
- 为何即使有修复 3 仍需要：转录在 compaction 时会被替换，memory/strategy 是跨 compaction 与重启唯一留下的认识。
- 判定：agent 自写的 `memory.jsonl` 条目（`by` 非 refinement）与 `prompts/strategy.md` 写入 > 0；写入的是结论/假设/下一实验，而不是步骤日志；决策 2+ 的 reasoning 引用了它们（呈现不等于利用，归因不清记不确定）。转录可见时 agent 不写，按合理不使用记录，不判失败。

### 2. 关键结果被截掉

- 诊断：`summarizeHistory` 对最新 2 个结果用 `clip(body, 2000)`，只保留头部，且不给全文引用。决策 1 的结果约 8,800 字符，开头是 agent 自己打印的 `json.dumps(state)`，把 2,000 字符全占满，排在后面的 52 个 cell 的 diff 被截掉。较早的结果只剩第一行。被截掉的内容从上下文无法恢复，因为没有 ref。
- 修复（同一个截断函数，用于修复 3 之后的历史段，也用于保留的 summary 模式）：
  1. 上限 5,000 字符（CH 的每结果上限）。
  2. 头尾保留：头 1,500 + 尾 3,500，中间写 `… <N chars omitted; full: results/r<n>.txt>`。理由是通用的：agent 的代码通常先打印输入/状态，最后打印计算结论；头部说明调用了什么，尾部是得出了什么。这不针对网格或某个游戏。
  3. 任何被截断的结果都通过 `workspace.saveResult` 存盘，并在截断标记中给出 ref（复用已有的 `archiveResult` 回调形式；投影函数保持纯函数，由调用方传入 saver）。
  4. `arc_action` 回执行（`#n ACTION…`）照旧总是完整保留。
- 不采用（列为下一因素）：识别并省略数字密集块（如整张网格的 JSON）。若 pilot-04 中头尾截断仍丢失关键内容，再单独试这一项。不再加提示：第 5 行已有 "print only selected evidence"。
- 判定（离线、确定性，不花 provider 费用）：用 pilot-01 的 Pi session 回放，生成决策 2 首请求的上下文，断言包含 52 个 cell 的 diff 行与 ref；用一个结论在头部的构造样例确认头部也保留。

### 3. 每个决策从全量 cache miss 开始

- 诊断：两层原因。(a) summary 文本拼进 head 的第一个 text block，而 head 在每个决策都重建（含随时间变化的 working set、memory、RESOURCES），所以 system 之后的第一条消息每决策都不同。(b) 即使把 summary 移出 head 也不够：summary 本身每决策都会重写——同一个早先决策从"最新 2 个结果完整"降为"只留第一行"，预算满时从最旧端整块删除。前缀永远不稳定。
- 修复：历史改为冻结的只追加块，放在 head 之前。
  - 上下文顺序：`[system][Pi compaction summary，若有][决策 1 块]…[决策 k-1 块][决策 k 的 head][决策 k 的调用与结果]`。
  - 决策 k 结束时把它的块渲染一次并缓存（按 session 消息 id 记忆），之后不再改变：原始用户提示文本（去掉当时的 working set 和图像——那是当时的视图，不是历史；网格可用 `history.grid(n)` 取回）、assistant 文本、工具调用与结果（结果用修复 2 的截断），不带 reasoning。
  - 实现上即 `ARC_THIN_NATIVE_HISTORY_CHARS=0` 的路径（`projectNativeHistory`）加上：对已结束决策应用修复 2 的截断、剥离早先 head 的 working set 与图像。把它设为 native 默认；保留 summary 模式作为可选比较项。
  - 唯一的重写点是 Pi 自己的 compaction（达到阈值时），每次 compaction 一次 miss，与 Prime 相同。
- 增长上界：每个结果 ≤ 5,000 字符，每个早先 head 只剩提示文本；其余由 Pi compaction 阈值约束。
- 其他已知的 cache 破坏者（本次只测量，不修）：`context_with_system` 在 active prompt 变化时修补 system 段；按阶段切换的工具集合。若修复后首请求 cache 仍 ≈0，先查这两项。
- 判定：离线断言——决策 k 最后一个请求的投影中，head 之前的所有消息与决策 k+1 首请求投影中对应部分逐字节相同。真实运行——决策 2+ 首请求的 provider cache tokens > 0，且约等于前缀长度。

### 预算文本

`actionLine` 的 `budget=a/b (total c/d)`（[arc_thin_extension.ts:403](../../demo/arc_thin_extension.ts#L403)）与 `resourcesText` 的配速句（547 行）合并为一句事实："actions: N used, M left"（若 bridge 两个上限含义不同，只显示约束更紧的一个并写明名字）。不给建议，不加提醒。

## 成本与生命周期

- 推进者：A、2、3、预算文本都是 runtime 机械投影，无新的语义判断；1 只删一个禁令，写不写仍由 agent 判断。
- 首次获益路径：零额外父决策。
- 新增与移除：无新提示段、字段、门禁、worker。删一个禁令从句、两个重复的预算数字；新增 env `ARC_THIN_HISTORY_RESULT_CHARS`（默认 5000）；history 默认从 summary 切到冻结转录。
- 权限/版本/环境边界不变；Pi session 文件不改，只改投影。
- 放弃与恢复：若 pilot-04 输入膨胀超过停止规则，退回 summary 模式但保留修复 2 的截断和 summary 位置移出 head，作为下一个单因素。

## 运行前实验协议

- 目标证据层级：功能正确（单测 + 离线回放）→ 自主采用/连续性（真实 provider 短运行）。净收益需后续重复样本，本轮不声明。
- 主要变量与比较器（每次一个主要因素，比较器为前一个 pilot）：
  - pilot-02 = pilot-01 + A（+ 预算文本）。
  - pilot-03 = pilot-02 + 修复 1。
  - pilot-04 = pilot-03 + 修复 2+3，作为一个因素"历史表示"。2 与 3 合并的理由：修复 2 的效果（关键内容是否进入上下文）是确定性的，由离线回放直接判定，不需要单独付费运行；付费运行只测合并后的行为。
  - 1 先于 2+3 的理由：它更便宜，而且 agent 自己能记下多少，决定了转录需要承载多少。若 pilot-03 已让决策 2 不再重推导，pilot-04 的命题缩小为 cache 与输入成本，不再声称连续性收益。
- 模型/provider/推理配置：qwen3.8-27b via yibu，thinking 开启，与 pilot-01 相同；同一游戏同一初态；无 probe、无引导。
- 独立样本与运行顺序：每个 pilot 先 1 次探索样本确认可判别，再按预算各 2 次确认样本；严格按 02 → 03 → 04。
- 总预算与停止规则：单次 ≤ pilot-01 的墙钟与动作预算；`length` continuation 照现有机制；pilot-04 中任一请求输入 > 2× pilot-03 同序号请求即记录膨胀，该次结束后停止 pilot-04 系列。
- 主要指标：各修复的"判定"；另报 parent input/output/reasoning、每决策耗时、固定时间内动作数与 level 进展；memory 工具调用占比作为诊断（CH 约 35%，不作目标）。可接受退化：输入字符上升，但每决策耗时不升、动作数不降。
- 负例：单轮决策（应无差别）；agent 打印大结果（截断应生效，头尾与 ref 都在）；结论位于结果头部（头部仍保留）；Pi compaction 触发（summary 在历史块之前，之后的块重新冻结）；agent 把 memory 写成步骤日志（记为写入质量问题，不以条目数判成功）；refiner 在 agent 条目上合并（不重复、不删除未被反证的条目）。
- 遥测：`context_budget.jsonl`（已有 reasoning_chars、history_text_chars、message_text_chars；新增 history_blocks、clipped_results）、provider cache 字段、`run-config.json` 记录 `decision_reasoning_mode`、history 模式与截断上限。provider 不返回 cache 时记为未测量。

## 实现与验证

- 改动入口：
  - A：`demo/arc_thin_extension.ts:177` 默认 `'all'`，改 2308–2317 行注释；`src/autoresearch_pi/arc_thin_e2e.py:792`。
  - 1：`demo/arc_thin_extension.ts:2194` 的 `refine` 句；核对 `demo/prompts/refine.md`。
  - 2：`demo/arc_thin_native_context.ts` 新增头尾截断函数（带 saver 回调），`summarizeHistory` 与历史投影共用。
  - 3：`demo/arc_thin_extension.ts` context 处理器（2280–2322 行）改为冻结块缓存 + 早先 head 剥离；`demo/arc_thin_native_context.ts` `projectNativeHistory` 接受截断与 head 剥离选项（决策内调用保持现状）。
  - 预算文本：`demo/arc_thin_extension.ts:403`、547。
- 功能/回归检查（2026-10-14 已运行，Windows，Node 25.5，Pi 0.87.0 由 `npm ci` 装入本 worktree）：
  - `node --test tests/arc_thin_native_context.test.ts tests/arc_thin_compaction.test.ts`：7/7 通过（新增两项：头尾截断 + 中段回执 + ref；冻结转录无 reasoning/图像、结果截断、前缀逐字节不变）。
  - `tools/run_foundation_smoke.py`（mock SDK、生产 bridge、真实 Pi、离线脚本 provider）：`activation defaults`、`foundation defaults`、`budget`、`history`（summary 模式）、`receipts`、`receipts automatic` 全部通过。activation 新断言：THINK_MARK_DECISION3 在决策 3 的后续请求中可见、不进入其他决策；决策内只追加；跨决策时 head 之前的转录不变。
  - pilot-01 离线回放（`runs/arc-efficiency-claude-20261014/pilot-01/arc-run/session.jsonl`，决策 2 首请求的历史）：决策 1 结果 6,572 字符（非先前估计的 8,800）。旧视图（头部 2,000）止于坐标元组列表中间，四条 `#1–#4 … changed=52 in x13-38 y40-62` 回执全部丢失；新转录（5,056 字符）与新 summary 都包含结果结尾、四条回执和全文 ref。
  - 实现中发现并修复：扩展内已有同名常量 `HISTORY_RESULT_CHARS = 400` 遮蔽导入（Pi 加载失败，由 compaction probe 发现）；summary 预算从未计入 `[decision -n]` 标签（history smoke 12,501 > 12,400）；系统提示超出 3,000 字符上限 12 字符，已缩短新增句。
- 实现偏离设计：预算文本只改了 action 回执（`actions_left=M (level|run limit N)`）和 RESOURCES 配速句措辞；`arc_thin_observation.ts` 的 `action_budget=` JSON 仍原样显示两个上限，未改。早先 head 本来就只存原始提示（working set 只在投影中拼接），所以"剥离 working set"无需代码，只剥离图像。
- 已知的跨决策 cache 上限：决策 k 的 head（含 working set）与带 reasoning 的轮次在决策 k+1 中变为原始提示与无 reasoning 版本，所以决策 k+1 首请求可复用的前缀是 system + 决策 1..k-1，不含决策 k。决策 2 首请求只能命中 system/tools 部分；收益随决策数增长。真实命中率待 pilot 测量。
- 其余栏目在各 pilot 后填写。

| 证据层级 | 状态 | Provider / environment | 产物及结论边界 |
| --- | --- | --- | --- |
| 功能正确 | 通过 | node:test；pilot-01 session 离线回放 | 投影、截断、预算、reasoning 默认值；不涉及模型行为 |
| 全链路可达 | 部分通过 | foundation smoke，离线脚本 provider + 真实 Pi + mock SDK | 接线与生命周期可达；`arc-harness-smoke` 完整矩阵未运行 |
| 自主采用 | 未验证 | qwen3.8-27b via yibu | pilot-02、03、04 未运行 |
| 净收益 | 未验证 | — | 需重复样本，本轮不声明 |

## 交付决定

### cont-01（2026-10-14，探索样本，协议偏离）

- 运行：`runs/arc-continuity-claude-20261014/cont-01`，commit 12880f3a，ls20，yibu/qwen3.8-27b，thinking high，text+image，query 观测，20 动作 / 100k reported tokens / 600 s，与 pilot-01 相同。
- 偏离：用户要求"commit 后跑 pilot"，四项改动一起生效，不是计划中的 02→03→04 单因素序列。单次运行，不能归因到任一改动。

| | pilot-01 | cont-01 |
| --- | --- | --- |
| 停止 | deadline 602 s | token_cap 534 s |
| 动作 / 完成决策 | 4 / 1 | 10 / 2 |
| reported tokens（含 cache read） | 49,794 | 140,128 |
| 未缓存 input / cache read | 21,027 / 10,752 | 44,325 / 75,520 |
| output（其中 reasoning） | 18,015（15,605） | 20,283（17,982） |
| 每动作 output | 4,504 | 2,028 |
| memory 写入 / strategy | 0 / 无 | 0 / 无 |

- 修复 A（决策内 reasoning）：决策 2 的后续轮次建立在前一轮结论上（"Confirmed: A1=up…" 直接用上一轮的 diff 解读，未重算）。但 reasoning 进入上下文后单轮 thinking 仍长（17,168 与 11,864 字符），且第二段开头复述了"current model"。决策内是否少了重推导：部分支持，未量化。
- 修复 1（agent 写 memory）：未被采用。两个决策内 agent 没有写 memory 或 strategy；结论只在自己的文本里。4+6 个动作、2 个决策的运行里，跨决策需要保存的东西有限，不足以判定；仍为"未观察到采用"。
- 修复 2+3（历史）：决策 2 首个思考直接引用了决策 1 的回执（"changed=52 in x13-38 y40-62"），没有从零重新描述网格。决策 2 首请求 cache=0，与预测一致（只有 system/tools 可复用，而这次连这部分也未命中）。决策内 cache read 随后升到 15–19k/请求。
- 一次中途 miss：决策 2 第 5 请求（输入 16,438，cache 0）紧接一个 7,016 reasoning token 的轮次；之后请求正常命中，前缀未变，判断为 provider 侧，未确认。
- **新发现的预算问题**：run 的 token 上限计入 cache read。cont-01 的 140k 中 75.5k 是 cache read，按上限停止早于 deadline。保留 reasoning 与转录使 cache read 按请求累计增长，所以在这个口径下，越能复用前缀的配置越早触顶。是否把 cache read 计入预算是用户的决定；比较时需同时报告两种口径。

### pilot-02（2026-10-14，单因素：决策内 reasoning）

- 运行：`runs/arc-continuity-claude-20261014/pilot-02`，commit 见 protocol.json；`ARC_THIN_NATIVE_HISTORY_CHARS=12000 ARC_THIN_HISTORY_RESULT_CHARS=2000 ARC_THIN_HISTORY_CLIP=head ARC_THIN_MEMORY_AUTHOR=refiner`（历史、截断、refine 指令同 pilot-01，已在 provider 输入中核对），reasoning 默认 `all`。预算同 pilot-01；token 上限口径改为未缓存 input + output（用户 2026-10-14 决定），本次未触顶。首次启动在 `git rev-parse` 处因 Windows 0xC0000142 失败，未开始游戏，删除快照后同名重启。

| | pilot-01 | pilot-02 | cont-01 |
| --- | --- | --- | --- |
| 停止 | deadline | deadline 605 s | token_cap（旧口径） |
| 动作 / 完成决策 | 4 / 1 | 4 / 1 | 10 / 2 |
| 未缓存 input + output | 49,042 | 71,044 | 64,608 |
| cache read | 10,752 | 0 | 75,520 |
| 决策 2 最长单轮 thinking | — | 32,948 字符 | 17,168 字符 |
| memory 写入 | 0 | 0 | 0 |

- 结论：单独保留决策内 reasoning 未改变结果。决策 2 仍未在 600 s 内行动；它在后续轮次利用了上一轮的 diff 结果（未重算），但单轮 thinking 更长（17k、33k 字符），并花了一轮调查空文件列表。按预先判定，"决策内重推导消失"不足以带来进展；命题 A 在本样本中**未获支持**，也未被反驳（单样本）。
- 混杂：决策 1 的行为在三次运行间差异很大：pilot-02 决策 1 打印了整个状态（结果 188,009 字符），cont-01 决策 1 用一次 arc_action 链完成。单样本无法区分配置效应与运行间方差；cont-01 的改善不能归给 A。
- **cache 新发现（假设）**：三次运行中，cache 命中与否和"距离该前缀上次被处理的时间"一致，而不是与前缀是否变化一致。命中的请求距前一请求开始约 1 分钟以内（cont-01：48 s、56 s 命中 4k、15k）；未命中的距离约 3 分钟以上（cont-01 第 5 请求 3 分 16 秒；pilot-02 每一请求之间 2–5 分钟），即使前缀只追加。推测 provider 前缀缓存寿命约 2–3 分钟，而 qwen 在 ~40 tok/s 下生成 6k+ reasoning 就超过它。若成立，长 reasoning 的轮次之后 cache 总会失效，A 和修复 3 的 cache 收益在这个 provider 上受限于生成时长。下一检查：从 request-events 计算每请求的前缀上次处理时间与 cache_read 的关系（不需新运行）。

### 重复样本 pilot-01r、cont-01r（2026-10-14）

- pilot-01r：pilot-01 自身的 commit aad7ff79（独立 worktree `D:/autoresearch_pi_project/worktrees/continuity-baseline-aad7ff79`），同预算。cont-01r：当前 commit，默认配置，同预算，token 上限新口径。两次顺序运行，不并发。

| 配置 | 运行 | 动作 | 完成决策 | 停止 | 未缓存 input+output | 每动作 | agent 写 memory |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A 基线（aad7ff79） | pilot-01 | 4 | 1 | deadline | 49,042 | 12.3k | 0 |
| A 基线（aad7ff79） | pilot-01r | 1 | 1 | deadline | 23,203 | 23.2k | 0 |
| B = A + 决策内 reasoning | pilot-02 | 4 | 1 | deadline | 71,044 | 17.8k | 0 |
| C 四项全开 | cont-01 | 10 | 2 | token_cap（旧口径） | 64,608 | 6.5k | 0 |
| C 四项全开 | cont-01r | 10 | 2 | deadline | 99,338 | 9.9k | 1 |

- 同配置运行间方差大：A 两次为 4 与 1 个动作。pilot-01r 只发出两个请求（5.9k、9.3k output，约 33–42 tok/s），600 s 基本耗在生成上。
- C 两次都是 10 个动作、2 个完成决策，均高于 A 的两次与 B 的一次。方向一致，样本 n=2/2/1，属探索证据，不是净收益结论；C 每次花费的未缓存 token 也更多（65k、99k 对 49k、23k），但每动作花费更低。
- B 与 A 无差别，所以 C 的差异来自修复 1（agent 写 memory 的指令）和/或修复 2+3（历史），二者尚未分离。下一步是 pilot-03（只改 memory 指令）与 pilot-04（只改历史）。
- 修复 1 首次被采用：cont-01r 决策 2 中 agent 自己写了一条 memory（`ls20-lvl0`，置信 3）：控制、每步留下的轨迹、目标假设与两个备选。是结论而非步骤日志。该运行在决策 3 开始时结束，无法观察后续是否使用。refiner 只在决策 3 触发一次（推理中 44% 的句子在定位坐标）。
- cache 时限修正：在本线可确认配置的运行中（pilot-02、cont-01、cont-01r），命中的请求距前一请求开始 10–48 s；前缀未变而未命中的为 62、71、161、166、173、180、284 s。provider 前缀缓存寿命约 1 分钟，而不是此前估计的 2–3 分钟（先前引用的 pilot-01 110 s 命中可能是日志行错位）。qwen 在约 40 tok/s 下，超过约 2k token 的轮次就会让下一请求失去缓存；绝大多数推理轮次都更长。所以在这个 provider 上，只追加带来的 cache 收益主要出现在短工具轮之间。

### 2×2：memory 指令 × 历史（2026-10-14，四格都保留决策内 reasoning）

设计：B = pilot-02（旧 memory 指令、旧历史）；pilot-03 = 新 memory 指令 + 旧历史（`ARC_THIN_NATIVE_HISTORY_CHARS=12000 ARC_THIN_HISTORY_RESULT_CHARS=2000 ARC_THIN_HISTORY_CLIP=head`）；pilot-04 = 旧 memory 指令 + 新历史（`ARC_THIN_MEMORY_AUTHOR=refiner`）；C = cont-01、cont-01r（都新）。四格都保留 reasoning，因为 B 已表明它单独不改变结果，且新系统提示说 reasoning 会保留，在 `none` 下不成立。顺序交替运行（03a、04a、03b、04b），同预算。

| 格 | 运行 | 动作 | 完成决策 | 未缓存 input+output | agent 写 memory |
| --- | --- | --- | --- | --- | --- |
| B 旧/旧 | pilot-02 | 4 | 1 | 71,044 | 0 |
| 03 新 memory / 旧历史 | pilot-03a | 4 | 1 | 25,918 | 0 |
| 03 新 memory / 旧历史 | pilot-03b | 1 | 1 | 55,712 | 0 |
| 04 旧 memory / 新历史 | pilot-04a–d | — | — | — | 均在 bridge 启动时失败，见下 |
| 04 旧 memory / 新历史 | pilot-04g | 4 | 1 | 63,018 | 0 |
| 04 旧 memory / 新历史 | pilot-04h | 1 | 1 | 57,985 | 0 |
| C 新/新 | cont-01、cont-01r | 10、10 | 2、2 | 64,608、99,338 | 0、1 |

- pilot-03 与基线无差别：4 与 1 个动作，均未写 memory。单独改 memory 指令既未被采用，也未带来进展。
- pilot-04a–f 全部在 bridge 启动时以 "ARC environment returned no frame" 失败（20–30 s，无模型调用）。原因：arcprize.org 间歇性超时（TLS 握手超时，`/api/games` 与 `ls20` metadata 读取 10 s 超时，`arc_probe.log`）。与 pilot-04 配置无关：`bridge_test.log` 中带该变量 3/3 成功、不带 2/3；用 runner 的 venv 解释器直接启动 bridge 也成功（`bridge_venv_test.out`）。每次启动约 20 s，正好两次 10 s 超时，属于服务端降级而非中断。`series.mjs` 改为对零动作的 bridge 失败自动重试（保留为 `<label>-bridgefail-<n>`）：pilot-04g 第 4 次尝试成功，pilot-04h 第 1 次成功。
- 结果：pilot-04 与基线无差别（4、1 个动作，未写 memory）。2×2 中只有两项都开的 C 不同。

决策时间表（秒，从第一个请求起算；"截断"指到 deadline 仍未行动）：

| 运行 | 决策 1 用时 / 动作 | 决策 2 起点 | 决策 2 用时 / 动作 |
| --- | --- | --- | --- |
| A pilot-01 | 191 / 4 | 193 | 409+ 截断 |
| A pilot-01r | 146 / 1 | 148 | 454+ 截断 |
| B pilot-02 | 107 / 4 | 110 | 495+ 截断 |
| 03 pilot-03a | 220 / 4 | 222 | 384+ 截断（无完成请求） |
| 03 pilot-03b | 125 / 1 | 128 | 473+ 截断 |
| 04 pilot-04g | 407 / 4 | 410 | 194+ 截断 |
| 04 pilot-04h | 211 / 1 | 215 | 391+ 截断 |
| C cont-01 | 66 / 4 | 66 | 447 / 6 |
| C cont-01r | 211 / 4 | 214 | 368 / 6 |

- 600 s 运行实际测量的是"决策 2 能否在 deadline 前行动"。决策 1 的 1 或 4 个动作在所有配置中都随机出现。
- C 的决策 2 两次都在 368、447 s 内行动并串起 6 个动作；其它配置中有四次决策 2 拥有 ≥454 s 仍未行动（A 454+、B 495+、03 473+、A 409+ 接近）。这是带截断的弱证据，指向 C 的决策 2 更快结束，而且只有两项同时开启时出现。
- 解释（推测）：新历史让决策 2 看到决策 1 的完整结果（含回执与 diff），新 memory 指令去掉了"记录交给 refinement"的禁令；单独任一项时决策 2 仍长时间推导。证据不足以区分"交互作用"和"C 两次都碰巧较快"。
- 结论边界：每格 n=1–2，600 s 只容纳约 2 个决策，结果由一个截断事件决定。要区分因素，需要更长的运行（例如 1,800 s，可容纳 5–8 个决策），以每决策用时、每决策动作数和总动作数为指标，并按格重复。

### 决定（2026-10-14，用户确认不再追加测试）

- 保留四项改动作为默认（C）：它是唯一两次都让决策 2 在时限内行动的配置，每动作花费更低，且每项改动修复的缺陷都有独立核对（离线回放、提示矛盾、提示与投影一致）。状态："当前最佳选择，净收益未证实"（n=2，同配置运行间方差大，交互作用与偶然无法区分）。
- 保留 token 上限的新口径（未缓存 input + output）。
- 移除比较开关 `ARC_THIN_HISTORY_CLIP`、`ARC_THIN_MEMORY_AUTHOR` 及其 run-config 字段，保持代码最小；需要重做对照时可从 git 历史恢复（commit 记录于本节之前的 pilot 条目）。保留 `ARC_THIN_NATIVE_HISTORY_CHARS`（summary 模式）、`ARC_THIN_HISTORY_RESULT_CHARS`、`ARC_THIN_REASONING_MODE` 这些已有或设计中的配置项。

### 原交付决定

- 已支持的声明：无（设计阶段）。
- 决定与依据：A → 1 → 2+3 三个单因素顺序实验；预算文本随 pilot-02。
- 下一可证伪检查：pilot-02 是否消除决策内重推导；pilot-03 agent 是否自写跨决策结论并在决策 2 使用；修复 2 离线回放是否保留 diff；pilot-04 决策 2 是否不再从零开始且首请求 cache > 0。
- 关联 backlog：[deferred-research-todos.md](../deferred-research-todos.md) 项 D（压缩后认知连续性）——本记录只处理压缩前；compaction 后冻结块被 Pi summary 取代时，修复 1 的 memory 是唯一保留的认识，这一点在 D 下记录。10-13 gap analysis 的"遗忘产生保存需求"在 Qwen 上被 pilot-01 反证，应在该处标注。
