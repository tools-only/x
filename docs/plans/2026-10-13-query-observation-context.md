# Native ARC 按需观测变更记录

日期：2026-10-13。状态：实现及本次路径诊断完成；自主采用和净收益未验证。遵循 docs/development-workflow.md。

## 问题与命题

真实 uncapped ls20/Qwen 轨迹中，父模型反复在推理里处理坐标与帧差分；此前诊断见主工作区 runs/arc-activation-all-uncapped-20261013/diagnostics/efficiency-20261013/analysis.md。当前 native 每轮自动展开完整网格，视觉模型还自动收图，refiner 也自动收网格。用户明确要求改为原始数据留在上下文之外，仅交付主动查询结果。

窄命题：native 默认父上下文及 refiner 不再自动包含原始帧；完整当前/历史/动画帧、PNG 仍可经现有 python/read 查询。减少常驻数据和手工定位负担；不预先声称能减少隐藏推理或提升通关率。任何像素丢失、引用过时、自动图片泄漏或权限放宽均推翻功能命题。已有 Agent 创作的 view 和主动查询结果仍可进入上下文。

范围：观测交付一个主因素；复用最新 Claude 开发基线，保留其回执、计算会话、推理和 refinement 修改。隔离工作树 codex/query-observations-20261013；既有冻结实验不变。旧 legacy 模式保持。默认持久化强化不在此次改动内。

## 设计与成本

runtime 自动保存完整公开观测及 PNG，父默认只收状态、动作索引、尺寸、预算和精确引用。python 的 grid/prev_grid/history 与 state.frames 供计算，read 供精确文本/图片。无新工具 schema、worker、强制检索步骤或行动门禁；需要原始数据时多一次实际查询，因此低成本一眼可判的任务可能增加延迟。显式 ARC_THIN_OBSERVATION=inline 可恢复原交付以便对照；不能回退环境历史。

机会→识别由 Agent 根据当前元数据推进；投入/查询→计算→语义行动由 Agent 选择；原始资料落盘、版本索引和权限由 runtime 推进；反馈复用动作回执，保留/修订由获授权 Agent 判断。无需新候选或装配流程。图片增加磁盘和渲染成本，不进入默认 provider 请求。data/results 只读、路径隔离及桥接授权保持。

## 运行前实验协议

本次目标是功能诊断及实际 Pi/bridge 查询路径诊断，不声明完整五类 Self-Harness 闭环。比较同一 mock 初态的 query/inline；先红测试，再功能/回归，最后确定性 provider 的实际 runner smoke。无新付费 provider。smoke 最多 3 决策、240 秒，失败保留日志后停止；Node 检查按针对性文件运行。负例覆盖 unavailable、动作后/RESET 新状态、多动画帧、图片显式读、文本模型及只读权限。默认用户输入不得含原始网格或图像；查询结果必须对应同一 canonical n，PNG 可解码且所有动画帧可恢复。字符缩减只算机械输入差异，模型 token/推理/净收益未测。

## 实现与验证

入口：demo/arc_thin_observation.ts 保存所有动画帧及逐帧 PNG，生成带 canonical n 和网格 SHA256 的状态引用；arc_thin_extension.ts 采用 query 默认、当前 Python frames、refiner 元数据及日志字段；workspace 的 read 识别 PNG 并保持原像素，native snapshot 不再把 PNG 解码为 guest 文本；runner 的 run-config 记录实际 observation_delivery。data/current.json 保留 grid 的兼容读法，并在无帧时置 null。query 不隐式展开 prev_grid。显式 ARC_THIN_OBSERVATION=inline 复原旧父观测方式。

继承的 Claude dirty diff 不计为本次实现；基线 patch 为 D:/arc-query-observation-baseline-20261013.patch。隔离期间 Claude 将 changed_cells 限制在 native 的兼容性修复已同步，旧 legacy 回归因此保持。

功能检查（Node 25.5.0，--experimental-transform-types）：

- 首次新增测试在旧代码上正确失败于视觉模型被自动附图；inline 对照通过。最初缺少 TypeScript transform 开关及测试 API systemPromptOptions，修正后取得该功能红测试。
- `node --experimental-transform-types --test tests/arc_thin_query_observation.test.ts tests/arc_thin_native_context.test.ts tests/arc_thin_workspace.test.ts tests/pi_arc_frame_image.test.ts`：9/9，通过当前/上一/历史/动画精确值、全部帧持久化、PNG 按需读取、不可写及路径越界、RESET 新索引、旧快照不变、unavailable 清空 current、模式校验及 inline。
- 激活、计算组件、上下文、workspace、PNG、旧 self-harness 共31项回归初次30通过/1失败：复制的 Claude 基线向 legacy 暴露 changed_cells。对最新 Claude 源相同用例通过，同步其兼容性修复后，本工作树 `--test-name-pattern='the agent is shown no frame comparison' tests/arc_thin_self_harness.test.ts` 通过。其余已通过用例未重复运行；没有改测试来接受旧模式变化。
- `python -m pytest tests/test_arc_thin_recovery.py tests/test_arc_thin_request_accounting.py -q`：14/14，通过。
- `git diff --check`：通过。

