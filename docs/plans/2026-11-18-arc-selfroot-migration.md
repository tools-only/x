# ARC SelfRoot 迁移变更记录

日期：2026-11-18（Asia/Shanghai）。状态：ARC 适配实现完成；evo 通用 SelfRoot/runtime 未提交改动已选择性同步；本轮未运行测试；真实 AZ provider 结果与功能边界见下文。

## 问题与命题

- 机会：ARC 分支的旧 selfloop 与最新 evoloop 通用 SelfRoot 存在重复的反射、上下文、事件和持久状态逻辑；更新核心时需要跨工作区手工同步。此记录针对代码结构机会，尚无本轮运行轨迹可证明任务表现损失。
- 窄命题：在 native、非 control ARC 跑次中，共享 `demo/self_root.ts` 的 mirror 是 Agent 唯一的运行视图；ARC adapter 把 observation、动作历史、run position 和 ARC 上下文事实放入该对象，extension 保留环境动作与原始日志。这样避免维护两套并行运行视图，同时保留 Python/WASI 和图像输入。
- 减少的负担：后续通用 SelfRoot 机制只需同步共享核心与 ARC adapter，不再迁移独立实现的 ARC 反射生命周期。
- 适用/不使用/推翻条件：native ARC 默认适用；control、legacy runner 或显式 `ARC_THIN_SELFROOT=0` 不使用；若共享核心无法保持 ARC action/session 边界、增加双重自我演化写入，或导致 ARC 任务路径行为变更，则推翻并恢复旧 selfloop。
- 范围及非目标：加入 ARC adapter、SelfRoot 默认接线和 `self_root/` 持久化；用 SelfRoot mirror 取代 Agent 输入中的独立 ARC state/recent/self 摘要。SelfRoot 默认运行时停用旧 ledger/critic/refiner 与 review consult；guard、hook、旧 selfview/selfslots 代码保留且默认关闭。Binder 暂保留为 NativeRuntime 的组件执行/版本与 Python session 支撑，不再把它当作自我演化入口；Python session、`env.act`、WASI、bridge、图像输入与动作预算不重写。

## 设计与成本

- 选择与取舍：采用薄 ARC adapter + 共享 SelfRoot；不复制 PPT adapter 的 acceptance/delivery 机制，也不整体替换 ARC extension。
- 生命周期：runner 启动加载或创建合同/状态；每个 provider request 记录上下文和 request pin；成功 ARC/Python action 产生 receipt；Pi response 边界激活待处理反射；reset、level/terminal、session shutdown 产生合同边界；失败写入错误事实且不伪造 action receipt。
- 首次获益路径：native ARC agent 从 SelfRoot mirror 中读取统一的自身与任务状态；ARC adapter 只提供事实，不另行注入一份状态/历史视图。反射调用通过通用 schema/contract 校验，在下一 request boundary 生效。
- 新增与移除：增加 ARC adapter 事实字段与 SelfRoot protocol tools；移除 SelfRoot 开启时单独拼接的 ARC state/recent/self view 文本，并默认关闭旧 ledger/critic/refiner/review-consult、daemon 和 process evidence 服务。guard/hook 原本就是 opt-in，继续默认关闭。通过 `ARC_THIN_LEGACY_HARNESS=1` 显式恢复旧服务；不移除 Python/WASI 和 NativeRuntime 的 Binder 执行后端。
- 权限/版本/环境边界：reflection 只能经 `reflect_component` / `reflect_orchestration`；存储合同 hash 不符时停止并报告；agent component workspace guard 仍拒绝泛化写 self storage。ARC action 仍只有既有工具可触发。
- 放弃与恢复：`ARC_THIN_SELFROOT=0` 关闭新路径；仅当同时 `ARC_THIN_SELFLOOP=1` 才启用旧 loop。SelfRoot 状态保留供恢复/排查。真实负收益出现时应单独记录并验证回退。

## 运行前实验协议

