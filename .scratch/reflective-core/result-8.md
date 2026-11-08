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
