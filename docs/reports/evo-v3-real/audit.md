# v3 独立开发复核

本文件是开发环节记录，不进入任务 Agent 上下文。依 intent-led-coding 的独立复核要求，由未写实现的开发 Agent 只读审查；不调用付费 provider、不改文件、不创建任务运行角色。

发现并已在真实实验前修复：

1. runner 在 state.complete 时先退出，可能吞掉最后一次 turn_end 激活后由 agent_end 排队的窗口。现在交付完成也须让已有队列回到同一 Agent；12 项 runner 测试包含相应续接。
2. renderer 预检后调用收费预检前未检查总截止时间。现在 dispatch 前核对，HTTP timeout 受实际剩余时间限制；pending 预检先持久化许可。
3. 旧接线测试仍要求 review result 无顶层 type。现在检查 review object/op 与 execute 原始 schema 分别成立。

其余已查边界未发现新增 host 归因或强制自改：入口 floor 有 FINAL G1a–d 明确依据；reasoning policy 可反射且不删任务事实；adopt 只核引用/来源，不替 Agent 决定输赢。复核仅只读；真实模型遵循与任务收益仍须本轮运行验证。
