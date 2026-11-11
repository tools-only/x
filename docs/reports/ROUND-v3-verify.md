# ROUND-v3-verify：B 优先的 v3 单次验证

日期：2026-11-11（Asia/Shanghai）。**状态：授权单次验证已结束，任务交付未通过；新增一条真实合法 keep 出口证据，自进化及净收益仍未验收。** 外部 UTF-8 副本：`C:/Users/qi/tmp/r04/evo-design/ROUND-v3-verify.md`。证据链接使用工作树绝对路径，外部副本可同样复核；原始根为 `D:/agent/.codex/worktrees/evo-design-20261110/runs/evo-v3-verify-20261111/`。

## 1. 预注册、范围与工程分账

权威顺序：宪法 v1.2 > FINAL §1.2 的 George 两原则及 t810 > FINAL。本次依 George t820u“continue validating, run B first”进行一次真实付费验证。不是第四轮设计，不改 Agent/runtime/review-service/permit，不 push。运行前冻结的完整协议见 [pre-registration.md](D:/agent/.codex/worktrees/evo-design-20261110/docs/reports/evo-v3-verify/pre-registration.md)；启动时点、预注册 hash、精确提交与计划见 [launch.json](D:/agent/.codex/worktrees/evo-design-20261110/docs/reports/evo-v3-verify/launch.json)。

实际失败背景为 v3 A 先占大部分额度，使两个 B 都未到合法出口。本次窄命题是先给 B 独立有界暴露，观察其合法结案、工作、自修订和交付；只改变实验顺序及各臂上限。合法不改是允许结果；技术 incomplete 不冒充保持决定。没有给任务 Agent 增加提示、字段、审阅义务或 worker；新增运行中父模型管理决策为零。调度在各臂入口生效，之后沿 v3 自身视图、工具回执和任务事实回流；臂结束后配置不再产生任务义务。

运行顺序 **B1→B2→A**，各一次，独立空任务产物、相同种子，不自动继承。总 cap 为 **600 请求、600000 tokens、14400 秒、USD15、2147483648 bytes**。B1/B2 各最多 **270 请求、270000 tokens、6480 秒、USD6.75、966367641 bytes**；A 使用实际总余额，不再应用旧 A 校准起点。所有预检、失败、pending 计入；任一许可不足即停，不提高 cap、不调整 v3 保守估算，不重跑失败臂。冻结和 Edge 预检消耗对应臂墙钟。总账含编排起点至结果封存，开发账另列。

环境冻结为 Windows、Node v25.5.0、Python3.12.7、Pi0.87.0、真实本机 Edge headless；**az/qwen3.8-27b、openai-completions、thinking=low**，temperature/top_p 未提供。注册 contextWindow175000、maxTokens65536；实际输出量子8192。同一 Bank of America Q3 2021 材料、15页自包含 HTML brief、10冻结单元和 literal-normalized-render-v2 checker。`--no-context-files --no-skills`，heartbeat/自动retry/自动压缩/任务child/默认继承均关闭；length 只沿原历史续接。HTML 不等于 native PPTX。A 自主读取的是 prepare 生成的任务 workspace/AGENTS.md，不是仓库开发 AGENTS.md。

工程基点 `v3^{commit}=b5a3879c962a102adbe07749aaa10a4ec4eddec0`；运行提交及本地标签 **v3-verify=`c1396cb6f0fd9dd407f52721b5104e3ba633f4ac`**。仅实验 runner 的 run_round 支持显式 B1/B2/A 阶段、每 B 45% 上限和包含 freeze 的臂截止；附测试和预注册/启动脚本。runner 测试 **13/13** 通过，覆盖顺序、每维45%拒绝、A真实余量、时间/存储扣除与旧计划兼容；首次测试的 Windows CRLF 字节预期错误已在测试中修正，未改运行记账。测试证明调度功能，不代替真实行为。

## 2. 逐臂、逐单元任务结果

B1 模型预检远端关闭连接，未启动任务 Agent，是环境失败。B2 的任务调用到达真实 provider，完成一次合法 keep，但未产生文件；首个工作响应用满8192输出且全为reasoning，下一请求许可被拒。

