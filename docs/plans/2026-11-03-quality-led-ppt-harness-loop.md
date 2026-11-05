# Meta-harness 变更记录：以质量模型驱动 PPT harness 工程循环

日期：2026-11-03（Asia/Shanghai）。状态：**质量驱动主循环已由一次真实 provider 探索运行走完全链并交付；本次工作流程自塑与视觉表达修订已实现，等待新进程真实运行验证；自主采用有单次样本，净收益未验证**。本记录接续并取代 [11-03 PPT A/B 方案](../../../../../../../autoresearch_pi_project/worktrees/r04/docs/plans/2026-11-03-ppt-agent-owned-harness-engineering.md) 的行为主线；A 的环境清障仍是前置能力。按 [开发流程](../development-workflow.md) 与[主 checkout 的 harness 原则](../../../../../../../autoresearch_pi_project/docs/harness-design-principles.md)约束实施和证据。

## 1. 问题与窄命题

现有六次 PPT 运行中，后三次从未自主使用候选渲染；run 5 在首次渲染后迅速交付且未逐页查看，run 6 在 high 推理档位仍出现模板重复、无图表和增长方向画反。当前 Codex PPT 扩展的 `before_agent_start` 推送 deck 摘要与最近告警，首次渲染另开 ADAPT 回合，交付时才执行一个自定验收。HTML 产物路径的接线也不改变这个决策结构。这些是观察和当前代码事实；“质量表会改善成品”仍是假设。

**窄命题：**从只含任务 brief、原始材料和空白工作区的初态开始，Agent 在当前任务中自己定义质量维度、标准、方法和检查；每次渲染后，runtime 执行其在线创建并登记的检查，把当前产物的按维度状态放在下一次决策的末尾；Agent 据此选择修产物或修 harness。交付依据当前状态和在线创建的独立标准覆盖复核。该结构预期减少开发者中途指出质量缺口的需要，并提升最终产物质量；额外模型/检查成本一并计入。

推翻条件：状态表虽出现，Agent 仍在首次无告警渲染后迅速交付；检查全是复述几何告警；产物改动与方法版本无法关联；盲审反复发现地图之外的缺口；质量未超过基线或父子总成本超过预定预算。

## 2. 主循环与责任

一个周期是一个生产批次，**不再有 TASK/ADAPT 两种回合**：

`干净 workspace + 任务 brief/原始材料 → Agent 在线写质量地图 → 选择维度与干预 → 产物/方法改动 → 渲染与检查 → 质量状态表 → Agent 判断下一干预或交付`。

Agent 拥有标准、检查内容、方法、诊断、取舍和标准修订。Runtime 只验证地图格式、解析精确引用、运行已登记检查、聚合结果、记录真实调用/文件改动、投影状态与预算、执行交付边界。不由 runtime 从 deck 内容推断审美或自动创建组件。地图是五类组件的组织文件，不是第六类组件。

这沿用 [11-02 loop 即数据](../../../../../../../autoresearch_pi_project/worktrees/r04/docs/plans/2026-11-02-self-harness-loop-architecture.md) 已有的在线组件写入与版本能力；质量地图补充每个维度的质量方向和证据反馈，不替换或复制 ARC 的 loop 程序，也不把开发流程带入 PPT 任务上下文。

初始 workspace 中没有地图、方法、检查、审稿角色、工作集、示例、旧任务组件或预先写好的 harness 工程说明。任务 Agent 只收到用户任务、原始材料和通用工具接口；接口格式可以在需要时查询，但不注入默认维度、标准、方法或流程。现有 `demo/prompts/ppt_demo_system.md` 中的 harness 工作方式指示、首渲工程回合和单验收程序，以及任何 brief 中预写的叙事路线，都必须在干净初态实验前移除；保留用户给定的交付格式、受众、数量、事实来源等任务约束。PPT 的设计风格、多维评估、流程规范、内容侧重只作为实验者持有的隐藏观察项。开发流程、变更记录和本文件也不进入 Pi 任务 Agent 的上下文。判定自主性时，要看 Agent 是否在当前任务中产生并实际使用这些内容，而非启动时是否读到了它们。

### 2.1 Agent 编写的最小地图

下面的 JSON 仅是开发者实施接口时的格式说明，不作为任务初态文件或提示示例发给 Agent。`quality/map.json` 由 Agent 在当前任务中首次创建；每次改动保留版本与 hash。维度的 id 和标准必须有内容；检查与方法可先为空，空缺会出现在状态表中：

```json
{
  "dimensions": [
    {
      "id": "agent_defined_id",
      "standard": "Agent 写下可判定标准",
      "checks": [{"kind": "program", "ref": "tools/check_name.py"}],
      "methods": [{"ref": "skills/method_name/SKILL.md", "position": "何时使用"}]
    }
  ],
  "coverage_review": {"kind": "consult", "ref": "agents/reviewer.md"}
}
```

引用只指向 Agent 在当前任务中创建的 program、skill、prompt、subagent 或数据/流程文件。Runtime 每次记录实际解析的组件版本；缺失、拒绝、撤下和过时引用显示为 `unknown`，不能算通过。程序检查返回 `{ok, reason, distance?, evidence_refs?}`；`distance` 只有检查本身给出数值时才显示，不跨维度硬排总分。视觉 consult 由独立上下文、同一模型读取 Agent 指定的渲染页，返回同样的结构；无法解析、超时或预算不足显示 `unknown`。相同角色在同一 revision 的多个维度可合并一次咨询，按维度返回结果。首次创建地图前，状态只显示“当前尚无 Agent 创建的质量模型”这一运行事实。

