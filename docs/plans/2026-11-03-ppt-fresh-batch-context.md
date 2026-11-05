# Meta-harness 变更记录：PPT fresh-batch 上下文边界

日期：2026-11-03（Asia/Shanghai）。状态：实现；真实运行已完成，组件采用失败，净收益待评估。

## 问题与命题

- 真实机会：此前 high PPT 运行跨多个批次延续对话，最终只保留少量工具组件；产物和运行日志位于 `runs/ppt-jpm-high-side-20261103-01`。这显示仅有组件接口并未让 harness 成为跨阶段工作载体。
- 窄命题：启用 fresh-batch 后，每批最多 N 个 provider 请求，后续批次只得到 workspace、当前 harness、最多 400 字交接和任务状态；这会让未沉淀的信息无法自然延续，并使组件沉淀成为可观察的自主选择。
- 减少的负担：不再依靠长对话历史维持跨批次连续性；runtime 在批次边界机械清理并重发可携带状态。
- 适用与推翻：适用于多批次任务；若真实运行仍依赖对话外的隐式状态、批次边界未清空，或没有提高 harness 的语义复用，则命题不成立。无需沉淀组件仍是允许结果。
- 范围：PPT demo extension、runner 参数、游戏提示和本记录。此项只实现机制，不声明组件采用或质量提升。

## 设计与成本

- 每批 provider 请求计数由 runtime 维护；达到上限后结束工具调用，下一批从新 user prompt 建立上下文。`PPT_RESUME` 续写不重置计数。`--batch-requests 0` 表示不设每批请求上限。
- fresh-batch 开头推送 memory 全文、当前 harness 清单、程序目录、状态和交接备注；系统提示不包含“清空对话”的特殊说明。
- `checkpoint` 允许主动记录不超过 400 字备注并选择是否进入 ADAPT。组件、质量地图和验收程序均为可选；绑定的验收程序仍须通过才能交付。
- 新增 CLI 开关与批次请求数参数；默认关闭 fresh-batch，默认上限 10。常驻运行成本是每批额外状态消息及重新注入的 harness/memory 文本。
- 批次自动结束时将交接标为过期，防止备注代替 workspace/harness 携带完整状态。

## 运行前实验协议

- 目标证据层级：先确认功能与接线，再观察自主采用；净收益需后续对照。
- 主要变量：只启用 `--fresh-batch`，以相同 PPT 任务、模型和推理档位的普通运行作比较器。
- 模型/provider/任务：实际运行相同 JPMorgan Chase 3Q21 PPT brief，OpenAI Codex OAuth / GPT-6 Luna，reasoning high。
- 预算与停止：启用 `--fresh-batch --batch-requests 0`；因此每批请求数无限制，但仍受 runner 两小时与 $12 API-equivalent 预算边界约束。运行约 11 分钟，4 批、65 次 provider 请求；OAuth 使用量不是 API 账单。
- 主要指标：批次数/请求数、交接长度、跨批实际注入内容、组件机会漏斗与语义使用、任务质量、父模型总耗时与花费。组件数仅作诊断项。
- 负例：任务在一批内完成、无需沉淀组件、没有合适的沉淀机会、达到预算上限、provider length continuation。
- 本次是探索运行，没有普通模式对照；不能据此判定净收益。

## 实现与验证

- 改动入口：`demo/ppt_demo_extension.ts`、`src/autoresearch_pi/ppt_demo.py`、`demo/prompts/ppt_demo_system.md`。
- 真实 runner/Pi/provider 路径完成渲染和交付：修订 7，共 15 页，renderer warnings 为零。交付为 `runs/ppt-jpm-fresh-unlimited-high-20261103-r2/delivery/presentation.html`；contact sheet 在 `workspace/results/renders/v007/contact-sheet.png`。
- agent 四次尝试保存相似的交付复制工具；四次均因 `No package metadata was found for wasmtime` 失败。最终 `delivery/harness.json` 的 components 为空；没有 skill、prompt、memory、subagent 或 quality map。工具语义使用未发生。
- 首次渲染还因 runner 虚拟环境缺少 Pillow 失败；在该本地 `.venv` 安装 Pillow 后成功渲染。此处未修改项目依赖声明。
- 跨批运行到 4 批，日志记录各批开始；provider payload 确认 high 与 fresh-batch 状态消息。该单次结果证明任务链路可达，不证明跨批认知连续性或 harness 机制有效。
- 没有运行测试。机会漏斗的机会分母、使用归因、总 token 成本及普通模式匹配对照仍缺失。

| 证据层级 | 状态 | Provider / environment | 产物及结论边界 |
| --- | --- | --- | --- |
| 功能正确 | 不确定 | 本地 PPT demo runner | 无批次请求上限的运行到达 4 批并完成；未运行自动化测试，工具组件保存路径失败 |
| 全链路可达 | 通过（此任务） | OpenAI Codex OAuth / GPT-6 Luna high；Pi + PPT demo | 65 请求，4 批，15 页 HTML 成功渲染并交付；不代表未覆盖路径均通过 |
| 自主采用 | 失败（组件沉淀） | 同上 | Agent 尝试 4 次但都因 Wasmtime 包元数据缺失失败；交付的组件清单为空 |
| 净收益 | 未验证 | 单次探索运行 | 无普通模式对照；质量与成本差异未知 |

## 交付决定

- 已实现 fresh-batch 开关、请求上限（0 为无限）、上下文裁剪、交接备注限长、可选验收以及 runner 参数。真实任务成功交付；自主组件沉淀仍失败，且本次暴露 Wasmtime 包元数据缺失。
- 决定：保留为默认关闭的实验能力；本次不支持“自主采用已改善”或“净收益为正”的声明。
- 下一检查：先修复并单独验证 Wasmtime 组件保存环境，再以相同任务与模型档位对比 fresh-batch 和普通模式，审阅跨批输入、机会漏斗、产物质量及父模型总成本。
