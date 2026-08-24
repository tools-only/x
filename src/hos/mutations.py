"""Kernel-owned, transactional Harness component mutations."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

from .resolver import resolve_harness
from .store import InvalidReference, ObjectStore

_IDENTIFIER = re.compile(r"^[A-Za-z][A-Za-z0-9_]*$")
_COMPONENTS = {"prompt", "skill", "subagent", "memory"}
_SCOPES = {"task-local", "methodology-reviewed"}


@dataclass(frozen=True)
class MutationResult:
    generation: str
    accepted: bool
    errors: tuple[dict[str, str], ...] = ()
    successor_harness: str | None = None


class HarnessMutationKernel:
    """Validate and publish Harness mutations without changing refs."""

    def __init__(self, store: ObjectStore):
        self.store = store

    def validate(self, proposal: dict[str, Any]) -> tuple[dict[str, str], ...]:
        errors: list[dict[str, str]] = []
        if proposal.get("kind") != "harness-mutation":
            errors.append({"path": "kind", "code": "invalid_kind"})
        if not isinstance(proposal.get("base_harness"), str):
            errors.append({"path": "base_harness", "code": "required"})
        if proposal.get("scope") not in _SCOPES:
            errors.append({"path": "scope", "code": "invalid_scope"})
        operations = proposal.get("operations")
        if not isinstance(operations, list) or not operations:
            errors.append({"path": "operations", "code": "non_empty_array_required"})
            return tuple(errors)
        for index, operation in enumerate(operations):
            path = f"operations[{index}]"
            if not isinstance(operation, dict):
                errors.append({"path": path, "code": "object_required"})
                continue
            component = operation.get("component")
            action = operation.get("action")
            if component not in _COMPONENTS:
                errors.append({"path": f"{path}.component", "code": "invalid_component"})
            if action not in {"add", "edit", "delete", "replace"}:
                errors.append({"path": f"{path}.action", "code": "invalid_action"})
            if action != "delete" and "value" not in operation:
                errors.append({"path": f"{path}.value", "code": "required"})
            value = operation.get("value")
            if component in {"skill", "subagent"} and isinstance(value, dict):
                name = value.get("name")
                if name is not None and (not isinstance(name, str) or not _IDENTIFIER.fullmatch(name)):
                    errors.append({"path": f"{path}.value.name", "code": "invalid_identifier"})
            if component == "memory" and action in {"add", "edit"} and isinstance(value, dict):
                confidence = value.get("confidence")
                if not isinstance(confidence, int) or not 1 <= confidence <= 5:
                    errors.append({"path": f"{path}.value.confidence", "code": "invalid_confidence"})
            if component == "subagent" and isinstance(value, dict):
                handler = value.get("handler_type", "looping")
                if handler not in {"looping", "one_step"}:
                    errors.append({"path": f"{path}.value.handler_type", "code": "invalid_handler_type"})
                tools = value.get("allowed_tools", [])
                if not isinstance(tools, list) or not all(isinstance(tool, str) for tool in tools):
                    errors.append({"path": f"{path}.value.allowed_tools", "code": "invalid_tool_allowlist"})
        return tuple(errors)

    def publish(self, proposal: dict[str, Any], *, created_by_run: str) -> MutationResult:
        errors = self.validate(proposal)
        if errors:
            return MutationResult("", False, errors)
        base = proposal["base_harness"]
        try:
            base_digest = self.store.resolve_ref(base)
            lock = resolve_harness(self.store, base_digest)
        except Exception as exc:
            return MutationResult("", False, ({"path": "base_harness", "code": "unresolvable", "message": str(exc)},))
        successor = self._derive_successor(lock, proposal, created_by_run=created_by_run)
        manifest = {
            "api_version": "hos.harness-mutation.v1",
            "kind": "harness-mutation",
            "base_harness": base_digest,
            "scope": proposal["scope"],
            "operations": proposal["operations"],
            "created_by_run": created_by_run,
            "successor_harness": successor,
        }
        digest = self.store.publish(manifest)
        return MutationResult(digest, True, successor_harness=successor)

    def commit(self, result: MutationResult, *, ref: str, expected_base: str) -> str:
        if not result.accepted or not result.successor_harness:
            raise ValueError("cannot commit a rejected mutation")
        current = self.store.resolve_ref(ref)
        if current != self.store.resolve_ref(expected_base):
            raise ValueError("mutation base is no longer current")
        self.store.set_ref(ref.removeprefix("ref:"), result.successor_harness)
        return result.successor_harness

    def _derive_successor(self, lock: dict[str, Any], proposal: dict[str, Any], *, created_by_run: str) -> str:
        """Apply component operations and publish a successor Harness graph."""
        harness = self.store.read(lock["harness"]) ["manifest"]
        agent_ref = harness["root_agent"]
        agent = dict(self.store.read(agent_ref)["manifest"])
        skills = list(agent.get("skills", []))
        subagents = dict(agent.get("subagents", {}))
        memory_ref = agent.get("memory")
        policy_ref = agent.get("policy")
        for operation in proposal["operations"]:
            component = operation["component"]
            action = operation["action"]
            value = operation.get("value")
            if component == "prompt" and action in {"replace", "edit", "add"}:
                policy_ref = self.store.publish(
                    {"api_version": "hos.policy.v1", "kind": "policy", "name": "evolved-policy", "created_by_run": created_by_run},
                    {"policy.md": str(value if not isinstance(value, dict) else value.get("content", ""))},
                )
            elif component == "skill" and action in {"add", "edit", "replace"}:
                item = dict(value) if isinstance(value, dict) else {"name": "evolved_skill", "content": str(value)}
                name = str(item["name"])
                skill_ref = self.store.publish(
                    {"api_version": "hos.skill.v1", "kind": "skill", "name": name, "created_by_run": created_by_run},
                    {"SKILL.md": str(item.get("content", item.get("code", "")))},
                )
                skills = [entry for entry in skills if entry.get("name") != name]
                skills.append({"name": name, "ref": skill_ref, "load": item.get("load", "always")})
            elif component == "skill" and action == "delete":
                name = str(value.get("name") if isinstance(value, dict) else value)
                skills = [entry for entry in skills if entry.get("name") != name]
            elif component == "subagent" and action in {"add", "edit", "replace"}:
                item = dict(value) if isinstance(value, dict) else {"name": "evolved_subagent"}
                name = str(item["name"])
                binding = item.get("agent")
                if not isinstance(binding, str):
                    policy = self.store.publish(
                        {"api_version": "hos.policy.v0", "kind": "policy", "name": f"{name}-policy", "created_by_run": created_by_run},
                        {"policy.md": str(item.get("policy", item.get("content", "Act as a bounded subagent and return a useful result.")))},
                    )
                    memory = self.store.publish(
                        {"api_version": "hos.memory.v0", "kind": "memory", "name": f"{name}-memory", "created_by_run": created_by_run},
                        {"memory.json": json.dumps(item.get("memory", {}), ensure_ascii=False, sort_keys=True)},
                    )
                    binding = self.store.publish(
                        {
                            "api_version": "hos.agent.v0",
                            "kind": "agent",
                            "name": name,
                            "driver": item.get("driver", "critic"),
                            "loop": agent.get("loop"),
                            "policy": policy,
                            "skills": [],
                            "tools": [],
                            "memory": memory,
                            "subagents": {},
                            "created_by_run": created_by_run,
                        }
                    )
                subagents[name] = {"agent": binding, "max_instances": int(item.get("max_instances", 1))}
            elif component == "subagent" and action == "delete":
                name = str(value.get("name") if isinstance(value, dict) else value)
                subagents.pop(name, None)
            elif component == "memory" and action in {"replace", "edit", "add"}:
                memory_ref = self.store.publish(
                    {"api_version": "hos.memory.v1", "kind": "memory", "name": "evolved-memory", "created_by_run": created_by_run},
                    {"memory.json": json.dumps(value, ensure_ascii=False, sort_keys=True)},
                )
        agent.update({"policy": policy_ref, "skills": skills, "subagents": subagents, "memory": memory_ref, "created_by_run": created_by_run})
        successor_agent = self.store.publish(agent)
        successor_manifest = dict(harness)
        component_map = dict(successor_manifest.get("component_map", {}))
        component_map["agent"] = successor_agent
        component_map["agent.policy"] = policy_ref
        component_map["agent.memory"] = memory_ref
        component_map["agent.skills"] = [entry.get("name") for entry in skills if isinstance(entry, dict)]
        component_map["agent.subagents"] = sorted(subagents)
        successor_manifest.update({
            "root_agent": successor_agent,
            "created_by_run": created_by_run,
            "parent_harness": lock["harness"],
            "component_map": component_map,
        })
        return self.store.publish(successor_manifest)