### 2.2 状态表和上下文位置

每行显示：维度 id、标准短句、`pass | gap | unknown | stale`、距离（若有）、证据 ref、方法/检查覆盖缺口、相对上次的变化。状态只对确切产物 hash、地图版本和检查组件版本有效。产物或检查改动后，旧 `pass` 变 `stale`；没有检查是 `unknown`。Runtime 另列未服务任何维度的组件及同维度反复手工改动次数，不把这两项误当质量得分。

当前 `before_agent_start` 只写一次 deck 摘要；Pi 的 `context` 钩子能在每次 provider 请求前重排消息。新状态表取代 deck 摘要加告警作为**最后一段任务文本**，包括周期内工具续接；`office(render)` 的回执也以同一张最新表结尾。图片、完整检查输出和旧 revision 放在精确 ref 后按需取回，不能靠长尾全文撑起判断。尾部附剩余时间和预算。

### 2.3 干预与归属

每周期 Agent 据当前证据判断优先维度，而非由 runtime 用不可比的数字替它排序。诊断内容包括：差距及证据；断点（方法/检查/素材或知识/流程/标准）；本轮修产物或修 harness，以及预期状态变化；结果后的保留、修订或撤下。它可以体现在实际修改和简短决策中，不要求每轮填写固定表单。Runtime 记录可观察的意图与结果，不把字段完整度当作质量提升。

机会由状态表中的缺口或合理的覆盖疑问出现；Agent 识别原因并决定是否投入，创建或改动候选方法/检查；runtime 装配并运行，Agent 根据语义结果决定保留、修订、放弃或暂不使用。预算不足、素材缺失、检查成本高于预期时，允许记录原因并停止该候选，但相关维度仍保持未通过。每个转移保留产物/地图版本和证据引用，跨周期可以恢复，不把调用次数当成收益。

`run_program` 改变产物时，runtime 记录程序的精确版本、输入与前后产物 hash；直接 `write/edit` 记为手工，不能因为同周期出现某个 skill 就推断因果。非可执行方法的使用由 Agent 引用和后续产物差异支持，归因仍可记不确定。反复手改同维度只产生一条简短固化机会，不强迫创建程序。

### 2.4 完成和延续

交付只认**当前 canonical 产物**上由 Agent 在线创建的质量模型：至少一个维度有有效检查，且所有维度都是 `pass`；`unknown/stale/gap` 不可冒充通过。全部通过后，Agent 在当前任务中创建的独立审稿角色读取任务 brief、来源与渲染图，不读取地图，回传标准未覆盖的候选问题；Agent 判断并补地图/产物，或给出证据说明已有标准覆盖。此审稿不是自动审美裁判，单次“无问题”不证明标准完整。若 Agent 尚未创建审稿角色，runtime 只报告缺口，不提供预置审稿内容。预算终止时保留产物与未达状态，记录为未完成，不自动放行。

交付冻结 artifact 版本，并可将当前任务中实际形成的地图、完整 skill 目录、工具/数据和精确版本打包为结果。保留、修订、撤下或提炼可以由 Agent 在任务内按证据决定，不设交付后的强制提炼回合。下一任务仍从干净 workspace 开始；历史包不会被自动挂载或注入。若下一任务确实需要复用，须在那次任务开始后由 Agent 基于当前任务材料主动选择并导入，导入行为和结果单独计量，不能算作干净初态的自主生成。

## 3. 取舍、成本与实施顺序

不能以“每次渲染自动找一个审稿 Agent”代替 Agent 的地图：只有当前任务中由 Agent 创建并登记的检查可运行。每次 render 的 consult 调用和图片输入都消耗已有总预算；失败与 pending 计成本。初次得到有效状态需要：Agent 定标准与至少一个检查、造一份代表产物、render。多出来的决策与往返是本机制的成本，需与质量收益同报。没有地图时不自动补一份默认地图；当前实现允许读取任务材料，但会阻止创建 harness 方法和产物，直到 Agent 在当前 workspace 写出有效地图。

工程改动超过 300 行；首段完成后按三段记录：

1. **主干最小段（已实现）：**清理初始提示中的 harness 指导；空地图时禁止写产品或方法；Agent 在线建图；程序检查、`pass/gap/unknown/stale`、维度状态尾部、无 TASK/ADAPT 分叉、当前状态交付门槛。状态变化显示上次与本次结果。手工产物修改标记维度，程序产物修改记录程序版本；组件可逆退役/恢复。
2. **视觉与归属（接线已实现，语义 provider 未验证）：**地图引用的 visual consult 在 render 后用同模型、独立上下文检查图片；全部维度通过后运行 Agent 创建的盲审角色；Agent 创建角色和检查，无默认审稿正文。检查及盲审必须返回结构化结果。通过临时 Pi host 注入本地回包完成机械路径确认。
3. **交付延续（当前任务交付打包已实现；跨任务导入不纳入在线初态）：**交付包含地图、活动组件、完整 skill 目录和质量/来源日志。下一个任务继续从干净 workspace 开始；没有自动导入路径。

