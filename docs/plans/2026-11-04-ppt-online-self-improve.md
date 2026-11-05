# PPT 在线自我改进：补齐与底座审计

2026-11-04。状态：实现窄提示 affordance；本地渲染验证通过，真实模型采用与净收益待验证。

## 问题与命题

- 真实机会/观察：真实 provider 运行 `runs/ppt-qwen-self-improve-20261104-final` 成功交付 15 页。`harness/renders.jsonl` 与 session 显示直到全稿完成才 render；父调用 `look` 查看 1、2、4、15 页后直接交付，没有创建或语义使用 harness 组件。session 的 completion 请求 4 与 5 以 `length` 结束；此前一次 `save_program` 未执行，不能据此断言是采用循环的失败证据。用户报告此前无上限续跑同会话；中断请求用量未知。以上是轨迹观察。质量不确定性未识别或未能设计可辨别反馈是待测解释，非已证根因。
- 窄命题：当尚未完成的 HTML 草稿已有代表性页面时，提示明示 1–30 页可直接 render，可能减少 Agent 首次观察实际呈现并按证据试验的寻找成本；随后 Agent 可依据受众理解相关的不确定性，自主选择试验对象与方法，也可调整检查方法本身。若普通真实运行仍只在完成后 render，或早期 render 后没有改变后续决策/产物，这一行为命题不受支持。实现/fixture 通过不能证明命题。
- 减少的负担：识别完整交付流程是否必须结束后才能 render 的搜索与顾虑；复用既有 office/render/look、`env.render()` 与 agent 图像 refs。一个短常驻提示替换原来较长的“主动识别不确定性、如何循环”的指示，净 token 影响未计量。
- 合理不使用/推翻条件：任务很短、无实质性理解不确定性、部分结果不能代表全稿、观察成本超过潜在收益、预算/剩余时间不足、或证据无法区分方案时，不试验属合理；多次在可判别适用情境下没有早期观察或后续语义行动，反驳降低成本的主张。
- 范围/非目标：仅更改 PPT 基础提示及本记录。不改原任务/素材/受众，不增加阶段、角色、worker、manager、语义门禁、必保存组件或强制渲染，不改 runtime。真实模型任务留给用户之后统一检查，不启动付费运行。

## 设计与成本

- 选择：删除重复的主动循环指示，并在同一处说明可对部分 HTML 草稿直接 render；复用已存在的工具和证据交接，无新增接口/提示 token 总量意图为收缩，不新增 runtime 决策。父不需要先选 reviewer 或保存程序；模型仍自主决定是否观察、如何验证和何时停。
- 生命周期：Agent 决定是否存在影响受众理解的不确定点；可用当前草稿、brief/material 和实际图像作为证据，直接改作品或检查法并立即使用；成功取决于后续语义决策，不以保存或调用本身计算。无机会或不合比例时可不投入；负面/含糊证据可停止或撤回其候选改动。当前 render revision/source snapshot 已提供可恢复的候选源。
- 成本：没有增加模型管理轮、字段、组件维护义务或角色上下文。可能成本是早期 render 的渲染耗时/图像输入与少量新提示；当前日志未量化首次代表性观察的父子总成本。session 没有建立子 agent 或方法组件，仍可能是单父模型主路径；这不是必然要求加入 worker 的理由。
- 边界：原任务简报、事实、标签、单位、期间和引文仍为证据锚点；现有预算、deadline、revision 与交付新鲜度校验不变。部分草稿 render 可达范围已由 `ppt_demo_extension.ts` 和 `ppt_demo_artifact.py` 确认。

## 运行前实验协议与实际结果

