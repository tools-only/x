# Prepared real-task validation (not run)

Run from the checkout root after review. It uses the existing AZ configuration and the `az/deepseek-v4-flash` model. The real task agent is asked to inspect its live components, redefine a tool through `reflect_component`, then execute that tool. The evidence checker requires the redefine event and a successful call at the resulting component version; editing only deck/output files fails.

```powershell
$env:PYTHONPATH = 'src'
python -m autoresearch_pi.ppt_demo --root runs/ppt-reflective-core-az-v4 --source demo/ppt-cases/jpmorgan-chase-3q21/assets
python -m autoresearch_pi.ppt_demo --root runs/ppt-reflective-core-az-v4 --run --resume --model az/deepseek-v4-flash --thinking high --continue-prompt 'Before making the presentation, use reflect_component(op="inspect") to inspect your live harness. Choose or create a small useful tool, redefine it through reflect_component(op="redefine") with kind="tool" and a new source, then call/run that redefined version successfully. Continue and deliver the requested presentation. The reflective evidence checker must pass; writing only deck or output files is not self-modification.'
python tools/check_reflective_core_evidence.py runs/ppt-reflective-core-az-v4
```
