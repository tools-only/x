# Single PPT production demo on agent-native-program-loop

## Opportunity and claim

User wants one complete real PPT deliverable and the harness evolved during its production. Base is the current remote `codex/agent-native-program-loop`, reused in clean adapt-config worktree. Its existing Binder/NativeRuntime provide named-program creation, versioning and fresh WASI execution; ARC actions/phase evidence cannot represent editable office artifacts directly.

Narrow falsifiable claim: a real parent can develop/revise a method while interpreting/building the deck, use that version on later work, and deliver editable PowerPoint objects plus active harness sources. Saved literal slide data alone is not a reusable method. No statistical improvement, general autonomy, five-category closure or causal cost benefit is claimed.

## Design and burden

The PPT extension reuses the actual branch Workspace, Binder, validatePythonComponent and NativeRuntime saveProgram/runProgram. It adds a small scene-local TASK/ADAPT owner instead of importing ARC trajectory counters. Parent selects meaningful work batches via checkpoint; no per-slide turn or forced review schedule. TASK itself can modify methods. ADAPT is an optional independent read-only task-state window, including before production; it can revise methods and return unchanged. No critic/refiner worker or developer-authored narrative recipe.

Programs read source text and create/transform a generic editable object scene. The host maps text/shapes/charts/tables/images to python-pptx, opens the saved PPTX with actual Microsoft PowerPoint 16 COM, exports PDF/PNG, and reports geometry and text-height facts. No host library imports or arbitrary host filesystem access are added to WASI. Binary exports stay outside the text Workspace snapshot. Current deck/feedback/memory plus actual conversation enter TASK/ADAPT; method catalog and selected prompt/skill versions enter at batch boundary. Saving and binding reuse the existing runtime, not reuse tickets. Agent chooses suitability and retention; runtime does mechanical compilation/export/packaging.

Existing files remain unmodified; additions exceed 300 lines because native artifact export, actual rendering, provider runner, integration and evidence are all required. This is one vertical slice, not a generalized platform. No new project gates or AGENTS rules. Current artifact changes do not expire saved methods.

## Task and protocol

PresentBench `economics/JPMorgan_Chase/Earning3`: JPMorgan Chase 3Q21 press release, eight source pages, original instructions require 15–20 slides. Use original materials/instructions; target 15 pages. Judge JSON is in evaluation/ outside the task workspace. No task-private evaluator knowledge enters the parent. Agent sees its dual task/artifact+harness goal, not a compulsory creation/revision sequence. This explicit goal means it is a guided demo, not ordinary autonomous opportunity-recognition evidence.

User authorization: AZ Qwen qwen3.8-27b, low, <=CNY100 and <=2h. Generic OPENAI credentials resolve AZ; ARC-scoped variables currently resolve OpenRouter and are deliberately not used. Dedicated model input text+image, context128k, output12k; no automatic retry, no stronger in-run model. Conservative guard USD12, reserve full128k input+12k output at USD20/80 per million (USD3.52) before each request, max50 requests. The estimate is deliberately above AZ public pricing metadata (model_ratio1.2/completion_ratio4); not verified account billing. Missing/failed usage remains unknown, no paid retry after infrastructure failure. Deadline covers the real run; input source and evaluation are isolated.

## Evaluation and lifecycle

One run only. Preserve initial/final render revisions; inspect final actual files and PNGs; separately assess instructions/numeric fidelity and visual usability. Compare initial/final artifacts descriptively, not as causal proof. Keep program saves/versions/calls/outputs, phase/batch handoffs, actual provider payload/usage and render receipts. Program outputs must affect later work, not merely return ok. The runtime packages active components, dependencies and reload configuration; reload in a fresh workspace is a local diagnostic, not a second paid generation.

Negative checks: ADAPT cannot write deck; invalid program retains old version (inherited runtime); stale export cannot deliver; wrong slide count; host paths remain confined; late/failed render not accepted; budget cannot fail open through extension errors. Real PowerPoint test validates export and native charts/tables, not model behavior. Single independent review round before run, at most two total under project rules.

## Evidence and decision

Functional: pending. Full chain: pending real Pi/provider. Adoption: pending and limited to explicit dual-goal guidance. Net benefit: unverified/not claimed. Renderer: Microsoft PowerPoint 16 COM, Windows/Python3.12/python-pptx, real AZ provider for generation. Artifacts and final status will be appended here. Related backlog B/C/D remains open; scene batches reduce orchestration burden but do not establish general cognitive continuity or cost gains.

## Implementation and real-run evidence

- Added the scene host, renderer, runner and prompt; reused branch NativeRuntime/Binder without modifying their implementation. The scene-local loop owns batch/phase state, while Pi owns model/tool turns. No automatic critic, mandatory per-page adjustment or predetermined narrative method.
- Native integration test passed through actual WASI save/run, ADAPT write refusal, same-name revision, later TASK use, actual PowerPoint export of 15 diagnostic slides with native chart/table, source/render mismatch refusal, delivery and reload in a fresh workspace. Artifacts: `C:/Users/qi/AppData/Local/Temp/ppt-native-wHDSyq`. This was a synthetic diagnostic, not the requested earnings-deck deliverable.
- One independent review found fresh-import scanning and missing-usage accounting defects; both fixed, plus the incomplete test stub. Added a targeted check showing unknown usage retains USD3.52 per request through a reload (passed). All three findings were handled within one review round.
- Actual AZ run: `runs/ppt-jpm-3q21-20261103/`. First real Qwen response read instructions, environment and source material through three real Pi tools (reported 2,596 input + 95 output; reasoning13 is included in output accounting). Second provider call failed with HTTP400/type=Arrearage. Its usage is unknown and full USD3.52 reserve remains charged; conservative total USD3.57952. This is not verified billed spend.
- No actual task slides/programs were produced before that provider refusal. Full-chain generation, guided adoption and artifact/harness delivery remain unverified; never substitute the synthetic export test. No claim of higher quality or net benefit.
- User was asked to restore AZ quota or choose an alternative route; no automatic paid retry or provider substitution. Added `--run --resume` to preserve the same session, component store, original deadline and cumulative request/unknown-usage accounting after user resolves the provider issue. These runner/accounting edits happened after the failed run; any continuation records source hashes.
- Resume command from checkout: `$env:PYTHONPATH='src'; python -m autoresearch_pi.ppt_demo --root runs/ppt-jpm-3q21-20261103 --run --resume`. Do not run before the provider issue is resolved. Root protocol preserves the original run start; expired authorization time does not silently reset.
