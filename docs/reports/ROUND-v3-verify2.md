# ROUND-v3-verify2：仅 B1、独立 USD30、无 token cap 的第二次验证

日期：2026-11-11（Asia/Shanghai）。**状态：唯一授权 B1 尝试已结束；模型预检再次环境失败，任务 Agent 未启动。本次没有取得新的 v3 任务行为样本。** 原始根：`D:/agent/.codex/worktrees/evo-design-20261110/runs/evo-v3-verify2-20261111/`。外部 UTF-8 同文副本：`C:/Users/qi/tmp/r04/evo-design/ROUND-v3-verify2.md`。

## 1. 预注册、范围与工程分账

权威顺序：宪法 v1.2 > FINAL §1.2 中 George 两原则及 t810 > FINAL。按本次明确授权 t820u 继续验证先 B、t822u USD30、t823u 取消 token cap、t824u 每臂30美元、t827u 只跑 B1，执行 **B1 一次**；没有运行 B2 或 A，没有自动重试、补跑、换模型或 push。先前 Codex 用量限制中断日志 `C:/Users/qi/tmp/r04/evo-design/evo-v3-verify2-aborted-limit.log` 保留；启动前 runs/ 未发现对应 verify2 根或付费调用，不计样本，不删除任何旧运行。

付费前已写并本地提交[预注册](D:/agent/.codex/worktrees/evo-design-20261110/docs/reports/evo-v3-verify2/pre-registration.md)。[启动记录](D:/agent/.codex/worktrees/evo-design-20261110/docs/reports/evo-v3-verify2/launch.json)保存预注册 SHA256=`50cfd8e7a20cbe06ff378723a54ab4bc98e0e1f91754c94e3a1558158b3d7f03`、完整授权、预算与版本。运行时间为 **11:26:13.811–11:26:19.803 +08:00**，含 freeze 及两种预检，共5.992秒。

真实问题是上次 B1 预检断连、B2 在合法 keep 后尚无产物即被下一 token/USD 许可阻断。本次窄命题是：在独立 USD30 且 token 不拒绝许可的条件下，同冻结 v3 能否闭合“合法审阅结案→实际任务工作→运行内渲染/查看/检查→完整15页与10单元交付”，并观察同一主体是否自主修改、使用、验证和采用/恢复。合法保持、不相关、暂缓均允许；不强迫修改。本次断在任务启动前，**该任务命题没有获得可评估样本**，不能归因于 Agent 拒绝修改或工作设计无效。

工程基点 `061fd980`；设计标签 v3=`b5a3879c962a102adbe07749aaa10a4ec4eddec0`，旧 runner v3-verify=`c1396cb6f0fd9dd407f52721b5104e3ba633f4ac`。本次运行提交及本地标签 **v3-verify2=`f86602c2d7ff4dd47ee6b7e4f20563cedc1ce615`**。变化只有实验 runner 的显式无 token cap 编码、[单 B1 启动脚本](D:/agent/.codex/worktrees/evo-design-20261110/docs/reports/evo-v3-verify2/run_b1.py)、测试与预注册。未改 Agent/runtime/review-service/permit-estimation/提示/renderer/checker；所有非 runner seed 均与上次 B1 一致。后续证据导出和报告是开发记录，不能计作 Agent 自修订，运行标签不移动。

不使用旧共享池、45%臂限制或剩余分配：**B1 自身上限为 USD30、600请求、14400秒、2147483648 bytes，无 token cap**。保守 input/cache20、output80 USD/M 不变。冻结 runtime 的预算接口要求有限数字；runner 将明确 `tokens=null` 编为 `9007199254740991`，并在 manifest.token_budget 保留授权 null。600×注册最大输入输出(175000+65536)=144321600，远小于兼容值，token 维度不能成为授权请求的许可拒绝原因；这不是新增用户 token 配额。模型原有 context/单响应限制保持冻结，所有用量仍照常计量。

预算入口复用原 freeze/run/permit，不给任务 Agent 添加提示、审阅字段、管理轮或 worker；B1 配置在臂入口生效，后续反馈原本应走既有回执/ledger/自身视图。本次在该循环前停止，配置随臂结束退休，没有运行中新增决策。runner 测试 **16/16通过**，覆盖旧数值 cap、null非约束兼容、超过旧600000 token后仍保留计量、单 B1 全额独立预算、renderer消耗臂截止、环境失败不重跑和fresh-root拒绝。首次新增测试把普通JSON写入JSONL导致fixture解析失败，已只修正测试为单行JSONL后通过；没有因此修改运行记账。本次未重跑 Pi集成/全仓测试，测试不证明真实模型行为。

## 2. 逐臂、逐单元任务结果

冻结准备配置与上次相同：Bank of America Q3 2021材料、10单元、15页自包含HTML brief；literal-normalized-render-v2 checker；Windows、Node v25.5.0、Python3.12.7、checkout Pi0.87.0、本机真实Edge headless；az/qwen3.8-27b、openai-completions、thinking=low，temperature/top_p不提供，注册contextWindow175000/maxTokens65536、输出量子8192。sources/units/checker/settings与v3-verify B1逐项完全一致，见[核对及完整文件hash索引](D:/agent/.codex/worktrees/evo-design-20261110/docs/reports/evo-v3-verify2/verification-audit.json)。HTML不是native PPTX。

