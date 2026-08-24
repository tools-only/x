from __future__ import annotations

import copy

from .resolver import InvalidGraphError, resolve_harness
from .store import ObjectStore


def _leaf(kind: str, name: str, **extra: object) -> dict:
    return {"api_version": f"hos.{kind}.v0", "kind": kind, "name": name, **extra}


def derive_harness(
    store: ObjectStore,
    base_harness: str,
    patch: dict,
    *,
    created_by_run: str,
) -> str:
    lock = resolve_harness(store, base_harness)
    root_digest = lock["resolved_objects"]["root_agent"]
    root_agent = copy.deepcopy(lock["objects"]["root_agent"])

    replace_skill = patch.get("replace_skill")
    if replace_skill:
        name = replace_skill["name"]
        binding = next((item for item in root_agent.get("skills", []) if item.get("name") == name), None)
        if binding is None:
            raise InvalidGraphError(f"root agent has no skill binding named {name!r}")
        previous_skill = store.read(binding["ref"])["manifest"]
        skill_manifest = {
            **previous_skill,
            "parent": binding["ref"],
            "created_by_run": created_by_run,
        }
        binding["ref"] = store.publish(skill_manifest, {"SKILL.md": replace_skill["content"]})

    add_subagent = patch.get("add_subagent")
    if add_subagent:
        name = add_subagent["name"]
        if name in root_agent.get("subagents", {}):
            raise InvalidGraphError(f"subagent binding already exists: {name}")
        loop = root_agent["loop"]
        policy = store.publish(
            _leaf("policy", f"{name}-policy", created_by_run=created_by_run),
            {"policy.md": f"Act as the {name} subagent and return a bounded result."},
        )
        skill = store.publish(
            _leaf("skill", f"{name}-skill", created_by_run=created_by_run),
            {"SKILL.md": f"Review the parent input as {name}."},
        )
        memory = store.publish(_leaf("memory", f"{name}-memory", created_by_run=created_by_run))
        subagent = store.publish(
            {
                "api_version": "hos.agent.v0",
                "kind": "agent",
                "name": name,
                "driver": add_subagent.get("driver", "critic"),
                "loop": loop,
                "policy": policy,
                "skills": [{"name": "review", "ref": skill, "load": "always"}],
                "tools": [],
                "memory": memory,
                "subagents": {},
                "created_by_run": created_by_run,
            }
        )
        root_agent.setdefault("subagents", {})[name] = {
            "agent": subagent,
            "max_instances": int(add_subagent.get("max_instances", 1)),
        }

    if not replace_skill and not add_subagent:
        raise InvalidGraphError("candidate patch made no supported changes")

    root_agent["parent"] = root_digest
    root_agent["created_by_run"] = created_by_run
    new_root = store.publish(root_agent)
    harness_manifest = copy.deepcopy(lock["harness_manifest"])
    harness_manifest["root_agent"] = new_root
    harness_manifest["parent"] = lock["harness"]
    harness_manifest["created_by_run"] = created_by_run
    return store.publish(harness_manifest)
