# Layered Qwen 五组件变更记录

日期：2026-11-26（Asia/Shanghai）。状态：实验实现与免费本地接线完成；真实模型采用和收益未验证。范围：`arc_layered` 的独立 `qwen27b-harness` profile。用户桌面上的 v2 方案是设计输入，本记录反映本次实际实现与证据。

## 问题与窄命题

旧 `qwen27b` 档位把认知分散在多种 `work/` 文件中，两个无动作 segment 即停止；点击区域重复、全关回顾与纯文本观测缺失。先前真实游戏行为材料见桌面方案 §1.2 及 `docs/deferred-research-todos.md`，其归因仍待独立对照。窄命题：把 Memory、Agent 作者的 Python Tools、按需 Skills、短 Prompt 与同模型 consult 放进一个实验档位，减少首次创建及恢复的手续；底座修复避免过早 idle 和无效重复。若普通运行仍频繁出现管理空转、复用不发生，或任务成绩与父子总成本触及桌面方案 §2 的退化条件，则推翻收益主张。简单关卡合理不使用组件。

## 设计、生命周期和成本

Agent 自行调用 `reflect_component` 定义/修订/恢复 Memory、Skill、Prompt 和 Subagent；runtime 原子更新版本 HEAD，拒绝直接写组件存储。Agent 在 `work/lib/<name>.py` 写合规 `def <name>(args)` 或 `def run(args)`，下一 Python 调用或 segment 起点扫描语法、版本化并挂载同名工具；实际 bound 调用走同一 WASI Python session，成功/动作产出单独记账。Skill 仅列名称摘要，正文由 Agent 按需 `read_component`。Memory/Prompt 在决策状态中注入，context 裁剪后补回当前版本；`live_injected` 只在 context hook 检测可见时记，不能据此断言模型用到了内容。Agent 在停滞时可选择 `consult`；它使用父模型、单轮、无工具、30 秒超时、1500 输出 token 与每关两次的持久配额，结果回到父轮，成本写 `usage.jsonl` 并纳入 runner 汇总。`ARC_LAYERED_CONSULT=0` 可作 B1 消融。

`MAX_IDLE_SEGMENTS=4`，有效工作改动对一个 idle streak 最多抵免一次，末次前警告；无语义门禁。鼠标同帧同连通区域的无效点击计数随变化清空。全关轨迹合并无新态段，报告内部新态及整帧变化两个口径，优先保留首变、死亡、过关与末三步，在 3000 字符上限内可能省略极端密集事件详情。`ARC_LAYERED_NO_IMAGE=1` 发送完整十六进制文本帧和变化摘要，不发 PNG。旧 profile 保持自己的提示及入口。组件能修订/恢复，但不回滚真实环境历史；不再有价值时 Agent 可停止调用，consult 配额按数字 level 累计，同一关重启不刷新。

常驻系统提示为 1231 字符，五组件带来三个工具 schema（`consult` 关闭时两个）及按需状态文字；子调用有真实计算与墙钟成本。首次收益路径是发现适用机会、写函数或定义组件、下一轮实际读取/绑定、观察动作结果、再修订；只存文件或读索引不算采用。没有注入开发流程或仓库 AGENTS.md 到 Pi；runner 保留 `--no-context-files`，adapter/bridge 未扩展研究权限。

## 实验协议与验收边界

桌面方案 §6 的 A（`a791d63`/`qwen27b`）、B1（五组件、consult off）、B2（consult on）、B1-NoImg 是待授权的真实 Qwen 3.8 27B 独立对照。当前工作树基于 `1c9a871b`，与历史 A 提交并非单因素差异；先固定比较 checkout 和模型 thinking/output 参数，再探索、留出游戏交替重复。按方案预定动作、时间、父子 token 预算及退化阈值，记录失败/pending、合理不使用、首次语义使用和后续动作。真实付费运行需要用户另行授权预算，本轮没有启动。无图像与 consult 开关是消融入口，不能由脚本 provider 推论视觉能力或自主发现。

## 实现与已完成检查

- 入口：`demo/arc_layered_components.ts`、`demo/arc_layered_extension.ts`、`demo/arc_layered_prelude.py`、`demo/prompts/arc_layered_system_harness.md`、`src/autoresearch_pi/arc_layered_e2e.py`；脚本传输 `tools/arc_layered_smoke_provider.ts`。
- 定向 Node：组件版本/恢复、当前注入、工具发布与失败、consult 同模型/无工具/限额、轨迹上限、文本帧、鼠标重复、真实 LayeredPython/WASI 函数返回和源修订均通过；Python `tests/test_arc_layered_evolution.py` 2 passed；`git diff --check` 通过。
- 本地链路 `runs/layered-harness-b1-final-20261126/summary.json`：实际 runner + bridge + Pi + WASI、mock ARC SDK、scripted provider，consult off/no-image on，首请求仍有 `reflect_component`、`read_component`，2 动作、0 Python 错误；`smoke-requests.jsonl` 首请求 system 1231 字符、图像 0。`runs/layered-harness-consult-final-20261126/`：同链路 consult on，子请求同 `scripted` 模型、零工具，结果进入下一父轮后执行 1 动作；`usage.jsonl` 子调用 2 reported tokens，runner 汇总 19 次请求、父子 38 reported tokens。此处 token 是脚本伪计量，不是供应商计费。
- 旧测试全集 66 项中 52 通过、14 失败；失败集中在已有 review/claims/expect/lib 输出断言，本轮没有对 HEAD 基线逐项归因，不能声称全套回归通过。此仓库无本地 TypeScript compiler，`npx tsc` 未完成类型检查。