实际 Pi 0.87.0 / production runner、bridge / mock SDK / offline-arc-thin-smoke scripted provider：query 普通路径3决策/3动作通过；foundation 原有文件读写、路径隔离和凭据隔离场景3决策/3动作通过。查询值先为[2,1]，行动后当前/前帧/历史为[3,2,2]，后续父轮为[4,3]。provider 请求的 image_blocks 只来自显式 read toolResult；无 user 图片。query defaults 还显式调用现有 refine，真实背景调用输入只包含 refs、无 Lossless coordinate runs；原生自动压缩设置保持 enabled。这是脚本引导的观测路径诊断，没有五类组件全矩阵、Auto-Research 或 length continuation 验收。

保留全部探索失败：首个 smoke 收尾误用 actions_recorded 汇总字段、首次 defaults 验证 read_text 使用 Windows GBK，各自修正；defaults r2/r3 的3000字常驻提示检查先分别测得3213/3001字符，压缩重复说明，未放宽检查。上述运行本身均实际完成3动作，失败在开发验收断言。原始目录均保留。

材料：

- [query 路径](D:/autoresearch_pi_query_observations_20261013/runs/query-observation-smoke-r2-20261013/summary.json)、[实际请求](D:/autoresearch_pi_query_observations_20261013/runs/query-observation-smoke-r2-20261013/smoke-requests.jsonl)。早期 summary 的通用 foundation_checks 中 secrets 标记没有在 query 场景单独测试，最终 query 检查已改为只标 query_observation/native_history；凭据隔离另由 foundation 场景验证。
- [foundation 回归](D:/autoresearch_pi_query_observations_20261013/runs/query-observation-foundation-regression-20261013/summary.json)。
- [最终默认配置](D:/autoresearch_pi_query_observations_20261013/runs/query-observation-final-20261013/summary.json)、同目录 smoke-requests.jsonl、refiner-inputs.jsonl、runtime-audit/compaction-policy.json 和 provider-inputs.jsonl。
- [表示测量](D:/autoresearch_pi_query_observations_20261013/runs/query-observation-smoke-r2-20261013/representation-metrics.json)：固定同一真实 n0 的64×64像素，元数据为双方相同 fixture；状态3489→485字符（−86.10%）。这不是原始 provider 请求复原，未计 schema/历史/查询结果或 hidden reasoning；不能称 token 节省86%或任务提速。

新增成本为自动保存全动画 JSON/PNG 和 guest 可用 frames；没有模型负责落盘或检索管理。既有 native snapshot 仍扫描历史文本文件，其长期 host I/O 成本未做规模压测；新增完整观测文件也计入该扫描。refiner 无独立查询工具，只使用提供的记忆与动作回执，没有 raw frame 时仍可 NONE；其质量影响未测。frames/grid/historical exactness 证明数据可恢复，不能证明跨压缩认知连续性。

| 证据层级 | 状态 | Provider / environment | 产物及结论边界 |
| --- | --- | --- | --- |
| 功能正确 | 通过 | Node / mock HTTP bridge；Python 回归 | 精确查询、PNG、版本索引、不可写和缺帧检查；见上述命令 |
| 全链路可达 | 本次路径通过，完整验收未验证 | 实际 Pi/runner/bridge + scripted provider/mock SDK | 查询→动作→后续父轮可达；完整 ARC self-harness acceptance 未测 |
| 自主采用 | 未验证 | 无新真实 provider | 不能推断自主查询 |
| 净收益 | 未验证 | 无独立重复对照 | 输入缩减不证明总成本/质量改善 |

## 交付决定

按用户授权在隔离开发工作树默认启用 query，保留 inline 对照；未改正在运行的冻结实验或 Claude 活跃工作树。真实模型是否过度查询、能否按需计算并及时行动仍需有界独立对照；比较父子总 tokens、延迟、动作质量和任务进展。关联 docs/deferred-research-todos.md 的 B/D（数据到行动、认知连续性），保持未完成。

最终 `python tools/run_foundation_smoke.py runs/query-observation-final-20261013 query defaults` 退出0：3决策/3动作，显式查询图像、精确历史、后续父轮、无 raw refiner 网格、原生自动压缩配置及原有3000字提示检查均通过。只包含本次代码差异的 query-observation.patch 随表示测量保存，用于避免将继承的 Claude 修改归为本次改动；实际开发代码在 D:/autoresearch_pi_query_observations_20261013。


## 与 Claude 优化的整合

上述“隔离工作树”和“未修改 Claude”描述的是此前单项交付阶段。用户随后授权整合；最新源快照、最小差异、计算会话/行动/查询/子代理共存验证及实际部署状态见[合并记录](../reports/2026-10-13-query-claude-merge.md)。此前原始实验链接已改为原 Codex 工作树的精确绝对路径，避免复制记录后指向错误的 runs 目录。真实自主采用及净收益仍未验证。
