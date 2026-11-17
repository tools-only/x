# 2026-11-16 自进化空间：三个关节的作者，以及 subagent 的开启

设计稿。**不改代码、不跑 provider。** 本稿只回答一个问题：M3c 之后，自进化为什么仍然浅，以及最小的改法是什么。章节按 `docs/templates/meta-harness-change.md` 组织（问题与命题 / 设计与成本 / 运行前实验协议 / 实现与验证 / 交付决定）。

---

## 0. 一句话

M3c 的失败不是权限不足：六个可写地址、每个请求边界都能激活、工具描述承诺"声明效果即开验证窗口"。失败在于自进化环的三个**关节仍由宿主执笔**——设计轮写什么、什么时候对照效果、什么时候结束——agent 只被允许在宿主的流程里微调自己。本稿把三个关节交还给编排，并把 subagent 作为一种 harness 组件打开（用户 2026-11-16 决定）。全部改动是接线与删除，不新增子系统、不新增必填字段、不新增评审入口。

---

## 1. 问题与命题

### 1.1 真实失败（`runs/evo-m3c-glm53f-meta-20261116`，az / glm-5.3-flash，2026-11-16）

时间线（每一行都能在该运行自己的记录里查到）：

| 时刻 | 事实 | 来源 |
|---|---|---|
| 08:46:00 | T0 设计轮的写入在第一个请求边界激活：`orchestration revision 1` | `harness/live_agent_self.jsonl` |
| ≤08:52:12 | 又一笔编排写入，最终 `revision 2`；形态：`contract` 三条 `look_when` 齐全，`steps` 只有 `work`，`transitions` 为空 | `.harness/live-self.json` |
| 08:52:49 | 唯一一次 render：15 slides，`source_hash 74d5e953…` | `harness/renders.jsonl` |
| 08:53:18 | 唯一一次结构性变更：`reflect_component` prompt `ppt_baseline_guidance` v2，**带 `expected_effect`** | `harness/tools.jsonl` |
| 09:01:37 | `office.deliver`：`artifactVersion 1`、`artifactHash 74d5e953…`——与变更前同一份 | `harness/live_agent_self.jsonl` |

结果：41 requests / 12.57M tokens / $2.10 / 961 s；10/10 单元提交；literal 28/30（unit-10 的 `$10.3`、`$10.2` 未命中）、citation 10/10；`window_created` **0 行**；render 与 deliver 两条 action 收据的 `transition.status` 都是 `recorded`、`existing_transitions` 为空。

读法：变更是真的，也生效了——它在交付前 8 分钟一直有效。**交付件从头到尾没变。** agent 不是不想进化：它声明了 `expected_effect`，但没有任何机制会拿这个声明去对照后来的段；它也没有可以走到的下一步，因为它的编排从头到尾只有一步。

### 1.2 三个关节由宿主写死（权限充足，作者缺失）

| 关节 | 宿主写在哪 | 运行里的后果 |
|---|---|---|
| **起点：设计轮的对象** | `metaBoard()` design 分支（`self_root.ts:735`）说 "this turn does not design an evolution loop"，要求的是 `contract` 的形状；T0 表面只有 7 个协议工具（`self_root.ts:1036`），agent 读不到材料 | "run plan" 只落到实处为 `look_when` 三行；steps/transitions 无人要求。M3c 交出的就是一步编排 |
| **移动：效果的对照** | 窗口只在 `inEvolutionReview` 时进候选（`self_root.ts:995`、`:1005`）；`inEvolutionReview` 要求一条 id 为 `evolution_review` 的 review 触发（`:1044`）；META 永不发这个触发（`:1362`）；常驻提示直说 "In this run no validation window is opened"（`self_root_meta_system.md:17`）；而工具描述两处写着 "declaring one opens a validation window"（`self_root.ts:155`、`:162`） | 三处互相矛盾，代码跟的是"不开窗"。**M3c 里唯一一次声明 `expected_effect` 完全落空** |
| **终点：交付** | `office.deliver` 收据之后立刻 `taskEnd('delivered')` + `state.complete = true`（`ppt_demo_extension.ts:509-512`）；core 的 `advanceAction` 本来就能对收据走 transition（`live_orchestration_core.ts:300-313`），但没人等它的结果 | 交付是宿主的终止符。agent 若要"交付后再看一遍"，必须先有权活到下一步 |

两个放大器，不单独构成失败，但让深度无从发生：

- **验收是下限**：`task_acceptance` 写的是"交付存在、15 页、有引用"，于是任何一次通过后的进一步改动都没有可对照的判据。
- **材料不在设计轮**：`data/instructions.md` 作为 `task_brief` 注入（`ppt_demo_extension.ts:702`），`material.txt` 不注入。设计轮写出的流程只能长在 brief 的形状上。这一条是 affordance 缺失，不是权限缺失。

### 1.3 命题（窄、可证伪）

在 META 臂上，只把上面三个关节交给编排（其余不变），**同一任务、同一 provider 的下一次运行会出现：变更之后仍有任务段，且该变更被用在交付件上。**

机械判据（全部来自运行自己记录的事实，不做语义判断）：

- **K1** 第一段任务之后至少一笔 agent 发起的结构变更（沿用 `metaAcceptance().changes >= 1`）；
- **K2** 该变更之后存在更晚的 `office.write` / `office.render`，其 `artifactHash` 与变更前最后一次 render 不同；
- **K3** 交付的 `artifactVersion` 指向 K2 那次（或更晚的）render。

K1∧K2∧K3 = 命题未被证伪。任一不成立 → 按 §3.4 归因，只改一个因素再跑。

M3c 的位置：K1 成立，K2/K3 不成立——而且当时没有任何窗口可以让它自己看见这一点。

### 1.4 负担移除

- 删掉宿主对空间的三句否决：`self_root_meta_system.md:3`（no task or review subagents）、`self_root_meta_system.md:17`（no validation window）、`self_root.ts:913`（v1 has one agent）。
- 删掉一处静默矛盾：工具描述承诺开窗、常驻提示说不会、代码两边都不是。
- 设计轮的写作义务不增加：仍是"写一次编排"，只是这次写的对象是流程本身，而不是一句验收标准。

---

## 2. 设计与成本

六项（A–F），按对深度的产出排序。每项都写明：改哪一行、为什么这是最小改法、谁推送、替代什么、怎么反馈、何时退役。

### 2.1 A — 设计轮的对象是整条编排（不是只填 contract）

**现状**：`self_root.ts:735`。设计文本确实说了 "write this task's run plan"，但同句限定 "does not design an evolution loop"，且 board 里 `run plan` 唯一可落的地点是 `contract.loop_policy.look_when`（事件→看什么）。M3c 的输出正是这个形状：三条 `look_when`、零 transitions。

**改法**（两处，都在宿主文本/表面，不动机制）：
1. design 相文本改为：填 TASK GOAL 与 TASK ACCEPTANCE，**并写出这次任务的流程**——几步、哪一步交付、交付之后还有没有一步、什么时候看自己的 harness；`contract` 仍是必填锚点，但不再是这一轮唯一的产物。文本不含任何任务词。
2. T0 表面加只读任务工具：`self_root.ts:1036` 的 `[...PROTOCOL]` 改为 `[...PROTOCOL, ...READ_ONLY]`，`READ_ONLY = ['read','ls','grep']`（三者都在 `contract.capabilities` 内：`evo_ppt.py:170`）。只是读；不注入摘要、不给结论。流程因此可以长在材料上，而不是 brief 的形状上。

**门槛不变**：仍只校验 `orchestration.contract` 的形状（`contractProblems()`）。**不**加"至少一条 transition"的门——那是 §15 取消掉的 M3b 门槛，也是新增的 resident obligation。

**推送/替代/反馈/退役**：宿主在设计相推一次（每请求同一文本）→ 替代"agent 从零发明流程"→ 写下的编排从下一请求起被应用，`provider_input.pin.revision` 可证 → 门在首次合法写入后退役，板面转 task 相。

### 2.2 B — 验证窗口回到机制内，由 agent 的声明开门

**现状**：`self_root.ts:995` 的条件是 `evolution && addresses.length && windowDue`；`:1005` 同一条件。`windowDue` 本身只由 `expected_effect | success_predicate` 决定（`:994`），`createWindow()` 也已经是纯宿主记账（只读段摘要、指标、相位，不解判）。

**改法**：
1. 去掉两处的 `evolution &&`。窗口是宿主替 agent 记账的服务，不是评审的附属物；工具描述里的承诺（`:155`、`:162`）随之兑现。
2. `metaBoard()` 在 task/boundary 相加一行：`WINDOWS: open N (due M)`，到期时列出该窗口的对照与未决项。`decide_validation` 已在 `PROTOCOL`（`self_root.ts:17`），不需要新工具。
3. `self_root_meta_system.md:17` 改为真话（声明效果会开窗、下一次结算给出对照、`decide_validation` 关闭它）；`ppt_demo_extension.ts:98` 的注释同步。

**成本与边界**：`taskIncomplete` 已包含 open window（`self_root.ts:588`），所以 agent 声明效果后需要走到一次结算——这是它自己的承诺，不是新增义务。未关闭的窗口由 `taskEnd` 在结束时收尾（`:1230`），不会悬挂。

**推送/替代/反馈/退役**：agent 主动声明 → 替代"人工判读改动有没有用"→ 到期给出段对照、`later_use_refs` 与未决项，`decide_validation` 关闭 → 每个窗口只结算一次。

### 2.3 C — 交付是收据，终点是编排的 `complete`

**现状**：`ppt_demo_extension.ts:509-512`。`recordAction('office.deliver', …)` 已经返回 `{ receipt, transition }`（`live_orchestration_core.ts:237`），`advanceAction` 已经会把 `to:'complete'` 兑现（`:310`）。宿主只是不看这个结果。

**改法**：按 `transition.status` 分派——
- `advanced` → **不**设 `state.complete`、**不**调 `taskEnd`；下一请求的 self view 里 step 已是新值，工作继续；
- `complete` → 与今天相同（`taskEnd('delivered')` + `state.complete`）；
- `recorded`（该步骤没有针对 `office.deliver` 的 transition）→ 与今天相同，交付即终点；
- `stalled`（写了针对该收据的 transition，但 `requires` 未匹配，或多条同时匹配）→ 回落为终点，并记一条 fact 说明原因。

也就是说：**没有写"交付之后"的编排，行为与今天逐字相同**；写了，就由编排决定。用 M3c 的编排（零 transition）回放，必须逐字得到今天的轨迹——这是实现时的第一条断言。

**推送/替代/反馈/退役**：agent 的工具收据直接推进自己的流程 → 替代"宿主决定何时结束"→ 下一请求的 `step` 与板面就是反馈 → `complete` 只能由 transition 到达；`agent_end` 的 `if (state.complete) taskEnd('delivered')`（`ppt_demo_extension.ts:757`）不变。

这一项是让 K2 在结构上可能的唯一一项：没有后一段，就无从"在更晚的段里被使用"。

