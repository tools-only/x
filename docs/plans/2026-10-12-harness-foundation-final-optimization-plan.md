# Harness Foundation Final Optimization Implementation Plan

> 开发 Agent：使用 superpowers:executing-plans；这些是开发流程要求，不进入 Pi 游戏上下文。2026-10-13 用户已授权实施，并重启一次普通 ARC 实验、开启 compaction。

**Goal:** 修复普通 ARC 运行的恢复与证据摩擦，使 Agent 优先用 self-harness 沉淀并复用可检查的重复流程，减少基础工作消耗的推理 token，把推理用于规则发现、条件化检验和任务推进，并独立验证总成本与任务收益。

**Architecture:** Pi 保留 session、协议、原生压缩和消息交付；runtime 负责版本、完整结果、执行归位和机械证据。父 Agent 兼顾任务进展和推理效率，选择实验、将可复用方法沉淀为组件、优先使用适用组件并判断知识修订，critic 提供可核查的建议。保持 workspace/WASI 隔离、单步 ARC 边界及一条 create–edit–use 路径。

**Tech Stack:** Python runner/bridge、TypeScript Pi extension、Pi 0.87.0、现有 WASI Python、官方 ARC SDK；真实观察基线为 yibu/qwen3.8-27b/high-qwen。

---

定稿日期：2026-10-13，Asia/Shanghai；文件名沿用2026-10-12证据批次。状态：实现与最终工程验收中；自主采用和净收益待验证。采用现有工作树 `D:/autoresearch_pi_compaction_fix_20261012`、分支 `codex/native-compaction-fix-20261012`、计划检查基线 `f843cddd`。保留已有未提交文档修改。原真实运行源和原 checkout 不修改。

