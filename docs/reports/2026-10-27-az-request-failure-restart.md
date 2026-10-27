# AZ 流失败后的预算停止与重启

日期：2026-10-27（Asia/Shanghai）。状态：本地停止修复已验证，真实重启观察中。

## 问题与命题

真实样本 `runs/meta-loop-az-qwen-g50t-6m-20261027`：前两个请求正常完成，第三个 HTTP 200 流以 `terminated` 结束且 usage 未知。共享预算正确 fail closed，但 runner 等待 30 秒后又派发三轮，最终误报 provider_error。0 环境动作、已知预算口径 13,019 tokens，第三请求预留 61,077。首次断流的网关/上游根因未知。

窄命题：runner 在下一轮派发前和轮次结算后消费已有准入拒绝/未知 usage 证据，即可停止重复提交并准确归因；不放松未知 usage 的预算保护。减少无意义派发与管理诊断负担。不改变模型策略、工具、提示、环境动作或共享账本协议。

## 设计与成本

复用现有持久预算与准入日志；runner 检查承担停止转移，不要求父 Agent 新决策，不新增 worker 或常驻提示。保留权限、版本与环境完整性检查。未知 usage 不变成零，已有预留也不伪称实际账单。失败样本不覆盖；新 run 独立启动，旧样本无动作，无环境前缀可重放。首次断流无法靠停止修复宣称解决。

## 运行前实验协议

先用失效日志结构的回归检查验证未知 usage、容量拒绝、预算不足、正常准入及不存在日志的负例；再以实际 Pi / bridge / mock SDK 的 smoke 检查接线。真实重启使用 AZ / qwen3.8-27b、thinking low、completions、native、g50t、text+image，单次输出 15,000，图片容量预留 8,192。普通游戏，无创作探针。用户授权修复重启，总预算 6M；无动作、决策数或实验/决策时间上限。保留故障与完整性检查。

旧 AZ 已知消耗 13,019 和失败请求预留 61,077，以及之前被 402 拒绝的请求预留 53,158，以显式来源写入新 run 的预算账本：已知量与未知保守预留分开，预留不释放。累计保守占用 127,254，不额外增加 6M。旧未知 usage 仍未知，未核实真实账单。新流若再次 usage 未知须停止，不自动忽略或无限重试。

判定：回归与 smoke 只证明功能/接线；真实动作和后续父轮才能证明新 run 在继续游戏。单次重启不能证明传输可靠性、组件自主采用或净收益。

## 实现与验证

`src/autoresearch_pi/arc_thin_e2e.py` 新增 `_provider_admission_stop`，在派发前及结算后、outage backoff 前读取持久停止证据。未知 usage / 损坏账本为 `provider_usage_unknown`，本地容量拒绝为 `provider_admission`，预留不足为 `token_cap`。明确 provider credits 错误仍保留 `provider_capacity` 优先归因。未改共享账本的 fail-closed 合同或传输重试策略。

验证：

