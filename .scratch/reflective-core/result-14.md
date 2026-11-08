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

## Known blocker

The owner-wide removal of generic endpoints is incomplete for the thin ARC caller. `demo/arc_thin_extension.ts` still registers `run_program`, `list_programs`, and `read_component`, and its review scheduler still selects and requires `consult(agent=...)`. The shared runtime's generic `consult` registration has been removed, leaving the ARC scheduler without its expected tool. Migrating this path requires updating its program publication/call model, review call-point tracking, receipts, scripted provider, and associated ARC tests together. The exact affected transition is the selected `consult` tool in `arc_thin_extension.ts` to `NativeRuntime.consult`; ARC migration and preserved ARC behavior remain incomplete.

Startup reload is tested, but explicit persisted-session resume is unverified. Native `/skill` command/autocomplete registration was not claimed because Pi 0.87.0 has no public mid-turn skill registry API. Deferred checklist A (adapter boundary), B/C (child permissions, evidence and cost), and D (context exposure versus retained use) remain open. See [analysis-native-hotswap.md](analysis-native-hotswap.md) for the scoped design and appended evidence record.
