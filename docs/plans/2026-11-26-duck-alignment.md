# Duck 对齐方案

日期：2026-11-26。状态：F1 已实现并通过 deterministic smoke；真实 provider 对照需另行授权。遵循 docs/development-workflow.md。

## Duck 机制（官方源码核实，github.com/Tufalabs/duck-harness）

- 全程单一 `python` 工具。host 每次调用启动全新 CPython 沙箱子进程（stdio JSON 协议），把游戏状态注入为全局变量：`current_frame`、`previous_frame`、`history`、`transitions`、`last_transition`、`valid_actions`、`last_action_result`，外加 `action(actions)` 与 `result`（`ARC3-Inference/inference/agent/python_tool_sandbox.py`）。
- 代码内 `action(actions)` 经 stdio 回到 host 执行真实动作，host 立即重绑所有状态变量，代码继续执行——一次 tool 请求内完成 读→算→行动→读新状态→再行动 的闭环；game_over/level_completed/run_complete 必须停。
- 每轮上下文只带元数据（步数/关卡/合法动作/上一段执行摘要）+ 模型被强制重述的 world model 文本 + 可选当前帧 PNG（`MULTIMODAL_CONTEXT=current_grid`）。完整 ASCII 网格不自动进上下文；frame 只暴露 `.ascii`/`.segmentation`/`.step`/`.level`，原始数字网格刻意隐藏，提示要求"never print full boards"。
- 命名空间不持久（每次调用全新进程）；历史按最旧驱逐，保留约 30 个 assistant 轮。

## 与当前激活运行时的逐项对照

| Duck 机制 | 我们现状 | 差距 |
| --- | --- | --- |
| 状态注入为 Python 变量，代码内直接读 | `python` 已注入 `state`/`grid`/`prev_grid`/`history`，且有跨调用持久会话（强于 Duck 的一次性命名空间） | 无差距，我们更强 |
| 代码内 `action()` 连续行动，动作后状态即时刷新 | `env.act()` 闭环已实现（重放协议，每动作注入观察重跑代码，MAX_ACTS=24，行动即结束决策，arc_thin_native_runtime.ts）——普通 python 片段与 saved code 同路；views/consults 不能 act | 已对齐 |
| 行动结束本轮，下一轮收执行摘要 | `finish()` 已输出 "ACTED n action(s). This decision ends." 并 terminate | 无差距 |
| 上下文只带元数据+world model+可选 PNG | 2026-11-26 刚翻为 inline 完整 lossless 网格+PNG | 方向相反，待对照，不预设结论 |
| 每轮强制重述修订版 world model | memory/strategy 为持久记忆，无每轮重述要求 | 候选提示因素 |
| 单一工具 | 五类组件池（arc_action/memory/skill/python/read…） | 按设计原则不替换，仅可做消融变体 |

## F1（主因素）：普通 python 代码可直接行动

实现：去掉 `env.act` 的 saved-code 门槛，普通 `python` 片段经同一闭环行动（`via='python'`；saved code 仍归因 `tools/<name>.py`）。保留 MAX_ACTS、动作预算检查、逐动作回执落盘、level change/game over 停止和"行动即结束决策"；`save=` 保留为可选复用路径。预计改动极小（放行点在 arc_thin_native_runtime.ts:211 一带 + 工具描述 + 测试）。

窄命题：同预算下，每个真实动作消耗的 provider 请求数与父 token 下降（Duck 的核心效率来源），无效动作率与动作质量不劣化。推翻条件：盲目批量行动使无效动作上升、回执语义丢失、重放不一致，或总成本不降。

已知代价与风险：save 门槛的原意是把行动归因到有版本的组件、推动组件沉淀；放行后组件创建率可能下降。按 Duck/Kaggle 证据（27B 档 hand-crafted tools hurt、let the model improvise）接受该取舍，并保留 save 路径让沉淀仍可发生。重放协议要求代码对注入的 acts 观察确定性重放——该机制已有，ephemeral 代码走同一条路径，不新增机制。

实现与验证（2026-11-26）：
- 功能/接线通过：`node --experimental-transform-types --no-warnings --test --test-concurrency=1 tests/arc_thin_activation.test.ts tests/arc_thin_components.test.ts`（15/15）；`python tools/run_foundation_smoke.py tmp/smoke-ephemeral-act-20261126c activation`（exit 0，mock provider + production bridge + actual Pi + WASI）。
- 回归抽查通过：`tests/arc_thin_action_surface.test.ts`、`tests/arc_thin_native_context.test.ts`、`tests/arc_thin_workspace.test.ts`、`tests/arc_thin_native_runtime.test.ts`、`tests/arc_thin_query_observation.test.ts`（11/11）。
- 真实 provider 同预算对照（请求数/动作、父子总 token、无效动作率、关卡进展）需用户授权后另行排期。

## F2（独立因素）：观测交付三方对照

inline（现默认）vs Duck 式元数据+PNG vs query，同模型同预算独立运行对照。Duck 不内联完整网格的理由（省常驻输入）与我们翻 inline 的理由（省取证往返）相反；F1 落地后代码内读取变便宜，可能改变天平，因此 F2 必须在 F1 之后测，不预设结论。三种模式开关均已存在，无需新实现。

## F3（独立小因素）：行动前重述修订版 world model

Duck 在每轮提示中强制"BEFORE EXECUTING NEW ACTIONS YOU MUST ALWAYS GIVE THE REVISED VERSION OF THE WORLD MODEL"，并把上一轮的 world model 原文带回。我们对应物是 memory/strategy；候选最小实验：在系统提示加一行同义要求并把 active strategy 原文带回，不新增工具或字段。与 F1/F2 分开测。

## F4（可选消融）：duck-variant

`ARC_THIN_DUCK=1` 式单工具变体（仅 python+act，隐藏其余组件池工具），只作为对照组衡量五类组件池的净贡献，不替换默认 harness（遵循 docs/harness-design-principles.md：self-harness 不围绕局部工具复用实验重定义）。优先级最低。

## 不采纳的 Duck 设计

- 一次性命名空间：我们的持久会话+checkpoint 严格更强，保留。
- 隐藏原始数字网格、只给 ascii/segmentation：我们的 lossless 坐标 runs 是用户确认的观测表示，不删减。
- 30 轮最旧驱逐：native 历史摘要（12k 字符预算）已覆盖同一需求，不替换。

## 顺序与证据边界

一次只改一个主要因素：F1（已完成功能/接线）→ 授权后真实对照 → F2 → F3；F4 视需要。功能正确与全链路 deterministic smoke 已过；自主采用和净收益未验证。关联 docs/deferred-research-todos.md 的 B/C/D（研究到行动、父子总成本、认知连续性），保持开放。
