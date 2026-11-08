"""Legacy core continuation policy for the PPT runner, kept separate from Pi transport."""


def initial_intent(resume: bool, continue_prompt: str | None, kickoff_prompt: str | None) -> dict:
    if resume and continue_prompt:
        return {"kind": "explicit_continuation", "guidance": continue_prompt}
    if resume:
        return {"kind": "resume"}
    return {"kind": "kickoff", "guidance": kickoff_prompt or "Complete the requested deliverable using the supplied brief and source material."}


def legacy_core_next_intent(state: dict, latest: dict, fresh_batch: bool, batch_requests: int) -> dict:
    """Preserve the runner's existing no-process continuation choice as legacy core policy."""
    return {"kind": "resume" if latest.get("stopReason") == "length" and not (
        fresh_batch and state.get("batchRequests", 0) >= batch_requests) else "next"}


def process_next_intent(choice: dict) -> dict:
    return {"kind": "process_next", "guidance": choice.get("guidance", "")}


def pi_prompt(intent: dict) -> str:
    if intent["kind"] == "resume":
        return "PPT_RESUME"
    if intent["kind"] == "next":
        return "PPT_NEXT"
    if intent["kind"] == "process_next":
        return "PPT_NEXT" + (f"\n{intent['guidance']}" if intent.get("guidance") else "")
    return intent["guidance"]
