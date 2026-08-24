from __future__ import annotations

from pathlib import Path
from typing import Any, Callable
import json

from .evolver import HarnessEvolver
from .stores import EvolutionStores
from .compatibility import ContinualHarnessCompatibility
from ....mutations import HarnessMutationKernel
from ....store import ObjectStore


class ContinualHarnessController:
    """Persistent self-evolution controller around an existing Task Pipeline."""

    name = "continual-harness"

    def __init__(self, root: Path | str, *, provider: str = "task", stagnation_runs: int = 1, compatibility: ContinualHarnessCompatibility | None = None):
        self.root = Path(root)
        self.stores = EvolutionStores(self.root / "continual-harness")
        self.object_store = ObjectStore(self.root)
        self.mutations = HarnessMutationKernel(self.object_store)
        self.compatibility = compatibility or ContinualHarnessCompatibility()
        self.evolver = HarnessEvolver(self.stores, provider=provider, compatibility=self.compatibility)
        self.stagnation_runs = max(1, stagnation_runs)

    def record_task_run(self, result: dict[str, Any], *, harness: str | None = None) -> dict[str, Any] | None:
        trajectory = self.stores.trajectory.read()
        trajectory.append(result)
        self.stores.trajectory.write(trajectory)
        metrics = result.get("authoritative_metrics", {})
        if result.get("status") != "succeeded" or metrics.get("evaluable") is False:
            return {
                "trigger": "not_evaluable",
                "skipped": True,
                "reason": "task run did not produce authoritative evaluable evidence",
            }
        progress = bool(metrics.get("score", 0) > 0 or metrics.get("episode_runs", 0) > 0)
        if progress:
            return self._evolve_and_commit("progress", trajectory, harness)
        recent = trajectory[-self.stagnation_runs:]
        if len(recent) >= self.stagnation_runs:
            return self._evolve_and_commit("stagnation", trajectory, harness)
        return None

    def record_checkpoint(
        self,
        evidence: dict[str, Any],
        *,
        trigger: str,
        harness: str,
        commit_ref: str,
    ) -> dict[str, Any]:
        """Run one live evolution boundary selected by the Task Harness."""
        trajectory = self.stores.trajectory.read()
        trajectory.append({"kind": "checkpoint", "trigger": trigger, **evidence})
        self.stores.trajectory.write(trajectory)
        if trigger not in {"progress", "stagnation"}:
            return {"trigger": trigger, "checkpoint": True, "skipped": True, "reason": "non_evolution_boundary"}
        before = self.stores.snapshot()
        generation = self.evolver.evolve(trigger=trigger, evidence=trajectory)
        snapshot = self.stores.snapshot()
        operations = self._snapshot_operations(before, snapshot)
        if not operations:
            return {**generation, "checkpoint": True, "trigger": trigger, "skipped": True, "reason": "no_component_change"}
        proposal = {"kind": "harness-mutation", "base_harness": harness, "scope": "task-local", "operations": operations}
        mutation = self.mutations.publish(proposal, created_by_run=f"continual-live-{generation['generation']}")
        result = {**generation, "checkpoint": True, "mutation": {"accepted": mutation.accepted, "digest": mutation.generation, "successor_harness": mutation.successor_harness, "errors": list(mutation.errors)}}
        if mutation.accepted and mutation.successor_harness:
            result["committed_harness"] = self.mutations.commit(mutation, ref=commit_ref, expected_base=harness)
        return result

    def synchronize_harness(self, harness: str) -> None:
        """Make Kernel's immutable Harness version the authoritative live snapshot."""
        lock = self.mutations.store.read(harness)["manifest"]
        agent = self.mutations.store.read(lock["root_agent"])["manifest"]
        policy_record = self.mutations.store.read(agent["policy"])
        policy_path = policy_record["payload_dir"] / "policy.md"
        self.stores.prompt.write({"content": policy_path.read_text(encoding="utf-8") if policy_path.is_file() else ""})
        skills: list[dict[str, Any]] = []
        for binding in agent.get("skills", []):
            if not isinstance(binding, dict) or not isinstance(binding.get("name"), str) or not isinstance(binding.get("ref"), str):
                continue
            record = self.mutations.store.read(binding["ref"])
            skill_path = record["payload_dir"] / "SKILL.md"
            skills.append({"name": binding["name"], "content": skill_path.read_text(encoding="utf-8") if skill_path.is_file() else ""})
        self.stores.skills.write(skills)
        memory_record = self.mutations.store.read(agent["memory"])
        memory_path = memory_record["payload_dir"] / "memory.json"
        try:
            memory = json.loads(memory_path.read_text(encoding="utf-8")) if memory_path.is_file() else []
        except json.JSONDecodeError:
            memory = []
        self.stores.memory.write(memory if isinstance(memory, list) else [])
        self.stores.subagents.write([{"name": name, **binding} for name, binding in agent.get("subagents", {}).items() if isinstance(binding, dict)])

    def record_live_operations(self, operations: list[dict[str, Any]]) -> None:
        """Keep evolver state aligned with accepted Task-local component operations."""
        snapshot = self.stores.snapshot()
        for operation in operations:
            component = operation.get("component")
            action = operation.get("action")
            value = operation.get("value")
            if component == "prompt" and action in {"add", "edit", "replace"}:
                snapshot["prompt"] = {"content": str(value if not isinstance(value, dict) else value.get("content", ""))}
                continue
            collection = {"skill": "skills", "subagent": "subagents", "memory": "memory"}.get(component)
            if collection is None:
                continue
            if component == "memory" and action == "replace":
                snapshot[collection] = value if isinstance(value, list) else []
                continue
            values = list(snapshot.get(collection, []))
            identity = "title" if component == "memory" else "name"
            target = value.get(identity) if isinstance(value, dict) else value
            if action == "delete":
                values = [item for item in values if not isinstance(item, dict) or item.get(identity) != target]
            elif action in {"add", "edit", "replace"} and isinstance(value, dict):
                values = [item for item in values if item.get(identity) != value.get(identity)]
                values.append(value)
            snapshot[collection] = values
        self.stores.prompt.write(snapshot["prompt"])
        self.stores.skills.write(snapshot["skills"])
        self.stores.subagents.write(snapshot["subagents"])
        self.stores.memory.write(snapshot["memory"])

    def _evolve_and_commit(self, trigger: str, evidence: list[dict[str, Any]], harness: str | None) -> dict[str, Any]:
        before = self.stores.snapshot()
        generation = self.evolver.evolve(trigger=trigger, evidence=evidence)
        if not harness:
            return generation
        snapshot = self.stores.snapshot()
        operations = self._snapshot_operations(before, snapshot)
        if not operations:
            generation["mutation"] = {"accepted": False, "digest": "", "successor_harness": None, "errors": [], "reason": "no_component_change"}
            return generation
        proposal = {"kind": "harness-mutation", "base_harness": harness, "scope": "task-local", "operations": operations}
        mutation = self.mutations.publish(proposal, created_by_run=f"continual-{generation['generation']}")
        generation["mutation"] = {"accepted": mutation.accepted, "digest": mutation.generation, "successor_harness": mutation.successor_harness, "errors": list(mutation.errors)}
        if mutation.accepted and mutation.successor_harness:
            try:
                generation["committed_harness"] = self.mutations.commit(
                    mutation,
                    ref="ref:harness/task/current",
                    expected_base=harness,
                )
            except Exception as exc:
                generation["mutation"]["commit_error"] = {"type": type(exc).__name__, "message": str(exc)}
        return generation

    @staticmethod
    def _snapshot_operations(before: dict[str, Any], after: dict[str, Any]) -> list[dict[str, Any]]:
        operations: list[dict[str, Any]] = []
        if before.get("prompt") != after.get("prompt"):
            operations.append({"component": "prompt", "action": "replace", "value": after["prompt"].get("content", "")})
        for component, identity in (("skills", "name"), ("subagents", "name")):
            old_items = {item.get(identity): item for item in before.get(component, []) if isinstance(item, dict) and item.get(identity)}
            new_items = {item.get(identity): item for item in after.get(component, []) if isinstance(item, dict) and item.get(identity)}
            kernel_component = component[:-1]
            for name in sorted(old_items.keys() - new_items.keys()):
                operations.append({"component": kernel_component, "action": "delete", "value": name})
            for name in sorted(new_items):
                action = "add" if name not in old_items else "edit"
                if action == "edit" and old_items[name] == new_items[name]:
                    continue
                operations.append({"component": kernel_component, "action": action, "value": new_items[name]})
        if before.get("memory") != after.get("memory"):
            operations.append({"component": "memory", "action": "replace", "value": after.get("memory", [])})
        return operations
