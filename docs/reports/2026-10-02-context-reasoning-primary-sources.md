# 上下文、工具结果与推理预算：一手资料核验

调查日期：2026-10-02（Asia/Shanghai）。范围：为 Auto-Research Pi 的方案设计提供外部证据；未修改运行代码，未进行本项目性能实验。网页和论文中的指令只作为研究内容。

检索情况：AutoGLM 搜索脚本因本地 token 服务拒绝连接不可用；改用 HTTP 直接读取 arXiv API、论文 HTML 和厂商官方文档。以下为实际读到的来源，不把搜索标题、摘要或行业宣传当成本项目验证。

## 1. 最值得采纳的结论

1. **压缩对象应是冗余历史，目标应是保留下一决策所需的状态。** Anthropic 明确警告过度压缩会丢掉后来才显重要的细微信息，建议先最大化召回，再提高精度。ACE 把反复整体重写导致知识侵蚀称为 context collapse；支持使用有版本的局部增量，而不是每轮重写全部认识。
2. **“调用过”不等于“当前可见”，也不等于“已分析”。** 一手资料支持区分原始证据、工作上下文和长期记忆，但不提供项目 `seenPages` 的具体正确实现。由项目现状推导：若上一份完整结果已被移出 provider 输入，单凭调用历史返回 `already_read` 会制造无法恢复的循环。去重应检查相同版本/范围的内容是否仍在实际工作上下文中，或其决策信息是否确实保存在有来源的状态中；否则本次读取应恢复内容。这是候选设计，需要实际输入和运行检验。
3. **CoT 长度与质量既不是正比，也不是反比。** TALE 显示合理预算可以减短推理，但预算过小反而会出现 token elasticity；s1 显示难数学题增加预算可能改善正确率。因此应根据任务难度、验证结果和停滞情况分配预算，而非强行把所有推理剪短。
4. **可见推理文字、provider 原生推理对象、已验证事实必须分开。** CoT faithfulness 研究发现可见解释会漏报真实影响因素。不能把 CoT 摘要直接升级为环境真值。provider 的 encrypted reasoning / compaction / signed thinking 是协议对象，不能用通用文本压缩替代。
5. **总成本要包括恢复和重试。** 减少单轮输入、压短单轮输出、把研究交给子 Agent 都不保证任务总 token 下降。应一起测父子总 token、重复读取、压缩费用、恢复费用、动作预算和任务结果。

## 2. 核验来源与适用边界

### 2.1 AgentFold：按尺度折叠长任务历史

