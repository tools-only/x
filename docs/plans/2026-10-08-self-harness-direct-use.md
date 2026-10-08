# Self-Harness：Memory、Prompt、Skill、Subagent 直接使用

日期：2026-10-08。状态：直接入口及相关功能验收通过，官方ARC/确定性provider完整矩阵19场景449检查通过；真实provider普通7动作/0关，未支持自主组件采用或净收益；广回归残余失败保留。用户已授权按此前四项建议优化和有界真实ARC实验；沿用小接口、复用实现原则。历史阶段和追加验证分别保留，最新结论见文末。

## 问题与命题

源码机会而非真实模型收益结论：Memory capture 只有入库；Prompt 在 before_agent_start 注入、同一 Pi loop 的后续请求可能滞后；Skill 新写正文仍被回执要求读取；保存 Subagent 后需再单独委派。此前 Tool 当前网格简化不覆盖这些步骤。

按四个可独立验证的因素顺序实施：
1. Memory 显式 `select:true` 合并 capture 与 selection，保留其他有效选择；默认仅归档不变。
2. Prompt 在每次真实 provider request 刷新当前已选且有效版本，更新/撤下/失效不遗留旧 overlay，固定 host 内容保持。
3. 新写 Skill 的创建回执允许直接执行已在上下文中的正文，按需恢复已有 Skill，免除重复读义务。
4. `task_harness_create(...,run:{task,...})` 在保存并安装一个 Subagent 后走既有 ordinary delegate 执行一次，返回报告及原生用量；不新增 worker 或 research 会话。

推翻条件：需要额外管理调用才能到达结果；覆盖无关选择/跳过 CAS；无授权启动 child；旧 prompt 滞留下一请求；只标记 completed 而没有语义输出；新接口无法保持既有错误/取消/预算边界。

## 设计与成本

- 对比仅增加提示（无法消除往返）、另造统一管理 Agent/框架（增加成本），选择现有入口上显式组合。每个切片单独诊断，失败只改对应因素。
- 父负责机会、候选正文、select/run 意图、语义应用与保留/修订/撤下；runtime 负责精确版本、授权、装配、输入整理、调用和回执。保存/暴露不冒充语义使用。
- 用户追加约束：便捷路径必须与自定义选用共存。保留 pool-only、精确版本 assemble、prompt_contributions、自定义 context_recipe、独立 delegate 和撤下入口。便捷调用写入同一原生 assembly；后续 Agent 显式重组/取消选择优先，runtime 不自动恢复已取消的选择，也不默认使用全部记忆。新增负例核查“便捷选用后手动只选部分记忆并持续保持”。
- Memory 新增一个可选 bool，不默认常驻所有记忆。capture 保持既有非原子批量语义；只有全部成功后才选用，选用失败保留已保存结果并明确返回，不静默换最新版。重试不重复创建、不重选旧版。
- Prompt 每请求做确定性有效性/装配投影，无模型调用。复用已有 overlay 渲染；仅改受支持 provider 的系统字段。保留启动时投影兼容路径，下一请求替换其旧副本；scope 枚举简写绑定现有 validity，文字 scope 仍只表示说明。
- Skill 不增加常驻正文或新工具；创建回执指明可直接应用，恢复入口按需保留。
- Subagent 新增可选 run 对象，`trial` 保持 pure Tool 语义；两者互斥，run 要求安装。委派复用权限、scope、budget、取消、length continuation、输出及用量；run 不接受动作授权或扩大 saved tools。失败不回滚已经提交的角色，不自动再次运行。
- 工作区已有其他会话的修改，逐段编辑并保留；不启动付费 provider/ARC 实验，不改 Auto-Research 开关。

## 运行前实验协议

目标为功能及局部原生 Pi 诊断；全 ARC 链、自主采用和净收益分别保留未验证。环境：Windows、installed Pi、localhost scripted HTTP / 既有 scripted broker、synthetic task evidence。

先每切片 focused checks，后相关回归。每 session 60 秒或沿用原 broker 测试期限，测试运行目标 15 分钟内；不花费真实模型预算、不执行真实游戏动作。若发现相关实际缺陷，保留失败材料并局部修复。

比较标准：Memory 省一次 assemble 且下一父请求有选中事实；Prompt create/update/retire/expiry 之后的实际 HTTP 系统字段与有效选择一致、无重复且保留 host；Skill 无 creator/read 往返仍能提交下游应用且有恢复入口；Subagent 同一次 create 返回可检查报告并可后续复用。管理轮与 schema 字符只作诊断，不换算真实 token 收益。

负例：select=false/省略、错误 bool、部分 capture、旧版本重试、过期/无效 refs、取消与 CAS；Prompt 无选择/退役/作用域失效与不同 provider 格式；Skill 未选中不可读取；run 与 trial 冲突、assembly=false、非 Subagent、无 delegate runtime、非法 tools/输入、子失败/length/取消/预算。产物为 JUnit、实际 provider 请求、原有版本/调用/装配日志。

## 实现与验证

已实现入口：

- `demo/pi_task_local_self_harness.ts`：Memory capture 的显式 `select`；Skill 的 `load_if_needed`；Subagent 创建的 `run`；Prompt 每次 provider request 的有效版本投影。
- `demo/pi_task_system_prompt_payload.ts`：替换确切旧 overlay，保持 host 字段；支持 OpenAI Completions/Responses、Anthropic、Google 及自定义 transport 的 Pi 原生 context。未知形状明确报错。provider 转换成功后才记投影，不把失败记为暴露成功。
- `demo/pi_harness_protocol.ts`：独立 Prompt 候选的枚举 scope 复用 validity；矛盾 scope 在写入前拒绝。
- `demo/pi_task_local_subagents.ts`：首次 run 调用与 ordinary delegate 相同的 prepareArguments / execute，不另建 child runtime。普通委派在 Auto-Research 关闭时仍可用。
- README 和按需 Skill/Subagent creator 指南：直接使用与高级自定义入口并列，未新增常驻检查清单或 worker。

