import json
import os
import sys
from pathlib import Path

from autoresearch_pi.pi_kernel import PiKernel


def _pi_cli():
    import shutil
    from pathlib import Path
    node = shutil.which("node")
    if not node:
        raise RuntimeError("node unavailable")
    cli = Path(node).resolve().parent / "node_modules" / "@earendil-works" / "pi-coding-agent" / "dist" / "cli.js"
    if not cli.is_file():
        raise RuntimeError("Pi CLI unavailable")
    return node, str(cli)


def test_installed_pi_shopping_batch_surface_has_observed_effect(tmp_path: Path):
    try:
        node, cli = _pi_cli()
    except RuntimeError as exc:
        import pytest
        pytest.skip(str(exc))
    project = Path(__file__).resolve().parents[1]
    dataset = Path(r"D:\JIT\dataset\deepplanning_shopping")
    db_dir = dataset / "database_level3" / "case_1"
    if not db_dir.is_dir():
        import pytest
        pytest.skip("JIT shopping dataset unavailable")
    products = [json.loads(line)["product_id"] for line in (db_dir / "products.jsonl").read_text(encoding="utf-8").splitlines()[:3]]
    root = tmp_path / "shopping-native"
    root.mkdir()
    cart = root / "cart.json"
    cart.write_text(json.dumps({"items": [], "used_coupons": [], "summary": {"total_items_count": 0, "total_price": 0}}), encoding="utf-8")
    command = (node, cli, "--mode", "rpc", "--provider", "offline-context-test", "--model", "scripted",
               "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files",
               "--no-builtin-tools", "--extension", str(project / "demo" / "pi_shopping_e2e_extension.ts"),
               "--extension", str(project / "tests" / "pi_offline_context_provider.ts"))
    src = str(project / "src")
    with PiKernel(command, cwd=str(root), env={
        "PI_CODING_AGENT_DIR": str(root / ".pi-agent"),
        "PI_OFFICEBENCH_E2E_ROOT": str(root),
        "PI_SHOPPING_E2E_ROOT": str(root), "PI_SHOPPING_DB_DIR": str(db_dir),
        "PI_SHOPPING_CART_PATH": str(cart), "PI_TEST_SCENARIO": "shopping_batch_surface",
        "JIT_ROOT": r"D:\JIT", "JIT_PYTHON": r"D:\anaconda\envs\jit\python.exe",
        "AUTORESEARCH_PI_SRC": src, "PYTHONPATH": src,
    }, timeout=60) as kernel:
        kernel.prompt("Exercise the optional Shopping batch surface.")
        events = kernel.wait_for_agent_events(timeout=60)

    assert any(event.get("type") == "agent_end" for event in events)
    finding = json.loads((root / "research-resources.jsonl").read_text(encoding="utf-8").splitlines()[0])
    decision = json.loads((root / "harness-decisions.jsonl").read_text(encoding="utf-8").splitlines()[0])
    exposure = json.loads((root / "harness-observations.jsonl").read_text(encoding="utf-8").splitlines()[0])
    assessment = json.loads((root / "effect-assessments.jsonl").read_text(encoding="utf-8").splitlines()[0])
    cart_value = json.loads(cart.read_text(encoding="utf-8"))
    assert finding["evidence_refs"] == ["shopping-observation-1"]
    assert decision["value"] == "shopping_batch"
    assert exposure["effect_observed"] is True
    assert assessment["verdict"] == "supported"
    assert assessment["window"]["completed_work_units"] == 2
    assert len(cart_value["items"]) == 3


