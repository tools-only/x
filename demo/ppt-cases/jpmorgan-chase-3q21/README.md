# PresentBench: JPMorgan Chase Q3 2021 earnings

This is the end-to-end task case used by the PPT production demo. Its generation inputs and evaluation files are bundled under `assets/`, so preparing a run does not fetch task data. The agent receives the original generation instructions and earnings-release text, then creates a 15–20 slide editable presentation. The benchmark judge prompt is copied to the run's `evaluation/` directory and never placed in the agent's task workspace.

## Prepare and run from bundled resources

Run the following from the repository root. No case-resource download step is needed:

```powershell
$env:PYTHONPATH = 'src'
python -m autoresearch_pi.ppt_demo --root runs/ppt-jpm-3q21 --source demo/ppt-cases/jpmorgan-chase-3q21/assets
```

The packaged `material.txt` is the text of the JPMorgan Chase 3Q21 earnings release furnished as SEC EDGAR Exhibit 99.1. SEC says public EDGAR filing content is free to access and reuse. The original PresentBench PDF is not redistributed; its text is provided from the SEC filing, with the source and benchmark revision recorded in `case.json` and the run's `task-provenance.json`.

Add `--run` to start generation. The scope of this offline bundle is the task and evaluation resources; model-provider configuration remains the existing demo configuration.

## Case identity

- Benchmark: PresentBench (238 presentation-generation tasks)
- Case: `economics/JPMorgan_Chase/Earning3`
- Task: explain JPMorgan Chase's Q3 2021 financial results to media and non-specialists, using only the supplied release
- Expected output: 15–20 slides
- Pinned dataset revision: `3c6e01f563165d3a364a459f9777cd7286f42cd8`
- Dataset card and benchmark data terms: <https://huggingface.co/datasets/PresentBench/PresentBench>
- Benchmark implementation: <https://github.com/PresentBench/PresentBench>
- SEC source release: <https://www.sec.gov/Archives/edgar/data/19617/000001961721000446/a3q21erfexhibit991narrative.htm>

The bundled PresentBench instructions and evaluation rubric are attributed to PresentBench and provided under CC BY-NC 4.0. See `ASSET-ATTRIBUTION.md`. The SEC source is used for the earnings-release text; source page screenshots and the JPMorgan-hosted PDF are not bundled. A run records both its benchmark case and SEC content source in `task-provenance.json`.