自定义路径：Memory `capture` 默认仅归档；`list` 返回精确引用；Agent 用 `task_harness(action:"assemble")`、当前 `expected_assembly_revision`、完整 `selected_resource_refs` 与 `prompt_contributions` 选择所需子集。contribution 可以自主选择正文和层级。后续空选择/子集替换不会被 runtime 自动撤销；取消选择不删除 Memory。其他组件可 `assembly:false` 入池，之后独立装配、调用/读取、修订或退役。`context_recipe` 和独立 `delegate_task` 保留。

功能证据与失败记录（全部为本地确定性诊断，无付费 provider/真实环境动作）：

1. 新增 15 项 native Pi + localhost HTTP 检查覆盖 Memory 归档/选择/幂等/版本/失效、定制子集与贡献、Prompt 在实际请求中的 create/update/retire/expiry/重启、Skill 无重复读、Subagent 首次语义报告、独立复用、length 续接及预算失败。子进程确实调用 `fixture_state`，返回 `{"ready":true,"conclusion":"fixture-state:ready"}`；这只是脚本指定的语义诊断，不是自主判断或 ARC 成功。
2. [故障检查](../../tmp/direct-use-faults.xml)：7 passed。捕获生产 executor 注入失败，覆盖 Memory 写入第二项失败、写前/写后取消、CAS 竞争；Subagent 发布前/发布后取消不 dispatch child；不支持的 provider payload 不记成功投影。部分保存不被选入上下文，CAS 保持并发选择，发布后角色可恢复。
3. [provider payload 单元检查](../../tmp/direct-use-payload-node.txt)：12 passed。验证替换、移除、重复投影、固定字段与非文本块保留、输入不变、未知形状拒绝；Google 顶层/配置内字段和 string/parts/Part 输入独立覆盖，未知形状不会默默丢掉 host 指令。HTTP native 测试实际经过 OpenAI Completions，其他 provider 格式仅单元覆盖。
4. 初次 [广回归](../../tmp/direct-use-regression.xml)：61 passed、11 failed、1 skipped。发现并修正两处本轮兼容性问题：自定义 transport 把原生 Pi context 交给 payload hook 时不能插入 HTTP system message；一条 Prompt use 回执仍称下一父轮才生效。第一次 [Prompt 复查](../../tmp/direct-use-prompt-compat.xml) 为 8 passed、3 failed，其中旧回执检查的子进程在修订前已启动，最终结果见下项。
5. [最终相关回归](../../tmp/direct-use-final.xml)：70 passed、1 skipped、9 deselected，168.74 秒；跳过的是 batch 不支持 publication trial 的不适用组合。包括上述 15 项直接使用和 7 项故障检查，以及原有纯 Tool、组合、默认 Memory capture 和 ordinary delegate 回归。实际 payload、角色/Memory 版本、assembly、child 报告与 continuation 保存在 [验收目录](../../tmp/direct-use-acceptance-20261008)。保留 9 个不同路径的失败，不以排除后结果冒充整套通过：`test_system_prompt_followup` 的旧 compact cue 字符串断言与 capability_review 用例；`test_harness_capability_followup` 的研究延后、handoff、carrier review、planning intent 和 review draft 共 7 项。已查看 capability_review 实际错误：原生 schema 在 executor 之前拒绝该 action，需走已有 contract 按需 schema；旧 cue 要求的文本也不在当前版本。未用本轮 runtime 恢复旧提示/扩大常驻 schema，也未更改这些测试的断言；其余失败原因尚未逐一完成基线隔离，不能全称作已证实既有问题。

探索阶段还保留 [Prompt 初测](../../tmp/direct-use-prompt.xml) 的 host 全文固定断言失败（Pi 合法新增可用 read 工具段，随后改成固定 host 字段断言），以及 [Subagent 初测](../../tmp/direct-use-subagent.xml) 的 scripted child provider 扩展环境变量未配置失败。修正 fixture 后 [Subagent 复测](../../tmp/direct-use-subagent2.xml) 为 6 passed，未更改生产 child 选择逻辑来迎合 fixture。最终产物目录保留实际父 HTTP payload、原生 mutation/assembly/child/continuation 回执。

机会识别、内容创作和调用顺序在这里均由脚本指定；可证明候选→装配→指定调用/后续请求的局部可达，不能给普通机会漏斗或认知连续性打分。无价值时不使用、只归档、只入池、撤下仍为合法路径。Memory/Prompt/Skill 的投影或下游脚本标记不证明真实模型利用。真实父子 token、延迟和任务质量的净变化未测量；scripted usage 不作真实成本，未进行独立对照。最终相关检查因兼容性修复重复执行，总诊断时间超过初定 15 分钟目标，未新增模型预算或环境动作。B/C/D 保持开放。

| 证据层级 | 状态 | Provider / environment | 产物及边界 |
| --- | --- | --- | --- |
| 功能正确 | 新入口及相关回归通过；广回归另有 9 项失败待隔离 | 本地 scripted HTTP / installed Pi / 实际 child broker；故障测试为注入 | Python 70 passed/1 skipped；Node 12 passed；实际 payload 和 native 回执 |
| 全链路可达 | 未验证 | 未运行完整 arc-harness-smoke | 局部 native 诊断不替代五组件矩阵 |
| 自主采用 | 未验证 | 无真实 provider | 不推断普通模型采用 |
| 净收益 | 未验证 | 无独立对照 | 不宣称真实 token/通关收益 |

## 交付决定

保留四个显式捷径及原有自定义入口。它们减少了给定输入下的接口步骤，尚不称为已证明的任务效率优化。下一检查为五组件 `arc-harness-smoke` 完整链（包括两类 length continuation、后续父轮与语义值），之后在另定预算的普通 provider 中检验自主选择和父子总成本；当前没有据此追加运行授权。相关 [backlog B/C/D](../deferred-research-todos.md) 不提升状态。

## 追加：按需说明与一次性委派、真实 ARC 验证

