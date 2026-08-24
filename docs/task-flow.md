# Task-Only Harness Flow

The first RSI phase runs only the Task Harness. Meta Harness execution is
intentionally disabled; a human or external model supplies candidate patches.

## Controller-based experiments

The experiment runner uses the same Task Pipeline for different research
controllers. Use `fixed-task` for a standalone Task Agent baseline; it reuses a
fixed Harness, disables knowledge writes, and never invokes a Meta Agent:

```powershell
uv run --no-sync hos experiment run `
  --root .experiments\fixed-task `
  --suite experiments/terminal-bench-2.toml `
  --controller fixed-task `
  --max-cycles 1
```

The default controller is `meta`. `continual-harness` runs the HOS-native
four-component self-evolution baseline; `rule-search` remains reserved for an
external adapter. Keep each controller in a separate root so Harness refs,
evolution state, and knowledge cannot leak between methods.

## Run a baseline Task Harness

```powershell
uv run --no-sync hos task run --root .task-hos --environment arc3-local --game-id ls20
```

This creates `refs/harness/task/current` and writes one HarnessRun, one
AgentRun, and one EpisodeRun. It does not create `refs/harness/meta/current`.

## Publish a candidate

Create a JSON patch such as:

```json
{
  "replace_skill": {
    "name": "strategy",
    "content": "candidate-strategy"
  }
}
```

Publish it without changing the current ref:

```powershell
uv run --no-sync hos candidate publish `
  --root .task-hos `
  --target ref:harness/task/current `
  --patch .\candidate-patch.json
```

## Evaluate and promote

The task job is separate from any Meta Goal:

```json
{
  "kind": "task",
  "case": {
    "game_id": "ls20",
    "seed": 0
  }
}
```

Run the cold comparison:

```powershell
uv run --no-sync hos gate evaluate-task `
  --root .task-hos `
  --baseline ref:harness/task/current `
  --candidate sha256:<candidate-digest> `
  --job .\task-job.json
```

Only a `promoted` decision updates `refs/harness/task/current`. Meta Goal and
Meta Harness execution can be added later as a separate proposal producer.

## Run bundled ARC-AGI-3 locally

The repository includes a downloaded `dc22` environment under
`.environment_files/`. `arc3-local` forces the official Toolkit into
`OperationMode.OFFLINE`, so it does not request an API key or call the remote
game-discovery endpoint:

```powershell
uv run --no-sync hos task run --root .arc3-local-hos --environment arc3-local --game-id dc22-fdcac232 --seed 0
```
