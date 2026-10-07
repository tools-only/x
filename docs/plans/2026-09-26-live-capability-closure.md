# 真实 ARC 能力发展闭环：本轮修复与验收

## 起点与边界

2026-09-26 03:12 左右，既有 `arc-goal-evolution-ft09-20260925/run`：
52 个真实动作、完成 2 关、NOT_FINISHED；Memory 13 个身份/14 个版本，
Skill 1 个身份/1 个版本，其余三类组件为零，Auto-Research 未启动。
Skill 已装配、读取并有后续行动依据，但长期目标反证之后没有形成修订、
独立研究或新的规划能力。本轮不将通路存在等同于实际行为闭环。

坚持五种组件、主 agent 作者化/装配/环境行动、研究 child 只读。
不设置组件配额、固定成熟度阶段、强制研究或质量准入评分。
旧运行混合使用旧模块与动态读取的新指导，不能直接当作最新版本验证。

## 已证实问题与分工

- SOL：待推进机会的 oldest-first 三条正文遮住近期机会。改为有界索引、
  明确的完整 inspect 入口和同时保留近期机会的详细投影；不作语义排序。
- SOL：child 工具 schema 要求完整方法档案，与后续解析器的暂定方法支持
  不一致。放宽可缺省字段而保留真实结构/类型与父作者化权限。
  这是潜在断链，不是旧运行从未启动研究的直接原因。
- SOL：checkpoint 缺少显式清除旧判断入口。增加父 agent 的 clear_fields，
  不由 runtime 推断哪些策略过时。精确完成的 level-review 收敛对应旧失败。
- 主 agent：将上述可执行入口与恢复指导对齐；按具体操作判断复用覆盖，
  选择能力发展后推进实际调用，修改假设后同步更新或清除旧 checkpoint 字段。

## 真实验收

1. 新的正常真实 provider ARC 运行，不注入预写组件、不强迫覆盖五类组件、
   不使用 scripted provider 冒充自主行为；沿用 ft09 和既有 provider 便于对照。
2. 分别检查机会、creator read、作者化、候选池、精确装配、读取/调用、实际
   动作采用、结果反馈。非 Memory 产物必须实际帮助一个操作，而非凑数。
3. 检查从早期局部规律到目标/约束驱动的问题选择，后续策略比较、研究或
   能力修订，以及真实试验结果进入下一次判断。没有该证据就保持未通过。
4. 真实 SDK 的 arc-harness-smoke 另验证五类组件与两种 length continuation；
   它只能证明链路，不代替第 1–3 条。

持续按可观测差距修复并重跑；记录每次版本、provider、实际行为与负面结果。
不得把模型自主判断全部转交给确定性 runtime，也不以同一假设反复试验
或大量 Memory 记录宣称高阶能力发展成功。新版实验使用新目录，保留旧日志。

## v4 后的定点优化

v4 已证明父选择 Tool 开发、成功读取两个 creator 后，未提交任何非 Memory
组件。这不是已发生的准入拒绝。SOL 核对 creator 内容及意图仍进入后续上下文，
不能将原因直接归为压缩丢失。当前结果中大段 creator 正文先于最小提交模板，
模板又先展示可选完整方法档案；直接开发意图的持久化依赖已有复盘机会。

采用两项小改动，不改上游 creator 正文、不新增准入条件：

1. Creator 回执首先标明“准备完成，尚未发布”，展示最小 candidate/change
   和接下来装配/试用的流程，可选方法档案置后。完整 creator 仍须提供。
2. 主 agent 可显式提交独立 development_intent，不以周期 review/research
   为前置条件。只保存主写的 operation_id/purpose/status/next_step 等控制
信息；Memory 写入不能代替完成该操作。跨上下文恢复仍用既有 followup。

公开调用为 `task_harness(action="development_intent", development_intent={...})`，
也可随 `read_method` 提交显式意图。新增 append-only 控制日志
`task-development-intents.jsonl` 不是第六类 Harness；它统一新写入的操作状态，
不修改组件或装配。已有 review/capability_review 的意图共用该有序状态，
避免按相同毫秒的时间戳错误选取状态。旧记录兼容读取，不推断父未写的意图。

主 agent 选择开发后，推进最小提交、精确装配和可观察试用，或明确保留同一
操作的延期原因和恢复条件。system_prompt 共用直接意图入口，但不引入 creator
要求。选择哪个载体、是否值得开发仍属主 agent；代码不作语义判断或代写。

验收依次为：针对性原生诊断（独立意图、恢复、Memory 不清除、最小作者化），
完整真实 SDK smoke（只能证明链路），冻结新版本的真实 provider ft09。
真实记录需要呈现非 Memory 的内容/装配/语义使用，以及目标驱动的方法试验
或修订；未出现即不标记两个行为目标已完成。
