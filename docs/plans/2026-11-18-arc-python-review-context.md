# ARC Python 调用与 SelfRoot Review 首屏减负

日期：2026-11-18（Asia/Shanghai）。状态：实现完成，运行时采用与收益待验证。

## 问题与命题

- 机会：现有 Python 工具说明允许把同一观测的独立检查拆成多轮，也没有明确中间结果应留在持久 session、返回结果应服务下一步判断；一次性分析容易被误认为需要保存/发布。SelfRoot review 首屏把窗口内 process/tool/fact 正文直接放进镜像，Agent 可能需要扫描大量 ledger 内容。
- 窄命题：在相同观测下，明确一次批量检查与短结果协议，并把 review 首屏改为事实索引/摘要，将降低重复调用和首屏上下文占用，同时不丢触发依据、结果摘要、失败线索、receipt 引用或既有 `fact_table` 消费面。
- 减少的负担：父 Agent 的重复 Python 调用、重复输出和 review 首屏扫描；不增加工具、worker、review 轮或强制保存步骤。
- 推翻条件：首屏缺少决定 review 所需的触发事实/结果/失败证据；调用方依赖被移除的完整首屏正文；或相同任务中 Python 往返与 review 输入负担没有下降且没有质量改善。
- 范围：ARC thin/native Python 使用说明、SelfRoot review evidence 投影及其 system prompt。任务策略、action 权限、ledger 存储和事实生成不变。

## 设计与成本

- Python 在同一调用中合并可由当前 observation 独立检验的问题，把中间值留在 session，只输出会影响下一决定的证据；只有结果形成先前无法检验的新假设才继续调用。保存/发布仍由 Agent 按复用价值决定。
- Review 首屏展示触发事实、事实计数、过程指标、任务结果、失败工具摘要和 receipt refs；ledger 正文仍由 `read_self(section="ledger", offset, count)` 按范围读取。`fact_table` 字段与层级保持原样。
- 实际新增仅是短工具说明和 review 投影字段；没有新的调用门禁或强制流程。成本为 Python tool schema/context 中的短增量说明；review 首屏改为引用和摘要，完整正文按需读取。
- 权限、预算、revision、事务、ledger 记录和分段读取边界保持不变。

## 实现与验证

- 改动入口：`demo/arc_thin_extension.ts`（主 Agent Python 工具）；`demo/arc_thin_native_runtime.ts`（只读 child Python 工具）；`demo/self_root.ts`（reviewView 摘要）；`demo/prompts/self_root_system.md`、`demo/prompts/self_root_meta_system.md`（使用按需 ledger 读页）；本记录。
- 功能检查：`git diff --check` 通过；`node --experimental-transform-types -e "import('./demo/self_root.ts')..."` 可加载修改后的 SelfRoot 模块。
- 全链路可达：`python -m autoresearch_pi.cli arc-thin-smoke --root runs/arc-python-review-context-native-sync-20261118 --self-baseline` 通过（`passed=true`，offline scripted provider、mock ARC SDK、真实 bridge 与 Pi；2 decisions，native saved-tool lifecycle checks passed）。该 Pi session 的 system/tool schema 记录中检索到新 Python 调用说明，确认 native Agent 请求实际收到更新文案。脚本 provider 不验证模型自主采用。该 runner 不装配 ARC SelfRoot review，因此 review 投影的运行时输出及 ledger 读页仍未验证。
- 补充诊断：`arc-thin-smoke --claims`（legacy foundation）也通过，确认既有 one-off Python 语义输出路径仍正常；它不验证 native 新文案。
- 自主采用：未验证；需要普通真实-provider ARC 轨迹。
- 净收益：未验证；需要相近模型/任务/预算对照并统计父请求数、Python 重复检查、输入/输出与 review 质量。
- `fact_table` 兼容：字段 `process_metrics`、`unit_acceptance`、`request_costs`、`omitted_context`、`pending_delivery`、`legal_predicate_metrics` 保持原形；smoke 没有运行 ARC SelfRoot 消费端，兼容仍待该路径核对。

## 交付决定

- 当前支持的声明：通用机制已实现于代码和 Agent 可见说明；不声称真实 Agent 已采用或已获净收益。
- 决定：先保留为实现状态。下一检查通过真实 thin/native runner 路径确认 review 首屏输出精简、`fact_table` 仍可读、ledger 可按范围展开；再用真实-provider 普通 ARC 运行评估自主采用和成本/任务表现。
- 关联 backlog：ARC adapter boundary、父子成本和跨阶段连续性的既有开放项仍保持原状态；本次没有证据更新这些项目。
