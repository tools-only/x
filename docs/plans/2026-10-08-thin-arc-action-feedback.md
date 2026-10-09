# Thin ARC 分区域动作反馈（P1）

日期：2026-10-08（Asia/Shanghai），真实复验终态及诊断更新：2026-10-09。状态：P1 实现、局部诊断与一次真实普通复验完成；自主事实利用有局部证据，规则理解未修复，净收益未验证。用户同意先实施 P1。

## 问题与命题

- 真实失败：`runs/pi-arc-thin-ls20-treatment`，真实 yibu/qwen3.8-27b 与官方 ARC，50 动作/0 关/1,131,486 reported tokens。#17、#21、#37 的左下图案变化被忽略，父用总变化数推断收集。诊断见该 run 的 `diagnostics/diagnosis.md`。
- 当前入口：`demo/arc_thin_extension.ts` 的 `arc_action` 只返回总变化数，下一决策只投影完整当前帧及短动作历史。桥接层已有完整 `observation_delta.cells`；父需额外选择并调用差分 skill 才能取得具体变化。
- 窄功能命题：将同一完整公共 delta 按四连通区域压成坐标、颜色转换计数及小区域的精确变化像素，动作回执与下一父决策能直接看到关键局部变化，区域计数完整且任何省略明确标注。
- 行为假设：降低差分获取的决策/调用负担，帮助模型识别跨区域关系；正确目标判断与关卡收益尚未支持。
- 范围：只改 thin 动作反馈，保持当前完整 grid、按模型能力提供的 PNG、六工具、模型、memory/prompt/analyst 行为。P2–P4 不实施。不预置 ls20 的物体、目标或通关规则。
- 推翻条件：错配历史/部分 delta 被当完整/关键变化未显示/不标注省略；行为实验中仍忽略变化或总成本增加且进展不改善。

## 设计与成本

- 复用 `arcChangedComponents` 的四连通几何与 bridge 已有像素列表，不增加 Agent、语义 gate、必填参数或工具调用。
- runtime 推进：真实动作 → 完整 delta → 确定性摘要 → 持久 trajectory → 回执/最新动作工作集。Agent 推进：解释、假设、实验、组件投资与反馈。摘要不判定物体身份、因果、角色或成功条件。
- 每区域报告 bbox `[left,top,right,bottom]`、变化数量、`[before,after,count]`；小区域附 `[x,y,before,after]`。输出限制 8 区域/1200 字符，并计入遗漏区域及像素；零变化与无完整比较区分。
- 最新摘要驻留一条，旧 8 动作列表不增加详细正文；通过已有 trajectory 回放恢复。摘要与当前桥接动作预算一致时才投影，避免旧证据伪装成当前变化。
- 控制/实验组采用同一反馈，因为 variant 的比较因素是作者能力，不是观察缺失。权限、预算、action token、原子动作边界与沙箱均保持。
- 预计新增每请求最多约 1.2k 字符，具体字符分布离线实测；token/模型利用未测。CPU 为对最多 4096 个公共像素做已有连通计算，无新增管理轮。若净收益不支持，撤下该摘要投影；环境历史不能回退。

## 运行前实验协议

- 当前目标：功能正确、thin 实际 Pi/bridge 后续输入可达诊断；不声明完整五类闭环。
- 单因素：旧总数回执 vs 分区域反馈；真实已存 50 动作公共帧逐步重放，特别 #12/#17/#21/#37/#44；组件负例包括零变化、未知 before、部分/重复像素、很多孤立区域及大变化。
- Provider/environment：功能使用本地 Node；真实 Pi RPC smoke 使用 scripted provider、mock SDK、production bridge。最多 3 实际 mock 动作，600 秒，零付费 provider 请求。任何失败停止并保存材料。
- 验收：关键变化坐标/颜色和计数匹配原始 delta；所有展示区域加遗漏像素等于原始总数；摘要<=1200 chars；完整当前帧不变；下一实际 provider 输入具有该摘要，旧摘要不膨胀到全部历史。
- 行为/收益后续：同输入公共帧的有界真实模型只读对照，再独立相近预算 ARC 对照；运行前另补模型、样本数、总 token/时间预算与停止规则。当前不启动此实验，不将重放视为动作收益。
- 遥测：保存离线每步摘要/字符增量、Node 结果、真实 Pi `smoke-requests.jsonl` 和 `summary.json`。不把字符当 token。

