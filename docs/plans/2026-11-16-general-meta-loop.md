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
  - 白名单语义（M3 后修订，见 §14.7）：`step.actions` 是**工具名权限范围**，可列 surface 广告的任何工具（read/write/edit/ls/grep/python/office.* 等）；省略 = 该步放行全部工具。协议面（read_self / read_self_component / reflect_* / decide*）**永不受步骤白名单约束**——否则一次窄化就能把改回它的唯一入口一起关掉，即自锁。收据类型限制只用于 transition `on.action`/`requires` 与 decision `evidence`（那里的错拼会静默永不触发）。
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
- 2026-11-16 启动前用户指令（配置差，M1 与 B3-2 对照时须计入）：种子 `request.maxOutputTokens` 与 runner 回退 `request_output_tokens` 8192→32768，种子 `context.tool_results.max_chars` 4000→16000；提交 2aba1ebd（含 `self_root.test.ts` 断言同步），node 自检 45/45。B3-2 在 8192/4000 下运行。
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
| 全链路可达 | 部分（扩展装载探针通过；装载层 fixture 已修正，剩余失败为语义陈旧层） | 本机 node 25.5.0 + 脚本化 provider，无真实模型 | 与 `test_evo_ppt_pi` 相同的 Pi 命令行 + `demo/ppt_demo_extension.ts` + 当前 floor 契约的 manifest：`prompt` 返回 `success: true`，stderr 空 → META 改动后扩展可装载并应答。但任务段在扩展内真实流经 T0 设计这一层离线未覆盖，需 M1 实跑 |
| 自主采用 | 未验证 | — | 待 M1（需新预算授权） |
| 净收益 | 未验证 | — | 同上 |

- 离线检查备注（既有失败，非本改动引入，根因已分层定位）：
  - 第 1 层，装载失败（本次已修）：`tests/test_evo_ppt_pi.py` 与 `tests/test_evo_ppt_stall_recovery.py` 的 fixture 契约仍带 `before_delivery` / `window_entry` / `before_batch_switch`，而 `demo/self_root.ts` 的 FLOOR 自 `59f4ad8f`（evo-loop v0.2，D1 "无 before_delivery，交付是一次调用"）起只接受 `before_active_reset` / `unit_completed` / `before_session_end`；扩展装载即抛 `v1 contract floor/segment/heartbeat/inheritance mismatch`，Pi 进程退出 → 报 `Pi RPC process exited before responding`。在父提交 `f34bd14e` 上计数一致（5 failed/2 passed、3 failed）；探针把同一 manifest 换为当前 floor 契约后同一命令行即成功。两处 fixture 的 boundaries 已改为当前 floor（纯修正，不改断言语义）。
  - 第 2 层，runner 语义陈旧（未修，属独立范围）：修正 floor 后 `test_evo_ppt_stall_recovery` 为 2 failed / 1 passed，失败点都在 `result['stop']` 期望值——(a) `plain_text_end` 这个停止模式已在 `f77e88bf`（evo-loop-v0.4-task-continue，"Continue evo tasks until formal delivery"）移除，纯文本收尾现在改为重新提示"Continue the task in execute mode…"直到预算触顶，于是结果变成 `budget_or_integrity_stop`（`budget-stop.json` 记录 `authorized budget exhausted`，request 19/19）；(b) 重试策略在 eb804196（B3-1 修）后是 `maxRetries: 6, baseDelayMs: 5000`（`evo_ppt.py:84-89`），观测到的 `delayMs` 为 5000/10000/20000，故 `delayMs <= 4000` 与 `min(len(errors),2)` 两条断言也已过时；(c) `test_evo_ppt_pi.py` 在 `assert 'op' in decision_schema['required']` 失败，因为 `demo/self_root_ppt.ts:150` 的 `DECIDE_SCHEMA` 现在是 `required: []`（普通任务决策不必带 `op`）。
  - 结论：这两套用例不是一次 fixture 修补能救回的，需要按当前 runner/decide 语义重新基线化断言（重试节奏、纯文本收尾的续跑语义、decide schema 形状），是一项有自己范围的改动，本次未做；因此本次只保留第 1 层的纯修正，把第 2 层如实记为未修。
- node 侧既有失败 `tests/ppt_demo.test.ts`(8) / `ppt_demo_live_orchestration`(1) / `ppt_trials`(1) 同属既有，改动前后计数一致，不在本次范围。
- 实现提交：`demo/self_root.ts`（EVO_META 门、T0 材料、T1 触发抑制、T2 清单）、`demo/ppt_demo_extension.ts`（META 文本入上下文与评审门旁路）、`src/autoresearch_pi/evo_ppt.py`（目标句任务半 + 臂守卫）、`tests/self_root_meta.test.ts`。

- 开放决定（请用户定夺）：① T0 一次性门——硬门（本文选择；B2 已证纯许可 = 0，软提示重复已知负例）还是软提示；② 目标句最终措辞（§4 草案）；③ M1 预算授权。
- 下一可证伪检查：M1（§9），授权后执行；实现与离线检查先行。

## 12. M1 结果（2026-11-16）

运行 `runs/evo-m1-glm53f-meta-20261116`：az / glm-5.3-flash，`EVO_A4=1 EVO_META=1`，commit `2aba1ebd`（含 §9 记录的 32768/16000 配置差），预算 600 请求授权内。

