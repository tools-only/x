# Meta-harness 变更记录：六载体极薄认知策略层（Option 2A）与实跑断点修复

日期：2026-11-28（Asia/Shanghai）。状态：实现与功能级单测完成；全链路真实调度、自主采用与净收益未验证。
按 [开发流程](../development-workflow.md) 与 [变更模板](../templates/meta-harness-change.md) 编写；关联 [Option A Slice 1 记录](2026-11-28-epistemic-backbone-world-model-planner.md) 与 [延后待办 A/B/C/D](../deferred-research-todos.md)。

## 问题与命题

- **真实失败/机会及材料**：
  - 产物来源：`runs/arc-env-error-validation-20261128-154610/`（`su15`，`az/gpt-6-sol low`，`ARC_LAYERED_EVOLUTION=1`）。
  - 观察到的现象与断点：
    1. 本局 `level_complete` 产出了跨关科学流程 `skill/segment_and_validate_motion`（`v1`），但组件统计 `reads=0`——因 `## ACTIVE HARNESS` 只渲染名字 `SKILLS: ...`、隐藏了 `summary`/`when`（且工作区近期新增的 `[STRATEGY]` + `SKILL` 摘要渲染补齐了这一层）。
    2. 在 `231` 步、`6` 次死亡、`2` 次 `stall` 中，`Prompt (L5)` 为 `0`、`Memory (L4)` 策略卡为 `0`、`consult` 为 `0`；`@tool` 虽调用 `24` 次，但 4 个工具中有 3 个因 `# layer:`/`# scope:`/`# when:` 写在 `@tool` 上方而被 `_extract_decorated_tools` 剥离（导致 `layer=None`），且局部避障工具 `blue_hazard_guard` 未被编排为目标推进或破局切换。
    3. `trial_at` 将 `def guard_mouse_plan(actions=None):` 的不可变字面量默认参数当作捕获 live 值拒绝，烧毁 `s118` 4 轮演化；`runBoundaryEvolution` 在同轮 Round 3 修订自己刚写的 `work/model.py`（`1/9 -> 2/9`）时误触发 `mutations.length > 0` 被回滚。
- **窄命题**：保留既有世界模型与触发机制（本轮不做减法），正式新增第 6 个轻量版本化组件载体 `orchestration`（`<= 500` 字符、单活体槽位、`L5`、`scope='game'`），与 `Prompt`、`Memory`（L4 `[STRATEGY]` + L3 因果）、`Skill`、`Tools`、`Subagent` 协同工作：由运行时结合客观死亡/停滞/进展信号驱动三态解题模式（`EXPLORE` / `EXPLOIT` / `REFRAME`），在 `## ACTIVE HARNESS` 顶部输出 1 行 `ORCHESTRATION [MODE]` 并按模式重排组件优先级（`REFRAME` 自动置前 `SUBAGENTS (consult)` 并软降权发生 `repeat_mismatch` 的旧工具），同时修复 `@tool` 上方注释剥离、`trial_at` 字面量默认参数与同轮 `work/model.py` 修订回滚 3 处实跑机械断点。
- **减少的负担**：
  - 把“什么时候先读 Skill、什么时候按子目标推进、什么时候停掉局部工具改调 `consult`”从隐式靠模型猜转为 1 行显式编排接力，且不增加重型规划代码或额外 LLM 循环；
  - 消除 `@tool` 元数据注释丢失、字面量默认参数误拒绝与同轮修补 `model.py` 被自己回滚的摩擦。
- **适用条件、合理不使用条件与推翻条件**：
  - **适用条件**：启用 `ARC_LAYERED_PROFILE=qwen27b-harness` 的运行。
  - **合理不使用条件**：关卡无任何活跃组件、无 `work/model.py` 且未进入 `REFRAME` 时，不在 `## ACTIVE HARNESS` 额外占用字符；Evolution 不必强制创建 `orchestration` 组件，运行时自动给出默认三态路由。
  - **推翻条件**：
    - 安全推翻：`trial_at` 允许字面量默认参数后仍允许闭包或 live 对象泄露（如 `def f(x=transitions)` 未被拦截）；
    - 行为/收益推翻：真实运行中进入 `REFRAME` 后仍继续重复失配局部工具且 `consult`/`Skill` 消费率为 0，或面板重排引发 KV Cache 失效/成本显著恶化。
