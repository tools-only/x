# layered 架构上的自进化：设计方案 v2

日期：2026-11-24（Asia/Shanghai）。状态：D1/D2 已实现（见 §5 实施记录），D3 起为设计。
v2.1 修订（同日）：折入 fable 七点评审——§3.0 生命周期裁定、知识谓词化（R1 合并 R2/R5）、D2.1 评审
降级、D3 重定义、D4 改跨局通道、D5 冻结、§4 评估协议预注册、§6 风险补全。
基线：tag `layered-v1-duck-dafr-aligned`（commit `5e6d25e6`）。
上游依据：[三层设计 v0.4](2026-11-23-arc-agi-3-layered-design-v0.4.md)、[迁移方案](2026-11-23-arc-evo-layered-migration.md)、
[对齐路线图](2026-11-23-arc-layered-full-alignment-roadmap.md) §2.3 消融证据、自进化原则讨论
（七原则 / 七时刻 / 转换器与尺度 / 载体形态阶梯）。

v2 重写说明：v1 按讨论时序累积（评审轮→证伪门→七对象→时刻→尺度→吸纳→阶梯），主线不可见。本版重组为
**问题建模（§1）→ 进化规则（§2）→ 自进化路径（§3）** 三段，并新增核心裁定：**自进化在 Python 环境内以
coding 的方式进行（§3.1）**。v1 的七对象分类归入 §1.4（可优化对象的分类），七时刻归入 §3.2（路径触发），
实施记录原样保留在 §5。

## 1. 问题建模：自进化的基础对象

前提：layered 架构已把游戏变成 coding 问题——观测是 Python 变量，行动是 Python 调用（`submit_actions`）。
一局之内，agent = 固定权重的模型 × 上下文 × `work/` 目录 × 循环。权重局内不可改，harness 不能给模型增加
能力，只能做三件事：用框架语句**激活**模型的潜在能力、把模型做不好的精确部分**外化**成代码、把感知管道
**调**到模型长处上。自进化的全部对象是模型之外的东西。

### 1.1 四个基础对象（判别法定义，不是描述）

| 对象 | 定义 | 判别法 | 住处与寿命 |
|---|---|---|---|
| **经验** | 发生过什么：帧-动作-结果序列 + 本回合临时代码 + **模型的推理文本**（"为什么"主要在这里） | 绑定具体情境，换个输入即失效 | 上下文 / `history`，按驱逐淘汰；"为什么"的持久载体是 agent 写进谓词/笔记的 rationale（当时的证据步号 + 排除了什么），否则随驱逐消失 |
| **知识** | 什么为真：**作用在 transition 上的谓词函数**（`check(transition) -> True/False/None`，None=不适用），附 rationale | 可执行核对——宿主能在任意 transition 上跑它 | `work/claims/*.py`；support/反例/尺度/状态由宿主执行算出，按尺度带走 |
| **能力** | 转换器：对**未见过的输入**产出正确输出的可执行过程 | 五条全满足：对未见输入可执行 / 可测试 / 可组合 / 知识以参数形式进入不写死 / 有调用点和退役条件 | `work/` 代码 + 启动程序，按尺度带走 |
| **可优化对象** | agent 能改的全集 | agent 的 Python 写操作能触达：work/ 下的文件、内核命名空间里的名字 | `work/` 全目录 + 命名空间包装。**自我 = work/ 全目录**（§1.3 四元组是其核心子集，frameworks/render 包装同属自我） |

知识与能力的分工：知识缩**假设空间**（少猜），能力缩**下一条知识的获取成本**（验证更便宜）。经验是两者的
原料。散文策略句（"新关先查新元素"）是最弱载体上的知识，永不直接算能力——它丢失适用边界。
"第三关红块在左上角"是操作数不是知识条目；"UP 使这类对象上移一格，除非被挡，12 个 transition 支持 0 反例"
是知识；"给任意帧和任意动作算出下一帧的 `predict`+回测"是能力。

### 1.2 两个坐标轴

每个留存对象有两个独立坐标，进化就是在这两根轴上受规则约束的移动：

- **尺度轴**（在多大范围成立）：step → level → game。依据 ARC 的层级结构：同一局的关卡共享机制。
  **在线自进化裁定（2026-11-25）：尺度轴封顶 game**——游戏之间、同一游戏两次独立 session 之间不继承，
  学到的东西只活在一个游戏 session 内。跨游戏共性（未知控制、未知目标、确定性环境、有限动作）只能以
  宿主固定 prelude 的形式存在：它对所有游戏一视同仁，是固定 harness，不是学来的。
- **形态轴**（以多强的自动性执行）：0 模型每次重推 → 1 提示文字 → 2 可调用函数 → 3 挂钩（每动作后自动跑、
  结果进视野）→ 4 门（条件不满足不让行动）。可靠性与成本递增：文字上下文一紧就失效；函数可能忘调；
  挂钩会空跑；门会错卡。

### 1.3 "自我"与进化的定义

- **自我** = `work/` 全目录（§1.1）；核心四元组：`work/claims/*.py` 知识谓词，`work/lib` 能力库，
  `work/startup.py` 启动程序，`work/prompt.md` 编排规则。全部是文件，git 版本化即进化史。
- **自进化** = 四元组内容在两根轴上的移动：经验归纳为知识（约束化），知识编译为能力（函数/挂钩/门），
  能力产生新经验；证据反转时反向流动。
- **梯度** = 每获得一条约束付出的动作数。由 ARC 成本结构（动作贵、内核计算免费）给出，是进化的方向
  **概念**；它不可直接测量（R7），实际裁决用 R7 列出的代理量。

