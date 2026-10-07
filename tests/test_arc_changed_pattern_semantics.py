"""Changed-pixel recurrence is geometry, not evidence of action invariance."""
from test_harness_capability_authoring import module_eval


def test_opposite_color_arrangements_do_not_share_a_pattern_signature():
    result = module_eval("pi_arc_context_projection.ts", "(() => {"
        "const cells=[{row:1,col:2,value:2},{row:1,col:3,value:9},{row:2,col:2,value:2},{row:2,col:3,value:9}];"
        "const opposite=cells.map(c=>({...c,value:c.value===2?9:2}));"
        "return [m.arcChangedComponents({cells})[0],m.arcChangedComponents({cells:opposite})[0]];})()")
    assert result[0]["bbox"] == result[1]["bbox"]
    assert result[0]["changed_cells"] == result[1]["changed_cells"]
    assert result[0]["shape_signature"] != result[1]["shape_signature"]


def test_pattern_is_stable_under_cell_order_and_translation():
    result = module_eval("pi_arc_context_projection.ts", "(() => {"
        "const cells=[{row:1,col:2,value:2},{row:1,col:3,value:9},{row:2,col:2,value:2}];"
        "const moved=cells.slice().reverse().map(c=>({...c,row:c.row+5,col:c.col+7}));"
        "return [m.arcChangedComponents({cells})[0],m.arcChangedComponents({cells:moved})[0]];})()")
    assert result[0]["shape_signature"] == result[1]["shape_signature"]
    assert result[0]["bbox"] != result[1]["bbox"]


def test_provider_ledger_keeps_geometry_without_suggesting_action_aliases():
    result = module_eval("pi_arc_context_projection.ts", "m.renderArcEffectLedger(new Map([['ACTION2',"
        "{attempts:1,distinct_effects:[{state_epoch:0,changed_cells:2,bbox:{top:1,left:2,bottom:1,right:3},"
        "components:[{changed_cells:2,bbox:{top:1,left:2,bottom:1,right:3},centroid:{row:1,col:2.5},"
        "role:'cross_action_common_candidate',matching_actions:['ACTION1','ACTION2'],shape_signature:'EXACT_PATTERN'}],"
        "classification:['action_invariant_candidate'],last_action_index:2}]}]]))")
    assert '"matching_actions"' not in result
    assert '"group_sizes":[2]' in result
    assert "action_invariant" not in result and '"classification"' not in result and '"role"' not in result
    assert "EXACT_PATTERN" not in result


def test_real_matcher_respects_exact_pattern_and_epoch_without_transitive_matches():
    result = module_eval("pi_arc_context_projection.ts", "(() => {"
        "const cells=[{row:1,col:2,value:2},{row:1,col:3,value:9}];"
        "const components=m.arcChangedComponents({cells});"
        "const opposite=m.arcChangedComponents({cells:cells.map(c=>({...c,value:c.value===2?9:2}))});"
        "const ledger=new Map(["
        "['ACTION1',{attempts:1,distinct_effects:[{state_epoch:0,components}]}],"
        "['ACTION3',{attempts:1,distinct_effects:[{state_epoch:0,components:opposite}]}],"
        "['ACTION4',{attempts:1,distinct_effects:[{state_epoch:1,components}]}]]);"
        "return [m.arcMatchingChangedComponents(components,'ACTION2',0,ledger),"
        "m.arcMatchingChangedComponents(components,'ACTION2',1,ledger),"
        "m.arcMatchingChangedComponents(components,'ACTION2',2,ledger)];})()")
    assert result[0][0]["matching_actions"] == ["ACTION1", "ACTION2"]
    assert result[1][0]["matching_actions"] == ["ACTION2", "ACTION4"]
    assert result[2][0]["matching_actions"] == ["ACTION2"]


def test_empty_and_disconnected_changes_are_stable_and_keep_component_geometry():
    result = module_eval("pi_arc_context_projection.ts", "(() => {"
        "const cells=[{row:8,col:9,value:2},{row:1,col:2,value:2}];"
        "return [m.arcChangedComponents(undefined),m.arcChangedComponents({cells:[]}),"
        "m.arcChangedComponents({cells}),m.arcChangedComponents({cells:cells.slice().reverse()})];})()")
    assert result[0] == result[1] == []
    assert result[2] == result[3]
    assert len(result[2]) == 2
    assert result[2][0]["bbox"] != result[2][1]["bbox"]


def test_partial_delta_cannot_establish_an_exact_pattern():
    result = module_eval("pi_arc_context_projection.ts", "(() => {"
        "const cells=[{row:1,col:2,value:2}]; return ["
        "m.arcChangedComponents({cells,cells_truncated:true}),"
        "m.arcChangedComponents({cells,changed_cells:2})];})()")
    assert result == [[], []]
