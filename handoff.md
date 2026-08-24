# Meta-Harness Handoff

## Autonomous MVP Direction

- The main `llm` demo now starts only a Meta Harness with a task seed Spec and research objective.
- Meta owns hypotheses, Spec generation, Harness instantiation, experiment count, comparison, iteration, and stopping.
- Kernel-owned Meta primitives are `spec.publish`, `harness.instantiate`, `harness.start`, and `run.observe`.
- Task runtime remains responsible for environment interaction and receives authoritative Episode feedback from the Kernel.
- Every LLM AgentRun persists `transcript.jsonl` with provider request/response and tool result/error records; `result.json` includes `provider_usage`.
- The default autonomous command is `uv run --offline --no-sync hos demo --runtime llm --root .manual-real-llm-run --environment arc3-local --game-id ls20 --seed 0`.

## Completed

- Kernel-managed HarnessRun, AgentRun, EpisodeRun, local ARC-AGI-3 adapter, candidate derivation, Gate, runtime handshake, PID tracking, and lifecycle logs are implemented.
- `llm` is a real OpenAI-compatible Meta/Task runtime. It loads declared skills, sends tool schemas to the configured model, and maps returned tool calls through the Kernel Host Protocol.
- Task tools: `env_open`, `env_observe`, `env_step`, `env_reset`, `env_close`, and `agent_spawn`.
- Meta tools: `spec_publish`, `harness_instantiate`, `harness_start`, and `run_observe`.
- A Meta model receives a task seed Spec and autonomously designs experiments, instantiates Harnesses, starts Task runtimes, observes authoritative EpisodeRun metrics, and decides how to continue.
- `tests/test_llm_runtime.py` uses a local fake OpenAI-compatible server to verify direct Task execution and autonomous Meta Spec -> Harness -> Task -> feedback execution.
- Provider payloads do not include `temperature`; the provider supplies its own default.
- `.env` controls `HOS_LOG_LEVEL`, `HOS_RUNTIME`, `HOS_TASK_PROVIDER`, and `HOS_META_PROVIDER`. `arc3-local` uses `ARC_ENVIRONMENTS_DIR` and does not contact the ARC platform.

## Validation

- Targeted runtime tests passed after the Meta integration test was added.
- The existing full-suite ARC local adapter test may expect `environment_files/` while the active local download directory is `.environment_files/`; investigate separately before treating it as a runtime regression.

## Remaining Work

- Persist an explicit per-AgentRun model transcript and provider token usage. Current evidence is lifecycle/Host Protocol logs plus `stderr.log`.
- Expand the Harness Spec schema only when an autonomous research method demonstrates a real need.
- Add held-out suites, repeated seeds, and statistical analysis as Meta-level methodology, rather than hard-coding them into Kernel orchestration.
- Use a configured local model server for fully offline ARC plus LLM operation; `arc3-local` alone only makes ARC local.

## Running

```powershell
uv run --offline --no-sync hos demo --runtime llm --root .ls20 --environment arc3-local --game-id ls20 --seed 0
```

Set `HOS_RUNTIME=llm` in `.env` to make LLM runtime the default. Keep API keys only in environment variables referenced by `hos.toml`; do not copy secret values into documentation or version control.
