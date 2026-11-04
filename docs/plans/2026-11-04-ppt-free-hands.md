# Meta-harness 变更记录：PPT 自由手脚（剔除人为限制，释放 agent）

日期：2026-11-04（Asia/Shanghai）。状态：实现（免费功能/回归检查完成；provider 行为与收益未验证）。
分支 `claude/ppt-free-hands-20261104`，worktree `D:\autoresearch_pi_project\worktrees\ppt-free-hands`，
基线 = 快照提交 9383dafb（Codex 在 adapt-config 的未提交 PPT 工作状态，`codex/ppt-native-production-demo`@97970122）。

## 问题与命题

- 真实失败/机会及材料：
  - 用户 2026-11-04 的审计请求确认了约 30 处人为限制（记忆 `artificial-limits-audit-20261104`）：文本-only/PNG-only 媒体、
    只读 subagent、path-regex 组件类型、强制 frontmatter、quality-map 门禁、render 自动 checks/coverage review、
    delivery gate、`dimension_ids` 强制、固定 batch、brief 的格式禁令、ARC 遗留骨架等。
  - 具体现象：PPT 任务无法生成/读取图片（renderer 只认 `data/` 下的 png/jpeg，guest `open('wb')` 被拒），
    交付只复制 `presentation.html` 一个文件，导致相对资源全部失效。
  - 观察与推测分开：以上限制均见于当前代码（快照 9383dafb）；"限制抑制了 agent 的产出质量与沉淀" 是推测，需真实 run 验证。
- 窄命题：在 PPT 生产任务上，把非边界的人为限制（媒体类型、组件形状、预设质量工作流、格式禁令）剔除后，
  agent 能自主生成多类型产物（含二进制图片）、自主创建各类组件（无 map 前置）、按自己的 workflow 交付，
  且不损失任何硬边界（路径约束、data/results 只读、预算/期限、WASI 沙箱、交付源一致性、agent-native 模型）。
- 减少的负担：agent 不再需要绕开 text-only 写入（base64 手工往返）、不再被 quality map 门禁挡住组件创建与交付、
  不再被 render 自动 checks/review 消耗 provider 请求与预算、brief 不再强迫单一表达形式。
- 适用条件：PPT host（`demo/ppt_demo_extension.ts`）与共享 core（workspace/components/binder/native_runtime）。
  合理不使用条件：ARC thin/native 路径的既有行为——本次共享 core 改动对 ARC 有意保持兼容（见下），
  但 ARC 的 run 级验证不在本次范围。推翻条件：任何硬边界失效（越权写入、data/results 可写、沙箱逃逸、预算不生效）。
- 范围及非目标：本次授权工作 = 用户 "帮我优化（基于最新的 ppt 分支），尽量剔除限制，为 agent 释放手脚"。
  非目标：不重写质量机制（用户已否决预设 workflow，也否决了 quality-led 方案照单实现）；不新增机制；不启动付费 run。

## 设计与成本

- 选择与取舍：
  - **剔除而非放宽**：预设质量工作流（map 门禁、自动 checks、coverage review、delivery gate、dimension_ids、
    componentGuide、配额行）整体删除，而不是加开关。理由：用户明确 "上层的 workflow 也应该被归纳为 harness engineering"，
    预设 workflow 违背 self-harness；保留开关等于保留常驻义务。
  - **硬边界全部保留**：路径约束与链接拒绝、`data/`+`results/` 只读、预算/期限/provider 授权、WASI 沙箱
    （无宿主文件系统/网络）、交付源一致性（rendered source == canonical source，且 revision 为最新）、
    in-run 模型 agent-native、开发文档不进 agent 上下文。
  - **通用而非按类型白名单**：二进制按内容判定（NUL 字节），图片 MIME 用 Pi 自己的检测器
    （jpg/png/gif/webp/bmp，按内容而非后缀）；组件 entry 增加 main/handler 但不限定形状；frontmatter 变为可选
    （默认值），只保留 "prompt 的 active 必须是 true/false" 这类值域校验。
  - **subagent 只排除 arc_action**：原先禁 write/edit/memory/refine/consult；现在只禁环境动作（ARC work-memory 边界），
    文件写入与记忆是 subagent 自己的决定，与父一致。
  - **program 可写 harness 目录**：`applyWrites` 的 tools|lib|observers|skills|agents|roles|prompts 禁令移除；
    写入仍经 Binder 版本化，失败绑定仍报告。
