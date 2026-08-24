from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from harbor.agents.base import BaseAgent
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext

from .config import load_config
from .controllers.self_evolve.continual_harness.controller import ContinualHarnessController
from .events import write_json
from .mutations import HarnessMutationKernel
from .store import ObjectStore
from .resolver import resolve_harness
from .phase_reports import PHASE_REPORT_PROPERTIES, PHASE_REPORT_REQUIRED, validate_phase_report
from .provider import (
    assistant_message,
    conversation_assistant_message,
    create_provider_client,
    finish_reason,
)


_OBJECT = {"type": "object", "additionalProperties": False}


def _tool(name: str, description: str, parameters: dict) -> dict:
    return {
        "type": "function",
        "function": {"name": name, "description": description, "parameters": parameters},
    }


_TERMINAL_TOOLS = [
    _tool(
        "phase_report",
        "Record a structured exploration-phase summary. Diagnostic evidence only; it does not affect the verifier score.",
        {
            **_OBJECT,
            "properties": PHASE_REPORT_PROPERTIES,
            "required": PHASE_REPORT_REQUIRED,
        },
    ),
    _tool(
        "terminal_exec",
        "Run a shell command in the assigned Terminal-Bench sandbox and inspect its output.",
        {
            **_OBJECT,
            "properties": {
                "command": {"type": "string"},
                "cwd": {"type": "string"},
                "timeout_seconds": {"type": "integer", "minimum": 1, "maximum": 600},
            },
            "required": ["command"],
        },
    ),
    _tool("harness_observe", "Record live feedback for the current Harness.", {**_OBJECT, "properties": {"event": {"type": "string"}, "payload": {"type": "object"}}, "required": ["event"]}),
    _tool("harness_checkpoint", "Checkpoint the live Harness and trigger progress or stagnation evolution.", {**_OBJECT, "properties": {"boundary": {"type": "string"}, "trigger": {"type": "string", "enum": ["feedback", "progress", "stagnation"]}, "event": {"type": "string"}}, "required": ["boundary", "trigger"]}),
    _tool("process_memory", "Mutate task-local memory during execution.", {**_OBJECT, "properties": {"action": {"type": "string", "enum": ["add", "edit", "delete"]}, "value": {}}, "required": ["action", "value"]}),
    _tool("process_skill", "Mutate task-local skills during execution.", {**_OBJECT, "properties": {"action": {"type": "string", "enum": ["add", "edit", "delete"]}, "value": {}}, "required": ["action", "value"]}),
    _tool("process_subagent", "Mutate task-local subagents during execution.", {**_OBJECT, "properties": {"action": {"type": "string", "enum": ["add", "edit", "delete"]}, "value": {}}, "required": ["action", "value"]}),
    _tool("run_skill", "Run a bounded skill from the current Harness.", {**_OBJECT, "properties": {"id": {"type": "string"}, "input": {}}, "required": ["id"]}),
]


def _bridge_config() -> dict:
    config_file = os.environ.get("HOS_HARBOR_BRIDGE_CONFIG_FILE")
    if config_file:
        raw = Path(config_file).read_text(encoding="utf-8")
    else:
        raw = os.environ.get("HOS_HARBOR_BRIDGE_CONFIG")
    if not raw:
        raise RuntimeError("HOS_HARBOR_BRIDGE_CONFIG_FILE is required for the HOS Harbor bridge")
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError("HOS_HARBOR_BRIDGE_CONFIG must be JSON") from exc
    if not isinstance(value, dict) or not isinstance(value.get("agent"), dict):
        raise RuntimeError("HOS_HARBOR_BRIDGE_CONFIG requires an agent object")
    return value


def _arguments(tool_call: dict) -> dict:
    value = tool_call.get("function", {}).get("arguments", "{}")
    value = json.loads(value) if isinstance(value, str) else value
    if not isinstance(value, dict):
        raise ValueError("terminal tool arguments must be an object")
    return value


