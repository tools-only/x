# ARC 日志审计与主 Agent 使能修复

审计对象：`runs/arc-ls20-treatment-real1234`，以及 creator-gate smoke。

## 发现及修复

| 日志/代码证据 | 不符合设计的行为 | 修复 |
| --- | --- | --- |
| 20:17:59 review 缺 candidate.authoring_method_ref；20:18:23 重试报 No eligible candidate exists | 拒绝 skill 前已写 memory、提交 review 并生成 handoff，导致机会被消耗；不能仅归因于模型漏字段 | change 对整批 creator 先预检；review 在 commit 前预检。失败保留 review 机会，纠正后可重试 |
| 20:18:48 skill 写入，后续行动仍仅引用 memory；无显式 assembly receipt | 创建成功回执没有完整说明从 pool 到实际使用的路径 | change/adopt 回执返回新资源精确引用、当前 assembly revision、装配模板和必填决策；主提示明确 assemble → focus/invoke → action 引用 → assessment |
| handoff.ready_calls 仅有 start、handoff ref、interaction_mode | 新的 research-orchestration 门禁使“ready”调用实际不可执行 | 周期研究、方法反馈和跨情境候选的启动模板带 creator ref，并展示先读取对应方法的前置调用；读取仍由主 Agent 实际执行 |
| skills-r3 smoke 已读 creator，但 task-skills.jsonl.authoring_method_ref 为空 | router 在转成 native arguments 时丢弃作者引用；adoption 路径未执行父 creator 检查 | native route 保留作者引用；adopt 全候选和 apply_route 执行前核对父读取记录；缺读取不会消耗 ready route |
| 真实生成的 skill 将最小整除周期、单 changed group、计数器等推断写成通用规则 | 读过 creator 不证明方法正确；例如最小满足整除的周期可能是 1，单变化组也可能是重叠移动 | 主提示要求把推断保留为候选，明确几何线索不足以作身份/机制证明，并要求后续使用与实际结果验证 |

创建与装配仍是主 Agent 的选择。模板不会自动选择新组件、自动加载 creator 或启动研究。`active` 仍仅表示 pool 中可用；日志里的 resource ref 出现在 provider payload 不自动证明组件内容被选入或被实际使用。

本次预检修复针对 creator 契约，不能把它描述为任意 native 执行失败都可回滚的通用事务。现有真实运行及历史产物未被重写；已经启动的进程不会因此自动热加载修复。

## 验证

- creator/恢复诊断：缺 creator 的混合批次不会提前写 memory；同一 review 拒绝后可纠正；读取和创建都保留精确作者版本；创建不隐式装配。
- router 诊断：procedure/computation/role 的 creator ref 保留到 native call。
- 更新旧 fixture，使其真实读取 creator 再提交；修正固定调用序号断言以容纳 read_method，保留采用、装配及后续行动顺序断言。
- 最终版本 `runs/arc-harness-smoke-enablement-final-20260921/arc-self-harness-smoke-summary.json`：12 场景、283 项检查通过。覆盖五类组件、真实 bridge/Pi/broker/router/native mutation/action boundary/后续父轮，以及研究和普通 delegate 的长度续跑。
- 相关 pytest：66 项通过，另 3 项旧契约断言更新后定向重跑通过（共 69 项）；未宣称全仓测试全部通过。
- provider 与 SDK 环境在该 smoke 中均为 test double；证明 runtime 接线和生命周期可达，不证明真实模型生成的方法质量或 ARC 成绩。

采用 Code skill 的可测试步骤与验证流程。父子实验通信、跨压缩语义质量及真实 provider 收益沿用 deferred-research-todos 的未完成状态。
