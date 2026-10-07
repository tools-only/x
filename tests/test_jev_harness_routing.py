from __future__ import annotations

import json
import shutil
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from test_pi_harness_entry import _run_fixture, records


PROJECT = Path(__file__).resolve().parents[1]
MODULE = PROJECT / "demo" / "pi_jev_harness_routing.ts"


def run_node(script: str) -> dict:
    node = shutil.which("node")
    if not node:
        pytest.skip("node is unavailable")
    result = subprocess.run(
        [node, "--experimental-strip-types", "--input-type=module", "-e", script],
        cwd=PROJECT,
        text=True,
        encoding="utf-8",
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def test_pi_jev_selector_routes_all_harness_component_kinds_without_calling_when_disabled() -> None:
    script = f"""
import {{ routeHarnessComponents }} from {json.dumps(MODULE.as_uri())};
const candidates = ["tool", "skill", "memory", "system_prompt", "subagent"].map((kind, index) => ({{
  resource_ref: `${{kind}}:candidate-${{index}}@v1`, kind, name: `candidate-${{index}}`, description: `desc-${{index}}`
}}));
let calls = 0;
const disabled = await routeHarnessComponents({{mode:"disabled",state:"task",candidates,evaluate:async()=>{{calls++;throw new Error("called")}}}});
const active = await routeHarnessComponents({{mode:"active",state:"task",candidates,evaluate:async request=>{{
  calls++;
  return {{model:"fixture",elapsedMs:3,answers:Object.fromEntries(Object.keys(request.questions).map((key,index)=>[key,{{value:index % 2 === 0 ? 0.8 : 0.2}}]))}};
}}}});
console.log(JSON.stringify({{calls,disabled,active}}));
"""

    result = run_node(script)

    assert result["calls"] == 1
    assert result["disabled"]["status"] == "disabled"
    assert result["active"]["candidate_refs"] == [
        "tool:candidate-0@v1",
        "skill:candidate-1@v1",
        "memory:candidate-2@v1",
        "system_prompt:candidate-3@v1",
        "subagent:candidate-4@v1",
    ]
    assert result["active"]["selected_resource_refs"] == [
        "tool:candidate-0@v1",
        "memory:candidate-2@v1",
        "subagent:candidate-4@v1",
    ]


def test_pi_jev_selector_fails_closed_without_mutating_a_selection() -> None:
    script = f"""
import {{ routeHarnessComponents }} from {json.dumps(MODULE.as_uri())};
const result = await routeHarnessComponents({{
  mode:"shadow", state:"task",
  candidates:[{{resource_ref:"memory:fact@v1",kind:"memory",name:"fact",description:"fact"}}],
  evaluate:async()=>{{throw new Error("offline")}},
}});
console.log(JSON.stringify(result));
"""

    result = run_node(script)

    assert result["status"] == "error"
    assert result["selected_resource_refs"] == []
    assert result["error"] == "offline"


def test_active_jev_routing_applies_existing_pi_assembly_surface(tmp_path) -> None:
    requests: list[dict] = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:  # noqa: N802 - stdlib callback name
            length = int(self.headers.get("content-length", "0"))
            request = json.loads(self.rfile.read(length))
            requests.append(request)
            answers = {key: {"noul": 0.91} for key in request["questions"]}
            body = json.dumps({"answers": answers, "model": "jev-fixture"}).encode()
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, _format: str, *_args: object) -> None:
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        root = tmp_path / "active-routing"
        _run_fixture(
            root,
            "treatment",
            steps=[
                {"name": "task_memory", "arguments": {
                    "action": "upsert", "key": "jev-fact",
                    "content": "JEV_SELECTED_MEMORY",
                }},
                {"name": "task_system_prompt", "arguments": {
                    "action": "create", "name": "jev-rule",
                    "content": "JEV_SELECTED_SYSTEM_PROMPT",
                    "scope": "current task",
                }},
                {"name": "task_harness", "arguments": {"action": "inspect"}},
            ],
            extra_env={
                "PI_AUTORESEARCH_JEV_ROUTING": "active",
                "TYPESAFE_API_KEY": "fixture-key",
                "TYPESAFE_BASE_URL": f"http://127.0.0.1:{server.server_port}",
            },
        )
        _run_fixture(
            root,
            "treatment",
            steps=[{"name": "task_harness", "arguments": {"action": "inspect"}}],
            extra_env={
                "PI_AUTORESEARCH_JEV_ROUTING": "active",
                "TYPESAFE_API_KEY": "fixture-key",
                "TYPESAFE_BASE_URL": f"http://127.0.0.1:{server.server_port}",
            },
            prompt="Continue the same task with the routed components.",
        )
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)

    assert requests
    assembly = records(root, "task-harness-assemblies.jsonl")[-1]
    assert assembly["selection_mode"] == "jev"
    assert assembly["selected_resource_refs"] == [
        "memory:jev-fact@v1", "system_prompt:jev-rule@v1",
    ]
    routing = records(root, "task-harness-jev-routing.jsonl")
    assert any(item.get("applied") is True for item in routing)
    assert "JEV_SELECTED_MEMORY" in json.dumps(records(root, "provider-contexts.jsonl")[-1])
    assert "JEV_SELECTED_SYSTEM_PROMPT" in records(root, "provider-contexts.jsonl")[-1]["context"]["systemPrompt"]
