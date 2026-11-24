# layered 架构上的自进化：E1–E4 设计开发方案

日期：2026-11-24（Asia/Shanghai）。状态：设计，未实现。
基线：tag `layered-v1-duck-dafr-aligned`（commit `5e6d25e6`）。
上游依据：[三层设计 v0.4](2026-11-23-arc-agi-3-layered-design-v0.4.md)、[迁移方案](2026-11-23-arc-evo-layered-migration.md)、
[对齐路线图](2026-11-23-arc-layered-full-alignment-roadmap.md) §2.3 消融证据、用户提供的七条自进化原则（分辨率优先 /
证伪门 / 约束为单位 / 路径即知识 / 宿主给怎么做 / 梯度对齐 / 框架迁移）。

## 0. 三个前置裁定

1. **E1 在任务轮做，不开独立上下文。** 诊断"我在哪层失败"需要完整的交互路径（原则四：路径即知识）。独立上下文的
   评审者只能看到摘要，得到的恰是"无摩擦传递的脆知识"。独立上下文只保留给局间整合（E4），那时路径已经关闭。
2. **7-pass 的保留形式：一次不可绕过的结构化评审轮，按层组织，不按载体。** 7-pass 的真正价值是"agent 无法绕过的
   自我评审"；它的成本问题出在七个载体各开一轮、且在游戏上下文里暂停。新形式：宿主在结构性条件下冻结行动权，
   agent 必须交出一份四字段评审（层 / 诊断 / 证据 / 下一步差异）才能继续行动。一轮、四字段、不可绕过。
3. **语义→能力只有两条真实转换介质**（回答"分析判断如何变成 harness 能力"）：
   - **机器可读的记录 + agent 自己写的消费代码**：claims / world_model 以结构化形式存在，agent 的搜索与验证代码
     把它们当输入来执行。约束收紧搜索空间，代码是约束的执行形式。
   - **宿主在正确时刻回显 agent 写下的内容**：评审结论、有效修订、框架索引，由宿主注入后续状态消息或下局提示。
     宿主是记忆的搬运工，内容全部 agent 产出。
   其余形态（更多散文笔记、更多提醒）不构成能力，不投资。

## 1. E1：看见自己在哪层失败（任务轮，零额外回合）

### 1.1 `harness_state` 变量

与 `current_frame` 同列，每次 python 调用开头由宿主计算并绑定（`demo/arc_layered_python.ts` 组装进 request，
`demo/arc_layered_prelude.py` 的 `_cell`/`_bind` 绑定）。内容全部来自宿主已有的内存计数器，不读文件：

```python
harness_state = {
  "progress":  {"stale_steps": 14, "steps_since_level": 83, "level": 2, "resets": 3, "game_overs": 2},
  "attempts":  {"recent": [...last 12 batch lines...], "repeated_sequences": 2},   # 同一动作序列哈希重放次数
  "predictions": {"expect_hits": "7/10", "surprises": 1, "unchecked_batches": 5},  # 没带 expect 的行动批数
  "errors":    [...last 5 python exceptions, truncated...],
  "artifacts": [{"path": "work/lib/path.py", "imported": 3, "last_backtest": None}, ...],
  "claims":    {"validated": 2, "hypothesis": 4, "falsified": 1},
  "cost":      {"actions_used": 97, "budget_left": 113, "requests": 41, "evictions": 0},
}
```

上下文成本：`harness_state` 只存在于 REPL 命名空间，不进入任何消息文本，agent 不查则为 0 token；查看时走
现有 4096 字符截断，全量 dump 约 300–500 token，且旧输出会被驱逐/折叠清掉。常驻增量只有状态消息里的
`unchecked_batches` 一项（约 10 token）和触发时的 STUCK 行。护栏：`attempts.recent` 限 12 条、`errors`
限 5 条截断、`artifacts` 限 20 个文件。独立上下文方案省的不是 token 而是打断，代价是结论要序列化传回，
形成双份上下文和无摩擦摘要（违反原则四），故不采用。

