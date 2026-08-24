from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Callable

from .config import load_config
from .debug_log import get_logger
from .events import append_jsonl, utc_now
from .meta import META_SYSTEM_PROMPT
from .phase_reports import PHASE_REPORT_PROPERTIES, PHASE_REPORT_REQUIRED, validate_phase_report
from .provider import (
    ProviderError,
    assistant_message,
    conversation_assistant_message,
    create_provider_client,
    finish_reason,
)


LOGGER = get_logger("llm_runtime")

HostResult = Callable[[str, dict], dict]


def _json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _transcript_writer(init: dict) -> Callable[[dict], None]:
    artifact_dir = init.get("artifact_dir")
    path = Path(artifact_dir) / "transcript.jsonl" if isinstance(artifact_dir, str) else None

    def write(record: dict) -> None:
        if path is not None:
            append_jsonl(path, {"at": utc_now(), **record})

    return write


def _tool(name: str, description: str, parameters: dict) -> dict:
    return {
        "type": "function",
        "function": {"name": name, "description": description, "parameters": parameters},
    }


OBJECT = {"type": "object", "additionalProperties": False}


TASK_TOOLS = [
    _tool(
        "phase_report",
        "Record a concise structured summary of the current exploration phase. This is diagnostic evidence and does not set the score.",
        {
            **OBJECT,
            "properties": PHASE_REPORT_PROPERTIES,
            "required": PHASE_REPORT_REQUIRED,
        },
    ),
    _tool(
        "env_open",
        "Start the assigned ARC episode. Call this before every environment interaction.",
        {**OBJECT, "properties": {"case": {"type": "object"}}, "required": ["case"]},
    ),
    _tool(
        "env_observe",
        "Read the latest observation for an open episode.",
        {**OBJECT, "properties": {"episode": {"type": "string"}}, "required": ["episode"]},
    ),
    _tool(
        "env_step",
        "Take one named action in an open episode.",
        {
            **OBJECT,
            "properties": {
                "episode": {"type": "string"},
                "action": {"type": "string"},
                "data": {"type": "object"},
            },
            "required": ["episode", "action"],
        },
    ),
    _tool(
        "env_reset",
        "Reset an open episode when the game requires a new attempt.",
        {**OBJECT, "properties": {"episode": {"type": "string"}}, "required": ["episode"]},
    ),
    _tool(
        "env_close",
        "Close an open episode and record the authoritative score. Always call this before finishing.",
        {**OBJECT, "properties": {"episode": {"type": "string"}}, "required": ["episode"]},
    ),
    _tool(
        "agent_spawn",
        "Start a declared subagent when a bounded critique or delegated task is useful.",
        {
            **OBJECT,
            "properties": {"binding_name": {"type": "string"}, "input": {"type": "object"}},
            "required": ["binding_name", "input"],
        },
    ),
    _tool(
        "experience_submit",
        "Persist a task-general methodology lesson after an episode. Abstract the method; do not copy a game-specific solution.",
        {
            **OBJECT,
            "properties": {
                "experience": {
                    "type": "object",
                    "description": "task-local evidence plus an optional task-agnostic methodology classification with strategy, information states, outcome signals, failure classes, and next strategy",
                }
            },
            "required": ["experience"],
        },
    ),
    _tool("harness_observe", "Record live Task Harness feedback without changing the Harness.", {**OBJECT, "properties": {"event": {"type": "string"}, "payload": {"type": "object"}}, "required": ["event"]}),
    _tool("harness_checkpoint", "Create a live Harness checkpoint and optionally trigger progress or stagnation evolution.", {**OBJECT, "properties": {"boundary": {"type": "string"}, "trigger": {"type": "string", "enum": ["feedback", "progress", "stagnation"]}, "event": {"type": "string"}}, "required": ["boundary", "trigger"]}),
    _tool("process_memory", "Add, edit, or delete task-local memory during execution.", {**OBJECT, "properties": {"action": {"type": "string", "enum": ["add", "edit", "delete"]}, "value": {}}, "required": ["action", "value"]}),
    _tool("process_skill", "Add, edit, or delete a reusable skill during execution.", {**OBJECT, "properties": {"action": {"type": "string", "enum": ["add", "edit", "delete"]}, "value": {}}, "required": ["action", "value"]}),
    _tool("process_subagent", "Add, edit, or delete a bounded subagent during execution.", {**OBJECT, "properties": {"action": {"type": "string", "enum": ["add", "edit", "delete"]}, "value": {}}, "required": ["action", "value"]}),
    _tool("run_skill", "Run a named skill in the bounded Kernel sandbox.", {**OBJECT, "properties": {"id": {"type": "string"}, "input": {}}, "required": ["id"]}),
    _tool("run_subagent", "Run one declared bounded subagent for the current step.", {**OBJECT, "properties": {"id": {"type": "string"}, "task": {}}, "required": ["id"]}),
]


