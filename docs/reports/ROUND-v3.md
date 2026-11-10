# ROUND-v3：模式事务与验证窗口修复，真实交付目标仍未达成

日期：2026-11-11（Asia/Shanghai）。**第三轮工程实现和授权实验已结束；真实任务失败，不能验收优化有效。** 权威：宪法 v1.2 > George 两原则及 t810 > FINAL。设计诊断见 [ANALYSIS-v2](ANALYSIS-v2.md)；外部 UTF-8 副本位于 `C:/Users/qi/tmp/r04/evo-design/ROUND-v3.md`。

## 1. 本轮具体优化与设计依据

主命题：使同根审阅出口、上下文通道和承诺到期形成可提交的事务，能在原预算内到达合法审阅结案及真实交付。**真实运行不支持完整命题。** B 在模型发出出口调用之前就因许可不足停止，不能宣称出口问题已经被真实 qwen 验证解决。

| 设计修复 | 代码与实际职责 | 减少的负担及边界 |
| --- | --- | --- |
| 区分工作决定与模式事务 | `self_root_ppt.ts`、`ppt_demo_extension.ts`：审阅暂停普通工作 decide；provider 顶层 op 明确列可用事务，result 明确为 object，并保留 a91b 的条件出口 schema | 去掉 Any 让模型猜测 JSON 字符串/对象的歧义；退出仍由同一 Agent 提交。没有 host 代写 keep、解析错误字符串、自动超时恢复 execute |
| reasoning 通道纳入可反射 context policy | `SelfRoot.contextMessages`；种子 latest，可改 all/latest/none；旧块保存在同根 ledger | 不再默认累积重发旧 reasoning；完整用户/任务文本、工具结果、图片和调用关系保留。原思考可经 read_self 恢复，没有摘要 Agent。原始模型未返回的内容不能凭空恢复 |
| 实际请求分项计量 | `provider-requests.jsonl.composition`：system/schema/history/reasoning 字符与 payload bytes | 可以核对输入究竟花在哪里；字符不是 tokens，后者另按 provider usage 结算 |
| 到期不被事件去重吞掉 | `SelfRoot.event/boundary`：每请求边界核计数承诺；已消费终态事件仍处理其后新增窗口；交付检查已有排队审阅 | 去重事件不等于删除新承诺；没有新窗口不重复底线。没有心跳审阅或 host 自动采用 |
| 采用必须引用真实任务比较 | `SelfRoot.interpret`：adopt 要求真实 task_outcome 基线、窗口后果引用与 Agent comparison；restore 先校验再排原子事务 | 机械核对引用和来源；不判断比较输赢。缺证据可 defer/restore，不强迫自改或完美基线 |
| 完成与预算生命周期 | `evo_ppt.run`：交付完成也不能跳过既有审阅队列；收费预检前核总截止，HTTP timeout 受实际剩余时间限制；预检发出前持久化 pending 许可 | 移除末次窗口被提前结束、预检越过墙钟的漏洞；失败/未决仍保守入账，没有 retry/fallback |

入口 floor 没有删除：FINAL G1 明确把它列为用户底线，宪法第四条也允许准备阶段考虑目标、资源、权限和后续能力，不要求先有任务失败。问题是入口审阅仍没有完成合法结案；不能用本轮工程解释把实际缺口抹掉。旧 v2 的“四次字符串出口失败”已核实；本轮没有出口调用，不能把未重现错误当成修复已验证。

没有新增任务 Agent、reviewer、reflector、consolidator 或 child；work/review/consolidate 仍是同一 SelfRoot 的模式。路由属于可反射 policy；没有归因词表、重构触发表、host 诊断/采纳或强制修改数。变化仍经原子反射、版本、权限和预算边界。独立开发复核是工程环节，不进入任务运行，其发现与修正见 [audit](evo-v3-real/audit.md)。

## 2. 版本、检查与实验协议

真实三臂均冻结在工程提交 **`ad5636a995911cca490b61a2d7c0e8952eef9482`**。v1=`b85add88`，v2=`318a477d`；本轮报告提交后本地标签 `v3` 指向收尾提交，不 push。运行中没有热补丁、开发者提示或改验收；最终实现与运行 seed hashes 一致。

运行前 Node **24/24**；Python runner **12 项**和实际 Pi/Edge scripted provider **6 项**，合计 **18/18，31.81 秒**。测试涵盖真实 provider context 的对象出口/操作面、execute 普通结果不被限制、reasoning 选择与恢复、末次审阅中新窗口到期、同一 Agent defer、缺基线/后果拒绝 adopt、交付后续队列和截止前禁止收费预检。脚本只证明功能与接线，不证明真实采用。未宣称全仓测试通过；历史旧接口测试问题没有顺手改成新预期。

