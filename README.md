# Autoresearch Pi Project

独立的 autoresearch-meta + Pi Agent 实验工程。

## 隔离边界

- 本工程是独立 Python 项目，源码位于 `src/autoresearch_pi/`。
- `D:\JIT` 只作为外部 JIT 测试宿主的只读路径；本工程不修改其源码、配置或运行产物。
- `D:\guan-meta-loop-v2\autoresearch-meta-demo` 作为 autoresearch 参考实现的只读路径。
- shopping smoke 通过显式的 JIT adapter 启动，输出写入本工程的 `runs/`。

## 目标运行模型

```text
Auto-Research method resources
  -> Pi task agent autonomously designs research and task strategy
  -> Pi-native extensions/tools/hooks carry task-local self-harness changes
  -> PiKernel only transports RPC/session/events
```

逻辑 harness 原语用于描述可独立调整的执行条件，具体操作直接使用实际 Pi 原生入口。`steer` / `follow_up` 保持消息控制语义，不作为通用 mutation 接口。

## 开发

```bash
python -m pip install -e .
python -m pytest
```

## 运行

先执行环境诊断：

```powershell
$env:PYTHONPATH = "$(Get-Location)\src"
python -m autoresearch_pi.cli doctor
```

无网络的 autoresearch-meta 回归：

```powershell
python -m autoresearch_pi.cli meta-synthetic
```

通过只读 adapter 启动一个 JIT OfficeBench case（需要 JIT 的 Python 依赖和模型 API）：

```powershell
python -m autoresearch_pi.cli jit --bench officebench --harness auto_research --max-samples 1
```

运行 Pi-native、无网络的 OfficeBench 兼容冒烟：

```powershell
python -m autoresearch_pi.cli officebench-smoke
```

运行带 Auto-Research 与 self-harness handoff 的独立架构 demo：

```powershell
python -m autoresearch_pi.cli meta-harness-demo --root runs/meta-harness-demo-latest
```

该 demo 使用确定性的 task-agent 决策 fixture，并在实际安装的 Pi 进程中验证原生扩展状态变更；详见 [demo 说明](demo/README.md)。

使用真实模型、Pi 原生 agent loop、JIT OfficeBench actions 和 JIT 原 evaluator 跑一个端到端 case：

```bash
export PYTHONPATH='D:/autoresearch_pi_project/src'
export JIT_ROOT='D:/JIT'
export JIT_PYTHON='D:/anaconda/envs/jit/python.exe'
'D:/anaconda/envs/jit/python.exe' -m autoresearch_pi.cli officebench-e2e \
  --root 'D:/autoresearch_pi_project/runs/pi-officebench-e2e-live' \
  --case '1-2-0'
```

该命令从 `D:\JIT\.env` 读取模型 endpoint、key 和 `EXEC_MODEL`；不会把 key 写入命令或 summary。

顺序运行前 10 个独立 case，并在根目录生成聚合 summary：

```bash
'D:/anaconda/envs/jit/python.exe' -m autoresearch_pi.cli officebench-e2e \
  --max-samples 10 \
  --root 'D:/autoresearch_pi_project/runs/pi-officebench-e2e-10'
```

Pi RPC bridge 只负责 session、RPC 和事件传输；harness 应由 Pi 原生 extension 承载。外部 `JIT_ROOT` checkout 不会被修改；端到端命令只读取其 dataset/action/evaluator，并把 workspace 与结果写入本项目 `runs/`。

运行事件使用 `compact-jsonl-v1` 写入：普通语义事件完整保留，流式 `message_update` 仅保留 delta 并移除重复累计快照。具体格式由同目录 `pi-runtime-status.json` 的 `trace_format` 和 `message_updates` 字段声明。

环境变量：

- `JIT_ROOT`：JIT 测试宿主路径，默认 `D:\JIT`
- `AUTORESEARCH_META_ROOT`：autoresearch-meta 参考实现路径
- `PI_COMMAND`：Pi CLI，默认 `pi`