### 2.4 D — `self_change` 进入 contract 的触发词表

**现状**：`live_orchestration_core.ts:8` `TASK_EVENTS = ['segment_boundary','failure','repetition']`；而 transition 的 `on` 早已支持 `action:"self.change"`（`self_root.ts:147` 的示例就写着它）。

**改法**：`TASK_EVENTS` 加 `self_change`。`ORCHESTRATION_CONTRACT_FORM` 由 `TASK_EVENTS.join('|')` 生成，自动同步；`contractProblems()` 同时接受。边界板面现有的 `Last change: …` 一行就是它的回显点。

**理由**：`self.change` 是运行自记事实（激活时记的 action 收据），符合 §15 "触发只能来自本运行自己记录的事实"。作用是把"改完就看自己改的东西有没有起作用"写成流程的一步，而不是靠 agent 记着。

**推送/替代/反馈/退役**：宿主常量 + 边界回显 → 替代 agent 自己维护"何时该看"的记账 → 边界到达即给原文 → 与 contract 同生共死。

### 2.5 E — 打开 subagent：它本来就是 harness 的一种组件

用户 2026-11-16 决定：去掉不允许 sub-agent 的设计与实现；sub-agent 是 harness components 的一部分，应当被开启并使能。

**现在的四处禁止**：

| # | 位置 | 内容 |
|---|---|---|
| 1 | `evo_ppt.py:171` | `writable` 不含 `components.subagent`，写入即 `assertWrite` 拒绝 |
| 2 | `self_root.ts:913` | `throw Error('v1 has one agent; task subagents are not authorized')` |
| 3 | `ppt_demo_extension.ts:336` | `if (experimentLimits && a.kind === 'subagent') throw Error('experiment authorizes one agent; no task subagents')` |
| 4 | `ppt_demo_extension.ts:230` | `modelResult` 在 experiment 下直接 throw："this experiment authorizes one serial agent; child provider calls are disabled"——写得出也问不了 |

**消费端已经存在，不需要新建**：`NativeRuntime.register()` → `registerSubagents()`（`arc_thin_native_runtime.ts:224-234`）把每个 `kind:'subagent'` 组件注册成同名 Pi 工具，调用即 `consult`；PPT 路径的 `runtime`（`ppt_demo_extension.ts:223`）就是这个 runtime，`modelResult` 也已接线。也就是说这不是"建 subagent 子系统"，而是"把四道闸打开，让已有的一条路走通"。

**改法**：
1. 打开 1–3。
2. `surface()` 的组件分支（`self_root.ts:1041`）把 `kind === 'subagent'` 与 `tool` 同等对待（仍在 `agent_tools` 能力之下），否则注册了也不出现在工具面。
3. `modelResult` 保留预算检查与 `kind:'consult'` 计量（`ppt_demo_extension.ts:231-247`），只删第一行的拒绝。
4. 记账对齐：`changeUsed` 的正则加 `subagent`（否则 subagent 地址落进"编排/策略"分支，永远算已使用）；`consumptionBindings`（`self_root.ts:771`）改成真实绑定（"registered callable; one consult per call, same model"）；`inventory`（`:1532`）与 `unsupported`（`:1836`）去掉 0 与 "task subagents"。
5. `self_root_meta_system.md:3` 删掉 "no task or review subagents are authorized in this experiment"，改为机制事实（可以定义、怎么被调用、一次调用等于一次 provider 请求）。

**预算事实**：一次 consult = 一次 provider 请求，必须计入同一授权上限，并出现在 `provider-requests.jsonl`（现有 `kind:'consult'` 行）。

**未验证（实现时必须实测，不靠推断）**：consult 是子调用，`before_provider_request` 会为它再走一次 permit——必须确认它**只被计一次**，且不会把父请求的 permit 预算翻倍。用一个不出网的 stub provider 跑一次即可判定。

**推送/替代/反馈/退役**：agent 自己写 `agents/<name>.md` → 替代"所有分析都由主代理串行做"→ 同名工具从下一请求起可调用，返回一段报告 → 调用的 `tool_succeeded` 就是它的使用证据；不调用则按未接记录（有 call point，不删）。

**常驻成本合计**（每个请求的增量）：A 只在设计相生效，任务段零增量；B 加一行窗口状态（约 60 字符）；C、D 零新增常驻文本（D 只改常量，设计文本里多一个事件词）；E 只在 agent 自己写出 subagent 之后才多一条工具声明。合计约一行。作为对照，本稿删掉的三句否决文本与一处自相矛盾说明，长度与之相当——净负担约为零。

### 2.6 F — 去掉没有对象的协议工具

`decide_exit` 在 `PROTOCOL` 里（`self_root.ts:17`），每个请求都广告；但 `exit()` 在没有活动 review 时直接抛错（`:1558-1575` 附近），而 META 从不打开 review。于是它是一个**看得见、调用即报销一次请求**的悬挂 call point（M4 上限 70 requests，一次浪费 2.4%）。

**改法**：`surface()` 在 `mech.meta` 且无活动 review 时不列出 `decide_exit`（`decide_validation` 保留，它有窗口这个对象）。不删工具本身——非 META 臂仍在用。零常驻成本，纯减法。

### 2.7 明确不做

- 不设宿主预设流程（用户已否决：流程必须留在 meta loop 里由 agent 按任务设计）。
- 不新增 planner / critic / 质量模型 / 外部评价信号。
- 不改 `self_root_meta_fields.md` 里的用户逐字文本（§15 的 1–3、7 号字段）。
- 不把任务内容写进代码、提示、schema 或测试期望。
- 不为窗口新增工具或新台账。
- 不为 subagent 新增专用工具：它就是组件。

### 2.8 五条设计不变量对照

- **通用，不适配任务**：A–E 的所有文本都不含游戏名、颜色、坐标、对象角色或策略提示；PPT 的形状由 `contract` 与材料提供。
- **agent-native**：consult 用父代理自己的模型（`modelResult.create`），不引入更强的外部模型。
- **服务支持、agent 决定**：窗口、计数、板面只报事实；改不改、看不看、何时交付由 agent 的编排决定。
- **无悬挂工件**：§2.1–2.5 每项都写了推送/替代/反馈/退役。
- **在线运行判定**：本稿只有接线；效果必须在真实运行里测，离线测试只证明功能与接线。

---

## 3. 运行前实验协议（M4）

### 3.1 臂与预算

- 臂：META 开（`EVO_META=1`、`EVO_A4=1`），任务与 M3c 同一 freeze 源、同一 seed；provider az，模型 glm-5.3-flash。
- 授权总额：600 requests / 14400 s / 2 GiB（用户 2026-11-16）。
- 已用：M1 40 + M2 25 + M3 45 + M3b 13 + M3c 41 = **164**；余 **436**。
- **M4 声明上限：70 requests（含 consult）**，超出即停；重跑计入同一额度。
- 停止规则：requests 达 70 / 墙钟达 1800 s / 交付完成，三者先到者。
- 父/子成本分开记：consult 的请求与 token 在 `provider-requests.jsonl` 以 `kind:'consult'` 单独成行，同时计入 70 requests 与 token 总数；报告时父代理与子调用分列，不合并成单一数字。

### 3.2 预注册观察点（机械，全部来自运行日志）

1. T0 编排形状：`steps >= 2` 或 `transitions >= 1`（`.harness/live-self.json`）。
2. 设计轮读到材料：T0 之后出现 `read/ls/grep` 的工具收据（`harness/tools.jsonl`）。
3. 第一段之后的变更：`changes >= 1` 且时间晚于第一次 `submit_unit`。
4. 窗口：`window_created >= 1`；到期时有对照；`decide_validation` 至少一次。
5. **主判据 K2/K3**：变更之后的 render hash ≠ 变更前；交付版本指向它。
6. subagent：是否至少写出一份 `agents/<name>.md`；是否至少一次同名工具调用成功。
7. 质量地板：literal ≥ 28/30、citation 10/10、15 slides、10/10 单元（不低于 M3c）。
8. 成本：requests / tokens / 墙钟 对比 M3c（41 / 12.57M / 961 s）。

**旁证不主判**：`metaAcceptance().used_later` 的现有口径，对 prompt/skill/memory 是"后来的请求里 `component_addresses` 含它"，对 orchestration/policy 是"后来有过一次 `provider_input`"（`self_root.ts:691-699`）——两者都近乎恒真，M3c 的计数不能说明改动起了作用。因此 M4 的主判据是 K2/K3 的 artifact 事实；`used_later` 只作旁证，报告里注明口径。

### 3.3 预先声明的负例

- 只改 prompt、不重排交付流程 → 变更未进交付件，K2 失败。这是**结果**，不是 bug。
- 写了 subagent 但一次没调用 → 有 call point 未接；记录，不删。
- 声明了 `expected_effect` 却不到结算就结束 → 窗口在 `taskEnd` 收尾，记为未闭合。
- 交付后游走不收敛（request 到 70 仍未交付）→ 记为 delivery-as-transition 的代价；修的是编排可见性（step、剩余请求数），不是宿主重新接管终止。

### 3.4 归因（失败时只动一个因素）

- **F1** 设计轮仍只有一步 → 改 design 文本的对象（让它必须点名"哪一步交付、交付之后是什么"），不动别的。
- **F2** 有流程但不移动 → 改边界板面给的证据（它在边界上看到的事实太少）。
- **F3** 移动了但交付件没变 → 记录为 agent 的选择无效，下一个单因素是质量信号，不是再加机制。
- **F4** 窗口开了但没人关 → 改窗口在板面上的可见度，不改义务。

### 3.5 证据边界

本稿不对任何 provider 行为下结论。A–E 的"自主采用"与"净收益"两列在 M4 之前一律未验证。

---

## 4. 实现与验证

### 4.1 实现位置（工作树，未提交，未运行）

§2.1–2.6 六项在当前工作树里的实际落点。**行号只对当前工作树成立**：改动尚未提交，其它分支上的同一文件会漂移。

