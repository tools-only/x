/** Kaggle host: agent-owned solution work, versioned methods, and real leaderboard feedback. */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import { validateToolArguments } from "@earendil-works/pi-ai";
import { compact, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Workspace } from "./arc_thin_workspace.ts";
import { Binder } from "./arc_thin_binder.ts";
import { validatePythonComponent } from "./arc_thin_components.ts";
import { projectKaggleTaskContext } from "./kaggle_task_context.ts";

type Json = Record<string, any>;

const text = (value: unknown, terminate = false, isError = false): any => ({
  content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
  terminate, isError,
});

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, Math.round(value)));

/** Strict OpenAI-compatible providers reject {"type":"null"} branches and object schemas without `required`. */
function providerToolSchema(node: any): any {
  if (Array.isArray(node)) return node.map(providerToolSchema);
  if (!node || typeof node !== "object") return node;
  const out: any = {};
  for (const [key, value] of Object.entries(node)) out[key] = providerToolSchema(value);
  for (const key of ["anyOf", "oneOf"]) {
    if (!Array.isArray(out[key])) continue;
    const kept = out[key].filter((item: any) => item?.type !== "null");
    if (kept.length === 1) {
      const { anyOf, oneOf, ...rest } = out;
      return providerToolSchema({ ...rest, ...kept[0] });
    }
    out[key] = kept;
  }
  if (out.type === "object" && !Array.isArray(out.required)) out.required = [];
  return out;
}

/** Keep both ends of a long stream: a traceback ends with the cause, a log opens with the setup. */
function clip(value: string, limit = 14000) {
  if (value.length <= limit) return value;
  const head = Math.floor(limit * 0.35), tail = limit - head;
  return `${value.slice(0, head)}\n...[${value.length - limit} chars omitted; full log is saved]...\n${value.slice(-tail)}`;
}

function summarizePythonOutput(value: string, limit: number) {
  const lines = value.split(/\r?\n/);
  const retained: string[] = [];
  let omitted = 0, inKnownWarning = false;
  for (const line of lines) {
    if (/LGBMDeprecationWarning|eval_set.*deprecated|site-packages[\\/]lightgbm[\\/]sklearn\.py:\d+/.test(line)) {
      omitted++;
      inKnownWarning = true;
    } else if (inKnownWarning && (!line.trim() || /^\s/.test(line))) {
      omitted++;
      if (!line.trim()) inKnownWarning = false;
    } else {
      inKnownWarning = false;
      retained.push(line);
    }
  }
  const summary = `${omitted ? `[${omitted} repeated LightGBM deprecation lines omitted]\n` : ""}${retained.join("\n")}`;
  return clip(summary, limit);
}