| 证据层级 | 状态 | 读数 / 产物 |
| --- | --- | --- |
| 功能正确 | 通过 | T0 材料一次性注入；设计写回开启 `meta_t0_design` 门一次；META 下无宿主评审入口（`reviews: []`）；runtime_activations 仅 request 3 |
| 全链路可达 | 通过 | T0 设计写入成功（`self_revision` 2），执行器后续每次收到 receipt 都回执 |
| 自主采用（内核判据） | **0** | 见下 |
| 交付质量 | 基本达标 | 30/30 字面量、0 渲染警告；citation 探针 0/10 为格式假阴性（deck 写 `Source: …, page 1`，探针要求邻接）；目检 10/10 单元有出处 |
| 成本 | 40 请求（39 + 1 预检）、13,501,215 tokens、$2.2242 | 对照 B3-2：56 请求、2,162,079 tokens、$0.3236；6-7× 主因零缓存 + 32768/16000 配置差，不作机制结论 |

内核为 0 的机理（一条断边，静默）：

- agent 的 T0 设计把 transition 绑到 `submit_unit`（当时只是 boundaryTool，**不产生任何 orchestration receipt**）与 `render_save`（不存在的类型）。
- 执行器对没有匹配 transition 的 receipt 一律返回 `status:"recorded"`（ledger:258 即 `office.deliver` 的原样回执），于是每次交付后 step 从未离开 `work`，环不转。
- 全链无人告知"这个类型不可记录"：校验只查形状，不查可记录性；T0 材料也不列可绑定类型。失败模式 = 静默接受，而非报错。
- 判读：不是 harness 崩溃、不是 agent 怠工（交付质量达标），是"写了环、环没转、无人察觉"。按 §9 负例读法，这是设计层诊断，不是证伪脊柱——绑定的可记录性是可修的过渡点。

## 13. M2：一个主因素的修复（2026-11-16）

主张（可证伪）：把"执行器会记录哪些 action receipt 类型"变成显式声明并在 reflect 时校验、在 T0 材料里推送，则 agent 的 T0 设计不会再绑到不可记录的类型；一旦绑定的是真实类型，`submit_unit` 的 receipt 会推进 step，环在真实运行中转起来（kernel ≥ 1）。

改动（全部最小化，零新层）：

- `demo/live_orchestration_core.ts`：`validateDefinition(def, knownActions?)` 对四类绑定（step.actions、decision evidence、transition on.action、transition requires）校验，错误信息列出可记录集合；`declareActionTypes()` 公开声明；未声明的会话行为完全不变（对照臂/旧测试不受影响）。
- `demo/self_root.ts`：`SelfRootOptions.actionReceiptTypes`；事务候选构造与回滚（`Object.assign` 后）都重新声明；`metaT0()` 在已声明时追加一行"Action receipt types this runtime records（step actions / transition on.action / requires / decision evidence 唯一可用类型）：…"。仍是推入、非拉取，零任务词。
- `demo/self_root_ppt.ts`：adapter 声明 `office.render / office.look / office.deliver / submit_unit`；`submit_unit` 处理器发真实 orchestration receipt（`unit`、`episode`、`artifactVersion: Number(receipt.revision)`、`artifactHash: receipt.source_sha256`），与 `office.render` 记录的 exports receipt.json 同源，`currentArtifact/freshness:'current'` 类要求可匹配。
- `demo/ppt_demo_extension.ts`：非 evo 路径只声明三个 office 类型（submit_unit 是 self-root adapter 工具）。

摩擦语义（保留，不改）：事务内任何失败→`abortTransaction`→`chainFailed`，整条响应链中止，下一请求边界复位。即 T0 设计被拒时，agent 在**下一个模型响应**里改正重发；被拒设计不开门（`noteMetaDesign` 只在 resolve 时记账）。

离线证据（本机 node 25.5.0，无 provider）：

- `tests/live_orchestration_known_actions.test.ts` 5/5：四类绑定被拒且错误列出集合、revision 不变；绑定真实类型时 `submit_unit` receipt 使 transition `advanced`、step 变 `render`；未声明会话保持旧接受；SelfRoot 事务路径下 T0 材料命名集合、被拒设计不开门、下一请求改正后开门且只记一次；无声明时事务路径保持旧接受。
- 回归：`self_root_meta` 5/5、`self_root` + `self_root_evo_capability` 32/32；ppt 三套既有失败计数与改前一致（8/1/1）。

M2 协议：同一任务/manifest/模型/臂守卫，commit 冻结后启动；**上限 560 请求**（M1 已用 40，记在同一 600 授权内），14400 s / 2 GiB 不变。主指标同 §9（kernel ≥1：T1 起 agent 自主结构变更 → 后续任务段流经它 → agent 对观察结果采取行动；T0 首版不计，修订计入，纯参数补丁不计）；交付质量不低于 B3-2。

## 14. 全链归因：为什么自进化为零（2026-11-16，M1 终局 + M2 前缀）

