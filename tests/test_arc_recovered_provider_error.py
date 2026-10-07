from autoresearch_pi.arc_agi_3_e2e import _turn_provider_error


def message(stop, error=None):
    return {"type": "message_end", "message": {
        "role": "assistant", "stopReason": stop, "errorMessage": error}}


def test_recovered_error_does_not_override_successful_action_turn():
    assert _turn_provider_error([
        message("error", "terminated"), message("toolUse"),
        {"type": "tool_execution_end", "toolName": "arc_action", "isError": False},
        message("aborted", "Request was aborted."),
    ]) is None


def test_latest_real_error_is_not_hidden_by_earlier_success():
    assert _turn_provider_error([message("toolUse"), message("error", "Connection error.")]) == "Connection error."


def test_abort_alone_does_not_erase_an_unrecovered_error():
    assert _turn_provider_error([message("error", "terminated"), message("aborted")]) == "terminated"
