"""Local JSON HTTP owner for one ALE-Bench Session.

The Pi process sees only projected public results and the terminal private
summary. The Session object and all private benchmark inputs remain here.
"""

from __future__ import annotations

import argparse
import json
import secrets
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from .ale_bench_bridge import AleBenchBridge, write_artifact


class _State:
    def __init__(self, root: Path, problem_id: str, lite_version: bool, max_public: int, max_case: int) -> None:
        self.root, self.problem_id, self.lite_version = root, problem_id, lite_version
        self.max_public, self.max_case = max_public, max_case
        self.bridge = AleBenchBridge.start(problem_id, lite_version=lite_version)
        self.public_results: list[dict[str, Any]] = []
        self.case_count = 0
        self.private_result: dict[str, Any] | None = None
        self.token = secrets.token_urlsafe(32)
        self.lock = threading.Lock()

    def payload(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        with self.lock:
            if path == "/status":
                return {"problem_id": self.problem_id, "lite_version": self.lite_version,
                        "public_count": len(self.public_results), "max_public": self.max_public,
                        "private_evaluated": self.private_result is not None}
            if path == "/problem":
                problem = getattr(self.bridge.session, "problem", None)
                metadata = getattr(problem, "metadata", None)
                constraints = getattr(problem, "constraints", None)
                return {"problem_id": self.problem_id,
                        "statement": str(getattr(problem, "statement", "")),
                        "metadata": {name: getattr(metadata, name) for name in ("title", "problem_type", "score_type") if hasattr(metadata, name)},
                        "constraints": {name: getattr(constraints, name) for name in ("time_limit", "memory_limit") if hasattr(constraints, name)}}
            if path in {"/public_eval", "/case_eval"}:
                if path == "/public_eval" and len(self.public_results) >= self.max_public:
                    raise RuntimeError("public evaluation budget exhausted")
                if path == "/case_eval" and self.case_count >= self.max_case:
                    raise RuntimeError("case evaluation budget exhausted")
                code = str(body.get("code", ""))
                language = str(body.get("code_language", "cpp23"))
                result = self.bridge.public_eval(code, language) if path == "/public_eval" else self.bridge.case_eval(str(body.get("input_str", "")), code, language)
                if path == "/case_eval": self.case_count += 1
                else: self.public_results.append(result)
                return result
            if path == "/private_eval":
                if self.private_result is not None:
                    raise RuntimeError("private_eval may only be called once")
                self.private_result = self.bridge.private_eval(str(body.get("code", "")), str(body.get("code_language", "cpp23")))
                write_artifact(self.root / "ale_bench.json", problem_id=self.problem_id,
                               lite_version=self.lite_version, public_results=self.public_results,
                               private_result=self.private_result)
                return self.private_result
            if path == "/close":
                self.bridge.close()
                return {"closed": True}
            raise ValueError(f"unknown bridge path: {path}")


def serve(root: Path, problem_id: str, lite_version: bool, max_public: int, max_case: int) -> None:
    state = _State(root, problem_id, lite_version, max_public, max_case)

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:  # noqa: N802
            if self.headers.get("X-ALE-Token") != state.token:
                self._send_error(403, "invalid token")
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                value = state.payload(self.path, json.loads(self.rfile.read(length) or b"{}"))
                raw = json.dumps(value, ensure_ascii=False).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(raw)
            except Exception as exc:  # boundary returns a structured error to Pi
                self._send_error(400, str(exc))

        def do_GET(self) -> None:  # noqa: N802
            if self.headers.get("X-ALE-Token") != state.token:
                self._send_error(403, "invalid token")
                return
            try:
                raw = json.dumps(state.payload(self.path, {}), ensure_ascii=False).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(raw)
            except Exception as exc:
                self._send_error(400, str(exc))

        def _send_error(self, status: int, message: str) -> None:
            raw = json.dumps({"error": message}, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def log_message(self, *_args: Any) -> None:
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    (root / "bridge-ready.json").write_text(json.dumps({"host": "127.0.0.1", "port": server.server_port, "token": state.token}), encoding="utf-8")
    try:
        server.serve_forever()
    finally:
        state.bridge.close()
        server.server_close()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--problem-id", required=True)
    parser.add_argument("--full", action="store_true")
    parser.add_argument("--max-public", type=int, default=8)
    parser.add_argument("--max-case", type=int, default=32)
    args = parser.parse_args()
    args.root.mkdir(parents=True, exist_ok=True)
    serve(args.root, args.problem_id, not args.full, args.max_public, args.max_case)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
