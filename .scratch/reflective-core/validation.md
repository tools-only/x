# Real-task validation

The fresh-run defect is fixed: `--kickoff-prompt` supplies task instructions on the first run, and the duplicate AZ agent-directory creation was removed. The AZ configuration is loaded from `D:/autoresearch_pi_project/.env`; do not print keys. Real-task attempts and evidence are recorded in [real-task-result.md](real-task-result.md).

```bash
export PYTHONPATH=src
python -m autoresearch_pi.ppt_demo --root runs/ppt-reflective-core-az-v4-a4 --source demo/ppt-cases/jpmorgan-chase-3q21/assets
python -m autoresearch_pi.ppt_demo --root runs/ppt-reflective-core-az-v4-a4 --run --model az/deepseek-v4-flash --thinking high --kickoff-prompt 'Create and deliver a compact JPMorgan Chase 3Q21 presentation from the supplied brief and material. Follow this short protocol in order: (1) inspect live components once with reflect_component(op="inspect"), then start creating the deck; do not explore the broader workspace. (2) Redefine and immediately consume each useful component for this deck: prompt with clear source and caveat rules (consumed on the next model request in this same session); memory with verified key facts from material.txt (also consumed on the next model request); skill with a compact slide QA checklist (read it and apply it); tool with a slide count/source/number validator (run_program it on the draft); subagent with a financial accuracy reviewer (consult it on the draft). (3) Only after those uses, build a few clear slides, render, review, fix, and deliver. Use only supplied facts and source lines for numeric claims. The protocol is a guide; keep each change small and useful.'
python tools/check_reflective_core_evidence.py runs/ppt-reflective-core-az-v4-a4
```
