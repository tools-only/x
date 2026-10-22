# r04 动作效率改动计划

日期：2026-10-21  
基线：`claude/r04-20261017`，HEAD `3ff04b136fcd088b71433b168e0ea5bf3836af2a`。原 r04 工作树有未提交改动；本计划和实现均在隔离 worktree `D:/autoresearch_pi_project/worktrees/r04-eff-20261021`，分支 `claude/r04-eff-20261021`。  
问题证据：`C:/Users/qi/tmp/claude-r04-excess-actions-REPORT.md` 是只读代码推断，无本任务新运行日志或 ARC 对照。平方计分使每关约 28% 动作超支即可解释观测差异；优先验证执行路线时的探索开销、新关测试及 RESET 重放。该比例是待证伪的解释，不是已确认根因。

## 目标与不做事项

在确认机制并已有可执行路线时，减少无关探索动作；让 agent 能看到与动作计分相关的动作成本，并防止未验证批量动作放大误判。负担由 Pi 任务 Agent 承担，收益指标是每关动作数 / baseline、完成关数/分数和 RESET 后重放动作数；同时记录父子总成本与延迟。主要命题：若现有证据支持的机制及路线被运行时呈现为优先执行项，探索性 pin 不再抢占下一步；agent 会沿路线行动且每关动作/baseline 下降，不显著损害通关率。

不删除 rival、coverage、level review 或 15-step refine；只调整触发时机、优先级和成本可见度。不隐藏 RESET、不预装游戏特定内容/解法，不改变 ARC bridge 权限或单命动作边界。不移植 CH 全套循环，不改 shopping/JIT。

## 排序变更

| 优先级 | 文件 / 函数 | 现状 | 计划行为与证据 |
|---|---|---|---|
| P0-1 执行/Pin 门控 | `demo/arc_thin_extension.ts`: `setPin`, `pinned`, `pinNag`, `settlePin`, `pinDisagreement`, `pinNovelty`, `rivalEvents` 调用点及动作结果后的晋级/路线状态 | rival/coverage/disagreement/novelty/review 测试可把探索放入 strategy 首项；无执行态。 | 添加通用的“机制已确认且有路线待执行”判定/显式状态。执行态期间不新派发探索 pin、不 nag 旧探索 pin，保留并记录来源事件；主路线继续可执行。现存 pin 到期/关卡结束时可正常清理。机制不成立、路线完成/失效或出现反证时恢复探索。小 helper 可单测正反条件。不要把“有假设”误当已确认，采用当前 claim/check 证据。 |
| P0-2 关卡迁移 | `src/autoresearch_pi/arc_thin_e2e.py`: `LEVEL_REVIEW_PROMPT`; `demo/arc_thin_extension.ts`: `reviewTests`, `settleReviewTests`, `pinNextTest`; `demo/prompts/arc_thin_native_ch_arc.md` | review 把上一关机制降成候选并将 2-4 个 goal test pin 为必先实验。 | 新关默认沿用上一关已确认的通用机制；让 lessons 提供廉价、沿当前路线观察的检查项，而非要求单步过关。保留 review 作为复盘与修订入口；review 派生 pin 在执行态让路。修改 prompt 和 pin 导入的语义，不删除 review/test 基础设施。 |
| P0-3 RESET 成本与重放 | `demo/arc_thin_extension.ts`: `budgetText`, `actionLine`, `resourcesText`, spin/novelty 反馈；`demo/arc_thin_work_memory.ts`: reset/known 结果分类与 `spinStreak` | 动作预算显示 5×上限倒数；RESET 成本分散；已知路线重放可能被显示为 spin 并 pin 新颖性动作。 | 观察行显示本关 used/baseline、RESET 次数和 RESET 后已重放动作成本的可用估计；保留 RESET 为 agent 可见动作。把紧随 RESET 且结果与既有记录相同的已知路线标为 replay，避免仅因“known”触发新颖性 pin/spin review；真正连续无进展仍可提示。不得把 RESET 说成免费或隐藏其动作。 |
| P1 预算显示 | `demo/arc_thin_extension.ts`: `budgetText`, `resourcesText` | 只显示从 5×baseline 的剩余额，RESOURCES 将时间称为稀缺而未说明动作的计分成本。 | 展示已用 / baseline、当前动作数，以及预算可用时的剩余上限；保留必要的 run hard cap。删除“actions_left 看似宽裕”的主信号和“动作不花成本”的措辞，时间信息只陈述为资源事实。 |
| P1 未验证批量 | `demo/arc_thin_extension.ts`: `THEN_STEPS`, `arc_action` schema/执行；`demo/arc_thin_native_runtime.ts`: `MAX_ACTS`, `env.act` | 允许 12 或 24 步，未区分未验证新动作与已验证路线重放。 | 默认未验证批次 1–4 步，默认值 4；只有运行时可识别为已验证、未被反证且同一 level/状态路线的重放才允许较长批次；不匹配时按短上限截断并明确回执。保持环境边界的总硬上限。使用一个集中 helper 计算 cap，覆盖 ARC tool 和 Python `env.act`，避免绕过。 |

