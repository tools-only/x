# ARC `layered` profile：对齐 Duck 后的设计与开发方案

日期：2026-11-23（Asia/Shanghai）。状态：设计，未实现。

## 0. 定位

- **优先级**：[设计文档 v0.4](2026-11-23-arc-agi-3-layered-design-v0.4.md) 最高，本文其次，[迁移方案](2026-11-23-arc-evo-layered-migration.md) 再次。迁移方案的"为什么迁、现状盘点、证据"仍然有效；第 3–5 节的实现细节以本文为准。
- **Duck 的作用是校准**：
  - 设计文档没有规定、或现有代码偏离 Duck 的地方，按 Duck 的实际实现来做。
  - 设计文档明确做了不同取舍的地方，保留设计文档的做法，同时在配置开关里提供 Duck 的做法作为对照组。
- **依据**：
  - Kaggle discussion 717133。
  - Duck 公开代码 `Tufalabs/duck-harness`（主要读了 `ARC3-Inference/inference/agent/{python_tool_sandbox,tool_agent,prompts,vision_context,action_names}.py` 和 `configs/inference.json`）。
  - 该仓库没有 LICENSE 文件，所以**只借鉴做法，不复制代码或提示原文**。
- 本文管的范围：同一个 `layered` profile 的 L1 接口、L2 机制、L3 装配，以及建在它上面的自进化。旧 evo 路径冻结，只作为对照组。

## 1. Duck 实际是怎么做的（代码核对）

原帖之外，从代码里确认了这些细节：

| 方面 | Duck 的实现 |
|---|---|
| 内核 | 每次 `python` 调用启动一个全新子进程（`python -I -S`），把状态以 JSON 注入。builtins 和可导入模块都走白名单（14 个标准库，**没有 `open`，不能读写文件**）。超时 30 s。输出截到 `tool_output_tokens × 4`（默认 1024 → 4096 字符），末尾加 `[truncated N chars]` |
| 变量 | `current_frame`（别名 `latest_frame`）、`previous_frame`、`history`（`.action` / `.frame` 列表）、`transitions`（`.before_frame` / `.after_frame` / `.result`）、`last_transition`、`last_action`、`last_action_frame`、`valid_actions`、`last_action_result`。代码末尾可以给 `result` 赋值作为返回 |
| 帧 | 只有 `.ascii`（字母编码的颜色）、`.segmentation`、`.step`、`.level`、`.shape`。**刻意不暴露数字网格** |
| 分割 | 4-连通同色对象：`id`、`color`、`hash`（与位置无关的形状和颜色签名）、`pixels`、`boundary`、`children`，外加 `adjacency_list` |
| 行动 | `action(actions)`，参数是自然名列表，`MOUSE` 用 `row` / `col`。经宿主往返执行，返回后**立即刷新全部变量**，同一段代码可以接着观察 |
| 终止保护 | 同一段代码里，一旦某次行动出现关卡完成、GAME_OVER 或通关，后续的 `action()` 一律不执行，返回 `stopped_early` |
| 回合 | 一条 user 消息加最多 12 次工具调用。哪次调用真正执行了动作，这一回合就结束。下一回合用新的 user 消息开始 |
| user 消息 | 上一批执行了哪些动作（前 10 个）、是否升关 / 结束、当前 step 和 level、`valid_actions`、工具用法提醒、世界模型块，以及当前帧图像（4×） |
| 不调工具 | 追加一条"还没行动，先调查"的提示，让模型继续 |
| 世界模型 | 从 assistant 文本里抽取 `World model / Goal model / Action model / Recent findings / Open questions / Plan / Cross-level notes` 这几个标签块，写进下一条 user 消息，模型覆盖之前一直保留 |
| 上下文 | 窗口配置为 32768，预算等于窗口减去回复预留。超出时从最旧的块开始删，系统提示永远保留。持久历史最多保留最近 30 个 assistant 轮 |
| 提示 | 游戏概览、变量语义（重点讲 `history[-1].frame` 就是当前帧）、视觉提示（HUD 计时条、不要假设有玩家、不要以绝对坐标为目标）、Python 指南（以分割为主视图、不要打印整板、目标清楚后用 BFS 搜索、批量动作）。**没有计分和成本的说明** |
| 运行 | 每局墙钟 45 分钟，每局重复 20 次；Qwen 3.6 27B FP8 + vLLM，开启 prefix caching |

