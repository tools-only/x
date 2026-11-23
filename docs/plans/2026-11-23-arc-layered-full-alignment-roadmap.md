# `layered` profile：窄面补齐记录与完全对齐设计 v0.4 的开放方案

日期：2026-11-23（Asia/Shanghai）。上游文档：[设计 v0.4](2026-11-23-arc-agi-3-layered-design-v0.4.md)（最高）、[对齐方案](2026-11-23-arc-layered-duck-aligned-dev-plan.md)（其次）。本文记录已补齐的接口缺口，并列出把工程推到与设计 v0.4 完全一致所需的全部剩余项，每项标注层级、设计出处、建议实现与验收。

## 1. 已补齐的窄面（本次实现）

| 缺口 | 设计出处 | 实现 | 验证 |
|---|---|---|---|
| 系统变量可被改坏 | v0.4 §2.2 "系统变量只读" | 帧数据以不可变 tuple 存储（`_freeze`），`.grid`/`.frames` 每次访问返回拷贝；`_bind` 从规范数据重建 Frame | 单测 "a model edit cannot corrupt it"；真实路径 "edit visible? False / restored? True" |
| `result = ...` 不返回 | 对齐方案 §4.3 "stdout 或 result" | `_cell` 执行后读取命名空间 `result`（每次调用前清除旧值） | 单测 + 真实路径（返回 dict） |
| 无 `show()` 图像通道 | v0.4 §2.2 helper 表 "`show` 把图像送回模型" | `show(grid, region, scale)` 把原始网格入队（每次调用最多 2 张），经 kernel `done` 帧返回宿主，extension 在工具结果里渲染成 PNG | 单测（2 张上限、region、scale）；真实路径（image queued + 网格数据落盘） |
| `work/*.py` 不能 import | v0.4 §2.2 工作目录、§4.6 可执行世界模型 | `sys.meta_path` 挂 `_WorkFinder`：`work/<name>.py`、`work/<pkg>/__init__.py`、`work/harness/lib/<name>.py` 经宿主 file 代理加载；`importlib.reload` 可拿到改后的文件 | 单测（写→import→改→reload）；真实路径（`world_model.TAG == "wm-5"`） |
| `history[i].changed` / `.hash` 缺失 | v0.4 §2.2 history 行 | `_append` 时对比上一帧算 `changed`，FNV 哈希算 `hash`；Frame 也带 `.hash` | 单测 + 真实路径（`result` 里返回了两者） |
| `last_action_result` 只有单步 | 对齐方案 §4.2 "同样的内容写入 last_action_result" | `submit_actions` 的批量汇总（executed/stop_reason/level/state/level_changed/reset/valid_actions/lines）写回 `last_action_result`，并随 `done` 帧同步宿主，跨调用、跨内核重启保留 | 单测 + 真实路径 |
| GAME_OVER 时 `valid_actions` 仍列 MOUSE | 真实 P1 运行发现的状态消息矛盾 | `valid()` 在 GAME_OVER 态只保留 RESET（与守卫一致） | 22/22 回归通过 |
| 系统提示未说明以上能力 | v0.4 §4.2 第 4 条 | `arc_layered_system.md` 补充 `show`、`result`、`import`/reload、`changed`/`hash`、批量汇总语义 | 模板替换测试回归通过 |

证据层级：功能正确（22/22 Node 单测）与全链路可达（两次真实 bridge + 官方 SDK 脚本化运行，ls20，scorecard 正常关闭，无模型调用）已验证；自主采用与净收益未验证——还没有模型在新能力上的真实运行。

遗留的文档歧义（不改代码，建议改设计文档措辞）：30 s 超时实现为**计算时间**（等待宿主动作/文件时暂停计时），设计文档写"单次执行超时 30 s"未区分口径。计算时间口径对批量动作更合理，建议设计文档采纳。

## 2. 完全对齐的开放方案

原则沿用设计 v0.4 §4.0：模型掌舵、不编码具体游戏、每加一样东西都要消融。以下每一项都是设计文档已有条目，不是新增范围。排序按依赖关系与预期收益（世界模型 > 上下文 > 事件 > 其他）。

### O1 可执行世界模型闭环（L3 §4.6，消融收益最大项）

- **现状**：import 通道已通，但没有 `test_world_model(history)` 约定，提示也未引导"动力学写文件并用 history 回测"。
- **方案**：纯提示层改动。系统提示方法节加入：MODEL 阶段把动力学写进 `work/world_model.py`，提供 `predict(frame, action) -> frame` 或等价接口；用 `history`/`transitions` 回测，全部通过后才允许在模型上做 BFS/搜索；预测落空（SURPRISE）回到 MODEL。harness 不强制阶段顺序。
- **验收**：真实 provider 在 su15/ls20 各 ≥3 次，统计"写出通过回测的世界模型"的局数、每关动作数对比无此提示的组。
- **规模**：提示 10–20 行，无代码。