HTML 创作环境和 `office` render/look/deliver 继续使用；地图不重新发明浏览器、Binder、版本或子 agent API。机制不要在未测真实模型行为前默认扩展到 ARC。

## 4. 验证协议与实际运行

完成两项不花 provider 费用的真实路径：`ppt_demo.py --source demo/ppt-cases/jpmorgan-chase-3q21/assets` 创建的工作区只含 `data/available-fonts.json`、`data/environment.md`、`data/instructions.md` 和 `data/material.txt`，没有地图或 harness；另一临时 workspace 中无地图时 render 被拒，Agent 写入一维度地图、方法和盲审角色，真实 Edge 渲染 HTML，WASI 程序按 receipt 算出 `pass`，状态表出现在 render 回执及下一次 context hook 返回的消息末尾。该路径还验证了 Agent 创建 skill 的可逆退役/恢复；本地模拟 consult 回包后，deliver 输出 HTML、地图和完整 skill 目录。产物在 `%LOCALAPPDATA%/Temp/ppt-quality-led-final-zNWG68/`，prepared workspace 在 `%LOCALAPPDATA%/Temp/ppt-quality-prepare-72c4bc4fa5104cfb8f9014d990a6d64a/`。两个路径都没有使用实际 Pi runner 或真实 provider。

仍需补做的无付费负例包括：无检查维度、检查失败/超时、产物/方法变更后旧 pass 失效、状态不全时拒绝交付、盲审发现地图外问题。真实 Pi runner/provider 本次已到达工具门禁，但预算在第一次成功地图写入前停止；渲染后的 provider payload、质量表闭环、盲审和交付仍未由真实运行验证。

首次真实 Provider 探索运行于 2026-11-03，从刚准备的 JPM 干净 workspace 启动，provider 为 OpenAI Codex OAuth，模型 `gpt-6-luna`，reasoning `high`。任务初态只有 `data/available-fonts.json`、`data/environment.md`、`data/instructions.md`、`data/material.txt`；没有地图、方法、审稿角色、工作集或预写 harness 内容。早期阶段曾有 60,000 token 预留门槛，用户随后明确取消总 token 限制；恢复后的正式协议不设 token 上限，保留 12 美元等值估算预算和 2 小时上限。用户此前为真实 PPT 实验给出的 100 元人民币预算仍是外层限额。

首次阶段：开发者提示为 0；9 次 provider 请求，共 50,507 个报告 token，约 23 秒。Agent 阅读 brief 与原始材料，提出 accuracy、coverage、clarity、visual craft、source integrity、technical 六个质量维度；随后把质量模型尝试创建为 `self_component(kind="prompt", name="quality_map")`。Runtime 拒绝该调用，因为在线地图尚不存在。60,000 token 门槛的下一次请求预留会超限，运行在此暂停。

用户随后明确要求不设 token 上限。我移除了累计 token 门槛和 runner 手设的 12,000 单次 `maxTokens`，保留 token 统计；provider payload 中没有 `max_output_tokens`。在同一 workspace 和原始两小时/12 美元等值费用边界内恢复同一会话，因此是同一个样本，不是第二次独立实验。总计 77 次 provider 请求、76 条 usage 记录、3,470,697 个报告 token（包含 provider 报告的 cache 读取/写入 token），约 20 分钟；累计保守 API 等值估算约 $0.080。Agent 创建了六维标准、HTML 产物（24,323 字节）及 `tools/audit_deck.py@v2`，真实 Edge 两次渲染均为 15 页、0 条告警；该程序输出的六项检查均为 true。Agent 仍未建立 runtime 可识别的检查/方法引用：最后一版地图把工具放在非 schema 的顶层 `components`，因此各维度状态仍为 `unknown`，没有覆盖审稿或 delivery。多次尝试地图字段后，按项目重复死路规则停止 provider 进程；本次 `summary.json` 的 `runtime_error` 是停止进程后的通用 RPC 退出信息，`budget-stop.json` 不存在，不是 token、费用或时间上限导致。产物与日志仍位于 `%LOCALAPPDATA%/Temp/ppt-quality-prepare-72c4bc4fa5104cfb8f9014d990a6d64a/`。

这是一个有效的自主行为负例：初态确实干净，Agent 自主识别了多个维度，但尚未完成从识别到投入的转换；当前证据指向地图创建接口/最小格式在首轮工具选择中的可发现性问题，不能据此断定 Agent 不会完成质量循环。后续实验必须先确保在不注入 PPT 先验内容的前提下，Agent 能查询地图最小格式并写到 runtime 识别的精确路径；再用新的独立运行验证完整生产闭环。随后用户明确取消 token 总量上限，并授权继续同一任务状态；因此后续请求作为本次探索运行的延续，不另算独立样本。费用与原两小时期限仍按原协议约束。不得把截至目前的部分运行记作已交付或收益证据。

