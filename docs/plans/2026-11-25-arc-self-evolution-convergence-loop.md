# ARC 在线自进化收敛闭环：探索收敛、上下文连续、机制复用

日期：2026-11-25（Asia/Shanghai）。状态：设计，待实现与真实验证。

依据：[Harness 与 Self-Harness 设计原则](../harness-design-principles.md)、[开发流程](../development-workflow.md)。本文按[变更记录模板](../templates/meta-harness-change.md)栏目组织，不进入任务 Agent 的 gameplay 上下文。当前承载面是 `thin-arc-self-harness` 的 thin 入口（已具备 claims 引擎、review turn、memory/skill 工具）；旧入口的 `work/claims/*.py` 与 `ARC_LAYERED_MODEL` 未接线属历史分支问题，本方案不复活双宿主。

## 问题与命题

**真实失败材料（用户提供，基于 77e7568 的其他电脑分析，观察非结论）：**

1. 局部循环、缺淘汰：同一动作/坐标反复出现，未形成“预测→验证→排除”的收敛搜索。
2. 预算语义混用、缺止损：thinking 混淆 level 1/level 2 与 0-index，怀疑 RESET 被禁；全局预算与 token 被持续消耗。
3. 上下文重建负担：compaction 分别 44/149/53 次；wa30 622 步压缩 148 次；反复 “let me re-examine / completely differently”。
4. 工具摩擦：Python 报错 17/28/16 次（缺 numpy、语法、expect range too wide、reviewrequired、kernel host failure: unknown kernel frame、stopiteration 等）。
5. 缺系统验证闭环：wa30 L2 596 动作、vc33 L3 223 动作仍未通关，机制规律未提炼复用。
6. 终态识别差：cd82 末尾承认“无计可施”；wa30 累计 573 动作 idle 段，无主动停止。

**现有实现事实（当前工作树）：** claims 已在 thin 路径实现（hypothesis 可携带 `check(t)`，保存时与新 transition 后自动运行，结果入 `claim_checks.jsonl`）；25 动作 review、GAME_OVER review 存在；level-change review 默认开但可被 `--no-level-change-review` 关闭；review turn 消费的是“最近动作窗口”，不消费 claim 反证摘要，也不要求产出可复用载体。因此：claim 反例发生时没有定向审阅；审阅产出没有宿主承接；策略/方法/记忆的复用缺少“下一轮生效并使用”的机械位置。

**窄命题：** 在 thin 路径上补三段闭环——(1) claim 反例/未应用/错误变成机械可见的定向 review 触发；(2) review 输入提供 claim 反证、竞争假设、未完实验与预算事实，降低重建认知；(3) review 产出的修订假设、skill 方法或策略修订由 runtime 存储，下一轮装配并可见，形成“修改→生效→真实使用”闭环。预期减少重复取证、重复重建和无效探索；不承诺自动提升通关率。

**减少的负担：** agent 不需要靠滚动历史发现反例；review 不再重复分析已经证伪的内容；产物保存是一个 `memory`/`skill` 调用而不是完整复盘手续；预算与剩余动作事实在关键决策点机械可见。

**适用条件与推翻条件：**

- 触发仅在 claim 有新 False / 首次 error / 连续 N 个 transition 未应用时生效，且每关最多 3 次 claim 定向 review，间隔 ≥4 动作。
- 推翻：真实运行中 claim 反例未触发 review；或 review 产物从未在后续决策被引用；或触发后每关动作数不减反增；或 review token 成本超过同关动作收益。

**非目标：** 不加硬阻断或 WIN 强制门；不注入开发文档到 gameplay；不重开 ARC_LAYERED_MODEL 回测；不做跨任务 Meta pass；本片先不修改通用 loop 调度。

## 设计与成本

**选择与取舍：** 复用现有 claims 引擎、review turn（CONSOLIDATE）与五类组件接口，仅加三个机械信号位，不新建平台。

