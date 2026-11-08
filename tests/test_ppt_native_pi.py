from __future__ import annotations

import json
import shutil
from pathlib import Path

from autoresearch_pi.pi_kernel import PiKernel
from test_pi_external_benchmark_native import _pi_cli


def test_installed_pi_advertises_hot_swapped_native_tools_and_skill_reads_in_one_session(tmp_path: Path):
    node, cli = _pi_cli()
    project = Path(__file__).resolve().parents[1]
    probe_v1 = "# program: on\n# description: native probe v1\ndef main(args):\n    return 'probe-v1'"
    probe_v2 = "# program: on\n# description: native probe v2\ndef main(args):\n    return 'probe-v2'"
    skill_v1 = "---\ndescription: native skill v1\n---\nbody-v1"
    skill_v2 = "---\ndescription: native skill v2\n---\nbody-v2"
    steps = [
        {"name": "reflect_component", "arguments": {"op": "define", "kind": "tool", "name": "pi_native_probe", "source": probe_v1, "note": "publish v1"}},
        {"name": "pi_native_probe", "arguments": {"args": {}}},
        {"name": "reflect_component", "arguments": {"op": "redefine", "kind": "tool", "name": "pi_native_probe", "source": probe_v2, "note": "publish v2"}},
        {"name": "pi_native_probe", "arguments": {"args": {}}},
        {"name": "reflect_component", "arguments": {"op": "restore", "kind": "tool", "name": "pi_native_probe", "version": 1, "note": "restore v1"}},
        {"name": "pi_native_probe", "arguments": {"args": {}}},
        {"name": "reflect_component", "arguments": {"op": "restore", "kind": "tool", "name": "pi_native_probe", "version": 1, "note": "restore current bytes"}},
        {"name": "pi_native_probe", "arguments": {"args": {}}},
        {"name": "reflect_component", "arguments": {"op": "define", "kind": "skill", "name": "pi-native-skill", "source": skill_v1, "note": "publish v1"}},
        {"name": "read", "arguments": {"path": "skills/pi-native-skill/SKILL.md"}},
        {"name": "reflect_component", "arguments": {"op": "redefine", "kind": "skill", "name": "pi-native-skill", "source": skill_v2, "note": "publish v2"}},
        {"name": "read", "arguments": {"path": "skills/pi-native-skill/SKILL.md"}},
        {"name": "reflect_component", "arguments": {"op": "restore", "kind": "skill", "name": "pi-native-skill", "version": 1, "note": "restore v1"}},
        {"name": "read", "arguments": {"path": "skills/pi-native-skill/SKILL.md"}},
        {"name": "reflect_component", "arguments": {"op": "redefine", "kind": "skill", "name": "pi-native-skill", "source": "---\n---\nrejected", "note": "reject missing description"}},
        {"name": "read", "arguments": {"path": "skills/pi-native-skill/SKILL.md"}},
    ]
    command = [
        node, cli, "--mode", "rpc", "--provider", "offline-external-test", "--model", "scripted",
        "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-builtin-tools",
        "--extension", str(project / "demo/ppt_demo_extension.ts"),
        "--extension", str(project / "tests/pi_external_benchmark_provider.ts"),
        "--session", str(tmp_path / "session.jsonl"),
    ]
    env = {
        "PI_CODING_AGENT_DIR": str(tmp_path / ".pi-agent"),
        "PI_AUTORESEARCH_E2E_ROOT": str(tmp_path),
        "PPT_DEMO_ROOT": str(tmp_path),
        "PPT_DEMO_DEADLINE": "4102444800000",
        "PPT_DEMO_BUDGET_USD": "100",
        "PPT_DEMO_REQUEST_RESERVE_USD": "0.01",
        "PPT_DEMO_INPUT_USD_PER_MILLION": "0",
        "PPT_DEMO_OUTPUT_USD_PER_MILLION": "0",
        "PPT_DEMO_CACHE_READ_USD_PER_MILLION": "0",
        "PPT_DEMO_CACHE_WRITE_USD_PER_MILLION": "0",
        "PI_EXTERNAL_STEPS": json.dumps(steps),
        "PI_EXTERNAL_USAGE_TOKENS": "1",
    }
    root = tmp_path
    with PiKernel(command, cwd=str(root), env=env, timeout=90) as kernel:
        kernel.prompt_and_wait("Run the scripted native resource continuation diagnostic.", timeout=90)

    contexts = [json.loads(line)["context"] for line in (tmp_path / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()]
    assert len(contexts) == 17
    for index, expected in ((1, "probe-v1"), (3, "probe-v2"), (5, "probe-v1"), (7, "probe-v1")):
        tool = next(tool for tool in contexts[index]["tools"] if tool["name"] == "pi_native_probe")
        assert list(tool["parameters"]["properties"]) == ["args"]
    for index, description, body in ((9, "native skill v1", None), (11, "native skill v2", "body-v1"),
                                     (13, "native skill v1", "body-v2"), (15, "native skill v1", "rejected")):
        context = contexts[index]
        prompt = context["systemPrompt"]
        assert "pi-native-skill" in prompt and description in prompt
        if body:
            messages = json.dumps(context["messages"])
            assert body in messages
    assert "body-v1" in json.dumps(contexts[10]["messages"])
    assert "body-v2" in json.dumps(contexts[12]["messages"])
    assert "body-v1" in json.dumps(contexts[14]["messages"])
    assert "body-v1" in json.dumps(contexts[16]["messages"])
    assert '"content":"rejected"' not in json.dumps(contexts[16]["messages"])
    lifecycle = [json.loads(line) for line in (tmp_path / "harness/lifecycle.jsonl").read_text(encoding="utf-8").splitlines()]
    loaded = [row["version"] for row in lifecycle if row.get("event") == "skill_loaded" and row.get("name") == "pi-native-skill"]
    assert loaded == [1, 2, 3, 3]
    failed = [row for row in lifecycle if row.get("event") == "reflective_change" and row.get("kind") == "skill" and row.get("ok") is False]
    assert len(failed) == 1 and failed[0]["active_version"] == 3
    runs = [json.loads(line) for line in (tmp_path / "harness/component_runs.jsonl").read_text(encoding="utf-8").splitlines()]
    assert [(row["version"], row["hash"]) for row in runs if row.get("kind") == "tool"] == [
        (1, next(row["hash"] for row in lifecycle if row.get("event") == "reflective_change" and row.get("name") == "pi_native_probe" and row.get("version") == 1)),
        (2, next(row["hash"] for row in lifecycle if row.get("event") == "reflective_change" and row.get("name") == "pi_native_probe" and row.get("version") == 2)),
        (3, next(row["hash"] for row in lifecycle if row.get("event") == "reflective_change" and row.get("name") == "pi_native_probe" and row.get("version") == 1)),
        (3, next(row["hash"] for row in lifecycle if row.get("event") == "reflective_change" and row.get("name") == "pi_native_probe" and row.get("version") == 1)),
    ]