- 生命周期：无新增转移。删除的转移：render→自动 checks、render→coverage review、deliver→map/维度/coverage 门禁。
  保留的转移：写文件→Binder 版本化→receipt；render→证据落盘 `results/renders/vNNN/`；deliver→复制整个渲染修订。
- 首次获益路径：agent 用 `python`（新暴露）或 program 直接 `open(...,'wb')` 生成图片 → render 把相对资源一并渲染 →
  look/deliver 得到完整交付。无需先建 quality map。
- 新增与移除：
  - 新增：guest 二进制 IO（base64 传输）、snapshot 携带 binaries、pathlib/io.open patch、ad-hoc `python` 工具暴露、
    Workspace `dirs` 选项（PPT 不再有 `data/frames`、`config`）、render 在源目录旁渲染（相对资源可用）、
    delivery 复制整个渲染修订、`main`/`handler` entry，以及一行**事实面**：`office(render/deliver)` 的返回与每轮
    `statusText()` 报 "Since render vN: X program runs, Y consults, Z artifact writes; current revision checked: yes/no"。
    事实面不是指令、不是门禁：agent 仍自己决定是否检查；它只把"当前修订有没有被检查过"从不可见变成可见，
    并给 adoption 测量一个动作点（shown → acted → changed）。计数只来自既有日志回调
    （`component_runs.jsonl` 的 `program_call`、`consult_runs.jsonl`、`artifacts/` 写入）。
  - 移除：quality map 及其门禁、自动 checks/coverage review、硬编码 reviewer 问题、dimension_ids 要求、
    componentGuide/配额提示、file tool 的 tools|lib 写入禁令、render 只认 1..30 slide/7 种 element/`data/` 图片、
    delivery 只复制一个文件、强制只读 ADAPT（`hookTurn` 恒 false）、compaction/retry 禁用、300s idle（→900s）、
    brief 的格式禁令、`ppt_demo_agents.md` 的五类配额行。
  - 常驻提示：`statusText()` 保留但只报事实（canonical source、上次 render、预算/剩余时间），不再有
    "consider a prompt/skill/tool" 一类引导。
- 权限/版本/环境边界：预算守卫（`before_provider_request` 与 consult 的 `modelResult`）不变；
  `PPT_DEMO_DEADLINE`/`PPT_DEMO_BUDGET_USD` 生效入口不变；Workspace `path()` 的约束与链接拒绝不变；
  guest 仍无宿主目录 preopen；Binder 版本化仍是唯一 harness 写入路径。
- 放弃与恢复：预算/期限触顶即 `process.exit(0)`（原有行为）。传输上限提高（input 4MB / output 1MB / stdin 8MB）
  是本次唯一的资源放宽；若真实 run 显示成本失控，回退这三个常量即可，不影响其它改动。

## 运行前实验协议

- 目标证据层级：本次只主张 **功能正确**（免费 node 测试）与 **全链路可达**（PPT 测试用真实 Edge 渲染）。
  自主采用与净收益需要真实 provider run，未获预算，未运行。
- 主要变量与比较器：快照 9383dafb（Codex 未提交状态）→ 本分支。其余差异：无（同一 worktree，仅本次编辑）。
- 模型/provider/推理配置、任务和初态：免费测试不用 provider；PPT 集成测试用本机 Edge headless + PIL。
  真实 run 待用户授权预算后再定（模型/provider/thinking 均需明确）。
- 独立样本与运行顺序：node 测试串行（`--test-concurrency=1`），每次全新 mkdtemp root。
- 总预算与停止规则：免费；无付费 run。PPT 集成测试自身 timeout 240s。
- 主要指标与判定标准：全部 node 测试通过；PPT 测试覆盖二进制写回、任意 entry、无 frontmatter 组件、
  非只读 ADAPT、render 无门禁、delivery 无门禁且拒绝陈旧渲染、consult 任意图片类型。
- 负例：陈旧渲染交付被拒；只读 call 不能 act；无效 frontmatter 值仍失败并回退上一版；`data/`/`results/` 仍只读；
  越界路径仍被拒。
- 遥测及材料：测试日志在 `worktrees/r04/tmp/ppt-free-hands/*.log`；渲染产物在测试打印的临时目录。

## 实现与验证

