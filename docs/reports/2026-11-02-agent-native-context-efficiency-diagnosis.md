# Agent native loop：执行效率与上下文诊断补充

日期：2026-11-02。诊断对象：`runs/agent-native-program-loop-real3-20261102/`。补充既有方案，不替代历史记录。读取运行产物并回放实际上下文投影函数；未修改活动 run 的配置或代码。

## 已确认的结论

当前主要问题是：输出被频繁截断，而续接入口未被上下文投影识别，未完成推理被当作历史删除。系统保住了 phase 状态，却没有保住同一决策的认知连续性。重复观测和历史重建进一步增加了输入和重新解析成本。不能仅据此把低效归因于模型速度，也不能用本轮尚无程序创建断言新接口没有价值。

诊断快照（UTC 15:31 左右，运行未结束）：5 个 ARC 动作；22 个已完成 provider 请求，13 个 `length`、9 个 `toolUse`；input 266,444、output 67,548、reported total 333,992、cache_read 0。reasoning 29,597 是 provider 额外报告字段，不与 output 再相加。没有 `component_runs.jsonl`，尚无具名程序创作/使用证据。

22 个已完成请求的响应头等待中位数 2.1 秒，响应头之后到结算中位数 162.3 秒；两段时长合计分别约 64.1 秒、2,966.5 秒。主要时间发生在收到响应头之后的生成阶段，不能描述为一直等待 provider 连接。

## 1. 续接被错误地投影为新决策（确定缺陷，最高优先级）

Python runner 的 `recover_length` 发出 `ARC_THIN_PHASE_RESUME`；extension 的 before-agent-start 分支认识这个 transport，并保留 `run`。但 `nativeDecisionStart` 仅回溯 `RECOVER ACTION/...`，不认识 `ARC_THIN_PHASE_RESUME`。

因此 context hook 把最新 RESUME user 当作新决策起点，前一条未完成 assistant 被移到 earlier。当前 summary 模式先调用 `projectNativeHistory` 删除 thinking，再做文本摘要。纯 thinking 的 length 片段完全消失；存在磁盘 session 里不等于存在后续模型输入里。

用本轮真实 session 调用实际 `nativeDecisionStart` 与 `projectNativeHistory`：8 个已记录 RESUME 全都被判为新的起点；前一片段各有约 4,962–7,941 字符 thinking，投影后全部不保留。对应 `context_budget.jsonl` 的恢复请求均可见 `messages=1`、`reasoning_chars=0`。这是实际链路证据，不是仅凭代码猜测。

此外 runner 一次 `recover_length` 仍 length 后，外层下一轮继续发 NEXT；phase owner 保留 running phase，但 extension 的 `continuing` 不将 NEXT 判为同一未完成决策，再次刷新 run/工作集。phase 连续、runtime decision 连续、context 连续目前是三套不同判断。

修正目标：续接和新决策共享同一个明确边界身份；RESUME 保留本次尚未结算的推理、已完成工具结果和稳定 head。连续 length 后不能用普通 NEXT 隐式重新开始。只靠保留全部历史或加一句“不要重复推理”不能修复入口不一致。

## 2. 同一盘面重复投递（确定冗余）

实际使用 `observation_delivery=ch`。`chObservation` 把动作后的 observation grids 与 current state grid 拼接，并分别生成图片。单帧动作中，两者是同一个盘面。

working_set 的动作 1–5 中，`action_step_N_frame_0` 与 `current_state_frame` 图片 data 的 SHA-256 各自完全相同。每次动作后首轮工作集因此包含同一盘面的两张图、两份 64×64 文本网格；最近一次 state 部分为 10,124 字符。恢复时又变成一份，造成同状态 head 内容变化。

修正目标：完整保留必要动画帧、当前网格及 PNG；对相同规范帧只投递一次，用标签引用标明它同时是动作结果和当前状态。不能为了缩短文本删掉用户要求的观测模态。

## 3. 最小程序 profile 没有固定自己的上下文合同（确定配置偏差）

活动配置：`ch` observation、head layout、12,000 字符 history summary、`recent` reasoning、archive_results=true、auto compaction=true。隔离旧 Refiner/Daemon/Python session，并没有隔离这组旧 context 策略。

