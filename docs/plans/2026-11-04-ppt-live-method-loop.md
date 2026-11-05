# PPT 在线工作机制：设计与实现委托

## 用户授权优化并重启（2026-11-04）

沿用上节失败事实，新增 length continuation 的具体恢复信息，替代只有 PPT_RESUME 的空标记：明确不完整调用没有执行、以真实存盘/回执为准、下一步缩小写入而非重写全稿。扩展识别带说明的恢复前缀；不自动重试 terminated、不增 provider token 上限、不引入固定任务循环。短指令仅截断后产生，旨在减少此前 6 次 length 的重复工作，实际收益待测。基础提示补明失败保存不改变旧版、数值出现不能证实语义，仍由 Agent 设计校准试验，不预装检查器。

本次重启已获用户授权。新目录 runs/ppt-qwen-high-feedback-restart-20261104，AZ/qwen3.8-27b/high，同一 JPMorgan 15 页任务、全新会话、沿用无总费用/运行期限上限。该运行是探索样本；相对前次同时包含发布失败送达、schema、恢复说明与方法校准提示变化，不能作单因素因果对照。观察真实发布/调用/反馈/修订/后续再用及实际作品变化；自述成功、仅作品修改和组件计数不算能力提升。保留截断、拒绝、未知费用与负收益，不自动启动第二次付费运行。运行结束后分别报告功能、接线、自主闭环和质量/总成本，未发生明确记失败。

启动前实际 Pi scripted lifecycle 通过，Python 编译及 diff 检查通过；既有失败事实路由已有上一轮定向回归证据。本轮 length 恢复行为尚未获真实 provider 验证，须检查新运行实际输入。

## Qwen high 失败诊断与修复（2026-11-04）

补充结果：新增失败日志/下一 provider payload 的失败事实/同名成功后清除断言，目标测试 1/1 通过（55.16 秒）；真实 PowerPoint 产物 C:/Users/qi/AppData/Local/Temp/ppt-native-bMJXeS。git diff --check 通过。

真实样本 `runs/ppt-qwen-high-feedback-20261104`，AZ/qwen3.8-27b/high，用户授权单次无总费用/运行期限。终态 complete=false/runtime_error/terminated，14 次请求，6 次 length（各报告 output=12000），没有 render/deliver。最终请求 usage 未知，保守账本 16.522 USD 包含未知请求预留，不是实际账单。terminated 的底层来源未知，不能归为模型能力或宣称已修复网络；本轮不自动重试付费任务。

生命周期：Agent 主动提出 fact-check loop 并提交 factcheck_deck，说明出现方法构造尝试。description 过长导致 saveProgram 拒绝，没有发布或装配，更没有 run_program。随后文本说 Program saved，与实际 toolResult 矛盾。后续作品文件分段写入只是输出截断后的操作调整，没有检查法的执行、反馈、修订或再次验证。没有自身能力提高或交付质量提高的证据；尚未交付也限制了本样本对最终质量的判断。早前 low 样本为全稿后 render/look/自评；其中 rerun 有一次作品修改，均不等于方法闭环。

候选方法源码存在未验证缺陷：mat_chars 删除所有非数字/点/百分号字符再做子串查找，可跨原始数字边界命中；数值出现不能保证单位、指标、期间、符号和会计限定相符。正则切分嵌套 div 不可靠；固定 15 页仅适用于该任务。代码中无问题报告不代表事实准确，重复页脚检测也未完整实现。没有执行证据，以上为静态分析，不能声称它实际误报/漏报了某一页。创建方法与校准方法之间仍未到达。

窄修复：PPT save_program schema 公开现有 description 单行/1–120 长度及 name 格式约束，避免隐藏约束到执行才暴露。统一工具 wrapper 记录抛出的错误（此前因先 await 后 log 漏记失败），错误仍抛回 Pi，不自动当成功。最近一次发布失败的 name/error 以有界事实进入下一实际 provider system；同名发布成功或退休成功后清除，不阻断制作、不自动重试、不创建 reviewer。只保留最近失败，不是完整未解决列表；模型仍可放弃该方法。catch 用于记录真实工具错误后原样 rethrow，非吞错。

生命周期/成本：状态随既有 ppt-loop 保存并在后续请求读取；替代反复查工具日志的机械工作；下一真实保存结果可消除错误状态。失败时增加不足 400 字符错误加短解释，每次请求持续占用，后续成功即退出；语义误判是否改善仍未验证。没有新增调用或管理轮。程序发布不会自动运行；修复不能证明自主闭环成立。

本轮检查：PPT 6/6 与实际 Pi scripted lifecycle 1/1（11.45 秒）通过；新增失败日志/下一 provider payload 出现失败事实/同名成功后清除的断言另跑目标测试。脚本接线不能证明真实模型读懂错误或提升质量。功能正确与接线分别记录，真实自主采用、任务质量收益和父子净成本仍待授权实验。B/C/D 的语义反馈和跨上下文连续性仍开放。

## 后续修订：检查方法的可判别性（2026-11-04）

本轮验证结果：Node PPT 测试 6/6 通过，包括 source_path 发布后执行、版本历史、参数互斥、越界拒绝与实际 Edge/PowerPoint 渲染（产物 `C:/Users/qi/AppData/Local/Temp/ppt-native-dhs8ow`）。实际 Pi scripted provider 接线 1/1 通过，10.46 秒。首次脚本断言依赖已替换的旧提示原文而失败，更新目标指令断言后通过；没有放宽方法创建/调用/反馈/修订/退休的序列断言。git diff --check 通过。功能正确与局部接线通过；真实采用及净收益未验证，未启动新的付费运行。

用户拒绝 live-method 真实运行的自进化及作品质量结果。本轮范围为优化实现，不自动扩大为新的无上限付费运行。

实证：`runs/ppt-qwen-live-method-20261104` 仅 render v1，查看 8 页后交付。session 中 write 和 save_program 各有一次输出长度截断而未执行；不能将 attempted save 计作发布。自评 excellent 未附检查方法能区分好坏的证据。开发侧检查 contact sheet/source：第 12 页 Corporate 净亏损与第 15 页“All segments profitable”的概括存在未解释的范围差异，非专业读者容易误解；多个正文样式为 12–13px，页面仍大量留白。这里是具体待检质量问题，不是全稿质量评分或预置运行时规则。