## 实现与验证（真实复验前）

- 实现：`demo/arc_thin_feedback.ts` 复用已有四连通计算，验证完整前后值及唯一坐标，提供颜色转换、bbox、小区域像素与有界省略信息；`demo/arc_thin_extension.ts` 将同一摘要写进真实动作回执和 trajectory，只投影最新一条并检查真实总动作预算匹配。没有改动工具 schema、gameplay prompt、memory/analyst 或模型配置。
- 功能：`node --experimental-transform-types --test tests/arc_thin_feedback.test.ts tests/pi_arc_frame_image.test.ts`，6/6 通过；包含真实轨迹抽取的 7 个关键动作、部分/重复/缺前值/非法像素、大连通区域/240 种颜色转换、很多孤立变化、两组 variant 的重启恢复与过时抑制、完整 grid/native PNG 保持。日志 [node-checks.txt](../../runs/arc-thin-feedback-p1-smoke-20261008/node-checks.txt)。最初纯 strip-only Node 不能加载已有 TaskPythonError 的参数属性，改用 Node transform-types 运行；这是测试入口差异，不是 runtime 修改。
- 全轨迹：已存真实 50 个动作的原始 delta 全部计数一致且未被改写，0 遗漏像素，摘要最小 246、中位 329、平均 341.16、最大 660 字符。#17 显式给出左下两个 4 像素区域；#21/#37 同样保留 8 像素，#44 保留公共指示器恢复/条形变化，#12/#26 只有底部 2 像素。机器产物 [public-replay.json](../../runs/arc-thin-feedback-p1-smoke-20261008/public-replay.json)。该字符分布不代表 token 或模型收益。
- Pi 接线：`python -m autoresearch_pi.cli arc-thin-smoke --root runs/arc-thin-feedback-p1-smoke-20261008`，退出 0，14/14 checks；真实 Pi RPC + production bridge + mock SDK + scripted provider，3 动作/1 consolidation/0 harness errors。实际后续 provider 请求包含 #1 两个移动像素及 `(0,0):0→1` 区域；新动作后详细 #1 摘要退出。保留完整当前网格、技能语义 count=63、错误恢复和一次动作边界。见 [summary.json](../../runs/arc-thin-feedback-p1-smoke-20261008/summary.json) 与同目录 `smoke-requests.jsonl`。
- 行为漏斗：本轮只让 runtime 推进公共事实供给，不改变语义判断者；新 provider 自主识别、投入、组件使用和后续动作均未测，合理不使用和弃用收益未测。旧轨迹供给遗漏的断点可重放，未建立修复后的认知连续性。
- 成本：局部 Node 测试和 Pi smoke 为离线诊断，无新付费请求；smoke 的 scripted reported=26 没有真实计费含义。新增请求字符有界但真实 input/reasoning、父+analyst 总成本和任务效果未测。没有新增管理 turns。

| 证据层级 | 状态 | Provider / environment | 产物及结论边界 |
| --- | --- | --- | --- |
| 功能正确 | 通过（限定范围） | 本地 Node/已存真实公共轨迹 | 6 检查及 50 动作重放；仅公共分区域摘要及寿命 |
| 全链路可达 | thin 局部路径通过；完整未验证 | scripted provider/mock SDK/真实 Pi 与 bridge | 14 checks，真实后续 provider 输入；未执行五类完整闭环 |
| 自主采用 | 未验证 | 未启动新真实 provider | 已存运行是旧版失败样本 |
| 净收益 | 未验证 | 无独立配对运行 | 差分供给不等于通关帮助 |

## 交付决定

保留 P1 为已实现的实验候选，不声称通关或净收益改善。下一可证伪检查是模型能否将准确的分区域事实转成可检验的关系及后续行动；先做相同公开帧/预算的真实模型只读对照，后做独立 live 对照，具体运行协议仍需在运行前补齐。关联 `docs/deferred-research-todos.md` 的 B/C/D（研究到行动、父子总成本、认知连续性）；不提升其完成状态。

