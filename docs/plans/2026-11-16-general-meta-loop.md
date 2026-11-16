# 通用 meta loop：给 agent 产生任务级自进化 loop 的指导范围与设计流程辅助

日期：2026-11-16（Asia/Shanghai）。状态：设计（待用户确认后实现；M1 付费运行另需预算授权）。
上游：[2026-11-15-capability-view-design.md](2026-11-15-capability-view-design.md) §11（倒置勘误）。本文取代其 §11.5 的"纯减法"方向——减法全部保留，另加用户定义的建设性一半。

## 0. 用户定义（2026-11-16，逐字）

> "meta loop指的是你要根据我的需求阐述，帮我在工程中设计实现一个meta loop，这个meta loop能够给agent根据不同任务产生自进化loop提供指导范围和设计流程辅助。"
> "meta loop最好是通用的"

绑定读法：

- meta loop 是**宿主侧工程物**：由开发环设计实现，固定、任务无关（通用）、建一次。
- 它提供的是**辅助**：指导范围 + 设计流程辅助。**自进化 loop 本身仍由 agent 为每个任务现场生成**（用户同日早先定义：agent 用 meta loop 构建自进化 loop，把任务流程拆分/嵌套进去，边交付边进化运行视图中的可优化对象，最终沉淀能以最高质量交付该任务的 harness——harness 属于交付物）。
- §11 教训继续绑定：meta loop 不得重新占住环的边——不得机械节奏、不得问卷应答义务、不得替 agent 做语义判断。

## 1. 问题与命题

- 真实失败：B3-2（runs/evo-b3r2-glm53f-capview-20261116）交付 10/10 但能力级自进化 0；§11 定位为包含关系倒置——评审回合嵌在任务里，agent 从未被要求产生过一条属于自己的 loop，自然只有执行。
- 窄命题：在 META 模式（目标句入任务 + T0 设计回合 + 机械评审协议拆除）下，glm-5.3-flash 在 PPT 任务上**至少完成一次内核循环**——agent 主动的结构级变更 → 后续任务段流经该对象 → agent 据观察结果再行动；次要判据：交付质量不低于 B3-2。
- 减少的负担：拆除常驻的强制评审入口（B3-2 中 15 次入口 14 次宿主触发）、每入口三问应答、闭合数组 schema、窗口预告、L4 声明义务；新增仅一次 T0 设计回合与一次会话末收口。常驻义务净减；协议开销预期显著下降（B3-2 评审协议约占 1/3 请求）。
- 适用条件：self_root 家族任务（PPT 及后续同族任务）。合理不使用：短到没有"段"的单回合任务。推翻条件：M1 中 T0 产物为仪式性（写完即弃、全程无修订、无结构级变更、kernel=0）→ 范式在本模型/本任务证伪，剩余解释收敛 H3（模型能力）/H4（任务结构）。
- 范围与非目标：本次授权 = 设计文档 +（用户确认后）实现与离线检查；不改 ARC thin 路径；不引入任务内容进 harness；不给 agent 的设计打分。

## 2. 定位：两个对象，分层

| | meta loop（宿主脊柱） | 自进化 loop（agent 的任务环） |
|---|---|---|
| 谁建 | 开发环（本工程） | agent（每任务现场） |
| 何时建 | 一次，此后固定 | T0 设计，全程可修订 |
| 内容 | 指导范围 / 设计流程辅助 / 事实回执 | 任务段如何嵌进看-改-验的循环 |
| 任务相关性 | 零（通用） | 全部 |
| 载体 | self_root.ts META 模式 | agent 自己的 orchestration（可执行） |

被否定的 §8.3（"评审入口即元控制回合"）错在两处：把 meta loop 的最细一格（判断面上的小机制）当成了全部；并且从不存在"让 agent 先设计自己的 loop"这一步——评审入口审的是一个从未被要求产生的环。

## 3. 三要素

1. **指导范围**（T0 一次交付；只说存在，不说构建）：
   - 可写对象空间：四层运行视图（prompt/context/loop/harness）中 agent 自己的组件、policy、orchestration；
   - 修改接口：reflect_component / reflect_orchestration / policy，全程可用；
   - 判断材料：observation 事实行（A4 inventory/recurrence、receipts、usage）；
   - 边界：保护区（acceptance 冻结）、预算、权限——照旧生效，不随模式变化。