用户判定（经 fork 会话转达，原话）："当前的meta loop和自进化loop是完全不符合我的预期的。而且这二者是递进的关系。meta loop存在问题导致自进化loop仅仅是检查了执行过程中的冲突事实。而不是我们预期的agent自进化过程。同时agent在任务执行过程中的运行状态视图对象也没有被纳入到loop中,这说明meta loop和自进化loop在实现上完全偏离了设计"。本节以此为框架逐环定位脱钩点，区分【实现缺陷】（可直接修）与【设计内赌注】（忠实实现了设计、但合起来失败，改动需用户决策）。

### 14.1 运行事实

M1 终局（complete:true，~820 s；计费 40 = 39 工作 + 1 预检，live-self 请求记录 38 条，其中 17 条为 429 限流重试槽——az RPM 600 超限，Pi 退避重试扛住，每槽按保守预留记账 6-13 万 token，§12 成本虚高 6-7 倍的主因即此，跨臂比较只能用 reported usage）：

- 自我操作总计：reflect_orchestration 2（均在 T0，1 驳回 1 通过）；read_self 0；reflect_component 0；自开入口 0。全程唯一"反思"是对 deck 的任务侧 QA（self_review，self_revision 不变）——即用户所说"仅仅检查了执行过程中的冲突事实"。
- 驳回原文（session.jsonl:8）：`transition to_render: on key 'unit_done' is not an event type and step 'work' has no decision; resend with one of those properties or on:{type:"decision",id} / on:{type:"action",action}.`
- validation window：终局全文件 0 个（effect_status / after_use / status:open 均无），尽管通过的 T0 写入声明了 expected_effect。

M2 终局（04:56:54–05:07:09Z，~617 s，24 请求 = 14 reported + 10 个 429 槽；reported 合计 input 424,228 / output 17,974 / cacheRead 66,048，reported 成本 ≈ $0.08；lifecycle 最后事件 `delivered`，24/24 结清、无 pending）：

- **kernel = 0**。T0 一次通过、无驳回；被接受的设计与 `orchestrationSchema` 的 example/种子逐字段同构（单步 `work`、`transitions:[]`，self_root.ts:157）。T0 后 reflect_* 0 次、read_self 0 次，revision 全程停在 2。
- 交付路径比 M1 更薄：v1 一次渲染（15 slides）→ 10 个 unit 逐个 submit（全部同一 artifactVersion 1/同一 hash）→ office.deliver，全程无 self_review、无 v2（M1 是 v1→QA→v2→交付）。
- 质量探针：30/30 literals 命中；citation_found 10/10 为 false，但产物 HTML 有 15 个 `<div class="cite">`（"Source: BofA Q3-21 earnings release, page 1 …"），manifest 要求的是字面 "Source page 1"——探针按字面串匹配、产物写法不同 ⇒ 与 M1 同型的探针假阴性，非真实质量回退。质量不低于 B3-2 的副指标成立（待人工确认 15 页内容质量）。
- 词表修复（d25f0cde）功能上生效（"Action receipt types this runtime records"两次进入模型上下文、离线 42/42），行为上被"空设计过门"完全绕开：环2 动作轴单独修复对行为零效应——第二次独立证实主断点在环1/环3（矛盾告知 + 惰性自状态推送），而非词表。

### 14.2 逐环断点（告知 → T0 设计 → T1 触发 → 变更 → 回流）

**环1 告知——三处失真（均实现缺陷）：**

1. 常驻系统提示是 B 系文案。evo 分支按 `ppt_demo_extension.ts:97` 原样播种 `self_root_system.md`：第 11 段 "the host opens evolution reviews at work boundaries"、第 13 段整段 FIXED REVIEW ENTRANCE，而 META 关闭了全部宿主触发（self_root.ts:1184/:1199/:1201 三处 `!this.mech.meta`）。38/38 个请求里这两段与 META_STRATEGY（"opens no review of its own"）同场直接矛盾——agent"等宿主开审"是对常驻文本的理性解读，而该审永不会来。
2. 四层视图只剩一句。设计 §3.1 的四层对象清单在 META_T0_MATERIAL 里只有 :143 一句；设计问题不按对象分层，l4 关闭时视图无层标注。
3. 错误信息的本体论失真。`live_orchestration_core.ts:81` 规定 transition 只能绑 `decision|action`——事件轴根本不存在；驳回文案却写 "'unit_done' is not an event type"，暗示存在一个没猜中的合法事件词表。M1 期动作词表同样无处可查（d25f0cde 已修动作轴）。

**环2 T0 门——存在性门 × 空壳吸引子：**

- （设计内赌注）门只验"存在一次合法 reflect_orchestration"，:149 明文 seed 等价改写也接受；宿主不评判产物是否含进化环。
- （实现缺陷）schema 的 example 本身就是空壳（:157）。门不评判 × example 即空壳 ⇒ 过门的最低风险通道就是抄 example。M1（真设计 → 驳回烫伤 → 改形不改词 → 静默死绑定）与 M2（直接种子同构）是同一扇门下的两条失败路径。
- 机械补全的承诺与实现错位（系统提示第 7 段 vs self_root.ts:272-281）：补全引擎唯一的词表是"决策输出属性"（:272-275）；对错词只能 ask-back（:276），教"形"不教"词"；:281 还把 agent 自造的 `on.action` 原样填进 `requires`，把错误词表机械放大成结构。校验严格度与可观察性倒挂：事件轴严（驳回可见），动作轴松（静默致死）。

**环3 T1 触发——结构性为零：**