- 新增 5 项回归先以缺少 helper 失败；实现后与 request accounting / recovery / lifecycle stats 合计 `30 passed`。命令：`PYTHONPATH=src D:/conda/python.exe -m pytest -q tests/test_arc_thin_admission_stop.py tests/test_arc_thin_request_accounting.py tests/test_arc_thin_recovery.py tests/test_arc_thin_lifecycle_stats.py`。修改文件 `git diff --check` 通过。
- `arc-thin-smoke --root runs/az-admission-stop-smoke-20261027`：passed，4 动作、后续父轮正常。生产 Pi / bridge，脚本 provider、mock ARC SDK，仅证明接线。
- 故障 smoke 第一次被 `output_envelope_unknown_or_invalid` 准入拒绝，1 次派发后正确停止；脚本 transport 提交 Context 而非 HTTP output envelope，未到未知 usage 注入点。保留 `runs/az-admission-unknown-smoke-20261027`，不算未知 usage 验证。
- 修订的纯脚本故障诊断仅对该 mock 运行关闭 HTTP payload admission（Context 没有 HTTP 输出字段），保留 shared usage budget。`runs/az-admission-unknown-smoke-20261027b/failure-check.json`：`provider_usage_unknown`、1 decision、1 prepared request、0 动作、0 outage wait，断言通过。真实运行继续启用全部准入检查。
- 真实重启 `runs/meta-loop-az-qwen-g50t-6m-restart-20261027`。启动器及协议位于 `runs/meta-loop-qwen-g50t-6m-20261027-launch/launch-az-restart.py`、`protocol-az-restart.json`。启动前把 13,019 已知用量和 114,235 旧未知保守预留记入新共享账本，总占用 127,254。每个旧预留均带来源，保持不释放。新增 6M 上限没有重置为额外 6M。真实进度待检查。
- 上述真实重启在 19.3 秒后因 `Request timed out.` 停止。实际结果是 1 decision、1 request、0 动作，summary 正确为 `provider_usage_unknown`，无重复派发；此结果验证停止路径，未解决外部连接。没有响应头，未知请求新增预留 53,168。
- 只读 `/models` 网络探测（同一 Pi dispatcher、同一模型网关）：AZ 直连 HTTP 200 / 7,768 ms，现有 HTTPS proxy HTTP 200 / 866 ms，均列出 qwen3.8-27b。探测结束显式 `process.exit` 的 Node 进程均有非零退出码，不能把它当干净的完整进程验收；HTTP 结果留在 `runs/meta-loop-qwen-g50t-6m-20261027-launch/network-probe.json`。直连的额外延迟与新失败约 10 秒吻合，但首次长流终止的上游根因仍未知。
- 单因素配置修订：移除启动器强制 AZ 绕过代理的 NO_PROXY 条目，保留 ARC 环境直连；使用现有代理。新样本 `runs/meta-loop-az-qwen-g50t-6m-restart-b-20261027`、`launch-az-restart-b.py`、`protocol-az-restart-b.json`。旧已知量 13,019 + 未知保守预留 167,403 = 180,422，累计上限仍 6M。新样本已经连续完成多个真实请求，Python 工具实际返回 64×64 网格计数与边界；尚待核对首动作及后续父轮。numpy 不在沙箱中，模型收到错误后自主使用标准库完成分析，未安装额外依赖。
- 01:30 左右的真实检查：新样本实际完成动作 #1 `ACTION2`，轨迹与 bridge 记账存在，0/7 关；随后 `working_set.jsonl` 记录 parent decision 2 / actions 1，`request-events.jsonl` 的 `parent:2` 收到 HTTP 200 且已开始流。refiner 请求也完成并回报 usage。累计共享账本已知量（含旧 13,019）80,031 tokens，另保留旧未知预留 167,403；最新进行中请求继续由 shared ledger 保守预留。后台 PID 64656，尚在运行。这证明重启后真实动作及后续父轮可达，不证明 AZ 长期传输可靠性、完整 self-harness 组件链或净收益。

| 层级 | 状态 | Provider / environment | 边界 |
| --- | --- | --- | --- |
| 功能正确 | 通过 | 本地回归 | 30 项；含正常、缺失、损坏、未知 usage、准入拒绝 |
| 全链路可达 | 局部通过 | Pi / mock SDK；真实 AZ / ARC | 正常脚本 4 动作；故障脚本 1 次请求即停止；真实重启动作 #1 与后续 parent:2 可达。不等于完整 self-harness 接线验收 |
| 自主采用 | 未验证 | AZ / qwen3.8-27b | 不从请求成功推断 |
| 净收益 | 未验证 | 无对照 | 不声称改进游戏质量 |

## 交付决定

修复已有预算保护的 runner 消费路径；不增加准入门禁。关联 `docs/deferred-research-todos.md` 中总成本与连续性待办：本次只处理失败请求归因，语义连续性保持开放。下一证伪检查是重启 run 完成环境动作及后续真实父轮；外部流再次中断时保留证据并准确停止。

## 后续真实运行诊断：容量断点与 self-harness（2026-10-27）

`runs/meta-loop-az-qwen-g50t-6m-restart-b-20261027` 已终止：7 动作，0/7 关，5 决策，`provider_admission`，本地证据为 `context_capacity_exceeded`。19 次 provider attempts 中 18 次完成、1 次在发送前取消；取消项 usage 未知但不代表已发送 HTTP。已知 provider reported 总量 410,200，shared budget 口径 303,064；另有前次失败保守预留 167,403，完整账单未知。7 次动作第 7 次 `changed_cells=0`。真实 Agent 创建并暴露了 `prompts/strategy.md` v1，但没有写 `# EXPECT` 候选，也没有 `meta_trials.jsonl` 或 `mount_checks.jsonl`；在 7 动作之内没有触发 40 动作 stall review，也没有 level review。因此当前样本的 self-harness 自动试用链在“自主候选/投入”前断开；不能从脚本 smoke 推断真实采用。只读 Python 中模型实际做了图像/动作分析，已证实普通计算工具被消费，但不算 M2 试用闭环。

容量根因定位：最后一次被拒请求声明 175,000 上下文，估算 text/schema 120,001 + 4 图像×8,192 + output 15,000 + margin 8,750 = 176,519。前一请求为 148,931。`context_budget.jsonl` 同期 reasoning 从 27,610 增至 52,925 字符；当前配置 `ARC_THIN_REASONING_MODE=all` 在同一决策反复发送历次原始 reasoning。Pi auto-compaction 已开但未触发，无法在本次拒绝前缩减这段未完成决策。保留全部旧推理直至超过准入边界，与用户先前“保留推理、减少负担”的方向在大输入时冲突；本轮改一个因素为已有 `recent` 模式，只留同一决策最新一条 reasoning，保留旧决策的事实/工具结果与真实会话落盘。此项会减少推理连续性，需要核查后续决策的实际认识是否丢失，不能因容量通过就称连续性改善。

