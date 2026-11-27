# ScienceWorld 同分支接入实施记录

日期：2026-11-27。目标分支：`codex/qwen27b-cognitive-harness`。起点为 `18e87450`，它包含用户指定的 `d68e1e7` 和随后的一次 ARC 上下文改动。

## 机会、命题和范围

现有 layered Pi 扩展把 ARC 提示、网格渲染、inventory、关卡回执和自进化流程交织在同一个文件。为 ScienceWorld 接入，需要先找到一个保持 ARC 行为的环境接口切口。本次窄命题是：环境提示构造交给 adapter 后，现有 ARC 系统提示与首轮观测保持一致。它减少以后在共享扩展里新增另一份提示分支的负担。

本次只完成这个切口；ScienceWorld bridge、Python 环境绑定、观测渲染和 runner 尚未实现。设计文档所称“约 15% 的 ARC 专属观测/提示耦合”偏低；`arc_layered_extension.ts` 的边界演化、inventory、状态文字和图像回执都直接使用 `state.frame`。不在没有语义等价检查时一次搬动。

## 改动和回路

`layered_env_adapter.ts` 定义环境提示接口；`arc_env_adapter.ts` 实现当前 ARC 提示的模板选择、条件段和替换；`installLayered` 默认使用 ARC adapter，允许显式传入另一实现。生成的提示照旧进入 Pi 的系统输入，Agent 后续行动和反馈路径不变。此处没有新增常驻模型义务或管理调用。

## 验证与证据层级

- 功能正确：`arc_layered_extension.test.ts` 中首轮系统提示及观测检查通过；全文件运行还有多项失败，涉及旧的 tool mount、review 和边界演化 fixture，未逐项归因，不能声称完整回归通过。首次运行因本工作树缺 `node_modules` 失败，随后按项目说明链接共享依赖才执行。
- 全链路可达：未验证；没有运行 bridge/Pi smoke。
- 自主采用：未验证；没有真实 provider 运行。
- 净收益：未验证；没有对照。

下一步先将 ARC 观测、边界事件和 Python prelude 的任务接口切开，再接 ScienceWorld 真实 bridge 与 runner。相关待办 A（adapter 边界）和 D（压缩后认知连续性）仍开放。

## 2026-11-27 后续进展

新增 `scienceworld_bridge.py`：本机 HTTP `/state` 和带 token 的 `/action`，调用官方 `load/reset/step`，按预定 variation 顺序推进，保存原始观察、reward、done 和 score。`RESET` 是本项目动作，会重开当前 variation 并计入总动作预算。gold path 不生成。当前桥接结果尚未进入 Pi 会话，因此上文“bridge 尚未实现”是此前状态。

`PYTHONPATH=src python -m pytest tests/test_scienceworld_bridge.py -q`：FakeWorld 3 passed，覆盖 variation 切换、预算结束、RESET。功能正确仅限 bridge；全链路、自主采用、净收益仍未验证。主机有 Python 3.12.7，但没有安装 `scienceworld` 或 Java；`winget` 的用户范围 Temurin 17 JRE 安装未找到适用安装程序。真实环境接线仍需解决 JRE。指定的 Azure GPT-6 Sol `.env` 已找到；付费测试上限待用户答复，尚未启动模型请求。

依赖问题已继续解决：从 Adoptium 官方 API 下载便携 Temurin 17 JRE 到 `D:/agent/.cache/scienceworld/`，将 PyPI `scienceworld==1.2.3` 安装到同一缓存的 `python/`。使用这两个路径启动真实 ScienceWorld `1-1` variation 0，bridge `snapshot()` 得到任务描述与 417 个有效动作，`act("look around")` 返回 `NOT_FINISHED`；这是实际 JVM 环境的边界功能证据，仍未经过 Pi。用户澄清 provider 为第三方 `az`，不是 Azure，并授权真实测试总费用最多 20 美元；上述段落中的 provider 名称与预算状态已过时。

