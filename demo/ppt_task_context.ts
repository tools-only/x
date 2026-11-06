/** Request-only projection. Durable Pi history, live results and reasoning stay intact. */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { ContextEvent } from '@earendil-works/pi-coding-agent';
import { historyResult } from './arc_thin_native_context.ts';
import type { Workspace } from './arc_thin_workspace.ts';

type Messages = ContextEvent['messages'];

export function projectPptTaskContext(messages: Messages, workspace: Workspace): Messages {
  // Each closed task turn has its own fixed recent-result allowance. Moving a global
  // recent window on every tool continuation would keep changing the cached prefix.
  const stateStarts = messages.flatMap((m, i) => m.role === 'custom' && m.customType === 'ppt-work-state' ? [i] : []);
  if (!stateStarts.length) return messages;
  const current = stateStarts.at(-1)!;
  const retained = new Set<number>();
  for (let turn = 0; turn < stateStarts.length - 1; turn++) {
    const results = messages.slice(stateStarts[turn], stateStarts[turn + 1])
      .flatMap((m, i) => m.role === 'toolResult' ? [stateStarts[turn] + i] : []);
    for (const index of results.slice(-2)) retained.add(index);
  }
  const results = new Map(messages.flatMap((m, i) => m.role === 'toolResult' ? [[m.toolCallId, { message: m, index: i }] as const] : []));
  return messages.map((message, index) => {
    if (index < current && message.role === 'custom' && message.customType === 'ppt-work-state') {
      const saved = workspace.saveResult(typeof message.content === 'string' ? message.content : JSON.stringify(message.content));
      return { ...message, content: `Historical task state: ${saved.ref} (sha256=${saved.hash}). The later task-state message is current.` };
    }
    if (message.role === 'assistant') {
      const content = message.content.map(block => {
        if (block.type !== 'toolCall' || !['write', 'edit', 'save_program', 'edit_program', 'self_component'].includes(block.name)) return block;
        const result = results.get(block.id);
        // Successful source writes enter history as references on their first replay,
        // so later tool rounds never have to rewrite this prefix. Execution already used
        // the original arguments; incomplete and failed calls remain exact for repair.
        if (!result || result.message.isError) return block;
        const fields = ['content', 'body', 'old_text', 'new_text'];
        if (!fields.some(key => typeof block.arguments[key] === 'string' && block.arguments[key].length > 1000)) return block;
        const saved = workspace.saveResult(JSON.stringify(block.arguments));
        const args = { ...block.arguments };
        for (const key of fields) if (typeof args[key] === 'string' && args[key].length > 1000)
          args[key] = `[Historical ${key}: ${args[key].length} chars; original arguments: ${saved.ref}; sha256=${saved.hash}]`;
        return { ...block, arguments: args };
      });
      return { ...message, content };
    }
    if (index >= current || message.role !== 'toolResult' || message.isError) return message;
    const content = message.content.map(block => {
      if (block.type === 'image') {
        const bytes = Buffer.from(block.data, 'base64');
        const hash = createHash('sha256').update(bytes).digest('hex');
        const extension = block.mimeType.split('/')[1].replace(/[^a-z0-9]/gi, '') || 'bin';
        const ref = `results/ppt-context-${hash}.${extension}`;
        if (!existsSync(workspace.path(ref))) workspace.runtimeWrite(ref, bytes);
        return { type: 'text' as const, text: `Historical image: ${ref} (sha256=${hash}); read this path to view the original image.` };
      }
      if (block.type !== 'text' || retained.has(index) || block.text.length <= 5000) return block;
      return { ...block, text: historyResult(block.text, 5000, text => workspace.saveResult(text).ref) };
    });
    return { ...message, content };
  });
}
