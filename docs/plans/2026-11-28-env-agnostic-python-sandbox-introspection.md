# Meta-harness 开发方案：环境无关的只读 Python 沙盒、运行时自动类型自省与自解释异常闭环

日期：2026-11-28（Asia/Shanghai）。状态：设计（待 Codex 实施；基线 commit `fdcc815`）。
按 [开发流程](../development-workflow.md) 与 [变更模板](../templates/meta-harness-change.md) 编写；关联 [2026-11-28 完整性修复记录](../reports/2026-11-28-layered-integrity-fixes.md) 与 [延后待办 B/C/D](../deferred-research-todos.md)。

---

## 一、问题与命题

### 1. 真实失败及材料（来自 `fdcc815` 前 5 局运行与代码审阅）
- **产物来源**：`D:\layered-harness\runs\arc-gpt6sol-low-harness-integrity-5x-20261128`（`su15`、`ls20`）及上一批 5 局 `arc-gpt6sol-low-harness-default-5x-20261128`（`gpt-6-sol low`，`ARC_LAYERED_EVOLUTION=1`）。
- **观察到的共性断点**：
  1. **手工白名单 Python 阉割导致合法代码批量报错**：`su15`（s129, s193）与 `ls20`（s138, s203, s223, s236, s349）共 7 次演化因 `trial_at` 缺少 `__import__`、标准内置函数（`hasattr` at `ls20` s138、`map` at `ls20` s236）直接失败；`fdcc815` 临时改用手写 `_TRIAL_SAFE_MODULES` 和内置函数枚举表缓解，但本质仍依赖枚举，换到非 ARC 环境（如 ScienceWorld / Terminal-Bench）或模型用到其他纯计算标准库/内置函数时必然继续撞墙。
  2. **靠手写 Prompt 猜运行时对象结构导致的跨环境 `AttributeError`**：
     - `ls20` s203 r3、s223 r3、s349 r3 连续 3 次在构造前沿工具时将 `frame.grid` 当成 numpy 数组调用 `.tobytes()`，报 `AttributeError: 'list' object has no attribute 'tobytes'`，直接导致 3 轮演化全以 `incomplete` 作废；
     - `su15` s57 r3 与 `ft09` s205 在编写 `Memory.verify` 时将 `t.action`（`str`）当成 `dict` 调用 `.get(...)`，报 `AttributeError: 'str' object has no attribute 'get'`；
     - `ar25` s217 将布尔比较当成 numpy 数组调用 `.all()`，报 `AttributeError: 'bool' object has no attribute 'all'`。
  3. **Round 1 盲探类型 + 小错即废掉整轮（3 轮耗尽）**：`ls20` 9 轮 evolution 中 5 轮（`s138, s203, s223, s236, s349`）在 Round 1 先用 `python_inspect` 打印 `type(...)` / 字段名，Round 2–3 写 `@tool` 遇到 1 次属性/导入报错即耗尽 `maxRounds=3`，最终 `decision="incomplete"` 零产出结束。
  4. **工具建议未采用（`repeat_mismatch`）未进入反馈面板**：`ls20` s302 记录到 `branch_handoff.repeat_mismatch=True`（`orange_frontier` 建议 `LEFT`，父 Agent 忽略并重复 `DOWN`），但 [demo/arc_layered_extension.ts](../../demo/arc_layered_extension.ts) 的 `dualAudit` `Component use` 未统计并展示 `repeat_mismatch`，导致后续审计看不到交接断点。

### 2. 窄命题
将当前依赖枚举补丁和手写类型说明的进化执行环境，替换为四项**零环境先验**的运行时机制：
1. **基于副作用隔离（Capability-based）的只读沙盒**：保留完整标准 Python 纯计算内置能力，仅按副作用能力拦截危险模块与写/动原语，并将前缀构造拆出为环境可替换钩子；
2. **自动运行时类型自省卡（Auto-Introspected Type Card）**：由 Python 内核自动内省当前活跃绑定对象真实结构与容器元素类型，随正常调用回执零额外 IPC 往返同步至 Evolution Dossier；
3. **自解释异常回执（Introspective Error Diagnostics）**：`AttributeError` / `NameError` / `TypeError` 在 `_cell` 与 `_judge_memory` 中自动附带 1 行基于真实运行时对象/作用域的客观自省提示；
4. **有界自修复轮（`3 + 1`）与 `repeat_mismatch` 漏斗透传**：仅当演化轮发生 `turnHadError` 且剩余时间充裕时授予最多 +1 轮修复收口，同时将 `repeat_mismatch` 计数客观呈现给 Evolution。

