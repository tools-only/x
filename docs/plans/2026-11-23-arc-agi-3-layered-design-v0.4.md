# 基于 pi agent 构建 ARC-AGI-3 求解 agent：三层设计

> v0.4（2026-11-23）。在 v0.3（`ARC-AGI-3-pi-agent-design.md`）基础上，结合 Tufa Labs 的 Milestone 1 冠军 writeup《Tufa Labs’ Winning Solution for ARC-AGI-3 Milestone 1》（Kaggle discussion 717133，下称 **Duck**）重新分层。
> v0.3 的 Prompt / Context / Harness / Loop 四层改为：**L1 系统 infra 与接口 → L2 agent infra → L3 agent 构建**，另设一个贯穿三层的**评测与改进**。ARC-AGI-3 事实清单、pi API 映射、代码骨架与来源原样移入附录。未核实的点仍标【未核实】。

---

## 0. 分层总览

### 0.1 三层与接口

```
┌──────────────────────── L3 agent 构建 ────────────────────────┐
│ 模型选择 · Prompt · Context 策略 · Harness 装配 · Loop · 世界模型方法 │   ← ARC 专用、最常改
└──────────────────────────────┬───────────────────────────────┘
                    配置与 hook 参数（I2）
┌──────────────────────── L2 agent infra ───────────────────────┐
│ 观测管线 · 上下文管理 · 记忆机制 · 回合注入 · 动作网关/守卫/预算     │   ← 通用机制、参数化
│ 循环驱动 · 子代理编排（可选） · 遥测与回放                         │
└──────────────────────────────┬───────────────────────────────┘
          Python 接口 · 工具协议 · RPC · LLM 接口 · 环境接口（I1）
┌──────────────────────── L1 系统 infra ────────────────────────┐
│ 环境运行时 · Python 内核 · 沙箱 · 推理服务 · 进程与并发 · 存储 · 渲染 │   ← 无 agent 语义
└───────────────────────────────────────────────────────────────┘
                 贯穿：评测与改进（本地计分、多次重复、消融、回放）
```

划分依据：
- **L1** 只提供"能跑"的机制，不含任何 agent 决策：跑环境、跑代码、跑模型、存数据、把网格画成图。换一个任务它仍然成立。
- **L2** 是建立在 L1 之上的通用 agent 机制：上下文如何拼装与淘汰、记忆放在哪、事件如何进入回合、动作如何记账与守卫、循环由谁续航。它暴露参数，不决定参数。
- **L3** 用 L2 的机制组装出 ARC agent：选模型、写提示、定上下文策略与阈值、选工具面、设计方法与循环。它是改动最频繁、消融最多的一层。
- 两条接口：**I1**（agent 与系统之间）以 Python 命名空间和 `python` 工具为主；**I2**（L3 对 L2）是扩展配置与 hook 参数。上层只依赖下层接口，不直接碰下层实现——例如 L3 从不直接调用 `arc-agi` SDK，只调用 `submit_actions`。

与本仓库 harness 设计原则的对应：L3 的内容就是 prompt、skill、tools、subagent、memory 五类可修改组件；L1 是它们的"基础层"（表达、存储、执行入口、边界），L2 是"组织层"（何时可用、怎样进入上下文、如何调度与恢复）。

### 0.2 博客各部分归入哪一层

| Duck writeup 的部分 | 归入 | 在本文位置 |
|---|---|---|
| Design Principles（96 GB / 9 h / 110 局；开放权重模型；不编码具体游戏；轻量 harness、模型掌舵） | 约束：L1 资源包络 + L3 原则 | 1.1、2.1、4.0 |
| Related Works（Symbolica 递归子代理；RGB Agent 用 OpenCode + 日志文件） | L2 子代理编排、记忆；L3 取舍 | 3.7、3.3、1.2 |
| Harness Architecture（游戏即 Python 变量、REPL、动作回写变量、上下文淘汰、图像输入） | 跨层总览：L1 内核与接口 + L2 上下文 | 2、3 |
| Python Interface / Pre-loaded Variables / Actions | **L1 接口 I1** | 2.2 |
| REPL 每次调用重置、30 s 超时、4096 字符输出 | L1 内核 | 2.1、2.3 |
| "REPL 未完全隔离，可能任意代码执行" | L1 沙箱 | 2.1 |
| World Model（`World model:` 标签跨回合携带） | 机制归 L2 记忆，方法归 L3 | 3.3、4.6 |
| Context Construction（64k 上限、维持 32k、淘汰最旧轮次、prefix caching 未用好） | **L2 上下文管理**；阈值归 L3 | 3.2、4.3 |
| System Prompt Construction | L3 Prompt | 4.2 |
| User Response Construction（每次动作后的 user 消息） | 机制归 L2 回合注入，内容归 L3 | 3.4、4.2 |
| Multimodality & Segmentation（4× 放大图、16×16 patch、分割工具） | 渲染原语 L1；观测管线 L2；用哪种表示 L3 | 2.1、3.1、4.3 |
| 模型与服务（Qwen 3.6 27B FP8、vLLM、OpenRouter/OpenAI） | 推理服务 L1；模型选择 L3 | 2.1、4.1 |
| Results（25 局 × 20 次、方差、diagnostics.html、与 GPT 5.4 的成本对比） | 贯穿：评测与改进 | 5 |
| Discussion（手写工具反而有害；大量领域提示；感知与上下文待改进） | L3 取舍 + 待办 | 4.2、4.4、7 |

### 0.3 各层一句话

| 层 | 一句话设计 |
|---|---|
| **L1 系统 infra** | 每局一个 Python sidecar：官方 `arc-agi` SDK 跑环境，持久命名空间跑代码，`submit_actions` 是改变环境的唯一入口；推理走 pi-ai（API 或本地 vLLM 的 OpenAI 兼容端点）。 |
| **L1 接口** | 游戏即变量：`current_frame / history / transitions / valid_actions`；动作用自然名并保留原始 id；一个 `python` 工具，输出有上限、可带图像。 |
| **L2 agent infra** | 上下文按"淘汰 → 折叠 → 摘要"三级管理；记忆有标签携带、notebook、代码文件、状态图四种载体；每次动作自动注入状态消息；守卫与预算在动作网关里；pi 的 hook 负责续航与插话。 |
| **L3 agent 构建** | 先建模再行动：计分与成本写进提示，加上从 Duck 学到的反幻觉提示；每回合一张最新帧图像；工具面极简；方法写在提示里，harness 只管预算、守卫和事件。 |
| **评测与改进** | 同一配置多次重复、报均值与方差；单因素消融；按成本—分数两轴比较。 |

相对 v0.3 的主要修正：
- 结构改为三层，"Harness 层"拆开：环境、内核、沙箱、推理服务下沉到 L1；守卫、上下文、记忆、事件、续航归 L2；工具面选择、helper 取舍、阈值留在 L3。
- 新增 L1 的**推理服务**与**沙箱**，原稿没有覆盖。
- 上下文管理新增最简基线：Duck 的**按轮次淘汰**；折叠与摘要改为可叠加的升级。
- 记忆新增零工具成本的**标签携带**（`World model:`）。
- **持久命名空间与每次重置**作为显式取舍（2.3）；**UNDO 默认不暴露**（Duck 证据），改为可切换。
- Prompt 增加 Duck 总结的反幻觉、反误设目标提示。
- 评测改为多次重复 + 方差（Duck：同一提交在 Kaggle 上 0.77%–1.30%）。
- Kaggle 规格冲突得到解决：RTX Pro 6000、96 GB、9 小时、110 局任意顺序。

---

## 1. 约束与证据

ARC-AGI-3 的完整事实（交互格式、RESET 语义、计分、API / SDK、比赛）见**附录 A**。这里只保留驱动分层设计的部分。

### 1.1 设计约束

