# view: on
from collections import Counter
g = grid
cells = [(x, y) for y in range(64) for x in range(64) if g[y][x] == 6]
# cluster into 2x2 blocks by proximity (gap > 3 means separate block)
blocks = []
used = [False]*len(cells)
for i,(x,y) in enumerate(cells):
    if used[i]: continue
    grp=[(x,y)]; used[i]=True
    changed=True
    while changed:
        changed=False
        for j,(x2,y2) in enumerate(cells):
            if not used[j] and any(abs(x2-a)+abs(y2-b)<=3 for a,b in grp):
                grp.append((x2,y2)); used[j]=True; changed=True
    blocks.append(grp)
parts=[]
for b in blocks:
    xs=[p[0] for p in b]; ys=[p[1] for p in b]
    tl=(min(xs),min(ys))
    d=abs(min(xs)-33)+abs(min(ys)-27)
    parts.append(f"c6 TL({tl[0]},{tl[1]}) n={len(b)} d9={d}")
parts.append(" | ".join(sorted(parts)))
print("c6 blocks:", " ; ".join(sorted(parts)))