| 环节 | 推进者 | 可观察证据 | 失败/等待 |
|---|---|---|---|
| 机会 | claims runtime | `claim_checks.jsonl` 新 False/error/never-applied | compile error 记录不重试 |
| 识别 | runner 机械信号 | `review_due` 标记 + 触发原因 | 每关限流，避免仪式 |
| 投入 | review turn | 输入含 claim 反证摘要、竞争假设、未完实验、预算 | 超时/length 走既有续接 |
| 候选 | agent | narrowed hypothesis（可带新 check）/skill/策略修订 | 可不产出，但记录“无新证据” |
| 装配 | runtime | 下一决策上下文显示修订内容与版本 | 保存失败不静默 |
| 语义使用 | agent | 后续动作引用修订后的预测/方法 | 无引用则留不确定 |
| 反馈 | runtime | 新 transition 的 claim 结果与动作效率 | 反例继续触发限内 review |
| 保留/撤下 | agent（可选） | skill/memory 状态更新 | 无后续用途不强制仪式 |

**首次获益路径（最少模型决策）：** claim False → runner 下一个边界定向 review → review 消费 `claim_summary + 竞争假设 + 未完实验` → 一次 `memory` 修订或 `skill` 保存 → 下轮 TASK 上下文出现修订内容 → 后续动作使用。全程 2 次模型轮（review + 后续决策），无额外登记。

**新增与移除：**

| 位置 | 内容 | 性质 |
|---|---|---|
| `arc_thin_e2e.py` runner | `claim_due` 触发位（读 claim 摘要） | 机械信号，不判语义 |
| `arc_thin_extension.ts` | review turn 的 claim/未完实验/预算输入区 | 短上下文，非全量历史 |
| `arc_thin_system.md` / review prompt | claim 修订→skill/策略承载的使用说明 | ≤2 句常驻 |
| 现有 review 触发 | 保留 25 动作与 GAME_OVER，claim 触发合并进同一 review，不叠加 | 移除冗余 |
| `ARC_LAYERED_MODEL`、旧 `work/claims` | 不复活，改由 thin 宿主承载 claims | 移除双宿主歧义 |

**权限/版本/环境边界：** 不改权限、预算、环境权威；review 为 advisory，不阻断动作；skill/memory 失败回执照常；动作历史不可回退；RESET 语义保持真实成本。

**放弃与恢复：** 每关 3 次上限；无新证据时 agent 可跳过 review 内容产出（runtime 记录 no-op）；预算不足/终态优先回任务；claim 引擎错误只记日志不阻塞决策。

## 运行前实验协议

- 目标证据层级：功能 → 全链路（scripted real-runner smoke）→ 自主采用（真实 provider 普通运行）→ 净收益（对照）。
- 主要变量与比较器：新 claim 定向 review + 产物承载（treatment）vs 当前 25 动作 CONSOLIDATE（control）；单因素消融臂仅加触发不加输入区。
- 模型/provider：待用户确认（沿用 Su15 类似配置；不自行启动计费运行）。
- 任务与样本：同一 ARC 关卡集合，独立 ≥3 次；初态/种子无法对齐时披露。
- 预算与停止：动作/时间/token 预算与既有运行一致；claim review 额外 token 上限 ≤ 每关动作收益折算；触发耗尽或终态即停。
- 主要指标：通关数；每关动作数；同坐标重复率；claim 触发→review→修订→使用的链条完成率；review token 成本；压缩次数与压缩后重建语言频率。
- 负例：claim 正确无反例时不触发；skill 保存后未使用；合理不修改；触发但产出为 no-op；预算不足放弃。

## 实现与验证

| 证据层级 | 状态 | Provider / environment | 产物及结论边界 |
|---|---|---|---|
| 功能正确 | 未验证 | — | 待实现后补 |
| 全链路可达 | 未验证 | — | 需 scripted real-runner smoke |
| 自主采用 | 未验证 | — | 需真实 provider 普通运行 |
| 净收益 | 未验证 | — | 需同预算对照 |

**剩余验证与下一可证伪检查：** 先实现触发位与 review 输入区（≤300 行），跑 claims smoke 与 self-harness 回归；再跑一次真实 provider Su15 样本看触发是否发生、产物是否被后续决策使用。
