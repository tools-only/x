# ROUND-v2：有界执行与反馈接口修复，真实任务未交付

日期：2026-11-11（Asia/Shanghai）。**实现与有界实验已完成，任务失败，优化尚未验收。** 权威依次为宪法 v1.2、George 两原则及 t810、FINAL。同步副本：`C:/Users/qi/tmp/r04/evo-design/ROUND-v2.md`。沿用原 ANALYSIS-v1，没有重做第一步。

## 1. 设计改动与实现

主要命题：将 provider 请求、结算和真实工具反馈接入同一 Agent 的有界执行循环，能在原预算内到达窗口审阅及任务交付。本轮到达审阅而没有交付，不支持完整命题。根因分类、宪法对应及拒绝的权宜方案见 [ANALYSIS-v1](ANALYSIS-v1.md)。

| 设计改动 | 实现 | 替代的负担及边界 |
| --- | --- | --- |
| 按实际请求负债预留，完成后按 usage 结算 | `demo/provider_permit.ts`、`demo/ppt_demo_extension.ts`、`evo_ppt.resource_usage` | 去掉按模型最大上下文/输出预扣；未知 usage 保留负债，不清零 |
| 有界输出段 | `SelfRoot.policy.request.maxOutputTokens=8192`，Agent 可反射修改，实际 payload 使用该值 | 一次输出后可接收工具反馈；length 后从同一历史继续，不重试原请求，不自动加额度；激活前校验模型上界 |
| 验收事实直接返回 Agent | `self_root_ppt.collectAcceptance`、office.render 返回 checker 事实 | 取代只记在 ledger 的反馈；保留产物 hash，不由宿主诊断 |
| 区分字面匹配与表示归一化 | 保留 literal 探针，增加 token 边界、符号及 slide 范围的 normalized 检查 | 不改冻结材料、30 个数字探针或引用目标；数字存在不等于任务正确 |
| 全稿交付覆盖单元；独立臂共享余额 | runner、交付记录；一次小 completion 验证精确模型及推理能力 | 去掉重复十次机械提交、固定三臂预扣及重复 GET /models；失败及 pending 全计 |
| 出口携带同根 Agent 的结构契约 | `a91b0a68`：provider JSON Schema 仅在 op=exit 时约束 result 为钉住的 Agent 出口 schema | 普通 decide 不受出口约束；不解析错误字符串或代写结论 |
| 预算停机关闭未完成事务 | guard 与 provider 许可拒绝先 closeIncomplete 并持久化 | 记录 deferred/incomplete、agent_decision=absent；不冒充 unrelated、采用或恢复 |

复用 SelfRoot、反射、policy、ledger、模式/MOP、窗口和 renderer，没有新增任务 Agent、归因词表、重构触发表或宿主采用。许可在 message_end 结算，未知负债保留至本轮结束；render 事实由下一普通请求消费，新 hash 反馈替代当前视图并保留历史。窗口比较与采用/恢复仍由同一 Agent 决定。未增加强制自改或提示催促。

## 2. 工程版本、恢复和协议

- v1 记录 `b85add88`，v1 实现 `b3ba1ff8`；本轮三个原始臂冻结在 `1935b112`。
- 恢复时 A 已发三个任务请求后被 Codex usage limit 打断，无存活进程、summary 或任务续点。保留证据及未知许可，不重跑 A，仅启动未开始的 B1/B2。原四小时起点不变，中断也计时。
- 一次 B1 prepare 误将来源父目录当作 assets，在 provider 启动前失败；修正来源后准备，没有重复付费请求。
- B1 失败后定位出口传输 schema 与预算关闭缺口，提交通用补丁 `a91b0a68`，不追改原日志。在同轮余额内预注册一次独立出口诊断，使用相同普通 brief、材料和十单元，不替代原三臂。
- 诊断小 completion 预检被远端断开，任务 Agent 未启动；按协议不重试。原臂结束时捕获并校验 source/checker hash，最终源码差异另列，不把当前 hash 冒作运行版本。

环境：Windows、Pi 0.87.0、Node v25.5.0、真实 Edge headless；`az / qwen3.8-27b`、openai-completions、thinking=low，temperature/top_p 使用 provider 默认。同一 Bank of America Q3 2021 普通 brief，十五页演示 HTML、十内容单元，不是 native PPTX。任务启动使用 `--no-context-files --no-skills`，不注入仓库 AGENTS.md，无任务 child、心跳或自动 retry。独立只读开发审查未进入任务运行。A 保留最多六十请求/1800 秒探索上限；B 使用实际总余额，均为探索样本。

