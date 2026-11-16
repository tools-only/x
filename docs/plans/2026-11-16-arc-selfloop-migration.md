# Meta-harness 变更记录：ARC 自进化环（运行视图 + 反思接口 + 收据结算）

日期：2026-11-16。状态：实现（本轮只做实现与离线验证，无付费 run）。
按 [开发流程](../development-workflow.md) 使用。

## 问题与命题

- 真实失败/机会及材料：E1/E1b 的 harness 回合里，评审机会出现了，但 agent 很少真的改自己（8 个回合 0 次改动，
  `docs/plans/2026-10-26-e1-harness-turn-protocol.md`）；已有的 `harness_expectations.jsonl` 记录了 EXPECT 的
  candidate/result，但没有任何地方把「改动 → 激活 → 被后来的决策使用」连成一条结算；重复回读同一状态的问题在
  `su15-chm-loop-200`（0 levels / 94 actions）与 r03b 的 helper-retyping 诊断里都已记录。evo 侧已在 PPT 形态实现并跑过
  「视图 + 反思接口 + 收据」三层（只读来源：`evo-loop-implementation` HEAD `ce4178f4`，包含 brief 指定的 M4 `08822735`、
  M5 `a4ef09ba`，架构描述已对源码核对：`demo/self_root.ts` 的 `metaBoard`/`metaAcceptance`/`metaPhase`/`selfChangeDigest`、
  `demo/self_observation.ts` 的 A1–A4 与 `observationHeads`、`demo/prompts/self_root_meta_fields.md`）。观察与推测分开：
  「agent 在评审回合少改自己」是记录到的事实；「因为没有把事实推进每次决策」是推测，本记录要证伪的正是它。
- 窄命题：在 ARC thin/native 路径上，若每个决策都拿到宿主渲染的运行事实摘要（A1–A4）并有一个可热改、带收据、下一决策
  生效的槽位接口，则一次完整 run 中 agent 至少做 1 次结构性自改，该改动在后继决策被实际使用，并在关卡边界的机械结算里
  计为 `used_later`。
- 减少的负担：① 重复回读同一状态（一行摘要替掉一次读工具）；② 悬空改动（每条改动带到关卡边界结算，有收据可对账）；
  ③ 观察只在评审时对账（摘要进入每次决策的执行路径，而不是只在 LEVEL/STALL REVIEW 出现）。
- 适用条件、合理不使用条件与推翻条件：适用于 native 路径；不使用的情形包括只跑对照臂、或 agent 判定当前无需改槽（结算会
  记 0 并保留理由，不算失败）；推翻：一次完整 run 里「改动 / 激活 / used_later」三者全无 → 命题不成立，按单因子定位断点
  （视图没进上下文？工具没被调用？改动没生效？）。
- 范围及非目标：只迁 evo 的三层结构。不迁 meta loop 的内部编排（步骤/转移/交付分派）、七字段字面、requests 预算、L4 开放；
  不动 refiner、binder、view channel、subagent/consult、EXPECT、关卡复盘、本地判分器；不改 `arc_action` 的形状；不新增
  「built-in 分析」（帧差/区域/运动追踪仍归 agent 自己写工具）。

## 设计与成本

- 选择与取舍：复用优先。事实全部来自已有日志（`usage.jsonl`、`working_set.jsonl`、`context_budget.jsonl`、
  `trajectory.jsonl`、`component_runs.jsonl`、`claim_checks.jsonl`、`refiner.jsonl`、`harness_changes.jsonl`、
  `harness_expectations.jsonl`）；槽位做成 binder 的组件类 `slot`，版本、`sourceOf` 回退、EXPECT 尾注、写入收据全部走现有
  通路，不新建工具、不新建日志；摘要与常量字段由宿主渲染，agent 不能改视图值。取舍：把「可优化对象」限定为组件 + 槽位，
  不做通用策略 DSL——够用来证伪命题，且可逐段 revert。
- 生命周期：决策装配（宿主渲染摘要）→ 决策（agent 读摘要、按需改槽）→ 写入（binder 保存、收据、EXPECT candidate）→
  下一次决策（新值生效）→ 关卡边界（结算 changes/activated/used_later）→ 结算行写盘、期望 result/settled。
  失败路径：写被 binder 拒绝 → 收据给出可修复的清单；期望超窗未满足 → 结算记为未满足，不静默。