- META 删除了 B3-2 被证实有效的全部推送机制（固定入口 + 三问 + 强制逐条回应，B3-2 15/15 闭合且逐字引用 A4 事实），赌 agent 自建节奏；而 T0 门又不要求产物含任何自观察结构——两个赌注互相拆台。副作用：EVO_A4=1 在 META 下是死重，entranceAskBlock/[inventory]/[recurrence] 只在评审入口送达，META 永不开审 ⇒ 0 次送达。
- （用户点名问题的核对结果——此处更正前一版分析的事实错误）M2 的 24 个请求体**都**携带运行时自状态：`ACTIVE ORCHESTRATION {"revision":1,"step":"work","definition":{"id":"work","role":"agent"}}`（ppt_demo_extension.ts:711，只序列化**当前步**定义）、volatile self view `{root_id,revision:2,mode,step,in_review:false,pending,resources,observation:"facts: N requests (execute N); rejections 1"}`（:698-703）与 SELF ROOT 行。前一版 grep 漏检是因为日志双重转义，且推送里没有 SELF VIEW/THIS BOARD 这些字样。**正确结论：推送存在、且随请求递增（0→12 requests），但信息上惰性——**
  1. 编排只显示当前步；`transitions:[]` 这个"设计空隙"在请求里不可见，缺失即不可知。
  2. observation digest 只有运行计数（请求数、驳回数），没有一条与 agent 自身设计相关的摩擦/变更事实，也没有"自上次自我修订以来发生了什么"的差分。
  3. 同一段重复 24 次不变（revision 1/step work 全程恒定），符合 copy-attractor 规律：不变的尾部不产生行为。系统提示第 3 段 "shown automatically in each request" 字面兑现，但"把运行视图对象纳入 loop"的实质要求（让可优化对象在自面向视图中可辨识、可触发）未兑现。agent 两次运行 read_self 0 次仍是事实，但那只说明拉取也没发生，不能反推推送为零。

**环4 变更执行——机制可用，无水到此。** T0 已证明写入与原子激活正常；T0 后 0 次调用是上游（环1-3）断流的结果。

**环5 回流——META 下三重闭锁（实现缺陷为主）：**

1. 开窗以 `evolution = this.inEvolutionReview` 为门（self_root.ts:827 → :854）：只有评审内写入才建窗。META 永不开审 ⇒ 任何声明（expected_effect/success_predicate）都结构性开不了窗——系统提示第 17 段与 reflect schema 的 "declaring one opens a validation window" 在 META 下为假。M1 的 0 窗口是结构必然。
2. 即使开窗：due 规则 `after_use` 要求改动被使用；死环改动永不被使用 ⇒ 永不判定。
3. 即使判定："Due windows do not open reviews by themselves" + META 无评审 ⇒ 结果无入口可见。

### 14.3 递进结构（用户判定的机理版）

meta loop 的四处失真（矛盾常驻文案、一句话四层、空壳 example、不评判门）让"设计你的进化环"在 glm-5.3-flash 上退化为"设计你的工作排程"（M1）或"抄例过门"（M2）；T0 产物不含自观察结构之后，T1 的一切自面向递送（入口、三问、窗口）都已被 META 从宿主侧摘除、且全部锚定在"评审"这个被摘除的概念上 ⇒ 自进化 loop 退化为冲突事实的被动落账；回流环结构性关死。一句话：**设计说"宿主摘除自己的节奏、把节奏还给 agent"；实现是"宿主摘除了节奏，但所有自面向递送仍锚在被摘除的节奏上"——T0 材料消失后，agent 收到的自面向推送只剩一张静态壁纸（不变的编排当前步 + 纯计数 digest），没有一个可辨识、可触发的自我优化对象。**

对照 §1 预注册的推翻条件：kernel=0 本应指向"范式证伪、收敛 H3/H4"，但本节证明实现违背了设计自己的前提（材料厚度、节奏归属、回流可达、无矛盾告知），证伪不能干净触发；当前证据只支持"此实现证伪"，范式判定延至一个忠实实现之后。

### 14.4 修复方向（按决策权分列）

实现缺陷（可直接修，仍按一次一个主因素）：

- a. META 运行播种 META 版系统提示：改写/删除 self_root_system.md §11、§13 两段 B 系文案（ppt_demo_extension.ts:97 处按 manifest 分支）。
- b. example 改为最小真环：含一条绑定已声明收据类型的 transition（通用结构、无任务词）。
- c. 自状态推送去壁纸化：推送已在（:698-703/:711），改为携带**可优化对象本身**——完整编排形状（roles/slots/steps/transitions 全量，空 transitions 显式出现）、自上次自我修订以来的差分（requests since last reflect、被拒操作的原文与次数、上一条 expected_effect 的当前状态）。事实不解读，与"收据 changed cells"同一原则。
- d. META 下开窗门改为不依赖 inEvolutionReview，兑现"声明即开窗"；due 判定与结果送达给出不依赖评审的路径。
- e. 驳回文案与真实词表对齐：删除 "event type" 误导，列出合法形（decision/action）与已声明动作词表（后者已修）。

设计内赌注（忠实实现但联合失败；改动需用户定夺，涉及"宿主不评判"红线边界）：

