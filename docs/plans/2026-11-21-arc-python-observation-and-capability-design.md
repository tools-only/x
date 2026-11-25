# ARC Python、观测处理与持久能力的职责划分

日期：2026-11-21（Asia/Shanghai）。状态：观测发布、语义主视图和队列 2–5 的窄切片已通过生产 runner 接线验证；自主采用与净收益未验证。

## 问题与命题

在 `codex/arc-evo-middle-layer@833c59a` 的真实 az / Gemini `su15` 运行中，记录到第 42 个 ARC 动作时已有 226 次 `python` 调用；8 次被标记为完全相同的源码，3 次命中同状态缓存。更多调用虽源码不同，却反复遍历 64×64 网格、寻找颜色 6/9/11、计算包围框或重新打印局部画面。Python session 到 v154，积累了 98 个函数定义；模型仍继续写新的 `find_6s`、`get_6s`、`analyze_9_again` 等。此处的 226/42 是运行片段，不是最终总数；源码相同次数也低估语义重复。依据：`runs/arc-su15-evo-833c59a-az-gemini31pro-20261120/harness/{python_calls,python_session,component_runs}.jsonl`。

当前 `python` 同时承担一次性计算、持久交互式命名空间、`env.act`、`save`、合格函数自动发布以及组件原型验证。`PythonSession` 保存函数和值，却不说明哪项计算是之后每次观测都需要的事实，也不使其自动进入观测处理。已保存 tool 可调用，view 可在状态变化后自动运行，但 view 的输出追加到工作集，未成为 agent 可修改的观测语义处理路径。现有精确源码缓存只能识别相同代码和相同状态，不能覆盖重新命名、略改写法或下一帧的同一计算。

**窄命题：** 若 agent 可把需要随每个新观测更新的纯分析发布到一个任务内的 host 观测入口，而把按需推理方法发布为普通 harness tool/skill/memory，则后续动作前的重复网格扫描与 Python 请求减少，同时保留原始帧、权威状态和行动质量。若首次发布的成本、自动执行成本或附加上下文超过省下的请求，或关键观测被错误解释而损害行动，命题不成立。

## 方案选择

1. **仅加强 session 提醒和重复检测。** 改动最少，但 session 仍要模型再次调用；语义等价源码难识别，跨请求/关卡的适用性没有明确合同。
2. **推荐：任务局部观测程序加统一组件注册表。** Agent 直接写源码；host 在每次新观测处运行它，返回有界语义附注，随后正常装配到下一请求。普通方法继续发布为 harness 组件。沿用现有执行沙箱和版本能力，但不要求先经过 Python session，也不同时保留多条发布入口。
3. **允许 agent 任意改 runner/bridge 源码。** 表达力最大，但会把 ARC SDK 边界、动作执行、预算和原始证据一起变成任务内可改对象；无法稳定比较或恢复。首版不选。

## 两层设计

### Host 观测处理

Agent 可在任务内直接定义或修订一个 **观测处理程序**。它按工具组件版本管理，执行位置是 host 的观测边界，而不是模型临时调用。单一入口 `process(raw_observation, prior_state) -> {facts, state}` 接收完整的新观测和上次由同版本程序返回的 JSON 状态；`facts` 是有界的派生语义，`state` 可用于跨画面追踪对象，无须保留 Python 进程。初版不规定游戏对象本体，只要求结果可序列化和有大小上限。程序只读，不得调用 `env.act`、改写 ARC 状态、替换原始帧或修改计分。host 保存原始观测、程序版本及其状态，把结果标为派生解释，并记录失败、耗时和来源。程序失败时交付原始观测及错误摘要；下一轮仍可修订或撤下它。

这里的“改 host”指 agent 改变 host **实际执行的任务局部观测代码**，不要求改项目级 runner 文件。只保留一个发布入口：写指定任务局部源文件，由 host 检查、版本化并在下一观测边界激活；测试同一份源码，不从 session 复制函数。现有 view 的沙箱、调度、同状态去重和只读边界可复用，但结果必须接到观测装配入口，使下一请求自然收到处理后的语义。普通工具和观测程序共用一个组件注册表，差别只是运行时机。

### Harness 能力

不会每帧运行的分析方法、搜索策略或动作规划，保存在版本化 `tool` 或 `skill`；对象关系和已证实的关卡经验写入 `memory`。工具从当前状态或显式参数取输入，避免捕获某一帧的活变量。首版应收敛 `reflect_component(session_ref)`、`save_tool`、`python(save=...)` 和函数自动发布等重叠路径，留下一个直接从源码发布的组件入口，并清楚回执“已验证、已激活、何时自动运行或按需可调用”。Python 是执行语言和一次性验证沙箱，不是组件发布的必经中转站。

### 从原始观测到持久语义状态

默认工作视图应让 Agent 基于跨轮积累的任务认识和当前观测增量继续推理，避免每个 decision 从头扫描原始网格。观测摘要必须能追溯到原始帧、图像和动作回执；raw 证据仍按引用可取。Host 不根据 ARC 先验预设对象类别、关系本体、目标含义或固定 scene schema。

复用两种已有的持久承载，不再新建第三套可写真值。Agent 需要每帧计算或跨帧追踪时，自主发布 observer，并用它自己的 JSON `state` 保留本能力所需的机器状态；它定义 facts 的语义和形状。Agent 自主用 task memory 保存解释、适用条件、支持/反证、未完成实验和策略。Host 只负责 observer 版本与恢复、原始观测/动作的事实记录、引用、基本大小/权限校验和上下文装配。Host 可以提供网格、变化、可用动作等通用可核对材料，不能替 Agent 给像素分组命名。

每个 decision 的默认输入由 Agent 自选的 observer facts、按需投影的 task memory、当前动作反馈与预算组成。Host 自动标明它们的关卡、观测、observer 版本、动作编号和证据来源，并避免重发未变化内容。空间坐标不能脱离它所属的观测编号；动作后位置类结论要重新测量，语义假设由 Agent 决定是否仍适用。没有 observer 或 memory 的任务继续使用现有观测和接口，不因系统引入固定必填字段而增加预置能力。Agent 可在 observer 源码首行选择 `# semantic_view: on`，让当前成功、非空且有界的 facts 成为主视图；host 不自动创造语义，raw 网格/帧图像按需从精确文件引用读取。未选择或 observer 当前状态失败、为空、过长时继续给 raw 观测。

首个可证伪切片使用已有 `su15` 轨迹和一个 Agent 自选的最小 observer，比较原始网格与该 observer facts 对后续父请求的占用和任务连续性。验证重启恢复同版本 state、版本更换重置/迁移、observer 错误回退、动作后事实刷新、raw 引用可读和 memory 条件/反证跨轮保留。普通真实 provider 再核对它是否能依据摘要和增量继续假设与实验，以及输入 token、取证请求、有效动作延迟和关卡进展。若 Agent 未定义适用摘要或摘要丢失关键差异，保留 raw 查询入口，记录真实缺口并让 Agent 决定如何补充；不能把压缩率当成推理质量。

### 单次使用路径

模型发现同一种观测计算又出现，可直接写观测处理源码并用当前真实观测试跑；host 在下一次真实观测上执行已激活版本，保留原始结果，并把派生语义及版本交给下一次模型请求。若方法只在特定问题下有用，则直接写普通 tool/skill，模型在需要时调用。一次性验证留在无持久状态的 Python 沙箱。模型可选择不发布；host 不根据调用次数强制转换，重复记录只是供其判断的证据。

## 边界与成本

- 激活沿现有 SelfRoot 请求边界；同一请求内尚未激活的版本不可被当作已运行。修改程序版本时，旧版本的 `prior_state` 不自动传给新版本；可从下一观测重新开始，必要时显式迁移。关卡变化后输出带适用关卡/版本；不适用时由 agent 修订或停用。
- 原始 ARC 观测、动作反馈、预算和权限仍由 bridge/runner 负责；派生结果不可覆盖这些事实。观察代码只能读当前及已有历史，不得自行发起游戏动作。
- 每次自动执行有时间和输出上限；超过上限仍交付原始观测。初版限制为一个活跃处理程序，避免多份相似扫描与提示膨胀。
- 不把“大量 Python 调用”本身当成失败：一次性假设检验、代码验证、稀有查询可以留在 Python。负例包括处理程序输出恒定、跨关失效、同一网格不同反馈、帧缺失、重启恢复和程序执行失败。
- 不增加常驻反思轮、强制保存门槛或后台 worker。Agent 只需一次发布；host 负责后续调用和结果装配。

## 分阶段验证

先实现最窄的一条 host 观测处理路径，使用真实 ARC runner/bridge/Pi 的脚本 provider 检查：直接写源码、在当前观测试跑、下一真实观测执行、语义结果进入后续父轮、原始帧仍可读、版本切换、失败回退和重启。完成此路径后，才从 ARC 的模型工具面移除持久 Python session、`env.act` 与重复的发布入口；普通工具的直接源码发布和按需调用另行验证。

真实 provider 阶段用同任务和近似预算的独立运行比较：每动作 Python 调用及其语义重复、首次有效动作延迟、host 自动执行耗时与输出 token、父子总 token/墙钟、关卡/动作质量。明确统计合理的一次性 Python 使用和未采用机会。预算与样本数需在付费运行前单独确定；当前运行不能当作单因素对照。

| 证据层级 | 当前状态 | 依据与缺口 |
| --- | --- | --- |
| 功能正确 | 通过（语义视图路径） | 发布、版本切换、跨状态刷新、raw 引用、空/失败 fallback 在 production smoke 覆盖；重启沿用既有 observer 恢复验证。 |
| 全链路可达 | 通过（脚本 provider） | 真实 runner/bridge/Pi/WASI、mock ARC SDK；Agent 发布的语义视图确实替代文本网格并去掉图像，下一版本失败后 raw 网格/图像恢复。正式 ARC 环境未测。 |
| 自主采用 | 已测窗口未观察到 | 两次 az/Qwen 普通 su15 运行均在首个游戏动作前停止，未调用 publish_observer；不能推断后续机会的采用。 |
| 净收益 | 未验证 | 尚无相同预算、单因素比较。 |

## 首个实现切片（2026-11-22）

ARC evo 的普通任务轮新增 `publish_observer(name, body)`。Agent 直接提交 Python 源码，沿现有 SelfRoot 工具组件事务验证和版本化，并以现有 view 沙箱在下一请求边界的当前状态及每次新观测后执行。紧凑 ARC 任务观测现在把 view 结果交给模型。没有改变 Python session、普通工具发布、动作入口或进化轮策略。

