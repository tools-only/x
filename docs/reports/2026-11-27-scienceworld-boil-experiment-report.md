# ScienceWorld 接入实验报告：`boil` 任务真实 provider 运行

日期：2026-11-27。范围：`codex/qwen27b-cognitive-harness`（提交 `912100fd`），同分支插件化（Option 1）接入 ScienceWorld，并用真实第三方 `az` provider `gpt-6-sol` 跑一次付费实验。

## 目标与命题

本实验回答一个窄命题：把 ARC layered 扩展里的环境提示构造切到 `LayeredEnvAdapter` 接口后，ScienceWorld 能否通过同一套 `installLayered` 自进化回路真实接入并完成一个任务。同时检查这次重构是否改变了 ARC 默认路径行为。

证据层级按 `docs/development-workflow.md` 分开报告：功能正确、全链路可达、自主采用、净收益。净收益需要独立对照，本单臂运行只给线索，不声明收益。

## 方法与配置

- 任务：ScienceWorld `boil`（task `1-1`），variation `0`。
- 模型/provider：第三方 `az` 网关 `https://az.gptplus5.com/v1`，provider key `az`，模型 `gpt-6-sol`（网关 `/models` 列出的字面 ID；另有 `gpt-6.1-sol`、`gpt-6.2-sol`）。`--thinking` 用 provider 默认。
- 参数：`max_steps=40`，`max_output_tokens=4096`，wall `900s`，`budget_usd=20.0`。
- 费率估算：input 3.0 / output 12.0 / cache_read 0.3 USD/Mtok（`SCIENCEWORLD_USD_PER_MTOKEN_*` 可覆盖）。
- 环境：ScienceWorld 包装在 `D:\agent\.cache\scienceworld\python`，便携 Temurin 17 JRE 在 `D:\agent\.cache\scienceworld\jre17\jdk-17.0.21.1+2-jre`；Pi 0.87.0，`--no-context-files`（仓库 `AGENTS.md` 不注入 gameplay）。
- 运行产物目录：`runs/pi-scienceworld-boil-gpt6sol-20261127-r2`（最终成功）、`runs/pi-scienceworld-boil-gpt6sol-20261127`（首次带缺陷）。

## 结果概览

| 项 | r1（带缺陷） | r2（修复后） |
| --- | --- | --- |
| `stop_reason` | `idle` | `win` |
| `final_state` | `NOT_FINISHED` | `WIN` |
| 最终得分 | 提前停止 | 100 / 100 |
| 段数 | 4 | 8 |
| 动作数 | 4 | 10 |
| python 调用 | 8 | 17 |
| 动作调用 | 4 | 8 |
| python 错误 | 4 | 1 |
| 输出截断 | 0 | 1 |
| 墙钟 | 50.3s | 103.4s |
| `spent_usd_estimate` | 0.0646 | 0.1597 |

两次估算合计约 0.22 USD，远低于 20 USD 授权上限。网关不通过 API 暴露单价/余额，真实美元花费未验证；`spent_usd_estimate` 只是按 provider 上报 token 和上述费率估算。

## 修复的两个缺陷

r1 提前 `idle` 停止，根因有两个，都已在 r2 前修复：

1. `demo/scienceworld_prelude.py` 读 `after["raw"]["changed"]` / `t["after"]["raw"]["changed"]`，但 `changed` 由 prelude 在 `_append` 计算并放在外层 entry，`raw`（TypeScript 侧 entry）没有该键，导致每次动作后 `KeyError: 'changed'`。改为 `after["changed"]` / `t["after"]["changed"]`。
2. `src/autoresearch_pi/scienceworld_e2e.py` 用 `reason == "acted"` 判空转，但 extension 输出的是 `segment_end.reason == "action"`，导致真实动作被误判为空转、连续 4 段后提前停止。改为用 `segment_end.actions > 0` 判定，并把长度截断检查扩展到 Pi 的 `"length"`。

## 轨迹与得分

r2 的得分推进（从 trace 提取）：

1. `open door to kitchen`（SCORE 0）
2. `go to kitchen`
3. `open cupboard`
4. `move metal pot to sink` + `activate sink`（SCORE 3）
5. `focus on substance in metal pot`（SCORE 70）
6. `move metal pot to stove` + `activate stove`（SCORE 72 → 73）
7. `wait`（加热到沸腾，SCORE 100，WIN）

模型调用 token（r2）：17 次调用，input 44,230、output 974、cache_read 51,072、total 96,276。

## 证据层级

| 层级 | 状态 | Provider / 环境 | 产物与结论边界 |
| --- | --- | --- | --- |
| 功能正确 | 通过 | 本地 pytest + node test + 真实 JVM bridge | `test_scienceworld_bridge.py` 3、`scienceworld_layered_python.test.ts` 2、`scienceworld_layered_extension.test.ts` 3；真实 bridge `/state` `/action` 含 RESET 与缺 token 403 负例 |
| 全链路可达 | 通过 | 真实 `az` `gpt-6-sol` + 真实 ScienceWorld JVM + Pi 0.87.0 | `summary.json` `win`，8 段、10 动作闭环，bridge↔prelude↔layered Python↔runner 全通 |
| 自主采用 | 未验证 | 真实 `az`（单臂） | `component_changes=0`、`reads=0`：未创建/读取 memory/skill/prompt/subagent，仅用 `python`/`submit_actions` |
| 净收益 | 未验证 | 无对照 | 单臂无对照组 |

## ARC 回归复核

`installLayered` 的 adapter 化只改了导入、函数签名（新增 `adapter` 默认参数）和系统提示构造，默认仍走 `arcEnvAdapter`。把 `demo/arc_layered_extension.ts` 单独 stash 回基线后重跑 `arc_layered_extension.test.ts`，结果与改动后完全一致，说明 ARC 默认路径行为零变化。

`arc_layered_extension.test.ts` 当前为 31 pass / 9 fail，全部是基线既有失败（8 项在 `18e87450` 已存在，1 项来自其后两个 harness 提交），都不是本次 ScienceWorld 改动引入。`tests/test_cli.py` 10 passed，确认 `cli.py` 仅新增 `scienceworld-e2e` 子命令、不影响既有命令。

## 结论

- 同分支插件化接入可运行：真实 provider 在 ScienceWorld `boil` 上自主行动并满分（100）完成，估算花费约 0.16 USD，远低于授权上限。
- 但本次单臂运行未出现自进化采用：Agent 全程只用 `python`/`submit_actions` 行动，没有 `reflect_component`/`read_component` 创建或读取组件。因此「能接入并跑通」成立，「能自主进化」尚无证据，需要更困难任务、多 variation 或显式诊断探针进一步观察。
- `boil` 太简单，Agent 不需要进化就能过；不能据此声称自进化方案在 ScienceWorld 上有效。
