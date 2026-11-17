# Meta-harness 变更记录：refiner 看不到决策过程，只看到动作行——按决策组织的轨迹窗口与图像载体

日期：2026-11-17（Asia/Shanghai）。状态：实现（功能/mock 接线已验证；真实 provider、自主采用、净收益未验证）。
按 [开发流程](../development-workflow.md) 使用。

## 问题与命题

- 真实失败/机会及材料：su15-sl1q（arc-selfloop，commit 4bc322d5，qwen/yibu，2026-11-17 分析）中自进化编辑落在 xx.md、view.py 等表层文件，未对应 prompt/context/harness/loop 四层。诊断（观察）：refiner 的轨迹输入只有最后 20 行 `recentLine`（动作+打分），不含 agent 的推理文本、python 调用与结果、任何图像；推测：refiner 看不到决策如何做出，只能对动作结果表层下手。对照参考架构 Continual Harness 的 HarnessEvolver：其输入为"自上次演化以来"的逐批未剪推理 + 工具证据 + 当前帧图像（≤50k 字符，drop-oldest）。本次对齐仅限"窗口与载体"这一行（用户 2026-11-17 指令）；CH 的 4-pass evolver 结构 2026-09-11 已被否决，不对齐。
- 窄命题：当 refiner 的输入按决策组织——每个决策给出 agent 说了什么（尾 2000 字）、它的 python 调用及结果、它的动作行及预测打分，并附当前棋盘图像——refiner 的改写能针对决策过程本身，而不只是动作序列的表面统计。
- 减少的负担：refiner 不再需要从动作行反推 agent 的想法（su15-sl1q 中它无法反推，只能泛化）；采集在决策结束时自动发生，不加父决策步骤，agent 的游戏上下文零改动。
- 适用条件：ARC_REFINE_WINDOW>0（默认 14000）且有 refinement 触发。合理不使用：ARC_REFINE_WINDOW=0 恢复旧 LAST ACTIONS 输入；模型不支持图像输入时自动不附图（`ctx.model.input` 门）。推翻条件：真实运行中带窗口的 refinement 产出的编辑仍不触及决策过程（与 su15-sl1q 同型的表层编辑占比不降）。
- 范围及非目标：只改 refiner 的输入构造与其数据源落盘。非目标：`arc_action` 不加任何字段（用户 2026-10-12）；不建 4-pass evolver；ledger/EXPECT/打分机制原样保留；非 python 工具调用的 args/result 不进 python_calls.jsonl（现状保留，记录在案）。

## 设计与成本

- 选择与取舍：窗口形状对齐 CH（自上次 refinement 以来、按决策分块、drop-oldest、最新决策必保留），预算用我们自己的（14,000 字符，非 CH 的 50,000）——refiner 是 agent 同模型的 sideCall，预算受 REFINER_SHARE 限制，不照抄 CH 的大窗。推理剪尾（结论在后），代码/结果剪头（签名在前）。图像用现成 `renderArcFrameImage(observation)`，不新建渲染。
- 生命周期：决策结束（before_agent_start，非续轮）→ 块记录推入 `decision_trace.jsonl`；refinement 启动时 `windowBlocksSince(lastRefineAt)` 把 trace、trajectory 行、python_calls 行按决策号拼成块；未结束的当前决策以 `ongoing: true` 入窗（agent 主动 `refine(focus)` 发生在决策中途）。重启时 trace 与 trajectory 一起重读。
- 首次获益路径：下一次 refinement 触发即生效，无父模型新决策；替换原 LAST ACTIONS 段（互斥，不叠加）。
- 新增与移除：新增 2 个环境开关（ARC_REFINE_WINDOW、ARC_REFINE_IMAGE）、1 个落盘文件（decision_trace.jsonl）、python_calls.jsonl 的 result 字段（400 字符）；refiner 输入换段；`refiner_inputs.jsonl` 记 window/window_from/image 以便逐次核查。无新常驻提示、无新 schema 字段、无新管理轮。
- 权限/版本/环境边界：REFINER_SHARE 预算门（refinerOverBudget）不动；sideCall 超时/上限不动；不读游戏源；窗口内容全部来自运行自身落盘。
- 放弃与恢复：ARC_REFINE_WINDOW=0 单开关回退旧输入；decision_trace.jsonl 只增不改，留档不可回退无影响。

## 运行前实验协议

- 目标证据层级：本次到功能正确 + mock 接线；自主采用/净收益需真实 provider ARC 运行（用户授权预算后）。
- 主要变量与比较器：同 commit 下 ARC_REFINE_WINDOW=14000（默认）对 ARC_REFINE_WINDOW=0（旧输入）；其余配置不变。
- 模型/provider/推理配置：本次验证全部 scripted provider / mock ARC SDK（本机 Windows 11，node 24 实验性 TS，python 3.x）；真实运行待定（qwen/yibu 或用户指定）。
- 总预算与停止规则：本次零费用。真实运行按发起时声明的 token 上限执行。
- 主要指标与判定标准（留给真实运行）：refiner 编辑触及决策过程的占比（对照 su15-sl1q 的表层编辑）；refinement 后 EXPECT 命中与关卡进度；refiner 输入字符与图像成本计入父子总口径。
- 负例：无 refinement 触发的运行（窗口零成本，仅决策尾采集）；无推理输出的模型（块内无 reasoning 行，窗口仍含 python 与动作行）；不支持图像的模型（自动降级为文字窗）。
- 遥测及材料：refiner_inputs.jsonl（window、window_from、image、完整 input）、decision_trace.jsonl、python_calls.jsonl（result 字段）。