| 项 | 落点（`file:line`） |
|---|---|
| **A 设计轮的对象** | design 相文本 `demo/self_root.ts:737`（`DESIGN TURN` 分支：要求写出 steps/transitions、哪一步交付、交付之后还有没有一步）；T0 表面 `demo/self_root.ts:1040`（`metaT0Pending` 分支在 `protocolSurface()` 之后加 `['read','ls','grep']`，按 `contract.capabilities` 过滤）。门槛未变：`demo/live_orchestration_core.ts:16-33` 的 `contractProblems()` 仍只校验 `orchestration.contract` 形状，T0 gate 在 `demo/self_root.ts:948-952`，未加"至少一条 transition"。 |
| **B 窗口回到机制** | 去掉两处 `evolution &&`：`demo/self_root.ts:998`（pending windows）、`:1008`（`validation_window` 行）。板面窗口行：`demo/self_root.ts:719`（活动窗口过滤）、`:752`（`WINDOWS:` 行）。收尾与义务：`:588`（`taskIncomplete` 已含 open window）、`:1239`（`taskEnd` 结算未闭合窗口）。文本 `demo/prompts/self_root_meta_system.md:17`；注释 `demo/ppt_demo_extension.ts:98`。`decide_validation` 仍在 `PROTOCOL`（`demo/self_root.ts:17`），无新工具。 |
| **C 交付是收据** | `demo/ppt_demo_extension.ts:515`（`recordAction('office.deliver', …)`）、`:519-527`（按 `transition.status` 分派：`advanced` → `continues`，不设 `state.complete`、不调 `taskEnd`；其余回落为终点）；`:81`（`taskComplete` 纳入 `snapshot().complete`）、`:769-781`（`agent_end`，`:775` 的终止条件）。core 侧 `demo/live_orchestration_core.ts:237`（`recordAction` 返回 `{receipt, transition}`）、`:300-313`（`advanceAction`，`:310` 兑现 `to:'complete'`）。文本 `demo/prompts/self_root_meta_system.md:11`、`demo/ppt_demo_extension.ts:728-729`（META 的 `coreLine`）。 |
| **D `self_change` 触发** | `demo/live_orchestration_core.ts:8`（`TASK_EVENTS` 加 `self_change`）；`:9`（`ORCHESTRATION_CONTRACT_FORM` 由 `TASK_EVENTS.join('|')` 生成，自动同步）、`:29`（`contractProblems()` 接受）。收据侧：`demo/self_root.ts:546-549`（META 下把 `self.change` 声明为收据类型）、`:1075-1081`（`metaSelfChange()` 在激活时 `recordAction('self.change', …)`）、`:1106`（回显进 `reflection_activated`）；边界板面的 `Last change:` 行 `:739`；示例 transition `:147`。 |
| **E subagent 作为组件** | 四道闸：`src/autoresearch_pi/evo_ppt.py:171`（`writable` 含 `components.subagent`）；`demo/self_root.ts:916-917`（删掉 `v1 has one agent` 的 throw，subagent 与 tool 同走名字冲突检查）；`demo/ppt_demo_extension.ts:342-343`（`reflect_component` 派发里删掉 experiment 的 subagent 拒绝）；`:229-250`（`modelResult` 删掉第一行拒绝，保留预算检查与 `kind:'consult'` 计量）。表面与记账：`demo/self_root.ts:1045`（`surface()` 组件分支把 `tool` 与 `subagent` 同等对待，仍在 `agent_tools` 之下）、`:693`+`:698`（`changeUsed` 正则与 `tool_succeeded` 判定）、`:774`（`consumptionBindings().subagent`）、`:730`（`metaBoard()` harness 行的 subagent 计数）、`:1541`（`layersView` 的 `subagents`）、`:1845`（`unsupported` 去掉 `task subagents`）。注册与激活：`demo/ppt_demo_extension.ts:264-276`（`onReflection` 把 `tool`/`subagent` 一起注册并 `setActiveTools`）、`:542`（首次注册）、`demo/arc_thin_native_runtime.ts:226-234`（`registerSubagents()`）。常驻文本 `demo/prompts/self_root_meta_system.md:3`。 |
| **F 悬挂协议工具** | `demo/self_root.ts:1049-1051`（新增 `protocolSurface()`：`mech.meta && !review` 时从 `PROTOCOL` 过滤掉 `decide_exit`），被 `:817`（`pinView` 的 `operations`）、`:1040`、`:1044` 使用。工具本身未删，非 META 臂照旧。 |

### 4.2 离线证据（未执行）

无 provider 的检查清单：

- T0 表面含 `read/ls/grep`；`contractProblems()` 行为不变。
- 非 review 状态下 `expected_effect` 开窗；窗口行出现在板面；`decide_validation` 可关闭。
- 交付收据：有 transition → 不设 `complete`；无 transition → 与今天逐字相同（用 M3c 的编排回放断言）。
- `self_change` 被 `contractProblems()` 接受，并被 design 文本列出。
- subagent：写入通过 `assertWrite`、出现在 `surface()`、被 `registerSubagents()` 注册、`changeUsed` 能计数。
- consult 计量：stub provider 下计一次、不翻倍。

**以上六条一条都还没有执行**：本工作树里没有跑过 node/pytest，也没有 stub provider。§4.1 只是代码位置，不是证据。

### 4.3 证据层级（模板口径）

更新于 2026-11-16（M4 之后，细节见 §6）：

| 层级 | 状态 |
|---|---|
| 功能正确 | **已验证**：`tests/self_root_meta.test.ts` + `tests/self_root.test.ts` 39/39 通过（node --experimental-transform-types，本工作树），含 M4 后新增的压缩断言 |
| 全链路可达 | **已验证**（M4b，az / glm-5.3-flash）：T0 编排写入被每个后续请求应用；`harness/provider-requests.jsonl` 里 SEGMENT BOUNDARY 板面推送 15 次；4 次热修改均在下一请求生效并解除同类拒绝 |
| 自主采用 | **部分**：K1 成立（agent 自发 4 次编排修改，3 次晚于第一个任务段），K2/K3 不成立（交付物字节未因任何修改而变）；subagent 0 写 0 调 |
| 净收益 | **未定**：对 M3c 同任务同 provider——requests 41→38、tokens 12.57M→1.59M、墙钟 961→1150 s、质量地板持平（literal 28/30、citation 10/10、15 slides、10/10 单元）；但全部自修改只在解自己编排造成的锁，对交付质量贡献 0 |

### 4.4 偏差

- **§1.2 与 §2 的行号是改动前的**：它们描述 M3c 当时读到的代码。按当前工作树，`self_root.ts:735` → `:737`、`:1036` → `:1040`、`:995`/`:1005` → `:998`/`:1008`、`:1044` → `:1053`（`inEvolutionReview`）、`:1362` → `:1356`/`:1373`（两处 `!this.mech.meta` 守卫）、`:1558-1575` → `:1567` 起、`:1532` → `:1541`、`:1836` → `:1845`、`:913` → `:917`、`:771` → `:766`/`:774`；`ppt_demo_extension.ts:336` → `:342`（该 throw 已删，342-343 是原位置）、`:230` → `:229`、`:509-512` → `:515-527`、`:702` → `:716`、`:757` → `:775`。§1 作为历史记录不改写，现行落点以 §4.1 为准。
- **A 没有 `READ_ONLY` 常量**：设计写 `READ_ONLY = ['read','ls','grep']`，实现把三者内联在 `surface()` 的 T0 分支（`self_root.ts:1040`），并按 `contract.capabilities` 过滤。
- **B 的板面行形状**：设计写 `WINDOWS: open N (due M)`，实现逐个列出活动窗口的 id、地址、状态与声明效果（`self_root.ts:752`），信息更宽，形状不同。
- **C 的 `stalled` 归因**：设计写"记一条 fact"，实现写在 `harness/lifecycle.jsonl` 的 `delivery_transition_stalled` 行（`ppt_demo_extension.ts:520`），不是 ledger fact。
- **F 的前提部分不成立**：`decide_exit` 在改动前就已经不在 provider schema 里——`selfRootToolSchema` 对 `decide_exit` 返回 `evo.exitOperationSchema`（`demo/self_root_ppt.ts:143`），无 review 时为 `undefined`，`ppt_demo_extension.ts:692-694` 据此过滤。它留在 `surface()` → Pi 的活动工具表里，调用即被 `exit()` 拒绝（`self_root.ts:1568`）。F 去掉的是这一条悬挂的 call point，不是一条被广告的 schema。
- **E 的 `inventory` 不止一处**：除 `layersView`（`self_root.ts:1541`）外，`metaBoard()` 的 harness 行（`:730`）也加了 subagent 计数。

---

## 5. 交付决定

- **已实现、已提交（`538ac815`）、未运行**（写于提交当天；同日稍后已运行，结果与证据见 §6）：§2.1–2.6 的 A–F 全部落在工作树——A 设计轮写整条编排（`self_root.ts:737`）并在 T0 表面开只读工具（`:1040`）；B 声明效果即开窗并把窗口放进板面（`:998`、`:752`）；C 交付收据按编排的 `transition.status` 分派（`ppt_demo_extension.ts:515-527`）；D `TASK_EVENTS` 加 `self_change`（`live_orchestration_core.ts:8`）；E subagent 作为普通可写组件打开（`evo_ppt.py:171`）；F 无 review 时不再列出 `decide_exit`（`self_root.ts:1049-1051`）。没有 provider 调用、没有离线检查、没有占用 M4 预算；§4.3 的四行证据层级全部仍是**未验证**。
- 实现范围 = §2.1–2.6；**A–F 由一个提交承载**：六项交叉在同一批文件里（`self_root.ts` 同时被 A、B、E、F 修改，`ppt_demo_extension.ts` 被 C、E 修改），逐项拆分只会把同一函数切成半截。按 K 判据的归因以 §4.1 的逐项 `file:line` 表和运行日志为准，不依赖提交切分。
- **明确不做**：
  - 不在循环之上再加一层：没有 planner、critic、质量模型、外部评价信号，也没有宿主评审中断；三个关节交还给编排，宿主只记账。
  - 不由宿主写下一步：交付之后走向由 agent 自己的 transition 决定；没有匹配的 transition 就与今天逐字相同地结束。宿主不代替 agent 决定何时设计、何时对照效果、何时结束。
  - 不设预设流程：设计轮要求写出流程，但不规定几步、哪一步交付、交付之后做什么。
  - subagent 只作为一种普通可写组件打开：`components.subagent` 进 `writable`，`agents/<name>.md` 经 `reflect_component` 定义，同名 Pi 工具调用即 `consult`；它跑本运行自己的模型（`modelResult.create`），一次调用计入同一 request 预算与 token 计量，在 `provider-requests.jsonl` 以 `kind:'consult'` 单独成行。没有专用工具、没有预定义角色、没有更强的外部模型。consult 是否只计一次、不翻倍仍未验证（§2.5、§4.2）。
- M4 运行以 §3.1 的 70 requests 上限为准，运行前写进启动脚本并在 `summary.json` 可核。
- 与 §15 的关系：§15 固定的是**机制**（七字段、激活语义、验收计数），本稿改的是**关节的作者**与**组件种类**；`self_root_meta_fields.md` 的用户逐字文本不动。

---

## 6. M4 运行记录（2026-11-16）

预算按 §3.1 的 600 requests 系列授权：M1 40 + M2 25 + M3 45 + M3b 13 + M3c 41 = 164；**M4a 声明 70、用 6**；**M4b 声明 64、用 38** → 系列已用 **208**，余 392。两次都写进各自 `-caps.json` 与 `-run.cmd` 的授权文本，可在 `runs/*-launch.log` 复核。

### 6.1 M4a（`runs/evo-m4-glm53f-meta-20261116`）：设计写入被宿主 schema 拒绝，启动即死

6 次请求后以 provider 侧致命错误结束。归因明确在**宿主**：`normalizeOrchestration` 要求 v1 必填 `roles`，而 agent 按板面合同写的是单 agent 的运行，没有理由复述一条恒真的 `roles`。四次拒绝的报文都是 `v1 roles must be only agent`。

