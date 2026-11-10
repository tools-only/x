/** Pi 0.87.0 extension. The Mirror is reinjected immediately before every provider request. */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { appendFileSync } from 'node:fs';
import { LiveSelfSession, type Grant } from './live_self_core.ts';
import { closeLiveSelfMethods } from './live_self_wasi.ts';

const grantFromEnv = (): Grant[] => {
  const raw = process.env.LIVE_SELF_GRANTS;
  if (!raw) return [{ target: 'task_harness', operation: 'replace' }, { target: 'evolution_loop', operation: 'replace' }];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(g => ['task_harness', 'evolution_loop'].includes(g?.target) && g?.operation === 'replace');
  } catch { return []; }
};

export default function liveSelfExtension(pi: ExtensionAPI) {
  let self: LiveSelfSession | undefined;
  const ensureSelf = (ctx: any) => {
    if (!ctx && self) return self;
    const piSessionId = ctx?.sessionManager?.getSessionId?.() ?? 'unbound-pi-session';
    if (!self || self.piSessionId !== piSessionId) self = new LiveSelfSession(grantFromEnv(), piSessionId);
    return self;
  };
  let requestSelf: LiveSelfSession | undefined;
  let requestRevision = 1;
  const record = (event: string, value: unknown) => {
    const path = process.env.LIVE_SELF_TRACE;
    if (!path) return;
    try { appendFileSync(path, `${JSON.stringify({ event, at: new Date().toISOString(), value })}\n`, 'utf8'); } catch { /* tracing is optional */ }
  };
  pi.on('session_start', async (_event: any, ctx: any) => { self = ensureSelf(ctx); });
  pi.registerTool({
    name: 'reflect', label: 'Reflect',
    description: 'Atomically replace one granted typed method in the live Agent using its opaque Mirror operation ref. Parameters: ref (the current operation ref), replace=true, value (the new typed source). The runtime validates session, workspace, authorization, target, type, grant revocation, and pinned revision at commit. A changed method affects only later requests and creates no semantic auto-promotion.',
    parameters: Type.Object({ ref: Type.String(), replace: Type.Literal(true), value: Type.Object({ type: Type.Literal('text'), value: Type.String() }), reasoning: Type.Optional(Type.String()) }),
    async execute(_id, args) {
      try {
        const result = ensureSelf(undefined).reflect({ ref: args.ref, replace: args.replace, value: args.value });
        record('reflect_committed', result);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (e) { return { content: [{ type: 'text', text: `reflect rejected: ${(e as Error).message}` }], isError: true }; }
    },
  });
  pi.registerTool({
    name: 'draft_item', label: 'Draft Item',
    description: 'Perform ordinary task work by executing the active WASI-backed harness method on supplied source text. The active evolution-loop method automatically compares the draft with the source and returns review evidence; the Agent chooses whether to keep, defer, or change its self.',
    parameters: Type.Object({ task: Type.String({ minLength: 1 }), source_text: Type.String({ minLength: 1 }) }),
    async execute(_id, args, signal) {
      try { const result = await (requestSelf ?? ensureSelf(undefined)).draft(args.task, args.source_text, requestRevision, signal); record('draft', result); return { content: [{ type: 'text', text: JSON.stringify(result) }] }; }
      catch (e) { return { content: [{ type: 'text', text: `draft failed: ${(e as Error).message}` }], isError: true }; }
    },
  });
  pi.registerTool({
    name: 'review_self', label: 'Review Self',
    description: 'Optionally record the Agent’s semantic disposition for the latest self-review evidence. This is evidence, not a gate; task completion does not depend on calling this tool.',
    parameters: Type.Object({ evidence_id: Type.String({ minLength: 1 }), disposition: Type.Union([Type.Literal('keep'), Type.Literal('defer'), Type.Literal('change')]), rationale: Type.String({ minLength: 1 }) }),
    async execute(_id, args) {
      try { const result = ensureSelf(undefined).recordReview(args.evidence_id, args.disposition, args.rationale); record('review_decision', result); return { content: [{ type: 'text', text: JSON.stringify(result) }] }; }
      catch (e) { return { content: [{ type: 'text', text: (e as Error).message }], isError: true }; }
    },
  });
  pi.registerTool({
    name: 'submit_item', label: 'Submit Item',
    description: 'Deliver a draft by its evidence_id. Optional content overrides the artifact. self_review records whether to keep, defer, or change your own methods. Editing content alone does not change your methods.',
    parameters: Type.Object({ evidence_id: Type.String({ minLength: 1 }), content: Type.Optional(Type.String()),
      self_review: Type.Object({ disposition: Type.Union([Type.Literal('keep'), Type.Literal('defer'), Type.Literal('change')]),
        rationale: Type.String({ minLength: 1, description: 'Why retain, defer judgment on, or change your own methods?' }) }) }),
    async execute(_id, args) {
      try { const result = ensureSelf(undefined).submit(args.evidence_id, args.self_review.disposition, args.self_review.rationale, args.content); record('submit', result); return { content: [{ type: 'text', text: JSON.stringify(result) }] }; }
      catch (e) { return { content: [{ type: 'text', text: (e as Error).message }], isError: true }; }
    },
  });
  // Pi fires this for each actual provider request, including tool continuations. Pin that turn's revision
  // for all tool calls returned by it, while sending a fresh, complete Mirror to the next turn.
  pi.on('context_with_system', async (event: any, ctx: any) => {
    requestSelf = ensureSelf(ctx);
    requestRevision = requestSelf.current.version;
    const messages = [...event.messages];
    const i = messages.findIndex((m: any) => m.role === 'system');
    if (i < 0) return { messages };
    const msg = { ...messages[i] };
    const marker = '\n\n[LIVE_SELF_MIRROR]\n';
    const body = typeof msg.content === 'string' ? msg.content : Array.isArray(msg.content) ? msg.content.map((p: any) => p?.text ?? '').join('') : '';
    const clean = body.includes(marker) ? body.slice(0, body.indexOf(marker)) : body;
    const mirror = requestSelf.mirror('current task');
    const block = `${marker}${JSON.stringify(mirror)}\nUse draft_item and submit_item for ordinary task work. The self_review decision concerns your own methods. The content field concerns the artifact. You decide whether your methods warrant any change. On each successful reflect commit, the next provider request receives the new Mirror revision and operation refs.`;
    msg.content = clean + block;
    messages[i] = msg;
    return { messages };
  });
  pi.on('session_shutdown', async () => { if (self) record('session_trace', self.trace()); closeLiveSelfMethods(); });
}
