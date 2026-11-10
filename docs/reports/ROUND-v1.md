# ROUND-v1：真实 PPT 实验重试结果

日期：2026-11-11（Asia/Shanghai）。实现版本 `b3ba1ff8`；本轮仅提交结果，不修改实现、不 push。

## 结果与范围

**本轮未完成三臂实验。** 真实推理、真实 Edge renderer 和实际 Pi→checker→交付接线预检均通过。A 在真实 az / qwen3.8-27b 上生成 15 页 HTML 草稿后，第 4 个任务请求连续 300 秒无 Pi 事件，runner 终止会话。该请求 usage 未返回，按 v1 最大请求预算保留费用；B1/B2 随后均在启动前返回 `insufficient_preflight_budget`，没有任务 Agent、没有普通 B 样本。不能报告三臂通过率、净收益或“模型不愿自改”。

前次 codex-run-v1 简记：已成功请求 1 次、72 tokens；renderer 因 Edge Mojo/Crashpad `0x5`、Git 写入因旧 launcher sandbox 被拒。本次真实渲染和 Git 写入成功，原记录保留在 `runs/evo-v1-real-20261111/`，该请求继续计入总预算。

## 问题、命题与预登记协议

沿用 FINAL：在同一 Agent、同一根/串行续点的普通真实 PPT 工作中，用户底线应送达审阅，Agent 自选保持、计划修订、整体改法及试验/采用/恢复；希望减少开发者提醒、手动装配和重复工作。若底线未送达、结案不实或新版未真正使用，则相应行为命题不成立；合法保持也是结果，不强制修改。净收益另需匹配预算的独立对照，本轮不得越层。

真实材料为既有 Bank of America Q3 2021 SEC earnings release，源材料前十页形成十个内容单元；原 brief 要求 **15 页、自包含 HTML**，不是 native PPTX。源文件、brief、单元、checker、prompt/tool/runtime 种子 hashes 已写入各臂 manifest。A 为旧路径校准臂，B1/B2 为相同种子的独立 SelfRoot 臂；一期关闭心跳、默认继承和任务/评审 child。模型固定 `az / qwen3.8-27b`、`openai-completions`、thinking=low、temperature/top_p 使用 provider 默认，未替换模型。Pi 0.87.0；Node v25.5.0；Windows；Edge headless；任务启动带 `--no-context-files --no-skills`，不注入仓库 AGENTS.md。

总硬上限来自本次用户契约，manifest 的来源是 `user_contract`：**600 provider requests / 600,000 tokens / 14,400 秒 / USD 15 / runs 下 2,147,483,648 bytes**，三臂合计，任何上限不得提升。串行分配剩余额度；A 另限 60 requests / 1,800 秒。失败、pending、preflight 和全部 child 均计量，无支出下限。

本轮复用已有 runner/META/ledger/版本和验收机制，没有新增 worker、常驻提示、心跳或语义审批。Agent 反射的激活、真实后续经过和验证解释才算使用；记录、源文件或工程标签本身不算。恢复不能撤销费用或知识；预算不足不由开发者代替 Agent 采用/恢复。

## 预检、执行与协议偏离

- 本次首个真实小 completion：HTTP 200，返回 model=`qwen3.8-27b`，prompt 51 / completion 30（含 reasoning 25），合计 81 tokens，耗时 2.219 秒。
- 真实 renderer 预检：Edge 成功输出一页 PNG；真实 Pi/受保护 checker/交付接线测试 `1 passed in 3.97s`，使用 scripted provider，不能当真实模型采用证据。
- A 启动前冗余 `GET /models` 失败：`IncompleteRead(3897 bytes read)`。已保留原回执，开发侧 launcher 复用首个成功 completion 的精确返回 model 作可用证据；各 run 的其余真实推理预检和预算检查仍执行。未重试失败的 completion、未更换 endpoint/model、未修改实现。
- A 自带另一小 completion 预检：73 tokens，HTTP 200。随后 4 个任务请求实际发出，前三个返回 usage；第四个无结算回执。精确停止错误：`timed out waiting for Pi agent turn after 300.0s without an event`。
- A 结束未完成，未满足 FINAL §2.2/§10.4 的校准前提。按本次用户“继续完整 A/B1/B2”的指令，已在 B 启动前落盘探索性剩余预算协议；B 不作为确认样本，也不事后改预算以制造自改。两次 B 尝试均被原 runner 预算预检拒绝，0 次 B 任务请求。
- A 运行中没有 render/look/deliver；为取得真实验收事实，开发侧事后渲染保留草稿、调用同一个受保护 checker。此结果**未回流给已经结束的 A**，不冒充 Agent 自检、交付或 P0 在线闭环。

