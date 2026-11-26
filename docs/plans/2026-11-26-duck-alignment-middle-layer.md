# Duck 对齐（middle layer 分支）

日期：2026-11-26。状态：layer 行动边界已实现并通过实际 Pi/ARC bridge（mock 游戏、脚本 provider）；真实 provider 对照未验证。遵循 docs/development-workflow.md。Duck 机制核实与因素框架沿用 activation 分支的 docs/plans/2026-11-26-duck-alignment.md（commit d1cabafd）。

## layer 路径纠正（本分支主方案）

2026-11-26 用户选择：只保留 layer 及其相关机制；Python namespace 固定跨调用持久。已移除 `ARC_LAYERED_NAMESPACE_RESET` 分支及对应 guest 参数。清理其余 ARC 入口前需先拆出 layer runner 正在从 `arc_thin_e2e.py` 和 `arc_agi_3_e2e.py` 导入的 bridge、Pi 与预算公共函数；`arc_layered_extension.ts` 还直接使用 `arc_thin_ch_view.ts` 和 `arc_thin_requests.ts`。这些是当前依赖，不表示要保留 thin 的 Agent 路线。

此前记录和交付结论针对 `arc_thin_extension.ts` / SelfRoot，不能代表主方案 `arc_layered_extension.ts`。主方案已通过 `arc_layered_prelude.py` 把 `current_frame`、`history`、`valid_actions` 等变量绑定在常驻 CPython namespace；`submit_actions` 在同一个 Python cell 中经 bridge 行动并刷新变量。Pi 模型仍在 Python 进程之外；需要执行任意 Python 读取或计算时仍有一次 `python` 工具调用，这与 Duck 的模型/沙箱边界一致。消息中直接附带状态概览和图像，可不调用工具读取这些已呈现内容；不能把“模型直接读进程变量”作为已实现能力。

实际缺口是行动后的决策生命周期：layer 原先在普通行动后 `steer` 新状态到同一 Pi turn，直到关卡变化或软限制才结束。现在每个有行动的 Python cell 都 `terminate` 当前 turn，runner 在同一 Pi session 中开启下一决策，把上一批行动和最新状态送入下一条消息。零行动 cell 保持在当前决策内；cell 内多步 `submit_actions` 与即时变量刷新保持可用。

受影响代码：`demo/arc_layered_extension.ts`、`src/autoresearch_pi/arc_layered_e2e.py`、`tools/arc_thin_smoke_provider.ts`（仅增加 layer 脚本诊断）。layer runner 增加可选 bridge Python/模块路径，以便使用现有 mock SDK 实际走 production bridge 和 Pi；默认真实运行配置不变。

验证：`tmp/layered-duck-smoke-20261126`（actual Pi 0.87.0 + production ARC bridge + mock ARC SDK + scripted provider）产生 3 次 provider request：第一次只读，第二次在同一决策中行动并终止，第三次在下一决策中看到 `current_frame.step=1`、`len(history)=2` 和上一 cell 的变量，再行动。2 个实际 bridge 动作，segment reasons 为 `action`、`budget`。`tests/arc_layered_extension.test.ts` 17/19；剩余 review freeze 与 compaction 两项为原分支旧断言，均与本次行动边界无关。功能正确和确定性全链路可达有证据；真实 provider 自主采用、净收益未验证。

## Duck 机制要点（官方源码，github.com/Tufalabs/duck-harness）

- 单一 `python` 工具；host 每次调用起全新 CPython 沙箱，注入 `current_frame`/`history`/`valid_actions` 等全局变量与 `action(actions)`；代码内 `action()` 经 stdio 回 host 执行真实动作并立即重绑状态，一次调用内完成 读→算→行动→再读 的闭环。
- Agent 驻留在决策循环：`tool_agent.py` 的 while 循环让模型连续多轮调 python 而不触发新 user prompt，直到代码内真的行动（`step_executed`）才结束本决策；`LOCAL_ANALYZER_TOOL_STEPS`（默认 12）是未行动时的兜底上限。

## 本分支现状（逐项对照）

| Duck 机制 | middle layer 现状 | 差距 |
| --- | --- | --- |
| 状态注入为 Python 变量，代码内直接读 | kernel 常驻会话注入 state/grid/history/env，跨调用持久（强于 Duck 一次性命名空间） | 无 |
| 普通代码内 `action()` 直接行动 | 2026-11-04 "Free hands" 起 `via='python'` 放行（demo/arc_thin_native_runtime.ts:825），evo guard 识别 `python.env_act` | 运行时无差距 |
| 行动才结束决策，未行动有步数上限 | `terminate: true` + `decision_tool_calls=16`（src/autoresearch_pi/arc_thin_e2e.py:2274） | 无 |
| 全链路证据 | activation smoke 只走 save= 行动；注释/脚本仍写 "unsaved code cannot act" | **本次补齐** |
| 行动归因 | reuse report 把 via='python' 算进 "actions from saved code" 与 tool 类别 | **本次补齐** |
| 观测交付 | 本分支默认 ch（Continual Harness 观测），另有 inline/query | F2 对照实验，未做 |
| 每轮重述 world model | 无对应强制项 | F3 候选提示因素，未做 |

