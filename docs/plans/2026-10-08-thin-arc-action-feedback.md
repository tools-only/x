# Thin ARC 分区域动作反馈（P1）

日期：2026-10-08（Asia/Shanghai）。状态：P1 实现及局部诊断完成，模型行为与净收益待验证。用户同意先实施 P1。

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

## 实现与验证

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