此前接线本已存在，退休入口未解决发现方法失效的问题。此次主要行为假设改为：Agent 需要主动检验其反馈是否可判别，并将发现的漏检用于修订方法及后续作品。删除“what quality means”交由 Agent 自定及“no loop required”的表述；用 brief/audience 锚定质量，把在线改进作为任务目标。只规定目标与证据要求，实验、角色、顺序、停止均由 Agent 决定；不预装 reviewer 或生成固定缺陷，不设置交付门禁。该行为变化仍然是提示干预，不能称为已经实现能力提升。

伴随的独立可用性修复：save_program 接受 body/source_path 二选一。Agent 可以分段写草稿，再显式发布；同一 WASI 校验、版本及发布权限仍生效，发布不会自动运行。它减少长代码重新生成的输出负担，但不能保证解决所有截断，更不直接产生自进化。效果研究必须把这项修复与提示因素区分，不能归因给单一改变。

生命周期：方法由 Agent 创作，经已有 active prompt 或显式 program 调用影响下一实际工作；原始工具结果进入后续父请求；Agent 判断方法是否漏检、据证据修改或停用。实验材料不得污染原始素材或最终交付。拒绝、放弃和无增益应保留，不能以增加检查次数作收益。没有新增回执、常驻台账、worker 或管理轮；提示 token 成本尚未测量。

验收协议：沿用实际 Pi scripted provider 接线测试，以及真实 Edge/PowerPoint 的 PPT 定向测试；新增 source_path 发布后真实运行及互斥参数、越界路径拒绝检查。功能与接线结果在执行后补记。真实采用和净收益未验证。下一真实运行需观察 Agent 自创的检查曾遗漏/误报什么、新版如何改变后续判断、作品有什么可核对改善；只保存方法或赞美作品仍判失败。开发发现不作为运行中的答案注入。旧失败案例为探索基线，因任务阶段和随机性不同不能证明因果收益。净收益还需要独立对照，计入父子全部成本和质量退化。

状态：实现及局部接线验收完成（2026-11-04）；真实模型自主采用与净收益未验证。

## 真实失败与可证伪命题

普通 Qwen 运行 `runs/ppt-qwen-self-improve-20261104-rerun` 完成全稿后两次渲染，观察后补充第 5 页内容；没有观察到 Agent 创造并修订工作方法。前一运行见 `runs/ppt-qwen-self-improve-20261104-final`。这些轨迹支持“作品反馈发生、方法反馈未发生”，不证明模型完全没有方法层面的思考，也不证明具体根因。

主要假设：现有 harness 更像可选存储，Agent 创造的方法与下一次实际工作、下一次反馈没有稳定连接。把它作为在线执行中可见、可修改的工作机制，并自动交还该机制执行后的原始结果，可降低连接负担。只增加倡议或组件目录不足以检验此命题。

窄命题：Agent 自己选择的方法，经现有组件机制绑定后，真实进入下一 provider 输入/执行；执行结果无需额外查询即可返回父 Agent，父可修改或停用该方法，下一实际请求使用新版或停止使用。自主识别方法缺陷和任务收益仍需另行真实运行证明。

## 设计：可修改的方法，机械连接，语义由 Agent 决定

1. **工作机制就是现有可执行/生效组件。** 优先复用 active prompt 表达当前组织方法，program 表达可执行流程，skill/role 表达按需方法；不要新造 loop DSL、管理 Agent 或单独规划文件。组件只存档不算在线方法；实现必须指出每种实际支持的载体如何改变下一步工作。首版聚焦 active prompt 与它显式调用的 program，不全面扩展组件系统。
2. **明确在线责任，保留自主设计。** 基础指令简短说明：在完成作品过程中构造并按实际结果修订自己的工作机制；当问题来自生成、取证或判断方法时，可改机制并在后续实际工作试用；机制也可修改自己如何发现问题、提出改进及验证改进。具体时机、证据、角色、流程、实现形式及停止由 Agent 决定。没有“必须先保存组件才能制作/交付”的门禁，也不要求每次反馈都修改方法。
3. **装配直接作用于下一请求。** 复用 self_component/save_program 与 Binder 版本。确认父连续工具轮中 prompt 实际刷新、program 调用采用当前版本；不要只检查 before_agent_start 或内存。修改不热换已经执行中的 Python 调用；旧调用保持其绑定版本，后续新调用才用新版本。执行失败原样返回，不自动换策略。
4. **把现有反馈送回工作位置。** 先审计 office/run_program/run_agent 当前回执及 provider 输入，已有结果直接利用。只对真实缺失的转移增加小型、去重、有界的事实回执：组件路径/绑定版本、调用成败、结果或结果引用、关联渲染版本。事实回执随现有工具结果或下一模型请求进入父上下文，无须 Agent 另做台账查询；不新增独立 review 回合。不要从“之后调用了工具”推断“这个 prompt 导致此行动”；关联只记录可证明的绑定和调用来源。图像仍用现有图片通路，不用文字摘要冒充视觉反馈。
5. **允许修订和退出。** 确认现有 prompt/program 的修订、停用、恢复入口真实可用；仅修补缺失部分。下一请求不保留已停用方法的指令或陈旧回执。执行历史留存；退休仅停止未来使用，不撤销作品变化。反馈不判定方法优劣，不自动发布、修订或强制再次调用。

抽象关系是“Agent 创造的方法参与工作 → 工作产生证据 → Agent 可改变方法 → 后续工作试用变更”。这是实现必须支持的关系，不是运行时预设的工具调用顺序。Agent 可以用单父、子 Agent、程序或其组合自行创造 loop，不预装 reviewer、评分器、对抗角色或固定迭代轮数。

## 取舍、负担与生命周期

