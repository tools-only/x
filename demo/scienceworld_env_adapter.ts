import { readFileSync } from "node:fs";
import type { LayeredEnvAdapter } from "./layered_env_adapter.ts";

export const scienceworldEnvAdapter: LayeredEnvAdapter = {
  systemPrompt() {
    return readFileSync(new URL("./prompts/scienceworld_system_harness.md", import.meta.url), "utf8");
  },
};
