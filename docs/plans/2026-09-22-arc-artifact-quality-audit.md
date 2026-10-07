# ARC 真实产物质量审计：方法、轨迹与研究

日期：2026-09-22。此文审计已有真实 provider ARC run 的落盘产物；它不把历史
产物当作当前代码或当前 provider 行为的验收。

## 判定边界

- observation、逐步 action、坐标、palette、changed-cell count 和关卡地图是 evidence
  或有明确 validity 的 memory。
- Auto-Research finding 可以精确引用这些事实。一个 access-gap / inconclusive finding
  同样是合格结果，不应为了产出 Skill 强行抽象。
- method candidate 必须给出 applicability、abstain boundary、scope、输入与参数、
steps/decision/stop/failure、prediction/falsifier。`single_situation` 只限制适用域，
不再阻止方法成为 Skill 或生成 parent authoring handoff；门禁只拒绝轨迹复述和
缺失方法结构的内容。
- 可装配的 Skill/Tool/Subagent 必须明确声明适用情境、输入、停止/弃权边界和验证方式；
  `single_situation` 是合法范围，具体参数和构造示例也可以保留，但不能把未经区分的轨迹复述
  冒充已验证规则。构造案例与相应事实仍须能追溯到 evidence refs。

## 历史真实 ARC run

| 运行 | 产物 | 判定 | 原因 |
| --- | --- | --- | --- |
| `arc-live-20260917-224141-deepseek` | `skills/ls20-frame-reading/SKILL.md` | 应拒绝为 Skill | 固定 game、5x5 sprite、具体颜色、rows、54/62/1483 changed cells、HUD 计数和关卡路线混在正文；这是 level/trajectory state，不是参数化方法。 |
| 同上 | 第一份 Auto-Research report | 合格 research-only finding | 清楚报告 child 无法取得所需证据、页大小限制和下一步 access 条件；没有伪造 method candidate。 |
| `arc-live-20260917-120329-gpt5.5` | `skills/delta-component-movement-tracking/SKILL.md` | 应拒绝为 Skill | 虽有 procedure 外形，但 `obs93-98`、rows61-62、~50/52 cells、固定 bbox 等案例细节成为操作规则。应拆为通用“候选主体识别/状态差分”方法加 scoped evidence。 |
| 同上 | Auto-Research findings | 合格 findings，未证明方法质量 | 以 evidence/uncertainty 记录局部机制和下一 probe；没有 method candidate，不能说明已形成 Skill。 |

因此历史运行不满足“Skill 是可复用方法”的设计要求；它们是本次回归负例来源，
而不是成功样本。

## 当前 deterministic real-bridge smoke 的范围

`runs/arc-harness-parent-authoring-final-20260922/cross-context-method` 现在检查：

1. child method 有 `cross_context`、applicability、abstain boundary、参数、分支、
   stop/failure、预测/falsifier，且 construction evidence 与 contrast 被精确引用；
2. child 只返回方法而非 component body；parent 读取 `skill-creator` 后独立写 body；
3. 真实 ARC bridge/Pi parent/child broker/native mutation/assembly/later action/assessment
   全链路均发生；
4. method 文本不含 observation id、固定 rows、changed-cell count 或 palette 这类
   轨迹复述标记。

该 smoke 的 provider 是确定性 test double，environment 是真实 ARC SDK/bridge，故
它证明机制可达和负例门禁，**不证明真实模型能稳定做出高质量抽象**。真实 provider
run 仍须单独检查报告与 parent authoring transcript，并把被拒绝/降级的候选也作为
观测结果保存。

本轮曾尝试启动 `arc_capability_experiment.py`（`ls20`，20 actions，1200 seconds）
写入 `runs/arc-quality-real-provider-20260922`；命令在执行前被外部 approval-review
服务的 HTTP 503 阻断，未创建可用于判断 provider 行为的 run。这不是 ARC/provider
失败，也不应被计入通过或失败的质量证据。

## 与 backlog 的关系

这次只加强 B（研究目的/产物）和 D（可恢复知识边界）的质量门禁。它没有实现
`deferred-research-todos.md` 中的 child 主动 action、lease 或控制权切换；main agent
仍独占 ARC action。