- f. T0 门是否加机械结构要求（如：编排须含 ≥1 条引用已声明收据类型的 transition，或含一个自观察步）——机械可验、不涉内容评判，但改变 ":149 seed 等价也接受" 的现约定。
- g. META 下是否保留最低频宿主保底入口（与"宿主不开审"原则冲突）。
- h. T0 材料加厚上限：四层对象清单 + 每层一个无任务词的结构示例，厚到哪里算"指导范围"、哪里越界成"替 agent 设计"。

### 14.5 下一步

- M2 已按 §13 判据结账：kernel 0/1，主指标未达；无晚期自发修订（T0 后 reflect_* 为 0）。副指标：30/30 literals，引用探针 0/10 为假阴性（产物 15 处 cite 文本存在），质量未见回退。系列预算已用 M1 40 + M2 25（含预检）= 65/600，余 535（429 槽计入请求口径，是否维持请用户确认）。
- M3 建议：有效性修复 a（META 版系统提示，去除 ¶11/¶13 与 META_STRATEGY 的矛盾——这是 arm validity 修复，不算实验因素）+ 单主因素 **c'（自状态推送去壁纸化：完整编排形状 + 自上次修订以来差分 + 上一条 expected_effect 状态，兑现"运行视图对象可辨识"）**，直接对应用户点名的"运行视图对象未纳入 loop"；b/d 列为备选，f–h 设计内赌注留给用户决定。预算仍在同一 600 授权内，启动前按规则申报本次上限。
- **M3b 计划（2026-11-16 更新，冻结于 `08822735`）**：M4 之后运行面未再改动；M3b 从该提交起跑（§14.8 的记录另提交，只增文档，不改运行时）。预算口径更新：M1 40 + M2 25 + M3 46 = 111/600，余 489；本轮开发 0 请求。M3b 启动前仍需用户单独声明本次 token 上限（这不是开发侧能拍板的事）。M3b 必须回答的判据问题：
  1. **T0 递进**：`meta_t0_design` 记录的编排是否含 ≥1 条 transition（门已强制），且该编排是否包含一个自观察结构（绑定 `self.change` 的 transition 或引用它的 decision），而不是纯工作排程？
  2. **环是否转**：T1 是否出现 `self.change` 收据；agent 自己写的 transition 是否被该收据推进（`reflection_activated.self_change.transition.status`）？
  3. **视图是否被消费**：是否有 decision 以 `self.change` 收据为 evidence（`evidenceRefs` 含该 ref）；若没有，agent 是否在收到首条收据后修订了结构（首条收据之后出现 `reflection_activated`）？
  4. **kernel 主指标**：T0 之后的 agent 发起结构变更，是否在后续任务段生效并被使用（定义不变；T0 首版不计，修订计入）。
  5. **负例可判读**：若 1–4 全为 0，记录必须能区分"call point 未出现"（agent 从未写绑定）与"有而不选"（写了但未用）——这是退役/重设计判据（§14.8 问题 2 的退役条件），不是任务分。

### 14.6 M3 实现（2026-11-16，提交 `e780fc55`）

只做 a + c'，零新层、零新常驻义务：一个提示文件、一个 SelfRoot 方法、两处调用点、一个 mech 分支。

- a（arm validity）：新增 `demo/prompts/self_root_meta_system.md`，与 `self_root_system.md` 逐段相同，只替换三段——¶11（"宿主在工作边界开进化评审"→"本运行没有宿主开的评审入口；宿主把每段的过程与交付质量事实机械记账进你读的同一本 ledger"）、¶13（"FIXED REVIEW ENTRANCE"整段→"SELF-STATE MATERIAL"，描述每请求实际推送的自我事实与 read_self 的全量读取，明示"宿主不排名、不诊断、不建议、不排顺序；判断在你"）、¶17（"验证窗口"承诺→"本运行不开窗：声明随激活记录、经 read_self 可读，直到你修订"）。`ppt_demo_extension.ts:97` 按 `EVO_MECH.meta` 选择提示文件；B 臂的 `self_root_system.md` 一字未动。
  - 为什么这算 arm validity 而非实验因素：M1/M2 的常驻文案承诺了一个 META 已从宿主侧摘除的入口，agent 被告知要等一个永不到来的边界。修它只是让告知与实现一致，不引入任何新推送。
- c'（单主因素，去壁纸化）：`SelfRoot.selfChangeDigest()`（`demo/self_root.ts:690`），随 `self_state` 键进入每请求尾部（`ppt_demo_extension.ts:702`），携带——
  - `self_changes` / `last_change`：自我变更的次数与上一条（类型、revision、request、addresses、expected_effect、success_predicates）；
  - `requests_since_change`：距上次自我变更的请求数（差分，而非总量）；
  - `refused_self_operations`：自上次变更以来被拒的 reflect 操作，按工具聚合次数并保留最后一条错误原文（400 字符）；
  - `validation_windows`：窗口列表**含空列表**——零计数类别显式出现，不留给 agent 推断。
  - 同一请求的 `ACTIVE ORCHESTRATION` 从"当前步"改为完整对象 `{revision, step, orchestration}`（`:711`）：空的 `transitions` / `decisions` 从此是可见事实，而不是要靠推断的缺失。
  - 事实不解读：无排名、无诊断、无建议、无顺序；与"收据只报 changed cells"同一原则。

离线证据（本机 node 25.5.0，无 provider）：