- **范围及非目标**：
  - **改动范围**：`demo/arc_layered_components.ts`、`demo/arc_layered_prelude.py`、`demo/prompts/arc_layered_system_minimal.md`、`demo/arc_layered_extension.ts`、`src/autoresearch_pi/arc_layered_e2e.py` 及对应单测。
  - **明确非目标**：本轮不删减既有 `work/model.py` 或 `strategy_readiness`；不新增独立 LLM 管理循环或阻塞动作门；不硬编码任何 ARC 专属规则/颜色/坐标；不启动付费真实模型运行。

## 设计与成本

- **选择与取舍**：采用 **Option 2A**（正式将 `orchestration` 纳入 `LayeredComponents` 成为第 6 种可版本化/可回滚组件），而非仅靠静态 `if/else` 或散文 Prompt（Option 2B），使 Evolution 能直接审查、新增和修订阶段接力策略与重框阈值，并复用既有 `reflect_component` / `read_component` / `live_injected` 审计链路。
- **生命周期**：
  - `EXPLORE`（默认探索期：置前 `[STRATEGY]`、`Prompt`、`Skill`）$\rightarrow$ `EXPLOIT`（稳定推进期或有效 `work/model.py`：置前 `[STRATEGY]`、`Prompt`、目标对齐 `@tool`）$\rightarrow$ `REFRAME`（本关 `orchestration` 更新后新死亡 $\ge$ `reframe_after_deaths` [默认 2]，或 `[STRATEGY]` 被证伪/`REVIEW_DUE`，或 `stale_steps >= 16`：置前 `SUBAGENTS (consult)` 含内置 `reframer`，并将 `repeat_mismatch > 0` 的旧工具后置）。
  - Evolution 通过 `reflect_component(kind='orchestration', ...)` 可改写 `mode`、`handoff`、`batch_hint`、`reframe_after_deaths`，写入后当关死亡计数清零重武装。
- **新增与移除**：
  - `LayeredComponents` 新增 `Kind = "orchestration"`（上限 `500` 字，默认 `scope="game"`、`layer="L5"`）；
  - `## ACTIVE HARNESS` 顶部增 1 行 `ORCHESTRATION [MODE]: ...`（受既有 `2500` 字符上限约束），`dualAudit` 富面板增 1 行 `- Strategy & orchestration (L...)`；
  - `summary["component_adoption"]` 新增 `orchestration_live_injected`。未移除既有功能。
- **权限/版本/环境边界**：
  - `trial_at` 仅放行递归全为不可变基本字面量（`None/bool/int/float/str/bytes` 及纯字面量 `tuple`）的默认参数；闭包及可变/live 默认值继续拒绝；
  - 同轮 `python_inspect` 允许迭代修改同一个 `work/model.py`，但仍禁止同轮与 `@tool`/`reflect_component` 混改（保持单轮单实体变更不变量）。

## 实现与验证

- **改动入口及实际行为**：
  1. [arc_layered_components.ts](../../demo/arc_layered_components.ts)：新增 `"orchestration"` 类型（`LIMIT=500`、默认 `L5`/`game`）。
  2. [arc_layered_prelude.py](../../demo/arc_layered_prelude.py)：`_extract_decorated_tools` 保留紧贴 `@tool` 上方的 `#` 元数据注释；`_run_readonly_trial` 通过 `_is_literal_default` 放行不可变字面量默认参数。
  3. [arc_layered_system_minimal.md](../../demo/prompts/arc_layered_system_minimal.md)：在 `## ACTIVE HARNESS` 下补充 1 行 `ORCHESTRATION` 阶段引导。
  4. [arc_layered_extension.ts](../../demo/arc_layered_extension.ts)：实现 `parseOrchestrationBody`、`deriveOrchestration`、六载体全链接入（`reflectSchema`/`readSchema`/`executeReflectComponent`/`writeLevelReview`/`layer2Snapshot`/`dualAudit`/`EVOLUTION_SYSTEM_PROMPT`）、`REFRAME` 面板重排、`live_injected` 记账，以及同轮 `work/model.py` 迭代修复允许。
  5. [arc_layered_e2e.py](../../src/autoresearch_pi/arc_layered_e2e.py)：新增 `orchestration_live_injected` 汇总字段。
  6. [arc_layered_components.test.ts](../../tests/arc_layered_components.test.ts)、[arc_layered_python.test.ts](../../tests/arc_layered_python.test.ts)、[arc_layered_extension.test.ts](../../tests/arc_layered_extension.test.ts)：新增对应单测。