def test_installed_pi_shopping_continue_with_can_supply_record_decision(tmp_path: Path):
    """Catches a redundant decision requirement when continue_with already states it."""
    try:
        node, cli = _pi_cli()
    except RuntimeError as exc:
        import pytest
        pytest.skip(str(exc))
    project = Path(__file__).resolve().parents[1]
    db_dir = Path(r"D:\JIT\dataset\deepplanning_shopping\database_level3\case_1")
    if not db_dir.is_dir():
        import pytest
        pytest.skip("JIT shopping dataset unavailable")
    root = tmp_path / "shopping-continue-without-decision"
    root.mkdir()
    cart = root / "cart.json"
    cart.write_text(json.dumps({"items": [], "used_coupons": [], "summary": {"total_items_count": 0, "total_price": 0}}), encoding="utf-8")
    command = (node, cli, "--mode", "rpc", "--provider", "offline-context-test", "--model", "scripted",
               "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files",
               "--no-builtin-tools", "--extension", str(project / "demo" / "pi_shopping_e2e_extension.ts"),
               "--extension", str(project / "tests" / "pi_offline_context_provider.ts"))
    src = str(project / "src")
    with PiKernel(command, cwd=str(root), env={
        "PI_CODING_AGENT_DIR": str(root / ".pi-agent"), "PI_SHOPPING_E2E_ROOT": str(root),
        "PI_SHOPPING_DB_DIR": str(db_dir), "PI_SHOPPING_CART_PATH": str(cart),
        "PI_TEST_SCENARIO": "shopping_continue_without_decision", "JIT_ROOT": r"D:\JIT",
        "JIT_PYTHON": r"D:\anaconda\envs\jit\python.exe", "AUTORESEARCH_PI_SRC": src,
        "PYTHONPATH": src,
    }, timeout=60) as kernel:
        kernel.prompt("Record one evidence-backed finding and continue with the selected surface.")
        events = kernel.wait_for_agent_events(timeout=60)

    assert any(event.get("type") == "agent_end" for event in events)
    finding = json.loads((root / "research-resources.jsonl").read_text(encoding="utf-8").splitlines()[0])
    decision = json.loads((root / "harness-decisions.jsonl").read_text(encoding="utf-8").splitlines()[0])
    assessment = json.loads((root / "effect-assessments.jsonl").read_text(encoding="utf-8").splitlines()[0])
    assert finding["decision"] == "apply shopping_batch: add two products in one Pi call"
    assert decision["basis_resource_ids"] == [finding["finding_id"]]
    assert assessment["verdict"] == "supported"


def test_installed_pi_shopping_effect_window_starts_after_surface_exposure(tmp_path: Path):
    try:
        node, cli = _pi_cli()
    except RuntimeError as exc:
        import pytest
        pytest.skip(str(exc))
    project = Path(__file__).resolve().parents[1]
    dataset = Path(r"D:\JIT\dataset\deepplanning_shopping")
    db_dir = dataset / "database_level3" / "case_1"
    if not db_dir.is_dir():
        import pytest
        pytest.skip("JIT shopping dataset unavailable")
    root = tmp_path / "shopping-exposure-gate"
    root.mkdir()
    cart = root / "cart.json"
    cart.write_text(json.dumps({"items": [], "used_coupons": [], "summary": {"total_items_count": 0, "total_price": 0}}), encoding="utf-8")
    command = (node, cli, "--mode", "rpc", "--provider", "offline-context-test", "--model", "scripted",
               "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files",
               "--no-builtin-tools", "--extension", str(project / "demo" / "pi_shopping_e2e_extension.ts"),
               "--extension", str(project / "tests" / "pi_offline_context_provider.ts"))
    src = str(project / "src")
    with PiKernel(command, cwd=str(root), env={
        "PI_CODING_AGENT_DIR": str(root / ".pi-agent"),
        "PI_OFFICEBENCH_E2E_ROOT": str(root),
        "PI_SHOPPING_E2E_ROOT": str(root), "PI_SHOPPING_DB_DIR": str(db_dir),
        "PI_SHOPPING_CART_PATH": str(cart), "PI_TEST_SCENARIO": "shopping_exposure_gate",
        "JIT_ROOT": r"D:\JIT", "JIT_PYTHON": r"D:\anaconda\envs\jit\python.exe",
        "AUTORESEARCH_PI_SRC": src, "PYTHONPATH": src,
    }, timeout=60) as kernel:
        kernel.prompt("Exercise the Shopping post-exposure effect boundary.")
        events = kernel.wait_for_agent_events(timeout=60)

    assert any(event.get("type") == "agent_end" for event in events)
    assessment = json.loads((root / "effect-assessments.jsonl").read_text(encoding="utf-8").splitlines()[0])
    assert assessment["exposure_observed"] is True
    assert assessment["window"]["observation_ids"] == ["shopping-observation-3"]
    assert assessment["window"]["attempted_work_units"] == 2
    assert assessment["window"]["completed_work_units"] == 2
    assert assessment["window"]["pi_tool_calls"] == 1
    assert assessment["verdict"] == "supported"


