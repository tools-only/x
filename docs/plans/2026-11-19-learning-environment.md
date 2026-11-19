# SelfRoot 的学习环境视图与常驻 Meta 审查

## 问题与命题

在真实运行 `runs/evo-m15-host-assembly-20261119` 中，四次渲染均无告警，前两次返工仍改变了 HTML。第四次反思才固化审阅方法，后续修复了交付流程；这些回执无法回答某个视觉选择是否提升了信息传达。ARC 的反例是动作后画面相同：动作未执行、旧帧重复、环境确实没有可见变化，需要不同的证据才能区分。

窄命题：如果 Agent 可以在一个入口按来源追查当前学习条件，在既有 Meta 设计和复查时机可以发现缺失的边界，并自行选择是否补观察或构造检验。机制验收以事实能否追到、缺口是否如实暴露为准。实际自行采用与任务收益要另测。

## 设计与职责

| 责任方 | 产物与边界 |
| --- | --- |
| 环境与适配器 | 提供已有动作、观测、制品的来源及关联。根据接口证据区分承诺、收到和实际发出；缺证据的环节保持未知。 |
| Host / SelfRoot | 持有现有账本、资源约束、上下文和组件生命周期。按需组合为 `read_self(section="learning_environment")` 的只读结果，不创建第二个运行根。历史归原所有者管理。 |
| 常驻 Meta | 从初始设计开始，在任务中重新检查输入、授权资源、行动与观测、反馈的判别力及后续试用机会。决定是否建立、维修、替换或撤掉 Agent 自己设计的学习方法。 |
| 7 pass | 在可用学习条件下修改具体能力；当经验无法解释时，允许回查其产生条件。复用已有工具、试用和恢复路径。 |

这个职责随现有会话生效；只在已有入口提示，详细材料按需读取。保留模式、授权、预算和版本检查。已有环境反馈足够时，直接推进任务。若契约或证据根本不存在，由 Agent 保留未知、决定可行的局部实验；Host 不替它评价设计质量或推断游戏规则。

## 开发与验收

1. 在 `evo-loop-implementation` 实现通用只读查询，并接到生产 PPT 扩展与已有 Meta 入口。开发和验收只使用这个工作树。ARC 仅作为说明来源边界的设计例子。
2. 正例：用真实请求、动作或制品的可用引用检查来源；负例：无回执、过时或未观察到的数据不得升级为环境真相。Agent 自述不能充当 Host 的执行证明。
3. 功能与接线使用本地测试及已安装 Pi 路径。检查已有任务执行/7 pass 能继续运行；不增加必需 provider 请求。自动脚本调用只证明工具和数据可达。
4. 自主采用的后续检验须令任务模型自行发现一个可判别缺口并影响后续动作；净收益需匹配的模型、预算和任务对照，计入上下文、请求和返工。此次开发验收不动用付费任务预算。

## 相关边界

跨压缩后能否保留高质量判断仍是独立研究问题，见 [延后事项](../deferred-research-todos.md)。本功能只暴露已有来源与边界；退回此变更不回滚任何已执行动作。

## 验证记录（2026-11-20）

- **功能**：`tests/self_root_meta.test.ts` 与已安装 Pi 的 `test_learning_environment_read_through_installed_pi` 覆盖只读查询、来源引用、缺失引用和读取错误。最终版本的独立渲染运行 `%TEMP%/ppt-learning-render-wrtpqeyi` 另外断言了动作回执与制品版本、源文件指纹同时匹配。

- **接线**：本机已安装 Pi、生产 PPT extension、Edge headless HTML。用离线 scripted provider 经 RPC 依次在开局读取环境、建立任务契约、写入一页 HTML、调用 `office.render`、按 `artifact:v1` 读回环境视图。五步均成功。最后一条工具结果的来源指纹与 `harness/renders.jsonl` 一致。本机证据目录为 `%TEMP%/ppt-learning-render-pi6l8ndf`（含 session 与渲染记录）。本次脚本指定了动作。
- **旧状态**：使用此前真实 GLM 运行的 `runtime-manifest.json` 与持久化 SelfRoot 在内存中恢复，可按需生成新视图，无需迁移旧快照。此次回读只验证兼容性。
- **历史回归**：既有 `self_root_meta_entry.test.ts` 和 `self_root_meta_pass.test.ts` 在改动前的独立源码副本与本工作树中均为 16 项中 5 通过、11 失败。当前分支的历史测试套件并非全绿。
- **采用与净收益**：未用新实现跑付费 provider；没有数据能判定 Agent 是否会自行觉察反馈不足、创造更有判别力的检验，以及新增上下文与设计返工的净收益。首次真实对照应保持任务、模型与预算一致，并观察检验是否改变下一页的实际决策。

## 第二步：试用修复后的学习条件

**命题。** 已经存在的评价也可能漏掉维度、判据太弱、对反例不敏感，或者到达太晚。常驻 Meta 根据实际决策审视这些情况，Agent 在现有权限内自行修订方法、做一次比较或调整使用时机。7 pass 的能力修订职责保持原样。

**交付路径。** PPT 中让 Agent 将一次自定检验的判断与实际比较过的证据关联，结果进入后续任务决策。环境与渲染的身份由 Host 确认，评价依据、适用界限与取舍属于 Agent。正式验收和原材料继续受保护。现有评价够用时，Agent 直接继续；没有可用制品时，不能把引用错误包装成已完成的检验。

**验收。** 在已安装 Pi 与真实渲染路径上验证定性判断可登记、可追溯、可送达后续工作。定向测试检查引用不存在、修正后重试和重复曝光等边界。脚本指示 Agent 比较制品，只检验机制；自主识别评价缺陷、形成有用标准以及改善最终产物需要另行做真实 provider 对照。

