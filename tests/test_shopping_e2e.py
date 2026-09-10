import json
import sys
from pathlib import Path

import pytest
import autoresearch_pi.shopping_e2e as shopping_module

from autoresearch_pi.shopping_e2e import (
    _shopping_case,
    _shopping_tool_payload,
    shopping_evaluator,
    run_shopping_tool,
    run_shopping_e2e,
    run_shopping_e2e_experiment,
)


def _write_fake_jit_shopping_contract(root: Path) -> None:
    adapter = root / "benchmark" / "adapter" / "deepplanning.py"
    adapter.parent.mkdir(parents=True)
    adapter.write_text(
        '''SHOPPING_SYSTEM_PROMPT_L1 = "LEVEL ONE: choose the absolute lowest final price."
SHOPPING_SYSTEM_PROMPT_L2 = "LEVEL TWO: respect the budget, then minimize price."
SHOPPING_SYSTEM_PROMPT_L3 = "LEVEL THREE: inspect available coupons and add selected coupons to the cart."
SHOPPING_PROMPTS = {
    "1": SHOPPING_SYSTEM_PROMPT_L1,
    "2": SHOPPING_SYSTEM_PROMPT_L2,
    "3": SHOPPING_SYSTEM_PROMPT_L3,
}
''',
        encoding="utf-8",
    )


@pytest.mark.parametrize(
    ("level", "expected", "excluded"),
    [
        ("1", "absolute lowest final price", "respect the budget"),
        ("2", "respect the budget", "available coupons"),
        ("3", "add selected coupons to the cart", "LEVEL TWO"),
    ],
)
def test_loads_each_canonical_jit_shopping_contract(
    tmp_path: Path, level: str, expected: str, excluded: str,
):
    _write_fake_jit_shopping_contract(tmp_path)

    prompt = shopping_module._load_jit_shopping_system_prompt(tmp_path, level)

    assert expected in prompt
    assert excluded not in prompt


def test_formats_canonical_contract_and_raw_user_request_without_evaluator_data(tmp_path: Path):
    _write_fake_jit_shopping_contract(tmp_path)

    prompt = shopping_module._format_jit_shopping_task(tmp_path, level="3", question="choose products")

    assert prompt == (
        "LEVEL THREE: inspect available coupons and add selected coupons to the cart."
        "\n\n## User Request\n\nchoose products"
    )
    assert "validation_cases" not in prompt
    assert "ground_truth" not in prompt


def test_shopping_case_loads_level3_query_and_isolates_cart(tmp_path: Path):
    item = {
        "id": "1",
        "query": "choose products",
    }
    dataset = tmp_path / "dataset"
    (dataset / "data").mkdir(parents=True)
    (dataset / "database_level3" / "case_1").mkdir(parents=True)
    (dataset / "data" / "level_3_query_meta.json").write_text(
        json.dumps([item]), encoding="utf-8"
    )
    (dataset / "database_level3" / "case_1" / "validation_cases.json").write_text(
        "{}", encoding="utf-8"
    )

    case = _shopping_case(dataset, level="3", case_id="1", root=tmp_path / "run")

    assert case["question_id"] == "level3_case1"
    assert case["level"] == "3"
    assert case["db_dir"].endswith("database_level3\\case_1") or case["db_dir"].endswith("database_level3/case_1")
    assert case["cart_path"] == str(tmp_path / "run" / "cart.json")


def test_shopping_tool_payload_is_bounded_to_one_domain_action():
    payload = _shopping_tool_payload(
        db_dir="D:/db", cart_path="D:/run/cart.json",
        tool="get_user_info", arguments={"user_id": None},
    )
    assert payload == {
        "db_dir": "D:/db", "cart_path": "D:/run/cart.json",
        "tool": "get_user_info", "arguments": {"user_id": None},
    }
    with pytest.raises(ValueError):
        _shopping_tool_payload(
            db_dir="D:/db", cart_path="D:/run/cart.json",
            tool="execute_code", arguments={},
        )


def test_shopping_evaluator_reads_run_local_cart(tmp_path: Path):
    dataset = tmp_path / "dataset"
    case = dataset / "database_level3" / "case_1"
    case.mkdir(parents=True)
    (case / "validation_cases.json").write_text(json.dumps({"ground_truth_products": [], "ground_truth_coupons": {}}), encoding="utf-8")
    cart = tmp_path / "run" / "cart.json"
    cart.parent.mkdir()
    cart.write_text(json.dumps({"items": [], "used_coupons": []}), encoding="utf-8")
    result = shopping_evaluator(db_dir=str(case), cart_path=str(cart), jit_root=Path(r"D:\JIT"), python=r"D:\anaconda\envs\jit\python.exe")
    assert result["case_score"] == 1.0


def test_shopping_bridge_preserves_unicode_output(tmp_path: Path):
    dataset = Path(r"D:\JIT\dataset\deepplanning_shopping")
    if not (dataset / "database_level3" / "case_1").is_dir():
        pytest.skip("JIT shopping dataset unavailable")
    case = _shopping_case(dataset, level="3", case_id="1", root=tmp_path / "run")
    output = run_shopping_tool(
        {"db_dir": case["db_dir"], "cart_path": case["cart_path"], "tool": "get_user_info", "arguments": {}},
        jit_root=Path(r"D:\JIT"), python=r"D:\anaconda\envs\jit\python.exe",
    )
    assert "username" in output


def test_shopping_bridge_preserves_cart_across_one_action_processes(tmp_path: Path):
    dataset = Path(r"D:\JIT\dataset\deepplanning_shopping")
    if not (dataset / "database_level3" / "case_1").is_dir():
        pytest.skip("JIT shopping dataset unavailable")
    case = _shopping_case(dataset, level="3", case_id="1", root=tmp_path / "run")
    product = json.loads((Path(case["db_dir"]) / "products.jsonl").read_text(encoding="utf-8").splitlines()[0])["product_id"]
    run_shopping_tool({"db_dir": case["db_dir"], "cart_path": case["cart_path"], "tool": "add_product_to_cart", "arguments": {"product_id": product, "quantity": 1}}, jit_root=Path(r"D:\JIT"), python=r"D:\anaconda\envs\jit\python.exe")
    cart = json.loads(run_shopping_tool({"db_dir": case["db_dir"], "cart_path": case["cart_path"], "tool": "get_cart_info", "arguments": {}}, jit_root=Path(r"D:\JIT"), python=r"D:\anaconda\envs\jit\python.exe"))
    assert [item["product_id"] for item in cart["items"]] == [product]