2. **设计流程辅助**（T0 一次交付；自由思考，产出 = orchestration 改写，而非应答字符串）：
   1. 本任务"最高质量交付"指什么？什么可观察证据能表明它？
   2. 你的运行视图对象里哪些影响该质量？哪些值得在本任务中进化？
   3. 你交付期间要跑什么样的 loop：何时、凭什么证据看自己的 harness？任务段如何流经你改过的对象？
   4. 用 reflect_orchestration 把它写成你的 orchestration（附一句意图说明）；运行教给你什么，就随时修订。
3. **事实回执**（T1 持续）：A4 事实行照旧；orchestration 修订与步执行本来就是 ledger receipts。三禁区（不给因果/结论/建议/命名创建物）约束全部回执。T0 材料是用户明示要求的引导层，例外而有界：只出现一次、零任务内容、不要求应答。

## 4. 三时间点协议

- **T0（任务开始；唯一新增机制）**：任务定义（含目标句任务半）之后、首个任务段之前，脊柱交付指导范围 + 设计流程辅助；**进入任务段前须有一次 reflect_orchestration（一次性门）**。产出内容完全自由——写回等价于种子的单步也放行，但那也是 agent 写下并被记录的决定。目标句脊柱半（通用，运行文本草案，措辞待用户定稿）：
  > "Your deliverable is twofold: the task artifact itself, and the harness you sediment while delivering it — the final form of your components and orchestration is that harness."
  任务半（命名具体产物，如 deck）在 runner 的任务提示里——任务相关内容天然归 runner，不进脊柱。
- **T1（执行中）**：无宿主触发的评审入口（booked_facts / unit_completed 强制入口关闭；事实照常记账）。节奏完全由 agent 的 orchestration 决定——这是可执行结构而非声明：live_orchestration_core.ts 的执行器按 activeStep 校验动作白名单、transition 要求 evidence receipts，agent 写的 loop 就是真实执行流。requested_review 自发门保留（无问卷、无闭合 schema）。
- **T2（before_session_end，一次）**：runtime 发最终 harness 盘点事实（组件与 orchestration 终态、修订链）；agent 自由收口。无 schema。

§4.7-3 遗留的"节奏转正（节奏参数入 policy）"在 META 模式下被取代：节奏不入 policy 参数，直接随 orchestration 归 agent。

## 5. 对 §11 五条断裂边的处置

| §11 断裂边 | META 处置 |
|---|---|
| 宿主节奏占位 | 拆：强制入口关闭；时钟随 orchestration 归 agent |
| 问卷整形 | 拆：ENTRANCE_QUESTIONS 与应答数组不加载；设计辅助一次性、面向未来、产出可执行物 |
| 出口合法化 | 拆：无闭合表格；环的"下一圈"由 agent 自己的 transitions 承载 |
| 目标缺位 | 加：目标句（脊柱半 + 任务半） |
| 模式墙 | 留门拆墙：requested_review 保留，反射接口全程可用（对齐决策 1 = 方案 B） |

## 6. 通用性

脊柱文本只枚举视图对象、接口、边界与设计流程问题——对任何 self_root 任务同样成立；不含任务词（deck/slide/颜色等）。任务内容唯一入口是 runner 的任务提示。不随任务类型换模板（用户裁定：通用）；任务间差异全部由 agent 的 T0 设计吸收。符合"General, not ARC-fitted"不变量；本文不触 ARC 路径。

## 7. 吸收的对齐决策（原四项开放决定）

1. 模式墙 → 方案 B：保留 agent 自发门、拆除问卷/闭合/窗口（§5）。
2. 观察事实全保留：[inventory]/[recurrence] 是事实不是问题，照常渲染。
3. 内核判据边界：prompt 层结构变更计入（用户："包括视图中的所有可优化部分"）；纯参数补丁不计（用户 §0 裁定）；**T0 首次设计是环的存在条件，不计为内核循环**——内核循环从 T1 起算（含对 T0 设计的修订）。
4. 目标句措辞：脊柱半草案见 §4，任务半归 runner；最终措辞待用户定稿。

## 8. 实现映射（代码锚点；实现时逐项核对）

- 旗标：`EVO_META`（mech.meta）。META 下 ask/l4 强制关闭（互斥），a4 保持开。旧模式原样保留为对照臂。
- self_root.ts：META 下 booked_facts 不再排 evolution_review 触发（约 line 1137；before_session_end 留作 T2 收口）；entranceAskBlock（line 621）与 entry_question_responses schema 注入（lines 546-547）随 ask 关闭自然不加载；新增 T0 材料一次性注入与任务段前置门。
- live_orchestration_core.ts：零改动——执行器现状（reflect 校验、bootstrap、dispatch 动作白名单、transition 证据条件）即所需。
- self_root_ppt.ts / runner：任务提示加目标句任务半。
- 离线检查（实现后）：node tests 覆盖——T0 材料恰好出现一次；门生效且一次 reflect 后放行；META 下无宿主评审入口、decide_exit schema 无三问字段；旧模式（EVO_ASK/EVO_L4）回归不变；跑法照旧 `--experimental-transform-types --test --test-concurrency=1 --test-force-exit`。

