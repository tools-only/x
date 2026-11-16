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
- 新增与移除：新增常量字段块（宿主固定，非模型临时写）、一行摘要、`slots/self.json`、`data/self/` 五个只读文件
  （段一：预算/工作集/关卡结果；段三：`slots.json` 库存；段四：`settlements.jsonl` 结算；后者见段四的协议偏离）、
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
- `used_later` 口径（run 前先定死，brief 原文）：**「改动后被后续 predict 引用，或晋升为 rules.md 一行，或其 view 输出被
  后续决策引用」**。落成三个分别记录的信号，全部来自运行期已写的行：`cited`（该改动之后记录的 action 行，其 `idea`/`expect`/
  `note` 任一含改动路径、文件名或该改动设置的槽键）、`rules`（该改动激活后 `prompts/rules.md` 有更晚版本）、`exercised`
  （`component_runs.jsonl` 中该工具的 run 发生在改动之后）。任一成立即 `used_later=true`，`signals` 记下是哪几个。
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

### 段三：反思接口与首批槽位（可热改的宿主设置）

- 改动入口及实际行为：
  - 新增 `demo/arc_thin_selfslots.ts`：`SLOT_SPECS` 五个键及合法形式（`history.result_chars` 200–20000、`history.full_results`
    0–10、`refine.every` 1–200、`review.consult` true/false、`stall.after` 0–500；默认值就是今天的硬编码值）；`slotComponent`
    整文件校验（坏键拒绝保存，消息给出键名与合法形式）；`slotValues`（生效值合并，后文件覆盖先文件）；`changedSlots`（只报
    与宿主当前默认不同的键）；`slotInventory`（`data/self/slots.json`：写入方式 + 每键 current/default/legal）。
  - `demo/arc_thin_binder.ts`：新组件类 `slot`（`slots/*.json`），`Binder` 构造器注入 `slotValidate`；slot 收据形如
    `slots/self.json → slot self v1: saved · loaded · refine.every=5 · active from your next decision`，失败时
    `NOT loaded (…) · v1 still runs`；HARNESS 索引列出 slot 行与生效时机。版本、`sourceOf` 回退、EXPECT 尾注、写入收据全部
    复用现有通路，未新建工具或日志。
  - `demo/arc_thin_extension.ts`：`before_agent_start` 在 `binder.boundary`（重绑）之后、决策计数之后取
    `run.slots = slotValuesNow()`（本决策内固定），写出 `data/self/slots.json`（库存）与 `harness/self_slots.json`
    （运行期手交：`{at, values}`）；读点改读 `slot(key, 硬编码默认)`：`refine.every`（调度判定 2359、REFINE POINT 文本 3122、
    refine 点判定 4300）、`review.consult`（4298）、`history.result_chars`/`history.full_results`（history 摘要 4485、
    冻结 4518、原生投影 4535）。digest 在改动后追加 ` (last <path> vN)` 与 `; slots set: k=v`。
  - `src/autoresearch_pi/arc_thin_e2e.py`：新增 `_slot_stall_after`（读 `harness/self_slots.json` 的 `values["stall.after"]`，
    仅接受整数 0–500，否则忽略）；`selfloop` 门（native + treatment + `ARC_THIN_SELFLOOP=1`）下每决策前以该值替换本次
    due 判断的间隔；selfloop 时把 runner 解析出的 `ARC_THIN_STALL_REVIEW` 交给扩展，使库存里的默认值等于 runner 实际值。
- 默认等价：无 `slots/self.json` 时 `run.slots = {}`，`slot()` 返回硬编码默认；digest 在 changes=0 且无槽位时与段二逐字节
  相同（段二测试原样保留并通过）；runner 侧读不到手交文件时 `_slot_stall_after` 返回原间隔。
- 功能/相关回归检查：新增 `tests/arc_thin_selfslots.test.ts` 4 项（有效绑定与描述、整文件拒绝与消息、合并与差异、库存）；
  `tests/arc_thin_selfview.test.ts` 增至 7 项（新增 lastChange/slots 逐字一例）；`tests/arc_thin_selfloop.test.ts` 增至 4 项
  （新增槽位全环：写入收据 → 下一决策 digest/索引/库存/手交文件 → 读点消费（`REFINE POINT (every 2 actions`）→ 坏保存被拒且
  v1 继续生效、手交值不变）；`tests/test_arc_thin_stall_review.py` 增至 5 项（新增 `_slot_stall_after`，含缺失文件/坏类型/
  越界/0=关）。五个文件合计 51/51（selfview 7、selfloop 4、selfslots 4 + 邻接 binder 4 / work_memory_loop 3 / self_harness 12 /
  level_review 7 / native_context 15），pytest 5/5。离线、mock bridge、node `--experimental-transform-types`。