ARC 能力清单（七类，整合评审的盘点维度）：
感知（帧→对象/变化/瞬态/分区，含渲染配置——它决定模型能看见什么）、建模（`predict`+不变量+目标谓词+回测；
**没有回测的模型不是能力，是猜**）、规划（以 predict 和目标谓词为参数的搜索与实验设计；搜索器跨局通用、
predict 按局换）、验证（期望核对/不变量监测/守卫，几乎不该停在形态 1——价值全在不依赖记得）、学习（假设表
更新规则/框架切换/换关程序/GAME_OVER 程序，形态 1 最容易赖着不走的地方）、节律（阶段划分/批大小/探测→搜索
切换点）、上下文（留什么原文/压缩成什么具名基元/怎么命名）。

### 1.4 可优化对象的分类（七对象视图）

旧 7-pass 的七个对象不是独立的机制，而是**可优化对象全集按用途的分类**。每个对象承载哪种基础对象，
决定它适用哪些规则（知识走 R1/R2/R5，能力走 R1–R3/R5，经验驻留走 R4）：

| 7-pass 对象 | 承载的基础对象 | v2 载体 | 激活通道 |
|---|---|---|---|
| Prompt | 知识的形态 1 载体（编排/方法规则的文字形态，待编译为更高形态） | `work/prompt.md` | 宿主边界注入系统提示尾部 |
| Context | 经验与证据的驻留策略：agent 决定什么常驻（memory 标签、Active revision、索引引用） | 既有回显内容 | 回显通道 |
| Skill | game 尺度的知识+能力复合：框架 = 一组约束检查 + 进入路径（在线约束下不跨游戏，§1.2） | `work/frameworks/*.md` | 索引 + `open()` 按需读 |
| Tool | 能力（形态 2 转换器） | `work/lib/*.py` 具名基元 | startup.py import |
| Subagent | 能力的执行方式：界内 = 内核离线计算（搜索/回测，免费）；局间整合会话在在线约束下取消 | 内核代码 | 执行即激活 |
| Memory | 知识（账本）+ 经验（路径记录，保留"为什么"） | `claims.json` + 路径记录 + 标签 | 回显 + `open()` |
| Loop | 节律能力（形态 1→4 皆可）：阶段/批大小/切换点；宿主循环（预算/安全/评审时机）不交出 | prompt.md 规则 + startup.py 包装 | 行为即激活 |

## 2. 进化规则

从 §1 定义推出。每条注明执行形式：**结构门**（宿主机械执行，agent 绕不过）或**脚手架**（提示里的
方法论，判断归 agent）。修订（fable 评审，2026-11-24）：原 R1/R2/R5 的"陈述条目+手工元数据"形态使三条
结构门退化为记账（expect 挂 id 字符串无法保证检验的是该陈述、agent 可直接写 validated、核对的是引用位置
而非成立性、降级只改字段不改行为）。现合并为谓词机制，状态/尺度/连坐全部从执行结果算出。

| # | 规则 | 内容 | 执行形式 |
|---|---|---|---|
| R1 = 验证+尺度+来源（R2/R5 并入） | 谓词验证 | agent 写谓词（语义：`work/claims/*.py` 的 `check(transition)`），**宿主在每个新 transition 上机械执行全部谓词**，support/反例/尺度由执行结果算出；状态由宿主单独持有（agent 只读）；validated 需 ≥3 support 且 0 反例，升尺度需 origin 外的关/局出现 support；出反例自动降级（不删除）；依赖从 `import` 关系静态推出并连坐 | 结构门：agent 写不进状态字段，"绕不过"才真成立 |
| R3 | 形态 | 形态升降凭**宿主可测量的**使用记录：import 次数、文件读写、宿主可见拒绝。函数调用/挂钩命中/门拦截在请求层不可见，**不得作为规则依据**（除非先实现 prelude 登记约定） | 脚手架 + 仅可见量计数 |
| R4 | 住处 | 操作数与证据住上下文和账本（按尺度淘汰），转换器住代码。坐标/路线/"这局是某类游戏"是操作数；**未经检验的散文不得常驻回显**（Active revision 改为一次性，见 D2.1）；单关机制当通则是尺度错位 | 脚手架 + 淘汰策略（evict 丢最旧整段，不用摘要替换） |
| R6 | 分工 | agent 做全部语义判断（写什么谓词、归纳什么函数、写什么进启动程序）；宿主只做机械五项（§3.3） | 架构约束 |
| R7 | 梯度（代理量） | "每条约束的获取动作数"**不可直接测量**（一个探测动作服务多条约束，且可被拆细刷分），不再宣告为唯一方向量。可测代理：每关动作数 vs baseline、SURPRISE 率、重复序列数、谓词 support 增速。进化活动本身的 token/时间列入运行预算 | harness_state.cost + 运行预算参数 |

统一状态机（宿主单独持有，谓词与函数通用；此前 disputed/stale/死路的去向未定义）：

- `hypothesis` --(宿主执行达标)--> `validated` --(新反例)--> `falsified`（归档为死路，不删除）；
- `validated` --(依赖被证伪)--> `disputed`（按 hypothesis 待遇，复验达标可回）；
- 任何状态 --(来源文件被 agent 改写)--> 重置为 `hypothesis` 重新累计。
- 函数的状态 = 自身回测结果 ∧ 其 import 的谓词中最弱状态。
- 通道后果：validated 进索引首栏；hypothesis 进索引尾栏；falsified 不进索引、`open()` 可查。

## 3. 自进化路径

### 3.0 生命周期裁定（fable 评审后新增，2026-11-24）

此前文档假设"每到新会话或新关，内核重启并执行 startup.py"。与代码不符。真实运行时：

- 一局 = 一个 Pi 进程 + 一个常驻 Python 内核；**换关不重启**（除非显式 `fresh_level_session` 或内核崩溃）。
- `work/` 按运行目录创建，**不跨局**。
- 推论：agent 定义的函数与变量局内本来就常驻，**局内"吸纳"无事可做**；startup.py 的真实作用域只有两个
  ——内核崩溃恢复、（历史表述中的跨局启动已随在线约束作废，见下）。