def test_installed_pi_shopping_preserves_full_observations_without_task_specific_cards(tmp_path: Path):
	try:
		node, cli = _pi_cli()
	except RuntimeError as exc:
		import pytest
		pytest.skip(str(exc))
	project = Path(__file__).resolve().parents[1]
	dataset = Path(r"D:\JIT\dataset\deepplanning_shopping")
	db_dir = dataset / "database_level3" / "case_1"
	if not db_dir.is_dir():
		import pytest
		pytest.skip("JIT shopping dataset unavailable")
	root = tmp_path / "shopping-observation-projection"
	root.mkdir()
	(root / "cart.json").write_text(json.dumps({"items": [], "used_coupons": [], "summary": {"total_items_count": 0, "total_price": 0}}), encoding="utf-8")
	# The offline provider emits repeated product-detail calls. The runtime must
	# preserve the complete result and must not inject a Shopping-specific
	# capability recommendation; semantic relevance remains the agent's choice.
	command = (node, cli, "--mode", "rpc", "--provider", "offline-context-test", "--model", "scripted",
		       "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files",
		       "--no-builtin-tools", "--extension", str(project / "demo" / "pi_shopping_e2e_extension.ts"),
		       "--extension", str(project / "tests" / "pi_offline_context_provider.ts"))
	with PiKernel(command, cwd=str(root), env={
		"PI_CODING_AGENT_DIR": str(root / ".pi-agent"), "PI_SHOPPING_E2E_ROOT": str(root),
		"PI_SHOPPING_DB_DIR": str(db_dir), "PI_SHOPPING_CART_PATH": str(root / "cart.json"),
		"PI_TEST_SCENARIO": "shopping_projection_cards", "JIT_ROOT": r"D:\JIT",
		"JIT_PYTHON": sys.executable, "AUTORESEARCH_PI_SRC": str(project / "src"),
	}, timeout=30) as kernel:
		kernel.prompt("Exercise the Shopping observation projection.")
		events = kernel.wait_for_agent_events(timeout=30)
	observations = [json.loads(line) for line in (root / "execution-observations.jsonl").read_text(encoding="utf-8").splitlines()]
	assert all("decision_support" not in item for item in observations)
	detail_result = next(
		event["result"]["content"][0]["text"]
		for event in events
		if event.get("type") == "tool_execution_end" and event.get("toolName") == "get_product_details"
	)
	assert "material_composition" in detail_result
	assert "review_summary" in detail_result
	metrics = json.loads((root / "model-visible-observation-metrics.json").read_text(encoding="utf-8"))
	assert metrics["decision_support_cards"] == 0
	assert metrics["observation_chars"] > 0


def test_installed_pi_shopping_counts_visible_chars_in_both_arms(tmp_path: Path):
	try:
		node, cli = _pi_cli()
	except RuntimeError as exc:
		import pytest
		pytest.skip(str(exc))
	project = Path(__file__).resolve().parents[1]
	db_dir = Path(r"D:\JIT\dataset\deepplanning_shopping\database_level3\case_1")
	if not db_dir.is_dir():
		import pytest
		pytest.skip("JIT shopping dataset unavailable")
	for variant in ("control", "treatment"):
		root = tmp_path / variant
		root.mkdir()
		cart = root / "cart.json"
		cart.write_text(json.dumps({"items": [], "used_coupons": [], "summary": {"total_items_count": 0, "total_price": 0}}), encoding="utf-8")
		command = (node, cli, "--mode", "rpc", "--provider", "offline-context-test", "--model", "scripted",
		           "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files",
		           "--no-builtin-tools", "--extension", str(project / "demo" / "pi_shopping_e2e_extension.ts"),
		           "--extension", str(project / "tests" / "pi_offline_context_provider.ts"))
		with PiKernel(command, cwd=str(root), env={
			"PI_CODING_AGENT_DIR": str(root / ".pi-agent"), "PI_SHOPPING_E2E_ROOT": str(root),
			"PI_SHOPPING_DB_DIR": str(db_dir), "PI_SHOPPING_CART_PATH": str(cart),
			"PI_SHOPPING_EXPERIMENT_VARIANT": variant,
			"PI_TEST_SCENARIO": "shopping_projection_cards", "JIT_ROOT": r"D:\JIT",
			"JIT_PYTHON": r"D:\anaconda\envs\jit\python.exe", "AUTORESEARCH_PI_SRC": str(project / "src"),
		}, timeout=30) as kernel:
			kernel.prompt("Measure the actual Shopping tool text visible to the model.")
			events = kernel.wait_for_agent_events(timeout=30)
		visible_results = [
			event["result"]["content"][0]["text"]
			for event in events
			if event.get("type") == "tool_execution_end"
			and event.get("toolName") in {"get_product_details", "add_product_to_cart"}
		]
		metrics = json.loads((root / "model-visible-observation-metrics.json").read_text(encoding="utf-8"))
		assert visible_results
		assert metrics["observation_chars"] == sum(len(result) for result in visible_results)
		assert metrics["observation_chars"] > 0