功能及接线使用 `python tools/run_foundation_smoke.py runs/observer-direct-smoke-verified-20261122 observer uncapped`。该运行使用生产 bridge、Pi、SelfRoot、WASI，mock ARC SDK 和脚本 provider。脚本在任务轮发布 `grid_height`，观测程序分别在状态 0 和动作 1 后运行，下一请求均收到 `OBS_MARKER 8`。结果为 2 个环境动作、0 provider error、正常达到 3 个决策上限。相关 SelfRoot 测试 14 项通过，TypeScript 语法检查和 `git diff --check` 通过。

首个有 240 秒实验截止的 smoke 在第一条 Pi 请求前停下，原因是 runner 启动阶段的截止判定；无实验时限的同路径重跑通过。此结果证明脚本条件下的功能和接线，不证明真实模型会主动发布观测程序或带来游戏进展和总成本收益。负例、版本修订、重启恢复以及持久 session 的去留仍待后续切片验证。

## az / Qwen 真实运行（2026-11-22）

相同代码、官方 su15 环境、az 的 qwen3.8-27b、high/qwen 思考格式。普通任务运行，没有指定模型必须调用新入口。首次运行设 20 动作、40 决策、300000 已报告 token、1200 秒实验截止和 300 秒单轮上限。7 个已结算模型请求中 5 个完成、2 个用量未知，已报告 87445 token。第 1 决策内两次 Python、两次 read、一次 read_self 后，单轮超时中止请求；恢复请求报错，未知用量关闭共享预算。停止原因 provider_usage_unknown，0 动作、0 关，未调用 publish_observer。产物见 runs/arc-su15-observer-az-qwen38-27b-20261122。

为排除过短单轮上限，第二次保持任务、模型、思考格式和代码，改为 900 秒单轮上限、10 动作、30 决策、200000 已报告 token 和 1200 秒实验截止。9 个已结算模型请求中 8 个完成、1 个用量未知，已报告 114038 token。模型继续做 Python/read/read_self 调查；下一请求被本地 token 预留门槛拒绝，停止原因 token_cap，0 动作、0 关，未调用 publish_observer。产物见 runs/arc-su15-observer-az-qwen38-27b-retry-20261122。

两次运行均未到“新观测反复出现”的目标情境，故只能说明这两个有界普通运行中未出现自主发布。不能据此判定新入口对重复观测有无收益。第二次修改了超时和预算，不是独立同配置复现，也不是净收益对照。下一可证伪检查应在已产生重复观测的普通运行中对照新入口的发现和使用，再比较总成本与动作质量；当前不以增加提示或扩大本次付费预算弥补前段探索未进入游戏的事实。

相关延后事项：`docs/deferred-research-todos.md` 的 ARC adapter 边界、观测/上下文压缩和跨轮认知连续性仍开放。本设计只改变任务局部观测处理的执行位置与能力归属，不关闭这些更广的问题。
## 复核后的重构优先级（取代前文的固定单槽与强制迁移顺序）

范围为实际运行的 ARC evo 配置。注册了某个工具不等于模型在任务轮看得见它。旧 runner 的兼容入口可以保留在对应配置内部。

1. **先打通任务轮的直接发布。** 当前默认的 pass 模式允许有特定签名和文档的 Python 函数在任务轮自动登记，而直接反射修改通常要切换进化轮。建议让 agent 在普通任务轮用一次现有的版本化写入，直接提交自足源码和运行时机（按需或随观测）。同一份源码可在已记录的输入上预览。复用现有事务与回执，原型、预览、写文档和额外 META 回合都不作为发布前提。复杂的策略修订仍可请求专门的进化窗口。
2. **按观测版本计算，一次交付。** 事实由 agent 自选，host 负责执行、按版本去重和装配。相同观测的多个模型请求复用结果，动作后即使画面像素相同，也按新反馈处理。原始帧始终可取。前文的单槽仅是第一条接线样例，不应要求多个独立分析器合写一个函数。简单分析直接返回值即可，确需跨帧跟踪时才保存显式状态。
3. **试验环境与组件生命周期解耦。** 模型先得到直接源码路径。再单独比较短期 scratch session 与无状态执行。保温 Python 进程可节约启动成本，命名空间是否跨任务轮保留可独立决定。单次算式、一次性假设和正在调试的多步算法都无保存义务。移除裸 Python 的动作能力前，须确认已授权的具名程序仍能通过 bridge 获得逐步反馈并按条件提前退出，避免每个动作重新请求模型。
4. **减少模型管理自己的负担。** 实例里有 15 个 decide_exit、13 个 decide、16 个 read_self 工具结束事件，不能据此认定这些调用无价值。优先去除为了普通发布而切换模式的需要。其后单独比较有无独立退出调用、重复提示和定时复盘时的任务进展。将版本与重复证据保留在开发日志，已交付给模型的同组件同版本提示在同观测只展示一次。保留真实失败回执、反证和按需读取。

诊断限制：同一片段记录 330 个 decide_callable_schema 行，act_capable_count 均为零，但 Pi 日志包含 19 个 arc_action 结束事件。因此该字段不能直接衡量实际行动权限或阻塞时间。在取得正常授权内的可调用性和 bridge 回执前，不因这个指标放宽权限。

首个比较只改变“任务轮直接发布并绑定随观测执行”。用 su15 第 42 步回放核对颜色 6 的坐标和颜色 9 的范围，再在真实 Pi 请求中检查结果是否交付正确版本。普通模型的采用与净收益另用相同初态、模型、动作和计算预算比较，统计同一问题的再次求解、首次有效动作延迟、自动执行和模型总成本、关卡表现及失败样本。减少 Python、增加工具或减少退出调用都不能单独构成收益。其后分别消融 session 持久化和复盘策略，不同时改变三项因素。

## 运行事实反馈与自主调整

### 职责和交付

Runtime 从已有观测、工具、组件和动作记录中提取可核对的事实，附上发生位置和证据引用。Agent 判断缺的是观测、能力、装配、编排还是任务证据，决定继续行动、试验或调整。语义相似可作为线索，只有已核对的事实才写成重复、失效或不一致。

- **普通任务轮。** 在现有 Pi 请求装配处，将直接影响当前决策的新事实放入工作视图，优先交付一条短摘要。同一事实附带观测或组件版本，用于去重。比如同一画面上已有成功的等价查询，下一次任务请求可收到原结果的引用。首版以现有记录能证实的源码键和相同相关输入判断等价。相似源码只报告重合和引用。
- **已有自进化轮。** 在原有证据区展示跨观测或跨决策的模式，如多轮重复定位、组件运行后输出未交付、同一策略反复收到相似反例。只有自进化轮按现有路径开启时才装配这些证据。复用同一事实来源，保留引用供 Agent 按需展开。

两处交付均由请求装配负责。`WINDOW CHECK` 和工具回执维持现有职责。事实只供 Agent 判断和采取行动，提示本身不要求回应或另开一轮。

### 可扩展的事实和可调整的位置

| Runtime 掌握的事实 | Agent 可以进一步检查和调整 |
| --- | --- |
| 同一观测重复查询，或者一次查询多次回读结果 | 判断已有观测是否能回答问题。调整结果范围，若每个新观测都需要该结果则用 `publish_observer` 挂到 host |
| 组件已执行，但结果进入不了本轮请求，或版本与当前观测不一致 | 查看组件、执行和投递证据，修订挂载位置或输入选择。只有在实际使用机会可辨认时，才提示已交付但未使用 |
| 同类试验反复得不到可区分的反馈，或已有反例仍被重新检验 | 调整实验策略、按需能力或编排，把有适用条件的经验写入 memory，必要时改为能区分假设的实际动作 |
| 当前 host 未交付决策所需的原始证据，且任务局部观测程序无法获取 | Agent 可以指出缺失的数据、受影响的动作及已有证据。开发者负责现有授权边界以外的 host 修改 |

这些场景共用“事实、发生位置、证据引用”的反馈形式。各入口复用已有运行记录及对应权限。确定的结果可在相关节点重新取用，稳定方法可直接发布为版本化能力。长结果继续按需读取，普通任务轮可直接处理其权限范围内的调整。

### 首个检验

先用已有 su15 轨迹估算检测能覆盖多少真实重复和合理探索，再走生产 Pi 与 ARC bridge 的脚本 smoke。覆盖同一观测的等价调用、不同问题的连续查询、动作后重复代码、失败或写入操作。检查普通任务请求收到当前事实及可读引用，后续请求去重，已有自进化轮收到跨轮证据，任务动作与轮次调度照常推进。脚本验证功能和接线。

真实模型试验先只比较普通任务轮是否交付运行事实，固定任务、模型、原有自进化调度和总预算。对照同一观测的重复查询、首个有效动作前的请求数、总模型与工具耗时、关卡进展，以及 Agent 实际用了哪些证据和调整。已有自进化轮的证据交付单独检验。若有效动作变慢，或反馈未使后续任务更易推进，修订或撤下。单次实验未进入相关情境时标记该层未验证。预算在试验前确定，现阶段为设计。

## 请求合并与上下文复用

**主 session 与工具执行记录。** 当前工具可以在沙箱内执行，但 Pi 主 session 仍写入 assistant 的 `toolCall` 和对应的 `toolResult`，当前决策的请求投影也会带入工具交互。Qwen 重试的主 `session.jsonl` 有 10 条 `toolResult`。目标设计将详细输入、完整输出和执行日志留在现有工具产物与结果存储。主任务上下文接收本步所需的简短结果、错误或动作反馈以及可读引用。由 host 自动运行的观测程序将派生结果交付到工作视图。模型发起的工具调用依照 Pi 和 provider 协议保留配对消息；先通过现有请求投影裁减正文，再单独验证 Pi 原生 session 能否仅保存精简回执。按批保留结果身份和错误，核对引用在重启与压缩后可读。

Qwen 在首个动作前先后查看当前观测、ledger、decision:1 证据和 ledger 首页。日志能证明它发起了四次读取，具体哪些读取消除了不确定性要对照其后续动作和回答。ARC 的紧凑模式已经省略较早决策的历史，当前决策仍通过 `projectNativeDecision` 投影本轮的工具交互。仓库也保留了维持追加式前缀的理由：在旧实验中，每次改写较早消息会降低 provider 缓存命中。请求数、每个请求的重复内容和缓存后的实际开销应分开核对。

