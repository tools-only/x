# Component vision alignment: §5.4 flexibility × Pi-native systematic base

日期：2026-10-12（Asia/Shanghai）。范围：**愿景对齐说明**；除本文件外未改产品代码。回应对照报告 [`2026-10-12-harness-tools-components-comparison.md`](2026-10-12-harness-tools-components-comparison.md) 之后对「算力在 skill」的纠正，以及「向 4、5 靠拢」的架构意图。

---

## 1. 对照报告里「4」和「5」指什么

出处：对照报告 **§5 可选演进路径**（按侵入性从低到高编号）：

| 编号 | 标题（报告原文） | 一句话 |
| --- | --- | --- |
| **4** | **对齐 Prime：程序化上下文** | 暴露可查询 trajectory / transition log；大网格与长日志默认不进摘要正文；用代码/查询按需取回 → **灵活、可拼接的工作集** |
| **5** | **抬高或去掉 2000** | fork / patch Pi 的 `TOOL_RESULT_MAX_CHARS`，或上游 PR → 消除 summarizer 输入裁切 |

相邻、常被一并讨论的条目（**不是** 4/5，但构成「体系化」语感）：

- **§5.2 加强收据契约**：关键标记进 header；`read_compaction_artifact(sha)` 类薄工具；对齐社区 prune/condense 的 **stub + 原文可寻址**。
- **§2.1.3 Pi 社区**：工作集只留 stub/预览，原文可寻址回查（与 5 同属「继续走 Pi compact 路径」而非逃到 Continual 每决策重建）。

**本说明对用户意图的读法（纠正「算力在 skill」之后的目标态）：**

- 取 **4 的灵活性**：可查询、可自定义拼接的上下文能力（Prime 向）。
- 取与 **5 同向的「Pi 原生体系」**：保留 Pi 原生 component / compact 基础，不把主策略改成 Continual 式每决策丢弃长会话；证据用 **体系化寻址 + stub/收据** 保住（§5.2 / 社区范式），**抬常量 2000（字面 §5.5）是可选后续，不是愿景中心**。
- 在其上叠 **ledger / critic / self-harness** 做高阶思考，而不是把可执行算力长期塞在 skill 间接层。

若只按字面把「5」读成「必须 fork 抬 2000」，会窄化用户表述里的「体系化范式 + 保持 Pi 原生 component 基础」。

---

## 2. 为何 thin 今天把可执行算力放在 skill（事实，非背书）

这是 **相对五类组件目标与 §5.4/Pi-native 愿景的设计债**，不是目标架构。

### 2.1 架构文档已写明的缺口

[`docs/current-architecture-2026-10-09-zh.md`](../current-architecture-2026-10-09-zh.md) §6 / §9：

- 五类组件声明：prompt / skill / memory / **tool** / **subagent**。
- thin 上：**暂无独立 typed tool store**；「可编程计算目前只能做成 skill，经 `run_skill` 间接调用」。
- 可保存 subagent 在 `demo/arc_thin_subagents.ts`（含 `GRANTABLE`、`tool` 名），**当前 `arc_thin_extension.ts` 未 import**，`subagent` / `ask_subagent` / `tool` **尚未注册**。

### 2.2 代码路径（可核对）

| 事实 | 位置 |
| --- | --- |
| 扩展头注释：六件套含 `skill` / `run_skill`，**无**独立 `tool` 组件 | `demo/arc_thin_extension.ts` L4–11 |
| `skill(op=set\|delete\|get)`：`pi.registerTool`；保存前 WASI 语法检查；成功后刷新表面 | 同文件 ~L1220–L1300 |
| `run_skill`：**仅当已有 skill 时**挂上（`refreshSkillSurface`）；`name` 为已存枚举；`run(state, args)` 无独立 JSON schema | 同文件 ~L54–L602、~L1355+ |
| 可执行 guest：`run(state, args)` → WASI CPython | `demo/arc_thin_skill_guest.ts`；架构 §7 |
| 计划中的一等 `tool(op=set, name, description, params, source)`：一次调用 → 原生 `registerTool` + 校验 + 可授予 subagent | [`docs/plans/2026-10-09-thin-tools-subagents-prompt.md`](../plans/2026-10-09-thin-tools-subagents-prompt.md) — 模块预留、扩展未接线 |
| Subagent 模块已预留 `GRANTABLE = ["run_skill","skill","tool","memory"]` | `demo/arc_thin_subagents.ts` L24–25 |

