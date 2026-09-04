# Autoresearch Pi Project

独立的 autoresearch-meta + Pi Agent 实验工程。

## 隔离边界

- 本工程是独立 Python 项目，源码位于 `src/autoresearch_pi/`。
- `D:\JIT` 只作为外部 JIT 测试宿主的只读路径；本工程不修改其源码、配置或运行产物。
- `D:\guan-meta-loop-v2\autoresearch-meta-demo` 作为 autoresearch 参考实现的只读路径。
- shopping smoke 通过显式的 JIT adapter 启动，输出写入本工程的 `runs/`。

## 目标运行模型

```text
Pi Agent kernel
  -> autoresearch supervisor
  -> dynamic harness staging / validation / activation
  -> JIT shopping adapter (read-only host)
```

Harness 修改在当前 turn 结束后立即激活：supervisor 保存 checkpoint，停止 action loop，原子切换经过校验的 harness，再从 checkpoint 恢复。

## 开发

```bash
python -m pip install -e .
python -m pytest
```

环境变量：

- `JIT_ROOT`：JIT 测试宿主路径，默认 `D:\JIT`
- `AUTORESEARCH_META_ROOT`：autoresearch-meta 参考实现路径
- `PI_COMMAND`：Pi CLI，默认 `pi`
