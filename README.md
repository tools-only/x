# Minimal Harness Kernel Demo

## Autonomous Research MVP

The LLM demo has one hard boundary: the Kernel provides object persistence, Harness instantiation, process execution, environment interaction, and authoritative run feedback. The Meta runtime owns the research method.

Meta receives a task seed Harness Spec and can autonomously choose hypotheses, publish complete Specs, instantiate them, run any number of experiments, inspect feedback, compare results, iterate, and stop. No candidate selection, fixed experiment count, proposal step, or Gate is inserted by the Kernel.

The Meta tools are:

- `spec_publish`: persist a complete `harness-spec`.
- `harness_instantiate`: materialize that Spec into an executable Harness.
- `harness_start`: run any Harness with a job.
- `run_observe`: read status, authoritative metrics, result, and usage.

The Meta research contract is documented in [`docs/meta-harness-evolution.md`](docs/meta-harness-evolution.md).
The tagged dynamic-Harness discussion (`DISC-DH-001`) and trajectory-codec experiment
(`EXP-HTC-001`) are documented in
[`docs/plans/2026-08-24-harness-evolution-trajectory-codec-design.md`](docs/plans/2026-08-24-harness-evolution-trajectory-codec-design.md).
The versioned prompt is persisted as a `meta-prompt` Object, task agents can submit
task-general lessons with `experience_submit`, and Meta can retrieve them with
`knowledge_search`. Harness manifests retain their source Spec, compiler version,
and component-to-digest map.

Run the autonomous MVP with:

```powershell
uv run --offline --no-sync hos demo --runtime llm --root .manual-real-llm-run --environment arc3-local --game-id ls20 --seed 0
```

The Task runtime owns the environment loop (`env_open`, `env_observe`, `env_step`, `env_reset`, `env_close`). The Meta runtime owns the methodology loop around Specs and observed HarnessRun feedback. `Gate` and legacy candidate commands remain separate low-level utilities and are not part of this autonomous demo.

All runtime artifacts are persisted below the selected root. Each LLM `AgentRun` contains `invocation.json`, `status.json`, `result.json`, `events.jsonl`, `stderr.log`, and `transcript.jsonl`. The transcript records provider requests/responses and every Host tool result or error; `result.json` also exposes `provider_usage`. HarnessRuns contain `harness.lock.json`, `job.json`, `agents.jsonl`, `children.jsonl`, `episodes.jsonl`, `metrics.json`, and their result/status files. EpisodeRuns contain `game.json`, `events.jsonl`, `recording.jsonl` when available, `scorecard.json`, and `result.json`.

这是一个可运行的 file-native Meta-Harness 纵向切片。Kernel 管理：

- 内容寻址、不可变的 Harness/Agent/Skill Objects；
- HarnessSpec 到 Harness Lock 的递归解析；
- 独立进程中的 root AgentRun 与 subagent AgentRun；
- Host-owned ARC EpisodeRun、recording 与 authoritative score；
- Harness Spec 的持久化与实例化；
- Meta runtime 自主驱动的 Task 实验与反馈读取。

## 安装

```powershell
$env:UV_CACHE_DIR = "$PWD\.uv-cache"
uv run --no-sync python -c "import arc_agi; print(arc_agi.__file__)"
```

若要连接官方 ARC-AGI-3 Toolkit：

```powershell
uv run --no-sync python -m pip install arc-agi
$env:ARC_API_KEY = "<optional-key>"
```

## Model Provider 配置

复制模板：

```powershell
Copy-Item .\hos.example.toml .\hos.toml
```

[hos.example.toml](hos.example.toml) 提供五个 profile：

- `custom`：任意 OpenAI-compatible base URL、endpoint、model 和自定义 headers；
- `openai`：OpenAI-compatible chat-completions；
- `anthropic`：Anthropic Messages API，包含 `x-api-key`、`anthropic-version` 和原生 tool use 转换；
- `openrouter`：包含 OpenRouter 所需扩展 headers 的示例；
- `local`：本机 vLLM、LM Studio、Ollama compatibility server 等 `/v1` endpoint。

在 PowerShell 中设置秘密值：