## 2. 对齐决策

"以设计文档为准"的地方都配了开关，Duck 的做法可以作为消融的一组。

| 项 | Duck | 设计文档 v0.4 | 现有代码 | 本方案 |
|---|---|---|---|---|
| 主入口 | 只有 `python` | 只有 `python` | 十几种工具 | **对齐**：只注册 `python` |
| 变量名 | 见第 1 节 | 采用 Duck 的命名，另加 `.grid`、`.state`、`frames_of` | `state / grid / prev_grid / history / env` | **对齐 Duck 命名**，加上设计文档的扩展；旧名字不进入 `layered` |
| 数字网格 | 不暴露 | `.grid` 是 64×64 数组 | 暴露 | 以设计文档为准，暴露 `.grid`；提示仍以分割为主视图。开关 `numeric_grid` |
| 行动函数 | `action(actions)` | `submit_actions(...)`，一个概念只保留一个名字 | `arc_action` 工具加 `env.act` | 以设计文档为准，用 `submit_actions`；接受自然名字符串和字典 |
| 同一调用内刷新 | 有 | 有 | **只刷新 `env.grid`** | **对齐**：P0 必修 |
| 终止保护 | 升关、结束或通关后，同段代码不再执行动作 | `stop_on` | 无 | **对齐**：升关、GAME_OVER、WIN 时强制停止，本次调用内后续的 `submit_actions` 不执行；`stop_on` 可以额外加条件 |
| 内核生命周期 | 每次调用一个新进程 | 默认每局持久，系统变量每次重绑定 | WASI 持久会话（开关） | 以设计文档为准：每局一个 WASI 进程。`namespace_reset_per_call` 默认关；打开时每次调用使用新的命名空间，即 Duck 做法 |
| 文件 | 不能读写 | 内核有工作目录，可以读写文件 | 宿主有 `file` 请求通道 | 以设计文档为准：`open()` 在 `work/` 下由宿主代理，复用 kernel 的 `file` 请求，**不开放宿主目录** |
| 限制 | 30 s / 4096 字符 | 30 s / 4096 字符 | 20 s；部分输出按字节限制 | **对齐**：30 s，输出截断到 4096 字符，末尾标注截掉了多少 |
| 库 | 14 个标准库 | "几个标准库" | WASI 版 CPython 的完整标准库，没有 numpy | 保留现状；numpy 放到 P3 消融 |
| 动作名 | 自然名；不提供 UNDO | 自然名加原始 id；UNDO 默认关 | 原始 id | **对齐** |
| MOUSE 坐标 | `row / col` | `x = 列, y = 行` | `x / y` | 以设计文档为准，用 `x / y`，同时接受 `row / col`；在第一个点击类游戏上验证一次 |
| 回合结构 | 执行了动作的调用结束本回合，下一条 user 消息带新状态 | 每次动作后注入 user 消息；循环用 B 加 C | 每个决策一次 prompt，以一个动作结束 | **对齐**：执行了动作的 `python` 调用返回后，通过 steer 注入状态消息；同一个 Pi run 继续 |
| 不调工具 | 提示"还没行动" | 循环 B 续航 | 无 | **对齐**：`agent_before_settle` 在 `!done && budgetOk` 时续航，续航消息就是这条提示 |
| 世界模型 | 7 种标签块 | `World model:` 标签 | `memory` 工具 | **对齐**：抽取同样 7 种标签，携带到下一条状态消息，并用 `pi.appendEntry` 持久化 |
| 图像 | 最新帧，4× | 最新帧；Kaggle 4×，API 8× 加刻度 | CH 视图 PNG | **对齐**：只附最新帧，放大倍数按配置档 |
| 上下文 | 预算淘汰加 30 轮上限 | 淘汰 → 折叠 → 摘要 | 每个决策重建 | **对齐**：P1 只做淘汰；折叠和摘要放到 P3；30 轮上限暂不采用 |
| 提醒 | 每条消息重复工具用法和世界模型指令 | 小模型保留，强模型先去掉 | 无 | 以设计文档为准：`kaggle-local` 保留，`api-research` 去掉 |
| 守卫 | 只有终止保护 | 双 RESET、GAME_OVER 后只允许 RESET、预算 | bridge 预算 | 以设计文档为准，全部放在 `submit_actions` |
| 提示内容 | 领域提示，无计分说明 | 附录 C：计分与成本加 Duck 提示 | evo 能力目录 | 以设计文档为准，补充 Duck 的视觉和 Python 提示（改写，不照抄） |

