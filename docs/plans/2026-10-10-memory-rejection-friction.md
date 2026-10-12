# Meta-harness 变更记录：撤销假设不因缺少结构化反证而拒绝整批更新

日期：2026-10-10（Asia/Shanghai）。状态：实现及功能诊断完成，保留。

## 问题与命题

- 真实材料：`runs/thin-sh-r2-ka59-20261010/pi-events.jsonl:409`。父模型撤销 `hyp.bar_removable`，同批清理三条旧事实、写入当前位置并改写策略；因为未附 `refutes` evidence，整批被拒绝，父模型随后继续行动。
- 窄命题：Agent 显式设置 `status=rejected` 时，即使没有结构化反证，runtime 仍原子保存合法批次；只报告“未记录反证”，不编造证据，不要求父模型再调用一次。
- 减负：移除一个语义硬门槛和由此产生的重试/状态失同步；无新增 worker、字段或行动门禁。已提交证据仍需格式合法、动作编号真实。
- 适用/推翻：无证据、只有 supports/inconclusive、已有 refutes 均允许显式撤销；畸形 evidence、未来动作、容量超限仍原子拒绝。真实失败调用仍不保存，或反证凭空出现，即推翻功能命题。
- 范围：thin memory 与相关诊断测试；不修改冻结版本或已停止实验，不把“继续行动”改成必须修复 memory 的门禁。

## 设计与成本

- 复用现有 status、证据列表、receipt 和假设渲染；将反证存在性从 errors 改为非阻塞记录提示。语义判断属于父 Agent，runtime 只描述记录是否存在。
- 生命周期：父 Agent 决定撤销/修订，runtime 保存、下轮装配并持久恢复；既有 dependent strategy 暂停及显式激活例外保持。无候选生成/研究调度转移。
- 首次获益：同一合法 memory 调用即保存；减少一个补证据决策。提示仅在缺反证的 rejected 记录出现，无全局常驻提示/schema 扩张。
- 保留权限、数据格式、动作编号、容量、原子性及环境边界；错误调用不部分提交。可通过回退代码撤下，游戏历史不可回退。

## 运行前实验协议

- 功能诊断：从真实拒绝事件提取参数和受影响的先前记录，加入确定性回归；独立覆盖无反证的依赖暂停、既有 scoped evidence、非法证据和未来动作原子拒绝。
- 接口诊断：现有 thin extension 测试与 scripted provider / mock ARC SDK smoke，不新增真实 provider 调用或官方环境动作。
- 预算：零付费模型 tokens；本地验证约十分钟，超时/失败停止并记录。原实验已按用户指令停止，不恢复。
- 判定：真实失败参数一次提交；清理、事实、hypothesis、策略、恢复和后轮视图匹配；真实 evidence 原样保存；非法输入仍整批拒绝。

## 实现与验证

- 改动：`demo/arc_thin_memory.ts` 移除拒绝状态必须有 refutes 的 errors 分支；同一 receipt 和后续假设视图描述缺失的反证，原始 evidence 不变。依赖暂停、显式重启例外、scope/编号校验及原子性不变。
- 真实回归材料：`tests/fixtures/arc_thin_memory_rejection_ka59.json` 保存原始调用参数及其涉及记录的先前状态；未保存模型推理、不复用 provider 请求。测试确认删除三条旧事实、写新事实、修改假设/策略及持久恢复均生效，既有显式激活例外保持，不把内容的正确性当作保存正确性。
- 红阶段：memory 18 项中 3 项按原始反证门槛失败；native extension 1 项也在同一门槛失败。修复后针对两文件 23/23 通过，追加 supports/inconclusive 和跨条目非法 evidence 的原子拒绝负例后，全部 thin Node 52/52 通过。
- 命令：`node --experimental-transform-types --test <rg --files tests -g arc_thin_*.test.ts 返回的八个文件>`；完整输出 [Node 日志](../../tmp/memory-rejection-node-tests.log)。Node 自身的 experimental-transform-types 警告不影响退出码 0。
- Python 统计回归：设置 `PYTHONPATH=src` 后运行 `D:/conda/python.exe -m pytest tests/test_arc_thin_lifecycle_stats.py -q --basetemp=tmp/memory-rejection-pytest`，4/4 通过；[日志](../../tmp/memory-rejection-pytest.log)。
- 离线 smoke：`D:/conda/python.exe -m autoresearch_pi.cli arc-thin-smoke --root runs/arc-thin-memory-rejection-smoke-20261010`（同样设置 `PYTHONPATH=src`），scripted provider、mock ARC SDK、真实 bridge/Pi/extension/WASI；[summary](../../runs/arc-thin-memory-rejection-smoke-20261010/summary.json) 全部检查通过。旧负例改为证据引用不存在的 action #999，继续验证整批不应用。该 smoke 是相关诊断，新的无反证撤销/后轮语义验证由 native extension 测试覆盖，不称完整 ARC 验收。
- `git diff --check` 对本次涉及文件通过；未改动冻结源。使用已有工作区，保留其他 chat 的既有改动。
- 协议偏离：首次 conda 启动因缺 `PYTHONPATH` 在导入 CLI 前失败；只设置本次命令环境后重跑，未发真实 provider 请求。没有新增付费 tokens 或官方环境动作。
- 停止对象：runner 262000/263548、bridge 257320/250708/263732/263752、Pi 263452/263444；复查存活数 0。强制停止时未完成 provider 请求的最终 usage、官方 scorecard 关闭结果未知，未伪造正常终态。

| 证据层级 | 状态 | Provider / environment | 产物及结论边界 |
| --- | --- | --- | --- |
| 功能正确 | 通过 | 本地 Node、Python；native extension + 本地 HTTP bridge stand-in | 真实失败参数回放、恢复、后轮视图及负例；52 Node + 4 pytest |
| 全链路可达 | 未验证 | 无新完整 ARC 验收 | thin 诊断不等同完整闭环 |
| 自主采用 | 未验证 | 未运行新真实 provider | 不宣称模型改进 |
| 净收益 | 未验证 | 无独立重复对照 | 不宣称解题或成本净收益 |

## 交付决定

保留：原始失败批次现在能够一次原子保存，缺反证仍可见，不增加模型手续或 runtime 语义裁决。完整链路、自主采用、解题质量及净成本收益未验证。关联 `docs/deferred-research-todos.md` 的语义反馈和连续性：本次仅消除更新摩擦，不提升 B/C/D 的质量证据状态。下一可证伪检查是在另行授权的普通真实运行中审计合法撤销是否一次保存，以及反证仍缺失时的后续行为；不恢复用户已关闭的实验。
