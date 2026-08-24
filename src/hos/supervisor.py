from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path

from .config import load_config
from .debug_log import get_logger
from .events import EventLog, append_jsonl, utc_now, write_json
from .environments import adapter_from_manifest
from .harness_runtime import HarnessSession, KernelHarnessRuntime
from .meta import KnowledgeLibrary
from .controllers.self_evolve.continual_harness.controller import ContinualHarnessController
from .mutations import HarnessMutationKernel
from .resolver import resolve_harness
from .store import ObjectStore


LOGGER = get_logger("supervisor")


class Supervisor:
    def __init__(self, store: ObjectStore):
        self.store = store
        self._environment_factory = adapter_from_manifest
        self.runs_dir = store.root / "runs"
        self.runs_dir.mkdir(parents=True, exist_ok=True)
        self._harness_dir: Path | None = None
        self._lock: dict | None = None
        self._budget: dict = {}
        self._usage = {"agent_runs": 0, "episode_runs": 0, "host_calls": 0}
        self._environment = None
        self._episodes: dict[str, dict] = {}
        self._episode_results: list[dict] = []
        self._control_plane: dict | None = None
        self._knowledge_writes = True
        self._live_enabled = False
        self._live_harness_ref: str | None = None
        self._live_commit_ref: str | None = None
        self._live_runtime: KernelHarnessRuntime | None = None
        self._live_session: HarnessSession | None = None
        self._live_controller: ContinualHarnessController | None = None

    @staticmethod
    def _run_id(kind: str) -> str:
        return f"{kind}-{uuid.uuid4().hex[:16]}"

    def _run_dir(self, run_id: str) -> Path:
        directory = self.runs_dir / run_id
        directory.mkdir(parents=True, exist_ok=False)
        return directory

    def start_harness(
        self,
        harness_ref: str,
        job: dict,
        parent_run: str | None = None,
        budget: dict | None = None,
        *,
        knowledge_writes: bool = True,
        live_evolution: bool = False,
    ) -> dict:
        LOGGER.info(
            "harness.resolve ref=%s parent=%s job_keys=%s",
            harness_ref,
            parent_run or "-",
            sorted(job),
        )
        self._lock = resolve_harness(self.store, harness_ref)
        self._budget = {"max_agent_runs": 32, **(budget or {})}
        self._usage = {"agent_runs": 0, "episode_runs": 0, "host_calls": 0}
        self._episodes = {}
        self._episode_results = []
        self._control_plane = None
        self._knowledge_writes = knowledge_writes
        self._live_enabled = live_evolution and self._lock["harness_manifest"].get("role") == "task"
        self._environment = self._environment_factory(self._lock["objects"]["environment"])
        harness_run_id = self._run_id("harness")
        self._harness_dir = self._run_dir(harness_run_id)
        self._live_harness_ref = self._lock["harness"]
        self._live_commit_ref = f"ref:harness/task/live/{harness_run_id}"
        if self._live_enabled:
            self.store.set_ref(f"harness/task/live/{harness_run_id}", self._lock["harness"])
            self._live_runtime = KernelHarnessRuntime(self.store.root)
            self._live_session = self._live_runtime.open(self._lock["harness"], session_id=harness_run_id)
            self._live_controller = None if self._uses_terminal_bench() else ContinualHarnessController(root=self.store.root)
        configure_task_agent = getattr(self._environment, "configure_task_agent", None)
        if callable(configure_task_agent) and self._lock["harness_manifest"].get("role") == "task":
            configure_task_agent(self._terminal_bridge_config("root_agent"))
        if self._lock["harness_manifest"].get("role") == "meta":
            self._control_plane = {"root": str(self.store.root), "parent_run": harness_run_id}
        LOGGER.info(
            "harness.loaded run=%s digest=%s role=%s environment=%s resolved_objects=%d",
            harness_run_id,
            self._lock["harness"],
            self._lock["harness_manifest"].get("role", "-"),
            self._lock["objects"]["environment"].get("adapter", "-"),
            len(self._lock["resolved_objects"]),
        )
        for object_path, digest in sorted(self._lock["resolved_objects"].items()):
            manifest = self._lock["objects"].get(object_path, {})
            LOGGER.debug(
                "harness.module.loaded run=%s path=%s kind=%s name=%s digest=%s",
                harness_run_id,
                object_path,
                manifest.get("kind", "-"),
                manifest.get("name", "-"),
                digest,
            )
        events = EventLog(self._harness_dir / "events.jsonl")
        (self._harness_dir / "kind").write_text("harness\n", encoding="utf-8")
        write_json(self._harness_dir / "harness.lock.json", self._lock)
        write_json(self._harness_dir / "job.json", job)
        write_json(self._harness_dir / "parent.json", {"harness_run": parent_run})
        write_json(
            self._harness_dir / "execution-policy.json",
            {"knowledge_writes": knowledge_writes},
        )
        write_json(self._harness_dir / "status.json", {"state": "running", "started_at": utc_now()})
        events.append("harness.started", harness=self._lock["harness"])

        try:
            root_result = self._run_agent("root_agent", job, parent_agent=None, role="root")
            state = "succeeded"
            events.append("harness.finished", state=state)
            LOGGER.info(
                "harness.finished run=%s state=%s usage=%s",
                harness_run_id,
                state,
                self._usage,
            )
        except Exception as exc:
            root_result = {"error": {"type": type(exc).__name__, "message": str(exc)}}
            state = "failed"
            events.append("harness.failed", error=root_result["error"])
            LOGGER.exception("harness.failed run=%s error=%s", harness_run_id, exc)

        write_json(self._harness_dir / "usage.json", self._usage)
        write_json(self._harness_dir / "result.json", root_result)
        write_json(
            self._harness_dir / "status.json",
            {"state": state, "started_at": read_started(self._harness_dir), "finished_at": utc_now()},
        )
        is_task_harness = self._lock["harness_manifest"].get("role") == "task"
        authoritative_metrics = {
            "score": sum(float(item.get("score", 0.0)) for item in self._episode_results),
            "episode_runs": len(self._episode_results),
            "evaluable": (
                (not is_task_harness or bool(self._episode_results))
                and all(item.get("evaluable", True) is not False for item in self._episode_results)
            ),
        }
        failure_reason = None
        for item in self._episode_results:
            if isinstance(item.get("failure_reason"), dict):
                failure_reason = item["failure_reason"]
                break
        LOGGER.info(
            "harness.result run=%s state=%s metrics=%s failure_reason=%s usage=%s",
            harness_run_id,
            state,
            authoritative_metrics,
            failure_reason,
            self._usage,
        )
        if failure_reason is not None:
            authoritative_metrics["failure_reason"] = failure_reason
        write_json(self._harness_dir / "metrics.json", authoritative_metrics)
        return {
            "run_id": harness_run_id,
            "status": state,
            "result": root_result,
            "authoritative_metrics": authoritative_metrics,
            "final_harness": self._live_harness_ref,
            "live_evolution": self._live_enabled,
            "failure_reason": failure_reason,
        }

    def _agent_manifest(self, agent_path: str) -> dict:
        assert self._lock is not None
        return self._lock["objects"][agent_path]

    def _runtime_agent_manifest(self, agent_manifest: dict) -> dict:
        """Add read-only prompt context without changing the locked AgentSpec."""
        runtime_agent = dict(agent_manifest)
        policy_record = self.store.read(agent_manifest["policy"])
        policy_files = [
            path.read_text(encoding="utf-8")
            for path in sorted(policy_record["payload_dir"].rglob("*"))
            if path.is_file()
        ]
        runtime_agent["runtime_context"] = {"policy": "\n\n".join(policy_files)}
        if isinstance(agent_manifest.get("meta_prompt"), str):
            prompt_record = self.store.read(agent_manifest["meta_prompt"])
            prompt_path = prompt_record["payload_dir"] / "PROMPT.md"
            if prompt_path.is_file():
                runtime_agent["runtime_context"]["meta_prompt"] = prompt_path.read_text(
                    encoding="utf-8"
                )
        return runtime_agent

    def _terminal_bridge_config(self, agent_path: str) -> dict:
        """Resolve locked task-agent prompt components for Harbor's internal bridge."""
        agent = self._runtime_agent_manifest(self._agent_manifest(agent_path))
        skills: list[dict] = []
        for binding in agent.get("skills", []):
            if not isinstance(binding, dict) or not isinstance(binding.get("name"), str):
                continue
            record = self.store.read(binding["ref"])
            content = "\n\n".join(
                path.read_text(encoding="utf-8")
                for path in sorted(record["payload_dir"].rglob("*"))
                if path.is_file()
            )
            skills.append({"name": binding["name"], "content": content})
        config = {
            "agent": agent,
            "skills": skills,
            "config_path": str(load_config().path),
        }
        if self._live_enabled and self._harness_dir is not None and self._live_commit_ref is not None:
            config.update({
                "live_evolution": True,
                "root": str(self.store.root),
                "harness_ref": self._live_harness_ref,
                "commit_ref": self._live_commit_ref,
                "live_state_path": str(self._harness_dir / "live-state.json"),
            })
        return config

    def _uses_terminal_bench(self) -> bool:
        assert self._lock is not None
        return (
            self._lock["harness_manifest"].get("role") == "task"
            and self._lock["objects"]["environment"].get("adapter") == "terminal-bench-2"
        )

    def _run_terminal_bench_agent(
        self,
        *,
        run_id: str,
        run_dir: Path,
        events: EventLog,
        invocation: dict,
        driver: str,
        role: str,
    ) -> dict:
        if role != "root":
            raise RuntimeError("terminal-bench-2 supports a root task agent only")
        max_episode_runs = self._budget.get("max_episodes")
        if isinstance(max_episode_runs, int) and self._usage["episode_runs"] >= max_episode_runs:
            raise RuntimeError("episode run budget exhausted")
        case = invocation.get("case")
        if not isinstance(case, dict):
            raise ValueError("terminal-bench-2 task job requires a case object")
        run_task = getattr(self._environment, "run_task", None)
        if not callable(run_task):
            raise RuntimeError("terminal-bench-2 adapter cannot run a task")
        events.append("agent.started", executor="harbor-bridge")
        LOGGER.info("agent.terminal_bench.start run=%s", run_id)
        started = time.monotonic()
        terminal_result = run_task(case, run_dir)
        live_state_path = run_dir / "live-state.json"
        if live_state_path.is_file():
            try:
                live_state = json.loads(live_state_path.read_text(encoding="utf-8"))
                final_harness = live_state.get("harness")
                if isinstance(final_harness, str):
                    self._live_harness_ref = final_harness
            except (OSError, json.JSONDecodeError):
                pass
        phase_reports = self._read_phase_reports(run_dir)
        if phase_reports:
            terminal_result["phase_reports"] = phase_reports[-4:]
        elapsed = round(time.monotonic() - started, 3)
        self._usage["episode_runs"] += 1
        self._episode_results.append(terminal_result)
        result = {
            "provider": self._agent_manifest("root_agent").get("provider"),
            "terminal_bench": terminal_result,
        }
        write_json(run_dir / "result.json", result)
        write_json(
            run_dir / "status.json",
            {
                "state": "succeeded",
                "finished_at": utc_now(),
                "driver": driver,
                "role": role,
                "executor": "harbor-bridge",
                "elapsed_seconds": elapsed,
            },
        )
        events.append("agent.finished", state="succeeded", executor="harbor-bridge")
        LOGGER.info(
            "agent.terminal_bench.finished run=%s score=%s evaluable=%s failure_reason=%s",
            run_id,
            terminal_result.get("score"),
            terminal_result.get("evaluable"),
            terminal_result.get("failure_reason"),
        )
        return result

    @staticmethod
    def _read_phase_reports(run_dir: Path) -> list[dict]:
        reports: list[dict] = []
        for path in run_dir.rglob("phase-reports.jsonl"):
            try:
                lines = path.read_text(encoding="utf-8").splitlines()
            except OSError:
                continue
            for line in lines:
                try:
                    value = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(value, dict):
                    reports.append(value)
        return reports

    def _run_agent(self, agent_path: str, invocation: dict, parent_agent: str | None, role: str) -> dict:
        assert self._harness_dir is not None
        if self._usage["agent_runs"] >= self._budget["max_agent_runs"]:
            raise RuntimeError("agent run budget exhausted")
        self._usage["agent_runs"] += 1
        run_id = self._run_id("agent")
        run_dir = self._run_dir(run_id)
        events = EventLog(run_dir / "events.jsonl")
        agent_manifest = self._agent_manifest(agent_path)
        runtime_agent_manifest = self._runtime_agent_manifest(agent_manifest)
        agent_digest = self._lock["resolved_objects"][agent_path]  # type: ignore[index]
        driver = agent_manifest.get("driver", "-")
        started_at = utc_now()
        started_clock = time.monotonic()

        LOGGER.info(
            "agent.runtime.launch run=%s role=%s parent=%s driver=%s digest=%s",
            run_id,
            role,
            parent_agent or "-",
            driver,
            agent_digest,
        )

        (run_dir / "kind").write_text("agent\n", encoding="utf-8")
        (run_dir / "agent.ref").write_text(agent_digest + "\n", encoding="utf-8")
        write_json(run_dir / "parent.json", {"agent_run": parent_agent, "harness_run": self._harness_dir.name})
        write_json(run_dir / "invocation.json", invocation)
        append_jsonl(self._harness_dir / "agents.jsonl", {"run_id": run_id, "role": role, "agent": agent_digest})

        if self._uses_terminal_bench():
            return self._run_terminal_bench_agent(
                run_id=run_id,
                run_dir=run_dir,
                events=events,
                invocation=invocation,
                driver=driver,
                role=role,
            )

        package_src = str(Path(__file__).resolve().parents[1])
        environment = os.environ.copy()
        existing_path = environment.get("PYTHONPATH")
        environment["PYTHONPATH"] = package_src if not existing_path else package_src + os.pathsep + existing_path
        environment["PYTHONIOENCODING"] = "utf-8"
        process = subprocess.Popen(
            [sys.executable, "-m", "hos.runtime"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            env=environment,
        )
        write_json(
            run_dir / "status.json",
            {"state": "running", "pid": process.pid, "started_at": started_at, "driver": driver, "role": role},
        )
        events.append("agent.started", pid=process.pid, agent=agent_digest)
        LOGGER.info(
            "agent.process.started run=%s pid=%s role=%s driver=%s",
            run_id,
            process.pid,
            role,
            driver,
        )
        assert process.stdin is not None and process.stdout is not None and process.stderr is not None

        stderr_path = run_dir / "stderr.log"
        stderr_lines: list[str] = []
        stderr_lock = threading.Lock()

        def drain_stderr() -> None:
            assert process.stderr is not None
            with stderr_path.open("w", encoding="utf-8") as stderr_file:
                for line in process.stderr:
                    with stderr_lock:
                        stderr_lines.append(line)
                        stderr_file.write(line)
                        stderr_file.flush()
                    rendered = line.rstrip("\r\n")
                    if rendered:
                        LOGGER.info("runtime.stderr run=%s pid=%s %s", run_id, process.pid, rendered)

        stderr_thread = threading.Thread(target=drain_stderr, name=f"hos-stderr-{run_id}", daemon=True)
        stderr_thread.start()
        process.stdin.write(
            json.dumps(
                {
                    "type": "runtime.start",
                    "run_id": run_id,
                    "role": role,
                    "harness_role": self._lock["harness_manifest"].get("role", "task"),
                    "agent": runtime_agent_manifest,
                    "input": invocation,
                    "artifact_dir": str(run_dir),
                    "control_plane": (
                        {"root": str(self.store.root), "parent_run": self._harness_dir.name}
                        if self._control_plane is not None
                        else None
                    ),
                },
                ensure_ascii=False,
                separators=(",", ":"),
            )
            + "\n"
        )
        process.stdin.flush()
        events.append("runtime.start_sent", pid=process.pid, driver=driver)
        LOGGER.debug("runtime.start.sent run=%s pid=%s", run_id, process.pid)

        result: dict | None = None
        runtime_error: dict | None = None
        runtime_ready = False
        runtime_pid: int | None = None
        for raw_line in process.stdout:
            message = json.loads(raw_line)
            message_type = message.get("type")
            if message_type == "runtime.ready":
                runtime_pid = message.get("pid")
                if not isinstance(runtime_pid, int) or message.get("run_id") != run_id:
                    runtime_error = {
                        "type": "RuntimeHandshakeError",
                        "message": f"invalid runtime handshake for run {run_id}: pid={runtime_pid!r}, run_id={message.get('run_id')!r}",
                    }
                    LOGGER.error(
                        "runtime.ready.invalid run=%s kernel_pid=%s runtime_pid=%s runtime_run=%s",
                        run_id,
                        process.pid,
                        runtime_pid,
                        message.get("run_id"),
                    )
                    break
                runtime_ready = True
                ready_at = utc_now()
                write_json(
                    run_dir / "status.json",
                    {
                        "state": "running",
                        "pid": process.pid,
                        "started_at": started_at,
                        "runtime_ready": True,
                        "runtime_ready_at": ready_at,
                        "runtime_pid": runtime_pid,
                        "kernel_pid": process.pid,
                        "driver": driver,
                        "role": role,
                    },
                )
                events.append("runtime.ready", pid=runtime_pid, driver=message.get("driver"), role=message.get("role"))
                LOGGER.info(
                    "runtime.ready run=%s kernel_pid=%s runtime_pid=%s role=%s driver=%s",
                    run_id,
                    process.pid,
                    runtime_pid,
                    message.get("role", role),
                    message.get("driver", driver),
                )
            elif message_type == "host.call":
                LOGGER.debug(
                    "host.call run=%s id=%s method=%s argument_keys=%s",
                    run_id,
                    message.get("id", "-"),
                    message.get("method", "-"),
                    sorted(message.get("arguments", {})),
                )
                response = self._handle_host_call(
                    message,
                    agent_path=agent_path,
                    agent_run_id=run_id,
                    events=events,
                )
                process.stdin.write(json.dumps(response, ensure_ascii=False, separators=(",", ":")) + "\n")
                process.stdin.flush()
                LOGGER.debug(
                    "host.result run=%s id=%s method=%s outcome=%s",
                    run_id,
                    message.get("id", "-"),
                    message.get("method", "-"),
                    "error" if "error" in response else "ok",
                )
            elif message_type == "runtime.finish":
                if not runtime_ready:
                    runtime_error = {
                        "type": "RuntimeHandshakeMissing",
                        "message": "runtime.finish received before runtime.ready",
                    }
                    LOGGER.error("runtime.finish.before_ready run=%s pid=%s", run_id, process.pid)
                    break
                result = message.get("result", {})
                events.append("runtime.finished", pid=process.pid)
                LOGGER.info("runtime.finish.received run=%s pid=%s", run_id, process.pid)
                break
            elif message_type == "runtime.error":
                runtime_error = message.get("error", {})
                LOGGER.error("runtime.error.received run=%s pid=%s error=%s", run_id, process.pid, runtime_error)
                break
        process.stdin.close()
        return_code = process.wait(timeout=10)
        stderr_thread.join(timeout=2)
        if stderr_thread.is_alive():
            LOGGER.warning("runtime.stderr.drain_timeout run=%s pid=%s", run_id, process.pid)
        process.stderr.close()
        elapsed = round(time.monotonic() - started_clock, 3)
        LOGGER.info(
            "agent.process.finished run=%s pid=%s return_code=%s runtime_ready=%s elapsed_seconds=%s stderr_lines=%s",
            run_id,
            process.pid,
            return_code,
            runtime_ready,
            elapsed,
            len(stderr_lines),
        )

        if result is None or return_code != 0 or not runtime_ready:
            error = runtime_error or {"type": "RuntimeExit", "message": f"exit code {return_code}"}
            write_json(run_dir / "result.json", {"error": error})
            write_json(
                run_dir / "status.json",
                {
                    "state": "failed",
                    "pid": process.pid,
                    "kernel_pid": process.pid,
                    "runtime_pid": runtime_pid,
                    "finished_at": utc_now(),
                    "runtime_ready": runtime_ready,
                    "driver": driver,
                    "role": role,
                    "error": error,
                },
            )
            events.append("agent.failed", error=error)
            LOGGER.error("agent.runtime.failed run=%s error=%s", run_id, error)
            raise RuntimeError(error["message"])

        write_json(run_dir / "result.json", result)
        write_json(
            run_dir / "status.json",
            {
                "state": "succeeded",
                "pid": process.pid,
                "kernel_pid": process.pid,
                "runtime_pid": runtime_pid,
                "finished_at": utc_now(),
                "runtime_ready": True,
                "driver": driver,
                "role": role,
                "elapsed_seconds": elapsed,
            },
        )
        events.append("agent.finished", state="succeeded")
        LOGGER.info("agent.runtime.succeeded run=%s role=%s driver=%s", run_id, role, driver)
        return result

    def _handle_host_call(
        self,
        message: dict,
        *,
        agent_path: str,
        agent_run_id: str,
        events: EventLog,
    ) -> dict:
        self._usage["host_calls"] += 1
        request_id = message.get("id")
        method = message.get("method")
        arguments = message.get("arguments", {})
        LOGGER.debug(
            "host.dispatch agent=%s id=%s method=%s",
            agent_run_id,
            request_id or "-",
            method or "-",
        )
        if method == "component.load":
            return self._load_component(request_id, arguments, agent_path, events)
        if isinstance(method, str) and method.startswith("env."):
            return self._handle_environment_call(
                request_id=request_id,
                method=method,
                arguments=arguments,
                owner_agent_run=agent_run_id,
                events=events,
            )
        if method == "experience.submit":
            return self._handle_experience_call(
                request_id=request_id,
                arguments=arguments,
                agent_run_id=agent_run_id,
                events=events,
            )
        if method in {"harness.observe", "harness.checkpoint"}:
            return self._handle_harness_event(request_id, method, arguments, agent_run_id, events)
        if method in {"harness.mutate", "harness.process_memory", "harness.process_skill", "harness.process_subagent"}:
            return self._handle_harness_mutation(request_id, method, arguments, agent_path, agent_run_id, events)
        if method == "harness.run_skill":
            return self._handle_run_skill(request_id, arguments, agent_path, events)
        if method != "agent.spawn":
            events.append("capability.denied", method=method)
            return {"type": "host.result", "id": request_id, "error": {"code": "capability_denied"}}

        binding_name = arguments.get("binding_name")
        bindings = self._agent_manifest(agent_path).get("subagents", {})
        if binding_name not in bindings:
            events.append("capability.denied", method=method, binding=binding_name)
            return {"type": "host.result", "id": request_id, "error": {"code": "capability_denied"}}
        if self._usage["agent_runs"] >= self._budget["max_agent_runs"]:
            events.append("budget.exhausted", resource="agent_runs")
            return {"type": "host.result", "id": request_id, "error": {"code": "budget_exhausted"}}

        child_path = f"{agent_path}.subagents.{binding_name}"
        child_result = self._run_agent(
            child_path,
            arguments.get("input", {}),
            parent_agent=agent_run_id,
            role=str(binding_name),
        )
        events.append("child.finished", child_agent_path=child_path)
        return {"type": "host.result", "id": request_id, "result": child_result}

    def _load_component(
        self,
        request_id: str,
        arguments: dict,
        agent_path: str,
        events: EventLog,
    ) -> dict:
        kind = arguments.get("kind")
        name = arguments.get("name")
        if kind != "skill" or not isinstance(name, str):
            events.append("capability.denied", method="component.load")
            return {"type": "host.result", "id": request_id, "error": {"code": "capability_denied"}}
        manifest = self._agent_manifest(agent_path)
        binding = next((item for item in manifest.get("skills", []) if item.get("name") == name), None)
        if binding is None:
            events.append("capability.denied", method="component.load", component=name)
            return {"type": "host.result", "id": request_id, "error": {"code": "capability_denied"}}
        record = self.store.read(binding["ref"])
        skill_file = record["payload_dir"] / "SKILL.md"
        content = skill_file.read_text(encoding="utf-8") if skill_file.is_file() else ""
        events.append("component.loaded", kind="skill", name=name, object=record["digest"])
        LOGGER.info(
            "harness.module.loaded agent=%s kind=skill name=%s digest=%s bytes=%s",
            agent_path,
            name,
            record["digest"],
            len(content.encode("utf-8")),
        )
        return {
            "type": "host.result",
            "id": request_id,
            "result": {"object": record["digest"], "content": content},
        }

    def _handle_harness_event(self, request_id: str, method: str, arguments: dict, agent_run_id: str, events: EventLog) -> dict:
        if not self._live_enabled or self._live_runtime is None or self._live_session is None:
            events.append("capability.denied", method=method)
            return {"type": "host.result", "id": request_id, "error": {"code": "live_evolution_disabled"}}
        event = str(arguments.get("event", "feedback"))
        if method == "harness.observe":
            record = self._live_runtime.observe(self._live_session, event, **{key: value for key, value in arguments.items() if key != "event"})
            events.append("harness.observed", event=event)
            return {"type": "host.result", "id": request_id, "result": record}
        trigger = str(arguments.get("trigger", "feedback"))
        checkpoint = self._live_runtime.checkpoint(
            self._live_session,
            boundary=str(arguments.get("boundary", "step")),
            trigger=trigger,
            evidence_ref=arguments.get("evidence_ref"),
            event=event,
        )
        result: dict[str, Any] = {"checkpoint_id": checkpoint.checkpoint_id, "boundary": checkpoint.boundary, "trigger": trigger}
        if self._live_controller is not None and trigger in {"progress", "stagnation"} and self._live_harness_ref and self._live_commit_ref:
            evolution = self._live_controller.record_checkpoint(
                {"event": event, "checkpoint_id": checkpoint.checkpoint_id, "agent_run_id": agent_run_id, **arguments},
                trigger=trigger,
                harness=self._live_harness_ref,
                commit_ref=self._live_commit_ref,
            )
            result["evolution"] = evolution
            committed = evolution.get("committed_harness") if isinstance(evolution, dict) else None
            if isinstance(committed, str):
                self._live_harness_ref = committed
                self._lock = resolve_harness(self.store, committed)
                self._live_session = HarnessSession(self._live_session.session_id, committed, self._live_session.scope)
        events.append("harness.checkpointed", **result)
        return {"type": "host.result", "id": request_id, "result": result}

    def _handle_harness_mutation(self, request_id: str, method: str, arguments: dict, agent_path: str, agent_run_id: str, events: EventLog) -> dict:
        if not self._live_enabled or not self._live_harness_ref or not self._live_commit_ref:
            events.append("capability.denied", method=method)
            return {"type": "host.result", "id": request_id, "error": {"code": "live_evolution_disabled"}}
        if method == "harness.mutate":
            operations = arguments.get("operations")
        else:
            component = {"harness.process_memory": "memory", "harness.process_skill": "skill", "harness.process_subagent": "subagent"}[method]
            action = arguments.get("action")
            value = arguments.get("value")
            operations = [{"component": component, "action": action, "value": value}]
        if not isinstance(operations, list) or not operations:
            return {"type": "host.result", "id": request_id, "error": {"code": "invalid_mutation"}}
        proposal = {"kind": "harness-mutation", "base_harness": self._live_harness_ref, "scope": "task-local", "operations": operations}
        mutation = HarnessMutationKernel(self.store).publish(proposal, created_by_run=agent_run_id)
        if not mutation.accepted:
            events.append("harness.mutation.rejected", errors=list(mutation.errors))
            return {"type": "host.result", "id": request_id, "result": {"accepted": False, "errors": list(mutation.errors)}}
        committed = HarnessMutationKernel(self.store).commit(mutation, ref=self._live_commit_ref, expected_base=self._live_harness_ref)
        self._live_harness_ref = committed
        if self._live_controller is not None:
            self._live_controller.record_live_operations(operations)
        self._lock = resolve_harness(self.store, committed)
        if self._live_session is not None:
            self._live_session = HarnessSession(self._live_session.session_id, committed, self._live_session.scope)
        events.append("harness.mutation.committed", harness=committed, mutation=mutation.generation)
        return {"type": "host.result", "id": request_id, "result": {"accepted": True, "harness": committed, "mutation": mutation.generation}}

    def _handle_run_skill(self, request_id: str, arguments: dict, agent_path: str, events: EventLog) -> dict:
        if not self._live_enabled:
            return {"type": "host.result", "id": request_id, "error": {"code": "live_evolution_disabled"}}
        skill_id = arguments.get("id") or arguments.get("name")
        manifest = self._agent_manifest(agent_path)
        binding = next((item for item in manifest.get("skills", []) if isinstance(item, dict) and item.get("name") == skill_id), None)
        if binding is None:
            return {"type": "host.result", "id": request_id, "error": {"code": "unknown_skill"}}
        record = self.store.read(binding["ref"])
        skill_file = record["payload_dir"] / "SKILL.md"
        content = skill_file.read_text(encoding="utf-8") if skill_file.is_file() else ""
        code = content
        if "```python" in content:
            code = content.split("```python", 1)[1].split("```", 1)[0].strip()
        if not code.lstrip().startswith(("import ", "from ", "def ", "print(", "result =")):
            return {"type": "host.result", "id": request_id, "result": {"id": skill_id, "executed": False, "content": content}}
        import subprocess
        env = os.environ.copy()
        env["HOS_SKILL_INPUT"] = json.dumps(arguments.get("input", {}), ensure_ascii=False)
        try:
            completed = subprocess.run([sys.executable, "-c", code], cwd=str(self._harness_dir), env=env, capture_output=True, text=True, timeout=30, check=False)
        except subprocess.TimeoutExpired:
            return {"type": "host.result", "id": request_id, "result": {"id": skill_id, "executed": True, "timeout": True}}
        result = {"id": skill_id, "executed": True, "return_code": completed.returncode, "stdout": completed.stdout[-12000:], "stderr": completed.stderr[-12000:]}
        events.append("skill.executed", **result)
        return {"type": "host.result", "id": request_id, "result": result}

    def _handle_experience_call(
        self,
        *,
        request_id: str,
        arguments: dict,
        agent_run_id: str,
        events: EventLog,
    ) -> dict:
        if self._lock is None or self._lock["harness_manifest"].get("role") != "task":
            events.append("capability.denied", method="experience.submit")
            return {"type": "host.result", "id": request_id, "error": {"code": "capability_denied"}}
        if not self._knowledge_writes:
            events.append("experience.suppressed", reason="evaluation_read_only")
            return {
                "type": "host.result",
                "id": request_id,
                "error": {"code": "evaluation_read_only"},
            }
        experience = arguments.get("experience")
        if not isinstance(experience, dict):
            return {"type": "host.result", "id": request_id, "error": {"code": "invalid_experience"}}
        try:
            digest = KnowledgeLibrary(self.store).publish_experience(experience, created_by_run=agent_run_id)
        except Exception as exc:
            events.append("experience.rejected", error=str(exc))
            return {
                "type": "host.result",
                "id": request_id,
                "error": {"code": "invalid_experience", "message": str(exc)},
            }
        events.append("experience.submitted", experience=digest)
        return {"type": "host.result", "id": request_id, "result": {"experience": digest}}

    def _handle_environment_call(
        self,
        *,
        request_id: str,
        method: str,
        arguments: dict,
        owner_agent_run: str,
        events: EventLog,
    ) -> dict:
        assert self._harness_dir is not None and self._environment is not None
        if method == "env.open":
            max_episode_runs = self._budget.get("max_episodes")
            if isinstance(max_episode_runs, int) and self._usage["episode_runs"] >= max_episode_runs:
                events.append("budget.exhausted", resource="episode_runs")
                return {"type": "host.result", "id": request_id, "error": {"code": "budget_exhausted"}}
            episode_run_id = self._run_id("episode")
            episode_dir = self._run_dir(episode_run_id)
            episode_events = EventLog(episode_dir / "events.jsonl")
            case = arguments.get("case", {})
            (episode_dir / "kind").write_text("episode\n", encoding="utf-8")
            write_json(episode_dir / "game.json", case)
            write_json(
                episode_dir / "parent.json",
                {"agent_run": owner_agent_run, "harness_run": self._harness_dir.name},
            )
            write_json(episode_dir / "status.json", {"state": "running", "started_at": utc_now()})
            opened = self._environment.open(case, episode_dir)
            self._episodes[episode_run_id] = {
                "adapter_handle": opened["handle"],
                "owner": owner_agent_run,
                "dir": episode_dir,
                "events": episode_events,
            }
            self._usage["episode_runs"] += 1
            append_jsonl(
                self._harness_dir / "episodes.jsonl",
                {"run_id": episode_run_id, "owner_agent_run": owner_agent_run},
            )
            episode_events.append("environment.opened", case=case)
            events.append("episode.started", episode_run=episode_run_id)
            LOGGER.info(
                "environment.opened agent=%s episode=%s game_id=%s seed=%s",
                owner_agent_run,
                episode_run_id,
                case.get("game_id", "-"),
                case.get("seed", "-"),
            )
            return {
                "type": "host.result",
                "id": request_id,
                "result": {
                    "episode": episode_run_id,
                    "observation": opened.get("observation"),
                    "action_space": opened.get("action_space", []),
                },
            }

        episode_id = arguments.get("episode")
        episode = self._episodes.get(episode_id)
        if episode is None or episode["owner"] != owner_agent_run:
            events.append("capability.denied", method=method, episode=episode_id)
            return {"type": "host.result", "id": request_id, "error": {"code": "capability_denied"}}
        adapter_handle = episode["adapter_handle"]
        episode_events: EventLog = episode["events"]
        if method == "env.observe":
            value = self._environment.observe(adapter_handle)
            episode_events.append("environment.observed")
            LOGGER.debug("environment.observed agent=%s episode=%s", owner_agent_run, episode_id)
        elif method == "env.step":
            value = self._environment.step(adapter_handle, arguments["action"], arguments.get("data"))
            episode_events.append("environment.step", action=arguments["action"])
            LOGGER.info("environment.step agent=%s episode=%s action=%s", owner_agent_run, episode_id, arguments["action"])
        elif method == "env.reset":
            value = self._environment.reset(adapter_handle)
            episode_events.append("environment.reset")
            LOGGER.info("environment.reset agent=%s episode=%s", owner_agent_run, episode_id)
        elif method == "env.close":
            value = self._environment.close(adapter_handle)
            self._episode_results.append(value)
            write_json(episode["dir"] / "scorecard.json", value.get("scorecard", {"score": value.get("score", 0)}))
            recording = value.get("recording")
            if recording is not None:
                for record in recording:
                    append_jsonl(episode["dir"] / "recording.jsonl", record)
            write_json(episode["dir"] / "result.json", {"score": value.get("score", 0.0)})
            write_json(episode["dir"] / "status.json", {"state": "succeeded", "finished_at": utc_now()})
            episode_events.append("environment.closed", score=value.get("score", 0.0))
            LOGGER.info(
                "environment.closed agent=%s episode=%s score=%s",
                owner_agent_run,
                episode_id,
                value.get("score", 0.0),
            )
            value = {"run_id": episode_id, "score": value.get("score", 0.0)}
        else:
            events.append("capability.denied", method=method)
            return {"type": "host.result", "id": request_id, "error": {"code": "capability_denied"}}
        return {"type": "host.result", "id": request_id, "result": value}


def read_started(run_dir: Path) -> str:
    status = json.loads((run_dir / "status.json").read_text(encoding="utf-8"))
    return status["started_at"]