1. **合并已知输入的操作。** 同一观测上的独立读取、颜色和区域查询，可由 Agent 在同一条回复发起现有 Pi 工具批次，随后一次获得结果并继续决策。由运行时预先知道的观测计算或反馈摘要直接装配，免去为取回这些内容发起工具请求。首版复用已有批次和读取入口。若某个常见操作总是“生成长结果再读文件”，优先让该操作直接返回决策所需的有界结果。只有必须看前一步结果才能选择下一步时，才保留模型往返。会改变环境或共享状态的操作沿用现有顺序、权限和结果边界。
2. **给每条信息选一个主要交付位置。** 当前观测和最新的关键反馈留在工作视图。工具本轮首次返回决策相关的短结果，完整结果继续保存到现有 workspace。任务视图包含同一观测及同一版本的结果时，历史投影可用短引用连接对应原件。需要等待反证、尚未结算的动作或仍在使用的工具结果保留必要正文。先去掉同一请求中来自多个来源的重复副本，再单独比较较早工具结果是否值得在后续请求改为引用。
3. **按自然边界更新上下文。** 同一观测上的后续请求保持可缓存的稳定前缀。跨动作或已有自进化边界重新装配事实与必要历史。已有归档或投影能力可用于实验，核对结构化工具调用与回执仍配对，引用跨压缩可读，旧坐标不会冒充新观测。跨压缩后继续判断和使用原证据的效果属于现有连续性待办。

先做两组单变量检验：一组测独立工具读取合并，另一组测工具结果重复投递。用实际 Pi 请求检查同批读取只需一次模型返回，动作依赖和拒绝路径仍生效；检查当前事实仅交付一份，省略的内容可用原引用取回。真实模型对照记录有效动作前的模型请求数、已发输入量、缓存读入、未缓存输入、回读次数、总延迟和关卡进展。若减少投递字节后回读、重推或未缓存输入增加，以总成本和任务进展判断是否保留。两项设计复用既有任务轮和已开启的自进化轮。

## Qwen 同一 decision 的重复取证与推进阻塞（2026-11-22）

**现象和证据。** 在真实 az `qwen3.8-27b`、`su15` 样本中，首个 ARC action 前有约 20 个已结算 provider 请求、12 条 Python 执行记录和 4 条 `read` / `read_self` 记录。Python session 保留了同一 decision 的变量，Agent 也复用了它们；但一次性结果回执会省略长行或中间行，读文件成为再次取回结果的办法。轨迹中三类请求可分辨：先重新计算工作集已有的颜色统计并分析更细的形状；接着先用 dict 形式调用动作、再查接口签名，之后发现 Python action 落在 evolution review 暂停窗口；随后第 6 个 task request 触发 `request_cadence_fallback`，Agent 读取 ledger 并用多次 Python 解析，最后回到同一个点击实验。证据：`runs/arc-su15-az-qwen38-27b-selfloop-refactor-20261122/harness/{self_harness_task_facts.jsonl,python_calls.jsonl,working_set.jsonl,request-events.jsonl}`、`self_root/state.json` 与 `session.jsonl`。该样本中 memory 条目确实进入下一 decision，因此跨 decision 持久化不能单独解释同一 decision 内的重复。

**断点。** 一次性工具的完整输出保存在结果文件，但供后续 reasoning 使用的短答案可能被 240 字符回执、长行省略或 2K 读取上限截断；内容存在与模型可直接复用不是同一件事。Python session 变量保留中间状态，却未形成短、可寻址、按观测版本绑定的结论。通用网格事实不能回答语义几何问题。ARC evolution 仍配置 6 个 task request 的 cadence fallback，导致还未行动的普通执行流程切入调查/复盘，又引入新的 ledger 查询与状态恢复成本。session 配置曾允许通过 Python 执行动作，使 Agent 探查参数和跨暂停窗口错误恢复。

**设计。** 一个 decision 围绕同一 observation epoch 工作：host 向该 epoch 交付权威网格、动作范围、已计算的无语义统计及帧引用；Agent 以一个会改变行动选择的问题发起可并行的只读查询；工具先交付可直接用于决策的有界结构化答案，同时保留完整结果引用；已交付答案在该 decision 后续 provider request 继续可见，或由同观测、同组件版本、同参数的确定性缓存直接返回。查询标识 observation epoch，动作后旧结论显式过期或降为历史证据。Agent 产出实验意图及必要的跨轮认识；ARC action 工具执行动作并给权威反馈，普通任务和已有 evolution review 依照现有边界运行。request count 是成本/行为事实，不能单独暂停一个仍能执行的实验。

**实现顺序与证伪检查。** (1) 移除 ARC 实际路径上 6-request cadence 自动切换，保留显式 Agent 请求和现有任务反馈/完整性触发；production smoke 需证明第 6 个无动作请求不会开启 review，action 能沿当前 schema 执行。若无 cadence 后本应发现且可修复的问题长期不可见，应复查面向任务的事实交付，不能只恢复请求次数触发。(2) 改善同 decision 语义结果交付，分页读取准确保留请求范围，回执可返回小型结构化答案；production smoke 以两次不同 provider request 证明第一次答案可复用、完整证据仍能取回。(3) 对只读确定性查询按 observation/version/args 去重，动作后重新计算；负例包括不同查询、失败、写入和动画帧。(4) 连通跨 decision 工作记忆：实验、预期、实际回执、状态和未决条件在下一轮直接可见，并通过重启/压缩检查。(5) 核实默认 Python 无动作权限、正确动作 schema 与暂停时显式回执。每项独立检查后再进入下一项。

**真实行为与边界。** 当次真实运行用于诊断，不是当前代码的单变量对照，也没有成功通关。它显示接口调用失败、长结果读回和无动作 cadence review 共同增加了往返。后续实现须分别记录请求、工具执行、首次有效 action、重复结果读取和任务进展；仅降低 Python 计数不能证明收益。受支持的生产 Qwen 验收因 az HTTP 402 未完成，真实采用、任务质量和净收益仍未验证。

### 实现进度（2026-11-22）

**第 1 项：停止按 task request 数自动切入 ARC evolution review。** 删除实际 native ARC/SelfRoot 配置中的 6-request `metaFallback`。Agent 的 `request_evolution` 和动作/任务反馈触发仍由已有机制管理。本变更按真实 Qwen 中 action=0 的第 6 次 task request 意外切断已选实验这一事实实施，不改变 review 组件和协议。

生产 Pi/ARC bridge/WASI/scripted provider 检查：`python tools/run_foundation_smoke.py runs/arc-no-request-cadence-review-smoke-20261122-r1 runtime-evidence-review uncapped` 通过。该脚本明确请求进入既有 review 并能返回任务路径，证明显式入口仍可达；尚缺一个定向负例断言连续 6 个无动作 task request 不会自动进入 review。真实 Qwen 暂因 az HTTP 402 未复测。后续第 2 项先设计及实施当前 decision 内语义答案的持续交付，再进入重复只读查询缓存和跨 decision 实验状态闭环。

**第 2 项：同一 decision 保留最近两批完整工具结果。** Native provider projection 原将所有已完成批次在每个后续请求都替换成最多 240 字符的回执。现在保留当前 decision 最新两批 toolCall/toolResult 的完整配对，之前批次继续压缩并链接原件；下一个 ARC decision 仍只投影新工作集，旧调用和长输出不会整体重传。这样近期观察/ledger 查询结果可被同一轮随后推理重用，成本随轮内工具批次累积，需和回读成本一起比较。

针对性检查 `node --experimental-transform-types --test tests/arc_thin_native_context.test.ts` 通过（12 项）。生产链路 `python tools/run_foundation_smoke.py runs/arc-tool-result-reuse-smoke-20261122-r3 tool-isolation uncapped` 通过：summary 为 `passed=true`、3 actions、0 provider errors；context budget 显示每次请求保留两批，旧批次可从 workspace 恢复，最近两批的调用结果仍在后续 provider transcript 中可见。此为接线验证，真实模型是否少发重复查询及总输入成本变化仍待观察。

**第 3 项：跨 decision 的短期工作状态与长期认识复用现有 memory。** `strategy` 承载当前实验/下一步，按 active 和更新时间靠前投影；`hypothesis` 承载适用条件、下一测试和反证，最新 contested 项靠前；`fact` 作为长期认识保留在后。既有动作历史和回执提供 host 记录的实际结果，不复制完整 tool transcript。Agent 仍负责语义状态更新，系统不为每个动作新增一次强制 memory 请求。

### 实现增量：无 Python session 的同状态结果复用（2026-11-22）

**观察到的缺口。** ARC 默认使用的无 session Python sandbox 不保留调用间变量，也没有复用同一纯查询的结果；此前同状态缓存仅适用于 session 路径。修复后，普通 parent Python 调用可在 session 不存在时按精确代码键寻找结果，并进一步核对动作编号、完整 host state 摘要、session/workspace 版本。只有成功、纯计算、没有保存、动作或 host 写入的结果可缓存；新状态/写入后重新计算，失败结果不命中。设置 `workMemory=false` 仍可显式关闭。

验证：定向 Node 用例通过，覆盖状态内容变化但动作编号不变时失效，以及新动作轮次先计算再复用。生产 runner `python tools/run_foundation_smoke.py runs/arc-stateless-cache-smoke-20261122 python-stateless uncapped` 通过，summary 为 3 decisions、3 actions、0 provider errors；WASI 日志显示 stateless Python 对同一纯网格查询先执行一次，第二次命中缓存，而临时变量读取和无权限动作均失败且未被缓存。该链路使用实际 Pi/bridge/WASI、mock ARC SDK 与 scripted provider，只证明运行路径，不证明 Qwen 会选用 Python 或后续成本/任务质量改善。

### 实现增量：跨轮假设证据的紧凑投影

task memory 仍保存 Agent 写入的完整假设历史，但每个工作视图现只展开该假设的最新支持/中性结果及最新反证，并给出被省略数量和同一 memory key 的恢复引用。这样后续 decision 仍能看到当前结论与最新 counterexample，历史完整性不靠把所有旧证据每轮重传。相关 projection 测试通过，覆盖旧支持、较新反证、最新支持同时存在时的保留次序；`git diff --check` 通过。实际 Pi/bridge/WASI `hypotheses` smoke 跑到 9 decisions、10 actions、0 provider errors，working set 中确有 Agent 写入的 task memory；但旧 smoke 的更后续断言期待它在窗口内再产生一条 check 结果，该预期未满足，故将该 smoke 判为失败，不能作为完整 acceptance。此切片未由真实 provider 评估压缩后判断质量，完整证据仍须能够按引用读取。

### 后续实现队列

| 问题 | 已有措施 | 仍需实现/确认 |
|---|---|---|
| 同一 request 链中的 Python 重复 | 无 session 精确纯查询缓存；失败/副作用隔离 | 真实 Qwen 采用与总成本验证；语义相近但源码不同的重复仍由 Agent 判断 |
| 工具结果过早归档 | 完成批次默认不再以原始 toolCall/toolResult 重放；短助手回执保留摘要和原件引用；长回执首尾保留 | 验证真实模型是否因摘要读回而抵消上下文收益 |
| 跨 decision 状态和结论 | task memory/observer state 持久化；hypothesis 投影保留最新支持与反证；strategy 的 plan/note/steps、假设预测/下一测试、host 动作回执构成现有 checkpoint | 验证重启/压缩后 Agent 是否能继续使用这组信息；目前没有真实 Qwen 证据，不另建重复 checkpoint 存储 |
| 原始观测占用 | Agent 可发布持久 observer，跨帧增量 state 已保存 | Agent-authored 语义快照成为默认决策材料；raw 精确观测仍可按需展开；确认工作集不依赖不完整 delta |
| 自我评估与未解决问题 | 重复、失败、暴露/执行等运行事实可见，普通轮与已有 review 各可投递 | 让 Agent 可维护开放/已处理判断及修订后的后续证据，避免 host 替 Agent 诊断或判断价值 |
| 能力收益 | 记录版本、交付、执行、错误和部分组件反馈 | 把后续语义使用、行动影响、父模型与工具总成本接到可恢复评估中；合理不使用同样保留 |

