# Self 转化基线：先闭合最短路径，再逐层加回机制

日期：2026-10-28（Asia/Shanghai）。起点：`codex/meta-daemon-response-20261028` / `3ac02314`。实施分支：`codex/self-harness-minimal-path`。状态：基线与首个加层已实现；真实模型行为及净收益未验证。遵循 [开发流程](../development-workflow.md)。

## 问题与可证伪命题

[E0 真实运行审计](../reports/2026-10-26-review-followup-audit.md)涵盖 28 个 su15 run 的 74 次 review：58 次写入 review，46 次指出循环成本，随后 0 次针对该成本的 Agent 可执行组件；8 次 consult-first 门槛阻止写入且咨询失败。这是已观察到的“识别 → 候选”断点，样本以 Qwen 为主、含 fork，不代表所有游戏或模型。现有 [CONVERT](2026-10-28-self-convert-guide.md) 已有本地功能证据，但自主创建与使用未验证。

本轮窄命题：在 native thin 的普通 Task 决策中，Agent 能用最少的创作手续完成 `python(code, save=name)` 的**写入并立即执行 → 读取语义结果 → 下一决策调用已保存工具 → 继续环境行动**；单独加入 CONVERT 后该路径仍可达，且不引入管理决策。若 Binder 只记录保存而不能马上运行、下轮不能调用，或 CONVERT 使保存必须先完成 Meta 合同，则命题失败。

减少的负担是写 frontmatter、mount、EXPECT/trial/DECISION 和咨询才能创作普通 Self 工具，以及等待下一轮才知道代码是否可执行。一次性计算、没有后续复用或预算不足时可不保存。权限、资源、版本、原子写入和环境动作边界继续由现有 runtime/Binder 负责。

## 设计与成本

新增显式 `--self-baseline` 配置，从最新 native treatment 复用 Pi session kernel、WASI Python、Binder、已保存工具调用、ARC bridge 和真实任务决策。它用短系统提示说明可运行的保存入口；关掉 ledger/critic、daemon/process、review/consolidation、refine/consult、work-memory 和常驻 loop/trial 提示。它不自动为 Agent 写文件，不增加新 worker、schema、动作 gate 或管理轮。默认 thin treatment 不变。

首次获益的最短路径：Agent 在任务决策 1 中识别复用价值并调用 `python(code, save=name)`；现有 Python 会话立即运行，Binder 校验并版本化保存，结果回到本决策；Agent 可同轮修改/重跑并采取环境动作。决策 2 的 Binder 索引使工具可调用，调用的实际结果进入任务决策，再继续动作。保存即首次运行，但保存、装配或自动 view 都不等于**后续语义使用**。失败回执在原决策可见，Agent 可修订或放弃；环境历史不回滚。

首个加层由 `--self-convert` 单独启用，沿用现有 repeatedWork→CONVERT 材料与 `data/convert.md`/`convert.jsonl`，只提示重复 Python 的样本、目标路径和可改骨架；Agent 决定是否采用。它不启用 process、daemon、trial 或复盘。单次输入成本是每次出现重复工作时的 CONVERT 文本；具体 token 和收益未测。基线和加层的配置写入 `run-config.json`，可作可复现比较。

| 转移 | 推进者与证据 | 等待、失败、放弃 |
| --- | --- | --- |
| 机会→识别→投入 | Agent 看当前任务及可选 CONVERT；`convert.jsonl` 只记送达 | 不适用或预算不足可跳过；送达不算采用 |
| 候选→执行→装配 | Agent 调 `python(save)`；Binder 记录 `components.jsonl`，Python 返回实际输出/错误 | 校验/运行失败原轮可修；保留版本边界 |
| 后轮语义使用→任务反馈 | Agent 调保存工具、读实际结果、据此行动；`component_runs.jsonl` 与轨迹可核 | 有调用不等于有行动贡献，需审查具体输出与后续选择 |
| 保留/修订/撤下 | Agent 决定；沿用 Binder 写入、删除、恢复 | 无价值可放弃；环境动作不可回滚 |

## 有界评价协议

