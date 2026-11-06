# Same-session Qwen PPT recovery, 2026-11-05

Failure: run ppt-qwen-context-20261105-225917 stopped at 23:27:29 Asia/Shanghai.
The last model request timed out after 300 seconds. Pi SDK derives the request
timeout from its default 300000 ms HTTP idle timeout. Increasing PiKernel's RPC
timeout alone does not change this provider request limit.

The preceding edit_program also corrupted Python source: JavaScript string
replacement expands $' to the suffix of the original string. The requested
regular-expression end anchor followed by its closing quote triggered this.

Narrow fixes: use a replacement callback to preserve literal source; for the
already unbounded Qwen mode, configure provider and HTTP idle timeouts to 900000
ms. Provider retries remain disabled, including SDK retries (maxRetries=0).
Bounded request timeout defaults remain unchanged. No new workflow or workers.

Verification: pending targeted literal-edit regression and existing PPT checks.
Negative case is a Python regex containing $' plus other replacement markers;
verify exact saved text and real WASI execution. Longer timeout permits slower
requests but does not fix upstream outages or demonstrate quality improvement.

Recovery authorized by the user's request to fix and continue; retain original
Qwen high model, run root, history, artifacts and existing unbounded budget.
Do not directly rewrite the task agent's checking method: resume with the
observed host defect and let Qwen decide its repair and further task actions.
Autonomous adoption and net benefit of this repair remain unverified.

Verification completed: targeted literal-dollar regression passed 1/1; complete tests/ppt_demo.test.ts passed 7/7 in 96.64s, including actual PowerPoint export. Python AST parse and git diff --check passed. Same-session Qwen high resumed at 23:35:42 Asia/Shanghai; summary running, Python PID 312212 and Node PID 308604 observed. Persisted Pi settings show provider timeoutMs=900000, httpIdleTimeoutMs=900000 and maxRetries=0. Request-start receipt observed; model recovery of the rejected method and final delivery remain pending. This recovery includes explicit operational guidance and is not an unguided adoption experiment.