def test_shopping_batch_bridge_executes_multiple_cart_writes_in_one_process(tmp_path: Path):
    """Catches a batch implementation that spawns one bridge per cart item."""
    dataset = Path(r"D:\JIT\dataset\deepplanning_shopping")
    if not (dataset / "database_level3" / "case_1").is_dir():
        pytest.skip("JIT shopping dataset unavailable")
    case = _shopping_case(dataset, level="3", case_id="1", root=tmp_path / "run")
    product_ids = [
        json.loads(line)["product_id"]
        for line in (Path(case["db_dir"]) / "products.jsonl").read_text(encoding="utf-8").splitlines()[:2]
    ]

    output = run_shopping_tool(
        {
            "db_dir": case["db_dir"],
            "cart_path": case["cart_path"],
            "tool": "shopping_batch_action",
            "arguments": {"items": [
                {"product_id": product_ids[0], "quantity": 1},
                {"product_id": product_ids[1], "quantity": 1},
            ]},
        },
        jit_root=Path(r"D:\JIT"),
        python=r"D:\anaconda\envs\jit\python.exe",
    )

    result = json.loads(output)
    cart = json.loads(Path(case["cart_path"]).read_text(encoding="utf-8"))
    assert result["bridge_processes"] == 1
    assert result["attempted"] == 2
    assert result["completed"] == 2
    assert [item["outcome"] for item in result["results"]] == ["success", "success"]
    assert [item["product_id"] for item in cart["items"]] == product_ids


def test_shopping_e2e_runner_keeps_evaluator_and_agent_outcomes_separate(monkeypatch, tmp_path: Path):
    dataset = tmp_path / "dataset"
    case_dir = dataset / "database_level3" / "case_1"
    (dataset / "data").mkdir(parents=True)
    case_dir.mkdir(parents=True)
    (dataset / "data" / "level_3_query_meta.json").write_text(json.dumps([{"id": "1", "query": "buy one item"}]), encoding="utf-8")
    (case_dir / "validation_cases.json").write_text(json.dumps({"ground_truth_products": [], "ground_truth_coupons": {}}), encoding="utf-8")
    (case_dir / "products.jsonl").write_text("", encoding="utf-8")
    (case_dir / "user_info.json").write_text("{}", encoding="utf-8")

    class FakeResult:
        model = "fixture"
        answer = "done"
        agent_succeeded = True
        agent_error = ""

    monkeypatch.setattr("autoresearch_pi.shopping_e2e._run_pi_shopping_task", lambda *args, **kwargs: FakeResult())
    result = run_shopping_e2e(tmp_path / "runs" / "case", dataset=dataset, level="3", case_id="1")
    summary = json.loads(result.read_text(encoding="utf-8"))
    assert summary["pi_agent_succeeded"] is True
    assert summary["evaluator_passed"] is True
    assert summary["passed"] is True
    assert summary["harness_improvement"] == "not_established"


def test_shopping_e2e_runner_persists_failure_summary(monkeypatch, tmp_path: Path):
    dataset = tmp_path / "dataset"
    case_dir = dataset / "database_level3" / "case_1"
    (dataset / "data").mkdir(parents=True)
    case_dir.mkdir(parents=True)
    (dataset / "data" / "level_3_query_meta.json").write_text(json.dumps([{"id": "1", "query": "buy one item"}]), encoding="utf-8")
    (case_dir / "validation_cases.json").write_text(json.dumps({"ground_truth_products": [], "ground_truth_coupons": {}}), encoding="utf-8")
    (case_dir / "products.jsonl").write_text("", encoding="utf-8")
    (case_dir / "user_info.json").write_text("{}", encoding="utf-8")

    def fail(*args, **kwargs):
        raise TimeoutError("agent timed out after tool exploration")

    summary_path = run_shopping_e2e(tmp_path / "runs" / "failed", dataset=dataset, level="3", case_id="1", pi_runner=fail)
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    assert summary["status"] == "failed"
    assert summary["pi_agent_succeeded"] is False
    assert "timed out" in summary["pi_agent_error"]
    assert summary["evaluator_passed"] is False
    assert summary["harness_improvement"] == "not_established"


def test_shopping_native_timeout_keeps_partial_events(monkeypatch, tmp_path: Path):
    from autoresearch_pi import shopping_e2e

    _write_fake_jit_shopping_contract(tmp_path)

    class FakeKernel:
        def __init__(self, *args, event_sink=None, **kwargs):
            self.sink = event_sink
        def __enter__(self):
            self.sink({"type": "tool_call", "name": "search_products"})
            return self
        def __exit__(self, *_):
            return False
        def prompt(self, message):
            return {"success": True}
        def wait_for_agent_events(self, **kwargs):
            raise TimeoutError("partial turn timeout")

    monkeypatch.setattr(shopping_e2e, "PiKernel", FakeKernel)
    monkeypatch.setattr(shopping_e2e, "_resolve_pi_cli", lambda: ("node", "pi.js"))
    monkeypatch.setenv("OPENAI_API_BASE", "http://example.invalid")
    monkeypatch.setenv("OPENAI_API_KEY", "test")
    monkeypatch.setenv("JIT_ROOT", str(tmp_path))
    monkeypatch.setenv("JIT_PYTHON", sys.executable)
    case = {
        "question_id": "level3_case1", "level": "3", "case_id": "1",
        "question": "q", "db_dir": str(tmp_path),
        "cart_path": str(tmp_path / "cart.json"),
    }
    result = shopping_e2e._run_pi_shopping_task(tmp_path / "run", case, timeout=1)
    assert result.agent_succeeded is False
    assert "partial turn timeout" in result.agent_error
    assert result.events == ({"type": "tool_call", "name": "search_products"},)
    trace = tmp_path / "run" / "pi-events.jsonl"
    assert json.loads(trace.read_text(encoding="utf-8").splitlines()[0])["type"] == "tool_call"
    status = json.loads((tmp_path / "run" / "pi-runtime-status.json").read_text(encoding="utf-8"))
    assert status["status"] == "interrupted"
    assert status["trace_complete"] is False
    assert status["trace_format"] == "compact-jsonl-v1"


