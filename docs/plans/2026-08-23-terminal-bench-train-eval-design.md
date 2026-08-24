# Terminal-Bench 2 训练与独立评估设计

## 目标

为 Meta Harness 提供一个可长时运行、可回溯且保持测试独立性的实验边界。Meta 继续自主提出 hypothesis、设计 Spec、构造实验并决定是否演化 Harness；实验层只固定训练任务、留出测试任务、评估时机和记录格式。

## 边界

- Kernel 仍是工具与不可变记录库，不替 Meta 设计实验。
- Meta 只收到当前训练任务，不收到留出测试任务或测试结果。
- Task runtime 执行 Meta 构造的 Harness，并返回环境与 verifier 的权威反馈。
- 留出测试复用同一 Harness 图、Terminal-Bench 数据集、verifier 和运行预算。
- 留出测试以只读策略运行，`experience.submit` 不得写入全局 knowledge。
- 测试结果只写入 evaluation 记录，不进入 Meta job、Task memory 或演化状态。

## 运行过程

1. 解析 suite，并拒绝空任务、重复任务和训练/测试重叠。
2. 对当前 Task Harness 执行一次 baseline 留出测试。
3. 按 suite 中的训练任务依次启动 Meta research。
4. 仅当 Meta 选定的 Task Harness digest 变化时执行 promotion 留出测试。
5. 持续写入 session、checkpoint、事件流和底层 Kernel/Harbor 运行记录。

该流程不根据测试分数自动 promotion 或 rollback，避免测试集反向参与 Meta 决策。checkpoint 只用于独立观测 Harness 效果变化。

## 持久化布局

```text
<root>/
  experiments/<suite>/
    suite.json
    latest.json
    events.jsonl
    sessions/<session>.json
  evaluations/<suite>/
    latest.json
    history.jsonl
    checkpoints/<checkpoint>/
      checkpoint.json
      events.jsonl
  runs/<harness-or-agent-run>/...
  research/...
  knowledge/experiences.jsonl
```

`experiments/.../latest.json` 和 `evaluations/.../latest.json` 在运行期间原子更新。即使进程被外部强制终止，已完成步骤的事件、Task run、Harbor verifier 结果和最后快照仍可读取；未正常收尾的快照会保留 `running` 状态。

## 结果解释

- `mean_score_all` 将不可评估任务按 0 计，仅用于完整任务集趋势。
- `mean_score_evaluable` 只统计拿到 verifier 分数的任务。
- `evaluable=false` 明确区分基础设施/provider/verifier 故障与 Harness 得 0 分。
- 不同 checkpoint 只有在 suite、任务、verifier 和预算保持一致时才可直接比较。

## 命令

运行一天：

```powershell
uv run --no-sync hos experiment run `
  --root .meta-terminal-bench-evolution `
  --suite experiments/terminal-bench-2.toml `
  --duration-hours 24
```

查看运行中状态：

```powershell
uv run --no-sync hos experiment status `
  --root .meta-terminal-bench-evolution `
  --suite experiments/terminal-bench-2.toml
```

手动评估当前 promoted Harness：

```powershell
uv run --no-sync hos experiment evaluate `
  --root .meta-terminal-bench-evolution `
  --suite experiments/terminal-bench-2.toml
```