- `tests/self_root_meta.test.ts` 8/8（新增 2 条：self-state 推送的形状/差分/被拒聚合/空窗口列表；META 提示不含宿主评审入口且 B 臂提示仍含）。self-root 面全套 33/33，无回归。
- `test_evo_ppt_pi.py`(3) / `test_evo_ppt_stall_recovery.py`(3) 的失败为 §11 记载的第 2 层陈旧 runner 断言，改动前后计数一致；两处改动文件的 `node --experimental-transform-types --check` 干净。
- 未覆盖：c' 的实际阅读率与是否改变 agent 动作，只有真实运行可测——这正是 M3 要测的。

### 14.7 M3 终局：自锁与两处机制矛盾（2026-11-16，运行 `runs/evo-m3-glm53f-meta-20261116`，已 kill）

M3 在请求 46 处停止（人为 kill，非自然结束）。结果不是"agent 未自发修订"的重复，而是**机制把 agent 关在了自己的编排里**：它在 T0 设计的编排，恰好把自己此后所有的工作与修订入口全部拒绝掉。

**测量（全部取自运行产物）**

- 45 条 provider 请求：input 264,074 / output 9,366 / cacheRead 77,312；provider 报告 $0.0443（`conservative_usd` 合计 6.46 是上界估计，非实际支出）；最后一条 `stopReason: error`。
- ledger 266 行：`tool_failed` 49、`transaction_failed` 12、`reflection_activated` 2、`meta_t0_design` 1、`segment_summary` 6。
- **39 条 tool result 携带 "not allowed by active step"**：`read` ~15、`reflect_orchestration` 7、`read_self` 2、`decide` 2、`ls` 1、`python` 1、`write` 1。
- 6 条 `segment_summary`（覆盖请求 [1,12][13,22][23,26][27,30][31,41][42,44]）**全部 `work.task_actions: 0`，逐工具 `calls: 0` 且 errors ≥ 1**——整场没有执行过任何一个任务动作。
- agent 在请求 [3] 经 T0 门写下 revision 2（`expected_effect: "Single-agent work loop; reading sources and composing the 15-slide deck, rendering, delivering."`），编排原文：`steps: [{ id: "work", role: "agent", actions: ["office.look","office.render","office.deliver","submit_unit"] }]`，`transitions: [{ id: "work-loop", on: {type: "action", action: "office.render"}, requires: [{type:"office.render"}], to: "work" }]`，`decisions: []`。

**根因：两处机制矛盾叠成自锁**

0. 前置：请求 1–2 两次 `transaction_failed` 是形状错误，不是门禁——agent 写的是 `on: {"action": "office.look"}`（把属性名当成了事件类型键），驳回文案已列出合法形，第 3 次即以 `on:{type:"action",action:"office.render"}` 通过。两次被拒的载荷里 `steps[0].actions` 已经是那四个收据类型——窄化在成文之前就已存在，但**只有 revision 2 提交后白名单才生效**，所以它没有被当作错误暴露，而是一直躺在提交下来的合法定义里。
1. `validateDefinition()` 把 `step.actions` 限制为**已记录收据类型**（`office.look/render/deliver` 是，`read/write/ls/grep/python` 不是）——但同一个 `step.actions` 又是 `assertActionAllowed()` 对**每一次工具调用**的唯一白名单。于是一个合法的、意图正确的窄化编排，把读源码、写 python、改编排本来需要的工具全部关在门外。逐条原文可见：`[4] {"tool":"read","args":{"path":"data/instructions.md"},"error":"Error: action read is not allowed by active step work"}`。
2. `reflect_orchestration` 自己也走同一道门（`[6][8][10][13][20][21][33][36][40][42]` 十次 `"action reflect_orchestration is not allowed by active step work"`, `"status": "entire response chain aborted"`）。于是修订入口与工作入口同时被同一条规则关闭——**自锁不可恢复**，agent 在 39 次拒绝里反复重试同样的读取与反射，直到请求预算耗尽。这不是 agent 的失误：它在 T0 收到的 schema 明确说 `actions` 是"这一可用的动作列表"，而当时 runtime 实际记录的动作类型里确实只有那几类收据。

**第二处矛盾（观测盲区）**：`abortTransaction` 只记 `transaction_failed`，反射被拒时**不携带工具名**；c' 新增的 `refused_self_operations` 看不到任何一条记录。也就是说 M3 想测的"自状态推送是否让 agent 看见被拒操作"，在自己的主失败模式上恰好是空的。

**修复（提交 `295abb23`，连同本节一起落库）**

- `SelfRoot.assertActionAllowed`：`PROTOCOL`（`read_self` / `read_self_component` / `reflect_component` / `reflect_orchestration` / `decide` / `decide_exit` / `decide_validation`）**永不被步骤白名单约束**——协议面是一个可被它自己修订的对象所不能门控的东西；`surface()` 每请求照常广告 PROTOCOL。
- `step.actions` 语义改为**工具名权限范围**：可列 surface 广告的任何工具，缺省 = 放行全部；`assertKnownAction` 不再施加于它（保留于 transition `on.action`/`requires` 与 decision `evidence`——那里的错拼会静默永不触发）。`metaT0()` 的 schema 说明与系统提示同步改口径。
- 反射被拒分支调 `abortTransaction(error, tool.name)`，记一条携带工具名的 `tool_failed` 事实；digest 的 `last_error` 读 `error ?? content`。`refused_self_operations` 从此在真实失败路径上有内容。
- 测试：`tests/self_root_meta.test.ts` 新增 2 条（窄白名单不锁协议面；被拒反射计入 refused 并带工具名与错误原文），10/10；`tests/live_orchestration_known_actions.test.ts` 删除已不成立的 stepBound 断言，保留 transition/decision 断言与"无部分提交"断言。受影响 node 套件 45/45。

