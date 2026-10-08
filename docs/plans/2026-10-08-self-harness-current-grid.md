# Self-Harness：直接使用当前网格

日期：2026-10-08。状态：实施完成，功能检查通过；ARC 全链、自主采用与收益未验证。

## 问题与命题

- 机会：当前 `task_harness_create` 已支持默认安装、可选 schema 和同次 trial，但 ARC pure Tool 的动态输入仍须作者复制网格或准备 observation snapshot 的 ref/path。`test_arc_creator_grid_handoff_native.py` 的现有路径先读 creator，再从模板取 exact binding。对照 [Continual Harness 分析](../reports/2026-10-08-continual-harness-self-harness-analysis.md)，这里仍有机械输入准备负担；历史 stage140 的 Python 表达式失败是另外的问题。
- 窄命题：父 Agent 显式传入 `current_grid:true`，runtime 就能把最新已捕获公共观测的最后一帧绑定为 `input.grid`，经现有 create/install/trial 路径一次获得语义结果，无需先读 creator/资源页或复制像素/ref/path。
- 减负：省去当前网格定位和刷新引用；不增加研究 worker、管理轮或强制创作义务。是否值得创建、结果如何用于行动仍由父决定。
- 适用：计算当前已观察网格。历史比较仍用 exact bindings；无快照/空网格、已有 grid 参数冲突或预算不足时拒绝，不猜测数据。若需预读才能执行、拿到动画第一帧/旧帧、覆盖手写输入或绕过权限/预算，命题被推翻。
- 范围：pure Tool 输入 host、调用 schema、首次 trial 与简短说明。会话重建、research 调度、任意 Python 执行、同名覆盖及五组件大改不在本次范围。

## 设计与成本

- 比较：仅改提示不能省去定位；隐式注入完整 state 会增加输入且污染通用工具；选择单个可选布尔参数，复用 exact resource 解析与 provenance。省略/false 保持旧行为，explicit bindings 仍精确。
- 生命周期：机会/识别/投入/候选由父；runtime 校验、安装及调用；父观察语义输出并决定应用、修订或撤下。无独立等待 worker。工具调用的输入 provenance 记录实际 snapshot/ref/path/hash/boundary，后续调用重新选最新快照。试用失败维持既有“已发布/试用失败”区分。
- 首次路径：父提交程序 + `trial:{current_grid:true}`；runtime 自动安装、准备输入、试用并返回值。保持权限、schema、CAS、版本、取消和资源预算。
- 新增成本：调用 schema 一个可选 bool 与一句说明；每次启用时复用一次既有有界快照读取，不加入历史全文/像素到模型输入。关闭时不扫描。首次闭合 schema 补齐仍复用授权 host 值。无新的模型/child 调用。
- 恢复：冲突需父明确选择来源；无当前网格不回退到历史帧；预算/取消停止；工具可继续修订/撤下，环境历史不回退。

## 运行前实验协议

- 目标：功能正确和局部 native Pi 接线诊断。无需付费模型、真实游戏动作或新 ARC 运行。
- 主要变量：同一计算表达式用 `current_grid` 替代显式当前 snapshot binding。比较输出、ref/path/hash、scan/work 计量、首次调用前的管理读取次数。
- Provider/environment：本地 scripted HTTP provider + installed Pi；host fixtures 使用 synthetic public snapshots。均不构成自主行为证据。
- 预算/顺序：先 focused host/native 检查，再相关 pure 输入、publication、creator regressions；总计目标 10 分钟内，每 native session 60 秒截止，失败只修相关问题。
- 判定：最后帧正确、后续新观测刷新、历史绑定固定、默认安装试用后值进入后续父请求；无需 creator/resource read；扫描和准备不超旧上限。
- 负例：空/无观测，显式 grid 冲突，错误布尔类型，64-binding 总容量，child/未初始化/跨任务权限，输入/scan/work 预算，schema 缺字段、trial publication 取消、已有 exact 输入回归。
- 遥测：pytest JUnit、native session events/provider-payloads、task-tool-invocations 与 input_provenance。脚本 token 为测试数据，不报告真实成本收益。

## 实现与验证