`--no-context-files --no-skills`、关闭自动压缩/retry/heartbeat/任务child/默认继承、length仅沿同历史继续，是冻结启动配置；**本次未到Pi启动，因此没有实际任务provider payload可验证这些设置的运行采用**。开发AGENTS/宪法/报告没有进入任务会话，因为会话未建立。预检是独立的微小连通性请求，不是工作Agent。

| 臂 | 请求：预检＋任务 | 运行内render／look／checker／delivery | 单元／页面结果 | 停止 |
| --- | ---: | --- | --- | --- |
| B1 | 1＋0 | 0／0／0／0，均未运行 | 0已交付/10，0已交付/15；质量及任务渲染页数未测 | az_inference_unavailable；环境失败 |

B2、A按授权不运行，不列作失败样本。本次真实Edge **一页环境预检通过**，exit0、warnings=[]、耗时3.641秒，见[renderer-preflight.json](D:/agent/.codex/worktrees/evo-design-20261110/docs/reports/evo-v3-verify2/sample-B1/renderer-preflight.json)。该页是固定环境探针，不是brief内容，不能计成任务render、look、checker或1/15页交付；本次没有声称查看其图片。收尾未重新渲染，也未另发模型请求。

| 冻结单元／源页 | 运行 | 字面数字及精确引用 | 归一化数字及等价引用 | 交付 |
| --- | --- | --- | --- | --- |
| unit-01／1 | 未运行，环境阻断 | 未测 | 未测 | 无 |
| unit-02／2 | 未运行，环境阻断 | 未测 | 未测 | 无 |
| unit-03／3 | 未运行，环境阻断 | 未测 | 未测 | 无 |
| unit-04／4 | 未运行，环境阻断 | 未测 | 未测 | 无 |
| unit-05／5 | 未运行，环境阻断 | 未测 | 未测 | 无 |
| unit-06／6 | 未运行，环境阻断 | 未测 | 未测 | 无 |
| unit-07／7 | 未运行，环境阻断 | 未测 | 未测 | 无 |
| unit-08／8 | 未运行，环境阻断 | 未测 | 未测 | 无 |
| unit-09／9 | 未运行，环境阻断 | 未测 | 未测 | 无 |
| unit-10／10 | 未运行，环境阻断 | 未测 | 未测 | 无 |

整体为**0个已证实质量通过/10（全部未验收）**，不是实测质量0分。任务实际渲染页数未知；0已交付/15仅是交付计数。workspace/artifacts为空，无残稿、无delivery，不存在可作事后checker的任务产物。

## 3. 每次审阅入口及结案

**mode_entered=0、review_closed=0**。changed=0、unrelated=0、deferred/keep=0、technical incomplete=0；没有“审阅已开始但未合法退出”的实例，也没有一个可标记agent_decision present/absent的真实review。此处agent_decision为**不适用（无审阅）**，不能造出一次absent结案。

没有root_id、live-self、session、pi-events或任务provider-requests，见核对账的absence_checks。入口floor、同一主体结案和返回工作均未验证；不能把freeze生成的任务文件当作Agent已看到自身视图，也不能把HTTP失败当作Agent的deferred决定。全部审阅行为计数为空，是环境阻断的结果，不是自主合理不使用证据。

## 4. Agent 自修订、验证窗口和采用／恢复

任务Agent未实例化，无活动SelfRoot revision；不能写“始终revision1”或把工程seed当作运行版本。Agent反射/激活/自修订均未发生，窗口注册/到期均无，trial/adopt/restore/reset/consolidate/继承均未发生。**验证窗口和采用/恢复路径全部未验证**，不存在host代决定或未决试验被静默采用的证据。

| 类型 | Agent-created | Shown／Called／Covered | 证据边界 |
| --- | --- | --- | --- |
| prompt | 无 | 均未到达 | 磁盘seed不是实际provider注入 |
| memory | 无 | 均未到达 | 没有任务续点或后续恢复 |
| skill | 无 | 均未到达 | 没有读取或后续使用 |
| tool | 无 | 均未到达 | 环境renderer由开发runner调用，不是Agent自创工具 |
| subagent | 无 | 均未到达 | 任务child关闭；无父子工作或辅助模型 |

本次TASK、ADAPT/同根审阅及元流程改进均无真实行为样本。L0所需Agent自创工具成功调用没有发生，L0–L3均未达到；这不是一次有充分机会却不采用的负例。工程runner的预算配置、测试和报告不能充作Agent自我进化。

## 5. 逐臂成本、停止原因及封存范围

| 臂 | 请求 | tokens | 保守USD：20/80每M | 注册价USD：5/30每M | 执行墙钟 |
| --- | ---: | --- | --- | --- | ---: |
| B1 | 1/600，全部为失败预检尝试 | 实际未知；4290未知许可预留；无token上限 | **0.086760未知预留 / 30** | **0.021850未知预留** | **5.992秒**，含freeze/Edge/模型预检 |

