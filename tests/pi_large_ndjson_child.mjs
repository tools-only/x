const largeIntermediateEvent = {
	type: "tool_execution_end",
	result: { content: [{ type: "text", text: "x".repeat(2_100_000) }] },
};

const finalMessage = {
	type: "message_end",
	message: {
		role: "assistant",
		content: [{ type: "text", text: "Bounded subagent conclusion." }],
		stopReason: "stop",
		usage: {
			input: 7,
			output: 3,
			cacheRead: 0,
			cacheWrite: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
	},
};

process.stdout.write(`${JSON.stringify(largeIntermediateEvent)}\n`);
process.stdout.write(`${JSON.stringify(finalMessage)}\n`);