修的是宿主，不是 agent：`roles`/`slots`/`decisions` 缺省时补 `[{id:'agent'}]`/`[]`/`[]`，**声明了就绝不覆盖**（`ce4178f4`）。DESIGN TURN 文本补一句"The gate opens at that write, and the write puts the run in your first declared step"，让 agent 知道写完之后自己在哪。这是 §3.4 F1 的反面：坏掉的是宿主侧的一道形状校验，不是设计轮的对象。

### 6.2 M4b（`runs/evo-m4b-glm53f-meta-20261116`）：通关，但自进化只解自己的锁

同一 freeze 源、同一 provider（az）、同一模型（glm-5.3-flash）、同一臂（B，`EVO_META=1 EVO_A4=1`），工程提交 `ce4178f4`。声明 64 requests（含 consult），实际 **38**（1 次预检 + 37 次真实请求），**1.59M tokens**，墙钟 **1150 s**，registered estimate **$0.26**，`stop: "delivered"`，10/10 单元交付，15 页、0 renderer warnings，`self_revision` 6。

**过程（按请求顺序）**

1. **T0 设计轮（req 1–5）**：8 次 `read`（素材与环境）+ 2 次被拒的 `reflect_orchestration` + 第 3 次成功（revision 2）。两次拒绝都由 agent 自纠，宿主未改：先是一个 decision 绑到了运行时从不记录的 action 类型 `fact`（拒绝报文列出了本运行真实记录的 receipt 类型），后是 `loop_policy` 发成了数组、`look_when` 缺失。写出的编排：`build → render → deliver → complete`，三个 transition 各由一种 receipt 触发，`look_when` 绑 `segment_boundary`。
2. **交付物只写一次**：1 次 `write` 生成 `artifacts/presentation.html`（34,839 字节），此后从未被改。
3. **两次渲染，字节相同**：v001（`action-2`）、v002（`action-4`）的 `source_sha256` 都是 `ad0e74fc1484…`。
4. **四次自修改，全是权限修补**（每一条都由"自己的编排拒绝了自己的下一步"触发）：
   - rev 3（req 16）：`build` 步调 `office.render` 被拒 → `steps_by_id.build.actions += office.render`
   - rev 4（req 20）：`render` 步调 `submit_unit` 被拒 → 扩 `deliver` 的 actions
   - rev 5（req 24）：`build += submit_unit, edit`，`render += submit_unit`
   - rev 6（req 36）：`build` 步调 `office.deliver` 被拒 → `build.actions += office.deliver, office.look`；交付随即在 build 步成功
   证据：`runs/…-launch.log` 的 `runtime_activations`（req 5/16/20/24/36 五行）；每次拒绝后同类拒绝不再出现。
5. **边界推送 15 次，一次未被使用**：`harness/provider-requests.jsonl` 里 `SEGMENT BOUNDARY` 与 `Your run plan for this event` 各出现 15 次，`office.look` 调用 **0** 次。
6. **结束方式不是 agent 写的**：`office.deliver` 在 `build` 步被记录，`to_deliver` 只有 `from: render`，所以 agent 的 `build → deliver` 这条边不存在；`build` 步又没有出口，deliver 的 receipt 以 `status:"recorded"`、`host_deferred:false` 返回。真正宣告结束的是宿主的 final-delivery 兜底（`finalDeliveryTools: ['office.deliver']`），`harness/lifecycle.jsonl` 只有两行：注册 + `delivered`。

**K 判据**

| 判据 | 结果 | 依据 |
|---|---|---|
| K1：首个任务段之后至少一次 agent 发起的结构变更 | **成立** | 11 次 `submit_unit` 中第一次在 rev 3 之后；rev 4/5/6 都晚于它；四次 activation 全部在下一请求生效 |
| K2：变更之后的一次 render/write 产出不同 `artifactHash` | **不成立** | 交付物单次写入；v001/v002 字节一致；四次修改全部发生在渲染之后 |
| K3：最终 `artifactVersion` 指向 K2 那次渲染 | **不成立** | 交付指向 v002，即与 v001 字节相同的版本 |

结论：命题**部分成立**。"变更 → 激活 → 下一请求 → 拒绝消失"这条链路在真实运行里闭合四次，不是可用性幻觉；但自进化**没有被用于改进任务成果**，只被用于解除自己编排造成的锁。

**§3.2 观察点**

1. T0 编排形状：`steps 4 / transitions 4`，成立。
2. 设计轮读到材料：成立，8 次 `read`（`harness/tools.jsonl` 只记 `office`，工具收据以 `session.jsonl` 为准）。
3. 首个任务段之后的变更：成立（见 K1）。**修订**：这次运行的第一次渲染被推迟到 rev 3 之后（`office.render` 在 build 步被拒两次），所以"渲染在后"不构成 K2 的自证，K2 仍以 hash 为准。
4. 窗口：`window_created` 1 个（T0 的 `expected_effect` 开了 `window:0`），`decide_validation` **0** 次，运行结束时随 `taskEnd` 收尾，记为未闭合。
5. K2/K3：不成立。
6. subagent：0 写、0 调（`runtime_activations` 的 `addresses` 只有 `orchestration`）。有 call point 未接，记录，不删。
7. 质量地板：literal **28/30**、citation **10/10**、15 slides、10/10 单元——**持平 M3c，未提升**。三个未命中都在 unit-01/08/10 的 normalized 匹配上（`$3.0`、`$624`、`$1,621`、`$10.3`、`$10.2`）。
8. 成本对 M3c：requests 41→38、tokens 12.57M→1.59M、墙钟 961→1150 s。token 大幅下降主要来自编排把行为收窄，不是来自自进化。

**§3.3 负例对照**：`F3`（移动了但交付件没变）正是本次结果——"变更未进交付件"，按 §3.3 属于**结果**，不是 bug。`F4` 也命中（窗口开了没人关）。

**三个真实缺陷**

1. **receipt 递归嵌套（已修）**：`selfChangeDigest().last_self_change.transition` 内嵌整份 receipt，receipt 的 facts 又内嵌上一版 digest，每修一版多一层。后果：一次渲染的工具结果膨胀到约 160k tokens，`.harness/live-self.json` 3 MB，整次运行 55 MB。修法：`transition` 只留 `{status, step}`（`demo/self_root.ts`，测试 `tests/self_root_meta.test.ts` 断言其键集）。
2. **provider `terminated` 一次（未修）**：`session.jsonl` 第 31 行的助手消息 `stopReason:"error"`、`errorMessage:"terminated"`、usage 0；宿主丢弃该轮、记为 context_edit、重新提示，运行继续。与 M4a 的致命 `provider_error` 同类；本次非致命。按"不重复昂贵运行"的既有结论，先记录，等出现可复现的第二次再动。
3. **自视图里没有交付物（已修其一）**：`OPTIMIZABLE OBJECTS` 只列 prompt / context / loop / harness，边界板面只说"上一个段多少请求"，从不说交付物动没动。于是 agent 每次看自己都只能看见"我被自己的编排卡住了"，看不见"这份 PPT 自上次修改后一个字节没变"。修法（单因素）：`SEGMENT BOUNDARY` 增加一行事实 `Deliverable: artifact at v<n> (hash <12位>); <k> artifact write(s) since the last change.`，只读 `snapshot().latestArtifactVersion/latestArtifactHash` 与 ledger，不新增状态、不新增义务、不新增工具。

### 6.3 M5（`runs/evo-m5-glm53f-meta-20261116`）：一个因素改完，自进化反而一次没发生

按 §6.3 预注册只改了一个因素：`SEGMENT BOUNDARY` 多一行交付物事实。工程提交 `6700bd94`。同 freeze 源、同 provider（az）、同模型（glm-5.3-flash）、同臂 B，声明上限 64。

**结果**：`stop: "delivered"`，10/10 单元，**21 requests**（1 预检 + 20），**826,795 tokens**，488 s，registered estimate **$0.109**，`self_revision` **2**，`empty_turns` 2。质量**好于** M4b：literal **30/30**（M4b 28/30）、citation 10/10、15 slides、0 renderer warnings。

**过程**：2 次 `read` → **1 次** `reflect_orchestration`（第一次就通过）→ 4 次 `read` → 1 次 `write` → 1 次 render（v1，`d83e3d12…`）→ 10 次 `submit_unit` → 1 次 `office.deliver`。**refusal 0 次，T0 之后自修改 0 次。**

**它写出的编排**：只有一个 step `work`；两条 transition：`continue`（submit_unit → work）、`deliver`（office.deliver，requires office.render → **work**）。**没有任何通向 `complete` 的边。**

**K 判据**：K1 **不成立**（T0 之后零变更）、K2 **不成立**、K3 **不成立**。

**两个必须记下的事实**

1. **交付物那一行确实到了模型面前，但没有落差可看**：`provider-requests.jsonl` 里 12 次边界推送都带着 `Deliverable: artifact at v1 (hash d83e3d12e211); 1 artifact write(s) since the last change.`。agent 一次没改，所以这一行从第一版到结束一个字没变。它不是在无视证据，而是证据显示"没有缺口"——首版就满足它自己写的 TASK ACCEPTANCE（15 页、10 单元、字面数字、引用）。
2. **交付的出口仍然不是 agent 给的那个**：`deliver` 的 `requires` 要求当前 step 实例里有 `office.render` 收据，而 `work` 在 11 次 `submit_unit` 中反复重入、每次都是新的 step 生成，渲染收据已经不属于当前实例 → `status: "stalled"`。`harness/lifecycle.jsonl` 记了 `delivery_transition_stalled`，随后 `delivered / continues: false / transition: "stalled"`；宿主按 `state.complete = true` 收尾（`demo/ppt_demo_extension.ts:521-525`），agent 看到停滞收据，但那一轮结束就是运行结束，它没有下一次请求可以修。

**归因**：一个因素改完了，结果不是"改进了但没起效"，而是**这次运行根本不需要自进化**——没有拒绝、首版达标。两次运行把机制的激活条件夹出来了：

| 运行 | 有没有拒绝 | 自修改次数 | 质量 |
|---|---|---|---|
| M4b | 4 类工具被自己的编排拒绝 | 4（全是放宽 step 的 actions） | literal 28/30 |
| M5 | 0 | 0 | literal 30/30 |

**本质结论（两次运行共同指向）**：这个 meta loop 目前的驱动信号只有**拒绝**。板面给的是事实，事实没有缺口时 agent 正确地什么都不改；一旦没有拒绝，自进化就完全不发生。同时两次运行都不是由 agent 的编排结束的——M4b 的 deliver 落在 build 步（build 没有出口），M5 的 deliver 回到 work（没有 `complete`）。也就是说"运行何时结束"这个对象，agent 写了，但从来没被真正行使过。