META_TOOLS = [
    _tool(
        "research_state",
        "Read the current promoted Harness and recent Meta evolution rounds from the Kernel.",
        {**OBJECT, "properties": {"limit": {"type": "integer"}}},
    ),
    _tool(
        "research_knowledge",
        "Search persisted task-agent experiences and methodology records before forming a new hypothesis.",
        {
            **OBJECT,
            "properties": {"query": {"type": "string"}, "limit": {"type": "integer"}},
            "required": ["query"],
        },
    ),
    _tool(
        "research_spec_publish",
        "Publish a complete RuntimeSpec describing a proposed experiment through the Kernel research CLI.",
        {
            **OBJECT,
            "properties": {
                "spec": {"type": "object", "description": "A complete harness-spec object."},
            },
            "required": ["spec"],
        },
    ),
    _tool(
        "research_runtime_instantiate",
        "Compile a RuntimeSpec into an immutable RuntimeHarness through the Kernel research CLI.",
        {
            **OBJECT,
            "properties": {"spec": {"type": "string"}},
            "required": ["spec"],
        },
    ),
    _tool(
        "research_runtime_run",
        "Execute an instantiated RuntimeHarness through the Kernel research CLI.",
        {
            **OBJECT,
            "properties": {"harness": {"type": "string"}, "job": {"type": "object"}},
            "required": ["harness", "job"],
        },
    ),
    _tool(
        "research_run_observe",
        "Read a completed RuntimeRun evidence summary through the Kernel research CLI.",
        {**OBJECT, "properties": {"run": {"type": "string"}}, "required": ["run"]},
    ),
    _tool(
        "research_decision_record",
        "Record your evidence-based assessment of a RuntimeSpec through the Kernel research CLI.",
        {
            **OBJECT,
            "properties": {"spec": {"type": "string"}, "decision": {"type": "object"}},
            "required": ["spec", "decision"],
        },
    ),
]


_RESEARCH_TOOL_COMMANDS = {
    "research_state": "state",
    "research_knowledge": "knowledge",
    "research_spec_publish": "spec",
    "research_runtime_instantiate": "instantiate",
    "research_runtime_run": "run",
    "research_run_observe": "observe",
    "research_decision_record": "decision",
}


def _read_tool_arguments(tool_call: dict) -> dict:
    function = tool_call.get("function", {})
    value = function.get("arguments", "{}")
    if isinstance(value, str):
        parsed = json.loads(value)
    elif isinstance(value, dict):
        parsed = value
    else:
        raise ValueError("tool arguments must be a JSON object")
    if not isinstance(parsed, dict):
        raise ValueError("tool arguments must decode to an object")
    return parsed


def _map_tool(name: str, arguments: dict) -> tuple[str, dict]:
    mapping = {
        "env_open": "env.open",
        "env_observe": "env.observe",
        "env_step": "env.step",
        "env_reset": "env.reset",
        "env_close": "env.close",
        "agent_spawn": "agent.spawn",
        "experience_submit": "experience.submit",
        "harness_observe": "harness.observe",
        "harness_checkpoint": "harness.checkpoint",
        "process_memory": "harness.process_memory",
        "process_skill": "harness.process_skill",
        "process_subagent": "harness.process_subagent",
        "run_skill": "harness.run_skill",
    }
    if name == "run_subagent":
        return "agent.spawn", {"binding_name": arguments.get("id"), "input": arguments.get("task", {})}
    if name not in mapping:
        raise ValueError(f"unsupported model tool: {name}")
    return mapping[name], arguments


