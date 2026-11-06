# PPT task session：自动 compaction 与上下文优化分析

日期：2026-11-05（Asia/Shanghai）
分支：codex/ppt-adapt-context；基于 6147bfd6 的本次工作区改动。

## 已实施

PPT runner 的 AZ 和官方 provider 路径均开启 Pi 原生自动 compaction。新启动与通过此 runner 续跑时生效；没有热更新既有进程，也没有重启或发起付费生产任务。官方路径运行结束后仍恢复原 models/settings。

生产配置没有新增阈值。Pi 0.87.0 的默认 reserveTokens=16384、keepRecentTokens=20000；现有官方设置中的显式阈值仍保留。默认阈值机制在上下文接近模型窗口减去 reserveTokens 时触发，另有 overflow 恢复。keepRecentTokens 是切分近期历史的预算，不是对摘要或整个请求总长的保证。

Pi 负责触发、生成结构化摘要、保存 compaction checkpoint 和恢复近期历史。完整 session JSONL 仍是原始记录；压缩改变后续模型看到的上下文，不删除原始轨迹。系统提示、活跃 prompt 和工具定义仍按原入口提供。ADAPT 的内部独立对话没有同时新增 compaction。

摘要生成复用 Pi 原生 compact()，每一次实际摘要调用经现有 modelResult(..., 'compaction') 计入任务预算和 usage 日志，包括 split-turn 的多次调用。hook 异常会被 Pi 吞掉并回退到默认路径，因此这里在摘要失败时显式取消本次压缩，保留旧历史并记录失败，避免未计入任务预算的回退调用。

原生 compaction 部分没有接入新的结构化 task 状态机；同日追加的请求投影见文末，改变模型请求视图而不改写原始历史。

## 窄命题与成本

机会：runner 原来显式关闭 compaction，长代码、工具结果及推理随会话持续积累。
命题：复用原生 compaction 后，接近窗口的 task session 能生成持久摘要、继续任务，并让摘要请求受现有预算约束。
可推翻条件：自动触发不成功、checkpoint 没有用于后续请求、失败时覆盖原历史、或存在未计入预算的摘要调用。
成本：增加同模型摘要调用及其延迟；摘要可能丢失细节。这里不声称任务质量或总费用已改善。
没有新增 Agent 常驻步骤、工具、决策表或额外 worker。预算不足仍按原有进程停止路径退出。

## 已验证

实际 runner + Pi、免费脚本 provider：

- AZ 路径：开启自动 compaction，阈值触发、持久 checkpoint 和后续任务请求包含摘要。
- 官方路径：同样通过，结束后恢复原有用户设置。
- 摘要截断负例：取消压缩、无持久成功 checkpoint、旧历史可继续；每次摘要调用均有 usage 记录，没有额外未记录回退调用。
- 原有独立 ADAPT 接线测试：通过。
- 预算未知用量恢复、动态 prompt 刷新、嵌套子代理权限回归：3 项通过。

合计：pytest 4 passed；Node 3 passed；git diff --check 通过。
诊断用 keepRecentTokens=128 和脚本 usage 主动触发阈值；不代表生产阈值改变，也不代表真实模型摘要质量。
功能与脚本接线通过；真实模型的事实保持、采用和净收益未验证。没有花费真实 provider 预算。

## 历史上下文测量

读取现有 ppt-online-self-improve 工作区 runs/ 下 provider-requests.jsonl 的最后一个有 payload 的主请求。以下都是序列化字符数，包含 JSON 开销；日志中的图片载荷可能已被替换，不能当作真实 token/图片费用估算。

| 样本 | 有 payload 的主请求数 | 最后请求字符数 | 消息数 | assistant 消息字符 | 工具消息字符 | 状态消息字符 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| ppt-qwen-meta-explore-20261105 | 47 | 237213 | 105 | 157542 | 56355 | 5571（6 条） |
| ppt-qwen-self-improve-20261104-final | 15 | 216510 | 35 | 155783 | 46232 | 836（2 条） |

第一个样本 assistant 字段进一步分解：tool_calls 85522 字符、reasoning_content 66251 字符、普通 content 2776 字符。工具调用参数里 edit=49433、write=10808、explore=5901、save_program=4541、edit_program=4009 字符。字段统计和整条消息统计口径不同，不能机械相加当作 token 总数。

相对于该请求 237213 字符，系统消息 5544 和状态消息 5571 各约 2.3%。这支持将优化重点放在长历史，而不是先削短目录和系统提示。历史样本可能属于不同版本，只作为定位开销的证据，不是本次代码的收益对照。

## 是否值得继续优化

结论：值得，但先观察 compaction 后的表现，再逐项改变一个因素。

