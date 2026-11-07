# Real-task validation

The a5 diagnosis and the a6 protocol are recorded in `a5-diagnosis.md` and `real-task-result.md`. The fresh-run entry point is `--kickoff-prompt`; AZ configuration is read from the parent project environment. Do not print keys.

```powershell
$env:PYTHONPATH='src'
python -m autoresearch_pi.ppt_demo --root runs/ppt-reflective-core-az-v4-a6 --source demo/ppt-cases/jpmorgan-chase-3q21/assets
python -m autoresearch_pi.ppt_demo --root runs/ppt-reflective-core-az-v4-a6 --run --model az/deepseek-v4-flash --thinking high --kickoff-prompt (Get-Content -Raw .scratch/reflective-core/a6-kickoff.txt)
python tools/check_reflective_core_evidence.py runs/ppt-reflective-core-az-v4-a6
```
