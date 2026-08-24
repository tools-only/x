from __future__ import annotations

import os
from pathlib import Path

from .environments import ArcAgi3Adapter
from .meta import persist_meta_prompt
from .research import read_evolution_state
from .store import InvalidReference, ObjectStore
from .supervisor import Supervisor


def _leaf(kind: str, name: str, **extra: object) -> dict:
    return {"api_version": f"hos.{kind}.v0", "kind": kind, "name": name, **extra}


def _publish_agent(
    store: ObjectStore,
    name: str,
    driver: str,
    skill_content: str,
    *,
    provider: str | None = None,
    meta_prompt_ref: str | None = None,
    max_turns: int = 24,
    max_tokens: int = 2048,
) -> str:
    loop = store.publish(_leaf("loop", "jsonl-runtime"))
    policy = store.publish(_leaf("policy", f"{name}-policy"), {"policy.md": name})
    skill = store.publish(_leaf("skill", "strategy"), {"SKILL.md": skill_content})
    memory = store.publish(_leaf("memory", "empty"))
    tools = [store.publish(_leaf("tool", tool)) for tool in ("component-load", "host-control")]
    manifest = {
        "api_version": "hos.agent.v0",
        "kind": "agent",
        "name": name,
        "driver": driver,
        "loop": loop,
        "policy": policy,
        "skills": [{"name": "strategy", "ref": skill, "load": "always"}],
        "tools": tools,
        "memory": memory,
        "subagents": {},
    }
    if driver == "llm":
        if not provider:
            raise ValueError("llm agent requires a provider profile")
        manifest.update(
            {
                "provider": provider,
                "max_turns": max_turns,
                "max_tokens": max_tokens,
            }
        )
    if meta_prompt_ref is not None:
        manifest["meta_prompt"] = meta_prompt_ref
    return store.publish(manifest)


def _publish_harness(
    store: ObjectStore,
    root: str,
    role: str,
    environment: str,
    environment_options: dict | None = None,
) -> str:
    environment_object = store.publish(
        _leaf("environment", environment, adapter=environment, **(environment_options or {}))
    )
    evaluator = store.publish(_leaf("evaluator", "authoritative-score"))
    ruleset = store.publish(_leaf("ruleset", f"{role}-budget"))
    return store.publish(
        {
            "api_version": "hos.harness.v0",
            "kind": "harness",
            "role": role,
            "root_agent": root,
            "environment": environment_object,
            "evaluator": evaluator,
            "ruleset": ruleset,
            "component_map": {
                "agent": root,
                "environment": environment_object,
                "evaluator": evaluator,
                "ruleset": ruleset,
            },
        }
    )


def _case_for_environment(
    environment: str,
    game_id: str | None = None,
    seed: int = 0,
    task_name: str | None = None,
) -> dict:
    if environment in {"arc3", "arc3-local"}:
        if not game_id:
            raise ValueError(f"{environment} requires an explicit game_id")
        available = ArcAgi3Adapter(local=environment == "arc3-local").discover()
        if not available:
            raise RuntimeError("ARC-AGI-3 returned no available environments")
        matching = [
            item["game_id"]
            for item in available
            if item["game_id"] == game_id or item["game_id"].startswith(f"{game_id}-")
        ]
        if not matching:
            available_ids = ", ".join(str(item["game_id"]) for item in available)
            raise ValueError(f"unknown ARC-AGI-3 game_id {game_id!r}; available: {available_ids}")
        if len(matching) > 1:
            raise ValueError(f"game_id prefix {game_id!r} is ambiguous; use one of: {', '.join(matching)}")
        return {"game_id": matching[0], "seed": seed}
    if environment == "terminal-bench-2":
        selected = task_name or game_id
        if not selected:
            raise ValueError("terminal-bench-2 requires an explicit task_name")
        return {"task_name": selected}
    raise ValueError("environment must be 'arc3', 'arc3-local', or 'terminal-bench-2'")


def bootstrap_task(
    store: ObjectStore,
    environment: str,
    game_id: str | None = None,
    seed: int = 0,
    runtime: str = "llm",
    task_name: str | None = None,
    terminal_dataset: str | None = None,
) -> tuple[str, dict]:
    if runtime != "llm":
        raise ValueError("runtime must be 'llm'")
    task_agent = _publish_agent(
        store,
        "task-agent",
        "llm",
        "Solve the assigned task with authoritative environment feedback.",
        provider=os.environ.get("HOS_TASK_PROVIDER", "task"),
        max_turns=int(os.environ.get("HOS_TASK_MAX_TURNS", "24")),
        max_tokens=int(os.environ.get("HOS_TASK_MAX_TOKENS", "8192")),
    )
    environment_options = None
    if environment == "terminal-bench-2":
        environment_options = {
            "dataset": terminal_dataset or os.environ.get("HARBOR_DATASET", "terminal-bench/terminal-bench-2"),
        }
    task_harness = _publish_harness(store, task_agent, "task", environment, environment_options)
    case = _case_for_environment(environment, game_id, seed, task_name)
    store.set_ref("harness/task/current", task_harness)
    return task_harness, case