**反例。** 对上述真实 BAC 成品在内存里互换第 5 页两根净利息收入柱的高度（保持基线、文字和数字标签），图面比较方向反转。用现行 `coverageFacts` 对其全部 10 个内容单元运行比较，结果逐项相同。该实验说明内容覆盖的判别边界；这一视觉规则不写入生产 Host。

**真实工具路径。** 通过已安装 Pi 的脚本 provider，先在正式 PPT 扩展中设计任务、写页面并用 Edge 渲染。在 `decide(op="assessment")` 引用不存在的 `artifact:v99` 被拒，改用 `artifact:v1` 后，第 7 个请求留下 Agent claim，第 8 个请求收到该判断并执行普通页面编辑。源文件确已改变，ledger 区分判断、曝光与后续动作。可检查本机 `%TEMP%/ppt-learning-repair-laxxdocl`。编辑由脚本安排，这次检查不把相邻事件当作内容质量或自主采用证据。

**分层验收。** 功能正确：`node --experimental-transform-types --test --test-concurrency=1 tests/self_root_meta.test.ts` 20/20；引用不存在、Agent claim 不能充当事实、后续曝光/行动和撤下均有断言。全链路可达：上述已安装 Pi、正式扩展与 Edge 渲染的 scripted-provider 路径通过；另有 `test_learning_environment_read_through_installed_pi` 的只读接线检查。自主采用：未验证，脚本安排了判断和编辑。净收益：未验证，尚无同任务、同预算的真实 provider 对照。`tests/test_evo_ppt_pi.py` 全文件运行 5 通过、3 失败；失败落在三个既有旧协议测试（`decide` 必填 `op`、旧阶段交付、旧组件探针），不作为本次新增路径通过的证据，也不在本次改动中修复。

## 真实 PPT 运行协议（启动前，2026-11-20）

用户确认执行：PPT 工作树、Bank of America 冻结案例，az / glm-5.3-flash、Meta B 臂。新 run `runs/evo-m16-learning-conditions-20261120` 的总上限是 60 次请求（含预检、重试和 consult）、1800 秒、2 GiB；token 与 USD 仅计量，非独立限制。单次到限即停，不替换 provider 或模型。启动命令和参数记录在本节及同名 `-caps.json`；本次不声称延用旧系列剩余预算。工程源包含未提交变更，由 manifest `seed_hashes` 固定，运行中不编辑相关代码。

主观察：Agent 是否自行发现已有 PPT 反馈的缺维、弱判据、视觉错误盲区或时机问题，并用现有接口构造检验、登记证据、修复方法，随后在另一页或后续请求真正运用；同时记录交付页数、单元、渲染告警、源文件变化、反思与 7 pass 内容。负例包括仅看到提示而不检查、登记后不试用、仅改字面覆盖或组件但没有视觉设计决策。比较器为 M15 同任务同 provider 的 54 请求/1286 秒历史轨迹，但代码及预算同时变化，故仅探索性比较，不能归因净收益。只做一次确认运行；不因未达预期自动延长或重试。成本含父子请求、token、时间、存储和估算费用。真实 provider 行为必须从运行后账本与产物查证，未交付不算成功。

启动：`$env:EVO_META='1'; $env:PYTHONPATH='src'; python -m autoresearch_pi.evo_ppt --root runs/evo-m16-learning-conditions-20261120 --source demo/ppt-cases/bank-of-america-3q21/assets --registration runs/registration-glm53f.json --caps runs/evo-m16-learning-conditions-20261120-caps.json --authority 'User confirmed 2026-11-20: 60 requests, 1800 seconds, 2 GiB, az/glm-5.3-flash, PPT worktree; all retries included' --arm B --run`。

## 常驻审查闭环（2026-11-20 续，实现）

按用户方向把“每次归纳都面对当前学习条件”落成常驻闭环，不新增管理轮、不新增工具、不新增必填字段：

- `demo/self_root.ts` 新增 `learningReview` 持久状态（随 `export()`/restore 保存），在 Meta 归纳回合进入时由 `openLearningReview()` 机械生成 `learning-review:<request>`：`since_review` 指向上次审查、`ledger_window` 记录增量区间、`unresolved` 回放未闭合的 `learning_assessment`、`repairs` 列出上次以来未闭合的修复/失败。
- `reviewSelfView()` 在 Meta 归纳（非 7-pass specialist）注入 `learning_conditions_review` 段，要求 Agent 在本次归纳给出 `usable / missing / inadequate / blind / late / unknown` 结论，并用 `read_self(section="learning_environment", ref?)` 展开精确证据。Host 只机械清点，不评价质量；7-pass 继续负责具体能力。
- 验证：`node --experimental-transform-types --test --test-concurrency=1 tests/self_root_meta.test.ts` 21/21（新增 `resident learning conditions review opens at induction and carries unresolved findings forward`）；`python -m pytest tests/test_evo_ppt_pi.py -q -k learning_environment` 1 通过。全文件 `test_evo_ppt_pi.py` 仍 5 通过 / 3 个既有旧协议失败（不属本次路径）。

## 下一步真实运行（已冻结、未启动）

按用户 2026-11-20 目标：去掉 60 次请求上限与时间上限，任务 prompt 末尾注入视觉传达设计目标。runner 增加 `--brief-addendum <file>`（追加到 `data/instructions.md`，计入 manifest 哈希）。已用无推理的 `--caps` 冻结 `runs/evo-m17-resident-learning-20261120`（10 units；budget requests=3000、seconds=2592000、tokens/usd 无上限哨兵）。真实 provider 启动命令待用户确认后执行，费用支出前需明确确认。