本轮只运行免费诊断和脚本 provider 的真实 runner 接线验收，预算为 2 Task 决策、2 ARC 动作、600 秒；使用 mock ARC SDK、实际 thin runner/ARC bridge/Pi/Binder/工具执行。比较基线与仅加 CONVERT 两组，另跑默认 thin smoke 排查回归。断言保存返回 42、下一决策显式调用同一工具返回 42、两次真实 bridge 动作顺序正确，管理轮为 0，且配置和工具暴露符合预期。负例由现有 Binder/level review 回归检查覆盖；本轮未新增真实 provider、官方 ARC 或付费运行。父子 token、任务质量和自主识别不能从脚本探针推断。

真实行为试验的下一门槛：先确定 provider 配额与预算，再冻结同模型、推理、任务初态、动作/墙钟/父子 token 上限和独立样本；逐机会记录识别、投入、合法候选、首次运行、下一轮实际使用、动作贡献、合理不使用与失败。比较默认版、最短基线、基线+一个机制，不能把组件数当奖励。初拟探索上限为每组 12 Task 决策、8 动作、15 分钟、100k reported 父子 tokens；正式运行前需按实际 provider 额度和样本数定稿。`length`、取消、pending 与未知费用不记零。

## 实现与验证

入口：`src/autoresearch_pi/cli.py` 的 `arc-thin-e2e/arc-thin-smoke --self-baseline [--self-convert]`；`src/autoresearch_pi/arc_thin_e2e.py` 的 profile/验收；`demo/arc_thin_extension.ts` 与 `demo/prompts/arc_thin_self_baseline.md` 的决策装配；`tools/arc_thin_smoke_provider.ts` 的探针。默认配置保持原行为。

已运行：Python 编译、TypeScript 语法、`git diff --check`；`tests/arc_thin_level_review.test.ts` 8/8（包括 CONVERT 加层的保存/调用检查）；最终代码的 `arc-thin-smoke --self-baseline` 与 `--self-baseline --self-convert` 均 7/7 检查，2 决策、2 动作、0 review/daemon、`tools/answer.py` 由 Agent 保存并在后轮显式调用，两次实际输出均为 42；默认 `arc-thin-smoke` 通过，4 决策/4 动作/1 consolidation。最终接线产物分别在 `runs/self-baseline-final-20261028/`、`runs/self-baseline-convert-final-20261028/`、`runs/self-baseline-default-regression-20261028/`。

| 层级 | 状态 | Provider / environment | 结论边界 |
| --- | --- | --- | --- |
| 功能正确 | 通过 | 本地 Node/Python、定向 fixture | CONVERT 不阻止 `python(save)` 与后续工具调用 |
| 全链路可达 | 通过 | scripted provider、mock ARC SDK；实际 runner/bridge/Pi/Binder/WASI | 指定调用顺序可达，语义输出 42、环境动作 2 次；不证明自主行为 |
| 自主采用 | 未验证 | 无真实 provider 普通运行 | 不知道 Agent 是否自主识别/投入/复用，合理不使用也未评估 |
| 净收益 | 未验证 | 无匹配预算独立对照 | 不知道任务进展或父子总成本是否改善 |

## 下一层的进入条件与决定

保留 opt-in 基线和 CONVERT 加层，作为以后每层的回归锚。先观察真实普通运行的主要损耗转移，再**一次只加入一个因素**：

1. **入口与证据**：若 Agent 仍只写 prose，先核对它是否收到具体样本、可运行路径和失败回执；必要时改善 CONVERT/事件包。不得用强制 trial 替代价值判断。
2. **事件 Refiner**：仅在实际轨迹证明需要服务诊断时，实验过关/GAME_OVER/停滞的事件触发与原始轨迹包。提案仍按当前权限边界由 Agent 决定是否采用；先量化原始回复→解析→Binder→消费的损耗，再简化格式。Refiner 的服务编辑单独记账，不冒充 Agent 自主创作。
3. **Meta process、台账、daemon**：分别证明它们提供基线无法提供的跨轮规则、反馈归因或维护服务；逐层加入并在每层重复最短保存/运行/后轮调用/动作探针。若阻断或拖慢基线，撤下该层，保留原始证据。
4. **真实对照**：只有自主采用有证据后，比较任务进展、首次有效行动延迟、父子总成本与合理放弃；不能凭触发率、组件数或调用次数宣布收益。

这不是宣布所有机制已迁移。[延后事项](../deferred-research-todos.md) 中的证据→行动、父子总成本和跨压缩认知连续性仍开放；此次没有修改 Auto-Research/子 Agent 边界，也没有向 Pi 注入开发规范。