下一真实探索样本保持 AZ / Qwen / low、g50t、图像、任务代码、输出 envelope、6M 总预算与环境边界；只把 `ARC_THIN_REASONING_MODE` 从 `all` 改为 `recent`。新 run 从游戏初态开始，不能把已看过的前缀算独立重复。旧已知 311,219、旧未知 hold 167,403 合计 478,622 进入新 shared budget，不释放旧 hold。目标观察容量能否允许更多正常轮次，并在普通任务中是否自主创建 EXPECT 候选、实际消费、反馈、留改撤；负例是仍被准入阻止、用最新推理失去关键反证、仅有组件曝光而无语义使用、合理无候选或 6M 用尽。无匹配重复对照，不作净收益结论。

`runs/meta-loop-az-qwen-g50t-6m-recent-20261027` 在 bridge 创建官方 scorecard 前的 ARC `/api/games` TLS/读取超时，runner 3 次启动尝试后终止：0 动作、0 决策、0 provider requests。只读网络探针 `arc-network-probe.json`：直连 `/api/games` 10 秒 ReadTimeout，代理无 key 返回 401；随后同一代理带官方 `X-API-Key` 返回 200（0.92 秒）。因此改用已有代理访问 ARC 官方服务，不更改 Agent/游戏机制，重新启动 `runs/meta-loop-az-qwen-g50t-6m-recent-b-20261027`（启动器 `launch-az-recent-b.py`，协议 `protocol-az-recent-b.json`）。前一次零请求不增加 6M 占用。代理探针只是连接可用性证据，真实 bridge/scorecard 仍须运行核对。

该 `recent-b` 样本进入了真实 Pi，但实际 `run-config.json` 显示 `decision_reasoning_mode=all`：runner 在构造 `pi_env` 时重设 `ARC_THIN_REASONING_MODE`，使启动器进程环境中的 recent 失效。此样本不检验 recent 命题。发现后立即终止进程树，保留 2 个已结算 parent requests（11,685 tokens）和第 3 个已见 HTTP 200、已开始流但无 usage 的 61,991 保守预留；0 已记录环境动作。没有把已见响应作为未发送取消来释放预算。

新样本 `runs/meta-loop-az-qwen-g50t-6m-recent-c-20261027` 用 runner 支持的 `extension_env={'ARC_THIN_REASONING_MODE':'recent'}` 显式传递配置。启动时共享账本携带已知 322,904 和未知 hold 229,394，合计 552,298；仍只有原 6M 总上限。`run-config.json` 已核实为 `decision_reasoning_mode=recent`，AZ parent 请求收到 HTTP 200 并开始流。运行结果待检查。

## recent-c 终态与下一次真实运行协议（2026-10-27）

`recent-c` 真实 AZ/Qwen + ARC 运行终止：4 个实际动作、0/7 关、5 次父决策，4 次动作都产生新变化；3 次结构化动作预测共 9/9 字段命中。`prompts/strategy.md` v1 被后续工作集引用，但由 refiner 写入，不算父自主创作；`meta_trials.jsonl` 不存在，未见父创建 `# EXPECT` 工具、版本装配、语义使用或反馈决策。self-harness 目标仍未满足，断点仍在父的机会识别/投入与候选之前。成功预测只说明局部行动模型，不证明组件收益。

终止直接原因是第 5 次决策的第 23 个父请求：HTTP 200，已流出 3,209 字符；本地 180 秒无 Pi 事件超时将它中止，Pi 返回 `stop_reason=aborted` 而 usage 未知。runner 完成一次空闲恢复后，shared budget 正确 fail closed，`stop_reason=provider_usage_unknown`。这一样本有 22 个完整父请求和 1 个完整 refiner 请求；当前账本累计旧样本的已知口径 766,173 tokens，另有旧未知 hold 229,394。中止请求预留 109,464，在 `unmeasured_usage` 结算时从活动预留表移除，但实际用量未知；下一运行把此数额单独保守带入，未知总 hold 为 338,858，起始保守占用 1,105,031/6,000,000。第二个未测 `error` 没有新的 HTTP 派发，不再额外预留。此占用不等于真实账单。

窄命题：用户已要求除 6M 外无时间上限；把 runner 的本地 `turn_idle_timeout_seconds` 从默认 180 改为 0，保留 provider/transport 故障、环境边界及共享预算检查，可让正常但长时间无事件的 AZ 流继续到自行结算，避免本地中止造成未知用量。只改运行配置，不改父可见 prompt、动作或程序。反例：上游自行断流、长期不结算、仍出现 unknown usage、容量拒绝或父仍不自主创建有复用价值的组件。后一类自驱缺口与本项传输修复分开判定。

