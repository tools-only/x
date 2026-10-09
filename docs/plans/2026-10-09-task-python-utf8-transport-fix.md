# Persistent task Python UTF-8 transport fix

Date: 2026-10-09 (Asia/Shanghai). Status: retained after functional validation.

## Problem and claim

The real `thin-hyp-ls20-C2-critic-20261009` run recorded 53/58 failed automatic
observations. The ft09 ledger and critic runs also recorded UTF-8 encoding
errors involving `\udc92` and `\udc94`. Node writes UTF-8 JSON bytes, but the
persistent Python host reads through a GBK text decoder on this Windows host.
An isolated subprocess reproduced the arrow-to-surrogate corruption.

Claim: reading JSON lines directly from the binary input stream preserves valid
Unicode in both skill source and inputs, independently of the locale, without
changing guest code, runtime identity, or sandbox limits. This removes failed
automatic measurements and the need for agent-level retries caused by transport.

Scope: persistent host transport and regression coverage. The tuple-key error
was in generated `boards v1`; the same run already published `boards v2` with
string keys. Preserve rejection of non-JSON output rather than converting keys.

## Design and cost

Reuse the existing one-shot runner's binary JSON input approach. Python's JSON
decoder reads UTF-8 bytes directly. No new prompts, schemas, workers, model
decisions, or dependencies. Runtime version and WASI capability/limit checks
remain unchanged; the pinned `pi_task_python_runtime.py` is not modified.
Existing experiment snapshots and processes remain unchanged; future launches
using current source receive the fix. Failed requests still return an error and
the host must remain usable for the next valid request.

## Bounded validation protocol

Functional evidence only: no paid provider calls or new game actions. Replay
ASCII, Unicode arrows, Chinese, emoji, and Unicode source keys through the real
persistent WASI host, using both default stdio and deliberately forced GBK text
stdio. Include a tuple-key failure followed by a valid Unicode request, and
verify exact output, runtime identity, and UTF-8 input byte accounting. Run
the existing board and thin-harness Node regressions after the fix.

Reject the change if Unicode does not round-trip, malformed output becomes
accepted, byte accounting differs, or existing relevant checks regress.

## Implementation and validation

- Regression before fix: `python -m pytest tests/test_task_python_server.py -q
  -p no:cacheprovider` failed both default and forced-GBK cases, showing corrupted
  Unicode in executed skill source.
- Fix: `demo/pi_task_python_server.py` now iterates over `sys.stdin.buffer`;
  JSON bytes are decoded directly instead of passing through legacy text stdio.
- Post-fix: `python -m pytest tests/test_task_python_server.py -q
  -p no:cacheprovider` exited 0: 2 passed, default and forced-GBK transports.
- Related regressions: `node --experimental-transform-types --test
  tests/pi_harness_board.test.ts tests/arc_thin_skill_surface.test.ts
  tests/arc_thin_ledger.test.ts` exited 0: 21 passed, 0 failed/skipped.
- Verified exact Unicode values and keys, Unicode byte accounting, unchanged
  runtime identity, tuple-key rejection, and a later successful request in the
  same persistent real WASI host. No paid model calls or new ARC actions.
- No change to frozen experiment sources or historical artifacts.

| Evidence layer | Status | Environment / limits |
| --- | --- | --- |
| Functional correctness | Pass | Windows CPython, real WASI host; no provider |
| Full ARC chain | Unverified | No full ARC closure claim |
| Autonomous adoption | Unverified | No new provider experiment |
| Net benefit | Unverified | No comparative game-quality claim |

## Delivery decision

Retain the narrow transport fix: both real-host regressions and all 21 related
Node checks passed. Future benchmark comparisons should use freshly recorded
snapshots that include it. Existing snapshot results cannot establish its
game-quality benefit. Already-loaded processes do not receive this change.