```powershell
$env:HOS_PROVIDER = "custom"
$env:CUSTOM_PROVIDER_API_KEY = "<key>"
$env:CUSTOM_PROVIDER_TENANT_ID = "<optional-tenant>"
```

检查配置不会发送模型请求，并会隐藏 API key 与 `header_env` values：

```powershell
uv run --no-sync hos config check --config .\hos.toml
uv run --no-sync hos config show --config .\hos.toml --provider local
```

显式探测 provider 会发送一次最多 8 completion tokens 的请求：

```powershell
uv run --no-sync hos provider probe --config .\hos.toml --provider custom
```

可用环境覆盖：`HOS_CONFIG`、`HOS_PROVIDER`、`HOS_BASE_URL`、`HOS_ENDPOINT`、`HOS_MODEL` 和 `HOS_API_KEY`。Provider profile 中的 `api_key_env` 与 `header_env` 只引用变量名；解析后的秘密不会出现在脱敏输出中。

provider client 支持 OpenAI-compatible `/chat/completions` 与 Anthropic `/v1/messages`。两种协议共用 HOS 内部 messages/tools 循环；Anthropic 边界会转换 system、`tool_use`、`tool_result` 和 usage。请求不发送 `temperature`，由服务商使用其默认值或自动补充。ARC-AGI-3 本地运行默认不会访问远程环境；显式指定 `--runtime llm` 或在 `.env` 中设置 `HOS_RUNTIME=llm` 才会发送 provider 请求。

## ARC-AGI-3 Task Run

```powershell
uv run --offline --no-sync hos task run --root .task-arc3 --runtime llm --environment arc3-local --game-id ls20
```

这个命令只验证底层 Task runtime、环境交互和权威 Episode 分数，不启动 Meta research。

ARC-AGI-3 本地运行使用真正的 Kernel 进程、Host Protocol 和 EpisodeRun，并通过官方 Toolkit 读取本地游戏环境。

## Terminal-Bench 2 Task Run

`terminal-bench-2` uses the local Harbor CLI for the Terminal-Bench sandbox and
verifier. HOS keeps the generated Task Harness agent as the executor: it passes
that locked agent's provider profile, policy, and skills to an internal bridge
that runs terminal commands in Harbor's sandbox. Harbor's verifier reward is the
authoritative HOS episode score.

```powershell
harbor run --help
uv run --no-sync hos task run `
  --root .task-terminal-bench `
  --environment terminal-bench-2 `
  --task-name video-processing
```

The dataset defaults to `terminal-bench/terminal-bench-2` and can be changed with
`--dataset` or `HARBOR_DATASET`. The model and provider remain entirely in
`hos.toml`; HOS does not pass a model to Harbor. `HARBOR_COMMAND`,
`HARBOR_TIMEOUT_SECONDS`, and `HARBOR_VERIFIER_TIMEOUT_MULTIPLIER` provide
execution configuration. The last value is passed to Harbor's
`--verifier-timeout-multiplier` and is useful when a task verifier has a
legitimate long setup phase. New task Harnesses use 24 turns with an 8192-token
per-turn task-agent limit by default; set `HOS_TASK_MAX_TURNS` or
`HOS_TASK_MAX_TOKENS` before creating a new experiment root to version different
budgets explicitly. The task name is
passed to Harbor with `--include-task-name`, so one Kernel episode corresponds
to one Harbor trial.

Harbor requires an internal adapter class to drive its sandbox API. HOS supplies
that bridge itself; it is not a configurable Harbor agent and does not replace
the HOS task agent selected by the Harness Spec.

## Terminal-Bench 2 Long-Running Experiment

The checked-in suite separates Meta-visible training tasks from held-out testing
tasks. It evaluates the baseline once, runs Meta only on training tasks, and
evaluates again only when the selected Task Harness digest changes. Evaluation
runs set `knowledge_writes=false`, so task experiences cannot enter shared
memory. Test results are persisted for observation but are never included in a
Meta or Task job.

```powershell
uv run --no-sync hos experiment run `
  --root .meta-terminal-bench-evolution `
  --suite experiments/terminal-bench-2.toml `
  --duration-hours 24
```

Inspect the latest running session and held-out checkpoint:

