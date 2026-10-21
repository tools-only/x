# view: on
from collections import Counter
g = grid
c = Counter()
box = {}
for y in range(64):
    for x in range(64):
        v = g[y][x]
        if v == 5:
            continue
        c[v] += 1
        b = box.setdefault(v, [y, x, y, x])
        b[0] = min(b[0], y); b[1] = min(b[1], x)
        b[2] = max(b[2], y); b[3] = max(b[3], x)
parts = []
for v in sorted(c):
    t, l, bo, r = box[v]
    parts.append(f"c{v}:{c[v]} y{t}-{bo} x{l}-{r}")
print(" | ".join(parts))