计划中的对照仍为：同一中性 JPM brief 和原始材料，与旧 TASK/ADAPT 版本在同一模型、相近预算下独立运行；两组任务 brief 与非机制性的工具说明保持一致，避免预写 harness 方法或叙事。比较维度覆盖、实际方法版本产出比例、修 harness 的周期与随后的状态变化、漏检/无方法维度、隐藏四类（设计风格、多维评估、流程规范、内容侧重）、最终盲评、父+consult 总 token/墙钟/管理轮。一次 C/T 只作探索，净收益须独立重复。

| 证据层级 | 状态 | 边界 |
| --- | --- | --- |
| 功能正确 | 部分验证 | Edge + WASI 实跑；真实 consult/盲审使用同模型；编码崩溃修复及负例状态见 §8 |
| 全链路可达 | 通过（单次探索样本） | Pi RPC + OpenAI Codex OAuth + GPT-6 Luna high；真实 HTML 渲染、地图检查、图片 consult、交付盲审和 delivery 均可达 | 运行产物：`D:\agent\AppData\Local\Temp\ppt-quality-reviewer-fix-20261103`；证明此样本端到端可达，不证明泛化 |
| 自主采用 | 通过（单次探索样本） | 开发者中途提示 0；无 token 总量上限 | Agent 自主创建质量地图、方法和检查程序及 2 个 reviewer subagent；visual reviewer 反馈触发修改，coverage reviewer 拒绝 v013 并在 v015 放行 |
| 净收益 | 未验证 | 需重复对照及父子总成本 |

## 5. 决定与后续

旧 A/B 方案的清障项仍可复用；B1 首渲提示、B2 单验收和 B3 工作集不再作为独立行为因素。本轮修复提升了地图格式和 subagent 能力的可发现性，并将质量状态及盲审结果接入交付路径。单次真实运行中 Agent 自主建图、建 reviewer、使用图片评审反馈改稿，并由最终 blind coverage reviewer 放行交付。该样本支持端到端可达及自主采用；因缺少独立重复和旧版对照，不支持因果质量提升或净收益声明。

下一可证伪检查：以同一中性任务、模型和预算，从新的干净 workspace 做独立重复，并与 TASK/ADAPT 基线对照；比较自主维度覆盖、审稿发现及采纳、最终质量盲评，以及 parent+consult 成本和总墙钟时间。继续不设 token 总量上限，沿用 $12 美元等值估算预算、两小时期限和 100 元人民币外层预算。

相关 [延后事项](../deferred-research-todos.md) 的 B/C/D（父子通信、总成本、跨压缩认知连续性）保持开放；地图导入和 consult 接线不能替它们证明语义帮助或净收益。

## 6. 组件类型发现与机会提示（后续修订）

本次真实运行的 workspace 中有 3 个 skill、3 个程序检查、2 个 subagent；visual reviewer 已实际调用，prompt 和 memory 均未创建。运行协议的 `fresh_batch=false`，所以这个样本不能说明 Agent 在真实 fresh-context 交接时是否会需要 memory。运行日志也没有 Agent 对未创建 prompt/memory 的明确理由。可观察机会是按维度归属的重复手工修改；此前状态表只报计数，没有说明不同组件解决的问题。

窄命题：提供一段通用、非强制的组件用途说明；当同一维度累计至少 3 次手工改动时，状态表提示 Agent 根据重复模式考虑 prompt、skill 或 tool，并说明 memory 用来恢复之后可能需要的事实/决策/反证，即使运行只有一个 batch。组件数不作为目标；合理不使用仍有效。memory 能力在每次任务状态中可见，且 Agent 创建的条目会进入下一次 task turn 和 fresh-batch handoff；不因 batch 配置关闭。预期是降低从工作重复或上下文丢失风险到组件候选的识别成本，而不预置具体组件内容或增加创建门槛。

实现入口：`demo/ppt_demo_extension.ts` 的 `self_component`、`save_program` 描述，重复手工编辑状态信号、常驻的短 memory 可用性状态和每次新 task turn 的 memory 注入。新增的描述成本进入工具 schema；重复编辑提示仅在达到阈值时出现；memory 正文仅在已有条目时随 task turn/workset 注入。当前进行中的 provider 会话在此改动前已加载 extension，不能作为这项改动的真实采用验证。

下一可证伪检查：在新的干净 workspace 分别运行单 batch 与 fresh-batch 配置，检查 Agent 是否能区分类型、识别适用机会并实际使用 memory，保留合理不使用样本；比较触发与调用之后是否减少同维度手改或重复找回，并同时核算父子成本、延迟及任务质量。组件数上升本身不构成支持证据。功能路径尚未由新进程实跑；自主采用和净收益未验证。

## 7. 首轮产物的质量覆盖复核（后续优化）

真实运行已显示：Agent 自建的维度检查会在每次渲染后执行，但独立 `coverage_review` 只在 `office(deliver)` 才调用。这样首轮设计产物和大规模制作阶段看不到地图外的质量缺口；交付门禁过晚才把盲审结果带回状态表。用户希望 Agent 自主考虑审美、视觉表达和趣味性，同时保持 workspace 不预置领域标准。

窄命题：若地图中有 Agent 创建并登记的 coverage reviewer，runtime 在首轮渲染后调用一次盲审，将 verdict、理由和证据引用写入同 revision 的状态表；若 reviewer 报告 gap/unknown、质量地图或 reviewer 版本变化，则修订后的渲染再次复核；交付前仍确保当前 revision 已通过。reviewer 只看 brief、原始材料、receipt 和图片，不看地图。runtime 不写维度、不预设 PPT 风格或图表要求。无 Agent 创建的 reviewer 时仍显示缺失并在交付门禁处理。