## P1 真实普通运行协议（2026-10-08）

用户明确要求“再执行ARC真实运行”。本次直接执行一个独立普通 live 样本，跳过此前建议的只读 provider 对照；这是探索性复验，不是配对净收益验收。

- 环境：`thin-arc-self-harness` 当前 P1 源码，官方 ARC root `D:/arc-agi-benchmark/arc-agi-3-benchmarking`，真实 yibu / qwen3.8-27b，text 输入、provider-default thinking、max output 65536；与旧基线设置相同，不注入诊断解题提示。
- 配置与预算：`ls20` / `treatment` / 50 动作；沿用原命令，无新增 reported-token 上限；官方默认总时限 43200 秒、单决策等待 900 秒。WIN、动作耗尽、runner 原有时限/故障停止；不自动重试。
- 目录：`runs/pi-arc-thin-ls20-treatment-p1-real-20261008`。运行中不修改源码/config；启动前及终态核对源文件哈希，记录漂移限制。
- 主要变量为 P1 分区域事实反馈；比较器为旧真实 `runs/pi-arc-thin-ls20-treatment`，单样本、非同步配对，初态与随机性按实际公共帧核对。其他既存工作区修改以实际依赖及哈希披露，不把全部差异归因于 P1。
- 检查：变化摘要与公共 delta 一致、后轮可见；模型能否识别不同区域变化并形成可检验关系，memory 是否符合事实、技能/分析员语义输出是否进入后续行动；记录合理不使用、错误解释、放弃与重复取证。
- 指标：关数/状态/动作数、父与 analyst 的 input/cache/output/reasoning 和 reported 总量（reasoning 不重复相加）、墙钟耗时、管理轮/组件语义使用/错误。单次成本与进展同时报告；无关数改善或仍忽略关键变化不能称通关优化有效，token 减少也不单独认定净收益。
- 层级：局部真实 thin 可达与自主事实利用可由本次轨迹提供证据；完整五类闭环仍未验证，净因果收益仍需独立重复对照。B/C/D保持开放。

启动命令：

```powershell
$env:PYTHONPATH = 'D:\autoresearch_pi_project\src'
python -m autoresearch_pi.cli arc-thin-e2e --game ls20 --variant treatment --arc-root 'D:\arc-agi-benchmark\arc-agi-3-benchmarking' --max-actions 50 --root 'D:\autoresearch_pi_project\runs\pi-arc-thin-ls20-treatment-p1-real-20261008'
```

## 真实终态与 level 1 诊断（2026-10-09）

真实 yibu/qwen3.8-27b / 官方 ARC SDK ONLINE / 实际 Pi RPC 与 production bridge，50 动作、完成 1/7 关、NOT_FINISHED、budget_exhausted、退出 0。第 20 动作完成第一关；2 consolidation，0 no-action decisions。此前把第一关后的 consolidation 误述为未行动决策，核对 runner 计数后以本节为准。`passed=true` 是正常退出，不是 WIN。见 [summary.json](../../runs/pi-arc-thin-ls20-treatment-p1-real-20261008/summary.json)。没有运行中解题注入、源码/config 修改或自动重试。