### O2 折叠（上下文第 2 级，L2 §3.2）

- **现状**：只有第 1 级淘汰。折叠能把旧工具结果确定性改写成一行、保留前缀缓存命中。
- **方案**：`context` hook 中，对超过最近 K 轮的旧 toolResult：文本替换为一行摘要（取 `[env]` 行或首行 + 截断标记），图像剥离（淘汰已做图像剥离，folding 把它推广到文本）。只改旧消息，不动顺序。参数 `fold_after_turns` 进配置档。
- **验收**：单测（折叠后 call/result 配对完整、最新 K 轮不折叠）；真实运行对比淘汰-only：每回合输入 token 下降、关卡数不退化。
- **规模**：约 60–80 行 + 测试。

### O3 摘要压缩（上下文第 3 级，L2 §3.2）

- **现状**：`session_before_compact` 直接取消 Pi 自动 compaction，窗口逼近时只能靠淘汰。
- **方案**：达到窗口上限减 16k 余量时，用自定义摘要替换旧历史：固定任务块 → 摘要（记忆标签全文 + 轨迹要点 + 世界模型回测结果）→ 最近一轮。摘要生成走一次模型调用（或先用确定性拼接版本，消融后再决定是否上模型摘要）。
- **验收**：负例测试（摘要后记忆标签仍在、动作记账不乱）；长局真实运行一次穿越摘要边界。
- **规模**：约 100–150 行。O2 之后做，两者共享"旧消息改写"的管线。

### O4 `expect` 比对 + SURPRISE 事件（L2 §3.5，对齐方案 P3 项）

- **现状**：`expect` 只记录进 history entry，不比对。
- **方案**：`expect` 支持三种形式：变化格数区间 `(lo, hi)`、`levels_completed` 增量、断言谓词。宿主或 prelude 在每步后比对，不符时该步结果标 `surprise: true`，批量停止（强制），状态消息加一行 SURPRISE。维护最近 10 步预测准确率，写入状态消息供模型调节批量长度（§4.5 粒度控制）。
- **验收**：单测（区间命中/落空、落空即停）；真实 provider 消融：带 expect 提示 vs 不带。
- **规模**：约 60 行。

### O5 STUCK 事件（L2 §3.4 / §4.5 卡死升级）

- **现状**：事件只有 LEVEL COMPLETE / GAME_OVER / BUDGET。
- **方案**：宿主按 `history[i].hash` 维护已见帧集合；连续 N 步（默认 8）无新 hash 时，状态消息注入 `STUCK: n steps without a new state. Change strategy.`；20/40 步升级措辞（穷举建议 → 止损提示）。阈值进配置档。
- **验收**：单测（hash 重复计数、分级措辞）；在容易卡死的游戏上看事件是否触发、模型是否改变行为（定性）。
- **规模**：约 40 行。

### O6 notebook 记忆（L2 §3.3，API 档）

- **现状**：只有 7 种标签携带。设计给 API 档配 notebook（patch 语义、分区、证据步号与置信度）。
- **方案**：第二个工具 `notebook(op, section, text)`（仅 `api-research` 档注册）：sections 固定为 controls / entities / rules / goal_hypotheses / levels / open_questions / dead_ends；`op` 为 replace/append/delete；全文或摘要随状态消息注入；`pi.appendEntry` 持久化。注意 §4.4 的告诫：只有轨迹显示模型反复为此写样板代码才启用——先实现为开关默认关，由消融决定。
- **验收**：单测（patch 语义、注入格式）；消融对比标签携带。
- **规模**：约 80 行。

### O7 状态图 helper（L2 §3.3 事实存储；v0.4 §2.2 `graph_summary / bfs_graph / replay_to`）

- **现状**：未实现。
- **方案**：宿主（TS 或 prelude 内纯 Python）维护图：节点 = 帧 hash，边 = (hash, action) → hash；提供 `graph_summary()`（节点/边数、frontier：有未试动作的状态）、`bfs_graph(goal_predicate)`（已知边上的最短路）、`replay_to(hash)`（返回动作序列，不执行）。只作查询接口，不主动注入（§4.4）。实现放 prelude 可以直接用 `_H`，零 RPC 成本。
- **验收**：单测（确定性小游戏上图正确、replay 序列可行）；点击类/迷宫类游戏消融。
- **规模**：prelude 内约 60 行。

### O8 已知 no-op 拦截（L2 §3.5，默认关）

- **现状**：未实现。依赖 O7 的图。
- **方案**：`submit_actions` 可选参数或配置开关：(state_hash, action) 已证实无变化时返回提示不执行，`force=True` 强制。默认关，消融为正才开。
- **规模**：约 20 行，排在 O7 后。

### O9 关卡边界压缩 / 新 session（L2 §3.2 其他规则、§3.6 C 段）

