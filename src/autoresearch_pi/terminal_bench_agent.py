"""Project-owned Harbor agent that runs Pi with the shared research extension.

Imported by Harbor's own Python environment, not by the normal project CLI.
"""

from __future__ import annotations

import json
import os
import shlex
from pathlib import Path
from typing import Any

from harbor.agents.installed.pi import Pi
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext


class AutoResearchPiAgent(Pi):
    """Pi remains the only agent loop; Harbor retains environment/evaluator ownership."""

    def __init__(self, *args: Any, experiment_variant: str = "treatment", context_compaction: Any = False, **kwargs: Any):
        self.experiment_variant = str(experiment_variant)
        self.context_compaction = str(context_compaction).strip().lower() in {"1", "true", "yes", "enabled"}
        super().__init__(*args, **kwargs)

    @staticmethod
    def name() -> str:
        return "autoresearch-pi"

    async def _upload_extensions(self, environment: BaseEnvironment) -> None:
        project = Path(__file__).resolve().parents[2]
        await self.exec_as_agent(environment, command="mkdir -p /installed-agent/demo/prompts /logs/agent/pi-config")
        for name in (
            "pi_terminal_bench_extension.ts",
            "pi_external_benchmark_research.ts",
            "pi_agent_owned_observation_compaction.ts",
            "pi_task_execution_signals.ts",
            "pi_task_pattern_candidates.ts",
            "pi_task_research_graph.ts",
            "pi_task_local_self_harness.ts",
            "pi_task_local_tools.ts", "pi_task_execution_admission.ts",
            "pi_task_scope.ts", "pi_task_local_context_lifecycle.ts",
            "pi_provider_telemetry.ts", "pi_task_resource_store.ts", "pi_task_validation.ts",
            "prompt_loader.ts",
        ):
            await self._upload_agent_owned_file(
                environment, project / "demo" / name, f"/installed-agent/demo/{name}"
            )
        for name in (
            "auto_research_method.md", "terminal_bench.md",
            "self_harness_opportunity.md", "self_harness_index.md",
        ):
            await self._upload_agent_owned_file(
                environment, project / "demo" / "prompts" / name, f"/installed-agent/demo/prompts/{name}"
            )

    async def run(self, instruction: str, environment: BaseEnvironment, context: AgentContext) -> None:
        if not self.model_name or "/" not in self.model_name:
            raise ValueError("model must be provider/model")
        provider, model = self.model_name.split("/", 1)
        base_url = self._get_env("OPENAI_API_BASE")
        api_key = self._get_env("OPENAI_API_KEY")
        if not base_url or not api_key:
            raise RuntimeError("project environment must define OPENAI_API_BASE and OPENAI_API_KEY")
        await self._upload_extensions(environment)
        models = {"providers": {provider: {
            "baseUrl": base_url, "api": "openai-completions", "apiKey": "$OPENAI_API_KEY",
            "authHeader": True, "models": [{
                "id": model, "name": model, "reasoning": True, "contextWindow": 128000, "maxTokens": 8192,
            }],
        }}}
        await self._upload_config_text(
            environment, content=json.dumps(models),
            remote_path="/logs/agent/pi-config/models.json", filename="models.json",
        )
        env = {
            "OPENAI_API_KEY": api_key,
            "PI_CODING_AGENT_DIR": "/logs/agent/pi-config",
            "PI_AUTORESEARCH_E2E_ROOT": "/logs/agent",
            "PI_AUTORESEARCH_OWNS_TASK": "print",
            "PI_AUTORESEARCH_ROOT": "/installed-agent",
            "PI_AUTORESEARCH_VARIANT": self.experiment_variant,
            "PI_AUTORESEARCH_CONTEXT_COMPACTION": "enabled" if self.context_compaction else "disabled",
        }
        prompt = shlex.quote(self.render_instruction(instruction))
        command = (
            ". ~/.nvm/nvm.sh; "
            "pi --print --mode json --no-session --no-extensions --no-skills "
            "--no-prompt-templates --no-context-files "
            "--extension /installed-agent/demo/pi_terminal_bench_extension.ts "
            f"--provider {shlex.quote(provider)} --model {shlex.quote(model)} {prompt} "
            "2>&1 </dev/null | grep -v '\"type\":\"message_update\"' | stdbuf -oL tee /logs/agent/pi-events.jsonl"
        )
        await self.exec_as_agent(environment, command=command, env=env)

    def populate_context_post_run(self, context: AgentContext) -> None:
        output = self.logs_dir / "pi-events.jsonl"
        if not output.is_file():
            return
        input_tokens = output_tokens = cache_tokens = 0
        for line in output.read_text(encoding="utf-8", errors="replace").splitlines():
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            message = event.get("message") if event.get("type") == "message_end" else None
            if not isinstance(message, dict) or message.get("role") != "assistant":
                continue
            usage = message.get("usage") or {}
            input_tokens += int(usage.get("input", 0) or 0)
            output_tokens += int(usage.get("output", 0) or 0)
            cache_tokens += int(usage.get("cacheRead", 0) or 0)
        context.n_input_tokens = input_tokens + cache_tokens
        context.n_output_tokens = output_tokens
        context.n_cache_tokens = cache_tokens
