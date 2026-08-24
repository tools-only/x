from hos.store import ObjectStore


def leaf(kind: str, name: str, **extra: object) -> dict:
    return {"api_version": f"hos.{kind}.v0", "kind": kind, "name": name, **extra}


def publish_agent(
    store: ObjectStore,
    name: str,
    driver: str,
    *,
    subagents: dict | None = None,
    skill_text: str = "baseline",
    provider: str | None = None,
) -> str:
    loop = store.publish(leaf("loop", "jsonl-runtime"))
    policy = store.publish(leaf("policy", f"{name}-policy"), {"policy.md": name})
    skill = store.publish(leaf("skill", "strategy"), {"SKILL.md": skill_text})
    memory = store.publish(leaf("memory", "empty"))
    spawn_tool = store.publish(leaf("tool", "agent-spawn"))
    manifest = {
            "api_version": "hos.agent.v0",
            "kind": "agent",
            "name": name,
            "driver": driver,
            "loop": loop,
            "policy": policy,
            "skills": [{"name": "strategy", "ref": skill, "load": "always"}],
            "tools": [spawn_tool],
            "memory": memory,
            "subagents": subagents or {},
        }
    if provider is not None:
        manifest.update({"provider": provider, "max_turns": 6, "max_tokens": 128})
    return store.publish(manifest)


def publish_harness(store: ObjectStore, root_agent: str, *, role: str = "task") -> str:
    environment = store.publish(leaf("environment", "arc3-local", adapter="arc3-local"))
    evaluator = store.publish(leaf("evaluator", "score"))
    ruleset = store.publish(leaf("ruleset", "budget"))
    return store.publish(
        {
            "api_version": "hos.harness.v0",
            "kind": "harness",
            "role": role,
            "root_agent": root_agent,
            "environment": environment,
            "evaluator": evaluator,
            "ruleset": ruleset,
        }
    )
