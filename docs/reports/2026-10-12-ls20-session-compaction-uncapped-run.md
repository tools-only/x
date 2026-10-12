# ls20 uncapped session-compaction 真跑报告（2026-10-12）

只读复盘。本报告不重跑、不改代码、不提交。

| 项 | 值 |
| --- | --- |
| 跑次根目录 | `runs/pi-arc-thin-ls20-session-compaction-uncapped-20261012-135716` |
| 启动日志 / meta | `.scratch/codex-runs/phase5-ls20-20261012-135716.log` / `.json` |
| 实现冻结 | commit `8d832386`（未 push） |
| 相关前置 | `docs/reports/2026-10-12-pi-compaction-probe.md`；`.scratch/codex-compaction-impl-brief.md` |
| 时区 | 下文墙钟均为 **Asia/Shanghai (UTC+8)**；harness JSONL 内 `t` 字段为 UTC |

---

## 1. 配置摘要

来自 `run-config.json` 与启动 meta：

| 配置 | 值 |
| --- | --- |
| game / variant | `ls20` / `treatment` |
| provider / model | `yibu` / `qwen3.8-27b` |
| thinking | `high`（`thinking_format=qwen`，确认到达 provider） |
| Pi | **0.87.0**（`node_modules/@earendil-works/pi-coding-agent`） |
| continuity | `session` |
| `--continuity-decisions` | **8**（见 §5：历史窗口，不是停机上限） |
| auto_compaction | **开**：`ARC_THIN_AUTO_COMPACTION=1` → `run-config.auto_compaction=true`；RPC `set_auto_compaction` success |
| 自造上限 | `max_actions` / `max_decisions` / `max_reported_tokens` / `experiment_timeout_seconds` 均为 **null** |
| 适配器原生墙钟 | 未传 `--experiment-timeout` 时回落到 `OFFICIAL_MAX_RUNTIME_SECONDS = 12h`（`arc_agi_3_adapter.py`） |
| 其它 runner 默认 | `consolidate_after_actions=25`；`turn_idle_timeout_seconds=180`；ledger/critic 开 |
| 启动命令要点 | `python -m autoresearch_pi.cli arc-thin-e2e --game ls20 --variant treatment --provider yibu --thinking high --continuity session --continuity-decisions 8 --root …` |

说明：本局「uncapped」指未设置自造的决策/动作/token/实验超时；仍保留官方 12h 墙钟与工具级超时（`arc_action`→bridge `/action` 为 **120s** AbortSignal）。

---

## 2. 结果数字

来自 `summary.json`（文件 mtime **14:22:27**）：

| 指标 | 值 |
| ---: | --- |
| `passed` | **false** |
| `stop_reason` | **`bridge_unavailable`** |
| `bridge_close_error` | `timed out` |
| `elapsed_seconds` | **1510.4**（约 **25.2 分钟**；启动 meta `13:57:16` → summary `14:22:27`） |
| `decisions` | **8** |
| `actions` / `actions_on_bridge` | **7** / **7** |
| `no_action_decisions` | **1**（第 8 决策：ACTION1 环境超时，未写入 trajectory） |
| `consolidations` | **0**（harness 记忆 consolidation 轮次；阈值 25 actions，本局仅 7 actions，未到期） |
| `levels_completed` | **0** |
| `win_levels` | **7**（scorecard 基线关卡数，不是已通关数；见 `bridge-events` `baseline_actions` 长度 7） |
| `final_state` | `NOT_FINISHED` |
| `reported_tokens` | **336117** |
| harness 环境错误 | 1（`errors.jsonl`：decision 8 / ACTION1 / aborted due to timeout） |
| `arc_action` tool_errors | 1 |
| memory 写入 | writes 39 / deletes 5 / entries 6 |
| skills | `gdiff v1`, `scan v1`（runs 3） |

---

## 3. 失败链与时间线

### 3.1 因果链（有证据）

1. Decision **8** 模型调用 `arc_action ACTION1`（与 memory 批处理同轮）。
2. Extension 对 bridge `POST /action` 使用 **120s** 超时（`demo/arc_thin_extension.ts` `bridgeCall(..., 120_000)`）。
3. Bridge 记下 `environment_call_started`（`attempted_index=8`, ACTION1），**没有**对应的完成 `action` 事件。
4. **14:20:43** harness `errors.jsonl`：`The operation was aborted due to timeout`（距 decision 8 的 usage `14:18:43` 约 2 分钟，与 120s 一致）。
5. Extension 将该决策以 environment failure 结束，不把动作写入 trajectory（`trajectory` 仍停在 7）。
6. Runner 下一轮循环调用 `_bridge_state`；bridge 不可达 → **`stop_reason=bridge_unavailable`**（`arc_thin_e2e.py` 状态轮询分支）。
7. 关闭 bridge 时 `/close` 亦超时（`timeout=60`）→ `bridge_close_error: timed out`。
8. 写出 `summary.json`，进程结束。

