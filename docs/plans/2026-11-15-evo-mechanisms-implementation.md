# Meta-harness 变更记录：evo-daemon 自进化机制 M-A/M-B/M-C 与义务收口（v1.5）

日期：2026-11-15（Asia/Shanghai）。状态：已评估——B2 运行完成（2026-11-15 凌晨），证据见"B2 运行结果"；本轮无需再改码。

- 设计稿（用户定稿）：r04 `docs/plans/2026-11-15-evo-daemon-selfharness-optimization.md`。
- 失败材料：B1 运行分析 r04 `docs/reports/2026-11-14-evo-daemon-b1-glm53f-self-harness-analysis.md`；run `D:\agent\.codex\worktrees\evo-b1-qwen38-e\autoresearch_pi_project\runs\evo-daemon-b1-glm53f-v14-a1-20261114`（engineering_commit 7f8b091b）。
- 实现分支：`evo-loop-implementation`，基线 d60995c9（"v1.4.1: test triage and standing-rule acceptance"）。
- 用户授权（逐字）：『修改完成后使用.env中的az provider，重启任务。并观察分析自进化实际表现是否符合预期。如依然存在问题，或有新问题（按照刚刚我们的debug流程分析），请按照我的设计理念和原则，进行修改并迭代，直到实际表现符合预期。』

## 问题与命题

- 真实失败（B1，glm-5.3-flash @ az，177 请求 / 10.18M tokens，口径见 final-accounting.json）：
  1. reflect_orchestration 11 次调用中 7 种接线形态全部被 schema 拒绝（validator 全量格式 dump），agent 修不动；唯一激活的是不绑定任何 step 的惰性 decision（L94）。
  2. ~74 个修订（≈82%）是同一条 memory 的全文重写（终版 v75）；prompt v1/v2/v3 同 hash 仍升版。
  3. `{"restore":1}` 一次回滚 12 个地址，连带清除无关的 policy（maxOutputTokens、memory_strategy）且未重设。
  4. 88 个验证窗口全部 `effect_unspecified`，unknowns 无一填充；到期触发 validation_due 评审，评审再产生修改——评审自馈。
  5. 第 176 个请求（office.deliver 挂起期间）又开一次评审，随任务结束未关闭；review_requests_so_far 恒 0（从未递增）。
  6. 退出义务（"合格变更才能退出"）把判定过的"无须修改"也挡回去，制造反思配额填充。
- 窄命题（同任务同模型，开关全开的集成运行）：
  - M-B：B1 中被拒的 4 类可补全接线载荷直接编译激活；3 类歧义载荷各收一个具体问题而非格式 dump（D1 重放 8/8 已证功能层）。
  - M-A：入口处的记录事实（摩擦/轨迹/结果谱系）被 agent 在至少一次被采用的修改里引用。
  - M-C：只有声明 expected_effect/success_predicate 的修改开窗；效果回流同一视图；validation_due 不再触发评审；交付挂起期无新评审。
  - 义务收口：agent 判定的无改动是合法闭合；memory 不再全文重写（append/patch 出现且占比显著）。
- 减少的负担：格式往返（7 拒绝→目标 0）、全文重写 token、空窗与自馈评审轮、强制 rework 义务文本。
- 合理不使用：载荷本就完整→编译静默通过；agent 不声明效果→不开窗（这是设计，不是失败）。
- 推翻条件：新运行中接线仍被格式拒绝≥B1 量级；memory 仍以全文重写为主；空窗/评审自馈重现；交付期评审重开；或 agent 从不引用观测事实且任务结果下降。
- 范围与非目标：只改 self_root 层与其 PPT 接线；validateDefinition 与核心 reflectComponent 未动；不做 reviewer 角色、不设配额、不挡便宜退出（host 不阻断模型的判断）。

## 设计与成本