下一普通真实样本 `recent-d` 保持 AZ/qwen3.8-27b low、g50t、native、`recent`、图像与 15k 输出、6M 原共享上限；不设动作/决策/实验/本地空闲时间上限。使用全新 ARC scorecard，旧环境动作不重放。预定义观察：请求最终是否完整结算、实际动作和关卡、父自主 `# EXPECT` 候选到装配/语义使用/反馈的各个转移；净收益缺匹配对照，仍未验证。若长流持续而无可判定终态，只记录活动证据，不把观察超时当终止。关联延后事项是推理卸载与跨阶段连续性，`recent` 模式仍需实际后续决策核验。

`recent-d` 已由 `launch-az-recent-d.py` 启动；运行 `run-config.json` 实测 `decision_reasoning_mode=recent`、`turn_idle_timeout_seconds=0`、`max_actions=0`、`max_decisions=null`、`max_reported_tokens=6000000`。共享账本前两项确认为 766,173 已知及 338,858 旧未知 hold。真实 parent:1 已收到 HTTP 200 与首个流事件；终态、动作和 self-harness 行为待查。启动脚本 `py_compile` 与本报告 `git diff --check` 通过。

运行中证据：`parent:3` 的首个流事件为 18:28:34Z，最终于 18:33:44Z 完整结算，`cost_status=reported`、36,823 tokens、`stop_reason=toolUse`；同一真实决策随后提交动作 #3。该请求跨越旧 180 秒本地空闲阈值后仍成功继续，支持本次取消本地中止的窄命题；不证明上游永不故障，也不证明 self-harness 自主采用。此时 3 动作、0/7 关，run 仍活跃。

第 4 次决策的 `arc_action ACTION2` 遇到独立的 ARC SDK `EnvironmentCallTimeout`（90 秒，结果未知）。runner 没有盲重试该动作；它停止旧 bridge，基于已记录的 3 次动作启动新 scorecard 并重放，检查 `total_used=3`，随后继续第 5 次决策。`bridge-events.jsonl` 的 `environment_restarted` 记录 restart=1、cause=outcome_unknown、after_action=3、attempts=1、scorecard_id=38b123f0-d564-4036-b509-40ed73cd9b25。因而当前 canonical 轨迹仍只有 3 次动作；旧 scorecard 上该超时请求的实际结果未知，不能作为已完成动作或关卡。此项是环境服务超时，与 AZ 模型长流的本地空闲中止不同；保持 90 秒环境完整性边界，待运行终态再分析是否重复。

## recent-d 终态与下一次容量实验（2026-10-27）

真实 AZ/Qwen + ARC `recent-d` 最终 16 次已确认动作、0/7 关、15 决策，`stop_reason=provider_admission`。最后请求在本地被 `context_capacity_exceeded` 拒绝：text/schema 116,811 + 5 图像×8,192 + 输出 15,000 + margin 8,750 = 181,521，超过声明 175,000。此前一请求的相同口径是 161,260；其后同一决策保留的 reasoning 增至 18,524 字符。拒绝项有 `provider_request_admitted=false`、无 HTTP headers、无 request reservation；其 `aborted/unknown` 仅是 Pi 会话口径，不能记作已发出且账单未知。运行中其他 28 父请求与 5 refiner 请求有完整 usage。共享账本累计（含旧样本）已知 1,467,984、旧未知 hold 338,858，下一运行初始保守占用 1,806,842/6M。旧 hold 不释放，当前本地拒绝不追加新 hold。

self-harness 漏斗：16 个真实动作与多次 Python 分析、策略文件 `prompts/strategy.md` v1–v4 的暴露及实际后轮工作集可见；策略文件由 refiner 服务维护，不是父自主创作。未见 `# EXPECT` 候选、`meta_trials.jsonl`、挂载语义使用、试用反馈或父的留改撤决定。1 次 refine point 未被父调用；40 动作 stall review 和 level review 未触发。故普通轮的父自主识别/投入仍未观察到；目前也不能把没有可摊销重复的 16 动作判为必然漏用。任务无关卡进展，净收益无对照，未验证。

下一单因素实验把现成 `ARC_THIN_REASONING_MODE` 从 `recent` 改为 `none`。命题：在保留工具调用/结果、旧决策 transcript、当前观测与 Agent workspace 的条件下，去除同一决策原始推理可让其请求通过保守容量准入，延长普通真实运行至更多动作或既有复盘机会；负例是关键反证/计划在后续决策丢失、仍被历史/图像推高而拒绝、provider 自身故障或父不采用 self-harness。此配置不新增 prompt、门禁、worker 或父管理轮；代价是可能增加重复推导，必须由真实后续行为与父子成本检查，不能单凭容量通过宣称效率收益。

