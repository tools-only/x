# Meta-harness 变更记录：thin ARC 中 skill 保存后才可调用（run_skill 与技能注册表绑定）

日期：2026-10-09（Asia/Shanghai）。状态：实现完成，真实运行评估中。
按 [开发流程](../development-workflow.md) 使用；对象为 thin 路径 [`demo/arc_thin_extension.ts`](../../demo/arc_thin_extension.ts)（分支 `thin-arc-self-harness`），legacy `pi_arc_agi_3_extension.ts` 未改动。

## 问题与命题

- 真实失败及材料：基线 [`runs/pi-arc-thin-ls20-board-real-20261009`](../../runs/pi-arc-thin-ls20-board-real-20261009/)（yibu/qwen3.8-27b，ls20 treatment，`--harness-board`，`--max-actions 0`，1.5M token 上限，3600 s）。`pi-events.jsonl` 第 116 行父模型在没有任何保存的情况下调用 `run_skill(name="bottom_row")`，第 118 行开始执行，仅在 execute 内被拒（`no skill 'bottom_row'. Skills: (none)`）。观察：当时 `run_skill` 始终在激活工具中（旧 `ALL_TOOLS`/`CONSOLIDATION_TOOLS`），`name` 是自由字符串，技能目录只是上下文文本。推测：模型把“想要的技能”当作已存在的接口；接口没有表达注册表状态。
- 窄命题：runtime 让调用接口与技能注册表一致（无技能时不暴露 `run_skill`；有技能时 `name` 只能是已保存名称）后，真实模型对未保存名称的调用尝试降为 0，且不降低自主保存/调用技能。是否、何时、写什么技能仍由 Agent 决定；没有强制创作，也没有新增 Agent 手续。
- 减少的负担：模型不再需要从上下文文本推断哪些名称可调用；去除“调用不存在技能 → 读错误 → 改计划”的往返。
- 适用、合理不使用与推翻条件：适用于有技能注册表的 thin treatment；control 不暴露技能。推翻条件：真实运行中仍出现未保存名称调用（如经由同消息保存+调用以外的途径）；或技能保存/调用率明显下降且可归因于 `run_skill` 初期不可见（此时只改一个提示，不加门禁）。
- 范围及非目标：只改调用面、相关措辞、诊断与测量。不修 memory/prompt 中提到未保存技能名的连续性问题（单独记录），不改变 board、memory、动作或预算规则。

## 设计与成本

- Pi spike（[`tools/pi_tool_rebind_spike.ts`](../../tools/pi_tool_rebind_spike.ts)，脚本 provider、无付费模型，运行于实际 runner 所用的全局 Pi 0.80.6；项目 `node_modules` 为 0.87.0，未使用）。原始请求：[`runs/spike-tool-rebind-20261009/requests.jsonl`](../../runs/spike-tool-rebind-20261009/requests.jsonl)，每行记录完整 `context.tools`（name/description/parameters）。
  - (a) 运行中以同名、新参数 schema 重新 `registerTool`：下一次 provider 请求的 `probe.parameters.properties.name.enum` 由 `["a"]` 变为 `["a","b"]`，后续变为 `["a","b","c"]`。成立。
  - (b) 在工具 execute 内 `pi.setActiveTools` 去掉 `extra`：同一 run 下一轮请求不再含 `extra`。成立。
  - (c) 同一消息中 `reschema(["a","b","c"])` 与 `probe(name="c")`：`probe` 按该消息写作时的旧 schema 校验，返回 `Validation failed for tool "probe": name: must be equal to one of the allowed values`；下一轮才可用。
  - (d) 不在 enum 中的值得到同样的 Pi 校验错误，运行继续。(e) 运行中注册的新工具名下一轮自动激活。
