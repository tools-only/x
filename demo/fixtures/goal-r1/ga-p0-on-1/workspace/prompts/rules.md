---
active: true
---
- ACTION6(x,y) moves the 15-block to center on the clicked trail point (color 3); each move erodes a growing diagonal band from the bottom-right (2 cells first, then ~18 per step), not a fixed right-end pair. (hyp.action6_sequential_erosion)
- The erosion band grows by one cell on each side per successive ACTION6; total eroded after n valid moves is ~n^2+n+1. With 64 bottom-row cells, max ~7 moves before GAME_OVER. (hyp.action6_sequential_erosion)
- Clicking adjacent to the 0-diamond gap at (10,53) fills it into a single 3 (trail point). (hyp.block_move_range)
- GAME_OVER triggers when the bottom row y=63 is fully eroded (all 64 cells non-zero). (mem.bottom_row_timer)