预期在保持只读与无前瞻安全边界的前提下，省去模型 Round 1 类型试探往返，使任意环境（含非 ARC 环境）下的首次类型/属性误判能在当轮内自愈，减少 `incomplete` 空转。

### 3. 减少的负担
- **消除开发者的“打地鼠”维护负担**：不再需要按报错逐个向 `_TRIAL_SAFE_MODULES`、内置白名单或 System Prompt 手动补函数/属性说明。
- **消除 Evolution Round 1 类型探测负担**：模型不再需要每轮先 `print(type(transitions), dir(current_frame))`，首轮即可直奔建模/工具编写。
- **降低小错误导致整轮作废的概率**：`AttributeError` / `NameError` 当场给出真实属性/作用域清单 + 有界 +1 修复轮，避免 1 次笔误烧毁前面投入的思考轮次。

### 4. 适用条件、合理不使用条件与推翻条件
- **适用条件**：所有启用 `ARC_LAYERED_PROFILE=qwen27b-harness` 的运行及未来挂载新环境适配器的 layered 运行。
- **合理不使用条件**：演化轮未遇到工具报错（`turnHadError === false`）时不得触发 +1 修复轮（仍严格受 `maxRounds=3` 约束）；`repeat_mismatch == 0` 时不在 `Component use` 额外占字；静态类型检查通过时异常自省不触发。
- **推翻条件**：
  - 安全推翻：放开纯计算 builtins 后出现逃逸副作用（写入 `work/` 外文件、触发动作、读取未来帧或修改 `_H/_T/_S`）；
  - 效率推翻：类型卡或异常自省显著增加 Dossier 长度却未在真实运行中减少 `trial_at` / `verify` 类型类报错或 `incomplete` 比率；
  - 成本推翻：+1 修复轮在错误频发时显著拉高超时率或父子总 token 而无组件产出/使用改善。

### 5. 范围及非目标
- **改动范围**：
  - [demo/arc_layered_prelude.py](../../demo/arc_layered_prelude.py)
  - [demo/arc_layered_python.ts](../../demo/arc_layered_python.ts)
  - [demo/arc_layered_extension.ts](../../demo/arc_layered_extension.ts)
  - [tests/arc_layered_python.test.ts](../../tests/arc_layered_python.test.ts)
  - [tests/arc_layered_extension.test.ts](../../tests/arc_layered_extension.test.ts)
- **明确非目标**：
  - **禁止**在公共机制（沙盒拦截表、类型自省器、异常自省器、修复轮逻辑）中硬编码任何 ARC 专属字段（如 `grid`、`segmentation`、`level`、`MOUSE`、`COLOR_LEGEND`）；
  - 不修改 `arc_action` 接口、不动冻结路径（`demo/pi_arc_agi_3_extension.ts`、`demo/arc_thin_*.ts`）；
  - 不新增 LLM worker 或自动改写任务决策，不向父任务常驻 System Prompt 注入重型契约。

---

## 二、详细技术设计与 Codex 实施规格

### 模块 A：基于副作用隔离（Capability-Based）的只读沙盒（`demo/arc_layered_prelude.py`）

**边界澄清（用户，2026-11-28）：** `trial_at` 是防误用的语义护栏，目标是避免前瞻、环境动作、写盘和对实时状态的直接篡改；它不是抵御恶意 Python 的 OS 级沙盒。原生 CPython 的对象及标准库可以间接暴露未受过滤的能力。需要对不可信恶意代码强制隔离时，应由外层容器或 WASI 等执行边界提供，而不能依赖本进程的内置函数或模块过滤。

