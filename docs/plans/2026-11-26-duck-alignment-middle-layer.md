# Duck 对齐（middle layer 分支）

日期：2026-11-26。状态：F1 差距补齐已实现并通过 deterministic smoke；真实 provider 对照需另行授权。遵循 docs/development-workflow.md。Duck 机制核实与因素框架沿用 activation 分支的 docs/plans/2026-11-26-duck-alignment.md（commit d1cabafd），此记录只写本分支的差异。

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
