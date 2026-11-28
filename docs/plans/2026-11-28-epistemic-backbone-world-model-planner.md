# Meta-harness 变更记录：通用科学方法论骨架、可执行世界模型闭环与可组合策略演化（Option A Slice 1）

日期：2026-11-28（Asia/Shanghai）。状态：实现与功能级单测完成；全链路真实调度、自主采用与净收益未验证。
按 [开发流程](../development-workflow.md) 与 [变更模板](../templates/meta-harness-change.md) 编写；关联 [2026-11-28 沙盒与自省方案](2026-11-28-env-agnostic-python-sandbox-introspection.md) 与 [延后待办 A/D](../deferred-research-todos.md)。

## 问题与命题

- **真实失败/机会及材料**：
  - 产物来源：`runs/arc-gpt6sol-low-introspection-5x-20261128-133847/su15/`、`runs/arc-gpt6sol-low-harness-integrity-5x-20261128/`、`runs/arc-gpt6sol-low-harness-default-5x-20261128/`、`runs/arc-gpt6sol-low-harness-5x-20261128/`（均使用 `gpt-6-sol low` + `ARC_LAYERED_EVOLUTION=1`）。
  - 观察到的现象：
    1. 在 `arc-gpt6sol-low-introspection-5x-20261128-133847/su15/` 中，10 轮演化产出的 4 个 `@tool`（`death_frontier`、`death_recovery`、`countdown_guard`、`timer_risk`）全部是事故后局部读数/风险守卫，3 条 `Memory`（`click_effect_model`、`purple_merge_model`、`level3_midpoint_probe`）全部是关卡局部因果笔记；L4 `Skill`、L5 `Prompt`、可执行世界模型 `work/model.py` 与多步离线规划器全部为 `0`。两次 `level_complete` 边界均直接 `no_change`。
    2. 在 `arc_layered_extension.ts` 与 `arc_layered_prelude.py` 中：`trial_at(k, fn)` 屏蔽 `work`/`lib`/`model` 导致无法组合调用已挂载工具或世界模型；`work/model.py` 未接入 `runBoundaryEvolution` 的作者回执、原子回滚、`ACTIVE HARNESS` 和 `Epistemic status` 仪表盘；`dualAudit` 仅统计行为噪声（`unchecked_batches`、`repeats`），缺失“是否已建模/回测命中率/近期是否由模型或策略引导”的认知阶段诊断；所有演化均由负向事故或停滞触发，缺少正向“探索→建模/求解”跃迁边界。
- **窄命题**：在保持环境无关原则（零 ARC 硬编码）的前提下，将通用的“假设探测 → 可回测世界模型 → 离线多步规划 → 跨关提纯”科学骨架写入极简基础提示与 Dossier 认知仪表盘，把 `work/model.py`（含 `last_fail` 见证与 `runtime_error` 自省）及可组合 L3/L4 `@tool`（支持 `trial_at` 只读前缀依赖导入与多步 `plan` 交接）接入边界演化一等生命周期，并增设每关最多一次的正向 `strategy_readiness` 触发与 `level_complete` 策略提纯引导；当真实演化在积累足够有效转移后触发时，预期能将演化产物从“纯反应式局部读数”提升为“可执行世界模型 + 可组合规划器”，同时不破坏既有安全边界与缓存结构。
- **减少的负担**：
  - 消除模型在极简提示下从零摸索“何时该建模、如何用 `work/model.py` 回测、如何让规划器调用模型”的试错成本；
  - 消除跨工具组合时手写重复网格/状态解析的冗余代码，并消除 `work/model.py` 写入失败后残留脏文件污染下一回合的恢复负担。
- **适用条件、合理不使用条件与推翻条件**：
  - **适用条件**：`ARC_LAYERED_PROFILE=qwen27b-harness` 启用演化时（含 `minimalBasePrompt`）。
  - **合理不使用条件**：当关卡在前 5 个有效转移内直接通关，或当前关已存在准确率 $\ge 70\%$ 的 `work/model.py` 或已挂载 `L3`/`L4` 工具时，`strategy_readiness` 不触发；单步探针未积累出稳定规律前不强行写世界模型。
  - **推翻条件**：
    - 安全推翻：`trial_at` 组合导入绕过前缀限制读取未来帧，或通过导入模块逃逸执行 `os`/`open`/`submit_actions`；
    - 行为/收益推翻：真实对照运行中模型仍持续产出纯反应式读数而零 `work/model.py`/L4 规划器，或引入 `strategy_readiness` 与基础骨架后父子总成本/步数显著恶化而无过关率提升。
- **范围及非目标**：
  - **改动范围**：`demo/arc_layered_prelude.py`、`demo/arc_layered_python.ts`、`demo/prompts/arc_layered_system_minimal.md`、`demo/arc_layered_extension.ts`、`src/autoresearch_pi/arc_layered_e2e.py` 及对应定向单测。
  - **明确非目标**：不添加任何游戏名、颜色、坐标或 ARC 专属策略提示；不修改冻结路径（`demo/pi_arc_agi_3_extension.ts`、`demo/arc_thin_*.ts`）及 `arc_action` 接口；不新增额外 LLM 子管理循环；本轮未执行任何付费真实 provider 运行。