| 臂／实际顺序 | 请求：预检＋任务 | 运行内 render／look／checker／delivery | 运行内结果 | 实际停止 |
| --- | ---: | --- | --- | --- |
| B1／1 | 1＋0 | 均未运行 | 0已交付/10单元、0已交付/15页；单元质量与渲染页数未测 | az_inference_unavailable：预检远端断连，环境失败 |
| B2／2 | 1＋7 | 0／0／0／0 | 0已交付/10、0已交付/15；无文件，质量与页数未测 | budget_or_integrity_stop：臂tokens及USD下一许可不足 |
| A／3 | 1＋9 | 0／0／0／0 | 0已交付/10、0已交付/15；25276-byte残稿，运行内质量与页数未测 | budget_or_integrity_stop：实际总余额tokens及USD下一许可不足 |

三次真实 Edge **一页预检**均通过，属于环境诊断，不能填进上表任务 render/look。A 的原始调用为 read5、ls3、write2、edit1；write2中一次因length被执行器拒绝，另一次写成功，edit1成功，不能算两次成功写入。9个任务响应中4次toolUse、5次length：前四次length为纯8192 reasoning，第五次为7334 reasoning及被截断write。随后真实完整write和edit形成四页残稿。没有office/acceptance/submit_unit调用，也没有被隐藏的运行内检查。B2原始调用为read5、ls2、read_self2、read_self_component1、decide2，无工具错误。

依预注册，仅对A残稿在独立posthoc目录复制后，用**同一真实Edge和冻结checker**测量一次，耗时9.204秒；没有再发provider请求，不回流已结束Agent。实际 **4/15页**、renderer exit0、warnings=[]、源hash=`e4aec7485b434fd10419e0dae240cfca9ddd67d80a5407442ec2aec4d4632000`。已看[联系图](D:/agent/.codex/worktrees/evo-design-20261110/docs/reports/evo-v3-verify/calibration-A/posthoc-contact-sheet.png)，四页非空，封面后为财务概况、业务分部及利润表内容；未据缩略图认定数字归属、字体、叙事或审美全面合格。见[残稿](D:/agent/.codex/worktrees/evo-design-20261110/docs/reports/evo-v3-verify/calibration-A/partial.html)及[完整事后事实](D:/agent/.codex/worktrees/evo-design-20261110/docs/reports/evo-v3-verify/calibration-A/posthoc-acceptance.json)。

以下“字面/归一化”均是**A事后**数字命中；后两列为字面精确引用/归一化引用。B1十单元均未运行、B2十单元均未交付未测；A十单元运行内也均未交付未测，不能把事后命中冒充交付或语义通过。

| 冻结单元／源页 | A事后字面数字 | A事后归一化数字 | 精确引用／等价引用 | B1 | B2 |
| --- | ---: | ---: | --- | --- | --- |
| unit-01／1 | 3/3 | 3/3 | 无／有 | 未运行未测 | 未交付未测 |
| unit-02／2 | 3/3 | 3/3 | 有／有 | 未运行未测 | 未交付未测 |
| unit-03／3 | 0/3 | 0/3 | 无／无 | 未运行未测 | 未交付未测 |
| unit-04／4 | 0/3 | 0/3 | 无／无 | 未运行未测 | 未交付未测 |
| unit-05／5 | 0/3 | 0/3 | 无／无 | 未运行未测 | 未交付未测 |
| unit-06／6 | 0/3 | 0/3 | 无／无 | 未运行未测 | 未交付未测 |
| unit-07／7 | 0/3 | 0/3 | 无／无 | 未运行未测 | 未交付未测 |
| unit-08／8 | 1/3 | 0/3 | 无／无 | 未运行未测 | 未交付未测 |
| unit-09／9 | 0/3 | 0/3 | 无／无 | 未运行未测 | 未交付未测 |
| unit-10／10 | 0/3 | 0/3 | 无／有 | 未运行未测 | 未交付未测 |
| 合计 | 7/30 | 6/30 | 1/10／3/10 | 未测 | 未测 |

checker提供事实，没有总语义pass字段。沿预注册字面数字全中且精确引用的窄口径，A**事后**为1/10单元；归一化数字全中且等价引用为2/10，另列不替代主口径。运行内三臂均为**0个已证实质量通过/10（均未验收）**，不能说实测质量得0分。A事后4/15页不满足15页交付；整个brief目标本次未达成。所有源文件、单位、checker、模型设置与各自v3臂manifest完全一致；唯一seed差异是实验runner，结束时全部seed无漂移，见[核对账](D:/agent/.codex/worktrees/evo-design-20261110/docs/reports/evo-v3-verify/verification-audit.json)。

## 3. 每次模式审阅及结案

