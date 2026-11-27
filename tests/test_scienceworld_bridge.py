from autoresearch_pi.scienceworld_bridge import ScienceWorldRun


class FakeWorld:
    def load(self, task, variation, simplification, generateGoldPath=False):
        assert task == "test-task"
        assert simplification == ""
        assert generateGoldPath is False
        self.variation = variation
        self.moves = 0

    def reset(self):
        return "start", {"score": 0}

    def step(self, action):
        self.moves += 1
        score = 100 if action == "finish" else 0
        return action, score, action == "finish", {"score": score, "moves": self.moves,
                                                     "valid": ["finish"], "look": "room", "inv": ""}

    def look(self):
        return "room"

    def inventory(self):
        return ""

    def get_task_description(self):
        return "task"

    def get_valid_action_object_combinations(self):
        return ["finish"]


def test_variations_preserve_progress_and_require_native_completion():
    run = ScienceWorldRun(FakeWorld(), "test-task", [0, 2], max_steps=3)
    first = run.act("wait")
    assert first["transition"]["state"] == "NOT_FINISHED"
    assert first["state"]["score"] == 0
    complete = run.act("finish")
    assert complete["transition"]["state"] == "LEVEL_COMPLETE"
    assert complete["state"]["variation"] == 2
    assert complete["state"]["levels_completed"] == 1
    assert complete["state"]["actions_used"] == 2
    final = run.act("finish")["state"]
    assert final["state"] == "WIN"
    assert final["levels_completed"] == 2


def test_budget_end_is_not_success():
    run = ScienceWorldRun(FakeWorld(), "test-task", [0], max_steps=1)
    assert run.act("wait")["state"]["state"] == "GAME_OVER"


def test_reset_restarts_current_variation_and_spends_total_budget():
    run = ScienceWorldRun(FakeWorld(), "test-task", [0], max_steps=3)
    run.act("wait")
    result = run.act("RESET")
    assert result["state"]["step"] == 0
    assert result["state"]["actions_used"] == 2
    assert result["state"]["budget_left"] == 1
