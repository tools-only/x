# Phase 1 感知、状态与认知闭环

日期：2026-11-27（Asia/Shanghai）。实现基线为 `8a5a463`。

## 问题与命题

此前主任务能直接持久化组件，无法区分正常求解与边界复盘的贡献。ScienceWorld 报告的成功运行中组件读写均为零。Phase 1 的窄命题是：当现有轨迹暴露可比状态下的感知或分枝缺口，Audit 产出的一个小组件能在后续父轮被使用，并减少已证伪动作的重复。

## 设计与成本

默认档恢复 12,000 输出上限（受模型上限限制）、80k/48k、四次观察和按关退避。沿用四个边界和既有组件版本库。父任务读取单一 2,500 字符尾部面板，Audit 负责持久化组件。工具可以在历史前缀用 `trial_at` 试跑。Memory 反例在下一份面板折叠，其完整版本仍可供复盘。结构化离散分枝返回 `branch_action` 时，遥测把同一状态下的建议与实际动作对齐，仅在有具体 expect 且分枝一致时计入写回。其他输出需要事后语义核对。

## 验证与后续

- 定向 Node 9 项通过，涵盖只读、历史前缀、版本链、反例折叠、尾部预算、边界演进、建议采纳与重复动作反例。提交前 `test_arc_layered_evolution.py` 与 `test_pi_kernel.py` 共 27 项通过。
- 实际 Pi、bridge、脚本 provider 和 mock ARC 环境的 smoke 执行 2 步并按动作预算结束。父请求未暴露 `reflect_component`。该 smoke 不提供模型自主采用证据。
- 汇总含缓存率、长度截断、结构化分枝交接及重复不匹配候选。机会分母仍需查看适用状态和漏用，报告留空。调用成功本身不计语义采用。
- 自主采用及净收益待测。双臂固定同模型、初态、动作和 token 预算，唯一切换 `ARC_LAYERED_EVOLUTION`。需要用户授权真实 provider 预算，并预先锁定配对样本、墙钟与停止规则。
- 提交前三个相关 Node 文件共 101 项：82 通过、19 失败。19 个失败用例名称与此前独立基线对照中已存在的失败一致；Phase 1 新增用例通过。独立基线快照 74 通过、21 失败。此结果不表示现有全量旧路径均通过。

## 真实测试配置

使用 `config/arc-layered-real-az-qwen27b.json` 与 `tools/run_arc_layered_real.py --root <新运行目录>`。默认 `su15`、AZ `qwen3.8-27b`、medium 推理、Phase 1 evolution 开启。由官方 SDK 基线推导的每关及总动作预算作为任务配额。不另设全程 wall、总 token 或连续空转段上限。模型单次请求与 provider 故障仍按 runner 协议处理。AZ 凭证从配置指定的本地 dotenv 读取，不进入版本库。

第一次真实启动在模型阶段收到 401，0 动作。采用已明确配置同一 AZ 网关的本地凭证后，从新目录 `runs/phase1-az-qwen27b-su15-20261127-r2` 重新启动，首个 provider 请求成功并执行至少 1 个 ARC 动作。这是单臂运行，后续结果见该目录的 `summary.json`。

`r2` 最终在首关第 8 步结束。Pi 0.87 在 `before_agent_start` 之后才确认 `prompt`，首次 stalled Audit 在确认之前运行，前两轮分别耗时 51 和 40 秒。Audit 与 RPC 等待原先同为 120 秒，runner 在获得审计回执之前因 RPC 超时退出。修复后只给 layered `prompt` 增加配置中的 Audit 时间，保留现有全程 deadline 约束。Audit 到时主动结束 provider 等待并记录 `timeout`，即使 provider 流迟迟不结算。`r3` 已真实越过该故障点。

`r3` 越过了之前的第 8 步，在首关完成 21 步后，第 22 次环境 `step` 超过 90 秒且结果未知，因此中断并从新 scorecard 重启。根因是桥接器的就绪读取线程收到 ready 行后停止读取 stdout，而 ARC SDK 把日志写到 stdout；管道写满使 SDK 卡在日志 `flush()`。现已让该线程在就绪后持续排空 stdout。用模拟子进程在 ready 行后输出 1 MiB 的定向回归烟测通过。`runs/phase1-az-qwen27b-su15-20261127-r3/interruption.json` 保留中断原因。`r4` 在新目录进行中；当前仍不足以评估 Phase 1 对自主采用或 ARC 成功率的效果。


## Phase 2 implementation (2026-11-27)

