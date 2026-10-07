/** Scripted transport honors SDK hooks; its payload is Context, never native HTTP. */
import { createAssistantMessageEventStream, type AssistantMessage, type AssistantMessageEventStream,
    type Api, type Context, type Model, type SimpleStreamOptions } from "@earendil-works/pi-ai";

type ScriptedStreamer = (model: Model<Api>, context: Context, options?: SimpleStreamOptions) => AssistantMessageEventStream;

export function scriptedProviderTransport(decide: ScriptedStreamer): ScriptedStreamer {
    return (model, context, options) => {
        const stream = createAssistantMessageEventStream();
        const fail = (reason: "aborted" | "error", error?: unknown) => {
            const message: AssistantMessage = { role: "assistant", api: model.api, provider: model.provider,
                model: model.id, content: [], stopReason: reason, timestamp: Date.now(),
                ...(error ? { errorMessage: String(error instanceof Error ? error.message : error) } : {}),
                usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
                    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
            stream.push({ type: "error", reason, error: message });
            stream.end();
        };
        void (async () => {
            try {
                if (options?.signal?.aborted) { fail("aborted"); return; }
                const replaced = await options?.onPayload?.(context, model);
                const effectiveContext = (replaced === undefined ? context : replaced) as Context;
                if (options?.signal?.aborted) { fail("aborted"); return; }
                await options?.onResponse?.({ status: 200, headers: { "x-diagnostic-transport": "scripted-context" } }, model);
                const response = decide(model, effectiveContext, { ...options, onPayload: undefined, onResponse: undefined });
                for await (const event of response) stream.push(event);
                stream.end();
            } catch (error) { fail(options?.signal?.aborted ? "aborted" : "error", error); }
        })();
        return stream;
    };
}