依此顺序继续：当前 decision 关键答案 → 跨轮实验 checkpoint → memory/observer 选择和恢复 → 问题/能力反馈闭环 → 普通真实模型对照。每步保留原始证据和负例；provider credits 未恢复前，不把 scripted runner 的通过升级为自主采用或净收益。

## 已实施切片：运行事实与工具结果归档（2026-11-22）

任务观测装配现在把当前关卡中近 12 次 Python 调用里出现至少 3 次的代码结构族作为 `RUNTIME EVIDENCE` 附在普通 ARC `ch` 工作视图。每条说明来源 `component_runs.jsonl`、次数、一个短源码样例和解释边界：结构重合不等于问题相同。没有用 `WINDOW CHECK` 传递新机制或要求 Agent 回答。

复核发现实际 `SelfRoot.executionView()` 不会调用 ARC runtime 的 `selfMaterials()`；不能把该未接线函数当成已有 review 证据。现在同一 `RUNTIME EVIDENCE` 在普通 `ch` 工作视图中随观测交付，在已有 SelfRoot `ROUND 1 - REVIEW AND GAPS` 工作视图中也直接交付。没有新开轮次，也不要求 Agent 回复事实。

Pi 的 `tool_result` 生命周期钩子已确认运行在 session transcript 追加之前。其他非分页工具结果超过 900 字符时，workspace 保存完整内容，模型与 session 收到短回执、稳定 `results/` 引用和可读预览。短结果保留原文；`python` 使用自身的结果回执；`arc_action` 和显式分页 `read` 保留完整本步反馈。assistant 的 `toolCall`、参数和匹配的 `toolResult` ID 继续成对存在，符合 Pi/provider 协议。因此当前实现隔离了长执行输出，不是独立的隐藏 tool transcript；短结果与调用参数仍驻留主 session。

生产链路验收：

- `python tools/run_foundation_smoke.py runs/arc-runtime-evidence-ch-smoke-20261122 runtime-evidence uncapped` 使用生产 ARC bridge、Pi 扩展、WASI、mock SDK/scripted provider，三次相似代码结构查询的事实在后续普通任务请求可见，运行通过。设置 `ARC_THIN_OBSERVATION=ch` 才覆盖 ARC 主运行的紧凑观测通道；默认 query smoke 不覆盖该路径。
- `python tools/run_foundation_smoke.py runs/arc-runtime-evidence-review-smoke-core4-20261122 runtime-evidence-review uncapped` 使用生产 ARC bridge、Pi、SelfRoot/WASI 和 scripted provider，先制造三次相似结构调用，再通过现有 `request_evolution` 进入 review；实际 `ROUND 1 - REVIEW AND GAPS` 请求中出现相同的运行事实，`decide_exit` 后任务动作继续，运行通过。
- `python tools/run_foundation_smoke.py runs/arc-tool-session-isolation-smoke-accepted-20261122 receipts uncapped` 在生产 Pi restart/compaction 路径通过。恢复后的分页精读包含精确中间行；未分页长读取在 `session.jsonl` 中为短回执并保留结果引用；原文可由 workspace 结果文件精确恢复；Python session checkpoint 在重启后恢复。
- `node --experimental-transform-types --test tests/arc_thin_receipts.test.ts` 5 项通过；`TASK-EVIDENCE` 定向用例通过。完整 `arc_thin_native_runtime.test.ts` 有既存测试夹具未提供 `host.self` 的失败，本轮未改写其构造合同。

此切片仅证明功能和接线。smoke provider 是确定性代理，不能证明 Qwen 会使用事实、减少管理请求或提高关卡进展。工具调用参数仍在 Pi 主 session，纯短工具结果也仍以原文保存；后续若要进一步投影调用参数，须维持协议配对、精确结果引用、重启/压缩恢复，并测缓存命中和回读代价。Python session 的保留/移除、观测程序的版本/失败/重启全链路、独立读取的真实合并效果和真实 provider 自主采用均未由这些 smoke 关闭。

### az / Qwen 实际运行复核与会话隔离（2026-11-22）

按用户要求在官方 `su15` 上运行 az `qwen3.8-27b`（high/qwen），`ARC_THIN_OBSERVATION=ch`，最多 20 个动作、40 个决策，已报告 token 上限 300000，输出上限 8192。真实 provider 的 21 个已结算请求按运行的正式预算口径（未缓存 input + output）累计 217331 tokens；reasoning 30905 是 output 子集。第二决策另有一个尚未结算的流式请求。曾误把包含 cache-read 的累计 `total` 347507 当成预算计数，并在确认正式定义前手动停止；本次已结算用量未越过 300000 上限，但流式请求用量未知。此次没有正常终态或 `summary.json`，所以不能报告完成关卡数、最终得分或任务完成情况。原始产物：`runs/arc-su15-az-qwen38-27b-selfloop-refactor-20261122/`。

首个 ARC action 在第 20 个已结算请求之后发生。此前有 13 次 Python 调用（日志中 12 条 Python component 执行记录，另有调用/结果事件），包含多轮网格/斜线检查、错误调用 `env.act` 参数后再查签名、读取 provider 记录排查 action schema；随后进行了一次可撤销的背景点击探测。最终只有 1 个 ARC action，关卡未推进。首次 action 前请求数和分析成本明显偏高；由于运行被预算停止，且没有 matched-prefix 对照，不能声称任何设计改动导致了该结果，也不能评估最终解题质量。

此运行中主 `session.jsonl` 确实持久保存了工具调用参数与对应 `toolResult`。长结果在同一决策的后续请求里已变成短回执/引用，但完整 assistant `toolCall.arguments` 仍保留。上下文投影在 ARC 决策边界会丢弃之前决策的工具交互；同一决策为满足 Pi/provider 配对协议，仍保留调用与结果。故当前实现是**跨决策请求上下文隔离，加长结果归档**，不是独立工具 transcript 或独立执行 session。真正的 worker/broker 隔离还没有实现，也没有纳入本次可验证改动；不得把压缩回执表述为工具调用已从主 session 隔离。

这次真实 Qwen 进程启动时，review 通道还未改为直接装配 `RUNTIME EVIDENCE`；后续代码修复只由 scripted production smoke 验证，没有由这次 Qwen 运行验证。普通任务请求 smoke 证明普通工作视图可达，已有 SelfRoot review smoke 证明新 review 装配可达；本次真实模型是否看到或自主采用事实未知。可直接核对的问题是：first-action 前 20 次请求、13 次 Python、一次错误 action 参数探测；由于本次在第二决策进行中被提前停止，关卡完成率、后续是否使用运行事实、最终收益及工具结果重复对总成本的影响都未验证。

### 工具历史请求投影（2026-11-22）

为减少同一决策中 Python/read 等交互在后续 provider 请求中反复发送，native provider 投影将较早已完成工具批次替换为简短助手回执，保留结果预览与归档引用；当前决策最近两批完整 toolCall/toolResult 保持可见，使新取证可在同一轮直接复用。原始调用参数及完整结果仍保存在 Pi `session.jsonl` 和 `workspace/results/`，便于恢复与审计。运行配置和 `context_budget.jsonl` 记录已归档批次数及最近保留数。decision 边界继续省略旧决策的工具交互，以任务记忆和必要摘要承接跨轮认识。当前请求隔离的是模型上下文投影，不是物理上独立的执行 Agent、provider 或 Pi 持久会话。设置 `ARC_THIN_TOOL_HISTORY_ISOLATION=0` 可关闭投影。

复核 Pi `0.87.0` 扩展接口：`ExtensionContext.sessionManager` 是 `ReadonlySessionManager`，只暴露会话读取和 context projection；没有持久 session entry 的替换/删除入口。Pi 在 `message_end` 扩展事件之后立即将同一 `event.message` 追加到 SessionManager；`message_end` replacement 会原地改写 Agent 持有的消息对象，不是仅供磁盘存储的转换钩子，贸然移除 toolCall 可能改变后续工具调度或恢复语义。故当前选择保留完整 Pi transcript 作执行/恢复记录，并用有验证的 provider projection 隔离模型对话。若将来要求磁盘上的 Pi session 也不含原始调用，需要单独设计和验收可恢复的 tool broker/session owner；不能通过文本回执投影声称完成物理隔离。

### Python 执行环境生命周期切片（2026-11-22）

按“Python 是一次性验证沙箱，组件发布走直接源码入口”的优先级，ARC native 默认不创建 PythonSession/PythonKernel，不暴露 `save` 参数或 Python session 函数引用；每个 Python 调用使用新执行环境，名称和定义不跨调用保留。无状态 Python 调用只读、没有 `env.act`，不自动发布定义。`publish_observer` 与 `arc_action` 仍是各自明确的任务接口。旧 session 行为仅由显式 `ARC_THIN_PYTHON_SESSION=1` 兼容配置启用，供既有 session/动作循环 smoke 对照；WINDOW CHECK 不承载新机制。

验证：`node --experimental-transform-types --test tests/arc_thin_native_context.test.ts tests/arc_thin_observer_restart.test.ts tests/arc_thin_python_auto_component.test.ts` 15 项通过。生产 ARC bridge、实际 Pi、WASI 与 scripted provider 的 `python-stateless` smoke 通过，3 个决策、2 个 ARC action，检查每次 Python 为 ephemeral、后续调用收不到先前变量、不能通过 Python 动作、无 session checkpoint/自动发布，且直接观测发布和 arc_action 仍可用。结果：`runs/arc-python-stateless-smoke-20261122-r2/summary.json`。后续生产工具历史投影 smoke `runs/arc-tool-isolation-smoke-20261122-r4/summary.json` 通过：所有旧工具批次从 provider 的原生调用协议中移除，保留可读语义回执与结果引用；原 Pi session 仍保存全部 toolCall 参数和 toolResult。

