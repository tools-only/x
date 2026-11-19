# ARC 七焦点 Evo Meta 主路径

日期：2026-11-19。状态：ARC 主路径已接线，真实模型效果待验证。

## 问题与命题

`runs/su15-selfloop-evo7-20261119-az-qwen` 为了开启旧七焦点，关闭了 Agent 自身运行状态对象。该运行在首次任务动作前遇到 provider 容量错误，不能说明七焦点质量。旧七焦点读取 Binder 和 `data/self`，ARC 的 CH 观测、紧凑任务视图、组件版本与使用回执却进入另一条路径。默认任务运行因此需要一个可直接检查的主路径。

命题是让生产 ARC 使用 Evo Meta 的阶段视图、七个专项焦点与唯一版本账本，并把现有 CH 观测和任务输入压缩接入该路径。若实际请求重复投递棋盘，专项无法修改并激活组件，或复盘打断任务而无法恢复，命题失败。

## 设计与成本

- ARC 的 `SelfRoot` 对象保留为运行状态存储，记录 revision、组件、策略、执行位置、任务结果、用量及证据引用。Evo Meta 决定复盘触发、阶段窗口及焦点推进。
- 真实 ARC 默认使用 Evo Meta 完整七焦点。Agent 可主动请求，过关后触发，连续 50 个真实动作触发兜底。七个焦点共享一次阶段窗口。专项回合暂停游戏动作，修改在下一请求边界激活。
- 任务轮沿用 CH 当前观测、差分、最多一张有用的补充中间帧、近期记忆及按需引用。Meta 回合发送紧凑阶段状态、当前焦点与能力版本，并留出按需读取入口。普通任务回合只保留当前状态投影，不重复投递旧历史。
- 生产 ARC 入口固定此主路径。旧模式仅供历史诊断与已存在的比较运行，不作为新实验的维护目标。
- 使用已有权限、版本与请求边界。没有新增管理 worker。新增的模型开销为一次 Meta 归纳回合和确实触发的七个焦点回合，均按实际请求记账。

## 运行前实验协议

- 接线验证采用生产 runner、Pi、ARC bridge，mock ARC SDK 与脚本 provider。要看到任务动作、主动触发、Meta 入口、七焦点关闭和后续任务动作。检查最新任务观测在请求中出现一次，专项请求无需重复棋盘与图像。
- 真实模型验证沿用已授权的 AZ/Qwen 与本地 SU15，只有 provider 能受理请求时才能检验自主判断。比较任务进展、每实际动作的父子总 input/output、补读次数、墙钟时间及 review 开销。未知成本单列。
- 负例包括没有实质改动时焦点明确 `no_change`、pass 中拒绝游戏动作、provider 失败时不把零动作归因于 Agent、恢复后仍从同一任务位置继续。

## 实现与验证

- 代码入口为 `src/autoresearch_pi/arc_thin_e2e.py`、`demo/arc_thin_extension.ts`、`demo/self_root.ts`、`demo/self_root_arc.ts` 与 `demo/arc_thin_native_runtime.ts`。
- `runs/evo-meta-core-smoke-v5/summary.json` 已在生产 runner/Pi/bridge 和 mock ARC SDK/脚本 provider 下记录 2 个动作、1 个主动请求、7 个焦点、后续动作，0 provider 错误。生产工具名为 `request_evolution`，运行配置标注七焦点开启；运行摘要从 SelfRoot 请求账本列出归纳回合、七个焦点及各回合成本。任务请求头约 1.4–2.1K 字符，七个专项头约 3.2–3.3K 字符；专项头没有重复棋盘文本。这是字符数，不等于真实 provider token 或净收益。
- 定向检查 23 项通过。功能正确：脚本路径通过；真实模型的自主采用、组件语义写入和使用、ARC 质量、父子总成本及净收益均未验证。

## 交付决定

保留单一生产入口，继续依据真实请求检查 token、语义写入及后续任务使用。ARC adapter 职责与跨压缩认知连续性仍是 `docs/deferred-research-todos.md` 中的未完事项。
