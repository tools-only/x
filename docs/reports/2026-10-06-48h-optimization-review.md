# 过去 48 小时优化与效果回顾

核对窗口：北京时间 **2026-10-04 10:13:47—2026-10-06 10:13:47**，即 UTC 10-04 02:13:47—10-06 02:13:47。按本次证据核对开始时间冻结窗口；不是按文件名日期估算。本文是派生回顾，实施记录仍以[统一变更记录](../plans/2026-10-02-context-tool-reasoning-design.md)为准，当前版本以[版本登记](arc-mechanism-version-index.json)为准。

已经落地了上下文去重、静态工具说明寿命、已完成推理历史投影、预算漏洞和多项接口／生命周期修复。但 **当前 yibu/qwen3.8-27b 在最多 60 动作内至少过一关的目标没有完成；普通自主 self-harness 的任务净收益没有建立**。不能把接线通过、组件可创建、字符减少或隐藏推理归零当成解关效果。

本轮仅整理现有证据，没有新付费请求、游戏运行或 stage134 实现。

后续开发的诊断与增量验证方法见 [优化经验手册](../optimization-handbook.md)；它归纳本次经验，不替代权威开发流程或运行记录。

## 1. 成本与真实任务结果

已确认的窗口内 provider reported tokens **至少 10,289,671**：

| 请求模型 | 已确认 tokens | 口径 |
| --- | ---: | --- |
| gpt-6.1-sol | 9,792,930 | ARC 父子调用、显式工具／保存帧诊断、已计量的直接探针 |
| qwen3.8-27b | 496,741 | ARC 调用、坐标探针、两次显式计算接口诊断 |
| 合计 | **10,289,671** | 已报告下限，不是完整账单或现金费用 |

包含 input、cache、output；reasoning 已含在 output，未重复相加。失败／取消／缺 usage 的额外成本未知，不能记零。不包含开发 Agent 自身 tokens，不包含 localhost scripted provider 测试。没有足够的真实价格和账单证据换算人民币／美元。

账目依据：50 个运行／诊断目录及 3 份独立探针产物，逐记录聚合并避免再次加入历史汇总。stage60 跨越窗口开始，仅计窗口内已完成 usage 的 283,396；其全运行成本是 373,740。三份直接探针按登记实验日期纳入，缺逐响应绝对时间是计量限制。旧 stage74 目录名写 gpt，但实际 HTTP 请求 model 是 qwen，按请求模型归类。见[可复核审计及源文件 hashes](../../tmp/arc-48h-optimization-review-20261006-audit.json)和[只读汇总脚本](../../tmp/arc-48h-optimization-review-20261006.py)。

### 核实到的通关

| 版本／环境 | 首关动作 | 全运行动作／关卡 | 全运行 reported tokens | 能说明什么 |
| --- | ---: | ---: | ---: | --- |
| stage60，yibu/GPT，ls20 | 36 | 50／1 | 373,740 | 普通父能通关；0 研究、作者组件和装配，不能归因于 self-harness。运行开始于窗口前约 4 分钟，首关发生于窗口内 |
| stage80，yibu/GPT，ls20 | 33 | 44／1 | 457,721 | 单次普通运行成功；无作者组件／装配贡献证据 |
| stage90，yibu/GPT，ls20 | **17** | 23／1 | **158,577** | 首关时累计 **78,066**；是已冻结的最有价值历史 GPT 参考，仍不是稳定重复效果或 Qwen 成绩 |

stage90 后续基线复现：stage113 因 provider 超时停于 1 动作／6,342；直连 stage113b 为 14 动作／108,798，均零关。因此既不能说历史成功不存在，也不能说成功已可靠复现。三次均未完成整个游戏。

来源：[stage60 summary](../../runs/arc-evidence-effort-stage60-ordinary-gpt-ls20-20261004/summary.json)、[stage78–80 audit](../../tmp/arc-stage78-80-final-audit-20261004.json)、[stage89–90 evaluation](../../tmp/arc-stage89-90-final-evaluation-20261005.json)、[基线复现审计](../../tmp/arc-stage115-outcome-audit.json)。

### 主要失败成本

