# v2：v1 失配分析与预登记变更记录

日期：2026-11-11。状态：设计／待实测。权威顺序：宪法 v1.2 > FINAL §1.2 的 George 原话与 t810 > FINAL。v1=`b85add88`，实现=`b3ba1ff8`。本记录兼用 meta-harness-change 模板的栏目，不进入任务上下文。

## 问题、证据与根因

| 失配 | 观察事实和证据 | 分类、触及原则 | 设计修正；拒绝的临时补丁 |
| --- | --- | --- | --- |
| 请求无事件 300 秒 | `runs/evo-v1-retry-20261111/calibration-A/{summary.json,harness/provider-requests.jsonl}`：第 4 请求已发，stream=true/include_usage=true，无 message_end；runner idle timeout。现有 PiKernel 已按原始流活动更新时间，不能无证据再归咎 projector | 环境故障／请求生命周期设计不完整；宪法 8、11，失败不得伪装成功 | 保留 300 秒无活动截止和总墙钟；请求发出前保存本次许可，失败保留本次未结算上界，允许后续独立实验使用真实剩余总额。**不声称修复远端无响应**。拒绝延长 timeout、自动重试、换模型、把未知消费清零 |
| B1/B2 被预留饿死 | 同根 `final-accounting.json`、B 的 `summary.json`：未知请求预留 240536 tokens/$8.74288；小探针也按 175000 输入预留，剩余 $0.59528 不能启动 | 设计＋实现；宪法 5、9、11，FINAL G4 | 请求许可基于实际序列化 payload 的保守输入界和实际输出额度，逐请求保存；结算仅释放该请求差额；探针按其真实小输入界。三臂串行共享剩余总额，无宿主固定 B 份额。拒绝涨总 cap、删除未知请求、虚报本地免费或降费率 |
| 一次长生成，无反馈修订 | A 三次已知任务 usage 4076/28223/81475；一次 output=48236（含 reasoning=15324），仅 read/ls/write，无 render/look/deliver。原始会话 `calibration-A/session.jsonl` | 设计机会＋模型行为；宪法 4、6.3、10；不能单凭 A 推断 B | 将“单次传输额度”与总任务预算分开，种子输出量子 8192，B 可通过同一 policy 反射修改，真实 payload 使用其生效值；length 如实结束，不自动长续写。渲染结果直接带验收事实回到同一 Agent，不只埋在 ledger。Agent 决定如何分段、何时渲染和是否修订。拒绝 PPT 专用分步提示、强制 N 次生成后审阅、host 替 Agent 设计幻灯片／工作计划。量子本身不是收益证据，截断／失败计入结果 |
| 字面 checker 13/30、引用 0/10 | `docs/reports/evo-v1-real/results.json`（及 v1 报告指向的实际文件）、A 草稿：表头统一货币单位、p.N 引用；正负数括号亦存在。全文 substring 同时有假阳性风险 | 测量；宪法 3、6.1、10，FINAL P0/G7 | 保留旧 literal 事实；新增表示归一化的完整数值 token、符号、等价页码引用及引用所在 slide 范围观察。明确不是语义归属／财务审计，不改任务材料和三个冻结探针，不把数字存在当任务通过。拒绝改成只看截图非空、放宽到任意子串、事后挑指标宣称全部合格 |
| 无 floor/restructure/trial/adopt/restore | B1/B2 未创建根；A legacy seed revision=2 非 Agent 自改。`ROUND-v1.md`、各 manifest/summary。已有 scripted 测试不能代替普通模型证据 | 实验可达性／测量，不是已证实模型拒绝进化；宪法 4–8、第六章，George 同一主客体 | 去掉校准失败阻止后续独立探索样本的实验启动依赖；先冻结“均为探索样本”并按实耗共享余额。复用同根模式/MOP、可反射 routes、已有窗口；实测审阅结案和后续版本使用。拒绝另设 reviewer、强迫 restructure、试验次数配额或 host 自动采用／恢复 |
| 单元交付与全稿交付脱节 | v1 的 submit_unit 仅 B 有；全稿 deliver 本身不将十单元记作交付，A 只有事后检查。已有协议要求重复 submit_unit，容易把协议动作数误作任务效果 | 设计／测量；宪法 10、11 | 全稿真实交付覆盖全部冻结单元；仍保留独立单元交付。两臂同一 checker 自动返回事实，区分交付覆盖与内容探针。拒绝强制十次单元手续、虚造未调用 submit_unit 的十次 review |
| 预检与费用计量重复 | 启动 GET /models IncompleteRead；另有 tiny completion 已确认精确 model；旧 runner 每臂重复 listing 后才 probe。费率注册 5/30 与保守 20/80 并存，账单未知 | 实现／环境／测量；宪法 8、11 | 一次有计量的小 completion 同时验证 endpoint、精确 model 和推理可用性；仍按保守 20/80 入 cap，独立展示注册价估算与未知账单。拒绝猴补 model_preflight 或隐藏失败预检 |