def test_shopping_native_submits_canonical_task_contract_and_records_digest(monkeypatch, tmp_path: Path):
    from autoresearch_pi import shopping_e2e

    _write_fake_jit_shopping_contract(tmp_path)
    prompts = []

    class FakeKernel:
        def __init__(self, *args, **kwargs):
            pass
        def __enter__(self):
            return self
        def __exit__(self, *_):
            return False
        def prompt(self, message):
            prompts.append(message)
            return {"success": True}
        def wait_for_agent_events(self, **kwargs):
            return []

    monkeypatch.setattr(shopping_e2e, "PiKernel", FakeKernel)
    monkeypatch.setattr(shopping_e2e, "_resolve_pi_cli", lambda: ("node", "pi.js"))
    monkeypatch.setenv("OPENAI_API_BASE", "http://example.invalid")
    monkeypatch.setenv("OPENAI_API_KEY", "test")
    monkeypatch.setenv("JIT_ROOT", str(tmp_path))
    monkeypatch.setenv("JIT_PYTHON", sys.executable)
    case = {
        "question_id": "level3_case1", "level": "3", "case_id": "1",
        "question": "choose products", "db_dir": str(tmp_path),
        "cart_path": str(tmp_path / "cart.json"),
    }

    shopping_e2e._run_pi_shopping_task(tmp_path / "run-contract", case, timeout=1)

    assert prompts == [
        "LEVEL THREE: inspect available coupons and add selected coupons to the cart."
        "\n\n## User Request\n\nchoose products"
    ]
    contract = json.loads((tmp_path / "run-contract" / "task-contract.json").read_text(encoding="utf-8"))
    assert contract["status"] == "canonical"
    assert contract["level"] == "3"
    assert contract["source"].endswith("benchmark/adapter/deepplanning.py")
    assert len(contract["system_prompt_sha256"]) == 64
    assert len(contract["task_prompt_sha256"]) == 64


def test_shopping_e2e_runner_exposes_variant_without_controlling_agent(monkeypatch, tmp_path: Path):
    dataset = tmp_path / "dataset"
    case_dir = dataset / "database_level2" / "case_1"
    (dataset / "data").mkdir(parents=True)
    case_dir.mkdir(parents=True)
    (dataset / "data" / "level_2_query_meta.json").write_text(json.dumps([{"id": "1", "query": "buy one item"}]), encoding="utf-8")
    (case_dir / "validation_cases.json").write_text(json.dumps({"ground_truth_products": [], "ground_truth_coupons": {}}), encoding="utf-8")
    (case_dir / "products.jsonl").write_text("", encoding="utf-8")
    (case_dir / "user_info.json").write_text("{}", encoding="utf-8")
    class FakeResult:
        model = "fixture"; answer = "done"; agent_succeeded = True; agent_error = ""; events = ()
    seen = []
    def fake_runner(root, case, *, timeout, experiment_variant):
        seen.append(experiment_variant)
        return FakeResult()
    monkeypatch.setattr("autoresearch_pi.shopping_e2e.shopping_evaluator", lambda **kwargs: {"score": 1.0, "case_score": 1.0})
    summary_path = run_shopping_e2e(tmp_path / "runs" / "variant", dataset=dataset, level="2", case_id="1", pi_runner=fake_runner, experiment_variant="control")
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    assert seen == ["control"]
    assert summary["experiment"]["variant"] == "control"
    assert summary["experiment"]["agent_visible_attribution"] is False
    assert "observation_projection" not in summary["experiment"]


def test_shopping_summary_projects_declared_research_and_effect_counts(monkeypatch, tmp_path: Path):
    dataset = tmp_path / "dataset"
    case_dir = dataset / "database_level2" / "case_1"
    (dataset / "data").mkdir(parents=True)
    case_dir.mkdir(parents=True)
    (dataset / "data" / "level_2_query_meta.json").write_text(json.dumps([{"id": "1", "query": "buy one item"}]), encoding="utf-8")
    (case_dir / "validation_cases.json").write_text(json.dumps({"ground_truth_products": [], "ground_truth_coupons": {}}), encoding="utf-8")
    (case_dir / "products.jsonl").write_text("", encoding="utf-8")
    (case_dir / "user_info.json").write_text("{}", encoding="utf-8")
    class FakeResult:
        model = "fixture"; answer = "done"; agent_succeeded = True; agent_error = ""
        events = ({"type": "message_end", "message": {"role": "assistant", "content": [
            {"type": "toolCall", "id": "direct-call", "name": "add_product_to_cart"},
        ]}}, {"type": "message_end", "message": {"role": "assistant", "content": [
            {"type": "toolCall", "id": "call-1", "name": "research_resource"},
        ]}}, {"type": "message_end", "message": {"role": "assistant", "content": [
            {"type": "toolCall", "id": "batch-call", "name": "shopping_batch_action"},
        ]}})
    def fake_runner(root, case, *, timeout, experiment_variant):
        observations = [
            {"event_id": "shopping-observation-1", "toolCallId": "direct-call", "tool": "add_product_to_cart", "category": "task_action", "outcome": "success", "attempted_work_units": 1, "completed_work_units": 1, "recordedAt": "2026-01-01T00:00:00Z"},
            {"event_id": "shopping-observation-2", "toolCallId": "batch-call", "tool": "shopping_batch_action", "category": "task_action", "outcome": "success", "attempted_work_units": 2, "completed_work_units": 2, "bridge_processes": 1, "recordedAt": "2026-01-01T00:00:02Z"},
        ]
        (root / "execution-observations.jsonl").write_text("".join(json.dumps(item) + "\n" for item in observations), encoding="utf-8")
        (root / "research-resources.jsonl").write_text(json.dumps({"finding_id": "finding-1", "goal_id": "research-goal-1", "version": 1, "status": "active", "evidence_refs": ["shopping-observation-1"]}) + "\n", encoding="utf-8")
        snapshot = {"finding_id": "finding-1", "version": 1}
        (root / "harness-decisions.jsonl").write_text(json.dumps({"decision_id": "decision-1", "toolCallId": "call-1", "value": "shopping_batch", "applied": True, "effect_metric": "shopping_batch_utilization", "basis_resource_ids": ["finding-1"], "basis_snapshots": [snapshot]}) + "\n", encoding="utf-8")
        (root / "harness-observations.jsonl").write_text(json.dumps({"decision_id": "decision-1", "toolCallId": "call-1", "basis_resource_ids": ["finding-1"], "effect_observed": True, "operation": {"capability": "pi.setActiveTools"}, "recordedAt": "2026-01-01T00:00:01Z"}) + "\n", encoding="utf-8")
        (root / "effect-assessments.jsonl").write_text(json.dumps({"effect_assessment_id": "effect-assessment-1", "decision_id": "decision-1", "toolCallId": "call-1", "effect_metric": "shopping_batch_utilization", "verdict": "supported", "window": {"observation_ids": ["shopping-observation-2"], "attempted_work_units": 2, "completed_work_units": 2, "pi_tool_calls": 1, "batch_calls": 1, "tool_call_compression": 2.0, "bridge_processes": 1, "work_units_per_bridge_process": 2.0}}) + "\n", encoding="utf-8")
        return FakeResult()
    monkeypatch.setattr("autoresearch_pi.shopping_e2e.shopping_evaluator", lambda **kwargs: {"score": 1.0, "case_score": 1.0})
    summary = json.loads(run_shopping_e2e(tmp_path / "runs" / "projection", dataset=dataset, level="2", case_id="1", pi_runner=fake_runner).read_text(encoding="utf-8"))
    assert summary["research"]["finding_count"] == 1
    assert summary["research"]["research_connection"] == "apply_effect_observed"
    assert summary["execution_condition_effect"]["status"] == "supported"
    assert summary["execution_condition_effect"]["integrity_issues"] == []
    assert summary["execution_efficiency"]["backend_bridge_processes"] == 2
    assert summary["execution_efficiency"]["attempted_work_units"] == 3
    assert summary["execution_efficiency"]["work_units_per_bridge_process"] == 1.5
    assert summary["execution_efficiency"]["response_profile"]["first_applied_decision_response"] == 2


