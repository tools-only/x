# ARC layered 在线自进化 Qwen 27B 实施记录

日期：2026-11-26（Asia/Shanghai）。状态：本地实现和 scripted 接线评估。基线 `9137fd35`，工作分支 `codex/qwen27b-online-evo`。设计输入为用户提供的 `qwen38_27b_online_evo_design.md`。

## 问题与命题

基线的能力清单缺少 `readdirSync` 导入，写入 `work/` 后的加载与回测延至下一次 Python 调用，复盘关号使用了过关后的关号。`miniReview` 在一关内反复展示。上下文驱逐没有记住切点。历史 Qwen 运行见 [延后研究待办](../deferred-research-todos.md) D 节及原始运行链接。

命题是在单局 layered 运行中，当轮加载 Agent 写入的文件并展示验证结果，减少盲等调用。Qwen 27B 档以 40,960/20,480 的驱逐阈值、最近四块完整工具结果及 4,096 输出 token 限额，降低上下文和长输出负担。40K/20K 是实验参数，尚无真实 provider 证据证明该档提高任务效果。简短关卡合理不写能力文件。

## 设计、入口与成本

`_WorkFile.close()` 成功写入后从宿主取得当前 `claims`、`lib` 和 `model.py`，当轮装载、回测并把结果写进同轮 Python 回执。依赖库变化使已导入库、谓词和模型重新加载。Agent 后续动作经现有 `submit_actions` 反馈，文件再修改或删除即替换旧版本。Python 调用期间的 `sys.setprofile` 记录 `lib` 函数调用，用于区分直接下单与辅助计算；其 CPU 成本尚未测量。

上下文 hook 保持上次驱逐切点，超过 cap 后跳至 target，并在后续请求前面放置最近的工作文件摘要和轨迹事实。能力目录仅在内容变化、开局或换关时进入状态消息。裁剪提醒在阈值达到后的下一状态消息展示。工作文件、规则反例、稀疏预测及重复动作事实通过现有 Python 回执和状态消息进入 Agent 循环；新观测和动作更新统计。旧工作文件由 Agent 修改或删除，恢复块在下一次驱逐时更新。没有新增 Agent 或动作门禁。

`ARC_LAYERED_PROFILE=qwen27b` 或 runner `--profile qwen27b` 启用实验档，环境变量仍可覆写。runner 保留 `--no-context-files`，动作预算和工作目录边界由现有路径执行。系统提示缩至 4,182 字符源文本，scripted 请求中的渲染后提示为 3,643 字符。默认路径保持原参数。

## 运行前实验协议

真实模型实验沿用设计稿的 A/B/C 臂，thinking 固定开启，先短探索，再在留出游戏上独立重复。记录过关数、有效进展、动作、未缓存 input 与 output、reasoning、墙钟、`length` 截断、文件写入到实际调用、压缩前后的关键假设与反证。每局费用和停止规则必须在运行前得到明确预算授权。负例包括无价值文件创作、语法错误、依赖修改、跨关规则反例、裁剪后恢复和高重复动作。真实运行尚未启动。

## 实现与验证

- Slice 0。能力目录导入、当轮文件加载与回测、跨库热更新、辅助库调用归因、一次性 miniReview、复盘关号、`WORKING.md` 与 `GUIDE.md` 契约。
- Slice 1。状态化驱逐切点、恢复块、接近阈值提醒、能力目录按事件展示、qwen27b 档。驱逐基于文本和图像估算 token，尚未核对实际模型 tokenizer 或 KV 命中。
- Slice 2。系统提示缩短、分关规则统计及反例见证、稀疏模型差异计分、连续 Python 错误及同文件三次失败修改后的短成本提示。
- Slice 3。同状态重复动作列出已试与未试离散动作，复盘文件限 3,000 字符，换关展示已携带能力和新关核对数。`REVIEW.md` 的自然语言目标只回显给 Agent，由 Agent 判断是否兑现。

定向 Node 测试覆盖同轮写规则和动作、跨库热更新、辅助调用、稀疏预测、重复动作、驱逐稳定及错误回执。11/11 通过。`python -m pytest tests/test_arc_layered_evolution.py -q` 为 2/2。两次 scripted smoke 使用真实 Pi、生产 bridge、mock ARC SDK 和 `offline-arc-layered-smoke` provider，分别覆盖过关复盘命名和同轮写 claim 后动作命中。产物在 `runs/qwen27b-slice23-smoke-20261126/` 与 `runs/qwen27b-evo-write-smoke-20261126/`。后者 `decisions.jsonl` 第一步记录 `claims_held=["action_seen"]`。

原有两个 Node 文件的全量测试在基线为 52 项通过 38、失败 14，当前添加测试后为 60 项通过 47、失败 13。失败主要来自已失配的旧断言，包括 review freeze、expect/harness_state 与旧的无动作返回值。该矩阵未全绿，不能将其作为完整回归通过。差异中基线失败的模块自动导入测试在当前通过。后续需单独整理过时断言并复跑。

按 Self-Harness 验收指南复核最终 `runs/qwen27b-final-smoke-20261126/`。源为 `9137fd35` 加本工作树未提交改动，qwen27b 档，scripted provider 的 thinking 为 off，真实 Pi/bridge、mock ARC SDK。上限 2 动作，实际 2 动作、2 次请求、0 关，因动作预算结束，0 provider 错误，墙钟约 3 秒。reported 4 tokens 是脚本回报值，不能代表真实费用或吞吐。TASK 的请求包含图像和 `python` schema，动作经 bridge 获得回执，第二请求收到第一动作后的 claim 与能力目录。ADAPT 独立阶段不适用本 layered 路径。`action_seen` 由脚本写入并当轮加载，宿主对第一动作执行它并报告 held；第二请求显示其文件和结果。脚本第二次动作仍是预设调用，无法证明该结果改变了选择。没有 Agent 自主创建的工具调用，L0–L3 均未达到。环境与模型层的自主采用、认知连续性和净收益继续未验证。

| 证据层级 | 状态 | Provider / environment | 产物与界限 |
| --- | --- | --- | --- |
| 功能正确 | 定向通过；全量回归未通过 | Node、Python、本地 FakeBridge | 定向 11/11、pytest 2/2；旧矩阵仍有 13 项失败 |
| 全链路可达 | 已测情境通过 | scripted provider、真实 Pi 与 bridge、mock ARC SDK | 两次 smoke，含同轮 claim 命中和复盘文件 |
| 自主采用 | 未验证 | 真实 Qwen 3.8 27B 未运行 | scripted 调用顺序不代表自主采用 |
| 净收益 | 未验证 | 真实 provider/官方 ARC 未运行 | 未测任务收益、父子成本及 KV 缓存率 |

## 交付决定与后续检查

保留实验状态。下一项可证伪检查是固定 thinking 开启及预算后，先核对真实请求的输入和 `length` 截断，再运行 A/B/C 普通探索。D 节的认知连续性及 A/C 边界仍开放。按真实后续决策检查关键假设、反证和实验续点，不能用文件存在或脚本接线关闭这些条目。