## 3. 对齐后的分层与文件

| 层 | 内容 | 文件 |
|---|---|---|
| L1 环境 | 官方 SDK、预算、lease、NOT_PLAYED 自动 RESET | `src/autoresearch_pi/arc_agi_3_bridge.py`（保留） |
| L1 内核 | 每局一个 WASI 进程；`act` / `file` 宿主请求；30 s；输出截断 | `demo/pi_task_python_kernel.{ts,py}`（保留，限制做参数化） |
| I1 Python 接口 | 帧类、变量、`submit_actions`、helper、`work/` 文件代理、`harness/lib` 加载 | 新增 `demo/arc_layered_prelude.py`（在 guest 内执行） |
| L2 | `python` 工具；宿主端行动处理（守卫、记账、状态刷新载荷）；状态消息注入；淘汰；标签抽取；续航；事件；进化记录 | 新增 `demo/arc_layered_extension.ts` |
| L3 | 系统提示、状态消息模板、两套配置档 | 新增 `demo/prompts/arc_layered_system.md`、`arc_layered_state.md`；runner 参数 `--profile layered --config {kaggle-local,api-research}` |
| 运行与评测 | 一局一个 Pi 会话；分段点；摘要；复用指标 | `src/autoresearch_pi/arc_thin_e2e.py` 增加 `layered` 模式；复用 `arc_thin_reuse_report.py` |

原则：
- L3 不直接碰 bridge，只通过 `submit_actions`。
- L2 不写死阈值，阈值都来自配置档。
- 旧扩展 `arc_thin_extension.ts` 不改。

## 4. I1：Python 接口规格

### 4.1 变量（每次调用开始时由 prelude 重新绑定，只读）

- **`current_frame`**，`previous_frame` 结构相同：
  - `.ascii`：字母编码。
  - `.grid`：受 `numeric_grid` 开关控制。
  - `.segmentation`：格式同 Duck，即 `nodes`（`id / color / hash / pixels / boundary / children`）加 `adjacency_list`，懒计算。
  - `.level`、`.step`、`.shape`、`.state`。
- **`history`**：`history[i].action`、`history[i].frame`。`history[-1].frame` 就是当前帧。
- **`transitions`**、`last_transition`、`last_action`、`last_action_result`。
- **`valid_actions`**：自然名，例如 `["UP", "DOWN", "MOUSE"]`；原始 id 写在 `valid_actions_raw`。
- **helper**：只有 `segment(grid)`、`diff(a, b)`、`ascii(grid, region=None)`、`frames_of(step)`。不加其他 helper（Duck：手写工具会妨碍模型）。
- **传输**：
  - 持久进程里的 `history` 由宿主增量追加，不必每次调用重发全部帧。
  - 打开 `namespace_reset_per_call` 时，只重建命名空间，历史数据仍留在进程里，因此不会撞上 128 KB 的输入上限。

### 4.2 `submit_actions(actions, stop_on=None, expect=None, reasoning=None, confirm_full_reset=False)`