- 来源：启动前 4 个 P1 入口/提示哈希与实施验证一致；217 个 demo/src 文件广域清单是在 #1 后采集，终态均无漂移，不能称隔离冻结或所有第三方依赖验证。同旧运行的初始公共网格一致，运行配置一致；旧基线无完整依赖冻结，不保证严格唯一差异。见该 run 的 `diagnostics/source-start.json`、`source-end.json` 与 [post-run-audit.json](../../runs/pi-arc-thin-ls20-treatment-p1-real-20261008/diagnostics/post-run-audit.json)。
- 成本：1,100,614 reported；父85个响应1,048,576（input681460/cache146176/output220940/reasoning202311），analyst4次52038（input26480/output25558/reasoning21474）。reasoning 已在 output 内，不重复相加；85 starts/85 completed assistant messages，用量行对应，无已观测未完成父请求。实际账单和独立 analyst/管理耗时未测。总墙钟4606.9秒（76分46.9秒）。旧样本1,131,486/4365.2秒：reported少2.73%，墙钟多5.54%，关数0→1；不能据单次将这些差异归因P1，token下降也不代表计费下降。
- 组件：59 memory日志行，最终12项；0 skill保存/运行，0 prompt覆盖；4次真实tool-less analyst侧调用。唯一pathcheck创作尝试在第二次整理时被hard16调用上限拒绝，4条memory调用被consolidation12上限拒绝；5次工具拒绝需计入，harness.errors=0只是无日志故障。父memory却声称路径经pathcheck验证，未成立。
- 功能实证：50个区域摘要计数、颜色转换和小区域像素全部与公共delta一致；相邻49对公共帧一致。0遗漏像素，摘要最小54/中位355/均值347.7/最大568字符，字符不是token。纯离线审计最初假定零变化delta总有cells键而报错，改为零变化空列表后完整核对通过；仅诊断脚本修改，不改变runtime。
- 自主利用：#6受阻只有底部2像素，父正确撤回颜色4可通行假设，并绕行；#13父准确注意左下8像素、提出过matching可能，但后错误解释为MOVE COUNTER。断点从事实获取转为解释与验证；P1行为假设只获部分支持。
- level 1：#37到目标入口但零变化，当前左下111/001/101与目标111/100/101不一致；第一关进入成功前两者一致。父没有比较这些条件，将框改判为sealed/decoy并转向11标记。分析员称前关框内无9、此前图案unchanged、相同图案数字4/7等均缺乏依据。#40错误RESET恢复总预算，#42前纠正；后期明确burning动作而未检验规则。图案匹配条件是候选解释，没有反事实动作，不声明已证明完整规则。
- 预算限制：第二关只剩30总动作；公开帧乐观5×5非4通行BFS给“起点→0/1标记→目标”17+20=37步。这不是引擎模拟或真实下界；若标记确为必要条件，当前预算可能仍不足。官方第二关参考123动作同样不是最短下界。详细公开证据、归一化图像、候选路径、限制及下一检验见 [level1-diagnosis.md](../../runs/pi-arc-thin-ls20-treatment-p1-real-20261008/diagnostics/level1-diagnosis.md)。未读取游戏规则源码、未新增诊断provider或环境请求。

| 证据层级 | 本次状态 | 边界 |
| --- | --- | --- |
| 功能正确 | 限定范围通过 | 既有测试及新真实50动作公共摘要审计 |
| 全链路可达 | P1 thin局部真实路径有证据；完整未验证 | 实际动作回执及后轮语义引用，未执行五类arc-harness-smoke完整矩阵 |
| 自主采用 | 有局部事实利用；关系推断与实验选择仍失败 | #6纠错、#13变化识别；不等于稳定正确规则或五类组件转化 |
| 净收益 | 不确定/未验证 | 单次0→1、reported−2.73%、墙钟+5.54%，无独立重复配对 |

决定：保留P1为实验候选，不扩展P2–P4或新增worker/语义门禁。真实失败位于识别后的假设、证据归因、验证及记忆修订；下一可证伪检查先准确归一化公共图案，后在另行有界独立诊断中检验改变图案是否使相同入口由拒绝变通关，并预留完整动作预算。诊断引导不冒充普通采用。B/C/D继续开放，组件存在/创建次数不作为奖励。

## 无人为动作上限的真实运行启动协议（2026-10-09）

用户明确要求“不设上限，启动ARC真实运行”。按当前上下文取消50总动作上限；使用已有 `--max-actions 0` 同时关闭bridge自行派生的总动作/每关动作上限（只省略参数会派生baseline×5，不能称无上限）。reported-token与决策次数均不设上限。保持环境原生能量/状态规则、provider单响应65536输出限制、runner默认官方43200秒及单决策900秒故障等待、既有工具调用保护；不将这些真实性/稳定性规则误称已移除。

