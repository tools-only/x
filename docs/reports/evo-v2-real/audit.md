# v2 独立开发侧审查

审查对象：`1935b112` 相对 `b85add88`。只读审查，未启动 provider；此开发审查不进入任务运行，也不是预设任务 reviewer。未发现新增任务子 Agent、宿主归因/采用、重构触发表或抬高预算。

1. v2 新增边界缺口：`demo/self_root.ts` 的 policy.request 仅校验正整数，没有注册 model.maxTokens 上界；超限修改可能先激活，随后被 provider hook 拒绝并退出。若没有发生这种修改，不将它解释成当前运行的失败原因。
2. v1 遗留：首次全稿交付已合并投递 before_session_end。交付审阅期间才创建的默认窗口可能错过该事件；同产物去重及完成后跳过结束事件可能使它保持 open。预先已有的窗口仍可正常到期。
3. v1 遗留：窗口可在缺 task_outcomes 时 delivered；adopt 的技术接口只要求 reason。采用日志必须与 Agent 比较原文、真实 task_outcome 和后续运行共同核对，不能单凭 adopted 标记认定真实指标比较成立。也不能让宿主替 Agent 解释指标。

判定：冻结实验可以继续；上述边界需列为限制。真实结果仍以原始日志为准。

## 最终补丁复核（a91b0a68）

上述第1项输出额度校验已移至反射前；预算许可拒绝也会先记录并持久化 absent/incomplete。出口传输 schema 最终按 op=exit 的 JSON Schema 条件约束，使用当前审阅钉住的 Agent schema，不按模式名限制普通决定。两条预算退出实际 Pi 测试和 Node 上界测试通过。

独立只读复核：Pi 的 convertTools → getJsonSchemaToolParameters 在本配置未启用 constrained sampling 时保留原 schema，不删除 allOf；脚本 provider Context 的 schema 断言已通过。补丁后真实 HTTP／模型遵循仍未验证，因为独立诊断的小预检已被远端断开。旧的第2、3项窗口／采用证据缺口仍保留在 ROUND-v2，不冒充已解决。