- **参数**：
  - `actions` 可以是 `"UP"`、`["UP", "LEFT"]`，也可以是 `{"action": "MOUSE", "x": 7, "y": 4}`；`row` / `col` 等价于 `y` / `x`。
  - 一次最多 16 个动作，沿用 bridge lease 的上限。
- **执行**：逐步发出 `act` 宿主请求。每一步返回后，都要先刷新 4.1 的所有变量，再判断是否停止。
- **强制停止**：
  - 升关、GAME_OVER、WIN 时立即停止。
  - 本次调用中之后的 `submit_actions` 返回 `executed=0, stop_reason="previous_level_change|game_over|win"`。
- **可选停止**：`stop_on`，例如 `"change"`、`"no_change"`，或一个谓词 `lambda prev, cur: ...`。
- **返回值**：
  - 每步一行：动作、改变了多少格、level、state。
  - 汇总：`executed_count`、`stopped_early`、`stop_reason`。
  - 同样的内容写入 `last_action_result`。
- **宿主端守卫**（L2，不可绕过）：
  - 非竞赛模式下，连续第二次 RESET 需要 `confirm_full_reset=True`。
  - GAME_OVER 之后只允许 RESET。
  - UNDO 由开关控制。
  - 预算用尽时拒绝执行，并返回原因。
- `expect`：P1 只记录不比对；P3 才实现比对和 SURPRISE 事件。

### 4.3 `python(code)` 工具

- **schema**：只有 `code`。
- **返回**：stdout 或 `result`，截断到 4096 字符。如果执行了动作，再附一行环境状态。
- **报错**：只保留用户代码的 traceback（与 Duck 相同）。
- **超时**：30 s。超时会终止该单元；持久模式下要重建 kernel，并在返回中说明命名空间已经丢失。
- **文件**：`open(path)` 只允许 `work/` 下的路径，由宿主代理读写。单文件 256 KB，整个工作区 4 MB。

### 4.4 现有代码的改动点

- `pi_task_python.ts`：`layered` 的 `timeout_ms` 用 30_000，不超过现有硬上限。
- kernel 的 `file` 请求：限定 `work/` 根目录和大小上限。
- bridge：双 RESET 守卫先核实 bridge 是否已有，没有再加到 L2 的行动处理里。

## 5. L2：机制规格

### 5.1 回合与消息（对齐 Duck）

```
run 开始：system（附录 C）+ user（初始状态消息 + 最新帧图像）
模型 → python(code) → 工具结果
  若本次调用执行了动作：steer 注入状态消息（下一次请求之前送达）
  若未执行：不注入，模型继续调查
模型不调工具且未结束：agent_before_settle 续航，续航消息 = "还没行动"提示 + 状态消息
```

**状态消息**，模板由 L3 给出：
- 上一批执行的动作（前 10 个）和停止原因；
- 是否升关、GAME_OVER 或 WIN；
- 当前 level、step、已用动作和预算；
- `valid_actions`；
- 世界模型块；
- 最新帧图像；
- `kaggle-local` 额外附工具用法提醒。

### 5.2 上下文淘汰

- 在 Pi 的 `context` 事件里裁剪本次请求看到的消息，session 文件保留全部内容。
- 估算超过 `context_target`（`kaggle-local` 为 32k，`api-research` 按模型窗口）时，删除最旧的 user 消息及其后的 assistant 和工具轮，直到回到目标以内。
- 系统提示和最近一条状态消息始终保留。一组工具调用和它的结果必须一起删除。
- 关闭 Pi 自带的编码向 compaction（设计文档 2.4）。
- provider 报上下文过长时，再删一块后重试一次。这与 Duck 相同，算普通的边界处理，不另加机制。

### 5.3 记忆

- **标签**：抽取 7 种标签块，覆盖式更新，写进下一条状态消息，并用 `pi.appendEntry` 持久化。
- **文件**：`work/notes.md`、`work/harness/*`（见第 7 节）。不常驻，需要时由模型自己读取。
- **bridge 历史**：作为原始事实，`history` 从这里重建。

### 5.4 续航与分段

