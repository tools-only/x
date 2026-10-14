/**
 * A live Python kernel: one long-lived WASI instance (pi_task_python_kernel.py) that runs cells in one namespace.
 * A cell can ask the host for something (an action, a workspace file) and continues where it asked when the answer
 * comes, so nothing is restarted or replayed. When the process ends (a trap, a timeout, an abort) the kernel is gone
 * and the next cell starts a new one; `fresh` tells the caller that the namespace must be restored.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assertTaskPythonRuntimeAvailable, taskPythonModulePath, TaskPythonError, type ValidatedTaskPythonProgram } from "./pi_task_python.ts";

const host = fileURLToPath(new URL("./pi_task_python_kernel.py", import.meta.url));
/** The kernel's memory lives as long as the kernel, so it gets the runtime's ceiling rather than one call's default. */
const KERNEL_MEMORY_BYTES = 256 * 1024 * 1024;

/** What a cell asks the host mid-execution; the answer is returned to the guest as is. */
export type KernelRequest = { t: "act" | "file"; [key: string]: unknown };
export type KernelMetrics = { wall_ms: number; wait_ms: number; compute_ms: number; startup_ms?: number; compile_ms?: number };
type Cell = { resolve(value: { result: any; metrics: KernelMetrics }): void; reject(error: Error): void;
  onRequest(request: KernelRequest): Promise<unknown> };

export class PythonKernel {
  private child?: ChildProcess;
  private ready?: Promise<{ compile_ms?: number }>;
  private buffer = "";
  private cell?: Cell;
  private chain: Promise<unknown> = Promise.resolve();
  /** Set by kill() or an abort before the process is ended, so its end is reported with the cause. */
  private stopping?: string;
  /** Why the last kernel ended. */
  lastExit?: string;

  constructor(private program: ValidatedTaskPythonProgram) {}

  get alive() { return Boolean(this.child); }

  /** Start the kernel now (it compiles the interpreter once), so the first cell does not wait for it. */
  prewarm() { void this.start().then(() => this.idle(), () => undefined); }

  private start(): Promise<{ compile_ms?: number }> {
    if (this.ready) return this.ready;
    assertTaskPythonRuntimeAvailable(this.program.runtime);
    const child = spawn("python", ["-I", host, taskPythonModulePath()], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, shell: false });
    this.child = child;
    this.stopping = undefined;
    const ready = new Promise<{ compile_ms?: number }>((resolve, reject) => {
      let started = false;
      const end = (reason: string) => {
        if (this.child !== child) return;
        this.child = undefined; this.ready = undefined; this.buffer = ""; this.lastExit = reason;
        const error = new TaskPythonError("kernel_ended", reason);
        if (!started) reject(error);
        const cell = this.cell; this.cell = undefined;
        cell?.reject(error);
      };
      child.on("error", error => end(`the kernel could not start: ${error.message}`));
      child.on("close", () => end(this.stopping ?? "the kernel process ended"));
      child.stderr!.on("data", () => { /* The guest's diagnostics come back in its frames. */ });
      child.stdin!.on("error", () => { /* A closed kernel is reported by close. */ });
      child.stdout!.on("data", (chunk: Buffer) => {
        this.buffer += chunk.toString("utf8");
        let index: number;
        while ((index = this.buffer.indexOf("\n")) >= 0) {
          const line = this.buffer.slice(0, index).trim();
          this.buffer = this.buffer.slice(index + 1);
          if (!line) continue;
          let message: any;
          try { message = JSON.parse(line); } catch { continue; }
          if (message.event === "ready") { started = true; resolve({ compile_ms: message.compile_ms }); }
          else if (message.event === "dead") { end(String(message.error ?? "the kernel ended")); child.kill(); }
          else if (message.event === "done") {
            const cell = this.cell; this.cell = undefined;
            cell?.resolve({ result: message.result, metrics: message.metrics });
          } else if (message.event === "request") {
            const cell = this.cell;
            const answer = cell ? cell.onRequest(message.data).catch((error: unknown) => ({ error: String((error as Error)?.message ?? error) }))
              : Promise.resolve({ error: "no cell is running" });
            void answer.then(data => { if (this.child === child) child.stdin!.write(JSON.stringify({ type: "reply", data }) + "\n"); });
          }
        }
      });
    });
    const limits = { ...this.program.effective_limits, memory_bytes: KERNEL_MEMORY_BYTES };
    child.stdin!.write(JSON.stringify({ source: this.program.source, limits, runtime: this.program.runtime }) + "\n");
    this.ready = ready;
    return ready;
  }

  /** An idle kernel does not keep the Node process alive; a running cell does. */
  private idle() {
    const child = this.child as any;
    child?.unref?.(); child?.stdout?.unref?.(); child?.stderr?.unref?.(); child?.stdin?.unref?.();
  }
  private busy() {
    const child = this.child as any;
    child?.ref?.(); child?.stdout?.ref?.();
  }

  /**
   * Run one cell. Cells run one at a time. An abort ends the kernel (a cell in synchronous code cannot be stopped
   * any other way); what the cell already did through the host stands.
   */
  run(request: Record<string, unknown>, onRequest: Cell["onRequest"], signal?: AbortSignal):
    Promise<{ result: any; metrics: KernelMetrics; fresh: boolean; previousExit?: string }> {
    const go = async () => {
      if (signal?.aborted) throw new TaskPythonError("cancelled", "Python calculation cancelled");
      const fresh = !this.alive, previousExit = fresh ? this.lastExit : undefined;
      const startedAt = performance.now();
      const ready = await this.start();
      const startup = performance.now() - startedAt;
      const child = this.child!;
      this.busy();
      const abort = () => this.kill("the cell was interrupted");
      signal?.addEventListener("abort", abort, { once: true });
      try {
        const done = await new Promise<{ result: any; metrics: KernelMetrics }>((resolve, reject) => {
          this.cell = { resolve, reject, onRequest };
          child.stdin!.write(JSON.stringify({ type: "cell", request }) + "\n");
        });
        return { ...done, metrics: { ...done.metrics, ...(fresh ? { startup_ms: Math.round(startup), compile_ms: ready.compile_ms } : {}) },
          fresh, ...(previousExit ? { previousExit } : {}) };
      } finally { signal?.removeEventListener("abort", abort); this.idle(); }
    };
    const result = this.chain.then(go, go);
    this.chain = result.catch(() => undefined);
    return result;
  }

  /** End the kernel; the next cell starts a new one. */
  kill(reason = "the kernel was stopped") {
    if (!this.child) return;
    this.stopping = reason;
    this.child.kill();
  }

  close() {
    const child = this.child;
    if (!child) return;
    this.stopping = "the kernel was closed";
    try { child.stdin!.write(JSON.stringify({ type: "shutdown" }) + "\n"); } catch { /* already closed */ }
    child.kill();
  }
}
