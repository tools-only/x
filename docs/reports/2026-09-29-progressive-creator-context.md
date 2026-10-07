# Progressive Creator context exposure — 2026-09-29

## Change

The largest remaining parent context included a `skill-creator` method read with
37,585 characters of method content. The exact method body and hash still remain
in the canonical tool result. Later provider contexts now expose the first 8,192
characters, the complete method length, heading offsets, and an exact
`read_method` continuation call. `method_offset` and `method_limit` let the parent
page through the same hash-bound method or explicitly recover its full body.
The existing applied-change history compaction still follows successful authoring.

When a tool result's `details` is an exact subset of its JSON `content`, the
provider projection now names the duplicated fields instead of serializing them
again. Canonical tool results, task artifacts, authoring validation, assembly,
research routing, and ARC action behavior are unchanged.

## Paired evidence

Baseline: `runs/periodic-review-verified-20260929/`. Final:
`runs/progressive-creator-final-20260929/`. Both ran the same 16 deterministic
provider scenarios through the real ARC bridge, Pi parent loop, child process,
router, native Harness mutation, action boundary, and later parent turns, with
the mocked game environment.

| Model-context measurement | Before | After |
| --- | ---: | ---: |
| Largest single parent request, JSON characters | 122,461 | 91,305 |
| `cross-context-method` peak tool results | 61,260 | 29,829 |
| Sum over matched repeated parent requests, JSON characters | 12,184,266 | 11,875,665 |

The largest request fell by 31,156 characters (25.4%). Every scenario and all
393 acceptance checks passed with the same check outcomes. All 16
`bridge-events.jsonl` files are byte-identical to the baseline. The related
integration and context suites passed 101/101 tests on the final run. An earlier
run identified an obsolete schema hash expectation, which was updated for the
two new optional pagination parameters before the final run.

The size measurements use `context_hook_fallback` JSON serialization, not exact
provider payload tokens or billed usage. The scripted provider demonstrates
wiring and lifecycle reachability, not autonomous model use of the page index or
ARC game quality. A real-provider run is needed to assess whether the shorter
Creator exposure preserves authoring quality. Deferred item D in
`docs/deferred-research-todos.md` remains open: exact recovery does not itself
establish semantic continuity across compaction.
