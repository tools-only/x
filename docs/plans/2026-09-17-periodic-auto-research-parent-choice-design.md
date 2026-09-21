# 5/20 周期归纳与 Auto-Research 验证设计

## 目标

每完成 5 个 ARC 动作，由父 Agent 对当前窗口独立完成一次归纳；每 20 个动作改为对最近 20 步进行整合。Auto-Research 是父归纳之后的独立验证层，不替代父 Agent 的总结，也不自动决定研究调度方式。

## 数据流

1. Runtime 根据成功的 `arc_action` 生成 5/20 窗口。
2. 父 Agent 提交包含 `transition_analysis` 和各 harness 组件判断的 `task_harness(action=review)`。
3. Review 与完整父总结先持久化。
4. Runtime 从该总结生成 `research_handoff`，保留精确窗口证据、竞争解释、可证伪实验和高阶 pattern 验证合同。
5. Handoff 同时披露 blocking 与 non-blocking 两个调用模板。父 Agent 根据当前决策是否依赖研究结果显式选择，也可以说明理由后 defer/skip。
6. Auto-Research 只读分析证据，返回 verdict、反例、组合 pattern 和结构化下一实验。环境动作仍由父 Agent 执行；新 observation 可用于恢复同一研究会话。

## 关键约束

- 5 步或 20 步窗口不再硬编码 interaction mode。
- 新 handoff 启动时必须显式给出 `blocking` 或 `non_blocking`。
- 历史 handoff 仍兼容其已持久化的固定模式。
- Research 完成、同意父结论或生成 proposal 都不能自动提高置信度。
- 父 Agent 的 `transition_analysis` 原样保存在 review 和 handoff 中，便于比较 child 的支持、反驳或修订。

## 验证

- 纯契约测试验证 5/20 handoff 均提供两种模式、缺少显式模式时拒绝启动。
- 集成测试验证父 review 先落盘、完整总结保留、handoff 被披露、defer/skip 后动作边界恢复。
- 生命周期测试验证后台会话仍可按精确版本 reconcile 和 inspect。