- 段内用 B 续航：`!done && budgetOk` 时续航；连续 N 次续航都没有动作就停止该段（N 由配置给出），防止空转。
- 段间用 C 分段：升关、`length` 停止、墙钟或 token 软上限时，由 runner 开启下一个 prompt。会话保持同一个。
  - 分段点也是 `work/harness/prompt.md` 的激活点。
- 终止：WIN；动作、token 或墙钟预算用尽；连续 provider 错误；人工中止。

### 5.5 事件

- P1 只有 LEVEL COMPLETE、GAME_OVER、BUDGET 三种，作为状态消息里的一行，不另开回合。
- SURPRISE 和 STUCK 放到 P3。

### 5.6 遥测

- 复用 request accounting 和 provider telemetry。
- 新增指标：每次 `python` 调用的耗时、是否行动、执行动作数、停止原因、输出是否截断；淘汰次数和删掉的 token 数。

## 6. L3：装配

### 6.1 系统提示（`arc_layered_system.md`）

按设计文档附录 C 的顺序：角色与目标 → 计分与成本 → 环境契约 → Python 接口 → 方法 → 反幻觉提示 → 先验目录 → 输出协议。Duck 的以下经验用自己的话写入：
- 变量语义陷阱：`history[-1].frame` 是当前帧；比较前后两帧用 `previous_frame` 或 `last_transition`。
- 以分割为主视图；`.ascii` 只读小区域；不要打印整板。
- 边缘的条带通常是 HUD 或计时器，不是可点击的对象；不要假设存在玩家；不要以绝对坐标为目标。
- 目标清楚以后写搜索（BFS 等）；可靠的序列可以批量执行；遇到升关或结束，先重新观察再行动。
- 世界模型标签的用法：行动前先给出修订后的世界模型。

### 6.2 配置档

| 参数 | `kaggle-local` | `api-research` |
|---|---|---|
| 模型 | 本地 Qwen（P5） / az qwen3.8-27b | gpt-6-luna 等 |
| 图像 | 最新帧 4× | 最新帧 8×，加网格线和坐标刻度 |
| 上下文目标 | 32k（上限 64k） | 按模型窗口 |
| 提醒 | 重复工具用法和世界模型指令 | 不重复 |
| `namespace_reset_per_call` | 关（以设计文档为准；Duck 做法作为消融） | 关 |
| `numeric_grid` | 开 | 开 |
| 世界模型 | 标签为主，可执行模型做 A/B | 可执行模型（`world_model.py`）加标签 |

### 6.3 Duck 同款对照组

- 把 `namespace_reset_per_call`、提醒、4× 图像全部打开，`numeric_grid` 关掉，并去掉计分说明。
- 这组用来回答"我们的偏离是否有收益"。P3 开始跑，不进入 P1。

## 7. 自进化：建在对齐架构上

定义沿用迁移方案第 3 节：Agent 在普通任务轮写文件，宿主在明确的边界激活这些文件，并记录版本和使用情况；跨局保留什么由评测决定。不设 Meta 窗口，也不提供 `reflect_*` 工具。

### 7.1 载体与激活

| 组件 | 文件 | 激活 | 失败时 |
|---|---|---|---|
| helper / 工具 | `work/harness/lib/*.py` | 下一次 `python` 调用开始时由 prelude 加载进命名空间 | 保留上一版，在工具结果里报告一行 |
| 可执行世界模型 | `work/harness/lib/world_model.py`，配 `test_world_model(history)` | 同上 | 同上 |
| observer | `work/harness/observers/*.py`，入口为 `process(obs, state) -> {facts, state}` | 每次动作后在宿主沙箱里运行，facts 并入状态消息，最多 1024 字符 | 回退到原始观测 |
| 笔记 | 回复中的标签块；`work/notes.md` | 下一条状态消息自动携带标签块；笔记由模型按需读取 | 无 |
| skill | `work/harness/skills/*.md` | 每段开始时列出名称，正文按需读取 | 无 |
| prompt 叠加 | `work/harness/prompt.md` | 下一个分段点追加到系统提示末尾 | 超长时截断并报告 |

