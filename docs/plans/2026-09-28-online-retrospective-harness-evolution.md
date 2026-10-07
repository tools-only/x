# ADR: 在线复盘直接推动 Harness 方法演进

日期：2026-09-28。状态：实施方案。

## 背景与约束

ft09 真实运行已产生关卡成功路径和失败模式，但探索阶段的 System Prompt 未升级，复盘没有稳定地改善后续 Harness。当前 `level_review` 保存具体轨迹和 `success_path`，下一轮上下文投影简短索引；`capabilityReviewSources` 还把成功路径包装成一个 `capability_followups` 机会，要求主 Agent 再走独立的 review 路由。该中转不符合主 Agent 直接作者化与装配的边界。

环境是单次生命、在线推进的。旧动作和旧坐标只能作为证据，不能成为下一关的执行脚本；真实动作每次由主 Agent 基于当前 observation 决定。方法可在当前任务或某类关卡内复用，不要求跨任务普适，但必须在适用条件下重新绑定当前状态变量。

## 决定

保留 `level_review` 和 `success_path` 现有存储格式，明确其含义为**回顾性证据**。下一轮可执行指导由主 Agent 从复盘中直接归纳，优先表达为：当前 observation 中读取什么、如何构造候选/判断下一步、预期可见结果、何时停止或重估。坐标、颜色、目标集合、预算等只能作为历史例子，或作为每次使用时从当前 observation 填充的参数；不能从上一关固定复用。

复盘到组件没有额外 adapter、优化事项队列、逐项处置状态或组件配额。主 Agent 读取精确 `level_review`，如有值得发展的能力，就使用现有 Creator 和 `task_harness(change)` 直接创建/修订 Skill、Tool、Subagent 或 scoped System Prompt，引用复盘及原始证据；随后显式 assemble、在下一段真实在线状态中试用、观察效果。Memory 可走轻量捕获。没有值得改变的能力时可以直接继续，不必提交“不变”记录。现有 capability review 可保留处理其他来源，但不再把 `level_review` 自动包装为它的必经机会。

复盘后的下一轮上下文只提供有界、面向未来的提示与精确 review ref，不投影旧 `success_path.steps` 作为待执行步骤。提示要求主 Agent：更新 checkpoint 中已改变的任务目标/约束/策略；若现有探索 policy 不再适合，直接创建或修订阶段性的 System Prompt；如需要可靠的规划、候选比较、计算或独立复核能力，按相应组件作者化。Runtime 不判定阶段、不自动生成方法或组件。

## 数据流与职责

`online action → public outcome → level_review archive → next parent turn (current observation + bounded review index) → optional direct Creator/change → exact assembly → one current-state action or semantic trial → later assessment/review`

- 复盘档案允许具体轨迹和失败细节，用于证据追溯；候选方法必须面向未来状态并声明适用范围。失败记录只提供反证、停止和恢复条件，不被默认重播成负面规则。
- 主 Agent 作者化目标模型、方法、策略及载体选择；Auto-Research 可提出竞争性方法，但不自动采用；子 Agent 不执行真实 ARC 动作。
- Self-Harness runtime 仅校验、存储、按精确版本装配/投影、执行及记回执；ARC adapter 只提供公开环境状态和执行单步 action。
- 终局只读复盘不能立即修改 Harness。若没有后续父轮，结论停留在证据档案，不能宣称完成组件演进。

## 备选方案与权衡

1. 直接重放 `success_path` 动作：实现简单，但旧坐标和状态会污染不可回退的下一段在线轨迹，拒绝。
2. 新增 review adapter/优化队列并强制每项处置：可追踪但增加控制层和主 Agent 流程成本，违反边界，拒绝。
3. 采用现有 review、Creator、change、assembly、assess 接口，并强化下一轮投影及前瞻性指导：最少新机制、保留主 Agent 语义控制；代价是不能保证模型总会采纳，须靠真实 provider 实验评估。采用。

## 失败模式与验收

- 模型把旧坐标当新关卡指令：下一轮投影不得包含旧步骤列表；方法指导要求观察变量现填、适用条件检查；测试用变化后的公开帧验证不直接复用旧坐标。
- 复盘仅保存未影响组件：测试主 Agent 可从 `level_review` 精确 ref 直接作者化、入池、装配、后续语义试用；不得依赖 `capability_followups` 中转。只读、无后续试用不得计为效果。
- 阶段提示停留探索：测试下一轮 parent 能看到当前 goal/checkpoint 与 review 来源，并能直接修订 scoped System Prompt；但不得设置固定动作数或自动 phase label。
- 长上下文稀释：只投影有界索引及精确读取路径；复盘全量留在资源库。跨压缩后的语义连续性仍按 `docs/deferred-research-todos.md` D 项单独验收。

组件测试证明 schema/索引/直接作者化；`arc-harness-smoke` 通过真实 bridge、Pi parent、child broker/process、router、native mutation、ARC action 和后续 parent turn 验证连线，并保持五组件与两类 provider-length continuation 矩阵。provider/环境模拟的 smoke 不证明真实模型会形成高阶方法或提升 ARC 表现；若做此类声明，需要真实 provider ARC 运行。
