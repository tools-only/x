"""Run one immutable ARC version with external, evidence-based evaluation stops.

This observer never selects game actions or injects gameplay instructions.
Reported usage is a response-boundary threshold; cancelled billing stays unknown.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
import psutil

PROJECT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT / "src"))
from autoresearch_pi.project import load_project_dotenv


def rows(path: Path) -> list[dict]:
    if not path.exists(): return []
    result = []
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        try: result.append(json.loads(line))
        except ValueError: pass  # A live writer may not have completed its final line.
    return result


def status(root: Path) -> dict:
    actions = [r for r in rows(root / "bridge-events.jsonl") if r.get("event") == "action"]
    parent = [r for r in rows(root / "provider-telemetry.jsonl") if r.get("event") == "assistant_message"]
    child = [r for r in rows(root / "subagent-provider-telemetry.jsonl") if r.get("event") == "assistant_message"]
    contexts = [r for r in rows(root / "context-token-debug.jsonl") if r.get("event") == "provider_request_context"
                and r.get("measurement_basis") == "provider_payload"]
    measured = [sum((r.get("usage") or {}).get(k, 0) or 0 for k in ("input", "cache_read", "cache_write")) for r in parent]
    measured = [n for n in measured if n > 0]
    context_chars = [max(0, r.get("context_json_chars", 0) - r.get("image_transport_chars", 0)) for r in contexts]
    live = {}
    for r in rows(root / "pi-events.jsonl"):
        if r.get("type") == "tool_execution_start": live[r.get("toolCallId")] = r.get("toolName")
        elif r.get("type") == "tool_execution_end": live.pop(r.get("toolCallId"), None)
    return {"utc": datetime.now(timezone.utc).isoformat(), "actions": len(actions),
            "levels": actions[-1].get("frame", {}).get("levels_completed", 0) if actions else 0,
            "reported_tokens": sum((r.get("usage") or {}).get("total_tokens", 0) or 0 for r in parent + child),
            "parent_responses": len(parent), "child_responses": len(child), "requests": len(contexts),
            "input_ratio": measured[-1] / measured[0] if measured else None,
            "context_chars_ratio": context_chars[-1] / context_chars[0] if context_chars and context_chars[0] else None,
            "context_chars_excluding_image_transport": context_chars[-1] if context_chars else None,
            "module_chars": {k: v.get("json_chars", 0) for k, v in contexts[-1].get("modules", {}).items()} if contexts else {},
            "length_responses": sum(r.get("stop_reason") == "length" for r in parent),
            "unmeasured_usage": any(r.get("event") == "unmeasured_usage" for r in rows(root / "provider-token-budget.jsonl")),
            "active_tools": list(live.values())}


def runner_owns_no_level_checkpoint(root: Path, limit: int, scope: str = "outer_prompt_dispatch") -> bool:
    """Old immutable versions keep the observer fallback until they opt in."""
    try:
        config = json.loads((root / "arc-runtime-config.json").read_text(encoding="utf-8"))
        return (type(config.get("no_level_reported_tokens")) is int
                and config["no_level_reported_tokens"] == limit
                and config.get("no_level_checkpoint_scope") == scope)
    except (OSError, ValueError, AttributeError):
        return False


def stop_reason(s: dict, *, no_level_limit: int, growth_limit: float, length_limit: int,
                runner_owns_no_level: bool = False, stop_after_length: bool = False) -> str | None:
    if s["unmeasured_usage"]: return "unknown provider usage"
    if max(s.get("input_ratio") or 0, s.get("context_chars_ratio") or 0) >= growth_limit:
        return "provider input or final context doubled; inspect composition before continuing"
    if stop_after_length and s["length_responses"] >= length_limit:
        return "declared diagnostic stop after provider length; no automatic recovery experiment"
    if not runner_owns_no_level and s["levels"] == 0 and s["reported_tokens"] >= no_level_limit:
        return "no first level by declared cost checkpoint"
    if s["actions"] == 0 and s["length_responses"] >= length_limit: return "length recovery without any committed environment action"
    return None


def stop_owned_pi(owner: subprocess.Popen, archive: Path, root: Path, reason: str, s: dict) -> None:
    process = psutil.Process(owner.pid)
    command = process.cmdline()
    if str(root) not in command or "arc-agi-3-e2e" not in command:
        raise RuntimeError("Run ownership changed; refusing termination")
    victims = []
    for process in process.children(recursive=False):
        try:
            args = process.cmdline()
            if process.name().lower() == "node.exe" and "rpc" in args and str(archive / "demo/pi_arc_agi_3_extension.ts") in args:
                victims.append(process.pid)
                process.terminate()
        except psutil.NoSuchProcess: pass
    (root / "experiment-stop-audit.json").write_text(json.dumps({"reason": reason, "status": s,
        "owner_pid": owner.pid, "stopped_pi_pids": victims, "applied": bool(victims),
        "cancelled_usage": "unknown unless the provider returned authoritative usage"}, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--model", default="qwen3.8-27b")
    parser.add_argument("--game", default="ft09")
    parser.add_argument("--max-actions", type=int, default=60)
    parser.add_argument("--max-output-tokens", type=int, default=32768)
    parser.add_argument("--max-reported-tokens", type=int, default=120000)
    parser.add_argument("--no-level-tokens", type=int, default=60000)
    parser.add_argument("--checkpoint-scope", choices=("outer_prompt_dispatch", "parent_provider_requests"), default="parent_provider_requests")
    parser.add_argument("--timeout", type=int, default=900)
    parser.add_argument("--growth-limit", type=float, default=2.0)
    parser.add_argument("--length-limit", type=int, default=1)
    parser.add_argument("--stop-after-length", action="store_true")
    parser.add_argument("--history-policy", choices=("preserve", "summarize_openai_field", "summarize_completed_openai_field"), default="preserve")
    parser.add_argument("--reasoning-policy", choices=("provider-default", "adaptive-binary"), default="provider-default")
    parser.add_argument("--initial-after-feedback", action="store_true")
    parser.add_argument("--length-recovery", action="store_true")
    args = parser.parse_args()
    archive, root = args.source.resolve(), args.root.resolve()
    if root.exists(): raise RuntimeError("Refuse reuse of canonical run history")
    if not 1 <= args.max_actions <= 60 or not 1 < args.growth_limit: raise ValueError("invalid evaluation bounds")
    if not 0 < args.no_level_tokens <= 2**53 - 1: raise ValueError("no-level-tokens must be a positive safe integer")
    if args.initial_after_feedback and args.reasoning_policy != "adaptive-binary":
        raise ValueError("initial-after-feedback requires adaptive-binary")
    if args.length_recovery and args.reasoning_policy != "adaptive-binary":
        raise ValueError("length-recovery requires adaptive-binary")
    manifest = json.loads((archive / "complete-source-manifest.json").read_text(encoding="utf-8"))
    drift = lambda: [f for f, h in manifest.items() if hashlib.sha256((archive / f).read_bytes()).hexdigest() != h]
    if drift(): raise RuntimeError("Frozen source drift")
    env = load_project_dotenv(PROJECT)
    env.update(PYTHONPATH=str(archive / "src"), ARC_MODEL=args.model, ARC_PI_API="openai-completions",
        ARC_INPUT_MODALITIES="text,image", PI_AUTORESEARCH_CONTEXT_MAX_CHARS="60000",
        PI_PROVIDER_REASONING_HISTORY_POLICY=args.history_policy, PI_ARC_TOOL_DISCLOSURE="on_demand",
        PI_ARC_CHILD_OBSERVATION="on_demand", PI_AUTORESEARCH_PROVIDER_PROMPT_CAPTURE="all",
        PI_ARC_NO_LEVEL_REPORTED_TOKENS=str(args.no_level_tokens))
    # Explicit binary comparisons use the verified native off/on mapping.
    for key in ("ARC_PI_THINKING_FORMAT", "PI_HARNESS_CAPABILITY_VALIDATION", "PI_HARNESS_COMPOSITION_VALIDATION", "PI_PROVIDER_MAX_REPORTED_TOKENS"):
        env.pop(key, None)
    env.pop("PI_ARC_NO_LEVEL_CHECKPOINT_SCOPE", None)
    if args.checkpoint_scope == "parent_provider_requests":
        env["PI_ARC_NO_LEVEL_CHECKPOINT_SCOPE"] = args.checkpoint_scope
    env.pop("PI_REASONING_INITIAL_AFTER_FEEDBACK", None)
    env.pop("PI_REASONING_LENGTH_RECOVERY", None)
    if args.reasoning_policy == "adaptive-binary":
        env["ARC_PI_THINKING_FORMAT"] = "qwen"
    if args.initial_after_feedback:
        env["PI_REASONING_INITIAL_AFTER_FEEDBACK"] = "enabled"
    if args.length_recovery:
        env["PI_REASONING_LENGTH_RECOVERY"] = "enabled"
    env["PI_PROVIDER_EDITABLE_REASONING_PROVIDERS"] = "yibu" if args.history_policy in ("summarize_openai_field", "summarize_completed_openai_field") else ""
    bypass = env.get("no_proxy", env.get("NO_PROXY", "")) + ",arcprize.org,.arcprize.org,az.gptplus5.com"
    env.update(NO_PROXY=bypass, no_proxy=bypass)
    command = [sys.executable, "-m", "autoresearch_pi.cli", "arc-agi-3-e2e", "--root", str(root),
        "--arc-root", "D:/arc-agi-benchmark/arc-agi-3-benchmarking", "--game", args.game, "--variant", "treatment",
        "--max-actions", str(args.max_actions), "--input-modalities", "text,image", "--review-mode", "advisory",
        "--reasoning-policy", args.reasoning_policy, "--max-output-tokens", str(args.max_output_tokens),
        "--experiment-timeout", str(args.timeout), "--max-reported-tokens", str(args.max_reported_tokens)]
    if args.reasoning_policy == "adaptive-binary":
        command.extend(["--reasoning-levels", "off,medium"])
    protocol = {**vars(args), "source": str(archive), "root": str(root), "source_files": len(manifest), "provider": "yibu"}
    (PROJECT / "tmp" / (root.name + "-protocol.json")).write_text(json.dumps(protocol, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(protocol), flush=True)
    start, last, stopped = time.monotonic(), None, False
    with (PROJECT / "tmp" / (root.name + ".log")).open("w", encoding="utf-8") as log:
        owner = subprocess.Popen(command, cwd=archive, env=env, stdout=log, stderr=subprocess.STDOUT)
        while owner.poll() is None:
            time.sleep(2)
            if not root.exists(): continue
            s = status(root)
            s["runner_owns_no_level_checkpoint"] = runner_owns_no_level_checkpoint(root, args.no_level_tokens, args.checkpoint_scope)
            key = json.dumps({k: v for k, v in s.items() if k != "utc"}, sort_keys=True)
            if key != last:
                with (root / "experiment-observer.jsonl").open("a", encoding="utf-8") as out: out.write(json.dumps(s) + "\n")
                print(json.dumps(s), flush=True)
                last = key
            reason = stop_reason(s, no_level_limit=args.no_level_tokens, growth_limit=args.growth_limit,
                                 length_limit=args.length_limit,
                                 runner_owns_no_level=s["runner_owns_no_level_checkpoint"],
                                 stop_after_length=args.stop_after_length)
            if time.monotonic() - start > args.timeout + 60: reason = "runner deadline plus cleanup allowance"
            # Allow an already executing native mutation/action to commit its atomic receipt.
            if reason and not stopped and not s["active_tools"]:
                try: stop_owned_pi(owner, archive, root, reason, s)
                except psutil.NoSuchProcess: pass
                stopped = True
        result = owner.returncode
    final = {"exit_code": result, "status": status(root), "source_drift": drift(), "protocol": protocol,
             "stopped_by_observer": stopped, "elapsed_seconds": time.monotonic() - start,
             "runner_owns_no_level_checkpoint": runner_owns_no_level_checkpoint(root, args.no_level_tokens, args.checkpoint_scope)}
    (PROJECT / "tmp" / (root.name + "-audit.json")).write_text(json.dumps(final, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(final), flush=True)
    return result


if __name__ == "__main__": raise SystemExit(main())