## 3. 真实逐臂及逐单元结果

**三个任务臂均无任务产物、render、look、delivery，任务 checker 没有运行。** 各臂真实 Edge 一页预检通过。脚本 provider 的十五页渲染/检查/交付测试不能算真实 Agent 交付。

| 臂 | 请求（预检＋任务） | 实际行为及停止 | 交付 |
| --- | ---: | --- | --- |
| A | 4（1＋3） | 外部 usage limit 中断；第三任务请求 usage 未知，保留许可 | 0/10 单元、0/15 页 |
| B1 | 12（1＋11） | 进入 reflect、读取材料及 policy；四次 exit 的 result 为 JSON 字符串而被拒；一次 enter_mode(execute) 因审阅未关闭被拒；下一请求因负债预留不足在发送前停止 | 0/10、0/15 |
| B2 | 5（1＋4） | 进入 reflect；第四任务请求 terminated；usage=0 不当零成本；技术关闭 incomplete | 0/10、0/15 |
| 补丁诊断 | 1 次预检 | `Remote end closed connection without response`，任务未启动 | 不适用 |

数字与引用质量均**未测量**，不能写零分或通过，不能将 v1 的 13/30 数字、0/10 引用解释为本轮改善。

| 冻结单元 | A | B1 | B2 |
| --- | --- | --- | --- |
| unit-01／1 | 未交付、未测量 | 未交付、未测量 | 未交付、未测量 |
| unit-02／2 | 未交付、未测量 | 未交付、未测量 | 未交付、未测量 |
| unit-03／3 | 未交付、未测量 | 未交付、未测量 | 未交付、未测量 |
| unit-04／4 | 未交付、未测量 | 未交付、未测量 | 未交付、未测量 |
| unit-05／5 | 未交付、未测量 | 未交付、未测量 | 未交付、未测量 |
| unit-06／6 | 未交付、未测量 | 未交付、未测量 | 未交付、未测量 |
| unit-07／7 | 未交付、未测量 | 未交付、未测量 | 未交付、未测量 |
| unit-08／8 | 未交付、未测量 | 未交付、未测量 | 未交付、未测量 |
| unit-09／9 | 未交付、未测量 | 未交付、未测量 | 未交付、未测量 |
| unit-10／10 | 未交付、未测量 | 未交付、未测量 | 未交付、未测量 |

B1 错误 toolCall 的字符串内容不是有效结案，不由宿主替 Agent 完成。补丁将已有出口 schema 传到 provider，最终真实 HTTP/schema 遵循仍未验证。

## 4. 成本和预算

下表为已知 usage 加未决许可的保守预算账，实际账单未知；cap 未提高。

| 阶段 | 入账 tokens | 入账 USD | 未知部分及耗时 |
| --- | ---: | ---: | --- |
| A | 122590 | 2.95898 | 未决 97973 tokens／$2.45098；外部中断计入总墙钟 |
| B1 | 316692 | 7.11006 | 已结 usage；runner 675.125 秒 |
| B2 | 77822 | 2.21164 | 未决 55345／$1.59842；runner 87.469 秒 |
| 诊断 | 4290 | 0.08676 | 全部为断开预检的未知许可；预检约 2.25 秒，另有 renderer 时间 |
| **合计** | **521394／600000** | **12.36744／15** | **未决 157608 tokens／$4.13616；8562.855／14400 秒** |

请求 **22／600**，运行目录 **32823631／2147483648 bytes**（31.30 MiB）。墙钟从原 round-plan 起点至诊断终止，含约两小时恢复中断及准备。三原始臂小计 21 请求、517104 tokens、$12.28068。余额仍有剩余：B1 因下一请求许可不足而停，不表示总 cap 已耗尽；诊断因远端断开停止。

已报告 input **347860**、output **15926**，合计 **363786**；output 含 reasoning **14010**，不重复相加。保守 cap 使用 20/80 USD per million；注册 5/30 对已知部分估算 **$2.21708**，不抹去未知许可或替换 cap 账。

B1 十一次任务响应 output 共 3145，相比 v1 单次 48236，单步缩短，但没有形成任务反馈循环或收益。短样本未观察到新三百秒挂起，不能认定环境故障已消除。

