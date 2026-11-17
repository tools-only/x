/** Request-only projection for long Kaggle turns. Durable Pi history is unchanged. */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import type { ContextEvent } from "@earendil-works/pi-coding-agent";
import { historyResult } from "./arc_thin_native_context.ts";
import type { Workspace } from "./arc_thin_workspace.ts";

type Messages = ContextEvent["messages"];

/**
 * Training and inspection output is often far larger than a later decision needs.
 * Keep recent tool results and reasoning; archive older long results and code.
 * The durable Pi session is unchanged, so saved references retain the full evidence.
 */
export function projectKaggleTaskContext(messages: Messages, workspace: Workspace): Messages {
  const currentState = messages.findLastIndex(m => m.role === "custom" && m.customType === "kaggle-work-state");
  const toolResults = messages.flatMap((m, i) => m.role === "toolResult" ? [[m.toolCallId, { message: m, index: i }] as const] : []);
  const recentResults = new Set(toolResults.slice(-4).map(([, result]) => result.index));
  const reasoning = messages.flatMap((m: any, i) => m.role === "assistant" &&
    (m.reasoning_content || m.content.some((b: any) => b.type === "thinking")) ? [i] : []);
  const recentReasoning = new Set(reasoning.slice(-3));
  const results = new Map(toolResults);
  return messages.map((source: any, index) => {
    let message = source;
    if (index < currentState && message.role === "custom" && message.customType === "kaggle-work-state") {
      const saved = workspace.saveResult(typeof message.content === "string" ? message.content : JSON.stringify(message.content));
      return { ...message, content: `Historical task state: ${saved.ref} (sha256=${saved.hash}). The later task-state message is current.` };
    }
    if (message.role === "assistant" && !recentReasoning.has(index) && message.reasoning_content) {
      const { reasoning_content: _reasoning, ...withoutReasoning } = message;
      message = withoutReasoning;
    }
    if (message.role === "assistant") {
      const content = message.content.flatMap((block: any) => {
        if (block.type === "thinking" && !recentReasoning.has(index)) return [];
        if (block.type !== "toolCall" || !["write", "edit", "save_method", "edit_method", "self_component", "run_python"].includes(block.name)) return [block];
        const result = results.get(block.id);
        if (!result || result.message.isError) return [block];
        const fields = block.name === "run_python" ? ["code"] : ["content", "body", "old_text", "new_text"];
        if (!fields.some(key => typeof block.arguments[key] === "string" && block.arguments[key].length > 2500)) return [block];
        const saved = workspace.saveResult(JSON.stringify(block.arguments));
        const args = { ...block.arguments };
        for (const key of fields) if (typeof args[key] === "string" && args[key].length > 2500)
          args[key] = `[Historical ${key}: ${args[key].length} chars; original arguments: ${saved.ref}; sha256=${saved.hash}]`;
        return [{ ...block, arguments: args }];
      });
      return { ...message, content };
    }
    if (message.role !== "toolResult" || recentResults.has(index) || message.isError) return message;
    const content = message.content.map(block => {
      if (block.type === "image") {
        const bytes = Buffer.from(block.data, "base64");
        const hash = createHash("sha256").update(bytes).digest("hex");
        const ref = `results/kaggle-context-${hash}.png`;
        if (!existsSync(workspace.path(ref))) workspace.runtimeWrite(ref, bytes);
        return { type: "text" as const, text: `Historical image: ${ref} (sha256=${hash}); read this path to view it.` };
      }
      if (block.type !== "text" || block.text.length <= 1200) return block;
      return { ...block, text: historyResult(block.text, 2200, text => workspace.saveResult(text).ref) };
    });
    return { ...message, content };
  });
}
