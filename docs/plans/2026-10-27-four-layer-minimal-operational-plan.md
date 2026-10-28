# 四层最小实施方案：编码步骤与验收预期

日期：2026-10-27。基线：独立工作树 `meta-loop-min-20261026`。状态：最小编码切片已实现；定向功能检查通过；已完成一次无 token 上限、按动作/墙钟截断的真实 ARC 探索运行。

## 目标与约束

已有[复盘审计与运行记录](2026-10-26-runtime-meta-self-harness-design.md)表明，识别过程问题后未必产生可执行改进。本次命题：补齐过程规则的保存、权限、反馈和现有执行入口后，Meta 能改变 Self 的造用选择，Self 的结果能进入 Task，控制核正确兑现执行合同。预期减少重复劳动；若行为未变化或任务与总成本未改善，分别记录对应失败或收益不确定。

四层是设计约束：Task 推进任务；Self 创建、复用、修改和退役能力；Meta 改进造用方法；控制核负责权限、预算、版本、装配、执行和真账。关内 Self 可以直接服务 Task；机制 Self 负责落实过程改进。同一父 Agent 可承担三种语义职责。

按以下五个改动包实施，复用已有函数、组件消费者、trial 和日志。实现与证据在本文件更新，遵循[开发流程](../development-workflow.md)。

## 1. Binder 支持 process 槽

**改动：** `demo/arc_thin_binder.ts`；必要时调整 extension 的 prompt 注入。

1. `componentKind()` 接受单层 `prompts/process/<name>.md`，kind 仍是 prompt。
2. `markdownSpec()` 使用 `process_<name>` 内部名，沿用 frontmatter、active 和正文解析。Binder 在接受版本时检查最终 section 名与已有有效 prompt 是否碰撞。
3. 保留 `save → boundary → active → promptSections/decisionPrompts` 的既有生效方式。父保存后下一决策生效，同一决策头保持稳定。
4. 正文沿用现有 prompt 处理；EXPECT/DECISION 控制行按已有规则从反复投递的正文剥离，试用读取原文件。协议文本不作为常驻行为要求重复投递。

| 用例 | 预期结果 |
| --- | --- |
| 有效 active process 保存 | 回执为合法 prompt；下一决策实际 provider 输入出现对应 section 和正文 |
| 决策中修改 process | 当前决策头不变；下一决策呈现新版本 |
| active=false 或退役 | 下一生效边界后正文不再投递，其他 prompt 不受影响 |
| 格式错误或最终 section 名冲突 | 新版本拒绝激活，回执明确原因；旧有效版本仍按原合同运行 |
| 原平铺 prompt | 名称、生效方式与原测试预期保持一致 |

测试落点：现有 `tests/arc_thin_binder.test.ts`、`tests/arc_thin_self_harness.test.ts`。检查实际输入，不能只检查候选列表。

## 2. Refiner 权限与 guide

**改动：** `demo/arc_thin_extension.ts`；检查 `demo/arc_thin_refiner.ts` 的现有解析限制。

1. 保留 EDITABLE 对文件形式的限制；在 Refiner FILE 实际落盘分支拒绝 `prompts/process/*` 和旧 `prompts/refine.md`，沿用现有 refused 记录。
2. 父 Agent 的原 write/edit 权限保持可用，不将 Refiner 限制扩大给父。
3. `refineGuide()` 优先选 `prompts/process/refine.md`，不存在时回退旧路径；Refiner 输入显示实际采用的路径。
4. guide 沿原读取语义使用。prompt 的 active 控制父上下文投递，guide 的显式读取单独验证，不能把 active 计数当作 Refiner 已读证据。

| 用例 | 预期结果 |
| --- | --- |
| 父写 process 或 guide | 能保存并收到准确回执 |
| Refiner 返回 process FILE | 解析限制或宿主授权边界拒绝，文件不改变；留下 invalid/refused 证据 |
| Refiner 返回旧 guide FILE | 宿主拒绝，旧 guide 不被创建或覆盖 |
| 新旧 guide 同时存在 | 实际 Refiner 请求使用新路径及其正文 |
| 只有旧 guide / 两者都无 | 分别沿用旧指导 / 沿用无自定义 guide 的原行为 |

权限正确与指导效果分开验证：guide 成功送达只证明输入路径正确。

## 3. 来源记账与短过程反馈

**改动：** Binder、extension、`demo/arc_thin_native_runtime.ts`、`src/autoresearch_pi/arc_thin_reuse_report.py`。

1. `Binder.save(path, level, origin?)` 接受由宿主提供的 by/decision，并随实际版本写入现有 components 记录。父、Refiner、runtime、scan 各自在保存调用点传来源。
2. 内容不变时沿用现有 unchanged 行为，不新造版本，也不改掉原版本作者。异步保存记录发起时传入的 decision。
3. Meta/Self 归属按路径推导，回合情境从现有状态读取；复用现有 working_set、调用与 usage。旧记录缺来源记 unknown。
4. 增加 `processEvidenceText()`，只汇总近期修改来源、有效 process 版本、组件运行/展示/错误、服务成本和待决 trial。摘要最多 1200 字符。
5. `ARC_THIN_PROCESS` 默认关闭，仅控制既有 review/consolidate 中按需投递的摘要；不另写 `data/process.md`，避免同一过程事实产生第二份快照。
6. 报告区分保存、装配、执行、展示与可审阅的语义使用。成本没有足够关联信息时标未知，不补猜组件成本或语义采用。

