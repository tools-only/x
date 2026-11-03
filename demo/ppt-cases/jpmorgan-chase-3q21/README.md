# PresentBench: JPMorgan Chase Q3 2021 earnings

This is the end-to-end task case used by the PPT production demo. The agent receives the original generation instructions and earnings release, then creates a 15–20 slide editable presentation. The separate benchmark judge prompt is copied to the run's `evaluation/` directory and never placed in the agent's task workspace.

## Reproduce the case

The PresentBench dataset declares `license: other`; this repository therefore records the case identity and pinned source revision but does not redistribute the PDF, benchmark instructions, statistics, or judge prompt. Fetch the original files into a local directory when preparing a run:

```powershell
python demo/ppt-cases/jpmorgan-chase-3q21/prepare_case.py --output D:/ppt-demo/jpmorgan-chase-3q21-source
$env:PYTHONPATH = 'src'
python -m autoresearch_pi.ppt_demo --root runs/ppt-jpm-3q21 --source D:/ppt-demo/jpmorgan-chase-3q21-source
```

The download script pins the PresentBench repository revision and verifies each file against its SHA-256 digest. It also extracts the release text into `material.txt`, which is used by the demo's text tools. The repository's ordinary source URL is not used because it can move; every download uses the pinned commit.

To start the real-provider run, add `--run` to the second command. This demo is configured for the already authorized AZ Qwen route and budget; it refuses a different API base. If the previous run stopped and its provider issue has been resolved, use the documented resume command for that same run instead of creating a fresh paid run.

## Case identity

- Benchmark: PresentBench (238 presentation-generation tasks)
- Case: `economics/JPMorgan_Chase/Earning3`
- Task: explain JPMorgan Chase's Q3 2021 financial results to media and non-specialists, using only the supplied release
- Expected output: 15–20 slides
- Pinned dataset revision: `3c6e01f563165d3a364a459f9777cd7286f42cd8`
- Dataset card: <https://huggingface.co/datasets/PresentBench/PresentBench>
- Benchmark implementation: <https://github.com/PresentBench/PresentBench>

The PDF and task instructions are benchmark inputs, not content authored for this repository. A run must cite the benchmark source through its generated `task-provenance.json`.
