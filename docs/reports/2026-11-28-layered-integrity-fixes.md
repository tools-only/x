# Layered 工具与进化回执完整性修复

基线：`1cd63d3`，问题来自代码审查和 5 局 AZ `gpt-6-sol low` 运行。工具试验、正式发布、结果声明与行动归因之间存在可观察的断点。命题：使试验与回执如实反映完成的工作，减少无效候选占用进化轮次；任务收益仍需真实对照验证。

## 当前改动

- `trial_at` 可解包已挂载工具；测试覆盖历史前缀。未提供无法从历史重建的当前有效动作列表，避免前瞻。
- `@tool` 代码块末尾表达式成功后才写文件；执行失败恢复原有名称和模块。Python 内核的 prepared 回执不再宣称正式发布。Evolution 发布校验失败时恢复执行前文件；重复错误和无效签名仍返回失败。发布前写恢复记录，重启时对照 HEAD 保留已提交版本、恢复未提交文件；HEAD 通过临时文件替换，替换成功后才更新内存版本。该机制提供进程中断恢复，不声称跨文件系统的断电事务保证。
- Evolution 声称 `evolved` 而没有 mutation 时拒绝该声明，原始声明记入 `claimed_decision`。
- Memory verify 在 API 写入前先规范化并按 Python 表达式语法检查；顶层 `{when, assert}` 兼容为单条规则。候选规则在独立的临时检查状态回放现有历史，SyntaxError、NameError、AttributeError 会拒绝写入；无历史或无匹配并不证明语义正确。
- 工具建议的鼠标动作及动作列表参与后续行动归因；`matched` 区分候选匹配，原 `aligned` 仍要求有效预测，逐步记录计划位置和长度，发生偏离或关卡切换后停止关联。
- `context-calibration.jsonl` 将每次本地消息估算与同一请求 provider 的输入及缓存 token 对齐，明确记录估算缺少系统提示和工具 schema；没有实测数据时不自动改变窗口阈值。
- 审查门控日志补充配额、预算、停滞和候选状态，保留既有调度规则；既有 16 步触发用例通过，另一旧 cooldown 用例在基线已失败，因此不能声明调度有效性已经证明。

- `trial_at` 沙盒内置允许只读标准库白名单（`collections`, `math`, `re`, `heapq`, `itertools`, `functools` 等）并继承函数顶层安全的标准库引用，同时继续拦截 `os`/`sys` 等非白名单模块；避免 `@tool` 因 `ImportError: __import__ not found` 创建失败。
- bound tool 调用期间通过 `activeBoundTool` 抑制内层 `pythonTool.execute` 重复写入 `lib_invocation` 与 `recentCalls`，避免单次调用被双计。
- `foldAfter <= 0` 且未开启 `recoverableFold` 时不再执行 `foldPreActionObservations`，保留前置观察文本以维持 KV Cache 前缀命中。
- 基于 `message_end` 实测输入反馈（`context-calibration.jsonl`）动态校准 `calibratedRatio` 与 `calibratedOverhead`，驱动 `evict`、`compactHistory`（`qwen27b` / `qwen27b-harness` 默认开启 `compactMargin` 兜底）、`before_provider_request` 的 `max_tokens` 夹紧，以及 `runBoundaryEvolution` 跨轮消息截断/输出上限夹紧。

## 验证

- Python 全套（`node --experimental-transform-types --test --test-concurrency=1 tests/arc_layered_python.test.ts`）：49/61 通过、12 项既存基线失败（较基线 43/55、integrity 前版 48/60 新增 1 项 `trial_at` 白名单导入用例通过，无新增回归）。
- extension + components 全套（`node --experimental-transform-types --test --test-concurrency=1 tests/arc_layered_extension.test.ts tests/arc_layered_components.test.ts`）：59/66 通过、7 项既存基线失败（较基线 50/57、integrity 前版 56/63 新增 3 项通过：bound tool 去重、`foldAfter: 0` 保缓存、校准防溢出与 `max_tokens` 夹紧）。
- 定向 Node 回归集（22 项，覆盖上述全部新增与 Phase 1–3 核心用例）：22/22 通过、0 失败。
- `PYTHONPATH=src python -m pytest tests/test_arc_layered_evolution.py tests/test_arc_layered_experiments.py -q`：8 通过。
- 生产 runner、bridge、Pi 与 WASI 的免费接线烟测（mock ARC SDK、scripted provider、Evolution 关闭）：2 动作、WIN、Python 0 错误；产物在 `C:/Users/qi/Documents/Codex/2026-11-27/zai/work/layered-final-smoke/summary.json`。它不覆盖 Evolution 的真实模型调用。
- 以上为脚本与本地内核验证（含本次 `su15` 真实运行日志触发的 4 项修复的本地单测）；本次尚未对这些新增修复重启付费真实 provider 全量复测，自主采用、缓存改善、防溢出真实收益与关卡进展待下一轮真实运行验证。

## 剩余工作

后续使用真实 provider 收集上下文与审查机会证据，比较相同模型和预算下的任务表现与父子成本，再决定是否调整阈值或配额。关联 `docs/deferred-research-todos.md` 的 B/C（工具到行动、成本）及 D（上下文连续性），原待办状态不变。