- 机会漏斗与断点：本段让 agent 第一次能改宿主行为；写入→激活（下一决策边界）→消费（读点）→结算（段四）全链有收据可对账。
  断点若存在，是 agent 读了库存却始终不写 `slots/self.json`——离线不可判，由真实 run 的 `harness_changes.jsonl` 回答。
- 语义与连续性：槽值唯一来源是 `slots/*.json` 组件（宿主默认与范围不可写）；非法值整体拒绝、不部分生效；本决策内取快照，
  下一决策边界才换；库存每决策重写，agent 只读。
- 成本与任务结果：无改动时零字符；有改动时 digest 每决策多出约 20–60 字符。库存是只读文件（约 1.2KB），只在 `data/self/:`
  指针里被点名，不占决策上下文。任务结果未测。
- 协议偏离：静态系统提示与工具描述里的周期数（`call_points` 行、refine 工具描述、EXPECT 视界）仍用启动值——系统提示整 run
  固定以保前缀缓存（`yibu-cache-lifetime`），逐决策文本携带实时值；runner 在 selfloop 下向扩展多传一个环境变量
  `ARC_THIN_STALL_REVIEW`（只被库存默认值读取，不改变原解析逻辑）。

### 段四：关卡边界结算（机械验收）

- 改动入口及实际行为：
  - `demo/arc_thin_selfview.ts`：新增 `settlementRow`（每个完成关卡一行：`level`、`from_at`/`to_at`（与 outcome 行同一
    span）、`changed`/`activated`/`used_later` 三计数，`changes` 逐条给出 `{path, version, activated, used_later, signals}`）、
    `settlementText`（一行计数，最多点名 3 个 used later 的改动）；digest 增 `lastSettlement` 与 `rows.settlements` 指针。
  - `demo/arc_thin_extension.ts`：`selfOutcomes` 在同一 hook（关卡完成后的下一次决策前）对每个完成关卡追加结算行：取该关
    `harness_changes.jsonl` 的行、边界时的 `binder.versionMap()`、`slotValuesNow()`、`trajectory` 与
    `component_runs.jsonl`；写 `data/self/settlements.jsonl`（与 `outcomes.jsonl` 同一条发布通路）。`recordComponentWrite`
    的 slot 行改从 `binder.candidates()`（含刚保存、尚未进入 `active()` 的版本）取 `parameters.slots`——用 `active()`
    只能拿到上一次边界的绑定，刚存的槽键会丢，`cited` 就永远不成立（集成测试抓到的真实断点）。
  - `used_later` 按「运行前实验协议」里逐字口径落地为 `cited` / `rules` / `exercised` 三个分别记录的信号；`activated` 为
    `versionMap[path] ≥ 该改动版本`，slot 另要求它设置的每个键仍在生效值里。全部是运行期已写的行或 run，不做判断。
- 默认等价：无自改的关卡也写一行 `changed: 0`（digest 显示 `N settlements (level X: no self change)`），使指针可对账；
  关闭 `ARC_THIN_SELFLOOP` 时无任何新文件、新文本（段一测试把关臂 `parts.length === 2` 保留）。
- 功能/相关回归检查：新增 `tests/arc_thin_selfsettle.test.ts` 4 项（槽改动被 cite → `activated`+`cited`；无引用/无晋升/无运行
  → 计数 2、used_later 0；rules 晋升 + 工具运行 → `['rules','exercised']`；后续保存丢掉槽键 → 不激活）；`tests/arc_thin_selfview.test.ts`
  增至 8 项（新增结算行在 digest 里的逐字一例）；`tests/arc_thin_selfloop.test.ts` 增至 5 项（新增结算全环：写 slot+rules →
  关卡完成前无 `settlements.jsonl` → 下一决策出现 1 行（`from_at 0`、`to_at 3`、2 changed / 2 activated / 1 used later，
  slot 记 `cited`、rules.md 记未用）→ digest 带该行 → 再下一决策不重复结算）。三个自环文件 17 项 + 邻接
  `binder`/`work_memory_loop`/`self_harness`/`level_review`/`native_context` 36 项，合计 57/57；`tests/test_arc_thin_stall_review.py`
  5/5。离线、mock bridge、node `--experimental-transform-types`。
