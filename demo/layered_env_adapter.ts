/** Environment-owned text and rendering at the layered Pi boundary. */

/**
 * Domain-agnostic signals the outer Loop needs to evaluate its four gates.
 * Adapters map their environment state (actions, frame changes, failures,
 * completion conditions, budget/time exhaustion) into this shape.
 */
export type LoopSignals = {
  /** number of environment actions executed during the measured pass */
  executed: number;
  /** number of distinct new states observed during the measured pass */
  new_states: number;
  /** number of failures (deaths / lost attempts) during the measured pass */
  failures: number;
  /** number of SURPRISE / expectation misses during the measured pass */
  surprises: number;
  /** true when the pass's success criterion is satisfied (e.g. level cleared / task done) */
  completed: boolean;
  /** true when the environment's action or level budget is exhausted */
  budget_exhausted: boolean;
  /** true when the wall-clock segment/time budget is exhausted */
  time_exhausted: boolean;
  /** compact labels for facts newly confirmed/falsified this pass (may be empty) */
  facts: string[];
};

export type LayeredEnvAdapter = {
  systemPrompt(flags: Record<string, boolean>, maxActionsPerCall: number, harnessProfile: boolean): string;
  /** Optional: map current environment state into Loop gate signals. */
  loopSignals?(state: unknown): LoopSignals;
};