| 用例 | 预期结果 |
| --- | --- |
| 父写、Refiner 写、pin/restore、scan | 来源分别准确；scan 不将已有版本作者改成 scan |
| review 中修 tool / task 中写 process | 分别表达 review 情境下的 Self 改动 / task 情境下的 Meta 改动 |
| 开启过程摘要 | 摘要按上次 review 到当前决策汇总真实写入、运行和报告用量，长度受限 |
| 关闭摘要 | 无新增过程摘要投递；process 文件仍可保存与激活 |
| review 期间 Refiner 改组件 | 不被算作父 Agent 的试用候选 |
| 旧日志 / 缺失 usage | 报告可生成，来源或成本标 unknown，不记成零 |

## 4. 保存后试用与既有消费者贯通

**改动：** extension 的 onSaved/applyMetaReview，native runtime 的 noteSave；必要时扩展 `demo/arc_thin_meta_trial.ts` 的事实聚合。

1. 当前 `noteSave()` 对非 Python 文件提前 return。将 Python 保存日志保留在原路径条件内，把通用 `onSaved` 通知移到该条件之外，使 process 保存能够到达宿主。
2. 直接扩展现有 `onSaved`：接受 `tools/*.py` 与 process 文件；有效新版本、父来源、前十行有 EXPECT 才开试用。无 EXPECT 的组件照常使用。
3. write/edit 已经经 `workspace.onWrite → noteSave → onSaved`，Python save 也走 noteSave；保持一个通知入口，不再加第二套开窗钩子。
4. 给 Binder 增加最小只读来源查询，复用同一版本记录。在 onSaved 与 applyMetaReview 中排除非父来源候选，避免后台落盘误归因。
5. 沿用单候选、单待决 trial、现有动作窗口与版本检查。重复保存、修订和新保存竞争仍按已有规则返回明确结果。
6. 组件执行复用普通调用或 decision/action/feedback。下一正常决策投递已有 trial 事实；父据反馈修改资产，并用现有 DECISION 或 env.meta_decide 收口。
7. 过程规则和执行组件是不同资产。可只给执行组件带 EXPECT；独立测规则时再用 process 候选。不能用两个同时开启的 trial 评估同一改变。

| 用例 | 预期结果 |
| --- | --- |
| process 写入带 EXPECT | 保存通知确实穿过 noteSave，到 onSaved 开一个精确版本试用 |
| tool 经 write 或 Python save 带 EXPECT | 两条保存路径各自只开一次，候选为实际有效版本 |
| 无 EXPECT / unchanged / 校验失败 | 无新试用；合法普通组件仍可用；失败回执保留 |
| Refiner 保存工具 | 不进入父的自动试用，也不污染 review 候选集合 |
| 已有待决 trial 再保存候选 | 不悄悄替换待决候选，按现有合同拒绝开窗或等待修订决定 |
| decision 挂载 | 输出含路径/版本并进入后续实际父输入 |
| feedback 挂载 | 使用真实动作回执更新该组件版本的 local；后续 decision 可见更新结果 |
| action 挂载 | 允许时才跨动作边界；拒绝或错误按现有合同返回；不能把拦截次数当收益 |
| 试用中版本改变 | 原试用不把新版本消费记为原版本效果；漂移事实可见，语义结论不足时保持未知 |
| keep/revise/remove | 决定与有效资产状态一致；过早或版本不符的决定被拒；修改/退役对后续执行生效 |

初次执行探针使用 decision+feedback；action 的权限与拒绝沿现有测试补相关回归。新增控制行、版本归因和普通调用路径分别在现有 meta_trial、native_runtime 与 self_harness 测试中验证。

## 5. 三条链路分别验收

### 5.1 控制核链路：合同是否正确执行

写入/调用 → 权限、预算、版本检查 → 生效边界 → 执行 → 回执与记账 → 后续父轮。

预期：合法 process 下一决策生效；Refiner 越权写入被拒；失败版本不冒充有效版本；原预算边界仍有效；实际执行版本、日志和父输入一致。拒绝后父能按现有通道修复或退役。来源、版本或后续输入不一致即为此链失败。

证据：组件/权限定向测试，加生产 thin runner/Pi/native runtime 的脚本接线探针。逐项注明模拟环境与脚本 provider；该结果只证明已测合同及接线。

### 5.2 Self 链路：能力是否被 Task 使用

任务能力缺口 → 父创建/复用/修改组件 → 装配 → 具体输出 → 父的实验或动作 → 真实结果 → 保留/修订/退役。

预期：不写 process 也能完成此链；输出语义正确且具体值进入后续决策或行动；反馈用于后续调整。创建成功但没有执行，断在装配/调用；执行成功但未使用，断在输出到 Task；错误使用记为失败。没有适用机会或合理不使用单独记录。

