# ARC 观测表示与规划失败：证据诊断

日期：2026-09-30。对象：`runs/arc-ft09-context-workset-60-20260930`，并以 repair run 的公开动作结果作对照。只读取既有轨迹并生成诊断材料；没有修改 ARC 实现、重新运行游戏或向 Agent 提供历史通关坐标。

## 结论与证据边界

目前不支持把主因定为“环境 observation 被严重截断，以致父 Agent 看不到视图”。支持进一步调查的是“空间表示的认知成本 + 目标角色判定错误 + 失败后的策略/表示恢复不足”。这不是证明 codec 无问题，也不是证明压缩不会影响后期判断。

历史父请求没有完整 payload capture；system prompt 未存于 native transcript archive。因此无法逐字恢复首请求或关键轮的最终 provider body，也不能证明历史每一轮均包含完整 4096 个像素。当前能够恢复的是 canonical snapshot、部分父 native context、child 的精确 arc_state 文本、父 action/checkpoint 内容及 provider 边界的尺寸/hash/提醒标记。

## 1. 核实上传文本中的统计与推断

| 项目 | 证据结果 |
|---|---|
| ARC 动作 | execution-observations 中 47 条动作记录，43 成功、4 错误；43 条成功结果全部 changed_cells=0。不要把 47 条全部计作成功环境推进。 |
| 候选与计划 | 最终 18 个候选，selected_candidate_id=null，plan=null。自由文本 checkpoint 已有策略与下一步，缺的是正式选择和有状态的结构化计划。 |
| canonical 状态 | parent-state-1@v1 为完整 64×64 frame；紧凑 public_state JSON 8757 字符。 |
| 首次 arc_observation=0 | 是模块归类问题的可能表现：renderer 将 frame 注入 system prompt，而 classifier 先把 system/developer 全部计为 system_prompt。不能由此推断没有 observation。 |
| 首请求 system | 实际 provider 测量 system_prompt.string_chars=12975；task_prompt.string_chars=2944。棋盘不设计在 task prompt 中，后者长度没有像素完整性的证明力。 |
| 后期压缩 | 最后一次日志为 1073065→73534 字符，386→29 消息，归档 358。它描述 native messages 投影，不是完整请求的 system+tools 总体变化。 |
| 零变化反馈 | 实际父 provider assembly 有 11 次请求含 REPEATED ZERO PIXEL DELTAS，首次 request_index=5；父 archive 可恢复 10 个独立 user 提醒。上传文本“没有收到提醒”不符合这组记录。 |
| 未接线 detector | `_repeated_arc_action_intervention` 当前仅有定义，无生产调用；它与已暴露的 TS arcDecisionFeedback 是两套不同逻辑。不能把前者无调用等同于没有反馈。 |

所有原始汇总见 `evidence-summary.json`。provider telemetry 的 marker 是实际字符串存在性，不能证明 Agent 理解或遵循它。

## 2. 首次决策已经看到了哪些结构？

首次 action 的 reasoning 和首次 task_checkpoint 明确描述 A/B/C/D 四个面板、中心 2×2 像素构成的图案、外围较大的色块、右下黄色/红色边框、颜色及 mismatch 坐标。父还写出两个备选：修改中心图案，或修改外围环；选择中心是因为它认为环是固定输入，而不是因为未记录外围结构。

首动作 (44,44) 的 falsifier 本来就包含“目标像素保持 0 且其他像素不变”。实际返回符合这一反证条件。后续没有据此优先测试已提出的 ring-fix，而是改成不可见 mark/toggle、扩大集合、推测 RESET 持久性及坐标映射。主要竞争不断发生于隐藏机制家族内部。

repair run 的第二次点击 (38,38) 后有 38 个像素变化：36 个 (9→8) 构成 6×6 区域，另有两个 (12→11) 位于底部。它证明被测外围区域可交互，支持重新审视“中心是 reference、外围是可控输出”的解释，但单次变化不证明全部通关规则。

只由成功点击还不能推出游戏完全无隐藏状态；可靠约束是：在没有 API 或区分性终点证据时，零像素变化不构成隐藏进展的正证据。公开像素无变化也不等于所有公开 metadata 无变化，RESET 后动作可用性变化应单独记录。

## 3. 编码损失与认知成本分开看

从初始 snapshot 通过当前 codec 重建的 frame 文本是 8466 字符：metadata 前缀 212，coarse layout 552，2×2 tile map 1696，精确 coordinate runs 5941，metadata 后缀 65。此文件是重建，不是捕获的父 payload。与 8757 字符 public_state 比较，整体字符减少很小，不能称为“大幅删掉视图”。

archive 恢复了四个 arc_state 文本，均有 64 个坐标行；解码覆盖 4096 格，与 canonical 初态像素逐格一致，0 差异。但对照父 pi-events 的 toolCallId 后确认它们属于 child，不是父实际请求的证明。它们证明这些已恢复的 codec 输出确实完整，而不是仅存储中有原矩阵。

认知成本仍然明显：同一输入并置 8×8 coarse blocks、32×32 tile 坐标和 64×64 runs；tile legend 又把颜色 2/4/5/8/9 重映射成 glyph 1/2/3/4/5。runs 的行宽不等，无法像图片那样直接对齐辨认环与中心、重复结构及尺度。数据无损不保证模型能可靠完成这些空间关系判断。