裁定：**保持连续会话 + 常驻内核**（不选"每关开新会话"——那会丢掉路径，与"路径即知识"冲突）。后果：

1. **在线修订（2026-11-25）**：跨局通道作废——在线自进化约束下游戏之间不继承（§1.2）。吸纳的真问题在
   **session 内对抗遗忘**：上下文淘汰（eviction）杀死推理与结论，内核崩溃杀死命名空间，而 `work/` 文件与
   claims 状态在两者之后都存活。吸纳 = 在死亡之前把结论编译成文件。D4 相应重定义（§4）。
2. `prompt.md` **不注入系统提示尾部**：系统提示在每段开始重算，中途改写使整段前缀缓存失效。改为
   **开局第一条用户消息注入一次**（新局启动时读取，一次性）。
3. startup.py 出错不得阻塞内核：prelude 捕获并以 `[startup]` 行回显，agent 可修文件后手动重载；
   宿主对 work/ 的 git 快照提供回滚。

### 3.1 核心裁定：自进化在 Python 环境内进行

游戏已经 coding 化，自进化同样 coding 化——不建专用工具面，自我就是一组 Python 文件加一个启动程序。
对照表（v1 曾设计的专用机制 → Python 原生形式）：

| 自进化动作 | v1 设计 | Python 原生形式（v2 采用） |
|---|---|---|
| 吸纳（让能力默认在场） | 宿主按账本状态分级注入命名空间/提示 | agent 写 `work/startup.py`；宿主在内核启动时执行它（崩溃恢复，见 §3.0；局内名字本来常驻，吸纳的真场景是在淘汰与崩溃之后仍在场——文件和 claims 是 session 内唯一的存活物） |
| 挂钩/门（形态 3/4） | `register_hook`/`register_gate` RPC | 普通包装：`submit_actions` 就是命名空间里的函数，会话内 `submit_actions = guarded(submit_actions)`，跨会话写进 startup.py。**宿主门在 RPC 层、位于一切 agent 包装之下，不可被 agent 代码绕过** |
| 知识账本 | `claim()` 专用工具 | agent 写 `work/claims/*.py` 谓词（`check(transition)`，附 rationale）；**宿主在每个新 transition 上执行全部谓词**，support/反例/尺度/状态由执行结果算出且由宿主单独持有，agent 只读（R1）。无双写者问题 |
| 回测/编译/搜索/实验设计 | — | 本来就是代码 |
| 感知配置 | `render()` 工具 | agent 置 `render = {"zoom":…, "diff":…, "frame":…}` 字典，宿主每次 python 调用后读取、决定下一回合注入的图像 |
| 自我评审 | `review()`（保留） | **不 Python 化**：评审冻结约束的是行动权本身，必须在 agent 代码够不到的层（实现见 §5.2） |

不进 Python 的只有两样：评审冻结门（§5.2）与预算/安全。其余专用面全部取消（无 claim()/register_*/
notebook() 工具），agent 接口 = python 工具 + `submit_actions(expect=)` 一个参数 + 冻结时的
`review()`。这同时满足轻量化原则与 Duck 的发现（手工预置工具有害；agent 自造的不在此列）。

代价要明说：startup.py 由 agent 全权决定，宿主不再强制"只有 validated 才能默认在场"——约束降级为脚手架
（索引里状态可见 + 提示说明只有 validated 值得进启动程序）。换来的是 R6 的纯粹性和机制面的大幅缩减；
若真实运行显示 agent 把垃圾塞进 startup.py，再评估收紧（先改门不改提醒，按 R1 的精神）。

### 3.2 六阶段路径（每阶段：载体 / 门 / 执行者）

```
①轨迹        ②约束化              ③候选化               ④验证
history ───→ claims/*.py 谓词 ───→ work/lib 函数 ───────→ 回测 / 新关实例
(宿主录制)    门:宿主逐transition执行  触发:七时刻(下表)      门:R1(宿主执行算出)
             写谓词:agent            归纳:agent             跑验证:agent

④通过 ──→ ⑤吸纳                    ──→ ⑥升降级
          agent 写进 startup.py /        使用记录+证伪驱动(宿主计数、连坐、回显)
          prompt.md(开局注入)    移动决定:agent
```

- ②约束化：agent 把观察写成谓词文件（初始状态 hypothesis）；宿主在每个新 transition 上自动执行，
  support/反例由执行结果累计，状态升降全自动（R1）。`expect=` 保留为**批内即时核对**（SURPRISE 停批），
  不再承担 claim 状态更新——"expect 挂 id 字符串无法保证检验的是该陈述"的模糊性由谓词自动核对消解。
- ③候选化：在七时刻（下表）触发下，agent 把重复做过的过程归纳成参数化函数——**编译**：被验证的约束变成
  predict 里的一个分支，被反复遵守的程序文字变成门，被反复选择的观察习惯变成渲染配置。
- ⑤吸纳：形态 2 的吸纳 = startup.py 里 import（内核重启后自动恢复，见 §3.0）；形态 1 的吸纳 = prompt.md
  段落（开局第一条用户消息一次性注入）；形态 3/4 的吸纳 = startup.py 里安装包装。
- ⑥反向编译：回测失败的分支退回假设表；空跑的门退回函数；被更大尺度证伪的条目降回原尺度。

流水线的触发时刻（七时刻是同一条流水线的触发，不是七套机制；信号全部来自已有机制）：

