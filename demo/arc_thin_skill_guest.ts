/** Sandbox guest shared by thin-harness skills and the evidence board. */
import { TASK_PYTHON_FORMAT, taskPythonLimits, taskPythonRuntimeIdentity, type ValidatedTaskPythonProgram } from "./pi_task_python.ts";

/**
 * Constant guest program. The skill source travels as input data and is
 * compiled as "<skill>", so reported line numbers match the source as saved.
 * The shared task-python runtime is not modified.
 */
export const SKILL_GUEST = String.raw`import json

_req = input
_ns = {"__name__": "skill"}


def _where(error, source):
    lines = source.splitlines()
    if isinstance(error, SyntaxError):
        return "line %s: %s" % (error.lineno, (error.text or "").rstrip())
    found = []
    tb = error.__traceback__
    while tb is not None:
        code = tb.tb_frame.f_code
        if code.co_filename == "<skill>":
            number = tb.tb_lineno
            text = lines[number - 1].strip() if 0 < number <= len(lines) else ""
            found.append("line %s in %s: %s" % (number, code.co_name, text))
        tb = tb.tb_next
    return "\n".join(found[-4:])


try:
    _code = compile(_req["source"], "<skill>", "exec")
    exec(_code, _ns)
    if not callable(_ns.get("run")):
        raise ValueError("source must define run(state, args)")
    if _req["mode"] == "check":
        result = {"ok": True}
    else:
        _value = _ns["run"](_req["state"], _req["args"])
        json.dumps(_value, allow_nan=False)
        result = {"ok": True, "value": _value}
except BaseException as _error:
    result = {"ok": False, "error": (type(_error).__name__ + ": " + str(_error))[:600], "where": _where(_error, _req["source"])}
`;

export const SKILL_LIMITS = { input_bytes: 384 * 1024, output_bytes: 64 * 1024, fuel: 4_000_000_000, timeout_ms: 20_000 };

export type GuestResult = { ok: true; value?: unknown } | { ok: false; error: string; where?: string };

export function skillGuestProgram(limits: Record<string, number> = SKILL_LIMITS): ValidatedTaskPythonProgram {
	return { format: TASK_PYTHON_FORMAT, source: SKILL_GUEST, limits, effective_limits: taskPythonLimits(limits),
		runtime: taskPythonRuntimeIdentity() };
}

export const guestFailure = (result: Extract<GuestResult, { ok: false }>) =>
	result.error + (result.where ? `\n${result.where}` : "");
