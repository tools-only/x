# Meta-harness 变更记录：ARC 父代理的 token 开销循环（10 动作、无 token 上限）

日期：2026-10-14（Asia/Shanghai）。状态：第 2 轮达到 M1/M2（tc-02r3）；第 3 轮（Prime 式簿记与行动合并）实现中。
按 [开发流程](../development-workflow.md) 使用。分支 `claude/kernel-20261014`（python kernel 已在本分支，见 [python kernel 记录](2026-10-14-python-kernel.md)）。

## 问题与命题

- 材料：kernel-02（`tmp/arc-kernel-20261014/kernel-02/`；ls20、yibu/qwen3.8-27b、thinking high、10 动作、无 token 上限与截止）。17 个请求，预算 token（未缓存输入 + 输出）326,286，报告 token 499,086，0 关。
- 按请求拆分输入（`tmp/cost_breakdown.py`：用 `runtime-audit/provider-inputs.jsonl` 中每个请求的实际 payload 按字符比例分摊 provider 报告的输入 token，是估计值）：

  | 部分 | 估计输入 token | 占比 |
  | --- | --- | --- |
  | 当前决策内重发的 reasoning | 158,122 | 35% |
  | 之前决策的冻结转录 | 90,331 | 20% |
  | 当前决策内的工具结果 | 82,274 | 18% |
  | 工具 schema（8 个，6,293 字符） | 54,867 | 12% |
  | system + 决策 head | 52,112 | 12% |
  | 当前决策内的调用与文本 | 9,321 | 2% |

  输出 52,059（其中 reasoning 48,486）。决策 2：7 个请求 107,511 预算 token；决策 4：5 个请求 133,237，主要是 reasoning（29.5k 输出并在后续请求重发）。
- 观察到的单项最大开销：决策 1 的 python 输出 56,198 字符（第 1 行 17,382 字符的 feedback dict，第 2–54 行是 agent 要的 52 个 cell 的 diff，第 55 行 37,953 字符的 state dict）。回执只显示每端约 240 字符，两条长行占满了预算，diff 被省略；模型随后无范围 `read` 该文件，Pi 的 50 KB 上限返回第 1–54 行（18,281 字符），这一结果在决策 2 后续 6 个请求中重发。`read` 被 `tool_result` hook 豁免于回执（`demo/arc_thin_extension.ts`），是当前决策内唯一没有大小上限的结果路径。
- 窄命题（第 1 轮）：回执把超过 400 字符的行换成一行存根、其余行完整显示（剩余部分在内联上限内时），且无范围 `read` 也走同一回执，则 agent 打印的短行发现不再丢失、不再需要读回整文件，当前决策内的工具结果 token 下降，且不出现新的重读。
- 减少的负担：读回被截掉的结果的调用；大块数字文本在决策内每个后续请求的重发。
- 推翻条件：真实运行中仍有 > 8,000 字符的工具结果进入上下文；或 agent 因存根而增加 `read`/python 读回调用，使工具结果 token 不降。
- 范围及非目标：不改推理模式——thinking 级别（high）和决策内 reasoning 重发（`ARC_THIN_REASONING_MODE` 默认 `all`）都不动（用户要求；另见记忆"保留推理、减少负担"）。不改游戏内容、不加提示义务。

## 目标（运行前确定）

- M1（主要）：每请求非 reasoning 输入 token（provider 报告的未缓存 + 缓存输入，减去估计的重发 reasoning，再除以请求数）≤ 8,500。kernel-02 为 (447,027 − 158,122) / 17 ≈ 16,994。
- M2：进入上下文的单个工具结果 ≤ 8,000 字符（kernel-02 为 18,281）。
- 同时报告但不作通过判据：总预算 token、输出与 reasoning、请求数、每决策成本、关卡。理由：在不改推理模式的前提下，reasoning 生成与重发约占预算 token 的一半，单次运行间方差主要来自 reasoning 长度，无法由 harness 机制控制。
- 守护条件：10 个动作用完、无工具错误增加、读回 `results/` 或 `data/` 的调用不增加。

## 设计与成本

- 第 1 轮（结果大小，一个因素）：
  - `Workspace.receipt`（`demo/arc_thin_workspace.ts`）：先把 > `LONG_LINE_CHARS`（400）字符的行换成 `[line N: K chars not shown; starts "…"]`；若剩余 ≤ 内联上限（8,000），整体显示；否则在存根化的行上用原来的首尾预览。新增可选 `source`：指向已存在的文件，不另存副本。
  - `tool_result` hook：带 `offset`/`limit` 的 `read` 仍原样返回（显式范围）；无范围的 `read` 走回执，`ref` 为被读文件本身。
  - 参考：Continual Harness 对 stdout/stderr/result 各设 5,000 字符硬上限；Prime Agent 把大中间值留在 REPL 变量/磁盘、只按需打印选出的证据。这里的形式是：上限照旧，但上限内优先保留 agent 自己打印的短行，长数据行留在文件中供 python 查询。
  - 新增与移除：无新提示段、字段、门禁或 worker；回执文本多一句"or open it in python"（仅有存根时）。
  - 缓存：在结果产生时决定其文本，不改写早先消息，前缀不变。