- **现状**：runner 已有分段，但段间不压缩，新段带全部历史。
- **方案**：`level_change` 结束段后，runner 可选 `--fresh-level-session`：开新 Pi session，只带记忆标签 + 关卡笔记 + 最新帧。对照组为现状（同 session 续跑）。
- **验收**：多关卡游戏上对比 token 与关卡数。
- **规模**：runner 约 40 行。

### O10 遥测与回放（L2 §3.8）

- **现状**：有 layered.jsonl / usage.jsonl / request-events.jsonl 和 SDK 录制，缺上下文查看器与诊断报告。
- **方案**：
  1. `context_snapshot`：淘汰/折叠后把每次请求的消息骨架（角色、类型、token 估算、是否含图）追加写 `context.jsonl`（不存全文，避免体积爆炸）。
  2. 本地计分脚本：按官方公式（平方比、1.15 上限、关卡加权、未完成 0）从 scorecard JSON 重算，输出每游戏得分表。
  3. 诊断 HTML（对应 Duck diagnostics.html）：游戏 × 尝试的关卡热力图。后两项复用 `arc_layered_e2e.py` 的汇总数据。
- **规模**：1 约 20 行；2 约 60 行；3 约 100 行，可后置。

### O11 自进化文件约定激活（对齐方案 §7，P2 主体）

- **现状**：import 已通，模型可以写并加载 `work/harness/lib/*.py`；缺变更检查、git 版本化、`evolution.jsonl`。
- **方案**：段边界时宿主扫描 `work/harness/` 与 `work/*.py` 的变更：语法检查（`ast.parse`）失败的文件在状态消息里报告；通过的记入 `evolution.jsonl`（路径、hash、段号）；run 结束 git 快照。晋升流程（held-out 验证 → 预装 `work/harness/lib/base/`）按对齐方案 §7.3，属 P4。
- **验收**：对齐方案 P2 行的验收不变：出现重复计算的游戏上每动作 token 下降、关卡数不退化。
- **规模**：约 100 行。

### O12 子代理编排（L2 §3.7，可选，MVP 不做）

维持设计文档判断：优先级最低，Kaggle 单 GPU 下与主代理争抢吞吐。仅当 API 档轨迹显示"模型反复手动模拟多分支探索"时再立项。

### O13 Kaggle 移植（L1 §2.1 推理服务、对齐方案 P5）

- vLLM + Qwen 本地端点、`kaggle-local` 档真实模型运行、9 h / 110 局吞吐评估、是否把 L2 移植为纯 Python。全部未动，依赖 P1–P3 的结论。

### 执行顺序与消融纪律

```
先行（无代码或低风险）：O1 提示 → O5 STUCK → O4 expect
上下文线：O2 折叠 → O3 摘要 → O9 关卡边界
记忆/模型线：O7 状态图 → O8 no-op 拦截；O6 notebook（API 档）
工程线：O10 遥测 → O11 进化激活 → O13 Kaggle
```

每项单独消融（§5 规则：train 与 held-out 同时改善才合并，收益 ≈ 0 的删掉）；O1/O4/O5 可共用一轮对照组。任何一项开工前按项目规则确认预算授权。

### 首次 provider 运行后的小优化（2026-11-23，已实现，未重跑）

来源：`runs/arc-layered-su15-provider-closure-20261123`（az gpt-6-luna low，su15，23 步 / 0 关，停在本地准入 `token_cap`）。

- 准入文本预留原为"每序列化字节 1 token"，33 条消息时预留 43,777，把 10 万上限压到约 6.5 万实际可用。
  `demo/pi_provider_request_admission.ts` 新增 `PI_PROVIDER_TEXT_BYTES_PER_TOKEN`（默认 1，行为不变）；
  `arc_layered_e2e.py` 给 layered 运行默认设 3（仍比典型 ~4 字节/token 保守）。
- 勘误：16 动作/调用上限在系统提示里本来就有（扩展启动时替换 systemPrompt，session.jsonl 存的是替换前默认提示）。
  模型一次请求 21 个被截停属于采用层面观察，不是提示缺失。

## 3. 证据层级（本文变更）

| 层级 | 状态 | 说明 |
|---|---|---|
| 功能正确 | 已验证 | 22/22 Node 单测（`tests/arc_layered_python.test.ts`、`tests/arc_layered_extension.test.ts`） |
| 全链路可达 | 已验证 | 真实 bridge + 官方 SDK（ls20，OFFLINE 计分口径之外的真实 API）脚本化跑通全部新能力，scorecard 正常关闭；`runs/arc-layered-p0-closure-20261123b/p0-real.json` |
| 自主采用 | 未验证 | 尚无模型在新能力（show/result/import/changed/hash）上的真实对局 |
| 净收益 | 未验证 | 开放方案 O1–O13 全部未实施，无对照 |