2026-10-08 用户再次授权查缺、修复和 ARC 真实运行。此前“不追加付费实验”的范围到此更新，历史记录保留。

机会与主要命题：组件/装配 brief 仍强制读 Skill 并把 capture 写作 pool-only，与已实现直接入口冲突；临时委派的时间/tool-call 预算按每个 child 进程重置，length 后可以增加总投入。修正现有说明；ordinary delegate 在一个 invocation 中共享有限预算，允许 Agent 在同一调用中给出输出、停止条件及更小预算，不要求先持久化角色。不给运行 Agent 增加必填手续或 worker。保存职责和自定义 Memory 子集继续可选。

推翻条件：仍必须先注册才能临时分析；续接重置投入；预算错误后还启动 child；临时委派生成 saved role；Prompt 同运行下一请求残留旧版本；或省事入口覆盖 Agent 的自定义选择。科学停止条件由 child 判断，runtime 只强制可机械核验预算；reported-token 上限可能超过最后一个在途响应，不把未知流成本当零。

实验协议（实施前）：先 native scripted child 与 HTTP 回归，覆盖一次性语义交付、非法预算、失败后恢复、跨 length 累计和自定义。然后完整 `arc-harness-smoke`，官方 SDK/环境 + 确定性 provider，要求五组件/两类 length/语义值/后续父轮；不使用 mock-environment。真实 provider 使用当前配置 yibu/qwen3.8-27b、官方在线 ft09，一次有界显式直接使用诊断，之后若预算仍允许再做普通运行。真实实验两窗口合计最多 300k 已报告父子 tokens，每个窗口最多 150k、300 秒、12 动作，输出 envelope 4096；provider 支持的 off 推理按已有配置使用并记录。显式诊断只证明引导下的能力，普通窗口才评估自主采用；不以本次少样本宣称净收益。不强制 Auto-Research 常驻开启，研究链交由明确启用的确定性矩阵覆盖，ordinary delegate 应在 research 关闭时可用。

主要观察：直接组件→下次实际请求→语义报告/Tool值→真实 ARC action→后续父轮；时间、父子 reported usage、length/失败/取消、管理调用、合理不用/弃用。真实 runs 使用新目录；不更改活动运行，启动前记录当前源码与环境，运行中不修改 runtime。此追加的结果在下文登记。

真实诊断反馈：第一次因 wrapper 在模型 registry 解析之后才提供 qwen thinking format，off 未生效；25800 reported、0 action，两次 length。修正实验 wrapper 后，第二次88547 reported、0 action，父在查询 `contract(topic=memory_pool)` 时收到未知 topic 并重复 inspect；合计114347计入300k总预算。定位到按需说明/发现转移：已有 topic=memory，但工具名驱动的别名未接通，且说明仍是 capture 后另装配。此次只复用既有 Memory topic 接受 memory_pool 别名，明确激活入口、select=true 和默认仅归档/自定义子集，不增加格式或常驻义务。下一真实诊断最多35653，普通窗口最多150000；真实采用与净收益仍待证据。

首轮完整矩阵19/449失败已保留在 `runs/arc-direct-use-matrix-20261008`。过时文字标记及 Skill 回执断言更新；continuous-workers 测例明确启用其实际使用的批量动作；cross-context child 在默认32KiB取证批容量后仍索取下一页，触发正常pending，而非完成报告。修正确定性provider在容量边界先以continuity summary释放已读页，然后继续原有精确对照证据和报告；不放宽生产容量或语义验收。

## 本轮实现、真实试验与证据边界

### 已接通的行为

- **Skill**：作者提交的正文已在上下文时直接执行；创建/装配回执保留 `load_if_needed` 精确恢复入口。brief、creator 与完整按需说明统一此规则，计算仍归纯 Tool。新 case 无 creator/Skill reread 而引用程序版本执行后续真实 ARC 动作。程序正文在历史上下文里可执行不等于模型真实语义利用。
- **Subagent**：ordinary `delegate_task` 无需 saved role，直接支持 `output_contract`、`stop_when` 和可选 `budget`。一个 invocation 的 deadline、工具调用、reported usage 与最多 length 总尝试数共同累积；child 本地也停止超过 allowance 后的下一请求，避免父管道接收延迟多发请求。语义 stop_when 由 child 判断，runtime 强制机械限额；call 可收紧 operator cap，不可扩大。saved `create(...,run=...)` 与独立 delegate/context_recipe 继续可选。
- **Memory**：`capture(select=true)` 保存并选择正文；默认/false 仅归档；自定义 exact subset/contributions 优先且不自动恢复取消的选择。真实模型查找的 `contract(topic=memory_pool)` 复用既有 Memory 契约；既有按需说明消除重复旧流程，给出激活、capture/select、归档及精确子集入口。没有第二套记忆格式。
- **Prompt**：同运行 `before_provider_request` 重新投影选中的有效版本，create/update/retire/expiry 的下一实际 HTTP 请求已核查。旧 overlay 精确替换且保留 host；枚举 scope 绑定有效期，描述性 scope 不冒充到期。原生测试覆盖描述文字在跨 level 后仍有效；真正到期需显式 validity/枚举或退役。

功能检查：最终 [native 回归](../../tmp/direct-use-final-native.xml) **36 passed**（102.21秒），含普通一次性、跨 length 累积限额、当前网格、四入口与故障；最终按需 Memory 说明/别名另 [1 passed](../../tmp/direct-memory-contract-final.xml)。[Node payload/预算](../../tmp/direct-use-arc-node.txt) **14 passed**。`git diff --check` 和 Python compile 通过。此前广回归9失败仍保留原记录，不据 focused 通过宣称全仓回归通过。

### ARC 实际 runner 诊断