替换 `fdcc815` 中手工枚举 40 个内置函数与 `_TRIAL_SAFE_MODULES` 白名单的做法，改为**默认允许纯计算 Python、显式拦截副作用能力**：

1. **常量定义**（替换 `_TRIAL_SAFE_MODULES`）：
   - `_TRIAL_BLOCKED_BUILTINS = frozenset({"open", "exec", "eval", "compile", "input", "breakpoint", "__import__", "globals", "locals", "vars", "dir", "exit", "quit", "help"})`
     - 说明：屏蔽逃逸、动态执行、文件句柄与反射篡改内建原语；其余所有 `vars(builtins)` 中的标准纯计算函数、类型与异常（`map`, `filter`, `hasattr`, `getattr`, `round`, `zip`, `any`, `all`, `enumerate`, `sorted`, `ValueError`, `KeyError` 等）自动可用，无需维护清单。
   - `_TRIAL_BLOCKED_MODULES = frozenset({`
     `"os", "sys", "subprocess", "shutil", "pathlib", "io", "socket", "http", "urllib",`
     `"ftplib", "smtplib", "ssl", "ctypes", "multiprocessing", "threading", "concurrent",`
     `"signal", "tempfile", "glob", "importlib", "builtins", "gc", "inspect", "traceback",`
     `"pickle", "marshal", "shelve", "sqlite3", "webbrowser", "venv", "ensurepip", "pip",`
     `"pty", "fcntl", "resource", "mmap", "posix", "nt", "_io", "_osx_support", "_winapi",`
     `"winreg", "msvcrt", "termios", "syslog", "curses", "linecache", "code", "codeop"`
     `})`
   - 同时保留阻止导入用户/内核可变模块：`work`、`lib`、以及任何相对导入（`level != 0`）。
2. **`_trial_import(name, globals=None, locals=None, fromlist=(), level=0)`**：
   - 计算 `root_mod = str(name or "").split(".")[0]`；
   - 若 `level != 0`、`not root_mod`、`root_mod in _TRIAL_BLOCKED_MODULES`、或 `root_mod in ("work", "lib")`、或 `name.startswith("work.")`：抛出 `ImportError("module %r is blocked in read-only trial_at" % (name,))`；
   - 否则调用 `builtins.__import__(name, globals, locals, fromlist, level)`；并对 `fromlist` 中可能出现的被禁用子模块名做同样校验。
3. **拆出环境可替换的前缀构建接口**：
   - 将前缀状态构建抽为 `_build_trial_globals(k)`（负责基于 `_H[:k+1]` 与 `_T[:k]` 构造只读视图）；
   - 将通用执行沙盒抽为 `_run_readonly_trial(fn, prefix_globals)`：
     - 校验 `fn` 可解包为 `types.FunctionType`（支持 `_CallableToolModule` 与 `__wrapped__`）且无闭包包捕获（`fn.__closure__` / `__defaults__` / `__kwdefaults__`）；
     - 从 `vars(builtins)` 构造 `safe_builtins`（跳过 `_TRIAL_BLOCKED_BUILTINS` 与 `_` 开头内部名），写入 `safe_builtins["__import__"] = _trial_import`；
     - 安全透传 `fn.__globals__` 中通过模块级 `import` 绑定的纯标准库对象：
       - 若 key 不在 `names`、不是 `"__builtins__"`、不在 `_LIVE_KEYS`、且非 `_CallableToolModule`：
         - 如果是 `types.ModuleType`，要求其顶层模块名不在 `_TRIAL_BLOCKED_MODULES` 且不为 `"__main__"` / `"builtins"` / `"work"` / `"lib"`；
         - 如果是 `type` 或 `callable`，要求 `getattr(val, "__module__", "")` 的顶层模块名合法（`not in _TRIAL_BLOCKED_MODULES` 且不在 `("__main__", "builtins", "work", "lib")` 且非空）；
     - 执行 `type(fn)(fn.__code__, names)()`。
   - 未来接入非 ARC 环境时，只需提供该环境的 `_build_trial_globals(k)`，复用 `_run_readonly_trial` 零改动运行。

