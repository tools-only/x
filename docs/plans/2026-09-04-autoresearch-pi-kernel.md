# Historical plan (superseded): Autoresearch Pi Kernel

> Superseded by `harness-boundary-v1`. Do not use this plan as implementation guidance: its agent-owned harness, source validation, checkpoint, and outer-loop design conflict with the current Pi-native boundary.

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Historical goal:** Build an isolated autoresearch-meta project whose Pi Agent kernel can activate validated harness changes during a task and continue from a checkpoint while using JIT only as a read-only shopping test host.

**Architecture:** A single Pi task agent owns task state, harness validation/activation, and recovery metadata in its run directory. Pi runs as an independent JSONL-RPC child process; a thin adapter forwards optional benchmark tools to the external JIT checkout. The JIT repository is never imported for mutation or used as the location of runtime artifacts.

**Tech Stack:** Python 3.10+, Pi Agent JSONL RPC, pytest, YAML, external JIT shopping adapter.

---

### Task 1: Pi RPC kernel bridge

**Files:**
- Create: `src/autoresearch_pi/pi_kernel.py`
- Create: `tests/test_pi_kernel.py`

Implement a bounded JSONL client for `pi --mode rpc`, with request IDs, event capture, abort, and clean disposal. Keep the process independent from JIT.

### Task 2: Agent-owned harness state and hot mutation

**Files:**
- Create: `src/autoresearch_pi/harness.py`
- Create: `src/autoresearch_pi/task_agent.py`
- Create: `tests/test_task_agent.py`

Define agent-owned harness state, validate candidate source, activate it at a tool-step boundary, and continue the same Pi session without a supervisor or HOS.

### Task 3: Read-only JIT shopping adapter

**Files:**
- Create: `src/autoresearch_pi/jit_adapter.py`
- Create: `tests/test_jit_adapter.py`

Invoke the external JIT test entrypoint without importing or editing JIT source files. Route all outputs into the new project's `runs/` directory.

### Task 4: End-to-end smoke test

**Files:**
- Create: `scripts/run_shopping_smoke.py`
- Modify: `README.md`

Run a small shopping task through Pi, force one harness patch, verify immediate loop restart and checkpoint restoration, then record artifacts locally.