export default function kaggleDemo(pi: ExtensionAPI) {
  const root = process.env.KAGGLE_DEMO_ROOT!;
  const workspace = new Workspace(root, { dirs: ["data/raw", "work/snippets", "submissions", "notes", "prompts", "skills", "agents", "tools", "methods", "results", "config"] });
  const binder = new Binder(workspace, validatePythonComponent);
  const basePrompt = readFileSync(fileURLToPath(new URL("./prompts/kaggle_demo_system.md", import.meta.url)), "utf8");
  const adaptPrompt = readFileSync(fileURLToPath(new URL("./prompts/kaggle_adapt_system.md", import.meta.url)), "utf8");
  const activePromptText = () => binder.active().filter(c => c.kind === "prompt").map(c => `${binder.label(c.path)}\n${c.body}`).join("\n\n");
  const componentIndex = () => {
    const components = binder.active();
    const versions = binder.versionMap();
    const memory = workspace.files().filter(path => /^notes\/memory\/[^/]+\.md$/.test(path)).map(path => {
      const source = workspace.read(path);
      const description = source.split(/\r?\n/).find(line => line.trim())?.replace(/^#+\s*/, "") ?? "";
      return `${basename(path, ".md")}@v${versions[path] ?? 1} | ${description.slice(0, 120)}`;
    });
    return ["prompt", "memory", "skill", "tool", "subagent"].map(kind => {
      const rows = kind === "memory" ? memory : components.filter(component => component.kind === kind)
        .map(component => {
          const description = kind === "tool" ? /^# description:\s*(.+)$/m.exec(component.source)?.[1] ?? component.description : component.description;
          return `${component.name}@v${component.version} | ${description.slice(0, 120)}`;
        });
      return `${kind}:\n${rows.length ? rows.map(row => `- ${row}`).join("\n") : "- none"}`;
    }).join("\n");
  };
  const systemPrompt = () => `${basePrompt}\n\nHarness component index (read_component(name) for details; run_harness_tool or run_agent to use tools and subagents):\n${componentIndex()}\n\n${activePromptText()}`;
  const competition = JSON.parse(readFileSync(workspace.path("data/competition.json"), "utf8"));
  const python = process.env.KAGGLE_DEMO_PYTHON ?? "python";
  const helper = fileURLToPath(new URL("../src/autoresearch_pi/kaggle_api.py", import.meta.url));
  mkdirSync(join(root, "harness"), { recursive: true });
  mkdirSync(join(root, ".harness", "method-versions"), { recursive: true });
  const statePath = join(root, ".harness", "kaggle-loop.json");
  const state: any = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8"))
    : { revision: 0, complete: false, submissions: [], best: null, pythonRuns: 0 };
  state.harnessReflections ??= [];
  state.toolSequence ??= 0;
  const methodPath = join(root, ".harness", "methods.json");
  const methods: Record<string, any> = existsSync(methodPath) ? JSON.parse(readFileSync(methodPath, "utf8")) : {};
  let resumed = false, initialized = false;
  const persist = () => writeFileSync(statePath, JSON.stringify(state, null, 2));
  const persistMethods = () => writeFileSync(methodPath, JSON.stringify(methods, null, 2));
  const log = (file: string, row: any) => appendFileSync(join(root, "harness", file), JSON.stringify({ time: new Date().toISOString(), ...row }) + "\n");
  const readLog = (file: string) => existsSync(join(root, "harness", file))
    ? readFileSync(join(root, "harness", file), "utf8").split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)) : [];

  const previousRequests = readLog("provider-requests.jsonl");
  const previousUsage = readLog("model-usage.jsonl");
  const lastUsage = previousUsage.at(-1);
  const reserve = Number(process.env.KAGGLE_DEMO_REQUEST_RESERVE_USD ?? 3.52);
  const cap = Number(process.env.KAGGLE_DEMO_BUDGET_USD ?? 12);
  const spendNotice = Number(process.env.KAGGLE_DEMO_SPEND_NOTICE_USD ?? 12);
  const inputRate = Number(process.env.KAGGLE_DEMO_INPUT_USD_PER_MILLION ?? 20);
  const outputRate = Number(process.env.KAGGLE_DEMO_OUTPUT_USD_PER_MILLION ?? 80);
  const cacheReadRate = Number(process.env.KAGGLE_DEMO_CACHE_READ_USD_PER_MILLION ?? inputRate);
  const cacheWriteRate = Number(process.env.KAGGLE_DEMO_CACHE_WRITE_USD_PER_MILLION ?? inputRate);
  let requests = previousRequests.at(-1)?.request ?? 0, reserved = 0;
  let spent = (lastUsage?.conservative_usd ?? 0) + Math.max(0, requests - (lastUsage?.request ?? 0)) * reserve;

  const currentState = () => {
    const latestScored = (state.submissions ?? []).filter((row: any) => Number.isFinite(Number(row.public_score))).at(-1);
    const pending = latestScored && !state.harnessReflections.some((reflection: any) =>
      Number(reflection.submission_ref) === Number(latestScored.ref));
    return {
      competition: { slug: competition.slug, metric: competition.metric, target_top: competition.target_top },
      estimated_provider_spend_usd: Number(spent.toFixed(6)),
      spend_notice_usd: Number.isFinite(spendNotice) ? spendNotice : null,
      best: state.best,
      submissions: state.submissions.slice(-8),
      recent_harness_reflections: state.harnessReflections.slice(-2).map((reflection: any) => ({
        submission_ref: reflection.submission_ref, public_score: reflection.public_score,
        harness_gap: reflection.process_gap, strategy_change: reflection.strategy_change, next_test: reflection.next_test,
      })),
      latest_full_leaderboard: state.latestFullLeaderboard ?? null,
      harness_tools: binder.active().filter(component => component.kind === "tool" && component.path.startsWith("tools/"))
        .map(component => ({ name: component.name, version: component.version, description: component.description })),
      pending_harness_reflection: pending ? latestScored.ref ?? latestScored.file : null,
      methods: Object.entries(methods).map(([name, m]: [string, any]) => ({ name, version: m.version, description: m.description, runs: m.runs ?? 0 })),
      remaining_submission_allowance: state.limits?.num_allowed_now ?? null,
    };
  };

  const modelResult = async (create: any, kind = "consult") => {
    if (Date.now() > Number(process.env.KAGGLE_DEMO_DEADLINE) || spent + reserve > cap) {
      writeFileSync(join(root, "budget-stop.json"), JSON.stringify({ spent, requests, reason:
        Date.now() > Number(process.env.KAGGLE_DEMO_DEADLINE) ? "runtime boundary" : "hard spend boundary" }));
      process.exit(0);
    }
    spent += reserve;
    if (spent >= spendNotice && !state.spendNoticeAt) {
      state.spendNoticeAt = new Date().toISOString();
      log("spend-notices.jsonl", { spent, threshold: spendNotice, requests });
      persist();
    }
    const request = ++requests;
    log("provider-requests.jsonl", { request, kind, estimated_usd_so_far: spent });
    let reply;
    try { reply = await create().result(); reply.autoresearchRequestId = request; }
    catch (error) {
      log("model-usage.jsonl", { request, kind, usage: null, conservative_usd: spent, usage_status: "unknown_reserved", error: String(error).slice(0, 1200) });
      if (error && typeof error === "object") (error as any).providerRequestId = request;
      throw error;
    }
    const u = reply.usage ?? {};
    const known = Number.isFinite(u.input) && Number.isFinite(u.output) && u.input + u.output > 0;
    if (known) spent += ((u.input ?? 0) * inputRate + (u.cacheRead ?? 0) * cacheReadRate + (u.cacheWrite ?? 0) * cacheWriteRate + (u.output ?? 0) * outputRate) / 1e6 - reserve;
    log("model-usage.jsonl", { request, kind, usage: known ? u : null, conservative_usd: spent, usage_status: known ? "reported" : "unknown_reserved", stopReason: reply.stopReason });
    return reply;
  };

  /** Host Python: real scientific packages, workspace cwd, no provider or Kaggle credentials. */
  const pythonEnv = () => {
    const keep = ["PATH", "Path", "SYSTEMROOT", "SystemRoot", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA", "APPDATA",
      "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "COMSPEC", "PATHEXT", "WINDIR", "HOMEDRIVE", "HOMEPATH"];
    const env: Record<string, string> = {};
    for (const key of keep) if (process.env[key]) env[key] = process.env[key]!;
    Object.assign(env, {
      PYTHONUNBUFFERED: "1", PYTHONIOENCODING: "utf-8", PYTHONDONTWRITEBYTECODE: "1",
      KAGGLE_DEMO_ROOT: root, KAGGLE_COMPETITION: competition.slug,
      KAGGLE_DATA_DIR: workspace.path("data/raw"), KAGGLE_WORK_DIR: workspace.path("work"),
      KAGGLE_SUBMISSIONS_DIR: workspace.path("submissions"), KAGGLE_RESULTS_DIR: workspace.path("results"),
      KAGGLE_LOG_DIR: join(root, "harness", "python"),
      KAGGLE_CONFIG_DIR: join(root, ".harness", "no-credentials"),
      OMP_NUM_THREADS: process.env.KAGGLE_DEMO_THREADS ?? "8",
      MKL_NUM_THREADS: process.env.KAGGLE_DEMO_THREADS ?? "8",
    });
    return env;
  };
  const runProcess = (command: string, args: string[], timeoutMs: number, signal?: AbortSignal, extraEnv?: Record<string, string>) =>
    new Promise<{ code: number | null; stdout: string; stderr: string; durationMs: number; timedOut: boolean }>((resolve) => {
      const started = Date.now();
      const child = spawn(command, args, { cwd: workspace.root, env: { ...pythonEnv(), ...(extraEnv ?? {}) }, windowsHide: true, shell: false });
      let stdout = "", stderr = "", settled = false, timedOut = false;
      const append = (current: string, chunk: Buffer) => (current + chunk.toString("utf8")).slice(-2_000_000);
      child.stdout!.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk); });
      child.stderr!.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk); });
      const finish = (code: number | null) => {
        if (settled) return; settled = true; clearTimeout(timer);
        resolve({ code, stdout, stderr, durationMs: Date.now() - started, timedOut });
      };
      const timer = setTimeout(() => {
        timedOut = true;
        if (process.platform === "win32" && child.pid) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
        else child.kill("SIGKILL");
      }, timeoutMs);
      const abort = () => { timedOut = true; if (process.platform === "win32" && child.pid) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }); else child.kill("SIGKILL"); };
      signal?.addEventListener("abort", abort, { once: true });
      child.on("error", error => { stderr += `\nspawn error: ${error.message}`; finish(null); });
      child.on("close", code => { signal?.removeEventListener("abort", abort); finish(code); });
    });

  const runPython = async (a: any, signal?: AbortSignal) => {
    if ((a.code === undefined) === (a.path === undefined)) throw Error("Supply exactly one of code or path.");
    let rel = a.path;
    if (a.code !== undefined) {
      state.pythonRuns = (state.pythonRuns ?? 0) + 1;
      rel = `work/snippets/snippet-${String(state.pythonRuns).padStart(3, "0")}.py`;
      workspace.runtimeWrite(rel, a.code);
    }
    workspace.path(rel);
    if (!existsSync(workspace.path(rel))) throw Error(`Python file does not exist: ${rel}`);
    const timeout = clamp(Number(a.timeout_s ?? 900), 1, 7200);
    const full = await runProcess(python, ["-I", "-B", workspace.path(rel), JSON.stringify(a.args ?? {})], timeout * 1000, signal);
    const id = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const outDir = join(root, "harness", "python");
    mkdirSync(outDir, { recursive: true });
    const logPath = join(outDir, `${id}.log`);
    writeFileSync(logPath, `$ ${python} -I -B ${rel}\n\n--- stdout ---\n${full.stdout}\n\n--- stderr ---\n${full.stderr}\n`);
    const receipt = {
      ok: full.code === 0 && !full.timedOut, exit_code: full.code, timed_out: full.timedOut,
      duration_s: Math.round(full.durationMs / 100) / 10, path: rel,
      stdout: summarizePythonOutput(full.stdout, 4500), stderr: summarizePythonOutput(full.stderr, 2500), full_log: `harness/python/${id}.log`,
    };
    log("python-runs.jsonl", { ...receipt, stdout_chars: full.stdout.length, stderr_chars: full.stderr.length });
    if (receipt.ok) state.lastExperimentSequence = state.currentToolSequence ?? 0;
    persist();
    return receipt;
  };

  const runHarnessTool = async (a: any, signal?: AbortSignal) => {
    const component = binder.active().find(item => item.kind === "tool" && item.path === `tools/${a.name}.py`);
    if (!component) throw Error(`No active harness tool named ${a.name}.`);
    const source = a.version === undefined ? component.source : binder.sourceOf(component.path, a.version);
    if (source === undefined) throw Error(`Harness tool ${a.name} has no version ${a.version}.`);
    const script = `${source}\nimport json\nimport sys\nif "run" not in globals():\n    raise RuntimeError("Harness tool must define run(args)")\nresult = run(json.loads(sys.argv[1]))\nprint(json.dumps(result, ensure_ascii=False, default=str))\n`;
    const path = `work/snippets/harness-tool-${a.name}-${state.currentToolSequence}.py`;
    workspace.runtimeWrite(path, script);
    const receipt = await runPython({ path, args: a.args ?? {}, timeout_s: a.timeout_s }, signal);
    log("harness-tool-runs.jsonl", { name: a.name, active_version: component.version,
      executed_version: a.version ?? component.version, args: a.args ?? {}, receipt });
    return receipt;
  };

  const validateMethod = (source: string) => {
    const result = spawnSync(python, ["-I", "-c", "import ast,sys; ast.parse(sys.stdin.read())"], {
      input: source, encoding: "utf8", windowsHide: true, timeout: 30000,
    });
    if (result.status !== 0) throw Error(`Python syntax error: ${(result.stderr ?? "").slice(-1500)}`);
  };
  const methodFile = (name: string, version?: number) => version
    ? join(root, ".harness", "method-versions", `${name}@v${version}.py`)
    : workspace.path(`methods/${name}.py`);
  const saveMethod = (name: string, source: string, description: string, expected?: number) => {
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(name)) throw Error("Method name must match ^[a-z][a-z0-9_]{0,39}$.");
    validateMethod(source);
    const before = methods[name]?.version ?? 0;
    if (expected !== undefined && expected !== before) throw Error(`Method ${name} is v${before}; expected v${expected}. Read it again.`);
    const version = before + 1;
    workspace.mutate({ op: "write", path: `methods/${name}.py`, content: source });
    writeFileSync(methodFile(name, version), source, "utf8");
    methods[name] = { version, description, hash: createHash("sha256").update(source).digest("hex"),
      updated_at: new Date().toISOString(), runs: methods[name]?.runs ?? 0, best_cv: methods[name]?.best_cv ?? null };
    persistMethods();
    log("methods.jsonl", { name, version, description, hash: methods[name].hash });
    return { method: name, version, description, bytes: Buffer.byteLength(source) };
  };

  const submitTool = async (a: any) => {
    const rel = String(a.file ?? "");
    if (!/\.csv$/i.test(rel)) throw Error("Submission must be a .csv file.");
    workspace.path(rel);
    if (!existsSync(workspace.path(rel))) throw Error(`Submission file does not exist: ${rel}`);
    if (/^data\//.test(rel)) throw Error("Write the submission under submissions/ or work/, not data/.");
    const base = ["--competition", competition.slug, "--file", workspace.path(rel), "--data-dir", workspace.path("data/raw")];
    const validation = await runProcess(python, [helper, "validate", ...base], 180_000);
    let validated: Json;
    try { validated = JSON.parse(validation.stdout.trim().split(/\r?\n/).at(-1)!); }
    catch { throw Error(`Submission validation failed: ${clip(validation.stderr || validation.stdout, 3000)}`); }
    if (!validated.ok) throw Error(JSON.stringify(validated));
    if (a.dry_run) return { dry_run: true, validation: validated };
    const previousScored = (state.submissions ?? []).filter((row: any) => Number.isFinite(Number(row.public_score))).at(-1);
    if (previousScored) {
      const reflection = state.harnessReflections.find((item: any) => Number(item.submission_ref) === Number(previousScored.ref));
      if (!reflection)
        throw Error(`Before another real Kaggle submission, call harness_reflect for scored submission ${previousScored.ref ?? previousScored.file}. Review your own harness and workflow: what helped, what capability or strategy was missing or underused, what will change, and what experiment will test that change.`);
      if (Number(state.lastExperimentSequence ?? 0) <= Number(reflection.tool_sequence))
        throw Error(`Reflection for submission ${previousScored.ref ?? previousScored.file} is recorded, but no later experiment has tested the stated strategy change. Run a new experiment with run_python or run_method before spending another Kaggle submission.`);
    }
    const limits = await runProcess(python, [helper, "limits", "--competition", competition.slug], 120_000);
    let allowance: Json;
    try { allowance = JSON.parse(limits.stdout.trim().split(/\r?\n/).at(-1)!); }
    catch { throw Error(`Could not read Kaggle submission limits: ${clip(limits.stderr || limits.stdout, 3000)}`); }
    if (!allowance.ok) throw Error(JSON.stringify(allowance));
    if (Number(allowance.num_allowed_now) <= 0) throw Error(`No submission allowance remains now: ${JSON.stringify(allowance)}`);
    const message = String(a.message ?? "agent iteration").slice(0, 500);
    const submitted = await runProcess(python, [helper, "submit", ...base, "--message", message, "--wait", String(clamp(Number(a.wait_s ?? 120), 10, 600))], 660_000);
    let receipt: Json;
    try { receipt = JSON.parse(submitted.stdout.trim().split(/\r?\n/).at(-1)!); }
    catch { throw Error(`Kaggle submit failed: ${clip(submitted.stderr || submitted.stdout, 4000)}`); }
    const row = { ...receipt, file: rel, sha256: createHash("sha256").update(readFileSync(workspace.path(rel))).digest("hex"),
      bytes: readFileSync(workspace.path(rel)).length, rows: validated.rows,
      cv_score: a.cv_score ?? null, cv_std: a.cv_std ?? null, method: a.method ?? null, notes: a.notes ?? null,
      message, tool_sequence: state.currentToolSequence, at: new Date().toISOString() };
    state.submissions.push(row);
    state.limits = allowance;
    if (receipt.ok && Number.isFinite(Number(receipt.public_score))) {
      const score = Number(receipt.public_score);
      if (!state.best || score > Number(state.best.public_score)) state.best = { ...row, public_score: score };
    }
    persist();
    log("submissions.jsonl", row);
    return { ...receipt, validation: validated, allowance };
  };

  const statusTool = async (a: any) => {
    const args = [helper, "status", "--competition", competition.slug, "--top", String(clamp(Number(a.top ?? 10), 1, 50))];
    if (a.full) args.push("--full");
    const result = await runProcess(python, args, 300_000);
    let payload: Json;
    try { payload = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)!); }
    catch { throw Error(`Kaggle status failed: ${clip(result.stderr || result.stdout, 4000)}`); }
    if (payload.ok) {
      state.limits = payload.limits ?? state.limits;
      state.best = payload.best ?? state.best;
      if (a.full) state.latestFullLeaderboard = {
        rank: payload.best?.rank ?? null, total_teams: payload.best?.total_teams ?? null,
        submission_count: (state.submissions ?? []).filter((row: any) => Number.isFinite(Number(row.public_score))).length,
        checked_at: new Date().toISOString(),
      };
      persist();
      log("leaderboard.jsonl", payload);
    }
    return payload;
  };

  const tools = new Map<string, any>();
  const addTool = (tool: any) => {
    tool.parameters = providerToolSchema(tool.parameters);
    tools.set(tool.name, tool);
    pi.registerTool(tool);
  };
  const register = (name: string, description: string, parameters: any, fn: any) => addTool({
    name, label: name, description, parameters,
    execute: async (_id: string, args: any, signal: any, _update: any, ctx: any) => {
      const sequence = ++state.toolSequence;
      state.currentToolSequence = sequence;
      try {
        const result = await fn(args, signal, ctx);
        log("tools.jsonl", { sequence, name, args: name === "run_python" && args.code ? { ...args, code: `(${args.code.length} chars)` } : args, result: result?.content?.filter((x: any) => x.type === "text"), isError: result?.isError ?? false });
        persist();
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log("tools.jsonl", { sequence, name, args, isError: true, error: message });
        persist();
        throw error;
      }
    },
  });

  for (const tool of workspace.fileTools()) addTool({
    ...tool,
    execute: async (id: string, args: any, signal: any, update: any, ctx: any) => {
      if (["write", "edit"].includes(tool.name) && /^methods\//.test(String(args.path).replace(/\\/g, "/")))
        throw Error("Use save_method/edit_method for versioned modeling methods.");
      return tool.execute(id, args, signal, update, ctx);
    },
  });
  workspace.onWrite = async path => { const result = await binder.save(path, 0, { by: "agent", decision: requests }); binder.boundary(); return result; };

  register("run_python", "Run Python on the host with the installed ML stack (pandas, numpy, scikit-learn, LightGBM, XGBoost, CatBoost, optuna, polars). Supply code or an existing workspace path. cwd is the workspace; data/ is read-only by convention; write models and submissions under work/ or submissions/. Training may take minutes: set timeout_s up to 7200. Args arrive as argv[1] JSON. Provider and Kaggle credentials are not passed to this process. Returns exit status, bounded stdout/stderr and a full log path.",
    Type.Object({ code: Type.Optional(Type.String()), path: Type.Optional(Type.String()),
      args: Type.Optional(Type.Record(Type.String(), Type.Any())), timeout_s: Type.Optional(Type.Integer({ minimum: 1, maximum: 7200 })) }),
    async (a: any, signal: any) => text(await runPython(a, signal)));

  register("run_harness_tool", "Run a saved versioned Python harness tool from tools/. Each tool defines run(args). Omit version for the active version or specify an earlier version to compare it; judge usefulness from later task evidence.",
    Type.Object({ name: Type.String({ pattern: "^[a-z][a-z0-9_]{0,39}$" }), args: Type.Optional(Type.Record(Type.String(), Type.Any())),
      version: Type.Optional(Type.Integer({ minimum: 1 })), timeout_s: Type.Optional(Type.Integer({ minimum: 1, maximum: 7200 })) }),
    async (a: any, signal: any) => text(await runHarnessTool(a, signal)));

  register("save_method", "Create or revise a reusable Python modeling method. Supply exactly one of body or source_path. Methods live in methods/ with immutable version history under .harness/method-versions/; run them with run_method. Use this for feature builders, validators, trainers and blenders that later iterations should reuse.",
    Type.Object({ name: Type.String({ pattern: "^[a-z][a-z0-9_]{0,39}$" }), description: Type.String({ minLength: 1, maxLength: 200 }),
      body: Type.Optional(Type.String()), source_path: Type.Optional(Type.String()), expected_version: Type.Optional(Type.Integer({ minimum: 0 })) }),
    async (a: any) => {
      if ((a.body === undefined) === (a.source_path === undefined)) throw Error("Supply exactly one of body or source_path.");
      const source = a.body ?? workspace.read(a.source_path);
      return text(saveMethod(a.name, source, a.description, a.expected_version));
    });

  register("edit_method", "Revise one exact text span in an active method while preserving its version history. Read the method first.",
    Type.Object({ name: Type.String(), old_text: Type.String(), new_text: Type.String(), expected_version: Type.Integer({ minimum: 1 }) }),
    async (a: any) => {
      const active = methods[a.name];
      if (!active) throw Error(`No active method ${a.name}.`);
      if (active.version !== a.expected_version) throw Error(`Method ${a.name} is v${active.version}; expected v${a.expected_version}.`);
      const source = workspace.read(`methods/${a.name}.py`);
      if (!a.old_text || source.split(a.old_text).length !== 2) throw Error("old_text must occur exactly once in the active method.");
      return text(saveMethod(a.name, source.replace(a.old_text, () => a.new_text), active.description, a.expected_version));
    });

  register("run_method", "Run a saved method with args as argv[1] JSON. Omit version for the active one. The same host Python environment and timeout rules as run_python apply.",
    Type.Object({ name: Type.String(), args: Type.Optional(Type.Record(Type.String(), Type.Any())), version: Type.Optional(Type.Integer({ minimum: 1 })),
      timeout_s: Type.Optional(Type.Integer({ minimum: 1, maximum: 7200 })) }),
    async (a: any, signal: any) => {
      const record = methods[a.name];
      if (!record) throw Error(`No saved method ${a.name}.`);
      const version = a.version ?? record.version;
      const source = methodFile(a.name, version);
      if (!existsSync(source)) throw Error(`Method ${a.name} v${version} is not available.`);
      const rel = `work/method-runs/${a.name}@v${version}.py`;
      workspace.runtimeWrite(rel, readFileSync(source));
      const result = await runPython({ path: rel, args: a.args ?? {}, timeout_s: a.timeout_s }, signal);
      methods[a.name].runs = (methods[a.name].runs ?? 0) + 1;
      if (Number.isFinite(Number(a.args?.cv_score))) methods[a.name].best_cv = Math.max(Number(methods[a.name].best_cv ?? -Infinity), Number(a.args.cv_score));
      persistMethods();
      return text(result);
    });

  register("list_methods", "List saved methods, versions, descriptions and run counts.",
    Type.Object({}), async () => text(Object.entries(methods).map(([name, m]: [string, any]) => ({ name, ...m }))));

  register("kaggle_submit", "Validate a submission CSV, check the remaining Kaggle allowance, upload it, and return the public score when scoring completes. After receiving a score, call harness_reflect to diagnose what your own problem-solving process should improve before the next real submission or finish. Record cv_score/cv_std/method so the submission ledger links local validation to leaderboard feedback. Use dry_run=true to validate only. Every real call spends one competition submission.",
    Type.Object({ file: Type.String(), message: Type.String({ minLength: 1, maxLength: 500 }),
      cv_score: Type.Optional(Type.Number()), cv_std: Type.Optional(Type.Number()), method: Type.Optional(Type.String()),
      notes: Type.Optional(Type.String()), wait_s: Type.Optional(Type.Integer({ minimum: 10, maximum: 600 })), dry_run: Type.Optional(Type.Boolean()) }),
    async (a: any) => text(await submitTool(a)));

  register("kaggle_status", "Read the remaining submission allowance, your recent submissions and public scores, the best score, the top leaderboard entries, and (with full=true) your exact rank and total teams. Use it to calibrate local validation against the leaderboard.",
    Type.Object({ top: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })), full: Type.Optional(Type.Boolean()) }),
    async (a: any) => text(await statusTool(a)));

  register("harness_reflect", "Required after each scored Kaggle submission and before the next real submission or finish. Turn your process reflections into prompt, memory, skill, tool or subagent components using self_component, including provisional hypotheses; identify the components and the next experiment that will use and assess them. Diagnose your harness and methodology, not only the model.",
    Type.Object({
      submission_ref: Type.Integer({ minimum: 1 }),
      task_result: Type.String({ minLength: 20 }),
      process_worked: Type.String({ minLength: 20 }),
      process_gap: Type.String({ minLength: 30 }),
      cause: Type.String({ minLength: 20 }),
      strategy_change: Type.String({ minLength: 30 }),
      next_test: Type.String({ minLength: 20 }),
      harness_components: Type.Optional(Type.Array(Type.String({ minLength: 8 }), { maxItems: 8 })),
      harness_edit: Type.Optional(Type.String({ maxLength: 1000 })),
    }),
    async (a: any) => {
      const scored = (state.submissions ?? []).filter((row: any) => Number.isFinite(Number(row.public_score)));
      const latest = scored.at(-1);
      if (!latest) throw Error("No scored Kaggle submission is available to reflect on. Check kaggle_status after submission.");
      if (Number(a.submission_ref) !== Number(latest.ref))
        throw Error(`Reflect on the latest scored submission ${latest.ref ?? latest.file}, not ${a.submission_ref}.`);
      if (state.harnessReflections.some((item: any) => Number(item.submission_ref) === Number(a.submission_ref)))
        throw Error(`Submission ${a.submission_ref} already has a self-harness reflection.`);
      const previous = scored.at(-2);
      const delta = previous ? Number(latest.public_score) - Number(previous.public_score) : null;
      const path = `notes/reflections/checkpoint-${a.submission_ref}.md`;
      const row = {
        ...a, path, file: latest.file, public_score: Number(latest.public_score), cv_score: latest.cv_score ?? null,
        previous_public_score: previous ? Number(previous.public_score) : null, delta,
        tool_sequence: state.currentToolSequence, at: new Date().toISOString(),
      };
      const body = [
        `# Self-harness checkpoint for submission ${a.submission_ref}`,
        "",
        `- candidate: \`${latest.file}\``,
        `- CV: ${latest.cv_score ?? "not recorded"}`,
        `- public: ${Number(latest.public_score).toFixed(5)}`,
        `- previous public: ${previous ? Number(previous.public_score).toFixed(5) : "none"}`,
        `- public delta: ${delta === null ? "n/a" : `${delta >= 0 ? "+" : ""}${delta.toFixed(5)}`}`,
        "",
        "## Task result",
        a.task_result,
        "",
        "## What worked in my process",
        a.process_worked,
        "",
        "## Harness or workflow gap",
        a.process_gap,
        "",
        "## Why it happened",
        a.cause,
        "",
        "## Strategy change for the next iteration",
        a.strategy_change,
        "",
        "## Experiment that will test the change",
        a.next_test,
        "",
        "## Components created or revised",
        ...(a.harness_components?.length ? a.harness_components.map((line: string) => `- ${line}`) : ["No component was recorded in this checkpoint."]),
        "",
        "## Harness edits",
        a.harness_edit ?? "See the component list; any new or revised components remain hypotheses until later use provides evidence.",
        "",
      ].join("\n");
      workspace.mutate({ op: "write", path, content: body });
      await binder.save(path, 0, { by: "agent", decision: requests });
      state.harnessReflections.push(row);
      persist();
      log("harness-reflections.jsonl", row);
      return text({
        recorded: true, path, public_score: row.public_score, delta,
        required_before_next_submission: "Run a new experiment that tests the stated strategy change, then compare its result.",
      });
    });

  register("finish", "Complete the task only after a fresh full Kaggle leaderboard check verifies that your best submission meets the competition target rank and the latest scored submission has a harness_reflect checkpoint. Until the target is reached, keep testing candidate and harness improvements; a reflection, plateau claim, or list of next steps is not a reason to finish. Summarize process improvements and score evidence after the target is verified.",
    Type.Object({
      summary: Type.String({ minLength: 80 }),
      hypothesis: Type.String({ minLength: 12 }),
      changes: Type.Array(Type.String({ minLength: 8 }), { minItems: 1, maxItems: 8 }),
      harness_review: Type.String({ minLength: 40 }),
      harness_gaps: Type.Array(Type.String({ minLength: 20 }), { minItems: 1, maxItems: 5 }),
      strategy_changes: Type.Array(Type.String({ minLength: 20 }), { minItems: 1, maxItems: 5 }),
      harness_components: Type.Array(Type.String({ minLength: 8 }), { maxItems: 8 }),
      vs_previous: Type.String({ minLength: 20 }),
      verdict: Type.Union([Type.Literal("improved"), Type.Literal("regressed"), Type.Literal("neutral")]),
      next_steps: Type.Array(Type.String({ minLength: 8 }), { minItems: 2, maxItems: 5 }),
      best_public_score: Type.Optional(Type.Number()), rank: Type.Optional(Type.Integer({ minimum: 1 })) }),
    async (a: any) => {
      const fmt = (value: any) => Number(value).toFixed(5);
      const scored = (state.submissions ?? []).filter((row: any) => Number.isFinite(Number(row.public_score)));
      if (!scored.length)
        throw Error("finish needs at least one submission with a public score. Submit through kaggle_submit first: the run must end on measured evidence, not intent.");
      const latest = scored.at(-1);
      const prior = scored.slice(0, -1);
      const priorBest = prior.length
        ? prior.reduce((best: any, row: any) => Number(row.public_score) > Number(best.public_score) ? row : best)
        : null;
      const delta = priorBest ? Number(latest.public_score) - Number(priorBest.public_score) : null;
      const deltaText = delta === null ? "n/a (first scored submission)" : `${delta >= 0 ? "+" : ""}${delta.toFixed(5)}`;
      const facts = `Latest ${latest.file} public ${fmt(latest.public_score)}${Number.isFinite(Number(latest.cv_score)) ? ` (CV ${fmt(latest.cv_score)})` : ""}; prior best ${priorBest ? `${fmt(priorBest.public_score)} on ${priorBest.file}` : "none"}; delta ${deltaText}.`;
      const reject = (why: string) => {
        throw Error(`${why}\n\nScore facts recomputed from harness/submissions.jsonl: ${facts}\nRepeat the finish call with: summary, hypothesis, changes[] (distinct actions), harness_review, harness_gaps[], strategy_changes[], harness_components[] (created/revised components or []), vs_previous (must contain the latest public score as ${Number(latest.public_score).toFixed(4)}), verdict (improved|regressed|neutral), next_steps[>=2].`);
      };
      const latestReflection = state.harnessReflections.find((item: any) => Number(item.submission_ref) === Number(latest.ref));
      if (!latestReflection)
        reject(`The latest scored submission ${latest.ref ?? latest.file} has no harness_reflect checkpoint. Reflect on your problem-solving process and strategy after receiving the score before finishing.`);
      const leaderboard = state.latestFullLeaderboard;
      if (!leaderboard || Number(leaderboard.submission_count) !== scored.length)
        reject("The current best has not been checked against the full leaderboard since the latest scored submission. Call kaggle_status(full=true), then continue optimizing unless the target rank is reached.");
      if (leaderboard.rank === null || leaderboard.rank === undefined ||
          !Number.isFinite(Number(leaderboard.rank)) || Number(leaderboard.rank) > Number(competition.target_top))
        reject(`Current exact rank is ${leaderboard.rank ?? "unknown"} of ${leaderboard.total_teams ?? "unknown"}; the target is top ${competition.target_top}. Continue experiments and improve the candidate. Do not call finish while the target is unmet.`);
      if (a.best_public_score !== undefined && state.best && Math.abs(Number(a.best_public_score) - Number(state.best.public_score)) > 5e-6)
        reject(`best_public_score ${a.best_public_score} does not match the recorded best ${fmt(state.best.public_score)}.`);
      const latestScore = Number(latest.public_score);
      if (!a.vs_previous.includes(latestScore.toFixed(4)) && !a.vs_previous.includes(latestScore.toFixed(5)))
        reject(`vs_previous does not cite the latest public score (${latestScore.toFixed(5)}).`);
      if (delta !== null && delta > 0.0005 && a.verdict !== "improved")
        reject(`The latest submission improved by ${delta.toFixed(5)} but verdict is "${a.verdict}".`);
      if (delta !== null && delta < -0.0005 && a.verdict !== "regressed")
        reject(`The latest submission fell by ${Math.abs(delta).toFixed(5)} but verdict is "${a.verdict}".`);
      if (new Set(a.changes.map((s: string) => s.trim())).size !== a.changes.length)
        reject("changes must describe distinct actions, not repeats.");

      const window = scored.length;
      const reflection = `notes/reflections/window-${window}.md`;
      const body = [
        `# Window ${window} reflection`,
        "",
        `- submission: \`${latest.file}\``,
        `- public: ${fmt(latest.public_score)}${Number.isFinite(Number(latest.cv_score)) ? ` (CV ${fmt(latest.cv_score)})` : ""}`,
        `- prior best: ${priorBest ? `${fmt(priorBest.public_score)} on \`${priorBest.file}\`` : "none"}`,
        `- delta: ${deltaText}`,
        `- verdict: ${a.verdict}`,
        `- rank: ${a.rank ?? "unknown"}`,
        "",
        "## Submission ledger",
        "| # | file | CV | public |",
        "|---|---|---|---|",
        ...scored.map((row: any, index: number) =>
          `| ${index + 1} | \`${row.file}\` | ${Number.isFinite(Number(row.cv_score)) ? fmt(row.cv_score) : "n/a"} | ${fmt(row.public_score)} |`),
        "",
        "## Hypothesis",
        a.hypothesis,
        "",
        "## Summary",
        a.summary,
        "",
        "## Self-harness review",
        a.harness_review,
        "",
        "## Diagnosed process gaps",
        ...a.harness_gaps.map((line: string) => `- ${line}`),
        "",
        "## Strategy changes",
        ...a.strategy_changes.map((line: string) => `- ${line}`),
        "",
        "## Harness components created or revised",
        ...(a.harness_components.length ? a.harness_components.map((line: string) => `- ${line}`) : ["None recorded in this window."]),
        "",
        "## What changed",
        ...a.changes.map((line: string) => `- ${line}`),
        "",
        "## Compared with the previous version",
        a.vs_previous,
        "",
        "## Next",
        ...a.next_steps.map((line: string) => `- ${line}`),
        "",
      ].join("\n");
      workspace.mutate({ op: "write", path: reflection, content: body });
      await binder.save(reflection, 0, { by: "agent", decision: requests });

      const factsTable = { latest: latest.file, public: Number(latest.public_score), cv: latest.cv_score ?? null,
        prior_best: priorBest ? Number(priorBest.public_score) : null, delta };
      log("reflections.jsonl", { window, path: reflection, ...a, facts: factsTable });
      log("lifecycle.jsonl", { event: "finished", ...a });
      state.complete = true;
      state.finishedAt = new Date().toISOString();
      state.finish = { ...a, reflection, facts: factsTable };
      persist();
      return text({ finished: true, reflection, best: state.best, facts: factsTable }, true);
    });

  register("read_component", "Inspect a named prompt, skill, subagent role, memory entry or method and its exact active version.",
    Type.Object({ name: Type.String() }), (a: any) => {
      if (methods[a.name]) return text(`${a.name}@v${methods[a.name].version}\n${workspace.read(`methods/${a.name}.py`)}`);
      const c = binder.active().find(c => c.name === a.name);
      if (!c) {
        const path = `notes/memory/${a.name}.md`;
        if (workspace.files().includes(path)) return text(`${a.name}@v${binder.versionMap()[path] ?? 1}\n${workspace.read(path)}`);
        throw Error("No active component by this name");
      }
      return text(`${c.name}@v${c.version}\n${c.source}`);
    });

  register("self_component", "Create or revise task-local prompt, skill, memory, tool or subagent harness components. Tool source is Python defining run(args), saved under tools/ and runnable by run_harness_tool(name,args,version). Save useful or promising procedures as components when they emerge; later experiments judge whether each component helps. Subagents declare allowed tools and a write_scope for write/edit.",
    Type.Object({ kind: Type.Union([Type.Literal("prompt"), Type.Literal("skill"), Type.Literal("memory"), Type.Literal("tool"), Type.Literal("subagent")]),
      name: Type.String({ pattern: "^[a-z][a-z0-9_]{0,39}$" }), content: Type.String(),
      description: Type.Optional(Type.String()), tools: Type.Optional(Type.Array(Type.String())), write_scope: Type.Optional(Type.Array(Type.String())) }),
    async (a: any) => {
      const path = a.kind === "memory" ? `notes/memory/${a.name}.md` : a.kind === "skill" ? `skills/${a.name}/SKILL.md`
        : a.kind === "subagent" ? `agents/${a.name}.md` : a.kind === "tool" ? `tools/${a.name}.py` : `prompts/${a.name}.md`;
      const content = a.kind === "memory" ? `${a.description ? `# ${a.description.replace(/[\r\n]+/g, " ")}\n\n` : ""}${a.content}` : a.kind === "prompt" ? `---\nactive: true\ndescription: ${JSON.stringify(a.description ?? a.name)}\n---\n${a.content}`
        : a.kind === "subagent" ? `---\ndescription: ${JSON.stringify(a.description ?? a.name)}\ntools: ${JSON.stringify(a.tools ?? ["read"])}${a.write_scope ? `\nwrite_scope: ${JSON.stringify(a.write_scope)}` : ""}\n---\n${a.content}`
        : a.kind === "tool" ? `# ${(a.description ?? a.name).replace(/[\r\n]+/g, " ")}\n${a.content}`
        : `---\nname: ${a.name}\ndescription: ${JSON.stringify(a.description ?? a.name)}\n---\n${a.content}`;
      workspace.mutate({ op: "write", path, content });
      const receipt = await binder.save(path, 0, { by: "agent", decision: requests });
      binder.boundary();
      return text(receipt ?? `Saved ${path}; active from the next request.`);
    });

  /** A saved role runs in a fresh context with only its declared tools and material. */
  const runSubagent = async (a: any, signal: any, ctx: any, parentPrompt = "") => {
    const agent = binder.active().find(c => c.kind === "subagent" && c.name === a.agent);
    if (!agent) throw Error(`No active subagent ${a.agent}. Create one with self_component(kind="subagent").`);
    if (!ctx.model) throw Error("run_agent needs the active model context");
    const writeScope = (agent.write_scope ?? []).map((s: string) => s.replace(/\\/g, "/").replace(/^\.\//, ""));
    const allowed = agent.tools ?? ["read"];
    const defs: any[] = [];
    const run: Record<string, (args: any) => Promise<any>> = {};
    for (const name of allowed) {
      if (name === "read") {
        const def = workspace.fileTools().find(t => t.name === "read")!;
        defs.push({ name, description: def.description, parameters: def.parameters });
        run[name] = args => def.execute("run_agent", args, signal, undefined, ctx);
      } else if (name === "write" || name === "edit") {
        const def = workspace.fileTools().find(t => t.name === name)!;
        defs.push({ name, description: def.description, parameters: def.parameters });
        run[name] = async args => {
          const path = String(args.path ?? "").replace(/\\/g, "/").replace(/^\.\//, "");
          if (!writeScope.some(scope => scope.endsWith("/") ? path.startsWith(scope) : path === scope)) throw Error(`write_scope does not include ${path}`);
          return def.execute("run_agent", args, signal, undefined, ctx);
        };
      } else if (name === "run_python" || name === "run_method") {
        defs.push({ name, description: name === "run_python" ? "Run Python in the shared workspace." : "Run a saved method.", parameters: name === "run_python"
          ? Type.Object({ code: Type.Optional(Type.String()), path: Type.Optional(Type.String()), timeout_s: Type.Optional(Type.Integer()) })
          : Type.Object({ name: Type.String(), args: Type.Optional(Type.Record(Type.String(), Type.Any())), timeout_s: Type.Optional(Type.Integer()) }) });
        run[name] = args => name === "run_python" ? runPython(args, signal).then(text) : tools.get("run_method")!.execute("run_agent", args, signal, undefined, ctx);
      } else if (name === "run_harness_tool") {
        defs.push({ name, description: "Run an active saved harness tool.", parameters: Type.Object({ name: Type.String(),
          args: Type.Optional(Type.Record(Type.String(), Type.Any())), version: Type.Optional(Type.Integer()) }) });
        run[name] = args => runHarnessTool(args, signal).then(text);
      } else if (name === "kaggle_status") {
        defs.push({ name, description: "Read-only leaderboard and submission status.", parameters: Type.Object({ top: Type.Optional(Type.Integer()), full: Type.Optional(Type.Boolean()) }) });
        run[name] = args => statusTool(args).then(text);
      } else {
        throw Error(`Subagent tool ${name} is not available.`);
      }
    }
    const content: any[] = [{ type: "text", text: a.task }];
    for (const ref of [...new Set([...(agent.refs ?? []), ...(a.refs ?? []), ...(a.uses ?? [])])]) {
      content.push({ type: "text", text: `${ref}:\n${workspace.read(String(ref))}` });
    }
    const messages: any[] = [{ role: "user", content, timestamp: Date.now() }];
    const systemPrompt = `${agent.source}\n${parentPrompt}${activePromptText()}`;
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
    while (true) {
      const create = () => ctx.modelRegistry.streamSimple(ctx.model, { systemPrompt, messages, tools: defs },
        { apiKey: auth.apiKey, headers: auth.headers, signal, reasoning: process.env.KAGGLE_DEMO_THINKING ?? "high", maxTokens: ctx.model.maxTokens });
      const reply = await modelResult(create, "run_agent");
      messages.push(reply);
      if (["error", "aborted"].includes(reply.stopReason)) throw Error(`run_agent ${reply.stopReason}: ${reply.errorMessage ?? ""}`);
      if (reply.stopReason === "length") { messages.push({ role: "user", content: "Continue.", timestamp: Date.now() }); continue; }
      const calls = reply.content.filter((part: any) => part.type === "toolCall");
      if (!calls.length) {
        const answer = reply.content.filter((part: any) => part.type === "text").map((part: any) => part.text).join("\n");
        return text(answer || "(subagent returned no text)");
      }
      for (const call of calls) {
        let result;
        try {
          const fn = run[call.name];
          if (!fn) throw Error(`Unknown subagent tool ${call.name}`);
          result = await fn(validateToolArguments(defs.find(d => d.name === call.name), call));
        } catch (error) { result = text(String(error), false, true); }
        messages.push({ role: "toolResult", toolCallId: call.id, toolName: call.name, content: result.content, isError: Boolean(result.isError), timestamp: Date.now() });
      }
    }
  };

  register("run_agent", "Run a saved task-local subagent in a fresh context with only its role, active prompts, declared tools and explicit refs. It cannot submit or finish. Returns its answer.",
    Type.Object({ agent: Type.String({ pattern: "^[a-z][a-z0-9_]{0,39}$" }), task: Type.String(),
      uses: Type.Optional(Type.Array(Type.String())), refs: Type.Optional(Type.Array(Type.String())), independent: Type.Optional(Type.Boolean()) }),
    async (a: any, signal: any, ctx: any) => runSubagent(a, signal, ctx, a.independent ? "" : `${basePrompt}\n`));

  register("explore", "Run independent, read-only candidate analyses in fresh contexts using only your instructions and explicit refs. Same model and task budget; candidates run sequentially and cannot change files. Returns each raw answer or failure.",
    Type.Object({ candidates: Type.Array(Type.Object({ instruction: Type.String({ minLength: 1 }), refs: Type.Optional(Type.Array(Type.String())) }), { minItems: 1 }) }),
    async (a: any, signal: any, ctx: any) => {
      if (!ctx.model) throw Error("explore needs the active model context");
      const answers = [];
      for (const [index, candidate] of a.candidates.entries()) {
        const content: any[] = [{ type: "text", text: `Explore this independently and return concise findings with numbers and exact file references.\n\n${candidate.instruction}` }];
        for (const ref of candidate.refs ?? []) content.push({ type: "text", text: `${ref}:\n${workspace.read(ref)}` });
        const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
        const create = () => ctx.modelRegistry.streamSimple(ctx.model, {
          systemPrompt: "EXPLORE: independent read-only analysis. Only the instruction and supplied refs are available. No tools, no file changes.",
          messages: [{ role: "user", content, timestamp: Date.now() }], tools: [],
        }, { apiKey: auth.apiKey, headers: auth.headers, signal, reasoning: process.env.KAGGLE_DEMO_THINKING ?? "high", maxTokens: ctx.model.maxTokens });
        const reply: any = await modelResult(create, "explore");
        const answer = (reply.content ?? []).filter((part: any) => part.type === "text").map((part: any) => part.text).join("\n");
        const saved = workspace.saveResult(answer);
        answers.push({ index, instruction: candidate.instruction, answer, answer_ref: saved.ref, stop_reason: reply.stopReason });
      }
      return text({ candidates: answers, selection: "agent_decides" });
    });

  register("adapt", "Start an independent ADAPT conversation with context text and exact workspace refs you choose. It uses the same model and task budget, can read and run Python, inspect status and revise methods/prompts/skills, but cannot submit or finish. It returns a final answer here.",
    Type.Object({ context: Type.Optional(Type.String()), refs: Type.Optional(Type.Array(Type.String())) }),
    async (a: any, signal: any, ctx: any) => {
      if (!ctx.model) throw Error("ADAPT needs the active model context");
      const method = binder.active().find(component => component.kind === "skill" && component.name === "adapt_method");
      const systemPrompt = `${adaptPrompt}${method ? `\n\n## Agent-authored adapt_method (${method.path}@v${method.version})\n${method.body}` : ""}`;
      const content: any[] = [{ type: "text", text: a.context ?? "" }];
      const reader = workspace.fileTools().find(tool => tool.name === "read")!;
      for (const ref of a.refs ?? []) {
        const result = await reader.execute("adapt-context", { path: ref }, signal, undefined, ctx);
        if (result.isError) throw Error(`Cannot load ADAPT ref: ${ref}`);
        content.push({ type: "text", text: `Selected ref: ${ref}` }, ...result.content);
      }
      const messages: any[] = [{ role: "user", content, timestamp: Date.now() }];
      const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
      log("lifecycle.jsonl", { event: "adapt_enter", context: a.context ?? "", refs: a.refs ?? [] });
      while (true) {
        if (signal?.aborted) throw Error("ADAPT aborted");
        const available = [...tools.values()].filter(tool => !["adapt", "finish", "kaggle_submit", "harness_reflect"].includes(tool.name));
        const create = () => ctx.modelRegistry.streamSimple(ctx.model, { systemPrompt, messages,
          tools: available.map(({ name, description, parameters }) => ({ name, description, parameters })) },
          { apiKey: auth.apiKey, headers: auth.headers, signal, reasoning: process.env.KAGGLE_DEMO_THINKING ?? "high", maxTokens: ctx.model.maxTokens });
        const reply = await modelResult(create, "adapt");
        log("adapt_messages.jsonl", { message: reply });
        if (["error", "aborted"].includes(reply.stopReason)) throw Error(`ADAPT ${reply.stopReason}: ${reply.errorMessage ?? ""}`);
        messages.push(reply);
        if (reply.stopReason === "length") { messages.push({ role: "user", content: "Continue.", timestamp: Date.now() }); continue; }
        const calls = reply.content.filter((part: any) => part.type === "toolCall");
        if (!calls.length) {
          log("lifecycle.jsonl", { event: "adapt_exit" });
          return text(reply.content.filter((part: any) => part.type === "text").map((part: any) => part.text).join("\n"));
        }
        for (const call of calls) {
          let result;
          try {
            const tool = available.find(tool => tool.name === call.name);
            if (!tool) throw Error(`ADAPT tool unavailable: ${call.name}`);
            result = await tool.execute(call.id, validateToolArguments(tool, call), signal, undefined, ctx);
          } catch (error) { result = text(String(error), false, true); }
          messages.push({ role: "toolResult", toolCallId: call.id, toolName: call.name, content: result.content, isError: Boolean(result.isError), timestamp: Date.now() });
        }
      }
    });

  pi.on("context", event => {
    const messages = projectKaggleTaskContext(event.messages, workspace);
    log("context-projection.jsonl", { request: requests + 1, before_chars: JSON.stringify(event.messages).length, after_chars: JSON.stringify(messages).length });
    return { messages };
  });
  pi.on("session_before_compact", async (event, ctx: any) => {
    try {
      if (!ctx.model) throw Error("Kaggle compaction needs the active model");
      const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
      if (!auth.ok) throw Error(auth.error);
      return { compaction: await compact(event.preparation, ctx.model, auth.apiKey, auth.headers,
        event.customInstructions, event.signal, pi.getThinkingLevel(),
        (model: any, context: any, options: any) => ({ result: () => modelResult(() => ctx.modelRegistry.streamSimple(model, context, options), "compaction") }) as any, auth.env) };
    } catch (error) {
      log("compaction.jsonl", { reason: event.reason, error: String(error), cancelled: true });
      return { cancel: true };
    }
  });
  pi.on("session_compact", (event: any) => log("compaction.jsonl", { reason: event.reason,
    tokensBefore: event.compactionEntry.tokensBefore, summary_chars: event.compactionEntry.summary.length, usage: event.compactionEntry.usage }));

  pi.on("before_agent_start", async (event: any) => {
    if (!initialized) {
      await binder.scan(0);
      const skillPath = "skills/self_evolution/SKILL.md";
      if (!binder.candidates().some(c => c.path === skillPath)) {
        const skill = readFileSync(fileURLToPath(new URL("./harness-methods/kaggle_self_evolution/SKILL.md", import.meta.url)), "utf8");
        workspace.mutate({ op: "write", path: skillPath, content: skill });
        await binder.save(skillPath, 0, { by: "system", decision: requests });
      }
      binder.boundary(); initialized = true;
    }
    resumed = event.prompt === "KAGGLE_RESUME" || event.prompt.startsWith("KAGGLE_RESUME\n");
    if (resumed && state.complete) {
      state.complete = false;
      state.resumedFromFinish = state.finishedAt ?? null;
      persist();
      log("lifecycle.jsonl", { event: "resume_after_finish", previous_finished_at: state.resumedFromFinish });
    }
    if (!resumed) { binder.boundary(); persist(); }
    pi.setActiveTools(["adapt", "read", "write", "edit", "ls", "grep", "run_python", "save_method", "edit_method", "run_method",
      "run_harness_tool", "list_methods", "kaggle_submit", "kaggle_status", "harness_reflect", "finish", "read_component", "self_component", "run_agent", "explore"]);
    const skillIndex = binder.active().filter(c => c.kind === "skill")
      .map(c => `${c.name}@v${c.version} | ${c.description} | read_component(name) for full method`).join("\n");
    const unbounded = process.env.KAGGLE_DEMO_UNBOUNDED === "1";
    const remainingMinutes = unbounded ? "unlimited" : String(Math.max(0, Math.ceil((Number(process.env.KAGGLE_DEMO_DEADLINE) - Date.now()) / 60000)));
    const budgetLine = unbounded ? `Remaining runtime and estimated spend: unlimited; provider requests ${requests}.`
      : `Remaining: ${remainingMinutes} min; estimated USD ${Math.max(0, cap - spent).toFixed(2)} of ${cap.toFixed(2)}; provider requests ${requests}.`;
    log("lifecycle.jsonl", { event: resumed ? "resume" : "request_started" });
    return { systemPrompt: systemPrompt(), message: { customType: "kaggle-work-state",
      content: `Current state: ${JSON.stringify(currentState())}\nSkills: ${skillIndex || "none"}\nMethods: ${Object.keys(methods).join(", ") || "none"}\n${budgetLine}`,
      display: false } };
  });

  pi.on("before_provider_request", (event: any) => {
    if (Date.now() > Number(process.env.KAGGLE_DEMO_DEADLINE) || spent + reserve > cap) {
      writeFileSync(join(root, "budget-stop.json"), JSON.stringify({ spent, requests, reason: "authorized budget boundary" }));
      process.exit(0);
    }
    spent += reserve; reserved = reserve;
    binder.boundary();
    const prompt = systemPrompt();
    const payload = event.payload as any;
    if (Array.isArray(payload.system)) {
      const block = payload.system.find((part: any) => typeof part.text === "string" && part.text.includes(basePrompt.slice(0, 80)));
      if (block) block.text = prompt;
    } else {
      const messages = payload.messages ?? payload.input;
      if (Array.isArray(messages)) {
        const head = messages.find((message: any) => (message.role === "system" || message.role === "developer") &&
          typeof message.content === "string" && message.content.includes(basePrompt.slice(0, 80)));
        if (head) { head.content = prompt; delete head.sections; }
      }
    }
    log("provider-requests.jsonl", { request: ++requests, estimated_usd_so_far: spent,
      payload: JSON.stringify(payload, (key, value) => key === "url" && typeof value === "string" && value.startsWith("data:") ? "(image)" : value) });
  });

  pi.on("message_end", (event: any) => {
    const m = event.message;
    if (m.role === "assistant") {
      const u = m.usage ?? {};
      const known = Number.isFinite(u.input) && Number.isFinite(u.output) && (u.input + u.output) > 0;
      if (known) spent += ((u.input ?? 0) * inputRate + (u.cacheRead ?? 0) * cacheReadRate + (u.cacheWrite ?? 0) * cacheWriteRate + (u.output ?? 0) * outputRate) / 1e6 - reserved;
      reserved = 0;
      log("model-usage.jsonl", { request: requests, usage: known ? u : null, conservative_usd: spent,
        usage_status: known ? "reported" : "unknown_reserved", stopReason: m.stopReason });
    }
  });
}
