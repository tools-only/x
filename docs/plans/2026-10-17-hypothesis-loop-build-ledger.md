# Build ledger: Part H of the hypothesis loop and self-harness plan (2026-10-17/18)

Kept from the build's git-ignored workspace (`.superpowers/sdd/…/progress.md`) when the build ended, as the record of
the rulings made where the [plan](2026-10-17-hypothesis-loop-and-self-harness.md) was silent or unworkable, the test
runs behind each task, and the final review's findings and their disposition. Paths under `C:/Users/qi/tmp/r04/h/`
are the test outputs.

Executor: inline (superpowers:executing-plans), the session that owns r04. User, 2026-10-17: "yes" to building the
hypothesis part after the two sessions were folded into r04; 2026-10-18: "simplify the test, go on".
Branch `claude/r04-20261017` (the one branch the user tracks). Start: `d473cb7f`.

The plan is both design and spec. Its tasks are derived from §3 (Part H rows) and §4 (build order 2 and 4); rulings
made without a separate spec are provisional.

## Rulings on the process

- No superpowers task scripts (bash; Bash here routes to a broken WSL, and the plan has no task briefs): tasks listed
  below, tests run through `C:/Users/qi/tmp/r04/h/t.cmd` (one `node --test` per file), completion lines kept by hand.
- One commit per task, not pushed; Tasks 2+3 and 5+6 share a commit because they share a test file.
- Part S is not in this build (the user said yes to the hypothesis part).

## Tasks and test runs

1. **H1a bbox** — the ledger fixture gains `still` actions to test bbox None. `d473cb7..5ca5268`: RED 2 failing for
   the expected reasons → refine_ledger, claims, promotion, memory, native_memory 47/47.
2. **H1b schema** — item fields `Type.Any` with descriptions inside a `Type.Object` (typed fields would let Pi refuse a
   whole call the native planner accepts in part; a non-object item is now a schema error). Measured +805 characters
   per request, not ≈450. RED (no item properties) → native_memory 4/4; memory, ledger, skill surface, native runtime
   pass; installed-Pi action surface 2/2 alone (1/2 in a batch: its known 20 s Pi start timeout).
3. **H1c prose checks** — "Python" = `def check(` or `check = lambda`; a given next_test comes first. RED (prose stored
   as check) → native_memory 5/5, memory 23/23.
4. **H1d sources** — `memory(op="list")` lists every source (no key filter today). RED (no source; the wiring test
   with the wiring reverted) → ledger 10/10, memory 24/24, native_memory 6/6.
5. **H2a contest** — all contested hypotheses first in the view (not only check-contested); once per key, check version
   and claim; `ARC_CHECK_CONTEST_MIN` parsed as a whole number. RED (no `checkContest`; no receipt line) → claims 4/4,
   memory 24/24, ledger 12/12; promotion, native context, receipt lines, self-harness, native memory pass; receipts 0/3
   (known).
6. **H2b event** — asks for a narrower hypothesis or the strategy's next experiment (refinements cannot rewrite a
   hypothesis); not raised over the refiner budget. RED (no export; no refinement) → claims 5/5, promotion 9/9,
   ledger 13/13.
7. **H2c missing keys** — also a refinement event (only refinements write the rules prompt). RED (`missing` undefined;
   "no check behind") → promotion 9/9, ledger 14/14, claims 5/5.
8. **H3a rivals** — the lines sit after the CURRENT KNOWLEDGE block, outside its budget, at most 4 pairs. RED (no
   export; no line) → claims 6/6, ledger 15/15, promotion 9/9, memory 24/24, native_memory 6/6.
9. **Acceptance** — the `hypotheses` smoke asserts the first contest (a fallback move later contests hyp.left too) and
   accepts the refinement's count. H0 simplified at the user's word: no recorded check reads bbox (29 sources), and the
   9 strict re-runs that finished matched r04's table. Full TS suite 188/193 (the 5 known failures by name), pytest
   29/29, smokes as at `7d2533bc`, refusal and fork smokes pass, contest simulation 12/25 (11 under the strict rule).

## Final review (opus, `d473cb7..27e8134`): 0 critical, 4 important, 8 minor

- **Fixed** (`8beb97c3`): I1 a status the agent restates was contested again at once; I2 a stale contested label after
  the check was fixed; I3 contest rows counted as the agent's writes; I4 refused or stale replies settled the event.
  - The TS RED of the fix pass was a load failure (`memoryEditNow` not yet exported), so I1, I2 and I4's failures on
    the old code were not watched one by one; the Python test's RED was.
  - I4 settles every promotion event by the edit as applied, not only the contest event (the ordering predates Part H).
  - The recheck tool's authorship change has no test (a development tool).
  - After the fix: ledger 19/19, claims, promotion, memory, native memory, self-harness pass, activation 5/6 (known),
    pytest 30/30, the hypotheses, promotion and activation smokes as before.
- **Deferred minors:**
  - M1 check-made contests read "refuted at #N since its last revision" in `data/memory.md`, the list and the refiner's
    AGENT MEMORY;
  - M2 the missing-key event is settled by any HYPOTHESIS edit or any rules rewrite;
  - M3 rival pairs in insertion order (with 5+ rivals only the first key's pairs show);
  - M4 prose detection misses `check = helper`; prose moved into next_test escapes the 300-character clip; a prior
    next_test is replaced when none is given;
  - M5 a non-object hypothesis item refuses the whole call;
  - M6 the refiner's input omits the contested hypothesis's check source;
  - M7 test gaps: restart of the contest-once set, over-budget suppression, a strategy answer;
  - M8 (wording fixed in the plan) contests run after every committed memory call.
- **Set aside by the reviewer, ruled to stand:** events raised again after a Pi restart (pre-existing); memory edits
  discarded as stale (pre-existing; settling fixed by I4); forks of pre-r04 runs would contest on non-strict verdicts
  (E-H uses fresh runs); bbox None on reshaped grids (as specified); a check mutating the shared bbox dict (as for every
  move field); the +805 characters (recorded); the switch not covering ordering and rival lines (one factor); the legacy
  foundation without the note (not evaluated); replay on a malformed check row (no writer makes one); the hypothesis cap
  while contested ones remain (for E-H to measure); adoption and benefit (unverified by design).
