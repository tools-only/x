from __future__ import annotations

import json
import inspect
import uuid
from pathlib import Path
from typing import Callable

from .events import append_jsonl, utc_now, write_json
from .meta import KnowledgeLibrary
from .phase_reports import meta_summary
from .resolver import resolve_harness
from .specs import instantiate_harness_spec, publish_harness_spec
from .store import ObjectStore
from .projections import meta_evidence_projection


RunHarness = Callable[[str, dict, str, dict | None], dict]
EVOLUTION_STATE_PATH = Path("research") / "evolution.json"
EVOLUTION_SCHEMA_VERSION = "hos.evolution.v1"


def _evolution_path(store: ObjectStore) -> Path:
    return store.root / EVOLUTION_STATE_PATH


def read_evolution_state(store: ObjectStore, limit: int = 8) -> dict:
    path = _evolution_path(store)
    if not path.is_file():
        return {
            "schema_version": EVOLUTION_SCHEMA_VERSION,
            "current": None,
            "rounds": [],
        }
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("evolution state must be an object")
    rounds = value.get("rounds", [])
    if not isinstance(rounds, list):
        raise ValueError("evolution state rounds must be a list")
    return {
        "schema_version": value.get("schema_version", EVOLUTION_SCHEMA_VERSION),
        "current": value.get("current"),
        "rounds": rounds[-max(1, limit) :],
    }


def _write_evolution_state(store: ObjectStore, state: dict) -> None:
    write_json(_evolution_path(store), state)