### 2.3 为何会落成「算力在 skill」（历史原因，非目标）

1. **最小闭环优先：** thin 先打通「保存即调用」的 Python 沙箱，复用同一 `run(state, args)` 与 WASI，避免并行再做一个 typed-tool 商店。
2. **Schema / 授予成本后置：** 独立 tool 要自有 name、参数 schema、Pi 动态注册、删后拒绝、可授予 subagent；计划已写、接线未完成。
3. **对照 Continual 的短路径习惯：** Continual 也把大量执行能力放在 skills store；thin 早期对齐了「skill = 可执行」，却 **没有** 同时补上「tool = 一等公民」边界。
4. **后果（债）：** 常用计算只能 `run_skill(name, args)` + 无类型 `args`；不能出现在工具表里被校验；不能干净地交给 subagent；与 meta-harness「五类动态创建并真实推进」和用户要的 **4+Pi-native** 愿景不对齐。

对照报告里「算力在 skill」若读成推荐，是 **表述失误**；正确读法是：**现状描述 + 待还的债**。

---

## 3. 目标架构对齐（提议，未实现）

```text
┌─────────────────────────────────────────────────────────────┐
│  High-level self-harness（可选层，已有雏形）                    │
│  ledger（轨迹/测量台账） · critic（失败触发的证伪）              │
│  consolidate / hypothesis·strategy · 今后的自定义「思考拼装」   │
└──────────────────────────▲──────────────────────────────────┘
                           │ 读台账与 stores；不代替执行面
┌──────────────────────────┴──────────────────────────────────┐
│  Composable context（取 §5.4 / Prime 灵活性）                 │
│  工作集 = 机械拼装：prompt overlay + memory 切片 + stub 收据    │
│           + 按需 query(trajectory / artifact / transition)     │
│  Agent（或 skill/tool）可请求「拼哪一段」，而非默认塞全文         │
└──────────────────────────▲──────────────────────────────────┘
                           │ 投影 / stub；原文不进摘要正文
┌──────────────────────────┴──────────────────────────────────┐
│  Systematic addressing（Pi compact 路径上的体系化，§5.2 族）   │
│  Phase 3c 收据 + artifact 路径；可回查；关键标记进 header       │
│  （字面抬 2000 = §5.5，可选；不阻塞本层）                        │
└──────────────────────────▲──────────────────────────────────┘
                           │
┌──────────────────────────┴──────────────────────────────────┐
│  Pi-native component base（保持）                             │
│  pi.registerTool / Skills 指引语义可并存 / session + compact    │
│  一等：typed tools · saved subagents · prompt · memory         │
│  skill：降为「可版本化的可执行包 / 批处理 / 测量」，非唯一算力入口 │
└─────────────────────────────────────────────────────────────┘
```

### 3.1 Pi-native base（保留）

- Kernel 仍是 Pi RPC + extension；组件用 `registerTool`、session continuity、原生 compact 钩子。
- **不**把主线改成 Continual「每决策丢弃对话、全靠重建」来躲避 2000。
- 五类表面补齐：把已写好的 `tool` / `subagent` 接线进 `arc_thin_extension.ts`（计划已有）。

### 3.2 Systematic addressing / stubs（「5 向」的体系化，而非唯抬常量）

- 大结果默认：**stub / 收据 + 磁盘（或等价）寻址**；摘要与工作集只见短文。
- 提供薄回查能力（路径 / sha / 专用 read），使模型与 high-level 层能取回证据。
- 抬高 2000（字面 §5.5）仅作成本权衡下的可选补丁，**不是**对齐的第一块砖。

### 3.3 Flexible queryable / composable context（取 §5.4）

