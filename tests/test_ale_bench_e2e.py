import json
from pathlib import Path

from autoresearch_pi.ale_bench_e2e import run_ale_bench_e2e


class Bridge:
    def __init__(self): self.closed = False
    def public_eval(self, code, language): return {"overall_absolute_score": 5}
    def private_eval(self, code, language): return {"result": {"overall_absolute_score": 6}, "rank": 2, "performance": 0.9}
    def close(self): self.closed = True


def test_e2e_runs_public_then_one_private_and_closes(tmp_path: Path):
    holder = {}
    def factory(problem_id, lite_version=True):
        holder["bridge"] = Bridge()
        return holder["bridge"]
    artifact = run_ale_bench_e2e(tmp_path, problem_id="ahc008", code="x", public_rounds=2,
                                 bridge_factory=factory)
    payload = json.loads(artifact.read_text())
    assert len(payload["public_results"]) == 2
    assert payload["private_result"]["rank"] == 2
    assert holder["bridge"].closed