## 2026-11-27 同分支插件化完成与运行前协议

Option 1（同分支插件化）已落地：新增 `demo/scienceworld_layered_extension.ts`、`demo/scienceworld_layered_python.ts`、`demo/scienceworld_prelude.py`、`demo/scienceworld_env_adapter.ts`、`demo/prompts/scienceworld_system_harness.md`、`src/autoresearch_pi/scienceworld_bridge.py`、`src/autoresearch_pi/scienceworld_e2e.py`，并把 `scienceworld-e2e` 挂到 `autoresearch_pi.cli`（复用 `arc-thin-e2e` 的子命令模式）。`run_scienceworld_e2e` 每次决策打开一段，Pi 调用 python 后执行 `submit_actions` 并结束该段，runner 在同一 Pi 会话打开下一段；bridge 单 JVM 进程存活整个运行。

离线验证（免费）：`python -m py_compile` 通过；`tests/test_scienceworld_bridge.py` 3 passed；`tests/scienceworld_layered_extension.test.ts` 3 passed；`tests/scienceworld_layered_python.test.ts` 2 passed。真实 bridge 冒烟：以缓存 JRE + `scienceworld` 包启动，`/state` 返回 417 个有效动作，`/action`（含 RESET 与缺 token 403）正常。真实 bridge + 真实 prelude + 真实 layered Python 离线冒烟（无 provider）通过：observation 到达 prelude，`submit_actions(valid_actions[0])` 执行真实动作 `connect agent to air`，反馈到达下一 cell（`OBS1 terminal 1 on agent is now connected...`，`LAST connect agent to air`）。这是 bridge↔prelude↔layered Python 的接线证据，尚未证明真实模型自主采用。

### 付费运行前实验协议

- 目标证据层级：全链路可达 + 自主采用。净收益需独立对照，本单臂运行只给线索，不声明收益。
- 模型/provider：第三方 `az` 网关 `https://az.gptplus5.com/v1`，provider key `az`，模型 `gpt-6-sol`（网关 `/models` 列出的字面 ID；另有 `gpt-6.1-sol`、`gpt-6.2-sol`）。推理级别不显式传 `--thinking`，用 provider 默认。`/models` 不返回单价，网关根页面为 new-api，API 无法读取账户余额；实际计费未验证。
- 任务与初态：ScienceWorld `boil`（task `1-1`），variation `0`，`max_steps=40`。
- 总预算与停止规则：估算预算上限 20.00 USD（费率 input 3.0 / output 12.0 / cache_read 0.3 USD/Mtok，`SCIENCEWORLD_USD_PER_MTOKEN_*` 可覆盖）；墙钟 600s；`max_output_tokens=4096`。停止条件：`win`、`cost_cap`、`deadline`、`budget_exhausted`、`provider_errors`（≥3）、`idle`（连续 4 段无动作）、`idle_timeout`、`length_truncation`、`runner_error`。
- 主要指标：`stop_reason`、`segments`、`python.calls/acting_calls/actions`、`component_changes`、`reads`、`spent_usd_estimate`、`unknown_usage_requests`、token 总量（usage.jsonl）。
- 负例：无动作空转、provider 错误、length 截断、成本超限，都作为失败样本计入。
- 遥测与材料：`run-config.json`、`usage.jsonl`、`layered.jsonl`、`pi-events.jsonl`、`summary.json`、`bridge-stderr.log`。

实际计费口径：runner 用 provider 上报 token 按上述费率估算，`spent_usd_estimate` 不是账单；网关未通过 API 暴露单价/余额，真实美元花费标注为未验证。

## 2026-11-27 修复与真实运行结果

### 修复的两个缺陷

