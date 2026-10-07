import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Provider registration that exercises Pi's ordinary OpenAI-compatible HTTP path. */
export default function restrictedExpressionDiagnosticHttpProvider(pi: ExtensionAPI): void {
	pi.registerProvider("restricted-expression-diagnostic-http-test", {
		api: "openai-completions",
		apiKey: "offline",
		baseUrl: process.env.PI_DIAGNOSTIC_HTTP_BASE_URL ?? "http://127.0.0.1:9/v1",
		models: [{
			id: "scripted", name: "scripted", reasoning: false, input: ["text"],
			contextWindow: 128000, maxTokens: 1024,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		}],
	});
}
