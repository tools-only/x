# Meta-harness 变更记录：常驻自进化表层不转化——有记录边界上的 evolution pass（适配 evo 线外部 pass）

日期：2026-11-17（Asia/Shanghai）。状态：实现（功能/mock 接线已验证；真实 provider、自主采用、净收益未验证）。
按 [开发流程](../development-workflow.md) 使用。

## 问题与命题

- 真实失败/机会及材料：su15-sl1q（arc-selfloop，commit 4bc322d5，qwen/yibu，2026-11-17 分析）里自进化面全程常驻——SELF digest 出现在全部 35 个决策——但没有转化：data/self 0 次读、槽位 0 次写，三计数（changed/activated/used later 8/8/7）全靠组件写入与 rules 弱信号撑起。诊断：harness 变更从来不是任何一轮的本职任务，它作为常驻事实与游戏回合竞争注意力并且总是输。参照 evo 线（evo-loop-implementation 分支）最新改动——dc049570 外部 pass、7a8bb87b pass 入口/carry/证据、19dada3b 轨迹进 pass 视图——其机制是：宿主在有记录的边界上开一个专职回合，把窗口事实推到眼前，由 agent 在界内判断。本次适配该机制（用户 2026-11-17 指令"将最新版本的一些改动迁移适配过来，例如外部 pass"），不合并分支；CH 的 4-pass evolver 结构 2026-09-11 已被否决，维持不对齐。
- 窄命题：当 runner 在有记录的边界（关卡结清，或连续 30 动作无 agent 自变更与 pass）上开一个评审形状的回合，其记录把窗口事实推到行内——计数行、窗口内的决策记录本身、自我面（槽位清单+组件）、上一 pass 回复尾——agent 会在界内要么经正常写路径保存变更，要么以 `NO HARNESS CHANGE: <reason>` 显式收束；常驻成本保持一行。
- 减少的负担：agent 不再需要在游戏回合中途自己"想起"审视 harness（sl1q 中从未发生）；窗口事实由宿主拼好推入，agent 不必自行翻日志重建；判断移到一个有界、有记录的时刻。父决策步骤零新增，游戏回合零改动。
- 适用条件：selfloop 开且 `ARC_THIN_EVO_PASS != 0`（默认开）。合理不使用：开关置 0 时常驻行退出、误发的 pass 提示降级为普通 consolidation。推翻条件：真实运行中 pass 如期触发但收束物无信息——no_change 理由成套话重复、carry 从不被下一 pass 引用、保存物零激活。
- 范围及非目标：只改 runner 触发与扩展的记录/收束；`arc_action` 不加字段（用户 2026-10-12）；记录只计数与照抄（提示自述 "The host presents facts without ranking, diagnosis, recommendation or order."），不建新内置分析；T3（outcomes 里的重复成本触发）本次不实现，记入剩余验证；评审上限沿用 LEVEL_REVIEW_CALLS=10，不建新额度。

## 设计与成本

- 选择与取舍：pass 复用评审回合的全部机械（不许动作、调用上限、恢复提示、working_set consolidating 标记），只换记录与收束行——不造新回合类型。窗口锚在上一 `pass_close` 行（无则从头），轨迹复用 refiner 决策窗的落盘记录，预算独立 `ARC_THIN_EVO_WINDOW=6000`（小于 refiner 的 14000：pass 还要并载自我面）。carry 取上一 pass 回复原文尾 ≤600 字符，不做摘要（agent-native，不引外模型）。
- 生命周期：runner 侦测 T1（关卡评审结清后 `evo_pending`）/ T2（`_evo_stagnation` ≥ EVO_STAGNATION_AFTER=30，自"最后一次 agent 自变更 `at`"与"最后一次 pass"的较晚者起算；重启自 working_set 的 evo_pass 行恢复锚点）→ 发 `EVOLUTION PASS. {why}…` 回合 → 扩展把 evoPassText 换入 recentText、拒绝 arc_action、第 10 次调用附收束提醒、第 11 次终止 → 收束：保存走正常组件写路径（receipt 带 `review: "evo"`），`NO HARNESS CHANGE: <reason>` 由 message_end 正则落成 typed `no_change` 行 → 下一个非 RECOVER 提示落 `pass_close`（含 carry 尾），即下一窗口的锚。恢复提示 EVO_PASS_RECOVERY_PROMPT 续同一 pass。pass 不消耗 consolidation 的评审跨度。
- 首次获益路径：第一个关卡结清或第一次 30 动作停滞即触发；保存物经既有激活机制进下一决策；下一 pass 的 CARRIED/WINDOW 读到上一次的输出。
- 新增与移除：开关 `ARC_THIN_EVO_PASS`、窗口预算 `ARC_THIN_EVO_WINDOW`（6000）、常量 EVO_STAGNATION_AFTER=30；行：`review_start` 增 type `evo`、新 kind `pass_close`/`no_change`、working_set 增 `evo_pass` 标记、harness_changes 行增可选 `by`；常驻 +1 行（SELF_PASS_LINE，只命名机制，无计数/写入义务）。无新 schema 字段、无新管理轮、无新 sideCall。
- 权限/版本/环境边界：写路径、权限与预算门全部沿用；pass 在 agent 本回合本模型内进行；不读游戏源，窗口内容全部来自运行自身落盘。
- 放弃与恢复：`ARC_THIN_EVO_PASS=0` 单开关回退（常驻行、触发、记录全退）；已落的行留档无影响。