- 相比继续添加工具，复用现有接口；相比要求写计划与反思报告，直接把活动方法和真实工具结果连接到下一次工作。禁止要求每轮填写假设、评分或收益字段。
- Agent 负责发现机会、选择方法、语义判断、修订/停用；runtime 仅负责版本装配、执行、反馈路由与权限/预算/环境完整性。反馈判别标准可以由 Agent 修订，但事实、原始材料和实际渲染不随其自评改变。
- 增加成本应限制为短提示及必要事实差量，不建立第二份全量历史。实现记录提示字符差、额外 provider 请求/管理轮、回执大小；父子真实 token 和净收益未测写未知。
- 方法不适用、证据不足、执行失败、剩余任务不足以摊销或成本过高时，可直接制作、修作品、放弃候选或交付。不得用强制创建、调用次数、组件数量证明提升。
- 本次不做持久 Python 栈、通用调度平台、ARC 路径重构或固定质量分析。跨压缩语义连续性、父子净成本对应 deferred-research-todos B/C/D，仍开放；本次只验证直接后续轮次的实际送达和使用接线。

## 实现验收与有界评估

开发先读 AGENTS.md、docs/development-workflow.md 及现有代码，保留工作树已有改动。在本记录追加结果，避免覆盖历史记录。允许按代码审计简化实现；若所有路由已有，不复制机制，但须用真实请求证据说明本次主要变量到底是什么，不把提示修改包装成架构闭环。

使用实际 Pi parent + extension + 本地 scripted provider，禁止联网付费。单例最多 8 个 provider 请求/180 秒，失败后先诊断再调整，不重复盲跑。脚本仅用于接线，不计自主采用：

- 创建 Agent-authored 方法 v1，核对它进入下一真实 provider payload；执行它产生当前作品或检查结果，而非仅列目录。
- 将执行结果返回父下一轮；脚本指定修订为 v2，核对后续新调用/请求用 v2，v1 历史版本仍可识别。例中可让 v1 检查遗漏一项材料，v2 扩展检查；不得声称脚本设计的改进是模型发明。
- 停用方法后核对后续 provider payload 不再注入；无活动方法仍可正常制作/交付，不能因未“自进化”阻断。
- 失败程序、陈旧渲染或缺失证据原样失败/保留未知，不自动写成成功或改进；既有权限和原始材料保护不退化。若触及共享 runtime，补跑相应定向回归。
- 若修改 active prompt，仅凭 payload 送达可证明接线，不能证明语义使用。程序调用成功也不证明质量收益。

真实验证方案留待用户启动：相同 Qwen/provider/thinking/任务，普通运行，无指定必须创建组件或固定 loop；主要变量为本次在线方法连接。观察方法缺陷识别 → 方法变更 → 后续实际使用 → 后续结果对保留/修订/放弃的影响。只有作品变更、只保存方法、方法未参与后续工作，或反馈不影响任何决策，均不支持自主闭环主张。一次完整轨迹只证明存在性，不能证明净收益或递归能力不断增强；净收益需后续独立对照并同时审阅任务质量和父子总成本。

## 交付要求

GPT-6 Luna high 完成窄实现、必要定向检查和上述实际 Pi 接线验证；记录修改文件、命令、证据路径、失败及限制。功能正确/全链路可达/自主采用/净收益分别报告。不得启动新的付费 Qwen 运行，不自动提交或推送。当前设计交付时四层均未因本设计新增验证。

## 2026-11-04 实现与实际 Pi 接线结果

### 审计结论与改动

- 真实 Qwen 旧运行和 ppt-qwen-self-improve-20261104-rerun 支持“作品观察/修订出现，但未观察到工作方法创建和试用”。这是轨迹观察，不证明模型内部没有方法层思考。当前入口审计发现：active prompt 已在每次实际 provider 请求前重新装配；save_program 经 Binder 保存当前版本并在未来由 run_program 执行；run_program 原样把 WASI 结果作为当前 tool result 返回，因此后续父请求无需另查账。两项主要在线连接已经存在，未复制成 DSL、hook 或新管理回合。
- 实际缺口：prompt 可用 active:false 停用，但 named program 没有 Agent-facing 的退休入口；继续不调用虽可停止采用，方法仍留在活动目录。新增 retire_program(name, expected_version)：校验当前版本，将源移入 tools_off/，让 Binder 在边界扫描中退休原组件并重建活动绑定；源及历史留存，版本不符时拒绝操作。
- 将 PPT 基础提示更新为方法 affordance：Agent 可把 task-local 工作方法写成 active prompt/program，在后续请求使用；遇到生成、检查或判断方法问题，可修改方法及其问题发现/检查方法，再用后续结果判断是否保留、修订或退休。具体选择仍由 Agent 决定，不强制创作、调用、交付门禁或固定顺序。相对上轮已修改提示段从 528 增至 633 字符（+105）；provider token/cache 成本未测。没有新增父子 worker、管理轮或运行时语义回执。
- 原有 office 和方法结果直接 tool-result 路径足够；不把图像摘要改成事实，也不添加结果 ledger。现有 SELF FEEDBACK 回执会提示 call 成功/失败及“收益未测”，其调用数不计语义收益。

### 有界脚本验收