下一 run 保持 AZ/qwen3.8-27b low、g50t、native、text+image、15k 输出、0 本地空闲超时、无动作/决策/实验时间上限及同一 6M 共享账本。保存第 10/20/30/40 次决策后的普通状态快照用于故障恢复，不作为成功证据，不改变 Agent 可见任务或行动。若无法跨过 16 动作，或能跨过但出现认识遗失，分别记录失败转移；完整 self-harness 自主 trial 与关卡数仍按真实桥接轨迹判定。功能层检查 `node --experimental-transform-types --test --test-concurrency=1 tests/arc_thin_efficiency.test.ts` 为 6/6，通过 `none` 去推理且保留工具结果的投影测试；真实 provider 连续性和收益待测。

`runs/meta-loop-az-qwen-g50t-6m-reasoning-none-20261027` 已由 `launch-az-reasoning-none.py` 启动，实际 `run-config.json` 确认为 `decision_reasoning_mode=none`、`turn_idle_timeout_seconds=0`、`max_actions=0`、`max_decisions=null`、共享上限 6M、快照决策点 10/20/30/40。启动账本确认为 1,467,984 已知 + 338,858 旧未知 hold。真实 parent:1 已收到 AZ HTTP 200 与首个流事件；后续行为与终态待查。启动脚本 `py_compile`、本报告 `git diff --check` 通过。

## 运行中机会：决策内地图重算与短周期复盘（2026-10-27）

真实 `reasoning-none` 样本在动作 #9、父决策 #6–#7 的 `python_calls.jsonl` 中，调用 #23–#29 多次从同一 `history.grid(0)` 构造格子分类和路径，并反复改判颜色语义。`working_set.jsonl` 的决策 #7 只列出 Python session 中的函数名，未把相互冲突的地图解释或重算机会整理为有来源的工作状态。`refiner.jsonl` 在动作 #8–#9 触发的是“假设缺少检查”，写了策略/记忆；截至此观察点没有父自主 `tools/*.py` 候选或 `meta_trials.jsonl`。本段是运行中样本，不能预判终态或把 `reasoning-none` 判为唯一原因。

现有复盘在 runner 的**父决策之后**检查 40 动作 stall、逐决策动作新颖性 spin、level change 和可选预测 miss；它看不到同一次父决策内的 3–5 次 Python 重算。`arc_thin_reuse.ts` 的 repeated work 主要按代码行/形状归族；本例的格子计数、语义重分类和寻路虽服务同一地图状态，却不属于同形代码。断点候选为“机会识别与窗口内证据连续”，不是组件挂载能力缺失。

下一单因素候选：复用 Python 回执这一已存在的模型决策边界，在同一决策内将有来源的重复/冲突事实作为**非阻塞、一次性短提示**回投；仅在真实重复证据出现时提示 Agent 判断是复用已有 session/组件、保存一个可试用状态组件，还是因语义仍不稳而暂不沉淀。外层 40 动作仅作为兜底，不把它改成更小的固定强制周期。若 Agent 创建候选，继续复用现有 `# EXPECT`、版本挂载与后续真实动作反馈；runtime 不推断地图语义，也不替 Agent 创建 map。实现前先用本次 #23–#29 与非重复计算作为正/负例，预定触发次数、去重/cooldown 和 token 成本；在下一真实 provider/ARC 样本里检查是否更早识别、是否减少后续重算、是否真正使用候选及父子总成本。若只是多一条提示而未改变行为，修订或撤下。当前只记录方案，尚未实现或验证。

### `reasoning-none` 终态与微复盘边界

真实 run 已以 `provider_admission` 停止：官方 bridge 关闭并核对 14 次动作、0/7 关，10 次决策，运行样本 reported 1,460,356（含 cache read），预算口径 856,324；最后一次请求在本地因 `context_capacity_exceeded` 拒绝（text/schema 126,184 + 4 图像×8,192 + output 15,000 + margin 8,750 = 182,702 > 175,000），未发给 AZ、无新增未知账单。请求链 45 个父请求及 7 个 refiner 请求完整结算，最后拒绝项是本地 aborted；旧未知 hold 继续保留。没有 meta trial、stall/spin/level review、父自主 Tool/Prompt 创作或关卡进展。`reasoning-none` 让推理字段为 0，仍未克服旧决策 transcript、当前多图像与工具结果累积；它也没有证明重复推导由该选项单独造成。

用户提出更简单的两层复盘：正常窗口内，Agent 根据当前轨迹即时短回看并保持结论连续；40 动作仅负责更全局、跨窗口复盘。现有 `recentText` 和工作集已经提供当前动作记录，新增完整轨迹或新 worker 都无必要。最窄下一试验应把**局部回看提示**接入既有父决策/工具回执，内容仅有最近事实、未解决矛盾与下一步选择，不要求写长报告或自动建组件；可在同一观测下多次工具调用且无环境进展时提前发一次。外层 40 动作机制保留。另需缩短 `continuity_decisions=8` 的旧 transcript 占用，同时以可核查的短窗口结论承接，防止只省容量却丢失认知。两项会分别实验，不把上下文容量效果归因给复盘提示。

