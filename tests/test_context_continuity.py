import json
import shutil
import subprocess
from hashlib import sha256
from pathlib import Path

import pytest


PROJECT = Path(__file__).resolve().parents[1]
LIFECYCLE_MODULE = (PROJECT / "demo" / "pi_task_local_context_lifecycle.ts").as_uri()
TELEMETRY_MODULE = (PROJECT / "demo" / "pi_provider_telemetry.ts").as_uri()


def _node() -> str:
    executable = shutil.which("node")
    if not executable:
        pytest.skip("node unavailable")
    return executable


def _run_node(script: str, *args: Path) -> dict:
    completed = subprocess.run(
        [_node(), "--experimental-strip-types", "--input-type=module", "-e", script,
         *(str(arg) for arg in args)],
        cwd=PROJECT, capture_output=True, text=True, encoding="utf-8", check=True,
    )
    return json.loads(completed.stdout)


def _project_context(tmp_path: Path, messages: list[dict], **options) -> dict:
    input_path = tmp_path / "context-input.json"
    input_path.write_text(json.dumps({"messages": messages, "options": options}), encoding="utf-8")
    script = f"""
import {{ readFileSync }} from 'node:fs';
import {{ installTaskLocalContextLifecycle }} from {json.dumps(LIFECYCLE_MODULE)};
const input = JSON.parse(readFileSync(process.argv[1], 'utf8'));
const handlers = {{}};
const pi = {{
  on(name, handler) {{ (handlers[name] ??= []).push(handler); }},
  registerTool() {{}}, getActiveTools() {{ return []; }}, getAllTools() {{ return []; }},
}};
installTaskLocalContextLifecycle(pi, {{ root: process.argv[2], ...input.options }});
const projected = await handlers.context.at(-1)({{ messages: input.messages }});
console.log(JSON.stringify(projected));
"""
    return _run_node(script, input_path, tmp_path)


def _message(text: str, role: str = "user") -> dict:
    return {"role": role, "content": [{"type": "text", "text": text}]}


def _texts(projected: dict) -> list[str]:
    return [
        part["text"]
        for message in projected["messages"]
        for part in message.get("content", [])
        if part.get("type") == "text"
    ]


@pytest.mark.parametrize("option_budget,env_budget,expected", [
    (None, "6000", 6000),
    (7000, "6000", 7000),
    (90000, "6000", 32000),
    (None, "invalid", 32000),
])
def test_explicit_context_budget_precedes_model_window_but_cannot_expand_it(
        tmp_path, monkeypatch, option_budget, env_budget, expected):
    monkeypatch.setenv("PI_AUTORESEARCH_MODEL_CONTEXT_TOKENS", "10000")
    monkeypatch.setenv("PI_AUTORESEARCH_MODEL_OUTPUT_TOKENS", "2000")
    monkeypatch.setenv("PI_AUTORESEARCH_CONTEXT_MAX_CHARS", env_budget)
    messages = [_message("initial task")]
    messages.extend(_message(f"old-{index}-" + "x" * 3000, "assistant") for index in range(12))
    messages.append(_message("next decision"))
    options = {"keepRecentMessages": 4}
    if option_budget is not None:
        options["maxChars"] = option_budget
    projected = _project_context(tmp_path, messages, **options)
    logs = [json.loads(line) for line in
            (tmp_path / "task-context-compactions.jsonl").read_text(encoding="utf-8").splitlines()]
    assert logs[-1]["max_chars"] == expected
    assert logs[-1]["transport_input_token_allowance"] == 8000
    assert len(json.dumps(projected["messages"], ensure_ascii=False)) <= expected
    assert "next decision" in _texts(projected)