- 命令：$env:PYTHONPATH='src'; python -m pytest tests/test_ppt_live_method_pi.py -q。实际启动本工作树内 Pi CLI、PPT extension、NativeRuntime / Binder / WASI 和 tests/ppt_live_method_provider.ts 本地 scripted provider；provider 未联网。通过，单会话 8 个请求、约 10.7 秒；无 child agent；provider 费用/token 是脚本的 1+1 固定假 usage，不能作为模型成本测量。
- 顺序证据：请求 0 创建 prompt v1；请求 1 收到含 v1 的 provider Context 并保存程序 v1；请求 2 调用 v1；请求 3 读取其“Revenue present=True”结果后修订 v2；请求 4 用当前 v2 扩展为同时检查 Revenue 和 Net income；请求 5 再调用 v1 历史版本并得到 v1 输出；请求 6 退休当前 program 且停用 prompt；请求 7 的 system prompt 不含 v1 方法，父会话以普通文本正常结束。provider 断言每一步在先前结果到达后才发下一项操作；这是脚本规定的顺序，不是模型自主发现或改进。
- 实际证据目录：C:/Users/qi/AppData/Local/Temp/pytest-of-qi/pytest-3389/test_agent_authored_method_run0/ppt-live-method/，含 provider-checks.jsonl（8/8）、harness/provider-requests.jsonl（8 requests）、harness/tools.jsonl（实际的保存、v1/v2/历史调用和退休回执）、harness/component_runs.jsonl（执行版本与结果）、.harness/components.jsonl（v1/v2 及 retired 事件）、workspace/tools_off/live_check.py（保留的退休源码）及 workspace/prompts/live_method.md（inactive）。程序结果确实出现在紧接的 provider Context：v1/v2/历史结果分别约 203/223/211 字符，回执还含既有“task benefit unmeasured”说明。
- 首次探针结果保留：第一次 pytest 启动实际 Pi 后，scripted transport 的 context.systemPrompt 是空字符串，provider 断言失败于请求 1；当时 Pi 扩展已记录 provider payload，但 fixture 没检查 Context 的 system-role messages。按 Pi Context 形态改为优先读 systemPrompt、否则检视 system-role messages 后，在同一 8 请求/180 秒边界重新运行并通过。首轮没有创建或调用组件，不作为成功样本。
- 定向回归：node --experimental-transform-types --test --test-concurrency=1 tests/ppt_demo.test.ts，6/6 通过。使用 Windows Edge + PowerPoint 的实际部分草稿渲染、既有 PPT extension 测试；provider 行为由 stub/mock。新增断言覆盖 retire_program 工具可见、旧版本号拒绝退休且当前 presentation 不受影响。git diff --check 通过。
- 未运行 src/autoresearch_pi/ppt_demo.py 的真实任务 runner，也未用真实 provider。本 Pi 测试直接以 Pi CLI + 真实 PPT extension 建立请求链，证明该局部父请求/工具/Binder/WASI/后续父请求可达，不证明 production 启动配置的全部环境或 provider 兼容性。

### 证据状态与边界

| 验收层 | 状态 | Provider / environment | 能说明什么 |
| --- | --- | --- | --- |
| 功能正确 | 通过 | 本地 Pi CLI、真实 PPT extension/NativeRuntime/Binder/WASI + scripted provider；另有 Windows Edge/PowerPoint 回归 | 保存/绑定、实际执行、结果回返、v2 生效、历史 v1 可调、版本保护和退休路径按该情境工作 |
| 全链路可达 | 局部通过 | 实际 Pi parent + extension + provider request hook + program runner + WASI + 下一父请求；非付费 provider | 设计要求的局部在线方法生命周期已经连通；PPT Python 启动包装和生产 provider 未覆盖 |
| 自主采用 | 未验证 | 新版提示尚无真实模型普通任务样本 | provider 按脚本创建、修改、调用，不能说 Agent 自主识别、发明或采纳 |
| 净收益 | 未验证 | 无真实模型匹配对照、无子任务样本 | 程序检查替代了哪些重复工作、是否改善作品/受众理解、父子总成本与延迟均未知 |

真实结果后续语义使用的证据标准：方法的输出必须先到达父请求；父随后应以可核对的事实改变作品文字/组织、取证或判断方法，或根据阴性/不确定结果明确维持现状/停止。只见 prompt、调用 run_program、ok=true、版本数或自述“有帮助”不算。自主实验保留无机会/合理不使用、运行失败、被丢弃的方法、陈旧结果及负收益；独立对照再报告作品质量与父子总请求/输入输出/图像成本/运行时间和管理往返。

本次没有观察到生产 runner 路径、真实模型自主 adoption 或因果净收益。下一可证伪检查仍是用户授权的真实普通 Qwen PPT 任务；不要求创建组件或首轮 render。DEFERRED B/C/D（父子语义反馈、父子净成本、跨上下文认知连续性）仍开放。

## 2026-11-05：一次调用的独立探索批次

### 失败/机会与窄命题

前述 Qwen 普通运行在作品完成和复渲后补过作品内容，但没有观察到 Agent 自建、跨候选探索并迭代自身工作方法。已有 `run_agent` 要先有具名 role，逐个调用并承受 role/frontmatter、工具授权和往返管理；本次审计确认它复用 `NativeRuntime.consult`，但并不适合无需持久角色的短候选。该观察不说明运行中 Agent 完全没有探索，也未测量本次新增调用能否改善作品。

窄命题：当 Agent 能明确写出若干候选指令及所需材料时，一个有界的父级 `explore` 调用会免去先建持久 role 和逐候选发起多个父级工具调用的手续，并把每项原始回答或失败直接交还同一父轮；Agent 仍自行比较、采纳、修改方法或放弃。若真实任务中没有适用机会、候选答复重复/不足以影响决定、Agent 未后续使用结果，或调用成本超过其节省/收益，则不支持命题。

本设计不预设 generation-review、角色轴、遗传算法、评价器、差异方向、赢家或调用时机；一次模型采样既不证明候选多样，也不构成证据独立性。Agent 可用自身保存的 prompt、skill 或 program 写探索候选/选择方法，并在结果反馈后改它；服务本身没有这类内建方法或自动发布。

### 设计、边界与成本