stateless 首次 Qwen 尝试在 provider 错误前已将真实 request input 落入 Pi session；检查发现系统提示仍同时声称“Python persistent sandbox”、session 函数自动发布和 `env.act` 可用，尽管 `run-config.python_session=false` 且 schema 已移除 `save`。已修正 native prompt 的 Python、act 和发布说明，使它们跟随同一 session 配置。新的生产 stateless smoke 断言最终 provider input 不含这些旧说法，并读取到一致的“fresh, one-off sandbox / cannot act / no publish”说明；产物：`runs/arc-python-stateless-smoke-20261122-r3/summary.json`。Qwen provider 在模型回复前失败，不能证明真实模型看到或采用修正后的提示。

请求合并方面，Pi/ARC 已支持一个 assistant 回复包含多次工具调用，工具结果配对后再继续 provider 对话；`runtime-evidence-review` 脚本 smoke 使用三次 Python 查询与 `request_evolution` 同批调用，证明接线。该路径由 scripted provider 指定，不能证明 Qwen 会把可并行的查询放在同一批。当前没有自动把语义独立的跨轮请求合并的 runtime：仅在不依赖前一步结果时 Agent 才能预先成批，依赖结果的探索仍需串行。这一行为层差距保持未验证，不能把单批 smoke 当作真实请求数下降或成本收益。

进一步核对 Pi `0.87.0` 本地 extension 文档与生产事件：Pi 同一 assistant 消息默认并行执行 sibling 工具，tool_call preflight 按源顺序，tool_result 可按完成顺序交错，最终结果按原消息顺序配对。ARC 在 `pythonSession=false` 时不再用 PythonSession.exclusive 锁。`python tools/run_foundation_smoke.py runs/arc-parallel-python-batch-smoke-20261122-r1 runtime-evidence-review uncapped` 通过；production Pi 事件显示同一批 `python` 1/2/3 与 `request_evolution` 4 均先 start，随后 request_evolution 先 end，最后三个 Python end，支持这一批实际重叠。provider 请求批次和 ARC 动作结果仍按原顺序记录。此为 scripted batch 的功能/并行接线证据，不证明真实 Qwen 会合并读取或减少其请求数。

az Qwen 真实 su15 验证曾在 provider 额度阶段返回 HTTP 402 `openrouter_credits`，没有模型回复或 ARC action；不重试同一未变化的额度条件。stateless 功能与接线有确定性生产链路证据，真实模型采用和任务收益未验证。按设计，具名程序通过 bridge 逐步反馈并提前退出的专门负例尚未由此次 stateless 配置验证；Python 工具从默认无状态模式移除动作能力的广义行为收益仍待真实 provider 对照。

对当前 stateless 代码的第二次授权运行沿用 su15、az `qwen3.8-27b`、high/qwen、20 actions、40 decisions、300000 token 上限和 8192 输出上限。首个 provider 请求失败，stop_reason=`provider_capacity`，错误为“insufficient credits or output-token capacity”；0 个 ARC action、0 已报告 token、1 个成本未知失败请求，未观察到模型输出。产物：`runs/arc-su15-az-qwen38-stateless-20261122/summary.json`。该结果与先前无回复的额度拒绝重复；停止继续重试，待 provider 额度/容量状态变化后再测。

### 连续无有效 observer 输出的运行事实交付（2026-11-22）

**机会与窄命题。** 当前 runtime 已保存 observer 的执行、版本、状态和结果，但连续失败或空值只作为最新 observer 文本出现；Agent 不一定能看到连续状态范围及“已挂载却无可用输出”的事实。命题：在普通任务视图中，将当前版本 observer 连续无有效输出的状态范围、最新错误和 `observer_runs.jsonl` 来源交付给 Agent；以事实而非诊断呈现，并按同一版本/状态区间只登记一次投递。它不要求 Agent 回复或采取某个动作。

**实现。** `taskEvidenceText()` 现在将该运行事实放入普通 ARC `ch` 任务视图；投递标记持久化到独立的 `task_runtime_fact_delivery.jsonl`，并在 NativeRuntime 重启时恢复，避免同一事实被重新生成。observer 状态恢复测试覆盖连续失败及重启后不重跑已记录状态。没有在 WINDOW CHECK 引入机制。

**验证及边界。** `node --experimental-transform-types --test tests/arc_thin_observer_restart.test.ts` 通过。生产 ARC bridge、Pi、WASI 和 scripted provider 的 `observer-lifecycle` smoke 通过：`runs/arc-observer-empty-failure-evidence-smoke-20261122-r3/summary.json`；运行中 v3 observer 在状态 #2、#3 失败，普通任务输入包含连续失败事实和最新错误，delivery ledger 中该事实只有一行，3 个 ARC action、0 provider errors。该同一任务上下文在决策 6 的三个 provider 请求中均可见，因为 provider 每次调用需要携带完整会话上下文；这不是三次重新登记。smoke 使用 scripted provider，证明功能与生产链路可达，不证明 Qwen 会如何分析或修复。

| 证据层 | 状态 | 结论 |
|---|---|---|
| 功能正确 | 通过 | 连续失败范围、错误、证据来源展示；delivery marker 在重启后恢复；已记录 observer 状态不重复执行 |
| 全链路可达 | 通过 | 生产 ARC bridge/Pi/WASI/scripted provider 的普通任务路径到达 |
| 自主采用 | 未验证 | 本次为脚本 provider；真实 az Qwen 首请求因 402/额度错误失败，见 `runs/arc-su15-az-tool-isolation-real2-20261122/` |
| 净收益 | 未验证 | 未有真实模型对照、动作前请求成本及关卡效果对比 |

该设计切片已与方案吻合实现；不把 provider 协议要求的会话重发误报为事实再次生成。az Qwen su15 验收仍受账户 credits 状态阻断，只有额度/容量状态变化后才继续真实模型测试。

#### 当前代码的生产路径复核（2026-11-22）

在当前实现复核后，重新通过：`runs/arc-tool-history-final-isolation-20261122-r2/summary.json`（provider 请求不再包含旧批次的 native toolCall/toolResult，3 decisions、2 actions、0 provider errors）；`runs/arc-runtime-evidence-task-final-20261122-r2/summary.json`（普通任务收到运行事实，3 decisions、2 actions、0 errors）；`runs/arc-runtime-evidence-dual-surface-final-20261122-r2/summary.json`（已有 SelfRoot review 收到独立投递的事实，3 decisions、3 actions、0 errors）。三者均为 scripted provider 的 `ls20` 接线验证，不是 su15 的模型效果证据。最初复用已存在的 run 目录被 runner 拒绝，随后换用新目录重跑；目录拒绝未产生运行产物。

### Observer 显式 prior_state（2026-11-22）

原有 observer 可直接读取每帧观测并返回结果，但没有方案规定的跨帧 JSON 状态接口。现在可选定义 `process(observation, prior_state) -> {facts, state}`：`observation` 是本轮 host state；首次 `prior_state` 为 `null`，后续从同一关卡、同一组件版本的最近成功 `observer_runs.jsonl` 记录恢复。`state` 以 `observer_state` 写入运行记录，限制 8192 字节；`facts` 限制 4096 字节并交给 Agent，状态不进入任务文本。版本或关卡改变后不会继承旧状态。既有 print/observe observer 仍按原方式工作。异常或无效 envelope 沿用 observer 失败路径，不覆盖原始 ARC 观测，也不推进 prior state。

真实生产 runner/Pi/WASI 的验证：`runs/arc-observer-state-serialized-lifecycle-20261122-r8/summary.json` 覆盖 v1 跨帧递增、v2 版本切换后清空 prior_state、v3 执行异常及错误交付；`runs/arc-observer-state-serialized-restart-20261122-r6/summary.json` 在 Pi/runtime 重启后继续递增状态、同一 action count 不重复运行，并拒绝超过 8192 字节的状态而保留最后成功状态。模型请求收到 observer facts，不收到 host 保留的 `observer_state`。二者均 scripted provider、0 provider errors、0 level 完成，证明功能和接线而非游戏质量。`node --experimental-transform-types --test tests/arc_thin_native_context.test.ts tests/arc_thin_observer_restart.test.ts tests/arc_thin_python_auto_component.test.ts tests/arc_thin_receipts.test.ts` 共 21 项通过。

连续事实的投递键现在区分 `task` 和 `review` 面：同一事实在同一面按稳定事件标识只登记一次，但普通任务面已展示的事实仍可在已有 SelfRoot review 中独立出现。`runs/arc-runtime-evidence-dual-surface-final-20261122-r2/summary.json` 通过，并检查了 task 与 review 两类投递记录以及 review 请求中的语义事实。仍只由脚本 provider 决定如何行动，不证明自主修复。

相似 Python 结构提示也使用当前组件/关卡与最新调用事件作为投递身份，避免同一观察点无新证据时反复登记；新调用产生新事件后可更新事实。实际 producer/provider 请求检查分别由 `runs/arc-runtime-evidence-task-final-20261122-r2/summary.json` 与上述 dual-surface review 运行覆盖。发现 observer 状态必须在串行执行队列开始时读取 prior_state，排队时快照会丢失上一帧更新；已将读取移进排队任务，状态跨帧与跨重启 smoke 均已复验。

兼容闭环探针 `python tools/run_foundation_smoke.py runs/arc-python-session-compat-smoke-20261122 activation uncapped` 的 runner 输出了 `summary.passed=true`，但 smoke 的额外语义断言以 exit 1 结束：预期已发布的 `tools/probe.py` 在下一决策作为具名工具被调用，实际 action 轨迹仅最初两步来自 `tools/probe.py`，后续工具不在 provider schema；保存回执说它“staged for SelfRoot activation at the next request boundary”，但后续 `working_set.jsonl` 仍为 `active_components=[]`，随后记录 `Tool probe not found`。运行配置确认此探针启用了兼容 Python session，因此不能归因于 stateless 默认；根因断点在组件装配/激活到 Pi tool surface，Named tool 闭环未通过，需在继续移除动作循环相关兼容路径前单独定位。

尝试在下一 `before_agent_start` 同步刷新 Pi active tool surface 后，以新目录重复同一生产 smoke，结果完全相同；该临时改动已撤回。按开发流程停止对同一表面症状继续叠加刷新机制，需先选择是否单独授权定位 SelfRoot component activation / Pi tool surface 生命周期，或先保留当前兼容路径并仅验收 stateless 功能。

生产 Pi/ARC bridge smoke：`python tools/run_foundation_smoke.py runs/arc-tool-isolation-smoke-accepted-20261122 tool-isolation uncapped` 通过。第四次 Python 结果之后的实际 provider 输入里，前两次源码标记已被移除、对应完整调用可由引用恢复，最新两次调用与结果仍配对；动作及后续自进化轮照常运行，0 provider error。归档原件检查确认两条完整调用及对应结果都可读。投影单测 11 项通过。该 smoke 验证功能和协议接线，不证明 token 成本、缓存命中率或真实模型的任务质量改善。

