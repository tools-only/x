# Child output-length recovery and prompt correction

## Scope and evidence

The real ARC run `arc-priority123-final-20260917-003633` recorded 285
thinking-only `length` responses in Auto-Research 6. This is not evidence of
an oversized final report. The client requested 16384 output tokens through
Pi's default model registration, while its model configuration incorrectly
declared `reasoning: false`. The gateway's actual maximum remains unverified.

## Implemented changes

- ARC model registration declares reasoning support. This does not establish
  which reasoning controls a gateway accepts; inspect outgoing requests in a
  real-provider run before claiming provider behavior is corrected.
- `ARC_MODEL_MAX_OUTPUT_TOKENS`, when supplied, declares the provider-supported
  output allowance in Pi's model configuration. No guessed ceiling is added.
  When omitted, Pi's own default still applies: omission is NOT unlimited output.
- Child system context contains its validation/reporting contract, not the
  parent's full resource-management method. Parent and child prompts distinguish
  answerable observations from hypotheses requiring a new environment experiment.
- Child resource/evidence indexes contain exact refs, versions, sizes and
  provenance rather than copying unbounded summary bodies. Granted full versions
  remain available through the existing resource reader.
- Existing research checkpoints are retained across child process launches;
  only runtime pause state is reset on explicit/automatic resume.
- The child reloads semantic state and mechanical evidence progress. Completed
  evidence reads persist progress automatically. Explicit checkpoint saves merge
  omitted fields with prior state; explicit empty arrays still clear those fields.
- A length boundary retains the last saved cursor, findings, unanswered questions,
  next step, evidence audit, and partial text. Private thinking is not converted
  into ordinary instructions or represented as a successfully recovered finding.

## Existing checkpoint additions

`evidence_progress` is runtime-only state in the existing checkpoint, not a new
harness component:

- `pages`: `[exact_ref, {total, ranges, reads}]` pairs. `total` is resource size
  in characters; `ranges` are merged half-open character intervals already read;
  `reads` counts page reads. This restores the existing coverage calculation.
- `read_counts`: `[tool_call_signature, count]` pairs. Signatures identify exact
  tool names and arguments for repeated-read accounting. They are not evidence
  of truth and impose no read quota.

These mechanics are excluded from the model-facing continuation checkpoint and
checkpoint tool response. They remain available to the child runtime on disk.
The model authors semantic findings; runtime code never infers them from counters.

## Verification and remaining boundaries

The real `arc-harness-smoke` memory scenario now reads evidence, saves a finding,
emits a synthetic thinking-only length stop, resumes a real child process, reads
again, saves without overwriting findings, then approves/submits/routes/applies
memory and uses it on a later real parent turn. The suite also covers skills,
tools (semantic result), system prompt, subagents and ordinary delegate length.
Only its model provider is deterministic; this is not a real-provider benchmark.

Do not claim that long reasoning itself is solved from this acceptance. A real
provider comparison must still establish effective reasoning parameters, output
capacity, length frequency, research progress, and successful report submission.
Without a saved semantic finding, a thinking-only interruption cannot magically
recover unsaved conclusions. No finding-size, read-count, continuation-count or
research-duration quota is introduced. Deferred backlog B/C/D remains relevant.

## Recorded acceptance

`runs/arc-length-recovery-20260917-r2/arc-self-harness-smoke-summary.json`:
five scenarios passed, 68 checks passed, runner exit code 0. The resumed memory
child advanced evidence reads from 1 to 2 while preserving its cursor and finding.
The preceding r1 also passed, before adding the resumed-read advancement check.
Python syntax compilation and `git diff --check` passed. No pytest suite was
used as closure evidence. No real-provider comparison was run in this change.