```powershell
uv run --no-sync hos experiment status `
  --root .meta-terminal-bench-evolution `
  --suite experiments/terminal-bench-2.toml
```

Experiment sessions are stored under `experiments/<suite>/`; independent
checkpoint history is stored under `evaluations/<suite>/`. Full Kernel and
Harbor artifacts remain under `runs/`. See
[`docs/plans/2026-08-23-terminal-bench-train-eval-design.md`](docs/plans/2026-08-23-terminal-bench-train-eval-design.md).

## Meta Research Artifacts

Every Meta Harness run materializes its research lineage under
`<meta-root>/research/<meta-harness-run>/` in addition to the immutable object
store and normal Kernel runs:

```text
research/<meta-harness-run>/
  index.json
  specs/<spec-digest>.json
  instances/<harness-digest>/harness.json
  instances/<harness-digest>/runs/<harness-run>/run.json
  instances/<harness-digest>/runs/<harness-run>/harbor-verifier.json
```

`specs` contains the full Meta-designed Harness Spec. `harness.json` records the
derived task Harness and its resolved lock. For Terminal-Bench instances,
`harbor-verifier.json` contains the Harbor verifier result and the authoritative
score returned to HOS.

For a Meta root named `.meta-terminal-bench`, list the materialized files with:

```powershell
Get-ChildItem ".meta-terminal-bench\research" -Recurse -File
```

Meta runtimes use the same `hos research` control plane rather than direct Kernel
internals. The commands are also available for inspection and controlled replay:

```powershell
uv run --no-sync hos research observe --root .meta-terminal-bench --parent-run <meta-harness-run> --run <runtime-run>
```

```powershell
uv run --no-sync hos research decision --root .meta-terminal-bench --parent-run <meta-harness-run> --agent-run <meta-agent-run> --spec <spec-digest> --input <decision.json>
```

The decision JSON must contain a Meta-selected `status` of `confirmed`,
`rejected`, `revised`, `expanded`, or `deferred`, plus a non-empty `rationale`.

## 真实 Meta/Task Runtime

真实 runtime 在 Meta 与 Task AgentRun 各自的子进程中执行统一的 tool-calling loop，Provider 边界可选择 OpenAI-compatible chat-completions 或 Anthropic Messages。Meta 模型通过 `spec_publish`、`harness_instantiate`、`harness_start` 与 `run_observe` 自主设计并执行实验；Kernel 不选择 candidate、不固定实验次数、不执行 Gate。

在 `hos.toml` 中定义两个 profile，并在 `.env` 中只放秘密与选择项：

```toml
default_provider = "task"

[providers.task]
type = "openai_compatible"
base_url = "http://127.0.0.1:8000/v1"
model = "task-model"
api_key_env = "TASK_PROVIDER_API_KEY"

[providers.meta]
type = "openai_compatible"
base_url = "http://127.0.0.1:8000/v1"
model = "meta-model"
api_key_env = "META_PROVIDER_API_KEY"
```

```dotenv
HOS_RUNTIME=llm
HOS_TASK_PROVIDER=task
HOS_META_PROVIDER=meta
TASK_PROVIDER_API_KEY=
META_PROVIDER_API_KEY=
```

本地 ARC 与模型 provider 是独立的：`arc3-local` 和 `OPERATION_MODE=offline` 让 ARC 不访问平台，但模型请求仍会发往所配置的 `base_url`。要完全离线，两个 profile 的 `base_url` 必须同样指向本机模型服务。

```powershell
uv run --offline --no-sync hos demo --runtime llm --root .ls20 --environment arc3-local --game-id ls20 --seed 0
```

## ARC-AGI-3 Smoke/闭环

```powershell
uv run --no-sync hos demo --root .arc3-hos --environment arc3 --game-id <game-id> --seed 0
```

For the bundled ARC-AGI-3 local environment (no API or network access):

```powershell
uv run --no-sync python -c "from hos.environments import ArcAgi3Adapter; print([item['game_id'] for item in ArcAgi3Adapter(local=True).discover()])"
uv run --no-sync hos task run --root .arc3-local-hos --environment arc3-local --game-id dc22-fdcac232 --seed 0
```