- 首次获益路径：一次决策里 agent 读到摘要 → 发现自己重复回读 → 改 `history.result_chars` 或 `refine.every` → 下一决策生效
  → 后续 predict 或 rules.md 行引用该收据。
- 新增与移除：新增常量字段块（宿主固定，非模型临时写）、一行摘要、`slots/self.json`、`data/self/` 三个只读文件、
  关卡结算行。不删任何现有段；字符开销记入 `working_set.jsonl` 的 `sections`（新增 `self` 段）。
- 权限/版本/环境边界：视图渲染器、事实收集、验收/预算/权限/环境信号永不可写；槽位只能取宿主给定的默认值与范围；
  `--no-context-files` 不变；`ARC_THIN_SELFLOOP` 默认关。
- 放弃与恢复：四段各自一个提交，任何一段出现默认不等价或负收益即 revert 该段；`slots/self.json` 可经 binder 回退到任一版本；
  环境历史（tokens/动作）不可回退，已在结算里如实记录。

## 运行前实验协议

- 目标证据层级：本轮到「功能正确 + 全链路可达」；「自主采用」「净收益」需真实 provider run，未授权。
- 主要变量与比较器：`ARC_THIN_SELFLOOP=0`（对照）vs `=1`（处理），同局、同模型、同设置。采用判断用匹配前缀 fork：同一游戏
  同一步 N，有/无改动，比较之后动作分布与关卡结果。分支点与比较标准在 run 前定稿（见下）。
- 模型/provider/推理配置：本轮离线用 mock ARC SDK + scripted provider；真实 run 的 provider/模型待用户申报时固定。
- 独立样本与运行顺序：本轮 0 样本；真实 run 每臂 1 次、200 动作，先跑对照后跑处理，同一游戏。
- 总预算与停止规则：本轮 0 付费。真实 run：6M token（未缓存输入 + 输出，`token_cap_measure=uncached_input+output`）每次，
  每臂一次，授权内不重启；首轮失败阈值见交付决定。
- 主要指标与判定标准：`changes` / `activated` / `used_later` 三计数；uncached in+out；动作数；关卡数；父子总成本与延迟。
  接受：处理臂三项计数 ≥ 1 且关卡数不低于对照臂；推翻：三项全无，或关卡数下降且找不到单因子。
- 负例：不改槽（应记 0 且有理由）；改了没激活；激活但没被用；期望未满足；预算耗尽；恢复后复用旧值。
- 遥测及材料：本轮用 pytest / node 测试 / scripted smoke 的退出结果与日志；真实 run 需 run 目录里的 `data/self/`、
  `harness_changes.jsonl`、`harness_expectations.jsonl`、`usage.jsonl`。

## 实现与验证

### 段一：事实可读（只读，零行为风险）

- 改动入口及实际行为：新增 `demo/arc_thin_selfview.ts`（`withoutBodies`、`predictionCounts`、`spanFacts`、`outcomeRow`）与
  `demo/arc_thin_extension.ts` 中 `ARC_THIN_SELFLOOP=1` 下的 `data/self/` 投影：`context_budget.jsonl`、`working_set.jsonl`
  （去掉 `text`/`tail`，保留 `sections`）逐决策追加；`outcomes.jsonl` 在关卡完成后的下一次决策前写一行（span、胜负动作、
  工具/python 运行、claim 结果、refinement、`harness_changes` 内的自改）。启动时从 `harness/` 种子恢复，不覆盖历史。
  写入走 `Workspace.runtimeWrite`，`data/` 对 agent 只读；未改任何现有段、工具或 `arc_action`。
- 功能/相关回归检查：`tests/arc_thin_selfview.test.ts` 4 项、`tests/arc_thin_selfloop.test.ts` 3 项（含“开/关两臂文本
  逐字节相同”“关卡结算只写一次”“重启从 store 种子”）通过；邻接套件 `arc_thin_selfview / selfloop / work_memory_loop /
  self_harness / level_review / native_context` 合计 36/36 通过（node `--experimental-transform-types`，离线）。
  `arc-thin-smoke` 的两臂（关/开）此前也通过；注意它固定 `foundation="legacy"`，不进入 native 工作区，因此只能证明共用扩展
  加载路径不回归，不能证明本段链路。