环境：Windows、Node v25.5.0、Pi 0.87.0、本地真实 Edge headless；`az / qwen3.8-27b`、openai-completions、thinking=low，temperature/top_p provider 默认。每臂一个普通真实 PPT 会话，从空任务产物开始；同一 Bank of America Q3 2021 材料、十五页自包含 HTML brief、十个冻结内容单元。HTML 不是 native PPTX。启动带 `--no-context-files --no-skills`，不注入仓库 AGENTS.md、宪法或开发报告。

按预注册 A→B1→B2，A 上限 60 请求/1800 秒，B 使用实际总余额，不以 A 校准成功为启动条件。三臂均为探索样本，关闭心跳、任务 child、默认继承、自动 retry；length 只从同一历史续接，不提高输出量子、不重试原请求。总授权不变：600 请求、600000 tokens、14400 秒、USD15、2147483648 bytes；预检、失败、pending 全计。三个真实模型小预检均返回精确模型，三个 Edge 一页预检均通过。

## 3. 真实逐臂与逐单元结果

**三臂运行内 render、look、checker、delivery 均为零；B1/B2 没有文件或合法 Agent 结案。** A 保留了 46420 bytes 的部分 HTML。各臂停止均来自 budget-stop 的许可拒绝，不是远端失联；summary 的 `Pi RPC process exited while waiting for an event` 是预算 guard 结束进程的外显，不记作新的环境故障。

| 臂 | 请求：预检＋任务 | 真实行为、停止与产物 | 运行内交付 |
| --- | ---: | --- | --- |
| A | 1＋12＝13 | read 5、ls 2、write 2、python 5 次原始调用；包含一次被 length 拒绝的 write、一次三引号语法错误，不能全算成功。9 个 toolUse、3 个 length。逐段写成残稿，下一请求被 token 和 USD 许可同时拒绝 | 0/10 单元，0/15 页 |
| B1 | 1＋3＝4 | 入口 reflect；ls 1、read 4、read_self_component 1。读取材料后，下一请求 USD 许可不够；没有 decide/reflect 调用；技术关闭 deferred/incomplete，agent_decision=absent | 0/10，0/15 |
| B2 | 1＋2＝3 | 入口 reflect；read 3。读取材料后，下一请求 USD 许可不够；没有 decide/reflect 调用；技术关闭 deferred/incomplete，agent_decision=absent | 0/10，0/15 |

完整 [逐臂结果及 hash](evo-v3-real/results.json)、[B1 原始摘要](evo-v3-real/sample-B1/summary.json)、[B2 原始摘要](evo-v3-real/sample-B2/summary.json) 保留。A 运行内没有检查；为诊断残稿，开发侧在独立 `runs/.../posthoc/calibration-A` 复制保留 workspace，使用同一真实 Edge 和冻结 checker，**不向已结束的 Agent 回流，不冒充交付**。

事后 A：**12/15 页**，source hash=`21f9913777bf41e0150f3cfd47fb059199048bbb7a46230009596862534561b7`，renderer exit=0、warnings=[]。看过联系图，十二页均非空；这不等于字号、数字归属、叙事或审美全面合格。源码未完成，余额/资本等后续内容未形成完整交付。见 [残稿](evo-v3-real/calibration-A/partial.html)、[真实联系图](evo-v3-real/calibration-A/posthoc-contact-sheet.png)、[完整事后事实](evo-v3-real/calibration-A/posthoc-acceptance.json)。

下表数字为 **A 事后**的字面/归一化命中；B 的未测不能写零分。所有单元在三个臂均未交付。

| 冻结单元／源页 | A：字面数字 | A：归一化数字；等价引用 | B1 | B2 |
| --- | ---: | --- | --- | --- |
| unit-01／1 | 3/3 | 2/3；有 | 未交付、未测 | 未交付、未测 |
| unit-02／2 | 1/3 | 3/3；有 | 未交付、未测 | 未交付、未测 |
| unit-03／3 | 0/3 | 3/3；有 | 未交付、未测 | 未交付、未测 |
| unit-04／4 | 0/3 | 3/3；有 | 未交付、未测 | 未交付、未测 |
| unit-05／5 | 0/3 | 3/3；有 | 未交付、未测 | 未交付、未测 |
| unit-06／6 | 0/3 | 3/3；有 | 未交付、未测 | 未交付、未测 |
| unit-07／7 | 2/3 | 2/3；有 | 未交付、未测 | 未交付、未测 |
| unit-08／8 | 1/3 | 1/3；有 | 未交付、未测 | 未交付、未测 |
| unit-09／9 | 0/3 | 0/3；无 | 未交付、未测 | 未交付、未测 |
| unit-10／10 | 0/3 | 0/3；有 | 未交付、未测 | 未交付、未测 |
| **合计** | **7/30** | **20/30；9/10** | **未测** | **未测** |