---

### 模块 B：运行时自动类型自省卡（Auto-Introspected Type Card）

涉及 [demo/arc_layered_prelude.py](../../demo/arc_layered_prelude.py)、[demo/arc_layered_python.ts](../../demo/arc_layered_python.ts)、[demo/arc_layered_extension.ts](../../demo/arc_layered_extension.ts)：

1. **通用递归类型摘要函数**（放在 `demo/arc_layered_prelude.py`，**零环境假定**）：
   - `_INTROSPECT_KEYS = ("current_frame", "transitions", "history", "valid_actions", "last_action_result")`（单一配置元组，新环境可替换）。
   - `_introspect_type(obj, depth=2, max_items=6)`:
     - 基础类型（`int/float/bool/str/NoneType`）返回 `type(obj).__name__`；
     - `list` / `tuple` / `set`：若空返回 `list[?]`；非空且 `depth > 0` 时检测首元素（如果是矩阵如 `list[list[int]]` 给出维度 `len(obj)xlen(obj[0])`，否则 `list[<elem_type>] (len=N)`），绝不转储完整内容；
     - `dict`：给出 `dict` + 最多 6 个键名及对应值摘要，如 `dict{nodes: list[dict], adjacency_list: dict}`；
     - 任意自定义对象（不写死 `Frame`/`Transition` 类名）：读取 `[a for a in dir(obj) if not a.startswith("_")]`（过滤内部与可调用方法，对非调用属性 `getattr` 并捕获所有异常，最多保留 8 个字段及其紧凑类型，如 `Frame(level: int, step: int, state: str, shape: tuple[int, int], grid: list[list[int]] (64x64), segmentation: dict{nodes, adjacency_list})`；若某属性是 callable 方法如 `.ascii()`，另附少量公共方法签名如 `.ascii(...)` 最多 2 个）。
   - `_build_type_card(bindings, max_chars=600)`：
     - 遍历 `_INTROSPECT_KEYS`，对非空序列（如 `transitions`、`history`）展示 `transitions: list[<elem_summary>] (len=N)`（用 `bindings["transitions"][-1]` 做样本自省，这样空序列时安全回退 `list[?]`）；
     - 对顶层可读标量/框架变量（如 `current_frame`, `valid_actions`, `last_action_result`）各输出一行；总长严格截断至 `<= 600` 字符。
2. **随 `_cell` 零额外 IPC 返回**：
   - 在 [demo/arc_layered_prelude.py](../../demo/arc_layered_prelude.py) 的 `_cell` 正常返回与 `sync_only` 返回字典中，加入 `"type_card": _build_type_card(ns)`（`ns` 已 `_bind()` 完成）。
3. **TS 桥接缓存与暴露**：
   - [demo/arc_layered_python.ts](../../demo/arc_layered_python.ts)：
     - `PythonOutcome` 增加可选字段 `typeCard?: string`；
     - `LayeredPython` 类增加字段 `runtimeTypeCard = ""`，每次 `run()` / `syncMemoryChecks()` 从 `result.result.type_card` 刷新它（若有非空字符串）。
   - [demo/arc_layered_extension.ts](../../demo/arc_layered_extension.ts)：
     - `type Python` 的 `Pick<LayeredPython, ...>` 中增加 `"runtimeTypeCard"`。
4. **Dossier 自动注入**：
   - 在 `runBoundaryEvolution` 组装 `dossier` 时，若 `python.runtimeTypeCard` 非空，注入区块：
     `RUNTIME TYPE CARD (auto-introspected):\n${python.runtimeTypeCard}`
   - 位置放在 `auditText` 之前或紧随其后（计入 `maxDossierChars` 总预算，且优先保留不被尾部截断；可通过调整 `windowBudget` 减去 `typeCardBlock.length` 来保证决策窗口不挤掉它）。

---

### 模块 C：自解释异常回执（`demo/arc_layered_prelude.py`）