成本与回馈：复用已登记 reviewer，首次渲染增加一次同模型 consult；无缺口且地图未变时不对每次中间渲染重复调用；发现差距后每次修订渲染重审，交付若产物后来变化则审阅最终 revision。评语以 `coverage_review` 状态尾随在质量表末尾，Agent 可据此决定补维度/方法或修改产物。失败记 `unknown`，不得当作 pass；交付时重试当前 revision 的未知结果。

实现入口：`demo/ppt_demo_extension.ts` 的 `runCoverageReview`、render 后触发条件、`statusText` 与 delivery 复用。Agent 作者身份、图片接收、map 隔离和 revision/hash 缓存沿用现有接口。当前活跃 provider 进程早于本次源码修改启动，不能证明这一新链路已运行；不新增组件、不增加固定 reviewer 角色。

单次真实运行已覆盖上述一部分：Agent 创建 visual reviewer 并在渲染后通过图片进行维度检查；Agent 创建的 blind coverage reviewer 在交付时检查 brief、原材料、receipt 与全部 15 页图像，v013 被拒，Agent 修改导航计数和内容后 v015 获准。该样本证明链路及对反馈的实际响应；尚未验证多次中间 render 的调用策略是否经济、检查是否稳定，以及真实任务表现是否优于基线。

## 8. 最终运行与恢复记录（真实 provider，2026-11-03）

用户要求按最终稿渲染时，核对发现 v012 的 receipt 与 canonical `artifacts/presentation.html` SHA-256 一致（15 页、0 renderer warnings）。随后继续同一真实 provider 会话：OpenAI Codex OAuth、GPT-6 Luna high、初态干净、没有 token 总量上限；没有开发者中途提示。最终由 Edge headless 产出 v015，并打包到 `delivery/presentation.html`。预览缩略图为 `exports/v015/contact-sheet.png`，逐页图像与 receipt 在 `workspace/results/renders/v015/`。

首次恢复时，runner 读取 `.harness/ppt-loop.json` 失败。该文件按 UTF-8 写入，含字符 `→`；Windows 默认 GBK 解码在 byte offset 10530 抛出 `UnicodeDecodeError`。`src/autoresearch_pi/ppt_demo.py` 中协议、任务 provenance 和 loop state 的 `read_text()` 现显式使用 `encoding="utf-8"`，随后从相同 workspace/session 恢复。修复后 Pi 越过原崩溃点并完成交付；这不是第二个独立样本。

最终证据：Agent 自己创建 4 个质量维度、3 个方法 skill、3 个程序检查和 2 个 reviewer subagent。程序检查对 v015 全部通过，视觉 consult 通过；delivery blind review `coverage_reviewer` 实际收到 brief、原文、receipt 和 15 张 PNG，返回 `ok=true` 并放行。v013 曾被该 reviewer 拒绝，指出逐页导航数字固定显示 `1 / 15` 和其他内容问题；Agent 修改 HTML、更新检查、重新渲染，后续复核通过。交付文件位于 `D:\agent\AppData\Local\Temp\ppt-quality-reviewer-fix-20261103\delivery\presentation.html`，预览位于同目录 `exports\v015\contact-sheet.png`。完整运行证据包含 `session.jsonl`、`harness/quality.jsonl`、`harness/consult_runs.jsonl`、`harness/renders.jsonl` 和 delivery 内的 `harness-evidence/`。

消耗记录：session 记录 102 次 parent provider 请求、5,366,184 个报告 token；包含 child 的 `model-usage.jsonl` 共 127 次模型请求（102 parent + 25 consult）、5,935,214 个报告 token，按 GPT-6 Luna 标示 API rate 估算约 $0.31。Codex OAuth 订阅用量不是 API 账单，该数仅为等值估算。总运行约 99 分钟，低于两小时及 $12 估算预算；100 元人民币上限未触及。单次运行无对照，净收益仍未验证；延后事项 B/C/D（父子通信、完整成本、跨压缩连续性）保持开放。

## 9. Agent 自塑流程与表达多样性（用户确认，待新进程验证）

上一真实运行从干净 workspace 开始，Agent 自建了三维质量地图、三个 skill、一个结构检查程序和两个 reviewer。HTML 主要采用重复的数字卡片布局，仅有少量横条表达；`design_review` 只审查层级、易读、对比度和导航。Agent 退役失败的结构检查程序后，没有创建可视化生成工具。运行时质量模型与盲审未把信息关系表达单一识别为差距，运行流程也要求先有地图才可写/渲染，缩小了先试表达、再形成标准的空间。这些是观察；“流程先验与缺少开放探索提示导致漏掉视觉机会”是待验证解释。

**窄命题：**允许 Agent 在地图创建前用原型探索和运行自己创建的方法；加入少量领域无关提示，鼓励图文并茂、形式随内容用途变化，并让 Agent 自己比较代表性替代表达、据效果修订标准/方法/工作流。独立审稿只在有具体证据时指出单一表达是否遮蔽内容关系，不要求为了多样而多样。期望改善数据密集任务的信息理解，并让适用的绘图方法自然从需求中产生。

