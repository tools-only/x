# 延后待办：ARC 边界与 Auto-Research 模式

记录日期：2026-09-16。
来源：本次关于 Auto-Research 输入、在线/离线研究、父 Agent 上下文及 ARC adapter 边界的讨论。
状态：已记录，待后续讨论和排期；本记录不表示相关方案已经实现或批准立即重构。

## 何时再次提及

用户要求在未来合适时机提醒。后续在本项目遇到以下主题时，先检查相关待办是否仍未完成，再简短提醒并说明与当前工作的关系：

- ARC adapter / bridge / Pi extension 的架构调整或职责拆分：提及 A。
- Auto-Research、sub-agent 输入、研究模式或环境交互的设计：提及 B、C。
- context 压缩、session 恢复、长任务遗忘或观测 token 成本：提及 D，并视需要关联 C。
- 项目路线图、阶段复盘或下一阶段选题：检查全部未完成项。

提醒应随相关工作触发；无关任务不反复提醒。用户仅要求先落盘，实施需由后续任务范围决定。本记录不是定时通知或后台监控。

## A. ARC adapter 职责边界（主要待办）

用户明确的目标边界：狭义 adapter 是 Agent 与 ARC 环境之间的代理，向 Agent 返回环境状态，接收并执行具体 action；研究、上下文管理和执行策略由 Agent 侧承担。Agent 侧包括确定性的 runtime，不要求所有工作都由 LLM 完成。

本次审查判断（后续实施前应按最新源码复核）：Python adapter/bridge 较接近这一边界；Pi ARC extension 同时集成环境工具、观测投影、context hook、研究辅助及 self-harness gate，职责混合。runner 是编排层，不应仅因 ARC 命名便视为 adapter。

- [ ] 明确 environment adapter、Agent runtime、Agent policy/research 的模块契约和依赖方向。
- [ ] 将模型/provider 配置（如 `resolve_model_settings`）归入 runner/config。
- [ ] 梳理 Pi ARC extension，将历史 frame 移除、重复状态读取投影、action-cycle 边界、checkpoint、session 恢复归入 Agent runtime。
- [ ] 将 self-harness prelude、treatment/control 工具策略归入 Agent 侧实验配置。
- [ ] 将 connected components、shape signature、effect ledger、motion card 等派生特征归入 Agent 侧观测/研究能力，明确其不构成语义或因果证明。
- [ ] 评估 trajectory projection 是否拆成独立只读 observation service；记录 canonical observation 与派生视图的区别。
- [ ] 将 action sequence 保持为上层组合工具，底层 adapter 只执行具体动作。
- [ ] 核实预算、RESET 和动画帧采样各自属于 SDK 强制语义、benchmark 配置还是本项目策略；不要把现有本地策略一概视为官方环境规则。
- [ ] 补充边界验证：相同环境状态产生相同 canonical observation；adapter 不依赖 findings、memory、child 身份或 research mode；不同主体的授权和不同视图投影在上游完成。

定位入口：

- `src/autoresearch_pi/arc_agi_3_adapter.py`
- `src/autoresearch_pi/arc_agi_3_bridge.py`
- `demo/pi_arc_agi_3_extension.ts`
- `demo/pi_arc_task_tools.ts`
- `demo/pi_arc_trajectory_resource.ts`
- `src/autoresearch_pi/arc_agi_3_e2e.py`

## B. 离线研究目的与可观测条件

用户提出：父 Agent 可把全局或局部轨迹交给隔离 child，按猜想验证、double check、开放探索等目的发起研究，平衡归纳能力与自发探索能力。

- [ ] 设计彼此独立的研究目的和可观测策略，避免只增加 prompt 标签。
- [ ] 比较归纳、假设检验、独立复核、反例搜索、开放探索、方法归纳等模式。
- [ ] 比较完整公开轨迹、局部引用、隐藏父结论、隐藏结果、delta 及按需读取等视图。
- [ ] 评估先独立提交结论、再揭示父 Agent 判断的盲审/揭盲流程。
- [ ] 用同任务、相近预算的对照实验评估 findings 质量、证据支持、分歧和后续决策收益；不能把 child 一致意见视作独立环境证据。

限制：完整公开观测不等于环境隐藏状态；局部视图不能泄漏 evaluator 私有信息。现有 ARC child 有只读环境工具，不应描述成只能接收父 Agent 文本的纯总结器。

## C. 在线研究与父子通信

用户提出：child 请求探索动作，由父 Agent 转发；父子可通过完整、压缩或局部公开状态通信，构造不同研究条件。runtime broker/lease 是讨论中的候选实现，尚未选定。

- [ ] 比较逐步审批、结构化 probe 转发和有界 research lease 的成本与自治程度。
- [ ] 将权限、调度、通信和观测路由放在 Agent 侧，保持 ARC adapter 不感知研究模式。
- [ ] 支持 child 主动请求证据或追加观测，再逐步评估主动 action probe。
- [ ] 比较完整结果先经过父模型、仅经过 runtime 转发、仅关键摘要回到父模型三种数据流的上下文成本。
- [ ] 保留 canonical observation、精确引用、状态版本和动作回执；区分父 Agent 的解释与原始证据。
- [ ] 设计共享环境的动作顺序、状态过期处理及 parent/child 控制权交接。
- [ ] 若环境支持，再评估快照分支、回放及可回滚实验；不可预设 ARC 已支持。

验收方向：child 能完成“假设 → 请求实验 → 新证据 → 修订结论”；父 Agent 能按需查看依据；探索中间 observation 可独立路由给 child，并衡量总 token、动作和延迟成本。

## D. 压缩后的认知连续性

已讨论的风险：原文落盘可恢复，不代表后续模型输入仍保有旧推理；只保留 archive marker 不能保证关键认识延续。已有 task checkpoint、memory、findings 和 context lifecycle，具体运行是否启用及其阈值需重新核实。

- [ ] 联合检查通用 lifecycle、ARC frame projection、Pi 原生 auto-compaction 和 session rotation 的作用顺序及实际 provider 输入；不能只检查一个字符上限。
- [ ] 验证当前配置下关键假设、已排除解释、未完成实验及决策理由是否跨压缩/恢复保留。
- [ ] 评估归档前语义 consolidation，明确其与现有 checkpoint/memory/finding 的分工，避免重复建立多份真值源。
- [ ] 比较扩大工作窗口、改进观测表示、语义状态维护、将探索移到 child 的效果与成本。
- [ ] 验证关键历史证据可检索、可恢复，且结论始终区分 observation、假设和已验证认识。

定位入口：`demo/pi_task_local_context_lifecycle.ts`、`demo/pi_agent_owned_observation_compaction.ts`、`demo/pi_external_benchmark_research.ts`、`src/autoresearch_pi/arc_agi_3_e2e.py`。

## 后续更新

开始任一项时，补充最新代码证据、范围与验收方式；完成后勾选并链接实现/实验结果。候选方案在确认前保留为待探索项。