## 开关与环境变量

新增一个总开关 `ARC_THIN_ACTION_EFFICIENCY=1`（默认开；设 `0` 可回退到原始时机/展示/批量策略，保留旧 hard limits）。未验证批次可用 `ARC_THIN_UNVERIFIED_BATCH_MAX=4` 调整，合法范围 1–4，非法值回落 4。较长批量只由 runtime 的已验证路线重放判定放行，不设环境变量绕过判断。计划实现前确认 extension 启动如何读取 env，避免新增未注册配置能力；既有运行若不可由 env 暴露则以单一常量开关并记录禁用方式。

## 评估协议与验收

本次授权为 plan → 实现 → 测试。实现前基线 HEAD 如上；不启动真实 provider 或消费 ARC 游戏预算。功能层：新增针对执行态 gating（待执行时抑制/完成或反证时恢复）、新关 review 的沿路线语义、RESET/replay 表示、预算计算和未验证批次截断的 focused unit tests，包含执行态之外的负例、被拒绝/过期 pin、RESET 可见、verified replay/未知批次分支。运行新增 focused tests 和相关的现有 ARC adapter 测试。

若仓库存在且环境可用，运行最便宜的 ARC smoke，记录命令、provider 和产物；否则标记跳过及具体缺项。ARC smoke 不是自主采用或净收益证据。完整 CH-vs-r04 需要同一 ARC 初态/种子快照、同一模型/provider/推理设置和相近父子 token/墙钟预算，r04 tip 与本分支单变量对照，独立重复；采集每关 actions/baseline、分数/过关、RESET 与重放动作、pin 来源/履行漏斗、无效动作、模型及工具成本、管理轮和首次有效行动延迟。纳入合理不使用与路线反证样本。支持命题需动作比下降而任务质量不越过预注册容忍线，且总成本不恶化；少于可比较的独立重复、初态未对齐或使用 scripted parent 时只算诊断，不宣称自主采用/净收益。

四层状态将在实现报告中分别列出：功能正确、全链路可达、自主采用、净收益。仅测试通过只能支持功能证据；任何未跑层级写未验证。

## 风险、回滚

风险：路线/已确认判定过宽会把错误机制固化；过窄则门控不起作用；多步状态导致 verified replay 识别错误；新 prompt 可能与 claim 机制矛盾；压小未验证批次会增加模型往返/延迟。测试覆盖边界，运行时仍保留反证与失败回退。使用总开关恢复旧策略；若默认行为导致错误确认或质量下降，关闭开关或撤回单独提交。实现报告记录 diff、测试和证据缺口，不把只读推断升级为实证结论。

## 实施记录（2026-10-21）

已在本 worktree 实现：`demo/arc_thin_action_efficiency.ts` 提供纯策略函数与 env 配置；`demo/arc_thin_extension.ts` 对确认机制（confidence ≥4 且事实提及 rule/mechanism/pattern）+ `prompts/strategy.md` 的 `Route:` 行启用执行态，移除/延后探索 pin 与提醒；未验证 direct/Python 批次限制为默认 4，最多 4，能与历史已完成路线匹配时最多 24；budget receipt 显示 used/baseline，RESET 和 reset 后动作显示累计成本及重放数，已知 RESET 重放不触发 spin/novelty；`src/autoresearch_pi/arc_thin_e2e.py` 和两个 native prompt 改为沿路线廉价检查、跨关沿用已确认机制，不要求 2-4 个目标 pin；`demo/arc_thin_components.ts` 补充 Python batch 元数据类型。相关测试已更新。