A 精确引用字面为 0/10；归一化全部数字＋引用同时命中的单元为 5/10。匹配只是 token/符号/引用所在片段事实，不证明财务含义、期间或归属；没有修改探针或放宽 checker 来制造通过。

## 4. 成本、输入构成与停止原因

| 臂 | 入账 tokens（含预检） | 保守 USD | runner 秒（含模型预检） |
| --- | ---: | ---: | ---: |
| A | 456343 | 11.98238 | 1688.500 |
| B1 | 33448 | 0.68732 | 21.875 |
| B2 | 11856 | 0.25212 | 15.406 |
| **合计** | **501647／600000** | **12.92182／15** | 三臂编排总墙钟 1732.381 |

20/600 请求，3 个预检共 165 tokens；**全部有 usage，未知/pending 为零**。任务已报告 input=363654、cacheRead=89728、output=48100；reasoning=29755 已含在 output，不重复相加。以 manifest 注册价 input5/output30/cacheRead0 USD/M 估算含预检约 **USD3.263295**；这不是账单。本轮 cap 始终按保守 input/cache20、output80 计，实际 invoice 未知，不用低估价扩大额度。

三臂余量为 98353 tokens、USD2.07818；有余量不表示可发送任意请求：

| 被拒请求 | 当时剩余（tokens／USD） | 本次许可（tokens／USD） | 拒绝的上限 |
| --- | --- | --- | --- |
| A 下一请求 | 143657／3.01762 | 183192／4.15536 | tokens 与 USD |
| B1 下一请求 | 110209／2.33030 | 102800／2.54752 | USD |
| B2 下一请求 | 98353／2.07818 | 88050／2.25252 | USD |

许可按实际序列化 UTF-8 bytes＋4096 framing 的保守输入界，以及实际 8192 输出额度计算，受注册 context 上界约束。本轮没有把剩余钱当作负债已经花掉，也没有伪造“实际已消费到 USD15”。拒绝后不发送 HTTP、不重试，不清零任何历史；[各臂 budget-stop](evo-v3-real/sample-B2/budget-stop.json) 可复核。

v2 审计已区分常驻与历史：B1 system 约10.2k 字符、schema 7.0k，历史增长到122.6k。v3 B1 实际三请求的 system=10322/10335/10348，schema=7391，history=680/5795/57487；第三请求只携带最近一条 reasoning（57 字符），旧块保存在同根 ledger。**证明了装配通道生效，未证明净节省**：行为/请求数不同，且完整材料仍重发。A 最后一个实际请求 history=152378 字符，reasoning=34012 字符；已报告任务 input＋cache 共408712 tokens，远大于输出，不能将全部成本称作审阅税。

事后真实渲染/检查另外约92.69秒、零 provider 请求。最终账按封存时点计墙钟，包含截至该时点的收尾记录；存储计入原始运行目录、版本化证据、仓内与外部两份分析/轮报，按文件逻辑字节相加，不计 Git 对象库。精确数值及范围见 [最终账](evo-v3-real/final-accounting.json)；各维度均低于原 cap，没有涨预算。本轮没有断开、terminated 或300秒无事件；v1/v2 的远端故障保留为其环境证据，本轮失败不能归咎网络。

## 5. 运行自修订与工程版本分账

| 项目 | B1 | B2 |
| --- | --- | --- |
| root_id | `5d714135-2137-4d83-bc90-573c429d61ba` | `7d0986f9-6ec3-4d26-9441-b39183b20291` |
| 活动 SelfRoot revision | 始终1 | 始终1 |
| Agent 自改/激活 | 0／0 | 0／0 |
| 底线进入 | window_entry reflect 1次 | window_entry reflect 1次 |
| Agent 合法 changed/unrelated/deferred/keep | 0 | 0 |
| 技术关闭 | deferred/incomplete；absent | deferred/incomplete；absent |
| trial/adopt/restore/reset/继承 | 均未发生 | 均未发生 |

两个 legacy_self_revision=2 都是 runtime seed，不是 Agent 自改。A 是旧比较路径，没有 SelfRoot root_id；HTML 写入不是自身修改。新版 reasoning policy 是本轮工程种子，不能算 Agent 自主采用。没有 preset reviewer、child、host 采用或隐藏诊断。