1. **实现 `_introspective_hint(exc, scope_names=None, max_chars=220) -> str`**（纯 Python 标准反射，不依赖任何环境字段）：
   - **`AttributeError`**：Python 3.10+ 原生带有 `exc.obj` 与 `exc.name`（若缺失则回退空串）：
     - 获取 `obj = getattr(exc, "obj", None)` 与 `attr = getattr(exc, "name", None)`；
     - 收集 `[a for a in dir(obj) if not a.startswith("_")][:12]`；
     - 若 `isinstance(obj, dict)`，额外附 `keys=%r`（最多 6 个 key）；若 `isinstance(obj, (list, tuple, str, set))` 附 `len=%d`；
     - 生成：`"hint: %s has no %r; public attrs: [%s]"`（不打印 `str(obj)` 原文，避免把 64×64 网格/未来信息打进报错）。
   - **`NameError`**：获取 `missing = getattr(exc, "name", None)`：
     - 从 `scope_names`（过滤 `_` 开头内部变量）用 `difflib.get_close_matches(missing, candidates, n=3, cutoff=0.5)` 找相近名，同时附最多 12 个可用顶层名；
     - 生成：`"hint: similar=%s; available=%s"`。
   - **`TypeError`**：保持极其克制——若 `obj`/消息提及 `'str' object is not subscriptable` / `'NoneType'` 等，仅不瞎猜或简短返回实际可用提示；无法确定上下文对象时不强加噪音，总长硬截断 `[:max_chars]`。
2. **双入口挂载（让工具与规则同时受益）**：
   - **入口 1（`_cell` 内核报错）**：在 `_cell` 的 `except BaseException as problem:` 分支中，将 `_introspective_hint(problem, scope_names=[k for k in ns if not k.startswith("_")])`（若非空）追加到 `error` 字符串末行；注意当 `problem` 发生在 `trial_at` 内部时，`NameError` 的作用域名同样应可见 `_LIVE_KEYS`。
   - **入口 2（`_judge_memory` 的 `verify` 报错）**：在 `_judge_memory` 的 `except BaseException as exc:` 中，将 `hint = _introspective_hint(exc, scope_names=("t", "before", "after", "action"))` 追加到 `entry["stats"]["error"]`。这样无论是 `reflect_component` 预检拒落盘，还是历史回放报 `AttributeError: 'str' object has no attribute 'get'`，模型都能在当轮立刻看到 `hint: str has no 'get'; public attrs: [...]`，1 轮修对。

---

### 模块 D：有界修复轮（`3 + 1`）与 `repeat_mismatch` 漏斗透传（`demo/arc_layered_extension.ts`）

1. **有界 +1 修复轮（`runBoundaryEvolution`）**：
   - 将循环从固定 `round <= maxRounds` 改为：
     - `let repairUsed = 0;`
     - `let effectiveMaxRounds = maxRounds;`
     - 循环条件 `for (let round = 1; round <= effectiveMaxRounds && !done; round += 1)`；
     - 在单轮 `calls` 处理完毕且 `!done` 时检查：
       ```ts
       const remainingMs = timeoutMs - (Date.now() - started);
       if (turnHadError && repairUsed < 1 && round === effectiveMaxRounds && remainingMs > 45_000) {
         repairUsed += 1;
         effectiveMaxRounds += 1;
       }
       ```
     - 注意：`roundNote`（追加在最后一个 `toolResult` 尾部）需在决定是否授予 `repairUsed` 之后生成！当刚授予修复轮时，标注：`[evolution round ${round}/${effectiveMaxRounds} — REPAIR round granted for tool error; fix & call finish_evolution]`；若已经是真正最后一轮，保留 `FINAL round next`。
     - 在 `evolution_round` 日志字段补充 `repair_rounds: repairUsed`。
   - **严格约束**：没有发生 `turnHadError` 的轮次绝不延长（仍是 3 轮）；剩余时间 `<= 45_000 ms` 时绝不延长，避免触发 240s 超时。