- 实现入口：`demo/pi_task_pure_expression_host.ts` 的调用 envelope 和 bounded preparation；`demo/pi_task_local_tools.ts` 的共享 schema/执行前校验；`demo/pi_task_local_self_harness.ts` 的 trial、闭合 schema 自动补齐、creator 模板及使用回执。README 和按需 tool-creator 文档同步短调用。没有新增 worker 或模型调用。
- 当前网格转换为既有 exact binding，沿用一份 snapshot 扫描、输入上限、资源权限及 provenance；host 对等检查证明同一参数和快照下，捷径与完整 binding 的 input、provenance 和 preparation 完全一致。省略/false 不扫描。历史绑定与当前输入可以同时使用不同字段名。
- Native Pi 诊断：无 creator/resource read，创建即安装并试用得 `8+1=9`，结果进入第二次实际本地 HTTP 父请求。重启并捕获新 final frame 后同一 Tool 得 `15+1=16`；旧 exact binding 仍得 `9` 且标记 historical。分别覆盖无 input_schema 和闭合 schema 漏 grid 自动补齐。
- 负例通过：无快照、末帧为空（不退回更早非空帧）、显式 grid 冲突、类型/绑定容量错误、child/未初始化/跨根权限、scan/input/work 上限、准备前/中取消且无组件写入、试用失败保留已提交版本。现有 Python source/输入访问预检/历史比较/版本使用回归保持。
- 首轮发现 Pi 会把字符串/数字/null 转为 bool，导致 1 个负例失败；在 `prepareArguments` 中复用 strict bool 校验后，11 项定向检查通过。保留红/绿两次 JUnit。
- 扩展检查 85 项：初次 80 通过、4 失败、1 跳过。4 个失败均为旧 publication 测试仍要求必填 parameters/bindings、缺省 assembly 拒绝或旧行政字段报错，与本轮之前已存在的默认安装/可省参数契约不符。修正断言，将拒绝负例改为显式 `assembly=false`，保留实际 source 错误断言。受影响 publication、creator 和新入口合计 36 项重跑：35 通过、1 跳过。去重后的 85 个检查最终为 **84 通过、1 跳过**；跳过的是不提供 trial 的 batch 顶层入口，不是新能力失败。没有为这些过时断言回退运行时行为。
- 执行命令：`D:/conda/python.exe -m pytest tests/test_pure_current_grid_native.py tests/test_task_pure_expression_host.py tests/test_arc_creator_grid_handoff_native.py tests/test_pure_invocation_defaults_native.py tests/test_pure_binding_schema_cancellation_native.py tests/test_pure_binding_schema_completion_native.py tests/test_pure_publication_trial_native.py tests/test_early_source_reuse_native.py tests/test_pure_input_access_preflight.py tests/test_task_pure_python_native.py -q --basetemp tmp/self-harness-current-grid-regression --junitxml=tmp/self-harness-current-grid-regression.xml`。修正后仅重跑 publication/creator/current-grid，输出 `tmp/self-harness-current-grid-docs.xml`。改动文件 `git diff --check` 退出 0。
- 成本：四次 pytest 总执行约 406 秒，无付费请求、child 或游戏动作。已测 envelope 为 138→45 个紧凑 JSON 字符；当前创建 schema 增加 193 字符。已测 host 一次读取 840 bytes，work 2599 bytes，与等价 exact 绑定一致；闭合 schema 首次补齐按既有路径额外预检，不能当作只有一次总扫描。上述字符/脚本 usage 不代表真实 token、延迟或任务收益。
- 材料：[机器审计](../../tmp/self-harness-current-grid-audit.json)、[审计脚本](../../tmp/audit-self-harness-current-grid.py)、[回归初次结果](../../tmp/self-harness-current-grid-regression.xml)、[修正后定向结果](../../tmp/self-harness-current-grid-docs.xml)。Native 请求和 task JSONL 保留在 `tmp/self-harness-current-grid-regression/` 与 `tmp/self-harness-current-grid-docs/`。
- 协议偏离：补齐 Pi 转换前校验，并修正上述 4 个过时测试；范围维持当前输入简化。机会分母/识别/行动采用、认知连续性及父子真实成本本轮不测；诊断只覆盖明确提交的输入准备→装配→语义试用。

| 证据层级 | 状态 | Provider / environment | 产物及结论边界 |
| --- | --- | --- | --- |
| 功能正确 | 通过 | 本地 host / scripted HTTP + installed Pi；synthetic public snapshots | 84 通过、1 不适用跳过；原生创建/试用/后续父请求是局部诊断 |
| 全链路可达 | 未验证 | 未运行 arc-harness-smoke 完整矩阵 | native fixture 只作局部诊断 |
| 自主采用 | 未验证 | 未启动真实 provider | 无普通运行证据 |
| 净收益 | 未验证 | 无独立重复对照 | 不声称省 token 或提高通关 |

## 交付决定

保留为显式可选捷径，已支持接口简化和局部功能正确的声明。完整 ARC 接线需既有 `arc-harness-smoke` 五类组件/两类 length/语义输出矩阵；自主采用和净收益仍需相同模型/任务/预算的独立普通运行，观察有价值计算机会到首次语义使用、后续行动及父子总成本，需另行约定实验预算。关联 [backlog B/C/D](../deferred-research-todos.md)，本次不提升研究质量或跨压缩连续性状态。