- 候选第 2 轮（视第 1 轮数据决定）：之前决策的冻结转录占 20%，且每个决策的首请求在 kernel-02 中都是完全未缓存（yibu 前缀缓存约 1 分钟，且冻结转录去掉了 reasoning 和 head，与上一请求的前缀在上一决策处分叉），冻结转录的缓存理由没有兑现。候选是 Continual Harness 的有界历史（`ARC_THIN_NATIVE_HISTORY_CHARS=12000`，已有实现）。

## 运行前实验协议

- 证据层级：功能正确（单测 + 离线回放）→ 真实运行中的机制效果（M1/M2）。净收益（任务进展）不在本循环声明范围内：0 关基线、单次运行。
- 比较器：kernel-02（同配置：ls20、yibu/qwen3.8-27b、thinking high、text+image、query 观测、ledger 与 critic 开、10 动作、无 token 上限、无截止）。每轮只改一个主要因素。
- 总预算与停止：至多 5 次真实运行（每次约 20 分钟、约 33 万预算 token）；M1 与 M2 达标即停；某一轮主要指标没有按命题方向移动，则先定位断点再决定是否继续。
- 遥测：`harness/usage.jsonl`、`runtime-audit/provider-inputs.jsonl`、`tmp/cost_breakdown.py` 输出、会话转录。

## 实现与验证

- 第 1 轮离线：kernel-02 的 `results/r000001.txt`（56,198 字符）经新回执为 1,386 字符，52 个 cell 的 diff 全部可见，两条长行为存根；无范围 `read` 的同一内容为 1,279 字符（`tmp/offline-receipt.txt`）。新增 [tests/arc_thin_receipt_lines.test.ts](../../tests/arc_thin_receipt_lines.test.ts) 4 项。`tests/arc_thin_*.test.ts` 154 项中 149 通过，5 项失败均为基线既有（见 python kernel 记录）；全量运行时 `arc_thin_action_surface` 一项因与 smoke 并行负载超时，单独重跑通过。确定性 smoke `foundation`（含无范围读 `data/current.json`、`data/frames/1.json`）通过（`tmp/smoke-tc-foundation`）。
- 第 1 轮真实运行 tc-01（b7d4e1db；`python -u tmp/arc-kernel-20261014/pilot.py tc-01 10 0 0`；产物 `tmp/arc-kernel-20261014/tc-01/`，拆分 `tc-01-cost.txt`）：
  - 结果：10 动作、11 个决策、0 关，2,501 s；预算 token 330,472（kernel-02 326,286）。23 个父请求中 5 个以 provider `Request timed out.` 失败（决策 10 的第一个在 5 分钟后失败，其余约 11 s 内失败），成本未知，决策 10 因此没有动作。
  - M2 达标：进入上下文的最大工具结果 1,575 字符（kernel-02 18,281）；当前决策内工具结果估计 2,280 token（kernel-02 82,274）。模型在决策 3 打印 `state['frames']`，回执把 12,525 字符的行换成存根，之后没有读回 `results/`；全程 `read` 只有 `data/frames/0.png`、`prompts/strategy.md`、`data/ledger.md` 各一次。
  - M1 未达标：每请求非 reasoning 输入 11,764（kernel-02 16,994，−31%；目标 8,500）。现在最大的可控部分是之前决策的冻结转录：估计 109,278 token（36%），决策 9 时每请求约 1 万 token，并随决策数线性增长；其次是工具 schema 48,192（16%）。最后一个请求的转录 21.4k 字符中：工具结果 8.6k、python 代码 5.0k、`arc_action` 参数（note/idea/predict）3.4k、`memory` 参数 3.1k。
  - 输出 89,918（reasoning 83,217），高于 kernel-02 的 52,059；决策数从 5 增到 11（本次 agent 几乎每个决策只行动一次，kernel-02 在 python cell 内连续行动）。总预算 token 持平，是因为 reasoning 增加抵消了结果 token 的下降；这一部分不在本循环可改范围内。
  - 缓存：11 个决策的首请求中 9 个缓存为 0；冻结转录的缓存理由在 yibu 上仍未兑现。