def _message_content(result: Any) -> str:
    return json.dumps(result, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _live_run_id(logs_dir: str | Path) -> str:
    """Return a stable audit ID without assuming Harbor context extensions."""
    return f"harbor-{Path(logs_dir).parent.name}"


class _LiveBridge:
    def __init__(self, bridge: dict, provider_name: str):
        self.enabled = bridge.get("live_evolution") is True
        self.root = ObjectStore(bridge["root"]) if self.enabled else None
        self.harness = bridge.get("harness_ref") if self.enabled else None
        self.commit_ref = bridge.get("commit_ref") if self.enabled else None
        self.state_path = Path(bridge["live_state_path"]) if self.enabled and isinstance(bridge.get("live_state_path"), str) else None
        self.controller = ContinualHarnessController(root=self.root.root, provider=provider_name) if self.enabled and self.root else None
        if self.enabled:
            self._write_state()

    def _write_state(self) -> None:
        if self.state_path is not None:
            write_json(self.state_path, {"harness": self.harness, "live_evolution": self.enabled})

    def mutate(self, component: str, action: str, value: Any, run_id: str) -> dict:
        if not self.enabled or not self.root or not isinstance(self.harness, str) or not isinstance(self.commit_ref, str):
            return {"accepted": False, "error": "live_evolution_disabled"}
        proposal = {"kind": "harness-mutation", "base_harness": self.harness, "scope": "task-local", "operations": [{"component": component, "action": action, "value": value}]}
        mutation = HarnessMutationKernel(self.root).publish(proposal, created_by_run=run_id)
        if not mutation.accepted:
            return {"accepted": False, "errors": list(mutation.errors)}
        self.harness = HarnessMutationKernel(self.root).commit(mutation, ref=self.commit_ref, expected_base=self.harness)
        if self.controller is not None:
            self.controller.record_live_operations(proposal["operations"])
        self._write_state()
        return {"accepted": True, "harness": self.harness, "mutation": mutation.generation}

    def checkpoint(self, boundary: str, trigger: str, event: str, run_id: str) -> dict:
        if not self.enabled or not self.controller or not isinstance(self.harness, str) or not isinstance(self.commit_ref, str):
            return {"checkpoint": False, "error": "live_evolution_disabled"}
        result = self.controller.record_checkpoint({"event": event, "agent_run_id": run_id}, trigger=trigger, harness=self.harness, commit_ref=self.commit_ref)
        if isinstance(result.get("committed_harness"), str):
            self.harness = result["committed_harness"]
            self._write_state()
        return {"boundary": boundary, **result}


class HosTaskAgent(BaseAgent):
    """Harbor adapter that executes the locked HOS task-agent configuration."""

    SUPPORTS_WINDOWS = True

    @staticmethod
    def name() -> str:
        return "hos-task-agent"

    def version(self) -> str:
        return "1"

    async def setup(self, environment: BaseEnvironment) -> None:
        return None

    async def run(
        self,
        instruction: str,
        environment: BaseEnvironment,
        context: AgentContext,
    ) -> None:
        bridge = _bridge_config()
        agent = bridge["agent"]
        provider_name = agent.get("provider")
        if not isinstance(provider_name, str) or not provider_name:
            raise RuntimeError("Terminal-Bench task agent requires a HOS provider profile")
        config_path = bridge.get("config_path")
        provider = load_config(config_path).resolve_provider(provider_name, require_secret=True)
        client = create_provider_client(provider)
        live = _LiveBridge(bridge, provider_name)
        max_turns = int(agent.get("max_turns", 12))
        max_tokens = int(agent.get("max_tokens", 2048))
        policy = str(agent.get("runtime_context", {}).get("policy", ""))
        skills = bridge.get("skills", [])
        skill_text = "\n\n".join(
            f"## Skill: {item['name']}\n{item['content']}"
            for item in skills
            if isinstance(item, dict) and isinstance(item.get("name"), str) and isinstance(item.get("content"), str)
        )
        messages: list[dict] = [
            {
                "role": "system",
                "content": "\n\n".join(
                    part
                    for part in (
                        "You are a Terminal-Bench 2 task-solving agent. Work only through terminal_exec in the assigned sandbox. Explore autonomously: choose the inspection order, commands, and repair path from task evidence. Keep probes focused; inspect or query files rather than reproducing their contents or exhaustively listing possibilities in reasoning. Make the required changes and run focused checks before finishing. At each meaningful exploration boundary, use phase_report to record raw local observations plus its required methodology labels. If live Harness tools are available, use harness_observe for action feedback, process_memory/process_skill/process_subagent for task-local updates, run_skill for reusable bounded procedures, and harness_checkpoint on progress or repeated stagnation. Keep commands, paths, source details, and free-text task facts in the raw fields; use only the controlled methodology enums for anything intended to guide Meta. Harbor's verifier is authoritative; do not claim a score yourself.",
                        f"Task instruction:\n{instruction}",
                        f"Policy:\n{policy}" if policy else "",
                        f"Loaded skills:\n{skill_text}" if skill_text else "",
                    )
                    if part
                ),
            }
        ]
        transcript = Path(self.logs_dir) / "hos-transcript.jsonl"
        live_run_id = _live_run_id(self.logs_dir)
        usage: list[dict] = []
        tool_calls = 0
        final_message = ""
        phase_reports: list[dict] = []
        failed_commands = 0
        for turn in range(1, max_turns + 1):
            response = client.chat(messages, tools=_TERMINAL_TOOLS, max_tokens=max_tokens)
            response_usage = response.get("usage")
            if isinstance(response_usage, dict):
                usage.append(response_usage)
            message = assistant_message(response)
            content = message.get("content")
            final_message = content if isinstance(content, str) else ""
            calls = message.get("tool_calls") or []
            if not isinstance(calls, list):
                raise RuntimeError("provider tool_calls must be an array")
            with transcript.open("a", encoding="utf-8") as handle:
                handle.write(_message_content({"turn": turn, "response": response}) + "\n")
            messages.append(conversation_assistant_message(response))
            if not calls:
                reason = finish_reason(response)
                if reason == "length":
                    raise RuntimeError("provider output was truncated before task completion")
                if not final_message.strip():
                    raise RuntimeError("task agent finished without a non-empty final response")
                if tool_calls == 0:
                    raise RuntimeError("task agent finished without executing terminal commands")
                context.metadata = {
                    "completed": True,
                    "finish_reason": reason,
                    "provider": provider.name,
                    "tool_calls": tool_calls,
                    "final_message": final_message,
                    "phase_reports": phase_reports,
                    "provider_usage": usage,
                    "final_harness": live.harness,
                    "live_evolution": live.enabled,
                }
                return
            for index, call in enumerate(calls):
                call_id = call.get("id") or f"tool-{turn}-{index}"
                function = call.get("function", {})
                try:
                    function_name = function.get("name")
                    arguments = _arguments(call)
                    if function_name == "phase_report":
                        validate_phase_report(arguments)
                        phase_reports.append(arguments)
                        with (Path(self.logs_dir) / "phase-reports.jsonl").open("a", encoding="utf-8") as handle:
                            handle.write(_message_content(arguments) + "\n")
                        output = {"ok": True, "recorded": True, "phase": arguments.get("phase")}
                    elif function_name == "harness_observe":
                        output = live.checkpoint("observe", "feedback", str(arguments.get("event", "feedback")), live_run_id)
                    elif function_name == "harness_checkpoint":
                        output = live.checkpoint(str(arguments.get("boundary", "step")), str(arguments.get("trigger", "feedback")), str(arguments.get("event", "feedback")), live_run_id)
                    elif function_name in {"process_memory", "process_skill", "process_subagent"}:
                        component = {"process_memory": "memory", "process_skill": "skill", "process_subagent": "subagent"}[function_name]
                        output = live.mutate(component, str(arguments.get("action", "")), arguments.get("value"), live_run_id)
                    elif function_name == "run_skill":
                        output = {"ok": True, "executed": False, "reason": "Harbor bridge keeps skill execution inside the task sandbox"}
                    elif function_name != "terminal_exec":
                        raise ValueError("unsupported terminal tool")
                    else:
                        command = arguments.get("command")
                        if not isinstance(command, str) or not command:
                            raise ValueError("terminal_exec requires command")
                        result = await environment.exec(
                            command,
                            cwd=arguments.get("cwd"),
                            timeout_sec=int(arguments.get("timeout_seconds", 120)),
                        )
                        output = {"ok": result.return_code == 0, "return_code": result.return_code,
                                  "stdout": (result.stdout or "")[-12000:], "stderr": (result.stderr or "")[-12000:]}
                        if live.enabled:
                            live.checkpoint("command", "feedback", "terminal_exec", live_run_id)
                            failed_commands = failed_commands + 1 if result.return_code != 0 else 0
                            if failed_commands >= 8:
                                output["live_checkpoint"] = live.checkpoint("command-window", "stagnation", "terminal_exec", live_run_id)
                                failed_commands = 0
                except Exception as exc:
                    output = {"ok": False, "error": {"type": type(exc).__name__, "message": str(exc)}}
                messages.append({"role": "tool", "tool_call_id": call_id, "content": _message_content(output)})
                tool_calls += 1
        raise RuntimeError(f"HOS task agent exhausted max_turns={max_turns}")
