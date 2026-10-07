# Harness 质量验收

> 2026-10-02：本文保留本轮历史证据。后续设计、开发和完成声明按 [开发流程与证据标准](../development-workflow.md) 分别验收功能正确、全链路可达、自主采用和净收益；本文测试结果不自动验收最新变更。

本轮目标是验证四条设计条件，不是单纯证明“创建了组件”。所有实现均在当前
分支完成；测试产物不覆盖用户已有 ARC run。

## 责任边界与闭环

```text
need
  → optional Auto-Research (findings / method candidate / plan impact / experiment request)
  → parent reads the applicable creator
  → parent authors a complete candidate
  → runtime validates and versions it into the pool
  → parent assembles exact versions
  → later real use
  → evidence-backed assessment
  → parent revises / retains / retires; optional feedback returns to the same research line
```

- Auto-Research child 是只读研究者；不读 creator、不输出 Skill/Tool/Subagent
  正文、不调用 Harness mutation。
- Parent Agent 是唯一语义作者和 assembly 决策者；研究是可选来源，不是创建
  前置条件。
- Runtime 只做确定性校验、版本化、pool、assembly、执行与证据记录，不发明
  方法正文或判断语义真理。
- Main Agent 独占不可逆 ARC action。

旧 `research_approval → route → apply_route/adopt_research` 仅保留内部迁移与兼容
测试；当前 `task_harness` schema 不暴露这两个 action，生产 child 工具面也不含
`research_approval`。正常 child 不再接收旧 component delivery/tool-program 合同。

## 验收层次

1. 单元/离线 Pi：验证门禁、版本、作用域、错误恢复和负例，只作为诊断。
2. `arc-harness-smoke`：通过真实 ARC bridge、Pi parent loop、child broker/process、
   structured child return、parent creator read、semantic change classifier、native
   mutation、assembly、ARC action boundary 和后续 parent turn。本次使用真实 ARC
   SDK environment，provider 为确定性 test double，因此证明接线和生命周期可达，
   不证明真实模型策略质量。
3. 真实 provider + 官方 ARC：验证模型是否实际遵守边界并产生有用方法；单次
   treatment run 不能证明因果收益，游戏质量仍需要配对实验。

## 四条机制层验收

| 要求 | 已验证行为 | 仍需真实 provider 验证 |
|---|---|---|
| Skill 是方法 | creator 门禁；方法结构含适用问题、输入、步骤、分支、停止、失败模式、预测与 falsifier；轨迹摘要不能装配为 Skill | 模型是否稳定归纳出可迁移方法，而非换一种措辞复述轨迹 |
| Memory 有生命周期 | task/episode/level/state 显式 validity；reset 后 level/state 失效而 task 保留；依赖失效可传递抑制 | 模型能否正确区分稳定控制规则、当前 level 地图和瞬时预算/位置 |
| Research 位于方法层 | child schema/tool surface 只允许 findings、method candidates、planning implications、experiment requests；组件正文被拒绝或历史降级丢弃 | 真实 child 的选题与方法候选是否具备当前行动价值和抽象质量 |
| Parent 可使能闭环 | creator read → parent-authored candidate → native version → exact assembly → later use → positive/negative assessment → same-line feedback；也覆盖完全不经研究的创建 | 真实 parent 是否会在合适时机主动选择 creator、装配、使用和评估，而非让机制悬空 |

## 已取得的证据

- 相关回归套件：`219 passed in 400.63s`，覆盖 parent-authoring 主流程、旧入口
  不可达、memory validity、assembly/use 和恢复/反馈。
- Auto-Research self-harness smoke 迁移：`6 passed`，包含 blocking/non-blocking、
  parent authoring 和 provider-length continuation。
- 生产 child 边界回归加上述 smoke：`7 passed`；provider context 不含旧 Harness
  delivery schema，child 工具面不含 creator/mutation/approval。
- 13 场 deterministic real-runner matrix：
  `runs/arc-harness-parent-authoring-final-20260922/arc-self-harness-smoke-summary.json`
  中 `passed=true`、0 failed checks，覆盖 `system_prompt`、`skills`、`memory`、`tools`、
  `subagents`、Auto-Research/普通 delegate 的 provider `length` continuation、
  方法正反 assessment，以及跨情境 method → parent skill authoring → ARC action →
  assessment → feedback。

以上 smoke 的 `provider_mocked=true` 且 `environment_mocked=false`。它通过真实 ARC
SDK environment/bridge 路径，但不是真实 provider 行为或 ARC 游戏质量证明。

## 未关闭的质量声明

- 需要新鲜、bounded 的真实 provider + 官方 ARC run，检查 child/parent/runtime
  边界是否被模型实际遵守，并记录任何拒绝、修订或未装配结果。
- 2026-09-22 已两次尝试启动
  `runs/arc-quality-real-provider-parent-authoring-20260922`（20 actions / 1200 秒）；
  两次均在执行前被权限自动审查服务的 `503 Service Unavailable` 阻断，命令未
  执行且 run 目录未创建。这不是 provider 或 ARC 运行失败，也不能算验证证据。
- `docs/deferred-research-todos.md` 的 B/C 仍是研究编排与父子通信的待研究项；
  本轮没有给 child 新增动作权限，也没有把这些 backlog 当作实现授权。
- 跨压缩认知质量与 ARC 表现因果收益尚未由本轮机制测试证明。
