import importlib.util
import json
from pathlib import Path

import pytest


def module():
    path = Path(__file__).resolve().parents[1] / "tools/arc_capability_experiment.py"
    spec = importlib.util.spec_from_file_location("capability_experiment", path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def test_snapshot_is_frozen_and_excludes_credentials(tmp_path):
    project = tmp_path / "project"
    (project / "demo/prompts").mkdir(parents=True)
    prompt = project / "demo/prompts/guide.md"
    prompt.write_text("original")
    (project / ".env_deepseek").write_text("OPENAI_API_KEY=secret")
    destination = tmp_path / "experiment"
    module().prepare_snapshot(project, destination, {"model": "test"})
    prompt.write_text("modified")
    assert (destination / "source/demo/prompts/guide.md").read_text() == "original"
    assert not (destination / "source/.env_deepseek").exists()
    manifest = json.loads((destination / "experiment.json").read_text())
    assert len(manifest["source_sha256"]["demo/prompts/guide.md"]) == 64
    assert "secret" not in json.dumps(manifest)
    with pytest.raises(ValueError, match="empty"):
        module().prepare_snapshot(project, destination, {})


def test_max_output_tokens_must_be_positive():
    experiment = module()
    assert experiment.positive_int("4096") == 4096
    with pytest.raises(Exception, match="positive integer"):
        experiment.positive_int("0")