## 逐单元、逐臂结果

A 十个单元均仅有草稿和**事后**检查，无运行内单元交付。下表为受保护 `literal-render-v1` 原输出：“数字”只计冻结的三个字面探针；引用要求精确 `Source page N`。B 的 `not_run` 表示没有进入任务，不是内容验收失败。

| 单元 | 内容 | A：数字字面命中；引用 | B1 | B2 | A 未命中的数字字面量 |
| --- | --- | --- | --- | --- | --- |
| unit-01 | 财务与业务亮点 | 3/3；引用未命中 | 未启动：预算预留不足 | 未启动：预算预留不足 | 无 |
| unit-02 | 公司财务结果 | 1/3；引用未命中 | 未启动：预算预留不足 | 未启动：预算预留不足 | $21.5、$20.3 |
| unit-03 | 消费者银行 | 0/3；引用未命中 | 未启动：预算预留不足 | 未启动：预算预留不足 | $8,838、$8,186、$8,039 |
| unit-04 | 财富及投资管理 | 0/3；引用未命中 | 未启动：预算预留不足 | 未启动：预算预留不足 | $5,310、$5,065、$4,546 |
| unit-05 | 全球银行 | 0/3；引用未命中 | 未启动：预算预留不足 | 未启动：预算预留不足 | $5,244、$5,090、$4,517 |
| unit-06 | 全球市场 | 0/3；引用未命中 | 未启动：预算预留不足 | 未启动：预算预留不足 | $4,519、$4,720、$4,283 |
| unit-07 | 其他业务 | 3/3；引用未命中 | 未启动：预算预留不足 | 未启动：预算预留不足 | 无 |
| unit-08 | 信用质量 | 1/3；引用未命中 | 未启动：预算预留不足 | 未启动：预算预留不足 | $1,621、$1,389 |
| unit-09 | 资产负债表/流动性/资本 | 2/3；引用未命中 | 未启动：预算预留不足 | 未启动：预算预留不足 | $3,029.9 |
| unit-10 | KPI 定义与附注 | 3/3；引用未命中 | 未启动：预算预留不足 | 未启动：预算预留不足 | 无 |

合计 **13/30 数字字面命中、0/10 指定引用字面命中**；同时满足全部数字和精确引用的单元为 0/10。**这不是语义内容 0/10 合格的结论。** 原检查器只做全文字符串查找，不判断数字归属、正负号、货币表头或等价引用格式。例如 `8,838 / 8,186 / 8,039` 实际出现在消费者银行表格中，单位在表头；`(1,621)` 也存在。稿件逐页引用使用 `p.3, Consumer Banking Financial Results` 等形式，未遵循附加单元清单的精确 `Source page 3` 文本。报告保留 checker 的原判，不据此抹去这些可见来源，也不升级为全面事实核查。

真实 Edge 事后渲染：**15/15 页成功、源码 hash 与 receipt 相符、renderer warnings=[]**；源码 90,236 bytes，SHA-256 `97ed5c25c50d808f863d9e36696488ac32c43262d0f55e71f0ac325a5d56dd99`。已查看 contact sheet，各页非空、有财务表格/图表；HTML 的 warnings 空不证明没有越界或字号问题。整稿语义、财务数字归属/符号、叙事、字体可读性、审美和浏览器交互未全面验收。

