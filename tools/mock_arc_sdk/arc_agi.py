"""Mock only ARC SDK environment calls; production bridge/runner remain real."""
import os
import time
from types import SimpleNamespace

# MOCK_ARC_FAIL_AFTER=N: every step after the first N returns None, as the remote
# SDK wrapper did in real runs (the bridge reports EnvironmentReturnedNoFrame).
FAIL_AFTER = int(os.environ.get("MOCK_ARC_FAIL_AFTER") or 0)
FAIL_MARKER = os.environ.get("MOCK_ARC_FAIL_MARKER") or ""
# MOCK_ARC_HANG_AT=N with MOCK_ARC_HANG_MARKER=<file> (the restart smoke, 2026-10-16): the Nth step of a game does not
# return for MOCK_ARC_HANG_SECONDS (default 30), once per marker file, as steps of the online service did in su15 runs;
# the bridge's step timeout (90 s) ends the wait first when the hang is longer.
HANG_AT = int(os.environ.get("MOCK_ARC_HANG_AT") or 0)
HANG_MARKER = os.environ.get("MOCK_ARC_HANG_MARKER") or ""
HANG_SECONDS = float(os.environ.get("MOCK_ARC_HANG_SECONDS") or 30)
# MOCK_ARC_LEVEL_AT=N (fork smoke part 5, 2026-10-17): the Nth step completes level 1 of 2; the 9 restarts at the left of
# row 5.
LEVEL_AT = int(os.environ.get("MOCK_ARC_LEVEL_AT") or 0)
# MOCK_ARC_STILL_ACTIONS=ACTION3 (refusal smoke parts 4-5, 2026-10-17): the named actions change only the counter cell.
STILL_ACTIONS = {name for name in (os.environ.get("MOCK_ARC_STILL_ACTIONS") or "").split(",") if name}


class OperationMode:
    ONLINE = 'mock-online'


class Environment:
    def __init__(self, game):
        self.game = game
        self.info = SimpleNamespace(baseline_actions=[100, 100] if LEVEL_AT else [100])
        self.actions = 0
        self.position = 2
        self.levels = 0
        self._observe()

    def _observe(self):
        grid = [[0] * 8 for _ in range(8)]
        grid[5 if self.levels else 3][self.position] = 9
        grid[0][0] = self.actions % 10
        self.observation_space = SimpleNamespace(game_id=self.game, frame=[grid],
            state=SimpleNamespace(name='PLAYING'), levels_completed=self.levels, win_levels=2 if LEVEL_AT else 1,
            guid='mock-arc', full_reset=False, available_actions=[1,2,3,4])
        return self.observation_space

    def step(self, action, data, reasoning):
        if FAIL_AFTER and self.actions >= FAIL_AFTER and (not FAIL_MARKER or not os.path.exists(FAIL_MARKER)):
            if FAIL_MARKER:
                open(FAIL_MARKER, 'w').close()
            return None
        if HANG_AT and self.actions + 1 == HANG_AT and HANG_MARKER and not os.path.exists(HANG_MARKER):
            open(HANG_MARKER, 'w').close()
            time.sleep(HANG_SECONDS)
        self.actions += 1
        if action.name not in STILL_ACTIONS:
            self.position = (self.position + (1 if action.name in {'ACTION1','ACTION4'} else -1)) % 8
        if LEVEL_AT and self.actions == LEVEL_AT:
            self.levels, self.position = 1, 0
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