### 7.2 与对齐设计的配合

- **两种命名空间模式下，持久化都靠文件**：
  - 打开 `namespace_reset_per_call`（Duck 模式）时，文件是跨调用复用代码的唯一途径，自进化就是正常玩法的一部分。
  - 持久模式下，函数也会留在命名空间里。但 kernel 重建或超时之后，只有文件还在。提示里建议"想留下的代码写进文件"。
- 加载 `harness/lib` 的方式和系统变量重绑定一样，都在调用开始时完成，不新增回合。
- 宿主在每次调用结束后对比 `work/harness` 的变化：
  - 做语法和 import 检查；
  - 用 git 记录版本；
  - 向 `work/harness/evolution.jsonl` 写一行：路径、哈希、决策序号、动作序号。
- helper 调用次数、observer 运行次数只写入 jsonl，**不注入上下文**。
- 唯一的提示是关卡完成事件后请模型写 2–3 行笔记，没有强制复盘。

### 7.3 跨局

- 局末导出 `work/harness` 快照和指标。
- 候选内容只有在 held-out 游戏上多次重复、确认有增益后才能晋升。
- 晋升后以只读方式预装到下一局的 `work/harness/lib/base/`，Agent 可以覆盖。
- 本方案到 P4 才做这一步。

## 8. 开发阶段

每个阶段只改一个主要因素。"真实路径"指至少用真实环境跑通一次，mock 不算。

| 阶段 | 内容 | 验收 | 真实路径 | 预计 |
|---|---|---|---|---|
| **P0 I1 接口** | `arc_layered_prelude.py`（帧类、变量、分割、`submit_actions`，含同一调用内刷新和强制停止）；宿主端行动处理（守卫、记账）；30 s 和 4096 字符限制；`work/` 文件代理 | Node 定向测试：同一调用内 `submit_actions` 之后 `current_frame` 已经变化、升关后不再执行、双 RESET 被拦、截断标注正确 | 本地 OFFLINE SDK 加 bridge，跑一段脚本化的 `python` 代码，例如在 ls20 上走几步并读取新帧。**不调用模型，不花钱** | 250–300 行 |
| **P1 `layered` 最小闭环** | 扩展只注册 `python`；系统提示和状态消息模板；steer 注入；淘汰；标签抽取；续航；runner 的 `layered` 模式和分段；关闭 Pi 自动 compaction | 第 9 节的对照 | 真实 provider 跑 1 局短预算冒烟，然后做正式对照。**需要付费授权** | 400–600 行（理由见迁移方案第 7 节） |
| **P2 任务内进化** | 第 7.1 和 7.2 节：加载 `harness/lib`、变更检查、git 版本、`evolution.jsonl`、observer 迁移到文件约定 | 与 P1 相比只改这一个因素：在出现重复计算的游戏上，每动作 token 和重复扫描减少，关卡数不退化 | 真实 provider | 约 250 行 |
| **P3 消融** | 逐项单独比较：Duck 同款对照组；`namespace_reset_per_call`；`numeric_grid`；提醒；折叠和摘要；`expect` 加 SURPRISE；STUCK；numpy | 每项单独比较，有正收益才保留 | 真实 provider | 逐项估算 |
| **P4 跨局** | 局末导出，held-out 晋升，预装 | held-out 上预装库不差于空库 | 真实 provider | 后续估算 |
| **P5 Kaggle** | 本地 vLLM 加 Qwen；评估要不要把 L2 移植到 Python | 9 小时内跑完 110 局 | Kaggle 环境 | 后续估算 |

## 9. P1 实验协议

- **对照**：`layered` + `api-research` 对比冻结的 evo 默认路径。这是一组整体改动，P1 不拆分；单因素比较从 P2 开始。
- **模型与游戏**：建议 gpt-6-luna，游戏 su15、ls20、ft09；两组的思考设置保持一致。如果 provider 稳定，再加 az qwen3.8-27b 并使用 `kaggle-local`。
- **样本与预算**：
  - 每组每个游戏至少 3 次，报告均值和离散程度。
  - 每次运行 30 万 reported token、60 分钟墙钟；动作上限沿用 5× 基线。
  - provider 失败的样本单独列出。