## 实际成本、未知计费与停止边界

| 项目 | 实际观察 / 预算记账 |
| --- | --- |
| 已发请求 | **7**：前次 preflight 1、本次首 preflight 1、A preflight 1、A 任务 4；B 任务 0；child 0 |
| 有 usage 的请求 | 6；另 1 个请求未知，未当零或伪造实际值 |
| 已报告 tokens | **114,000**（含输出中的 reasoning，不重复相加） |
| 未知请求 tokens 预留 | 240,536；计入 cap 总数 **354,536 / 600,000** |
| 已知 usage 按模型注册 5/30 USD/M 计价 | **USD 1.96694**；这是注册价估算，不是实际账单 |
| 已知 usage 按 v1 保守 20/80 USD/M 计价 | **USD 5.66184** |
| 未知请求费用预留 | **USD 8.74288**；不是已确认消费 |
| 费用 cap 占用 / 余额 | **USD 14.40472 / 15**；余额 **USD 0.59528** |
| A 任务墙钟 | 1090.031 秒，约 18.17 分钟 |
| 本次重试至检查结束 + 前次小 completion | 1572.236 秒，约 26.20 分钟；包含等待、编排、预检、事后渲染和本次开发观察；前次 sandbox 调查总耗时未测量 |
| 两个 round 根的 runs 存储快照 | 46,979,080 bytes，低于 2 GiB；完整原始运行材料保留 |

**没有确认实际消费触及任何硬 cap。** A 的直接停止原因是 inactivity timeout；随后 USD **预留容量**阻止新启动。B1/B2 剩余 USD 0.59528，小于现有小 completion 的最坏预留 USD 3.50128，更小于任务请求预留 USD 8.74288。故不能在现有计费完整性规则下继续发请求。实际 provider 账单和第四个任务请求的真实 tokens/收费未知；不得把 USD 14.40472 写成“实际已消费”。未抬高 cap、未清零未知请求、未绕过预算 guard。

A 三个已结算任务请求分别为 4,076 / 28,223 / 81,475 tokens；第三个输出 48,236（含 reasoning 15,324），主工作仍由一个长生成承担。前三个任务请求 reasoning 合计 23,240 tokens，已包含在输出。逐请求 input/output/cache/成本见版本化 JSON，失败/pending 保留在原始 provider 日志。首 token 延迟、响应头、独立 provider 计算时长和实际费率/账单未测量，不以 Agent 等待时长代替；本轮没有 child 或并发模型调用。

## Agent 运行时自身修订与宪法复核

| 项目 | 观察 |
| --- | --- |
| 工程变化 | 实现仍为 `b3ba1ff8`；此次提交仅含结果/证据；运行用临时 launcher 的偏离已单列 |
| A 自身版本 | legacy snapshot 的 `selfRevision=2` 来自 runtime seed，不是 Agent 自改；没有 SelfRoot root_id |
| Agent 真实自改 | **0 次反射工具调用、0 次 Agent 自身激活**；A 的 HTML 写入不是自身修改 |
| A 实际调用 | read 4、ls 1、write 1；没有 office、reflect、trial、adopt 或 restore 调用 |
| 自主保持 | A reasoning 曾说任务线性、无需 redefine，计划生成→render→review→deliver；无正式 SelfRoot 审阅结案，不能算 B 的有效保持证据 |
| B1/B2 root_id / self_revision / part_versions | 均不存在；未创建任务 Agent，不能以 0 次修改解释模型意愿 |
| 五个用户底线 | B 没启动，窗口入口、交付前、主动 reset/切批前、正常结束前均**未在普通 B 任务验证** |
| 计划修订、整体重构、审阅方法重构 | 未取得真实 B 行为证据；A 有初始计划和草稿，无反馈后的闭环修订 |
| 串行 trial、采用/恢复、P1 重放、P3 新版实际经过、P4 预测比较、P5 继承 | 普通任务层均未验证，不能用既有 scripted fixture 替代 |