当前 run 的模型配置为 deepseek-v4-flash、input=['text']，没有给它渲染图片。启用模型 image 能力也不等于已经向它发送 image content。`canonical-parent-state-1.png` 是本次诊断为了人类阅读生成的图片，不是历史模型输入。

## 4. 转换发生在哪一层？

1. Python adapter/bridge 提供 public frames，snapshot 保留 canonical state。
2. Pi `renderArcLatestFrameRuns` 用 coarse/tile/runs 编码最后一个 animation frame；最新 frame 像素不抽样，较早 animation frames 未进入此表示。动画时序是否任务相关需另验。
3. `before_agent_start` 每个 decision cycle 将当前 frame 加到 system prompt；action 回执主要给 transition/delta，不再重复全棋盘。
4. `publicToolDetails` 不重复 frames，并移除 delta.cells，只保留数量、bbox、目标像素及引用。历史动作结果/旧 arc_state 后续被 ARC context projection 替换为 marker。
5. 通用 context lifecycle 归档 native messages。system prompt 通过另一字段交给 provider，通常不在它的 message 投影范围。故“358 条消息被归档”不能直接证明当前 system 中的 frame 被删除。
6. provider hook 记录最终尺寸/hash与 marker；本次未开 body capture。native context 保存完整，也不等于最终 payload 相同。

仅 `compact_observation_context` 的显式 Agent 调用数为 0，不代表没有固定 ARC projection、parent result 生命周期或通用压缩。

## 5. 为什么提醒没产生有效恢复？

恢复出的旧提醒包含：`Zero visible change does not prove the hidden state is unchanged.` 它建议换区域，但没有明确要求证据区分、固定失败终点和失效后的回退；第一句话在当前失败模式中还可能被误用来保留隐藏进展解释。这是语义设计风险，不是已证明的单句因果。

研究报告曾把有限坐标/颜色无变化概括成“可见 painting 被排除，因此所有剩余 ACTION6 语义必须隐藏效果”。此排除忽略了未测可控区域。共同预测 silence 的多个候选看似竞争，实际上无法解释为何应该改测外围环。

已有无进展提示主要受 activePlan 条件控制；plan=null 时不触发这一提示。因此无限 discovery、选中策略迟迟未产生、累计试探成本上升仍缺少同等明确的恢复出口。最近新增 competition decision_review 能提示比较，但仍未自动生成或切换观测表示，不能据此宣称上述问题已解决。

## 6. 最小 observation-codec 边界建议（尚未实施）

环境 adapter 只负责 canonical public state 与动作；Agent-side Self-Harness runtime 负责表示选择、版本和输入寿命。保留一个默认 codec，Agent 从第一轮便有可用观测，不要求先创建能力才能看棋盘。

一个轻量表示资源包含 canonical_ref/version、codec_ref/version、params、coverage/omissions、lossless、chars/实际请求成本、reconstruction_status、raw_recovery_ref。最终 provider 边界再记录 representation_ref、source hash、覆盖范围及 request id；有效暴露不等于语义理解。

首期只需接已有 runs 与 raw matrix；图片在 provider 确实支持且收到 image 内容时启用。region crops、组件图作为 Agent 按需选择的替代 codec，返回几何事实，不预先断言 reference/target 或通关条件。

复用当前 decision_review 触发表示审查：重复零变化、预测失败、规则矛盾，以及没有 selected strategy/plan 的有界 discovery。先比较分割、尺度、坐标、reference/target 角色及动作可控性，再决定继续当前表示、换表示或做低成本对照。预算是阶段累计，不因改 hypothesis_id 自动重置。缺少规则时可选 provisional strategy，并带未知项、失败条件与有限 next test；不要求先证明全部规则。

发现阶段给一个丰富当前视图及必要替代视图；稳定执行阶段给当前状态和短 delta。失败/换关/会话压缩后能恢复全视图。当前观测采用替换槽位，不把每轮矩阵永久堆进历史。默认不要同时强制 image+matrix+graph+全部轨迹，避免以可观测性为由重新膨胀。

## 7. 验收应测什么（定义，未执行）

- 数据：各 codec 对 canonical 逐格 round-trip；crop 明确全局坐标与覆盖；animation omissions 明示。最终 provider body 解码/核对，而不是只核对磁盘 artifact。
- 空间理解：对同一初态识别面板/中心/外围及边界，定位指定像素与区域；评估 source/target 是否明确为待检验猜想。评测标注不进入 Agent 输入。
- 决策恢复：记录前三次目标选择、连续零变化后的第一个不同干预、从 discovery 到 provisional selection/plan 的动作数、未达终点实验是否被延长、同证据换名是否重新投入，以及有依据的延迟效果是否被误停。
- 对照：当前模型+紧凑文本；更强模型+同文本；同更强模型+raw matrix；多模态模型+图像。必要时再加 image+matrix 验证互补性。跨模型只能测组合收益，同模型同 modality 的对照更能隔离 codec 效应。
- 固定初态、核心 prompt、动作/研究预算、output 设置和工具权限；重复多次，报告总体 context/tokens、动作成本与成绩，不以单场说明因果。
- 真正 ARC Self-Harness closure 仍须遵循 AGENTS.md 的真实 bridge/Pi/child/router/native mutation/action/后续父轮及五组件矩阵、两类 length continuation。上述恢复材料和脚本不构成闭环或 provider 表现验收。

本诊断关联 deferred-research-todos 的 A（表示职责边界）及 D（压缩后认知连续性），均保持未完成，不表示已经授权全面重构。
