from __future__ import annotations

from dataclasses import dataclass

from .store import InvalidReference, ObjectStore


class ResolutionError(RuntimeError):
    pass


class MissingObjectError(ResolutionError):
    pass


class GraphCycleError(ResolutionError):
    pass


class InvalidGraphError(ResolutionError):
    pass


@dataclass
class _Resolution:
    store: ObjectStore
    resolved: dict[str, str]
    objects: dict[str, dict]
    stack: list[str]

    def read(self, ref: str) -> tuple[str, dict]:
        try:
            digest = self.store.resolve_ref(ref)
            record = self.store.read(digest)
        except (FileNotFoundError, InvalidReference) as exc:
            raise MissingObjectError(str(ref)) from exc
        return digest, record["manifest"]

    def leaf(self, path: str, ref: str) -> str:
        digest, manifest = self.read(ref)
        self.resolved[path] = digest
        self.objects[path] = manifest
        return digest

    def agent(self, path: str, ref: str) -> str:
        digest, manifest = self.read(ref)
        if digest in self.stack:
            chain = " -> ".join([*self.stack, digest])
            raise GraphCycleError(chain)
        if manifest.get("kind") != "agent":
            raise InvalidGraphError(f"{path} must reference an agent")

        self.resolved[path] = digest
        self.objects[path] = manifest
        self.stack.append(digest)
        try:
            for field in ("loop", "policy", "memory"):
                component_ref = manifest.get(field)
                if not isinstance(component_ref, str):
                    raise InvalidGraphError(f"{path}.{field} is required")
                self.leaf(f"{path}.{field}", component_ref)
            if isinstance(manifest.get("meta_prompt"), str):
                self.leaf(f"{path}.meta_prompt", manifest["meta_prompt"])
            for index, tool_ref in enumerate(manifest.get("tools", [])):
                self.leaf(f"{path}.tools.{index}", tool_ref)
            for skill in manifest.get("skills", []):
                name = skill.get("name")
                skill_ref = skill.get("ref")
                if not name or not isinstance(skill_ref, str):
                    raise InvalidGraphError(f"invalid skill binding in {path}")
                self.leaf(f"{path}.skills.{name}", skill_ref)
            for name, binding in manifest.get("subagents", {}).items():
                agent_ref = binding.get("agent") if isinstance(binding, dict) else None
                if not isinstance(agent_ref, str):
                    raise InvalidGraphError(f"invalid subagent binding {path}.{name}")
                self.agent(f"{path}.subagents.{name}", agent_ref)
        finally:
            self.stack.pop()
        return digest


def resolve_harness(store: ObjectStore, harness_ref: str) -> dict:
    resolution = _Resolution(store=store, resolved={}, objects={}, stack=[])
    try:
        harness_digest = store.resolve_ref(harness_ref)
        harness_record = store.read(harness_digest)
    except (FileNotFoundError, InvalidReference) as exc:
        raise MissingObjectError(str(harness_ref)) from exc
    manifest = harness_record["manifest"]
    if manifest.get("kind") != "harness":
        raise InvalidGraphError("root object must be a harness")

    root_agent = manifest.get("root_agent")
    if not isinstance(root_agent, str):
        raise InvalidGraphError("harness.root_agent is required")
    resolution.agent("root_agent", root_agent)
    if isinstance(manifest.get("spec"), str):
        resolution.leaf("spec", manifest["spec"])
    for field in ("environment", "evaluator", "ruleset"):
        component_ref = manifest.get(field)
        if not isinstance(component_ref, str):
            raise InvalidGraphError(f"harness.{field} is required")
        resolution.leaf(field, component_ref)
    return {
        "api_version": "hos.harness-lock.v0",
        "harness": harness_digest,
        "harness_manifest": manifest,
        "resolved_objects": resolution.resolved,
        "objects": resolution.objects,
    }