- 机会漏斗与断点：本段不产生决策文本（`heads[1] === heads[0]`），只让事实可读；采用证据属于后三段。
- 语义与连续性：事实是计数与拷贝，不含判断/排序/建议；重启后同一文件续写，不重置。
- 成本与任务结果：上下文零字符（无新段）；磁盘为逐决策行 + 每关一行，尚未在真实 run 量出。
- 协议偏离：无。

### 段二：常量字段 + 一行摘要（进入每次决策）

- 改动入口及实际行为：`demo/arc_thin_selfview.ts` 新增 `SELF_FIELDS`（宿主给的四行固定字段：任务即宿主、同一写路径与激活边界、
  关卡边界结算）与 `selfDigest`（一行计数：决策序号/动作数/关卡、predictions made·hit·miss、自有组件清单（最多列三个）、
  `harness_changes.jsonl` 行数、最近一次 outcome、`data/self/` 三个文件的行数指针）。`demo/arc_thin_extension.ts` 新增
  `selfText()`，在 `buildWorkingSet` 把关卡状态与视图输出之后接上：tail 变为 `[self, spin, viewOutput, board]`，
  THIS BOARD 仍在最后；`ARC_THIN_CONTEXT_LAYOUT=0` 时放进 `sections`。块的字数记入 `working_set.jsonl` 的
  `sections.self` 并随段一投影进 `data/self/working_set.jsonl`。摘要每个数都由运行期已写的行算出，不新测任何量。
- 功能/相关回归检查：`tests/arc_thin_selfview.test.ts` 增至 6 项（新增 `selfDigest` 两例，逐字断言）；`tests/arc_thin_selfloop.test.ts`
  3 项（第一例扩展为：开/关两臂正文除资源尺寸行外逐字节相同、块长度等于 head 实际多出的前缀、字数记账等于块长、
  所在段计入 carried 尺寸、THIS BOARD 仍最后）；两文件 9/9。邻接套件 `selfview / selfloop / work_memory_loop / self_harness /
  level_review / native_context` 41/41 通过（离线、mock bridge）。
- 机会漏斗与断点：本段首次让事实进入决策文本（断点若存在，是 agent 读了却不改自己——由段三/段的结算回答，离线不可判）。
- 语义与连续性：块是宿主渲染的计数与拷贝，不含判断/建议，每决策都在同一位置；重启后由 store 行重建，不另存状态。
- 成本与任务结果：离线测得每决策约 0.7k 字符（同一决策 carried 5.4k → 6.1k，测试断言差值 ≈ 块长 + 2，容差 120）；
  记入 `sections.self` 供真实 run 对账。任务结果未测。
- 协议偏离：无。

| 证据层级 | 状态 | Provider / environment | 产物及结论边界 |
| --- | --- | --- | --- |
| 功能正确 | 已验证（离线） | node 24 `--experimental-transform-types`，mock bridge（HTTP stand-in） | `tests/arc_thin_selfview.test.ts` 6 项、`tests/arc_thin_selfloop.test.ts` 3 项 + 邻接 41/41；证明行构造、写入、摘要文本、落位与默认等价（关臂无块、字节相同） |
| 全链路可达 | 部分验证（离线） | 同上；`arc-thin-smoke`（legacy 臂） | 摘要经 `context` 装配进入每次决策的尾部并被记账；真实 Pi/provider 下的完整 run 未验证 |
| 自主采用 | 未验证 | — | 需真实 provider run |
| 净收益 | 未验证 | — | 需真实 provider run |

## 交付决定

- 已支持和未支持的声明：待填。
- 决定与依据：待填。
- 剩余验证与下一可证伪检查：待填。
- 关联 backlog：`docs/deferred-research-todos.md` D（上下文压缩/连续性）——段二触及决策尾部布局，本记录不改
  compaction/continuity 逻辑，D 的未决项仍留待后续。