### 短回看的窄实现协议（用户补充：无严重问题不必每轮深析）

主因素：在**同一环境动作编号**下，父 Agent 第三次完成 Python 调用的回执末尾给一次约两句的短回看提醒。内容只要求比较本窗口已得到的结果并决定下一项最小检验；若下一步已清楚、无矛盾/阻塞/工具故障，则直接行动，无需长篇推理。若确有持续重算，再自行选择复用 session、保存有复用价值的组件或暂缓；runtime 不写 map、不判定语义。下一动作自然形成新窗口，同一窗口不重复提醒。40 动作全局复盘和现有 `# EXPECT` 试用保持原样。

预期负担：真实样本 #23–#29 的父 Agent 不需等到动作 #40 才看到复盘机会，也不需要新增模型轮、worker、文件或强制字段；多数 1–2 次 Python 调用的正常窗口没有新增回执 token。反例：三个各不相同且必要的计算只收到轻提醒、不被强制停下；read-only/子 Agent 调用不计父窗口；同一动作窗口提醒仅一次，动作变化后可再触发。失败判据是提醒导致更多长篇分析、延误动作或仍没有减少重算/组件试用。测试先覆盖触发、去重、重置和只读负例；真实 AZ/Qwen/ARC 普通运行检查提示后行为、动作/关卡、meta 漏斗及总成本，未做独立对照前不宣称净收益。另一个容量因素是缩短旧决策 transcript；单独记录其配置与容量结果，不把它当短回看的收益。

实现：`demo/arc_thin_native_runtime.ts` 在父 Python 完成后，以关卡和已确认动作数划分窗口；第 3 次非行动调用在正常结果末尾附一次 `WINDOW CHECK`，鼓励简短比较、已清楚就行动、有真实问题再深挖。`component_runs.jsonl` 记一次性事件，恢复时读回，避免重启后同一窗口重复提示。只读调用不计数；环境动作完成后窗口自然更新。没有新独立模型轮、worker、文件或强制回复字段，40 动作全局复盘未改。`tests/arc_thin_native_runtime.test.ts` 覆盖触发、去重、只读不计、动作后重置；定向 6/6 通过。现有上下文投影相关 6/6 通过；启动器 `py_compile` 和 `git diff --check` 通过。这些只是功能证据，不证明真实采用或收益。

容量使能配置另把原有 `continuity_decisions` 从 8 改为 2，继续用 `session` 模式、canonical 当前观测和已有工作集；它会减少旧 transcript 占用，但跨决策反证保留尚待真实检验。两因素同时存在于下一探索样本，任何行为或容量改进都不能单独归因；若需净收益结论仍需拆分对照。新样本 `runs/meta-loop-az-qwen-g50t-6m-window-check-20261027` 的启动器及协议位于 `runs/meta-loop-qwen-g50t-6m-20261027-launch/launch-az-window-check.py` 和 `protocol-az-window-check.json`。共享账本从上一 run 结算的已知 2,277,927 和旧未知 hold 338,858 开始，初始保守占用 2,616,785/6M，不重置上限。实际 run-config 确认 `continuity=session`、`continuity_decisions=2`、`decision_reasoning_mode=none`、6M cap、无限动作数；真实 parent:1 已收到 AZ HTTP 200 首流事件。运行结果待观察。

### 短回看真实触达与第二轮失败

`window-check` 真实 AZ/Qwen + 官方 ARC 运行中，`component_runs.jsonl` 在父决策 #1、动作 #0、第三次 Python 调用记 `window_check`；真实 `session.jsonl` 的 Python 回执包含完整短提醒，后续父确实执行 `ACTION4`，bridge 核对 1 动作、0/7 关。故“Python 回执内可达”有真实链路证据，但父下一轮仍大量重数格子/解释移动；不能从一次动作推断提醒改善效率，更没有 Agent 自主候选或 meta trial。

parent:2 首请求 HTTP 200、先收到 thinking_delta；总流 666 秒后以 `terminated` 错误结束，最后一个 model delta 距结算约 598 秒。8,819 个流字符、1,108 个事件没有 usage 结算。runner 正确停 `provider_usage_unknown`，没有再次派发；该请求的 75,094 tokens 保守预留继续算入原 6M，上游断流根因未证实。此运行 4 个完成父请求 + 1 个失败父请求，run 内已知预算 27,316 tokens；共享账本累计已知 2,305,243 + 包含本次未知的 hold 413,952 = 保守占用 2,719,195，剩余 3,280,805。短回看不能防止上游长流中断，也不足以让下一决策抑制长篇重推导。