脚本探针核对已知输入、精确输出和后轮行为，证明路径；真实模型普通运行再判断自主使用。只收到输出或声称已使用不足以通过。

### 5.3 Meta 链路：过程规则是否改变 Self

过程证据暴露问题 → 父修改规则 → 后续适用机会 → Self 改变创建/复用/调用/退役选择并执行 → 反馈 → 保留/修订/撤下规则。

预期：例如针对重复重建，父形成复用政策；后续在已有适用能力时实际复用，而不是再次重建，结果返回反馈。该情境用于验收思路，不预填游戏策略。核查规则内容、实际送达版本、机会、Self 选择与执行，不把同拍发生视为规则的因果证明。

文件已写但未送达，属于控制核入口问题；规则已送达但没有机会，结果未验证；有适用机会却没有对应行为变化，Meta 作用未证明；改变错误或成本不值得，修订/撤下。规则改的是“何时不投入”时，有证据的合理放弃也可体现政策采用。

脚本探针只证明规则到行为的路径可达。真实模型普通运行观察自主改变，并保留无规则时的可比证据；要声称收益或因果贡献，再做同模型、相近预算的独立对照。

### 5.4 运行顺序与报告

编码顺序：1 → 2 → 3 → 4；每步先做相关功能检查，再走三条链路。控制核通过不代表 Self 采用，Self 成功不代表 Meta 生效。

真实运行前固定模型/provider、任务、父加所有服务总预算、动作/时间上限与停止规则。未知用量、额度不足、环境失败和作用域结束按原合同处理；窗口不足记未知，不自动延长。记录任务进展、总 tokens/墙钟、管理轮、重复劳动及合理不使用；功能成功不能代替净收益。

| 证据层级 | 当前状态 | 所需结果 |
| --- | --- | --- |
| 功能正确 | 定向检查通过（范围有限） | process Binder 正例/section 冲突与 native save 回调通过；Refiner 实际拒写及 review 证据运行尚未独立检查 |
| 全链路可达 | 部分证据 | 真实 ARC/Pi/native 执行 8 个动作；过程摘要进入两次 stall review；未发生 process 写入、版本试用或其反馈闭环 |
| 自主采用 | 未证明 | 该次运行没有创建 Self 能力或 process 规则；没有记录到可判定的适用机会，因此 Meta/Self 自主采用均不确定 |
| 净收益 | 未验证 | 相近预算对照下的任务进展与父加服务总成本 |

本方案先验收所改 thin/native 路径；脚本探针不宣称完整 ARC self-harness 闭合。若提出用户定义的完整闭合声明，另满足 arc-harness-smoke 的真实 bridge/Pi/child/router/native/action/后续父轮、五类组件与两类 length 续接门槛。

## 实施与当前证据（2026-10-27）

- Binder 接受 `prompts/process/<name>.md`，装配为 `process_<name>` section；冲突 section 拒绝新版本并保留旧有效绑定。process 的 EXPECT/DECISION 行不注入常驻正文。
- Refiner 宿主拒写 process 规则和新旧 refine guide；父 Agent 仍走现有 write/edit 路径。`prompts/process/refine.md` 优先于旧 `prompts/refine.md`，Refiner 输入记录显示实际路径。
- Binder 版本记录增加 `by` 与 `decision`；保存通知覆盖 process Markdown，只有 Agent 来源的新有效版本进入现有 EXPECT trial；Refiner/runtime 来源不误开父候选。trial 事实继续复用现有 working-set、动作、调用与版本记录。
- `ARC_THIN_PROCESS=1` 时，级别/停滞 review 获得最多 1200 字符的过程摘要；默认关闭。摘要报告 prompt 投递和时间窗内已报告 token，不把二者推断为语义使用或规则归因成本。
- reuse report 分类过程 prompt，并记录版本来源、未知来源版本及 working-set 中按版本观察到的投递次数；明确投递不等于使用。

**定向检查：**

- `node --experimental-transform-types --test --test-concurrency=1 tests/arc_thin_binder.test.ts`：4/4 通过，包含 process 激活/section 冲突。
- `node --experimental-transform-types --test --test-concurrency=1 tests/arc_thin_native_runtime.test.ts`：7/7 通过，包含 Markdown save 通知回调；运行该既有测试文件中的全部 7 项。
- `python -m py_compile src/autoresearch_pi/arc_thin_reuse_report.py`：通过。
- `PYTHONPATH=src python -c ... component_kind(...)`：process 与普通 prompt 分类检查通过。
- `git diff --check`：通过。

这些结果不证明模型自主采用或任务净收益。相关[延后事项](../deferred-research-todos.md)中的研究到行动、总成本和连续性仍开放。计划与开发工作流不进入 Pi 游戏上下文。

### 真实 ARC 探索运行协议（2026-10-27，启动前固定）

