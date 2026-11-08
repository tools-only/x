import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export const PPT_GOAL = 'PPT production';
export const PPT_ACTIONS = ['render', 'look', 'deliver'] as const;
export const OFFICE_ACTION_DESCRIPTION = 'Render the current presentation or prototype (HTML or scene JSON under artifacts/), look at rendered pages as images, or deliver. Rendering takes a screenshot of every slide; delivery copies the rendered revision and your harness.';

export function canonicalPath(workspace: any): string | undefined {
  if (existsSync(workspace.path('artifacts/presentation.html'))) return 'artifacts/presentation.html';
  if (existsSync(workspace.path('artifacts/deck.json'))) return 'artifacts/deck.json';
  const htmlSources = workspace.files('artifacts').filter((path: string) => path.toLowerCase().endsWith('.html'));
  return htmlSources.length === 1 ? htmlSources[0] : undefined;
}

export function sourceFacts(workspace: any, path = canonicalPath(workspace)) {
  if (!path) return undefined;
  return { source: path, hash: createHash('sha256').update(readFileSync(workspace.path(path))).digest('hex') };
}

export function deliveryIntegrity(workspace: any, receipt: any, canonical: string | undefined, revision: number | undefined,
  currentRevision: number, hash: (path: string) => string): string | undefined {
  if (!canonical) return 'Delivery needs one canonical source: use artifacts/presentation.html or artifacts/deck.json, or leave a single HTML source under artifacts/, then render it.';
  if (receipt.source_path !== canonical) return `Rendered source ${receipt.source_path} is not the current canonical source ${canonical}; render ${canonical} before delivery.`;
  if (hash(receipt.source_path) !== receipt.source_sha256) return 'Deck changed since render; render current version before delivery.';
  if (revision !== currentRevision) return 'Render the current canonical source before delivery.';
  return undefined;
}

export function statusFacts({ source, state, evidenceLine, lineageLine, workspace, tokensSpent, spent, cap, deadline }: any): string {
  const memoryPaths = workspace.files('notes').filter((path: string) => path === 'notes/memory.md' || /^notes\/memory\/[^/]+\.md$/.test(path));
  const feedback = state.lastFeedback;
  const budget = `Observed parent+consult tokens: ${Math.ceil(tokensSpent)} (no token cap); estimated $${spent.toFixed(2)} / $${cap.toFixed(2)}; remaining ${Math.max(0, Math.ceil((deadline - Date.now()) / 60000))} min.`;
  return ['CURRENT STATE',
    `Canonical source: ${source ? `${source.source} sha256=${source.hash}` : 'not created'}.`,
    feedback ? `Last render: revision ${feedback.revision} of ${feedback.source_path}, ${feedback.slides} slide(s), ${feedback.warnings?.length ?? 0} warning(s); evidence in ${feedback.evidence}.` : 'No render yet.',
    `Rendered revisions: ${(state.renderedRevisions ?? []).map((r: any) => r.revision).join(', ') || 'none'}.`,
    evidenceLine(), lineageLine(), `Memory files: ${memoryPaths.join(', ') || 'none'}.`, budget].join('\n');
}
