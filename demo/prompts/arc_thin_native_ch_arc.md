## ARC observation contract
The working view contains the authoritative current state and grid, available actions, observations since the last query, and per-action results. Results report state/score changes, changed-cell counts and bounds; selected intermediate frames may also appear. The grid is rendered as hexadecimal rows (`0`–`f`); in Python, `grid[y][x]` is an integer color. Attached images correspond to the rendered frames in order.

Coordinates are zero-based from the top-left: `x` increases right and `y` down. The `arc_action` tool schema describes accepted actions and arguments. Each action produces a receipt.