- 目标证据层级：功能检查与真实 ARC bridge 启动；全链路还需实际 Pi/provider 请求。自主采用和净收益须以后真实 provider ARC run 判断。
- 主要变量与比较器：主要变量为 SelfRoot 接线与默认开关；本轮没有旧路径对照，不作收益比较。
- 模型/provider/任务和初态：用户指定真实 ARC ls20、`az` provider、`qwen3.8-27B`。
- 样本、预算、指标及负例：已授权最多 3 次决策、5 个 ARC 动作、120k provider 报告 token；记录任务状态、请求 schema、SelfRoot view、动作 receipt、运行停止原因。不得替换为其他 provider。
- 遥测及材料：`<ARC_RUN_ROOT>/self_root/` 保存通用状态；ARC 原有 `harness/` 原始轨迹保留。

## 实现与验证

- 改动入口及实际行为：`demo/self_root_arc.ts` 新增 ARC contract、task runtime view、事实/指标和工具 schema；`demo/self_root.ts` 将 adapter facts 放入唯一 `mirror().task_runtime`，并在首次 request 前建立 action grant；`demo/arc_thin_extension.ts` 默认接入 SelfRoot、用 mirror 替换并行 state/recent/self 文本、记录 request/action/reset/session facts，在 response boundary 结算工作并激活修改；SelfRoot 模式下 critic、ledger、refiner tool/points、review consult、daemon 与 process evidence 默认关闭，显式设置 `ARC_THIN_LEGACY_HARNESS=1` 才启用旧 harness 服务。Binder 继续由 NativeRuntime 用于已发布组件执行和 Python/WASI session；这次没有声称完全撤下 Binder。
- 功能/相关回归检查：ARC 初始 frame 恢复定向 pytest 1/1 通过；`tests/self_root.test.ts` 与 `tests/self_root_arc.test.ts` 合计 28/28 通过；`git diff --check` 通过。完整 `tests/test_arc_agi_3_e2e.py` 为 72 通过、14 失败；失败覆盖冻结旧 ARC prompt/runner 断言，与本次 thin SelfRoot 和 bridge 改动入口不同。`tests/arc_thin_self_contract.test.ts` 两项旧 fixture 因 `NativeRuntime.binder` 缺失失败，剩余 26 项通过。
- 机会漏斗、语义连续性、成本和任务结果：两次真实运行均未发送 provider request。`arc-selfroot-real-20261118-01` 在 SDK 构造后 `observation_space=None`，bridge 当时直接报错；此失败促成 reset recovery。`arc-selfroot-real-20261118-02` 的 bridge 已到 `bridge-ready`，随后 runner 在启动 Pi 前因缺少 ARC OpenAI 兼容 endpoint/key 退出，0 决策、0 动作、0 provider token。用户随后指定 `az`/`qwen3.8-27B`；Provider Session 可验证 `讯星AZ`，但 Pi 本地 `models.json` 只有 `openai-codex`，项目/进程/用户环境均没有 ARC endpoint/key，因此未伪称完成 AZ 真实运行，也未换用其他 provider。
- 协议偏离：原先尝试 `yibu` 的 run-02 命令在用户指定 AZ 前已因 endpoint/key 缺失而停止，未发请求；之后没有启动第三个 ARC scorecard。真实 AZ run 保持待执行。

2026-11-18 追加：用户明确要求 SelfRoot 默认并停用旧机制。native SelfRoot 运行现在显式关闭 legacy ledger/critic/refiner、review consult、daemon 与 process evidence；`ARC_THIN_LEGACY_HARNESS=1` 是恢复入口。真实 AZ/Qwen 首次启动进入 runner loop 前又发现旧分支 `response_turn` / `task_turn` 只在 TypeScript phase 初始化，普通 native ARC 未初始化；已在循环每轮初始化并从 daemon 刷新结果设置 response turn。Python session 与 SelfRoot 互补，保持开启；Binder 继续只作为已有已保存组件/Python/WASI runtime 的执行后端，本轮尚未迁移其组件存储/加载职责。

### Evo 通用 SelfRoot/runtime 同步（2026-11-18）