def test_shopping_summary_independently_projects_context_compaction_effect(monkeypatch, tmp_path: Path):
    """Catches a native context effect remaining invisible or unaudited in summary.json."""
    dataset = tmp_path / "dataset"
    case_dir = dataset / "database_level2" / "case_1"
    (dataset / "data").mkdir(parents=True)
    case_dir.mkdir(parents=True)
    (dataset / "data" / "level_2_query_meta.json").write_text(
        json.dumps([{"id": "1", "query": "buy one item"}]), encoding="utf-8",
    )
    (case_dir / "validation_cases.json").write_text(
        json.dumps({"ground_truth_products": [], "ground_truth_coupons": {}}), encoding="utf-8",
    )
    (case_dir / "products.jsonl").write_text("", encoding="utf-8")
    (case_dir / "user_info.json").write_text("{}", encoding="utf-8")
    marker = (
        "[Task-local observation shopping-observation-1 compacted by finding-1@v1; "
        "the complete result remains in execution-observations.jsonl and is recoverable by exact ID.]"
    )

    class FakeResult:
        model = "fixture"
        answer = "done"
        agent_succeeded = True
        agent_error = ""
        events = ({
            "type": "tool_execution_end", "toolCallId": "detail-call",
            "toolName": "get_product_details", "result": {
                "content": [{"type": "text", "text": "A" * 300}],
                "details": {"observation": {"event_id": "shopping-observation-1"}},
            },
        },)

    def fake_runner(root, case, *, timeout, experiment_variant):
        (root / "execution-observations.jsonl").write_text(json.dumps({
            "event_id": "shopping-observation-1", "toolCallId": "detail-call",
            "tool": "get_product_details", "category": "task_action", "result": "canonical result",
            "attempted_work_units": 1, "completed_work_units": 1,
        }) + "\n", encoding="utf-8")
        finding_v1 = {
            "finding_id": "finding-1", "goal_id": "research-goal-1", "version": 1,
            "status": "active", "research_event_id": "research-event-1",
            "question": "Can later context retain the conclusion without the full result?",
            "evidence": "The cited result is large and its needed conclusion is preserved.",
            "decision": "Compact only the cited observation.",
            "evidence_refs": ["shopping-observation-1"],
        }
        finding_v2 = {
            **finding_v1, "version": 2, "status": "resolved",
            "assessment_refs": ["effect-assessment-1"], "resolution": "supported",
        }
        (root / "research-resources.jsonl").write_text(
            json.dumps(finding_v1) + "\n" + json.dumps(finding_v2) + "\n", encoding="utf-8",
        )
        snapshot = {"finding_id": "finding-1", "version": 1}
        (root / "harness-decisions.jsonl").write_text(json.dumps({
            "decision_id": "decision-1", "toolCallId": "compact-call", "applied": True,
            "effect_metric": "model_visible_observation_chars_removed",
            "basis_resource_ids": ["finding-1"], "basis_snapshots": [snapshot],
            "operation": {"capability": "pi.context", "observation_ids": ["shopping-observation-1"]},
        }) + "\n", encoding="utf-8")
        (root / "harness-observations.jsonl").write_text(json.dumps({
            "observation_id": "shopping-harness-observation-1",
            "decision_id": "decision-1", "toolCallId": "compact-call", "effect_observed": True,
            "basis_resource_ids": ["finding-1"],
            "operation": {"capability": "pi.context", "value": "exact_observation_reference", "observation_ids": ["shopping-observation-1"]},
        }) + "\n", encoding="utf-8")
        (root / "effect-assessments.jsonl").write_text(json.dumps({
            "effect_assessment_id": "effect-assessment-1", "decision_id": "decision-1",
            "toolCallId": "compact-call", "effect_metric": "model_visible_observation_chars_removed",
            "verdict": "supported", "window": {
                "observation_ids": ["shopping-observation-1"],
                "matched_observation_ids": ["shopping-observation-1"],
                "original_chars": 300, "replacement_chars": len(marker),
                "removed_chars": 300 - len(marker), "boundary": "next_model_request",
            },
        }) + "\n", encoding="utf-8")
        return FakeResult()

    monkeypatch.setattr(
        "autoresearch_pi.shopping_e2e.shopping_evaluator",
        lambda **kwargs: {"score": 1.0, "case_score": 1.0},
    )
    summary = json.loads(run_shopping_e2e(
        tmp_path / "runs" / "context-projection", dataset=dataset, level="2", case_id="1",
        pi_runner=fake_runner,
    ).read_text(encoding="utf-8"))

    assert summary["research"]["research_connection"] == "apply_effect_observed"
    assert summary["execution_condition_effect"]["status"] == "supported"
    assert summary["execution_condition_effect"]["supported_effect_metrics"] == [
        "model_visible_observation_chars_removed",
    ]
    assert summary["execution_condition_effect"]["context_compaction"] == {
        "reported_assessment_count": 1,
        "supported_assessment_count": 1,
        "independently_recomputed_removed_chars": 300 - len(marker),
    }
    assert summary["execution_condition_effect"]["integrity_issues"] == []
    loop = summary["closed_loop_evidence"]
    assert loop["chain_count"] == 1
    assert loop["observation_bodies"] == "canonical_jsonl_only"
    assert loop["chains"][0]["decision_id"] == "decision-1"
    assert loop["chains"][0]["basis"][0] == {
        "goal_id": "research-goal-1",
        "finding_id": "finding-1",
        "version": 1,
        "question": "Can later context retain the conclusion without the full result?",
        "evidence": "The cited result is large and its needed conclusion is preserved.",
        "decision": "Compact only the cited observation.",
        "evidence_refs": ["shopping-observation-1"],
        "assessment_refs": [],
        "status": "active",
        "resolution": None,
    }
    assert loop["chains"][0]["operation"]["capability"] == "pi.context"
    assert loop["chains"][0]["exposure_ids"] == ["shopping-harness-observation-1"]
    assert loop["chains"][0]["assessment_ids"] == ["effect-assessment-1"]
    assert loop["chains"][0]["absorbed_by"][0]["version"] == 2
    assert loop["chains"][0]["absorbed_by"][0]["status"] == "resolved"
    assert loop["standalone_finding_versions"] == []


