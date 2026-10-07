"""Model-facing ARC context must stay bounded while trace evidence stays durable."""

from test_harness_capability_authoring import module_eval


def test_effect_ledger_omits_expanded_pixel_signatures_but_keeps_geometry():
    result = module_eval(
        "pi_arc_context_projection.ts",
        "m.renderArcEffectLedger(new Map([['ACTION6',{attempts:9,distinct_effects:[{"
        "state_epoch:1,changed_cells:3558,bbox:{top:0,left:0,bottom:63,right:63},"
        "components:[{changed_cells:3558,bbox:{top:0,left:0,bottom:63,right:63},"
        "shape_signature:JSON.stringify({values:Array(3558).fill('4')}),matching_actions:['ACTION6']}],"
        "last_action_index:9}]}]]))",
    )
    assert len(result) < 1200
    assert '"changed_cells":3558' in result
    assert '"last_action_index":9' in result
    assert '"group_sizes":[3558]' in result
    assert '"matching_actions"' not in result
    assert '"classification"' not in result
    assert '"shape_signature"' not in result


def test_large_transition_delta_is_a_bounded_trace_pointer():
    result = module_eval(
        "pi_arc_context_projection.ts",
        "m.renderArcDecisionDelta({changed_cells:3558,bbox:{top:0,left:0,bottom:63,right:63},"
        "cells:Array.from({length:3558},(_,i)=>({row:Math.floor(i/64),col:i%64,value:4}))},true)",
    )
    assert len(result) < 500
    assert "changed_cells=3558" in result
    assert "row_runs=" not in result
    assert "execution-observations.jsonl" in result


def test_small_delta_stays_exact_and_only_old_action_results_are_compacted():
    delta = module_eval(
        "pi_arc_context_projection.ts",
        "m.renderArcDecisionDelta({changed_cells:2,bbox:{top:1,left:2,bottom:1,right:3},"
        "cells:[{row:1,col:2,value:8},{row:1,col:3,value:8}]},false)",
    )
    assert 'row_runs=[{"row":1,"runs":["2-3=8"]}]' in delta

    messages = module_eval(
        "pi_arc_context_projection.ts",
        "m.compactHistoricalArcFrames(["
        "{role:'user',content:[{type:'text',text:'Task charter'}]},"
        "{role:'toolResult',toolName:'arc_action',content:[{type:'text',text:'Current transition: old full result'}]},"
        "{role:'toolResult',toolName:'arc_state',content:[{type:'text',text:'Lossless coordinate runs old frame'}]},"
        "{role:'toolResult',toolName:'arc_action',content:[{type:'text',text:'Current transition: newest result'}]}"
        "])",
    )
    assert messages[0]["content"][0]["text"] == "Task charter"
    assert "Historical ARC action result omitted" in messages[1]["content"][0]["text"]
    assert "Historical ARC frame view omitted" in messages[2]["content"][0]["text"]
    assert messages[3]["content"][0]["text"] == "Current transition: newest result"


def test_latest_full_frame_is_preserved_until_an_action_supersedes_it():
    messages = module_eval(
        "pi_arc_context_projection.ts",
        "m.compactHistoricalArcFrames(["
        "{role:'toolResult',toolName:'arc_state',content:[{type:'text',text:'Lossless coordinate runs old'}]},"
        "{role:'toolResult',toolName:'arc_state',content:[{type:'text',text:'Lossless coordinate runs current'}]}"
        "])",
    )
    assert "Historical ARC frame view omitted" in messages[0]["content"][0]["text"]
    assert messages[1]["content"][0]["text"] == "Lossless coordinate runs current"


def test_completed_assistant_reasoning_is_preserved_by_default_with_tool_calls_and_live_tail():
    messages = module_eval(
        "pi_arc_context_projection.ts",
        "m.compactHistoricalArcFrames(["
        "{role:'assistant',content:[{type:'thinking',thinking:'x'.repeat(90000)+'FINAL_CONCLUSION'},"
        "{type:'toolCall',id:'c1',name:'task_harness',arguments:{action:'inspect'}}]},"
        "{role:'toolResult',toolName:'task_harness',content:[{type:'text',text:'receipt'}]},"
        "{role:'assistant',content:[{type:'thinking',thinking:'y'.repeat(2000)+'LIVE_CONTINUATION'}]}"
        "])",
    )
    assert messages[0]["content"][0]["thinking"] == "x" * 90000 + "FINAL_CONCLUSION"
    assert messages[0]["content"][1]["name"] == "task_harness"
    assert messages[1]["content"][0]["text"] == "receipt"
    assert messages[2]["content"][0]["thinking"].endswith("LIVE_CONTINUATION")