2. **`repeat_mismatch` 计数与 Dossier 展示**：
   - 在 `installLayered` 中与 `alignedUses` 并列定义 `const repeatMismatches = new Map<string, number>();`（切关随 `alignedUses` 等局部态一起处理或按 `${fact.level}/${fact.branch_handoff.tool}` 分关计数）；
   - 在 `pythonTool.execute` 记录 `branch_handoff` 处（`fact.branch_handoff?.repeat_mismatch` 为真时），累加 `repeatMismatches`；
   - 在 `dualAudit` 生成 `Component use` 行时，若 `mm = repeatMismatches.get(`${auditLevel}/${item.name}`) ?? 0` 大于 `0`，附加 `, repeat_mismatch=${mm}`，让 Evolution 能直接定位“工具给出了正确方向但父 Agent 偏离后重复卡死”的交接失效。

---

## 三、验收测试清单与执行命令（Codex 必写且必过）

### 1. 环境无关单测（证明非硬编码、任意对象通用）
- **`tests/arc_layered_python.test.ts` 新增**：
  1. `trial_at` capability 沙盒测试：
     - 放行旧白名单之外的纯计算标准库（如 `import textwrap`、`from difflib import SequenceMatcher`、`from itertools import product`、`from collections import Counter`）及常规内置函数（`hasattr`, `map`, `round`, `zip`, `any`, `all`），且函数内外导入均生效；
     - 拦截副作用模块（`os`, `sys`, `subprocess`, `socket`, `pathlib`, `io`, `importlib`）与 `open()` / `eval()` / `exec()` / 相对导入 / 未来帧泄漏。
  2. `runtimeTypeCard` 与跨环境 `_build_type_card` 测试：
     - 验证 live session 返回 `outcome.typeCard`（非空且 `<= 600` chars，包含 `list[list[int]]` 等真实结构）；
     - 在 Python 内核中对**合成的非 ARC 模拟环境对象**（如 `class FakeObs: text="room"; inventory=["key"]; score=1.5` 与 `class FakeStep: obs=FakeObs(); reward=0.0`）调用 `_build_type_card`，验证零 ARC 硬编码即可生成准确类型卡且 `<= 600` chars。
  3. 自解释异常回执测试（工具 + `verify` + 非 ARC 对象）：
     - `AttributeError`（如 `current_frame.grid.tobytes()`、`t.action.get("x")`、以及合成非 ARC 对象 `obs.missing_field`）报错均附带 `hint: <type> has no ...; public attrs: ...`，且不倾倒大数组正文；
     - `NameError`（如 `transistions` 拼写错）附带 `similar=` 与 `available=`；
     - `validateMemoryChecks` 对错误表达式（如 `t.action.get("x")`）在 `stats[id].error` 中保留自省 hint。
- **`tests/arc_layered_extension.test.ts` 新增**：
  4. Dossier 注入 `RUNTIME TYPE CARD`：当 `python.runtimeTypeCard` 有值时，Evolution 拿到的首轮消息自动包含 `RUNTIME TYPE CARD (auto-introspected):`，且总长受 `maxDossierChars` 约束。
  5. 有界 +1 修复轮边界测试：
     - Round 2 工具返回 `isError: true` 时自动授予 Round 4（`repair_rounds: 1`），完成修复并 `finish_evolution(decision="evolved")`；
     - 无错误轮次仍严格止步 Round 3（`repair_rounds: 0`）；
     - `remainingMs <= 45_000` 时不授予第 4 轮（`ARC_LAYERED_EVOLUTION_TIMEOUT_MS` 设为小值如 `20000` 可 deterministically 覆盖）。
  6. `repeat_mismatch` 统计与 Dossier 展示：模拟 `branch_handoff.repeat_mismatch=true` 后，下一次 `dualAudit` 的 `Component use` 包含 `repeat_mismatch=1`。