B1 没有 SelfRoot 或模式入口；A 是旧比较路径，SelfRoot 审阅不适用。B2 root_id=`443ab7e8-8f93-410f-9606-731f034ac83c`。下表包含全部 mode_entered；execute 模式事务也照实列出，不把它另算一次 reflect 审阅。

| B2入口 | 原始触发与实际行为 | 结案 | agent_decision |
| --- | --- | --- | --- |
| ledger:2；review:ledger:0；request0；reflect | 用户window_entry。读取任务instructions/environment/material，自身policy、ledger及ppt_baseline_guidance。request6提交对象result，保留现有方法；引用ledger:2/3 | ledger:46，deferred/keep，changes=[]；工具成功并返回execute | present |
| ledger:48；review:ledger:47；request6；execute | Agent在同一响应额外调用decide(enter_mode=execute)。request7只有8192 reasoning，无工具/文件 | ledger:58，deferred/incomplete，plain-text/technical end without decide exit | absent |
| ledger:60；review:ledger:59；request7；reflect | 用户before_session_end。已进入账本；下一请求边界拒绝许可，**没有发出该审阅的provider请求** | ledger:62，deferred/incomplete，authorized budget boundary | absent |

合法 keep 的理由是干净起点、baseline prompt与单agent work结构适合当前15页任务。对象result通过真实schema和执行入口，后续request7确在execute。它是自主选择保持的一条真实证据；入口由用户契约强制，不称自主发现审阅时机。引用只指向入口/首次输入事实，无任务比较结果，不能凭“无需改”文字认定已充分审阅完整架构，更不能认定该保持决策产生收益。changed=0、unrelated=0、合法deferred/keep=1、技术incomplete=2；三者不能合并成3次自主结案。

## 4. Agent 自修订、验证窗口和组件生命周期

B1 未启动；B2 self_revision始终1，reflection_activated=0，reflect_component/reflect_orchestration调用均为0，windows=[]。B2和A的legacy_self_revision=2来自runtime种子，不能算Agent自改；A也无反射调用。没有验证窗口创建或到期，没有trial/adopt/restore、reset、consolidate或继承；这些路径本次未验证。A的任务HTML写入和编辑不属于自身反射。工程runner提交也不是Agent运行修订。

B2读取了种子prompt（read_self_component成功），它可见并被读取；没有Agent创建的新prompt/memory/skill/tool/subagent，也没有新版装配和后续使用可追踪。无独立reviewer或更强模型进入运行。L0所需的Agent自创tool成功调用未发生，L0–L3均未达到，不能用种子读取或合法keep替代。

## 5. 成本、停止与环境

| 臂 | 请求 | 入账tokens | 保守USD（input/cache20、output80/M） | 注册价USD（input5、output30、cacheRead0/M） | runner秒（含模型预检） |
| --- | ---: | ---: | ---: | --- | ---: |
| B1 | 1 | 4290未知预留 | 0.08676未知预留 | 未知；同一许可按注册价预留0.021850 | 15.078 |
| B2 | 8 | 166486已报告 | 4.07702 | 1.143805 | 366.390 |
| A | 10 | 278060已报告 | 8.59342 | 2.546205 | 1090.281 |
| 总计 | **19/600** | **448836/600000** | **12.75720/15** | **已报告3.690010＋未知预留0.021850＝3.711860估计** | 编排连续墙钟1478.883 |

注册价不是账单；不使用较低价扩大授权。已报告总tokens444546，另有B1未知4290；任务input359972、cacheRead21504、output62960，reasoning52144已含在output，不重复加；两个成功预检共110tokens。任务请求未知为0，唯一未知是B1预检。没有child/provider辅助模型，以上已含全部父模型与预检；费用不把缺失回执记成零。

每臂renderer预检耗时B1=3.078、B2=1.032、A=2.468秒，未包含在表中runner秒，已包含总编排墙钟和臂截止。以臂目录创建到summary写入的文件时间交叉核对，臂墙钟约18.267、367.579、1092.889秒；两B均远低6480秒。原始臂目录最终逻辑字节分别7298820、9293683、9709925，两B均低于966367641；完整总存储另计posthoc、证据及报告副本，见最终账的storage_scope。事后renderer/checker零provider请求，时间计入总账。最终封存墙钟/存储及精确计量范围以[final-accounting.json](D:/agent/.codex/worktrees/evo-design-20261110/docs/reports/evo-v3-verify/final-accounting.json)为准，各维度均低原cap。

B1远端错误为 `Remote end closed connection without response`；预检已尝试发出、无HTTP响应/模型身份/usage，保留原4290tokens、USD0.08676保守许可负债，不记成零，也不认定实际已计费这些数。

