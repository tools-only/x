# 自适应目标驱动能力发展：实现与验证

日期：2026-09-26。当前分支内实现；未提交、未推送，未停止或重启既有真实模型 ARC。

## 本轮解决的两个问题

先扩大用途与试用空间，再调整主 agent 的工作流程，而不是增加新的组件配额或准入评审。

| 载体 | 放宽后的用途 | 保留的边界 |
| --- | --- | --- |
| Skill | 局部、首次、暂定的识别、判断、规划、测试、恢复方法 | 是可执行过程，不是轨迹复述；父 agent 使用 creator 作者化 |
| Pi Tool | 小计算、首次计算、降低抄写错误或推理成本的检查 | 必须有真实可执行 substrate、输入输出契约与授权 |
| Subagent | 同一证据的独立解读、干净或预配置上下文；可首次保存 | 不扩张环境权限；保存角色不是普通委派的前置条件 |
| system_prompt | 暂定的任务、关卡或适用阶段工作策略，用于重构规划行为 | 父 agent 显式创建/更新、精确版本装配；不覆盖宿主约束 |
| Memory | 有适用范围与生命周期的事实、假设、具体结论 | 不能代替方法的执行，也不能自动升级成 system 权限 |

Auto-Research 可研究目标解释、表示、评价设计、竞争性策略，不要求先知道完整目标或已经能定义最终环境实验。研究仍是只读的独立工作；组件作者化与环境行动属于主 agent。Review、意图和研究记录没有被新增为 Harness 组件。

新流程是：根据已知/未知目标选下一项有价值的学习或求解工作，识别值得发展的操作，选择直接执行、组件或研究，作者化并显式装配，实际使用，再分别评估局部预测、目标进展与方法成本。

早期允许经验归纳；目标更明确后允许规划与策略重构；反例出现时允许回到探索。没有自动阶段分类器、固定成熟度阈值、强制研究或各类组件数量目标。周期窗口只提供证据入口，不要求每五步生产新方法。

## 验证范围

- 新增/扩展的原生 Pi 诊断覆盖：显式 system-prompt followup、无 creator 的合法路径、单载体决策、关卡策略投影及失效、探索策略更新为规划策略后新版本进入后续父轮且旧版本退出。
- 指导送达诊断比较完整正文，并校验 provider 边界中的内容/hash；修复了正文改名而 exposure 仍匹配旧标题的漏记。
- 首轮针对性测试：26 通过。随后 system-prompt 与指导投影测试：16 通过。
- 最终冻结版本的针对性回归（含研究操作契约与 child 上下文）：32/32 通过，见 `runs/adaptive-verified-20260926.xml`。
- 两项旧文案测试替换为原生行为诊断后，与上述回归一起重跑：34/34 通过，见 `runs/adaptive-delivery-final-20260926.xml`。运行时代码未因此再改动。
- 三项预置 creator/研究编排 skill 的格式校验通过；格式有效不代表行为质量已验证。
- 扩大的最终针对性回归：43 通过、3 失败；失败均出现在既有 review 测试中，具体见下节。
- 最终冻结版本真实 SDK 冒烟：15/15 通过，记录为 `runs/arc-adaptive-capability-smoke-verified-20260926/arc-self-harness-smoke-summary.json`。`environment_mocked=false`、`runtime_boundaries_mocked=false`、`provider_mocked=true`。
- 全量回归：634 通过、53 失败，耗时 725.13 秒，见 `runs/adaptive-full-20260926.xml`。与 `runs/goal-evolution-full-20260925.xml` 按测试名称对照，51 项失败重合；另外两项逐字匹配旧 capability-process 文案。后两项已改为原生行为诊断（无先验验证的候选发布状态、完整指导送达且不强制创建组件），重跑通过。没有在这之后再次运行全量套件，不能将分次结果表述为全量全绿。

真实 SDK 冒烟使用真实 ARC bridge、Pi 主循环、child broker/process、结构化返回、代码路由、原生变更、装配、ARC 动作与后续父轮，覆盖五类组件、语义输出及 Auto-Research/普通 delegate 的 length continuation。但模型响应是确定性脚本，不证明真实模型会自主采用更高阶策略或通关表现提升。

## 独立指导层诊断

Luna 在干净上下文中阅读新版指导，针对非 ARC 的原始情境作出选择：

- 目标未知且观测少：先采用暂定归纳方法与信息性探测，不虚构完整目标。
- 局部运动预测正确但完成失败：区分局部模型与目标解释，考虑小型计算检查，不强制创建研究或 system prompt。
- 已有可靠方法且接近完成：继续执行，不为组件数量创建新资源。
- 同一任务进一步出现长期无进展、重复计算与推理循环：选择有界独立研究、计算检查和任务范围工作策略，并由父 agent 执行后续实验。

这是指导行为诊断，不是 Pi 自主决策或真实 ARC 验收，也不是有无新版指导的因果对照实验。

## 已知未解决内容

扩展回归中的三项失败也列在上一份全量失败报告中，不能声称本轮全绿：

- `test_review_normalization_preserves_outer_component_and_aggregates_required_fields`：review 外层元数据未按测试预期并入 candidate。
- `test_review_normalization_reports_candidate_conflicts_without_guessing`：未返回测试预期的外层/候选冲突诊断。
- `test_invalid_review_draft_patch_is_revisioned_and_lossless`：测试依赖不存在的旧 draft/patch 接口。

这些失败需要按现行协议继续区分真实缺陷与过时测试；本轮没有恢复已移除接口或宣称它们无害。

全量失败不限于这三项，还涉及 knowledge lifecycle、原生资源投影/调用、effect assessment、OfficeBench/Shopping 等。完整失败名称与堆栈保留在上述 XML；“与历史失败重合”不等于它们已解决。与上一份全量结果相比，thin initial surface、跨 level Tool/Subagent/Skill 作用域、实际 ARC Skill 读取入口三项本次通过；这些修正来自此前已落盘工作，不全部归因于本轮指导修改。

不能假定既有 ARC 进程已完整载入本轮变更，因此不把它作为新版行为的验证。新版本的真实 provider 自主运行、竞争性研究的质量、从局部技能向整体策略发展的实际效果仍未验证。后续应按“提出→作者化→入池→选择→使用→任务效果”逐项检查，不能只数组件。

本轮按 skill-creator 的意图、过程、场景检查方法修订预置 creator 与研究编排指导；没有植入具体游戏解法。延后待办 B/C/D 的问题连续性、父子实验通信和跨压缩认知质量仍保持未完成。
