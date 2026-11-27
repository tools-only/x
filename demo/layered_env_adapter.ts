/** Environment-owned text and rendering at the layered Pi boundary. */
export type LayeredEnvAdapter = {
  systemPrompt(flags: Record<string, boolean>, maxActionsPerCall: number, harnessProfile: boolean): string;
};
