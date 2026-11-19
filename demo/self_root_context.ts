import type { ContextEvent } from "@earendil-works/pi-coding-agent";
import type { Workspace } from "./arc_thin_workspace.ts";

type Messages = ContextEvent["messages"];

/** Project an old conversation into a retrievable reference for one provider request. */
export function projectAgentHistory(messages: Messages, workspace: Workspace, keepAssistants = 8): Messages {
  const assistantIndices = messages.flatMap((message, index) => message.role === "assistant" ? [index] : []);
  if (assistantIndices.length <= keepAssistants) return messages;

  // Advance the archive every four assistant turns to avoid rewriting it on every request.
  const archivedAssistants = Math.floor((assistantIndices.length - keepAssistants) / 4) * 4;
  if (archivedAssistants === 0) return messages;
  const cutoff = assistantIndices[archivedAssistants];
  const prefix = messages.slice(0, cutoff);
  const archive = workspace.saveResult(JSON.stringify(prefix));
  const firstUser = prefix.find(message => message.role === "user");
  const lastUser = prefix.findLast(message => message.role === "user");
  const lastSystem = prefix.findLast(message => message.role === "system");
  const custom = new Map<string, Messages[number]>();
  for (const message of prefix) if (message.role === "custom") custom.set(message.customType, message);
  const retained = messages.slice(cutoff);
  const calls = new Set(retained.flatMap(message => message.role === "assistant"
    ? message.content.flatMap(block => block.type === "toolCall" ? [block.id] : []) : []));
  const linked = retained.filter(message => message.role !== "toolResult" || calls.has(message.toolCallId));
  const marker = { role: "user" as const, content: [{ type: "text" as const,
    text: `Earlier conversation: ${archive.ref} (sha256=${archive.hash}). Read recorded evidence when needed.` }], timestamp: Date.now() };
  return [...(lastSystem ? [lastSystem] : []), marker,
    ...(firstUser ? [firstUser] : []),
    ...(lastUser && lastUser !== firstUser && !linked.some(message => message.role === "user") ? [lastUser] : []),
    ...custom.values(), ...linked] as Messages;
}
