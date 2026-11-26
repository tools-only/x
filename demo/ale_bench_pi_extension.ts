/** Pi-native ALE-Bench coding surface. The Python bridge owns the Session. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Workspace } from "./arc_thin_workspace.ts";

type BridgeReply = Record<string, unknown>;
const text = (value: unknown, isError = false) => ({ content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value) }], isError });

export default function aleBenchPi(pi: ExtensionAPI) {
  const root = process.env.ALE_RUN_ROOT;
  const url = process.env.ALE_BRIDGE_URL;
  const token = process.env.ALE_BRIDGE_TOKEN;
  if (!root || !url || !token) throw new Error("ALE_RUN_ROOT, ALE_BRIDGE_URL and ALE_BRIDGE_TOKEN are required");
  const workspace = new Workspace(root, { dirs: ["workspace", "work", "results", "components"] });
  workspace.writeGuard = (path) => {
    if (/^(results\/|components\/|AGENTS\.md$)/i.test(path)) throw new Error("reserved runtime path");
  };
  const call = async (path: string, body: Record<string, unknown> = {}): Promise<BridgeReply> => {
    const response = await fetch(`${url}${path}`, { method: "POST", headers: { "Content-Type": "application/json", "X-ALE-Token": token }, body: JSON.stringify(body) });
    const value = await response.json() as BridgeReply;
    if (!response.ok) throw new Error(String(value.error ?? response.statusText));
    return value;
  };
  for (const tool of workspace.fileTools()) pi.registerTool(tool as any);
  pi.registerTool({ name: "ale_public_eval", label: "ale_public_eval", executionMode: "sequential",
    description: "Evaluate a workspace source file on ALE-Bench public cases. This is the normal iteration boundary.",
    parameters: Type.Object({ path: Type.String(), code_language: Type.Optional(Type.String()) }),
    async execute(_id, args) {
      try { return text(await call("/public_eval", { code: workspace.read(args.path), code_language: args.code_language ?? "cpp23" })); }
      catch (error) { return text(String(error), true); }
    } });
  pi.registerTool({ name: "ale_case_eval", label: "ale_case_eval", executionMode: "sequential",
    description: "Run an explicit public diagnostic case set. Never supplies private cases.",
    parameters: Type.Object({ path: Type.String(), input_str: Type.String(), code_language: Type.Optional(Type.String()) }),
    async execute(_id, args) {
      try { return text(await call("/case_eval", { input_str: args.input_str, code: workspace.read(args.path), code_language: args.code_language ?? "cpp23" })); }
      catch (error) { return text(String(error), true); }
    } });
  pi.registerTool({ name: "ale_private_eval", label: "ale_private_eval", executionMode: "sequential",
    description: "Submit the selected best source once for terminal private evaluation.",
    parameters: Type.Object({ path: Type.String(), code_language: Type.Optional(Type.String()) }),
    async execute(_id, args) {
      try { return text(await call("/private_eval", { code: workspace.read(args.path), code_language: args.code_language ?? "cpp23" })); }
      catch (error) { return text(String(error), true); }
    } });
  pi.on("before_agent_start", async (event) => ({
    systemPrompt: `${event.systemPrompt}\n\nYou solve one ALE-Bench optimization problem. Work only inside workspace. Read the statement supplied by the task, write a compilable source file, use ale_public_eval to measure changes, and call ale_private_eval once only after selecting your best public result. Do not seek private seeds, standings, session objects, or host files. Keep durable findings in work/notes.`,
  }));
}