## 5. 运行自修订与工程提交分账

| 项目 | B1 | B2 | 判定 |
| --- | --- | --- | --- |
| root_id | a9290fab-3fbe-4725-8905-3070c00a74c1 | f8fa7d76-a0ec-4df6-8ea4-5558ea417d39 | 独立同种子根 |
| SelfRoot serial | 1→1 | 1→1 | **Agent 自修订零**；legacy_self_revision=2 是 seed |
| floor 审阅进入 | 1 | 1 | mode_entered 及随后真实请求可见 |
| 有效 Agent 审阅结论 | 0 | 0 | B1 字符串 keep 未通过契约 |
| 技术关闭 | 原日志缺失 | deferred/incomplete、agent_decision=absent | B1 active review 缺陷保留，补丁测试不回填历史 |
| restructure／trial／adopt／restore／reset／继承 | 均为零 | 均为零 | Git 提交不能替代行为证据 |

B2 incomplete 是服务记录未完成事务，不是 Agent 自主 defer 或归因。

## 6. 验证与剩余偏差

最终 Node **20/20**、runner Python **10 项**、实际 Pi/Edge 脚本 provider 接线 **6/6**（31.69 秒）通过。覆盖许可/未知负债、反射上界、MOP、出口 schema，以及 guard 的 hard budget 与 provider 许可拒绝两条 incomplete 持久化路径。测试曾误把 JSON 省略的 undefined 字段要求为 null，且最初只测 guard，修正后补齐两条路径。没有宣称全仓通过：历史 `tests/ppt_demo_live_orchestration.test.ts` 旧接口断言及异步初始化问题仍在，见 ANALYSIS。

| 证据层 | 结果及边界 |
| --- | --- |
| 功能正确 | 针对修复通过；不代表所有 FINAL 要求已实现 |
| 全链路可达 | 脚本 Pi 通过；真实模型到达 floor，未到任务 renderer/checker/delivery；最终补丁真实模型未验证 |
| 自主采用 | 无有效证据：零结案、零自修订；审阅进入不能代替采用 |
| 净收益 | 未证实：A 中断、B 无交付，样本和协议不足 |

相对 FINAL 的主要剩余偏差：

1. 最终出口修复缺真实模型验证：脚本证明 schema 保留到 provider context，诊断预检断开。下一可证伪检查是实际 payload 与同一 Agent 的合法结案，不新增 reviewer 或提示催促。
2. P0/P2/P3 反馈、重构、试用比较与采用/恢复未发生；不能强制自改或将 keep 视作失败。
3. 最终交付审阅中新建的默认窗口可能错过 before_session_end：首次 deliver 已发该事件，同 hash 再交付去重。这是 v1 遗留，本轮未触发且未修复；预先已有窗口仍可到期。
4. adopted 标记不足以证明指标比较：当前可缺 task_outcomes 而 delivered，adopt 只要求 reason。需结合 Agent 比较原文、真实结果及后续行为；本轮无采用，不称已满足。
5. P1/P4/P5 连续性、预测收益、跨任务复用未验证。无 reset；backlog D 仍开放，capsule 保存不算认知连续性。HTML 不等于 native PPTX。

保留为 **v2 实验实现**，不宣称满足 FINAL 或优化有效。本轮无重试诊断已结束；后续付费检查需单独授权。

## 7. 证据与版本

- [逐臂/单元及 SHA-256](evo-v2-real/results.json)、[三臂账](evo-v2-real/three-arm-accounting.json)、[最终账](evo-v2-real/final-accounting.json)。
- [诊断预注册](evo-v2-real/diagnostic-plan.json)、[诊断结果](evo-v2-real/diagnostic-result.json)、[独立开发审查](evo-v2-real/audit.md)；目录保留逐臂 manifest/summary/preflight 和恢复/导出脚本。
- 原始日志：忽略目录 `runs/evo-v2-real-20261111/`。归档不复制 `.pi-agent` 认证文件或 API key。
- 工程提交 `1935b112`、`a91b0a68`；报告证据提交后创建本地 `v2` 标签，用 `git rev-parse v2` 定位，不推送。
- 收尾发现先前 shell 写入把中文替换为问号，本报告及 ANALYSIS 追加段已依据原数据重写为 UTF-8 并同步外部副本；不改变实验轨迹或预算。