D1 实施记录（2026-11-24）：宿主计数器 + `harness_state` 组装绑定、STUCK 默认 8 并换四层诊断三档措辞、
状态消息加 `unchecked_batches`（expect 开启时）、系统提示 +6 行。`claims` 字段待 D3，`artifacts.imported`/
`last_backtest` 待 D4，`cost.requests/evictions` 宿主 python 层不可见、以 `python_calls` 代替。验证：
单测 32/32；真实链路 `runs/arc-layered-d1-real-20261124-ls20b`（本地离线 ls20、真实 bridge、无模型）
13 个单元全绿，harness_state 各节在 6 动作 + 1 RESET + 1 SURPRISE 后取值正确。自主采用/净收益未验证，
待下一次 provider 运行。

### 1.2 触发：廉价信号 + 分层措辞

`STUCK` 默认打开（`ARC_LAYERED_STUCK_AFTER` 缺省 8，当前为 0）。措辞从"换策略"改为四层诊断提问：

- 一档（8 步无新状态）：`STUCK: 14 steps without a new state. Before acting: which layer is failing — action
  choice, rule hypothesis, goal reading, or object representation? harness_state has the evidence.`
- 二档（2×）：要求枚举 2–3 个替代框架，并用 `transitions` 里已有证据先筛掉不符合的，再行动。
- 三档（4×）：触发 §2 的强制评审轮。

向上走（重估目标/结构）和向下走（查细节/中间帧）都在提示词汇里给出，方向由 agent 选。

### 1.3 梯度补全

状态消息已含 budget/expect_hits。补一项：`unchecked_batches`（连续多少个行动批没带预测）。这让"感知到的梯度"
包含预期差的缺失本身，而不只有成败（原则六）。

## 2. 强制评审轮（7-pass 的继承者）

### 2.1 触发条件（宿主判定，结构性，agent 不能跳过）

1. 同一关第二次 GAME_OVER；
2. `stale_steps` 达到 4× 阈值；
3. 当前关预算耗去 50% 且 `levels_completed` 未变；
4. 过关时（最便宜的整合时刻，兼任 da-fr 的 level-transfer 引导）。

### 2.2 机制

- 宿主置 `review_required`，随 request 进内核；此后 `submit_actions` 抛出
  `ReviewRequired: call review(...) first — see harness_state for evidence`（查询、计算、读历史全部照常）。
- prelude 新增：

```python
review(layer="rule",              # action | rule | goal | representation
       diagnosis="对角线路线在 (31,40) 后必死，死因是计时条耗尽而非碰撞",
       evidence=[112, 118, 123],  # history 步号
       change="先收集右上角的补给再走对角线",  # 或 "none"
       test="走到 (31,40) 时计时条应 >40%")   # 能区分新旧解释的检查
```

- `review()` 经 RPC 上报宿主：写 `harness/review.jsonl`、解除行动冻结；`layer in (goal, representation)` 的
  `change` 作为一行 `Active revision: ...` 由宿主回显进后续每条状态消息，直到被下一次评审覆盖——这是评审结论
  转为持续行为约束的通道（转换介质二）。
- `no_change`（`change="none"`）合法，但 `test` 字段必填：没有区分性检查的评审不解除冻结。
- 成本：每次触发一个回合。四个触发条件在 su15 实测轨迹上估算每局 3–6 次。

### 2.3 与旧 7-pass 的对照

| 旧 7-pass | 新评审轮 |
|---|---|
| 按载体扫七轮 | 按失败层一轮定位，载体由层决定 |
| 暂停游戏、独立 Meta 窗口 | 同会话同上下文，保留路径 |
| `reflect_component` 版本化写入 | 评审只产出判断；改文件仍走普通 work/ 写入 |
| 固定节拍兜底（50 动作） | 结构性失败信号触发 |
| 可见改动为合格产出 | 区分性检查为合格产出 |

## 3. E2：证伪门——什么有资格被留下

- `expect` 默认打开（消融中唯一高采用且省成本的机制；它就是"先预测后兑现"的最小结构）。
- prelude 新增约束账本：

```python
claim("walls-block", "灰色格拒绝进入", support=[3, 9], kills="灰色是装饰")
submit_actions([...], expect=(2, 6), claim="walls-block")
```

