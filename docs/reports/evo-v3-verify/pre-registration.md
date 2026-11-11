# v3-verify 预注册：B 臂优先的单次验证

日期：2026-11-11。状态：运行前冻结；结果另见 ROUND-v3-verify.md。本次为 George t820u“continue validating, run B first”授权的一次真实付费验证，不是第四轮设计。优先关系：宪法 v1.2 > FINAL §1.2 中 George 两原则及 t810 > FINAL；本次明确授权覆盖旧实验顺序与 A 的校准起点限制。

## 问题与命题

v3（b5a3879c）按 A→B1→B2 共享余额，A 消耗保守 USD11.98238；B1/B2 在合法审阅出口前因许可不足停止。窄命题：只改变顺序和实验臂上限，能消除 A 对 B 的资源先占，让两个独立 B 样本先获得有界真实暴露；能否合法结案、返回工作、自主修改并完成交付由事实决定。合法结案或交付仍未发生，会反驳“此次暴露足以闭合这些路径”；不会据此推断模型拒绝改进。没有修改必要时，合法 unrelated/deferred/keep 是允许结果；技术 incomplete 不是 Agent 决定。

## 选择、成本与生命周期

仅扩展现有实验 runner 的显式阶段配置，复用 freeze、run、同根协议、许可及真实渲染/验收。B1、B2、A 各运行一次，不启动阶段二。新增父 Agent 运行中决策、常驻提醒、schema、服务或 worker 均为零。调度约束由实验 runner 在臂入口生效，原始日志自然进入运行自身视图/反馈；开发报告不进入任务上下文。下一真实动作仍沿 v3 工具回执和任务事实回流；臂结束后调度配置退休，不产生额外运行义务。预算拒绝、错误、结束后不重跑、不补提示、不借未用额度另起诊断。

## 运行前协议

- 工程基点：v3^{commit}=b5a3879c962a102adbe07749aaa10a4ec4eddec0；runner-only 变更及测试在付费前本地提交并标 v3-verify。精确提交及源 hash 由 manifest/启动记录保存。不 push。Agent/runtime/review-service/permit/提示/renderer/checker 不改。
- 顺序固定 B1→B2→A：目录 sample-B1、sample-B2、calibration-A（A 目录名仅沿用历史）。A 最后用真实总余额，不再应用旧 60 请求/1800 秒校准起点。各臂空 workspace、同源独立种子，不继承 B1 的修改。
- 同一 Bank of America Q3 2021 assets、十五页自包含 HTML brief、10 个 content_units。逐项 hash 与 v3 manifest 比较，材料、brief、units、checker 和所有非 runner seed 必须一致。HTML 不等于 native PPTX。
- 真实 az/qwen3.8-27b，openai-completions，thinking=low；注册 contextWindow=175000、maxTokens=65536，实际请求输出量子8192；temperature/top_p 未提供。注册价 input5/output30/cacheRead0/cacheWrite0 USD/M，另报保守预算价 input/cache20、output80 USD/M。均不是实际账单。
- 实际 Pi 0.87.0 + 本机真实 Edge headless + 冻结 literal-normalized-render-v2 checker。启动 --no-context-files --no-skills；关闭自动压缩、heartbeat、自动 retry、继承、任务 child；同一串行历史的 length continuation 沿用 v3，不是重试。不注入开发 AGENTS、宪法、报告。
- 总上限：600 requests、600000 tokens、14400 秒、USD15、2147483648 bytes。B1 和 B2 各最多：270 requests、270000 tokens、6480 秒、USD6.75、966367641 bytes（整数维度向下取整）。每臂取自身上限和实际总余额的逐项较小值；A 仅取余额。冻结/renderer preflight 消耗臂墙钟；模型预检、失败、pending 均计入各臂和总账。臂时间从 freeze 前开始；总时间从单次编排开始，最终账另包含有界事后检查与报告封存。
- v3 许可估算不变：实际序列化 UTF-8 bytes +4096 framing，受注册 context 上界约束，输出8192；未知已发请求保留原许可负债。余额不足下一许可即停止，不降估计、不涨 cap。未知 usage/发出未决不得记零。环境故障记录为环境，独立臂按注册顺序继续，不对失败臂自动重试。
- 主指标：每臂运行内 render/look/checker/delivery，逐单元事实及通过/10、页数/15；全部进入的 review 及 changed/unrelated/deferred/keep、agent_decision present/absent；Agent 自改、后续实际版本使用、验证窗口到期与 adopt/restore；父子总请求/tokens/USD/时间/存储与停止原因。
- 单元通过沿用冻结 checker 的 reported literal passes；归一化事实单列，不事后改标准。页数以实际 renderer receipt 为准。无 renderer/验收时标未测，不能从源码 section 数冒充已验收页面。交付计数和质量通过分开。
- 若保留残稿而无运行内 render，允许在总时间/存储余量内用同一真实 renderer/checker 作独立事后测量，限每臂一次；不回流已结束 Agent，不算运行内 render/look/交付。联系图实际查看后才写“已看”。
- 主要比较：v3 的早停暴露与本次 B 优先暴露；本次 B1/B2 独立行为及 A 余额基线。不以单次、预算不匹配的 A/B 差异声称净收益或因果优越。任务目标是完整十五页及十单元交付；任何缺失都报告，不用结案数或自改次数替代质量。
- 负例：合理不改、材料读取占满额度、schema/调用失败、length、远端错误、检查失败、pending、预算/时间耗尽、窗口未到期均保留。除功能测试外，本次不构造或强制模型走出口/修改/采用路径。

## 验证和交付决定

runner 测试核对 B 顺序、每维45%拒绝、A真实余量、renderer时间消耗臂/总截止、旧顺序兼容；测试只证明功能。真实运行四层分别报告：功能、全链路、自主采用、净收益；未到达阶段标未验证。L0–L3 只按 Agent 自创组件的真实调用及后续影响认定。D 类认知连续性待办只在本次真实 reset 发生时核对，否则继续开放；本次不另改连续性设计。

结果输出 C:/Users/qi/tmp/r04/evo-design/ROUND-v3-verify.md（UTF-8），仓内同名副本及非认证证据索引在 docs/reports/；原始 runs/evo-v3-verify-20261111。工程提交与 Agent 运行自修订严格分账。结果无论成功失败都不启动新设计或新收费运行。