重启/压缩回归 `runs/arc-tool-isolation-restart-smoke-20261122-r2/summary.json` 通过。重启后的真实 provider transcript 仍收到精确分页内容 `COUNTEREXAMPLE_MIDDLE_EXACT` 和恢复后的 Python 值 `[[41,1],42]`，且完整原件仍可从归档读取。初次回归失败是旧断言仍检查 `last_tool_results` 原生结构；改为检查 provider 实际收到的助手回执后通过。故模型请求上下文已与原生工具调用/结果批次隔离，并保留可理解回执；Pi 持久 session 仍记录完整工具协议，物理 session 隔离尚未实现。现有协议可并行执行 Agent 在一次回复中提交的独立调用，但真实轨迹中可安全合并的操作数量及对请求成本的影响尚未测量。

#### 最终代码的真实 provider 尝试

使用最终 request-projection 代码在 `su15` 启动 az `qwen3.8-27b`，high/qwen，未缓存输入加输出 300000 上限，首次 provider 请求即返回 HTTP 402：账户没有已购 credits。该失败请求无可计量用量；运行记录为 1 次未计量失败、0 次成功模型响应、0 动作。provider 的错误正文在 `session.jsonl` 明确指出 credits，不是输出长度不足；没有降低参数重试或购买 credits。因此本次代码的真实 Qwen 行为、请求成本、动作和关卡收益均未验证。产物：`runs/arc-su15-az-tool-isolation-real2-20261122/`。

### 同状态重复输入事实（2026-11-22）

普通任务和已有 SelfRoot review 的 `RUNTIME EVIDENCE` 现在还可展示同一任务决策中、从同一可见 ARC 状态发出的完全相同 `python` / `read` 输入。Pi `tool_call` 前置事件记录 action count 与状态摘要；`tool_result` 记录参数摘要、回复摘要、调用 ID、结果引用和失败标记。host 按状态、决策、工具名及参数摘要归组；事实包含调用 ID 与原件引用，并明确不判断这是否浪费。发送给模型的任务提示不包含开发流程，记录只是判断材料，不要求回复。

生产链路验证：`runs/arc-runtime-evidence-repeat-smoke-20261122-r4/summary.json` 使用真实 ARC bridge、Pi、WASI、mock SDK 和 scripted provider，确认同状态完全重复的 Python 与分页 read 输入事实进入后续普通 ARC 请求；2 个动作、0 provider error。`runs/arc-runtime-evidence-repeat-review-smoke-20261122-r7/summary.json` 确认两类事实都进入已有 `ROUND 1 - REVIEW AND GAPS`；6 次模型请求、3 个动作、0 provider error。检查两份 `self_harness_task_facts.jsonl`，状态摘要与 call id 对应重复调用，read 原件引用可见；provider transcript 中可看到归组事实。针对性单测通过。

第一次 review smoke 因测试 provider 仍只识别原生 `toolResult`，工具投影后便重复调用 `read_self` 并产生数百请求。没有把它计作通过；provider 脚本现同时识别原生结果和归档助手回执，重新运行限制在预期的 6 次请求内并通过。该差异确认归档回执是模型可见语义路径，要求所有 scripted 行为断言检查实际投影内容。完整 `arc_thin_native_runtime.test.ts` 仍有旧夹具未提供 `host.self` 的失败；本轮定向新测试通过，未扩大处理为修补所有旧夹具。

这只覆盖**完全相同输入**的运行事实，不报告语义相似代码、不同查询、重复回读或组件输出未进入请求等未经验证的结论。scripted smoke 不证明真实 Qwen 会采取行动；真实自主采用与净收益仍未验证。继续检查应使用未强制重复工具的 su15 普通运行，比较适用机会、Agent 的处理选择及父子总成本；当前 az 账户仍因 HTTP 402 无法完成该层。

### 固定观测代码与同状态请求复用（2026-11-22）

用户补充的运行约束：Agent 不应在每个 request 临时生成并执行一遍观测代码。只有当 Agent 判断某种分析值得持续复用时，才发布/修订 observer；host 按组件版本保存并在新的 ARC 状态上执行一次。执行身份是 `observer path + version + action count`：同一状态上的多个 provider request 以及同一进程重复到达该边界都复用当前结果；新状态继续运行同一程序，并把上次成功的 `state` 作为 `prior_state`。运行结果和状态由 `observer_runs.jsonl` 持久化，重启后恢复。普通 request 读取语义 facts 和既有 task memory；一次性计算仍可用 Python，但不会自动变成逐 request 任务。

该区别也适用于上下文成本：observer **没有再次运行**，不等于底层 provider API 一定只传增量。当前 Pi 会按 provider/session 协议组织历史；request-history projection 会归档旧工具协议并保留语义回执，但不能仅凭同状态缓存宣称 provider 没有重放先前消息或 token 成本已经下降。当前决策头保持冻结、observer 结果作为其观测材料；跨 decision 由新状态的 observer facts、observer `prior_state` 和 task memory 接续。是否能进一步降低 provider 上下文重传，要看具体 provider 的缓存/增量协议，并单独测量。

**验证。** 新增 `arc_thin_observer_restart.test.ts` 同进程回归：连续三次在相同组件版本/状态调用 `observe(4)` 只产生一条 `observer_runs.jsonl`，后续边界读取同一输出。此前生产 bridge/Pi/WASI 重启运行 `runs/arc-observer-state-serialized-restart-20261122-r6/summary.json` 与其 observer 日志覆盖跨 action state 递增、重启恢复、同 action count 不重跑及状态大小上限。以上为实现与接线证据；scripted provider 不证明 Agent 会自主发布合适程序，az Qwen 的采用、成本和关卡收益仍未验证。

同日按用户要求再次启动真实 `su15` / az `qwen3.8-27b` 普通任务窗口（high/qwen，最多 12 actions、24 decisions、450k reported-token 上限、20 分钟）。首次 provider 请求返回 HTTP 402，错误正文明确为 OpenRouter account has insufficient credits；1 次失败请求、0 成功响应、0 ARC action、0 level，reported tokens 为 0，实际计费成本未知。产物：`runs/arc-su15-az-qwen38-27b-observer-reuse-test-20261122/summary.json`。这是重复的额度阻断，不继续重试或购买 credits；真实模型采用与任务质量仍未验证。

### 实现增量：跨 decision 的长结果回执保留末尾结论（2026-11-22）

此前工具结果截断只保留前缀，导致长结果末尾的短答案可能丢失。新增共享 `boundedResultPreview()`，用于旧批次归档回执和随动作批次交给下一 decision 的短结果：在有限长度内保留开头与末尾，中间注明省略字数，完整结果仍可通过 workspace 引用恢复。短结果保持原样。针对性 Node 用例通过；`python tools/run_foundation_smoke.py runs/arc-cross-decision-result-preview-smoke-20261122 tool-isolation uncapped` 通过，真实生产 Pi/bridge/WASI 路径为 3 decisions、3 actions、0 provider errors。该 smoke 的结果短，故长结果尾部本身由单测覆盖，不能声称 Qwen 采用或成本收益。实现：`demo/arc_thin_native_context.ts`、`demo/arc_thin_extension.ts`；测试：`tests/arc_thin_native_context.test.ts`。

### 实现增量：未解除运行症状持续出现在后续边界（2026-11-22）

此前 runtime 将 observer 连续无输出、已暴露但未执行的组件当作“一次事实投递”：即使症状在后续 decision 仍存在，也因 delivery marker 不再出现。现在这两类事实按持久日志/当前组件版本重建，并在每个新的普通 task 或已有 SelfRoot review 边界持续呈现；当 observer 产生有效输出、组件执行或不再满足暴露条件时，事实自然消失。没有新增 issue 数据库、强制 Agent 回复或 host 诊断；普通 Python 重复与精确相同输入仍是一次性证据，避免把所有事实都变成持续提醒。

单测覆盖 observer 跨重启持续、task/review 都可见，以及组件暴露差距持续到执行闭合。首次生产 smoke 暴露旧验收只期待一次投递；更新为断言跨边界再次可见后，`python tools/run_foundation_smoke.py runs/arc-active-runtime-issues-smoke-20261122-r3 observer-lifecycle uncapped` 通过：6 decisions、6 actions、0 provider errors；生产 provider transcript 在连续失败状态增长时多次包含 observer 问题及最新错误。结果证明事实交付与恢复，不证明 scripted Agent 会修复或真实模型会认为该事实重要。下一项继续检查 Agent 自定义的 observer 语义是否能成为默认工作视图而保留精确 raw 状态的按需可达性。

### 本轮继续实现：checkpoint、问题引用、上下文与能力反馈（2026-11-22）

**跨 decision checkpoint（队列第 2 项）。** 不新建 checkpoint 存储；当 Agent 已有 active strategy 时，从同一 `memory.jsonl` 派生一个短条目，将策略计划/步骤和其明确依赖的假设状态、预测、下一测试、最新支持/反证以及各假设的完整恢复引用合并展示。相关假设不再重复单独列出，其余假设和事实保持可寻址。增加可由 Agent 更新的 `strategy.note`，用于记下实验结果或计划变化。生产验证 `runs/arc-experiment-checkpoint-smoke-20261122-r4/summary.json`：4 decisions、3 actions、0 provider errors；provider 后续输入包含更新后的 contested 假设、最新反证、下一测试、strategy note 和历史动作回执。单测 27 项通过。该 smoke 的 scripted provider 按预设顺序执行；不能证明真实 Agent 会持续写 checkpoint 或压缩后推理质量改善。

**运行问题跟踪（队列第 3 项）。** 连续 observer 故障和跨多个请求仍未执行的已暴露工具现在具有稳定引用，例如 `runtime:observer:<path>@<version>` / `runtime:component:<path>@<version>`；Agent 可把引用放进已有 hypothesis/strategy，由 status、测试结果和 strategy note 表达原因、修复、放弃或后续检查。host 仍只保留客观症状，并在症状解决/版本执行后闭合；没有新建 issue 数据库、自动诊断或必答流程。组件执行后，普通 task 视图追加执行状态、执行时 action count、之后环境动作数及当前 receipt 的定位说明，让 Agent 判断实际效果。生产 smoke `runs/arc-runtime-issue-refs-smoke-20261122/summary.json` 覆盖可恢复稳定 issue 引用；`runs/arc-component-use-feedback-smoke-20261122-r2/summary.json` 覆盖真实组件执行后的反馈进入 ch 任务输入，7 decisions、8 actions、0 provider errors。

实现中发现并修正一个边界：不能把“首次暴露后从未执行”错误地重新触发为 issue，因为该版本后来再次出现于 tool schema；首次暴露后有任一执行记录即关闭该未使用 issue，改由执行反馈继续跟踪。普通行为只有在生产 smoke 明确选择 `ch` observation 时才能证明 runtime evidence 进入任务文本；`query` 路径没有被该 smoke 证明，不将它计作全模式覆盖。