def run_task(
    root: Path | str,
    environment: str = "arc3-local",
    harness_ref: str | None = None,
    job: dict | None = None,
    game_id: str | None = None,
    seed: int = 0,
    runtime: str = "llm",
    task_name: str | None = None,
    terminal_dataset: str | None = None,
    knowledge_writes: bool = True,
    live_evolution: bool = False,
) -> dict:
    store = ObjectStore(root)
    if harness_ref is None:
        current = read_evolution_state(store).get("current")
        current_harness = current.get("harness") if isinstance(current, dict) else None
        if isinstance(current_harness, str) and _harness_matches_environment(store, current_harness, environment):
            task_harness = current_harness
            case = _case_for_environment(environment, game_id, seed, task_name)
        else:
            task_harness, case = bootstrap_task(
                store,
                environment,
                game_id,
                seed,
                runtime,
                task_name,
                terminal_dataset,
            )
    else:
        task_harness = harness_ref
        case = _case_for_environment(environment, game_id, seed, task_name)
    task_job = job or {"kind": "task", "case": case}
    start_kwargs = {"knowledge_writes": knowledge_writes}
    if live_evolution:
        start_kwargs["live_evolution"] = True
    task_run = Supervisor(store).start_harness(task_harness, task_job, **start_kwargs)
    return {
        "environment": environment,
        "task_harness": task_harness,
        "job": task_job,
        "task_run": task_run,
    }


def _harness_matches_environment(store: ObjectStore, harness_ref: str, environment: str) -> bool:
    try:
        harness = store.read(harness_ref)["manifest"]
        environment_ref = harness.get("environment")
        if not isinstance(environment_ref, str):
            return False
        environment_manifest = store.read(environment_ref)["manifest"]
        return environment_manifest.get("adapter") == environment
    except (OSError, InvalidReference, ValueError, KeyError):
        return False


def run_demo(
    root: Path | str,
    environment: str = "arc3-local",
    game_id: str | None = None,
    seed: int = 0,
    runtime: str = "llm",
    task_name: str | None = None,
    terminal_dataset: str | None = None,
) -> dict:
    if runtime != "llm":
        raise ValueError("ARC-AGI-3 demo requires --runtime llm")
    return run_autonomous_demo(
        root,
        environment,
        game_id,
        seed,
        task_name,
        terminal_dataset,
    )


def run_autonomous_demo(
    root: Path | str,
    environment: str = "arc3-local",
    game_id: str | None = None,
    seed: int = 0,
    task_name: str | None = None,
    terminal_dataset: str | None = None,
) -> dict:
    """Start one Meta runtime with a task seed; Meta owns the research loop."""
    store = ObjectStore(root)
    case = _case_for_environment(environment, game_id, seed, task_name)
    terminal_options = None
    if environment == "terminal-bench-2":
        terminal_options = {
            "dataset": terminal_dataset or os.environ.get("HARBOR_DATASET", "terminal-bench/terminal-bench-2"),
        }
    meta_prompt_ref = persist_meta_prompt(store)
    meta_agent = _publish_agent(
        store,
        "meta-researcher",
        "llm",
        "Design task-harness experiments, run them, and reason from authoritative feedback.",
        provider=os.environ.get("HOS_META_PROVIDER", "meta"),
        meta_prompt_ref=meta_prompt_ref,
    )
    meta_harness = _publish_harness(store, meta_agent, "meta", environment, terminal_options)
    store.set_ref("harness/meta/current", meta_harness)
    task_spec = {
        "api_version": "hos.harness-spec.v0",
        "kind": "harness-spec",
        "name": "task-seed",
        "role": "task",
        "hypothesis": {
            "phase": "reconnaissance",
            "research_question": "What task structure and failure mode should the next intervention address?",
            "claim": "An explicit observation-and-action strategy increases task completion.",
            "mechanism": "The task agent will use state changes and available actions to select a deliberate probe.",
            "prediction": "The candidate will improve authoritative score over a cold baseline on the same case.",
            "falsifier": "No score improvement or a regression after confirmation.",
            "metric": "authoritative score",
            "controls": ["same case", "same seed", "cold baseline"],
            "expected_delta": "> 0",
            "exit_criteria": "The agent records a concrete task constraint or failure mode with command evidence.",
            "next_if_pass": "Publish a model-building or targeted intervention Spec.",
            "next_if_fail": "Revise the reconnaissance probe and record the missing evidence.",
        },
        "method": {
            "intervention": "Make the observation-and-action strategy explicit.",
            "procedure": ["instantiate the task harness", "run the same case", "observe authoritative feedback"],
            "budget": {"max_agent_runs": 4, "max_episodes": 2},
        },
        "agent": {
            "name": "task-agent",
            "driver": "llm",
            "provider": os.environ.get("HOS_TASK_PROVIDER", "task"),
            "max_turns": 24,
            "max_tokens": 2048,
            "policy": "Complete the assigned case and use authoritative environment feedback.",
            "skills": [
                {
                    "name": "strategy",
                    "content": "Solve the task by observing the environment, testing actions deliberately, and closing the episode.",
                }
            ],
        },
        "environment": {"name": environment, "adapter": environment, **(terminal_options or {})},
        "evaluator": "authoritative-score",
        "ruleset": "default",
        "validation": {"same_case": True, "required_observations": ["authoritative score"]},
    }
    research_job = {
        "kind": "auto-research",
        "objective": "Improve the task harness methodology using evidence from completed runs.",
        "task_spec": task_spec,
        "task_job": {"kind": "task", "case": case},
        "evolution_state": read_evolution_state(store),
    }
    research = Supervisor(store).start_harness(meta_harness, research_job)
    return {
        "runtime": "llm",
        "environment": environment,
        "meta_harness": meta_harness,
        "task_spec": task_spec,
        "research": research,
    }
