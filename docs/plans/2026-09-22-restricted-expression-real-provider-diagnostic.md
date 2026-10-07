# Restricted-expression real-provider usability diagnostic

Status: design only. Do not invoke a provider until the creator, AST,
explicit-input-binding, assembly, invocation, limits, and provenance contracts
are implemented and pass deterministic conformance tests.

This is a short, domain-agnostic diagnostic for contract learnability and repair
cost. It is not an ARC acceptance run, a benchmark, or evidence about game
quality. The authored program and dynamic Tool receive no ARC bridge,
environment action, child process, live state, filesystem, network, clock,
randomness, or hidden action sequence. The diagnostic runner itself may use the
provider network and local logging needed to conduct and measure the run.

## Question

Can the main agent, given only the approved Tool creator contract, author and
use one exact-version restricted JSON-expression program whose useful work is a
nested data transformation with a condition determined by each input group?

Measure whether the agent can:

1. read the current creator method and its exact authoring reference;
2. author a valid AST and input/output schemas without being handed an AST or
   answer algorithm;
3. select/assemble the exact version and bind an exact input resource;
4. invoke it on normal and contrast inputs and inspect semantic output; and
5. diagnose and repair bounded contract failures, including a malformed input,
   without silently changing the program or computing the answer outside it.

The diagnostic deliberately tests the contract surface, not whether the agent
knows a prewritten solution. The evaluator may hold a reference oracle, but the
provider receives only the task statement, schemas, data, and creator contract.

## Provider-facing task

Give the main agent this task-neutral problem statement, together with the
input schema and three versioned JSON resources:

> Author a pure JSON transformation that processes a collection of groups.
> Each group contains its own numeric `rule.minimum` and nested records. A
> record qualifies when `active` is true and it has at least one nested
> measurement whose numeric `value` is greater than or equal to that group's
> `rule.minimum`. For each group, retain every record in input order but keep
> only its qualifying measurements, also in input order. Emit the group id, the
> transformed records, `qualifying_record_count`, and
> `qualifying_measurement_count`; records/groups with no matches remain present
> with empty arrays and zero counts. An inactive record remains present by its
> identity, but its output `measurements` is always `[]` and it contributes to
> neither count, even if its input measurements meet the numeric threshold.
> Preserve identities and do not mutate input. Rule values and nested
> collection lengths are data, not constants in the program.

This statement requires nested `map`/`filter`-like work, lexical bindings,
dynamic field access, and count-by-`length` without requiring `sum`, `reduce`,
or another unsupported aggregate. It gives no AST, code, hard-coded field
traversal, or answer program. The exact output schema makes a count-only echo
insufficient. The reference oracle is kept outside the provider prompt and
checks identity preservation, threshold membership, order, per-group counts,
inactive-record suppression, and empty-group behavior.

The normal resource should contain at least two groups with different minimums,
multiple records, nested measurement arrays, one inactive record, and one
record with no qualifying measurement. The contrast resource should use the
same schema but change group minimums, reorder records/measurements, and make
one group produce only empty transformed records. The invalid resource should
contain a bounded structural error such as a non-array `measurements` field and
a missing `rule.minimum`, so runtime validation must return a structured error
with a path; it must not produce a partial successful result. Keep all fixtures
domain-neutral (for example `groups`, `records`, `measurements`, and `rule`),
and do not embed ARC rows, palettes, coordinates, or task-specific algorithms.

## Required main-agent sequence

The sequence is intentionally agent-owned; the harness must not pre-author the
AST or silently select a Tool.

1. Main calls the Tool creator's read operation and records the exact creator
   method reference.
2. Main authors one restricted pure-expression Tool containing its own AST,
   input schema, output schema, and requested limits. The creator validates
   shape only; it does not infer missing semantics.
3. Main explicitly selects and assembles the exact immutable Tool version.
4. Main binds the exact normal resource by version and bounded JSON path, then
   invokes the Tool. The prepared input must be recorded before evaluation.
5. Main reads the semantic output and makes a later decision based on it (for
   example, selecting the contrast case or recording which groups survived).
   The Tool must perform the substantive nested transformation; main must not
   compute and merely echo the expected answer.
6. Main invokes the same exact program on the contrast resource and records the
   semantic difference from the normal result.
7. Main invokes the invalid resource and records the structured failure code,
   AST/input path, consumed limits, and absence of a success result.
8. If a creator, assembly, binding, or invocation contract error occurs, allow
   at most two repair attempts and one new immutable Tool version. Preserve the
   failed input and error, and measure whether the repair changes only the
   contract-specified field. Do not auto-repair, broaden permissions, or fall
   back to main-side computation.

The harness should mark authored declaration, selected assembly, invocation,
semantic output use, and invalid-input handling as separate events. A cited
creator or a printed AST is not use; a successful status without semantic
output is not success.

## Bounded budget and measurements

Proposed diagnostic ceiling, subject to coordinator review:

- one main task, at most 8 provider decision turns;
- at most 2 contract repairs and 1 replacement Tool version;
- normal, contrast, and invalid invocation once each after successful assembly;
- no more than 30,000 main output tokens and 180 seconds wall-clock time;
- runtime limits remain the stricter authority for AST nodes, depth, input,
  elements, allocation, steps, output bytes, and cancellation.

Record separately:

- creator-read, authoring, assembly, binding, invocation, and repair turns;
- input/output/reasoning/cache tokens and provider-reported usage cost where
  available, clearly labelled as provider measurement rather than invoice;
- wall-clock latency and runtime consumption for each invocation;
- exact Tool/program/schema/limits versions and all resource/binding hashes;
- normal/contrast semantic oracle results and invalid structured-error result;
- failures, repair count, discarded versions, and whether main duplicated the
  computation outside the Tool.

## Pass, fail, and stop criteria

This diagnostic passes its usability objective only if the provider reaches an
exact selected version, supplies a bound input by reference, obtains semantic
normal and contrast outputs that satisfy the hidden oracle, and receives the
expected bounded error for invalid input. It must also leave provenance and
consumption records sufficient to reproduce the claims.

It fails the diagnostic if the provider cannot learn the creator contract,
repeatedly publishes malformed ASTs, uses an unselected or stale version,
binds the wrong snapshot/path, returns an echo/count-only result, computes the
answer outside the Tool, or treats invalid input as successful output. A
provider failure is evidence about contract usability/repair cost, not evidence
that the restricted AST is semantically wrong without the corresponding
conformance and oracle result.

If the required creator read is missing, reject writes/assembly/invocation and
spend the remaining repair budget on reading the exact creator contract first;
this is a repairable precondition, not an immediate terminal stop. Stop only
when the creator contract is unavailable, a permission boundary is violated,
the budget is exhausted after allowed reads/repairs, or the provider cannot
continue without the authored program requesting filesystem/network/process/
bridge access. The runner may still use provider networking and local logs.
Do not start the real-provider phase from a schema fixture that merely passes
local tests.

## Readiness gate and interpretation

Before any provider call, deterministic tests must cover nested variable-length
transforms, dynamic fields/indices, empty collections, strict types, lazy
conditions, deterministic ordering, output-schema validation, malformed ASTs,
unbound variables, excessive allocation/steps, cancellation, exact-version
assembly, input-binding collisions, missing paths, stale snapshots, and child
grant denial. The implementation must expose structured errors and immutable
provenance for every invocation.

Only after that gate may the short provider diagnostic run. Its result answers
“can the main agent learn and repair this bounded contract at measured cost?”
It does not answer whether the infrastructure improves ARC score, closes the
five-component self-harness acceptance, or generalizes to a different domain.
Those claims require their own real-ARC and paired comparison evidence.
