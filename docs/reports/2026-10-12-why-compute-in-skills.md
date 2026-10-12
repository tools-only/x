# 为何 thin 把算力放在 skill：对照 Pi / 社区定位

日期：2026-10-12（Asia/Shanghai）。范围：**只读分析短记**；除本文件外未改产品代码。

回应：对照社区中 skill 的定位，解释 thin ARC 路径为何会把可执行算力接到 skill / `run_skill`，以及这与社区语义如何分叉。目标态口径见 [`2026-10-12-component-vision-4and5-alignment.md`](2026-10-12-component-vision-4and5-alignment.md)（「算力在 skill」是现状债，不是愿景）。

---

## 1. Pi / 社区里 skill 是什么

上游（本仓库钉死的 Pi coding-agent `docs/skills.md`，与 [pi.dev Skills](https://pi.dev/docs/latest/skills) / [Agent Skills](https://agentskills.io/specification) 一致）：

- **形态**：目录 + `SKILL.md`（可附 `scripts/`、`references/`、`assets/`）；不是「带 schema 的可注册工具」。
- **加载**：**渐进披露**——启动只把 name / description / path 打进 system；匹配任务后模型再用 `read`（或 `bash`）加载全文；可用 `/skill:name` 强制。
- **角色**：给某一类工作的**专用流程指引与辅助材料**；文档原话大意是：比 prompt template 多一点程序知识，但**不必**为此新增一个可执行集成点。
- **与工具分工**：真正算力 / 副作用走 **tools**（原生 `read`/`bash`、`registerTool`、MCP、codemode 等）。Skill 告诉模型「何时读哪份手册、如何调用已有工具/脚本」；手册里的脚本是被工具调用的附属物，不是 skill 本身变成 tool schema。
- **与 memory 分工**（本仓库归纳）：skill 答「**如何做**」；memory 答「**知道了什么、为何这样判断**」——不宜混写。见 [`2026-10-07-pi-native-community-context.md`](2026-10-07-pi-native-community-context.md) §6。
- **社区用法同族**：如 `jev_find_skill` 推荐后读 `SKILL.md`；mattpocock / `.agents/skills` 等共享目录仍是手册发现，不是把 Python 沙箱入口命名为 skill。见 [`docs/pi-jev-core-features-analysis-2026-10-09.md`](../pi-jev-core-features-analysis-2026-10-09.md)、[`2026-10-06-mattpocock-skills-installation.md`](2026-10-06-mattpocock-skills-installation.md)。

一句话：**社区 skill ≈ 按需展开的程序手册；算力入口是 tool / REPL / MCP。**

---

## 2. 我们 thin 路径上 skill 实际是什么

| 事实 | 证据 |
| --- | --- |
| 扩展对外六件套含 `skill` / `run_skill`，**无**独立 typed `tool` 组件 | `demo/arc_thin_extension.ts` 头注释 L4–12；`DECISION_TOOLS` 含 `skill` 不含通用 tool |
| `skill(op=set\|delete\|get)`：保存 Python 源；保存前 WASI **语法检查**；版本 +1；刷新表面 | 同文件 skill 沙箱段；架构 [`current-architecture-2026-10-09-zh.md`](../current-architecture-2026-10-09-zh.md) §5.1 / §6 |
| `run_skill`：**仅当已有 skill 时注册**；`name` 绑定已存枚举；执行 `run(state, args)` | 同文件 `refreshSkillSurface`；计划 [`2026-10-09-thin-skill-call-binding.md`](../plans/2026-10-09-thin-skill-call-binding.md) |
| Guest：固定 WASI CPython 程序，源码作输入；`mode=check` / `mode=run` | `demo/arc_thin_skill_guest.ts`；架构 §7 |
| 架构明文：「可编程计算目前只能做成 skill，经 `run_skill` 间接调用」 | 架构 §6 五类组件表 `tools` 行；§9 记 typed tool / 可保存 subagent **模块在、扩展未接线** |
| Ledger 后台也用已存 skill 在状态上 `args={}` 批测 | 架构 §8；强化「skill = 可执行测量」 |
| ARC runner 启动带 `--no-skills`：关掉的是 **Pi 原生 SKILL.md 发现**，不是我们的 harness skill store | [`2026-10-07-project-context-components-audit.md`](2026-10-07-project-context-components-audit.md) §开篇；开发用 `AGENTS.md` 也不进 gameplay |

一句话：**thin skill ≈ 可版本化的沙箱 Python 包 + 间接调用入口；同一名词承载了「社区手册」之外的「算力面」。**

---

## 3. 为什么当年会把算力接到 skill（历史 / 设计原因，非目标背书）

1. **最小闭环优先**  
   先打通「一次 `skill(op=set)` → 语法检查 → 下一 turn 可 `run_skill`」的保存即调用，复用同一 guest（`arc_thin_skill_guest.ts`）与 WASI 路径，避免并行再做一个 typed-tool 商店与双套执行器。见愿景对齐说明 §2.3；对照报告 §2.1.4。

2. **对照 Continual 的短路径习惯**  
   Continual Harness 固定暴露 `process_skill` / `run_skill`，可执行能力主要落在 **skills store**（Python `run(state, args)` + sandbox），而不是单独的 typed-tool 商店。thin 早期对齐了「skill = 可执行」，却**没有**同时补上「tool = 一等公民」边界。见 [`2026-10-08-continual-harness-self-harness-analysis.md`](2026-10-08-continual-harness-self-harness-analysis.md)；对照报告 §3 Skills 行。

3. **Schema / 授予成本后置**  
   独立 typed tool 需要自有 name、参数 schema、动态 `registerTool`、删后拒绝、可授予 subagent。计划 [`2026-10-09-thin-tools-subagents-prompt.md`](../plans/2026-10-09-thin-tools-subagents-prompt.md) 已写明问题：「Programmable calculations exist only as Python skills… never becomes a first-class tool」；`arc_thin_subagents.ts` 预留了 `GRANTABLE` 含 `tool`，但 **`arc_thin_extension.ts` 未 import**（架构 §9）。

4. **表面噪声控制**  
   `run_skill` 仅在有 skill 时出现、`name` 绑枚举，降低空目录下的无效调用面（skill 调用绑定计划）。这强化了「有包才有算力入口」的路径依赖，也减少「先看见 tool 再创造」的对称提示（对照报告 §4.2）。

5. **五类矩阵名义上有 tool，实现上借道 skill**  
   验收与架构都要求 system_prompt / skills / memory / **tools** / subagents 齐套（根目录 `AGENTS.md` ARC acceptance；架构 §6），但 thin 实现把「可编程计算」暂时填进 skills 格，tools 格写「暂无 → 见 §9」。名称对齐了矩阵，语义对齐了 Continual，**没有**对齐 Pi 原生 skill。

---

## 4. 和社区定位差在哪里（分叉点）

| 维度 | Pi / 社区 | 我们 thin（现状） |
| --- | --- | --- |
| 词义 | 程序手册 / 工作流包 | 可执行 Python 包 + 运行器 |
| 常驻上下文 | 短目录（name/description/path） | SKILLS 目录 + 可选自动/显式 `run_skill` 输出切片 |
| 执行面 | tools / MCP / bash / codemode | **几乎只有** `run_skill`（外加 `arc_action` 等固定工具） |
| 与原生 skill 关系 | 默认可发现 SKILL.md | ARC 路径 `--no-skills`，自建 JSONL store，**同名异物** |
| 动态「造能力」 | 写/装手册，或 `registerTool` / MCP | 写 Python 进 skill store；typed tool CRUD **未接线** |
| 目标口径（已纠正） | — | skill 应降级为版本化包 / 批测 / 探索；稳定 API → typed tool；见愿景对齐 §3.5 |

分叉不是「社区禁止 skill 里带脚本」——Pi 手册也允许附带 scripts，由模型用工具去跑。分叉在于：**我们把「唯一可编程算力入口」挂在 skill 名下，并推迟了 tool 一等表面**；社区则把 skill 当冷手册，把算力留在 tool 面。

---

## 5. 刻意不做

- 不改 `demo/*`、不接线 tool/subagent、不重跑 ARC。
- 不把本记写成已完成的架构决策；目标态以愿景对齐说明为准。

---

## 来源

- Pi：`node_modules/@earendil-works/pi-coding-agent/docs/skills.md`；镜像 `docs/reports/pi-native-online-sources/packages__coding-agent__docs__skills.md`；https://pi.dev/docs/latest/skills
- 本仓：`docs/current-architecture-2026-10-09-zh.md` §6–§9；`docs/reports/2026-10-12-harness-tools-components-comparison.md`；`docs/reports/2026-10-12-component-vision-4and5-alignment.md`；`docs/reports/2026-10-07-pi-native-community-context.md` §6；`docs/reports/2026-10-07-project-context-components-audit.md`；`docs/reports/2026-10-08-continual-harness-self-harness-analysis.md`；`docs/plans/2026-10-09-thin-tools-subagents-prompt.md`；`demo/arc_thin_extension.ts`；`demo/arc_thin_skill_guest.ts`