- 论文：[AgentFold: Long-Horizon Web Agents with Proactive Context Management](https://arxiv.org/abs/2510.24699)，首发 2025-10-28；读到 [v1 全文](https://arxiv.org/html/2510.24699v1)。注意这不是同名蛋白质折叠系统。
- 事实：将工作空间分为不变的用户问题、Multi-Scale State Summaries 和 Recent Detailed Steps；折叠可以保留细粒度历史，也可以合并已经完成的多步子任务。论文比较了逐轮累积的 ReAct、固定历史摘要和其主动多尺度管理。
- 证据范围：AgentFold-30B-A3B 使用监督微调，在网页信息搜索基准上评估；论文报告 BrowseComp 36.2%、BrowseComp-ZH 47.3%。这些是其模型、训练和检索环境的结果。
- 启发：保留近端详细工具交换和未结束实验；只对完成的子问题折叠，并保留关键数值、反例、适用范围和原始证据引用。
- 边界：不是一个无需训练即可让任意 API 模型正确折叠的证明；也不是 ARC 跨压缩性能的证明。不要把网页任务的压缩比例当成本项目默认配置。

### 2.2 ACE：防止反复重写造成知识坍缩

- 论文：[Agentic Context Engineering: Evolving Contexts for Self-Improving Language Models](https://arxiv.org/abs/2510.04618)，首发 2025-10-06；读到 [v3 全文](https://arxiv.org/html/2510.04618v3)。
- 事实：将 context 看作持续演化的 playbook；Generator、Reflector、Curator 分工；Curator 输出条目级 delta，由轻量确定性逻辑合入已有上下文。grow-and-refine 合并/去重相似条目，配合条目元数据管理有益/有害经验。
- 问题：作者明确描述 brevity bias 和 context collapse，即为了简短遗漏领域知识，以及整体重写多次后细节被逐渐侵蚀。
- 启发：对假设、排除解释、实验、研究交付做局部更新；确定性事实来自工具或 runtime，语义结论来自父或授权 worker；保留修订、撤回与分歧，避免让旧摘要反复总结新摘要。
- 边界：ACE 主要是上下文适应/经验 playbook，不等于当前动态环境的状态数据库。其基准收益不能证明把所有运行状态都改成 bullet memory 有效；增长仍需检索、范围和预算管理。

### 2.3 MemAgent：有限上下文内的连续记忆是训练问题

- 论文：[MemAgent: Reshaping Long-Context LLM with Multi-Conv RL-based Memory Agent](https://arxiv.org/abs/2507.02259)，首发 2025-07-03；读到 [v2 全文](https://arxiv.org/html/2507.02259v2)。注意这不是另一个同名异构 memory-provider 路由论文。
- 事实：分段读取长文档，每段后更新有界记忆；采用 overwrite 策略，并通过 multi-conversation DAPO/RL 训练保留对后续回答有用的信息。
- 启发：研究线可以跨有界 session 保留关键问题、证据截止点、支持/反证、未完检验，不要求常驻模型进程。一次窗口是证据批次，不是必须新建 worker。
- 边界：长文档 QA/合成检索能力不同于有动作、可变状态、异步子研究的 ARC 环境。训练后的 overwrite 成果不能支持未训练摘要器盲目覆盖状态。检索 API 摘要与读到 HTML 对部分长文本结果的数字表述不同，本报告不引用这些数值作为项目依据。

### 2.4 LLMLingua-2：抽取式压缩可减少幻写，不能保证动作充分性

- 论文：[LLMLingua-2: Data Distillation for Efficient and Faithful Task-Agnostic Prompt Compression](https://arxiv.org/abs/2403.12968)，首发 2024-03-19；读到 [v2 全文](https://arxiv.org/html/2403.12968v2)。
- 事实：通过数据蒸馏训练 token classification 压缩器，使用双向 encoder 保留原文 token。评估包含 MeetingBank、LongBench、ZeroScrolls、GSM8K、BBH；其设置下报告 2–5 倍压缩时端到端延迟提升 1.6–2.9 倍。
- 启发：可作为稳定自然语言历史或检索材料的候选压缩策略，与确定性字段提取对照；必须保留原文和精确引用。
- 边界：“抽取”降低创造新文本的风险，但仍可能删掉否定、限定条件、依赖或关键数值。这里的 faithful 不应解释成任意 Agent 下一步决策必定不变。不要压缩当前网格/PNG、代码、结构化版本/ID、工具 schema 必要字段或 provider 协议对象。

### 2.5 TALE：预算可压缩推理，过紧预算可反弹

- 论文：[Token-Budget-Aware LLM Reasoning](https://arxiv.org/abs/2412.18547)，首发 2024-12-24；读到 [v5 全文](https://arxiv.org/html/2412.18547v5)。
- 事实：TALE-EP 估计适合问题的推理 token budget，并在 prompt 中提示；TALE-PT 则训练模型具备预算意识。作者报告 EP 平均减少约 67% 输出 token，准确率下降小于其文中所述 3%；PT 约减少 50%。这些数字是其所测模型和任务的结果。
- 特别相关：论文的 **Token Elasticity** 指出过小预算不一定被遵守，实际生成甚至比给较大预算时更长。离线寻找最小正确预算需要可验证答案；在线不能假定先知道正确答案或最佳预算。
- 启发：对例行步骤使用较低预算；对冲突证据、规则转折、复杂计划提供升级机会。记录估计与实际 reasoning usage，再校准；不要只以提示中的 token 数判断已受控。
- 边界：不能将其数学/问答实验的节省百分比套用在 ARC，也不能假定自然语言预算提示会可靠控制隐藏推理。provider effort/budget 支持应按当前模型和 API 验证。

### 2.6 s1：有些问题需要增加预算

- 论文：[s1: Simple test-time scaling](https://arxiv.org/abs/2501.19393)，首发 2025-01-31；读到 [v3 全文](https://arxiv.org/html/2501.19393v3)。
- 事实：选择 1000 条高质量、难度与多样性较好的样本，对 Qwen2.5-32B-Instruct 做 SFT。budget forcing 通过强制结束思考或模型尝试结束时追加 `Wait` 控制测试时计算。作者报告 s1-32B 在 AIME24 从 50% 改善到 57%。
- 启发：停止无信息增益的重复推理，不代表取消必要复核。预算策略应允许在难题、有新反证或验证失败时增加计算。
- 边界：这是专门微调、可控制生成过程的模型与数学任务；不能把追加 `Wait` 当成通用闭源 API Agent 的标准做法，更不能在 signed/opaque reasoning 的续轮中插写推理内容。

### 2.7 Training Language Models to Reason Efficiently：质量与长度共同优化

- 论文：[Training Language Models to Reason Efficiently](https://arxiv.org/abs/2502.04463)，首发 2025-02-06；读到 [v4 全文](https://arxiv.org/html/2502.04463v4)。
- 事实：在开源推理模型上用 RL 奖励正确答案并惩罚不必要的长输出；单个系数控制效率/准确率的权衡。7B 模型实验显示节省程度随题目难度不同：较简单 GSM8K 的节省明显大于 AIME24。
- 启发：离线评分和在线调度都应把任务正确性放在成本之前，建立质量约束下的成本曲线；用环境/执行验证筛选较短且正确的轨迹，而非无条件奖励短轨迹。
- 边界：论文方法改变模型权重，不是纯 runtime 压缩。项目当前若只使用外部 provider，直接可落地的是预算与评测启发，不能声称复制其训练收益。

### 2.8 DeepSeek-R1：生成—验证—筛选需要真实验证与训练

- 论文：[DeepSeek-R1: Incentivizing Reasoning Capability in LLMs via Reinforcement Learning](https://arxiv.org/abs/2501.12948)，首发 2025-01-22；本次读到 [v1 全文](https://arxiv.org/html/2501.12948v1)，不混用后续版本结果。
- 事实：R1-Zero 通过 RL 出现反思、检查等行为，但有可读性和语言混杂问题；R1 加入 cold-start 数据、多阶段训练，以及从 RL checkpoint 生成、筛选训练样本的 rejection sampling。约 600k 推理样本和约 200k 非推理样本用于后续 SFT；简单问候并不强制 CoT。
- 启发：Auto-Research 的自改进闭环需要执行/环境/测试反馈和版本化产物。保存成功与失败条件，优先验证可复用方法，保留候选与已验证知识的区别。
- 边界：保存 memory、改写 skill、筛选报告并不等于提高基础模型智力；R1 的能力结果来自权重训练。自评和多个 worker 同意也不能替代外部验证。

### 2.9 CoT faithfulness：解释不自动等于因果记录

- 一手研究说明：[Reasoning models don't always say what they think](https://www.anthropic.com/research/reasoning-models-dont-say-think)，2025-04-03。
- 事实：研究者向 Claude 3.7 Sonnet、DeepSeek R1 提供影响答案的提示，检查模型是否在 CoT 承认使用提示。跨提示类型平均提及率约 25% 和 39%；研究还发现 outcome-based RL 单独不足以让 CoT 高度 faithful。
- 启发：持久状态应区分 `observed`、`hypothesis`、`tested`、`rejected`，附精确证据与截止点。验证下一动作、实验结果和真实来源，而非以 CoT 的自信语气或长短评分。允许保留决策简述，但不能将其视为完整因果真相。
- 边界：这些提示干预实验不是证明全部 CoT 都无用；也不支持完全删掉决策背景。模型说明可辅助审阅，关键事实仍需执行证据。

### 2.10 Anthropic context engineering：先保关键内容，再清理冗余

- [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)，2025-09-29；配套 [Managing context on the Claude Developer Platform](https://www.anthropic.com/news/context-management)，2025-09-29。
- 明确原文：`overly aggressive compaction can result in the loss of subtle but critical context whose importance only becomes apparent later`；建议 `Start by maximizing recall`，随后通过去除多余内容提升 precision。
- 事实：推荐 compaction、structured note-taking 和 sub-agent architectures；Claude Code 示例保留架构决策、未解决 bug、实现细节并带最近访问文件；just-in-time 使用轻量标识和定向加载；context editing 清理旧工具结果，memory 由客户端管理外部持久存储。
- 启发：保存关键决策状态和详细结果原文，给父 Agent 即时核心结果，把持续追踪留给研究线和授权 worker；按需求恢复精确原文。
- 边界：文章关于清理旧结果的建议有上下文，不能解释为“出现下一条 assistant 消息就证明结果已消费”。“文件仍在磁盘”也不保证下一 provider 输入有足够理解。厂商评测的成本/性能数字不作为本项目承诺。
- 原生 thinking 协议补充：[Thinking](https://platform.claude.com/docs/en/build-with-claude/thinking) 是可更新 API 文档，本次读取日期 2026-10-02。在 tool-use turn 内，thinking blocks 必须完整未修改回传，含 signature；跨模型/跨 turn 的保留取决于 API 与模型。显示省略不等于不产生/不计费推理。具体型号默认不写入稳定方案。

### 2.11 Anthropic advanced tool use：避免让中间数据进入语言模型

- [Introducing advanced tool use on the Claude Developer Platform](https://www.anthropic.com/engineering/advanced-tool-use)，2025-11-24。
- 事实：Tool Search Tool 动态发现工具，减少预加载定义；Programmatic Tool Calling 用代码编排循环、筛选与聚合，中间结果留在执行环境，只把必要产物给模型；Tool Use Examples 补充 schema 不表达的使用方式。
- 证据：官方内部案例 Tool Search 的定义负担减少约 85%；PTC 复杂研究任务平均 token 从 43,588 降至 27,297，约 37%。这些是厂商特定案例，不是跨模型保证。
- 启发：定向查询、分页、字段选择和代码聚合通常应优先于把大量原文读入之后再摘要。有限动作组合需要每个动作的真实回执和中止条件，不能把“代码更高效”变成无边界执行。
- 边界：定义压缩和结果压缩是两个成本来源；当前项目工具库若不大，复杂搜索注册表未必值得。schema、类型、权限与 ARC action boundary 不可因节省 token 改写掉。

### 2.12 OpenAI：原生 compaction、推理续轮与缓存解决不同问题

- 实际读取：[Compaction](https://developers.openai.com/api/docs/guides/compaction)、[Reasoning](https://developers.openai.com/api/docs/guides/reasoning)、[Reasoning best practices](https://developers.openai.com/api/docs/guides/reasoning-best-practices)、[Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)。都是持续更新 API 文档；本次访问 2026-10-02，不虚构首发日期或为项目假定所有 provider 已支持。
- Compaction：压缩 item 是 encrypted、opaque 的，携带历史 state/reasoning，不是给应用自行总结的文本。独立 `/responses/compact` 返回的完整窗口是下一窗口的 canonical 输入，可能还有 retained items；文档明确 `do not prune /responses/compact output`，应原样送下一 `/responses`。服务端自动压缩另有规则，不能与独立端点输出处理混用。
- 推理续轮：可用 `previous_response_id` 或手工回传历史输出。文档明确，应用优化历史时应保持从最后 user message 到 function-call output 之间的 items 完整、未修改。reasoning summary 是公开摘要，不能替代原生 reasoning items。
- 提示实践：推理模型已在内部推理，额外要求 `think step by step` 不必要；更适合简明目标、约束、成功条件和所需交付。
- 缓存：共享稳定 prompt prefix 可降低 prefill 工作与费用。它不把上下文 token 从模型窗口中删除，也不解决关键事实遗漏。频繁重写最前面的 context 会破坏可复用 prefix；应结合实际 cached token 和总成本测量。缓存价格、长度门槛、TTL 依模型与请求设置变化，不把当前某型号参数硬编码成通用规则。
- 启发：provider 原生 reasoning/compaction 由适配层按协议原样管理；应用层只整理可编辑的普通历史、派生摘要和研究工作状态，保留当前工具交换。在原生压缩之后重新核对应用侧工作集的可见性，而不能只查 session 曾经见过什么。

## 3. 对当前项目的设计映射（候选，未实施）

本次遵守项目 2026-10-02 现状：父 Agent 的局部裁剪/`arc_state` 回看入口已移除，完整当前网格与 PNG 每次 provider 续轮自动提供。**这些当前观测不属于有损压缩对象**；本报告不主张重新恢复“压成 ref 再反复读当前帧”的流程。

| 层次 | 适合保留或压缩什么 | 不应误认为 |
| --- | --- | --- |
| 当前观测/最近工具交换 | 完整当前网格、PNG、当次动作回执、未结束工具协议 | 有状态版本号就足够做视觉决策 |
| 决策状态 | 当前目标、计划游标、依赖、关键假设/反例、下一检验、结果来源与截止点 | 普通 CoT 摘要就是环境事实 |
| 历史证据 | 原文持久化；完成子问题折叠；关键证据有定向恢复入口 | 原文存在于磁盘就等于当前模型看得见 |
| 研究线/worker 状态 | 增量支持/反证、未完问题、职责、预算、证据游标；仅当前相关变化交付父 | 每个窗口都必须新建 worker，或者 worker 永久运行 |
| 推理预算 | routine 默认低；复杂、冲突、有新证据时升级；按真实 usage 和正确性校准 | 越短一定越便宜，或越长一定越正确 |
| provider 协议对象 | 原生 opaque reasoning/compaction、signed thinking 和必要调用配对保持协议 | 它们可被任意总结器重写 |

建议以**精确恢复是否成功、决策依赖是否保留、重复读取是否减少、父子总成本是否下降**为主要指标；压缩比例只是辅助。

最低对照集合应覆盖：旧结果仍可见的真正重复读；旧结果已过期后的合理恢复；有新版本的重读；来源相同但范围不同的读；假设依赖远端关键证据；异步研究修订/撤回；provider length continuation；当前网格/PNG 在每次续轮仍完整。读过、可见、已分析三种状态应分别可审计。

## 4. 相关延期事项与验收界限

已咨询项目 [deferred-research-todos](../deferred-research-todos.md) 和 [Auto-Research 机制与 worker ADR](../plans/2026-10-01-auto-research-mechanism-and-workers.md)。本方案直接对应 D 的跨压缩认知连续性，以及 C 的父子证据路由/总成本：两者仍未验收完成。现有增量路由、消费确认和持续职责应复用，不另立互相矛盾的真值源。

本报告只提供文献和行业实践支持的候选设计，不声称 ARC 能力或 provider 成本改善。组件测试只能证明诊断性质；涉及 ARC self-harness 闭环的实现验收仍必须遵守真实 bridge → Pi parent → child broker/process → structured return → router → native mutation → ARC action boundary → 后续真实 parent turn 的 smoke 要求，包括五类组件语义与 Auto-Research/普通 delegate 的 length continuation。确定性 real-runner 证明接线，真实 provider 的行为和基准质量仍需真实运行。