- 来源：`D:\agent\.codex\worktrees\evo-loop-impl\autoresearch_pi_project`，分支 `evo-loop-implementation`，HEAD `370ad7fb8d0d2c12466d82a477303ac84a6d0bb2`。迁移内容来自该 worktree 的未提交文件改动；没有 cherry-pick/merge evo 的提交，也没有改动源 worktree。
- 同步内容：共享 `demo/self_root.ts` 的 orchestration `edit/replace`、效果/使用事实语义及 META pass；其配套共享 prompt、SelfRoot mechanism/meta tests；新增 Pi compaction、continuation、runtime layer、memory adapter/store 及 fixtures；同步 self-evolution 设计记录与 deferred research 状态。
- ARC 专属保留：共享 SelfRoot 的 `taskRuntimeView`/`task_runtime` 镜像与 execution grant；ARC adapter、action receipt、runner、Python/WASI 与 SelfRoot 持久合同继续留在 ARC 路径。本次未将通用 runtime layer 安装到 ARC runner，也未将它变成 session owner 或唯一 memory 存储。
- 排除：PPT extension/runner、自我演化 PPT adapter、案例 brief 和 PPT 效果测试未迁移。共享 META prompt 文件仍包含其既有 PPT 示例；ARC runner 当前使用自身 ARC 提示装配，不从这些共享 PPT prompt 文件加载。
- 验证：本次只完成静态合并与文件检查，未运行 tests。evo 侧原有 fixture 是源改动的一部分，不能视为本 ARC 工作树通过；本轮 provider behavior、Pi lifecycle 实际接线、continuation 语义连续性、Memory 采用与成本收益仍未验证。迁移后的静态检查结果在最终交付中单独报告。
- 后续边界：迁移设计记录含 evo 源工作区的实验与验收上下文，仅作来源/设计记录；继续维护 ARC 时优先看本文件的 ARC 范围和限制。延后项 A（ARC adapter 边界）及 D（压缩认知连续性）仍开放。

### Evo runtime 新增：从 ARC Python session 发布工具（2026-11-18）

- 来源：`origin/evo-loop-implementation` 新提交 `4bc48f56`（`Move session tool export into shared runtime`），父提交 `c2171e75`。
- ARC 迁入：通用 `reflect_component` schema 接受 `session_ref` 与单行 `description`；`NativeRuntime.resolveSessionToolOperation()` 从当前 Python session 导出函数源码，限制为 tool define/redefine、替换语义和合法函数名，再沿现有反射事务发布。PPT adapter 中的导出逻辑没有复制，ARC 使用同一 runtime 入口。
- 使用路径：Agent 在 ARC Python session 定义并测试 `(args, env)` 函数，然后以 `reflect_component(kind="tool", session_ref=..., description=...)` 发布；后续工具版本/装配仍由现有 NativeRuntime 路径管理。
- 验证：仅运行相关 TypeScript 语法检查和 `git diff --check`；未运行 ARC provider 或测试，因此 Python session 导出、反射激活及后续工具调用的全链路仍未验证。此能力不代表通用 Pi runtime layer 已安装为 ARC session owner。

### ARC 请求数与 review 工作集缩减（2026-11-18）

- 机会：用户报告 4 个动作前有 43 次 Python 调用（3/5/19/16），总计 51 次 provider 请求、约 2.2M input；dec3 的 19 次 Python 调用约 13 分钟，review working set 达 282KB。按用户要求未读取本地日志。
- 源码定位：Python 的 43 次调用均未保存组件，唯一重复代码仅 `show`；这更符合逐个验证一次性假设，而不是反复计算没有被沉淀。普通 native 决策的 16+4 工具上限不是本次根因。review 中 `dynamic` 从约 4.4k 增至 108.6k 后回落到 5.7k，说明整段 review 证据注入造成单次峰值；dec5 的 18 次请求、每次约 41k input 是独立的普通回合成本。
- 窄命题：在 Python 工具说明中明确同一观察下合并已知独立检查、只返回能改变下一步的结果；有新结果后产生的新假设仍可单独验证。review mirror 提供触发事实、指标/结果摘要、事实计数和精确 ledger 范围，按需读完整正文。预期 Python 往返下降，review 首轮输入明显缩小且关键证据可定位。若任务进展下降，或 review 补读成本抵消首屏节省，则修订/撤回。
- 负担/成本：不加新工具、调用门槛、组件发布要求或更低回合预算；Agent 继续决定检查顺序和证据深度。review 的摘要字段只转述已记录事实，不做策略解释。
- 验证边界：本次没有读取 run logs、没有跑自动化测试、没有启动付费 provider。`git diff --check` 与两个修改文件的 Node TypeScript 语法检查通过；往返下降、review 全程输入/补读成本、Agent 可读性、动作质量和净收益均未验证。下一次真实 provider 检查应对比每个 action 前请求数和任务进展，并记录完整 review 输入、补读次数和耗时，使用同 provider/model/初态/预算。