def test_shopping_summary_projects_literal_model_input_token_cost(monkeypatch, tmp_path: Path):
    """Catches a context optimization being evaluated without its provider-input cost."""
    dataset = tmp_path / "dataset"
    case_dir = dataset / "database_level1" / "case_1"
    (dataset / "data").mkdir(parents=True)
    case_dir.mkdir(parents=True)
    (dataset / "data" / "level_1_query_meta.json").write_text(
        json.dumps([{"id": "1", "query": "buy one item"}]), encoding="utf-8",
    )
    (case_dir / "validation_cases.json").write_text(
        json.dumps({"ground_truth_products": [], "ground_truth_coupons": {}}), encoding="utf-8",
    )
    (case_dir / "products.jsonl").write_text("", encoding="utf-8")
    (case_dir / "user_info.json").write_text("{}", encoding="utf-8")

    class FakeResult:
        model = "fixture"
        answer = "done"
        agent_succeeded = True
        agent_error = ""
        events = (
            {"type": "message_end", "message": {"role": "assistant", "content": [], "usage": {"input": 120, "output": 10}}},
            {"type": "message_end", "message": {"role": "assistant", "content": [], "usage": {"input": 80, "output": 5}}},
        )

    def fake_runner(root, case, *, timeout, experiment_variant):
        return FakeResult()

    monkeypatch.setattr(
        "autoresearch_pi.shopping_e2e.shopping_evaluator",
        lambda **kwargs: {"score": 1.0, "case_score": 1.0},
    )
    summary = json.loads(run_shopping_e2e(
        tmp_path / "runs" / "token-cost", dataset=dataset, level="1", case_id="1",
        pi_runner=fake_runner,
    ).read_text(encoding="utf-8"))

    assert summary["execution_efficiency"]["model_input_tokens"] == 200
    assert summary["execution_efficiency"]["model_output_tokens"] == 15
    assert summary["execution_efficiency"]["provider_requests_with_usage"] == 2


def test_shopping_variant_metrics_preserve_model_input_token_cost():
    """Catches paired projection dropping the cost affected by context compaction."""
    metrics = shopping_module._shopping_variant_metrics({
        "execution_efficiency": {
            "model_input_tokens": 321,
            "model_output_tokens": 12,
            "provider_requests_with_usage": 4,
        },
        "execution_condition_effect": {"context_compaction": {
            "supported_assessment_count": 1,
            "independently_recomputed_removed_chars": 987,
        }},
    })

    assert metrics["model_input_tokens"] == 321
    assert metrics["model_output_tokens"] == 12
    assert metrics["provider_requests_with_usage"] == 4
    assert metrics["context_compaction_supported_assessments"] == 1
    assert metrics["context_compaction_removed_chars"] == 987


def test_shopping_effect_audit_rejects_batch_that_used_multiple_bridge_processes():
    """Catches a Pi-call-only compression result masquerading as bridge compression."""
    observations = [{
        "event_id": "shopping-observation-2", "tool": "shopping_batch_action",
        "attempted_work_units": 2, "completed_work_units": 2, "bridge_processes": 2,
        "recordedAt": "2026-01-01T00:00:02Z",
    }]
    findings = [{"finding_id": "finding-1", "version": 1}]
    snapshot = {"finding_id": "finding-1", "version": 1}
    decisions = [{
        "decision_id": "decision-1", "toolCallId": "call-1", "value": "shopping_batch",
        "applied": True, "effect_metric": "shopping_batch_utilization",
        "basis_resource_ids": ["finding-1"], "basis_snapshots": [snapshot],
    }]
    exposures = [{
        "decision_id": "decision-1", "toolCallId": "call-1", "effect_observed": True,
        "basis_resource_ids": ["finding-1"], "operation": {"capability": "pi.setActiveTools"},
        "recordedAt": "2026-01-01T00:00:01Z",
    }]
    assessments = [{
        "effect_assessment_id": "effect-1", "decision_id": "decision-1",
        "toolCallId": "call-1", "effect_metric": "shopping_batch_utilization",
        "verdict": "supported", "window": {
            "observation_ids": ["shopping-observation-2"], "attempted_work_units": 2,
            "completed_work_units": 2, "pi_tool_calls": 1, "batch_calls": 1,
            "tool_call_compression": 2.0, "bridge_processes": 1,
            "work_units_per_bridge_process": 2.0,
        },
    }]

    supported, issues = shopping_module._audit_shopping_effects(
        observations, findings, decisions, exposures, assessments,
    )

    assert supported == []
    assert "effect-1:window_bridge_processes_mismatch" in issues


def test_shopping_effect_audit_requires_explicit_batch_bridge_process_count():
    """Catches a missing batch process fact being silently defaulted to one."""
    observations = [{
        "event_id": "shopping-observation-2", "tool": "shopping_batch_action",
        "attempted_work_units": 2, "completed_work_units": 2,
        "recordedAt": "2026-01-01T00:00:02Z",
    }]
    findings = [{"finding_id": "finding-1", "version": 1}]
    decisions = [{
        "decision_id": "decision-1", "toolCallId": "call-1", "value": "shopping_batch",
        "applied": True, "effect_metric": "shopping_batch_utilization",
        "basis_resource_ids": ["finding-1"],
        "basis_snapshots": [{"finding_id": "finding-1", "version": 1}],
    }]
    exposures = [{
        "decision_id": "decision-1", "toolCallId": "call-1", "effect_observed": True,
        "basis_resource_ids": ["finding-1"], "operation": {"capability": "pi.setActiveTools"},
        "recordedAt": "2026-01-01T00:00:01Z",
    }]
    assessments = [{
        "effect_assessment_id": "effect-1", "decision_id": "decision-1",
        "toolCallId": "call-1", "effect_metric": "shopping_batch_utilization",
        "verdict": "supported", "window": {
            "observation_ids": ["shopping-observation-2"], "attempted_work_units": 2,
            "completed_work_units": 2, "pi_tool_calls": 1, "batch_calls": 1,
            "tool_call_compression": 2.0, "bridge_processes": 1,
            "work_units_per_bridge_process": 2.0,
        },
    }]

    supported, issues = shopping_module._audit_shopping_effects(
        observations, findings, decisions, exposures, assessments,
    )

    assert supported == []
    assert "effect-1:missing_batch_bridge_process_count" in issues


