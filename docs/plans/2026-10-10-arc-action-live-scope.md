# Meta-harness 变更记录：ARC 动作 schema 自动对齐当前环境 scope

日期：2026-10-10（Asia/Shanghai）。状态：实现及功能/窄接口诊断完成，保留。

## 问题与命题

- 真实失败：`D:/autoresearch_pi_self_harness_evidence_20261010/real/P040-ls20-candidate/pi-events.jsonl:74–83`。当前 observation 只允许 RESET/ACTION1–4，而 provider 请求 6/7 的工具枚举包含 ACTION5/6，父模型探测后二者均被拒绝。
- 窄命题：每次最新 canonical observation 到达后，runtime 自动将动作 schema 与 agent_available_actions（缺省才采用 available_actions）对齐；没有有效 scope 不暴露可执行动作，不回退动作全集。
- 减负：父模型无需从文本覆盖通用 schema 推断权限，避免将不可用动作呈现为合法选项；无新增模型回合、worker、提醒或语义门禁。
- 推翻条件：实际后续 provider 请求仍暴露已撤回的动作，或状态读取失败后继续暴露旧动作。未知/空 scope、RESET/跨关、恢复、control/treatment 和 consolidation 为负例/生命周期检查。
- 范围：当前 `D:/autoresearch_pi_project` 的 thin 动作工具。运行中实验来自不同 checkout/冻结源，保持该实验的来源完整性，本次不热修改、不重启付费实验。

## 设计与成本

- 复用现有 observation 和 Pi 动态 registerTool/setActiveTools 路径；按环境 scope 生成 enum，ACTION6 存在时才暴露其坐标参数及工具说明。
- 生命周期：bridge 提供 canonical scope → before_agent_start 或 action receipt 取得 observation → runtime 机械绑定 → 下一 provider 请求使用最新 schema → 执行边界仍校验实际权限。空/缺失 scope 时撤下动作工具，后续有效 observation 恢复；consolidation 的禁止动作约束保持。
- 首次获益无需额外父决策；没有新 schema 字段。只有 scope 改变才重新注册，不增加 HTTP 请求，保持既有权限、预算和动作生命周期。
- 撤下可回退源代码；不回退环境历史。B/C/D 的研究到行动、自主采用及净收益保持开放，参见 `docs/deferred-research-todos.md`。

## 运行前实验协议

- 目标：功能正确及窄接口接线诊断；不声明完整五类 ARC 闭环或真实模型收益。
- 比较器：旧静态枚举；本地确定性 HTTP stand-in 重现真实缺失动作，然后验证集合扩张、缩减、RESET、空/未知、失败恢复与 consolidation。
- 原生 Pi/scripted provider + mock SDK 检查实际请求内的 schema 与 observation 一致。零付费模型 tokens、零官方环境动作；本地约十分钟，失败保留并定位，不重启用户已关闭的运行。
- 指标：枚举精确一致、不可用坐标字段不驻留、旧 schema 无法越过执行边界、无额外请求/模型管理步骤；真实动作误调用率和父子总成本收益未测。

## 实现与验证

- 实现：`demo/arc_thin_extension.ts` 移除静态动作全集，复用当前 observation 生成枚举；`agent_available_actions` 优先，缺省使用 `available_actions`，显式空集合保持空。加载时不猜权限；每轮读取状态、持久记录 action receipt 后自动更新注册与激活状态。空/未知 scope 撤下工具，有效 scope 恢复；ACTION6 不可用时不暴露 x/y 或相关工具说明。
- 执行仍对最新 observation 校验动作；即使同批/旧 schema 校验通过，不在最新 scope 内的动作也不发往 bridge。bridge 自身环境权限校验保持，schema 不替代执行边界。
- 红阶段：新增 `tests/arc_thin_action_surface.test.ts` 在旧版加载时检测到七个写死动作，失败。绿阶段：control/treatment 的 HTTP stand-in 检查集合扩张/缩减、action response、RESET、空/未知、恢复、未写死的 ACTION7、consolidation 和 stale call。旧 skill surface fixture 原先未提供环境状态仍期待动作暴露，改为明确提供一个有效 scope 后四项继续通过。
- 原生 Pi：同一 ARC runner 使用的全局 installed CLI 0.80.6（本地 Node 直接 import 的包为 0.87.0）；`tools/arc_thin_action_scope_probe.ts` 是仅测试使用的 scripted provider。本地 HTTP stand-in，7 个实际 provider 请求（含两个刻意负例），枚举 `RESET/ACTION1` → `RESET/ACTION6` → `RESET` → `ACTION3` → 无动作；坐标字段只在 ACTION6 scope 中出现。两个不可用调用得到 Pi schema validation error，HTTP 只收到四个合法动作。见 [摘要](../../runs/arc-action-live-scope-native-20261010-r2/scope-summary.json)、同目录 `scope-provider-requests.jsonl` / `pi-events.jsonl`。
- 回归：`node --experimental-transform-types --test <rg --files tests -g arc_thin_*.test.ts 返回的九个文件>`，54/54 通过；CLI 测试遵循 runner 的 installed Node/Pi 路径解析。完整输出 [Node 日志](../../tmp/arc-action-scope-node-tests.log)。
- 相关 thin smoke：`PYTHONPATH=src D:/conda/python.exe -m autoresearch_pi.cli arc-thin-smoke --root runs/arc-action-live-scope-smoke-20261010`，scripted provider + mock SDK + 真实 bridge/Pi，32/32 检查通过；[summary](../../runs/arc-action-live-scope-smoke-20261010/summary.json)。18 个暴露 arc_action 的实际请求，其枚举与 head 中当轮 available actions 一致，ACTION5/6 和 x/y 均未暴露，见 [scope audit](../../runs/arc-action-live-scope-smoke-20261010/scope-schema-audit.json)。该检查为窄接口诊断，不替代完整五类 ARC 接线矩阵。
- 验证偏离：初次原生 probe 用 CommonJS require.resolve 解析仅有 import export 的 Pi 包，在启动前失败；改为 ESM 后本地 unbundled CLI 在十秒内未出事件。最终按生产 runner 的 installed CLI 解析通过；失败产物 r1 保留，无付费请求。其后缺环境状态的四个旧 fixture 断言失败已修订，全部回归通过。
- 本次付费模型 tokens/官方环境动作均 0。修改只在当前 workspace；实验仍来自独立 checkout/冻结源，不修改其 provenance 或在途行为。`git diff --check` 定向通过。

| 证据层级 | 状态 | Provider / environment | 产物及结论边界 |
| --- | --- | --- | --- |
| 功能正确 | 通过 | 本地 Node + HTTP stand-in；installed Pi/scripted provider | 54 Node + 32 相关 smoke；真实请求枚举及错误语义检查 |
| 全链路可达 | 未验证 | 本次仅窄接口诊断 | 不替代完整 ARC smoke |
| 自主采用 | 未验证 | 不启动真实 provider | 待真实普通运行 |
| 净收益 | 未验证 | 无独立重复对照 | 不声明游戏或成本收益 |

## 交付决定

保留：环境 scope 已成为动作 schema 的唯一来源，无额外模型步骤。完整链路、自主采用、游戏质量和父子总成本净收益未验证。下一可证伪检查为另行授权的普通真实运行中，实际 provider schema 是否始终精确反映当轮 canonical scope，以及不可用动作调用是否减少；不将 scripted provider 的行为当作自主采用。关联 backlog 的 ARC 边界与 B/C/D 状态不提升。
