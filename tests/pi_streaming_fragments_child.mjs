const fragments = [
  { type: "message_update", delta: "first" },
  { type: "text_delta", text: "second" },
  { type: "thinking_delta", text: "internal" },
];
for (const event of fragments) process.stdout.write(`${JSON.stringify(event)}\n`);
process.stdout.write(`${JSON.stringify({
  type: "message_end",
  message: {
    role: "assistant",
    content: [{ type: "text", text: "stream complete" }],
    stopReason: "stop",
  },
})}\n`);
