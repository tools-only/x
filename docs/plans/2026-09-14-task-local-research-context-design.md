# Task-local research working set and validation

Scope: the five requested changes, without preloading native skills or creating
task resources on behalf of the agent. Preserve emergency action-only recovery.

## Design

1. Remove next-action payoff requirements. Core contracts describe capabilities,
   evidence provenance and permissions, not the agent's strategy or resource order.
2. Maintain three context layers: protected task/checkpoint, a recent complete
   tool-transaction window, and bounded resource/validation indexes. Archive older
   transcript content by immutable reference before projecting it away. Agent-authored
   working summaries are labelled as interpretations, not runtime facts.
3. Keep complete versioned resources outside model context. Expose short summaries,
   reference/version/size and paged reads. Retain compare-and-swap writes; explain
   current-version conflicts with structured recovery, never silently overwrite.
   Small append operations allow long memory to be built incrementally.
4. Keep claims/predictions separate from observations. A generic validation ledger
   retains unresolved tests and explicit evidence-backed assessments; replacing a
   hypothesis does not validate or falsify it. Referencing evidence is not proof.
   Fix ARC's current/full observation mismatch without adding game-specific rules.
5. Extend existing isolated Pi delegation: optional per-call agent-authored roles,
   exact resource/evidence references, paged read-only access and compact parent
   results. No parent transcript inheritance, native skills, automatic adoption,
   recursive delegation or environment actions. An ephemeral call is not counted
   as creation of a persistent subagent definition.

Task roots remain immutable identity boundaries. Session rotation is not task end.
At owning runtime shutdown remove transient context cache and seal its task scope;
retain canonical audit artifacts. Reopening requires explicit same-task resume.
Never recursively remove the task root or canonical experiment logs.

## Implementation notes

- Normal message projection targets 80% of the configured envelope, then uses
  the existing hard recovery path if needed. This is a character working-set
  target, not a tokenizer-derived provider-limit guarantee. Tool arguments and
  protected state are never silently rewritten to satisfy an impossible bound;
  `protected_overflow` is audited.
- Exact transcript messages are content-addressed once per live context lifecycle;
  snapshot indexes point to these message refs, avoiding repeated full transcript
  copies. The owning Python PiKernel seals ARC/OfficeBench/Shopping task scopes;
  print-mode owners use Pi's `quit` event (not new/reload/fork). Interrupted print
  processes require owner cleanup if graceful shutdown was not delivered.
- Resource mutation count limits are opt-in experiment settings, not default
  pre-action gates. Emergency action-only recovery is preserved.
- Validation ledger records provenance and explicit agent verdicts. It does not
  determine game rules, prove a claim, or force research/component creation.
- Pi version conflicts are marked through the supported tool-result hook;
  truncated, unexecuted calls are captured at tool_execution_end because Pi skips
  execute/tool_result for these calls. Failed operation summaries survive session
  replacement, while raw attempted arguments stay external and are never replayed
  automatically. A successful deliberate retry clears the pending failure.
- Clean child validation may inspect granted resource implementations and execution
  evidence, and query read-only adapter state. It does not gain arbitrary execution
  of a parent tool or permission to submit an environment action.

## Verification

Use a small offline real-Pi fixture set: version-conflict recovery and paged reads;
sliding-window archive recovery with intact parallel tool IDs and checkpoint;
validation provenance and unresolved tests; isolated child read permissions and
compact returns; cache cleanup and rejection of cross-task/resume misuse. No large
benchmark run or claim of ARC score improvement in this implementation turn.

Acceptance: 30 focused offline checks passed (including real Pi parent/child loops,
the ARC frame adapter, 18k pressure, existing resource-entry and transaction-link
regressions). Three final failure-path checks also passed after adding paged failure
records. The pressure fixture's recorded maximum post-compaction message projection
was 10,550 JSON characters; this excludes provider schemas/system-prompt overhead
and is not an ARC score or a guarantee against output-token truncation. No paid ARC
benchmark was run for this change.
