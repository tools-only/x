# v3：v2 失配分析与预登记变更记录

日期：2026-11-11。状态：设计／待实现与实测。权威：宪法 v1.2 > FINAL §1.2 的 George 原话及 t810 > FINAL。v2=`318a477d`；本记录兼用 meta-harness-change 栏目，不进入任务 Agent 上下文。外部同步：`C:/Users/qi/tmp/r04/evo-design/ANALYSIS-v2.md`。

## 问题、证据与根因

| 失配 | 观察事实和证据 | 分类、触及原则 | 设计修正；拒绝的临时补丁 |
| --- | --- | --- | --- |
| 窗口入口先审阅，未完成任务就耗尽 | v2 B1 `session.jsonl`、`.harness/live-self.json`：入口进入 reflect；只读材料/环境/policy；四次出口以 JSON 字符串传 result，均被对象契约拒绝；随后 enter_mode(execute) 被拒。见 `evo-v3-real/v2-composition.json`。入口无 task_outcome；同一 Agent 实际表达了 keep 理由，但未完成协议结案 | 设计＋实现边界；宪法 4、5、7–9，George 同一主客体。**入口底线本身并非越权**：FINAL G1 显式采用它；准备阶段允许基于目标/权限/资源审阅，不要求先失败。问题是弱类型出口使审阅事务不能提交，进而占住执行模式 | 明确“工作决定”和“模式事务决定”的边界：工作步在审阅中暂停，出口 result 在 provider 顶层就是对象，再附钉住的 Agent exitSchema（保留 a91b 的条件约束）；不再用 Any 让 provider 猜测字符串还是对象。可合法 keep/defer，并恢复同根续点。拒绝删除用户入口底线、host 代写 keep、解析错误字符串当合法结案、自动超时切回 execute、提示催促或强迫修改 |
| 大输入没有产物 | 审计实际 payload：B1 system 10186–10214 字符，schema 7023 字符，历史 681→122598 字符；一次材料工具结果 51642 字符、环境 12241 字符；旧 assistant reasoning 随历史累积。原三臂报告的全部 tokens 含输出/未知许可，不把它误写成已知 input。原始 `harness/provider-requests.jsonl`、`model-usage.jsonl` | 设计成本＋测量；宪法 3、4、第六章，FINAL 3.3/4.4。材料是任务输入，不应按 host 相关性删选；旧 reasoning 与事实并非同一通道 | 把 reasoning 历史选择纳入同根可反射 context policy；种子仅重发最近 assistant reasoning，保留全部用户、任务文本、工具结果和调用关系。旧 reasoning 仍在原始 session 可恢复，无摘要 Agent。逐请求记录 system/schema/history/reasoning 字符及 payload 字节，token 仍以 provider usage 为准。拒绝截材料、偷偷删失败、仅最近 N 条工具证据、语义摘要 worker、涨 token cap |
| 最终 schema 补丁缺真实验证 | a91b 的 allOf 在脚本 Pi context 可见；真实诊断 preflight 被断开，未到模型。B1 的实际失败发生在该补丁之前 | 实现／证据缺口；宪法 8、第六章 | 本轮真实 B 检查实际 HTTP payload 的顶层 result 对象和 allOf，以及模型输出和合法结案；脚本只证明接线。拒绝将测试通过等同真实 qwen 遵循，或强制预设自改探针 |
| 默认窗口可能永不到期 | 当前默认 due=before_session_end；首次 deliver 已消费结束事件，审阅中新建窗口后，同 hash 重试在 event 去重前直接返回；其他 request/units 到期也仅在偶然下一事件评估 | 设计／实现；宪法 6.3、8，George 每变更带窗口及回到真实任务指标 | 去重只针对已消费事件/路由，不能吞掉**新承诺**；每请求边界检查计数到期；重复终态边界仍交付新窗口；交付检测排队审阅而非只看当前模式。没有新窗口时不多一次审阅。拒绝心跳审阅、额外固定轮数、自动采用、把到期改成永不过期 |
| adopted 不保证任务比较 | `SelfRoot.interpret` 只要求 reason；没有 baseline/outcomes 也能 adopt。v2 无运行采用，不能声称它实际造成坏采用 | 设计契约；宪法 5、6.1/6.3，George 验证后由 Agent 采用/恢复，t810 | 采纳时要求同一 Agent 的比较、所引用的真实基线 task_outcome 和窗口内真实 task_outcome；由 runtime 核对来源/窗口/引用，不评价比较或决定胜负。缺证据可 defer 或明确 restore。窗口到期自动提供原事实入口与缺失项。拒绝 host 分数阈值自动采纳、无结果 reason 冒充验证、强迫每次修改先有完美基线 |
| 远端终止与预检断开 | B2 第四请求 terminated、usage 未知；诊断 `Remote end closed connection without response`；v1 曾 300 秒无活动。v2 final-accounting 的未知许可仍占账 | 环境；请求生命周期如实计量，宪法 8、第六章 | 保持无自动 retry/fallback、300 秒无活动和总墙钟；独立臂在总余额允许时继续，未决保守占用。拒绝延长 timeout、清零失败费用、换 provider/model 或为远端错误编造 harness 诊断 |