- 任务：新独立ls20 / treatment普通运行，真实yibu/qwen3.8-27b、text/provider-default，官方ARC SDK ONLINE。目录 `runs/pi-arc-thin-ls20-treatment-p1-uncapped-real-20261009`，启动前记录来源，不复用旧memory/skill/prompt或注入本轮诊断结论。
- 单因素：同P1源码，取消bridge动作上限；不实施P2–P4。旧50动作样本为参考，不是相近预算净收益对照。观察更多预算是否带来规则修订、可检验图案关系与关卡进展；若持续重复错误解释或无进展，不能称预算增加有效。
- 用户已授权无人工动作/token总额度，本次不自动加新额度。停止仍按WIN、环境终态、原有时限及故障规则；没有付费自动重试。实际关数、动作、父+analyst用量、延迟、错误/拒绝、组件语义利用及认知连续性保存于独立run。
- 启动方式：隐藏后台Python进程，stdout/stderr与PID/命令写入 `runs/_launchers`，待真实bridge/Pi与provider起动后核对 `run-config.json` 及公开action budget的maximum/total_maximum均为null。启动验收不替代终态或自主行为/净收益验收；B/C/D继续开放。

```powershell
$env:PYTHONPATH = 'D:\autoresearch_pi_project\src'
python -m autoresearch_pi.cli arc-thin-e2e --game ls20 --variant treatment --arc-root 'D:\arc-agi-benchmark\arc-agi-3-benchmarking' --max-actions 0 --root 'D:\autoresearch_pi_project\runs\pi-arc-thin-ls20-treatment-p1-uncapped-real-20261009'
```

启动实录：2026-10-09 00:53:14 +08:00，隐藏后台Python PID109480。00:54:08核查官方bridge为NOT_FINISHED、1动作、0关；实际 `action_budget.maximum=null` / `total_maximum=null`，run-config reported/decision caps均null，3个真实父响应17262reported，1条memory、0故障。来源217文件在启动前采集，fresh harness不继承旧运行认知。见 [启动验证](../../runs/pi-arc-thin-ls20-treatment-p1-uncapped-real-20261009/diagnostics/startup-verification.json)、同目录 `launch.json` / `source-start.json` / `monitor.py` 与 [run-config.json](../../runs/pi-arc-thin-ls20-treatment-p1-uncapped-real-20261009/run-config.json)。本次请求的后台启动已完成；进程继续运行，终态、后续自主规则修订与净收益尚未验证。

终态状态核查（2026-10-09 08:45后）：summary在05:36:15 +08:00落盘，原PID已结束，未重试。319个已记录动作、观察到的最高关数及最后关数均0/7，NOT_FINISHED；321决策/13 consolidation/2无动作决策，`passed=false` / `decision_timeout`，Pi等待超时且bridge.close亦timed out。总耗时16980.5秒（4小时43分0.5秒），7777869reported（628个父响应、9次analyst，完整成本/在途未知尚未深入审计）。最后成功动作#319在05:15:49：原计划声称A3会受阻，只消耗底条；公共delta实际52像素、玩家从c19-23移到c14-18，模型后纠正边界假设。随后真实工具回执有`EnvironmentReturnedNoFrame`和多次timeout，最终RESET工具start未见正常闭合；不推断这些无帧请求一定未作用到远端环境。结束由故障等待触发，动作上限持续null，非预算耗尽。

终态组件：memory284日志行/25最终项；face_state v1、track_progress v4（总5版本），183技能执行、0记载技能运行错误；1条531字符prompt覆盖；9次analyst。pi-events共130条isError工具结束回执，其中12条arc_action（包括调用保护/参数拒绝与环境失败），不能用harness.errors=0称零错误。候选创建/调用存在不证明游戏规则正确或净收益。

来源限制：本次状态核查时，相对启动217文件有4处当前工作区漂移：demo/arc_thin_extension.ts、demo/pi_task_python.ts、src/autoresearch_pi/arc_thin_e2e.py、src/autoresearch_pi/cli.py。变更时刻及已加载进程是否受影响未核实，不归因于这些变化，也不把该样本称完整源码冻结对照。见 [status-terminal-20261009.json](../../runs/pi-arc-thin-ls20-treatment-p1-uncapped-real-20261009/diagnostics/status-terminal-20261009.json) 与 [summary.json](../../runs/pi-arc-thin-ls20-treatment-p1-uncapped-real-20261009/summary.json)。本次仅状态诊断；区域/技能全部语义重算、失败请求结算、完整五类闭环未新增验收。更多预算在此样本没有带来过关，B/C/D与净收益仍开放；下一有界检查先分清远端无帧/超时的故障点，再核查模型将图案变化解释成耗尽条形即可WIN的证据链，不自动启动付费重跑。

