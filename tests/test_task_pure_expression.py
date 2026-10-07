"""Task-independent conformance tests for the restricted pure JSON AST."""

import json
import os
import subprocess
from pathlib import Path

from test_pi_external_benchmark_native import _pi_cli


PROJECT = Path(__file__).resolve().parents[1]
MODULE = (PROJECT / "demo" / "pi_task_pure_expression.ts").as_uri()


def run_js(body):
    node, _ = _pi_cli()
    script = f'import * as m from {json.dumps(MODULE)};\n{body}'
    completed = subprocess.run(
        [node, "--experimental-strip-types", "--input-type=module", "-e", script],
        capture_output=True, text=True, env=os.environ.copy(),
    )
    assert completed.returncode == 0, completed.stderr
    return json.loads(completed.stdout)


def evaluate(expression, input_value=None, limits=None, options="{}"):
    program = {"format": "task-pure-expression-v1", "expression": expression,
               "limits": limits or {}}
    return run_js(
        f"try {{ const r=m.evaluateTaskPureExpression({json.dumps(program)},"
        f"{json.dumps(input_value)},{options}); console.log(JSON.stringify({{ok:true,r}})); }}"
        " catch(e) { console.log(JSON.stringify({ok:false,error:e.toJSON?.()??{message:e.message}})); }"
    )


def lit(value):
    return {"op": "literal", "value": value}


def test_lexical_shadowing_dynamic_access_and_deterministic_object_order():
    expr = {
        "op": "let", "name": "x", "value": lit("outer"),
        "body": {"op": "object", "fields": [
            {"key": "picked", "value": {
                "op": "let", "name": "x",
                "value": {"op": "get", "value": {"op": "input"}, "key": lit("field")},
                "body": {"op": "index", "array": {"op": "get", "value": {"op": "input"}, "key": lit("items")},
                         "index": {"op": "var", "name": "x"}},
            }},
            {"key": "outer", "value": {"op": "var", "name": "x"}},
        ]},
    }
    result = evaluate(expr, {"field": 1, "items": ["zero", "one"]})
    assert result["ok"]
    assert result["r"]["value"] == {"picked": "one", "outer": "outer"}
    assert result["r"]["output_json"] == '{"picked":"one","outer":"outer"}'


def test_nested_variable_length_transform_and_empty_all():
    expand = {
        "op": "flat_map", "array": {"op": "get", "value": {"op": "input"}, "key": lit("groups")}, "as": "group",
        "body": {"op": "map", "array": {"op": "range", "start": lit(0),
                                          "stop": {"op": "get", "value": {"op": "var", "name": "group"}, "key": lit("count")}},
                 "as": "i", "body": {"op": "object", "fields": [
                     {"key": "label", "value": {"op": "get", "value": {"op": "var", "name": "group"}, "key": lit("label")}},
                     {"key": "index", "value": {"op": "var", "name": "i"}},
                 ]}},
    }
    assert evaluate(expand, {"groups": [{"label": "a", "count": 2}, {"label": "b", "count": 1}]})["r"]["value"] == [
        {"label": "a", "index": 0}, {"label": "a", "index": 1}, {"label": "b", "index": 0}]
    all_empty = {"op": "all", "array": lit([]), "as": "item", "predicate": lit(False)}
    assert evaluate(all_empty)["r"]["value"] is True


def test_whole_tree_validation_rejects_dead_invalid_branches_and_exact_key_typos():
    dead_unbound = {"op": "if", "condition": lit(True), "then": lit("ok"),
                    "else": {"op": "var", "name": "never_declared"}}
    failure = evaluate(dead_unbound)
    assert not failure["ok"] and failure["error"]["code"] == "invalid_program"
    assert failure["error"]["path"].endswith(".else.name")

    typo = {"op": "add", "left": lit(1), "rigth": lit(2)}
    failure = evaluate(typo)
    assert not failure["ok"] and failure["error"]["code"] == "invalid_program"
    assert failure["error"]["path"] == "$.expression"


def test_lazy_runtime_branches_do_not_execute_legal_failures():
    failing = {"op": "assert", "condition": lit(False), "value": lit(None), "message": "must stay dead"}
    conditional = {"op": "if", "condition": lit(True), "then": lit("safe"), "else": failing}
    conjunction = {"op": "and", "left": lit(False), "right": failing}
    disjunction = {"op": "or", "left": lit(True), "right": failing}
    assert evaluate(conditional)["r"]["value"] == "safe"
    assert evaluate(conjunction)["r"]["value"] is False
    assert evaluate(disjunction)["r"]["value"] is True


def test_strict_types_range_bounds_overflow_and_unicode_length():
    assert evaluate({"op": "length", "value": lit("A😀B")})["r"]["value"] == 3
    for expr in [
        {"op": "add", "left": lit("1"), "right": lit(2)},
        {"op": "range", "start": lit(2), "stop": lit(1)},
        {"op": "range", "start": lit(0.5), "stop": lit(2)},
        {"op": "multiply", "left": lit(1e308), "right": lit(1e308)},
    ]:
        failure = evaluate(expr)
        assert not failure["ok"] and failure["error"]["code"] == "type_error"


def test_structural_equality_is_order_insensitive_for_objects_and_metered():
    equality = {"op": "eq", "left": lit({"a": [1, 2], "b": True}),
                "right": lit({"b": True, "a": [1, 2]})}
    assert evaluate(equality)["r"]["value"] is True

    costly = {"op": "eq", "left": {"op": "input"}, "right": lit(list(range(40)))}
    failure = evaluate(costly, list(range(40)), {"steps": 85})
    assert not failure["ok"] and failure["error"]["code"] == "budget_exhausted"
    assert failure["error"]["consumed"]["steps"] <= 85