## 窄命题、负担与设计成本

主要命题：将同根模式出口、上下文通道和承诺生命周期补成可提交的事务，能在原预算内由真实模型合法结束入口审阅并推进真实渲染／检查／交付。任一 B 仍因相同的错误出口困在入口，或窗口/采纳可绕过真实证据，分别反驳对应设计子命题。合法 keep 不算失败；自改、整体重构及收益不是本轮强制目标。

复用 SelfRoot/MOP、已有 ledger、reflection、context policy、窗口与 checker。增加一个可改的 reasoning 历史选择及机械体积计量；移除旧 reasoning 的默认累积和审阅中普通工作 decide 的混用。无新增 Agent、worker、语义归因词表、诊断策略、候选配额或定时催促。出口由当前 Agent 提交，提交后释放同根执行续点；未提交保持未完成。上下文选择在下一请求实际生效；保留事实和原始会话，不宣称跨摘要认知连续性。到期窗口进入同一 Agent 下一普通请求，替代手工查账；处理后不重复到期。未知/负效或预算不足均保留缺口，恢复产生新运行修订。

比较过三种方案：删除入口 floor 会违背已采用契约；自动给审阅超时/自动 defer 会引入 host 结论；采用明确的模式事务类型和计量式装配，保留 Agent 的全部决定权与现有底线，工程范围最小。

## 运行前协议

- 用户 round 3 授权：最多 600 provider 请求、600000 tokens、14400 秒、USD15、2147483648 bytes；预检、失败、pending 全计，任一 cap 到界干净停止，不抬 cap。价格按既有保守 input20/output80 USD/M，注册价另列，实际账单未知。
- az / qwen3.8-27b，Pi 0.87.0，本地 Windows/真实 Edge，thinking=low，temperature/top_p provider 默认；无任务/审阅 child，无自动 retry、心跳、跨任务继承。`--no-context-files --no-skills` 保持开发说明不入任务。
- A→B1→B2，A 保留 FINAL 的 60 请求/1800 秒上限，B 使用实际总余额，无固定进化支出份额。同一空产物初态、十五页 HTML brief、十冻结单元与既有材料；不改 checker 探针/判分来取得成功。三个臂是探索样本，不作确认性或跨领域收益声明。
- 硬件预检、hash 冻结、全部实际请求/计费/体积留证。真实 schema、出口原文、模式恢复、render/checker 反馈、交付单元/页数分别核对。运行 self_revision 与工程 Git 分账。
- 负例：字符串出口不自动修复；模式暂停工作 decide；旧 reasoning 可选且不删 task/tool 事实；计数到期及同边界新增窗口；无真实 baseline/outcome 拒绝 adopt，合理 defer/restore 可达；失败/未知许可不释放；总 cap 不被独立臂重复获得。
- 功能测试与实际 Pi/Edge scripted provider 仅证明功能及接线；真实 B 合法结案与交付才支持对应行为。净收益仍需独立同预算重复对照，不以较少上下文、较多版本或单份交付代称。

## 实现与验证（运行后追加）

实现入口：`demo/self_root.ts`、`demo/self_root_ppt.ts`、`demo/ppt_demo_extension.ts`、`src/autoresearch_pi/evo_ppt.py`。旧 reasoning 按原块存入同根 ledger，Agent 可经 read_self 恢复；不是只在外部 session 留一份无法读取的归档。窗口计数在真实请求边界检查，没有种子心跳审阅。

运行前 Node 24/24；Python runner 12 项、实际 Pi/Edge scripted provider 6 项，总计 18/18（31.81 秒）。覆盖实际 MOP object/op 和 execute 原始决定 schema、旧 reasoning 通道移出而事实/最近思考保留、原 reasoning 可恢复、最终 review 新建默认窗口后重复终态到期/同根 defer、已交付但队列未空仍续接，以及总截止前禁止收费预检。

独立只读开发复核（非运行内 reviewer）发现最终 delivery 队列可被 runner 提前停止、renderer 预检后未先核截止时间、旧 schema 测试断言三项；已在真实运行前修复和回归。预检发出前也持久化本次 pending 许可，异常仍保守计入。没有改变模型、任务材料、checker 探针或总 cap。真实结果、成本、机会漏斗、协议偏离、四层证据及最终决定统一在 ROUND-v3 记录。

关联 backlog D：保留任务事实与仅调整 reasoning 通道不等于解决跨压缩认知连续性；无真实 reset 仍不勾选 D。后续检查须核对真实 provider 输入及后续行动。
