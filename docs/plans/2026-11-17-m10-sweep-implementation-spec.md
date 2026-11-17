# M10 固定连扫（sweep）实现规格 — 交 codex 实现

日期 2026-11-17。本文是唯一实现依据，自包含；设计来源与授权见
`docs/plans/2026-11-16-self-evolution-space.md` §6.13 及其两个修订块（"要固定连扫"；"无信封、pass 内直接热修"+瞬态渲染约束）。
实现目标分支：`evo-loop-implementation`（worktree `D:\agent\.codex\worktrees\evo-loop-impl\autoresearch_pi_project`），基线 HEAD `17a1b2a1`。
行号锚点按该 HEAD 给出，可能漂移；以符号名为准。

## 0. 边界（先读）

- **默认关**。全部新行为挂在 `mechanisms.sweep`（env `EVO_SWEEP=1`）之后；`EVO_SWEEP` 未设时，每条现有路径
  字节级不变（M9c 冻结臂仍然有效）。`sweep` 依赖 `meta`：`mech()` 中 `if (!m.meta) m.sweep = false`。
- **只跑免费检查**：node 测试、pytest、scripted provider。本次实现不做任何付费 provider 运行；M10 付费运行
  需要另行预登记与声明预算，不在本规格内。
- **宪法**：不显式告知 agent 要创建什么组件或至少创建多少才算完成；无运行时配额；七次 pass ≠ 七次变更，
  **全 no_change 合法**；宿主只开场合、渲染材料、机械记账，判断全部归 agent；宿主不按内容挑选证据
  （机械、全量、统一裁剪）。新增文本只许陈述机制、材料与关闭语义。
- 不改 `.env`；不动 `runs/`、`tmp/` 下的 M9c 冻结与探针资产；不动 ARC 路径与 `arc_action`。
- 提交信息末尾 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。

## 1. 单因素（M10 对 M9c）

M9c 的演化场合 = 轮 1（归纳，cap 3，decide_exit 关闭）+ 轮 2（能力，cap 5，入口三问 + decide_exit 关闭）。
M10 唯一改动：**轮 2 替换为固定七专家连扫** — 七个串行小回合
`[Prompt, Context, Skill, Tool, Subagent, Memory, Loop]`，每回合恰好 1 个 provider 请求、自闭合
（无 pass 内重试）；agent 通过现有 `reflect_component` / `reflect_orchestration` 直接热修 —
**工具调用即变更，纯文本即 no_change**，两者都是合法关闭。无信封：不引入 JSON 决策解析/校验/代落地。
轮 1 原样保留（含 cap 封顶推进）。场合请求总数 ≤ 3 + 7 = 10。

主命题：≥1 次 pass 内落地的自变更（有 receipt）被之后的普通任务请求消费。
预登记负例：(a) 7 个 pass 全程 0 工具调用；(b) 变更落地但下一请求不可见/未消费；
(c) 结构性工具拒绝占多数；(d) budget_skip 占多数。实现必须让这四项可从 ledger 机械读出（§5 的事实即可）。

## 2. 现状锚点（demo/self_root.ts，HEAD 17a1b2a1）

- `:539` `metaPassTrigger?: { reason; facts; window }`（round/prior 现以 as any 挂载）；`:585`/`:638` 持久化键表含 `metaPassTrigger`（对象扩展自动随存）。
- `:146-156` 常量：`META_STRATEGY`、`META_PASS_STRATEGY`、`META_PASS_ROUND_CAPS = [3,5]`、`META_PASS_REQUEST_CAP`、`META_PASS_ROUND1_LINE`、`META_PASS_ROUND2_LINE`；`:129-138` `ENTRANCE_QUESTIONS`/`entranceAskBlock`。
- `:601-617` `reviewExitSchema`（metaRound===2 强制 `entry_question_responses`；carry 字段）。
- `:685-704` `mech()` 与 `reviewStrategy(entrance)`（meta 分支按 round 选 ROUND1/ROUND2 行）。
- `:759-776` `metaPassDue()`（三触发：episode_boundary / delivery_stall / stagnation≥12）。
- `:790-853` `passEntry(book)`（入场一次性计算；trajBudget `round===2?4000:6000`；ROUND 1 prior 行；总 clip 8000）。
- `:859-890` `metaBoard()` 的 OPTIMIZABLE OBJECTS 四行（per-object signals 的现成计算，§6 复用）。
- `:1210-1225` `surface()`/`protocolSurface()`（meta 且无 review 时滤掉 decide_exit —— 连扫滤除遵同一模式）。
- `:1371-1413` `boundary()`：`:1373` activatePending（先于一切）；`:1378-1385` 按轮 cap 检查 + `meta_pass_capped`；`:1397-1406` 开场合（`meta_pass_due`/`meta_pass_opened`、queue review ticket）；`:1407` enter。
- `:1651-1684` `enter()`（reviewRequests=0；`:1665-1667` passEntry 存 `review.pass_entry` + `meta_pass_entry` 事实；review_frame）。
- `:1733-1734` `reviewSelfView()` 尾部 `evolution_pass: { ...facts, entry }`（连扫帧挂此处，§6）。
- `:1775-1801` `exit()`（`:1787-1791` exitRound===2 强制三答）。
- `:1804-1834` `close()`（`:1806` `unresolved = mechanical && !reviewChanged()`；`:1822-1832` 轮 1→2 推进 + `meta_pass_round` + queue）。
- `:1972-1977` `pin()`（request++/reviewRequests++）。

