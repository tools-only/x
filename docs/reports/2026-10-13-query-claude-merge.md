# Claude / 按需观测合并记录

日期：2026-10-13。状态：合并候选已验证；实际部署以 deployment-result.json 为准。遵循 docs/development-workflow.md。

## 问题与命题

用户要求核查并合并 Claude 最新优化和 Codex 按需观测改动。两工作树 HEAD 同为 9c315713，功能主要还在未提交工作区，因此普通 git merge 会遗漏它们。Claude 最新内容在 D:/autoresearch_pi_activation_20261013，Codex 在 D:/autoresearch_pi_query_observations_20261013。

窄命题：在保留 Claude 执行/计算会话/版本/历史/refinement/budget 行为的同时，使 query 观测默认生效；精确查询、持久化与行动能在同一候选内工作。减少手工集成负担，不新增 runtime 工具、Agent 或管理义务。丢失任一已有修改、恢复完整网格自动注入、持久化/闭环行动回归或权限变化均推翻命题。

## 设计与成本

复用现有按需观测实现：以 Claude 实际工作区的805文件为快照，叠加已核查的10文件，候选置于当前可写工作区 runs/query-claude-merge-20261013/candidate。除观测相关八个已有代码文件、两项新增代码/测试和记录外，两者相同；后续整合只写最小差异，不以目录覆盖 Claude。同步旧架构文档中 full-grid 驻留约定。机会、投入、合并和保留由开发 Agent 推进；snapshot、hash、差异与验证机械执行；Pi task Agent 不收此记录。

权限、版本和环境边界保持；部署前重新校验 Claude 文件 SHA256，变化则重新比对。整合既有未提交修改不等于两分支 git merge commit。冻结实验保持，不启动付费 provider。若只完成候选则明确源目录未修改。

## 运行前实验协议

目标：功能及限定的 Pi/bridge 接线诊断，未验证自主采用/净收益，不声称完整 ARC self-harness acceptance。Node 验证 query/inline、历史、图像、只读边界、namespace 和 saved env.act；既有 Python recovery/accounting 回归。随后串行真实 Pi 0.87.0 / bridge / mock ARC SDK / scripted provider 的 query defaults、activation defaults、components 场景，避免 Claude 已记录的并行 WASI 超时混杂。每场至多240秒，各自原有3/9/7决策上限；异常保留并只修本次集成相关问题。检查语义值、作用域及后续父轮，fixture 模型 tokens 不算性能证据。

## 实现与验证

基线及叠加清单见 [source-manifest.json](D:/autoresearch_pi_project/runs/query-claude-merge-20261013/source-manifest.json)。该 hash 保存未提交源内容，不能用 HEAD 单独代替。所有非观测相关 Claude 内容逐文件保留；其协议 need_act/acts、只允许保存代码行动、readonly 拒绝、replay 一致性和 restore 路径再校验已审阅，无与 query 交付冲突的分支。Python 的 state/history 是调用起始快照；行动循环的新网格用 env.grid 或 env.act 返回值，未将新 state['frames'] 宣称为循环内实时数据。

检查结果：

- Node 25.5.0：`node --experimental-transform-types --test --test-concurrency=1 tests/arc_thin_query_observation.test.ts tests/arc_thin_native_context.test.ts tests/arc_thin_workspace.test.ts tests/pi_arc_frame_image.test.ts tests/arc_thin_native_runtime.test.ts`，10/10通过。覆盖动画/历史/RESET/缺帧、模式校验、PNG显式读取、数据只读、路径及既有 guest 文件读取。
- `D:/conda/python.exe -m pytest tests/test_arc_thin_recovery.py tests/test_arc_thin_request_accounting.py -q`，14/14通过。
- `D:/conda/python.exe tools/run_foundation_smoke.py <root> query defaults`：3决策/3动作，通过。查询值[2,1]→[3,2,2]→[4,3]，默认 user 无图片、工具显式 read 有图片；refiner无完整网格，原生自动压缩保持开启。
- 同命令 `activation defaults`：9决策/13动作，通过。saved env.act、停止反馈、then动作序列、ignored_xy/change回执、跨决策函数/值会话、当前决策reasoning及refiner保护Agent文件均通过原有断言。
- 同命令 `components`：7决策/7动作，通过。prompt、memory、skill按需读取、工具变更/失败版本恢复、view、readonly consult子代理及原有provider length continuation检查通过。这是native consult诊断，不是普通delegate_task/Auto-Research全矩阵验收。

原始产物：[query](D:/autoresearch_pi_project/runs/query-claude-merge-20261013/query-defaults/summary.json)、[activation](D:/autoresearch_pi_project/runs/query-claude-merge-20261013/activation-defaults/summary.json)、[components](D:/autoresearch_pi_project/runs/query-claude-merge-20261013/components/summary.json)，各目录保存smoke-requests、session、run-config、usage及相应child/refiner日志。全部Pi场景串行执行，没有新付费模型调用；脚本返回固定虚拟token，不作为效率计量。

环境异常：Node初次在Windows沙箱内无法spawn测试子进程（EPERM），未执行功能用例；按照沙箱要求获准在沙箱外重跑后通过。真实Pi smoke也按同一授权运行。没有为过测修改运行时上限或放宽既有断言。

观测实现没有替代Claude尚未实现的host-served guest数据协议；磁盘扫描、replay成本、JSON会话的持久化限制仍见两份原始记录。新增runtime常驻schema/worker/管理轮为0；原始数据存储、查询结果大小和检索往返计入后续真实对照，而不是隐去。

| 证据层级 | 状态 | Provider / environment | 产物及结论边界 |
| --- | --- | --- | --- |
| 功能正确 | 通过 | Node / Python / HTTP test bridge | 10 Node、14 Python，查询与既有行为兼容 |
| 全链路可达 | 本次路径通过；完整验收未验证 | 真 Pi/bridge + mock SDK/scripted provider | query、activation、components；完整 ARC/Auto-Research closure 未验证 |
| 自主采用 | 未验证 | 无付费 provider | 脚本不证明自主使用 |
| 净收益 | 未验证 | 无独立对照 | 已有输入表示差异不证明任务/总成本收益 |

## 交付决定

合并候选通过，准备应用14文件的最小差异；不移动HEAD、不替用户提交Claude原有工作。部署脚本重新校验全部805个基线文件和候选差异hash，写入前保存原文件，原子替换各目标；源漂移即停止，失败回滚不会覆盖并发的新写入。当前冻结r2的extension位于自身runtime目录，与本次目标工作树不同，不做重启或配置切换。Windows当前可写范围不包含Claude工作树，实际应用需要该目录写入的沙箱授权。

关联 deferred-research-todos 的 B/D：自主使用、父子总成本和跨压缩认知连续性保持开放；本次证明可集成性，未证明任务净收益。实际应用状态另由 deployment-result.json 确认。