## 窄命题、负担与设计成本

主要命题：将每次 provider 请求建成“可见的有界执行段＋逐请求结算＋真实工具反馈”的同根循环，能在原总预算内到达 B 的窗口审阅及真实交付／反馈；不预设其一定自改或优于 A。若 B 因同类过大预留未发任务请求、工具反馈仍未进入后续 provider 输入，命题被反驳；若模型仅生成长文本或合法保持，分别记录任务失败或合理不改，不由宿主归因。

复用当前 SelfRoot、policy、ledger、模式、反射、验证窗口及 renderer。仅扩展 policy 的请求输出额度，默认 8192，可原子热修改，不能越过模型／剩余总预算；不是新增 agent/worker。把已有验收结果从隐蔽账目移到 render 工具结果，移除重复 listing 和固定三臂预算预扣，减少开发者恢复和十次机械提交负担。常驻增加一个数值和请求许可事实，无语义提醒／结构重组触发表。每个许可在 message_end 结算；未结算即保守占用至本轮结束。验收结果由下一个普通请求使用，过时结果保留 source hash；新渲染替代当前反馈，不能擦历史。

## 运行前协议

- 用户授权本轮上限：600 请求、600000 tokens、14400 秒、USD15、2147483648 bytes；失败、预检、pending 全计。远端费用未知时保守入账，不涨 cap。全部 runs 当前轮存储、准备／编排时间计入总额。
- az / qwen3.8-27b、Pi 0.87.0、thinking=low，温度/top_p provider 默认；Windows/真实 Edge renderer。A legacy、B1/B2 独立同种子 SelfRoot，同一十内容单元和 15 页 HTML brief（不是 native pptx），均从空任务产物开始；关闭额外 agent、心跳、自动继承与 retry。
- 顺序 A→B1→B2；A 保留 FINAL 的最多 60 请求／1800 秒探索上限；后续各使用当时总余额，不预留固定份额。不满足 A 校准目标时照用户指令完成探索 B，明确不能称确认样本。运行前冻结所有 seed/source/checker hashes。
- 主要任务指标：真实渲染／交付页数、逐单元交付覆盖、literal 与 normalized 探针分别列；后者只验证表示与局部范围。真实反馈后是否修订产物、多少请求／input/output/reasoning／时间／费用。运行自修订按 root/revision/激活、模式结案、窗口比较、Agent 采用／恢复分账，不以工程 Git 计。
- 负例测试：小请求不会按模型最大值预留；未知请求不清零；剩余不足在发送前停；负数不匹配正数、短数不匹配长数、异页同数不能当该单元命中；工具反馈和版本生效测试；有效 keep 不强改。
- 请求无活动 300 秒或任一总 cap 到达即停止该会话，保留未知许可；独立臂仅在总余额允许时启动。正常结束／交付底线由同根 META 执行，崩溃不补造预审。收益不能仅由增加事件／修改次数证明。

## 实现与验证（运行后追加）

实现入口：`demo/provider_permit.ts`、`demo/self_root.ts`、`demo/self_root_ppt.ts`、`demo/ppt_demo_extension.ts`、`src/autoresearch_pi/evo_ppt.py`。Node 针对性检查 19/19；Python runner 10 项及真实 Pi/Edge 接线 4 项。后者使用 scripted provider，只证明机制和接线。