**对方案的含义**

- §4 T1 的原表述"执行器按 activeStep 校验动作白名单"在语义上是自指的：一个可修订对象如果同时门控修订动作本身，可修订性就不是真实属性。T1 的可执行结构现在要求**协议面在门之外**——已回写 §4。
- 这不改变 M 系列的判据，但改变了 M3b 的解释框架：如果 M3b 仍然 kernel 0/1，失败不再能归因于"白名单锁死"，而是真正回到"agent 是否自发修订"这一待测问题上。
- 关于 c'：M3 没有提供关于 c' 的证据（agent 从未到达能读 digest 的状态）。c' 是否改变动作仍未被测。

### 14.8 M4 实现：四个点名问题的落点（2026-11-16，提交 `08822735`）

用户授权为"解决这四个问题"，覆盖设计赌注 f（T0 门改成机械结构要求）与 h（四层材料的加厚尺度）；"宿主不评判"红线未越：所有新增内容只报事实、不排名、不诊断、不建议，agent 决定是否使用。本轮不发起付费运行：M 系列已用约 111/600（M1 40 + M2 25 + M3 46），本轮新增 provider 请求 0。问题 4①（常驻提示承诺宿主开审）已由 `e780fc55` 修复，本节不重做；下面按问题逐项登记，并对应 §14.4 的类别。

**问题 1：T0 交接无递进（类别 f，用户已授权）**

- 改了什么：`noteMetaDesign()` 对 `status === 'no_change'` 直接返回（`demo/self_root.ts:777`）——seed 等价重写不再落 `meta_t0_design`，门不打开；`prepareTransaction()` 在确定性编译之后要求 `transitions.length >= 1`（`:875-877`），否则 `operationError` 的 correction 写明合法形与本运行记录的收据类型，并明说"a loop with no transition cannot turn, and a write equivalent to the seed does not open the gate"；T0 材料末行同步（`META_T0_MATERIAL`，`:154`）。
- 为什么选它：门只验"存在一次 reflect_orchestration"无法区分设计与种子重写，T0→T1 因而没有产物。"至少一条 transition"是纯结构、可由 runtime 机械验证、不涉内容评判；绑定对象仍由 agent 完全选择（可以是它自己的 decision）。没有选"必须含自观察步或 self.change 绑定"：那会把"进化环长什么样"替 agent 决定，越过服务/agent 边界；要求停在"能转"这一最小机械条件。
- 如何进入 loop：门在 transaction 处由宿主机械检查；被拒时 correction 作为该响应的 tool result 回到 agent 同一响应链；材料在门关闭期间每请求推送、只记一次 `meta_t0_delivered`。
- 替代了什么工作：此前 T0 可以零产物通过，T1 直接开始任务且没有可执行结构可看；现在 T0 必须交出一个能转的环，T1 的每次收据都可能推动它。
- 下一真实运行如何反馈 / 何时退役：看 `meta_t0_design` 的编排形状（transition 数、`on` 绑定类型、是否引用 `self.change`）与首个 T1 段是否推进；首版设计成立后门即退役（`metaT0Pending` 转 false），不常驻。
- 证据：`tests/self_root_meta.test.ts` "a seed-equivalent write leaves the gate closed; a design with a transition opens it"（离线功能与接线）。未验证：真实 provider 下 agent 是否写得出一条真 transition、会不会在 T0 反复被拒而耗尽预算（M3b 判据问题 1）。

**问题 2：进化环缺失（新机制，属设计赌注，需用户确认）**

- 改了什么：META 在构造器把 `self.change` 并入 runtime 记录的 action receipt 类型（`:560-564`，与 adapter 声明的任务收据并列）；每次 T0 设计之后的激活在 `metaSelfChange()`（`:989-1000`）里调用 `recordAction('self.change', {revision, addresses, ...selfChangeDigest(prior)}, false, hostDeferred=true)`，返回 `{ref, transition}` 写进 `reflection_activated` 的 `self_change` 字段（`:1021-1026`）。`hostDeferred=true` 只跳过步骤白名单检查——这条收据是宿主自己记的，不是 agent 的工具调用。
- 为什么选它：这是 kernel 判据的结构载体——"agent 发起的结构变化在后续段生效并被使用"。收据由宿主在激活时机械产生（事实，不评判）；agent 是否把它接进自己的环，由 agent 写不写 `on:{type:"action",action:"self.change"}` 的 transition 决定。服务提供接口与执行，agent 持有决定权。首个激活（T0 设计本身）是环的存在条件、不是环的一周，不记收据；对照臂完全不记。
- 如何进入 loop：收据进 `actions`，`advanceAction()` 在激活的同一请求内匹配 `from === activeStep && on.action === 'self.change'` 并推进 step；推进后的 step 出现在下一请求的完整编排推送里。若 agent 写 decision `requires:[{type:"self.change"}]`，它可按 digest 显示的 ref 引用该收据作为证据——`decide()` 接受即 kernel 意义上的"使用"。
- 替代了什么工作：此前"自变更"只有内部的 `reflection_activated` 行，agent 无法在自己的编排里引用它；自状态推送是只读壁纸（M1–M3 `read_self` 调用 = 0）。
- 退役条件（无悬挂工件）：它现在有 call point（T0 材料与系统提示明确说明，`self.change` 在可记录类型清单里）、有被替代的工作（重读 self 来比较）、有反馈（transition advanced / decision accepted 落 ledger）。若 M3b 全程无任何 transition 或 decision 消费该收据，运行记录必须能区分"未接"与"有而不选"；连续两轮零使用则移除或重设计，不叠新层。
- 证据：`tests/self_root_meta.test.ts` "an activation after the design books the self state as a receipt the loop turns on"（T0 不记；第二次激活记 1 条、`facts.addresses` 正确、step 推进、decision 引用被接受、B 臂 0 条）。未验证：真实 agent 会不会自发写这条 transition/decision——离线不可证。