def test_shopping_response_profile_locates_repeated_actions_around_decision():
    """Catches response grouping that treats same-response actions as post-intervention."""
    events = [
        {"type": "message_end", "message": {"role": "assistant", "content": [
            {"type": "toolCall", "id": "add-1", "name": "add_product_to_cart"},
        ]}},
        {"type": "message_end", "message": {"role": "assistant", "content": [
            {"type": "toolCall", "id": "decision-call", "name": "research_resource"},
            {"type": "toolCall", "id": "add-2", "name": "add_product_to_cart"},
        ]}},
        {"type": "message_end", "message": {"role": "assistant", "content": [
            {"type": "toolCall", "id": "add-3", "name": "add_product_to_cart"},
        ]}},
    ]
    observations = [
        {"event_id": "shopping-observation-1", "toolCallId": "add-1", "tool": "add_product_to_cart", "operation": "add_product_to_cart", "category": "task_action", "attempted_work_units": 1},
        {"event_id": "shopping-observation-2", "toolCallId": "add-2", "tool": "add_product_to_cart", "operation": "add_product_to_cart", "category": "task_action", "attempted_work_units": 1},
        {"event_id": "shopping-observation-3", "toolCallId": "add-3", "tool": "add_product_to_cart", "operation": "add_product_to_cart", "category": "task_action", "attempted_work_units": 1},
    ]
    decisions = [{"toolCallId": "decision-call", "applied": True}]

    profile = shopping_module._shopping_execution_response_profile(
        events, observations, decisions,
    )

    assert profile["agent_visible"] is False
    assert profile["candidate_inference"] == "none"
    assert profile["first_applied_decision_response"] == 2
    assert profile["repeated_action_groups"] == [{
        "tool": "add_product_to_cart", "operation": "add_product_to_cart",
        "calls": 3, "attempted_work_units": 3, "assistant_responses": 3,
        "max_calls_in_one_response": 1, "all_calls_issued_in_one_response": False,
        "calls_before_decision_response": 1, "calls_in_decision_response": 1,
        "calls_after_decision_response": 1, "response_mapping_complete": True,
    }]


def test_shopping_summary_rejects_effect_linked_to_a_different_decision(monkeypatch, tmp_path: Path):
    dataset = tmp_path / "dataset"
    case_dir = dataset / "database_level2" / "case_1"
    (dataset / "data").mkdir(parents=True)
    case_dir.mkdir(parents=True)
    (dataset / "data" / "level_2_query_meta.json").write_text(json.dumps([{"id": "1", "query": "buy two"}]), encoding="utf-8")
    (case_dir / "validation_cases.json").write_text(json.dumps({"ground_truth_products": [], "ground_truth_coupons": {}}), encoding="utf-8")
    (case_dir / "products.jsonl").write_text("", encoding="utf-8")
    (case_dir / "user_info.json").write_text("{}", encoding="utf-8")

    class FakeResult:
        model = "fixture"; answer = "done"; agent_succeeded = True; agent_error = ""; events = ()

    def fake_runner(root, case, *, timeout, experiment_variant):
        root.mkdir(parents=True, exist_ok=True)
        (root / "research-resources.jsonl").write_text(json.dumps({"finding_id": "finding-1", "goal_id": "research-goal-1", "version": 1, "status": "active", "evidence_refs": ["shopping-observation-1"]}) + "\n", encoding="utf-8")
        (root / "harness-decisions.jsonl").write_text(json.dumps({"decision_id": "decision-1", "toolCallId": "call-1", "applied": True, "effect_metric": "shopping_batch_utilization"}) + "\n", encoding="utf-8")
        (root / "harness-observations.jsonl").write_text(json.dumps({"decision_id": "decision-1", "toolCallId": "call-1", "effect_observed": True}) + "\n", encoding="utf-8")
        # A supported result for decision-2 must not close decision-1's chain.
        (root / "effect-assessments.jsonl").write_text(json.dumps({"effect_assessment_id": "effect-1", "decision_id": "decision-2", "toolCallId": "call-2", "effect_metric": "shopping_batch_utilization", "verdict": "supported", "window": {"observation_ids": []}}) + "\n", encoding="utf-8")
        return FakeResult()

    monkeypatch.setattr("autoresearch_pi.shopping_e2e.shopping_evaluator", lambda **kwargs: {"score": 1.0, "case_score": 1.0})
    summary = json.loads(run_shopping_e2e(tmp_path / "runs" / "invalid-link", dataset=dataset, level="2", case_id="1", pi_runner=fake_runner).read_text(encoding="utf-8"))
    assert summary["research"]["research_connection"] != "apply_effect_observed"
    assert summary["execution_condition_effect"]["status"] == "invalid_link"
    assert summary["execution_condition_effect"]["integrity_issues"]


def test_shopping_effect_keeps_behavior_and_correctness_separate(monkeypatch, tmp_path: Path):
    dataset = tmp_path / "dataset"
    case_dir = dataset / "database_level2" / "case_1"
    (dataset / "data").mkdir(parents=True)
    case_dir.mkdir(parents=True)
    (dataset / "data" / "level_2_query_meta.json").write_text(json.dumps([{"id": "1", "query": "buy one"}]), encoding="utf-8")
    (case_dir / "validation_cases.json").write_text(json.dumps({"ground_truth_products": ["p"], "ground_truth_coupons": {}}), encoding="utf-8")
    (case_dir / "products.jsonl").write_text("", encoding="utf-8")
    (case_dir / "user_info.json").write_text("{}", encoding="utf-8")

    class FakeResult:
        model = "fixture"; answer = "done"; agent_succeeded = True; agent_error = ""; events = ()

    def fake_runner(root, case, *, timeout, experiment_variant):
        root.mkdir(parents=True, exist_ok=True)
        (root / "research-resources.jsonl").write_text(json.dumps({"finding_id": "finding-1", "version": 1}) + "\n", encoding="utf-8")
        (root / "harness-decisions.jsonl").write_text(json.dumps({"decision_id": "decision-1", "toolCallId": "call-1", "value": "shopping_batch", "applied": True, "effect_metric": "shopping_batch_utilization", "basis_resource_ids": ["finding-1"], "basis_snapshots": [{"finding_id": "finding-1", "version": 1}]}) + "\n", encoding="utf-8")
        (root / "harness-observations.jsonl").write_text(json.dumps({"decision_id": "decision-1", "toolCallId": "call-1", "basis_resource_ids": ["finding-1"], "effect_observed": True, "operation": {"capability": "pi.setActiveTools"}, "recordedAt": "2026-01-01T00:00:01Z"}) + "\n", encoding="utf-8")
        (root / "execution-observations.jsonl").write_text(json.dumps({"event_id": "shopping-observation-1", "tool": "shopping_batch_action", "attempted_work_units": 2, "completed_work_units": 2, "bridge_processes": 1, "recordedAt": "2026-01-01T00:00:02Z"}) + "\n", encoding="utf-8")
        (root / "effect-assessments.jsonl").write_text(json.dumps({"effect_assessment_id": "effect-1", "decision_id": "decision-1", "toolCallId": "call-1", "effect_metric": "shopping_batch_utilization", "verdict": "supported", "window": {"observation_ids": ["shopping-observation-1"], "attempted_work_units": 2, "completed_work_units": 2, "pi_tool_calls": 1, "batch_calls": 1, "tool_call_compression": 2.0, "bridge_processes": 1, "work_units_per_bridge_process": 2.0}}) + "\n", encoding="utf-8")
        return FakeResult()

    monkeypatch.setattr("autoresearch_pi.shopping_e2e.shopping_evaluator", lambda **kwargs: {"score": 0.2, "case_score": 0.0})
    summary = json.loads(run_shopping_e2e(tmp_path / "runs" / "gated", dataset=dataset, level="2", case_id="1", pi_runner=fake_runner).read_text(encoding="utf-8"))
    assert summary["execution_condition_effect"]["status"] == "supported"
    assert summary["execution_condition_effect"]["correctness_gated_status"] == "observed_but_correctness_failed"