demo/ppt_demo_extension.ts：
- `:87` `EVO_MECH`（env → mechanisms；加 `sweep: process.env.EVO_SWEEP === '1'`）。
- `:819-825` review 时 `selfView = [JSON.stringify(evo.reviewSelfView()), JSON.stringify(await evo.projection())]`；`:826` selfTail；`:857` 每请求重建的 `custom self-view` 尾消息（**连扫帧的运载通道，自动随 reviewSelfView 变**）。
- `:827-833` `coreLine`（SELF ROOT 句，进 system 头；`:830-832` meta 分支）。
- `:846`/`:849` `reviewStrategy(true)` 前置进 system 头。
- `:769-776` `turn_end`（reflect 失败 → abortTransaction + `tool_failed` 事实 —— §5 拒绝计数的来源）。

测试基建：`tests/self_root_meta_pass.test.ts`（直接 SelfRoot 夹具风格，连扫状态机测试照此写）；
`tests/ppt_trials.test.ts` 的 `scripted(replies)`；`tests/test_evo_ppt_pi.py`（pytest 全链 scripted 运行）。

## 3. 状态机

### 3.1 触发器扩展

`metaPassTrigger` 增加可选字段（并把声明类型补全，别再全靠 as any）：
`round?: 1|2`、`prior?: { closed; outcome; reason; carry }`（已有）、
`phase?: 'sweep'`、`sweep?: { index: number; seen: number; ledger: number }`
（index=当前 pass 下标 0..6；seen=上次推进时的 reviewRequests；ledger=当前 pass 起始 ledger 偏移）。
持久化走现有 `metaPassTrigger` 键，无新键。

暴露 getter：`get inSweep() { return this.mech.sweep && this.inEvolutionReview && (this.metaPassTrigger as any)?.phase === 'sweep'; }`。

### 3.2 轮 1 → 连扫（close() :1822-1832 的 sweep 分支）

`advance` 条件不变（evolution && meta && round===1 && (agent close || cap close)）。当 `mech.sweep`：

```ts
this.metaPassTrigger = { ...passTrigger, round: 2, phase: 'sweep',
  sweep: { index: 0, seen: 0, ledger: this.ledger.length },
  prior: { closed: row.ref, outcome, reason, carry } };            // prior 同现行
this.fact('meta_pass_round', { from: 1, to: 'sweep', closure: row.ref, trigger,
  specialists: META_SWEEP_SPECIALISTS.map(s => s.focus), opens: 'next request boundary' });
// queue 同现行（同一 ticket 形状，review 在下一 boundary enter()，passEntry 重算并入账）
```

非 sweep 臂走现行 round:2 分支，一字不动。返回值 `next_round` 在 sweep 下改为
`{ round: 'sweep', passes: 7, opens: 'next request boundary' }`。

### 3.3 boundary() 内的连扫推进（置于 :1378 现有 cap 检查之前）

`activatePending`（:1373）已先跑，上一小回合的写已激活。随后：