- 运行：`ls20`，thin/native treatment，使用 primary project `.env` 已配置的 provider/model；仅在进程内装载配置，不输出凭据。
- 开启 `ARC_THIN_PROCESS=1`，让 Meta review 收到过程证据；常规 ledger/critic 保持默认设置。
- 任务边界：最多 12 个环境动作、30 个 Pi 决策、20 分钟墙钟；4 个无进展动作后进入现有 stall review。由用户明确要求不设 token 上限，故不传 `--max-reported-tokens`。
- 这是单次探索样本，不设 matched-control；可判断已测全链路是否可达，并审阅该次机会下的自主行为，不能据此宣称因果收益或净收益。错误、停止原因、provider 用量与任务进展都保留在 run artifacts。
- 首次尝试 `runs/arc-thin-process-20261027` 遇到网关拒绝 Responses `store: true`，3 次请求失败、0 个环境动作。按实际 provider 配置的 Completions 路由重试，增加 `--thinking-format openai`；该协议修订只修正传输路由。
- 实际 ARC 输出目录：`runs/arc-thin-process-20261027-retry1`；不重启、不自动延长。

### 真实 ARC 运行结果（2026-10-27）

- Provider：`yibu`，模型配置 `nvidia/nemotron-3.5-super-vl:free`，OpenAI Completions，thinking=high。进程内加载 primary project `.env`，没有输出凭据。
- Runner 返回 `stop_reason=deadline`：1201 秒、8 个环境动作、8 个 action decisions、11 个 working-set decisions、0 个完成关卡，最终 `NOT_FINISHED`。Bridge 正常关闭并确认 scorecard；真实任务未完成。
- Provider 错误 0；账本有 47 次请求，报告 token 978,376，runner 的 uncached-input-plus-output 口径为 640,168；2 次请求成本未知，`complete_cost_known=false`。这是 provider 用量，不等同已核验的计费金额。用户要求不设 token 上限；本次仅受 12 动作/30 决策/20 分钟边界约束。
- 两次 stall review 的真实 working-set 文本都包含 `PROCESS EVIDENCE`，快照 `workspace/data/process.md` 也生成，证明过程摘要到 Meta review 的输入链可达；其摘要只报告 0 条 active process 规则，交付和 token 不归因于规则。
- 运行没有写入 `prompts/process/` 规则或普通 prompt/skill；但保存了 Refiner 的 `tools/locate.py` v1 和 Agent 的 `agents/reviewer.md` v3。没有 process 候选及 Meta trial。
- **控制核：部分通过/未闭环**——生产 ARC bridge、Pi native runtime、动作与 scorecard 可达；process 写入/Refiner 拒绝/版本试用未触发，父 Agent turn 在 20 分钟截止时超时，恢复路径未验证。首次运行还暴露 Completions 配置被 native 默认 Responses 覆盖的问题，需显式 `--thinking-format openai` 才能通过该网关。
- **Self：部分生命周期证据，语义效果未验证**——Refiner 保存并激活 `tools/locate.py`；`observer_runs.jsonl` 记录了其后 4 次成功观察输出。对应动作发生在这些输出之后，但现有证据不能确认输出是否改变了动作选择。`agents/reviewer.md` 有两次无效保存后才成功，报告显示未被 consult 使用。
- **Meta：入口可达，作用未证明**——两次 review 确实收到摘要，但未产生 process 规则，也无后续规则适用与行为对比。
- **净收益：未验证**——单次探索运行、无 matched control，任务未完成；不能从 token/组件数推断收益。

### Consult-first 门槛修订（2026-10-27）

- **触发证据：** 本次运行两次 stall review 都触发 consult；子请求多次以 `stop_reason=length` 到达固定 1024 输出上限，也有 aborted 请求。父 Agent 的写入因此被拒，最后 review 写入机会也受同一门槛影响。见本目录 `runs/arc-thin-process-20261027-retry1/harness/usage.jsonl` 与 `pi-events.jsonl`。
- **改动：** review 仍先尝试 consult；状态区分“已尝试”和“成功返回”。失败会在 `call_points.jsonl` 记为 `consult_failed`，此后父 Agent 可基于现有证据继续写 review。原有最后一次限定 review 文件写入可在 consult 尚未成功时执行。consult 成功仍单独记为 `consult`，并保留后续使用标记核算。
- **请求预算：** 移除子请求写死的 1024 `maxTokens` 上限，改用当前模型注册的最大输出值；保留现有一次 length continuation、6 轮工具循环及 120 秒子请求期限。失败路径不因预算不足而封锁 review 提交。
- **验证状态：** 按用户要求，本次未运行测试或 ARC 实验。代码行为、全链路、自主采用及净收益均未因本次实现而验证；需要后续真实 ARC 运行检查 consult 失败后保存、成功意见的实际利用，以及总成本和任务进展。

### 最小 Meta → Self 运行闭环（2026-10-27）

