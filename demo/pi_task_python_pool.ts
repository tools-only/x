/** Persistent sandbox host for repeated board evaluations of saved task Python.
 * Every request still runs in a fresh WASI instance; only module compilation is reused.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assertTaskPythonRuntimeAvailable, taskPythonModulePath, taskPythonResult, TaskPythonError,
	type ValidatedTaskPythonProgram } from "./pi_task_python.ts";

const server = fileURLToPath(new URL("./pi_task_python_server.py", import.meta.url));
type Pending = { id: number; resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };

export class TaskPythonPool {
	private child?: ChildProcess;
	private ready?: Promise<void>;
	private buffer = "";
	private nextId = 1;
	private pending = new Map<number, Pending>();
	private chain: Promise<unknown> = Promise.resolve();

	private start(): Promise<void> {
		if (this.ready) return this.ready;
		const child = spawn("python", ["-I", server, taskPythonModulePath()], {
			stdio: ["pipe", "pipe", "pipe"], windowsHide: true, shell: false,
		});
		this.child = child;
		this.ready = new Promise<void>((resolve, reject) => {
			let started = false;
			const fail = (error: Error) => {
				if (!started) reject(error);
				for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error); }
				this.pending.clear();
				if (this.child === child) { this.child = undefined; this.ready = undefined; this.buffer = ""; }
			};
			child.on("error", error => fail(new TaskPythonError("environment_unavailable", error.message)));
			child.on("close", () => fail(new TaskPythonError("environment_unavailable", "Python board host exited")));
			child.stderr!.on("data", () => { /* Diagnostics are returned per request. */ });
			child.stdout!.on("data", (chunk: Buffer) => {
				this.buffer += chunk.toString("utf8");
				let index: number;
				while ((index = this.buffer.indexOf("\n")) >= 0) {
					const line = this.buffer.slice(0, index).trim();
					this.buffer = this.buffer.slice(index + 1);
					if (!line) continue;
					let message: any;
					try { message = JSON.parse(line); } catch { continue; }
					if (message.id === null) {
						if (message.ready) { started = true; resolve(); }
						else fail(new TaskPythonError("environment_unavailable", String(message.error ?? "Python board host failed")));
						continue;
					}
					const item = this.pending.get(Number(message.id));
					if (!item) continue;
					this.pending.delete(item.id);
					clearTimeout(item.timer);
					item.resolve(message.result);
				}
				if (!this.pending.size) this.idle();
			});
		});
		return this.ready;
	}

	private idle() {
		this.child?.unref();
		(this.child?.stdout as any)?.unref?.();
		(this.child?.stderr as any)?.unref?.();
		(this.child?.stdin as any)?.unref?.();
	}

	private busy() {
		this.child?.ref();
		(this.child?.stdout as any)?.ref?.();
	}

	/** Evaluate one validated Python program. Calls are serialized. */
	evaluate(program: ValidatedTaskPythonProgram, input: Record<string, unknown>, signal?: AbortSignal) {
		const queuedAt=performance.now();
		const run = async () => {
			const began=performance.now(), queueMs=began-queuedAt;
			if (signal?.aborted) throw new TaskPythonError("cancelled", "Python calculation cancelled");
			assertTaskPythonRuntimeAvailable(program.runtime);
			const limits = program.effective_limits;
			if (Buffer.byteLength(JSON.stringify(input)) > limits.input_bytes)
				throw new TaskPythonError("invalid_input", "Input exceeds input_bytes", "$input");
			const startupAt=performance.now(); await this.start(); const startupMs=performance.now()-startupAt;
			const child = this.child!;
			this.busy();
			const id = this.nextId++;
			const abort = () => { child.kill(); };
			signal?.addEventListener("abort", abort, { once: true });
			let response:any;
			try { response = await new Promise<any>((resolve, reject) => {
				// The guest epoch deadline enforces timeout_ms; this host deadline only
				// recovers from a wedged host process.
				const timer = setTimeout(() => {
					this.pending.delete(id);
					reject(new TaskPythonError("timeout", "Python board host exceeded its deadline", "$program", undefined, limits));
					child.kill();
				}, limits.timeout_ms + 10_000);
				this.pending.set(id, { id, resolve, reject, timer });
				child.stdin!.write(JSON.stringify({ id, request: { source: program.source, input, limits,
					runtime: program.runtime } }) + "\n");
			}); } finally {signal?.removeEventListener('abort',abort);}
			if (signal?.aborted) throw new TaskPythonError("cancelled", "Python calculation cancelled");
			return {...taskPythonResult(program, response),transport:{queue_ms:queueMs,startup_ms:startupMs,host_wall_ms:performance.now()-began}};
		};
		const result = this.chain.then(run, run);
		this.chain = result.catch(() => undefined);
		return result;
	}

	close() {
		const child = this.child;
		this.child = undefined;
		this.ready = undefined;
		child?.stdin?.end();
		child?.kill();
	}
}

let shared: TaskPythonPool | undefined;
export function sharedTaskPythonPool(): TaskPythonPool {
	return shared ??= new TaskPythonPool();
}