| 时刻 | 信号 | 流水线动作 |
|---|---|---|
| 成功 | expect 连续兑现 / 过关 | 尺度验证通过，可升级（③→⑤） |
| 空闲 | 动作贵/计算免费的价差 | 建转换器成本最低的时候（③：预测器、不变量监测、状态索引、小测试集） |
| 不确定 | 账本并存多个 hypothesis | 主动实验：用能区分两个假设的动作制造检验实例（④） |
| 重复 | 盘点中数量涨、引用不涨 | 重构/减法：merge/remove 是合格产出 |
| 边界 | 换关/换局/驱逐事件 | 尺度判定时刻（R2）；具体变参数（位移规律而非"红块往右推"） |
| 自我认识 | errors 中重复失败方式 | 找缺失的转换器：weakness 条目 + 补偿代码（让代码数而不是自己数） |
| 节律 | 进度曲线形状（cost） | 改最顶层转换器（loop 规则进 prompt.md/startup.py） |

评审轮与流水线的衔接：失败评审（§5.2 四触发中的前三个）按失败层定位后**走对应出口**——action/rule/goal
层走②修假设；**representation 层失败允许直接产出新的感知函数（③）**，不限于修假设（否则换分辨率的出口
被堵死）。过关整合评审要求 consolidation 形状——`review(layer="consolidation", path=[步号区间],
constraints=[claim ids])`，并按 **§1.3 七类能力**（唯一盘点维度；§1.4 七对象是历史映射视图，不作盘点
清单）各交一个 change|no_change 决定（宿主提供盘点，no_change 须给一句理由）。系统扫描属于整合时刻，
定位属于失败时刻，两者不混。

### 3.3 宿主机制全清单（五项，全部机械）

1. **持久化与启动**：`work/` 在整个游戏 session 内保留（不跨游戏，§1.2）；内核启动（崩溃恢复）时执行
   `work/startup.py`；注入一行级索引（条目名+状态+尺度+引用数，细节 agent 用 `open()` 按需读）。
2. **谓词执行**：宿主在每个新 transition 上执行全部 `work/claims/*.py` 谓词，累计 support/反例，算出
   尺度；状态由宿主单独持有（agent 只读）；依赖从 `import` 关系静态推出并连坐（R1/R5 合一机制）。
3. **不可绕过门**：评审冻结（触发条件见 §5.2，agent 自建门不参与判定、凌驾于 agent 包装之上）、预算。
4. **机械计数**：harness_state（§5.1）+ **宿主可测量的**使用记录（import 次数、文件读写、宿主可见拒绝）。
   函数调用/挂钩命中/门拦截在请求层不可见，不列入——除非先实现 prelude 登记约定（最小形式：包装函数向
   `_S["usage"]` 计数、随 summary 上报），实现后方可作为 R3/D5 的数据源。
5. **回显**：SURPRISE/降级/disputed 注明、索引注入、STUCK 分层措辞；评审的 goal/representation 修订
   **一次性注入**（不常驻，R4）。

### 3.4 agent 侧负担核对（轻量化验收）

诚实核算（fable 指出此前漏项：专用接口没有归零，部分挪进了文件格式约定）：

- 每回合常驻新增 ≈ 状态消息 2–3 行（unchecked_batches、必要时 STUCK/降级注明）。
- 一次性成本：开局 prompt.md 注入（设字节上限）；评审修订注入一次。
- 格式约定（提示面成本，计入）：claims 谓词文件约定约 4 行、prompt.md 来源引用约定约 1 行、
  整合信封（path/constraints/七项各一句理由）约 3 行。提示面合计新增约 20 行，对价是专用工具面
  （claim()/register_*/notebook()）归零。
- 专用动作：仅 `expect=` 参数和冻结时的 `review()`（`claim=` 参数随谓词化取消）；其余全部是普通 Python。

### 3.5 路径在七对象上的实例化

六阶段路径（§3.2）对七个承载对象（§1.4）逐一成立——同一条流水线，原料、候选形态、验证门、吸纳通道
按对象不同而具体化。本矩阵是旧 7-pass 对象的**映射视图**（整合评审盘点以 §1.3 七类能力为唯一维度，
不按本表）。诚实注记：Context 行 agent 实际能改的只有 memory 标签与清除——淘汰策略和状态消息归宿主；
Subagent 行的"界内"就是普通内核计算（本来就有），跨上下文会话要到 D6 才存在：

| 对象 | ①②原料与捕获 | ③候选形态 | ④验证门 | ⑤吸纳通道 | ⑥升降级依据 |
|---|---|---|---|---|---|
| Memory（知识账本） | 观察→`claims/*.py` 谓词（hypothesis） | 谓词本身即候选 | 宿主逐 transition 执行达标（R1） | 索引注入 + 回显 | 状态机升降 + 尺度升降；证伪归档为死路不删除 |
| Tool（基元） | 临时代码被第二次需要；依赖 validated claims | `work/lib` 参数化函数（账本状态 hypothesis，记 `induced_from`/`depends_on`） | 回测 / 下一关复现 + 尺度核对 | startup.py import | 调用计数升形态（函数→挂钩→门）；依赖证伪连坐降级（R5） |
| Subagent（执行方式） | 重复出现的离线计算模式（搜索/回测/枚举） | 内核离线计算代码；跨上下文需求记入 D6 议程 | 同 Tool | startup.py / D6 会话 | 同 Tool |
| Prompt（文字规则） | 评审结论、被反复遵守的行为模式 | `work/prompt.md` 段落，**必须引用来源**（validated claim 或 review id） | 来源健康 + 下一会话被遵守的使用记录 | 开局第一条用户消息一次性注入（§3.0） | 升级 = 编译为函数/门（形态轴上移，R3）；来源证伪→宿主标 stale |
| Context（驻留策略） | 被反复查阅/引用的内容 | 常驻选择：memory 标签（agent 唯一可控项） | 文件读取计数（宿主可测） | 既有回显通道 | 引用不涨→agent 清除（重复时刻的减法） |
| Skill（框架） | 局内 validated claims + 走通的路径 | agent 归纳成 `work/frameworks/*.md`（约束检查 + 进入路径；在线约束下不跨游戏，D6 已取消） | 同局后续关卡复现；约束检查通过才激活 | 框架索引注入 + `open()` | level→game 尺度升降（R2）；检查不过不激活 |
| Loop（节律） | 自己的行为模式与效率曲线（R7 代理量） | 节律规则：prompt.md 文字或 startup.py 包装 | R7 代理量变化（每关动作数、SURPRISE 率、重复序列数） | prompt.md 注入 / startup.py 执行 | 文字→门的形态升级；效率劣化回退 |