官方 ARC SDK/ls20 + installed Pi/bridge + 实际 child broker/process + 确定性 parent/child provider。首个单 case 用错 ft09 的动作并遗漏激活，超时，保留 `runs/arc-direct-use-seam-20261008`；修正为 ls20 后 [direct-use 11/11](../../runs/arc-direct-use-seam-retry1-20261008/arc-self-harness-smoke-summary.json)，4个实际动作及后续父轮，Tool/child 的维度和首像素等于 canonical snapshot，create/update/retire Prompt 在同运行下一请求可见，自定义 Memory 子集保持。

完整矩阵第一次失败见上；[第二次](../../runs/arc-direct-use-matrix-retry1-20261008/arc-self-harness-smoke-summary.json) **448/449**：continuous-worker 测例默认 create 已安装后再次用 revision=0 assemble，被 CAS 正确拒绝。测例改为显式 `assembly:false` 后再装配，不弱化版本检查；[最终完整矩阵](../../runs/arc-direct-use-matrix-final-20261008/arc-self-harness-smoke-summary.json) **19场景/449检查全部通过**。环境与runtime边界非mock；parent/research provider为确定性替身，不证明游戏质量。

### 真实 provider（全部尝试计入）

环境：官方 ARC ft09、yibu/qwen3.8-27b、OpenAI Completions、输出上限4096，Auto-Research 关闭，ordinary delegate 可用。qwen format 修正后 off 的实际 reasoning=0。无 mock；每个运行期源码 hash 无漂移。最后两份按需说明清理发生于真实运行之后，其文案的真实采用尚未再测。

| 运行与引导 | 实际动作/关 | 父子 reported tokens | 管理调用 | 结果/断点 |
| --- | --- | --- | --- | --- |
| [显式四入口诊断初次](../../runs/arc-direct-use-real-diagnostic-20261008/summary.json) | 0/0 | 25800 | 0 | wrapper thinking format 解析时点错误，8192 output 全 reasoning，两次 length；已修实验 wrapper |
| [显式诊断 retry1](../../runs/arc-direct-use-real-diagnostic-retry1-20261008/summary.json) | 0/0 | 88547 | 8 | memory_pool topic 不存在；父在 contract/inspect 间查询，0作者提交；已修别名与按需说明 |
| [窄 Memory 诊断](../../runs/arc-memory-direct-use-real-20261008/summary.json) | 0/0 | 8522 | 1 | 成功激活 task_memory_pool；下一请求预算准入拒绝，未capture/选择/使用，能力试验不确定 |
| [普通原玩法](../../runs/arc-direct-use-real-ordinary-20261008/summary.json) | 7/0 | 95823 | 1 | 7个合法ARC动作，无作者组件/装配/child；预算准入停止，未支持自主采用 |

总计 **218692 reported parent+child tokens**，在预定300000总限额内；本次所有真实样本 child 实际为0。原生 gameplay 自动保存的7条 action-decision Memory 不算作者 capture、自主 harness 创作或语义使用。成本明细及管理调用：[最终原始审计](../../tmp/direct-use-real-final-audit.json)。首次/重试/窄诊断/普通事件跨度分别164.67/56.25/6.33/74.82秒；含不同引导、首次配置错误及独立初态，不作为新旧性能比较。普通父请求历史峰值43580 JSON字符（非token），reported input93855/output1968/cache0/reasoning0；provider响应latency合计33052ms。没有取证读取或child成本，不能据此推断总体成本下降。

预算提前停止的直接原因也保留：窄Memory第二请求需保守reserve35569，但剩27131；ordinary下一请求需56263，但剩54177。现有准入按serialized UTF-8 byte保留文本token并加4096输出、8750margin，不是provider实际tokenizer计量。本轮不削弱预算检查来提高完成数，不继续花费剩余预算重复相同未达语义使用的试验。

### 交付决定与下一可证伪检查

保留四类直接入口、自定义选择和按需恢复；ordinary delegate 预算修复及Memory发现入口都有原生负例。五类ARC接线按最终完整矩阵分别登记；**真实模型自主采用未支持，净收益未验证**。机会识别/投入/候选/装配/语义使用/反馈在真实样本中的最早断点仍在作者提交前：guided retry1有入口识别但没有候选，窄诊断进入激活后预算停止；普通模型未提交作者内容，不能把没有组件解释为已证明的合理弃用。

下一项窄检查应是同provider、留出足够实际请求reserve的“capture+select→合法行动→下一父轮比较”，与同预算archive-only独立诊断分别记录；成功也只证明明确引导下的能力。之后才检验普通机会识别和父子成本的独立对照。B/C/D的跨压缩认知连续性、研究→行为和净收益保持开放，本轮不建立长期管理角色或附加门禁。

| 本轮证据层级 | 状态 | Provider / environment | 产物及限制 |
| --- | --- | --- | --- |
| 功能正确 | 定向通过 | installed Pi + scripted HTTP/broker；故障注入单列 | native36、最终说明别名1、Node14；旧广回归9失败未完成隔离，不称全仓通过 |
| 全链路可达 | 完整矩阵通过 | 官方ls20/实际ARC桥、Pi父、child broker/process、路由、原生装配、动作；确定性模型 | [19/449](../../runs/arc-direct-use-matrix-final-20261008/arc-self-harness-smoke-summary.json)；五类、两类length、语义值、后续父轮完整覆盖；不证明模型科学判断 |
| 自主采用 | 本次普通样本未支持 | 官方ft09/yibu/qwen3.8-27b/off | [7动作/0关/95823](../../runs/arc-direct-use-real-ordinary-20261008/summary.json)，零作者/装配/child。明确引导诊断也未达组件语义使用；最终按需文案清理尚无新真实样本 |
| 净收益 | 未验证 | 无独立重复对照 | 全尝试218692 reported，错误配置/失败也计入；无成本改善或通关归因结论 |

## 追加：用户授权的普通真实 ARC 50 步观察

2026-10-08 用户要求“运行真实ARC进程50步，观察是否有真实模型自主转化、采用出现”，并选择继续关闭Auto-Research。这是新的一次独立普通运行授权；此前四窗口218692及其他会话B33的已知/unknown分别保留，不复用或核销旧账本。已有19/449接线通过不作本次行为结论。

