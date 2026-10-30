# Self-Harness 开发设计方案（Charter）

> 权威交互版：[Self-Harness 开发设计方案](https://cursor.com/canvas/store-8893191a-ab9c-47ae-b7b4-2879ba51529a/7694319b-bb75-49f4-9a38-af5eec1a77b3)  
> 发布：2026-10-31 Asia/Shanghai · 编码管理 · 约束后续 Solo / Luna / AZ 与编码管理迭代  
> 修订：2026-10-31 ~00:42 · workspace 不得成封闭独立空间（透明沙盒/容器）

## 北极星

给 agent **短路径与干净上下文**，让它**自主**做有功能语义的沉淀与复用；**runner 只触发与接住**，不替它判断、不堆脆弱中间层。

要验的是 **沉淀 → 复用 → 推进任务** 是否通，不是造了多少基础设施函数。

## 七条原则

1. **Agent-native** — 提供接口与证据；agent 决定是否沉淀、沉淀什么、落到哪类 component；遍历类别。反对机械强制首次沉淀。
2. **独立 Hook + 干净窗** — 动作回执后独立沉淀 turn；窗=上次沉淀→现在（无则 task start）；摘要+薄索引+按需 read；全文落盘不塞 hook。
3. **短转化 · 零勘探捷径** — 已见函数直接 `write tools/<name>.py` 或 `promote(name)`；禁格式/匹配/协议中间层；Git commit message 作开放摘要；runner 不加脆弱校验。
4. **Workspace = 透明沙盒 / 组件车间** — workspace 只作容器与底层基建（稳定服务），**不是** agent 的封闭独立空间；agent 应对 workspace 边界无感，「works with」不可变成额外勘探/生成开销与瓶颈。产出用 Git 短路径挂载；把内容当可试用工具库；造码即剥离硬编码/活变量与可复用逻辑。
5. **沉淀要对解题有用** — skills / tools / strategies；重复→模式→component；一次性可 Skip，重复可参数化探针应标候选。
6. **高行动密度** — 优先 `arc_action` 批多步；留 Response/本地链；反对 Python 造码占满决策回合。
7. **分模块 · 最小链路优先** — 核心链路悬空时禁堆上层；Daemon 可后台触发但不强约束；Binder 重校验后置。

## 硬性规则

| 要做 | 不要做 |
|------|--------|
| 单因子刀 | 强制每次造码沉淀 |
| 方案→落地→AZ 证伪 | 任务 turn 混沉淀判断 |
| prefer Save/promote，不强制 | 脆弱协议中间层 |
| 负例诚实 Skip | 一律 Skip 可参数化重复探针 |
| 禁 push 除非点名 | 核心链路未通堆上层 |
| workspace 透明基建 | 把 workspace 做成封闭独立空间 / 强迫 agent 感知边界 |

### Hook 应遍历的类别

- tool → `tools/<name>.py` / promote  
- skill → skills/ + 版本  
- strategy → strategies/ 或 memory  
- prompt → 直接写文件 + Git  
- memory → 有语义的 memory set  

## 设计—研发—迭代环

1. **取证** — 主断点一句（有证据）+ 对照原则编号  
2. **Solo** — gpt-6-sol 只写 PLAN（断点/主刀/证伪/兼容/非目标）  
3. **Luna** — 最小落地；绝对路径读 JOB；pytest+smoke；禁自开 AZ/push  
4. **AZ** — 四层验收；未过则回取证，勿平行堆刀  
5. **归档** — RUN*.md + life-hub + Notion + journal  

**选型启发式：** 候选空→对齐投影/族；候选有但全 Skip→调偏置（如 SAVE-NUDGE），勿再只加匹配；有 tool 无复用→试用闭环/afc；动作稀→批动作与 hook 预算。

## 验收双门槛

- **A** levels_completed ≥ 1  
- **B** 至少一类 component 真实落盘并被复用（tools 非空 / saved≥1 / afc≥1 等）  
- 只通关或只造码都不算；诚实记分母不足  

四层：L1 结果 → L2 候选/沉淀 → L3 hook/reuse → L4 断点与下一刀。

## Agent 开工检查单

- [ ] PLAN 写明对照的原则编号  
- [ ] 主断点有 run 证据  
- [ ] 单因子；非目标含强制沉淀/脆弱协议/并行堆刀  
- [ ] 转化路径 write/promote/Git，无新协议  
- [ ] workspace 只作沙盒基建，不引入封闭空间或额外勘探负担  
- [ ] Hook 独立；任务 turn 不混沉淀  
- [ ] 证伪可观测  
- [ ] 禁 push（除非点名）；禁未授权 AZ  

冲突时：以本方案 + George 当日点名授权为准；goal-admission routine 不扩主会话 scope。