## 实现与验证

- 改动入口及实际行为：
  - `demo/arc_thin_refiner.ts`：`WindowBlock`/`WindowPython` 类型、`renderDecisionWindow`（块渲染 + drop-oldest + 缺口标注"N earlier decision(s) … not shown"）。
  - `demo/arc_thin_extension.ts`：message_end 推理采集门改为 `carryChars || REFINE_WINDOW`；决策结束推 trace 记录（含 review 标记、尾 2000 推理）并落盘；`windowBlocksSince` 拼块（含 ongoing 决策）；`startRefiner` 在推进 `lastRefineAt` 前取窗；`runRefiner` 以 DECISIONS SINCE THE LAST REFINEMENT 段替换 LAST ACTIONS，模型支持时附当前棋盘 PNG；输入日志记 window/image。
  - `demo/arc_thin_native_runtime.ts`：python_calls.jsonl 行加 `result`（400 字符）。
- 功能/相关回归检查（全部本机、零费用）：
  - `node --experimental-transform-types --test --test-concurrency=1 --test-force-exit tests/arc_thin_refiner_window.test.ts tests/arc_thin_refine_ledger.test.ts tests/arc_thin_ledger.test.ts` → 40/40 通过（窗口渲染 4 新测试；refine-ledger 套件以 REFINE_WINDOW 默认开驱动脚本化 refinement 穿过扩展）。
  - `arc-thin-smoke --root runs/smoke-refwin-a` → `passed: true`，4 决策 0 错误；`harness/decision_trace.jsonl` 4 行：动作决策各对一行（from/to 对应动作号），合并评审决策记为 `review: true, from==to`，无话语的决策不写 reasoning 字段。
  - `python tools/run_foundation_smoke.py runs/smoke-refwin-b foundation` → checks 全部 `ok: true`（含 no_harness_errors）；末尾 `system_chars<=3000` 断言失败为 2026-10-16 起已知基线，非本次回归。
- 机会漏斗与断点：窗口文本与图像在每次 refinement 无须请求即进入 sideCall 输入（push）；替换的工作：refiner 对决策过程的反推；反馈：refiner 编辑仍由既有 ledger/EXPECT 打分闭环；退役：ARC_REFINE_WINDOW=0。未知断点：真实模型下窗口是否改变编辑去向——本次无法测。
- 语义与连续性：scripted provider 正常决策不产推理文本，推理行仅由评审决策与单元测试覆盖；真实模型的逐决策推理入窗未经真实运行检验。重启续跑的 trace 重读有代码路径与 smoke 存档，未单独构造跨重启断言（记为未完成实验）。
- 成本与任务结果：refiner 每次输入增至多 14,000 字符 + 一张 PNG，频率受 REFINE_EVERY=15 与 REFINER_SHARE 限制；决策尾采集为内存内字符串拼接，量级同既有 carryReasoning 路径。
- 协议偏离：无。

| 证据层级 | 状态 | Provider / environment | 产物及结论边界 |
| --- | --- | --- | --- |
| 功能正确 | 已验证 | 本机 scripted provider（无真实模型） | node 测试 40/40；渲染、剪裁、drop-oldest、空窗、review/ongoing 头均有断言 |
| 全链路可达 | mock 层已验证 | mock ARC SDK + scripted provider | refine-ledger 套件驱动 refinement 穿过扩展；smoke 产出 decision_trace.jsonl 且行义正确；真实 provider 链路未验证 |
| 自主采用 | 未验证 | — | 窗口是服务侧输入；"采用"须看真实运行中 refiner 编辑是否因此触及决策过程 |
| 净收益 | 未验证 | — | 需带预算的真实 ARC 运行对照 ARC_REFINE_WINDOW=0 |

## 交付决定

- 已支持的声明：窗口与图像机制功能正确、在 mock 链路可达、默认开启、单开关可退。未支持：它改变 refiner 编辑去向、带来关卡/成本净收益——均未验证。
- 决定与依据：保留在 arc-selfloop 分支，默认开（与 CH 对齐的最小载体修复，零费用证据齐全）；不合回 r04，待真实运行证据。
- 剩余验证与下一可证伪检查：一次用户授权预算的真实 ARC 运行（声明 token 上限后发起），对照同 commit ARC_REFINE_WINDOW=0，检查 refiner_inputs.jsonl 的窗口到场与编辑去向占比。不能写成已完成。
- 关联 backlog：`docs/deferred-research-todos.md` D（上下文压缩与连续性）相关——窗口即 refiner 侧的决策连续性载体；状态无新证据，不改动。