```ts
if (this.review && this.mech.sweep && (this.metaPassTrigger as any)?.phase === 'sweep') {
  const t: any = this.metaPassTrigger;
  if (this.reviewRequests > t.sweep.seen) {            // 一个小回合刚结束
    const rows = this.ledger.slice(t.sweep.ledger);
    const refs = rows.filter(r => r.type === 'reflection_activated').map(r => r.ref);
    const rejected = rows.filter(r => r.type === 'tool_failed'
      && ['reflect_component','reflect_orchestration'].includes(r.value?.tool)).length;
    const s = META_SWEEP_SPECIALISTS[t.sweep.index];
    this.fact('meta_pass_sweep_turn', { index: t.sweep.index, focus: s.focus, layer: s.layer,
      request: this.request, outcome: refs.length ? 'change' : 'no_change',
      activation_refs: refs, rejected_writes: rejected });
    t.sweep = { index: t.sweep.index + 1, seen: this.reviewRequests, ledger: this.ledger.length };
    if (t.sweep.index >= META_SWEEP_SPECIALISTS.length) this.closeMechanically('sweep complete');
  }
  // 预算跳过：下一 pin 将触发 guard() 硬停时，不再开剩余 pass
  if (this.review && this.request >= this.contract.budget.requests) {
    const skipped = META_SWEEP_SPECIALISTS.slice((this.metaPassTrigger as any).sweep.index).map(s => s.focus);
    if (skipped.length) this.fact('meta_pass_budget_skip', { from_index: (this.metaPassTrigger as any).sweep.index, skipped, reason: 'request budget' });
    this.closeMechanically('sweep budget');
  }
}
```

要点：每 boundary 至多推进一次（`seen` 防重）；入场 boundary（尚无请求）不推进；
请求数判据与 `guard()`（:1965-1971）同一不等式，不自创估算。现有 :1378-1385 的按轮 cap 检查在
sweep 相保留为后备：`capRound` 分支里 sweep 相的 cap 取 `META_SWEEP_SPECIALISTS.length`。

### 3.4 close() 的 'sweep complete' 语义

`:1806` 现规则：mechanical && !reviewChanged() → `review_unresolved`。连扫走完七个 pass 是**设计内的完成形**，
全 no_change 时也不是 unresolved。改：

```ts
const unresolved = evolution && closedBy.startsWith('mechanical:')
  && !closedBy.includes('sweep complete') && !this.reviewChanged();
```

`'mechanical:sweep budget'` 不加豁免（场合被截断，无变更时记 unresolved 是诚实的）。
sweep 相的 close 永不触发 :1823 的 advance（条件 round===1 已排除）。崩溃恢复（构造器 :594
closeMechanically('crash/recovery')）自然关闭连扫并清 trigger，无需新逻辑，但要有测试覆盖（§7 case 9）。

### 3.5 decide_exit 在连扫中不可用

- `protocolSurface()`（:1223-1225）：`(this.mech.meta && !this.review) || this.inSweep` 时滤掉 `decide_exit`。
- `exit()` 顶部加卫：

```ts
if (this.inSweep) {
  const t: any = this.metaPassTrigger;
  this.fact('meta_pass_sweep_exit_refused', { index: t.sweep.index, focus: META_SWEEP_SPECIALISTS[t.sweep.index]?.focus ?? null });
  return { accepted: false, terminate: false, same_turn_correction:
    'The sweep closes itself: this pass closes after this response; a write through reflect_component or reflect_orchestration is this pass\'s decision, and text alone closes it as a judged no-change.' };
}
```

- `reviewExitSchema`（:607-608）：`metaRound===2` 强制三答的条件加 `&& !this.inSweep`；
  `exitRound`（:1787-1788）同样加卫（连扫下 exit 已被拒，此为一致性保险）。
- `entranceAskBlock`/`ENTRANCE_QUESTIONS` 在 sweep 臂全程不渲染（§4 文本选择已保证）；非 sweep 臂不变。

### 3.6 其余挂点

- `metaPassDue()`：不改（review/queue 在场时本就不开新场合）。
- `endResponse()`：不改（review 开着就不机械关，runner 既有续跑路径把下一请求带进下一 pass；
  纯文本响应即 no_change，无需任何新续跑机制 —— 轮 1 cap 3 跨多请求已依赖此路径）。
- `pin()`/`reviewRequests`：不改。
- `passEntry()`：sweep 相沿用 round===2 预算（trajectory 4000）；TRIGGER 行的标签在 phase==='sweep' 时渲染
  `round 2 of 2 (sweep: 7 focus passes)`，其余行不动。
- `meta_pass_opened`（:1402）：`mech.sweep` 时 `cap: META_PASS_ROUND_CAPS[0] + META_SWEEP_SPECIALISTS.length`
  （=10）、`round_caps: [META_PASS_ROUND_CAPS[0], META_SWEEP_SPECIALISTS.length]`（=[3,7]）。