真实 HTTP schema 可确认 result 顶层 object、op 枚举和 a91b allOf 均存在；两 B 共5个任务响应全部选择读取，**没有 decide(op=exit)**。因此没有复现“字符串被拒”，也没有取得“对象出口成功”的正证据。技术关闭后显示 execute 是 host 的事务清理，不是 Agent 自主返回工作，更不能伪装合法 keep。

## 6. 剩余偏差、失败转移与四层结论

1. **首要任务目标仍失败。** A 仅12页残稿、无运行内反馈；B 无产物/交付/合法结案。不能用事后 Edge 成功或测试数替代这一点。
2. **主要断点从错误出口移到了出口之前。** A 占本轮保守费用约92.7%，B 的早期只读请求把下一次保守许可推到余额之外。顺序共享余额没有保证足够的 B 暴露，也没有形成匹配预算比较；“无固定进化预扣”不能等同“可完成三臂”。这是实验资源调度/输入表示的设计缺口，不是 qwen 已拒绝改进、也不是本轮远端故障。没有在见到结果后偷偷改顺序、重开 B 或借低费率继续。
3. **出口、验证窗口和真实采用仍未验收。** 对象出口确实进入真实 payload，但没有出口调用；终态新窗口、真实基线比较、同 Agent 采用/恢复只有功能/脚本接线证据。本轮没有发生自改，不强迫制造一个。
4. **仅减旧 reasoning 不足以使当前预算下的任务闭合。** 任务原文和工具代码/结果仍占大部分历史；A 另有3次 length，前两次全部8192输出均报告为 reasoning，一次截断 write，一次 Python语法错误。下一可证伪问题是：能否在不删关键事实、不过度许可、不中断认知的前提下提供任务工作集及精确可核计量，同时在已授权的比较中给必测臂真实暴露。没有本轮证据支持某个新设计已经有效。
5. **与 FINAL 的范围差距。** P0 在线质量反馈、P1 语义恢复、P2 整体替代/串行 trial、P3 Agent 自选新版实际使用、P4 预测比较、P5 跨任务复用均未得到普通真实任务证据。保存 trace/对象视图不等于充分审阅；无 reset，backlog D 认知连续性仍开放；HTML 不等于 native PPTX。

| 证据层 | 结论 | Provider / environment 与边界 |
| --- | --- | --- |
| 功能正确 | 针对性支持 | Node24/24；Python/Pi/Edge18/18；不是全 FINAL 已完成 |
| 全链路可达 | 部分支持；任务链未闭合 | scripted Pi/真实 Edge 的出口/窗口/反馈/交付接线通过；真实 az 到达入口与新 schema，未到合法出口或运行内 checker/delivery |
| 自主审阅与采纳 | 未得到支持性样本 | 0合法结案、0自改；不能把预算 incomplete 当保持，也不能据此判断模型意愿 |
| 净收益 | 未证实 | 无完整对照、B暴露不足，任务质量/总成本未形成有效匹配比较 |

## 7. 三轮比较与交付决定

| 轮 | 工程重点 | 实际产物/任务结果 | B审阅与自改 | 预算账：请求／tokens／保守USD |
| --- | --- | --- | --- | --- |
| v1 | 同根/反射/模式与P0–P5窄面首版 | A15页未交付草稿，事后字面13/30、精确引用0/10；B未启动 | 无真实B；0运行自改 | 7／354536／14.40472（含未知240536） |
| v2 | 有界请求许可、输出段、反馈与表示归一化；末尾a91b出口修复 | 三臂无稿件或交付；诊断预检断开 | 两B进floor；0合法结案、0自改 | 22／521394／12.36744（含未知157608） |
| v3 | 模式事务对象类型、reasoning通道、窗口与采纳证据、终态/预算生命周期 | A12页残稿，事后字面7/30、归一化20/30；B无稿件或交付 | 两B进floor；均在出口前预算停；0合法结案、0自改 | 20／501647／12.92182（未知0） |

三轮均零运行内交付，不能宣称第三轮优化已验收。v1 有稿件而非“零文件”；不同 checker、探索协议与暴露不等，不作显著性或进步趋势推断。

保留 v3 为**已实现、经功能验证但真实任务未验收的实验版本**。三轮授权已用完，本轮不另起付费诊断、不自动重跑失败臂、不 push。后续候选研究和缺失实验只记录，不视为新增授权。原始完整日志在 `runs/evo-v3-real-20261111/`，版本化证据在 [evo-v3-real](evo-v3-real/results.json)，不复制 `.pi-agent` 认证目录；工程 commit/tag 与运行 self revisions 严格分账。