def test_cumulative_intermediate_allocation_fails_even_when_final_result_is_tiny():
    large_intermediate = {
        "op": "length",
        "value": {"op": "map", "array": {"op": "range", "start": lit(0), "stop": lit(80)},
                  "as": "i", "body": {"op": "array", "items": [
                      {"op": "var", "name": "i"}, {"op": "var", "name": "i"},
                  ]}},
    }
    failure = evaluate(large_intermediate, limits={"constructed_elements": 150})
    assert not failure["ok"]
    assert failure["error"]["code"] == "budget_exhausted"
    assert failure["error"]["consumed"]["constructed_elements"] <= 150


def test_huge_range_is_rejected_before_allocation_and_tiny_output_does_not_hide_it():
    expr = {"op": "length", "value": {"op": "range", "start": lit(0), "stop": lit(1000)}}
    failure = evaluate(expr, limits={"collection_length": 20})
    assert not failure["ok"] and failure["error"]["code"] == "budget_exhausted"
    assert failure["error"]["consumed"]["constructed_elements"] == 0


def test_input_output_and_forbidden_key_failures_are_stable_and_have_paths():
    input_failure = evaluate({"op": "input"}, [0] * 30, {"input_bytes": 20})
    assert input_failure["error"]["code"] == "invalid_input"
    assert input_failure["error"]["path"] == "$input"

    output_failure = evaluate({"op": "literal", "value": "x" * 30}, None, {"output_bytes": 10})
    assert output_failure["error"]["code"] == "output_too_large"
    assert output_failure["error"]["path"] == "$output"

    forbidden = evaluate({"op": "get", "value": {"op": "input"}, "key": lit("constructor")}, {})
    assert forbidden["error"]["code"] == "type_error"
    assert forbidden["error"]["path"].endswith(".key")


def test_static_limits_unknown_ops_duplicate_fields_and_cycles_are_invalid_programs():
    duplicate = {"op": "object", "fields": [
        {"key": "x", "value": lit(1)}, {"key": "x", "value": lit(2)}]}
    for expr in [{"op": "eval", "code": "1+1"}, duplicate]:
        failure = evaluate(expr)
        assert not failure["ok"] and failure["error"]["code"] == "invalid_program"

    result = run_js("""
const expression={op:'not'}; expression.value=expression;
try { m.validateTaskPureExpressionProgram({format:'task-pure-expression-v1',expression,limits:{}}); console.log(JSON.stringify({ok:true})); }
catch(e) { console.log(JSON.stringify({ok:false,error:e.toJSON()})); }
""")
    assert not result["ok"] and result["error"]["code"] == "invalid_program"


def test_static_literal_collections_and_nonliteral_ast_strings_are_bounded():
    oversized_literal = evaluate({"op": "length", "value": lit([0] * 9000)})
    assert not oversized_literal["ok"]
    assert oversized_literal["error"]["code"] == "invalid_program"
    assert "collection length exceeds limit" in oversized_literal["error"]["message"]

    oversized_message = run_js("""
const program={format:'task-pure-expression-v1',limits:{allocation_bytes:64,steps:20},
 expression:{op:'assert',condition:{op:'literal',value:true},value:{op:'literal',value:1},message:'x'.repeat(1_000_000)}};
try { m.evaluateTaskPureExpression(program,null); console.log(JSON.stringify({ok:true})); }
catch(e) { console.log(JSON.stringify({ok:false,error:e.toJSON()})); }
""")
    assert not oversized_message["ok"]
    assert oversized_message["error"]["code"] == "invalid_program"
    assert "string exceeds" in oversized_message["error"]["message"]


def test_streaming_serializer_charges_chunks_and_final_join_without_nested_strings():
    nested = 0
    for _ in range(15):
        nested = [nested]
    result = evaluate({"op": "input"}, nested, limits={"allocation_bytes": 160})
    assert not result["ok"]
    assert result["error"]["code"] == "budget_exhausted"
    assert result["error"]["consumed"]["allocation_bytes"] <= 160

    lone_surrogate = run_js("""
const program={format:'task-pure-expression-v1',limits:{},expression:{op:'input'}};
const value='\\ud800'; const result=m.evaluateTaskPureExpression(program,value);
console.log(JSON.stringify({output:result.output_json,expected:JSON.stringify(value)}));
""")
    assert lone_surrogate["output"] == lone_surrogate["expected"] == '"\\ud800"'


def test_cancellation_is_checked_within_256_charged_steps():
    expr = {"op": "range", "start": lit(0), "stop": lit(1000)}
    failure = evaluate(expr, options="{is_cancelled:()=>true}")
    assert not failure["ok"] and failure["error"]["code"] == "cancelled"
    assert failure["error"]["consumed"]["steps"] <= 256


def test_runtime_ceiling_dominates_authored_limit_and_program_limit_cannot_exceed_hard_ceiling():
    expr = {"op": "range", "start": lit(0), "stop": lit(40)}
    failure = evaluate(expr, limits={"collection_length": 100},
                       options="{runtime_limits:{collection_length:10}}")
    assert not failure["ok"] and failure["error"]["code"] == "budget_exhausted"
    assert failure["error"]["effective_limits"]["collection_length"] == 10

    too_large = evaluate(lit(1), limits={"steps": 1_000_001})
    assert not too_large["ok"] and too_large["error"]["code"] == "invalid_program"
