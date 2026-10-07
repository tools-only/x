# 精简 ARC Agent 入口与按需操作说明

用户确认：流程规则尽量由代码承担，prompt 只保留 Agent 必须知道的核心内容。

采用短 task prompt、短常驻索引、按需只读 contract。把整本手册搬到 system
prompt 仍会重复支付上下文成本；自动研究、自动选择组件则会把语义判断交给
确定性代码，超出当前主 Agent 拥有决策权的模型。

ARC task prompt 保留目标、证据判断、能力入口、动作边界；常驻索引仅介绍
发现/使用入口。原任务中的具体推理建议移入可选 arc_reasoning reference。
Memory、assembly、review、assessment 的操作说明按 topic 获取；development
复用现有方法文档。新 task_harness(contract) 在 admission 之前只读返回文档，
不写组件、不读取 creator 以冒充主 Agent 准备、不启动研究、不改变 assembly。

现有代码已经承载以下流程，本次复用而不新增调度器：

- ARC extension/bridge：动作边界与预算、当前公共 frame。
- pi_task_harness_assembly：精确版本、依赖、CAS 校验及冲突回执。
- pi_harness_control/selectControlTarget：唯一目标绑定或返回待选择候选。
- task_harness/change：类型路由、部分成功回执、后续组装模板。
- periodic/level review helpers：根据动作和环境结果组织窗口。
- checkpoint、资源存储与 context lifecycle：持久化、投影及恢复引用。

ARC context 中的完整 development 手册改为短读取入口；creator catalog 保留
名字和读取调用，完整内容和版本 hash 由 read_method 按需交付。其他 benchmark
保持现有启动投影。运行中条件触发的待办及评测提示仍存在，后续应由实际
provider 输入遥测判断哪些还有重复成本，不把本次结果当成全 payload 优化。

验证：计数 task/index 字词；用真实 Pi、离线 provider 检查初始请求没有长文档、
按 topic 读取可达且不写业务状态、assembly contract 返回当前 revision；运行
相关诊断回归。所有检查只证明加载/路由和投影，不声称 ARC 闭环验收或真实
provider 解题收益。deferred-research-todos.md 的跨压缩认知连续性仍待验证。

## 本次结果

- 按空白分词计数，arc_decision_cycle.md：3097 → 250；self_harness_index.md：1041 → 100。
- ARC 首轮/能力跟进不再自动投影 1370 词的 capability_extraction_process.md。
- 短读取入口接入 context lifecycle 去重与 provider telemetry 的正文匹配。
- 106 项相关诊断通过：test_arc_agi_3_e2e.py 全部 83 项；新增按需读取/assembly
  检查 3 项；test_context_continuity.py 全部 12 项；唯一绑定、review、assessment、
  assembly 与提示引用的定向回归 8 项。初次新增检查发现跨语言 CRLF/LF 比较问题，
  改为按文件原始 UTF-8 内容比较后通过。git diff --check 通过。
- 未运行真实 provider 对照或 arc-harness-smoke；上述结果不构成 ARC 闭环或收益验收。

## 保真复查更新

用户随后要求确保功能与 Agent 能力不丢失。已恢复原任务/索引中的全部规则块到
按需入口，恢复 creator 用途描述，并在初始任务中保留开发完成条件和研究准备条件。
最终 task/index 分别为 286/128 词。修改前后真实 ARC runner smoke 均通过
16 场景、393 断言，五类组件和两类 length 续跑均覆盖，工具/action 序列一致。
SDK 环境与 provider 为替身；真实模型表现尚未比较。详见
[保真核查报告](../reports/2026-09-28-prompt-preservation.md)。
