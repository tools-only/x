# ARC 自进化创作的 Host 装配减负

日期：2026-11-19（Asia/Shanghai）。状态：局部实现；真实模型收益未验证。

## 问题与命题

- 真实材料：`su15-selfroot-optimized-20261119-completions/session.jsonl` 中普通工具描述和缺少 `# program: on` 被先后拒绝；`ppt-az-qwen3.8-27b-bofa-20261118-selfroot-meta-enabled-05/session.jsonl` 中空 decision evidence 拒绝后，同轮组件提交又被 `transaction chain already failed` 拒绝。这些是旧运行的失败样本，不是本次修改的验收。
- 窄命题：Host 完成可确定的工具 metadata 和唯一来源的 decision receipt 拼接；拒绝一个候选后允许同轮纠正，Agent 不再为格式重试及无关的事务链失败支付管理轮次。
- 反证：同一输入仍因可机械补齐的字段失败；失败候选被偷偷激活；多来源 evidence 被猜测补齐；重试不能在下一请求生效。
- 范围：共享 SelfRoot 编译边界与 ARC/PPT 的失败回执处理。不会猜测 Python 程序逻辑、缺失的科学证据、权限或 Agent 应选择的编排。有关 ARC adapter、认知连续性与自主采用的延后研究仍见 `docs/deferred-research-todos.md`。

## 设计与成本

- 保留 Agent 对是否创作、能力正文和决策依据的选择。Host 在候选验证前补 tool header/可选 description；仅当 decision step 的一个 incoming action receipt 类型唯一且可记录时补 evidence，否则返回具体字段与可记录类型。
- 每次写入仍经完整 validator、权限、revision 与原子候选验证。单次失败只记录该操作，先前合法 pending 保留；异步验证期间被外部 abort 的候选用代际号拒绝。Pi 在 turn_end 才报告的 schema 失败不应撤销后续成功的反射。
- 首次获益不增加模型决策、工具或 worker；不增加新必填字段或 gate。新增的只是有用时一次编译和明确回执。模糊、多来源或非法源码保留拒绝；失败候选不被激活。
- 取消或预算不足时可放弃创作继续任务；未激活的候选不影响环境历史。版本回退只影响未来装配。

## 运行前实验协议

- 本轮目标是功能与生产接线，不启动需要花费的真实 provider。比较器为上述旧输入被拒的现行分支；单因素是 Host 编译及失败恢复，而非提示/worker 数量。脚本 provider、mock ARC SDK 只证实接线。
- 负例：invalid Python、缺少 incoming receipt、多来源歧义、stale revision、并发 abort。判据：定向测试中合法输入成功、非法输入拒绝且同轮可修；真实 runner 的后续请求仍执行任务动作。独立真实模型样本、父子 token、延迟和任务质量没有本轮预算，均标未测，不能称净收益。

## 实现与验证

- `demo/self_root.ts` 增加工具源码包装与唯一 decision receipt 推断，保持现有 validator；拒绝只影响该操作、异步中断仍阻止候选落地。`demo/arc_thin_extension.ts`、`demo/ppt_demo_extension.ts` 在 turn_end 仅在失败后不存在成功反射时调用 abort。
- 定向 Node 测试：`node --test --experimental-transform-types --test-name-pattern 'a rejected|host wraps|decision evidence|host schema rejection' tests/self_root.test.ts`：5 通过。三文件广回归 58 项中 56 通过；两个未改测试失败分别在 `self_root.test.ts` 的 P5 contract usage caps 和 `self_root_meta.test.ts` 的 execution_incomplete，先前基线也出现，未越界修复。
- 生产 runner、真实 bridge/Pi、mock ARC SDK/脚本 provider：`arc-thin-smoke --self-harness` 在 `runs/arc-evo-host-assembly-core-smoke/summary.json` 通过 21 项、4 个动作，后续父轮可达；此脚本没有刻意提交本次修复过的故障输入，故不能证明新输入的完整 ARC 使用闭环。另一个 `--self-baseline --self-components` 运行在 `runs/arc-evo-host-assembly-smoke/summary.json` 因现行主路径缺失预期旧工具而失败，保留失败结果，不能当正例。
- 机会→识别→创作→装配→使用→反馈：旧日志证明 Agent 曾创作并遭格式拒绝；本次新代码的自主识别、实际语义使用和任务反馈未知。未测模型、token、墙钟对照、跨压缩连续性；没有新的付费运行。

| 证据层级 | 状态 | Provider / environment | 产物及边界 |
| --- | --- | --- | --- |
| 功能正确 | 局部通过 | Node 本地；工具 validator 为 fixture | `tests/self_root.test.ts`，覆盖输入和恢复，不证明真实 Python 能力语义 |
| 全链路可达 | 基础接线通过，修复场景未验证 | offline scripted / mock ARC SDK / 真实 runner、bridge 与 Pi | `runs/arc-evo-host-assembly-core-smoke/summary.json`，后续父轮动作可达 |
| 自主采用 | 未验证 | 真实 provider 未启动 | 未知是否自主使用减负后的路径 |
| 净收益 | 未验证 | 无独立对照 | 不把省去的格式拒绝预期等同任务或成本收益 |

## 交付决定

- 暂保留为可试用实现，不宣称 ARC 修复场景完整闭环或优化有效。下一可证伪检查是在生产 ARC 脚本路径中实际提交旧失败输入、同轮修正并在后续父轮调用所挂载工具，再在获授权预算内审阅真实模型自主采用及父子总成本。
