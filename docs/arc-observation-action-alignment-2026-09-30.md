# ARC 观测与动作边界对齐（2026-09-30）

当前仓库：`D:/autoresearch_pi_project`。参照仓库：`D:/arc-agi-benchmark/Continual-Harness-ARC-AGI-3`。

## 已接入的输入与执行链

1. Python ARC bridge 仍是唯一环境执行者。`/action` 每次执行一个原生动作，并在进入 SDK 前记录 `environment_call_started`；成功后写入带完整公开帧和 delta 的 canonical `action` 事件。Pi 的 `arc_actions` 是上层组合工具，最多按序调用八次 `/action`，每一步另写 `execution-observations.jsonl`。关卡变化、终局、总预算边界或首次失败即停止；失败后的动作不自动重试。
2. `pi_arc_observation_window.ts` 从 bridge `/events` 生成近期动作窗口：每个动作有 RESULT，动画有帧数、峰值变化、范围与颜色摘要；最多十五个详细动作、四个关键帧网格，并始终附当前帧。网格用 `0` 至 `f` 对应十六种颜色。声明 image 输入的 provider 同时在临时 `context` 槽取得相应 PNG，text provider 取得网格。PNG 不写入永久对话。
3. 父 Pi 每个决策轮从 `/state` 和上次 cursor 后的 `/events` 装配公开输入；`arc_state(request='window')` 可显式读取最近窗口与当前网格。逐动作结果保存在 canonical bridge 事件和任务 ledger，后续父轮输入带动作窗口。Pi 自身的 checkpoint、选中的 memory、skills、tools、subagents、system prompt 仍由 `pi_external_benchmark_research.ts`、`pi_task_local_self_harness.ts`、`pi_task_harness_assembly.ts` 和 context lifecycle 的确定性 hook 装配；这里没有新建第二套 harness 真值源。
4. 普通 `delegate_task` 只有显式传 `action_authorization.max_actions` 才向 bridge 申请绑定当前公开状态指纹的短期动作租约，范围为 1 至 16 步。bridge 同时阻止主令牌越过有效子租约；子进程仅获得租约令牌与 live bridge URL，不获得主令牌。每一步计入相同的 bridge 预算和事件流，父侧在委托结束时写逐动作 ledger，回传动作回执，并以动作为父决策轮边界。Auto-Research 不走该分支，继续使用固定只读快照。

## 验收与边界

- `tests/pi_arc_observation_window.test.ts` 验证十六进制、临时关键帧、结果帧和 PNG 对齐。`tests/test_arc_action_lease.py` 验证显式令牌、额度、旧状态及不确定失败不重试。
- `arc-harness-smoke --case action-alignment --mock-environment` 经真实 bridge、Pi 父循环、普通子进程、动作租约、批量工具、显式 `arc_state(window)` 与后续父轮通过 9 项检查，记录在 `runs/arc-action-alignment-smoke-20260930-final2`。provider 与游戏环境为测试替身，证明接线与生命周期可达，不证明真实模型策略或游戏质量。
- 完整旧 `arc-harness-smoke` 矩阵在本轮复跑为 8/16 场景通过，记录在 `runs/arc-alignment-full-verified-20260930`。首次运行暴露确定性 provider 仍使用已失效的 `task_resource.limit=200000`，已改为当前允许的 65536；当前失败集中在 memory 的知识生命周期断言、skills 的 validation-window 状态断言和周期研究 handoff/续跑断言，需单独排查，不作为完整 Self-Harness 闭环的通过证据。
- 旧的两项只读子 agent 组件测试仍因 saved subagent 未被当前 Harness assembly 选中而失败；其失败发生在子进程启动前，与动作租约无关。当前普通委托的真实进程验收以显式授权的 action-alignment 场景为准。
- `arc_actions` 当前仅用于没有活跃结构化计划或 validation window 的动作序列。带计划步、预测及实验结算的推进仍使用逐步 `arc_action`；这一限制防止批量工具绕过既有逐动作校验。
