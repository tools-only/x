/** Scripted provider for the Kaggle runner wiring test. No paid or network calls. */
import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { scriptedProviderTransport } from "./pi_scripted_provider_transport.ts";

export default function(pi: any) {
  let turn = 0;
  pi.registerProvider("az-kaggle", {
    baseUrl: "http://localhost", apiKey: "diagnostic", api: "openai-completions",
    models: [{ id: "qwen3.8-27b", name: "scripted", reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100000, maxTokens: 2048 }],
    streamSimple: scriptedProviderTransport((model: any, context: any) => {
      const all = JSON.stringify(context.messages ?? context);
      let content: any[];
      if (turn === 0) {
        content = [
          { type: "toolCall", id: "csv", name: "write", arguments: { path: "submissions/test.csv", content: "id,target\na,0.1\nb,0.7\nc,0.4\n" } },
          { type: "toolCall", id: "py", name: "run_python", arguments: { code: "print('HOST_PY_OK')", timeout_s: 60 } },
        ];
      } else if (turn === 1) {
        assert.match(all, /HOST_PY_OK/);
        content = [{ type: "toolCall", id: "submit", name: "kaggle_submit",
          arguments: { file: "submissions/test.csv", message: "baseline", cv_score: 0.9, dry_run: true } }];
      } else if (turn === 2) {
        assert.match(all, /id_set_matches_sample/);
        content = [{ type: "toolCall", id: "finish", name: "finish",
          arguments: { summary: "wiring probe complete", best_public_score: 0.9 } }];
      } else {
        content = [{ type: "text", text: "SCRIPTED_RUNNER_DONE" }];
      }
      appendFileSync(join(process.env.KAGGLE_DEMO_ROOT!, "scripted-provider.jsonl"), JSON.stringify({ turn }) + "\n");
      turn += 1;
      const message: any = { role: "assistant", api: model.api, provider: model.provider, model: model.id, content,
        stopReason: content.some(block => block.type === "toolCall") ? "toolUse" : "stop", timestamp: Date.now(),
        usage: { input: 20, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 40,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      const stream = createAssistantMessageEventStream();
      stream.push({ type: "done", reason: message.stopReason, message }); stream.end(); return stream;
    }),
  });
}