实现入口：`demo/prompts/ppt_demo_system.md` 支持 Agent 自选起点、用原型逐步形成标准、表达方式按受众任务变化；`demo/ppt_demo_extension.ts` 去除质量地图对原型编辑、渲染以及 task-local program 创建/运行的前置要求，把未归属修改标为探索并在地图出现后提示 Agent 判断是否值得纳入；地图建立后仍按维度记录后续产物修改，最终交付门禁不变。blind reviewer 获得一条开放式、证据约束的表达多样性审查问题。没有新增特定图表、布局、质量维度或绘图工具。

**验证协议：**新进程使用干净 workspace 和中性高数据量 brief；不要求创建图表工具或指定设计维度。检查 Agent 是否自主发现表达机会、是否尝试对照表达、是否据证据形成或拒绝新标准/组件/工作流；验证前地图原型可真实渲染、后续方法可真实运行、最终交付仍受质量检查保护。负例包括原材料已清楚、视觉变化会降低一致性、代表性比较无改善；合理不创建工具应被保留。同步记录 parent+consult 成本、首次有效比较延迟、阅读质量和交付完整性；仅一次运行只作采用样本，不能证明净收益。

功能语法检查通过。新的真实 Pi runner/provider 进程从干净 workspace 启动，证明了地图前写原型并经 Edge 渲染、随后由 Agent 创建质量地图/检查器/skill/reviewer 的路径；Agent 自行创建 audience_clarity 维度，迭代修复一张比例误导的条形图，并按 reviewer 反馈补充 CECL 过渡说明和 managed-basis 口径。实际发生了 9 次渲染和至少 2 次 coverage consult。检查器最终能对 15 页结构、导航、自包含和数据页引用返回通过；本次运行中 Agent 没有创建专门的绘图生成 tool/skill，也没有把多样性单独升格为质量维度。审稿者认为卡片/表格的重复形式没有遮蔽内容差异，因此没有要求为多样而改变设计。这支持“探索自由度、通用表达提示和证据审阅可进入真实决策循环”，但不证明视觉多样性提高或绘图组件自主采用概率上升。

本次进程的交付没有完成：Agent 两次尝试交付均收到 `Render the canonical deck source before delivery.`；其后再次渲染 `artifacts/earnings.html` 仍未满足 runtime 的 canonical-source 条件。按项目重复死路规则停止继续绕行。因而这条样本只能验证原型、地图、真实渲染、检查器和 reviewer 的可达性；不能记为全链路完成或交付成功。后续已修正 source resolver：唯一 HTML 文件可作为 canonical source，默认 render、状态表和 delivery 使用同一来源；存在多来源时提示 Agent 消歧。本轮按用户要求不启动真实任务/provider，也不运行测试；语法与行为均未验证。自主创建专门绘图组件、最终 HTML 导出/打包、父子成本及净收益仍未验证。下一项可证伪检查是用本地/受控路径确认 `artifacts/earnings.html` 可从默认 render 到 delivery，再用独立干净任务观察 Agent 是否会自主比较表达并沉淀可复用绘图方法。

## 10. 通用 self-harness 引导（实现与短运行观察，2026-11-03）

System prompt 增加精简的通用判断原则：Agent 同时负责任务结果与自己的工作方式；依据证据、预期瓶颈、重复劳动、不确定性、失败或连续性风险，自己决定直接推进还是调整 harness；调整的价值要由后续任务工作观察，创建/调用组件或检查通过不能代替收益证据。移除了 prompt 中预先规定的 PPT 表达建议和固定质量循环说明。

新增 `demo/prompts/ppt_demo_agents.md` 作为任务级 `AGENTS.md` 的来源。它给出可选的机会识别、低成本试用、后续验证和保留/修订/退役思路，不要求表单、阶段序列或预设质量维度。`prepare()` 将它作为通用说明写入新 workspace 的 `AGENTS.md`；由于 Pi runner 使用 `--no-context-files`，`before_agent_start` 显式读取并加入实际 system prompt。Protocol 分别记录来源文件与 workspace 指引的 hash。开发用仓库 `AGENTS.md`、流程模板和开发者验收规范没有复制到任务 workspace。

真实接线观察：GPT-6 Luna high 的新进程从干净任务 workspace 启动。provider 的第一个实际请求记录同时包含新的 system prompt 与 workspace `AGENTS.md`。Agent 先尝试原型，再创建任务地图、检查程序和 reviewer；随后经历目录/渲染接口摩擦并完成 7 次真实 Edge 渲染。记录到 43 次 parent 请求及 7 次 consult，请求合计报告约 1.64M tokens、标示费率等值约 $0.07。为止于接线与行为观察，本轮在交付前结束；这不是完整任务样本，也不支持引导提高使用概率或作品质量的结论。早期创建地图和 reviewer 同时受到 runtime 交付约束影响，不能单独归因于新提示。

功能路径由真实 provider 和实际工具交互确认，`git diff --check` 通过；没有运行测试。下一步若要判断引导是否提升采用率，需在同模型、同任务和预算下比较“能力接口”与“接口加通用引导”的独立干净运行，观察机会识别、适当的不使用、实际后续使用及结果，并计入 parent+child 成本。当前 prompt/AGENTS 文本仍是待比较的实验版本。