## 设计与成本

- **选择与取舍**：选择“通用认知骨架内置（Option A）+ 一等模型/规划器闭环”，而非继续等待单局几十步死亡自发涌现完整科学方法论（Option B）。原因：跨所有环境共有的科学循环属元方法先验，符合 `2026-11-24` 设计中“跨局共性以固定 harness 存在”的裁定；局部自进化只需把具体任务的状态表示、动力学模型与求解器编译落盘。
- **生命周期**：
  - **机会**：`informativeTransitions >= 6` 且无工作模型（`>= 70%`）与无 L3/L4 工具时触发一次性 `strategy_readiness`；或 `level_complete` 触发跨关策略巩固；或既有认知/失败边界暴露 `Epistemic status` 缺口。
  - **候选与验证**：Evolution 在 `python_inspect` 中写入 `work/model.py`（宿主立即全量历史回测，生成 `correct/tested`、`by_level`、`last_fail`、`runtime_error`）或定义可导入 `model`/既有 `@tool` 的策略工具并用 `trial_at(k, fn)` 前缀无前瞻自测。
  - **装配与回滚**：`python_inspect` 校验 `work/model.py` 至少定义一个可用入口且无加载错误，记为 `model/world_model` 变更、发射 `model_published` 事件、注入 `## ACTIVE HARNESS`；任意报错或与同轮工具变更冲突时原子回滚 `work/model.py` 并同步刷新 `modelReport`。
  - **语义使用与反馈**：规划器返回 `plan: [...]` / `recommended_actions` / `branch_action`，在 `_wrap_lib_module` 中接入 `branch_handoff` 追踪；`dualAudit` 下次通过 `Epistemic status` 与 `Last evolution` 反馈 `world_model` 命中率、`last_fail` 与 `guided_recent`。
- **首次获益路径**：探索得到 $\ge 6$ 个有效转移 $\rightarrow$ `strategy_readiness`（或现有边界）触发 Evolution $\rightarrow$ `python_inspect` 写入并通过回测 `work/model.py`（或挂载导入 `model` 的 L4 规划器）$\rightarrow$ 下一父回合在 `## ACTIVE HARNESS` 看到 `MODEL work/model.py` / `TOOL` 并在 `python` 中离线规划与带 `expect=` 执行。
- **新增与移除**：
  - `demo/prompts/arc_layered_system_minimal.md` 新增约 600 字符通用 `## Scientific solving loop`（不含旧 `## Working method` 字样）。
  - `dualAudit` 富面板新增 1 行 `Epistemic status (L...)`；`## ACTIVE HARNESS` 在存在 `work/model.py` 时注入 1 行 `MODEL` 状态摘要；`before_agent_start` 新增每关上限 1 次的 `strategy_readiness` 门；`summary.json` 新增 `components.models_published`。未新增独立 LLM worker 或阻塞性动作门。
- **权限/版本/环境边界**：
  - 组合版 `trial_at` 不暴露 live `_S["lib"]`/`_S["model_module"]`，而是按源码在纯计算沙盒字典 `names`（仅含前缀 `k` 帧与 `_scoped_trial_import`）内重新编译执行，禁止副作用模块与任何未来帧泄漏；
  - `parentReadonlyTools` 下父回合仍不可发布新 `@tool`，但可正常加载/使用已发布组件。
- **放弃与恢复**：`work/model.py` 单轮最多改 1 处且不可与同轮 `@tool`/`reflect_component` 混改；出错即原子回滚到修改前文件内容并清空失效 `modelReport`；`strategy_readiness` 每关最多触发 1 次（随切关重臂），且仍受整局 `correctiveAudits < 8` 总预算限制。

## 运行前实验协议（待授权付费运行后执行）

- **目标证据层级**：自主采用与净收益（真实 `az/gpt-6-sol low`）。
- **主要变量与比较器**：本提交（Option A Slice 1）vs 当前分支基线 `af617f8`（`arc-gpt6sol-low-introspection-5x-20261128-133847`）；单因素固定相同 provider/model/thinking/budget。
- **模型/provider/任务**：`az` `gpt-6-sol`（`low`），优先在 `su15`、`ls20` 做 1–2 次短对照探索后再扩至 5 局矩阵。
- **主要指标与判定标准**：`models_published`、L3/L4 `@tool` 占比、`plan` `branch_handoff` 采纳率、过关数 `levels_completed`、总步数与父子总 token；若模型仍只写局部守卫或成本显著上升无收益，则按 `docs/development-workflow.md` 定位断点修订或撤回。
- **遥测及材料**：`harness/layered.jsonl`（含 `model_published`、`evolution_round`、`branch_handoff`）、`harness/evolution-trace.jsonl`、`summary.json`。

## 实现与验证