- **触发机会：** `runs/arc-thin-process-20261027-retry1` 的两次 review 都显示 0 tokens / 0 usage rows；父的过程规则没有明确入口；review 窗口选候选时未过滤 Refiner 来源。此前实现还把同一摘要额外写入 `data/process.md`。
- **窄主张：** 在既有 review 中说明 process 的职责和复用原则，正确呈现两次 review 之间已有的写入、能力运行和报告成本，并只把父 Agent 写入的改变交给现有单候选 trial，可以让后续真实父轮基于完整证据改变造用选择并检查效果。
- **减轻负担：** 不新增 review、worker、账本、trial 类型或 `data/process.md` 副本；复用 Binder、components/usage/working-set 日志及现有 decision/action/feedback 消费者。
- **改动：** review 提示介绍 `prompts/process/` 并要求先考虑复用；过程摘要以最近一次 review 为窗口起点，纳入来源标记的近期保存、组件调用/视图和已报告总用量，未知用量继续标未知；process 规则只在 review 输入展示；review trial 排除 review 自身文件和非父作者组件；trial 回执展示普通工具、view、prompt 的实际消费数；memory 摘要不再把 Refiner 候选标作父作者判断。
- **负例与停止：** 没有合理适用机会时 `no_change` 有效；来源未知不计为父采用；无消费、无任务结果或未知成本不判收益；不自动延长 run。
- **验证协议：** 先做针对性功能检查；随后按本计划既有有界真实 ARC 协议运行一次普通父 Agent，观察父选择、能力输出是否改变行动、真实反馈是否触发修订/保留/撤下。该样本只判定行为链是否可达和有无采用迹象；净收益仍需可比预算对照。
- **当前状态：** 定向功能检查通过（`arc_thin_meta_trial.test.ts` 5/5、`arc_thin_native_runtime.test.ts` 7/7、Python `py_compile`、`git diff --check`）。之后启动真实 ARC 运行 `runs/meta-self-minimal-20261027`，但 provider 连续返回 13 次 HTTP 429；运行仅产生 1 个环境动作，未到 review 窗口。按重复限流停止，没有触发 review，也未产生新的规则、trial 或反馈。因此本次代码改动的 review 输入行为尚未由真实运行验证；全链路、自主采用和净收益仍未证明。复跑需待 provider 限流恢复，再使用同一有界协议；不自动延长。相关父子结果到行动、总成本和压缩认知连续性仍见[延后事项](../deferred-research-todos.md) B/C/D，状态保持开放。

### 独立于关卡复盘的 Meta 机会触发（2026-10-27）

- **断点与窄主张：** 上述改动只澄清了已有复盘的规则写入位置，没有在 Self 过程反复失败时主动提示父 Agent 检查造用方法。本次只增加一个可核实的触发条件：同一关卡、同一 Self 组件在相近决策中出现至少两次真实保存失败；下一正常父决策提示判断应继续 Task、修一项 Self 能力，还是修改 Meta 过程规则。历史 `agents/reviewer.md` 在一次决策里两次无效保存，是该条件的实例；失败次数本身不证明 Meta 是正确选择。
- **实现与成本：** 读取 Binder 的实际 `.harness/components.jsonl`，仅在 `ARC_THIN_PROCESS=1` 下工作。每个路径每关最多投递一次短 `META OPPORTUNITY`，由既有 `call_points.jsonl` 去重并留下版本/路径回执；不新增 Agent、复盘轮、工具、门禁或自动规则写入。既有关卡/停滞复盘提示也明确 Task / Self / Meta 三种问题的边界，沿用原 review 与 process 写入合同。
- **负例与验证边界：** 一次失败、不同组件各失败一次、过程规则文件保存失败或已经提示过的路径不触发。触发后父认为只是一次格式修复、选择继续 Self 或 Task，均属合理结果。按用户此前要求，本次未运行测试或新 ARC 实验；仅实现触发与输入路径，真实父是否判断、修改规则并使 Self 行为改变仍未验证。

### Daemon 通知与同一 Agent 的响应轮（2026-10-28）