| 证据层级 | 状态 | Provider / environment | 产物及结论边界 |
| --- | --- | --- | --- |
| 功能正确 | 通过（定向） | Python pytest + Node tests | 初始 frame recovery、SelfRoot 首轮 action grant/镜像通过；完整 ARC e2e 文件仍有冻结旧路径失败 |
| 全链路可达 | 未验证 | 真实 ARC SDK 已启动；Pi 未启动 | bridge-only run 不证明 SelfRoot/provider/action 链路 |
| 自主采用 | 未验证 | 无真实 provider request | 无 Agent 行为轨迹 |
| 净收益 | 未验证 | 无对照 | 无任务质量、父子成本、延迟对照 |

## 交付决定

- 已支持和未支持的声明：实现已完成；定向功能检查通过；尚未证明 provider 到 action 的全链路、Agent 自主采用或净收益。
- 决定与依据：保留当前 SelfRoot 单视图接线；首轮 action grant、默认合同预算与 bridge 空 frame 恢复问题均已修正并有定向检查。
- 剩余验证与下一可证伪检查：从既有 AZ provider 配置取得 Pi 可用的 endpoint/key 后，以 `az` / `qwen3.8-27B` 和已授权预算启动一次真实 run，检查实际 request schema、SelfRoot mirror、动作 receipt 与 session 边界；不得用其他 provider替代。
- 关联 backlog：`docs/deferred-research-todos.md` 的 A（ARC adapter / Agent runtime / policy 边界）仍开放；B/C/D 本轮未改变。

## 2026-11-18 补充 · 连续 30 个 ARC 动作没有进入 pass

默认 ARC SelfRoot 以前只在已有事件和工作结算时进入 reflect。旧 runner 的 stagnation 还会因普通组件写入重新计数。用户要求给默认路径一个只按已执行动作计数的上限。

- ARC 在非终局、仍有动作预算的回执后检查间隔。SelfRoot 从持久化 ledger 回看最近一次自进化或 Agent 主动进入 reflect 的位置。累计 30 个动作就提交一次 `work_quantum`，已有过关自进化优先。组件写入不重置间隔。
- 复用 SelfRoot 的 review 队列、证据窗口、`decide_exit` 和恢复路径。等待和执行这次 review 期间，共用动作入口暂停环境动作。Agent 可以保持当前方法。额外成本是 review 占用的模型请求、时间与 token。`ARC_THIN_EVO_PASS=0` 关闭此兜底。
- 功能检查使用本地 Node、ARC 合同和持久化 SelfRoot，覆盖 29/30、恢复、重复排队和过关后的新窗口。没有启动付费运行。真实 Pi/bridge 全链路、自主采用和净收益待验证。
- 下一次真实验证需留出至少 31 个环境动作，并给一次 pass 和后续任务请求留预算。检查触发事件、模型看到的 review、关闭后的首个动作。评估净收益需比较相同初态、模型和总预算下开关兜底时的关卡进展、总 token 与延迟。

## 2026-11-18 补充 · 修复 SelfRoot 反射与工具运行闭环

