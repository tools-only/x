/** Offline scripted provider for the layered profile: emits python calls; every request it receives is recorded in
 * <ARC_RUN_ROOT>/smoke-requests.jsonl so that the run can show what the model was actually sent. */
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { createAssistantMessageEventStream, getCurrentSystemPrompt, getCurrentTools, type AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { scriptedProviderTransport } from "../tests/pi_scripted_provider_transport.ts";

const ACT = "a = [v for v in valid_actions if v not in ('RESET', 'MOUSE')] or [{'action': 'MOUSE', 'x': 10, 'y': 10}]\n" +
  "before = current_frame\nr = submit_actions(a[:2])\nprint(r['lines'], 'refreshed:', before is not current_frame)";
const SCRIPT: Array<{ text?: string; code?: string; consult?: boolean; reflect?: boolean; bound?: string; stop?: "length"; filler?: boolean }> = [
  { code: "seg = current_frame.segmentation\nprint(len(seg['nodes']), valid_actions)" },
  { text: "World model: first guess\nPlan: try the first action", code: ACT },
  { text: "I will think about it." },
  { text: "World model: revised guess", code: ACT },
  { text: "cut off", stop: "length" },
  { text: "Cross-level notes: kept after the length stop", code: ACT },
  { text: "x".repeat(60000), code: "print('y' * 9000)" },
  { code: ACT },
  { code: ACT },
];
const READ_ACT_SCRIPT: typeof SCRIPT = [
  { code: "initial_step = current_frame.step\nobjects = current_frame.segmentation['nodes']\n" +
      "if objects:\n    detail = objects[0]['color']\nelse:\n    detail = len(current_frame.grid)\n" +
      "print('READ_PATH', initial_step, len(objects), detail)\n" +
      "if 'UP' in valid_actions:\n    r = submit_actions('UP')\n    print('POST_ACT', current_frame.step, len(history), r['executed_count'])" },
  { code: "print('NEXT_TURN', initial_step, current_frame.step, len(history))\nsubmit_actions('RIGHT')" },
];
const CONSULT_SCRIPT: typeof SCRIPT = [
  { consult: true },
  { text: "Parent received the consultation.", code: "submit_actions('UP')" },
  { text: "done" },
];
const EVO_WRITE_SCRIPT: typeof SCRIPT = [
  { code: "with open('work/claims/action_seen.py', 'w') as f: f.write('def check(t):\\n    return True if t.action == \\\"UP\\\" else None\\n')\nprint(submit_actions('UP')['lines'])" },
  { code: "print('CLAIM_AFTER_ACTION', harness_state['claims']['action_seen']['support'])\nsubmit_actions('UP')" },
];
const EVOLVE_SCRIPT: typeof SCRIPT = [
  { code: "submit_actions('UP')" },
  { reflect: true },
  { code: "import collections\n@tool\ndef frame_size(args):\n    return collections.Counter(current_frame.grid[0])[0]\nprint('published')" },
  { bound: "frame_size" },
  { code: "submit_actions('UP')" },
];

export default function arcLayeredSmokeProvider(pi: ExtensionAPI) {
  let step = 0;
  pi.registerProvider("offline-arc-layered-smoke", {
    api: "openai-completions", apiKey: "offline", baseUrl: "http://unused.invalid",
    models: [{ id: "scripted", name: "scripted", reasoning: false, input: ["text", "image"], contextWindow: 175000, maxTokens: 16384,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    streamSimple: scriptedProviderTransport((model, context) => {
      const stream = createAssistantMessageEventStream();
      const script = process.env.ARC_LAYERED_SMOKE_SCRIPT === "evo-write" ? EVO_WRITE_SCRIPT
        : process.env.ARC_LAYERED_SMOKE_SCRIPT === "read-act" ? READ_ACT_SCRIPT
        : process.env.ARC_LAYERED_SMOKE_SCRIPT === "consult" ? CONSULT_SCRIPT
        : process.env.ARC_LAYERED_SMOKE_SCRIPT === "evolve" ? EVOLVE_SCRIPT : SCRIPT;
      const messages: any[] = context.messages ?? [], system = String(context.systemPrompt || getCurrentSystemPrompt(messages as any) || "");
      const child = system.startsWith("Give two mutually exclusive explanations");
      const row = script[step] ?? { text: "done" };
      if (!child) step += 1;
      const tools: any[] = (context.tools?.length ? context.tools : getCurrentTools(messages as any)) ?? [];
      const talk = messages.filter(message => message.role !== "system");
      const parts = (message: any) => typeof message.content === "string" ? [{ type: "text", text: message.content }] : message.content;
      const users = talk.filter(message => message.role === "user");
      appendFileSync(join(process.env.ARC_RUN_ROOT!, "smoke-requests.jsonl"), JSON.stringify({ step, child, tools: tools.map(tool => tool.name),
        system_start: system.slice(0, 80), system_chars: system.length, roles: talk.map(message => message.role),
        images: talk.flatMap(parts).filter((part: any) => part.type === "image").length,
        calls: talk.filter(m => m.role === "assistant").flatMap(m => m.content.filter((p: any) => p.type === "toolCall").map((p: any) => p.id)),
        results: talk.filter(m => m.role === "toolResult").map(m => m.toolCallId),
        last_user: users.length ? parts(users.at(-1)).map((p: any) => p.type === "text" ? p.text : "[image]").join("\n") : null }) + "\n");
      const output: AssistantMessage = { role: "assistant", api: model.api, provider: model.provider, model: model.id, content: [],
        stopReason: child ? "stop" : row.stop ?? (row.code || row.consult || row.reflect || row.bound ? "toolUse" : "stop"), timestamp: Date.now(),
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      stream.push({ type: "start", partial: output });
      if (child) output.content.push({ type: "text", text: "Two distinct explanations; probe with one action." });
      else if (row.text) output.content.push({ type: "text", text: row.text });
      if (!child && row.code) output.content.push({ type: "toolCall", id: `call-${step}`, name: "python", arguments: { code: row.code } });
      if (!child && row.consult) output.content.push({ type: "toolCall", id: `call-${step}`, name: "consult", arguments: { name: "reframer", question: "What might explain the current frame?" } });
      if (!child && row.reflect) output.content.push({ type: "toolCall", id: `call-${step}`, name: "reflect_component", arguments: {
        op: "define", kind: "memory", name: "current", body: "Probe the next transition", verify: { changed: "t.result['changed_cells'] > 0" } } });
      if (!child && row.bound) output.content.push({ type: "toolCall", id: `call-${step}`, name: row.bound, arguments: { args: {} } });
      stream.push({ type: "done", reason: output.stopReason as any, message: output });
      stream.end();
      return stream;
    }),
  });
}
