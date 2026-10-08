# 社区补充：确定性压缩、观察式记忆与权威记忆日志

联网研究日期：2026-10-07（Asia/Shanghai）。以下资料来自公开仓库固定 commit 的 README、配置及架构文档；它们是机制研究，不代表独立复现性能或验证所有 Pi 版本兼容性。

## 1. sting8k/pi-vcc：结构提取 + 原始 session 检索

固定 commit：`4cfc6bfae5a1a943dd2b4e9cabc95101bb5811bb`；该快照 package 为 `@sting8k/pi-vcc 0.10.0`，peer Pi `>=0.74.0 <2.0.0`。来源：[README](https://github.com/sting8k/pi-vcc/blob/4cfc6bfae5a1a943dd2b4e9cabc95101bb5811bb/README.md)、[package](https://github.com/sting8k/pi-vcc/blob/4cfc6bfae5a1a943dd2b4e9cabc95101bb5811bb/package.json)。

它替换自由文本模型摘要，用确定性提取生成 Session Goal、Files and Changes、Commits、Outstanding Context、User Preferences、可选Tracked Commands和短transcript。根据实际内容决定出现哪些section，合并前次摘要并限制section大小。保留tail；默认keep:1，在tail低于5k估算token时smartKeepTail扩到20k范围；显式keep:N优先。overrideDefaultCompaction默认true；关闭后只使用专属命令，不接管原生压缩。

`vcc_recall`从原始session读取，默认当前lineage，scope:all涵盖其它分支，限当前session。支持关键词OR排序、regex、page、#N entry展开、range以及touched files。压缩摘要中保留entry定位，能够先用短信息继续，再定点恢复原文。算法压缩本身不调用模型，召回后模型处理新增内容仍消耗token。

设计优点是结构可预测、无额外摘要模型调用、原文可定位；短transcript兼顾时间顺序。边界是确定性提取不能理解所有隐含因果、图像或特殊工具语义；section cap与摘录仍删掉模型默认可见内容，所以它是“原文可恢复”的方案，不能称热上下文语义完全无损。

作者README报告1884份session的字符压缩中位数97.6%及运行时间，但本次未完整读取关联benchmark数据或独立复现，不能将这些数字当作任务成功率或总计费收益。README关于Pi原生压缩“历史永久消失”的对照文案不准确：原生JSONL条目仍在，区别在于默认投影和扩展提供的模型召回接口。

## 2. k0valik/pi-blackhole：算法压缩与观察式记忆互补

固定 commit：`f86aa0d2edc53ea3b02fe3e9a0a130d81323178d`；package `pi-blackhole 0.5.11`。来源：[README](https://github.com/k0valik/pi-blackhole/blob/f86aa0d2edc53ea3b02fe3e9a0a130d81323178d/README.md)、[架构](https://github.com/k0valik/pi-blackhole/blob/f86aa0d2edc53ea3b02fe3e9a0a130d81323178d/docs/architecture.md)、[配置](https://github.com/k0valik/pi-blackhole/blob/f86aa0d2edc53ea3b02fe3e9a0a130d81323178d/docs/CONFIG.md)。

VCC风格compile生成结构摘要；Observer从新历史提取有时间戳/来源的observations，Reflector综合reflections，Dropper减少低价值observations。状态保存在session ledger；压缩时把结构摘要与记忆一起交付。每条观察/反思有短ID，对应原session entry，recall能恢复来源。不是把所有模型过程无界塞入主会话。

架构记录agent_start/turn_end检查研究worker，agent_end评估压缩阈值，session_before_compact合并VCC与OM；当前配置还包含mid-run机制和非持久session特殊处理。因此单一“只有回合结束才压缩”的说法不覆盖全部模式。具体行为以配置和host版本为准。

配置默认observeAfterTokens=15000，reflectAfterTokens=25000；这些是worker触发阈值，不是允许记忆总大小或硬模型窗口。历史tool output另有默认20000估算token预算，尚未被assistant消费的尾部结果受保护；非文本块保留且不计入这个文本预算，不能据此认定图像免费。recall有默认48000字符预算，字符/4仍是估算。

压缩时机当前可按固定token、窗口比例、reserve或preset曲线决定，不应沿用旧81000固定默认。memory=false关闭worker及OM注入，压缩仍可独立进行。配置提供每worker模型fallback及cooldown，sessionFallback默认true；便宜worker失败后回退主模型，可能意外增加成本。

这个方案的设计价值是把“高频观察”“较慢综合”“记忆清退”分层，又与原始来源相连。维护者明确称experimental，并说明**结构压缩无模型调用不等于整个记忆系统免费**；后台worker是实际计费调用，未经调参甚至更贵。未看到本次可独立复现的任务质量净收益证据。不要与独立pi-vcc/pi-observational-memory同时默认接管同一压缩hook，文档列出冲突。

## 3. DavidEasden/pi-compact：事件日志作为权威记忆，模型按需查询

固定 commit：`f2717fbd4a297bf7670d153e8ffa3706e3fbbcf3`；package `pi-compact 0.4.0`，peer Pi>=0.87.1，开发集成测试固定0.87.1，不能把peer范围视为当前1.0.4实跑证明。来源：[README](https://github.com/DavidEasden/pi-compact/blob/f2717fbd4a297bf7670d153e8ffa3706e3fbbcf3/README.md)、[package](https://github.com/DavidEasden/pi-compact/blob/f2717fbd4a297bf7670d153e8ffa3706e3fbbcf3/package.json)。

核心是项目`.pi/pi-compact/memory.jsonl`追加事件日志，由pure projector恢复最新状态。用户/remember写入权威记忆；模型提议留provisional，不能自动变active/pinned；模型只能改/resolve自己的provisional提议。seq/prevHash/hash维护事件链，损坏时停止在可信前缀、拒绝掩盖式续写。文件锁用于并发进程完整性。这是审计和状态完整性机制，不证明记忆语义正确。

当前版本没有context注入hook，不自动注入pinned记忆或history hints；旧pinnedInjection/autoRecall字段仍可解析但不再生效。模型通过pi_memory_search/read/propose/update按需工作，历史通过pi_compact_recall的list/search/read、entry ID、file/kind/sourceClass过滤与raw分页恢复。工具默认仅当前分支；用户UI命令可选scope:all。关键词检索不是向量语义搜索；raw保留thinking，默认搜索text排除它。

压缩接管使用Pi边界与投影预览，校验tool call/result配对，必要时尝试更早安全boundary。产生的checkpoint仅compactor/sourceCount/sourceHash，不复制历史正文，也不是primary memory。完整历史依赖原Pi session磁盘记录。默认recallMaxChars=16000，长entry用offset/rawLimit继续；工具JSON在完整结果边界截断，不切坏JSON。

可取之处是authority/provisional/sourceClass分离、完整原文回查和不常驻大记忆。明显取舍是：指针型checkpoint极短，无法自行承载工作语义；持续任务更依赖保留tail与主动检索。用户确认带来管理成本，适合重要长期事实，不一定适合高频临时认识。原文仍在并不保证模型会回查或遵守memory；文档也明确此点。

同名注意：`williamleong/pi-compact`是另一项目，为agent提供compact_context与使用授权skill；不能将它与DavidEasden的事件日志/recall设计混写。参见[另一项目README](https://github.com/williamleong/pi-compact)。

## 4. 按目录按需加载：pi-on-demand-context候选

公开npm元数据确认`@quartermaster-labs/pi-on-demand-context 0.3.2`，repository为Quartermaster-Labs/pi-on-demand-context；git HEAD固定`7c08537fda7762b2277549231ccd48f78b2aa208`。官方package页面与registry描述它根据bash cd或文件工具触及的目录加载CLAUDE.md/AGENTS.md，并与Pi自身loader去重，已加载内容一次性持久注入。来源：[package目录](https://pi.dev/packages/%40quartermaster-labs/pi-on-demand-context)、[仓库](https://github.com/Quartermaster-Labs/pi-on-demand-context)、[registry](https://registry.npmjs.org/@quartermaster-labs/pi-on-demand-context/latest)。

这是解决monorepo“只预载上层规范，实际进入子目录才补局部指引”的合理思路；比全量加载所有子系统规则更贴近当时任务。当前未成功取得完整README/源码（后续连接失败），所以只能列为候选：卸载规则、精确目录边界、去重身份、是否处理规范更新及Pi1.0兼容仍未核。不能声称模型离开目录后规则自动退场。

## 5. 检索证据边界

已实际进行联网搜索，并从固定commit完整取得前3项目README/package及blackhole架构/配置；未把失败下载片段当完整证据。部分后续源码、benchmark和on-demand文档未成功下载，以上均分别说明。不安装、不调用社区worker、不执行用户任务benchmark；“值得借鉴”表示机制清晰、定位具体，不表示已证明普遍收益。