- 真实机会及代码证据：ARC `reflect_component` 将一个 component operation 传给 `transaction()`，而该事务处理 `components[]`，导致 Agent 的有效 component 操作无法提交。即使直接写进 SelfRoot，`NativeRuntime` 原先只从 Binder 读工具，发布版本也不会成为下一请求可调用的工具。SelfRoot 的 ARC 统计还等待 `provider_input.component_delivery` 和 `component_execution`，ARC 原先没有这两类对应记录。
- 窄命题：通过 ARC 模型实际使用的 `reflect_component` 或 Python 保存入口发布一个工具后，修改先进入 SelfRoot 的版本历史；在下一请求边界，NativeRuntime 可注册并执行同一版本；SelfRoot 轨迹能关联它被展示和执行的版本。
- 实现：`reflect_component` 现在通过 `SelfRoot.reflectComponent()` 提交。ARC 合同新增 `components.tool` 写权限；既有运行目录只在旧合同内容及哈希精确匹配时，才迁移该单项权限并同步 SelfRoot 状态的合同哈希。NativeRuntime 保留 Binder 对旧组件的执行支持，并在工具注册/调用中合并 SelfRoot 拥有的普通工具；Python 的 `save=` 和组件文件写入走 SelfRoot 反射，不另写一份 Binder 版本。SelfRoot 默认路径隐藏旧 `promote`/`save_tool` 入口。ARC provider 请求记录准确的工具版本和哈希，NativeRuntime 每次工具执行记录相同版本的成功/失败回执。
- 生命周期：Agent 提交后仍在现有请求边界激活；只有边界激活后的 SelfRoot 版本才进入可执行注册表和后续 provider 请求。来源依赖不完整、组件验证失败或合同未授权仍会拒绝发布。
- 成本及限制：新增每次 provider 请求的版本化组件投递条目和每次运行工具的执行回执，成本为少量本地 JSONL/SelfRoot ledger 空间；模型调用路径不增加额外请求。此实现尚未通过定向自动化或真实 provider 验收；源码语法解析通过，`git diff --check` 通过。下一步验收是 ARC 真链路内发布 Python session 函数，并在后一个 provider 请求成功调用同一组件版本；失败时检查拒绝信息、工具未注册和 selfRoot 状态未激活。

## 2026-11-18 补充 · 移除 SelfRoot 自带配额与请求节奏阈值

- 问题：ARC runner 同时有真实环境动作/Provider 预算，SelfRoot 又用合同内 request/token/time/USD/storage 配额在 `pin()` 前硬停；它还按每个 work request 触发 `work_quantum`、每 3 个 settled request 触发 heartbeat、每 12 个 execute request 兜底触发 META pass，并限制 META 每轮和每个 specialist 的 provider request 数。它们会提前改写任务节奏或结束复盘。
- 改动：ARC SelfRoot 合同不再写入配额，`ARC_SELFROOT_REQUESTS/TOKENS/SECONDS/USD/STORAGE_BYTES` 默认值不再被读取；SelfRoot 只记录 request、token、耗时、费用估算和存储量，不据此停止。删除默认 work-quantum/heartbeat、12-request pass trigger 与 META request-count 自动结束。META round 1 由 Agent 通过 `decide_exit` 结束，specialist 在有修改或显式 no_change 时结束。
- 兼容：读取既有 ARC 合同时先验证 `content_hash`，确认除旧 `budget` 外其余字段与当前合同匹配后，移除旧配额字段、写入新合同，并同步迁移 SelfRoot state 的合同哈希。SelfRoot 构造时也丢弃旧合同中的 budget/heartbeat/segment/review 字段。PPT manifest 的实验限额仍由 PPT runner 作为外层授权预算执行；ARC runner 的环境动作预算、Provider admission/preflight、权限、版本哈希和 provider 输出窗口保留。
- 保留的节奏：用户此前明确要求的 ARC 30 个实际环境动作无 pass 兜底仍在 ARC adapter 内，不属于 SelfRoot 通用自动节奏。read_self 页大小与 context policy 的内容裁剪属于接口/上下文控制，不是运行 request/token/USD/time/storage 配额。
- 验证边界：本轮没有访问 run logs、没有运行测试或真实 Provider。静态检查已通过：本轮修改的 TypeScript 源文件及定向测试文件均通过 `node --experimental-transform-types --check`，`git diff --check` 通过。未运行测试或 Provider；合同迁移、无配额持续请求、SelfRoot 不自动派发 heartbeat/work_quantum，以及外层授权 runner 在边界停止的全链路仍待验证。

范围澄清：SelfRoot 不再设置 request/token/time/USD/storage 硬配额，也不再按固定请求数触发 heartbeat/META 或因请求数强制结束 pass。保留 ARC adapter 中用户此前要求的“30 个环境动作无 pass 时复盘”；它是 ARC 任务层触发条件。保留 read_self 页大小、上下文策略裁剪及 provider 输出窗口等接口/传输控制，它们不消耗或终止 SelfRoot 运行配额。PPT manifest/runner 和 ARC runner 的外层授权预算继续有效。