- **问题与窄命题：** 当前过程检查主要寄托在关卡/停滞复盘和一次组件失败提示上；父可以继续执行 Task 而不处理过程问题。用户要求普通 daemon 持续维护证据和通知，同一个 Agent 在 Task 轮之前优先进入独立响应轮。窄命题是：已有日志出现具体过程信号时，daemon 生成通知；未取得处理回执前，后续 Task 动作不可执行。
- **最小设计与职责：** 在现有 Python runner 中增加一个随运行存续的普通服务，由运行事件和轮次边界推进，增量读取既有日志并原子保存消费位置、通知、最近处理摘要、kernel checkpoint 状态和 process 版本。复用同一个 Pi Agent 与 Python session；通知先于普通 Task/阶段复盘调度。响应轮允许检查与修改能力/过程规则，环境动作关闭，以一次 daemon_reply(summary) 回执结束；合理 no_change 可完成响应，不强制创建组件或规则。控制核问题只能在既有授权范围修复或报告。
- **触发与后续：** 按事件就绪调度：重复保存/运行错误、checkpoint 问题，或现有检测器发现同一关卡的 Python 工作重复至少三次时生成通知；没有信号就不消耗响应轮。daemon 在已提交事件和轮次边界刷新，runner 在下一安全轮次先处理待响应通知，不打断正在运行的 cell。初版沿用 ARC_THIN_PROCESS 开关；后文已拆为独立的 ARC_THIN_DAEMON 开关。process 版本变化进入持久跟踪，后续响应可见版本和使用事实，无需 EXPECT。已有 trial 仍是可选的具体预期试用，不承担通知入口。
- **减负与成本：** 持续取证、游标和待观察状态交给 daemon；语义判断仍由同一个 Agent 承担，仅从 Task 轮移入响应轮。增加一次有界响应和一个仅响应轮暴露的终结工具，不增加模型 worker、系统进程、消息队列或新的组件出版路径。用户授权了响应前的动作限制；不得把 ACK 当成方法改善或语义采用证据。
- **放弃与恢复：** 消费状态落在 harness/daemon.json，处理回执追加到既有 call_points.jsonl；重启保留未处理通知。响应的 length/idle 恢复沿用 runner，恢复仍不得变为 Task 动作。用尽既有恢复后仍未回复时停止本次运行并保留通知，避免无界响应或静默绕过。任务结束和既有权限/预算/环境停止条件保持最高边界。
- **实现步骤：** 1）普通 daemon 与持久通知；2）runner 优先响应调度；3）扩展中的动作边界、回执和证据入口；4）修改实际运行加载的 Agent system prompt，而非开发用仓库 AGENTS.md。
- **有界验收协议：** 本次遵循此前“不需要测试”的要求，不启动测试或付费 ARC。后续在用户给定预算下，以同模型/provider/游戏和相近预算比较 process=0 与 process=1；覆盖无信号时连续 Task、有重复工作但零异常/零 EXPECT 时的通知、正常处理/no_change、拒绝动作、未回复、恢复后通知保留、规则无适用机会、版本后续行为以及成本。功能正确、全链可达、自主采用和净收益目前均未验证；B/C/D 的总成本和连续性仍保持开放。
- **实现与静态检查：** `arc_thin_daemon.py` 在 runner 的已提交事件和轮次边界增量消费日志；`daemon.json` 是服务自身状态，`call_points.jsonl` 保存 Agent 回执。runner 优先选择响应轮，扩展在该轮隐藏 arc_action 并在直接调用与 Python env.act 两条动作入口拒绝执行；daemon_reply 是终结回执，之后的批内调用也被拒绝。响应与既有 review 的消费截止点分开，恢复提示和上下文投影包含 DAEMON RESPONSE。运行时 system prompt 增加通知优先和轮次规则，未修改开发 AGENTS.md。2026-10-28 进一步移除了每 10 个 Task 决策一次的固定触发，复用现有重复 Python 工作检测输出 `daemon_signals.jsonl` 作为成功但可能低效的过程信号；无需新增模型 worker。Python AST 解析、两个 TypeScript 文件的 Node 语法检查、git diff --check 均通过；这些仅是静态检查，未运行功能测试、smoke 或 ARC。

### Daemon 作为底层持续状态服务（2026-10-28）

- **问题与窄主张：** 上一实现将游标、通知和 Meta/Self 信号都放在 `ProcessDaemon`，使底层服务看起来只服务过程复盘。改为独立的 `daemon_service.py` 中的 `DaemonService`：统一消费已提交日志、持久化每个挂载项的派生状态，并排队通知；`arc_thin_daemon.py` 只注册 ARC 的具体检测。以后新增持续追踪内容只需声明日志源和状态更新函数，仍由同一个 Agent 判断和响应。
- **最小挂载：** `capabilities` 保存过程规则版本、组件失败计数和已报告的重复工作信号；`runtime` 保存最新 Python checkpoint 回执与运行错误计数。二者共享持久事件游标和通知协议，但状态分别保存在 `daemon.json.monitors.<name>`。Pi session、Python namespace checkpoint、Binder 版本和原始 JSONL 仍由原有机制保存，daemon 只持久化用于跟踪和调度的派生状态，避免第二份权威副本。
- **通用持久化边界：** daemon 是持续追踪与持久化维护的底层服务，并不限于 Self/Meta。任何后续需要跨轮维护的内容可挂载一个名称、事件源和 JSON 状态槽；状态、消费位置和待处理通知一起原子落盘。挂载项若拥有新内容，可把该内容保存在自己的状态槽；对已有 Pi session、Python checkpoint、Binder 版本及原始日志，则挂载其变化、健康与恢复信号，继续使用现有权威存储。Self/Meta 是当前两个用途，Task 连续性、预算或运行健康也可按实际缺口挂载，无需再造一套计时器、轮次触发器或持久化账本。
- **调度与入口：** `ARC_THIN_DAEMON` 控制底层服务与响应轮，native treatment 默认启用；`ARC_THIN_PROCESS` 只控制已有 review 的过程证据投递。挂载项报告具体事件后生成持久通知，runner 在下一安全轮次优先调度响应；无事件时不增加 Agent 轮。`daemon_reply` 清除当前通知，状态和游标跨 Pi 重启继续。
- **进入任务循环与退出：** 挂载项的派生状态只在通知响应的 `data/maintenance.md` 中按需展示；通知进入 runner 的优先响应轮，Agent 的保存或调用仍经现有 Binder/runtime，下一真实 Task 动作及其日志回到同一监视项。`daemon_reply` 确认该通知后移除待响应项；已消费事件不再重放，后续新证据可再次触发。运行结束后该 run 的 daemon 状态随 run 归档。
- **验收预期与边界：** 单个来源在多个挂载项需要时只读取一次；重启后不会重播已消费信号；运行错误和重复工作分别能生成通知；回复后 Task 继续；关闭过程摘要不关闭底层 daemon，关闭 daemon 不改变原有日志与 checkpoint 写入。挂载项可以把需持续保存的 JSON 派生状态放在自己的状态槽；已有原始内容仍保留原存储位置。Python AST、两个 TypeScript 文件的 Node 语法检查和 `git diff --check` 均通过；未运行功能测试或 ARC，功能正确、全链可达、自主采用、净收益均未验证。独立 OS 后台进程和通用内容存储 API 不在本次最小实现中。

