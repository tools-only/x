# LP85：Auto-Research 目标与 Harness 组件最新版本

核对日期：2026-09-18；运行：`arc-lp85-treatment-20260918-114901`；以下仅介绍读取时每项记录的最新版本，不列版本演进。

共有 1 个已完成研究 session、3 个 Skill、4 个 Memory（其中 1 个已退役）；1 个 Skill 由 Auto-Research 审批路由转化，其余组件由父 Agent 创建或修订。

## Auto-Research 研究目标

以下五项是同一个 `research-session-1`（最新 v3，completed）中的研究子目标，completed 表示报告完成，不表示所有假设均已验证。

| 研究目标 | 一句话介绍 |
|---|---|
| 原始帧与父摘要一致性 | 用原始画面复核目标方块位置，发现并纠正父摘要中的位置错误，避免误算剩余旋转步数。 |
| 旋转差分解码 | 将一次有效点击的像素变化拆成方块置换与计数条变化，在第一关三个有效点击上核对 `18×16+5=293`，形成可检查的预测方法。 |
| 计数条含义检验 | 通过正向、反向和无效点击的对照，获得第一关计数条随有效点击增长且与方向无关的局部证据，尚未确定其终止含义。 |
| 通关条件假设检验 | 比较特殊方块进入同色框、特定排列和点击次数触发等解释，提出最多四次左旋的区分实验，报告提交时该实验尚未验证。 |
| 方法局部有效性 | 检查点击分类、完整旋转解码与逐步预测能否产生正确输出，确认部分局部能力可用，但未证明跨关卡适用性或后续任务收益。 |

## Skill：可复用的方法说明

| 组件 | 最新版本 | 状态 | 来源 | 一句话介绍 |
|---|---|---|---|---|
| `arc-click-diff-decoding` | v1 | active | 父直接创建 | 通过无效点击对照和图像差分识别控制按钮、旋转方向及计数变化，并建立位置索引来减少穷举点击。 |
| `arc-ring-perimeter-decoding` | v3 | active | 父回顾创建并修订 | 将棋盘重建成相交的循环序列，利用跨带连通、半圈交换和共享格子规划目标方块移动，并逐步核对原始帧。 |
| `click-rotation-counter-decode-v1` | v1 | active | Auto-Research 审批路由转化 | 将有效点击拆成旋转块与计数条、核对完整置换和变化像素数，并从最新帧重新生成位置与成本预测，当前主要在第一关得到局部验证。 |

## Memory：状态与策略知识

| 组件 | 最新版本 | 状态 | 来源 | 一句话介绍 |
|---|---|---|---|---|
| `lp85-board-layout-v1` | v3 | retired | 父创建并退役 | 保存第一关的二十格环、按钮映射、计数变化与目标假设，现作为历史记录保留并退出当前指导。 |
| `lp85-click-policy-v1` | v2 | active | 父创建并修订 | 约束重复试探和路线成本，要求使用环境动作预算核算，并按关卡重新验证计数条增长规则以避免误把条件指示器当成逐次点击计数。 |
| `lp85-ring-model-v2` | v18 | active | 父创建并修订 | 保存 Level 3 的坐标、行列循环、目标框、方块位置和剩余计划，为下一动作提供工作模型，其中计数条逐次增长的旧表述仍与最新策略冲突。 |
| `lp85-goal-reframe-rule` | v1 | active | 父创建 | 指导运动预测成立但预期通关未发生时重新检查目标条件，不过当前文字将普通未通关直接等同证伪，适用条件仍需收紧。 |

Memory 的任务状态或策略可通过 `task_prompt` 投影进入后续上下文，该投影不是独立 System Prompt 组件。

## 其他组件与证据边界

| 项目 | 一句话介绍 |
|---|---|
| Tool | 本次运行未发现已持久化的自定义可执行 Tool 组件。 |
| Subagent | 本次运行未发现已持久化的 Subagent 角色定义，研究 child 的运行不等于沉淀了这类组件。 |
| System Prompt | 本次运行未发现已持久化的任务内 System Prompt 组件，prompt 组装日志本身不构成组件创建。 |
| 使用与收益 | 当前 Skill 日志包含写入和上下文投影记录，但本次未见 `read_by_agent` 事件或独立效果评估文件，不能仅据此认定各组件已产生收益。 |

## 记录来源

- [研究 sessions](../runs/arc-lp85-treatment-20260918-114901/auto-research-sessions.jsonl)
- [研究 reports](../runs/arc-lp85-treatment-20260918-114901/auto-research-reports.jsonl)
- [Skill 最新记录及历史](../runs/arc-lp85-treatment-20260918-114901/task-skills.jsonl)
- [Memory 最新记录及历史](../runs/arc-lp85-treatment-20260918-114901/task-memory.jsonl)
- [研究转化回执](../runs/arc-lp85-treatment-20260918-114901/auto-research-harness-route-receipts.jsonl)
- [Skill 事件](../runs/arc-lp85-treatment-20260918-114901/task-skill-events.jsonl)