- 第 2 轮（一个因素：之前决策的表示）：用已有的 Continual Harness 式有界摘要（`ARC_THIN_NATIVE_HISTORY_CHARS=12000`：每决策 said ≤300 字符、调用参数 ≤160 字符、最新 2 个结果 ≤5,000 字符、更早结果只留首行与动作回执，按新到旧填入 12,000 字符）替代冻结转录。先以环境变量运行 tc-02，不改代码默认值；达标后再改默认与 smoke 断言。理由：Prime 的论点是 REPL 保留计算状态，所以转录可以被压缩；本分支的 kernel 正提供这一点（会话列表列出 `diff()` 等名字），代码正文不必在每个请求中重发。风险：agent 为重建状态而增加读文件——以读回调用数作为守护指标。
- tc-02（2026-10-14 12:43 起）作废：10 个父请求中 6 个以 provider 超时失败；第一个动作时 ARC 远端 SDK `step` 超过 90 s（`EnvironmentCallTimeout`，结果未知、不可重放），运行以 `environment_outcome_unknown` 停止，0 动作，37,251 报告 token。环境故障，不计入循环的 5 次上限；同配置重跑为 tc-02r。
- tc-02r（13:10 起）同样作废：18 个父请求中 8 个在 provider 处 5 分钟无响应头后超时（`request-events.jsonl`：`request_prepared` 之后没有 `response_headers`），随后 ARC 远端 SDK `step` 返回 None（`EnvironmentReturnedNoFrame`），运行以 `environment_outcome_unknown` 停止，0 动作，预算 token 44,908。两次故障都在 provider 与 ARC 远端，代码未变；第 2 轮（有界历史）尚无有效样本。下一次重跑前先确认 provider 与 ARC 远端可用。
- tc-02r2（14:26 起）作废：1 个动作后，第 2 个动作的 SDK `step` 超时；14:37–14:40 provider 三次 `Connection error.`、一次 `Request timed out.`。两个服务同时断开；provider 与 ARC SDK 都经本机代理 `HTTPS_PROXY=http://127.0.0.1:15236`（Veee.exe），判断为本机网络/代理故障。另发现一个放大器：bridge 的 stdout 是 runner 只在启动时读取的管道（`src/autoresearch_pi/arc_agi_3_e2e.py` 的 `_wait_for_bridge`），而 ARC SDK 把日志写到 stdout（`arc_agi/base.py`）；请求失败时 SDK 以 `exc_info=True` 记录整段 traceback，写入阻塞在 `stream.flush()`（tc-02r2 的 traceback），普通请求失败因此变成 90 s 超时且错误信息丢失。未修，列为待办。探针：`tmp/provider_probe.py`、`tmp/arc_probe.py`。
- tc-02r3（2026-10-14 15:20 起，b7d4e1db，`ARC_THIN_NATIVE_HISTORY_CHARS=12000`；产物 `tmp/arc-kernel-20261014/tc-02r3/`，拆分 `tc-02r3-cost.txt`，转录 `tc-02r3-session.txt`）——第 2 轮的有效样本：
  - 结果：10 动作、5 个决策（决策 1 的 4 个请求全部 `Connection error.`，无动作）、0 关，1,964 s；预算 token 253,153（kernel-02 326,286、tc-01 330,472），报告 token 263,905；失败请求成本未知。
  - 拆分脚本修正：Pi 的 openai-completions 把工具返回的图片（读 `.png`）作为工具消息之后的 user 消息发送，旧脚本把它当成决策 head，把当前决策的 head 与 reasoning 记为"之前决策"。新脚本跳过这种图片承载消息；kernel-02 不变，tc-01 重算为 M1 11,518（原 11,764）、之前决策 34%（原 36%）。
  - M1 达标：每请求非 reasoning 输入 6,949（目标 8,500；kernel-02 16,994、tc-01 11,518）。M2 达标：最大工具结果 3,213 字符。守护：10 动作用完；无读回 `results/`；`read` 只有 `data/frames/2.png`、`data/frames/4.png`、`data/ledger.md`（limit 120）各一次。
  - 输入构成（估计）：当前决策内重发的 reasoning 105,325（54%）、工具 schema 32,321（17%）、head（含有界历史）21,535（11%）、system 16,587（8%）、工具结果 12,163（6%）、调用 7,726（4%）。输出 68,248（reasoning 62,641）。缓存只有 10.8k（4%）：决策 4、5 的请求间隔都超过 yibu 约 1 分钟的缓存寿命。
  - 每决策预算 token：d2 39.0k（5 请求）、d3 29.0k（2）、d4 47.3k（2）、d5 137.9k（4）。决策 5：首请求生成 19.7k reasoning，第 2 个请求 10.6k；之后两个请求只做一次 `edit`（`prompts/strategy.md` 标题）和最后的 `arc_action`，各重发约 37–38k 输入、合计约 75k，输出 0.75k。决策 4：python cell 在与读 png 的同一消息中行动，因读 png 的结果不是 terminate，Pi 没有结束这一批，又多一个请求（20.2k 输入 + 8.8k 输出）写了 2 条 memory。
