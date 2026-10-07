"""Domain tests for the component-pool / assembly / runtime boundary."""
import json
import os
import subprocess
from pathlib import Path

from test_pi_external_benchmark_native import _pi_cli


def run_assembly_helper(expression, *, input_value=None):
    node, _ = _pi_cli()
    helper = Path(__file__).resolve().parents[1] / "demo" / "pi_task_harness_assembly.ts"
    script = (
        f'import * as assembly from {json.dumps(helper.as_uri())};'
        f'console.log(JSON.stringify({expression}));'
    )
    env = os.environ.copy()
    if input_value is not None:
        env["HARNESS_ASSEMBLY_TEST_INPUT"] = json.dumps(input_value)
    completed = subprocess.run(
        [node, "--experimental-strip-types", "--input-type=module", "-e", script],
        capture_output=True, text=True, env=env,
    )
    assert completed.returncode == 0, completed.stderr
    return json.loads(completed.stdout)


def test_task_prompt_contributions_accept_non_memory_sources_and_order_layers():
    value = {
        "expected_assembly_revision": 0,
        "selected_resource_refs": ["skill:route-check@v2"],
        "prompt_contributions": [
            {
                "contribution_id": "research-plan",
                "source_ref": "research_report:auto-research-3@v1",
                "layer": "working_plan",
                "content": "Compare both candidate routes before committing.",
                "priority": 2,
            },
            {
                "contribution_id": "method",
                "source_ref": "skill:route-check@v2",
                "layer": "method",
                "content": "Check the destination before each move.",
                "priority": 1,
            },
            {
                "contribution_id": "hypothesis",
                "source_ref": "validation:walkability@v4",
                "layer": "hypothesis",
                "content": "Colour four may be impassable.",
                "activation": {"type": "state_match", "path": "assertions.probe", "value": True},
            },
        ],
        "decision": {"basis_refs": [], "reason": "Use the current route method.",
                     "expected": "Only relevant guidance reaches the next request."},
    }
    result = run_assembly_helper(
        "(()=>{const i=JSON.parse(process.env.HARNESS_ASSEMBLY_TEST_INPUT);"
        "const a=assembly.createHarnessAssembly({input:i,previous:undefined,"
        "resolveComponentRef:r=>r==='skill:route-check@v2'?r:undefined,"
        "resolveSourceRef:r=>r,recordedAt:'2026-09-21T00:00:00.000Z'});"
        "return {assembly:a,rendered:assembly.renderPromptContributions(a,{assertions:{probe:true}},r=>true)};})()",
        input_value=value,
    )
    assert result["assembly"]["revision"] == 1
    assert result["assembly"]["selected_resource_refs"] == ["skill:route-check@v2"]
    assert [item["layer"] for item in result["rendered"]["selected"]] == [
        "method", "working_plan", "hypothesis",
    ]
    assert result["rendered"]["selected"][1]["source_ref"].startswith("research_report:")


def test_prompt_contribution_activation_and_stale_dependency_are_suppressed():
    value = {
        "expected_assembly_revision": 0,
        "selected_resource_refs": [],
        "prompt_contributions": [
            {
                "contribution_id": "conditional",
                "source_ref": "finding:f1@v2",
                "layer": "task_policy",
                "content": "Probe before moving.",
                "activation": {"type": "state_match", "path": "assertions.probe", "value": True},
            },
            {
                "contribution_id": "stale-method",
                "source_ref": "method:m1@v1",
                "layer": "method",
                "content": "Use the stale method.",
                "depends_on_refs": ["memory:model@v1"],
            },
        ],
        "decision": {"basis_refs": [], "reason": "Assemble conditionally.", "expected": "Suppress stale guidance."},
    }
    result = run_assembly_helper(
        "(()=>{const i=JSON.parse(process.env.HARNESS_ASSEMBLY_TEST_INPUT);"
        "const a=assembly.createHarnessAssembly({input:i,previous:undefined,resolveComponentRef:()=>undefined,"
        "resolveSourceRef:r=>r,recordedAt:'2026-09-21T00:00:00.000Z'});"
        "return assembly.renderPromptContributions(a,{assertions:{probe:false}},r=>r!=='memory:model@v1');})()",
        input_value=value,
    )
    assert result["selected"] == []
    reasons = {item["contribution_id"]: item["reason"] for item in result["suppressed"]}
    assert reasons == {
        "conditional": "activation_not_matched",
        "stale-method": "dependency_unavailable:memory:model@v1",
    }


def test_assembly_revision_is_required_compare_and_swap():
    value = {
        "expected_assembly_revision": 0,
        "selected_resource_refs": [], "prompt_contributions": [],
        "decision": {"basis_refs": [], "reason": "Refresh selection.", "expected": "Use the new selection."},
    }
    result = run_assembly_helper(
        "(()=>{const i=JSON.parse(process.env.HARNESS_ASSEMBLY_TEST_INPUT);"
        "const base=assembly.createHarnessAssembly({input:i,previous:undefined,resolveComponentRef:r=>r,"
        "resolveSourceRef:r=>r,recordedAt:'2026-09-21T00:00:00.000Z'});"
        "const next=assembly.createHarnessAssembly({input:{...i,expected_assembly_revision:1},previous:base,resolveComponentRef:r=>r,"
        "resolveSourceRef:r=>r,recordedAt:'2026-09-21T00:01:00.000Z'});"
        "let stale,missing;try{assembly.createHarnessAssembly({input:{...i,expected_assembly_revision:1},previous:next,"
        "resolveComponentRef:r=>r,resolveSourceRef:r=>r,recordedAt:'2026-09-21T00:02:00.000Z'});}"
        "catch(e){stale=assembly.assemblyConflictDetails(e);}"
        "const {expected_assembly_revision,...withoutCas}=i;try{assembly.createHarnessAssembly({input:withoutCas,previous:next,"
        "resolveComponentRef:r=>r,resolveSourceRef:r=>r,recordedAt:'2026-09-21T00:03:00.000Z'});}"
        "catch(e){missing=assembly.assemblyConflictDetails(e);}return {base:base.revision,next:next.revision,stale,missing};})()",
        input_value=value,
    )
    assert result["base"] == 1 and result["next"] == 2
    assert result["stale"]["format"] == "task-harness-assembly-version-conflict-v1"
    assert result["stale"]["requested_revision"] == 1
    assert result["stale"]["current_revision"] == 2
    assert result["missing"]["requested_revision"] is None
    assert result["missing"]["current_revision"] == 2
