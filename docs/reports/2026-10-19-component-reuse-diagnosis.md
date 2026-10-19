# Why agent-made components go unused — trajectory diagnosis (2026-10-19)

Question (user, 2026-10-19): does the P1-P4 version solve "the agent does not use the harness components or functions it
created"? It does not; this note says why, from the trajectories. The diagnosis was offline: no runs and no code changes.
The user then chose options C and B, recorded at the end.

Runs: `runs/arc-p13-20261019/su15-p13-g56-1` (gpt-5.6-sol, reasoning medium, 3 levels) and `su15-p13-q38-1`
(qwen3.8-27b, thinking off, 1 level), both r04 + P1-P3 via the yibu gateway; compared with the six r04 runs in
`runs/arc-models-20261019` (su15-g56-1/2, su15-q38-1/2/3, su15-g61-1 = historical best, 4 levels). Earlier diagnoses:
push vs pull and snapshot tools (docs/plans/2026-10-18-self-evolve-loop.md, iteration 5); recall as the broken transition
(ls20-r03b, 2026-10-16).

## Findings

1. **gpt saves snapshots, never functions.** su15-p13-g56-1 ran python in 11 of 196 decisions and saved 9 cells with
   `save=`. All 9 hard-code move numbers and regions (`level2diff` prints the diffs of #28-35, `l4diff` those of
   #126-131); none reads `args`; two act (`first_probe` replays ACTION6(31,5), `mergeprobe` ACTION6(21,56)). Calling any of
   them would replay the past, so not calling them was correct. The one recurring computation, consecutive-grid diffs over
   a move range, was typed at #35, #48 and #131 and saved under three new names. Across the four gpt runs checked, 13 of
   13 agent-saved tools are argument-less snapshots and none was called; they sat in every request's tool list as
   `saved python <name>` with an untyped `args` object (213 requests in g56-1).
2. **For gpt this costs almost nothing.** The three retypes total about 500 characters. gpt solved levels 2 and 3 (#78,
   #125) without any python between #54 and #131, working from receipts. The historical best (g61-1, 4 levels) also
   saved two snapshots and called neither.
3. **The runtime's "already computes this" hint has never fired** (0 `cover_hint` rows in all 8 runs).
   `levelRuns` (demo/arc_thin_native_runtime.ts:145) keeps only python runs made with the current kit (saved tools and
   versions), and every save changes the kit: an agent that saves each cell resets its own count. Replayed without that
   filter, the rule fires at g56-1 #48 (recentdiff retyping level2diff) and at su15-q38-3 #12 and #16 (tools/diff.py).
   It is also per level (g56-1 #131 was not eligible), and its advice, `call level2diff(args={...})`, would be wrong for a
   tool that ignores args.
4. **Much of qwen's python is reasoning, not computation.** With thinking off, qwen writes its deliberation as python:
   in su15-p13-q38-1, 35 of 128 calls are comment-only (no executable line, empty result) and 17 print only string
   literals; 76 compute. Base su15-q38-1: 119 of 173 comment-only; su15-q38-2: 78 of 149 literal prints. Each such call
   adds a request: the requests that followed them carried 174k uncached input tokens in p13-q38-1 (3.6% of its budget
   tokens) and 729k in base q38-1 (12.7%). The repeated-work detector also counts these cells as one computation (they
   share the empty-code shape): one of qwen's three refinement triggers was "python computation `` redone 5 times".
5. **qwen wrote the function and destroyed it three actions later.** At #35 it defined `diff(a, b)` for its main recurring
   computation (which cells changed, old -> new colour). At #38 a cell assigned `diff = [...]`, replacing the function
   with a list; after that 30 more cells (#38-#258) computed a fresh `diff` with a hand-typed loop. The PYTHON SESSION line it read every
   decision listed `diff list[18x4]`, the data. `sq_center()` (defined in cell 19) stayed listed all run and was never
   called. No saves. This is the r03b pattern (find_block retyped, helpers clobbered by variables) in a new run.
6. **The service's substitute view was too coarse, then broken, and nothing reported the breakage.** After repeated-work
   triggers the refiner wrote the view `tools/elements.py`: v1 (#89) and v2 (#104) printed one bounding box per colour over
   all its cells (colour 10: `(1, 49, 1, 57, 12)`, spanning every dot), so qwen still scanned for individual squares and
   dots; per-move changes were in no channel (receipts give only the count and the box). v3 (#182) added a last-move diff
   and failed on all 86 remaining states: `env.get('state', {})` returns the game-status string, because `env.get` reads
   the state dict (demo/arc_thin_components.ts:200). The refiner's repair at #183 said it removed the diff block but
   returned the identical file; the binder answers an unchanged write with the ordinary receipt `elements v3: saved ·
   loaded` (demo/arc_thin_binder.ts:91), and the broken-view trigger is keyed by path@version
   (demo/arc_thin_extension.ts:1638), so it never came back. 57 of qwen's requests carried `elements v3 state #n:
   AttributeError...`; qwen never touched the file and typed 6 more diffs. The refiner's stated expectations for all three
   view edits had `check` returning None (a check tests game moves, so "the agent stops scanning" and "the view renders"
   cannot be judged); none was ever judged.

## Where the chain breaks

| | opportunity | recognition | investment / candidate | semantic use | feedback |
|---|---|---|---|---|---|
| gpt | range diff, 3x | yes (saved each time) | snapshot, no args | none (correct for a snapshot) | hint blinded by the saves |
| qwen (agent) | per-move diff, 30x | partly (wrote `diff`) | function, clobbered at #38 | none | session line showed the list |
| qwen (refiner) | colour scans, diffs | via repeated-work trigger (one spurious) | per-colour boxes, then a crashing diff | coarse; then error text | identical repair reported as saved; check untestable |

## Net benefit if repaired (estimate, unverified)

gpt: negligible in tokens. qwen: a working per-move change view could remove up to about 30 python requests, roughly 9% of
the run's budget tokens at its average uncached input per request; an upper bound. Nothing here shows an effect on
levels: the 4-level run reused nothing.

## Options

The user chose C, then B ("do C then B, no need test now"); A and D are not implemented.

- A. Repetition hint: count across saves and levels; when the covering tool reads no `args`, say it prints fixed moves
  and would need its range as arguments, instead of "call x(args={...})".
- B. Name collisions: when a cell rebinds a name that held a function the agent defined, say so once in that cell's
  result.
- C. Service repairs: an unchanged rewrite reported as unchanged; a broken view raised again after more failed states, or
  its last working version restored; the refiner given the env interface (`env.get` reads the state dict,
  `state['state']` is the game status).
- D. Measurement only: count python calls by kind (computing / comment-only / literal prints) and leave comment-only
  cells out of repetition families.

## Changes made: C, then B (2026-10-19)

Claim: when a component breaks or disappears, whoever can fix it is told in a form they can act on. This removes three
burdens seen above: the agent reading a crashing refinement view's error at every decision (57 requests in
su15-p13-q38-1), the refiner taking a no-op repair as applied, and the agent losing its own function to a name
collision without noticing.

C (services):
1. Unchanged content is not a save. `Binder.save` answers content equal to the current version with `vN: unchanged, the
   same content as before · loaded` instead of `saved · loaded · active from your next request`. A refinement's FILE reply
   equal to the current file (trailing whitespace aside) is returned once: `NOT APPLIED: it is the same as the current
   <path> vN, so nothing would change`. If the second reply is the same again, it is recorded as `unchanged`, not as an
   edit. The agent is not told of it, and the event can be raised again (settlePromotion).
2. Broken refinement views go back. A view version a refinement wrote (or the runtime restored for one) that raised on
   `ARC_REFINE_VIEW_RESTORE` (default 6; 0: off) states in a row is replaced, at the next decision start, by its newest
   version that showed something. This is a new version, recorded as a `view_restored` row in refiner.jsonl, and the
   agent gets a notice. When no version showed anything, the view moves to `_off/` (`view_retired`). Views the agent
   wrote are left alone. Which versions showed something is read back from observer_runs.jsonl after a restart.
3. The refiner's charter states the env interface: `env.grid`, `env.prev_grid`, `env.history.grid(n)`, `env.state` (a
   dict whose 'state' is the status string), and `env['k']` and `env.get('k')` read that dict.

B (agent): when a python call binds a name that held a function the agent defined to a value, that call's result says
so, once per name: `(diff was your function diff(a,b); this call bound diff to list[18x4], so the function is no longer
in the session)`. Before, the only sign was `+diff, -diff()` among the session changes.

Cost: no new tool, field or model call on the agent's path. Each no-op FILE reply costs at most one extra refiner call.
Each broken refinement-view version gets at most one restore or retire. Each function name gets at most one line.

Evidence:
- Functional: unverified. The user asked for no tests now. The only check was a load check: the five edited modules
  import under `--experimental-transform-types`.
- Tests likely to notice: python-session receipt assertions, and refiner tests whose scripted FILE reply repeats the
  current file (it now goes back once).
- Full-chain reachability, autonomous adoption and net benefit: unverified.

Next falsifiable check (next authorized run): a refinement view that raises is back to a showing version within 6
states; no `edit` row carries an unchanged receipt; after a B notice, the agent defines the function again or renames
its data, against retyping the computation by hand as at #38-#258.

Scripts and outputs (outside the repository): `C:\Users\qi\tmp\r04\cov\` — reuse-diag.mjs (hint replay, families,
coverage), pyclass.mjs (python call kinds, view windows), rounds.mjs (request cost of comment-only rounds), defs.mjs
(session functions), cells.mjs, ws.mjs, refdump.mjs; outputs reuse-*.json, pyclass-*.json, rounds-*.txt, defs-*.json.