- 循环目标在第 2 轮达到（M1、M2）。剩下的可控成本是长推理之后的追加请求：每个追加请求都重发本决策已生成的 reasoning。用户要求继续优化，并选择 Prime 式方案（2026-10-15）。
- 第 3 轮（一个因素：簿记与行动合并为一个调用，Prime Agent 的 programmatic tool calling）：
  - 机会：tc-02r3 决策 5 的簿记调用（memory ×4 + write、edit、arc_action）分在 3 个请求；python cell 已可写文件并行动，但 memory 只能通过 memory 工具，必须单独一个请求。
  - 机制：python 中 `env.remember(**args)` 接受 memory 工具的同一参数，作为操作随 cell 的文件写入一起在 cell 结束时提交，经同一 `commitMemory`（与 memory 工具共用计划、校验、检查刷新）；回执与 cell 结果一起返回；被拒的更新只报告，不撤销 cell 的其他写入或动作；只读执行（subagent 的 python）拒绝。提示第 5 行加一句：一个 cell 可以写文件和 memory 并行动，簿记和下一步行动是一个调用。不改 `arc_action`（保持干净），不改推理模式。
  - 窄命题：簿记与行动在同一个 python 调用中完成，每个行动决策中"只做簿记"的请求数（调用全是 memory/write/edit 的请求）下降，追加请求重发的 reasoning token 下降。
  - 运行前指标：B1 = 只做簿记的请求数，tc-02r3 为 3（d4 r13 memory×2、d5 r15 memory×4+write、d5 r16 edit），合计 103k 预算 token（41%）。目标 B1 ≤ 1。同时报告 `env.remember` 使用次数、总预算 token、M1、M2；不作通过判据的有总预算 token（reasoning 长度方差大）。比较器 tc-02r3，同配置（含 `ARC_THIN_NATIVE_HISTORY_CHARS=12000`），1 次运行；启动前跑 provider 与 ARC 探针。
  - 推翻条件：agent 不使用 `env.remember`、簿记请求数不降；或使用后因回执需要再看一次而增加请求。
  - 代码：`demo/arc_thin_components.ts`（`_Env.remember`、ops 类型）、`demo/arc_thin_native_runtime.ts`（`applyWrites` 处理 memory 操作、Host `remember`）、`demo/arc_thin_extension.ts`（`commitMemory` 由 memory 工具与 python 共用）、`demo/prompts/arc_thin_native_system.md`。测试 `tests/arc_thin_kernel.test.ts` 新增一项（一个 cell 写 memory、写文件并行动；被拒更新只报告；只读执行拒绝）。
  - 另记一个独立机会（本轮不改）：同一消息中有行动的 python 调用和不行动的工具时，Pi 只在全部结果 terminate 时结束这一批（`pi-agent-core` 的 `shouldTerminateToolBatch`），扩展的 `tool_result` hook 不能设置 terminate。
  - 第 3 轮验证（2026-10-15）：`tests/arc_thin_kernel.test.ts` 5 项全过（单独运行）。`tests/arc_thin_*.test.ts` 全量并行 155 项中 144 通过、11 项失败：5 项为基线既有；其余 6 项是并行负载下的超时（`spawnSync python ETIMEDOUT`、`Pi timeout`、WASI `timeout_ms`、检查未运行），以 `--test-concurrency=1` 重跑这 6 个文件后全部通过（`installed Pi sends current action enums` 单独运行通过）。确定性全链路 smoke：`activation` 脚本在决策 3 的 python cell 中加入 `env.remember`，新增断言——`memory.jsonl` 有该条目、cell 结果含 memory 回执、之后决策的工作集含该条目文本（`tmp/smoke-remember-activation-3` 通过）；`foundation` 通过（`tmp/smoke-remember-foundation`）。这证明接线与生命周期，不证明模型会用。

| 证据层级 | 状态 | Provider / environment | 产物及结论边界 |
| --- | --- | --- | --- |
| 功能正确 | 进行中 | node:test | 见上 |
| 全链路可达 | 未验证 | — | — |
| 自主采用 | 不适用 | — | 机制性改动，无需 agent 采用；行为变化（是否读回）在真实运行中观察 |
| 净收益 | 未验证 | — | — |
