# ARC 在线运行问题的最小修复方案

这份方案对应 `runs/arc-20260920-facade-fixed` 的暂停审计。目标是减少控制面错误、避免研究和写入操作悬空，同时保持 ARC 的两个前提：环境只向前推进，且只有主 agent 执行动作。

## 已直接修复

- 统一入口更新资源时，如果候选没有版本号，运行时按资源名称读取当前版本并放入 `target_version`。显式提供旧版本仍然产生冲突，不能覆盖较新的版本。`current_version` 只作为兼容拼写转换为 `target_version`。
- `skill`、`tool`、`subagent` 作为入口中显示的组件名可以直接传入；代码会把它们转换成 procedure、computation、role，再按行为路由。这样不会因为把“skill”写在候选上就再次报 unsupported semantic_kind。
- skill 候选中使用 `procedures` 数组时，运行时把它转换成可保存的说明文本。它不是新的推理步骤，只是兼容旧报告结构。
- 已提交的 review 在再次使用相同 ID 时返回已有结果，不再重复写入。没有显式 ID 时仍保留原有选择和失败预算，不会把周期性审查门控变成无条件放行。
- 没有可处理 handoff 时，`decide_research` 返回无副作用状态；它不创建假的研究记录。
- level review 的 mechanisms、shortcomings、lessons、next_attempt 接受字符串或字符串数组，数组会按换行合并。
- checkpoint 的 `working_summary` 接受对象并序列化为 JSON 字符串，磁盘上的 checkpoint 仍只有一种表示。
- child 上下文超限时先缩短可选观测内容；仍超限则只传上下文引用和“可按引用读取”的标记，而不是直接因可选父上下文过大而拒绝研究。若连引用都放不下，才失败。
- ARC action 返回中删除容易误导的“变化区域整体位移”说明，改为列出独立变化区域的数量、大小和范围。变化区域只是哪些格子变了，不能直接证明移动、阻挡、预算或目标。

## 暂不实现的复杂机制

### 环境变化的完整语义分类

本次运行出现 52/54、2/4、0、58、94、102、146、1465 等不同变化数量。不能把数量硬编码成通用 MOVE/BLOCKED/NO-OP 语义，因为动画、补充物、关卡切换和耗尽后的重启都会改变数量。

最小做法是保留三层数据：原始变化格子、确定性几何摘要、主 agent 明确写下的解释。只有主 agent 或研究报告可以说“这次像移动”或“这次像重启”，运行时不替它作因果结论。后续若要自动分类，应新增独立的、带测试数据的分类器，不改变原始 observation。

### 在线 credit assignment

当前不把一次成功归因给某个单独 memory、skill 或 action。level review 只记录证据引用、使用阶段和反事实说明，并明确“不是因果证明”。这足以支持人工/后续研究复盘，避免在不可回退环境里伪造精确奖励。

### 子 agent 主动实验调度

child 仍不能执行 ARC action。它只能返回一个结构化请求：动作、目的、预算、预期结果和判定条件。主 agent 决定是否执行并把结果带回。暂不加入自动 lease、child 控制权交接或绕过主 agent 的中间结果通道。

### Provider 延迟

已确认响应均为 HTTP 200，问题主要是等待时间长和 toolUse/aborted turn 多。当前最小规避是限制 child 和普通 delegate 的预算，长任务使用 non-blocking。暂不把延迟误报成 provider 失败，也不在在线 ARC 中自动重试动作。

## 验收边界

本次修改可以用离线 fixture 验证字段归一化、版本冲突保护、重复 review 幂等、数组回顾和 checkpoint 序列化。它不能证明真实 ARC 的游戏质量，也不能证明 Auto-Research 已经独立完成实验。真实 ARC 验收必须在新的运行目录进行，不得恢复或重放已暂停的在线运行。