**上下文传递度量（队列第 4 项，测量切片）。** 新增 `harness/provider_context.jsonl` 与 summary 聚合：记录每次最终交给 provider 的 payload/message 字符数、工具 schema 字符、相邻 payload 的完全相同消息前缀/复用消息/非相同后缀和哈希；跨进程恢复只保存最后一份消息哈希与长度，不落盘消息正文。生产 `tool-isolation` smoke 的一份报告显示 7 requests、100,309 serialized message chars，其中相邻请求精确重复消息字符 55,939、公共精确前缀 52,629；这些是该 scripted 样本的结构统计，不是 token 节省或真实 provider 成本。reported token 与账单仍使用各自的 usage/settlement。provider context smoke `runs/arc-provider-context-accounting-smoke-20261122/summary.json` 通过；request accounting 单测 7 项通过。工具交互的物理 session 隔离尚未实施；要先用真实模型对照总输入、回读、延迟及任务进展后决定投影边界，不能把删除短期结果直接称作收益。

**能力反馈（队列第 5 项，当前覆盖 tool）。** task/runtime 输入在同一版本 tool 执行后报告执行成功/失败、action count、之后发生的环境动作数，并提示比对 action receipts；run summary 按 path/version 聚合暴露次数、执行次数、成功/失败、之后动作数、action `via` 精确匹配以及 active strategy 的显式 `uses` 引用。报告明确这是时间关联，非因果归因；现阶段不同组件类别仍主要有 created→used 计数，memory、prompt、skill、subagent 的语义影响以及父/子成本分摊未实现。production smoke `runs/arc-component-use-feedback-smoke-20261122-r2/summary.json` 检查实际 component event、task feedback 和报告汇总；request accounting/feedback report 单测 7 项通过。

| 队列 | 当前状态 | 未关闭部分 |
|---|---|---|
| 2. 跨 decision checkpoint | 从已有 Agent memory 派生 active experiment checkpoint，strategy note 可续写；生产 scripted smoke 通过 | 真实模型重启/压缩后的自主续接与净收益未验证 |
| 3. 问题反馈闭环 | 运行事实稳定引用并持续到客观症状闭合；Agent 可复用 hypothesis/strategy 表达判断与修复 | 自主识别/处置没有 Qwen 证据；针对“无关/稍后处理”的显式 disposition 尚未独立建模 |
| 4. 上下文与工具隔离 | 完成批次的工具协议历史默认从后续 provider 消息移除；相邻 payload 复用度和长度持久记录 | 同一执行内正在等待的工具结果仍按 provider 配对协议返回；真实 token/延迟/读回净收益待真实模型对照，字符比例不能替代 provider usage |
| 5. 能力反馈 | tool 版本暴露→执行→后续动作关联及 summary 聚合已实现 | 其余组件类别的语义使用、保持/修订/退休证据，合理不使用，以及父/子全成本仍待实现 |

本轮相关验证：`tests/arc_thin_memory.test.ts` 27 项、`tests/arc_thin_observer_restart.test.ts` 3 项、`tests/arc_thin_native_context.test.ts` 14 项、`tests/test_arc_thin_request_accounting.py` 7 项通过；生产 checkpoint、runtime issue、tool capability、provider context 四类 smoke 均通过。最终组合检查 `runs/arc-context-capability-final-smoke-20261122/summary.json`：7 decisions、8 actions、0 provider errors；26 requests、727,622 serialized message chars、330,127 个相邻请求复用消息字符（不等于 token 节省），tool compare v1 暴露 12 requests、成功执行 1 次、之后 6 个环境动作。Qwen 真实测试仍被先前 HTTP 402 阻断，未由本轮重试或升级为行为/收益证据。

### Agent-authored semantic view 成为可选主观测（2026-11-22）

**真实问题与命题。** 已有 Agent observer 每个新 state 执行并输出 facts，但默认仍把完整 HEX 网格和图像附在同一请求。Agent 可以把每帧必需的语义计算持久化，却不能据此减少 raw observation 输入。窄命题：由 Agent 明确选择 semantic view 后，仅在当前 observer 版本于当前 action count 成功产出非空且长度不超过已有回执边界时，让该结果替代网格、变化帧和图片；未选择、stale、空值、失败或过长时原样回退。该机制不检查 Agent 语义是否正确，质量仍由行动反馈检验。

**实现。** `publish_observer` 接受源码首行 `# semantic_view: on`；observer 仍是 Agent 定义、版本化并提供 `process(observation, prior_state)` 语义的通用程序。Host 只选择是否用其事实替代 raw payload。成功视图旁保留当前准确帧 `data/frames/<action-count>.json` 及新近动画 `data/observations/<step>.json#frames` 的按需引用；状态、动作列表和 recent action receipts 继续传递。语义输出可用状态从 `observer_runs.jsonl` 重建；失败时不缓存语义主视图。Agent 不选择时现有 raw 网格/图像完全不变。没有新建 ARC 对象本体、预置语义字段、窗口检查或另一个持久化库。

**验证。** `python tools/run_foundation_smoke.py runs/arc-observer-semantic-primary-accepted-20261122 observer-semantic uncapped` 通过：生产 ARC runner/bridge、Pi、SelfRoot、WASI、mock ARC SDK、scripted provider，5 decisions、4 actions、0 provider errors。实际请求确认语义版输出 `SEMANTIC_BOARD marker=0/1` 时无 HEX 网格和图像，精确 raw 帧引用随 state 编号变化；发布的新版本故意报错后，provider 输入恢复原始网格及图像，并携带 observer 错误。非语义 observer 路径仍由 `observer-lifecycle` smoke 覆盖。该证据证明功能与接线，不证明模型会自发采用、observer 语义正确或任务/成本净收益。Qwen 实际结果仍受先前 az HTTP 402 credits 阻断；本轮没有真实 provider 采用实验。

### 工具协议历史默认隔离到归档回执（2026-11-22）

同一决策中，已完成的 `toolCall/toolResult` 批次现在默认在下一次 provider request 中全部替换为助手文本回执；回执保留有界首尾摘要和精确结果归档引用。Pi session 仍持有完整工具协议供恢复审计，当前正在执行的 tool cycle 仍遵守 provider 的 call/result 配对；完成后的原始调用参数与正文不再反复进入后续 provider 输入。可用 `ARC_THIN_RECENT_TOOL_BATCHES` 显式保留最近 1+ 批次做对照，`ARC_THIN_TOOL_HISTORY_ISOLATION=0` 可关闭投影。

生产验证：`python tools/run_foundation_smoke.py runs/arc-tool-session-zero-history-smoke-20261122 tool-isolation uncapped` 通过，3 decisions、3 actions、0 provider errors；后续 provider transcript 不含 4 次 Python 调用的源码标记和任何原生 `toolResult`，4 条调用/结果均有归档引用且完整原件可读。报告记录 7 requests、98,349 serialized message chars，其中 56,288 exact repeated message chars、54,826 common prefix chars；零批次重放并未消除工作视图/系统消息重传。Provider token 仍只有 scripted smoke 的 reported 值，真实模型是否少读回、成本或延迟是否净下降仍待对照。

这完成了工具**历史内容在后续 provider context 的隔离**，不声称建立了物理分离的 provider/Pi 主 session；正在执行的那次工具调用仍属于主模型协议。结果压缩后，过早重复取证风险由归档回执、完整精确引用、跨 decision checkpoint 与生产负例共同约束。后续真实验收需要对比 0/1/2 retained batches 的父模型请求、read/Python 回调、输入/cache usage、延迟及 ARC 进展；credits 状态恢复前不以 scripted 对照定净收益。

### 实现增量：SelfRoot 自读分页与自进化问题续接（2026-11-22）

**真实问题。** `read_self(section="self")` 直接序列化整个 `mirror()`，同时携带静态结构、活动状态和多页台账；Pi 的结果压缩面对一条过长 JSON 行时可能只留下整条省略提示。一次自读因此既贵又不能可靠回答当前问题，容易引出重复读取。普通任务的 runtime issue 已能出现，但进入 SelfRoot 自进化视图时 extension 将 `taskObservation` 清空，事件没有到达 Agent 的 PASS ENTRY。issue 投递标记尚未用于 active observer 和已暴露未调用组件，完全相同的现象会在每个 review 边界重新出现。

**窄命题与负担。** 一个短且稳定的 SelfRoot 自我目录首屏应能支持 Agent 定位组件、判断目前记录到“暴露/读取/执行/结果”的哪一层，再按需分页或展开源码/定义；同一 runtime issue 在证据未变化时只投递一次，变化时可重新投递，并从任务轮进入自进化轮。推翻条件包括首屏仍超出实际回执边界、定义/账本不可按引用恢复、或持续 issue 因去重而在新证据后不可见。

**实现。** `SelfRoot.detail("self", offset, count)` 从已有 `reviewSelfView()` 派生不超过 8 个条目的有界索引，当前值过长时返回其精确读取入口；页面说明包含组件暴露、Skill 正文读取、执行、语义使用未知状态、相关证据和结果引用。策略/定义/台账/组件内容仍分别由现有接口精确读取，无新存储。自进化执行视图合并 PASS ENTRY 与 extension 传入的 runtime evidence；runtime issue 首次投递及其状态键进入既有 `task_runtime_fact_delivery.jsonl`，同证据不重复，状态/错误/暴露范围变化后重新投递。普通任务和自进化入口共用同一客观证据文本，Agent 负责诊断、处置与验证，host 不判定 issue 重要性或组件是否语义有用。

**运行前验收协议。** 先验证读页边界、超长定义展开引用、自进化 PASS ENTRY+issue 合并、同证据去重、重启后的投递去重以及新证据后的再次投递；负例包括合理不使用、已闭合执行、无变化 issue 和具体状态变化。再用真实 ARC runner/bridge/Pi、scripted provider 与 mock ARC SDK 检查实际 provider payload；provider 不得被脚本强迫读取每一页或执行一个组件。运行产物必须按生产接线与模型行为分别声明。真实 Luna/Qwen adoption、token 成本、延迟、压缩后策略连续性及关卡效果不属于本次 scripted smoke 结论。

**待验证与边界。** 跨请求消息重传字符统计不等于 provider token/cache 成本；非 tool 组件的语义使用无法由交付/读取事实机械归因。待做相同真实 provider/任务下的输入与成本对照，另检查真实 Agent 会否自主使用或合理不使用 SelfRoot 索引、issue refs 和能力反馈。相关延后项仍开放：父/子全成本与 session 压缩后的认知连续性见本计划前文“工具协议历史默认隔离到归档回执”，observer 与 observer outcome 的真实自主使用见“Agent-authored semantic view 成为可选主观测”。

