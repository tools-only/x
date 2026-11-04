# PPT 在线自我改进：补齐与底座审计

2026-11-04。状态：提示已修改；在线 prompt 接线未通过，停止重复尝试。代码审计不是自主行为证据。

## 问题与命题

用户观察：PPT 生产与 self-harness 沉淀脱节，缺少发现作品不足的反馈条件。目标是在同一任务中由 Agent 自主创造、使用、修改反馈循环；不预设 reviewer、博弈角色、固定阶段或人类运行中介入。
窄命题：明确构造反馈循环的意图，并让已保存 prompt 在下一次实际模型调用中生效，消除等待新会话的负担。新版未到达 provider 即推翻接线命题；到达也不证明自主采用或净收益。

## 设计与成本

复用现有 Pi context_with_system、Binder、五类组件和任务内工具。新增一段短常驻意图，不新增 worker、门禁、必填记录或强制循环。Agent 决定机会、投入、方法及停止；Runtime 负责版本装配；实际产物及使用结果供 Agent 判断是否继续。
本次修改限 PPT 提示和刷新钩子，保留已有未提交改动。任务目标、材料事实、预算及权限不由自创 loop 改写。prompt 刷新可能减少前缀缓存复用，成本未测。

## 运行前实验协议与实际结果

使用本地真实 Pi CLI + PPT extension + deterministic scripted provider；无付费网络请求。单样本最多四个 provider 回合、120 秒：创建 prompt → 下一轮核查 → 替换并核查旧版消失 → 停用并核查消失。不渲染、不交付 PPT，不声称完整生产验收。实际两次均在第二轮旧 prompt 检查失败后结束。
新增 tests/ppt_prompt_refresh_provider.ts 为诊断 provider。runs/ppt-online-refresh-20261104 与 runs/ppt-online-refresh-20261104-b 为证据，CLI 输出为 runs-ppt-refresh-output.jsonl 和 runs-ppt-refresh-output-b.jsonl。
第二次 prompt-bindings.jsonl 显示 context_with_system 已见 live_method v1，但 provider-requests.jsonl 中 system 内容未包含新版。原因尚未定位；不能把钩子执行当成实际送达。遵守两次同因受阻即停规则，不再追加机制或重试。
意图文案已在实际 provider 输入中检出。新版 prompt 生效未通过。替换/停用检查未执行到。

| 层级 | 状态 | 边界 |
| --- | --- | --- |
| 功能正确 | 部分；刷新失败 | 意图送达；新 prompt 未送达 |
| 全链路可达 | 未通过本次切片 | 真实 Pi + 脚本 provider；非完整 PPT |
| 自主采用 | 未验证 | 未运行普通真实模型 |
| 净收益 | 未验证 | 未作质量或父子成本对照 |

## 底座细查

证据来自 demo/ppt_demo_extension.ts、demo/arc_thin_native_runtime.ts、demo/arc_thin_binder.ts 和当前提示；只覆盖 ppt-agent-workflow 工作树，不能代表其他并行版本或已启动进程。

| 环节 | 已有能力 | 不足及影响 |
| --- | --- | --- |
| 自主构造流程 | Python 程序可组合 env.agent、env.render，父可直接编辑、查看、继续工作 | 能编排调用不等于有有效反馈；没有自主创造有用闭环的行为证据 |
| 真实产物观察 | office render 返回接触表，look 返回页面；历史渲染有不可变 revision 和图片 refs | env.render 本身只返回回执及路径；程序不会理解像素，需 Agent 主动把 refs 交给视觉模型。这是可用但有组合负担的路径，不应误称完全缺少视觉能力 |
| 独立视角 | run_agent 新上下文，按 refs/uses 加载文件；角色由父创作 | 所有活动 prompt 和制作基础指令一并进入子任务；父无法按角色选择排除某个 prompt。独立上下文不等于独立判断 |
| 子任务行动能力 | read/write/edit、只读 python、具名工具及可选图像生成 | 不能直接授予 office、run_agent、self_component；因此任意嵌套闭环或由子任务独立完成渲染—观察—改进不能直接表达。父编排仍可绕行 |
| 在线组件修改 | prompt/skill/memory/subagent、程序版本；文件变更能进入 Binder | 主 prompt 刷新实测失败；已运行子任务的角色、prompt、工具在启动时固定。保存成功不等于正在执行的流程热更新 |
| 流程运行语义 | host call 后重新执行程序并回放先前结果，避免重复外部调用 | 不是挂起并恢复 Python 栈；前缀应稳定，写入变化会触发 workflow changed earlier workspace writes。中途修改正在运行程序不会替换该调用的源代码 |
| 中断与连续性 | 文件、版本、结果和会话可保留；父可读回后再开始 | agent/render 回放结果及 appliedOps 在调用内存中，无持久流程游标。进程中断后自动续接同一 loop 未实现；可以接受人工/Agent 显式重启，不宜默认扩建调度器 |
| 比较与撤回 | 可渲染替代 source_path、查看历史版本；程序能指定旧版本 | 渲染版本不等于完整可恢复工作区快照；缺少统一的作品源文件+局部资产恢复操作。简单任务可自行复制候选文件 |
| 反馈可信度 | 原始材料、任务 brief、实际渲染可作为外部依据 | 没有自动保证新测试能发现错误；Agent 可能改得更漂亮却没有更准确。应允许其自己设计可核对的试验，不能用系统预设 reviewer 填空 |
| 自主停止与成本 | 父可停止或交付；provider 调用有预算及 deadline 检查 | host workflow 分支没有统一轮数上限，render 路径缺少 provider 同等预算检查。纯渲染循环的总体 deadline 行为未验证；这涉及运行约束而非判断质量 |
| 反馈回到主任务 | run_agent 返回回答/refs/改动，office 返回图像；程序结果交回父 | env.agent wrapper 只转交文本，生成图片附件不会原样返回程序调用父响应；仍可按文件 refs 再观察 |
| skill/memory 的使用 | skill 索引和读取、memory 文件与摘要 | 新内容可取回不证明影响决策；工作集主要在 before_agent_start 组装，持续工具循环中索引刷新与压缩后连续性仍需检验 |

