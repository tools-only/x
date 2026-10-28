# Feedback #21：普通决策中的转换路径

日期：2026-10-29。状态：实现及本地接线验收完成，自主采用/净收益未验证。基线 ed5d0d49；分支 codex/self-harness-minimal-path。

## 问题与命题

依据指定 job 的 FEEDBACK21.md #2–#7：远程观察窗口短、没有发起转换、提示过软、保存入口泛、重复提示弱、没有保存后的反馈。本次不读取本地 ARC 轨迹或游戏源码。

窄命题：普通 Task 固定头的一条入口、默认 tool 的保存接口、每决策至多一次具名重复提示，以及保存版本的短调用事实反馈，可以让现成逻辑沿已有 Binder 路径当场保存并在后续请求调用。功能和接线可以本地证伪；自主采用和净收益不能由此推出。

减少寻找工具、选择五类语义、回查版本调用记录的负担。一次性调试、未稳定探索、无后续用途或预算不足可直接行动，无 skip/report。若真实运行完整送达仍不保存、保存后仍重写或总成本上升，入口/减负假设受反驳。

## 设计与成本

复用现有 context/headKey 缓存、self_component、promote_session_function、python(save)、Binder 和 component_runs.jsonl。相比新增专用工具，先给 self_component.kind 默认 tool，保留五类显式接口；内容和 run(state,args) 适配仍由 Agent 提交。相比自动包装 session 函数，此方案不推断依赖或捕获旧值。

固定入口每个普通头最多 320 ASCII 字符；baseline 和 native 指向各自真实工具。控制组、review、consolidation、daemon 不承诺该入口。--self-convert 只控制原有 note 投递。重复提示不选函数、不写合同、不保存；Agent 按任务判断是否保存。短反馈只列本 run Agent 保存的当前可调用版本，最多三项，版本变化或 retire 后旧反馈退出。

产物进入循环：入口进入普通固定头，替代寻找入口；重复事实在 Python 结果中进入同决策下一请求，替代漏掉的转换动作线索；反馈在下一普通头进入，替代查调用账。下一保存/版本调用/任务动作继续写现有记录，语义收益仍需审阅真实行为。没有新 worker、门禁、必填字段、报告或额外决策。新增 schema 必填项为零；减少一个必填 kind。提示与日志字符是常驻成本，模型 token/cache、父子总费用和延迟本次未测。

权限、预算、环境与版本边界保留。提取不执行不保存，Agent 明确提交 source 才保存；Binder 失败可修订或继续行动。退役只影响未来调用。

## 运行前实验协议

零付费 Windows/Node/WASI extension fixture，模拟 Pi API 和 mock bridge，无模型/child。运行有界 focused tests；必要时 scripted provider smoke（最多 600 秒）。主要比较现有行为与本补丁在同样测试输入下的入口、schema、结果和版本事实，不作任务得分比较。

验收：每个普通头一条 SELF，工具往返和 length/retry recovery 不改头；新无动作决策仍有入口；baseline 的 note 开关不影响入口。省略 kind 能保存并在下一请求以变化输入调用；五类保留。重复/改名 helper 提示一次，名称确实注册，readonly 无提示，无 host save。成功保存后出现零调用/成功/失败事实，失败保存不冒充新成功版本，修订/retire 不混用版本。直接行动不受阻。

否定条件：入口重复/超限/指向不存在工具；保存隐含执行候选选择；未保存也产生反馈；旧版本调用计入新版本；重复提示每工具结果刷屏。发现则先修对应边界，不扩建机制。

## 实现与验证

实现文件：`demo/arc_thin_extension.ts` 的默认 kind 与固定头；`demo/arc_thin_native_runtime.ts` 的每决策重复提示、事件更新的当前版本调用反馈；`demo/arc_thin_reuse.ts` 的 helper 改名归一；baseline prompt 的默认保存预期。反馈在保存/调用结果后即时可见，后续头读取内存中的计数；重启从既有日志恢复，不每头扫描日志。五类仍走原 Binder 路径。

最终命令与结果：

- `node --experimental-transform-types --test --test-concurrency=1 tests/arc_thin_native_runtime.test.ts tests/arc_thin_native_context.test.ts`：18/18 通过，包括缩略结果、readonly、重复提示去重、恢复版本反馈及既有 runtime/context 检查。
- `node --experimental-transform-types --test --test-concurrency=1 --test-name-pattern='only agent-authored conversion' tests/arc_thin_level_review.test.ts`：native、baseline、convert 三 profile 通过，覆盖固定头/recovery/note/默认 tool/保存与调用/失败/修订/退役。此前完整文件 9/9 通过。
- `PYTHONPATH=src python -m autoresearch_pi.cli arc-thin-smoke --self-baseline --self-convert --root <job>/smoke-convert-final`：真实 Pi/生产 bridge/Binder/WASI，mock ARC、scripted provider；2 decisions、2 actions、17/17 检查通过。
- 同命令改为 `--self-components`、输出 `<job>/smoke-five-kinds-final`：2 decisions、2 actions、20/20 检查通过。五类原能力和同决策调用/反馈仍可达。
- `git diff --check` 通过。

产物位置：[job VERIFY](C:/Users/qi/tmp/r04/self-harness-fix21-20261029/VERIFY.md)、[转换 smoke](C:/Users/qi/tmp/r04/self-harness-fix21-20261029/smoke-convert-final/summary.json)、[五类 smoke](C:/Users/qi/tmp/r04/self-harness-fix21-20261029/smoke-five-kinds-final/summary.json)。provider 为 `offline-arc-thin-smoke / scripted`，没有真实模型实验；只读本次新生成的 mock 产物。普通 native 仅 fixture 验证，未单独做真实 Pi smoke。#2 的真实 provider 长窗口验证不在本次补丁内。

自查修正：重复 cue 先插到原始输出前导致格式回归，现独立附在结果后且不被缩略；脚本型可调用工具原被反馈过滤排除，现纳入。宽回归 `arc_thin_components.test.ts` 有一条既有 restore 断言失败：预期 failed_defs 仅 Bad，实际还有被正确禁止写入的 Writer。该测试及唯一导入的组件实现均未修改；证据在 job `runtime-tests.txt`，本次不扩改它，不声称全仓测试全绿。

| 证据层 | 状态 | 环境与边界 |
| --- | --- | --- |
| 功能正确 | 本次 targeted checks 通过 | Windows Node/WASI fixtures；宽回归既有失败保留如上 |
| 全链路可达 | baseline scripted/mock 通过 | 实际 Pi/bridge/Binder/WASI 指定序列；native 仅 fixture |
| 自主采用 | 未验证 | 不启动付费或远程 ARC |
| 净收益 | 未验证 | 无真实对照，不能称零转换已解决 |

## 交付决定与后续

实现、验收与限制写入指定 job 的 CHANGES.md、VERIFY.md、RESULT.md。按授权保留本次实现并提交推送，保持当前分支。功能/接线通过不等于零转化的真实行为问题已经解决。

相关 backlog D（docs/deferred-research-todos.md）：固定头和 note 的送达不证明跨压缩后的语义连续性，仍开放；本补丁不新增上下文机制。下一可证伪检查须另获远程预算，在普通真实运行中核对 shown → Agent 保存 → 新输入调用 → 任务使用，并计入未使用、失败、父子总成本和延迟。
