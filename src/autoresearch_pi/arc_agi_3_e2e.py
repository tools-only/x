"""Pi-native ARC-AGI-3 end-to-end adapter."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from .pi_kernel import PiKernel
from .project import load_project_dotenv
from .arc_agi_3_adapter import (
    DEFAULT_ACTION_BUDGET_MULTIPLIER,
    DEFAULT_MAX_ANIMATION_FRAMES,
    OFFICIAL_ARC_SYSTEM_PROMPT,
    resolve_model_settings,
)


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    records: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            records.append(value)
    return records


def _scorecard_id(scorecard: dict[str, Any] | None) -> str | None:
    if not scorecard:
        return None
    for key in ("scorecard_id", "card_id", "id"):
        value = scorecard.get(key)
        if value is not None:
            return str(value)
    return None


def project_arc_summary(
    root: Path,
    *,
    game: str,
    variant: str,
    bridge_result: dict[str, Any],
    scorecard: dict[str, Any] | None,
    pi_returncode: int,
    timed_out: bool,
    model_settings: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Project native task outcome and task-local mechanism evidence separately."""
    findings = _read_jsonl(root / "research-resources.jsonl")
    decisions = _read_jsonl(root / "harness-decisions.jsonl")
    exposures = _read_jsonl(root / "harness-observations.jsonl")
    assessments = _read_jsonl(root / "effect-assessments.jsonl")
    supported = [item for item in assessments if item.get("verdict") == "supported"]
    terminal_state = str(bridge_result.get("terminal_state") or "UNKNOWN")
    levels_completed = int(bridge_result.get("levels_completed", 0) or 0)
    benchmark_passed = terminal_state == "WIN"
    return {
        "pipeline": "pi-native-arc-agi-3-e2e",
        "game": game,
        "experiment": {"variant": variant, "control": variant == "control"},
        "execution_model": "pi_native_agent_loop",
        "adapter": {
            "name": "arc-agi-3-official-agent-contract",
            "system_prompt": OFFICIAL_ARC_SYSTEM_PROMPT,
            "max_animation_frames": DEFAULT_MAX_ANIMATION_FRAMES,
            "action_budget_multiplier": DEFAULT_ACTION_BUDGET_MULTIPLIER,
            "official_source": "benchmarking.agent.BenchmarkingAgent",
            "research_extension": variant == "treatment",
        },
        "passed": bool(benchmark_passed and pi_returncode == 0 and not timed_out),
        "benchmark_evaluation": {
            "source": "arc_agi_3_native_scorecard",
            "scorecard_id": _scorecard_id(scorecard) or bridge_result.get("scorecard_id"),
            "terminal_state": terminal_state,
            "levels_completed": levels_completed,
            "passed": benchmark_passed,
        },
        "runtime": {
            "pi_returncode": pi_returncode,
            "timed_out": timed_out,
            "agent_actions": int(bridge_result.get("actions", 0) or 0),
            "forced_actions": int(bridge_result.get("forced_actions", 0) or 0),
            "model": (model_settings or {}).get("model"),
            "pi_api": (model_settings or {}).get("pi_api"),
            "context_window": (model_settings or {}).get("context_window"),
            "max_output_tokens": (model_settings or {}).get("max_tokens"),
        },
        "research": {"finding_versions": len(findings), "latest_findings": findings[-5:]},
        "self_harness_evaluation": {
            "decision_count": len(decisions),
            "exposure_count": len(exposures),
            "effect_assessment_count": len(assessments),
            "supported_effect_assessments": len(supported),
            "harness_improved": None,
            "interpretation": "Mechanism evidence is a mediator; improvement requires a paired benchmark comparison.",
        },
        "native_scorecard": scorecard,
        "artifacts": {
            "bridge_events": "bridge-events.jsonl",
            "scorecard": "arc-scorecard.json",
            "pi_events": "pi-events.jsonl",
            "observations": "execution-observations.jsonl",
            "findings": "research-resources.jsonl",
            "decisions": "harness-decisions.jsonl",
            "effects": "effect-assessments.jsonl",
        },
    }


