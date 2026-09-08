from autoresearch_pi.task_agent import PiTaskAgent


class ScriptedKernel:
    def __init__(self): self.prompts = []
    def prompt(self, message): self.prompts.append(message)
    def drain_events(self): return [{"type": "agent_end", "text": "done"}]


def test_task_agent_delegates_loop_to_pi():
    kernel = ScriptedKernel()
    result = PiTaskAgent(kernel=kernel).run("task")
    assert result.answer == "done"
    assert kernel.prompts == ["task"]
