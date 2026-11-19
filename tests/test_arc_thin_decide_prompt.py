from autoresearch_pi.arc_thin_e2e import DECIDE_PROMPT, WINDOW_DECIDE_PROMPT


def test_window_decide_prompt_leaves_analysis_and_tool_choice_to_agent():
    assert WINDOW_DECIDE_PROMPT == DECIDE_PROMPT == "Decide the next action."