**不是** `max_decisions`、`token_cap`、`deadline`、`win` 或 harness consolidation 触发停机。

### 3.2 墙钟时间线（UTC+8）

| 时间 | 事件 |
| --- | --- |
| 13:57:16 | 启动（meta `launched_at`）；PID 见 brief |
| 13:57:27 | `bridge-ready.json` / `run-config.json` |
| 13:57:30 | Pi session 起；`set_auto_compaction` **success**（`pi-events.jsonl` 首条 response） |
| 13:58:57 | D1 → ACTION1（idea: probe controls） |
| 14:00:53 | D2 → ACTION2 |
| 14:02:40 | D3 → ACTION3 |
| 14:05–14:13 | D4 长决策（含 skill / run_skill）；终 → ACTION4（confirm A4=right） |
| 14:15:22 | D5 → ACTION3（route to cross） |
| 14:17:30 | D6 → ACTION3 |
| 14:17:41 | D7 → ACTION3 |
| 14:17:42 | D8 context_budget 行；随后模型 turn |
| 14:18:43 | D8 usage（input 12528 / output 3125 / total 23077, stop=toolUse） |
| 14:20:43 | ACTION1 环境超时；`bridge-events` / `pi-events` / `errors.jsonl` 同刻更新 |
| 14:22:26–27 | `pi-stderr` touch；`summary.json` 落盘（含 close 超时等待） |

动作序列（成功写入 trajectory 的 7 步）：`ACTION1,2,3,4,3,3,3`。全程 `levels_completed=0`，无 level_changed。

---

## 4. Compaction 实际是否触发

**结论：本局没有发生 Pi native compaction。**

证据：

| 检查项 | 结果 |
| --- | --- |
| `set_auto_compaction` | 开启成功（`pi-events` `command=set_auto_compaction`, `success=true`） |
| `context_budget.jsonl` 中 `compaction_event: true` | **0 行**（仅有 13 条普通 budget 行） |
| `session_compact` / `session_compact_failed` 遥测 | extension 已挂钩并会写入 budget；本局 **无对应行** |
| `pi-events` 全文 | 无 compaction 相关事件类型；compact 字样仅出现在 set_auto_compaction 与 system preamble |
| 历史规模单调增长 | decision 1→8：`history_messages` 0→41，`history_text_chars` 0→6908；未见压缩后回落 |
| `summary.consolidations` | 0——这是 **harness memory consolidation 轮**（每 25 actions / level change），**不是** Pi compaction；勿混读 |

为何可能未触发（推断，标为推断）：context 体量相对模型窗口仍偏小（末决策 usage total ~23k；budget 文本量约 19k chars 量级），native auto-compaction 通常在接近上下文上限时才会跑。本局在触发阈值前就因 bridge 超时退出。

---

## 5. `--continuity-decisions 8`：误解 vs 实际语义

**查代码结论：它不是停机条件；本局停在 8 个 decision 是巧合。**

### 5.1 CLI / runner 语义

- `cli.py`：`--continuity-decisions N` 帮助文案为 *「with --continuity session, how many earlier decisions stay in view」*。
- `arc_thin_e2e.py`：写入 env `ARC_THIN_CONTINUITY_DECISIONS`；文档字符串：*session 模式保留 agent 最近 `continuity_decisions` 个 decision 的 session 视图（不含 reasoning）*。
- 停机分支里真正的决策上限是 **`max_decisions`**（本局 `null`）。达到时 `stop_reason=max_decisions`。本局 **不是** 该原因。

### 5.2 Extension 语义

`demo/arc_thin_extension.ts`：

- `continuityDecisions = max(1, floor(ARC_THIN_CONTINUITY_DECISIONS || 8))`
- `historyMessages()`：`starts.slice(-continuityDecisions)`——只截取投影进模型上下文的历史决策条数。
- 提示文案：*「Your last N decisions stay in view … older ones … are not carried forward.」*

### 5.3 对本局的含义

