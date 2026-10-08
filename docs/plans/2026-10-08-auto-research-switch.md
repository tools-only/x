# Meta-harness 变更记录：调试时关闭 Auto-Research

日期：2026-10-08（Asia/Shanghai）。状态：实现完成，保留；真实模型采用与净收益未验证。

## 问题与命题

- 用户需要在 debug 阶段关闭研究。B30 的 child 消耗 605955 reported token，父子合计 787385，且研究未交付；见 `tmp/self-harness-goal-20261007/b30-real-cost-audit.json`。ARC 已通过 `PI_ARC_AUTO_RESEARCH=enabled` 实验性默认关闭，但 CLI 缺少明确选项。
- 窄命题：新运行明确关闭时，不注册 auto_research、不调度/恢复研究 child、不投射研究提示，同时普通 delegate 和作者 Subagent 保持可用。
- 减少的负担：用户无需修改源码或依赖实验隐式默认值即可隔离研究成本；父无需自行回避不可用研究功能。
- 推翻条件：关闭后的父请求仍包含 auto_research schema、研究调度恢复 pending 职责、或普通委派受影响。
- 范围：启动时配置；不取消其他运行中的 child、不热切换、不删除既有研究状态，不改变 ARC 默认关闭或其他 adapter 默认。

## 设计与成本

- 复用 installTaskLocalSubagents 的 autoResearch 分支（研究注册/worker/交付/自动恢复都在该分支内），无需新增 worker 或 Agent 管理轮。
- ARC CLI/API 显式布尔选项 > PI_AUTORESEARCH_ENABLED > ARC 兼容 PI_ARC_AUTO_RESEARCH > adapter 默认。变量仅接受 enabled/disabled；非法有效配置在启动前报错。control 不启用研究。
- runtime 在注册时决定使能；用户推进启用/关闭，父和研究 Agent 仍负责启用后的语义研究判断；既有机会到反馈链路和权限/版本/预算约束保持原状。关闭时投入到研究交付的转移不适用，durable artifacts 保留。
- 新增两个互斥 CLI 参数、一个通用环境配置入口和有效配置记录；无新常驻提示/schema/门禁/决策轮。
- 恢复：下一次独立运行启用即可；既有进程不受新配置影响。

## 运行前实验协议

- 目标：功能诊断及原生 Pi 注册/委派/恢复边界检查；不宣称 ARC 全链路闭环。
- 变量：启动开关 enabled/disabled，其余 scripted provider 与 fixture 初态相同；覆盖默认、兼容开关、优先级、非法值、验证探针冲突与 control。
- Provider/environment：本地 Pi + 确定性 fixture provider，不调用付费 provider。普通 delegate 开关前后语义结果对照；已保存研究 worker/pending 状态关闭后不产生新研究执行。
- 预算：定向 pytest/Node，每次 fixture 既有 timeout 上限；失败则停止诊断定位，不启动真实 ARC 游戏或扩大计算预算。
- 判定：关闭不暴露工具/研究提示，不创建/恢复研究 child，普通委派返回预期内容；启用保留工具与研究启动路径。
- 负例：非法值、验证探针与关闭冲突、control、关闭覆盖兼容启用、未注册 adapter 不凭开关获得能力。
- 材料：pytest XML、provider payload、subagent/worker/session JSONL，配置记录。

## 实现与验证