## 11. 自主运行完成与组件覆盖诊断（2026-11-04）

按用户补充要求，Codex 只启动并定时只读检查运行状态；不中途发送任务指令、代选质量决策或停止仍在工作的 Agent。第一次被 Codex 中断的执行因用户纠正而从原 workspace 恢复，随后 Agent 自行继续并完成。

真实 provider 路径：OpenAI Codex OAuth / GPT-6 Luna high；JPMorgan Chase 3Q21 HTML brief；一条连续 context。Agent 自主产出并送审 18 个修订，Edge 对每个 revision 生成 15 页 HTML 预览；最终 v018 的 Agent-authored `validate_earnings_deck` v4 对 7 项返回通过，blind coverage reviewer 对 v018 返回 pass，随后 Agent 自行执行 `office(deliver)`。`summary.json` 记录 `complete=true, stop=delivered, revision=18`。共 90 个 provider requests、89 条 usage records、约 5,012,058 报告 tokens、18 次 consult，按 runner 估值约 US$0.32；OAuth 用量不是 API 账单。运行从首个 provider 请求至交付约一小时；单次运行无对照，不支持因果质量改进或净收益结论。

沉淀盘点：Agent 作者了 `agents/coverage.md`、`skills/earnings_deck_review/SKILL.md`、`tools/validate_earnings_deck.py`，并将 skill 与检查工具登记到 map，最后在真实后续工作中运行检查工具。没有 Agent-authored prompt 或 memory。主要原因：本次采用单批连续对话；runtime 每轮回送任务摘要和 memory 可用状态，Agent 没有真实 context-loss/handoff 恢复负担。对 prompt，Agent 将重复的证据审查流程归入 skill/tool，没有把它判断为独立的跨轮行为规则。此判断符合原可选引导，但未达到用户本任务“每种组件都要有少量沉淀”的明确目标。

修订决定：以本任务日志中出现的重复审稿、持续行为规则和跨上下文续接作为真实证据；仅把组件覆盖目标写入通用任务引导，仍由 Agent 自己撰写和使用内容。下一次从新 workspace 和同 brief 启动 GPT-6 Luna high，使用 `--fresh-batch --batch-requests 10` 建立真实上下文切换；预期 Agent 为延续决策而产出 memory，并将跨轮反复有效的行为准则辨别为 prompt。统计五种组件各自的 Agent-authored 内容、保存后真实使用、修订/退役、带来的后续变化和总父子成本。未使用、不符合证据或只为计数而造的内容视为不达标，不由 Codex 替 Agent 填写。用户授权在实验未达目标时按此修订重启。

本轮证据边界：HTML 的任务交付成功且 7 项机械检查、盲审通过；自主沉淀为 3/5 类型，prompt/memory 覆盖未达标；方法净收益未验证。此前 `delivery/` 写入保护没有被 Agent 尝试触发，功能效果未验证。完整运行归档和交互展示尚未制作，待组件覆盖实验完成后统一生成。

## 12. Fresh-batch 五类组件实验与工具文件访问修正（2026-11-04）

按 §11 启动新 workspace、同一中性 brief、OpenAI Codex OAuth / GPT-6 Luna high、`--fresh-batch --batch-requests 10`。Agent 自己产出五类内容：`prompts/earnings_precision.md`（保留报告口径、比较期和重大项目 caveat）、`notes/memory/jpm_q3_2021_facts.md`（跨批关键事实）、`skills/earnings_story_arc/SKILL.md`、`agents/financial_deck_reviewer.md`，以及 3 个检查 tool。Reviewer 和 skill 有后续使用；memory 被注入后跨批续接；prompt 出现在后续 turn 的 active prompt 列表。此证据达到内容覆盖，但工具语义检查尚未闭环。

真实阻塞：多个 Agent-authored checker 使用 `pathlib.Path(...).read_text()` 读取 `artifacts/presentation.html`，在 WASI 运行环境中均报 `FileNotFoundError`；持续 12 批、124 provider requests、9 次 render 后检查仍为 unknown，未交付。结果文件中 memory 记录了任务来源、报告/managed 口径、重大项目和比较期；prompt 记录了来源口径/比较期/非经常项目提示。不是 provider、render 或批次恢复故障。

根因来自 `demo/arc_thin_components.ts` 的客体契约：runtime 以 `builtins.open = _open` 将 workspace 文件读取映射到虚拟快照；`pathlib.Path.read_text()` 走 `io.open`，不会经过这个映射。NativeRuntime 已按代码字面量请求文件并将内容加入 `files`，但 pathlib 仍在 guest 本地文件系统查找，因此失败。工具说明原有 “Use open/json for workspace text” 过于简略，未解释 pathlib 的限制；Agent 多次重试相同访问方式。

修正：在 `save_program` 和 `run_program` 工具说明中明确 workspace 文件是虚拟的，只能使用注入的 `open(path).read()` / `json(path)`，`pathlib.Path/read_text` 与原生文件访问不可读取任务文件。这是最小描述修正；没有改 Agent 产物、地图、测试规范或质量门禁。按用户“运行有问题则修复并重启”的授权，在 124 请求的真实失败样本后停止该进程；下一次必须从干净 workspace 实跑以验证本修正。

