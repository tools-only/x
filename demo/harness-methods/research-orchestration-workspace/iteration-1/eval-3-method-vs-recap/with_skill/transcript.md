# 执行记录

- 按任务要求完整读取 research-orchestration/SKILL.md；中断恢复后再次完整读取。
- 仅读取 evals/evals.json 中 id=3 的任务项，未读取其他评估输出或项目文档。
- 使用技能关于研究对象、调度、工作包、反馈和停止条件的指引，生成 outputs/decision.md。
- 决策设计一次性只读研究，未启动 child、调用游戏环境、创建持久组件或执行验证动作。
- 使用 apply_patch 写入指定决策、执行记录和计时说明文件。此记录只包含执行事实，不包含私有推理。
