/** Project Pi's canonical retained history without inventing a decision window. */
export function projectNativeHistory(messages: any[], replayReasoning = false): any[] {
  const answered = new Set(messages.filter(m => m?.role === 'toolResult').map(m => String(m.toolCallId)));
  const calls = new Set<string>();
  const out: any[] = [];
  for (const message of messages) {
    if (message?.role === 'assistant') {
      const content = (Array.isArray(message.content) ? message.content : []).filter((block: any) => {
        if (block.type === 'thinking') return replayReasoning;
        if (block.type === 'toolCall') return answered.has(String(block.id));
        return true;
      });
      for (const block of content) if (block.type === 'toolCall') calls.add(String(block.id));
      if (content.length) out.push({ ...message, content });
    } else if (message?.role !== 'toolResult' || calls.has(String(message.toolCallId))) out.push(message);
  }
  return out;
}
