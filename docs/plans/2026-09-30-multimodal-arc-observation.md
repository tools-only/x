# 多模态 ARC 观测接线

日期：2026-09-30。范围：当前公开 frame 的 Agent 侧表示；不修改 ARC 动作语义、游戏规则或 Auto-Research 的决策权限。

## 数据流

1. ARC bridge 的 `/state` 仍是公开状态来源。父循环在每个决策周期读取一次，并在 treatment 中写入 canonical `observation_snapshot`。完整数值矩阵保留在该资源中。
2. runner 把模型声明的输入模态传给 Pi 扩展。运行多模态模型时设置 `ARC_INPUT_MODALITIES=text,image`；仅文本模型保持 `text`。声明 `image` 只是启用条件，不等于图像已经送达 provider。
3. 多模态父循环把最后一张当前 frame 编成完整 PNG。系统输入提供完整十六进制网格、状态、预算、动作列表、近期逐动作观测及 canonical 引用；图像作为 Pi `context` 的临时 user 消息中的 `type=image, mimeType=image/png` 附加到每次 provider 请求，包括同一决策周期内的工具续轮。该消息不写入 Pi 会话历史；添加点位于历史压缩之后，避免 base64 被当作可累积的文本历史。
4. 文本和图像模式均自动得到完整当前帧的精确网格。2026-10-02 按用户要求移除父 Agent 的 `arc_state` 工具注册、局部裁剪语法及恢复提示中的回看引导。历史帧可以被压缩，完整当前帧每轮自动提供，Agent 无需调用工具重新加载当前状态。
5. ARC child 按授权使用父进程发布的状态快照。多模态 child 的 `arc_state(request='current'|'image')` 返回完整 PNG 和完整十六进制网格；`map`、`full` 返回完整精确文本，取消局部裁剪。研究 child 仍只读；普通 delegate 只有获显式有界动作租约时才能执行动作。
6. `arc-observation-view-events.jsonl` 记录意图视图的 codec、frame/image 哈希、尺寸、覆盖、遗漏的动画帧数和 canonical 引用。provider 边界的 `harness_assembly.arc_observation_view` 对照 PNG 字节哈希与实际 `input_image` 数据；只有哈希匹配才标为 `effective_image_exposure`。文本模式核对完整视图体的哈希。provider 的真实 token 使用量仍以 provider 回执为准；JSON 字符估算包含图像 base64 传输字符，不表示视觉 token 数。

## 边界与后续验收

PNG 的颜色只是视觉投影；精确颜色编号、像素坐标和变化证据以 canonical frame、自动提供的完整网格及动作回执为准。当前图像仅覆盖最后一张 frame，较早 animation frames 在元数据中计数，不默认为无关证据。连续零像素变化提醒要求检查已提供的当前图像/空间图、已测区域和不同区域，再比较候选预测与有限实验终点。

本记录是实现说明，不是 ARC 表现结论。2026-10-02 观测修改未重新启动真实模型 ARC 运行，也未重新验收 Auto-Research → parsing/routing → task-local self-harness 全链路闭环。真实模型对照需核对最终 provider payload 中的 `input_image`、模型的空间理解与行动转向、上下文成本；全闭环声明还须满足项目 `AGENTS.md` 规定的 Self-Harness 全链路矩阵。

## 2026-10-02 完整帧修改验证

原生 Pi 诊断覆盖文本及图像两种模式：连续三个 provider 输入均有完整当前网格，图像模式各有一张完整 PNG；父工具表无 `arc_state`，无裁剪提示，整个无动作序列只读取一次 bridge `/state` 和 `/events`。两个参数化用例通过。

确定性 provider 的真实 ARC runner `action-alignment` 冒烟通过 11 项检查，覆盖委派动作、批量动作、后续父轮观测及父工具表移除 `arc_state`。记录在 `runs/arc-full-frame-action-alignment-20261002`。这些结果验证本次观测修改的接线；未重新验收全组件矩阵，也不证明真实模型的 token、延迟或游戏表现已改善。真实模型 ARC 进程保持停止。

`continuous-workers` 在真实 ARC runner、Pi 父循环及 child 进程上通过 26 项检查，覆盖阶段性交付、跨阶段证据、父侧创建/装配与工具语义输出、后续父轮及 RESET 边界。记录在 `runs/arc-full-frame-continuous-workers-20261002`；provider 仍为确定性替身。另有 2 项父工具表回归、5 项上下文投影测试通过。
