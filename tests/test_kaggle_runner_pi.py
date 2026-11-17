"""Actual Pi loads the Kaggle extension and reaches a guarded dry-run submission."""
import json
import sys
from pathlib import Path

from autoresearch_pi import kaggle_demo
from autoresearch_pi.pi_kernel import PiKernel

PROJECT = Path(__file__).resolve().parents[1]


def test_kaggle_runner_reaches_dry_run_and_finish(tmp_path, monkeypatch):
    root = tmp_path / "run"
    kaggle_demo.prepare(root, "synthetic", sys.executable, download=False,
                        metadata={"title": "Synthetic", "url": "https://example.invalid", "metric": "ROC AUC",
                                  "deadline": "2026-12-31", "target_top": 10})
    data = root / "workspace" / "data" / "raw"
    (data / "sample_submission.csv").write_text("id,target\na,0\nb,0\nc,0\n", encoding="utf-8")
    facts = json.loads((root / "workspace" / "data" / "competition.json").read_text())
    facts.update({"submission_columns": ["id", "target"], "id_column": "id",
                  "prediction_columns": ["target"], "expected_rows": 3})
    (root / "workspace" / "data" / "competition.json").write_text(json.dumps(facts), encoding="utf-8")

    def kernel(command, **kwargs):
        command = [*command, "--extension", str(PROJECT / "tests" / "kaggle_scripted_provider.ts")]
        kwargs["timeout"] = 120
        return PiKernel(command, **kwargs)

    monkeypatch.setattr(kaggle_demo, "PiKernel", kernel)
    result = kaggle_demo.run(root, seconds=180)

    assert result["complete"] is True, result
    assert result["stop"] == "finished"
    assert result["finish"]["best_public_score"] == 0.9
    tools = [json.loads(line) for line in (root / "harness" / "tools.jsonl").read_text(encoding="utf-8").splitlines()]
    assert any(row["name"] == "run_python" and not row.get("isError") for row in tools)
    assert any(row["name"] == "kaggle_submit" and not row.get("isError") for row in tools)
    provider = [json.loads(line) for line in (root / "scripted-provider.jsonl").read_text(encoding="utf-8").splitlines()]
    assert len(provider) >= 3