- 选择：方案 A。`run_skill` 保持一个工具，`name` 改为 `StringEnum(已保存名称排序)`；不采用每版本一个工具（方案 B），因 A 已在 spike 中成立且不增加工具数量。
- 实现：`refreshSkillSurface(base?)` 由 `skills` map 驱动。名称集合变化时重新注册 `run_skill`（重复保存同名不改 schema）；无技能时从激活工具中移除，有技能时加入。调用点：加载时 `replay()` 之后（只注册；加载期间 `setActiveTools` 不可用）、`session_start`、`before_agent_start`（替代固定工具表，consolidation 同样处理）、`saveSkill` 成功后（覆盖 skill 工具与 board analyst 的 `board_` 修复）、`skill(op="delete")` 后。execute 内 `no skill` 检查保留为纵深防御（同消息中先删后调用时仍按旧 schema 通过校验）。
- 生命周期：机会/识别/投入/候选仍由父 Agent 决定；runtime 只机械地把“保存成功”推进为“可调用”（下一次请求），把“删除”推进为“不可调用”。无新等待或门禁。
- 首次获益路径：保存 → 下一请求调用，与此前相同的两步；同消息保存+调用在旧实现中也会失败（并行执行时 `run_skill` 在保存完成前查表），现在改为 schema 校验失败，往返次数不变。
- 新增与移除：常驻提示措辞改动 4 处（system prompt 一句、skill 工具描述、空目录提示、保存/删除回执各一句）；schema 由自由字符串变为 enum；新增遥测 `harness/skill_surface.jsonl`（仅在暴露状态或名称变化时写一行）。无新工具、worker、必填字段或管理轮。成本：每次名称集合变化，provider 请求的 tools 段改变一次，可能使该次请求的前缀缓存失效（基线 usage 有 39 行 cache_read>0，运行后比较名称变化前后的 cache_read）。
- 已知边界：Pi 的 schema 校验错误不终止批次。若 `arc_action` 与未知名称 `run_skill` 同在一条消息，批次不终止，会多一轮被 gate 拒绝的请求；这与任何参数校验失败相同，旧实现中此情况由 execute 内拒绝并终止。真实运行中计数 `turns_after_action_in_same_run`。
- 权限/版本/环境边界：动作、预算、一次决策一个动作的 gate 未变；skill 版本号与沙箱检查未变。

## 运行前实验协议

- 目标证据层级：功能正确、全链路可达（确定性 provider）、真实模型在该情境下的使用行为（单样本，自主采用层级的线索）。净收益不在本次范围。
- 主要变量与比较器：唯一改变因素为技能调用面绑定（含 4 处措辞）。比较器为上述基线单样本。工作区中其他会话对 thin 文件的并行修改（例如 memory 相关检查）可能与基线启动时的源码不同；启动时与结束时记录源码 sha256，不能称冻结的单因素对照。
- 模型/provider：yibu / qwen3.8-27b，provider 默认思考设置，仅文本输入，与基线 `run-config.json` 相同。普通运行，无引导或指定调用。
- 命令：`python -m autoresearch_pi.cli arc-thin-e2e --game ls20 --variant treatment --arc-root D:\arc-agi-benchmark\arc-agi-3-benchmarking --max-actions 0 --max-reported-tokens 1500000 --experiment-timeout 3600 --harness-board --root runs/pi-arc-thin-ls20-skillbind-real-20261009`（基线 `harness_board: true`，故保留 `--harness-board`）。
- 独立样本：1 次。只检验绑定是否在真实模型下成立，不检验任务收益。
- 预算与停止：1,500,000 reported tokens、3600 s、单决策 900 s，runner 既有停止规则；不中途干预，不付费重试。
- 主要指标：未保存名称调用尝试（目标 0，按 execute 拒绝/schema 拒绝/未暴露分类）；`run_skill` 首次暴露的决策与首次保存的决策；每 10 动作的保存/调用/成功调用；因不可用工具损失的轮次；动作、关数、tokens 仅作记录。若技能使用明显下降，下一步只改一个提示（回执或 system prompt），不加门禁。
- 负例：无技能时调用（应为 `Tool run_skill not found`）、同消息保存+调用（schema 拒绝，下一轮可用）、删除后调用、board 修复保存后的暴露。
- 遥测：`pi-events.jsonl`、`harness/skills.jsonl`、`skill_runs.jsonl`、`skill_surface.jsonl`、`usage.jsonl`；统计脚本 [`tools/arc_thin_skill_binding_metrics.py`](../../tools/arc_thin_skill_binding_metrics.py)（只读）。

## 实现与验证

