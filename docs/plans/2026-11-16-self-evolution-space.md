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

