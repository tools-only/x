from __future__ import annotations

import copy

from .meta import validate_hypothesis_spec
from .resolver import InvalidGraphError
from .store import ObjectStore


def _leaf(kind: str, name: str, **extra: object) -> dict:
    return {"api_version": f"hos.{kind}.v0", "kind": kind, "name": name, **extra}


def _component(
    store: ObjectStore,
    kind: str,
    default_name: str,
    value: object,
    *,
    created_by_run: str,
    default_file: str | None = None,
) -> str:
    if isinstance(value, str):
        name = default_name if default_file else (value or default_name)
        manifest_value: dict = {}
        payload = {default_file: value} if default_file else None
    elif isinstance(value, dict):
        name = str(value.get("name", default_name))
        manifest_value = {
            key: item
            for key, item in value.items()
            if key not in {"name", "content", "files"}
        }
        content = value.get("content")
        files = value.get("files")
        if isinstance(files, dict):
            payload = {str(key): str(item) for key, item in files.items()}
        elif isinstance(content, str) and default_file:
            payload = {default_file: content}
        else:
            payload = None
    else:
        name = default_name
        manifest_value = {}
        payload = {default_file: ""} if default_file else None
    return store.publish(
        _leaf(kind, name, created_by_run=created_by_run, **manifest_value),
        payload,
    )


def publish_harness_spec(store: ObjectStore, spec: dict, *, created_by_run: str) -> str:
    if spec.get("kind") != "harness-spec":
        raise InvalidGraphError("spec.kind must be 'harness-spec'")
    if not isinstance(spec.get("agent"), dict):
        raise InvalidGraphError("spec.agent is required")
    if not isinstance(spec.get("environment"), dict):
        raise InvalidGraphError("spec.environment is required")
    if "hypothesis" not in spec:
        raise InvalidGraphError("spec.hypothesis is required")
    if isinstance(spec.get("hypothesis"), dict):
        validate_hypothesis_spec(spec)
    elif not isinstance(spec.get("hypothesis"), str) or not spec["hypothesis"].strip():
        raise InvalidGraphError("spec.hypothesis must be a string or structured object")
    manifest = copy.deepcopy(spec)
    manifest.setdefault("api_version", "hos.harness-spec.v0")
    manifest.setdefault("schema_version", "hos.harness-spec.v1")
    manifest["created_by_run"] = created_by_run
    return store.publish(manifest)


def instantiate_harness_spec(store: ObjectStore, spec_ref: str, *, created_by_run: str) -> str:
    record = store.read(spec_ref)
    spec = record["manifest"]
    if spec.get("kind") != "harness-spec":
        raise InvalidGraphError("root object must be a harness-spec")
    agent_spec = spec.get("agent")
    environment_spec = spec.get("environment")
    if not isinstance(agent_spec, dict) or not isinstance(environment_spec, dict):
        raise InvalidGraphError("harness-spec requires agent and environment objects")

    agent_name = str(agent_spec.get("name", "task-agent"))
    loop = _component(
        store,
        "loop",
        "jsonl-runtime",
        agent_spec.get("loop", "jsonl-runtime"),
        created_by_run=created_by_run,
    )
    policy = _component(
        store,
        "policy",
        f"{agent_name}-policy",
        agent_spec.get("policy", {"content": ""}),
        created_by_run=created_by_run,
        default_file="policy.md",
    )
    skills = []
    for skill_spec in agent_spec.get("skills", []):
        if not isinstance(skill_spec, dict) or not isinstance(skill_spec.get("name"), str):
            raise InvalidGraphError("agent.skills entries require a name")
        skill_name = skill_spec["name"]
        skill = store.publish(
            _leaf("skill", skill_name, created_by_run=created_by_run),
            {"SKILL.md": str(skill_spec.get("content", ""))},
        )
        skills.append({"name": skill_name, "ref": skill, "load": "always"})
    memory = _component(
        store,
        "memory",
        f"{agent_name}-memory",
        agent_spec.get("memory", {}),
        created_by_run=created_by_run,
    )
    tool_specs = agent_spec.get("tools", ["component-load", "host-control"])
    if not isinstance(tool_specs, list):
        raise InvalidGraphError("agent.tools must be a list")
    tools = [
        _component(store, "tool", str(item), item, created_by_run=created_by_run)
        if not isinstance(item, dict)
        else _component(store, "tool", str(item.get("name", "tool")), item, created_by_run=created_by_run)
        for item in tool_specs
    ]
    agent = {
        "api_version": "hos.agent.v0",
        "kind": "agent",
        "name": agent_name,
        "driver": agent_spec.get("driver", "llm"),
        "loop": loop,
        "policy": policy,
        "skills": skills,
        "tools": tools,
        "memory": memory,
        "subagents": {},
        "created_by_run": created_by_run,
    }
    for field in ("provider", "max_turns", "max_tokens"):
        if field in agent_spec:
            agent[field] = agent_spec[field]
    agent_ref = store.publish(agent)

    environment = store.publish(
        _leaf(
            "environment",
            str(environment_spec.get("name", environment_spec.get("adapter", "arc3-local"))),
            adapter=environment_spec.get("adapter", "arc3-local"),
            **{
                key: value
                for key, value in environment_spec.items()
                if key not in {"name", "adapter"}
            },
            created_by_run=created_by_run,
        )
    )
    evaluator = store.publish(
        _leaf("evaluator", str(spec.get("evaluator", "authoritative-score")), created_by_run=created_by_run)
    )
    ruleset = store.publish(_leaf("ruleset", str(spec.get("ruleset", "default")), created_by_run=created_by_run))
    harness_manifest = {
            "api_version": "hos.harness.v0",
            "schema_version": "hos.harness.v1",
            "kind": "harness",
            "role": spec.get("role", "task"),
            "root_agent": agent_ref,
            "environment": environment,
            "evaluator": evaluator,
            "ruleset": ruleset,
            "spec": record["digest"],
            "compiler": {"name": "hos.spec-compiler", "version": "v1"},
            "component_map": {
                "agent": agent_ref,
                "agent.loop": loop,
                "agent.policy": policy,
                "agent.memory": memory,
                "environment": environment,
                "evaluator": evaluator,
                "ruleset": ruleset,
                **{f"agent.skills.{item['name']}": item["ref"] for item in skills},
                **{f"agent.tools.{index}": ref for index, ref in enumerate(tools)},
            },
            "created_by_run": created_by_run,
        }
    return store.publish(harness_manifest)
