/** Objective, role-free matrix symbol inventory for overcoming VLM small-object blindness. */

export const COLOR_CHARS = "WwgGcBMPRbSYOrNp";

export type SymbolInventory = {
  value: number;
  symbol: string;
  pixels: number;
  comps: number;
  bboxes: Array<[number, number, number, number]>;
};

export function recordFrameColorChanges(prev: number[][], next: number[][], changedColors: Set<number>): void {
  const h = Math.min(prev.length, next.length);
  for (let y = 0; y < h; y += 1) {
    const prow = prev[y], nrow = next[y];
    const w = Math.min(prow.length, nrow.length);
    for (let x = 0; x < w; x += 1) {
      if (prow[x] !== nrow[x]) {
        changedColors.add(prow[x]);
        changedColors.add(nrow[x]);
      }
    }
  }
}

export function boardInventory(grid: number[][], changedColors?: ReadonlySet<number>): {
  line: string;
  unchanged: string[];
  symbols: SymbolInventory[];
} {
  const h = grid.length, w = h ? grid[0].length : 0;
  if (!h || !w) return { line: "", unchanged: [], symbols: [] };
  const visited = new Uint8Array(h * w);
  const queue = new Int32Array(h * w);
  const byValue = new Map<number, SymbolInventory>();

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const start = y * w + x;
      if (visited[start]) continue;
      const value = grid[y][x];
      visited[start] = 1;
      let head = 0, tail = 0;
      queue[tail++] = start;
      let count = 0, x0 = x, x1 = x, y0 = y, y1 = y;
      while (head < tail) {
        const idx = queue[head++];
        const cy = (idx / w) | 0, cx = idx - cy * w;
        count += 1;
        if (cx < x0) x0 = cx;
        if (cx > x1) x1 = cx;
        if (cy < y0) y0 = cy;
        if (cy > y1) y1 = cy;
        if (cx > 0) {
          const n = idx - 1;
          if (!visited[n] && grid[cy][cx - 1] === value) { visited[n] = 1; queue[tail++] = n; }
        }
        if (cx + 1 < w) {
          const n = idx + 1;
          if (!visited[n] && grid[cy][cx + 1] === value) { visited[n] = 1; queue[tail++] = n; }
        }
        if (cy > 0) {
          const n = idx - w;
          if (!visited[n] && grid[cy - 1][cx] === value) { visited[n] = 1; queue[tail++] = n; }
        }
        if (cy + 1 < h) {
          const n = idx + w;
          if (!visited[n] && grid[cy + 1][cx] === value) { visited[n] = 1; queue[tail++] = n; }
        }
      }
      let entry = byValue.get(value);
      if (!entry) {
        const symbol = COLOR_CHARS[value] ?? value.toString(16);
        entry = { value, symbol, pixels: 0, comps: 0, bboxes: [] };
        byValue.set(value, entry);
      }
      entry.pixels += count;
      entry.comps += 1;
      if (entry.bboxes.length < 2) entry.bboxes.push([x0, y0, x1, y1]);
    }
  }

  const symbols = [...byValue.values()].sort((a, b) => a.value - b.value);
  const parts = symbols.map(item => {
    const loc = item.comps <= 2
      ? "@" + item.bboxes.map(([x0, y0, x1, y1]) => `(${x0},${y0})-(${x1},${y1})`).join(",")
      : "";
    return `${item.symbol}=${item.pixels}/${item.comps}${loc}`;
  });
  const unchanged = changedColors && changedColors.size > 0
    ? symbols.filter(item => !changedColors.has(item.value)).map(item => item.symbol)
    : [];
  return {
    line: `Board inventory (symbol=pixels/comps, x,y bbox if <=2 comps): ${parts.join(", ")}`,
    unchanged,
    symbols,
  };
}
