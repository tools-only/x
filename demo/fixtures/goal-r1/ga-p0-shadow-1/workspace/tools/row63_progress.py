# view: on
g = grid
zeros = [x for x in range(64) if g[63][x] == 0]
n = len(zeros)
clicks = (n + 1) // 2
try:
    al = state.get('action_budget', {}).get('actions_left')
except Exception:
    al = '?'
rng = f"x{min(zeros)}-{max(zeros)}" if n else "empty"
print(f"row63: {n} zeros remain ({rng}); ~{clicks} ACTION6 clicks to clear; actions_left={al}; state={state.get('status','?')}")
