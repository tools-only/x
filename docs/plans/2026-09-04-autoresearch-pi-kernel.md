# Autoresearch Pi Kernel Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an isolated autoresearch-meta project whose Pi Agent kernel can activate validated harness changes during a task and continue from a checkpoint while using JIT only as a read-only shopping test host.

**Architecture:** A project-local Python supervisor owns checkpoints, harness staging, validation, activation, and recovery. Pi runs as an independent JSONL-RPC child process; a thin adapter forwards task tools to the external JIT checkout. The JIT repository is never imported for mutation or used as the location of runtime artifacts.

**Tech Stack:** Python 3.10+, Pi Agent JSONL RPC, pytest, YAML, external JIT shopping adapter.

---

### Task 1: Pi RPC kernel bridge

**Files:**
- Create: `src/autoresearch_pi/pi_kernel.py`
- Create: `tests/test_pi_kernel.py`

Implement a bounded JSONL client for `pi --mode rpc`, with request IDs, event capture, abort, and clean disposal. Keep the process independent from JIT.

### Task 2: Checkpoint and hot-swap supervisor

**Files:**
- Create: `src/autoresearch_pi/supervisor.py`
- Create: `src/autoresearch_pi/checkpoint.py`
- Create: `tests/test_supervisor.py`

Define a versioned checkpoint schema, stage candidate harnesses, compile/validate them, atomically activate them, restart the action loop, and restore task state.

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