## 4. 固定文本（新常量，照抄；运行时不得再加内容性语句)

七专家表与三份 per-focus 文本从 codex 快照 `tmp/codex_feature_diff.txt:87-117` **逐字**移植
（信封指令句 `Review the supplied facts ... boundaries.` 明确**不**移植）：

```ts
export const META_SWEEP_SPECIALISTS = [
  { focus: 'Prompt', layer: 'Prompt', kind: 'prompt' },
  { focus: 'Context', layer: 'Context', kind: 'context' },
  { focus: 'Skill', layer: 'Harness', kind: 'skill' },
  { focus: 'Tool', layer: 'Harness', kind: 'tool' },
  { focus: 'Subagent', layer: 'Harness', kind: 'subagent' },
  { focus: 'Memory', layer: 'Context', kind: 'memory' },
  { focus: 'Loop', layer: 'Loop', kind: 'orchestration' },
] as const;
```

`SWEEP_COMPONENT_KINDS`（原 componentKinds）、`SWEEP_OBJECT_CONTRACTS`（原 objectContracts，7 条）、
`SWEEP_SPECIALIST_CONTEXTS`（原 specialistContexts，7 条）：逐字照抄快照 :96-117。
帧头字符串保留原文 `Specialist evolution context: ${focus}`（兼容 F7 检测）。

策略文本（新；系统头，场合内恒定）：

```ts
/** sweep 臂替换 META_PASS_STRATEGY：仅末句不同，其余与现文本逐字一致。 */
export const META_PASS_SWEEP_STRATEGY = META_PASS_STRATEGY.replace(
  'The pass runs as two bounded rounds - induction, then capability - each closing through decide_exit or at its request cap; the task resumes when the final round closes.',
  'The pass runs as one bounded induction round followed by a fixed sweep of seven bounded focus passes; the induction round closes through decide_exit or at its request cap, each sweep pass closes after its one response, and the task resumes when the last pass closes.');

export const META_SWEEP_ROUND1_LINE = 'ROUND 1 - INDUCTION: this round closes through decide_exit with your own reading of the window\'s recorded facts - recurrences, costs, losses, outcome paths; result.reason and result.carry are rendered verbatim at the sweep entry. Seven bounded focus passes follow at the next request boundary. Writes stay legal in every round.';

export const META_SWEEP_LINE = 'EVOLUTION SWEEP: seven bounded focus passes run in fixed order - Prompt, Context, Skill, Tool, Subagent, Memory, Loop - one provider request each. Each pass closes after its one response: a write through reflect_component or reflect_orchestration is that pass\'s decision, and text alone closes it as a judged no-change; both are valid closures. Tool results and receipts return in the next pass\'s view and history; writes of every kind stay legal in every pass, whatever its focus. The pass view names the current focus, its material, its recorded signals and the remaining budget; the task resumes when the last pass closes or at the sweep\'s recorded budget boundary.';
```

`META_PASS_SWEEP_STRATEGY` 必须在测试里断言 replace 实际命中（防止上游文本漂移后静默等同原文）。

`reviewStrategy()`（:693-704）sweep 臂分支：

```ts
if (this.mech.meta) {
  if (!this.inEvolutionReview) return META_STRATEGY;
  if (this.mech.sweep) return this.inSweep
    ? `${META_PASS_SWEEP_STRATEGY}\n${META_SWEEP_LINE}`
    : `${META_PASS_SWEEP_STRATEGY}\n${META_SWEEP_ROUND1_LINE}`;
  ...现行 round 分支不动...
}
```

runner `coreLine`（:830-832）：`evo.inSweep` 时 SELF ROOT 句换为：
`SELF ROOT: evolution sweep - the task step is suspended; seven focus passes run one response each, self-closing; writes activate at the next request boundary and the task resumes when the last pass closes. Task artifacts are not edited here unless a write above says so.`
（轮 1 与非 review 分支不动。）

## 5. 渲染：连扫帧走易变尾，系统头场合内恒定

**禁止**：把 per-pass 帧放进 system 头；把完整 layer_state/组件全源作为 history 消息追加。
头在七个 pass 之间唯一合法的变化来源是 agent 自己的写激活（组件进 `ctx.order` 组是采用本身）。
机制性头变化只许发生在：场合入口、轮 1→连扫切换、场合出口（≤3 次缓存断点）。

载体：`reviewSelfView()`（:1733-1734）在 `phase==='sweep'` 时于 `evolution_pass` 内加 `sweep` 对象。
runner 的 `:819-820` 每请求重建 reviewSelfView 并经 `:857` 尾消息送达 —— 不需要新管线。

