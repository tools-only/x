# ARC 闭环运行日志（2026-09-16）

## 范围

本次工作继续验证 `auto-research → parse/router → PI native harness mutation → ARC action` 闭环，并按要求移除 ARC 官方运行时限以外的 runner 自定义限制。

## 代码变更

- 保留 ARC 官方 `Agent.MAX_RUNTIME_SECONDS`（12 小时）作为 Pi 单次 RPC 等待上限；不设置额外 session deadline。
- 移除 `ARC_CONTEXT_MAX_CHARS=40,000` 的 runner 强制投影上限；上下文由 Pi 原生 context window/compaction 和 provider 边界管理。
- 移除 `ARC_LONG_TURN_ROTATION_SECONDS=20`、一次 rotation 上限及无动作轮次策略。
- 移除连续 3 次 provider error 后提前退出；错误通过 Pi 事件和 continuation 暴露，终止只由 ARC 官方时间/action budget、Provider 边界或显式中断决定。
- length stop 的 checkpoint、`new_session`、同 session resume 保留为 Provider 边界恢复，不属于人为运行预算。

## 回归测试

执行：

```text
D:\conda\python.exe -m pytest -q tests/test_arc_agi_3_e2e.py tests/test_pi_kernel.py
```

结果：`59 passed`。

## 真实 ARC 尝试

目标命令：`ls20`、`treatment`、`context-compaction`、`auto-research-validation`，新 run root 为 `runs/arc-closure-live-20260916-01`。

阶段结果：

1. parent runner 启动并创建 run root；
2. bridge 子进程未能写出 `bridge-ready.json`，因此没有进入 parent/child/findings/route 阶段；
3. 独立 SDK/API 探针确认 ARC API 可达：使用项目 key 请求 `/api/games` 返回 25 个游戏，`ls20` 解析为 `ls20-9607627b`；
4. 直接 bridge 诊断成功完成 SDK 初始化、创建 scorecard、获取 `ls20` metadata 并 reset，但在写 `bridge-events.jsonl` 时收到：

   `PermissionError: [Errno 13] Permission denied`

   随后的 `bridge-error.json` 也因同一 run root 权限失败，故未形成完整本地 receipt。该诊断产生的远端 scorecard 未完成正常 close，需在 ARC 控制台按 scorecard ID 清理（若服务支持）。
5. 对真实 runner 的升级权限请求被审批服务以 HTTP 503 拒绝；未通过任何绕过方式继续执行。

因此本次没有声称 child 已启动、finding 已返回、route 已执行或 ARC 已完成。

## 当前阻塞与下一步

- 阻塞是受限执行环境对子进程写入 run root 的权限/审批，不是 Auto-Research parser/router 或 Provider 输出限制。
- 审批服务恢复后，用全新空目录重跑同一命令；阶段性检查 `bridge-ready.json`、`subagent-progress.jsonl`、`auto-research-reports.jsonl`、`auto-research-harness-routes.jsonl`、`auto-research-harness-route-receipts.jsonl`、各 task-local native resource JSONL，以及最终 `summary.json`。
- Gmail connector 当前不可用，未发送或伪造发送进度邮件；进度以本日志和 run artifacts 为准。

## 相关 deferred TODO

本次涉及 deferred TODO A（adapter/runner 边界）、B/C（Auto-Research 与在线 child 交互）和 D（context 压缩/恢复）。本次只处理 runner 自定义 timeout/rotation/cap；adapter 职责拆分、研究模式对照实验和语义 consolidation 仍未实施。

## 续跑与本轮修复

`runs/arc-closure-live-20260916-03` 曾真实完成 child 启动、结构化 report、3 条代码编译 route 及 native receipt，并执行 ARC action。后续 parent 在 level 0、12 actions 处反复恢复同一 research session；child 的 heartbeat 显示进程存活，最终多次以 provider 原生 `stop_reason=length` 结束，未提交新 report。该 run 已显式终止，未把 paused research 当作完成，也未伪造 ARC scorecard 结果。

本轮继续修复两处确定性问题：