**§3.4 的下一个单因素**（本稿不预先承诺，先报给用户定）：候选 A——交付停滞不直接收尾，把停滞收据留给 agent 的下一次请求去修它自己的编排（`ppt_demo_extension.ts:519-525`），这只把宿主的一次终止判决换回"服务给事实、agent 决定"，也让被两次运行都绕开的"终点由 agent 写"真正进入链路；候选 B——承认 PPT 任务没有落差，改任务结构（第二个消费者/绑定成本）而不是再改 harness；候选 C——以此停手，把"修复型自进化"当作结论记录。

### 6.4 M5 预注册（已执行，见 §6.3）

- 变的是**一个**：边界板面多一行交付物事实。其余全部不变——同 freeze 源、同 provider（az）、同模型（glm-5.3-flash）、同臂 B、同判据。
- 声明上限：**64 requests**（与 M4b 同口径，便于直接比）。
- 预期：K1 仍成立；**K2/K3 成立**当且仅当 agent 在某一版自修改之后重新写出交付物并重渲，且最终交付指向那一版。
- 如果边界看到了交付物事实仍不重渲：按 §3.4 这是下一次归因的输入，但**下一个单因素不在本稿预先承诺**——要先看它在那 15 次边界上到底说了什么、做了什么，再决定是"质量信号不足"（往板面加评分会引入解释，须先问用户）还是"agent 没有把交付物当成对象"（那就动 `OPTIMIZABLE OBJECTS` 那一行的措辞）。
- 证据边界不变：结论只对 az / glm-5.3-flash / 这一个任务成立。

### 6.5 批1 + M6（`runs/evo-m6-glm53f-meta-20261116`）：第一次非权限自修复，运行第一次由 agent 的编排收尾

批1 是对 §6.3 归因的成组回应（候选 A 即其中的 O9），工程提交 `88685953`，九项一次落地：O1 把 step 的 `actions` 白名单改为"可省略的权限范围"（拆 M4b/M5 的假吸引子）、O4+O8 每个边界把 `renderObservation` 全文（含 A4 inventory/recurrence）推进上下文、O5 计数 `assistant_reasoning` 并把重复思考头变成可寻址的 `[thought]` 行、O6 给 meta 运行种一个 agent 可编辑的 `evolution_policy` prompt 组件（转化/循环/上下文/评审四组规则）、O7 四条 OPTIMIZABLE OBJECTS 行带上实时信号计数、O9（仅 meta）运行只在 `to: "complete"` 的 transition 上结束，停滞交付不再由宿主收尾。

**预注册命题**：感知到位+规则在场+假吸引子拆除 ⇒ 出现 ≥1 次非权限类转化（引用某条推送事实）且 ≥1 次自发 review 行为（声明 expected_effect 或回应 verdict）。负例预登记：若事实被引用但仍 0 转化 → 瓶颈是回报而非感知 → 进批 2（O2/O3 协议义务）或改任务结构。

**结果**：`stop: "delivered"`，10/10 单元，**25 requests**（另 1 次 freeze 预检 ping，历史口径未计入系列数），855,801 tokens，777 s，registered estimate **$0.119**，`self_revision` **3**，`empty_turns` 5。

**过程**：T0 一次通过（revision 2，自带 `look_when`"边界核对 render 收据与 15 页简报、引用页，再交下一单元"与 `expected_effect`）→ 按自己的 look_when 在接触表上抓出 slide 5 版式坏 → `edit` 修 markup → 重渲 v2 → 10×`submit_unit` 全结算 → agent 原话 **"All 10 units are settled. I'll patch the orchestration so the delivery transition completes the run, then deliver formally."** → `reflect_orchestration` 以 `orchestration_patch` 加 `finish`（work→complete，on `office.deliver`，requires 同型收据；revision 3，`expected_effect`"Delivery receipt now routes the run to the complete step"）→ `office.deliver` → transition **advanced** → `complete`。M4b/M5 都由宿主收尾；**M6 是三次 meta 运行里第一次由 agent 写的边把运行走到终点**。

**命题判定：成立**。(1) 非权限类转化 ✓——revision 3 是循环结构修复，不是权限变更；全程 **0 次 actions 白名单自改**（M4b 为 6/6）。"引用推送事实"的形态是**应用而非转写**：patch 理由句直接对应系统行 "the run completes only at a transition whose to is \"complete\""（24/24 请求在场），没有逐字引用某条 OBSERVED 行。(2) 自发 review ✓——两次 reflect 均自带 `expected_effect`（O2 协议义务在批 2、未实现，故属自发），验证窗口随激活开启。负例未触发，批 2 暂不进。

**机制使用账**（挂钩判据：进入循环、被行动兑现）：

| 机制 | 在场 | 被行动兑现 |
|---|---|---|
| O9 终点规则行 | 24/24 请求 | ✓ patch+deliver 走 complete 主分支；**stall 分支 0 次触发，仍未在真实运行验证** |
| O4/O8 边界观察推送 | 15 次（provider-requests 逐条核实） | 间接（无逐字引用；repair 时机在全部结算后的第一个边界） |
| O1 白名单拆除 | 门禁文案+设计句 | ✓ 以负空间呈现：0 次权限自改 |
| O6 政策种子 | 24/24 常驻（8199 chars/request 的 prompt 之一） | ✗ 未编辑；转化规则零触发（25 请求内无 ≥3x 重复达标） |
| O5 思考头 | 观察渲染含 reasoning 计数 | ✗ 空转：`reasoning_chars` 全程 0（thinking low 下该模型无 reasoning 块），`[thought]` 行 0 次 |
| read_self | 可调用 | ✗ 0 次（连续第三次运行） |

**K 判据**：K1 **成立**（T0 后 1 次结构自变更，非权限类）；K2/K3 按 §6.4 的字面定义（自修改之后重新写出交付物并重渲、最终交付指向那一版）**不成立**——revision 3 是循环级而非制品级修改，v002 在它之前已定稿，之后没有重写或重渲。单独记两件确实发生的事：expected_effect 两次自发声明、验证窗口随激活开启（但 revision 3 激活即交付即终局，verdict 没有下一请求可回看）；终点第一次由 agent 的 `finish` 边行使（§3.4 候选 A 的目标，不等于 K3）。

**质量**：literal **30/30**，15 slides，0 renderer warnings，citation **8/10**——unit-05/06（Global Banking / Global Markets）无 "Source page 5/6" 主源行，页上只有 endnote（page 10）次级引用；比 M5（10/10）退、比 M4b（28/30 literal）进。交付物两版（v001 初渲、v002 修复后交付）。

| 运行 | requests | $ | 自修改 | 其中权限类 | 终点 | literal | citation |
|---|---|---|---|---|---|---|---|
| M4b | 38 | 0.257 | 6 | 6 | 宿主收尾 | 28/30 | — |
| M5 | 21 | 0.109 | 0 | 0 | 宿主收尾（stalled） | 30/30 | 10/10 |
| M6 | 25 | 0.119 | 2（T0+repair） | **0** | **agent 的 `finish` 边** | 30/30 | 8/10 |

**残差**（下一步的输入，不在本记录内承诺）：(1) citation 8/10 的质量缺口，agent 自己的 look_when 写了"核对引用页"却没抓到；(2) O9 stall 分支无真实运行证据（agent 先修后交，这是好事，但分支保持 unverified）；(3) O5 对 thinking low + 无 reasoning 块的模型空转，感知覆盖的"~97% 语言输出"在该配置下为 0；(4) 政策种子的转化规则在 25 请求的短运行里没有达标重复可转化——回报侧（批 2 / 任务结构）仍是开问题；(5) `empty_turns` 5。

**预算**：本次 25，系列 229+25=**254**，余 **346**（600 cap）。证据边界：az / glm-5.3-flash / 本任务。

### 6.6 M7 预注册（单因素：outcome 假值叶清点行）

**真实失败锚**：M6 citation 8/10（§6.5 残差 1）。事实链已核实：每次结算的 `task_outcome` 值里 `normalized.citation_found: false`（unit-05/06）**被完整记录**（`.harness/live-self.json`），但从未抵达模型——A3 `[outcome]` 回显 `compactJson(value, 200)` 按插入序走，checker/source_hashes 元数据（~230 chars）把 200 字符吃光（provider-requests 逐条核实：所有 `[outcome ledger:*]` 行断在 source_hashes 内；载荷里 grep "citation" 只命中 agent 自己的 T0 文案）；拉取侧 `read_self` 连续第三次 0 调用（"push, not pull" 的又一实例）。感知断点，非回报断点——本轮证伪这一点。

**单因素**（工程提交 `67bc34df`）：`booleanLeaves`——对每条 `task_outcome` 的记录值做**布尔叶机械清点**：false 叶按数字归一化路径分组计数，每组带最外层数组下标示例（≤3），按次数降序 ≤6 组；渲染为 `[outcome]` 下一行 `false N/M: path xN at [i,j]`；`observationHeads` 摘要尾带 `(N false)`。200 回显本身不动。task-neutral 保持：按"记录值为 false"选择叶，不按键名含义；排序失败的根因是 units 数组压缩后本身 >2000 chars，任何回显扩容都装不下，清点是唯一机械出路。M6 载荷上该行形如 `false 14/68: units[#].citation_literal.found x10 at [0,1,2]; units[#].normalized.citation_found x2 at [4,5]`。其余一切不变：az / glm-5.3-flash / arm B（EVO_A4+EVO_META）/ 同冻结流程 / 同判据。

**预注册命题**：若运行中出现记录为 false 的判定叶，边界推送板把它（分组+下标）送到模型面前，agent 在交付前对该事实采取修复动作；主判据：**交付时 `normalized.citation_found` 对应组 false 计数为 0（citation 10/10）**，且若中途该组出现过 false，修复动作可在轨迹中定位。

**负例预登记**：(a) 全程无 false 叶（首版全对且 checker 不产生字面歧义）→ 因素在场未行使，记 unexercised，不计成败；(b) false 叶被推送（provider-requests 可核实）而 agent 到交付无动作 → 感知闭合、回报不足，下一因素是批 2（O2/O3 协议义务）或任务结构；(c) 字面/规范双轨分歧（M6 的 unit-01：`citation_literal.found` false 而 `normalized.citation_found` true，后者为准）→ 板只报两条事实，agent 的语义处置是观察点，不算因素失败。

**上限**：M7 声明 **40 requests**（M6 25 + 修复余量）；系列 254/600，启动前余 346，启动后计相应消耗。

**M7 运行记录**（`runs/evo-m7-glm53f-meta-20261117`，2026-11-17，az / glm-5.3-flash，arm B，工程提交 `b3771a02`，运行记录的 engineering_commit 同）：`stop: "delivered"`，10/10 单元，**25 requests**（另 1 次预检 ping 历史口径不计），1,030,326 tokens，777 s，registered estimate **$0.163**，`self_revision` 3，`empty_turns` 2（M6 为 5）。质量：**citation 10/10**（M6 8/10）、**literal 25/30**（M6 30/30；unit-03/04/05/06/09 各缺中间一个前期值）、15 slides、0 renderer warnings、仅 v001 一版交付。

**因素在场**（provider-requests 逐条核实）：false 清点行出现在 15 个边界推送里——request 10 整桌行 `false 17/82: units[#].normalized.matches[#].found x12 at [0,2,3]; units[#].literal_matches[#].found x5 at [2,3,4]`，此后每条结算行自带残余 false 组。