**验证结果。** 定向 Node 检查 6/6 通过，覆盖 self 目录分页、SelfRoot review 合并任务 runtime 证据、相同 issue 投递跨重启去重及变化证据再次可见。生产 `arc-thin-e2e` smoke `runs/arc-runtime-evidence-self-index-smoke-20261122-r6/summary.json` 经真实 ARC runner/bridge/Pi、WASI、scripted provider 和 mock ARC SDK 通过：3 decisions、3 actions、0 provider errors；Pi 实际 tool receipt 单行展示 self 目录、页码、逐组件暴露/读取/执行状态及展开入口，没有整行省略。provider 交互串行化字符为 86,211/5 requests，仅作结构审计，未测 provider token 节省。生产 `runs/arc-runtime-issue-dedupe-smoke-20261122/summary.json` 通过：observer issue 新状态持续出现、同一内容不重复，6 decisions、6 actions、0 provider errors。此前执行的宽测试集共 55 项，发现本次新增的自进化夹具缺少有效 review trigger，已修正并在上述 6 项定向检查通过；另有 14 项旧 NativeRuntime 测试因其 fixture 未传入当前必需的 `self` adapter 失败，以及一个现有 P5 使用契约断言失败，均未纳入本次行为改动，故不声称宽套件全通过。

| 证据层级 | 状态 | Provider / environment | 产物及结论边界 |
| --- | --- | --- | --- |
| 功能正确 | 通过 | Node targeted tests | 有界索引和交付去重路径通过；上述旧套件失败保持开放 |
| 全链路可达 | 通过 | ARC runner/bridge/Pi/WASI + scripted provider + mock ARC SDK | 两个生产 smoke 覆盖回执和 issue 持续投递；脚本不证明模型采用 |
| 自主采用 | 未验证 | 未运行真实 provider | 不知道真实 Agent 是否会按需翻页、诊断 issue 或决定不采用组件 |
| 净收益 | 未验证 | 未运行真实 provider 对照 | 字符统计不是 token/计费/延迟结果；无任务质量对照 |

### 短工具答案与 issue 引用续接（2026-11-23）

**事实与窄命题。** `gpt-6-luna` 的 su15 普通运行在 10 个动作内有 37 次请求、29 次 `read_self`；一条实际 `read_self(section="self")` 回答长 599 字符，而下一次 provider request 的工具归档预览仅 240 字符首尾，目录中部被丢弃。同一 decision 在工具协议隔离后仍应看到完整的短答案，完全重复的短结果应指向第一次答案，而非再堆一份正文。若实际 provider 输入缺答案，或原生工具调用协议配对被破坏，则此命题失败。基线只有单次真实 Luna 轨迹，不据此判断调用量因果。

**实现与成本。** 已完成工具批次仍按原路径归档；不超过 700 字符的工具文本在首次回执中完整保留，后续相同工具名、参数、结果只留下首次回执的精确引用。较长结果继续保留有界首尾和原件引用。没有新增模型轮次、工具或提示。`read_self` 只缓存同状态的不可变 ARC 历史和证据；SelfRoot 索引、策略与台账可在同一决策反思后变化，不再复用旧值。ARC 历史分页现在真正按新到旧交付，并正确给出下一页偏移。

**issue 可追踪性。** observer 连续空结果的交付事件现在记录稳定 `runtime:observer:<path>@<version>`；组件未执行 issue 以 path/version 保持同一个 ref，即使暴露证据增长。报告按同 ref 合并交付、Agent 引用、memory 记录与后续客观行为，observer 后续产出非空值和工具后续执行分别记为 `produced_output_after_delivery` / `executed_after_delivery`。这两个状态只表示症状变化，不推断 Agent 已解决根因或组件带来收益。重复调用的必要性、合理不使用和语义价值仍交给 Agent 判断。

**验收协议与结果。** 功能检查：短答案与重复答案的 provider 投影、长结果的首尾、历史分页和 issue 报告；负例是可变 SelfRoot 读页不缓存。真实链路使用生产 ARC runner/bridge/Pi/WASI、mock ARC SDK、scripted provider，在 `tool-isolation` 和 `runtime-evidence-review` 场景核对动作和请求。当前功能检查 21 项 Node、8 项 pytest 通过；`runs/arc-short-answer-continuity-20261123/summary.json` 为 7 请求、3 动作、0 provider error，`runs/arc-short-answer-review-20261123/summary.json` 为 3 动作、0 provider error。组件场景 `runs/arc-issue-ref-component-20261123/summary.json` 为 8 动作、29 请求、0 provider error，同一组件版本在两次变化的暴露证据中保持同一 issue ref；报告状态 `unresolved`，没有把暴露误判为执行。observer 场景 `runs/arc-issue-ref-observer-20261123/summary.json` 为 6 动作、9 请求、0 provider error，同一版本连续三次症状更新保持同一 ref；报告仍为 `unresolved`。scripted provider 不证明 Luna 会减少重复读取。真实 provider 的自主采用、10 动作调用数对照、输入 token/cache、延迟及任务进展仍未验证；需要相近预算的独立对照后才能决定净收益。az Qwen 的前次运行因 HTTP 402 未开始，不能借作行为结果。

| 证据层级 | 状态 | Provider / environment | 产物及结论边界 |
| --- | --- | --- | --- |
| 功能正确 | 通过 | Node / pytest | 投影、分页及 issue 报告的定向检查 |
| 全链路可达 | 通过 | 实际 ARC bridge/Pi/WASI + scripted provider + mock ARC SDK | 两次 smoke 有动作且无 provider error；未按脚本强制真实模型使用 |
| 自主采用 | 不确定 | gpt-6-luna 两次独立探索运行，见下节 | 模型仍多次回读；旧轨迹引用与长历史截断是混杂 |
| 净收益 | 未验证 | 无独立真实 provider 对照 | 无 token、延迟及关卡收益结论 |

### ARC 历史读页在同一 decision 的完整交付（2026-11-23）

**真实反例与命题。** 短答案修复后的一次 Luna su15 运行（`runs/arc-su15-openai-gpt6-luna-short-answer-20261123/run1/summary.json`）完成 10 动作、20 请求、8 次 `read_self`、151,970 reported tokens、0 关，但 `arc_history` 在已发生动作后仍返回空数组；根因是工具安装时捕获了 `replay()` 替换前的轨迹数组。改为读取活轨迹后，第二次独立 Luna 运行（`runs/arc-su15-openai-gpt6-luna-live-history-20261123/run1/summary.json`）完成 10 动作、26 请求、10 次 `read_self`、218,338 reported tokens、0 关。动作 #1 后能读到真实历史；但在 decision 5，3 个动作的 JSON 历史超过 900 字符工具内联上限，先变成文件回执，后续 provider context 又只保留 240 字符首尾；同一页被读取 7 次。因此命题限定为：历史读页应在首次调用及同一 decision 后续请求里提供足够的动作答案，原件仍按精确引用恢复；不声称模型一定停止重复读取。

**实现和代价。** `arc_history` 每页最多 10 条，返回从新到旧的紧凑动作行（动作、坐标、变化格数、是否过关及 transition 引用）、最新 note、下一页偏移；其结果保持在 900 字符工具回执内，并在完成的工具批次归档后完整进入下一次模型请求。同输入同结果的下一次回执指向第一次答案。`transition:N` 的动作后展开直接给 outcome、note 和准确 `data/frames/N.json` 引用，逐格网格按需读取，避免在 note 前再次截断。没有新增提示、模型轮次、硬门禁或常驻组件；分页与展开是 Agent 按需选择。

**验证和边界。** 23 项针对性 Node 检查通过，覆盖活轨迹、10 条长 note 历史页上界、分页、短答案及重复回执。生产 `arc-thin-e2e` smoke `runs/arc-history-delivery-accepted-20261123/summary.json` 用实际 ARC runner/bridge/Pi/WASI、mock ARC SDK 和 scripted provider 完成 4 动作、7 请求、0 provider error；实际后续 provider 输入含 `#3`、`#2`、`#1`、`next_offset` 和首个答案，重复调用只保留首次回执引用；动作后证据直接含 note 与准确帧引用。脚本用于证明接线，不证明真实 Luna 的回读会减少。新格式尚未用真实模型跑独立对照；即使未来请求数下降，也须连同关卡进展、父子总成本与延迟评估，不能只比单次 token。

| 证据层级 | 状态 | Provider / environment | 产物及结论边界 |
| --- | --- | --- | --- |
| 功能正确 | 通过 | Node targeted tests | 历史页、活轨迹及回执的定向检查 |
| 全链路可达 | 通过 | 实际 ARC bridge/Pi/WASI + scripted provider + mock ARC SDK | 4 动作、7 请求；后续 provider 输入可见完整答案 |
| 自主采用 | 未验证 | 最新格式尚未运行真实 provider | 不知道 Luna 是否停止重复读取或合理选择展开 |
| 净收益 | 未验证 | 无最新格式的真实独立对照 | 不作 token、延迟或任务收益结论 |

### `read_self` 按需查证界面（2026-11-23）

**问题与窄命题。** `read_self` 同时可读 ARC 旧动作/转移和 SelfRoot 组件、策略、台账。真实 Luna 运行中 11 decisions 有 10 次调用，其中 7 次集中在同一 decision；这不是每轮的必要步骤。普通任务的 Host 工作视图已有当前观测、最近动作结果与任务记忆，却还每轮附上 SelfRoot `full_self`、ledger、policy 读取目录。窄命题是移除普通任务头里的重复读取目录、保留可调用工具及 review 的自检入口，使模型把 `read_self` 视为缺少具体证据时的补查。若任务请求仍呈交静态目录，或 review 失去读取入口，接线命题失败；真实调用下降另行验证。

**职责、成本和选择。** Host 按 phase 装配：普通任务只交付现场与已有结论，自进化继续交付 SelfRoot 的具体 detail 入口；Agent 决定何时需要更旧历史或能力诊断。复用同一个工具与权限，不添加第二套读取工具、强制门禁、模型轮次或每轮提醒。工具说明改为按需查证，并明确工作视图已含当前材料。`read_self` 仍在普通任务工具表里，Agent 可以在发现缺口时自主读取，不因隐藏入口而失去能力。

**验证。** 生产 `arc-thin-e2e` 的 `runs/arc-read-self-on-demand-accepted-20261123/summary.json` 使用 ARC runner/bridge/Pi/WASI、mock SDK 与 scripted provider：普通任务 provider 输入无 `full_self` 目录，review 输入有 SelfRoot detail，二者都提供按需工具；3 动作、0 provider error。历史读页回归 `runs/arc-history-after-on-demand-20261123/summary.json` 通过：4 动作、7 请求、0 provider error，后续请求仍保留完整动作答案。脚本验证接线与可达性；真实 Luna 是否减少回读、父子总成本和关卡收益均未验证，本改动保持实验状态。
