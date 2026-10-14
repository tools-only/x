# Meta-harness 变更记录：ARC 父代理的 token 开销循环（10 动作、无 token 上限）

日期：2026-10-14（Asia/Shanghai）。状态：第 1 轮实现完成，真实运行进行中。
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

| 证据层级 | 状态 | Provider / environment | 产物及结论边界 |
| --- | --- | --- | --- |
| 功能正确 | 进行中 | node:test | 见上 |
| 全链路可达 | 未验证 | — | — |
| 自主采用 | 不适用 | — | 机制性改动，无需 agent 采用；行为变化（是否读回）在真实运行中观察 |
| 净收益 | 未验证 | — | — |