**命题判定：不成立——预登记负例 (b) 触发**。(1) 主判据字面成立（交付 citation 10/10），但 `citation_found` 全程 0 次 false（live-self 无一处记录），归因无效——M5 无此因素同为 10/10；对该组属负例 (a)（在场未行使）。(2) 推送→修复链 **0 次行使**：首渲（request 10）后的调用轨迹只有 `submit_unit` x1→x10 → `office.deliver`（全程 write 1 次、office.render 1 次、look 0、read_self 0、无第二版）；request 10 推送的 5 个 literal false（x5 at [2,3,4]）与 final_unit_probes 的 5 个 false 是同一组，原样保留到交付；agent 的话语里无一处提及这些 miss（grep missing/absent 只命中 O6 种子文本）。(3) 结论：**感知断点已闭合（功能正确 + 全链路可达都成立），瓶颈移到回报侧**——false 事实不进入 agent 的停机条件，"渲染无 warning 即交付"与 Codex PPT 期 "first warning-free render" 模式同形。下一因素（仅记录，未授权）：批 2 协议义务（O2 expected_effect / O3 look_when 边界决定）或任务结构（给质量信号一个消费者/成本），不预设宿主交付门（用户已否决预置工作流）。

**次级观察**：(1) T0（request 2）设计即含 `to_deliver → to: "complete"` 边，连续第二次由 agent 的边收尾——M6 靠 request 23 的补丁，M7 在设计时就应用了 24/24 在场的 O9 规则行。(2) 唯一结构自变更（revision 3，request 13）回应的是推送的拒绝事实：agent 自己 T0 写的 verify 步 actions 清单挡了 `submit_unit`（拒绝 x2，拒绝文案自带 remedy 句），以 `reflect_orchestration` 放宽——M4b 的"解自己的锁"缩到 1 次，且锁是 agent 自写的（O1 已使清单可省略）。(3) `superseding_observation` 作为常假簿记叶在每条结算行清点中占一席（1/11），数据侧噪音，量级可容忍。

| 运行 | requests | $ | 自修改 | 终点 | literal | citation |
|---|---|---|---|---|---|---|
| M5 | 21 | 0.109 | 0 | 宿主收尾（stalled） | 30/30 | 10/10 |
| M6 | 25 | 0.119 | 2（T0+repair） | agent `finish` 边 | 30/30 | 8/10 |
| M7 | 25 | 0.163 | 2（T0+widen） | agent `to_deliver` 边（T0 即有） | 25/30 | 10/10 |

**预算**：本次 25，系列 254+25=**279**，余 **321**（600 cap）。

### 6.7 M8 设计与预注册（单因素：两集任务族，同一 serial 根连续承载）

**真实失败锚**（M7，`runs/evo-m7-glm53f-meta-20261117`）：感知闭合、回报缺位——15 个边界推送 false 清点行，首渲后 0 修复动作；能力组件在 M4b/M5/M6/M7 四轮里种子外创建数为 0。单集任务下组件投资没有第二次行使机会：一次性任务里"直接做"永远比"先造工具"便宜，agent 的不建设是对任务结构的理性反应（2026-11-04 "no felt gradient" 判断在 M 系列的重演）。用户 2026-11-17 指令：以机制引导 Prompt/Context/Loop/Harness 四层能力级自进化，不显式要求创建组件。

**单因素**：冻结任务从一集变两集（`bank-of-america-3q21` → `jpmorgan-chase-3q21`，同为 PresentBench 15 页财报讲解任务），同一 serial 根、同一 live self、共享预算连续承载。编排 `to:"complete"` 的语义由"运行结束"变为"关闭当前集；最后一集关闭即运行结束"。切换时宿主只做三件机械事：归档本集交付（`cases/<id>/delivery`）、换入下一集冻结数据（`workspace/data`）、重开根（orchestration complete 置回 false，步位、历史、组件、账本全部不动）。观测头新增一行事实（`TASK EPISODES: k of N` 加该语义），T0 设计回合即可见。不新增工具、不预置评审、不提组件。

**为何是机制而非提示**：能力组件（tool/skill/subagent/memory）的回报只存在于重复行使中；两集是最小重复。四层各得其天然触发：Harness 层组件有了第二个消费者；Loop 层编排在切换处遇到结构性再入/改造需求（complete 后须自己决定同环再入、改设计还是重写）；Prompt/Memory 层 ep1 的沉淀在 ep2 有读者；Context 层同一会话跨集延续。梯度全部来自任务结构，无一条指令。

**预注册命题**（主判据，机械可判）：ep2 期间至少出现一次对 ep1 所建/所改非种子组件的行使记录（component_runs/lineage/ledger 任一处：调用、read_self_component、subagent 运行、memory 进入 head 后被引用）——跨集复用 ≥ 1。
**次级观察点**：(a) 切换后编排处置（同环再入 / 改设计 / 卡死）；(b) ep1 质量残差（false 清点行）在 ep2 是否引发检查动作；(c) 四层各自的自变更计数；(d) ep2 相对 ep1 的 requests/质量差。
**预先声明的负例**：(a) ep1 建了组件、ep2 不用 → 复用断点在呈现/绑定侧，下一因素移去那里；(b) ep2 零跨集引用、从零重做 → 连续性未转化为沉淀，本因素不足；(c) 切换后 agent 陷入拒绝循环（连续 6 次以上动作被拒）→ 机制断层，修复后重跑，该次不计命题。
**上限**：M8 声明 **60 requests**（M6/M7 各约 25，加切换适应余量）；系列 279/600，启动前余 321。

### 6.8 M8 运行记录：缺陷轮 M8a 与修正轮 M8b

**M8a**（`runs/evo-m8-glm53f-meta-20261117`，2026-11-17，az / glm-5.3-flash，arm B，工程提交 `c94aa297`）：`stop: "provider_error"`，**30 requests**（另 1 次预检 ping），1,267,384 tokens，1,174 s，registered estimate **$0.214**，`empty_turns` 8，`self_revision` 5。ep1（bank-of-america）交付 10/10：literal 30/30、citation 4/10，并**创建了系列第一个非种子能力组件**——skill `bac_segment_slide` v1（request 12，`expected_effect` 声明"后续 build 段复用同一版式方法"，验证窗口 `later_use_refs` 2）；另有三次编排反射（rev 2 设计、rev 4、rev 5）。ep2 未开始：episode 切换处三重缺陷（已由 `2aca6e44` 修复并附测试）：

1. **跨 receipt 的 requires 不匹配**：`advanceAction` 只用触发 receipt 匹配 requires，自然的"render+deliver"收尾边在 `office.deliver` 上 stall 四次（ledger:123、142），agent 自己把 requires 收窄成单一 receipt 才关闭 ep1。修复：requires 对照触发 receipt 加历史动作记录，freshness 照旧。
2. **切换把 Workspace 当路径**（`join(workspace,'data')`，ledger:167 `ERR_INVALID_ARG_TYPE`）：ep1 记为 closed 而数据换入与重开从未执行，编排保持 complete，其后所有工具被拒 "orchestration is complete"，直到 provider 返回空响应、运行崩溃（`Cannot read properties of undefined (reading 'length')`）。修复：用 `workspace.root`、先验证冻结源、只记一次 closure，失败则重开并记 `episode_switch_failed`，重试是 agent 的同一次交付。
3. **空工具结果**：无内容的 read_self 段落返回空 content block，最终请求死于此。修复：返回一句事实说明。

**M8b**（`runs/evo-m8b-glm53f-meta-20261117`，2026-11-17，az / glm-5.3-flash，arm B，工程提交 `2aca6e44`）：`stop: "delivered"`，**38 agent requests**（另 1 次预检 ping；resources 记 39），5,577,900 tokens，2,074 s，registered estimate **$0.883**，`empty_turns` 7，`self_revision` 3。两集均交付、各 15 页、5 次渲染全为 `chrome.exe headless HTML`：

- ep1（bank-of-america）：request 17 / 02:02:16Z 交付 rev 3（`action-14`，`self_review` 后触发 `complete_on_deliver`）；literal **30/30**、citation **10/10**。
- 切换干净：同一时间戳 `task_episode_switched`（closed ep1 → active ep2，episode 2）与 `delivered continues:true`，无 stall、无拒绝循环，agent 在同一步 `work` 内继续。
- ep2（jpmorgan-chase）：request 38 / 02:27:25Z 交付 rev 5（`action-28`，`continues:false`）；literal **30/30**、citation **0/10**。

**自变更**（`harness/live_agent_self.jsonl` 全行核实）：ep1、ep2 的每一行组件列表都只有两个种子 prompt（`evolution_policy`、`ppt_baseline_guidance`），**两集非种子组件创建数 = 0**；非编排激活 0 次；仅两次编排反射——rev 2（request 2，T0 设计即含 `complete_on_deliver.requires=[office.deliver]`）与 rev 3（request 22，compiled 值与 rev 2 相同）。4 个请求（21/26/28/36）`unknown_reserved`、stopReason "error"、无 usage，成本为保守估计。

**命题判定：不成立——预登记负例 (b) 触发**。ep2 零跨集引用，因为 ep1 没有留下可引用的非种子组件，"连续性未转化为沉淀"。更严格的读法：整个 M 系列只有 M8a 一轮在双集视界下真正发生了能力组件投资（skill），而它死在切换缺陷、没走到第二集；M8b（修复后同设计）两集零投资。**跨集复用命题至今没有一次端到端行使**——一是从未有 run 同时具备"ep1 建组件 + ep2 可用"。

**次级观察**：(a) 切换处置合格：重开、同环再入、无卡死，修复后的切换边首次实跑通过。(b) 质量跨集不守恒：ep1 citation 10/10 → ep2 0/10，而 literal 两集都是 30/30——ep2 的 10 个单元全部缺引用；ep1 学到的东西（如果算学到）没有被任何机制带到 ep2，也没人要求它带。(c) 四层自变更计数：Prompt 0、Context 0（无 memory 写入）、Loop 2（两次编排反射，第二次无实质差异）、Harness 0（M8a 为 1）；ep2 期间 0 次。(d) 成本：ep2 用了 21 个请求 vs ep1 的 17，质量反而下降。另记一条读法：M8a 的顶层 `final_unit_probes` 用 ep2 单元定义探测 ep1 交付物（崩溃后遗留），读数不代表任何一集，按 `episode_unit_probes` 读。

| 运行 | requests | $ | 非种子组件 | 自修改 | 终点 | ep1 literal/citation | ep2 literal/citation |
|---|---|---|---|---|---|---|---|
| M8a | 30 | 0.214 | 1（skill，未跨集行使） | 4（1 skill + 3 编排） | provider 崩溃 | 30/30, 4/10 | 未开始 |
| M8b | 38 | 0.883 | 0 | 2（编排） | 两集交付 | 30/30, 10/10 | 30/30, 0/10 |