- **stage91–112：18 次真实运行，5,374,347 tokens，全部零关。** 包含显式工具诊断和普通／研究引导运行；stage96–101 的五次独立运行单独就消耗 1,843,855。增加行动意图、几何投影、目标比较说明、推理投入等没有获得任务收益证据。
- stage107 实际完成 **60 动作／227,913 tokens／0 关**。它证明动作链能跑完，不能算满足目标。
- stage117–128 的十个近期 Qwen 窗口合计 **412,646 known／0 关**，还有未知取消费用；这些是短诊断窗，不是已完成的 60 步测评。
- stage130、133 两次 Qwen 显式计算接口诊断合计 **43,486 tokens／0 ARC 动作／0 关**。算法主体可独立核算正确，但真实候选未通过 preflight，不能算原生工具语义成功。

这些分组是上述总额的子集，不得再次加到总额。

## 2. 优化到底落地了什么

| 机制／版本 | 已实施的变化 | 可确认的效果 | 真实任务效果与限制 |
| --- | --- | --- | --- |
| 作者接口，62／67／69／72 | 去掉重复 decision 必填；单组件优先 direct create；无冲突的误嵌发布元数据机械归位；非法 child context recipe 明确拒绝，避免静默丢帧 | 保存帧 stage70 真实 GPT 能创建、装配并返回两组正确通行值；委派错误不再伪装成功 | 显式保存帧诊断，48,595 tokens；没有实时解关或普通自主采用证据 |
| 工具取证和 pending，84–85／95／98／104／109／115 | exact-ref inspect 不再误列整个目录；委派超时和未写入拒绝结束该次尝试；兼容 output_contract、next_step／next_decision | 修复目录膨胀、永久 pending、字段静默丢失和纯拒绝制造修复义务的问题 | stage86 为 5 动作／83,058／0 关；接口正确不等于目标判断正确 |
| 初始 prompt／schema，87–88 | 删除重复说明；按需披露；PNG 改回原生 64×64，保留全部 4096 pixels | 同帧常驻 prose 11,606→6,066 字符（−47.73%）；首请求 42,711→36,842 字符（−13.74%）；88 达到 CH 1×约束 | 字符、本地 tokenizer 与 provider usage 是不同口径；不能由此宣称关卡收益 |
| 认知工作集，73／90／93／116 | 同值候选正文去重；保留位移见证、最后行动意图和反证；没有正式候选时不制造候选选择义务 | 116 局部视图累计字符 27,825→18,068，facts／claims保持；90 有一次17步首关 | 90 单次成功；116 没有同预算真实收益对照；完整认知连续性仍未证明 |
| 完成后的 CoT 历史，118r1 | 仅在允许 provider、可编辑 reasoning_content、成功配对事务且有公开决策材料时，保留短摘录＋全文 exact ref；签名／opaque／未完续接保持 | 同一序列化回放 70,223→44,020 字符（−37.31%）；真实后续输入增长降至约1.54×，无资源恢复重读 | Qwen 两动作仍消耗82,187 known、815秒、零关；**减少历史输入没有阻止新生成52,486 reasoning** |
| 新推理投入，107／120／124–125 | 去除失败文字hash抖动；将深推理延后到动作反馈；length 有界 off 恢复；投入前核对剩余预算 | 125 真实3请求／2动作／41,069／38.156秒；ordinary reasoning0；实际 off 控制生效 | 123r1 第二响应8192 reasoning、124.491秒、length；125只是短窗，仍零关；不能说 off 已解决任务质量 |
| 图像／工具结果寿命，126–128 | 动画关键帧相对完整当前 grid 用可逆 spans；静态手册一轮全文后 exact-ref；bare手册阅读不再隐式锁住高级schema | 126同记录离线 text+schema 10,386→9,127本地o200k（−12.1%）；127–128重放省3,037本地tokens；128真实手册过期、六schema稳定、无资源重读 | 126实际窗未触发patch；128为4请求／2动作／50,085／0关。目标色声称4、canonical5，证据不支持归为压缩丢像素 |
| 成本完整性／父轮边界，117／119／121／123／131 | 失败和全零usage不当免费；父子共享止损、实际HTTP前准入；禁用范围内未计量原生compaction；等待 true agent_settled 后交接 | 原生／fresh-process负例与真实runner验证预算停止、反馈进入后轮；预HTTP拒绝与在途未知分开 | 解决计量与生命周期漏洞；响应后usage阈值和预留估算仍不是供应商硬计费上限 |
| 首次组件试用，130／132／133 | create＋显式assembly＋可选trial复用原生执行；typed顶层trial；别名冲突throw；独立preflight错误一次聚合 | 133功能49通过、1项不适用skip；实际ARC/Pi/scripted完整17场景／425检查通过 | 133真实Qwen3HTTP／27,017／30.656秒，修了3项中2项，仍漏closed schema的bound grid；0组件／0原生trial／0动作。一次可靠修复命题被该样本反驳 |

