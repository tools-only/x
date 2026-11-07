# a5 free diagnosis

Run: `runs/ppt-reflective-core-az-v4-a5` (AZ `deepseek-v4-flash`, thinking high), 14 provider requests, reported 244,545 tokens and $9.81454 estimated spend; stopped at the authorized $12 boundary. Evidence: `session.jsonl`, `harness/model-usage.jsonl`, `harness/provider-requests.jsonl`, `budget-stop.json`, `summary.json`, and `harness/lifecycle.jsonl`.

## Why the tool and reviewer were unused

Neither was attempted. The assistant tool-call stream contains no `run_program` and no `consult` event after the v2 definitions; `component_runs.jsonl` has no successful or failed call receipt for either. The run's provider tool schema exposed both tools. There is no observed error, wrong name/argument, validation failure, timeout, consult cost, or runtime rejection to attribute. The v2 tool source has a default draft/material path and supports explicit `{path, material}` args; the reviewer role has the expected read/grep tools and gives a short output contract. Those definitions do not explain the omission. This is an adoption/sequence failure: after defining the reviewer, the agent spent a request reading its skill and listing/searching files, then spent the next request generating a very large 15-slide deck. It never returned to either use step.

## Why the guard was reached quickly

This was not caused by a single 17k-token system prompt. Request-level records do not expose a direct tokenized system-prompt field; the first provider call reports 1,984 uncached input tokens. Across requests, cached context grew from roughly 2k to 27k tokens, alongside new input/output and hidden reasoning. The serialized tool schema was exposed in the session initialization. `reflect_component(op="inspect")` returned `[]` at startup, so its initial response was tiny and did not contribute materially. Later redefine responses returned full component source (about 3.2k output tokens across the two calls in the combined request), a cost worth reducing, but not the main spike.

The largest avoidable spike was the last deck-writing response: 11,715 output tokens and $1.6259 in one request, returning a 15-slide HTML deck. This confirms the run did not honor the compact-deck instruction. Request count was 14, but reported token total includes cached/repeated context; the model consumed $9.81454 mainly across increasingly large histories and a large final output. Provider request rows contain serialized context, not per-request token counts; the session usage is the reliable available token breakdown. Prompt size in characters was not recorded separately, so an exact system-prompt size cannot be claimed.

## Defects and limits

The live `reflect_component(inspect)` implementation returned every component's complete source, including memory, despite a request to inspect state; there was no on-demand detail surface except the separate `read_component` call. The redefine receipt also echoed the full source and only said `effective: next_pi_request`, leaving the next action to infer from generic tool documentation. These are concrete interface costs and are addressed by concise inspect summaries and a `next_call` instruction in redefine receipts. No defect blocked a5's missing calls; even after these changes, autonomous adoption remains an empirical question for the single bounded a6 run.