### 2. 验证命令（PowerShell 5.1）
Codex 完成代码与单测后必须执行以下全部检查并汇报真实结果：
```powershell
# 1. 定向回归测试（含新增全部测试，须 100% 通过、0 失败）
node --experimental-transform-types --test --test-name-pattern="capability|runtimeTypeCard|introspective|repair round|repeat_mismatch|trial_at|bound tool|foldAfter: 0|calibrated|L4/L5 methodology|method_drift|prompt revision circuit-breaker|Phase 1|Phase 2|Phase 3|unscoped|harnessProfile gates" tests/arc_layered_python.test.ts tests/arc_layered_extension.test.ts

# 2. 全量 Python / Extension / Components Node 套件（核对 0 新增失败，基线已知失败分别为 12 与 7）
node --experimental-transform-types --test --test-concurrency=1 tests/arc_layered_python.test.ts
node --experimental-transform-types --test --test-concurrency=1 tests/arc_layered_extension.test.ts tests/arc_layered_components.test.ts

# 3. Python pytest 套件
$env:PYTHONPATH='src'; python -m pytest tests/test_arc_layered_evolution.py tests/test_arc_layered_experiments.py -q
```

---

## 四、运行前实验协议（供本地验收过关后的真实复测使用）

- **目标证据层级**：功能正确 + 全链路可达（本地单测与 scripted/mock smoke）→ 自主采用与净收益（真实配对对照）。
- **主要变量与比较器**：基线 `fdcc815` vs 本次重构版（同模型、同预算配对）；同时按需扩展至非 ARC 环境验证零特判泛化性。
- **核心观测量**：
  1. `evolution-trace.jsonl` 中因 `ImportError` / `NameError` / `AttributeError` 导致的 `incomplete` 次数与占比；
  2. Evolution 首轮即直接构建组件而非仅打 `print(type(...))` 探类型的比例；
  3. `repair_rounds=1` 救回率（从报错到同次审计 `evolved` 的转化数）；
  4. 父子总 token、墙钟时间、240s 超时率、`@tool` 发布数与复用次数、关卡完成数。

| 证据层级 | 状态 | Provider / environment | 产物及结论边界 |
| --- | --- | --- | --- |
| 功能正确 | 未验证（待实施） | Node test + Pytest / mock kernel | 覆盖沙盒隔离、跨环境类型自省、异常提示、+1 修复轮与 `repeat_mismatch` |
| 全链路可达 | 未验证（待实施） | `LayeredPython` + `installLayered` + scripted provider | 覆盖 Dossier 注入 Type Card、出错修复、回执记账 |
| 自主采用 | 未验证 | 待真实 provider 运行 | 需观察真实模型错误自愈率与 `incomplete` 下降 |
| 净收益 | 未验证 | 待同底座配对对照 | 需观察推进关卡与父子总成本净变化 |

---

## 五、交付决定（当前阶段）

- **已支持声明**：完成问题根因定位（`su15` / `ls20` 实测轨迹）与环境无关方案设计；尚未修改运行时代码或运行新实验。
- **未支持声明**：上述四项机制的功能正确性、全链路可达性、真实模型采用与任务收益均未验证。
- **下一步**：由 Codex 按本方案实施模块 A–D 与第 3 节全部单测，在零新增基线回归下完成提交后再评估真实运行。

## 六、实现与验证记录（2026-11-28）

- 实现了前缀数据构建与只读试算接口、允许计算模块的直接导入过滤、运行时类型卡、异常提示、末轮出错后的有界修复轮及 `repeat_mismatch` 反馈。此过滤是防误用护栏，无法阻止 Python 反射或间接模块引用绕过；不应视为恶意代码隔离。
- 定向 Node 测试 28/28 通过，包含前缀、常见计算模块与直接拦截、类型卡、非 ARC 对象、异常提示、修复轮和偏离反馈。Pytest 两套共 8/8 通过。
- 全量 Node：Python 52/64 通过，Extension/Components 62/69 通过。对独立 `fdcc815` 副本重跑后，12 项及 7 项失败的测试名称相同；历史失败仍存在，不能声称全量套件全绿。
- 本次使用真实 Python kernel 和脚本 provider fixture 验证局部行为；尚未运行完整 runner/bridge/Pi 的端到端 smoke，也未运行真实 provider 或配对实验。全链路可达、自主采用、任务净收益均未验证。
- 本方案的测试清单将“第 2 轮出错”与“仅末轮出错授予修复轮”并列；实现遵循后者：只有最后允许轮次出错且剩余时间大于 45 秒才增加一轮。