def _run_research_cli(init: dict, name: str, arguments: dict) -> dict:
    command_name = _RESEARCH_TOOL_COMMANDS.get(name)
    control_plane = init.get("control_plane")
    if command_name is None or not isinstance(control_plane, dict):
        raise RuntimeError("research CLI capability is unavailable")
    root = control_plane.get("root")
    parent_run = control_plane.get("parent_run")
    agent_run = init.get("run_id")
    artifact_dir = init.get("artifact_dir")
    if not all(isinstance(value, str) and value for value in (root, parent_run, agent_run, artifact_dir)):
        raise RuntimeError("research CLI capability has invalid runtime context")
    command = [sys.executable, "-m", "hos.cli", "research", command_name, "--root", root, "--parent-run", parent_run]
    request_dir = Path(artifact_dir) / "research-requests"
    request_dir.mkdir(parents=True, exist_ok=True)
    if command_name == "spec":
        request = request_dir / f"spec-{len(list(request_dir.glob('spec-*.json')))}.json"
        request.write_text(json.dumps(arguments["spec"], ensure_ascii=False), encoding="utf-8")
        command.extend(["--agent-run", agent_run, "--input", str(request)])
    elif command_name == "instantiate":
        command.extend(["--agent-run", agent_run, "--spec", str(arguments["spec"])])
    elif command_name == "run":
        request = request_dir / f"run-{len(list(request_dir.glob('run-*.json')))}.json"
        request.write_text(json.dumps(arguments["job"], ensure_ascii=False), encoding="utf-8")
        command.extend(["--harness", str(arguments["harness"]), "--job", str(request)])
    elif command_name == "observe":
        command.extend(["--run", str(arguments["run"])])
    elif command_name == "decision":
        request = request_dir / f"decision-{len(list(request_dir.glob('decision-*.json')))}.json"
        request.write_text(json.dumps(arguments["decision"], ensure_ascii=False), encoding="utf-8")
        command.extend(["--agent-run", agent_run, "--spec", str(arguments["spec"]), "--input", str(request)])
    elif command_name == "state":
        command.extend(["--limit", str(int(arguments.get("limit", 8)))])
    else:
        command.extend(["--query", str(arguments["query"]), "--limit", str(int(arguments.get("limit", 8)))])
    completed = subprocess.run(command, capture_output=True, text=True, check=False)
    if completed.returncode != 0:
        raise RuntimeError(f"research CLI failed: {completed.stderr[-1000:]}")
    try:
        result = json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError("research CLI returned invalid JSON") from exc
    if not isinstance(result, dict):
        raise RuntimeError("research CLI result must be an object")
    return result


def _system_prompt(init: dict, skill_context: list[dict]) -> str:
    agent = init["agent"]
    job = init.get("input", {})
    harness_role = init.get("harness_role", "task")
    policy = str(agent.get("runtime_context", {}).get("policy", ""))
    skills = "\n\n".join(f"## Skill: {item['name']}\n{item['content']}" for item in skill_context)
    if harness_role == "meta":
        objective = str(agent.get("runtime_context", {}).get("meta_prompt", "")) or META_SYSTEM_PROMPT
    else:
        objective = (
            "You are an ARC task-solving agent. Start the assigned case with env_open, inspect observations, take only actions returned "
                "by the environment, and call env_close before finishing. The score returned by env_close is authoritative. "
            "Use iterative observations when useful; do not claim an outcome without completing the episode. "
            "When you use phase_report, keep task-specific evidence in its raw fields and classify only the reusable method "
            "through the required controlled methodology labels. "
                "After closing, submit one task-general experience with experience_submit when you can state an observation pattern, "
                "action rule, failure mode, scope, and confidence. If live Harness tools are available, record action-level feedback with "
                "harness_observe, mutate task-local memory/skills/subagents with process_memory/process_skill/process_subagent, run reusable "
                "skills with run_skill, and call harness_checkpoint on progress or repeated stagnation."
        )
    meta_schema = (
        "RuntimeSpec schema is defined by the Meta protocol above. hypothesis must be an object with claim, mechanism, prediction, falsifier, metric; method must contain procedure; validation is required. "
        "Publish the full object with research_spec_publish; do not send patches."
        if harness_role == "meta"
        else ""
    )
    return "\n\n".join(
        part
        for part in (
            objective,
            f"Agent name: {agent.get('name', 'agent')}",
            f"Job: {_json(job)}",
            meta_schema,
            f"Policy:\n{policy}" if policy else "",
            f"Loaded skills:\n{skills}" if skills else "",
        )
        if part
    )


