# view: on
g = grid
# find the 3x3 color-15 block that is NOT the top anchor (top anchor at x30-32,y4-6)
cells = [(x, y) for y in range(64) for x in range(64) if g[y][x] == 15]
# cluster into blocks by proximity; identify the moving one as the 3x3 not at top
blocks = {}
for x, y in cells:
    key = (y // 8, x // 8)
    blocks.setdefault(key, []).append((x, y))
moving = None
for k, v in blocks.items():
    xs = [p[0] for p in v]; ys = [p[1] for p in v]
    if len(v) >= 9 and min(xs) > 20:  # not the top anchor (x~30-32 but y<10)
        if min(ys) > 10:
            moving = v
if moving is None:
    print("no moving 15-block found")
else:
    xs = [p[0] for p in moving]; ys = [p[1] for p in moving]
    cx = (min(xs) + max(xs)) // 2
    cy = (min(ys) + max(ys)) // 2
    # distance along anti-diagonal from 9-diamond center (48,15): steps = |cx-cy - (48-15)| / sqrt2 approx -> use manhattan/2
    diag_dist = abs((cx - cy) - (48 - 15))
    print(f"15-block center=({cx},{cy}); anti-diag dist to 9-diamond(48,15)={diag_dist} steps")