## 本次改动（F1 的证据与归因差距）

- tools/arc_thin_smoke_provider.ts：activation 脚本在 decision 3 的 defs 之后加一个未保存片段 env.act 两步的调用（行动结束该决策；fork smoke 依赖 decision 3 的 session 名字，位置保持其后）；删除过时的 "unsaved code cannot act" 注释与 note。
- tools/run_foundation_smoke.py：via/played 断言改为 probe×4 + python×2 + miss；offload=7、by_component 含 python:2、tool 类别 actions=5；trajectory 序号随之更新。
- src/autoresearch_pi/arc_thin_reuse_report.py：via='python' 不计入 saved component 的 tool 类别 actions；render 文案改为 "actions from code"。

## smoke 真实跑通过程中暴露并修复的运行时缺陷

打通 smoke 时发现本分支三处真实缺陷（均非断言问题，capped smoke 自 482e84f0 起从未真正跑过）：

1. **deadline reserve 压死短预算运行**（src/autoresearch_pi/arc_thin_e2e.py）：482e84f0 为多小时真实跑引入 300s `HOOK_DECISION_START_RESERVE_SECONDS`，240/600s 的 smoke 首个 turn 即被拒。修复：`deadline_reserve` 随预算收缩（min(300, 预算/4)；无限期为 0）。
2. **save= 后同 cell 行动导致 SelfRoot 激活被拒**（demo/self_root.ts）：reflective save 在 cell 执行前 stage，cell 内 `env.act` 追加 action 收据后，边界激活因 base-state hash 不匹配回滚（ledger `activation_failed: pinned state changed after reflection`），保存的工具（probe）从未激活，下一决策 "Tool probe not found"。修复：激活快进——当前状态与反射基线的唯一差异是追加的 action 收据时，把收据并入 candidate 再激活（记 `activation_fast_forward` fact）；其他分歧仍拒绝。
3. **未保存片段 `python.env_act` 不在 pinned surface**（demo/self_root.ts）：saved tool 行动记为 `arc_action` 可过，`via='python'` 记为 `python.env_act` 被 `assertActionAllowed` 拒绝——Duck 式未保存代码行动在 SelfRoot 下从未可行。修复：带点号的子动作回退到根工具名授权（`python` 已授权即授权 `python.env_act`）。

另补一处证据链缺口：reflective 保存绕过 Binder，`.harness/components.jsonl` 与版本库无组件行，reuse report 的 tool created=0。修复：`reflectSource`（reflectedSelf 分支）同时经 `binder.publish` 记账，SelfRoot 仍是激活权威（demo/arc_thin_native_runtime.ts）。

SelfRoot 布局差异（视图承载历史，不重放 transcript）使部分 smoke 断言失效，按实际交付位置改写：ACTED/坐标忽略收据改查 Pi 会话事件（pi-events.jsonl）；show() 原文改查 workspace/results；PYTHON SESSION 头部列表以后续决策复用（→ 42）为证；MEMORY INDEX → 视图 `task_memory`；能力索引 → 视图 `active_components`；`decision_reasoning_mode=recent`/`archive_results=True` 为本分支 completions 策略。fork smoke 的延续性断言补充 SelfRoot 视图行动编号连续这一形态。tests/self_root.test.ts 的 late-action 测试更新为快进语义。

窄命题、代价与推翻条件同 activation 分支记录（请求数/动作与父 token 下降，无效动作率不升；save 门槛取消可能降低组件沉淀率，接受该取舍并保留 save 路径）。

## 验证（2026-11-26）

- `tests/arc_thin_activation.test.ts`：6/6 通过（os.remove 组件路径测试更新为 reflective 拒绝语义）。
- `tests/self_root.test.ts + self_root_arc.test.ts + live_orchestration_core.test.ts`：44 通过，1 失败（"P5 records… contract usage caps"，HEAD 即失败，`guard` 方法为分支既有未同步，与本次改动无关）。
- `tests/arc_thin_components.test.ts`（3）、`self_root_evo_mechanisms`（1）、`self_root_meta`（1）共 5 个失败均在 HEAD 复现，为分支既有失败。
- `python tools/run_foundation_smoke.py tmp/smoke-baseline-ml-20261126 activation`（mock provider + production bridge + actual Pi + WASI）：通过。via=probe×4+python×2+None、offload=7、`actions_by_component={probe:4, python:2, miss:1}`，保存的 probe 在下一决策作为工具被调用并行动。
- `python tools/run_fork_smoke.py tmp/smoke-fork-ml-20261126`：通过（source 6 行动、fork 延续编号、坏快照拒绝、挂起重启恢复）。
- 自主采用与净收益未验证；真实 provider 同预算对照（请求数/动作、父子总 token、无效动作率、关卡进展）需用户授权后另行排期。

## 顺序与证据边界

F1（本分支运行时已有，本次补证据/归因）→ 授权后真实对照 → F2（ch vs inline vs query 三方对照，开关均已存在）→ F3（行动前重述修订版 world model 的最小提示实验）；F4（单工具 duck-variant 消融）视需要。关联 docs/deferred-research-todos.md 的 B/C/D，保持开放。
