"""Mock only ARC SDK environment calls; production bridge/runner remain real."""
from types import SimpleNamespace


class OperationMode:
    ONLINE = 'mock-online'


class Environment:
    def __init__(self, game):
        self.game = game
        self.info = SimpleNamespace(baseline_actions=[100])
        self.actions = 0
        self.position = 2
        self._observe()

    def _observe(self):
        grid = [[0] * 8 for _ in range(8)]
        grid[3][self.position] = 9
        grid[0][0] = self.actions % 10
        self.observation_space = SimpleNamespace(game_id=self.game, frame=[grid],
            state=SimpleNamespace(name='PLAYING'), levels_completed=0, win_levels=1,
            guid='mock-arc', full_reset=False, available_actions=[1,2,3,4])
        return self.observation_space

    def step(self, action, data, reasoning):
        self.actions += 1
        self.position = (self.position + (1 if action.name in {'ACTION1','ACTION4'} else -1)) % 8
        return self._observe()


class Arcade:
    def __init__(self, operation_mode):
        self.mode = operation_mode

    def open_scorecard(self, tags):
        return 'mock-scorecard'

    def make(self, game, scorecard_id):
        return Environment(game)

    def close_scorecard(self, card_id):
        return SimpleNamespace(model_dump=lambda **kwargs: {'scorecard_id':card_id,'score':0,'mock':True})