```ts
evolution_pass: { ...trigger.facts, entry: review.pass_entry, sweep: this.sweepFrame() }
```

`sweepFrame()`（新方法，机械拼装，总 clip 4000 字符）：

```
{
  index: k+1, of: 7, focus, layer,
  header: `Specialist evolution context: ${focus}`,
  context: SWEEP_SPECIALIST_CONTEXTS[focus],          // 逐字
  object_contract: SWEEP_OBJECT_CONTRACTS[focus],     // 逐字
  material: active() 里 kind ∈ SWEEP_COMPONENT_KINDS[focus] 的每个组件
            { kind, name, version, chars, hash12, read: `read_self_component("<kind>","<name>")` },
  // Context/Loop 的附加摘要（地址+数字，不内联全文）：
  //  Context → policy_context: { order, placement, volatile_tail, read: 'read_self(section="policy")' }
  //  Loop    → orchestration: { revision, step, steps: ids, transitions: n, decisions: n,
  //            read: 'read_self(section="definition")' } 与 policy_context 同上
  signals: <§5.1 映射的一行计数>,
  occasion_so_far: 已记 meta_pass_sweep_turn 的 [{focus, outcome}] 列表,   // 跨 pass 可见性
  resources: { requests: `${request}/${budget.requests}`, usd: 已用/上限（四舍五入到分）, tokens: 已用/上限 },
  closes: 'after this response; tool results and receipts return in the next pass'
}
```

材料走摘要+地址（`read_self_component` 拉取；读的结果经 history 回到**下一个** pass —— 配合"任意 pass
可写任意 kind"（无 focus 墙），读在 pass k、写在 pass k+1 是合法流水线）。不渲染组件全源。

### 5.1 signals 映射（复用 metaBoard :875-883 的现成计算，仅计数）

| focus | 行 |
|---|---|
| Prompt | `${obs.a2.thoughts.repeated.length} repeated reasoning head(s) across ${obs.a2.thoughts.blocks} recorded block(s)` |
| Context | `${obs.a1.unused.self_reads} read_self call(s)` + a4 残留字符（有则加） |
| Skill / Tool / Subagent / Memory | `${obs.a1.repeated_inputs.length} identical-input call group(s), ${obs.a1.unused.tools_never_called.length} zero-call tool(s)` |
| Loop | `${rejectedCalls} refused call(s), ${stalledTransitions} stalled action transition(s)` |

`observation()` 每帧现算一次即可（与 metaBoard 同源；不缓存跨 pass）。

### 5.2 kind 拆分（设计决定，照做）

保留宿主侧三职能：材料按 focus 选（`SWEEP_COMPONENT_KINDS`）、专家帧句（逐字）、日志按 pass/layer 归档
（`meta_pass_sweep_turn` 的 focus/layer 字段，M10 四层读数用）。
**废除**：focus 兼容墙（任何 pass 里任何结构合法的自变更一律接受 —— 现有 reflect 通道本就不设墙，
不得新增校验）；强制 reason/evidence 信封字段（理由读模型文本即可，与 `arc_action` 无侧信道同则）。

## 6. runner 旗标接线

- `:87` `EVO_MECH` 加 `sweep: process.env.EVO_SWEEP === '1'`。
- `coreLine` 换句见 §4；其余组装（:819-857）零改动 —— 帧随 reviewSelfView 走。
- 日志：`live_agent_self.jsonl`/`lifecycle.jsonl` 不需新事件；ledger 事实已足。

## 7. 测试

### 7.1 node：新文件 `tests/self_root_meta_sweep.test.ts`（照 `self_root_meta_pass.test.ts` 夹具风格，mechanisms `{ meta: true, sweep: true }`）

1. 轮 1 close（agent 与 cap 两式）→ `meta_pass_round {from:1,to:'sweep'}`；下一 tick review 重入；
   `reviewStrategy()` === `META_PASS_SWEEP_STRATEGY\nMETA_SWEEP_LINE` 且**七个 pass 间恒定**；
   任何处不含 `ENTRANCE_QUESTIONS[0]`；`surface()` 不含 `decide_exit`。
2. 七小回合定序：循环 `pin(); tick()` 七次，`reviewSelfView().evolution_pass.sweep.focus` 依次
   = 专家表顺序；第 7 次后 review 关、mode==='execute'、`review_closed.closed_by==='mechanical:sweep complete'`、
   全 no_change 时 `outcome==='closed'`（**非** review_unresolved）。
