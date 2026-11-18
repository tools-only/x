# PPT Python session 工具创作

## 问题与命题

BofA PPT 实跑中，Agent 在验证 factcheck 时尝试从 notes 和绝对路径导入已发布组件，连续失败。恢复任务内 Python session 后，Agent 可跨调用试跑同一函数，用 workspace 相对路径读取同一输入，并直接转化为 Pi 工具。一次性计算可留在 session。

## 设计与成本

Agent 在普通工作回合编写、试跑并决定是否转化。Runtime 用现有导出器检查依赖、生成程序头，再由 PPT 反射事务提交版本并披露调用 schema。Agent 用正式调用结果决定保留或修订。工具独立执行，checkpoint 留在任务私有目录。审查回合的权限、退出和触发沿用现有逻辑。

## 运行前实验协议

在实际 Pi 和 PPT extension 上，用脚本 provider 运行两种 EVO 配置各一次，复用现有 RPC 超时。比较跨两次 Python 调用得到的试跑结果和下一请求中正式调用的结果。判定依据是同一 workspace 输入产生预期语义值，以及提供方请求能看到 session_ref。现有测试同时覆盖普通源码发布和工具执行失败。

## 实现与验证

入口是 PPT 的 python 和 reflect_component。前者开启现有 session，后者将 session_ref 解析为源码并走原事务。实际 Pi RPC 使用 offline-external-test 脚本 provider，运行 python -m pytest -xq tests/test_ppt_effect_intent_pi.py，两种 EVO 配置均通过。两轮 Python 共享函数并读到 probe-input-draft。导出后，后续 Pi 请求披露工具，正式调用返回 probe-input-native。功能和 PPT 接线已验证。自主采用和净收益未验证。

## 交付决定

保持 tool pass turn 用于自我审查。真实模型是否会在普通工作回合自行选择此路径，以及是否减少返工，留待同预算的 PPT 运行对照。