- **功能/相关回归检查（最终修改后实测）**：
  - 定向 Node（含 `orchestration`、策略卡、`Skill` 摘要、`@tool` 头注释、字面量默认参数、同轮 `model.py` 修订与核心回归）：**39/39 通过**；
  - 全量 `tests/arc_layered_python.test.ts`：**69 项中 57 通过、12 失败**（0 新增失败，12 项与基线既有失败一致）；
  - 全量 `tests/arc_layered_extension.test.ts tests/arc_layered_components.test.ts`：**78 项中 71 通过、7 失败**（0 新增失败，7 项与基线既有失败一致）；
  - Python `pytest tests/test_arc_layered_evolution.py tests/test_arc_layered_experiments.py -q`：**8/8 通过**；`py_compile` 与 `git diff --check` 通过。

| 证据层级 | 状态 | Provider / environment | 产物及结论边界 |
| --- | --- | --- | --- |
| 功能正确 | 通过 | Node test runner、原生 CPython 内核、FakeBridge、pytest | 定向 39/39 与 pytest 8/8 全绿；全量 Node 相对基线 0 新增失败 |
| 全链路可达 | 未验证 | 未运行真实 Pi RPC scripted/real e2e | 仅覆盖单测级 `installLayered` + `LayeredPython` 接线 |
| 自主采用 | 未验证 | 未运行真实模型 | 尚待真实运行观察 `orchestration`/`[STRATEGY]`/`Skill`/`consult` 协同消费 |
| 净收益 | 未验证 | 无独立对照 | 尚未进行与基线同预算对照 |

## 交付决定

- **已支持和未支持的声明**：已完成 Option 2A 六载体极薄认知策略层及 3 处实跑机械缺陷的代码实现与功能单测；全链路 Pi 接线、真实模型自主协同与净收益保持未验证。
- **剩余验证与下一可证伪检查**：获授权后在 `su15` / `ls20` 运行对照实验，检查 `Skill` `reads > 0`、`orchestration_live_injected`、`REFRAME` 后 `consult` 触发及过关/步数变化。
- **关联 backlog**：[延后待办](../deferred-research-todos.md) A（adapter 边界）、B/C（子研究与父子通信）、D（压缩连续性）保持开放。

## 2026-11-28 修订：世界模型降级为按需可选并拆分当关前向准确率