读法：每行都是"经验→知识→能力"的同一次旅行，区别只在候选形态和门的证据类型。Memory 是其余各行的
依赖源头（Tool/Prompt/Skill 都要引用它的条目），所以 R5 连坐天然沿此矩阵传播：一条 claim 被证伪，
依赖它的基元、prompt 段落、框架同时降级，宿主一次机械完成。

## 4. 开发切片

### 4.0 实施顺序裁定：MEL 优先，门按失败证据后置（2026-11-24）

问题：核心闭环（①→⑥）从未在真实轨迹走通过一次，而 D3–D6 的多数机制是对"闭环已在转"之后才会出现的
失败模式的解法（尺度门防跨关泛化错误——但从未过过关；连坐防基元变脆——但从未有过基元）。按项目规则
"start with a real failure"，裁定：

- **最小进化环（MEL）先行**：expect（窄区间，已有）+ `work/` 持久化（已有）+ `work/startup.py` 内核启动
  自动执行（本次新增，宿主读文件随 request 下发、prelude 在新建命名空间时执行一次，出错以 `[startup]`
  行可见）。MEL 阶段知识账本暂为**文件格式约定**（提示 2 行，agent 自管），宿主暂不建谓词执行/状态机/连坐；
  该临时形态已由 v2.1 的谓词机制（D3）取代，MEL 结束后不再扩展文件约定。
- **D2 降级验证**：新增 `ARC_LAYERED_REVIEW_TRIGGERS`（逗号列表：level/game_over/stuck/budget，缺省全开）；
  MEL 运行只开 `game_over`。
- **D5/D6 冻结**为"观测到对应失败后的预案"。
- MEL 判定实验（su15 本地离线 + az gpt-6-luna low 一次）只回答一个问题：**agent 会不会自主写一个文件并在
  后续用它**。会→闭环存在，再按 §4 表推进；不会→问题在提示/模型层，先修基础再谈上层。
- MEL 运行环境：`ARC_LAYERED_EXPECT=1 ARC_LAYERED_WORK=1 ARC_LAYERED_REVIEW=1
  ARC_LAYERED_REVIEW_TRIGGERS=game_over`，其余缺省。

| 切片 | 状态 | 改动点 | 预估 | 验收命题（可证伪） |
|---|---|---|---|---|
| D1 | 已实现 | harness_state + STUCK 分层措辞 + unchecked_batches（§5.1） | — | 真实轨迹出现一次完整链：发现解释失效→修订对应层假设→设计区分性验证→改变下一步 |
| D2 | 已实现 | 评审冻结门 + `review()` 四字段 + Active revision 回显（§5.2） | — | 评审产出的 `test` 至少一次被后续动作真实执行且改变行为 |
| D2.1 | 设计（降级） | review 默认改回**关**（与基线 tag 一致，开 = `ARC_LAYERED_REVIEW=1`）；goal/representation 修订改**一次性注入**（不常驻，R4）；失败评审 representation 层允许产出感知函数（change 可为"新增 work/lib 函数"）；`test` 字段谓词化（D3 后可填谓词文件名，宿主在后续 transition 上核对） | ~30 | 开 review 的运行相对关 review 的运行，至少一条 test 被宿主核对为兑现/落空（而非散文无下文） |
| D3 | 设计（重定义） | **谓词机制**：宿主逐 transition 执行 `work/claims/*.py`、累计 support/反例、状态机（§2）、尺度核对、import 连坐；索引注入；提示约定约 6 行 | ~150 | 至少一条谓词由**宿主执行**达到 validated（agent 无直接写状态的通道）；至少一次反例自动降级且文件保留 |
| D4 | 设计（再重定义，2026-11-25） | **session 内淘汰存活验证**：在线约束下跨局通道作废（§3.0）。现有机制已完备（work/ 贯穿 session、startup.py 崩溃恢复、claims 跨关累积），D4 不加代码，是验收切片；可选小件：eviction 发生时宿主事件行报告"N 轮已淘汰；work/ X 个文件、Y 条 validated claims 仍在" | ~15（可选事件行） | 一次真实 eviction 之后，agent 引用 work/ 或 claims 里的内容做出决策（session 内吸纳闭环的净收益证据） |
| D5 | **冻结** | 原"形态移动使用记录"无数据源（函数调用/挂钩命中/门拦截在请求层不可见，§3.3-4）。先决条件：prelude 登记约定；观测到"该升没升/该降没降"的真实失败后再解冻 | — | — |
| D6 = E4 | **取消（2026-11-25）** | 在线自进化约束：游戏之间、两次独立 session 之间不继承，局间整合会话与跨局框架库与此矛盾。game 尺度内的框架归纳由 claims 尺度机制覆盖 | — | — |

- 默认值：**与基线 tag 一致全部默认关**，每个机制用 env 显式开（MEL 组合见 §4.0）。避免"默认配置偏离
  对照基线"的问题重演。
- 评估协议（预注册，不事后挑）：su15/ls20 是开发局，**ft09 是保留局**（只在切片定稿后各跑一次）；付费
  运行设 token 上限（gpt-6-luna low ≤ 40 万 token/局）；验收命题从"至少出现一次"升级为预注册阈值——
  D3：validated 谓词 ≥1 且假阳性（人工复核）= 0；D4：真实 eviction 后引用 work/ 或 claims ≥1 且该批动作未被
  浪费（不触发 SURPRISE 即弃）；证伪阈值：开启机制的运行若每关动作数或 token 劣化 >30%，判负并关回。