class ResearchControlPlane:
    """Meta-facing control plane over immutable RuntimeSpec and RuntimeHarness objects."""

    def __init__(
        self,
        store: ObjectStore,
        *,
        parent_run: str,
        run_harness: RunHarness | None = None,
    ):
        self.store = store
        self.parent_run = parent_run
        self._run_harness = run_harness or self._default_run_harness

    @property
    def parent_run_dir(self) -> Path:
        directory = self.store.root / "runs" / self.parent_run
        if not directory.is_dir():
            raise FileNotFoundError(f"parent Meta run not found: {self.parent_run}")
        return directory

    @property
    def research_dir(self) -> Path:
        directory = self.store.root / "research" / self.parent_run
        directory.mkdir(parents=True, exist_ok=True)
        return directory

    @staticmethod
    def _id(reference: str) -> str:
        return reference.removeprefix("sha256:")

    def _write_index(self) -> None:
        instances_dir = self.research_dir / "instances"
        instances = []
        if instances_dir.is_dir():
            for harness_path in sorted(instances_dir.iterdir()):
                harness_file = harness_path / "harness.json"
                if harness_file.is_file():
                    payload = json.loads(harness_file.read_text(encoding="utf-8"))
                    instances.append({"harness": payload["harness"], "spec": payload["spec"]})
        write_json(
            self.research_dir / "index.json",
            {"meta_harness_run": self.parent_run, "instances": instances},
        )

    def read_evolution(self, limit: int = 8) -> dict:
        return read_evolution_state(self.store, limit)

    def publish_spec(self, spec: dict, *, agent_run: str) -> dict:
        reference = publish_harness_spec(self.store, spec, created_by_run=agent_run)
        record = self.store.read(reference)
        write_json(
            self.research_dir / "specs" / f"{self._id(reference)}.json",
            {"spec": reference, "published_by_agent_run": agent_run, "manifest": record["manifest"]},
        )
        self._write_index()
        return {"spec": reference}

    def instantiate_runtime(self, spec: str, *, agent_run: str) -> dict:
        spec_reference = self.store.resolve_ref(spec)
        harness = instantiate_harness_spec(self.store, spec_reference, created_by_run=agent_run)
        record = self.store.read(harness)
        write_json(
            self.research_dir / "instances" / self._id(harness) / "harness.json",
            {
                "spec": spec_reference,
                "harness": harness,
                "instantiated_by_agent_run": agent_run,
                "manifest": record["manifest"],
                "lock": resolve_harness(self.store, harness),
            },
        )
        self._write_index()
        return {"harness": harness}

    def run_runtime(self, harness: str, job: dict) -> dict:
        harness_reference = self.store.resolve_ref(harness)
        harness_manifest = self.store.read(harness_reference)["manifest"]
        spec_reference = harness_manifest.get("spec")
        budget = None
        if isinstance(spec_reference, str):
            spec = self.store.read(spec_reference)["manifest"]
            method = spec.get("method")
            if isinstance(method, dict) and isinstance(method.get("budget"), dict):
                budget = method["budget"]
        parameter_count = len(inspect.signature(self._run_harness).parameters)
        if parameter_count >= 4:
            nested = self._run_harness(harness_reference, job, self.parent_run, budget)
        else:
            nested = self._run_harness(harness_reference, job, self.parent_run)  # type: ignore[call-arg]
        run_id = nested.get("run_id")
        if isinstance(run_id, str):
            instance_dir = self.research_dir / "instances" / self._id(harness_reference) / "runs" / run_id
            spec = self.store.read(harness_reference)["manifest"].get("spec")
            write_json(instance_dir / "run.json", {"spec": spec, "harness": harness_reference, "run": nested})
            result = nested.get("result")
            terminal_result = result.get("terminal_bench") if isinstance(result, dict) else None
            harbor_result = terminal_result.get("harbor_result") if isinstance(terminal_result, dict) else None
            verifier_result = harbor_result.get("verifier_result") if isinstance(harbor_result, dict) else None
            if isinstance(verifier_result, dict):
                write_json(
                    instance_dir / "harbor-verifier.json",
                    {
                        "spec": spec,
                        "harness": harness_reference,
                        "harness_run": run_id,
                        "authoritative_score": terminal_result.get("score"),
                        "verifier_result": verifier_result,
                        "harbor_result": harbor_result,
                    },
                )
            append_jsonl(self.parent_run_dir / "children.jsonl", {"run_id": run_id, "harness": harness_reference})
        self._write_index()
        return nested

    def observe_run(self, run_id: str) -> dict:
        run_dir = self.store.root / "runs" / run_id
        if not run_dir.is_dir():
            raise FileNotFoundError(f"run not found: {run_id}")
        result = json.loads((run_dir / "result.json").read_text(encoding="utf-8"))
        observation = {
            "run_id": run_id,
            "status": json.loads((run_dir / "status.json").read_text(encoding="utf-8")),
            "runtime_summary": self._runtime_summary(result),
            "authoritative_metrics": json.loads((run_dir / "metrics.json").read_text(encoding="utf-8")),
            "usage": json.loads((run_dir / "usage.json").read_text(encoding="utf-8")),
        }
        phase_reports = self._read_phase_reports(run_dir)
        if not phase_reports:
            terminal_result = result.get("terminal_bench")
            result_reports = terminal_result.get("phase_reports") if isinstance(terminal_result, dict) else None
            if isinstance(result_reports, list):
                phase_reports = [item for item in result_reports if isinstance(item, dict)]
        if phase_reports:
            observation["methodology_reports"] = [meta_summary(report) for report in phase_reports[-4:]]
        observation["meta_evidence"] = meta_evidence_projection(observation)
        observation.pop("result", None)
        return observation

    @staticmethod
    def _runtime_summary(result: dict) -> dict:
        terminal_result = result.get("terminal_bench")
        if isinstance(terminal_result, dict):
            harbor_result = terminal_result.get("harbor_result")
            return {
                "kind": "terminal_bench",
                "evaluable": terminal_result.get("evaluable") is True,
                "verifier_available": isinstance(harbor_result, dict)
                and isinstance(harbor_result.get("verifier_result"), dict),
                "exit_code": terminal_result.get("exit_code"),
            }
        error = result.get("error")
        if isinstance(error, dict):
            return {"kind": "runtime_error", "error_type": error.get("type")}
        return {"kind": "runtime", "completed": True}

    @staticmethod
    def _read_phase_reports(run_dir: Path) -> list[dict]:
        reports: list[dict] = []
        for path in run_dir.rglob("phase-reports.jsonl"):
            try:
                lines = path.read_text(encoding="utf-8").splitlines()
            except OSError:
                continue
            for line in lines:
                try:
                    value = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(value, dict):
                    reports.append(value)
        return reports

    def search_knowledge(self, query: str, limit: int = 8) -> dict:
        return {"records": KnowledgeLibrary(self.store).search(query, limit=limit)}

    def record_decision(self, spec: str, decision: dict, *, agent_run: str) -> dict:
        spec_reference = self.store.resolve_ref(spec)
        status = decision.get("status")
        rationale = decision.get("rationale")
        allowed = {"confirmed", "rejected", "revised", "expanded", "deferred"}
        if status not in allowed or not isinstance(rationale, str) or not rationale.strip():
            raise ValueError(f"decision requires status in {sorted(allowed)} and a rationale")

        evidence_runs = decision.get("evidence_runs", decision.get("runs", []))
        if isinstance(evidence_runs, str):
            evidence_runs = [evidence_runs]
        if not isinstance(evidence_runs, list) or not all(isinstance(item, str) and item for item in evidence_runs):
            raise ValueError("decision.evidence_runs must be a list of run IDs")
        if status != "deferred" and not evidence_runs:
            raise ValueError("non-deferred decisions require evidence_runs")
        evidence = [self._read_evidence_run(run_id) for run_id in evidence_runs]

        promote_harness = decision.get("promote_harness")
        if promote_harness is not None:
            if status not in {"confirmed", "expanded"}:
                raise ValueError("promote_harness requires a confirmed or expanded decision")
            promote_harness = self.store.resolve_ref(promote_harness)
            promoted_manifest = self.store.read(promote_harness)["manifest"]
            if promoted_manifest.get("kind") != "harness":
                raise ValueError("promote_harness must reference a harness")
            if promoted_manifest.get("spec") != spec_reference:
                raise ValueError("promote_harness must be compiled from the decision spec")
            if not any(
                record.get("harness") == promote_harness and self._evidence_succeeded(record)
                for record in evidence
            ):
                raise ValueError("promote_harness requires evidence_runs from that harness")
        successor_spec = decision.get("successor_spec")
        if successor_spec is not None:
            successor_spec = self.store.resolve_ref(successor_spec)
            if self.store.read(successor_spec)["manifest"].get("kind") != "harness-spec":
                raise ValueError("successor_spec must reference a harness-spec")

        assessment = dict(decision)
        assessment.pop("runs", None)
        assessment["evidence_runs"] = evidence_runs
        if promote_harness is not None:
            assessment["promote_harness"] = promote_harness
        if successor_spec is not None:
            assessment["successor_spec"] = successor_spec

        decision_id = f"decision-{uuid.uuid4().hex[:16]}"
        state = read_evolution_state(self.store, limit=100000)
        round_id = f"round-{uuid.uuid4().hex[:16]}"
        current = state.get("current")
        round_record = {
            "round": round_id,
            "parent_round": current.get("round") if isinstance(current, dict) else None,
            "meta_run": self.parent_run,
            "spec": spec_reference,
            "evidence_runs": evidence_runs,
            "evidence": [
                {"run_id": record["run_id"], "harness": record.get("harness")}
                for record in evidence
            ],
            "assessment": assessment,
            "successor_spec": successor_spec,
            "promoted_harness": promote_harness,
            "created_at": utc_now(),
        }
        state["schema_version"] = EVOLUTION_SCHEMA_VERSION
        state.setdefault("rounds", []).append(round_record)
        if promote_harness is not None:
            promoted_manifest = self.store.read(promote_harness)["manifest"]
            state["current"] = {
                "round": round_id,
                "harness": promote_harness,
                "spec": promoted_manifest.get("spec"),
                "updated_at": utc_now(),
            }
            self.store.set_ref("harness/task/current", promote_harness)
        _write_evolution_state(self.store, state)
        write_json(
            self.research_dir / "decisions" / f"{decision_id}.json",
            {
                "decision": decision_id,
                "spec": spec_reference,
                "recorded_by_agent_run": agent_run,
                "recorded_at": utc_now(),
                "assessment": assessment,
                "round": round_record,
            },
        )
        self._write_index()
        return {
            "decision": decision_id,
            "round": round_id,
            "spec": spec_reference,
            "promoted_harness": promote_harness,
        }

    def _read_evidence_run(self, run_id: str) -> dict:
        instances = self.research_dir / "instances"
        for run_file in instances.glob("*/runs/*/run.json") if instances.is_dir() else []:
            if run_file.parent.name != run_id:
                continue
            record = json.loads(run_file.read_text(encoding="utf-8"))
            nested = record.get("run", {})
            return {
                "run_id": run_id,
                "harness": record.get("harness"),
                "status": nested.get("status"),
                "result": nested.get("result", {}),
                "authoritative_metrics": nested.get("authoritative_metrics"),
            }
        direct = self.store.root / "runs" / run_id
        if direct.is_dir() and (direct / "status.json").is_file():
            status = json.loads((direct / "status.json").read_text(encoding="utf-8"))
            return {
                "run_id": run_id,
                "status": status,
                "result": json.loads((direct / "result.json").read_text(encoding="utf-8")),
                "metrics": json.loads((direct / "metrics.json").read_text(encoding="utf-8")),
            }
        raise ValueError(f"evidence run not found: {run_id}")

    @staticmethod
    def _evidence_succeeded(record: dict) -> bool:
        status = record.get("status")
        if isinstance(status, str):
            return status == "succeeded"
        return isinstance(status, dict) and status.get("state") == "succeeded"

    def _default_run_harness(self, harness: str, job: dict, parent_run: str, budget: dict | None = None) -> dict:
        from .supervisor import Supervisor

        return Supervisor(self.store).start_harness(harness, job, parent_run=parent_run, budget=budget)
