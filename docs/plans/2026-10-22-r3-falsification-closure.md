# R3 假设反证到策略转向：变更记录

日期：2026-10-22（Asia/Shanghai）。状态：开发候选已实现；真实 provider 采用与净收益未验证。

## 真实失败、范围与窄命题

`runs/arc-su15-chm-r3-20261022/su15-chm-r3/arc-run` 的 #71–#93 沿同一移动路线造成 156 格变化却没有过关。汇总保留了总动作/变化数，却没有让“到达目标即过关”的当前假设转为 contested；随后相同 Python 检查被反复提交，环境动作停滞。

主命题：在 R3 开启且观测遮罩就绪后，每关前 6 个动作保持探索自由；之后，动作必须绑定一条带可执行 check 的当前假设。G1 是硬契约，不因连续拒绝自动降级放行。有效 check 返回一次 `false` 后，runtime 在同一批次内记录精确假设版本、动作号和反证，标记 contested、挂起依赖策略，并停止剩余批次。改变坐标、棋盘状态或配置不重置这 6 步窗口。相同代码在同一状态反复分析时，第三次调用后暂时收窄工具到 memory/arc_action，防止重复推理持续消耗 provider 轮次。

负例：check 返回 `null` 不生成反证；check 返回错误也不伪造反证，但会在当前批次停止并报告错误，避免沿未经检验的假设继续执行。跨关假设需由 check 自己在不适用时返回 `null`。无可执行 check、普通 cell/state 预测、旧/contested 假设均不能通过 G1。RESET/终局按原有边界处理。

减少的负担：模型不必从跨多步汇总重新发现某条关系已经被证伪；同一静态计算不再反复消耗推理轮次。一次性成本是建立可执行 check；不新增 worker 或每步复盘。

## 实现

- `demo/arc_thin_r3.ts`：G1 的停滞计数按本关动作推进，不因新棋盘/配置清零；遮罩就绪且 6 步后只接受引用有效 checked hypothesis 的预测；G1 不走普通拒绝降级释放路径。
- `demo/arc_thin_prediction.ts` 与 `demo/arc_thin_extension.ts`：动作预测可带 hypothesis key；执行时 pin 其当前 check version。action 写入轨迹后即时运行该 check；false 产生含版本、动作号、适用条件和观测结果的结构化证据，contest 假设、挂起依赖策略，并停止 arc_action 与 Python `env.act` 的剩余动作。check 错误或无结果会停止批次但不会写反证。
- `demo/arc_thin_claims.ts`：区分普通多步趋势统计和假设 check 的反例语义。check 的 `false` 是该版本在适用条件下的反例，`null` 仍不计入判断。
- `demo/arc_thin_memory.ts`：contest 一个假设会自动挂起依赖它的 active strategy 并写入 revision。
- `demo/arc_thin_native_runtime.ts`：同状态相同 Python 分析第 3 次后将本轮工具限制为 memory/arc_action；新证据、状态或工作区版本变化会解除相同状态缓存条件。

## 有界验证协议与结果

诊断样本固定为 R3 的 #63–#93 轨迹及构造负例：新状态/坐标变化不得重置 G1；普通预测和失效/contested key 不得通过；有效绑定通过；false 立即记录并暂停依赖策略、停止批次；null/error 不得误判；第三次相同静态 Python 调用须停止继续 Python 调用并保留可行动路径。

结果：针对性 claims/memory/prediction/R3/native-runtime/action-surface 组 50/50 通过；新增 CH fixture 集成探针 1/1 通过，覆盖版本化反例、memory 证据、依赖策略挂起和列表动作立即截断。集成探针曾抓到 `contestByChecks` 的未定义版本变量，现已修复并回归通过。CH carry 时序测试在候选与未改动基线 `ga/r3-from-83e6-20261022` 上都以相同断言失败，属于基线失败，不能归因于本改动；其余 CH fixture 未证明全套通过。扩展/真实桥接和完整 R3 runner 验收仍未完成。广泛 `node --experimental-transform-types --test tests/arc_thin_*.test.ts` 因并发 WASI 测试耗时停滞而中断；该轮出现多项失败，不能报全套通过。

| 证据层 | 状态 | 结论 |
| --- | --- | --- |
| 功能正确 | 通过（针对性单测及一项 runtime fixture 集成） | 计数、绑定、带版本反证、策略挂起、batch 截断及重复调用限流由确定性检查覆盖；CH carry 基线失败除外。 |
| 全链路可达 | 未验证 | 尚未跑 `arc-harness-smoke` 的完整矩阵，也未跑 R3 bridge/Pi/action/后续父轮探针。 |
| 自主采用 | 未验证 | 未跑真实 provider；本实现要求模型提供 check 并将 action 绑定假设。 |
| 净收益 | 未验证 | 无独立对照；需测成功率、反例至转向动作数、父子 token、管理轮与延迟。 |

边界：runtime 不会从自然语言或像素自动推断“方块到菱形”的语义。若模型在 6 步后未注册带条件的关系 check，动作被拒绝并要求登记检验；这是显式契约，不是自动语义识别。跨关知识适用性与压缩摘要的条件/证据保留（原 R3 E1/E2）尚未由本变更完成。

## 后续检查

1. 对本工作树分组串行重跑失败的 ARC thin 文件，记录每项是否由改动造成。
2. 执行 deterministic real-runner 探针：复现六步边界、引用关系 check、返回 false、确认该动作之后 batch 未继续且下一父轮看见精确反证。
3. 取得用户授权后再做真实 provider su15 对照；候选和冻结基线各 3 次，从相同 #63 快照续跑，测反证到策略转向动作数及父子总成本，不将本地测试称为游戏收益。

## 真实 su15 探索运行协议（启动前登记）

用户于 2026-10-22 明确要求运行真实 su15。本轮先做一条有界探索运行，不将其当作三对三净收益对照。起点固定为 `runs/arc-goal-admission-p0-su15-20261021/ga-p0-shadow-1/arc-run/snapshots/after-decision-25`（#63，刚完成第一关）；先由真实 ARC 桥接重放前缀并逐帧校验。候选为本工作树冻结副本，历史 R3 `runs/arc-su15-chm-r3-20261022/su15-chm-r3/arc-run` 仅作同起点观察参照，因源码及运行时间差异不作因果估计。

模型/provider 为 yibu/qwen3.8-27b，thinking=off（qwen dialect），text+image，CH 观测，native Pi session，ledger+critic，显式 `ARC_THIN_R3=on`。从快照以后最多 20 个新动作、1,000,000 新 budget tokens、1,800 秒，达到第二关结束或任一上限即停；无动作空转也在这些上限内。主要观察：何时登记有适用条件的关系 check；第七步及以后是否将动作绑定有效版本；check 的 false 是否留下精确证据、暂停依赖策略并截断同批次；相同 Python 分析第三次后是否转换到 memory/动作；从反例到下一条不同语义路线的父轮、新动作、父子 token 和墙钟。无 check、只有空泛 check、无动作、拒绝循环和 check 运行错误均作为失败/成本记录。成功或进展不得从动作数或工具调用次数单独推断。

推翻条件：G1 对普通预测放行、反例未造成状态/策略/批次变化、同状态 Python 重复调用未终止，或模型虽被门禁提醒仍不能建立有效关系检验并恢复环境行动。若行为未达到命题，定位首个断裂转移后修订这一因素；本探索样本不证明真实净收益。
