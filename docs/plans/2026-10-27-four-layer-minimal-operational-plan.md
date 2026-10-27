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

**日志暴露的具体运行问题：**

- 首次错误路由：Responses 网关拒绝 `store: true`，导致 3 次 provider 请求失败、0 个动作；重试使用 Completions 后 provider 错误为 0。
- 两次 stall review 都被 consult-first 写入门槛卡住：4 次 consult 出现 continuation exhausted，另有 1 次 aborted；随后 4 次 `write` 被拒绝，另 1 次写入因 10 次 review tool-call 上限结束。两次 review 均未保存 review prompt 版本。
- ARC 工具调用有 2 次错误：一次动作名/参数不符合当前环境工具合同，一次当前 turn 中 `arc_action` 不可用。
- 20 分钟内完成 8 个动作、0 个关卡；有 47 次模型请求，2 次成本未知，provider token 总量不是完整成本账单。

摘要和精简账本在 [summary.json](../../runs/arc-thin-process-20261027-retry1/summary.json)、[working_set.jsonl](../../runs/arc-thin-process-20261027-retry1/harness/working_set.jsonl)、[usage.jsonl](../../runs/arc-thin-process-20261027-retry1/harness/usage.jsonl)；首次路由失败记录在 `runs/arc-thin-process-20261027/summary.json`。完整三条链与收益仍需后续适用机会/对照实验，不因本次到期而自动延长。
