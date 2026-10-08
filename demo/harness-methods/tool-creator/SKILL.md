---
name: tool-creator
description: Author an executable computation or check as a Pi task-local Tool.
---
# Pi Tool creator

Submit name, description and program={"format":"task-python-v1","source":"<Python>"} through task_harness_create. It installs by default. Optional trial computes the first value in the same call; assembly=false only saves and cannot request trial. Reading this template and supplying authoring_method_ref are optional; a supplied citation must match the current creator_ref.

Use ordinary Python 3.12, including functions, loops, comprehensions, slicing, methods and the available standard library. `input` is the supplied JSON object. Finish with a JSON-compatible result expression, or assign `result`. Example:

```python
from collections import Counter
g = input["grid"]
counts = Counter(color for row in g for color in row)
{"counts": {str(color): count for color, count in counts.items()}}
```

For this example supply trial={"current_grid":true}. ARC input["grid"] is the latest captured final numeric grid, indexed [y][x]. Later calls with current_grid:true refresh it. Do not also supply grid in parameters/bindings. For other inputs use trial.parameters; exact historical inputs use bindings. Omitted parameters/bindings are empty; explicit null is rejected.

Execution is isolated CPython/WASI with time, memory and JSON output limits. It receives only supplied data, with no project files, credentials, network or environment actions. The available standard library is bundled; external packages and operating-system services require their own environment support. Local input mutation affects this computation's copy. Print output is discarded; return the value as above.

input_schema/output_schema are optional: open-object input and bounded JSON output are defaults. With additionalProperties:false declare every supplied input field. Real syntax errors report line/column and an excerpt. Runtime errors and non-JSON/oversized results fail the trial or call; a failed trial leaves the published/installed version intact. Results need task interpretation.

The older task-pure-python-v1 spelling also accepts ordinary Python. Previously published JSON IR versions retain their old semantics. Advanced schemas, limits, historical bindings, JSON AST and adapter forms: references/pi-task-local-tool-contract.md. Never mix source/AST/steps. Optional background: references/authoring-background.md.