def test_explicit_budget_preserves_current_evidence_and_complete_leased_read(tmp_path, monkeypatch):
    monkeypatch.setenv("PI_AUTORESEARCH_MODEL_CONTEXT_TOKENS", "175000")
    monkeypatch.setenv("PI_AUTORESEARCH_MODEL_OUTPUT_TOKENS", "16000")
    monkeypatch.setenv("PI_AUTORESEARCH_CONTEXT_MAX_CHARS", "6000")
    lease_call = {"role": "assistant", "content": [{"type": "toolCall", "id": "read-1",
        "name": "task_resource", "arguments": {"action": "read", "ref": "finding:f@v1"}}]}
    page = {"role": "toolResult", "toolCallId": "read-1", "toolName": "task_resource",
        "read_workset_required": True, "content": [{"type": "text", "text": "exact-page-" * 400}]}
    current = "CURRENT TASK STATE: excluded=old-map; experiment=incomplete; next=observe"
    latest_call = {"role": "assistant", "content": [{"type": "toolCall", "id": "action-1",
        "name": "arc_action", "arguments": {"action": "ACTION1"}}]}
    observation = {"role": "toolResult", "toolCallId": "action-1", "toolName": "arc_action",
        "read_workset_required": True, "content": [{"type": "text", "text": "current-grid-" * 250},
                                                  {"type": "image", "mimeType": "image/png", "data": "exact-current-image"}]}
    messages = [_message("initial task"), lease_call, page]
    messages.extend(_message("old-reasoning-" * 400, "assistant") for _ in range(7))
    messages.extend([_message(current), latest_call, observation, _message("continue")])
    projected = _project_context(tmp_path, messages, keepRecentMessages=3)
    assert current in _texts(projected)
    assert page["content"][0]["text"] in _texts(projected)
    assert any(message.get("toolCallId") == "action-1" and message["content"] == observation["content"]
               for message in projected["messages"])
    assert any(message.get("content") == lease_call["content"] for message in projected["messages"])
    logs = [json.loads(line) for line in
            (tmp_path / "task-context-compactions.jsonl").read_text(encoding="utf-8").splitlines()]
    assert logs[-1]["max_chars"] == 6000
    assert logs[-1]["protected_overflow"] is True
    assert logs[-1]["latest_tool_result_preserved"] is True


def test_protected_guidance_in_long_tail_survives_per_message_compaction(tmp_path):
    guidance = "Baseline authoring methods: " + "complete-baseline-guidance-" * 120
    ordinary = "ordinary-tail-" * 240
    messages = [_message("initial task")]
    messages.extend(_message(f"history-{index}-" + "x" * 900, "assistant") for index in range(6))
    messages.extend([_message(ordinary), _message(guidance)])

    projected = _project_context(
        tmp_path, messages, maxChars=9_000, maxMessageChars=320,
        keepRecentMessages=3, headMessages=1,
    )
    texts = _texts(projected)

    assert guidance in texts
    assert ordinary not in texts


def test_protected_guidance_in_archived_middle_survives_exactly(tmp_path):
    guidance = "# Derive capabilities from experience\n" + "retain-this-process-step\n" * 100
    messages = [_message("initial task"), _message("first response", "assistant"), _message(guidance)]
    messages.extend(_message(f"middle-{index}-" + "m" * 950, "assistant") for index in range(7))
    messages.extend([_message("recent-one-" + "r" * 700), _message("recent-two-" + "s" * 700)])

    projected = _project_context(
        tmp_path, messages, maxChars=7_000, maxMessageChars=400,
        keepRecentMessages=2, headMessages=1,
    )
    texts = _texts(projected)

    assert guidance in texts
    assert any(text.startswith("[Task-local context archive]") for text in texts)


def test_protected_guidance_keeps_only_latest_version_per_category(tmp_path):
    versions = {
		"periodic": ("Periodic pattern extraction due: old window", "Periodic pattern extraction due: latest window"),
		"research": ("Auto-Research evidence update: old refs", "Auto-Research evidence update: latest refs"),
        "baseline": (
            "Baseline authoring methods: old baseline",
            "Baseline authoring methods: latest baseline",
        ),
        "process": (
            "# Derive capabilities from experience\nold process",
            "# Derive capabilities from experience\nlatest process",
        ),
        "workflow_reference": (
            "Capability workflow reference: old read call",
            "Capability workflow reference: latest read call",
        ),
        "pending": (
            "Pending parent capability decisions (1; oldest first): old queue",
            "Pending parent capability decisions (2; oldest first): latest queue",
        ),
    }
    messages = [_message("initial task")]
    messages.extend(_message(pair[0]) for pair in versions.values())
    messages.append(_message("ordinary message", "assistant"))
    messages.extend(_message(pair[1]) for pair in versions.values())

    projected = _project_context(
        tmp_path, messages, maxChars=20_000, maxMessageChars=5_000,
        keepRecentMessages=20, headMessages=1,
    )
    texts = _texts(projected)

    for old, latest in versions.values():
        assert old not in texts
        assert texts.count(latest) == 1