启动时 Kernel 会通过官方 Toolkit 校验显式指定的 game ID，不再静默选择第一个 game。实际可运行性取决于 `arc-agi` 安装、API/本地环境可用性和相应网络状态。

### 运行 `ls20`

直接使用远程 ARC-AGI-3 环境时，可以用本地脚本下载单个游戏：

```bash
export UV_CACHE_DIR="$PWD/.uv-cache"
export ARC_API_KEY="<arc-api-key>"
uv run --no-sync python scripts/download_arc_game.py ls20
```

不指定游戏 ID 时下载 API 返回的全部游戏：

```bash
uv run --no-sync python scripts/download_arc_game.py
```

下载结果默认保存到 `environment_files/<game-id>/<version>/`。下载完成后可以切换到完全离线模式：

```bash
uv run --no-sync hos demo --root .ls20-meta-local --environment arc3-local --game-id ls20 --seed 0
```

因此，使用 `arc3` 不要求事先手动下载，但需要网络和可用的 ARC API 访问；使用 `arc3-local` 则要求对应的 `ls20` 代码和 `metadata.json` 已存在于 `environment_files/`（当前工作区只有 `dc22-fdcac232`）。

### 使用 `.env` 配置本地路径

不需要在 shell 中 `export`。复制 `.env.example` 为 `.env`，按实际路径修改：

```dotenv
ARC_ENVIRONMENTS_DIR=D:/guan/environment_files
OPERATION_MODE=offline
ARC_API_KEY=
HOS_LOG_LEVEL=DEBUG
```

Windows 路径建议使用 `/`，不要写成 `/D:\\guan\\environment_files`。`.env` 已被 Git 忽略，不应提交 API key。

运行日志写入 `stderr`，不会污染命令 stdout 中的 JSON 报告。`HOS_LOG_LEVEL=DEBUG` 会打印完整生命周期和每次 Host Protocol call；改为 `HOS_LOG_LEVEL=INFO` 即关闭 DEBUG 级别的 call 日志但保留生命周期日志；使用 `HOS_LOG_LEVEL=OFF` 可关闭 HOS 自身日志。每个 AgentRun 的完整 runtime stderr 仍保存在对应的 `runs/<agent-run-id>/stderr.log`。

确认 Agent runtime 实际启动时，应同时看到 `agent.process.started`、`runtime.ready`、`runtime.driver.llm.begin`、`provider.chat.start` 和 `runtime.finish.received`。其中 `runtime.ready` 由子进程回传并包含 `run_id` 与 runtime PID，Kernel 会校验握手属于当前 AgentRun；Windows 下 launcher PID 与 Python runtime PID 可能不同，两个 PID 都会记录。

`--root` 现在可填写基础目录，不需要手动加入 `debug`、`meta` 或 `task`。`demo` 自动使用 `.meta-<root>`，`task run`、`candidate publish` 和 `gate evaluate-task` 自动使用 `.task-<root>`；已有包含 `meta`/`task` 的旧目录名继续直接使用。例如 `--root .ls20-offline` 会自动使用 `.meta-ls20-offline` 或 `.task-ls20-offline`。

如果 Windows 系统代理指向不可访问的本地端口，可在当前 PowerShell 会话中绕过代理：

```powershell
$env:NO_PROXY = "*"
$env:HTTP_PROXY = $null
$env:HTTPS_PROXY = $null
$env:ALL_PROXY = $null
uv run --no-sync hos demo --root .arc3-hos --environment arc3 --game-id <game-id> --seed 0
```

## 测试

```powershell
uv run --no-sync python -m pytest -q
```

## 当前边界

- 同步单机执行，无 daemon/DB/queue；
- Harness Spec 与 candidate 代码按受信研究代码处理，不是安全沙箱；
- `task run` 和 `demo` 默认使用 ARC-AGI-3 本地环境；`demo` 默认要求真实 `llm` Meta runtime；
- 完整模型消息和 provider token usage 尚未按 AgentRun 持久化；统计显著性和多 seed 重复应由 Meta 方法论决定。

ARC-AGI-3 adapter 仍可独立运行本地环境；底层环境交互和 scorecard 反馈属于 Kernel 原语，不代表 Meta 已经具备通用研究能力。