def test_shopping_experiment_counterbalances_and_keeps_mediators_separate(tmp_path: Path):
    calls = []

    def fake_runner(root, *, dataset, level, case_id, timeout, experiment_variant):
        calls.append((level, case_id, experiment_variant))
        root.mkdir(parents=True, exist_ok=True)
        summary = {
            "status": "passed" if experiment_variant == "treatment" else "failed",
            "passed": experiment_variant == "treatment",
            "pi_agent_succeeded": True,
            "evaluator_passed": experiment_variant == "treatment",
            "score": 1.0 if experiment_variant == "treatment" else 0.5,
            "evaluation": {"case_score": 1.0 if experiment_variant == "treatment" else 0.5},
            "pi_agent_error": "",
            "research": {"finding_count": 1 if experiment_variant == "treatment" else 0, "research_connection": "apply_effect_observed" if experiment_variant == "treatment" else "not_attempted"},
            "self_harness": {"decision_count": 1 if experiment_variant == "treatment" else 0, "applied_decision_count": 1 if experiment_variant == "treatment" else 0, "effect_assessment_count": 1 if experiment_variant == "treatment" else 0},
            "execution_condition_effect": {"status": "supported" if experiment_variant == "treatment" else "not_attempted", "batch_observation_count": 1 if experiment_variant == "treatment" else 0},
            "execution_efficiency": {
                "model_turns": 4 if experiment_variant == "treatment" else 6,
                "model_input_tokens": 1000 if experiment_variant == "treatment" else 1500,
                "model_output_tokens": 100 if experiment_variant == "treatment" else 120,
                "provider_requests_with_usage": 4 if experiment_variant == "treatment" else 6,
                "backend_bridge_processes": 5 if experiment_variant == "treatment" else 9,
                "response_profile": {"repeated_action_groups": [{
                    "assistant_responses": 2, "max_calls_in_one_response": 3,
                }]},
            },
            "trace": {"event_count": 20 if experiment_variant == "treatment" else 30},
            "model_visible_observation": {"observation_chars": 100 if experiment_variant == "treatment" else 200, "decision_support_cards": 1 if experiment_variant == "treatment" else 0},
            "task_contract": {"status": "canonical", "task_prompt_sha256": "same-contract"},
            "experiment": {"variant": experiment_variant},
        }
        path = root / "summary.json"
        path.write_text(json.dumps(summary), encoding="utf-8")
        return path

    result = run_shopping_e2e_experiment(
        tmp_path / "experiment", cases=[("2", "2"), ("3", "2")], repeats=2,
        case_runner=fake_runner,
    )
    report = json.loads(result.summary.read_text(encoding="utf-8"))
    assert len(calls) == 8
    assert report["pair_count"] == 4
    assert report["aggregate"]["completion_wins"] == {"control": 0, "treatment": 4, "ties": 0}
    assert report["aggregate"]["variants"]["treatment"]["finding_runs"] == 4
    assert report["aggregate"]["variants"]["control"]["finding_runs"] == 0
    assert report["aggregate"]["variants"]["treatment"]["average_model_visible_observation_chars"] == 100
    assert report["aggregate"]["variants"]["control"]["average_trace_event_count"] == 30
    assert report["aggregate"]["variants"]["treatment"]["average_backend_bridge_processes"] == 5
    assert report["aggregate"]["variants"]["control"]["average_model_turns"] == 6
    assert report["aggregate"]["variants"]["treatment"]["average_model_input_tokens"] == 1000
    assert report["aggregate"]["variants"]["control"]["average_model_input_tokens"] == 1500
    assert report["aggregate"]["variants"]["treatment"]["multi_response_repeated_action_groups"] == 4
    assert report["experiment_validity"] == {
        "status": "valid", "task_contract_match_pairs": 4,
        "task_contract_mismatch_pairs": 0, "task_contract_unavailable_pairs": 0,
    }
    assert all(pair["task_contract_status"] == "match" for pair in report["pairs"])
    assert all(pair["observed_delta"]["model_input_tokens"] == -500 for pair in report["pairs"])
    assert report["harness_improvement"] == "not_established"
    assert report["causal_claim"] == "not_automatically_established"
    assert "validation_evidence" not in report


def test_shopping_context_compaction_ablation_changes_only_capability_availability(tmp_path: Path):
    """Catches a mechanism ablation accidentally removing Auto-Research or changing the task."""
    calls = []

    def fake_runner(
        root, *, dataset, level, case_id, timeout, experiment_variant, context_compaction,
    ):
        calls.append((level, case_id, experiment_variant, context_compaction))
        root.mkdir(parents=True, exist_ok=True)
        summary = {
            "passed": True,
            "pi_agent_succeeded": True,
            "evaluator_passed": True,
            "score": 1.0,
            "evaluation": {"case_score": 1.0},
            "pi_agent_error": "",
            "research": {
                "finding_count": 1 if context_compaction else 0,
                "research_connection": "apply_effect_observed" if context_compaction else "not_attempted",
            },
            "self_harness": {
                "decision_count": 1 if context_compaction else 0,
                "applied_decision_count": 1 if context_compaction else 0,
                "effect_assessment_count": 1 if context_compaction else 0,
            },
            "execution_condition_effect": {
                "status": "supported" if context_compaction else "not_attempted",
                "correctness_gated_status": "supported" if context_compaction else "not_attempted",
                "context_compaction": {
                    "supported_assessment_count": 1 if context_compaction else 0,
                    "independently_recomputed_removed_chars": 900 if context_compaction else 0,
                },
            },
            "execution_efficiency": {
                "model_turns": 5,
                "model_input_tokens": 1000 if context_compaction else 1500,
                "model_output_tokens": 100,
                "provider_requests_with_usage": 5,
                "backend_bridge_processes": 3,
            },
            "trace": {"event_count": 20},
            "model_visible_observation": {"observation_chars": 2000, "decision_support_cards": 0},
            "task_contract": {"status": "canonical", "task_prompt_sha256": "same-task"},
            "experiment": {
                "variant": "treatment",
                "context_compaction_available": context_compaction,
            },
        }
        path = root / "summary.json"
        path.write_text(json.dumps(summary), encoding="utf-8")
        return path

    result = shopping_module.run_shopping_context_compaction_ablation(
        tmp_path / "context-ablation", cases=[("2", "11")], repeats=2,
        case_runner=fake_runner,
    )
    report = json.loads(result.summary.read_text(encoding="utf-8"))

    assert calls == [
        ("2", "11", "treatment", True),
        ("2", "11", "treatment", False),
        ("2", "11", "treatment", False),
        ("2", "11", "treatment", True),
    ]
    assert report["design"]["invariant_surface"] == "Auto-Research + shopping_batch treatment"
    assert report["design"]["only_variable"] == "agent_owned_observation_compaction availability"
    assert report["aggregate"]["completion_wins"] == {
        "without_context_compaction": 0,
        "with_context_compaction": 0,
        "ties": 2,
    }
    assert report["aggregate"]["arms"]["with_context_compaction"]["finding_runs"] == 2
    assert report["aggregate"]["arms"]["with_context_compaction"]["supported_context_effects"] == 2
    assert report["aggregate"]["arms"]["without_context_compaction"]["supported_context_effects"] == 0
    assert all(pair["task_contract_status"] == "match" for pair in report["pairs"])
    assert all(pair["observed_delta"]["model_input_tokens"] == -500 for pair in report["pairs"])
    assert all(pair["observed_delta"]["context_compaction_removed_chars"] == 900 for pair in report["pairs"])
    assert report["harness_improvement"] == "not_established"
    assert report["causal_claim"] == "not_automatically_established"


