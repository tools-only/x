"""One-process ScienceWorld action boundary for the layered Pi adapter.

The HTTP surface intentionally exposes only public task observations and actions.
The scoring reference path is never generated or routed to the Agent.
"""

from __future__ import annotations

import argparse
import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any


class ScienceWorldRun:
    def __init__(self, env: Any, task: str, variations: list[int], max_steps: int = 100):
        if not variations or max_steps < 1:
            raise ValueError("variations and a positive max_steps are required")
        self.env, self.task, self.variations, self.max_steps = env, task, variations, max_steps
        self.index = 0
        self.total_steps = 0
        self.episode_steps = 0
        self.score = 0
        self.state = "NOT_FINISHED"
        self.observation = ""
        self.last: dict[str, Any] | None = None
        self._start()

    def _start(self) -> None:
        self.env.load(self.task, self.variations[self.index], "", generateGoldPath=False)
        observation, info = self.env.reset()
        self.observation = observation
        self.score = int(info.get("score", 0))
        self.episode_steps = 0
        self.state = "NOT_FINISHED"

    def snapshot(self) -> dict[str, Any]:
        return {
            "task": self.task,
            "variation": self.variations[self.index],
            "level": self.index + 1,
            "levels_completed": len(self.variations) if self.state == "WIN" else self.index,
            "win_levels": len(self.variations),
            "state": self.state,
            "observation": self.observation,
            "score": self.score,
            "step": self.episode_steps,
            "actions_used": self.total_steps,
            "budget_left": self.max_steps * len(self.variations) - self.total_steps,
            "level_budget": self.max_steps,
            "level_budget_left": self.max_steps - self.episode_steps,
            "look": self.env.look(),
            "inventory": self.env.inventory(),
            "task_description": self.env.get_task_description(),
            "valid_actions": self.env.get_valid_action_object_combinations() if self.state == "NOT_FINISHED" else [],
            "last": self.last,
        }

    def act(self, action: str) -> dict[str, Any]:
        if self.state != "NOT_FINISHED":
            raise ValueError(f"episode is {self.state}")
        if self.total_steps >= self.max_steps * len(self.variations):
            raise ValueError("run action budget exhausted")
        if not action or not isinstance(action, str):
            raise ValueError("action must be a nonempty string")
        before = self.snapshot()
        if action == "RESET":
            self.total_steps += 1
            self._start()
            if self.total_steps >= self.max_steps * len(self.variations):
                self.state = "GAME_OVER"
            transition = {"action": action, "observation": self.observation, "reward": 0, "score": self.score,
                          "done": False, "before": {"level": before["level"], "step": before["step"],
                                                      "score": before["score"]}, "state": self.state}
            self.last = transition
            return {"transition": transition, "state": self.snapshot()}
        observation, reward, done, info = self.env.step(action)
        self.total_steps += 1
        self.episode_steps += 1
        self.observation = observation
        self.score = int(info["score"])
        complete = bool(done) or self.episode_steps >= self.max_steps or self.total_steps >= self.max_steps * len(self.variations)
        succeeded = complete and self.score >= 100
        self.state = "WIN" if succeeded and self.index + 1 == len(self.variations) else (
            "LEVEL_COMPLETE" if succeeded else "GAME_OVER" if complete else "NOT_FINISHED")
        transition = {
            "action": action, "observation": observation, "reward": reward,
            "score": self.score, "done": bool(done), "info": {
                "moves": info.get("moves"), "valid": info.get("valid"),
                "look": info.get("look"), "inv": info.get("inv"),
            }, "before": {"level": before["level"], "step": before["step"], "score": before["score"]},
            "state": self.state,
        }
        self.last = transition
        if self.state == "LEVEL_COMPLETE":
            self.index += 1
            self._start()
            if self.total_steps >= self.max_steps * len(self.variations):
                self.state = "GAME_OVER"
            self.last = transition
        return {"transition": transition, "state": self.snapshot()}


def serve(run: ScienceWorldRun, token: str, port: int) -> None:
    class Handler(BaseHTTPRequestHandler):
        def _send(self, status: int, value: dict[str, Any]) -> None:
            body = json.dumps(value, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:
            if self.path == "/state":
                self._send(200, run.snapshot())
            else:
                self._send(404, {"error": "unknown endpoint"})

        def do_POST(self) -> None:
            if self.path != "/action":
                self._send(404, {"error": "unknown endpoint"})
                return
            if self.headers.get("X-ScienceWorld-Action-Token") != token:
                self._send(403, {"error": "action token required"})
                return
            try:
                size = int(self.headers.get("Content-Length", "0"))
                request = json.loads(self.rfile.read(size))
                self._send(200, run.act(request["action"]))
            except (ValueError, KeyError, json.JSONDecodeError) as exc:
                self._send(400, {"error": str(exc)})

    HTTPServer(("127.0.0.1", port), Handler).serve_forever()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--task", required=True)
    parser.add_argument("--variations", required=True, help="comma-separated variation indices")
    parser.add_argument("--max-steps", type=int, default=100)
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--token", required=True)
    args = parser.parse_args()
    from scienceworld import ScienceWorldEnv

    env = ScienceWorldEnv(envStepLimit=args.max_steps)
    run = ScienceWorldRun(env, args.task, [int(x) for x in args.variations.split(",")], args.max_steps)
    serve(run, args.token, args.port)


if __name__ == "__main__":
    main()
