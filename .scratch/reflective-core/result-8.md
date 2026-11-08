# Reflective core round 8

## Audit

| Tool | Could modify components? | Action taken |
| --- | --- | --- |
| trials | Yes, an isolated agent had generic write/edit/Python/program tools; it could create component files in its scratch workspace. | Removed from the agent toolset; isolated tools no longer reachable from PPT task context. |
| trial_files | No; reports changed scratch files only. | Removed with the unused trial workflow. |
| apply_trial | Could promote component files if its path guard failed; current implementation refuses component storage before copying. | Removed with the unused trial workflow. |
| checkpoint | No component writes; stores task handoff/phase state. | Removed; PPT task no longer exposes phase switching or handoff. |
| list_programs | No; reads the Binder program catalog and versions. | Retained as read-only introspection. |
| python | Can write arbitrary workspace files, including components if boundary is bypassed. The Workspace write guard refuses component paths; workspace confinement excludes harness pointers. | Retained for deck/assets; added bypass assertions for memory, skills, agents, and lib. |
| edit | Can alter component files if boundary is bypassed. Workspace write guard refuses component paths. | Retained for deck editing; existing tool-path bypass assertion remains. |
| write | Can create/overwrite component files if boundary is bypassed. Workspace write guard refuses component paths. | Retained for deck authoring; existing prompt and case-variant tool-path bypass assertions remain. |

## Change and evidence

Failure/opportunity: a10 exposed trial machinery and a task checkpoint action next to the single reflective component API, although the real task needed neither. The trial's private tools made a scratch component-file route available and added a promotion step. Claim: removing unused trial/checkpoint operations leaves `reflect_component` as the only agent-visible component mutation surface, while generic file/Python tools remain useful for presentation work and reject component storage.

Offline evidence: `PYTHONPATH=src python -m pytest tests/test_ppt_demo.py -q` and `node --experimental-transform-types --test --test-concurrency=1 tests/ppt_demo.test.ts` (results to append).

## Real run

Pending Qwen AZ run and checker evidence.

## Offline verification

- `PYTHONPATH=src python -m pytest tests/test_ppt_demo.py -q`: passed, 1 test.
- `node --experimental-transform-types --test --test-concurrency=1 tests/ppt_demo.test.ts`: passed, 5 tests.
- Implementation commit: `ce5bb3cc59f4c941c218cb9137fb8490151ad73c` (`Remove unused PPT component mutation paths`).

## Qwen q1 real run

- Run: `runs/ppt-reflective-core-qwen-q1`; protocol confirmed model `qwen3.8-27b`, provider `AZ https://az.gptplus5.com/v1`, thinking `high`; unbounded.
- Evidence checker: `.scratch/reflective-core/q1-checker.json`; pass, five redefined versions consumed (prompt, skill, tool, subagent, memory).
- Stop: task did not finish. After rendering and inspection, the provider hit an error at request 34 (`stopReason=error`, unknown usage reserved), then request 35 remained unresponsive with no new session or usage log activity. I interrupted the stalled process. Run `summary.json` remains `complete:false, stop:"running"` because interruption prevented runner finalization.
- Slides: 15 authored in `workspace/artifacts/presentation.html`; 0 delivered (no `office(op="deliver")`, no delivery directory).
- Cost: last `conservative_usd` in `harness/model-usage.jsonl` was `$34.43482`; request 34 had unknown usage and reserved 12,000 tokens. Provider request log has 35 requests, including request 35 that did not return.
- Tool calls from `session.jsonl`:

| Tool | Calls |
| --- | ---: |
| reflect_component | 6 |
| read_component | 5 |
| read | 6 |
| write | 2 |
| edit | 1 |
| python | 5 |
| run_program | 2 |
| consult | 3 |
| office | 4 |
| ls | 2 |
| trials | 0 |
| trial_files | 0 |
| apply_trial | 0 |
| checkpoint | 0 |

`list_programs` was not called. The 6 `reflect_component` calls are one inspection and five redefinitions; the real-run checker records a same-version consumption for all five kinds. The reviewer's multiple looks and renders are included in the 4 office tool calls.