def test_protected_guidance_over_budget_is_preserved_and_reports_overflow(tmp_path):
    guidance = "Pending parent capability decisions (1; oldest first): " + "full-decision-" * 500
    projected = _project_context(
        tmp_path, [_message("initial task"), _message(guidance)],
        maxChars=2_000, maxMessageChars=300, keepRecentMessages=1, headMessages=1,
    )

    assert _texts(projected).count(guidance) == 1
    compactions = [json.loads(line) for line in
                   (tmp_path / "task-context-compactions.jsonl").read_text(encoding="utf-8").splitlines()]
    assert compactions[-1]["protected_overflow"] is True


def _telemetry_run(tmp_path: Path, *, payload: dict | None,
                   guidance: str = "Baseline authoring methods: exact provider guidance",
                   name: str = "baseline_authoring_methods") -> dict:
    descriptor = {
        "name": name,
        "sha256": sha256(guidance.encode()).hexdigest(),
        "chars": len(guidance),
        "trigger": "every_treatment_context",
        "boundary": "task_local_self_harness_context",
    }
    (tmp_path / "task-harness-context-exposures.jsonl").write_text(
        json.dumps({"exposure_id": "expected-1", "guidance_exposures": [descriptor]}) + "\n",
        encoding="utf-8",
    )
    input_path = tmp_path / "telemetry-input.json"
    input_path.write_text(json.dumps({"payload": payload}), encoding="utf-8")
    script = f"""
import {{ readFileSync }} from 'node:fs';
import {{ installProviderTelemetry }} from {json.dumps(TELEMETRY_MODULE)};
import {{ EventEmitter }} from 'node:events';
import finalProviderPayload from {json.dumps((PROJECT / 'demo/pi_final_provider_payload.ts').as_uri())};
const input = JSON.parse(readFileSync(process.argv[1], 'utf8'));
const handlers = {{}};
const pi = {{
  events: new EventEmitter(),
  on(name, handler) {{ (handlers[name] ??= []).push(handler); }},
  getActiveTools() {{ return []; }}, getAllTools() {{ return []; }},
}};
installProviderTelemetry(pi, {{ root: process.argv[2], scope: 'continuity-test' }});
finalProviderPayload(pi);
if (input.payload) {{
  for (const handler of handlers.before_provider_request) await handler({{ payload: input.payload }});
}} else {{
  await handlers.context[0]({{ messages: [{{role:'user',content:[{{type:'text',text:'fallback'}}]}}] }}, {{ getSystemPrompt() {{ return ''; }} }});
  await handlers.message_end[0]({{ message: {{ role:'assistant', content:[], usage:{{}} }} }});
}}
console.log(JSON.stringify({{ ok: true }}));
"""
    _run_node(script, input_path, tmp_path)
    records = [json.loads(line) for line in
               (tmp_path / "provider-telemetry.jsonl").read_text(encoding="utf-8").splitlines()]
    return next(item for item in records if item["event"] == "harness_assembly")


def test_provider_telemetry_reports_exact_full_guidance_presence(tmp_path):
    guidance = "Baseline authoring methods: exact provider guidance"
    assembly = _telemetry_run(tmp_path, payload={
        "messages": [{"role": "user", "content": [{"type": "text", "text": guidance}]}],
    })

    assert assembly["guidance_exposures"] == [{
        "name": "baseline_authoring_methods",
        "sha256": sha256(guidance.encode()).hexdigest(),
        "chars": len(guidance),
        "full_text_present": True,
    }]


@pytest.mark.parametrize("name,prefix", [
    ("periodic_pattern_review", "Periodic pattern extraction due:"),
    ("research_evidence_update", "Auto-Research evidence update:"),
    ("baseline_authoring_methods", "Baseline authoring methods:"),
    ("capability_workflow_reference", "Capability workflow reference:"),
])
def test_provider_telemetry_finds_exact_full_guidance_inside_wrapped_text(tmp_path, name, prefix):
    guidance = f"{prefix} exact provider guidance"
    assembly = _telemetry_run(tmp_path, name=name, guidance=guidance, payload={
        "messages": [{
            "role": "user",
            "content": [{"type": "text", "text": f"provider wrapper\n{guidance}\nend wrapper"}],
        }],
    })

    assert assembly["guidance_exposures"][0]["full_text_present"] is True


def test_provider_telemetry_reports_unknown_when_payload_is_unavailable(tmp_path):
    assembly = _telemetry_run(tmp_path, payload=None)

    assert assembly["measurement_basis"] == "context_hook_fallback"
    assert assembly["guidance_exposures"][0]["full_text_present"] is None