- 改动入口及实际行为：
  - `demo/arc_thin_workspace.ts`：`dirs` 选项；`readBytes`/`isBinary`；`runtimeWrite` 真正支持 `Uint8Array`；
    read 工具用 Pi 的 `detectSupportedImageMimeTypeFromFile`；grep 按 NUL 字节跳过二进制（不再按 `.png` 后缀）。
  - `demo/arc_thin_components.ts`（guest）：`_binaries` 通道（base64）；`open(...,'rb'/'wb')` 真字节；
    `_BinaryWriter` 以 `encoding:'base64'` 上报 write op；`_remove`/`_rename`/`_names` 认二进制；
    `io.open` 与 `pathlib.Path`（open/read_text/read_bytes/write_text/write_bytes/exists/is_file/is_dir/iterdir）
    走同一受限后端；entry 接受 `main`/`handler`；`_call` 按首参名适配；`_reads_args` 用实际 entry；
    `NATIVE_LIMITS` input 4MB / output 1MB。
  - `demo/arc_thin_skill_guest.ts`：`SKILL_LIMITS.output_bytes` 64K → 1MB。
  - `demo/pi_task_python.ts`：`HARD_LIMITS` input 512K→4MB、output 256K→1MB（传输上限，不是沙箱上限；
    memory/fuel/timeout/allocation 不变）。
  - `demo/pi_task_python_runtime.py`：stdin 上限 1MB → 8MB（否则提高 input_bytes 无意义）。
  - `demo/arc_thin_native_runtime.ts`：snapshot 输出 `binaries`（base64，任意类型）；`execute`/`executeKernel`
    的懒取文件与 need_file 回放区分 text/binary；`applyWrites` 去掉 harness 目录禁令并支持 base64 write；
    `callable()` 用 `candidates()`（决策内保存/删除立即可见，与 r04 一致）；consult refs 用 Pi 检测器认任意图片类型，
    subagent 可获 read/write/edit/ls/grep/python/命名工具（只禁 `arc_action`）；`saveProgram`/`saveTool` 名字与
    描述规则放宽；`toolSource` 不再强制 `run(args, env)` 形状。
  - `demo/arc_thin_binder.ts`：frontmatter 可选（默认：prompt active、description 取首行、skill 名同目录）；
    只校验值域；subagent 只禁 `arc_action`。
  - `demo/ppt_demo_extension.ts`：整体重写为 free-hands 版（见 "新增与移除"）；Workspace 用 PPT 自己的 `dirs`；
    暴露 `python`；`office` render/look/deliver 去门禁；delivery 复制整个渲染修订（跳过 browser-profile）；
    `hookTurn` 恒 false；`setActiveTools` 与已注册工具取并集（agent 创建的 tool 跨 batch 保留）；
    `evidence` 计数与 `evidenceLine()` 事实行（render 返回报上一周期的检查事实，随后重置；deliver 返回同样附上）。
  - `src/autoresearch_pi/ppt_demo_html.py`：slide 数只要求 ≥1；element kind 不再白名单（未知 kind 可带 `html` 原文）；
    图片可来自 workspace 任意路径，MIME 按内容检测；在源目录旁 `render/` 渲染（相对资源可用），
    原件不被改写；viewport 与 JS 时间预算可用环境变量覆盖（默认 1600,900 / 10000ms）；截图 timeout 30→60s。
  - `src/autoresearch_pi/ppt_demo.py`：不再禁用 compaction/retry；idle timeout 300→900s；ENVIRONMENT 文本改为
    描述事实与可用能力（含二进制/图片/相对资源），不再规定单一形式。
  - brief（JPM/BofA）：去掉 "do not deliver a PowerPoint file" 与 "keep ... as native HTML/SVG" 的强制，
    改为 "选择最服务于受众与材料的形式"，native HTML/SVG 只在 "需要可检视/可编辑时" 优先。
  - `demo/prompts/ppt_demo_agents.md`：删除五类组件配额段。