- 四个独立机制开关 `mechanisms{observation, compiler, effect_return, legacy_obligation}`，默认 `{true, true, true, false}`；扩展侧 env `EVO_MA/EVO_MB/EVO_MC`（=0 关）与 `EVO_LEGACY_OBLIGATION`（=1 开旧义务）。首轮按用户指令是全开集成运行，**单因素归因留给后续 arm**（开关即为此预留）；记录此局限。
- M-A 观测（`demo/self_observation.ts`，服务只供事实不供结论）：三高度——A1 摩擦（按模式的请求/token、重复激活、重复输入、拒绝头、损失、停止、未用工具）、A2 轨迹（模式连程、调用、工件写入、decide 回执、激活、评审、分段）、A3 结果谱系（task_outcome 间跨度、连程序列、in_path 与 available_not_in_path）。入口：review_frame.observation（≤2400 字符）与 reviewSelfView、mirror 摘要、`read_self` 的 observation 节、非评审 pin 的一行摘要——未经请求推入既有视图，替代 agent 自己翻 ledger；下一步修改引用与否本身被记录（引用进 evidence_refs）；机制退役=关 EVO_MA。
- M-B 意图编译（`compileOrchestrationIntent`，normalize/merge 之后、validator 之前；validator 未动）：空 on→从 step 的 decision/action 推导；单键 on 匹配 decision 输出属性；空 requires→复制 decision.evidence；decision step 无出边→按步序合成过渡；歧义/末步→一个具体问题（operationError）。每次调用级 `write: append|patch`（patch 全出现替换，找不到 find 收具体问题）；相同源 redefine→`no_change` 不升版（实现在 self_root 事务循环，核心未动）；`restore_scope` 范围化回滚 + `differs_not_restored` 事实。输出入环：compiled/unchanged_skipped/restore_scope 回显在 reflection_activated 事实里，agent 下一轮直接看到补全结果。
- M-C 效果回流：窗口仅在 `requestedPredicate || expected_effect` 时开（windowDue）；expected_effect 进窗口与交付回执；evidence_refs 只含 agent 留存引用（auto_attached=[]）；到期且 agent 谓词可比时自动解释（retain/恢复事务，失败记 validation_error）；validation_due 不再入评审触发；交付挂起期评审抑制为 `review_suppressed` 事实（force_review 除外）。
- 义务收口：exit 强续正则、close 合格变更抛错、must_change_self/rework_path、mirror 义务文本全部移到 `legacy_obligation` 之后；默认策略文本 FIXED_REVIEW_STRATEGY 改为"判定无改动是合法闭合"（旧文本保留为 LEGACY_REVIEW_STRATEGY 供对照 arm）；pin() 在评审中递增 reviewRequests（修复恒 0）。
- 新增常驻：review_frame.observation 一段、pin 摘要一行；移除常驻：强制 rework 文本、空窗评审轮、到期 validation_due 触发。权限/预算/版本/环境检查全部保留（validator、FLOOR、budget、baseRevision 冲突检测未动）。
- 放弃与恢复：任一机制负收益→对应 env 开关关掉即回旧行为；无热修语义变化（reflect→bind→下一边界逐字保留）。

## 运行前实验协议

- 目标证据层级：功能正确（本记录，已达）→ 全链路可达 + 自主采用 + 净收益（az 重启运行）。
- 比较器：B1（同 runner `evo_ppt.py`、同任务 bank-of-america-3q21、同模型 glm-5.3-flash @ az、旧机制 v1.4）。
- 配置：`python -m autoresearch_pi.evo_ppt --root runs/evo-daemon-b2-glm53f-v15-mabc-20261115 --registration runs/registration-glm53f.json --caps <caps.json> --authority <授权串> --run`；engineering_commit=本次提交；.env 的 OPENAI_API_BASE=https://az.gptplus5.com/v1（用户指定的 az provider，未改 .env）。
- 预算与停止（发射前声明）：镜像 B1 授权——requests 600、seconds 14400、storage 2 GiB、tokens/usd 不设上限（受请求数与时钟硬界约束；B1 实耗 177 请求 / 10.18M tokens / 保守 $1.56 @ 0.15/0.50 USD/M 注册价）。预期本次同量级（~1–2 轮任务）；达到任一 cap 或任务终态即停。
- 主要指标：任务结果（units/deliver）、reflect/execute 请求比（B1 140:36）、接线拒绝数 vs 编译激活/问题数（B1 7 拒）、memory 全文重写 vs append/patch 次数（B1 74 全写）、no_change 命中（B1 同 hash 升版 3 次）、窗口数与 expected_effect 填充（B1 88 全空）、review_suppressed 出现与交付后结清、agent 修改是否引用 observation 事实、输入/输出放大比（B1 ≈80:1）。
- 负例：编译静默通过（载荷完整）、合理不开窗（不声明效果）、agent 判定无改动闭合——都不算机制失败。
- 遥测：ledger（reflection_activated 的 compiled/unchanged_skipped/restore_scope/validation_window、review_suppressed、validation_error）、summary.json、session.jsonl、live_agent_self.jsonl——均为既有工件，新增字段已入 ledger 事实。

## 实现与验证