**预算**：M8a 30 + M8b 38 = 68；系列 279+68=**347**，余 **253**（600 cap）。

### 6.9 变更记录（2026-11-17）：删除 `evolution_policy` 种子，进化判断移入外部演化 pass

按 `docs/templates/meta-harness-change.md` 的节次。

**问题与命题**

- 真实失败/机会：M4b–M8b 五轮里，预置的 `evolution_policy` prompt（批1 O6，`88685953`）没有带来任何非种子能力组件（除 M8a 一次 skill，且与种子无因果证据）；它是一份常驻义务文本，与 META_STRATEGY 的职责重叠，且其"何时看自己"的时机判断交给了入模文本而非运行事实。用户 2026-11-17 指令：删除该种子，改为外部演化 pass（Continual Harness `HarnessEvolver` 模式），并明确**不需要运行时装配**——反射接口热修改，下一请求边界即生效。
- 窄命题：当运行记录出现机械边界（一集关闭 / 交付转移 stall / 连续 12 个 execute 请求无 artifact 写入）时，宿主在任务回合之外开一个**有界**的演化 pass；agent 在 pass 中读运行视图、可经 `reflect_component`/`reflect_orchestration` 写入，写入在下一请求边界生效；一次真跑中至少产生一个能力组件变更，且该变更在其后的任务段被行使。
- 减少的负担：删除一段常驻提示与"总是要想着进化"的常驻义务；时机从入模规则改为运行事实；无需新的装配步骤（反射激活已有）。
- 适用条件、合理不使用条件与推翻条件：适用于 META 臂；非 META 臂 `metaPassDue()` 恒 null（无 pass、无成本）；合理不使用 = pass 打开后以 `decide_exit` 关闭且不改任何东西（记为有效判断）；推翻 = pass 从未打开（边界事实缺失/去重错误）、或 pass 吃满上限（机制占有运行）、或创建后无任何后续行使（绑定侧断点）。
- 范围及非目标：不改非 META 臂；不新增工具（`read_self`/`read_self_component`/`reflect_*`/`decide_exit` 在各步已可用）；不预置评审入口说明、不要求组件数量；不改预算、权限、版本、环境边界。

**设计与成本**

- 选择与取舍：复用既有 review 机制（`enter()` 置 reflect、`reviewSelfView()`/`reviewView()` 供视图、`decide_exit` 关闭），不造新 worker、不造装配器；触发只认**已记录事实**（`task_episode_closed`、`action_transition_stalled`、execute `request_record` 计数），无时钟、无宿主语义判断。相比 Continual Harness 的四 pass 整库重写（2026-09-11 已否），保持"一 pass 一窗口、judged no-change 合法"的 refiner 先例。
- 生命周期：边界事实 → `meta_pass_due` 事件（`pass:<request>` 去重）→ 入队 → `enter()`（任务步挂起）→ pass 请求携带 `META_PASS_STRATEGY` 与窗口事实（`evolution_pass`）→ 写入在下一边界 `activatePending` 生效 → `decide_exit` 恢复任务步。失败/超时：cap 8 个请求时 `boundary()` 记 `meta_pass_capped` 并 `closeMechanically`（`outcome: review_unresolved`，机械闭合，绝不是 agent 判断）。
- 首次获益路径：任务边界事实直接到达 agent 的 pass 请求，中间无父决策步；agent 的唯一判断是"改或不改"。
- 新增与移除：移除种子文件 `demo/prompts/evolution_policy_seed.md` 与其注入；新增仅：`META_PASS_STRATEGY`（只在 pass 内出现）、`META_PASS_REQUEST_CAP=8`、`metaPassDue()`、事实 `meta_pass_due/meta_pass_opened/meta_pass_capped`、pass 视图的 `evolution_pass` 字段、`metaPassTrigger` 的持久化。无新 schema 字段、无门禁、无管理轮。
- 权限/版本/环境边界：反射仍走同一授权与证据校验；budget/version/permission 检查不动；非 META 臂行为逐字节不变。
- 放弃与恢复：pass 连续多轮无改 == 机制对任务结构无感 → 下一因素移向回报侧；机制本身可整段移除（回退即恢复种子注入，历史不可回退）。

**运行前实验协议**

- 目标证据层级：自主采用 + 净收益（真 provider 运行）。
- 主要变量与比较器：唯一差异 = 种子删除 + 外部 pass；比较器 = M8b（同任务族、同 arm、同 provider/model、种子在场）与 M7（单集）。
- 模型/provider/任务：az / glm-5.3-flash；arm B（EVO_A4+EVO_META）；同一冻结双集任务族；同冻结流程。
- 总预算与停止规则：见 §6.10 声明；超过即停，pass 内请求计入同一预算。
- 主要指标与判定标准：主判据 = ≥1 个非种子能力组件在某次 pass 内创建/修改，且其后任务段有行使记录（component_runs / lineage / read_self_component / memory 进入 head 后被引用 / 工具被调用）；保底判据 = 两集均交付且每集 literal ≥ 25/30（M8b 为 30/30）。
- 负例：(a) pass 从未打开 → 触发/去重缺陷；(b) pass 打开、judged no-change 关闭 → 有效负例，边界机制不是缺失因素，下一因素回报侧；(c) 达到 cap → 机制占有运行，缺陷；(d) 创建但无后续行使 → 绑定侧断点。
- 遥测及材料：ledger 的 `meta_pass_*` 行、`live_agent_self.jsonl`（组件列表逐行）、`episode_unit_probes`、provider-requests。

**实现与验证**

- 改动入口：`demo/self_root.ts`（`metaPassDue`、`META_PASS_STRATEGY`、`META_PASS_REQUEST_CAP`、boundary cap+入队、`reviewSelfView.evolution_pass`、export/restore/close）；`demo/ppt_demo_extension.ts`（删除种子读取与注入；META 核心行改写为"任务回合内无评审入口，边界处宿主开演化 pass"）；`demo/prompts/evolution_policy_seed.md` 删除。
- 功能/相关回归检查（fee-free）：`tests/self_root_meta_pass.test.ts` 5/5（episode 关闭开 pass、stall、12 请求 stagnation、5 不触发、cap 机械关闭、pass 内写入激活并计数、非 META 不开）；self-root + orchestration node 套件 **82/82**（其中 `tests/ppt_demo_live_orchestration.test.ts` 的两处陈旧断言按现surface修正：`"object"` 字段、`live_agent_self.jsonl` 的 `self_view_injected`）；`python -m pytest tests/test_evo_ppt.py` **18/18**。`tests/test_evo_ppt_pi.py` / `test_evo_ppt_stall_recovery.py` 的 6 个失败在 HEAD 原样复现（本 checkout 缺本地 Pi 包 `@earendil-works/pi-coding-agent`，脚本内核提前退出），与本次改动无关，标为环境未验证。
- 机会漏斗与断点：本轮只有离线证据——pass 的打开、策略、事实、写入、闭合全部由离线测试覆盖；真实运行中的打开率/使用率未测。

| 证据层级 | 状态 | Provider / environment | 产物及结论边界 |
| --- | --- | --- | --- |
| 功能正确 | 已验证（离线） | node 测试、pytest 18/18、HEAD 对照 | `tests/self_root_meta_pass.test.ts` 等；不证明真跑 |
| 全链路可达 | 未验证 | 待声明运行 | 需要真 provider 运行 |
| 自主采用 | 未验证 | 待声明运行 | 需要真 provider 运行 |
| 净收益 | 未验证 | 待声明运行 | 需要真 provider 运行 |

**交付决定**

- 已支持和未支持的声明：支持"种子已删除、外部 pass 功能上存在且写入热生效"（离线）；不支持"该机制促成能力级自进化"（未测）。
- 决定与依据：保留，进入下一轮声明运行；不预置任何"要建几个组件"的指令。
- 剩余验证与下一可证伪检查：见 §6.10 的预注册。
- 关联 backlog：无新增。

### 6.10 M9 预注册（单因素：无种子 + 外部演化 pass）

**真实失败锚**：M8b 两集零非种子组件（§6.8）；M8a 唯一一次组件投资死在切换缺陷。旧机制的共性是"进化指导是常驻文本、时机由 agent 自己想起来"——M4b–M8b 五轮从未在任务中途主动打开评审；用户 2026-11-17 指令改为外部 pass。

**单因素**（工程提交见运行记录）：删除 `evolution_policy` 种子；META 臂在记录的运行边界处由宿主开一个有界演化 pass（§6.9）。其余一切不变：az / glm-5.3-flash / arm B / 同一冻结双集任务族 / 同判据。

**主命题**（机械可判）：ep1 关闭（或 stall/stagnation）后，宿主的 pass 打开，**agent 在 pass 内创建或修改 ≥1 个非种子能力组件，且该组件在其后的任务段有行使记录**（component_runs / lineage / read_self_component / memory 进 head 后引用 / 工具被调用）。
**保底判据**：两集均交付，每集 literal ≥ 25/30（M8b 为 30/30、30/30）。pass 的请求计入同一预算，pass 内请求不计入"任务请求"质量比较。

**负例预登记**：(a) pass 从未打开（ledger 无 `meta_pass_due`）→ 触发/去重缺陷，修复后重跑；(b) pass 打开、`decide_exit` judged no-change 关闭 → 有效负例，边界机制不是缺失因素，下一因素移到回报侧（任务结构/成本消费者）；(c) pass 达到 cap 8 → 机制占有运行，缺陷；(d) 创建后无后续行使 → 绑定侧断点。

**上限**：M9 声明 **75 requests**（M8b 38 + 至多 4 个 pass × 8 + 余量；单次超限即停）。系列 347/600，启动前余 **253**，启动后按实耗计。**时间上限 3600 s，2 GiB 存储**（沿用 M 系列授权）。model：az / glm-5.3-flash。

### 6.11 M9 中止记录（预检缺陷 S0）、pass 事实包与 M9b 预注册

**M9 两次启动均未进入任务**（`runs/evo-m9-glm53f-meta-20261117`，2026-11-17，az / glm-5.3-flash，工程提交 `dc049570`）：第一次 preflight ping 遇 az 断连（`az_inference_unavailable`，1 request、4,267 tokens 保守计）；第二次 ping 正常（1 request、18 tokens）后扩展拒绝加载，`stop: "runtime_or_provider_error"`、`error: "Pi RPC process exited before responding"`。根因（S0）：预检把已耗墙钟秒作浮点扣入时间预算（3600 − 4.0 = 3596.0），Python json 写出 `"3596.0"` 而扩展端 `JSON.stringify` 写 `"3596"`，声明合同哈希分歧，扩展按完整性检查拒载——完整性检查按设计工作，缺的是输入侧规范化。修复 `9e7abbc6`：`_canonicalize_budget` 在 <=0 检查、哈希重算与运行清单写出前把整值浮点规范为整数；`tests/test_evo_ppt.py` 19/19（新增单元与清单集成两测）。两次启动共 2 requests 计入系列：347 + 2 = **349/600**，余 **251**。