1. **计分是平方的效率比**，探索、RESET、GAME_OVER 之后的动作全记在当前关 → 动作必须经过网关统一记账（L2），能在模型里搜索的就不在环境里试（L3）。
2. **后面的关权重更高，未完成的关得 0** → 先通关再求效率，预算按"剩余关卡能否完成"来定（L3 Loop）。
3. **没有说明书** → 需要"假设—实验—验证"，验证的最佳载体是代码（L1 内核 + L3 方法）。
4. **64×64×16 的感知** → 给模型看图像，精细分析交给代码（L1 渲染 + L2 观测管线）。
5. **长时程** → 上下文是工作记忆，必须有淘汰或压缩（L2）。
6. **RESET 有陷阱**（两次连续 RESET 清空整局；GAME_OVER 后必须 RESET）→ 守卫放在 L2 网关，不依赖提示。
7. **隐藏评测** → 提示与 helper 不写任何具体游戏（L3 原则）。
8. **Kaggle 资源包络**：离线、RTX Pro 6000 96 GB、9 小时跑完 110 局（顺序任意）、每天 1 次提交 → 本地开放权重模型、吞吐与并发是 L1 的硬约束（Duck 的数字解决了 v0.3 中 6 h / 9 h、48 / 96 GB 的冲突）。

### 1.2 证据与它影响的层

| 证据 | 来源 | 影响 |
|---|---|---|
| 同一模型：持久内核 harness 66.7、通用编码 CLI 34.8、普通工具循环 0.17 | Tufa Seal（v0.3 记录） | L1：游戏即变量的代码接口是中心 |
| 世界模型 +2.7–4.2；棋盘图像 +2.7；写明动作成本 +1.9；分割 / framediff / 反思 / 审计 ≈ 0 | Tufa Seal 消融 | L3：建模方法、每回合图像、计分进提示；helper 按需 |
| Duck：REPL 每次调用重置，游戏变量重新注入；30 s / 4096 字符 | Duck | L1：内核生命周期是可选项（2.3） |
| Duck：64k 上限、维持 32k、淘汰最旧 user 消息及其后的 assistant 轮；无 compaction | Duck | L2：淘汰作为最简基线 |
| Duck：每回合注入 4× 放大的最新帧（对齐 Qwen 16×16 patch）；多帧或视频反而有害；看不到动画是已知缺陷（`sb26`、`tn36`） | Duck | L1 渲染倍数随模型；L3 默认只给最新帧 |
| Duck：分割工具在"连通域即语义单元"的游戏显著有帮助；但"手写专用工具总体没帮助，似乎妨碍模型创造力" | Duck | L3：工具面极简，分割保留为按需 helper |
| Duck：UNDO 不暴露，因为模型会大批量撤销、浪费动作 | Duck | L1 接口开关；L3 默认关 |
| Duck：必须写很多领域提示（能量条不是目标、不要臆造目标、不要把画面当 Atari / 经典精灵、不要整板打印、变量属性误用） | Duck | L3 Prompt |
| Duck：主要提升来自更好的基座模型和多模态 | Duck | L3 模型选择优先于 harness 细节 |
| Duck + GPT 5.4 vs Executable World Models agent：解出的游戏相近，Duck 便宜一个数量级 | Tufa 博客 | 能否解出主要看模型；成本主要看 harness |
| Duck 公开集 1.60 ± 0.45（25 局 × 20 次）；同一提交 Kaggle 0.77%–1.30% | Duck | 评测必须多次重复 |
| Symbolica：模型递归调用自身，每个子代理只执行有限动作，首日 36% | Duck Related Works | L2 子代理编排（可选） |
| RGB Agent：OpenCode + 全历史写入单个日志文件，grep / 读文件 / 跑 Python；先分析再排队有限动作；加可执行世界模型提示后 58.12% | Duck Related Works / Tufa 博客 | L2 记忆可以落在文件；L3 "分析后小批量行动" |
| 2025 预览赛冠亚军：变化预测 CNN、显式状态图（非 LLM） | v0.3 | L2 状态图与变化预测作为模型可调用的工具 |

---

## 2. L1：系统 infra 与接口

### 2.1 组件

| 组件 | 职责 | 关键参数与做法 |
|---|---|---|
| **环境运行时** | `arc-agi` SDK：`Arcade / make / reset / step`；scorecard 生命周期；录制 | OperationMode：开发用 `OFFLINE`（≈ 2000 FPS），竞赛语义测试用 `listen_and_serve(competition_mode=True)` 起本地网关，正式评测用 `NORMAL / ONLINE`；一批一张 scorecard（15 分钟空闲自动关闭） |
| **Python 内核** | 每局一个命名空间；`exec` + stdout 捕获 + 图像队列；文件读写 | 单次执行超时 30 s，输出上限 4096 字符（取 Duck 的数值，v0.3 是 8 KB）；每次最多 2 张图；生命周期见 2.3 |
| **沙箱与隔离** | 模型写的代码在这里执行 | Duck 明示其 REPL 未隔离、存在任意代码执行风险。最低要求：每局独立进程、独立工作目录、无网络（Kaggle 本来离线；API 研究时由 sidecar 进程而非内核持有 API key）、CPU / 内存 / 墙钟上限。容器级隔离留待需要时再加 |
| **推理服务** | 把模型变成可调用的端点 | API：pi-ai 直连 provider。本地：vLLM 提供 OpenAI 兼容端点，pi-ai 指向它；Duck 用 Qwen 3.6 27B FP8，最大上下文 64k；开启 prefix caching（Duck 自述未用好，是现成的吞吐收益） |
| **进程与并发** | 父进程调度多个对局 | 每局一个 Node 子进程（pi session）+ 一个 Python sidecar；并发度由 API 限速（600 请求 / 分钟）或本地 GPU 吞吐决定；Kaggle 上 110 局 / 9 h ≈ 每局 5 分钟 GPU 时间，必须多局并发共享 vLLM |
| **存储与录制** | 原始事实落盘 | SDK 录制 JSONL（帧 + reasoning）；pi session JSONL；sidecar 的 `history` 与工作目录文件；这些是回放、计分和 L2 记忆的底座 |
| **渲染原语** | 网格 → PNG | `render(grid, scale, ticks, labels)`；放大倍数对齐模型视觉编码器的 patch（Qwen 16×16 patch → 4×；v0.3 对 API 模型用 8× + 每 8 格网格线 + 0–63 坐标刻度）。只提供能力，用哪种由 L3 决定 |

### 2.2 接口 I1

**a. Python 接口（模型在 `python` 工具里看到的命名空间）**

统一 Duck 与 v0.3 的命名，一个概念只留一个名字：

