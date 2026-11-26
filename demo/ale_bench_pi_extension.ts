/** Pi-native ALE-Bench coding surface. The Python bridge owns the Session. */
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Workspace } from "./arc_thin_workspace.ts";
import { CognitiveComponents, type Kind } from "./cognitive_components.ts";

type BridgeReply = Record<string, unknown>;
const text = (value: unknown, isError = false) => ({ content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value) }], isError });

export default function aleBenchPi(pi: ExtensionAPI) {
  const root = process.env.ALE_RUN_ROOT;
  const url = process.env.ALE_BRIDGE_URL;
  const token = process.env.ALE_BRIDGE_TOKEN;
  if (!root || !url || !token) throw new Error("ALE_RUN_ROOT, ALE_BRIDGE_URL and ALE_BRIDGE_TOKEN are required");
  const workspace = new Workspace(root, { dirs: ["workspace", "work", "results", "components"] });
  const components = new CognitiveComponents(join(root, "components"));
  const attemptsDir = join(root, "attempts"); mkdirSync(attemptsDir, { recursive: true });
  let attempt = 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestPath = "";
  workspace.writeGuard = (path) => {
    if (/^(results\/|components\/|AGENTS\.md$)/i.test(path)) throw new Error("reserved runtime path");
  };
  const call = async (path: string, body: Record<string, unknown> = {}): Promise<BridgeReply> => {
    const response = await fetch(`${url}${path}`, { method: "POST", headers: { "Content-Type": "application/json", "X-ALE-Token": token }, body: JSON.stringify(body) });
    const value = await response.json() as BridgeReply;
    if (!response.ok) throw new Error(String(value.error ?? response.statusText));
    return value;
  };
  const score = (value: BridgeReply) => typeof value.overall_absolute_score === "number" ? value.overall_absolute_score : Number.NEGATIVE_INFINITY;
  const remember = (path: string, result: BridgeReply) => {
    attempt += 1; const source = workspace.read(path); writeFileSync(join(attemptsDir, `a${attempt}.json`), JSON.stringify({ attempt_id: `a${attempt}`, path, result, source }, null, 2));
    if (score(result) >= bestScore) { bestScore = score(result); bestPath = path; writeFileSync(join(root, "best.json"), JSON.stringify({ attempt_id: `a${attempt}`, path, score: bestScore }, null, 2)); }
  };
  for (const tool of workspace.fileTools()) pi.registerTool(tool as any);
  pi.registerTool({ name: "reflect_component", label: "reflect_component", executionMode: "sequential",
    description: "Create, revise, or restore an agent-owned memory, skill, prompt, subagent, or tool component.",
    parameters: Type.Object({ op: Type.Union([Type.Literal("define"), Type.Literal("redefine"), Type.Literal("restore")]), kind: Type.Union([Type.Literal("memory"), Type.Literal("skill"), Type.Literal("prompt"), Type.Literal("subagent"), Type.Literal("tool")]), name: Type.String(), body: Type.Optional(Type.String()), summary: Type.Optional(Type.String()), version: Type.Optional(Type.Number()) }),
    async execute(_id, args) { try { const value = components.reflect(args.op as any, args.kind as Kind, args.name, args.body, args.summary ?? "", args.version); components.recordChange(value, "task"); return text({ component: value, stats: components.stats(value.kind, value.name) }); } catch (error) { components.recordPublishFailure(args.kind as Kind, args.name, String(error), "task"); return text(String(error), true); } } });
  pi.registerTool({ name: "read_component", label: "read_component", executionMode: "sequential", description: "Read an active or versioned agent-owned component.", parameters: Type.Object({ kind: Type.String(), name: Type.String(), version: Type.Optional(Type.Number()) }), async execute(_id, args) { try { const value = args.version ? components.read(args.kind as Kind, args.name, args.version) : components.current(args.kind as Kind, args.name); if (!value) throw new Error("component not found"); components.recordRead(value.kind, value.name, "task"); return text(value); } catch (error) { return text(String(error), true); } } });
  pi.registerTool({ name: "ale_public_eval", label: "ale_public_eval", executionMode: "sequential",
    description: "Evaluate a workspace source file on ALE-Bench public cases. This is the normal iteration boundary.",
    parameters: Type.Object({ path: Type.String(), code_language: Type.Optional(Type.String()) }),
    async execute(_id, args) {
      try { const result = await call("/public_eval", { code: workspace.read(args.path), code_language: args.code_language ?? "cpp23" }); remember(args.path, result); return text(result); }
      catch (error) { return text(String(error), true); }
    } });
  pi.registerTool({ name: "ale_case_eval", label: "ale_case_eval", executionMode: "sequential",
    description: "Run an explicit public diagnostic case set. Never supplies private cases.",
    parameters: Type.Object({ path: Type.String(), input_str: Type.String(), code_language: Type.Optional(Type.String()) }),
    async execute(_id, args) {
      try { return text(await call("/case_eval", { input_str: args.input_str, code: workspace.read(args.path), code_language: args.code_language ?? "cpp23" })); }
      catch (error) { return text(String(error), true); }
    } });
  pi.registerTool({ name: "ale_problem", label: "ale_problem", executionMode: "sequential", description: "Read the public ALE-Bench problem statement and constraints.", parameters: Type.Object({}), async execute() { try { return text(await call("/problem")); } catch (error) { return text(String(error), true); } } });
  pi.registerTool({ name: "restore_attempt", label: "restore_attempt", executionMode: "sequential", description: "Restore a previously recorded source attempt or the current best attempt.", parameters: Type.Object({ target: Type.String() }), async execute(_id, args) { try { const target = args.target === "best" ? bestPath : args.target; if (!target) throw new Error("no best attempt"); const source = workspace.read(target); workspace.runtimeWrite("main.cpp", source); return text(`[restored ${target}]`); } catch (error) { return text(String(error), true); } } });
  pi.registerTool({ name: "ale_private_eval", label: "ale_private_eval", executionMode: "sequential",
    description: "Submit the selected best source once for terminal private evaluation.",
    parameters: Type.Object({ path: Type.String(), code_language: Type.Optional(Type.String()) }),
    async execute(_id, args) {
      try { return text(await call("/private_eval", { code: workspace.read(args.path), code_language: args.code_language ?? "cpp23" })); }
      catch (error) { return text(String(error), true); }
    } });
  pi.on("before_agent_start", async (event) => {
    const profile = process.env.ALE_HARNESS_PROFILE ?? "A";
    const active = components.list().map(item => `${item.kind}/${item.name}@v${item.version}: ${item.summary || item.body.slice(0, 160)}`).join("\n") || "none";
    return { systemPrompt: `${event.systemPrompt}\n\nYou solve one ALE-Bench optimization problem. Work only inside workspace. Call ale_problem for the public statement, write a compilable source file, use ale_public_eval to measure changes, and call ale_private_eval once only after selecting your best public result. Do not seek private seeds, standings, session objects, or host files. Profile ${profile}. Active components:\n${active}\nUse reflect_component and read_component when a durable artifact is warranted. Keep durable findings in work/notes.` };
  });
}