Implemented component layer/scope/status metadata, level dormancy, versioned merge/promote/demote, provisional cross-level proof and contradiction folding. Existing per-level verify buckets drive proof; overlapping rules do not multiply supporting transitions. Historical versions and per-level witnesses remain available to Audit. Tool comments can declare scope/layer; retained game tools receive a read-only initial-frame check. Required-argument tools are imported but not invoked; exceptions/empty callable results quarantine the tool. Structural evidence reports dimensions/actions/symbols and same-symbol 4-connected regions excluding the modal symbol (a mechanical count, not semantic object recognition).

Cognitive reviews use contradiction evidence identity, four/six-step cooldowns, three cognitive reviews, six stagnation reviews and eight total corrections per level; level-complete reviews are separate. Consecutive surprising batches and three surprises in eight steps trigger review. The Dossier includes L1-L5 diagnosis guidance, observation code patterns, use/alignment counts, per-level witnesses and structural snapshots. The bounded live panel excludes dormant/broken bodies and conditionally indexes consult agents. Runner output includes proof changes, layer changes and cognitive audit records. A 240s audit default is matched by RPC acknowledgement allowance.

Validation: Phase 1/2 targeted Node checks (12) passed, including cross-level proof/merge, quarantined tools, structural evidence, cognitive deduplication/cooldown/quota and repeated surprises. Python evolution/kernel suites: 27 passed. Existing broad Node failures remain; full integration and real-provider Phase 2 adoption/net benefit are unverified. The ongoing r4 is a Phase 1 run, not a Phase 2 experiment. No Phase 2 paid run was launched. Changes remain local for review.


## Phase 3 first implementation batch

Phase 2 checkpoint: local commit `b642236` (not pushed). Phase 3 is experimental and disabled by default. `ARC_LAYERED_RECOVERABLE_FOLD=1` enables immutable raw tool-result archival before eviction, replacing older tool-result bodies with content-addressed handles and retaining call/result pairs. `read_archive` returns paginated serialized historical content with integrity validation; old advice never becomes active Memory merely through retrieval. In this arm the existing irreversible tool-result folds are bypassed. The raw trailing window uses foldAfter, or four blocks when it is zero. This intervention changes historical prefix content and must be measured for cache cost independently of ACE.

Narrow claim: on tasks requiring older evidence, selective recovery may improve continuity at a tolerable parent-plus-retrieval cost. Compare the baseline foldAfter=0+evict with this arm using the same model, initial state, action budget and context settings. Measure task outcome, retrievals and missed opportunities, input/output/cache costs, latency, and decisions after retrieval. A serialized archive or successful read is not proof of cognitive continuity.

Checks: two archive tests passed (exact text/images, call pairing, immutable/idempotent handles, pagination, invalid references and corruption). Parent-tool integration is tested separately. No Phase 3 real-provider run was started. Matched-prefix continuation forks on layered, independent-task transfer manifests and paired reporting remain the next batch. The existing thin snapshot/replay framework is a reference only: do not represent its snapshots as layered snapshots or treat offline replay as a causal continuation experiment.


### Phase 3 second batch: transfer and matched-prefix continuations

Added `arc_layered_experiments` to export confirmed game-scoped components and seed a different task as provisional without source stats/history/credentials. Integrity is checked before writes; game tools receive the existing initial-frame health check. Real launcher accepts `--transfer-from` and `--recoverable-fold`.

Layered runner accepts `snapshot_after_segments` and `fork_from` (launcher: `--snapshot-after-segments 1 ...`, `--fork-from <snapshot>`). Idle-segment snapshots freeze the active Pi session, work files, harness/archive and a grid-checked canonical replay with content digests. Each fork starts a separate scorecard, replays actions through the production bridge, and refuses mismatched grids. **Mode is matched-cold-runtime**: both arms restart transient Python namespace and extension scheduling state. This controls equal resets across arms; it is not an exact in-memory continuation of the source. Replay actions consume environment actions; prefix and continuation model costs/actions are separately reported. Python history/namespace continuity with the original source remains unverified.

`python -m autoresearch_pi.arc_layered_experiments <left-run> <right-run> --compare` checks equal prefix digests/model/task/budgets and requires the recoverable-fold switch to be the only extension-env difference. It reports both outcomes including errors; a pair is an observation, not a general benefit claim. Transfer export uses the same module without `--compare`, with source run and output manifest arguments.

Verification: seven Python experiment/evolution checks passed, three archive/parent-tool checks passed. Production runner + actual Pi + scripted provider + mock ARC smoke: source snapshot after two actions, two arms each replayed those two actions and executed two new actions to budget; paired report accepted. Smoke artifacts are under the chat work directory `phase3-fork-xjw4ijhh`. No paid Phase 3 provider call. Real folding adoption, target-task transfer quality, full in-memory forks and net benefit remain unverified. Backlog C/D therefore remain open.