开关：`ARC_THIN_ACTION_EFFICIENCY=0` 恢复原 pin/budget/batch 策略；`ARC_THIN_UNVERIFIED_BATCH_MAX` 可设 1–4，默认/非法值为 4。verified replay 仍受环境硬限制 24 步和每步边界校验。

验证状态：
- 功能正确：focused Node 25/25、pytest 9/9 通过；`git diff --check` 通过。覆盖 helper 条件与预算/RESET 可见性、精确已完成路线放行、原有 action boundary、level review/work memory。
- 全链路可达：`arc-thin-smoke` deterministic runner 成功（offline-arc-thin-smoke / scripted / ls20 / 4 actions / max_decisions），产物：`C:/Users/qi/tmp/codex-r04-eff-arc-smoke-final/summary.json`。这不是真实 ARC bridge 全链路验收，效率新分支的 autonomous traversal 也未由该 smoke 覆盖；故仅表示既有 runner smoke 仍可运行。
- 自主采用：未验证；没有真实 provider 新关/路线运行。
- 净收益：未验证；没有匹配初态的 r04 tip A/B 和独立重复。

下一项可证伪检查：同一 level snapshot 下，以相同 provider/model/thinking 和相近父子预算，对照 r04 tip 与本分支；核对 route readiness、pin 的 deferred/履行率、RESET 后重放动作、actions/baseline、分数/过关及父子总 tokens/延迟。质量若越过预定容忍线或动作比不降，应修订执行态识别/门控，不能因 smoke 通过而保留为有效优化。


## VERIFY follow-up: remove dangling triggers (2026-10-21)

### Failure, claim, and burden

The verified `codex-eff-su15` run showed `pin_deferred=0` despite a Qwen-written “Mechanism (confirmed)” and “Carried to Level 2” review; memory confidence stayed at 1 and strategy had no `Route:`. `knownResetReplay` also required every post-RESET action to be `novelty=known`, while the run replayed actions labeled `new`. The lesson review's infrastructure pin still placed its test as `First`. Receipts lacked `baseline=` although bridge state and the observation schema carry baseline data.

Claim: on the same kind of post-level-review input, carried confirmation plus the actual winning action sequence will create an executable route and defer exploration pins; exact repeated post-RESET actions will suppress replay-driven spin/novelty even when novelty labels are `new`; action receipts will join the baseline into per-action projections. This removes the model's obligation to author confidence values and exact route syntax before runtime efficiency behavior can engage, and removes mandatory lesson-test pinning.

### Implementation and bounded evaluation

`demo/arc_thin_action_efficiency.ts` derives the current level's winning sequence from trajectory rows when lessons state `Mechanism (confirmed)` and `Carried to Level N`; exact post-RESET action-and-coordinate replay now matches prior contiguous history after two or more actions. `demo/arc_thin_extension.ts` writes that route once when a new level review lands, consults it for execution readiness, excludes `prompts/lessons.md` from automatic review-test pinning, and supplies the current bridge baseline to action receipts using the played level (including the level-completing action). The level review prompt explains the synthesized route. Unverified batch max 4 remains unchanged because VERIFY showed it fired.

Regression inputs mirror VERIFY: confidence 1/no authored route, confirmed+carried lessons, actual winning actions, and identical post-reset actions labeled `new`; negatives cover absent confirmation/route, one-action replay, and mismatched action sequence. Budget coverage models the projected row missing baseline and a level-changing action.

Validation: focused Node suite 25/25, focused Python suite 9/9, `git diff --check` clean. A read-only replay of the verified trajectory through `carriedReviewRoute` yields 38 actions from the level's actual winning sequence. No provider/game run was started. Functional correctness is supported by focused tests; full-chain post-fix reachability is not rerun; autonomous post-fix adoption and net benefit remain unverified. Next falsifiable check: on an ordinary Qwen run, verify a new carried review creates `Route:` and a subsequent eligible exploration emits `pin_deferred`; verify an exact repeated action prefix after RESET hides replay spin/novelty while a nonmatching sequence does not.