证据与实施状态的唯一记录是[实现报告的 O01–O20 清单](../reports/2026-10-12-harness-foundation-implementation.md#ordinary-ls20-failure-and-optimization-backlog-2026-10-12)。本文件规定决策、任务和验收，不复制另一套待办状态表；后续 red/green、smoke、实际配置和真实行为产物回填同一报告。

## 1. 问题、命题、边界

37/100 动作、0关、136.1分钟、3,239,113 已报告 token 的普通真实样本揭示三类问题：可恢复故障触及终生恢复额度；取证/修订被引用、回执和旧流程配额阻碍；程序与 critic 的结果未可靠推进到条件化知识和下一实验。存在两个取消和一个未完成请求，完整成本未知。左下变化确实存在，但本方案不据此推断游戏规则或写入解题提示。

总命题：移除已确认的机械摩擦，保留精确证据与上下文连续性，可减少非游戏管理往返。Offload命题：Agent优先复用适用组件，把预期重复的方法沉淀为可执行/可读组件，可减少后续基础流程的重新推导；计入投资和调用成本后仍有收益，且不损害证据与任务判断。语义命题另外检验：对前提、实际变化和反例作正确对齐，能改善后续实验选择。进一步的净收益命题需要任务效果与父/critic/consult/compaction 总成本共同支持。上述命题分开判定，不能用恢复次数、组件数或低 token 替代游戏进展。

### Self-harness的核心目标：推理效率与offload

用户进一步明确：Agent应主动考虑自身推理开销，面对预期重复的基础流程，优先使用self-harness避免每次重新推导。该目标贯穿B/C/D，不是可靠性修复完成后才附加的可选指标。A仍是可用底座；基础修复通过后尽早检验O14/O15，不必等待所有语义候选完成。不同主要因素仍独立实验。

当前native系统提示列出了组件路径、签名和激活方式，但没有明确表达这种成本意识和复用优先级。普通真实样本中的21次Python和没有可复用候选暴露了待诊断机会；其中用同一算法处理新状态本身是必要计算，候选负担是父反复推导方法、重写代码和重建流程。该机会与延后B/C/D的证据到使用、总成本及压缩后的方法连续性直接相关，尚未验收。

Agent的决策偏好是：先判断已有适用方法能否直接复用；没有时，把预期继续使用、且可检查的方法一次沉淀到最小合适载体；后续以当前输入运行或读取它，把注意力放在结果意味着什么、前提是否改变及下一实验。无需每步复述这套判断、填写ROI字段或获得额外批准。一次性、变化快、难以验证或投入无法摊销的工作允许直接推理；适用且预期减负却持续从头重建，应作为自主采用缺口调查。

| 重复负担 | 优先复用的既有载体 | 留给Agent的判断 |
| --- | --- | --- |
| 坐标/计数、网格差分、过滤与一致性计算 | lib/typed tool；每状态确实需要时使用observer | 对象解释、适用范围、是否值得持续输出 |
| 有条件的规则检验与历史反例检查 | memory中的check及其增量结果 | 前提是否忠实、反驳范围与下一实验 |
| 重复调查步骤和已经澄清的操作方法 | 按需skill/指令文件，必要时其中代码复用lib | 选择流程、处理新情况，避免照抄过时步骤 |
| 已获得的认识和取证 | memory/notes及精确results引用 | 当前是否仍适用、是否需要新证据 |

可机械执行的计算优先移交现有WASI/runtime；把同样推理交给另一个模型不自动等于节省。consult保留用于确有价值的独立语义判断，费用与管理负担一起计入，不为offload新增worker。自动observer尤其需要比较每状态执行/输入输出成本与实际用途；只有偶尔需要的方法适合按需tool。

投入判断的概念式为：`创作+验证+维护成本 + 预期复用次数×每次调用/读取/结果解释成本 < 预期复用次数×每次重新推导成本`，同时要求任务质量、状态新鲜度和引用可靠性不下降。Agent可以作粗略判断，不要求它预测精确token或每次计算公式；开发验收用实际provider账、工具耗时和行为轨迹检查该命题。基础流程被替代后，Agent可能把释放的推理用于更深入实验，所以分别报告重复负担变化、总成本和任务收益。

目标不是停止看原始证据，也不是重放旧reasoning。组件保存方法和可核查结果；变化的输入必须重新计算，新的解释和选择继续由Agent推理。输出短而够用、按需取回全文，避免用长observer输出和重复读手册抵消offload收益。

固定边界：

- 父 reasoning 保持 high-qwen；默认不重放历史 reasoning。不自动降低 thinking 或增加 reasoning/整场 token 上限。
- 真实探测沿用最大100动作、无整场时间/token/decision上限偏好。动作计入 RESET；WIN 或环境原生终止可以提前结束。每次新付费启动及样本数需明确授权，本轮不启动。
- 网络/单请求故障检测、有限连续恢复和工具沙箱限制不是整场资源预算，分别写进启动配置。提供显式关闭单请求 watchdog 的选择，不把 `0` 回落成默认。永久故障、用户取消、秘密/源码漂移或环境结果不确定可停止，并明确停止原因。
- 当前 full grid 保持最新消息可见；本路线不默认隐藏网格或增加图片。PNG 输入按所选模型已支持的 modality 协议，当前 text-only 基线不能证明图像路径。
- Auto-Research 继续弃用；不新增研究 worker。consult 保持显式一次性、无 ARC 动作权限。
- memory 独立存储结构化认识，trajectory 独立记录动作；notes 保存自由文本，不要求把信念复制成 notes。
- 不增加 publish/revise、SDK、强制晋升阶梯、必须创建组件、固定周期 critic 或自动按语义删除组件。
- runtime 对账不是上游 action 幂等保证。外部动作可能已发生但结果未知时，停在未知状态，不能靠重试赌一次性执行。

## 2. 方案选择与不采用的合并设计

| 路线 | 判断 | 原因 |
| --- | --- | --- |
| 在现有 Pi/workspace/ledger/critic 上修缺陷、删重复手续、逐项验证 | 采用 | 直接覆盖真实断点，控制接口增量，先兑现已有能力 |
| 一次建立五级晋升阶梯、推理主题触发器、primary view、特殊模型协议 | 不合并实施 | 自主采用原因尚未确定；会同时改变观测、提示、义务和组件协议，难以归因 |
| 降 thinking、限制整场 token 或引入更多 worker | 不作为本路线 | 用户偏好保持；缺少对照收益证据，且增加资源/管理变量 |

保留推理能力与把可重复计算交给 agent 写的代码相容。但“34.6%坐标推理”等前21动作词面分类只能定位候选，不能当可节省 token 的承诺。惊讶后的解释生成与实验选择不能完全由历史回放代替。

## 3. O01–O20 的执行映射

| 执行阶段 | 清单覆盖 | 交付和证据边界 |
| --- | --- | --- |
| A：可诊断、可恢复、可对账 | O01/O02/O03/O05/O06，O11中的删除回执缺陷 | 可靠性修复与确定性故障验收，不声称游戏能力改善 |
| B：精确读回、原生压缩、减少旧手续 | O04/O07/O08/O09/O16，关联O17/O20 | 每项独立改动；compaction是已有修复的集成验收，不重新实现 |
| C：条件化知识和实验修订 | O10/O11/O12/O13 | 机械完整性与语义质量分别验；check是已有能力，不是新入口 |
| D：推理效率、主动沉淀与offload | O14/O15/O18，贯穿B/C | 父优先复用适用组件、按预期摊销选择投资；WASI先量再优化，合理非用纳入结果 |
| E：真实连续性、收益和生命周期 | O17/O19/O20，贯穿全部阶段 | 普通真实样本与单因素对照；五类功能回归不等于五类自主使用 |

O11补充子项：`planNativeMemoryUpdate(op='delete', delete=[...])` 会先校验空单条删除，造成“成功删除 + 未应用”的矛盾回执；已有真实轨迹和最小 native/legacy 差分复现。把它提前到 A，不把语义采用实验排在坏回执之前。

## 4. 实施规则与产物

每项功能/行为改动按同一顺序：保存真实失败 → 在正确调用边界写失败用例 → 确认 red → 最小修正 → green → 受影响的真实 Pi/bridge/WASI scripted smoke → 回填报告 → 独立 commit。不同主要因素不混为一次收益实验。小文档改动只做链接和差异检查。

开发日志留在 workspace 外的 run-root；游戏 Agent 不看本方案、O清单或 AGENTS.md。拟新增诊断产物 `request-events.jsonl`、`settlement.json`、`result-index`、WASI分项耗时均由 runtime 机械维护，不要求父填写。新增文件如确有必要再创建，不搭通用调度/分析框架。

## 5. 阶段 A：先让失败可定位、恢复不重复动作

### Task A1：修复 native memory 删除回执（O11子项）

**Files:** `demo/arc_thin_native_memory.ts`；`tests/arc_thin_native_memory.test.ts`；`tools/arc_thin_smoke_provider.ts`、`tools/run_foundation_smoke.py` 的 native 场景。

最小修正方向：批量 `delete` 不额外生成空单条操作；真实空删除仍报错，真正的混合有效/无效条目仍分项反馈。

```ts
if (params.key !== undefined || params.text !== undefined ||
    (params.op === 'delete' && !(params.delete?.length))) {
  apply('entry', { op: params.op, key: params.key, text: params.text,
    confidence: params.confidence });
}
```

测试：单 key、批量 keys、空 delete、混合 set/delete、不存在项、部分字段错误、捏造 action 引用整批拒绝；同时比较保存后内存与重放结果。验证成功删除回执没有假“NOT changed”，后续实际 Pi 请求看到删除结果。

运行：`node --experimental-transform-types --test tests/arc_thin_native_memory.test.ts`。先看到真实模式的断言失败，再修复；通过只声明这个 adapter 模式正确。

### Task A2：请求阶段观测与统计对账（O02/O05，O18观测基础）

**Files:** `src/autoresearch_pi/pi_kernel.py`、`src/autoresearch_pi/arc_thin_e2e.py`、`demo/arc_thin_extension.ts`、`demo/arc_thin_native_runtime.ts`、`tools/arc_foundation_runtime_audit.ts`；`tests/test_pi_kernel_idle_timeout.py`、`tests/test_arc_thin_lifecycle_stats.py`；拟新增 `tests/test_arc_thin_request_accounting.py`。

一个调用记录 `run / decision / logical_request / attempt / kind`，kind 区分 parent、critic、consult、compaction。重试产生新的 attempt；逻辑父决策和 canonical action 保持不同计数。已有真实 provider response ID可关联但不能取代本地attempt ID。

记录单调时间：请求发送、可观测响应头、首stream片段、最后片段、工具开始/结束、abort请求/确认、Pi settlement、usage结算、终止阶段。使用现有公开 registry/transport/事件，默认只写时间、状态和长度；密钥、Authorization、bridge token不入日志。未暴露的 HTTP 阶段标 `unobserved`，不从 `message_start` 冒充响应头或首token。不能patch依赖或改变provider行为来伪造覆盖。

成本字段允许 `null`，另记 `reported / partial / unknown` 与终态 `completed / aborted / failed / unsettled`；aborted 的零usage但已有stream内容标为完整成本未知。reasoning是output子集；cache是否计入input按当前Pi字段明确分开。summary给出已报告下界及未知请求数，不虚构计费单价/总账单。定期summary带更新时间和settlement状态，退出时对账全部attempt，包括取消和失败compact。

复现本次样本应精确得到90父请求=87正常+2取消+1未完成、另2critic、37双侧动作；known总量3,239,113。测试无响应头、慢首片段、流中停顿、正常长流、投影丢delta、取消无usage、多attempt同逻辑请求。观测必须不改变tools/prompt/动作；日志开销单独测，不靠关掉故障保护掩盖等待。

### Task A3：恢复以当前连续故障为边界（O01/O03）

**Files:** `src/autoresearch_pi/arc_thin_e2e.py::safe_turn`、`src/autoresearch_pi/pi_kernel.py`、`src/autoresearch_pi/cli.py`、`tools/run_foundation_real.py`；`tests/test_pi_kernel_idle_timeout.py`；拟新增 `tests/test_arc_thin_recovery.py` 和实际 runner故障场景。

选择：删除“整个运行恢复累计>=2就终止”的 gate，累计次数仅统计。每个逻辑请求最多2次连续恢复；一次正常结算结束该组计数，后续隔离故障有自己的机会。2026-10-13首场真实样本揭示900秒限制整个Pi决策中的多次provider/tool调用，而不是单个请求；不能将仍有进展的长调查判为卡住。按用户无时间上限要求，普通真实协议采用decision_timeout_seconds=0，保留180秒无事件idle保护。CLI显式整轮deadline只用于另外指定的有界诊断，不隐式恢复到正式运行。每个attempt、整轮决策和累计计数分别标注；失败分类写具体阶段，而非都归为Pi崩溃。

恢复顺序固定：停止旧stream → abort后等真实settlement → 同步bridge动作与轨迹 → 验证已提交动作/公开状态 → 保留session和workspace → 继续未完成操作。成功arc_action已提交时，交还该动作结果并走下一正常决策；不重发原动作，也不为了恢复额外调用模型。只有Pi进程确实死亡且bridge状态可确认时，重启Pi加载原session；不重启游戏。单纯一次idle不new_session。

不可恢复：bridge结果uncertain、源码/权限/秘密异常、状态对账冲突、连续恢复耗尽或用户取消。保留现场并停止；不把上一帧当最新，不重复外部动作。request ID只用于对账，不能宣称SDK提供了idempotency key。

测试先构造三个彼此隔开、均可恢复的idle，第三组仍能继续；永久idle最多进行配置允许的尝试后停止。故障矩阵包括动作提交前、提交后结果丢失、abort未结算、Pi重启、只写memory未动作、length continuation、compact被取消；实际Pi覆盖与单元诊断分开记录。已知动作在bridge提交但extension未写入trajectory的计数冲突，保守停止、不重发；不猜测或重建缺失的实验意图。断言动作序号连续、无重复、下一父轮状态/版本正确；不可确定提交结果时明确停止。正常短轮不增加管理模型请求；启动时增加一次无模型成本的get_state确认实际开关。

### Task A4：scorecard关闭与主故障分开（O06）

**Files:** `src/autoresearch_pi/arc_agi_3_bridge.py::close`、`src/autoresearch_pi/arc_thin_e2e.py`；`tests/test_arc_bridge_readiness.py`或拟新增 `tests/test_arc_scorecard_close.py`；`tools/mock_arc_sdk/arc_agi.py`。

先核查安装SDK的方法、保存的404响应及scorecard状态查询能力，必要时查官方API文档；不猜另一个endpoint写进代码。保留primary stop reason，单独写 `close_status / close_error / scorecard_verified`。已确认关闭时重复close返回已保存结果。404仅有明确已关闭证据才视为幂等成功，否则记录未知/失败；不重启游戏、不用RESET补救、不无限重试不可重试4xx。可恢复网络故障采用有限幂等关闭重试，已知成绩原样保存。

诊断覆盖正常、重复、已关闭、有有效card却404、无card、网络错误。主故障不被收尾异常覆盖；scorecard未确认时不把缺值写成最终零分或已核实WIN。

**阶段 A退出条件：** 正确成本对账；隔离故障第3组可恢复；已提交动作不重放；未知环境结果可靠停止；memory回执一致。脚本接线通过并不证明真实provider长流问题已修好。

## 6. 阶段 B：证据可读，原生能力生效，减少重复手续

### Task B1：集成已有 native compaction（O04/O17/O20）

**Files:** `src/autoresearch_pi/arc_thin_e2e.py`、`src/autoresearch_pi/cli.py`、`demo/arc_thin_extension.ts::session_before_compact`、`tools/run_foundation_real.py`；`tests/arc_thin_compaction.test.ts`、`tests/arc_thin_receipts.test.ts`、`tools/run_foundation_smoke.py`。

复用 `f843cddd` 的公开Pi `compact()`修复；Pi继续调度threshold/overflow、保存checkpoint并恢复。启动前记录最终env/CLI、model context window、reserve/keepRecent、auto_compaction及实际summarizer路径。Native修复分支默认on，显式off有效；旧冻结样本off是历史事实。不得以“on”推断约65k输入一定跨过175k上下文的原生阈值。

手动/自动/split-turn/取消/失败/重启分别验证真实输入包含ARC保留要求、无历史reasoning、receipt refs有效；checkpoint到达后续请求。summary调用和失败attempt进入A2账。检查公开engine/registry的auth、abort、length/error行为，不冒称具备私有AgentSession retry callback的语义。

普通真实运行只观察原生触发；未触发记未验证。需要保证出现compact时，另做明确标为诊断的手动checkpoint或独立阈值实验，不伪造真实usage跨阈值。真实认知验收见阶段E。

### Task B2：短、稳定、不可变的结果文件名（O07）

**Files:** `demo/arc_thin_workspace.ts::receipt`、`demo/arc_thin_native_runtime.ts`、`demo/arc_thin_extension.ts`中结果回执；`tests/arc_thin_workspace.test.ts`、`tests/arc_thin_receipts.test.ts`、`tests/arc_thin_native_context.test.ts`。

新结果实际保存为 `results/r000001.txt` 等短workspace文件；hash仍用于完整性、去重和版本身份。runtime在私有 `.harness/result-index.jsonl` 维护ID/hash/文件映射；不是父维护索引，也不是模糊匹配或虚拟read SDK。旧hash refs继续有效，不重命名已有历史结果。不得用symlink/hardlink做alias而削弱隔离。

并发分配、保存与索引需要可恢复的一致性；重启不复用既有ID，同内容复用已有身份，未完成落盘不能留下指向错误正文的回执。结果是runtime写、agent只读；所有生产结果入口复用同一保存函数，旧consult refs保持兼容。

验证同内容、不同内容、并发、崩溃后重启、旧ref、误输入、准确全文/分页和权限负例。错误引用给出明确not-found，不静默选择“最像”的结果。收益观察首次正确读取和管理往返；不能仅以名字变短声明token改善。

### Task B3：按行预览与小结果阈值独立评估（O08/O10）

**Files:** `demo/arc_thin_workspace.ts::receipt`；`tests/arc_thin_receipts.test.ts`；已有真实1807字符结果的离线fixture。

先改机械截断：预览保留完整行、显式标 `partial`、遗漏行区间、总行数与ref；必要的单行超长情况标明部分行。保留作者自选key lines，不由runtime猜哪段是游戏线索。使用预算内头/尾预览，不承诺中间反例一定可见。

另一个单因素候选把小结果直接展示阈值从1500改为3000字符，覆盖本次1807字符分析；先作为显式native候选配置，比原值，不能与短ref一起归因。完整正文始终保存可读；统计inline增量、read往返、后续历史/compact负担，结果可能是提高阈值反而更贵。中间/尾部反例必须能用精确行号恢复，不能只测试“全文存了”。

### Task B4：原生调查路径与旧工具配额（O09）

**Files:** `demo/arc_thin_extension.ts::guardTool/endsBatch`、`src/autoresearch_pi/arc_thin_e2e.py`的no-action/recovery路径；`tests/arc_thin_boundary.test.ts`、`tests/arc_thin_action_surface.test.ts`；native调查smoke。

先完整重放“错ref两次→重算→打印异常坐标被6次限拒绝”，定位各配额计数与停止点。选择native候选：取消一刀切6/8次总工具流程配额，保留单工具资源/权限限制、每决策最多一次成功ARC动作、已提交动作后的原生terminate边界。legacy固定默认不改。

以已存在的调用signature/状态版本观察无进展；相同状态及workspace版本下，连续相同错误或相同读取不能靠改request ID规避。先提供一次机械错误回执和定位信息，再按明确有限连续错误策略结束失控轮；变化了参数、文件或得到新证据不按重复错误处罚。具体重复阈值经负例确定，预定故障fixture初值为3，不作为每决策正常调用额度。不能让“模型没创建组件”或“读得多”成为失败标准。

测试调查能获得中间反例，正常短决策无额外轮次，永远错误/无限重复读取可停止、合法分批读取与写后重读不误停；action权限/预算和最多一次提交不变。删除配额与改no-action文案分开记录。真实收益需单因素普通对照，不因scripted第7次调用成功就声明任务改善。

### Task B5：移除native固定25动作consolidation义务（O16）

**Files:** `src/autoresearch_pi/arc_thin_e2e.py`、`src/autoresearch_pi/cli.py`、`demo/arc_thin_extension.ts`、`demo/prompts/arc_thin_native_system.md`；CLI/config与native ledger smoke。

Native候选默认关闭固定周期consolidation，保留显式对照flag；legacy保留冻结行为。Agent在普通轮自主写partial memory/notes，claim增量检查继续，Pi compact不等同于知识复盘。分别保留环境终态处理与跨关review显式flag。正常请求不插入“必须维护N个对手”等额外义务。

修正native length恢复中可能引用不存在 `run_skill` 的旧文案：从实际已暴露工具/能力恢复，保持普通 `arc_action` 单步边界；不新增专用恢复SDK。no-action不立即强制跳过尚未完成的取证，但有限无进展停止仍明确记录。逐项消融，不能把本次所有idle和800秒动作间隔都归因于固定复盘。

验收：#25后正常继续、check/反例/策略可在普通轮更新、native length/idle恢复工具名实际可用；旧对照flag可重现旧路径。否定条件：维护减少却遗失关键反例或实验前提；此时修订投影，不恢复更多固定义务来掩盖问题。

## 7. 阶段 C：让证据支持正确范围的知识修订

### Task C1：给信念保留来源时刻，避免历史状态伪装当前（O12/O11）

**Files:** `demo/arc_thin_memory.ts::Fact/applyRows/renderFactsCompact/renderStrategies`、`demo/arc_thin_native_memory.ts`、`demo/arc_thin_extension.ts`的写入/replay；`tests/arc_thin_memory.test.ts`、`tests/arc_thin_native_memory.test.ts`。

先用已有每行runtime `at`恢复事实的写入时刻；必要时追加runtime-owned level来源。保存和applyRows使用同一已附来源的rows，防止即时视图与重放不一致。旧记录缺来源标unknown，不补成当前动作。parent不新增必填字段，也不必每动作改“bar=19”。

投影明示“记录于#25”的认识，当前状态只由最新观测/当前observer给出；规则不因为时间旧就自动否定。纯文字语义不能靠正则可靠分类为动态或稳定，所以先只做来源标记与去重，不自动删除状态句。作者确需scope时再评估可选声明；这一变量不与来源修复混测。全文按原memory接口保留，不另建信念真值库。

负例：旧状态、稳定控制规则、跨关条件、重启、删除重建、作者故意保留历史对照。验收先是来源正确和无静默丢失；降低重述/协调推理是另一个真实行为指标。

### Task C2：兑现已有check回放，正确处理前提和错误（O11/O15）

**Files:** `demo/arc_thin_extension.ts::memory/refreshClaimChecks/claimLines`、`demo/arc_thin_claims.ts`、`demo/arc_thin_skill_guest.ts`；`tests/arc_thin_claims.test.ts`、`tests/arc_thin_native_memory.test.ts`和native claims smoke。

现状是新/改check保存即回放，结果同次回执，之后增量；先验证native真实接线，不添加第二套工具。若测试发现故障才修。回执按版本显示holds/fails/n/a/errors及精确动作引用；只有适用样本进入“通过率”分母，0适用不能称模型准确。新版本不继承旧版本的支持票；相同版本只跑未检查转移，避免每动作重扫全部历史。

check(t)的语义需按需示例说明：前提未达成返回None，条件成立后才比较结果，程序异常单列error。#21未进入目标位置不应否定“进入后通关”；#12不同颜色/对象的实验不能冒充原收藏品假设的检验。机械回执只汇报检查结果，不自动退休/改语义状态。

一个self-contained check与现有t接口即可起步，不为此新增SDK/强制字段。复杂长期/隐状态假设无法忠实写成单步check时，允许保留文字、精确条件化人工证据或暂不投资。

验收：真实Pi `memory(check)`→同次语义回执→下一请求→新动作→增量结果；holds/fails/None/error、blocked前提、无历史、跨关、修订、删除、重启。人工对真实轨迹的范围判断与程序分开审阅。自主创作和成本下降仍待阶段D/E。

### Task C3：critic审查预测与实际，不把尝试当成功（O10/O13/O11）

**Files:** `demo/arc_thin_critic.ts::buildDossier/CRITIC_SYSTEM/parseCriticReply`、`demo/arc_thin_extension.ts`的critic dossier；`tests/arc_thin_ledger.test.ts`及拟新增 `tests/arc_thin_critic.test.ts`；真实#12/#21的脱敏fixture。

先改一个主要因素：在所引用失败转移上对齐原claim、预测与实际变化/可用check结果，明确“预计到达”不等于“实际到达”。复用现有公共delta、分区域坐标证据和prediction score；不再构建另一个常驻对象识别器，不给critic本次游戏答案。自然语言解释仍由critic/父作出，不用runtime的启发式强制批准/拒绝。

先验证反馈质量，再单独审计触发覆盖。本次#23–#37条仍在减少、测试端点未达，因此不能自动判“耗条假设失败”。80%逐像素ticker遮罩不能识别单向耗条是已知recognition限制；不据此默认新增每N步review。后续候选优先复用已声明策略步骤/检验终点及已遗漏的机械证据，只提供一次非阻断事件；没有agent声明端点时不从reasoning文本猜语义契约。

离线测试只验材料/引用完整性，不冒充critic会给正确解释。真实反馈验收需逐条审查：对象/前提一致、反驳范围、无未执行却宣称验证、后续父预测/动作是否体现正确修订；删除key或改idea标签不是采用成功。同时保留正常进展无需critic的负例，累计侧调用费用。

## 8. 阶段 D：agent推理效率与自主offload，推理保持开启

### Task D1：明确复用优先级，检验沉淀是否替代重复流程（O14/O15）

**Files:** 首个候选只修改 `demo/prompts/arc_thin_native_system.md` 的决策指导；不同时改变binder、接口和activation。后续若证据定位到调用摩擦，再单独修 `demo/arc_thin_binder.ts` 的回执或 `demo/arc_thin_native_runtime.ts` 的既有activation。详细说明保持在按需SKILL.md载体；相关投影/组件检查使用 `tests/arc_thin_native_context.test.ts`、`tests/arc_thin_binder.test.ts`、`tests/arc_thin_native_runtime.test.ts`。

先离线标注重复方法的适用机会，区分相同代码对不同当前state的合理计算与无价值重复。当前21次Python、零复用候选只能定位“识别→投入→候选”缺口，不能证明模型不会写或binder失败。

优先试一个可证伪因素：将「推理效率与复用优先级」明确写入已有短系统提示，替换/合并重复说明，不建立晋升制度。这是Agent正常决策原则；具体内容和时机仍由Agent判断。拟用表达如下，实施时保持精简，不注入开发流程或本游戏线索：

> Treat reasoning time and tokens as a task resource. Prefer suitable existing harness components for recurring work. When a reusable method is likely to repay its creation and checking cost, save it once in the appropriate component and use it on later inputs instead of re-deriving the process. Use current evidence to check applicability; revise when conditions change. Reserve reasoning for interpretation, new hypotheses and experiment choice. One-off work can stay in python or direct reasoning.

工程检查确认生产native输入实际包含该原则、legacy保持冻结、没有新增强制字段或动作门禁；它们不能证明模型会采用。普通真实单因素比较保持相同工具/WASI/提示其余部分，仅改变这条原则，标注机会识别、首次投入、真正后续复用、替代的重复步骤和成本。若先有明显binder故障，可修复后冻结同一底座再比较。

不强制读取手册，不要求每个假设带check。工具首次语义值需父提供真实参数，不能在保存时猜参数自动trial。observer写入本就是opt-in，应保证其下一次适用状态输出版本/动作号正确且失败可见；首次运行时机若有实际断点再修。

observer先作为当前网格的补充。带状态号的坐标、计数、变化等可机械核查；输出错误、超时或过时不能伪装当前。agent可把共享识别写进lib，使python、tool、observer复用；代码model/search也是此路径的可选用法，不恢复未采用的特殊predictor约定。

不使用reasoning主题分类当runtime“事实触发器”。词面坐标占比可用于开发侧诊断，不足以强制晋升。工具未用一关不自动删；counterexample并不自动删observer。父判断修订/退役，runtime保留确切记录。

验收追踪机会→识别→投入→候选→装配→语义使用→反馈→保留/修订/撤下，计合理非用和放弃。检查后续同类流程是否实际由组件完成，父是否减少重写/重新推导，并将结果用于当前判断；只创建、读取或多调用不算offload闭合。方法正确且摊销后重复负担减少，支持局部offload；总计算/管理轮和任务效果另行判定净收益。父只在一次计算后贴上组件名称、持续重复同一分析、observer结果仍需要从头核对或维护成本超过复用价值，均为负例。

### Task D2：WASI先测再优化（O18）

**Files:** `demo/arc_thin_native_runtime.ts::snapshot/execute`、`demo/arc_thin_components.ts`和现有WASI pool；`tests/arc_thin_native_runtime.test.ts`、`tests/arc_thin_components.test.ts`。

分项测目录/metadata扫描、真正读取字节、guest输入字节、compile/start、执行、lazy-read重新运行次数、输出、队列等待和总墙钟。用同一实际相关文件集合加不同规模无关results作对照；资源/fuel异常和超时记完整。最多32lazy-read等现有限制不先提高。

只有快照/重跑成为实测瓶颈再引入按版本缓存、少读无关正文等单因素优化；缓存必须保留调用开始时的一致快照、lib/工具版本、并发变更和失败写入不提交语义。state/current不能在重跑中悄悄变成后来的状态。不得换host CPython来消除WASI成本。

若耗时主要来自父推理，WASI小幅加速不冒称改善136分钟运行。每项快照优化先验证正确与权限，再测是否减少父子总等待。

## 9. 阶段 E：验收协议与保留标准

### E1：工程与全链路检查（O20，贯穿每项任务）

以下为工程验收命令；2026-10-13 执行产物维护在同一实现报告。所有脚本provider/SDK mock必须在产物中标注。

```powershell
$env:PYTHONPATH=(Resolve-Path src).Path
node --experimental-transform-types --test --test-concurrency=1 tests/arc_thin_*.test.ts tests/pi_foundation_spike.test.ts
python -m pytest tests/test_pi_kernel_idle_timeout.py tests/test_pi_kernel.py tests/test_arc_thin_lifecycle_stats.py tests/test_cli.py -q
python tools/run_foundation_smoke.py runs/optimization-defaults foundation defaults
python tools/run_foundation_smoke.py runs/optimization-components components
python tools/run_foundation_smoke.py runs/optimization-receipts-manual receipts
python tools/run_foundation_smoke.py runs/optimization-receipts-auto receipts automatic
python tools/run_foundation_smoke.py runs/optimization-receipts-split receipts split
python tools/run_foundation_smoke.py runs/optimization-migration migration
python -m autoresearch_pi.cli arc-thin-smoke --root runs/optimization-legacy-base
python -m autoresearch_pi.cli arc-thin-smoke --root runs/optimization-legacy-claims --claims
python -m autoresearch_pi.cli arc-thin-smoke --root runs/optimization-legacy-continuity --continuity
python -m autoresearch_pi.cli arc-thin-smoke --root runs/optimization-legacy-environment --environment
python -m autoresearch_pi.cli arc-thin-smoke --root runs/optimization-legacy-harness --self-harness
python -m autoresearch_pi.cli arc-thin-smoke --root runs/optimization-legacy-ledger --ledger
git diff --check
```

新增的recovery/accounting/scorecard/critic用例按任务运行，smoke必须同时断言语义数值、后续请求和动作计数，而非status=completed。Windows若shell不展开Node文件glob，先用 `rg --files tests -g 'arc_thin_*.test.ts'`取实际文件数组传给Node。新root应为空，不覆盖旧失败产物。

专项完整性：links/junctions/hardlinks/ADS不能逃出workspace；data/results不可agent写；API key与bridge token不入agent/guest；typed tool/observer版本与fallback标签准确；skills/prompts/roles启停、consult权限、partial memory、migration/restart和legacy行为可回归。长度恢复覆盖普通父和consult，Auto-Research路径按用户弃用不重启，也不宣称旧Auto-Research全链路闭合。

### E2：一次普通真实100动作运行（O01–O06/O17/O20）

工程验收完成、源冻结且用户明确启动后，进行一份操作性探测：官方ls20、真实yibu/qwen3.8-27b、high-qwen、最大100动作、无总时间/token/decision上限；ledger/critic启用、auto compaction采用修复源最终配置，reasoning replay/强制跨关review关闭，text-only基线。单请求fault policy按A3明确记录，source hashes/依赖版本在开始结束核查。

任务只用生产普通提示和空候选workspace，不供给ls20规则/路线，不指定必须创建五类组件。正常完成100动作窗口、WIN或真实环境终止，分别记录；恢复耗尽、环境uncertain、完整性失败是失败，不包装为100动作通过。过去37动作样本仅作探索性对照线索。

若自动compact未发生，O17仍未验证；另行授权一个真实checkpoint诊断，不调整运行中的阈值冒充普通行为。审查压缩前后：控制、最新状态、已排除解释的条件、未完成检验、策略前提、版本与refs；refs能读但父又重复同一被否定实验，认知连续性验收失败。完整grid继续从最新canonical observation注入，防止summary成为当前状态真值。

### E3：单因素采用与收益比较（O14/O15/O17/O19）

普通探测定位断点后，选择一个候选，例如short refs、consolidation off、check说明或observer补充视图；不同因素不一起归因。比较器使用相同可靠性修复底座，固定provider/model/thinking、modality、初态可比性、动作预算和fault policy。保持用户无整场时间/token上限；测量时间和tokens，不能悄悄将指标变成上限。

建议先1对探索样本；若出现采用和有意义差异，正式确认预注册每个game至少3对独立运行，ls20/lp85各两臂，共12次100动作上限运行。这个规模是待授权实验协议，不是本次授权或统计显著性保证；若样本方差大，结论标不确定，不自行追加次数。交替或预先随机次序，记录无法控制的初态/seed。旧37动作轨迹不能与另一条在线轨迹组成因果配对。

Legacy/native组合比较使用明确冻结的legacy源码/默认，不让native修复偷偷改比较器；可靠性政策尽可能对齐，无法对齐就写为组合差异，不把总差异都归因于compact/observer。保留旧源码与依赖hash。先有native单因素证据，再考虑完整foundation对照，避免一开始支付多臂成本却无法解释结果。

主要指标：完成关卡/成功、有效区分竞争解释的实验、重复已知失败/无效动作；父+所有侧调用known和unknown成本、output/reasoning/cache、延迟、管理轮、首次有效行动；创作/验证/修复投资、首次语义复用及摊销；同类流程的重写/重推导次数、组件是否承担后续计算、适用负例和输出/维护开销；压缩后反例条件和方法/实验连续性。provider给出的reasoning总量可计量，主题归因只能人工/近似标注，不能伪造每组件节省的隐藏token。坐标推理占比/top20%重推理只作诊断指标。

预定决定：

- 权限/动作一次性/来源/refs错配或关键反例丢失：功能或连续性失败，修正/撤回候选，不继续付费掩盖。
- triggers多但父合理不投资，或只有组件创建无语义使用：自主收益未支持；允许机制/机会判断本身无价值，不只归咎文案。
- 成本下降而有效实验/关卡退化，或调用减少但规则解释更错：不能称净收益。
- 探索性最低有用差异预注册为：同一game至少2/3配对关卡不下降、确认成功数不下降、正确范围的有效实验不减少；配对reported总token中位下降至少10%，墙钟和管理轮中位不增加。10%是本方案的候选筛选阈值，不是由34.6%分类推导的收益承诺，也不是运行token/时间上限。即使达标也只支持小样本探索性结论；全部0关时仅报告成本/实验指标，不称已改善解题能力。
- 任务进展提高但成本增加：分别报告收益与代价，不擅自称净收益；若用户以后选择质量优先，应在付费前另外预注册可接受成本交换。不得在看见结果后放宽阈值。报告每对结果和离散程度；未知费用足以改变结论时完整成本收益不确定。
- 自动压缩或某组件未被用到：该项标未验证/不适用，不用其它项的通过顶替。

## 10. 单独保留的后续实验

**Observer primary view：** 不进入A–E默认。先证明补充observer事实正确/新鲜且减少重复工作；若另行采用primary，需新观测契约和显式agent选择。coverage只能证明已声明坐标和值一致，不能保证全部关键语义已保留。full grid必须始终精确可读，错误/超时/过时/coverage冲突回退并标原因；遗漏没有变化的关键线索也是负例。不能因“与delta一致”宣称无信息损失。

**Guarded plan execution：** 独立改变控制边界，既有计划明确待批准。若后续选择，需要原子提交的计划/版本、可观测守卫、逐步canonical动作/预算、取消/level变化/失配立即交回父、结果uncertain不重发，以及完整的提交前后故障矩阵。把计划放memory不等于保持原来的逐动作父决策。不得默认启用。

**Model/search：** 先用agent自写lib/typed run/observer实现，不新增必须的predict方法或通过K次自动晋升。回放是训练内一致性，新的后续转移才提供泛化证据；0适用和难表达假设不强迫代码化。

## 11. 所有权、运行负担和交付判定

| 转移 | 推进者 | 证据/负担约束 |
| --- | --- | --- |
| 机会→识别→投资 | 父Agent；开发Agent事后标注适用性 | 父兼顾推理成本，优先复用适用方法、选择可摊销沉淀；不凭组件存在推断必须投资，不在游戏内运行词面语义分类门禁 |
| 候选→版本→装配 | runtime binder | 同一次write/edit给receipt，下次请求激活；无publish/手工index |
| 装配→语义使用 | 父调用tool/consult，runtime按opt-in执行observer | 真实参数/state/版本与输出，保存和暴露不等于使用 |
| 证据→反馈 | runtime check/ledger、既定critic | 机械结果和语义解释分开，None/error不能冒充反驳 |
| 反馈→修订/保留/撤下 | 父Agent | 不自动按假设票数/调用次数决定价值；不复制记忆真值 |
| 功能/接线→采用/净收益 | 开发Agent按预注册实验判定 | 四层分别报告，失败/取消/unknown计入；报告不进gameplay |

新增常驻成本目标是零开发手续；必要来源/错误/receipt信息短且事件相关。按需说明不是必须读，去掉固定合并轮应减少父管理步骤。观测和缓存成本由宿主统计；减少resident字符不冒称减少新reasoning。B/C/D延后事项保持开放，直到相应真实语义/成本/连续性证据建立。

2026-10-13 用户授权后，A–D的工程修改与E1验收已经执行，最终回归/评审和E2启动状态见同一实现报告。E2为一次组合操作性探测，不把其结果归因于某个单因素；E3的12次比较仍待另行授权。A/B工程验收只证明已测情境可恢复/可读/接线成立；C/D自主采用、O17真实压缩认知和净收益分别待证据。实际Pi未覆盖的故障边界明确保留，不以单元通过顶替。任何阶段都可以因负结果修订或撤下候选；canonical ARC历史不回滚。