- 与 da-fr 结论的差异声明：da-fr 实验里结构化账本/强制验证/回插修订为中性或有害。本方案的差异：账本是
  宿主执行的谓词而非 agent 记账散文；回插改一次性；评审默认关、按失败证据开。若真实运行复现 da-fr 的
  中性/有害结论，按证伪阈值关回，不加机制补救。

## 5. 实施记录（v1 原文保留）

### 5.1 D1：harness_state 与分层诊断（已实现，2026-11-24）

`harness_state` 与 `current_frame` 同列，每次 python 调用开头由宿主计算并绑定（`demo/arc_layered_python.ts`
组装进 request，`demo/arc_layered_prelude.py` 绑定）。内容全部来自宿主已有内存计数器，不读文件：

```python
harness_state = {
  "progress":  {"stale_steps": 14, "steps_since_level": 83, "level": 2, "resets": 3, "game_overs": 2},
  "attempts":  {"recent": [...last 12 batch lines...], "repeated_sequences": 2},
  "predictions": {"expect_hits": "7/10", "surprises": 1, "unchecked_batches": 5},
  "errors":    [...last 5 python exceptions, truncated...],
  "artifacts": [{"path": "work/lib/path.py", "imported": 3, "last_backtest": None}, ...],
  "claims":    {"validated": 2, "hypothesis": 4, "falsified": 1},
  "cost":      {"actions_used": 97, "budget_left": 113, "requests": 41, "evictions": 0},
}
```

上下文成本：只存在于 REPL 命名空间，agent 不查则 0 token；查看走 4096 字符截断。常驻增量只有状态消息的
`unchecked_batches`（约 10 token）和触发时的 STUCK 行。STUCK 三档四层措辞（8 步：问在哪层失败——动作选择/
规则假设/目标理解/对象表征；2×：枚举替代框架并用已有证据先筛；4×：触发评审轮）。向上走（重估目标/结构）
和向下走（查细节/中间帧）都在提示词汇里给出，方向由 agent 选。

实施记录：宿主计数器 + 绑定、STUCK 默认 8、状态消息加 `unchecked_batches`（expect 开启时）、系统提示 +6 行。
`claims` 字段待 D3，`artifacts.imported`/`last_backtest` 待 D4，`cost.requests/evictions` 以 `python_calls`
代替。验证：单测 32/32；真实链路 `runs/arc-layered-d1-real-20261124-ls20b`（本地离线 ls20、真实 bridge、
无模型）13 单元全绿。自主采用/净收益未验证，待 provider 运行。

### 5.2 D2：强制评审轮（已实现，2026-11-24）

7-pass 的继承形式：宿主在结构性条件下冻结行动权，agent 必须交出四字段评审才能继续。一轮、四字段、不可绕过。
与旧 7-pass 的差异：按载体扫七轮→失败时按层一轮定位（整合时按七类能力盘点）；独立 Meta 窗口→同会话同
上下文（路径即知识，独立上下文只留给 D6）；`reflect_component` 版本化→写普通 Python 文件 git 版本化；
固定节拍兜底→结构性信号触发；可见改动为合格产出→区分性检查/使用记录为合格产出。
触发（宿主判定）：同关第 2 次 GAME_OVER；stale_steps 达 4× 阈值（缺省 32）的整数倍；本关预算耗去 50% 且
未过关（每关一次）；过关时（最便宜的整合时刻）。冻结双层执行：批内后续动作被宿主拒绝
（`stop_reason: review required`），新 `submit_actions` 在 prelude 入口抛 `ReviewRequired`；查询、计算、
读历史照常。

```python
review(layer="rule",              # action | rule | goal | representation
       diagnosis="对角线路线在 (31,40) 后必死，死因是计时条耗尽而非碰撞",
       evidence=[112, 118, 123],  # history 步号
       change="先收集右上角的补给再走对角线",  # 或 "none"
       test="走到 (31,40) 时计时条应 >40%")   # 能区分新旧解释的检查
```

校验（层枚举、evidence 非空步号、test 必填）在 prelude 完成；RPC 上报宿主解冻，写 `harness/review.jsonl`；
goal/representation 的 change 作为 `Active revision:` **一次性**注入下一条状态消息（D2.1；此前为常驻，
违反 R4）。要跨会话保留，agent 自己写进 `work/prompt.md`（带来源引用）。WIN 不触发。开关
`ARC_LAYERED_REVIEW`（**D2.1 起缺省关**，`=1` 开，与基线 tag 一致）。验证：单测 36/36；真实链路 `runs/arc-layered-d2-real-20261124-ls20`
（本地离线、真实 bridge、无模型）：预算触发冻结→ReviewRequired→`review()` 解冻→动作恢复，scorecard 关闭。
GAME_OVER 分支与自主采用未验证，待 provider 运行。

整合评审（过关触发）在 D3 起接受 consolidation 形状（§3.2 末段）。

评审落地修复（2026-11-24，MEL su15 运行的证据：三次评审诊断命中要害但零行为改变）：
① `change` 填层名被 prelude 拒绝；`Active revision:` 改为回显 change（或 change='none' 时的 diagnosis），
截断 200 字符、一次性注入。② 评审后第一个行动批的 expect 由宿主核对，结果（hit/surprise/untested）进
状态消息与 `harness_state.predictions.last_review_test`——test 兑现与否从散文变成可测量事实，不加新冻结门。
③ 宿主把每次评审机械追加到 `work/review_log.md`（agent 零负担、按需 `open()` 读），同时给 work/ 通道一个
种子文件。验证：单测 39/39；真实链路 `runs/arc-layered-reviewfix-real-20261124-ls20`（本地离线、真实 bridge、
无模型）：冻结→评审→带 expect 的批→`review_test=surprise` 正确进 harness_state，scorecard 关闭。
自主采用未验证，待下次 MEL 运行。

