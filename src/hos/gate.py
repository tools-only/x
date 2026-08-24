from __future__ import annotations

import copy
import uuid

from .events import write_json
from .store import ObjectStore
from .supervisor import Supervisor


class Gate:
    def __init__(self, store: ObjectStore):
        self.store = store
        self.promotions_dir = store.root / "promotions"
        self.promotions_dir.mkdir(parents=True, exist_ok=True)

    def evaluate(self, baseline: str, candidate: str, meta_job: dict, contract: dict | None = None) -> dict:
        contract = {"margin": 0.01, **(contract or {})}
        cold_job = copy.deepcopy(meta_job)
        cold_job["generation"] = 1
        baseline_run = Supervisor(self.store).start_harness(baseline, cold_job)
        candidate_run = Supervisor(self.store).start_harness(candidate, cold_job)
        baseline_score = float(baseline_run["result"].get("selected_score", 0.0))
        candidate_score = float(candidate_run["result"].get("selected_score", 0.0))
        delta = candidate_score - baseline_score
        margin = float(contract["margin"])
        if delta > margin:
            decision = "promoted"
        elif delta < -margin:
            decision = "rejected"
        else:
            decision = "inconclusive"
        gate_id = f"gate-{uuid.uuid4().hex[:16]}"
        record = {
            "gate_id": gate_id,
            "decision": decision,
            "baseline": baseline,
            "candidate": candidate,
            "baseline_run": baseline_run["run_id"],
            "candidate_run": candidate_run["run_id"],
            "baseline_score": baseline_score,
            "candidate_score": candidate_score,
            "delta": delta,
            "contract": contract,
        }
        write_json(self.promotions_dir / f"{gate_id}.json", record)
        if decision == "promoted":
            self.store.set_ref("harness/meta/current", candidate)
        return record

    def evaluate_task(
        self,
        baseline: str,
        candidate: str,
        task_job: dict,
        contract: dict | None = None,
    ) -> dict:
        contract = {"margin": 0.01, **(contract or {})}
        baseline_run = Supervisor(self.store).start_harness(baseline, copy.deepcopy(task_job))
        candidate_run = Supervisor(self.store).start_harness(candidate, copy.deepcopy(task_job))
        baseline_score = float(baseline_run["authoritative_metrics"].get("score", 0.0))
        candidate_score = float(candidate_run["authoritative_metrics"].get("score", 0.0))
        delta = candidate_score - baseline_score
        margin = float(contract["margin"])
        if delta > margin:
            decision = "promoted"
        elif delta < -margin:
            decision = "rejected"
        else:
            decision = "inconclusive"
        gate_id = f"gate-{uuid.uuid4().hex[:16]}"
        record = {
            "gate_id": gate_id,
            "kind": "task",
            "decision": decision,
            "baseline": baseline,
            "candidate": candidate,
            "baseline_run": baseline_run["run_id"],
            "candidate_run": candidate_run["run_id"],
            "baseline_score": baseline_score,
            "candidate_score": candidate_score,
            "delta": delta,
            "contract": contract,
            "task_job": task_job,
        }
        write_json(self.promotions_dir / f"{gate_id}.json", record)
        if decision == "promoted":
            self.store.set_ref("harness/task/current", candidate)
        return record
