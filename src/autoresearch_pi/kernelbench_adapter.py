"""Small client for the four Dream-RSI KernelBench tasks and its GPU evaluator."""

from __future__ import annotations

import hashlib
import json
import shutil
import urllib.request
from pathlib import Path


TASKS = {
    "kb_l1_40_layernorm": (1, 40),
    "kb_l2_8_convdiv": (2, 8),
    "kb_l2_43_convmax": (2, 43),
    "kb_l3_11_vgg16": (3, 11),
}


def prepare_kernelbench_task(root: Path, *, task: str, dream_root: Path) -> Path:
    """Copy the public task prompt and reference into an isolated agent workspace."""
    if task not in TASKS:
        raise ValueError(f"unknown KernelBench task: {task}")
    root = root.resolve()
    dream_root = dream_root.resolve()
    if root == dream_root or dream_root in root.parents:
        raise ValueError("KernelBench run root must stay outside the Dream-RSI checkout")
    if root.exists() and any(root.iterdir()):
        raise ValueError("KernelBench run root must be empty")
    source = dream_root / "tasks" / "kernelbench" / task
    prompt = source / f"{task}.triton"
    reference = dream_root / "third_party" / "kernelbench" / task / "init_program.py"
    if not prompt.is_file() or not reference.is_file():
        raise FileNotFoundError(f"Dream-RSI task files missing: {prompt}, {reference}")
    root.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(prompt, root / "task.triton")
    shutil.copyfile(reference, root / "reference.py")
    manifest = {
        "task": task,
        "level": TASKS[task][0],
        "problem_id": TASKS[task][1],
        "source": str(dream_root),
        "prompt_sha256": hashlib.sha256(prompt.read_bytes()).hexdigest(),
        "reference_sha256": hashlib.sha256(reference.read_bytes()).hexdigest(),
        "candidate": "candidate.py",
    }
    path = root / "task.json"
    path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return path


def evaluate_kernelbench_candidate(
    root: Path, *, server_url: str = "http://127.0.0.1:8010", timeout: float = 3000.0,
    backend: str = "cuda", mode: str = "benchmark", include_reference_timing: bool = False,
) -> Path:
    """Submit one candidate; keep transport failure distinct from a wrong kernel."""
    root = root.resolve()
    manifest = json.loads((root / "task.json").read_text(encoding="utf-8"))
    task = manifest["task"]
    if task not in TASKS or (manifest["level"], manifest["problem_id"]) != TASKS[task]:
        raise ValueError("invalid KernelBench task manifest")
    for filename, field in (("task.triton", "prompt_sha256"), ("reference.py", "reference_sha256")):
        if hashlib.sha256((root / filename).read_bytes()).hexdigest() != manifest[field]:
            raise ValueError(f"KernelBench task source changed: {filename}")
    if backend not in {"cuda", "triton"}:
        raise ValueError("backend must be cuda or triton")
    if mode not in {"check", "benchmark"}:
        raise ValueError("mode must be check or benchmark")
    candidate = root / "candidate.py"
    source = candidate.read_text(encoding="utf-8")
    if not source.strip():
        raise ValueError("candidate.py is empty")
    candidate_hash = hashlib.sha256(source.encode("utf-8")).hexdigest()
    attempts = root / "attempts"
    attempts.mkdir(exist_ok=True)
    snapshot = attempts / f"{candidate_hash}.py"
    if not snapshot.exists():
        snapshot.write_text(source, encoding="utf-8")
    url = server_url.rstrip("/") + "/evaluate"
    request_data = {
        "program_src": source,
        "task": task,
        "eval_mode": "kernelbench_official",
        "program_format": "auto",
        "backend": backend,
        "precision": "fp32",
        "timing_method": "cuda_event",
        "num_correct_trials": 1 if mode == "check" else 5,
        "num_perf_trials": 1 if mode == "check" else 100,
        "seed_num": 42,
        "gpu_id": 0,
        "verbose": False,
        "measure_performance": mode == "benchmark",
        "include_reference_timing": include_reference_timing and mode == "benchmark",
        "ref_num_trials": 100,
    }
    request = urllib.request.Request(url, json.dumps(request_data).encode("utf-8"), {"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = json.load(response)
        result = payload["result"]
        if not isinstance(result, dict) or not {"compiled", "correctness", "combined_score"} <= result.keys():
            raise ValueError("evaluator result is missing required fields")
        summary = {
            "task": task,
            "candidate_sha256": candidate_hash,
            "candidate_snapshot": str(snapshot.relative_to(root)),
            "evaluator": url,
            "protocol": {key: value for key, value in request_data.items() if key != "program_src"},
            "evaluation_status": "completed",
            "benchmark_evaluation": result,
        }
    except (OSError, ValueError, KeyError) as error:
        summary = {
            "task": task,
            "candidate_sha256": candidate_hash,
            "candidate_snapshot": str(snapshot.relative_to(root)),
            "evaluator": url,
            "protocol": {key: value for key, value in request_data.items() if key != "program_src"},
            "evaluation_status": "infrastructure_error",
            "error": str(error),
        }
    output = root / "evaluation.json"
    output.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    with (root / "evaluations.jsonl").open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(summary, ensure_ascii=False) + "\n")
    if mode == "benchmark" and summary["evaluation_status"] == "completed":
        evaluation = summary["benchmark_evaluation"]
        metadata = evaluation.get("metadata", {})
        latency = metadata.get("latency_ms")
        if evaluation.get("compiled") and evaluation.get("correctness") and isinstance(latency, (int, float)) and latency > 0:
            best_path = root / "best.json"
            best = json.loads(best_path.read_text(encoding="utf-8")) if best_path.is_file() else None
            comparable = best and best.get("protocol", {}).get("backend") == backend
            if not comparable or latency < best["latency_ms"]:
                best_path.write_text(json.dumps({
                    "task": task,
                    "candidate_sha256": candidate_hash,
                    "candidate_snapshot": str(snapshot.relative_to(root)),
                    "latency_ms": latency,
                    "speedup_vs_reference": metadata.get("speedup_vs_reference"),
                    "protocol": {"backend": backend, "precision": "fp32", "timing_method": "cuda_event"},
                    "evaluation": "evaluation.json",
                }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return output
