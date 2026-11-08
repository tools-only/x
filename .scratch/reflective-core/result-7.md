# Reflective core result 7 - a10

Date: 2026-11-08 (Asia/Shanghai)

## Change

Commit: `7fa72762 Require reflective API for PPT harness changes`. No a11 run was needed.

Removed agent-facing `save_program`, `self_component`, `edit_program`, and `component_lifecycle` routes. The Python tool no longer accepts its `save` publication argument, and trial agents no longer get program publication or historical-version execution. `reflect_component` now supports `inspect`, `define`, `redefine`, and `restore`. `write`, `edit`, Python file writes, subagent-granted file writes, and trial application refuse harness component paths with a direction to `reflect_component`. The active PPT prompt, optional task guidance, repository AGENTS.md, and development record now describe that single component-change path.

Kickoff: [a10-kickoff.txt](a10-kickoff.txt).

## Offline checks

- `node --experimental-transform-types --test --test-concurrency=1 tests/ppt_demo.test.ts` - passed, 5/5. Covers tool absence, file/edit/Python bypass refusal (including case variants), define/redefine/restore for all five kinds, live consumption, and checker cases.
- `PYTHONPATH=src python -m pytest tests/test_ppt_demo.py` - passed, 1/1.
- `git diff --cached --check` - passed before commit.

These checks establish functional correctness and wiring only.

## Real task a10

- Provider/model: AZ provider from `D:/autoresearch_pi_project/.env`, `az/deepseek-v4-flash`, thinking high; no budget cap.
- Result: completed with `stop: delivered`, revision 2. Three slides and rendered exports were delivered under `runs/ppt-reflective-core-az-v4-a10/delivery/`.
- Usage: 29 rows in `harness/model-usage.jsonl`; final `conservative_usd` was **15.44866**.
- Session audit: 32 tool calls in `session.jsonl`. Counts for `save_program`, `self_component`, `edit_program`, and `component_lifecycle` were all zero.
- Evidence checker: [a10-checker.json](a10-checker.json), `pass: true`; all five kinds were redefined and their version 2 was consumed.

```json
{
  "pass": true,
  "per_kind": {
    "prompt": {
      "pass": true,
      "consumed": [
        {
          "name": "ppt_baseline_guidance",
          "version": 2,
          "boundary": "context_with_system provider request"
        }
      ]
    },
    "skill": {
      "pass": true,
      "consumed": [
        {
          "name": "deck_workflow",
          "version": 2,
          "boundary": "read_component"
        }
      ]
    },
    "tool": {
      "pass": true,
      "consumed": [
        {
          "name": "deck_file_summary",
          "version": 2,
          "boundary": "tool"
        }
      ]
    },
    "subagent": {
      "pass": true,
      "consumed": [
        {
          "name": "deck_reviewer",
          "version": 2,
          "boundary": "subagent"
        }
      ]
    },
    "memory": {
      "pass": true,
      "consumed": [
        {
          "name": "presentation_workflow",
          "version": 2,
          "boundary": "context_with_system provider request"
        }
      ]
    }
  },
  "reflective_redefinitions": 5,
  "reason": "all five redefined versions were consumed"
}
```

## Evidence limits

Functional correctness, full-chain reachability, and autonomous adoption passed for this offline suite and this a10 run. Net benefit remains unverified; no matched task-quality or cost comparison was performed.