- 改动入口：`demo/self_root.ts`（契约 schema、编译、hash 门、范围回滚、窗口门、证据、抑制、策略切换、pin 递增）、`demo/self_observation.ts`（新）、`demo/ppt_demo_extension.ts`（EVO_MECH 接线、reflect_component schema 的 write/patch、selfView/coreLine）、`demo/self_root_ppt.ts`（read_self 描述）、`demo/prompts/self_root_system.md`（最终语义重写，义务句移除）。
- 功能/回归检查（免费，`node --experimental-transform-types --test --test-concurrency=1 --test-force-exit`）：
  - 改动面测试：tests/self_root.test.ts 26 通过；self_root_heartbeat 5 通过；self_root_v141 2 通过（legacy arm 走 `mechanisms:{legacy_obligation:true}`）；tests/self_root_evo_mechanisms.test.ts（新，8 项=每机制一正一反）8 通过。合计 41/41。
  - 预存失败平齐（基线=未改动 d60995c9 临时 worktree，`tmp/claude-d0/baseline_tests.log`）：ppt_demo/ppt_demo_live_orchestration/ppt_trials/reflective_evolution 四文件基线 21 tests、9 pass、12 fail；改动树同三文件 10 个失败逐名逐因一致（Missing expected rejection ×2、reflection_rejected deepEqual、ACTIVE PROCESS/five-skill/new-method 正则、free-hands 4!==3、rootObject、trial_probe），reflective_evolution 改动树复跑记录于 `tmp/claude-d0/changed_reflective.log`。**无新增失败**；12 个预存失败是 v1.4 实现者遗留（见 B1 round-plan.json known_risk），不在本次范围。
- 开发测量（非采用证据，AGENTS.md 口径）：D0/D0b 观测重放、D1 编译重放 8/8（B1 的 7 个被拒载荷 + 激活对照：L23/L27/L119/L128 编译激活，L20/L29/L117 各一个具体问题，L94 不变）——脚本 `tmp/claude-d0/{replay,d0b_observe,d1_compiler}.mjs`，发射后归档于运行根 `engineering-replays/`。
- 机会漏斗与断点：机会分母=B1 的 6 类缺陷；识别/投入/装配已完成（本记录）；语义使用与反馈属于付费运行层级，未验证。
- 协议偏离：首轮为全开集成运行（用户指令"重启任务"），三机制与义务收口的效应不可分；分离留给开关 arm。测试侧 3 个义务断言按设计改写为 legacy/default 双臂（self_root.test.ts:162、v141 两项），不是回归。

| 证据层级 | 状态 | Provider / environment | 产物及结论边界 |
| --- | --- | --- | --- |
| 功能正确 | 已验证 | 本地 node --test（无 provider） | 41/41 新测 + 基线失败平齐；D1 重放 8/8 |
| 全链路可达 | 已验证 | az / glm-5.3-flash（B2） | 观测入 head（ledger:100）→ 编译激活（ledger:104/108）→ 效果窗口与交付回执（ledger:181）→ 关闭引用观测；全程 0 格式拒绝 |
| 自主采用 | 已验证（n=1 最小） | az / glm-5.3-flash（B2） | agent 引用观测事实做出 1 次定向自改并声明效果，效果实测成立；并以观测的重复计数自停 decide_validation；append/patch、no_change、歧义提问在本运行无触发场景，运行层仍未验证 |
| 净收益 | 初步支持（n=1） | az / glm-5.3-flash（B2 vs B1） | 任务结果持平（10/10 units）下 tokens −83%、请求 −61%、墙钟 −72%、自修订 91→2；集成运行，无逐机制归因 |

## B2 运行结果（az / glm-5.3-flash，2026-11-15）

Run 根：`D:\agent\.codex\worktrees\evo-loop-impl\autoresearch_pi_project\runs\evo-daemon-b2-glm53f-v15-mabc-20261115`（root_id c4441de8，engineering_commit f1efed79，preflight available）。2026-11-14 20:07–20:28 UTC，stop=delivered。主要工件：`.harness/live-self.json`（ledger）、`harness/model-usage.jsonl`、`harness/daemon.json`、启动日志末尾的最终结果 JSON。

- 总量对照（同任务 bank-of-america-3q21、同模型、同 caps 授权；B1=v1.4 比较器）：

| 指标 | B1（v1.4） | B2（v1.5） |
| --- | --- | --- |
| 请求（模型+preflight） | 176+1 | 68+1 |
| tokens | 10,181,956 | 1,746,255（17.1%；input 1,614,889 / output 35,796 / cache_read 95,552） |
| 墙钟 | ≈4494 s | 1271.6 s |
| USD @注册价 0.15/0.50 | ≈1.56 | 0.2601 |
| 任务结果 | 10/10 units delivered | 10/10 units delivered（终检 30 字面量 29 found + 10/10 引文，见残余摩擦 3） |
| reflect:execute 请求 | ≈140:36 | 36:32 |
| 评审 | 22 轮 | 15 入口 / 14 关闭（1 activated + 13 判定无改动；多数入口≈2 请求） |
| 自修订 | 91（≈74 次 memory 全文重写） | 2（1 次定向 policy 变更） |
| 接线 schema 拒绝 | 7 | 0 |
| 验证窗口 | 88 个全空 | 1 个（声明 expected_effect） |
| 回滚损失 | 12 地址连带清除 | 0（无 restore 发生） |