命题：在延长至50个实际动作的普通窗口内，模型可能自主识别重复计算/决策机会，并走作者提交→候选/安装→语义使用→后续行动/反馈。保留无价值时不使用与放弃；不能预设某组件必需或以数量奖励。不改Pi玩法提示/执行合同或注入创建任务；仅实验launcher开放有界动作/时间/token参数，默认12/300/150000不变。

运行前协议：单次官方ft09/真实yibu/qwen3.8-27b；OpenAI Completions，qwen format，adaptive仅off，输出4096，input modalities沿用现有text配置（当前完整grid；native PNG产物保留，但不冒充向文本模型发送typed image）；Auto-Research=false、review advisory、单动作默认、ordinary delegate保留既有60秒/40000reported操作上限。最大50真实动作、1800秒、父子共2000000reported，WIN/GAME_OVER或既有未知用量/准入完整性停止规则先到为准，不无限重试或改变执行源码。时间/token上限用上次普通95,823/7动作及近期B33 428,736/18动作作为量级参考并留管理/child余量，不保证能支付50步。独立初态、单样本，无新旧对照，不能宣称净收益。

产物予定 `runs/arc-direct-use-real-ordinary50-20261008`：启动前协议/源码hash，实际provider payload、Pi工具事件、组件/装配/调用/效果日志、ARC canonical动作和scorecard、父子usage及终态总结。launcher执行前compile和help检查，不启动诊断provider。运行中只读监测，不修改runtime。外部若有源码改动，按hash差异标注解释限制。指标：真实动作/关、作者候选与失败修复、精确选择、Tool/Subagent语义输出、Memory/Skill/Prompt到具体后续行动的证据，父子成本/管理轮/延迟；自动action-decision记忆不计作者转化。如普通样本有机会但无提交，审阅识别/价值/成本，不把零调用当失败或合理不用的自动证明。B/C/D研究到行动与连续性仍开放；本次研究关闭不能验证研究机制的自主投入。

**协议偏离/恢复前登记。** 初次运行因真实provider `Request timed out.` 结束（非1800秒外部期限）：7完整响应、79844known、0ARC动作、3次自主Tool提交均被当前表达式合同拒绝；读取tool-creator后下一请求超时。该请求usage未知，reservation `d6ef41a0-8038-4e9a-a5d2-7f83d763c5e7`的55560是保守预留而非已计费token。原账本unknown止损及源冻结保持，初次失败不会覆盖。用户50步目标尚未完成，进行**最多一次**同provider/同runtime/普通prompt的独立恢复窗口，不注入修复提示或改变执行合同；retry1限制1864596reported（2000000−79844−55560），1700秒，50动作。两窗口known与未知预留分开核查；为未知费用留55560不表示其实际费用已知或保证上界。若retry1也unknown/外部失败/保护期限停止，不无限重启、不通过移除止损来凑50。此为外部失败恢复的协议变更，不是独立重复对照；本次两窗口均属于当前50步请求，其他会话B33旧账本不核销。

retry1实际停在bridge opening_scorecard：官方arcprize.org的10秒TLS/read timeout，0provider请求、0reported、0动作。期间外部工作更改 `demo/pi_task_local_self_harness.ts`，本运行source_unchanged=false，不能称同freeze。尚未消费恢复的模型窗口；为保证运行期版本完整性，把**当前**demo/src/launcher/package复制为无credentials快照 `tmp/arc-ordinary50-runtime-20261008`，逐文件核对copy前/后hash；env仅从原workspace在进程中加载，不写入快照。以 `runs/arc-direct-use-real-ordinary50-retry2-20261008` 启动剩余同设置/同预算的恢复模型窗口，startup失败记录保留；若此次模型窗口再遇未知用量则停止，不继续provider重试。与初次相比存在外部源码差异，明确披露，不能归因于运行长度或做旧版净收益比较。

**恢复窗口环境干预（10动作时）。** 隔离复制清单遗漏新版本依赖的 `demo/pi_task_pure_python_lower.py`，第一次自主 `grid_analyzer` 在真实creator preflight因ENOENT未执行；这是开发Agent的快照准备错误，不归因为模型不符合source合同。第二次提交是原生拒绝不完整JSON；另一次动作顶层prediction字段被拒。10动作时补齐同一原有Python依赖并逐字节hash核对，没有修改runtime源码逻辑/模型提示/游戏状态或让模型重交。完整原失败保留，干预记录在 `tmp/arc-ordinary50-runtime-20261008/runtime-dependency-repair.json`。该窗口不能称全程环境冻结，现有launcher hashes未包含demo Python，此局限由独立manifest及干预记录补充；未来复制清单已加入demo Python。干预后的自主行为另列，不能将前期零安装归为模型不会采用。

### 50步终态与组件转化失败审计

2026-10-08：恢复窗口完成 **50个真实动作、0强制动作、0关**，状态 `NOT_FINISHED`；`run_complete=true`、`completion_status=completed`、Pi退出码0。观察已结束，不存在本窗口继续游戏的进程。官方ARC ft09 / 真实yibu `qwen3.8-27b` / OpenAI Completions，研究关闭、实际reasoning=0、文本完整网格输入；不是显式组件创作诊断。终态后只读review的下一provider请求超时，保留unknown，不抹除此前完成的50动作。

| 当前50步请求的全部尝试 | 动作/关 | 已知reported父子tokens | 结果与限制 |
| --- | --- | --- | --- |
| [初次](../../runs/arc-direct-use-real-ordinary50-20261008/summary.json) | 0/0 | 79844 | `analyze_grid`、`block_analyzer`、`grid_summary`三次自主Tool提交，均在旧受限表达式preflight拒绝；随后provider超时，1条unknown，55560预留不是实际用量 |
| [retry1](../../runs/arc-direct-use-real-ordinary50-retry1-20261008/summary.json) | 0/0 | 0 | bridge opening_scorecard TLS/read timeout，未请求模型；外部源码改动另记，不作相同版本比较 |
| [retry2：完整50步](../../runs/arc-direct-use-real-ordinary50-retry2-20261008/summary.json) | 50/0 | 1101650 | 3次Tool提交，0创建/装配/语义使用、0child；终态只读review后1条unknown，122671预留不是实际用量；第10动作补齐快照依赖 |

