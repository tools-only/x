# ARC 任务窗口与能力反馈：实施记录

日期：2026-11-20（Asia/Shanghai）。状态：实施中。

## 问题与命题

用户的三组运行观察（bp35、cd82、cn04；本地没有可核查日志）表明：多轮 Python 探查和像素变化并未收敛成可反驳的动作与目标判断；level 0 仍可能耗尽请求而达不到按关卡触发的自进化。当前代码的长回执、同一帧的多个表示、50 动作兜底和弱版本提示是可检查的机会；运行解释尚未由轨迹验证。

窄命题：在任务行动和 Meta 审查之间交付短而可恢复的带版本事实、重复工作的次数及动作之后的检查入口，能让 Agent 较少重算，并在 level 0 获得一次能力调整机会。任何组件的任务收益都需要后续真实行为证据。

减少父模型的重复取证、无意义回执阅读和达到复盘前的管理成本。若旧 revision 的数据仍被默默当成当前状态、错误动作被盲重试、反证从后续窗口丢失或复盘只增加报告而无后续使用，命题失败。

## 设计与成本

沿用 Python 持久会话、Workspace 的精确结果引用、SelfRoot 账本与既有 Meta gaps 轮；Host 只给版本、动作及结果来源和恢复提示，不评价胜利条件或组件价值。多个只读工具可在同一模型回合提交；共享 Python 会话顺序执行，动作之后的分析必须看新的观测版本。同一 Python cell 可计算多个独立问题。环境动作仍走原有边界，`arc_action` 无新字段。

最新状态及任务内存驻留；历史证据精确引用恢复。动画首尾和末态变化优先显示，中间帧按需读取。Meta 入口转录跨窗口重复与前次组件使用；Agent 自行选择假设、组件或放弃。Reset 后旧位置不再视为当前，但其反例和候选仍可检索。无新 worker、硬性语义门禁或 ARC 特定解析器。

第一次收益路径：Agent 接收带版本回执 → 按需读取精确结果或用当前状态执行下一计算 → 请求/触发 Meta 审查 → Agent 提出可反驳候选 → 后续动作和下一 Meta 窗口反馈。若缺少机会或预算不足，继续任务并保留证据引用；失败或过时的候选可修订或撤下。

## 运行前实验协议

功能检查针对版本改变、无变化动作、长结果恢复、同轮多个只读调用、level 0 请求兜底及无收益复盘的负例；脚本 provider 与 mock ARC SDK 接线只验证实际窗口、工具 schema 和动作恢复。普通真实 provider 用固定模型、前缀、推理设置、动作/时间/父子总 token 预算，对照旧版和单因素消融；先短诊断，再独立重复。测量任务进展、首次有效行动延迟、父子总成本/缓存、重复取证、假设反证之后的动作和组件实际消费。真实 provider 预算尚未授权，后两层未验证。

## 实现与验证

### A. 环境版本与旧数据提示

`_Env.revision` 在每次动作反馈时递增，包括网格没有变化的动作；Python 工具说明要求 Agent 将读取的数据与 `env.revision` 配对，版本变化时改读 `env.grid/env.state` 与 history transition，未知结果先重读再决定。功能检查：`tests/arc_thin_components.test.ts` 的新负例覆盖“动作后网格不变仍计版本”。

### B. 动作错误分类

`actionErrorCategory()` 将动作失败分为 VALIDATION、ENVIRONMENT_UNAVAILABLE、CONTENTION、BUDGET、OUTCOME_UNKNOWN，并给一句恢复动作；原始错误保留在 errors.jsonl，可见文本截断到 200 字符。`Refusal` 走调用修正，非环境失败也写日志，减少盲重试。功能检查由现有动作失败路径执行，未新增真实环境样本。

### C. Level 0 请求兜底

`metaPassDue()` 的请求兜底改为统计 `pin.kind === 'task'` 的 request_record，事实名改为 `task_requests_since_last_evolution`；`ARC_THIN_CORE=1` 时新增 `metaFallback: {unit:'request', interval:6}`，level 0 不再必须等关卡完成。功能检查：`tests/self_root_arc.test.ts` 新用例验证按 task request 触发并记录触发事实。

### D. 执行视图压缩

默认执行视图用 `last_failure`（最近一次未被后续成功调用覆盖的 tool_failed，含 ref、tool 和 200 字符摘录）替代 `recent_actions/recent_decisions`；`ARC_THIN_FULL_EXECUTION_VIEW=1` 且不在 evolution review 时恢复旧完整视图，完整账本仍可按 ref 恢复。功能检查：`tests/self_root.test.ts` 更新执行视图断言。

### E. Python 结果摘要与按需读回

Workspace.receipt 新增 `resultLabel`，Host 将 Python 回执标为 `python`：即使结果较短也写入 results/ 并给 ref，短行以外的长行先 stub；其他工具的短结果仍完整显示。默认 inline 阈值 8000→4000 字符，`ARC_THIN_RESULT_CHARS`（兼容旧 `ARC_THIN_INLINE_RESULT_CHARS`）可覆盖。功能检查：`tests/arc_thin_receipts.test.ts` 的 python 标签用例与既有恢复用例；native runtime 新用例确认 Host 收到 python 标签。

### F. 重复自述片段计数

`ARC_THIN_CORE=1` 且 compact ARC 开启时，task 窗口组装记录 `repeated_self_fragments`（self view 中 ≥40 字符且出现多次的不重复片段数）与 `self_view_chars` 到 context_budget.jsonl；Host 不编辑内容，由 Agent 和后续 Meta 窗口根据该事实决定合并、抽象或改策略。功能检查：由 smoke 的窗口组装路径执行，未构造专项长重复 fixture。

### G. system prompt 前缀稳定

同一决策内渲染结果字节相同且已有 customPrompt 时，写回上一次的同一字符串对象，减少 provider 前缀缓存失效；渲染结果变化时正常更新。功能检查：由 native system prompt 渲染路径执行，无独立单测。

### 运行结果

通过：`arc_thin_receipts`（修复用例后 4/4）、`self_root_arc`（5/5）、`self_root`（31/32，P5 合同 cap 断言在基线同样失败）、`arc_thin_efficiency`（5/6，宿主可选 reflectedSelf 未接的 TypeError 在基线同样出现）、`arc_thin_components`（11/14；tool forms、admit guard、loop mount 三个失败在基线相同，另有新增 env.revision 用例通过）、`arc_thin_native_runtime`（1/15；reflectedSelf 未接的同一 TypeError 在基线同样出现，其中“python label 到 Host”新用例在此环境不可判别）。接线：`arc-thin-smoke` 通过，4 个决策、1 次 consolidation、0 provider/environment/fatal 错误，窗口组装与账本检查全部通过。源码与测试的 provider 采用、真实任务收益未验证；真实 provider 预算未授权。

## 交付决定

按用户授权交付为“实现完成”：功能与脚本接线通过，provider 自主采用与净收益保持未验证。保留实验状态，等待真实 provider 对照后决定保留、修订或撤下；重复片段计数目前只观察不评价。后续需要一条窄命题：同一决策内的重复片段和重算次数是否下降，且任务进展不退化。该记录关联 `docs/deferred-research-todos.md` 的 C（总成本）与 D（跨压缩认知连续性）；延后清单未勾选完成。