- 轨迹、transition、compaction artifact、ledger 行等变为 **可查询资源**，不再只能靠「写进 memory」或「塞进 skill 返回值」。
- 上下文由 harness **按策略拼接**（类似 Prime 的 L1 工作集 vs L2/L3 可检索），agent 可用工具/代码选择片段。
- 这直接服务 meta-harness：动态创建的组件写入可寻址层，再被拼进下一决策。

### 3.4 Ledger / critic / self-harness 的位置

- **在组件执行面之上**：读 stores + ledger，做证伪、覆盖、停滞信号；不替代 typed tool / subagent。
- 已有：`arc_thin_ledger.ts`、`arc_thin_critic.ts`（可由环境变量关）；应用层应消费 **可查询记录**，而不是要求 skill 返回值扛全部证据。
- 高阶「思考拼装」= 选哪些 ledger 行、哪条 hypothesis、哪份 artifact stub 进入工作集——能力来自 §5.4 向，触发与评判来自 ledger/critic。

### 3.5 Skills 应降级成什么

| 角色 | 说明 |
| --- | --- |
| **保留** | 可版本化的 Python 包；批测量（ledger 已在用 skill@args={}）；探索性脚本；跨状态 artifacts |
| **不再承担** | 「唯一可编程算力入口」；高频、稳定、需 schema/授予的计算 |
| **与 tool 边界** | 稳定 API → **typed tool**（一等 schema、可授予）；实验性/批量/带预测声明的程序 → **skill** |

### 3.6 应接线的 typed tools / subagents

按既有计划 [`2026-10-09-thin-tools-subagents-prompt.md`](../plans/2026-10-09-thin-tools-subagents-prompt.md)，**实现层已有模块、扩展未挂上**：

1. 注册 `tool` CRUD → 动态 `registerTool`，params 校验，持久化 `tools.jsonl`。
2. 注册 `subagent` / `ask_subagent`（fold `ask_analyst`）；授予子集；禁止授予 `arc_action`。
3. 回查类薄工具（artifact / trajectory 切片）作为 composable context 的「4 向」能力，可与 tool store 一并设计。
4. 工作集目录对 TOOLS / SUBAGENTS 与 SKILLS 对称（空时也提示如何创建）——利于自主采用。

---

## 4. 开放问题

1. **查询 API 的形状：** 专用 `query_trajectory` / `read_artifact`，还是「持久 Python host + 用户代码」（更 Prime）？侵入性与 Pi 会话模型如何折中？
2. **字面 §5.5（抬 2000）：** 在收据+回查足够之后是否仍要 fork？摘要成本与证据保真的量化门槛未定。
3. **Composable 策略谁写：** 纯机械规则、ledger/critic 驱动、还是 agent 显式「拼装」调用？后两者更贴 self-harness，但增加采用负荷。
4. **Skill → tool 晋升：** 是否提供「把已验证 skill 冻成 typed tool」的一键路径，避免双轨永久分裂？
5. **Subagent 与单生命历史：** 计划已禁止子代理直接 `arc_action`；在可拼接上下文下，子代理是否只读 artifact/ledger，仍需产品裁定。
6. **验证门：** 对齐是否成立，应以「组件被自主创建并引用可寻址证据推进关卡」为准，而不是「skill 调用次数」或「摘要里是否出现全文」。

---

## 5. 刻意不做（本说明）

- 不改 `demo/*`、不接线、不抬 2000、不重跑 ARC。
- 不把对照报告里的现状句改写成已完成的架构决策。

---

## 来源

- [`docs/reports/2026-10-12-harness-tools-components-comparison.md`](2026-10-12-harness-tools-components-comparison.md) §2.1、§5.2–§5.5
- [`docs/current-architecture-2026-10-09-zh.md`](../current-architecture-2026-10-09-zh.md) §6–§9
- [`docs/plans/2026-10-09-thin-tools-subagents-prompt.md`](../plans/2026-10-09-thin-tools-subagents-prompt.md)
- `demo/arc_thin_extension.ts`、`demo/arc_thin_subagents.ts`、`demo/arc_thin_ledger.ts`、`demo/arc_thin_critic.ts`