- 本次实际实现评估只到功能/接线层，不运行真实 provider。真实自主采用试验应使用普通 PPT 任务、无强制首轮 render/角色/组件要求；记录适用机会及合理不使用，检查 render 图像具体揭示了什么、子 Agent 或父 Agent 后续如何使用其语义结果、后续决策/幻灯片是否因此改变，并审阅未行动、放弃与负收益样本。
- 主要变量为短提示中“partial draft 可 render + 自主验证/改法选择” affordance；比较器是同 provider/model/task 类型的既有提示运行或后续对照。单例只作探索，不证实效果。指标同时包括理解与事实准确性证据、可审阅的后续行动归因，以及父子总请求/输入输出/图像 tokens/渲染时间/管理往返。可接受结果包括合理不使用；若投入只增加成本、观察内容不影响下一决策、或格式更早渲染导致质量/正确性退化，则不支持净收益。中断请求用量未知须保留为未知。
- “语义使用”必须由观察所得的可核对结论及后续文字、版式、事实取舍、查证方案或明确停止决策之间的联系体现；读取/附图/运行/保存/调用次数/成功状态均不算。

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

## 2026-11-04 本次提示 affordance 与局部验证

- 改动：`demo/prompts/ppt_demo_system.md` 以短段落替换“actively identify uncertainties”及较长循环描述，说明部分 1–30 页 HTML 可以先 render；Agent 可对影响 audience understanding 的不确定点选择小检查，并可选择改作品、检查法、两者或不改。仍由 Agent 决定是否开始、何时开始、证据和停止；brief/material 是锚点，组件保存可选。无 runtime、schema、工具权限或角色变化。
- 测试：`tests/ppt_demo.test.ts` 新增 1 页、明显未达最终 15 页简报要求的 HTML 部分草稿测试。真实 Windows Edge HTML 渲染和 Microsoft PowerPoint 16 COM 导出成功，回执 `slides=1`，`results/renders/v001/slide-01.png` 实际存在；测试临时目录由测试打印。该测试提供给定输入的本地真实渲染功能证据。
- 总检查：`node --experimental-transform-types --test --test-concurrency=1 tests/ppt_demo.test.ts`，6/6 通过。既有测试的一些 Pi/provider 请求使用 stub/mock；与上面的实际 PowerPoint 渲染合起来也没有走 `src/autoresearch_pi/ppt_demo.py` 启动的真实 Pi parent loop 或真实 provider。未运行付费任务。
- 原轨迹的可核查语义使用：须记录可辨别的受众理解假设/疑问、实际看的页面证据、证据具体改变（或未改变）什么后续决定，以及由此产生的文本/结构/查证/停止变化；单纯 render/look、PNG 存在、子任务读取、组件写入/调用、tool status 成功均不满足。失败、中断、reasonable non-use、已试方法被放弃及负收益样本仍需保留；目标运行的中断请求用量未知。

| 证据层级 | 状态 | Provider / environment | 产物及结论边界 |
| --- | --- | --- | --- |
| 功能正确 | 通过（本地部分草稿渲染） | Windows Edge + Microsoft PowerPoint 16 COM；PPT extension，provider 未参与 | `tests/ppt_demo.test.ts`；证明 1 页候选可渲染并取图，不证明主 runner 全链路 |
| 全链路可达 | 未验证 | 测试中的 extension 是直接装配；部分 Pi/provider 行为使用 stub/mock | 未跑真实 `ppt_demo.py` → Pi parent → provider → task 的完整链路 |
| 自主采用 | 未验证 | 真实 Qwen 3.8-27B 运行是旧提示/旧代码样本 | `runs/ppt-qwen-self-improve-20261104-final` 只能描述旧行为，不能判断新提示采用 |
| 净收益 | 未验证 | 无匹配对照 | 无效果与父子总成本对照；更早 render 也可能增加成本或提供无用反馈 |

- 下一检查：用户后续统一检查真实模型普通任务中是否出现“有适用机会 → Agent 自选部分观察/反馈 → 可核对后续语义行动或合理不使用”的轨迹；若观察或成本没有影响后续决策，或质量/事实准确性退化，则不支持保留该 affordance 的收益主张。对该设计不设置首轮 render、固定 reviewer、组件创建或轮数目标。
- 延后事项：`docs/deferred-research-todos.md` 中 B/C 的父子反馈与总成本、D 的跨上下文认知连续性仍开放；它们关联图像证据如何进入后续语义决策及中断/续跑时保留什么，本次不扩展处理。
