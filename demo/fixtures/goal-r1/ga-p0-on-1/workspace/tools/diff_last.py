# view: on
def run(args, env):
    g = env.grid
    p = env.prev_grid
    if p is None or len(p) != 64:
        return "no prev grid"
    diffs = [(x, y, p[y][x], g[y][x]) for y in range(64) for x in range(64) if p[y][x] != g[y][x]]
    if not diffs:
        return "last move changed nothing"
    xs = [d[0] for d in diffs]; ys = [d[1] for d in diffs]
    out = [f"last move: {len(diffs)} cells, bbox x{min(xs)}-{max(xs)} y{min(ys)}-{max(ys)}"]
    for x, y, a, b in diffs[:24]:
        out.append(f"  ({x},{y}) {a}->{b}")
    if len(diffs) > 24:
        out.append(f"  ... +{len(diffs)-24} more")
    return "\n".join(out)
