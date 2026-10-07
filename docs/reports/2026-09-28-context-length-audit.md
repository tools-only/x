# Prompt 与上下文长度审计

日期：2026-09-28。检查当前源码及已有
`runs/prompt-preservation-after-final-20260928` 运行记录。
当前源码与该历史运行并非同一快照；不能据此推算当前真实模型 token 节省。

## 结论

仍存在较长的重复投影。应优先处理重复注入、工具 schema 和大工具结果，
不能仅按 Markdown 文件长度判断成本。本次修复一个确定的重复 overlay，
其余长内容列为有依据的后续优化项，尚未迁移或删除。

扫描 40 个 prompt 文件（不含 README），14 个触发审计提示：
13 个超过 500 个空白分词，ARC task prompt 超过已记录的 300 词目标。
500 词只是本次检查阈值，不是模型限制，也不应触发自动截断。

## 加载路径与优先级

| 内容 | 当前词数 | 实际加载方式 | 判断 |
|---|---:|---|---|
| `arc_decision_cycle.md` | 394 | ARC task prompt | 超过 README 的 300 词目标；新增视觉规则和 parent 验证要求应保留语义 |
| `self_harness_index.md` | 128 | 常驻索引 | 已较短 |
| `arc_system_prompt.md` | 47 | ARC system 层 | 已较短 |
| `self_harness_opportunity.md` | 784 | 非 periodic 模式，trigger signature 变化时注入 | 优先拆分动态状态与固定流程规则 |
| `state_transition_induction.md` | 611 | 每个 pending periodic review 上下文注入，另由 method research contract 返回 | 优先处理；同一窗口未解决时会重复投影 |
| `capability_extraction_process.md` | 1370 | ARC 为按需；其他 adapter 在首次 discovery 或 queue/review 触发时投影全文 | 非 ARC 仍需单独优化与验收 |
| `auto_research_child_contract.md` | 857 | research child system 层，加至多一个 profile | 中优先级；保留只读权限、证据要求、提交与恢复约束 |
| `auto_research_operations.md` | 1679 | `auto_research(action=contract)` 按需全文返回 | 可分主题，但不是常驻 1679 词 |
| `auto_research_main_contract.md` | 1952 | 当前 shared parent hook 记录 hash，正文不整体注入 | 低优先级；常驻的是源码内的短 projectedMethod |
| `auto_research_delivery_guide.md` | 975 | retired approval 工具的显式兼容入口 | 不应误判为正常 child 常驻内容 |
| `arc_reasoning_reference.md` | 834 | `task_harness(contract, topic=arc_reasoning)` | 按需参考，保留 |
| `harness_*_operations.md` | 各 96–683 | contract 按主题读取 | development 还拼接 1370 词手册，合计 1743 词，仍可继续细分 |
| `research_profiles/*.md` | 各 67–148 | child 至多选择一个 | 已较短 |
| recovery prompts | 各 45–167 | 对应恢复分支 | 暂不优先压缩 |

主要源码入口：

- `demo/pi_task_local_self_harness.ts`：opportunity、periodic window、development guidance、动态 queue。
- `demo/pi_harness_review.ts`：reviewInputContract 的规则、模板，以及 methodResearchContract 的完整 induction 指导。
- `demo/pi_task_validation_child.ts`：child contract + selected profile + 条件修复提示。
- `demo/pi_harness_operating_reference.ts`：按主题加载及 development 拼接。
- `demo/pi_auto_research_protocol.ts`：working set 的必要字段保留与可选 selected_context 限额。

Periodic review 不仅有 611 词正文，还拼接 checkpoint、窗口、excerpts、
transition-analysis 字段指导和完整 JSON reviewInputContract。
后者也由 inspect 与校验错误返回。其程序性字段适合由运行时按操作提供，
但必须保留规则入口、未知值语义、完整重试要求、证据引用与错误修复能力。

## 已有运行的上下文证据

读取 31 份 parent/child context telemetry 文件。
16 个 parent 场景的首轮上下文 JSON 为 35,745–35,835 字符。
例如 continuous-memory-pool 首轮：

- 总计 35,830 JSON 字符。
- 工具定义 23,248 字符，约 64.9%。
- system prompt 5,533 字符。
- task prompt 2,239 字符。

不同场景的累计最大模块主要为 tools 或 tool_results。
例如 minimal-five-pool 的单次最大上下文为 257,327 JSON 字符，
累计 tool_results 为 1,390,392 字符；累计值包含重复进入上下文的内容。
因此仅缩短初始 task prompt 无法解决整段任务的上下文增长。

这些日志使用 `context_hook_fallback` 等日志中记录的测量路径；
JSON 字符量不是精确 provider payload token，更不是账单用量。
工具结果还可能包含关键证据，不能依据长度直接裁掉。
child working-set 限额只覆盖生成的 task 内容，不覆盖完整 system、schema 与历史。

## 本次已修复：完全相同的 system overlay 重复追加

shared benchmark hook 和 native self-harness hook 都追加 overlay。
已核实安装的 Pi `emitBeforeAgentStart` 会顺序传递 `currentSystemPrompt`。
后一处现在检查是否已经以完全相同的 overlay section 结尾，若是则不再追加。

该检查位于原有 assembly、validity 计算和 exposure receipt 记录之后：
没有更改资源选择、版本校验或投影回执。不同正文不作猜测性合并。
也没有删除其他位置恰好出现的类似文字。

验证：

```text
python -m pytest tests/test_pi_harness_entry.py::test_task_system_prompt_overlay_uses_native_before_agent_start_on_next_agent_turn -q
1 passed
```

该 Pi 测试创建并选择 system-prompt 资源，在下一次 agent turn 断言规则仍在，
overlay 标题及目标规则各出现一次。属于定向诊断，不是完整 ARC closure 验收，
也不证明真实模型策略和成绩不变。本次未运行新的完整 smoke 或真实 provider。

修改前两个文件的快照位于 `tmp/prompt-context-audit-baseline-20260928/`。
当前 task prompt 的后续新增规则未改动。

## 可重复审计

新增只读脚本：

```powershell
python tools/audit_prompt_context.py --run-root runs/prompt-preservation-after-final-20260928
```

输出每份 prompt 的词数、字符数、hash、审计提示，以及历史日志的
首轮模块占用、峰值、累计模块占用、测量依据。也可省略 run-root 只检查文件。
不会启动 agent、调用 provider、自动改写 prompt 或截断证据。
本次完整结果：`tmp/prompt-context-audit-20260928.json`。

下一轮迁移优先顺序：periodic/review 固定规则 → 非 ARC development 投影 →
工具 schema 和大型工具结果的重复结构 → child contract 与按需主题拆分。
每项迁移需建立规则对应关系、调用可达性和针对性验收；跨完整链路的结论仍需
项目要求的真实 runner smoke。`docs/deferred-research-todos.md` 的 D 项
（压缩后认知连续性）仍未完成，按需可读不等于认知已保留。