`length` 响应保留完整历史和工具回执，在同一串行续点回传客观截断事件后继续；不是重试原请求，输出额度不自动增加。旧 `tests/ppt_demo_live_orchestration.test.ts` 在 v1 就断言过时的 `rootObject` 字段、未等待异步初始化，作为已知未通过的额外检查保留，本轮未改写其预期。

真实结果见 ROUND-v2。功能、全链路、自主采用、净收益分别报告。净收益还受小样本、多项必要工程修正和非独立单元限制，不预先承诺成功。

关联 backlog D：本轮同根 reset 若未发生，跨压缩认知连续性仍未验证；不将 capsule 保存当认知连续性。

## 恢复核对（2026-11-11）

按宪法 v1.2、George 原则与 t810、FINAL 重新核对已有设计和 `1935b112` 实现，没有重做第一步。恢复时 v2 A 已发三个任务请求后被 Codex usage limit 中断，无存活进程或可恢复任务续点。保留原 A，第三请求的 97973 tokens／USD2.45098 继续占账，不重跑或补造会话；仅继续未开始的 B1/B2。原 round-plan 的四小时起点及中断时间不变。一次 prepare 来源目录错误在 provider 启动前失败，改为 assets 后准备，没有重复付费请求。

恢复时复查 Node 19/19、Python runner/实际 Pi 接线 14/14（37.76 秒）通过。脚本 provider 与真实 Pi/Edge 证明接线，不证明真实模型采用或收益。

## 真实失败后的设计修订与独立诊断

观测：A 外部中断；B1 四次 exit 的 result 都是 JSON 字符串，被对象契约拒绝，一次 enter_mode(execute) 因审阅未关闭被拒，第十一次任务响应后下一请求因许可不足在发送前停止；B2 第四任务请求 terminated。B1 原始预算停机未记录 incomplete，是实现生命周期缺陷，不把它解释成 Agent 决定。证据见 ROUND-v2 及逐臂 summary、budget-stop、原日志。

归类：出口传输契约丢失是接口设计/实现问题；预算拒绝未关闭事务是实现问题。涉及宪法同一主客体、META 权责与审阅结案契约。修复复用当前审阅钉住的 Agent 出口 schema，provider decide 在 op=exit 时才约束 result；普通编排仍为 Any，不按模式名限制，不替 Agent 定结论。保留对象验证，拒绝解析错误字符串、提示催促、宿主代写 keep 或 unrelated。预算 guard 与 provider 许可拒绝先持久化 absent/incomplete，再技术退出；不伪造 Agent defer 或采用。输出额度在反射激活前校验模型注册上界。提交为 `a91b0a68`。

原三臂合计 21 请求、517104 tokens、USD12.28068。修订前预注册一次独立诊断，使用剩余 579 请求、82896 tokens、USD2.71932 以内的余额、原四小时及 2GB 上限，相同 provider/model、十五页 brief、十单元和真实 renderer/checker。目标仅判断出口 schema 是否传达且由同一 Agent 合法结案、停机是否保留 incomplete；不替代原 A/B 样本，不重复运行原会话，不自动 retry，不增加 reviewer 或抬 cap。诊断小 completion 预检被远端断开，任务 Agent 未启动，无重试。原三臂 hash 与最终源码差异分别记录，原证据不追改。

## 最终结算与验证

含诊断共 22 请求、521394 入账 tokens、USD12.36744 保守费用，墙钟 8562.855 秒，运行目录 32823631 bytes，均在用户 cap 内。未知部分仍保留 157608 tokens／USD4.13616；实际账单未知。没有产物，数字和引用质量未测量，不记零分；运行自修订、有效结案、试用/采用/恢复均无证据。详细逐臂、逐单元结果见 [ROUND-v2](ROUND-v2.md)。

最终 Node 20/20、Python runner 10 项、实际 Pi/Edge 脚本 provider 接线 6/6 通过。独立只读开发复核确认当前 Pi 传输保留 allOf；真实 HTTP/模型遵循未验证。默认窗口可能错过最终交付结束事件、adopted 标记不足以证明真实指标比较等 v1 遗留仍未修复，详见报告；不称优化验收。收尾修复了 shell 写入损坏的中文追加段并同步 UTF-8 外部副本，没有更改原始实验数据。