B2下一请求被拒时，已结算含预检166486tokens、USD4.07702，臂余量103514tokens、USD2.67298；许可要求124542tokens（input116350/output8192）、USD2.98236，tokens与USD都不足。没有发出该请求，故拒绝许可本身不另算已消费。摘要 `Pi RPC process exited while waiting for an event` 是budget guard结束进程的外显，本次B2不是新的环境断连。

A入口实际额度为591请求、429224tokens、14014.109秒、USD10.83622、2130882996bytes。停止时真实总余量仍有151164tokens、USD2.24280；下一许可需154051tokens（input145859/output8192）、USD3.57254，两项均不够，所以没有发出。没有把剩余额度伪称已花光，也没有降低许可去发请求。B2账本provider_input8/边界request8包含拒绝前pin，实际HTTP任务请求7；费用以provider-requests的真实发出记录为准。A同理，摘要错误不当作新的环境失败。未涨cap、未换模型、未自动retry、未补跑B1。

## 6. 分层结论与决定

本次新增一条v3对象出口的真实正证据；仍无运行自改或验证窗口证据。B1是环境缺失样本，B2获得更长暴露后完成合法keep；不能将两个B合并成重复成功样本。A也未完成交付。本次消除了“A先占B2余额”这一具体条件，但B2在自己的45%上限下仍不能进入产出/反馈闭环；不能把结果归咎于A，也不能据此判定模型拒绝修改。B2的入口keep结束了协议事务，并未证明完整架构审阅充分，后续纯reasoning及预算停止也没有兑现最终任务目标。

| 证据层 | 本次状态 | 实际材料与边界 |
| --- | --- | --- |
| 功能正确 | 调度范围支持 | runner13/13；真实manifest顺序、B上限、A余额及源hash吻合；不冒称重新验收整个runtime |
| 全链路可达 | 局部通过，任务链失败/未闭合 | 真实az→Pi→同根入口→对象exit成功→下一execute请求；真实事后Edge/checker4页。运行内render/look/checker/delivery未到达；B1是环境阻断 |
| 自主审阅与采用 | 合法保持有1例；自主自改/试用未验证 | 同一B2自己提交keep，非host代写；入口是用户底线。0创建/激活/验证窗口，不能宣称自主进化或整体Loop重构 |
| 净收益 | 未证实 | B1缺失、仅1个B有效行为样本，A在剩余预算下且均无交付，非匹配预算重复对照；不作优越性或泛化结论 |

与v3相比，B2从1预检+2任务、出口前停止，变为1预检+7任务、一次合法keep；这支持“v3的对象出口可被真实qwen成功调用”这一窄结论。它不证明增加审阅支出带来任务收益。A由v3的12页事后残稿变为本次4页，模型轨迹、顺序和可用额度不同，不能称回归幅度或机制因果；两次的运行内交付均为0。预注册的完整15页/10单元交付命题没有得到支持。保留v3为功能上有部分支持、真实任务尚未验收的实验版本，本次不扩建或改设计。

本次不触及新设计，也不因失败重启付费。D类跨压缩认知连续性待办与本任务相关，但没有reset样本，继续开放；P0在线质量反馈、P1语义恢复、P2整体替代/串行trial、P3自主新版使用、P4预测比较、P5跨任务迁移均未形成完整真实验收，不得从本次keep推断。下一可证伪缺口是同冻结版本的“合法结案→实际产出→运行内反馈/交付”能否在预定预算内闭合；B1环境样本缺失也需独立说明，本次没有重跑授权或后续执行。

原始run、session/pi-events/provider-requests/model-usage/live-self均保留于上述runs根；[逐臂证据及hash索引](D:/agent/.codex/worktrees/evo-design-20261110/docs/reports/evo-v3-verify/results.json)、[B2完整生命周期](D:/agent/.codex/worktrees/evo-design-20261110/docs/reports/evo-v3-verify/sample-B2/evidence.json)、[A调用/截断/残稿证据](D:/agent/.codex/worktrees/evo-design-20261110/docs/reports/evo-v3-verify/calibration-A/evidence.json)、[最终账](D:/agent/.codex/worktrees/evo-design-20261110/docs/reports/evo-v3-verify/final-accounting.json)供复核。证据导出沿用v3的只读export/posthoc脚本，仅替换run根与输出位置；不复制认证目录。后续报告/证据本地提交属于开发记录，运行代码始终钉在c1396cb6，v3-verify标签不移动，不push。