def test_shopping_experiment_projects_hidden_stratum_without_passing_it_to_case_runner(tmp_path: Path):
    """Catches evaluator-only labels entering the Shopping Agent control plane."""
    calls = []

    def fake_runner(root, *, dataset, level, case_id, timeout, experiment_variant):
        calls.append((level, case_id, experiment_variant))
        root.mkdir(parents=True, exist_ok=True)
        path = root / "summary.json"
        path.write_text(json.dumps({
            "passed": True,
            "pi_agent_succeeded": True,
            "evaluator_passed": True,
            "score": 1.0,
            "evaluation": {"case_score": 1.0},
            "research": {"finding_count": 0, "research_connection": "not_attempted"},
            "self_harness": {"decision_count": 0, "applied_decision_count": 0},
            "execution_condition_effect": {
                "status": "not_attempted",
                "correctness_gated_status": "not_attempted",
            },
            "execution_efficiency": {"model_turns": 5, "backend_bridge_processes": 8},
            "task_contract": {"task_prompt_sha256": "identical-task"},
            "experiment": {"variant": experiment_variant},
        }), encoding="utf-8")
        return path

    report = json.loads(run_shopping_e2e_experiment(
        tmp_path / "shopping-hidden-stratum",
        cases=[("3", "2")],
        case_runner=fake_runner,
        validation_strata={"shopping:3:2": {
            "stratum": "feedback_dependent",
            "hypothesis": "no_change_is_valid",
        }},
    ).summary.read_text(encoding="utf-8"))

    assert sorted(calls) == [("3", "2", "control"), ("3", "2", "treatment")]
    assert report["validation_evidence"]["agent_visible"] is False
    assert report["validation_evidence"]["records"][0]["agent_posture"] == "no_change"
    assert report["validation_evidence"]["records"][0]["hypothesis_consistency"] == "supported"


def test_shopping_experiment_checkpoints_each_completed_variant(tmp_path: Path):
    calls = 0

    def interrupted_runner(root, *, dataset, level, case_id, timeout, experiment_variant):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise KeyboardInterrupt("simulated outer interruption")
        root.mkdir(parents=True, exist_ok=True)
        path = root / "summary.json"
        path.write_text(json.dumps({
            "passed": False, "pi_agent_succeeded": True, "evaluator_passed": False,
            "score": 0.5, "evaluation": {"case_score": 0.0}, "pi_agent_error": "",
            "research": {"finding_count": 0, "research_connection": "not_attempted"},
            "self_harness": {"decision_count": 0, "applied_decision_count": 0, "effect_assessment_count": 0},
            "execution_condition_effect": {"status": "not_attempted", "correctness_gated_status": "not_attempted"},
            "trace": {"event_count": 10},
            "model_visible_observation": {"observation_chars": 100, "decision_support_cards": 0},
            "experiment": {"variant": experiment_variant},
        }), encoding="utf-8")
        return path

    root = tmp_path / "interrupted-experiment"
    with pytest.raises(KeyboardInterrupt):
        run_shopping_e2e_experiment(
            root, cases=[("2", "1")], repeats=1,
            case_runner=interrupted_runner,
        )
    report = json.loads((root / "summary.json").read_text(encoding="utf-8"))
    assert report["status"] == "in_progress"
    assert report["planned_variant_run_count"] == 2
    assert report["completed_variant_run_count"] == 1
    assert report["completed_variants"][0]["variant"] in {"control", "treatment"}
    assert report["pair_count"] == 0


def test_shopping_experiment_marks_mismatched_task_contract_invalid(tmp_path: Path):
    def fake_runner(root, *, dataset, level, case_id, timeout, experiment_variant):
        root.mkdir(parents=True, exist_ok=True)
        path = root / "summary.json"
        path.write_text(json.dumps({
            "passed": False, "pi_agent_succeeded": True, "evaluator_passed": False,
            "score": 0.0, "evaluation": {"case_score": 0.0}, "pi_agent_error": "",
            "research": {}, "self_harness": {}, "execution_condition_effect": {},
            "trace": {}, "model_visible_observation": {},
            "task_contract": {
                "status": "canonical",
                "task_prompt_sha256": f"contract-{experiment_variant}",
            },
            "experiment": {"variant": experiment_variant},
        }), encoding="utf-8")
        return path

    report = json.loads(run_shopping_e2e_experiment(
        tmp_path / "mismatch", cases=[("3", "15")], repeats=1,
        case_runner=fake_runner,
    ).summary.read_text(encoding="utf-8"))

    assert report["pairs"][0]["task_contract_status"] == "mismatch"
    assert report["experiment_validity"]["status"] == "invalid_task_contract"
    assert report["experiment_validity"]["task_contract_mismatch_pairs"] == 1


def test_shopping_experiment_rejects_nonempty_root_and_empty_cases(tmp_path: Path):
    with pytest.raises(ValueError, match="at least one"):
        run_shopping_e2e_experiment(tmp_path / "empty", cases=[])
    root = tmp_path / "nonempty"
    root.mkdir()
    (root / "old.txt").write_text("keep", encoding="utf-8")
    with pytest.raises(ValueError, match="empty directory"):
        run_shopping_e2e_experiment(root, cases=[("2", "1")])