未观察到额外 reviewer/child、权限提升、篡改受保护来源/验收、把工程 commit 当 Agent revision 或宿主代替采用。A 是明确的旧比较臂，其异常终止也不是正常结束；不能据此判 B 违反审阅底线。另一方面，宪法要求的普通任务自身审阅/采用和真实闭环**没有得到验证，不能宣称符合所有宪法条款**。

## 与 FINAL 预期的五个主要偏差

1. **真实任务链在生成阶段中断。** A 第 4 个请求 300 秒无事件，未进入 runtime render/look/deliver；A 校准未全量完成，70%–90% 目标无有效完成样本可判。
2. **预算预留与可运行性不匹配。** v1 按完整 175,000 输入 + 65,536 输出及保守费率预留未知请求；一次缺 usage 即占 USD 8.74288，三臂总额 USD 15 下 B 无法启动，实际消费又不可确知。
3. **工作仍集中在长生成。** A 一次输出 48,236 tokens，尚未得到渲染反馈就耗费多数已知 tokens；没有观察到通过小步任务推进/计划修订控制风险。A 的自然语言“保持”不等于已完成反思闭环。
4. **验收器的字面表示过窄。** 表格统一货币单位和 `p.N + section` 引用使可见信息被记为未命中；另一方面全文子串命中也不能证明归属、符号或期间正确。P0 当前只能给这些窄事实，不能承担完整用户验收。
5. **P0–P5 的普通任务闭环没有到达。** B1/B2 实际为 0 个活动根，底线审阅、计划/方法改写、重构、trial、adopt/restore 均缺真实行为样本；不能从本轮推断能力或意愿，更不能宣称净收益。

## 分层证据、决定与下一可证伪检查

| 层级 | 状态 | Provider / environment 与证据边界 |
| --- | --- | --- |
| 功能正确 | 本次窄检查支持 | scripted Pi + 真实 Edge，1 个接线测试通过；真实 checker 事后检查 A 草稿；不替代全部已有功能/负例矩阵 |
| 全链路可达 | 部分支持，真实任务未闭合 | az 真实生成源稿；开发侧真实渲染/checker 通过事实采集；A 无在线交付，B 未启动 |
| 自主采用 | 未验证 | 普通 B 样本 0；A 的 informal keep 不冒充 SelfRoot 有效结案 |
| 净收益 | 未验证 | 没有两个 B 完成样本、没有匹配预算的效果对照 |

保持 v1 为实验状态，不宣布优化有效，不在本轮更改 runtime 掩盖失败。下一项可证伪检查是：先定位同一 provider 第四请求失去事件/usage 的转移、确认失败请求可结算，以及当前最大预留与每轮总上限的可运行性；只改变一个主要因素后，重新预登记，再检验 A 能否真实渲染并交付、B 能否送达并有效结束窗口入口审阅。后续付费运行需要新的授权余额/轮次，本轮不自动续跑。

关联 `docs/deferred-research-todos.md` D：P1/reset 的载体不是跨压缩认知连续性证据。本轮没有 reset/compaction，既有关键假设/反证保留待办维持未验证，不勾完成。

## 证据与 Git

- 原始材料：`runs/evo-v1-retry-20261111/`，各臂 manifest、预检、provider request/usage、Pi events、部分状态、原图/receipt 和停止 summary 均保留；先前阻塞材料保留于原根。
- 已版本化证据：[结构化结果](evo-v1-real/results.json)、[A 未交付草稿](evo-v1-real/A-partial.html)、[15 页真实渲染联系图](evo-v1-real/A-contact-sheet.png)。JSON 包含各臂 manifest、逐请求 usage、真实 checker 原事实、原始日志 SHA-256 和协议偏离，未含 API key。
- 本报告以 UTF-8 同步到 `C:/Users/qi/tmp/r04/evo-design/ROUND-v1.md`。
- 实现提交保留为 `v1-impl → b3ba1ff8`；本次结果提交后本地 `v1` 指向结果提交，具体 hash 可用 `git rev-parse v1` 核对；不 push。
