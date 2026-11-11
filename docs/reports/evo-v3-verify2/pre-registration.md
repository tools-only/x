# v3-verify2 预注册：独立 USD30、无 token cap、仅 B1 一次

日期：2026-11-11（Asia/Shanghai）。状态：真实模型调用前注册。不是新设计轮；不 push。权威顺序：宪法 v1.2 > FINAL §1.2 George 两原则及 t810 > FINAL。用户本次明确授权替代旧预算：t820u 继续验证先 B，t822u 改为30美元，t823u 取消 token 上限，t824u 每臂30美元，t827u 仅跑 B1。本次只执行 **B1 一次**，不执行 B2/A，不自动重试、不补跑环境失败。

## 真实问题、窄命题与负担

v3-verify 的 B1 在模型预检远端断连，没有任务样本；B2 合法 keep 后尚无任务文件，下一许可同时受 token/USD 限制。本次窄命题：同冻结 v3，在独立 USD30 且 token 不限制许可的暴露下，B1 能否完成“合法审阅结案→实际任务工作→运行内渲染/查看/检查→15页完整交付及10单元验收”，以及同一主体是否自主修改、实际使用、验证并决定采用/恢复。保持、不相关、暂缓是合法结果，不强迫修改；技术 incomplete 不是 Agent 决定。未闭合即不支持相应可达/交付命题；不足以归因于模型拒绝、设计无效或预算必然不够。

复用 freeze/run 与原有同根协议；独立 B1 启动脚本替代旧多臂共享调度。任务 Agent 无新增提示、字段、服务、worker 或管理决策。预算在臂入口及原许可点生效，实际动作通过原工具回执/ledger/自身视图继续反馈；臂结束后该实验配置退休。工程报告不进入任务上下文。预先中断的 Codex 用量限制日志 `C:/Users/qi/tmp/r04/evo-design/evo-v3-verify2-aborted-limit.log` 保留；启动前 runs/ 只有旧 v1/v2/v3/v3-verify 根，未发现 verify2 的模型调用，不计为样本，也不删除。

## 冻结配置和独立预算

- 基点 HEAD 061fd980；设计 v3=b5a3879c，旧 runner v3-verify=c1396cb6。只改实验 runner 的无 token cap 数值兼容，增加单 B1 启动脚本、测试与本预注册；付费前本地提交并标 v3-verify2。Agent/runtime/review-service/provider_permit/renderer/checker/提示一律不改。launch.json 记录精确提交、预注册 SHA256，manifest 记录 seed hashes。
- Windows、Node v25.5.0、Python3.12.7、checkout Pi0.87.0、本机真实 Edge。真实 az/qwen3.8-27b、openai-completions、thinking=low；temperature/top_p 不提供。原注册 contextWindow175000、maxTokens65536，输出量子8192，不改变模型本身上下文/输出限制。
- 同 Bank of America Q3 2021 assets、15页自包含 HTML brief、同10单元及顺序、literal-normalized-render-v2 checker；freeze 后与 v3-verify B1 的 sources/units/checker/settings 逐项比对，差异时付费前停。非 runner seeds 启动前 hash 核对。HTML 不等同 native PPTX。
- `--no-context-files --no-skills`，自动压缩/retry/heartbeat/任务 child/默认继承关闭；同一串行历史继续 length，不重发相同请求。不注入开发 AGENTS、宪法或报告。只保留已有任务入口，不加“请反思/请修改”引导。
- **B1 独立上限：USD30（input/cache20、output80 USD/M），600请求，14400秒，2147483648 bytes；无 token cap。** 模型预检、失败、pending 均计入，freeze/真实 renderer 预检消耗臂墙钟。没有共享池、45%限制或旧 token/美元预算。任一有效 cap 不足下一许可即停，不提高 cap、不降低估算。
- 冻结 runtime 只接受有限数字 token cap，因此 runner 接受明确 `tokens=null`，转为 `9007199254740991` 的非约束兼容值，并在 manifest.token_budget 记录授权 null。600×(175000+65536)=144321600，远低兼容值；此请求边界内 token 维度不会拒绝任何许可。USD许可估算仍为 UTF-8 bytes+4096 framing，受注册 context 上界约束，output8192；完全不改 permit 代码。报告不能把兼容值称为用户 token 配额。token/provider usage/缓存/推理仍原样计量。未知请求留原许可负债，不能记零。
- 并列报告注册价 input5/output30/cacheRead0/cacheWrite0 USD/M，仅为计价估计，不用于扩大保守预算，也不称真实账单。output 已含 reasoning，不重复相加。
- 原始根 `runs/evo-v3-verify2-20261111/sample-B1`；证据目录 `docs/reports/evo-v3-verify2/`。B1 模型预检若再失败，按 environment 结束整个实验；绝不自动重试、切 provider、运行其他臂。

## 指标、比较、负例及停止

逐臂和10个逐单元报告运行内 render/look/checker/delivery、已交付和已证实通过/10、renderer 实测页数/15。未渲染即页数未测；无验收不能把0已证实当实测质量0分。字面数字全中且精确引用是冻结窄主口径，归一化数字/等价引用另列；语义归属、叙事、审美不由数字命中担保。

全部 mode_entered 与 review_closed 成对核对，含 execute 模式事务：触发、取证、changed/unrelated/deferred/keep/incomplete、agent_decision present/absent、回工作及后续动作。记录 Agent 运行自修订与工程提交分账；逐版本 Created/Shown/Called/Covered、窗口注册/到期、adopt/restore 和未决。模型/工具/schema/预算失败、length、纯推理、合理不改均保留。

若有残稿而无运行内 render，允许在剩余时间/存储内用同真实 Edge/冻结 checker 作独立事后检查，最多一次，不发模型请求，不回流已结束 Agent，不算运行内查看或交付。只有实际看图才称“已看”。未到达路径全部标未验证。

比较 v3 与 v3-verify 的 B 暴露、审阅出口、自改、产出和任务反馈。预算、顺序、模型随机轨迹不同；只有本次 B1 一个样本，无本次 A/B2，不作匹配预算因果或净收益结论，不把历史 B2 当本次重复。完整15页/10单元是任务目标，审阅数/版本数不是替代指标。

停止包括 delivery、正常文本结束、预算/时间/存储边界、provider/runtime/环境失败。所有费用包含失败和未知预留，停止时即使有余额也不降下一许可。无自动 retry/resume，无第二付费实验。结果、证据导出、报告封存计入时间/逻辑字节单列，Git记录/调用方Codex会话成本属于开发账。

## 验证与决定

runner 测试覆盖 null→非约束有限值、原 numeric cap 不变、所有授权请求的 token 许可总界、单 B1 独立完整预算、renderer消耗截止、环境失败不重跑及 fresh-root 拒绝。真实行为不从测试推断。四层分别为功能、全链路、自主采用、净收益；L0–L3按 Agent自创工具真实使用及后续影响判定。D类认知连续性待办保持开放，只有真实reset才检查语义连续性；本次不启动连续性设计。

写 UTF-8 中文 `C:/Users/qi/tmp/r04/evo-design/ROUND-v3-verify2.md`，仓内副本及原始证据链接。即使 environment 失败也完整报告，标未测路径，不把失败预检当任务样本。最后保留 v3 实验状态，不在此授权内另开设计或付费运行。