- **指标**：
  - 关卡数、每关动作数、每动作 token、请求数；
  - 第一次有效动作的延迟；
  - `python` 调用中真正行动的比例、批量动作中被强制或可选停止截断的比例、输出截断率；
  - 淘汰次数。
- **负例**：provider 失败；`length` 停止；GAME_OVER 后恢复；批量走错；淘汰后世界模型标签是否仍在；模型提前结束；连续续航都没有动作。
- **推翻条件**：相同预算下关卡数更少，或者每动作 token 不降。

## 10. 待确认

1. 是否开始 P0：可逆，不花钱。开工前要先确认 worktree 里另一个会话留下的未提交改动归谁，P0 不碰这些文件。
2. P1 的付费对照：模型、游戏和预算是否按第 9 节执行。
3. `numeric_grid` 默认开（设计文档）还是关（Duck）。本方案按设计文档默认开，Duck 做法留作消融。

## 11. 证据层级

| 层级 | 状态 | 说明 |
|---|---|---|
| 功能正确 | 未验证 | 本文只是设计 |
| 全链路可达 | 未验证 | 无 |
| 自主采用 | 未验证 | 无真实运行 |
| 净收益 | 未验证 | 无对照 |

## 12. P0 / P1 实验记录（2026-11-23）

### 实现符合度

- `layered` 已实现设计文档里的单一 Python 工具、游戏状态变量、动作执行后刷新变量、唯一动作网关、最新帧图像、`World model:` 等标签携带、上下文淘汰与段内续航。
- API 图像已按配置画 8 格网线并标出坐标；`api-research` 提示说明坐标数字表示格子位置。PNG 尺寸和无标记的 `kaggle-local` 图像分别覆盖在 extension 测试中。
- 必要差异：Python 内核默认每局持久（设计文档决策）；`submit_actions` 默认每批最多 16 步并在终态停止；`expect` 目前只记录；Kaggle 本地 profile 的真实模型运行仍未验证。
- 2026-11-23 晚补齐的接口缺口（变量只读重建、`result` 返回、`show()` 图像通道、`work/` 模块 import、`history[i].changed/hash`、批量汇总写入 `last_action_result`、GAME_OVER 态的 `valid_actions` 收敛为 RESET）记录在
  [完全对齐路线图](2026-11-23-arc-layered-full-alignment-roadmap.md)，其中还列出了对齐设计 v0.4 的全部剩余开放项 O1–O13。

### 一次真实模型运行

| 项目 | 结果 |
|---|---|
| Profile | 新 `layered` 路径，`api-research` |
| Provider / 模型 / 推理 | `az` / `gpt-6-luna` / `low` |
| 游戏 / 次数 | `su15` / 1 次 |
| 环境结果 | 35 动作，完成 0/9 关，最终 `NOT_FINISHED`；中途触发一次 GAME_OVER |
| 运行成本 | 144.6 秒，provider reported 62,655 tokens；包含缓存口径的 token-cap 后停止 |
| 请求 | 11 次尝试，10 次完成、1 次预算拦截；Python 10 次，其中 7 次执行动作、0 次报错 |
| 环境 | 官方 bridge + Pi 0.87.0 + WASI kernel；scorecard 校验并正常关闭 |
| 产物 | `runs/arc-layered-su15-az-gpt6-luna-low-20261123/run1/summary.json`、`arc-scorecard.json`、`session.jsonl`、`harness/` |

本次是一次探索性自主使用，不与旧路径对照，不能推断净收益或一般表现。Pi 报的 context window 是 272k；用户隔离的 profile 保持未变；实验读取 `D:/autoresearch_pi_project/.env` 中的 provider 配置。此前 Luna 高推理模式的两类 Python 使用错误，本次低推理运行未出现同类错误，但单次结果不证明错误率下降。