上一运行末次记录：123 条 usage、约 1,836,469 tokens、runner API-rate 等值约 US$0.11、7 次 consult；OAuth 实际订阅耗用不等于该估值。由于测试 checker 没有通过，虽然 v004 曾获 reviewer pass，整份 deck 未到交付阶段。fresh-batch 的状态文件显示两次重复 `batch_closed` 日志，尚未证明影响续接；检查只观察，不作未经确认的归因。下一次检查路径修正后的 checker 是否通过、五类组件是否均被后续语义使用、覆盖 reviewer 最终放行，以及 Agent 是否自行交付。

## 13. Entry-point 契约修正（2026-11-04）

§12 的最小文件读取说明修正已进入真实 runner：新 Agent 用 `open(...)` 成功读到 workspace，并创建/调用了 `html_deck_check` 等程序。随后 Agent 多版检查器定义 `main(args)`，普通 `run_program` 运行内容时能看起来成功，但 `checkProgram` 只识别 `_entry` 中的 `run(args)` 或 `observe(state)`，导致交付验收得到 `None`，地图行仍为 `unknown`，同一理由持续重现。当前检查器源和 runtime `_entry` 实现已交叉确认此根因。

本轮在 14 个 fresh batches、148 provider requests、约 1,771,318 报告 tokens、10 次 consult、8 次渲染后停止。agent 已有 prompt、memory、skill、tool、subagent 五类内容，但 checker 的签名不匹配阻止了地图通过与自动交付。停机时 reviewer 仍要求针对内容修改，尚无 delivery。成本估值约 US$0.10；Codex OAuth 订阅用量不等于账单。

修复是在 `save_program` 工具描述中明确 named tool 必须提供 `run(args)` 或 `run(args, env)`，地图 checker 必须返回 `{ok: boolean, reason: nonempty evidence string}`，单独的 `main()` 不是入口。此为真实工具契约的发现性修复，未改 sandbox 行为、quality gate 或任务内容。按用户授权，结束被相同门禁问题卡住的运行；下一轮从新 workspace 用同一模型、brief 和 fresh-batch 设置实际验证。

## 14. Fresh-batch 五类组件与最终交付（真实 provider，2026-11-04）

在 §13 的入口说明修正后，从干净 workspace 重启同一 JPMorgan Chase 3Q21 HTML brief。Codex 只启动 runner 并定时查看状态；8 批内未发任务指令、未编辑 Agent 产物，也未替 Agent 选择干预。OpenAI Codex OAuth / GPT-6 Luna high 自主完成 89 条 usage 记录和 7 次完整 15 页渲染，最终 `summary.json` 为 `complete=true, stop=delivered, revision=7`。末次 Edge headless 回执为 15 slides、0 warnings；回执 `source_sha256` 匹配渲染输入 `workspace/artifacts/presentation.html`。渲染器输出 `exports/v007/presentation.html` 与 `delivery/presentation.html` 的 SHA-256 相同（`df79905818a096433125ab46948589c2bd106c07165757ad11cd1ea4836073b2`），它们与原始输入不同是因为交付 HTML 是渲染器生成的演示页面。盲审在 v007 检查全部 15 页并返回 pass；v002 因 14 页空白被拒，v003–v006 的真实审查发现估算 caveat、类别遗漏、图形比例、同比期间和 CET1 表达差距，随后 Agent 自主修改并再渲染。

该 run 的 Agent-authored Harness 覆盖五类：prompt `citation_guard.md`、memory `jpm_bridge_caveat.md`、skill `earnings_storyline.md`、两个程序检查、subagent `earnings_editor.md`。版本账本分别记录 Agent 创建/更新；skill 与程序检查登记在质量地图，末版两项程序检查均通过；consult 轨迹共 9 条，记录了 reviewer 的独立反馈。最终交付包包含这五类内容和质量地图。组件“存在、登记、被调用”有本轮证据；跨任务迁移和长期净收益未验证。

本轮模型 usage 共 1,452,841 报告 tokens，runner 的 API-rate 等值估算约 US$3.69；OpenAI OAuth 订阅用量不等于 API 账单。时间从首条到末条 usage 记录约 15 分钟。前序 r2、r3、r3b、r4、r5 原始目录均保持原样，并压缩归档；最终交付、最后渲染联系表、receipt、manifest 和质量地图另放在 `docs/showcase/ppt-self-harness-jpm-2026-11-04/`。展示目录同时包含 Agent-authored prompt、memory、skill、2 个 tool、subagent 正文文件，并由五类组件卡片直接链接。对展示文件做了 JavaScript 语法与 13 个本地引用核对；归档清单完整读取通过，共 18,031 个条目，约 984.4 MiB，包含五轮原始目录和最终 deck。最终 15 页联系表已人工查看；展示网页本身因当前 CUA 未提供可用浏览器会话，没有完成浏览器中的视觉/点击核验。

证据限制：真实运行链路和本次 Agent 自主迭代已实跑；程序检查与 reviewer 对当前交付通过；本次任务五类组件都有创建和运行记录。未做匹配基线对照，不能断言 harness 改动导致质量或净收益提升；跨任务组件复用、长时自主稳定性与完整父子成本仍需独立评估。