- 在 `NativeRuntime` 复用 Pi 当前 `ctx.model`、PPT `modelResult` 预算/usage 路由及 provider 日志；不另建模型、环境或 broker。每候选是新的一次无工具上下文，只包含短只读系统身份、Agent 的 instruction 和其显式 refs；不继承父消息、active prompt 或相邻候选。候选须自行给齐上下文，父可显式把自己的方法组件或结果作为 ref。
- PPT 暴露 `explore({candidates:[{instruction, refs?}]})`：每次 1–4 项，每项至多 8 refs；按顺序运行，以控制单次调用的并行冲突，延迟因此相加。候选使用任务活跃模型和配置的 `PPT_DEMO_THINKING`（本次真实任务配置 high），受相同 request reserve/cap 约束，每候选一次 provider 请求，不重试。服务不提供 read/write/office/其他工具，因此结果只能来自 instruction 与 refs。
- 每一项在父工具结果中保留序号、指令、refs、原答复与 answer_ref，或 error；空答、length、aborted、provider error 均是失败而非候选成功。结果按 item 写入 `explore_runs.jsonl`，模型请求和 usage 用 provider request id 关联；失败的未知 usage 保留已预留费用。服务不综合结论、不评分、不选优、不改共享文件、不发布组件。父工具结果直接进入 Pi 下一轮输入；方法后续是否保存、使用和修改由 Agent 自行决定。
- 相比建角色/逐项调用，预期减少 Agent 的准备和父层管理步骤；新增每候选一次同模型请求、相加的串行延迟及有界 answer refs。候选 token、延迟的真实 provider 分布和父子净成本未知。单次 tool invocation 上限是 4 个候选；Pi 若并行接受多个 `explore` 工具调用，单次 schema 不形成全轮总量上限，实际请求仍受共享预算 reserve/cap 限制。此次不加 scheduler 或全局角色数/探索轮门禁。
- 来源边界：基础提示向 Agent 告知服务存在并由 Agent 自选调用；候选方法可以成为普通 prompt/skill/program，后续按既有工作路径生效。`explore` 是父级 Pi tool，当前没有暴露给 `env.agent`/program 子调用；子程序是否需要该能力是未决范围，不以当前可达性作泛化声明。未提供 refs 的环境材料不可见；这会导致合理无结果，而不自动扩大读取范围。
- 输出是一次调用产生的运行材料，进入其紧邻父轮并在那里被判断/使用；它不常驻。父如认为一种探索方法可复用，可自行创建普通组件，让后续 provider 请求按 Binder 生命周期收到它；实际后续使用结果再反馈给父，父决定修订/退休。只生成探索回答但没有下一步使用/语义反馈时，该探索结果在父轮后即退出，不形成额外账本义务。该路径与 deferred B/C 的父子研究模式、证据回传和总成本，以及 D 的跨上下文保留仍有关联；未关闭任何待办。

### 有界接线检查

命令：`$env:PYTHONPATH='src'; python -m pytest tests/test_ppt_explore_pi.py -q`，通过 1/1（约 1 秒）。本地脚本启动实际 Pi CLI + PPT extension + `NativeRuntime`，共 4 个 scripted provider request：父请求调用一次含两项的 batch；第一候选收到仅含自身 instruction 和显式 material ref 的新 Context 并返回 `CANDIDATE_ONE_RAW`；第二候选以 provider error 失败；下一父请求同时收到第一项原文与第二项失败并正常收尾。usage/request 对应关系为父 1、候选 2 和 3、父 4；候选 request ID 与 `explore_runs.jsonl` 一致，子 usage `kind=explore`。答复原文单独有 `results/` ref。workspace 的 tools/agents 由 Pi 初始化为空目录，未创建组件或候选 role。Scripted provider 没有真实网络或费用；它只验证功能与这段实际 Pi 工具接线，不验证真实模型选择/独立性/语义利用。

定向附加检查 `node --experimental-transform-types --test --test-concurrency=1 tests/arc_thin_native_runtime.test.ts`：15/16 通过；`USE-CHANNEL` 一例失败（断言实际 callable count `3`、期望 `1`，位置 `tests/arc_thin_native_runtime.test.ts:64`）。该断言未涉及新方法，但本轮没有运行基线证明其原先也失败，因此状态记作未判定，不归因或宣称无关。新 PPT explore 接线自身 pytest 复跑通过。未完成的 PPT `ppt_demo.test.ts`/真实 PowerPoint 回归没有由此轮新功能触及；真实 provider 行为、agent 自主采用和净收益也都未验证。

| 验收层 | 状态 | Provider / environment | 产物及结论边界 |
| --- | --- | --- | --- |
| 功能正确 | 局部通过 | 本地 Pi CLI / PPT extension / NativeRuntime + scripted provider | 成功回答、失败留存、精确请求号、refs 限制 schema 与直接父轮回传按测试情境工作；独立 runtime 套件另有 1 个未判定失败 |
| 全链路可达 | 局部通过 | 实际 Pi 父轮、PPT tool wrapper、NativeRuntime child stream、下一父轮 | 覆盖本地 scripted 父-child-父链路；真实 provider、runner 与 `env.agent` 程序内调用不在范围 |
| 自主采用 | 未验证 | 无真实模型证据 | 脚本指定何时调用及候选指令，不能证明真实模型会识别机会、形成或选择候选、用结果改变后续任务 |
| 净收益 | 未验证 | 无对照 | 真实候选差异/质量、减少的父管理动作、请求 token/费用与串行延迟、作品效果未知 |

### 真实检查与决策

接下来已准备一项用户授权的真实 high-thinking Qwen PPT 普通任务：`runs/ppt-qwen-meta-explore-20261105`，协议在其 `evaluation/meta-protocol.md`。父 Agent 启动/观察；本实现未向该 run 写文件或发起 provider 请求。重点读日志看 Agent 是否自发选择 `explore`，候选是否体现它对工作方法或产物的真实问题，失败/冗余是否保留，父是否根据原结果改了普通方法组件并在后续真实工作使用，结果如何改变作品或停止决定；未调用也记录适用机会与理由。不得以候选数、创建/调用次数、单次答复或自评替代语义收益。父子全部 usage、费用 reserve、总延迟和管理动作纳入成本；真实任务单例仅为自主采用/接线存在性样本，不足以证明净收益，后者仍需相近预算匹配对照。

实现/局部接线保持实验状态。该 scripted 样本支持功能和局部可达，不支持真实模型采用或收益；后续真实运行按证据补结果，不改变本记录的先验门槛，也不因未使用自动强制调用。

## 2026-11-05：历史方法的只读运行与回执

### 失败/机会与窄命题

此前真实 Pi 接线已支持显式调用历史版本，但没有明确的只读选项，可能把检查动作与当前工作区写入混在一起；调用日志的 `version` 只记录 active 版本，无法准确说明实际执行版本。此次补齐安全重跑与版本归属，不新增历史版本调用能力。

窄命题：父 Agent 显式请求某一历史版本并选择只读时，runtime 执行该绑定源码、拒绝工作区写入及 `env.agent`/`env.render`，并将请求版本、实际版本、只读状态、成败和唯一调用回执写入紧邻结果。若受阻调用不返回可读错误、仍产生副作用、日志仍把 active 版本当执行版本，或历史调用污染 active 版本反馈计数，则命题不成立。该接口减少为了检查旧方法而复制发布的步骤；实际质量或成本收益不在此接线验收中。

### 改动与责任