| 层级 | 状态 | Provider / environment | 证据与局限 |
| --- | --- | --- | --- |
| 功能正确 | 定向通过；完整旧套件未通过 | Node tests、真实 WASI + FakeBridge、pytest | 版本/负例、函数语义、已修改接口；旧失败未作基线归因 |
| 全链路可达 | 基本路径及 consult 路径通过；五组件完整语义链未逐项跑通 | scripted provider + mock ARC SDK，实际 runner/bridge/Pi/WASI | 上述两个 `runs/`；不代表真实游戏或模型行为 |
| 自主采用 | 未验证 | 真实 Qwen 未运行 | 不能从 scripted 工具调用推断 |
| 净收益 | 未验证 | 无 A/B 独立对照 | 不能从提示字符数或组件数量推断 |

决定：保留实验档位，不默认替换旧档位。下一可证伪检查是获预算授权后先以短真实 Qwen 运行检验普通情况下的首次创作、绑定调用、Memory 后续探针和停滞 consult 的合理使用，再按预注册对照比较任务效果与父子成本；若未出现使用，定位到曝光、调用摩擦或价值，不增加强制提醒。

关联 backlog：`docs/deferred-research-todos.md` 的 A（adapter 边界）、B/C（子研究目的及父子通信）、D（压缩后认知连续性）保持开放；本轮仅证明无动作子请求与 context hook 可达，未证明研究质量、主动实验或跨压缩后的认知保持。

## 2026-11-26 审计合入与缺陷修复

- **基线合入与单因素对齐**：将 `codex/arc-evo-middle-layer`（`a791d63`）合入 `codex/qwen27b-cognitive-harness`，使 `qwen27b` 与 `qwen27b-harness` 共用同一套滞回 `evict()`、Qwen 27B 紧凑默认参数（`contextCap=40960`、`contextTarget=20480`、`foldAfter=4`、`outputTokens=4096`、`diffImage=false`）及 `work/` 热加载底座，支持干净的同分支对照；同步更新 `qwen27b-harness` 的裁剪 `recoveryText` 携带组件 `Memory`/`Prompt`/`Skills`/`Tools`。
- **`Tools` 发布兼容修复**：`publishTools()` 改为优先检测 `python3` 并回退 `python`，支持 `def <name>(args)` / `def run(args)`（含类型注解/默认值）及无参 `def <name>()` / `def run()`。
- **Prompt 与 `consult` 修复**：将 `demo/prompts/arc_layered_system_harness.md` 扩充至 2,579 字节，补回 `.grid`/`.ascii`、`{{color_legend}}`、`MOUSE` 与 `RESET` 规则、`anim_summary()`、2 次纯观察上限、`work/lib/<name>.py` 发布签名和 `consult("reframer", ...)` 入口；`consult` 改为聚合所有活跃 `memory` 组件中的 `Falsified` 段落（不再硬编码 `"current"`），并在 `MOUSE` 同区重复 ≥ 4 或重复死亡时触发 `STALL` 提示。
- **增量 `NO_IMAGE` 与点击去重修复**：`ARC_LAYERED_NO_IMAGE=1` 仅在首帧、换关或 `RESET` 后发送完整十六进制网格，常规增量步只发送 `Changed cells` 与 `Touched components`；`mouse_tries` 改为按 `(board_key, region)` 独立计数（仅在 `RESET` 或换关时清空全部，不再因单次有变化动作清空其他盘面的无效点击计数）。
- **Layer 0 `segment()` 性能优化**：将 `children` 孔洞判定由每个块全图 64×64 flood-fill 优化为外扩 1 格局部 `bbox` flood-fill，并增加按帧内容缓存；在 193 个连通块（129 个嵌套子块）的 64×64 稠密测试帧上，结果与 `a791d63` 逐字段完全一致，冷耗时由 640.67 ms 降至 31.95 ms（20.1×），缓存命中 0.78 ms。
- **本轮验证范围**：`tests/arc_layered_python.test.ts` 定向 12/12 通过、`tests/arc_layered_components.test.ts` 1/1 通过、`tests/test_arc_layered_evolution.py` 2/2 通过、`py_compile` 与 `git diff --check` 通过。本机环境未安装 `node_modules`（缺少 `typebox` 与本地 Pi 依赖），因此修改后的 `tests/arc_layered_extension.test.ts` 与带 Pi 的 scripted smoke 尚未在本机复跑；需在已安装依赖的环境中补跑 `tests/arc_layered_extension.test.ts` 后再启动真实 Qwen 3.8 27B 对照。

