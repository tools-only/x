# Meta-harness 变更记录：任务内的机制试验与工作谱系（PPT 宿主）

日期：2026-11-05（Asia/Shanghai）。状态：**已实现；功能正确已验证（免费 node 测试）；真实链路、自主采用与净收益未验证**。
分支 `claude/ppt-meta-20261105`，worktree `D:\autoresearch_pi_project\worktrees\ppt-meta-20261105`，
基线 = `codex/ppt-native-production-demo`@193031e2（free-hands 版 PPT 宿主）。按
[开发流程](../development-workflow.md) 与 [harness 设计原则](../../../../docs/harness-design-principles.md) 编写。

## 0. 结论

用户当前的目标限定为**单个任务内的自我进化**：agent 在任务进行中，根据实际结果修改自己创建的工作机制，使修改进入后续生产，并再次接受反馈；不涉及跨任务迁移。现有 free-hands 宿主已允许修改提示、程序、技能、子 agent 和记忆，但缺两处通用能力：

1. **结果与工作机制之间的连接**：agent 发现问题后，需要自己翻对话和日志才能确定"这次是谁产生的"；
2. **机制级试验的出口**：可以生成多个候选想法，但没有低成本的方式让不同**工作方式**在同样的材料上实际跑一遍，再把选中的结果带回主工作区。

本次只补这两处，并加一条任务原则；不预置 generation–review、不建质量地图、不设交付门禁、不做迁移实验。

## 1. 问题与窄命题

### 1.1 真实失败与材料（观察）

- 既有 PPT 运行（`docs/plans/2026-11-03-ppt-native-production-demo.md`、`2026-11-03-ppt-fresh-batch-context.md`）中，agent 多次创建组件但只有少数被后续调用；多次运行在首次无告警渲染后迅速交付。
- 记忆 `ppt-no-felt-gradient-20261104`：PPT 任务没有"感觉到的差距"——交付即满足简报，告警是机械的，预算从不绑定。没有第二个消费者时，要求 agent 继续优化工作机制缺少依据。
- 记忆 `e0-review-followup-audit-20261026`：su15 的 58 份 review 里 46 份点出了循环成本，0 个可执行的后续动作；交付一个视图和规则没能阻止动作。说明"给材料"不够，材料必须能低成本地变成下一步动作。

### 1.2 解释（推断）

- **定位断点**：机制修改的入口存在（`self_component`、`save_program`、`edit_program`），但从"这一版作品不好"到"该改哪个组件"缺少机械事实；agent 每次要重建执行历史。
- **试验断点**：`consult` 只返回文本答案，候选无法实际执行；要比较两种生产或评价方法，只能直接在 canonical 产物上试，代价高且污染当前版本。
- **责任表述**：系统提示只说"可以改 harness"，没有明确"机制本身是本次任务的优化对象"，也没有说清"通过自己的检查 ≠ 机制已经充分"。

### 1.3 窄命题

在同一任务内，当宿主提供执行谱系与隔离试验后，agent 会：

1. 至少一次基于谱系定位到具体组件并修改（而不是只改当前作品）；
2. 至少一次用 `trials` 在相同材料上比较两种工作方式（生产方法、评价方法或组合方式），并用 `apply_trial` 把选中结果带回主工作区；
3. 修改后的机制参与后续生产，且其效果由后续作品或后续检查的结果体现；
4. 其中至少一次修改落在评价/探索/选择机制上，而不只是生产代码。

**推翻条件**：谱系与 trials 存在但从未被调用；只调用 trials 而不 apply；apply 后组件再未被使用；所有机制修改都只是生产代码；作品质量与成本没有变化。

**归因**：若只有更强模型出现上述行为，结论记为模型上限，不归给机制。

### 1.4 减少的负担

- **Agent**：不再需要从对话与多个 jsonl 重建"这一版是谁产生的"；不再需要为了比较两种方法而污染 canonical 产物；不再需要自己搭隔离工作区。
- **开发者**：不需要在运行中提示"你的检查太宽松"或"试试别的方法"。

### 1.5 范围与非目标

**在范围内**：`demo/ppt_demo_extension.ts`、新增 `demo/ppt_trials.ts`、`demo/prompts/ppt_demo_system.md`、`demo/prompts/ppt_demo_agents.md`、`tests/ppt_trials.test.ts`。

**非目标**：预设 reviewer 或质量维度；自动选优/合并/发布；第六类组件；跨任务 harness 包与迁移实验；ARC 路径任何改动；付费运行（未授权）。

## 2. 设计与成本

### 2.1 工作谱系（execution lineage）