def test_installed_pi_shopping_exposes_stable_auto_research_method_only_in_treatment(tmp_path: Path):
	try:
		node, cli = _pi_cli()
	except RuntimeError as exc:
		import pytest
		pytest.skip(str(exc))
	project = Path(__file__).resolve().parents[1]
	db_dir = Path(r"D:\JIT\dataset\deepplanning_shopping\database_level3\case_1")
	if not db_dir.is_dir():
		import pytest
		pytest.skip("JIT shopping dataset unavailable")
	prompts = {}
	for variant in ("control", "treatment"):
		root = tmp_path / variant
		root.mkdir()
		cart = root / "cart.json"
		cart.write_text(json.dumps({"items": [], "used_coupons": []}), encoding="utf-8")
		command = (node, cli, "--mode", "rpc", "--provider", "offline-context-test", "--model", "scripted",
		           "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files",
		           "--no-builtin-tools", "--extension", str(project / "demo" / "pi_shopping_e2e_extension.ts"),
		           "--extension", str(project / "tests" / "pi_offline_context_provider.ts"))
		with PiKernel(command, cwd=str(root), env={
			"PI_CODING_AGENT_DIR": str(root / ".pi-agent"), "PI_OFFICEBENCH_E2E_ROOT": str(root),
			"PI_SHOPPING_E2E_ROOT": str(root), "PI_SHOPPING_DB_DIR": str(db_dir),
			"PI_SHOPPING_CART_PATH": str(cart), "PI_SHOPPING_EXPERIMENT_VARIANT": variant,
			"PI_TEST_SCENARIO": "baseline", "JIT_ROOT": r"D:\JIT",
			"JIT_PYTHON": sys.executable, "AUTORESEARCH_PI_SRC": str(project / "src"),
		}, timeout=30) as kernel:
			kernel.prompt("Inspect the initial Shopping task context.")
			kernel.wait_for_agent_events(timeout=30)
		context = json.loads((root / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()[0])["context"]
		prompts[variant] = context["systemPrompt"]
	assert "Use research when it helps resolve an uncertainty; direct execution is also valid." in prompts["treatment"]
	assert "No research stages or harness changes are mandatory." in prompts["treatment"]
	assert "expected reduction in calls, errors, or context" in prompts["treatment"]
	assert "Use research when it helps resolve an uncertainty; direct execution is also valid." not in prompts["control"]
	assert "expected reduction in calls, errors, or context" not in prompts["control"]


def test_installed_pi_shopping_ignores_runner_projection_toggle(tmp_path: Path):
	try:
		node, cli = _pi_cli()
	except RuntimeError as exc:
		import pytest
		pytest.skip(str(exc))
	project = Path(__file__).resolve().parents[1]
	db_dir = Path(r"D:\JIT\dataset\deepplanning_shopping\database_level3\case_1")
	if not db_dir.is_dir():
		import pytest
		pytest.skip("JIT shopping dataset unavailable")
	metrics = {}
	results = {}
	for label, projection in (("on", "enabled"), ("off", "disabled")):
		root = tmp_path / label
		root.mkdir()
		cart = root / "cart.json"
		cart.write_text(json.dumps({"items": [], "used_coupons": [], "summary": {"total_items_count": 0, "total_price": 0}}), encoding="utf-8")
		command = (node, cli, "--mode", "rpc", "--provider", "offline-context-test", "--model", "scripted",
			       "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files",
			       "--no-builtin-tools", "--extension", str(project / "demo" / "pi_shopping_e2e_extension.ts"),
			       "--extension", str(project / "tests" / "pi_offline_context_provider.ts"))
		with PiKernel(command, cwd=str(root), env={
			"PI_CODING_AGENT_DIR": str(root / ".pi-agent"), "PI_SHOPPING_E2E_ROOT": str(root),
			"PI_SHOPPING_DB_DIR": str(db_dir), "PI_SHOPPING_CART_PATH": str(cart),
			"PI_SHOPPING_OBSERVATION_PROJECTION": projection,
			"PI_TEST_SCENARIO": "shopping_projection_cards", "JIT_ROOT": r"D:\JIT",
			"JIT_PYTHON": r"D:\anaconda\envs\jit\python.exe", "AUTORESEARCH_PI_SRC": str(project / "src"),
		}, timeout=30) as kernel:
			kernel.prompt("Compare model-visible Shopping observation representation.")
			events = kernel.wait_for_agent_events(timeout=30)
		metrics[label] = json.loads((root / "model-visible-observation-metrics.json").read_text(encoding="utf-8"))
		results[label] = [
			event["result"]["content"][0]["text"]
			for event in events
			if event.get("type") == "tool_execution_end" and event.get("toolName") == "get_product_details"
		]
	assert metrics["on"]["decision_support_cards"] == 0
	assert metrics["off"]["decision_support_cards"] == 0
	assert [result.split("\n\nEXECUTION_OBSERVATION:", 1)[0] for result in results["on"]] == [
		result.split("\n\nEXECUTION_OBSERVATION:", 1)[0] for result in results["off"]
	]
	assert all("material_composition" in result for result in results["on"])
	context = json.loads((tmp_path / "on" / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()[0])["context"]
	system_prompt = context["systemPrompt"]
	assert "add a qualifying product to the cart immediately" not in system_prompt
	assert "first add_product_to_cart observation may make" not in system_prompt
	assert "bounded candidate loop" not in system_prompt
	assert "search an exact distinctive phrase" not in system_prompt
	assert "Do not repeat an identical search" not in system_prompt
	tool_names = {tool["name"] for tool in context["tools"]}
	assert "set_observation_policy" not in tool_names
	assert "shopping_selective_details" not in tool_names
	catalog = json.loads((tmp_path / "on" / "capability-catalog.json").read_text(encoding="utf-8"))
	assert all(resource.get("id") != "observation_policy" for resource in catalog["resources"])
	assert all(item.get("tool") != "shopping_selective_details" for item in catalog["available_inactive"])
	assert "shopping_batch_action" in system_prompt
	assert "next_model_request" in system_prompt
	assert "task capability catalog" in system_prompt.lower()
	assert "you must use shopping_batch_action" not in system_prompt.lower()


def test_installed_pi_shopping_rehydrates_read_only_research_resources(tmp_path: Path):
	try:
		node, cli = _pi_cli()
	except RuntimeError as exc:
		import pytest
		pytest.skip(str(exc))
	project = Path(__file__).resolve().parents[1]
	root = tmp_path / "shopping-resource-inspect"
	root.mkdir()
	(root / "research-resources.jsonl").write_text(json.dumps({
		"goal_id": "research-goal-2", "finding_id": "finding-2", "version": 3,
		"action": "resolve", "status": "resolved", "resolution": "supported",
		"evidence_refs": ["shopping-observation-4"], "assessment_refs": ["effect-assessment-2"],
		"research_event_id": "research-event-3", "expected_recurrence": "high", "remaining_uses": 1,
		"question": "q" * 500, "scope": "task", "uncertainty": "u", "evidence": "e" * 500, "decision": "d" * 500,
	}) + "\n", encoding="utf-8")
	(root / "harness-decisions.jsonl").write_text(json.dumps({"decision_id": "decision-2", "applied": True, "value": "shopping_batch"}) + "\n", encoding="utf-8")
	(root / "harness-observations.jsonl").write_text(json.dumps({"observation_id": "shopping-harness-observation-1", "effect_observed": True}) + "\n", encoding="utf-8")
	(root / "effect-assessments.jsonl").write_text(json.dumps({"effect_assessment_id": "effect-assessment-2", "decision_id": "decision-2", "verdict": "supported"}) + "\n", encoding="utf-8")
	command = (node, cli, "--mode", "rpc", "--provider", "offline-context-test", "--model", "scripted",
		       "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files",
		       "--no-builtin-tools", "--extension", str(project / "demo" / "pi_shopping_e2e_extension.ts"),
		       "--extension", str(project / "tests" / "pi_offline_context_provider.ts"))
	with PiKernel(command, cwd=str(root), env={
		"PI_CODING_AGENT_DIR": str(root / ".pi-agent"), "PI_SHOPPING_E2E_ROOT": str(root),
		"PI_SHOPPING_DB_DIR": str(root), "PI_SHOPPING_CART_PATH": str(root / "cart.json"),
		"PI_TEST_SCENARIO": "shopping_resource_inspect", "JIT_ROOT": r"D:\JIT",
		"JIT_PYTHON": sys.executable, "AUTORESEARCH_PI_SRC": str(project / "src"),
	}, timeout=30) as kernel:
		kernel.prompt("Inspect the current task research resource.")
		events = kernel.wait_for_agent_events(timeout=30)
	result = next(event for event in events if event.get("type") == "tool_execution_end" and event.get("toolName") == "research_resource")["result"]
	resource = json.loads(result["content"][0]["text"])
	assert resource["read_only"] is True
	assert resource["findings"][0]["version"] == 3
	assert resource["prior_decisions"][0]["decision_id"] == "decision-2"
	assert resource["exposure_observations"][0]["effect_observed"] is True
	assert resource["effect_assessments"][0]["verdict"] == "supported"
	assert len(resource["findings"][0]["question"]) <= 240
	assert len(resource["findings"][0]["evidence"]) <= 240


def test_installed_pi_shopping_explicitly_recalls_old_finding_without_restoring_batch(tmp_path: Path):
	"""Catches old Shopping findings becoming unreachable after digest truncation and restart."""
	try:
		node, cli = _pi_cli()
	except RuntimeError as exc:
		import pytest
		pytest.skip(str(exc))
	project = Path(__file__).resolve().parents[1]
	root = tmp_path / "shopping-old-finding"
	root.mkdir()
	records = [{
		"goal_id": f"research-goal-{index}", "finding_id": f"finding-{index}", "version": 1,
		"action": "record", "status": "active", "resolution": None,
		"evidence_refs": [f"shopping-observation-{index}"], "assessment_refs": [],
		"research_event_id": f"research-event-{index}", "expected_recurrence": "medium",
		"remaining_uses": 1, "question": f"question {index}", "scope": "task",
		"uncertainty": "u", "evidence": f"evidence {index}", "decision": f"decision {index}",
	} for index in range(1, 8)]
	(root / "research-resources.jsonl").write_text(
		"".join(json.dumps(record) + "\n" for record in records), encoding="utf-8",
	)
	(root / "harness-decisions.jsonl").write_text(json.dumps({
		"decision_id": "old-decision", "applied": True, "value": "shopping_batch",
	}) + "\n", encoding="utf-8")
	(root / "cart.json").write_text(json.dumps({"items": [], "used_coupons": []}), encoding="utf-8")
	command = (node, cli, "--mode", "rpc", "--provider", "offline-context-test", "--model", "scripted",
	           "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files",
	           "--no-builtin-tools", "--extension", str(project / "demo" / "pi_shopping_e2e_extension.ts"),
	           "--extension", str(project / "tests" / "pi_offline_context_provider.ts"))
	with PiKernel(command, cwd=str(root), env={
		"PI_CODING_AGENT_DIR": str(root / ".pi-agent"), "PI_SHOPPING_E2E_ROOT": str(root),
		"PI_SHOPPING_DB_DIR": str(root), "PI_SHOPPING_CART_PATH": str(root / "cart.json"),
		"PI_TEST_SCENARIO": "shopping_resource_inspect_oldest", "JIT_ROOT": r"D:\JIT",
		"JIT_PYTHON": sys.executable, "AUTORESEARCH_PI_SRC": str(project / "src"),
	}, timeout=30) as kernel:
		kernel.prompt("Explicitly inspect an older current-task Shopping finding.")
		events = kernel.wait_for_agent_events(timeout=30)

	result = next(event for event in events if event.get("type") == "tool_execution_end"
	              and event.get("toolName") == "research_resource")["result"]
	resource = json.loads(result["content"][0]["text"])
	assert [finding["finding_id"] for finding in resource["findings"]] == ["finding-1"]
	request = json.loads((root / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()[0])
	tool_names = {tool["name"] for tool in request["context"]["tools"]}
	assert "shopping_batch_action" not in tool_names
	assert "add_product_to_cart" in tool_names


def test_installed_pi_agent_selected_context_compaction_changes_only_cited_observation(tmp_path: Path):
	"""Catches a selected finding-backed observation remaining full on later Pi requests."""
	try:
		node, cli = _pi_cli()
	except RuntimeError as exc:
		import pytest
		pytest.skip(str(exc))
	project = Path(__file__).resolve().parents[1]
	db_dir = Path(r"D:\JIT\dataset\deepplanning_shopping\database_level3\case_1")
	if not db_dir.is_dir():
		import pytest
		pytest.skip("JIT shopping dataset unavailable")
	root = tmp_path / "shopping-observation-compaction"
	root.mkdir()
	cart = root / "cart.json"
	cart.write_text(json.dumps({"items": [], "used_coupons": []}), encoding="utf-8")
	command = (node, cli, "--mode", "rpc", "--provider", "offline-context-test", "--model", "scripted",
	           "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files",
	           "--no-builtin-tools", "--extension", str(project / "demo" / "pi_shopping_e2e_extension.ts"),
	           "--extension", str(project / "tests" / "pi_offline_context_provider.ts"))
	with PiKernel(command, cwd=str(root), env={
		"PI_CODING_AGENT_DIR": str(root / ".pi-agent"), "PI_SHOPPING_E2E_ROOT": str(root),
		"PI_SHOPPING_DB_DIR": str(db_dir), "PI_SHOPPING_CART_PATH": str(cart),
		"PI_SHOPPING_CONTEXT_COMPACTION": "enabled",
		"PI_TEST_SCENARIO": "shopping_observation_compaction", "JIT_ROOT": r"D:\JIT",
		"JIT_PYTHON": r"D:\anaconda\envs\jit\python.exe", "AUTORESEARCH_PI_SRC": str(project / "src"),
	}, timeout=60) as kernel:
		kernel.prompt("Exercise one Agent-selected, finding-backed observation representation change.")
		events = kernel.wait_for_agent_events(timeout=60)

	assert any(event.get("type") == "agent_end" for event in events)
	observations = [json.loads(line) for line in (root / "execution-observations.jsonl").read_text(encoding="utf-8").splitlines()]
	assert [item["event_id"] for item in observations] == ["shopping-observation-1", "shopping-observation-2"]
	assert all("material_composition" in item["result"] for item in observations)

	contexts = [json.loads(line) for line in (root / "provider-contexts.jsonl").read_text(encoding="utf-8").splitlines()]
	pre_apply = contexts[3]["context"]["messages"]
	post_exposure = contexts[4]["context"]["messages"]
	pre_by_id = {
		message["details"]["observation"]["event_id"]: message
		for message in pre_apply
		if message.get("role") == "toolResult" and message.get("details", {}).get("observation", {}).get("event_id")
	}
	post_by_id = {
		message["details"]["observation"]["event_id"]: message
		for message in post_exposure
		if message.get("role") == "toolResult" and message.get("details", {}).get("observation", {}).get("event_id")
	}
	assert "material_composition" in pre_by_id["shopping-observation-1"]["content"][0]["text"]
	assert post_by_id["shopping-observation-1"]["content"][0]["text"] == (
		"[Task-local observation shopping-observation-1 compacted by finding-1@v1; "
		"the complete result remains in execution-observations.jsonl and is recoverable by exact ID.]"
	)
	assert post_by_id["shopping-observation-2"]["content"] == pre_by_id["shopping-observation-2"]["content"]

	decision = json.loads((root / "harness-decisions.jsonl").read_text(encoding="utf-8").splitlines()[0])
	exposure = json.loads((root / "harness-observations.jsonl").read_text(encoding="utf-8").splitlines()[0])
	assessment = json.loads((root / "effect-assessments.jsonl").read_text(encoding="utf-8").splitlines()[0])
	findings = [json.loads(line) for line in (root / "research-resources.jsonl").read_text(encoding="utf-8").splitlines()]
	assert decision["operation"]["capability"] == "pi.context"
	assert decision["basis_snapshots"][0]["version"] == 1
	assert exposure["operation"]["observation_ids"] == ["shopping-observation-1"]
	assert exposure["effect_observed"] is True
	assert assessment["effect_metric"] == "model_visible_observation_chars_removed"
	assert assessment["window"]["removed_chars"] > 0
	assert assessment["verdict"] == "supported"
	assert findings[-1]["version"] == 2
	assert findings[-1]["status"] == "resolved"
	assert findings[-1]["assessment_refs"] == [assessment["effect_assessment_id"]]
	inspection_results = [
		event["result"] for event in events
		if event.get("type") == "tool_execution_end" and event.get("toolName") == "research_resource"
	]
	inspection = json.loads(inspection_results[-1]["content"][0]["text"])
	assert inspection["read_only"] is True
	assert [item["event_id"] for item in inspection["observations"]] == ["shopping-observation-1"]
	assert "material_composition" in inspection["observations"][0]["result"]


def test_installed_pi_overlapping_native_effects_keep_unique_assessment_ids(tmp_path: Path):
	"""Catches a later decision counter overwriting an earlier pending effect identity."""
	try:
		node, cli = _pi_cli()
	except RuntimeError as exc:
		import pytest
		pytest.skip(str(exc))
	project = Path(__file__).resolve().parents[1]
	db_dir = Path(r"D:\JIT\dataset\deepplanning_shopping\database_level3\case_1")
	if not db_dir.is_dir():
		import pytest
		pytest.skip("JIT shopping dataset unavailable")
	root = tmp_path / "shopping-overlapping-effects"
	root.mkdir()
	cart = root / "cart.json"
	cart.write_text(json.dumps({"items": [], "used_coupons": []}), encoding="utf-8")
	command = (node, cli, "--mode", "rpc", "--provider", "offline-context-test", "--model", "scripted",
	           "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files",
	           "--no-builtin-tools", "--extension", str(project / "demo" / "pi_shopping_e2e_extension.ts"),
	           "--extension", str(project / "tests" / "pi_offline_context_provider.ts"))
	with PiKernel(command, cwd=str(root), env={
		"PI_CODING_AGENT_DIR": str(root / ".pi-agent"), "PI_SHOPPING_E2E_ROOT": str(root),
		"PI_SHOPPING_DB_DIR": str(db_dir), "PI_SHOPPING_CART_PATH": str(cart),
		"PI_SHOPPING_CONTEXT_COMPACTION": "enabled",
		"PI_TEST_SCENARIO": "shopping_overlapping_effect_ids", "JIT_ROOT": r"D:\JIT",
		"JIT_PYTHON": r"D:\anaconda\envs\jit\python.exe", "AUTORESEARCH_PI_SRC": str(project / "src"),
	}, timeout=60) as kernel:
		kernel.prompt("Exercise two independently attributed Pi-native effects.")
		events = kernel.wait_for_agent_events(timeout=60)

	assert any(event.get("type") == "agent_end" for event in events)
	decisions = [json.loads(line) for line in (root / "harness-decisions.jsonl").read_text(encoding="utf-8").splitlines()]
	assessments = [json.loads(line) for line in (root / "effect-assessments.jsonl").read_text(encoding="utf-8").splitlines()]
	assert [item["decision_id"] for item in decisions] == ["decision-1", "decision-2"]
	assert {item["decision_id"] for item in assessments} == {"decision-1", "decision-2"}
	assert len({item["effect_assessment_id"] for item in assessments}) == 2