## 2026-11-26 对齐设计指南补齐四底座与组件生命周期闭环

依据独立设计指南（`meta_harness_self_evolution_guide.md`）对本分支尚未闭环的底座与组件机制完成补齐：

1. **底座 2（组件生命周期分桶、见证与过时标记）**：
   - 在 `demo/arc_layered_components.ts` 新增持久化 `stats.json`，按关卡 `by_level` 与 `total` 记录 `invocations` / `ok` / `action_producing` / `reads` / `failures`、来源关号 `defined_level` / `updated_level`、连续失败次数与 1 行客观见证（`last_failure_witness`）及语法/发布连续失败计数。
   - 在 `demo/arc_layered_extension.ts` 将 `reflect_component`、`read_component`、`publishTools()`、bound `tool` 调用、Python `direct_lib`/`assisted_lib` 调用与 `consult` 全部接入上述统计；切关时在 `harnessProfile` 中显式报告 `Carried from earlier levels (unverified on L<N>)`，对连续 3 次发布/执行失败或当关 0 使用达 12 步的 `tool`/`skill` 发送一次性中性 `COMPONENT NOTICE`；工具调用失败响应附加 1 行具体见证。
2. **底座 3（同轮挂载回显、旁路拒写与四类天然边界统一供给）**：
   - `publishTools()` 改为在同一个 `python` 工具返回中回显 `[tool mounted: ...]` 或 `[tool publish failed: ...]`，闭合“写代码 → 验证 → 挂载 → 回显”。
   - 在 `demo/arc_layered_prelude.py` 的 `_open()` 与 `demo/arc_layered_python.ts` 的 `file()` 中拦截绕过 `reflect_component` 读写 `harness/components/` 的尝试（包括未使用 `with` 块直接 `open().write()` 的情况），给出明确指导错误。
   - `LEVEL COMPLETE` 与 `GAME_OVER` 在 `harnessProfile` 下直接内联紧凑全关轨迹/组件战绩摘要与死前致败步/重复死亡事实，分别指向沉淀 `Skills`/`Tools` 与记录 `Memory.Falsified`。
3. **底座 1 & 4（裁剪预算校准、投入-进展比、对称防空转与 `length` 有界恢复）**：
   - `context` hook 将 `recoveryText` 自身 token 估算纳入 `evict` 上限预留（`effectiveCap = cap - recoveryReserve`），并刷新 `recoveryText` 使动态 `Memory`/`Prompt`/`Skills` 只注入决策 head 而不与旧版重复。
   - `STALL` 与 `STUCK` 在 `harnessProfile` 模式下附加最近 12 步窗口的客观 `EFFORT/PROGRESS` 行（`new_states` / `same_repeats` / `repeat_mouse_regions` / `tool_uses` / `py_errors` / `truncated`）。
   - `src/autoresearch_pi/arc_layered_e2e.py` 新增 `_classify_segment_activity()`：通过 `layered.jsonl` 增量游标识别 `component_change` / `read_component` / `consult(ok)` / `tool_published` / 合法 `work/` 改动，连续最多 2 次建设性无动作 segment 不计入 `idle_segments`，防止误杀组件整理与问询回合；`summary.json` 汇总 `components`、`subagents` 与 `length_truncations`，CLI 新增 `--no-image` 快捷参数。
   - 补齐 `length` 截断有界恢复：连续 `length` 在第 1 次恢复注入 `LENGTH RECOVERY` 简短行动提示并在 `before_provider_request` 中关闭思考开关/适度放宽单次输出上限（`<= 8192`），达到上限次数后以 `segment_end.reason = "length_exhausted"` 通知 runner 终止为 `stop_reason = "length_truncation"`，避免无限重发或退化为 `idle`。
- **最新验证（本次提交前）**：`git diff --check`、`py_compile`、`tests/test_arc_layered_evolution.py`（3/3）、`tests/arc_layered_components.test.ts`（2/2）、`tests/arc_layered_python.test.ts` 定向（13/13，含绕过写拦截负例）以及 Node 22 `stripTypeScriptTypes` 对全量修改 `.ts` 文件的语法转换均通过；`tests/arc_layered_extension.test.ts`、scripted Pi smoke 与真实 Qwen 3.8 27B 运行仍受本机缺少 `node_modules` 与未授权预算限制保持未验证。