- `run_program` 可选 `readonly`；Pi 注册入口传给 `NativeRuntime.runProgram`。常规 call 仍沿用现有写入流程，适应阶段仍自动只读。只读模式读取当前 workspace 状态，不承诺历史状态快照。
- `program_call`/`program_result` 与内部 tool 记录均带 `executed_version`；request 版另保留 `requested_version`。每次调用带一个 run ID，成功或失败工具结果均回传一条 METHOD RUN 回执。
- WASI 已有只读写入拒绝继续负责 workspace 文件边界；本次补齐只读执行中拒绝 `env.agent`/`env.render`。这些拒绝会从执行层抛出，因此 `runProgram` 仅在其 program 调用边界捕获该错误，作为失败工具结果返回并记录，不吞错或自动重试。
- 历史执行的即时与进程重启后反馈计数都按 `executed_version` 对齐；旧版执行不计入 active 版反馈。

### 有界真实接线验证

首次真实 Pi 测试启动成功，但因失败执行抛出后跳过 `program_result`，六次调用只产出四条结果，测试失败。对具体执行错误路径补充失败回执后重跑；又在运行日志发现该错误路径的回执重复一次，移除重复文本并加入唯一性断言。

最终命令：`$env:PYTHONPATH='src'; python -m pytest tests/test_ppt_live_method_pi.py -q`，通过 1/1，32.08 秒。它通过本地 Pi CLI、真实 PPT extension、Binder、NativeRuntime 与 WASI 启动 11 个 scripted provider turns；不联网、不产生真实 provider 费用。provider-checks.jsonl 为 11/11。最终产物：`C:/Users/qi/AppData/Local/Temp/pytest-of-qi/pytest-3408/test_agent_authored_method_run0/ppt-live-method/`。

实际 `component_runs.jsonl` 有六组配对 call/result，active v1、active v2、历史 v1 readonly，以及三个负例（文件写、env.agent、env.render）。六组 `executed_version` 是 1、2、1、1、1、1；历史请求 active 记录为 version 2、requested/executed version 为 1。六条 output_excerpt 各只有一个 METHOD RUN。写入探针返回 `PermissionError: workspace path is read-only in this execution`；agent/render 分别返回只读不可用错误。`harness/tools.jsonl` 没有产生 agent/render 子调用；测试断言只读写入未创建 `workspace/artifacts/readonly-write.txt`。后续父 turn 接收失败结果后正常退休组件并停用 prompt。该次 scripted fixture 指定了调用顺序，不证明模型自主选择方法或只读策略。

定向回归：`node --experimental-transform-types --test --test-concurrency=1 tests/ppt_demo.test.ts` 通过 6/6，其中包含实际 Windows Edge + PowerPoint 渲染；`node --experimental-transform-types --test --test-concurrency=1 --test-name-pattern='B:' tests/arc_thin_native_runtime.test.ts` 通过 1/1，覆盖 active v2 的重启回放不会把显式 historical v1 失败计入 v2。完整 `arc_thin_native_runtime.test.ts` 未在本轮重跑；该套件既有探索结果曾为 15/16，`USE-CHANNEL` 断言失败未做基线复现，仍未归类，本轮不处理该行为。

| 证据层级 | 状态 | Provider / environment | 产物及结论边界 |
| --- | --- | --- | --- |
| 功能正确 | 通过 | 本地 Pi CLI、真实 PPT extension / NativeRuntime / Binder / WASI + scripted provider；Edge/PowerPoint 定向回归 | 版本、只读拒绝、错误回执、唯一 run ID 和历史反馈计数按测试条件工作；真实 provider 未覆盖 |
| 全链路可达 | 局部通过 | 实际 Pi 父轮 → 工具 → program/WASI → 下一父轮；本地 scripted provider | read-only 历史调用与其结果对父轮可达；不覆盖 production Python runner 或真实 provider |
| 自主采用 | 未验证 | 无真实模型普通任务证据 | 调用、版本、只读选择由 provider fixture 指定 |
| 净收益 | 未验证 | 无真实模型对照 | 复制旧方法的负担是否减少、任务质量、总成本和延迟均未测 |

保持实验状态。没有 ARC harness closure 声明，也没有启动付费运行。下一项可证伪检查仍需授权的真实普通任务观察 Agent 是否会在有适用需要时选择历史只读运行、是否使用其语义结果，以及是否避免影响当前方法计数；本次接线不证明这些行为或收益。

## 2026-11-05：探索规模交还 Agent

用户要求移除人为设定的探索规模。窄命题：Agent 提供的非空候选列表、引用集合与指令不再因 4 候选、8 refs、4000 字符指令或 240 字符引用路径的固定阈值被拒绝。此次只改 explore 的 schema/重复 refs 数量检查及工具说明，不改变权限、工作区路径约束、预算或 provider 原生容量；执行仍为串行，增加候选会增加请求和延迟，未引入新默认配额。

实际本地 Pi 检查：PYTHONPATH=src python -m pytest tests/test_ppt_explore_pi.py -q，通过 1/1，2.15 秒。脚本父一次提交 5 候选，其中一项使用 9 个不同引用、三项指令超过 4000 字符；实际候选请求接收这些输入，4 成功、1 失败，下一父轮收到各项原答复或失败。7 个 scripted provider 请求，不联网收费。此检查只验收上限解除及局部路由，不验收自主迭代。功能通过；全链路局部通过（实际 Pi/PPT extension/native explore/下一父轮，不含 production runner）；自主采用与净收益未验证。git diff --check 通过。

本轮重新读取既有真实轨迹：harness/component_runs.jsonl 在 2026-11-05T02:23:24.059Z 记录 factcheck v10 的错误注入自测 caught=true，02:46:41.632Z 再用于更新后的作品（411→415 numeric tokens）。因此此前“没有方法迭代”的泛化判断不准确；有真实方法修改及后续使用。源码 workspace/tools/factcheck.py 的 in_mat 仍主要按数字字符串是否在原材料中出现判断，忽略多数语义关系；抓住 11.8/12.8 两个注入样例不能证明标签、单位、时期和归属检查有效，也不能证明净收益。explore 部分实际请求因 provider Arrearage 失败，不能当成有效候选审查。