1. **长代码与编辑参数历史，优先级最高。** 大段 write/edit 参数在成功落盘后仍反复随历史发送。优先利用现有 source_path 发布、按需读取文件和复用程序，减少重新输出已有源代码。若之后实现历史投影，应只处理已完成的旧调用往返，保留版本、文件指针、成功/失败和未完成操作；原始 session 仍保存完整内容，工具协议配对必须有效。没有证据支持截断最近失败或进行中的代码。
2. **reasoning 回放，值得单独评估。** 首个样本约 66K 字符。先核对该 provider 对 reasoning 历史的实际要求和线上 usage，再对照关闭旧 reasoning 回放的延迟、费用与任务连续性。不能据字符数直接断言全部可删，也不能更改当前轮所需的 provider reasoning 结构。
3. **旧图片，潜在收益较大但目前无法量化。** 两个样本的最后请求均有 5 个图片块；这些是观测到的块数，未测其 token 成本。未来可按 revision、源版本和当前比较目的保留需要的图片，旧图片保留路径按需 look/read。不能只保留最后一张而破坏跨版本比较。
4. **状态消息的新鲜度与重复，价值主要在正确性。** 当前每次 prompt 追加 snapshot；工具自动续轮不重新生成这条状态，因此旧状态会留在历史并可能过时。将历史状态视图替换为一个当前视图能减少歧义，但测得字符份额较小，不能把它当主要节流手段。若实施，应在每次实际请求刷新，并保留必要历史证据。
5. **合并重复目录，低成本但收益有限。** skill index、program catalog、harness index 有重复元数据。可只显示一份版本、描述和按需读取入口，保持 skill/program 正文按需展开；不值得为此搭建新检索服务。

## 下一项可证伪验证

在用户授权的真实任务预算内，对比相近任务前缀上的 compaction 前后实际 input/cache/output、压缩耗时、再次读取量、源引用准确性、未完成事项和最近失败保留率。只有发现压缩后仍由代码参数或 reasoning 主导，才继续对应的单因素优化。不要把创建状态文件、摘要变短或压缩成功本身当作任务净收益。


## 逐轮上下文投影：实现与验证（同日，用户已同意）

机会：长 write/edit 参数、状态快照和历史图片持续随请求重放。窄命题：通过 Pi context hook 确定性投影已执行的源参数和已关闭 task turn，可减少重复载荷，保留原始 session、工具配对、错误和按需读取入口。没有新增模型调用、worker 或要求 Agent 每轮维护的摘要。

### 最终规则与生命周期

- 没有 ppt-work-state 标记时保持原视图；最新标记界定活跃 task turn。
- write/edit/save_program/edit_program/self_component 成功返回后，从第一次重放起将超过 1000 字符的 content/body/old_text/new_text 参数替换为历史引用、长度与 SHA256。完整参数以 JSON 归档；工具执行仍使用原始参数，调用名和 ID 不变。失败及未返回的调用保持原样。
- 活跃 turn 的工具结果、所有 reasoning 保持完整。成功源参数在活跃 turn 内也采用上述投影，避免长单轮循环持续重发代码。
- 进入下一 task prompt 后，旧状态快照改为原文引用。每个关闭 turn 固定保留最后两项工具结果中的文本；其他成功结果内超过 5000 字符的文本复用 historyResult 保留预览和原文入口。错误结果不精简。
- 关闭 turn 的图片改为内容寻址的原始二进制路径，可直接用普通 read 重新查看。当前 turn 图片保持完整；不按滑动窗口反复改变同一 turn 的旧前缀。
- 文本通过现有 workspace.saveResult 去重归档；投影不修改输入对象，不删除 session 历史。每次实际模型请求自动应用，记录 context-projection.jsonl；原生 compaction 独立保留为窗口阈值后备。

初版只处理已关闭 turn，单个长 turn 样本仅减少约 0.1% 文本，因此将成功源参数调整为第一次重放即引用。未删改旧 reasoning。这里只实现 PPT task 路径，未修改 ARC 和 ADAPT 内部对话。

### 验证与对照

- Node 组件测试 4 passed：原对象不变、归档精确、失败/未完成调用完整、当前结果和推理保留、图片字节可恢复、历史前缀稳定。
- 实际 Pi + 本地 scripted provider：projection、compaction、ADAPT 共 5 passed；最后增强图片读取验证后，projection 单项复跑 1 passed。两次 task prompt、四次 provider 请求证明源文件执行使用完整参数，原始 session 字节保持 append-only，引用参数及图片可通过普通 read 恢复，投影请求减少超过 7K 字符。
- 相关 Node 回归 3 passed：未知用量恢复、活跃 prompt 刷新、嵌套 delegation。git diff --check 通过。
- 全部为本地免费验证，没有付费 provider 运行。测试不改生产阈值。

离线读取既有原始 session，在独立 scratch Workspace 投影，不修改源运行。口径为规范化消息 JSON 字符数，图片 base64 替换为占位；不是 token、计费量，也不可与上文 provider payload 字符直接比较。

| 样本 | 消息 / 状态条数 | 投影前文本字符 | 投影后文本字符 | 文本减少 | 图片块前 → 后 |
| --- | ---: | ---: | ---: | ---: | ---: |
| ppt-qwen-meta-explore-20261105 | 109 / 6 | 395453 | 357481 | 9.6% | 5 → 0 |
| ppt-qwen-self-improve-20261104-final | 35 / 2 | 276296 | 257593 | 6.8% | 5 → 5 |

第二个样本图片属于活跃 turn，因此保留。单次本地投影测得约 41.6ms / 7.2ms，仅为这两个样本的开发测量。

### 证据边界与下一步

功能正确性与脚本全链路接线通过；真实模型能否主动读取必要引用、维持跨轮认识及取得净收益均未验证。原文可找回不保证关键信息始终驻留。后续仅在授权真实预算内比较实际 input/cache/output、延迟、重复读取和任务质量；不能把字符减少或缓存前缀稳定直接称为费用或质量改善。D 节跨压缩认知连续性事项继续开放。