完整当前 grid、原生 PNG、exact version/CAS、权限、环境完整性检查均保留。没有通过删除应有像素来制造压缩数字。

**当前 stage133 初始上下文**：text＋schema **28,379 字符／7,004 本地 o200k tokens**；whole JSON **29,767 ≤ CH 29,804**，仅剩37字符余量。它满足已测同帧 CH 1×约束，但不能外推为所有观测、provider图像计量或运行中上下文都相同。

## 3. 哪些尝试没有形成收益，哪些仍没修好

1. **试验推进不够收敛。** stage90 单次成功后，后续18次真实运行耗费537万tokens而零关；相近预算的基线重复和单因素收益对照不足。将更多提示、投影和推理投入继续当作下一候选，未及时按失败结果缩小范围，是本轮最主要的开发问题。
2. **输入膨胀与新输出推理是两个问题。** stage82 已知费用94.8%来自input/cache，完整说明、重复观测、schema与历史驻留是主要负担；stage118r1 则主要卡在新输出私有推理，首delta约4秒，却在两个响应中生成约793秒。历史压缩和关闭新推理分别修了不同环节，不能混为一个成功指标。
3. **行动反馈可达，但科学判断仍错。** 123已修settlement交接；128实际看到原预测、反证和完整帧，也产生下一动作，却仍误读目标色。保留材料不保证理解正确；目前没有可靠目标假设→可区分实验→推进关卡的稳定证据。
4. **计算接口仍让Agent重复表达同一契约。** 科学AST读取host绑定grid，但closed input_schema还要作者重复声明grid；stage66、130、133再次出现这类错误。最新聚合回执减少逐个报错，却未让Qwen一次修完。该断点仍在“候选→发布／首次语义使用”，没有被原生试用成功掩盖。
5. **研究和组件的收益链没有闭合。** stage71有研究报告被父精确引用并转成第10步对照行动，但该次21动作／504,178仍零关；显式工具诊断取得正确局部值也没证明解关贡献。不能把“所有研究完全没被读”当总解释，也不能把局部读／用当任务净收益。
6. **还有诊断本身的问题。** stage131的一项旧terminal fixture永久返回被禁止arc而循环，冻结130也复现；353 localhost HTTP中只有1个真实环境动作、约350次被拒绝，不是353游戏动作。该诊断缺陷未修，不应隐去或误作真实付费行为。

撤下／未晋升记录：stage71默认周期线索撤下；stage122 null-first union原型因空字符串转换回归被拒，122r1另修；stage129坐标标尺两臂共8,908tokens都误读目标，已退休并恢复128表示；stage114 state-recall仅保留隔离实验状态，普通样本未出现适用回忆，未证明收益。部分历史叠加试验没有独立消融，不应宣称已知道每项改动的单独作用。

## 4. 当前证据与版本决定

| 层级 | 当前能确认的状态 |
| --- | --- |
| 功能正确 | stage133定向检查通过，公开保留相关skip与旧fixture失败；不能声称全仓测试全绿 |
| 全链路可达 | stage133真实ARC SDK／bridge／Pi父／child／router／native组件／action／后轮，scripted provider矩阵17／425通过，覆盖五组件及两类length续接 |
| 普通自主采用 | 最新Qwen未证明自主完成研究→有用组件→装配→语义使用→有效行动；显式诊断不算该层通过 |
| 净收益 | 没有匹配预算独立重复对照支持稳定任务净收益；Qwen通关目标未达 |

当前冻结候选是 **stage133**（197资产、记录时源码零漂移），最佳可恢复的历史GPT参考仍是 **stage90**；`best_verified_restorable_qwen=null`。不以最新版本代替“已验证最好”的结论。

下一建议仅是设计：在显式pure create＋assembly＋trial中，考虑对已授权、实际绑定且closed schema漏声明的字段机械补齐JSON根类型，减少caller参数与host数据的重复声明。**stage134尚未实现，也没有新的付费验收。** 此方案有额外host preparation成本，不能提前称零成本或已有效。