- 改动入口：[`demo/arc_thin_extension.ts`](../../demo/arc_thin_extension.ts)（`DECISION_TOOLS`/`CONSOLIDATION_TOOLS` 不含 `run_skill`；`refreshSkillSurface`、`registerRunSkill`；回执与空目录提示）；[`demo/prompts/arc_thin_system.md`](../../demo/prompts/arc_thin_system.md) 第 9–11 行；诊断：[`tools/arc_thin_smoke_provider.ts`](../../tools/arc_thin_smoke_provider.ts)（记录完整工具 schema，脚本增加未保存名称调用及 `scratch` 保存/删除）、[`src/autoresearch_pi/arc_thin_e2e.py`](../../src/autoresearch_pi/arc_thin_e2e.py) `_smoke_checks`（新增 4 项检查，`skill_saved_v1` 改为含 `scratch` 的预期序列）、[`tests/arc_thin_skill_surface.test.ts`](../../tests/arc_thin_skill_surface.test.ts)（新）、[`tests/arc_thin_feedback.test.ts`](../../tests/arc_thin_feedback.test.ts)（加载时注册工具数 6→5）。
- 功能检查：`node --experimental-transform-types --no-warnings --test tests/arc_thin_skill_surface.test.ts tests/arc_thin_memory.test.ts tests/arc_thin_feedback.test.ts tests/pi_harness_board.test.ts` → 26/26 通过（[输出](../../runs/spike-tool-rebind-20261009/thin-node-tests.txt)）。新测试覆盖：空存储决策/consolidation 工具集均无 `run_skill`；保存后 enum 为 `["count_color"]`、第二个技能后为排序的两个名称、同名重存不重新注册、删除后收缩、删除最后一个后不激活且下一决策仍不激活、再次保存恢复；回执文本；用删除前的 schema 对象调用已删除名称仍在 execute 内被拒；新实例从 `skills.jsonl` 重放（含已删除名称）只绑定现存名称；control 不注册 `run_skill`。首次运行 `arc_thin_feedback` 失败一项（断言加载时 6 个工具），属预期接口变化，已改断言。
- 全链路（确定性 provider，Pi 0.80.6 全局 CLI、真实 bridge、mock ARC SDK、真实 WASI 沙箱）：
  - `arc-thin-smoke` → passed（[summary](../../runs/arc-thin-smoke-skillbind-20261009/summary.json)，[请求记录](../../runs/arc-thin-smoke-skillbind-20261009/smoke-requests.jsonl)）。新检查：`run_skill_hidden_before_save`（首个请求工具为 arc_action/memory/skill/prompt/ask_analyst，保存前所有请求均无 `run_skill`）；`run_skill_bound_after_save`（保存回执后的请求中 `name.enum == ["count_color"]`，回执含 `run_skill(name="count_color") is callable from your next step`）；`unregistered_name_schema_error`（`run_skill(name="bottom_row")` 得到 Pi 校验错误 `name: must be equal to one of the allowed values`，同一决策后续脚本步骤继续执行，`skill_runs.jsonl` 无 `bottom_row`）；`delete_removes_name`（保存 `scratch` 后 enum 为 `["count_color","scratch"]`，删除后为 `["count_color"]`，回执含 `is no longer callable`）。原有检查全部通过。
  - `arc-thin-smoke --board` → passed（[summary](../../runs/arc-thin-smoke-skillbind-board-20261009/summary.json)），board 合约回执、`board_` 修复保存与重放未受影响。
  - 这些只证明接线与生命周期可达，不证明真实模型行为。
- 基线测量（只读，[`baseline-skill-binding-metrics.json`](../../runs/spike-tool-rebind-20261009/baseline-skill-binding-metrics.json)）：未保存名称调用 1 次（turn 9 / 第 5 个 run，`bottom_row`，从未保存，非同消息保存；同消息另有一个成功的 memory 调用），完全浪费的轮次 0；模型下一轮直接 `arc_action`，没有创建 `bottom_row`。基线全程：1 次保存（`analyze`，决策 12）、6 次调用全部成功，每 10 动作 0.21 保存 / 1.28 调用；47 动作/0 关/860,164 reported tokens/decision_timeout 停止。`skill_runs.jsonl` 不记录该失败调用，只能从 `pi-events.jsonl` 恢复。
- 连续性缺口（单独记录，不在本次修复）：基线 `memory.jsonl` 与 prompt 存储中没有提到未保存技能名（脚本 `continuity_mentions` 为空，人工 grep `skill|bottom_row` 无匹配）。本样本中该缺口未出现；保留检查项用于处理组。

| 证据层级 | 状态 | Provider / environment | 产物及结论边界 |
| --- | --- | --- | --- |
| 功能正确 | 通过 | Node 单元（伪 ExtensionAPI + 真实沙箱）| 待补 |
| 全链路可达 | 通过 | 真实 bridge + mock ARC SDK + 全局 Pi 0.80.6 + 脚本 provider | 待补 |
| 自主采用 | 未验证 | yibu/qwen3.8-27b | 运行中 |
| 净收益 | 未验证 | — | 单样本，不评估 |

## 交付决定

（运行后补充）