3. pass 内写：某 pass 中 `transaction({components:[define prompt]})` → 该 pass 的 `meta_pass_sweep_turn.outcome==='change'`
   且 refs 非空；下一 pass 的 `sweep.occasion_so_far` 含它；`active()` 已含新组件（跨 pass 可见）。
4. 无 focus 墙：Prompt pass 里 define 一个 tool → 接受、outcome 'change'。
5. 预算跳过：小请求预算合同，使连扫中途 `request >= budget.requests` → `meta_pass_budget_skip`
   列出剩余 focus、review 关、不 throw、任务可继续（mode execute）。
6. `meta_pass_opened`：sweep 臂 `cap===10`、`round_caps===[3,7]`；非 sweep 臂仍 8/[3,5]。
7. 连扫中 `exit()` → `accepted:false` + `meta_pass_sweep_exit_refused` 事实；`reviewExitSchema` 不要求
   `entry_question_responses`。
8. 非 sweep META 臂回归：`{meta:true}` 单独时现行三测试文件（`self_root_meta.test.ts`、
   `self_root_meta_pass.test.ts`、`self_root_meta_entry.test.ts`）全绿、行为无一变化。
9. 连扫中 export → `new SelfRoot(contract, saved)` 重建 → 构造器机械关审、无 throw、trigger 清空、可继续 tick。
10. `META_PASS_SWEEP_STRATEGY !== META_PASS_STRATEGY`（replace 命中断言）。

### 7.2 pytest：`tests/test_evo_ppt_pi.py` 风格加一条全链用例（scripted provider，EVO_META=1 EVO_SWEEP=1）

脚本：T0 设计 → 触发（episode close）→ 轮 1 一答 decide_exit →
七回复：#1(Prompt) `reflect_component` define prompt；#2-#5 纯文本；#6(Memory) define memory；#7(Loop) 纯文本。
断言：
- 连扫 7 个请求送达文本按序含 `Specialist evolution context: Prompt|Context|...|Loop`（尾部而非 system）；
- 相邻两个**无激活间隔**的 sweep 请求 system 内容逐字相同（缓存纪律）；#1 的 prompt 激活后 #2 的送达视图含其文本/地址（新鲜度）；
- `meta_pass_sweep_turn` 七条按序，outcome = [change, no_change×4, change, no_change]；
- 场合 provider 请求数 ≤ 10；连扫后任务恢复（后续请求 pin.mode==='execute'）。

### 7.3 免费检查梯度（全部从 checkout 根）

```
node --experimental-transform-types --test --test-concurrency=1 --test-force-exit tests/self_root_meta_sweep.test.ts tests/self_root_meta.test.ts tests/self_root_meta_pass.test.ts tests/self_root_meta_entry.test.ts
PYTHONPATH=src python -m pytest tests/test_evo_ppt_pi.py tests/test_evo_ppt.py -x -q
```

既有 ppt 三件套在本分支有**先在失败基线**（9/14，见 `tmp/ppt_base.txt`）：判定标准是对基线无新增失败，
不追修先在破损。

## 8. 验收清单

- [ ] `EVO_SWEEP` 默认关；未设时全路径（含 M9c meta 臂）字节级不变
- [ ] 轮 1 原样；连扫七 pass 定序、每 pass 恰 1 请求、自闭合；场合 ≤10 请求
- [ ] 工具调用即变更、纯文本即 no_change；全 no_change 合法且记 `outcome:'closed'`
- [ ] 无信封、无 focus 墙、无强制 reason/evidence 字段；判断全归 agent
- [ ] 帧（专家句逐字 + 摘要材料 + signals + occasion_so_far + resources）只走易变尾；头场合内恒定（除写激活）
- [ ] 事实齐备：`meta_pass_round(to:'sweep')`、`meta_pass_sweep_turn`、`meta_pass_budget_skip`、
      `meta_pass_sweep_exit_refused`、opened 的 [3,7]/10 —— 负例 (a)-(d) 可机械读出
- [ ] §7 全部测试绿；现有 meta 测试零改动通过
- [ ] 提交并推送 `evo-loop-implementation`；提交信息含 Co-Authored-By 行

实现落地后，在 `docs/plans/2026-11-16-self-evolution-space.md` §6.13 下追加一段实现记录
（commit、测试结果、未验证层：provider 行为与能力级主张均未验证，待 M10 预登记运行）。