**来源**：宿主已在记录的机械事实——`component_runs.jsonl`（program_call / tool / save / program_save）、`consult_runs.jsonl`（role + version）、`workspace.onWrite`（文件写入路径）。不新增记录格式，不推断因果。

**呈现**：`statusText()` 中新增一小段（每次请求尾部已有该文本），并在 `office(render)` 的回执里报告"上一个 revision 期间"的谱系，随后清零：

```
Lineage since render vN (execution facts, not a causal or quality claim):
ran: program build_deck@v3 (2 ok, 0 failed); subagent visual_review@v1; tool check_numbers@v2 (1 ok)
wrote: artifacts/presentation.html×2, artifacts/data.json
changed outside a recorded run: artifacts/notes.txt
```

- **归因边界**：直接 `write`/`edit` 的文件列为"changed outside a recorded run"，不冒充任何组件的贡献；prompt/skill 这类无法自动归因的组件只按"暴露"计，不进入 ran。
- **成本**：常驻文本约 200–400 字符；来源是已有日志，无额外调用。完整历史仍在 jsonl，按引用读取。

### 2.2 隔离试验（trials / trial_files / apply_trial）

**`trials`**：一次提交 1–3 个候选，每个候选：

- `instruction`：必填，独立上下文里唯一的问题；
- `materials`：从主工作区复制的文件（可选）；
- `components`：从 agent 已保存组件中按名复制的文件（可选）；
- `id`：可选，默认 `t1`、`t2`…。

Runtime 为每个候选建立 `.harness/trials/<id>/workspace`，用同一模型、同一推理档位、独立 system prompt（**不携带父 agent 的 system prompt 与活动 prompt**），提供受限文件工具、`python`、`save_program`/`run_program`/`list_programs`/`read_component`。候选之间串行执行；单个失败只报告该候选，不影响其他。

**边界**：

- 候选不能写主工作区（不同 Workspace 实例，路径约束照旧）；
- 每个候选有轮次上限（默认 12）与超时（默认 300 s），可环境变量覆盖；
- 所有候选请求计入父预算（`modelResult` 走同一 `spent`/`tokensSpent`，`provider-requests.jsonl` 记 `kind: trial`）；
- 不自动选优、不自动合并、不自动发布。

**`trial_files`**：按内容比较列出某候选相对主工作区改动的文件，供 agent 决定 apply 什么。

**`apply_trial`**：把选中的文件（默认全部改动）写回主工作区；非二进制文件经 Binder 正常版本化（`by: 'trial'`），二进制直接写入。`data/`、`results/` 仍只读。apply 之后组件按既有机制参与后续请求。

### 2.3 任务原则（提示）

- `ppt_demo_system.md`：新增一段，明确"你对产生作品的机制负责"，"通过自己的检查不证明机制已经充分"，"如何评价、如何探索和选择同样可修改"，"停止、简化、删除同样有效"，并点名 `trials`/`apply_trial` 的用途。
- `ppt_demo_agents.md`：补一段说明 `trials`/`trial_files`/`apply_trial` 的语义与"不替你选优"。

两处均为陈述能力与责任，不规定流程、阶段或必填项。

### 2.4 生命周期

| 转移 | 推进者 | 可观察输入 | 完成证据 | 失败/不适用 |
| --- | --- | --- | --- | --- |
| 机会 | agent | 谱系、渲染回执、独立视角 | — | — |
| 识别 | agent | 谱系指出具体组件版本 | 下一步动作指向该组件 | 判断为作品问题，直接改作品（合理不使用） |
| 投入 | agent | 剩余预算 | 调用 `trials` 或直接改组件 | 放弃并继续 |
| 候选 | runtime | `trials` 参数 | 每个候选的答案与文件列表 | 单候选失败单独报告 |
| 装配 | runtime | `apply_trial` | Binder 版本递增，旧版本仍可读 | 路径非法/只读目录被拒 |
| 语义使用 | agent | 后续 `run_program`/`consult`/render | 谱系中出现新版本 | 未使用时计入漏斗 |
| 反馈 | runtime + agent | 新 render 的谱系与告警 | 下一次机制修订 | — |

### 2.5 首次获益路径

谱系出现一行 → agent 一次判断 → 调用 `trials`（1–2 个候选）→ 看 `trial_files` → `apply_trial` → 继续生产。固定新增的父决策：一次判断；其余成本由 agent 自选。

### 2.6 新增与移除

**新增常驻**：系统提示约 550 字符；`ppt_demo_agents.md` 约 400 字符；谱系行约 200–400 字符；三个工具定义。
**新增调用**：无强制；`trials`/`apply_trial` 由 agent 决定。
**移除**：无。

### 2.7 权限、版本与环境边界

