from autoresearch_pi.arc_thin_e2e import WINDOW_DECIDE_PROMPT


def test_window_decide_prompt_connects_saved_tool_results_to_actions_without_making_observers_act():
    prompt = WINDOW_DECIDE_PROMPT.lower()
    assert "saved tool's result matters to the next experiment" in prompt
    assert "if a saved callable tool still fits and you choose its rule for the next real move" in prompt
    assert "call it by name in decide with the action args its own env.act needs, including later moves" in prompt
    assert "use empty args or dry_run only for inspection" in prompt
    assert "otherwise revise it, use it read-only, or act directly" in prompt
    assert "keep its action path when revising" in prompt
    assert "choose and take the next action now" in prompt
    assert "observation-only tools read-only" in prompt
    assert "callable run(args, env)" in prompt
    assert "env.act" in prompt
    assert "otherwise act with arc_action" in prompt