本请求累计 **1181494已知reported tokens、2条unknown**；两条预留合计178231不作为费用或实测token。完整50步窗口input1062177/output39473/cache0/reasoning0，59条assistant响应、60份请求捕获，provider响应latency合计369268ms，Pi事件跨度1097.369秒，payload峰值119825 JSON字符。7次非动作管理调用，其中3次是游戏期间作者提交、4次是终态只读review；51次arc_action调用中1次非法顶层prediction被拒，50次到达真实环境。输入占已知用量约96.4%；无child，不能把本次成本归因于研究或委派。无重复对照，不能宣布降低成本或提升玩法。

完整50步窗口的具体作者尝试：

| 时点 | 提交内容 | 实际拒绝与责任 | 生命周期断点 |
| --- | --- | --- | --- |
| 首个动作前 | `grid_analyzer`：颜色计数、非背景bbox、行带布局；1172字符，trial current_grid | 快照缺 `pi_task_pure_python_lower.py`，ENOENT；开发Agent准备错误，第10动作补齐。补齐后未重试这份原程序，不能称它已满足后续语言合同 | 作者投入→preflight，未产生候选版本 |
| 首个动作前 | 第二份 `grid_analyzer`：块模式/布局与大区域颜色；1562字符 | 最终工具arguments在字符1839处为非法JSON；未进入handler、未执行程序。不是Tool运行产生错误 | 调用解析→preflight之前 |
| 第30动作之后 | `grid_probe`：16个指定坐标的颜色；137字符，trial current_grid | `coords=input.get('coords', [])`在第2行第8列被拒；语言只允许len/range、纯局部helper和立即应用lambda调用。模型采用常见Python字典方法，但不符合实际受限执行合同 | 作者投入→preflight，未产生候选版本 |

证据：[原始组件审计](../../tmp/ordinary50-component-adoption-audit.json)、[Pi事件](../../runs/arc-direct-use-real-ordinary50-retry2-20261008/pi-events.jsonl)、[干预记录](../../tmp/arc-ordinary50-runtime-20261008/runtime-dependency-repair.json)。第一次环境错误的通用“修字段后重交”回执不能使模型修复缺失host文件；第二次有简短JSON恢复及按需failure ref；第三次提供行列位置和白名单，但未给这份程序的可直接替换写法。不能笼统归为“模型不愿创作”，也不能把preflight失败叫作装配失败。第30动作后的新提交证明环境修复后仍有自主投入，未观察到成功恢复及使用。

### 为什么其他四类没有显式转化

核查实际首个HTTP payload：active tools仅 `task_harness`、`task_harness_create`、`arc_action`。Memory工具和ordinary delegate均可按需激活，未被研究开关禁止。游戏期间除了动作和上述3次create，没有contract/components/memory读取或工具激活；其他查询都发生在50动作后的只读review。

发现与收益表达不对称是可直接观察的事实：普通任务prompt和create.description都明确推荐“精确取格/计数/比较→小Tool+current_grid trial→立即结果→默认安装”，Tool schema又给程序例子。其他四类主要是字段形状与泛用途；包含capture+select、同运行下一请求Prompt刷新、Skill写步骤直接执行、一次性delegate的[简短说明](../../tmp/arc-ordinary50-runtime-20261008/demo/prompts/harness_components_brief.md)存在于按需资源，但游戏期间从未加载。这支持发现/价值呈现缺口的解释，尚无单因素对照证明它导致零选择。

| 载体 | 已观察内容 | 未发生的转移与解释边界 |
| --- | --- | --- |
| Memory | runtime自动产生50条 `action-decision:*` Memory，决策/知识/下一步已有持久化；0作者capture、0显式选择。终态review有mechanisms | 不能说“没有Memory”；缺的是Agent主动提炼→保存并选入工作集。常驻入口展示formal atom/validity，便捷短文本capture+select需发现/激活；已有checkpoint/动作记忆可能降低额外保存的边际价值，但模型未给载体比较，合理不使用未证明 |
| System Prompt | 原玩法prompt存在；review lessons提出跟踪精确状态、先验证所有样例等策略 | 0作者overlay创建/选择；文本认识没有成为有作用域的决策策略。下一请求刷新功能存在但未调用，所以本窗口不是“创建后不生效”故障；没有直接即时回报或具体任务例子的呈现是待检验解释 |
| Skill | 行动与review next_attempt有过程性内容 | 0程序性Skill版本；没有把步骤命名、打包、选用。免重复读解决的是已创作后的负担，本次没进入该阶段；不可把任何计划文字自动算Skill或推定必需创建 |
| Subagent | 问题有解释不确定性；ordinary delegate仍可激活；create.description主要介绍saved Subagent的run | 0delegate激活/调用、0saved role。研究off移除自动研究机会，不禁临时委派。临时分析便利性没有出现在实际活动工具中，保存长期角色的用途更显眼；是否值得支付一次child成本未被模型明确评估 |

review中的mechanisms、lessons、next_attempt仅证明模型生成了可供提炼的内容，不验证这些游戏认识正确，更不证明它们已成为组件。终态是只读，不能回溯创造本运行后续语义使用。**其他载体的断点在认识/步骤文字→明确选择载体并提交；Tool断点在已提交→合法候选。** 父Agent负责内容/载体/适用范围的语义选择；runtime负责已授权的校验、保存、装配和投影。不能从review散文自动推断授权并强制提升组件，也不设置五类创建配额。

### 本追加观察的证据判定与下一检查