评审直接挂载（同日第二批，MEL2 运行中第一次评审的证据：change 已是真实修订、落盘成功，但首批 RESET 被
标 untested、结论仍只有散文可达）：④ 历史评审作为数据挂进 `harness_state["reviews"]`（宿主持有、最近 5 条、
含 test_outcome），agent 代码可直接读，不再依赖 `open()`。⑤ `test` 接受可调用 `(transition) -> bool|None`
——形态 1→3 的移动：宿主侧 prelude 在每个后续动作上自动运行，失败标注在动作行，计数进
`harness_state["predictions"]["review_checks"]`。评审结论由此从散文变成活的约束核对（D3 谓词机制的
评审切片；文件级谓词与跨重启持久化仍按 §4.0 门控）。⑥ RESET 批不消耗 review_test 待检标记（GAME_OVER
评审后首批必然 RESET 的误标修正）。验证：单测 40/40；真实链路
`runs/arc-layered-reviewmount-real-20261124-ls20`：可调用 test 在动作后自动运行（`r1: 1 ok / 0 fail`），
scorecard 关闭。自主采用未验证。

评审转化协议（同日第三批，用户裁定：在 review 层挂载能力转化协议，7-pass 的收缩版——七对象从"每轮各过
一遍"降为"每次评审的落点枚举域"，固定路径保住、负担从 7 pass 降到 1 pass）：⑦ `review()` 新增必填字段
（仅当 `change != 'none'`）：`place=` 七对象之一（memory/tool/prompt/loop/context/skill/subagent）、
`artifact=` 承载结论的 work/ 文件。宿主在评审时快照该文件内容，在评审后首个真实行动批（与 review_test
同一边界）核对文件是否真的被写入/修改——只核对落地事实，不评判语义。结果进批摘要
（`review_placement`/`review_artifact`）、状态消息事件行（`Review placement: ...`）、评审记录
（`harness_state["reviews"][-1]["placed"]`）与 `work/review_log.md`（place 行）。方向规则进提示：
GAME_OVER 评审走修假设/造感知函数，过关评审走压缩（解法参数化、信念变短）。已知边界：评审前已写好、
评审后内容未变的文件会被报 unplaced（提示要求评审后写入）；敷衍落地（空文件应付核对）不惩罚，由后续
review_test 暴露。验证：单测 42/42；真实链路 `runs/arc-layered-placement-real-20261124-ls20`（本地离线、
真实 bridge、无模型）：评审声明 `place='memory', artifact='work/claims.md'` →写文件→行动批→下一调用
`harness_state["reviews"][-1]` 显示 `placed=True`，scorecard 关闭验证。自主采用未验证，归 MEL3 判定。

D3 谓词机制 + R7 常显（2026-11-25，MEL3 轨迹触发：注释假模型/33 批无 expect/散文不积累 support 分别对应
R1/R7/R3 缺执行器；按"围绕设计要点、不加 ad-hoc 补丁"的裁定实施）：⑧ `work/claims/*.py` 约定——每文件一条
可证伪规则，`check(transition) -> True/False/None`，docstring 即陈述。宿主每调用扫描 claims 目录随请求下发，
prelude 在每个执行动作的 transition 上机械执行全部谓词（与 review_checks 同点位），support/反例/出现关卡
随调用结果上报；宿主单独持有账本（agent 只读 `harness_state["claims"]`）：≥3 support 且 0 反例 → validated，
1 反例 → falsified（归档不删除），改写文件 → 重置 hypothesis；scale 由 support 关卡数算出（≥2 关 = game）。
状态跃迁回显为事件行（Claim validated/falsified）。谓词报错进账本 error 字段，不中断运行。⑨ R7 梯度常显行
（`ARC_LAYERED_GRADIENT=1`）：每条状态消息固定一行本关动作数/预算、surprises、无 expect 批数、重复路线数、
expect 命中率——数据全部来自既有 harness 计量，只是进入视野。开关：`ARC_LAYERED_CLAIMS` 默认关（消融臂），
提示 `{{?claims}}` 节约 7 行。未实现（按 §4.0 门控推迟）：import 依赖连坐（当前无任何依赖对象可连坐）、
跨局尺度（归 D4）。验证：单测 45/45；真实链路 `runs/arc-layered-claims-real-20261125-ls20`（本地离线、真实
bridge、无模型）：谓词随动作逐 transition 执行，6 support 0 反例 → validated，scorecard 关闭验证。自主采用
未验证，归 MEL4（新配置重启）判定。

### 5.4 MEL4 收割与 work/ 写入摩擦修复（2026-11-25）

MEL4（su15 本地离线、az gpt-6-luna low、MODEL+CLAIMS+GRADIENT+REVIEW(game_over,level)、65k cap）：
788 秒死于 provider idle_timeout（同因第 4 次）；33 动作、过 1 关（L1 用 20 动作 < baseline 22，首次低于
基线）、37.9 万 tokens、0 次 eviction。

**关键观测：claims 零落地的根因是 harness 摩擦，不是 agent 不采用。** 轨迹：过 L1 评审规范声明落点
（`place=memory, artifact=work/claims/click_path.py`）→ 下一调用立刻尝试写入 → `os.makedirs('work/claims')`
抛 `FileNotFoundError`（work/ 是 RPC 虚拟通道，`os` 模块直通 WASI 沙箱文件系统）→ agent 查
`harness_state['artifacts']` 为空，确信 work/ 不可用，放弃；此后宿主的"artifact 未写"提醒每轮在场但无效
（agent 已认定通道坏了）。宿主侧本无问题（写入自动建父目录）。