## 无上限样本 level 0 行为诊断（2026-10-09）

用户问“为什么始终停在level 0”。仅复算保存的公共帧/轨迹和审阅memory、skill源码、9次analyst返回，无新模型/环境请求、无runtime改动。319动作中78个动作后状态的左下图案与顶部目标相同，匹配窗口始于#166/#175/#185/#193/#230/#274/#318；匹配时从未到顶部入口x34,y15，实际进入x34,y10为0次。入口向上尝试仅#11/#12/#15/#157，前态全部不匹配、全部零变化。上次P1样本#13改变图案、#19匹配、#20返回入口后向上成功；本次未执行该组合，不能将不匹配的失败推广为入口永久封闭。

父早期把资源清空当目标，#45条为空未过关、#132 GAME_OVER后仍沿用；#185明确认识匹配却继续检验“匹配+条空/停在0/1”。analyst有正确图案比较，但无证据追加清条/形状转换条件，最后接受条件缺失的#157反例。face_state/track_progress自动化局部计数，未建立顶部图案比较到返回入口的实验；183技能输出未全面重算。断点在识别→可区分实验→反例反馈修订，不能用组件创建/调用数宣布收益。末尾环境故障解释结束，不解释之前长期无进展；新独立run未继承旧成功记忆。

功能仅公共统计获本轮核查；thin局部实际调用可观察、完整五类闭环未验；自主局部识别/使用有证据但实验纠偏失败；净收益未验证。来源漂移限制沿用上节，完整规则必要/充分条件仍未证明。下一检查为另行有界真实诊断：保持匹配后返回同一顶部入口，对比拒绝/接受和关数；机制优化另需单因素命题，不预置游戏答案或扩大本轮授权。详细记录及可复算脚本见 [level0-diagnosis.md](../../runs/pi-arc-thin-ls20-treatment-p1-uncapped-real-20261009/diagnostics/level0-diagnosis.md) 和 [level0-evidence.json](../../runs/pi-arc-thin-ls20-treatment-p1-uncapped-real-20261009/diagnostics/level0-evidence.json)。B/C/D保持开放。

补充反思/竞争假设诊断：用户质疑把319动作失败全归初始goal等三点。公开日志确认#45承认清条非全部目标、#132删除旧strategy/hypothesis并探索其他动作；#135/#185/#188及第9次analyst确有替代候选。应修订为“有反思与候选生成，未维持有效竞争和否证约束”，不能称没有反思。#16–131的116动作全部A1/A2，#50/#75主动推迟其他控制以保持chip count；#157把不匹配条件下失败记为conf5永久入口阻断。#223匹配+条空及#224复位已否证该充分条件，后来#309/#310仍重复。启动版本extension/runner可由HEAD精确哈希恢复，system prompt也匹配；每决策旧对话退出、只投影自写memory和最近8动作，未捕获HTTP正文，不冒充逐请求曝光验收。130工具错误中114为memory拒绝；#257/#282删除strategy_192被限额拒绝、旧策略最终残留，#307公开总结与真实删除结果不一致。机械修订摩擦和选择性否证保存应纳入，而非全部归因模型初始goal。详细公开时间线、边界及单因素候选见[诊断补充](../../runs/pi-arc-thin-ls20-treatment-p1-uncapped-real-20261009/diagnostics/level0-diagnosis.md#补充为何反思与竞争假设没能持续纠偏)和[reflection-audit.json](../../runs/pi-arc-thin-ls20-treatment-p1-uncapped-real-20261009/diagnostics/reflection-audit.json)。本轮仅诊断，无新runtime/provider/ARC动作；自主纠偏与净收益仍未验证。