下一优化建议仅为设计，未新增 runtime 规则：复用现有 program/run_agent/explore/render/revision snapshot，让 Agent 用真实任务材料建立能推翻当前方法的试验，检查原始证据与结论是否对应；反馈须能引用实际产物及方法版本，结果直接回父，由父决定修订或放弃。候选数、样本数、角色和迭代次数由 Agent 决定，工具执行成功不充当质量得分。先用普通真实模型任务核查“发现方法盲点→修改方法→后续使用→结果影响再次判断”，再对任务质量和父子总成本做独立对照。不得脚本指定修订路径后称自主迭代，也不增加常驻评审 Agent、强制反思或交付门禁。父子语义反馈、总成本、跨上下文连续性对应 deferred B/C/D，继续开放；这份设计不关闭它们。

## 2026-11-05：预置 ADAPT，Agent 决定进入时机和上下文

用户明确要求先走通控制权，不增加复杂版本、失败回执或调度平台。当前 PPT 中 Agent 只能在普通任务上下文中改组件；旧 ARC ADAPT 的四次调用及受限工具集不符合本次目标，因此不搬用。窄命题是同一实际 Pi session 可由 Agent 主动切入预置 ADAPT，选择文字与 workspace refs，保留 ADAPT 内的连续工具对话，修改组件后切回完整任务历史，后续任务请求收到生效修改。

实现：PPT 父工具 adapt(op=enter, context?, refs?) / adapt(op=exit)。refs 复用现有工作区 read 工具，支持其文本和图像读取；不自动带入旧任务历史或 active prompts。Pi context hook 投影所选材料和进入后的对话，原 session 历史保留；before_provider_request 装配 ADAPT 指令，退出后恢复普通任务及活动 prompt。现有工具与权限保持，无固定调用次数、周期、强制修改、评分表、额外模型进程或自建 hook 调度。本次没有把任意 loop 源码改写或持久调度开放出去。Agent 可再次 enter 选择新上下文。阶段选择是内存态，进程重启回到普通任务；未新增恢复机制。

选择时机与材料、修改/不修改及退出由 Agent 推进；runtime 仅投影上下文、沿用组件装配并恢复任务历史。新增成本为工具 schema、简短入口说明和被 Agent 选择的 ADAPT 请求/材料，不自动增加模型请求。ADAPT 对话随退出回到任务历史，可影响后续工作；不额外生成永久反思文档。跨压缩连续性和父子总成本仍对应 deferred B/C/D 的开放问题，不由此宣称完成。

本地实际验证：PYTHONPATH=src python -m pytest tests/test_ppt_adapt_pi.py tests/test_ppt_explore_pi.py -q，通过 2/2（2.75 秒）。ADAPT 例由真实 Pi CLI、PPT extension、Binder 和本地 scripted provider 执行六个请求：TASK→enter(选中文字与材料)→self_component 创建 prompt→exit→TASK 收到新 prompt→再次 enter(新上下文，不含旧材料/活动 prompt)→exit→TASK 结束。检查了 ADAPT 不含 TASK_HISTORY_ONLY、第二次不含第一次材料、任务恢复完整历史、prompt 文件及实际父请求生效、进入/退出事件。脚本规定行为，仅证明控制路径，不证明自主进化。explore 既有实际 Pi 回归通过；现有 refreshes active prompts 定向 Node 回归 1/1 通过；git diff --check 通过。

证据：功能通过；全链路局部通过（实际 Pi session/PPT extension/请求上下文/组件保存及后续父请求，不含 production Python runner 和真实 provider）；自主采用未验证；高层方法迭代与净收益未验证。无付费运行。下一真实行为检查应观察普通任务中的自主进入/材料选择/方法调整/后续使用，不能指定动作顺序再称自主迭代。

### 纠正：ADAPT 使用独立模型/工具对话（取代上面的同 session 投影方案）

用户明确 ADAPT 必须是独立 turn 或 session，避免停留在任务上下文。撤掉原来的 context hook、enter/exit 模式切换及其状态；父工具现在是 adapt(context?, refs?)，一次调用启动新的 messages 列表和独立 ADAPT system prompt，同一任务模型执行独立工具循环。只自动加载调用者选定的文字和 refs，不继承父任务历史或 active prompts。ADAPT 正常结束即返回其最终结论；中间助手/工具对话保留在 adapt_messages.jsonl，不插入父任务历史。共享现有组件工具与存储，修改沿 Binder 生效，后续父请求使用新配置。每次再次调用建立新上下文；没有单独进程、持久 Pi session、新版本机制或恢复平台。ADAPT 不递归调用自身；调用时机与材料由任务 Agent 决定。

抽出原有 modelResult 供 consult/explore/ADAPT 共用，保留现有请求预留、usage 和预算检查；ADAPT 请求记 kind=adapt，包含后续工具回合与 length continuation。没有引入独立费用额度或固定迭代上限。工具参数使用现有 validateToolArguments 边界校验，工具错误返回当前 ADAPT 对话；未扩建失败恢复体系。

最终验证：PYTHONPATH=src python -m pytest tests/test_ppt_adapt_pi.py tests/test_ppt_explore_pi.py -q，2/2 通过，2.83 秒。实际 Pi 父进程 + 本地 scripted provider 的六个请求分别为父、ADAPT、ADAPT、父、第二次 ADAPT、父；usage kind 顺序为 task/adapt/adapt/task/adapt/task。第一 ADAPT 收到所选材料、未收到父历史，调用 self_component 后在自身下一轮收到回执并结束；父收到最终结论和生效 prompt，未收到 ADAPT_PRIVATE_THOUGHT。第二 ADAPT 不含第一次上下文/材料/新 prompt，父任务正常继续。普通 prompt 刷新及未知 provider 用量预留回归 2/2 通过，git diff --check 通过。该独立对话与共享组件接线已验证；真实 provider 自主进入、方法层演进及交付质量收益仍未验证，不作自进化成功声明。无付费调用。

## 2026-11-05：ADAPT 自演化训练与可变方法

ADAPT 已可独立调用，但普通入口与 core instruction 过于薄，Agent 难以判断可变对象、实际可见上下文和方法边界。改动目标是让 task prompt 简短说明自演化目标与选择权，按需提供实际工具手册，并让 Agent 作者的 `adapt_method` 只在以后 ADAPT 调用开始时读取。可证伪条件：ADAPT 继承 task history/active prompt；方法变更影响已开始的当次指令；同名用户训练 skill 被覆盖；或文案描述了 host 未开放的能力。

