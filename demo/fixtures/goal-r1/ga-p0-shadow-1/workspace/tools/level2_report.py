# view: on
from collections import Counter
g = grid
targets = [6, 9, 10, 11, 15]
parts = []
for v in targets:
    cells = [(x, y) for y in range(64) for x in range(64) if g[y][x] == v]
    if not cells:
        parts.append(f"c{v}:0")
        continue
    xs = [p[0] for p in cells]; ys = [p[1] for p in cells]
    parts.append(f"c{v}:{len(cells)} y{min(ys)}-{max(ys)} x{min(xs)}-{max(xs)}")
zeros63 = sum(1 for x in range(64) if g[63][x] == 0)
parts.append(f"row63:{zeros63} zeros")
print(" | ".join(parts))
