# Meta-harness 变更记录：task Python 从 CPython/WASI 切换为原生 CPython

日期：2026-11-25（Asia/Shanghai）。状态：实现（功能层已验证；真实 ARC 自主采用未验证）。

## 问题与命题

- 真实失败/机会及材料：WASI 运行时（@antonz/python-wasi + wasmtime 49 + sha256 锁定）是 stdlib-only，无动态链接，numpy 等 C 扩展与任何第三方库均不可用；预置库需重打包 wasm 并换 pin。agent 的 claims 谓词与 world_model 回测被限制在纯 stdlib 内。用户决定放弃 wasm 沙箱换取库生态（对话 2026-11-25）。
- 窄命题：task Python 的三条执行路径（one-shot runner、board pool、live kernel）改为原生 CPython 后，协议、事件、返回包与超时语义不变，agent 代码即可使用宿主环境的全部 site-packages（含 numpy）。
- 减少的负担：解释器 sha256 pin / wasmtime 版本 pin 不再阻塞库演化；无需维护 wasm 重打包流程。
- 推翻条件：若未来需要运行不可信第三方代码，须重新评估沙箱（WASI/Pyodide/OS 级），本记录不授权该场景。
- 非目标：不改 Pi 边界的 JSON 校验；不改 prelude/kernel 协议；不重命名 runtime 身份字段。

## 设计与成本

- 选择与取舍：威胁模型是"自己的 agent 写错代码"，非对抗代码。保留硬超时、输出字节上限、协议 stdout 隔离（kernel 将 fd1 指向 devnull，协议走 dup 出的私有句柄）；放弃 fuel/内存硬限制/解释器 pin/零宿主文件系统。guest 仍用 `-I`（忽略 PYTHON* 环境变量与 user-site），但不再 `-S`，site-packages 可用。
- 运行时身份：字段名保留（saved-tool 兼容），`python_version` 改为探测宿主 `python`，`wasmtime_version`/`module_sha256` 置 "native"。旧版保存的工具将按既有 version_conflict 语义要求重新发布。
- 权限/版本/环境边界：Pi 边界 JSON/limits 校验、timeout_ms、output_bytes 全部保留并实际生效；fuel/memory 字段降级为兼容性参数（注释已标明）。
- 已知毛边：one-shot 超时时 runner 被 TS 杀掉后，其 guest 孙进程在 Windows 上可能短暂残留至自身 timeout 到期；接受。

## 实现与验证

- 改动入口：`demo/pi_task_python_runtime.py`（原生 guest 子进程 + 请求走 stdin）、`demo/pi_task_python_server.py`（复用 runner）、`demo/pi_task_python_kernel.py`（原生常驻 kernel：同 ready/done/request/dead 协议、budget 看门狗、等待不计时）、`demo/pi_task_python.ts`（去 python-wasi 依赖、身份探测）；`pi_task_python_kernel.ts`/`pi_task_python_pool.ts` 仅注释。`package.json` 的 @antonz/python-wasi 依赖未移除（无害，可后续清理）。
- 功能回归（python 3.12.7, node 25.5.0, Windows）：
  - `pytest tests/test_task_python_server.py` 2 passed（含 GBK stdio 与 guest 失败路径）。
  - `pytest tests/test_arc_layered_evolution.py` 2 passed。
  - `node --experimental-transform-types --test` tests/arc_layered_python.test.ts 34/34、arc_layered_extension.test.ts 18/18、arc_thin_pool_metrics 1/1、arc_agi_3_foundation + arc_thin_history + pi_harness_board 10 pass/5 skip（skip 为既有 fixture 条件）。
  - tests/arc_thin_kernel.test.ts 5 失败：已用 wasm 原版代码复跑确认为 worktree 既有 WIP 失败（mock host 缺 `self`），与本变更无关。
  - 真实收益验证：runner 执行 `import numpy` 返回 `{"numpy":"1.26.4","mean":2.0}`；kernel 探针验证死循环 cell 2s 被终止（`a cell exceeded its compute time of 2 s`），下一 cell 自动重建并带 previousExit。
- 未验证层级：真实 provider 的 ARC 对局中 agent 对新库能力的自主采用与净收益；claims/ARC_LAYERED_MODEL 触发机制问题（主线程另案处理）不在本记录范围。
