# ARC prompt 精简保真核查

## 修复范围

对照精简前快照发现，第一版将研究交接、实验接纳和关卡复盘的一些细则概括得
过度，且 creator 目录只剩名字。这些遗漏已经修复：

- 精简前 task prompt 与 Harness 索引拆为 29 个规则块，原始文本固定在
  `tests/fixtures/arc_prompt_migration_baseline.json`，逐块验证正常可调用的目标文件。
  其中 28 块逐字保留，1 块仅显式更新 development 文档的交付位置说明；规则不变。
- 完整参考可通过 `task_harness(action="contract", topic=...)` 读取：charter、
  components、memory、assembly、review、assessment、development、research、
  experiments、arc_reasoning。Development 同时返回原能力开发手册。
- 恢复 creator 的用途描述；完整 creator 及版本引用仍经 read_method 返回。
- 常驻 task prompt 保留研究准备条件，以及选择开发后完成创作、组装和语义试用，
  或因具体基础设施障碍记录延期与重试条件的要求。
- task prompt 最终 286 词，常驻索引 128 词（按空白分词）。

## 对照方式

精简前基线采用 `tmp/prompt-flow-refactor-20260928` 保存的原始 prompt 和三个修改前
运行时文件，叠加同一份未改动的 runner、bridge、broker、writer、router、fixture。
副本路径：`tmp/prompt-preservation-baseline-20260928`；覆盖列表见其 baseline-manifest.json。
未用 Git HEAD 代替用户原有未提交工作，未向副本复制模型凭据。

双方均通过 CLI 执行 `arc-harness-smoke --mock-environment`。模型和 SDK 游戏行为为
确定性替身；ARC bridge、Pi parent、child broker/process、结构化返回、路由、
原生 mutation、assembly、实际工具/子 Agent 调用、action boundary 与后续 parent
turn 均走真实代码。

| 对照项 | 修改前 | 修复后 |
|---|---:|---:|
| 完整 runner 场景 | 16/16 | 16/16 |
| 语义与生命周期断言 | 393/393 | 393/393 |
| 五类组件 | 全部覆盖 | 全部覆盖 |
| Auto-Research / 普通 delegate 的 length 续跑 | 均通过 | 均通过 |
| 每场景工具调用与 action 序列 | 基线 | 完全一致 |
| 每次 provider 请求的工具名字集合 | 基线 | 完全一致 |

首次优化后 smoke 未通过“主 Agent 收到研究决策提示”断言：旧初始任务中的研究
 grounding 句被删掉了。补回该核心要求后重新跑完整矩阵，未修改或放宽 smoke
验收器、provider 脚本或检查标签。

证据：

- `runs/prompt-preservation-before-20260928/arc-self-harness-smoke-summary.json`
- `runs/prompt-preservation-after-final-20260928/arc-self-harness-smoke-summary.json`
- `runs/prompt-preservation-comparison-20260928.json`：每场景结果、调用序列与工具集合对照。
- 104 项 prompt/ARC runner/context 诊断回归通过，另 8 项绑定/组装/review/assessment
  定向回归通过。按需读取所有 topic 不会创建资源、启动研究或改变 assembly。

## 允许结论

本次对照中未发现原有工具能力、权限、组件操作、研究生命周期或环境动作流程
退化；原规则可以通过常驻或按需入口获得。新增 contract 是只读说明入口。

提示文字、交付时机及 schema 增加只读 contract/topic 是有意变化，因此不能声称
模型输入完全相同。规则保留和确定性 runner 通过不证明真实模型的检索时机、策略、
自主触发率或 ARC 得分相同；这些需要真实 provider 对照。跨压缩认知连续性仍属于
 deferred-research-todos.md 中的未完成验证项。本次没有运行真实 provider 游戏。
