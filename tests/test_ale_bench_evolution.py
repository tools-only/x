import json
from pathlib import Path

from autoresearch_pi.ale_bench_evolution import run_evolution


class Bridge:
    def __init__(self): self.closed = False
    def public_eval(self, code, language): return {"overall_absolute_score": len(code)}
    def private_eval(self, code, language): return {"result": {"overall_absolute_score": len(code)}, "rank": 1, "performance": 1.0}
    def close(self): self.closed = True


def test_agent_owned_loop_keeps_lineage_and_submits_best(tmp_path: Path):
    holder = {}
    def factory(problem_id, lite_version=True):
        holder["bridge"] = Bridge()
        return holder["bridge"]
    candidates = iter(["better", "bestest", None])
    artifact = run_evolution(tmp_path, problem_id="ahc008", initial_code="x",
                             agent_step=lambda source, public, history: next(candidates),
                             max_iterations=3, bridge_factory=factory)
    payload = json.loads(artifact.read_text())
    attempts = json.loads((tmp_path / "attempts.json").read_text())
    assert payload["private_result"]["result"]["overall_absolute_score"] == 7
    assert attempts["best_attempt_id"] == "a2"
    assert attempts["attempts"][1]["parent_id"] == "a0"
    assert holder["bridge"].closed