### g50t 完整目标与响应隔离（2026-10-28）

- **真实缺口：** 之前的响应轮虽无环境动作，却仍与 Task 共用文件写入、Python session 和 Pi 历史；仅凭 daemon 通知无法证明 offload 后互不干扰。真实 g50t 还没有在此工作树运行，新机制对 Self、Meta、harness 和任务效果均无真实证据。
- **窄改动：** 每条通知有 `maintenance/<id>/self/workspace` 与 `maintenance/<id>/meta/workspace` 两个持久暂存区。响应轮只暴露 `read/write/edit/daemon_reply`；写入按路径归属暂存，Task 的 Python、memory、refine、组件调用和 ARC 动作被拒。`daemon_reply(publish=<one component path>)` 才把暂存源码提交给原 Task Binder，失败回滚 Task 文件并保留暂存稿；不发布的草稿不会影响 Task。下一 Task 历史投影略过完整响应轮，但 Pi 原 session 保留审计证据；通知的证据快照写到维护区而非 Task 工作区。fork 快照复制维护区。现有 Task 文件路径和工具合同不改。
- **最小功能预期：** Meta 草稿只在 meta 暂存区，Self 草稿只在 self 暂存区；Task 工作区、Python namespace、动作计数和普通历史在发布前不变。有效发布出现 Binder 版本与 `daemon_publications.jsonl` 回执，下一 Task 决策才能看见并使用；错误版本不激活且原文件回滚。回复后 daemon 清除通知，后续真实动作及组件运行回到既有账本。
- **真实 g50t 协议：** 先核对本地模型/ARC连接和共享预算，再以新 root 运行普通任务，记录 Task / 响应轮数、两种暂存区文件、发布版本、后续实际消费、规则对 Self 选择的影响、组件结果对任务行动的影响及总代价。对照需要相同 g50t、模型、近似预算的独立 run；不能把一个通知或一次保存称为优化成功。固定停止条件在启动前写入本记录。当前功能、全链、自主采用、净收益均未验证；B/C/D 的成本与认知连续性待核对。
- **首个真实探索窗口（启动前固定）：** g50t、native treatment、OpenRouter 的 `nvidia/nemotron-3.5-super-vl:free`、Completions/high/openai、图像与文本、daemon 与过程摘要开启；最多 8 个环境动作、12 个父决策、15 分钟、单次输出 15,000 tokens，不设总 token 上限。此窗口先检查真实服务能启动、Task 原动作路径正常、通知是否出现，以及响应区与 Task 的实际文件/历史边界；无通知时不把缺少 Meta/Self 行为当作隔离验证。单样本不能证明收益，后续是否改用更强 provider 或做匹配对照须由本次事实决定。

### 接线与首个真实 g50t 结果（2026-10-28）

- **定向功能接线：** [脚本运行](../../runs/daemon-isolation-chain-20261028b/summary.json) 用生产 Pi/bridge/native 扩展与 mock ARC SDK，脚本 provider 模拟两次实际错误及 Agent 的响应选择。3 个 Task 决策完成 3 个动作，2 个 daemon 响应；[发布回执](../../runs/daemon-isolation-chain-20261028b/harness/daemon_publications.jsonl) 分别是 Meta 的 `prompts/process/reuse.md` 和 Self 的 `tools/reuse.py`。两条通知各有独立暂存目录；Task `workspace/data/maintenance.md` 不存在，Python 执行仅在 Task 决策 3 发生。Meta 规则在后续 Self 响应中出现，在 Task 轮不投递；Self 工具在后续 Task 工具表出现。Task 输入没有包含两次响应的历史文本。脚本选择不代表真实模型自主采用，工具出现不代表 Task 语义使用。
- **真实 g50t：** [首个探索 summary](../../runs/daemon-g50t-openrouter-20261028/summary.json) 为 OpenRouter 免费模型每日额度 429，15 分钟截止：7 个父决策、0 环境动作、0 daemon 响应、31 次失败请求。ARC bridge 已启动并关闭，但 provider 未给出可用模型输出；真实 Meta/Self、Task 等价和收益均无法判断。请求账本的 31 次 usage 未报告，不能把零已知 token 当成零真实成本。
- **控制核修正：** 这 31 次错误消息相同，却因旧 `TRANSPORT_ERROR` 把所有 429 都当暂时断流，反复退避到截止。增加 `free-models-per-day`/明确充值解锁的永久额度识别，使该实际错误走已有 `provider_capacity` 停止；直接用此次错误文本检查为 true，一般暂时 429 仍为 false。未重启同一免费配额的真实 run。
- **响应隔离修正：** 现有后台 Refiner 可能在 Task 决策结束后仍提交文件或 memory 编辑，且 `before_agent_start` 原先会在响应轮执行 Task 的 pin、视图恢复和 Binder 扫描。响应轮现在先等待已经启动的 Refiner 完成，并跳过这些 Task 维护操作；下一 Task 轮照常执行。等待可能增加该次响应的延迟，需在真实运行中计入；此修正尚只有 TypeScript 语法与 diff 检查，未证明 Pi 自动压缩摘要不会泄漏响应历史。
- **下一证伪关口：** 获得可用且有明确预算的 provider 后，新 g50t 普通运行必须观察 Agent 自己在响应轮判断、暂存、发布、后续 Self 选择和 Task 实际消费；随后做同模型/相近预算对照，检查 Task 进展与父子总成本。当前四层结论：所测脚本接线通过；真实全链、自主采用与净收益均未验证。既有后台 Refiner 仍可能并行修改 Task 工作区，跨压缩摘要也可能混合历史；这两项是隔离验收的未关闭风险，不能用当前脚本结果宣称完全互不影响。