def _post_json(url: str, payload: dict[str, Any], timeout: float = 10.0) -> dict[str, Any]:
    request = urllib.request.Request(
        url, data=json.dumps(payload).encode("utf-8"), method="POST",
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        value = json.loads(response.read())
    if not isinstance(value, dict):
        raise ValueError("ARC bridge returned a non-object")
    return value


def _get_json(url: str, timeout: float = 10.0) -> dict[str, Any]:
    with urllib.request.urlopen(url, timeout=timeout) as response:
        value = json.loads(response.read())
    if not isinstance(value, dict):
        raise ValueError("ARC bridge returned a non-object")
    return value


def _resolve_pi_cli() -> tuple[str, str]:
    node = shutil.which("node")
    if not node:
        raise RuntimeError("Pi runtime unsupported: node executable was not found")
    cli = Path(node).resolve().parent / "node_modules" / "@earendil-works" / "pi-coding-agent" / "dist" / "cli.js"
    if not cli.is_file():
        raise RuntimeError(f"Pi runtime unsupported: installed CLI was not found at {cli}")
    return node, str(cli)


def _wait_for_bridge(root: Path, process: subprocess.Popen[str], timeout: float = 60.0) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    ready_path = root / "bridge-ready.json"
    while time.monotonic() < deadline:
        if ready_path.is_file():
            return json.loads(ready_path.read_text(encoding="utf-8"))
        if process.poll() is not None:
            error_path = root / "bridge-error.json"
            detail = error_path.read_text(encoding="utf-8") if error_path.is_file() else ""
            raise RuntimeError(f"ARC bridge exited before ready: {detail}")
        time.sleep(0.1)
    raise TimeoutError("timed out waiting for ARC bridge readiness")


def _run_pi(root: Path, *, bridge_url: str, game: str, variant: str, timeout: float | None, context_compaction: bool) -> int:
    node, cli = _resolve_pi_cli()
    project_root = Path(__file__).resolve().parents[2]
    extension = project_root / "demo" / "pi_arc_agi_3_extension.ts"
    agent_dir = root / ".pi-agent"
    agent_dir.mkdir(parents=True, exist_ok=True)
    env = load_project_dotenv(project_root)
    model_settings = resolve_model_settings(env)
    base_url, api_key = model_settings["base_url"], model_settings["api_key"]
    if not base_url or not api_key:
        raise RuntimeError(
            "this project environment must define ARC_OPENAI_API_BASE/ARC_OPENAI_API_KEY "
            "or OPENAI_API_BASE/OPENAI_API_KEY"
        )
    model = str(model_settings["model"])
    # The Pi child reads the canonical variable names from its own process.
    # Keep ARC-scoped values isolated from the parent process and from other
    # benchmark adapters.
    env["OPENAI_API_BASE"] = str(base_url)
    env["OPENAI_API_KEY"] = str(api_key)
    (agent_dir / "models.json").write_text(json.dumps({"providers": {"yibu": {
        "baseUrl": base_url, "api": model_settings["pi_api"], "apiKey": "$OPENAI_API_KEY",
        "authHeader": True, "models": [{"id": model, "name": model, "reasoning": False,
            "input": ["text"], "contextWindow": model_settings["context_window"],
            "maxTokens": model_settings["max_tokens"],
            "cost": {"input": 5, "output": 30, "cacheRead": 0, "cacheWrite": 0}}],
    }}}), encoding="utf-8")
    env.update({
        "PI_CODING_AGENT_DIR": str(agent_dir), "PI_AUTORESEARCH_E2E_ROOT": str(root),
        "PI_AUTORESEARCH_ROOT": str(project_root), "PI_AUTORESEARCH_VARIANT": variant,
        "PI_AUTORESEARCH_CONTEXT_COMPACTION": "enabled" if context_compaction else "disabled",
        "PI_ARC_BRIDGE_URL": bridge_url, "PI_ARC_GAME": game,
    })
    command = [node, cli, "--mode", "rpc", "--provider", "yibu", "--model", model,
               "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates",
               "--no-context-files", "--no-builtin-tools", "--extension", str(extension)]
    trace = (root / "pi-events.jsonl").open("a", encoding="utf-8")
    # Pi emits streaming deltas whose ``partial`` payload repeats the entire
    # assistant message on every token.  Persisting those deltas makes a long
    # ARC run grow quadratically while adding no execution evidence.  Keep
    # lifecycle, tool, response, and final-message events; omit only the
    # replaceable streaming fragments.
    persisted_event_types = {
        "response", "turn_start", "turn_end", "agent_start", "agent_end",
        "agent_settled", "message_start", "message_end", "toolCall",
        "tool_execution_start", "tool_execution_end", "text", "thinking",
    }
    def persist(event: dict[str, Any]) -> None:
        if event.get("type") not in persisted_event_types:
            return
        trace.write(json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n")
        trace.flush()
    try:
        kernel_timeout = timeout if timeout is not None else 12 * 60 * 60
        with PiKernel(command, cwd=str(root), env=env, timeout=kernel_timeout, event_sink=persist) as kernel:
            response = kernel.prompt(
                f"Play ARC-AGI-3 game {game}. Call arc_state with request='current' and use arc_action until the native game reaches WIN, "
                "or until the action budget is exhausted. Research resources are optional and should be used only "
                "when an observed pattern can change a later execution decision."
            )
            if response.get("success") is False:
                return 1
            consecutive_provider_errors = 0
            while True:
                turn_events = kernel.wait_for_agent_events(timeout=timeout)
                turn_failed = any(
                    event.get("type") == "message_end"
                    and isinstance(event.get("message"), dict)
                    and event["message"].get("stopReason") == "error"
                    for event in turn_events
                )
                tool_completed = any(event.get("type") == "tool_execution_end" for event in turn_events)
                if turn_failed and not tool_completed:
                    consecutive_provider_errors += 1
                    if consecutive_provider_errors >= 3:
                        return 1
                else:
                    consecutive_provider_errors = 0
                state = _get_json(bridge_url + "/state")
                game_state = str(state.get("state", ""))
                used = int((state.get("action_budget") or {}).get("used", 0) or 0)
                maximum = int((state.get("action_budget") or {}).get("maximum", 0) or 0)
                if game_state == "WIN" or used >= maximum:
                    return 0
                # ``follow_up`` only queues a message while an agent loop is
                # still active.  At this point the previous loop has emitted
                # ``agent_settled`` and is idle, so a follow_up would be
                # accepted but never start another turn.  Use Pi's native
                # prompt command to begin the next loop from the existing
                # session context.
                truncated = any(
                    event.get("type") == "message_end"
                    and isinstance(event.get("message"), dict)
                    and event["message"].get("stopReason") == "length"
                    for event in turn_events
                )
                continuation = (
                    "Your previous response hit the output limit. Do not explain or dump the frame; "
                    "call arc_state once and immediately submit one arc_action."
                    if truncated else
                    "Continue the same ARC game. Read the current arc_state and submit the next "
                    "available arc_action; do not stop until WIN or the native action budget is exhausted."
                )
                follow_up = kernel.prompt(continuation)
                if follow_up.get("success") is False:
                    return 1
                # ``agent_settled`` from the previous turn is already in the
                # RPC event stream. Advance the cursor to the new turn before
                # collecting its completion, otherwise the runner can return
                # immediately without giving the continuation a chance to act.
                kernel.wait_for_event(("turn_start",), timeout=timeout)
    except TimeoutError:
        return 124
    finally:
        trace.close()


def run_arc_agi_3_e2e(
    root: Path,
    *,
    arc_root: Path,
    game: str,
    experiment_variant: str = "treatment",
    timeout: float | None = None,
    max_actions: int | None = None,
    context_compaction: bool = False,
) -> Path:
    if experiment_variant not in {"control", "treatment"}:
        raise ValueError("experiment_variant must be control or treatment")
    if max_actions is not None and max_actions < 1:
        raise ValueError("max_actions must be at least 1")
    root = root.resolve()
    if root.exists() and any(root.iterdir()):
        raise ValueError("ARC output must be an empty directory; use a new run root")
    root.mkdir(parents=True, exist_ok=True)
    arc_root = arc_root.resolve()
    arc_python = arc_root / ".venv" / "Scripts" / "python.exe"
    if not arc_python.is_file():
        raise FileNotFoundError(f"ARC SDK interpreter was not found: {arc_python}")
    project_root = Path(__file__).resolve().parents[2]
    env = load_project_dotenv(project_root)
    model_settings = resolve_model_settings(env)
    src = str(Path(__file__).resolve().parent.parent)
    env["PYTHONPATH"] = src + os.pathsep + env.get("PYTHONPATH", "")
    bridge_command = [str(arc_python), "-m", "autoresearch_pi.arc_agi_3_bridge", "--root", str(root), "--game", game]
    if max_actions is not None:
        bridge_command.extend(["--max-actions", str(max_actions)])
    bridge = subprocess.Popen(
        bridge_command,
        cwd=str(arc_root), env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    pi_returncode = 1
    timed_out = False
    bridge_result: dict[str, Any] = {}
    try:
        ready = _wait_for_bridge(root, bridge)
        bridge_url = f"http://127.0.0.1:{int(ready['port'])}"
        pi_returncode = _run_pi(
            root, bridge_url=bridge_url, game=game, variant=experiment_variant,
            timeout=timeout, context_compaction=context_compaction,
        )
        timed_out = pi_returncode == 124
        bridge_result = _post_json(bridge_url + "/close", {})
        bridge.wait(timeout=30)
    except (Exception, KeyboardInterrupt) as exc:
        (root / "runner-error.json").write_text(
            json.dumps({"error": f"{type(exc).__name__}: {exc}"}, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        # Preserve an analyzable terminal summary even when the operator
        # interrupts a long native run.  The bridge is still closed below so
        # its scorecard and bridge-result are flushed before projection.
        pi_returncode = 130 if isinstance(exc, KeyboardInterrupt) else 1
    finally:
        if bridge.poll() is None:
            bridge.terminate()
            try:
                bridge.wait(timeout=5)
            except subprocess.TimeoutExpired:
                bridge.kill()
                bridge.wait(timeout=5)
    if not bridge_result and (root / "bridge-result.json").is_file():
        bridge_result = json.loads((root / "bridge-result.json").read_text(encoding="utf-8"))
    scorecard = None
    if (root / "arc-scorecard.json").is_file():
        scorecard = json.loads((root / "arc-scorecard.json").read_text(encoding="utf-8"))
    payload = project_arc_summary(
        root, game=game, variant=experiment_variant, bridge_result=bridge_result,
        scorecard=scorecard, pi_returncode=pi_returncode, timed_out=timed_out,
        model_settings=model_settings,
    )
    summary = root / "summary.json"
    temporary = root / "summary.json.tmp"
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(summary)
    return summary