def _record_outcome(
    name: str,
    arguments: dict,
    result: dict,
    state: dict,
) -> None:
    if name == "env_open" and isinstance(result.get("episode"), str):
        state["open_episodes"].add(result["episode"])
    elif name == "env_close":
        state["open_episodes"].discard(arguments.get("episode"))
        state["episodes"].append(result)
    elif name == "research_spec_publish":
        state["specs"].append(result)
    elif name == "research_runtime_instantiate":
        state["harnesses"].append(result)
    elif name == "research_runtime_run":
        harness = arguments.get("harness")
        run_id = result.get("run_id")
        if isinstance(harness, str) and isinstance(run_id, str):
            state["harness_runs"][harness] = run_id
        state["runs"].append(result)
    elif name == "research_run_observe":
        state["observations"][arguments.get("run")] = result
        state["feedback"].append(result)
    elif name == "research_decision_record":
        state["decisions"].append(result)
    elif name == "experience_submit":
        state["experiences"].append(result)
    elif name == "phase_report":
        state["phase_reports"].append(arguments)


def _live_feedback(name: str, result: dict, state: dict, host_result: HostResult) -> None:
    """Feed action-level evidence to an enabled live Harness session."""
    if name not in {"env_step", "env_reset", "env_close"}:
        return
    try:
        host_result("harness.observe", {"event": name, "result": result})
        score = result.get("score") if isinstance(result, dict) else None
        if isinstance(score, (int, float)) and float(score) > float(state.get("last_score", 0)):
            state["last_score"] = float(score)
            host_result("harness.checkpoint", {"boundary": "action", "trigger": "progress", "event": name})
            state["steps_since_progress"] = 0
        elif name == "env_step":
            state["steps_since_progress"] = int(state.get("steps_since_progress", 0)) + 1
            if state["steps_since_progress"] >= 8:
                host_result("harness.checkpoint", {"boundary": "action-window", "trigger": "stagnation", "event": name})
                state["steps_since_progress"] = 0
    except Exception as exc:
        LOGGER.debug("live harness feedback unavailable: %s", exc)


def _result(state: dict, final_message: str, provider_name: str) -> dict:
    return {
        "provider": provider_name,
        "tool_calls": state["tool_calls"],
        "final_message": final_message,
        "episodes": state["episodes"],
        "specs": state["specs"],
        "harnesses": state["harnesses"],
        "runs": state["runs"],
        "feedback": state["feedback"],
        "provider_usage": state["provider_usage"],
        "experiences": state["experiences"],
        "decisions": state["decisions"],
        "phase_reports": state["phase_reports"],
    }