裁定更新：① 落点协议的激励已足够触发吸纳尝试（推翻"一局内写文件激励不足"假设），激励侧不动；
② "pending_artifacts 常驻债务"方案撤销——提醒在场且无效，不是瓶颈；③ 形态②使用计数、eviction 结算
事件行推迟——各自的先决观测（文件存在、eviction 发生）尚未出现。

修复（已实现）：prelude 包装 `os.makedirs`/`os.mkdir`，work/ 路径下为 no-op（宿主写入时自动建目录）；
系统提示 work 节 +2 行（目录自动创建、文件清单在 artifacts）。单测 46/46。provider idle 恢复按用户裁定
暂不处理。

### 5.5 MEL4b 中段观测与退化采用修正（2026-11-25）

MEL4b（makedirs 修复后重跑，同配置）运行中段：claims 写入链路首次真实闭环（两次评审两次落地）、expect
纪律显著改善（9/10 命中、SURPRISE 证伪 review test 一次）。暴露的下一层问题是**退化采用**：

- 谓词退化为散文：`gray_hazard.py` 第一版 `transition.result == "game_over"`（result 是 dict，恒 False）→
  每个 transition 都是反例 → 立即 falsified；agent 把教训理解为"让它永不可证伪"，改写成 docstring +
  `return None`。根因三个：transition 接口未在提示中文档化、None 守卫模式未示范、falsified 事件行未指出
  "通常是缺守卫"。
- `world_model.py` 敷衍 stub（predict 返回原帧、test 恒 True）且自评通过——自写 test 可被 stub 平凡满足，
  硬规则失去锚点。

修正（已实现，机制级，无新门）：① 提示 claims 节 +5 行（transition 接口、守卫先行模式）；② falsified
事件行改为归因指引（缺守卫→收窄条件，保持可执行，恒 None 不积累任何东西）；③ **宿主回测 world_model**：
R1"宿主执行谓词"延伸到能力层——宿主每调用扫描 `work/world_model.py`，prelude 在录得 transitions 上回测
`predict`，命中率进 `harness_state["model"]` 与 gradient 行；自写 test 不再是锚点，硬规则改挂宿主实测数
（恒等 predict 得分可见地低）。④ review_log 标题 null 修复。单测 47/47。自主采用/净收益待下一次运行。

### 5.6 claims 证据盲区修正：历史回测与适用性计数（2026-11-25）

MEL4b 还暴露了谓词机制的两个证据盲区。情况 A：证伪证据已经在历史里（灰格点击曾成功），但谓词只对
加载后的新 transition 前向执行，错误归因得不到历史反驳。情况 B：agent 据一条 0 证据的信念回避某类动作，
于是永远不产生能检验它的 transition——这是经验验证系统的边界，不能用数据修复，只能可见化。

修正（已实现，机制级）：① **历史回测**：宿主在 claims 账本条目新建或源码变更时随请求下发 `fresh` 标记，
prelude 对带标记的谓词立即回测全部已录 transitions（与 world_model 回测对称；内核重启重载不带标记，
不重复计数）。验证/证伪事件可在无动作的调用中发生，`acted` 相应放行。② **适用性计数**：每条 claim
记录 `checked`（执行次数，含 None），进账本与 `harness_state["claims"]`；`checked ≥ 20` 且 support+counter
为 0 时宿主发一次性事件行："一条从不适用的规则不该指导行动——设计一个它会适用的探测，或放弃它"。
③ 提示 claims 节一句规范：0 support 的 claim 仍是假设，不得作为排除一类动作的依据。单测 49/49
（真实 WASI 内核）。自主采用/净收益待 MEL4d。

## 6. 风险

- 评审冻结是最强干预，与 R6 有张力。边界：宿主只决定"何时必须评审"，不决定"评审出什么"；触发全部是
  结构性失败信号。若评审产出空洞文本，收紧的是门（test 必须随后可检验），不是加提醒。
  **工作流归属冲突的正面处理**：项目既定裁定是工作流归 agent 在运行中自己设计，宿主评审中断是包含关系
  倒置。因此 D2.1 把 review 降为默认关的实验臂——它是待检验的干预，不是架构默认；若开臂不优于关臂，
  整个冻结机制撤除而非调参。
- startup.py 全权归 agent（§3.1 代价段）：若真实运行显示垃圾进启动程序，再评估收紧为"validated 才可
  默认在场"的结构门。**出错隔离**：prelude 捕获 startup 异常、以 `[startup]` 行回显、失败不阻塞内核；
  回滚走宿主对 work/ 的 git 快照（§3.0-3）。
- **假 validated 跨关/跨局**是最常见的跨关失败来源：弱验证（阈值低、support 同质）会把错误约束带进下一关。
  缓解：R1 的 ≥3 support + 0 反例 + 升尺度需 origin 外实例；兜底：保留局评测（§4 评估协议）。不能完全消除。
- agent 自建门（形态 4）可能错卡行动：agent 可自撤 + 宿主评审门凌驾其上。**触发失效风险**：所有现有触发
  都由动作驱动，一个拦住全部动作的门不会触发任何东西。缓解：宿主增加无动作请求计数触发（连续 N 次 python
  调用 0 动作且 0 文件写入 → STUCK 措辞升级直至评审门按请求数触发）。
- claims 双写冲突：谓词化后消解——状态由宿主单独持有，agent 对 `work/claims/*.py` 的改写只会把该条目
  重置为 hypothesis（§2 状态机），不存在覆盖语义。
- 常驻体积无上限：索引、prompt.md 注入、评审修订注入各设字节上限（索引 ≤1 KB、prompt.md ≤2 KB、修订
  ≤512 B），超限截断并回显提示 agent 自行精简（重复时刻的减法信号）。
- 提示面新增约 15 行（定义/规则/不吸纳清单/评审契约），与接口收缩方向相反；对价是专用工具面归零。