- 将 ADAPT 的不可变 core instruction 放入独立 prompt 文件。handler 开始时经 Binder 捕获 `adapt_method` 的当前 body/path/version，并在该调用全部 provider turns 中固定；本次中途改动只对未来调用生效，缺少该 skill 时仍运行 core。
- PPT 普通 prompt 说明自演化服务于 presentation 及其约束，Agent 自选时机/上下文/调查/修改；无固定顺序、候选数/轮数、编辑、评审、rubric、周期触发或报告要求。完整 `self_evolution` skill 通过 `read_component` 按需访问，不自动注入全文。
- 新训练 skill 由 direct Pi startup 和 Python runner `prepare` 在同路径缺失时 seed，先检查路径以保留用户已有内容。指南按真实代码描述：ADAPT 仅收到所选 context+refs，不继承任务历史/活动 prompt；同一模型与共享预算，`kind=adapt`；taskTools 派生并过滤自身 `adapt`，包含可能可调用的 `office`/deliver，不含 NativeRuntime `consult`；工具错误回到内部循环。可变组件包括 prompt/skill/memory/tools/subagent 与其组织方式；host core、权限、预算与调用循环不可变且不可自调。
- 手册提供 `self_component`, `read_component`, `save_program`/`run_program`/`retire_program`, `run_agent`, `explore`, `office` 示例与限制，并指导用反证/负例和后续语义使用判断价值，不建立固定方法流程。

本地验证：`$env:PYTHONPATH='src'; python -m pytest tests/test_ppt_adapt_pi.py -q`，通过 1/1（1.65 秒）。这是本地 Pi CLI、PPT extension、Binder 与 scripted provider 的实际独立 ADAPT 调用路径，不联网收费。provider fixture 已断言新的独立 core prompt；它没有证明真实模型自主选择、方法自写/未来版本载入或收益。Python runner seeding 目前为源码实现，未单独实跑 `prepare`。功能及 direct Pi 局部接线通过；生产 runner 路径、真实 provider 自主采用与净收益未验证。deferred B/C/D 父子反馈/总成本/跨上下文连续性保持开放。

后续增强同一 provider fixture，实际在第一 ADAPT 中经 `self_component(kind="skill", name="adapt_method")` 保存方法，断言当前 ADAPT 的 core 不变、第二个独立 ADAPT 才加载该方法，且仍不继承前一调用私有对话和原任务历史。GPT-6 Luna high 重跑同一 Pi 路径：`PYTHONPATH=src python -m pytest tests/test_ppt_adapt_pi.py -q`，1/1 通过（1.32 秒）；`git diff --check` 通过。该检查证明可作者化方法的跨调用装配，不证明 Agent 自主决定自我培训、方法质量或真实作品净收益。`ppt_demo.py prepare` 单独路径仍未运行。

### 定义纠正：持续能力发展是正向目标

前版把“不必修改/创建组件”放在定义显眼位置，使 self-evolution 容易被理解为只有偶尔方法微调才发生。按用户澄清，改为把 Agent 在当前任务中持续发展完成任务所需能力与工作系统作为正向目标；范围包括组件创建/修改/组合/简化/移除、方法与策略，以及架构/runtime/process 设计（仅在真实开放且授权的实现路径内）。可从成功、预期、分析、失败、新需求或策略构想发现机会，不要求等待反复失败。Agent 自主决定 ADAPT 时机、上下文、方法及退出；没有固定顺序、频率、数量、组件、评审、rubric 或报告。仍分开判断变更是否生效、是否进入后续真实工作、是否有证据表明能力/交付确有改善。当前 PPT runtime 可改 harness 组件但不支持任意 host 源码/权限/预算/core loop 改写，因此提示词只允许把架构/流程列为设计范围，不宣称该系统已开放这些实现能力。

本次仅改 task prompt、ADAPT core、`self_evolution` skill 及其文案断言，并更新本记录；scripted provider 路径已按新 core 正文调整。定义改动后的实际本地 Pi 检查：`$env:PYTHONPATH='src'; python -m pytest tests/test_ppt_adapt_pi.py -q`，1/1 通过（18.12 秒）。该 fixture 继续覆盖一轮调用中保存 `adapt_method`、下一独立 ADAPT 读取它，以及 task context/历史隔离；无真实 provider 费用。`git diff --check` 通过。该检查只证明 scripted 接线和新提示兼容，不证明 Agent 自主采纳、架构能力实际可写或能力/作品净收益。

### 目标与运行 affordance 对齐

后续审阅指出，task goal 仍挤入了具体 ADAPT/skill 使用操作和探索/局部修订提示。将定义改为系统级能力发展：Agent 可从不同起点主动设计/创建/调整/替换模块、关系、协作、控制流、整体组织及演化机制；既有架构/流程是可调整起点而非模板，并自主选择在任务内整合或独立探索、实现与试用时机，以及继续/修订/放弃。保留生效→后续使用→证据改善的区分及无固定入口/模式。具体 `adapt(context?, refs?)` 可见性和运作事实转到注册工具描述，完整 `self_evolution` 与 explore 方法留在环境技能索引/按需 skill；文案严格标明当前工具集过滤、可能 callable 的 office/deliver、不含 native consult、没有显式 exit，及 host/core/权限/预算不可编辑，不暗示开放任意 runtime 架构写入。

按新 target prompt 和 task-tool descriptions 扩展 scripted provider 断言后重跑真实 Pi path：`$env:PYTHONPATH='src'; python -m pytest tests/test_ppt_adapt_pi.py -q`，1/1 通过（20.55 秒）。`git diff --check` 通过。Provider 仍为本地 scripted；不证明自主选择/采用或收益，无付费调用。

随后将 target 文案中的 “No fixed entry point” 改为小写衔接句并调整 autonomy wording。首轮重跑因 provider fixture 的大小写敏感断言未命中而在发请求前退出（没有 provider-checks 记录）；改为忽略大小写后，本地重跑通过 1/1（1.32 秒），`git diff --check` 通过。失败属于 fixture 文案断言，不是 ADAPT 运行链失败。
