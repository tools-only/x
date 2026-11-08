# Native reflective resources: change 14

**Change record.** Starting from audited `2f0e74c8e6debb91f26922eecc914cb000c65aac` on `codex/ppt-reflective-core-20261108`, PPT tools and subagents now use same-name Pi tools; skills use Pi's explicit workspace skill index and ordinary confined read; selected inspection reports source, history, native binding and publication failure. Publication checks registry collisions before writes, preserves last-good skill bytes, pins the invoked tool/subagent version, fixes prompt refresh on continuations, and records native use in lineage and delivered evidence. Trials copy native tools and skills through those same resources.

## Validation

- `node --experimental-transform-types --test --test-concurrency=1 tests/ppt_demo.test.ts tests/ppt_trials.test.ts` — 13 passed, 0 failed.
- `node --experimental-transform-types --test --test-concurrency=1 tests/arc_thin_native_runtime.test.ts tests/arc_thin_binder.test.ts` — 21 passed, 0 failed.
- `PYTHONPATH=src python -m pytest tests/test_reflective_core_evidence.py tests/test_ppt_native_pi.py -q` — 12 passed, 0 failed. Installed Pi 0.87.0 with the existing scripted provider `offline-external-test` verified same-session tool name/schema changes, same-byte restore, skill index/body after define/redefine/restore, normal skill reads, and last-good bytes after a rejected missing-description candidate. No network or paid provider was used.
- `git diff --check` — passed.

**Functional correctness:** these offline tests cover publication and collision handling, selected inspection, in-flight tool pinning, skill validation and restoration, prompt/memory/process context, subagent same-model auth/grants/text and image refs/accounting, Trials, delivery of `component_runs.jsonl`, and evidence joins.

**Full-chain offline reachability:** verified for PPT native tools and skills in a real installed-Pi session using the scripted provider, plus child execution through the existing in-process scripted model path. Startup reload is covered. A separate persisted Pi-session resume and a nested child call through installed Pi were not exercised.

**Autonomous adoption:** unverified. **Net benefit:** unverified. No real-provider ARC evaluation was run.

## ARC endpoint migration follow-up

The remaining thin ARC callers were migrated off the generic execution endpoints. Programs now execute through their same-name native tools; named subagents register as same-name tools with the existing `{question, refs?}` schema and child execution. The review call point tracks a named child tool. `run_program`, `consult(agent=...)`, `read_component`, and `list_programs` registrations, active-tool entries, descriptions, and agent-facing guidance were removed. The smoke provider and review tests now call native names. `programCatalog` and `runProgram` were deleted.

**Validation after endpoint migration:**

- `node --experimental-transform-types --test --test-concurrency=1 tests/ppt_demo.test.ts tests/ppt_trials.test.ts` — 13 passed.
- `node --experimental-transform-types --test --test-concurrency=1 tests/arc_thin_native_runtime.test.ts tests/arc_thin_binder.test.ts` — 21 passed.
- Focused ARC review tests in `tests/arc_thin_loop_bound.test.ts` — 2 passed; verified the child tool name/schema, native call and review accounting.
- `PYTHONPATH=src python -m pytest tests/test_reflective_core_evidence.py tests/test_ppt_native_pi.py tests/test_arc_thin_loop_bound.py -q` — 13 passed.
- Existing scripted-provider ARC program smoke — passed all `agent_program_checks` and ended at its configured two-action budget; artifact: `runs/ppt-reflective-core-native-program-smoke-20261109/summary.json`.
- `python -m py_compile src/autoresearch_pi/arc_thin_e2e.py` and `git diff --check` — passed.

The installed-Pi ARC smoke used the mock ARC SDK and `offline-arc-thin-smoke` scripted provider. It verifies the named tool is advertised and called after v1 publication, v2 is published during ADAPT, and the later Task calls v2. It provides offline wiring evidence only.

**Remaining ARC boundary:** the thin ARC extension still has its older `self_component`, `save_tool`, `save_program`, and `promote` publication interfaces. Its component-file reads remain confined and refused, while that path has no `reflect_component(inspect)` implementation. Migrating those older mutation and inspection flows to the owner-approved component primitive is a separate transition with callers in ARC Hook, ADAPT, scripted provider scenarios, and offline run checks; it remains incomplete. There are no compatibility generic execution endpoints left in the runtime path.

Startup reload is tested, but explicit persisted-session resume is unverified. Native `/skill` command/autocomplete registration was not claimed because Pi 0.87.0 has no public mid-turn skill registry API. Deferred checklist A (adapter boundary), B/C (child permissions, evidence and cost), and D (context exposure versus retained use) remain open. See [analysis-native-hotswap.md](analysis-native-hotswap.md) for the scoped design and appended evidence record.