**问题 3：视图对象无消费者（与问题 2 同一机制的另一半）**

- 改了什么：`selfChangeDigest()` 增 `last_self_change {ref, revision, transition}`（`:730-739`），指向最近一次激活收据；系统提示 ¶13 与 T0 材料说明"decision 可引用视图里显示的 ref"。
- 为什么选它：c' 只解决了"可见"；素材没有地址就没有消费者。给视图一个稳定 ref，使"读视图"退化为"引用一个收据"——agent 不必再调 `read_self` 重述自身状态；消费（`decide` 的 evidenceRefs 或 transition 推进）由 runtime 记账。
- 如何进入 loop：每请求尾部 `self_state` 推送（既有 c' 路径，见 §14.6）→ digest 显示 ref → agent 写 transition/decision → 激活或 decide 的结果落 ledger。
- 替代了什么工作：`read_self` 全量重读（连续三轮为 0，说明这条路径本来就没被用）。
- 退役条件：与问题 2 同一判据（被引用次数、transition advanced 次数、decision accepted）。若 `last_self_change` 长期为 null（无激活）或 ref 零引用，机制降级为纯事实推送，按无悬挂工件标准记录并考虑移除。
- 证据：同问题 2 的测试覆盖 ref 与 decision 引用。未验证：agent 是否愿意用 ref 而非重读——只有真实运行可测。

**问题 4②：四层材料厚度（类别 h，用户授权了"加厚尺度"）**

- 改了什么：`META_T0_MATERIAL`（`:141-155`）从"一句话四层"改为四层各给一个可写对象与接口（prompt / context / loop / harness）；`orchestrationSchema` 的 example 从空壳改为最小真环（一条绑定 `self.change` 的 transition），`transitions` 增 schema description（`:158-166`）。
- 为什么选这个尺度：只列"存在什么、在哪写"，不给任务词、不给诊断、不给策略；示例是通用结构。它停在 §14.4 h 的"指导范围"一侧，不替 agent 设计。
- 证据：`tests/self_root_meta.test.ts` 断言四层行、`self.change` 与 gate 语句；`tests/live_orchestration_known_actions.test.ts` 断言 META 材料把 `self.change` 列在可记录集合里。未验证：厚度是否足够让 T0 产物真的引用这些对象——只有真实运行看得到。

**问题 4③：驳回文案与词表对齐（类别 e）**

- 改了什么：`compileOrchestrationIntent(def, knownActions?)`（`:262` 起）——缺 `on` 的回复列出合法事件形（action/decision）与本运行记录的收据类型；单键 `on` 的回复给 decision 的 output 属性；`requires` 只在名字属于记录集合时自动补全，否则一问返回、原文保留，不再把 agent 的错误词放大成 `requires`；删除"not an event type"措辞。
- 证据：`tests/live_orchestration_known_actions.test.ts`（`bare` fixture 触发一问并列出 recordable set；非 META 臂保持旧接受）。未验证：真实 provider 下首次即过率是否上升（M3 的 45 请求里前两次是形状错误）。

**类别 d / g：未实现，明确留白**

- d（META 下不依赖 `inEvolutionReview` 的开窗）：未动；系统提示仍写"本运行不开窗"。若 M3b 后要测"声明即开窗"，它是新实验因素，需用户另行授权并相应改告知。
- g（宿主保底入口）：未动，与"宿主不开审"冲突，需用户决定，不在本轮擅自实现。

**证据边界（总）**

- 本轮全部为离线证据：`node --experimental-transform-types --test --test-concurrency=1`。受影响两文件 16/16；7 文件相关套件 30/33，3 个失败均为已登记预存失败（`rootObject` 投影键、`reflective_evolution` 两条 native compute；见 `docs/plans/2026-11-15-evo-mechanisms-implementation.md` 与 `docs/reports/ANALYSIS-v1.md:36`），且这三个测试文件不 import `demo/self_root.ts`，与本次改动无关。
- 未发起任何 provider 请求；M 系列预算不变。
- 不可离线证明的核心问题不变：**agent 会不会自发修订、会不会把这些对象接进它自己的环**。M3b 的判据问题见 §14.5。

