# Kaggle adapter migration onto evo-loop-implementation

## Opportunity and claim

The Kaggle competition adapter was developed on an older PPT/self-harness base while
`evo-loop-implementation` advanced substantially. The adapter needs to be available
on the newer base without changing that branch. This migration adds the Kaggle
task-specific runner, extension, prompts, seed method and focused tests on a
separate branch based at `evo-loop-implementation`.

## Scope

Migrated:

- `demo/kaggle_extension.ts` and `demo/kaggle_task_context.ts`
- Kaggle task/adaptation prompts, self-evolution skill and generic tabular seed
- Kaggle API, runner and DeepSeek thinking proxy modules
- Kaggle API, runner and extension tests

The current branch's unrelated PPT prompt, task-context and demo changes are not
part of this branch. The target branch's reflective evolution loop and existing
runtime files remain unchanged.

## Compatibility assessment

The migrated Kaggle extension depends on the shared `Workspace`, `Binder`,
`PiKernel` and Pi Extension API. These interfaces exist on the target base.
The extension is additive; no evo-loop implementation file was edited for
compatibility during this migration.

## Evaluation

No tests have been run in this migration step. The migrated tests are present:
`tests/kaggle_demo.test.ts`, `tests/test_kaggle_api.py`,
`tests/test_kaggle_runner_pi.py`, and `tests/test_thinking_proxy.py`.
Runtime and provider behavior remain unverified on this base until those checks
are run.