## 运行前实验协议

- 目标证据层级：本次到功能正确 + mock 接线；自主采用/净收益需真实 provider ARC 运行（用户授权预算后发起）。
- 主要变量与比较器：同 commit 下 `ARC_THIN_EVO_PASS` 默认开对置 0；其余配置不变。
- 模型/provider/推理配置：本次验证全部 scripted provider / mock ARC SDK / node:test mock HTTP bridge（本机 Windows 11，node 24 实验性 TS，python 3.x）；真实运行待定（qwen/yibu 或用户指定）。
- 总预算与停止规则：本次零费用。真实运行按发起时声明的 token 上限执行。
- 主要指标与判定标准（留给真实运行）：pass 触发数（按 T1/T2 分）、收束分布（保存 / typed no_change / 超限终止）、no_change 理由的多样性、carry 在下一 pass 的到场、保存物的 activated/used later（settlement 既有口径）、pass 回合占父子总成本的份额。
- 负例：未过关且未停滞的运行（零 pass、零成本）；开关置 0（行为同旧）；模型不照 `NO HARNESS CHANGE:` 格式收束（无 typed 行，pass_close 仍记 carry，按超限/自然结束收束）。
- 遥测及材料：harness_decisions.jsonl（review_start/no_change/pass_close）、working_set.jsonl（evo_pass 行）、harness_changes.jsonl（`by` 与 review 标记）、summary 的 `evo_passes` 段（每 pass 的请求数、预算 token、变更、no_change 理由、carried 计数）。

## 实现与验证

- 改动入口及实际行为：
  - `src/autoresearch_pi/arc_thin_e2e.py`：EVO_PASS_PROMPT / EVO_PASS_RECOVERY_PROMPT（108/118）、EVO_STAGNATION_AFTER=30（124）、`evo_pass_on`（1376）、T1/T2 触发与锚点恢复（1491–1774）、`_evo_stagnation`（只数 agent 自有行）、`_evo_pass_stats`（summary `evo_passes`）、`_review_recovery` 识别 pass 提示。
  - `demo/arc_thin_extension.ts`：`evoPassText`（WINDOW 计数行 / TRAJECTORY 决策记录 drop-oldest / 自我面行内 / CARRIED）；评审门把 pass 当评审对待（拒动作、上限、第 10 次收束提醒）；message_end 落 typed `no_change`；下一非 RECOVER 提示落 `pass_close`；`recordComponentWrite` 增 `by`，writeStrategy/恢复路径记 `by:"runtime"`、refiner 套用记 `by:"refiner"`，agent 自存不记；selfText digest 只数无 `by` 行。
  - `demo/arc_thin_selfview.ts`：SELF_PASS_LINE（唯一常驻行）；SelfDigestInput.changes 文档限定为 agent 自有行。
- 功能/相关回归检查（全部本机、零费用）：
  - `node --experimental-transform-types --test --test-concurrency=1 --test-force-exit tests/arc_thin_evo_pass.test.ts tests/arc_thin_selfloop.test.ts tests/arc_thin_selfview.test.ts tests/arc_thin_selfslots.test.ts tests/arc_thin_selfsettle.test.ts tests/arc_thin_self_harness.test.ts tests/arc_thin_refiner_window.test.ts tests/arc_thin_level_review.test.ts tests/arc_thin_work_memory.test.ts` → 61/61 通过（evo_pass 4 新测试：记录/收束/锚点/开关退化/无 refiner 窗时轨迹仍在/上限）。
  - `python -m pytest tests/test_arc_thin_evo_pass.py tests/test_arc_thin_stall_review.py -q` → 8/8 通过（停滞计数含"runtime receipt 不重置"断言；pass 提示恢复；summary 统计）。
  - `arc-thin-smoke --root runs/evo_pass_smoke` → checks 全部 `ok: true`（含 no_harness_errors）；summary `evo_passes: null`——smoke 非 selfloop 运行，pass 不在其中触发（见下，全链路边界）。
  - `python tools/run_foundation_smoke.py runs/evo_pass_fsmoke foundation` → 实质断言（workspace 写、read-only、secrets NO_TOKEN、native history、frames）全部通过，执行到达末尾才停在 `system_chars<=3000`——2026-10-16 起已知基线，非本次回归。