- 功能/相关回归检查（免费，checkout 根 `worktrees/ppt-free-hands`）：
  - `node --experimental-transform-types --test --test-concurrency=1 --test-force-exit tests/ppt_demo.test.ts`
    → 2/2 通过（含真实 Edge 渲染 3 页 + 二进制图片元素 + 无门禁交付 + 跨进程重载 program + 事实行断言：
    首次 render 报上一周期计数，v1→v2 之间 1 次 consult 被计入，deliver 附当前周期计数）。
  - 同命令跑 `tests/arc_thin_{workspace,binder,components,native_runtime}.test.ts` → 22/22 通过。
  - 同命令跑 `tests/arc_thin_{activation,kernel,python_session,work_memory,promotion,boundary}.test.ts` → 见最终日志。
  - 快照对照：在 9383dafb 的独立 worktree 跑 `arc_thin_activation.test.ts`，同样 2 项失败
    （`Use save_tool(name, body) or promote(name) for harness changes.` 与 receipt 前缀差异），
    证明这两处失败是快照自身与 r04 测试的漂移，不是本次改动引入。
  - 测试期望的更新（均为断言与新行为对齐，不是放宽断言）：binder 版本/回退用例改为 "无 frontmatter 可绑定、
    非法 active 值仍失败"；USE-CHANNEL 改为 "每个保存的 tool 都可调用，schema 报告哪些能 act"；
    AGENT-RUNTIME-IFACE 改为 "tool 内容不再被形状门禁拒绝"；activation 改为 "未保存的父 python 也能 act，
    只读 call 不能 act"，参数断言不再固定 description 文案。
- 机会漏斗与断点：不适用（本次不新增机会机制，反而删除了自动触发的 checks/review）。
- 语义与连续性：PPT 测试断言了 consult 把渲染页 PNG 作为 image 送入、reasoning 继承 `high`；
  fresh-batch 的 handoff 消息仍带 memory/harness index/statusText（现在只是事实）。压缩前后反证：未测（需真实 run）。
- 成本与任务结果：无付费 run。传输上限提高可能增加单次 WASI 输入体积（二进制以 base64 进入），
  这是刻意取舍；`snapshot_read_bytes` 遥测可用于真实 run 时核对。
- 协议偏离：无。未启动任何 provider run。

| 证据层级 | 状态 | Provider / environment | 产物及结论边界 |
| --- | --- | --- | --- |
| 功能正确 | 已验证（免费 node 测试） | 本机 node 22 + wasmtime 49 / CPython 3.12 WASI；Edge headless | `worktrees/r04/tmp/ppt-free-hands/*.log`；只证明函数与接线，不证明模型行为 |
| 全链路可达 | 部分验证 | 同上（PPT 集成测试走真实 Edge 渲染与 PIL 拼图） | render→证据落盘→look→deliver→重载 program 全链在测试内走通；未含 provider 决策 |
| 自主采用 | 未验证 | 待真实 provider run（需用户授权预算） | agent 是否真的生成图片/创建多类组件/自设 workflow，未知 |
| 净收益 | 未验证 | 同上 | 质量与成本对比缺失；不得声称有效 |

## 交付决定

- 已支持的声明：限制已按上述清单剔除；硬边界保留；免费功能与接线检查通过。
  未支持的声明：任何关于 agent 实际行为、采用率、质量或成本的结论。
- 决定与依据：保留改动在 `claude/ppt-free-hands-20261104`（未提交，除快照提交 9383dafb）。
  下一因素 = 一次真实 PPT run，看 agent 在无人预设 workflow 下是否自发建立质量闭环并沉淀组件。
- 剩余验证与下一可证伪检查：需要用户授权预算（每次 run 的 token/美元上限须先声明）。建议首个检查：
  同一 case（JPM）在新分支与快照各跑一次，比较交付完整度（相对资源是否可用、是否出现非文本产物）、
  组件沉淀（种类与是否被后续调用）、provider 请求数与花费。
- 关联 backlog：
  - `docs/deferred-research-todos.md` A（adapter 边界）：本次把 "组件形状/媒体类型" 从 adapter 约束中移除，属该清单方向；
    B/C（sub-agent 与父子通信）：subagent 现在可写文件，父子交付面变化未验证；
    D（上下文压缩）：重新启用 compaction 后 fresh-batch 与压缩的交互未验证。
  - 记忆 `artificial-limits-audit-20261104` 的清单：本次实现其中 PPT 相关全部项 + 共享 core 的媒体/执行/组件项；
    未实现：ARC 特有的 grid env、0..63 坐标钳制、`LONG_LINE_CHARS`（保留，属回执可读性而非能力限制）。
  - 分支纪律（记忆 `one-branch-r04`）：本次新开侧分支，需用户决定是否折回 r04 或独立保留。