- 预算与期限守卫不变，`trials` 复用同一守卫。
- 候选工作区在主 root 下（`.harness/trials/`），不越过路径约束；`data/`、`results/` 在候选内也保持只读。
- 交付一致性校验不变（render 源 == canonical 源，且为最新）。
- 候选内容在 apply 前对 canonical 交付完全不可见。

## 3. 运行前实验协议（未启动）

- **目标证据层级**：功能正确（已做）；全链路可达与自主采用需真实 provider 运行；净收益需重复对照。
- **主要变量**：本次机制（谱系 + trials + 原则）vs 193031e2 的 free-hands 宿主。
- **模型/provider**：由用户指定；同一模型两臂，推理档位相同。
- **任务**：JPMorgan 3Q21 或 BofA 3Q21 简报，全新 run 目录。
- **预算**：运行前声明 token 上限与墙钟；任何续跑计入同一预算。
- **主要指标**：机制修改次数（按组件版本）；修改是否落在评价/探索/选择上；`trials` 调用与 apply 次数；apply 后组件的后续使用；最终作品运行外盲评；父子总 token 与墙钟。
- **负例**：谱系显示无活动仍改组件；trials 后不 apply；apply 后组件不再被调用；只改生产代码；预算耗尽。

## 4. 实现与验证

### 4.1 改动入口

- `demo/ppt_trials.ts`（新增，约 250 行）：`Trials` 类——`run`（隔离候选）、`changed`（按内容比较）、`apply`（回写 + Binder 版本化）。
- `demo/ppt_demo_extension.ts`：引入 `Trials`；`log()` 汇聚谱系事实；`statusText()` 增加谱系行；`render` 回执增加"上一 revision 期间"的谱系并清零；`workspace.onWrite` 记录直接写入与"无记录改动"；注册 `trials`/`apply_trial`/`trial_files`；`setActiveTools` 加入三者；trial 预算走 `modelResult`。
- `demo/prompts/ppt_demo_system.md`、`demo/prompts/ppt_demo_agents.md`：责任与能力陈述。
- `tests/ppt_trials.test.ts`（新增）：三条测试。

### 4.2 免费验证（本机 node 22 + 真实 HTML 渲染器；脚本 provider）

命令（worktree 根）：

```
node --experimental-transform-types --test --test-concurrency=1 --test-force-exit tests/ppt_trials.test.ts
node --experimental-transform-types --test --test-concurrency=1 --test-force-exit tests/ppt_demo.test.ts
```

结果：`ppt_trials.test.ts` 3/3 通过；`ppt_demo.test.ts` 2/2 通过（含真实 Edge 渲染）。

覆盖：

1. **隔离**：两个候选各两轮，主工作区在 apply 前无 `artifacts/proposal.html`；父提示（`PARENT-ONLY-INSTRUCTION`）不出现在任何候选的 system prompt 或 messages 中；材料被复制进候选；4 次候选请求全部计入 `model-usage.jsonl` 且 `kind: trial`。
2. **采用**：`apply_trial` 只复制指定文件；apply 后 `office(render)` 成功渲染该文件。
3. **失败隔离**：一个候选因缺失材料失败，另一个仍完成并返回答案。
4. **谱系**：`run_program` 后谱系显示 `program page_builder@v1` 与写入文件；直接 `write` 后显示 `changed outside a recorded run`，且上一周期的 program 不再出现。

未验证：真实 provider 下 agent 是否自主调用；候选内 `save_program` 的组件在 apply 后的绑定行为（测试只覆盖普通文件）；`trials` 与 `fresh-batch` 的交互。

| 证据层级 | 状态 | Provider / environment | 产物及结论边界 |
| --- | --- | --- | --- |
| 功能正确 | 通过（免费 node 测试） | 本机 node 22 / 脚本 provider / 真实 Edge 渲染 | 只证明函数与接线，不证明模型行为 |
| 全链路可达 | 未验证 | — | 需真实 Pi + provider 运行 |
| 自主采用 | 未验证 | — | 需无开发者介入的真实运行 |
| 净收益 | 未验证 | — | 需独立重复对照 |

## 5. 交付决定

- **已支持的声明**：谱系与隔离试验已实现，免费测试通过；提示已陈述机制责任。
- **未支持的声明**：任何关于 agent 实际调用、采用率、质量或成本的结论。
- **下一可证伪检查**：一次真实运行中，谱系是否出现、`trials` 是否被调用、apply 后的组件是否再次进入生产、以及是否至少一次修改落在评价/探索/选择上。
- **关联 backlog**：B（父子通信：候选结果如何回到父 agent）与 C（子 agent 结果全量还是摘要）与本次 `trials` 直接相关，保持开放；D（跨压缩连续性）未触及。