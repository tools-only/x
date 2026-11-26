import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from autoresearch_pi.cli import main
from autoresearch_pi.kernelbench_adapter import TASKS, evaluate_kernelbench_candidate, prepare_kernelbench_task


@pytest.fixture
def dream_root(tmp_path: Path) -> Path:
    dream = tmp_path / "dream-rsi"
    for task in TASKS:
        prompt = dream / "tasks" / "kernelbench" / task / f"{task}.triton"
        reference = dream / "third_party" / "kernelbench" / task / "init_program.py"
        prompt.parent.mkdir(parents=True)
        reference.parent.mkdir(parents=True)
        prompt.write_text(f"Optimize {task}\n", encoding="utf-8")
        reference.write_text("class Model: pass\n", encoding="utf-8")
    return dream


def test_prepare_four_tasks_and_reject_existing_run(tmp_path: Path, dream_root: Path) -> None:
    with pytest.raises(ValueError, match="outside"):
        prepare_kernelbench_task(dream_root / "run", task="kb_l1_40_layernorm", dream_root=dream_root)
    for task, (level, problem_id) in TASKS.items():
        root = tmp_path / task
        manifest = json.loads(prepare_kernelbench_task(root, task=task, dream_root=dream_root).read_text())
        assert (manifest["level"], manifest["problem_id"]) == (level, problem_id)
        assert (root / "task.triton").read_text() == f"Optimize {task}\n"
        assert (root / "reference.py").read_text() == "class Model: pass\n"
        with pytest.raises(ValueError, match="empty"):
            prepare_kernelbench_task(root, task=task, dream_root=dream_root)


def test_evaluation_protocol_and_attempt_history(tmp_path: Path, dream_root: Path) -> None:
    root = tmp_path / "run"
    prepare_kernelbench_task(root, task="kb_l1_40_layernorm", dream_root=dream_root)
    (root / "candidate.py").write_text("class ModelNew: pass\n", encoding="utf-8")
    requests = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            assert self.path == "/evaluate"
            request = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            requests.append(request)
            result = {"result": {"compiled": True, "correctness": False, "combined_score": 0.0}} if len(requests) < 3 else {"result": {}}
            body = json.dumps(result).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        result = json.loads(evaluate_kernelbench_candidate(root, server_url=f"http://127.0.0.1:{server.server_port}").read_text())
        evaluate_kernelbench_candidate(root, server_url=f"http://127.0.0.1:{server.server_port}", backend="triton")
        malformed = json.loads(evaluate_kernelbench_candidate(root, server_url=f"http://127.0.0.1:{server.server_port}").read_text())
    finally:
        server.shutdown()
        thread.join()
        server.server_close()

    assert requests[0]["task"] == "kb_l1_40_layernorm"
    assert requests[0]["num_correct_trials"] == 5
    assert requests[0]["num_perf_trials"] == 100
    assert requests[0]["backend"] == "cuda"
    assert requests[1]["backend"] == "triton"
    assert requests[0]["program_src"] == "class ModelNew: pass\n"
    assert result["evaluation_status"] == "completed"
    assert result["benchmark_evaluation"]["combined_score"] == 0.0
    assert malformed["evaluation_status"] == "infrastructure_error"
    assert "benchmark_evaluation" not in malformed
    assert (root / result["candidate_snapshot"]).read_text() == requests[0]["program_src"]
    assert len((root / "evaluations.jsonl").read_text().splitlines()) == 3


def test_transport_failure_is_not_a_kernel_score(tmp_path: Path, dream_root: Path, capsys) -> None:
    root = tmp_path / "run"
    prepare_kernelbench_task(root, task="kb_l3_11_vgg16", dream_root=dream_root)
    (root / "candidate.py").write_text("class ModelNew: pass\n", encoding="utf-8")
    assert main(["kernelbench-eval", "--root", str(root), "--server-url", "http://127.0.0.1:1", "--timeout", "0.1"]) == 2
    result = json.loads(capsys.readouterr().out)
    assert result["evaluation_status"] == "infrastructure_error"
    assert "benchmark_evaluation" not in result


def test_reference_change_blocks_mismatched_evaluation(tmp_path: Path, dream_root: Path) -> None:
    root = tmp_path / "run"
    prepare_kernelbench_task(root, task="kb_l2_8_convdiv", dream_root=dream_root)
    (root / "candidate.py").write_text("class ModelNew: pass\n", encoding="utf-8")
    (root / "reference.py").write_text("class DifferentModel: pass\n", encoding="utf-8")
    with pytest.raises(ValueError, match="task source changed: reference.py"):
        evaluate_kernelbench_candidate(root)
