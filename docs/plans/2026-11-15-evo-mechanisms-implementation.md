# Meta-harness 变更记录：evo-daemon 自进化机制 M-A/M-B/M-C 与义务收口（v1.5）

日期：2026-11-15（Asia/Shanghai）。状态：实现（免费验证完成，付费评估运行待发射）。

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
| 全链路可达 | 未验证 | az / glm-5.3-flash | 待 B2 运行：事实进入 head、编译回显、窗口回流 |
| 自主采用 | 未验证 | az / glm-5.3-flash | 待 B2 运行：agent 引用观测事实、用 append/patch、声明效果 |
| 净收益 | 未验证 | az / glm-5.3-flash | 待 B2 vs B1：拒绝数、重写 token、评审轮、总成本、任务结果 |

## 交付决定

- 已支持：机制功能与接线（本地测试 + 重放）。未支持：provider 行为、自主采用、净收益——B2 运行后按上表逐层补。
- 决定：提交实现，按用户授权发射 B2（预算如上），观察并按 debug 流程迭代。
- 下一可证伪检查：B2 ledger 中 (a) 接线载荷激活数/具体问题数对 B1 的 7 拒绝；(b) append/patch 与 no_change 的出现及占比；(c) 窗口数=声明数且 expected_effect 非空；(d) review_suppressed 在交付挂起期出现且 force_review 仍可开；(e) 至少一次被采用修改的 evidence_refs 引用 observation 事实。任一不成立→按"定位断裂过渡、改一个主因"继续。
- 关联 backlog：B1 分析报告第 126 条（义务退出 A/B）由 legacy_obligation 开关承接，状态从"候选"变"可执行 arm"。