- 逐机制（ledger 引用均在 run 根 `.harness/live-self.json`）：
  - **M-A 可达且被采用**：首个 review_frame（ledger:100，请求 15）的三高度观测含 `[loss] output_cut: request 13`（model-usage 第 13 请求 stopReason=length、output=8192）；agent 据此做出全场唯一自改——policy.request maxOutputTokens 8192→32768（reflection_activated ledger:104/108，请求 16，声明 expected_effect）；此后所有大段写入（最大 output 3,032）零 length 停止，声明效果在实测里成立；14 次关闭理由全部引用该损失与修复。观测的重复计数还让 agent 自停了 decide_validation 的 7→9 次重复（关闭文本："a self-loop on a provisional window… I stop repeating it"）——观测事实两次改变了下一步动作，采用链闭合。
  - **M-B**：全程 0 格式拒绝（B1=7）；唯一接线一次编译激活。空 on/requires 补全、歧义提问、append/patch、no_change 去重在本运行没有触发场景（agent 未写 memory、未重复定义）——这些路径仍只有单测证据。
  - **M-C**：唯一窗口由声明效果开出；validation_delivered（ledger:181，请求 27）如实报缺比对指标——根因是 agent 把谓词绑在它后来未采用的文件名 `artifacts/bac-q3-2021.html`（实际工件 `artifacts/deck.html`），窗口因此始终 provisional，14 次关闭都如实列于 undecided_windows；validation_due 全程未触发任何评审（第二次评审触发源=booked_facts）；空窗 0。
  - **义务收口**：13 次"判定无改动"闭合全部被接受，无 must_change_self/强制 rework 出现；请求 68 的入口由 requested_review 触发——B1 的 review_requests_so_far 恒 0 已修复；该入口随 stop=delivered 未关闭（交付已完成，无损失）。交付挂起期无评审重开；review_suppressed 全程未出现（交付在最后一个请求窗口内完成，抑制路径没有到场机会）——该路径仍只有单测证据。
- 残余摩擦与判定（按 debug 流程核对，均不构成断裂过渡，本轮不改码）：
  1. decide_validation 在评审 2（请求 27–32）重复 7→9 次才自停，≈5 个请求（7%）。根因是上条 agent 自写谓词失配；机制如实拒绝杜撰判定，agent 最终用观测自停——符合"服务供事实、判断归 agent"。候选（未做）：给 agent 一个改绑/退休自写谓词的调用点。
  2. 15 个入口中 10 个来自冻结的 v1.4 契约触发 `contract:unit_completed`（每 unit 一次）；这是比较器自身设计，不属本次机制；调密度是用户决定。
  3. 终检 unit-08 `$1,621` found:false 是探针字面口径：deck.html:243 以会计负号 `$(1,621)` 呈现，与材料原文 `(1,621)`（material.txt:201/381/401）一致——内容存在且正确，探针过严；不事后改探针。
  4. cache_read 仅前 15 个请求命中（95,552），之后为 0——provider 前缀缓存特性，非机制问题。输入/输出放大比 45:1（B1 ≈80:1）。
- 结论边界：单次集成运行（四组机制同开），无逐机制归因；n=1，方差未知。B1 六项命名缺陷全部按预期消失（0 拒绝、0 全文重写、0 空窗、0 评审自馈、0 交付期重开、requested_review 递增生效），任务结果持平，总成本 −83% tokens / −61% 请求 / −72% 墙钟。

## 交付决定

- 已支持：功能正确、全链路可达、最小自主采用（n=1）；净收益初步（n=1 集成运行）。未支持：逐机制归因、方差、compiler 补全/append/patch/review_suppressed 的运行层行为（无触发场景）。
- 决定（2026-11-15）：B2 实际行为符合设计命题与用户预期——B1 的六项命名缺陷全部消失、任务结果持平、成本大幅下降；未发现断裂过渡，本轮不改码；残余摩擦四项记录在案，留作后续判据。
- 下一可证伪检查：(a) n≥2 同配置重复定方差；(b) 若用户要因果分解，用机制开关做逐机制 arm；(c) 若窗口噪声在后续任务重现，加"agent 改绑/退休自写谓词"的调用点，以 decide_validation 重复次数为判据；(d) compiler 补全与 append/patch 路径需一个会写 memory/重复定义的任务形态才能到运行层；(e) review_suppressed 需交付挂起期有排队事件的任务形态。
- 关联 backlog：B1 分析报告第 126 条（义务退出 A/B）由 legacy_obligation 开关承接，状态从"候选"变"可执行 arm"。