| 层级 | 判定 | 支撑及限制 |
| --- | --- | --- |
| 功能正确 | 先前定向检查通过；本次作者恢复存在失败 | 本次新增真实负例：快照依赖遗漏、无效JSON、受限方法调用；不扩大为全部功能失败或成功 |
| 全链路可达 | 先前确定性19场景/449检查通过；本样本未走通作者链 | 没有作者候选、装配、组件语义使用或child；本样本不提高此前五类真实runner诊断的证据层 |
| 自主采用 | 观察到自主识别计算机会及3次投入，成功采用0 | 两个Tool名称、无有效版本；其他四类零显式选择。不泛化为模型永远不会使用，亦不证明合理不使用 |
| 净收益 | 未验证 | 50动作/0关、1101650known加unknown；当前请求所有失败计入，无独立重复对照 |

下一可证伪检查先保持同provider/权限/预算，针对`grid_probe`检验“短小常见计算可合法提交→立即语义值→后续行动”及拒绝后的最小恢复；依赖完整性在provider启动前查，不让模型承担修host责任。若再评估其他载体，单独替换现有短入口的用途例子/便捷写法，观察是否减少发现与首次使用决策，不增加强制组件任务或常驻管理职责；不可同时扩程序语言、文案和worker再归因。本轮仅分析和记录，未实施新runtime变化或新增付费实验。B/C/D的研究到行为、父子成本及跨压缩连续性继续开放；自动50条存盘不证明语义连续性。

### 提示边界复核：自主选择与转化协议

2026-10-08 用户进一步明确：常驻提示应说明Agent决定转化以后如何操作，不应指定哪些具体任务内容要转化为Tool。现有 `arc_decision_cycle.md` / concise及create.description的“extraction, counts or comparisons → small Tool”虽不强制调用，却提供了领域机会分类和载体推荐；这是决策引导，超过中立接口说明。此前为提高入口可发现性采用的用途文案不符合这项最新偏好。机械的默认安装、assembly=false、trial、合法程序边界及回执使用方式属于操作协议，可以保留。

因此收窄上文行为解释：50步证明真实模型在明确Tool用途提示下自行写程序和提交，不能证明它独立发现了这些内容应转化Tool，也不能以Tool和其他四类的提交差异比较模型的自然载体偏好。审计 `guided=false` 表示没有显式组件任务/调用配额，不能解释为完全没有转化机会引导。该修正不改变原始调用、失败和费用记录；成功采用仍0，净收益仍未验证。

推荐的边界是：Agent决定是否转化、转化内容及载体；公共常驻说明只保留统一创建入口、保存/选用语义、可选按需说明及既有完整性边界。Tool的trial/current_grid/受限语言等留在其schema或按需合同，使用“若已决定创建Tool，可……”表述。载体定义可以解释能力差异，不把当前网格任务或复盘内容映射为应该创建的组件。不通过给另外四类补领域提醒来平衡当前偏置。

本次为分析复核，仅记录上述结论，未修改runtime提示、正在运行的其他窗口或启动新provider。若后续获授权修改文案，应仅改变机会引导这一因素，并先核查实际HTTP payload；用无指定转化任务的真实provider轨迹评估自主选择，包含合理不使用和失败，不以创建数量增长作为成功指标。B/C/D仍开放。

### 组件性质与直接入口优化（实施协议）

2026-10-08 用户授权优化全部组件转化常驻提示，并明确允许按组件性质提示可转化的内容/模式。本次以最新边界为准：可以说明“可执行的步骤/分支对应Skill、计算程序对应Tool”等类型性质；具体任务机会、内容、投资和选用由Agent决定。

真实问题来自上述50步：Tool领域用途偏置、其他便捷路径未发现、旧说明仍出现Skill先读/重复装配，以及非ARC入口仍介绍内部mutation接口。窄命题：统一常驻类型索引与实际schema，让Agent仅凭当前入口即可提交Skill/Prompt、激活后capture+select或一次性delegate，减少查手册/注册角色/重复读取和装配；不增加必填字段、worker或组件配额。选择机械投影复用现有接口，不新增Memory格式、不自动从review猜测创建内容。

生命周期：父选择机会/内容/载体；runtime校验、保存和按显式选择投影；父执行程序或采纳结果、判断反馈和保留/修订/放弃。默认create选用和capture默认归档各自清楚，保留精确版本自定义subset、assembly=false、独立delegate和context_recipe。按需说明与回执同步清理旧手续；条件能力入口只在runtime实际可用时暴露。

验证范围：本地installed Pi与localhost确定性HTTP请求，记录优化前后实际payload，检查五类定义、条件激活、Memory正文选用/仅归档/自定义子集、Skill不重读、Prompt同运行下一请求及退役、普通delegate输出/停止/预算。先跑定向测试（单轮不超过10分钟，失败定向定位）；无付费provider预算，不启动新真实ARC。保留先前ARC矩阵为历史接线证据，本轮原生局部诊断不升级为新五类ARC闭合、自主采用或净收益。常驻字符/schema增减按同环境报告，不能冒充token节约；若最短路径仍需未披露入口、引入权限绕过或重复管理步骤则推翻功能命题。没有适用内容时零创建是允许结果。B/C/D继续开放。

### 组件性质与直接入口：实现及验证结果

已实施。本次按照最新授权保留类型性质描述：可独立选择的事实/假设/计划→Memory；有步骤、分支和停止条件的程序性说明→Skill；具有输入输出的可执行计算→Tool；适用决策范围内的行为指导→System Prompt；可复用职责和独立上下文→保存的Subagent。具体内容、投资、载体及使用由父决定。标准/简洁ARC任务提示、create说明、通用与ARC索引、goal/gap/level提醒及候选后续入口一起清理了具体任务→指定载体的推荐。没有新增创建配额、提醒轮次、worker或必填字段。

