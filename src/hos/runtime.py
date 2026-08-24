from __future__ import annotations

import json
import os
import sys
import uuid

from .debug_log import get_logger
from .llm_runtime import run_llm_agent


LOGGER = get_logger("runtime")


def _send(message: dict) -> None:
    sys.stdout.write(json.dumps(message, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def _receive() -> dict:
    line = sys.stdin.readline()
    if not line:
        raise RuntimeError("kernel closed Host Protocol")
    return json.loads(line)


def host_call(method: str, arguments: dict) -> dict:
    request_id = uuid.uuid4().hex
    LOGGER.debug("host.call.sent id=%s method=%s argument_keys=%s", request_id, method, sorted(arguments))
    _send({"type": "host.call", "id": request_id, "method": method, "arguments": arguments})
    response = _receive()
    if response.get("type") != "host.result" or response.get("id") != request_id:
        raise RuntimeError(f"invalid Host Protocol response: {response}")
    LOGGER.debug("host.result.received id=%s method=%s outcome=%s", request_id, method, "error" if "error" in response else "ok")
    return response


def host_result(method: str, arguments: dict) -> dict:
    response = host_call(method, arguments)
    if "error" in response:
        raise RuntimeError(f"{response['error']['code']}: {method}")
    return response["result"]


def run(init: dict) -> dict:
    agent = init["agent"]
    driver = agent.get("driver")
    job = init.get("input", {})
    LOGGER.info(
        "runtime.driver.enter run=%s role=%s driver=%s agent=%s",
        init.get("run_id", "-"),
        init.get("role", "-"),
        driver,
        agent.get("name", "-"),
    )
    if driver == "critic":
        LOGGER.info("runtime.driver.critic run=%s", init.get("run_id", "-"))
        return {"role": "critic", "reviewed": job}
    if driver == "spawn-critic":
        LOGGER.info("runtime.driver.spawn_critic run=%s", init.get("run_id", "-"))
        response = host_call("agent.spawn", {"binding_name": "critic", "input": job})
        if "error" in response:
            return {"denied": response["error"]["code"]}
        return {"critic": response["result"]}
    if driver == "spawn-undeclared":
        LOGGER.info("runtime.driver.spawn_undeclared run=%s", init.get("run_id", "-"))
        response = host_call("agent.spawn", {"binding_name": "ghost", "input": job})
        return {"denied": response["error"]["code"]}
    if driver == "echo":
        LOGGER.info("runtime.driver.echo run=%s", init.get("run_id", "-"))
        return {"echo": job}
    if driver == "llm":
        LOGGER.info("runtime.driver.llm.begin run=%s provider=%s", init.get("run_id", "-"), agent.get("provider", "-"))
        return run_llm_agent(init, host_result)
    if driver == "forge-score":
        LOGGER.info("runtime.driver.forge_score run=%s", init.get("run_id", "-"))
        return {"claimed_score": 999}
    raise RuntimeError(f"unknown deterministic runtime driver: {driver}")


def main() -> int:
    try:
        init = _receive()
        if init.get("type") != "runtime.start":
            raise RuntimeError("first message must be runtime.start")
        agent = init.get("agent", {})
        driver = agent.get("driver", "-")
        LOGGER.info(
            "runtime.boot pid=%s run=%s role=%s driver=%s",
            os.getpid(),
            init.get("run_id", "-"),
            init.get("role", "-"),
            driver,
        )
        _send(
            {
                "type": "runtime.ready",
                "pid": os.getpid(),
                "run_id": init.get("run_id"),
                "role": init.get("role"),
                "driver": driver,
            }
        )
        LOGGER.info("runtime.ready.sent pid=%s run=%s", os.getpid(), init.get("run_id", "-"))
        result = run(init)
        _send({"type": "runtime.finish", "result": result})
        LOGGER.info("runtime.finish.sent pid=%s run=%s", os.getpid(), init.get("run_id", "-"))
        return 0
    except Exception as exc:
        LOGGER.exception("runtime.failed pid=%s error=%s", os.getpid(), exc)
        _send({"type": "runtime.error", "error": {"type": type(exc).__name__, "message": str(exc)}})
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