def test_provider_telemetry_tracks_current_process_body_inside_wrapper(tmp_path):
    guidance = (PROJECT / "demo/prompts/capability_extraction_process.md").read_text(encoding="utf-8")
    assembly = _telemetry_run(tmp_path, guidance=guidance, name="capability_extraction_process",
                              payload={"messages": [{"role": "user", "content":
                                         f"provider wrapper\n{guidance}\nend wrapper"}]})
    descriptor = assembly["guidance_exposures"][0]
    assert descriptor["sha256"] == sha256(guidance.encode()).hexdigest()
    assert descriptor["full_text_present"] is True


def test_runtime_exposure_describes_guidance_and_hashes_exact_text(tmp_path):
    from test_pi_external_benchmark_native import _run_fixture

    _run_fixture(tmp_path, "treatment", steps=[])
    exposure = [json.loads(line) for line in
                (tmp_path / "task-harness-context-exposures.jsonl").read_text(encoding="utf-8").splitlines()][-1]
    context = json.loads(
        (tmp_path / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()[-1]
    )["context"]
    baseline = next(
        part["text"]
        for message in context["messages"]
        for part in message.get("content", [])
        if part.get("text", "").startswith("Baseline authoring methods:")
    )
    descriptors = {item["name"]: item for item in exposure["guidance_exposures"]}
    descriptor = descriptors["baseline_authoring_methods"]

    assert descriptor == {
        "name": "baseline_authoring_methods",
        "sha256": sha256(baseline.encode()).hexdigest(),
        "chars": len(baseline),
        "trigger": "every_treatment_context",
        "boundary": "task_local_self_harness_context",
    }


def test_first_self_harness_context_exposes_on_demand_capability_reference(tmp_path):
    from test_pi_external_benchmark_native import _run_fixture

    _run_fixture(tmp_path, "treatment", steps=[])
    expected = (PROJECT / "demo" / "prompts" / "capability_extraction_process.md").read_text(encoding="utf-8")
    first_context = json.loads(
        (tmp_path / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()[0]
    )["context"]
    texts = [
        part["text"]
        for message in first_context["messages"]
        for part in message.get("content", [])
        if part.get("type") == "text"
    ]
    first_exposure = json.loads(
        (tmp_path / "task-harness-context-exposures.jsonl").read_text(encoding="utf-8").splitlines()[0]
    )
    process = next(item for item in first_exposure["guidance_exposures"]
                   if item["name"] == "capability_workflow_reference")

    assert expected not in texts
    assert any(text.startswith("Capability workflow reference:") for text in texts)
    assert process["trigger"] == "initial_discovery"


def test_guidance_descriptor_change_participates_in_exposure_signature(tmp_path):
    from test_pi_external_benchmark_native import _run_fixture

    _run_fixture(
        tmp_path, "treatment",
        extra_extensions=[PROJECT / "tests" / "pi_periodic_review_fixture.ts"],
        steps=[{"name": "arc_action", "arguments": {}} for _ in range(5)],
    )
    exposures = [json.loads(line) for line in
                 (tmp_path / "task-harness-context-exposures.jsonl").read_text(encoding="utf-8").splitlines()]
    guidance_names = [
        {item["name"] for item in exposure["guidance_exposures"]}
        for exposure in exposures
    ]

    assert guidance_names[0] == {"baseline_authoring_methods", "capability_workflow_reference"}
    assert any(names == {"baseline_authoring_methods"} for names in guidance_names[1:])
    assert guidance_names[-1] == {"baseline_authoring_methods", "capability_workflow_reference", "periodic_pattern_review"}
    cue = next(item for item in exposures[-1]["guidance_exposures"] if item["name"] == "periodic_pattern_review")
    assert cue["window_ids"] == ["arc-pattern-5"]
    provider_rows = [json.loads(line) for line in
                     (tmp_path / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()]
    latest_texts = [part["text"] for message in provider_rows[-1]["context"]["messages"]
                    for part in message.get("content", []) if part.get("type") == "text"]
    induction = (PROJECT / "demo/prompts/state_transition_induction.md").read_text(encoding="utf-8")
    assert any("inspect(section=review_contract)" in text for text in latest_texts)
    assert not any(induction in text for text in latest_texts)
    assert not any("Periodic pattern extraction is due before the next ARC action" in text
                   for text in latest_texts)
