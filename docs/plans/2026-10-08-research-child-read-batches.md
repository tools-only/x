# Research child：有界取证工作集

日期：2026-10-08（Asia/Shanghai）。状态：实现完成、功能诊断通过；真实采用与净收益未验证。

## 问题与命题

- 真实失败：B30 官方 ft09 / yibu qwen3.8-27b / reasoning off 的研究 child，15 次 toolUse、605955 reported（input 509604、cache 95232、output 1119），零报告。请求文本从 36782 到 112124 字符；工具页面持续保留。证据见 [成本审计](../../tmp/self-harness-goal-20261007/b30-real-cost-audit.json)、[checkpoint](../../runs/self-harness-goal-b30-installed-create-retry1-ft09-20261008/task-context-cache/auto-research-checkpoints/research-session-1.json)。
- 窄命题：研究 child 到达读取工作集容量边界后，用现有 compact 保存 Agent 的阶段认识并释放已处理页面，或暂停该计算片段；不会继续无限增加原始读取页面。明确压缩后，父计划的证据依赖不再使 child 原文重新常驻，精确版本仍可按权限恢复。
- 减负：避免父额外管理取证循环、避免旧页面逐轮重复输入；不要求每页总结。
- 推翻条件：压缩后旧页面又被自动注入、反证摘要或精确恢复丢失、忽略容量边界仍继续成功读页、普通父或 delegate 的保留行为改变。
- 本次仅改取证批次生命周期。最终完整请求 token 目标、研究总额度/父行动保留额度、结构化 ARC 检索另行单因素验证；不扩充运行预算，不启动付费运行，不重启历史 run。

## 设计与成本

- 复用 child_context(compact/read/restore)、research_checkpoint、既有权限/版本和 artifact。单纯缩小通用历史窗口会被 protected page/恢复逻辑抵消；固定调用次数限制不对应实际材料大小；新增管理 worker 增加模型和协调成本，均不采用。
- 仅 Auto-Research child 默认采用 32768 bytes 的 resident read-result text 工作集目标，可通过 PI_AUTORESEARCH_CHILD_READ_BATCH_MAX_BYTES 覆盖，0 显式禁用。依据 B30 的每页约 7–8 KB，目标容纳约四页；这是待真实模型验证的初始工作集设置，不是通用最优阈值或 provider token 计量。
- 保留完整原子结果（包括必要网格/PNG），允许最后一个结果越过目标；后续取证进入资源边界。图像成本不按 base64 字符冒充输入 token。初始不可变 workset、system/schema 及最终 provider envelope 不纳入这一局部目标，仍由现有 provider 准入保护。
- runtime 在下一轮展示一次短容量事件，给 child 一轮用现有接口保存认识/压缩、交付或主动暂停。原始页仍完整供这轮分析。进一步读取/恢复在资源边界被拒；不判定证据充分，也不要求得出结论。未释放容量且未终止时，runtime 保存 pending/manual_resume 并取消当前片段，保持此前语义状态及精确页面，不伪造报告/消费。
- 生命周期：runtime 识别容量→child 形成阶段认识/保留反证并压缩→runtime 释放页面/恢复准入→child 按需恢复与继续→报告交付仍由原 router。若未整理，runtime 保存 pending，授权 Agent 决定续研；窗口不新建 worker。Harness 候选/装配/使用不属本次命题。
- 研究 child 的已确认释放页保留冷引用，不因父 active plan 自动恢复原文；未确认页仍保留，父和 ordinary delegate 的依赖保护不变。
- 常驻工具/schema/worker 数量不增加；更新已有 child_context 描述替代旧说明。容量事件只在压力时出现；整理可与已有阶段工作同轮完成，额外 child 管理轮与时延待测。父无需新增必填字段或每批批准。
- 摘要语义由 Agent 负责；权限、版本、hash、task identity、真实环境边界仍由 runtime 校验。失败或取消不会删除 canonical evidence。

## 运行前实验协议

- 本次目标：功能与真实 native Pi 生命周期诊断；不声明 ARC 全链路闭合、自主采用或净收益。
- 比较器：B30 冻结源码/已有读取保留测试。主要变量是研究读取批次的资源边界与显式释放后冷引用表示，其他预算/环境行为不变。
- provider/environment：Node hook fixtures 与 real Pi / scripted offline provider / generic public task；不是付费 provider 或官方 ARC。
- 预算：诊断 paid=0，真实 ARC actions=0，单 native fixture timeout 沿用现有 60 秒；新测试使用独立 root。保留原失败，不自动重跑全部矩阵。
- 判定：跨多页取证后容量事件可达；忽略边界暂停且无后续成功读取；compact 后实际后续模型输入保留阶段认识/反证并减少原文；精确恢复、拒绝未授权版本、失败 compact 原子性；小批次、父/delegate、length/失败恢复相关回归不退化。
- 负例：原子大结果、重复页、错误 compact、无语义摘要、手动恢复过大、父计划依赖、worker consumed receipt、无新证据等待、provider length。
- 遥测：复用 child context choices、read-workset coverage、research child control、checkpoint 和 provider context/payload。reported/currency 性能缺少真实对照，不作成本节省百分比。