## 9. M1 运行前实验协议

- 目标证据层级：自主采用（内核循环）；功能/接线由离线检查先行，不动付费运行。
- 主要变量与比较器：META 模式 vs B3-2（机制塔）；B2（纯许可）作第二对照。其余配置对齐 B3-2。
- 模型/provider/任务：glm-5.3-flash via az；同一 PPT manifest 与初态；重试配置同 eb804196。
- 预算（待用户授权，启动前申明）：镜像 B3 上限——600 请求 / 14400 s / 2 GiB，无 token/USD 上限（B3-2 实际 $0.32）；重跑计入同一授权。
- 主要指标：内核循环数（主）；交付质量不低于 B3-2（次：30/30 literals、10/10 citations、0 渲染警告、目检）；请求/token/墙钟与协议开销占比（对照 B3-2 的约 1/3 请求）。
- 负例与读法：T0 写回种子等价单步且 kernel=0 → 证伪证据，不是 harness 故障；T0 产物反复校验失败 → 执行器 schema 校验 + nudge 兜底，计为摩擦记录；全程只有参数补丁 → kernel=0，同证伪。证伪后收敛 H3（换更强工作模型；agent-native 不变量允许）/ H4（任务结构：绑定成本 / 第二消费者）。
- 停止规则：上限触顶、交付完成（stop=delivered）、重复相同调用触发网关拒绝（已知现象）。
- 遥测：summary.json 入口来源字段已有；内核链从 ledger 的 reflection/step/receipt 行提取（§8.4 证据链四级即此）；按运行日志计量使用（no-dangling 规则）。

## 10. 风险与护栏

- 协议化（设计回合变填表，B1 义务化翻版）：产出是可执行 orchestration 而非应答字符串；不设计质量评分、不设数量奖励；仪式性改写有后果——agent 之后要活在自己写下的结构里。这份自缚正是 PPT 任务此前缺失的"被感受的梯度"（ppt-no-felt-gradient：修复靠任务结构，不靠又一种 harness 形态）。
- 以用判不以有判：判 harness 凭内核循环与流经它的交付，不凭组件数量（B1 教训）。
- 本机制自身的 no-dangling 自检：T0 产出无请自入 agent 回路；取代宿主评审节奏 + 问卷协议（常驻义务净减）；反馈 = agent 修订自己的设计、开发环按 kernel 从运行日志计量；退休条件 = M 系列显示 T0 恒为仪式 → 脊柱随范式证伪一并撤下。

## 11. 交付决定（当前状态）

| 证据层级 | 状态 | Provider / environment | 产物及结论边界 |
| --- | --- | --- | --- |
| 功能正确 | 离线通过（2026-11-16） | 本机 node 25.5.0，无 provider | `tests/self_root_meta.test.ts` 5/5：T0 门与一次性设计记录、META 无宿主评审入口、旧机制被替换而非叠加、T2 清单只记一次；`self_root_evo_capability` + `self_root` 32/32 无回归 |
| 全链路可达 | 未验证 | — | 离线只证明对象层调用链；扩展与 runner 接线需 M1 实跑才可见 |
| 自主采用 | 未验证 | — | 待 M1（需新预算授权） |
| 净收益 | 未验证 | — | 同上 |

- 离线检查备注：`tests/ppt_demo.test.ts`(8) / `ppt_demo_live_orchestration`(1) / `ppt_trials`(1) 为既有失败，本改动前后计数一致，不在本次范围。
- 实现提交：`demo/self_root.ts`（EVO_META 门、T0 材料、T1 触发抑制、T2 清单）、`demo/ppt_demo_extension.ts`（META 文本入上下文与评审门旁路）、`src/autoresearch_pi/evo_ppt.py`（目标句任务半 + 臂守卫）、`tests/self_root_meta.test.ts`。

- 开放决定（请用户定夺）：① T0 一次性门——硬门（本文选择；B2 已证纯许可 = 0，软提示重复已知负例）还是软提示；② 目标句最终措辞（§4 草案）；③ M1 预算授权。
- 下一可证伪检查：M1（§9），授权后执行；实现与离线检查先行。