| 名称 | 内容 | 来源 |
|---|---|---|
| `current_frame` / `previous_frame` | 帧对象：`.grid`（64×64 int8 数组）、`.ascii`、`.segmentation`、`.level`、`.step`、`.state` | Duck |
| `history` | `history[i].action`、`history[i].frame`、`history[i].changed`、`history[i].hash` | Duck + v0.3 |
| `transitions` | (state, action, state') 列表；`last_transition` / `last_action` / `last_action_result` | Duck |
| `result` 字段 | 已用动作数、当前关卡、`levels_completed / win_levels`、`state`、本步是否发生关卡切换或重置、`valid_actions` | Duck + SDK |
| `valid_actions` | 当前可用动作，自然名 + 原始 id，如 `UP(ACTION1)`、`MOUSE(ACTION6, x, y)` | Duck + SDK |
| `submit_actions(actions, stop_on=None, expect=None, reasoning=None, confirm_full_reset=False)` | **唯一改变环境的入口**；返回每步一行摘要并刷新上面所有变量 | v0.3（Duck 叫 `action`） |
| `frames_of(step)` | 某步的全部动画帧 | v0.3 |
| `segment / diff / ascii / show` | 感知 helper；`show` 把图像送回模型 | Duck + v0.3 |
| `graph_summary / bfs_graph / replay_to` | 状态图 helper（由 L2 维护） | v0.3 |
| 工作目录 | 模型自写的 `world_model.py`、`search.py` 等 | v0.3 |

接口决策：
- **动作命名**：用自然名（`UP / DOWN / LEFT / RIGHT / SPACE / MOUSE / RESET`）借用预训练先验，同时在 `valid_actions` 里保留原始 id，并在提示里说明"名称是惯例，效果要验证"。
- **UNDO（ACTION7）**：接口支持，由配置开关决定是否出现在 `valid_actions`。默认关（Duck 证据）；对强模型做 A/B。
- **坐标**：`MOUSE` 参数统一为 `(x=列, y=行)`，原点左上；首个点击类游戏上验证一次【未核实】。
- **系统变量只读**：每次调用前由内核重新绑定，模型改坏了也会在下一次调用恢复。

**b. 工具协议（LLM 侧）**

- `python(code)` → 文本（stdout 截断 + 若发生动作则附一行环境状态）+ `show()` 排队的图像。这是主入口，Duck 与 Seal 都只有它。
- 可选 `observe()`（免费看一眼当前帧）、`notebook(op, section, text)`（见 3.3）。是否启用由 L3 决定。
- 所有改变环境的工具在 pi 中标 `executionMode: "sequential"`。

**c. 进程间 RPC（pi ↔ sidecar，stdio JSON-RPC）**：`exec(code) → {stdout, images, status}`、`render(opts) → png`、`status() → line`，外加 sidecar 向上的事件流（关卡切换、GAME_OVER、守卫拦截）。pi 的 `--mode rpc` 不能注册工具，所以工具必须写在 TS 扩展里，由扩展调用 sidecar。

**d. LLM 接口**：pi-ai 统一接口；`ThinkingLevel`；图像块可以出现在工具结果中；`sessionId` + `cacheRetention` 控制缓存。

**e. 环境接口**：只有 sidecar 接触 `arc-agi` SDK；Base URL 显式配置（`three.arcprize.org` 已重定向【未核实】）。

### 2.3 取舍：持久命名空间 vs 每次重置

| | 每次调用重置（Duck） | 每局持久（Seal / v0.3） |
|---|---|---|
| 做法 | 每次 `python` 调用都是干净解释器，游戏变量重新注入 | 一局一个解释器，模型定义的函数和变量一直存在 |
| 优点 | 无状态污染，行为可复现；小模型不会依赖已失效的变量 | 模型可以逐步构建 `world_model.py`、搜索器，不必重复粘贴；对应消融中最大的一项（世界模型） |
| 缺点 | 跨调用复用只能靠文件或提示中的笔记 | 变量可能过期；需要"系统变量只读重绑定" |

**默认：每局持久**，系统变量每次重绑定，模型代码建议写进文件。保留一个 `kernel_reset_per_call` 开关，用于对小模型做 A/B。

### 2.4 pi 侧必须关闭或替换的默认项

- 默认编码助手系统提示 → `systemPromptOverride` + `appendSystemPromptOverride: () => []`。
- 默认工具 read / bash / edit / write / grep / find / ls → `noTools: "builtin"`（pi 的 `bash` 每次新进程，会诱导无状态路径）。
- AGENTS.md、skills、prompt templates、用户扩展的自动加载 → `noContextFiles / noSkills / noPromptTemplates / noExtensions`。
- 工具默认并行 → `executionMode: "sequential"`。
- 详细 API 签名见附录 B。

---

## 3. L2：agent infra

L2 的每个机制都参数化，参数由 L3 给出。

### 3.1 观测管线

把 L1 的原始帧变成模型可消费的表示，并决定"何时"进入上下文：

| 表示 | 生成 | 进入方式 |
|---|---|---|
| 图像 | L1 `render` | 每回合开始注入一张最新帧（Duck、Seal 都这么做）；参数：倍数、刻度、是否叠对象 id |
| 一行状态 | sidecar | 每次动作必返：`L2/5 · a=37 · NOT_FINISHED · changed=12 · SEEN #s12` |
| ASCII | `current_frame.ascii` / `ascii(grid, cell)` | 按需；同色宏格自动降采样 |
| 分割 | `current_frame.segmentation` / `segment()` | 按需；4-连通域，带邻接与父子关系（Duck）、包围盒、面积、形状哈希；点击坐标的来源 |
| diff | `diff(a, b)` | 每步摘要里内嵌压缩版，完整版按需 |
| 动画帧 | `frames_of(step)` | 按需（Duck 指出看不到动画会在部分游戏失败） |

### 3.2 上下文管理

**请求拼装顺序（缓存友好）**：`工具定义 → 系统提示（稳定）→ 历史（淘汰 / 折叠后）→ 记忆块 → 本回合状态与预算`。会变的内容一律不进系统提示。

**三级机制，可叠加**：

| 级别 | 机制 | 来源 | 成本与风险 |
|---|---|---|---|
| 1. 淘汰 | 超过目标长度（如 32k）时，删除最旧的 user 消息及其后的 assistant 轮，系统提示永远保留 | Duck | 实现最简单；被删的发现只能靠记忆机制保住 |
| 2. 折叠 | 旧工具结果确定性地改写成一行（`step 37 · ACTION3 · changed=12 · SEEN #s12`），只保留最近 K 帧图像；只改旧消息，前缀缓存仍可命中 | v0.3 | 需要 pi `context` hook；pi 不会自动裁掉旧图像 |
| 3. 摘要 | 达到窗口上限时用自定义摘要替换旧历史：固定任务块 → 摘要（记忆全文 + 轨迹要点 + 世界模型测试结果）→ 最近一轮 | Seal / v0.3 | 多一次模型调用；摘要会丢细节 |

其他规则：
- 推理内容保留在历史中，只在摘要时压缩（Seal 做法）；不在 `context` 里主动删除 thinking 块。
- 关卡边界是天然的重置点：可以主动压缩，或由 runner 开新 session 只带记忆与最后一帧。
- 本地 vLLM 下，稳定前缀 + 只改旧消息的折叠可以吃到 prefix caching；淘汰会让前缀在每次删除时整体失效。

### 3.3 记忆机制

| 载体 | 写入方式 | 进入上下文 | 来源 |
|---|---|---|---|
| **标签携带** | 模型在回复中写 `World model: …`，harness 抽出并附到下一条 user 消息，直到模型覆盖它 | 每回合 | Duck；零工具成本 |
| **notebook** | `notebook(op, section, text)`，patch 语义；分区 controls / entities / rules（带证据步号与置信度）/ goal_hypotheses / levels / open_questions / dead_ends | 每回合（或其摘要） | v0.3 |
| **代码文件** | 模型在内核工作目录写 `world_model.py` 等 | 不常驻，需要时读 | v0.3 / Seal |
| **事实存储** | sidecar 维护 `history`、`transitions`、状态图（节点 = 帧哈希，边 = 动作，frontier、最短路、重放序列）、可选变化预测器 | 通过 Python 接口查询 | v0.3 / 2025 冠亚军 |
| **日志文件** | 全历史写进一个文件，模型用 grep / Python 检索 | 不常驻 | RGB Agent |
| **跨游戏先验** | 游戏结束后的 3–5 条一般经验 → `priors.md` | 人工审阅、held-out 验证后才进系统提示 | v0.3 |

持久化：notebook 与标签内容用 `pi.appendEntry` 存为不发模型的自定义 entry，`session_start` 时从当前分支读回。

### 3.4 回合注入

- **每次动作后的 user 消息**（Duck）：环境变化、当前状态、`valid_actions`、是否发生关卡切换或重置、当前记忆块；内容模板由 L3 给出。
- **harness 事件**：SURPRISE（预测落空）/ STUCK（N 步无新状态）/ LEVEL COMPLETE / GAME_OVER / BUDGET。run 进行中用 `pi.sendMessage(..., { deliverAs: "steer" })`，空闲时用 `{ triggerTurn: true }`。
- 每条重复注入的提醒都有 token 成本，L3 只保留经消融证明有用的。

### 3.5 动作网关、守卫与预算

全部实现在 `submit_actions` 里，所以无论模型从哪条路径行动，记账都一致：
- **记账**：按关卡累计动作（与官方计分口径一致），上传 `reasoning` 载荷。
- **双 RESET 守卫**：非竞赛模式下第二个连续 RESET 需要 `confirm_full_reset=True`。
- **GAME_OVER 之后**只允许 RESET（及撤销，若开启）。
- **已知 no-op 拦截**：状态图中已证实无变化的 (state, action) 返回提示而不执行，可强制。
- **预测校验**：`expect`（变化格数区间、对象位移、`levels_completed` 变化，或一段断言代码）与实际比对，维护最近 10 步准确率，产出 SURPRISE 事件。
- **预算**：关卡软上限、游戏硬上限、token 与墙钟预算；阈值由 L3 给出。
- **自动开局**：NOT_PLAYED 时由 harness 自动 RESET，不占模型回合。

### 3.6 循环驱动

pi 的一次 `session.prompt()` 是一个 run，模型不再调工具时结束。三种续航机制：

| 机制 | 做法 | 风险 |
|---|---|---|
| A. 模型自驱 | 提示要求游戏未结束就不停 | 模型可能提前收工 |
| B. 扩展续航 | `agent_before_settle` 在 `!done && budgetOk` 时返回 `{ continue: true }` | 不带预算检查就是死循环 |
| C. runner 分段 | 每个 run 只负责一段（一关或一批实验），`agent_settled` 后 runner 决定下一段 | 每段多一次 prompt |

L2 提供 B 与 C 的挂载点；推荐段内 B、段间 C。Duck 的做法相当于 A + 淘汰：模型在推理、工具、行动之间自由迭代，直到通关或超时。

### 3.7 子代理编排（可选，MVP 不做）

Symbolica 的做法是让模型递归调用自身、每个子代理只执行有限动作。pi 没有内建子代理（有 `examples/extensions/subagent/` 示例）。如需引入，L2 提供：子代理的动作预算、只读或受限的命名空间视图、结构化结果回传；L3 决定何时委派。Kaggle 单 GPU 下子代理与主代理争抢吞吐，优先级低。

### 3.8 遥测与回放

- 全轨迹 JSONL：帧、动作、推理、token、费用、上下文快照。
- 上下文查看器：看模型每回合实际收到了什么（Duck 仓库自带 viewer，淘汰类 bug 靠它定位）。
- 自动诊断报告：按游戏 / 尝试的关卡热力图、分数分布（对应 Duck 的 `diagnostics.html`）。
- 本地计分：按官方公式重算（平方比、1.15 上限、关卡加权、未完成 = 0）。

---

## 4. L3：agent 构建

### 4.0 原则

- **模型掌舵，harness 轻量**（Duck）：给模型一个代码接口和必要事实，不给剧本。方法写在提示里作为建议，harness 只强制预算、守卫和事件，不硬编码阶段顺序。
- **不编码任何具体游戏**：提示、helper、先验都要通过 held-out 检验。
- **每加一样东西都要消融**：手写工具在 Duck 中整体无益，在 Seal 中 ≈ 0。

### 4.1 模型选择与推理配置

| 场景 | 模型 | 配置 |
|---|---|---|
| Kaggle 赛道 | 本地开放权重，Duck 用 Qwen 3.6 27B FP8（vLLM） | 上下文上限 64k、目标 32k；多局并发共享一个 vLLM；thinking 预算受 9 h 总时长约束 |
| 研究 / 公开与半私有集 | API 前沿模型 | 更大窗口；thinking level 按段调整（建模段高、执行段低） |

Duck 的经验是"主要提升来自更好的基座模型和多模态"，以及"能否解出看模型，成本看 harness"。所以换模型是最先做的实验，harness 优化主要以成本为目标。

### 4.2 Prompt

**系统提示（稳定、可缓存）**：
1. 角色与目标：没有说明的交互式解谜游戏，通关所有关卡且动作尽量少。
2. 计分与成本（消融 +1.9）：关卡分 = min((人类基线 / 你的动作数)², 1.15)；后面的关权重更高；未完成得 0；失败尝试、每次 RESET、GAME_OVER 后的动作都记在当前关；每关预算约 5× 基线。结论直接写出：先通关再求效率；探测动作与解题动作同价；能在模型里搜索就不在环境里试。
3. 环境契约：观测格式、动作自然名与原始 id、"名称是惯例需验证"、MOUSE 坐标约定、RESET 两种语义、多帧动画取最后一帧、关卡切换的表现。
4. Python 接口说明：变量、helper、`submit_actions` 是唯一行动入口、输出上限。
5. 方法：ORIENT → MODEL（规则进记忆，动力学写 `world_model.py` 并用 `history` 测试）→ PLAN（在模型上搜索，先写预测）→ EXECUTE / VERIFY（预测落空即停）→ 关卡完成后 2–3 行笔记。
6. **Duck 总结的反幻觉、反误设目标提示**：
   - 能量条 / 时间条不是目标，把它压到最低也不是目标。
   - 不要臆造目标（如"把方块移到某个固定位置"），目标要由证据支持。
   - 不要把画面解读成机器人、经典精灵或 Atari 式像素游戏。
   - 不要整板打印网格，用分割、切片或 diff 定位感兴趣区域。
   - 行动前先确认上一步发生了什么。
7. 先验目录（标为"待验证的先验，不是事实"）：方向键移动、SPACE 交互、点击选择或切换；常见目标形态（到达、收集或消除、颜色或形状匹配、填满图案、计数器归零、钥匙与门）；HUD 常在边缘。
8. 输出协议：每回合 2–4 行（状态 / 排序后的假设 / 本回合实验或计划 / 预测），然后调工具。

**每次动作后的 user 消息内容**（经 3.4 注入）：状态变化、`valid_actions`、关卡切换或重置、记忆块（`World model:` 或 notebook）。Duck 还会每次重复工具用法与世界模型指令，这对小模型的格式稳定有用；对强模型先去掉再看是否退化。

**措辞要点**：写"先预测再行动"而不是"小心行动"；规则附证据步号与置信度；复盘只要 2–3 行；对强模型不要过度规定格式，深度用 thinking level 控制。

**反模式**：保留 pi 的编码助手提示；写具体公开游戏的攻略；让模型从图里估像素坐标点击；不先建模就在环境里逐步试错；每关长篇复盘。

系统提示骨架见附录 C。

### 4.3 Context 策略

| 参数 | Kaggle 本地小模型 | API 前沿模型 |
|---|---|---|
| 每回合图像 | 最新 1 帧、4×、不加多帧或视频 | 最新帧、8× + 网格线与坐标刻度；最近 K = 2–3 帧保留图像 |
| 上下文上限 / 目标 | 64k / 32k | 按模型窗口，触发摘要前留 16k 余量 |
| 上下文机制 | 淘汰 + 折叠 | 折叠 + 摘要作为安全网 |
| 记忆载体 | 标签携带（`World model:`）+ 代码文件 | notebook + 代码文件 + 状态图 |
| 按需表示 | 分割、切片 | 分割、diff、动画帧、ASCII |

### 4.4 Harness 装配

- **工具面**：只起步 `python` 一个工具（Duck、Seal 一致）；`observe`、`notebook` 只有在轨迹显示模型反复为此写样板代码时才加。
- **helper**：保留 `segment`（Duck 证实对连通域类游戏有用）与 `diff`、`ascii`、`show`；状态图与 BFS 先只作为查询接口，不主动注入；变化预测器只在点击类游戏消融为正时启用。
- **接口开关**：UNDO 默认关；`kernel_reset_per_call` 默认关。
- **守卫参数**：关卡软上限（如首关 120、后续 150）；到软上限一半时注入 BUDGET 事件；墙钟软停（Seal 在预算前 10 分钟停）。
- **配置档**：`kaggle-local` 与 `api-research` 两套参数，分别对应 4.1 与 4.3 的两列。

### 4.5 Loop

```
Batch : 并发 N 局（每局子进程 + sidecar），一张 scorecard
Game  : while state ≠ WIN and budget → Level；关卡完成 → 2–3 行笔记 → 可选压缩（分段点）
Level : ORIENT → MODEL → PLAN → EXECUTE/VERIFY →（surprise → MODEL）→ 完成
Turn  : 一次推理 + 若干工具调用；事件经 steer 进入下一 turn
```

- **方法阶段由提示引导，不由 harness 强制**；harness 只在事件发生时插话。
- **粒度控制**：最近 10 步预测准确率 ≥ 80% 时允许 10–20 步的长序列，< 50% 时每次 1–3 步并重新观察。这与 RGB Agent 的"先分析再排队有限动作"一致。
- **卡死升级**（harness 事件阈值，例如 8 / 20 / 40 步无新状态）：提示换策略 → 提示在世界模型里穷举 → harness 对 frontier 做系统化探索、模型只分析结果 → RESET 或换思路 → 达到关卡预算则止损。
- **RESET 策略**：GAME_OVER 后只能 RESET；只有放弃本 run 时才整局重置（环境分取最好的 run）；开启 UNDO 时走错一步优先撤销。
- **终止**：WIN；动作、token 或墙钟预算耗尽；连续 API 错误；人工中止。

### 4.6 世界模型方法

两种形态，按模型能力选择：
- **文本笔记**（Duck）：`World model:` 标签，跨回合携带，模型自行覆盖。成本最低，适合小模型。
- **可执行模型**（Seal / RGB Agent 的可执行世界模型）：`world_model.py`（状态 → 动作 → 下一状态），`test_world_model(history)` 必须通过，然后在模型上 BFS。这是消融中收益最大的一项，前提是持久内核或文件持久化。

L3 默认：API 模型用可执行模型；小模型先用文本笔记，并 A/B 可执行模型。

---

## 5. 贯穿：评测与改进

1. **重复与方差**：每个配置在 25 个公开游戏上每局至少跑多次（Duck 每局 20 次），报告均值 ± 标准差；Duck 的同一提交在 Kaggle 上从 0.77% 到 1.30%，单次结果不能用来判断改动好坏。按游戏比较时可用"两次取最好"。
2. **划分**：公开游戏分 train / held-out；OFFLINE 模式跑，本地按官方公式计分；公开游戏的基线从 scorecard JSON 的 `level_baseline_actions` 回填。
3. **指标**：通关关卡数、每关动作数 / 基线、LLM 调用数、token 与费用（成本—分数两轴）、预测准确率、STUCK 次数、是否写出通过测试的世界模型。
4. **消融**：一次只改一个因素（提示块、helper、阈值、上下文机制、内核生命周期、UNDO 开关）；train 与 held-out 同时改善才合并；收益 ≈ 0 的删掉。
5. **失败归类**：用上下文查看器和回放器把失败分为感知 / 假设 / 世界模型 / 规划 / 预算 / 上下文丢失，按类改对应的层。

---

## 6. 实施路线

### 6.1 按层的里程碑

| 阶段 | 层 | 内容 | 验收 |
|---|---|---|---|
| M0 | L1 | sidecar：SDK OFFLINE + 持久命名空间 + Python 接口 + `submit_actions` 记账 + 录制 + 本地计分；随机 / 脚本 agent 跑通 | 能录制、能回放，本地分数与公式一致 |
| M1 | L1 + L2 最小 | pi 扩展：`python` 工具、每回合图像注入、动作后 user 消息、淘汰、守卫、续航；runner 单局 | 1–2 个公开游戏上模型能发现操控并过第一关 |
| M2 | L3 | 系统提示（含计分与 Duck 提示）、标签记忆、世界模型方法；两套配置档 | 公开集多次重复的均值超过 M1 |
| M3 | L2 升级 | 折叠、摘要、notebook、状态图 / BFS、预测校验、卡死升级、分段驱动 | 每项单独消融为正才保留 |
| M4 | 贯穿 | 并发、批量 scorecard、上下文查看器、诊断报告、held-out | 稳定的均值与方差 |
| M5（可选） | L1 + L3 | 本地 vLLM 服务、prefix caching、Kaggle 离线打包；子代理 | 9 h 内跑完 110 局 |

### 6.2 赛道选择

- **研究与公开 / 半私有集**：API 模型直接对应本设计。
- **Kaggle**：模型换成本地开放权重；L1 增加离线 vLLM 与离线打包。Node 运行时打进离线 notebook 有成本，更现实的路线是保留 L1 的 Python sidecar，把 L2 的上下文、注入、续航逻辑移植到 Python，直接作为 Kaggle agent。先用 pi 做研发，赛时再决定。
- 分数预期要分开看：Duck 在 Kaggle 上约 1.2%，前沿模型在公开集上是几十分。两条赛道的瓶颈不同：Kaggle 卡在模型能力与吞吐，API 卡在成本。

---

## 7. 风险与未核实

**L1**
- 公开 API 的实际主机（`three.arcprize.org` 已重定向，SDK 默认 `arcprize.org`）需落地时确认。
- REPL 隔离：模型代码可任意执行，至少做进程、目录、网络、资源限制。
- ACTION6 的 x / y 与列 / 行对应需在首个点击类游戏验证。
- 多帧动画与时间性动态会破坏"状态 = 末帧哈希"的假设。
- pi 同进程多 session 并发未见文档，按子进程隔离；pi 迭代快，锁版本并测 hook 签名。

**L2**
- `agent_before_settle { continue: true }` 没有预算守卫就是死循环。
- 淘汰会丢掉早期发现，依赖记忆机制补上；淘汰与 prefix caching 冲突。
- 公开 API 是否强制 5× 基线预算未核实，按"强制"处理。

**L3**
- Tufa 的消融来自开放权重模型和自建评测集，迁移到其他模型时数值会变；以自己的消融为准。
- Duck 自述"未在许多设计决策上做消融"，其提示经验是方向而非定论。
- 2025 冠亚军的非 LLM 方法说明"廉价探索 + 状态图"本身就很强；若 LLM 增益覆盖不了成本，应把更多决策下沉到 L2。

**待办（Duck 提出的改进方向）**
- 感知：编码模型不擅长读 ASCII 网格的局部，更适合抽象描述；如何把视觉信息转成有用的抽象格式是开放问题，分割是第一步。
- 上下文：用摘要或记忆替代单纯淘汰（对应 3.2 的第 2、3 级）。
- 动画：小模型看不懂多帧，但部分游戏依赖动画反馈。

---

## 8. 来源

Duck（本版新增）
- Kaggle writeup：https://www.kaggle.com/competitions/arc-prize-2026-arc-agi-3/discussion/717133
- 博客：https://tufalabs.ai/research/duck-harness
- 代码：https://github.com/Tufalabs/duck-harness （含 example-run 与 diagnostics.html；代码数据集 MIT，notebook Apache 2.0）
- Notebook：https://www.kaggle.com/code/jeroencottaar/taaf-duck-harness-kaggle-share
- 相关工作：Symbolica https://www.symbolica.ai/blog/arc-agi-3 ；RGB Agent https://blog.alexisfox.dev/arcagi3 ；Recursive Language Models https://arxiv.org/abs/2512.24601 ；CodeAct https://arxiv.org/pdf/2402.01030

v0.3 的其余来源见附录 D。

---

## 附录 A：ARC-AGI-3 事实清单（v0.3 §1.1 原文）


**交互格式**
- 回合制；64×64 网格，每格 0–15 共 16 色；没有说明，规则、操控和目标都要靠行动发现。
- 每个动作返回 FrameData：`game_id`、`guid`（本次游玩）、`frame`（**≥ 1 个** 64×64 网格的列表，多个 = 一次动作的动画，最后一个是结果状态）、`state`、`levels_completed`、`win_levels`（通关所需关数）、`action_input{id, data, reasoning}`、`full_reset`、`available_actions`。字段名在 0.9.3 从 `score / win_score` 改为 `levels_completed / win_levels`；`available_actions` 与 ACTION7 在 0.9.2 加入。
- 动作：`RESET`(0)；`ACTION1–4` 简单动作（惯例上下左右，但由游戏定义）；`ACTION5` 简单、游戏特定；`ACTION6` 复杂动作带 x, y ∈ [0, 63]（点击 / 指点；官方模板按 x = 列、y = 行使用【未核实】）；**`ACTION7` = 撤销，只在部分游戏提供**。永远以 `available_actions` 为准。
- 状态：`NOT_PLAYED`（必须先 RESET）、`NOT_FINISHED`、`WIN`（完成 `win_levels` 关）、`GAME_OVER`（必须 RESET 才能继续）。官方框架循环**不会**替你发 RESET，agent 要自己发。
- **RESET 语义**：不带 guid → 新游戏；带 guid → 自上次关卡切换以来若已有 ≥ 1 个动作则为**关卡重置**，否则为**整局重置**（两次连续 RESET = 重开一局，进度清零）。COMPETITION 模式（ONLY_RESET_LEVELS）下每次 RESET 都只重置关卡。
- 可选 `reasoning` 载荷（字符串或 JSON，≤ 16 KB）随任一动作提交，存入 scorecard 与录制，游戏看不见。
- 游戏是 Python `ARCBaseGame` 类；单个动作产生 > 1000 帧会被引擎报错。
- 限制：600 请求 / 分钟 / key（429）；scorecard 空闲 15 分钟自动关闭；服务端每局步数上限未见文档【未核实】。官方 Agents 框架默认 `MAX_ACTIONS = 80`，Kaggle starter `--max-steps 200`；**官方评测允许每关 5× 人类基线动作**。
- 每局关卡数读 `win_levels`，典型范围【未核实，印象 4–10】。每个环境都经过"人类无说明可解"验证；每关基线 = 人类游玩数据集中动作数的上中位数。

**计分**
- 指标 = 相对人类动作效率。**关卡分 = min((基线动作数 / agent 动作数)², 1.15)**（代码里 ×100、上限 115；0.9.3 引入平方，0.9.7 引入上限）。
- **游戏分 = 关卡分按 1-based 关卡序号加权**（后面的关更重），上限 100 × 已完成关卡的权重份额；**未完成的关卡贡献 0**。
- 基准分 = 各游戏简单平均。
- **动作按关卡累计**：第 k 关的动作数 = `levels_completed` 从 k−1 变成 k 之间的全部动作。因此失败尝试、每次关卡 RESET（+1）、GAME_OVER 之后的动作都记在该关。
- `full_reset` 开启新一轮 run；环境得分取最好的 run（先比完成关数，再比分数）。
- 预算：官方评测每关 5× 基线，超出即该关失败；公开 API 是否强制执行【未核实，`scorecard.py` 本身不执行】。
- Scorecard JSON 暴露每游戏的 `level_scores / level_actions / level_baseline_actions` 与每 run 摘要——**游玩时不知道基线，事后可以知道**。

**API 与 SDK**
- Base URL：OpenAPI spec 写 `https://three.arcprize.org`，SDK 0.9.10 默认 `https://arcprize.org`，而 `three.arcprize.org` 现已 301 到 `arcprize.org/arc-agi/3`。**显式配置，落地前确认哪个主机提供 `/api`**【未核实】。
- 鉴权 `X-API-Key`（arcprize.org 账户申请）；保留 AWSALB cookie（粘性负载均衡）。
- 端点：`GET /api/games`、`/api/games/{id}`、`/api/healthcheck`；`POST /api/scorecard/open {source_url?, tags?, opaque?} → card_id`、`POST /api/scorecard/close {card_id}`、`GET /api/scorecard/{card_id}[/{game_id}]`；`POST /api/cmd/RESET {game_id, card_id, guid?}`；`POST /api/cmd/ACTION1..5|7 {game_id, guid, reasoning?}`；`POST /api/cmd/ACTION6 {game_id, guid, x, y, reasoning?}`。全部返回 FrameResponse。
- **Python SDK `arc-agi` 0.9.10**（2026-11-12，Python ≥ 3.12）：`Arcade(arc_api_key, arc_base_url, operation_mode, environments_dir="environment_files", recordings_dir="recordings")`；`env = arcade.make(game_id, seed=0, scorecard_id=None, save_recording=False, include_frame_data=True)`；`env.reset()`；`env.step(action, data=None, reasoning=None) → FrameData`；`arcade.open_scorecard / get_scorecard / close_scorecard`。`arcengine` 包提供 `FrameData / GameAction / GameState / ARCBaseGame`。
- **OperationMode**：`NORMAL`（游戏 .py 在本地运行，scorecard 同步到线上）、`ONLINE`（服务端运行）、`OFFLINE`（无网络，≈ 2000 FPS）、`COMPETITION`（Kaggle 规则：RESET 只重置关卡、每游戏一个环境等）。`listen_and_serve(port=8001, competition_mode=False)` 在本地提供同一套 REST API——Kaggle 网关就是它。
- 录制：每游戏一个 JSONL（每步一行，含帧与 reasoning），Playback agent 可回放。
- 官方 Agents 框架：`uv run main.py --agent=random --game=ls20`；子类化 `Agent`，实现 `is_done(frames, latest_frame)` 与 `choose_action(frames, latest_frame) → GameAction`；Swarm = 一个 scorecard 下每游戏一个线程。模板：random / llm / fastllm / reasoningllm / guidedllm / reasoningagent / multimodalllm / langgraph / smolagents / openclaw / playback。参考提示："You are an agent playing a dynamic game. Your objective is to WIN and avoid GAME_OVER while minimizing actions. One action produces one Frame. One Frame is made of one or more sequential Grids…"，网格序列化为 Python 列表。
- 官方榜单 harness："Standard" = 文本网格、约 175k 字符的滚动转录、≤ 7 个最近帧、模型自记笔记；"Provider Adapter" = provider 原生推理状态 + compaction。
- Kaggle 运行时：notebook 离线、wheel 来自比赛数据集；比赛重跑时等待 `http://gateway:8001/api/games`，写 `.env`（`ARC_BASE_URL=http://gateway:8001/`）后运行 agent；competition-mode 网关 sidecar 输出 `submission.parquet`。

**现状与比赛**
- 2025 年 7–8 月开发者预览 + 预览 agents 赛（3 → 6 个公开游戏）；2026 年 3 月正式发布并发技术报告（arXiv 2603.24621）。
- **135 个环境：25 公开（ls20、ft09、vc33 …）、55 半私有（用于 API 模型的验证测试）、55 私有（仅 Kaggle）**；Kaggle 对 110 个隐藏游戏计分。
- **ARC Prize 2026 的 ARC-AGI-3 赛道在 Kaggle：离线 notebook、≤ 9 小时墙钟（另一来源说 6 小时，冲突）、单 GPU（报告为 RTX PRO 6000；48 / 96 GB 显存说法冲突【未核实】）、每天 1 次提交、允许外部数据与预训练模型、获奖须开源**。Milestone 1、2 已结束；最终截止与奖金【未核实】。
- 榜单：前沿模型在官方 harness 下远低于人类 100 分（具体数字看 arcprize.org/results 与 GPT-5.5 / Opus 4.7 分析博客；Epoch AI 有独立评测）。
- 2025 预览赛：第一名 StochasticGoose（Dries Smit）——**每游戏在线训练一个 CNN，预测"某动作 / 点击是否会改变画面"，用来引导探索**；第二名 Blind Squirrel——**在观测到的帧上建显式状态图，系统化探索 + 回溯**。两者都不是 LLM 方案。
- 2026 Milestone 领先者 Tufa Labs "Seal"（名次【未核实】）：Qwen3.8-Flash-Next（xhigh effort）跑在 vLLM 分支上，**每游戏一个持久 Python 内核**；帧以 `history[i].frame.grid` 暴露；helpers `segment()`、`ascii_grid()`、`submit_action([Action('UP'), Action('MOUSE', row=r, col=c)])`；8× 棋盘图像；framediff numpy 脚本；可选 `world_model.py` + `test_world_model()` + 在学到的模型上 BFS；每关反思 / 策略审计；摘要式 compaction（比例 16：固定任务 → 摘要 → 最近一轮，其余保留推理）；80 局并发；模型自行发 RESET；不暴露 UNDO；预算前 10 分钟软停。**消融：世界模型 +2.7–4.2 分，棋盘图像 +2.7，写明动作成本 +1.9，分割 / framediff / 反思 / 审计 ≈ 0。同一模型：Seal 66.7 vs Qwen Code CLI 34.8 vs ARC Prize adapter 循环 0.17；Codex CLI + GPT-6.1 Sol 54.8（其自建评测集）。**
- Daniel Franzen（Milestone 2 writeup，二手【未核实】）：本地 Qwen + 自定义服务（投机解码、前缀缓存、专家剪枝）、带淘汰的长滚动历史、帧作为 REPL 变量、跨游戏调度器。


---

## 附录 B：pi 映射与代码骨架（v0.3 §5.3–5.4 原文；命名沿用 v0.3，接口以 2.2 为准）

### B.1 pi 机制映射

| 需求 | pi 机制（`@earendil-works/pi-coding-agent` 1.6，已核实） |
|---|---|
| 暴露工具 | 扩展内 `pi.registerTool({ name, label, description, parameters: Type.Object(...), executionMode: "sequential", execute(toolCallId, params, signal, onUpdate, ctx) })`，返回 `{ content: [{type:"text",text}, {type:"image",data,mimeType:"image/png"}], details }`。图像块在工具结果中合法（pi-ai 对 Anthropic / OpenAI / Google / Bedrock 都有测试）；`details` 不发给模型；输出需自行截断；`exposure: "model-only"` 可隐藏不想在 UI 暴露的工具 |
| 替换系统提示、关闭编码默认 | SDK：`new DefaultResourceLoader({ systemPromptOverride, appendSystemPromptOverride, noSkills, noPromptTemplates, noContextFiles, noExtensions, extensionFactories })` + `await loader.reload()`；`createAgentSession({ noTools: "builtin" })`。运行期微调用 `before_agent_start` 的 `systemPromptOptions.sections`（缓存友好），不要整体返回 `systemPrompt` |
| 折叠旧帧、注入 notebook / 预算 | `pi.on("context", ev => ({ messages }))`：收到 messages 深拷贝（不含 system），返回改写后的数组；不改 session 文件。需要碰 system 时用 `context_with_system`（index 0 必须仍是 system） |
| 拦截、记账 | `pi.on("tool_call", ev => ({ block: true, reason }))`（`ev.input` 可直接改）；`tool_result` 可改写 `content / isError / details`；`tool_execution_start/end` 做计时与日志 |
| harness 主动插话 | `pi.sendMessage({ customType, content, display, details }, { triggerTurn?, deliverAs: "steer" \| "followUp" \| "nextTurn" })`：以 user 角色进入上下文，`details` 不发模型；流式进行中必须给 `deliverAs` |
| 持久化 notebook / 状态图快照 | `pi.appendEntry(customType, data)`（永不发给模型）；`session_start` / `session_tree` 时用 `ctx.sessionManager.getBranch()` 读回；`pi.registerEntryRenderer` 可在 TUI 里渲染 |
| 自定义 compaction | `pi.on("session_before_compact", ev => ({ compaction: { summary, firstKeptEntryId, tokensBefore } }))` 或 `{ cancel: true }`；`ev.preparation` 给出待摘要消息、上次摘要、tokensBefore；`ctx.compact({ customInstructions })` 可主动触发 |
| 让循环跑下去 | `turn_end` / `agent_before_settle` 返回 `{ continue: true }` 强制再请求一次模型（必须带条件，否则无限循环）；`pi.sendMessage(..., { triggerTurn: true })` 在空闲时开新轮；pi-agent-core 层对应 `finishTurn → { action: "continue" \| "end" }` |
| 无头运行 | `createAgentSession({ cwd, modelRuntime, model, thinkingLevel, noTools, resourceLoader, sessionManager, settingsManager })`；`session.prompt(text, { images? })` 在 run 结束后 resolve；`session.subscribe` 监听 `agent_settled`（不是 `agent_end`，后者之后可能还有 retry）；`getContextUsage()` / `getSessionStats()` 取 token 与费用 |
| 开发期旁观与干预 | 同一扩展放进 `.pi/extensions/` 或 `pi -e path`；TUI 中 steer、`/tree`、`/fork`；`ctx.ui.setWidget / setStatus` 画棋盘与预算（`hasUI=false` 时自动 no-op，无头下无需分支） |

> 以上基于 2026-11-23 的 main 分支文档与源码。pi 迭代很快，落地前对照 `docs/extensions.md`、`docs/sdk.md`、`docs/compaction.md` 再确认一次签名。

### B.2 代码骨架（示意）

```ts
// arc-extension.ts —— pi 扩展工厂：工具 + hook；环境逻辑全在 sidecar
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export function makeArcExtension(side: Sidecar, nb: Notebook) {
  return function arcExtension(pi: ExtensionAPI) {
    pi.on("session_start", (_ev, ctx) => {                       // 只读当前分支上的自定义 entry
      for (const e of ctx.sessionManager.getBranch())
        if (e.type === "custom" && e.customType === "arc:notebook") nb.load(e.data);
    });

    pi.registerTool({
      name: "python", label: "python",
      description: "Run code in the persistent game kernel (frames, history, helpers, submit_actions). " +
                   "Only submit_actions changes the game; each action costs 1. observe() is free.",
      parameters: Type.Object({ code: Type.String() }),
      executionMode: "sequential",                                // pi 默认并行执行工具
      async execute(_id, p, signal) {
        const r = await side.exec(p.code, signal);                // {stdout, images[], status?}
        const content = [{ type: "text", text: r.stdout + (r.status ? `\n${r.status}` : "") },
                         ...r.images.map(png => ({ type: "image", data: png, mimeType: "image/png" }))];
        return { content, details: r };                           // details 不发模型，供日志/回放
      },
    });
    // observe / notebook（/ act）同理

    pi.on("context", (ev) => ({
      messages: shapeContext(ev.messages, { keepImages: 3, notebook: nb.render(), budget: side.budgetLine() }),
    }));
    pi.on("session_before_compact", async (ev, ctx) => ({
      compaction: { summary: await arcSummary(ev, ctx, nb, side), firstKeptEntryId: ev.preparation.firstKeptEntryId,
                    tokensBefore: ev.preparation.tokensBefore },
    }));
    pi.on("agent_before_settle", () => (side.done() || !side.budgetOk()) ? undefined : { continue: true }); // 机制 B
    side.on("event", (text) => pi.sendMessage({ customType: "arc:event", content: text, display: true }, { deliverAs: "steer" }));
    nb.on("change", (data) => pi.appendEntry("arc:notebook", data));
  };
}
```

```python
# sidecar.py —— 每游戏一个进程；stdio JSON-RPC；持久命名空间
from arc_agi import Arcade, OperationMode
arcade = Arcade(arc_api_key=KEY, arc_base_url=BASE_URL, operation_mode=OperationMode[MODE])
env = arcade.make(GAME_ID, scorecard_id=CARD_ID, save_recording=True)

ns = {"np": np, "frames": [], "history": [], "segment": segment, "diff": diff, "ascii": ascii_grid, "show": show, ...}

def submit_actions(actions, stop_on=None, expect=None, reasoning=None, confirm_full_reset=False):
    lines = []
    for a in normalize(actions):
        guard.check(a, confirm_full_reset)                       # 预算、双 RESET、GAME_OVER 后仅 RESET/撤销、已知 no-op
        fd = env.step(a.game_action, data=a.data, reasoning=reasoning)
        step = ingest(fd)                                        # frames/history/状态图/帧哈希/变化格数
        lines.append(fmt(step))                                  # "step 38 ACTION3 changed=12 SEEN #s12 L2 a=38"
        if verifier.surprised(step, expect) and stop_on == "surprise": break
        if stop_rule(stop_on, step): break
    return "\n".join(lines)
ns["submit_actions"] = submit_actions

def handle_exec(code):                                           # RPC: exec → {stdout, images, status}
    with capture() as out: exec(code, ns)
    return {"stdout": out.text[:8000], "images": drain_images(), "status": status_line()}
```

```ts
// runner.ts —— 每游戏一个 session + 一个 sidecar
import { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";

const runtime = await ModelRuntime.create({ authPath, modelsPath });
const model = builtinModels().getModel("anthropic", MODEL_ID);

const loader = new DefaultResourceLoader({
  cwd, noExtensions: true, noSkills: true, noPromptTemplates: true, noContextFiles: true,
  extensionFactories: [makeArcExtension(side, nb)],
  systemPromptOverride: () => ARC_SYSTEM_PROMPT,
  appendSystemPromptOverride: () => [],                          // 两个都给，否则 APPEND_SYSTEM.md 仍会追加
});
await loader.reload();                                            // 必须

const { session } = await createAgentSession({
  cwd, modelRuntime: runtime, model, thinkingLevel: "high", noTools: "builtin",
  resourceLoader: loader,
  sessionManager: SessionManager.create(cwd, sessionsDir),       // 或 SessionManager.inMemory()
  settingsManager: SettingsManager.inMemory({ compaction: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 }, cacheWarming: "off" }),
});
session.subscribe((ev) => telemetry.record(ev));                  // 以 agent_settled 判断 run 结束

await session.prompt(`Game ${gameId} started (state NOT_PLAYED). Observe, then follow the method.`);  // run 结束才 resolve
while (!side.done() && side.budgetOk()) {                         // 机制 C：分段
  await session.prompt(side.levelJustCompleted() ? LEVEL_NOTE_PROMPT : CONTINUE_PROMPT);
}
session.dispose(); side.close();
```

---

## 附录 C：系统提示骨架（按 v0.4 接口改写）

```text
You are playing an unknown interactive puzzle game (ARC-AGI-3). There are no instructions.
Discover the controls, rules and goal by experimenting, then complete every level.

## Scoring (read carefully — it decides how you should play)
- Level score = min((human_baseline_actions / your_actions)^2, 1.15). Later levels weigh more.
  An unfinished level scores 0. Finishing the game matters more than a perfect level 1.
- Every action is charged to the CURRENT level: failed attempts, each RESET (+1), and any
  action after GAME_OVER. You do not know the baseline; the budget is ~5x baseline per level.
- A probing action costs exactly as much as a solving action. Search inside your world model
  (free) before trying things in the game (paid).

## Environment
- 64x64 grid, 16 colours. Each turn you get an upscaled image of the latest frame
  (x = column 0-63 left→right, y = row 0-63 top→bottom) plus a status message.
- Actions are listed in valid_actions, e.g. UP(ACTION1), SPACE(ACTION5), MOUSE(ACTION6, x, y).
  The names are conventions only — verify what each action really does.
- RESET restarts the current level; two RESETs in a row restart the whole game (progress lost).
  After GAME_OVER you must RESET. One action may return several grids; the last is the result.

## Python tool
- current_frame / previous_frame (.grid .ascii .segmentation .level .state), history, transitions,
  last_action_result, valid_actions, segment(), diff(), show() (returns an image to you).
- submit_actions([...], stop_on=..., expect=...) is the ONLY way to act. Output is capped at 4096 chars.
- Files persist across calls: write world_model.py and test it against history.

## Method
ORIENT → MODEL (rules with evidence steps; dynamics in world_model.py, tested) → PLAN (search the
model, write a prediction) → EXECUTE & VERIFY (stop on surprise) → 2-3 lines of notes per level.
Before acting, check what your last action actually changed.

## Pitfalls
- An energy / time bar is not the goal; minimising it is not the goal.
- Do not invent goals (e.g. "move the block to a fixed spot") without evidence.
- Do not read the scene as robots, classic sprites or an Atari game.
- Never print the whole grid; use segmentation, slices or diff.

## Memory
Keep your current understanding under "World model:" in your reply; it is carried to the next turn
until you overwrite it.

## Output protocol
Each turn: ≤4 short lines (state / ranked hypotheses / experiment or plan / prediction), then tools.

## Priors (hypotheses to test, not facts)
…
```

---

## 附录 D：v0.3 来源


ARC-AGI-3
- OpenAPI spec：https://docs.arcprize.org/arc3v1.yaml
- Docs：https://docs.arcprize.org/（game-schema、actions、methodology、rate_limits、scorecards、recordings、local-vs-online、api-keys、toolkit/competition_mode）
- SDK：https://pypi.org/project/arc-agi/ ；https://github.com/arcprize/ARC-AGI（README、`arc_agi/scorecard.py`）
- Agents 框架：https://github.com/arcprize/ARC-AGI-3-Agents（README、`agents/agent.py`、`agents/swarm.py`、`agents/templates/*`）
- Kaggle starter：https://github.com/arcprize/ARC-AGI-3-Kaggle-Starter ；引擎：https://github.com/arcprize/ARCEngine ；官方榜单 harness：https://github.com/arcprize/arc-agi-3-benchmarking
- 发布与方法：https://arcprize.org/blog/arc-agi-3-launch ；技术报告 https://arxiv.org/abs/2603.24621 ；人类数据集 https://arcprize.org/blog/arc-agi-3-human-dataset
- 比赛：https://arcprize.org/competitions/2026 ；https://arcprize.org/competitions/2026/arc-agi-3 ；https://arcprize.org/competitions/arc-agi-3-preview-agents ；https://arcprize.org/policy
- 结果与分析：https://arcprize.org/results ；https://arcprize.org/blog/arc-agi-3-gpt-5-5-opus-4-7-analysis ；https://arcprize.org/blog/arc-prize-2026-milestone-1 ；https://arcprize.org/blog/arc-agi-3-preview-30-day-learnings ；https://epoch.ai/benchmarks/arc-agi-3/review
- 参赛者：StochasticGoose https://medium.com/@dries.epos/1st-place-in-the-arc-agi-3-agent-preview-competition-49263f6287db ，https://github.com/DriesSmit/ARC3-solution ；Tufa Labs https://tufalabs.github.io/arc-writeups/supplementary/（harness_common、harness_arc3、harness_framediff、arc3_ablations、harness_comparisons），https://github.com/Tufalabs/arc-prize-2026 ；Franzen https://www.kaggle.com/writeups/dfranzen/arc-agi-3-milestone-2 （二手）

pi
- 仓库：https://github.com/earendil-works/pi （原 badlogic/pi-mono）
- Docs：`packages/coding-agent/docs/`（extensions.md、sdk.md、compaction.md、session-format.md、sessions.md、settings.md、cli.md、rpc.md、json.md）
- 源码：`packages/coding-agent/src/core/`（sdk.ts、agent-session.ts、resource-loader.ts、extensions/types.ts、messages.ts、system-prompt.ts）；`packages/agent/`；`packages/ai/`
- 示例：`packages/coding-agent/examples/extensions/tic-tac-toe.ts`、`custom-compaction.ts`、`subagent/`；`examples/sdk/*.ts`
- 博客：https://mariozechner.at/posts/2025-11-30-pi-coding-agent/ ；https://mariozechner.at/posts/2025-12-22-year-in-review-2025/ ；https://mariozechner.at/posts/2026-05-30-shitty-robot/
