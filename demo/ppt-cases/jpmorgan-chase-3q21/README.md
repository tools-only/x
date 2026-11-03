# PresentBench: JPMorgan Chase Q3 2021 earnings

This is the end-to-end task case used by the PPT production demo. Its source material and task files are bundled under `assets/`, so preparing a run does not fetch task data. The production run uses `production_brief.md` and the earnings-release text to create a 15-slide editable presentation. The task Agent decides what preparation, exploration, production methods and quality checks to use, and which reusable harness methods are worth developing. The source PresentBench instructions and judge prompt are retained in the run's separate `evaluation/` directory, never in the agent's task workspace. The generation instructions contain unrelated space-exploration wording, so this production demo does not claim a benchmark score. A task run can provide evidence about autonomous harness engineering; the task brief itself does not establish that autonomy.

## Prepare and run from bundled resources

Run the following from the repository root. No case-resource download step is needed:

```powershell
$env:PYTHONPATH = 'src'
python -m autoresearch_pi.ppt_demo --root runs/ppt-jpm-3q21 --source demo/ppt-cases/jpmorgan-chase-3q21/assets
```

The packaged `material.txt` is the text of the JPMorgan Chase 3Q21 earnings release furnished as SEC EDGAR Exhibit 99.1. SEC says public EDGAR filing content is free to access and reuse. The original PresentBench PDF is not redistributed; its text is provided from the SEC filing, with the source and benchmark revision recorded in `case.json` and the run's `task-provenance.json`.

Add `--run --official-openai` to start generation with the existing OpenAI Codex OAuth login and GPT-6 Luna. Pi must already be logged in to OpenAI Codex on that machine. This provider option keeps the same task loop and uses the run's existing budget/deadline guard; the task files themselves are read locally.

## Case identity

- Source case: PresentBench (238 presentation-generation tasks)
- Case: `economics/JPMorgan_Chase/Earning3`
- Task: explain JPMorgan Chase's Q3 2021 financial results to media and non-specialists, using only the supplied release
- Production brief: an edited, task-specific 15-slide financial-results deck brief derived from the supplied source and case requirements
- Benchmark status: no score claimed; source judge prompt retained outside task context
- Pinned dataset revision: `3c6e01f563165d3a364a459f9777cd7286f42cd8`
- Dataset card and benchmark data terms: <https://huggingface.co/datasets/PresentBench/PresentBench>
- Benchmark implementation: <https://github.com/PresentBench/PresentBench>
- SEC source release: <https://www.sec.gov/Archives/edgar/data/19617/000001961721000446/a3q21erfexhibit991narrative.htm>

The bundled PresentBench instructions and evaluation rubric are attributed to PresentBench and provided under CC BY-NC 4.0. See `ASSET-ATTRIBUTION.md`. The SEC source is used for the earnings-release text; source page screenshots and the JPMorgan-hosted PDF are not bundled. A run records both its benchmark case and SEC content source in `task-provenance.json`.