**pass 事实包**（用户 2026-11-17 决定 P1、P4–P7、S1/S3/S5/S6；工程提交 `7a8bb87b`；§6.9 的机制边界不变，以下是 pass 自带事实的补全）：

- P1：两份 meta prompt 中宿主给定的 SELF-EVOLUTION ACCEPTANCE 段删除；计数器保留为纯记录事实（SELF-CHANGE COUNTERS 看板行、`self_changes` inventory 键）。强制交卷不是进化证据。
- P4/S1：pass 以一个机械入口块打开（TASK/TRIGGER/WINDOW/ARTIFACT/SELF/CARRIED，每行命名其展开 ref），入场时计算一次、记 `meta_pass_entry` 事实、渲染进 pass 视图；≤1400 字符；只有事实，无排序/建议语言（测试断言）。
- P6：pass 内 `decide_exit` 接受可选 `result.carry`；原样存入 `review_closed`，下一 pass 入口裁剪渲染（200 字符，一条 `carry_truncated` 事实）；pass 外的 exit 操作不变。
- P7：`read_self(section="evidence", ref="request:N"|"artifact:vK")` 经 adapter 展开一条已记录 ref（provider-requests 16k 分页、renders.jsonl 行）；缺失 ref 返回 `state:"missing"` 值、adapter 异常返回 `state:"error"` 值，绝不向 agent 抛错；adapter 声明的运行位置上 TASK 行。
- P5/S3：`deliveredImageRefs` 把应用后的上下文计划实际送达的图像部件（action include）记入 request_record；pass 窗口计数之，evidence 可展开其请求。
- 修正：reviewView 读 `facts.pass_window` 而 pass 记的是 `facts.window`，加回退使 pass 窗口行进入评审视图。

免费检查（本 checkout）：meta 套件 27/27（`self_root_meta` / `self_root_meta_pass` / `self_root_meta_entry` / `pi_context_adapter_images`）；回归 61 测试 11 失败全部在干净 HEAD `dc049570` 原样复现（冻结 reflective/free-hands 臂既有，与本改动无关）。provider 行为未验证，由 M9b 承担在线检查。

**M9b 预注册**（单因素不变：无种子 + 外部演化 pass；M9 声明顺延，叠加 S0 修复与 pass 事实包）：

- 主命题、保底判据、负例 (a)–(d)：同 §6.10。
- 增补读数（预登记，均机械可判）：连续两个 pass 以 cap 机械闭合且零写入 → 归入负例 (c)；pass 内连续 >6 次反射拒绝 → 写入通道缺陷（授权/证据校验侧）；pass 请求单独计数，总和 >24（3×cap）→ 成本主发现，无论主命题成立与否。
- 四层读数（Prompt/Context/Loop/Harness 自变更计数，沿 §6.8 (c) 口径）为分析项，不构成通过线。
- **上限**：M9b 声明 **75 requests / 3600 s / 2 GiB**（含预检 ping；单次超限即停）。系列 **349/600**，启动后至多 **424/600**。model：az / glm-5.3-flash；arm B；同一冻结双集任务族；root `runs/evo-m9b-glm53f-meta-20261117`。

### 6.12 M9b 中止记录（az 网关流终止）、trajectory 进入视图与 M9c 预注册

**M9b 未进入交付**（`runs/evo-m9b-glm53f-meta-20261117`，2026-11-17，az / glm-5.3-flash，arm B，工程提交 `e7b20900`）：`stop: "provider_error"`、`error: "terminated"`，1215.9 s，14 requests（含预检 ping 1 request / 18 tokens），两集 20 单元全部 not_delivered；保守计 1,225,615 tokens / $0.2758（终止流返回 usage 0，按满额保留计；`billing: "conservative estimate; actual invoice unknown"`）。根因在网关侧：每个长生成流在 ~60 s 处被切断（`stopReason:"error"`、`errorMessage:"terminated"`、usage 0），小输出（41/431/13/47/48 tok）全部存活；Pi 自动重试 6/6 失败（5→60 s 退避）后 `auto_retry_end success:false`，runner 按设计停机。独立探针复现：直连 az 同模型 4000-token 流式请求 61.6 s 零字节 `RemoteDisconnected`（`tmp/az_probe.out.json`；+1 request 计入系列）。机制侧死亡前有活信号：T0 设计回合（request 2）产生 `reflection_activated`（orchestration，revision 1→2）；pass 从未开（死于 ep1 中途，未达任何记录边界），不触发负例 (a)–(d)。用户指示：半小时后同 provider 重试；重试前先把 trajectory 放入视图。系列 349 + 14 + 1 = **364/600**。

**trajectory 进入视图**（用户 2026-11-17 决定；工程提交 `19dada3b`）：

- 现状：视图中的"trajectory"只有 A2 聚合（模式游程、调用计数、工件触达、去重 thought heads）——序列本身不在场，pass 决策点看不到窗口的事件顺序。
- 核心（`demo/self_root.ts`）：`passEntry` 在 WINDOW 与 ARTIFACT 之间加 TRAJECTORY 段——`adapterTrajectory` 选项给出逐事件行，按 `R<n>` 请求标签对 pass 窗口（request_record 的 min..max）机械过滤（未标注行保留，窗口无 request_record 时全保留）；段自带 6000 字符最新优先预算，省略计数行命名展开 ref（`read_self(section="evidence", ref="request:N")`）；单行 400 字符裁剪；无 adapter 为 "not provided"，adapter 异常成 "unavailable (…)" 值，绝不抛向 agent；入口块整体上限 1400 → 8000（仅随 pass 请求出场）。
- 扩展（`demo/ppt_demo_extension.ts`）：`message_end` 逐事件机械转写——assistant 文本/思考头（200 字符、空白折叠）、toolCall 名+参数头（`data:` URL 置 `(image)`）、toolResult ok/error+头、`stopReason === 'error'` 时一条 `provider_error` 行；R 标签与 provider-requests.jsonl 请求号对齐（重试各占号）；宿主只按长度裁剪，绝不按内容选择；全文仍在 `harness/provider-requests.jsonl`，视图行命名其展开。
- 价值与边界：pass 入口一眼可见窗口事件轮廓，pass 写入可按 `request:N` 引用证据；只进 pass 视图，不进常驻上下文（逐请求常驻为 O(n²) 成本，弃）；行在扩展进程内存中，进程重启不续（M9c 全新启动，不受影响）。
- 单因素注记：M9c 相对 M8b 的差异为"无种子 + 外部 pass + pass 视图完备性（事实包 + trajectory）"的单方向捆绑；trajectory 系用户指令新增，不单独拆臂。

免费检查：meta 套件 **27/27**（`self_root_meta_entry` 新增 trajectory 测试：窗口过滤、最新保留预算与省略标记、untagged 保留、booked 事实一致、adapter 异常成值）；`ppt_demo.test.ts` 仅既有 3 失败（冻结 reflective/free-hands 臂，干净 HEAD 原样复现）。provider 行为未验证，由 M9c 承担在线检查。

**M9c 预注册**（M9b 声明顺延，叠加 trajectory 视图；其余与 §6.10/§6.11 全同）：

- 主命题、保底判据、负例 (a)–(d)、增补读数、四层读数：同 §6.10/§6.11，逐字沿用。
- 启动门槛（探针优先）：唤醒后先以 1 次直连长流探针验证网关（计入系列）；探针再零字节断连则不启动、继续顺延，不烧运行预算。
- **上限**：M9c 声明 **59 requests / 3600 s / 2 GiB**（含预检 ping；单次超限即停）。系列 **364/600**，唤醒探针后 **365/600**，启动后至多 **424/600**（兑现 §6.11 "至多 424/600" 的声明）。model：az / glm-5.3-flash；arm B；同一冻结双集任务族；root `runs/evo-m9c-glm53f-meta-20261117`。

**M9c 预注册修订（用户 2026-11-17 第二决定：归纳与能力推断分轮；工程提交 `6d1e8934`，启动前修订、该名下零支出）**：

- 用户指令：pass 应分成两部分——第一部分归纳，第二部分能力推断，二者不得放在同一轮次。实现为同一 pass 场合内两个顺序 evolution review：轮 1（归纳，cap 3）以 agent 自己的 decide_exit 收束，其 `result.reason`/`result.carry` 原文进入轮 2 入口的 ROUND 1 段（render 时 400/1200 裁剪）；轮 2（能力，cap 5）在下一请求边界开启，策略携带三条入口问题（ENTRANCE_QUESTIONS 经 META 并入轮 2，无需 EVO_ASK 旗标；非 META 臂行为不变），退出 schema 要求 `entry_question_responses` 恰三条字符串；轮 2 收束后任务复位。场合总上限仍 8（[3,5] 之和）；跨场合 CARRIED 排除本场合轮 1 收束（避免双渲染）；轮 2 trajectory 预算 4000（给 ROUND 1 段让位，入口整体仍 ≤8000）。机械封顶同样推进轮次：轮 1 封顶即开轮 2，轮 2 封顶关场合；crash/预算/二次非法退出关整个场合。新事实：`meta_pass_opened.round/round_caps`、`meta_pass_round`、`meta_pass_capped.round`。
- 约束对齐：宿主只提供轮次结构与机械转写（原文、全量、统一裁剪），两轮的判断内容均归 agent；问题不点名组件类型或数量；不设运行时配额。
- 免费检查（2026-11-17）：meta 三套件 **28/28**（轮次贯穿、两段封顶、轮 2 schema、ROUND 1 段原文、CARRIED 排除、轮 2 预算）；self_root 其余套件 **49/49**。`ppt_demo.test.ts`+`ppt_trials.test.ts` 现测 **9/14 失败**，与干净 HEAD 基线逐项相同（`tmp/ppt_base.txt` vs `tmp/ppt_mine.txt`），系分支既有（free-hands/trials 层）；与本日早前"仅 3 失败"记录不符，疑时序/环境依赖，未深究，已证与本改动无关。
- 单因素注记更新：M9c vs M8b 捆绑现为"无种子 + 外部两轮 pass + pass 视图完备性（事实包 + trajectory）+ 轮 2 入口问题"；分轮与入口问题系用户指令新增，不单独拆臂。
- 增补读数（在 §6.10/§6.11 读数之上）：每轮 requests 与写入数、轮 1 reason/carry 条数与字节、轮 2 `entry_question_responses` 内容、`meta_pass_round`/`meta_pass_capped(round)` 事实序列；主命题、保底判据、负例 (a)–(d) 逐字沿用。
- 探针台账与上限修订：探针 2–4（13:55/14:41/15:14）均 ~60 s 零字节 `RemoteDisconnected`（`tmp/az_probe_20261117_*.out.json`），系列 **367/600**，探针 5 定 16:05。声明上限修订为 **56**（替代上行的 59；探针 2–4 已计入系列）：启动时 cap = 424 − 启动时系列数（探针 5 通过即启动则 368/600、cap 56，与 `runs/evo-m9c-glm53f-meta-20261117-caps.json` 现值一致）；每多一次失败探针 cap −1，启动时重写 caps.json 与 freeze 授权数字。



