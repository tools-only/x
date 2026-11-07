# Real-task validation

The fresh-run defect is fixed: `--kickoff-prompt` supplies task instructions on the first run, and the duplicate AZ agent-directory creation was removed. The AZ configuration is loaded from `D:/autoresearch_pi_project/.env`; do not print keys. Real-task attempts and evidence are recorded in [real-task-result.md](real-task-result.md).

```bash
export PYTHONPATH=src
python -m autoresearch_pi.ppt_demo --root runs/ppt-reflective-core-az-v4-aN --source demo/ppt-cases/jpmorgan-chase-3q21/assets
python -m autoresearch_pi.ppt_demo --root runs/ppt-reflective-core-az-v4-aN --run --model az/deepseek-v4-flash --thinking high --kickoff-prompt 'Create and deliver the JPMorgan Chase 3Q21 presentation from the supplied brief and material. Inspect first with reflect_component(op="inspect"). For each kind, create a useful v1 with self_component if needed, then redefine that same live component with reflect_component(op="redefine"). Consume the new version immediately: skill via read_component, tool via run_program on the draft, subagent via consult on the draft, and prompt plus memory at the next task boundary; confirm those versions are injected and use them to revise the deck. Make each change useful: an evidence-first source/caveat rule, slide QA checklist, source/slide-count validator, financial accuracy reviewer, and verified facts from material.txt. Then render, review, fix, and deliver. Use only supplied facts and source lines on numeric slides.'
python tools/check_reflective_core_evidence.py runs/ppt-reflective-core-az-v4-aN
```
