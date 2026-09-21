# Auto-Research：有依据、有界、可局部评测的持续研究

## 定位

Auto-Research 围绕具体不确定性或缺失的解题能力展开研究。研究对象包括环境机制、状态表示、子目标解决流程，以及 agent 自己的推理、计算、探索和失败恢复过程。研究可以组织跨阶段证据，也可以借鉴已有方法知识构造候选，随后检验其在本任务中的适用性。

周期轨迹窗口是发现问题和取证的入口。研究以问题和可达的阶段目标组织，不以“总结完这段历史”或“创建某种 harness 组件”作为默认完成标准。

## 发起条件

父 agent 在现有问题与约束中明确三项条件：

1. **前提与材料**：具体困难、已知起始条件和未知项、真实任务/产物/轨迹引用、已有方法与可用反例，以及实际读权限、计算能力和父 agent 能执行的实验。任务契约或具体产物也可作为起点，不要求所有研究都先有交互历史。引用本身不授予访问权限。
2. **可达目标**：在当前材料、能力、预算下有机会完成的一个中间结论或能力，说明它将服务哪个后续决策。若目标依赖其他尚未解决的问题，先研究这些前提；不能直接委托缺乏支撑的“找出如何通关”。
3. **局部评测预期**：可达的阶段状态或代表性输入、预期可观测结果、区分成功与失败的判据、实际执行者、成本上限和停止条件。应在看到结果前确定判据，修改时说明理由，不能事后把失败重新定义为成功。

“有机会得到确定结论”指具备可判别的检验路径，不要求承诺成功，也不预设因果可识别。局部否定结果有价值；材料不足时允许 inconclusive。局部判据成立不等于整个机制得到证明或任务必然成功。

条件不足时，父 agent 先补材料、缩小目标或延后。child 收到不充分的委托时指出最小缺口、请求证据或建议更小的阶段目标，不凭空补造前提。语义准备由模型负责，本次没有增加自动运行时准入检查。

## 如何通过现有接口使用

| 内容 | 现有承载位置 |
| --- | --- |
| 具体问题、起始假设、范围、下一次用途 | standalone 的 `question` / `constraints`；计划节点的同名字段 |
| 局部预期、成败判据、执行者、成本/停止条件 | standalone 的 `question` / `constraints`；计划节点的 `completion_contract` 及约束 |
| 跨阶段材料与前序研究结果 | `evidence_refs` / `resource_refs` / `context_window`，使用实际返回的精确引用 |
| 当前候选、竞争解释、反例、未完成检验 | 既有 `research_checkpoint` 的 findings、unresolved_questions、next_step 等字段，不发明新的必填 schema |
| 新环境实验 | `experiment_request`，由父 agent 判断并执行授权动作 |
| 实际局部评测与后续用途 | 既有 report 的结论、证据、限制和验证计划，以及 delivery 的 expected_effect / reconsider_when 等字段 |

复杂目标继续使用现有计划和依赖机制。将解释、构造和评测视为研究活动，不强制各起一个 child。基于前序结论语义才能开展的节点使用 `parent_release`；不要仅因 predecessor completed 就假定其结论成立。

父 agent 选择与问题有关的成功、失败、对照和非相邻历史，并提供实际访问条件。child 超出可访问材料时请求补充，不假定获得完整父对话或档案。

## 研究连续性和反馈

- 同一问题等待新证据时，使用可恢复的 pending/failed session；active 工作先 inspect，避免重复启动。
- non_blocking child 可保存 pending checkpoint 等待证据；blocking child 必须返回最终报告，不能等待尚未发生的父动作。
- completed/cancelled session 不可 resume。后续实验或阶段检验需要新研究时，建立有界后续问题并引用前序 `research_run` / `research_report`；连续的是研究问题和依据，不保证同一个 session 永久存活。
- 新周期 handoff 若与已有研究重复，父 agent 明确 defer/skip，并把相关证据交给已有研究。没有自动合并 handoff 或 session 的能力。
- 研究产物给出下一次适用场景。父 agent 使用后记录资源版本、起始状态/输入、实际输出、阶段结果与成本，并作为新证据回流。研究据此修订、限制范围或淘汰方法；创建、曝光、调用和实际收益分开判断。
- 没有可用证据、应用机会或合理预期收益时暂停或结束研究，避免无限延长研究线。

## 例子：操作前置条件诊断

以下是任务设计示例，不断言任何具体 ARC 机制。

**材料**：已有两次无效操作和一次成功对照，包含 before/action/after 记录；有一组候选前置条件，且父 agent 能在明确的局部阶段内负担至多两次额外操作。使用真实可读引用，不编造 observation ID。

**目标**：在该阶段检验哪项候选条件能解释差异，并提出一个操作前检查流程。若缺少区分条件的机会，缩小为核实某项必要观测，而不是要求完整通关方法。

**评测**：先声明不同假设对应的可观察转换；父 agent 确认起始条件后执行 probe 并返回原始结果。对照预测与实际转换；如形成诊断方法，在后续适用案例中再检验。达到两次 probe、起始条件改变或已区分解释时停止。仍无法区分则明确 inconclusive；借助同一批构造案例验证的局限需要披露。

**可能的交付**：有适用条件的诊断 skill、计算比较特征的 tool、经支持的局部规律，或缺口报告。没有组件类型配额，也不要求研究一定产生 harness mutation。

## 本次变更和验证边界

更新 parent/child 核心指引、按需 operations、method profile、状态转换研究和交付指引，同时对齐工具描述、自动 periodic handoff、method research contract 与文档。继续沿用现有字段、权限、调度和路由。

组件和 native Pi fixture 仅检查 guidance 的装配及相关契约兼容性；不能证明真实模型会更好地研究，也不构成 ARC self-harness 闭环验收。真实研究收益需要后续在同等预算下对比无效动作、重复分析、恢复成本、局部判据完成情况与最终任务进展。

本次诊断结果：

- `python -m pytest tests/test_research_prompt_layers.py tests/test_harness_review.py tests/test_harness_control_repair.py -q --basetemp .pytest-grounded-guidance-20260918`：38 passed。
- ARC 常规/恢复入口指引同步后，复核 `test_arc_recovery_preserves_progress_intervention_and_reset_epoch_policy`、`test_arc_recovery_accepts_research_before_the_final_action` 和 `test_periodic_handoff_changes_lane_at_twenty_and_inherits_exact_window_material`：3 passed（其中 handoff 检查为重复复核）。
- `git diff --check` 通过。此次没有运行真实 provider 对照或声称完成 ARC self-harness 闭环验收。