- 机会漏斗与断点：记录在 pass 回合无须请求即入上下文（push）；替换的工作：agent 自行翻日志重建窗口、以及"在游戏回合里想起要审视 harness"这件从未发生的事；反馈：receipt/no_change/carry 喂下一 pass 的 WINDOW 与 CARRIED，保存物进 settlement 既有计数；退役：开关置 0。未知断点：真实模型在 pass 界内是否产出有信息的收束——本次无法测。
- 语义与连续性：pass 记录有界且可从落盘重建，重启沿 working_set 恢复锚点；sl1q 死因（compaction 缺陷）属运行时另案，本变更不触碰 compaction 本身。
- 成本与任务结果：每关 +1 回合、每 30 停滞动作至多 +1 回合，单 pass ≤10 次工具调用；记录 ≤6000 字符轨迹 + 自我面；常驻面从 sl1q 的"每决策义务"收敛为一行。
- 协议偏离：验证中发现 selfloop 套件在基底 commit 即红——`2091cebe`（refinement/strategy/恢复保存开始写 harness_changes receipt）之后未重跑该套件（其测试最后改于 `2b4b32a7`），宿主 pin 行被 digest 当作自变更。以 WIP commit 在 6d1a4ab3 与其父上回退本次编辑复测，两处皆红，证明先于本变更。本次以 `by` 来源标记修复：digest / WINDOW / 停滞计数 / pass 统计只数 agent 自有行；settlement、outcome 与 loop-audit 输入有意不过滤（事实行保全，`by` 随行可查）。该修复同时堵住一个真实触发漏洞：宿主 pin 行（sl1q 的自旋状态正会写入）原会重置停滞计数，自旋运行反而永远等不到 pass。

| 证据层级 | 状态 | Provider / environment | 产物及结论边界 |
| --- | --- | --- | --- |
| 功能正确 | 已验证 | 本机 scripted provider（无真实模型） | node 61/61 + pytest 8/8；记录四段、收束三路、锚点推进、开关退化、停滞计数均有断言 |
| mock 全链路 | 两端各自验证 | mock ARC SDK + mock HTTP bridge + scripted provider | 扩展端由 hooks 驱动完整 pass；runner 端 pytest 验触发与统计；两端以提示前缀与行名为合约对齐；smoke 非 selfloop，runner+扩展合体的 pass 未在一条链上跑过 |
| 自主采用 | 未验证 | — | pass 界内收束质量（保存 vs 套话 no_change）须看真实运行 |
| 净收益 | 未验证 | — | 需带预算的真实 ARC 运行对照同 commit 开关置 0 |

## 交付决定

- 已支持的声明：机制功能正确、mock 两端接线各自可达、selfloop 下默认开、单开关可退、常驻成本一行。未支持：pass 产出有信息的收束、改变 sl1q 型不转化、带来关卡/成本净收益——均未验证。
- 决定与依据：保留在 arc-selfloop 分支，selfloop 下默认开（零费用证据齐全，机制对 sl1q 诊断的断点——"无专职时刻"——给出直接修复）；不合回 r04，待真实运行证据。
- 剩余验证与下一可证伪检查：一次用户授权预算的真实 selfloop ARC 运行（声明 token 上限后发起），对照同 commit `ARC_THIN_EVO_PASS=0`：pass 是否按 T1/T2 触发、收束落在保存还是 typed no_change、carry 是否进下一 pass；负信号为 no_change 理由成套话重复。T3（重复成本触发）与 runner+扩展合体的脚本化 pass 链路为记录在案的缺口。不能写成已完成。
- 关联 backlog：`docs/deferred-research-todos.md` D（上下文压缩与连续性）——pass 记录有界可重建，与 sl1q 的 compaction 死因相邻但不解决它；状态无新证据，不改动。