- 机会漏斗与断点：结算把段三的「写入 → 激活 → 消费」接上第三段：没被激活或没被用的改动会在关卡边界显式记 0，而不是
  悬空。断点若存在，是真实 run 里 `activated` 有而 `used_later` 恒 0——那说明 agent 改了设置却不据此决策，由 run 的
  `settlements.jsonl` 与 `trajectory.jsonl` 逐条对账；离线不可判。
- 语义与连续性：结算只读关卡内的收据行；重启后 `loadSelfRows()` 从 `harness/` 的存储行种子恢复，不重复写同一关卡。
  改动的 `version` 以收据行里记录的版本为准，不按当前绑定重算。
- 成本与任务结果：首个结算前零字符；之后 digest 每个决策多出约 40–90 字符（一行计数 + 最多 3 个名字）。磁盘每关一行。
  任务结果未测。
- 协议偏离：① 新增第五个只读文件 `data/self/settlements.jsonl`，超出段一批准的三文件清单——提交后报告用户，2026-11-16
  用户批准（「批准」），清单即为五文件；② 无自改的
  关卡也写结算行（0 改动），因为 digest 的指针与「负例留证」都按行对账；③ 结算的 `from_at` 取关卡 span 起点（与 outcome 行
  一致），不改 outcome 语义。

| 证据层级 | 状态 | Provider / environment | 产物及结论边界 |
| --- | --- | --- | --- |
| 功能正确 | 已验证（离线） | node 24 `--experimental-transform-types`，mock bridge（HTTP stand-in）；pytest（本地） | 自环四文件 `selfview` 8、`selfloop` 5、`selfslots` 4、`selfsettle` 4 + 邻接 `binder`/`work_memory_loop`/`self_harness`/`level_review`/`native_context` 合计 57/57；`test_arc_thin_stall_review.py` 5/5；证明视图行、摘要文本、槽位校验/合并/库存、写入激活、读点消费、关卡结算三计数与三个信号、runner 的 stall 槽读取与默认等价（关臂字节相同、坏保存不改生效值）。另跑全部 `arc_thin_*` 时 `activation` 的 closed-loop 用例与 `receipts` 的 partial-line 用例失败，同一断言在基线 r04 上逐字复现，与本变更无关（未修） |
| 全链路可达 | 部分验证（离线） | 同上；`arc-thin-smoke`（legacy 臂） | 摘要、槽位、结算均经 `context`/`before_agent_start` 进入决策；`slots/self.json` → binder → HARNESS 索引/收据 → 下一决策 digest，以及 `harness_changes.jsonl` + `component_runs.jsonl` → `selfOutcomes` → `data/self/settlements.jsonl` → digest 一行，均有测试串起；真实 Pi/provider 下的完整 run 未验证 |
| 自主采用 | 未验证 | — | 需真实 provider run（看 `harness_changes.jsonl` 是否出现 `slots/self.json` 或组件写入） |
| 净收益 | 未验证 | — | 需真实 provider run |

## 交付决定

- 已支持和未支持的声明：支持——四段在离线 mock bridge 下功能正确（57/57 node、5/5 pytest），默认等价（`ARC_THIN_SELFLOOP`
  未开时零新文件、决策正文逐字节不变），且「事实 → 摘要 → 槽位 → 结算」每段都有可对账的产物；不支持——agent 是否会自主采用
  （写 `slots/self.json` 或在后继 predict 里引用）、净收益、真实 Pi/provider 链路、任何关卡结果，均为未验证。
- 决定与依据：四段各自一个提交、可独立 revert；本轮不含付费 run（brief §6），故不宣称采用与净收益。段四新增的
  `data/self/settlements.jsonl` 超出段一批准的三文件清单，曾标记为协议偏离；2026-11-16 用户批准，偏离闭合，真实 run
  不再因此受阻（预算仍待申报）。
- 剩余验证与下一可证伪检查：需用户申报预算的真实 run（每臂 6M token、200 动作、同局、先对照后处理）；首轮失败阈值——若
  处理臂 `changes`/`activated`/`used_later` 三项全无，停下按单因子定位（摘要未进上下文 / agent 未读 `data/self/` / 槽位未
  生效 / 结算未记录），不换设计；首轮通过则用匹配前缀 fork 比较改动前后的动作分布与关卡结果。
- 关联 backlog：`docs/deferred-research-todos.md` D（上下文压缩/连续性）——段二触及决策尾部布局，本记录不改
  compaction/continuity 逻辑，D 的未决项仍留待后续。