- 状态机：`hypothesis` --(挂此 claim 的 expect 兑现)--> `validated`；--(挂此 claim 的 SURPRISE)--> `falsified`，
  并由宿主在下一条状态消息注明。`validated` 只能经由兑现的预测到达——门是结构，不是提醒。
- 持久化：宿主写 `work/claims.jsonl`（带 support/kills/状态/兑现计数）；内核绑定 `claims` 变量供 agent 代码消费
  （转换介质一：BFS 的后继函数可以直接排除违反 validated claim 的动作）。
- `world_model.py` 的回测（已有 O1 约定）同理：`test_world_model(transitions)` 通过 → 宿主在
  `harness_state.artifacts` 标记 `last_backtest`，agent 据此决定是否信任它做离线搜索。通过回测的函数可提升为
  具名基元直接调用；被新证据证伪就降回假设（粗粒化只对验证过的做）。

## 4. E3/E4：复用与框架迁移

- **局内复用**：validated claims + 可信 world_model → agent 写 `work/lib/*.py` 搜索/验证函数。宿主的唯一职责是
  `harness_state.artifacts.imported` 计数（采用度量）。
- **局间整合（独立上下文的唯一位置）**：局结束后一个独立小会话读 `review.jsonl`+`claims.jsonl`+`work/`，
  把成立过的约束蒸馏成 `work/frameworks/*.md`（这类局面长什么样、受什么约束、在哪些情境成立过）。下局宿主把
  框架索引（名字+一行）注入系统提示，细节由 agent 用 `open()` 按需读。跨游戏晋升走 held-out 评测（既有约定）。
- 具体规则默认不跨局迁移，框架才迁移（原则七）。

## 5. 开发切片与验收

| 切片 | 改动点 | 预估行数 | 命题（可证伪） |
|---|---|---|---|
| D1 = E1 | `arc_layered_python.ts` 组装 harness_state；prelude 绑定；STUCK 默认开+分层措辞；提示 +6 行；测试 | ~120 | 真实轨迹出现一次完整链：发现解释失效→修订对应层假设→设计区分性验证→改变下一步。最小形态=一条带证据的评审或 World model 更新 |
| D2 = 评审轮 | prelude `review()`+行动冻结；host 触发条件+`review.jsonl`+Active revision 回显；提示契约节 | ~150 | 评审轮产出的 `test` 至少一次在后续动作中被真实执行且改变了行为 |
| D3 = E2 | `claim()`+状态机+`claims.jsonl`+expect 默认开；`submit_actions(claim=)` | ~120 | 至少一条 claim 经"预测兑现"进入 validated，且无"做了就成功"型记录被标 validated |
| D4 = E3 | `artifacts.imported` 计数；回测标记接入 harness_state | ~40 | 一个 validated claim 或可信 world_model 被 agent 代码消费并减少同类失败 |
| D5 = E4 | 局间整合会话 + 框架索引注入 | 设计后置 | 一个 su15 框架让 ls20/ft09 首关请求数或动作数下降 |

- 默认值：D1–D3 直接默认开（含 expect 翻转为默认开）；`model/graph/work/notebook` 维持默认关。
- 验证：每切片 31+ 单测增量跑绿后，su15+ls20 本地离线各一次真实运行对照 tag 基线（az gpt-6-luna low），按
  功能 / 全链路 / 自主采用 / 净收益四层分别汇报；评审轮触发次数与成本单列。
- 回退：任一切片使分数或成本显著劣化，env 开关关回并记录（开关为既有条件段机制，无新框架）。

## 6. 风险

- 评审轮冻结行动权是本方案最强的干预，和"宿主只给怎么做"存在张力。边界：宿主只决定"何时必须评审"，
  不决定"评审出什么、改什么"；触发条件全部是结构性失败信号，不是节拍。若真实运行显示评审轮产出空洞文本，
  按原则二收紧的是门（test 字段必须随后可检验），不是加提醒。
- claim/review 增加的提示面约 +25 行，与"接口收缩"方向相反；D1–D3 合计新增暴露名 3 个
  （`harness_state`、`review`、`claim`），已是最小集。