## 交付决定与下一步

保留为未验收实验，未提交、未启动付费运行。下一步先定位 Pi context 结果到 provider payload 之间的 prompt 丢失，不能继续宣称底座在线生效已经补齐。
随后优先研究可由 Agent 选择的 prompt 适用范围，以及父编排视觉 refs 的真实端到端可达性；不是安装固定 reviewer。嵌套 agent、自恢复调度、全量快照属于按真实任务需求选择的扩展，不默认全做。
关联 deferred-research-todos 的父子沟通和认知连续性仍未完成；本次审计不改变其状态。

## 2026-11-04 新分支诊断

复现了 provider 输入停留旧版本。Binder 已绑定新版本；context_with_system 的替换与追加均未体现在本地 scripted provider 输入，原因仍未完成定位。实验性改为 before_provider_request 就地修改带 system 消息的 payload；实际 Pi CLI 与 scripted provider 在 runs/ppt-refresh-g 中完成创建、替换、停用四轮断言。此 transport 使用 Context payload，不能等同 OpenAI/Anthropic 原生 HTTP payload，当前实现对于其他 payload 格式未验证；不得声称通用刷新完成。意图文案在同一路径送达。自主采用及收益未验证。新分支未执行付费模型。

## 独立上下文与渲染截止时间（进行中）

run_agent 和 env.agent 新增可选 independent=true，由父选择是否将 PPT 基础指令与活动 prompt 注入新子会话；默认行为不变，角色和显式材料仍注入。独立上下文只是隔离信息，不保证评价正确。render 前检查现有任务截止时间，不能中断已经开始的 PowerPoint 操作。已运行 Node PPT 测试 2/2，通过实际 PowerPoint 导出但 provider 为 mock；未覆盖新选项及真实 provider。其余审计项未实施，四层仍未完整验证。

## 渲染证据与源码快照

成功渲染后保存完整 artifacts 源码及本地素材快照。office recover 将指定 revision 复制到不存在的 artifacts 子目录，不覆盖或删除当前文件；旧版本没有快照时明确失败。该恢复是候选副本，需由 Agent 选择如何使用，不自动回退环境。env.render 已返回 evidence 路径，可用 refs 将对应 PNG 交给 env.agent；独立上下文与路径组合不预设任何 reviewer 或流程。更新提示说明可用接口。测试以实际 PowerPoint 和 mock provider 为基础；真实模型自主构造循环、语义使用及净收益未验证。嵌套执行、中断自动恢复、在线运行中的工具热更及真实 API 的 prompt 刷新仍未完成。

最新 PPT 测试 2/2 通过：实际 PowerPoint 导出、恢复内容及拒绝覆盖、mock provider 检查独立角色收到 PNG 且不含父指令；未走真实 provider，未验证自主采用和收益。测试产物：C:/Users/qi/AppData/Local/Temp/ppt-native-ceaMqS。

## 后续修正

子任务可按声明选择 office 渲染并接收 contact sheet，不能交付；输出直接进入其下一轮。非隔离子任务每轮重新读取活动 prompt，隔离子任务仍不接收父 prompt。父请求刷新处理 completions 的 system/developer、responses 的 input 和 Anthropic system 文本块；format fixture 通过，实际 Pi + scripted provider 的创建、修订、停用四轮通过（runs/ppt-refresh-final）。这些检查不证明真实 provider 格式或语义采用。渲染进程超时限制在剩余 deadline 范围内。

PPT 测试实际 PowerPoint + mock provider 2/2 通过，子任务真实执行 office 并在下一模型输入接收图片，产物 C:/Users/qi/AppData/Local/Temp/ppt-native-Qh5ulP。该轮代码随后调整了 render timeout，需最终重新检查。模型自主采用和净收益未验证。
尚未实现子任务再委派、进程中断后的工作流自动续接、活动中的角色/工具热更新、强制验证反馈有效性；已有 host call 重放仍不是持久 Python 栈。此状态不能称所有不足已修正。

## 嵌套委派与活动角色更新

允许已获 run_agent 的子任务调用已保存角色；被调用角色的工具、读取材料、写入范围必须包含于调用者当前初始授权范围。测试覆盖子任务获得证据、结果返还与拒绝超出父权限的角色。运行中角色正文在下一模型请求刷新，已声明工具在每次调用时使用当前活动版本；角色撤销的工具不能再调用。角色新增工具及权限范围调整仍需重启该子任务，尚未实现动态能力重装。mock provider 定向测试通过，不代表真实模型自主采用或净收益。
进程中断后的 workflow 自动续接仍未实现，不将回放机制称作持久恢复。