- 改动入口：`demo/pi_auto_research_config.ts` 统一配置解析，ARC adapter 保持默认关闭，共享 installer 在注册前解析开关，整个研究分支（工具、worker pump、completion inbox、pending 自动恢复）保持在同一边界内；ordinary delegate 不受该分支控制。control 无研究能力。
- `src/autoresearch_pi/cli.py` 提供互斥参数；`arc_agi_3_e2e.py` 在 public runner 启动 bridge 之前校验有效配置，在实际 Pi 启动环境中固定 `PI_AUTORESEARCH_ENABLED`，并记录值和来源。无需用户再修改源码。
- 普通 ARC 初始/后续/length/行动边界恢复提示中的研究建议按该值投射，启用时保持原文。研究验证及 cross-situation 探针无显式配置时启用研究，明确关闭时启动前报错。确定性 smoke 矩阵显式启用研究；未执行矩阵，不声称其验收通过。
- 功能检查：`python -m pytest tests/test_auto_research_switch.py tests/test_auto_research_switch_native.py tests/test_arc_concise_guidance.py tests/test_external_benchmark_cli.py tests/test_arc_harness_smoke.py -q --junitxml=tmp/auto-research-switch-r2-20261008.xml`：74 passed，26.28 秒。`node --experimental-strip-types --test --test-reporter=junit --test-reporter-destination=tmp/auto-research-switch-node-20261008.xml tests/pi_auto_research_config.test.ts`：2 passed。CLI help 包含互斥选项；限定文件 `git diff --check` 无 whitespace 错误。
- native 8 情境：开/关普通委派返回 `SWITCH_DELEGATE_RESULT`；关闭不更新已存 worker/pending session，实际新增 evidence 与后续父轮也不触发研究 child/队列；开启研究实际返回 `SWITCH_RESEARCH_RESULT` 并落盘结构化报告；实际 ARC adapter 的默认、兼容开关与双向覆盖注册正确。ARC adapter 注册情境复用 external fixture，没有 ARC bridge/游戏，所以不是 ARC 全链路证明。
- 机会漏斗：用户识别 debug 需求，启动配置投入并控制注册，脚本检验语义使用；真实模型机会识别/授权/采用未测。关闭研究是本次合理不使用条件，保存状态未伪造为已完成研究。
- 连续性：保存状态逐字节保持不变、可供后续授权恢复；未测真实模型跨压缩认知连续性。成本：本地诊断墙钟如上；无真实任务效果/父子计费对照，不把无研究 child 推导为任务净收益。
- 协议偏离：首次配置回归发现已有 concise 测试仍要求 B31 普通 prompt 已移除的 ordered-tool-batch/assembly 文句，改为按真实两种 prompt 分支核对并保留语义检查；新 native seed 的 JS 换行字符串修正后通过。两次失败 XML 均保留，生产策略未由 fixture 修正改变。没有付费 provider 或真实 ARC 运行。
- 产物：[完整 manifest](../../tmp/auto-research-switch-manifest-20261008.json)、[Python 结果](../../tmp/auto-research-switch-r2-20261008.xml)、[Node 结果](../../tmp/auto-research-switch-node-20261008.xml)。8 组 native/provider JSONL 与最终 payload 已复制到 `tmp/auto-research-switch-evidence-20261008/`，具体路径列在 manifest。

| 证据层级 | 状态 | Provider / environment | 产物及结论边界 |
| --- | --- | --- | --- |
| 功能正确 | 通过 | Windows / Node 25.5.0 / installed Pi / 本地 scripted fixture + real broker | 74 Python + 2 Node；注册、普通委派语义、结构化研究返回及关闭恢复边界通过 |
| 全链路可达 | 未验证 | 未运行 ARC acceptance matrix | 此次不作闭环声明 |
| 自主采用 | 未验证 | 未运行真实 provider | 用户启动配置不是自主采用 |
| 净收益 | 未验证 | 无独立对照 | 不宣称游戏性能改善 |

## 交付决定

- 保留启动开关，满足用户 debug 隔离需求；ARC 当前默认关闭，其他 adapter 默认不变。启用不意味着研究必须启动。配置切换不会取消其他已有运行。
- 已支持功能与 native Pi/broker 诊断声明；未支持 ARC 完整五组件/length 验收、真实自主采用或净收益声明。
- 若未来目标包含真实 ARC 研究闭环，下一检查应在显式启用配置下执行既定 `arc-harness-smoke` acceptance matrix；若目标是成本/任务收益，再按独立同预算样本做启用/关闭对照。当前用户仅授权实现开关，此次不扩展到这些实验。
- 关联 [延期事项 B/C/D](../deferred-research-todos.md)：开关提供消融条件，不完成研究目的、父子通信或连续性验证，保持开放。