[延期项](../deferred-research-todos.md) B／C／D继续开放：研究结果到行动、跨压缩认知连续性、父子净收益，与本次失败直接相关。已有预算和接线修复不会将这些质量问题自动勾选完成。

## 5. 逐运行费用记录

下表动作／关卡是全运行结果，费用按上述48小时窗口；stage60部分费用不可当作其全运行成本。“未核定”不等于零。“保存帧诊断”的关卡不适用。它是账目附录，不是把所有诊断当作普通benchmark样本。

<!-- Derived inventory appended by the retrospective script output. -->

| 运行 | 请求模型 | 动作／关卡（全运行） | 窗口内已报告 tokens | 范围 |
| --- | --- | ---: | ---: | --- |
| [arc-evidence-effort-stage60-ordinary-gpt-ls20-20261004](../../runs/arc-evidence-effort-stage60-ordinary-gpt-ls20-20261004) | gpt-6.1-sol | 50／1 | 283,396 | ARC run；仅窗口内部分费用 |
| [arc-tool-semantic-stage61-gpt-ls20-20261004](../../runs/arc-tool-semantic-stage61-gpt-ls20-20261004) | gpt-6.1-sol | 0／0 | 73,567 | explicit ARC diagnostic |
| [arc-create-schema-stage63-tool-gpt-ls20-20261004](../../runs/arc-create-schema-stage63-tool-gpt-ls20-20261004) | gpt-6.1-sol | 0／0 | 62,731 | explicit ARC diagnostic |
| [arc-footprint-provider-stage66-gpt-20261004](../../runs/arc-footprint-provider-stage66-gpt-20261004) | gpt-6.1-sol | 0／不适用或未核定 | 43,275 | explicit saved-frame diagnostic |
| [arc-footprint-provider-stage68-gpt-20261004](../../runs/arc-footprint-provider-stage68-gpt-20261004) | gpt-6.1-sol | 0／不适用或未核定 | 48,193 | explicit saved-frame diagnostic |
| [arc-footprint-provider-stage70-gpt-20261004](../../runs/arc-footprint-provider-stage70-gpt-20261004) | gpt-6.1-sol | 0／不适用或未核定 | 48,595 | explicit saved-frame diagnostic |
| [arc-repeated-low-change-stage71-ordinary-gpt-ls20-20261004](../../runs/arc-repeated-low-change-stage71-ordinary-gpt-ls20-20261004) | gpt-6.1-sol | 21／0 | 504,178 | ARC run |
| [arc-stage74-ordinary-gpt-ls20-20261004](../../runs/arc-stage74-ordinary-gpt-ls20-20261004) | qwen3.8-27b | 未核定／不适用或未核定 | 31,701 | ARC run |
| [arc-stage74b-ordinary-gpt-ls20-20261004](../../runs/arc-stage74b-ordinary-gpt-ls20-20261004) | gpt-6.1-sol | 44／0 | 401,951 | ARC run |
| [arc-stage75-ordinary-gpt-ls20-20261004](../../runs/arc-stage75-ordinary-gpt-ls20-20261004) | gpt-6.1-sol | 19／0 | 258,616 | ARC run |
| [arc-stage78-ordinary-gpt-ls20-20261004](../../runs/arc-stage78-ordinary-gpt-ls20-20261004) | gpt-6.1-sol | 40／0 | 463,342 | ARC run |
| [arc-stage79-ordinary-gpt-ls20-20261004](../../runs/arc-stage79-ordinary-gpt-ls20-20261004) | gpt-6.1-sol | 50／0 | 267,146 | ARC run |
| [arc-stage80-ordinary-gpt-ls20-20261004](../../runs/arc-stage80-ordinary-gpt-ls20-20261004) | gpt-6.1-sol | 44／1 | 457,721 | ARC run |
| [arc-stage82-ordinary-gpt-ls20-20261004](../../runs/arc-stage82-ordinary-gpt-ls20-20261004) | gpt-6.1-sol | 47／0 | 604,088 | ARC run |
| [arc-stage86-repaired-real-gpt-ls20-20261004](../../runs/arc-stage86-repaired-real-gpt-ls20-20261004) | gpt-6.1-sol | 5／0 | 83,058 | ARC run |
| [arc-stage89-compact-real-gpt-ls20-20261005](../../runs/arc-stage89-compact-real-gpt-ls20-20261005) | gpt-6.1-sol | 42／0 | 415,273 | ARC run |
| [arc-stage90-offset-witness-real-gpt-ls20-20261005](../../runs/arc-stage90-offset-witness-real-gpt-ls20-20261005) | gpt-6.1-sol | 23／1 | 158,577 | ARC run |
| [arc-stage91-live-tool-diagnostic-real-gpt-ls20-20261005](../../runs/arc-stage91-live-tool-diagnostic-real-gpt-ls20-20261005) | gpt-6.1-sol | 3／0 | 102,452 | explicit ARC diagnostic |
| [arc-stage92-goal-first-tool-real-gpt-ls20-20261005](../../runs/arc-stage92-goal-first-tool-real-gpt-ls20-20261005) | gpt-6.1-sol | 50／0 | 354,358 | explicit ARC diagnostic |
| [arc-stage93-action-intent-real-gpt-ls20-60-20261005](../../runs/arc-stage93-action-intent-real-gpt-ls20-60-20261005) | gpt-6.1-sol | 52／0 | 405,178 | ARC run |
| [arc-stage94-discovery-high-real-gpt-ls20-60-20261005](../../runs/arc-stage94-discovery-high-real-gpt-ls20-60-20261005) | gpt-6.1-sol | 16／0 | 402,160 | ARC run |
| [arc-stage96-predictable-segment-real-gpt-ls20-60-20261005](../../runs/arc-stage96-predictable-segment-real-gpt-ls20-60-20261005) | gpt-6.1-sol | 41／0 | 406,290 | ARC run |
| [arc-stage97-entry-colors-real-gpt-ls20-60-20261005](../../runs/arc-stage97-entry-colors-real-gpt-ls20-60-20261005) | gpt-6.1-sol | 47／0 | 402,312 | ARC run |
| [arc-stage99-goal-predicate-real-gpt-ls20-60-20261005](../../runs/arc-stage99-goal-predicate-real-gpt-ls20-60-20261005) | gpt-6.1-sol | 44／0 | 410,783 | ARC run |
| [arc-stage100-anchored-pattern-real-gpt-ls20-60-20261005](../../runs/arc-stage100-anchored-pattern-real-gpt-ls20-60-20261005) | gpt-6.1-sol | 28／0 | 219,833 | ARC run |
| [arc-stage101-unchanged-placement-real-gpt-ls20-60-20261005](../../runs/arc-stage101-unchanged-placement-real-gpt-ls20-60-20261005) | gpt-6.1-sol | 43／0 | 404,637 | ARC run |
| [arc-stage102-goal-separation-real-gpt-ft09-60-20261005](../../runs/arc-stage102-goal-separation-real-gpt-ft09-60-20261005) | gpt-6.1-sol | 19／0 | 217,588 | ARC run |
| [arc-stage103-example-rule-real-gpt-ft09-60-20261005](../../runs/arc-stage103-example-rule-real-gpt-ft09-60-20261005) | gpt-6.1-sol | 19／0 | 233,526 | ARC run |
| [arc-stage104-guided-goal-real-gpt-ft09-60-20261005](../../runs/arc-stage104-guided-goal-real-gpt-ft09-60-20261005) | gpt-6.1-sol | 18／0 | 182,065 | ARC run |
| [arc-stage105-post-action-region-real-gpt-ft09-60-20261005](../../runs/arc-stage105-post-action-region-real-gpt-ft09-60-20261005) | gpt-6.1-sol | 11／0 | 227,621 | ARC run |
| [arc-stage107-stable-allocation-real-gpt-ls20-60-20261005](../../runs/arc-stage107-stable-allocation-real-gpt-ls20-60-20261005) | gpt-6.1-sol | 60／0 | 227,913 | ARC run |
| [arc-stage108-current-template-real-gpt-ls20-60-20261005](../../runs/arc-stage108-current-template-real-gpt-ls20-60-20261005) | gpt-6.1-sol | 35／0 | 310,417 | ARC run |
| [arc-stage110-guided-goal-real-gpt-ls20-60-20261005](../../runs/arc-stage110-guided-goal-real-gpt-ls20-60-20261005) | gpt-6.1-sol | 24／0 | 300,663 | ARC run |
| [arc-stage111-small-regions-real-gpt-ls20-60-20261005](../../runs/arc-stage111-small-regions-real-gpt-ls20-60-20261005) | gpt-6.1-sol | 43／0 | 303,812 | ARC run |
| [arc-stage112-geometry-reasoning-real-gpt-ls20-60-20261005](../../runs/arc-stage112-geometry-reasoning-real-gpt-ls20-60-20261005) | gpt-6.1-sol | 41／0 | 262,739 | ARC run |
| [arc-stage113-baseline-replication-real-gpt-ls20-60-20261005](../../runs/arc-stage113-baseline-replication-real-gpt-ls20-60-20261005) | gpt-6.1-sol | 1／0 | 6,342 | ARC run |
| [arc-stage113b-baseline-direct-real-gpt-ls20-60-20261005](../../runs/arc-stage113b-baseline-direct-real-gpt-ls20-60-20261005) | gpt-6.1-sol | 14／0 | 108,798 | ARC run |
| [arc-stage114-state-recall-real-gpt-ls20-60-20261005](../../runs/arc-stage114-state-recall-real-gpt-ls20-60-20261005) | gpt-6.1-sol | 8／0 | 107,690 | ARC run |
| [arc-stage117-qwen-baseline-ft09-60-20261006](../../runs/arc-stage117-qwen-baseline-ft09-60-20261006) | qwen3.8-27b | 1／0 | 23,466 | ARC run |
| [arc-stage118r1-qwen-completed-history-ft09-60-20261006](../../runs/arc-stage118r1-qwen-completed-history-ft09-60-20261006) | qwen3.8-27b | 2／0 | 82,187 | ARC run |
| [arc-stage120-qwen-start-baseline-ft09-20261006](../../runs/arc-stage120-qwen-start-baseline-ft09-20261006) | qwen3.8-27b | 0／0 | 19,135 | ARC run |
| [arc-stage120-qwen-start-deferred-ft09-20261006](../../runs/arc-stage120-qwen-start-deferred-ft09-20261006) | qwen3.8-27b | 1／0 | 50,367 | ARC run |
| [arc-stage122r1-qwen-interface-ft09-20261006](../../runs/arc-stage122r1-qwen-interface-ft09-20261006) | qwen3.8-27b | 1／0 | 11,178 | ARC run |
| [arc-stage123r1-qwen-feedback-ft09-20261006](../../runs/arc-stage123r1-qwen-feedback-ft09-20261006) | qwen3.8-27b | 1／0 | 36,460 | ARC run |
| [arc-stage124-qwen-length-recovery-ft09-20261006](../../runs/arc-stage124-qwen-length-recovery-ft09-20261006) | qwen3.8-27b | 1／0 | 45,270 | ARC run |
| [arc-stage125-qwen-budget-allocation-ft09-20261006](../../runs/arc-stage125-qwen-budget-allocation-ft09-20261006) | qwen3.8-27b | 2／0 | 41,069 | ARC run |
| [arc-stage126-qwen-keyframe-patch-ft09-20261006](../../runs/arc-stage126-qwen-keyframe-patch-ft09-20261006) | qwen3.8-27b | 1／0 | 53,429 | ARC run |
| [arc-stage128-qwen-static-contract-ft09-20261006](../../runs/arc-stage128-qwen-static-contract-ft09-20261006) | qwen3.8-27b | 2／0 | 50,085 | ARC run |
| [arc-stage130-qwen-compute-provider-20261006](../../tmp/arc-stage130-qwen-compute-provider-20261006) | qwen3.8-27b | 0／0 | 16,469 | explicit native diagnostic |
| [arc-stage133-qwen-compute-provider-20261006](../../tmp/arc-stage133-qwen-compute-provider-20261006) | qwen3.8-27b | 0／0 | 27,017 | explicit native diagnostic |
| [results.json](../../tmp/arc-stage114-decision-probe/results.json) | gpt-6.1-sol | 不适用 | 22,031 | decision-point probe |
| [arc-stage113-provider-probe.json](../../tmp/arc-stage113-provider-probe.json) | gpt-6.1-sol | 不适用 | 15 | connectivity probe |
| [arc-stage129-retirement-audit.json](../../tmp/arc-stage129-retirement-audit.json) | qwen3.8-27b | 不适用 | 8,908 | coordinate representation probe |