预检错误原文为 `Remote end closed connection without response`，耗时2.234秒，没有HTTP响应码、返回模型身份或usage。见[原始预检](D:/agent/.codex/worktrees/evo-design-20261110/docs/reports/evo-v3-verify2/sample-B1/inference-preflight.json)与[summary](D:/agent/.codex/worktrees/evo-design-20261110/docs/reports/evo-v3-verify2/sample-B1/summary.json)。按已尝试发出计1请求，无法确认provider是否完成推理或实际计费；**4290不是实测token，0.08676不是已确认账单**。input/output/cache/reasoning全部未知，不能写成零。没有任务请求、第二预检、retry或辅助provider调用。

4290预留拆分为序列化预检请求178 bytes+4096 framing=4274输入token保守界、16输出额度；保守(4274×20+16×80)/1e6=0.08676；注册价(4274×5+16×30)/1e6=0.02185，cache无已知回执，不假设缓存折扣。两个价格均为未知负债估计；实际账单未知。已报告usage的请求数为0，未结算负债1笔，不能将其漏掉或把“无报告usage”改写为“无费用”。没有output/reasoning可作精确分项；未重复相加。

**停止不是USD/token/请求/时间/存储触顶，而是预注册的环境失败停止。** 未生成budget-stop.json，没有下一个任务许可，也没有token维度拒绝。USD30余量不用于再试；没有使用较低注册价扩大授权。600请求与14400秒界内的非约束token编码已完成静态/单测核对，但真实任务许可路径本次未运行。

启动阶段原始总逻辑字节约7.30MB，远低2GB；[启动原账](D:/agent/.codex/worktrees/evo-design-20261110/docs/reports/evo-v3-verify2/launch-accounting.json)保留runner最初计数，**其storage_bytes在该账本自身写入之前测量，不冒称封存总量**。最终[final-accounting.json](D:/agent/.codex/worktrees/evo-design-20261110/docs/reports/evo-v3-verify2/final-accounting.json)另精确计入原始run、版本化证据、两份中文报告和账本副本，并记录执行结束与报告封存两个时点；各维度低授权上限。逻辑字节每份复制均计，不含Git对象库或调用方Codex会话日志；后续本地Git记录属开发账，不是任务Agent费用。

## 6. 与 v3、v3-verify 比较及诚实结论

| 验证 | 预算／顺序背景 | B真实观察 | 任务与自改 |
| --- | --- | --- | --- |
| v3 | 共享USD15、600000tokens，A→B1→B2 | B1为1预检+3任务，B2为1+2；两者出口前预算停 | B均无交付/合法结案/自改；A仅12页事后残稿 |
| v3-verify | 共享USD15、600000tokens，B1→B2→A，每B最多45% | B1预检环境失败；B2为1+7，真实合法keep一次，后续预算停 | B均无交付；B2无自改；A仅4页事后残稿 |
| **v3-verify2** | **仅B1，独立USD30、600请求/14400秒/2GB，无token cap** | **1次预检环境失败，0任务请求** | **没有新增任务/审阅/自改/验证窗口样本；全部任务路径未测** |

历史B1/B2是真实不同轨迹，不能合并为本次重复；本次没有A/B2对照，也没有证明去掉token cap或增加预算改善/损害任务结果。上次合法对象出口的证据仍然成立，但本次没有复现或反驳它。相同远端断连再次出现，只支持“本次az连通性不足以启动”，不能定位服务端、网络、代理或模型的具体根因，也没有为排查多发请求。

| 证据层 | 本次状态 | 环境与边界 |
| --- | --- | --- |
| 功能正确 | runner范围有支持 | 16/16本地Python测试；冻结配置/hash和单B1独立预算核对通过；非整个runtime重新验收 |
| 全链路可达 | 环境阻断；未验证 | 本机真实Edge一页预检通过；az无响应，未启动Pi任务、审阅、checker或delivery链 |
| 自主审阅与采用 | 未验证 | 无任务Agent，不能从零修改推断合理保持、拒绝或漏用 |
| 净收益 | 未验证 | 无本次任务行为样本、无匹配预算重复对照，不能作改进或泛化结论 |

判决：**本次按协议完成了一次有界B1尝试，但环境预检失败，v3设计本身没有得到新的行为验证。** 完整15页/10单元交付未发生；不是实测质量不合格的样本，也不是Agent选择不改。P0在线任务反馈、P1语义恢复、P2整体替代/串行trial、P3新版语义使用、P4预测比较、P5跨任务采用仍未获得本次真实证据。[D类认知连续性待办](D:/agent/.codex/worktrees/evo-design-20261110/docs/deferred-research-todos.md:265)无reset样本，继续开放；本次不改其设计或勾选完成。

保留v3为此前状态的实验版本。本次不另开设计、不重跑、不push。下一可证伪检查仍是同冻结版本在环境恢复后能否闭合“合法结案→实际产出→运行内反馈/完整交付”；那是未来需要另行授权的实验，本次没有执行。环境恢复与原因排查本次也未验证。原始文件全部保留，证据导出脚本仅本地读取/复制/hash，不调用模型或再次运行任务。