## 实现与验证

- 入口：`pi_child_context_control.ts` 在研究 child 的读结果工作集达到字节目标后拒绝进一步检索，保留完整原子结果，给一轮分析/compact/报告/暂停机会；没有释放则在 turn_end 保存 pending/manual_resume 并 abort。重复页不重复占用配额；child_context(read/restore) 也受边界约束，compact/inspect/report 不被当作检索。
- `pi_task_validation_child.ts` 复用原 checkpoint/父接收逻辑保存压力原因、结果 refs 与容量；已有 draft_findings/unresolved_questions/next_step 保留。成功的 worker consumed receipt 释放原文，读取统计不视为语义进展。
- `pi_read_workset.ts` 将研究 child 已声明消费的父计划依赖保留为可恢复引用；父和 ordinary delegate 原有依赖保留测试通过。被 native compaction 自动重建为 user message 的页也能被 compact，释放后 marker 不再带原文 lease 标志。restore 原文不会清空 Agent 的 continuity summary。
- Node 22/22 通过（新增研究批次10例＋既有读取工作集12例）：[JUnit](../../tmp/research-read-batch-node-20261008.xml)。负例覆盖继续读/绕过 read/restore、错误 compact、超大原子结果、重复页、worker receipt、配置控制工具、native rehydration、普通 delegate 与禁用边界。不是模型行为或官方 ARC 接线证据。
- native Pi / broker / scripted provider：四个独立 root，compact→下一实际 provider payload→精确恢复→结构化报告，忽略容量→pending，已有语义 checkpoint→pending 保留，non-blocking broker→父 harvest pending，全部通过。最终摘要包含反证及未执行实验，原文从后轮输入移除，恢复页 hash 相同。该场景是脚本引导，不能声明自主认知连续性。[最终 native XML](../../tmp/research-read-batch-native-r5-20261008.xml)。
- 通用上下文相关检查19/19通过：[XML](../../tmp/research-read-batch-context-r2-20261008.xml)。此前选择的 length、ordinary delegate、blocking pending 等9项通过；thinking 丢弃旧测试最初失败，显式声明原本应使用的 discard_unsigned_thinking 后通过：[r3 XML](../../tmp/research-read-batch-native-r3-20261008.xml)。生产 reasoning policy 未修改。
- 测试适配修正：两个旧 telemetry fixture 没有 event bus/最终 observer，适配到现有 final-provider-payload 接口；生产 telemetry/lifecycle 模块未改。原始失败 XML 保留：[native r1](../../tmp/research-read-batch-native-20261008.xml)、[regression r1](../../tmp/research-read-batch-regression-20261008.xml)、[context r1](../../tmp/research-read-batch-context-20261008.xml)。r1 native 首次因测试读取 resource_ref 的字段名称错误失败，实际 compact/pause 已执行；不隐去失败。
- 字符/bytes 下降是表示诊断，scripted usage 不是成本测量。无真实 provider 对照，不报 token 节省、游戏进展或任务净收益。阶段管理往返、父子总实际 token/latency、真实后轮科学判断均未测。
- 协议偏离：真实代码检查发现 B31 已独立在 ARC 入口默认 bypass Auto-Research；本次不覆盖其配置、不运行其 ARC 协议、不恢复旧 run。新控制在研究调用已启用的 task 中生效；未来新 ARC run 必须仍显式 enabled。本次 native 通用任务诊断不替代 B31 的真实 ARC 唯一验收。

| 证据层级 | 状态 | Provider / environment | 产物及边界 |
| --- | --- | --- | --- |
| 功能正确 | 通过 | Node / scripted native Pi | 22 Node、4 native、19 context；仅资源边界/表示与生命周期 |
| 全链路可达 | 未验证 | 官方 ARC | 未运行完整 arc-harness-smoke |
| 自主采用 | 未验证 | 真实 provider | 未启动 paid |
| 净收益 | 未验证 | 真实独立对照 | 未测父子总成本/任务进展 |

## 交付决定

保留为待真实模型评估的实现。已支持有界取证、明确消费后的原文释放/精确恢复、拒绝继续读时 pending 和语义状态保留；未支持自主及时交付、真实认知质量、研究总计算或父行动预算保护、ARC 全链与净收益。相关 backlog B/C/D 保持开放。

下一可证伪检查：在授权余额和 unknown 核对后，同配置新隔离有界真实 child 是否自主 compact/交付，比较实际后轮原文、反证、未执行实验和决策理由；若反复 pending/管理成本上升或判断退化，修订目标/撤下默认，而非增加提醒或 worker。最终请求 token 目标与 child 总 reported/父行动保留额度是后续独立因素，本次未实施。不复用历史生命，不扩大预算。
