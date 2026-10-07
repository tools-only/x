"""Replay the real failed author call through Pi; never a gameplay benefit test."""
import copy
import importlib.util
import json
import pytest

from test_harness_argument_integrity_native import PROJECT, run, read_creator, tool_payloads
from test_task_research_context import records, results


def compiler(path):
    spec = importlib.util.spec_from_file_location('pure_source_diagnostics_fixture', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def failure(source):
    module = compiler(PROJECT / 'demo/pi_task_pure_python_lower.py')
    with pytest.raises(module.LoweringError) as caught:
        module.lower_source(source)
    return caught.value.envelope()


def actual_call():
    path = PROJECT / 'tests/fixtures/harness-stage140-failed-source-call.json'
    # Binding is never resolved: validation must fail before writes.
    return copy.deepcopy(json.loads(path.read_text(encoding='utf-8'))['call'])


def test_actual_failed_source_reports_independent_barriers_in_one_later_parent_payload(tmp_path):
    root = tmp_path / 'task'
    events, payloads = run(root, [read_creator(), [actual_call()]])
    event = results(events, 'task_harness_create')[0]
    assert event.get('isError'), event
    receipt = json.loads(event['result']['content'][0]['text'])
    messages = [issue['message'] for issue in receipt['issues']]
    assert any('Tuple' in message for message in messages)
    for name in ['x', 'y', 'sx', 'sy']:
        assert any(f'undeclared lexical variable: {name}' in message for message in messages), messages
    assert any('unknown limit: max_list_length' in message for message in messages), messages
    assert receipt['no_component_written']
    assert not records(root, 'task-tools.jsonl')
    assert not records(root, 'task-harness-assemblies.jsonl')
    assert len(records(root, 'task-baseline-method-reads.jsonl')) == 1
    assert any(value.get('issues') == receipt['issues'] for value in tool_payloads(payloads[-1]))


def test_diagnostic_lexical_scopes_and_duplicate_names():
    source = "((lambda x: [x+y for y in range(2)])(input['x']), [[z for z in range(x)] for x in input['rows']], missing+missing, other)"
    receipt = failure(source)
    messages = [error['message'] for error in receipt['errors']]
    assert messages == ['unsupported syntax: Tuple', 'undeclared lexical variable: missing', 'undeclared lexical variable: other']
    assert receipt['omitted_errors'] == 0


def test_diagnostic_count_bound_preserves_rejection_without_returning_ir():
    source = ','.join(f'unknown_{i}' for i in range(30))
    receipt = failure(source)
    assert not receipt['ok'] and 'expression' not in receipt
    assert len(receipt['errors']) == 8
    assert receipt['omitted_errors'] == 23  # Tuple plus 30 independent names.
    assert len(json.dumps(receipt)) < 2200


def test_native_failure_receipt_bounds_large_limit_key_and_many_source_errors(tmp_path):
    call = actual_call()
    program = call['arguments']['candidate']['program']
    program['source'] = ','.join(f'unknown_{i}' for i in range(30))
    program['limits'] = {'k' * 2000: 1}
    events, payloads = run(tmp_path / 'task', [read_creator(), [call]])
    event = results(events, 'task_harness_create')[0]
    assert event.get('isError'), event
    text = event['result']['content'][0]['text']
    receipt = json.loads(text)
    assert len(text) < 3000
    assert len(receipt['issues']) == 10  # 8 names/syntax + omission + one limit.
    assert any('23 additional source diagnostics omitted' in issue['message'] for issue in receipt['issues'])
    assert all(len(issue['path']) <= 250 for issue in receipt['issues'])
    assert receipt['no_component_written']
    assert any(value.get('issues') == receipt['issues'] for value in tool_payloads(payloads[-1]))


@pytest.mark.parametrize('source', [
    "(lambda x,y: x+y)(input['a'],input['b'])",
    "[[input['grid'][y][x] for x in range(3)] for y in range(2)]",
    "[(lambda x,y: [x,y])(input['a'],x) for x in range(3)]",
    "{'values':[v for v in input['values'] if v<4]}",
])
def test_successful_source_ir_and_metadata_are_identical_to_frozen140(source):
    old = compiler(PROJECT / 'versions/arc/stage140/demo/pi_task_pure_python_lower.py')
    current = compiler(PROJECT / 'demo/pi_task_pure_python_lower.py')
    assert current.lower_source(source) == old.lower_source(source)


@pytest.mark.parametrize('source', ['__import__("os")', 'input.__class__', 'input["grid"][1:3]', '"' + 'x' * 16384 + '"'])
def test_rejected_sources_remain_rejected_and_never_emit_ir(source):
    result = failure(source)
    assert not result['ok'] and 'expression' not in result