| 说法 | 对错 |
| --- | --- |
| 「因为 `--continuity-decisions 8`，跑满 8 个 decision 就停」 | **错**（与代码不符；`stop_reason` 也不是 `max_decisions`） |
| 「8 只是 history 窗口，停机是 bridge 超时」 | **对** |
| 「数字碰巧相等，容易误读」 | **对**——启动命令带了 `8`，summary 也是 `decisions: 8`，报告/口头易混 |

另外：本局最多只有 7 个更早决策可进窗口，窗口参数尚未真正「挤掉」更老决策；compaction 验证目标下，该参数也未与 native compact 触发耦合。

---

## 6. 相对 compaction 验证目标：能证明 / 不能证明

对照终稿与 probe 报告的 Phase 5 意图（真实 ARC 上验证启用路径与净收益），本局边界如下。

### 能证明

1. **启用路径可接线**：真实 yibu + Pi 0.87.0 + `--continuity session` + `ARC_THIN_AUTO_COMPACTION=1` 能启动；`set_auto_compaction` 被 Pi 接受。
2. **Session continuity 在真跑中生效**：`context_budget` 显示跨决策 `history_messages` 累积；skills/memory/ledger 有真实写入。
3. **失败模式可观测**：环境 `/action` 120s 超时 → decision 空动作 → bridge 不可用 → runner 以 `bridge_unavailable` 收束；产物完整可审计。
4. **与 offline probe 的区分**：probe 已证明「强制 compact 后 summary 能进下一轮请求」（V1–V5）；本局证明「自动路径在短局内未必会触发」。

### 不能证明

1. **Native compaction 在真实 ARC 负载下会自动发生**（本局 consolidations/compaction_event 均为空）。
2. **投递修复（3b）在真实 provider 请求中的效益**（没有 `compactionSummary` 可投递）。
3. **输入收据改写（3c）在真跑 compact 准备阶段的效益**（未进入 `session_before_compact`）。
4. **对通关/进度/token 净收益**（0 关完成；在 compact 前就因 infra 失败退出）。
5. **「uncapped」长程行为**（约 25 分钟、8 decisions 即因 bridge 挂掉；未接近 12h 墙钟或大上下文）。

一句话：**这是「自动 compaction 启用 + session continuity 真跑」的短程烟雾与失败复盘，不是 compaction 净收益验证。**

---

## 7. 若以后要重跑：建议改哪些参数（只建议，不执行）

按优先级：

1. **先修 / 加固环境超时路径**  
   - 查 ARC bridge/SDK 为何 ACTION1 在 ~120s 无响应（网络、SDK hang、单步过慢）。  
   - 评估是否需要更长的 `/action` 超时、bridge 健康探针，或超时后 bridge 可恢复而非直接 `bridge_unavailable`。

2. **去掉容易误导的「8」耦合**  
   - 真跑不要依赖默认 `--continuity-decisions 8` 与「决策数」口头对齐；可显式加大窗口（如 16/32）或在报告中固定写清「窗口 ≠ 上限」。  
   - 继续保持 `max_decisions` / `max_actions` / `max_reported_tokens` / `--experiment-timeout` 为空，若仍要 uncapped。

3. **为 compaction 创造可观测触发条件**（在环境稳定之后）  
   - 更长局（更多 decisions / 更大 history），或临时调低 Pi compaction 阈值阈值（仅诊断用，需单独记录，避免与产品默认混淆）。  
   - 跑后硬门禁：`context_budget` 至少 1 条 `compaction_event`，并抽样下一轮 provider 请求是否含 summary（复用 probe 判据）。

4. **对照实验**  
   - 同预算：`session+auto_compaction` vs `session` 关 compact vs `rebuild`；否则无法谈净收益。  
   - `lp85` 等第二局等 ls20 环境稳定后再开（按当前产品决策）。

5. **观测字段**  
   - 保留并优先看：`compaction_event`、`reported_tokens`、history 体量拐点、`stop_reason`、environment errors；勿把 `consolidations`（harness）当成 Pi compact 计数。

---

## 附录：关键产物路径

```
runs/pi-arc-thin-ls20-session-compaction-uncapped-20261012-135716/
  summary.json
  run-config.json
  bridge-events.jsonl
  pi-events.jsonl
  harness/context_budget.jsonl
  harness/trajectory.jsonl
  harness/errors.jsonl
  harness/usage.jsonl
.scratch/codex-runs/phase5-ls20-20261012-135716.{log,json}
```
