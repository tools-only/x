"""Sparse transition context must retain exact before/after evidence, not guess roles."""
import json
from copy import deepcopy

from autoresearch_pi.arc_agi_3_bridge import frame_delta
from test_harness_capability_authoring import module_eval


def test_delta_recovers_previous_pixels_without_a_second_frame_read():
    before = [[0, 8, 8], [1, 1, 1]]
    after = [[8, 8, 0], [1, 1, 1]]
    delta = frame_delta({"frames": [before]}, {"frames": [after]})
    recovered = deepcopy(after)
    for cell in delta["cells"]:
        recovered[cell["row"]][cell["col"]] = cell["before"]
    assert recovered == before
    assert delta["cells"] == [
        {"row": 0, "col": 0, "before": 0, "value": 8},
        {"row": 0, "col": 2, "before": 8, "value": 0},
    ]


def test_row_runs_keep_zero_before_and_after_without_losing_global_coordinates():
    delta = {"changed_cells": 3, "cells": [
        {"row": 4, "col": 6, "before": 0, "value": 8},
        {"row": 4, "col": 5, "before": 0, "value": 8},
        {"row": 4, "col": 7, "before": 8, "value": 0},
    ]}
    text = module_eval("pi_arc_context_projection.ts",
                       f"m.renderArcDecisionDelta({json.dumps(delta)},false)")
    assert 'row_runs=[{"row":4,"runs":["5-6=0>8","7=8>0"]}]' in text
    assert "before>after" in text


def test_small_exact_level_transition_does_not_require_a_recovery_read():
    text = module_eval("pi_arc_context_projection.ts",
        "m.renderArcDecisionDelta({changed_cells:1,cells:[{row:4,col:5,before:8,value:0}]},true)")
    assert '"5=8>0"' in text
    assert "before>after" in text


def test_small_action_batch_keeps_each_transition_but_one_complete_current_image():
    result = module_eval("pi_arc_observation_window.ts", "(() => {"
        "const current=Array.from({length:64},()=>Array(64).fill(0)); const events=[];"
        "for(let i=0;i<8;i++){ current[40][i]=8; events.push({event:'action',index:i+1,"
        "action:'ACTION1',level_before:0,state_before:'NOT_FINISHED',"
        "observation_delta:{changed_cells:1,cells:[{row:40,col:i,before:0,value:8}]},"
        "frame:{state:'NOT_FINISHED',levels_completed:0,frames:[current.map(r=>r.slice())]}}); }"
        "return m.renderArcObservationWindow(events,{frames:[current]},{includeImages:true});})()")
    assert result["actionCount"] == 8
    assert len(result["images"]) == 1
    assert result["text"].count("Grid current_state_frame (64x64)") == 1
    assert result["text"].count("TRANSITION arc-action-") == 8
    assert len(result["text"]) < 8000
    for i in range(8):
        assert f'"{i}=0>8"' in result["text"]
        assert f"ACTION/RESULT arc-action-{i + 1}:" in result["text"]


def test_incomplete_delta_is_a_recovery_pointer_even_when_small():
    for delta in (
        {"changed_cells": 2, "cells": [{"row": 0, "col": 0, "before": 8, "value": 0}],
         "cells_truncated": True},
        {"changed_cells": 2, "cells": [{"row": 0, "col": 0, "before": 8, "value": 0}]},
        {"changed_cells": 2},
    ):
        text = module_eval("pi_arc_context_projection.ts",
                           f"m.renderArcDecisionDelta({json.dumps(delta)},false)")
        assert "row_runs=" not in text
        assert "execution-observations.jsonl" in text


def test_legacy_after_only_delta_does_not_invent_a_before_value():
    text = module_eval("pi_arc_context_projection.ts",
                       "m.renderArcDecisionDelta({changed_cells:1,cells:[{row:4,col:5,value:8}]},false)")
    assert '"5=8"' in text
    assert "before>after" not in text