- `assess_harness_effect` 现在同时接受 adapter execution observation 与真实 `harness-observations.jsonl` native exposure ID；错误引用仍拒绝，并返回当前 decision 的真实可用 observation IDs。
- `task-checkpoint.json` 的 staging 文件改为进程/写入唯一名称，避免 session recovery 重叠写入固定 `.tmp` 引发 Windows `EPERM rename`。
- research child prompt 在 provider length 恢复或证据已足够时要求直接提交一次结构化 report；不新增正文、数量或隐藏 token 限制。

验证：assessment/native exposure、provider length resume 与 checkpoint/context 测试通过；本轮汇总为 `33 passed, 1 deselected` 加 4 个定向回归测试通过，Python syntax compile 通过。

停止后已清理该 run 中一次手工诊断写入的 `TEST\\n` 前缀；`bridge-events.jsonl` 当前 25/25 行可解析。由于 run 在 paused recovery 阶段停止，未生成 `summary.json`，因此不报告该 run 的 benchmark pass/fail。

## `arc-treatment-live-20260916-01` 真实运行结果

第二次全链路运行成功通过了研究与 self-harness plumbing：child `auto-research-1` 正常启动并提交 `auto-research-report-v1`；代码 parser 生成 3 条 materialize 路由，三条均写出 `applied` receipt。实际资源结果为：5 个 memory 版本（含退休旧版本）、1 个 active skill、1 个 active task tool；后续 parent turn 成功调用 `task_tool_arc-current-frame-payload_v1`，证明新建 tool 进入了可执行 harness。

ARC 环境阶段接受了 ACTION1、ACTION2、ACTION3，各次预算分别推进到 1、2、3，状态仍为 `NOT_FINISHED`。ACTION4 的 bridge `environment.step` 请求最终返回 `fetch failed`；没有生成有效的第四个 action event，scorecard 关闭时为 `NOT_FINISHED`、0 个完成 level。`summary.json` 的 `timed_out=true` 是该失败后的 runner 退出状态，不是项目新增的 session deadline；本次不能报告 ARC 解题通过。

本轮也确认了一个独立故障边界：ACTION4 执行期间 bridge 持有动作锁，`/state` 只读探针同样超时，说明阻塞发生在 ARC 环境 fetch，而不是 provider、parser/router 或 task-local harness。相关原始证据保留在 `runs/arc-treatment-live-20260916-01/` 的 `bridge-events.jsonl`、`execution-observations.jsonl`、`runner-error.json` 与 `summary.json`。

## 无业务配额与环境异常诊断补强

为使“provider 边界可恢复、业务内容不被本地配额改写”真正落到代码：

- 路由 delivery/name、approval ID、task tool/skill/subagent 名称不再有项目自定义字符数上限；仍保留非空、lowercase/连字符格式作为原生资源标识语法。
- ARC validation window 不再把 Agent 请求的 action 数量裁剪到 128；action-sequence 工具不再裁剪到 16。真实动作仍由 ARC 官方 action budget 决定。
- task-local management/harness admission 不再维护 ARC 前置操作计数或隐式“先 action”窗口；parent 的研究与 self-harness 调用不受项目本地调用次数门控。
- provider telemetry 不再截断工具名称列表；canonical report、finding、delivery body 仍原样保存。context/page 的显式投影仍是可恢复的传输视图，不是内容删除。
- bridge 在调用 SDK `environment.step` 前写入 `environment_call_started`；异常写入 `environment_error`，包含异常类型、消息、cause、errno/status、traceback 和 `retryable=false`。Pi bridge client 与 runner HTTP 层保留这份结构化错误，并明确不自动重放不确定 action。
- ARC summary 新增 `environment_call_count`、`environment_error_count`、`last_environment_error`，方便在外层 deadline 前识别 fetch 阻塞边界。

验证：相关 Python/TypeScript syntax compile 通过；定向诊断/无配额测试通过；最后一轮 ARC 与 context/router 回归为 `77 passed`，此前包含 Auto-Research/self-harness 的合并回归为 `81 passed`；external benchmark native suite 为 `54 passed`。