- **改动入口及实际行为**：
  1. [demo/arc_layered_prelude.py](../../demo/arc_layered_prelude.py)：`_wrap_lib_module` 识别 `plan` 多步列表；`_sync_work` / `_forecast` / `_observe` / `_model_summary` 记录 `last_fail` 与带自省提示的 `runtime_error` 并在 `sync_only` 与常规回执中同时回传；`_run_readonly_trial` 实现前缀隔离且无副作用的可组合 `model`/`@tool` 依赖加载。
  2. [demo/arc_layered_python.ts](../../demo/arc_layered_python.ts)：`modelReport` 支持 `funcs`、`by_level`、`last_fail`、`runtime_error`，并在移除 `work/model.py` 时清零旧报告。
  3. [demo/prompts/arc_layered_system_minimal.md](../../demo/prompts/arc_layered_system_minimal.md)：补充环境无关的 4 步 `## Scientific solving loop`。
  4. [demo/arc_layered_extension.ts](../../demo/arc_layered_extension.ts)：`dualAudit` 新增 `Epistemic status`；`ACTIVE HARNESS` 注入 `MODEL` 摘要；`runBoundaryEvolution` 支持 `work/model.py` 校验发布与原子回滚；新增每关最多 1 次的 `strategy_readiness` 触发并升级 `level_complete` 为跨关策略巩固；更新 `EVOLUTION_SYSTEM_PROMPT`。
  5. [src/autoresearch_pi/arc_layered_e2e.py](../../src/autoresearch_pi/arc_layered_e2e.py)：`_classify_segment_activity`、`_audits_followed_by_evolution` 与 `summary["components"]["models_published"]` 接入 `model_published`。
  6. [tests/arc_layered_python.test.ts](../../tests/arc_layered_python.test.ts)、[tests/arc_layered_extension.test.ts](../../tests/arc_layered_extension.test.ts)、[tests/test_arc_layered_evolution.py](../../tests/test_arc_layered_evolution.py)：新增 7 项定向单测。
- **功能/相关回归检查（均在最终修改后实测）**：
  - 定向 Node（`node --experimental-transform-types --test --test-name-pattern="..." tests/arc_layered_python.test.ts tests/arc_layered_extension.test.ts`）：**31/31 通过**（含 `last_fail`/`runtime_error`/清除、`trial_at` 组合导入与零前瞻/副作用拦截、`plan` 多步交接、`minimalBasePrompt`、`work/model.py` 发布与原子回滚、`Epistemic status` 与 `strategy_readiness` 单关一次及跨关重臂）。
  - 全量 `tests/arc_layered_python.test.ts`：**67 项中 55 通过、12 失败**（0 新增失败，12 项均与 `2026-11-28` 基线记录的既有失败一致）。
  - 全量 `tests/arc_layered_extension.test.ts tests/arc_layered_components.test.ts`：**72 项中 65 通过、7 失败**（0 新增失败，7 项均与基线记录一致）。
  - Python pytest（`tests/test_arc_layered_evolution.py tests/test_arc_layered_experiments.py`）：**8/8 通过**。
  - `python -m py_compile` 与 `git diff --check`：通过，无语法或空白缺陷。

| 证据层级 | 状态 | Provider / environment | 产物及结论边界 |
| --- | --- | --- | --- |
| 功能正确 | 通过 | Node test runner、原生 CPython 内核（pi_task_python_kernel.ts）、FakeBridge、pytest | 定向 31/31 与 pytest 8/8 全绿；全量 Node 文件相对基线 0 新增失败 |
| 全链路可达 | 未验证 | 未运行带真实 Pi RPC 的 scripted/real e2e smoke | 仅覆盖单测级 `installLayered` + `LayeredPython` 接线 |
| 自主采用 | 未验证 | 未运行真实模型 | 尚无真实 `gpt-6-sol` / Qwen 运行证明其自主产出 `work/model.py` 与规划器 |
| 净收益 | 未验证 | 无独立对照 | 尚未进行与基线 `af617f8` 的同预算对比 |

## 交付决定

- **已支持和未支持的声明**：已完成 Option A Slice 1 的全部代码实现与功能级单测验证；真实 Pi 链路、真实模型自主采用及任务净收益均为“未验证”。
- **决定与依据**：保留为分支 `codex/qwen27b-cognitive-harness` 当前实现；待用户授权后开展下一步实验。
- **剩余验证与下一可证伪检查**：
  1. 免费全链路检查：运行本地 scripted Pi e2e smoke 验证真实 Pi RPC 进程加载新扩展与提示无异常；
  2. 获授权后：在 `su15` 与 `ls20` 上以 `az/gpt-6-sol low` 对比本实现与基线 `af617f8`，检查 `models_published`、L3/L4 工具比例与关卡进展是否真实提升。
- **关联 backlog**：[延后待办](../deferred-research-todos.md) 中的 **A（环境无关 adapter 边界）** 与 **D（跨阶段/压缩认知连续性）** 保持开放；本轮在 `Epistemic status` 与 `level_complete` 巩固方向推进了跨关模型保持机制，但尚未覆盖真实模型跨压缩连续性验证。
