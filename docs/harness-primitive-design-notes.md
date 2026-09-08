# Harness primitive design notes

> 最新架构见 [2026-09-06：Auto-Research 与 Pi 原生任务内 Self-Harness](plans/2026-09-06-autoresearch-pi-task-local-architecture.md)。以下保留前期对齐记录；资源同步、任务策略及独立任务同基线的最新含义以该文档为准。

这些是后续具体设计必须遵守的对齐结论；当前只记录，不实现。

## 角色边界

- `auto-research` 提供流程和方法论。
- 每个具体问题的研究闭环、递归结构和研究方案由 `task agent` 自行设计。
- `task agent` 不应以直接改写一套整体 harness 状态/结构的方式操作；这种笼统变更不规范、难以 trace，也难以在 auto-research 中表达。
- `task agent` 可以实现或更新单个 harness 原语（包括从 0 到 1 的实现），但必须以明确的原语级变更来表达、报告和观测；整体 harness 的组合与运行时承载不作为 task agent 的无界修改面。
- Harness 提供可发现、可调用的原语资源、接口和外部条件。
- 某个原语从 0 到 1 的具体实现可以由 task agent 执行；task agent 负责澄清原语更新内容及其执行结果。
- 原语的具体命名、接口形态和粒度（例如 `memory.read`、`memory.write`）暂不定案，进入具体设计时必须提醒并重新对齐。

## Meta ↔ task agent 同步

研究闭环设计阶段，`auto-research` 应读取 task agent 当前可用的 harness capability/resource surface，把它视为可用环境，而不是预设研究方案。

在后续执行中，task agent 可能新增、删除或更新可用 harness 原语及其资源条件。因此，在一个 auto-research turn 结束时，task agent 应同步：

- 当前可用 harness 资源/原语清单；
- 本 turn 中发生的资源变化；
- 每项变化的生效边界和适用作用域；
- 变化是否已被后续执行观察到；
- 仍然不支持或未实现的能力。

同步内容只描述资源事实和变化，不替 auto-research 决定研究目标、研究边界或研究方法。

## 独立 harness change trace（暂不实现）

未来需要一个独立于 task memory 的 harness trace memory，用来记录 harness 资源变化，例如：

- 原语/资源的新增、删除、更新；
- 变化前后摘要或版本标识；
- 变更来源（task agent 执行、外部条件变化等）；
- 生效时间点、作用域和后续可观测结果。

该 trace 不是 task memory 的别名，也不应被实现成笼统的“整个 harness 版本”记录。记录单位应保持在独立原语/资源层面。具体 schema、持久化方式、版本语义和查询接口留待后续设计。

## 设计提醒

后续进入原语接口或同步协议的具体设计时，必须先重新讨论：

1. 原语的独立、原子因果边界；
2. capability/resource surface 如何被 auto-research 读取；
3. task agent 如何报告原语实现和资源变化；
4. 独立 harness trace 与 task memory 的边界；
5. Pi 官方 hook/API 的实际生效时机与“不支持”项。
