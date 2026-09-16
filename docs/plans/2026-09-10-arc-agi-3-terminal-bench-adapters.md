# ARC-AGI-3 and Terminal-Bench Adapter Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add constitution-compliant ARC-AGI-3 and Terminal-Bench test environments that run Pi as the sole agent runtime and emit the existing task-local Auto-Research/self-harness evidence model.

**Architecture:** A small shared Pi extension owns versioned findings, exact observation references, optional agent-selected context compaction, and append-only evidence. ARC-AGI-3 uses a project-owned localhost bridge around the official local SDK; Terminal-Bench uses a project-owned Harbor `BaseInstalledAgent` that installs Pi plus the same extension inside the task container. Benchmark adapters only launch, isolate, collect native evaluation, and project summaries.

**Tech Stack:** Python 3.10+, Pi TypeScript extensions, ARC-AGI-3 Python SDK, Harbor 0.21, Docker, pytest.

---

### Task 1: Configuration and CLI contracts

**Files:**
- Modify: `src/autoresearch_pi/cli.py`
- Modify: `src/autoresearch_pi/project.py`
- Create: `tests/test_external_benchmark_cli.py`
- Create: `.env.example`

**Steps:**
1. Write failing CLI tests for `arc-agi-3-e2e` and `terminal-bench-e2e` argument routing.
2. Verify failure because commands and project paths do not exist.
3. Add project-owned ARC and Terminal-Bench path configuration and CLI commands.
4. Verify focused tests pass.

### Task 2: Shared Pi task-local research extension

**Files:**
- Create: `demo/pi_external_benchmark_research.ts`
- Create: `tests/pi_external_benchmark_provider.ts`
- Create: `tests/test_pi_external_benchmark_native.py`

**Steps:**
1. Write an installed-Pi test expecting a real tool observation, finding version, immutable compaction decision, next-request exposure, effect assessment, and assessment absorption.
2. Verify failure because the extension is absent.
3. Implement the minimal shared extension with `tool_result`, `research_resource`, and opt-in exact-observation context compaction.
4. Verify control mode exposes no research/mutation surface and treatment mode completes the mechanical lifecycle.

### Task 3: ARC-AGI-3 adapter

**Files:**
- Create: `src/autoresearch_pi/arc_agi_3_bridge.py`
- Create: `src/autoresearch_pi/arc_agi_3_e2e.py`
- Create: `demo/pi_arc_agi_3_extension.ts`
- Create: `tests/test_arc_agi_3_e2e.py`

**Steps:**
1. Write failing tests for frame serialization, action validation, incremental trace preservation, and normalized scorecard summary.
2. Verify expected failures.
3. Implement a localhost-only bridge process using the official SDK from the configured local checkout.
4. Register ARC state/action tools in Pi and attach the shared research extension.
5. Implement the single-game runner and keep native scorecard correctness separate from self-harness effects.
6. Verify focused tests with a fake bridge/runner, then run a prerequisite-only local check without consuming an ARC scorecard.

### Task 4: Terminal-Bench adapter

**Files:**
- Create: `src/autoresearch_pi/terminal_bench_agent.py`
- Create: `src/autoresearch_pi/terminal_bench_e2e.py`
- Create: `demo/pi_terminal_bench_extension.ts`
- Create: `tests/test_terminal_bench_e2e.py`

**Steps:**
1. Write failing tests for Harbor command construction, task filtering, result discovery, reward projection, and interrupted artifact retention.
2. Verify expected failures.
3. Implement the project-owned Harbor Pi adapter, upload both extension files into the task container, and retain native terminal tools.
4. Implement the single-task runner and normalized summary without treating verifier reward as harness improvement.
5. Verify focused tests and Harbor `--print-config` integration without running Docker workload.

### Task 5: Documentation and regression verification

**Files:**
- Modify: `README.md`
- Modify: `demo/README.md`

**Steps:**
1. Add Git Bash examples, prerequisites, configuration ownership, and evidence interpretation.
2. Run all new focused tests.
3. Run the existing full pytest suite.
4. Run `git diff --check` and inspect the scoped diff.

