# Auto-Research 多研究职责实现与验收

日期：2026-10-01（Asia/Shanghai）。设计依据：[机制与多个研究子 Agent ADR](plans/2026-10-01-auto-research-mechanism-and-workers.md)。

## 实现

- 父通过 `auto_research(assign)` 授权问题、研究线、worker 职责、证据种类、有限 run/output 预算与停止条件。`workers` 查看精确版本及队列，`revoke` 撤销并取消当前执行。worker 与保存的 Harness subagent 组件仍是不同对象。
- `pi_auto_research_workers.ts` 保存职责、不可变证据批次和分析消费回执；`pi_auto_research_worker_runtime.ts` 在每次父模型请求前路由、调度、恢复和短交付。默认最多两个 worker 并发，每个计算片段最多提供 32 个新证据引用；不是每窗口创建一个 worker。
- 新动作、RESET/阶段变化、validation、组件调用与效果评估的精确版本，在授权的资源种类内入队。active 的输入快照保持固定；pending 等待新证据；completed 后的新工作创建后续 session，同 worker/研究线保留 checkpoint、前序报告、反例与未完成检验。
- 队列、可读权限、页读取、`consumed_evidence_refs` 和研究结论分别记录。只有 worker 的显式分析确认推进消费游标，runtime 不把新证据入队或报告渲染算作分析。
- `publish_research_update` 允许 active worker 发布经过现有 report 校验的阶段结果，复用 research_progress、experiment_request、planning_implications 和 method_candidates。当前/紧急结论交付短卡；以后相关结果仅交付索引。每次最多两个增量、4000 JSON 字符，详情可按 `research_update:...@vN` 读取；未放入短卡的尾部不会被误记为已交付。
- 独立分歧不会被多数表决合并。修订、撤回引用同 worker 的精确前序 publication；重复 publication 复用原 ref。相同阶段报告与完成报告不重复交付完整核心结论。方法和创作 handoff 也复用精确版本，语义候选修改才形成新版本。
- 父明确设置 `handle_periodic_reviews=true` 后，历史窗口属于授权职责，不逐个要求父 review/defer。已确认分析的窗口在撤销 worker 后保留交接回执；未分析材料仍待处理。这个回执不是已验证规则、组件采纳或完整 Harness review。
- 研究只读环境、写隔离研究产物。父读取 creator，经 `task_harness_create/change`、精确 assemble、真实语义试用和 assessment 采纳组件；使用/评估版本回到授权的研究线。普通 delegate 的显式动作授权没有被研究 worker 继承。
- run/output 预算耗尽、连续两个片段无分析确认、complete/drop、失败、父撤销和任务结束停止调度并保存状态。子请求按剩余已报告 output 预算限制；取消失败单独保存，不能把它伪造为成功取消。plan 的初始绑定要求显式选择已 release/runnable 的节点；worker 不能扩展任务或 release 语义依赖。
- ARC 实际注入的薄 prompt 已包含持续职责授权、短交付与 creator/create/assemble/trial/反馈指引；运行不依赖自动加载仓库 AGENTS.md。

## 遥测

Pi 0.80.6 的 provider hook 不提供请求 ID。遥测使用其串行尝试边界，清理取消或被下一次请求替代的尝试，替代原先 `inFlight.shift()` 的错配路径。响应头与生成完成分开；标明 `serial_latest_attempt` 和 `response_headers_only`，不把 HTTP 200 视作流完成。

保留 reasoning、非 reasoning output、进程/run/session 身份与原生 usage。缺失 reasoning 保持未测量；output 已含 reasoning，不能再相加。ARC summary 提供父、所有 child 和合计 token 口径，包括 pending/失败片段的已记录模型消息，不再只看普通 delegate 的完成返回。

## 验证

- Node 诊断：`node --experimental-strip-types --test tests/pi_auto_research_workers.test.ts`，10 项通过；覆盖证据入队/分析区分、版本冲突、重复队列、active 固定 cutoff、交接、有限 run/output 预算、取消失败记录和遥测取消/替代尝试。
- Pi 恢复/权限/取消回归：10 项通过，覆盖 pending 自动恢复、plan 完成同步、creator handoff、开放研究议程、blocking yield、length 原生 session 续接、选中观测权限、ARC validator 和普通 session 取消。开放议程诊断改用显式 research_line_ref；不把未指定 topic 的新研究自动合并到最近一条线。
- 实际 SDK 矩阵及新增持续场景：17/17 场景、419 项检查通过，退出码 0。见 [验证结果](../runs/arc-workers-accepted-matrix-20261001/arc-self-harness-smoke-summary.json)。ARC 环境与 runtime 边界均未 mock，provider 为确定性脚本；覆盖五类 Harness 组件及 Auto-Research、普通 delegate 的 provider length 续接。

撤销与完成竞态已修复：先持久化职责撤销，再按绑定的 run_id 取消；该 run 已完成时如实返回 completed、无需取消，普通 session 的版本校验维持原约束。

验收 provider 是确定性脚本。新增场景涉及两个同线 worker、active 短交付、分歧/修订/撤回、pending 恢复、completed 后续 session、真实 RESET 后反例状态保留、父 creator/create、精确装配、工具实际返回数值 2、assessment 与行动反馈回流、显式撤销，以及后续真实父 provider 输入。

## 仍需真实模型评估

未重新启动已由用户关闭的 60 步真实模型运行。真实 provider 的自主授权/选题/采纳、父 reasoning 与等待是否减少、父子总成本、跨阶段认知质量和关卡收益尚未对照验收。薄 prompt 引导 Agent 作出这些选择，runtime 不凭文本自行选择科学结论或强制生产组件。

B/C/D 的盲审条件、更细证据请求通信和真实跨压缩认知质量仍属延期事项，不因本次接线验收勾选整体完成。科学 `stop_when` 由研究 Agent 判断，runtime 强制可机械核验的预算与生命周期条件。