1. `demo/scienceworld_prelude.py` 的 `_ledger` 与 `submit_actions` 读 `after["raw"]["changed"]` / `t["after"]["raw"]["changed"]`，但 `changed` 由 prelude 在 `_append` 计算并放在外层 entry，`raw`（TypeScript 侧 entry）没有该键。每次动作后 `_observe`→`_ledger` 抛 `KeyError: 'changed'`：动作仍执行，但台账事实与回显丢失。改为 `after["changed"]` / `t["after"]["changed"]`。
2. `src/autoresearch_pi/scienceworld_e2e.py` 的空转判定用 `reason == "acted"`，但 extension 的 `segment_end.reason` 是 `"action"`（另有 `"win"`/`"level_change"`/`"budget"`），导致每次动作都被当作空转、连续 4 段后 `idle` 提前停止。改为用 `segment_end.actions > 0` 判定，并把 length 截断检查扩展到 Pi 的 `"length"`。

修复后离线冒烟重跑：`submit_actions(valid_actions[0])` 返回 `executed=1`，`steps` 正确生成（`changed=true, level=1, step=1`），无 `KeyError`。

### 真实 provider 运行（r2）

provider `az`（`https://az.gptplus5.com/v1`），model `gpt-6-sol`，任务 `boil` variation `0`，`max_steps=40`，wall `900s`，budget `20 USD`。结果 `stop_reason=win`，`final_state=WIN`，8 段、10 个动作、17 次 python、8 次动作调用、1 次输出截断、1 次 Agent 自身 `TypeError: 'Obs' object is not subscriptable`（Agent 代码误用 `current_obs[...]` 下标，非 harness 缺陷，随后自行恢复）。token：17 次模型调用，input `44,230`、output `974`、cache_read `51,072`、total `96,276`。`spent_usd_estimate=0.1597`；首次带缺陷的 r1 为 `0.0646`，两次估算合计约 `0.22 USD`，远低于 20 USD 上限。网关未暴露实际账单，真实美元花费未验证。

| 证据层级 | 状态 | Provider / environment | 产物及结论边界 |
| --- | --- | --- | --- |
| 功能正确 | 通过 | 本地 pytest + node test + 真实 JVM bridge | `test_scienceworld_bridge.py` 3、`scienceworld_layered_python.test.ts` 2、`scienceworld_layered_extension.test.ts` 3；真实 bridge `/state` `/action` 含 RESET 与 403 负例 |
| 全链路可达 | 通过 | 真实 `az` `gpt-6-sol` + 真实 ScienceWorld JVM + Pi 0.87.0 | `summary.json` `win`，10 动作、8 段闭环，bridge↔prelude↔layered Python↔runner 全通 |
| 自主采用 | 未验证 | 真实 `az`（单臂） | `component_changes=0`、`reads=0`：未创建/读取 memory/skill/prompt/subagent，仅用 `python`/`submit_actions` |
| 净收益 | 未验证 | 无对照 | 单臂无对照组 |

### 结论

- 同分支插件化接入可运行：真实 provider 在 ScienceWorld `boil` 上自主行动并完成（WIN），估算花费约 0.16 USD，远低于授权上限。
- 但本次单臂运行未出现自进化采用：Agent 只用 `python`/`submit_actions` 行动，没有用 `reflect_component`/`read_component` 创建或读取组件。因此“能接入并跑通”成立，“能自主进化”尚无证据，需更困难任务/多 variation 或显式诊断探针进一步观察。

### ARC 回归复核（2026-11-27）

为确认 installLayered 的 adapter 化没有改变 ARC 默认路径，将 demo/arc_layered_extension.ts 单独 stash 回基线后重跑 rc_layered_extension.test.ts：基线 18e87450 与本改动均为 40 用例、32 pass / 8 fail，且失败用例完全一致。这 8 项失败来自基线已有的 tool mount、review freeze、compaction、stall、folding、stuck audit、clean-context boundary evolution 等 fixture，不是本次 ScienceWorld adapter 重构引入。	ests/test_cli.py 10 passed，确认 cli.py 仅新增 scienceworld-e2e 子命令不影响既有命令。因此 ARC 默认路径行为零变化，满足接入约束。