### AZ/Qwen g50t 探索窗口（2026-10-28，启动前固定）

- 用户明确选择 AZ provider，且此前要求不设 token 上限。本次只运行一个新 g50t 普通探索样本：native treatment、AZ 的 `qwen3.8-27b`、OpenAI Completions/qwen thinking dialect、thinking low、文本与图像、daemon/process 开启；Refiner 与 ledger 保持默认。AZ 凭据仅从主 checkout 的 `.env` 装入进程，不复制到报告或命令输出。
- 资源边界：最多 8 个环境动作、12 个 Task 决策、15 分钟墙钟；连续 6 个无动作 Task 决策也停止；单次输出上限 12,000 tokens（低于上次网关报告的可负担 16,000），无总 token cap。provider 容量错误即停，未知用量保留未知；不因没有触发 Meta/Self 而自动追加运行。这个窗口是探索样本，不声称净收益。
- 主要观察：第一项是真实 Task 动作是否继续正常；第二项是通知、响应、暂存/发布、后续 Self 行为与 Task 使用是否逐段发生。隔离检查 Task 历史与文件、响应区写入、Python namespace、后台 Refiner；成本包括父/Refiner/响应轮和等待时间。若没有信号，只能判断普通 Task 路径；若有信号但未处理，定位停在哪个转移。后续要证明优化，需按观察到的机会另预定同模型、相近预算的独立对照。
- 启动前定向接线 `runs/daemon-isolation-chain-20261028c`：生产 Pi/bridge/native 扩展加脚本 provider、mock ARC SDK，3 Task 动作、2 daemon 响应、0 provider 错误；确认刚修的响应入口仍可达。该结果不代替真实 provider 证据。

| 关键链路 | 后续验证预期（本次均未执行） |
| --- | --- |
| 正常运行，无具体信号 | 不生成响应轮，Task 连续推进 |
| 重复工作，无异常、无 EXPECT | 同关卡重复 Python 工作达到既有检测条件后持久生成通知，下一安全轮进入 DAEMON RESPONSE |
| 响应期尝试 arc_action / env.act | 两条入口均不提交环境动作；canonical trajectory 不增长 |
| 回复改动结果或有理由的 no_change | 回执引用当前通知，通知清除；随后 Task 沿用原 Pi/Python session 继续 |
| 未回复、length / idle、Pi 重启 | 恢复仍为响应轮；恢复额度用尽而无回执时停止，未处理通知留存 |
| process 保存未带 EXPECT | 版本进入 daemon 的持续状态，后续响应获得版本和行为证据；未出现适用机会不能判定失效或获益 |
| 语义效果与成本 | 分别审阅规则是否改变 Self 选择、能力是否影响 Task 行动，以及响应新增成本是否被任务收益抵消 |

**日志暴露的具体运行问题：**

- 首次错误路由：Responses 网关拒绝 `store: true`，导致 3 次 provider 请求失败、0 个动作；重试使用 Completions 后 provider 错误为 0。
- 两次 stall review 都被 consult-first 写入门槛卡住：4 次 consult 出现 continuation exhausted，另有 1 次 aborted；随后 4 次 `write` 被拒绝，另 1 次写入因 10 次 review tool-call 上限结束。两次 review 均未保存 review prompt 版本。
- ARC 工具调用有 2 次错误：一次动作名/参数不符合当前环境工具合同，一次当前 turn 中 `arc_action` 不可用。
- 20 分钟内完成 8 个动作、0 个关卡；有 47 次模型请求，2 次成本未知，provider token 总量不是完整成本账单。

摘要和精简账本在 [summary.json](../../runs/arc-thin-process-20261027-retry1/summary.json)、[working_set.jsonl](../../runs/arc-thin-process-20261027-retry1/harness/working_set.jsonl)、[usage.jsonl](../../runs/arc-thin-process-20261027-retry1/harness/usage.jsonl)；首次路由失败记录在 `runs/arc-thin-process-20261027/summary.json`。完整三条链与收益仍需后续适用机会/对照实验，不因本次到期而自动延长。