下一窄修订遵从用户补充：正常决策的入口再给一条简短窗口回看指令，要求看最近轨迹、无实际阻塞/矛盾/工具故障就直接选下一检验，不要求输出报告或每轮深度分析；Python 回执的有条件提醒、40 动作跨窗口复盘、权限和 `# EXPECT` 均不变。只对 native treatment 生效，避免改变对照面。`arc-thin-smoke` 经生产 Pi/bridge + 脚本 provider/mock SDK 回归为 `passed=true`、4 动作、无 harness 错误；这不证明真实 Agent 服从该提示。下一真实样本保留 AZ/Qwen low、g50t、2 决策 transcript、`none`、无动作/决策/时间上限及共享 6M cap，观察同一动作窗口的计算次数、长推理、是否自主创建/使用组件及 ARC 关卡；若 provider 再断流，仍按未知 usage 保守停止，不能把传输故障归因于该提示。

`src/autoresearch_pi/arc_thin_e2e.py` 已把这条简短指令接在 native treatment 的正常 `DECIDE` 入口；无行动恢复、控制变体、冻结旧路径未改。`runs/meta-loop-az-qwen-g50t-6m-window-review-20261027` 已由 `launch-az-window-review.py` 启动，协议位于 `protocol-az-window-review.json`。run-config 核对 AZ/Qwen low、session 2 decisions、reasoning none、共享 6M；新账本首两条为已知 2,305,243 与未知保守 hold 413,952。真实 Pi `session.jsonl` 的 parent:1 user 消息含该短指令，AZ 第一个请求完整结算、reported 9,289 tokens。进程仍在运行，ARC 动作和自发采用待查。此为提示触达，不是自主采用或质量收益证据。

## 28-action context stop and strategy disagreement (2026-10-27)

Real AZ/qwen3.8-27b, native ARC g50t `window-review` stopped at 28 confirmed actions, 0/7 levels, no `meta_trials.jsonl`. The final parent request was never sent: final-payload admission reserved 121,322 serialized text/schema bytes + 4×8,192 image tokens + 15,000 output + 8,750 margin = 177,840, exceeding the declared 175,000 context by 2,840. The old decision transcript had 108 history messages at decision 22. `continuity_decisions=2` did not constrain native `freezeHistory`, so the earlier capacity claim was refuted. Separate from the single-request context limit, the shared 6M ledger has 3,303,258 known budget-counted tokens and the carried 413,952 unknown hold: conservative occupancy 3,717,210, remaining 2,282,790. `summary.budget_tokens=1,050,649` is this run's budget-counted consumption, not the shared remaining budget; an earlier user-facing status mislabeled it.

Narrow context claim: for native runs with final-provider admission, summarizing completed-decision history to 12,000 characters by default keeps the current canonical observation, working set and active prompts while preventing accumulated old transcript from causing the observed refusal. Explicit `ARC_THIN_NATIVE_HISTORY_CHARS` remains an override. This removes old resident transcript bytes, at the cost of lost verbatim continuity; references and durable memory remain available. Negative cases: one enormous current decision, many images, or provider-side capacity disagreement may still be refused safely. No claim of guaranteed uninterrupted execution or semantic continuity is made until a real continuation shows it. The configured value is recorded in `run-config.json`; final admission remains the integrity guard.

The parent called `refine` at action 15 asking to move up/right and test red-path movement. Refiner received that focus, but its `strategy.md` v2 replaced the experiment with repeated DOWN through red, calling this the only route. The parent saw v2 at the next decision but actions 19–23 tested ACTION5 and top-corridor RIGHT/LEFT, then actions 24–28 moved DOWN on a different corridor. Thus loaded strategy did not establish semantic adoption. Broken transition: agent request → refiner interpretation/merge. A small refiner instruction now requires an explicit agent-requested test to remain visible in Next experiment; a disagreeing refiner must retain it as an alternative, state the rival test and discriminating observation, and explain the disagreement in WHY. Agent still selects actions; no new gate, worker, mandatory field or model call. This is prompt-level behavior only; actual merge quality and action uptake remain unverified.

Checks: `arc_thin_native_context.test.ts` and `pi_arc_parent_admission_budget.test.ts` 11/11 pass; Python source compiles; refiner-ledger suite in progress at report time. Full real-runner ARC closure matrix, real-provider adoption, cross-summary continuity and matched net benefit are not established by these checks. Next falsifiable check is a bounded AZ/Qwen native run under the same remaining shared 6M ledger, confirming `native_history.summary_chars=12000`, actual admission headroom, refiner prompt exposure, and subsequent parent actions. No prior environment actions are treated as reversible or replayed evidence of a new scorecard.

Follow-up verification: refiner-ledger suite 20/20 passed; `python -m py_compile` and `git diff --check` passed. New real-provider run `runs/meta-loop-az-qwen-g50t-6m-context-bounded-20261027` started with AZ/qwen3.8-27b, same g50t and shared 6M ledger; `run-config.json` confirms `native_history.summary_chars=12000`, reasoning none, unlimited actions/decisions, and 6M cap. This is an exploratory continuation from a new scorecard, not evidence yet of context success, strategy reconciliation, game progress or self-harness adoption. The launcher and protocol are `runs/meta-loop-qwen-g50t-6m-20261027-launch/launch-az-context-bounded.py` and `protocol-az-context-bounded.json`.