def test_large_change_keeps_a_historical_keyframe_instead_of_silently_dropping_it():
    result = module_eval("pi_arc_observation_window.ts", "(() => {"
        "const a=Array.from({length:64},()=>Array(64).fill(0)); const cells=[];"
        "for(let r=0;r<4;r++)for(let c=0;c<64;c++){a[r][c]=8;cells.push({row:r,col:c,before:0,value:8});}"
        "const b=a.map(r=>r.slice()); b[40][0]=8; const events=["
        "{event:'action',index:1,action:'ACTION1',level_before:0,observation_delta:{changed_cells:256,cells},"
        "frame:{levels_completed:0,frames:[a]}},"
        "{event:'action',index:2,action:'ACTION2',level_before:0,"
        "observation_delta:{changed_cells:1,cells:[{row:40,col:0,before:0,value:8}]},"
        "frame:{levels_completed:0,frames:[b]}}];"
        "return m.renderArcObservationWindow(events,{frames:[b]},{includeImages:true});})()")
    assert len(result["images"]) == 2
    assert "Grid arc-action-1_frame_0 (64x64)" in result["text"]
    assert "Grid current_state_frame (64x64)" in result["text"]
    assert "complete cells in bridge-events.jsonl" in result["text"]


def test_sparse_final_change_still_keeps_distinct_animation_evidence():
    result = module_eval("pi_arc_observation_window.ts",
        "m.renderArcObservationWindow([{event:'action',index:1,action:'ACTION1',"
        "level_before:0,observation_delta:{changed_cells:1,cells:[{row:0,col:0,before:0,value:8}]},"
        "frame:{levels_completed:0,frames:[[[9,9],[9,9]],[[8,1],[2,3]]]}}],"
        "{frames:[[[8,1],[2,3]]]},{includeImages:true})")
    assert len(result["images"]) == 2
    assert "ANIMATION SUMMARY arc-action-1" in result["text"]
    assert "Grid arc-action-1_frame_0" in result["text"]
    assert '"0=0>8"' in result["text"]


def test_committed_action_ledger_refreshes_duplicates_and_respects_new_epochs():
    result = module_eval("pi_arc_context_projection.ts", "(() => {"
        "const ledger=new Map(); const delta={changed_cells:1,bbox:{top:1,left:2,bottom:1,right:2},"
        "cells:[{row:1,col:2,before:0,value:8}]};"
        "const record=(action,index,epoch,extra={})=>m.arcRecordActionEffect(ledger,"
        "{action,action_index:index,state_epoch:epoch,delta,...extra});"
        "record('ACTION1',1,0); record('ACTION2',2,0); record('ACTION1',3,0);"
        "const prior=ledger.get('ACTION1'); const reset=record('RESET',4,0,{delta:{changed_cells:0}});"
        "const later=record('ACTION3',5,reset.state_epoch);"
        "const level=record('ACTION4',6,later.state_epoch,{level_changed:true});"
        "return {prior,reset,later,level};})()")
    assert result["prior"]["attempts"] == 2
    assert len(result["prior"]["distinct_effects"]) == 1
    repeated = result["prior"]["distinct_effects"][0]
    assert repeated["last_action_index"] == 3
    assert repeated["components"][0]["matching_actions"] == ["ACTION1", "ACTION2"]
    assert result["reset"]["state_epoch"] == result["later"]["state_epoch"] == 1
    assert result["later"]["components"][0]["matching_actions"] == ["ACTION3"]
    assert result["level"]["state_epoch"] == 2


def test_old_batch_receipts_retire_only_after_a_later_successful_action():
    result = module_eval("pi_arc_context_projection.ts", "m.compactHistoricalArcFrames(["
        "{role:'toolResult',toolName:'arc_actions',content:[{type:'text',text:'ARC batch completed 3/3 actions. OLD'}]},"
        "{role:'toolResult',toolName:'arc_actions',content:[{type:'text',text:'Operation aborted'}]},"
        "{role:'toolResult',toolName:'arc_action',content:[{type:'text',text:'Current transition: NEW'}]}])")
    assert "Historical ARC action result omitted" in result[0]["content"][0]["text"]
    assert result[1]["content"][0]["text"] == "Operation aborted"
    assert result[2]["content"][0]["text"] == "Current transition: NEW"
    current = module_eval("pi_arc_context_projection.ts", "m.compactHistoricalArcFrames(["
        "{role:'toolResult',toolName:'arc_actions',content:[{type:'text',text:'ARC batch completed 3/3 actions. CURRENT'}]}])")
    assert current[0]["content"][0]["text"] == "ARC batch completed 3/3 actions. CURRENT"