def run_llm_agent(init: dict, host_result: HostResult) -> dict:
    agent = init["agent"]
    provider_name = agent.get("provider")
    if not isinstance(provider_name, str) or not provider_name:
        raise RuntimeError("llm agent requires a provider profile")
    provider = load_config().resolve_provider(provider_name, require_secret=True)
    client = create_provider_client(provider)
    max_turns = int(agent.get("max_turns", 12))
    if max_turns <= 0:
        raise RuntimeError("llm agent max_turns must be positive")
    skill_context = [
        {"name": binding["name"], "content": host_result("component.load", {"kind": "skill", "name": binding["name"]})["content"]}
        for binding in agent.get("skills", [])
        if isinstance(binding, dict) and isinstance(binding.get("name"), str)
    ]
    tools = META_TOOLS if init.get("harness_role") == "meta" else TASK_TOOLS
    messages: list[dict] = [{"role": "system", "content": _system_prompt(init, skill_context)}]
    state = {
        "harness_runs": {},
        "episodes": [],
        "specs": [],
        "harnesses": [],
        "runs": [],
        "feedback": [],
        "observations": {},
        "open_episodes": set(),
        "tool_calls": 0,
        "provider_usage": [],
        "experiences": [],
        "decisions": [],
        "phase_reports": [],
        "last_score": 0.0,
        "steps_since_progress": 0,
    }
    write_transcript = _transcript_writer(init)
    final_message = ""
    completed = False
    try:
        for turn in range(1, max_turns + 1):
            LOGGER.info("provider.chat.start run=%s provider=%s turn=%s", init.get("run_id"), provider.name, turn)
            write_transcript(
                {
                    "type": "provider.request",
                    "turn": turn,
                    "provider": provider.name,
                    "model": provider.model,
                    "messages": messages,
                    "tools": tools,
                    "max_tokens": int(agent.get("max_tokens", 2048)),
                }
            )
            response = client.chat(messages, tools=tools, max_tokens=int(agent.get("max_tokens", 2048)))
            usage = response.get("usage")
            if isinstance(usage, dict):
                state["provider_usage"].append(usage)
            write_transcript({"type": "provider.response", "turn": turn, "response": response})
            message = assistant_message(response)
            content = message.get("content")
            final_message = content if isinstance(content, str) else ""
            tool_calls = message.get("tool_calls") or []
            if not isinstance(tool_calls, list):
                raise ProviderError("provider tool_calls must be an array")
            messages.append(conversation_assistant_message(response))
            LOGGER.info(
                "provider.chat.finish run=%s provider=%s turn=%s tool_calls=%s",
                init.get("run_id"),
                provider.name,
                turn,
                len(tool_calls),
            )
            if not tool_calls:
                reason = finish_reason(response)
                if reason == "length":
                    raise RuntimeError("provider output was truncated before agent completion")
                if not final_message.strip():
                    raise RuntimeError("llm agent finished without a non-empty final response")
                completed = True
                break
            for index, tool_call in enumerate(tool_calls):
                call_id = tool_call.get("id") or f"tool-{turn}-{index}"
                function = tool_call.get("function", {})
                name = function.get("name")
                try:
                    if not isinstance(name, str):
                        raise ValueError("tool call has no function name")
                    arguments = _read_tool_arguments(tool_call)
                    if name == "phase_report":
                        validate_phase_report(arguments)
                        result = {"recorded": True, "phase": arguments.get("phase")}
                    elif name in _RESEARCH_TOOL_COMMANDS:
                        result = _run_research_cli(init, name, arguments)
                    else:
                        method, host_arguments = _map_tool(name, arguments)
                        result = host_result(method, host_arguments)
                    _record_outcome(name, arguments, result, state)
                    _live_feedback(name, result, state, host_result)
                    tool_content = _json({"ok": True, "result": result})
                    write_transcript(
                        {
                            "type": "tool.result",
                            "turn": turn,
                            "tool_call_id": call_id,
                            "name": name,
                            "arguments": arguments,
                            "result": result,
                        }
                    )
                except Exception as exc:
                    LOGGER.warning("model.tool.failed run=%s tool=%s error=%s", init.get("run_id"), name, exc)
                    tool_content = _json({"ok": False, "error": {"type": type(exc).__name__, "message": str(exc)}})
                    write_transcript(
                        {
                            "type": "tool.error",
                            "turn": turn,
                            "tool_call_id": call_id,
                            "name": name,
                            "arguments": arguments if isinstance(arguments, dict) else {},
                            "error": {"type": type(exc).__name__, "message": str(exc)},
                        }
                    )
                state["tool_calls"] += 1
                messages.append({"role": "tool", "tool_call_id": call_id, "content": tool_content})
        if not completed:
            raise RuntimeError(f"llm agent exhausted max_turns={max_turns}")
    finally:
        for episode in list(state["open_episodes"]):
            try:
                result = host_result("env.close", {"episode": episode})
                state["episodes"].append(result)
                state["open_episodes"].discard(episode)
                LOGGER.warning("runtime.closed_unfinished_episode run=%s episode=%s", init.get("run_id"), episode)
            except Exception as exc:
                LOGGER.error("runtime.cleanup_episode_failed run=%s episode=%s error=%s", init.get("run_id"), episode, exc)
    if init.get("harness_role") != "meta" and not state["episodes"]:
        raise RuntimeError("llm task agent finished without completing an environment episode")
    if init.get("harness_role") != "meta" and state["tool_calls"] == 0:
        raise RuntimeError("llm task agent finished without executing task tools")
    return _result(state, final_message, provider.name)
