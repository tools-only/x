"""Deterministic SDK action boundary used only by --mock-environment smoke."""
from types import SimpleNamespace


class GameAction:
    def __init__(self, name):
        if name not in {'RESET', 'ACTION1', 'ACTION2', 'ACTION3', 'ACTION4'}:
            raise ValueError(f'unknown action {name}')
        self.name = name
        self.action_data = SimpleNamespace(model_dump=lambda: {})

    @classmethod
    def from_name(cls, name):
        return cls(name)

    @classmethod
    def from_id(cls, number):
        return cls('RESET' if number == 0 else f'ACTION{number}')

    def is_complex(self):
        return False
