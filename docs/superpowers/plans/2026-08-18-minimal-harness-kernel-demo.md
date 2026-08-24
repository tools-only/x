# Minimal Harness Kernel Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a directly runnable local demo in which the file-native Kernel resolves a componentized HarnessSpec, launches root/subagent processes, owns an ARC-AGI-3 episode, persists evidence, derives immutable candidates, and cold-starts an M1 meta harness through a Gate.

**Architecture:** Python 3.12 standard-library-first package. Typed manifests are content-addressed Objects; resolved HarnessSpecs become locks; a synchronous supervisor launches each AgentRun as a subprocess speaking JSONL Host Protocol; environment calls remain in the Kernel process; the meta fixture exercises candidate publication and nested HarnessRuns. A deterministic fixture proves infrastructure without credentials, while the ARC adapter uses the official `arc-agi` package when available.

**Tech Stack:** Python 3.12, pytest, JSON/JSONL, subprocess/stdio, optional `arc-agi`.

**Spec:** `outputs/meta-harness-kernel-managed-runtime-arc3-demo-v0.2.md`

**Execution status:** Completed on 2026-08-18. Verified with 16 passing tests, a credential-free fixture run, and an official ARC-AGI-3 run that discovered 25 environments and executed six `dc22` EpisodeRuns.

## Global Constraints

- Keep Object, Ref, Run, and Event as the only storage primitives.
- Every stateful root agent and subagent must be a separate subprocess and AgentRun.
- ARC sessions are Host-owned EpisodeRuns; agent-reported score is never authoritative.
- Runtime definition changes publish a new immutable object graph; active locks never mutate.
- The demo may use a deterministic agent fixture to validate orchestration, but must label it as an infrastructure fixture rather than evidence of emergent methodology.
- No daemon, database, queue, container, Web UI, or distributed execution.
- Do not use the Git repository rooted at `C:\Users\qi`; this workspace is not an isolated project repository.

---

### Task 1: Content-addressed Objects and Harness Resolver

**Files:**
- Create: `pyproject.toml`
- Create: `src/hos/__init__.py`
- Create: `src/hos/store.py`
- Create: `src/hos/resolver.py`
- Create: `tests/test_store_resolver.py`

**Interfaces:**
- Produces: `ObjectStore.publish(manifest, payload) -> str`
- Produces: `ObjectStore.read(ref) -> dict`
- Produces: `ObjectStore.set_ref(name, digest)` and `resolve_ref(ref) -> str`
- Produces: `resolve_harness(store, harness_ref) -> dict`
- The lock contains exact digests for harness, root agent, loop, policy, skills, tools, memory, subagents, environment, evaluator, and ruleset.

- [ ] Write tests proving deterministic digest, immutability, mutable refs, recursive graph resolution, component-level digest changes, and cycle/missing-ref rejection.
- [ ] Run `python -m pytest tests/test_store_resolver.py -q` and observe failure because `hos.store` does not exist.
- [ ] Implement only the store and resolver behavior exercised by the tests.
- [ ] Re-run the focused test and then `python -m pytest -q`.

### Task 2: HarnessRun, AgentRun, Host Protocol, and Subagent Spawn

**Files:**
- Create: `src/hos/events.py`
- Create: `src/hos/supervisor.py`
- Create: `src/hos/runtime.py`
- Create: `src/hos/environments.py`
- Create: `tests/test_supervisor.py`

**Interfaces:**
- Consumes: resolved harness lock from Task 1.
- Produces: `Supervisor.start_harness(harness_ref, job, parent_run=None) -> HarnessResult`
- Produces Host methods: `component.load`, `agent.spawn`, `agent.wait`, `env.open`, `env.observe`, `env.step`, `env.reset`, `env.close`.
- Produces Run directories with `kind`, `status.json`, `events.jsonl`, `result.json`, parent links, and child indexes.
- `runtime.py` is launched with `python -m hos.runtime` and speaks line-delimited JSON on stdin/stdout.

- [ ] Write tests proving root AgentRun is a child subprocess, a declared critic is a separate AgentRun, undeclared spawn is denied, and parent/child results and budgets are persisted.
- [ ] Run `python -m pytest tests/test_supervisor.py -q` and observe the missing-module failure.
- [ ] Implement the JSONL subprocess supervisor and deterministic task/critic runtime.
- [ ] Re-run the focused test and the full suite.

### Task 3: Kernel-owned ARC Adapter and EpisodeRun

**Files:**
- Modify: `src/hos/environments.py`
- Modify: `src/hos/supervisor.py`
- Create: `tests/test_environment_episode.py`
- Create: `tests/test_arc_adapter.py`

**Interfaces:**
- Produces: `DeterministicArcFixture` for credential-free tests.
- Produces: `ArcAgi3Adapter` that dynamically discovers games and maps `open/step/reset/close` to the official Toolkit.
- Every environment session creates an EpisodeRun; authoritative scorecard and recording paths live there.

- [ ] Write a failing real-behavior test for the deterministic adapter and EpisodeRun evidence.
- [ ] Implement the adapter boundary and make the test pass.
- [ ] Write an ARC package contract test that skips only when `arc_agi` is absent and otherwise calls environment discovery without inventing game IDs.
- [ ] Run focused and full tests.

### Task 4: Immutable Candidate Derivation, Nested HarnessRuns, M0/M1 Gate

**Files:**
- Create: `src/hos/candidates.py`
- Create: `src/hos/gate.py`
- Create: `src/hos/demo.py`
- Create: `src/hos/cli.py`
- Create: `tests/test_candidates.py`
- Create: `tests/test_meta_demo.py`
- Create: `README.md`

**Interfaces:**
- Produces: `derive_harness(store, base, patch, created_by_run) -> str`, supporting skill replacement and declared subagent addition.
- Produces meta Host calls: `candidate.publish`, `harness.start`, `run.observe`, and `candidate.propose`.
- Produces: `run_demo(root, environment='fixture'|'arc3') -> dict` with M0, M1, task candidate, Run tree, and Gate record.
- Produces CLI: `hos init`, `hos inspect`, and `hos demo --root <path> --environment fixture|arc3`.

- [ ] Write tests proving a skill-only patch changes only the expected graph path and a subagent patch produces a Kernel-spawnable AgentSpec.
- [ ] Implement candidate derivation minimally and make tests pass.
- [ ] Write an end-to-end failing test that requires `M0 Harness → HM0 → M1 Harness → HM1 → Task Harness → Task/critic/Episode Runs → Gate record`.
- [ ] Implement deterministic M0/M1 orchestration and Gate; do not claim this fixture demonstrates emergent research behavior.
- [ ] Add CLI and README with fixture and real ARC commands.
- [ ] Run `python -m pytest -q`, `python -m hos.cli demo --root .demo-hos --environment fixture`, and inspect the emitted run tree and Gate JSON.

### Task 5: Fresh Verification

**Files:**
- Modify only files required by failures found during verification.

- [ ] Remove generated `.demo-hos` state, rerun the complete test suite, and confirm zero failures.
- [ ] Run the fixture demo from an empty root and confirm it creates immutable objects, M0/M1 HarnessRuns, task/subagent AgentRuns, an EpisodeRun, and a Gate record.
- [ ] If `arc-agi` can be installed and environments are discoverable, run the ARC smoke path; otherwise report the exact external blocker without claiming ARC execution.
- [ ] Compare delivered behavior line-by-line with the v0.2 spec and report explicit deferred items.
