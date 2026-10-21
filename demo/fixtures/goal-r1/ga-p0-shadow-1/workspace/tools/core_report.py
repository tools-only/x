# view: on
g = grid
core = [(x, y) for y in range(20, 36) for x in range(18, 40) if g[y][x] in (6, 9, 15)]
from collections import Counter
c = Counter(g[y][x] for x, y in core)
xs = [p[0] for p in core]; ys = [p[1] for p in core]
rng = f"x{min(xs)}-{max(xs)} y{min(ys)}-{max(ys)}" if core else "empty"
print(f"core(x18-39,y20-35): c6={c.get(6,0)} c9={c.get(9,0)} c15={c.get(15,0)} {rng}")
