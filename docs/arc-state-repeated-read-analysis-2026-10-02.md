# ARC 连续读取 arc_state：停机与原因分析

日期：2026-10-02（Asia/Shanghai）。范围：分析本次真实 provider 运行；未修改运行机制、未重启游戏。

## 1. 停机事实

运行：`runs/arc-ft09-workers-real-60-20261001-235544-run`，游戏 `ft09-0d8bbf25`，qwen3.8-27b/yibu，text,image，treatment，60 动作上限。

按用户要求，于北京时间 00:28:37 完成经身份校验的进程树终止。runner、Pi node、bridge 与 SDK 子进程共五个进程均已退出；运行产物保留。`user-stop.json` 是用户停止记录，不能当作游戏自然结束或正式评测成功。本次强制终止未确认 scorecard 正式关闭，也没有伪造 runner summary。

| 指标 | 停止时证据 |
| --- | --- |
| 原生动作 | action_budget.total_used=6，上限60 |
| 关卡 | 0/6，NOT_FINISHED |
| arc_state | 11次，涉及3个不同帧hash |
| 完全重复读取 | 2次：同snapshot、同request、同body hash |
| 父模型完成消息 | 12条 |
| 已报告output | 113,572 token，含104,659 reasoning token |
| 父模型请求JSON大小 | 从48,352增长至134,877字符 |
| 研究worker | 未分配；没有auto_research工具调用 |
| 结构化计划 | 未建立；仅一次文字checkpoint update |

token只统计已完成消息的已报告usage；停止时尚未完成的生成成本未知。请求JSON字符含图像传输，不能直接视为文本token。

## 2. 哪些读取正常，哪些重复

初始map/full提供不同精确表示；动作后读取新帧以及首次裁剪不同区域，可以服务颜色、坐标与结构比较。不能把11次调用全部归类为无效重复。

北京时间00:05:22，同一父模型响应并行请求四个crop：左上、右上、左下和右下大目标区域，返回同一快照`observation_snapshot:parent-state-2@v1`。

- 00:06:49：左上区域缩小边界后重新读取，属于重叠子区域，非完全相同request。
- 00:07:07：再次读取右上`crop:38,2,59,23`，snapshot与body hash完全相同。
- 00:11:59：再次读取左下`crop:4,38,25,55`，snapshot与body hash完全相同。
- 00:15:20：同一帧改读full，以另一表示重建全局材料。
- 00:23:55：动作后快照已变为parent-state-3，读取右下属于新状态观测。

这些是模型实际发出的工具调用；不是bridge自动轮询被误计成arc_state，也没有工具读取失败触发重试。各次读取约6–25毫秒，耗时主要在模型生成。00:07:07至00:11:59间一次完成响应约292秒，output17,296、reasoning17,173，随后调用的是上述重复左下crop。

## 3. 四个假设与检验

### H1：当前比较材料被过早压缩（已复现）

`demo/pi_arc_context_projection.ts:79`的`compactHistoricalArcFrames`把包含`ARC_OBSERVATION_VIEW`的所有工具结果归为frame。它仅按消息位置保留一个`latestFrameIndex`，没有区分同帧的不同coverage；遇到后续assistant又将原视图加入consumedFrame。

用本次真实tool_execution_end内容回放生产函数，四个并行crop在首次比较续轮只有最后完成的右上crop保留正文，其余三个已替换；再增加一次assistant生命周期消息，四个crop全部替换。诊断产物：

- `runs/arc-ft09-workers-real-60-20261001-235544-run/arc-state-context-replay-input.json`
- `runs/arc-ft09-workers-real-60-20261001-235544-run/arc-state-context-replay-result.json`

回放中assistant仅为生命周期占位，不重放内部推理，不声称是完整provider payload回放。此诊断证明投影机制会丢失比较材料，实际重读与之吻合；未做保留材料后的真实模型对照，不能认定它解释了全部调用。

### H2：模型需要反复核对精确数值与比较关系（部分正常）

当前父轮系统提示仍保留完整PNG/十六进制网格；因此不是完全失去当前环境。crop提供方便比较的局部数字网格，初次读取有实际用途。但完整图像仍在不等于局部结构比较已被持久化。

本次文字checkpoint仍为首次测试前的策略和next_step，没有保存样例对应关系、已排除规则、差异集合或下一检验。投影还将超过1,800字符的已完成thinking替换为尾部1,200字符，不能保证其中间比较结果保留。两者共同增加重新提取、比较的负担；具体心理动机不由日志直接证明。

### H3：工具允许并鼓励重读（已确认代码路径）

`demo/pi_arc_agi_3_extension.ts:243`中`showFrame = mode !== 'current' || ...`使显式map/full/crop每次返回正文，不检查相同snapshot/request是否已有材料。历史视图替换提示还写着`Use arc_state to re-read current pixels`，没有保留原crop的精确视图ref与coverage。

因此即使环境未改变，重复读取也可成功返回完整网格；没有针对零新证据的明确回执。简单禁止重读也不正确：当前投影确实可能已移除了模型需要的材料。

### H4：进展提示覆盖不到当前循环（已确认接入缺口）

`demo/pi_external_benchmark_research.ts:509`仅在active结构化plan下累计noProgressTurns，且在agent_end更新；其提示在1522行再次受activePlan限制。本次无结构化plan，多次工具续轮也不等同于agent_end，所以不能依赖它及时发现当前重复读取。

`src/autoresearch_pi/pi_kernel.py`虽有可选read-only watchdog，但ARC runner在`arc_agi_3_e2e.py:1962`调用`wait_for_agent_events`时未传watchdog；本次无watchdog事件。不能把通用模块存在当作ARC已启用。

Auto-Research持续职责机制已接线，但本次父未授权任何worker。不存在可承接样例比较、规则探索与持续结论更新的研究职责；不能由runtime在没有授权时自行启动语义研究。

## 4. 修复方向与验收

1. 以快照版本和coverage组织当前观测工作集。同一动作阶段正在比较的多个crop应共同保留；新动作、明确释放或预算策略决定替换，不能只保留最后一条消息。
2. 每个视图保留精确可恢复ref、snapshot、coverage和hash。重复读取反馈必须区分材料仍在当前上下文与已被移除；不能只返回“已读过”而让模型无法恢复。
3. 将已完成的关键结构比较、反例和未完成检验写入现有checkpoint/研究产物。子worker在父授权后承担持续分析；不要按每个crop新建worker。
4. 在provider续轮/工具完成边界观察新证据与任务进展，覆盖没有结构化plan的任务。初次不同crop不是停滞，重复的同帧同coverage/被已有coverage完全覆盖的读取才需要进一步判断。提示也应允许有界核对和真实材料恢复。
5. 先回放同一批四crop与精确重读，验证模型比较输入完整；再通过真实Pi/provider的工具续轮检查输入，再做真实模型ARC对照。仅函数诊断不能证明模型减少重读或提升游戏成绩。

这是延期事项D中“落盘可恢复不等于认知连续”的具体案例，也关联C的研究材料路由。此次分析不将D/C或真实收益标为完成。