- **事实依据**：结合 `runs/arc-env-error-validation-20261128-154610/` 的回溯分析，强制/默认优先构建完整 `work/model.py`（`predict(frame, action)`）耗费了多轮演化（L1 s9 1/9、L2 s28 19/28 [L2 2/7]、s185 25/185 [L2 8/164]、s204 137/204 [L2 120/183]），且全局历史回测会掩盖当关前向表现；最终第 2 关仍耗尽动作预算。
- **核心改动**：
  1. **前向准确率拆分（[demo/arc_layered_prelude.py](../../demo/arc_layered_prelude.py)、[demo/arc_layered_python.ts](../../demo/arc_layered_python.ts)）**：在 `_sync_work` 中随 `work/model.py` 源码/依赖变更重置 `live`；在 `_observe` 中按关卡累计当前版本上线后的真实前向预测命中 `live[level]`，并在 `_model_summary` 与 `modelReport` 中与 `by_level` 历史回测分列返回。
  2. **按需世界模型与局部/轻量优先（[demo/prompts/arc_layered_system_minimal.md](../../demo/prompts/arc_layered_system_minimal.md)、[demo/arc_layered_extension.ts](../../demo/arc_layered_extension.ts)）**：
     - 将 `## Scientific solving loop` 与 `EVOLUTION_SYSTEM_PROMPT`、`Boundary rule (LEVEL_COMPLETE / STRATEGY_READINESS)` 调整为默认维护轻量假设与 `[STRATEGY]` 卡，优先使用允许返回 `None`/`"unknown"` 的局部决策/校验 `@tool` 与已验证范围内的有界计划；仅在同类预测反复使用、当关样本充足且轻量方案不足时才编写/修复 `work/model.py`。
     - 新增 `isCurrentLevelModelWorking(modelSnap, level)`（当 `live[level].tested >= 3` 时以当关前向命中率为准，否则以 `by_level[level]` 为准），用于 `deriveOrchestration` 与 `strategy_readiness`，防止前序关卡回测掩盖当前关卡。
     - `strategy_readiness` 同时识别有效且非 `dormant`/`variant_broken`/`contradicted` 的 L4 关卡 `[STRATEGY]` 记忆卡与 L3/L4 `@tool`，不再把“缺少 `work/model.py`”本身视为触发条件。
     - 在 `dualAudit`（`L<N>_live=C/T`）与 `## ACTIVE HARNESS`（`[L<N> live: C/T]`，仅在 `tested > 0` 时附加以保持原有前缀兼容）中分别呈现当关前向指标。
- **四层证据评估边界（本次修改后当前状态）**：
  - **功能与本地接线（Function & Wiring — 已通过）**：
    - Targeted Node suite：5/5 通过（覆盖 `forward live accuracy` 重置与拆分、`world model is optional` 覆盖判定、`orchestration 6th carrier`、`leading metadata header comments`、`arc_layered_components`）。
    - Full `tests/arc_layered_python.test.ts`：58/70 通过（12 项与修改前一致的既有基线失败，无新增失败）。
    - Full `tests/arc_layered_extension.test.ts tests/arc_layered_components.test.ts`：72/79 通过（7 项与修改前一致的既有基线失败，无新增失败）。
    - Python tests & compile & diff：`pytest tests/test_arc_layered_evolution.py tests/test_arc_layered_experiments.py -q` 8/8 通过，`py_compile` 与 `git diff --check` 无错误。
  - **全链可达 / 自主采纳 / 任务净收益（End-to-End Reachability / Autonomous Adoption / Net Benefit — 未验证）**：上述全部验证均在本地 mock bridge 与 scripted `streamSimple` 下完成，尚未运行真实 provider 的收费 ARC-AGI-3 对局，因此真实模型是否更少陷入 `model.py` 泥潭并转向有效 `[STRATEGY]`/局部 `@tool` 从而提升通关率与净收益仍待后续实测验证。


## 2026-11-28 修订：策略事实连续性与过关证据

su15 实跑四次因策略卡超限被拒，且 v8 修订漏掉 v7 已记录的 UNDO 约束。第 1 关的跨关记忆记录了移动规律，第 2 关策略直到第 170 步仍缺少可观测的目标进度。保留 700 字符预算，在演化提示和工具说明公开上限。修订时保留已确认约束，过关时提炼可观测的胜利条件及进度指标，对未知目标用单步探针区分竞争假设。

定向脚本测试通过两项，覆盖演化请求中的策略契约和过关审计中的证据提取指令。真实 provider 的自主采用、超限重试次数和过关净收益待验证。复跑可对比策略卡超限拒绝、已确认约束保留、下一关是否执行目标探针，以及通关和动作成本。

## 2026-11-28 修订：保存更新后避开低余量演化轮

bp35 在 240 秒审计的第 2 轮超时，当时 Memory v2 已保存。保留审计的硬期限，在保存更新后，若剩余时间低于 45 秒或低于上一轮耗时，结束审计并记录 deadline_headroom。提示 Agent 在最高优先级缺口解决后及时收尾，证据充分时合并提交与收尾调用。

脚本回归验证短期限内只请求一轮并保留更新，也覆盖无更新时的既有修复轮行为。真实复跑需比较审计超时次数、每次审计耗时、成功更新和动作成本。首轮慢请求仍受原硬期限约束。
