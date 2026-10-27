/** Small parser for the Agent-authored trial lines in its existing review files. */
export type MetaReviewLines = {
  expect?: { within: number; claim: string };
  decision?: { choice: "keep" | "revise" | "remove" | "no_change"; reason: string };
};

export function parseMetaReviewLines(body: string): MetaReviewLines {
  const lines = body.split(/\r?\n/);
  const prefix = "^\\s*(?:[-*#]\\s*)?";
  const expectLine = lines.find((line) => new RegExp(`${prefix}EXPECT\\s+within\\s+\\d+\\s+actions?\\s*:`, "i").test(line));
  const expectMatch = expectLine?.match(/^\s*(?:[-*#]\s*)?EXPECT\s+within\s+(\d+)\s+actions?\s*:\s*(.+?)\s*$/i);
  const within = Number(expectMatch?.[1]);
  const claim = expectMatch?.[2]?.trim();
  const decisionLine = lines.find((line) => /^\s*(?:[-*#]\s*)?DECISION\s*:/i.test(line));
  const decisionMatch = decisionLine?.match(/^\s*(?:[-*#]\s*)?DECISION\s*:\s*(keep|revise|remove|no_change)\b\s*(?:[-—:]\s*)?(.*)$/i);
  return {
    ...(Number.isSafeInteger(within) && within > 0 && claim ? { expect: { within, claim } } : {}),
    ...(decisionMatch ? { decision: { choice: decisionMatch[1].toLowerCase() as NonNullable<MetaReviewLines["decision"]>["choice"],
      reason: decisionMatch[2].trim() } } : {}),
  };
}

/** Protocol lines are ledger input, not recurring gameplay instructions. */
export function stripMetaReviewControlLines(body: string): string {
  return body.split(/\r?\n/).filter((line) =>
    !/^\s*(?:[-*]\s*)?(?:EXPECT\s+within\s+\d+\s+actions?\s*:|DECISION\s*:)/i.test(line)).join("\n");
}

/** An optional expectation on a saved Python component; no new file or tool call is needed. */
export function parseComponentExpect(source: string): MetaReviewLines['expect'] {
  return parseMetaReviewLines(source.split(/\r?\n/).slice(0, 10).join('\n')).expect;
}

export type MountExpectation = { path: string; equals: unknown };
export type MountCheck = { path: string; expected: unknown; actual?: unknown; hit: boolean; missing?: boolean };
function canonicalJson(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item) ?? 'null').join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().filter((key) => object[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key]) ?? 'null'}`).join(',')}}`;
}
/** Compare Agent-selected paths with the canonical post-action observation; never infer game semantics. */
export function compareMountExpectations(expected: MountExpectation[], actual: Record<string, unknown>): MountCheck[] {
  return expected.map(({ path, equals }) => {
    const parts = path.split('.');
    let value: unknown = actual;
    let missing = false;
    for (const part of parts) {
      if (!value || typeof value !== 'object' || !Object.hasOwn(value, part)) { missing = true; break; }
      value = (value as Record<string, unknown>)[part];
    }
    return { path, expected: equals, ...(missing ? { missing: true } : { actual: value }),
      hit: !missing && canonicalJson(value) === canonicalJson(equals) };
  });
}

/** A semantic choice does not change a component; close only when the saved versions show that choice happened. */
export function metaDecisionVersionError(paths: string[], candidate: Record<string, number>,
  current: Record<string, number>, choice: string): string | undefined {
  if (!paths.length) return 'no candidate path was bound to this trial';
  const same = paths.every((path) => current[path] === candidate[path]);
  const removed = paths.every((path) => current[path] === undefined);
  const revised = paths.some((path) => current[path] !== undefined && current[path] !== candidate[path]);
  const valid = choice === 'remove' ? removed : choice === 'revise' ? revised : same;
  return valid ? undefined : `${choice} does not match the saved candidate version`;
}

export type MetaTrialFacts = {
  actions: number;
  componentCalls: number;
  componentErrors: number;
  componentViews: number;
  viewErrors: number;
  promptDecisions: number;
  predictorChecks: number;
  predictionErrors: number;
  predictionHits: number;
  predictionMisses: number;
  guardChecks: number;
  guardRefusals: number;
  actionChangesAfterRefusal: number;
  mountDecisionRuns: number;
  mountActionChecks: number;
  mountRefusals: number;
  mountErrors: number;
  mountFeedbackRuns: number;
  mountPredictionHits: number;
  mountPredictionMisses: number;
};

/** Mechanical evidence only. The returned facts do not decide whether the change helped. */
export function metaTrialFacts(input: {
  start: number;
  end: number;
  level: number;
  candidatePaths?: string[];
  candidateVersions?: Record<string, number>;
  startDecision?: number;
  endDecision?: number;
  actions: Array<{ n: number; level?: number; after_guard_refusal?: { changed: boolean } }>;
  guards: Array<{ n: number; level: number; path?: string; version?: number; sent: boolean; changed_after_refusal?: boolean }>;
  components?: Array<{ n: number; path: string; version?: number; kind?: string; phase?: string; ok?: boolean }>;
  mountActions?: Array<{ n: number; level: number; path?: string; version?: number; allow: boolean }>;
  mountChecks?: Array<{ n: number; level: number; path: string; version: number; hit: boolean }>;
  views?: Array<{ n: number; key?: string; name?: string; ok?: boolean }>;
  promptRuns?: Array<{ decision: number; active_prompt_versions?: Record<string, number> }>;
}): MetaTrialFacts {
  const actions = input.actions.filter((row) => row.n > input.start && row.n <= input.end &&
    (row.level === undefined || row.level === input.level));
  const hasCandidateScope = input.candidatePaths !== undefined;
  const candidatePaths = new Set(input.candidatePaths ?? []);
  const guards = input.guards.filter((row) => row.n > input.start && row.n <= input.end && row.level === input.level &&
    (!hasCandidateScope || (candidatePaths.has(String(row.path)) && row.version === input.candidateVersions?.[String(row.path)])));
  const inWindow = <T extends { n: number }>(rows: T[]) => rows.filter((row) => row.n >= input.start && row.n <= input.end);
  const components = inWindow(input.components ?? []).filter((row) => !hasCandidateScope ||
    (candidatePaths.has(row.path) && row.version === input.candidateVersions?.[row.path]));
  const mountActions = (input.mountActions ?? []).filter((row) => row.n > input.start && row.n <= input.end &&
    row.level === input.level && (!hasCandidateScope ||
      (candidatePaths.has(String(row.path)) && row.version === input.candidateVersions?.[String(row.path)])));
  const mountChecks = (input.mountChecks ?? []).filter((row) => row.n > input.start && row.n <= input.end &&
    row.level === input.level && (!hasCandidateScope ||
      (candidatePaths.has(row.path) && row.version === input.candidateVersions?.[row.path])));
  const views = inWindow(input.views ?? []).filter((row) => !hasCandidateScope || [...candidatePaths].some((path) =>
    row.key?.startsWith(`${path}@${input.candidateVersions?.[path]}@`)));
  const promptDecisions = (input.promptRuns ?? []).filter((row) => Number(row.decision) > (input.startDecision ?? 0) &&
    Number(row.decision) <= (input.endDecision ?? Number.POSITIVE_INFINITY) && [...candidatePaths].some((path) =>
      row.active_prompt_versions?.[path] === input.candidateVersions?.[path]));
  const predictions = actions.flatMap((row: any) => row.predictors ?? [])
    .filter((row: any) => !hasCandidateScope || (candidatePaths.has(row.path) && row.version === input.candidateVersions?.[row.path]));
  const predictionFields = predictions.flatMap((row: any) => row.fields ?? []);
  return {
    actions: actions.length,
    componentCalls: components.filter((row) => row.kind === "tool").length,
    componentErrors: components.filter((row) => row.kind === "tool" && row.ok === false).length,
    componentViews: views.length,
    viewErrors: views.filter((row) => row.ok === false).length,
    promptDecisions: promptDecisions.length,
    predictorChecks: predictions.length,
    predictionErrors: predictions.filter((row: any) => Boolean(row.error)).length,
    predictionHits: predictionFields.filter((field: any) => field.hit === true).length,
    predictionMisses: predictionFields.filter((field: any) => field.hit === false).length,
    guardChecks: guards.length,
    guardRefusals: guards.filter((row) => row.sent === false).length,
    actionChangesAfterRefusal: hasCandidateScope
      ? new Set(guards.filter((row) => row.changed_after_refusal).map((row) => row.n)).size
      : actions.filter((row) => Boolean(row.after_guard_refusal?.changed)).length,
    mountDecisionRuns: components.filter((row) => row.kind === 'mount' && row.phase === 'decision').length,
    mountActionChecks: mountActions.length,
    mountRefusals: mountActions.filter((row) => row.allow === false).length,
    mountErrors: components.filter((row) => row.kind === 'mount' && row.ok === false).length,
    mountFeedbackRuns: components.filter((row) => row.kind === 'mount' && row.phase === 'feedback').length,
    mountPredictionHits: mountChecks.filter((row) => row.hit).length,
    mountPredictionMisses: mountChecks.filter((row) => !row.hit).length,
  };
}