其中 `recent`、summary 和 archive 主要由 runner 对 Completions 路由设定，不应全部归因于 dotenv 继承。scripted smoke 默认 query，真实 provider 默认 ch；通过的 smoke 没覆盖这次真实运行的观测/恢复组合。配置差异正好绕过了本轮暴露的问题。

每次 summary 都将历史重新塞入当前 head；`recent` 又可能替换同一决策中旧 thinking。当前 measured cache_read=0，说明本轮没有报告缓存收益；不能仅靠该值断言缓存未命中全部由 head 改写造成，网关支持/计量也需核实。

修正目标：为这条纵向切片明确选择并记录一套上下文配置；smoke 使用同样的 ch/图像/phase transport/length 情境。相同状态的工具轮与恢复轮保持已发送前缀稳定。跨真实状态再更新当前观测。

## 4. 摘要保存操作，未保存当前认识与修订关系（确定缺口，影响大小待测）

`summarizeHistory` 保留 assistant text（单段最多约 300 字符）、工具参数短串（约 160 字符）、结果首行/最近结果。它不是语义任务状态摘要；纯 reasoning 的发现不会自动进入它。

动作 5 时的 memory 仍是动作 1 后的玩家位置（r45–49/c39–43，confidence=1），而后续 note 已在使用不同位置。当前事实、过时事实、推测、反证缺少明确的来源状态和替代关系。模型因而容易从最新大网格重新定位，同时被旧 memory 干扰。不能把“memory 已持久化”当作认识正确且最新。

还有多次 memory schema 调用失败，工具描述仍混有 promote/save_tool/run_skill 等旧路径。这些都增加接口解释与修复轮次。尚不能证明它们导致了未采用程序，但说明 Agent 看到的上下文合同仍不一致。

修正目标：当前观测为唯一事实底座；状态局部计算结果注明对应状态，不能被推成跨状态常识；Agent 明确写下的判断/计划保留来源与反证。无需新增强制复盘表或后台语义写入者。

## 5. 4,000 输出窗口的来源与放大效应（纠正先前解释）

real2 启动报错是 HTTP 402，metadata.limit_source=openrouter_credits：默认 65,536 max_tokens 超出当时可负担额度（返回 4,717）。这是账户/请求额度问题，不是模型上下文装不下。

随后把单请求输出降到 4,000，使 real3 得以运行；整场时间、决策、reported-token 上限仍关闭。小输出窗口与启用 thinking、完整盘面分析叠加，增加 length 概率；续接缺陷再让已生成的推理消失。不能直接用“取消整场预算”解决这组相乘的问题，也不能声称增大 max_tokens 已证明更省钱。

实际 base URL 为 OpenRouter，provider 标签为 yibu，不是旧运行所用的 AZ endpoint。因此本轮不能作为与旧 AZ/Qwen 运行的干净单因素比较。reasoning_effort=low 在 provider_policy 中已确认。

## 按顺序修正与验证

1. 首先统一未完成决策的边界识别，重放本轮真实 session 验证 RESUME 后保留进展，且不会重复执行动作。覆盖连续两次 length 后的 NEXT 行为。
2. 在同一观测合同下消除重复的规范帧；正例为当前单帧动作，负例为不同动画帧必须完整保留。
3. 固定最小 loop 的 context 策略并让 scripted provider 走相同观测、图片及 length 恢复路径；确认实际 provider 请求，而非只看落盘 session。
4. 再核查认识连续性与程序接口的一致性，随后用普通真实 provider 测自主创建、跨状态使用、同名修订。没有普通模型采用证据前，保持 A2 未验证。

以上修正先做低成本重放/实际 Pi 接线诊断，再运行真实模型；不需要先重构 Binder、Daemon 或扩大 Refiner。当前活动 run 保持原配置，诊断结论是中途快照，最终动作/用量以结算产物为准。

## 开发执行中的教训

此前把 length 片段称为连续进展、把 402 解释为上下文容量，均不准确。应在第一批 length 后检查实际后续输入，而非长时间只轮询动作计数；应核实真实 endpoint 和配置，而非用 provider 标签推断路线。频繁重复“仍在等待”的状态更新也没有推进诊断。本报告保留这两项纠正，不将缺陷归因给用户取消预算上限。