| 类型/路径 | 本次补齐的入口或旧说明 | 首次使用与自定义选项 |
| --- | --- | --- |
| Memory | 当前实际索引给出隐藏时精确activate及短文本capture+select；修复原memory激活别名只打开task_harness的问题，现指向task_memory_pool | 首次隐藏时激活1次，然后保存并选用1次；无需查手册或构造atom；默认capture仍仅归档，自定义精确subset/退役/读取保留 |
| Skill | 常驻与完整手册统一“正文在上下文即直接应用，缺失才读”；删除仍要求先读creator的装配/review说明 | 完整candidate可一次创建选用；保留load_if_needed、精确版本与自定义装配 |
| System Prompt | 索引/schema讲清同运行下一provider请求刷新、描述scope不自动到期；carrierPreparation回执用create_call替代先change再assemble两步 | 一次保存选用，保留assembly=false、显式validity、自定义selection与贡献；更新/退役真实后续HTTP检查通过 |
| Subagent | 只有已注册且获准的delegate入口才投影；隐藏时给精确激活，临时任务直接带输出、停止、预算及证据入口，无需保存角色 | 激活1次后一次性委派；保留保存职责、create.run、独立delegate/context_recipe及全部预算/权限约束；研究off不影响ordinary delegate |
| Tool | 去掉取格/计数/比较的常驻机会推荐；schema说明受限语法、调用白名单与input索引写法，trial仍支持首次值 | 具体计算由父选择；保存/默认安装/trial、独立调用及精确输入绑定保留；未扩执行语言或移除校验 |

公共机制改动仅为能力发现投影与memory激活别名；没有增加第二套创建/记忆接口。完整candidate字段只在create schema展开，change引用同一可见合同，删除重复副本。通用入口也改为简短类型索引，creator正文、版本目录和开发长手册按需读取；研究方法的既有执行条件保持。Schema、版本/CAS、作用域、权限和父子预算校验继续执行。此前项目还有其他未提交修改，本次差异以[修改前快照及本轮diff](../../tmp/harness-carrier-entry-20261008/change.diff)审阅，不用整仓HEAD差异冒充本轮改动。

**验证。** 新增本地installed Pi/localhost HTTP诊断，从与普通入口相同的隐藏Memory/delegate状态开始，无creator/contract读取即可激活→保存并选择、归档、创建Skill/Prompt、一次性真实child进程返回`{"ready":true,"conclusion":"fixture-state:ready"}`、后续父请求保持Prompt并按显式选择排除Memory。无saved role、无Auto-Research session。另覆盖没有child adapter时不投影虚假激活入口、memory别名激活、Tool当前输入返回值、既有Prompt更新/退役、scope有效期和ordinary delegate跨length预算等。全部为确定性模型诊断，不称自主行为。

当前相关 **53个用例均有通过结果**：[最终主回归](../../tmp/harness-carrier-entry-20261008/final.xml)51通过/1旧文字断言失败；修正字段形状断言并增加memory别名用例后，[定向复验](../../tmp/harness-carrier-entry-20261008/final-repair.xml)5通过。用当前pytest collection和最新结果逐项匹配，[53项覆盖审计](../../tmp/harness-carrier-entry-20261008/current-coverage.json)通过，避免将重复运行相加成用例数。原生调用和自定义选用验证来自实际HTTP内容，不靠源码字符串判断生效。

原失败保留：[初轮44项](../../tmp/harness-carrier-entry-20261008/regression.xml)42通过/2失败，分别是老测例没加载review高级schema、默认已安装却再用revision=0装配，已分别修正测试准备为加载schema和显式assembly=false，不放松生产检查。[扩大到相关旧套件](../../tmp/harness-carrier-entry-20261008/projection.xml)16通过/16失败；用修改前保存文件覆盖独立完整源码副本，[基线复现](../../tmp/harness-carrier-entry-20261008/baseline-failures.xml)在这16项中复现15项失败。另1项是本次通用入口从常驻全文改为按需引用后的旧期望，已更新并验证；复现的15项中另1个旧字段形状断言已修复，**仍有14项基线失败未在本轮修复**（高级review调用准备、未安装研究入口/旧研究plan合同、历史逐字迁移断言等）。不声称全仓回归通过。

**上下文成本。** 首轮草稿ARC局部payload增加612字符后，删除两处重复candidate schema和重复creator说明；最终[无child adapter的实际请求对](../../tmp/harness-carrier-entry-20261008/payload-cost-final.json)11178→11148 JSON字符（不同run路径名称，未标准化）。更有代表性的[已安装ordinary delegate且初始隐藏的成对测量](../../tmp/harness-carrier-entry-20261008/payload-cost-with-delegate.json)统一run路径，活动工具均保持task_harness/task_harness_create/ingress_probe：ARC入口11117→11305（+188），通用入口23392→11222（−12170）；schema 7665→7156（−509）。普通ARC任务提示模板单独由1937→1808字符、简洁版1688→1549；模板源码字符与HTTP JSON字符口径不同，不直接相减为收益。这些是本地诊断的初始请求，不是游戏轨迹或实测provider token。新增五类性质和直接入口的常驻成本已计入；未宣称ARC成本下降。全部本轮付费provider调用0。

| 证据层级 | 本次状态 | 限制 |
| --- | --- | --- |
| 功能正确 | 定向53项通过 | 原生Pi、HTTP和child进程诊断；14项扩大旧套件的基线失败保留 |
| 全链路可达 | 本次未重跑ARC完整矩阵 | 先前19/449保留为历史证据，本次局部接线不替代ARC bridge/action及后续父轮完整验收 |
| 自主采用 | 未验证新提示 | 旧50步有Tool用途引导，不能作为新提示的采用证据 |
| 净收益 | 未验证 | 只测初始上下文字符和机械调用路径，无新真实provider/独立重复对照 |

交付决定：保留本次类型说明和直接入口，所有载体的选择/归档/自定义仍由Agent决定。下一可证伪检查是在完整运行快照中固定执行能力、provider与预算，仅比较旧用途引导和新类型说明的普通ARC行为，审阅合理不使用、提交恢复、语义采用与父子成本；不以五类创建数为奖励。本次未启动该付费试验。B/C/D研究到行动、父子成本与跨压缩认知连续性继续开放。
