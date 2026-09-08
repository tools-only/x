import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  pi.registerProvider("yibu", {
    name: "Yibu",
    baseUrl: "https://yibuapi.com/v1",
    apiKey: "$META_PROVIDER_API_KEY",
    api: "openai-completions",
    models: [{
      id: "deepseek-v4-flash",
      name: "DeepSeek V4 Flash",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 4096,
    }],
  });
  let marker = "before";
  pi.registerTool({
    name: "set_marker",
    label: "Set marker",
    description: "Set a native extension marker.",
    parameters: Type.Object({ value: Type.String() }),
    async execute(_id, params) {
      marker = params.value;
      return { content: [{ type: "text", text: marker }], details: { marker } };
    },
  });
  pi.on("before_agent_start", async (event) => ({
    systemPrompt: `${event.systemPrompt}\nmarker=${marker}`,
  }));
  pi.registerCommand("native-smoke", {
    description: "Verify the Pi-native smoke extension is loaded.",
    handler: async () => {},
  });
}
