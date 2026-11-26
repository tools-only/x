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

## 2026-11-27 双层闭环增量（桌面方案）

问题与窄命题：真实 Qwen 运行材料在用户桌面方案 §1 中：死亡后 consult 丢失完整尝试、活体 Memory 与旧 claims 复盘脱节，Agent 常写文本却没有低摩擦可执行检查。本增量仅改 `qwen27b-harness` 所用的 layered 入口；在死亡、停滞、切关处交付客观任务事实与五组件/执行盘点，允许 Agent 自主选择 `Memory.verify` 或 `@tool`，检验随后行为是否改变。简单关卡 ≤20 步完成时合理不使用。连续三次普通运行不采用，或重试仍复读并使任务与总成本退化，推翻收益主张。

设计与成本：Memory 的可选命名表达式随组件版本校验、恢复，在静默 kernel 同步时对已有 transition 回测，后续动作续评并给 witness；同步不计 Python 观察调用，kernel 重启重传。`@tool` 在 Python cell 中提取函数和顶层 import，写 `work/lib/`，同轮发布为绑定工具；模块在每次动作后刷新当前帧等全局量。失败尝试快照保留至 RESET，consult 使用该轨迹。边界包上限 1800 字符，平常步无新增审查；新增每步变化格数、bbox 与触及符号作为事实，策略归因仍由 Agent 决定。组件有版本及源码哈希，工具经真实绑定调用才算使用；verify 被 redefine/restore 清除即停止评分。提示增加三项静态契约，无新 worker 或硬门禁。runner 在 Pi RPC 强制关闭后从持久 action facts 刷新最后一关复盘，因为该关闭不派发 `session_shutdown`。

实验协议：方案 §6 的 `9fcc652` 比较器、Qwen 3.8 27B、2–3 次重复及至少一留出游戏、父子总 token/动作 ≤1.15×、普通无引导运行仍待预算授权。付费实验未启动。负例包含无 verify 的旧版本哈希、错误表达式/签名、kernel timeout 后恢复、简单关卡不使用组件。指标须从 `layered.jsonl`、`decisions.jsonl`、真实 provider 请求与 `summary.json` 联合核对 shown/acted/changed、任务结果、父子计算和管理轮；仅有装载计数不能推断收益。

实现与验证：改动限于 `demo/arc_layered_components.ts`、`arc_layered_prelude.py`、`arc_layered_python.ts`、`arc_layered_extension.ts`、harness prompt、layered runner 与对应测试。`memory_verify_sync`、`memory_verify_failure`、`tool_decorated`、`dual_audit_shown` 事件及 summary 计数已接线。定向 Node 6/6、Python 2/2、py_compile、`git diff --check` 通过；完整旧 Node 72 项 58 通过、14 失败，集中在已有 review/claims/expect 等断言，未在 HEAD 基线逐项归因。没有 TypeScript compiler 的类型检查结果。

本地链路：`runs/layered-dual-final2-20261127/` 用实际 runner/bridge/Pi/WASI、mock ARC SDK、scripted provider、consult off、文本帧；10 动作后 budget_exhausted，`summary.json` 中 `dual_audits_shown=1`，provider request 展示切关审查含轨迹、变化 bbox、符号盘点与五组件，终盘 `work/replay/level_2.md` 实际落盘。这只证明切关与终盘接线；死亡审查、同轮 `@tool` 和 verify 的完整 scripted provider 链路尚未单独跑通。旧 `runs/layered-dual-smoke-20261127/` 普通路径 10 动作、0 provider error，不是采用证据。

| 证据层级 | 状态 | Provider / 环境 | 产物与局限 |
| --- | --- | --- | --- |
| 功能正确 | 定向通过，完整旧套件未通过 | Node/WASI FakeBridge、pytest | `tests/arc_layered_*`、`tests/test_arc_layered_evolution.py`；旧失败未归因 |
| 全链路可达 | 切关审查和终盘复盘通过；完整闭环未验证 | scripted provider、mock ARC SDK，实际 runner/bridge/Pi/WASI | `runs/layered-dual-final2-20261127/`；脚本选择动作，不证明模型能力 |
| 自主采用 | 未验证 | 真实 Qwen 未运行 | shown、工具调用和行为改变待核对 |
| 净收益 | 未验证 | 无独立对照 | 父子总成本与任务成绩待授权实验 |

决定：保持实验档位；下一可证伪检查是预算内普通 Qwen 运行，先核对真实失败后是否自主写入 verify/@tool、成功调用及 Attempt 2 路线，再按预定比较器重复对照。A 的 adapter 边界、B/C 的子研究与通信、D 的跨压缩认知连续性仍开放；本轮只增加了自然边界事实，未替这些待办下结论。

补充验收（2026-11-27）：死亡审查与 consult 完整失败尝试的定向测试通过；长轨迹测试确认 1800 字符内保留 Layer 2 与可编辑能力提示。`memory_verify_sync` 事件保存同步时的完整分关统计，runner 在 RPC 关闭后用它重建终盘复盘；复盘中的 live failure 数来自实际事件，历史分数明确标为同步时快照，不冒充终盘实时分数。`reflect_component` 若版本写入后 kernel 同步失败，错误回执明确提示检查活跃版本再重试。`syncMemoryChecks` 的 transition 索引按 `_T`（跳过初始 history 帧）对应每次动作结果，timeout 恢复测试覆盖两动作；跨关的真实脚本路径亦仍需扩充断言。

新增免费全链路 `runs/layered-dual-evolve-20261127/`：真实 runner/bridge/Pi/WASI + mock ARC SDK + scripted provider；脚本明确指定 Memory.verify、Python `@tool` 与绑定工具调用，`memory_verify_sync` 对既有一动作回测为 1/1，`tool_decorated` 与成功 `bound_invocation` 各一次；下一真实动作发生，终盘 `work/replay/level_1.md` 列出活跃 Memory/Tool 与同步时回测分数。21 次请求、2 个动作、0 provider error、最终 idle；请求记录显示第 4 次请求起挂载 `frame_size`。脚本引导不能作为自主采用或净收益证据。完整 Node 76 项 62 通过、14 失败（旧 review/claims/expect 等断言，仍未基线归因）；定向新增测试通过、Python 2/2、py_compile 和 diff 检查通过。死亡审查在 Fake Python 扩展测试到达，真实 runner 死亡边界仍未单独跑通。上述免费证据只扩展“接线可达”的范围；真实 Qwen 与独立对照仍待授权预算。