## SDK None recovery: diagnosis, narrow fix and restart protocol (2026-10-27)

Conclusion before restart: production native runner smoke now recovers a once-only SDK None step at the confirmed prefix, then completes a later Pi action without a fatal error. This establishes narrow function and wiring only. Real AZ/Qwen recovery, autonomous adoption and net benefit remain unverified. No unrelated run or process was touched.

Failure evidence: `runs/meta-loop-az-qwen-g50t-6m-context-bounded-20261027` ended harness_fatal at 20 confirmed actions, 0/7 levels, decision 12. ACTION1 returned no frame; the bridge already marked its outcome uncertain. A subsequent model continuation attempted /state on that uncertain bridge and logged before_agent_start:/state fatal. The runner checked fatal before reaching its next-loop environment restart. The SDK's swallowed underlying request failure cannot be identified from None alone; the old action's acceptance remains unknown. Its scorecard close also failed (502), retained in the source summary. This was a recovery-ordering bug, not proof of game or model failure.

Narrow claim and burden removed: use the existing verified-prefix environment restart before generic fatal handling when new environment errors and uncertain health agree. Skip length continuation after an environment error. Do not suppress an unrelated fatal or a healthy/unknown bridge failure. The runtime advances this mechanical recovery; the Agent receives the new current observation and one accurate restart notice, and chooses the next action. Replay checks every recorded grid and counts; unknown actions are excluded, and ReplayMismatch still stops. The notice no longer claims the failed action was never applied on the old scorecard. No new worker, gate or semantic game inference was added. This connects to deferred checklist A (environment/runtime boundary); it does not close broader adapter design or continuity quality work.

Changes: `src/autoresearch_pi/arc_thin_e2e.py`, narrow classification regression `tests/test_arc_thin_environment_recovery.py`, mock once-only failure marker, and `tools/run_environment_none_smoke.py`. Fee-free validation: focused pytest 2 passed/84 deselected; production native runner/bridge/Pi with mock SDK and scripted provider passed in `runs/environment-none-recovery-smoke-r2-20261027`: one confirmed action, one None, one checked-prefix restart, then action #2 with total_used=2 and no fatal. First smoke reached the later action but its last assertion incorrectly expected replay startup events in the canonical event stream; corrected to assert replay file and confirmed total, original artifact retained. An initial broad frozen-path test file had 72 passing/14 failures in unrelated historical prompt/extension assertions; no changes were made there and no whole-suite pass is claimed. git diff --check passed.

Authorized real restart protocol: AZ/qwen3.8-27b, thinking low, g50t, native, history summary 12000, reasoning recent (explicit latest user request; source run used none), output envelope 15000, declared context 175000, unlimited actions/decisions/experiment/local idle time, existing environment restart integrity checks retained. Shared 6M uncached-input+output ledger is carried from the ended source: known 4,804,115 + old unknown hold 413,952 = 5,218,067 conservative occupancy, remaining 781,933. No unknown hold is released and no extra budget is granted. New scorecard starts independently; old action progress is not counted as new progress. Inspect provider admission, request start, later actions and recovery evidence; insufficient budget or a further unknown provider usage remains fail closed. Launcher: `runs/meta-loop-qwen-g50t-6m-20261027-launch/launch-az-environment-recovery.py`; new root `runs/meta-loop-az-qwen-g50t-6m-environment-recovery-20261027`.

Self-harness diagnostic correction from prior session: the 28-action window-review parent did attempt memory(op=set,text=...) but omitted key; receipt said nothing applied. Refiner later wrote direction rules and a checked fixed-step hypothesis, which was contested. Thus empty parent memory does not establish no desire to persist; a concrete intent-to-save → valid-write failure occurred, and no subsequent repair was observed. These facts still do not create an Agent-owned formal meta trial. This remains separate from the environment fix.

Restart evidence: new launch PID 483216 (only this run started). `run-config.json` confirms AZ/qwen3.8-27b low, reasoning recent, native_history.summary_chars=12000, pi_context_window=175000, shared limit 6000000, max_actions=0, max_decisions=null and all requested timeouts=0. New ledger first rows are exactly known 4,804,115 and prior unknown reservation 413,952. `harness/request-events.jsonl` parent:1 attempt:1 received HTTP 200 at 2026-10-27T05:05:20Z, first stream event followed, and request settled completed/reported with 9,463 tokens at 05:05:34Z; attempt:2 was prepared afterwards. This verifies successful real-provider restart, not a new claim of task success or real failure recovery. The unrelated yibu run was not inspected, modified or terminated. The source live failure remains preserved; only the new run is active under this restart protocol.
